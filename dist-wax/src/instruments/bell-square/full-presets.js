import { defineParamModel, range } from "../preset-kit/param-schema.js";

export const BELL_SQUARE_MODEL = defineParamModel({
  collisionPhase: range(0, 360, 1),
  aliceAxis: range(-180, 180, 1),
  bobAxis: range(-180, 180, 1),
  dephasing: range(0, 1, 0.01, [0, 0.85]),
}, { label: "Bell Square" });

export const BELL_SQUARE_PRESET_KEYS = BELL_SQUARE_MODEL.keys;
export const captureBellSquarePreset = state => BELL_SQUARE_MODEL.sanitize(state);
export const validateBellSquarePreset = BELL_SQUARE_MODEL.validate;
export const randomizeBellSquarePreset = BELL_SQUARE_MODEL.randomize;

const square = (collisionPhase, aliceAxis, bobAxis, dephasing) => ({ collisionPhase, aliceAxis, bobAxis, dephasing });

export const BELL_SQUARE_FULL_PRESETS = BELL_SQUARE_MODEL.bank([
  ["bell-phi-plus", "Bell Φ+ · Z × Z", square(180, 0, 0, 0)],
  ["chsh-tilt", "CHSH tilt · Z × 45°", square(180, 0, 45, 0)],
  ["chsh-sweet-spot", "CHSH sweet spot · −45°/45°", square(180, -45, 45, 0)],
  ["x-basis-mirror", "X-basis mirror", square(180, 90, 90, 0)],
  ["crossed-axes", "Crossed Z × X", square(180, 0, 90, 0)],
  ["anti-aligned", "Anti-aligned Z × −Z", square(180, 0, 180, 0)],
  ["half-collision", "Half collision · π/2", square(90, 0, 0, 0)],
  ["quarter-turn", "Three-quarter turn", square(270, 0, 0, 0)],
  ["almost-separable", "Almost separable", square(20, 0, 0, 0)],
  ["dephased-bell", "Dephased Bell pair", square(180, 0, 0, 0.5)],
  ["noisy-chsh", "Noisy CHSH · 25% dephasing", square(180, -45, 45, 0.25)],
  ["slow-skew", "Skewed phase · 135°", square(135, -60, 30, 0.1)],
  ["fading-x", "Fading X-basis", square(225, 90, -90, 0.7)],
  ["wide-open-bell", "Wide-open · −120°/120°", square(180, -120, 120, 0.05)],
]);
