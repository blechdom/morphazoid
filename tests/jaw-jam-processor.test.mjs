import assert from "node:assert/strict";
import test from "node:test";

import {
  JAW_HARP_DEFAULTS,
  jawHarpPreset,
  jawHarpState,
  naturalTineStrike,
} from "../src/jaw-harp.js";
import {
  jawJamStepConfiguration,
  sanitizeJawJamPattern,
} from "../src/jaw-jam.js";

const SAMPLE_RATE = 48_000;

function send(processor, message) {
  processor.port.onmessage({ data: message });
}

function render(processor, frameCount = 128) {
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  assert.equal(processor.process([], [[left, right]], {}), true);
  return { left, right };
}

function sequenceMessages(processor) {
  return processor.port.messages.filter(({ type }) => type === "sequence-step");
}

function signalRms(samples, start = 0, end = samples.length) {
  let squareSum = 0;
  for (let index = start; index < end; index += 1) {
    squareSum += samples[index] * samples[index];
  }
  return Math.sqrt(squareSum / Math.max(1, end - start));
}

test("Jaw Jam worklet adds a sample-timed queue without changing the base voice", async (t) => {
  const previousRate = globalThis.sampleRate;
  const previousCurrentFrame = globalThis.currentFrame;
  const previousCurrentTime = globalThis.currentTime;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const registrations = new Map();

  globalThis.sampleRate = SAMPLE_RATE;
  globalThis.currentFrame = 0;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      const port = {
        messages: [],
        onmessage: null,
        postMessage(message) {
          port.messages.push(message);
        },
      };
      this.port = port;
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    registrations.set(name, Constructor);
  };

  try {
    const module = await import(`../src/jaw-jam-processor.js?test=${Date.now()}`);
    const Processor = registrations.get("jaw-jam-physical-model");
    assert.equal(module.JawJamPhysicalProcessor, Processor);
    assert.ok(registrations.has("jaw-harp-physical-model"));

    await t.test("orders absolute events and applies them at exact mid-block frames", () => {
      const processor = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        dryResonance: 1,
      } } });
      const firstConfiguration = jawHarpState("khomus", {
        autoBreath: false,
        dryResonance: 1,
        reedFrequencyHz: 68,
      });
      const secondConfiguration = jawHarpState("munnharpe", {
        autoBreath: false,
        dryResonance: 1,
        reedFrequencyHz: 104,
      });

      // Deliberately enqueue the later note first.
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 2,
        when: 96 / SAMPLE_RATE,
        action: "pluck",
        configuration: secondConfiguration,
        strike: { force: 0.8, direction: -1, position: 0.4 },
      });
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 1,
        when: 32 / SAMPLE_RATE,
        action: "pluck",
        configuration: firstConfiguration,
        strike: { force: 0.7, direction: 1, position: 0.3 },
      });

      const { left } = render(processor);
      assert.ok(left.subarray(0, 32).every((sample) => sample === 0));
      assert.ok(left.subarray(32).some((sample) => Math.abs(sample) > 1e-7));
      assert.deepEqual(
        sequenceMessages(processor).map(({ stepIndex, appliedFrame, scheduledFrame }) => ({
          stepIndex,
          appliedFrame,
          scheduledFrame,
        })),
        [
          { stepIndex: 1, appliedFrame: 32, scheduledFrame: 32 },
          { stepIndex: 2, appliedFrame: 96, scheduledFrame: 96 },
        ],
      );
    });

    await t.test("supports delay fallback from the current worklet frame", () => {
      globalThis.currentFrame = 512;
      globalThis.currentTime = 512 / SAMPLE_RATE;
      const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 7,
        delaySeconds: 48 / SAMPLE_RATE,
        action: "rest",
        configuration: JAW_HARP_DEFAULTS,
      });
      render(processor, 96);
      assert.deepEqual(
        sequenceMessages(processor).map(({ stepIndex, appliedFrame, scheduledFrame }) => ({
          stepIndex,
          appliedFrame,
          scheduledFrame,
        })),
        [{ stepIndex: 7, appliedFrame: 560, scheduledFrame: 560 }],
      );
      globalThis.currentFrame = 0;
      globalThis.currentTime = 0;
    });

    await t.test("uses the authentic released-displacement pluck path with an atomic snapshot", () => {
      const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      const calls = [];
      const basePluck = processor._pluck;
      processor._pluck = function (...parameters) {
        calls.push(parameters);
        return basePluck.apply(this, parameters);
      };
      const configuration = jawHarpState("dan-moi", {
        autoBreath: false,
        reedFrequencyHz: 142,
        tonguePosition: 0.84,
        formantFocus: 1.72,
      });
      send(processor, {
        type: "sequence-event",
        generation: 3,
        stepIndex: 4,
        when: 0,
        action: "pluck",
        configuration,
        strike: { force: 1.27, direction: -1, position: 0.43 },
      });
      render(processor, 16);

      assert.equal(processor.configuration.presetId, "dan-moi");
      assert.equal(processor.configuration.reedFrequencyHz, 142);
      assert.equal(processor.configuration.tonguePosition, 0.84);
      assert.deepEqual(calls[0], [1.27, -1, 0.43, false, false, true]);
      assert.ok(processor.amplitudes.some((amplitude) => amplitude > 0));
      assert.equal(processor.silenced, false);
    });

    await t.test("sustain retargets full virtual material and pitch without erasing modal state", () => {
      const processor = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
      } } });
      // Any unrecognized sequencer message still follows the base immediate
      // protocol, which is useful for manual audition alongside the sequence.
      send(processor, {
        type: "strike-tine",
        force: 0.92,
        direction: 1,
        position: 0.31,
      });
      const amplitudesBefore = Array.from(processor.amplitudes);
      const phasesBefore = Array.from(processor.phases);
      let pluckCount = 0;
      const basePluck = processor._pluck;
      processor._pluck = function (...parameters) {
        pluckCount += 1;
        return basePluck.apply(this, parameters);
      };
      const sustainConfiguration = jawHarpState("kubing", {
        autoBreath: true,
        reedFrequencyHz: 131,
        tonguePosition: -1.4,
        tongueHeight: 2.1,
        jawOpening: 1.7,
        lipRounding: 1.3,
        formantFocus: 2.2,
        breathDepth: 1.8,
        breathRateBpm: 270,
      });
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 5,
        when: 0,
        action: "sustain",
        configuration: sustainConfiguration,
      });
      processor._applyDueSequenceEvents(0);

      assert.equal(pluckCount, 0);
      assert.deepEqual(Array.from(processor.amplitudes), amplitudesBefore);
      assert.deepEqual(Array.from(processor.phases), phasesBefore);
      assert.equal(processor.configuration.presetId, "kubing");
      assert.equal(processor.configuration.reedFrequencyHz, 131);
      assert.equal(processor.configuration.breathRateBpm, 270);
      assert.equal(processor.material, jawHarpPreset("kubing").material);
      assert.equal(processor.silenced, false);
      assert.deepEqual(
        sequenceMessages(processor).map(({ action, stepIndex }) => ({ action, stepIndex })),
        [{ action: "sustain", stepIndex: 5 }],
      );
    });

    await t.test("rest silences exactly at its frame and sustain cannot revive it", () => {
      const processor = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        dryResonance: 1,
      } } });
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 0,
        when: 0,
        action: "pluck",
        configuration: processor.configuration,
        strike: { force: 1, direction: 1, position: 0.32 },
      });
      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 1,
        when: 64 / SAMPLE_RATE,
        action: "rest",
        configuration: processor.configuration,
      });
      const { left, right } = render(processor);
      assert.ok(left.subarray(0, 64).some((sample) => Math.abs(sample) > 1e-7));
      assert.ok(left.subarray(64).every((sample) => sample === 0));
      assert.ok(right.subarray(64).every((sample) => sample === 0));
      assert.ok(processor.amplitudes.every((amplitude) => amplitude === 0));
      assert.equal(processor.energy, 0);
      assert.equal(processor.silenced, true);

      send(processor, {
        type: "sequence-event",
        generation: 1,
        stepIndex: 2,
        when: 128 / SAMPLE_RATE,
        action: "sustain",
        configuration: jawHarpState("munnharpe", { reedFrequencyHz: 110 }),
      });
      const sustainedRest = render(processor);
      assert.ok(sustainedRest.left.every((sample) => sample === 0));
      assert.equal(processor.configuration.presetId, "munnharpe");
      assert.equal(processor.silenced, true);
    });

    await t.test("new generations, drop-scheduled, and panic reject stale work", () => {
      const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      const rest = (generation, stepIndex, frame) => ({
        type: "sequence-event",
        generation,
        stepIndex,
        when: frame / SAMPLE_RATE,
        action: "rest",
        configuration: JAW_HARP_DEFAULTS,
      });
      send(processor, rest(1, 1, 32));
      send(processor, rest(1, 2, 64));
      send(processor, rest(2, 3, 48));
      render(processor);
      assert.deepEqual(
        sequenceMessages(processor).map(({ generation, stepIndex }) => ({ generation, stepIndex })),
        [{ generation: 2, stepIndex: 3 }],
      );

      send(processor, rest(1, 4, 128));
      send(processor, rest(2, 5, 160));
      send(processor, { type: "drop-scheduled", generation: 3 });
      send(processor, rest(2, 6, 128));
      send(processor, rest(3, 7, 144));
      render(processor, 64);
      assert.deepEqual(
        sequenceMessages(processor).map(({ generation, stepIndex }) => ({ generation, stepIndex })),
        [
          { generation: 2, stepIndex: 3 },
          { generation: 3, stepIndex: 7 },
        ],
      );

      send(processor, {
        type: "strike-tine", force: 1, direction: 1, position: 0.32,
      });
      assert.ok(processor.amplitudes.some((amplitude) => amplitude > 0));
      send(processor, rest(3, 8, 256));
      send(processor, { type: "panic", generation: 4 });
      assert.equal(processor.sequenceGeneration, 4);
      assert.equal(processor.sequenceQueue.length, 0);
      assert.ok(processor.amplitudes.every((amplitude) => amplitude === 0));
      assert.equal(processor.silenced, true);
    });

    await t.test("pull strength and breath power independently reach the acoustic DSP", () => {
      const configurationFor = (pluckIntensity, breathPower) => {
        const pattern = sanitizeJawJamPattern({
          stepCount: 1,
          tempo: 120,
          breathRatio: 1,
          steps: [{
            action: "pluck",
            midi: 38,
            vowelId: "a",
            soundPresetId: "khomus-open-a",
            pluckIntensity,
            breathPower,
            breathRateMultiplier: 1,
          }],
        });
        return jawJamStepConfiguration(pattern, 0);
      };
      const renderPluck = (configuration, strike, frameCount) => {
        const processor = new Processor({ processorOptions: { configuration } });
        send(processor, {
          type: "sequence-event",
          generation: 1,
          stepIndex: 0,
          when: 0,
          action: "pluck",
          configuration,
          strike,
        });
        return { processor, ...render(processor, frameCount) };
      };

      // Deterministic natural pulls prove that the step's pull control reaches
      // both the generated strike and the worklet's released-displacement
      // attack, independent of the automatic breath path.
      const lowPullConfiguration = configurationFor(0.08, 0);
      const highPullConfiguration = configurationFor(0.96, 0);
      const lowStrike = naturalTineStrike(
        lowPullConfiguration,
        { velocity: 0.08 },
        () => 0.5,
      );
      const highStrike = naturalTineStrike(
        highPullConfiguration,
        { velocity: 0.96 },
        () => 0.5,
      );
      const lowPull = renderPluck(lowPullConfiguration, lowStrike, 2_048);
      const highPull = renderPluck(highPullConfiguration, highStrike, 2_048);
      const lowAttackRms = signalRms(lowPull.left);
      const highAttackRms = signalRms(highPull.left);
      assert.ok(highStrike.force > lowStrike.force * 4);
      assert.ok(
        highAttackRms > lowAttackRms * 1.5,
        `expected pull to strengthen attack (${lowAttackRms} -> ${highAttackRms})`,
      );

      // Give both reeds the exact same mechanical strike. Any later acoustic
      // difference is therefore caused only by the breath-depth snapshot.
      const noAirConfiguration = configurationFor(0.68, 0);
      const strongAirConfiguration = configurationFor(0.68, 2.4);
      assert.equal(noAirConfiguration.pluckForce, strongAirConfiguration.pluckForce);
      const commonStrike = Object.freeze({ force: 0.72, direction: 1, position: 0.32 });
      const noAir = renderPluck(noAirConfiguration, commonStrike, 24_000);
      const strongAir = renderPluck(strongAirConfiguration, commonStrike, 24_000);
      const noAirTailRms = signalRms(noAir.left, 12_000);
      const strongAirTailRms = signalRms(strongAir.left, 12_000);
      assert.ok(
        strongAirTailRms > noAirTailRms * 1.3,
        `expected breath to energize the decay (${noAirTailRms} -> ${strongAirTailRms})`,
      );
      assert.ok(strongAir.processor.energy > noAir.processor.energy);
    });
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.currentFrame = previousCurrentFrame;
    globalThis.currentTime = previousCurrentTime;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});
