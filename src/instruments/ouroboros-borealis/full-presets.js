import {
  OUROBOROS_BOREALIS_DEFAULTS, OUROBOROS_BOREALIS_PRESETS, sanitizeOuroborosBorealisParams,
} from "./ouroboros-borealis.js";
import { createOuroborosFamilyPresets } from "../ouroboros/family-presets.js";

const D = OUROBOROS_BOREALIS_DEFAULTS;
const scene = (id, label, overrides) => ({ id, label, ...D, ...overrides });

const family = createOuroborosFamilyPresets({
  defaults: D,
  sanitize: sanitizeOuroborosBorealisParams,
  existing: OUROBOROS_BOREALIS_PRESETS,
  extra: [
    scene("slow-tide", "Slow tide", { pitchGlissRate: 0.03, rhythmGlissRate: 0.025, centerPitch: 70, centerRate: 1.2, pitchWidth: 8, rhythmWidth: 8, phaseOffset: 0.5, coupling: 0.3, spread: 0.2, decay: 0.9, character: 0.2, noiseMix: 0.12, cutoff: 3500 }),
    scene("cross-currents", "Cross currents", { pitchGlissRate: 0.3, rhythmGlissRate: 0.5, centerPitch: 210, centerRate: 6, phaseOffset: 0.33, coupling: -1, couplingFocus: 0.9, spread: 0.55, decay: 0.1, character: 0.7, cutoff: 12000 }),
    scene("tritone-dance", "Tritone dance", { pitchInterval: 0.5, rhythmInterval: 2, pitchWidth: 5, rhythmWidth: 4, centerPitch: 98, centerRate: 3.5, coupling: 0.6, couplingFocus: 0.3, decay: 0.25, character: 0.4, cutoff: 7000 }),
    scene("stutter-glass", "Stutter glass", { rhythmDirection: 1, pitchGlissRate: 0.2, rhythmGlissRate: 0.9, centerPitch: 420, centerRate: 14, pitchWidth: 3.5, rhythmWidth: 3.5, decay: 0.04, character: 0.95, morphDepth: 0.6, noiseMix: 0.1, cutoff: 16000, spread: 0.85 }),
    scene("midnight-drift", "Midnight drift", { pitchDirection: -1, pitchGlissRate: 0.05, rhythmGlissRate: 0.12, centerPitch: 55, centerRate: 2, pitchWidth: 9, rhythmWidth: 3.5, phaseOffset: 0.9, coupling: 0.15, spread: 0.9, decay: 0.6, character: 0.35, morphDepth: 0.5, cutoff: 4500 }),
    scene("mirror-pulse", "Mirror pulse", { rhythmDirection: 1, pitchGlissRate: 0.2, rhythmGlissRate: 0.2, centerPitch: 160, centerRate: 5, pitchWidth: 6, rhythmWidth: 6, pitchInterval: 1.25, rhythmInterval: 1.25, phaseOffset: 0.5, coupling: 1, couplingFocus: 1, decay: 0.14, character: 0.6, cutoff: 10000 }),
    scene("ember-hiss", "Ember hiss", { pitchGlissRate: 0.15, rhythmGlissRate: 0.6, centerPitch: 300, centerRate: 9, coupling: -0.4, couplingFocus: 0.7, decay: 0.09, character: 1, noiseMix: 0.9, cutoff: 9000, phaseOffset: 0.15 }),
  ],
  fields: {
    pitchDirection: { direction: true },
    rhythmDirection: { direction: true },
    pitchGlissRate: { range: [0.025, 1], log: true },
    rhythmGlissRate: { range: [0.025, 1], log: true },
    centerPitch: { range: [55, 420], log: true, digits: 1 },
    centerRate: { range: [1, 14], log: true },
    pitchWidth: { range: [3.2, 9] },
    rhythmWidth: { range: [3.2, 9] },
    pitchInterval: { range: [0.5, 2] },
    rhythmInterval: { range: [0.5, 2] },
    phaseOffset: { range: [0, 1] },
    coupling: { range: [-1, 1] },
    couplingFocus: { range: [0, 1] },
    spread: { range: [0, 1] },
    decay: { range: [0.03, 1.2], log: true },
    character: { range: [0, 1] },
    morphDepth: { range: [0.3, 1] },
    noiseMix: { range: [0, 0.95] },
    cutoff: { range: [1800, 17000], log: true, digits: 0 },
  },
});

export const OUROBOROS_BOREALIS_FULL_PRESETS = family.presets;
export const OUROBOROS_BOREALIS_PRESET_KEYS = family.keys;
export const captureOuroborosBorealisPreset = family.capture;
export const validateOuroborosBorealisPreset = family.validate;
export const randomizeOuroborosBorealisPreset = family.randomize;
