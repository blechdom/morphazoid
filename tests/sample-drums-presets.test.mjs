import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SAMPLE_DRUM_VOICES } from "../src/instruments/sample-drums/sample-drums.js";
import {
  SAMPLE_DRUM_FULL_PRESETS, SAMPLE_DRUM_PRESET_KEYS, captureSampleDrumPreset,
  randomizeSampleDrumPreset, validateSampleDrumPreset,
} from "../src/instruments/sample-drums/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const leaves = (value, path = "") => (value !== null && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`))
  : [[path, value]]);
function collectLeafValues(results) {
  const seen = new Map();
  for (const result of results) for (const [path, value] of leaves(result)) {
    if (!seen.has(path)) seen.set(path, new Set());
    seen.get(path).add(JSON.stringify(value));
  }
  return seen;
}

test("Sample Drums bank is complete, valid and distinct", () => {
  validateFullPresetBank(SAMPLE_DRUM_FULL_PRESETS);
  assert.ok(SAMPLE_DRUM_FULL_PRESETS.length >= 12);
  assert.deepEqual(SAMPLE_DRUM_FULL_PRESETS[0].snapshot, captureSampleDrumPreset(DEFAULT_SAMPLE_DRUM_VOICES));
  for (const preset of SAMPLE_DRUM_FULL_PRESETS) {
    assert.equal(validateSampleDrumPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.voices.length, 16);
  }
  assert.throws(() => validateSampleDrumPreset({ voices: [] }), TypeError);
  const bad = structuredClone(SAMPLE_DRUM_FULL_PRESETS[1].snapshot);
  bad.voices[0].decay = 99;
  assert.throws(() => validateSampleDrumPreset(bad), TypeError);
});

test("Sample Drums capture excludes sample identity and session state", () => {
  const voices = DEFAULT_SAMPLE_DRUM_VOICES.map(voice => ({ ...voice, url: "https://example.test/x.wav", name: "renamed" }));
  assert.deepEqual(captureSampleDrumPreset(voices), SAMPLE_DRUM_FULL_PRESETS[0].snapshot);
  for (const voice of SAMPLE_DRUM_FULL_PRESETS[2].snapshot.voices) {
    assert.deepEqual(Object.keys(voice).sort(), ["id", ...SAMPLE_DRUM_PRESET_KEYS].sort());
  }
});

test("Sample Drums dice is pure, reproducible and varies every musical field", () => {
  const initial = SAMPLE_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSampleDrumPreset(initial, seed(5)), randomizeSampleDrumPreset(SAMPLE_DRUM_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(SAMPLE_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(SAMPLE_DRUM_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeSampleDrumPreset(initial, random);
    validateSampleDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const voice of result.voices) for (const key of SAMPLE_DRUM_PRESET_KEYS) seen.get(key).add(voice[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size > 32, `${key} stays frozen`);
});
