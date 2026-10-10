import {
  GRAPH_DELAY_PATCHES, GRAPH_PRESETS, annotateCycles,
  generateGraphWithinTurnBudget, graphTurnRouteCount,
} from "../graph-delay/graph-delay.js";
import { GRAPH_DELAY_INITIAL_STATE } from "../../families/graph-presets/initial-state.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";

export const GRAPH_DELAY_RUST_MAX_NODES = 64;
export const GRAPH_DELAY_RUST_MAX_TURN_ROUTES = 512;
const liveKeys = new Set(["mic", "starting", "nodeMotionPhase", "micMotionPhase", "inputTrim", "level"]);
const parameterKeys = Object.keys(GRAPH_DELAY_INITIAL_STATE).filter(key => !liveKeys.has(key));
const ranges = Object.freeze({
  nodeCount: [3, GRAPH_DELAY_RUST_MAX_NODES], density: [0, 1], seed: [1, 0xffffffff],
  baseDelay: [20, 600], timeScale: [0, 800], timeCurve: [0.25, 3], nodePass: [0, 1],
  pitchScale: [0, 2], pitchAsymmetry: [-0.8, 0.8], pitchCurve: [0.5, 2], pitchSlew: [10, 500],
  nodeMotionSpeed: [0.01, 0.5], nodeMotionAmount: [0.01, 0.3], micMotionSpeed: [0.01, 0.4], micMotionSize: [0.05, 0.46],
  inputX: [0.01, 0.99], inputY: [0.02, 0.98], feedback: [0, 0.92], damping: [500, 12000],
  wet: [0, 1.5], dry: [0, 1], spread: [0, 1],
});
const nodeModes = ["wiggle", "orbit", "random"];
const micModes = ["circle", "ellipse", "triangle", "square", "figure8", "random"];
const parametersOf = state => Object.fromEntries(parameterKeys.map(key => [key, state[key]]));
const same = (a, b) => presetStateKey(a) === presetStateKey(b);
const fail = message => { throw new TypeError(`Invalid Graph Delay Rust preset: ${message}`); };

/** Validate routing metadata as well as controls: imported state must never bypass DSP bounds. */
export function validateGraphDelayRustPreset(snapshot) {
  const p = snapshot?.parameters, graph = snapshot?.graph;
  if (!p || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail("missing graph");
  if (graph.nodes.length < 3 || graph.nodes.length > GRAPH_DELAY_RUST_MAX_NODES
    || graph.edges.length < 1 || graph.edges.length > GRAPH_DELAY_RUST_MAX_TURN_ROUTES) fail("graph size");
  presetStateKey(snapshot);
  if (!same(Object.keys(snapshot).sort(), ["edgeSwitches", "graph", "parameters"])) fail("snapshot fields");
  if (!same(Object.keys(p).sort(), [...parameterKeys].sort())) fail("parameter fields");
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) fail(key);
  }
  if (!Number.isInteger(p.nodeCount) || p.nodeCount !== graph.nodes.length || !Number.isInteger(p.seed)
    || !Object.hasOwn(GRAPH_PRESETS, p.topology) || graph.type !== p.topology) fail("topology");
  if (typeof p.graphPatch !== "string" || p.graphPatch.length > 80
    || typeof p.nodeMoving !== "boolean" || typeof p.micMoving !== "boolean"
    || !nodeModes.includes(p.nodeMotionMode) || !micModes.includes(p.micMotionMode)) fail("motion");
  graph.nodes.forEach((node, index) => {
    if (node?.id !== index || !Number.isFinite(node.x) || !Number.isFinite(node.y)
      || node.x < 0 || node.x > 1 || node.y < 0 || node.y > 1) fail("node");
  });
  const keys = new Set(), indegree = Array(p.nodeCount).fill(0), outdegree = Array(p.nodeCount).fill(0);
  graph.edges.forEach((edge, index) => {
    const key = `${edge?.from}>${edge?.to}`;
    if (edge?.id !== index || !Number.isInteger(edge.from) || !Number.isInteger(edge.to)
      || !graph.nodes[edge.from] || !graph.nodes[edge.to] || edge.from === edge.to || keys.has(key)) fail("edge");
    keys.add(key); indegree[edge.to]++; outdegree[edge.from]++;
  });
  if (indegree.some((count, id) => count + outdegree[id] === 0)) fail("isolated node");
  const annotated = annotateCycles(p.nodeCount, graph.edges);
  const cyclicIndegree = Array(p.nodeCount).fill(0);
  annotated.edges.forEach((edge, id) => {
    if (edge.cyclic) cyclicIndegree[edge.to]++;
    if (graph.edges[id].cyclic !== edge.cyclic
      || graph.edges[id].feedbackEdge !== (edge.cyclic && edge.to <= edge.from)) fail("feedback classification");
  });
  const expected = {
    indegree, outdegree, cyclicIndegree, cyclic: annotated.cyclic, components: annotated.components,
    entries: graph.nodes.filter(node => indegree[node.id] === 0).map(node => node.id),
  };
  for (const [key, value] of Object.entries(expected)) if (!same(graph[key], value)) fail(`graph ${key}`);
  if (graphTurnRouteCount(graph) > GRAPH_DELAY_RUST_MAX_TURN_ROUTES) fail("turn budget");
  if (!snapshot.edgeSwitches || !same(Object.keys(snapshot.edgeSwitches).sort(), [...keys].sort())
    || [...keys].some(key => typeof snapshot.edgeSwitches[key] !== "boolean")) fail("edge switches");
  return snapshot;
}

export function captureGraphDelayRustPreset(state, graph, switchMap) {
  return clonePresetData(validateGraphDelayRustPreset({
    parameters: parametersOf(state), graph, edgeSwitches: Object.fromEntries(switchMap),
  }));
}

function createSnapshot(state) {
  const safe = generateGraphWithinTurnBudget({ ...state, type: state.topology, maxNodes: GRAPH_DELAY_RUST_MAX_NODES }, GRAPH_DELAY_RUST_MAX_TURN_ROUTES);
  return validateGraphDelayRustPreset({
    parameters: parametersOf({ ...state, density: safe.density }), graph: safe.graph,
    edgeSwitches: Object.fromEntries(safe.graph.edges.map(edge => [`${edge.from}>${edge.to}`, true])),
  });
}

const expandedPatches = {
  wideCanopy: { ...GRAPH_DELAY_PATCHES.branchChoir, label: "Wide Canopy", topology: "tree", nodeCount: 63, baseDelay: 42, timeScale: 65, pitchScale: 0.32, wet: 1.1 },
  wovenGlass: { ...GRAPH_DELAY_PATCHES.layeredGlass, label: "Woven Glass", nodeCount: 48, density: 0.8, baseDelay: 24, timeScale: 32, pitchScale: 0.14, nodePass: 0.97 },
  islandConstellation: { ...GRAPH_DELAY_PATCHES.islandSignals, label: "Island Constellation", nodeCount: 36, density: 0.4, baseDelay: 28, timeScale: 48, pitchScale: 0.12, feedback: 0.72 },
};

export const GRAPH_DELAY_RUST_PRESETS = Object.freeze(Object.entries({ ...GRAPH_DELAY_PATCHES, ...expandedPatches }).map(([id, patch], index) => Object.freeze({
  id, label: patch.label,
  description: `${patch.label}: complete graph, route switches, delay, pitch, feedback and motion. Input and output levels stay live.`,
  snapshot: createSnapshot({ ...GRAPH_DELAY_INITIAL_STATE, ...patch, graphPatch: id,
    nodeMoving: index % 4 === 2, micMoving: index % 4 === 3,
    nodeMotionMode: nodeModes[index % nodeModes.length], micMotionMode: micModes[index % micModes.length],
  }),
})));

export function randomizeGraphDelayRustPreset(current, random = Math.random) {
  validateGraphDelayRustPreset(current);
  const rng = presetRandom(random);
  const snapshot = createSnapshot({ ...current.parameters,
    ...randomParameterValues({ ...ranges, baseDelay: [25, 130], timeScale: [0, 220], nodePass: [0.55, 0.98],
      pitchScale: [0, 0.65], feedback: [0.2, 0.78], wet: [0.5, 1.2], dry: [0, 0.3], damping: [1200, 8500] }, rng),
    nodeCount: rng.integer(4, GRAPH_DELAY_RUST_MAX_NODES), seed: rng.integer(1, 99),
    topology: rng.pick(Object.keys(GRAPH_PRESETS)), graphPatch: "custom",
    nodeMoving: rng.pick([true, false]), micMoving: rng.pick([true, false]),
    nodeMotionMode: rng.pick(nodeModes), micMotionMode: rng.pick(micModes),
  });
  for (const node of snapshot.graph.nodes) { node.x = rng.between(0.08, 0.92); node.y = rng.between(0.08, 0.92); }
  Object.keys(snapshot.edgeSwitches).forEach((key, index) => { snapshot.edgeSwitches[key] = index === 0 || rng.unit() > 0.18; });
  return validateGraphDelayRustPreset(snapshot);
}
