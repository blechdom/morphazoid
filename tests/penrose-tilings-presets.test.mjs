import assert from "node:assert/strict";
import test from "node:test";
import {
  PENROSE_FULL_PRESETS, PENROSE_NUMERIC_KEYS, PENROSE_PRESET_KEYS, applyPenrosePreset, capturePenrosePreset, randomizePenrosePreset,
  validatePenrosePreset,
} from "../src/instruments/penrose-tilings/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Penrose Tilings bank is complete, valid and covers every presentation", () => {
  validateFullPresetBank(PENROSE_FULL_PRESETS);
  for (const preset of PENROSE_FULL_PRESETS) assert.equal(validatePenrosePreset(preset.snapshot), preset.snapshot);
  for (const presentation of ["p3", "pentagrid", "p2", "p1", "robinson"]) {
    assert.ok(PENROSE_FULL_PRESETS.some(preset => preset.snapshot.presentation === presentation), presentation);
  }
  assert.throws(() => validatePenrosePreset({ ...PENROSE_FULL_PRESETS[0].snapshot, presentation: "nope" }), TypeError);
  assert.throws(() => validatePenrosePreset({ ...PENROSE_FULL_PRESETS[0].snapshot, generation: 9 }), TypeError);
  assert.throws(() => validatePenrosePreset({ ...PENROSE_FULL_PRESETS[0].snapshot, level: 0.4 }), TypeError);
  assert.throws(() => validatePenrosePreset({ ...PENROSE_FULL_PRESETS[4].snapshot, coverage: "infinite" }), TypeError);
  assert.throws(() => validatePenrosePreset({ ...PENROSE_FULL_PRESETS[0].snapshot, showHierarchy: true }), TypeError);
});

test("Penrose Tilings apply round-trips and leaves session and view state alone", () => {
  for (const preset of PENROSE_FULL_PRESETS) {
    const state = { presentation: "p1", coverage: "patch", level: 0.9, playing: true, audio: true, zoom: 1.7, position: 0.3, tone: 0.1 };
    applyPenrosePreset(state, preset.snapshot);
    assert.deepEqual(capturePenrosePreset(state), preset.snapshot);
    assert.deepEqual({ level: state.level, playing: state.playing, audio: state.audio, zoom: state.zoom, position: state.position },
      { level: 0.9, playing: true, audio: true, zoom: 1.7, position: 0.3 });
  }
});

test("Penrose Tilings dice is pure, reproducible and varies every musical field", () => {
  const initial = PENROSE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizePenrosePreset(initial, seed(5)), randomizePenrosePreset(PENROSE_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(PENROSE_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(PENROSE_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizePenrosePreset(initial, random);
    validatePenrosePreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) {
    const minimum = PENROSE_NUMERIC_KEYS.includes(key) ? (key === "orientation" ? 8 : key === "generation" ? 6 : key === "pathVoiceCap" ? 12 : 20) : 2;
    assert.ok(values.size >= (key === "showHierarchy" ? 2 : minimum), `${key} stays frozen`);
  }
  assert.throws(() => randomizePenrosePreset(initial, () => NaN), TypeError);
});
