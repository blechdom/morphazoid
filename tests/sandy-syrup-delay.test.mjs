import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  BARBER_DELAY_DEFAULTS,
  BARBER_DELAY_LIMITS,
  BARBER_DELAY_PRESETS,
  BARBER_DELAY_PROCESSOR_NAME,
  clampSandySyrupCursor,
  integrateSandySyrupCursor,
  sandySyrupBaseDelay,
  sandySyrupComplementaryHann,
  sandySyrupEffectiveRate,
  sandySyrupHann,
  sandySyrupTargetRate,
  sandySyrupWetNormalizationGain,
  sanitizeBarberDelayMode,
  sanitizeBarberDelayParams,
} from "../src/barber-delay.js";

test("Sandy Syrup preserves its centered rate and exponential history vectors", () => {
  assert.deepEqual(
    [0, 0.5, 1].map((phase) => sandySyrupTargetRate(4, phase, true)),
    [0.25, 1, 4],
  );
  assert.deepEqual(
    [0, 0.5, 1].map((phase) => sandySyrupTargetRate(4, phase, false)),
    [4, 1, 0.25],
  );
  const positions = [0, 0.5, 1].map(
    (phase) => sandySyrupBaseDelay(4, phase, 4),
  );
  assert.equal(positions[0], 4);
  assert.ok(Math.abs(positions[1] - 0.8) < 1e-12);
  assert.equal(positions[2], 0);
});

test("paired grain Hann windows are complementary across their full turn", () => {
  for (let index = 0; index <= 1_000; index += 1) {
    const phase = index / 1_001;
    const windows = sandySyrupComplementaryHann(phase);
    assert.ok(windows.primary >= 0 && windows.primary <= 1);
    assert.ok(windows.secondary >= 0 && windows.secondary <= 1);
    assert.ok(Math.abs(windows.total - 1) < 1e-12);
    assert.equal(windows.primary, sandySyrupHann(phase));
  }
});

test("wet normalization preserves a one-voice Hann fade at the sweep seam", () => {
  assert.equal(0 * sandySyrupWetNormalizationGain(0), 0);
  assert.equal(0.25 * sandySyrupWetNormalizationGain(0.25), 0.5);
  assert.equal(0.5 * sandySyrupWetNormalizationGain(0.5), 1);
  assert.equal(1 * sandySyrupWetNormalizationGain(1), 1);
});

test("Sand holds grain rate, Syrup follows it, and cursor integration is absolute", () => {
  assert.equal(sandySyrupEffectiveRate(2, 6, 0), 2);
  assert.equal(sandySyrupEffectiveRate(2, 6, 0.5), 4);
  assert.equal(sandySyrupEffectiveRate(2, 6, 1), 6);
  assert.equal(integrateSandySyrupCursor(1_000, 2, 6, 0), 1_002);
  assert.equal(integrateSandySyrupCursor(1_000, 2, 6, 0.5), 1_004);
  assert.equal(integrateSandySyrupCursor(1_000, 2, 6, 1), 1_006);

  assert.equal(clampSandySyrupCursor(10_000, 1_000, 800, 4), 996);
  assert.equal(clampSandySyrupCursor(-10_000, 1_000, 800, 4), 202);
});

test("all 12 exact Sandy Syrup presets survive safe parameter bounds", () => {
  assert.equal(sanitizeBarberDelayMode("sandy"), "sandy");
  assert.deepEqual(BARBER_DELAY_DEFAULTS.sandy, {
    numVoices: 8,
    speed: 0.05,
    pitchOctaves: 4,
    directionUp: true,
    tilt: 0,
    feedback: 0,
    fbDelay: 4,
    globalFeedback: 0,
    dryWet: 0.8,
    inputGain: 1,
    outputLevel: 0.5,
    grainSize: 0.05,
    blend: 0.5,
  });
  const bank = BARBER_DELAY_PRESETS.sandy;
  assert.equal(bank.length, 12);
  assert.deepEqual(bank.map(({ label }) => label), [
    "Silk Rise",
    "Silk Fall",
    "Pure Grit",
    "Pure Syrup",
    "Glacial Drift",
    "Robot Grind",
    "Grain Cloud",
    "Silk Glide",
    "Metal Shimmer",
    "Feedback Drone",
    "Full Spectrum",
    "Gentle Blend",
  ]);
  assert.equal(bank.find(({ id }) => id === "glacial-drift").settings.fbDelay, 12);
  assert.equal(bank.find(({ id }) => id === "full-spectrum").settings.pitchOctaves, 10);
  assert.equal(bank.find(({ id }) => id === "pure-grit").settings.blend, 0);
  assert.equal(bank.find(({ id }) => id === "pure-syrup").settings.blend, 1);

  const bounded = sanitizeBarberDelayParams({
    speed: Infinity,
    pitchOctaves: 200,
    fbDelay: 200,
    grainSize: 50,
    blend: -4,
    feedback: 20,
    globalFeedback: 20,
  }, "sandy");
  assert.equal(bounded.speed, BARBER_DELAY_DEFAULTS.sandy.speed);
  assert.equal(
    bounded.pitchOctaves,
    BARBER_DELAY_LIMITS.maximumPitchOctaves,
  );
  assert.equal(bounded.fbDelay, BARBER_DELAY_LIMITS.maximumSandyHistory);
  assert.equal(bounded.grainSize, BARBER_DELAY_LIMITS.maximumGrainSize);
  assert.equal(bounded.blend, 0);
  assert.ok(
    bounded.feedback + bounded.globalFeedback
    <= BARBER_DELAY_LIMITS.maximumFeedback,
  );
});

test("Sandy worklet preallocates 24 streams, reserves traversal, and renders finite", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  let registeredName = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (name, ProcessorConstructor) => {
    registeredName = name;
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/barber-delay.js?sandy-worklet=${Date.now()}`);
    assert.equal(registeredName, BARBER_DELAY_PROCESSOR_NAME);
    const processor = new Processor({
      processorOptions: {
        mode: "sandy",
        parameters: {
          numVoices: 12,
          speed: 5,
          pitchOctaves: 10,
          feedback: 0.95,
          globalFeedback: 0.5,
          fbDelay: 15,
          dryWet: 1,
          inputGain: 2,
          outputLevel: 1,
          grainSize: 0.5,
          blend: 1,
        },
      },
    });
    assert.equal(processor.mode, "sandy");
    assert.equal(processor.buffers.length, 2);
    assert.equal(processor.streamCursors.length, 24);
    assert.equal(processor.streamPhases.length, 24);
    assert.equal(processor.streamHeldRates.length, 24);
    assert.equal(processor.streamInitialized.length, 24);
    assert.equal(processor.bufferLength, 16 * 48_000);

    processor.port.onmessage({ data: { type: "active", value: true } });
    const startedAt = performance.now();
    let phase = 0;
    let peak = 0;
    let initialMaximumLag = 0;
    for (let block = 0; block < 320; block += 1) {
      const input = new Float32Array(128);
      for (let index = 0; index < input.length; index += 1) {
        phase += (Math.PI * 2 * 173) / 48_000;
        input[index] = Math.sin(phase) * 0.32;
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([[input]], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
      }
      const oldest = (
        processor.absoluteWriteIndex - (processor.bufferLength - 2)
      );
      const newest = (
        processor.absoluteWriteIndex
        - BARBER_DELAY_LIMITS.sandyReadGuardSamples
      );
      for (let index = 0; index < 24; index += 1) {
        if (!processor.streamInitialized[index]) continue;
        assert.ok(processor.streamCursors[index] >= oldest - 1e-9);
        assert.ok(processor.streamCursors[index] <= newest + 1e-9);
      }
      if (block === 0) {
        initialMaximumLag = Math.max(
          ...processor.streamCursors.map(
            (cursor) => processor.absoluteWriteIndex - cursor,
          ),
        );
      }
    }
    const elapsed = performance.now() - startedAt;
    assert.ok(elapsed < 2_500, `extreme Sandy render took ${elapsed.toFixed(1)} ms`);
    assert.ok(peak <= 0.981);

    assert.ok(
      initialMaximumLag > 15.4 * 48_000,
      `high-rate grain did not reserve traversal history: ${initialMaximumLag}`,
    );

    const frozenSweep = new Processor({
      processorOptions: {
        mode: "sandy",
        parameters: {
          speed: 0,
          pitchOctaves: 4,
          fbDelay: 4,
          grainSize: 0.05,
          blend: 0,
        },
      },
    });
    const initialGrainPhase = frozenSweep.streamPhases[0];
    frozenSweep.process(
      [[new Float32Array(128)]],
      [[new Float32Array(128), new Float32Array(128)]],
    );
    assert.equal(frozenSweep.phase, 0);
    assert.ok(frozenSweep.streamPhases[0] > initialGrainPhase);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
