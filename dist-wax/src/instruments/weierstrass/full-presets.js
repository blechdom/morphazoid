import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { logBetween } from "../../families/chaotic/chaotic-full-presets.js";
import {
  WEIERSTRASS_FM_PRESETS, WEIERSTRASS_PM_PRESETS, WEIERSTRASS_PRESETS, sanitizeWeierstrassParams,
} from "./weierstrass.js";

export const WEIERSTRASS_PRESET_KEYS = Object.freeze([
  "mode", "terms", "startExponent", "amplitudeRatio", "frequencyRatio", "baseFrequencyHz",
  "fmDepthHz", "offsetHz", "pmCarrierFrequencyHz", "pmIndexCycles",
]);
const MODES = Object.freeze(["wave", "fm", "pm"]);
const FM_KEYS = ["fmDepthHz", "offsetHz"];
const PM_KEYS = ["pmCarrierFrequencyHz", "pmIndexCycles"];

export function captureWeierstrassPreset(settings) {
  const safe = sanitizeWeierstrassParams(settings);
  return Object.fromEntries(WEIERSTRASS_PRESET_KEYS.map(key => [key, safe[key]]));
}

export function validateWeierstrassPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || Object.keys(snapshot).length !== WEIERSTRASS_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureWeierstrassPreset(snapshot))) {
    throw new TypeError("Invalid complete Weierstrass preset");
  }
  return captureWeierstrassPreset(snapshot);
}

const inactiveDefaults = {
  fm: Object.fromEntries(FM_KEYS.map(key => [key, WEIERSTRASS_FM_PRESETS[0].settings[key]])),
  pm: Object.fromEntries(PM_KEYS.map(key => [key, WEIERSTRASS_PM_PRESETS[0].settings[key]])),
};

// Inactive-mode values are canonical so a recalled scene captures to exactly itself.
const scene = (id, label, description, settings) => {
  const active = { fm: FM_KEYS, pm: PM_KEYS, wave: [] }[settings.mode];
  const full = {
    ...inactiveDefaults.fm, ...inactiveDefaults.pm,
    ...Object.fromEntries(Object.entries(settings).filter(([key]) => (
      !FM_KEYS.includes(key) && !PM_KEYS.includes(key)) || active.includes(key))),
  };
  return Object.freeze({
    id, label, description,
    snapshot: Object.freeze(captureWeierstrassPreset(full)),
  });
};

export const WEIERSTRASS_FULL_PRESETS = Object.freeze([
  ...WEIERSTRASS_PRESETS.map(preset => scene(preset.id, preset.label, preset.description, preset.settings)),
  scene("octave-stair", "Octave Stair", "Nine octave-spaced partials fall off gently into a clean sawlike staircase.", {
    mode: "wave", terms: 9, startExponent: 0, amplitudeRatio: 0.7, frequencyRatio: 2, baseFrequencyHz: 55,
  }),
  scene("odd-tower", "Odd Tower", "Twelfth-spaced partials with a fast taper build a hollow, clarinet-like tower.", {
    mode: "wave", terms: 7, startExponent: 0, amplitudeRatio: 0.6, frequencyRatio: 3, baseFrequencyHz: 40,
  }),
  scene("tide-lattice", "Tide Lattice", "Close, nearly flat partials blur into a dense, beating sub-bass cloud.", {
    mode: "wave", terms: 24, startExponent: 0, amplitudeRatio: 0.92, frequencyRatio: 1.25, baseFrequencyHz: 30,
  }),
  scene("slow-bellows", "Slow Bellows", "Five modest partials swept by a deep, slow frequency modulation.", {
    mode: "fm", terms: 5, startExponent: 0, amplitudeRatio: 0.5, frequencyRatio: 1.5, baseFrequencyHz: 110,
    fmDepthHz: 400, offsetHz: 60,
  }),
  scene("phase-glass", "Phase Glass", "Six octave partials folded through a mid-register phase carrier.", {
    mode: "pm", terms: 6, startExponent: 0, amplitudeRatio: 0.6, frequencyRatio: 2, baseFrequencyHz: 55,
    pmCarrierFrequencyHz: 220, pmIndexCycles: 3,
  }),
]);

export function randomizeWeierstrassPreset(current, random = Math.random) {
  validateWeierstrassPreset(current);
  const rng = presetRandom(random);
  const frequencyRatio = rng.between(1.15, 3.2);
  const startExponent = rng.integer(0, 3);
  const baseFrequencyHz = Math.min(logBetween(rng, 30, 400), 9000 / frequencyRatio ** (startExponent + 1));
  return validateWeierstrassPreset(captureWeierstrassPreset({
    mode: rng.pick(MODES),
    terms: rng.integer(3, 16),
    startExponent,
    amplitudeRatio: rng.between(0.35, 0.92),
    frequencyRatio,
    baseFrequencyHz,
    fmDepthHz: logBetween(rng, 80, 3000),
    offsetHz: rng.between(0, 800),
    pmCarrierFrequencyHz: logBetween(rng, 30, 600),
    pmIndexCycles: rng.between(0.1, 6),
  }));
}
