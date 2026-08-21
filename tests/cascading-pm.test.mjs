import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CASCADING_PM_DEFAULTS,
  CASCADING_PM_LIMITS,
  CASCADING_PM_PRESETS,
  CASCADING_PM_PROCESSOR_NAME,
  DEFAULT_CASCADING_PM_PRESET_ID,
  CascadingPmAudioEngine,
  CascadingPmProcessor,
  advanceCascadePhases,
  cascadeRatioForStageCount,
  deriveCascadeStack,
  deriveCascadingPmStack,
  evaluatePhaseCascade,
  formatCascadeFrequency,
  formatPhaseIndex,
  phaseIndexSliderPosition,
  phaseIndexSliderValue,
  ratioSliderPosition,
  ratioSliderValue,
  renderCascadingPmSamples,
  rootHzSliderPosition,
  rootHzSliderValue,
  sanitizeCascadingPmSettings,
} from "../src/cascading-pm.js";

const ROOT = new URL("../", import.meta.url);
const TWO_PI = Math.PI * 2;
const RATIO_UNITY_POSITION = ratioSliderPosition(1);

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function rms(samples) {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / Math.max(1, samples.length));
}

function maximumSampleStep(samples, priorSample = null) {
  let maximum = 0;
  let previous = priorSample;
  for (const sample of samples) {
    if (previous !== null) {
      maximum = Math.max(maximum, Math.abs(sample - previous));
    }
    previous = sample;
  }
  return maximum;
}

function percentile(sortedValues, fraction) {
  const index = Math.floor((sortedValues.length - 1) * fraction);
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

/**
 * Summarize changes in local spectral activity without assuming an exact
 * waveform or a particular rhythmic grid. Signal RMS captures audible accent
 * depth, while first-difference RMS follows local spectral activity. Their
 * 50 ms quantiles measure short accents, and one-second activity means reveal
 * slower changes in the accent pattern.
 */
function temporalActivitySummary(samples, sampleRate) {
  const windowFrames = Math.max(2, Math.round(sampleRate * 0.05));
  const amplitude = [];
  const activity = [];
  for (let start = 0; start + windowFrames <= samples.length; start += windowFrames) {
    let squaredAmplitude = 0;
    let squaredDifference = 0;
    for (let index = start + 1; index < start + windowFrames; index += 1) {
      squaredAmplitude += samples[index] * samples[index];
      const difference = samples[index] - samples[index - 1];
      squaredDifference += difference * difference;
    }
    squaredAmplitude += samples[start] * samples[start];
    amplitude.push(Math.sqrt(squaredAmplitude / windowFrames));
    activity.push(Math.sqrt(squaredDifference / (windowFrames - 1)));
  }

  assert.ok(activity.length >= 20, "temporal analysis needs at least one second");
  const mean = activity.reduce((total, value) => total + value, 0) / activity.length;
  const sortedAmplitude = [...amplitude].sort((a, b) => a - b);
  const sortedActivity = [...activity].sort((a, b) => a - b);
  const oneSecondWindows = Math.max(1, Math.round(sampleRate / windowFrames));
  const trajectory = [];
  for (let start = 0; start < activity.length; start += oneSecondWindows) {
    const end = Math.min(activity.length, start + oneSecondWindows);
    let total = 0;
    for (let index = start; index < end; index += 1) total += activity[index];
    trajectory.push(total / (end - start));
  }

  return {
    amplitudeContrastDb: 20 * Math.log10(
      percentile(sortedAmplitude, 0.9)
        / Math.max(1e-12, percentile(sortedAmplitude, 0.1)),
    ),
    accentContrast: percentile(sortedActivity, 0.9)
      / Math.max(1e-12, percentile(sortedActivity, 0.1)),
    trajectorySpread: (
      Math.max(...trajectory) - Math.min(...trajectory)
    ) / Math.max(1e-12, mean),
  };
}

function methodBody(source, signature) {
  const methodStart = source.indexOf(signature);
  assert.ok(methodStart >= 0, `missing ${signature}`);
  const bodyStart = source.indexOf("{", methodStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${signature}`);
}

test("Cascading PM settings and presets are finite, bounded, and immutable", () => {
  const safe = sanitizeCascadingPmSettings({
    stages: 99,
    rootHz: -2,
    cascadeRatio: Infinity,
    phaseIndex: 999,
    indexTaper: -4,
  });
  assert.deepEqual(safe, {
    stages: CASCADING_PM_LIMITS.maxStages,
    rootHz: CASCADING_PM_LIMITS.minRootHz,
    cascadeRatio: CASCADING_PM_DEFAULTS.cascadeRatio,
    phaseIndex: CASCADING_PM_LIMITS.maxPhaseIndex,
    indexTaper: CASCADING_PM_LIMITS.minIndexTaper,
  });
  assert.ok(Object.isFrozen(safe));
  assert.equal(DEFAULT_CASCADING_PM_PRESET_ID, "slow-cascade");
  assert.equal(CASCADING_PM_PROCESSOR_NAME, "morphazoid-cascading-pm");
  assert.equal(CASCADING_PM_LIMITS.minCascadeRatio, 0.25);
  assert.equal(CASCADING_PM_LIMITS.maxStages, 12);
  assert.equal(sanitizeCascadingPmSettings({ cascadeRatio: 0.01 }).cascadeRatio, 0.25);
  assert.equal(CASCADING_PM_PRESETS.length, 6);
  assert.ok(Object.isFrozen(CASCADING_PM_PRESETS));
  assert.ok(CASCADING_PM_PRESETS.every(Object.isFrozen));
  assert.ok(CASCADING_PM_PRESETS.every(({ settings }) => Object.isFrozen(settings)));

  const motionCounts = { drone: 0, evolving: 0, rhythmic: 0 };

  for (const preset of CASCADING_PM_PRESETS) {
    assert.ok(
      Object.hasOwn(motionCounts, preset.motion),
      `${preset.id} has unknown motion class ${preset.motion}`,
    );
    motionCounts[preset.motion] += 1;
    assert.deepEqual(
      sanitizeCascadingPmSettings(preset.settings),
      preset.settings,
      `${preset.id} is not already sanitized`,
    );
  }
  assert.deepEqual(
    motionCounts,
    { drone: 2, evolving: 3, rhythmic: 1 },
    "the bank should deliberately balance drones, evolving tones, and rhythm",
  );
});

test("the operator ledger uses geometric base frequencies and radian phase indices", () => {
  const stack = deriveCascadeStack({
    stages: 5,
    rootHz: 0.5,
    cascadeRatio: 8,
    phaseIndex: 3,
    indexTaper: 0.5,
  }, { sampleRate: 48_000 });
  assert.equal(deriveCascadingPmStack, deriveCascadeStack);
  assert.deepEqual(
    stack.oscillators.map(({ frequencyHz }) => frequencyHz),
    [0.5, 4, 32, 256, 2_048],
  );
  assert.deepEqual(
    stack.connections.map(({ phaseIndex }) => phaseIndex),
    [3, 1.5, 0.75, 0.375],
  );
  assert.ok(stack.connections.every((connection) => !Object.hasOwn(connection, "depthHz")));
  assert.ok(stack.connections.every(({ phaseIndex }) => (
    phaseIndex >= 0 && phaseIndex <= CASCADING_PM_LIMITS.maxInternalPhaseIndex
  )));
  assert.equal(stack.outputIndex, 4);
  assert.ok(Object.isFrozen(stack));
  assert.ok(Object.isFrozen(stack.oscillators));
  assert.ok(Object.isFrozen(stack.connections));

  const zero = deriveCascadeStack({ ...stack.settings, phaseIndex: 0 });
  assert.deepEqual(
    zero.oscillators.map(({ frequencyHz }) => frequencyHz),
    stack.oscillators.map(({ frequencyHz }) => frequencyHz),
    "phase index must not alter any base frequency",
  );
  assert.ok(zero.connections.every(({ phaseIndex }) => phaseIndex === 0));
});

test("sub-unity ratios produce descending, stable, finite PM cascades", () => {
  const cases = [
    { ratio: 0.5, frequencies: [64, 32, 16, 8] },
    { ratio: 1, frequencies: [64, 64, 64, 64] },
    { ratio: 2, frequencies: [64, 128, 256, 512] },
  ];

  for (const { ratio, frequencies } of cases) {
    const settings = {
      stages: 4,
      rootHz: 64,
      cascadeRatio: ratio,
      phaseIndex: 1.4,
      indexTaper: 0.8,
    };
    const stack = deriveCascadeStack(settings, { sampleRate: 48_000 });
    assert.deepEqual(
      stack.oscillators.map(({ frequencyHz }) => frequencyHz),
      frequencies,
    );
    assert.equal(stack.boundedByFrequency, false);

    const samples = renderCascadingPmSamples(settings, {
      sampleRate: 48_000,
      frameCount: 2_048,
    });
    assert.ok(samples.every(Number.isFinite), `ratio ${ratio} produced non-finite audio`);
    assert.ok(samples.every((sample) => Math.abs(sample) <= 1));
  }

  const processor = new CascadingPmProcessor();
  processor._applySettings({
    stages: 4,
    rootHz: 64,
    cascadeRatio: 0.01,
    phaseIndex: 1,
    indexTaper: 1,
  }, true);
  assert.deepEqual(
    Array.from(processor._targetFrequencies.slice(0, 4)),
    [64, 16, 4, 1],
    "the worklet scalar sanitizer must enforce the 0.25 ratio floor",
  );

  const deepest = deriveCascadeStack({
    stages: CASCADING_PM_LIMITS.maxStages,
    rootHz: CASCADING_PM_LIMITS.minRootHz,
    cascadeRatio: CASCADING_PM_LIMITS.minCascadeRatio,
  });
  assert.equal(
    formatCascadeFrequency(deepest.oscillators.at(-1).frequencyHz),
    "4.77 nHz",
    "the ledger must not display a valid descending stage as 0 Hz",
  );
});

test("stage-count compensation preserves rising and descending PM endpoints", () => {
  const cases = [
    { ratio: 3.2, previousStages: 8, nextStages: 12, rootHz: 0.025 },
    { ratio: 0.72, previousStages: 6, nextStages: 11, rootHz: 100 },
    { ratio: 1.5, previousStages: 8, nextStages: 2, rootHz: 0.025 },
    { ratio: 0.9, previousStages: 8, nextStages: 2, rootHz: 100 },
  ];

  for (const { ratio, previousStages, nextStages, rootHz } of cases) {
    const adjustedRatio = cascadeRatioForStageCount(
      ratio,
      previousStages,
      nextStages,
    );
    const previous = deriveCascadeStack({
      stages: previousStages,
      rootHz,
      cascadeRatio: ratio,
      phaseIndex: 0,
      indexTaper: 1,
    });
    const next = deriveCascadeStack({
      stages: nextStages,
      rootHz,
      cascadeRatio: adjustedRatio,
      phaseIndex: 0,
      indexTaper: 1,
    });
    const expectedCarrierHz = previous.oscillators.at(-1).rawFrequencyHz;
    approximatelyEqual(
      next.oscillators.at(-1).rawFrequencyHz,
      expectedCarrierHz,
      Math.max(1, expectedCarrierHz) * 1e-12,
    );
    approximatelyEqual(
      cascadeRatioForStageCount(adjustedRatio, nextStages, previousStages),
      ratio,
      1e-12,
    );
  }
  assert.equal(cascadeRatioForStageCount(1, 2, 12), 1);
});

test("bandwidth pressure safely reduces extreme phase indices before Nyquist", () => {
  for (const sampleRate of [44_100, 48_000, 96_000]) {
    const stack = deriveCascadeStack({
      stages: CASCADING_PM_LIMITS.maxStages,
      rootHz: 110,
      cascadeRatio: 200,
      phaseIndex: 16,
      indexTaper: 4,
    }, { sampleRate });
    const bandwidthCeiling = sampleRate * 0.45;
    assert.ok(stack.oscillators.every(({ frequencyHz }) => (
      frequencyHz <= Math.min(CASCADING_PM_LIMITS.audioCeiling, sampleRate * 0.4)
    )));

    let priorBandwidth = stack.oscillators[0].frequencyHz;
    let limitedConnections = 0;
    for (let index = 0; index < stack.connections.length; index += 1) {
      const connection = stack.connections[index];
      const destinationHz = stack.oscillators[index + 1].frequencyHz;
      const estimatedBandwidth = destinationHz + connection.phaseIndex * priorBandwidth;
      assert.ok(
        estimatedBandwidth <= bandwidthCeiling + 1e-8,
        `stage ${index + 1} estimates ${estimatedBandwidth} Hz at ${sampleRate} Hz`,
      );
      priorBandwidth = estimatedBandwidth;
      if (connection.phaseIndex < Math.min(
        connection.rawPhaseIndex,
        CASCADING_PM_LIMITS.maxInternalPhaseIndex,
      )) limitedConnections += 1;
    }
    assert.ok(limitedConnections > 0, "extreme PM should engage the bandwidth guard");

    const processor = new CascadingPmProcessor();
    processor._sampleRate = sampleRate;
    processor._applySettings(stack.settings, true);
    for (let index = 0; index < stack.connections.length; index += 1) {
      approximatelyEqual(
        processor._phaseIndices[index],
        stack.connections[index].phaseIndex,
        1e-10,
      );
    }
  }
});

test("factory PM presets span shallow and deep cascades without relying on safety guards", () => {
  assert.deepEqual(
    CASCADING_PM_DEFAULTS,
    CASCADING_PM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID).settings,
  );
  const stageCounts = CASCADING_PM_PRESETS.map(({ settings }) => settings.stages);
  assert.ok(stageCounts.includes(2), "the bank needs a direct two-operator PM voice");
  assert.ok(stageCounts.includes(3), "the bank needs a compact three-operator cascade");
  assert.ok(
    stageCounts.some((stages) => stages >= 4 && stages <= 6),
    "the bank needs at least one medium four-to-six-stage cascade",
  );
  assert.ok(
    stageCounts.filter((stages) => stages >= 8).length <= 1,
    "at most one factory preset should use a deep eight-to-ten-stage cascade",
  );

  for (const preset of CASCADING_PM_PRESETS) {
    assert.ok(
      preset.settings.stages >= 2 && preset.settings.stages <= 10,
      `${preset.id} uses an excessive number of stages`,
    );
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const stack = deriveCascadeStack(preset.settings, { sampleRate });
      const carrier = stack.oscillators.at(-1);
      assert.equal(
        stack.boundedByFrequency,
        false,
        `${preset.id} relies on a frequency clamp at ${sampleRate} Hz`,
      );
      assert.ok(
        carrier.frequencyHz >= 45 && carrier.frequencyHz <= 440,
        `${preset.id} carrier ${carrier.frequencyHz} Hz is not comfortably audible`,
      );
      assert.equal(stack.boundedByInternalIndex, false, `${preset.id} index guard`);
      assert.equal(stack.boundedByBandwidth, false, `${preset.id} bandwidth guard`);
      assert.ok(stack.connections.every(({ rawPhaseIndex, phaseIndex }) => (
        rawPhaseIndex <= CASCADING_PM_LIMITS.maxInternalPhaseIndex
          && phaseIndex === rawPhaseIndex
      )));
      assert.ok(
        carrier.estimatedBandwidthHz <= 2_400,
        `${preset.id} bandwidth ${carrier.estimatedBandwidthHz} Hz is too bright`,
      );
    }
  }
});

test("preset motion classes sound distinct without forcing drones to pulse", () => {
  const sampleRate = 48_000;
  const frameCount = sampleRate * 8;
  const summaries = new Map();

  for (const preset of CASCADING_PM_PRESETS) {
    const rendered = renderCascadingPmSamples(preset.settings, {
      sampleRate,
      frameCount,
    });
    const unmodulated = renderCascadingPmSamples({
      ...preset.settings,
      phaseIndex: 0,
    }, {
      sampleRate,
      frameCount,
    });
    const motion = temporalActivitySummary(rendered, sampleRate);
    const carrierBaseline = temporalActivitySummary(unmodulated, sampleRate);
    summaries.set(preset.id, {
      ...motion,
      accentLift: motion.accentContrast - carrierBaseline.accentContrast,
      trajectoryLift: motion.trajectorySpread - carrierBaseline.trajectorySpread,
    });

    if (preset.motion === "evolving") {
      assert.ok(
        motion.trajectorySpread >= carrierBaseline.trajectorySpread + 0.001,
        `${preset.id} long-form motion ${motion.trajectorySpread.toFixed(4)} `
          + `barely exceeds its carrier baseline ${carrierBaseline.trajectorySpread.toFixed(4)}`,
      );
    }
    if (preset.motion === "rhythmic") {
      assert.ok(
        motion.amplitudeContrastDb >= 0.6,
        `${preset.id} has only ${motion.amplitudeContrastDb.toFixed(2)} dB `
          + "of short-time accent contrast",
      );
      assert.ok(
        motion.accentContrast >= carrierBaseline.accentContrast + 0.05,
        `${preset.id} rhythmic contrast ${motion.accentContrast.toFixed(3)} `
          + `barely exceeds its carrier baseline ${carrierBaseline.accentContrast.toFixed(3)}`,
      );
    }
  }

  const evolvingRates = CASCADING_PM_PRESETS
    .filter(({ motion }) => motion === "evolving")
    .map(({ settings }) => settings.rootHz)
    .sort((a, b) => a - b);
  assert.equal(new Set(evolvingRates).size, 3, "evolving presets need three distinct rates");
  for (let index = 1; index < evolvingRates.length; index += 1) {
    assert.ok(
      evolvingRates[index] / evolvingRates[index - 1] >= 3,
      "neighboring evolving presets should differ by at least threefold in motion rate",
    );
  }

  const motionValues = [...summaries.values()];
  const amplitudeRange = Math.max(...motionValues.map(({ amplitudeContrastDb }) => amplitudeContrastDb))
    - Math.min(...motionValues.map(({ amplitudeContrastDb }) => amplitudeContrastDb));
  const trajectoryRange = Math.max(...motionValues.map(({ trajectoryLift }) => trajectoryLift))
    - Math.min(...motionValues.map(({ trajectoryLift }) => trajectoryLift));
  assert.ok(amplitudeRange >= 0.4, "the preset bank still has one shared accent profile");
  assert.ok(trajectoryRange >= 0.004, "the preset bank still has one shared evolution profile");
});

test("the phase cascade evaluates the nested PM equation exactly", () => {
  const settings = {
    stages: 3,
    rootHz: 100,
    cascadeRatio: 2,
    phaseIndex: 2,
    indexTaper: 0.5,
  };
  const phases = [0.1, 0.2, 0.3];
  const evaluated = evaluatePhaseCascade(phases, settings);
  const stage0 = Math.sin(phases[0]);
  const stage1 = Math.sin(phases[1] + 2 * stage0);
  const stage2 = Math.sin(phases[2] + stage1);
  approximatelyEqual(evaluated.stageOutputs[0], stage0);
  approximatelyEqual(evaluated.stageOutputs[1], stage1);
  approximatelyEqual(evaluated.stageOutputs[2], stage2);
  approximatelyEqual(evaluated.output, stage2);
  assert.ok(Object.isFrozen(evaluated));
  assert.ok(Object.isFrozen(evaluated.stageOutputs));

  const noPm = evaluatePhaseCascade(phases, { ...settings, phaseIndex: 0 });
  approximatelyEqual(noPm.output, Math.sin(phases.at(-1)));

  const advanced = advanceCascadePhases(phases, settings, { sampleRate: 48_000 });
  for (let index = 0; index < advanced.length; index += 1) {
    const frequency = settings.rootHz * settings.cascadeRatio ** index;
    const expected = (phases[index] + TWO_PI * frequency / 48_000) % TWO_PI;
    approximatelyEqual(advanced[index], expected);
  }
});

test("logarithmic and quadratic slider mappings round-trip", () => {
  for (const value of [0, 0.03, 0.2, 0.5, 0.82, 1]) {
    approximatelyEqual(rootHzSliderPosition(rootHzSliderValue(value)), value, 1e-11);
    approximatelyEqual(ratioSliderPosition(ratioSliderValue(value)), value, 1e-11);
    approximatelyEqual(
      phaseIndexSliderPosition(phaseIndexSliderValue(value)),
      value,
      1e-11,
    );
  }
  assert.equal(ratioSliderValue(0), 0.25);
  approximatelyEqual(ratioSliderValue(RATIO_UNITY_POSITION), 1);
  approximatelyEqual(ratioSliderPosition(1), RATIO_UNITY_POSITION);
  assert.equal(ratioSliderValue(1), 200);
  for (const ratio of [0.25, 0.5, 1, 2, 10, 200]) {
    approximatelyEqual(ratioSliderValue(ratioSliderPosition(ratio)), ratio, 1e-11);
  }
  assert.equal(formatPhaseIndex(0), "0 rad");
  assert.equal(formatPhaseIndex(2.4), "2.4 rad");
  assert.equal(formatPhaseIndex(16), "16 rad");
});

test("ratio slider stays monotonic and precise across twelve stages", () => {
  let previous = ratioSliderValue(0);
  for (let tick = 1; tick <= 10_000; tick += 1) {
    const value = ratioSliderValue(tick / 10_000);
    assert.ok(Number.isFinite(value));
    assert.ok(value > previous, `ratio stopped increasing at slider tick ${tick}`);
    assert.ok(value >= CASCADING_PM_LIMITS.minCascadeRatio);
    assert.ok(value <= CASCADING_PM_LIMITS.maxCascadeRatio);
    previous = value;
  }

  for (const position of [0, 0.08, 0.1, 0.19, RATIO_UNITY_POSITION, 0.21, 0.4, 0.72, 0.9, 1]) {
    approximatelyEqual(ratioSliderPosition(ratioSliderValue(position)), position, 1e-11);
  }

  const musicalStart = ratioSliderPosition(1);
  const musicalEnd = ratioSliderPosition(5);
  assert.ok(
    musicalEnd - musicalStart >= 0.4,
    "the musically useful ×1–×5 region should occupy at least 40% of the track",
  );

  for (let tick = 0; tick < 1_000; tick += 1) {
    const start = musicalStart
      + (musicalEnd - musicalStart - 0.001) * tick / 999;
    const ratioStep = ratioSliderValue(start + 0.001) / ratioSliderValue(start);
    const finalStageStep = ratioStep ** (CASCADING_PM_LIMITS.maxStages - 1);
    assert.ok(
      finalStageStep <= 1.055,
      `one fine drag step compounded to ${finalStageStep.toFixed(4)}× at the final stage`,
    );
  }
});

test("preset ratios occupy a broad usable part of the rising slider", () => {
  const positions = [];
  for (const preset of CASCADING_PM_PRESETS) {
    const ratio = preset.settings.cascadeRatio;
    const position = ratioSliderPosition(ratio);
    approximatelyEqual(ratioSliderValue(position), ratio, 1e-10);
    assert.ok(position > RATIO_UNITY_POSITION, `${preset.id} should rise toward its carrier`);
    positions.push(position);
  }
  assert.ok(
    Math.max(...positions) - Math.min(...positions) >= 0.16,
    "factory ratios should not be bunched into a narrow part of the track",
  );
  assert.ok(
    new Set(positions.map((position) => position.toFixed(3))).size >= 4,
    "the bank should use at least four materially different cascade ratios",
  );
});

test("no two factory presets are near-clones in their audible design", () => {
  const presets = CASCADING_PM_PRESETS.map((preset) => ({
    ...preset,
    carrierHz: deriveCascadeStack(preset.settings).oscillators.at(-1).frequencyHz,
  }));
  const octaveDistance = (left, right) => Math.abs(Math.log2(left / right));

  for (let leftIndex = 0; leftIndex < presets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < presets.length; rightIndex += 1) {
      const left = presets[leftIndex];
      const right = presets[rightIndex];
      const materialDifferences = [
        Math.abs(left.settings.stages - right.settings.stages) >= 2,
        octaveDistance(left.settings.rootHz, right.settings.rootHz) >= 0.5,
        octaveDistance(left.settings.cascadeRatio, right.settings.cascadeRatio) >= 0.15,
        Math.abs(left.settings.phaseIndex - right.settings.phaseIndex) >= 0.2,
        Math.abs(left.settings.indexTaper - right.settings.indexTaper) >= 0.08,
        octaveDistance(left.carrierHz, right.carrierHz) >= 0.25,
      ].filter(Boolean).length;
      assert.ok(
        materialDifferences >= 2,
        `${left.id} and ${right.id} differ materially on only ${materialDifferences} design axis`,
      );
    }
  }
});

test("all presets render bounded, finite, and audible at common sample rates", () => {
  for (const preset of CASCADING_PM_PRESETS) {
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const samples = renderCascadingPmSamples(preset.settings, {
        sampleRate,
        frameCount: Math.round(sampleRate * 0.35),
      });
      assert.ok(samples.length > 0);
      assert.ok(samples.every(Number.isFinite), `${preset.id} produced non-finite audio`);
      assert.ok(samples.every((sample) => Math.abs(sample) <= 1));
      assert.ok(rms(samples) > 0.05, `${preset.id} is effectively silent at ${sampleRate}`);
    }
  }
});

test("the worklet matches the pure renderer and keeps render storage stable", () => {
  const priorSampleRate = globalThis.sampleRate;
  globalThis.sampleRate = 48_000;
  try {
    const settings = CASCADING_PM_PRESETS[2].settings;
    const processor = new CascadingPmProcessor();
    processor._applySettings(settings, true);
    const storage = {
      phases: processor._phases,
      frequencies: processor._frequencies,
      phaseIndices: processor._phaseIndices,
      stageOutputs: processor._stageOutputs,
    };
    const left = new Float32Array(512);
    const right = new Float32Array(512);
    assert.equal(processor.process([], [[left, right]]), true);
    const reference = renderCascadingPmSamples(settings, {
      sampleRate: 48_000,
      frameCount: left.length,
    });
    for (let index = 0; index < left.length; index += 1) {
      approximatelyEqual(left[index], reference[index], 1e-6);
      assert.equal(right[index], left[index]);
    }
    assert.equal(processor._phases, storage.phases);
    assert.equal(processor._frequencies, storage.frequencies);
    assert.equal(processor._phaseIndices, storage.phaseIndices);
    assert.equal(processor._stageOutputs, storage.stageOutputs);
  } finally {
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test("rapid stage changes remain bounded and continuous", () => {
  const priorSampleRate = globalThis.sampleRate;
  globalThis.sampleRate = 48_000;
  try {
    const processor = new CascadingPmProcessor();
    const common = {
      rootHz: 2,
      cascadeRatio: 1.5,
      phaseIndex: 0.7,
      indexTaper: 0.8,
    };
    processor._applySettings({ ...common, stages: 2 }, true);
    const rendered = [];
    for (const [stages, frames] of [[2, 192], [12, 160], [3, 160], [11, 800]]) {
      processor._applySettings({ ...common, stages }, false);
      const block = new Float32Array(frames);
      processor.process([], [[block]]);
      rendered.push(...block);
    }
    let maximumStep = 0;
    for (let index = 1; index < rendered.length; index += 1) {
      maximumStep = Math.max(maximumStep, Math.abs(rendered[index] - rendered[index - 1]));
    }
    assert.ok(rendered.every(Number.isFinite));
    assert.ok(rendered.every((sample) => Math.abs(sample) <= 1));
    assert.ok(maximumStep < 0.12, `stage changes produced a ${maximumStep} sample step`);
  } finally {
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test("all ordered live preset transitions stay click-safe with preallocated storage", () => {
  const priorSampleRate = globalThis.sampleRate;
  globalThis.sampleRate = 48_000;
  try {
    const staticSteps = new Map();
    for (const preset of CASCADING_PM_PRESETS) {
      const processor = new CascadingPmProcessor({
        processorOptions: { settings: preset.settings },
      });
      const block = new Float32Array(12_000);
      assert.equal(processor.process([], [[block]]), true);
      assert.ok(block.every(Number.isFinite), `${preset.id} static render is non-finite`);
      staticSteps.set(preset.id, maximumSampleStep(block));
    }
    const staticMaximumStep = Math.max(...staticSteps.values());
    const transitionCeiling = Math.min(
      0.12,
      Math.max(0.06, staticMaximumStep * 4),
    );
    let pairCount = 0;
    let shrinkingPairCount = 0;
    let worstTransition = { from: "", to: "", step: 0 };

    for (let fromIndex = 0; fromIndex < CASCADING_PM_PRESETS.length; fromIndex += 1) {
      const from = CASCADING_PM_PRESETS[fromIndex];
      for (let toIndex = 0; toIndex < CASCADING_PM_PRESETS.length; toIndex += 1) {
        const to = CASCADING_PM_PRESETS[toIndex];
        pairCount += 1;
        if (to.settings.stages < from.settings.stages) shrinkingPairCount += 1;

        const processor = new CascadingPmProcessor({
          processorOptions: { settings: from.settings },
        });
        const storage = Object.fromEntries(
          Object.entries(processor).filter(([, value]) => ArrayBuffer.isView(value)),
        );
        assert.ok(
          Object.keys(storage).length >= 9,
          "the worklet should allocate its fixed render storage in the constructor",
        );
        // Vary the hand-off phase deterministically so the matrix does not only
        // exercise six transitions from the same all-zero alignment.
        const preRoll = new Float32Array(4_096 + (fromIndex * 6 + toIndex) * 97);
        assert.equal(processor.process([], [[preRoll]]), true);
        const priorSample = preRoll.at(-1);
        processor._applySettings(to.settings, false);
        const transition = new Float32Array(8_192);
        assert.equal(processor.process([], [[transition]]), true);

        assert.ok(
          transition.every(Number.isFinite),
          `${from.id} -> ${to.id} produced non-finite samples`,
        );
        assert.ok(
          transition.every((sample) => Math.abs(sample) <= 1),
          `${from.id} -> ${to.id} exceeded the bounded PM output`,
        );
        for (const [name, reference] of Object.entries(storage)) {
          assert.equal(
            processor[name],
            reference,
            `${from.id} -> ${to.id} replaced preallocated ${name} storage`,
          );
        }

        const step = maximumSampleStep(transition, priorSample);
        if (step > worstTransition.step) {
          worstTransition = { from: from.id, to: to.id, step };
        }
      }
    }

    assert.equal(pairCount, 36, "the transition matrix must cover every ordered preset pair");
    assert.equal(
      shrinkingPairCount,
      15,
      "the transition matrix must include every deep-to-shallow stage change",
    );
    assert.ok(
      worstTransition.step < transitionCeiling,
      `${worstTransition.from} -> ${worstTransition.to} produced a `
        + `${worstTransition.step.toFixed(4)} sample step; static maximum is `
        + `${staticMaximumStep.toFixed(4)} and transition ceiling is `
        + transitionCeiling.toFixed(4),
    );
  } finally {
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test("the worklet process loop is allocation-free", async () => {
  const source = await readFile(new URL("src/cascading-pm.js", ROOT), "utf8");
  const body = methodBody(source, "process(_inputs, outputs)");
  const applyBody = methodBody(source, "_applySettings(rawSettings, immediate = false)");
  assert.doesNotMatch(body, /\bnew\s+|Array\.from|\.(?:map|filter|reduce|slice)\(/);
  assert.doesNotMatch(
    applyBody,
    /\bnew\s+|Array\.from|\.(?:map|filter|reduce|slice)\(|deriveCascadeStack|sanitizeCascadingPmSettings/,
    "worklet settings messages must not allocate a frozen derivation ledger",
  );
  assert.match(source, /registerProcessor\(CASCADING_PM_PROCESSOR_NAME, CascadingPmProcessor\)/);
  assert.match(source, /this\._phases\[index\]\s*\+\s*this\._stageOutputs\[index - 1\]\s*\*\s*effectivePhaseIndex/s);
  assert.doesNotMatch(body, /\.frequency\b|depthHz/);
});

test("the audio owner is lazy and sends true-PM settings to its worklet", async () => {
  class Parameter {
    constructor(value = 0) { this.value = value; }
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.connections = []; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections.length = 0; }
  }
  class Context {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = new Node();
      this.modules = [];
      this.audioWorklet = {
        addModule: async (url) => { this.modules.push(String(url)); },
      };
    }
    createBuffer() { return {}; }
    createBufferSource() {
      const node = new Node();
      node.start = () => {};
      node.buffer = null;
      node.onended = null;
      return node;
    }
    createGain() { const node = new Node(); node.gain = new Parameter(1); return node; }
    createDynamicsCompressor() {
      const node = new Node();
      for (const name of ["threshold", "knee", "ratio", "attack", "release"]) {
        node[name] = new Parameter();
      }
      return node;
    }
    createAnalyser() {
      const node = new Node();
      node.getByteTimeDomainData = (target) => target.fill(128);
      return node;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  const worklets = [];
  class Worklet extends Node {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = { postMessage: (message) => this.messages.push(message) };
      worklets.push(this);
    }
  }

  const runtime = {
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    setTimeout: (callback) => callback(),
  };
  const engine = new CascadingPmAudioEngine(runtime);
  assert.equal(engine.context, null, "constructing the owner must not touch audio");
  const settings = CASCADING_PM_PRESETS[3].settings;
  await engine.start(settings, 0.43);
  assert.equal(engine.running, true);
  assert.equal(worklets.length, 1);
  assert.equal(worklets[0].name, CASCADING_PM_PROCESSOR_NAME);
  assert.deepEqual(worklets[0].options.outputChannelCount, [1]);
  assert.deepEqual(worklets[0].options.processorOptions, { settings });
  assert.match(engine.context.modules[0], /\/src\/cascading-pm\.js$/);
  assert.deepEqual(worklets[0].messages.at(-1), {
    type: "settings",
    settings: sanitizeCascadingPmSettings(settings),
    immediate: true,
  });
  await engine.stop({ immediate: true });
  assert.equal(engine.context, null);
  assert.equal(engine.running, false);
});

test("the page explains phase—not frequency—modulation and exposes the parallel UI", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("cascading-pm.html", ROOT), "utf8"),
    readFile(new URL("cascading-pm-app.js", ROOT), "utf8"),
  ]);
  assert.match(html, /<h1[^>]*>Cascading PM<\/h1>/);
  assert.match(html, /id="stages"[^>]*max="12"/);
  assert.match(html, /id="phaseIndex"/);
  assert.match(html, /id="indexTaper"/);
  assert.match(html, /phase index in radians/i);
  assert.match(html, /offsets phase, not oscillator frequency/i);
  assert.match(html, /id="cascadeSafetyNote"/);
  assert.match(html, /×0\.25 to ×200/i);
  assert.match(html, /focused logarithmic · 40% of the track covers ×1 to ×5[^<]*extended range ×0\.25 to ×200/i);
  const defaultRatioPosition = ratioSliderPosition(
    CASCADING_PM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID)
      .settings.cascadeRatio,
  ).toFixed(4);
  const defaultRatio = CASCADING_PM_PRESETS.find(
    ({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID,
  ).settings.cascadeRatio;
  const defaultRatioLabel = defaultRatio
    .toFixed(defaultRatio < 10 ? 2 : (defaultRatio < 100 ? 1 : 0))
    .replace(/\.?0+$/, "");
  assert.match(
    html,
    new RegExp(`id="cascadeRatio"[\\s\\S]*?value="${defaultRatioPosition}"[\\s\\S]*?aria-describedby="cascadeRatioNote"`),
    "the static ratio thumb should match the default preset mapping",
  );
  assert.match(
    html,
    new RegExp(`id="cascadeRatioOut"[^>]*>×${defaultRatioLabel}<\\/output>`),
    "the default ratio should be visible before JavaScript runs",
  );
  assert.match(
    app,
    /const digits = number < 10 \? 2 : \(number < 100 \? 1 : 0\);/,
    "ratio readouts through ×100 must retain enough precision to show preset offsets",
  );
  assert.doesNotMatch(html, /center ×1|unity detent at center/i);
  assert.match(html, /below 1 descends, above 1 rises/i);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(app, /new CascadingPmAudioEngine\(window\)/);
  assert.match(app, /sᵢ = sin\(φᵢ \+ Iᵢsᵢ₋₁\)/);
  assert.match(app, /INDEX = PHASE OFFSET IN RADIANS/);
  assert.match(app, /stack\.boundedByBandwidth/);
  assert.match(app, /Safety guard active/);
  const manualInputHandler = app.match(
    /for \(const \[key, control\] of Object\.entries\(controls\)\) \{\s*control\.input\.addEventListener\("input",[\s\S]*?\n\}/,
  );
  assert.ok(manualInputHandler, "missing manual control input handler");
  assert.match(
    manualInputHandler[0],
    /if \(key === "stages"\)[\s\S]*?cascadeRatioForStageCount\([\s\S]*?\{ syncControls: true \}\);[\s\S]*?return;/,
    "stage changes should preserve the final carrier and move the ratio thumb",
  );
  const nonStageInputPath = manualInputHandler[0].slice(
    manualInputHandler[0].indexOf("return;") + "return;".length,
  );
  assert.match(nonStageInputPath, /applySettings\(\{ \.\.\.state\.settings, \[key\]: value \}\)/);
  assert.doesNotMatch(nonStageInputPath, /syncControls|writeControlsFromState/);
  assert.doesNotMatch(app, /\.connect\([^\n]*\.frequency\)/);
  assert.doesNotMatch(`${html}\n${app}`, /mod(?:ulation)? depth[^\n]*kHz/i);
  assert.match(app, /pagehide/);
  assert.match(app, /audioState[^\n]*(?:"on"|"off")/);
});
