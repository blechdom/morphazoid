import { createShapeInitialState } from "../shape-synth/full-presets.js";
import { amplitudeEnvelopePreset, sanitizeAmplitudeEnvelope } from "../../audio.js";
import { sanitizeMappingCurve } from "../../mapping.js";

const geometryKeys = new Set([
  "sides", "curvature", "shapeType", "closedShapeType", "starDepth", "aspect", "skew",
  "rotation", "continuousRotation", "rotationMotionMode", "playMethod", "motionMode",
  "heads", "headOffsets", "scanLineAxes", "traceHeadDirections", "radialHeadDirections",
  "traceHeadDirectionAdjustments", "radialHeadDirectionAdjustments", "autoRotate",
  "rotationSpeed", "rotationDirection", "audio", "playing", "position", "continuousPosition",
  "speed", "traversalDirection", "baseFrequency", "pitchRange", "level", "soundMode", "stereoWidth",
]);
export const SHAPES_TONE_KEYS = Object.freeze(Object.keys(createShapeInitialState()).filter(key => !geometryKeys.has(key)));
export function createShapesSynthesis(source = {}) {
  const initial = createShapeInitialState();
  const tone = Object.fromEntries(SHAPES_TONE_KEYS.map(key => [key, structuredClone(initial[key])]));
  for (const key of SHAPES_TONE_KEYS) {
    const value = source.tone?.[key];
    if (typeof value === typeof tone[key] && value !== null) tone[key] = structuredClone(value);
  }
  // Persistent data is untrusted. Invalid scalar values revert independently.
  const ranges = {
    fmIndex: [0, 12], fmRatio: [0.25, 8], pmIndex: [0, 8], pmRatio: [0.25, 8],
    percussionStrikeLevel: [0, 1], percussionAttackNoise: [0, 1],
    shepardCycles: [0.25, 4], shepardDirection: [-1, 1],
    shepardTurnGlide: [0.05, 1], shepardWidth: [2, 8],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(tone[key]) || tone[key] < min || tone[key] > max) tone[key] = initial[key];
  }
  const sources = ["fixed", "horizontal", "height", "center", "corner", "incidence", "phase"];
  const choices = {
    cornerAmplitudeSource: sources, fmIndexSource: sources, pmDepthSource: sources,
    shepardDirection: [-1, 1], shepardMapping: ["travel", "turn"],
    stereoSource: ["horizontal", "vertical", "center"], pitchSource: ["vertical", "horizontal", "center"],
    amplitudePreset: ["segment", "pluck", "note", "sustain", "pad", "custom"],
    percussionPreset: ["pluck", "note", "sustain", "pad", "custom"],
    pitchCurvePreset: ["linear", "exponential", "logarithmic", "smooth", "inverted", "custom"],
    percussionLevelSource: [...sources, "signed"],
    percussionLevelCurve: ["linear", "exponential", "logarithmic", "smooth", "inverted"],
  };
  for (const [key, values] of Object.entries(choices)) if (!values.includes(tone[key])) tone[key] = initial[key];
  for (const key of ["amplitudeEnvelopePoints", "percussionEnvelopePoints"]) tone[key] = sanitizeAmplitudeEnvelope(tone[key]);
  tone.pitchCurveNodes = sanitizeMappingCurve(tone.pitchCurveNodes);
  const envelope = source.envelope ?? {};
  const enabled = typeof envelope.enabled === "boolean" ? envelope.enabled : true;
  const scalar = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    model: source.model === "geometry" ? "geometry" : "shapes",
    tone,
    envelope: {
      enabled, swell: enabled && Boolean(envelope.swell),
      preset: ["pluck", "note", "sustain", "pad", "custom"].includes(envelope.preset) ? envelope.preset : "sustain",
      level: scalar(envelope.level, 0, 1, 1),
      points: sanitizeAmplitudeEnvelope(envelope.points ?? amplitudeEnvelopePreset("sustain")),
    },
    percussionAttack: scalar(source.percussionAttack, 0.5, 30, 3),
    percussionDecay: scalar(source.percussionDecay, 15, 2000, 110),
  };
}
