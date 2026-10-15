import assert from "node:assert/strict";
import test from "node:test";
import {
  RATTLESNAKE_SKIN_FULL_PRESETS, captureRattlesnakeSkinPreset, randomizeRattlesnakeSkinPreset, validateRattlesnakeSkinPreset,
} from "../src/instruments/rattlesnake-skin/full-presets.js";
import { createPaintMachineDemo } from "../src/instruments/rattlesnake-skin/linear-drums-machine.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({
  ...structuredClone(snapshot), selectedLayer: 2, tool: "ring", brushSize: 0.03, rangeMin: 20, output: 0.9,
  phase: 0.4, playing: true, audioOn: true, history: [[]], draft: null,
});

test("Rattlesnake Skin bank is complete, valid and musically varied", () => {
  validateFullPresetBank(RATTLESNAKE_SKIN_FULL_PRESETS);
  const withoutId = ({ id, ...rest }) => rest;
  assert.deepEqual(RATTLESNAKE_SKIN_FULL_PRESETS[0].snapshot.items.map(withoutId), createPaintMachineDemo().map(withoutId));
  for (const { snapshot } of RATTLESNAKE_SKIN_FULL_PRESETS) {
    assert.equal(validateRattlesnakeSkinPreset(snapshot), snapshot);
    assert.ok(snapshot.items.some(item => snapshot.layers[item.layer].role === "voice"));
  }
  const bank = RATTLESNAKE_SKIN_FULL_PRESETS.map(preset => preset.snapshot);
  assert.ok(new Set(bank.map(snapshot => snapshot.tempo)).size >= 10);
  assert.deepEqual([...new Set(bank.map(snapshot => snapshot.beats))].sort((a, b) => a - b), [4, 8, 16]);
  assert.ok(new Set(bank.flatMap(snapshot => snapshot.layers.map(layer => layer.presetId))).size >= 12);
  const duplicate = structuredClone(bank[1]);
  duplicate.items[1].id = duplicate.items[0].id;
  assert.throws(() => validateRattlesnakeSkinPreset(duplicate), TypeError);
  const outside = structuredClone(bank[1]);
  outside.items[0].x = 3;
  assert.throws(() => validateRattlesnakeSkinPreset(outside), TypeError);
  assert.throws(() => validateRattlesnakeSkinPreset({ ...bank[1], beats: 7 }), TypeError);
});

test("Rattlesnake Skin capture round-trips and excludes session and editing state", () => {
  for (const { snapshot } of RATTLESNAKE_SKIN_FULL_PRESETS) {
    const captured = captureRattlesnakeSkinPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["phase", "playing", "audioOn", "output", "tool", "selectedLayer", "brushSize", "history"]) assert.equal(key in captured, false);
  }
});

test("Rattlesnake Skin dice is pure, reproducible, valid and varies every musical field", () => {
  const initial = RATTLESNAKE_SKIN_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeRattlesnakeSkinPreset(initial, seed(5)), randomizeRattlesnakeSkinPreset(RATTLESNAKE_SKIN_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(RATTLESNAKE_SKIN_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = {
    tempo: new Set(), beats: new Set(), glissRate: new Set(), rangeMax: new Set(), role: new Set(), presetId: new Set(),
    target: new Set(), amount: new Set(), itemTypes: new Set(), itemCount: new Set(),
  };
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeRattlesnakeSkinPreset(initial, random);
    validateRattlesnakeSkinPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.layers.some(layer => layer.role === "voice"));
    assert.ok(result.items.length >= 1 && result.items.length < 200);
    for (const key of ["tempo", "beats", "glissRate", "rangeMax"]) seen[key].add(result[key]);
    for (const layer of result.layers) for (const key of ["role", "presetId", "target", "amount"]) seen[key].add(layer[key]);
    for (const item of result.items) seen.itemTypes.add(item.type);
    seen.itemCount.add(result.items.length);
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.equal(seen.itemTypes.size, 3);
  assert.equal(seen.beats.size, 3);
});
