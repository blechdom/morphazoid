import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { HYPER_DRUM_MAPPING_MODES } from "./hyper-drum-machine.js";

const SHAPE_TYPES = Object.freeze(["tesseract", "hypersphere", "hyperpyramid", "klein"]);
const MAPPING_IDS = Object.freeze(HYPER_DRUM_MAPPING_MODES.map(mode => mode.id));
const AXES = Object.freeze(["XW", "YW", "ZW"]);
const SCALE_KEYS = Object.freeze(["hyperScaleX", "hyperScaleY", "hyperScaleZ", "hyperScaleW"]);
const PLAYING_KEYS = Object.freeze(AXES.map(axis => `rotation${axis}Playing`));
const SPEED_KEYS = Object.freeze(AXES.map(axis => `rotation${axis}Speed`));

export const HYPER_DRUM_PRESET_KEYS = Object.freeze([
  "shapeType", ...SCALE_KEYS, ...PLAYING_KEYS, ...SPEED_KEYS,
  "speed", "traversalDirection", "motionMode", "playing",
  "mappingMode", "subdivisions", "pitchDepth", "characterDepth", "strikeLimit",
]);

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const quantize = (value, min, max, step, fallback) => {
  const clamped = Math.min(max, Math.max(min, finite(value, fallback)));
  return Number(Math.min(max, min + Math.round((clamped - min) / step) * step).toFixed(6));
};
const integer = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.round(finite(value, fallback))));
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function sanitizeHyperDrumPreset(raw = {}) {
  const result = {
    shapeType: oneOf(raw.shapeType, SHAPE_TYPES, "tesseract"),
    speed: quantize(raw.speed, 0.01, 4, 0.01, 0.1),
    traversalDirection: Number(raw.traversalDirection) < 0 ? -1 : 1,
    motionMode: oneOf(raw.motionMode, ["loop", "pingpong"], "loop"),
    playing: Boolean(raw.playing),
    mappingMode: oneOf(raw.mappingMode, MAPPING_IDS, MAPPING_IDS[0]),
    subdivisions: integer(raw.subdivisions, 1, 16, 2),
    pitchDepth: integer(raw.pitchDepth, 0, 24, 12),
    characterDepth: quantize(raw.characterDepth, 0, 1, 0.01, 0.7),
    strikeLimit: integer(raw.strikeLimit, 1, 16, 6),
  };
  for (const key of SCALE_KEYS) result[key] = quantize(raw[key], 0.5, 1.5, 0.01, 1);
  for (const key of PLAYING_KEYS) result[key] = Boolean(raw[key]);
  for (const key of SPEED_KEYS) result[key] = quantize(raw[key], -0.5, 0.5, 0.01, 0);
  return result;
}

export const captureHyperDrumPreset = sanitizeHyperDrumPreset;

export function validateHyperDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(sanitizeHyperDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Hyper Drum Machine preset");
  }
  return snapshot;
}

const BASE = Object.freeze({
  shapeType: "tesseract", speed: 0.1, traversalDirection: 1, motionMode: "loop", playing: true,
  mappingMode: "axis-depth", subdivisions: 2, pitchDepth: 12, characterDepth: 0.7, strikeLimit: 6,
  rotationXWSpeed: 0.06, rotationYWSpeed: 0.04, rotationZWSpeed: -0.02,
});
const scene = (id, label, overrides) => Object.freeze({
  id, label, snapshot: Object.freeze(sanitizeHyperDrumPreset({ ...BASE, ...overrides })),
});

export const HYPER_DRUM_FULL_PRESETS = Object.freeze([
  scene("tesseract-turn", "Tesseract turn", { rotationXWPlaying: true }),
  scene("hypersphere-bloom", "Hypersphere bloom", {
    shapeType: "hypersphere", speed: 0.18, rotationYWPlaying: true, rotationYWSpeed: 0.12, mappingMode: "projected-position", subdivisions: 3, pitchDepth: 8,
  }),
  scene("pyramid-prism", "Hyperpyramid prism", {
    shapeType: "hyperpyramid", motionMode: "pingpong", speed: 0.25, rotationXWPlaying: true, rotationZWPlaying: true,
    mappingMode: "w-incidence", subdivisions: 4, strikeLimit: 8,
  }),
  scene("klein-loop", "Klein loop", {
    shapeType: "klein", speed: 0.07, rotationYWPlaying: true, rotationYWSpeed: -0.08, subdivisions: 5, characterDepth: 0.9, pitchDepth: 16,
  }),
  scene("flat-tesseract", "Flat tesseract", {
    hyperScaleX: 1.5, hyperScaleY: 0.5, hyperScaleZ: 1.2, hyperScaleW: 0.8, speed: 0.35, mappingMode: "projected-position",
    rotationZWPlaying: true, rotationZWSpeed: 0.15,
  }),
  scene("w-stretch", "W stretch", {
    shapeType: "hyperpyramid", hyperScaleW: 1.5, hyperScaleX: 0.7, playing: false, rotationXWPlaying: true, rotationXWSpeed: 0.2,
    rotationYWPlaying: true, rotationYWSpeed: -0.1, mappingMode: "w-incidence", subdivisions: 2,
  }),
  scene("slow-hypersphere", "Slow hypersphere", {
    shapeType: "hypersphere", speed: 0.02, traversalDirection: -1, subdivisions: 10, pitchDepth: 24, strikeLimit: 3, characterDepth: 0.85,
  }),
  scene("klein-rattle", "Klein rattle", {
    shapeType: "klein", speed: 1.1, strikeLimit: 12, subdivisions: 1, pitchDepth: 2, characterDepth: 0.25,
    rotationXWPlaying: true, rotationXWSpeed: 0.4, mappingMode: "projected-position",
  }),
  scene("tall-tesseract", "Tall tesseract", {
    hyperScaleX: 0.6, hyperScaleY: 1.5, hyperScaleZ: 0.6, motionMode: "pingpong", speed: 0.15, rotationYWPlaying: true,
    mappingMode: "w-incidence", subdivisions: 6,
  }),
  scene("tri-axis-spin", "Tri-axis spin", {
    playing: false, rotationXWPlaying: true, rotationXWSpeed: 0.09, rotationYWPlaying: true, rotationYWSpeed: -0.17,
    rotationZWPlaying: true, rotationZWSpeed: 0.23, shapeType: "hypersphere", mappingMode: "projected-position",
  }),
  scene("pyramid-needle", "Pyramid needle", {
    shapeType: "hyperpyramid", hyperScaleX: 0.5, hyperScaleZ: 0.5, hyperScaleY: 1.5, speed: 0.8, traversalDirection: -1,
    rotationZWPlaying: true, rotationZWSpeed: -0.3, strikeLimit: 4, pitchDepth: 20, characterDepth: 0.15,
  }),
  scene("wide-klein", "Wide Klein", {
    shapeType: "klein", hyperScaleX: 1.5, hyperScaleZ: 1.4, hyperScaleW: 0.6, speed: 0.12, rotationYWPlaying: true,
    mappingMode: "w-incidence", subdivisions: 3, strikeLimit: 9,
  }),
  scene("quiet-cell", "Quiet cell", {
    speed: 0.04, hyperScaleX: 0.8, hyperScaleY: 0.8, hyperScaleZ: 0.8, subdivisions: 8, pitchDepth: 4, characterDepth: 0.3, strikeLimit: 2,
    rotationZWPlaying: true, rotationZWSpeed: 0.03,
  }),
]);

export function randomizeHyperDrumPreset(current, random = Math.random) {
  validateHyperDrumPreset(current);
  const rng = presetRandom(random);
  const draft = {
    shapeType: rng.pick(SHAPE_TYPES),
    speed: 0.03 * 80 ** rng.unit(),
    traversalDirection: rng.pick([1, -1]),
    motionMode: rng.pick(["loop", "pingpong"]),
    playing: rng.unit() < 0.8,
    mappingMode: rng.pick(MAPPING_IDS),
    subdivisions: rng.integer(1, 10),
    pitchDepth: rng.integer(0, 24),
    characterDepth: rng.unit(),
    strikeLimit: rng.integer(2, 12),
  };
  for (const key of SCALE_KEYS) draft[key] = rng.between(0.5, 1.5);
  for (const key of PLAYING_KEYS) draft[key] = rng.unit() < 0.45;
  for (const key of SPEED_KEYS) draft[key] = rng.between(-0.4, 0.4);
  if (!draft.playing && !PLAYING_KEYS.some(key => draft[key])) draft.playing = true;
  return validateHyperDrumPreset(sanitizeHyperDrumPreset(draft));
}
