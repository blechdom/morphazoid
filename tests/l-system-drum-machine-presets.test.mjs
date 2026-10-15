import assert from "node:assert/strict";
import test from "node:test";
import { L_SYSTEM_PRESETS, traceLSystem } from "../src/instruments/l-system/l-system.js";
import {
  L_SYSTEM_DRUM_FULL_PRESETS, L_SYSTEM_DRUM_PRESET_KEYS, captureLSystemDrumPreset,
  randomizeLSystemDrumPreset, validateLSystemDrumPreset,
} from "../src/instruments/l-system-drum-machine/full-presets.js";
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

const systems = new Map(L_SYSTEM_PRESETS.map(system => [system.id, system]));
const traces = snapshot => traceLSystem({
  ...systems.get(snapshot.systemId), iterations: snapshot.iterations, angle: snapshot.angle,
  turnAsymmetry: snapshot.turnAsymmetry, lengthScale: snapshot.lengthScale,
});

test("L-System Drums bank is complete, valid, drawable and distinct", () => {
  validateFullPresetBank(L_SYSTEM_DRUM_FULL_PRESETS);
  assert.ok(L_SYSTEM_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of L_SYSTEM_DRUM_FULL_PRESETS) {
    const snapshot = preset.snapshot;
    assert.equal(validateLSystemDrumPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...L_SYSTEM_DRUM_PRESET_KEYS].sort());
    assert.doesNotThrow(() => traces(snapshot), preset.id);
  }
  assert.ok(new Set(L_SYSTEM_DRUM_FULL_PRESETS.map(preset => preset.snapshot.systemId)).size >= 10);
  assert.equal(new Set(L_SYSTEM_DRUM_FULL_PRESETS.map(preset => preset.snapshot.percussionStyle)).size, 4);
});

test("L-System Drums capture ignores session state, clamps iterations per grammar and rejects broken snapshots", () => {
  const live = { ...L_SYSTEM_DRUM_FULL_PRESETS[1].snapshot, output: .2, playing: true, audio: true, position: .7 };
  assert.deepEqual(captureLSystemDrumPreset(live), L_SYSTEM_DRUM_FULL_PRESETS[1].snapshot);
  assert.equal(captureLSystemDrumPreset({ systemId: "koch", iterations: 12 }).iterations, 5);
  assert.throws(() => validateLSystemDrumPreset(null), TypeError);
  assert.throws(() => validateLSystemDrumPreset({ ...L_SYSTEM_DRUM_FULL_PRESETS[0].snapshot, iterations: 99 }), TypeError);
  assert.throws(() => validateLSystemDrumPreset({ ...L_SYSTEM_DRUM_FULL_PRESETS[0].snapshot, structureMode: "nope" }), TypeError);
});

test("L-System Drums dice is pure, reproducible, bounded, drawable and varies every field", () => {
  const initial = L_SYSTEM_DRUM_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeLSystemDrumPreset(initial, seed(5)), randomizeLSystemDrumPreset(L_SYSTEM_DRUM_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(L_SYSTEM_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(77), results = [];
  for (let i = 0; i < 96; i++) {
    const result = randomizeLSystemDrumPreset(initial, random);
    validateLSystemDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    results.push(result);
  }
  for (const result of results.slice(0, 24)) assert.doesNotThrow(() => traces(result));
  for (const key of L_SYSTEM_DRUM_PRESET_KEYS) {
    assert.ok(new Set(results.map(result => JSON.stringify(result[key]))).size > 1, `${key} stays frozen`);
  }
  assert.equal(new Set(results.map(result => result.systemId)).size, L_SYSTEM_PRESETS.length);
  assert.equal(new Set(results.map(result => result.percussionStyle)).size, 4);
  assert.equal(new Set(results.map(result => result.structureMode)).size, 5);
});
