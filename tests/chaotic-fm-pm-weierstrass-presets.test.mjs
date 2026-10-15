import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAOTIC_FM_FULL_PRESETS, CHAOTIC_FM_PRESET_PERFORMANCE_KEYS, CHAOTIC_FM_SETTINGS_KEYS,
  captureChaoticFmPreset, randomizeChaoticFmPreset, validateChaoticFmPreset,
} from "../src/instruments/chaotic-fm/full-presets.js";
import {
  CHAOTIC_PM_FULL_PRESETS, CHAOTIC_PM_PRESET_PERFORMANCE_KEYS, CHAOTIC_PM_SETTINGS_KEYS,
  captureChaoticPmPreset, randomizeChaoticPmPreset, validateChaoticPmPreset,
} from "../src/instruments/chaotic-pm/full-presets.js";
import {
  WEIERSTRASS_FULL_PRESETS, WEIERSTRASS_PRESET_KEYS,
  captureWeierstrassPreset, randomizeWeierstrassPreset, validateWeierstrassPreset,
} from "../src/instruments/weierstrass/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flat = snapshot => ({ ...snapshot.settings, ...snapshot.performance });

const chaotic = [
  ["Chaotic FM", CHAOTIC_FM_FULL_PRESETS, validateChaoticFmPreset, randomizeChaoticFmPreset,
    [...CHAOTIC_FM_SETTINGS_KEYS, ...CHAOTIC_FM_PRESET_PERFORMANCE_KEYS], captureChaoticFmPreset],
  ["Chaotic PM", CHAOTIC_PM_FULL_PRESETS, validateChaoticPmPreset, randomizeChaoticPmPreset,
    [...CHAOTIC_PM_SETTINGS_KEYS, ...CHAOTIC_PM_PRESET_PERFORMANCE_KEYS], captureChaoticPmPreset],
];

for (const [name, bank, validate, randomize, keys, capture] of chaotic) {
  test(`${name} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.deepEqual(validate(preset.snapshot), preset.snapshot);
      assert.deepEqual(capture(preset.snapshot), preset.snapshot);
      assert.equal(Object.keys(flat(preset.snapshot)).length, keys.length);
    }
    for (const key of ["playMode", "output"]) assert.equal(keys.includes(key), false, `${key} is session state`);
    assert.throws(() => validate({ settings: {}, performance: {} }), TypeError);
    const bad = structuredClone(bank[1].snapshot);
    bad.settings.depth = 99;
    assert.throws(() => validate(bad), TypeError);
    const extra = structuredClone(bank[1].snapshot);
    extra.performance.playMode = "midi";
    assert.throws(() => validate(extra), TypeError);
  });

  test(`${name} dice is pure, reproducible, bounded and varies every field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomize(initial, seed(5)), randomize(bank[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const existing = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map(keys.map(key => [key, new Set()]));
    const random = seed(91);
    for (let i = 0; i < 80; i++) {
      const result = randomize(initial, random);
      validate(result);
      assert.equal(existing.has(presetStateKey(result)), false);
      for (const [key, value] of Object.entries(flat(result))) seen.get(key).add(value);
    }
    for (const [key, values] of seen) assert.ok(values.size >= (["glideMode", "transferMode"].includes(key) ? 2 : 6), `${key} stays frozen`);
  });
}

test("Chaotic PM dice reaches both transfer modes and every depth", () => {
  const random = seed(3), depths = new Set(), modes = new Set();
  for (let i = 0; i < 200; i++) {
    const { settings } = randomizeChaoticPmPreset(CHAOTIC_PM_FULL_PRESETS[0].snapshot, random);
    depths.add(settings.depth); modes.add(settings.transferMode);
  }
  assert.deepEqual([...modes].sort(), ["legacy", "smooth"]);
  assert.equal(depths.size, 8);
});

test("Weierstrass bank is complete, valid, distinct and canonical", () => {
  validateFullPresetBank(WEIERSTRASS_FULL_PRESETS);
  assert.ok(WEIERSTRASS_FULL_PRESETS.length >= 12);
  assert.deepEqual(new Set(WEIERSTRASS_FULL_PRESETS.map(preset => preset.snapshot.mode)), new Set(["wave", "fm", "pm"]));
  for (const preset of WEIERSTRASS_FULL_PRESETS) {
    assert.deepEqual(validateWeierstrassPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...WEIERSTRASS_PRESET_KEYS].sort());
  }
  assert.throws(() => validateWeierstrassPreset({ mode: "wave" }), TypeError);
  assert.throws(() => validateWeierstrassPreset({ ...WEIERSTRASS_FULL_PRESETS[0].snapshot, terms: 400 }), TypeError);
  assert.throws(() => validateWeierstrassPreset({ ...WEIERSTRASS_FULL_PRESETS[0].snapshot, output: 0.4 }), TypeError);
  const wave = WEIERSTRASS_FULL_PRESETS.find(preset => preset.snapshot.mode === "wave").snapshot;
  const fm = WEIERSTRASS_FULL_PRESETS.find(preset => preset.snapshot.mode === "fm").snapshot;
  assert.equal(wave.fmDepthHz > 0, true);
  assert.equal(fm.pmCarrierFrequencyHz > 0, true);
  assert.deepEqual(captureWeierstrassPreset({ ...wave, output: 0.1 }), wave);
});

test("Weierstrass dice is pure, reproducible, bounded and varies every field", () => {
  const initial = WEIERSTRASS_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeWeierstrassPreset(initial, seed(5)), randomizeWeierstrassPreset(WEIERSTRASS_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const existing = new Set(WEIERSTRASS_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(WEIERSTRASS_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(17);
  for (let i = 0; i < 100; i++) {
    const result = randomizeWeierstrassPreset(initial, random);
    validateWeierstrassPreset(result);
    assert.equal(existing.has(presetStateKey(result)), false);
    assert.ok(result.baseFrequencyHz * result.frequencyRatio ** (result.startExponent + 1) <= 9001);
    for (const [key, value] of Object.entries(result)) seen.get(key).add(value);
  }
  for (const [key, values] of seen) assert.ok(values.size >= ({ mode: 3, startExponent: 4 }[key] ?? 6), `${key} stays frozen`);
});
