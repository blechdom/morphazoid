import { presetRandom } from "../../site/preset-random.js";

export const AIRWAY_FAMILIES = Object.freeze({
  bird: Object.freeze(["corvid", "songbird"]),
  mammal: Object.freeze(["wolf", "lion"]),
  frog: Object.freeze(["treefrog", "bullfrog"]),
});

export const AIRWAY_PARAMS = Object.freeze({
  pressure: [0, 1, 2], tension: [0, 1, 2], adduction: [0, 1, 2], tracheaLength: [0.05, 0.8, 3],
  beakGape: [0, 1, 2], oecVolume: [0, 1, 2], junctionCoupling: [0, 1, 2], liquidLoad: [0, 1, 2],
});
export const AIRWAY_PRESET_KEYS = Object.freeze(["family", "presetId", ...Object.keys(AIRWAY_PARAMS)]);

export function captureAirwayPreset(source) {
  return Object.fromEntries(AIRWAY_PRESET_KEYS.map(key => [key, source[key]]));
}

export function validateAirwayPreset(snapshot) {
  const ok = snapshot && typeof snapshot === "object"
    && Object.keys(snapshot).length === AIRWAY_PRESET_KEYS.length
    && Object.hasOwn(AIRWAY_FAMILIES, snapshot.family)
    && AIRWAY_FAMILIES[snapshot.family].includes(snapshot.presetId)
    && Object.entries(AIRWAY_PARAMS).every(([key, [min, max]]) => Number.isFinite(snapshot[key]) && snapshot[key] >= min && snapshot[key] <= max);
  if (!ok) throw new TypeError("Invalid complete Adaptive Airway preset");
  return snapshot;
}

const scene = (id, label, family, presetId, p, tension, adduction, tracheaLength, beakGape, oecVolume, junctionCoupling, liquidLoad) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateAirwayPreset({ family, presetId, pressure: p, tension, adduction, tracheaLength, beakGape, oecVolume, junctionCoupling, liquidLoad })) });

export const AIRWAY_FULL_PRESETS = Object.freeze([
  scene("corvid", "Corvid / raven-like", "bird", "corvid", 0.68, 0.44, 0.63, 0.26, 0.52, 0.58, 0.47, 0.26),
  scene("songbird", "Small songbird", "bird", "songbird", 0.56, 0.71, 0.55, 0.15, 0.68, 0.34, 0.39, 0.18),
  scene("crane-trumpet", "Crane trumpet", "bird", "corvid", 0.78, 0.36, 0.72, 0.78, 0.4, 0.7, 0.62, 0.3),
  scene("sparrow-whistle", "Sparrow whistle", "bird", "songbird", 0.45, 0.92, 0.4, 0.07, 0.82, 0.2, 0.25, 0.08),
  scene("wolf", "Wolf / canid", "mammal", "wolf", 0.62, 0.48, 0.66, 0.29, 0.57, 0.27, 0.41, 0.29),
  scene("lion", "Lion / large felid", "mammal", "lion", 0.82, 0.24, 0.76, 0.44, 0.63, 0.4, 0.53, 0.47),
  scene("jackal-yip", "Jackal yip", "mammal", "wolf", 0.7, 0.78, 0.5, 0.17, 0.72, 0.22, 0.3, 0.14),
  scene("tiger-growl", "Tiger growl", "mammal", "lion", 0.9, 0.18, 0.84, 0.6, 0.35, 0.5, 0.7, 0.62),
  scene("treefrog", "Treefrog", "frog", "treefrog", 0.59, 0.66, 0.5, 0.09, 0.46, 0.76, 0.58, 0.33),
  scene("bullfrog", "Bullfrog", "frog", "bullfrog", 0.74, 0.38, 0.64, 0.14, 0.38, 0.86, 0.66, 0.54),
  scene("chorus-peep", "Chorus frog peep", "frog", "treefrog", 0.5, 0.88, 0.45, 0.06, 0.6, 0.55, 0.2, 0.1),
  scene("marsh-boom", "Marsh boom", "frog", "bullfrog", 0.88, 0.22, 0.8, 0.22, 0.28, 0.94, 0.78, 0.74),
]);

const TRACHEA_RANGE = { bird: [0.06, 0.78], mammal: [0.14, 0.7], frog: [0.05, 0.25] };

export function randomizeAirwayPreset(current, random = Math.random) {
  validateAirwayPreset(current);
  const rng = presetRandom(random);
  const family = rng.pick(Object.keys(AIRWAY_FAMILIES));
  const round = (value, digits) => Number(value.toFixed(digits));
  const next = { family, presetId: rng.pick(AIRWAY_FAMILIES[family]) };
  const ranges = {
    pressure: [0.3, 0.96], tension: [0.1, 0.95], adduction: [0.3, 0.9], tracheaLength: TRACHEA_RANGE[family],
    beakGape: [0.15, 0.9], oecVolume: [0.1, 0.95], junctionCoupling: [0.1, 0.85], liquidLoad: [0.04, 0.8],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) next[key] = round(rng.between(min, max), AIRWAY_PARAMS[key][2]);
  return validateAirwayPreset(next);
}


