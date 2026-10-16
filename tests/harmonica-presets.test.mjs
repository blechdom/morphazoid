import assert from "node:assert/strict";
import test from "node:test";
import { HARMONICA_DEFAULTS, HARMONICA_LIMITS, harmonicaState } from "../src/instruments/harmonica/harmonica.js";
import {
  HARMONICA_FULL_PRESETS, HARMONICA_NUMERIC_PRESET_KEYS, HARMONICA_PRESET_KEYS,
  captureHarmonicaPreset, harmonicaStateFromPreset, randomizeHarmonicaPreset, validateHarmonicaPreset,
} from "../src/instruments/harmonica/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Harmonicazoid bank is complete, valid and distinct", () => {
  validateFullPresetBank(HARMONICA_FULL_PRESETS);
  assert.ok(HARMONICA_FULL_PRESETS.length >= 12);
  for (const preset of HARMONICA_FULL_PRESETS) {
    assert.equal(validateHarmonicaPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...HARMONICA_PRESET_KEYS].sort());
  }
  assert.ok(new Set(HARMONICA_FULL_PRESETS.map(preset => preset.snapshot.keyId)).size > 6);
  assert.ok(new Set(HARMONICA_FULL_PRESETS.map(preset => preset.snapshot.presetId)).size === 4);
  assert.throws(() => validateHarmonicaPreset({}), TypeError);
  assert.throws(() => validateHarmonicaPreset({ ...HARMONICA_FULL_PRESETS[0].snapshot, bend: 9 }), TypeError);
  assert.throws(() => validateHarmonicaPreset({ ...HARMONICA_FULL_PRESETS[0].snapshot, keyId: "zz" }), TypeError);
});

test("Harmonicazoid apply keeps level, auto-breath and live flow", () => {
  const session = { ...harmonicaState("c-richter"), level: .61, autoBreath: false, breathFlow: .4 };
  const next = harmonicaStateFromPreset(HARMONICA_FULL_PRESETS[7].snapshot, session);
  assert.equal(next.level, .61);
  assert.equal(next.autoBreath, false);
  assert.equal(next.breathFlow, 0.4);
  assert.deepEqual(captureHarmonicaPreset(next), HARMONICA_FULL_PRESETS[7].snapshot);
});

test("Harmonicazoid dice is pure, reproducible, bounded and varies every field", () => {
  const initial = HARMONICA_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHarmonicaPreset(initial, seed(5)), randomizeHarmonicaPreset(HARMONICA_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(HARMONICA_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(HARMONICA_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 120; i++) {
    const result = randomizeHarmonicaPreset(initial, random);
    validateHarmonicaPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of HARMONICA_NUMERIC_PRESET_KEYS) {
      assert.ok(result[key] >= HARMONICA_LIMITS[key][0] && result[key] <= HARMONICA_LIMITS[key][1], key);
    }
    for (const key of HARMONICA_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("hole").size >= 8);
  assert.ok(seen.get("keyId").size >= 8);
  assert.ok(HARMONICA_DEFAULTS);
});
