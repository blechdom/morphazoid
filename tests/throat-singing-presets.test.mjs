import assert from "node:assert/strict";
import test from "node:test";
import { THROAT_SINGING_LIMITS, THROAT_SINGING_STYLE_PRESETS, harmonicFrequencyHz, sanitizeThroatSingingState } from "../src/instruments/throat-singing/throat-singing.js";
import {
  THROAT_SINGING_EXTRA_RANGES, THROAT_SINGING_FULL_PRESETS, THROAT_SINGING_NUMERIC_PRESET_KEYS, THROAT_SINGING_PRESET_KEYS,
  captureThroatSingingPreset, randomizeThroatSingingPreset, splitThroatSingingPreset,
  throatSingingStyleIdForPreset, validateThroatSingingPreset,
} from "../src/instruments/throat-singing/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Throat Singing bank keeps every named approach and adds authored scenes", () => {
  validateFullPresetBank(THROAT_SINGING_FULL_PRESETS);
  assert.ok(THROAT_SINGING_FULL_PRESETS.length >= 12);
  for (const style of THROAT_SINGING_STYLE_PRESETS) assert.ok(THROAT_SINGING_FULL_PRESETS.some(preset => preset.id === style.id));
  for (const preset of THROAT_SINGING_FULL_PRESETS) {
    assert.equal(validateThroatSingingPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...THROAT_SINGING_PRESET_KEYS].sort());
    assert.equal(preset.snapshot.level, undefined);
  }
  assert.equal(throatSingingStyleIdForPreset(THROAT_SINGING_FULL_PRESETS[3].snapshot), "kargyraa");
  assert.equal(throatSingingStyleIdForPreset(THROAT_SINGING_FULL_PRESETS.at(-1).snapshot), null);
  assert.throws(() => validateThroatSingingPreset({}), TypeError);
  assert.throws(() => validateThroatSingingPreset({ ...THROAT_SINGING_FULL_PRESETS[0].snapshot, trueFoldHz: 9 }), TypeError);
  assert.throws(() => validateThroatSingingPreset({ ...THROAT_SINGING_FULL_PRESETS[0].snapshot, motionShape: "saw" }), TypeError);
});

test("Throat Singing split separates the model from speculative-lab extras", () => {
  const { model, extras } = splitThroatSingingPreset(THROAT_SINGING_FULL_PRESETS.at(-1).snapshot);
  assert.deepEqual(Object.keys(extras).sort(), Object.keys(THROAT_SINGING_EXTRA_RANGES).sort());
  assert.equal(extras.phantomAirways, 4);
  assert.deepEqual(captureThroatSingingPreset(sanitizeThroatSingingState(model), extras), THROAT_SINGING_FULL_PRESETS.at(-1).snapshot);
});

test("Throat Singing dice is pure, reproducible, bounded and varies every field", () => {
  const initial = THROAT_SINGING_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeThroatSingingPreset(initial, seed(5)), randomizeThroatSingingPreset(THROAT_SINGING_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(THROAT_SINGING_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(THROAT_SINGING_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 120; i++) {
    const result = randomizeThroatSingingPreset(initial, random);
    validateThroatSingingPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(harmonicFrequencyHz(sanitizeThroatSingingState(splitThroatSingingPreset(result).model)) < 4_500);
    if (result.falseFoldDivision > 1) assert.ok(result.falseFoldCoupling >= .5);
    for (const key of THROAT_SINGING_NUMERIC_PRESET_KEYS) {
      const [lo, hi] = THROAT_SINGING_LIMITS[key] ?? THROAT_SINGING_EXTRA_RANGES[key];
      assert.ok(result[key] >= lo && result[key] <= hi, key);
    }
    for (const key of THROAT_SINGING_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.equal(seen.get("motionShape").size, 5);
});
