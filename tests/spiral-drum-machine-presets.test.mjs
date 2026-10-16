import assert from "node:assert/strict";
import test from "node:test";
import { prototileIsNonOverlapping } from "../src/instruments/lattice/lattice.js";
import {
  SPIRAL_DRUM_FULL_PRESETS, SPIRAL_DRUM_PRESET_KEYS, captureSpiralDrumPreset,
  randomizeSpiralDrumPreset, validateSpiralDrumPreset,
} from "../src/instruments/spiral-drum-machine/full-presets.js";
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

test("Spiral Drums bank is complete, valid, safe and distinct", () => {
  validateFullPresetBank(SPIRAL_DRUM_FULL_PRESETS);
  assert.ok(SPIRAL_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of SPIRAL_DRUM_FULL_PRESETS) {
    const snapshot = preset.snapshot;
    assert.equal(validateSpiralDrumPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...SPIRAL_DRUM_PRESET_KEYS].sort());
    assert.equal(prototileIsNonOverlapping({ type: snapshot.tilingType, parameters: snapshot.parameters, edgeCurves: snapshot.edgeCurves }), true, preset.id);
    assert.ok(snapshot.spiralA + snapshot.spiralB > 0);
  }
  for (const key of ["timePath", "mappingMode", "motionMode", "sizeCoupling"]) {
    assert.ok(new Set(SPIRAL_DRUM_FULL_PRESETS.map(preset => preset.snapshot[key])).size >= 2, key);
  }
});

test("Spiral Drums capture ignores session state and validation rejects broken snapshots", () => {
  const live = { ...SPIRAL_DRUM_FULL_PRESETS[1].snapshot, output: .1, playing: true, loopPlaying: true, audioOn: true, position: .8, loopPhase: .3 };
  assert.deepEqual(captureSpiralDrumPreset(live), SPIRAL_DRUM_FULL_PRESETS[1].snapshot);
  assert.equal(captureSpiralDrumPreset({ spiralA: 0, spiralB: 0 }).spiralB, 1);
  assert.throws(() => validateSpiralDrumPreset(undefined), TypeError);
  assert.throws(() => validateSpiralDrumPreset({ ...SPIRAL_DRUM_FULL_PRESETS[0].snapshot, spiralA: 0, spiralB: 0 }), TypeError);
  assert.throws(() => validateSpiralDrumPreset({ ...SPIRAL_DRUM_FULL_PRESETS[0].snapshot, timePath: "nope" }), TypeError);
});

test("Spiral Drums dice is pure, reproducible, bounded and varies every field", () => {
  const initial = SPIRAL_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSpiralDrumPreset(initial, seed(5)), randomizeSpiralDrumPreset(SPIRAL_DRUM_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(SPIRAL_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(77), results = [];
  for (let i = 0; i < 96; i++) {
    const result = randomizeSpiralDrumPreset(initial, random);
    validateSpiralDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    results.push(result);
  }
  for (const key of SPIRAL_DRUM_PRESET_KEYS) {
    assert.ok(new Set(results.map(result => JSON.stringify(result[key]))).size > 1, `${key} stays frozen`);
  }
  for (const key of ["timePath", "mappingMode"]) assert.ok(new Set(results.map(result => result[key])).size === 3, key);
  assert.ok(new Set(results.map(result => result.sizeCoupling)).size === 2);
});
