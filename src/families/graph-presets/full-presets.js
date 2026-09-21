import { GRAPH_DELAY_PATCHES, GRAPH_PRESETS, MAX_GRAPH_TURN_ROUTES, generateGraph, generateGraphWithinTurnBudget, graphTurnRoutings } from "../../graph-delay.js";
import { GRAPH_INSTRUMENT_PATCHES } from "../../graph-instruments.js";
import { GRAPH_DELAY_INITIAL_STATE } from "./initial-state.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";
export { GRAPH_DELAY_INITIAL_STATE };

export const GRAPH_DELAY_LIVE_KEYS = Object.freeze(["mic", "starting", "nodeMotionPhase", "micMotionPhase"]);
export const GRAPH_SYNTH_LIVE_KEYS = Object.freeze(["audio", "playing", "nodeMotionPhase"]);
const select = (state, keys) => Object.fromEntries(keys.map(key => [key, state[key]]));
const delayKeys = Object.keys(GRAPH_DELAY_INITIAL_STATE).filter(key => !GRAPH_DELAY_LIVE_KEYS.includes(key));
const commonRanges = {
  nodeCount: [3, 32], density: [0, 1], seed: [0, 0xffffffff], baseDelay: [20, 600],
  timeCurve: [0.25, 3], nodePass: [0, 1], feedback: [0, 0.92], nodeMotionSpeed: [0.01, 0.5], nodeMotionAmount: [0, 0.3],
};
const delayRanges = {
  ...commonRanges, nodeCount: [3, 24], timeScale: [0, 800], pitchScale: [0, 2], pitchAsymmetry: [-0.8, 0.8],
  pitchCurve: [0.5, 2], pitchSlew: [10, 500], micMotionSpeed: [0.01, 0.4], micMotionSize: [0.05, 0.46],
  inputX: [0.01, 0.99], inputY: [0.02, 0.98], damping: [500, 12000], wet: [0, 1.5], dry: [0, 1],
  spread: [0, 1], inputTrim: [0, 1.25], level: [0, 0.9],
};
const synthRanges = {
  ...commonRanges, output: [0, 0.9], tempo: [35, 220], distanceRatio: [1, 12], feedbackTone: [0.2, 1],
  seedNote: [0, 127], baseFrequency: [8, 16000], pitchRange: [0, 5], edoDivisions: [1, 360],
  turnPitchScale: [0, 4], modulationIndex: [0, 12], modulationRatio: [0.25, 8], noteDuration: [20, 4000],
  attack: [1, 2000], decay: [5, 2400], sustain: [0, 1], release: [2, 5000], stereoSpread: [0, 1],
  pitchDepth: [0, 48], turnPitchDepth: [0, 48], characterDepth: [0, 1],
};
const switches = graph => Object.fromEntries(graph.edges.map(edge => [`${edge.from}>${edge.to}`, true]));
function validateGraph(snapshot, limits) {
  presetStateKey(snapshot);
  const p = snapshot.parameters, graph = snapshot.graph;
  if (!p || !Object.hasOwn(GRAPH_PRESETS, p.topology) || !graph || graph.type !== p.topology
    || !Number.isInteger(p.nodeCount) || graph.nodes?.length !== p.nodeCount || !Number.isInteger(p.seed)) throw new TypeError("Invalid complete graph topology");
  for (const [key, [min, max]] of Object.entries(limits)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid graph ${key}`);
  if (typeof p.nodeMoving !== "boolean" || !["wiggle", "orbit", "random"].includes(p.nodeMotionMode)) throw new TypeError("Invalid graph motion");
  graph.nodes.forEach((node, index) => {
    if (node.id !== index || !(node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1)) throw new TypeError("Invalid graph node");
  });
  const edgeKeys = new Set();
  for (const edge of graph.edges) {
    const key = `${edge.from}>${edge.to}`;
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to] || edgeKeys.has(key)) throw new TypeError("Invalid graph edge");
    edgeKeys.add(key);
  }
  if (Object.keys(snapshot.edgeSwitches ?? {}).length !== edgeKeys.size
    || [...edgeKeys].some(key => typeof snapshot.edgeSwitches[key] !== "boolean")) throw new TypeError("Incomplete graph edge switches");
}
export function captureGraphDelayPreset(state, graph, edgeSwitches) {
  return clonePresetData({ parameters: select(state, delayKeys), graph, edgeSwitches: Object.fromEntries(edgeSwitches) });
}
export function validateGraphDelayPreset(s) {
  validateGraph(s, delayRanges);
  const p = s.parameters;
  if (Object.keys(p).length !== delayKeys.length || delayKeys.some(key => !Object.hasOwn(p, key))
    || typeof p.micMoving !== "boolean" || !["circle", "ellipse", "triangle", "square", "figure8", "random"].includes(p.micMotionMode)
    || graphTurnRoutings(s.graph).reduce((sum, routing) => sum + routing.turns.length, 0) > MAX_GRAPH_TURN_ROUTES) throw new TypeError("Invalid graph-delay state or turn budget");
  return s;
}
function delaySnapshot(parameters) {
  const safe = generateGraphWithinTurnBudget({ ...parameters, type: parameters.topology }, MAX_GRAPH_TURN_ROUTES);
  return validateGraphDelayPreset({ parameters: select({ ...parameters, density: safe.density ?? parameters.density }, delayKeys),
    graph: safe.graph, edgeSwitches: switches(safe.graph) });
}
export const GRAPH_DELAY_FULL_PRESETS = Object.freeze(Object.entries(GRAPH_DELAY_PATCHES).map(([id, patch], index) => ({
  id, label: patch.label,
  description: `${patch.label}: complete graph, edge gates, pitch/delay/mix and input/node motion. Existing microphone and audio history remain live.`,
  snapshot: delaySnapshot({ ...GRAPH_DELAY_INITIAL_STATE, ...patch, graphPatch: id, inputTrim: 0.75, level: 0.48,
    nodeMoving: index % 4 === 2, micMoving: index % 4 === 3,
    nodeMotionMode: ["wiggle", "orbit", "random"][index % 3], micMotionMode: ["circle", "figure8", "ellipse", "triangle"][index % 4],
  }),
})));
export function randomizeGraphDelayPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const snapshot = delaySnapshot({
    ...current.parameters, ...randomParameterValues({
      ...delayRanges, baseDelay: [35, 160], timeScale: [0, 250], nodePass: [0.5, 0.9], feedback: [0.2, 0.7],
      pitchScale: [0, 0.7], wet: [0.5, 1.1], dry: [0, 0.2], damping: [1200, 7500], inputTrim: [0.4, 0.85],
    }, rng), topology: rng.pick(Object.keys(GRAPH_PRESETS)), nodeCount: rng.integer(4, 12), seed: rng.integer(1, 99), density: rng.between(0.05, 0.45),
    graphPatch: "custom", level: current.parameters.level, nodeMoving: rng.pick([true, false]), micMoving: rng.pick([true, false]),
    nodeMotionMode: rng.pick(["wiggle", "orbit", "random"]), micMotionMode: rng.pick(["circle", "ellipse", "triangle", "square", "figure8", "random"]),
  });
  snapshot.graph.nodes.forEach(node => { node.x = rng.between(0.08, 0.92); node.y = rng.between(0.08, 0.92); });
  Object.keys(snapshot.edgeSwitches).forEach((key, i) => { snapshot.edgeSwitches[key] = i === 0 || rng.unit() > 0.15; });
  return validateGraphDelayPreset(snapshot);
}
export function graphSynthPresetKeys(defaults) {
  return Object.keys(defaults).filter(key => !GRAPH_SYNTH_LIVE_KEYS.includes(key));
}
export function captureGraphSynthPreset(state, graph, edgeSwitches, defaults) {
  return clonePresetData({ parameters: select(state, graphSynthPresetKeys(defaults)), graph, edgeSwitches: Object.fromEntries(edgeSwitches) });
}
export function validateGraphSynthPreset(s, defaults) {
  validateGraph(s, synthRanges);
  const p = s.parameters, keys = graphSynthPresetKeys(defaults);
  if (Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))
    || !["all", "leaves"].includes(p.triggerScope) || ![0.5, 1, 2, 4].includes(p.pulseDivision)
    || !["turn", "height", "degree", "progress"].includes(p.mappingMode)
    || !["pure", "equal", "just"].includes(p.tuningMode) || !Number.isInteger(p.edoDivisions)
    || !["sine", "triangle", "sawtooth", "square", "fm", "pm", "shepard"].includes(p.soundMode)
    || !["trigger", "edge"].includes(p.articulation) || ![1, 2, 4].includes(p.attackLaneCount)) throw new TypeError("Invalid Graph Synth musical settings");
  return s;
}
export function graphSynthFullPresets(defaults) {
  const patchIds = ["layeredGlass", "clearSteps", "branchChoir", "haloRing", "shortcutChorus", "hubScatter", "softMesh", "islandSignals",
    "clearSteps", "haloRing", "branchChoir", "softMesh"];
  const voices = ["fm", "sine", "triangle", "pm", "sawtooth", "shepard", "square", "fm", "sine", "pm", "fm", "shepard"];
  const names = ["First paths", "Soft footsteps", "Wooden choir", "Phase bells", "Brass shortcuts", "Endless spokes",
    "Pulse fabric", "Island replies", "Slow sweet path", "Nasty ring", "Fast branch chase", "Backward garden"];
  return patchIds.map((id, index) => {
    const patch = GRAPH_INSTRUMENT_PATCHES[id], p = { ...defaults, graphPatch: id };
    for (const key of ["topology", "nodeCount", "density", "seed", "baseDelay", "distanceRatio", "timeCurve", "nodePass", "feedback", "feedbackTone", "tempo"]) if (patch[key] !== undefined) p[key] = patch[key];
    Object.assign(p, { soundMode: voices[index], output: index === 9 ? 0.32 : 0.44,
      articulation: index % 3 === 1 ? "edge" : "trigger", attackLaneCount: [1, 2, 4][index % 3],
      attack: index === 8 ? 45 : 8 + index * 2, decay: 70 + index * 12, sustain: index % 3 === 0 ? 0.35 : 0.6,
      release: index === 8 ? 620 : 160 + index * 15, noteDuration: index === 8 ? 600 : 150 + index * 18,
      mappingMode: ["turn", "height", "degree", "progress"][index % 4], tuningMode: ["equal", "just", "pure"][index % 3],
      edoDivisions: index % 3 === 0 ? 19 : 12, modulationIndex: index === 9 ? 6 : 1 + index * 0.2,
      modulationRatio: index === 9 ? 0.7 : index % 2 ? 1 : 2, nodeMoving: index % 4 === 2,
      nodeMotionMode: ["wiggle", "orbit", "random"][index % 3], triggerScope: index === 7 ? "leaves" : "all",
    });
    if (index === 8) p.tempo = 54;
    if (index === 10) p.tempo = 204;
    const graph = generateGraph({ ...p, type: p.topology, maxNodes: 32 });
    return { id: `${id}-${index}`, label: `${patch.label} · ${names[index]}`,
      description: `Complete graph, ${p.soundMode}, ${p.tuningMode} tuning, ${p.articulation} articulation and ADSR; ${p.tempo} BPM. Audio/Play remain unchanged.`,
      snapshot: validateGraphSynthPreset({ parameters: select(p, graphSynthPresetKeys(defaults)), graph, edgeSwitches: switches(graph) }, defaults) };
  });
}
export function randomizeGraphSynthPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const p = { ...current.parameters, ...randomParameterValues({
    ...synthRanges, baseDelay: [35, 170], distanceRatio: [1, 3.5], feedback: [0.1, 0.65],
    attack: [5, 60], decay: [30, 250], release: [60, 550], noteDuration: [60, 450], tempo: [60, 200], modulationIndex: [0.1, 5],
  }, rng), graphPatch: "custom", topology: rng.pick(Object.keys(GRAPH_PRESETS)), nodeCount: rng.integer(4, 14), seed: rng.integer(1, 99),
    density: rng.between(0.05, 0.4), output: current.parameters.output, seedNote: rng.integer(36, 60), edoDivisions: rng.integer(5, 31),
    nodeMoving: rng.pick([true, false]), nodeMotionMode: rng.pick(["wiggle", "orbit", "random"]), pulseDivision: rng.pick([0.5, 1, 2, 4]),
    triggerScope: rng.pick(["all", "leaves"]), mappingMode: rng.pick(["turn", "height", "degree", "progress"]), tuningMode: rng.pick(["pure", "equal", "just"]),
    soundMode: rng.pick(["sine", "triangle", "sawtooth", "square", "fm", "pm", "shepard"]), articulation: rng.pick(["trigger", "edge"]), attackLaneCount: rng.pick([1, 2, 4]),
  };
  p.baseFrequency = 440 * 2 ** ((p.seedNote - 69) / 12);
  const graph = generateGraph({ ...p, type: p.topology, maxNodes: 32 });
  graph.nodes.forEach(node => { node.x = rng.between(0.08, 0.92); node.y = rng.between(0.08, 0.92); });
  const edgeSwitches = switches(graph);
  Object.keys(edgeSwitches).forEach((key, i) => { edgeSwitches[key] = i === 0 || rng.unit() > 0.12; });
  return validateGraphSynthPreset({ parameters: p, graph, edgeSwitches }, p);
}
