import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPH_DRUM_FULL_PRESETS, GRAPH_DRUM_PARAMETER_KEYS, captureGraphDrumPreset, graphDrumSceneGraph,
  randomizeGraphDrumPreset, sanitizeGraphDrumPreset, validateGraphDrumPreset,
} from "../src/families/graph-presets/drum-full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const initial = GRAPH_DRUM_FULL_PRESETS[0].snapshot;

test("Graph Drum Machine bank is complete, valid and distinct", () => {
  validateFullPresetBank(GRAPH_DRUM_FULL_PRESETS);
  assert.ok(GRAPH_DRUM_FULL_PRESETS.length >= 12);
  for (const preset of GRAPH_DRUM_FULL_PRESETS) {
    const { snapshot } = preset;
    assert.equal(validateGraphDrumPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot.parameters).sort(), [...GRAPH_DRUM_PARAMETER_KEYS].sort());
    assert.equal(snapshot.nodes.length, snapshot.parameters.nodeCount);
    const { graph, edgeSwitches } = graphDrumSceneGraph(snapshot);
    assert.deepEqual(captureGraphDrumPreset(snapshot.parameters, graph, edgeSwitches), snapshot);
  }
  assert.ok(new Set(GRAPH_DRUM_FULL_PRESETS.map(preset => preset.snapshot.parameters.percussionStyle)).size >= 5);
  assert.ok(GRAPH_DRUM_FULL_PRESETS.some(preset => Object.values(preset.snapshot.edgeSwitches).includes(false)));
  assert.throws(() => validateGraphDrumPreset({}), TypeError);
  assert.throws(() => validateGraphDrumPreset({ ...initial, parameters: { ...initial.parameters, tempo: 999 } }), TypeError);
  assert.throws(() => validateGraphDrumPreset({ ...initial, nodes: initial.nodes.slice(1) }), TypeError);
  assert.throws(() => validateGraphDrumPreset({ ...initial, edgeSwitches: {} }), TypeError);
});

test("Graph capture excludes session state and keeps live edits valid", () => {
  const live = { ...initial.parameters, audio: true, playing: true, output: 0.1, nodeMotionPhase: 3, graphPatch: "x" };
  const { graph, edgeSwitches } = graphDrumSceneGraph(initial);
  const captured = captureGraphDrumPreset(live, graph, edgeSwitches);
  assert.deepEqual(captured, initial);
  for (const key of ["audio", "playing", "output", "nodeMotionPhase", "graphPatch"]) assert.equal(key in captured.parameters, false);
  graph.nodes[0].x = 0.123456789;
  const edited = captureGraphDrumPreset(live, graph, edgeSwitches);
  assert.equal(edited.nodes[0][0], 0.123);
  assert.equal(validateGraphDrumPreset(edited), edited);
  assert.deepEqual(sanitizeGraphDrumPreset(edited), edited);
});

test("Graph dice is pure, reproducible and varies every musical field", () => {
  const before = structuredClone(initial);
  assert.deepEqual(randomizeGraphDrumPreset(initial, seed(5)), randomizeGraphDrumPreset(GRAPH_DRUM_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  assert.throws(() => randomizeGraphDrumPreset({}, seed(1)), TypeError);
  const factory = new Set(GRAPH_DRUM_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(GRAPH_DRUM_PARAMETER_KEYS.map(key => [key, new Set()]));
  const positions = new Set(), gates = new Set();
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeGraphDrumPreset(initial, random);
    validateGraphDrumPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(Object.values(result.edgeSwitches).includes(true), "at least one route stays open");
    for (const key of GRAPH_DRUM_PARAMETER_KEYS) seen.get(key).add(presetStateKey(result.parameters[key]));
    positions.add(presetStateKey(result.nodes));
    gates.add(presetStateKey(result.edgeSwitches));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
  assert.ok(positions.size > 150 && gates.size > 150);
  for (const rng of [() => 0, () => 0.999999999, () => 0.5]) validateGraphDrumPreset(randomizeGraphDrumPreset(initial, rng));
  assert.throws(() => randomizeGraphDrumPreset(initial, () => NaN), TypeError);
});
