import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAOTIC_AM_DEFAULTS,
  CHAOTIC_AM_LIMITS,
  CHAOTIC_AM_PERFORMANCE_DEFAULTS,
  CHAOTIC_AM_PRESETS,
  DEFAULT_CHAOTIC_AM_PRESET_ID,
  ChaoticAmAudio,
  chaoticAmModulationDepth,
  deriveChaoticAmStack,
  sanitizeChaoticAmParams,
  saturatedChaoticAmTurnSample,
  smoothChaoticAmTurnSample,
} from "../src/instruments/chaotic-am/chaotic-am.js";
import {
  CHAOTIC_PM_DEFAULTS,
  CHAOTIC_PM_PERFORMANCE_DEFAULTS,
  CHAOTIC_PM_PRESETS,
  DEFAULT_CHAOTIC_PM_PRESET_ID,
} from "../src/instruments/chaotic-pm/chaotic-pm.js";
import { fft } from "../src/instruments/recursion/recursion-spectral-dsp.js";

const TAU = Math.PI * 2;
const RATE = 48_000;
let Processor;
const originalRegister = globalThis.registerProcessor;
globalThis.registerProcessor = (name, implementation) => {
  assert.equal(name, "morphazoid-chaotic-am");
  Processor = implementation;
};
try {
  await import("../src/instruments/chaotic-am/chaotic-am.js?test-worklet");
} finally {
  if (originalRegister === undefined) delete globalThis.registerProcessor;
  else globalThis.registerProcessor = originalRegister;
}

function configure(settings = {}, sampleRate = RATE) {
  const oldRate = globalThis.sampleRate;
  globalThis.sampleRate = sampleRate;
  let processor;
  try {
    processor = new Processor();
  } finally {
    if (oldRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = oldRate;
  }
  processor.port.onmessage({ data: {
    type: "settings",
    settings: sanitizeChaoticAmParams(settings, { sampleRate }),
    immediate: true,
  } });
  return processor;
}

function render(processor, frames = RATE / 2) {
  const rendered = new Float32Array(frames);
  for (let start = 0; start < frames; start += 128) {
    const left = rendered.subarray(start, Math.min(frames, start + 128));
    const right = new Float32Array(left.length);
    assert.equal(processor.process([], [[left, right]]), true);
    assert.deepEqual(left, right, "the original dual-mono output is preserved");
  }
  return rendered;
}

const rms = (samples) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const difference = (a, b) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0) / a.length);
function component(samples, frequency, sampleRate = RATE) {
  let real = 0;
  let imaginary = 0;
  samples.forEach((sample, i) => {
    real += sample * Math.cos(TAU * frequency * i / sampleRate);
    imaginary += sample * Math.sin(TAU * frequency * i / sampleRate);
  });
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

test("Chaotic AM preserves the calibrated PM scenes, controls and performance defaults", async () => {
  assert.equal(DEFAULT_CHAOTIC_AM_PRESET_ID, DEFAULT_CHAOTIC_PM_PRESET_ID);
  assert.equal(CHAOTIC_AM_DEFAULTS.output, CHAOTIC_PM_DEFAULTS.output);
  assert.deepEqual(CHAOTIC_AM_PERFORMANCE_DEFAULTS, CHAOTIC_PM_PERFORMANCE_DEFAULTS);
  assert.equal(new ChaoticAmAudio({}).context, null, "Audio is lazy");
  assert.deepEqual(CHAOTIC_AM_PRESETS.map(({ id, label, settings }) => ({
    id, label, settings: {
      ...settings,
      startPhaseIndex: settings.startAmplitudeIndex,
      startAmplitudeIndex: undefined,
    },
  })), CHAOTIC_PM_PRESETS.map(({ id, label, settings }) => ({
    id, label, settings: { ...settings, startAmplitudeIndex: undefined },
  })));
  const pages = await Promise.all(["pm", "am"].map((type) => readFile(
    new URL(`../src/pages/chaotic-${type}.html`, import.meta.url), "utf8",
  )));
  const inputs = (source) => [...source.matchAll(/<input\b[^>]+>/g)]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/\s(id|type|min|max|step|value)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value.replace("phaseIndex", "amplitudeIndex").replace("phaseWarp", "amplitudeWarp")])));
  assert.deepEqual(inputs(pages[1]), inputs(pages[0]), "only synthesis labels and identities change the interface");
});

test("AM retains its carrier and creates the expected sum/difference sidebands", () => {
  const index = 4;
  const depth = chaoticAmModulationDepth(index);
  const am = Float64Array.from({ length: RATE }, (_, frame) => smoothChaoticAmTurnSample(
    Math.sin(TAU * 300 * frame / RATE), 2_000 * frame / RATE, 2_000, index, 0,
  ));
  const ring = Float64Array.from({ length: RATE }, (_, frame) => (
    Math.sin(TAU * 300 * frame / RATE) * Math.sin(TAU * 2_000 * frame / RATE)
  ));
  assert.ok(Math.abs(component(am, 2_000) - 1 / (1 + depth)) < 1e-10);
  for (const frequency of [1_700, 2_300]) {
    assert.ok(Math.abs(component(am, frequency) - depth / (2 * (1 + depth))) < 1e-10);
  }
  assert.ok(component(ring, 2_000) < 1e-10, "the reference ring modulator suppresses its carrier");
  assert.ok(component(am, 2_000) > 0.5, "AM keeps the carrier at the same frequency");
});

test("nonlinear AM remains non-inverting, bounded and carrier-pure at zero index", () => {
  for (const turn of [smoothChaoticAmTurnSample, saturatedChaoticAmTurnSample]) {
    for (const index of [0, 0.001, 0.5, 6.66, 64, 1e99, NaN, Infinity]) {
      for (const chaos of [0, 0.5, 1, -1, Infinity, NaN]) {
        for (let frame = 1; frame < 160; frame += 1) {
          const phase = frame / 160;
          const carrier = Math.sin(TAU * phase);
          const sample = turn(Math.sin(frame), phase, 400, index, chaos);
          assert.ok(Number.isFinite(sample));
          assert.ok(Math.abs(sample) <= Math.abs(carrier) + 1e-12);
          assert.ok(sample * carrier >= -1e-12, "the AM gain never reverses the carrier");
          if (index === 0) assert.ok(Math.abs(sample - carrier) < 1e-12);
        }
      }
    }
    assert.ok(Number.isFinite(turn(NaN, Infinity, NaN, Infinity, NaN)));
  }
});

test("every factory scene and hostile extremes render finite bounded audio at common sample rates", () => {
  const extreme = {
    depth: 10, carrierHz: 1_200, startModFrequencyHz: 400,
    frequencyDivisor: 0.001, startAmplitudeIndex: 64, indexDivisor: 0.001, nonlinearity: 1,
  };
  for (const sampleRate of [8_000, 44_100, 48_000, 96_000, 192_000]) {
    for (const settings of [...CHAOTIC_AM_PRESETS.map((preset) => preset.settings), extreme]) {
      for (const transferMode of ["smooth", "saturated"]) {
        const stack = deriveChaoticAmStack({ ...settings, transferMode }, { sampleRate });
        assert.ok(stack.actualDepth <= CHAOTIC_AM_LIMITS.maxDepth);
        assert.ok(stack.operators.every((operator) => operator.frequencyHz <= sampleRate * 0.45));
        const output = render(configure({ ...settings, transferMode }, sampleRate), Math.round(sampleRate / 8));
        assert.ok(output.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1.000001));
        assert.ok(rms(output) > 0.02, `${settings.carrierHz} Hz / ${transferMode} unexpectedly silent`);
      }
    }
  }
});

test("all preserved presets have substantial spectral energy in the audible band", () => {
  for (const { id, settings } of CHAOTIC_AM_PRESETS) {
    for (const transferMode of ["smooth", "saturated"]) {
      const stack = deriveChaoticAmStack({ ...settings, transferMode });
      assert.ok(stack.operators[stack.audibleIndex].frequencyHz >= 40, id);
      const processor = configure({ ...settings, transferMode });
      render(processor, 12_000);
      const output = render(processor, 4_096);
      const windowed = Float64Array.from(output, (sample, frame) => (
        sample * (0.5 - 0.5 * Math.cos(TAU * frame / (output.length - 1)))
      ));
      const spectrum = fft(windowed);
      let audiblePower = 0;
      let totalPower = spectrum.real[0] ** 2 + spectrum.imag[0] ** 2;
      for (let bin = 1; bin < output.length / 2; bin += 1) {
        const power = 2 * (spectrum.real[bin] ** 2 + spectrum.imag[bin] ** 2);
        const frequency = bin * RATE / output.length;
        totalPower += power;
        if (frequency >= 20 && frequency <= 20_000) audiblePower += power;
      }
      const audibleFraction = audiblePower / totalPower;
      // Hann mean-square is 3/8. Parseval converts in-band power back to RMS.
      const audibleRms = Math.sqrt(audiblePower / (output.length ** 2 * 0.375));
      assert.ok(audibleFraction > 0.75, `${id}/${transferMode}: ${audibleFraction} audible power`);
      assert.ok(audibleRms > 0.1, `${id}/${transferMode}: ${audibleRms} audible RMS`);
    }
  }
});

test("worklet matches the pure AM transfer and modulation never alters oscillator phases", () => {
  const settings = {
    depth: 4, carrierHz: 173, startModFrequencyHz: 293,
    frequencyDivisor: 1.4, startAmplitudeIndex: 3.2, indexDivisor: 1.2, nonlinearity: 0.72,
  };
  const reference = configure({ ...settings, startAmplitudeIndex: 0, nonlinearity: 0 });
  render(reference, 2_048);
  for (const transferMode of ["smooth", "saturated"]) {
    const processor = configure({ ...settings, transferMode });
    const output = render(processor, 2_048);
    const phases = new Float64Array(settings.depth + 1);
    const stack = deriveChaoticAmStack(settings);
    const turn = transferMode === "smooth" ? smoothChaoticAmTurnSample : saturatedChaoticAmTurnSample;
    output.forEach((sample, frame) => {
      let expected = 0;
      for (const operator of stack.operators) {
        phases[operator.index] = (phases[operator.index] + operator.frequencyHz / RATE) % 1;
        expected = operator.index === 0
          ? Math.sin(TAU * phases[0])
          : turn(expected, phases[operator.index], operator.frequencyHz, operator.amplitudeIndex, settings.nonlinearity);
      }
      assert.ok(Math.abs(sample - expected) < 1e-7, `${transferMode} diverged at frame ${frame}`);
    });
    assert.equal(processor.carrierPhase, reference.carrierPhase);
    assert.deepEqual(processor.operatorPhases, reference.operatorPhases);
  }
});

test("every retained synthesis control changes the sound and live edits preserve phase", () => {
  const settings = {
    depth: 3, carrierHz: 137, startModFrequencyHz: 311,
    frequencyDivisor: 1.3, startAmplitudeIndex: 3, indexDivisor: 1.2, nonlinearity: 0.65,
  };
  const baseline = render(configure(settings));
  for (const [key, value] of Object.entries({
    depth: 1, carrierHz: 227, startModFrequencyHz: 179,
    frequencyDivisor: 1.8, startAmplitudeIndex: 0, indexDivisor: 3,
    nonlinearity: 0, transferMode: "saturated",
  })) {
    assert.ok(difference(baseline, render(configure({ ...settings, [key]: value }))) > 0.001, key);
  }
  const changed = configure(settings);
  const unchanged = configure(settings);
  render(changed, 257);
  render(unchanged, 257);
  const oldPhase = changed.carrierPhase;
  changed.port.onmessage({ data: { type: "settings", settings: {
    ...sanitizeChaoticAmParams(settings), depth: 7, startAmplitudeIndex: 64,
    nonlinearity: 1, transferMode: "saturated",
  } } });
  assert.equal(changed.carrierPhase, oldPhase);
  const transitioning = render(changed, 2_048);
  render(unchanged, 2_048);
  assert.equal(changed.carrierPhase, unchanged.carrierPhase);
  assert.deepEqual(changed.operatorPhases, unchanged.operatorPhases);
  assert.ok(transitioning.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1));
  let largestJump = 0;
  for (let i = 1; i < transitioning.length; i += 1) largestJump = Math.max(largestJump, Math.abs(transitioning[i] - transitioning[i - 1]));
  assert.ok(largestJump < 0.1, `live shape/depth edit jumped ${largestJump}`);
});

test("MIDI gate, note ownership, sustain, release and shutdown retain the PM lifecycle", () => {
  const processor = configure();
  processor.setPerformance({ playMode: "midi", ampAttackMs: 8, ampReleaseMs: 20 });
  render(processor, 4_800);
  assert.equal(rms(render(processor, 128)), 0);
  processor.noteOn(60, 100, 0, "keyboard");
  assert.ok(rms(render(processor, 4_800)) > 0.03);
  processor.noteOn(60, 90, 0, "controller");
  processor.noteOff(60, 0, "keyboard");
  assert.equal(processor.noteHeld[60], 1);
  processor.setSustain(true);
  processor.noteOff(60, 0, "controller");
  assert.ok(rms(render(processor, 4_800)) > 0.03);
  processor.setSustain(false);
  render(processor, 4_800);
  assert.equal(rms(render(processor, 128)), 0);
  processor.noteOn(67, 127);
  assert.ok(rms(render(processor, 2_048)) > 0.03);
  processor.allNotesOff(true);
  render(processor, 4_800);
  assert.equal(rms(render(processor, 128)), 0);
  processor.port.onmessage({ data: { type: "shutdown" } });
  assert.equal(processor.process([], [[new Float32Array(128)]]), false);
});
