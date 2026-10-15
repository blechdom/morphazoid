import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import * as ouroboros from "../src/instruments/ouroboros/full-presets.js";
import * as borealis from "../src/instruments/ouroboros-borealis/full-presets.js";
import * as carousel from "../src/instruments/ouroborousel/full-presets.js";
import * as nested from "../src/instruments/ourorourobouroboros/full-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

const families = [
  ["Ouroboros", ouroboros.OUROBOROS_FULL_PRESETS, ouroboros.OUROBOROS_PRESET_KEYS, ouroboros.captureOuroborosPreset, ouroboros.validateOuroborosPreset, ouroboros.randomizeOuroborosPreset, ["direction"]],
  ["Borealis", borealis.OUROBOROS_BOREALIS_FULL_PRESETS, borealis.OUROBOROS_BOREALIS_PRESET_KEYS, borealis.captureOuroborosBorealisPreset, borealis.validateOuroborosBorealisPreset, borealis.randomizeOuroborosBorealisPreset, ["pitchDirection", "rhythmDirection"]],
  ["Ouroborousel", carousel.OUROBOROUSEL_FULL_PRESETS, carousel.OUROBOROUSEL_PRESET_KEYS, carousel.captureOuroborouselPreset, carousel.validateOuroborouselPreset, carousel.randomizeOuroborouselPreset, ["direction", "materialMode", "noteLift"]],
  ["Ourorourobouroboros", nested.OUROBOROUSEL_FULL_PRESETS, nested.OUROBOROUSEL_PRESET_KEYS, nested.captureOuroborouselPreset, nested.validateOuroborouselPreset, nested.randomizeOuroborouselPreset, ["direction", "materialMode", "noteLift"]],
];

for (const [name, presets, keys, capture, validate, randomize, discrete] of families) {
  test(`${name} bank is complete, valid, distinct and excludes output level`, () => {
    validateFullPresetBank(presets);
    assert.ok(presets.length >= 12);
    for (const preset of presets) {
      assert.equal(validate(preset.snapshot), preset.snapshot);
      assert.deepEqual(Object.keys(preset.snapshot).sort(), [...keys].sort());
      assert.equal("level" in preset.snapshot, false);
      assert.deepEqual(capture(preset.snapshot), preset.snapshot);
    }
    assert.throws(() => validate({}), TypeError);
    assert.throws(() => validate({ ...presets[0].snapshot, extra: 1 }), TypeError);
    assert.throws(() => validate({ ...presets[0].snapshot, cutoff: 1e9 }), TypeError);
  });

  test(`${name} dice is pure, reproducible, bounded and moves every field`, () => {
    const initial = presets[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomize(initial, seed(9)), randomize(presets[4].snapshot, seed(9)));
    assert.deepEqual(initial, before);
    const bank = new Set(presets.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map(keys.map(key => [key, new Set()]));
    const random = seed(321);
    for (let i = 0; i < 80; i++) {
      const result = randomize(initial, random);
      validate(result);
      assert.equal(bank.has(presetStateKey(result)), false);
      for (const key of keys) seen.get(key).add(result[key]);
    }
    for (const [key, values] of seen) {
      assert.ok(values.size >= (discrete.includes(key) ? 2 : 30), `${key} stays frozen`);
    }
    assert.throws(() => randomize(initial, () => NaN), TypeError);
  });
}
