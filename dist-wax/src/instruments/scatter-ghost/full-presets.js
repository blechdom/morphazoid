import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { MAX_SCATTERERS, createScatterers } from "./scatter-ghost.js";

export const SCATTER_GHOST_MIN_SCATTERERS = 2;
const RANGES = Object.freeze({ size: [1, 18], wet: [0, 1], strength: [0.45, 1], scatterer: [0.03, 0.97], marker: [-0.5, 1.5] });
const DEFAULTS = Object.freeze({ size: 6, wet: 1, source: { x: 0.22, y: 0.5 }, focus: { x: 0.78, y: 0.5 } });

const clamp = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const point = (raw, fallback, range) => ({ x: clamp(raw?.x, ...range, fallback.x), y: clamp(raw?.y, ...range, fallback.y) });

export function captureScatterGhostPreset(raw) {
  const list = Array.isArray(raw?.scatterers) ? raw.scatterers.slice(0, MAX_SCATTERERS) : [];
  return {
    size: clamp(raw?.size, ...RANGES.size, DEFAULTS.size),
    wet: clamp(raw?.wet, ...RANGES.wet, DEFAULTS.wet),
    source: point(raw?.source, DEFAULTS.source, RANGES.marker),
    focus: point(raw?.focus, DEFAULTS.focus, RANGES.marker),
    scatterers: list.map(item => ({
      x: clamp(item?.x, ...RANGES.scatterer, 0.5), y: clamp(item?.y, ...RANGES.scatterer, 0.5),
      strength: clamp(item?.strength, ...RANGES.strength, 0.7),
    })),
  };
}

export function validateScatterGhostPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.scatterers) || snapshot.scatterers.length < SCATTER_GHOST_MIN_SCATTERERS
    || snapshot.scatterers.length > MAX_SCATTERERS
    || presetStateKey(snapshot) !== presetStateKey(captureScatterGhostPreset(snapshot))) {
    throw new TypeError("Invalid complete Scatter Ghost preset");
  }
  return snapshot;
}

const seeded = (count, seed) => createScatterers(count, seed).map(({ x, y, strength }) => ({ x: round(x), y: round(y), strength: round(strength) }));
const ring = (count, radius, strength = 0.9, center = { x: 0.5, y: 0.5 }) => Array.from({ length: count }, (_, index) => ({
  x: round(center.x + radius * Math.cos(Math.PI * 2 * index / count)), y: round(center.y + radius * Math.sin(Math.PI * 2 * index / count)), strength,
}));
const column = (x, count, strength = 0.8) => Array.from({ length: count }, (_, index) => ({ x, y: round(0.12 + 0.76 * index / (count - 1)), strength }));
const grid = (side, strength = 0.75) => Array.from({ length: side * side }, (_, index) => ({
  x: round(0.14 + 0.72 * (index % side) / (side - 1)), y: round(0.14 + 0.72 * Math.floor(index / side) / (side - 1)), strength,
}));

const scene = (id, label, { scatterers, ...values }) => Object.freeze({
  id, label, snapshot: Object.freeze(captureScatterGhostPreset({ ...DEFAULTS, ...values, scatterers })),
});

export const SCATTER_GHOST_FULL_PRESETS = Object.freeze([
  scene("default-chamber", "Default chamber", { scatterers: seeded(18, 5) }),
  scene("sparse-hall", "Sparse hall", { scatterers: seeded(6, 3), size: 12 }),
  scene("dense-forest", "Dense forest", { scatterers: seeded(40, 17), size: 4 }),
  scene("small-tin", "Small tin", { scatterers: seeded(12, 9), size: 1.5, wet: 0.8 }),
  scene("cathedral-smear", "Cathedral smear", { scatterers: seeded(28, 21), size: 17 }),
  scene("light-haze", "Light haze", { scatterers: seeded(14, 31), size: 7, wet: 0.35 }),
  scene("corner-to-corner", "Corner to corner", { scatterers: seeded(20, 41), source: { x: 0.08, y: 0.08 }, focus: { x: 0.92, y: 0.92 } }),
  scene("close-focus", "Close focus", { scatterers: seeded(16, 7), source: { x: 0.45, y: 0.5 }, focus: { x: 0.55, y: 0.5 }, size: 5 }),
  scene("vertical-stage", "Vertical stage", { scatterers: seeded(22, 13), source: { x: 0.5, y: 0.1 }, focus: { x: 0.5, y: 0.9 }, size: 9 }),
  scene("pillar-ring", "Pillar ring", { scatterers: ring(16, 0.3), source: { x: 0.5, y: 0.5 }, focus: { x: 0.5, y: 0.12 }, size: 8 }),
  scene("two-walls", "Two walls", { scatterers: [...column(0.2, 8), ...column(0.8, 8, 0.95)], size: 10 }),
  scene("grid-garden", "Grid garden", { scatterers: grid(5), size: 6.5, wet: 0.9 }),
  scene("quiet-medium", "Quiet medium", { scatterers: seeded(3, 11), size: 8, wet: 0.6 }),
  scene("tight-circle", "Tight circle", { scatterers: ring(10, 0.15, 1, { x: 0.78, y: 0.5 }), size: 3, source: { x: 0.22, y: 0.5 } }),
]);

export function randomizeScatterGhostPreset(current, random = Math.random) {
  validateScatterGhostPreset(current);
  const rng = presetRandom(random);
  const count = rng.integer(4, 36);
  const clustered = rng.unit() < 0.35;
  const hub = { x: rng.between(0.25, 0.75), y: rng.between(0.25, 0.75) };
  const scatterers = Array.from({ length: count }, () => ({
    x: round(clustered ? Math.min(0.95, Math.max(0.05, hub.x + rng.between(-0.22, 0.22))) : rng.between(0.06, 0.94)),
    y: round(clustered ? Math.min(0.95, Math.max(0.05, hub.y + rng.between(-0.22, 0.22))) : rng.between(0.06, 0.94)),
    strength: round(rng.between(0.45, 1)),
  }));
  const source = { x: round(rng.between(0.06, 0.94)), y: round(rng.between(0.06, 0.94)) };
  let focus = { x: round(rng.between(0.06, 0.94)), y: round(rng.between(0.06, 0.94)) };
  if (Math.hypot(source.x - focus.x, source.y - focus.y) < 0.28) {
    focus = { x: round(1 - source.x), y: round(1 - source.y) };
    if (Math.hypot(source.x - focus.x, source.y - focus.y) < 0.28) focus = { x: round(source.x < 0.5 ? source.x + 0.34 : source.x - 0.34), y: source.y };
  }
  return validateScatterGhostPreset({
    size: round(1.5 * 11 ** rng.unit(), 1), wet: round(rng.between(0.3, 1), 2), source, focus, scatterers,
  });
}
