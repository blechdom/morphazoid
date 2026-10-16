import assert from "node:assert/strict";
import test from "node:test";
import {
  MICROMORPH_FULL_PRESETS, MICROMORPH_PRESET_KEYS, captureMicromorphPreset, randomizeMicromorphPreset, validateMicromorphPreset,
} from "../src/instruments/micromorph/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Micromorph bank is complete, valid, distinct and excludes input/output state", () => {
  validateFullPresetBank(MICROMORPH_FULL_PRESETS);
  assert.ok(MICROMORPH_FULL_PRESETS.length >= 12);
  for (const preset of MICROMORPH_FULL_PRESETS) {
    assert.equal(validateMicromorphPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot.parameters).sort(), [...MICROMORPH_PRESET_KEYS].sort());
    assert.equal(JSON.stringify(preset).includes("inputGain"), false);
    assert.equal(JSON.stringify(preset).includes("outputLevel"), false);
  }
  assert.throws(() => validateMicromorphPreset({ parameters: {}, anchors: {} }), TypeError);
  const bad = structuredClone(MICROMORPH_FULL_PRESETS[1].snapshot);
  bad.parameters.memory = 7;
  assert.throws(() => validateMicromorphPreset(bad), TypeError);
  assert.deepEqual(captureMicromorphPreset({ parameters: { ...bad.parameters, inputGain: 3 }, anchors: bad.anchors }).parameters.memory, 1);
});

test("Micromorph dice is pure, reproducible and varies every musical field", () => {
  const initial = MICROMORPH_FULL_PRESETS[1].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeMicromorphPreset(initial, seed(5)), randomizeMicromorphPreset(MICROMORPH_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(MICROMORPH_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map([...MICROMORPH_PRESET_KEYS, "a", "b"].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeMicromorphPreset(initial, random);
    validateMicromorphPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of MICROMORPH_PRESET_KEYS) seen.get(key).add(result.parameters[key]);
    seen.get("a").add(result.anchors.a); seen.get("b").add(result.anchors.b);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 6, `${key} stays frozen`);
});
