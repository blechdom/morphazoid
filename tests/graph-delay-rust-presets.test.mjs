import assert from "node:assert/strict";
import test from "node:test";
import { GRAPH_DELAY_INITIAL_STATE } from "../src/families/graph-presets/initial-state.js";
import { GRAPH_DELAY_PATCHES, generateGraphWithinTurnBudget, graphTurnRouteCount } from "../src/instruments/graph-delay/graph-delay.js";
import { GRAPH_DELAY_RUST_PRESETS, captureGraphDelayRustPreset, validateGraphDelayRustPreset,
  randomizeGraphDelayRustPreset } from "../src/instruments/graph-delay-rust/graph-delay-presets.js";
import { validateFullPresetBank } from "../src/site/header-presets.js";
import { graphOutputPaths } from '../src/instruments/graph-delay-rust/graph-delay-interactions.js';

const clone = value => structuredClone(value);
function seeded(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

test("Rust graph presets retain every original patch and add larger complete scenes", () => {
  validateFullPresetBank(GRAPH_DELAY_RUST_PRESETS);
  assert.equal(GRAPH_DELAY_RUST_PRESETS.length, Object.keys(GRAPH_DELAY_PATCHES).length + 3);
  for (const id of Object.keys(GRAPH_DELAY_PATCHES)) assert.ok(GRAPH_DELAY_RUST_PRESETS.some(p => p.id === id));
  for (const preset of GRAPH_DELAY_RUST_PRESETS) {
    assert.equal(validateGraphDelayRustPreset(preset.snapshot), preset.snapshot);
    assert.ok(graphTurnRouteCount(preset.snapshot.graph) <= 384);
    for (const key of ["inputTrim", "level", "nodeMotionPhase", "micMotionPhase", "mic", "starting"]) {
      assert.equal(Object.hasOwn(preset.snapshot.parameters, key), false, key);
    }
  }
  assert.ok(GRAPH_DELAY_RUST_PRESETS.some(p => p.snapshot.graph.nodes.length > 24));
  assert.ok(GRAPH_DELAY_RUST_PRESETS.some(p => graphTurnRouteCount(p.snapshot.graph) > 192));
});

test("complete capture preserves geometry and switches without owning live gains or clocks", () => {
  const state = { ...GRAPH_DELAY_INITIAL_STATE, nodeCount: 64, topology: "tree", inputTrim: 0.3, level: 0.2, nodeMotionPhase: 17, micMotionPhase: 21 };
  const { graph } = generateGraphWithinTurnBudget({ ...state, maxNodes: 64 }, 512);
  graph.nodes[3].x = 0.63;
  const switches = new Map(graph.edges.map(edge => [`${edge.from}>${edge.to}`, edge.id !== 3]));
  const snapshot = captureGraphDelayRustPreset(state, graph, switches);
  const recalled = { ...state, ...snapshot.parameters };
  assert.equal(recalled.inputTrim, 0.3); assert.equal(recalled.level, 0.2);
  assert.equal(recalled.nodeMotionPhase, 17); assert.equal(recalled.micMotionPhase, 21);
  assert.equal(snapshot.graph.nodes[3].x, 0.63); assert.equal(snapshot.edgeSwitches["1>4"], false);
  snapshot.graph.nodes[3].x = 0.2;
  assert.equal(graph.nodes[3].x, 0.63, "captured state is detached");
});

test("import validation rejects corrupt routing, budgets, levels and incomplete graphs", () => {
  const original = GRAPH_DELAY_RUST_PRESETS.find(p => p.id === "haloRing").snapshot;
  const edits = [
    s => { s.parameters.level = 0.5; }, s => { s.parameters.nodeCount = 65; },
    s => { s.parameters.seed = 1.5; }, s => { s.parameters.feedback = 1; },
    s => { s.graph.nodes[0].x = NaN; }, s => { s.graph.nodes[0].x = 1.1; },
    s => { s.graph.edges[0].to = 900; }, s => { s.graph.edges[0].id = 2; },
    s => { s.graph.edges[0].feedbackEdge = !s.graph.edges[0].feedbackEdge; },
    s => { s.graph.edges[0].cyclic = !s.graph.edges[0].cyclic; },
    s => { s.graph.entries = [0]; }, s => { s.graph.indegree[0]++; },
    s => { s.graph.components = []; }, s => { s.graph.cyclic = false; },
    s => { delete s.edgeSwitches[Object.keys(s.edgeSwitches)[0]]; },
    s => { s.edgeSwitches.extra = true; }, s => { s.parameters.nodeMoving = "yes"; },
  ];
  for (const edit of edits) { const changed = clone(original); edit(changed); assert.throws(() => validateGraphDelayRustPreset(changed), TypeError); }
  const excessive = clone(original);
  const safe = generateGraphWithinTurnBudget({ type: "dag", nodeCount: 64, maxNodes: 64, density: 1 }, 100000);
  excessive.graph = safe.graph;
  Object.assign(excessive.parameters, { topology: "dag", nodeCount: 64, density: 1 });
  excessive.edgeSwitches = Object.fromEntries(safe.graph.edges.map(edge => [`${edge.from}>${edge.to}`, true]));
  assert.throws(() => validateGraphDelayRustPreset(excessive), /graph size|turn budget/);
});

test("randomization is deterministic, bounded, independent and varies all musical parameters", () => {
  const current = GRAPH_DELAY_RUST_PRESETS[0].snapshot, before = clone(current);
  assert.deepEqual(randomizeGraphDelayRustPreset(current, seeded(5)), randomizeGraphDelayRustPreset(current, seeded(5)));
  const results = Array.from({ length: 100 }, (_, i) => randomizeGraphDelayRustPreset(current, seeded(i + 1)));
  assert.deepEqual(current, before);
  for (const snapshot of results) validateGraphDelayRustPreset(snapshot);
  for (const key of Object.keys(current.parameters).filter(key => key !== "graphPatch")) {
    assert.ok(new Set(results.map(s => s.parameters[key])).size > 1, `${key} must vary`);
  }
  assert.ok(results.some(s => s.graph.nodes.length > 24));
  assert.ok(results.some(s => Object.values(s.edgeSwitches).includes(false)));
});

test("dice keeps complete output paths and bounds pass attenuation across long graphs", () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const snapshot = randomizeGraphDelayRustPreset(GRAPH_DELAY_RUST_PRESETS[0].snapshot, seeded(seed));
    const expected = graphOutputPaths(snapshot.graph);
    const actual = graphOutputPaths(snapshot.graph, { switches: snapshot.edgeSwitches, ...snapshot.parameters });
    assert.deepEqual(actual.paths.map(path => path.sink), expected.paths.map(path => path.sink), `lost output at seed ${seed}`);
    assert.ok(actual.minimumTurns !== null, `no wet path at seed ${seed}`);
    for (const path of actual.paths) {
      assert.ok(snapshot.parameters.nodePass ** path.edges.length >= .55 - 1e-12, `inaudible per-hop pass at seed ${seed}`);
    }
  }
});


test("dense 64-node bipartite scenes respect history memory as well as turn capacity", async () => {
  const { generateGraphWithinRustBudget } = await import("../src/instruments/graph-delay-rust/graph-delay-topology.js");
  for (const seed of [1, 17, 61]) {
    const admitted = generateGraphWithinRustBudget({ type: "bipartite", nodeCount: 64, density: 1, seed });
    assert.equal(admitted.graph.nodes.length, 64);
    assert.ok(admitted.graph.edges.length <= 256);
    assert.ok(admitted.turnRouteCount <= 384);
    assert.equal(admitted.limited, true);
  }
});


test("manual Rust preparation budgets admit complete larger graphs and reject impossible minima", async () => {
  const { generateGraphWithinRustBudget } = await import("../src/instruments/graph-delay-rust/graph-delay-topology.js");
  const options = { type: "dag", topology: "dag", nodeCount: 64, density: 1, seed: 17 };
  const initial = generateGraphWithinRustBudget(options);
  const larger = generateGraphWithinRustBudget(options, 512);
  assert.ok(larger.turnRouteCount > 384 && larger.turnRouteCount <= 512);
  assert.ok(larger.turnRouteCount > initial.turnRouteCount);
  assert.equal(graphTurnRouteCount(larger.graph), larger.turnRouteCount);
  assert.equal(larger.graph.nodes.length, 64);
  const switches = new Map(larger.graph.edges.map(edge => [`${edge.from}>${edge.to}`, true]));
  const captured = captureGraphDelayRustPreset({ ...GRAPH_DELAY_INITIAL_STATE, ...options, density: larger.density }, larger.graph, switches);
  assert.equal(validateGraphDelayRustPreset(captured), captured);
  assert.throws(() => generateGraphWithinRustBudget(options, 1), /cannot fit/);
  for (const invalid of [0, 513, NaN, 1.5]) assert.throws(() => generateGraphWithinRustBudget(options, invalid), RangeError);
});
