import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import { instrumentById } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
import {
  HAMBONE_DEFAULTS,
  HAMBONE_GESTURE_CHANNELS,
  HAMBONE_GESTURE_TRAJECTORIES,
  HAMBONE_LIMITS,
  HAMBONE_PATTERNS,
  HAMBONE_PRESETS,
  HAMBONE_SOUNDS,
  HAMBONE_STEP_COUNT,
  HAMBONE_TRACT_DIAMETER_FLOOR_CM,
  HAMBONE_TRACT_LANDMARKS,
  HAMBONE_TRACT_SECTION_COUNT,
  HAMBONE_VELOCITIES,
  clonePattern,
  cycleStepVelocity,
  hamboneBaseOralDiameters,
  hamboneFormants,
  hamboneGestureFrame,
  hamboneGestureFrameAtSample,
  hamboneGeometry,
  hamboneOralTractProfile,
  hambonePattern,
  hambonePoseForSound,
  hamboneSound,
  hamboneState,
  hamboneTargetOralDiameters,
  patternEventsAtStep,
  physicalVoiceParameters,
  randomizeHamboneState,
  randomizePattern,
  sampleHamboneGestureCurve,
  sanitizeHamboneState,
  sanitizePattern,
  sequenceStepIntervalSeconds,
} from "../src/hambone.js";

const root = new URL("../", import.meta.url);
const SOUND_IDS = Object.freeze([
  "bop",
  "boop",
  "pop",
  "tlik",
  "shh",
  "shack",
  "slap",
  "pff",
  "kick",
  "smack",
  "hee",
  "haw",
  "doo",
  "mwah",
  "drr",
  "burp",
]);

const SOUND_KEYS = Object.freeze([
  "1", "2", "3", "4", "5", "6", "7", "8",
  "9", "0", "q", "w", "e", "r", "t", "y",
]);

function assertFiniteTree(value, label = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertFiniteTree(child, `${label}.${key}`, seen);
  }
}

function assertBoundedState(state, label = "state") {
  for (const [key, [minimum, maximum]] of Object.entries(HAMBONE_LIMITS)) {
    assert.ok(Number.isFinite(state[key]), `${label}.${key} must be finite`);
    assert.ok(
      state[key] >= minimum && state[key] <= maximum,
      `${label}.${key} must stay in ${minimum}..${maximum}`,
    );
  }
}

function roundedSignature(values) {
  return values.map((value) => Number(value).toFixed(4)).join("|");
}

test("Hambone exposes sixteen complete, stable face-percussion sound identities", () => {
  assert.deepEqual(HAMBONE_SOUNDS.map(({ id }) => id), SOUND_IDS);
  assert.equal(HAMBONE_SOUNDS.length, SOUND_IDS.length);
  assert.equal(new Set(HAMBONE_SOUNDS.map(({ id }) => id)).size, SOUND_IDS.length);
  assert.equal(new Set(HAMBONE_SOUNDS.map(({ key }) => key)).size, SOUND_IDS.length);
  assert.equal(new Set(HAMBONE_SOUNDS.map(({ color }) => color)).size, SOUND_IDS.length);
  assert.deepEqual(HAMBONE_SOUNDS.map(({ key }) => key), SOUND_KEYS);

  for (const sound of HAMBONE_SOUNDS) {
    assert.equal(hamboneSound(sound.id), sound);
    assert.ok(sound.label.length > 0, `${sound.id} needs a visible label`);
    assert.ok(sound.subtitle.length > 0, `${sound.id} needs an articulatory subtitle`);
    assert.ok(sound.family.length > 0, `${sound.id} needs a physical source family`);
    assert.ok(sound.description.length > 24, `${sound.id} needs a physical description`);
  }
  assert.equal(hamboneSound("shh").label, "PHSHSHK");
  assert.match(hamboneSound("shh").description, /PH puff[\s\S]*K cut/i);
  assert.equal(HAMBONE_SOUNDS.some(({ label }) => label === "SHHH"), false);
  assert.equal(hamboneSound("not-a-mouth-noise").id, "bop");
});

test("Hambone sanitation clamps every continuous control and rejects non-finite state", () => {
  const source = structuredClone(HAMBONE_DEFAULTS);
  const snapshot = structuredClone(source);
  assertBoundedState(sanitizeHamboneState(source));
  assert.deepEqual(source, snapshot, "sanitizing must not mutate its input");

  for (const [key, [minimum, maximum]] of Object.entries(HAMBONE_LIMITS)) {
    assert.equal(
      sanitizeHamboneState({ ...HAMBONE_DEFAULTS, [key]: -1e12 })[key],
      minimum,
      `${key} must clamp to its lower physical limit`,
    );
    assert.equal(
      sanitizeHamboneState({ ...HAMBONE_DEFAULTS, [key]: 1e12 })[key],
      maximum,
      `${key} must clamp to its upper physical limit`,
    );
  }

  const hostile = Object.fromEntries(Object.keys(HAMBONE_LIMITS).map((key, index) => [
    key,
    index % 2 ? Number.NaN : Number.POSITIVE_INFINITY,
  ]));
  const sanitized = sanitizeHamboneState({
    ...hostile,
    presetId: "not-a-preset",
    patternId: "not-a-pattern",
  });
  assertBoundedState(sanitized, "hostile");
  assert.equal(sanitized.presetId, HAMBONE_PRESETS[0].id);
  assert.equal(sanitized.patternId, HAMBONE_PATTERNS[0].id);

  for (const key of [
    "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl",
  ]) {
    assert.ok(HAMBONE_LIMITS[key][0] < 0, `${key} must travel below the human zone`);
    assert.ok(HAMBONE_LIMITS[key][1] > 1, `${key} must travel above the human zone`);
  }
  assert.ok(HAMBONE_LIMITS.mouthOpening[1] > 1);
  assert.ok(HAMBONE_LIMITS.tractLengthM[0] < 0.07);
  assert.ok(HAMBONE_LIMITS.tractLengthM[1] > 0.28);
});

test("Hambone exposes one finite 44-section Pink-style oral tract across extreme anatomy", () => {
  assert.equal(HAMBONE_TRACT_SECTION_COUNT, 44);
  assert.ok(HAMBONE_TRACT_DIAMETER_FLOOR_CM > 0);
  assert.ok(HAMBONE_TRACT_DIAMETER_FLOOR_CM <= 0.01);
  assert.deepEqual(HAMBONE_TRACT_LANDMARKS, {
    glottis: 0,
    tongueBodyStart: 10,
    tongueControlStart: 12.9,
    velar: 22,
    tongueControlEnd: 30.4,
    postalveolar: 31,
    alveolar: 35,
    lipShapingStart: 37,
    lips: 43,
  });
  assert.ok(HAMBONE_TRACT_LANDMARKS.glottis < HAMBONE_TRACT_LANDMARKS.velar);
  assert.ok(HAMBONE_TRACT_LANDMARKS.velar < HAMBONE_TRACT_LANDMARKS.postalveolar);
  assert.ok(HAMBONE_TRACT_LANDMARKS.postalveolar < HAMBONE_TRACT_LANDMARKS.alveolar);
  assert.ok(HAMBONE_TRACT_LANDMARKS.alveolar < HAMBONE_TRACT_LANDMARKS.lips);

  const anatomyKeys = [
    "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl", "mouthOpening", "tractLengthM", "nasalMix",
  ];
  const states = [
    HAMBONE_DEFAULTS,
    sanitizeHamboneState({
      ...HAMBONE_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key) => [key, HAMBONE_LIMITS[key][0]])),
    }),
    sanitizeHamboneState({
      ...HAMBONE_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key) => [key, HAMBONE_LIMITS[key][1]])),
    }),
    sanitizeHamboneState({
      ...HAMBONE_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key, index) => [
        key,
        HAMBONE_LIMITS[key][index % 2],
      ])),
    }),
  ];
  for (const key of anatomyKeys) {
    for (const value of HAMBONE_LIMITS[key]) {
      states.push(sanitizeHamboneState({ ...HAMBONE_DEFAULTS, [key]: value }));
    }
  }
  const phases = Array.from({ length: 21 }, (_, index) => index / 20);

  for (const [stateIndex, state] of states.entries()) {
    const base = hamboneBaseOralDiameters(state);
    const resting = hamboneOralTractProfile(state);
    assert.equal(Object.isFrozen(base), true);
    assert.equal(base.length, HAMBONE_TRACT_SECTION_COUNT);
    assert.equal(resting.sectionCount, HAMBONE_TRACT_SECTION_COUNT);
    assert.equal(resting.baseDiameters.length, HAMBONE_TRACT_SECTION_COUNT);
    assert.equal(resting.targetDiameters.length, HAMBONE_TRACT_SECTION_COUNT);
    assert.ok(resting.sectionLengthM > 0);
    assert.ok(resting.tongueBodyIndex >= 2 && resting.tongueBodyIndex <= 42);
    assert.ok(resting.tongueTipIndex >= 2 && resting.tongueTipIndex <= 42);
    for (const [index, diameter] of base.entries()) {
      assert.ok(Number.isFinite(diameter), `base[${stateIndex}][${index}] must be finite`);
      assert.ok(
        diameter >= HAMBONE_TRACT_DIAMETER_FLOOR_CM && diameter <= 6.5,
        `base[${stateIndex}][${index}] must stay inside the tube bounds`,
      );
    }

    for (const soundId of SOUND_IDS) {
      const signatures = new Set();
      for (const phase of phases) {
        const frame = hamboneGestureFrame(soundId, phase, state, 0.91);
        const target = hamboneTargetOralDiameters(state, frame);
        const profile = hamboneOralTractProfile(state, frame);
        assertFiniteTree(frame, `${soundId}.frame.${phase}`);
        assertFiniteTree(profile, `${soundId}.profile.${phase}`);
        assert.equal(frame.soundId, soundId);
        assert.equal(frame.phase, phase);
        assert.equal(target.length, HAMBONE_TRACT_SECTION_COUNT);
        assert.deepEqual(profile.targetDiameters, target);
        assert.ok(target.every((diameter) => (
          Number.isFinite(diameter)
          && diameter >= HAMBONE_TRACT_DIAMETER_FLOOR_CM
          && diameter <= 6.5
        )));
        signatures.add(target.map((diameter) => diameter.toFixed(3)).join("|"));
      }
      assert.ok(
        signatures.size >= 10,
        `${soundId} must move the tube continuously rather than select one static profile`,
      );
    }
  }
});

test("Hambone gesture curves drive sequential seals, suction, releases, and signed tissue motion", () => {
  assert.equal(new Set(HAMBONE_GESTURE_CHANNELS).size, HAMBONE_GESTURE_CHANNELS.length);
  assert.deepEqual(Object.keys(HAMBONE_GESTURE_TRAJECTORIES), SOUND_IDS);
  for (const soundId of SOUND_IDS) {
    const trajectory = HAMBONE_GESTURE_TRAJECTORIES[soundId];
    assert.equal(trajectory.id, soundId);
    assert.deepEqual(Object.keys(trajectory.curves), HAMBONE_GESTURE_CHANNELS);
    for (const channel of HAMBONE_GESTURE_CHANNELS) {
      const curve = trajectory.curves[channel];
      assert.ok(curve.length >= 2, `${soundId}.${channel} needs an explicit trajectory`);
      let previousPhase = -1;
      for (const [phase, value] of curve) {
        assert.ok(Number.isFinite(phase) && phase >= 0 && phase <= 1);
        assert.ok(Number.isFinite(value), `${soundId}.${channel} values must be finite`);
        assert.ok(phase >= previousPhase, `${soundId}.${channel} phases must be ordered`);
        previousPhase = phase;
      }
    }
  }

  assert.equal(sampleHamboneGestureCurve([], 0.5), 0);
  assert.equal(sampleHamboneGestureCurve([[0, 0], [1, 1]], -20), 0);
  assert.equal(sampleHamboneGestureCurve([[0, 0], [1, 1]], 0.5), 0.5);
  assert.equal(sampleHamboneGestureCurve([[0, 0], [1, 1]], 20), 1);
  assert.ok(Number.isFinite(sampleHamboneGestureCurve([[0, Number.NaN], [1, 1]], 0.25)));

  const lipIndex = HAMBONE_TRACT_LANDMARKS.lips;
  for (const [soundId, sealedPhase, releasedPhase] of [
    ["bop", 0.25, 0.4],
    ["boop", 0.32, 0.5],
  ]) {
    const sealed = hamboneGestureFrame(soundId, sealedPhase);
    const released = hamboneGestureFrame(soundId, releasedPhase);
    const sealedTube = hamboneTargetOralDiameters(HAMBONE_DEFAULTS, sealed);
    const releasedTube = hamboneTargetOralDiameters(HAMBONE_DEFAULTS, released);
    assert.ok(sealed.lipClosure >= 0.99, `${soundId} must build pressure behind sealed lips`);
    assert.ok(released.lipClosure <= 0.01, `${soundId} must release the lips`);
    assert.ok(sealedTube[lipIndex] <= HAMBONE_TRACT_DIAMETER_FLOOR_CM * 1.01);
    assert.ok(releasedTube[lipIndex] > sealedTube[lipIndex] * 20);
    assert.ok(released.turbulence > 0, `${soundId} release must create a local air jet`);
  }
  assert.ok(
    hamboneTargetOralDiameters(
      HAMBONE_DEFAULTS,
      hamboneGestureFrame("boop", 0.5),
    )[lipIndex]
      < hamboneTargetOralDiameters(
        HAMBONE_DEFAULTS,
        hamboneGestureFrame("bop", 0.4),
      )[lipIndex],
    "BOOP keeps a more rounded projected lip tube than BOP after release",
  );

  const tlikSealed = hamboneGestureFrame("tlik", 0.4);
  const tlikTipRelease = hamboneGestureFrame("tlik", 0.55);
  const tlikRearRelease = hamboneGestureFrame("tlik", 0.7);
  const sectionForPosition = (position) => 2 + position * (HAMBONE_TRACT_SECTION_COUNT - 4);
  const tlikSealedTube = hamboneTargetOralDiameters(HAMBONE_DEFAULTS, tlikSealed);
  const tlikFrontIndex = Math.round(sectionForPosition(tlikSealed.constrictionPosition));
  const tlikRearIndex = Math.round(sectionForPosition(
    tlikSealed.secondaryConstrictionPosition,
  ));
  const tlikTipIndex = Math.round(hamboneOralTractProfile(
    HAMBONE_DEFAULTS,
    tlikSealed,
  ).tongueTipIndex);
  assert.ok(tlikSealed.constriction >= 0.99);
  assert.ok(tlikSealed.secondaryConstriction >= 0.99);
  assert.ok(tlikSealed.suction >= 0.95);
  assert.ok(tlikSealedTube[tlikFrontIndex] <= 0.035, "TLIK front contact must physically seal");
  assert.ok(tlikSealedTube[tlikRearIndex] <= 0.035, "TLIK rear contact must physically seal");
  assert.ok(tlikSealedTube[tlikTipIndex] <= 0.035, "TLIK curled tongue tip must contact");
  assert.ok(Math.abs(
    sectionForPosition(tlikSealed.constrictionPosition)
      - HAMBONE_TRACT_LANDMARKS.alveolar,
  ) < 1.5);
  assert.ok(Math.abs(
    sectionForPosition(tlikSealed.secondaryConstrictionPosition)
      - HAMBONE_TRACT_LANDMARKS.velar,
  ) < 0.1);
  assert.ok(tlikTipRelease.constriction < 0.02, "TLIK tongue tip releases first");
  assert.ok(tlikTipRelease.secondaryConstriction > 0.8, "TLIK rear seal briefly remains");
  assert.ok(tlikRearRelease.secondaryConstriction < 0.01, "TLIK rear seal then releases");

  const ph = hamboneGestureFrame("shh", 0.12);
  const sh = hamboneGestureFrame("shh", 0.4);
  const k = hamboneGestureFrame("shh", 0.8);
  assert.ok(ph.lipClosure > 0.99 && ph.constriction < 0.01 && ph.secondaryConstriction < 0.01);
  assert.ok(sh.lipClosure < 0.01 && sh.constriction > 0.6 && sh.turbulence > 0.9);
  assert.ok(sh.secondaryConstriction < 0.01);
  assert.ok(Math.abs(
    sectionForPosition(sh.constrictionPosition) - HAMBONE_TRACT_LANDMARKS.postalveolar,
  ) < 0.5);
  assert.ok(k.lipClosure < 0.01 && k.constriction < 0.01 && k.secondaryConstriction > 0.95);
  assert.ok(Math.abs(
    sectionForPosition(k.secondaryConstrictionPosition) - HAMBONE_TRACT_LANDMARKS.velar,
  ) < 0.1);
  assert.notDeepEqual(
    hamboneTargetOralDiameters(HAMBONE_DEFAULTS, ph),
    hamboneTargetOralDiameters(HAMBONE_DEFAULTS, sh),
  );
  assert.notDeepEqual(
    hamboneTargetOralDiameters(HAMBONE_DEFAULTS, sh),
    hamboneTargetOralDiameters(HAMBONE_DEFAULTS, k),
  );

  const flutterClosures = [0.08, 0.2, 0.33, 0.46, 0.59, 0.73, 0.84, 0.92]
    .map((phase) => hamboneGestureFrame("pff", phase).lipClosure);
  assert.ok(flutterClosures[0] > flutterClosures[1]);
  assert.ok(flutterClosures[2] > flutterClosures[1]);
  assert.ok(flutterClosures[2] > flutterClosures[3]);
  assert.ok(flutterClosures[4] > flutterClosures[3]);
  assert.ok(flutterClosures[4] > flutterClosures[5]);
  assert.ok(flutterClosures[6] > flutterClosures[5]);
  assert.ok(hamboneGestureFrame("pff", 0.3).lipFlutter > 0.95);
  assert.ok(hamboneGestureFrame("pff", 1).lipFlutter < 0.01);

  const popPull = hamboneGestureFrame("pop", 0.4).cheekImpulse;
  const popRelease = hamboneGestureFrame("pop", 0.48).cheekImpulse;
  const slapContact = hamboneGestureFrame("slap", 0.09).cheekImpulse;
  const slapRebound = hamboneGestureFrame("slap", 0.18).cheekImpulse;
  assert.ok(popPull < -0.9 && popRelease > 0.5, "POP models inward vacuum then rebound");
  assert.ok(slapContact < -0.9 && slapRebound > 0.5, "SLAP models skin contact then rebound");
});

test("Hambone sample-addressed gesture frames complete exactly once and stay finite", () => {
  for (const soundId of SOUND_IDS) {
    const start = hamboneGestureFrameAtSample(soundId, 0, 48_000, HAMBONE_DEFAULTS, 0.86);
    const middle = hamboneGestureFrameAtSample(
      soundId,
      Math.floor(start.totalFrames / 2),
      48_000,
      HAMBONE_DEFAULTS,
      0.86,
    );
    const end = hamboneGestureFrameAtSample(
      soundId,
      start.totalFrames,
      48_000,
      HAMBONE_DEFAULTS,
      0.86,
    );
    const after = hamboneGestureFrameAtSample(
      soundId,
      start.totalFrames + 10_000,
      48_000,
      HAMBONE_DEFAULTS,
      0.86,
    );
    assertFiniteTree(start, `${soundId}.sampleStart`);
    assertFiniteTree(middle, `${soundId}.sampleMiddle`);
    assertFiniteTree(end, `${soundId}.sampleEnd`);
    assert.equal(start.frameIndex, 0);
    assert.equal(start.active, true);
    assert.equal(start.complete, false);
    assert.ok(middle.phase > 0.45 && middle.phase <= 0.5);
    assert.equal(end.frameIndex, start.totalFrames);
    assert.equal(end.remainingFrames, 0);
    assert.equal(end.phase, 1);
    assert.equal(end.active, false);
    assert.equal(end.complete, true);
    assert.equal(after.frameIndex, start.totalFrames);
    assert.equal(after.remainingFrames, 0);
    assert.equal(after.phase, 1);
    assert.equal(after.active, false);
    assert.equal(after.complete, true);
  }
});

test("face geometry, tract formants, and all sound-specific voice plans remain physical and distinct", () => {
  const states = [HAMBONE_DEFAULTS];
  for (const [key, limits] of Object.entries(HAMBONE_LIMITS)) {
    if (["tempo", "swing", "humanize", "level"].includes(key)) continue;
    for (const value of limits) states.push(sanitizeHamboneState({ ...HAMBONE_DEFAULTS, [key]: value }));
  }

  for (const [index, state] of states.entries()) {
    const geometry = hamboneGeometry(state);
    const formants = hamboneFormants(state);
    assertFiniteTree(geometry, `geometry[${index}]`);
    assertFiniteTree(formants, `formants[${index}]`);
    assert.ok(geometry.apertureCm2 >= 0.008 && geometry.apertureCm2 <= 18);
    assert.ok(geometry.cheekVolumeMl >= 8 && geometry.cheekVolumeMl <= 480);
    assert.ok(geometry.neckLengthM >= 0.0025 && geometry.neckLengthM <= 0.12);
    assert.ok(geometry.cavityFrequencyHz >= 22 && geometry.cavityFrequencyHz <= 4_200);
    assert.equal(formants.frequenciesHz.length, 3);
    assert.equal(formants.bandwidthsHz.length, 3);
    assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
    assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
    assert.ok(formants.bandwidthsHz.every((bandwidth) => bandwidth > 0));
  }

  const shortTract = hamboneFormants({ ...HAMBONE_DEFAULTS, tractLengthM: HAMBONE_LIMITS.tractLengthM[0] });
  const longTract = hamboneFormants({ ...HAMBONE_DEFAULTS, tractLengthM: HAMBONE_LIMITS.tractLengthM[1] });
  assert.ok(shortTract.frequenciesHz[0] > longTract.frequenciesHz[0]);
  const smallCheeks = hamboneGeometry({
    ...HAMBONE_DEFAULTS,
    cheekVolume: HAMBONE_LIMITS.cheekVolume[0],
  });
  const largeCheeks = hamboneGeometry({
    ...HAMBONE_DEFAULTS,
    cheekVolume: HAMBONE_LIMITS.cheekVolume[1],
  });
  assert.ok(smallCheeks.cheekVolumeMl < largeCheeks.cheekVolumeMl);
  assert.ok(smallCheeks.cavityFrequencyHz > largeCheeks.cavityFrequencyHz);
  assert.ok(smallCheeks.cheekVolumeMl <= 12, "the face can collapse below a human cheek cavity");
  assert.ok(largeCheeks.cheekVolumeMl >= 450, "the face can inflate beyond a human cheek cavity");

  const voicePlans = SOUND_IDS.map((soundId) => {
    const pose = hambonePoseForSound(soundId, HAMBONE_DEFAULTS);
    const plan = physicalVoiceParameters(soundId, HAMBONE_DEFAULTS, 0.8);
    assertBoundedState(pose, `${soundId}.pose`);
    assertFiniteTree(plan, `${soundId}.voice`);
    assert.equal(plan.soundId, soundId);
    assert.equal(plan.family, hamboneSound(soundId).family);
    assert.ok(plan.durationSeconds > 0.05 && plan.durationSeconds < 2.5);
    assert.ok(plan.pressure > 0 && plan.pressure <= 1.8);
    assert.ok(plan.formantFrequenciesHz[0] < plan.formantFrequenciesHz[1]);
    assert.ok(plan.formantFrequenciesHz[1] < plan.formantFrequenciesHz[2]);
    return { pose, plan };
  });

  const parameterSignatures = voicePlans.map(({ plan }) => roundedSignature([
    plan.durationSeconds,
    plan.glottalFrequencyHz,
    plan.flutterFrequencyHz,
    plan.membraneFrequencyHz,
    plan.cavityFrequencyHz,
    plan.noiseCenterHz,
    plan.noiseBandwidthHz,
    ...plan.formantFrequenciesHz,
    plan.pan,
  ]));
  const formantSignatures = voicePlans.map(({ plan }) => roundedSignature(plan.formantFrequenciesHz));
  const geometrySignatures = voicePlans.map(({ pose }) => roundedSignature(Object.values(hamboneGeometry(pose))));
  assert.equal(
    new Set(parameterSignatures).size,
    SOUND_IDS.length,
    "each sound needs a distinct physical voice plan",
  );
  assert.equal(
    new Set(formantSignatures).size,
    SOUND_IDS.length,
    "each sound pose needs distinct oral formants",
  );
  assert.equal(
    new Set(geometrySignatures).size,
    SOUND_IDS.length,
    "each sound pose needs distinct face/cavity geometry",
  );
  assert.ok(physicalVoiceParameters("shh", HAMBONE_DEFAULTS, 1).durationSeconds < 0.3);
  assert.ok(physicalVoiceParameters("shack", HAMBONE_DEFAULTS, 1).durationSeconds < 0.3);
  assert.ok(physicalVoiceParameters("pff", HAMBONE_DEFAULTS, 1).durationSeconds < 0.4);
});

test("the expanded bank models body kicks, opposed slaps, reversible breath, pitch, suction, trills, and burps", () => {
  const kick = physicalVoiceParameters("kick", HAMBONE_DEFAULTS, 1);
  const slap = physicalVoiceParameters("slap", HAMBONE_DEFAULTS, 1);
  const smack = physicalVoiceParameters("smack", HAMBONE_DEFAULTS, 1);
  assert.ok(kick.membraneFrequencyHz < slap.membraneFrequencyHz * 0.35);
  assert.ok(kick.glottalFrequencyHz < slap.glottalFrequencyHz * 0.55);
  assert.equal(slap.pan, -smack.pan);
  assert.ok(slap.pan < 0 && smack.pan > 0);
  assert.ok(hamboneGestureFrame("slap", 0.09).cheekImpulse < -0.9);
  assert.ok(hamboneGestureFrame("smack", 0.075).cheekImpulse > 0.9);

  const hee = physicalVoiceParameters("hee", HAMBONE_DEFAULTS, 1);
  const haw = physicalVoiceParameters("haw", HAMBONE_DEFAULTS, 1);
  assert.equal(hee.airflowDirection, -1, "HEE must pull air inward across the folds");
  assert.equal(haw.airflowDirection, 1, "HAW must send air outward across the folds");
  assert.ok(hee.glottalFrequencyHz > haw.glottalFrequencyHz * 1.5);
  assert.ok(
    hambonePoseForSound("hee").mouthOpening < hambonePoseForSound("haw").mouthOpening * 0.25,
    "HEE and HAW need physically different vowel tracts",
  );

  const dooPitches = [-24, -12, 0, 12, 24].map((dooPitch) => (
    physicalVoiceParameters("doo", { ...HAMBONE_DEFAULTS, dooPitch }, 1).glottalFrequencyHz
  ));
  for (let index = 1; index < dooPitches.length; index += 1) {
    assert.ok(
      Math.abs(dooPitches[index] / dooPitches[index - 1] - 2) < 1e-12,
      "each DOO octave must double its vocal-fold frequency",
    );
  }

  const mwahStored = hamboneGestureFrame("mwah", 0.42);
  const mwahReleased = hamboneGestureFrame("mwah", 0.54);
  assert.ok(mwahStored.lipClosure > 0.99 && mwahStored.suction > 0.99);
  assert.ok(mwahReleased.lipClosure < 0.01 && mwahReleased.suction < 0.01);
  assert.ok(hamboneGestureFrame("drr", 0.2).tongueTrill > 0.98);

  const burp = physicalVoiceParameters("burp", HAMBONE_DEFAULTS, 1);
  const burpPressure = [0.2, 0.3, 0.45, 0.6, 0.8]
    .map((phase) => hamboneGestureFrame("burp", phase).pressure);
  assert.ok(burp.irregularity > 0.75);
  assert.ok(Math.max(...burpPressure) - Math.min(...burpPressure) > 0.35);
  assert.ok(
    burp.glottalFrequencyHz < physicalVoiceParameters("doo", HAMBONE_DEFAULTS, 1).glottalFrequencyHz * 0.4,
  );
});

test("physical presets and deterministic randomization produce distinct bounded faces", () => {
  assert.ok(HAMBONE_PRESETS.length >= 9, "the expanded face needs a wider preset bank");
  assert.equal(new Set(HAMBONE_PRESETS.map(({ id }) => id)).size, HAMBONE_PRESETS.length);
  assert.equal(
    new Set(HAMBONE_PRESETS.map(({ settings }) => JSON.stringify(settings))).size,
    HAMBONE_PRESETS.length,
  );

  const presetStates = HAMBONE_PRESETS.map((preset) => {
    const state = hamboneState(preset.id);
    assert.equal(state.presetId, preset.id);
    assertBoundedState(state, preset.id);
    return state;
  });
  assert.equal(
    new Set(presetStates.map((state) => roundedSignature([
      state.lungPressure,
      state.lipTension,
      state.cheekVolume,
      state.cheekTension,
      state.tonguePosition,
      state.tractLengthM,
    ]))).size,
    HAMBONE_PRESETS.length,
  );

  const before = hamboneState("cavern-gob", {
    patternId: "hush-rush",
    tempo: 203,
    swing: 0.31,
    humanize: 0.2,
    level: 0.61,
  });
  const snapshot = structuredClone(before);
  const minimum = randomizeHamboneState(before, () => 0);
  const midpoint = randomizeHamboneState(before, () => 0.5);
  const maximum = randomizeHamboneState(before, () => 1);
  assert.deepEqual(before, snapshot, "randomizing must not mutate the selected face");
  for (const [label, state] of [["minimum", minimum], ["midpoint", midpoint], ["maximum", maximum]]) {
    assertBoundedState(state, label);
    assert.equal(state.presetId, before.presetId);
    assert.equal(state.patternId, before.patternId);
    assert.equal(state.tempo, before.tempo);
    assert.equal(state.swing, before.swing);
    assert.equal(state.humanize, before.humanize);
    assert.equal(state.level, before.level);
  }
  for (const key of [
    "lungPressure", "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl", "mouthOpening", "tractLengthM", "nasalMix",
    "dooPitch", "earSpread", "eyeDivergence", "silliness", "decay",
  ]) {
    const [low, high] = HAMBONE_LIMITS[key];
    assert.equal(minimum[key], low, `${key} random draw zero must reach its minimum`);
    assert.equal(maximum[key], high, `${key} random draw one must reach its maximum`);
    assert.ok(Math.abs(midpoint[key] - (low + high) / 2) < 1e-12);
  }
});

test("patterns expose an exclusive editable sixteen-by-sixteen face-pose grid", () => {
  assert.equal(HAMBONE_STEP_COUNT, 16);
  assert.deepEqual(HAMBONE_VELOCITIES, [0, 0.42, 0.72, 1]);
  assert.ok(HAMBONE_PATTERNS.length >= 9, "the expanded sound bank needs a wider rhythm bank");
  assert.equal(new Set(HAMBONE_PATTERNS.map(({ id }) => id)).size, HAMBONE_PATTERNS.length);

  for (const pattern of HAMBONE_PATTERNS) {
    assert.equal(hambonePattern(pattern.id), pattern);
    assert.deepEqual(Object.keys(pattern.rows), SOUND_IDS);
    let activeCells = 0;
    for (const soundId of SOUND_IDS) {
      assert.equal(pattern.rows[soundId].length, HAMBONE_STEP_COUNT);
      for (const amount of pattern.rows[soundId]) {
        assert.ok(Number.isFinite(amount));
        assert.ok(amount >= 0 && amount <= 1);
        if (amount > 0) activeCells += 1;
      }
    }
    for (let step = 0; step < HAMBONE_STEP_COUNT; step += 1) {
      const activeAtStep = SOUND_IDS.filter((soundId) => pattern.rows[soundId][step] > 0);
      assert.ok(activeAtStep.length <= 1, `${pattern.id} step ${step + 1} cannot layer mouth poses`);
    }
    assert.ok(activeCells > 0, `${pattern.id} must contain at least one hit`);
  }

  const original = HAMBONE_PATTERNS[0];
  const editable = clonePattern(original);
  assert.notEqual(editable, original.rows);
  assert.notEqual(editable.bop, original.rows.bop);
  editable.bop[0] = 0;
  assert.notEqual(editable.bop[0], original.rows.bop[0]);

  const hostile = sanitizePattern({
    bop: [Number.NaN, -4, 0.5, 20],
    unknown: Array(16).fill(1),
  });
  assert.deepEqual(Object.keys(hostile), SOUND_IDS);
  assert.equal(hostile.bop.length, 16);
  assert.deepEqual(hostile.bop.slice(0, 4), [0, 0, 0.5, 1]);
  assert.ok(hostile.boop.every((amount) => amount === 0));

  assert.deepEqual(
    patternEventsAtStep({ bop: [1], slap: [0.72] }, 0),
    [{ soundId: "bop", velocity: 1, step: 0 }],
  );
  assert.deepEqual(
    patternEventsAtStep({ bop: [0.42], slap: [0.72] }, 0),
    [{ soundId: "slap", velocity: 0.72, step: 0 }],
  );
  assert.deepEqual(
    patternEventsAtStep({ bop: [0.72], slap: [0.72] }, 0),
    [{ soundId: "bop", velocity: 0.72, step: 0 }],
    "stable sound order breaks equal-velocity ties",
  );
  assert.deepEqual(patternEventsAtStep({ boop: { 15: 0.42 } }, -1), [
    { soundId: "boop", velocity: 0.42, step: 15 },
  ]);

  const scattered = randomizePattern(() => 0, 0.22);
  assert.deepEqual(Object.keys(scattered), SOUND_IDS);
  assert.ok(patternEventsAtStep(scattered, 0).length > 0, "scatter always keeps a downbeat");
  assert.ok(Object.values(scattered).flat().every((amount) => HAMBONE_VELOCITIES.includes(amount)));
  for (let step = 0; step < HAMBONE_STEP_COUNT; step += 1) {
    assert.ok(
      SOUND_IDS.filter((soundId) => scattered[soundId][step] > 0).length <= 1,
      `scattered step ${step + 1} must select at most one mouth pose`,
    );
  }
});

test("velocity cycling and swing preserve the sixteen-step loop duration", () => {
  const velocityCycle = [0];
  for (let index = 0; index < HAMBONE_VELOCITIES.length; index += 1) {
    velocityCycle.push(cycleStepVelocity(velocityCycle.at(-1)));
  }
  assert.deepEqual(velocityCycle, [0, 0.42, 0.72, 1, 0]);
  assert.equal(cycleStepVelocity(-10), 0.42);
  assert.equal(cycleStepVelocity(0.6), 0.72);
  assert.equal(cycleStepVelocity(10), 0);

  const tempo = 120;
  const straight = sequenceStepIntervalSeconds(tempo, 0, 0);
  const long = sequenceStepIntervalSeconds(tempo, 0.3, 0);
  const short = sequenceStepIntervalSeconds(tempo, 0.3, 1);
  assert.equal(straight, 0.125);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-12);

  const straightLoop = Array.from({ length: 16 }, (_, step) => (
    sequenceStepIntervalSeconds(tempo, 0, step)
  )).reduce((sum, interval) => sum + interval, 0);
  const swungLoop = Array.from({ length: 16 }, (_, step) => (
    sequenceStepIntervalSeconds(tempo, 0.46, step)
  )).reduce((sum, interval) => sum + interval, 0);
  assert.ok(Math.abs(straightLoop - 2) < 1e-12);
  assert.ok(Math.abs(swungLoop - straightLoop) < 1e-12);
  assert.equal(
    sequenceStepIntervalSeconds(-1e6, -1e6, 0),
    15 / HAMBONE_LIMITS.tempo[0],
  );
  assert.deepEqual(HAMBONE_LIMITS.tempo, [48, 520]);
  assert.equal(sequenceStepIntervalSeconds(520, 0, 0), 15 / 520);
  assert.equal(sequenceStepIntervalSeconds(1e6, 0, 0), 15 / 520);
});

test("Hambone worklet renders sixteen distinct gestures through exactly one active mouth", async () => {
  const globalKeys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(globalKeys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  let Processor = null;
  let processorName = null;

  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => {
      processorName = name;
      Processor = Constructor;
    },
  });

  try {
    await import(`../src/hambone-processor.js?hambone-test=${Date.now()}-${Math.random()}`);
    assert.equal(processorName, "hambone-physical-model");
    assert.equal(typeof Processor, "function");

    const render = (soundId, blocks = 280, configuration = HAMBONE_DEFAULTS) => {
      const processor = new Processor({
        processorOptions: { configuration },
      });
      processor._handleMessage({ type: "strike", soundId, velocity: 0.86 });
      const left = new Float32Array(blocks * 128);
      const right = new Float32Array(blocks * 128);
      let offset = 0;
      for (let block = 0; block < blocks; block += 1) {
        const blockLeft = left.subarray(offset, offset + 128);
        const blockRight = right.subarray(offset, offset + 128);
        assert.equal(processor.process([], [[blockLeft, blockRight]]), true);
        offset += 128;
      }
      return { processor, left, right };
    };

    const metrics = (channels) => {
      let energy = 0;
      let peak = 0;
      let audibleSamples = 0;
      for (const samples of channels) {
        for (const sample of samples) {
          assert.ok(Number.isFinite(sample), "worklet output must remain finite");
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
          if (Math.abs(sample) > 1e-5) audibleSamples += 1;
        }
      }
      return {
        rms: Math.sqrt(energy / (channels.length * channels[0].length)),
        peak,
        audibleSamples,
      };
    };

    const normalizedDifference = (left, right) => {
      let difference = 0;
      let energy = 0;
      for (let index = 0; index < left.length; index += 1) {
        difference += (left[index] - right[index]) ** 2;
        energy += left[index] ** 2 + right[index] ** 2;
      }
      return Math.sqrt(difference / Math.max(1e-12, energy));
    };

    const renders = new Map();
    for (const soundId of SOUND_IDS) {
      const rendered = render(soundId);
      const result = metrics([rendered.left, rendered.right]);
      assert.ok(result.rms > 0.0001, `${soundId} must be audible`);
      assert.ok(result.peak > 0.001, `${soundId} must have a clear attack or body`);
      assert.ok(result.peak <= 0.721, `${soundId} must stay below the worklet limiter ceiling`);
      assert.ok(result.audibleSamples > 128, `${soundId} must render more than an impulse`);
      const telemetryMessages = rendered.processor.messages.filter(({ type }) => type === "telemetry");
      const telemetry = telemetryMessages.at(-1);
      assert.equal(telemetry?.lastSoundId, soundId);
      assert.ok(Number.isFinite(telemetry?.peak));
      assert.ok(Number.isFinite(telemetry?.rms));
      assert.ok(telemetryMessages.length > 1);
      for (const message of telemetryMessages) {
        for (const field of [
          "gestureProgress",
          "gestureAmount",
          "tractPressure",
          "constrictionIndex",
          "constrictionDiameterCm",
          "velumOpening",
          "lipDiameterCm",
          "cheekDisplacement",
          "oralSectionCount",
          "dooPitch",
          "earSpread",
          "stereoDelayMs",
          "eyeDivergence",
        ]) {
          assert.ok(Number.isFinite(message[field]), `${soundId} telemetry ${field} must be finite`);
        }
        assert.ok(message.oralSectionCount >= 8);
        assert.ok(
          message.activeGesture === false
            || message.activeGesture === true
            || message.activeGesture === ""
            || SOUND_IDS.includes(message.activeGesture),
          `${soundId} telemetry must identify at most one gesture`,
        );
      }
      assert.ok(
        telemetryMessages.every(({ activeVoices }) => activeVoices === 0 || activeVoices === 1),
        `${soundId} telemetry must never report layered mouths`,
      );
      assert.equal("voices" in rendered.processor, false);
      assert.equal("voice" in rendered.processor, false);
      assert.equal("voicePool" in rendered.processor, false);
      assert.ok(rendered.processor.tract, `${soundId} must pass through the persistent tract`);
      renders.set(soundId, rendered.left);
    }

    for (let leftIndex = 0; leftIndex < SOUND_IDS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < SOUND_IDS.length; rightIndex += 1) {
        const leftId = SOUND_IDS[leftIndex];
        const rightId = SOUND_IDS[rightIndex];
        assert.ok(
          normalizedDifference(renders.get(leftId), renders.get(rightId)) > 0.18,
          `${leftId} and ${rightId} must not collapse to the same rendered gesture`,
        );
      }
    }

    const dryFace = render("doo", 420, {
      ...HAMBONE_DEFAULTS,
      earSpread: 0,
      eyeDivergence: 0,
    });
    const openFace = render("doo", 420, {
      ...HAMBONE_DEFAULTS,
      earSpread: 1,
      eyeDivergence: 1,
    });
    assert.ok(
      normalizedDifference(dryFace.left, openFace.left) > 0.08,
      "ear and eye movement must materially reshape the full-sequence output",
    );
    assert.ok(
      normalizedDifference(openFace.left, openFace.right) > 0.05,
      "stretched ears must create a real stereo delay rather than a label-only control",
    );
    assert.ok(openFace.processor.faceSpace.stereoDelayMs > 10);
    assert.ok(openFace.processor.faceSpace.eyeAmount > 0.9);

    const contoured = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    contoured._handleMessage({
      type: "strike",
      soundId: "doo",
      velocity: 0.9,
      delaySeconds: 0.03,
      configuration: {
        nasalMix: 0.84,
        dooPitch: 12,
        earSpread: 0.92,
        eyeDivergence: 0.76,
      },
    });
    assert.equal(contoured.queue.length, 1);
    assert.equal(contoured.queue[0].configurationSnapshot.dooPitch, 12);
    for (let block = 0; block < 24; block += 1) {
      contoured.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(contoured.lastSoundId, "doo");
    assert.equal(contoured.configuration.nasalMix, 0.84);
    assert.equal(contoured.configuration.dooPitch, 12);
    assert.equal(contoured.configuration.earSpread, 0.92);
    assert.equal(contoured.configuration.eyeDivergence, 0.76);

    const fresh = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    const freshLeft = new Float32Array(128);
    const freshRight = new Float32Array(128);
    fresh.process([], [[freshLeft, freshRight]]);
    assert.ok(freshLeft.every((sample) => sample === 0));
    assert.ok(freshRight.every((sample) => sample === 0));

    fresh._handleMessage({ type: "strike", soundId: "shh", velocity: 1 });
    let soundingSamples = 0;
    for (let block = 0; block < 64; block += 1) {
      const soundingLeft = new Float32Array(128);
      fresh.process([], [[soundingLeft, new Float32Array(128)]]);
      soundingSamples += soundingLeft.filter((sample) => Math.abs(sample) > 1e-6).length;
    }
    assert.ok(
      soundingSamples > 128,
      "PHSHSHK may begin behind a physical seal but must sound after pressure release",
    );
    fresh._handleMessage({ type: "silence" });
    const silentLeft = new Float32Array(128);
    const silentRight = new Float32Array(128);
    fresh.process([], [[silentLeft, silentRight]]);
    assert.ok(silentLeft.every((sample) => sample === 0));
    assert.ok(silentRight.every((sample) => sample === 0));

    const queued = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    queued._handleMessage({ type: "strike", soundId: "slap", velocity: 1, delaySeconds: 0.1 });
    queued._handleMessage({ type: "panic" });
    for (let block = 0; block < 50; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      queued.process([], [[left, right]]);
      assert.ok(left.every((sample) => sample === 0));
      assert.ok(right.every((sample) => sample === 0));
    }

    const simultaneous = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    simultaneous._handleMessage({ type: "strike", soundId: "bop", velocity: 0.62 });
    simultaneous._handleMessage({ type: "strike", soundId: "slap", velocity: 0.94 });
    simultaneous.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(simultaneous.lastSoundId, "slap", "the strongest same-frame gesture owns the mouth");
    assert.equal(simultaneous.gesture?.soundId ?? simultaneous.gesture?.sound?.id, "slap");

    const tie = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    tie._handleMessage({ type: "strike", soundId: "tlik", velocity: 0.8 });
    tie._handleMessage({ type: "strike", soundId: "boop", velocity: 0.8 });
    tie.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(tie.lastSoundId, "tlik", "the earliest same-frame gesture wins a velocity tie");

    const retriggered = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    retriggered._handleMessage({ type: "strike", soundId: "shh", velocity: 0.9 });
    for (let block = 0; block < 12; block += 1) {
      retriggered.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(retriggered.gesture?.soundId ?? retriggered.gesture?.sound?.id, "shh");
    const continuousTract = retriggered.tract;
    const oldGesture = retriggered.gesture;
    retriggered._handleMessage({ type: "strike", soundId: "bop", velocity: 0.9 });
    retriggered.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(retriggered.gesture?.soundId ?? retriggered.gesture?.sound?.id, "bop");
    assert.notEqual(retriggered.gesture, oldGesture, "a new articulatory trajectory replaces the old one");
    assert.equal(
      retriggered.tract,
      continuousTract,
      "retriggering must retarget the same air column instead of constructing a second mouth",
    );
    assert.equal("voices" in retriggered, false);
    assert.equal("voice" in retriggered, false);
    assert.equal("voicePool" in retriggered, false);

    const preparationProbe = new Processor({
      processorOptions: { configuration: HAMBONE_DEFAULTS },
    });
    const preparationSeconds = SOUND_IDS.map((soundId) => {
      const event = preparationProbe._eventForMessage({ soundId, velocity: 0.9 });
      return (event.releaseFrame - event.startFrame) / 48_000;
    });
    assert.ok(Math.min(...preparationSeconds) >= 0.005);
    assert.ok(Math.max(...preparationSeconds) <= 0.025);
    assert.ok(
      new Set(preparationSeconds.map((seconds) => seconds.toFixed(4))).size >= 6,
      "live gestures need sound-specific anatomical preparation rather than one generic attack",
    );

    const click = new Processor({ processorOptions: { configuration: HAMBONE_DEFAULTS } });
    click._handleMessage({ type: "strike", soundId: "tlik", velocity: 0.9 });
    const sealedContacts = new Set();
    const negativeReleaseIndices = new Set();
    let minimumVacuum = 0;
    let firstAnteriorReleaseFrame = Number.POSITIVE_INFINITY;
    let firstRearReleaseFrame = Number.POSITIVE_INFINITY;
    for (let block = 0; block < 100; block += 1) {
      click.process([], [[new Float32Array(128), new Float32Array(128)]]);
      for (const seal of click.tract.seals) {
        if (seal.sealed) sealedContacts.add(seal.name);
        minimumVacuum = Math.min(minimumVacuum, seal.vacuumPressure ?? 0);
      }
      for (const transient of click.tract.transients) {
        if (!transient.active || transient.strength >= 0) continue;
        negativeReleaseIndices.add(transient.index);
        if (transient.index > click.tract.cheekJunction) {
          firstAnteriorReleaseFrame = Math.min(firstAnteriorReleaseFrame, block * 128);
        } else {
          firstRearReleaseFrame = Math.min(firstRearReleaseFrame, block * 128);
        }
      }
    }
    assert.ok(sealedContacts.has("primary"), "TLIK must form its anterior seal");
    assert.ok(sealedContacts.has("secondary"), "TLIK must form its rear seal");
    assert.ok(sealedContacts.has("tongueTip"), "TLIK must form curled-tip contact");
    assert.ok(minimumVacuum < -0.001, "TLIK must expand a negative-pressure oral pocket");
    assert.ok(negativeReleaseIndices.size >= 2, "TLIK must produce distinct signed releases");
    assert.ok(
      firstAnteriorReleaseFrame < firstRearReleaseFrame,
      "TLIK anterior contact must release before the rear tongue seal",
    );

    const noFlowConfiguration = { ...HAMBONE_DEFAULTS, lungPressure: 0 };
    const noFlow = new Processor({
      processorOptions: { configuration: noFlowConfiguration },
    });
    const turbulenceWithoutFlow = {
      ...hamboneGestureFrame("shh", 0.4, noFlowConfiguration, 1),
      cheekImpulse: 0,
      jawImpulse: 0,
      suction: 0,
    };
    noFlow.tract.setArticulation(
      noFlowConfiguration,
      turbulenceWithoutFlow,
      physicalVoiceParameters("shh", noFlowConfiguration, 1),
      true,
    );
    for (let substep = 0; substep < 256; substep += 1) {
      assert.equal(
        noFlow.tract.processSubstep(0, substep % 2 ? 1 : -1),
        0,
        "a turbulence curve without pressure or flow must not synthesize free hiss",
      );
    }
    for (const pneumaticSoundId of ["bop", "boop", "pff"]) {
      const zeroAir = new Processor({
        processorOptions: { configuration: noFlowConfiguration },
      });
      zeroAir._handleMessage({ type: "strike", soundId: pneumaticSoundId, velocity: 1 });
      let zeroAirPeak = 0;
      for (let block = 0; block < 120; block += 1) {
        const channel = new Float32Array(128);
        zeroAir.process([], [[channel, new Float32Array(128)]]);
        for (const sample of channel) zeroAirPeak = Math.max(zeroAirPeak, Math.abs(sample));
      }
      assert.ok(
        zeroAirPeak < 1e-8,
        `${pneumaticSoundId} must not self-excite when lung pressure is zero`,
      );
    }

    const nasalOpenings = [0.39, 0.4].map((nasalMix) => {
      const configuration = { ...HAMBONE_DEFAULTS, nasalMix };
      const processor = new Processor({ processorOptions: { configuration } });
      const frame = hamboneGestureFrame("bop", 0.25, configuration, 0.86);
      processor.tract.setArticulation(
        configuration,
        frame,
        physicalVoiceParameters("bop", configuration, 0.86),
        true,
      );
      return processor.tract.nose.targetOpening;
    });
    assert.ok(
      Math.abs(nasalOpenings[1] - nasalOpenings[0]) < 0.05,
      "nasal mutation must cross the human/alien region continuously",
    );

    const shortMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HAMBONE_DEFAULTS,
          tractLengthM: HAMBONE_LIMITS.tractLengthM[0],
        },
      },
    });
    const longMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HAMBONE_DEFAULTS,
          tractLengthM: HAMBONE_LIMITS.tractLengthM[1],
        },
      },
    });
    assert.ok(Number.isInteger(shortMouth.tract?.sectionCount));
    assert.ok(Number.isInteger(longMouth.tract?.sectionCount));
    assert.ok(shortMouth.tract.sectionCount >= 8);
    assert.ok(
      longMouth.tract.sectionCount > shortMouth.tract.sectionCount * 2.5,
      "physical tract length must materially change propagation delay, not just remap a formant EQ",
    );

    globalThis.sampleRate = 96_000;
    const highRateLongMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HAMBONE_DEFAULTS,
          tractLengthM: HAMBONE_LIMITS.tractLengthM[1],
        },
      },
    });
    assert.ok(
      highRateLongMouth.tract.sectionCount > 280,
      "the longest oral tract must retain its propagation length at 96 kHz",
    );
    globalThis.sampleRate = 48_000;
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("Hambone page, app, accessibility, catalogue, MIDI registry, and build wiring stay integrated", async () => {
  const [html, css, app, model, processor, readme, buildScript] = await Promise.all([
    readFile(new URL("hambone.html", root), "utf8"),
    readFile(new URL("hambone.css", root), "utf8"),
    readFile(new URL("hambone-app.js", root), "utf8"),
    readFile(new URL("src/hambone.js", root), "utf8"),
    readFile(new URL("src/hambone-processor.js", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /<title>Hambone · Morphazoid<\/title>/);
  assert.match(html, /face-percussion and beatbox physical model/i);
  assert.match(html, /<h1>HAMBONE<\/h1>/);
  assert.doesNotMatch(html, /crazed clown beatbox/i);
  assert.doesNotMatch(html, /one face\s*(?:×|x)\s*one mouth/i);
  assert.match(html, /href="hambone\.css[^\"]*"/);
  assert.match(html, /src="hambone-app\.js[^\"]*"/);
  assert.ok(
    html.indexOf("hambone-stage") < html.indexOf("hambone-sequencer"),
    "the sixteen-step sequencer must follow the face visual",
  );
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"[\s\S]*?aria-label=/);
  assert.match(html, /aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="sequenceGrid"[\s\S]*?role="grid"/);
  assert.match(html, /aria-rowcount="16"/);
  assert.match(html, /aria-colcount="16"/);
  assert.match(html, /Only one (?:sound|gesture|pose) can occupy each step/i);
  assert.match(html, /beyond human ranges/i);
  assert.match(html, /id="padGrid"[\s\S]*?Sixteen playable Hambone sound pads/i);
  assert.match(html, /id="effectContourGrid"[\s\S]*?aria-rowcount="3"/);
  assert.match(html, /Nose controls nasal tone[\s\S]*Ears control stereo delay[\s\S]*Eyes control reverb/i);
  assert.match(html, /Drag both hands to slap different resonant zones/i);
  assert.doesNotMatch(html, />SHHH</);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="playButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="audioError"[^>]*role="alert"/);
  assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /class="sr-only" id="canvasInstructions"/);
  for (const controlId of Object.keys(HAMBONE_LIMITS)) {
    assert.match(html, new RegExp(`for="${controlId}"`), `${controlId} needs a visible label`);
  }
  assert.match(html, /id="tempo"[^>]*max="520"/);
  for (const controlId of ["dooPitch", "earSpread", "eyeDivergence"]) {
    assert.match(html, new RegExp(`id="${controlId}"`));
  }

  assert.match(css, /\.hambone-workspace\s*\{[\s\S]*?grid-template-rows:/);
  assert.match(css, /\.hambone-sequence-grid\s*\{[\s\S]*?repeat\(16,/);
  assert.match(css, /grid-template-rows:\s*20px repeat\(16,/);
  assert.match(css, /\.hambone-effect-contour-grid\s*\{[\s\S]*?repeat\(16,/);
  assert.match(css, /grid-template-rows:\s*20px repeat\(3,/);
  assert.match(css, /\.hambone-grid-scroll\s*\{[\s\S]*?overflow:/);
  assert.match(css, /\.hambone-step-cell:focus-visible/);
  assert.match(css, /@media \(max-width:\s*680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);

  assert.match(app, /from "\.\/src\/hambone\.js"/);
  assert.match(app, /\.\/src\/hambone-processor\.js/);
  assert.match(app, /"hambone-physical-model"/);
  assert.match(app, /connectAudioOutput\(context, analyser/);
  assert.match(app, /function buildPadGrid\(\)/);
  assert.match(app, /HAMBONE_SOUNDS\.map\(\(sound, index\) =>/);
  assert.match(app, /button\.dataset\.padIndex = String\(index\)/);
  assert.match(app, /function buildSequenceGrid\(\)/);
  assert.match(app, /function buildEffectContourGrid\(\)/);
  assert.match(app, /const EFFECT_LANES = Object\.freeze/);
  for (const effectKey of ["nasalMix", "earSpread", "eyeDivergence"]) {
    assert.match(app, new RegExp(`key: "${effectKey}"`));
  }
  assert.match(app, /Array\(HAMBONE_STEP_COUNT\)/);
  assert.match(app, /configuration:\s*stepEffects/);
  assert.match(
    app,
    /function initialize\(\)[\s\S]*?buildPadGrid\(\)[\s\S]*?buildSequenceGrid\(\)[\s\S]*?buildEffectContourGrid\(\)/,
  );
  assert.match(app, /setAttribute\("role", "gridcell"\)/);
  assert.match(app, /setAttribute\("aria-pressed", String\(level > 0\)\)/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowUp/);
  assert.match(app, /ArrowDown/);
  assert.match(app, /const pressedKey = String\(event\.key\)\.toLowerCase\(\)/);
  assert.match(app, /HAMBONE_SOUNDS\.find\(\(\{ key \}\) => String\(key\)\.toLowerCase\(\) === pressedKey\)/);
  assert.match(app, /type: "strike"/);
  assert.match(app, /type: "silence"/);
  assert.match(app, /function clearStepExcept\(step, soundId\)/);
  assert.match(app, /if \(next > 0\) clearStepExcept\(step, sound\.id\)/);
  assert.doesNotMatch(app, /soundAnimations/);
  assert.match(app, /function morphDisplayedPose\(target, now, isSpeaking\)/);
  assert.match(app, /type\s*(?:===|!==)\s*"telemetry"/);
  assert.match(app, /function drawHands\(context, motion\)/);
  assert.match(app, /soundId: "slap"[\s\S]*soundId: "smack"/);
  assert.match(app, /pointerDrag\?\.type === "hand"/);
  assert.match(app, /pointerDrag = \{[\s\S]*?type: "hand"[\s\S]*?soundId: hand\.soundId/);
  assert.match(app, /triggerSound\(drag\.soundId, velocity, handStrikeConfiguration\(drag\.handId\)\)/);
  for (const feature of ["nose", "ear", "eye"]) {
    assert.match(app, new RegExp(`feature: "${feature}"`));
  }
  for (const field of [
    "activeGesture",
    "gestureProgress",
    "gestureAmount",
    "tractPressure",
    "constrictionIndex",
    "constrictionDiameterCm",
    "velumOpening",
    "lipDiameterCm",
    "cheekDisplacement",
    "dooPitch",
    "earSpread",
    "eyeDivergence",
  ]) {
    assert.match(app, new RegExp(`\\b${field}\\b`), `the face must consume ${field} telemetry`);
    assert.match(processor, new RegExp(`\\b${field}\\b`), `the tract must report ${field} telemetry`);
  }
  assert.match(processor, /\boralSectionCount\b/);
  assert.match(processor, /\bstereoDelayMs\b/);
  assert.match(model, /one physical mouth/i);
  assert.match(model, /const exclusivePatternRows/);
  assert.match(processor, /this\.tract\s*=/);
  assert.match(processor, /this\.gesture\s*=/);
  assert.match(processor, /hamboneGestureFrame(?:AtSample)?/);
  assert.match(processor, /hamboneTargetOralDiameters/);
  assert.doesNotMatch(processor, /this\.voice\s*=/);
  assert.doesNotMatch(processor, /this\.voices\s*=/);
  assert.doesNotMatch(processor, /voicePool|voiceSlots/i);
  assert.match(processor, /activeVoices:/);
  assert.match(processor, /\bright\b/i);
  assert.match(processor, /\bleft\b/i);
  assert.match(processor, /reflection/i);
  assert.match(processor, /scatter/i);
  assert.match(processor, /nasal/i);
  assert.match(processor, /pressure/i);
  assert.match(processor, /turbulen/i);
  assert.match(processor, /lip(?:Valve|Aperture|Diameter|Closure)/i);
  assert.match(processor, /class FaceSpace/);
  assert.match(processor, /class PressureDrivenTongueValve/);
  assert.match(processor, /airflowDirection/);
  assert.match(processor, /configurationSnapshot/);
  assert.doesNotMatch(processor, /StateVariableBandpass/);
  assert.doesNotMatch(processor, /formantFrequenciesHz|formantBandwidthsHz|formantFilters/);

  const voiceTools = TOOL_GROUPS.find(({ id }) => id === "voice-synths")?.tools ?? [];
  assert.deepEqual(
    voiceTools.find(({ id }) => id === "hambone"),
    { id: "hambone", label: "Hambone", href: "hambone.html" },
  );
  const catalogEntry = instrumentById("hambone");
  assert.equal(catalogEntry?.href, "hambone.html");
  assert.equal(catalogEntry?.kind, "Monophonic physical beatbox sequencer");
  assert.equal(catalogEntry?.imageHref, "assets/instruments/hambone.webp");
  assert.match(catalogEntry?.description ?? "", /fully mutable face/i);
  assert.match(catalogEntry?.description ?? "", /sixteen exclusive gestures/i);
  assert.match(catalogEntry?.description ?? "", /PHSHSHK/i);
  assert.match(catalogEntry?.description ?? "", /HEE[\s\S]*HAW[\s\S]*DOO[\s\S]*BURP/i);
  assert.match(catalogEntry?.start ?? "", /single gesture per column/i);
  assert.match(catalogEntry?.start ?? "", /520 BPM/i);
  assert.match(catalogEntry?.start ?? "", /eyes, nose, and ears/i);
  assert.ok(catalogEntry?.features.includes("Pointer"));
  assert.ok(catalogEntry?.features.includes("Computer keys"));
  assert.deepEqual(catalogEntry?.tags.map(({ id }) => id), ["voice-synths", "sequencers"]);

  const midi = instrumentMidiCapabilityForId("hambone");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.computerKeyboardMode, "page");
  assert.equal(midi?.midiInput, true);
  assert.equal(midi?.midiOutput, true);

  for (const path of [
    "hambone.html",
    "hambone.css",
    "hambone-app.js",
    "src/hambone.js",
    "src/hambone-processor.js",
    "assets/instruments/hambone.webp",
  ]) {
    assert.match(
      buildScript,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path} must be copied and required by the site build`,
    );
  }
  assert.match(readme, /\*\*Hambone\*\*/);
  assert.match(readme, /sixteen playable gestures/i);
  assert.match(readme, /three per-step face contours/i);
  assert.match(readme, /520 BPM/i);
  assert.match(readme, /two visible hands/i);
  for (const label of [
    "BOP", "BOOP", "POP", "TLIK", "PHSHSHK", "SHACK!", "SLAP", "PFF",
    "KICK", "SMACK", "HEE", "HAW", "DOO", "MWAH", "DRR", "BURP",
  ]) {
    assert.match(readme, new RegExp(label.replace("!", "\\!")));
  }
});
