import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const RANGES = Object.freeze({
  count: [6, 48, 1], morph: [0, 1, 0.01], speed: [0.045, 0.24, 0.005],
  cohesion: [0, 1, 0.01], alignment: [0, 1, 0.01], separation: [0, 1, 0.01],
});
export const BOIDZOID_PRESET_KEYS = Object.freeze(Object.keys(RANGES));

const snap = (value, [min, max, step]) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number((Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min).toFixed(4));
};

export function captureBoidzoidPreset(state) {
  return Object.fromEntries(BOIDZOID_PRESET_KEYS.map(key => [key, snap(state[key], RANGES[key])]));
}

export function validateBoidzoidPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureBoidzoidPreset(snapshot))
    || Object.keys(snapshot).length !== BOIDZOID_PRESET_KEYS.length) {
    throw new TypeError("Invalid complete Boidzoid preset");
  }
  return snapshot;
}

const scene = (id, label, values) => Object.freeze({ id, label, snapshot: Object.freeze(captureBoidzoidPreset(values)) });

export const BOIDZOID_FULL_PRESETS = Object.freeze([
  scene("graze", "Graze", { count: 24, morph: 0.42, speed: 0.12, cohesion: 0.54, alignment: 0.68, separation: 0.72 }),
  scene("lull", "Lull", { count: 12, morph: 0.12, speed: 0.07, cohesion: 0.76, alignment: 0.82, separation: 0.48 }),
  scene("murmur", "Murmur", { count: 32, morph: 0.64, speed: 0.145, cohesion: 0.68, alignment: 0.8, separation: 0.58 }),
  scene("fury", "Fury", { count: 42, morph: 0.92, speed: 0.2, cohesion: 0.25, alignment: 0.38, separation: 0.92 }),
  scene("glacier-choir", "Glacier choir", { count: 8, morph: 0.05, speed: 0.048, cohesion: 0.95, alignment: 0.95, separation: 0.3 }),
  scene("swarm-cloud", "Swarm cloud", { count: 48, morph: 0.55, speed: 0.1, cohesion: 0.9, alignment: 0.2, separation: 0.35 }),
  scene("scattered-sparks", "Scattered sparks", { count: 36, morph: 0.8, speed: 0.23, cohesion: 0.05, alignment: 0.1, separation: 0.6 }),
  scene("wheeling-starlings", "Wheeling starlings", { count: 40, morph: 0.35, speed: 0.17, cohesion: 0.72, alignment: 0.97, separation: 0.55 }),
  scene("trio-dance", "Trio dance", { count: 6, morph: 0.7, speed: 0.13, cohesion: 0.6, alignment: 0.3, separation: 0.85 }),
  scene("crowded-hive", "Crowded hive", { count: 46, morph: 0.3, speed: 0.08, cohesion: 0.85, alignment: 0.5, separation: 1 }),
  scene("nervous-flicker", "Nervous flicker", { count: 20, morph: 1, speed: 0.24, cohesion: 0.4, alignment: 0.15, separation: 0.25 }),
  scene("slow-tide", "Slow tide", { count: 16, morph: 0.2, speed: 0.055, cohesion: 0.35, alignment: 0.88, separation: 0.4 }),
]);

export function applyBoidzoidPreset(state, snapshot) {
  validateBoidzoidPreset(snapshot);
  const countChanged = state.count !== snapshot.count;
  Object.assign(state, snapshot);
  return countChanged;
}

export function randomizeBoidzoidPreset(current, random = Math.random) {
  validateBoidzoidPreset(current);
  const rng = presetRandom(random);
  return validateBoidzoidPreset(captureBoidzoidPreset(Object.fromEntries(BOIDZOID_PRESET_KEYS.map(key => {
    const [min, max] = RANGES[key];
    return [key, rng.between(min, max)];
  }))));
}
