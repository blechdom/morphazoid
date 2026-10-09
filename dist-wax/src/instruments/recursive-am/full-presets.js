import { RECURSIVE_AM_PRESETS, sanitizeRecursiveAmSettings } from "./recursive-am.js";
import { RECURSIVE_AM_PERFORMANCE_DEFAULTS, sanitizeRecursiveAmPerformance } from "./recursive-am-midi.js";
import { createRecursiveFullPresets } from "../../families/recursive/full-presets.js";
import { RECURSIVE_ADDITIONAL_VOICINGS } from "../../families/recursive/preset-voicings.js";

export const recursiveAmPresets = createRecursiveFullPresets({
  kind: "am", originals: RECURSIVE_AM_PRESETS, additions: RECURSIVE_ADDITIONAL_VOICINGS.am,
  performanceDefaults: RECURSIVE_AM_PERFORMANCE_DEFAULTS,
  sanitizeSettings: sanitizeRecursiveAmSettings, sanitizePerformance: sanitizeRecursiveAmPerformance,
});
export const RECURSIVE_AM_FULL_PRESETS = recursiveAmPresets.bank;
export const randomizeRecursiveAmPreset = recursiveAmPresets.randomize;
