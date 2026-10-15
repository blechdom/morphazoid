import assert from "node:assert/strict";
import test from "node:test";
import {
  SRTUSS_FULL_PRESETS, captureSrtussPreset, randomizeSrtussPreset, validateSrtussPreset,
} from "../src/instruments/srtuss/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("srtuss bank is complete scenes only, valid and distinct", () => {
  validateFullPresetBank(SRTUSS_FULL_PRESETS);
  assert.ok(SRTUSS_FULL_PRESETS.length >= 12);
  assert.equal(SRTUSS_FULL_PRESETS.some(preset => preset.id.startsWith("parts-")), false);
  for (const preset of SRTUSS_FULL_PRESETS) assert.equal(validateSrtussPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateSrtussPreset({ globals: {}, voices: [] }), TypeError);
  const bad = structuredClone(SRTUSS_FULL_PRESETS[0].snapshot);
  bad.voices[0].level = 7;
  assert.throws(() => validateSrtussPreset(bad), TypeError);
});

test("srtuss capture excludes output level and round-trips a scene", () => {
  const snapshot = SRTUSS_FULL_PRESETS[3].snapshot;
  assert.equal("output" in snapshot.globals, false);
  const live = { globals: { ...snapshot.globals, output: 0.1 }, voices: snapshot.voices, selectedVoiceId: "x", audioOn: true };
  assert.deepEqual(captureSrtussPreset(live), snapshot);
});

test("srtuss dice builds a new scene, is pure and varies every field", () => {
  const initial = SRTUSS_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSrtussPreset(initial, seed(5)), randomizeSrtussPreset(SRTUSS_FULL_PRESETS[8].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SRTUSS_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(61), seen = new Map();
  const note = (key, value) => (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(JSON.stringify(value));
  for (let i = 0; i < 200; i++) {
    const result = randomizeSrtussPreset(initial, random);
    validateSrtussPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.ok(result.voices.some(voice => voice.enabled));
    note("voiceCount", result.voices.length);
    for (const [key, value] of Object.entries(result.globals)) note(`globals.${key}`, value);
    for (const voice of result.voices) {
      for (const key of ["projectId", "partId", "enabled", "solo", "tapeRate", "level", "pan"]) note(key, voice[key]);
      for (const [key, value] of Object.entries(voice.params)) note(`params.${key}`, value);
      for (const [key, value] of Object.entries(voice.stems)) note(`stems.${key}`, value);
    }
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
