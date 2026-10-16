import assert from "node:assert/strict";
import test from "node:test";
import { cameraFromView, viewById } from "../src/instruments/striped-staircase/striped-staircase.js";
import {
  STUDIES_FULL_PRESETS, STUDIES_PRESET_KEYS, STUDIES_VOICE_KEYS, STUDIES_NUMBER_SPECS,
  captureStudiesPreset, randomizeStudiesPreset, validateStudiesPreset,
} from "../src/instruments/striped-staircase-rust/full-presets.js";
import { SPIRAL_DEFAULTS, SPIRAL_RANGES } from "../src/instruments/striped-staircase-rust/spiral-studies.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = s => ({
  view: s.viewId, camera: { ...s.camera }, mode: s.mode, palette: s.palette, speed: s.speed, baseFrequency: s.baseFrequency,
  brightness: s.brightness, body: s.body,
  ...Object.fromEntries(STUDIES_VOICE_KEYS.map(key => [key, s[key]])),
  settings: { startIteration: s.startIteration, maxIterations: s.maxIterations, steps: s.steps, stripePeriod: s.stripePeriod, spacingCurve: 1.7 },
  progress: 0.7, direction: -1, playing: true, hold: true, audio: true, level: 0.9,
  focusedTendril: 7, showPaths: false, showStripes: false,
});

test("Staircase Studies bank is complete, valid and uses real views", () => {
  validateFullPresetBank(STUDIES_FULL_PRESETS);
  const views = new Set();
  for (const { snapshot } of STUDIES_FULL_PRESETS) {
    assert.equal(validateStudiesPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...STUDIES_PRESET_KEYS].sort());
    assert.deepEqual(snapshot.camera, { ...cameraFromView(viewById(snapshot.viewId)) });
    views.add(snapshot.viewId);
  }
  assert.ok(views.size >= 12);
  assert.equal(new Set(STUDIES_FULL_PRESETS.map(p => p.snapshot.mode)).size, 4);
  assert.throws(() => validateStudiesPreset({ ...STUDIES_FULL_PRESETS[0].snapshot, mode: 7 }), TypeError);
  assert.throws(() => validateStudiesPreset({ ...STUDIES_FULL_PRESETS[0].snapshot, startIteration: 99, maxIterations: 100 }), TypeError);
  assert.throws(() => validateStudiesPreset({ ...STUDIES_FULL_PRESETS[0].snapshot, extra: 1 }), TypeError);
});

test("Staircase Studies capture round-trips and excludes session state", () => {
  for (const { snapshot } of STUDIES_FULL_PRESETS) {
    const captured = captureStudiesPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["progress", "direction", "playing", "hold", "audio", "level", "focusedTendril", "showPaths", "showStripes"])
      assert.equal(key in captured, false);
  }
});

test("Staircase Studies dice is pure, reproducible, valid and varies every field", () => {
  const initial = STUDIES_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeStudiesPreset(initial, seed(5)), randomizeStudiesPreset(STUDIES_FULL_PRESETS[5].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(STUDIES_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(STUDIES_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeStudiesPreset(initial, random);
    validateStudiesPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of STUDIES_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
  }
  const enumSizes = { pitchSource: 2, pitchMapping: 3, stripeGate: 2, endlessDirection: 2 };
  for (const [key, values] of seen) assert.ok(values.size >= (enumSizes[key] ?? 4), `${key} stays frozen`);
  assert.equal(seen.get("mode").size, 4);
  assert.equal(seen.get("palette").size, 4);
});


test("existing factory scenes explicitly reset new musical controls to neutral defaults", () => {
  assert.equal(STUDIES_FULL_PRESETS.length, 14);
  assert.deepEqual(STUDIES_FULL_PRESETS.map(preset => preset.id), [
    "seahorse-ink-rhythm", "overview-slow-contour", "cusp-ember-harmonics", "elephant-glass-body",
    "archive-fine-rhythm", "gallery-long-release", "double-spiral-rattle", "spiral-sub-contour",
    "needle-bright-harmonics", "island-resonant-chimes", "period-three-bass-rhythm", "dendrite-sharp-contour",
    "airplane-wide-body", "antenna-dense-harmonics",
  ]);
  for (const { snapshot } of STUDIES_FULL_PRESETS) {
    for (const [key, value] of Object.entries({
      pitchSource: 1, pitchMapping: 1, pitchSpan: 3, voiceLimit: 256, stripeGate: true, ...SPIRAL_DEFAULTS,
    })) assert.equal(snapshot[key], value, key);
  }
  const first = STUDIES_FULL_PRESETS[0].snapshot;
  assert.deepEqual(Object.fromEntries(["mode", "palette", "speed", "baseFrequency", "brightness", "body",
    "startIteration", "maxIterations", "steps", "stripePeriod"].map(key => [key, first[key]])), {
    mode: 2, palette: 3, speed: .035, baseFrequency: 73, brightness: .55, body: .35,
    startIteration: 12, maxIterations: 260, steps: 24, stripePeriod: 7,
  });
});

test("complete pitch and spiral snapshots round-trip without mutating session or display state", () => {
  const state = toState(STUDIES_FULL_PRESETS[0].snapshot);
  Object.assign(state, {
    pitchSource: 0, pitchMapping: 2, pitchSpan: 5.7, voiceLimit: 255, stripeGate: false,
    turnAmount: .7, turnSpan: 2.45, accentAmount: .3, accentRate: 21.75,
    forkAmount: .8, forkSpan: 3.25, curvatureAmount: .6, curvatureDrive: 2.3,
    endlessAmount: .4, endlessDirection: 1,
  });
  const before = structuredClone(state), captured = captureStudiesPreset(state);
  validateStudiesPreset(captured);
  assert.deepEqual(state, before, "capture is read-only");
  const recalled = toState(captured);
  assert.deepEqual(captureStudiesPreset(recalled), captured);
  for (const key of STUDIES_VOICE_KEYS) assert.equal(recalled[key], state[key], key);
  captured.camera.centerX += .001;
  assert.deepEqual(state.camera, before.camera, "captured camera is an owned copy");
  const randomized = randomizeStudiesPreset(captureStudiesPreset(state), seed(59));
  assert.deepEqual(state, before, "dice never edits live state");
  for (const key of ["progress", "direction", "playing", "hold", "audio", "level", "focusedTendril", "showPaths", "showStripes"])
    assert.equal(Object.hasOwn(randomized, key), false, key);
});

test("preset validation rejects incomplete controls, invalid enums, and split paired budgets", () => {
  const initial = STUDIES_FULL_PRESETS[0].snapshot;
  for (const key of STUDIES_VOICE_KEYS) {
    const missing = { ...initial }; delete missing[key];
    assert.throws(() => validateStudiesPreset(missing), TypeError, key);
  }
  const badPatches = [
    { pitchSource: 2 }, { pitchSource: "1" }, { pitchMapping: 1.5 }, { pitchMapping: 3 },
    { pitchSpan: -1 }, { pitchSpan: 6.1 }, { voiceLimit: 0 }, { voiceLimit: 513 },
    { voiceLimit: 2.5 }, { voiceLimit: 255 }, { voiceLimit: 1 }, { stripeGate: 0 },
    { endlessDirection: 0 }, { endlessDirection: "-1" },
  ];
  for (const [key, [minimum, maximum]] of Object.entries(SPIRAL_RANGES)) {
    badPatches.push({ [key]: minimum - .01 }, { [key]: maximum + .01 }, { [key]: NaN });
  }
  for (const patch of badPatches) assert.throws(() => validateStudiesPreset({ ...initial, ...patch }), TypeError, JSON.stringify(patch));
  for (const voiceLimit of [1, 255, 512]) assert.doesNotThrow(() => validateStudiesPreset({ ...initial, pitchSource: 0, voiceLimit }));
  for (const voiceLimit of [2, 256, 512]) assert.doesNotThrow(() => validateStudiesPreset({ ...initial, pitchSource: 1, voiceLimit }));
});

test("dice reaches bounded musical extremes and always keeps paired voices together", () => {
  const initial = STUDIES_FULL_PRESETS[0].snapshot;
  for (const value of [-1, 0, .5, 1, 2]) {
    const snapshot = randomizeStudiesPreset(initial, () => value);
    validateStudiesPreset(snapshot);
    if (snapshot.pitchSource === 1) assert.equal(snapshot.voiceLimit % 2, 0);
    for (const [key, [minimum, maximum]] of Object.entries(STUDIES_NUMBER_SPECS))
      assert.ok(snapshot[key] >= minimum && snapshot[key] <= maximum, key);
    assert.deepEqual(captureStudiesPreset(toState(snapshot)), snapshot);
  }
  assert.equal(randomizeStudiesPreset(initial, () => 0).voiceLimit, 1);
  assert.equal(randomizeStudiesPreset(initial, () => 1).voiceLimit, 512);
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => randomizeStudiesPreset(initial, () => value), TypeError);
  const random = seed(301);
  for (let index = 0; index < 500; index++) {
    const snapshot = randomizeStudiesPreset(initial, random);
    if (snapshot.pitchSource === 1) assert.equal(snapshot.voiceLimit % 2, 0);
    assert.deepEqual(captureStudiesPreset(toState(snapshot)), snapshot);
  }
});
