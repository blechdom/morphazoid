import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_TO_INSTRUMENT_LIMITS,
  IMAGE_TO_INSTRUMENT_VARIANTS,
  PETAL_COUNT,
  advanceSequencerStep,
  clamp,
  createChoirVoiceSpecs,
  createDefaultImageInstrumentState,
  createDefaultPatch,
  createRouterPulseSpecs,
  createRouterStrikeSpecs,
  createSequencerSchedule,
  createSequencerStepStrikeSpecs,
  hitTestRadialPetal,
  mapPetalGesture,
  radialPetalLayout,
  sanitizeImageInstrumentState,
  sequencerStepDurationSeconds,
} from "../src/image-to-instrument.js";

const rmsGain = (voices) => Math.sqrt(
  voices.reduce((sum, voice) => sum + voice.gain ** 2, 0),
);
const peakGain = (voices) => voices.reduce((sum, voice) => sum + voice.gain, 0);

function assertVoiceSpecBounds(voice) {
  assert.equal(typeof voice.key, "string");
  assert.ok(voice.frequency >= 20 && voice.frequency <= 16_000);
  assert.ok(voice.gain >= 0 && voice.gain <= 1);
  assert.ok(voice.pan >= -1 && voice.pan <= 1);
  assert.ok(["sine", "triangle", "sawtooth", "square", "alternating"].includes(
    voice.waveform,
  ));
  assert.ok(["sine", "shepard", "fm", "pm"].includes(voice.mode));
  assert.ok(voice.synthDrive >= 0 && voice.synthDrive <= 1);
  assert.ok(voice.modulationIndex >= 0 && voice.modulationIndex <= 20);
  assert.ok(voice.modulationRatio >= 0.125 && voice.modulationRatio <= 16);
  assert.ok(voice.gainSmoothingSeconds >= 0.002 && voice.gainSmoothingSeconds <= 0.08);
}

test("three named variants create deterministic, independent eight-petal defaults", () => {
  assert.equal(PETAL_COUNT, 8);
  assert.deepEqual(
    IMAGE_TO_INSTRUMENT_VARIANTS.map(({ id, variant }) => [id, variant]),
    [
      ["image-to-instrument-1", "radial-choir"],
      ["image-to-instrument-2", "signal-router"],
      ["image-to-instrument-3", "mouthwheel-sequencer"],
    ],
  );

  for (const descriptor of IMAGE_TO_INSTRUMENT_VARIANTS) {
    const first = createDefaultImageInstrumentState(descriptor.id);
    const repeated = createDefaultImageInstrumentState(descriptor.variant);
    assert.deepEqual(first, repeated);
    assert.notEqual(first, repeated);
    assert.notEqual(first.petals, repeated.petals);
    assert.equal(first.petals.length, PETAL_COUNT);
    assert.ok(first.petals.every((petal) => (
      typeof petal.active === "boolean"
      && petal.aperture >= 0 && petal.aperture <= 1
      && petal.tongue >= 0 && petal.tongue <= 1
      && petal.emphasis >= 0 && petal.emphasis <= 1
      && petal.probability >= 0 && petal.probability <= 1
      && Number.isInteger(petal.ratchets)
    )));
    first.petals[0].aperture = 0;
    assert.notEqual(first.petals[0].aperture, repeated.petals[0].aperture);
  }

  assert.equal(createDefaultPatch(2).variant, "signal-router");
  assert.equal(createDefaultPatch("sequencer").variant, "mouthwheel-sequencer");
  assert.equal(createDefaultPatch("wheel-of-organs").variant, "mouthwheel-sequencer");
  assert.equal(
    IMAGE_TO_INSTRUMENT_VARIANTS.find(({ id }) => id === "image-to-instrument-3")?.name,
    "Wheel of Organs",
  );
});

test("clamping and state sanitation repair hostile external values", () => {
  assert.equal(clamp(Infinity, 0, 1, 0.25), 0.25);
  assert.equal(clamp("0.75", 0, 1), 0.75);
  assert.equal(clamp(5, 10, -10), 5);

  const safe = sanitizeImageInstrumentState({
    variant: "image-to-instrument-3",
    rootMidi: 999,
    level: -4,
    centerA: Infinity,
    centerB: 9,
    rate: -1,
    spread: "0.4",
    running: 1,
    phase: 2.75,
    selectedPetal: 99,
    petals: [{
      active: 0,
      aperture: -4,
      tongue: 7,
      emphasis: NaN,
      interval: 900,
      probability: -1,
      ratchets: 99,
    }],
  });
  assert.equal(safe.variant, "mouthwheel-sequencer");
  assert.equal(safe.rootMidi, IMAGE_TO_INSTRUMENT_LIMITS.rootMidi.maximum);
  assert.equal(safe.level, 0);
  assert.equal(safe.centerA, createDefaultPatch("mouthwheel-sequencer").centerA);
  assert.equal(safe.centerB, 1);
  assert.equal(safe.rate, 0);
  assert.equal(safe.spread, 0.4);
  assert.equal(safe.running, true);
  assert.ok(Math.abs(safe.phase - 0.75) < 1e-12);
  assert.equal(safe.selectedPetal, null);
  assert.equal(safe.petals.length, PETAL_COUNT);
  assert.deepEqual(safe.petals[0], {
    active: false,
    aperture: 0,
    tongue: 1,
    emphasis: createDefaultPatch("mouthwheel-sequencer").petals[0].emphasis,
    interval: IMAGE_TO_INSTRUMENT_LIMITS.interval.maximum,
    probability: 0,
    ratchets: IMAGE_TO_INSTRUMENT_LIMITS.ratchets.maximum,
  });
});

test("radial layout, ellipse hit testing, and anatomical gestures stay bounded", () => {
  const layout = radialPetalLayout(400, 300);
  assert.equal(layout.centerX, 200);
  assert.equal(layout.centerY, 150);
  assert.equal(layout.petals.length, PETAL_COUNT);
  assert.equal(new Set(layout.petals.map(({ index }) => index)).size, PETAL_COUNT);

  const top = layout.petals[0];
  assert.ok(Math.abs(top.x - layout.centerX) < 1e-10);
  assert.ok(top.y < layout.centerY);
  assert.equal(hitTestRadialPetal({ x: top.x, y: top.y }, layout), 0);
  assert.equal(hitTestRadialPetal({ x: layout.centerX, y: layout.centerY }, layout), null);
  assert.equal(hitTestRadialPetal({ x: -10_000, y: 10_000 }, layout), null);

  const centerGesture = mapPetalGesture(
    { x: top.x, y: top.y, pressure: 0.91 },
    top,
  );
  assert.deepEqual(
    {
      petalIndex: centerGesture.petalIndex,
      aperture: centerGesture.aperture,
      tongue: centerGesture.tongue,
      emphasis: centerGesture.emphasis,
      inside: centerGesture.inside,
    },
    { petalIndex: 0, aperture: 0.5, tongue: 0.5, emphasis: 0.91, inside: true },
  );

  const extreme = mapPetalGesture({
    x: top.x + Math.cos(top.angle) * top.radialRadius * 20,
    y: top.y + Math.sin(top.angle) * top.radialRadius * 20,
    pressure: 9,
  }, top);
  assert.equal(extreme.aperture, 1);
  assert.ok(extreme.tongue >= 0 && extreme.tongue <= 1);
  assert.equal(extreme.emphasis, 1);
  assert.equal(extreme.inside, false);
  assert.equal(mapPetalGesture({ x: 0, y: 0 }, {}), null);
});

test("radial choir emits bounded continuous voices with RMS headroom", () => {
  const state = createDefaultImageInstrumentState("radial-choir");
  state.level = 99;
  state.centerA = 99;
  state.centerB = 99;
  state.spread = 99;
  for (const petal of state.petals) {
    petal.aperture = 99;
    petal.tongue = 99;
    petal.emphasis = 99;
  }
  const voices = createChoirVoiceSpecs(state);
  assert.equal(voices.length, PETAL_COUNT);
  voices.forEach(assertVoiceSpecBounds);
  assert.ok(rmsGain(voices) <= IMAGE_TO_INSTRUMENT_LIMITS.continuousGain + 1e-12);

  state.petals[3].active = false;
  assert.equal(createChoirVoiceSpecs(state).some(({ key }) => key.endsWith("-3")), false);
  state.petals.forEach((petal) => { petal.active = false; });
  assert.deepEqual(createChoirVoiceSpecs(state), []);
});

test("signal router obeys patch, probability, and per-pulse route gates", () => {
  const state = createDefaultImageInstrumentState("signal-router");
  state.level = 9;
  state.petals[1].active = false;
  state.petals[2].probability = 0;
  const original = structuredClone(state);
  const pulse = {
    sourcePetal: 7,
    energy: 9,
    routeIndices: [0, 1, 2, 3, 4],
    routeGates: [1, 1, 1, 0, { enabled: true, gate: 0.5 }],
  };
  const voices = createRouterPulseSpecs(state, pulse);
  assert.deepEqual(state, original);
  assert.deepEqual(
    voices.map(({ key }) => Number(key.split("-").at(-1))),
    [0, 4],
  );
  voices.forEach(assertVoiceSpecBounds);
  assert.ok(peakGain(voices) <= IMAGE_TO_INSTRUMENT_LIMITS.strikeGain + 1e-12);
  assert.deepEqual(createRouterPulseSpecs(state, { energy: 0 }), []);

  const strikes = createRouterStrikeSpecs(state, pulse);
  assert.equal(strikes.length, voices.length);
  assert.ok(strikes.every(({ routeIndex, voice, envelope }) => (
    Number.isInteger(routeIndex)
    && voice.gain > 0
    && envelope.attackSeconds >= 0.002
    && envelope.decaySeconds > envelope.attackSeconds
    && envelope.startDelaySeconds >= 0
    && envelope.startDelaySeconds <= 0.05
  )));
});

test("mouthwheel swing preserves pair length and advance wraps in both directions", () => {
  assert.equal(advanceSequencerStep(7), 0);
  assert.equal(advanceSequencerStep(0, -1), 7);
  assert.equal(advanceSequencerStep(-17, 3), 2);

  const straight = sequencerStepDurationSeconds(120, 0, 0);
  const long = sequencerStepDurationSeconds(120, 0.4, 0);
  const short = sequencerStepDurationSeconds(120, 0.4, 1);
  assert.equal(straight, 0.25);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-12);

  const state = createDefaultImageInstrumentState("mouthwheel-sequencer");
  state.petals.forEach((petal) => {
    petal.active = true;
    petal.probability = 1;
    petal.ratchets = 1;
  });
  state.petals[0].ratchets = 3;
  const schedule = createSequencerSchedule(state, {
    startTime: 10,
    startStep: 0,
    stepCount: 4,
    tempoBpm: 120,
    swing: 0.4,
  });
  assert.deepEqual(schedule.map(({ stepIndex }) => stepIndex), [0, 1, 2, 3]);
  assert.deepEqual(schedule.map(({ durationSeconds }) => durationSeconds), [
    long,
    short,
    long,
    short,
  ]);
  assert.equal(schedule[0].time, 10);
  assert.equal(schedule[1].time, 10 + long);
  assert.equal(schedule[0].hits.length, 3);
  assert.equal(schedule[0].hits[0].time, 10);
  assert.ok(schedule[0].hits[1].time > schedule[0].hits[0].time);

  const gated = createSequencerSchedule(state, {
    stepCount: 1,
    chanceValues: [1],
  });
  assert.equal(gated[0].active, false);
  assert.deepEqual(gated[0].hits, []);
});

test("mouthwheel step strikes follow VoiceSpec bounds and peak headroom", () => {
  const state = createDefaultImageInstrumentState("mouthwheel-sequencer");
  state.level = 99;
  state.petals[0].active = true;
  state.petals[0].probability = 1;
  state.petals[0].aperture = 99;
  state.petals[0].tongue = 99;
  state.petals[0].emphasis = 99;
  const hit = { stepIndex: 0, ratchetIndex: 2, durationSeconds: 0.2, velocity: 1 };
  const strikes = createSequencerStepStrikeSpecs(state, hit);
  assert.equal(strikes.length, 2);
  strikes.forEach(({ voice, envelope }) => {
    assertVoiceSpecBounds(voice);
    assert.ok(envelope.attackSeconds >= 0.002 && envelope.attackSeconds <= 0.02);
    assert.ok(envelope.decaySeconds >= 0.025 && envelope.decaySeconds <= 0.36);
  });
  assert.ok(
    peakGain(strikes.map(({ voice }) => voice))
      <= IMAGE_TO_INSTRUMENT_LIMITS.strikeGain + 1e-12,
  );
  assert.deepEqual(createSequencerStepStrikeSpecs(state, 0, { velocity: 0 }), []);
});
