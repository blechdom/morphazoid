import assert from "node:assert/strict";
import test from "node:test";
import { BREATH_ATLAS_LIMITS, sanitizeBreathAtlasState, stateForInstrument } from "../src/instruments/breath-atlas/breath-atlas.js";
import {
  BREATH_ATLAS_FULL_PRESETS, BREATH_PRESET_KEYS, captureBreathAtlasPreset, randomizeBreathAtlasPreset, validateBreathAtlasPreset,
} from "../src/instruments/breath-atlas/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Mouthophones bank is complete, valid and spans instruments", () => {
  validateFullPresetBank(BREATH_ATLAS_FULL_PRESETS);
  for (const { snapshot } of BREATH_ATLAS_FULL_PRESETS) {
    assert.equal(validateBreathAtlasPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...BREATH_PRESET_KEYS].sort());
    assert.equal(snapshot.outputLevel, undefined);
    assert.equal(presetStateKey(captureBreathAtlasPreset(sanitizeBreathAtlasState(snapshot))), presetStateKey(snapshot));
  }
  assert.ok(new Set(BREATH_ATLAS_FULL_PRESETS.map(p => p.snapshot.instrumentId)).size >= 12);
  assert.throws(() => validateBreathAtlasPreset({ ...BREATH_ATLAS_FULL_PRESETS[0].snapshot, instrumentId: "kazoo" }), TypeError);
  assert.throws(() => validateBreathAtlasPreset({ ...BREATH_ATLAS_FULL_PRESETS[0].snapshot, damping: 5 }), TypeError);
  assert.throws(() => validateBreathAtlasPreset({ ...BREATH_ATLAS_FULL_PRESETS[0].snapshot, outputLevel: 0.5 }), TypeError);
});

test("Mouthophones capture round-trips and excludes session state", () => {
  for (const { snapshot } of BREATH_ATLAS_FULL_PRESETS) {
    const captured = captureBreathAtlasPreset({ ...snapshot, outputLevel: 0.7, audio: true });
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["outputLevel", "audio"]) assert.equal(key in captured, false);
  }
  assert.equal(captureBreathAtlasPreset(stateForInstrument("lesiba")).instrumentId, "lesiba");
});

test("Mouthophones dice is pure, reproducible, valid and varies every field", () => {
  const initial = BREATH_ATLAS_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeBreathAtlasPreset(initial, seed(5)), randomizeBreathAtlasPreset(BREATH_ATLAS_FULL_PRESETS[7].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(BREATH_ATLAS_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(BREATH_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 300; i++) {
    const result = randomizeBreathAtlasPreset(initial, random);
    validateBreathAtlasPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of Object.keys(BREATH_ATLAS_LIMITS)) if (key in result) assert.ok(result[key] >= BREATH_ATLAS_LIMITS[key][0] && result[key] <= BREATH_ATLAS_LIMITS[key][1]);
    for (const key of BREATH_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.equal(seen.get("instrumentId").size, 19);
  assert.equal(seen.get("rhythmId").size, 6);
});
