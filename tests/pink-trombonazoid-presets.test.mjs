import assert from "node:assert/strict";
import test from "node:test";
import { PINK_TROMBONAZOID_LANES, PINK_TROMBONAZOID_VOICE_PRESETS } from "../src/families/tract/pink-trombonazoid.js";
import {
  PINK_TROMBONAZOID_CONTROL_SPECS, PINK_TROMBONAZOID_FULL_PRESETS, capturePinkTrombonazoidPreset,
  defaultPinkLaneModulations, quantizePinkControl, randomizePinkTrombonazoidPreset, validatePinkTrombonazoidPreset,
} from "../src/instruments/pink-trombonazoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = (value, prefix = "") => (value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}${key}.`))
  : [[prefix, value]]);

test("Pink Trombonazoid bank is complete, valid and distinct", () => {
  validateFullPresetBank(PINK_TROMBONAZOID_FULL_PRESETS);
  const voices = new Set();
  for (const preset of PINK_TROMBONAZOID_FULL_PRESETS) {
    assert.equal(validatePinkTrombonazoidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot.modulation.lanes), PINK_TROMBONAZOID_LANES.map(({ id }) => id));
    voices.add(preset.snapshot.voicePreset);
    assert.equal(preset.snapshot.level, undefined);
  }
  assert.ok(voices.size >= 12);
  assert.ok(new Set(PINK_TROMBONAZOID_FULL_PRESETS.map(preset => preset.snapshot.text)).size >= 12);
  for (const id of voices) assert.ok(PINK_TROMBONAZOID_VOICE_PRESETS[id]);
  assert.deepEqual(PINK_TROMBONAZOID_FULL_PRESETS[0].snapshot.modulation.lanes, JSON.parse(JSON.stringify(
    capturePinkTrombonazoidPreset({ modulation: { lanes: defaultPinkLaneModulations() } }).modulation.lanes,
  )));
  assert.throws(() => validatePinkTrombonazoidPreset({}), TypeError);
  const bad = structuredClone(PINK_TROMBONAZOID_FULL_PRESETS[0].snapshot);
  bad.speechRate = 1.004;
  assert.throws(() => validatePinkTrombonazoidPreset(bad), TypeError);
});

test("Pink Trombonazoid values are quantized to their range-input steps", () => {
  for (const key of Object.keys(PINK_TROMBONAZOID_CONTROL_SPECS)) {
    const [lo, hi] = PINK_TROMBONAZOID_CONTROL_SPECS[key];
    assert.equal(quantizePinkControl(key, lo - 99), lo);
    assert.equal(quantizePinkControl(key, hi + 99), hi);
  }
  assert.equal(quantizePinkControl("speechRate", .8449), .84);
  assert.equal(quantizePinkControl("echoTime", 187), 185);
});

test("Pink Trombonazoid dice is pure, reproducible, bounded and varies every field", () => {
  const initial = PINK_TROMBONAZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizePinkTrombonazoidPreset(initial, seed(5)), randomizePinkTrombonazoidPreset(PINK_TROMBONAZOID_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(PINK_TROMBONAZOID_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizePinkTrombonazoidPreset(initial, random);
    validatePinkTrombonazoidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    if (result.voice.throatCount === 1) assert.equal(result.voice.spread, 0);
    if (result.voice.harmony === "shared") assert.equal(result.voice.detuneCents, 0);
    for (const [path, value] of flatten(result)) {
      if (!seen.has(path)) seen.set(path, new Set());
      seen.get(path).add(value);
    }
  }
  for (const [path, values] of seen) {
    if (/\.id\.$|\.[02]\.phase\.$/.test(path)) continue;
    assert.ok(values.size >= 2, `${path} stays frozen`);
  }
  for (const key of ["speechRate", "wordGap", "effects.drive", "effects.tone", "effects.echo", "effects.echoTime"]) {
    assert.ok(seen.get(`${key}.`).size > 20, `${key} barely varies`);
  }
});
