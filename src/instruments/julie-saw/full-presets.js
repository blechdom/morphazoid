import {
  JULIE_SAW_BLADES, JULIE_SAW_DEFAULTS, JULIE_SAW_LIMITS, JULIE_SAW_PRESETS, JULIE_SAW_RHYTHMS, JULIE_SAW_TECHNIQUES,
  applyJulieSawPreset, sanitizeJulieSawState, sweetSpotPosition,
} from "./julie-saw.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const JULIE_SAW_NUMERIC_PRESET_KEYS = Object.freeze(
  Object.keys(JULIE_SAW_LIMITS).filter(key => key !== "level"),
);
export const JULIE_SAW_PRESET_KEYS = Object.freeze([
  "bladeId", "techniqueId", "rhythmId", "trackSweetSpot", ...JULIE_SAW_NUMERIC_PRESET_KEYS,
]);

export function captureJulieSawPreset(state) {
  const clean = sanitizeJulieSawState(state, JULIE_SAW_DEFAULTS);
  return Object.fromEntries(JULIE_SAW_PRESET_KEYS.map(key => [key, clean[key]]));
}

export function validateJulieSawPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object"
    || presetStateKey(snapshot) !== presetStateKey(captureJulieSawPreset(snapshot))
    || Object.keys(snapshot).length !== JULIE_SAW_PRESET_KEYS.length) {
    throw new TypeError("Invalid complete Julie Saw preset");
  }
  return snapshot;
}

export function julieSawStateFromPreset(snapshot, session) {
  validateJulieSawPreset(snapshot);
  return sanitizeJulieSawState({
    ...session, ...snapshot, presetId: "custom", autoPlay: session.autoPlay, level: session.level,
  }, session);
}

const bankEntry = preset => {
  let state = applyJulieSawPreset(preset.id, JULIE_SAW_DEFAULTS);
  if (state.trackSweetSpot) state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
  return Object.freeze({ id: preset.id, label: preset.label, snapshot: Object.freeze(captureJulieSawPreset(state)) });
};

export const JULIE_SAW_FULL_PRESETS = Object.freeze(JULIE_SAW_PRESETS.map(bankEntry));

const RANGES = Object.freeze({
  bend: [.1, .9], tipCurl: [.1, .95], localization: [.4, 1], bladeDamping: [.04, .55], brightness: [.1, .95],
  bowPressure: [.2, .95], bowSpeed: [.15, 1.1], bowContact: [.15, .85], rosin: [.2, .98], bowBite: [.15, .98],
  edgeRasp: [.03, .8], vibratoDepthCents: [0, 80], vibratoRateHz: [1, 9], vibratoDelaySeconds: [0, 1],
  glideSeconds: [.02, .7], attackSeconds: [.004, .4], decaySeconds: [.04, 1.2], sustain: [.35, 1],
  releaseSeconds: [.05, 2.4], body: [.08, .85], stereoWidth: [.05, .9], tempoBpm: [48, 164],
});

export function randomizeJulieSawPreset(current, random = Math.random) {
  validateJulieSawPreset(current);
  const rng = presetRandom(random);
  const values = Object.fromEntries(Object.entries(RANGES).map(([key, [lo, hi]]) => [key, rng.between(lo, hi)]));
  const technique = rng.pick(JULIE_SAW_TECHNIQUES.filter(({ action }) => action !== "choke"));
  const state = sanitizeJulieSawState({
    ...values,
    bladeId: rng.pick(JULIE_SAW_BLADES).id,
    techniqueId: technique.id,
    rhythmId: rng.pick(JULIE_SAW_RHYTHMS).id,
    trackSweetSpot: rng.unit() > .28,
  }, JULIE_SAW_DEFAULTS);
  const tuned = state.trackSweetSpot ? { ...state, bowContact: sweetSpotPosition(state) } : state;
  return validateJulieSawPreset(captureJulieSawPreset(tuned));
}
