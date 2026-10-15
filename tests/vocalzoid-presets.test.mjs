import assert from "node:assert/strict";
import test from "node:test";
import { VOCALZOID_MAX_MIDI, VOCALZOID_MIN_MIDI, VOCALZOID_STYLES } from "../src/instruments/vocalzoid/vocalzoid.js";
import {
  VOCALZOID_FULL_PRESETS, captureVocalzoidPreset, randomizeVocalzoidPreset, validateVocalzoidPreset,
} from "../src/instruments/vocalzoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Vocalzoid bank is complete, valid and varied", () => {
  validateFullPresetBank(VOCALZOID_FULL_PRESETS);
  for (const preset of VOCALZOID_FULL_PRESETS) {
    assert.equal(validateVocalzoidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureVocalzoidPreset(structuredClone(preset.snapshot)), preset.snapshot);
    for (const key of ["level", "loop", "melody", "selectedId", "audioOn"]) assert.equal(key in preset.snapshot, false);
  }
  assert.equal(new Set(VOCALZOID_FULL_PRESETS.map(p => p.snapshot.style)).size, Object.keys(VOCALZOID_STYLES).length);
  assert.ok(new Set(VOCALZOID_FULL_PRESETS.map(p => p.snapshot.bpm)).size >= 8);
  assert.ok(new Set(VOCALZOID_FULL_PRESETS.map(p => p.snapshot.notes.length)).size >= 5);
});

test("validation rejects malformed scenes", () => {
  const good = VOCALZOID_FULL_PRESETS[1].snapshot;
  const mutate = change => { const copy = structuredClone(good); change(copy); return copy; };
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.notes[0].midi = 100; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.notes[0].phones = ["QQ"]; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.notes[1].id = s.notes[0].id; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.bpm = 500; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.style = "nope"; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.scoreBeats = 1; })), TypeError);
  assert.throws(() => validateVocalzoidPreset(mutate(s => { s.notes = []; delete s.randomScore; })), TypeError);
});

test("Vocalzoid dice is pure, reproducible, bounded and unfrozen", () => {
  const initial = VOCALZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeVocalzoidPreset(initial, seed(5)), randomizeVocalzoidPreset({ ...VOCALZOID_FULL_PRESETS[5].snapshot, word: initial.word }, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(VOCALZOID_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(["style", "bpm", "vibrato", "glide", "scoreBeats"].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 100; i++) {
    const result = randomizeVocalzoidPreset(initial, random);
    validateVocalzoidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.equal(result.randomScore, true);
    assert.equal(result.word, initial.word);
    assert.ok(result.notes.length >= 6 && result.notes.length <= 10);
    for (const entry of result.notes) assert.ok(entry.midi >= VOCALZOID_MIN_MIDI && entry.midi <= VOCALZOID_MAX_MIDI);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "style" ? 3 : key === "scoreBeats" ? 5 : 15), `${key} stays frozen`);
  validateVocalzoidPreset(randomizeVocalzoidPreset(initial, () => 0));
  validateVocalzoidPreset(randomizeVocalzoidPreset(initial, () => 1));
});
