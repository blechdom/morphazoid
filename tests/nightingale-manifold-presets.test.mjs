import assert from "node:assert/strict";
import test from "node:test";
import { NIGHTINGALE_FULL_PRESETS, NIGHTINGALE_PRESET_KEYS, randomizeNightingalePreset, validateNightingalePreset } from "../src/instruments/nightingale-manifold/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = snapshot => Object.entries(snapshot);

test("Nightingale Manifold bank is complete, valid and distinct", () => {
  validateFullPresetBank(NIGHTINGALE_FULL_PRESETS);
  for (const preset of NIGHTINGALE_FULL_PRESETS) assert.equal(validateNightingalePreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateNightingalePreset({}), TypeError);
  assert.throws(() => validateNightingalePreset(null), TypeError);
});

test("Nightingale Manifold dice is pure, reproducible and varies every musical field", () => {
  const initial = NIGHTINGALE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeNightingalePreset(initial, seed(5)), randomizeNightingalePreset(NIGHTINGALE_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const known = new Set(NIGHTINGALE_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeNightingalePreset(initial, random);
    validateNightingalePreset(result);
    assert.equal(known.has(presetStateKey(result)), false);
    for (const [key, value] of flatten(result)) {
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(JSON.stringify(value));
    }
  }
  for (const key of NIGHTINGALE_PRESET_KEYS) assert.ok([...seen.keys()].some(path => path === key || path.startsWith(key + ".") || path.startsWith(key + "[")), `${key} missing`);
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
