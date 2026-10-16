import { ANNEALOGUE_LANDSCAPES } from "./annealogue.js";
import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

export const ANNEALOGUE_MODEL = defineParamModel({
  landscapeId: choice(Object.keys(ANNEALOGUE_LANDSCAPES)),
  durationSeconds: range(1, 20, 0.25),
  gamma: range(0, 3, 0.01),
}, { label: "Annealogue" });

export const ANNEALOGUE_PRESET_KEYS = ANNEALOGUE_MODEL.keys;
export const captureAnnealoguePreset = state => ANNEALOGUE_MODEL.sanitize(state);
export const validateAnnealoguePreset = ANNEALOGUE_MODEL.validate;
export const randomizeAnnealoguePreset = ANNEALOGUE_MODEL.randomize;

const anneal = (landscapeId, durationSeconds, gamma) => ({ landscapeId, durationSeconds, gamma });

export const ANNEALOGUE_FULL_PRESETS = ANNEALOGUE_MODEL.bank([
  ["single-basin-standard", "Single basin · standard", anneal("single-basin", 8, 1.25)],
  ["false-floor-standard", "False floor · standard", anneal("false-floor", 8, 1.25)],
  ["frustrated-ring-standard", "Frustrated ring · standard", anneal("frustrated-ring", 8, 1.25)],
  ["quick-quench", "Quick quench", anneal("single-basin", 2, 2.5)],
  ["adiabatic-floor", "Slow adiabatic false floor", anneal("false-floor", 16, 1.8)],
  ["patient-ring", "Patient ring", anneal("frustrated-ring", 20, 2.2)],
  ["trapped-low-field", "Trapped in the false floor", anneal("false-floor", 3, 0.4)],
  ["low-field-glide", "Low-field glide", anneal("single-basin", 14, 0.6)],
  ["strong-field-jitter", "Strong-field jitter", anneal("frustrated-ring", 5, 3)],
  ["instant-snap", "Instant snap", anneal("single-basin", 1, 3)],
  ["wide-tunnel", "Wide tunnel", anneal("false-floor", 10, 2.8)],
  ["cool-ring", "Cool ring", anneal("frustrated-ring", 12, 0.9)],
  ["barely-there-field", "Barely-there field", anneal("single-basin", 20, 0.15)],
]);
