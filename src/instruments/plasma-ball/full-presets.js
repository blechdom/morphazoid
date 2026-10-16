import { defineParamModel, range } from "../preset-kit/param-schema.js";

export const PLASMA_BALL_MODEL = defineParamModel({
  boltCount: range(4, 18, 1),
  attraction: range(0, 1, 0.01),
  motion: range(0, 1, 0.01),
  jitter: range(0, 1, 0.01),
  branching: range(0, 1, 0.01),
  baseFrequency: range(28, 220, 1),
  pitchRange: range(0.5, 6, 0.1),
}, { label: "Plasma Ball" });

export const PLASMA_BALL_PRESET_KEYS = PLASMA_BALL_MODEL.keys;
export const capturePlasmaBallPreset = state => PLASMA_BALL_MODEL.sanitize(state);
export const validatePlasmaBallPreset = PLASMA_BALL_MODEL.validate;
export const randomizePlasmaBallPreset = PLASMA_BALL_MODEL.randomize;

const ball = (boltCount, attraction, motion, jitter, branching, baseFrequency, pitchRange) => (
  { boltCount, attraction, motion, jitter, branching, baseFrequency, pitchRange }
);

export const PLASMA_BALL_FULL_PRESETS = PLASMA_BALL_MODEL.bank([
  ["quiet-static", "Quiet static", ball(10, 0.82, 0.72, 0.82, 0.74, 68, 3.6)],
  ["calm-globe", "Calm globe", ball(6, 0.4, 0.3, 0.3, 0.3, 90, 2)],
  ["thunderhead", "Thunderhead", ball(18, 0.2, 1, 1, 1, 40, 5)],
  ["glass-magnet", "Glass magnet", ball(8, 1, 0.55, 0.4, 0.5, 110, 3)],
  ["sparse-crackle", "Sparse crackle", ball(4, 0.5, 0.9, 0.7, 0.2, 180, 4.5)],
  ["low-hum-web", "Low hum web", ball(14, 0.6, 0.35, 0.5, 0.9, 30, 1.5)],
  ["tesla-chatter", "Tesla chatter", ball(16, 0.3, 0.95, 0.95, 0.6, 150, 6)],
  ["slow-tendrils", "Slow tendrils", ball(12, 0.9, 0.12, 0.2, 0.8, 55, 2.5)],
  ["narrow-pitch-cluster", "Narrow pitch cluster", ball(10, 0.7, 0.6, 0.6, 0.5, 100, 0.5)],
  ["wide-pitch-storm", "Wide pitch storm", ball(12, 0.4, 0.85, 0.9, 0.7, 28, 6)],
  ["mellow-branches", "Mellow branches", ball(9, 0.75, 0.4, 0.35, 1, 75, 1.2)],
  ["pinpoint-zaps", "Pinpoint zaps", ball(5, 1, 1, 0.1, 0, 200, 3)],
  ["dense-lattice", "Dense lattice", ball(18, 0.55, 0.5, 0.55, 0.95, 120, 2.2)],
]);
