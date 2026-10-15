import { GRAPH_PRESETS, generateGraph } from "../../instruments/graph-delay/graph-delay.js";
import { GRAPH_DRUM_PERCUSSION_STYLES } from "../graph/graph-drum-audio.js";
import { GRAPH_INSTRUMENT_PATCHES, MAX_GRAPH_INSTRUMENT_NODES } from "../graph/graph-instruments.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const TOPOLOGIES = Object.freeze(Object.keys(GRAPH_PRESETS));
const STYLES = Object.freeze(GRAPH_DRUM_PERCUSSION_STYLES.map(style => style.id));
const MAPPINGS = Object.freeze(["position-grid", "degree-turn", "path-phase"]);
const PULSES = Object.freeze([0.5, 1, 2, 4]);
const MOTIONS = Object.freeze(["wiggle", "orbit", "random"]);

export const GRAPH_DRUM_PARAMETER_KEYS = Object.freeze([
  "topology", "nodeCount", "density", "seed", "baseDelay", "distanceRatio", "timeCurve", "nodePass",
  "feedback", "feedbackTone", "tempo", "pulseDivision", "seedNote", "triggerScope", "attackLaneCount",
  "percussionStyle", "mappingMode", "pitchDepth", "turnPitchDepth", "characterDepth",
  "nodeMoving", "nodeMotionMode", "nodeMotionSpeed", "nodeMotionAmount",
]);

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const quantize = (value, min, max, step, fallback) => {
  const clamped = Math.min(max, Math.max(min, finite(value, fallback)));
  return Number(Math.min(max, min + Math.round((clamped - min) / step) * step).toFixed(6));
};
const integer = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.round(finite(value, fallback))));
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function sanitizeParameters(raw = {}) {
  return {
    topology: oneOf(raw.topology, TOPOLOGIES, "dag"),
    nodeCount: integer(raw.nodeCount, 3, MAX_GRAPH_INSTRUMENT_NODES, 10),
    density: quantize(raw.density, 0, 1, 0.01, 0.34),
    seed: integer(raw.seed, 1, 99, 17),
    baseDelay: integer(raw.baseDelay, 20, 600, 62),
    distanceRatio: quantize(raw.distanceRatio, 1, 12, 0.01, 1.94),
    timeCurve: quantize(raw.timeCurve, 0.25, 3, 0.05, 0.9),
    nodePass: quantize(raw.nodePass, 0.2, 1, 0.01, 1),
    feedback: quantize(raw.feedback, 0, 0.92, 0.01, 0.72),
    feedbackTone: quantize(raw.feedbackTone, 0.2, 1, 0.01, 0.78),
    tempo: integer(raw.tempo, 35, 220, 126),
    pulseDivision: oneOf(Number(raw.pulseDivision), PULSES, 1),
    seedNote: integer(raw.seedNote, 0, 127, 60),
    triggerScope: oneOf(raw.triggerScope, ["all", "leaves"], "all"),
    attackLaneCount: oneOf(Number(raw.attackLaneCount), [1, 2, 4], 1),
    percussionStyle: oneOf(raw.percussionStyle, STYLES, "drum-bank"),
    mappingMode: oneOf(raw.mappingMode, MAPPINGS, "position-grid"),
    pitchDepth: integer(raw.pitchDepth, 0, 24, 12),
    turnPitchDepth: integer(raw.turnPitchDepth, 0, 24, 9),
    characterDepth: quantize(raw.characterDepth, 0, 1, 0.01, 0.72),
    nodeMoving: Boolean(raw.nodeMoving),
    nodeMotionMode: oneOf(raw.nodeMotionMode, MOTIONS, "wiggle"),
    nodeMotionSpeed: quantize(raw.nodeMotionSpeed, 0.01, 0.5, 0.01, 0.12),
    nodeMotionAmount: quantize(raw.nodeMotionAmount, 0.01, 0.3, 0.01, 0.07),
  };
}

const edgeKey = edge => `${edge.from}>${edge.to}`;
const baseGraph = parameters => generateGraph({
  type: parameters.topology, nodeCount: parameters.nodeCount, density: parameters.density, seed: parameters.seed,
  maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
});

export function sanitizeGraphDrumPreset(raw = {}) {
  const parameters = sanitizeParameters(raw.parameters);
  const graph = baseGraph(parameters);
  parameters.nodeCount = graph.nodes.length;
  const nodes = graph.nodes.map((node, index) => [
    quantize(raw.nodes?.[index]?.[0], 0, 1, 0.001, node.x),
    quantize(raw.nodes?.[index]?.[1], 0, 1, 0.001, node.y),
  ]);
  const edgeSwitches = Object.fromEntries(graph.edges.map(edge => [edgeKey(edge), raw.edgeSwitches?.[edgeKey(edge)] !== false]));
  return { parameters, nodes, edgeSwitches };
}

export function captureGraphDrumPreset(state, graph, edgeSwitches) {
  return sanitizeGraphDrumPreset({
    parameters: state,
    nodes: graph.nodes.map(node => [node.x, node.y]),
    edgeSwitches: edgeSwitches instanceof Map ? Object.fromEntries(edgeSwitches) : edgeSwitches,
  });
}

export function validateGraphDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(sanitizeGraphDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Graph Drum Machine preset");
  }
  return snapshot;
}

/** Rebuilds the live graph model (with the preset's node layout) and its edge-gate map. */
export function graphDrumSceneGraph(snapshot) {
  validateGraphDrumPreset(snapshot);
  const graph = baseGraph(snapshot.parameters);
  graph.nodes.forEach((node, index) => { [node.x, node.y] = snapshot.nodes[index]; });
  return { graph, edgeSwitches: new Map(Object.entries(snapshot.edgeSwitches)) };
}

const seededUnit = seed => {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
};
const fromPatch = (name, overrides = {}) => {
  const patch = GRAPH_INSTRUMENT_PATCHES[name];
  const { drums = {}, ...rest } = patch;
  const pulseDivision = patch.pulseBeats ?? patch.pulseDivision;
  return { ...rest, pulseDivision, ...drums, ...overrides };
};
const scene = (id, label, parameters, { jitter = 0, close = 0 } = {}) => {
  const base = sanitizeGraphDrumPreset({ parameters });
  const random = seededUnit(parameters.seed * 7919 + parameters.nodeCount);
  const nodes = jitter
    ? base.nodes.map(([x, y]) => [x + (random() - 0.5) * jitter, y + (random() - 0.5) * jitter])
    : base.nodes;
  const edgeSwitches = Object.fromEntries(Object.keys(base.edgeSwitches).map((key, index) => [key, !(close && index % close === close - 1)]));
  return Object.freeze({ id, label, snapshot: Object.freeze(sanitizeGraphDrumPreset({ parameters: base.parameters, nodes, edgeSwitches })) });
};

const GLASS = fromPatch("layeredGlass");

export const GRAPH_DRUM_FULL_PRESETS = Object.freeze([
  scene("layered-glass", "Layered glass", GLASS),
  scene("clear-steps", "Clear steps", fromPatch("clearSteps")),
  scene("branch-choir", "Branch choir", fromPatch("branchChoir", { attackLaneCount: 2, seedNote: 55 })),
  scene("halo-ring", "Halo ring", fromPatch("haloRing", { nodeMoving: true, nodeMotionMode: "orbit", nodeMotionSpeed: 0.08, nodeMotionAmount: 0.1 })),
  scene("shortcut-chorus", "Shortcut chorus", fromPatch("shortcutChorus", { attackLaneCount: 4, seedNote: 67 })),
  scene("hub-scatter", "Hub scatter", fromPatch("hubScatter", { attackLaneCount: 2 }), { close: 4 }),
  scene("soft-mesh", "Soft mesh", fromPatch("softMesh", { nodeMoving: true, nodeMotionSpeed: 0.05, nodeMotionAmount: 0.12 })),
  scene("island-signals", "Island signals", fromPatch("islandSignals", { seedNote: 43 })),
  scene("pocket-chain", "Pocket chain", {
    topology: "chain", nodeCount: 6, density: 0, seed: 3, baseDelay: 150, distanceRatio: 1, timeCurve: 1, nodePass: 0.9,
    feedback: 0.3, feedbackTone: 0.7, tempo: 96, pulseDivision: 1, percussionStyle: "drum-bank", mappingMode: "position-grid",
    pitchDepth: 6, turnPitchDepth: 4, characterDepth: 0.5,
  }, { jitter: 0.2 }),
  scene("orbiting-bank", "Orbiting bank", {
    topology: "ring", nodeCount: 6, density: 0.2, seed: 9, baseDelay: 210, distanceRatio: 1.4, timeCurve: 1, nodePass: 1,
    feedback: 0.88, feedbackTone: 0.6, tempo: 88, pulseDivision: 2, percussionStyle: "rattlesnake-physical", mappingMode: "path-phase",
    pitchDepth: 10, turnPitchDepth: 12, characterDepth: 0.8, nodeMoving: true, nodeMotionMode: "orbit", nodeMotionSpeed: 0.2, nodeMotionAmount: 0.15,
  }),
  scene("tine-mesh", "Tine mesh", {
    topology: "mesh", nodeCount: 9, density: 0.2, seed: 7, baseDelay: 90, distanceRatio: 2.2, timeCurve: 0.8, nodePass: 0.85,
    feedback: 0.6, feedbackTone: 0.4, tempo: 66, pulseDivision: 2, triggerScope: "leaves", percussionStyle: "karplus-tines",
    mappingMode: "position-grid", pitchDepth: 14, turnPitchDepth: 6, characterDepth: 0.45, seedNote: 52,
  }, { jitter: 0.12 }),
  scene("fast-bipartite", "Fast bipartite", {
    topology: "bipartite", nodeCount: 10, density: 0.5, seed: 29, baseDelay: 28, distanceRatio: 1.6, timeCurve: 0.6, nodePass: 1,
    feedback: 0.2, feedbackTone: 0.9, tempo: 180, pulseDivision: 0.5, attackLaneCount: 4, percussionStyle: "circuit",
    mappingMode: "degree-turn", pitchDepth: 22, turnPitchDepth: 16, characterDepth: 0.9,
  }),
  scene("random-bursts", "Random bursts", {
    topology: "random", nodeCount: 14, density: 0.35, seed: 77, baseDelay: 48, distanceRatio: 4.5, timeCurve: 2.2, nodePass: 0.8,
    feedback: 0.6, feedbackTone: 0.65, tempo: 132, pulseDivision: 1, percussionStyle: "rattlesnake", mappingMode: "position-grid",
    pitchDepth: 18, turnPitchDepth: 8, characterDepth: 0.95, nodeMoving: true, nodeMotionMode: "random", nodeMotionSpeed: 0.3, nodeMotionAmount: 0.2,
  }, { jitter: 0.3, close: 5 }),
  scene("sparse-objects", "Sparse objects", {
    topology: "tree", nodeCount: 7, density: 0.3, seed: 21, baseDelay: 320, distanceRatio: 1.5, timeCurve: 1.2, nodePass: 1,
    feedback: 0.4, feedbackTone: 0.55, tempo: 52, pulseDivision: 4, triggerScope: "leaves", percussionStyle: "karplus-objects",
    mappingMode: "degree-turn", pitchDepth: 10, turnPitchDepth: 12, characterDepth: 0.6, seedNote: 48,
  }),
]);

export function randomizeGraphDrumPreset(current, random = Math.random) {
  validateGraphDrumPreset(current);
  const rng = presetRandom(random);
  const parameters = {
    topology: rng.pick(TOPOLOGIES),
    nodeCount: rng.integer(4, 16),
    density: rng.between(0.05, 0.6),
    seed: rng.integer(1, 99),
    baseDelay: 24 * (400 / 24) ** rng.unit(),
    distanceRatio: rng.between(1, 6),
    timeCurve: rng.between(0.4, 2.4),
    nodePass: rng.between(0.6, 1),
    feedback: rng.between(0.15, 0.85),
    feedbackTone: rng.between(0.3, 1),
    tempo: rng.integer(50, 190),
    pulseDivision: rng.pick(PULSES),
    seedNote: rng.integer(36, 72),
    triggerScope: rng.pick(["all", "leaves"]),
    attackLaneCount: rng.pick([1, 2, 4]),
    percussionStyle: rng.pick(STYLES),
    mappingMode: rng.pick(MAPPINGS),
    pitchDepth: rng.integer(0, 24),
    turnPitchDepth: rng.integer(0, 24),
    characterDepth: rng.unit(),
    nodeMoving: rng.unit() < 0.4,
    nodeMotionMode: rng.pick(MOTIONS),
    nodeMotionSpeed: rng.between(0.03, 0.4),
    nodeMotionAmount: rng.between(0.02, 0.2),
  };
  const shape = sanitizeGraphDrumPreset({ parameters });
  const nodes = shape.nodes.map(() => [rng.between(0.06, 0.94), rng.between(0.06, 0.94)]);
  const edgeSwitches = Object.fromEntries(Object.keys(shape.edgeSwitches).map((key, index) => [key, index === 0 || rng.unit() > 0.15]));
  return validateGraphDrumPreset(sanitizeGraphDrumPreset({ parameters: shape.parameters, nodes, edgeSwitches }));
}
