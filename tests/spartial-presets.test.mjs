import assert from "node:assert/strict";
import test from "node:test";
import { SPARTIAL_DEFAULTS, sanitizeSpartialSettings } from "../src/instruments/spartial/spartial.js";
import {
  SPARTIAL_FULL_PRESETS, SPARTIAL_PRESET_KEYS, captureSpartialPreset, randomizeSpartialPreset,
  spartialSettingsPatch, validateSpartialPreset,
} from "../src/instruments/spartial/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("SPARTIAL bank is complete, valid and distinct", () => {
  validateFullPresetBank(SPARTIAL_FULL_PRESETS);
  assert.ok(SPARTIAL_FULL_PRESETS.length >= 12);
  for (const preset of SPARTIAL_FULL_PRESETS) assert.equal(validateSpartialPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateSpartialPreset({}), TypeError);
  const bad = structuredClone(SPARTIAL_FULL_PRESETS[1].snapshot);
  bad.settings.attack = 99;
  assert.throws(() => validateSpartialPreset(bad), TypeError);
});

test("SPARTIAL capture round-trips and excludes session state", () => {
  for (const preset of SPARTIAL_FULL_PRESETS) {
    const state = { ...structuredClone(preset.snapshot), settings: sanitizeSpartialSettings({
      ...spartialSettingsPatch(preset.snapshot), level: 0.2, speakerCount: 6, rotation: 0.5, granularSource: "file", grainFreeze: true,
    }) };
    assert.deepEqual(captureSpartialPreset(state), preset.snapshot);
  }
  for (const key of ["level", "speakerCount", "rotation", "granularSource", "grainFreeze"]) {
    assert.equal(SPARTIAL_PRESET_KEYS.includes(key), false);
  }
  assert.equal(spartialSettingsPatch(SPARTIAL_FULL_PRESETS[0].snapshot).lock, 0);
});

test("SPARTIAL dice is pure, reproducible, bounded and varies every musical field", () => {
  const initial = SPARTIAL_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSpartialPreset(initial, seed(5)), randomizeSpartialPreset(SPARTIAL_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SPARTIAL_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(91), seen = new Map(), top = new Map();
  for (let i = 0; i < 300; i++) {
    const result = randomizeSpartialPreset(initial, random);
    validateSpartialPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.ok(result.settings.target < 4);
    for (const key of ["mode", "chord", "motion", "beatsPerTurn", "routingMode", "chordIntervals"]) (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(JSON.stringify(result[key]));
    for (const key of SPARTIAL_PRESET_KEYS) (top.get(key) ?? top.set(key, new Set()).get(key)).add(JSON.stringify(result.settings[key]));
  }
  for (const [key, values] of [...seen, ...top]) assert.ok(values.size > 1, `${key} stays frozen`);
  assert.ok(SPARTIAL_DEFAULTS.partials);
});
