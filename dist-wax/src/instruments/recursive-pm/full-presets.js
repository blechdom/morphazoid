import { RECURSIVE_PM_PRESETS, sanitizeRecursivePmSettings } from "./recursive-pm.js";
import { RECURSIVE_PM_PERFORMANCE_DEFAULTS, sanitizeRecursivePmPerformance } from "./recursive-pm-midi.js";
import { createRecursiveFullPresets } from "../../families/recursive/full-presets.js";
import { RECURSIVE_ADDITIONAL_VOICINGS } from "../../families/recursive/preset-voicings.js";

export const recursivePmPresets = createRecursiveFullPresets({
  kind: "pm", originals: RECURSIVE_PM_PRESETS, additions: RECURSIVE_ADDITIONAL_VOICINGS.pm,
  performanceDefaults: RECURSIVE_PM_PERFORMANCE_DEFAULTS,
  sanitizeSettings: sanitizeRecursivePmSettings, sanitizePerformance: sanitizeRecursivePmPerformance,
});
export const RECURSIVE_PM_FULL_PRESETS = recursivePmPresets.bank;
export const randomizeRecursivePmPreset = recursivePmPresets.randomize;
