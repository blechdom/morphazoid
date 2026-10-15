import assert from "node:assert/strict";
import test from "node:test";
import {
  SHAPE_DRUM_FULL_PRESETS, SHAPE_DRUM_PRESET_KEYS, captureShapeDrumPreset, randomizeShapeDrumPreset,
  sanitizeShapeDrumPreset, validateShapeDrumPreset,
} from "../src/instruments/shape-drum-machine/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const initial = SHAPE_DRUM_FULL_PRESETS[0].snapshot;

test("Shape Drum Machine bank is complete, valid and distinct", () => {
  validateFullPresetBank(SHAPE_DRUM_FULL_PRESETS);
  assert.ok(SHAPE_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of SHAPE_DRUM_FULL_PRESETS) {
    assert.equal(validateShapeDrumPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...SHAPE_DRUM_PRESET_KEYS].sort());
    assert.deepEqual(captureShapeDrumPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.headOffsets.length, preset.snapshot.heads);
  }
  assert.throws(() => validateShapeDrumPreset({}), TypeError);
  assert.throws(() => validateShapeDrumPreset({ ...initial, speed: 99 }), TypeError);
  assert.throws(() => validateShapeDrumPreset({ ...initial, mappingMode: "nope" }), TypeError);
});

test("Shape capture excludes session state and live phases, and normalizes live edits", () => {
  const live = { ...initial, audioOn: true, output: 0.2, position: 0.77, continuousPosition: 12.5, rotation: 90, continuousRotation: 3 };
  assert.deepEqual(captureShapeDrumPreset(live), initial);
  for (const key of ["audioOn", "output", "position", "rotation"]) assert.equal(key in captureShapeDrumPreset(live), false);
  const dragged = captureShapeDrumPreset({ ...initial, speed: 0.123456789, headOffsets: [0.33333333] });
  assert.equal(validateShapeDrumPreset(dragged), dragged);
  assert.deepEqual(sanitizeShapeDrumPreset(dragged), dragged);
});

test("Shape dice is pure, reproducible and varies every musical field", () => {
  const before = structuredClone(initial);
  assert.deepEqual(randomizeShapeDrumPreset(initial, seed(5)), randomizeShapeDrumPreset(SHAPE_DRUM_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  assert.throws(() => randomizeShapeDrumPreset({ nope: 1 }, seed(1)), TypeError);
  const factory = new Set(SHAPE_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(SHAPE_DRUM_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeShapeDrumPreset(initial, random);
    validateShapeDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.playing || result.autoRotate, "scene must move");
    for (const key of SHAPE_DRUM_PRESET_KEYS) seen.get(key).add(presetStateKey(result[key]));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
  const extreme = [() => 0, () => 0.999999999, () => 0.5];
  for (const rng of extreme) validateShapeDrumPreset(randomizeShapeDrumPreset(initial, rng));
  assert.throws(() => randomizeShapeDrumPreset(initial, () => NaN), TypeError);
});
