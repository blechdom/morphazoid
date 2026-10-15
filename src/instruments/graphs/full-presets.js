import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import {
  GRAPH_DELAY_PATCHES, GRAPH_PRESETS, MAX_GRAPH_TURN_ROUTES, generateGraphWithinTurnBudget,
} from "../graph-delay/graph-delay.js";
import { GRAPH_INSTRUMENT_PATCHES } from "../../families/graph/graph-instruments.js";
import { graphDistanceRatioFromTimeScale } from "./graphs-suite.js";
import {
  GRAPH_MODES, MODE_STATE_KEYS, graphInstrumentDefaultState, graphInstrumentPresetState,
} from "./graphs-state.js";

export const GRAPHS_MAX_NODES = 24;
const GRAPH_KEYS = Object.freeze([
  "topology", "nodeCount", "density", "seed", "baseDelay", "distanceRatio", "timeCurve",
  "nodePass", "feedback", "inputX", "inputY",
]);
const MOTION_KEYS = Object.freeze(["nodeMotionMode", "nodeMotionSpeed", "nodeMotionAmount", "nodeMoving"]);
const CLOCK_KEYS = Object.freeze(["tempo", "pulseDivision", "feedbackTone"]);
// Microphone input gain, device and permission live outside the scene.
const NOT_MUSICAL = new Set(["baseFrequency", "inputTrim"]);
export const GRAPHS_VOICE_KEYS = Object.freeze(Object.fromEntries(GRAPH_MODES.map(mode => [
  mode, Object.freeze(MODE_STATE_KEYS[mode].filter(key => !NOT_MUSICAL.has(key))),
])));

const RANGES = Object.freeze({
  nodeCount: [3, GRAPHS_MAX_NODES, true], density: [0, 1], seed: [1, 99, true], baseDelay: [20, 600],
  distanceRatio: [1, 12], timeCurve: [0.25, 3], nodePass: [0, 1], feedback: [0, 0.92],
  inputX: [0.02, 0.98], inputY: [0.02, 0.98],
  nodeMotionSpeed: [0.01, 0.5], nodeMotionAmount: [0.01, 0.3],
  tempo: [35, 220], feedbackTone: [0.2, 1],
  seedNote: [0, 127, true], pitchRange: [0, 5], edoDivisions: [1, 360, true], turnPitchScale: [0, 4],
  modulationIndex: [0, 12], modulationRatio: [0.25, 8], noteDuration: [20, 4000], attack: [1, 2000],
  decay: [5, 2400], sustain: [0, 1], release: [2, 5000], stereoSpread: [0, 1],
  pitchDepth: [0, 24, true], turnPitchDepth: [0, 24, true], characterDepth: [0, 1],
  pitchScale: [0, 2], pitchAsymmetry: [-0.8, 0.8], pitchCurve: [0.5, 2], pitchSlew: [10, 600],
  damping: [250, 14000], wet: [0, 1.5], dry: [0, 1], spread: [0, 1],
});
const ENUMS = Object.freeze({
  topology: Object.keys(GRAPH_PRESETS),
  nodeMotionMode: ["wiggle", "orbit", "random"],
  pulseDivision: [0.5, 1, 2, 4],
  triggerScope: ["all", "leaves"],
  attackLaneCount: [1, 2, 4],
  soundMode: ["sine", "triangle", "sawtooth", "square", "fm", "pm", "shepard"],
  tuningMode: ["pure", "equal", "just"],
  articulation: ["trigger", "edge"],
  percussionStyle: [
    "drum-bank", "circuit", "rattlesnake", "rattlesnake-physical", "resonant-metal",
    "karplus-strong", "karplus-tines", "karplus-objects",
  ],
});
const MAPPING_MODES = Object.freeze({
  synth: ["turn", "height", "degree", "progress"],
  drums: ["position-grid", "degree-turn", "path-phase"],
  mic: ["turn"],
});

const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));
const hasExactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => key in value);

const safeGraph = ({ topology, nodeCount, density, seed }) => generateGraphWithinTurnBudget({
  type: topology, nodeCount, density, seed, maxNodes: GRAPHS_MAX_NODES,
}, MAX_GRAPH_TURN_ROUTES);

/** Complete scene for the active playing mode; mode, Audio, transport, level and microphone input stay outside it. */
export function captureGraphsPreset({ mode, state, nodes, routes }) {
  const clock = mode === "mic" ? null : pick(state, CLOCK_KEYS);
  return {
    mode,
    graph: {
      ...pick(state, GRAPH_KEYS),
      positions: nodes.map(node => [node.x, node.y]),
      routes: routes.map(Boolean),
    },
    motion: pick(state, MOTION_KEYS),
    clock,
    voice: pick(state, GRAPHS_VOICE_KEYS[mode]),
  };
}

function checkValue(key, value) {
  const range = RANGES[key];
  if (range) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]
      || (range[2] && !Number.isInteger(value))) throw new TypeError(`Graphs preset ${key} is invalid`);
  } else if (ENUMS[key]) {
    if (!ENUMS[key].includes(value)) throw new TypeError(`Graphs preset ${key} is invalid`);
  }
}

export function validateGraphsPreset(snapshot) {
  if (!hasExactKeys(snapshot, ["mode", "graph", "motion", "clock", "voice"]) || !GRAPH_MODES.includes(snapshot.mode)) {
    throw new TypeError("Incomplete Graphs preset state");
  }
  const { mode, graph, motion, clock, voice } = snapshot;
  if (!hasExactKeys(graph, [...GRAPH_KEYS, "positions", "routes"])
    || !hasExactKeys(motion, MOTION_KEYS)
    || !hasExactKeys(voice, GRAPHS_VOICE_KEYS[mode])
    || (mode === "mic" ? clock !== null : !hasExactKeys(clock, CLOCK_KEYS))) {
    throw new TypeError("Incomplete Graphs preset state");
  }
  for (const group of [graph, motion, clock ?? {}, voice]) {
    for (const [key, value] of Object.entries(group)) if (key !== "positions" && key !== "routes") checkValue(key, value);
  }
  if (typeof motion.nodeMoving !== "boolean") throw new TypeError("Graphs preset nodeMoving is invalid");
  if (!MAPPING_MODES[mode].includes(voice.mappingMode ?? "turn")) throw new TypeError("Graphs preset mappingMode is invalid");
  const generated = safeGraph(graph);
  if (generated.limited || !Array.isArray(graph.positions) || graph.positions.length !== graph.nodeCount
    || graph.positions.some(point => !Array.isArray(point) || point.length !== 2
      || point.some(axis => typeof axis !== "number" || !Number.isFinite(axis) || axis < 0 || axis > 1))
    || !Array.isArray(graph.routes) || graph.routes.length !== generated.graph.edges.length
    || graph.routes.some(route => typeof route !== "boolean")) {
    throw new TypeError("Graphs preset graph does not match its topology");
  }
  presetStateKey(snapshot);
  return JSON.parse(JSON.stringify(snapshot));
}

const GENERIC_GRAPH_KEYS = ["topology", "nodeCount", "density", "seed", "baseDelay", "timeCurve", "nodePass", "feedback"];

function genericPatchState(name) {
  const patch = GRAPH_DELAY_PATCHES[name];
  return {
    ...pick(patch, GENERIC_GRAPH_KEYS),
    distanceRatio: graphDistanceRatioFromTimeScale(patch.baseDelay, patch.timeScale),
  };
}

function eventPatchState(name, mode) {
  return graphInstrumentPresetState(name, mode) ?? genericPatchState(name);
}

function scene(mode, id, label, description, state) {
  const full = { ...graphInstrumentDefaultState(mode === "drums" ? "drums" : "synth"), ...state };
  const generated = safeGraph(full);
  full.density = generated.density;
  const nodes = generated.graph.nodes.map(node => ({
    x: Math.round(node.x * 1e4) / 1e4, y: Math.round(node.y * 1e4) / 1e4,
  }));
  const routes = generated.graph.edges.map(() => true);
  const snapshot = captureGraphsPreset({ mode, state: full, nodes, routes });
  return Object.freeze({ id: `${mode}-${id}`, label, description, snapshot: Object.freeze(snapshot) });
}

const synth = (patch, id, label, description, voice) => scene("synth", id, label, description, {
  ...eventPatchState(patch, "synth"), ...voice,
});
const drums = (patch, id, label, description, voice = {}) => scene("drums", id, label, description, {
  ...eventPatchState(patch, "drums"), ...voice,
});
const mic = name => {
  const patch = GRAPH_DELAY_PATCHES[name];
  const id = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  return scene("mic", id, patch.label, patch.description, {
    ...pick(patch, [...GENERIC_GRAPH_KEYS, "pitchScale", "pitchAsymmetry", "pitchCurve", "pitchSlew", "damping", "wet", "dry", "spread"]),
    distanceRatio: graphDistanceRatioFromTimeScale(patch.baseDelay, patch.timeScale),
  });
};

const SYNTH_PRESETS = [
  synth("layeredGlass", "layered-glass", "Layered Glass · FM", "Crossing DAG taps with a bright FM voice and a tight cascade.", {}),
  synth("clearSteps", "clear-steps", "Clear Steps · Chip square", "Four even steps twice a beat on a short, dry square wave.", {
    soundMode: "square", tuningMode: "equal", edoDivisions: 12, pitchRange: 1.5, turnPitchScale: 0.5,
    noteDuration: 90, attack: 2, decay: 60, sustain: 0.2, release: 80, stereoSpread: 0.5,
  }),
  synth("branchChoir", "branch-choir", "Branch Choir · Just pad", "A slow tree blooms in just-intoned triangle waves with long tails.", {
    soundMode: "triangle", tuningMode: "just", mappingMode: "degree", pitchRange: 2.5, turnPitchScale: 1.6,
    seedNote: 48, noteDuration: 1200, attack: 250, decay: 400, sustain: 0.7, release: 1400, stereoSpread: 1,
  }),
  synth("haloRing", "halo-ring", "Halo Ring · Shepard", "An endless falling halo: Shepard tones gated by the ring's edges.", {
    soundMode: "shepard", tuningMode: "equal", edoDivisions: 12, mappingMode: "progress", pitchRange: 3,
    turnPitchScale: 1, articulation: "edge", attack: 30, decay: 200, sustain: 0.8, release: 500,
  }),
  synth("shortcutChorus", "shortcut-chorus", "Shortcut Chorus · 31-tone saw", "Crooked shortcuts in 31 equal divisions with a biting sawtooth.", {
    soundMode: "sawtooth", tuningMode: "equal", edoDivisions: 31, mappingMode: "height", pitchRange: 3.5,
    turnPitchScale: 2.4, seedNote: 52, noteDuration: 140, attack: 4, decay: 120, sustain: 0.3, release: 160,
  }),
  synth("hubScatter", "hub-scatter", "Hub Scatter · PM bells", "Rapid spokes ring as pure-ratio phase-modulation bells in two lanes.", {
    soundMode: "pm", modulationIndex: 4.5, modulationRatio: 3.5, tuningMode: "pure", pitchRange: 4,
    turnPitchScale: 0.8, seedNote: 69, noteDuration: 70, attack: 1, decay: 260, sustain: 0.1, release: 900,
    attackLaneCount: 2,
  }),
  synth("softMesh", "soft-mesh", "Soft Mesh · Sine haze", "Clustered calls in 24 equal divisions, soft sine swells and a wide stereo field.", {
    soundMode: "sine", tuningMode: "equal", edoDivisions: 24, mappingMode: "degree", pitchRange: 1.2,
    turnPitchScale: 0.7, seedNote: 55, noteDuration: 400, attack: 120, decay: 500, sustain: 0.6, release: 1600,
    stereoSpread: 0.95,
  }),
  synth("islandSignals", "island-signals", "Island Signals · FM glass", "Three islands trade calls in four lanes of glassy, just-tuned FM.", {
    soundMode: "fm", modulationIndex: 6, modulationRatio: 1.41, tuningMode: "just", pitchRange: 2,
    turnPitchScale: 2, seedNote: 62, noteDuration: 600, attack: 15, decay: 700, sustain: 0.15, release: 2200,
    attackLaneCount: 4,
  }),
  synth("rainLattice", "rain-lattice", "Rain Lattice · Triangle drops", "A dense DAG of fast triangle droplets on a 19-division lattice.", {
    soundMode: "triangle", tuningMode: "equal", edoDivisions: 19, pitchRange: 2.2, tempo: 132, pulseDivision: 0.5,
    seedNote: 60, noteDuration: 120, attack: 3, decay: 90, sustain: 0.2, release: 260,
  }),
  synth("twinBanks", "twin-banks", "Twin Banks · Square duet", "Two parallel node banks answer each other in just-tuned square tones.", {
    soundMode: "square", tuningMode: "just", pitchRange: 1.8, attackLaneCount: 2, tempo: 84, pulseDivision: 2,
    seedNote: 50, noteDuration: 320, attack: 10, decay: 200, sustain: 0.5, release: 500,
  }),
  synth("slowOrbit", "slow-orbit", "Slow Orbit · Saw drone", "A slow ring with edge-gated sawtooth that swells and falls like a drone.", {
    soundMode: "sawtooth", tuningMode: "pure", articulation: "edge", tempo: 66, pulseDivision: 4, seedNote: 43,
    pitchRange: 1.4, attack: 400, decay: 600, sustain: 0.85, release: 1800, stereoSpread: 0.7,
  }),
  synth("dustPaths", "dust-paths", "Dust Paths · FM flicker", "A sparse random graph flickers with high-index, inharmonic FM.", {
    soundMode: "fm", modulationIndex: 8, modulationRatio: 5, tuningMode: "equal", edoDivisions: 17,
    tempo: 110, pulseDivision: 1, seedNote: 64, noteDuration: 90, attack: 1, decay: 140, sustain: 0.1, release: 320,
  }),
];

const DRUM_PRESETS = [
  drums("layeredGlass", "layered-glass", "Layered Glass · Circuit", "A tight circuit-percussion cascade on every beat."),
  drums("clearSteps", "clear-steps", "Clear Steps · Path phase", "Crisp four-step circuit hits in path-phase mapping, twice per beat."),
  drums("branchChoir", "branch-choir", "Branch Choir · Karplus", "Slow plucked-string percussion blooming down a tree."),
  drums("haloRing", "halo-ring", "Halo Ring · Metal", "A resonant-metal orbit with a measured two-beat halo."),
  drums("shortcutChorus", "shortcut-chorus", "Shortcut Chorus · Rattle", "Rattlesnake hits scatter through crooked shortcuts.", { attackLaneCount: 2 }),
  drums("hubScatter", "hub-scatter", "Hub Scatter · Drum bank", "Fast spokes strike the sampled drum bank from a central hub."),
  drums("softMesh", "soft-mesh", "Soft Mesh · Tines", "Soft Karplus tines answer in slow, damped clusters."),
  drums("islandSignals", "island-signals", "Island Signals · Objects", "Karplus objects trade calls across long island bridges."),
  drums("rainLattice", "rain-lattice", "Rain Lattice · Physical rattle", "Dense droplets on a physically modelled rattle.", {
    percussionStyle: "rattlesnake-physical", mappingMode: "position-grid", tempo: 138, pulseDivision: 0.5,
    pitchDepth: 14, turnPitchDepth: 6, characterDepth: 0.9, seedNote: 58,
  }),
  drums("twinBanks", "twin-banks", "Twin Banks · Two-lane metal", "Parallel banks of resonant metal separated into two lanes.", {
    percussionStyle: "resonant-metal", mappingMode: "degree-turn", tempo: 92, pulseDivision: 2, attackLaneCount: 2,
    pitchDepth: 10, turnPitchDepth: 12, characterDepth: 0.6, seedNote: 48,
  }),
  drums("slowOrbit", "slow-orbit", "Slow Orbit · Deep bank", "A slow ring of low drum-bank hits under a long four-beat pulse.", {
    percussionStyle: "drum-bank", mappingMode: "path-phase", tempo: 70, pulseDivision: 4, triggerScope: "leaves",
    pitchDepth: 6, turnPitchDepth: 4, characterDepth: 0.4, seedNote: 40,
  }),
  drums("dustPaths", "dust-paths", "Dust Paths · Tines flurry", "A sparse random graph flurries into bright plucked tines.", {
    percussionStyle: "karplus-tines", mappingMode: "position-grid", tempo: 142, pulseDivision: 1,
    pitchDepth: 22, turnPitchDepth: 16, characterDepth: 0.95, seedNote: 67,
  }),
];

const MIC_PRESETS = Object.keys(GRAPH_DELAY_PATCHES).map(mic);

export const GRAPHS_FULL_PRESETS = Object.freeze([...SYNTH_PRESETS, ...DRUM_PRESETS, ...MIC_PRESETS]);

const between = (rng, minimum, maximum) => rng.between(minimum, maximum);
const logBetween = (rng, minimum, maximum) => Math.exp(rng.between(Math.log(minimum), Math.log(maximum)));
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function randomVoice(mode, rng) {
  if (mode === "synth") {
    return {
      mappingMode: rng.pick(MAPPING_MODES.synth), seedNote: rng.integer(36, 84), pitchRange: between(rng, 0.5, 4),
      tuningMode: rng.pick(ENUMS.tuningMode), edoDivisions: rng.integer(5, 31), turnPitchScale: between(rng, 0.2, 3),
      soundMode: rng.pick(ENUMS.soundMode), modulationIndex: between(rng, 0, 8), modulationRatio: between(rng, 0.5, 5),
      articulation: rng.pick(ENUMS.articulation), noteDuration: logBetween(rng, 60, 1500),
      attack: logBetween(rng, 1, 400), decay: logBetween(rng, 20, 1200), sustain: between(rng, 0.05, 0.9),
      release: logBetween(rng, 30, 1800), stereoSpread: between(rng, 0.2, 1),
      triggerScope: rng.pick(ENUMS.triggerScope), attackLaneCount: rng.pick(ENUMS.attackLaneCount),
    };
  }
  if (mode === "drums") {
    return {
      mappingMode: rng.pick(MAPPING_MODES.drums), seedNote: rng.integer(36, 84),
      percussionStyle: rng.pick(ENUMS.percussionStyle), pitchDepth: rng.integer(0, 24),
      turnPitchDepth: rng.integer(0, 24), characterDepth: between(rng, 0, 1),
      triggerScope: rng.pick(ENUMS.triggerScope), attackLaneCount: rng.pick(ENUMS.attackLaneCount),
    };
  }
  return {
    pitchScale: between(rng, 0, 1.2), pitchAsymmetry: between(rng, -0.6, 0.6), pitchCurve: between(rng, 0.6, 1.8),
    pitchSlew: between(rng, 40, 400), damping: logBetween(rng, 800, 12000), wet: between(rng, 0.6, 1.4),
    dry: between(rng, 0, 0.5), spread: between(rng, 0.3, 1),
  };
}

/** Seedable full-scene dice for the current playing mode; `allowMotion` is false under reduced motion. */
export function randomizeGraphsPreset(current, random = Math.random, { allowMotion = true } = {}) {
  const { mode } = validateGraphsPreset(current);
  const rng = presetRandom(random);
  const requested = {
    topology: rng.pick(ENUMS.topology),
    nodeCount: Math.round(5 + rng.unit() ** 1.5 * (GRAPHS_MAX_NODES - 5)),
    density: round(between(rng, 0.1, 0.8)),
    seed: rng.integer(1, 99),
  };
  const generated = safeGraph(requested);
  const positions = generated.graph.nodes.map(node => [
    round(Math.min(0.98, Math.max(0.02, node.x + between(rng, -0.04, 0.04))), 4),
    round(Math.min(0.98, Math.max(0.02, node.y + between(rng, -0.04, 0.04))), 4),
  ]);
  const routes = generated.graph.edges.map((_, index) => index === 0 || rng.unit() > 0.12);
  const moving = allowMotion && rng.unit() < 0.25;
  return validateGraphsPreset({
    mode,
    graph: {
      ...requested, density: generated.density,
      baseDelay: logBetween(rng, 24, 260), distanceRatio: logBetween(rng, 1.1, 10),
      timeCurve: between(rng, 0.45, 2), nodePass: between(rng, 0.55, 1), feedback: between(rng, 0.2, 0.88),
      inputX: between(rng, 0.04, 0.5), inputY: between(rng, 0.15, 0.85), positions, routes,
    },
    motion: {
      nodeMotionMode: rng.pick(ENUMS.nodeMotionMode), nodeMotionSpeed: between(rng, 0.03, 0.4),
      nodeMotionAmount: between(rng, 0.02, 0.2), nodeMoving: moving,
    },
    clock: mode === "mic" ? null : {
      tempo: between(rng, 50, 200), pulseDivision: rng.pick(ENUMS.pulseDivision), feedbackTone: between(rng, 0.4, 0.95),
    },
    voice: randomVoice(mode, rng),
  });
}
