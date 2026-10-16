import { LIVE_AXIS_IDS, LIVE_DEFAULTS } from "./recursion-live.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const RECURSION_RENDER_KEYS = Object.freeze(["depth", "pace", "transform", "intensity"]);
const RANGES = Object.freeze({ depth: [1, 8], pace: [2, 6], transform: [0.08, 0.9], intensity: [0.1, 1] });

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function captureRecursionPreset(source) {
  const defaults = { depth: 7, pace: 3.6, transform: 0.72, intensity: 0.8 };
  const render = Object.fromEntries(RECURSION_RENDER_KEYS.map(key => [key, num(source[key], ...RANGES[key], defaults[key])]));
  render.depth = Math.round(render.depth);
  return {
    ...render,
    accumulate: Boolean(source.accumulate),
    live: Object.fromEntries(LIVE_AXIS_IDS.map(axis => [axis, num(source.live?.[axis], 0, 1, LIVE_DEFAULTS[axis])])),
  };
}

export function validateRecursionPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureRecursionPreset(snapshot))) {
    throw new TypeError("Invalid complete Recursion preset");
  }
  return snapshot;
}

const scene = (id, label, [depth, pace, transform, intensity], accumulate, [timbre, pitch, rhythm, phrase, twist, memory]) => Object.freeze({
  id, label, snapshot: Object.freeze(captureRecursionPreset({
    depth, pace, transform, intensity, accumulate, live: { timbre, pitch, rhythm, phrase, twist, memory },
  })),
});

export const RECURSION_FULL_PRESETS = Object.freeze([
  scene("fuzzy-donut", "Fuzzy Donut", [7, 3.6, 0.72, 0.8], true, [0.64, 0.5, 0.78, 0.52, 0.62, 0.74]),
  scene("shallow-loop", "Shallow loop", [2, 2.4, 0.3, 0.5], true, [0.5, 0.5, 0.3, 0.3, 0.2, 0.3]),
  scene("slow-descent", "Slow descent", [8, 5.8, 0.55, 0.45], true, [0.35, 0.3, 0.2, 0.7, 0.4, 0.85]),
  scene("dark-tail", "Dark tail", [5, 4.4, 0.85, 0.7], true, [0.12, 0.35, 0.4, 0.6, 0.3, 0.9]),
  scene("bright-glitter", "Bright glitter", [6, 2.2, 0.4, 0.9], true, [0.95, 0.72, 0.92, 0.25, 0.8, 0.5]),
  scene("solo-generation", "Solo generation", [4, 3, 0.6, 0.6], false, [0.55, 0.5, 0.5, 0.5, 0.5, 0.74]),
  scene("rising-twist", "Rising twist", [6, 3.2, 0.5, 0.75], true, [0.7, 0.85, 0.6, 0.55, 0.95, 0.65]),
  scene("falling-memory", "Falling memory", [7, 4.8, 0.78, 0.55], true, [0.4, 0.12, 0.35, 0.8, 0.25, 0.95]),
  scene("stutter-field", "Stutter field", [5, 2.6, 0.2, 0.85], true, [0.6, 0.5, 1, 0.1, 0.55, 0.4]),
  scene("phrase-cloud", "Phrase cloud", [8, 4, 0.66, 0.35], true, [0.5, 0.6, 0.45, 0.98, 0.7, 0.8]),
  scene("pressure-cooker", "Pressure cooker", [8, 2, 0.9, 1], true, [0.85, 0.55, 0.9, 0.5, 0.85, 1]),
  scene("quiet-ancestors", "Quiet ancestors", [3, 5.2, 0.45, 0.2], true, [0.3, 0.45, 0.15, 0.4, 0.15, 0.6]),
  scene("dry-solo-glass", "Dry solo glass", [4, 2.8, 0.35, 0.65], false, [0.9, 0.65, 0.7, 0.2, 0.6, 0.2]),
]);

export function randomizeRecursionPreset(current, random = Math.random) {
  validateRecursionPreset(current);
  const rng = presetRandom(random);
  const round = (value, step) => Math.round(value / step) * step;
  const next = {
    depth: rng.integer(1, 8), pace: round(rng.between(2, 6), 0.1), transform: round(rng.between(0.1, 0.88), 0.01),
    intensity: round(rng.between(0.15, 1), 0.01), accumulate: rng.unit() < 0.7,
    live: Object.fromEntries(LIVE_AXIS_IDS.map(axis => [axis, round(rng.unit(), 0.01)])),
  };
  return validateRecursionPreset(captureRecursionPreset(next));
}
