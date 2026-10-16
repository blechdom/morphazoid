import { presetRandom } from "../../site/preset-random.js";

export const ONSET_ATLAS_PARAMS = Object.freeze({
  sensitivity: { min: 0.02, max: 0.9, step: 0.01 },
  minSeg: { min: 0.02, max: 0.5, step: 0.005 },
  similarity: { min: 0.05, max: 1.2, step: 0.01 },
  speed: { min: 0.5, max: 2, step: 0.01 },
});
export const ONSET_ATLAS_PRESET_KEYS = Object.freeze([...Object.keys(ONSET_ATLAS_PARAMS), "accepted"]);

const snap = (value, { min, max, step }) => {
  const digits = (String(step).split(".")[1] ?? "").length;
  return Number((Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min).toFixed(digits));
};

export function captureOnsetAtlasPreset({ params, accepted }) {
  return { ...Object.fromEntries(Object.keys(ONSET_ATLAS_PARAMS).map(key => [key, params[key]])), accepted };
}

export function validateOnsetAtlasPreset(snapshot) {
  const ok = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length === ONSET_ATLAS_PRESET_KEYS.length
    && typeof snapshot.accepted === "boolean"
    && Object.entries(ONSET_ATLAS_PARAMS).every(([key, spec]) => Number.isFinite(snapshot[key])
      && snapshot[key] >= spec.min && snapshot[key] <= spec.max && snap(snapshot[key], spec) === snapshot[key]);
  if (!ok) throw new TypeError("Invalid complete Onset Atlas preset");
  return snapshot;
}

const scene = (id, label, sensitivity, minSeg, similarity, speed, accepted) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateOnsetAtlasPreset({ sensitivity, minSeg, similarity, speed, accepted })) });

export const ONSET_ATLAS_FULL_PRESETS = Object.freeze([
  scene("proposal", "Proposal (original order)", 0.45, 0.08, 0.45, 1, false),
  scene("graph-walk", "Graph walk", 0.45, 0.08, 0.45, 1, true),
  scene("fine-slicer", "Fine slicer", 0.15, 0.03, 0.05, 1, true),
  scene("coarse-phrases", "Coarse phrases", 0.7, 0.25, 0.08, 0.9, true),
  scene("distinct-families", "Distinct families", 0.3, 0.06, 0.05, 1, true),
  scene("merged-families", "Merged families", 0.35, 0.08, 0.15, 1, true),
  scene("double-time-walk", "Double-time walk", 0.4, 0.05, 0.08, 2, true),
  scene("half-time-original", "Half-time original", 0.45, 0.1, 0.45, 0.5, false),
  scene("hair-trigger", "Hair trigger", 0.05, 0.02, 0.1, 1.5, true),
  scene("sparse-onsets", "Sparse onsets", 0.85, 0.15, 0.06, 0.75, false),
  scene("stutter-graph", "Stutter graph", 0.2, 0.04, 0.08, 1.25, true),
  scene("long-gesture", "Long gesture", 0.6, 0.4, 0.05, 0.6, true),
]);

export function randomizeOnsetAtlasPreset(current, random = Math.random) {
  validateOnsetAtlasPreset(current);
  const rng = presetRandom(random);
  const logBetween = ({ min, max }, lo = min, hi = max) => Math.exp(rng.between(Math.log(lo), Math.log(hi)));
  const p = ONSET_ATLAS_PARAMS;
  return validateOnsetAtlasPreset({
    sensitivity: snap(rng.between(0.05, 0.88), p.sensitivity),
    minSeg: snap(logBetween(p.minSeg, 0.02, 0.45), p.minSeg),
    similarity: snap(rng.unit() < 0.7 ? rng.between(0.05, 0.2) : logBetween(p.similarity, 0.2, 1.18), p.similarity),
    speed: snap(logBetween(p.speed), p.speed),
    accepted: rng.unit() < 0.65,
  });
}
