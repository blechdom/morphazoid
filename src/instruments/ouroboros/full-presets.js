import {
  OUROBOROS_DEFAULTS, OUROBOROS_PRESETS, sanitizeOuroborosParams,
} from "./ouroboros.js";
import { createOuroborosFamilyPresets } from "./family-presets.js";

const D = OUROBOROS_DEFAULTS;
const scene = (id, label, overrides) => ({ id, label, ...D, ...overrides });

const family = createOuroborosFamilyPresets({
  defaults: D,
  sanitize: sanitizeOuroborosParams,
  existing: OUROBOROS_PRESETS,
  extra: [
    scene("glacier-toll", "Glacier toll", { glissRate: 0.02, hitRate: 1, centerPitch: 58, bankWidth: 7, decay: 1, character: 0.15, spread: 0.15, noiseMix: 0.08, cutoff: 2400 }),
    scene("ticking-hive", "Ticking hive", { glissRate: 0.25, hitRate: 22, centerPitch: 220, bankWidth: 3.5, decay: 0.03, character: 0.9, spread: 0.9, morphDepth: 0.6, noiseMix: 0.8, cutoff: 17000 }),
    scene("tritone-coil", "Tritone coil", { voiceInterval: 0.5, glissRate: 0.09, hitRate: 3, centerPitch: 98, decay: 0.3, character: 0.4, noiseMix: 0.18, cutoff: 7000 }),
    scene("double-octave-spire", "Double-octave spire", { voiceInterval: 2, bankWidth: 6, glissRate: 0.15, hitRate: 5, centerPitch: 130, decay: 0.22, character: 0.6, spread: 0.5, cutoff: 10000 }),
    scene("slow-undertow", "Slow undertow", { direction: -1, glissRate: 0.03, hitRate: 3, centerPitch: 65, bankWidth: 6.5, decay: 0.7, character: 0.2, spread: 0.2, noiseMix: 0.15, cutoff: 3200 }),
    scene("ash-drone", "Ash drone", { glissRate: 0.05, hitRate: 1.5, centerPitch: 85, morphDepth: 0.2, character: 0.3, decay: 1.2, noiseMix: 0.7, spread: 0.7, cutoff: 3000 }),
    scene("whirlpool", "Whirlpool", { direction: -1, glissRate: 1.4, hitRate: 30, centerPitch: 140, bankWidth: 6, decay: 0.06, character: 0.5, spread: 0.8, noiseMix: 0.5, cutoff: 11000 }),
    scene("bone-rattle", "Bone rattle", { glissRate: 0.18, hitRate: 9, centerPitch: 120, decay: 0.04, character: 1, spread: 0.6, morphDepth: 0.9, noiseMix: 0.95, cutoff: 9000 }),
  ],
  fields: {
    direction: { direction: true },
    glissRate: { range: [0.025, 1.2], log: true },
    hitRate: { range: [0.8, 28], log: true },
    centerPitch: { range: [58, 340], log: true, digits: 1 },
    voiceInterval: { range: [0.5, 2] },
    bankWidth: { range: [3.2, 7] },
    spread: { range: [0, 1] },
    decay: { range: [0.03, 1.2], log: true },
    character: { range: [0, 1] },
    morphDepth: { range: [0.3, 1] },
    noiseMix: { range: [0, 0.95] },
    cutoff: { range: [1800, 17000], log: true, digits: 0 },
  },
});

export const OUROBOROS_FULL_PRESETS = family.presets;
export const OUROBOROS_PRESET_KEYS = family.keys;
export const captureOuroborosPreset = family.capture;
export const validateOuroborosPreset = family.validate;
export const randomizeOuroborosPreset = family.randomize;
