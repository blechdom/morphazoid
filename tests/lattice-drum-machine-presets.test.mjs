import assert from "node:assert/strict";
import test from "node:test";
import { prototileIsNonOverlapping, tilingInfo } from "../src/instruments/lattice/lattice.js";
import {
  LATTICE_DRUM_FULL_PRESETS, LATTICE_DRUM_PRESET_KEYS, captureLatticeDrumPreset,
  randomizeLatticeDrumPreset, validateLatticeDrumPreset,
} from "../src/instruments/lattice-drum-machine/full-presets.js";
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

test("Lattice Drums bank is complete, valid, safe and distinct", () => {
  validateFullPresetBank(LATTICE_DRUM_FULL_PRESETS);
  assert.ok(LATTICE_DRUM_FULL_PRESETS.length >= 12);
  assert.deepEqual(LATTICE_DRUM_FULL_PRESETS[0].snapshot.tilingType, 20);
  for (const preset of LATTICE_DRUM_FULL_PRESETS) {
    const snapshot = preset.snapshot;
    assert.equal(validateLatticeDrumPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...LATTICE_DRUM_PRESET_KEYS].sort());
    assert.equal(prototileIsNonOverlapping({ type: snapshot.tilingType, parameters: snapshot.parameters, edgeCurves: snapshot.edgeCurves }), true, preset.id);
    assert.equal(snapshot.parameters.length, tilingInfo(snapshot.tilingType).defaultParameters.length);
  }
  assert.ok(new Set(LATTICE_DRUM_FULL_PRESETS.map(preset => preset.snapshot.mappingMode)).size >= 4);
  assert.ok(new Set(LATTICE_DRUM_FULL_PRESETS.map(preset => preset.snapshot.drumEngine)).size === 2);
});

test("Lattice Drums capture ignores session state and validation rejects broken snapshots", () => {
  const live = { ...LATTICE_DRUM_FULL_PRESETS[2].snapshot, output: .1, playing: true, audioOn: true, position: .9, continuousPosition: 4 };
  assert.deepEqual(captureLatticeDrumPreset(live), LATTICE_DRUM_FULL_PRESETS[2].snapshot);
  assert.throws(() => validateLatticeDrumPreset(null), TypeError);
  assert.throws(() => validateLatticeDrumPreset({ ...LATTICE_DRUM_FULL_PRESETS[0].snapshot, density: 5 }), TypeError);
  assert.throws(() => validateLatticeDrumPreset({ ...LATTICE_DRUM_FULL_PRESETS[0].snapshot, mappingMode: "nope" }), TypeError);
  assert.throws(() => validateLatticeDrumPreset({ ...LATTICE_DRUM_FULL_PRESETS[0].snapshot, parameters: [0, 0] }), TypeError);
  const overlapping = captureLatticeDrumPreset({ tilingType: 4, parameters: [9, -9, 9, -9, 9, -9], edgeCurves: [1, 1, 1, 1, 1] });
  assert.equal(prototileIsNonOverlapping({ type: 4, parameters: overlapping.parameters, edgeCurves: overlapping.edgeCurves }), true);
});

test("Lattice Drums dice is pure, reproducible, bounded and varies every field", () => {
  const initial = LATTICE_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeLatticeDrumPreset(initial, seed(5)), randomizeLatticeDrumPreset(LATTICE_DRUM_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  assert.throws(() => randomizeLatticeDrumPreset({ nope: true }), TypeError);
  const factory = new Set(LATTICE_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(77), results = [];
  for (let i = 0; i < 96; i++) {
    const result = randomizeLatticeDrumPreset(initial, random);
    validateLatticeDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.equal(prototileIsNonOverlapping({ type: result.tilingType, parameters: result.parameters, edgeCurves: result.edgeCurves }), true);
    results.push(result);
  }
  for (const key of LATTICE_DRUM_PRESET_KEYS) {
    const values = new Set(results.map(result => JSON.stringify(result[key])));
    assert.ok(values.size > 1, `${key} stays frozen`);
  }
  assert.ok(new Set(results.map(result => result.tilingType)).size > 20);
  assert.ok(new Set(results.map(result => result.mappingMode)).size === 4);
  assert.ok(new Set(results.map(result => result.drumEngine)).size === 2);
  assert.ok(new Set(results.map(result => result.motionMode)).size === 2);
});
