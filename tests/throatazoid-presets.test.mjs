import assert from "node:assert/strict";
import test from "node:test";
import { SPECIMENS, VOICE_PRESETS } from "../src/families/tract/throatazoid.js";
import {
  THROATAZOID_FULL_PRESETS, THROATAZOID_PRESET_KEYS, THROATAZOID_SCALAR_KEYS,
  captureThroatazoidPreset, randomizeThroatazoidPreset, throatazoidPresetEntryForSnapshot, validateThroatazoidPreset,
} from "../src/instruments/throatazoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = (value, prefix = "") => (value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}${key}.`))
  : [[prefix, value]]);

test("Throatazoid bank covers every voice and anatomy, valid and distinct", () => {
  validateFullPresetBank(THROATAZOID_FULL_PRESETS);
  assert.equal(THROATAZOID_FULL_PRESETS.length, Object.keys(VOICE_PRESETS).length + Object.keys(SPECIMENS).length);
  for (const preset of THROATAZOID_FULL_PRESETS) {
    assert.equal(validateThroatazoidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...THROATAZOID_PRESET_KEYS].sort());
    assert.equal(throatazoidPresetEntryForSnapshot(preset.snapshot).id, preset.id);
  }
  assert.throws(() => validateThroatazoidPreset({}), TypeError);
  const bad = structuredClone(THROATAZOID_FULL_PRESETS[0].snapshot);
  bad.tension = 4;
  assert.throws(() => validateThroatazoidPreset(bad), TypeError);
});

test("Throatazoid snapshots exclude microphone and session state", () => {
  const session = ["sourceMode", "mic", "inputTrim", "inputStability", "level", "awake", "recording", "starting", "typingMode", "voicePreset"];
  for (const key of session) assert.equal(THROATAZOID_PRESET_KEYS.includes(key), false, key);
  const captured = captureThroatazoidPreset({ ...THROATAZOID_FULL_PRESETS[2].snapshot, sourceMode: "mic", mic: true, inputTrim: 1.4, level: .7 });
  assert.deepEqual(captured, THROATAZOID_FULL_PRESETS[2].snapshot);
});

test("Throatazoid dice is pure, reproducible, bounded and varies every field", () => {
  const initial = THROATAZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeThroatazoidPreset(initial, seed(5)), randomizeThroatazoidPreset(THROATAZOID_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(THROATAZOID_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeThroatazoidPreset(initial, random);
    validateThroatazoidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.equal(result.specimen, "mutant");
    if (result.classicTopology) assert.equal(result.throatCount, 1);
    assert.ok(result.throats.slice(0, result.throatCount).some(throat => !throat.muted));
    assert.ok(result.pressureSources[0].open);
    for (const [path, value] of flatten(result)) {
      if (!seen.has(path)) seen.set(path, new Set());
      seen.get(path).add(value);
    }
  }
  for (const key of THROATAZOID_SCALAR_KEYS) assert.ok(seen.get(`${key}.`).size > 50, `${key} barely varies`);
  for (const [path, values] of seen) {
    if (["specimen.", "articulationManner.", "pressureSources.0.open."].includes(path)) continue;
    assert.ok(values.size >= 2, `${path} stays frozen`);
  }
});
