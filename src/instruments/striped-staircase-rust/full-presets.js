import { CAMERA_SCALE_LIMITS, STRIPED_STAIRCASE_VIEWS, cameraFromView, viewById } from "../striped-staircase/striped-staircase.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const STUDIES_VIEW_IDS = Object.freeze(STRIPED_STAIRCASE_VIEWS.map(view => view.id));
export const STUDIES_NUMBER_SPECS = Object.freeze({
  speed: [0.005, 0.5, 0.001], baseFrequency: [30, 440, 1], brightness: [0, 1, 0.01], body: [0, 1, 0.01],
  startIteration: [0, 100, 1], maxIterations: [32, 384, 1], steps: [4, 48, 1], stripePeriod: [1, 24, 0.1],
});
export const STUDIES_PRESET_KEYS = Object.freeze(["viewId", "camera", "mode", "palette", ...Object.keys(STUDIES_NUMBER_SPECS)]);

const snap = (key, value) => {
  const [min, max, step] = STUDIES_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};
const cameraOf = camera => ({ centerX: camera.centerX, centerY: camera.centerY, scale: camera.scale });

export function captureStudiesPreset(state) {
  return {
    viewId: state.view, camera: cameraOf(state.camera), mode: state.mode, palette: state.palette,
    speed: state.speed, baseFrequency: state.baseFrequency, brightness: state.brightness, body: state.body,
    startIteration: state.settings.startIteration, maxIterations: state.settings.maxIterations,
    steps: state.settings.steps, stripePeriod: state.settings.stripePeriod,
  };
}

export function validateStudiesPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Staircase Studies preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== STUDIES_PRESET_KEYS.length) bad();
  if (!STUDIES_VIEW_IDS.includes(snapshot.viewId)) bad();
  if (!Number.isInteger(snapshot.mode) || snapshot.mode < 0 || snapshot.mode > 3) bad();
  if (!Number.isInteger(snapshot.palette) || snapshot.palette < 0 || snapshot.palette > 3) bad();
  for (const [key, [min, max]] of Object.entries(STUDIES_NUMBER_SPECS)) {
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
  viewId: "seahorse", mode: 2, palette: 3, speed: 0.035, baseFrequency: 73, brightness: 0.55, body: 0.35,
  startIteration: 12, maxIterations: 260, steps: 24, stripePeriod: 7,
});

const scene = (id, label, patch = {}) => {
  const merged = { ...DEFAULTS, ...patch };
  const snapshot = {
    ...merged, camera: cameraOf(cameraFromView(viewById(merged.viewId))),
    ...Object.fromEntries(Object.keys(STUDIES_NUMBER_SPECS).map(key => [key, snap(key, merged[key])])),
  };
  validateStudiesPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const STUDIES_FULL_PRESETS = Object.freeze([
  scene("seahorse-ink-rhythm", "Seahorse ink rhythm"),
  scene("overview-slow-contour", "Overview slow contour", { viewId: "overview", mode: 0, palette: 0, speed: 0.02, baseFrequency: 55, brightness: 0.4, steps: 16, stripePeriod: 4 }),
  scene("cusp-ember-harmonics", "Cusp ember harmonics", { viewId: "cardioid-cusp", mode: 1, palette: 1, baseFrequency: 110, brightness: 0.85, steps: 20, speed: 0.05 }),
  scene("elephant-glass-body", "Elephant glass body", { viewId: "elephant-broad", mode: 3, palette: 0, baseFrequency: 92, brightness: 0.6, body: 0.8, stripePeriod: 3.5, steps: 30, startIteration: 18 }),
  scene("archive-fine-rhythm", "Archive fine rhythm", { viewId: "elephant-archive", mode: 2, palette: 2, steps: 40, stripePeriod: 2, maxIterations: 340, baseFrequency: 130, body: 0.15, speed: 0.06 }),
  scene("gallery-long-release", "Gallery long release", { viewId: "seahorse-gallery", mode: 2, palette: 0, body: 0.95, speed: 0.015, baseFrequency: 80, stripePeriod: 12, steps: 14 }),
  scene("double-spiral-rattle", "Double spiral rattle", { viewId: "double-spiral", mode: 2, palette: 2, speed: 0.12, body: 0.05, baseFrequency: 160, steps: 44, stripePeriod: 2.4, maxIterations: 360 }),
  scene("spiral-sub-contour", "Spiral sub contour", { viewId: "spiral", mode: 0, palette: 1, baseFrequency: 38, brightness: 0.25, speed: 0.03, stripePeriod: 10 }),
  scene("needle-bright-harmonics", "Needle bright harmonics", { viewId: "needle", mode: 1, palette: 3, baseFrequency: 220, brightness: 1, startIteration: 28, steps: 12, stripePeriod: 5 }),
  scene("island-resonant-chimes", "Island resonant chimes", { viewId: "island-field", mode: 3, palette: 2, baseFrequency: 300, brightness: 0.7, body: 0.6, steps: 22, speed: 0.08 }),
  scene("period-three-bass-rhythm", "Period three bass rhythm", { viewId: "period-three", mode: 2, palette: 1, baseFrequency: 45, brightness: 0.3, body: 0.5, steps: 28, stripePeriod: 8, speed: 0.07 }),
  scene("dendrite-sharp-contour", "Dendrite sharp contour", { viewId: "dendrite-needle", mode: 0, palette: 3, brightness: 1, baseFrequency: 200, maxIterations: 320, steps: 18, speed: 0.1 }),
  scene("airplane-wide-body", "Airplane wide body", { viewId: "airplane", mode: 3, palette: 0, stripePeriod: 18, steps: 8, startIteration: 6, body: 1, baseFrequency: 70, speed: 0.04 }),
  scene("antenna-dense-harmonics", "Antenna dense harmonics", { viewId: "antenna", mode: 1, palette: 2, steps: 46, stripePeriod: 1.5, maxIterations: 380, brightness: 0.9, baseFrequency: 100, speed: 0.02 }),
]);

export function randomizeStudiesPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const viewId = rng.pick(STUDIES_VIEW_IDS);
  const base = cameraFromView(viewById(viewId));
  const startIteration = snap("startIteration", rng.between(2, 40));
  const scale = Math.min(CAMERA_SCALE_LIMITS.maximum, Math.max(CAMERA_SCALE_LIMITS.minimum, base.scale * rng.between(0.6, 1.5)));
  return validateStudiesPreset({
    viewId,
    camera: {
      scale: Number(scale.toPrecision(9)),
      centerX: Number((base.centerX + rng.between(-0.3, 0.3) * base.scale).toPrecision(12)),
      centerY: Number((base.centerY + rng.between(-0.3, 0.3) * base.scale).toPrecision(12)),
    },
    mode: rng.integer(0, 3), palette: rng.integer(0, 3),
    speed: snap("speed", 0.01 + rng.unit() ** 2 * 0.2), baseFrequency: snap("baseFrequency", 36 * 8 ** rng.unit()),
    brightness: snap("brightness", rng.unit()), body: snap("body", rng.unit()),
    startIteration, maxIterations: snap("maxIterations", rng.between(Math.max(120, startIteration + 8), 380)),
    steps: snap("steps", rng.between(6, 46)), stripePeriod: snap("stripePeriod", rng.between(1.2, 20)),
  });
}
