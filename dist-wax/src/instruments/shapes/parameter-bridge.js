import { createShapeInitialState, captureShapePresetParameters } from "../shape-synth/full-presets.js";
import { createSolidInitialState, createHyperInitialState } from "../../families/geometry-presets/initial-state.js";
import { SHAPES_TONE_KEYS } from "./synthesis-state.js";

const clone = value => structuredClone(value);
const readers = { trace: "points", scan: "line", radial: "radar" };

/** One owner per parameter: adapt names, not values or synthesis algorithms. */
export function applyOriginalParameters(state, kind, snapshot) {
  const p = snapshot.parameters;
  const dimension = { shape: "2d", solid: "3d", hyper: "4d" }[kind];
  state.selection.dimension = dimension;
  state.selection.playingMode = p.soundMode === "percussion" ? "notes" : "continuous";
  if (p.soundMode === "percussion") state.play.divisions = 1;
  state.synthesis.model = "geometry";
  Object.assign(state.play, { running: p.playing, rateCyclesPerSecond: p.speed, direction: p.traversalDirection ?? p.direction });
  Object.assign(state.voice, {
    engine: p.soundMode,
    baseHz: p.baseFrequency, rangeOctaves: p.pitchRange, presetLevel: p.level,
    voiceLimit: p.voiceLimit ?? 32, spread: p.stereoWidth ?? 1,
  });
  const local = state.dimension[dimension];
  if (kind === "shape") {
    state.profile = { sides: p.sides, kind: p.sides === 1 ? "circle" : p.sides === 2 ? "line" : p.closedShapeType, starDepth: p.starDepth };
    state.play.motion = p.motionMode;
    Object.assign(local, {
      reader: readers[p.playMethod], closedShapeType: p.closedShapeType,
      rotationRunning: p.autoRotate, rotationSpeed: p.rotationSpeed * p.rotationDirection,
      rotationMotion: p.rotationMotionMode,
    });
    for (const key of ["heads", "headOffsets", "scanLineAxes", "traceHeadDirections", "radialHeadDirections", "curvature", "aspect", "skew"]) local[key] = clone(p[key]);
    for (const key of SHAPES_TONE_KEYS) state.synthesis.tone[key] = clone(p[key]);
  } else {
    state.profile = { sides: p.profileSides, kind: p.profileSides === 1 ? "circle" : p.profileSides === 2 ? "line" : p.profileShapeType, starDepth: p.profileStarDepth };
    state.play.motion = "loop";
    local.representation = p.solidType ?? p.shapeType;
    state.synthesis.tone.fmIndex = p.fmIndex;
    state.synthesis.tone.fmRatio = p.fmRatio;
    state.synthesis.percussionAttack = p.percussionAttack;
    state.synthesis.percussionDecay = p.percussionDecay;
    state.synthesis.envelope = clone(snapshot.envelope);
    const axes = kind === "solid" ? ["x", "y", "z"] : ["xw", "yw", "zw"];
    for (const axis of axes) local.rotationMotion[axis] = { running: p[`rotation${axis.toUpperCase()}Playing`], speed: p[`rotation${axis.toUpperCase()}Speed`] };
    if (kind === "solid") {
      for (const [target, source] of [["readerYaw", "planeYaw"], ["readerPitch", "planePitch"]]) local.rotationMotion[target] = { running: p[`${source}Playing`], speed: p[`${source}Speed`] };
      for (const axis of ["x", "y", "z"]) local.scale[axis] = p[`formScale${axis.toUpperCase()}`];
      for (const axis of ["x", "z"]) local.skew[axis] = p[`formSkew${axis.toUpperCase()}`];
    } else {
      for (const axis of ["x", "y", "z", "w"]) local.scale[axis] = p[`hyperScale${axis.toUpperCase()}`];
    }
  }
  return state;
}

/** Virtual original state, derived from Shapes controls, never independently mutated. */
export function originalShapeState(state) {
  const local = state.dimension["2d"];
  return {
    ...createShapeInitialState(), ...state.synthesis.tone,
    sides: state.profile.sides, shapeType: state.profile.kind === "star" ? "star" : state.profile.sides === 1 ? "circle" : "polygon",
    closedShapeType: state.profile.sides > 2 ? (state.profile.kind === "star" ? "star" : "polygon") : local.closedShapeType,
    starDepth: state.profile.starDepth,
    ...Object.fromEntries(["curvature", "aspect", "skew", "rotation", "continuousRotation", "heads", "headOffsets", "scanLineAxes", "traceHeadDirections", "radialHeadDirections", "traceHeadDirectionAdjustments", "radialHeadDirectionAdjustments"].map(key => [key, local[key]])),
    rotationMotionMode: local.rotationMotion,
    playMethod: { points: "trace", line: "scan", radar: "radial" }[local.reader],
    motionMode: state.play.motion, autoRotate: local.rotationRunning,
    rotationSpeed: Math.abs(local.rotationSpeed), rotationDirection: local.rotationSpeed < 0 ? -1 : 1,
    audio: state.audio.enabled, playing: state.play.running,
    position: state.play.continuousPhase, continuousPosition: state.play.continuousPhase,
    speed: state.play.rateCyclesPerSecond, traversalDirection: state.play.direction,
    baseFrequency: state.voice.baseHz, pitchRange: state.voice.rangeOctaves, level: state.voice.presetLevel,
    stereoWidth: state.voice.spread,
    soundMode: state.voice.engine,
  };
}

export function captureOriginalParameters(state, kind) {
  if (kind === "shape") return { parameters: captureShapePresetParameters(originalShapeState(state)) };
  const p = kind === "solid" ? createSolidInitialState() : createHyperInitialState();
  const dimension = kind === "solid" ? "3d" : "4d", local = state.dimension[dimension];
  Object.assign(p, {
    playing: state.play.running, speed: state.play.rateCyclesPerSecond, direction: state.play.direction,
    soundMode: state.voice.engine,
    baseFrequency: state.voice.baseHz, pitchRange: state.voice.rangeOctaves, level: state.voice.presetLevel,
    voiceLimit: Math.min(kind === "solid" ? 32 : 20, state.voice.voiceLimit),
    profileSides: state.profile.sides, profileShapeType: state.profile.kind === "star" ? "star" : "polygon",
    profileStarDepth: state.profile.starDepth,
    fmIndex: state.synthesis.tone.fmIndex, fmRatio: state.synthesis.tone.fmRatio,
    percussionAttack: state.synthesis.percussionAttack, percussionDecay: state.synthesis.percussionDecay,
    [kind === "solid" ? "solidType" : "shapeType"]: local.representation,
  });
  for (const [axis, motion] of Object.entries(local.rotationMotion)) {
    const prefix = axis === "readerYaw" ? "planeYaw" : axis === "readerPitch" ? "planePitch" : `rotation${axis.toUpperCase()}`;
    p[`${prefix}Playing`] = motion.running; p[`${prefix}Speed`] = motion.speed;
  }
  for (const [axis, value] of Object.entries(local.scale)) p[`${kind === "solid" ? "formScale" : "hyperScale"}${axis.toUpperCase()}`] = value;
  if (kind === "solid") for (const [axis, value] of Object.entries(local.skew)) p[`formSkew${axis.toUpperCase()}`] = value;
  const live = ["audio", "position", "continuousPosition", "rotationX", "rotationY", "rotationZ", "planeYaw", "planePitch", "rotationXW", "rotationYW", "rotationZW"];
  for (const key of live) delete p[key];
  return { parameters: p, envelope: clone(state.synthesis.envelope) };
}
