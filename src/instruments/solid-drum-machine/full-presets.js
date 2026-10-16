import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { SOLID_DRUM_MAPPING_MODES } from "./solid-drum-machine.js";

const SOLID_TYPES = Object.freeze(["cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus"]);
const MAPPING_IDS = Object.freeze(SOLID_DRUM_MAPPING_MODES.map(mode => mode.id));
const MOTION_FLAGS = Object.freeze([
  "rotationXPlaying", "rotationYPlaying", "rotationZPlaying", "planeYawPlaying", "planePitchPlaying",
]);
const SPEED_KEYS = Object.freeze([
  "rotationXSpeed", "rotationYSpeed", "rotationZSpeed", "planeYawSpeed", "planePitchSpeed",
]);

export const SOLID_DRUM_PRESET_KEYS = Object.freeze([
  "solidType", "formScaleX", "formScaleY", "formScaleZ", "formSkewX", "formSkewZ",
  ...MOTION_FLAGS, ...SPEED_KEYS,
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

export function sanitizeSolidDrumPreset(raw = {}) {
  const result = {
    solidType: oneOf(raw.solidType, SOLID_TYPES, "cube"),
    speed: quantize(raw.speed, 0.01, 4, 0.01, 0.12),
    traversalDirection: Number(raw.traversalDirection) < 0 ? -1 : 1,
    motionMode: oneOf(raw.motionMode, ["loop", "pingpong"], "loop"),
    playing: Boolean(raw.playing),
    mappingMode: oneOf(raw.mappingMode, MAPPING_IDS, MAPPING_IDS[0]),
    subdivisions: integer(raw.subdivisions, 1, 16, 2),
    pitchDepth: integer(raw.pitchDepth, 0, 24, 12),
    characterDepth: quantize(raw.characterDepth, 0, 1, 0.01, 0.7),
    strikeLimit: integer(raw.strikeLimit, 1, 12, 6),
  };
  for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) result[key] = quantize(raw[key], 0.5, 1.6, 0.01, 1);
  for (const key of ["formSkewX", "formSkewZ"]) result[key] = quantize(raw[key], -0.7, 0.7, 0.01, 0);
  for (const key of MOTION_FLAGS) result[key] = Boolean(raw[key]);
  for (const key of SPEED_KEYS) result[key] = quantize(raw[key], -0.5, 0.5, 0.01, 0);
  return result;
}

export const captureSolidDrumPreset = sanitizeSolidDrumPreset;

export function validateSolidDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(sanitizeSolidDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Solid Drum Machine preset");
  }
  return snapshot;
}

const BASE = Object.freeze({
  solidType: "cube", speed: 0.12, traversalDirection: 1, motionMode: "loop", playing: true,
  mappingMode: "edge-axis", subdivisions: 2, pitchDepth: 12, characterDepth: 0.7, strikeLimit: 6,
  rotationXSpeed: 0.03, rotationYSpeed: 0.08, rotationZSpeed: 0.02, planeYawSpeed: 0.04, planePitchSpeed: 0.03,
});
const scene = (id, label, overrides) => Object.freeze({
  id, label, snapshot: Object.freeze(sanitizeSolidDrumPreset({ ...BASE, ...overrides })),
});

export const SOLID_DRUM_FULL_PRESETS = Object.freeze([
  scene("spinning-cube", "Spinning cube", { rotationYPlaying: true }),
  scene("slice-pyramid", "Slice pyramid", {
    solidType: "pyramid", speed: 0.2, planeYawPlaying: true, planeYawSpeed: 0.06, mappingMode: "position-grid", subdivisions: 3, pitchDepth: 9,
  }),
  scene("octahedron-weave", "Octahedron weave", {
    solidType: "octahedron", motionMode: "pingpong", speed: 0.15, rotationXPlaying: true, rotationZPlaying: true,
    mappingMode: "incidence-depth", subdivisions: 4, strikeLimit: 8,
  }),
  scene("prism-sweep", "Prism sweep", {
    solidType: "prism", formScaleY: 1.4, formSkewX: 0.3, speed: 0.3, planePitchPlaying: true,
  }),
  scene("cone-drift", "Cone drift", {
    solidType: "cone", formScaleX: 1.5, playing: false, rotationYPlaying: true, rotationYSpeed: 0.04, rotationZPlaying: true,
    rotationZSpeed: 0.11, subdivisions: 6,
  }),
  scene("cylinder-drum", "Cylinder drum", {
    solidType: "cylinder", formScaleX: 1.4, formScaleY: 0.7, formScaleZ: 1.4, speed: 0.5, mappingMode: "position-grid",
    strikeLimit: 5, pitchDepth: 3, characterDepth: 0.4,
  }),
  scene("sphere-globe", "Sphere globe", {
    solidType: "sphere", speed: 0.09, rotationYPlaying: true, rotationYSpeed: 0.2, planeYawPlaying: true, planeYawSpeed: -0.15,
    mappingMode: "incidence-depth", subdivisions: 1, pitchDepth: 20, characterDepth: 1,
  }),
  scene("torus-ring", "Torus ring", {
    solidType: "torus", traversalDirection: -1, speed: 0.6, planeYawPlaying: true, planeYawSpeed: 0.12, planePitchPlaying: true,
    planePitchSpeed: -0.09, rotationXPlaying: true, rotationXSpeed: -0.2, mappingMode: "position-grid", subdivisions: 8, strikeLimit: 10,
  }),
  scene("squashed-cube", "Squashed cube", {
    formScaleX: 0.5, formScaleY: 1.6, formScaleZ: 0.8, formSkewX: -0.5, formSkewZ: 0.4, motionMode: "pingpong", speed: 0.25,
    rotationZPlaying: true, subdivisions: 5,
  }),
  scene("leaning-pyramid", "Leaning pyramid", {
    solidType: "pyramid", formScaleX: 1.2, formScaleY: 0.8, formScaleZ: 1.5, formSkewX: 0.7, formSkewZ: -0.6, speed: 0.08,
    planePitchPlaying: true, planePitchSpeed: 0.1, rotationYPlaying: true, rotationYSpeed: 0.05, mappingMode: "incidence-depth", subdivisions: 3,
  }),
  scene("needle-cone", "Needle cone", {
    solidType: "cone", formScaleX: 0.5, formScaleY: 1.6, formScaleZ: 0.5, speed: 1.2, planeYawPlaying: true, planeYawSpeed: 0.3,
    strikeLimit: 4, pitchDepth: 14, characterDepth: 0.2,
  }),
  scene("slow-octahedron", "Slow octahedron", {
    solidType: "octahedron", speed: 0.02, subdivisions: 12, pitchDepth: 24, strikeLimit: 3, characterDepth: 0.85,
  }),
  scene("tumbling-prism", "Tumbling prism", {
    solidType: "prism", playing: false, rotationXPlaying: true, rotationXSpeed: 0.07, rotationYPlaying: true, rotationYSpeed: -0.13,
    rotationZPlaying: true, rotationZSpeed: 0.19, mappingMode: "position-grid",
  }),
  scene("wide-cylinder", "Wide cylinder", {
    solidType: "cylinder", formScaleX: 1.6, formScaleZ: 0.6, traversalDirection: -1, speed: 0.4, rotationYPlaying: true,
    rotationYSpeed: -0.35, mappingMode: "incidence-depth", subdivisions: 3, strikeLimit: 7, pitchDepth: 6, characterDepth: 0.85,
  }),
]);

export function randomizeSolidDrumPreset(current, random = Math.random) {
  validateSolidDrumPreset(current);
  const rng = presetRandom(random);
  const draft = {
    solidType: rng.pick(SOLID_TYPES),
    speed: 0.03 * 80 ** rng.unit(),
    traversalDirection: rng.pick([1, -1]),
    motionMode: rng.pick(["loop", "pingpong"]),
    playing: rng.unit() < 0.8,
    mappingMode: rng.pick(MAPPING_IDS),
    subdivisions: rng.integer(1, 10),
    pitchDepth: rng.integer(0, 24),
    characterDepth: rng.unit(),
    strikeLimit: rng.integer(2, 10),
  };
  for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) draft[key] = rng.between(0.5, 1.6);
  for (const key of ["formSkewX", "formSkewZ"]) draft[key] = rng.between(-0.7, 0.7);
  for (const key of MOTION_FLAGS) draft[key] = rng.unit() < 0.4;
  for (const key of SPEED_KEYS) draft[key] = rng.between(-0.4, 0.4);
  if (!draft.playing && !MOTION_FLAGS.some(key => draft[key])) draft.playing = true;
  return validateSolidDrumPreset(sanitizeSolidDrumPreset(draft));
}
