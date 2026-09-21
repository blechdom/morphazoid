import { amplitudeEnvelopePreset, percussionEnvelopePreset, percussionEnvelopeEditorX } from "../../audio.js";
import { mappingCurvePreset } from "../../mapping.js";
import { canonicalHeadOffsets } from "../../playheads.js";
import { rebaseContinuousPosition, rebasePingPongPosition } from "../../articulation.js";
import { wrap01 } from "../../geometry.js";
import { presetRandom, randomParameterValues } from "../../site/preset-random.js";

/** Original page defaults, moved verbatim so startup and full scenes share them. */
export function createShapeInitialState(sides = 4) {
  return {
    sides,
    curvature: 0,
    shapeType: "polygon",
    closedShapeType: "polygon",
    starDepth: 0.48,
    aspect: 0,
    skew: 0,
    rotation: 0,
    continuousRotation: 0,
    rotationMotionMode: "loop",
    playMethod: "trace",
    motionMode: "loop",
    heads: 1,
    headOffsets: [0],
    scanLineAxes: Array(12).fill("vertical"),
    traceHeadDirections: Array(12).fill(1),
    radialHeadDirections: Array(12).fill(1),
    traceHeadDirectionAdjustments: Array(12).fill(0),
    radialHeadDirectionAdjustments: Array(12).fill(0),
    autoRotate: false,
    rotationSpeed: 0.12,
    rotationDirection: 1,
    audio: false,
    playing: false,
    position: 0,
    continuousPosition: 0,
    speed: 0.25,
    traversalDirection: 1,
    baseFrequency: 130,
    pitchRange: 2.5,
    level: 0.65,
    soundMode: "sine",
    amplitudeEnvelopeEnabled: true,
    cornerSwell: false,
    amplitudePreset: "segment",
    amplitudeEnvelopePoints: amplitudeEnvelopePreset("segment"),
    percussionStrikeLevel: 0.9,
    percussionAttackNoise: 0,
    percussionPreset: "pluck",
    percussionEnvelopePoints: percussionEnvelopePreset("pluck"),
    cornerAmplitudeSource: "fixed",
    fmIndexSource: "fixed",
    pmDepthSource: "fixed",
    shepardCycles: 1,
    shepardDirection: 1,
    shepardMapping: "travel",
    shepardTurnGlide: 0.35,
    shepardWidth: 4,
    fmIndex: 3,
    fmRatio: 2,
    pmIndex: 2,
    pmRatio: 1,
    stereoWidth: 1,
    stereoSource: "horizontal",
    stereoInverted: false,
    pitchSource: "vertical",
    pitchCurvePreset: "linear",
    pitchCurveNodes: mappingCurvePreset("linear"),
    percussionLevelSource: "corner",
    percussionLevelCurve: "linear",
  };
}

// Audio and evolving phases stay live. The owner explicitly requested that
// Playhead on/off and Rotation on/off ARE part of the musical preset.
// Recalling them never arms Audio or rewinds the live position/angle.
export const SHAPE_LIVE_STATE_KEYS = Object.freeze([
  "audio", "position", "continuousPosition",
  "rotation", "continuousRotation",
  "traceHeadDirectionAdjustments", "radialHeadDirectionAdjustments",
]);
export const SHAPE_PRESET_PARAMETER_KEYS = Object.freeze(
  Object.keys(createShapeInitialState()).filter(key => !SHAPE_LIVE_STATE_KEYS.includes(key)),
);

const clone = value => JSON.parse(JSON.stringify(value));
const ranges = {
  sides: [1, 32], curvature: [-1, 1], starDepth: [0.05, 0.82],
  aspect: [-2, 2], skew: [-2, 2], heads: [1, 12],
  rotationSpeed: [0, 4], speed: [0, 4], baseFrequency: [20, 440],
  pitchRange: [0, 6], level: [0, 1], percussionStrikeLevel: [0, 1],
  percussionAttackNoise: [0, 1], shepardCycles: [0.25, 4],
  shepardTurnGlide: [0.05, 1], shepardWidth: [2, 8],
  fmIndex: [0, 12], fmRatio: [0.25, 8], pmIndex: [0, 8],
  pmRatio: [0.25, 8], stereoWidth: [0, 1],
};
const sources = ["fixed", "horizontal", "height", "center", "corner", "incidence", "phase"];
const curves = ["linear", "exponential", "logarithmic", "smooth", "inverted"];
const choices = {
  shapeType: ["circle", "polygon", "star"], closedShapeType: ["polygon", "star"],
  rotationMotionMode: ["loop", "pingpong"], motionMode: ["loop", "pingpong"],
  playMethod: ["trace", "scan", "radial"], rotationDirection: [-1, 1],
  traversalDirection: [-1, 1], shepardDirection: [-1, 1],
  soundMode: ["sine", "percussion", "shepard", "fm", "pm"],
  amplitudePreset: ["segment", "pluck", "note", "sustain", "pad", "custom"],
  percussionPreset: ["pluck", "note", "sustain", "pad", "custom"],
  cornerAmplitudeSource: sources, fmIndexSource: sources, pmDepthSource: sources,
  shepardMapping: ["travel", "turn"], stereoSource: ["horizontal", "vertical", "center"],
  pitchSource: ["vertical", "horizontal", "center"], pitchCurvePreset: [...curves, "custom"],
  percussionLevelSource: [...sources, "signed"], percussionLevelCurve: curves,
};

/** Reject incomplete/invalid scenes before touching any live state. */
export function validateShapePresetParameters(parameters) {
  const fail = key => { throw new TypeError(`Invalid complete Shape preset: ${key}`); };
  if (!parameters || Object.getPrototypeOf(parameters) !== Object.prototype) fail("parameters");
  const keys = Object.keys(parameters);
  if (keys.length !== SHAPE_PRESET_PARAMETER_KEYS.length
    || SHAPE_PRESET_PARAMETER_KEYS.some(key => !Object.hasOwn(parameters, key))) fail("parameter coverage");
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(parameters[key]) || parameters[key] < min || parameters[key] > max) fail(key);
  }
  for (const key of ["sides", "heads"]) if (!Number.isInteger(parameters[key])) fail(key);
  for (const [key, options] of Object.entries(choices)) if (!options.includes(parameters[key])) fail(key);
  for (const key of ["playing", "autoRotate", "amplitudeEnvelopeEnabled", "cornerSwell", "stereoInverted"]) {
    if (typeof parameters[key] !== "boolean") fail(key);
  }
  const shapeType = parameters.sides === 1 ? "circle"
    : parameters.sides === 2 ? "polygon" : parameters.closedShapeType;
  if (parameters.shapeType !== shapeType) fail("shapeType");
  if (parameters.shepardMapping === "turn"
    && (parameters.playMethod !== "trace" || parameters.sides === 2)) fail("Shepard turn mapping");
  for (const key of ["scanLineAxes", "traceHeadDirections", "radialHeadDirections"]) {
    const options = key === "scanLineAxes" ? ["horizontal", "vertical"] : [-1, 1];
    if (!Array.isArray(parameters[key]) || parameters[key].length !== 12
      || parameters[key].some(value => !options.includes(value))) fail(key);
  }
  if (!Array.isArray(parameters.headOffsets) || parameters.headOffsets.length !== parameters.heads
    || parameters.headOffsets.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) fail("headOffsets");
  for (const key of ["amplitudeEnvelopePoints", "percussionEnvelopePoints", "pitchCurveNodes"]) {
    const nodes = parameters[key];
    if (!Array.isArray(nodes) || nodes.length !== 5) fail(key);
    nodes.forEach((node, index) => {
      if (!node || Object.keys(node).length !== 2 || !Number.isFinite(node.x) || !Number.isFinite(node.y)
        || node.x < 0 || node.x > 1 || node.y < 0 || node.y > 1
        || (index === 0 && node.x !== 0) || (index > 0 && node.x < nodes[index - 1].x)) fail(key);
    });
    if (key === "pitchCurveNodes" && nodes.at(-1).x !== 1) fail(key);
  }
}

export function captureShapePresetParameters(state) {
  const parameters = Object.fromEntries(SHAPE_PRESET_PARAMETER_KEYS.map(key => [key, state[key]]));
  validateShapePresetParameters(parameters);
  return clone(parameters);
}

/** Recall musical parameters and motion switches; preserve Audio/phases/MIDI. */
export function applyShapePresetParameters(state, parameters) {
  validateShapePresetParameters(parameters);
  const next = clone(parameters);
  const previous = {
    continuousPosition: state.continuousPosition,
    motionMode: state.motionMode,
    rotationMotionMode: state.rotationMotionMode,
    traceHeadDirections: [...state.traceHeadDirections],
    radialHeadDirections: [...state.radialHeadDirections],
    traceHeadDirectionAdjustments: [...state.traceHeadDirectionAdjustments],
    radialHeadDirectionAdjustments: [...state.radialHeadDirectionAdjustments],
  };
  Object.assign(state, next);
  if (previous.motionMode !== state.motionMode) {
    state.continuousPosition = state.motionMode === "pingpong"
      ? rebasePingPongPosition(previous.continuousPosition, state.position)
      : rebaseContinuousPosition(previous.continuousPosition, wrap01(previous.continuousPosition), state.position);
  }
  if (previous.rotationMotionMode !== state.rotationMotionMode) {
    const angle = ((state.rotation + 180) % 360 + 360) % 360 - 180;
    state.continuousRotation = state.rotationMotionMode === "pingpong"
      ? rebasePingPongPosition(state.continuousRotation, (angle + 180) / 360)
      : rebaseContinuousPosition(state.continuousRotation, wrap01(state.continuousRotation), wrap01(angle / 360));
  }
  // Direction changes do not teleport heads. New relative offsets are musical
  // settings; retain the old travel contribution independently of those offsets.
  for (const method of ["trace", "radial"]) {
    const directions = `${method}HeadDirections`;
    const adjustments = `${method}HeadDirectionAdjustments`;
    state[adjustments] = state[directions].map((direction, index) => (
      previous[directions][index] * previous.continuousPosition
      + previous[adjustments][index] - direction * state.continuousPosition
    ));
  }
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function scene(id, label, description, overrides, { amplitude = "segment", percussion = "pluck", percussionTimes = null, pitchCurve = "linear" } = {}) {
  const settings = {
    ...createShapeInitialState(), playing: true, autoRotate: false, ...overrides,
    amplitudePreset: amplitude, amplitudeEnvelopePoints: amplitudeEnvelopePreset(amplitude),
    percussionPreset: percussionTimes ? "custom" : percussion,
    percussionEnvelopePoints: percussionTimes
      ? percussionTimes.map((milliseconds, i) => ({ x: percussionEnvelopeEditorX(milliseconds), y: [0, 1, 0.32, 0.12, 0][i] }))
      : percussionEnvelopePreset(percussion),
    pitchCurvePreset: pitchCurve, pitchCurveNodes: mappingCurvePreset(pitchCurve),
  };
  settings.shapeType = settings.sides === 1 ? "circle" : settings.sides === 2 ? "polygon" : settings.closedShapeType;
  settings.headOffsets = overrides.headOffsets ?? canonicalHeadOffsets(settings.heads);
  const motion = `Playhead ${settings.playing ? "on" : "off"}; rotation ${settings.autoRotate ? "on" : "off"}. Audio stays under your control.`;
  return freezeDeep({ id, label, description: `${description} ${motion}`, snapshot: { parameters: captureShapePresetParameters(settings) } });
}

// Deliberate reader/form/sound/mapping combinations, not random slider scalings.
// All motion flags and head layouts are authored, not inherited from the page.
const originalScenes = [
  scene("square-study", "Square · Original study",
    "The original single-point sine instrument, with the original segment envelope and pitch mapping.", {}),
  scene("triangle-pad", "Triangle · Gentle FM pad",
    "Three curved sides and a soft spatial envelope, with shallow harmonic FM.",
    { sides: 3, curvature: 0.35, speed: 0.12, autoRotate: true, rotationSpeed: 0.05,
      soundMode: "fm", fmIndex: 0.6, fmRatio: 1, baseFrequency: 110, pitchRange: 2, level: 0.55 },
    { amplitude: "pad", pitchCurve: "smooth" }),
  scene("glass-star", "Star · Bright glass",
    "Three point readers on a seven-point star; corner sharpness shapes a bright FM index.",
    { sides: 7, closedShapeType: "star", starDepth: 0.35, curvature: -0.2, heads: 3, headOffsets: [0, 0.1, 0.61], speed: 0.45,
      soundMode: "fm", fmIndex: 7, fmRatio: 3.5, fmIndexSource: "corner", baseFrequency: 196, pitchRange: 2, level: 0.48 },
    { amplitude: "pluck" }),
  scene("crossed-scanners", "Hexagon · Crossed PM scanners",
    "Four alternating horizontal/vertical scanning lines map crossing angle to phase depth.",
    { sides: 6, playMethod: "scan", motionMode: "pingpong", heads: 4, speed: 0.24,
      autoRotate: true, rotationSpeed: 0.07, rotationMotionMode: "pingpong",
      scanLineAxes: Array.from({ length: 12 }, (_, index) => index % 2 ? "horizontal" : "vertical"),
      soundMode: "pm", pmIndex: 3.2, pmRatio: 2.5, pmDepthSource: "incidence",
      pitchSource: "horizontal", baseFrequency: 130, pitchRange: 3, level: 0.5 },
    { amplitude: "sustain", pitchCurve: "smooth" }),
  scene("opposed-radar", "Star · Opposed radar",
    "Two counter-rotating rays on a wide star, with center distance controlling pitch and PM depth.",
    { sides: 5, closedShapeType: "star", starDepth: 0.6, aspect: 0.7, playMethod: "radial",
      heads: 2, autoRotate: true, rotationSpeed: 0.09, rotationDirection: -1,
      radialHeadDirections: Array.from({ length: 12 }, (_, index) => index % 2 ? -1 : 1),
      soundMode: "pm", pmIndex: 1.4, pmRatio: 0.5, pmDepthSource: "center",
      pitchSource: "center", speed: 0.38, baseFrequency: 82, pitchRange: 3, level: 0.5 },
    { amplitude: "note" }),
  scene("low-corner-kit", "Square · Low corner kit",
    "Two point readers strike corners through the short percussion envelope; pitch remains geometry-driven.",
    { heads: 2, headOffsets: [0, 0.34], speed: 0.55, soundMode: "percussion", baseFrequency: 55, pitchRange: 2,
      percussionStrikeLevel: 0.6, percussionAttackNoise: 0, level: 0.5 },
    { percussionTimes: [0, 12, 60, 120, 220] }),
  scene("star-sprint", "Star · Percussion sprint",
    "Three fast readers on an eleven-point star, with alternating corner emphasis and noisy attacks.",
    { sides: 11, closedShapeType: "star", starDepth: 0.48, heads: 3, speed: 0.6,
      soundMode: "percussion", baseFrequency: 65, pitchRange: 4, percussionStrikeLevel: 0.56,
      percussionAttackNoise: 0.025, percussionLevelSource: "signed", percussionLevelCurve: "smooth", level: 0.45 },
    { percussionTimes: [0, 9, 40, 70, 125] }),
  scene("endless-climb", "Hexagon · Endless climb",
    "A slow contour-distance Shepard rise, with a broad spectral window.",
    { sides: 6, curvature: 0.3, soundMode: "shepard", shepardCycles: 1,
      shepardMapping: "travel", shepardWidth: 5, speed: 0.15, autoRotate: true, rotationSpeed: 0.03, baseFrequency: 110, level: 0.5 }),
  scene("folded-shepard", "Star · Folded Shepard turns",
    "Signed inner and outer turns bend the cyclic pitch in opposite directions.",
    { sides: 5, closedShapeType: "star", starDepth: 0.35, soundMode: "shepard",
      shepardMapping: "turn", shepardDirection: -1, shepardCycles: 2,
      shepardTurnGlide: 0.65, shepardWidth: 4, speed: 0.18, baseFrequency: 82, level: 0.5 }),
  scene("bowed-line", "Open line · Bowed pendulum",
    "Three uneven ping-pong readers on a stretched line, while the line rocks in a separate ping-pong rotation.",
    { sides: 2, curvature: 0.65, aspect: 1, heads: 3, headOffsets: [0.03, 0.26, 0.71], motionMode: "pingpong",
      pitchSource: "horizontal", speed: 0.2, baseFrequency: 146, pitchRange: 2,
      autoRotate: true, rotationMotionMode: "pingpong", rotationDirection: -1, rotationSpeed: 0.12,
      cornerSwell: true, stereoSource: "vertical", stereoWidth: 0.65, level: 0.55 },
    { amplitude: "sustain", pitchCurve: "exponential" }),
  scene("crooked-radar", "Star · Nasty crooked radar",
    "Six rays scrape a skewed thirteen-point star, with deep inharmonic PM and reversed stereo.",
    { sides: 13, closedShapeType: "star", curvature: -0.58, aspect: 1.4, skew: -0.6,
      heads: 6, playMethod: "radial", soundMode: "pm", pmIndex: 6.4, pmRatio: 0.35,
      pmDepthSource: "incidence", speed: 2, baseFrequency: 55, pitchRange: 5,
      autoRotate: true, rotationSpeed: 0.28, stereoInverted: true, level: 0.42 },
    { amplitude: "pluck", pitchCurve: "inverted" }),
];

const counterDirections = () => Array.from({ length: 12 }, (_, index) => index % 2 ? -1 : 1);
const mixedAxes = () => Array.from({ length: 12 }, (_, index) => index % 2 ? "horizontal" : "vertical");

// The initial 24 additions plus two Bowed line follow-ups: rotation-only, fixed
// geometry, two motions, opposing directions and uneven/clumped/close layouts.
// Higher density or timbral depth uses restrained master/strike levels rather
// than removing voice and output ceilings from the existing synthesis engine.
const expandedScenes = [
  scene("velvet-wheel", "Velvet wheel",
    "The original straight square turns slowly past three unevenly spaced stationary rays. A smooth rotation-only sine study.",
    { sides: 4, curvature: 0, aspect: 0, skew: 0, playMethod: "radial", heads: 3, headOffsets: [0, 0.21, 0.67],
      playing: false, autoRotate: true, rotationSpeed: 0.035, rotationDirection: -1, amplitudeEnvelopeEnabled: false,
      baseFrequency: 98, pitchRange: 1.8, stereoWidth: 0.6, level: 0.5 }),
  scene("clustered-marimba", "Clustered marimba",
    "Four point readers arrive as a close pair, then two spaced replies. Short dry percussion on a pentagon.",
    { sides: 5, heads: 4, headOffsets: [0, 0.035, 0.31, 0.67], speed: 0.31,
      soundMode: "percussion", percussionLevelSource: "fixed", percussionStrikeLevel: 0.56,
      percussionAttackNoise: 0, baseFrequency: 196, pitchRange: 2, level: 0.46 },
    { percussionTimes: [0, 10, 48, 110, 210] }),
  scene("salt-glass", "Salt glass",
    "Four clustered radar rays cut a turning thin star. Bright inharmonic FM follows the crossing angle.",
    { sides: 8, closedShapeType: "star", starDepth: 0.19, curvature: -0.32, playMethod: "radial",
      heads: 4, headOffsets: [0, 0.09, 0.43, 0.77], speed: 0.44, autoRotate: true,
      rotationSpeed: 0.11, rotationDirection: -1, soundMode: "fm", fmIndex: 4.8,
      fmRatio: 5, fmIndexSource: "incidence", baseFrequency: 147, pitchRange: 3.2, level: 0.42 },
    { amplitude: "pluck", pitchCurve: "logarithmic" }),
  scene("split-moon", "Split moon",
    "Two very close readers and one distant reply on a stretched circle. Gentle PM bends in and out of phase.",
    { sides: 1, aspect: 0.9, playMethod: "trace", heads: 3, headOffsets: [0, 0.018, 0.53],
      speed: 0.08, autoRotate: true, rotationSpeed: 0.02, rotationMotionMode: "pingpong", soundMode: "pm",
      pmIndex: 0.8, pmRatio: 1.5, baseFrequency: 165, pitchRange: 1.5, level: 0.48 }),
  scene("orbiting-knuckles", "Orbiting knuckles",
    "Four stationary radar rays listen while a lopsided body rotates through them: rotation creates the strikes, not playhead travel.",
    { sides: 7, closedShapeType: "star", starDepth: 0.63, aspect: 0.4, skew: -0.3,
      playMethod: "radial", heads: 4, headOffsets: [0.04, 0.19, 0.52, 0.9],
      playing: false, autoRotate: true, rotationSpeed: 0.16, rotationMotionMode: "pingpong",
      soundMode: "percussion", percussionStrikeLevel: 0.52, percussionAttackNoise: 0.025,
      percussionLevelSource: "incidence", baseFrequency: 70, pitchRange: 3, level: 0.46 },
    { percussionTimes: [0, 14, 65, 125, 230] }),
  scene("twelve-point-braid", "Twelve-point braid",
    "Twelve unequally spaced points go in alternating directions around a rotating outline. Many fine strands, not twelve copies in unison.",
    { sides: 8, curvature: 0.22, heads: 12,
      headOffsets: [0, 0.024, 0.09, 0.17, 0.21, 0.34, 0.46, 0.5, 0.64, 0.73, 0.79, 0.94],
      traceHeadDirections: counterDirections(), speed: 0.19, autoRotate: true,
      rotationSpeed: 0.043, soundMode: "sine", baseFrequency: 82, pitchRange: 3.5,
      cornerAmplitudeSource: "phase", stereoWidth: 1, level: 0.38 },
    { amplitude: "note", pitchCurve: "smooth" }),
  scene("stuttering-pentagon", "Stuttering pentagon",
    "Three quick taps, a gap, then two more: a six-reader pattern from deliberately grouped spacings.",
    { sides: 5, heads: 6, headOffsets: [0, 0.025, 0.065, 0.39, 0.74, 0.79], speed: 0.52,
      soundMode: "percussion", percussionStrikeLevel: 0.54, percussionLevelSource: "phase",
      percussionLevelCurve: "logarithmic", percussionAttackNoise: 0.015,
      baseFrequency: 65, pitchRange: 3.6, level: 0.43 },
    { percussionTimes: [0, 9, 42, 80, 160] }),
  scene("scanner-lullaby", "Scanner lullaby",
    "Two separated line readers bounce slowly through a bowed square. Long envelopes soften the low sine crossings.",
    { sides: 4, curvature: 0.64, aspect: -0.4, playMethod: "scan", motionMode: "pingpong",
      heads: 2, headOffsets: [0.15, 0.7], speed: 0.065, soundMode: "sine",
      baseFrequency: 110, pitchRange: 1.6, stereoWidth: 0.4, level: 0.5 },
    { amplitude: "pad", pitchCurve: "smooth" }),
  scene("reverse-staircase", "Reverse staircase",
    "Three reverse-moving points trace sharply concave steps. A reversed pitch curve pulls the FM contour against its motion.",
    { sides: 6, curvature: -0.7, heads: 3, headOffsets: [0, 0.22, 0.81],
      traversalDirection: -1, speed: 0.34, soundMode: "fm", fmIndex: 2.8,
      fmRatio: 0.5, fmIndexSource: "height", baseFrequency: 98, pitchRange: 4, level: 0.46 },
    { amplitude: "note", pitchCurve: "inverted" }),
  scene("braided-shepard", "Braided Shepard",
    "Three unevenly spaced readers take opposing routes through an endless pitch field while the form slowly turns.",
    { sides: 8, curvature: 0.45, heads: 3, headOffsets: [0, 0.13, 0.62],
      traceHeadDirections: counterDirections(), speed: 0.16, autoRotate: true,
      rotationSpeed: 0.03, rotationMotionMode: "pingpong", soundMode: "shepard", shepardCycles: 1.5,
      shepardWidth: 5.5, baseFrequency: 98, level: 0.43 },
    { amplitude: "sustain" }),
  scene("hinged-star", "Hinged star",
    "Playheads stand still while the body rocks back and forth. Four uneven rays turn its hinges into phase-depth motion.",
    { sides: 6, closedShapeType: "star", starDepth: 0.56, skew: 0.4, playMethod: "radial",
      heads: 4, headOffsets: [0, 0.15, 0.49, 0.84], playing: false, autoRotate: true,
      rotationMotionMode: "pingpong", rotationSpeed: 0.095, soundMode: "pm",
      pmIndex: 2.8, pmRatio: 3, pmDepthSource: "incidence", baseFrequency: 73,
      pitchRange: 2.8, level: 0.46 },
    { amplitude: "sustain" }),
  scene("insect-clock", "Insect clock",
    "Five rays in uneven groups counter the rotating star. Rounded little impacts keep the busy rhythm audible without a wall of noisy clicks.",
    { sides: 9, closedShapeType: "star", starDepth: 0.42, playMethod: "radial",
      heads: 5, headOffsets: [0, 0.08, 0.31, 0.57, 0.83],
      radialHeadDirections: counterDirections(), speed: 0.27, autoRotate: true,
      rotationDirection: -1, rotationSpeed: 0.08, soundMode: "percussion",
      percussionStrikeLevel: 0.4, percussionAttackNoise: 0.03,
      baseFrequency: 130, pitchRange: 2.2, level: 0.35 },
    { percussionTimes: [0, 9, 32, 58, 110] }),
  scene("wobble-bass", "Wobble bass",
    "Two closely spaced readers on a stretched rounded triangle. Slow FM index mapping and a second rotation rate make a breathing bass.",
    { sides: 3, curvature: 0.56, aspect: 0.85, heads: 2, headOffsets: [0, 0.11],
      speed: 0.21, autoRotate: true, rotationSpeed: 0.063, soundMode: "fm",
      fmIndex: 5.2, fmRatio: 0.25, fmIndexSource: "height", baseFrequency: 41,
      pitchRange: 1.8, stereoWidth: 0.6, level: 0.48 },
    { amplitude: "sustain" }),
  scene("detuned-lanterns", "Detuned lanterns",
    "Two near-coincident pairs trace smooth stereo arcs. Very small spacing differences produce changing intervals rather than fixed doubled voices.",
    { sides: 1, aspect: -0.55, heads: 4, headOffsets: [0, 0.009, 0.5, 0.517],
      speed: 0.12, soundMode: "sine", baseFrequency: 196, pitchRange: 1.2,
      stereoSource: "horizontal", level: 0.43 }),
  scene("brass-fan", "Brass fan",
    "Five spread rays scan a turning triangular body. Harmonic FM brightens with distance from the center.",
    { sides: 3, curvature: 0.14, playMethod: "radial", heads: 5,
      headOffsets: [0, 0.08, 0.26, 0.55, 0.82], speed: 0.38, autoRotate: true,
      rotationSpeed: 0.12, soundMode: "fm", fmIndex: 3.8, fmRatio: 1,
      fmIndexSource: "center", baseFrequency: 65, pitchRange: 2.7, level: 0.43 },
    { amplitude: "sustain" }),
  scene("mirror-murmur", "Mirror murmur",
    "Two unequal line readers sweep across a slowly reversing rotation. A narrow stereo sine voice with mirrored envelope swells.",
    { sides: 7, curvature: 0.8, aspect: 0.45, playMethod: "scan", motionMode: "pingpong",
      heads: 2, headOffsets: [0.03, 0.61], speed: 0.1, autoRotate: true,
      rotationMotionMode: "pingpong", rotationSpeed: 0.025, cornerSwell: true,
      soundMode: "sine", baseFrequency: 146, pitchRange: 1.5,
      stereoSource: "vertical", stereoInverted: true, level: 0.48 },
    { amplitude: "pad", pitchCurve: "logarithmic" }),
  scene("fractured-bell", "Fractured bell",
    "A long asymmetric outline passes through three stationary rays. Rotation alone changes the deep inharmonic FM bell.",
    { sides: 9, closedShapeType: "star", starDepth: 0.24, curvature: -0.5,
      aspect: 1.25, skew: -0.45, playMethod: "radial", heads: 3,
      headOffsets: [0.06, 0.31, 0.76], playing: false, autoRotate: true,
      rotationSpeed: 0.08, soundMode: "fm", fmIndex: 8.5, fmRatio: 6.25,
      fmIndexSource: "incidence", baseFrequency: 82, pitchRange: 2.3, level: 0.37 },
    { amplitude: "pluck", pitchCurve: "smooth" }),
  scene("uneven-drum-wheel", "Uneven drum wheel",
    "Five stationary rays with deliberately unequal gaps. A continuously rotating seven-point body makes the rhythm.",
    { sides: 7, closedShapeType: "star", starDepth: 0.54, aspect: -0.32,
      playMethod: "radial", heads: 5, headOffsets: [0, 0.12, 0.29, 0.58, 0.92],
      playing: false, autoRotate: true, rotationSpeed: 0.21, rotationDirection: -1, soundMode: "percussion",
      percussionStrikeLevel: 0.42, percussionAttackNoise: 0,
      percussionLevelSource: "height", baseFrequency: 55, pitchRange: 2.7, level: 0.4 },
    { percussionTimes: [0, 14, 62, 130, 235] }),
  scene("twin-comets", "Twin comets",
    "Two opposed point readers race around a bowed six-sided contour while a slower rotation turns their stereo paths.",
    { sides: 6, curvature: 0.62, heads: 2, headOffsets: [0.04, 0.41],
      traceHeadDirections: counterDirections(), speed: 1.15, autoRotate: true,
      rotationSpeed: 0.17, rotationDirection: -1, soundMode: "pm",
      pmIndex: 3.2, pmRatio: 2, pmDepthSource: "phase", baseFrequency: 110,
      pitchRange: 3.4, level: 0.44 },
    { amplitude: "note", pitchCurve: "exponential" }),
  scene("corner-storm", "Corner storm",
    "Four irregular points cross a dense thirty-two-point star. Slower travel and rounded strikes preserve the flurry without thousands of attacks per second.",
    { sides: 32, closedShapeType: "star", starDepth: 0.28, heads: 4,
      headOffsets: [0, 0.17, 0.53, 0.86],
      traceHeadDirections: counterDirections(), speed: 0.17, autoRotate: true,
      rotationMotionMode: "pingpong", rotationSpeed: 0.07, soundMode: "percussion", percussionStrikeLevel: 0.3,
      percussionAttackNoise: 0.025, percussionLevelSource: "signed",
      percussionLevelCurve: "smooth", baseFrequency: 55, pitchRange: 3, level: 0.3 },
    { percussionTimes: [0, 8, 28, 48, 90] }),
  scene("suspended-ribbon", "Suspended ribbon",
    "A strongly bowed open line turns under one stationary point. The playhead rests; geometry rotation draws a wide, smooth sine arc.",
    { sides: 2, curvature: -0.76, aspect: 1.4, skew: 0.35, heads: 1,
      headOffsets: [0.19], playing: false, autoRotate: true,
      rotationSpeed: 0.055, rotationMotionMode: "pingpong", soundMode: "sine",
      amplitudeEnvelopeEnabled: false, baseFrequency: 165, pitchRange: 2,
      stereoWidth: 0.75, level: 0.48 },
    { amplitude: "pad", pitchCurve: "smooth" }),
  scene("spiral-illusion", "Spiral illusion",
    "Five unequal point offsets and reverse contour travel fold a narrow Shepard band into a turning stretched body.",
    { sides: 8, closedShapeType: "star", starDepth: 0.64, curvature: 0.3, aspect: 0.6,
      heads: 5, headOffsets: [0, 0.06, 0.28, 0.57, 0.89], speed: 0.23,
      traversalDirection: -1, autoRotate: true, rotationSpeed: 0.07,
      soundMode: "shepard", shepardCycles: 3.5, shepardWidth: 2.5,
      shepardDirection: -1, baseFrequency: 110, level: 0.4 },
    { amplitude: "sustain" }),
  scene("interference-grid", "Interference grid",
    "Six irregular mixed-axis lines cross a thin concave star. Both motions are on; crossing angle opens and closes the deep phase modulation.",
    { sides: 10, closedShapeType: "star", starDepth: 0.3, curvature: -0.66,
      playMethod: "scan", motionMode: "pingpong", heads: 6,
      headOffsets: [0, 0.017, 0.28, 0.53, 0.59, 0.91], scanLineAxes: mixedAxes(),
      speed: 0.73, autoRotate: true, rotationSpeed: 0.19, rotationDirection: -1, soundMode: "pm",
      pmIndex: 7.6, pmRatio: 4.5, pmDepthSource: "incidence", baseFrequency: 73,
      pitchRange: 3.4, stereoInverted: true, level: 0.34 },
    { amplitude: "pluck", pitchCurve: "inverted" }),
  scene("bowed-line-reel", "Bowed line · Reverse reel",
    "Two opposite readers on a long bowed line with continuous counterclockwise rotation. Fine head spacing makes the paths briefly meet and separate.",
    { sides: 2, curvature: -0.72, aspect: 1.2, skew: 0.3, heads: 2, headOffsets: [0.09, 0.48],
      traceHeadDirections: counterDirections(), motionMode: "loop", speed: 0.34,
      autoRotate: true, rotationSpeed: 0.21, rotationDirection: -1, rotationMotionMode: "loop",
      soundMode: "fm", fmIndex: 1.4, fmRatio: 1.5, fmIndexSource: "height",
      baseFrequency: 110, pitchRange: 2.6, level: 0.45 },
    { amplitude: "sustain", pitchCurve: "smooth" }),
  scene("bowed-line-rocker", "Bowed line · Four-way rocker",
    "Four unequally spaced readers bounce along a bent line while its rotation reverses on a separate cycle.",
    { sides: 2, curvature: 0.88, aspect: -0.6, skew: -0.35, heads: 4, headOffsets: [0, 0.13, 0.49, 0.81],
      traceHeadDirections: counterDirections(), motionMode: "pingpong", speed: 0.41,
      autoRotate: true, rotationMotionMode: "pingpong", rotationSpeed: 0.16, rotationDirection: 1,
      soundMode: "pm", pmIndex: 1.2, pmRatio: 0.75, pmDepthSource: "phase",
      baseFrequency: 130, pitchRange: 2.4, level: 0.43 },
    { amplitude: "pad", pitchCurve: "logarithmic" }),
];

// Deliberately interleaved, not randomized on page load: the next-arrow tour
// alternates reader/spacing/motion/timbre character while remaining reproducible.
const menuOrder = [
  "square-study", "velvet-wheel", "clustered-marimba", "salt-glass",
  "bowed-line-reel", "orbiting-knuckles", "crossed-scanners", "detuned-lanterns",
  "star-sprint", "hinged-star", "triangle-pad", "twelve-point-braid",
  "low-corner-kit", "braided-shepard", "wobble-bass", "mirror-murmur",
  "insect-clock", "glass-star", "suspended-ribbon", "twin-comets",
  "folded-shepard", "stuttering-pentagon", "brass-fan", "scanner-lullaby",
  "crooked-radar", "uneven-drum-wheel", "split-moon", "reverse-staircase",
  "endless-climb", "fractured-bell", "bowed-line", "corner-storm",
  "spiral-illusion", "interference-grid", "opposed-radar", "bowed-line-rocker",
];
const byId = new Map([...originalScenes, ...expandedScenes].map(preset => [preset.id, preset]));
if (byId.size !== 36 || menuOrder.length !== byId.size || new Set(menuOrder).size !== byId.size
  || menuOrder.some(id => !byId.has(id))) throw new Error("Shape preset tour must include each of the 36 scenes once");
export const SHAPE_FULL_PRESETS = Object.freeze(menuOrder.map(id => byId.get(id)));

/** Roll the musical parameter schema itself, not a selected factory scene. */
export function randomizeShapePreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const p = captureShapePresetParameters(createShapeInitialState());
  for (const [key, options] of Object.entries(choices)) p[key] = rng.pick(options);
  Object.assign(p, {
    ...randomParameterValues({
      curvature: [-0.65, 0.7], starDepth: [0.12, 0.72], aspect: [-1.4, 1.4], skew: [-0.8, 0.8],
      rotationSpeed: [0.025, 0.5], speed: [0.06, 0.85], baseFrequency: [55, 220],
      pitchRange: [0.75, 4], percussionStrikeLevel: [0.3, 0.65], percussionAttackNoise: [0, 0.03],
      shepardCycles: [0.25, 3], shepardTurnGlide: [0.08, 0.85], shepardWidth: [2.5, 7],
      fmIndex: [0.1, 5.5], fmRatio: [0.25, 8], pmIndex: [0.1, 3.2], pmRatio: [0.25, 8],
      stereoWidth: [0, 1],
    }, rng),
    level: current.parameters.level, // User output, not a sonic lottery.
    sides: rng.integer(1, 32), heads: rng.integer(1, 12),
    playing: rng.pick([true, false]), autoRotate: rng.pick([false, true]),
    amplitudeEnvelopeEnabled: rng.pick([true, false]), cornerSwell: rng.pick([false, true]),
    stereoInverted: rng.pick([false, true]),
    scanLineAxes: Array.from({ length: 12 }, () => rng.pick(["horizontal", "vertical"])),
    traceHeadDirections: Array.from({ length: 12 }, () => rng.pick([-1, 1])),
    radialHeadDirections: Array.from({ length: 12 }, () => rng.pick([-1, 1])),
  });
  // Musical motion toggles are in scope. Keep at least one motion active so a
  // random sound does not appear broken; Audio itself remains explicitly armed.
  if (!p.playing && !p.autoRotate) p.autoRotate = true;
  if (p.soundMode === "percussion") p.sides = Math.max(3, p.sides); // corners required
  p.shapeType = p.sides === 1 ? "circle" : p.sides === 2 ? "polygon" : p.closedShapeType;
  if (p.playMethod !== "trace" || p.sides === 2) p.shepardMapping = "travel";
  p.headOffsets = Array.from({ length: p.heads }, () => rng.unit()).sort((a, b) => a - b);
  const xs = [0, rng.between(0.04, 0.2), rng.between(0.25, 0.48), rng.between(0.55, 0.8), 1];
  p.amplitudeEnvelopePoints = xs.map(x => ({ x, y: rng.unit() }));
  p.amplitudePreset = "custom";
  const attack = rng.between(8, 25), decay = attack + rng.between(15, 100);
  const sustain = decay + rng.between(20, 100), release = sustain + rng.between(35, 180);
  const levels = [0, 1, rng.between(0.2, 0.7), rng.between(0.02, 0.18), 0];
  p.percussionEnvelopePoints = [0, attack, decay, sustain, release]
    .map((ms, i) => ({ x: percussionEnvelopeEditorX(ms), y: levels[i] }));
  p.percussionPreset = "custom";
  p.pitchCurveNodes = xs.map(x => ({ x, y: rng.unit() }));
  p.pitchCurvePreset = "custom";
  // Point readers never cross their contour: incidence is identically zero.
  // Do not accidentally use it as a mute in a generated scene.
  if (p.playMethod === "trace") {
    if (p.cornerAmplitudeSource === "incidence") p.cornerAmplitudeSource = "fixed";
    if (p.percussionLevelSource === "incidence") p.percussionLevelSource = "fixed";
    if (p.soundMode === "percussion") p.playing = true;
  }
  if (p.cornerAmplitudeSource === "phase" && !p.playing) p.playing = true;
  // Bound the combined geometry/motion budget, not independent speed sliders.
  if (p.soundMode === "percussion") {
    const corners = p.sides * (p.closedShapeType === "star" ? 2 : 1);
    const crossings = corners * p.heads * (
      (p.playing ? p.speed * (p.motionMode === "pingpong" ? 2 : 1) : 0)
      + (p.autoRotate && p.playMethod === "radial" ? p.rotationSpeed * (p.rotationMotionMode === "pingpong" ? 2 : 1) : 0));
    const budget = Math.min(1, 60 / Math.max(1, crossings));
    p.speed *= budget;
    p.rotationSpeed *= budget;
  }
  validateShapePresetParameters(p);
  return { parameters: p };
}
