import assert from "node:assert/strict";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  CONTROL_LIMITS,
  resolveSourceControls,
} from "../src/syrinx.js";
import {
  CREATURAZOID_ANATOMY_DESIGNS,
  CREATURAZOID_BODY_PRESETS,
  CREATURAZOID_DEFAULTS,
  CREATURAZOID_DYNAMICS,
  CREATURAZOID_EAR_TYPES,
  CREATURAZOID_GESTURE_TYPES,
  CREATURAZOID_LIMITS,
  CREATURAZOID_MAX_STEPS,
  CREATURAZOID_MORPH_CONTROLS,
  CREATURAZOID_PERCUSSIVE_SOUND_IDS,
  CREATURAZOID_SEQUENCE_PRESETS,
  CREATURAZOID_SOUNDS,
  CREATURAZOID_TAIL_TYPES,
  CREATURAZOID_VOICE_PRESETS,
  applyCreaturazoidMorphBias,
  creaturazoidArticulationAt,
  creaturazoidAttackPhase,
  creaturazoidAnatomyDesign,
  creaturazoidBodyBaseline,
  creaturazoidBodyLevelTrim,
  creaturazoidBodyPreset,
  creaturazoidEventsAtStep,
  creaturazoidContourOffsets,
  creaturazoidLevelMakeup,
  creaturazoidMouthExpression,
  creaturazoidQuickMorphProgress,
  creaturazoidRecommendedSpaceSteps,
  creaturazoidNativeAttackPhase,
  creaturazoidRhythmicGesturePhase,
  creaturazoidSequenceDurationSeconds,
  creaturazoidSequenceOnsetPhase,
  creaturazoidSequencePreset,
  creaturazoidSound,
  creaturazoidSoundForKey,
  creaturazoidState,
  creaturazoidStepEvent,
  creaturazoidStepIntervalSeconds,
  creaturazoidTongueState,
  cycleCreaturazoidDynamics,
  cycleCreaturazoidStep,
  interpolateCreaturazoidMorph,
  mutateCreaturazoidState,
  resolveCreaturazoidEventState,
  sanitizeCreaturazoidPattern,
  sanitizeCreaturazoidShape,
  sanitizeCreaturazoidState,
  setCreaturazoidStep,
} from "../src/creaturazoid.js";
import { applyTongueToDiameter } from "../src/tongue-physics.js";

const HYBRINX_PALETTE = new Set([
  "#baff54",
  "#e3ff9f",
  "#59f1df",
  "#b6fff5",
  "#ff5f87",
  "#ffcf68",
  "#d08cff",
  "#64cfff",
  "#ff7b6f",
]);

const MUTATED_GEOMETRY_LIMITS = Object.freeze({
  bodyScale: [0.55, 1.35],
  bodyRoundness: [-1, 1],
  headScale: [0.55, 1.45],
  neckLength: [0.45, 1.55],
  neckWidth: [0.45, 1.55],
  thoraxWidth: [0.55, 1.5],
  bellyDepth: [0.45, 1.55],
  muzzleLength: [0.45, 1.55],
  mouthWidth: [0.5, 1.6],
  mouthDepth: [0.5, 1.65],
  jawTaper: [-1, 1],
  lipCurl: [-1, 1],
  wingSpan: [0.5, 1.5],
  hornScale: [0.45, 1.55],
  eyeScale: [0.55, 1.45],
  earLength: [0.4, 1.7],
  earWidth: [0.4, 1.7],
  earDroop: [-1, 1],
  earRotation: [-1, 1],
  tailLength: [0.45, 1.75],
  tailThickness: [0.35, 1.7],
  tailCurl: [-1, 1],
  tailTuft: [0, 1],
  tongueWidth: [0.45, 1.55],
});

function cyclingRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function assertFiniteAndBoundedSyrinxState(state, label = "state") {
  for (const [name, [minimum, maximum]] of Object.entries(CONTROL_LIMITS)) {
    assert.ok(Number.isFinite(state[name]), `${label}.${name} must be finite`);
    assert.ok(state[name] >= minimum, `${label}.${name} must be >= ${minimum}`);
    assert.ok(state[name] <= maximum, `${label}.${name} must be <= ${maximum}`);
  }
  assert.equal(state.biologicalLock, false);
  assert.ok(Number.isFinite(state.sourceFrequencyRatio));
  assert.ok(state.sourceFrequencyRatio >= 0.03 && state.sourceFrequencyRatio <= 24);
}

test("fifty calls keep mammals dominant and add fourteen physically articulated creature actions", () => {
  assert.equal(CREATURAZOID_SOUNDS.length, 50);
  assert.equal(new Set(CREATURAZOID_SOUNDS.map(({ id }) => id)).size, 50);
  assert.equal(new Set(CREATURAZOID_SOUNDS.map(({ key }) => key)).size, 50);
  assert.deepEqual(new Set(CREATURAZOID_SOUNDS.map(({ color }) => color)), HYBRINX_PALETTE);
  assert.deepEqual(CREATURAZOID_GESTURE_TYPES, ["vocal", "percussive"]);
  assert.equal(CREATURAZOID_PERCUSSIVE_SOUND_IDS.length, 14);
  assert.deepEqual(
    Object.fromEntries(["mammal", "bird", "frog", "rodent"].map((family) => [
      family,
      CREATURAZOID_SOUNDS.filter((sound) => sound.family === family).length,
    ])),
    { mammal: 33, bird: 10, frog: 5, rodent: 2 },
  );
  assert.ok(CREATURAZOID_SOUNDS.filter(({ family }) => family === "mammal").length > CREATURAZOID_SOUNDS.length / 2);

  const requiredCalls = [
    "dog-growl", "elephant-rumble", "alligator-bellow", "reddeer-common-roar",
    "reddeer-harsh-roar", "hyena-whoop", "hyena-giggle", "wildboar-grunt",
    "cow-moo", "cow-contact", "moose-bull-grunt", "moose-cow-moan",
    "raven-croak", "raven-rattle", "dove-coo", "dove-double", "owl-hoot", "owl-double",
    "wolf-yip", "songbird-trill", "songbird-phrase", "treefrog-chirp",
    "treefrog-trill", "mouse-steps", "elephant-trumpet",
  ];
  for (const callId of requiredCalls) {
    assert.ok(CREATURAZOID_SOUNDS.some((sound) => sound.callId === callId), `${callId} must be playable`);
  }
  const compactCalls = CREATURAZOID_SOUNDS.filter(({ durationMs }) => durationMs <= 640);
  assert.ok(compactCalls.length >= 19);
  assert.deepEqual(
    new Set(["yip", "trill", "chirp", "ticks"].map((id) => creaturazoidSound(id).callId)),
    new Set(["wolf-yip", "songbird-trill", "treefrog-chirp", "mouse-steps"]),
  );
  assert.ok([...HYBRINX_PALETTE].every((color) => (
    CREATURAZOID_SOUNDS.some((sound) => sound.color === color)
  )));
  const localPitches = CREATURAZOID_SOUNDS.map(({ pitchSemitones }) => pitchSemitones);
  assert.equal(Math.min(...localPitches), -24);
  assert.ok(Math.max(...localPitches) >= 4);
  assert.ok(localPitches.filter((pitch) => pitch >= 1).length >= 14);

  const defaultBody = creaturazoidState();
  const midGestureFrequencies = CREATURAZOID_SOUNDS.map((sound) => resolveSourceControls(
    resolveCreaturazoidEventState(sound.id, {
      state: defaultBody,
      phase: 0.5,
      elapsedSeconds: 0.4,
      velocity: 1,
    }),
  ).frequencyHz);
  const mammalFrequencies = midGestureFrequencies.filter((_, index) => CREATURAZOID_SOUNDS[index].family === "mammal");
  const birdFrequencies = midGestureFrequencies.filter((_, index) => CREATURAZOID_SOUNDS[index].family === "bird");
  assert.ok(mammalFrequencies.filter((frequencyHz) => frequencyHz < 200).length >= 18);
  assert.ok(birdFrequencies.every((frequencyHz) => frequencyHz >= 110 && frequencyHz <= 800));
  assert.ok(midGestureFrequencies.filter((frequencyHz) => frequencyHz < 1_000).length >= 45);
  assert.ok(midGestureFrequencies.filter((frequencyHz) => frequencyHz >= 1_000).length <= 5);
  assert.ok(new Set(midGestureFrequencies.map((frequencyHz) => Math.round(frequencyHz / 10) * 10)).size >= 14);

  for (const sound of CREATURAZOID_SOUNDS) {
    const animal = ANIMALS[sound.animalId];
    const gesture = CALL_GESTURES[sound.callId];
    assert.ok(animal, `${sound.id} needs a Hybrinx animal`);
    assert.ok(gesture, `${sound.id} needs a Hybrinx call`);
    assert.ok(animal.callIds.includes(sound.callId), `${sound.callId} must belong to ${sound.animalId}`);
    assert.equal(sound.family, animal.model);
    assert.ok(sound.label.length >= 2 && sound.label.length <= 8);
    assert.match(sound.color, /^#[0-9a-f]{6}$/i);
    if (sound.gestureType === "vocal") assert.equal(sound.durationMs, gesture.durationMs);
    else assert.ok(sound.durationMs >= 80 && sound.durationMs <= 1_000);
    assert.ok(sound.recommendedSpaceSteps >= 1 && sound.recommendedSpaceSteps <= 16);
    assert.equal(sound.recommendedSpaceSteps, creaturazoidRecommendedSpaceSteps(sound, 84));
    assert.equal(creaturazoidSound(sound.id), sound);
    assert.equal(creaturazoidSoundForKey(sound.key), sound);
  }

  const requested = new Map([
    ["neigh", "neigh"], ["hiss", "hiss"], ["hoof-stomp", "stomp"],
    ["horn-surprise", "horn"], ["caw", "caw"], ["snap-bark", "bark"],
    ["clawing", "claw"], ["tail-whip", "whip"], ["footsteps", "footsteps"],
    ["feather-ruffle", "ruffle"], ["panting", "pant"], ["lapping", "lap"],
    ["crunching", "crunch"], ["jumping", "jump"],
  ]);
  assert.deepEqual(new Set(CREATURAZOID_PERCUSSIVE_SOUND_IDS), new Set(requested.keys()));
  for (const [soundId, motion] of requested) {
    const sound = creaturazoidSound(soundId);
    assert.equal(sound.gestureType, "percussive");
    assert.equal(sound.articulation.motion, motion);
    assert.ok(sound.articulation.mechanism.length >= 12);
    for (const phase of [0, 0.02, 0.25, 0.5, 0.75, 1]) {
      const articulation = creaturazoidArticulationAt(sound, phase);
      for (const name of [
        "pressure", "airwayGate", "voicing", "turbulence", "burstGain",
        "burstFrequencyHz", "flutterHz", "flutterDepth", "sourceGain", "flowDirection",
      ]) assert.ok(Number.isFinite(articulation[name]), `${soundId}.${name}/${phase}`);
    }
  }
  assert.ok(creaturazoidArticulationAt("hiss", 0.5).voicing <= 0.05);
  assert.ok(creaturazoidArticulationAt("hiss", 0.5).turbulence >= 0.6);
  assert.ok(creaturazoidArticulationAt("hiss", 0.5).turbulence <= 0.95);
  assert.equal(creaturazoidSound("hoof-stomp").articulation.contact.strikes[0].phase, 0);
  assert.equal(creaturazoidSound("footsteps").articulation.contact.strikes.length, 4);
  assert.ok(creaturazoidArticulationAt("feather-ruffle", 0.5).flutterHz >= 20);
  assert.ok(creaturazoidSound("jumping").articulation.contact.strikes.some(({ phase }) => phase >= 0.8));
});

test("body contacts favor resonant modes over broadband noise", () => {
  const contacts = CREATURAZOID_SOUNDS
    .map(({ id, articulation }) => ({ id, contact: articulation?.contact }))
    .filter(({ contact }) => contact);
  const strikes = contacts.flatMap(({ contact }) => contact.strikes);

  assert.ok(contacts.length >= 8);
  assert.ok(strikes.length >= 20);
  for (const { id, contact } of contacts) {
    assert.ok(contact.scrapeNoiseMix <= 0.2, `${id} scrape must remain resonance-led`);
    for (const strike of contact.strikes) {
      assert.ok(strike.noiseMix <= 0.4, `${id} strike must retain at least 60% pitched body mode`);
    }
  }
  assert.ok(
    strikes.reduce((sum, { noiseMix }) => sum + noiseMix, 0) / strikes.length <= 0.26,
    "the body-contact bank must remain predominantly tonal",
  );
});

test("three horned anatomical systems add mobile ears without restoring cartoon eyebrows", () => {
  assert.equal(CREATURAZOID_ANATOMY_DESIGNS.length, 3);
  assert.equal(new Set(CREATURAZOID_ANATOMY_DESIGNS.map(({ id }) => id)).size, 3);
  for (const design of CREATURAZOID_ANATOMY_DESIGNS) {
    assert.equal(creaturazoidAnatomyDesign(design.id), design);
    assert.ok(design.structures.some((structure) => /feather|flight/i.test(structure)));
    assert.ok(design.structures.some((structure) => /horn|antler/i.test(structure)));
    assert.match(`${design.label} ${design.description} ${design.structures.join(" ")}`, /pinna|ear/i);
    assert.doesNotMatch(`${design.label} ${design.description} ${design.structures.join(" ")}`, /eyebrow/i);
    assert.ok(design.proportions.wingSpan >= 0.7);
    assert.ok(design.proportions.toothExposure >= 0.2 && design.proportions.toothExposure <= 0.38);
  }
  assert.equal(creaturazoidAnatomyDesign("unknown").id, CREATURAZOID_DEFAULTS.anatomyDesignId);
});

test("eight generic bodies carry morphing mouths, varied ears and tails, and the Hybrinx palette", () => {
  assert.equal(CREATURAZOID_BODY_PRESETS.length, 8);
  assert.equal(CREATURAZOID_VOICE_PRESETS, CREATURAZOID_BODY_PRESETS, "the old export is only an alias");
  const speciesWords = /hyena|cervid|canid|crocodil|panther|bovine|avian|anuran|lion|wolf|bird|frog|cow|mouse/i;

  for (const preset of CREATURAZOID_BODY_PRESETS) {
    const state = creaturazoidState(preset.id);
    assert.equal(creaturazoidBodyPreset(preset.id), preset);
    assert.equal(state.bodyPresetId, preset.id);
    assert.equal(state.voicePresetId, preset.id, "compatibility state mirrors the canonical body id");
    assert.doesNotMatch(`${preset.id} ${preset.label} ${preset.description}`, speciesWords);
    assert.equal(state.anatomyDesignId, preset.settings.anatomyDesignId);
    assert.equal(state.biologicalLock, false);
    assert.equal(state.bodyScale, preset.shape.bodyScale);
    assert.equal(state.bodyRoundness, preset.shape.bodyRoundness);
    assert.equal(state.attackMs, preset.response.attackMs);
    assert.equal(state.morphTimeMs, preset.response.retargetMs);
    assert.deepEqual(state.bodyState, preset.bodyState);
    assert.deepEqual(state.tractDiameterProfile, preset.tractDiameterProfile);
    assert.equal(state.tractDiameterScale, preset.tractDiameterScale);
    assert.equal(state.cavityFrequencyHz, preset.cavityFrequencyHz);
    assert.ok(preset.palette.length >= 6);
    assert.match(preset.color, /^#[0-9a-f]{6}$/i);
    assert.deepEqual(new Set(preset.palette), HYBRINX_PALETTE, `${preset.id} must use the full Hybrinx palette`);
    const vividColors = preset.palette.filter((color) => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      return Math.max(...channels) >= 230 && Math.max(...channels) - Math.min(...channels) >= 140;
    });
    assert.ok(vividColors.length >= 4, `${preset.id} needs at least four vivid anatomical colors`);
    for (const name of CREATURAZOID_MORPH_CONTROLS) {
      const [minimum, maximum] = CONTROL_LIMITS[name];
      assert.ok(preset.bodyState[name] >= minimum && preset.bodyState[name] <= maximum);
    }
    for (const field of [
      "bodyScale", "bodyRoundness", "headScale", "neckLength", "neckWidth", "thoraxWidth",
      "mouthWidth", "mouthDepth", "jawTaper", "lipCurl",
      "earLength", "earWidth", "earDroop", "earRotation",
      "tailLength", "tailThickness", "tailCurl", "tailTuft", "tongueWidth",
    ]) {
      assert.ok(Number.isFinite(preset.shape[field]), `${preset.id}.${field} must be explicit`);
    }
    assert.ok(preset.modulations.length >= 2 && preset.modulations.length <= 3);
    for (const modulation of preset.modulations) {
      assert.ok(CREATURAZOID_MORPH_CONTROLS.includes(modulation.target));
      assert.ok(modulation.speed.length >= 3, `${preset.id}/${modulation.target} needs an enveloped speed`);
      assert.ok(modulation.depth.length >= 3, `${preset.id}/${modulation.target} needs an enveloped depth`);
      assert.ok(new Set(modulation.speed.map(([, value]) => value)).size > 1);
      assert.ok(new Set(modulation.depth.map(([, value]) => value)).size > 1);
    }
  }

  const scales = CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.bodyScale);
  const roundness = CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.bodyRoundness);
  const mouthWidths = CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.mouthWidth);
  const mouthDepths = CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.mouthDepth);
  assert.ok(Math.max(...scales) - Math.min(...scales) >= 0.6);
  assert.ok(Math.max(...roundness) - Math.min(...roundness) >= 0.8);
  assert.ok(Math.max(...mouthWidths) - Math.min(...mouthWidths) >= 0.8);
  assert.ok(Math.max(...mouthDepths) - Math.min(...mouthDepths) >= 0.8);
  assert.deepEqual(
    new Set(CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.earType)),
    new Set(CREATURAZOID_EAR_TYPES),
  );
  assert.deepEqual(
    new Set(CREATURAZOID_BODY_PRESETS.map(({ shape }) => shape.tailType)),
    new Set(CREATURAZOID_TAIL_TYPES),
  );

  const sanitized = sanitizeCreaturazoidShape({
    earType: "invented",
    tailType: "invented",
    mouthWidth: 99,
    mouthDepth: -99,
    tailLength: Infinity,
  });
  assert.equal(sanitized.earType, "point");
  assert.equal(sanitized.tailType, "brush");
  assert.equal(sanitized.mouthWidth, 1.6);
  assert.equal(sanitized.mouthDepth, 0.5);
  assert.equal(sanitized.tailLength, 1);
});

test("body mutation is pure, repeatable, and always produces a visibly different specimen", () => {
  const randomStreams = [
    [0],
    [0.5],
    [1],
    [0.03, 0.97, 0.24, 0.76, 0.41, 0.89],
  ];

  for (const preset of CREATURAZOID_BODY_PRESETS) {
    const original = creaturazoidState(preset.id);
    const snapshot = structuredClone(original);
    for (const stream of randomStreams) {
      const mutated = mutateCreaturazoidState(original, cyclingRandom(stream));
      const repeated = mutateCreaturazoidState(original, cyclingRandom(stream));

      assert.deepEqual(mutated, repeated, `${preset.id} must support deterministic injected randomness`);
      assert.deepEqual(original, snapshot, `${preset.id} input state must not be mutated`);
      assert.notEqual(mutated.anatomyDesignId, original.anatomyDesignId);
      assert.notEqual(mutated.bodyShape.earType, original.bodyShape.earType);
      assert.notEqual(mutated.bodyShape.tailType, original.bodyShape.tailType);
      assert.notEqual(mutated.bodyShape.tongueAnatomy, original.bodyShape.tongueAnatomy);
      assert.equal(mutated.bodyShape.bodyScale, mutated.bodyScale);
      assert.equal(mutated.bodyShape.bodyRoundness, mutated.bodyRoundness);

      for (const [field, [minimum, maximum]] of Object.entries(MUTATED_GEOMETRY_LIMITS)) {
        const before = field === "bodyScale" || field === "bodyRoundness"
          ? original[field]
          : original.bodyShape[field];
        const after = field === "bodyScale" || field === "bodyRoundness"
          ? mutated[field]
          : mutated.bodyShape[field];
        const minimumFraction = field === "bodyScale" ? 0.25 : field === "bodyRoundness" ? 0.27 : 0.22;
        assert.ok(
          Math.abs(after - before) + 1e-12 >= (maximum - minimum) * minimumFraction,
          `${preset.id}.${field} must make a major geometric jump`,
        );
      }
    }
  }
});

test("mouth expression identities resolve to six distinct anatomical poses", () => {
  const expected = new Map([
    ["growl", ["mean", "mean"]],
    ["giggle", ["happy", "happy"]],
    ["lapping", ["hungry", "hungry"]],
    ["horn-surprise", ["gobsmacked", "gobsmacked"]],
    ["howl", ["howl", "howl"]],
    ["caw", ["open-beak", "openBeak"]],
  ]);
  const expressions = [];
  for (const [soundId, [kind, activeChannel]] of expected) {
    const expression = creaturazoidMouthExpression(soundId);
    expressions.push(expression);
    assert.equal(expression.kind, kind);
    assert.equal(expression[activeChannel], 1);
    assert.ok(Object.isFrozen(expression));
  }
  assert.equal(new Set(expressions.map(({ kind }) => kind)).size, expected.size);
});

test("the animated Hybrinx tongue stays bounded and gives growls and chirps different tract shapes", () => {
  const state = creaturazoidState("dense-squat", {
    tongueReach: 0.8,
    tongueMotion: 1,
  });
  const growl = resolveCreaturazoidEventState("growl", {
    state,
    phase: 0.5,
    velocity: 1,
  });
  const chirp = resolveCreaturazoidEventState("chirp", {
    state,
    phase: 0.5,
    velocity: 1,
  });

  for (const [label, tongue] of [["growl", growl.tongue], ["chirp", chirp.tongue]]) {
    assert.equal(tongue.tongueEnabled, true);
    for (const field of [
      "tonguePosition", "tongueHeight", "tongueShape", "tongueTip",
      "tongueExtension", "tongueCurl", "tongueLateral",
    ]) {
      assert.ok(Number.isFinite(tongue[field]), `${label}.${field} must be finite`);
      assert.ok(tongue[field] >= 0 && tongue[field] <= 1, `${label}.${field} must stay normalized`);
    }
  }
  assert.ok(growl.tongue.tonguePosition < chirp.tongue.tonguePosition - 0.2);
  assert.ok(growl.tongue.tongueShape < chirp.tongue.tongueShape - 0.2);
  assert.ok(growl.tongue.tongueLateral > chirp.tongue.tongueLateral);

  const tractSamples = Array.from({ length: 81 }, (_, index) => index / 80);
  const growlArea = tractSamples.map((position) => (
    applyTongueToDiameter(position, 1, growl.tongue)
  ));
  const chirpArea = tractSamples.map((position) => (
    applyTongueToDiameter(position, 1, chirp.tongue)
  ));
  assert.ok(growlArea.some((diameter, index) => Math.abs(diameter - chirpArea[index]) > 0.05));
  assert.ok(Math.min(...growlArea) < 0.9);
  assert.ok(Math.min(...chirpArea) < 0.9);

  const early = creaturazoidTongueState(
    resolveCreaturazoidEventState("growl", { state, phase: 0.2, velocity: 1 }),
    state,
  );
  assert.notDeepEqual(early, growl.tongue, "call-local motion must animate the acoustic articulator");

  const hostile = sanitizeCreaturazoidState({
    earSpread: 99,
    tongueReach: -99,
    tongueMotion: Infinity,
  });
  assert.equal(hostile.earSpread, 1);
  assert.equal(hostile.tongueReach, 0);
  assert.equal(hostile.tongueMotion, CREATURAZOID_DEFAULTS.tongueMotion);
});

test("idle and active tongue travel materially follow the persistent reach control", () => {
  const reaches = [0, 0.5, 1];
  const idleExtensions = reaches.map((tongueReach) => creaturazoidTongueState({
    soundId: "growl",
    active: false,
  }, creaturazoidState("dense-squat", { tongueReach })).tongueExtension);
  const activeExtensions = reaches.map((tongueReach) => creaturazoidTongueState({
    soundId: "growl",
    active: true,
    velocity: 1,
    pressure: 0.8,
    articulationPhase: 0.37,
    callPhase: 0.37,
    bodyMotion: { envelope: 0.8 },
    articulation: { motion: "growl" },
  }, creaturazoidState("dense-squat", { tongueReach })).tongueExtension);

  for (const [label, extensions] of [["idle", idleExtensions], ["active", activeExtensions]]) {
    assert.ok(extensions[0] < extensions[1] && extensions[1] < extensions[2], `${label} tongue reach must be monotonic`);
    assert.ok(extensions[2] - extensions[0] > 0.6, `${label} tongue needs materially visible travel`);
  }
});

test("one absolute body baseline survives every call family while call identity stays intact", () => {
  for (const preset of CREATURAZOID_BODY_PRESETS) {
    const state = creaturazoidState(preset.id);
    for (const sound of CREATURAZOID_SOUNDS) {
      const baseline = creaturazoidBodyBaseline(sound, state);
      assert.equal(baseline.animalId, sound.animalId);
      assert.equal(baseline.callId, sound.callId);
      assert.equal(baseline.sourceModel, sound.family);
      assert.equal(baseline.bodyPresetId, preset.id);
      for (const name of CREATURAZOID_MORPH_CONTROLS) {
        assert.equal(baseline[name], preset.bodyState[name], `${preset.id}/${sound.id} must retain body ${name}`);
      }
      assert.equal(baseline.tractDiameterScale, preset.bodyState.tractDiameterScale);
      assert.equal(baseline.cavityFrequencyHz, preset.bodyState.cavityFrequencyHz);
    }
  }

  const colossalState = creaturazoidState("colossal-barrel");
  const pocketState = creaturazoidState("pocket-needle");
  assert.ok(colossalState.bodyScale > pocketState.bodyScale * 1.8);
  assert.ok(colossalState.bodyRoundness > pocketState.bodyRoundness);
  assert.ok(colossalState.bodyState.sourceScale > pocketState.bodyState.sourceScale * 6);
  assert.ok(colossalState.bodyState.tractLengthM > pocketState.bodyState.tractLengthM * 12);
  assert.ok(colossalState.bodyState.tractDiameterScale > pocketState.bodyState.tractDiameterScale * 3);
  for (const sound of CREATURAZOID_SOUNDS) {
    const colossalHz = resolveSourceControls(creaturazoidBodyBaseline(sound, colossalState)).frequencyHz;
    const pocketHz = resolveSourceControls(creaturazoidBodyBaseline(sound, pocketState)).frequencyHz;
    assert.ok(colossalHz < pocketHz, `${sound.id} must pass through the selected body register`);
  }

  const compact = creaturazoidBodyBaseline("roar", creaturazoidState("long-hollow", {
    bodyScale: 0.7,
    bodyRoundness: -0.6,
  }));
  const expanded = creaturazoidBodyBaseline("roar", creaturazoidState("long-hollow", {
    bodyScale: 1.3,
    bodyRoundness: 0.9,
  }));
  assert.ok(expanded.sourceScale > compact.sourceScale);
  assert.ok(expanded.tractLengthM > compact.tractLengthM);
  assert.ok(expanded.tractDiameterScale > compact.tractDiameterScale);
  assert.ok(expanded.cavityFrequencyHz < compact.cavityFrequencyHz);
});

test("body-independent sequences mix repeated dance motifs with room for multi-envelope phrases", () => {
  assert.ok(CREATURAZOID_SEQUENCE_PRESETS.length >= 8);
  const growlySoundIds = new Set([
    "roar", "chuff", "growl", "rumble", "bellow", "gator", "purr", "cervid",
    "harsh", "moose", "moan", "grunt", "moo", "lowmoo", "snap-bark", "panting", "crunching",
  ]);
  const chirpySoundIds = new Set([
    "yip", "giggle", "croak", "rattle", "trill", "phrase", "chirp", "frogtrill",
    "ticks", "caw", "feather-ruffle",
  ]);
  const defaultSequence = creaturazoidSequencePreset(CREATURAZOID_DEFAULTS.sequencePresetId);
  const defaultState = creaturazoidState();
  assert.equal(defaultState.tempo, defaultSequence.tempo);
  assert.equal(defaultState.swing, defaultSequence.swing);
  assert.equal(defaultState.patternLength, defaultSequence.length);

  const lengths = new Set();
  const dynamics = new Set();
  const usedSounds = new Set();
  const tempos = [];
  const swings = [];
  let birdOnsets = 0;
  let mammalOnsets = 0;
  let microOnsets = 0;
  let totalOnsets = 0;
  let percussiveOnsets = 0;
  let vocalOnsets = 0;
  let spaciousRichCalls = 0;
  let dancePresetCount = 0;
  let spaciousPresetCount = 0;
  for (const preset of CREATURAZOID_SEQUENCE_PRESETS) {
    assert.equal(Object.hasOwn(preset, "voicePresetId"), false, `${preset.id} must not select a voice`);
    assert.equal(Object.hasOwn(preset, "bodyPresetId"), false, `${preset.id} must not replace the body`);
    const pattern = sanitizeCreaturazoidPattern(preset);
    lengths.add(pattern.length);
    tempos.push(preset.tempo);
    swings.push(preset.swing);
    assert.equal(pattern.length, preset.length);
    assert.ok(pattern.length >= 1 && pattern.length <= CREATURAZOID_MAX_STEPS);
    assert.equal(Object.keys(pattern.rows).length, CREATURAZOID_SOUNDS.length);
    assert.ok([32, 64].includes(pattern.length));
    assert.ok(preset.tempo >= 90 && preset.tempo <= 160);
    for (const values of Object.values(pattern.rows)) assert.equal(values.length, CREATURAZOID_MAX_STEPS);
    const onsetSteps = [];
    const presetSoundIds = new Set();
    let presetMammalOnsets = 0;
    let presetMicroOnsets = 0;
    let presetPercussiveOnsets = 0;
    let presetVocalOnsets = 0;
    let presetGrowlyOnsets = 0;
    let presetChirpyOnsets = 0;
    for (let step = 0; step < pattern.length; step += 1) {
      const events = creaturazoidEventsAtStep(pattern, step);
      assert.ok(events.length <= 1, `${preset.id} step ${step} must be monophonic`);
      if (events[0]) {
        dynamics.add(events[0].velocity);
        usedSounds.add(events[0].soundId);
        presetSoundIds.add(events[0].soundId);
        totalOnsets += 1;
        if (events[0].sound.family === "bird") {
          birdOnsets += 1;
        }
        if (events[0].sound.family === "mammal") {
          mammalOnsets += 1;
          presetMammalOnsets += 1;
        }
        if (events[0].sound.durationMs <= 640) {
          microOnsets += 1;
          presetMicroOnsets += 1;
        }
        if (events[0].sound.gestureType === "percussive") {
          percussiveOnsets += 1;
          presetPercussiveOnsets += 1;
        } else {
          vocalOnsets += 1;
          presetVocalOnsets += 1;
        }
        if (growlySoundIds.has(events[0].soundId)) presetGrowlyOnsets += 1;
        if (chirpySoundIds.has(events[0].soundId)) presetChirpyOnsets += 1;
        onsetSteps.push(step);
      }
    }
    assert.ok(onsetSteps.length >= 11, `${preset.id} needs enough onsets to establish a rhythm`);
    assert.ok(presetChirpyOnsets >= 2, `${preset.id} needs an audible chirpy counter-rhythm`);
    assert.ok(presetGrowlyOnsets >= 2, `${preset.id} needs growly vocal weight`);
    assert.ok(presetMammalOnsets >= 4, `${preset.id} must retain mammalian weight`);
    assert.ok(presetMicroOnsets >= 6, `${preset.id} needs a dense micro-call cluster`);
    assert.ok(presetPercussiveOnsets >= 2, `${preset.id} must intersperse body percussion`);
    assert.ok(presetVocalOnsets >= 2, `${preset.id} must intersperse vocal calls`);
    if (preset.dance) {
      dancePresetCount += 1;
      assert.ok(onsetSteps.length / pattern.length >= 0.8, `${preset.id} must keep the dance subdivision busy`);
      assert.ok(presetSoundIds.size >= 8 && presetSoundIds.size <= 12, `${preset.id} needs a varied recurring kit`);
      assert.ok(
        presetPercussiveOnsets / onsetSteps.length >= 0.5
          && presetPercussiveOnsets / onsetSteps.length <= 0.7,
        `${preset.id} needs resonant hits interlocked with creature voices`,
      );
      assert.ok(
        presetVocalOnsets / onsetSteps.length >= 0.3
          && presetVocalOnsets / onsetSteps.length <= 0.5,
        `${preset.id} needs prominent growly and chirpy hooks`,
      );
      assert.ok(presetMicroOnsets / onsetSteps.length >= 0.58, `${preset.id} must articulate promptly`);
      for (let quarter = 0; quarter < pattern.length; quarter += 4) {
        assert.ok(creaturazoidStepEvent(pattern, quarter), `${preset.id} needs an onset on beat ${quarter / 4 + 1}`);
      }
      let repeatedPhaseRoles = 0;
      for (let phase = 0; phase < 16; phase += 1) {
        const roleIds = [];
        for (let phraseStart = 0; phraseStart < pattern.length; phraseStart += 16) {
          roleIds.push(creaturazoidStepEvent(pattern, phraseStart + phase)?.soundId ?? "");
        }
        if (roleIds[0] && roleIds.every((soundId) => soundId === roleIds[0])) repeatedPhaseRoles += 1;
      }
      assert.ok(repeatedPhaseRoles >= 8, `${preset.id} needs an audible sixteen-step ostinato`);
    } else {
      spaciousPresetCount += 1;
    }
    const circularGaps = [];
    for (let index = 0; index < onsetSteps.length; index += 1) {
      const step = onsetSteps[index];
      const next = onsetSteps[(index + 1) % onsetSteps.length];
      const circularGap = (next - step + pattern.length) % pattern.length;
      circularGaps.push(circularGap);
      const event = creaturazoidStepEvent(pattern, step);
      const pressureKeys = CALL_GESTURES[event.sound.callId].curves.pressure.length;
      const emptySteps = circularGap - 1;
      if (pressureKeys >= 7 && emptySteps >= 6 && emptySteps <= 12) spaciousRichCalls += 1;
    }
    assert.ok(Math.min(...circularGaps) <= 2, `${preset.id} needs a tight rhythmic figure`);
    if (preset.dance) {
      assert.ok(Math.max(...circularGaps) <= 3, `${preset.id} cannot lose the floor to a long random gap`);
    } else {
      assert.ok(Math.max(...circularGaps) >= 8, `${preset.id} needs breathing room around a phrase`);
    }
  }
  assert.ok(dancePresetCount >= 5);
  assert.ok(spaciousPresetCount >= 5);
  assert.deepEqual(lengths, new Set([32, 64]));
  assert.ok(dynamics.has(0.42) && dynamics.has(0.72) && dynamics.has(1));
  assert.ok(Math.max(...tempos) - Math.min(...tempos) >= 50);
  assert.ok(Math.max(...swings) - Math.min(...swings) >= 0.18);
  assert.ok(totalOnsets >= 260);
  assert.ok(birdOnsets >= 50);
  assert.ok(mammalOnsets >= 160);
  assert.ok(microOnsets >= 180);
  assert.ok(birdOnsets / totalOnsets >= 0.2);
  assert.ok(mammalOnsets / totalOnsets >= 0.55);
  assert.ok(microOnsets / totalOnsets > 0.5);
  assert.ok(percussiveOnsets >= 110);
  assert.ok(vocalOnsets >= 145);
  assert.ok(usedSounds.size >= 40);
  assert.ok(
    CREATURAZOID_PERCUSSIVE_SOUND_IDS.filter((soundId) => usedSounds.has(soundId)).length >= 13,
    "factory rhythms must demonstrate nearly every body action without becoming a noise reel",
  );
  assert.ok(spaciousRichCalls >= 12, "the long-form bank must keep six to twelve empty columns around rich calls");
  for (const restored of ["phrase", "frogtrill", "trumpet"]) {
    assert.ok(usedSounds.has(restored), `${restored} must appear in the factory rhythms`);
  }

  const defaultPattern = sanitizeCreaturazoidPattern(creaturazoidSequencePreset("hoof-and-hiss"));
  const defaultEvents = Array.from(
    { length: defaultPattern.length },
    (_, step) => creaturazoidStepEvent(defaultPattern, step),
  ).filter(Boolean);
  assert.equal(defaultEvents.length, 30);
  assert.ok(defaultEvents.filter(({ sound }) => sound.family === "bird").length >= 8);
  assert.ok(defaultEvents.filter(({ sound }) => sound.family === "mammal").length >= 19);
  assert.ok(defaultEvents.filter(({ sound }) => sound.durationMs <= 640).length >= 26);
  assert.ok(defaultEvents.filter(({ sound }) => sound.gestureType === "percussive").length >= 18);
  assert.ok(defaultEvents.filter(({ sound }) => sound.gestureType === "vocal").length >= 10);
  assert.ok(defaultEvents.some(({ soundId }) => growlySoundIds.has(soundId)));
  assert.ok(defaultEvents.some(({ soundId }) => chirpySoundIds.has(soundId)));
  assert.ok(defaultEvents.some(({ soundId }) => soundId === "neigh"));

  const pocket = creaturazoidState("pocket-needle");
  for (const sequence of CREATURAZOID_SEQUENCE_PRESETS) {
    const afterSequenceLoad = sanitizeCreaturazoidState({
      ...pocket,
      sequencePresetId: sequence.id,
      tempo: sequence.tempo,
      swing: sequence.swing,
      patternLength: sequence.length,
    }, pocket);
    assert.equal(afterSequenceLoad.bodyPresetId, pocket.bodyPresetId);
    assert.deepEqual(afterSequenceLoad.bodyState, pocket.bodyState);
    assert.equal(afterSequenceLoad.bodyScale, pocket.bodyScale);
    assert.equal(afterSequenceLoad.bodyRoundness, pocket.bodyRoundness);
  }
});

test("long gestures occupy one onset and recommend enough following rest space", () => {
  const howlSpace = creaturazoidRecommendedSpaceSteps("howl", 72);
  const growlSpace = creaturazoidRecommendedSpaceSteps("growl", 84);
  assert.equal(howlSpace, 15);
  assert.equal(growlSpace, 8);
  assert.ok(creaturazoidRecommendedSpaceSteps("not-real", Infinity) >= 1);

  let pattern = sanitizeCreaturazoidPattern({ length: 32, rows: {} });
  pattern = setCreaturazoidStep(pattern, 0, "howl", 1);
  assert.equal(creaturazoidStepEvent(pattern, 0).soundId, "howl");
  for (let step = 1; step < howlSpace; step += 1) {
    assert.equal(creaturazoidStepEvent(pattern, step), null, `howl continuation step ${step} remains a rest`);
  }
  pattern = setCreaturazoidStep(pattern, howlSpace, "growl", 0.72);
  assert.equal(creaturazoidStepEvent(pattern, howlSpace).soundId, "growl");
  assert.equal(creaturazoidEventsAtStep(pattern, howlSpace).length, 1);
});

test("hostile rows collapse to one winner and setting a step replaces its former sound", () => {
  const pattern = sanitizeCreaturazoidPattern({
    length: 8,
    rows: {
      roar: [0.42, 0, 0, 0, 0, 0, 0, 0],
      growl: [1, 0, 0, 0, 0, 0, 0, 0],
      whoop: [0.72, 0, 0, 0, 0, 0, 0, 0],
      invented: [9, 9, 9, 9, 9, 9, 9, 9],
    },
  });
  assert.equal(creaturazoidStepEvent(pattern, 0).soundId, "growl");
  assert.equal(creaturazoidEventsAtStep(pattern, 0).length, 1);

  const replacement = setCreaturazoidStep(pattern, 0, "hoot", 0.42);
  assert.deepEqual(
    { id: creaturazoidStepEvent(replacement, 0).soundId, velocity: creaturazoidStepEvent(replacement, 0).velocity },
    { id: "hoot", velocity: 0.42 },
  );
  assert.equal(creaturazoidEventsAtStep(replacement, 0).length, 1);
  assert.equal(creaturazoidStepEvent(pattern, 0).soundId, "growl", "the source pattern must not mutate");

  const rest = setCreaturazoidStep(replacement, 0, null, 1);
  assert.equal(creaturazoidStepEvent(rest, 0), null);
});

test("step dynamics cycle predictably and a different trigger claims the column", () => {
  const cycle = [0];
  for (let index = 0; index < CREATURAZOID_DYNAMICS.length; index += 1) {
    cycle.push(cycleCreaturazoidDynamics(cycle.at(-1)));
  }
  assert.deepEqual(cycle, [0, 0.42, 0.72, 1, 0]);

  let pattern = sanitizeCreaturazoidPattern({ length: 4, rows: {} });
  pattern = cycleCreaturazoidStep(pattern, 1, "roar");
  assert.equal(creaturazoidStepEvent(pattern, 1).velocity, 0.72);
  pattern = cycleCreaturazoidStep(pattern, 1, "growl");
  assert.equal(creaturazoidStepEvent(pattern, 1).soundId, "growl");
  assert.equal(creaturazoidEventsAtStep(pattern, 1).length, 1);
});

test("swing timing is finite, bounded, and preserves the duration of each step pair", () => {
  for (const tempo of [-Infinity, 0, 48, 132, 360, Infinity, NaN]) {
    for (const swing of [-1, 0, 0.23, 0.46, 2, NaN]) {
      const even = creaturazoidStepIntervalSeconds(tempo, swing, 0);
      const odd = creaturazoidStepIntervalSeconds(tempo, swing, 1);
      assert.ok(Number.isFinite(even) && even > 0);
      assert.ok(Number.isFinite(odd) && odd > 0);
      assert.ok(even <= 15 / CREATURAZOID_LIMITS.tempo[0] * 1.46);
      assert.ok(odd <= 15 / CREATURAZOID_LIMITS.tempo[0] * 1.46);
      const safeTempo = Math.min(360, Math.max(48, Number.isFinite(Number(tempo)) ? Number(tempo) : 48));
      assert.ok(Math.abs(even + odd - 30 / safeTempo) < 1e-12);
    }
  }
});

test("Creaturazoid attack warping is fast, monotonic, and preserves every later envelope peak", () => {
  for (const preset of CREATURAZOID_BODY_PRESETS) {
    const state = creaturazoidState(preset.id);
    for (const sound of CREATURAZOID_SOUNDS) {
      const nativeAttack = creaturazoidNativeAttackPhase(sound);
      const targetTimePhase = Math.min(1, state.attackMs / sound.durationMs);
      assert.ok(
        creaturazoidAttackPhase(sound, targetTimePhase, state) + 1e-12 >= nativeAttack,
        `${preset.id}/${sound.id} must reach its native attack by ${state.attackMs} ms`,
      );
      const mapped = Array.from({ length: 201 }, (_, index) => (
        creaturazoidAttackPhase(sound, index / 200, state)
      ));
      assert.equal(mapped[0], 0);
      assert.equal(mapped.at(-1), 1);
      assert.ok(mapped.every((value, index) => index === 0 || value >= mapped[index - 1]));
    }
  }

  const sound = creaturazoidSound("frogtrill");
  const state = creaturazoidState("colossal-barrel");
  const nativePeaks = CALL_GESTURES[sound.callId].curves.pressure
    .filter(([, value]) => value === 1)
    .map(([phase]) => phase);
  const timelinePeaks = nativePeaks.map((nativePhase) => {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (low + high) / 2;
      if (creaturazoidAttackPhase(sound, middle, state) < nativePhase) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  });
  assert.equal(timelinePeaks.length, 12);
  assert.ok(timelinePeaks.every((value, index) => index === 0 || value > timelinePeaks[index - 1]));
  for (const phase of timelinePeaks) {
    const resolved = resolveCreaturazoidEventState(sound, { state, phase, velocity: 1 });
    assert.ok(resolved.bodyMotion.envelope > 0.999, "all twelve pressure peaks must survive the warp");
  }
});

test("unarticulated vocal calls retain their authored attack and release silence", () => {
  const state = creaturazoidState("colossal-barrel");
  for (const soundId of ["roar", "howl", "phrase", "growl"]) {
    const attack = resolveCreaturazoidEventState(soundId, { state, phase: 0, velocity: 1 });
    const release = resolveCreaturazoidEventState(soundId, { state, phase: 1, velocity: 1 });
    assert.equal(attack.articulation.id, "voice");
    assert.ok(attack.pressure <= 1e-12, `${soundId} attack must begin silent`);
    assert.ok(release.pressure <= 1e-12, `${soundId} release must return to silence`);
  }
});

test("sequenced calls crop weak lead-ins while pads retain the complete attack", () => {
  const state = creaturazoidState("colossal-barrel");
  for (const sound of CREATURAZOID_SOUNDS) {
    const onset = creaturazoidSequenceOnsetPhase(sound);
    const mapped = Array.from({ length: 201 }, (_, index) => (
      creaturazoidRhythmicGesturePhase(sound, index / 200)
    ));
    assert.ok(onset >= 0 && onset <= 0.9, `${sound.id} onset is bounded`);
    assert.equal(mapped[0], onset);
    assert.equal(mapped.at(-1), 1);
    assert.ok(mapped.every((value, index) => index === 0 || value >= mapped[index - 1]));
    assert.ok(Math.abs(
      creaturazoidSequenceDurationSeconds(sound)
        - sound.durationMs / 1_000 * (1 - onset)
    ) < 1e-12);

    const pad = resolveCreaturazoidEventState(sound, { state, phase: 0, velocity: 1 });
    const beat = resolveCreaturazoidEventState(sound, {
      state,
      phase: 0,
      velocity: 1,
      sequenced: true,
    });
    const release = resolveCreaturazoidEventState(sound, {
      state,
      phase: 1,
      velocity: 1,
      sequenced: true,
    });
    assert.equal(pad.authoredPhase, 0);
    assert.equal(beat.authoredPhase, onset);
    assert.equal(beat.callPhase, onset);
    assert.equal(beat.articulationPhase, onset);
    assert.equal(release.callPhase, 1);
    assert.ok(release.pressure <= 1e-12, `${sound.id} cropped release returns to silence`);
    if (sound.gestureType === "vocal") {
      assert.ok(pad.pressure <= 1e-12, `${sound.id} pad retains its silent first frame`);
      assert.ok(beat.pressure > 0.05, `${sound.id} sequence begins in audible breath`);
    }
  }

  assert.equal(creaturazoidSequenceOnsetPhase("hoof-stomp"), 0);
  assert.equal(creaturazoidSequenceOnsetPhase("tail-whip"), 0.58);
  assert.equal(creaturazoidSequenceOnsetPhase("lapping"), 0.06);
});

test("cropped contour snapshots preserve every retained authored keyframe in real time", () => {
  const state = creaturazoidState("dense-squat");
  for (const sound of CREATURAZOID_SOUNDS) {
    const onset = creaturazoidSequenceOnsetPhase(sound);
    const nativeDuration = sound.durationMs / 1_000;
    const duration = creaturazoidSequenceDurationSeconds(sound);
    const offsets = creaturazoidContourOffsets(duration, state, sound, { sequenced: true });
    const curves = [
      ...Object.values(CALL_GESTURES[sound.callId].curves),
      ...Object.values(sound.articulation?.curves ?? {}),
    ];
    for (const points of curves) {
      for (const [authoredPhase] of points) {
        if (authoredPhase + 1e-12 < onset) continue;
        const expectedOffset = (authoredPhase - onset) * nativeDuration;
        assert.ok(
          offsets.some((offset) => Math.abs(offset - expectedOffset) < 1e-12),
          `${sound.id} retains authored keyframe ${authoredPhase}`,
        );
        const timelinePhase = duration > 0 ? expectedOffset / duration : 1;
        assert.ok(Math.abs(
          creaturazoidRhythmicGesturePhase(sound, timelinePhase) - authoredPhase
        ) < 1e-12, `${sound.id} maps keyframe ${authoredPhase} exactly`);
      }
    }
  }
});

test("calibrated event makeup lifts soft gestures and reins in pathological peaks", () => {
  for (const sound of CREATURAZOID_SOUNDS) {
    assert.ok(Number.isFinite(sound.levelMakeup));
    assert.ok(creaturazoidLevelMakeup(sound) >= 0.36);
    assert.ok(creaturazoidLevelMakeup(sound) <= 7);
  }
  assert.equal(creaturazoidLevelMakeup("roar"), 1);
  assert.ok(creaturazoidLevelMakeup("rumble") > 2);
  assert.ok(creaturazoidLevelMakeup("purr") > 6.7);
  assert.ok(creaturazoidLevelMakeup("croak") > 3);
  assert.ok(creaturazoidLevelMakeup("hiss") > 6.8);
  assert.equal(creaturazoidLevelMakeup("caw"), 7);
  assert.ok(creaturazoidLevelMakeup("lapping") > 4.6);
  assert.ok(creaturazoidLevelMakeup("hoof-stomp") > 1.3);
  assert.ok(creaturazoidLevelMakeup("chirp") < 0.4);
  assert.ok(creaturazoidLevelMakeup("frogtrill") < 0.4);
  assert.ok(creaturazoidLevelMakeup("moo") < 0.7);
});

test("bounded body corrections lift only measured resonant dropouts", () => {
  for (const body of CREATURAZOID_BODY_PRESETS) {
    for (const sound of CREATURAZOID_SOUNDS) {
      const trim = creaturazoidBodyLevelTrim(sound, body.id);
      assert.ok(trim >= 0.36 && trim <= 3.75, `${body.id}/${sound.id} body trim is bounded`);
    }
  }

  assert.equal(creaturazoidBodyLevelTrim("purr", "pocket-needle"), 3.75);
  assert.equal(creaturazoidBodyLevelTrim("rumble", "pocket-needle"), 2.375);
  assert.equal(creaturazoidBodyLevelTrim("trumpet", "pocket-needle"), 2.275);
  assert.equal(creaturazoidBodyLevelTrim("bellow", "pocket-needle"), 1.25);
  assert.equal(creaturazoidBodyLevelTrim("chirp", "split-chamber"), 1.5);
  assert.equal(creaturazoidBodyLevelTrim("frogtrill", "split-chamber"), 1.45);
  assert.equal(creaturazoidBodyLevelTrim("ticks", "elastic-tower"), 0.55);
  assert.equal(creaturazoidBodyLevelTrim("ticks", "paper-giant"), 0.88);
  assert.equal(creaturazoidBodyLevelTrim("feather-ruffle", "paper-giant"), 2.1);
  assert.equal(creaturazoidBodyLevelTrim("feather-ruffle", "long-hollow"), 1.2);
  assert.equal(creaturazoidBodyLevelTrim("roar", "colossal-barrel"), 1);
});

test("enveloped body modulation is multi-target, event-relative, and deterministic", () => {
  const state = creaturazoidState("split-chamber");
  const early = resolveCreaturazoidEventState("phrase", { state, phase: 0.08, elapsedSeconds: 9_999, velocity: 1 });
  const middle = resolveCreaturazoidEventState("phrase", { state, phase: 0.55, elapsedSeconds: 9_999, velocity: 1 });
  const repeated = resolveCreaturazoidEventState("phrase", { state, phase: 0.55, elapsedSeconds: 0, velocity: 1 });
  assert.equal(middle.bodyMotion.modulators.length, 3);
  assert.equal(new Set(middle.bodyMotion.modulators.map(({ target }) => target)).size, 3);
  assert.notDeepEqual(
    early.bodyMotion.modulators.map(({ rateHz, depth }) => [rateHz, depth]),
    middle.bodyMotion.modulators.map(({ rateHz, depth }) => [rateHz, depth]),
    "speed and depth must follow their call-local envelopes",
  );
  assert.deepEqual(middle.bodyMotion, repeated.bodyMotion);
  assert.equal(middle.tension, repeated.tension);
  assert.equal(middle.effectivePitchSemitones, repeated.effectivePitchSemitones);
  assert.equal(middle.bodyPresetId, "split-chamber");
  assert.equal(middle.bodyScale, state.bodyScale);
  assert.equal(middle.bodyRoundness, state.bodyRoundness);
  assert.equal(middle.attackMs, state.attackMs);
});

test("every event resolves finite bounded unlocked Hybrinx states across gestures and modulation", () => {
  for (const preset of CREATURAZOID_BODY_PRESETS) {
    const state = creaturazoidState(preset.id);
    for (const sound of CREATURAZOID_SOUNDS) {
      for (const phase of [0, 0.17, 0.5, 0.83, 1]) {
        const resolved = resolveCreaturazoidEventState(sound, {
          state,
          phase,
          elapsedSeconds: phase * 1.37,
          velocity: phase === 1 ? 0.42 : 1,
        });
        assert.equal(resolved.soundId, sound.id);
        assert.equal(resolved.animalId, sound.animalId);
        assert.equal(resolved.callId, sound.callId);
        assert.equal(resolved.sourceFamily, sound.family);
        assert.equal(resolved.bodyPresetId, preset.id);
        assert.ok(resolved.bodyMotion.modulators.length >= 2);
        assertFiniteAndBoundedSyrinxState(resolved, `${preset.id}/${sound.id}/${phase}`);
      }
    }
  }

  const first = resolveCreaturazoidEventState("howl", creaturazoidState("elastic-tower"), { phase: 0.45, elapsedSeconds: 0 });
  const repeated = resolveCreaturazoidEventState("howl", creaturazoidState("elastic-tower"), { phase: 0.45, elapsedSeconds: 731.173 });
  assert.equal(first.effectivePitchSemitones, repeated.effectivePitchSemitones);
  assert.equal(first.tension, repeated.tension);
});

test("state sanitizing, morph bias, and quick cross-family interpolation never escape model bounds", () => {
  const global = sanitizeCreaturazoidState({
    anatomyDesignId: "invented-eyebrow-monster",
    tempo: Infinity,
    swing: -9,
    patternLength: 900,
    morph: 4,
    pitchSemitones: -900,
    vibratoRateHz: Infinity,
    modulationDepth: 7,
    morphTimeMs: 0,
    biologicalLock: true,
    morphBias: Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map((name) => [name, 99])),
  });
  assert.equal(global.biologicalLock, false);
  assert.equal(global.anatomyDesignId, CREATURAZOID_DEFAULTS.anatomyDesignId);
  for (const [name, [minimum, maximum]] of Object.entries(CREATURAZOID_LIMITS)) {
    assert.ok(Number.isFinite(global[name]));
    assert.ok(global[name] >= minimum && global[name] <= maximum);
  }

  const raven = resolveCreaturazoidEventState("croak", { phase: 0.4, elapsedSeconds: 0.2 });
  const frog = resolveCreaturazoidEventState("boom", { phase: 0.7, elapsedSeconds: 0.6 });
  const biased = applyCreaturazoidMorphBias(raven, global.morphBias, 1);
  for (const amount of [0, 0.1, 0.5, 0.9, 1]) {
    assertFiniteAndBoundedSyrinxState(
      { ...interpolateCreaturazoidMorph(biased, frog, amount), sourceFrequencyRatio: interpolateCreaturazoidMorph(biased, frog, amount).sourceFrequencyRatio },
      `morph/${amount}`,
    );
  }
  assert.equal(creaturazoidQuickMorphProgress(-10), 0);
  assert.equal(creaturazoidQuickMorphProgress(10_000), 1);
  assert.equal(CREATURAZOID_DEFAULTS.biologicalLock, false);
});

test("contour snapshots resolve short morphs and fast vibrato without coarse gaps", () => {
  const duration = 3.2;
  for (const preset of CREATURAZOID_VOICE_PRESETS) {
    const state = creaturazoidState(preset.id);
    const offsets = creaturazoidContourOffsets(duration, state);
    assert.equal(offsets[0], 0);
    assert.equal(offsets.at(-1), duration);
    assert.ok(offsets.every((value, index) => index === 0 || value > offsets[index - 1]));
    const maximumGap = Math.max(...offsets.slice(1).map((value, index) => value - offsets[index]));
    assert.ok(maximumGap <= 0.020000000001, `${preset.id} has a coarse ${maximumGap}s gap`);

    const fastestRate = Math.max(state.vibratoRateHz, state.modulationRateHz);
    assert.ok(maximumGap <= Math.max(0.006, 1 / (fastestRate * 8)) + 1e-12);
    const morphEnd = state.morphTimeMs / 1_000;
    const attackEnd = state.attackMs / 1_000;
    for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
      assert.ok(
        offsets.some((value) => Math.abs(value - morphEnd * fraction) < 1e-12),
        `${preset.id} needs an explicit ${fraction * 100}% morph point`,
      );
      assert.ok(
        offsets.some((value) => Math.abs(value - attackEnd * fraction) < 1e-12),
        `${preset.id} needs an explicit ${fraction * 100}% attack point`,
      );
    }
  }
});

test("sample-addressed contours include every percussive airway transition", () => {
  const state = creaturazoidState("dense-squat");
  for (const soundId of CREATURAZOID_PERCUSSIVE_SOUND_IDS) {
    const sound = creaturazoidSound(soundId);
    const duration = sound.durationMs / 1_000;
    const offsets = creaturazoidContourOffsets(duration, state, sound);
    for (const points of Object.values(sound.articulation.curves)) {
      for (const [phase] of points) {
        assert.ok(
          offsets.some((offset) => Math.abs(offset - phase * duration) < 1e-12),
          `${soundId} must schedule articulation phase ${phase}`,
        );
      }
    }
  }
});
