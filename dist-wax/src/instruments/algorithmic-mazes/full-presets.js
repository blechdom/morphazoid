import { MAZE_ALGORITHMS, MAZE_LIMITS, MAZE_TOPOLOGIES } from "./algorithmic-mazes.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const MAZE_MODE_IDS = Object.freeze(["carve", "wander", "solve", "survey"]);
export const MAZE_CYCLE_IDS = Object.freeze(["hold", "loop", "evolve"]);
export const MAZE_ENGINE_IDS = Object.freeze(["sine", "fm", "pm", "shepard"]);
export const MAZE_PASSAGE_PITCH_IDS = Object.freeze(["depth", "height", "turn", "route"]);
export const MAZE_WALL_PITCH_IDS = Object.freeze(["orientation", "height", "contour", "component"]);
const ALGORITHM_IDS = MAZE_ALGORITHMS.map(({ id }) => id);
const TOPOLOGY_IDS = MAZE_TOPOLOGIES.map(({ id }) => id);

export const MAZE_NUMBER_SPECS = Object.freeze({
  size: [MAZE_LIMITS.size[0], MAZE_LIMITS.size[1], 1], seed: [MAZE_LIMITS.seed[0], MAZE_LIMITS.seed[1], 1],
  braid: [MAZE_LIMITS.braid[0], MAZE_LIMITS.braid[1], 0.01], speed: [0.005, 0.3, 0.001],
  passageHeads: [0, 8, 1], wallHeads: [0, 8, 1], passageLevel: [0, 1, 0.01], wallLevel: [0, 1, 0.01],
  rootFrequency: [32, 220, 0.5], pitchRange: [0, 48, 1], wallOffset: [-24, 36, 1], nodeAccent: [0, 1, 0.01],
});
const CHOICES = Object.freeze({
  algorithm: ALGORITHM_IDS, topology: TOPOLOGY_IDS, mode: MAZE_MODE_IDS, cycleBehavior: MAZE_CYCLE_IDS,
  voiceEngine: MAZE_ENGINE_IDS, passagePitch: MAZE_PASSAGE_PITCH_IDS, wallPitch: MAZE_WALL_PITCH_IDS,
});
const FLAGS = Object.freeze(["direction", "showPotential", "showSolution"]);
export const MAZE_PRESET_KEYS = Object.freeze([...Object.keys(CHOICES), ...Object.keys(MAZE_NUMBER_SPECS), ...FLAGS]);

const snap = (key, value) => {
  const [min, max, step] = MAZE_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};

export function captureMazePreset(state) {
  return Object.fromEntries(MAZE_PRESET_KEYS.map(key => [key, state[key]]));
}

export function validateMazePreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Algorithmic Mazes preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== MAZE_PRESET_KEYS.length) bad();
  for (const [key, values] of Object.entries(CHOICES)) if (!values.includes(snapshot[key])) bad();
  for (const [key, [min, max]] of Object.entries(MAZE_NUMBER_SPECS)) {
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  if (!Number.isInteger(snapshot.size) || !Number.isInteger(snapshot.seed)) bad();
  if (snapshot.direction !== 1 && snapshot.direction !== -1) bad();
  if (typeof snapshot.showPotential !== "boolean" || typeof snapshot.showSolution !== "boolean") bad();
  if (snapshot.mode === "solve" && !snapshot.showSolution) bad();
  return snapshot;
}

const DEFAULTS = Object.freeze({
  algorithm: "backtracker", topology: "orthogonal", mode: "carve", cycleBehavior: "hold", voiceEngine: "fm",
  passagePitch: "depth", wallPitch: "orientation", size: 17, seed: 7347, braid: 0.14, speed: 0.045,
  passageHeads: 1, wallHeads: 1, passageLevel: 0.72, wallLevel: 0.54, rootFrequency: 82.5, pitchRange: 24,
  wallOffset: 12, nodeAccent: 0.38, direction: 1, showPotential: true, showSolution: false,
});

const scene = (id, label, patch = {}) => {
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = Object.fromEntries(MAZE_PRESET_KEYS.map(key => [key, MAZE_NUMBER_SPECS[key] ? snap(key, merged[key]) : merged[key]]));
  validateMazePreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const MAZE_FULL_PRESETS = Object.freeze([
  scene("long-corridor-build", "Long corridor build"),
  scene("radial-wilson-trace", "Radial Wilson trace", { algorithm: "wilson", topology: "radial", mode: "wander", seed: 2024, size: 17, braid: 0.14, passageHeads: 3, wallHeads: 1, voiceEngine: "sine", passagePitch: "route", speed: 0.03 }),
  scene("hex-prim-chimes", "Hex Prim chimes", { algorithm: "prim", topology: "hexagonal", mode: "carve", seed: 913, size: 14, braid: 0.3, speed: 0.09, voiceEngine: "pm", rootFrequency: 130, pitchRange: 30, nodeAccent: 0.8, cycleBehavior: "loop" }),
  scene("kruskal-island-solve", "Kruskal island solve", { algorithm: "kruskal", topology: "orthogonal", mode: "solve", showSolution: true, seed: 5521, size: 22, braid: 0.05, passageHeads: 2, wallHeads: 0, passagePitch: "height", speed: 0.06, rootFrequency: 65 }),
  scene("braided-hall-tour", "Braided hall tour", { algorithm: "wilson", topology: "orthogonal", mode: "survey", seed: 8800, size: 12, braid: 0.7, passageHeads: 4, wallHeads: 3, voiceEngine: "shepard", passagePitch: "turn", wallPitch: "contour", speed: 0.04 }),
  scene("wall-choir", "Wall choir", { algorithm: "backtracker", topology: "radial", mode: "wander", seed: 313, size: 20, passageHeads: 0, wallHeads: 6, wallLevel: 0.9, passageLevel: 0.2, wallPitch: "component", wallOffset: -12, voiceEngine: "fm", rootFrequency: 55, pitchRange: 36 }),
  scene("tiny-maze-music-box", "Tiny maze music box", { algorithm: "prim", topology: "orthogonal", mode: "carve", seed: 77, size: 7, braid: 0.1, speed: 0.2, voiceEngine: "sine", rootFrequency: 196, pitchRange: 18, wallOffset: 19, nodeAccent: 0.9, passageHeads: 2, cycleBehavior: "loop" }),
  scene("huge-radial-drone", "Huge radial drone", { algorithm: "wilson", topology: "radial", mode: "survey", seed: 42042, size: 28, braid: 0.2, speed: 0.008, voiceEngine: "shepard", rootFrequency: 36, pitchRange: 12, passageHeads: 5, wallHeads: 5, passageLevel: 0.6, wallLevel: 0.6, nodeAccent: 0.1, direction: -1 }),
  scene("evolving-hex", "Evolving hex garden", { algorithm: "kruskal", topology: "hexagonal", mode: "carve", seed: 1200, size: 16, braid: 0.4, speed: 0.12, cycleBehavior: "evolve", voiceEngine: "fm", passagePitch: "turn", rootFrequency: 98, pitchRange: 26 }),
  scene("reverse-backtrack", "Reverse backtrack", { algorithm: "backtracker", topology: "hexagonal", mode: "wander", direction: -1, seed: 3141, size: 13, speed: 0.07, passageHeads: 2, wallHeads: 2, voiceEngine: "pm", wallPitch: "height", passagePitch: "height", rootFrequency: 110 }),
  scene("clean-route-line", "Clean route line", { algorithm: "wilson", topology: "orthogonal", mode: "solve", showSolution: true, showPotential: false, seed: 999, size: 26, braid: 0, passageHeads: 1, wallHeads: 0, voiceEngine: "sine", passagePitch: "route", speed: 0.05, rootFrequency: 82.5, pitchRange: 40 }),
  scene("dense-lattice-swarm", "Dense lattice swarm", { algorithm: "prim", topology: "orthogonal", mode: "wander", seed: 6006, size: 24, braid: 0.82, passageHeads: 8, wallHeads: 4, passageLevel: 0.5, wallLevel: 0.4, voiceEngine: "fm", rootFrequency: 74, pitchRange: 14, wallOffset: 7, nodeAccent: 0.6, speed: 0.1 }),
  scene("slow-wall-bells", "Slow wall bells", { algorithm: "kruskal", topology: "radial", mode: "survey", seed: 270, size: 9, braid: 0.5, passageHeads: 1, wallHeads: 3, wallLevel: 0.85, voiceEngine: "pm", wallPitch: "contour", wallOffset: 24, rootFrequency: 150, pitchRange: 20, speed: 0.015, nodeAccent: 0.2 }),
]);

export function randomizeMazePreset(current, random = Math.random) {
  validateMazePreset(current);
  const rng = presetRandom(random);
  const range = (key, lo = MAZE_NUMBER_SPECS[key][0], hi = MAZE_NUMBER_SPECS[key][1]) => snap(key, rng.between(lo, hi));
  const mode = rng.pick(MAZE_MODE_IDS);
  const heads = () => (rng.unit() < 0.15 ? 0 : range("passageHeads", 1, 6));
  const passageHeads = heads();
  const wallHeads = passageHeads === 0 ? range("wallHeads", 1, 6) : (rng.unit() < 0.2 ? 0 : range("wallHeads", 1, 6));
  return validateMazePreset({
    algorithm: rng.pick(ALGORITHM_IDS), topology: rng.pick(TOPOLOGY_IDS), mode, cycleBehavior: rng.pick(MAZE_CYCLE_IDS),
    voiceEngine: rng.pick(MAZE_ENGINE_IDS), passagePitch: rng.pick(MAZE_PASSAGE_PITCH_IDS), wallPitch: rng.pick(MAZE_WALL_PITCH_IDS),
    size: range("size", 7, 26), seed: range("seed"), braid: range("braid", 0, 0.8),
    speed: snap("speed", 0.01 * 20 ** rng.unit()), passageHeads, wallHeads,
    passageLevel: range("passageLevel", 0.3, 1), wallLevel: range("wallLevel", 0.3, 1),
    rootFrequency: snap("rootFrequency", 34 * 6 ** rng.unit()), pitchRange: range("pitchRange", 6, 44),
    wallOffset: range("wallOffset"), nodeAccent: range("nodeAccent"),
    direction: rng.unit() < 0.3 ? -1 : 1, showPotential: rng.unit() < 0.7,
    showSolution: mode === "solve" || rng.unit() < 0.3,
  });
}
