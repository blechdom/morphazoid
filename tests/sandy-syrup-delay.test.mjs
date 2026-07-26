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
  sandySyrupInitialCursor,
  sandySyrupTargetRate,
  sandySyrupVoiceGain,
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

test("Sandy retains Morphisma's fixed 2/N wet gain", () => {
  assert.equal(sandySyrupVoiceGain(1), 2);
  assert.equal(sandySyrupVoiceGain(2), 1);
  assert.equal(sandySyrupVoiceGain(8), 0.25);
  assert.equal(sandySyrupVoiceGain(12), 1 / 6);
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

test("new grains begin at the source-faithful exponential history position", () => {
  const sampleRate = 48_000;
  const write = 20 * sampleRate;
  const bufferLength = 16 * sampleRate;
  assert.equal(
    sandySyrupInitialCursor(
      write,
      4,
      0,
      4,
      sampleRate,
      bufferLength,
    ),
    write - (4 * sampleRate),
  );
  assert.equal(
    sandySyrupInitialCursor(
      write,
      4,
      1,
      4,
      sampleRate,
      bufferLength,
    ),
    write - BARBER_DELAY_LIMITS.sandyReadGuardSamples,
  );
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
    assert.ok(Number.isFinite(peak));
    assert.ok(peak < 128, `unexpected unprotected worklet peak ${peak}`);

    assert.ok(
      initialMaximumLag <= 15 * 48_000,
      `grain start moved behind its requested history: ${initialMaximumLag}`,
    );

    processor.streamInitialized.fill(1);
    processor.buffers[0][0] = 0.25;
    processor.port.onmessage({ data: { type: "reseed-sandy-grains" } });
    assert.ok(processor.streamInitialized.every((value) => value === 0));
    assert.equal(
      processor.buffers[0][0],
      0.25,
      "preset reseeding must preserve captured source history",
    );

    const robot = BARBER_DELAY_PRESETS.sandy.find(
      ({ id }) => id === "robot-grind",
    );
    processor.port.onmessage({
      data: { type: "parameters", parameters: robot.settings },
    });
    assert.equal(processor.target.speed, 1.2);
    assert.equal(processor.target.pitchOctaves, 1);
    assert.equal(processor.target.numVoices, 2);
    assert.equal(processor.target.grainSize, 0.015);
    assert.equal(processor.target.blend, 0);

    const spectrum = BARBER_DELAY_PRESETS.sandy.find(
      ({ id }) => id === "full-spectrum",
    );
    processor.port.onmessage({
      data: { type: "parameters", parameters: spectrum.settings },
    });
    assert.equal(processor.target.speed, 0.04);
    assert.equal(processor.target.pitchOctaves, 10);
    assert.equal(processor.target.numVoices, 12);
    assert.equal(processor.target.grainSize, 0.03);
    assert.equal(processor.target.blend, 0.8);

    const feedbackLatency = new Processor({
      processorOptions: {
        mode: "sandy",
        parameters: {
          numVoices: 1,
          speed: 0,
          pitchOctaves: 4,
          feedback: 0.5,
          fbDelay: 0.1,
          globalFeedback: 0,
          dryWet: 1,
          inputGain: 1,
          outputLevel: 0.5,
          grainSize: 0.05,
          blend: 0.5,
        },
      },
    });
    const feedbackInput = new Float32Array(4_929);
    feedbackInput[0] = 1;
    feedbackLatency.process(
      [[feedbackInput]],
      [[new Float32Array(4_929), new Float32Array(4_929)]],
    );
    assert.equal(feedbackLatency.buffers[0][4_800], 0);
    assert.ok(
      Math.abs(feedbackLatency.buffers[0][4_928] - 0.5) < 1e-6,
      "Sandy feedback must include Morphisma's 128-sample tap block",
    );

    const staggeredGrains = new Processor({
      processorOptions: {
        mode: "sandy",
        parameters: {
          numVoices: 8,
          speed: 0.1,
          pitchOctaves: 3,
          feedback: 0,
          fbDelay: 4,
          grainSize: 0.08,
          blend: 0,
        },
      },
    });
    staggeredGrains.process(
      [[new Float32Array(1)]],
      [[new Float32Array(1), new Float32Array(1)]],
    );
    const streamAPhases = [];
    for (let voiceIndex = 0; voiceIndex < 8; voiceIndex += 1) {
      const streamA = staggeredGrains.streamPhases[voiceIndex * 2];
      const streamB = staggeredGrains.streamPhases[(voiceIndex * 2) + 1];
      streamAPhases.push(streamA);
      assert.ok(
        Math.abs((((streamB - streamA) + 1) % 1) - 0.5) < 1e-9,
        `voice ${voiceIndex} grain streams lost their half-turn spacing`,
      );
    }
    assert.ok(
      new Set(streamAPhases.map((phase) => phase.toFixed(6))).size > 1,
      "Sandy voices must not force every grain renewal onto one clock",
    );

    const fixedGain = new Processor({
      processorOptions: {
        mode: "sandy",
        parameters: {
          numVoices: 1,
          speed: 0,
          pitchOctaves: 4,
          directionUp: true,
          tilt: 0,
          feedback: 0,
          globalFeedback: 0,
          fbDelay: 4,
          dryWet: 1,
          inputGain: 1,
          outputLevel: 1,
          grainSize: 0.05,
          blend: 0.5,
        },
      },
    });
    fixedGain.buffers[0].fill(0.75);
    fixedGain.buffers[1].fill(0.75);
    fixedGain.phase = 0.5;
    fixedGain.activeGain = 1;
    fixedGain.activeTarget = 1;
    const fixedGainOutput = new Float32Array(1);
    fixedGain.process(
      [[new Float32Array(1)]],
      [[fixedGainOutput, new Float32Array(1)]],
    );
    assert.ok(
      fixedGainOutput[0] > 1.49 && fixedGainOutput[0] < 1.51,
      `Sandy's 2/N gain or unclipped worklet path changed: ${fixedGainOutput[0]}`,
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
    frozenSweep.process(
      [[new Float32Array(128)]],
      [[new Float32Array(128), new Float32Array(128)]],
    );
    const frozenGrainPhase = frozenSweep.streamPhases[0];
    frozenSweep.process(
      [[new Float32Array(128)]],
      [[new Float32Array(128), new Float32Array(128)]],
    );
    assert.equal(frozenSweep.phase, 0);
    assert.equal(frozenSweep.streamPhases[0], frozenGrainPhase);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
