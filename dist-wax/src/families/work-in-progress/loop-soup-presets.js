import { SOUP_PRESETS } from "./loop-soup.js";
import {
  captureLoopNetworkPreset, loopNetworkScene, randomizeLoopNetworkPreset, ringRoutes, validateLoopNetworkPreset,
} from "./loop-network-presets.js";

export const captureLoopSoupPreset = raw => captureLoopNetworkPreset("soup", raw);
export const validateLoopSoupPreset = snapshot => validateLoopNetworkPreset("soup", snapshot);
export const randomizeLoopSoupPreset = (current, random, options) => randomizeLoopNetworkPreset("soup", current, random, options);

const scene = (id, label, options) => loopNetworkScene("soup", id, label, options);
const mixParams = ({ retention, feed, spill }) => ({ retention, feed, spill });
const poolParams = mixParams(SOUP_PRESETS.A);
const deepParams = mixParams(SOUP_PRESETS.B);
const thinParams = mixParams(SOUP_PRESETS.C);
const frozenParams = mixParams(SOUP_PRESETS.D);
const ring = (values = {}) => ringRoutes([0, 1, 2], values);

export const LOOP_SOUP_FULL_PRESETS = Object.freeze([
  scene("moderate-pool", "Moderate pool", { params: poolParams, routes: ring() }),
  scene("deep-soup", "Deep soup", { params: deepParams, routes: ring({ gain: 0.9 }) }),
  scene("thin-broth", "Thin broth", { params: thinParams, routes: ring({ gain: 0.5, tone: 0.95 }) }),
  scene("frozen-pantry", "Frozen pantry", { params: frozenParams, routes: ring({ gain: 0.4 }) }),
  scene("backwash", "Backwash", { params: { retention: 0.9, feed: 0.3, spill: 0.32 }, routes: ringRoutes([2, 1, 0], { gain: 0.85, tone: 0.6 }) }),
  scene("hub-stir", "Hub stir", {
    params: { retention: 0.93, feed: 0.25, spill: 0.4 },
    routes: [{ from: 0, to: 1, gain: 0.9 }, { from: 0, to: 2, gain: 0.7, tone: 0.5 }, { from: 1, to: 0, gain: 0.4 }, { from: 2, to: 0, gain: 0.4 }],
  }),
  scene("bright-feed", "Bright feed", { params: { retention: 0.8, feed: 0.55, spill: 0.2 }, routes: ring({ gain: 0.8, tone: 1 }) }),
  scene("dark-sends", "Dark sends", { params: { retention: 0.95, feed: 0.2, spill: 0.5 }, routes: ring({ gain: 1, tone: 0.15 }) }),
  scene("cross-streams", "Cross streams", {
    params: { retention: 0.88, feed: 0.35, spill: 0.28 },
    routes: [{ from: 0, to: 1 }, { from: 1, to: 0, tone: 0.4 }, { from: 1, to: 2, gain: 0.6 }, { from: 2, to: 1, gain: 0.6, tone: 0.9 }],
  }),
  scene("wide-bowls", "Wide bowls", {
    params: { retention: 0.86, feed: 0.4, spill: 0.15 },
    loops: [{ pan: -0.85 }, { pan: 0.85 }, { pan: 0 }, { pan: -0.45 }, { pan: 0.45 }],
    routes: ring({ gain: 0.7 }),
  }),
  scene("gentle-fade", "Gentle fade", { params: { retention: 0.6, feed: 0.2, spill: 0.1 }, routes: ring({ gain: 0.6, tone: 0.7 }) }),
  scene("one-way-chain", "One-way chain", {
    params: { retention: 0.92, feed: 0.3, spill: 0.55 },
    routes: [{ from: 0, to: 1, gain: 1 }, { from: 1, to: 2, gain: 1 }, { from: 2, to: 0, gain: 0.2, enabled: false }],
  }),
  scene("spill-heavy", "Spill heavy", { params: { retention: 0.97, feed: 0.1, spill: 0.7 }, routes: [...ring({ gain: 1 }), { from: 0, to: 2, gain: 0.8, tone: 0.5 }] }),
  scene("quiet-lead", "Quiet lead", {
    params: { retention: 0.85, feed: 0.42, spill: 0.22 },
    loops: [{ level: 1 }, { level: 0.45 }, { level: 0.3 }],
    routes: ring({ gain: 0.75 }),
  }),
]);
