import assert from "node:assert/strict";
import test from "node:test";
import {
  JAW_JAM_FULL_PRESETS, captureJawJamPreset, randomizeJawJamPreset, validateJawJamPreset,
} from "../src/instruments/jaw-jam/full-presets.js";
import { JAW_JAM_PATTERNS } from "../src/instruments/jaw-jam/jaw-jam.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Jaw Jam bank is complete, valid and keeps every authored performance", () => {
  validateFullPresetBank(JAW_JAM_FULL_PRESETS);
  for (const preset of JAW_JAM_FULL_PRESETS) {
    assert.equal(validateJawJamPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureJawJamPreset(structuredClone(preset.snapshot.pattern)), preset.snapshot);
    assert.equal(preset.snapshot.pattern.steps.length, preset.snapshot.pattern.stepCount);
    assert.ok(preset.snapshot.pattern.steps.some(step => step.action === "pluck"));
  }
  for (const pattern of JAW_JAM_PATTERNS) {
    assert.ok(JAW_JAM_FULL_PRESETS.some(preset => preset.id === pattern.id));
  }
  assert.ok(new Set(JAW_JAM_FULL_PRESETS.map(p => p.snapshot.pattern.stepCount)).size >= 6);
});

test("Jaw Jam validation rejects damaged scenes and excludes metadata and level", () => {
  const good = structuredClone(JAW_JAM_FULL_PRESETS[6].snapshot);
  for (const key of ["id", "label", "level", "playing"]) assert.equal(Object.hasOwn(good.pattern, key), false);
  const tempo = structuredClone(good); tempo.pattern.tempo = 5000;
  assert.throws(() => validateJawJamPreset(tempo), TypeError);
  const steps = structuredClone(good); steps.pattern.steps.pop();
  assert.throws(() => validateJawJamPreset(steps), TypeError);
  const voice = structuredClone(good); voice.pattern.steps[0].soundPresetId = "nonexistent";
  assert.throws(() => validateJawJamPreset(voice), TypeError);
  assert.throws(() => validateJawJamPreset({}), TypeError);
});

test("Jaw Jam dice is pure, reproducible, bounded and varies every field", () => {
  const initial = JAW_JAM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeJawJamPreset(initial, seed(5)), randomizeJawJamPreset(JAW_JAM_FULL_PRESETS[7].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(JAW_JAM_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = Object.fromEntries(["stepCount", "tempo", "swing", "breathRatio", "action", "midi", "vowelId", "soundPresetId",
    "pluckIntensity", "breathPower", "breathRateMultiplier"].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 100; i++) {
    const result = randomizeJawJamPreset(initial, random);
    validateJawJamPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.equal(result.pattern.steps[0].action, "pluck");
    for (const key of ["stepCount", "tempo", "swing", "breathRatio"]) seen[key].add(result.pattern[key]);
    for (const step of result.pattern.steps) for (const key of Object.keys(step)) seen[key].add(step[key]);
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(values.size >= 3, `${key} stays frozen`);
  assert.throws(() => randomizeJawJamPreset(initial, () => NaN), TypeError);
});
