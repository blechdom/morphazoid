import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const VECTOR_FLIGHT_ARTICULATIONS = Object.freeze(["continuous", "notes", "triggers"]);
const RANGES = Object.freeze({
  throttle: [0, 100, 1], density: [24, 144, 1], sensorRadius: [0.14, 0.4, 0.005], sensorWidth: [0.035, 0.2, 0.005],
  orbitLobes: [1, 8, 1], orbitPhaseDegrees: [-180, 180, 1], fieldSpin: [-1, 1, 0.01],
  minimumFrequency: [24, 220, 1], maximumFrequency: [320, 6400, 10],
  stereoWidth: [0, 1, 0.01], doppler: [0, 1, 0.01], tail: [0.08, 1, 0.01], character: [0, 1, 0.01], engineMix: [0, 0.65, 0.01],
});
export const VECTOR_FLIGHT_PRESET_KEYS = Object.freeze(["articulation", ...Object.keys(RANGES)]);

const snap = (value, [min, max, step]) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number((Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min).toFixed(4));
};

function normalize(values) {
  const out = { articulation: VECTOR_FLIGHT_ARTICULATIONS.includes(values.articulation) ? values.articulation : "continuous" };
  for (const key of Object.keys(RANGES)) out[key] = snap(values[key], RANGES[key]);
  return out;
}

export function captureVectorFlightPreset(state) {
  return normalize({ ...state, orbitPhaseDegrees: state.orbitPhase * 180 / Math.PI });
}

export function validateVectorFlightPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== VECTOR_FLIGHT_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(normalize(snapshot))) {
    throw new TypeError("Invalid complete Vector Flight preset");
  }
  return snapshot;
}

export function applyVectorFlightPreset(state, snapshot) {
  validateVectorFlightPreset(snapshot);
  const { orbitPhaseDegrees, articulation, ...rest } = snapshot;
  const densityChanged = state.density !== snapshot.density;
  Object.assign(state, rest, { articulation, orbitPhase: orbitPhaseDegrees * Math.PI / 180 });
  return { densityChanged, articulation };
}

const scene = (id, label, values) => Object.freeze({ id, label, snapshot: Object.freeze(normalize(values)) });
const base = {
  throttle: 22, density: 78, articulation: "continuous", sensorRadius: 0.26, sensorWidth: 0.1, orbitLobes: 3, orbitPhaseDegrees: 0,
  fieldSpin: 0.12, minimumFrequency: 48, maximumFrequency: 2400, stereoWidth: 0.92, doppler: 0.7, tail: 0.56, character: 0.48, engineMix: 0.22,
};
const variant = (id, label, changes) => scene(id, label, { ...base, ...changes });

export const VECTOR_FLIGHT_FULL_PRESETS = Object.freeze([
  scene("vector-cruise", "Vector cruise", base),
  variant("drift-chorus", "Drift chorus", { throttle: 16, density: 110, sensorRadius: 0.32, sensorWidth: 0.16, orbitLobes: 2, fieldSpin: 0.04, maximumFrequency: 1400, tail: 0.9, engineMix: 0.1 }),
  variant("attack-run", "Attack run", { throttle: 42, density: 90, orbitLobes: 5, orbitPhaseDegrees: 36, fieldSpin: 0.35, doppler: 0.85, engineMix: 0.35 }),
  variant("hyperspace-bells", "Hyperspace bells", { throttle: 72, articulation: "notes", density: 130, sensorRadius: 0.22, sensorWidth: 0.06, orbitLobes: 7, fieldSpin: -0.4, minimumFrequency: 120, maximumFrequency: 5200, tail: 0.35, character: 0.8, engineMix: 0.3 }),
  variant("plaid-storm", "Plaid storm", { throttle: 100, density: 144, articulation: "triggers", sensorRadius: 0.38, sensorWidth: 0.2, orbitLobes: 8, orbitPhaseDegrees: 90, fieldSpin: 0.9, maximumFrequency: 6400, stereoWidth: 1, doppler: 1, tail: 0.15, character: 0.95, engineMix: 0.55 }),
  variant("sparse-sonar", "Sparse sonar", { throttle: 12, density: 28, articulation: "notes", sensorRadius: 0.18, sensorWidth: 0.04, orbitLobes: 1, fieldSpin: 0, minimumFrequency: 60, maximumFrequency: 900, doppler: 0.2, tail: 0.95, character: 0.2, engineMix: 0 }),
  variant("sub-bass-orbit", "Sub-bass orbit", { throttle: 30, density: 60, sensorRadius: 0.36, sensorWidth: 0.12, orbitLobes: 4, orbitPhaseDegrees: -90, fieldSpin: -0.15, minimumFrequency: 24, maximumFrequency: 480, stereoWidth: 0.6, tail: 0.7, character: 0.15, engineMix: 0.5 }),
  variant("glass-needles", "Glass needles", { throttle: 55, density: 100, articulation: "triggers", sensorRadius: 0.16, sensorWidth: 0.035, orbitLobes: 6, orbitPhaseDegrees: 150, fieldSpin: 0.5, minimumFrequency: 200, maximumFrequency: 6000, doppler: 0.4, tail: 0.1, character: 0.9, engineMix: 0.05 }),
  variant("counter-spin", "Counter spin", { throttle: 36, density: 84, orbitLobes: 3, orbitPhaseDegrees: 60, fieldSpin: -0.8, stereoWidth: 1, doppler: 0.55, character: 0.6 }),
  variant("wide-listen", "Wide listen", { throttle: 20, density: 120, sensorRadius: 0.4, sensorWidth: 0.19, orbitLobes: 2, orbitPhaseDegrees: -45, fieldSpin: 0.08, minimumFrequency: 40, maximumFrequency: 3200, tail: 0.8, character: 0.35 }),
  variant("engine-room", "Engine room", { throttle: 64, density: 50, sensorRadius: 0.3, sensorWidth: 0.08, orbitLobes: 3, fieldSpin: 0.2, minimumFrequency: 30, maximumFrequency: 1200, doppler: 0.1, tail: 0.5, character: 0.3, engineMix: 0.65 }),
  variant("starlight-arpeggio", "Starlight arpeggio", { throttle: 28, density: 70, articulation: "notes", sensorRadius: 0.27, sensorWidth: 0.05, orbitLobes: 5, orbitPhaseDegrees: 120, fieldSpin: 0.25, minimumFrequency: 90, maximumFrequency: 3600, stereoWidth: 0.8, tail: 0.45, character: 0.7, engineMix: 0.12 }),
]);

export function randomizeVectorFlightPreset(current, random = Math.random) {
  validateVectorFlightPreset(current);
  const rng = presetRandom(random);
  const radius = rng.between(0.16, 0.4);
  const values = { articulation: rng.pick(VECTOR_FLIGHT_ARTICULATIONS), sensorRadius: radius, sensorWidth: rng.between(0.035, Math.min(0.2, radius * 0.6)) };
  for (const key of Object.keys(RANGES)) {
    if (key in values) continue;
    const [min, max] = RANGES[key];
    values[key] = rng.between(min, key === "minimumFrequency" ? 160 : key === "maximumFrequency" ? 6400 : max);
  }
  return validateVectorFlightPreset(normalize(values));
}
