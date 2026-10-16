import assert from "node:assert/strict";
import test from "node:test";
import { cameraFromView, viewById } from "../src/instruments/striped-staircase/striped-staircase.js";
import {
  STUDIES_FULL_PRESETS, STUDIES_PRESET_KEYS, captureStudiesPreset, randomizeStudiesPreset, validateStudiesPreset,
} from "../src/instruments/striped-staircase-rust/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = s => ({
  view: s.viewId, camera: { ...s.camera }, mode: s.mode, palette: s.palette, speed: s.speed, baseFrequency: s.baseFrequency,
  brightness: s.brightness, body: s.body,
  settings: { startIteration: s.startIteration, maxIterations: s.maxIterations, steps: s.steps, stripePeriod: s.stripePeriod, spacingCurve: 1.7 },
  progress: 0.7, direction: -1, playing: true, hold: true, audio: true, level: 0.9,
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
    for (const key of ["progress", "direction", "playing", "hold", "audio", "level"]) assert.equal(key in captured, false);
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
  for (const [key, values] of seen) assert.ok(values.size >= 4, `${key} stays frozen`);
  assert.equal(seen.get("mode").size, 4);
  assert.equal(seen.get("palette").size, 4);
});
