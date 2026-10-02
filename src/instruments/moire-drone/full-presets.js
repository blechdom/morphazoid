import {
  FABRIC_IMPACT_BODIES,
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  MOIRE_DRONE_NOISE_TYPES,
  MOIRE_DRONE_PRESETS,
  SPECTRAL_PROPAGATION_MODES,
  SPECTRAL_SCULPT_MODES,
  sanitizeMoireDroneParams,
} from "./moire-drone.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom, randomParameterValues } from "../../site/preset-random.js";

// Output and live input/device state belong to the performer, not the patch.
// The musical noise seed is included; running noise, fabric and propagation
// state, gesture positions, clocks and presentation grid density are not.
export const MOIRE_DRONE_PRESET_KEYS = Object.freeze(
  Object.keys(MOIRE_DRONE_DEFAULTS).filter(key => key !== "outputLevel"),
);

export function captureMoireDronePreset(parameters = {}) {
  const settings = sanitizeMoireDroneParams({
    ...parameters,
    ...MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  });
  return {
    settings: Object.fromEntries(MOIRE_DRONE_PRESET_KEYS.map(key => [key, settings[key]])),
  };
}

export function validateMoireDronePreset(snapshot) {
  const key = presetStateKey(snapshot);
  if (!snapshot?.settings
    || Object.keys(snapshot.settings).length !== MOIRE_DRONE_PRESET_KEYS.length
    || MOIRE_DRONE_PRESET_KEYS.some(name => !Object.hasOwn(snapshot.settings, name))
    || presetStateKey(captureMoireDronePreset(snapshot.settings)) !== key) {
    throw new TypeError("Invalid complete Fabric Filter preset");
  }
  return snapshot;
}

// Retain the entire authored library, filling omitted controls from the same
// defaults used by its original recall path. Presets never start hidden motion.
export const MOIRE_DRONE_FULL_PRESETS = Object.freeze(MOIRE_DRONE_PRESETS.map(preset => {
  const snapshot = validateMoireDronePreset(captureMoireDronePreset({
    ...MOIRE_DRONE_DEFAULTS,
    ...preset.settings,
  }));
  Object.freeze(snapshot.settings);
  return Object.freeze({
    id: preset.id,
    label: preset.label,
    snapshot: Object.freeze(snapshot),
  });
}));

// Explicit musical ranges keep room for gesture, a substantial filtered path,
// and moderate drive/feedback. Automatic motion remains intentionally neutral:
// Fabric Filter's movement must come from the same sheet the player can see.
const RANDOM_RANGES = Object.freeze({
  noiseColor: [-1, 1],
  noiseChaos: [0.08, 0.95],
  noiseFractalDepth: [0.1, 0.95],
  noiseCorrelation: [0, 1],
  dust: [0, 0.25],
  resonance: [0.12, 0.82],
  resonanceMotion: [0.05, 0.85],
  spectralTilt: [-6, 4],
  latticeScatter: [0, 0.8],
  filteredMix: [0.75, 1],
  cascade: [0, 0.8],
  edgeFocus: [0.6, 3.5],
  fieldAAngle: [-180, 180],
  fieldADensity: [0.4, 9],
  fieldACurvature: [0, 1],
  fieldADepth: [0.1, 1.5],
  fieldBAngle: [-180, 180],
  fieldBDensity: [0.4, 9],
  fieldBCurvature: [0, 1],
  fieldBDepth: [0.1, 1.5],
  originX: [-0.9, 0.9],
  originY: [-0.9, 0.9],
  moireDetune: [-0.9, 0.9],
  phaseOffset: [0, 1],
  collisionAmount: [0.08, 0.9],
  collisionWidth: [0.04, 0.8],
  collisionPolarity: [-1, 1],
  fabricTension: [0.08, 0.95],
  fabricDamping: [0.08, 0.85],
  fabricInertia: [0.08, 0.9],
  fabricPatchwork: [0, 1],
  fabricDepth: [0.2, 1.6],
  fabricRotation: [-180, 180],
  fabricPull: [0.2, 1.6],
  fabricGravity: [0, 1.5],
  propagationRate: [1, 32],
  propagationSpeed: [0.15, 8],
  propagationDecay: [0.15, 5],
  propagationDepth: [0.15, 1.6],
  propagationGain: [0.3, 0.95],
  propagationWidth: [0.03, 0.5],
  propagationSizeSpread: [0, 1],
  propagationSpeedSpread: [0, 1],
  propagationInterference: [0, 1],
  grabRippleRate: [0, 18],
  ringDensity: [0.35, 9],
  combDepth: [0.5, 1],
  combWidth: [0.04, 0.4],
  combOffset: [0, 1],
  combWarp: [0, 3.5],
  pluckCut: [0.2, 1],
  spectralFilterBlend: [0, 1],
  fftCutDepth: [0.4, 1],
  fftSharpness: [0, 1],
  qCutDepth: [0.4, 1],
  qCharacter: [0, 1],
  gestureCoupling: [0.5, 1],
  stereoWidth: [0, 1],
  drive: [0, 0.35],
  space: [0, 0.5],
  feedback: [0, 0.35],
});

/** Pure full-patch generation; an injected seeded RNG gives repeatable results. */
export function randomizeMoireDronePreset(current, random = Math.random) {
  validateMoireDronePreset(current);
  const rng = presetRandom(random);
  const settings = randomParameterValues(RANDOM_RANGES, rng);
  const logBetween = (low, high) => Math.exp(rng.between(Math.log(low), Math.log(high)));
  const lowFrequency = logBetween(24, 600);
  const impactBody = rng.pick(FABRIC_IMPACT_BODIES);
  return validateMoireDronePreset(captureMoireDronePreset({
    ...settings,
    noiseType: rng.pick(MOIRE_DRONE_NOISE_TYPES),
    filterPairs: rng.integer(4, 24),
    lowFrequency,
    highFrequency: logBetween(Math.max(700, lowFrequency * 2), 18_000),
    collisionMode: rng.pick(["multiply", "difference", "fold"]),
    fabricSections: rng.integer(3, 16),
    impactBody,
    propagationMode: rng.pick(SPECTRAL_PROPAGATION_MODES),
    harmonicOrder: rng.integer(0, 12),
    propagationVoices: rng.integer(impactBody === "pebbles" ? 2 : 1, 4),
    combTeeth: rng.integer(1, 16),
    spectralSculptMode: rng.pick(SPECTRAL_SCULPT_MODES),
    seed: rng.integer(1, 0xffffffff),
  }));
}
