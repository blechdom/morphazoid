import assert from "node:assert/strict";
import test from "node:test";

import {
  CASCADING_FM_DEFAULTS,
  CASCADING_FM_LIMITS,
  CASCADING_FM_PRESETS,
  DEFAULT_CASCADING_FM_PRESET_ID,
  deriveCascadeStack as deriveFmStack,
  sanitizeCascadingFmSettings,
} from "../src/cascading-fm.js";
import {
  CASCADING_PM_DEFAULTS,
  CASCADING_PM_LIMITS,
  CASCADING_PM_PRESETS,
  DEFAULT_CASCADING_PM_PRESET_ID,
  CascadingPmProcessor,
  deriveCascadeStack as derivePmStack,
  renderCascadingPmSamples,
  sanitizeCascadingPmSettings,
} from "../src/cascading-pm.js";

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 32_768;
const TWO_PI = Math.PI * 2;

function presetById(presets, id) {
  return presets.find((preset) => preset.id === id)?.settings;
}

function renderCascadingFmSamples(settings, initialPhases = []) {
  const stack = deriveFmStack(settings);
  const stages = stack.oscillators.length;
  const phases = new Float64Array(stages);
  const stageOutputs = new Float64Array(stages);
  const result = new Float32Array(FRAME_COUNT);

  for (let index = 0; index < stages; index += 1) {
    phases[index] = initialPhases[index] ?? 0;
  }

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    for (let index = 0; index < stages; index += 1) {
      stageOutputs[index] = Math.sin(phases[index]);
    }
    result[frame] = stageOutputs[stages - 1];

    for (let index = 0; index < stages; index += 1) {
      const modulationHz = index === 0
        ? 0
        : stageOutputs[index - 1] * stack.connections[index - 1].depthHz;
      const next = phases[index]
        + TWO_PI * (stack.oscillators[index].freq + modulationHz) / SAMPLE_RATE;
      phases[index] = next - Math.floor(next / TWO_PI) * TWO_PI;
    }
  }
  return result;
}

function spectrumSummary(samples) {
  const real = new Float64Array(FRAME_COUNT);
  const imaginary = new Float64Array(FRAME_COUNT);
  let maximumStep = 0;
  let peak = 0;
  let sumSquares = 0;

  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const sample = samples[index];
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
    const window = 0.5 - 0.5 * Math.cos(TWO_PI * index / (FRAME_COUNT - 1));
    real[index] = sample * window;
    if (index > 0) {
      maximumStep = Math.max(
        maximumStep,
        Math.abs(samples[index] - samples[index - 1]),
      );
    }
  }

  for (let index = 1, reversed = 0; index < FRAME_COUNT; index += 1) {
    let bit = FRAME_COUNT >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const value = real[index];
      real[index] = real[reversed];
      real[reversed] = value;
    }
  }

  for (let length = 2; length <= FRAME_COUNT; length <<= 1) {
    const angle = -TWO_PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < FRAME_COUNT; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal
          - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary
          + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextTwiddleReal = twiddleReal * stepReal
          - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary
          + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  const powers = new Float64Array(FRAME_COUNT / 2);
  let totalEnergy = 0;
  let energyAboveFiveKhz = 0;
  for (let bin = 1; bin < FRAME_COUNT / 2; bin += 1) {
    const power = real[bin] ** 2 + imaginary[bin] ** 2;
    powers[bin] = power;
    totalEnergy += power;
    if (bin * SAMPLE_RATE / FRAME_COUNT >= 5_000) {
      energyAboveFiveKhz += power;
    }
  }

  let cumulativeEnergy = 0;
  let rolloff99Hz = 0;
  for (let bin = 1; bin < powers.length; bin += 1) {
    cumulativeEnergy += powers[bin];
    if (cumulativeEnergy >= totalEnergy * 0.99) {
      rolloff99Hz = bin * SAMPLE_RATE / FRAME_COUNT;
      break;
    }
  }

  return {
    maximumStep,
    peak,
    rms: Math.sqrt(sumSquares / FRAME_COUNT),
    rolloff99Hz,
    highFrequencyEnergyFraction: energyAboveFiveKhz / totalEnergy,
  };
}

function phasePatterns(stages) {
  return [
    new Array(stages).fill(0),
    Array.from({ length: stages }, (_, index) => Math.PI / 2 + index * 0.37),
    Array.from({ length: stages }, (_, index) => (
      index % 2 === 0 ? Math.PI * 0.75 : Math.PI * 0.25
    )),
  ];
}

test("both cascade engines really support twelve stages", () => {
  assert.equal(CASCADING_FM_LIMITS.maxStages, 12);
  assert.equal(CASCADING_PM_LIMITS.maxStages, 12);
  assert.equal(sanitizeCascadingFmSettings({ stages: 99 }).stages, 12);
  assert.equal(sanitizeCascadingPmSettings({ stages: 99 }).stages, 12);

  const fmStack = deriveFmStack({
    stages: 12,
    rootHz: 12,
    cascadeRatio: 1.1,
    modDepth: 1,
    depthTaper: 1,
  });
  assert.equal(fmStack.oscillators.length, 12);
  assert.equal(fmStack.connections.length, 11);
  assert.equal(fmStack.outputIndex, 11);

  const pmStack = derivePmStack({
    stages: 12,
    rootHz: 12,
    cascadeRatio: 1.1,
    phaseIndex: 0.5,
    indexTaper: 1,
  });
  assert.equal(pmStack.oscillators.length, 12);
  assert.equal(pmStack.connections.length, 11);
  assert.equal(pmStack.outputIndex, 11);

  const processor = new CascadingPmProcessor();
  processor._applySettings(pmStack.settings, true);
  assert.equal(processor._phases.length, 12);
  assert.equal(processor._phaseIndices.length, 11);
  assert.equal(processor._outputIndex, 11);
});

test("factory cascade structures avoid hidden safety clamps", () => {
  assert.deepEqual(
    CASCADING_FM_DEFAULTS,
    presetById(CASCADING_FM_PRESETS, DEFAULT_CASCADING_FM_PRESET_ID),
  );
  assert.deepEqual(
    CASCADING_PM_DEFAULTS,
    presetById(CASCADING_PM_PRESETS, DEFAULT_CASCADING_PM_PRESET_ID),
  );

  for (const fmPreset of CASCADING_FM_PRESETS) {
    assert.deepEqual(sanitizeCascadingFmSettings(fmPreset.settings), fmPreset.settings);
    const fmStack = deriveFmStack(fmPreset.settings);
    const fmCarrier = fmStack.oscillators.at(-1).freq;
    assert.ok(fmCarrier >= 500, `${fmPreset.id} carrier ${fmCarrier} Hz`);
    assert.ok(
      fmCarrier < CASCADING_FM_LIMITS.audioCeiling,
      `${fmPreset.id} carrier ${fmCarrier} Hz reaches the ceiling`,
    );
    for (let index = 0; index < fmStack.oscillators.length; index += 1) {
      const rawFrequency = fmPreset.settings.rootHz
        * fmPreset.settings.cascadeRatio ** index;
      assert.ok(rawFrequency < CASCADING_FM_LIMITS.audioCeiling);
      assert.equal(fmStack.oscillators[index].freq, rawFrequency);
    }

    for (let index = 0; index < fmStack.connections.length; index += 1) {
      const depth = fmStack.connections[index].depthHz;
      assert.ok(Number.isFinite(depth) && depth >= 0);
      assert.ok(depth <= CASCADING_FM_LIMITS.maxModDepth);
    }
    assert.ok(
      fmStack.connections.at(-1).depthHz / fmCarrier <= 0.25,
      `${fmPreset.id} final deviation is too wide`,
    );
  }

  for (const pmPreset of CASCADING_PM_PRESETS) {
    assert.deepEqual(sanitizeCascadingPmSettings(pmPreset.settings), pmPreset.settings);
    assert.ok(
      pmPreset.settings.stages >= 2 && pmPreset.settings.stages <= 10,
      `${pmPreset.id} has too many factory stages`,
    );
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const pmStack = derivePmStack(pmPreset.settings, { sampleRate });
      const pmCarrier = pmStack.oscillators.at(-1).frequencyHz;
      assert.ok(pmCarrier >= 45 && pmCarrier <= 440, `${pmPreset.id} carrier ${pmCarrier} Hz`);
      assert.equal(pmStack.boundedByFrequency, false, `${pmPreset.id} frequency guard`);
      assert.equal(pmStack.boundedByInternalIndex, false, `${pmPreset.id} index guard`);
      assert.equal(pmStack.boundedByBandwidth, false, `${pmPreset.id} bandwidth guard`);
      assert.ok(pmStack.connections.every(({ rawPhaseIndex, phaseIndex }) => (
        rawPhaseIndex <= CASCADING_PM_LIMITS.maxInternalPhaseIndex
          && phaseIndex === rawPhaseIndex
      )));
      assert.ok(
        pmStack.oscillators.at(-1).estimatedBandwidthHz <= 2_400,
        `${pmPreset.id} bandwidth exceeds the factory envelope`,
      );
    }
  }
});

test("factory FM cascades render audible, finite, bounded signals", () => {
  for (const preset of CASCADING_FM_PRESETS) {
    for (const phases of phasePatterns(preset.settings.stages)) {
      const samples = renderCascadingFmSamples(preset.settings, phases);
      assert.ok(samples.every(Number.isFinite), `FM ${preset.id} is non-finite`);
      const summary = spectrumSummary(samples);
      assert.ok(summary.peak <= 1.000001, `FM ${preset.id} peak is ${summary.peak}`);
      assert.ok(summary.rms >= 0.2, `FM ${preset.id} RMS is ${summary.rms}`);
      assert.ok(summary.rms <= 0.85, `FM ${preset.id} RMS is ${summary.rms}`);
      assert.ok(
        summary.maximumStep <= 2.000001,
        `FM ${preset.id} maximum sample step is ${summary.maximumStep}`,
      );
    }
  }
});

test("factory PM cascades keep almost all rendered energy below the piercing band", () => {
  for (const preset of CASCADING_PM_PRESETS) {
    for (const phases of phasePatterns(preset.settings.stages)) {
      const samples = renderCascadingPmSamples(preset.settings, {
        sampleRate: SAMPLE_RATE,
        frameCount: FRAME_COUNT,
        initialPhases: phases,
      });
      assert.ok(samples.every(Number.isFinite), `PM ${preset.id} is non-finite`);
      const summary = spectrumSummary(samples);
      assert.ok(
        summary.rolloff99Hz <= 900,
        `PM ${preset.id} 99% rolloff is ${summary.rolloff99Hz.toFixed(1)} Hz`,
      );
      assert.ok(
        summary.highFrequencyEnergyFraction <= 0.000001,
        `PM ${preset.id} has ${summary.highFrequencyEnergyFraction} energy above 5 kHz`,
      );
      assert.ok(
        summary.maximumStep <= 0.25,
        `PM ${preset.id} maximum sample step is ${summary.maximumStep}`,
      );
    }
  }
});
