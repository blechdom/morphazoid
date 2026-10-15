import {
  OUROBOROUSEL_DEFAULTS, OUROBOROUSEL_MATERIAL_MODES, OUROBOROUSEL_PRESETS, sanitizeOuroborouselParams,
} from "./ouroborousel.js";
import { createOuroborosFamilyPresets } from "../ouroboros/family-presets.js";

const D = OUROBOROUSEL_DEFAULTS;
const scene = (id, label, overrides) => ({ id, label, ...D, ...overrides });

const family = createOuroborosFamilyPresets({
  defaults: D,
  sanitize: sanitizeOuroborouselParams,
  existing: OUROBOROUSEL_PRESETS,
  extra: [
    scene("slow-bloom", "Slow bloom", { materialMode: "notes", glissRate: 0.03, centerRate: 1.2, bankWidth: 9, noteLift: 7, chunkDuty: 1, fusionPoint: 40, fusionWidth: 4, fusionEmphasis: 0.4, spread: 0.2, brightness: 0.3, cutoff: 5000 }),
    scene("glitch-orbit", "Glitch orbit", { materialMode: "combo", direction: -1, glissRate: 0.9, centerRate: 16, bankWidth: 3.5, noteLift: 3, chunkDuty: 0.18, fusionPoint: 10, fusionWidth: 0.3, fusionEmphasis: 0.8, spread: 0.9, brightness: 0.9, cutoff: 17000 }),
    scene("pillow-drums", "Pillow drums", { materialMode: "drums", glissRate: 0.06, centerRate: 2, bankWidth: 8, noteLift: 5, chunkDuty: 1, fusionPoint: 34, fusionWidth: 5, fusionEmphasis: 0.2, spread: 0.3, brightness: 0.2, cutoff: 4000 }),
    scene("needle-notes", "Needle notes", { materialMode: "notes", direction: -1, glissRate: 0.45, centerRate: 12, bankWidth: 4, noteLift: 4, chunkDuty: 0.35, fusionPoint: 22, fusionWidth: 0.6, fusionEmphasis: 0.6, spread: 0.6, brightness: 0.95, cutoff: 18000 }),
    scene("fused-engine", "Fused engine", { materialMode: "combo", glissRate: 0.15, centerRate: 6, bankWidth: 6.5, noteLift: 5, chunkDuty: 0.6, fusionPoint: 8, fusionWidth: 6, fusionEmphasis: 1, spread: 0.5, brightness: 0.5, cutoff: 9000 }),
    scene("tumble-staircase", "Tumble staircase", { materialMode: "drums", direction: -1, glissRate: 0.7, centerRate: 20, bankWidth: 5, noteLift: 3, chunkDuty: 0.25, fusionPoint: 44, fusionWidth: 0.5, fusionEmphasis: 0.1, spread: 0.95, brightness: 0.6, cutoff: 13000 }),
    scene("half-light", "Half light", { materialMode: "combo", glissRate: 0.25, centerRate: 3, bankWidth: 7, noteLift: 6, chunkDuty: 0.8, fusionPoint: 28, fusionWidth: 1.5, fusionEmphasis: 0.7, spread: 0.4, brightness: 0.45, cutoff: 8000 }),
  ],
  fields: {
    materialMode: { choices: OUROBOROUSEL_MATERIAL_MODES },
    direction: { direction: true },
    glissRate: { range: [0.025, 1], log: true },
    centerRate: { range: [0.8, 20], log: true },
    bankWidth: { range: [3.2, 9] },
    noteLift: { range: [3, 7], digits: 0 },
    chunkDuty: { range: [0.18, 1] },
    fusionPoint: { range: [8, 46], digits: 1 },
    fusionWidth: { range: [0.3, 6], log: true },
    fusionEmphasis: { range: [0, 1] },
    spread: { range: [0, 1] },
    brightness: { range: [0.1, 1] },
    cutoff: { range: [2500, 18000], log: true, digits: 0 },
  },
});

export const OUROBOROUSEL_FULL_PRESETS = family.presets;
export const OUROBOROUSEL_PRESET_KEYS = family.keys;
export const captureOuroborouselPreset = family.capture;
export const validateOuroborouselPreset = family.validate;
export const randomizeOuroborouselPreset = family.randomize;
