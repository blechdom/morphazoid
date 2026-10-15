import assert from "node:assert/strict";
import test from "node:test";
import { digestazoidState } from "../src/instruments/digestazoid/digestazoid.js";
import {
  DIGESTAZOID_FULL_PRESETS, DIGESTAZOID_PRESET_KEYS, DIGESTAZOID_PRESET_RANGES, applyDigestazoidPresetState,
  captureDigestazoidPreset, randomizeDigestazoidPreset, validateDigestazoidPreset,
} from "../src/instruments/digestazoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Digestazoid bank is complete, valid and distinct", () => {
  validateFullPresetBank(DIGESTAZOID_FULL_PRESETS);
  for (const preset of DIGESTAZOID_FULL_PRESETS) {
    assert.equal(validateDigestazoidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...DIGESTAZOID_PRESET_KEYS].sort());
  }
  assert.ok(new Set(DIGESTAZOID_FULL_PRESETS.map(p => p.snapshot.listeningMode)).size === 3);
  assert.throws(() => validateDigestazoidPreset({ ...DIGESTAZOID_FULL_PRESETS[0].snapshot, gas: 9 }), TypeError);
  assert.throws(() => validateDigestazoidPreset({ gas: 0.5 }), TypeError);
});

test("applying a scene keeps output level, continuous motion and noise seed", () => {
  const live = digestazoidState("after-lunch", { level: 0.77, performing: true, noiseSeed: 1234 });
  const next = applyDigestazoidPresetState(DIGESTAZOID_FULL_PRESETS[7].snapshot, live);
  assert.equal(next.level, 0.77);
  assert.equal(next.performing, true);
  assert.equal(next.noiseSeed, 1234);
  assert.deepEqual(captureDigestazoidPreset(next), DIGESTAZOID_FULL_PRESETS[7].snapshot);
});

test("Digestazoid dice is pure, reproducible, bounded and unfrozen", () => {
  const initial = DIGESTAZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeDigestazoidPreset(initial, seed(5)), randomizeDigestazoidPreset(DIGESTAZOID_FULL_PRESETS[8].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(DIGESTAZOID_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(DIGESTAZOID_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 100; i++) {
    const result = randomizeDigestazoidPreset(initial, random);
    validateDigestazoidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, [min, max]] of Object.entries(DIGESTAZOID_PRESET_RANGES)) assert.ok(result[key] >= min && result[key] <= max, key);
    for (const key of DIGESTAZOID_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 3, `${key} stays frozen`);
  validateDigestazoidPreset(randomizeDigestazoidPreset(initial, () => 0));
  validateDigestazoidPreset(randomizeDigestazoidPreset(initial, () => 1));
});
