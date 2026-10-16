import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRWAY_FULL_PRESETS, AIRWAY_PRESET_KEYS, captureAirwayPreset, randomizeAirwayPreset, validateAirwayPreset,
} from "../src/instruments/adaptive-airway/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Adaptive Airway bank is complete, valid and distinct", () => {
  validateFullPresetBank(AIRWAY_FULL_PRESETS);
  for (const preset of AIRWAY_FULL_PRESETS) {
    assert.equal(validateAirwayPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureAirwayPreset(preset.snapshot), preset.snapshot);
  }
  assert.ok(new Set(AIRWAY_FULL_PRESETS.map(p => p.snapshot.family)).size === 3);
  assert.throws(() => validateAirwayPreset({}), TypeError);
  assert.throws(() => validateAirwayPreset({ ...AIRWAY_FULL_PRESETS[0].snapshot, presetId: "wolf" }), TypeError);
  assert.throws(() => validateAirwayPreset({ ...AIRWAY_FULL_PRESETS[0].snapshot, pressure: 2 }), TypeError);
});

test("Adaptive Airway dice is pure, reproducible and varies every field", () => {
  const initial = AIRWAY_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeAirwayPreset(initial, seed(5)), randomizeAirwayPreset(AIRWAY_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const known = new Set(AIRWAY_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(AIRWAY_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeAirwayPreset(initial, random);
    validateAirwayPreset(result);
    assert.equal(known.has(presetStateKey(result)), false);
    for (const key of AIRWAY_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "family" ? 3 : 2) && (key === "family" || key === "presetId" || values.size > 30), `${key} stays frozen`);
});
