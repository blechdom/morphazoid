import assert from "node:assert/strict";
import test from "node:test";
import {
  ESCHER_FULL_PRESETS, ESCHER_NUMERIC_KEYS, ESCHER_PRESET_KEYS, applyEscherPreset, captureEscherPreset, randomizeEscherPreset,
  validateEscherPreset,
} from "../src/instruments/escher-tessellation/full-presets.js";
import { ESCHER_TESSELLATION_PRESETS } from "../src/instruments/escher-tessellation/escher-tessellation.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Escher Tessellation bank is complete, valid and covers every structure", () => {
  validateFullPresetBank(ESCHER_FULL_PRESETS);
  for (const preset of ESCHER_FULL_PRESETS) assert.equal(validateEscherPreset(preset.snapshot), preset.snapshot);
  for (const structure of ESCHER_TESSELLATION_PRESETS) {
    assert.ok(ESCHER_FULL_PRESETS.some(preset => preset.snapshot.presetId === structure.id), structure.id);
  }
  assert.throws(() => validateEscherPreset({ ...ESCHER_FULL_PRESETS[0].snapshot, presetId: "nope" }), TypeError);
  assert.throws(() => validateEscherPreset({ ...ESCHER_FULL_PRESETS[0].snapshot, tone: 2 }), TypeError);
  assert.throws(() => validateEscherPreset({ ...ESCHER_FULL_PRESETS[0].snapshot, level: 0.4 }), TypeError);
});

test("Escher Tessellation apply round-trips and leaves session and view state alone", () => {
  for (const preset of ESCHER_FULL_PRESETS) {
    const state = { presetId: "inward-infinity", level: 0.9, playing: true, audioOn: true, zoom: 1.7, panX: 5, panY: -3, tone: 0.1 };
    applyEscherPreset(state, preset.snapshot);
    assert.deepEqual(captureEscherPreset(state), preset.snapshot);
    assert.deepEqual({ level: state.level, playing: state.playing, audioOn: state.audioOn, zoom: state.zoom, panX: state.panX, panY: state.panY },
      { level: 0.9, playing: true, audioOn: true, zoom: 1.7, panX: 5, panY: -3 });
  }
});

test("Escher Tessellation dice is pure, reproducible and varies every musical field", () => {
  const initial = ESCHER_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeEscherPreset(initial, seed(5)), randomizeEscherPreset(ESCHER_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(ESCHER_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(ESCHER_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeEscherPreset(initial, random);
    validateEscherPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) {
    const minimum = ESCHER_NUMERIC_KEYS.includes(key) ? (key === "neighborReach" ? 4 : 20) : 2;
    assert.ok(values.size >= minimum, `${key} stays frozen`);
  }
  assert.throws(() => randomizeEscherPreset(initial, () => NaN), TypeError);
});
