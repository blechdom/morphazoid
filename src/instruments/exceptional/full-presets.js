import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { safeGamma } from "./exceptional.js";

export const EXCEPTIONAL_PRESET_KEYS = Object.freeze(["gamma", "kappa", "centre", "decay"]);
const GAMMA_MAX = safeGamma(1, 0.9);
const RANGES = Object.freeze({ gamma: [0, GAMMA_MAX], kappa: [2, 200], centre: [60, 2000], decay: [0.2, 8] });
const DEFAULTS = Object.freeze({ gamma: 0, kappa: 40, centre: 320, decay: 2.2 });

const clamp = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

export function captureExceptionalPreset(raw) {
  return Object.fromEntries(EXCEPTIONAL_PRESET_KEYS.map(key => [key, clamp(raw?.[key], ...RANGES[key], DEFAULTS[key])]));
}

export function validateExceptionalPreset(snapshot) {
  if (!snapshot || presetStateKey(snapshot) !== presetStateKey(captureExceptionalPreset(snapshot))) {
    throw new TypeError("Invalid complete Exceptional preset");
  }
  return snapshot;
}

const scene = (id, label, values) => Object.freeze({
  id, label, snapshot: Object.freeze(captureExceptionalPreset({ ...DEFAULTS, ...values })),
});

export const EXCEPTIONAL_FULL_PRESETS = Object.freeze([
  scene("two-clear-modes", "Two clear modes", {}),
  scene("approaching", "Approaching", { gamma: 0.6, kappa: 40, centre: 320, decay: 2.2 }),
  scene("almost-merged", "Almost merged", { gamma: 0.93, kappa: 36, centre: 280, decay: 3 }),
  scene("at-the-point", "At the point", { gamma: 1, kappa: 40, centre: 320, decay: 2.2 }),
  scene("beyond-the-point", "Beyond the point", { gamma: 1.25, kappa: 40, centre: 320, decay: 1.6 }),
  scene("wide-split", "Wide split", { gamma: 0.15, kappa: 190, centre: 520, decay: 1.4 }),
  scene("bass-pair", "Bass pair", { gamma: 0.8, kappa: 18, centre: 90, decay: 4.8 }),
  scene("bright-pair", "Bright pair", { gamma: 0.85, kappa: 120, centre: 1500, decay: 1.2 }),
  scene("long-ring", "Long ring", { gamma: 0.4, kappa: 28, centre: 410, decay: 7.5 }),
  scene("tight-coupling", "Tight coupling", { gamma: 0.97, kappa: 6, centre: 220, decay: 3.4 }),
  scene("pinched-tick", "Pinched tick", { gamma: 0.2, kappa: 80, centre: 900, decay: 0.25 }),
  scene("slow-beating", "Slow beating", { gamma: 0.1, kappa: 3, centre: 440, decay: 5.5 }),
  scene("gain-wall", "Gain wall", { gamma: 1.4, kappa: 60, centre: 700, decay: 0.8 }),
  scene("midrange-merge", "Midrange merge", { gamma: 1.02, kappa: 70, centre: 1100, decay: 2.8 }),
]);

export function randomizeExceptionalPreset(current, random = Math.random) {
  validateExceptionalPreset(current);
  const rng = presetRandom(random);
  const near = rng.unit() < 0.5;
  return validateExceptionalPreset({
    gamma: Math.round((near ? rng.between(0.85, 1.12) : rng.between(0, 1.3)) * 200) / 200,
    kappa: Math.round(4 * 40 ** rng.unit()),
    centre: Math.round(90 * 18 ** rng.unit()),
    decay: Math.round(rng.between(0.3, 7.5) * 20) / 20,
  });
}
