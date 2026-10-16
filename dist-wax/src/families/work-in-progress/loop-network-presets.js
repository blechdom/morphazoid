import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { clampNumber, roundTo } from "./preset-settle.js";

export const LOOP_SLOTS = 8;
export const MAX_PRESET_ROUTES = 24;
const LOOP_RANGES = Object.freeze({ level: [0, 1], pan: [-0.85, 0.85] });

/** Per-kind parameter and route-field specs: [key, low, high, fallback]. */
export const LOOP_NETWORK_KINDS = Object.freeze({
  tape: Object.freeze({
    params: Object.freeze([["speed", 0.25, 2, 1], ["splice", 0, 1, 1], ["departure", 0.02, 0.98, 0.72], ["landing", 0, 0.95, 0.08]]),
    route: Object.freeze([["departure", 0.02, 0.98, 0.72], ["landing", 0, 0.95, 0.08], ["fade", 0.005, 0.15, 0.025]]),
  }),
  soup: Object.freeze({
    params: Object.freeze([["retention", 0, 1, 0.87], ["feed", 0, 0.9, 0.38], ["spill", 0, 0.7, 0.18]]),
    route: Object.freeze([["gain", 0, 1, 1], ["tone", 0, 1, 0.8]]),
  }),
});
const spec = kind => {
  const found = LOOP_NETWORK_KINDS[kind];
  if (!found) throw new TypeError(`Unknown loop network kind: ${kind}`);
  return found;
};

export const defaultLoopSlot = slot => ({ level: 0.8, pan: slot === 0 ? -0.3 : slot === 1 ? 0.3 : 0, muted: false, solo: false });

function sanitizeLoop(raw, slot) {
  const base = defaultLoopSlot(slot);
  return {
    level: clampNumber(raw?.level, ...LOOP_RANGES.level, base.level),
    pan: clampNumber(raw?.pan, ...LOOP_RANGES.pan, base.pan),
    muted: raw?.muted === true,
    solo: raw?.solo === true,
  };
}

function sanitizeRoute(kind, raw) {
  const route = { from: Number(raw?.from), to: Number(raw?.to), enabled: raw?.enabled !== false };
  for (const [key, low, high, fallback] of spec(kind).route) route[key] = clampNumber(raw?.[key], low, high, fallback);
  return route;
}

const validSlot = value => Number.isInteger(value) && value >= 0 && value < LOOP_SLOTS;

export function captureLoopNetworkPreset(kind, raw) {
  const { params: paramSpec } = spec(kind);
  const params = {};
  for (const [key, low, high, fallback] of paramSpec) params[key] = clampNumber(raw?.params?.[key], low, high, fallback);
  if (kind === "tape") params.splice = params.splice >= 0.5 ? 1 : 0;
  const loops = Array.from({ length: LOOP_SLOTS }, (_, slot) => sanitizeLoop(raw?.loops?.[slot], slot));
  const seen = new Set();
  const routes = [];
  for (const candidate of Array.isArray(raw?.routes) ? raw.routes : []) {
    const route = sanitizeRoute(kind, candidate);
    const key = `${route.from}>${route.to}`;
    if (!validSlot(route.from) || !validSlot(route.to) || route.from === route.to || seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
  }
  routes.sort((a, b) => a.from - b.from || a.to - b.to);
  return { params, loops, routes: routes.slice(0, MAX_PRESET_ROUTES) };
}

export function validateLoopNetworkPreset(kind, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.loops) || snapshot.loops.length !== LOOP_SLOTS || !Array.isArray(snapshot.routes)
    || presetStateKey(snapshot) !== presetStateKey(captureLoopNetworkPreset(kind, snapshot))) {
    throw new TypeError(`Invalid complete ${kind === "tape" ? "Tape Worm" : "Loop Soup"} preset`);
  }
  return snapshot;
}

/** Live engine state to the raw shape: routes address loops by slot, not by id. */
export function liveLoopNetworkState(state, params) {
  const loops = Array.isArray(state?.loops) ? state.loops : [];
  const slotOf = id => loops.findIndex(loop => loop.id === id);
  return {
    params,
    loops,
    routes: (Array.isArray(state?.routes) ? state.routes : []).map(route => ({ ...route, from: slotOf(route.from), to: slotOf(route.to) })),
  };
}

/** Slots beyond the live loop count keep the last recalled values so recall round-trips. */
export function captureWithDormantSlots(kind, live, held) {
  const count = live.loops.length;
  const loops = Array.from({ length: LOOP_SLOTS }, (_, slot) => (slot < count ? live.loops[slot] : held?.loops?.[slot]));
  const dormant = (held?.routes ?? []).filter(route => route.from >= count || route.to >= count);
  return captureLoopNetworkPreset(kind, { params: live.params, loops, routes: [...live.routes, ...dormant] });
}

/** Engine commands that recall a snapshot onto the existing loops without touching audio. */
export function planLoopNetworkRecall(kind, snapshot, state) {
  validateLoopNetworkPreset(kind, snapshot);
  const loops = state.loops, count = loops.length;
  const commands = [{ type: "params", values: { ...snapshot.params } }];
  for (let slot = 0; slot < count; slot++) {
    const { level, pan, muted, solo } = snapshot.loops[slot];
    commands.push({ type: "loop", loopId: loops[slot].id, values: { level, pan, muted, solo } });
  }
  for (const route of state.routes) commands.push({ type: "disconnect", routeId: route.id });
  for (const { from, to, ...values } of snapshot.routes) {
    if (from < count && to < count) commands.push({ type: "connect", from: loops[from].id, to: loops[to].id, values });
  }
  return commands;
}

const ringOrder = (rng, count) => {
  const order = Array.from({ length: count }, (_, slot) => slot);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.integer(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

const RANDOM_PARAMS = Object.freeze({
  tape: rng => ({
    speed: roundTo(0.45 * 4 ** rng.unit()), splice: rng.unit() < 0.85 ? 1 : 0,
    departure: roundTo(rng.between(0.15, 0.9)), landing: roundTo(rng.between(0.02, 0.6)),
  }),
  soup: rng => ({ retention: roundTo(rng.between(0.35, 1)), feed: roundTo(rng.between(0.05, 0.8)), spill: roundTo(rng.between(0, 0.6)) }),
});
const RANDOM_ROUTE = Object.freeze({
  tape: rng => ({
    departure: roundTo(rng.between(0.1, 0.92)), landing: roundTo(rng.between(0, 0.7)), fade: roundTo(rng.between(0.01, 0.12), 3),
    enabled: rng.unit() < 0.92,
  }),
  soup: rng => ({ gain: roundTo(rng.between(0.2, 1)), tone: roundTo(rng.between(0.15, 1)), enabled: rng.unit() < 0.92 }),
});

export function randomizeLoopNetworkPreset(kind, current, random = Math.random, { loopCount = 3 } = {}) {
  validateLoopNetworkPreset(kind, current);
  const rng = presetRandom(random);
  const live = Math.max(2, Math.min(LOOP_SLOTS, Math.round(loopCount)));
  const loops = Array.from({ length: LOOP_SLOTS }, () => ({
    level: roundTo(rng.between(0.4, 1)), pan: roundTo(rng.between(-0.75, 0.75)), muted: rng.unit() < 0.12, solo: false,
  }));
  const audible = rng.integer(0, live - 1);
  loops[audible].muted = false;
  if (rng.unit() < 0.1) loops[audible].solo = true;
  const order = ringOrder(rng, live);
  const edges = order.map((slot, index) => [slot, order[(index + 1) % live]]);
  for (let extra = rng.integer(0, live); extra > 0; extra--) {
    const from = rng.integer(0, live - 1), to = rng.integer(0, live - 1);
    if (from !== to && !edges.some(edge => edge[0] === from && edge[1] === to)) edges.push([from, to]);
  }
  const routes = edges.slice(0, MAX_PRESET_ROUTES).map(([from, to]) => ({ from, to, ...RANDOM_ROUTE[kind](rng) }));
  routes[rng.integer(0, routes.length - 1)].enabled = true;
  return validateLoopNetworkPreset(kind, captureLoopNetworkPreset(kind, { params: RANDOM_PARAMS[kind](rng), loops, routes }));
}

/** Preset authoring helper: loops/routes given sparsely, filled to a complete snapshot. */
export function loopNetworkScene(kind, id, label, { params = {}, loops = [], routes = [] } = {}) {
  const defaults = Object.fromEntries(spec(kind).params.map(([key, , , fallback]) => [key, fallback]));
  const snapshot = captureLoopNetworkPreset(kind, {
    params: { ...defaults, ...params },
    loops: Array.from({ length: LOOP_SLOTS }, (_, slot) => ({ ...defaultLoopSlot(slot), ...loops[slot] })),
    routes,
  });
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
}

export const ringRoutes = (slots, values = {}) => slots.map((slot, index) => ({ from: slot, to: slots[(index + 1) % slots.length], ...values }));
