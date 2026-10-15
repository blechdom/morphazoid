import assert from "node:assert/strict";
import test from "node:test";
import {
  LUMBER_FULL_PRESETS, LUMBER_RING_SLOTS, captureLumberPreset, randomizeLumberPreset, validateLumberPreset,
} from "../src/instruments/lumber/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

const leaves = (value, path = "") => {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
  return [[path, value]];
};

test("Lumber bank is complete, valid, distinct and has no session state", () => {
  validateFullPresetBank(LUMBER_FULL_PRESETS);
  assert.ok(LUMBER_FULL_PRESETS.length >= 12);
  for (const preset of LUMBER_FULL_PRESETS) {
    assert.equal(validateLumberPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.rings.length, LUMBER_RING_SLOTS);
    assert.deepEqual(captureLumberPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.rings[0].timingMode, "free");
  }
  const forbidden = /mic|gain|device|permission|sample|buffer|^\.level|muted|solo|phase|tilt|yaw/i;
  for (const [path] of leaves(LUMBER_FULL_PRESETS[0].snapshot)) {
    assert.equal(forbidden.test(path), false, path);
  }
  assert.throws(() => validateLumberPreset({}), TypeError);
  const bad = structuredClone(LUMBER_FULL_PRESETS[1].snapshot);
  bad.rings[1].filterTone = 4;
  assert.throws(() => validateLumberPreset(bad), TypeError);
  const loose = structuredClone(LUMBER_FULL_PRESETS[1].snapshot);
  loose.rings[2].headOffsets = [0, 0.5];
  assert.throws(() => validateLumberPreset(loose), TypeError);
});

test("Lumber dice is pure, reproducible, bounded and moves every field", () => {
  const initial = LUMBER_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeLumberPreset(initial, seed(3)), randomizeLumberPreset(LUMBER_FULL_PRESETS[5].snapshot, seed(3)));
  assert.deepEqual(initial, before);
  const bank = new Set(LUMBER_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(2024);
  for (let i = 0; i < 80; i++) {
    const result = randomizeLumberPreset(initial, random);
    validateLumberPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const [path, value] of leaves(result)) {
      const key = path.replace(/\[\d+\]/g, "[]");
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(value);
    }
  }
  for (const [key, values] of seen) {
    assert.ok(values.size >= 2, `${key} stays frozen`);
  }
  for (const key of [".rings[].volume", ".rings[].filterTone", ".rings[].pan", ".delay.spread"]) {
    assert.ok(seen.get(key).size > 30, `${key} barely moves`);
  }
  assert.throws(() => randomizeLumberPreset(initial, () => Infinity), TypeError);
});
