import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HARMONICA_BLOW_BENDS,
  HARMONICA_BLOW_BEND_HOLES,
  HARMONICA_BLOW_MIDI,
  HARMONICA_BLUES_RHYTHMS,
  HARMONICA_DEFAULTS,
  HARMONICA_DRAW_BENDS,
  HARMONICA_DRAW_BEND_HOLES,
  HARMONICA_DRAW_MIDI,
  HARMONICA_HOLE_COUNT,
  HARMONICA_KEYS,
  HARMONICA_LIMITS,
  HARMONICA_OVERBLOW_HOLES,
  HARMONICA_OVERDRAW_HOLES,
  HARMONICA_PERFORMANCE_PRESETS,
  HARMONICA_PRESETS,
  HARMONICA_TECHNIQUES,
  activeHoles,
  applyHarmonicaPerformancePreset,
  applyHarmonicaTechnique,
  bendRangeSemitones,
  harmonicaActiveReeds,
  harmonicaBluesRhythm,
  harmonicaBluesRhythmFlow,
  harmonicaBreathShiftProfile,
  harmonicaBreathCycleFlow,
  harmonicaCoupledReedState,
  harmonicaKey,
  harmonicaMaterialProperties,
  harmonicaMouthFormants,
  harmonicaOverbendTarget,
  harmonicaPerformancePreset,
  harmonicaPressureState,
  harmonicaReedCoupling,
  harmonicaReedFrequency,
  harmonicaReedPair,
  harmonicaState,
  harmonicaTechnique,
  harmonicaTechniqueAllowed,
  randomizeHarmonicaState,
  sanitizeHarmonicaState,
} from "../src/harmonica.js";

const root = new URL("../", import.meta.url);

test("harmonica exposes the exact ten-hole Richter blow and draw layout", () => {
  assert.equal(HARMONICA_HOLE_COUNT, HARMONICA_BLOW_MIDI.length);
  assert.equal(HARMONICA_HOLE_COUNT, HARMONICA_DRAW_MIDI.length);
  assert.equal(HARMONICA_HOLE_COUNT, 10);
  assert.equal(HARMONICA_DEFAULTS.breathDirection, -1);
  assert.equal(HARMONICA_DEFAULTS.keyId, "c");
  assert.deepEqual(HARMONICA_BLOW_MIDI, [60, 64, 67, 72, 76, 79, 84, 88, 91, 96]);
  assert.deepEqual(HARMONICA_DRAW_MIDI, [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]);
  assert.deepEqual(HARMONICA_DRAW_BENDS, [1, 2, 3, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(HARMONICA_BLOW_BENDS, [0, 0, 0, 0, 0, 0, 1, 1, 1, 2]);
  for (let hole = 1; hole <= 10; hole += 1) {
    const pair = harmonicaReedPair(HARMONICA_DEFAULTS, hole);
    assert.equal(pair.blowMidi, HARMONICA_BLOW_MIDI[hole - 1]);
    assert.equal(pair.drawMidi, HARMONICA_DRAW_MIDI[hole - 1]);
    assert.ok(pair.blowFrequencyHz > 0 && pair.drawFrequencyHz > 0);
  }
  assert.ok(harmonicaReedPair(HARMONICA_DEFAULTS, 7).drawMidi < harmonicaReedPair(HARMONICA_DEFAULTS, 7).blowMidi);
});

test("instrument key transposes independently from the four reed-body materials", () => {
  assert.equal(HARMONICA_PRESETS.length, 4);
  assert.equal(HARMONICA_KEYS.length, 13);
  const c = harmonicaReedPair(harmonicaState("c-richter"), 4);
  const lowC = harmonicaReedPair(harmonicaState("c-richter", { keyId: "low-c" }), 4);
  const g = harmonicaReedPair(harmonicaState("c-richter", { keyId: "g" }), 4);
  assert.equal(lowC.blowMidi, c.blowMidi - 12);
  assert.equal(g.drawMidi, c.drawMidi - 5);
  assert.equal(harmonicaKey("missing").id, "c");
  assert.equal(harmonicaReedPair(harmonicaState("g-richter", { keyId: "c" }), 4).blowMidi, c.blowMidi);
  assert.equal(harmonicaReedPair(harmonicaState("a-richter", { keyId: "g" }), 4).drawMidi, g.drawMidi);
  assert.equal(harmonicaReedPair(HARMONICA_DEFAULTS, 10).blowMidi - harmonicaReedPair(HARMONICA_DEFAULTS, 1).blowMidi, 36);
  const materials = HARMONICA_PRESETS.map(({ id }) => harmonicaMaterialProperties(id));
  assert.equal(new Set(materials.map(({ specificModulusM2S2 }) => specificModulusM2S2)).size, 4);
  assert.ok(materials.every(({ waveSpeedMps, intrinsicCycleRetention }) => (
    waveSpeedMps > 0 && intrinsicCycleRetention > 0 && intrinsicCycleRetention < 1
  )));
  const pressureModels = HARMONICA_PRESETS.map(({ id }) => harmonicaPressureState(
    harmonicaState(id, { reedGap: 0.72, reedStiffness: 1, airLeak: 0.04 }),
    -0.24,
  ));
  assert.ok(new Set(pressureModels.map(({ threshold }) => threshold.toFixed(6))).size > 2);
  assert.ok(new Set(pressureModels.map(({ drive }) => drive.toFixed(6))).size > 2);
  const steel = harmonicaMaterialProperties("g-richter");
  const brass = harmonicaMaterialProperties("a-richter");
  assert.ok(steel.stiffnessScale > brass.stiffnessScale);
  assert.ok(steel.lossScale < brass.lossScale);
});

test("bending is monotonic and restricted to the physically available direction", () => {
  const base = harmonicaState("c-richter", { bend: 0 });
  const maximum = harmonicaState("c-richter", { bend: 1 });
  const impossible = harmonicaState("c-richter", { bend: 1.5 });
  assert.equal(bendRangeSemitones(3, -1), 3);
  assert.equal(bendRangeSemitones(3, 1), 0);
  assert.equal(bendRangeSemitones(10, 1), 2);
  const frequencies = [base, maximum, impossible]
    .map((state) => harmonicaReedFrequency(state, 3, -1).frequencyHz);
  assert.ok(frequencies[0] > frequencies[1] && frequencies[1] > frequencies[2]);
  assert.equal(harmonicaReedFrequency(impossible, 3, 1).bendSemitones, 0);
  assert.equal(harmonicaReedFrequency(maximum, 10, 1).bendSemitones, 2);
  assert.equal(harmonicaReedFrequency(maximum, 10, -1).bendSemitones, 0);
});

test("actual paired-reed bending requires pressure and an aligned vocal-tract load", () => {
  const uncoupled = harmonicaState("c-richter", {
    hole: 3,
    bend: 1,
    vocalTractCoupling: 0,
    tonguePosition: 0.46,
    tongueHeight: 0.34,
    throatOpening: 0.42,
    embouchure: 0.5,
  });
  const coupled = harmonicaState("c-richter", {
    hole: 3,
    bend: 1,
    vocalTractCoupling: 2,
    tonguePosition: 0.46,
    tongueHeight: 0.34,
    throatOpening: 0.42,
    embouchure: 0.5,
  });
  const dry = harmonicaCoupledReedState(coupled, 3, -1, 0);
  const weak = harmonicaCoupledReedState(coupled, 3, -1, -0.2);
  const strong = harmonicaCoupledReedState(coupled, 3, -1, -1.2);
  const noFeedback = harmonicaCoupledReedState(uncoupled, 3, -1, -1.2);
  assert.equal(dry.bendSemitones, 0);
  assert.ok(weak.bendSemitones > 0);
  assert.ok(strong.bendSemitones > weak.bendSemitones);
  assert.equal(noFeedback.bendSemitones, 0);
  assert.equal(noFeedback.passiveGain, 0);
  assert.ok(strong.passiveGain > 0.2);
  assert.ok(strong.frequencyHz < weak.frequencyHz);
  const physical = harmonicaReedCoupling(coupled, 3, -1);
  assert.ok(physical.physicalLimit <= physical.baseMidi - physical.opposingMidi);
  assert.ok(physical.normalBendAtFullPressure <= physical.physicalLimit);
  const impossible = harmonicaCoupledReedState({ ...coupled, bend: 1.5 }, 3, -1, -3);
  assert.ok(impossible.bendSemitones > strong.bendSemitones);
  const aligned = harmonicaCoupledReedState(
    { ...coupled, tongueHeight: 0.89 },
    3,
    -1,
    -1.2,
  );
  const misaligned = harmonicaCoupledReedState(
    { ...coupled, tongueHeight: 3 },
    3,
    -1,
    -1.2,
  );
  assert.ok(aligned.tractAlignment > misaligned.tractAlignment * 1.8);
  assert.ok(aligned.bendSemitones > misaligned.bendSemitones * 1.8);
  const wrongDirection = harmonicaCoupledReedState(coupled, 3, 1, 1.2);
  assert.equal(wrongDirection.bendSemitones, 0);
});

test("multi-hole embouchures remain edge-safe and direction selects one reed bank", () => {
  assert.deepEqual(activeHoles(harmonicaState("c-richter", { hole: 1, chordWidth: 5 })), [1, 2, 3, 4, 5]);
  assert.deepEqual(activeHoles(harmonicaState("c-richter", { hole: 10, chordWidth: 5 })), [6, 7, 8, 9, 10]);
  assert.deepEqual(
    activeHoles(harmonicaState("c-richter", { hole: 4, chordWidth: 4, tongueBlock: 1 })),
    [1, 2, 3, 4],
  );
  const state = harmonicaState("c-richter", { hole: 5, chordWidth: 3, tongueBlock: 0 });
  const blow = harmonicaActiveReeds(state, 0.8);
  const draw = harmonicaActiveReeds(state, -0.8);
  assert.deepEqual(blow.map(({ hole }) => hole), [4, 5, 6]);
  assert.ok(blow.every(({ direction }) => direction === 1));
  assert.ok(draw.every(({ direction }) => direction === -1));
  assert.notDeepEqual(blow.map(({ baseMidi }) => baseMidi), draw.map(({ baseMidi }) => baseMidi));
  assert.ok(blow.every(({ weight }) => weight > 0 && weight <= 1));
});

test("extreme state and vocal-tract controls sanitize to finite ordered values", () => {
  const unsafe = sanitizeHarmonicaState({
    hole: -200,
    chordWidth: 99,
    breathPressure: Infinity,
    breathShiftSlop: 99,
    bend: 90,
    tonguePosition: -99,
    throatOpening: 99,
    autoBreath: "yes",
    keyId: "not-a-key",
  });
  assert.equal(unsafe.hole, 1);
  assert.equal(unsafe.chordWidth, 5);
  assert.equal(unsafe.breathShiftSlop, 1);
  assert.equal(unsafe.bend, 1.5);
  assert.equal(unsafe.tonguePosition, -2);
  assert.equal(unsafe.throatOpening, 3);
  assert.equal(unsafe.keyId, "c");
  for (const tonguePosition of HARMONICA_LIMITS.tonguePosition) {
    for (const tongueHeight of HARMONICA_LIMITS.tongueHeight) {
      for (const throatOpening of HARMONICA_LIMITS.throatOpening) {
        for (const embouchure of HARMONICA_LIMITS.embouchure) {
          const formants = harmonicaMouthFormants({
            ...HARMONICA_DEFAULTS,
            tonguePosition,
            tongueHeight,
            throatOpening,
            embouchure,
          });
          assert.ok([...formants.frequenciesHz, ...formants.bandwidthsHz, formants.bendTargetHz]
            .every(Number.isFinite));
          assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
          assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
        }
      }
    }
  }
  const randomized = randomizeHarmonicaState(HARMONICA_DEFAULTS, () => 0.5);
  for (const [key, [minimum, maximum]] of Object.entries(HARMONICA_LIMITS)) {
    assert.ok(randomized[key] >= minimum && randomized[key] <= maximum, key);
  }
});

test("automatic breath alternates draw and blow across the full pressure range", () => {
  const state = sanitizeHarmonicaState({
    ...HARMONICA_DEFAULTS,
    breathPressure: 3,
    breathBalance: 0.2,
  });
  assert.ok(harmonicaBreathCycleFlow(state, 0.1) < -2.99);
  assert.ok(harmonicaBreathCycleFlow(state, 0.6) > 2.99);
  assert.ok(Math.abs(harmonicaBreathCycleFlow(state, 0)) < 1e-12);
  assert.ok(Math.abs(harmonicaBreathCycleFlow(state, 1)) < 1e-12);
});

test("breath-shift slop maps cleanly from precise to inertial playing", () => {
  const pristine = harmonicaBreathShiftProfile({
    ...HARMONICA_DEFAULTS,
    breathShiftSlop: 0,
  });
  const loose = harmonicaBreathShiftProfile({
    ...HARMONICA_DEFAULTS,
    breathShiftSlop: 1,
  });
  assert.equal(pristine.amount, 0);
  assert.equal(loose.amount, 1);
  assert.ok(pristine.reedAttackSeconds >= 0.02);
  assert.ok(pristine.reedTailSeconds >= 0.03);
  for (const key of [
    "pressureTimeSeconds",
    "reedAttackSeconds",
    "reedTailSeconds",
    "holeSlideSeconds",
    "chamberBleed",
    "pitchScoopCents",
  ]) assert.ok(loose[key] > pristine[key], key);
});

test("blues techniques expose legal, self-sounding example patches and bounded controls", () => {
  assert.deepEqual({
    techniqueAmount: HARMONICA_LIMITS.techniqueAmount,
    techniqueRateHz: HARMONICA_LIMITS.techniqueRateHz,
    breathAttackMs: HARMONICA_LIMITS.breathAttackMs,
    breathReleaseMs: HARMONICA_LIMITS.breathReleaseMs,
    breathShiftSlop: HARMONICA_LIMITS.breathShiftSlop,
    handCup: HARMONICA_LIMITS.handCup,
    growl: HARMONICA_LIMITS.growl,
    tongueBlock: HARMONICA_LIMITS.tongueBlock,
    overbend: HARMONICA_LIMITS.overbend,
    rhythmSwing: HARMONICA_LIMITS.rhythmSwing,
  }, {
    techniqueAmount: [0, 2],
    techniqueRateHz: [0.1, 30],
    breathAttackMs: [0, 500],
    breathReleaseMs: [0, 1_000],
    breathShiftSlop: [0, 1],
    handCup: [0, 1],
    growl: [0, 2],
    tongueBlock: [0, 1],
    overbend: [0, 1.5],
    rhythmSwing: [-0.45, 0.45],
  });
  assert.deepEqual({
    bluesTechniqueId: HARMONICA_DEFAULTS.bluesTechniqueId,
    bluesRhythmId: HARMONICA_DEFAULTS.bluesRhythmId,
    techniqueAmount: HARMONICA_DEFAULTS.techniqueAmount,
    techniqueRateHz: HARMONICA_DEFAULTS.techniqueRateHz,
    breathAttackMs: HARMONICA_DEFAULTS.breathAttackMs,
    breathReleaseMs: HARMONICA_DEFAULTS.breathReleaseMs,
    breathShiftSlop: HARMONICA_DEFAULTS.breathShiftSlop,
    handCup: HARMONICA_DEFAULTS.handCup,
    growl: HARMONICA_DEFAULTS.growl,
    tongueBlock: HARMONICA_DEFAULTS.tongueBlock,
    overbend: HARMONICA_DEFAULTS.overbend,
    rhythmSwing: HARMONICA_DEFAULTS.rhythmSwing,
  }, {
    bluesTechniqueId: "growl",
    bluesRhythmId: "slow-drag",
    techniqueAmount: 1.22,
    techniqueRateHz: 22,
    breathAttackMs: 12,
    breathReleaseMs: 176,
    breathShiftSlop: 0.84,
    handCup: 0.9,
    growl: 1.28,
    tongueBlock: 0.24,
    overbend: 0,
    rhythmSwing: 0.3,
  });
  const expectedTechniqueIds = [
    "clean",
    "double-stop",
    "draw-bend",
    "blow-bend",
    "draw-scoop",
    "blow-scoop",
    "dip",
    "fall",
    "shake-warble",
    "tongue-slap",
    "hand-wah",
    "throat-vibrato",
    "flutter",
    "growl",
    "octave-tongue-block",
    "overblow",
    "overdraw",
    "train-chug",
  ];
  assert.deepEqual(HARMONICA_TECHNIQUES.map(({ id }) => id), expectedTechniqueIds);
  assert.equal(harmonicaTechnique("not-a-technique").id, "clean");
  assert.deepEqual(HARMONICA_DRAW_BEND_HOLES, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(HARMONICA_BLOW_BEND_HOLES, [7, 8, 9, 10]);
  assert.deepEqual(HARMONICA_OVERBLOW_HOLES, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(HARMONICA_OVERDRAW_HOLES, [7, 8, 9, 10]);

  for (const technique of HARMONICA_TECHNIQUES) {
    const state = applyHarmonicaTechnique(HARMONICA_DEFAULTS, technique.id);
    assert.equal(state.bluesTechniqueId, technique.id);
    if (technique.direction !== 0) assert.equal(state.breathDirection, technique.direction);
    if (technique.holes.length > 0) assert.ok(technique.holes.includes(state.hole));
    assert.equal(
      harmonicaTechniqueAllowed(state, state.hole, state.breathDirection),
      true,
      technique.id,
    );
    for (const key of [
      "techniqueAmount",
      "techniqueRateHz",
      "breathAttackMs",
      "breathReleaseMs",
      "breathShiftSlop",
      "handCup",
      "growl",
      "tongueBlock",
      "overbend",
      "rhythmSwing",
    ]) {
      const [minimum, maximum] = HARMONICA_LIMITS[key];
      assert.ok(state[key] >= minimum && state[key] <= maximum, `${technique.id}:${key}`);
    }
  }

  assert.equal(harmonicaTechniqueAllowed("draw-bend", 4, -1), true);
  assert.equal(harmonicaTechniqueAllowed("draw-bend", 4, 1), false);
  assert.equal(harmonicaTechniqueAllowed("blow-bend", 6, 1), false);
  assert.deepEqual(
    { ...harmonicaOverbendTarget(HARMONICA_DEFAULTS, 4, 1) },
    {
      legal: true,
      hole: 4,
      direction: 1,
      midi: 75,
      frequencyHz: harmonicaOverbendTarget(HARMONICA_DEFAULTS, 4, 1).frequencyHz,
      noteName: "E♭5",
    },
  );
  assert.equal(harmonicaOverbendTarget(HARMONICA_DEFAULTS, 4, -1).legal, false);
  assert.equal(harmonicaOverbendTarget(HARMONICA_DEFAULTS, 7, -1).midi, 85);
  const doubleStop = applyHarmonicaTechnique(HARMONICA_DEFAULTS, "double-stop");
  assert.equal(doubleStop.chordWidth, 2);
  assert.deepEqual(activeHoles(doubleStop), [4, 5]);
  HARMONICA_PERFORMANCE_PRESETS.forEach((performancePreset, presetIndex) => {
    let call = 0;
    const randomized = randomizeHarmonicaState(HARMONICA_DEFAULTS, () => {
      call += 1;
      return call === 1
        ? (presetIndex + 0.1) / HARMONICA_PERFORMANCE_PRESETS.length
        : 0.5;
    });
    assert.equal(randomized.performancePresetId, performancePreset.id);
    assert.equal(randomized.autoBreath, true);
    assert.notEqual(randomized.bluesRhythmId, "free");
    assert.ok(randomized.breathPressure >= 0.72);
    assert.ok(randomized.breathRateBpm >= 20 && randomized.breathRateBpm <= 96);
    assert.ok(randomized.airLeak <= 0.265);
    assert.ok(randomized.level >= 0.44);
    assert.equal(
      harmonicaTechniqueAllowed(randomized, randomized.hole, randomized.breathDirection),
      true,
      `randomized ${performancePreset.id}`,
    );
  });
});

test("performance presets combine audible rhythmic breath, gesture, cup, tongue, and legal examples", () => {
  assert.ok(HARMONICA_PERFORMANCE_PRESETS.length >= 12);
  assert.equal(HARMONICA_DEFAULTS.performancePresetId, "midnight-growl");
  assert.equal(HARMONICA_DEFAULTS.bluesTechniqueId, "growl");
  assert.ok(HARMONICA_DEFAULTS.growl > 1);
  assert.ok(HARMONICA_DEFAULTS.brightness >= 0.7, "the growly default keeps upper-reed twang");
  assert.ok(HARMONICA_PERFORMANCE_PRESETS.some(({ id }) => id === "front-porch-shuffle"));
  assert.equal(harmonicaPerformancePreset("missing").id, "midnight-growl");
  for (const performancePreset of HARMONICA_PERFORMANCE_PRESETS) {
    const performance = applyHarmonicaPerformancePreset(HARMONICA_DEFAULTS, performancePreset.id);
    assert.equal(performance.performancePresetId, performancePreset.id);
    assert.equal(performance.bluesTechniqueId, performancePreset.techniqueId);
    assert.equal(performance.bluesRhythmId, performancePreset.rhythmId);
    assert.equal(performance.autoBreath, true);
    assert.notEqual(performance.bluesRhythmId, "free");
    assert.ok(performance.breathPressure >= 0.9, performancePreset.id);
    assert.ok(performance.cupMotionDepth > 0, performancePreset.id);
    assert.ok(performance.tongueMotionDepth > 0, performancePreset.id);
    assert.ok(performance.breathShiftSlop >= 0 && performance.breathShiftSlop <= 1);
    assert.equal(
      harmonicaTechniqueAllowed(performance, performance.hole, performance.breathDirection),
      true,
      performancePreset.id,
    );
    const rhythm = harmonicaBluesRhythm(performance.bluesRhythmId);
    assert.ok(rhythm.steps.some((step) => step < 0), `${performancePreset.id}: draw`);
    assert.ok(rhythm.steps.some((step) => step > 0), `${performancePreset.id}: blow`);
  }
});

test("blues rhythms preserve signed draw, blow, rest, swing, and finite pressure", () => {
  assert.deepEqual(
    HARMONICA_BLUES_RHYTHMS.map(({ id }) => id),
    [
      "free", "train", "shuffle", "boogie", "triplet-call-response",
      "back-porch-shuffle", "freight-chug", "slow-drag", "walking-boogie",
      "hill-country-stomp", "porch-waltz", "gospel-response", "fox-chase",
      "hand-fan", "bent-triplets", "smoky-shuffle", "syncopated-sparks",
    ],
  );
  assert.equal(harmonicaBluesRhythm("missing").id, "free");
  const pressure = 1.4;
  for (const rhythm of HARMONICA_BLUES_RHYTHMS.slice(1)) {
    const state = sanitizeHarmonicaState({
      ...HARMONICA_DEFAULTS,
      bluesRhythmId: rhythm.id,
      breathPressure: pressure,
      breathAttackMs: 0,
      breathReleaseMs: 0,
      rhythmSwing: 0.32,
    });
    let start = 0;
    rhythm.steps.forEach((velocity, index) => {
      const duration = (1 / rhythm.steps.length) * (1 + (index % 2 === 0 ? 0.32 : -0.32));
      const flow = harmonicaBluesRhythmFlow(state, start + duration * 0.5);
      if (velocity === 0) assert.equal(flow, 0, `${rhythm.id}:${index}`);
      else {
        assert.equal(Math.sign(flow), Math.sign(velocity), `${rhythm.id}:${index}`);
        assert.ok(Math.abs(Math.abs(flow) - pressure * Math.abs(velocity)) < 1e-10);
      }
      start += duration;
    });
    assert.ok(Math.abs(start - 1) < 1e-12);
  }
  const extreme = sanitizeHarmonicaState({
    ...HARMONICA_DEFAULTS,
    bluesRhythmId: "triplet-call-response",
    breathPressure: 3,
    breathRateBpm: 1_200,
    breathAttackMs: 500,
    breathReleaseMs: 1_000,
    rhythmSwing: 0.45,
  });
  for (let index = 0; index <= 1_000; index += 1) {
    const flow = harmonicaBluesRhythmFlow(extreme, index / 1_000);
    assert.ok(Number.isFinite(flow));
    assert.ok(Math.abs(flow) <= 3);
  }
  const invalid = sanitizeHarmonicaState({
    ...HARMONICA_DEFAULTS,
    bluesTechniqueId: "missing",
    bluesRhythmId: "missing",
  });
  assert.equal(invalid.bluesTechniqueId, "clean");
  assert.equal(invalid.bluesRhythmId, "free");
});

test("harmonica worklet couples pressure, tract, paired reeds, and material without instability", async () => {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  const messages = [];
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage: (message) => messages.push(message) };
    }
  };
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, "harmonica-physical-model");
    Processor = implementation;
  };
  try {
    await import(`../src/harmonica-processor.js?test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const makeProcessor = (configuration = {}) => new Processor({
      processorOptions: {
        configuration: sanitizeHarmonicaState({
          ...HARMONICA_DEFAULTS,
          autoBreath: false,
          vibratoDepth: 0,
          tremoloDepth: 0,
          ...configuration,
        }),
      },
    });
    const render = (processor, blocks = 1, measureAfterBlock = 0) => {
      let peak = 0;
      let sum = 0;
      let samples = 0;
      let saturationSamples = 0;
      let maxDelta = 0;
      let signature = 0;
      let signatureIndex = 0;
      let previousLeft = processor.__testPreviousLeft ?? 0;
      let previousRight = processor.__testPreviousRight ?? 0;
      for (let block = 0; block < blocks; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        for (let frame = 0; frame < left.length; frame += 1) {
          const leftSample = left[frame];
          const rightSample = right[frame];
          assert.ok(Number.isFinite(leftSample));
          assert.ok(Number.isFinite(rightSample));
          assert.ok(Math.abs(leftSample) <= 0.781);
          assert.ok(Math.abs(rightSample) <= 0.781);
          if (block < measureAfterBlock) {
            previousLeft = leftSample;
            previousRight = rightSample;
            continue;
          }
          peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
          sum += leftSample * leftSample + rightSample * rightSample;
          signature += leftSample * Math.sin(signatureIndex * 0.017)
            + rightSample * Math.cos(signatureIndex * 0.013);
          signatureIndex += 1;
          saturationSamples += Math.abs(leftSample) > 0.75 ? 1 : 0;
          saturationSamples += Math.abs(rightSample) > 0.75 ? 1 : 0;
          maxDelta = Math.max(
            maxDelta,
            Math.abs(leftSample - previousLeft),
            Math.abs(rightSample - previousRight),
          );
          previousLeft = leftSample;
          previousRight = rightSample;
          samples += 2;
        }
      }
      processor.__testPreviousLeft = previousLeft;
      processor.__testPreviousRight = previousRight;
      return {
        peak,
        energy: sum,
        rms: Math.sqrt(sum / Math.max(1, samples)),
        samples,
        saturationRatio: saturationSamples / Math.max(1, samples),
        maxDelta,
        signature,
      };
    };

    const resting = makeProcessor();
    assert.equal(render(resting, 8).peak, 0);

    const holeFour = { hole: 4, chordWidth: 1, bend: 0 };
    const blowVoice = makeProcessor(holeFour);
    blowVoice._handleMessage({ type: "breath", flow: 0.9, manual: true });
    const blow = render(blowVoice, 180, 80);
    const expectedBlow = harmonicaCoupledReedState(
      { ...HARMONICA_DEFAULTS, ...holeFour, vibratoDepth: 0 },
      4,
      1,
      0.9,
    );
    assert.ok(blow.peak > 0.01 && blow.energy > 0.1);
    assert.ok(Math.abs(blowVoice.activeFrequencyHz / expectedBlow.frequencyHz - 1) < 0.015);

    const drawVoice = makeProcessor(holeFour);
    drawVoice._handleMessage({ type: "breath", flow: -0.9, manual: true });
    const draw = render(drawVoice, 180, 80);
    const expectedDraw = harmonicaCoupledReedState(
      { ...HARMONICA_DEFAULTS, ...holeFour, vibratoDepth: 0 },
      4,
      -1,
      -0.9,
    );
    assert.ok(draw.peak > 0.01 && draw.energy > 0.1);
    assert.ok(Math.abs(drawVoice.activeFrequencyHz / expectedDraw.frequencyHz - 1) < 0.015);
    assert.ok(Math.abs(drawVoice.activeFrequencyHz - blowVoice.activeFrequencyHz) > 45);

    const immediateAttack = makeProcessor({
      ...holeFour,
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    const slowAttack = makeProcessor({
      ...holeFour,
      breathAttackMs: 400,
      breathReleaseMs: 0,
      handCup: 0,
    });
    immediateAttack._handleMessage({ type: "breath", flow: -1, manual: true });
    slowAttack._handleMessage({ type: "breath", flow: -1, manual: true });
    const immediateAttackRender = render(immediateAttack, 20);
    const slowAttackRender = render(slowAttack, 20);
    assert.ok(Math.abs(immediateAttack.breathFlow) > 0.99);
    assert.ok(Math.abs(slowAttack.breathFlow) < 0.14);
    assert.ok(immediateAttackRender.energy > slowAttackRender.energy * 2);

    const immediateRelease = makeProcessor({
      ...holeFour,
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    const slowRelease = makeProcessor({
      ...holeFour,
      breathAttackMs: 0,
      breathReleaseMs: 500,
      handCup: 0,
    });
    for (const voice of [immediateRelease, slowRelease]) {
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      render(voice, 80, 40);
      voice._handleMessage({ type: "breath", flow: 0, manual: true });
    }
    const immediateReleaseRender = render(immediateRelease, 60, 30);
    const slowReleaseRender = render(slowRelease, 60, 30);
    assert.equal(immediateRelease.breathFlow, 0);
    assert.ok(Math.abs(slowRelease.breathFlow) > 0.7);
    assert.ok(slowReleaseRender.energy > immediateReleaseRender.energy * 4);

    const subThreshold = makeProcessor({ hole: 3, reedGap: 0.72 });
    subThreshold._handleMessage({ type: "breath", flow: -0.02, manual: true });
    const whisper = render(subThreshold, 100, 40);
    assert.ok(subThreshold.envelopes.every((value) => value === 0));
    assert.ok(whisper.rms < draw.rms * 0.08);

    const bendMouth = {
      tonguePosition: 0.46,
      tongueHeight: 0.34,
      throatOpening: 0.42,
      embouchure: 0.5,
    };
    const noTract = makeProcessor({
      hole: 3, bend: 1, vocalTractCoupling: 0, ...bendMouth,
    });
    noTract._handleMessage({ type: "breath", flow: -0.9, manual: true });
    render(noTract, 220, 100);
    const strongTract = makeProcessor({
      hole: 3, bend: 1, vocalTractCoupling: 2, ...bendMouth,
    });
    strongTract._handleMessage({ type: "breath", flow: -0.9, manual: true });
    render(strongTract, 220, 100);
    assert.ok(strongTract.activeBendSemitones > 1.4);
    assert.ok(strongTract.activeFrequencyHz < noTract.activeFrequencyHz * Math.pow(2, -1 / 12));
    assert.ok(strongTract.envelopes[2] > 0.1, "the opposing blow reed must join a draw bend");
    assert.equal(noTract.envelopes[2], 0);
    assert.ok(strongTract.activePassiveGain > 0.14);

    for (const [techniqueId, direction] of [["draw-scoop", -1], ["blow-scoop", 1]]) {
      const scoopState = sanitizeHarmonicaState({
        ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, techniqueId),
        breathAttackMs: 0,
        breathReleaseMs: 0,
        vibratoDepth: 0,
        tremoloDepth: 0,
        handCup: 0,
      });
      const scoop = makeProcessor(scoopState);
      scoop._handleMessage({ type: "breath", flow: direction, manual: true });
      render(scoop, 2);
      const earlyContour = scoop.techniqueBendContour;
      const earlyFrequency = scoop.activeFrequencyHz;
      const earlyBend = scoop.activeBendSemitones;
      render(scoop, 16);
      const middleFrequency = scoop.activeFrequencyHz;
      render(scoop, 70);
      const lateContour = scoop.techniqueBendContour;
      const lateFrequency = scoop.activeFrequencyHz;
      assert.ok(earlyContour > 0.9, `${techniqueId}: ${earlyContour}`);
      assert.ok(lateContour < 0.03, `${techniqueId}: ${lateContour}`);
      assert.ok(earlyBend > 0.15, `${techniqueId}: ${earlyBend}`);
      assert.ok(middleFrequency > earlyFrequency, `${techniqueId}: ${earlyFrequency} -> ${middleFrequency}`);
      assert.ok(lateFrequency > middleFrequency, `${techniqueId}: ${middleFrequency} -> ${lateFrequency}`);
    }

    const shake = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "shake-warble"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      techniqueRateHz: 5,
      handCup: 0,
    });
    shake._handleMessage({ type: "breath", flow: -1, manual: true });
    render(shake, 1);
    assert.ok(shake.holeWeights[3] > 0.98);
    assert.ok(shake.holeWeights[3] > shake.holeWeights[4] * 4);
    render(shake, 37);
    assert.ok(shake.holeWeights[4] > 0.98);
    assert.ok(shake.holeWeights[4] > shake.holeWeights[3] * 4);
    assert.ok(shake.envelopes[14] > 0.1, "warble must excite the neighboring draw reed");

    const slap = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "tongue-slap"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    slap._handleMessage({ type: "breath", flow: 1, manual: true });
    const slapAttack = render(slap, 2);
    assert.ok(slap.tongueSlapEnvelope > 0.8);
    assert.ok(slap.holeWeights[2] > 0.35 && slap.holeWeights[4] > 0.35);
    assert.ok(slap.envelopes[2] > 0.02 && slap.envelopes[4] > 0.02);
    render(slap, 120);
    assert.ok(slap.tongueSlapEnvelope < 0.001);
    assert.ok(slap.holeWeights[2] < 0.01 && slap.holeWeights[4] < 0.01);
    assert.ok(slapAttack.peak > 0.01);

    const octave = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "octave-tongue-block"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    octave._handleMessage({ type: "breath", flow: 1, manual: true });
    render(octave, 100, 40);
    assert.ok(octave.envelopes[0] > 0.1 && octave.envelopes[3] > 0.1);
    assert.ok(octave.envelopes[1] < 0.01 && octave.envelopes[2] < 0.01);

    const doubleStop = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "double-stop"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    doubleStop._handleMessage({ type: "breath", flow: -1, manual: true });
    render(doubleStop, 100, 40);
    assert.ok(doubleStop.envelopes[13] > 0.1 && doubleStop.envelopes[14] > 0.1);

    const fiveHoleChord = makeProcessor({
      hole: 1,
      chordWidth: 5,
      tongueBlock: 0,
      tongueMotionDepth: 0,
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
      cupMotionDepth: 0,
      growl: 0,
    });
    fiveHoleChord._handleMessage({ type: "breath", flow: -1, manual: true });
    render(fiveHoleChord, 100, 40);
    assert.deepEqual(fiveHoleChord.openHoleIndices, [0, 1, 2, 3, 4]);
    assert.equal(
      [10, 11, 12, 13, 14].filter((index) => fiveHoleChord.envelopes[index] > 0.05).length,
      5,
    );

    const sideBlocked = makeProcessor({
      hole: 4,
      chordWidth: 4,
      tongueBlock: 1,
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    sideBlocked._handleMessage({ type: "breath", flow: -1, manual: true });
    render(sideBlocked, 1);
    assert.ok(sideBlocked.holeWeights[3] > 0.9, "the selected edge remains exposed");
    assert.ok(sideBlocked.holeWeights[0] < 0.07);
    assert.ok(sideBlocked.holeWeights[1] < 0.07);
    assert.ok(sideBlocked.holeWeights[2] < 0.07);
    assert.ok(sideBlocked.holeWeights[4] < 0.07);
    assert.ok(sideBlocked.holeWeights[5] < 0.07);

    const sliding = makeProcessor({
      hole: 4,
      chordWidth: 1,
      breathAttackMs: 0,
      breathReleaseMs: 90,
      handCup: 0,
    });
    sliding._handleMessage({ type: "breath", flow: -1, manual: true });
    render(sliding, 100, 40);
    sliding._handleMessage({ type: "configure", configuration: { hole: 5 } });
    const slideAttack = render(sliding, 2);
    assert.ok(sliding.apertureHoleWeights[3] > 0.75, "the departing chamber still speaks");
    assert.ok(sliding.apertureHoleWeights[4] > 0.025, "the arriving chamber fades in");
    assert.ok(sliding.envelopes[13] > 0.1 && sliding.envelopes[14] > 0.001);
    assert.ok(sliding.holeMotionEnergy > 0.45);
    assert.ok(slideAttack.peak > 0.01 && slideAttack.maxDelta < 0.25);
    render(sliding, 180);
    assert.ok(sliding.apertureHoleWeights[3] < 0.005);
    assert.ok(sliding.apertureHoleWeights[4] > 0.995);
    assert.ok(sliding.holeMotionEnergy < 0.02);

    const shiftedBreathVoice = (breathShiftSlop) => {
      const voice = makeProcessor({
        hole: 4,
        chordWidth: 1,
        bluesTechniqueId: "clean",
        breathAttackMs: 0,
        breathReleaseMs: 0,
        breathShiftSlop,
        handCup: 0,
        cupMotionDepth: 0,
        tongueBlock: 0,
        tongueMotionDepth: 0,
        growl: 0,
      });
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      render(voice, 120, 40);
      voice._handleMessage({ type: "breath", flow: 1, manual: true });
      return { voice, transition: render(voice, 24) };
    };
    const pristineShift = shiftedBreathVoice(0);
    const sloppyShift = shiftedBreathVoice(1);
    assert.ok(pristineShift.voice.breathFlow > 0.9);
    assert.ok(sloppyShift.voice.breathFlow > 0.15);
    assert.ok(sloppyShift.voice.envelopes[13] > pristineShift.voice.envelopes[13] * 1.2);
    assert.ok(sloppyShift.voice.envelopes[3] < pristineShift.voice.envelopes[3] * 0.8);
    assert.ok(sloppyShift.voice.envelopes[13] > 0.08);
    assert.ok(sloppyShift.voice.envelopes[3] > 0.03);
    assert.ok(sloppyShift.transition.maxDelta < 0.25);
    assert.ok(sloppyShift.voice.breathShiftSamplesRemaining > 0);

    const shiftedAuthoredEnvelope = (breathShiftSlop) => {
      const voice = makeProcessor({
        hole: 4,
        chordWidth: 1,
        bluesTechniqueId: "clean",
        breathAttackMs: 12,
        breathReleaseMs: 176,
        breathShiftSlop,
        handCup: 0,
        cupMotionDepth: 0,
        tongueBlock: 0,
        tongueMotionDepth: 0,
        growl: 0,
      });
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      render(voice, 120, 40);
      voice._handleMessage({ type: "breath", flow: 1, manual: true });
      return { voice, transition: render(voice, 24) };
    };
    const pristineAuthoredShift = shiftedAuthoredEnvelope(0);
    const sloppyAuthoredShift = shiftedAuthoredEnvelope(1);
    assert.ok(pristineAuthoredShift.voice.breathFlow > 0.9);
    assert.ok(pristineAuthoredShift.voice.envelopes[3] > 0.8);
    assert.ok(pristineAuthoredShift.voice.envelopes[13] < 0.25);
    assert.ok(pristineAuthoredShift.transition.maxDelta < 0.25);
    assert.ok(sloppyAuthoredShift.voice.envelopes[3] < sloppyAuthoredShift.voice.envelopes[13]);
    assert.ok(pristineAuthoredShift.voice.breathFlow > sloppyAuthoredShift.voice.breathFlow);

    const rawControlRender = (configuration) => {
      const voice = makeProcessor({
        ...holeFour,
        breathAttackMs: 0,
        breathReleaseMs: 0,
        bluesTechniqueId: "clean",
        techniqueRateHz: 7.3,
        cupMotionDepth: 0,
        tongueMotionDepth: 0,
        ...configuration,
      });
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      return { voice, rendered: render(voice, 180, 80) };
    };
    const openHand = rawControlRender({ handCup: 0, tongueBlock: 0, growl: 0 });
    const closedHand = rawControlRender({ handCup: 1, tongueBlock: 0, growl: 0 });
    const tongueClosed = rawControlRender({ handCup: 0, tongueBlock: 1, growl: 0 });
    const growling = rawControlRender({ handCup: 0, tongueBlock: 0, growl: 2 });
    const cupRmsDelta = Math.abs(closedHand.rendered.rms / openHand.rendered.rms - 1);
    const cupSignatureDelta = Math.abs(
      closedHand.rendered.signature - openHand.rendered.signature,
    );
    assert.ok(cupRmsDelta > 0.04 || cupSignatureDelta > 0.5);
    assert.ok(closedHand.voice.handResonanceFrequencyHz < 600);
    assert.ok(openHand.voice.handResonanceFrequencyHz > 3_000);
    assert.ok(closedHand.voice.handResonanceGain > 0.45);
    assert.equal(openHand.voice.handResonanceGain, 0);
    assert.ok(Math.abs(tongueClosed.rendered.rms / openHand.rendered.rms - 1) > 0.05);
    assert.ok(growling.rendered.rms > 0.01);
    assert.ok(Math.abs(growling.rendered.signature - openHand.rendered.signature) > 0.5);

    const movingMouth = makeProcessor({
      ...holeFour,
      bluesTechniqueId: "clean",
      breathAttackMs: 0,
      breathReleaseMs: 0,
      techniqueRateHz: 4,
      handCup: 0.9,
      cupMotionDepth: 1,
      tongueBlock: 0.85,
      tongueMotionDepth: 1,
    });
    movingMouth._handleMessage({ type: "breath", flow: -1, manual: true });
    let minimumEffectiveCup = 1;
    let maximumEffectiveCup = 0;
    let minimumHandResonanceHz = Infinity;
    let maximumHandResonanceHz = 0;
    let minimumEffectiveTongue = 1;
    let maximumEffectiveTongue = 0;
    for (let block = 0; block < 130; block += 1) {
      render(movingMouth, 1);
      minimumEffectiveCup = Math.min(minimumEffectiveCup, movingMouth.effectiveHandCup);
      maximumEffectiveCup = Math.max(maximumEffectiveCup, movingMouth.effectiveHandCup);
      minimumHandResonanceHz = Math.min(
        minimumHandResonanceHz,
        movingMouth.handResonanceFrequencyHz,
      );
      maximumHandResonanceHz = Math.max(
        maximumHandResonanceHz,
        movingMouth.handResonanceFrequencyHz,
      );
      minimumEffectiveTongue = Math.min(minimumEffectiveTongue, movingMouth.effectiveTongueBlock);
      maximumEffectiveTongue = Math.max(maximumEffectiveTongue, movingMouth.effectiveTongueBlock);
    }
    assert.ok(maximumEffectiveCup - minimumEffectiveCup > 0.7);
    assert.ok(maximumHandResonanceHz - minimumHandResonanceHz > 1_500);
    assert.ok(maximumEffectiveTongue - minimumEffectiveTongue > 0.65);
    assert.ok(minimumEffectiveTongue > 0.1, "tongue motion must retain an audible onset aperture");

    for (const [hole, direction, chokedBank, openingIndex] of [
      [4, 1, "blow", 13],
      [7, -1, "draw", 6],
    ]) {
      const overbend = makeProcessor({
        hole,
        chordWidth: 1,
        bend: 0,
        overbend: 1,
        bluesTechniqueId: "clean",
        breathAttackMs: 0,
        breathReleaseMs: 0,
        vibratoDepth: 0,
        tremoloDepth: 0,
        handCup: 0,
      });
      overbend._handleMessage({ type: "breath", flow: direction, manual: true });
      const overbendRender = render(overbend, 150, 60);
      const target = harmonicaOverbendTarget(overbend.configuration, hole, direction);
      const chokedIndex = direction > 0 ? hole - 1 : 10 + hole - 1;
      assert.equal(overbend.overbendActive, true);
      assert.equal(overbend.overbendGate, 1);
      assert.equal(overbend.chokedReed, chokedBank);
      assert.ok(Math.abs(overbend.activeFrequencyHz / target.frequencyHz - 1) < 0.001);
      assert.ok(overbend.envelopes[chokedIndex] < overbend.envelopes[openingIndex] * 0.02);
      assert.ok(overbend.envelopes[openingIndex] > 0.4);
      assert.ok(overbend.pairCouplings[hole - 1] < 1e-4);
      assert.ok(overbendRender.maxDelta < 0.2);

      overbend._handleMessage({
        type: "configure",
        configuration: { overbend: 0 },
      });
      let sawRelease = false;
      for (let block = 0; block < 90; block += 1) {
        render(overbend, 1);
        sawRelease ||= overbend.overbendReleaseActive;
      }
      assert.equal(sawRelease, true);
      assert.equal(overbend.overbendActive, false);
      assert.equal(overbend.overbendReleaseActive, false);
      assert.equal(overbend.overbendLatches[hole - 1], 0);
      assert.ok(overbend.envelopes[chokedIndex] > overbend.envelopes[openingIndex]);
    }

    const illegalOverbend = makeProcessor({
      hole: 7,
      chordWidth: 1,
      overbend: 1.5,
      bluesTechniqueId: "clean",
      breathAttackMs: 0,
      handCup: 0,
    });
    illegalOverbend._handleMessage({ type: "breath", flow: 1, manual: true });
    render(illegalOverbend, 100, 40);
    assert.equal(illegalOverbend.overbendActive, false);
    assert.ok(illegalOverbend.overbendLatches.every((value) => value === 0));

    const dip = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "dip"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    dip._handleMessage({ type: "breath", flow: -1, manual: true });
    render(dip, 1);
    const dipStart = dip.techniqueBendContour;
    render(dip, 40);
    const dipMiddle = dip.techniqueBendContour;
    render(dip, 70);
    const dipEnd = dip.techniqueBendContour;
    assert.ok(dipStart < 0.1 && dipMiddle > 0.85 && dipEnd < 0.01);

    const fall = makeProcessor({
      ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, "fall"),
      breathAttackMs: 0,
      breathReleaseMs: 0,
      handCup: 0,
    });
    fall._handleMessage({ type: "breath", flow: -1, manual: true });
    render(fall, 1);
    const fallStart = fall.techniqueBendContour;
    render(fall, 90);
    const fallEnd = fall.techniqueBendContour;
    const ageBeforeReattack = fall.techniqueAgeSeconds;
    fall._handleMessage({ type: "breath", flow: 0, manual: true });
    render(fall, 1);
    fall._handleMessage({ type: "breath", flow: -1, manual: true });
    render(fall, 1);
    assert.ok(fallStart < 0.01 && fallEnd > 0.99);
    assert.ok(fall.techniqueAgeSeconds < ageBeforeReattack * 0.1);
    assert.ok(fall.techniqueBendContour < 0.01);

    const compareTechniqueWithRawPatch = (techniqueId) => {
      const patch = sanitizeHarmonicaState({
        ...applyHarmonicaTechnique(HARMONICA_DEFAULTS, techniqueId),
        breathAttackMs: techniqueId === "train-chug" ? 10 : 0,
        breathReleaseMs: techniqueId === "train-chug" ? 34 : 0,
        tonguePosition: 0.46,
        tongueHeight: 0.34,
        throatOpening: 0.42,
        embouchure: 0.5,
        vocalTractCoupling: 1.16,
        handCup: techniqueId === "hand-wah"
          ? applyHarmonicaTechnique(HARMONICA_DEFAULTS, techniqueId).handCup
          : 0,
      });
      const techniqueVoice = makeProcessor(patch);
      const rawPatchVoice = makeProcessor({ ...patch, bluesTechniqueId: "clean" });
      if (!patch.autoBreath) {
        const flow = patch.breathDirection * Math.max(0.9, patch.breathPressure);
        techniqueVoice._handleMessage({ type: "breath", flow, manual: true });
        rawPatchVoice._handleMessage({ type: "breath", flow, manual: true });
      }
      return [render(techniqueVoice, 55), render(rawPatchVoice, 55)];
    };
    for (const techniqueId of [
      "draw-scoop",
      "blow-scoop",
      "dip",
      "fall",
      "shake-warble",
      "tongue-slap",
      "hand-wah",
      "throat-vibrato",
      "flutter",
      "growl",
      "octave-tongue-block",
    ]) {
      const [techniqueRender, rawPatchRender] = compareTechniqueWithRawPatch(techniqueId);
      assert.ok(techniqueRender.peak > 0.002, techniqueId);
      const techniqueSignatureDelta = Math.abs(
        techniqueRender.signature - rawPatchRender.signature,
      );
      assert.ok(
        techniqueSignatureDelta > 0.01,
        `${techniqueId} must alter DSP, not only metadata (${techniqueSignatureDelta})`,
      );
    }

    for (const technique of HARMONICA_TECHNIQUES) {
      const techniqueState = applyHarmonicaTechnique(HARMONICA_DEFAULTS, technique.id);
      const voice = makeProcessor(techniqueState);
      if (!techniqueState.autoBreath) {
        voice._handleMessage({
          type: "breath",
          flow: techniqueState.breathDirection * Math.max(0.9, techniqueState.breathPressure),
          manual: true,
        });
      }
      const rendered = render(voice, 70);
      assert.ok(rendered.peak > 0.001, technique.id);
      assert.ok(Number.isFinite(rendered.signature), technique.id);
      for (const values of [voice.envelopes, voice.frequencies, voice.holeWeights]) {
        assert.ok(values.every(Number.isFinite), technique.id);
      }
    }

    const train = makeProcessor(applyHarmonicaTechnique(HARMONICA_DEFAULTS, "train-chug"));
    const trainDirections = new Set();
    const trainSteps = new Set();
    let trainOnsets = 0;
    let trainSlapPeak = 0;
    let previousTrainAge = Infinity;
    let trainMaxDelta = 0;
    for (let block = 0; block < 760; block += 1) {
      const blockRender = render(train, 1);
      trainMaxDelta = Math.max(trainMaxDelta, blockRender.maxDelta);
      if (Math.abs(train.breathFlow) > 0.02) trainDirections.add(Math.sign(train.breathFlow));
      trainSteps.add(train.rhythmStepIndex);
      trainSlapPeak = Math.max(trainSlapPeak, train.tongueSlapEnvelope);
      if (train.techniqueAgeSeconds < previousTrainAge) trainOnsets += 1;
      previousTrainAge = train.techniqueAgeSeconds;
    }
    assert.deepEqual([...trainDirections].sort(), [-1, 1]);
    assert.ok([...trainSteps].some((index) => (
      HARMONICA_BLUES_RHYTHMS.find(({ id }) => id === "train").steps[index] === 0
    )));
    assert.ok(trainOnsets >= 4);
    assert.ok(trainSlapPeak > 0.2);
    assert.ok(trainMaxDelta < 0.25);

    const releaseRatio = (presetId) => {
      const voice = makeProcessor(harmonicaState(presetId, {
        hole: 4,
        chordWidth: 1,
        reedGap: 0.72,
        reedStiffness: 1,
        airLeak: 0.04,
        bend: 0,
        vibratoDepth: 0,
        tremoloDepth: 0,
        // Isolate reed/material ring-down from the separately modeled player's
        // breath-release envelope.
        breathReleaseMs: 0,
      }));
      voice._handleMessage({ type: "breath", flow: -0.9, manual: true });
      render(voice, 180, 80);
      const before = Math.max(...voice.envelopes);
      voice._handleMessage({ type: "breath", flow: 0, manual: true });
      render(voice, 65, 30);
      return Math.max(...voice.envelopes) / before;
    };
    const steelRetention = releaseRatio("g-richter");
    const brassRetention = releaseRatio("a-richter");
    assert.ok(steelRetention > brassRetention * 1.8, `${steelRetention} vs ${brassRetention}`);

    const silenced = makeProcessor({ autoBreath: true, breathRateBpm: 1_200 });
    silenced._handleMessage({ type: "breath", flow: -1, manual: true });
    assert.ok(render(silenced, 80, 30).peak > 0.01);
    silenced._handleMessage({ type: "silence" });
    silenced._handleMessage({
      type: "configure",
      configuration: { autoBreath: true, tongueHeight: 3, vocalTractCoupling: 2 },
    });
    assert.equal(render(silenced, 40).peak, 0);
    assert.equal(silenced.silenced, true);
    silenced._handleMessage({ type: "breath", flow: -1, manual: true });
    assert.ok(render(silenced, 80, 30).peak > 0.01);

    const extreme = makeProcessor({
      hole: 3,
      chordWidth: 4,
      bend: 1.5,
      reedGap: 0.02,
      reedStiffness: 0.2,
      airLeak: 0,
      tonguePosition: -2,
      tongueHeight: 3,
      throatOpening: -2,
      embouchure: 3,
      vocalTractCoupling: 2,
      brightness: 2,
      vibratoRateHz: 18,
      vibratoDepth: 2,
      tremoloRateHz: 30,
      tremoloDepth: 1,
    });
    extreme._handleMessage({ type: "breath", flow: -3, manual: true });
    const extremeRender = render(extreme, 260, 100);
    assert.ok(extremeRender.peak <= 0.781);
    assert.ok(extremeRender.saturationRatio < 0.01);
    assert.ok(extremeRender.peak / extremeRender.rms > 1.25);
    for (const values of [
      extreme.envelopes,
      extreme.frequencies,
      extreme.baseFrequencies,
      extreme.reedPositions,
      extreme.reedVelocities,
      extreme.pairCouplings,
    ]) assert.ok(values.every(Number.isFinite));
    assert.ok(Number.isFinite(extreme.reedDisplacement));

    const presetMorph = makeProcessor({ hole: 4 });
    presetMorph._handleMessage({ type: "breath", flow: -0.9, manual: true });
    render(presetMorph, 100, 40);
    presetMorph._handleMessage({
      type: "configure",
      configuration: harmonicaState("low-c", { hole: 4, autoBreath: false }),
    });
    const morph = render(presetMorph, 220, 20);
    assert.equal(presetMorph.configuration.presetId, "low-c");
    assert.equal(presetMorph.presetTransition, null);
    assert.ok(morph.maxDelta < 0.5);

    const keyMorph = makeProcessor({ hole: 4, keyId: "c" });
    keyMorph._handleMessage({ type: "breath", flow: -0.9, manual: true });
    render(keyMorph, 100, 40);
    keyMorph._handleMessage({
      type: "configure",
      configuration: { keyId: "g" },
    });
    const retuned = render(keyMorph, 220, 20);
    assert.equal(keyMorph.configuration.keyId, "g");
    assert.equal(keyMorph.presetTransition, null);
    assert.ok(retuned.maxDelta < 0.5);

    for (let hole = 1; hole <= 10; hole += 1) {
      for (const direction of [-1, 1]) {
        const voice = makeProcessor({ hole, chordWidth: 1, bend: 1.5 });
        voice._handleMessage({ type: "breath", flow: direction * 1.2, manual: true });
        const rendered = render(voice, 50, 20);
        assert.ok(rendered.peak > 0, `hole ${hole}, direction ${direction}`);
        assert.ok(Number.isFinite(voice.activeFrequencyHz));
      }
    }
    assert.ok(messages.some(({ type }) => type === "telemetry"));
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});

test("harmonica page exposes the dedicated model and accessible controls", async () => {
  const [html, css, app, processor] = await Promise.all([
    readFile(new URL("harmonica.html", root), "utf8"),
    readFile(new URL("harmonica.css", root), "utf8"),
    readFile(new URL("harmonica-app.js", root), "utf8"),
    readFile(new URL("src/harmonica-processor.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="[^"]*\bharmonica-page\b[^"]*"/);
  assert.match(html, /<title>Harmonicazoid · Morphazoid<\/title>/);
  assert.match(html, /<h1>HARMONI<br \/>CAZOID<\/h1>/);
  assert.match(html, /id="stage"[\s\S]*tabindex="0"/);
  assert.match(html, /round, unfilled head, nose, and hands traced in pink and blue/);
  assert.match(html, /id="blowButton"/);
  assert.match(html, /id="drawButton"/);
  assert.doesNotMatch(html, /id="holeButtons"/);
  assert.match(html, /id="keySelect"/);
  assert.match(html, /id="chordWidthButtons"/);
  assert.equal((html.match(/data-chord-width="[1-5]"/g) ?? []).length, 5);
  assert.match(html, /data-chord-width="2"[\s\S]*?double-stop/);
  assert.doesNotMatch(html, /id="holeWindow(?:Left|Right)?"/);
  assert.match(html, /pull either edge of the mouth bracket in the NOTE \/ HOLE view/);
  assert.match(html, /id="breathRateBpm"/);
  assert.match(html, /data-section="breath"[\s\S]*?id="breathPressure"[\s\S]*?id="breathBalance"[\s\S]*?id="breathShiftSlop"[\s\S]*?id="breathMeter"/);
  assert.match(html, /departing reed ring[\s\S]*?adjacent-hole breath smear/);
  assert.match(html, /Breath rhythm[\s\S]*?patterned draw and blow attacks/);
  assert.match(html, /CUP horizontally to sweep the cover-hand cavity resonance/);
  for (const key of Object.keys(HARMONICA_LIMITS)) {
    if (["breathFlow"].includes(key)) continue;
    assert.match(html, new RegExp(`id="${key}"`), key);
  }
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /new AudioWorkletNode\(context, "harmonica-physical-model"/);
  assert.match(app, /pointercancel/);
  assert.match(app, /lostpointercapture/);
  assert.match(app, /function breathFlowForDisplay\(/);
  assert.match(app, /function nearestHandle\(/);
  assert.match(app, /function formatMouthAperture\(/);
  assert.match(app, /function canvasMouthApertureLabel\(/);
  assert.match(app, /const playerOutlinePink = "#ff7daf"/);
  assert.match(app, /const playerOutlineBlue = "#69d5dd"/);
  assert.match(app, /function strokePlayerOutline\(/);
  assert.match(app, /drawing\.bezierCurveTo\([\s\S]*?headRight[\s\S]*?headBottom/);
  assert.match(app, /strokePlayerOutline\(compact \? 1\.15 : 1\.8, 0\.96\)/);
  assert.match(app, /drawing\.arc\(mouthCenterX, noseY, noseRadius, 0, Math\.PI \* 2\)/);
  assert.match(app, /const strokeHollowDigit = [\s\S]*?strokePath\(playerOutlineBlue[\s\S]*?strokePath\(playerOutlinePink/);
  assert.match(app, /const drawSupportPalm = [\s\S]*?drawing\.bezierCurveTo/);
  assert.match(app, /const drawCupPalm = [\s\S]*?drawing\.bezierCurveTo/);
  assert.match(app, /const supportIndex = \{/);
  assert.match(app, /const rightFingers = rightFingerRoots\.map/);
  assert.match(app, /const handDigits = \[supportIndex, \.\.\.rightFingers\]/);
  assert.match(app, /Only the curled fingertip is redrawn over the cover/);
  assert.doesNotMatch(app, /const strokeFinger =|strokeFinger\(/);
  assert.match(app, /const tongueRight = tongueLeft \+ cavityWidth \* \(0\.38 \+ tongueAmount \* 0\.5\)/);
  assert.match(app, /const tongueThickness = clamp\(lipHalfHeight \* 0\.62/);
  assert.match(app, /const tongueBlockedHoles = coveredList\.filter/);
  assert.match(app, /strokePlayerOutline\(compact \? 1\.65 : 2\.7, 0\.98\)/);
  assert.doesNotMatch(app, /checkerboardPattern|fillCheckerboardFace|handCheckerPattern/);
  const playerHeadArt = app.match(/const headTop =[\s\S]*?\/\/ Bold outer lips/)?.[0] ?? "";
  const playerHandArt = app.match(/const drawSupportPalm =[\s\S]*?\/\/ Bright instrument body/)?.[0] ?? "";
  assert.doesNotMatch(playerHeadArt, /drawing\.fill\(/);
  assert.doesNotMatch(playerHandArt, /drawing\.fill\(/);
  assert.match(app, /const headBreathBob = prefersReducedMotion[\s\S]*?breathUnit \* clamp/);
  assert.doesNotMatch(app, /installApertureWindowInteractions|aperturePointerDrag/);
  assert.match(app, /function aperturePatch\(/);
  assert.match(app, /Math\.min\(5, HARMONICA_LIMITS\.chordWidth\[1\]\)/);
  assert.match(app, /HARMONICA_HOLE_COUNT/);
  assert.match(app, /const renderedHoleCount = HARMONICA_HOLE_COUNT/);
  assert.match(app, /holeRegions\.push\(\{ type: "play-hole"/);
  assert.match(app, /handles\.push\(\{ type, x, y: bracketY/);
  assert.match(app, /HAND.*handResonanceFrequencyHz/);
  assert.match(app, /state = harmonicaState\(HARMONICA_DEFAULTS\.presetId\)/);
  assert.doesNotMatch(app, /restored to the Front Porch Shuffle/);
  assert.match(app, /drawViewFrame\(\s*notePanel,\s*"NOTE \/ HOLE"/);
  assert.match(app, /drawViewFrame\(\s*mouthPanel,\s*"LIP \/ TONGUE"/);
  assert.match(app, /drawViewFrame\(\s*bendPanel,\s*"BEND \/ REEDS"/);
  assert.match(app, /drawViewFrame\(\s*cupPanel,\s*"HANDS \/ CUP"/);
  assert.doesNotMatch(app, /drawViewFrame\([\s\S]{0,60}"0[1-5]"/);
  assert.match(app, /querySelectorAll\("button\[data-chord-width\]"\)/);
  assert.match(app, /setControl\("chordWidth", Number\(button\.dataset\.chordWidth\)/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(processor, /harmonicaReedCoupling/);
  assert.match(processor, /pairFeedback/);
  assert.match(processor, /combFilterLeft/);
  assert.match(processor, /coverFilterLeft/);
  assert.match(processor, /harmonicaBreathShiftProfile/);
  assert.match(processor, /handResonatorLeft/);
  assert.match(processor, /handResonanceFrequencyHz/);
  assert.doesNotMatch(processor, /message\.type === "configure"[\s\S]{0,420}this\.silenced = false/);
});
