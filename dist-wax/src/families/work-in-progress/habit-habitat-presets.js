import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { HABIT_DEFAULTS } from "./habit-habitat.js";
import { clampNumber, roundTo } from "./preset-settle.js";

export const HABIT_PRESET_PARAMS = Object.freeze(["tempo", "follow", "learning", "decay"]);
const RANGES = Object.freeze({ tempo: [35, 240], follow: [0, 1], learning: [0.05, 1], decay: [0.04, 0.8] });
export const HABIT_NODES = 6;
export const HABIT_WEIGHT_RANGE = Object.freeze([0.25, 12]);
const BASE = HABIT_WEIGHT_RANGE[0];

export function captureHabitPreset(raw) {
  const snapshot = {};
  for (const key of HABIT_PRESET_PARAMS) snapshot[key] = clampNumber(raw?.[key], ...RANGES[key], HABIT_DEFAULTS[key]);
  const rows = Array.isArray(raw?.weights) ? raw.weights : [];
  snapshot.weights = Array.from({ length: HABIT_NODES }, (_, from) => Array.from({ length: HABIT_NODES }, (_, to) => (
    from === to ? 0 : clampNumber(rows[from]?.[to], ...HABIT_WEIGHT_RANGE, BASE)
  )));
  return snapshot;
}

export function validateHabitPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.weights) || snapshot.weights.length !== HABIT_NODES
    || presetStateKey(snapshot) !== presetStateKey(captureHabitPreset(snapshot))) {
    throw new TypeError("Invalid complete Habit Habitat preset");
  }
  return snapshot;
}

const routes = (edges, base = BASE) => {
  const weights = Array.from({ length: HABIT_NODES }, (_, from) => Array.from({ length: HABIT_NODES }, (_, to) => (from === to ? 0 : base)));
  for (const [from, to, weight = 6] of edges) weights[from][to] = weight;
  return weights;
};
const cycle = (order, weight = 6) => order.map((node, index) => [node, order[(index + 1) % order.length], weight]);

const scene = (id, label, values, weights) => Object.freeze({
  id, label, snapshot: Object.freeze(captureHabitPreset({ ...HABIT_DEFAULTS, ...values, weights })),
});

export const HABIT_FULL_PRESETS = Object.freeze([
  scene("remember-the-route", "Remember the route", {}, routes(cycle([0, 2, 5, 1, 4, 3]))),
  scene("wander", "Wander", { tempo: 90, follow: 0.1, learning: 0.3, decay: 0.48 }, routes([])),
  scene("strong-habits", "Strong habits", { tempo: 155, follow: 1, learning: 0.9, decay: 0.12 }, routes(cycle([0, 2, 5, 1, 4, 3], 12))),
  scene("slow-recollection", "Slow recollection", { tempo: 64, follow: 0.7, learning: 0.2, decay: 0.7 }, routes(cycle([0, 2, 5, 1, 4, 3], 4))),
  scene("two-rings", "Two rings", { tempo: 118, follow: 0.92, learning: 0.5, decay: 0.2 }, routes([...cycle([0, 1, 2], 8), ...cycle([3, 4, 5], 8), [2, 3, 1.5], [5, 0, 1.5]])),
  scene("hub-and-spokes", "Hub and spokes", { tempo: 136, follow: 0.84, learning: 0.4, decay: 0.16 },
    routes([...[1, 2, 3, 4, 5].flatMap(n => [[0, n, 5], [n, 0, 10]])])),
  scene("ping-pong", "Ping-pong", { tempo: 168, follow: 0.95, learning: 0.6, decay: 0.1 }, routes([[0, 3, 10], [3, 0, 10], [1, 4, 9], [4, 1, 9], [2, 5, 8], [5, 2, 8]])),
  scene("staircase-up", "Staircase up", { tempo: 104, follow: 0.9, learning: 0.45, decay: 0.26 }, routes(cycle([0, 1, 2, 3, 4, 5], 7))),
  scene("staircase-down", "Staircase down", { tempo: 84, follow: 0.86, learning: 0.35, decay: 0.34 }, routes(cycle([5, 4, 3, 2, 1, 0], 7))),
  scene("skipping-stones", "Skipping stones", { tempo: 144, follow: 0.78, learning: 0.55, decay: 0.14 }, routes([...cycle([0, 2, 4], 8), ...cycle([1, 3, 5], 8)])),
  scene("loose-tangle", "Loose tangle", { tempo: 98, follow: 0.5, learning: 0.7, decay: 0.3 },
    routes([[0, 4, 4], [4, 2, 3], [2, 1, 5], [1, 5, 2], [5, 3, 4], [3, 0, 3], [0, 2, 2], [3, 5, 2.5]])),
  scene("single-groove", "Single groove", { tempo: 124, follow: 1, learning: 0.25, decay: 0.2 }, routes([[0, 3, 12], [3, 0, 12], [0, 5, 0.5], [3, 1, 0.5]], 0.25)),
  scene("dense-memory", "Dense memory", { tempo: 72, follow: 0.62, learning: 0.15, decay: 0.55 },
    routes(Array.from({ length: HABIT_NODES }, (_, from) => Array.from({ length: HABIT_NODES }, (_, to) => [from, to, from === to ? 0 : 1 + (from * 3 + to * 5) % 5])).flat(), 1)),
]);

export function randomizeHabitPreset(current, random = Math.random) {
  validateHabitPreset(current);
  const rng = presetRandom(random);
  const order = Array.from({ length: HABIT_NODES }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.integer(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const ring = rng.integer(4, HABIT_NODES);
  const edges = cycle(order.slice(0, ring), 0).map(([from, to]) => [from, to, roundTo(rng.between(3, 12))]);
  for (let extra = rng.integer(1, 6); extra > 0; extra--) {
    const from = rng.integer(0, HABIT_NODES - 1), to = rng.integer(0, HABIT_NODES - 1);
    if (from !== to && !edges.some(edge => edge[0] === from && edge[1] === to)) edges.push([from, to, roundTo(rng.between(0.6, 6))]);
  }
  return validateHabitPreset({
    tempo: Math.round(rng.between(48, 190)),
    follow: roundTo(rng.between(0.2, 1)),
    learning: roundTo(rng.between(0.08, 0.95)),
    decay: roundTo(rng.between(0.07, 0.62)),
    weights: routes(edges, roundTo(rng.between(0.25, 0.9))),
  });
}
