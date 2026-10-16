import {
  WAVE_POOL_BOUNDARIES, WAVE_POOL_GENERATORS, WAVE_POOL_LANE_IDS, WAVE_POOL_LIMITS, WAVE_POOL_PRESETS,
  WAVE_POOL_RECEIVERS, WAVE_POOL_SEQUENCE_LENGTH, createWavePoolState, sanitizeWavePoolState,
} from "./wave-pool.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const STEPS = Object.freeze({
  tempoBpm: 1, swing: 0.01, depthM: 0.05, waveHeightM: 0.01, wavePeriodSeconds: 0.1, paddleForce: 0.01, paddleCount: 1,
  phaseSpread: 0.01, breaking: 0.01, bubbleDensity: 0.01, bubbleSize: 0.1, splash: 0.01, wallImpact: 0.01,
  whirlpool: 0.01, aeration: 0.01, damping: 0.01, panelTone: 0.01, machinery: 0.01, widthM: 0.5,
});
export const WAVE_POOL_NUMERIC_KEYS = Object.freeze(Object.keys(STEPS));
export const WAVE_POOL_ID_KEYS = Object.freeze(["generatorId", "boundaryId", "receiverId"]);
export const WAVE_POOL_PRESET_KEYS = Object.freeze([...WAVE_POOL_ID_KEYS, ...WAVE_POOL_NUMERIC_KEYS, "pattern"]);

const plainPattern = pattern => Object.fromEntries(WAVE_POOL_LANE_IDS.map((lane, index) => {
  const row = Array.isArray(pattern) ? pattern[index] : pattern?.[lane];
  return [lane, Array.from({ length: WAVE_POOL_SEQUENCE_LENGTH }, (_, step) => Number(row?.[step] ?? 0))];
}));

export function captureWavePoolPreset(state) {
  const clean = sanitizeWavePoolState(state);
  return {
    ...Object.fromEntries(WAVE_POOL_PRESET_KEYS.filter(key => key !== "pattern").map(key => [key, clean[key]])),
    pattern: plainPattern(clean.pattern),
  };
}

export function validateWavePoolPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== WAVE_POOL_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureWavePoolPreset(snapshot))) {
    throw new TypeError("Invalid complete Wave Pool preset");
  }
  return snapshot;
}

export function wavePoolStateFromPreset(state, snapshot) {
  validateWavePoolPreset(snapshot);
  return sanitizeWavePoolState({ ...state, ...snapshot, level: state.level }, state);
}

const hits = (spec = {}) => Object.fromEntries(WAVE_POOL_LANE_IDS.map(lane => {
  const row = Array(WAVE_POOL_SEQUENCE_LENGTH).fill(0);
  for (const [step, amount] of spec[lane] ?? []) row[step] = amount;
  return [lane, row];
}));

const scene = (id, label, values, pattern) => {
  const state = pattern ? createWavePoolState("family-surge", { ...values, pattern: hits(pattern) }) : createWavePoolState(id, values);
  return Object.freeze({ id, label, snapshot: Object.freeze(captureWavePoolPreset(state)) });
};

const existing = WAVE_POOL_PRESETS.map(preset => scene(preset.id, preset.label, {}));
const authored = [
  scene("tidal-bore", "Tidal bore", {
    generatorId: "pneumatic", boundaryId: "concrete", receiverId: "underwater", tempoBpm: 56, swing: 0.05, depthM: 2.2, waveHeightM: 0.75,
    wavePeriodSeconds: 5.4, paddleForce: 0.9, paddleCount: 3, phaseSpread: 0.12, breaking: 0.95, bubbleDensity: 0.7, bubbleSize: 8.5,
    splash: 0.5, wallImpact: 0.3, whirlpool: 0.45, aeration: 0.6, damping: 0.5, panelTone: 0.05, machinery: 0.2, widthM: 36,
  }, { paddle: [[0, 1], [8, 0.9]], breaker: [[3, 0.85], [11, 1]], wall: [[6, 0.5], [14, 0.6]], vortex: [[4, 0.5]] }),
  scene("deck-drizzle", "Deck drizzle", {
    generatorId: "piston", boundaryId: "tile-acrylic", receiverId: "deck", tempoBpm: 104, swing: 0.18, depthM: 0.55, waveHeightM: 0.12,
    wavePeriodSeconds: 1.6, paddleForce: 0.3, paddleCount: 8, phaseSpread: 0.9, breaking: 0.4, bubbleDensity: 0.95, bubbleSize: 0.7,
    splash: 0.95, wallImpact: 0.12, whirlpool: 0.1, aeration: 0.3, damping: 0.4, panelTone: 0.15, machinery: 0.04, widthM: 12,
  }, { paddle: [[2, 0.3], [9, 0.4]], breaker: [[0, 0.4], [1, 0.3], [3, 0.5], [5, 0.3], [7, 0.4], [8, 0.5], [10, 0.3], [12, 0.45], [13, 0.3], [15, 0.4]], wall: [[4, 0.2]], vortex: [] }),
  scene("undertow-drone", "Undertow drone", {
    generatorId: "pneumatic", boundaryId: "liner", receiverId: "underwater", tempoBpm: 38, swing: 0, depthM: 3, waveHeightM: 0.2,
    wavePeriodSeconds: 7.5, paddleForce: 0.25, paddleCount: 1, phaseSpread: 0, breaking: 0.1, bubbleDensity: 0.55, bubbleSize: 10.5,
    splash: 0.1, wallImpact: 0.05, whirlpool: 0.85, aeration: 0.9, damping: 0.92, panelTone: 0.02, machinery: 0.55, widthM: 40,
  }, { paddle: [[0, 0.5]], breaker: [], wall: [[8, 0.15]], vortex: [[0, 0.9], [5, 0.5], [10, 0.7], [13, 0.4]] }),
  scene("acrylic-aquarium", "Acrylic aquarium", {
    generatorId: "piston", boundaryId: "tile-acrylic", receiverId: "underwater", tempoBpm: 84, swing: 0.1, depthM: 1.9, waveHeightM: 0.3,
    wavePeriodSeconds: 3, paddleForce: 0.55, paddleCount: 5, phaseSpread: 0.35, breaking: 0.45, bubbleDensity: 0.6, bubbleSize: 2.4,
    splash: 0.35, wallImpact: 0.65, whirlpool: 0.3, aeration: 0.35, damping: 0.6, panelTone: 0.55, machinery: 0.1, widthM: 9,
  }, { paddle: [[0, 0.8], [6, 0.6], [10, 0.7]], breaker: [[4, 0.5], [12, 0.6]], wall: [[2, 0.7], [5, 0.5], [9, 0.8], [13, 0.6], [15, 0.4]], vortex: [[8, 0.4]] }),
  scene("storm-surge", "Storm surge", {
    generatorId: "piston", boundaryId: "steel", receiverId: "deck", tempoBpm: 126, swing: 0.22, depthM: 2.4, waveHeightM: 1,
    wavePeriodSeconds: 2.7, paddleForce: 1, paddleCount: 8, phaseSpread: 0.6, breaking: 1, bubbleDensity: 0.92, bubbleSize: 3.1,
    splash: 1, wallImpact: 0.7, whirlpool: 0.65, aeration: 0.85, damping: 0.45, panelTone: 0.35, machinery: 0.3, widthM: 30,
  }, { paddle: [[0, 1], [2, 0.8], [4, 1], [6, 0.8], [8, 1], [10, 0.9], [12, 1], [14, 0.8]], breaker: [[1, 1], [3, 0.9], [5, 1], [7, 0.9], [9, 1], [11, 0.9], [13, 1], [15, 1]], wall: [[2, 0.8], [6, 0.9], [10, 0.8], [14, 1]], vortex: [[0, 0.8], [8, 0.9]] }),
  scene("machine-hall", "Machine hall", {
    generatorId: "pneumatic", boundaryId: "steel", receiverId: "deck", tempoBpm: 150, swing: 0.3, depthM: 1.1, waveHeightM: 0.2,
    wavePeriodSeconds: 1.8, paddleForce: 0.9, paddleCount: 4, phaseSpread: 0.15, breaking: 0.3, bubbleDensity: 0.25, bubbleSize: 4.8,
    splash: 0.25, wallImpact: 0.55, whirlpool: 0.1, aeration: 0.2, damping: 0.8, panelTone: 0.6, machinery: 0.9, widthM: 16,
  }, { paddle: [[0, 1], [4, 1], [8, 1], [12, 1], [14, 0.6]], breaker: [[2, 0.5], [6, 0.5], [10, 0.5], [15, 0.7]], wall: [[3, 0.8], [7, 0.8], [11, 0.8]], vortex: [] }),
  scene("bubble-garden", "Bubble garden", {
    generatorId: "piston", boundaryId: "liner", receiverId: "underwater", tempoBpm: 66, swing: 0.12, depthM: 1.6, waveHeightM: 0.25,
    wavePeriodSeconds: 4.2, paddleForce: 0.45, paddleCount: 2, phaseSpread: 0.5, breaking: 0.2, bubbleDensity: 1, bubbleSize: 1.2,
    splash: 0.2, wallImpact: 0.08, whirlpool: 0.55, aeration: 1, damping: 0.75, panelTone: 0.04, machinery: 0.05, widthM: 20,
  }, { paddle: [[0, 0.6], [9, 0.5]], breaker: [[3, 0.4], [7, 0.5], [12, 0.4]], wall: [], vortex: [[2, 0.6], [6, 0.8], [10, 0.7], [14, 0.9]] }),
  scene("wide-lagoon", "Wide lagoon", {
    generatorId: "piston", boundaryId: "concrete", receiverId: "waterline", tempoBpm: 62, swing: 0.06, depthM: 2, waveHeightM: 0.55,
    wavePeriodSeconds: 5.8, paddleForce: 0.5, paddleCount: 6, phaseSpread: 0.3, breaking: 0.55, bubbleDensity: 0.4, bubbleSize: 6.5,
    splash: 0.45, wallImpact: 0.05, whirlpool: 0.2, aeration: 0.25, damping: 0.3, panelTone: 0.02, machinery: 0.03, widthM: 40,
  }, { paddle: [[0, 0.9], [8, 0.8]], breaker: [[4, 0.6], [12, 0.7]], wall: [[7, 0.2], [15, 0.2]], vortex: [[2, 0.3]] }),
];

export const WAVE_POOL_FULL_PRESETS = Object.freeze([...existing, ...authored]);

const snap = (value, key) => {
  const [min, max] = WAVE_POOL_LIMITS[key], step = STEPS[key];
  return Number((Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min).toFixed(4));
};

export function randomizeWavePoolPreset(current, random = Math.random) {
  validateWavePoolPreset(current);
  const rng = presetRandom(random);
  const values = {
    generatorId: rng.pick(WAVE_POOL_GENERATORS).id, boundaryId: rng.pick(WAVE_POOL_BOUNDARIES).id, receiverId: rng.pick(WAVE_POOL_RECEIVERS).id,
  };
  for (const key of WAVE_POOL_NUMERIC_KEYS) values[key] = snap(rng.between(...WAVE_POOL_LIMITS[key]), key);
  const heightCap = Math.floor(values.depthM * 0.78 * 100 - 1e-6) / 100;
  values.waveHeightM = snap(Math.min(rng.between(WAVE_POOL_LIMITS.waveHeightM[0], heightCap), heightCap), "waveHeightM");
  const pattern = {};
  for (const lane of WAVE_POOL_LANE_IDS) {
    const density = rng.between(0.04, 0.5);
    pattern[lane] = Array.from({ length: WAVE_POOL_SEQUENCE_LENGTH }, () => (
      rng.unit() < density ? Number(rng.between(0.2, 1).toFixed(2)) : 0
    ));
  }
  values.pattern = pattern;
  return validateWavePoolPreset(captureWavePoolPreset(values));
}
