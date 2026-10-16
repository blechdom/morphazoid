import { presetRandom } from "../../site/preset-random.js";

export const BIRDSONG_PARAMS = Object.freeze({
  pitchShiftSemitones: { min: -12, max: 12, step: 1, control: "pitchShift" },
  drive: { min: 0.4, max: 1.6, step: 0.01, control: "drive" },
  roughness: { min: 0, max: 0.45, step: 0.01, control: "roughness" },
  resonanceHz: { min: 600, max: 7500, step: 50, control: "resonance" },
  resonanceQ: { min: 0.5, max: 12, step: 0.1, control: "resonanceQ" },
  resonanceMix: { min: 0, max: 0.85, step: 0.01, control: "resonanceMix" },
});
export const BIRDSONG_PRESET_KEYS = Object.freeze(Object.keys(BIRDSONG_PARAMS));

const snap = (value, { min, max, step }) => {
  const digits = (String(step).split(".")[1] ?? "").length;
  return Number((Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min).toFixed(digits));
};

export function captureBirdsongPreset(source) {
  return Object.fromEntries(BIRDSONG_PRESET_KEYS.map(key => [key, source[key]]));
}

export function validateBirdsongPreset(snapshot) {
  const ok = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length === BIRDSONG_PRESET_KEYS.length
    && BIRDSONG_PRESET_KEYS.every(key => {
      const spec = BIRDSONG_PARAMS[key];
      return Number.isFinite(snapshot[key]) && snapshot[key] >= spec.min && snapshot[key] <= spec.max && snap(snapshot[key], spec) === snapshot[key];
    });
  if (!ok) throw new TypeError("Invalid complete Birdsong Lab preset");
  return snapshot;
}

const scene = (id, label, pitchShiftSemitones, drive, roughness, resonanceHz, resonanceQ, resonanceMix) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateBirdsongPreset({ pitchShiftSemitones, drive, roughness, resonanceHz, resonanceQ, resonanceMix })) });

export const BIRDSONG_FULL_PRESETS = Object.freeze([
  scene("reference", "Reference syrinx", 0, 1, 0.04, 3800, 4.5, 0.42),
  scene("low-thrush", "Low thrush", -7, 0.9, 0.06, 2200, 3.2, 0.5),
  scene("glass-whistle", "Glass whistle", 5, 0.7, 0.01, 5600, 8.5, 0.6),
  scene("hoarse-crow", "Hoarse crow", -12, 1.5, 0.32, 1400, 2, 0.35),
  scene("hollow-reed", "Hollow reed", -3, 0.8, 0.02, 1100, 10.5, 0.8),
  scene("bright-finch", "Bright finch", 7, 1.1, 0.05, 6800, 5.5, 0.38),
  scene("rough-warbler", "Rough warbler", 2, 1.35, 0.2, 3200, 3, 0.3),
  scene("tube-nightingale", "Tube nightingale", -2, 1, 0.08, 2900, 7.5, 0.72),
  scene("tiny-piccolo", "Tiny piccolo", 12, 0.6, 0.0, 7200, 6, 0.5),
  scene("breathy-owl", "Breathy owl", -9, 0.55, 0.4, 900, 1.2, 0.55),
  scene("driven-alarm", "Driven alarm", 4, 1.6, 0.28, 4400, 9, 0.45),
  scene("soft-dove", "Soft dove", -5, 0.5, 0.03, 1700, 1.8, 0.65),
]);

export function randomizeBirdsongPreset(current, random = Math.random) {
  validateBirdsongPreset(current);
  const rng = presetRandom(random);
  const next = {};
  for (const [key, spec] of Object.entries(BIRDSONG_PARAMS)) {
    const logSpan = key === "resonanceHz" || key === "resonanceQ";
    const value = logSpan
      ? Math.exp(rng.between(Math.log(spec.min * (key === "resonanceHz" ? 1.5 : 1.2)), Math.log(spec.max * 0.95)))
      : rng.between(spec.min, spec.max);
    next[key] = snap(value, spec);
  }
  next.roughness = snap(Math.min(next.roughness, rng.between(0.08, 0.42)), BIRDSONG_PARAMS.roughness);
  return validateBirdsongPreset(next);
}
