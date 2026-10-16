import assert from "node:assert/strict";
import test from "node:test";
import {
  TESSELATION_FULL_PRESETS, TESSELATION_PRESET_KEYS, captureTesselationPreset, randomizeTesselationPreset, validateTesselationPreset,
} from "../src/instruments/tesselation/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({
  ...snapshot, pitchSourceByGeometry: { lattice: snapshot.latticePitchSource, spiral: snapshot.spiralPitchSource },
  position: 0.3, playing: true, audio: true, level: 0.9,
});

test("Tesselation bank is complete, valid and spans all four modes", () => {
  validateFullPresetBank(TESSELATION_FULL_PRESETS);
  assert.ok(TESSELATION_FULL_PRESETS.length >= 12);
  const modes = new Set();
  for (const { snapshot } of TESSELATION_FULL_PRESETS) {
    assert.equal(validateTesselationPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...TESSELATION_PRESET_KEYS].sort());
    modes.add(snapshot.mode);
  }
  assert.equal(modes.size, 4);
  const bad = structuredClone(TESSELATION_FULL_PRESETS[2].snapshot);
  bad.soundMode = "granular";
  assert.throws(() => validateTesselationPreset(bad), TypeError);
  assert.throws(() => validateTesselationPreset({ ...TESSELATION_FULL_PRESETS[0].snapshot, density: 4 }), TypeError);
  assert.throws(() => validateTesselationPreset({ ...TESSELATION_FULL_PRESETS[0].snapshot, edgeCurves: [] }), TypeError);
});

test("Tesselation capture round-trips and excludes session state", () => {
  for (const { snapshot } of TESSELATION_FULL_PRESETS) {
    const captured = captureTesselationPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["position", "playing", "audio", "level"]) assert.equal(key in captured, false);
  }
});

test("Tesselation dice is pure, reproducible, valid and varies every musical field", () => {
  const initial = TESSELATION_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeTesselationPreset(initial, seed(5)), randomizeTesselationPreset(structuredClone(initial), seed(5)));
  assert.notDeepEqual(randomizeTesselationPreset(initial, seed(5)), randomizeTesselationPreset(initial, seed(6)));
  assert.deepEqual(initial, before);
  const factory = new Set(TESSELATION_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(TESSELATION_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeTesselationPreset(initial, random);
    validateTesselationPreset(result);
    assert.equal(result.mode, initial.mode);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of TESSELATION_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
  }
  for (const [key, values] of seen) {
    if (key === "mode") continue;
    assert.ok(values.size >= 2, `${key} stays frozen`);
  }
  assert.ok(seen.get("tilingType").size > 30);
  assert.ok(seen.get("density").size > 30);
  assert.ok(seen.get("baseFrequency").size > 30);
  assert.throws(() => randomizeTesselationPreset({ ...initial, mode: "bogus" }), TypeError);
});

test("Tesselation dice keeps the current mode in each view", () => {
  for (const preset of TESSELATION_FULL_PRESETS) {
    assert.equal(randomizeTesselationPreset(preset.snapshot, seed(9)).mode, preset.snapshot.mode);
  }
});
