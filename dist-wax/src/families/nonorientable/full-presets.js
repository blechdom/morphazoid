import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const NONORIENTABLE_SOUND_MODES = Object.freeze(["sine", "fm", "pm", "shepard"]);
export const NONORIENTABLE_PLAY_MODES = Object.freeze(["plane", "sequence"]);
export const MOEBIUS_TWISTS = Object.freeze([1, 3, 5]);

const COMMON_SPECS = {
  planeYaw: [-180, 180, 1], planePitch: [-180, 180, 1], surfaceFold: [0.35, 1.65, 0.01], speed: [0.01, 1.2, 0.01],
  rotationX: [-180, 180, 1], rotationY: [-180, 180, 1], rotationZ: [-180, 180, 1], rotationSpeed: [-0.25, 0.25, 0.005],
  baseFrequency: [20, 330, 1], pitchRange: [0.25, 5, 0.05], timbre: [0, 1, 0.01], stereoWidth: [0, 1, 0.01], seamVoice: [0, 1, 0.01],
};
export const NONORIENTABLE_SPECS = Object.freeze({
  moebius: Object.freeze({ ...COMMON_SPECS, surfaceRadius: [0.48, 1.05, 0.01], surfaceWidth: [0.12, 0.68, 0.01] }),
  klein: Object.freeze({ ...COMMON_SPECS, surfaceRadius: [1.05, 2.4, 0.01], surfaceWidth: [0.18, 0.72, 0.01] }),
});
const SWITCH_KEYS = ["direction", "autoRotate", "soundMode"];

export const nonorientablePresetKeys = kind => Object.freeze([
  ...Object.keys(NONORIENTABLE_SPECS[kind]), ...SWITCH_KEYS, ...(kind === "moebius" ? ["playMode", "surfaceTwists"] : []),
]);

const snap = (specs, key, value) => {
  const [min, max, step] = specs[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};

export function captureNonorientablePreset(kind, state) {
  return Object.fromEntries(nonorientablePresetKeys(kind).map(key => [key, state[key]]));
}

export function validateNonorientablePreset(kind, snapshot) {
  const bad = () => { throw new TypeError(`Invalid complete ${kind} preset`); };
  presetStateKey(snapshot);
  const keys = nonorientablePresetKeys(kind);
  if (Object.keys(snapshot).length !== keys.length || keys.some(key => !(key in snapshot))) bad();
  const specs = NONORIENTABLE_SPECS[kind];
  for (const [key, [min, max]] of Object.entries(specs)) {
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  if (snapshot.direction !== 1 && snapshot.direction !== -1) bad();
  if (typeof snapshot.autoRotate !== "boolean") bad();
  if (!NONORIENTABLE_SOUND_MODES.includes(snapshot.soundMode)) bad();
  if (kind === "moebius") {
    if (!NONORIENTABLE_PLAY_MODES.includes(snapshot.playMode) || !MOEBIUS_TWISTS.includes(snapshot.surfaceTwists)) bad();
    if (snapshot.surfaceWidth > snapshot.surfaceRadius * 0.75) bad();
  }
  return snapshot;
}

const DEFAULTS = {
  moebius: {
    planeYaw: 38, planePitch: -18, surfaceRadius: 0.72, surfaceWidth: 0.38, surfaceFold: 1, surfaceTwists: 1, speed: 0.1,
    rotationX: -24, rotationY: 28, rotationZ: -6, autoRotate: false, rotationSpeed: 0.035, direction: 1, playMode: "plane",
    soundMode: "fm", baseFrequency: 72, pitchRange: 2.6, timbre: 0.58, stereoWidth: 0.82, seamVoice: 0.52,
  },
  klein: {
    planeYaw: 24, planePitch: -14, surfaceRadius: 1.5, surfaceWidth: 0.42, surfaceFold: 1, speed: 0.08,
    rotationX: -18, rotationY: 34, rotationZ: 2, autoRotate: false, rotationSpeed: 0.03, direction: 1,
    soundMode: "fm", baseFrequency: 62, pitchRange: 3.1, timbre: 0.62, stereoWidth: 0.86, seamVoice: 0.58,
  },
};

const scene = (kind, id, label, patch = {}) => {
  const specs = NONORIENTABLE_SPECS[kind];
  const merged = { ...DEFAULTS[kind], ...patch };
  const snapshot = Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, specs[key] ? snap(specs, key, value) : value]));
  validateNonorientablePreset(kind, snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const MOEBIUS_FULL_PRESETS = Object.freeze([
  scene("moebius", "ribbon-drift", "Ribbon drift"),
  scene("moebius", "edge-return", "Edge return", { planeYaw: 91, planePitch: 4, surfaceRadius: 0.78, surfaceWidth: 0.27, surfaceFold: 1.35, speed: 0.18, soundMode: "sine", baseFrequency: 94, pitchRange: 3.45, timbre: 0.22, stereoWidth: 1, seamVoice: 0.8 }),
  scene("moebius", "triple-twist", "Triple twist", { planeYaw: -31, planePitch: 48, surfaceRadius: 0.7, surfaceWidth: 0.34, surfaceFold: 0.84, surfaceTwists: 3, speed: 0.065, soundMode: "pm", baseFrequency: 48, pitchRange: 3.8, timbre: 0.86, stereoWidth: 0.74, seamVoice: 0.92 }),
  scene("moebius", "fivefold-halo", "Fivefold halo", { surfaceTwists: 5, surfaceRadius: 0.95, surfaceWidth: 0.3, surfaceFold: 1.5, planeYaw: 12, planePitch: 70, soundMode: "shepard", baseFrequency: 110, pitchRange: 4.4, seamVoice: 1, speed: 0.12, autoRotate: true, rotationSpeed: 0.06 }),
  scene("moebius", "weave-lap", "Counterpoint lap", { playMode: "sequence", speed: 0.22, baseFrequency: 98, pitchRange: 2.8, timbre: 0.4, stereoWidth: 0.95, seamVoice: 0.7, surfaceWidth: 0.34 }),
  scene("moebius", "weave-deep", "Deep weave", { playMode: "sequence", speed: 0.12, baseFrequency: 49, pitchRange: 3.6, timbre: 0.8, stereoWidth: 0.6, seamVoice: 0.95, surfaceTwists: 3, surfaceRadius: 0.82 }),
  scene("moebius", "reverse-glass", "Reverse glass", { direction: -1, planeYaw: -120, planePitch: -35, soundMode: "sine", baseFrequency: 210, pitchRange: 1.8, timbre: 0.1, stereoWidth: 0.5, seamVoice: 0.3, speed: 0.07 }),
  scene("moebius", "wide-band-pad", "Wide band pad", { surfaceRadius: 0.62, surfaceWidth: 0.46, surfaceFold: 0.6, speed: 0.03, soundMode: "fm", baseFrequency: 55, pitchRange: 1.4, timbre: 0.9, stereoWidth: 1, seamVoice: 0.2 }),
  scene("moebius", "thin-wire-chirp", "Thin wire chirp", { surfaceRadius: 1, surfaceWidth: 0.14, surfaceFold: 1.6, speed: 0.6, soundMode: "pm", baseFrequency: 280, pitchRange: 4.8, timbre: 0.7, stereoWidth: 0.9, seamVoice: 0.6, planeYaw: 150 }),
  scene("moebius", "turntable-drone", "Turntable drone", { autoRotate: true, rotationSpeed: -0.12, rotationX: -60, rotationY: 80, rotationZ: 20, speed: 0.015, soundMode: "shepard", baseFrequency: 36, pitchRange: 4.9, timbre: 0.5, seamVoice: 0.5 }),
  scene("moebius", "polar-slice", "Polar slice", { planePitch: 88, planeYaw: 0, speed: 0.25, soundMode: "fm", baseFrequency: 130, pitchRange: 2, timbre: 0.3, stereoWidth: 0.2, seamVoice: 0.85 }),
  scene("moebius", "five-twist-weave", "Five-twist weave", { playMode: "sequence", surfaceTwists: 5, surfaceRadius: 0.9, surfaceWidth: 0.4, speed: 0.3, baseFrequency: 165, pitchRange: 2.2, timbre: 0.2, stereoWidth: 0.8, seamVoice: 0.4, direction: -1 }),
  scene("moebius", "low-sine-sweep", "Low sine sweep", { soundMode: "sine", baseFrequency: 28, pitchRange: 3, timbre: 0.05, speed: 0.05, planeYaw: 60, planePitch: 20, surfaceFold: 0.45, seamVoice: 0.1 }),
]);

export const KLEIN_FULL_PRESETS = Object.freeze([
  scene("klein", "bottle-orbit", "Bottle orbit"),
  scene("klein", "crossing-glass", "Crossing glass", { planeYaw: 88, planePitch: 8, surfaceRadius: 1.32, surfaceWidth: 0.54, surfaceFold: 1.28, speed: 0.14, soundMode: "pm", baseFrequency: 84, pitchRange: 2.35, timbre: 0.82, stereoWidth: 1, seamVoice: 0.88 }),
  scene("klein", "deep-weave", "Deep weave", { planeYaw: -38, planePitch: 52, surfaceRadius: 1.82, surfaceWidth: 0.36, surfaceFold: 0.7, speed: 0.045, soundMode: "shepard", baseFrequency: 42, pitchRange: 4.1, timbre: 0.44, stereoWidth: 0.7, seamVoice: 0.72 }),
  scene("klein", "neck-whistle", "Neck whistle", { surfaceRadius: 1.2, surfaceWidth: 0.2, surfaceFold: 1.6, speed: 0.4, soundMode: "sine", baseFrequency: 260, pitchRange: 2.2, timbre: 0.12, stereoWidth: 0.6, seamVoice: 0.4, planeYaw: 130 }),
  scene("klein", "fat-gong", "Fat gong", { surfaceRadius: 1.1, surfaceWidth: 0.68, surfaceFold: 0.5, speed: 0.03, soundMode: "fm", baseFrequency: 38, pitchRange: 1.6, timbre: 0.95, stereoWidth: 1, seamVoice: 0.3 }),
  scene("klein", "reverse-orbit", "Reverse orbit", { direction: -1, planeYaw: -75, planePitch: -40, speed: 0.1, soundMode: "pm", baseFrequency: 120, pitchRange: 3, timbre: 0.5, stereoWidth: 0.9, seamVoice: 0.6 }),
  scene("klein", "turntable-bottle", "Turntable bottle", { autoRotate: true, rotationSpeed: 0.1, rotationX: -50, rotationY: 20, rotationZ: 0, speed: 0.06, soundMode: "shepard", baseFrequency: 55, pitchRange: 4.6, seamVoice: 0.8 }),
  scene("klein", "wide-loop-drone", "Wide loop drone", { surfaceRadius: 2.3, surfaceWidth: 0.3, surfaceFold: 1.1, speed: 0.02, soundMode: "fm", baseFrequency: 30, pitchRange: 3.8, timbre: 0.7, stereoWidth: 0.4, seamVoice: 0.9 }),
  scene("klein", "polar-glint", "Polar glint", { planePitch: 85, planeYaw: 10, speed: 0.3, soundMode: "sine", baseFrequency: 190, pitchRange: 1.5, timbre: 0.25, stereoWidth: 0.15, seamVoice: 0.7 }),
  scene("klein", "folded-bell", "Folded bell", { surfaceFold: 1.65, surfaceWidth: 0.6, surfaceRadius: 1.4, speed: 0.09, soundMode: "pm", baseFrequency: 150, pitchRange: 2.6, timbre: 0.85, stereoWidth: 0.7, seamVoice: 1, planeYaw: 60 }),
  scene("klein", "flat-fold-bass", "Flat fold bass", { surfaceFold: 0.38, surfaceRadius: 1.6, speed: 0.05, soundMode: "fm", baseFrequency: 24, pitchRange: 2.4, timbre: 0.35, stereoWidth: 0.5, seamVoice: 0.2, planePitch: 5 }),
  scene("klein", "skew-sweep", "Skew sweep", { planeYaw: 160, planePitch: 35, rotationX: 40, rotationY: -70, rotationZ: 15, speed: 0.7, soundMode: "shepard", baseFrequency: 90, pitchRange: 5, timbre: 0.6, stereoWidth: 1, seamVoice: 0.5 }),
  scene("klein", "slow-glass-bloom", "Slow glass bloom", { speed: 0.012, soundMode: "sine", baseFrequency: 70, pitchRange: 4.2, timbre: 0.05, stereoWidth: 0.95, seamVoice: 0.95, surfaceWidth: 0.5, planeYaw: -10 }),
]);

export function randomizeNonorientablePreset(kind, current, random = Math.random) {
  validateNonorientablePreset(kind, current);
  const rng = presetRandom(random);
  const specs = NONORIENTABLE_SPECS[kind];
  const range = (key, lo = specs[key][0], hi = specs[key][1]) => snap(specs, key, rng.between(lo, hi));
  const log = (key, lo, hi) => snap(specs, key, lo * (hi / lo) ** rng.unit());
  const surfaceRadius = range("surfaceRadius");
  const widthCap = kind === "moebius" ? Math.min(specs.surfaceWidth[1], Math.floor(surfaceRadius * 75) / 100) : specs.surfaceWidth[1];
  const next = {
    planeYaw: range("planeYaw"), planePitch: range("planePitch"), surfaceRadius,
    surfaceWidth: snap(specs, "surfaceWidth", rng.between(specs.surfaceWidth[0], widthCap)),
    surfaceFold: range("surfaceFold"), speed: log("speed", 0.015, 0.9),
    rotationX: range("rotationX"), rotationY: range("rotationY"), rotationZ: range("rotationZ"),
    rotationSpeed: range("rotationSpeed"), baseFrequency: log("baseFrequency", 24, 300),
    pitchRange: range("pitchRange", 0.6, 5), timbre: range("timbre"), stereoWidth: range("stereoWidth"), seamVoice: range("seamVoice"),
    direction: rng.unit() < 0.3 ? -1 : 1, autoRotate: rng.unit() < 0.4, soundMode: rng.pick(NONORIENTABLE_SOUND_MODES),
  };
  if (kind === "moebius") {
    next.playMode = rng.unit() < 0.3 ? "sequence" : "plane";
    next.surfaceTwists = rng.pick(MOEBIUS_TWISTS);
  }
  return validateNonorientablePreset(kind, next);
}
