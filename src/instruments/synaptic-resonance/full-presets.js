import { presetRandom } from "../../site/preset-random.js";

export const SYNAPTIC_PARAMS = Object.freeze({
  rate: { min: 0.3, max: 14, step: 0.05 },
  facil: { min: 0, max: 1.4, step: 0.01 },
  deplete: { min: 0, max: 0.9, step: 0.01 },
  inhibition: { min: 0, max: 1, step: 0.01 },
  decay: { min: 0.2, max: 6, step: 0.05 },
});
export const SYNAPTIC_NODE_COUNT = 7;
export const SYNAPTIC_PRESET_KEYS = Object.freeze([...Object.keys(SYNAPTIC_PARAMS), "autoPulse", "seedNode"]);

const snap = (value, { min, max, step }) => {
  const digits = (String(step).split(".")[1] ?? "").length;
  return Number((Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min).toFixed(digits));
};

export function captureSynapticPreset({ params, seedNode }) {
  return { ...Object.fromEntries(Object.keys(SYNAPTIC_PARAMS).map(key => [key, params[key]])), autoPulse: params.autoPulse, seedNode };
}

export function validateSynapticPreset(snapshot) {
  const ok = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length === SYNAPTIC_PRESET_KEYS.length
    && typeof snapshot.autoPulse === "boolean"
    && Number.isInteger(snapshot.seedNode) && snapshot.seedNode >= 0 && snapshot.seedNode < SYNAPTIC_NODE_COUNT
    && Object.entries(SYNAPTIC_PARAMS).every(([key, spec]) => Number.isFinite(snapshot[key])
      && snapshot[key] >= spec.min && snapshot[key] <= spec.max && snap(snapshot[key], spec) === snapshot[key]);
  if (!ok) throw new TypeError("Invalid complete Synaptic Resonance preset");
  return snapshot;
}

const scene = (id, label, rate, facil, deplete, inhibition, decay, autoPulse, seedNode) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateSynapticPreset({ rate, facil, deplete, inhibition, decay, autoPulse, seedNode })) });

export const SYNAPTIC_FULL_PRESETS = Object.freeze([
  scene("balanced-mesh", "Balanced mesh", 4, 0.55, 0.42, 0.75, 2.6, true, 0),
  scene("slow-ring", "Slow ring", 1.2, 0.3, 0.25, 0.9, 4, true, 0),
  scene("shortcut-burst", "Shortcut burst", 11, 0.9, 0.55, 0.8, 1.2, true, 3),
  scene("all-branches", "All branches", 4, 0.55, 0.42, 0, 2.6, true, 0),
  scene("winner-take-all", "Winner take all", 6, 0.7, 0.3, 1, 1.8, true, 5),
  scene("glass-rain", "Glass rain", 13, 0.4, 0.7, 0.2, 0.5, true, 2),
  scene("deep-gong", "Deep gong", 0.6, 1.2, 0.1, 0.5, 6, true, 4),
  scene("hair-trigger", "Hair trigger", 8, 1.4, 0.8, 0.6, 0.8, true, 6),
  scene("hand-played", "Hand played", 4, 0.55, 0.42, 0.75, 2.6, false, 0),
  scene("tidal", "Tidal", 2.5, 0.1, 0.05, 0.35, 3.4, true, 1),
  scene("depleted-stutter", "Depleted stutter", 9, 0.2, 0.88, 0.05, 0.35, true, 3),
  scene("resonant-lattice", "Resonant lattice", 5, 1, 0.5, 0.95, 5.5, true, 2),
]);

export function randomizeSynapticPreset(current, random = Math.random) {
  validateSynapticPreset(current);
  const rng = presetRandom(random);
  const p = SYNAPTIC_PARAMS;
  const logBetween = (spec, lo = spec.min, hi = spec.max) => Math.exp(rng.between(Math.log(lo), Math.log(hi)));
  return validateSynapticPreset({
    rate: snap(logBetween(p.rate), p.rate),
    facil: snap(rng.between(0, 1.4), p.facil),
    deplete: snap(rng.between(0.02, 0.88), p.deplete),
    inhibition: snap(rng.between(0, 1), p.inhibition),
    decay: snap(logBetween(p.decay, 0.3, 6), p.decay),
    autoPulse: rng.unit() < 0.85,
    seedNode: rng.integer(0, SYNAPTIC_NODE_COUNT - 1),
  });
}
