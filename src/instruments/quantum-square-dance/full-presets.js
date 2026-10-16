import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

export const SQUARE_DANCE_SCENES = Object.freeze(["one-pair", "hold-half-swap", "whole-floor"]);
export const SQUARE_DANCE_PREPARATIONS = Object.freeze(["01", "10", "00", "11"]);
export const SQUARE_DANCE_ROOTS = Object.freeze([109.65, 164.48, 219.3, 293.66, 438.6]);

const constrain = snapshot => {
  if (snapshot.scene === "whole-floor") return { ...snapshot, pairCount: Math.max(8, snapshot.pairCount) };
  if (snapshot.scene === "hold-half-swap") return { ...snapshot, pairCount: 1, phaseDegrees: 90 };
  return { ...snapshot, pairCount: 1 };
};

export const SQUARE_DANCE_MODEL = defineParamModel({
  scene: choice(SQUARE_DANCE_SCENES),
  preparation: choice(SQUARE_DANCE_PREPARATIONS),
  phaseDegrees: range(0, 360, 0.1),
  cycleDuration: range(0.6, 9.6, 0.05),
  coherence: range(0, 1, 0.01, [0.1, 1]),
  pairCount: range(1, 32, 1),
  rootFrequency: choice(SQUARE_DANCE_ROOTS),
  contourRange: range(0, 24, 1),
  phraseDensity: range(2, 12, 1),
  spectralColor: range(0, 1, 0.01),
}, { constrain, label: "Quantum Square Dance" });

export const SQUARE_DANCE_PRESET_KEYS = SQUARE_DANCE_MODEL.keys;
export const captureSquareDancePreset = state => SQUARE_DANCE_MODEL.sanitize(state);
export const validateSquareDancePreset = SQUARE_DANCE_MODEL.validate;
export const randomizeSquareDancePreset = SQUARE_DANCE_MODEL.randomize;

const dance = (scene, preparation, phaseDegrees, cycleDuration, coherence, pairCount, rootFrequency, contourRange, phraseDensity, spectralColor) => (
  { scene, preparation, phaseDegrees, cycleDuration, coherence, pairCount, rootFrequency, contourRange, phraseDensity, spectralColor }
);

export const SQUARE_DANCE_FULL_PRESETS = SQUARE_DANCE_MODEL.bank([
  ["one-pair-swing", "Swing one pair", dance("one-pair", "01", 0, 2.4, 1, 1, 219.3, 12, 6, 0.58)],
  ["held-root-swap", "Held √SWAP hum", dance("hold-half-swap", "01", 90, 3.6, 1, 1, 164.48, 7, 4, 0.4)],
  ["whole-floor-cascade", "Whole-floor cascade", dance("whole-floor", "01", 0, 4.8, 1, 16, 219.3, 14, 8, 0.62)],
  ["reversed-pair", "Reversed pair · ↓↑", dance("one-pair", "10", 45, 2.4, 0.95, 1, 293.66, 10, 6, 0.5)],
  ["aligned-up-drone", "Aligned ↑↑ drone", dance("one-pair", "00", 0, 6, 1, 1, 109.65, 3, 3, 0.2)],
  ["aligned-down-chime", "Aligned ↓↓ chime", dance("one-pair", "11", 180, 1.8, 1, 1, 438.6, 5, 10, 0.85)],
  ["faded-coherence", "Faded coherence", dance("one-pair", "01", 90, 3, 0.35, 1, 164.48, 9, 6, 0.45)],
  ["quick-reel", "Quick reel", dance("one-pair", "01", 0, 0.9, 1, 1, 293.66, 17, 12, 0.7)],
  ["glacial-exchange", "Glacial exchange", dance("one-pair", "10", 0, 9.2, 1, 1, 109.65, 4, 2, 0.15)],
  ["packed-floor", "Packed floor · 32 pairs", dance("whole-floor", "10", 0, 3.2, 0.8, 32, 164.48, 20, 9, 0.75)],
  ["bright-half-swap", "Bright held half-swap", dance("hold-half-swap", "10", 90, 1.4, 0.9, 1, 438.6, 12, 11, 0.92)],
  ["wide-contour-solo", "Wide contour solo", dance("one-pair", "01", 270, 4.2, 0.7, 1, 219.3, 24, 5, 0.3)],
  ["murmuring-hall", "Murmuring hall", dance("whole-floor", "00", 0, 7.5, 0.5, 24, 109.65, 8, 4, 0.1)],
]);
