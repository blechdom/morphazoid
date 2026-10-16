import { presetRandom } from "../../site/preset-random.js";

export const NIGHTINGALE_WALK_RULES = Object.freeze(["chronology", "similarity", "hybrid", "manual"]);
export const NIGHTINGALE_LISTEN_MODES = Object.freeze(["recording", "physical"]);
export const NIGHTINGALE_PRESET_KEYS = Object.freeze([
  "walkRule", "routeLength", "surprise", "listenMode", "loopRoute",
  "showSimilarity", "showSequence", "showTrajectories", "autoRotate",
]);
const BOOLEANS = ["loopRoute", "showSimilarity", "showSequence", "showTrajectories", "autoRotate"];

export function captureNightingalePreset(source) {
  return Object.fromEntries(NIGHTINGALE_PRESET_KEYS.map(key => [key, source[key]]));
}

export function validateNightingalePreset(snapshot) {
  const ok = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length === NIGHTINGALE_PRESET_KEYS.length
    && NIGHTINGALE_WALK_RULES.includes(snapshot.walkRule)
    && NIGHTINGALE_LISTEN_MODES.includes(snapshot.listenMode)
    && Number.isInteger(snapshot.routeLength) && snapshot.routeLength >= 2 && snapshot.routeLength <= 16
    && Number.isFinite(snapshot.surprise) && snapshot.surprise >= 0 && snapshot.surprise <= 1
    && Math.round(snapshot.surprise * 100) / 100 === snapshot.surprise
    && BOOLEANS.every(key => typeof snapshot[key] === "boolean");
  if (!ok) throw new TypeError("Invalid complete Nightingale Manifold preset");
  return snapshot;
}

const scene = (id, label, walkRule, routeLength, surprise, listenMode, loopRoute, showSimilarity, showSequence, showTrajectories, autoRotate) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateNightingalePreset({ walkRule, routeLength, surprise, listenMode, loopRoute, showSimilarity, showSequence, showTrajectories, autoRotate })) });

export const NIGHTINGALE_FULL_PRESETS = Object.freeze([
  scene("hybrid-stroll", "Hybrid stroll", "hybrid", 8, 0.35, "physical", false, true, true, true, false),
  scene("observed-order", "Observed order", "chronology", 12, 0, "recording", false, false, true, false, false),
  scene("nearest-kin", "Nearest kin", "similarity", 8, 0.05, "recording", false, true, false, false, false),
  scene("restless-leaps", "Restless leaps", "similarity", 14, 0.9, "recording", true, true, false, true, true),
  scene("physical-tour", "Physical-model tour", "hybrid", 10, 0.4, "physical", false, true, true, true, true),
  scene("syrinx-loop", "Syrinx loop", "chronology", 4, 0.1, "physical", true, false, true, false, false),
  scene("wide-wander", "Wide wander", "hybrid", 16, 0.65, "recording", false, true, true, false, true),
  scene("short-motif", "Short motif", "similarity", 3, 0.2, "recording", true, false, false, true, false),
  scene("chaos-synth", "Chaos synthesis", "hybrid", 12, 1, "physical", false, true, false, true, true),
  scene("slow-chronicle", "Slow chronicle", "chronology", 16, 0.02, "physical", false, false, true, true, false),
  scene("echo-pair", "Echo pair", "similarity", 2, 0.15, "physical", true, true, true, false, false),
  scene("trajectory-study", "Trajectory study", "hybrid", 6, 0.5, "recording", true, false, false, true, true),
]);

export function randomizeNightingalePreset(current, random = Math.random) {
  validateNightingalePreset(current);
  const rng = presetRandom(random);
  return validateNightingalePreset({
    walkRule: rng.pick(["chronology", "similarity", "hybrid"]),
    routeLength: rng.integer(2, 16),
    surprise: Math.round(rng.between(0, 1) * 100) / 100,
    listenMode: rng.pick(NIGHTINGALE_LISTEN_MODES),
    loopRoute: rng.unit() < 0.5,
    showSimilarity: rng.unit() < 0.7,
    showSequence: rng.unit() < 0.7,
    showTrajectories: rng.unit() < 0.7,
    autoRotate: rng.unit() < 0.5,
  });
}
