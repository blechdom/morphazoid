import {
  COLONY_SYRINX_CALLS, COLONY_SYRINX_LANE_COUNT, DEFAULT_COLONY_SYRINX_STATE,
  createColonySyrinxCallState, randomizeColonySyrinxState, sanitizeColonySyrinxState,
} from "./monstroid.js";
import { colonySyrinxGraphLayoutFromOrganLayout, colonySyrinxOrganLayoutFromGraph } from "./monstroid-graph.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const SESSION_KEYS = new Set([
  "level", "midiBaseNote", "midiMode", "sequencerEnabled", "tempoBpm", "stepsPerBeat", "swing", "lanes", "sequence",
]);
export const MONSTROID_PRESET_KEYS = Object.freeze(
  Object.keys(DEFAULT_COLONY_SYRINX_STATE).filter(key => !SESSION_KEYS.has(key)),
);

export function captureMonstroidPreset(state) {
  const clean = sanitizeColonySyrinxState(state, DEFAULT_COLONY_SYRINX_STATE);
  return JSON.parse(JSON.stringify(Object.fromEntries(MONSTROID_PRESET_KEYS.map(key => [key, clean[key]]))));
}

export function validateMonstroidPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== MONSTROID_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureMonstroidPreset(snapshot))) {
    throw new TypeError("Invalid complete Monstroid preset");
  }
  return snapshot;
}

export function monstroidStateFromPreset(snapshot, session) {
  validateMonstroidPreset(snapshot);
  return sanitizeColonySyrinxState({ ...session, ...snapshot }, session);
}

const BASE_CALLS = COLONY_SYRINX_CALLS.filter(({ id }) => !/-(forked|migrating)$/.test(id));

export const MONSTROID_FULL_PRESETS = Object.freeze(BASE_CALLS.map(recipe => Object.freeze({
  id: recipe.id,
  label: String(recipe.label).replace(/^(?:air|water|pellets)\s*\/\s*/iu, "").trim(),
  snapshot: Object.freeze(captureMonstroidPreset(createColonySyrinxCallState(recipe.id))),
})));

export function monstroidCallIdForSnapshot(snapshot) {
  const key = presetStateKey(snapshot);
  return MONSTROID_FULL_PRESETS.find(preset => presetStateKey(preset.snapshot) === key)?.id ?? null;
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function randomizeMonstroidPreset(current, random = Math.random) {
  validateMonstroidPreset(current);
  const rng = presetRandom(random);
  const base = sanitizeColonySyrinxState({ ...DEFAULT_COLONY_SYRINX_STATE, ...current }, DEFAULT_COLONY_SYRINX_STATE);
  const seed = Math.floor(rng.unit() * 0x100000000) >>> 0;
  const drawn = randomizeColonySyrinxState(base, { scope: "all", seed });
  const audible = 1 + rng.integer(0, COLONY_SYRINX_LANE_COUNT - 1);
  const order = Array.from({ length: COLONY_SYRINX_LANE_COUNT - 1 }, (_, index) => index + 1)
    .map(index => [rng.unit(), index]).sort((a, b) => a[0] - b[0]).map(([, index]) => index);
  const kept = new Set([0, ...order.slice(0, audible - 1)]);
  const layout = colonySyrinxOrganLayoutFromGraph(colonySyrinxGraphLayoutFromOrganLayout(drawn.organLayout));
  const result = sanitizeColonySyrinxState({
    ...drawn,
    organLayout: layout,
    contourDurationSeconds: clamp(drawn.contourDurationSeconds, 1, 40),
    valveSlewMs: clamp(drawn.valveSlewMs, 1, 180),
    contours: drawn.contours.map((contour, index) => ({ ...contour, rate: clamp(contour.rate, .25, 4), muted: !kept.has(index) })),
  }, drawn);
  return validateMonstroidPreset(captureMonstroidPreset(result));
}
