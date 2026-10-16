import { TAPE_PRESETS } from "./tape-worm.js";
import {
  captureLoopNetworkPreset, loopNetworkScene, randomizeLoopNetworkPreset, ringRoutes, validateLoopNetworkPreset,
} from "./loop-network-presets.js";

export const captureTapeWormPreset = raw => captureLoopNetworkPreset("tape", raw);
export const validateTapeWormPreset = snapshot => validateLoopNetworkPreset("tape", snapshot);
export const randomizeTapeWormPreset = (current, random, options) => randomizeLoopNetworkPreset("tape", current, random, options);

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const pair = (values, back = values) => [{ from: 0, to: 1, ...values }, { from: 1, to: 0, ...back }];
const scene = (label, options) => loopNetworkScene("tape", slug(label), label, options);
const fromGlobal = (name, extra = {}) => scene(name, {
  params: TAPE_PRESETS[name],
  routes: pair({ departure: TAPE_PRESETS[name].departure, landing: TAPE_PRESETS[name].landing, ...extra }),
});

export const TAPE_WORM_FULL_PRESETS = Object.freeze([
  fromGlobal("Two phrases"),
  fromGlobal("Tiny detours"),
  fromGlobal("Slow worm"),
  fromGlobal("Original loops"),
  scene("Early exits", {
    params: { departure: 0.22, landing: 0.5 },
    routes: pair({ departure: 0.22, landing: 0.5, fade: 0.03 }),
  }),
  scene("Long glide", {
    params: { speed: 0.7, departure: 0.92, landing: 0.02 },
    routes: pair({ departure: 0.92, landing: 0.02, fade: 0.15 }),
  }),
  scene("Stutter step", {
    params: { speed: 1.5, departure: 0.12, landing: 0.12 },
    routes: pair({ departure: 0.12, landing: 0.12, fade: 0.005 }),
  }),
  scene("Octave up", {
    params: { speed: 2, departure: 0.6, landing: 0.3 },
    routes: pair({ departure: 0.6, landing: 0.3, fade: 0.04 }),
  }),
  scene("Octave down", {
    params: { speed: 0.5, departure: 0.82, landing: 0.18 },
    routes: pair({ departure: 0.82, landing: 0.18, fade: 0.08 }),
  }),
  scene("Wide stereo", {
    loops: [{ pan: -0.85, level: 0.9 }, { pan: 0.85, level: 0.9 }, { pan: -0.4 }, { pan: 0.4 }, { pan: -0.7 }, { pan: 0.7 }],
    routes: pair({ departure: 0.72, landing: 0.08 }),
  }),
  scene("Offset answer", {
    params: { departure: 0.3, landing: 0.6 },
    routes: pair({ departure: 0.3, landing: 0.6, fade: 0.02 }, { departure: 0.8, landing: 0.1, fade: 0.06 }),
  }),
  scene("One-way street", {
    params: { speed: 0.85, departure: 0.66, landing: 0.2 },
    routes: [{ from: 0, to: 1, departure: 0.66, landing: 0.2, fade: 0.05 }, { from: 1, to: 0, departure: 0.98, landing: 0.2, fade: 0.05, enabled: false }],
  }),
  scene("Quiet partner", {
    loops: [{ level: 1 }, { level: 0.35, pan: 0.5 }],
    routes: pair({ departure: 0.5, landing: 0.5, fade: 0.1 }),
  }),
  scene("Triangle walk", {
    params: { speed: 1.15, departure: 0.55, landing: 0.1 },
    loops: [{ pan: -0.5 }, { pan: 0.5 }, { pan: 0 }],
    routes: ringRoutes([0, 1, 2], { departure: 0.55, landing: 0.1, fade: 0.04 }),
  }),
  scene("Round robin", {
    params: { speed: 0.9, departure: 0.78, landing: 0.04 },
    loops: [{ pan: -0.7 }, { pan: -0.25 }, { pan: 0.25 }, { pan: 0.7 }],
    routes: [...ringRoutes([0, 1, 2, 3], { departure: 0.78, landing: 0.04, fade: 0.05 }), { from: 2, to: 0, departure: 0.4, landing: 0.5, fade: 0.02 }],
  }),
]);
