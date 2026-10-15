import assert from "node:assert/strict";
import test from "node:test";
import {
  SURROUND_FULL_PRESETS, SURROUND_PRESET_KEYS, captureSurroundPreset, randomizeSurroundPreset, validateSurroundPreset,
} from "../src/instruments/surround-field/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const asState = snapshot => ({ ...snapshot, position: { x: snapshot.x, y: snapshot.y, z: snapshot.z } });

test("Surround for Safety bank is complete, valid and distinct", () => {
  validateFullPresetBank(SURROUND_FULL_PRESETS);
  for (const preset of SURROUND_FULL_PRESETS) {
    assert.equal(validateSurroundPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureSurroundPreset(asState(preset.snapshot)), preset.snapshot);
  }
  assert.throws(() => validateSurroundPreset({}), TypeError);
  assert.throws(() => validateSurroundPreset({ ...SURROUND_FULL_PRESETS[0].snapshot, release: 99 }), TypeError);
  assert.throws(() => validateSurroundPreset({ ...SURROUND_FULL_PRESETS[1].snapshot, x: 0.3 }), TypeError);
});

test("Surround capture ignores the live source position while moving and session fields", () => {
  const orbit = SURROUND_FULL_PRESETS[1].snapshot;
  const live = { ...orbit, position: { x: 0.5, y: -0.3, z: orbit.z }, level: 0.1, layoutId: "8-cube", forcePreview: true };
  assert.deepEqual(captureSurroundPreset(live), orbit);
});

test("Surround dice is pure, reproducible and varies every field", () => {
  const initial = SURROUND_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSurroundPreset(initial, seed(5)), randomizeSurroundPreset(SURROUND_FULL_PRESETS[5].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SURROUND_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(21), seen = new Map(SURROUND_PRESET_KEYS.map(key => [key, new Set()]));
  for (let i = 0; i < 200; i++) {
    const result = randomizeSurroundPreset(initial, random);
    validateSurroundPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of SURROUND_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
