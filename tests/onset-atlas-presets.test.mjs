import assert from "node:assert/strict";
import test from "node:test";
import { ONSET_ATLAS_FULL_PRESETS, ONSET_ATLAS_PRESET_KEYS, randomizeOnsetAtlasPreset, validateOnsetAtlasPreset } from "../src/instruments/onset-atlas/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = snapshot => Object.entries(snapshot);

test("Onset Atlas bank is complete, valid and distinct", () => {
  validateFullPresetBank(ONSET_ATLAS_FULL_PRESETS);
  for (const preset of ONSET_ATLAS_FULL_PRESETS) assert.equal(validateOnsetAtlasPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateOnsetAtlasPreset({}), TypeError);
  assert.throws(() => validateOnsetAtlasPreset(null), TypeError);
});

test("Onset Atlas dice is pure, reproducible and varies every musical field", () => {
  const initial = ONSET_ATLAS_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeOnsetAtlasPreset(initial, seed(5)), randomizeOnsetAtlasPreset(ONSET_ATLAS_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const known = new Set(ONSET_ATLAS_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeOnsetAtlasPreset(initial, random);
    validateOnsetAtlasPreset(result);
    assert.equal(known.has(presetStateKey(result)), false);
    for (const [key, value] of flatten(result)) {
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(JSON.stringify(value));
    }
  }
  for (const key of ONSET_ATLAS_PRESET_KEYS) assert.ok([...seen.keys()].some(path => path === key || path.startsWith(key + ".") || path.startsWith(key + "[")), `${key} missing`);
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
