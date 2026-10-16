import { guardedTile, randomGuardedTile, steppedValue, tileIsValid } from "./tile-preset-helpers.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const TESSELATION_MODE_IDS = Object.freeze(["lattice", "lattice-drums", "spiral", "spiral-drums"]);
export const TESSELATION_LATTICE_PITCH_SOURCES = Object.freeze(["height", "along", "incidence", "orientation"]);
export const TESSELATION_SPIRAL_PITCH_SOURCES = Object.freeze(["angle-shape", "shape", "angle", "reader", "orientation", "radius"]);
export const TESSELATION_TIME_PATHS = Object.freeze(["radius", "angle", "spiral"]);
export const TESSELATION_SOUND_MODES = Object.freeze(["sine", "fm", "pm", "shepard"]);
export const TESSELATION_LATTICE_MAPPINGS = Object.freeze(["edge-angle", "position-grid", "incidence-density", "tile-color-pair"]);
export const TESSELATION_SPIRAL_MAPPINGS = Object.freeze(["radius-angle", "shape-angle", "reader-incidence"]);

const NUMBER_SPECS = Object.freeze({
  density: [0, 1, 0.01], speed: [0, 3, 0.01], lineAngle: [0, 180, 1], patternAngle: [-180, 180, 1],
  readerTurns: [0.25, 6, 0.05], spiralA: [-6, 6, 1], spiralB: [-8, 8, 1], loopPhase: [0, 1, 0.001],
  baseFrequency: [35, 440, 1], pitchRange: [0, 7, 0.1], contactLevel: [0, 1, 0.01], stereoWidth: [0, 1, 0.01],
  fmIndex: [0, 12, 0.1], pmIndex: [0, 10, 0.1], pitchDepth: [0, 24, 1], characterDepth: [0, 1, 0.01],
  strikeLimit: [1, 16, 1],
});
export const TESSELATION_PRESET_KEYS = Object.freeze([
  "mode", "tilingType", "parameters", "edgeCurves", "traversalDirection", "motionMode", "timePath", "sizeCoupling",
  "soundMode", "latticePitchSource", "spiralPitchSource", "latticeMappingMode", "spiralMappingMode",
  ...Object.keys(NUMBER_SPECS),
]);

const DEFAULTS = Object.freeze({
  mode: "lattice", tilingType: 20, density: 0.52, speed: 0.12, traversalDirection: 1, motionMode: "loop",
  lineAngle: 90, patternAngle: 0, timePath: "radius", readerTurns: 2, sizeCoupling: false, spiralA: 1, spiralB: 5,
  loopPhase: 0, latticePitchSource: "height", spiralPitchSource: "angle-shape", soundMode: "sine", baseFrequency: 110,
  pitchRange: 3.5, contactLevel: 0.35, stereoWidth: 0.72, fmIndex: 3, pmIndex: 2, latticeMappingMode: "edge-angle",
  spiralMappingMode: "radius-angle", pitchDepth: 12, characterDepth: 0.7, strikeLimit: 5,
});

const snap = (key, value) => steppedValue(NUMBER_SPECS[key], value);

export function captureTesselationPreset(state) {
  return {
    mode: state.mode, tilingType: state.tilingType, parameters: [...state.parameters], edgeCurves: [...state.edgeCurves],
    traversalDirection: state.traversalDirection >= 0 ? 1 : -1, motionMode: state.motionMode, timePath: state.timePath,
    sizeCoupling: Boolean(state.sizeCoupling), soundMode: state.soundMode,
    latticePitchSource: state.pitchSourceByGeometry.lattice, spiralPitchSource: state.pitchSourceByGeometry.spiral,
    latticeMappingMode: state.latticeMappingMode, spiralMappingMode: state.spiralMappingMode,
    ...Object.fromEntries(Object.keys(NUMBER_SPECS).map(key => [key, state[key]])),
  };
}

export function validateTesselationPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Tesselation preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== TESSELATION_PRESET_KEYS.length) bad();
  const oneOf = (value, list) => list.includes(value) || bad();
  oneOf(snapshot.mode, TESSELATION_MODE_IDS);
  oneOf(snapshot.motionMode, ["loop", "ping-pong"]);
  oneOf(snapshot.traversalDirection, [1, -1]);
  oneOf(snapshot.timePath, TESSELATION_TIME_PATHS);
  oneOf(snapshot.soundMode, TESSELATION_SOUND_MODES);
  oneOf(snapshot.latticePitchSource, TESSELATION_LATTICE_PITCH_SOURCES);
  oneOf(snapshot.spiralPitchSource, TESSELATION_SPIRAL_PITCH_SOURCES);
  oneOf(snapshot.latticeMappingMode, TESSELATION_LATTICE_MAPPINGS);
  oneOf(snapshot.spiralMappingMode, TESSELATION_SPIRAL_MAPPINGS);
  typeof snapshot.sizeCoupling === "boolean" || bad();
  for (const [key, [min, max, step]] of Object.entries(NUMBER_SPECS)) {
    const value = snapshot[key];
    if (typeof value !== "number" || value < min || value > max) bad();
    if (step === 1 && !Number.isInteger(value)) bad();
  }
  tileIsValid(snapshot) || bad();
  return snapshot;
}

const scene = (id, label, patch, tile = {}) => {
  const merged = { ...DEFAULTS, ...patch };
  const type = merged.tilingType;
  const guarded = guardedTile(type, tile.offsets ?? [], tile.curves ?? []);
  const snapshot = {
    ...merged, ...guarded,
    ...Object.fromEntries(Object.keys(NUMBER_SPECS).map(key => [key, snap(key, merged[key])])),
  };
  validateTesselationPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const TESSELATION_FULL_PRESETS = Object.freeze([
  scene("lattice-classic", "Lattice classic", {}),
  scene("sub-pentagon-drone", "Sub pentagon drone", { tilingType: 1, density: 0.3, baseFrequency: 55, pitchRange: 2, contactLevel: 0.55, speed: 0.06, stereoWidth: 0.4 }),
  scene("hex-fm-bells", "Hex FM bells", { tilingType: 4, soundMode: "fm", fmIndex: 6.5, baseFrequency: 220, pitchRange: 4.5, latticePitchSource: "incidence", density: 0.7, lineAngle: 60, speed: 0.22 }, { curves: [0.5, -0.4, 0.3, 0.2, -0.3] }),
  scene("shepard-staircase", "Shepard staircase", { tilingType: 29, soundMode: "shepard", latticePitchSource: "along", pitchRange: 6, speed: 0.2, density: 0.62, lineAngle: 20, patternAngle: -25 }),
  scene("kite-pm-glass", "Kite PM glass", { tilingType: 44, soundMode: "pm", pmIndex: 6, baseFrequency: 330, lineAngle: 135, patternAngle: 30, stereoWidth: 1, latticePitchSource: "orientation", contactLevel: 0.28 }, { curves: [0.35, -0.5, 0.45, -0.2] }),
  scene("ping-pong-weave", "Ping-pong weave", { tilingType: 61, motionMode: "ping-pong", traversalDirection: -1, speed: 0.35, density: 0.8, baseFrequency: 147, pitchRange: 3, lineAngle: 45, soundMode: "fm", fmIndex: 2 }),
  scene("lattice-kit", "Lattice kit", { mode: "lattice-drums", tilingType: 20, speed: 0.18 }),
  scene("triangle-rattle", "Triangle rattle", { mode: "lattice-drums", tilingType: 71, strikeLimit: 12, density: 0.85, speed: 1.2, pitchDepth: 18, characterDepth: 1, latticeMappingMode: "incidence-density", lineAngle: 30 }),
  scene("slow-tom-field", "Slow tom field", { mode: "lattice-drums", tilingType: 12, strikeLimit: 3, density: 0.25, speed: 0.08, pitchDepth: 4, latticeMappingMode: "position-grid", characterDepth: 0.35 }),
  scene("tile-color-groove", "Tile color groove", { mode: "lattice-drums", tilingType: 3, latticeMappingMode: "tile-color-pair", strikeLimit: 8, speed: 0.5, density: 0.6, pitchDepth: 8, patternAngle: 60, motionMode: "ping-pong" }),
  scene("spiral-bloom", "Spiral bloom", { mode: "spiral", tilingType: 20 }),
  scene("fibonacci-pad", "Fibonacci pad", { mode: "spiral", tilingType: 5, spiralA: 3, spiralB: 5, sizeCoupling: true, readerTurns: 3, density: 0.45, baseFrequency: 82, pitchRange: 3, contactLevel: 0.5, speed: 0.09 }),
  scene("spiral-sparks-fm", "Spiral sparks FM", { mode: "spiral", tilingType: 43, timePath: "angle", soundMode: "fm", fmIndex: 8, baseFrequency: 165, readerTurns: 5, spiralA: -2, spiralB: 7, spiralPitchSource: "shape", speed: 0.4, density: 0.7 }),
  scene("deep-zoom-shepard", "Deep zoom Shepard", { mode: "spiral", tilingType: 78, timePath: "spiral", soundMode: "shepard", loopPhase: 0.5, spiralA: 1, spiralB: 8, readerTurns: 1.2, spiralPitchSource: "radius", speed: 0.15, pitchRange: 5 }),
  scene("spiral-drum-whirl", "Spiral drum whirl", { mode: "spiral-drums", tilingType: 20, strikeLimit: 8, speed: 0.3, readerTurns: 3 }),
  scene("spiral-gong-ring", "Spiral gong ring", { mode: "spiral-drums", tilingType: 33, spiralMappingMode: "shape-angle", density: 0.2, strikeLimit: 2, speed: 0.07, pitchDepth: 20, characterDepth: 0.95, timePath: "angle", spiralA: 2, spiralB: -3 }),
]);

export function randomizeTesselationPreset(current, random = Math.random) {
  presetStateKey(current);
  if (!TESSELATION_MODE_IDS.includes(current?.mode)) throw new TypeError("Invalid Tesselation mode");
  const rng = presetRandom(random);
  const tile = randomGuardedTile(rng);
  const next = {
    mode: current.mode, ...tile,
    traversalDirection: rng.unit() < 0.3 ? -1 : 1, motionMode: rng.unit() < 0.4 ? "ping-pong" : "loop",
    timePath: rng.pick(TESSELATION_TIME_PATHS), sizeCoupling: rng.unit() < 0.5, soundMode: rng.pick(TESSELATION_SOUND_MODES),
    latticePitchSource: rng.pick(TESSELATION_LATTICE_PITCH_SOURCES), spiralPitchSource: rng.pick(TESSELATION_SPIRAL_PITCH_SOURCES),
    latticeMappingMode: rng.pick(TESSELATION_LATTICE_MAPPINGS), spiralMappingMode: rng.pick(TESSELATION_SPIRAL_MAPPINGS),
    density: snap("density", rng.between(0.15, 0.9)), speed: snap("speed", 0.04 + rng.unit() ** 2 * 1.4),
    lineAngle: snap("lineAngle", rng.between(0, 180)), patternAngle: snap("patternAngle", rng.between(-90, 90)),
    readerTurns: snap("readerTurns", rng.between(0.5, 5)), spiralA: snap("spiralA", rng.integer(-5, 5)),
    spiralB: snap("spiralB", rng.integer(-7, 7)), loopPhase: snap("loopPhase", rng.unit()),
    baseFrequency: snap("baseFrequency", 40 * 8 ** rng.unit()), pitchRange: snap("pitchRange", rng.between(1, 6)),
    contactLevel: snap("contactLevel", rng.between(0.18, 0.7)), stereoWidth: snap("stereoWidth", rng.unit()),
    fmIndex: snap("fmIndex", rng.between(0.5, 10)), pmIndex: snap("pmIndex", rng.between(0.5, 8)),
    pitchDepth: snap("pitchDepth", rng.between(2, 24)), characterDepth: snap("characterDepth", rng.between(0.15, 1)),
    strikeLimit: snap("strikeLimit", rng.integer(2, 14)),
  };
  return validateTesselationPreset(next);
}
