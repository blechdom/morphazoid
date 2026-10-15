import assert from "node:assert/strict";
import test from "node:test";
import {
  HYPER_DRUM_FULL_PRESETS, HYPER_DRUM_PRESET_KEYS, captureHyperDrumPreset, randomizeHyperDrumPreset,
  sanitizeHyperDrumPreset, validateHyperDrumPreset,
} from "../src/instruments/hyper-drum-machine/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const initial = HYPER_DRUM_FULL_PRESETS[0].snapshot;

test("Hyper Drum Machine bank is complete, valid and distinct", () => {
  validateFullPresetBank(HYPER_DRUM_FULL_PRESETS);
  assert.ok(HYPER_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of HYPER_DRUM_FULL_PRESETS) {
    assert.equal(validateHyperDrumPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...HYPER_DRUM_PRESET_KEYS].sort());
    assert.deepEqual(captureHyperDrumPreset(preset.snapshot), preset.snapshot);
  }
  assert.throws(() => validateHyperDrumPreset({}), TypeError);
  assert.throws(() => validateHyperDrumPreset({ ...initial, speed: 99 }), TypeError);
  assert.throws(() => validateHyperDrumPreset({ ...initial, mappingMode: "nope" }), TypeError);
});

test("Hyper capture excludes session state and live phases, and normalizes live edits", () => {
  const live = { ...initial, audioOn: true, output: 0.2, position: 0.77, continuousPosition: 12.5, rotationXW: 90, rotationYW: 20, continuousRotation: 3 };
  assert.deepEqual(captureHyperDrumPreset(live), initial);
  for (const key of ["audioOn", "output", "position", "rotationXW", "rotationYW"]) assert.equal(key in captureHyperDrumPreset(live), false);
  const dragged = captureHyperDrumPreset({ ...initial, speed: 0.123456789, hyperScaleX: 1.23456789 });
  assert.equal(validateHyperDrumPreset(dragged), dragged);
  assert.deepEqual(sanitizeHyperDrumPreset(dragged), dragged);
});

test("Hyper dice is pure, reproducible and varies every musical field", () => {
  const before = structuredClone(initial);
  assert.deepEqual(randomizeHyperDrumPreset(initial, seed(5)), randomizeHyperDrumPreset(HYPER_DRUM_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  assert.throws(() => randomizeHyperDrumPreset({ nope: 1 }, seed(1)), TypeError);
  const factory = new Set(HYPER_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(HYPER_DRUM_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeHyperDrumPreset(initial, random);
    validateHyperDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.playing || Object.keys(result).some(key => key.endsWith("Playing") && result[key]), "scene must move");
    for (const key of HYPER_DRUM_PRESET_KEYS) seen.get(key).add(presetStateKey(result[key]));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
  const extreme = [() => 0, () => 0.999999999, () => 0.5];
  for (const rng of extreme) validateHyperDrumPreset(randomizeHyperDrumPreset(initial, rng));
  assert.throws(() => randomizeHyperDrumPreset(initial, () => NaN), TypeError);
});
