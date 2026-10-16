import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import { Loopini } from "../src/instruments/loopini/loopini.js";
import {
  LOOPINI_FULL_PRESETS, captureLoopiniPreset, captureLoopiniWithHeld, randomizeLoopiniPreset, validateLoopiniPreset,
} from "../src/instruments/loopini/full-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const distinct = values => new Set(values).size;

test("Loopini bank is complete, valid and distinct", () => {
  validateFullPresetBank(LOOPINI_FULL_PRESETS);
  for (const preset of LOOPINI_FULL_PRESETS) {
    assert.equal(validateLoopiniPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureLoopiniPreset(preset.snapshot), preset.snapshot);
    assert.ok(preset.snapshot.slots.some(slot => slot.on));
  }
  assert.throws(() => validateLoopiniPreset({ speed: 1, slots: [] }), TypeError);
  assert.throws(() => validateLoopiniPreset({ ...LOOPINI_FULL_PRESETS[0].snapshot, speed: 9 }), TypeError);
});

test("Loopini recall changes only speed and circle switches, never the recorded audio", () => {
  const engine = new Loopini(24000);
  assert.ok(engine.loadDemo());
  const audio = engine.slots.map(slot => slot.samples && Float32Array.from(slot.samples));
  const { length } = engine;
  let held = null;
  for (const preset of LOOPINI_FULL_PRESETS) {
    engine.setSpeed(preset.snapshot.speed);
    preset.snapshot.slots.forEach((slot, id) => { if (engine.slots[id].samples && engine.slots[id].on !== slot.on) engine.toggle(id); });
    held = preset.snapshot;
    const state = engine.snapshot();
    assert.deepEqual(captureLoopiniWithHeld(state.speed, state.slots, held), preset.snapshot, preset.id);
  }
  assert.deepEqual(engine.slots.map(slot => slot.samples && Array.from(slot.samples.slice(0, 64))), audio.map(samples => samples && Array.from(samples.slice(0, 64))));
  assert.equal(engine.length, length);
  assert.equal(engine.filled(), 3);
  assert.equal(engine.recording, null);
});

test("Loopini empty circles keep the last recalled choice so recall round-trips", () => {
  const snapshot = LOOPINI_FULL_PRESETS.find(preset => preset.id === "solo-first").snapshot;
  const empty = Array.from({ length: 6 }, (_, id) => ({ id, filled: false, on: true }));
  assert.deepEqual(captureLoopiniWithHeld(0.85, empty, snapshot), snapshot);
  assert.deepEqual(captureLoopiniWithHeld(0.85, empty, null).slots.map(slot => slot.on), Array(6).fill(true));
});

test("Loopini dice is pure, seedable, new and varies speed and every circle", () => {
  const initial = LOOPINI_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeLoopiniPreset(initial, seed(4)), randomizeLoopiniPreset(LOOPINI_FULL_PRESETS[6].snapshot, seed(4)));
  assert.deepEqual(initial, before);
  const known = new Set(LOOPINI_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(15), speeds = [], per = Array.from({ length: 6 }, () => new Set());
  for (let i = 0; i < 80; i++) {
    const result = validateLoopiniPreset(randomizeLoopiniPreset(initial, random));
    assert.equal(known.has(presetStateKey(result)), false);
    assert.ok(result.slots.some(slot => slot.on));
    speeds.push(result.speed);
    result.slots.forEach((slot, id) => per[id].add(slot.on));
  }
  assert.ok(distinct(speeds) > 30);
  for (const values of per) assert.equal(values.size, 2);
});
