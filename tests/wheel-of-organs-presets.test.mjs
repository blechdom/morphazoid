import assert from "node:assert/strict";
import test from "node:test";
import { createWheelState } from "../src/instruments/wheel-of-organs/wheel-of-organs.js";
import {
  WHEEL_FULL_PRESETS, WHEEL_GLOBAL_KEYS, WHEEL_MOUTH_KEYS, captureWheelPreset, randomizeWheelPreset, validateWheelPreset,
  wheelStateFromPreset,
} from "../src/instruments/wheel-of-organs/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Wheel of Organs bank is complete, valid and distinct", () => {
  validateFullPresetBank(WHEEL_FULL_PRESETS);
  for (const preset of WHEEL_FULL_PRESETS) {
    assert.equal(validateWheelPreset(preset.snapshot), preset.snapshot);
    assert.ok(preset.snapshot.mouths.some(mouth => mouth.active));
    assert.equal(preset.snapshot.mouths.map(mouth => mouth.letter).join(""), preset.snapshot.word.replaceAll(" ", ""));
  }
  assert.equal(new Set(WHEEL_FULL_PRESETS.map(preset => preset.snapshot.word)).size > 8, true);
  const bad = structuredClone(WHEEL_FULL_PRESETS[0].snapshot);
  bad.mouths[0].size = 9;
  assert.throws(() => validateWheelPreset(bad), TypeError);
  const mismatch = structuredClone(WHEEL_FULL_PRESETS[0].snapshot);
  mismatch.word = "OTHER";
  assert.throws(() => validateWheelPreset(mismatch), TypeError);
  assert.throws(() => validateWheelPreset({ ...WHEEL_FULL_PRESETS[0].snapshot, outputLevel: 0.4 }), TypeError);
});

test("Wheel of Organs apply round-trips and leaves session state alone", () => {
  for (const preset of WHEEL_FULL_PRESETS) {
    const state = { ...createWheelState({ word: "OLD" }), outputLevel: 0.9, running: false, selectedMouth: 1, vibrato: 0.5 };
    const next = wheelStateFromPreset(state, preset.snapshot);
    assert.deepEqual(captureWheelPreset(next.state, next.rate, next.overlap), preset.snapshot);
    assert.equal(next.state.outputLevel, 0.9);
    assert.equal(state.word, "OLD");
    assert.ok(next.state.selectedMouth < next.state.mouths.length);
  }
});

test("Wheel of Organs dice is pure, reproducible and varies every musical field", () => {
  const initial = WHEEL_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeWheelPreset(initial, seed(5)), randomizeWheelPreset(WHEEL_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(WHEEL_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map([...WHEEL_GLOBAL_KEYS, "word", ...WHEEL_MOUTH_KEYS.map(key => `mouth.${key}`)].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeWheelPreset(initial, random);
    validateWheelPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.mouths.length >= 4 && result.mouths.some(mouth => mouth.active));
    for (const key of [...WHEEL_GLOBAL_KEYS, "word"]) seen.get(key).add(result[key]);
    for (const key of WHEEL_MOUTH_KEYS) for (const mouth of result.mouths) seen.get(`mouth.${key}`).add(mouth[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "mouth.active" ? 2 : key === "mouth.interval" ? 8 : 20), `${key} stays frozen`);
  assert.throws(() => randomizeWheelPreset(initial, () => NaN), TypeError);
});
