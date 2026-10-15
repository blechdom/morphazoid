import { CAMERA_SCALE_LIMITS, STRIPED_STAIRCASE_VIEWS, cameraFromView, viewById } from "./striped-staircase.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const STAIRCASE_VIEW_IDS = Object.freeze(STRIPED_STAIRCASE_VIEWS.map(view => view.id));
export const STAIRCASE_MOTION_MODES = Object.freeze(["steps", "slide"]);
export const STAIRCASE_TIMING_MODES = Object.freeze(["equal", "geometry", "dive"]);
export const STAIRCASE_PALETTES = Object.freeze(["glass", "ember", "ultraviolet", "ink"]);
export const STAIRCASE_PLAYBACK_MODES = Object.freeze(["fill", "edge", "drums", "ensemble"]);
export const STAIRCASE_POLARITIES = Object.freeze(["white", "black"]);
export const STAIRCASE_COLOR_SOUND_MODES = Object.freeze(["manual", "follow", "shepard", "ouroboros", "rattlesnake", "decomposition", "ink"]);
export const STAIRCASE_NUMBER_SPECS = Object.freeze({
  speed: [0.005, 0.12, 0.001], diveOctaves: [1, 10, 0.25], startIteration: [2, 48, 1], maxIterations: [80, 360, 4],
  steps: [8, 36, 1], stripePeriod: [1, 18, 0.1], edgeSoftness: [0.1, 4, 0.1], baseFrequency: [36, 220, 1],
  pitchRange: [0, 6, 0.1], noiseAmount: [0, 1, 0.01], durationScale: [0.1, 1.5, 0.05], stereoSpread: [0, 1, 0.01],
  massLevel: [0, 1, 0.01], contourLevel: [0, 1, 0.01], rhythmLevel: [0, 1, 0.01], microLevel: [0, 1, 0.01],
});
export const STAIRCASE_PRESET_KEYS = Object.freeze([
  "viewId", "camera", "motionMode", "timingMode", "palette", "playbackMode", "soundPolarity", "colorSoundMode",
  ...Object.keys(STAIRCASE_NUMBER_SPECS),
]);

const snap = (key, value) => {
  const [min, max, step] = STAIRCASE_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};
const cameraOf = camera => ({ centerX: camera.centerX, centerY: camera.centerY, scale: camera.scale });

export function captureStaircasePreset(state, diveAnchorCamera) {
  return {
    viewId: state.selectedViewId, camera: cameraOf(state.timingMode === "dive" ? diveAnchorCamera : state.camera),
    motionMode: state.motionMode, timingMode: state.timingMode, palette: state.palette, playbackMode: state.playbackMode,
    soundPolarity: state.soundPolarity, colorSoundMode: state.colorSoundMode,
    speed: state.speed, diveOctaves: state.diveOctaves,
    startIteration: state.settings.startIteration, maxIterations: state.settings.maxIterations,
    steps: state.settings.steps, stripePeriod: state.settings.stripePeriod, edgeSoftness: state.settings.edgeSoftness,
    ...Object.fromEntries(["baseFrequency", "pitchRange", "noiseAmount", "durationScale", "stereoSpread", "massLevel", "contourLevel", "rhythmLevel", "microLevel"]
      .map(key => [key, state[key]])),
  };
}

export function validateStaircasePreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Striped Staircase preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== STAIRCASE_PRESET_KEYS.length) bad();
  const oneOf = (value, list) => list.includes(value) || bad();
  oneOf(snapshot.viewId, STAIRCASE_VIEW_IDS);
  oneOf(snapshot.motionMode, STAIRCASE_MOTION_MODES);
  oneOf(snapshot.timingMode, STAIRCASE_TIMING_MODES);
  oneOf(snapshot.palette, STAIRCASE_PALETTES);
  oneOf(snapshot.playbackMode, STAIRCASE_PLAYBACK_MODES);
  oneOf(snapshot.soundPolarity, STAIRCASE_POLARITIES);
  oneOf(snapshot.colorSoundMode, STAIRCASE_COLOR_SOUND_MODES);
  for (const [key, [min, max]] of Object.entries(STAIRCASE_NUMBER_SPECS)) {
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  if (snapshot.maxIterations < snapshot.startIteration + 2) bad();
  const camera = snapshot.camera;
  if (!camera || Object.keys(camera).length !== 3 || [camera.centerX, camera.centerY, camera.scale].some(value => typeof value !== "number")
    || Math.abs(camera.centerX) > 3 || Math.abs(camera.centerY) > 3
    || camera.scale < CAMERA_SCALE_LIMITS.minimum || camera.scale > CAMERA_SCALE_LIMITS.maximum) bad();
  return snapshot;
}

const DEFAULTS = Object.freeze({
  viewId: "seahorse", motionMode: "steps", timingMode: "equal", palette: "glass", playbackMode: "fill", soundPolarity: "white",
  colorSoundMode: "manual", speed: 0.035, diveOctaves: 6, startIteration: 12, maxIterations: 260, steps: 24,
  stripePeriod: 7, edgeSoftness: 0.9, baseFrequency: 73, pitchRange: 3, noiseAmount: 0.55, durationScale: 0.55,
  stereoSpread: 0.85, massLevel: 0.9, contourLevel: 0.55, rhythmLevel: 0.7, microLevel: 0.45,
});

const scene = (id, label, patch = {}) => {
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = {
    ...merged, camera: cameraOf(cameraFromView(viewById(merged.viewId))),
    ...Object.fromEntries(Object.keys(STAIRCASE_NUMBER_SPECS).map(key => [key, snap(key, merged[key])])),
  };
  validateStaircasePreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const STAIRCASE_FULL_PRESETS = Object.freeze([
  scene("seahorse-glass", "Seahorse glass"),
  scene("whole-set-pulse", "Whole set pulse", { viewId: "overview", steps: 16, startIteration: 6, stripePeriod: 4, baseFrequency: 55, pitchRange: 2, motionMode: "slide", speed: 0.05 }),
  scene("cusp-ember-edges", "Cusp ember edges", { viewId: "cardioid-cusp", palette: "ember", playbackMode: "edge", colorSoundMode: "rattlesnake", noiseAmount: 0.8, contourLevel: 0.9, baseFrequency: 110, steps: 20 }),
  scene("elephant-ouroboros", "Elephant ouroboros", { viewId: "elephant-broad", palette: "ultraviolet", colorSoundMode: "ouroboros", stripePeriod: 3.5, steps: 30, startIteration: 18, pitchRange: 4, baseFrequency: 92, speed: 0.05 }),
  scene("archive-ensemble", "Archive ensemble", { viewId: "elephant-archive", playbackMode: "ensemble", colorSoundMode: "decomposition", massLevel: 0.7, contourLevel: 0.7, rhythmLevel: 0.8, microLevel: 0.7, steps: 26, maxIterations: 300 }),
  scene("dive-gallery", "Dive gallery", { viewId: "seahorse-gallery", timingMode: "dive", diveOctaves: 4, palette: "glass", colorSoundMode: "shepard", speed: 0.025, maxIterations: 340, pitchRange: 4.5, baseFrequency: 80 }),
  scene("double-spiral-drums", "Double spiral drums", { viewId: "double-spiral", playbackMode: "drums", palette: "ultraviolet", rhythmLevel: 1, durationScale: 0.25, noiseAmount: 0.7, steps: 32, stripePeriod: 2.5, speed: 0.08, maxIterations: 360, baseFrequency: 130 }),
  scene("spiral-arms-slide", "Spiral arms slide", { viewId: "spiral", motionMode: "slide", timingMode: "geometry", palette: "ember", colorSoundMode: "follow", stripePeriod: 10, edgeSoftness: 2, speed: 0.04 }),
  scene("mini-set-ink", "Mini set ink", { viewId: "needle", palette: "ink", colorSoundMode: "ink", soundPolarity: "black", playbackMode: "fill", stripePeriod: 5, steps: 14, startIteration: 24, baseFrequency: 62, pitchRange: 3.5, edgeSoftness: 0.4 }),
  scene("island-field-chimes", "Island field chimes", { viewId: "island-field", playbackMode: "drums", durationScale: 0.9, pitchRange: 5, baseFrequency: 160, palette: "ultraviolet", steps: 22, rhythmLevel: 0.9, noiseAmount: 0.25, stereoSpread: 1 }),
  scene("period-three-geometry", "Period-three geometry", { viewId: "period-three", timingMode: "geometry", colorSoundMode: "shepard", steps: 28, stripePeriod: 8, edgeSoftness: 1.5, speed: 0.07, pitchRange: 5, baseFrequency: 48 }),
  scene("dendrite-needle-edge", "Dendrite needle edge", { viewId: "dendrite-needle", playbackMode: "edge", palette: "ember", colorSoundMode: "manual", contourLevel: 1, massLevel: 0.2, noiseAmount: 0.3, maxIterations: 320, steps: 18, baseFrequency: 200, pitchRange: 2 }),
  scene("airplane-wide-sweep", "Airplane wide sweep", { viewId: "airplane", motionMode: "slide", playbackMode: "ensemble", colorSoundMode: "decomposition", stripePeriod: 12, steps: 12, startIteration: 8, speed: 0.1, stereoSpread: 1, baseFrequency: 70 }),
  scene("antenna-filament-dive", "Antenna filament dive", { viewId: "antenna", timingMode: "dive", diveOctaves: 7, colorSoundMode: "ouroboros", palette: "glass", stripePeriod: 6, steps: 24, speed: 0.02, maxIterations: 360, baseFrequency: 100, noiseAmount: 0.4 }),
]);

export function randomizeStaircasePreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const viewId = rng.pick(STAIRCASE_VIEW_IDS);
  const base = cameraFromView(viewById(viewId));
  const startIteration = snap("startIteration", rng.between(4, 36));
  const next = {
    viewId,
    camera: {
      scale: Number(Math.min(CAMERA_SCALE_LIMITS.maximum, Math.max(CAMERA_SCALE_LIMITS.minimum, base.scale * rng.between(0.6, 1.5))).toPrecision(9)),
      centerX: Number((base.centerX + rng.between(-0.3, 0.3) * base.scale).toPrecision(12)),
      centerY: Number((base.centerY + rng.between(-0.3, 0.3) * base.scale).toPrecision(12)),
    },
    motionMode: rng.pick(STAIRCASE_MOTION_MODES), timingMode: rng.pick(STAIRCASE_TIMING_MODES),
    palette: rng.pick(STAIRCASE_PALETTES), playbackMode: rng.pick(STAIRCASE_PLAYBACK_MODES),
    soundPolarity: rng.unit() < 0.25 ? "black" : "white", colorSoundMode: rng.pick(STAIRCASE_COLOR_SOUND_MODES),
    speed: snap("speed", 0.01 + rng.unit() ** 2 * 0.1), diveOctaves: snap("diveOctaves", rng.between(2, 8)),
    startIteration, maxIterations: snap("maxIterations", rng.between(Math.max(120, startIteration + 8), 340)),
    steps: snap("steps", rng.between(10, 34)), stripePeriod: snap("stripePeriod", rng.between(2, 14)),
    edgeSoftness: snap("edgeSoftness", rng.between(0.2, 3)), baseFrequency: snap("baseFrequency", 40 * 4 ** rng.unit()),
    pitchRange: snap("pitchRange", rng.between(0.5, 5.5)), noiseAmount: snap("noiseAmount", rng.unit()),
    durationScale: snap("durationScale", rng.between(0.15, 1.3)), stereoSpread: snap("stereoSpread", rng.between(0.2, 1)),
    massLevel: snap("massLevel", rng.between(0.2, 1)), contourLevel: snap("contourLevel", rng.between(0.2, 1)),
    rhythmLevel: snap("rhythmLevel", rng.between(0.2, 1)), microLevel: snap("microLevel", rng.between(0.15, 1)),
  };
  return validateStaircasePreset(next);
}
