import { canonicalHeadOffsets, sanitizeHeadOffsets, wrapOffset } from "../../playheads.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { SHAPE_DRUM_MAPPING_MODES } from "./shape-drum-machine.js";

const MAPPING_IDS = Object.freeze(SHAPE_DRUM_MAPPING_MODES.map(mode => mode.id));
const PLAY_METHODS = Object.freeze(["trace", "scan", "radial"]);
const HEAD_SLOTS = 12;

export const SHAPE_DRUM_PRESET_KEYS = Object.freeze([
  "sides", "closedShapeType", "starDepth", "curvature", "aspect", "skew",
  "playMethod", "heads", "headOffsets", "scanLineAxes", "traceHeadDirections", "radialHeadDirections",
  "motionMode", "speed", "traversalDirection", "playing",
  "rotationSpeed", "rotationDirection", "rotationMotionMode", "autoRotate",
  "mappingMode", "sideSubdivisions", "pitchDepth", "characterDepth", "strikeLimit",
]);

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const quantize = (value, min, max, step, fallback) => {
  const clamped = Math.min(max, Math.max(min, finite(value, fallback)));
  return Number(Math.min(max, min + Math.round((clamped - min) / step) * step).toFixed(6));
};
const integer = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.round(finite(value, fallback))));
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const sign = value => (Number(value) < 0 ? -1 : 1);
const perHead = (list, heads, fallback, convert) => Array.from({ length: HEAD_SLOTS }, (_, index) => (
  index < heads ? convert(list?.[index]) : fallback
));

export function sanitizeShapeDrumPreset(raw = {}) {
  const heads = integer(raw.heads, 1, HEAD_SLOTS, 1);
  return {
    sides: integer(raw.sides, 1, 32, 4),
    closedShapeType: oneOf(raw.closedShapeType, ["polygon", "star"], "polygon"),
    starDepth: quantize(raw.starDepth, 0.05, 0.82, 0.01, 0.48),
    curvature: quantize(raw.curvature, -1, 1, 0.005, 0),
    aspect: quantize(raw.aspect, -2, 2, 0.01, 0),
    skew: quantize(raw.skew, -2, 2, 0.01, 0),
    playMethod: oneOf(raw.playMethod, PLAY_METHODS, "trace"),
    heads,
    headOffsets: sanitizeHeadOffsets(raw.headOffsets, heads).map(offset => wrapOffset(Number(offset.toFixed(3)))),
    scanLineAxes: perHead(raw.scanLineAxes, heads, "vertical", axis => (axis === "horizontal" ? "horizontal" : "vertical")),
    traceHeadDirections: perHead(raw.traceHeadDirections, heads, 1, sign),
    radialHeadDirections: perHead(raw.radialHeadDirections, heads, 1, sign),
    motionMode: oneOf(raw.motionMode, ["loop", "pingpong"], "loop"),
    speed: quantize(raw.speed, 0, 4, 0.001, 0.06),
    traversalDirection: sign(raw.traversalDirection),
    playing: Boolean(raw.playing),
    rotationSpeed: quantize(raw.rotationSpeed, 0, 4, 0.01, 0.12),
    rotationDirection: sign(raw.rotationDirection),
    rotationMotionMode: oneOf(raw.rotationMotionMode, ["loop", "pingpong"], "loop"),
    autoRotate: Boolean(raw.autoRotate),
    mappingMode: oneOf(raw.mappingMode, MAPPING_IDS, MAPPING_IDS[0]),
    sideSubdivisions: integer(raw.sideSubdivisions, 1, 16, 2),
    pitchDepth: integer(raw.pitchDepth, 0, 24, 12),
    characterDepth: quantize(raw.characterDepth, 0, 1, 0.01, 0.7),
    strikeLimit: integer(raw.strikeLimit, 1, 16, 6),
  };
}

export const captureShapeDrumPreset = sanitizeShapeDrumPreset;

export function validateShapeDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(sanitizeShapeDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Shape Drum Machine preset");
  }
  return snapshot;
}

const BASE = Object.freeze({
  sides: 4, closedShapeType: "polygon", starDepth: 0.48, curvature: 0, aspect: 0, skew: 0,
  playMethod: "trace", heads: 1, motionMode: "loop", speed: 0.06, traversalDirection: 1, playing: true,
  rotationSpeed: 0.12, rotationDirection: 1, rotationMotionMode: "loop", autoRotate: false,
  mappingMode: "contour-corner", sideSubdivisions: 2, pitchDepth: 12, characterDepth: 0.7, strikeLimit: 6,
});
const scene = (id, label, overrides) => Object.freeze({
  id, label, snapshot: Object.freeze(sanitizeShapeDrumPreset({ ...BASE, ...overrides })),
});
const crossed = canonicalHeadOffsets(4, "crossed");

export const SHAPE_DRUM_FULL_PRESETS = Object.freeze([
  scene("square-trace", "Square trace", {}),
  scene("triangle-sweep", "Triangle sweep", {
    sides: 3, playMethod: "scan", heads: 2, scanLineAxes: ["vertical", "horizontal"], speed: 0.1,
    mappingMode: "position-grid", sideSubdivisions: 3,
  }),
  scene("pentagram-radar", "Pentagram radar", {
    sides: 5, closedShapeType: "star", starDepth: 0.38, playMethod: "radial", heads: 3, speed: 0.08,
    mappingMode: "incidence-playhead", autoRotate: true, rotationSpeed: 0.1, pitchDepth: 7,
  }),
  scene("circle-orbit", "Circle orbit", { sides: 1, heads: 4, speed: 0.14, pitchDepth: 5, characterDepth: 0.9 }),
  scene("open-line-bounce", "Open line bounce", {
    sides: 2, heads: 2, motionMode: "pingpong", speed: 0.22, sideSubdivisions: 4, mappingMode: "position-grid",
  }),
  scene("octagon-scanners", "Octagon scanners", {
    sides: 8, playMethod: "scan", heads: 6, scanLineAxes: ["vertical", "horizontal", "vertical", "horizontal", "vertical", "horizontal"],
    speed: 0.05, strikeLimit: 9, autoRotate: true, rotationSpeed: 0.04, rotationMotionMode: "pingpong",
  }),
  scene("hexagram-spin", "Hexagram spin", {
    sides: 6, closedShapeType: "star", starDepth: 0.3, heads: 3, traceHeadDirections: [1, -1, 1], speed: 0.03,
    autoRotate: true, rotationSpeed: 0.35, characterDepth: 0.5,
  }),
  scene("sprung-square", "Sprung square", {
    curvature: 0.55, aspect: 0.5, skew: 0.3, heads: 2, speed: 0.18, sideSubdivisions: 5, pitchDepth: 18,
    mappingMode: "incidence-playhead",
  }),
  scene("inward-blade", "Inward blade", {
    sides: 3, curvature: -0.6, playMethod: "radial", heads: 2, radialHeadDirections: [1, -1], speed: 0.3,
    sideSubdivisions: 1, strikeLimit: 4, pitchDepth: 3, characterDepth: 1, autoRotate: true, rotationDirection: -1, rotationSpeed: 0.5,
  }),
  scene("wide-stage", "Wide stage", {
    sides: 12, aspect: 1.2, heads: 8, speed: 0.35, strikeLimit: 12, pitchDepth: 2, characterDepth: 0.3,
  }),
  scene("slow-dodecagram", "Slow dodecagram", {
    sides: 12, closedShapeType: "star", starDepth: 0.6, playMethod: "radial", heads: 2, speed: 0.018,
    sideSubdivisions: 8, strikeLimit: 3, pitchDepth: 24, characterDepth: 0.8, autoRotate: true, rotationSpeed: 0.06,
  }),
  scene("crossed-grid", "Crossed grid", {
    playMethod: "scan", heads: 4, headOffsets: crossed, scanLineAxes: ["vertical", "horizontal", "vertical", "horizontal"],
    speed: 0.08, mappingMode: "position-grid", sideSubdivisions: 4, strikeLimit: 8,
  }),
  scene("tilted-diamond", "Tilted diamond", {
    skew: -0.8, aspect: -0.9, heads: 3, motionMode: "pingpong", speed: 0.12, autoRotate: true, rotationSpeed: 0.2,
    rotationMotionMode: "pingpong",
  }),
  scene("spiky-comet", "Spiky comet", {
    sides: 9, closedShapeType: "star", starDepth: 0.15, playMethod: "radial", speed: 0.5, traversalDirection: -1,
    mappingMode: "incidence-playhead", sideSubdivisions: 3, strikeLimit: 5, pitchDepth: 15, characterDepth: 0.95,
    autoRotate: true,
  }),
]);

export function randomizeShapeDrumPreset(current, random = Math.random) {
  validateShapeDrumPreset(current);
  const rng = presetRandom(random);
  const heads = rng.integer(1, 8);
  const customSpacing = rng.unit() < 0.5;
  const playing = rng.unit() < 0.85;
  const draft = {
    sides: rng.integer(1, 16),
    closedShapeType: rng.pick(["polygon", "star"]),
    starDepth: rng.between(0.1, 0.8),
    curvature: rng.between(-0.7, 0.7),
    aspect: rng.between(-1.3, 1.3),
    skew: rng.between(-1.2, 1.2),
    playMethod: rng.pick(PLAY_METHODS),
    heads,
    headOffsets: customSpacing ? Array.from({ length: heads }, () => rng.unit()) : canonicalHeadOffsets(heads),
    scanLineAxes: Array.from({ length: HEAD_SLOTS }, () => rng.pick(["vertical", "horizontal"])),
    traceHeadDirections: Array.from({ length: HEAD_SLOTS }, () => rng.pick([1, -1])),
    radialHeadDirections: Array.from({ length: HEAD_SLOTS }, () => rng.pick([1, -1])),
    motionMode: rng.pick(["loop", "pingpong"]),
    speed: 0.02 * 60 ** rng.unit(),
    traversalDirection: rng.pick([1, -1]),
    playing,
    rotationSpeed: rng.between(0.02, 1),
    rotationDirection: rng.pick([1, -1]),
    rotationMotionMode: rng.pick(["loop", "pingpong"]),
    autoRotate: rng.unit() < 0.5,
    mappingMode: rng.pick(MAPPING_IDS),
    sideSubdivisions: rng.integer(1, 8),
    pitchDepth: rng.integer(0, 24),
    characterDepth: rng.unit(),
    strikeLimit: rng.integer(2, 12),
  };
  if (!draft.playing && !draft.autoRotate) draft.playing = true;
  return validateShapeDrumPreset(sanitizeShapeDrumPreset(draft));
}
