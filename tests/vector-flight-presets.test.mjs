import assert from "node:assert/strict";
import test from "node:test";
import {
  VECTOR_FLIGHT_FULL_PRESETS, VECTOR_FLIGHT_PRESET_KEYS, applyVectorFlightPreset, captureVectorFlightPreset, randomizeVectorFlightPreset, validateVectorFlightPreset,
} from "../src/instruments/vector-flight/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Vector Flight bank is complete, valid and distinct", () => {
  validateFullPresetBank(VECTOR_FLIGHT_FULL_PRESETS);
  for (const preset of VECTOR_FLIGHT_FULL_PRESETS) {
    assert.equal(validateVectorFlightPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...VECTOR_FLIGHT_PRESET_KEYS].sort());
  }
  assert.throws(() => validateVectorFlightPreset({ ...VECTOR_FLIGHT_FULL_PRESETS[0].snapshot, density: 999 }), TypeError);
  assert.throws(() => validateVectorFlightPreset({ ...VECTOR_FLIGHT_FULL_PRESETS[0].snapshot, extra: 1 }), TypeError);
});

test("Vector Flight apply round-trips and leaves session state alone", () => {
  for (const preset of VECTOR_FLIGHT_FULL_PRESETS) {
    const state = { density: 30, orbitPhase: 1, level: 0.9, running: false, audioOn: true, field: 123, lure: { active: true }, throttle: 5 };
    applyVectorFlightPreset(state, preset.snapshot);
    assert.deepEqual(captureVectorFlightPreset(state), preset.snapshot);
    assert.deepEqual({ level: state.level, running: state.running, audioOn: state.audioOn, field: state.field, lure: state.lure.active },
      { level: 0.9, running: false, audioOn: true, field: 123, lure: true });
  }
});

test("Vector Flight dice is pure, reproducible and varies every musical field", () => {
  const initial = VECTOR_FLIGHT_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeVectorFlightPreset(initial, seed(5)), randomizeVectorFlightPreset(VECTOR_FLIGHT_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(VECTOR_FLIGHT_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(VECTOR_FLIGHT_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeVectorFlightPreset(initial, random);
    validateVectorFlightPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "articulation" ? 3 : key === "orbitLobes" ? 6 : 20), `${key} stays frozen`);
  assert.throws(() => randomizeVectorFlightPreset(initial, () => NaN), TypeError);
});
