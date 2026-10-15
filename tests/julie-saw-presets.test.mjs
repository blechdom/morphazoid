import assert from "node:assert/strict";
import test from "node:test";
import { JULIE_SAW_DEFAULTS, JULIE_SAW_LIMITS } from "../src/instruments/julie-saw/julie-saw.js";
import {
  JULIE_SAW_FULL_PRESETS, JULIE_SAW_NUMERIC_PRESET_KEYS, JULIE_SAW_PRESET_KEYS,
  captureJulieSawPreset, julieSawStateFromPreset, randomizeJulieSawPreset, validateJulieSawPreset,
} from "../src/instruments/julie-saw/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Julie Saw bank is complete, valid and distinct", () => {
  validateFullPresetBank(JULIE_SAW_FULL_PRESETS);
  for (const preset of JULIE_SAW_FULL_PRESETS) {
    assert.equal(validateJulieSawPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...JULIE_SAW_PRESET_KEYS].sort());
    assert.deepEqual(captureJulieSawPreset({ ...JULIE_SAW_DEFAULTS, ...preset.snapshot }), preset.snapshot);
  }
  assert.throws(() => validateJulieSawPreset({}), TypeError);
  assert.throws(() => validateJulieSawPreset({ ...JULIE_SAW_FULL_PRESETS[0].snapshot, bend: 5 }), TypeError);
  assert.throws(() => validateJulieSawPreset({ ...JULIE_SAW_FULL_PRESETS[0].snapshot, bladeId: "nope" }), TypeError);
});

test("Julie Saw apply keeps Audio-adjacent session state", () => {
  const session = { ...JULIE_SAW_DEFAULTS, autoPlay: true, level: .61 };
  const next = julieSawStateFromPreset(JULIE_SAW_FULL_PRESETS[5].snapshot, session);
  assert.equal(next.autoPlay, true);
  assert.equal(next.level, .61);
  assert.equal(next.presetId, "custom");
  assert.deepEqual(captureJulieSawPreset(next), JULIE_SAW_FULL_PRESETS[5].snapshot);
});

test("Julie Saw dice is pure, reproducible, bounded and varies every field", () => {
  const initial = JULIE_SAW_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeJulieSawPreset(initial, seed(5)), randomizeJulieSawPreset(JULIE_SAW_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(JULIE_SAW_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(JULIE_SAW_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeJulieSawPreset(initial, random);
    validateJulieSawPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of JULIE_SAW_NUMERIC_PRESET_KEYS) {
      assert.ok(result[key] >= JULIE_SAW_LIMITS[key][0] && result[key] <= JULIE_SAW_LIMITS[key][1]);
    }
    for (const key of JULIE_SAW_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  for (const key of JULIE_SAW_NUMERIC_PRESET_KEYS) assert.ok(seen.get(key).size > 30, `${key} barely varies`);
});
