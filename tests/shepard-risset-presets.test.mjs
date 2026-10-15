import assert from "node:assert/strict";
import test from "node:test";
import {
  SHEPARD_FULL_PRESETS, SHEPARD_MORPHISMA_KEYS, SHEPARD_OCTAVE_KEYS, captureShepardPreset,
  randomizeShepardPreset, validateShepardPreset,
} from "../src/instruments/shepard-risset/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Shepard-Risset bank is complete, valid and covers both modes", () => {
  validateFullPresetBank(SHEPARD_FULL_PRESETS);
  for (const preset of SHEPARD_FULL_PRESETS) assert.equal(validateShepardPreset(preset.snapshot), preset.snapshot);
  assert.ok(new Set(SHEPARD_FULL_PRESETS.map(preset => preset.snapshot.mode)).size === 2);
  assert.throws(() => validateShepardPreset({ mode: "octave" }), TypeError);
  const bad = structuredClone(SHEPARD_FULL_PRESETS[0].snapshot);
  bad.octave.width = 99;
  assert.throws(() => validateShepardPreset(bad), TypeError);
});

test("Shepard-Risset capture ignores level and preset memory", () => {
  const preset = SHEPARD_FULL_PRESETS[2].snapshot;
  const state = { ...structuredClone(preset), level: 0.1, audioOn: true, octave: { ...preset.octave, presetId: "x", speed: preset.octave.speed } };
  assert.deepEqual(captureShepardPreset(state), preset);
  assert.deepEqual(Object.keys(preset.octave).sort(), [...SHEPARD_OCTAVE_KEYS].sort());
  assert.deepEqual(Object.keys(preset.morphisma).sort(), [...SHEPARD_MORPHISMA_KEYS].sort());
});

test("Shepard-Risset dice is pure, reproducible and varies every field", () => {
  const initial = SHEPARD_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeShepardPreset(initial, seed(5)), randomizeShepardPreset(SHEPARD_FULL_PRESETS[9].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SHEPARD_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(33), seen = new Map();
  for (let i = 0; i < 200; i++) {
    const result = randomizeShepardPreset(initial, random);
    validateShepardPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    const flat = { mode: result.mode, ...Object.fromEntries(Object.entries(result.octave).map(([k, v]) => [`octave.${k}`, v])), ...Object.fromEntries(Object.entries(result.morphisma).map(([k, v]) => [`morphisma.${k}`, v])) };
    for (const [key, value] of Object.entries(flat)) (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
  }
  assert.equal(seen.size, 1 + SHEPARD_OCTAVE_KEYS.length + SHEPARD_MORPHISMA_KEYS.length);
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});
