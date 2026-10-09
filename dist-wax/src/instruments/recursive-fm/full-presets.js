import { RECURSIVE_FM_PRESETS, sanitizeRecursiveFmSettings } from "./recursive-fm.js";
import { RECURSIVE_FM_PERFORMANCE_DEFAULTS, sanitizeRecursiveFmPerformance } from "./recursive-fm.js";
import { createRecursiveFullPresets } from "../../families/recursive/full-presets.js";
import { RECURSIVE_ADDITIONAL_VOICINGS } from "../../families/recursive/preset-voicings.js";

export const recursiveFmPresets = createRecursiveFullPresets({
  kind: "fm", originals: RECURSIVE_FM_PRESETS, additions: RECURSIVE_ADDITIONAL_VOICINGS.fm,
  performanceDefaults: RECURSIVE_FM_PERFORMANCE_DEFAULTS,
  sanitizeSettings: sanitizeRecursiveFmSettings, sanitizePerformance: sanitizeRecursiveFmPerformance,
});
export const RECURSIVE_FM_FULL_PRESETS = recursiveFmPresets.bank;
export const randomizeRecursiveFmPreset = recursiveFmPresets.randomize;
