import { DRUM_ROLL_DEFAULTS, DRUM_ROLL_PRESETS, sanitizeDrumRollParams } from "./drum-roll-please.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const DRUM_ROLL_PRESET_KEYS = Object.freeze([
  "direction", "driftRate", "centerRate", "width", "decay", "character", "spread",
  "pitchFollow", "centerPitch", "cutoff", "stripeAngle", "morphDepth",
]);

export function captureDrumRollPreset(roll) {
  const safe = sanitizeDrumRollParams({ ...DRUM_ROLL_DEFAULTS, ...roll });
  return Object.fromEntries(DRUM_ROLL_PRESET_KEYS.map(key => [key, safe[key]]));
}

export function validateDrumRollPreset(snapshot) {
  if (!snapshot || presetStateKey(snapshot) !== presetStateKey(captureDrumRollPreset(snapshot))
    || Object.keys(snapshot).length !== DRUM_ROLL_PRESET_KEYS.length) {
    throw new TypeError("Invalid complete Drum Roll Please preset");
  }
  return snapshot;
}

const AUTHORED = [
  { id: "ratchet-engine", label: "Ratchet engine", direction: 1, driftRate: 0.5, centerRate: 11, width: 4, decay: 0.045, character: 0.7, spread: 0.2, centerPitch: 140, cutoff: 12_000, stripeAngle: 68, morphDepth: 0.4 },
  { id: "slow-thunder", label: "Slow thunder", direction: -1, driftRate: 0.05, centerRate: 1.2, width: 8, decay: 0.9, character: 0.05, spread: 0.6, centerPitch: 55, cutoff: 3_000, stripeAngle: 20, morphDepth: 0.2 },
  { id: "tin-roof-rain", label: "Tin roof rain", direction: 1, driftRate: 0.09, centerRate: 7, width: 7, decay: 0.03, character: 0.95, spread: 0.95, centerPitch: 420, cutoff: 17_000, stripeAngle: 44, morphDepth: 1 },
  { id: "marching-snare", label: "Marching snare", direction: 1, driftRate: 0.15, centerRate: 3.2, width: 3.5, decay: 0.1, character: 0.62, spread: 0.25, centerPitch: 180, cutoff: 9_500, stripeAngle: 36, morphDepth: 0.75 },
  { id: "tabla-spiral", label: "Tabla spiral", direction: -1, driftRate: 0.34, centerRate: 5, width: 5, decay: 0.2, character: 0.4, spread: 0.5, pitchFollow: true, centerPitch: 260, cutoff: 7_000, stripeAngle: 60, morphDepth: 0.55 },
  { id: "hovering-hum", label: "Hovering hum", direction: 1, driftRate: 0.03, centerRate: 14, width: 9, decay: 0.4, character: 0.3, spread: 0.8, pitchFollow: true, centerPitch: 75, cutoff: 5_000, stripeAngle: 14, morphDepth: 0.1 },
  { id: "glitch-flutter", label: "Glitch flutter", direction: -1, driftRate: 0.9, centerRate: 9, width: 3, decay: 0.025, character: 0.88, spread: 0.1, pitchFollow: true, centerPitch: 600, cutoff: 15_500, stripeAngle: 74, morphDepth: 0.9 },
  { id: "kick-avalanche", label: "Kick avalanche", direction: -1, driftRate: 0.22, centerRate: 2, width: 6.5, decay: 0.55, character: 0.0, spread: 0.4, centerPitch: 48, cutoff: 2_200, stripeAngle: 28, morphDepth: 0 },
  { id: "glass-rattle", label: "Glass rattle", direction: 1, driftRate: 0.6, centerRate: 6.5, width: 4.5, decay: 0.06, character: 1, spread: 0.85, pitchFollow: true, centerPitch: 800, cutoff: 18_000, stripeAngle: 50, morphDepth: 0.65 },
];

const deepFreeze = snapshot => Object.freeze(snapshot);
export const DRUM_ROLL_FULL_PRESETS = Object.freeze([...DRUM_ROLL_PRESETS, ...AUTHORED].map(preset => Object.freeze({
  id: preset.id, label: preset.label, description: preset.description,
  snapshot: deepFreeze(captureDrumRollPreset(preset)),
})));

const logBetween = (rng, low, high) => Math.exp(rng.between(Math.log(low), Math.log(high)));
const round = (value, digits = 3) => Number(value.toFixed(digits));

export function randomizeDrumRollPreset(current, random = Math.random) {
  validateDrumRollPreset(current);
  const rng = presetRandom(random);
  return validateDrumRollPreset(captureDrumRollPreset({
    direction: rng.pick([-1, 1]),
    driftRate: round(logBetween(rng, 0.03, 1)),
    centerRate: round(logBetween(rng, 0.8, 15), 2),
    width: round(rng.between(3, 9), 2),
    decay: round(logBetween(rng, 0.025, 1.2)),
    character: round(rng.between(0, 1), 2),
    spread: round(rng.between(0, 1), 2),
    pitchFollow: rng.unit() < 0.4,
    centerPitch: Math.round(logBetween(rng, 50, 800)),
    cutoff: Math.round(logBetween(rng, 2_000, 18_000)),
    stripeAngle: Math.round(rng.between(14, 76)),
    morphDepth: round(rng.between(0, 1), 2),
  }));
}
