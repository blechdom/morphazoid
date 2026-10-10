import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGraph, graphTurnRouteCount, GRAPH_PRESETS } from '../src/instruments/graph-delay/graph-delay.js';
import { randomizeGraphPositions, createRandomGraph, graphOutputPaths } from '../src/instruments/graph-delay-rust/graph-delay-interactions.js';
import { compileGraphDelayPlan } from '../src/instruments/graph-delay-rust/graph-delay-plan.js';

const graph = (count = 12) => generateGraph({ type: 'ring', nodeCount: count, maxNodes: 64, seed: 17 });
const minimumSeparation = nodes => Math.min(...nodes.flatMap((node, index) => nodes.slice(index + 1).map(other => Math.hypot(node.x - other.x, node.y - other.y))));
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

test('output path requirement distinguishes processing turns from a complete audible path', () => {
  const chain = generateGraph({ type: 'chain', nodeCount: 36, maxNodes: 64 });
  assert.equal(graphOutputPaths(chain).minimumTurns, 35);
  const switches = new Map(chain.edges.map(edge => [`${edge.from}>${edge.to}`, edge.id !== 12]));
  assert.equal(graphOutputPaths(chain, { switches }).minimumTurns, null);
  assert.equal(graphOutputPaths(chain, { nodePass: 0 }).minimumTurns, null);
  const tree = generateGraph({ type: 'tree', nodeCount: 7 });
  const paths = graphOutputPaths(tree);
  assert.equal(paths.minimumTurns, 2);
  assert.equal(paths.paths.length, 4);
  assert.ok(paths.paths.every(path => path.edges.length === 2));
});

test('random positions preserve detached graph structure, route identities and all metadata', () => {
  const original = graph(), before = structuredClone(original); freeze(original);
  const result = randomizeGraphPositions(original, () => .37);
  assert.deepEqual(original, before); assert.notDeepEqual(result.nodes, before.nodes);
  assert.deepEqual({ ...result, nodes: before.nodes }, before);
  assert.deepEqual(result.nodes.map(({ x, y, ...node }) => node), before.nodes.map(({ x, y, ...node }) => node));
  assert.notEqual(result, original); assert.notEqual(result.nodes, original.nodes); assert.notEqual(result.edges, original.edges);
  assert.notEqual(result.edges[0], original.edges[0]); assert.notEqual(result.components, original.components);
  const a = compileGraphDelayPlan(original), b = compileGraphDelayPlan(result);
  assert.equal(a.signature, b.signature); assert.equal(a.routes, b.routes);
  const start = 16 + a.nodes * 2 + a.edges * 6 + a.data[3] * 3;
  for (let index = 0; index < a.routes; index++) {
    assert.equal(a.data[start + index * 4], b.data[start + index * 4]);
    assert.equal(a.data[start + index * 4 + 1], b.data[start + index * 4 + 1]);
  }
});

test('position randomization is reproducible and well separated for dense graphs', () => {
  const original = graph(64);
  assert.deepEqual(randomizeGraphPositions(original, () => .42), randomizeGraphPositions(original, () => .42));
  assert.notDeepEqual(randomizeGraphPositions(original, () => .42), randomizeGraphPositions(original, () => .43));
  for (let sample = 0; sample < 100; sample++) {
    const result = randomizeGraphPositions(original, () => sample / 100);
    assert.ok(result.nodes.every(node => node.x >= .02 && node.x <= .98 && node.y >= .02 && node.y <= .98));
    assert.ok(minimumSeparation(result.nodes) > .045, `dense node separation for seed ${sample}`);
    assert.ok(Math.max(...result.nodes.map(node => node.x)) - Math.min(...result.nodes.map(node => node.x)) > .8);
    assert.ok(Math.max(...result.nodes.map(node => node.y)) - Math.min(...result.nodes.map(node => node.y)) > .8);
  }
});

test('random graph returns only structural parameters and a complete budgeted graph', () => {
  const state = freeze({ topology: 'dag', nodeCount: 22, density: .7, seed: 17, graphPatch: 'factory',
    timeScale: 345, pitchScale: .6, wet: .9, inputTrim: .72, level: .4, voiceCeiling: 12, automatic: false,
    inputX: .34, inputY: .64, nodeMotionPhase: 19, audio: true });
  const before = structuredClone(state), result = createRandomGraph(state, 384, () => .53);
  assert.deepEqual(state, before); assert.deepEqual(Object.keys(result.parameters).sort(), ['density', 'graphPatch', 'nodeCount', 'seed', 'topology']);
  assert.notEqual(result.parameters.seed, state.seed); assert.notEqual(result.parameters.topology, state.topology);
  assert.equal(result.parameters.graphPatch, 'custom'); assert.equal(result.parameters.nodeCount, result.admission.graph.nodes.length);
  assert.equal(result.parameters.density, result.admission.density); assert.equal(result.parameters.topology, result.admission.graph.type);
  assert.equal(result.admission.turnRouteCount, graphTurnRouteCount(result.admission.graph));
  assert.ok(result.admission.turnRouteCount <= 384); assert.ok(result.admission.graph.edges.length <= 256);
  assert.deepEqual(result, createRandomGraph(state, 384, () => .53));
});

test('random graphs vary across topology, count, density and seed within every supported budget', () => {
  const seen = { topology: new Set(), nodeCount: new Set(), density: new Set(), seed: new Set() };
  for (const budget of [2, 3, 8, 32, 128, 384, 512]) for (let sample = 0; sample < 60; sample++) {
    const result = createRandomGraph({ topology: 'chain', seed: 17 }, budget, () => sample / 60), { parameters, admission } = result;
    assert.ok(Object.hasOwn(GRAPH_PRESETS, parameters.topology));
    assert.ok(parameters.nodeCount >= 3 && parameters.nodeCount <= 64);
    assert.ok(parameters.density >= 0 && parameters.density <= 1);
    assert.ok(parameters.seed >= 1 && parameters.seed <= 99 && parameters.seed !== 17);
    assert.ok(admission.graph.edges.length <= 256); assert.ok(graphTurnRouteCount(admission.graph) <= budget);
    assert.equal(compileGraphDelayPlan(admission.graph).routes, admission.turnRouteCount);
    for (const key of Object.keys(seen)) seen[key].add(parameters[key]);
  }
  assert.ok(seen.topology.size >= 9); assert.ok(seen.nodeCount.size > 40);
  assert.ok(seen.density.size > 20); assert.ok(seen.seed.size > 30);
});

test('invalid budgets fail explicitly and fixed or malformed random sources remain bounded', () => {
  for (const budget of [0, 1, -1, 2.5, 513, NaN, Infinity]) {
    assert.throws(() => createRandomGraph({}, budget), /budget of 2–512/);
  }
  for (const value of [0, 1, -1, NaN, Infinity]) {
    const result = createRandomGraph({ topology: 'ring', seed: 99 }, 2, () => value);
    assert.equal(result.admission.turnRouteCount, 2); assert.equal(result.parameters.nodeCount, 3);
    assert.ok(result.admission.graph.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  }
  assert.throws(() => randomizeGraphPositions(null), /graph with nodes/);
  assert.throws(() => randomizeGraphPositions({ nodes: [], edges: [] }), /1–64/);
});
