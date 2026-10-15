import assert from "node:assert/strict";
import test from "node:test";
import {
  DRUM_ROLL_FULL_PRESETS, DRUM_ROLL_PRESET_KEYS, captureDrumRollPreset, randomizeDrumRollPreset, validateDrumRollPreset,
} from "../src/instruments/drum-roll-please/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Drum Roll Please bank is complete, valid and distinct", () => {
  validateFullPresetBank(DRUM_ROLL_FULL_PRESETS);
  assert.ok(DRUM_ROLL_FULL_PRESETS.length >= 12);
  for (const preset of DRUM_ROLL_FULL_PRESETS) assert.equal(validateDrumRollPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateDrumRollPreset({}), TypeError);
  const bad = { ...DRUM_ROLL_FULL_PRESETS[1].snapshot, decay: 99 };
  assert.throws(() => validateDrumRollPreset(bad), TypeError);
});

test("Drum Roll Please capture excludes output level and preset memory", () => {
  const snapshot = DRUM_ROLL_FULL_PRESETS[4].snapshot;
  assert.deepEqual(captureDrumRollPreset({ ...snapshot, level: 0.1, presetId: "x" }), snapshot);
  assert.equal("level" in snapshot, false);
});

test("Drum Roll Please dice is pure, reproducible and varies every field", () => {
  const initial = DRUM_ROLL_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeDrumRollPreset(initial, seed(5)), randomizeDrumRollPreset(DRUM_ROLL_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(DRUM_ROLL_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(17), seen = new Map(DRUM_ROLL_PRESET_KEYS.map(key => [key, new Set()]));
  for (let i = 0; i < 100; i++) {
    const result = randomizeDrumRollPreset(initial, random);
    validateDrumRollPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of DRUM_ROLL_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
