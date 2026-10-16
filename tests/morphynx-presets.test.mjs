import assert from "node:assert/strict";
import test from "node:test";
import {
  MORPHYNX_ANATOMY_KEYS, MORPHYNX_ANIMAL_KEYS, MORPHYNX_FULL_PRESETS, captureMorphynxPreset, randomizeMorphynxPreset, validateMorphynxPreset,
} from "../src/instruments/morphynx/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Morphynx bank is complete, valid and excludes input/output state", () => {
  validateFullPresetBank(MORPHYNX_FULL_PRESETS);
  assert.ok(MORPHYNX_FULL_PRESETS.length >= 12);
  for (const preset of MORPHYNX_FULL_PRESETS) {
    assert.equal(validateMorphynxPreset(preset.snapshot), preset.snapshot);
    for (const key of ["sourceMode", "level", "active", "keyboardLatch"]) assert.equal(key in preset.snapshot, false);
  }
  assert.throws(() => validateMorphynxPreset({}), TypeError);
  const bad = structuredClone(MORPHYNX_FULL_PRESETS[2].snapshot);
  bad.anatomy.throatCount = 99;
  assert.throws(() => validateMorphynxPreset(bad), TypeError);
  assert.deepEqual(captureMorphynxPreset(MORPHYNX_FULL_PRESETS[4].snapshot), MORPHYNX_FULL_PRESETS[4].snapshot);
});

test("Morphynx dice is pure, reproducible and varies every musical field", () => {
  const initial = MORPHYNX_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeMorphynxPreset(initial, seed(5)), randomizeMorphynxPreset(MORPHYNX_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(MORPHYNX_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (key, value) => (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeMorphynxPreset(initial, random);
    validateMorphynxPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const [key, value] of Object.entries(result)) {
      if (key === "animal") MORPHYNX_ANIMAL_KEYS.forEach(k => note(`animal.${k}`, value[k]));
      else if (key === "anatomy") MORPHYNX_ANATOMY_KEYS.forEach(k => note(`anatomy.${k}`, value[k]));
      else note(key, value);
    }
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("animalId").size > 8);
});
