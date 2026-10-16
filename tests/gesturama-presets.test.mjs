import assert from "node:assert/strict";
import test from "node:test";
import {
  GESTURAMA_FULL_PRESETS, captureGesturamaPreset, gesturamaNoteName, randomizeGesturamaPreset, validateGesturamaPreset,
} from "../src/instruments/gesturama/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Gesturama bank is complete, valid and input-free", () => {
  validateFullPresetBank(GESTURAMA_FULL_PRESETS);
  assert.ok(GESTURAMA_FULL_PRESETS.length >= 12);
  assert.equal(new Set(GESTURAMA_FULL_PRESETS.map(p => p.snapshot.mode)).size, 3);
  for (const preset of GESTURAMA_FULL_PRESETS) {
    assert.equal(validateGesturamaPreset(preset.snapshot), preset.snapshot);
    assert.equal(JSON.stringify(preset.snapshot).includes("sample"), false);
    for (const key of ["camera", "mirrored", "volume", "trackedColor", "source"]) assert.equal(key in preset.snapshot, false);
  }
  assert.throws(() => validateGesturamaPreset({}), TypeError);
  const bad = structuredClone(GESTURAMA_FULL_PRESETS[0].snapshot);
  bad.grid[3] = "sample";
  assert.throws(() => validateGesturamaPreset(bad), TypeError);
  assert.equal(gesturamaNoteName(61), "C♯4");
  const live = captureGesturamaPreset({ ...GESTURAMA_FULL_PRESETS[4].snapshot, zones: GESTURAMA_FULL_PRESETS[4].snapshot.zones.map((z, i) => ({ ...z, id: i + 9 })) });
  assert.deepEqual(live, GESTURAMA_FULL_PRESETS[4].snapshot);
});

test("Gesturama dice is pure, reproducible and varies every musical field", () => {
  const initial = GESTURAMA_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeGesturamaPreset(initial, seed(5)), randomizeGesturamaPreset(GESTURAMA_FULL_PRESETS[9].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(GESTURAMA_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = { mode: new Set(), sensitivity: new Set(), zones: new Set() };
  const cells = Array.from({ length: 12 }, () => new Set()), strings = Array.from({ length: 12 }, () => new Set()), pads = Array.from({ length: 12 }, () => new Set());
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeGesturamaPreset(initial, random);
    validateGesturamaPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    seen.mode.add(result.mode); seen.sensitivity.add(result.sensitivity); seen.zones.add(result.zones.length);
    result.grid.forEach((v, k) => cells[k].add(v)); result.harp.forEach((v, k) => strings[k].add(v)); result.padSemitones.forEach((v, k) => pads[k].add(v));
  }
  assert.equal(seen.mode.size, 3);
  assert.ok(seen.sensitivity.size > 10 && seen.zones.size > 3);
  for (const set of [...cells, ...strings, ...pads]) assert.ok(set.size >= 2, "a per-slot field stays frozen");
});
