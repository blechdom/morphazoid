import assert from "node:assert/strict";
import test from "node:test";
import {
  SORT_FULL_PRESETS, SORT_PRESET_KEYS, captureSortPreset, randomizeSortPreset, validateSortPreset,
} from "../src/families/algorithmic-sequencers/full-presets.js";
import { SORT_ALGORITHM_PRESETS, generateSortSequence } from "../src/families/algorithmic-sequencers/algorithmic-sequencers.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Sorting bank is complete, valid, distinct and excludes session state", () => {
  validateFullPresetBank(SORT_FULL_PRESETS);
  assert.ok(SORT_FULL_PRESETS.length >= 12);
  const algorithms = new Set(SORT_FULL_PRESETS.map(preset => preset.snapshot.algorithmId));
  assert.equal(algorithms.size, SORT_ALGORITHM_PRESETS.length);
  assert.ok(new Set(SORT_FULL_PRESETS.map(preset => preset.snapshot.voice)).size >= 8);
  for (const preset of SORT_FULL_PRESETS) {
    assert.deepEqual(validateSortPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...SORT_PRESET_KEYS].sort());
    assert.ok(generateSortSequence(preset.snapshot).steps.length > 1);
  }
  assert.equal("output" in SORT_FULL_PRESETS[0].snapshot, false);
  assert.deepEqual(captureSortPreset({ ...SORT_FULL_PRESETS[1].snapshot, output: 0.1 }), SORT_FULL_PRESETS[1].snapshot);
  assert.throws(() => validateSortPreset({}), TypeError);
  assert.throws(() => validateSortPreset({ ...SORT_FULL_PRESETS[0].snapshot, size: 999 }), TypeError);
  assert.throws(() => validateSortPreset({ ...SORT_FULL_PRESETS[0].snapshot, output: 0.4 }), TypeError);
  assert.throws(() => validateSortPreset({ ...SORT_FULL_PRESETS[0].snapshot, voice: "nope" }), TypeError);
});

test("Sorting dice is pure, reproducible, bounded and varies every field", () => {
  const initial = SORT_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSortPreset(initial, seed(5)), randomizeSortPreset(SORT_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const existing = new Set(SORT_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(SORT_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(23);
  for (let i = 0; i < 150; i++) {
    const result = randomizeSortPreset(initial, random);
    validateSortPreset(result);
    assert.equal(existing.has(presetStateKey(result)), false);
    assert.ok(result.tempo >= Math.min(60, Math.max(3, result.size / 8)) - 1e-9);
    assert.ok(result.noteSeconds <= Math.max(0.03, 2.2 / result.tempo) + 1e-9);
    for (const [key, value] of Object.entries(result)) seen.get(key).add(value);
  }
  for (const [key, values] of seen) assert.ok(values.size >= ({ algorithmId: 5, voice: 8 }[key] ?? 20), `${key} stays frozen`);
});
