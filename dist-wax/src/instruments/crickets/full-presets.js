import { CRICKET_DEMO_PRESETS } from "./crickets.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

// Slider ranges and steps mirror pages/crickets.html; values are snapped so the DOM round-trips them exactly.
export const CRICKET_CONTROL_SPECS = Object.freeze({
  resonanceScale: Object.freeze({ id: "resonance-scale", min: 0.55, max: 1.8, step: 0.01 }),
  toothRateRatio: Object.freeze({ id: "tooth-rate-ratio", min: 0.72, max: 1.28, step: 0.001 }),
  wingQ: Object.freeze({ id: "wing-q", min: 3, max: 55, step: 0.1 }),
  coupling: Object.freeze({ id: "coupling", min: 0, max: 1, step: 0.01 }),
  wingSplit: Object.freeze({ id: "wing-split", min: -360, max: 360, step: 1 }),
  plectrumForce: Object.freeze({ id: "plectrum-force", min: 0.1, max: 1.8, step: 0.01 }),
  toothIrregularity: Object.freeze({ id: "tooth-irregularity", min: 0, max: 0.45, step: 0.005 }),
  closingSweep: Object.freeze({ id: "closing-sweep", min: -0.24, max: 0.24, step: 0.005 }),
  mirrorMix: Object.freeze({ id: "mirror-mix", min: 0, max: 0.8, step: 0.01 }),
});
export const CRICKET_CONTROL_KEYS = Object.freeze(Object.keys(CRICKET_CONTROL_SPECS));
export const CRICKET_RECORDING_IDS = Object.freeze(["recorded-house-cricket", "recorded-field-cricket", "recorded-european-field-cricket"]);
export const CRICKET_SOURCE_IDS = Object.freeze([...CRICKET_RECORDING_IDS, ...CRICKET_DEMO_PRESETS.map(preset => preset.id)]);
export const CRICKET_LOCAL_SOURCE = "local";

const decimals = step => (String(step).split(".")[1] ?? "").length;
export function snapCricketControl(key, value) {
  const { min, max, step } = CRICKET_CONTROL_SPECS[key];
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return Number((min + Math.round((clamped - min) / step) * step).toFixed(decimals(step)));
}

// An uploaded file is not recallable, so "local" is capturable but never part of the bank.
export function captureCricketPreset({ sourceId, controls }) {
  return {
    sourceId: sourceId === CRICKET_LOCAL_SOURCE || CRICKET_SOURCE_IDS.includes(sourceId) ? sourceId : CRICKET_SOURCE_IDS[3],
    ...Object.fromEntries(CRICKET_CONTROL_KEYS.map(key => [key, snapCricketControl(key, Number(controls[key]))])),
  };
}

export function validateCricketPreset(snapshot) {
  presetStateKey(snapshot);
  if (!snapshot || Object.keys(snapshot).length !== CRICKET_CONTROL_KEYS.length + 1
    || presetStateKey(captureCricketPreset({ sourceId: snapshot.sourceId, controls: snapshot })) !== presetStateKey(snapshot)) {
    throw new TypeError("Invalid complete Crickets preset");
  }
  return snapshot;
}

const scene = (id, label, sourceId, controls) => {
  const snapshot = captureCricketPreset({ sourceId, controls: { ...DEFAULT_CONTROLS, ...controls } });
  validateCricketPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

const DEFAULT_CONTROLS = Object.freeze({
  resonanceScale: 1, toothRateRatio: 1, wingQ: 7.9, coupling: 0.46, wingSplit: 28, plectrumForce: 0.82,
  toothIrregularity: 0.025, closingSweep: -0.065, mirrorMix: 0.31,
});

export const CRICKET_FULL_PRESETS = Object.freeze([
  scene("field-reference", "Field chirps · Reference", "field-chirps", {}),
  scene("field-glass-wings", "Field chirps · Glass wings", "field-chirps", { resonanceScale: 1.35, wingQ: 32, coupling: 0.2, wingSplit: 160, plectrumForce: 0.5, mirrorMix: 0.6 }),
  scene("field-rusty-comb", "Field chirps · Rusty comb", "field-chirps", { toothRateRatio: 0.93, wingQ: 4.5, toothIrregularity: 0.28, plectrumForce: 1.4, closingSweep: 0.12, coupling: 0.7 }),
  scene("slow-basement", "Slow chirps · Basement drone", "slow-low-chirps", { resonanceScale: 0.62, wingQ: 22, coupling: 0.85, wingSplit: -200, mirrorMix: 0.5 }),
  scene("slow-detuned-pair", "Slow chirps · Detuned pair", "slow-low-chirps", { wingSplit: 320, coupling: 0.1, wingQ: 12, plectrumForce: 1.1 }),
  scene("trill-needle", "Fast trill · Needle", "fast-high-trill", { resonanceScale: 1.1, wingQ: 48, plectrumForce: 0.35, toothIrregularity: 0.005, mirrorMix: 0.1 }),
  scene("trill-sandpaper", "Fast trill · Sandpaper", "fast-high-trill", { toothRateRatio: 1.18, toothIrregularity: 0.4, wingQ: 5, plectrumForce: 1.6, closingSweep: -0.2 }),
  scene("trill-swarm", "Fast trill · Swarm", "fast-high-trill", { wingSplit: -340, coupling: 0.95, mirrorMix: 0.75, toothRateRatio: 0.85, resonanceScale: 0.8 }),
  scene("house-warm", "House cricket · Warm room", "recorded-house-cricket", { resonanceScale: 0.9, wingQ: 10, coupling: 0.6, mirrorMix: 0.45 }),
  scene("house-bright", "House cricket · Bright shimmer", "recorded-house-cricket", { resonanceScale: 1.5, wingQ: 26, wingSplit: 120, plectrumForce: 0.6 }),
  scene("field-meadow", "Field cricket · Meadow", "recorded-field-cricket", { toothRateRatio: 1.03, coupling: 0.38, mirrorMix: 0.4 }),
  scene("field-rasp", "Field cricket · Rasping wings", "recorded-field-cricket", { wingQ: 3.6, toothIrregularity: 0.2, plectrumForce: 1.5, closingSweep: 0.08 }),
  scene("european-hollow", "European cricket · Hollow", "recorded-european-field-cricket", { resonanceScale: 0.7, wingQ: 18, coupling: 0.9, wingSplit: -90 }),
  scene("european-sweep", "European cricket · Closing sweep", "recorded-european-field-cricket", { closingSweep: 0.22, toothRateRatio: 1.12, wingSplit: 240, mirrorMix: 0.2 }),
]);

export function randomizeCricketPreset(current, random = Math.random) {
  validateCricketPreset(current);
  const rng = presetRandom(random);
  const sourceId = rng.pick(CRICKET_SOURCE_IDS);
  const quality = Math.exp(rng.between(Math.log(3.5), Math.log(50)));
  const controls = {
    resonanceScale: rng.between(0.6, 1.6), toothRateRatio: rng.between(0.8, 1.2), wingQ: quality,
    coupling: rng.between(0, 1), wingSplit: rng.between(-330, 330), plectrumForce: rng.between(0.2, 1.7),
    toothIrregularity: rng.between(0, 0.4), closingSweep: rng.between(-0.22, 0.22), mirrorMix: rng.between(0, 0.75),
  };
  return validateCricketPreset(captureCricketPreset({
    sourceId: current.sourceId === CRICKET_LOCAL_SOURCE ? CRICKET_LOCAL_SOURCE : sourceId, controls,
  }));
}
