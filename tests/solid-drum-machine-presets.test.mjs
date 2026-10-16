import assert from "node:assert/strict";
import test from "node:test";
import {
  SOLID_DRUM_FULL_PRESETS, SOLID_DRUM_PRESET_KEYS, captureSolidDrumPreset, randomizeSolidDrumPreset,
  sanitizeSolidDrumPreset, validateSolidDrumPreset,
} from "../src/instruments/solid-drum-machine/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const initial = SOLID_DRUM_FULL_PRESETS[0].snapshot;

test("Solid Drum Machine bank is complete, valid and distinct", () => {
  validateFullPresetBank(SOLID_DRUM_FULL_PRESETS);
  assert.ok(SOLID_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of SOLID_DRUM_FULL_PRESETS) {
    assert.equal(validateSolidDrumPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...SOLID_DRUM_PRESET_KEYS].sort());
    assert.deepEqual(captureSolidDrumPreset(preset.snapshot), preset.snapshot);
  }
  assert.throws(() => validateSolidDrumPreset({}), TypeError);
  assert.throws(() => validateSolidDrumPreset({ ...initial, speed: 99 }), TypeError);
  assert.throws(() => validateSolidDrumPreset({ ...initial, mappingMode: "nope" }), TypeError);
});

test("Solid capture excludes session state and live phases, and normalizes live edits", () => {
  const live = { ...initial, audioOn: true, output: 0.2, position: 0.77, continuousPosition: 12.5, rotationX: 90, rotationY: 20, planeYaw: 30, continuousRotation: 3 };
  assert.deepEqual(captureSolidDrumPreset(live), initial);
  for (const key of ["audioOn", "output", "position", "rotationX", "planeYaw"]) assert.equal(key in captureSolidDrumPreset(live), false);
  const dragged = captureSolidDrumPreset({ ...initial, speed: 0.123456789, formScaleX: 1.23456789 });
  assert.equal(validateSolidDrumPreset(dragged), dragged);
  assert.deepEqual(sanitizeSolidDrumPreset(dragged), dragged);
});

test("Solid dice is pure, reproducible and varies every musical field", () => {
  const before = structuredClone(initial);
  assert.deepEqual(randomizeSolidDrumPreset(initial, seed(5)), randomizeSolidDrumPreset(SOLID_DRUM_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  assert.throws(() => randomizeSolidDrumPreset({ nope: 1 }, seed(1)), TypeError);
  const factory = new Set(SOLID_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(SOLID_DRUM_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeSolidDrumPreset(initial, random);
    validateSolidDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.playing || Object.keys(result).some(key => key.endsWith("Playing") && result[key]), "scene must move");
    for (const key of SOLID_DRUM_PRESET_KEYS) seen.get(key).add(presetStateKey(result[key]));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
  const extreme = [() => 0, () => 0.999999999, () => 0.5];
  for (const rng of extreme) validateSolidDrumPreset(randomizeSolidDrumPreset(initial, rng));
  assert.throws(() => randomizeSolidDrumPreset(initial, () => NaN), TypeError);
});
