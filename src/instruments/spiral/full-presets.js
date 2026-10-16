import { guardedTile, randomGuardedTile, steppedValue, tileIsValid } from "../tesselation/tile-preset-helpers.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SPIRAL_TIME_PATHS = Object.freeze(["radius", "angle", "spiral"]);
export const SPIRAL_MOTION_MODES = Object.freeze(["loop", "pingpong"]);
export const SPIRAL_SOUND_MODES = Object.freeze(["sine", "percussion", "shepard", "fm", "pm"]);
export const SPIRAL_PITCH_SOURCES = Object.freeze(["angleShape", "shape", "angle", "reader", "orientation", "radius"]);
export const SPIRAL_ENVELOPE_PRESETS = Object.freeze(["pluck", "note", "sustain", "pad", "custom"]);

export const SPIRAL_NUMBER_SPECS = Object.freeze({
  spiralA: [0, 12, 1], spiralB: [0, 12, 1], patternScale: [-1.2, 1.2, 0.01], patternRotation: [-180, 180, 1],
  speed: [0.01, 1, 0.001], loopSpeed: [0.01, 1, 0.001], readerTurns: [0.25, 6, 0.05],
  baseFrequency: [20, 440, 1], pitchRange: [0, 6, 0.05], contactLevel: [0, 1, 0.01],
  percussionAttack: [0.5, 30, 0.5], percussionDecay: [15, 2000, 5], voiceCap: [1, 16, 1], stereoWidth: [0, 1, 0.01],
});
export const SPIRAL_PRESET_KEYS = Object.freeze([
  "tilingType", "parameters", "edgeCurves", "timePath", "traversalDirection", "motionMode", "loopDirection",
  "soundMode", "pitchSource", "sizeCoupling", "envelope", ...Object.keys(SPIRAL_NUMBER_SPECS),
]);
const ENVELOPE_KEYS = ["enabled", "level", "points", "preset"];

const DEFAULTS = Object.freeze({
  tilingType: 20, spiralA: 1, spiralB: 5, patternScale: 0, patternRotation: 0, timePath: "radius", speed: 0.12,
  traversalDirection: 1, motionMode: "loop", loopSpeed: 0.05, loopDirection: 1, readerTurns: 2, soundMode: "sine",
  baseFrequency: 110, pitchRange: 3.5, contactLevel: 0.38, percussionAttack: 3, percussionDecay: 180, voiceCap: 8,
  stereoWidth: 0.8, pitchSource: "angleShape", sizeCoupling: false,
});
const PERCUSSION_POINTS = Object.freeze({
  pluck: [[0, 0], [0.2, 1], [0.38, 0.28], [0.5, 0.08], [0.62, 0]],
  note: [[0, 0], [0.28, 1], [0.58, 0.55], [0.77, 0.42], [0.84, 0]],
  sustain: [[0, 0], [0.41, 1], [0.64, 0.78], [0.82, 0.78], [0.87, 0]],
  pad: [[0, 0], [0.7, 1], [0.82, 0.84], [0.93, 0.72], [0.98, 0]],
});
const envelope = (preset, level = 1) => ({
  enabled: true, level, preset, points: PERCUSSION_POINTS[preset].map(([x, y]) => ({ x, y })),
});
const snap = (key, value) => steppedValue(SPIRAL_NUMBER_SPECS[key], value);

export function captureSpiralPreset(state, amplitude) {
  const captured = amplitude.captureState();
  return {
    tilingType: state.tilingType, parameters: [...state.parameters], edgeCurves: [...state.edgeCurves],
    timePath: state.timePath, traversalDirection: state.traversalDirection >= 0 ? 1 : -1, motionMode: state.motionMode,
    loopDirection: state.loopDirection >= 0 ? 1 : -1, soundMode: state.soundMode, pitchSource: state.pitchSource,
    sizeCoupling: Boolean(state.sizeCoupling),
    envelope: {
      enabled: captured.enabled, level: captured.level, preset: captured.preset,
      points: captured.points.map(({ x, y }) => ({ x, y })),
    },
    ...Object.fromEntries(Object.keys(SPIRAL_NUMBER_SPECS).map(key => [key, state[key]])),
  };
}

export function validateSpiralPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Spiral preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== SPIRAL_PRESET_KEYS.length) bad();
  const oneOf = (value, list) => list.includes(value) || bad();
  oneOf(snapshot.timePath, SPIRAL_TIME_PATHS);
  oneOf(snapshot.motionMode, SPIRAL_MOTION_MODES);
  oneOf(snapshot.soundMode, SPIRAL_SOUND_MODES);
  oneOf(snapshot.pitchSource, SPIRAL_PITCH_SOURCES);
  oneOf(snapshot.traversalDirection, [1, -1]);
  oneOf(snapshot.loopDirection, [1, -1]);
  typeof snapshot.sizeCoupling === "boolean" || bad();
  for (const [key, [min, max, step]] of Object.entries(SPIRAL_NUMBER_SPECS)) {
    const value = snapshot[key];
    if (typeof value !== "number" || value < min || value > max || (step === 1 && !Number.isInteger(value))) bad();
  }
  if (snapshot.spiralA === 0 && snapshot.spiralB === 0) bad();
  const env = snapshot.envelope;
  if (!env || Object.keys(env).length !== ENVELOPE_KEYS.length || typeof env.enabled !== "boolean"
    || typeof env.level !== "number" || env.level < 0 || env.level > 1
    || !SPIRAL_ENVELOPE_PRESETS.includes(env.preset) || !Array.isArray(env.points) || env.points.length !== 5) bad();
  env.points.forEach((point, index) => {
    if (typeof point?.x !== "number" || typeof point?.y !== "number" || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
      || (index && point.x < env.points[index - 1].x)) bad();
  });
  tileIsValid(snapshot) || bad();
  return snapshot;
}

const scene = (id, label, patch, tile = {}, env = envelope("sustain")) => {
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = {
    ...merged, ...guardedTile(merged.tilingType, tile.offsets, tile.curves), envelope: env,
    ...Object.fromEntries(Object.keys(SPIRAL_NUMBER_SPECS).map(key => [key, snap(key, merged[key])])),
  };
  validateSpiralPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const SPIRAL_FULL_PRESETS = Object.freeze([
  scene("spiral-classic", "Spiral classic", {}),
  scene("sub-whorl", "Sub whorl", { tilingType: 1, spiralA: 2, spiralB: 3, baseFrequency: 48, pitchRange: 2, contactLevel: 0.55, speed: 0.06, stereoWidth: 0.5, voiceCap: 6 }, {}, envelope("pad")),
  scene("fibonacci-pad", "Fibonacci pad", { tilingType: 5, spiralA: 3, spiralB: 5, sizeCoupling: true, baseFrequency: 82, pitchRange: 3, contactLevel: 0.5, speed: 0.09, voiceCap: 10 }, {}, envelope("pad", 0.9)),
  scene("angle-sweep-fm", "Angle sweep FM", { tilingType: 43, timePath: "angle", soundMode: "fm", baseFrequency: 165, spiralA: 2, spiralB: 7, pitchSource: "shape", speed: 0.4, contactLevel: 0.3 }, { curves: [0.4, -0.3, 0.2] }),
  scene("phase-bells-pm", "Phase bells PM", { tilingType: 4, soundMode: "pm", baseFrequency: 262, pitchRange: 4.5, pitchSource: "orientation", spiralA: 4, spiralB: 6, patternRotation: 30, stereoWidth: 1, speed: 0.18, contactLevel: 0.3 }, {}, envelope("note", 0.85)),
  scene("shepard-descent", "Shepard descent", { tilingType: 78, timePath: "spiral", soundMode: "shepard", pitchSource: "radius", spiralA: 1, spiralB: 8, readerTurns: 1.2, speed: 0.15, pitchRange: 5, traversalDirection: -1 }),
  scene("percussive-drops", "Percussive drops", { tilingType: 61, soundMode: "percussion", percussionAttack: 1.5, percussionDecay: 120, voiceCap: 12, speed: 0.3, baseFrequency: 196, pitchRange: 4, spiralA: 5, spiralB: 2 }, {}, envelope("pluck")),
  scene("slow-gongs", "Slow gongs", { tilingType: 12, soundMode: "percussion", percussionAttack: 12, percussionDecay: 1400, voiceCap: 4, speed: 0.05, baseFrequency: 74, pitchRange: 2.5, spiralA: 3, spiralB: 4, contactLevel: 0.6 }, {}, envelope("pad")),
  scene("spiral-time-ride", "Spiral time ride", { tilingType: 29, timePath: "spiral", readerTurns: 4.5, speed: 0.25, spiralA: 6, spiralB: 9, patternScale: 0.5, baseFrequency: 130, pitchRange: 3, motionMode: "pingpong" }),
  scene("pinwheel-tilt", "Pinwheel tilt", { tilingType: 3, patternRotation: 72, patternScale: -0.6, spiralA: 7, spiralB: 3, pitchSource: "angle", timePath: "angle", traversalDirection: -1, speed: 0.22, baseFrequency: 98 }),
  scene("tight-coil-glass", "Tight coil glass", { tilingType: 44, spiralA: 10, spiralB: 11, soundMode: "pm", baseFrequency: 330, pitchRange: 2.5, voiceCap: 14, contactLevel: 0.26, stereoWidth: 0.95, loopDirection: -1, patternScale: 1 }, { curves: [0.35, -0.5, 0.45, -0.2] }, envelope("note", 0.8)),
  scene("slow-bloom-unfold", "Slow bloom unfold", { tilingType: 20, spiralA: 0, spiralB: 4, loopSpeed: 0.02, speed: 0.03, baseFrequency: 62, pitchRange: 5, pitchSource: "reader", sizeCoupling: true, voiceCap: 8 }, {}, envelope("pad", 0.95)),
  scene("shaped-fm-metal", "Shaped FM metal", { tilingType: 71, soundMode: "fm", baseFrequency: 220, pitchRange: 1.5, spiralA: 2, spiralB: 9, pitchSource: "angleShape", patternScale: -1, speed: 0.5, contactLevel: 0.24, voiceCap: 12 }, {}, envelope("pluck", 0.9)),
]);

const randomEnvelope = rng => {
  const x1 = rng.between(0.08, 0.4), x2 = x1 + rng.between(0.05, 0.2), x3 = x2 + rng.between(0.05, 0.2);
  const x4 = Math.min(1, x3 + rng.between(0.06, 0.2)), y2 = rng.between(0.2, 0.95);
  const points = [[0, 0], [x1, 1], [x2, y2], [x3, y2 * rng.between(0.4, 1)], [x4, 0]]
    .map(([x, y]) => ({ x: Number(x.toFixed(4)), y: Number(y.toFixed(3)) }));
  return { enabled: rng.unit() < 0.9, level: Number(rng.between(0.6, 1).toFixed(2)), preset: "custom", points };
};

export function randomizeSpiralPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const spiralA = rng.integer(0, 11);
  const next = {
    ...randomGuardedTile(rng),
    timePath: rng.pick(SPIRAL_TIME_PATHS), traversalDirection: rng.unit() < 0.3 ? -1 : 1,
    motionMode: rng.pick(SPIRAL_MOTION_MODES), loopDirection: rng.unit() < 0.5 ? -1 : 1,
    soundMode: rng.pick(SPIRAL_SOUND_MODES), pitchSource: rng.pick(SPIRAL_PITCH_SOURCES), sizeCoupling: rng.unit() < 0.5,
    envelope: randomEnvelope(rng),
    spiralA, spiralB: snap("spiralB", spiralA === 0 ? rng.integer(1, 12) : rng.integer(0, 12)),
    patternScale: snap("patternScale", rng.between(-1, 1)), patternRotation: snap("patternRotation", rng.between(-180, 180)),
    speed: snap("speed", 0.03 + rng.unit() ** 2 * 0.7), loopSpeed: snap("loopSpeed", 0.015 + rng.unit() ** 2 * 0.4),
    readerTurns: snap("readerTurns", rng.between(0.5, 5)),
    baseFrequency: snap("baseFrequency", 40 * 8 ** rng.unit()), pitchRange: snap("pitchRange", rng.between(1, 5)),
    contactLevel: snap("contactLevel", rng.between(0.18, 0.7)),
    percussionAttack: snap("percussionAttack", 0.5 + rng.unit() ** 2 * 20),
    percussionDecay: snap("percussionDecay", 40 + rng.unit() ** 2 * 1600),
    voiceCap: snap("voiceCap", rng.integer(3, 14)), stereoWidth: snap("stereoWidth", rng.unit()),
  };
  return validateSpiralPreset(next);
}
