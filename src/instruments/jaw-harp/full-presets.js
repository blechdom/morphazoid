import {
  JAW_HARP_DEFAULTS, JAW_HARP_STYLE_REFERENCES, jawHarpPreset, jawHarpState, applyJawHarpStyle,
  sanitizeJawHarpState, randomizeJawHarpState,
} from "./jaw-harp.js";
import { clonePresetData, presetRandom } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";

export const JAW_HARP_LIVE_KEYS = Object.freeze(["repeat", "breathFlow"]);
const parameterKeys = Object.keys(JAW_HARP_DEFAULTS).filter(key => !JAW_HARP_LIVE_KEYS.includes(key));
export function captureJawHarpPreset(state) {
  return clonePresetData({ parameters: Object.fromEntries(parameterKeys.map(key => [key, state[key]])) });
}
export function validateJawHarpPreset(snapshot) {
  presetStateKey(snapshot);
  if (Object.keys(snapshot.parameters ?? {}).length !== parameterKeys.length
    || parameterKeys.some(key => !Object.hasOwn(snapshot.parameters, key))
    || presetStateKey(captureJawHarpPreset(sanitizeJawHarpState(snapshot.parameters))) !== presetStateKey(snapshot)) throw new TypeError("Invalid complete Jaw Harp preset");
  return snapshot;
}
// Preserve all sixteen authored performance styles, now paired with their
// recommended physical harp and complete controls rather than changing only style.
export const JAW_HARP_FULL_PRESETS = Object.freeze(JAW_HARP_STYLE_REFERENCES.map(style => ({
  id: style.id, label: `${jawHarpPreset(style.recommendedPresetId).label} · ${style.label}`,
  description: `${style.description} Complete physical harp, mouth, breath, rhythm and vowel sequence. Audio and Repeat are not started.`,
  snapshot: validateJawHarpPreset(captureJawHarpPreset(applyJawHarpStyle(
    jawHarpState(style.recommendedPresetId, { level: 0.48 }), style.id,
  ))),
})));
export function randomizeJawHarpPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const parameters = randomizeJawHarpState(current.parameters, rng.unit);
  parameters.styleId = rng.pick(["custom", ...JAW_HARP_STYLE_REFERENCES.map(style => style.id)]);
  parameters.level = current.parameters.level;
  return validateJawHarpPreset(captureJawHarpPreset(parameters));
}
