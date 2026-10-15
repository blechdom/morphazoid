import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPHS_FULL_PRESETS, GRAPHS_VOICE_KEYS, captureGraphsPreset, randomizeGraphsPreset, validateGraphsPreset,
} from "../src/instruments/graphs/full-presets.js";
import { graphInstrumentDefaultState } from "../src/instruments/graphs/graphs-state.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const MODES = ["synth", "drums", "mic"];
const flatten = snapshot => ({
  ...snapshot.graph, ...snapshot.motion, ...(snapshot.clock ?? {}), ...snapshot.voice,
  positions: undefined, routes: undefined,
});

test("Graphs bank is complete, valid and distinct for every playing mode", () => {
  validateFullPresetBank(GRAPHS_FULL_PRESETS);
  for (const mode of MODES) {
    const bank = GRAPHS_FULL_PRESETS.filter(preset => preset.snapshot.mode === mode);
    assert.ok(bank.length >= 12, `${mode} has ${bank.length} presets`);
    assert.equal(new Set(bank.map(preset => presetStateKey(preset.snapshot))).size, bank.length);
    assert.ok(new Set(bank.map(preset => preset.snapshot.graph.topology)).size >= 5);
    for (const preset of bank) assert.deepEqual(validateGraphsPreset(preset.snapshot), preset.snapshot);
  }
});

test("Graphs scenes exclude session and microphone state", () => {
  const keys = JSON.stringify(GRAPHS_FULL_PRESETS.map(preset => preset.snapshot));
  for (const forbidden of ["inputTrim", "baseFrequency", "audio", "output", "playing", "microphone", "device"]) {
    assert.equal(keys.includes(`"${forbidden}"`), false, forbidden);
  }
  for (const mode of MODES) assert.equal(GRAPHS_VOICE_KEYS[mode].includes("inputTrim"), false);
  assert.equal(GRAPHS_FULL_PRESETS.find(preset => preset.snapshot.mode === "mic").snapshot.clock, null);
});

test("Graphs capture round-trips a bank scene and ignores unrelated state", () => {
  for (const preset of GRAPHS_FULL_PRESETS) {
    const { snapshot } = preset;
    const state = {
      ...graphInstrumentDefaultState("synth"), ...snapshot.graph, ...snapshot.motion, ...(snapshot.clock ?? {}),
      ...snapshot.voice, output: 0.11, audio: true, playing: true, inputTrim: 1.4,
    };
    const nodes = snapshot.graph.positions.map(([x, y]) => ({ x, y }));
    assert.deepEqual(captureGraphsPreset({ mode: snapshot.mode, state, nodes, routes: snapshot.graph.routes }), snapshot);
  }
});

test("Graphs validation rejects incomplete, out-of-range and mismatched scenes", () => {
  const base = structuredClone(GRAPHS_FULL_PRESETS[0].snapshot);
  const bad = mutate => { const copy = structuredClone(base); mutate(copy); return copy; };
  assert.throws(() => validateGraphsPreset({}), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.graph.nodeCount = 99; })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.graph.positions.pop(); })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.graph.routes.pop(); })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.voice.soundMode = "noise"; })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.voice.inputTrim = 0.5; })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.motion.nodeMoving = "yes"; })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.clock = null; })), TypeError);
  assert.throws(() => validateGraphsPreset(bad(s => { s.graph.positions[0][0] = Number.NaN; })), TypeError);
});

for (const mode of MODES) {
  test(`Graphs ${mode} dice is pure, reproducible, bounded and varies every field`, () => {
    const initial = GRAPHS_FULL_PRESETS.find(preset => preset.snapshot.mode === mode).snapshot;
    const before = structuredClone(initial);
    const other = GRAPHS_FULL_PRESETS.filter(preset => preset.snapshot.mode === mode)[3].snapshot;
    assert.deepEqual(randomizeGraphsPreset(initial, seed(5)), randomizeGraphsPreset(other, seed(5)));
    assert.deepEqual(initial, before);
    const existing = new Set(GRAPHS_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map();
    const random = seed(41);
    for (let i = 0; i < 120; i++) {
      const result = randomizeGraphsPreset(initial, random);
      validateGraphsPreset(result);
      assert.equal(result.mode, mode);
      assert.equal(existing.has(presetStateKey(result)), false);
      for (const [key, value] of Object.entries(flatten(result))) {
        if (value === undefined) continue;
        seen.has(key) || seen.set(key, new Set());
        seen.get(key).add(value);
      }
      seen.has("positions") || seen.set("positions", new Set());
      seen.get("positions").add(JSON.stringify(result.graph.positions));
      seen.has("routes") || seen.set("routes", new Set());
      seen.get("routes").add(JSON.stringify(result.graph.routes));
    }
    const small = { topology: 10, nodeMoving: 2, nodeMotionMode: 3, pulseDivision: 4, triggerScope: 2, attackLaneCount: 3, tuningMode: 3,
      articulation: 2, soundMode: 7, mappingMode: mode === "synth" ? 4 : 3, percussionStyle: 8 };
    for (const [key, values] of seen) {
      assert.ok(values.size >= Math.min(small[key] ?? 20, 20), `${mode}.${key} stays frozen (${values.size})`);
    }
    assert.ok(seen.size >= 20);
  });
}

test("Graphs dice honors reduced motion and keeps the playing mode", () => {
  const initial = GRAPHS_FULL_PRESETS[0].snapshot, random = seed(9);
  for (let i = 0; i < 60; i++) {
    assert.equal(randomizeGraphsPreset(initial, random, { allowMotion: false }).motion.nodeMoving, false);
  }
  const moving = new Set();
  for (let i = 0; i < 60; i++) moving.add(randomizeGraphsPreset(initial, random).motion.nodeMoving);
  assert.deepEqual([...moving].sort(), [false, true]);
});
