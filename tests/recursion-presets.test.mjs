import assert from "node:assert/strict";
import test from "node:test";
import {
  RECURSION_FULL_PRESETS, RECURSION_RENDER_KEYS, captureRecursionPreset, randomizeRecursionPreset, validateRecursionPreset,
} from "../src/instruments/recursion/full-presets.js";
import { LIVE_AXIS_IDS } from "../src/instruments/recursion/recursion-live.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Recursion bank is complete, valid and leaves seed/transport out", () => {
  validateFullPresetBank(RECURSION_FULL_PRESETS);
  assert.ok(RECURSION_FULL_PRESETS.length >= 12);
  for (const preset of RECURSION_FULL_PRESETS) {
    assert.equal(validateRecursionPreset(preset.snapshot), preset.snapshot);
    for (const key of ["source", "level", "playing", "audio", "geometryView"]) assert.equal(key in preset.snapshot, false);
    assert.ok(Number.isInteger(preset.snapshot.depth));
  }
  assert.ok(RECURSION_FULL_PRESETS.some(p => !p.snapshot.accumulate));
  assert.throws(() => validateRecursionPreset({}), TypeError);
  const bad = structuredClone(RECURSION_FULL_PRESETS[1].snapshot);
  bad.live.memory = 4;
  assert.throws(() => validateRecursionPreset(bad), TypeError);
  assert.deepEqual(captureRecursionPreset({ ...RECURSION_FULL_PRESETS[2].snapshot, source: "mic" }), RECURSION_FULL_PRESETS[2].snapshot);
});

test("Recursion dice is pure, reproducible and varies every musical field", () => {
  const initial = RECURSION_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeRecursionPreset(initial, seed(5)), randomizeRecursionPreset(RECURSION_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(RECURSION_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (key, value) => (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeRecursionPreset(initial, random);
    validateRecursionPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of [...RECURSION_RENDER_KEYS, "accumulate"]) note(key, result[key]);
    for (const axis of LIVE_AXIS_IDS) note(`live.${axis}`, result.live[axis]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("depth").size === 8);
});
