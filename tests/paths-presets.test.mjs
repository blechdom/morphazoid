import assert from "node:assert/strict";
import test from "node:test";
import { PATH_FAMILIES, generatePath, sanitizePathSettings } from "../src/instruments/paths/paths.js";
import {
  PATH_CHOICES, PATH_FULL_PRESETS, PATH_PRESET_KEYS, capturePathPreset, randomizePathPreset, validatePathPreset,
} from "../src/instruments/paths/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Paths bank is complete, valid and generates real paths", () => {
  validateFullPresetBank(PATH_FULL_PRESETS);
  for (const { snapshot } of PATH_FULL_PRESETS) {
    assert.equal(validatePathPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...PATH_PRESET_KEYS].sort());
    const settings = sanitizePathSettings(snapshot);
    for (const key of Object.keys(settings)) assert.equal(settings[key], snapshot[key]);
    assert.ok(generatePath(settings).points.length > 1);
  }
  assert.equal(new Set(PATH_FULL_PRESETS.map(p => p.snapshot.family)).size, PATH_FAMILIES.length);
  assert.throws(() => validatePathPreset({ ...PATH_FULL_PRESETS[0].snapshot, family: "spiral" }), TypeError);
  assert.throws(() => validatePathPreset({ ...PATH_FULL_PRESETS[0].snapshot, family: "gosper", detail: 6 }), TypeError);
  assert.throws(() => validatePathPreset({ ...PATH_FULL_PRESETS[0].snapshot, headCount: 9 }), TypeError);
});

test("Paths capture round-trips and excludes session state", () => {
  for (const { snapshot } of PATH_FULL_PRESETS) {
    const captured = capturePathPreset({ ...snapshot, level: 0.9, audio: true, playing: false, position: 0.5, path: {} });
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["level", "audio", "playing", "position", "path"]) assert.equal(key in captured, false);
  }
});

test("Paths dice is pure, reproducible, valid and varies every field", () => {
  const initial = PATH_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizePathPreset(initial, seed(5)), randomizePathPreset(PATH_FULL_PRESETS[7].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(PATH_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(PATH_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 300; i++) {
    const result = randomizePathPreset(initial, random);
    validatePathPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.equal(sanitizePathSettings(result).detail, result.detail);
    for (const key of PATH_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  for (const [key, values] of Object.entries(PATH_CHOICES)) assert.equal(seen.get(key).size, values.length, key);
});
