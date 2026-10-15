import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FM_DRUM_VOICES } from "../src/instruments/fm-drums/fm-drums.js";
import {
  FM_DRUM_FULL_PRESETS, FM_DRUM_PRESET_KEYS, captureFmDrumPreset, randomizeFmDrumPreset, validateFmDrumPreset,
} from "../src/instruments/fm-drums/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("FM Drums bank is complete, valid and distinct", () => {
  validateFullPresetBank(FM_DRUM_FULL_PRESETS);
  assert.deepEqual(FM_DRUM_FULL_PRESETS[0].snapshot, captureFmDrumPreset(DEFAULT_FM_DRUM_VOICES));
  for (const preset of FM_DRUM_FULL_PRESETS) {
    assert.equal(validateFmDrumPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.voices.length, 16);
  }
  assert.throws(() => validateFmDrumPreset({ voices: [] }), TypeError);
  const bad = structuredClone(FM_DRUM_FULL_PRESETS[1].snapshot);
  bad.voices[0].decay = 99;
  assert.throws(() => validateFmDrumPreset(bad), TypeError);
});

test("FM Drums dice is pure, reproducible and varies every musical field", () => {
  const initial = FM_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeFmDrumPreset(initial, seed(5)), randomizeFmDrumPreset(FM_DRUM_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(FM_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(FM_DRUM_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeFmDrumPreset(initial, random);
    validateFmDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const voice of result.voices) for (const key of FM_DRUM_PRESET_KEYS) seen.get(key).add(voice[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size > 32, `${key} stays frozen`);
});
