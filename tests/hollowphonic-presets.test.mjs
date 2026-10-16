import assert from "node:assert/strict";
import test from "node:test";
import {
  HOLLOWPHONIC_FULL_PRESETS, HOLLOWPHONIC_PRESET_KEYS, captureHollowphonicPreset, randomizeHollowphonicPreset, validateHollowphonicPreset,
} from "../src/families/work-in-progress/hollowphonic-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Hollowphonic bank is complete, valid and never selects the microphone source", () => {
  validateFullPresetBank(HOLLOWPHONIC_FULL_PRESETS);
  assert.ok(HOLLOWPHONIC_FULL_PRESETS.length >= 12);
  for (const preset of HOLLOWPHONIC_FULL_PRESETS) {
    assert.equal(validateHollowphonicPreset(preset.snapshot), preset.snapshot);
    assert.ok([0, 1, 2].includes(preset.snapshot.generator));
    for (const key of ["source", "bypass", "playing", "level", "gain"]) assert.equal(key in preset.snapshot, false);
  }
  assert.throws(() => validateHollowphonicPreset({}), TypeError);
  assert.throws(() => validateHollowphonicPreset({ ...HOLLOWPHONIC_FULL_PRESETS[0].snapshot, generator: 3 }), TypeError);
  assert.equal(captureHollowphonicPreset({ depth: 2, generator: 3 }).generator, 2);
  assert.deepEqual(captureHollowphonicPreset({ ...HOLLOWPHONIC_FULL_PRESETS[2].snapshot, source: 3, playing: true }), HOLLOWPHONIC_FULL_PRESETS[2].snapshot);
});

test("Hollowphonic dice is pure, reproducible and varies every musical field", () => {
  const initial = HOLLOWPHONIC_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHollowphonicPreset(initial, seed(5)), randomizeHollowphonicPreset(HOLLOWPHONIC_FULL_PRESETS[7].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(HOLLOWPHONIC_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (key, value) => (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeHollowphonicPreset(initial, random);
    validateHollowphonicPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of [...HOLLOWPHONIC_PRESET_KEYS, "generator"]) note(key, result[key]);
    result.offsets.forEach((value, index) => note(`offset${index}`, value));
  }
  for (const [key, values] of seen) assert.ok(values.size >= 3, `${key} stays frozen`);
});
