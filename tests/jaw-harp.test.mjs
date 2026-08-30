import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_LIMITS,
  JAW_HARP_MODE_COUNT,
  JAW_HARP_PRESETS,
  JAW_HARP_RANDOM_LIMITS,
  JAW_HARP_RHYTHMS,
  MAX_TINE_PULL,
  VOWEL_PRESETS,
  applyVowel,
  breathCycleFlow,
  breathCycleIntervalMs,
  dominantHarmonic,
  effectiveBreathRateBpm,
  jawHarpState,
  jawHarpRhythmHit,
  jawHarpRhythmLoopMs,
  linkedBreathIntervalMs,
  mouthFormants,
  mouthGeometry,
  pluckForceFromPull,
  randomizeJawHarpState,
  reedMaterialProperties,
  reedModeFrequencies,
  repeatIntervalMs,
  sanitizeJawHarpState,
  tineDisplayFrequencyHz,
  tineReleaseMotion,
} from "../src/jaw-harp.js";

const root = new URL("../", import.meta.url);

test("jaw-harp presets describe distinct physical reeds", () => {
  assert.equal(JAW_HARP_PRESETS.length, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ id }) => id)).size, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ settings }) => settings.reedFrequencyHz)).size, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ material }) => JSON.stringify(material))).size, 5);
  for (const preset of JAW_HARP_PRESETS) {
    const state = jawHarpState(preset.id);
    assert.equal(state.presetId, preset.id);
    assert.ok(state.reedFrequencyHz >= 38 && state.reedFrequencyHz <= 180);
    assert.ok(state.reedDecaySeconds >= 0.35 && state.reedDecaySeconds <= 8);
    assert.ok(preset.material.youngsModulusGPa > 0);
    assert.ok(preset.material.densityKgM3 > 0);
    assert.ok(preset.material.internalLossFactor > 0);
    assert.ok(preset.material.elasticLimitStrain > 0);
  }
});

test("spring steel and bamboo material models preserve their measured contrast", () => {
  const steel = reedMaterialProperties("khomus");
  const bamboo = reedMaterialProperties("kubing");
  assert.equal(steel.youngsModulusPa, 200e9);
  assert.equal(steel.densityKgM3, 7_800);
  assert.equal(bamboo.youngsModulusPa, 10.6e9);
  assert.equal(bamboo.densityKgM3, 630);
  assert.ok(steel.waveSpeedMps > bamboo.waveSpeedMps);
  assert.ok(bamboo.internalLossFactor >= steel.internalLossFactor * 100);
  assert.ok(steel.intrinsicCycleRetention > bamboo.intrinsicCycleRetention);
  assert.ok(jawHarpState("kubing").reedDecaySeconds >= 0.45);
  assert.ok(jawHarpState("kubing").reedDecaySeconds <= 0.75);
});

test("time-expanded tine motion keeps powerful second and third rebounds", () => {
  const steelState = jawHarpState("khomus");
  const bambooState = jawHarpState("kubing");
  const steelPeriod = 1 / tineDisplayFrequencyHz(steelState);
  const bambooPeriod = 1 / tineDisplayFrequencyHz(bambooState);
  const steelPeaks = [0, 1, 2].map((cycle) => Math.abs(
    tineReleaseMotion(steelState, cycle * steelPeriod, 1, 1),
  ));
  const bambooPeaks = [0, 1, 2].map((cycle) => Math.abs(
    tineReleaseMotion(bambooState, cycle * bambooPeriod, 1, 1),
  ));
  assert.ok(steelPeaks[1] > steelPeaks[0] * 0.98);
  assert.ok(steelPeaks[2] > steelPeaks[0] * 0.97);
  assert.ok(bambooPeaks[1] > bambooPeaks[0] * 0.9);
  assert.ok(bambooPeaks[2] > bambooPeaks[0] * 0.88);
  assert.ok(steelPeaks[2] / steelPeaks[0] > bambooPeaks[2] / bambooPeaks[0]);
  assert.ok(Math.abs(tineReleaseMotion(steelState, 8 * steelPeriod, 1, 1)) < steelPeaks[0] * 0.01);
  assert.equal(
    tineReleaseMotion(steelState, 0, 1, -1),
    -tineReleaseMotion(steelState, 0, 1, 1),
  );
  assert.ok(
    Math.abs(tineReleaseMotion(steelState, 0, 4, 1))
      > Math.abs(tineReleaseMotion(steelState, 0, 0.05, 1)) * 8,
  );
});

test("vowel postures move formants without moving the reed fundamental", () => {
  const starting = jawHarpState("khomus");
  const results = VOWEL_PRESETS.map(({ id }) => applyVowel(starting, id));
  assert.deepEqual(results.map(({ reedFrequencyHz }) => reedFrequencyHz), Array(5).fill(74));
  assert.equal(new Set(results.map((state) => Math.round(mouthFormants(state).focusFrequencyHz))).size, 5);
  assert.ok(dominantHarmonic(results[2]).index > dominantHarmonic(results[4]).index);
});

test("human vowels and impossible mouth corners remain finite and ordered", () => {
  for (const vowel of VOWEL_PRESETS) {
    const state = applyVowel(JAW_HARP_DEFAULTS, vowel.id);
    const geometry = mouthGeometry(state);
    const formants = mouthFormants(state);
    assert.ok(geometry.lengthM >= 0.085 && geometry.lengthM <= 0.235);
    assert.ok(geometry.volumeMl >= 24 && geometry.volumeMl <= 170);
    assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
    assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
  }
  for (const tonguePosition of JAW_HARP_LIMITS.tonguePosition) {
    for (const tongueHeight of JAW_HARP_LIMITS.tongueHeight) {
      for (const jawOpening of JAW_HARP_LIMITS.jawOpening) {
        for (const lipRounding of JAW_HARP_LIMITS.lipRounding) {
          for (const glottisOpening of JAW_HARP_LIMITS.glottisOpening) {
            const state = sanitizeJawHarpState({
              ...JAW_HARP_DEFAULTS,
              tonguePosition,
              tongueHeight,
              jawOpening,
              lipRounding,
              glottisOpening,
            });
            const geometry = mouthGeometry(state);
            const formants = mouthFormants(state);
            assert.ok(Object.values(geometry).every(Number.isFinite));
            assert.ok([...formants.frequenciesHz, ...formants.bandwidthsHz, formants.focusFrequencyHz]
              .every(Number.isFinite));
            assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
            assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
            assert.ok(formants.focusFrequencyHz >= 30 && formants.focusFrequencyHz <= 9_400);
          }
        }
      }
    }
  }
});

test("reed modes form a slightly stretched harmonic ladder", () => {
  const state = jawHarpState("munnharpe");
  const modes = reedModeFrequencies(state, 24);
  assert.equal(modes.length, 24);
  assert.ok(modes.every((frequency, index) => index === 0 || frequency > modes[index - 1]));
  assert.ok(modes[23] > modes[0] * 24);
});

test("state sanitization and deterministic randomization stay bounded and refresh performance state", () => {
  const unsafe = sanitizeJawHarpState({
    reedFrequencyHz: Infinity,
    tonguePosition: -4,
    tongueHeight: 9,
    repeatRateBpm: 9999,
    pluckDirection: -7,
  });
  assert.equal(unsafe.tonguePosition, -2);
  assert.equal(unsafe.tongueHeight, 3);
  assert.equal(unsafe.repeatRateBpm, 480);
  assert.equal(unsafe.pluckDirection, -1);
  const randomized = randomizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    presetId: "khomus",
    vowelId: "a",
    rhythmId: "quarter-eighths",
    repeat: true,
    autoBreath: false,
    breathLinked: true,
    breathsPerLoop: 16,
    pluckDirection: -1,
  }, () => 0.5);
  assert.ok(Math.abs(
    randomized.reedFrequencyHz
      - JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0]
        * ((JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[1]
          / JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0]) ** (0.5 ** 1.1)),
  ) < 1e-9);
  assert.ok(Math.abs(randomized.tonguePosition - 0.5) < 1e-12);
  assert.ok(
    randomized.cavityCoupling >= JAW_HARP_RANDOM_LIMITS.cavityCoupling[0]
    && randomized.cavityCoupling <= JAW_HARP_RANDOM_LIMITS.cavityCoupling[1]
  );
  assert.equal(randomized.presetId, "marranzanu");
  assert.equal(randomized.vowelId, "i");
  assert.equal(randomized.rhythmId, "two-one");
  assert.equal(randomized.repeat, false);
  assert.equal(randomized.autoBreath, true);
  assert.equal(randomized.breathLinked, false);
  assert.equal(randomized.breathsPerLoop, 1);
  assert.equal(randomized.pluckDirection, 1);
  assert.equal(randomized.breathFlow, 0);
});

test("randomization favors playable tempos while preserving rare extremes", () => {
  const tempos = Array.from({ length: 1_000 }, (_, index) => (
    randomizeJawHarpState(JAW_HARP_DEFAULTS, () => (index + 0.5) / 1_000).repeatRateBpm
  ));
  assert.ok(tempos[499] < 90, `median random tempo was ${tempos[499]}`);
  assert.ok(tempos.filter((tempo) => tempo > 320).length < 110);
  assert.ok(tempos.filter((tempo) => tempo > 400).length < 50);
  assert.equal(randomizeJawHarpState(JAW_HARP_DEFAULTS, () => 0).repeatRateBpm, 36);
  assert.equal(randomizeJawHarpState(JAW_HARP_DEFAULTS, () => 1).repeatRateBpm, 480);

  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const states = Array.from(
    { length: 5_000 },
    () => randomizeJawHarpState(JAW_HARP_DEFAULTS, random),
  );
  const repeatShare = states.filter(({ repeat }) => repeat).length / states.length;
  const drillShare = states.filter(({ repeat, repeatRateBpm }) => (
    repeat && repeatRateBpm > 320
  )).length / states.length;
  const denseRhythmShare = states.filter(({ rhythmId }) => rhythmId === "quarter-eighths").length
    / states.length;
  assert.ok(repeatShare > 0.19 && repeatShare < 0.25, `repeat share was ${repeatShare}`);
  assert.ok(drillShare < 0.03, `fast recurring share was ${drillShare}`);
  assert.ok(denseRhythmShare < 0.1, `dense rhythm share was ${denseRhythmShare}`);

  const inside = (value, limits) => value >= limits[0] && value <= limits[1];
  for (const state of states) {
    for (const key of [
      "reedFrequencyHz",
      "reedDecaySeconds",
      "reedStiffness",
      "pluckForce",
      "pluckPosition",
      "cavityCoupling",
      "frameCoupling",
      "breathDepth",
      "breathRateBpm",
      "breathBalance",
      "formantFocus",
    ]) assert.ok(inside(state[key], JAW_HARP_RANDOM_LIMITS[key]), `${key} escaped its playable random window`);
    for (const key of ["tonguePosition", "tongueHeight", "jawOpening", "lipRounding"]) {
      assert.ok(inside(state[key], JAW_HARP_RANDOM_LIMITS.mouthArticulation));
    }
    assert.ok(inside(state.glottisOpening, JAW_HARP_RANDOM_LIMITS.glottisOpening));
    assert.ok(inside(
      state.dryResonance,
      state.autoBreath
        ? JAW_HARP_RANDOM_LIMITS.dryResonance
        : JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath,
    ));
    if (state.breathLinked) {
      assert.ok(inside(
        effectiveBreathRateBpm(state),
        JAW_HARP_RANDOM_LIMITS.effectiveBreathRateBpm,
      ));
    }
  }
});

test("pull distance maps symmetrically across a much wider attack range", () => {
  const pulls = [0.02, 0.08, 0.25, 0.7, 1.4, MAX_TINE_PULL];
  const forces = pulls.map((pull) => pluckForceFromPull(pull, 0.72));
  assert.ok(forces.every((force, index) => index === 0 || force > forces[index - 1]));
  assert.equal(pluckForceFromPull(0), 0);
  assert.equal(pluckForceFromPull(-1.4, 0.72), pluckForceFromPull(1.4, 0.72));
  assert.ok(forces[0] < 0.01);
  assert.ok(forces.at(-1) > 1.8);
  assert.ok(pluckForceFromPull(MAX_TINE_PULL, 4) > 3.9);
});

test("swing preserves each two-pluck pair duration", () => {
  const straight = repeatIntervalMs(120, 0, 0);
  const long = repeatIntervalMs(120, 0, 0.3);
  const short = repeatIntervalMs(120, 1, 0.3);
  assert.equal(straight, 500);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-9);
});

test("jaw-harp repeats use accented loops and phase-linked breath ratios", () => {
  assert.equal(JAW_HARP_RHYTHMS.length, 6);
  assert.deepEqual(JAW_HARP_RHYTHMS[0].steps, [1, 0, 0.82, 0.72]);
  const state = jawHarpState("khomus", {
    rhythmId: "quarter-eighths",
    repeatRateBpm: 120,
    breathsPerLoop: 1,
  });
  assert.equal(jawHarpRhythmLoopMs(state), 1_000);
  assert.equal(linkedBreathIntervalMs(state), 1_000);
  assert.equal(linkedBreathIntervalMs({ ...state, breathsPerLoop: 2 }), 500);
  assert.deepEqual(jawHarpRhythmHit(state, 0), { index: 0, velocity: 1, active: true });
  assert.deepEqual(jawHarpRhythmHit(state, 1), { index: 1, velocity: 0, active: false });
  assert.ok(Math.abs(effectiveBreathRateBpm(state) - 60) < 1e-9);
  assert.ok(Math.abs(effectiveBreathRateBpm({ ...state, breathRateBpm: 84 }) - 120) < 1e-9);
  assert.equal(effectiveBreathRateBpm({ ...state, breathLinked: false, breathRateBpm: 84 }), 84);
});

test("automatic breath is a bounded signed inhale-exhale cycle", () => {
  const state = sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    breathDepth: 0.8,
    breathBalance: 0.4,
    breathRateBpm: 30,
  });
  assert.equal(breathCycleIntervalMs(state.breathRateBpm), 2_000);
  assert.ok(breathCycleFlow(state, 0.2) < -0.79);
  assert.ok(breathCycleFlow(state, 0.7) > 0.79);
  assert.ok(Math.abs(breathCycleFlow(state, 0)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, 1)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, -0.3)) <= state.breathDepth);
  assert.equal(breathCycleIntervalMs(JAW_HARP_LIMITS.breathRateBpm[1]), 50);
  const extreme = sanitizeJawHarpState({
    ...state,
    breathDepth: 3,
    breathBalance: 0.02,
    breathRateBpm: 1_200,
  });
  assert.ok(breathCycleFlow(extreme, 0.01) < -2.99);
  assert.ok(breathCycleFlow(extreme, 0.51) > 2.99);
});

test("jaw-harp worklet renders a bounded, decaying pluck", async () => {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  let telemetry;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage: (message) => { telemetry = message; } };
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    assert.equal(name, "jaw-harp-physical-model");
    Processor = Constructor;
  };
  try {
    await import(`../src/jaw-harp-processor.js?test=${Date.now()}`);
    const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
    processor._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    let squareSum = 0;
    let peak = 0;
    for (let block = 0; block < 200; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (const sample of left) {
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    const rms = Math.sqrt(squareSum / (200 * 128));
    assert.ok(rms > 0.0002 && rms < 0.4);
    assert.ok(peak > 0.001 && peak < 0.95);
    assert.equal(telemetry.type, "telemetry");
    assert.ok(telemetry.energy > 0);

    const renderBreath = (flow) => {
      const voiced = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      voiced._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      voiced._handleMessage({ type: "breath", flow });
      let lateSquareSum = 0;
      let lateSamples = 0;
      let latePeak = 0;
      for (let block = 0; block < 700; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        voiced.process([], [[left, right]]);
        if (block < 500) continue;
        for (const sample of left) {
          lateSquareSum += sample * sample;
          latePeak = Math.max(latePeak, Math.abs(sample));
          lateSamples += 1;
        }
      }
      return { rms: Math.sqrt(lateSquareSum / lateSamples), peak: latePeak };
    };
    const unbreathed = renderBreath(0);
    const inhaled = renderBreath(-0.78);
    const exhaled = renderBreath(0.78);
    assert.ok(inhaled.rms > unbreathed.rms * 2);
    assert.ok(exhaled.rms > unbreathed.rms * 2);
    assert.ok(Math.abs(exhaled.rms - inhaled.rms) > 0.001);
    assert.ok(inhaled.peak < 0.98 && exhaled.peak < 0.98);

    const renderVoice = (configuration, {
      force = 0.72,
      flow = 0.9,
      blocks = 90,
    } = {}) => {
      const voice = new Processor({
        processorOptions: {
          configuration: sanitizeJawHarpState({
            ...JAW_HARP_DEFAULTS,
            autoBreath: false,
            ...configuration,
          }),
        },
      });
      voice._handleMessage({ type: "breath", flow, manual: true });
      voice._handleMessage({ type: "pluck", force, direction: 1, position: 0.32 });
      return renderProcessor(voice, blocks);
    };
    const renderProcessor = (voice, blocks = 90) => {
      const rendered = new Float32Array(blocks * 128);
      let offset = 0;
      for (let block = 0; block < blocks; block += 1) {
        const left = rendered.subarray(offset, offset + 128);
        const right = new Float32Array(128);
        voice.process([], [[left, right]]);
        offset += 128;
      }
      return rendered;
    };
    const normalizedDifference = (left, right) => {
      let delta = 0;
      let energy = 0;
      for (let index = 0; index < left.length; index += 1) {
        delta += (left[index] - right[index]) ** 2;
        energy += left[index] ** 2 + right[index] ** 2;
      }
      return Math.sqrt(delta / Math.max(1e-12, energy));
    };
    const rmsOf = (samples, length = samples.length) => {
      let energy = 0;
      for (let index = 0; index < length; index += 1) energy += samples[index] ** 2;
      return Math.sqrt(energy / Math.max(1, length));
    };
    const randomizedAuditionState = jawHarpState("kubing", {
      autoBreath: false,
      dryResonance: JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath[0],
      reedFrequencyHz: JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0],
      cavityCoupling: JAW_HARP_RANDOM_LIMITS.cavityCoupling[1],
      frameCoupling: JAW_HARP_RANDOM_LIMITS.frameCoupling[0],
      pluckForce: JAW_HARP_RANDOM_LIMITS.pluckForce[0],
    });
    const randomizedAuditionVoice = new Processor({
      processorOptions: { configuration: jawHarpState("khomus") },
    });
    randomizedAuditionVoice._handleMessage({ type: "silence" });
    randomizedAuditionVoice._handleMessage({
      type: "configure",
      configuration: randomizedAuditionState,
    });
    assert.equal(randomizedAuditionVoice.silenced, true);
    randomizedAuditionVoice._handleMessage({
      type: "pluck",
      force: JAW_HARP_DEFAULTS.pluckForce,
      direction: randomizedAuditionState.pluckDirection,
      position: randomizedAuditionState.pluckPosition,
      automatic: true,
    });
    assert.equal(randomizedAuditionVoice.silenced, false);
    assert.equal(randomizedAuditionVoice.hasBeenPlucked, true);
    const randomizedAudition = renderProcessor(randomizedAuditionVoice, 20);
    let randomizedAuditionPeak = 0;
    for (const sample of randomizedAudition) {
      randomizedAuditionPeak = Math.max(randomizedAuditionPeak, Math.abs(sample));
    }
    assert.ok(rmsOf(randomizedAudition) > 0.001);
    assert.ok(randomizedAuditionPeak > 0.001);

    let auditionSeed = 0xa11d1b1e;
    const auditionRandom = () => {
      auditionSeed = (Math.imul(auditionSeed, 1_664_525) + 1_013_904_223) >>> 0;
      return auditionSeed / 0x1_0000_0000;
    };
    for (let index = 0; index < 16; index += 1) {
      const configuration = randomizeJawHarpState(JAW_HARP_DEFAULTS, auditionRandom);
      const voice = new Processor({ processorOptions: { configuration } });
      voice._handleMessage({
        type: "pluck",
        force: Math.max(JAW_HARP_DEFAULTS.pluckForce, configuration.pluckForce),
        direction: configuration.pluckDirection,
        position: configuration.pluckPosition,
        automatic: true,
      });
      const samples = renderProcessor(voice, 48);
      assert.ok(rmsOf(samples) > 0.001, `random audition ${index} was too quiet`);
    }
    const renderAutomaticVoice = (configuration, blocks = 120) => {
      const voice = new Processor({ processorOptions: { configuration: sanitizeJawHarpState({
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: false,
        breathDepth: 3,
        breathRateBpm: 120,
        breathBalance: 0.5,
        ...configuration,
      }) } });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      return renderProcessor(voice, blocks);
    };

    const releaseState = (direction) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
      } } });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({
        type: "release-tine", force: 1, direction, position: 0.32,
      });
      return voice;
    };
    const outwardRelease = releaseState(1);
    const inwardRelease = releaseState(-1);
    const outwardDisplacement = outwardRelease.amplitudes[0]
      * Math.sin(outwardRelease.phases[0]);
    const outwardVelocity = outwardRelease.amplitudes[0]
      * Math.cos(outwardRelease.phases[0]);
    const inwardDisplacement = inwardRelease.amplitudes[0]
      * Math.sin(inwardRelease.phases[0]);
    assert.ok(outwardDisplacement > 0.5);
    assert.ok(Math.abs(outwardVelocity) < 1e-12);
    assert.ok(Math.abs(outwardDisplacement + inwardDisplacement) < 1e-12);

    renderProcessor(outwardRelease, 4);
    const phasesBeforeRetrigger = Float64Array.from(outwardRelease.phases);
    const amplitudesBeforeRetrigger = Float64Array.from(outwardRelease.amplitudes);
    outwardRelease._handleMessage({
      type: "pluck", force: 0.8, direction: 1, position: 0.32,
    });
    for (let index = 0; index < JAW_HARP_MODE_COUNT; index += 1) {
      assert.ok(outwardRelease.amplitudes[index] >= amplitudesBeforeRetrigger[index]);
      if (amplitudesBeforeRetrigger[index] >= 1e-9) {
        assert.equal(outwardRelease.phases[index], phasesBeforeRetrigger[index]);
      }
    }
    assert.ok(outwardRelease.amplitudes[0] > amplitudesBeforeRetrigger[0]);

    const retriggerReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const retriggered = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [retriggerReference, retriggered]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 80);
    }
    retriggered._handleMessage({
      type: "pluck", force: 0.8, direction: -1, position: 0.68,
    });
    const referenceAfterRetrigger = renderProcessor(retriggerReference, 8);
    const retriggeredOutput = renderProcessor(retriggered, 8);
    assert.ok(
      rmsOf(retriggeredOutput) > rmsOf(referenceAfterRetrigger) * 0.9,
      "an active reed retrigger must not phase-brake the ringing sound",
    );

    const strongReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const weakRetriggered = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [strongReference, weakRetriggered]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
      renderProcessor(voice, 1);
    }
    const attackBeforeWeakRetrigger = weakRetriggered.attackEnvelope;
    const clickBeforeWeakRetrigger = weakRetriggered.clickEnvelope;
    weakRetriggered._handleMessage({
      type: "pluck", force: 0.005, direction: 1, position: 0.68,
    });
    assert.equal(weakRetriggered.attackEnvelope, attackBeforeWeakRetrigger);
    assert.equal(weakRetriggered.clickEnvelope, clickBeforeWeakRetrigger);
    const uninterruptedStrongOutput = renderProcessor(strongReference, 8);
    const weakRetriggerOutput = renderProcessor(weakRetriggered, 8);
    assert.ok(
      rmsOf(weakRetriggerOutput) > rmsOf(uninterruptedStrongOutput) * 0.9,
      "a weak follow-up pluck must not erase a strong ringing attack",
    );

    const reopeningGate = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    reopeningGate._handleMessage({ type: "breath", flow: 0.9, manual: true });
    reopeningGate._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    reopeningGate.amplitudes.fill(0);
    reopeningGate.airGate = 0;
    reopeningGate.airPathPrimed = true;
    for (let sample = 0; sample < 4_800; sample += 1) {
      reopeningGate.energy = 0;
      reopeningGate._renderSource();
    }
    const reopenedPresence = 1 - Math.exp(-Math.abs(reopeningGate.breathFlow) * 1.15);
    const reopenedTarget = 0.08 + reopenedPresence * 1.12;
    assert.ok(
      reopeningGate.airGate > reopenedTarget * 0.9,
      "low-energy breath must reopen the air path within 100 ms",
    );

    const selectiveGlottis = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const coefficientMasks = [];
    const updateCoefficients = selectiveGlottis._updateCoefficients.bind(selectiveGlottis);
    selectiveGlottis._updateCoefficients = (mask) => {
      coefficientMasks.push(mask);
      return updateCoefficients(mask);
    };
    const tractFrequencyBefore = selectiveGlottis.mouthFiltersLeft[0].frequency;
    const frameFrequencyBefore = selectiveGlottis.frameFilterLeft.frequency;
    selectiveGlottis.frequencies[0] = 12_345;
    selectiveGlottis.decays[0] = 0.12345;
    selectiveGlottis._handleMessage({
      type: "configure", configuration: { glottisOpening: 3 },
    });
    selectiveGlottis._approachConfiguration(128);
    assert.deepEqual(coefficientMasks, [2]);
    assert.equal(selectiveGlottis.frequencies[0], 12_345);
    assert.equal(selectiveGlottis.decays[0], 0.12345);
    assert.notEqual(selectiveGlottis.mouthFiltersLeft[0].frequency, tractFrequencyBefore);
    assert.equal(selectiveGlottis.frameFilterLeft.frequency, frameFrequencyBefore);

    const rawReleaseCycleRms = (presetId) => {
      const configuration = jawHarpState(presetId, { autoBreath: false, dryResonance: 1 });
      const voice = new Processor({ processorOptions: { configuration } });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({
        type: "release-tine", force: 1, direction: 1, position: 0.32,
      });
      const period = Math.round(48_000 / configuration.reedFrequencyHz);
      const cycles = [];
      for (let cycle = 0; cycle < 3; cycle += 1) {
        let energy = 0;
        for (let sample = 0; sample < period; sample += 1) {
          const value = voice._renderSource();
          energy += value * value;
        }
        cycles.push(Math.sqrt(energy / period));
      }
      return cycles;
    };
    for (const presetId of ["khomus", "munnharpe", "kubing"]) {
      const cycles = rawReleaseCycleRms(presetId);
      assert.ok(cycles[1] > cycles[0] * 0.78, `${presetId} second rebound remains strong`);
      assert.ok(cycles[2] > cycles[0] * 0.72, `${presetId} third rebound remains strong`);
    }

    assert.equal(processor.amplitudes.length, JAW_HARP_MODE_COUNT);
    const attackRms = [0.005, 0.05, 0.5, 4].map((force) => rmsOf(renderVoice({
      autoBreath: false,
      dryResonance: 1,
    }, { force, flow: 0, blocks: 20 }), 2_400));
    assert.ok(attackRms.every((amount, index) => index === 0 || amount > attackRms[index - 1]));
    assert.ok(attackRms.at(-1) > attackRms[0] * 20);
    const maximumBreathAttacks = [0.005, 0.05, 0.5, 4].map((force) => renderVoice({
      autoBreath: false,
      dryResonance: 0.06,
    }, { force, flow: 3, blocks: 8 }));
    const maximumBreathFiveMs = maximumBreathAttacks.map((samples) => rmsOf(samples, 240));
    assert.ok(maximumBreathFiveMs.every((amount, index) => index === 0 || amount > maximumBreathFiveMs[index - 1]));
    assert.ok(maximumBreathFiveMs.at(-1) > maximumBreathFiveMs[0] * 2);
    assert.ok(rmsOf(maximumBreathAttacks.at(-1), 960) > rmsOf(maximumBreathAttacks[0], 960) * 1.2);
    for (const key of [
      "tonguePosition",
      "tongueHeight",
      "jawOpening",
      "lipRounding",
      "glottisOpening",
      "formantFocus",
      "cavityCoupling",
      "frameCoupling",
    ]) {
      const low = renderVoice({ [key]: JAW_HARP_LIMITS[key][0] });
      const high = renderVoice({ [key]: JAW_HARP_LIMITS[key][1] });
      assert.ok(normalizedDifference(low, high) > 0.2, `${key} must remain audibly connected`);
    }
    const dryMouth = renderVoice({ dryResonance: 0 }, { flow: 0 });
    const resonantMouth = renderVoice({ dryResonance: 1 }, { flow: 0 });
    assert.ok(normalizedDifference(dryMouth, resonantMouth) > 0.2);
    for (const [label, lowConfiguration, highConfiguration] of [
      ["breath depth", { breathDepth: 0 }, { breathDepth: 3 }],
      ["breath rate", { breathRateBpm: 1 }, { breathRateBpm: 1_200 }],
      ["breath balance", { breathBalance: 0.02 }, { breathBalance: 0.98 }],
      ["breath link", { breathLinked: false }, { breathLinked: true }],
      [
        "linked hand tempo",
        { breathLinked: true, repeatRateBpm: 36 },
        { breathLinked: true, repeatRateBpm: 480 },
      ],
      [
        "breaths per loop",
        { breathLinked: true, breathsPerLoop: 0.125 },
        { breathLinked: true, breathsPerLoop: 16 },
      ],
    ]) {
      const low = renderAutomaticVoice(lowConfiguration);
      const high = renderAutomaticVoice(highConfiguration);
      assert.ok(normalizedDifference(low, high) > 0.2, `${label} must remain audibly connected`);
    }

    const presetRenders = JAW_HARP_PRESETS.map((preset) => renderVoice(jawHarpState(preset.id)));
    for (let left = 0; left < presetRenders.length; left += 1) {
      for (let right = left + 1; right < presetRenders.length; right += 1) {
        assert.ok(normalizedDifference(presetRenders[left], presetRenders[right]) > 0.2);
      }
    }

    const liveReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const liveMouth = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [liveReference, liveMouth]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 8);
    }
    liveMouth._handleMessage({ type: "configure", configuration: {
      tonguePosition: 3,
      tongueHeight: -2,
      jawOpening: 3,
      lipRounding: -2,
      glottisOpening: 3,
      formantFocus: 3,
      cavityCoupling: 2,
    } });
    const liveReferenceOutput = renderProcessor(liveReference, 120);
    const liveMouthOutput = renderProcessor(liveMouth, 120);
    assert.ok(liveMouth.configuration.tonguePosition > 2.99);
    assert.ok(normalizedDifference(liveReferenceOutput, liveMouthOutput) > 0.2);

    const appOrderReference = new Processor({
      processorOptions: { configuration: JAW_HARP_DEFAULTS },
    });
    const appOrderPreset = new Processor({
      processorOptions: { configuration: JAW_HARP_DEFAULTS },
    });
    const armAppOrderedRelease = (voice, configuration) => {
      voice._handleMessage({ type: "configure", configuration });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({ type: "configure", configuration });
      voice._handleMessage({
        type: "release-tine", force: 0.72, direction: 1, position: 0.32,
      });
    };
    armAppOrderedRelease(appOrderReference, JAW_HARP_DEFAULTS);
    armAppOrderedRelease(appOrderPreset, jawHarpState("dan-moi"));
    const appOrderReferenceOutput = renderProcessor(appOrderReference, 90);
    const appOrderPresetOutput = renderProcessor(appOrderPreset, 90);
    assert.equal(appOrderPreset.configuration.presetId, "dan-moi");
    assert.ok(normalizedDifference(appOrderReferenceOutput, appOrderPresetOutput) > 0.2);

    const held = new Processor({
      processorOptions: { configuration: { ...JAW_HARP_DEFAULTS, autoBreath: false } },
    });
    held._handleMessage({ type: "breath", flow: 3, manual: true });
    held._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
    held.process([], [[new Float32Array(128), new Float32Array(128)]]);
    held._handleMessage({ type: "hold-tine" });
    const heldOutput = new Float32Array(128);
    const heldOutputRight = new Float32Array(128);
    held.process([], [[heldOutput, heldOutputRight]]);
    assert.ok(heldOutput.every((sample) => sample === 0));
    assert.ok(heldOutputRight.every((sample) => sample === 0));
    held._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32, automatic: true });
    const suppressedOutput = new Float32Array(128);
    const suppressedOutputRight = new Float32Array(128);
    held.process([], [[suppressedOutput, suppressedOutputRight]]);
    assert.ok(suppressedOutput.every((sample) => sample === 0));
    assert.ok(suppressedOutputRight.every((sample) => sample === 0));
    held._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32, automatic: false });
    const suppressedManualOutput = new Float32Array(128);
    const suppressedManualOutputRight = new Float32Array(128);
    held.process([], [[suppressedManualOutput, suppressedManualOutputRight]]);
    assert.ok(suppressedManualOutput.every((sample) => sample === 0));
    assert.ok(suppressedManualOutputRight.every((sample) => sample === 0));
    held._handleMessage({ type: "release-tine", force: 4, direction: 1, position: 0.32 });
    const releasedOutput = new Float32Array(128);
    held.process([], [[releasedOutput, new Float32Array(128)]]);
    assert.ok(releasedOutput.some((sample) => Math.abs(sample) > 1e-5));

    const heldClock = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: true,
      breathLinked: false,
      breathRateBpm: 1_200,
    } } });
    heldClock._handleMessage({ type: "hold-tine" });
    const phaseBeforeHold = heldClock.breathPhase;
    const silentHeldClock = new Float32Array(128);
    heldClock.process([], [[silentHeldClock, new Float32Array(128)]]);
    assert.notEqual(heldClock.breathPhase, phaseBeforeHold);
    assert.ok(silentHeldClock.every((sample) => sample === 0));
    heldClock._handleMessage({ type: "release-tine" });
    for (let block = 0; block < 38; block += 1) {
      const cancelledOutput = new Float32Array(128);
      const cancelledOutputRight = new Float32Array(128);
      heldClock.process([], [[cancelledOutput, cancelledOutputRight]]);
      assert.ok(cancelledOutput.every((sample) => sample === 0));
      assert.ok(cancelledOutputRight.every((sample) => sample === 0));
    }

    const cancelledActiveVoice = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    cancelledActiveVoice._handleMessage({ type: "breath", flow: 3, manual: true });
    cancelledActiveVoice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
    cancelledActiveVoice.process([], [[new Float32Array(128), new Float32Array(128)]]);
    cancelledActiveVoice._handleMessage({ type: "hold-tine" });
    cancelledActiveVoice._handleMessage({ type: "release-tine" });
    for (let block = 0; block < 38; block += 1) {
      const cancelledOutput = new Float32Array(128);
      const cancelledOutputRight = new Float32Array(128);
      cancelledActiveVoice.process([], [[cancelledOutput, cancelledOutputRight]]);
      assert.ok(cancelledOutput.every((sample) => sample === 0));
      assert.ok(cancelledOutputRight.every((sample) => sample === 0));
    }

    const rapidBreath = new Processor({
      processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: false,
        breathDepth: 3,
        breathRateBpm: 1_200,
        breathBalance: 0.5,
      } },
    });
    rapidBreath._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
    let previousSign = 0;
    let directionChanges = 0;
    for (let block = 0; block < 100; block += 1) {
      rapidBreath.process([], [[new Float32Array(128), new Float32Array(128)]]);
      const sign = Math.abs(rapidBreath.breathFlow) < 0.01 ? 0 : Math.sign(rapidBreath.breathFlow);
      if (sign && previousSign && sign !== previousSign) directionChanges += 1;
      if (sign) previousSign = sign;
    }
    assert.ok(directionChanges >= 8);

    const enabledAfterManualStart = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
      breathLinked: false,
      breathDepth: 3,
      breathRateBpm: 1_200,
    } } });
    enabledAfterManualStart._handleMessage({
      type: "configure",
      configuration: { autoBreath: true },
    });
    enabledAfterManualStart._handleMessage({
      type: "pluck", force: 1, direction: 1, position: 0.32,
    });
    let automaticFlowPeak = 0;
    let automaticFlowChanges = 0;
    let previousAutomaticSign = 0;
    for (let block = 0; block < 100; block += 1) {
      enabledAfterManualStart.process([], [[new Float32Array(128), new Float32Array(128)]]);
      automaticFlowPeak = Math.max(automaticFlowPeak, Math.abs(enabledAfterManualStart.breathFlow));
      const sign = Math.abs(enabledAfterManualStart.breathFlow) < 0.01
        ? 0
        : Math.sign(enabledAfterManualStart.breathFlow);
      if (sign && previousAutomaticSign && sign !== previousAutomaticSign) automaticFlowChanges += 1;
      if (sign) previousAutomaticSign = sign;
    }
    assert.ok(automaticFlowPeak > 2.9);
    assert.ok(automaticFlowChanges >= 8);

    for (const breathBalance of [0.02, 0.98]) {
      const extremeRate = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: true,
        repeatRateBpm: 480,
        breathsPerLoop: 16,
        breathRateBpm: 1_200,
        breathBalance,
        breathDepth: 3,
      } } });
      extremeRate._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
      let previousExtremeSign = 0;
      let extremeDirectionChanges = 0;
      let minimumFlow = 0;
      let maximumFlow = 0;
      let positiveSamples = 0;
      let negativeSamples = 0;
      for (let sample = 0; sample < 4_800; sample += 1) {
        extremeRate._renderSource();
        minimumFlow = Math.min(minimumFlow, extremeRate.breathFlow);
        maximumFlow = Math.max(maximumFlow, extremeRate.breathFlow);
        if (extremeRate.breathFlow > 0.01) positiveSamples += 1;
        if (extremeRate.breathFlow < -0.01) negativeSamples += 1;
        const sign = Math.abs(extremeRate.breathFlow) < 0.01 ? 0 : Math.sign(extremeRate.breathFlow);
        if (sign && previousExtremeSign && sign !== previousExtremeSign) extremeDirectionChanges += 1;
        if (sign) previousExtremeSign = sign;
      }
      assert.ok(extremeDirectionChanges >= 20);
      assert.ok(minimumFlow < -2.9 && maximumFlow > 2.9);
      assert.ok(positiveSamples > 60 && negativeSamples > 60);
    }

    const mouthKeys = [
      "tonguePosition", "tongueHeight", "jawOpening", "lipRounding", "glottisOpening",
    ];
    for (let mask = 0; mask < 2 ** mouthKeys.length; mask += 1) {
      for (const focusValue of [-2, 3]) {
        for (const coupling of [0, 2]) {
          const mouthConfiguration = Object.fromEntries(mouthKeys.map((key, index) => [
            key,
            mask & (1 << index) ? JAW_HARP_LIMITS[key][1] : JAW_HARP_LIMITS[key][0],
          ]));
          const extremeVoice = new Processor({ processorOptions: { configuration: {
            ...JAW_HARP_DEFAULTS,
            autoBreath: false,
            ...mouthConfiguration,
            formantFocus: focusValue,
            cavityCoupling: coupling,
          } } });
          extremeVoice._handleMessage({ type: "breath", flow: 3, manual: true });
          extremeVoice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
          for (let block = 0; block < 8; block += 1) {
            const left = new Float32Array(128);
            const right = new Float32Array(128);
            extremeVoice.process([], [[left, right]]);
            assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
            assert.ok(left.every((sample) => Math.abs(sample) <= 0.821));
            assert.ok(right.every((sample) => Math.abs(sample) <= 0.821));
          }
          for (const values of [
            extremeVoice.amplitudes,
            extremeVoice.phases,
            extremeVoice.frequencies,
            extremeVoice.decays,
          ]) assert.ok(values.every(Number.isFinite));
          assert.ok([
            extremeVoice.energy,
            extremeVoice.reedDisplacement,
            extremeVoice.breathFlow,
            extremeVoice.airGate,
          ].every(Number.isFinite));
        }
      }
    }
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});

test("jaw-harp page exposes the physical model and accessible interactions", async () => {
  const [html, css, app, processor] = await Promise.all([
    readFile(new URL("jaw-harp.html", root), "utf8"),
    readFile(new URL("jaw-harp.css", root), "utf8"),
    readFile(new URL("jaw-harp-app.js", root), "utf8"),
    readFile(new URL("src/jaw-harp-processor.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="jaw-harp-page"/);
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"/);
  assert.match(html, /id="pluckButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="tonguePosition"/);
  assert.match(html, /id="jawOpening"/);
  assert.match(html, /id="cavityCoupling"/);
  assert.match(html, /id="inhaleButton"/);
  assert.match(html, /id="exhaleButton"/);
  assert.match(html, /id="breathCycleButton"/);
  assert.match(html, /id="rhythmSelect"/);
  assert.match(html, /id="breathsPerLoop"/);
  assert.match(html, /id="breathLinkButton"/);
  assert.match(html, /id="dryResonance"/);
  assert.match(html, /src="jaw-harp-app\.js"/);
  for (const key of [
    "pluckForce",
    "tonguePosition",
    "tongueHeight",
    "jawOpening",
    "lipRounding",
    "formantFocus",
    "cavityCoupling",
    "glottisOpening",
    "breathDepth",
    "breathRateBpm",
    "breathBalance",
    "repeatRateBpm",
    "repeatSwing",
    "dryResonance",
  ]) {
    const tag = html.match(new RegExp(`<input id="${key}"[^>]*>`))?.[0];
    assert.ok(tag, `${key} range exists`);
    const minimum = Number(tag.match(/min="([^"]+)"/)?.[1]);
    const maximum = Number(tag.match(/max="([^"]+)"/)?.[1]);
    assert.deepEqual([minimum, maximum], JAW_HARP_LIMITS[key], `${key} HTML and model limits match`);
  }
  assert.match(html, /<option value="16">16 breaths \/ loop<\/option>/);
  assert.match(html, /Drag anywhere in the BREATH pad in two dimensions:[\s\S]*twenty per second/);
  assert.match(html, /Drag anywhere in the TEMPO pad horizontally from[\s\S]*vertically for[\s\S]*alternating swing/);
  assert.match(html, /focus and cavity node in two dimensions/);
  assert.match(html, /glottis node\s+horizontally/);
  assert.match(css, /\.jaw-harp-page \.shell/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /new AudioWorkletNode\(context, "jaw-harp-physical-model"/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pluckForceFromPull\(drag\.pull, state\.pluckForce\)/);
  assert.match(app, /tineReleaseMotion\(/);
  assert.match(app, /visualTineRelease/);
  assert.doesNotMatch(app, /clamp\(telemetry\.displacement/);
  assert.match(app, /type: "hold-tine"/);
  assert.match(app, /type: "release-tine"/);
  assert.match(app, /function cancelHeldTine\(\)/);
  assert.match(app, /audioStartupPromise/);
  assert.match(app, /intentGeneration !== performanceIntentGeneration/);
  assert.match(app, /lostpointercapture", release/);
  assert.match(app, /pageLifecycleGeneration/);
  assert.match(app, /manualBreathGeneration/);
  assert.match(app, /manualBreathOwner/);
  assert.match(app, /function breathFlowForDisplay\(/);
  assert.match(app, /lastBreathTelemetryAt/);
  assert.doesNotMatch(app, /telemetry\.breathFlow \?\? commandedBreathFlow/);
  assert.match(app, /function logarithmicValue\(/);
  assert.match(app, /type === "air"/);
  assert.match(app, /type === "rhythm"/);
  assert.match(app, /type === "glottis"/);
  assert.match(app, /breathRateBpm: logarithmicValue\(/);
  assert.match(app, /repeatRateBpm: logarithmicValue\(/);
  assert.match(app, /const TEMPO_SLIDER_TICKS = Object\.freeze\(\[36, 60, 120, 240, 480\]\)/);
  assert.match(app, /function drawTempoSlider\(/);
  assert.match(app, /drawNode\(model\.airPad\.x, model\.airPad\.y, "#68bff1", "BREATH"/);
  assert.match(app, /drawNode\(model\.rhythmPad\.x, model\.rhythmPad\.y, "#f0c46e", "TEMPO"/);
  assert.match(app, /effectiveAirRate = effectiveBreathRateBpm\(state\)/);
  assert.match(app, /1\/MIN ← CYCLE SPEED → 20\/SEC/);
  assert.match(app, /LINKED? ×\$\{multiplier\.toFixed/);
  assert.match(app, /state\.breathLinked[\s\S]*?"FREE"/);
  assert.match(app, /REPEAT \$\{state\.repeat \? "ON" : "OFF"\}/);
  assert.match(app, /point\.x >= model\.airPad\.left/);
  assert.match(app, /point\.x >= model\.rhythmPad\.left/);
  assert.match(app, /const RANDOMIZE_AUDITION_FORCE_FLOOR = JAW_HARP_DEFAULTS\.pluckForce/);
  const auditionBlock = app.match(/async function auditionRandomizedModel\([\s\S]*?^\}/m)?.[0] ?? "";
  assert.match(auditionBlock, /intentGeneration = performanceIntentGeneration/);
  assert.match(auditionBlock, /parkOwner = \+\+repeatClockParkSerial/);
  assert.match(auditionBlock, /repeatClockParkOwner !== parkOwner/);
  assert.match(auditionBlock, /repeatClockParkOwner = parkOwner/);
  assert.match(auditionBlock, /repeatClockParkOwner = 0/);
  assert.match(auditionBlock, /audioContext\?\.state !== "running"/);
  assert.match(auditionBlock, /nextRepeatAt = Infinity/);
  assert.match(auditionBlock, /await ensureAudio\(\)/);
  assert.match(auditionBlock, /auditionBreathPhase = state\.autoBreath \? state\.breathBalance \* 0\.5 : 0/);
  assert.match(auditionBlock, /resetBreathCycle\(auditionBreathPhase\)/);
  assert.match(auditionBlock, /clamp\([\s\S]*?RANDOMIZE_AUDITION_FORCE_FLOOR,[\s\S]*?JAW_HARP_RANDOM_LIMITS\.pluckForce\[1\]/);
  assert.match(auditionBlock, /type: "pluck"/);
  assert.match(auditionBlock, /automatic: true/);
  assert.match(auditionBlock, /repeatStep = 1/);
  assert.match(auditionBlock, /repeatHitCount = 1/);
  assert.match(auditionBlock, /repeatIntervalMs\(state\.repeatRateBpm, 0, state\.repeatSwing\)/);
  const randomizeBlock = app.match(/function randomizeModel\(\) \{[\s\S]*?^\}/m)?.[0] ?? "";
  assert.match(randomizeBlock, /type: "silence"/);
  assert.match(randomizeBlock, /repeatStep = 0/);
  assert.match(randomizeBlock, /repeatHitCount = 0/);
  assert.match(randomizeBlock, /nextRepeatAt = randomizedAt/);
  assert.match(randomizeBlock, /startingBreathPhase = state\.autoBreath \? state\.breathBalance \* 0\.5 : 0/);
  assert.match(randomizeBlock, /resetBreathCycle\(startingBreathPhase\)/);
  assert.match(randomizeBlock, /commandedBreathFlow = breathFlowAt\(\)/);
  assert.match(randomizeBlock, /void auditionRandomizedModel\(\)/);
  assert.ok(
    randomizeBlock.indexOf("postConfiguration()")
      < randomizeBlock.indexOf("auditionRandomizedModel()"),
  );
  assert.match(app, /sendManualBreath\(manualBreathDirection \* state\.breathDepth\)/);
  assert.match(app, /function drawParameterPad\(/);
  assert.match(app, /function drawAirPadDetails\(/);
  assert.match(app, /function drawRhythmPadDetails\(/);
  assert.match(app, /function retimeRepeatClock\(/);
  assert.match(app, /function preserveBreathCyclePhase\(/);
  const setControlBlock = app.slice(
    app.indexOf("function setControl("),
    app.indexOf("function loadHarp("),
  );
  const pointerControlBlock = app.slice(
    app.indexOf("function setFromPointer("),
    app.indexOf("function installCanvasInteractions("),
  );
  assert.doesNotMatch(setControlBlock, /resetBreathCycle|repeatStep = 0|repeatHitCount = 0/);
  assert.doesNotMatch(pointerControlBlock, /resetBreathCycle|repeatStep = 0|repeatHitCount = 0/);
  assert.match(setControlBlock, /retimeRepeatClock\(previousState, changedAt\)/);
  assert.match(pointerControlBlock, /preserveBreathCyclePhase\(previousPhase, changedAt\)/);
  assert.match(app, /compressor\.threshold\.value = -22/);
  assert.match(app, /compressor\.knee\.value = 18/);
  assert.match(app, /compressor\.ratio\.value = 2\.5/);
  assert.match(app, /compressor\.attack\.value = 0\.008/);
  assert.match(app, /compressor\.release\.value = 0\.075/);
  assert.match(app, /sourceNode\.connect\(compressor\);[\s\S]*?compressor\.connect\(masterGain\);[\s\S]*?masterGain\.connect\(analyser\);/);
  assert.doesNotMatch(app, /ceilingGain/);
  assert.match(app, /function audioGraphIsRunning\(\)/);
  const audioGraphRunningBlock = app.slice(
    app.indexOf("function audioGraphIsRunning("),
    app.indexOf("async function toggleAudio("),
  );
  assert.match(audioGraphRunningBlock, /pageIsActive/);
  assert.match(audioGraphRunningBlock, /audioDesiredOn/);
  assert.match(audioGraphRunningBlock, /audioContext === graph\.context/);
  assert.match(audioGraphRunningBlock, /audioContext\.state === "running"/);
  const pluckBlock = app.slice(
    app.indexOf("async function pluck("),
    app.indexOf("function presentPluck("),
  );
  assert.match(pluckBlock, /!audioGraphIsRunning\(\) && !\(await ensureAudio\(\)\)/);
  const releaseTineBlock = app.slice(
    app.indexOf("async function releaseTine("),
    app.indexOf("function clearPointerInteraction("),
  );
  assert.match(releaseTineBlock, /audioGraphIsRunning\(\) \? true : await ensureAudio\(\)/);
  const loadHarpBlock = app.slice(
    app.indexOf("function loadHarp("),
    app.indexOf("function loadVowel("),
  );
  assert.match(loadHarpBlock, /audioGraphIsRunning\(\) && !tineIsHeld/);
  assert.match(app, /function drawHair\(/);
  assert.match(app, /const headOverlapY = compact \? 3 : 5/);
  assert.match(app, /topY \+ 28 \+ headOverlapY/);
  assert.match(app, /topY \+ 49 \+ headOverlapY/);
  assert.match(app, /function drawEye\(/);
  assert.match(app, /1 \+ exhale \* 0\.36 - inhale \* 0\.11/);
  assert.match(app, /function lipExtensionPixels\(/);
  assert.match(app, /maximumRetraction/);
  assert.match(app, /maximumProtrusion/);
  assert.match(app, /noseProjection/);
  assert.match(app, /nearestDistance/);
  assert.match(app, /audioPresentationStatus === "on"/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.match(app, /manual: false/);
  assert.match(app, /pointercancel", cancelPointer/);
  assert.match(processor, /registerProcessor\("jaw-harp-physical-model"/);
  assert.match(processor, /class StateVariableBandpass/);
  assert.match(processor, /maximum displacement with zero velocity/);
  assert.match(processor, /retrigger supplies energy without phase-braking/);
  assert.match(processor, /COEFFICIENT_REED/);
  assert.match(processor, /coefficientMaskForKey/);
  assert.match(processor, /_updateCoefficients\(coefficientMask = COEFFICIENT_ALL\)/);
  const radiateBlock = processor.match(/_radiate\(source, side\) \{[\s\S]*?^  \}/m)?.[0] ?? "";
  assert.match(processor, /const INHALE_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(processor, /const EXHALE_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(processor, /const REST_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(radiateBlock, /INHALE_FORMANT_WEIGHTS/);
  assert.match(radiateBlock, /EXHALE_FORMANT_WEIGHTS/);
  assert.match(radiateBlock, /REST_FORMANT_WEIGHTS/);
  assert.doesNotMatch(
    radiateBlock,
    /(?:=|\?|:)\s*\[\s*-?(?:\d|\.)|Array\.from|new\s+(?:Array|Float(?:32|64)Array)/,
  );
  assert.match(processor, /message\.type === "breath"/);
  assert.match(processor, /_automaticBreathFlow\(\)/);
  assert.match(processor, /focusFilterLeft/);
});
