import assert from "node:assert/strict";
import test from "node:test";
import {
  BOIDZOID_FULL_PRESETS, BOIDZOID_PRESET_KEYS, applyBoidzoidPreset, captureBoidzoidPreset, randomizeBoidzoidPreset, validateBoidzoidPreset,
} from "../src/instruments/boidzoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Boidzoid bank is complete, valid and distinct", () => {
  validateFullPresetBank(BOIDZOID_FULL_PRESETS);
  for (const preset of BOIDZOID_FULL_PRESETS) {
    assert.equal(validateBoidzoidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...BOIDZOID_PRESET_KEYS].sort());
  }
  assert.throws(() => validateBoidzoidPreset({ ...BOIDZOID_FULL_PRESETS[0].snapshot, count: 99 }), TypeError);
  assert.throws(() => validateBoidzoidPreset({ ...BOIDZOID_FULL_PRESETS[0].snapshot, extra: 1 }), TypeError);
});

test("Boidzoid apply round-trips and leaves session state alone", () => {
  for (const preset of BOIDZOID_FULL_PRESETS) {
    const state = { count: 10, level: 0.9, running: false, audioOn: true, seed: 123, lure: { active: true }, morph: 0.5 };
    applyBoidzoidPreset(state, preset.snapshot);
    assert.deepEqual(captureBoidzoidPreset(state), preset.snapshot);
    assert.deepEqual({ level: state.level, running: state.running, audioOn: state.audioOn, seed: state.seed, lure: state.lure.active },
      { level: 0.9, running: false, audioOn: true, seed: 123, lure: true });
  }
});

test("Boidzoid dice is pure, reproducible and varies every musical field", () => {
  const initial = BOIDZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeBoidzoidPreset(initial, seed(5)), randomizeBoidzoidPreset(BOIDZOID_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(BOIDZOID_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(BOIDZOID_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeBoidzoidPreset(initial, random);
    validateBoidzoidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 20, `${key} stays frozen`);
  assert.throws(() => randomizeBoidzoidPreset(initial, () => NaN), TypeError);
});
