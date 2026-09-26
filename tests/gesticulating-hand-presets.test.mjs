import test from "node:test";
import assert from "node:assert/strict";
import { createHandPresets } from "../src/instruments/gesticulating-hand/hand-presets.js";
import {
  HAND_PRESETS, HAND_POSES, VOICE_SOURCES, FOOT_LIMITS,
  normalizeHandConfig, handPoseForForm, handMotionPeriod, evaluateHandPose,
} from "../src/instruments/gesticulating-hand/hand-model.js";

// Existing scene identities remain stable even though their menu positions move.
const LEGACY_IDS = [
  "glass-wave", "reed-beckon", "wire-roll", "pinch-sparks", "counting-air", "flourish-copper",
  "low-claw", "hushed-palm", "point-transmission", "slow-unfurl", "closed-bell", "little-machinery",
  "original-grasp", "breathing-hand", "bowed-spiral", "vowel-opposition", "metal-drumming", "bowed-eight",
  "vowel-fan", "metal-walk", "tangled-polyrhythm", "swarming-fingers", "orbit-frenzy", "scattered-sparks",
  "foot-velvet-curl", "foot-glass-ripple", "foot-tin-drumming", "foot-ankle-orbit",
];
const legacyIds = new Set(LEGACY_IDS);
const added = HAND_PRESETS.filter(preset => !legacyIds.has(preset.id));
const effectiveTempo = preset => preset.snapshot.motion.tempo * preset.snapshot.motion.speed;
const smooth = preset => preset.snapshot.tremor.amount < 1;
const shaky = preset => preset.snapshot.tremor.amount >= 4;
const fast = preset => effectiveTempo(preset) > 300;
const slow = preset => effectiveTempo(preset) < 75;
const distinct = (items, select) => new Set(items.map(select)).size;
function assertDeepFrozen(value, path = "preset") {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), path);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`);
}

test("scene factory retains all legacy identities and adds twelve scenes for each form", () => {
  assert.equal(HAND_PRESETS.length, 52);
  assert.equal(distinct(HAND_PRESETS, preset => preset.id), 52);
  assert.equal(distinct(HAND_PRESETS, preset => preset.label), 52);
  for (const id of LEGACY_IDS) assert.ok(HAND_PRESETS.some(preset => preset.id === id), id);
  assert.equal(HAND_PRESETS.filter(preset => preset.snapshot.form === "hand").length, 36);
  assert.equal(HAND_PRESETS.filter(preset => preset.snapshot.form === "foot").length, 16);
  assert.equal(added.length, 24);
  for (const form of ["hand", "foot"]) assert.equal(added.filter(preset => preset.snapshot.form === form).length, 12, form);

  const rebuilt = createHandPresets({ normalizeHandConfig, HAND_POSES, handPoseForForm });
  assert.deepEqual(rebuilt, HAND_PRESETS);
  assert.notEqual(rebuilt[0].snapshot.pose.fingers, HAND_PRESETS[0].snapshot.pose.fingers);
  assertDeepFrozen(HAND_PRESETS);
  for (const { id, snapshot } of HAND_PRESETS) {
    assert.deepEqual(snapshot, normalizeHandConfig(snapshot), id);
    assert.deepEqual(Object.keys(snapshot).sort(), ["appearance", "form", "motion", "pose", "sound", "tremor", "version", "view", "voices"]);
    assert.equal(snapshot.voices.length, 5, id);
    assert.ok(snapshot.voices.every(voice => VOICE_SOURCES.includes(voice.source) && voice.level > 0 && !voice.mute && !voice.solo), id);
    for (const value of Object.values(snapshot.appearance)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, id);
  }
});

test("Finger loom leads a mixed menu with no six-choice gap in form, pace or steadiness", () => {
  assert.equal(HAND_PRESETS[0].id, "wire-roll");
  for (let start = 0; start < HAND_PRESETS.length; start++) {
    // Include the Next preset button's wrap from the final scene to the first.
    const window = Array.from({ length: 6 }, (_, offset) => HAND_PRESETS[(start + offset) % HAND_PRESETS.length]);
    const ids = window.map(preset => preset.id).join(", ");
    assert.ok(window.some(preset => preset.snapshot.form === "foot"), `Foot: ${ids}`);
    assert.ok(window.some(preset => preset.snapshot.form === "hand"), `Hand: ${ids}`);
    assert.ok(window.some(fast), `Fast: ${ids}`);
    assert.ok(window.some(slow), `Slow: ${ids}`);
    assert.ok(window.some(smooth), `Smooth: ${ids}`);
    assert.ok(window.some(shaky), `Shaky: ${ids}`);
  }
});

test("both forms have new slow and fast scenes independent of tremor intensity", () => {
  for (const form of ["hand", "foot"]) {
    const scenes = added.filter(preset => preset.snapshot.form === form);
    for (const pace of [fast, slow]) for (const steadiness of [smooth, shaky]) {
      assert.ok(scenes.some(preset => pace(preset) && steadiness(preset)), `${form}: ${pace.name}/${steadiness.name}`);
    }
  }
});

test("new scenes span engines, choreography, envelopes, view, color and light", () => {
  assert.deepEqual([...new Set(added.flatMap(preset => preset.snapshot.voices.map(voice => voice.source)))].sort(), [...VOICE_SOURCES].sort());
  assert.deepEqual([...new Set(added.map(preset => preset.snapshot.voices[2].source))].sort(), [...VOICE_SOURCES].sort());
  assert.ok(distinct(added, preset => preset.snapshot.motion.id) >= 18);
  assert.ok(distinct(added, preset => JSON.stringify(preset.snapshot.voices)) >= 20);
  assert.ok(distinct(added, preset => JSON.stringify(preset.snapshot.tremor)) >= 20);
  assert.ok(distinct(added, preset => JSON.stringify(preset.snapshot.view)) >= 20);
  for (const key of ["attack", "release", "rootHz", "brightness", "roughness", "space", "rotationFx"]) {
    assert.ok(distinct(added, preset => preset.snapshot.sound[key]) >= 12, key);
  }
  for (const key of ["skin", "lighting"]) {
    const positions = added.map(preset => preset.snapshot.appearance[key]);
    assert.ok(new Set(positions).size >= 20, key);
    assert.ok(Math.min(...positions) < .1 && Math.max(...positions) > .9, key);
  }
  // Appearance-only variants do not count as new musical scenes.
  assert.equal(distinct(HAND_PRESETS, ({ snapshot: { pose, motion, sound, voices } }) => JSON.stringify({ pose, motion, sound, voices })), 52);
});

test("legacy scenes retain neutral elastic deformation while new feet author bounded moving shapes", () => {
  for (const preset of HAND_PRESETS.filter(preset => legacyIds.has(preset.id))) {
    assert.equal(preset.snapshot.motion.elasticity, 0, preset.id);
    assert.equal(preset.snapshot.tremor.rateSpread, 0, preset.id);
    assert.equal(preset.snapshot.tremor.phaseSpread, 0, preset.id);
    if (preset.snapshot.form === "foot") assert.deepEqual(preset.snapshot.pose.foot, { arch: 0, twist: 0, stretch: 0 }, preset.id);
    else assert.equal(preset.snapshot.pose.foot, undefined, preset.id);
  }
  const feet = added.filter(preset => preset.snapshot.form === "foot");
  assert.ok(distinct(feet, preset => preset.snapshot.motion.elasticity) >= 10);
  for (const { id, snapshot } of feet) {
    assert.ok(snapshot.motion.elasticity >= .25 && snapshot.motion.elasticity <= 1, id);
    assert.notEqual(snapshot.motion.id, "still", id);
    assert.ok(snapshot.motion.amount > .5, id);
    const period = handMotionPeriod(snapshot.motion);
    const shapes = Array.from({ length: 33 }, (_, index) => evaluateHandPose(snapshot, period * index / 32).foot);
    for (const [key, [min, max]] of Object.entries(FOOT_LIMITS.shape)) {
      assert.notEqual(snapshot.pose.foot[key], 0, `${id}: static ${key}`);
      const values = shapes.map(shape => shape[key]);
      assert.ok(values.every(value => Number.isFinite(value) && value >= min && value <= max), `${id}: ${key} limits`);
      assert.ok(Math.max(...values) - Math.min(...values) > (max - min) * .03, `${id}: moving ${key}`);
    }
  }
});

test("the new held scene sustains a pose with wrist tremor while the original still scene stays still", () => {
  const held = HAND_PRESETS.find(preset => preset.id === "hand-held-current").snapshot;
  assert.equal(held.motion.id, "still");
  assert.equal(held.motion.amount, 0);
  assert.equal(held.tremor.joint, "wrist");
  const before = evaluateHandPose(held, .1), after = evaluateHandPose(held, .23);
  assert.deepEqual(before.fingers, after.fingers);
  assert.notDeepEqual(before.wrist, after.wrist);
  const bell = HAND_PRESETS.find(preset => preset.id === "closed-bell").snapshot;
  assert.deepEqual(evaluateHandPose(bell, .1), evaluateHandPose(bell, .23));
});


test("new tremor scenes include independently timed toes, sideways splay and gentle subhertz motion", () => {
  const feet = added.filter(preset => preset.snapshot.form === "foot");
  assert.ok(feet.filter(preset => preset.snapshot.tremor.rateSpread > 0 && preset.snapshot.tremor.phaseSpread > 0).length >= 6);
  assert.ok(feet.filter(preset => preset.snapshot.tremor.joint === "spread").length >= 2);
  assert.ok(feet.filter(preset => preset.snapshot.tremor.amount >= 12).length >= 4);
  assert.ok(feet.filter(preset => preset.snapshot.tremor.rate >= 40).length >= 3);
  assert.ok(added.filter(({ snapshot: { tremor } }) => tremor.amount > 0 && tremor.amount < 1 && tremor.rate < 1).length >= 4);
  for (const { id, snapshot } of HAND_PRESETS) {
    assert.ok(snapshot.tremor.rateSpread >= 0 && snapshot.tremor.rateSpread <= 1, id);
    assert.ok(snapshot.tremor.phaseSpread >= 0 && snapshot.tremor.phaseSpread <= 1, id);
  }
});
