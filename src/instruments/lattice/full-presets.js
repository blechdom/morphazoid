import { TILING_TYPES, tilingInfo, tilingParameterRange, constrainPrototileEdit, prototileIsNonOverlapping } from "./lattice.js";
import { EdgeShape } from "../../../vendor/tactile/tactile.js";
import { percussionEnvelopePreset, percussionEnvelopeEditorX, sanitizeAmplitudeEnvelope } from "../../audio.js";
import { createLatticeInitialState } from "./initial-state.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";
export { createLatticeInitialState };
export const LATTICE_LIVE_KEYS = Object.freeze(["audio", "playing", "position", "continuousPosition"]);
const keys = Object.keys(createLatticeInitialState()).filter(key => !LATTICE_LIVE_KEYS.includes(key));
const ranges = {
  density: [0, 0.8], speed: [0.01, 4], patternDirectionAngle: [0, 90], angle: [0, 179.9], level: [0, 1],
  baseFrequency: [20, 440], pitchRange: [0, 6], contactLevel: [0, 1], intersectionAccent: [0, 1], voiceCap: [1, 16],
  percussionAttack: [0.5, 30], percussionDecay: [15, 2000], shepardCycles: [0.25, 4], shepardWidth: [1, 8],
  fmIndex: [0, 12], fmRatio: [0.25, 8], pmIndex: [0, 8], pmRatio: [0.25, 8], stereoWidth: [0, 1],
};
const choices = {
  motionMode: ["loop", "pingpong"], traversalDirection: [-1, 1], shepardDirection: [-1, 1],
  soundMode: ["sine", "fm", "pm", "percussion", "shepard"], synthSource: ["height", "along", "incidence", "orientation"],
  pitchSource: ["height", "along", "incidence", "orientation"], levelSource: ["fixed", "incidence", "center", "orientation"],
  pitchCurve: ["linear", "exponential", "logarithmic", "smooth", "inverted"],
  levelCurve: ["linear", "exponential", "logarithmic", "smooth", "inverted"],
};
export function captureLatticePreset(state, envelope) {
  return clonePresetData({ parameters: Object.fromEntries(keys.map(key => [key, state[key]])), envelope });
}
export function validateLatticePreset(snapshot) {
  presetStateKey(snapshot);
  const p = snapshot.parameters, info = TILING_TYPES.find(item => item.type === p?.tilingType);
  if (!p || !info || Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete Lattice scene");
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid Lattice ${key}`);
  for (const [key, values] of Object.entries(choices)) if (!values.includes(p[key])) throw new TypeError(`Invalid Lattice ${key}`);
  if (!Number.isInteger(p.voiceCap) || p.parameters?.length !== info.defaultParameters.length || p.edgeCurves?.length !== info.edgeShapes.length
    || p.parameters.some((value, i) => { const r = tilingParameterRange(p.tilingType, i); return !Number.isFinite(value) || value < r.min || value > r.max; })
    || p.edgeCurves.some((value, i) => !Number.isFinite(value) || Math.abs(value) > 1 || (info.edgeShapes[i] === EdgeShape.I && value !== 0))
    || !prototileIsNonOverlapping({ type: p.tilingType, parameters: p.parameters, edgeCurves: p.edgeCurves })) throw new TypeError("Invalid or overlapping Lattice tile");
  const e = snapshot.envelope;
  if (!e || typeof e.enabled !== "boolean" || e.swell !== false || !["pluck", "note", "sustain", "pad", "custom"].includes(e.preset)
    || !(e.level >= 0 && e.level <= 1) || presetStateKey(e.points) !== presetStateKey(sanitizeAmplitudeEnvelope(e.points))) throw new TypeError("Invalid Lattice envelope");
  return snapshot;
}
const scenes = [
  [20, "Pentagon · Original net", "sine", 0.08, 90, 0, "sustain", 0],
  [1, "Hexagon · Soft weave", "sine", 0.04, 65, 0.1, "pad", 0],
  [7, "Hexagon · Brass current", "fm", 0.22, 110, -0.08, "note", 25],
  [10, "Hexagon · Glass turns", "pm", 0.16, 35, 0.08, "pluck", 70],
  [21, "Pentagon · Unequal knocks", "percussion", 0.3, 76, 0.1, "note", 45],
  [27, "Pentagon · Backward ribbon", "shepard", 0.09, 125, -0.1, "sustain", 90],
  [30, "Quadrilateral · Pulse cloth", "pm", 0.2, 22, 0.08, "note", 0],
  [31, "Square · Dry clock", "percussion", 0.38, 40, 0, "pluck", 90],
  [43, "Quadrilateral · Narrow strings", "sine", 0.12, 145, 0.08, "pluck", 30],
  [44, "Quadrilateral · Nasty folds", "fm", 0.3, 58, -0.12, "note", 65],
  [74, "Triangle · Sweet rain", "percussion", 0.14, 85, 0.05, "note", 15],
  [77, "Triangle · Endless lace", "shepard", 0.065, 130, -0.07, "pad", 80],
];
export const LATTICE_FULL_PRESETS = Object.freeze(scenes.map(([type, label, mode, speed, angle, bend, envelope, bearing], index) => {
  const info = tilingInfo(type), currentEdgeCurves = info.edgeShapes.map(() => 0);
  const guarded = constrainPrototileEdit({ type, currentParameters: [...info.defaultParameters], currentEdgeCurves,
    edgeCurves: info.edgeShapes.map((shape, i) => shape === EdgeShape.I ? 0 : bend * (i % 2 ? -1 : 1)) });
  const state = { ...createLatticeInitialState(), tilingType: type, parameters: guarded.parameters, edgeCurves: guarded.edgeCurves,
    soundMode: mode, speed, angle, patternDirectionAngle: bearing,
    density: index === 0 ? 0.52 : 0.22 + index % 3 * 0.06, motionMode: index % 3 === 1 ? "pingpong" : "loop",
    traversalDirection: index % 2 ? 1 : -1, shepardDirection: index % 2 ? -1 : 1,
    baseFrequency: mode === "percussion" ? 82 : index === 10 ? 196 : 110,
    pitchRange: index === 9 ? 4 : 2.5, level: index === 0 ? 0.65 : index === 9 ? 0.32 : 0.44,
    fmIndex: index === 9 ? 6 : 2, fmRatio: index === 9 ? 0.7 : 2, pmIndex: 1.8,
    pitchSource: index % 3 === 1 ? "along" : "height", levelSource: index % 3 === 2 ? "orientation" : "incidence",
    percussionAttack: index === 0 ? 3 : 12, percussionDecay: index === 7 ? 90 : 180,
  };
  if (index === 0) Object.assign(state, createLatticeInitialState());
  return { id: `ih-${type}`, label, description: `${label}: complete guarded tile, scan/movement, sound mappings and timed envelope. Audio/Play and live scan phase remain unchanged.`,
    snapshot: validateLatticePreset(captureLatticePreset(state, { enabled: true, swell: false, preset: envelope, level: 1, points: percussionEnvelopePreset(envelope) })) };
}));
export function randomizeLatticePreset(current, random = Math.random) {
  const rng = presetRandom(random), info = rng.pick(TILING_TYPES);
  const currentEdgeCurves = info.edgeShapes.map(() => 0);
  const guarded = constrainPrototileEdit({
    type: info.type, currentParameters: [...info.defaultParameters], currentEdgeCurves,
    parameters: info.defaultParameters.map((value, i) => {
      const { min, max } = tilingParameterRange(info.type, i);
      return Math.max(min, Math.min(max, value + rng.between(-0.08, 0.08)));
    }),
    edgeCurves: info.edgeShapes.map(shape => shape === EdgeShape.I ? 0 : rng.between(-0.15, 0.15)),
  });
  const p = { ...current.parameters, ...randomParameterValues({
    ...ranges, density: [0.1, 0.35], speed: [0.04, 0.4], baseFrequency: [55, 220], pitchRange: [1, 4],
    contactLevel: [0.2, 0.5], fmIndex: [0.2, 5], pmIndex: [0.2, 3], percussionAttack: [8, 25], percussionDecay: [60, 350],
  }, rng), tilingType: info.type, parameters: guarded.parameters, edgeCurves: guarded.edgeCurves, voiceCap: rng.integer(2, 10), level: current.parameters.level };
  for (const [key, values] of Object.entries(choices)) p[key] = rng.pick(values);
  const times = [0, rng.between(8, 30), rng.between(45, 100), rng.between(130, 220), rng.between(280, 600)];
  return validateLatticePreset({ parameters: p, envelope: {
    enabled: rng.pick([true, false]), swell: false, preset: "custom", level: rng.between(0.35, 1),
    points: times.map((ms, i) => ({ x: percussionEnvelopeEditorX(ms), y: i === 0 || i === 4 ? 0 : i === 1 ? 1 : rng.between(0.1, 0.6) })),
  } });
}
