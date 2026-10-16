import { TRICKS, settings, setTrick } from "./yoyodyne.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const YOYODYNE_PRESET_KEYS = Object.freeze(["tempo", "length", "energy", "friction", "gravity", "elasticity", "tone", "root"]);
const TRICK_IDS = TRICKS.map(trick => trick.id);

export function captureYoyodynePreset(world) {
  const s = settings(world.settings);
  return { trick: TRICK_IDS.includes(world.trick) ? world.trick : TRICK_IDS[0], ...Object.fromEntries(YOYODYNE_PRESET_KEYS.map(key => [key, s[key]])) };
}

export function validateYoyodynePreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !TRICK_IDS.includes(snapshot.trick)
    || presetStateKey(snapshot) !== presetStateKey(captureYoyodynePreset({ trick: snapshot.trick, settings: snapshot }))) {
    throw new TypeError("Invalid complete Yoyodyne preset");
  }
  return snapshot;
}

export function applyYoyodynePreset(world, snapshot) {
  validateYoyodynePreset(snapshot);
  const { trick, ...values } = snapshot;
  world.settings = settings({ ...values, level: world.settings.level });
  setTrick(world, trick);
}

const scene = (id, label, trick, values) => {
  const snapshot = captureYoyodynePreset({ trick, settings: values });
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const YOYODYNE_FULL_PRESETS = Object.freeze([
  scene("factory-sleeper", "Factory sleeper", "sleeper", { tempo: 90, length: 0.86, energy: 0.6, friction: 0.24, gravity: 1, elasticity: 0.3, tone: 0.28, root: 50 }),
  scene("deep-sleeper", "Deep sleeper", "sleeper", { tempo: 58, length: 1.15, energy: 0.9, friction: 0.08, gravity: 0.9, elasticity: 0.2, tone: 0.18, root: 40 }),
  scene("glass-spinner", "Glass spinner", "sleeper", { tempo: 110, length: 0.5, energy: 0.75, friction: 0.12, gravity: 1, elasticity: 0.1, tone: 0.85, root: 69 }),
  scene("cradle-rocker", "Cradle rocker", "cradle", { tempo: 72, length: 0.95, energy: 0.55, friction: 0.3, gravity: 1, elasticity: 0.35, tone: 0.4, root: 47 }),
  scene("cradle-bright", "Bright cradle", "cradle", { tempo: 124, length: 0.7, energy: 0.65, friction: 0.18, gravity: 1.2, elasticity: 0.15, tone: 0.7, root: 62 }),
  scene("orbit-sweep", "Orbit sweep", "around-world", { tempo: 96, length: 1.0, energy: 0.8, friction: 0.2, gravity: 0.8, elasticity: 0.3, tone: 0.5, root: 52 }),
  scene("fast-orbit", "Fast orbit", "around-world", { tempo: 150, length: 0.6, energy: 1, friction: 0.35, gravity: 1.1, elasticity: 0.2, tone: 0.62, root: 57 }),
  scene("moon-orbit", "Moon orbit", "around-world", { tempo: 66, length: 1.18, energy: 0.7, friction: 0.1, gravity: 0.25, elasticity: 0.45, tone: 0.3, root: 43 }),
  scene("gravity-drop", "Gravity drop", "gravity-pull", { tempo: 84, length: 0.8, energy: 0.5, friction: 0.28, gravity: 1.6, elasticity: 0.25, tone: 0.35, root: 48 }),
  scene("rubber-string", "Rubber string", "gravity-pull", { tempo: 100, length: 0.9, energy: 0.65, friction: 0.4, gravity: 1, elasticity: 0.95, tone: 0.22, root: 55 }),
  scene("steel-wire", "Steel wire", "sleeper", { tempo: 130, length: 0.4, energy: 0.95, friction: 0.05, gravity: 1.3, elasticity: 0, tone: 0.95, root: 72 }),
  scene("slow-heavy", "Slow heavy", "cradle", { tempo: 48, length: 1.2, energy: 0.35, friction: 0.7, gravity: 1.8, elasticity: 0.5, tone: 0.08, root: 38 }),
]);

const round = value => Math.round(value * 100) / 100;

export function randomizeYoyodynePreset(current, random = Math.random) {
  validateYoyodynePreset(current);
  const rng = presetRandom(random);
  const values = {
    tempo: rng.integer(50, 170), length: round(rng.between(0.38, 1.18)), energy: round(rng.between(0.15, 1)),
    friction: round(rng.between(0, 0.8)), gravity: round(rng.between(0.1, 1.75)), elasticity: round(rng.between(0, 1)),
    tone: round(rng.between(0, 1)), root: rng.integer(38, 74),
  };
  return validateYoyodynePreset(captureYoyodynePreset({ trick: rng.pick(TRICK_IDS), settings: values }));
}
