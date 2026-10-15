import { JULIA_DEFAULTS, JULIA_PRESETS } from "./julia.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const JULIA_EXPERIMENT_IDS = Object.freeze(["chorus", "canon", "wavelet", "orbit", "harmony"]);
export const JULIA_SYNTH_MODES = Object.freeze(["basic", "harmony"]);
export const JULIA_NUMBER_SPECS = Object.freeze({
  cReal: [-2, 0.5, 0.001], cImag: [-1.2, 1.2, 0.0001], maxIterations: [8, 192, 4], resolution: [96, 544, 8],
  simplify: [-3, 3, 0.05], speed: [0.001, 0.25, 0.001], turnOctaves: [0, 8, 0.05], cornerGlide: [0.05, 1, 0.01],
  baseFrequency: [20, 580, 1], shepardWidth: [1, 15, 0.1], motifWidth: [0.01, 0.1, 0.0025],
  similarityDepth: [1, 3, 1], similarityDuration: [2, 16, 0.5],
});
export const JULIA_PRESET_KEYS = Object.freeze([
  "presetId", "direction", "turnPolarity", "synthMode", "similarityExperiment", "similarityBranch", ...Object.keys(JULIA_NUMBER_SPECS),
]);

const NAMED = new Map(JULIA_PRESETS.map(preset => [preset.id, preset]));
const snap = (key, value) => {
  const [min, max, step] = JULIA_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};

/** True when the critical orbit stays bounded, so the Julia set is connected and has a closed boundary. */
export function juliaSetIsConnected(cReal, cImag, iterations = 400) {
  let x = 0, y = 0;
  for (let i = 0; i < iterations; i++) {
    [x, y] = [x * x - y * y + cReal, 2 * x * y + cImag];
    if (x * x + y * y > 4) return false;
  }
  return true;
}

export function captureJuliaPreset(state) {
  return {
    presetId: state.presetId, direction: state.direction >= 0 ? 1 : -1, turnPolarity: state.turnPolarity >= 0 ? 1 : -1,
    synthMode: state.synthMode, similarityExperiment: state.similarityExperiment,
    similarityBranch: state.similarityBranch >= 0 ? 1 : -1,
    ...Object.fromEntries(Object.keys(JULIA_NUMBER_SPECS).map(key => [key, state[key]])),
  };
}

export function validateJuliaPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Julia preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== JULIA_PRESET_KEYS.length) bad();
  for (const key of ["direction", "turnPolarity", "similarityBranch"]) [1, -1].includes(snapshot[key]) || bad();
  JULIA_SYNTH_MODES.includes(snapshot.synthMode) || bad();
  JULIA_EXPERIMENT_IDS.includes(snapshot.similarityExperiment) || bad();
  for (const [key, [min, max, step]] of Object.entries(JULIA_NUMBER_SPECS)) {
    const value = snapshot[key];
    if (typeof value !== "number" || value < min || value > max || (step === 1 && !Number.isInteger(value))) bad();
  }
  if (snapshot.presetId !== "custom") {
    const named = NAMED.get(snapshot.presetId) ?? bad();
    if (Math.abs(named.cReal - snapshot.cReal) > 1e-9 || Math.abs(named.cImag - snapshot.cImag) > 1e-9) bad();
  }
  if (snapshot.presetId === "custom") juliaSetIsConnected(snapshot.cReal, snapshot.cImag) || bad();
  return snapshot;
}

const DEFAULTS = Object.freeze({
  direction: 1, turnPolarity: 1, synthMode: "basic", similarityExperiment: "chorus", similarityBranch: 1,
  maxIterations: JULIA_DEFAULTS.maxIterations, resolution: JULIA_DEFAULTS.resolution, simplify: JULIA_DEFAULTS.contourTreatment,
  speed: JULIA_DEFAULTS.speed, turnOctaves: JULIA_DEFAULTS.turnOctaves, cornerGlide: 0.35,
  baseFrequency: JULIA_DEFAULTS.baseFrequency, shepardWidth: JULIA_DEFAULTS.shepardWidth,
  motifWidth: 0.025, similarityDepth: 3, similarityDuration: 8,
});

const scene = (id, label, constant, patch = {}) => {
  const named = NAMED.get(constant);
  const c = named ?? { cReal: constant[0], cImag: constant[1] };
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = {
    ...merged, presetId: named ? named.id : "custom", cReal: c.cReal, cImag: c.cImag,
    ...Object.fromEntries(Object.keys(JULIA_NUMBER_SPECS).filter(key => key !== "cReal" && key !== "cImag").map(key => [key, snap(key, merged[key])])),
  };
  if (named?.minimumResolution) snapshot.resolution = Math.max(snapshot.resolution, named.minimumResolution);
  if (named?.maximumSimplify !== undefined) snapshot.simplify = Math.min(snapshot.simplify, named.maximumSimplify);
  validateJuliaPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const JULIA_FULL_PRESETS = Object.freeze([
  scene("listening-default", "Listening default", "listening"),
  scene("finite-spiral", "Finite spiral", "spiral", { synthMode: "harmony", turnOctaves: 3.5, speed: 0.03, maxIterations: 48, similarityExperiment: "canon" }),
  scene("unit-circle-drone", "Unit circle drone", "circle", { turnOctaves: 1.5, baseFrequency: 110, shepardWidth: 12, speed: 0.008, cornerGlide: 0.8 }),
  scene("cauliflower-steps", "Cauliflower steps", "cauliflower", { turnOctaves: 6.5, cornerGlide: 0.1, speed: 0.06, baseFrequency: 220, turnPolarity: -1, simplify: 0.8 }),
  scene("san-marco-bells", "San Marco bells", "san-marco", { synthMode: "harmony", baseFrequency: 392, shepardWidth: 5, turnOctaves: 4, speed: 0.045, similarityExperiment: "wavelet" }),
  scene("basilica-pair", "Basilica pair", "basilica", { direction: -1, turnOctaves: 2.5, speed: 0.025, baseFrequency: 165, cornerGlide: 0.5, similarityBranch: -1, similarityExperiment: "orbit" }),
  scene("rabbit-run", "Douady rabbit run", "rabbit", { speed: 0.12, turnOctaves: 5.5, resolution: 384, maxIterations: 64, baseFrequency: 330, similarityExperiment: "harmony" }),
  scene("corabbit-mirror", "Co-rabbit mirror", "corabbit", { turnPolarity: -1, direction: -1, speed: 0.09, turnOctaves: 5.5, baseFrequency: 247, shepardWidth: 10 }),
  scene("airplane-glide", "Airplane glide", "airplane", { speed: 0.2, turnOctaves: 7, cornerGlide: 0.9, shepardWidth: 3, baseFrequency: 440, simplify: -1.5 }),
  scene("siegel-halo", "Siegel halo", "siegel", { synthMode: "harmony", turnOctaves: 2, speed: 0.015, baseFrequency: 130, shepardWidth: 14, motifWidth: 0.06, similarityDuration: 12 }),
  scene("sparse-tendrils", "Sparse tendrils", [-0.62, 0.43], { speed: 0.18, turnOctaves: 7.5, cornerGlide: 0.2, resolution: 448, maxIterations: 96, simplify: 1.2, baseFrequency: 520 }),
  scene("fern-spray", "Fern spray", [-0.1, 0.8], { speed: 0.07, turnOctaves: 3, resolution: 416, maxIterations: 120, baseFrequency: 180, synthMode: "harmony", similarityDepth: 2, similarityExperiment: "canon" }),
  scene("double-basilica", "Double basilica", [-1.25, 0], { speed: 0.035, turnOctaves: 3.2, cornerGlide: 0.4, baseFrequency: 147, shepardWidth: 9, direction: -1, similarityDuration: 6 }),
  scene("storm-filaments", "Storm filaments", [-0.5, 0.55], { speed: 0.1, turnOctaves: 4.5, cornerGlide: 0.65, turnPolarity: -1, baseFrequency: 90, shepardWidth: 6, similarityExperiment: "wavelet", motifWidth: 0.04 }),
]);

export function randomizeJuliaPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  let constant = null;
  for (let attempt = 0; attempt < 80 && !constant; attempt++) {
    const cReal = snap("cReal", rng.between(-1.9, 0.4)), cImag = snap("cImag", rng.between(-1, 1));
    if (juliaSetIsConnected(cReal, cImag)) constant = { cReal, cImag };
  }
  constant ??= { cReal: JULIA_DEFAULTS.cReal, cImag: JULIA_DEFAULTS.cImag };
  const next = {
    presetId: "custom", ...constant,
    direction: rng.unit() < 0.35 ? -1 : 1, turnPolarity: rng.unit() < 0.5 ? -1 : 1,
    synthMode: rng.pick(JULIA_SYNTH_MODES), similarityExperiment: rng.pick(JULIA_EXPERIMENT_IDS),
    similarityBranch: rng.unit() < 0.5 ? -1 : 1,
    maxIterations: snap("maxIterations", rng.between(24, 128)), resolution: snap("resolution", rng.between(256, 448)),
    simplify: snap("simplify", rng.between(-2, 1.5)), speed: snap("speed", 0.005 + rng.unit() ** 2 * 0.24),
    turnOctaves: snap("turnOctaves", rng.between(1, 7.5)), cornerGlide: snap("cornerGlide", rng.between(0.08, 1)),
    baseFrequency: snap("baseFrequency", 60 * 8 ** rng.unit()), shepardWidth: snap("shepardWidth", rng.between(2, 14)),
    motifWidth: snap("motifWidth", rng.between(0.015, 0.09)), similarityDepth: snap("similarityDepth", rng.integer(1, 3)),
    similarityDuration: snap("similarityDuration", rng.between(3, 14)),
  };
  return validateJuliaPreset(next);
}
