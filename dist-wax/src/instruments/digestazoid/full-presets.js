import { DIGESTAZOID_PRESETS, digestazoidState, sanitizeDigestazoidState } from "./digestazoid.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const DIGESTAZOID_PRESET_RANGES = Object.freeze({
  gas: [0, 1.8], liquid: [0, 1.5], sludge: [0, 1.5], viscosity: [0, 1], bubbleSizeMm: [2, 22],
  peristalsisRate: [1, 72], peristalsisDepth: [0, 1], stomachCompliance: [0.08, 1.5], gutTension: [0, 1],
  bodyPulse: [0, 1], upperValve: [0, 1], pyloricValve: [0, 1], lowerValve: [0, 1], outletStretch: [0, 1],
  turbulence: [0, 1], wetness: [0, 1], bodyResonance: [0, 1],
});
export const DIGESTAZOID_PRESET_KEYS = Object.freeze([
  "presetId", "listeningMode", ...Object.keys(DIGESTAZOID_PRESET_RANGES),
]);
const LISTENING_MODES = Object.freeze(["room", "stethoscope", "inside"]);

// Output level, continuous-motion switch and the bubble noise seed are session state.
export function captureDigestazoidPreset(state) {
  const clean = sanitizeDigestazoidState(state);
  return Object.fromEntries(DIGESTAZOID_PRESET_KEYS.map(key => [key, clean[key]]));
}

export function applyDigestazoidPresetState(snapshot, liveState) {
  return digestazoidState(snapshot.presetId, {
    ...snapshot, level: liveState.level, performing: liveState.performing, noiseSeed: liveState.noiseSeed,
  });
}

export function validateDigestazoidPreset(snapshot) {
  presetStateKey(snapshot);
  if (!snapshot || presetStateKey(captureDigestazoidPreset(snapshot)) !== presetStateKey(snapshot)
    || Object.keys(snapshot).length !== DIGESTAZOID_PRESET_KEYS.length) {
    throw new TypeError("Invalid complete Digestazoid preset");
  }
  return snapshot;
}

const scene = (id, label, baseId, settings = {}) => {
  const snapshot = captureDigestazoidPreset(digestazoidState(baseId, settings));
  validateDigestazoidPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const DIGESTAZOID_FULL_PRESETS = Object.freeze([
  ...DIGESTAZOID_PRESETS.map(preset => scene(preset.id, preset.label, preset.id)),
  scene("tidal-reflux", "Tidal Reflux", "after-lunch", {
    liquid: 1.3, sludge: 0.15, gas: 0.5, viscosity: 0.12, wetness: 0.95, upperValve: 0.85, peristalsisRate: 18,
    peristalsisDepth: 0.7, bubbleSizeMm: 6,
  }),
  scene("bubble-foundry", "Bubble Foundry", "fizzy-belly", {
    gas: 1.7, bubbleSizeMm: 2, turbulence: 0.98, peristalsisRate: 44, liquid: 0.9, viscosity: 0.08, listeningMode: "inside",
  }),
  scene("tectonic-gurgle", "Tectonic Gurgle", "sludge-bog", {
    peristalsisRate: 2.5, peristalsisDepth: 0.96, sludge: 1.4, bubbleSizeMm: 21, stomachCompliance: 1.45,
    gutTension: 0.35, bodyResonance: 0.9, turbulence: 0.35,
  }),
  scene("stethoscope-ticks", "Stethoscope Ticks", "quiet-clinic", {
    listeningMode: "stethoscope", peristalsisRate: 28, peristalsisDepth: 0.2, bubbleSizeMm: 3, gas: 0.35,
    wetness: 0.15, viscosity: 0.2, bodyPulse: 0.85, bodyResonance: 0.12,
  }),
  scene("valve-squeal", "Valve Squeal", "rubber-laboratory", {
    upperValve: 0.18, lowerValve: 0.14, pyloricValve: 0.2, outletStretch: 0.95, gas: 1.6, turbulence: 0.7,
    peristalsisRate: 31, listeningMode: "room",
  }),
  scene("slow-glacier", "Slow Glacier", "sludge-bog", {
    peristalsisRate: 1.5, peristalsisDepth: 0.4, gas: 1.1, liquid: 0.2, sludge: 1.2, viscosity: 1, bubbleSizeMm: 19,
    turbulence: 0.2, outletStretch: 0.15, wetness: 0.05,
  }),
  scene("convulsive-churn", "Convulsive Churn", "empty-growler", {
    peristalsisRate: 68, peristalsisDepth: 0.98, gutTension: 0.95, gas: 0.9, liquid: 0.6, sludge: 0.6,
    turbulence: 0.8, bodyPulse: 0.95, stomachCompliance: 0.3,
  }),
  scene("sealed-cavern", "Sealed Cavern", "empty-growler", {
    listeningMode: "inside", upperValve: 0.05, pyloricValve: 0.05, lowerValve: 0.05, gas: 1.2, liquid: 0.1, sludge: 0.1,
    bodyResonance: 1, outletStretch: 0.05, peristalsisRate: 6,
  }),
]);

export function randomizeDigestazoidPreset(current, random = Math.random) {
  validateDigestazoidPreset(current);
  const rng = presetRandom(random);
  const values = Object.fromEntries(Object.entries(DIGESTAZOID_PRESET_RANGES).map(([key, [min, max]]) => [key, rng.between(min, max)]));
  // Peristalsis rate is perceived logarithmically; keep slow bodies as likely as fast ones.
  values.peristalsisRate = Math.exp(rng.between(Math.log(1.5), Math.log(70)));
  values.bubbleSizeMm = Math.exp(rng.between(Math.log(2), Math.log(22)));
  return validateDigestazoidPreset(captureDigestazoidPreset(digestazoidState(rng.pick(DIGESTAZOID_PRESETS).id, {
    ...values, listeningMode: rng.pick(LISTENING_MODES),
  })));
}
