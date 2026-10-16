import { PATH_FAMILIES, PATH_LIMITS, pathFamilyFor, sanitizePathSettings } from "./paths.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const FAMILY_IDS = PATH_FAMILIES.map(({ id }) => id);
export const PATH_CHOICES = Object.freeze({
  family: FAMILY_IDS, mode: ["draw", "trace"], cycleBehavior: ["hold", "loop", "evolve"],
  voiceEngine: ["sine", "fm", "pm", "shepard"], pitchSource: ["direction", "height", "curvature", "hierarchy"],
});
export const PATH_NUMBER_SPECS = Object.freeze({
  detail: [1, 7, 1], aspect: [PATH_LIMITS.aspectMin, PATH_LIMITS.aspectMax, 0.01], seed: [1, 99999, 1], speed: [0.005, 0.4, 0.001],
  rootFrequency: [32, 220, 0.1], pitchRange: [0, 48, 1], turnTone: [0, 1, 0.01], headCount: [1, 5, 1],
});
export const PATH_PRESET_KEYS = Object.freeze([...Object.keys(PATH_CHOICES), ...Object.keys(PATH_NUMBER_SPECS), "direction"]);

const snap = (key, value) => {
  const [min, max, step] = PATH_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};

export function capturePathPreset(state) {
  return Object.fromEntries(PATH_PRESET_KEYS.map(key => [key, state[key]]));
}

export function validatePathPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Paths preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== PATH_PRESET_KEYS.length) bad();
  for (const [key, values] of Object.entries(PATH_CHOICES)) if (!values.includes(snapshot[key])) bad();
  for (const [key, [min, max]] of Object.entries(PATH_NUMBER_SPECS)) {
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  for (const key of ["detail", "seed", "headCount"]) if (!Number.isInteger(snapshot[key])) bad();
  const family = pathFamilyFor(snapshot.family);
  if (snapshot.detail < family.minDetail || snapshot.detail > family.maxDetail) bad();
  if (snapshot.direction !== 1 && snapshot.direction !== -1) bad();
  return snapshot;
}

const DEFAULTS = Object.freeze({
  family: "gilbert", mode: "draw", cycleBehavior: "hold", voiceEngine: "fm", pitchSource: "direction", detail: 4, aspect: 1,
  seed: 27183, speed: 0.055, rootFrequency: 65.4, pitchRange: 30, turnTone: 0.55, headCount: 1, direction: 1,
});

const scene = (id, label, patch = {}) => {
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = Object.fromEntries(PATH_PRESET_KEYS.map(key => [key, PATH_NUMBER_SPECS[key] ? snap(key, merged[key]) : merged[key]]));
  validatePathPreset(snapshot);
  const settings = sanitizePathSettings(snapshot);
  if (settings.detail !== snapshot.detail) throw new Error(`Preset ${id} detail is not representable`);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const PATH_FULL_PRESETS = Object.freeze([
  scene("gilbert-ribbon", "Gilbert ribbon"),
  scene("hilbert-scan", "Hilbert scan", { family: "hilbert", detail: 5, mode: "trace", pitchSource: "height", speed: 0.04, rootFrequency: 82.5, pitchRange: 36, headCount: 2, voiceEngine: "sine", turnTone: 0.2 }),
  scene("gosper-flow", "Gosper flow", { family: "gosper", detail: 3, aspect: 1.2, pitchSource: "curvature", voiceEngine: "pm", turnTone: 0.8, speed: 0.07, rootFrequency: 110, pitchRange: 24, cycleBehavior: "loop" }),
  scene("dragon-fold", "Dragon fold", { family: "dragon", detail: 7, pitchSource: "hierarchy", voiceEngine: "shepard", speed: 0.03, rootFrequency: 48, pitchRange: 40, turnTone: 0.7, headCount: 3 }),
  scene("walk-wanderer", "Walk wanderer", { family: "walk", detail: 5, seed: 4242, mode: "trace", voiceEngine: "fm", pitchSource: "curvature", speed: 0.1, headCount: 4, turnTone: 0.9, rootFrequency: 90 }),
  scene("wide-gilbert-chorus", "Wide Gilbert chorus", { family: "gilbert", detail: 6, aspect: 2.2, headCount: 5, speed: 0.05, voiceEngine: "pm", pitchSource: "hierarchy", rootFrequency: 73.4, pitchRange: 28, turnTone: 0.4 }),
  scene("tall-gilbert-bass", "Tall Gilbert bass", { family: "gilbert", detail: 5, aspect: 0.6, pitchSource: "height", rootFrequency: 36, pitchRange: 18, voiceEngine: "sine", turnTone: 0.15, speed: 0.025, direction: -1 }),
  scene("hilbert-bells", "Hilbert bells", { family: "hilbert", detail: 3, speed: 0.16, voiceEngine: "pm", pitchSource: "direction", rootFrequency: 196, pitchRange: 24, turnTone: 0.95, headCount: 1, cycleBehavior: "loop" }),
  scene("seeded-garden", "Seeded garden", { family: "walk", detail: 6, seed: 88001, cycleBehavior: "evolve", speed: 0.12, voiceEngine: "shepard", pitchSource: "height", headCount: 2, rootFrequency: 65.4, pitchRange: 34, turnTone: 0.5 }),
  scene("reverse-dragon", "Reverse dragon", { family: "dragon", detail: 5, direction: -1, mode: "trace", speed: 0.2, voiceEngine: "fm", pitchSource: "direction", rootFrequency: 130, pitchRange: 44, turnTone: 0.6, headCount: 2 }),
  scene("coarse-gosper-drone", "Coarse Gosper drone", { family: "gosper", detail: 1, aspect: 0.8, speed: 0.01, voiceEngine: "shepard", pitchSource: "hierarchy", rootFrequency: 40, pitchRange: 12, turnTone: 0.3, headCount: 5 }),
  scene("dense-hilbert-shimmer", "Dense Hilbert shimmer", { family: "hilbert", detail: 6, speed: 0.3, voiceEngine: "sine", pitchSource: "curvature", rootFrequency: 160, pitchRange: 46, turnTone: 0.05, headCount: 3 }),
  scene("fm-walk-bounce", "FM walk bounce", { family: "walk", detail: 3, seed: 1313, speed: 0.22, voiceEngine: "fm", pitchSource: "direction", rootFrequency: 100, pitchRange: 6, turnTone: 1, headCount: 1, cycleBehavior: "loop", mode: "trace" }),
]);

export function randomizePathPreset(current, random = Math.random) {
  validatePathPreset(current);
  const rng = presetRandom(random);
  const family = rng.pick(FAMILY_IDS), definition = pathFamilyFor(family);
  return validatePathPreset({
    family, mode: rng.pick(PATH_CHOICES.mode), cycleBehavior: rng.pick(PATH_CHOICES.cycleBehavior),
    voiceEngine: rng.pick(PATH_CHOICES.voiceEngine), pitchSource: rng.pick(PATH_CHOICES.pitchSource),
    detail: rng.integer(definition.minDetail, definition.maxDetail), aspect: snap("aspect", rng.between(0.6, 2.3)),
    seed: rng.integer(1, 99999), speed: snap("speed", 0.01 * 25 ** rng.unit()),
    rootFrequency: snap("rootFrequency", 34 * 6 ** rng.unit()), pitchRange: snap("pitchRange", rng.between(4, 46)),
    turnTone: snap("turnTone", rng.unit()), headCount: rng.integer(1, 5), direction: rng.unit() < 0.3 ? -1 : 1,
  });
}
