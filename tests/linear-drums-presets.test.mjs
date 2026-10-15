import assert from "node:assert/strict";
import test from "node:test";
import { LINEAR_DRUM_PARAMETER_SPECS } from "../src/instruments/linear-drums/linear-drums.js";
import {
  LINEAR_DRUM_FULL_PRESETS, LINEAR_DRUM_PRESET_KEYS, captureLinearDrumPreset,
  randomizeLinearDrumPreset, validateLinearDrumPreset,
} from "../src/instruments/linear-drums/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const leaves = (value, path = "") => (value !== null && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`))
  : [[path, value]]);
function collectLeafValues(results) {
  const seen = new Map();
  for (const result of results) for (const [path, value] of leaves(result)) {
    if (!seen.has(path)) seen.set(path, new Set());
    seen.get(path).add(JSON.stringify(value));
  }
  return seen;
}

test("Rattlesnake bank is complete, valid and distinct", () => {
  validateFullPresetBank(LINEAR_DRUM_FULL_PRESETS);
  assert.ok(LINEAR_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of LINEAR_DRUM_FULL_PRESETS) {
    assert.equal(validateLinearDrumPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...LINEAR_DRUM_PRESET_KEYS].sort());
    assert.equal(Object.keys(preset.snapshot.parameterMaps).length, LINEAR_DRUM_PARAMETER_SPECS.length);
  }
  assert.ok(new Set(LINEAR_DRUM_FULL_PRESETS.map(preset => preset.snapshot.model)).size >= 4);
  assert.ok(new Set(LINEAR_DRUM_FULL_PRESETS.map(preset => preset.snapshot.sweepMode)).size === 3);
});

test("Rattlesnake capture ignores session and live-sweep state and validation rejects broken snapshots", () => {
  const live = {
    ...LINEAR_DRUM_FULL_PRESETS[9].snapshot, position: .8, performanceY: .1, output: .2, sweeping: true,
    audioOn: true, sweepDirection: -1, selectedPresetId: "x",
  };
  assert.deepEqual(captureLinearDrumPreset(live), LINEAR_DRUM_FULL_PRESETS[9].snapshot);
  assert.throws(() => validateLinearDrumPreset(null), TypeError);
  assert.throws(() => validateLinearDrumPreset({ ...LINEAR_DRUM_FULL_PRESETS[0].snapshot, decay: 99 }), TypeError);
  assert.throws(() => validateLinearDrumPreset({ ...LINEAR_DRUM_FULL_PRESETS[0].snapshot, sweepMode: "sideways" }), TypeError);
});

test("Rattlesnake dice is pure, reproducible, bounded and varies every field", () => {
  const initial = LINEAR_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeLinearDrumPreset(initial, seed(5)), randomizeLinearDrumPreset(LINEAR_DRUM_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(LINEAR_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(77), results = [];
  for (let i = 0; i < 96; i++) {
    const result = randomizeLinearDrumPreset(initial, random);
    validateLinearDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    results.push(result);
  }
  const seen = collectLeafValues(results);
  for (const [path, values] of seen) assert.ok(values.size > 1, `${path} stays frozen`);
  assert.equal(new Set(results.map(result => result.model)).size, 5);
  assert.equal(new Set(results.map(result => result.sweepMode)).size, 3);
  for (const spec of LINEAR_DRUM_PARAMETER_SPECS) {
    assert.equal(new Set(results.map(result => result.parameterMaps[spec.id].enabled)).size, 2, spec.id);
    assert.equal(new Set(results.map(result => result.parameterMaps[spec.id].source)).size, 2, spec.id);
  }
});
