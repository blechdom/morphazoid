import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  rayIntersections,
  verticalIntersections,
  wrap01,
} from "./src/geometry.js";
import {
  crossesPingPongTarget,
  crossesPeriodicTarget,
  motionSubsteps,
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import {
  amplitudeEnvelopePreset,
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  cornerStrikePeak,
  mapCurve01,
  normalizeStrikeGains,
  pitch01ToFrequency,
  sampleAmplitudeEnvelope,
  scaleShapeVoiceGains,
  synthParametersForMode,
  updateAmplitudeEnvelopeNode,
} from "./src/audio.js";
import {
  canonicalHeadOffsets,
  sanitizeHeadOffsets,
  updateHeadOffset,
  wrapOffset,
} from "./src/playheads.js";
import {
  evaluateMappingCurve,
  mappingCurvePreset,
  updateMappingCurveNode,
} from "./src/mapping.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const SPEED_MAX = 4;
const SPEED_CURVE = 5.6;
const MAX_CONTINUOUS_VOICES = 32;
const STRIKE_BATCH_CEILING = 0.78;
const AUDIO_LOOKAHEAD_SECONDS = 0.075;
const AUDIO_UPDATE_INTERVAL_MS = 24;
const HEAD_COLORS = ["#5fe8c4", "#7db4ff", "#c79bff", "#ffb86b"];
const SOUND_MODE_LABELS = {
  sine: "Sine",
  percussion: "Percussion",
  shepard: "Shepard glissando",
  fm: "FM",
  pm: "PM",
};
const SOUND_MODES = new Set(Object.keys(SOUND_MODE_LABELS));
const PITCH_SUMMARY_LABELS = {
  vertical: "Vertical",
  horizontal: "Horizontal",
  center: "Center distance",
};
const SOURCE_LABELS = {
  vertical: "Vertical position",
  horizontal: "Horizontal position",
  height: "Vertical position",
  center: "Distance from center",
  corner: "Corner sharpness",
  incidence: "Crossing angle",
  phase: "Contour position",
  fixed: "Fixed",
  signed: "Inner / outer polarity",
};
const TIMBRE_TARGET_LABELS = {
  fm: "FM index",
  pm: "Phase depth",
  shepard: "Spectral width",
};
const SOURCE_HELP = {
  vertical: "0 is stage top · 1 is stage bottom",
  horizontal: "0 is stage left · 1 is stage right",
  height: "0 is stage top · 1 is stage bottom",
  center: "0 is stage center · 1 is the outer edge",
  corner: "0 is smooth · 1 is the sharpest turn",
  incidence: "0 follows the contour · 1 crosses at 90°",
  phase: "0–1 position around the contour",
  fixed: "Every corner uses the same value",
  signed: "Inner and outer corners use opposite polarity",
};
const state = {
  sides: 4,
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
  lineCount: 1,
  scanLineAxes: ["vertical", "vertical", "vertical", "vertical"],
  motionMode: "loop",
  heads: 1,
  traceHeadOffsets: [0],
  scanHeadOffsets: [0],
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
  speed: 0.06,
  traversalDirection: 1,
  baseFrequency: 110,
  pitchRange: 2.5,
  level: 0.65,
  soundMode: "sine",
  amplitudeEnvelopeEnabled: true,
  cornerSwell: false,
  amplitudePreset: "pluck",
  amplitudeEnvelopePoints: amplitudeEnvelopePreset("pluck"),
  cornerAccent: 0.9,
  cornerAttack: 3,
  cornerDecay: 90,
  timbreSource: "corner",
  shepardCycles: 1,
  shepardDirection: 1,
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

state.baseFrequency = clamp(state.baseFrequency, 20, 440);
state.pitchRange = clamp(state.pitchRange, 0, 6);
state.level = clamp(state.level, 0, 1);
state.soundMode = SOUND_MODES.has(state.soundMode) ? state.soundMode : "sine";
state.cornerAccent = clamp(state.cornerAccent, 0, 1);
state.cornerAttack = clamp(state.cornerAttack, 0.5, 30);
if (state.cornerDecay < 15) state.cornerDecay = 90;
state.cornerDecay = clamp(state.cornerDecay, 15, 2000);
state.timbreSource = ["height", "horizontal", "center", "corner", "incidence", "phase"].includes(state.timbreSource)
  ? state.timbreSource
  : "corner";
state.shepardCycles = clamp(state.shepardCycles, 0.25, 4);
state.shepardDirection = state.shepardDirection < 0 ? -1 : 1;
state.shepardWidth = clamp(state.shepardWidth, 1, 8);
state.fmIndex = clamp(state.fmIndex, 0, 12);
state.fmRatio = clamp(state.fmRatio, 0.25, 8);
state.pmIndex = clamp(state.pmIndex, 0, 8);
state.pmRatio = clamp(state.pmRatio, 0.25, 8);
state.stereoWidth = clamp(state.stereoWidth, 0, 1);
state.stereoSource = ["horizontal", "vertical", "center"].includes(state.stereoSource)
  ? state.stereoSource
  : "horizontal";
state.stereoInverted = Boolean(state.stereoInverted);
state.pitchSource = ["vertical", "horizontal", "center"].includes(state.pitchSource)
  ? state.pitchSource
  : "vertical";
state.percussionLevelSource = ["corner", "incidence", "fixed", "signed"].includes(state.percussionLevelSource)
  ? state.percussionLevelSource
  : "corner";
state.percussionLevelCurve = ["linear", "exponential", "logarithmic", "smooth", "inverted"].includes(state.percussionLevelCurve)
  ? state.percussionLevelCurve
  : "linear";

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const pool = new VoicePool(MAX_CONTINUOUS_VOICES);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let pointerGesture = null;
let draggingHead = null;
let draggingPitchCurveNode = null;
let draggingAmplitudeNode = null;
let lastFrameTime = performance.now();
let lastAudioClockTime = null;
let lastUiUpdate = 0;
let lastAudioUpdate = -Infinity;
let cachedShape = null;
let cachedShapeKey = "";
let audioChanging = false;
let scheduledFrame = 0;
let cornerSnapshot = null;
let pendingCornerStrikes = [];

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function rotationAngleAtTravel(travel, mode = state.rotationMotionMode) {
  return mode === "pingpong"
    ? pingPong01(travel) * 360 - 180
    : normalizeDegrees(travel * 360);
}

function rebaseRotationTravel(angle = state.rotation, preferredLeg = null) {
  if (state.rotationMotionMode === "pingpong") {
    const physical = clamp((normalizeDegrees(angle) + 180) / 360, 0, 1);
    state.continuousRotation = preferredLeg === "ascending"
      ? Math.round((state.continuousRotation - physical) / 2) * 2 + physical
      : rebasePingPongPosition(state.continuousRotation, physical);
  } else {
    state.continuousRotation = rebaseContinuousPosition(
      state.continuousRotation,
      wrap01(state.continuousRotation),
      wrap01(normalizeDegrees(angle) / 360),
    );
  }
}

function setRotationAngle(angle, shouldAnnounce = false) {
  state.rotation = normalizeDegrees(angle);
  rebaseRotationTravel(state.rotation);
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
  resetCornerTracking();
  if (shouldAnnounce) announce(`Rotation reset to ${Math.round(state.rotation)} degrees.`);
  invalidate();
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function invalidate() {
  scheduleFrame();
}

function dismissHelp() {
  invalidate();
}

function resetCornerTracking() {
  cornerSnapshot = null;
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function formatSides(value = state.sides) {
  if (value === 1) return "1 · circle";
  if (value === 2) return "2 · open line";
  return `${value} · ${state.closedShapeType}`;
}

function formatCurvature(value = state.curvature) {
  if (state.sides === 1) return "continuous contour";
  if (Math.abs(value) < 0.005) return "straight";
  const amount = `${Math.round(Math.abs(value) * 100)}%`;
  return `${amount} ${value < 0 ? "inward" : "outward"}`;
}

function effectiveHeadCount() {
  return state.playMethod === "scan" ? state.lineCount : state.heads;
}

function scanAxesLabel() {
  const axes = state.scanLineAxes.slice(0, state.lineCount);
  if (axes.every((axis) => axis === "vertical")) return "vertical";
  if (axes.every((axis) => axis === "horizontal")) return "horizontal";
  return "mixed-axis";
}

function activeOffsetLayout() {
  return "parallel";
}

function offsetsForMethod(method = state.playMethod) {
  return method === "scan" ? state.scanHeadOffsets : state.traceHeadOffsets;
}

function setOffsetsForMethod(method, offsets) {
  if (method === "scan") state.scanHeadOffsets = offsets;
  else state.traceHeadOffsets = offsets;
}

function directionsForMethod(method = state.playMethod) {
  return method === "radial" ? state.radialHeadDirections : state.traceHeadDirections;
}

function directionAdjustmentsForMethod(method = state.playMethod) {
  return method === "radial"
    ? state.radialHeadDirectionAdjustments
    : state.traceHeadDirectionAdjustments;
}

function headDirection(headIndex, method = state.playMethod) {
  if (method === "scan") return 1;
  return directionsForMethod(method)[headIndex] < 0 ? -1 : 1;
}

function phaseOffsetForHead(headIndex, method = state.playMethod) {
  const count = method === "scan" ? state.lineCount : state.heads;
  const offsets = sanitizeHeadOffsets(offsetsForMethod(method), count, activeOffsetLayout(method));
  return offsets[headIndex] ?? 0;
}

function alignDirectionAdjustments(method = state.playMethod) {
  if (method === "scan") return;
  const count = method === state.playMethod ? effectiveHeadCount() : state.heads;
  const directions = directionsForMethod(method);
  const adjustments = directionAdjustmentsForMethod(method);
  for (let index = 0; index < count; index += 1) {
    adjustments[index] = (1 - (directions[index] < 0 ? -1 : 1)) * state.continuousPosition;
  }
}

function alignPointAndRadarDirections() {
  alignDirectionAdjustments("trace");
  alignDirectionAdjustments("radial");
}

function resetActiveHeadOffsets(shouldAnnounce = true) {
  const count = effectiveHeadCount();
  setOffsetsForMethod(
    state.playMethod,
    canonicalHeadOffsets(count, activeOffsetLayout()),
  );
  if (state.playMethod !== "scan") alignPointAndRadarDirections();
  resetCornerTracking();
  renderHeadLayout();
  if (shouldAnnounce) announce("Playheads reset to equal spacing.");
  invalidate();
}

function renderHeadLayout() {
  const count = effectiveHeadCount();
  const offsets = sanitizeHeadOffsets(offsetsForMethod(), count, activeOffsetLayout());
  const lines = state.playMethod === "scan";
  setOffsetsForMethod(state.playMethod, offsets);
  $("headLayoutTrack").classList.add("has-head-options");
  for (let index = 0; index < 12; index += 1) {
    const marker = $(`headMarker${index}`);
    marker.hidden = index >= count;
    const optionButton = $(`headOption${index}`);
    optionButton.hidden = index >= count;
    if (marker.hidden) continue;
    const displayPhase = wrap01(offsets[index]);
    const reader = lines ? `${scanAxisForHead(index)} line` : state.playMethod === "radial" ? "Radar ray" : "Point";
    marker.style.left = `${displayPhase * 100}%`;
    marker.style.top = "58%";
    marker.style.setProperty("--head-color", HEAD_COLORS[index % HEAD_COLORS.length]);
    marker.setAttribute("role", "slider");
    marker.setAttribute("aria-orientation", "horizontal");
    marker.setAttribute("aria-valuenow", displayPhase.toFixed(3));
    marker.setAttribute("aria-valuetext", `${(displayPhase * 100).toFixed(1)} percent relative phase`);
    marker.setAttribute("aria-label", `${reader} ${index + 1} relative phase`);
    optionButton.style.left = `${displayPhase * 100}%`;
    optionButton.style.setProperty("--head-color", HEAD_COLORS[index % HEAD_COLORS.length]);
    if (lines) {
      const horizontal = scanAxisForHead(index) === "horizontal";
      optionButton.textContent = horizontal ? "—" : "│";
      setPressed(optionButton, horizontal);
      optionButton.setAttribute("aria-label", `Line ${index + 1} ${horizontal ? "horizontal" : "vertical"}; rotate 90 degrees`);
      optionButton.title = `Rotate line ${index + 1} ${horizontal ? "vertical" : "horizontal"}`;
    } else {
      const reverse = headDirection(index) < 0;
      const noun = state.playMethod === "radial" ? "Radar ray" : "Point";
      optionButton.textContent = reverse ? "←" : "→";
      setPressed(optionButton, reverse);
      optionButton.setAttribute("aria-label", `${noun} ${index + 1} ${reverse ? "reverse" : "forward"}; change direction`);
      optionButton.title = `${reverse ? "Set forward" : "Reverse"} ${noun.toLowerCase()} ${index + 1}`;
    }
  }
}

function updateSectionSummaries() {
  const reader = state.playMethod === "scan" ? "Lines" : state.playMethod === "radial" ? "Radar" : "Points";
  $("playSummary").textContent = `${reader} · ${state.playing ? "playing" : "paused"}`;
  $("formSummary").textContent = state.sides === 1
    ? "circle · no corners"
    : state.sides === 2
    ? "open line"
    : `${state.sides}-point ${state.closedShapeType}`;
  $("soundSummary").textContent = SOUND_MODE_LABELS[state.soundMode];
  $("mappingSummary").textContent = `${PITCH_SUMMARY_LABELS[state.pitchSource] ?? "Source"} → pitch`;
}

function updateCanvasLabel() {
  const reader = state.playMethod === "scan"
    ? `${state.lineCount} ${scanAxesLabel()} ${state.motionMode} scanning ${plural(state.lineCount, "line")}`
    : state.playMethod === "radial"
      ? `${state.heads} rotating radar ${plural(state.heads, "ray", "rays")}`
    : `${state.heads} tracing ${plural(state.heads, "head")}`;
  canvas.setAttribute("aria-label", `Shape instrument canvas. ${formatSides()}; ${reader}.`);
}

function updatePlayheadStepper() {
  const scan = state.playMethod === "scan";
  const count = scan ? state.lineCount : state.heads;
  const noun = scan ? "line" : state.playMethod === "radial" ? "ray" : "point";
  $("playheadCountOut").textContent = `${count} ${plural(count, noun)}`;
  $("removePlayhead").disabled = count <= 1;
  $("addPlayhead").disabled = count >= (scan ? 4 : 12);
  $("playheadStepper").setAttribute(
    "aria-label",
    `${count} ${plural(count, noun)}. Add or remove playheads.`,
  );
}

function updateLineControls() {
  updateTraversalDirection();
  updateCanvasLabel();
  renderHeadLayout();
  updatePlayheadStepper();
  updateSectionSummaries();
}

function speedFromSlider(value) {
  const position = clamp(value, 0, 1);
  return SPEED_MAX * Math.expm1(SPEED_CURVE * position) / Math.expm1(SPEED_CURVE);
}

function sliderFromSpeed(value) {
  const speed = clamp(value, 0, SPEED_MAX);
  return Math.log1p(speed / SPEED_MAX * Math.expm1(SPEED_CURVE)) / SPEED_CURVE;
}

function formatPlayheadPosition() {
  return state.playMethod === "radial"
    ? `${(state.position * 360).toFixed(1)}°`
    : `${(state.position * 100).toFixed(1)}%`;
}

function formatPlayheadSpeed() {
  return `${state.speed.toFixed(3)} ${state.playMethod === "radial" ? "rev/s" : "cyc/s"}`;
}

function updatePlayheadReadouts() {
  const radar = state.playMethod === "radial";
  $("positionLabel").textContent = radar ? "Radar angle" : "Playhead position";
  $("speedLabel").textContent = radar ? "Radar speed" : "Playhead speed";
  $("positionOut").textContent = formatPlayheadPosition();
  $("speedOut").textContent = formatPlayheadSpeed();
  $("position").setAttribute("aria-label", radar ? "Radar angle from 0 to 360 degrees" : "Playhead position");
  $("position").setAttribute("aria-valuetext", formatPlayheadPosition());
  $("speed").setAttribute("aria-label", radar ? "Radar speed in revolutions per second" : "Playhead speed");
  $("speed").setAttribute("aria-valuetext", formatPlayheadSpeed());
}

function setPressed(button, pressed) {
  button.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const updateOutput = () => {
    if (output) output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    if (key === "rotation") state.rotation = normalizeDegrees(state.rotation);
    updateOutput();
    afterChange?.();
    dismissHelp();
  });
  input.value = String(state[key]);
  updateOutput();
  return updateOutput;
}

const updateSidesOutput = bindRange("sides", "sides", formatSides, () => {
  syncFormTopology();
  updateCurvatureOutput();
  updateTraversalDirection();
  updateCanvasLabel();
  updateSectionSummaries();
  resetCornerTracking();
});
$("rotation").addEventListener("input", () => {
  setRotationAngle(Number($("rotation").value));
  dismissHelp();
});
$("resetRotation").addEventListener("click", () => setRotationAngle(0, true));
const updateLineCountOutput = bindRange("lineCount", "lineCount", (value) => {
  return `${value} ${plural(value, "line")}`;
}, () => {
  state.scanHeadOffsets = canonicalHeadOffsets(state.lineCount);
  updateLineControls();
  resetCornerTracking();
});
const updateHeadsOutput = bindRange("heads", "heads", (value) => {
  return `${value} ${plural(value, "point")}`;
}, () => {
  state.traceHeadOffsets = canonicalHeadOffsets(state.heads);
  alignPointAndRadarDirections();
  updateLineControls();
  resetCornerTracking();
});
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/s`);
const updateCurvatureOutput = bindRange("curvature", "curvature", formatCurvature, resetCornerTracking);
const updateAspectOutput = bindRange("aspect", "aspect", (value) => {
  if (Math.abs(value) < 0.005) return "even";
  return `${Math.round(Math.abs(value) * 100)}% ${value > 0 ? "wide" : "tall"}`;
}, resetCornerTracking);
const updateSkewOutput = bindRange("skew", "skew", (value) => `${Math.round(value * 100)}%`, resetCornerTracking);
const updateStarDepthOutput = bindRange("starDepth", "starDepth", (value) => `${Math.round(value * 100)}%`, resetCornerTracking);
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("cornerAccent", "cornerAccent", (value) => `${Math.round(value * 100)}%`);
bindRange("cornerAttack", "cornerAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("cornerDecay", "cornerDecay", (value) => `${Math.round(cornerDecaySeconds(value) * 1000)} ms`);
bindRange("shepardCycles", "shepardCycles", (value) => `${value.toFixed(2)} oct / circuit`);
bindRange("shepardWidth", "shepardWidth", (value) => `${value.toFixed(1)} oct max`, updateTimbreMappingUi);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`, updateTimbreMappingUi);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("pmIndex", "pmIndex", (value) => `${value.toFixed(2)} rad max`, updateTimbreMappingUi);
bindRange("pmRatio", "pmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`, updateStereoMappingUi);

function syncFormTopology(shouldAnnounce = false) {
  const circle = state.sides === 1;
  const closed = state.sides >= 3;
  state.shapeType = circle ? "circle" : closed ? state.closedShapeType : "polygon";
  $("closedShapeControl").hidden = !closed;
  $("starDepthControl").hidden = !closed || state.closedShapeType !== "star";
  for (const button of $("closedShapeType").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.closedShapeType);
  }
  $("curvatureControl").hidden = circle;
  $("sineModeOption").textContent = circle ? "Sine · continuous contour" : "Sine · corner envelope";
  updateAmplitudeArticulationVisibility();
  updateSectionSummaries();
  resetCornerTracking();
  if (shouldAnnounce) {
    announce(circle
      ? "One selected: a smooth circle with no corners."
      : state.sides === 2
        ? "Two selected: an open line."
        : `${state.sides}-point ${state.closedShapeType} selected.`);
  }
  invalidate();
}

function setClosedShapeType(shapeType, shouldAnnounce = true) {
  state.closedShapeType = shapeType === "star" ? "star" : "polygon";
  syncFormTopology(false);
  updateSidesOutput();
  updateSectionSummaries();
  updateCanvasLabel();
  resetCornerTracking();
  if (shouldAnnounce) announce(`${state.closedShapeType === "star" ? "Star" : "Polygon"} contour selected.`);
}

for (const button of $("closedShapeType").querySelectorAll("button")) {
  button.addEventListener("click", () => setClosedShapeType(button.dataset.value));
}

function resetFormRange(id, key, updateOutput, label) {
  state[key] = 0;
  $(id).value = "0";
  updateOutput();
  resetCornerTracking();
  announce(`${label} reset.`);
  invalidate();
}

$("resetCurvature").addEventListener("click", () => {
  resetFormRange("curvature", "curvature", updateCurvatureOutput, "Roundness");
});
$("resetAspect").addEventListener("click", () => {
  resetFormRange("aspect", "aspect", updateAspectOutput, "Stretch");
});
$("resetSkew").addEventListener("click", () => {
  resetFormRange("skew", "skew", updateSkewOutput, "Skew");
});

$("resetForm").addEventListener("click", () => {
  state.closedShapeType = "polygon";
  state.starDepth = 0.48;
  state.curvature = 0;
  state.aspect = 0;
  state.skew = 0;
  $("starDepth").value = "0.48";
  $("curvature").value = "0";
  $("aspect").value = "0";
  $("skew").value = "0";
  syncFormTopology(false);
  updateSidesOutput();
  updateStarDepthOutput();
  updateCurvatureOutput();
  updateAspectOutput();
  updateSkewOutput();
  updateTraversalDirection();
  updateCanvasLabel();
  announce("Form reset.");
  invalidate();
});

function setPlayMethod(method, shouldAnnounce = true) {
  const nextMethod = ["trace", "scan", "radial"].includes(method) ? method : "trace";
  if (nextMethod !== state.playMethod) {
    state.continuousPosition = state.motionMode === "pingpong"
      ? rebasePingPongPosition(state.continuousPosition, state.position)
      : rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
      );
  }
  state.playMethod = nextMethod;
  for (const button of $("playMethod").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.playMethod);
  }

  const isScan = state.playMethod === "scan";
  $("headsControl").hidden = isScan;
  $("lineCountControl").hidden = !isScan;
  updatePlayheadReadouts();
  updateLineCountOutput();
  updateHeadsOutput();
  updateLineControls();
  updateTimbreMappingUi();
  resetCornerTracking();
  if (shouldAnnounce) {
    announce(isScan
      ? `Line playheads selected. ${state.lineCount} ${plural(state.lineCount, "line")} active.`
      : state.playMethod === "radial"
        ? `Radar playhead selected. ${state.heads} rotating ${plural(state.heads, "ray")} active.`
      : `Point playheads selected. ${state.heads} ${plural(state.heads, "point")} active.`);
  }
  dismissHelp();
}

for (const button of $("playMethod").querySelectorAll("button")) {
  button.addEventListener("click", () => setPlayMethod(button.dataset.value));
}

function changePlayheadCount(delta) {
  if (state.playMethod === "scan") {
    state.lineCount = Math.round(clamp(state.lineCount + delta, 1, 4));
    $("lineCount").value = String(state.lineCount);
    state.scanHeadOffsets = canonicalHeadOffsets(state.lineCount);
    updateLineCountOutput();
  } else {
    state.heads = Math.round(clamp(state.heads + delta, 1, 12));
    $("heads").value = String(state.heads);
    state.traceHeadOffsets = canonicalHeadOffsets(state.heads);
    alignPointAndRadarDirections();
    updateHeadsOutput();
  }
  updateLineControls();
  resetCornerTracking();
  announce(`${$("playheadCountOut").textContent} active.`);
  invalidate();
}

$("removePlayhead").addEventListener("click", () => changePlayheadCount(-1));
$("addPlayhead").addEventListener("click", () => changePlayheadCount(1));

function toggleHeadOption(index, shouldAnnounce = true) {
  if (!Number.isInteger(index) || index < 0 || index >= effectiveHeadCount()) return;
  let message;
  if (state.playMethod === "scan") {
    const current = state.scanLineAxes[index] === "horizontal" ? "horizontal" : "vertical";
    state.scanLineAxes[index] = current === "vertical" ? "horizontal" : "vertical";
    message = `Line ${index + 1} rotated to ${state.scanLineAxes[index]}.`;
  } else {
    const method = state.playMethod;
    const beforeTravel = directionalHeadTravel(state.continuousPosition, index, method);
    const directions = directionsForMethod();
    directions[index] = directions[index] < 0 ? 1 : -1;
    const adjustments = directionAdjustmentsForMethod();
    adjustments[index] = beforeTravel
      - directions[index] * state.continuousPosition
      - phaseOffsetForHead(index, method);
    const noun = state.playMethod === "radial" ? "Radar ray" : "Point";
    message = `${noun} ${index + 1} set to ${directions[index] < 0 ? "reverse" : "forward"}.`;
  }
  updateLineControls();
  resetCornerTracking();
  if (shouldAnnounce) announce(message);
  invalidate();
}

for (let index = 0; index < 12; index += 1) {
  $(`headOption${index}`).addEventListener("click", () => toggleHeadOption(index));
}

function setMotionMode(motion, shouldAnnounce = true) {
  const nextMotion = motion === "loop" ? "loop" : "pingpong";
  if (nextMotion !== state.motionMode) {
    if (nextMotion === "pingpong") {
      state.continuousPosition = rebasePingPongPosition(
        state.continuousPosition,
        state.position,
      );
    } else {
      state.continuousPosition = rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
      );
    }
    state.motionMode = nextMotion;
    resetCornerTracking();
  }
  for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.motionMode);
  }
  updateTraversalDirection();
  updateCanvasLabel();
  if (shouldAnnounce) announce(`${state.motionMode === "pingpong" ? "Ping-pong" : "Loop"} playhead movement selected.`);
  invalidate();
}

for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
  button.addEventListener("click", () => setMotionMode(button.dataset.value));
}

function setCustomHeadOffset(index, displayPhase, shouldAnnounce = false) {
  const count = effectiveHeadCount();
  const offsets = sanitizeHeadOffsets(offsetsForMethod(), count, activeOffsetLayout());
  setOffsetsForMethod(
    state.playMethod,
    updateHeadOffset(offsets, index, wrapOffset(displayPhase)),
  );
  resetCornerTracking();
  renderHeadLayout();
  if (shouldAnnounce) announce(`Playhead ${index + 1} spacing changed.`);
  invalidate();
}

function headPhaseFromPointer(event) {
  const bounds = $("headLayoutTrack").getBoundingClientRect();
  return clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
}

for (let index = 0; index < 12; index += 1) {
  const marker = $(`headMarker${index}`);
  marker.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    draggingHead = { index, pointerId: event.pointerId };
    $("headLayoutTrack").setPointerCapture?.(event.pointerId);
    setCustomHeadOffset(index, headPhaseFromPointer(event));
  });
  marker.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = wrap01(phaseOffsetForHead(index));
    const step = event.shiftKey ? 0.05 : 0.01;
    setCustomHeadOffset(index, current + (event.key === "ArrowLeft" ? -step : step), true);
  });
}

$("headLayoutTrack").addEventListener("pointermove", (event) => {
  if (!draggingHead || event.pointerId !== draggingHead.pointerId) return;
  setCustomHeadOffset(draggingHead.index, headPhaseFromPointer(event));
});

function endHeadDrag(event) {
  if (!draggingHead || event.pointerId !== draggingHead.pointerId) return;
  announce(`Playhead ${draggingHead.index + 1} spacing changed.`);
  draggingHead = null;
}

$("headLayoutTrack").addEventListener("pointerup", endHeadDrag);
$("headLayoutTrack").addEventListener("pointercancel", endHeadDrag);
$("resetHeadSpacing").addEventListener("click", () => resetActiveHeadOffsets());

function setSoundMode(mode, shouldAnnounce = true) {
  const nextMode = SOUND_MODES.has(mode) ? mode : "sine";
  if (nextMode !== state.soundMode) {
    pool.silence();
    state.soundMode = nextMode;
    resetCornerTracking();
  }
  $("soundMode").value = state.soundMode;
  updateAmplitudeArticulationVisibility();
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  $("shepardArticulation").hidden = state.soundMode !== "shepard";
  $("fmArticulation").hidden = state.soundMode !== "fm";
  $("pmArticulation").hidden = state.soundMode !== "pm";
  $("percussionMapping").hidden = state.soundMode !== "percussion";
  $("timbreMapping").hidden = !["fm", "pm", "shepard"].includes(state.soundMode);
  updateTimbreMappingUi();
  updateSectionSummaries();
  if (shouldAnnounce) {
    const descriptions = {
      sine: "Continuous sine with corner amplitude selected.",
      percussion: "Percussion corner strikes selected.",
      shepard: "Transport-locked Shepard glissando with mapped spectral width selected.",
      fm: "Frequency modulation with mapped FM index selected.",
      pm: "Phase modulation with mapped phase depth selected.",
    };
    announce(descriptions[state.soundMode]);
  }
  invalidate();
}

function updateAmplitudeArticulationVisibility() {
  $("amplitudeArticulation").hidden = state.soundMode === "percussion" || state.shapeType === "circle";
}

$("soundMode").value = state.soundMode;
$("soundMode").addEventListener("change", (event) => {
  setSoundMode(event.currentTarget.value);
});

$("shepardDirection").value = String(state.shepardDirection);
$("shepardDirection").addEventListener("change", (event) => {
  state.shepardDirection = Number(event.currentTarget.value) < 0 ? -1 : 1;
  invalidate();
});

function setRotationPlaying(playing, shouldAnnounce = true) {
  state.autoRotate = Boolean(playing);
  setPressed($("rotationPlayButton"), state.autoRotate);
  $("rotationPlayButton").setAttribute("aria-label", state.autoRotate ? "Pause rotation" : "Start rotation");
  if (!state.autoRotate && !state.playing) pool.silence();
  lastFrameTime = performance.now();
  lastAudioClockTime = pool.context?.currentTime ?? null;
  if (shouldAnnounce) announce(state.autoRotate ? "Rotation playing." : "Rotation paused.");
  dismissHelp();
}

$("rotationPlayButton").addEventListener("click", () => setRotationPlaying(!state.autoRotate));

function setRotationDirection(direction, shouldAnnounce = true) {
  state.rotationDirection = direction < 0 ? -1 : 1;
  const clockwise = state.rotationDirection > 0;
  $("rotationDirectionGlyph").textContent = clockwise ? "→" : "←";
  $("rotationDirectionText").textContent = clockwise ? "CW" : "CCW";
  $("rotationDirection").setAttribute("aria-label", `Rotation direction: ${clockwise ? "clockwise" : "counterclockwise"}`);
  if (shouldAnnounce) {
    announce(`Rotation direction ${state.rotationDirection > 0 ? "clockwise" : "counterclockwise"}.`);
  }
  invalidate();
}

$("rotationDirection").addEventListener("click", () => setRotationDirection(-state.rotationDirection));

function setRotationMotionMode(motion, shouldAnnounce = true) {
  const nextMotion = motion === "pingpong" ? "pingpong" : "loop";
  if (nextMotion !== state.rotationMotionMode) {
    state.rotationMotionMode = nextMotion;
    rebaseRotationTravel(state.rotation, nextMotion === "pingpong" ? "ascending" : null);
    resetCornerTracking();
  }
  for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.rotationMotionMode);
  }
  if (shouldAnnounce) announce(`${nextMotion === "pingpong" ? "Ping-pong" : "Loop"} rotation selected.`);
  invalidate();
}

for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
  button.addEventListener("click", () => setRotationMotionMode(button.dataset.value));
}

for (const [id, key] of [
  ["percussionLevelSource", "percussionLevelSource"],
  ["percussionLevelCurve", "percussionLevelCurve"],
  ["timbreSource", "timbreSource"],
]) {
  $(id).value = state[key];
  $(id).addEventListener("change", (event) => {
    state[key] = event.currentTarget.value;
    if (["timbreSource", "percussionLevelSource"].includes(key)) updateTimbreMappingUi();
    dismissHelp();
  });
}

function timbreMappedRangeLabel() {
  if (state.soundMode === "fm") return `0–${state.fmIndex.toFixed(2)} index`;
  if (state.soundMode === "pm") return `0–${state.pmIndex.toFixed(2)} rad`;
  return `1.0–${state.shepardWidth.toFixed(1)} oct`;
}

function updateTimbreMappingUi() {
  const source = SOURCE_LABELS[state.timbreSource] ?? "Source value";
  const target = TIMBRE_TARGET_LABELS[state.soundMode] ?? "Timbre";
  const helpForSource = (sourceName) => (
    sourceName === "incidence" && state.playMethod === "trace"
      ? "Point playheads follow the contour · crossing angle stays 0"
      : SOURCE_HELP[sourceName] ?? "Normalized source value from 0–1"
  );
  $("timbreMappingNote").textContent = `${source} → ${target} · ${timbreMappedRangeLabel()}`;
  $("timbreSourceHelp").textContent = helpForSource(state.timbreSource);
  $("percussionSourceHelp").textContent = helpForSource(state.percussionLevelSource);
}

function setPitchDimension(source, shouldAnnounce = true) {
  state.pitchSource = ["horizontal", "center"].includes(source) ? source : "vertical";
  for (const button of $("pitchDimension").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.pitchSource);
  }
  updateSectionSummaries();
  if (shouldAnnounce) announce(`${PITCH_SUMMARY_LABELS[state.pitchSource]} position mapped to pitch.`);
  invalidate();
}

for (const button of $("pitchDimension").querySelectorAll("button")) {
  button.addEventListener("click", () => setPitchDimension(button.dataset.value));
}

const STEREO_SOURCE_LABELS = {
  horizontal: "Horizontal position",
  vertical: "Vertical position",
  center: "Distance from center",
};

function stereoMappingDescription() {
  const descriptions = {
    horizontal: ["Stage left → audio left · stage right → audio right", "Stage left → audio right · stage right → audio left"],
    vertical: ["Stage top → audio left · stage bottom → audio right", "Stage top → audio right · stage bottom → audio left"],
    center: ["Stage center → audio left · outer edge → audio right", "Stage center → audio right · outer edge → audio left"],
  };
  return descriptions[state.stereoSource][state.stereoInverted ? 1 : 0];
}

function updateStereoMappingUi() {
  $("stereoMappingNote").textContent = stereoMappingDescription();
  setPressed($("stereoInvert"), state.stereoInverted);
  $("stereoInvert").setAttribute("aria-label", `${state.stereoInverted ? "Restore" : "Reverse"} ${state.stereoSource} stereo direction`);
  $("panRouteSource").textContent = STEREO_SOURCE_LABELS[state.stereoSource];
  $("panRouteCurve").textContent = `${state.stereoInverted ? "reversed" : "normal"} · ${Math.round(state.stereoWidth * 100)}% width`;
}

function setStereoDimension(source, shouldAnnounce = true) {
  state.stereoSource = ["vertical", "center"].includes(source) ? source : "horizontal";
  for (const button of $("stereoDimension").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.stereoSource);
  }
  updateStereoMappingUi();
  if (shouldAnnounce) announce(`${STEREO_SOURCE_LABELS[state.stereoSource]} mapped to stereo position.`);
  invalidate();
}

for (const button of $("stereoDimension").querySelectorAll("button")) {
  button.addEventListener("click", () => setStereoDimension(button.dataset.value));
}

$("stereoInvert").addEventListener("click", () => {
  state.stereoInverted = !state.stereoInverted;
  updateStereoMappingUi();
  announce(`${state.stereoSource} stereo direction ${state.stereoInverted ? "reversed" : "restored"}.`);
  invalidate();
});

const PITCH_CURVE_LABELS = {
  linear: "Linear",
  exponential: "Exponential",
  logarithmic: "Logarithmic",
  smooth: "Smooth",
  inverted: "Inverted",
  custom: "Custom",
};

function pitchCurvePathData(nodes = state.pitchCurveNodes) {
  return nodes.map((node, index) => {
    const x = (node.x * 240).toFixed(2);
    const y = ((1 - node.y) * 96).toFixed(2);
    return `${index ? "L" : "M"}${x} ${y}`;
  }).join(" ");
}

function renderPitchCurve() {
  $("pitchCurvePath").setAttribute("d", pitchCurvePathData());
  $("pitchCurveState").textContent = PITCH_CURVE_LABELS[state.pitchCurvePreset] ?? "Custom";
  for (const button of $("pitchCurvePresets").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.pitchCurvePreset);
  }
  state.pitchCurveNodes.forEach((node, index) => {
    const handle = $(`pitchCurveNode${index}`);
    const inputPercent = Math.round(node.x * 100);
    const outputPercent = Math.round(node.y * 100);
    handle.style.left = `${node.x * 100}%`;
    handle.style.top = `${(1 - node.y) * 100}%`;
    handle.setAttribute("aria-label", `Pitch curve node ${index + 1}: input ${inputPercent} percent, output ${outputPercent} percent`);
    handle.setAttribute("aria-valuenow", String(outputPercent));
    handle.setAttribute("aria-valuetext", `${inputPercent} percent input maps to ${outputPercent} percent output`);
  });
}

function selectPitchCurvePreset(preset, shouldAnnounce = true) {
  state.pitchCurvePreset = PITCH_CURVE_LABELS[preset] ? preset : "linear";
  state.pitchCurveNodes = mappingCurvePreset(state.pitchCurvePreset);
  renderPitchCurve();
  if (shouldAnnounce) announce(`${PITCH_CURVE_LABELS[state.pitchCurvePreset]} pitch response selected.`);
  invalidate();
}

function setPitchCurveNode(index, point, shouldAnnounce = false) {
  state.pitchCurveNodes = updateMappingCurveNode(state.pitchCurveNodes, index, point);
  state.pitchCurvePreset = "custom";
  renderPitchCurve();
  if (shouldAnnounce) {
    const node = state.pitchCurveNodes[index];
    announce(`Pitch curve node ${index + 1}: ${Math.round(node.x * 100)} percent input, ${Math.round(node.y * 100)} percent output.`);
  }
  invalidate();
}

for (const button of $("pitchCurvePresets").querySelectorAll("button")) {
  button.addEventListener("click", () => selectPitchCurvePreset(button.dataset.value));
}

function pitchCurvePointFromPointer(event) {
  const bounds = $("pitchCurveEditor").getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    y: clamp(1 - (event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
  };
}

for (let index = 0; index < 5; index += 1) {
  const handle = $(`pitchCurveNode${index}`);
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault?.();
    draggingPitchCurveNode = { index, pointerId: event.pointerId };
    $("pitchCurveEditor").setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const node = state.pitchCurveNodes[index];
    setPitchCurveNode(index, {
      x: node.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: node.y + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0),
    }, true);
  });
}

$("pitchCurveEditor").addEventListener("pointermove", (event) => {
  if (!draggingPitchCurveNode || event.pointerId !== draggingPitchCurveNode.pointerId) return;
  setPitchCurveNode(draggingPitchCurveNode.index, pitchCurvePointFromPointer(event));
});

function endPitchCurveDrag(event) {
  if (!draggingPitchCurveNode || event.pointerId !== draggingPitchCurveNode.pointerId) return;
  const index = draggingPitchCurveNode.index;
  draggingPitchCurveNode = null;
  const node = state.pitchCurveNodes[index];
  announce(`Pitch curve node ${index + 1}: ${Math.round(node.x * 100)} percent input, ${Math.round(node.y * 100)} percent output.`);
}

$("pitchCurveEditor").addEventListener("pointerup", endPitchCurveDrag);
$("pitchCurveEditor").addEventListener("pointercancel", endPitchCurveDrag);
$("resetPitchCurve").addEventListener("click", () => selectPitchCurvePreset("linear"));

const AMPLITUDE_NODE_NAMES = ["Trigger", "Attack", "Decay", "Sustain", "Release"];
const AMPLITUDE_PRESET_LABELS = {
  pluck: "Pluck",
  note: "Note",
  sustain: "Sustain",
  pad: "Pad",
  custom: "Custom",
};

function amplitudeCurvePathData(points = state.amplitudeEnvelopePoints) {
  const commands = points.map((point, index) => {
    const x = (point.x * 240).toFixed(2);
    const y = ((1 - point.y) * 96).toFixed(2);
    return `${index ? "L" : "M"}${x} ${y}`;
  });
  const release = points.at(-1);
  if (release.x < 1) commands.push(`L240.00 ${((1 - release.y) * 96).toFixed(2)}`);
  return commands.join(" ");
}

function updateAmplitudeUi() {
  const release = state.amplitudeEnvelopePoints.at(-1);
  $("amplitudeCurvePath").setAttribute("d", amplitudeCurvePathData());
  $("amplitudeCurveState").textContent = state.amplitudeEnvelopeEnabled
    ? AMPLITUDE_PRESET_LABELS[state.amplitudePreset] ?? "Custom"
    : "Bypassed";
  setPressed($("amplitudeEnvelopeToggle"), state.amplitudeEnvelopeEnabled);
  $("amplitudeEnvelopeToggle").setAttribute("aria-label", `Amplitude ADSR ${state.amplitudeEnvelopeEnabled ? "on" : "off"}`);
  $("amplitudeEnvelopeToggleText").textContent = state.amplitudeEnvelopeEnabled ? "On" : "Off";
  setPressed($("cornerSwellToggle"), state.cornerSwell);
  $("cornerSwellToggle").setAttribute("aria-label", `Corner swell ${state.cornerSwell ? "on" : "off"}`);
  $("amplitudeCurveEditor").classList.toggle("is-disabled", !state.amplitudeEnvelopeEnabled);
  $("amplitudeCurveEditor").setAttribute("aria-disabled", String(!state.amplitudeEnvelopeEnabled));
  for (const button of $("amplitudeEnvelopePresets").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.amplitudePreset);
    button.disabled = !state.amplitudeEnvelopeEnabled;
  }
  $("resetAmplitudeCurve").disabled = !state.amplitudeEnvelopeEnabled;
  $("cornerSwellToggle").disabled = !state.amplitudeEnvelopeEnabled;
  state.amplitudeEnvelopePoints.forEach((point, index) => {
    const handle = $(`amplitudeNode${index}`);
    const intervalPercent = Math.round(point.x * 100);
    const levelPercent = Math.round(point.y * 100);
    handle.style.left = `${point.x * 100}%`;
    handle.style.top = `${(1 - point.y) * 100}%`;
    handle.setAttribute("aria-label", `${AMPLITUDE_NODE_NAMES[index]}: ${intervalPercent} percent interval, ${levelPercent} percent level`);
    handle.setAttribute("aria-valuenow", String(levelPercent));
    handle.setAttribute("aria-valuetext", `${intervalPercent} percent interval, ${levelPercent} percent level`);
    handle.disabled = !state.amplitudeEnvelopeEnabled;
  });
  $("amplitudeReleaseBehavior").textContent = !state.amplitudeEnvelopeEnabled
    ? "ADSR off · constant per-voice level"
    : release.y <= 0.005
      ? "Release reaches zero · voice rests until next trigger"
      : `Release holds ${Math.round(release.y * 100)}% · voice continues until next trigger`;
}

function selectAmplitudePreset(preset, shouldAnnounce = true) {
  state.amplitudePreset = ["note", "sustain", "pad"].includes(preset) ? preset : "pluck";
  state.amplitudeEnvelopePoints = amplitudeEnvelopePreset(state.amplitudePreset);
  updateAmplitudeUi();
  if (shouldAnnounce) announce(`${AMPLITUDE_PRESET_LABELS[state.amplitudePreset]} amplitude ADSR selected.`);
  invalidate();
}

function setAmplitudeNode(index, point, shouldAnnounce = false) {
  state.amplitudeEnvelopePoints = updateAmplitudeEnvelopeNode(state.amplitudeEnvelopePoints, index, point);
  state.amplitudePreset = "custom";
  updateAmplitudeUi();
  if (shouldAnnounce) {
    const node = state.amplitudeEnvelopePoints[index];
    announce(`${AMPLITUDE_NODE_NAMES[index]}: ${Math.round(node.x * 100)} percent interval, ${Math.round(node.y * 100)} percent level.`);
  }
  invalidate();
}

for (const button of $("amplitudeEnvelopePresets").querySelectorAll("button")) {
  button.addEventListener("click", () => selectAmplitudePreset(button.dataset.value));
}

function amplitudePointFromPointer(event) {
  const bounds = $("amplitudeCurveEditor").getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    y: clamp(1 - (event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
  };
}

for (let index = 0; index < 5; index += 1) {
  const handle = $(`amplitudeNode${index}`);
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault?.();
    draggingAmplitudeNode = { index, pointerId: event.pointerId };
    $("amplitudeCurveEditor").setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const node = state.amplitudeEnvelopePoints[index];
    setAmplitudeNode(index, {
      x: node.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: node.y + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0),
    }, true);
  });
}

$("amplitudeCurveEditor").addEventListener("pointermove", (event) => {
  if (!draggingAmplitudeNode || event.pointerId !== draggingAmplitudeNode.pointerId) return;
  setAmplitudeNode(draggingAmplitudeNode.index, amplitudePointFromPointer(event));
});

function endAmplitudeDrag(event) {
  if (!draggingAmplitudeNode || event.pointerId !== draggingAmplitudeNode.pointerId) return;
  const index = draggingAmplitudeNode.index;
  draggingAmplitudeNode = null;
  const node = state.amplitudeEnvelopePoints[index];
  announce(`${AMPLITUDE_NODE_NAMES[index]}: ${Math.round(node.x * 100)} percent interval, ${Math.round(node.y * 100)} percent level.`);
}

$("amplitudeCurveEditor").addEventListener("pointerup", endAmplitudeDrag);
$("amplitudeCurveEditor").addEventListener("pointercancel", endAmplitudeDrag);
$("resetAmplitudeCurve").addEventListener("click", () => selectAmplitudePreset("pluck"));
$("amplitudeEnvelopeToggle").addEventListener("click", () => {
  state.amplitudeEnvelopeEnabled = !state.amplitudeEnvelopeEnabled;
  updateAmplitudeUi();
  announce(`Amplitude ADSR ${state.amplitudeEnvelopeEnabled ? "on" : "off"}.`);
  invalidate();
});
$("cornerSwellToggle").addEventListener("click", () => {
  state.cornerSwell = !state.cornerSwell;
  updateAmplitudeUi();
  announce(`Corner swell ${state.cornerSwell ? "on" : "off"}.`);
  invalidate();
});

const speedInput = $("speed");
speedInput.value = String(sliderFromSpeed(state.speed));
speedInput.addEventListener("input", () => {
  state.speed = speedFromSlider(Number(speedInput.value));
  $("speedOut").textContent = formatPlayheadSpeed();
  speedInput.setAttribute("aria-valuetext", formatPlayheadSpeed());
  dismissHelp();
});

function setPosition(value) {
  const nextPosition = clamp(value, 0, 1);
  state.continuousPosition = state.motionMode === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(
      state.continuousPosition,
      state.position,
      nextPosition,
    );
  state.position = nextPosition;
  $("position").value = String(state.position);
  $("positionOut").textContent = formatPlayheadPosition();
  $("position").setAttribute("aria-valuetext", formatPlayheadPosition());
}

$("position").addEventListener("input", () => {
  setPosition(Number($("position").value));
  dismissHelp();
});

function setPlaying(playing) {
  state.playing = Boolean(playing);
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause playhead" : "Play playhead");
  if (!state.playing && !state.autoRotate) pool.silence();
  lastFrameTime = performance.now();
  lastAudioClockTime = pool.context?.currentTime ?? null;
  if (state.playing && state.audio) {
    strikeCurrentCorners();
    flushCornerStrikes();
  }
  updateSectionSummaries();
  announce(state.playing ? "Playing." : "Paused.");
  dismissHelp();
}

$("playButton").addEventListener("click", () => setPlaying(!state.playing));

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

async function toggleAudio() {
  if (audioChanging) return;
  if (state.audio) {
    state.audio = false;
    pool.disable();
    paintAudioState();
    announce("Audio off.");
    invalidate();
    return;
  }

  audioChanging = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting…";
  $("audioError").hidden = true;
  try {
    await pool.enable();
    pool.setVoices([]);
    pool.setLevel(state.level);
    state.audio = true;
    paintAudioState();
    announce(`Audio on. ${SOUND_MODE_LABELS[state.soundMode]} is ready.`);
    dismissHelp();
  } catch (error) {
    state.audio = false;
    $("audioState").textContent = "unavailable";
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
  } finally {
    audioChanging = false;
    $("audioButton").disabled = false;
  }
}

$("audioButton").addEventListener("click", toggleAudio);

function updateTraversalDirection() {
  const forward = state.traversalDirection > 0;
  const bouncing = state.motionMode === "pingpong";
  const openPoints = state.playMethod === "trace" && state.sides === 2;
  const closedPoints = state.playMethod === "trace" && state.sides !== 2;
  const radial = state.playMethod === "radial";
  const glyph = forward ? "→" : "←";
  const text = bouncing
    ? (forward ? "FWD" : "REV")
    : openPoints ? (forward ? "FWD" : "REV")
        : closedPoints || radial ? (forward ? "CW" : "CCW") : (forward ? "L→R" : "R→L");
  const label = bouncing
    ? `${forward ? "Forward" : "Reverse"} ping-pong travel`
    : openPoints
        ? `${forward ? "Forward" : "Reverse"} point traversal`
        : closedPoints || radial
          ? `${radial ? "Radar sweep" : "Trace"} ${forward ? "clockwise" : "counterclockwise"}`
          : `Scan ${forward ? "left to right" : "right to left"}`;

  $("traversalDirectionGlyph").textContent = glyph;
  $("traversalDirectionText").textContent = text;
  $("traversalDirection").setAttribute("aria-label", `Playhead direction: ${label}`);
}

function setTraversalDirection(direction, shouldAnnounce = true) {
  state.traversalDirection = direction < 0 ? -1 : 1;
  updateTraversalDirection();
  if (shouldAnnounce) announce(`Playhead direction ${state.traversalDirection > 0 ? "forward" : "reverse"}.`);
  invalidate();
}

$("traversalDirection").addEventListener("click", () => setTraversalDirection(-state.traversalDirection));

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  const pixelBudgetRatio = Math.sqrt(3_000_000 / (cssWidth * cssHeight));
  pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, pixelBudgetRatio));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  invalidate();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function currentShape() {
  const key = [
    state.sides,
    state.shapeType,
    state.starDepth.toFixed(4),
    state.curvature.toFixed(4),
    state.aspect.toFixed(4),
    state.skew.toFixed(4),
    state.rotation.toFixed(4),
  ].join("|");
  if (cachedShape && cachedShapeKey === key) return cachedShape;
  cachedShapeKey = key;
  cachedShape = buildShape({
    sides: state.sides,
    shapeType: state.shapeType,
    starDepth: state.starDepth,
    curvature: state.curvature,
    aspect: state.aspect,
    skew: state.skew,
    rotationDeg: state.rotation,
    samplesPerEdge: 48,
  });
  return cachedShape;
}

function shapeAtRotation(rotationDeg) {
  return buildShape({
    sides: state.sides,
    shapeType: state.shapeType,
    starDepth: state.starDepth,
    curvature: state.curvature,
    aspect: state.aspect,
    skew: state.skew,
    rotationDeg,
    samplesPerEdge: 48,
  });
}

function directionalHeadTravel(position, headIndex, method = state.playMethod) {
  const adjustment = directionAdjustmentsForMethod(method)[headIndex] ?? 0;
  return headDirection(headIndex, method) * position
    + phaseOffsetForHead(headIndex, method)
    + adjustment;
}

function phaseForHead(position, headIndex, headCount, method = "trace") {
  const travel = directionalHeadTravel(position, headIndex, method);
  if (state.motionMode === "pingpong") return pingPong01(travel);
  if (headIndex === 0 && Math.abs(travel - 1) < 1e-9) return 1;
  return wrap01(travel);
}

function traceContact(path, phase) {
  if (path.closed) return pointAtPath(path, phase);
  return state.motionMode === "pingpong"
    ? pointAtPath(path, phase)
    : pointAtPath(path, phase * 2, { pingPong: true });
}

function scanAxisForHead(headIndex) {
  return state.scanLineAxes[headIndex] === "horizontal" ? "horizontal" : "vertical";
}

function scanPhaseOffset(headIndex, headCount) {
  return phaseOffsetForHead(headIndex, "scan");
}

function scanPhaseAt(position, headIndex, headCount) {
  const offsetPosition = position + scanPhaseOffset(headIndex, headCount);
  if (state.motionMode === "pingpong") return pingPong01(offsetPosition);
  if (
    headIndex === 0 &&
    state.position === 1 &&
    Math.abs(position - state.continuousPosition) < 1e-9
  ) {
    return 1;
  }
  return wrap01(offsetPosition);
}

function scannerAt(path, position, headIndex, headCount) {
  const headTravel = position + scanPhaseOffset(headIndex, headCount);
  const phase = scanPhaseAt(position, headIndex, headCount);
  const axis = scanAxisForHead(headIndex);
  const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
  const maximum = axis === "horizontal" ? path.bounds.maxY : path.bounds.maxX;
  const span = maximum - minimum;
  return {
    headIndex,
    headTravel,
    phase,
    axis,
    coordinate: span <= 1e-9
      ? (minimum + maximum) / 2
      : minimum + phase * span,
  };
}

function radialAt(path, position, headIndex) {
  const headTravel = directionalHeadTravel(position, headIndex, "radial");
  const phase = state.motionMode === "pingpong" ? pingPong01(headTravel) : wrap01(headTravel);
  const angle = phase * TAU - Math.PI * 0.5;
  const rawIntersections = rayIntersections(path, angle).filter((contact) => (
    path.closed || contact.rayDistance > 0.015
  ));
  if (!path.closed) {
    if (rawIntersections.length > 2) {
      const furthest = rawIntersections.reduce((selected, contact) => (
        contact.rayDistance > selected.rayDistance ? contact : selected
      ));
      rawIntersections.splice(0, rawIntersections.length, furthest);
    }
    const beamWidth = 0.11;
    for (const endpointPhase of [0, 1]) {
      const contact = pointAtPath(path, endpointPhase);
      const endpointAngle = Math.atan2(contact.y, contact.x);
      const difference = Math.abs(Math.atan2(
        Math.sin(endpointAngle - angle),
        Math.cos(endpointAngle - angle),
      ));
      if (difference > beamWidth) continue;
      const alignment = 1 - difference / beamWidth;
      if (rawIntersections.some((item) => Math.hypot(item.x - contact.x, item.y - contact.y) < 1e-5)) {
        continue;
      }
      rawIntersections.push({
        ...contact,
        cornerStrength: (contact.cornerStrength ?? contact.strength ?? 1) * alignment,
        strength: (contact.strength ?? contact.cornerStrength ?? 1) * alignment,
        rayDistance: Math.hypot(contact.x, contact.y),
        rayPhase: phase,
        radarAlignment: alignment,
      });
    }
  }
  const intersections = rawIntersections
    .sort((first, second) => first.rayDistance - second.rayDistance)
    .map((contact, contactIndex) => ({
      ...contact,
      headIndex,
      headTravel,
      headPhase: phase,
      scanAxis: "radial",
      voiceKey: `radial:${headIndex}:${contactIndex}`,
    }));
  return { headIndex, headTravel, phase, angle, contacts: intersections };
}

function collectContacts(path, position = state.continuousPosition) {
  const contacts = [];
  const heads = [];
  const headCount = effectiveHeadCount();
  for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
    if (state.playMethod === "scan") {
      const scanner = scannerAt(path, position, headIndex, headCount);
      const intersections = (scanner.axis === "horizontal"
        ? horizontalIntersections(path, scanner.coordinate)
        : verticalIntersections(path, scanner.coordinate)).map((contact, contactIndex) => ({
        ...contact,
        headIndex,
        headTravel: scanner.headTravel,
        headPhase: scanner.phase,
        scanAxis: scanner.axis,
        voiceKey: `scan:${scanner.axis}:${headIndex}:${contactIndex}`,
      }));
      heads.push({ ...scanner, contacts: intersections });
      contacts.push(...intersections);
    } else if (state.playMethod === "radial") {
      const radial = radialAt(path, position, headIndex);
      heads.push(radial);
      contacts.push(...radial.contacts);
    } else {
      const phase = phaseForHead(position, headIndex, headCount);
      const headTravel = directionalHeadTravel(position, headIndex, "trace");
      const contact = {
        ...traceContact(path, phase),
        headIndex,
        headTravel,
        headPhase: phase,
        voiceKey: `trace:${headIndex}`,
      };
      heads.push({ headIndex, phase, contact });
      contacts.push(contact);
    }
  }
  return { contacts, heads };
}

function addScannerPath(scanner, transform, extent) {
  context.beginPath();
  if (scanner.axis === "horizontal") {
    context.moveTo(transform.x(-extent), transform.y(scanner.coordinate));
    context.lineTo(transform.x(extent), transform.y(scanner.coordinate));
  } else {
    context.moveTo(transform.x(scanner.coordinate), transform.y(-extent));
    context.lineTo(transform.x(scanner.coordinate), transform.y(extent));
  }
}

function canvasTransform() {
  const scale = Math.min(cssWidth, cssHeight) * 0.39;
  return {
    scale,
    centerX: cssWidth * 0.5,
    centerY: cssHeight * 0.5,
    x: (value) => cssWidth * 0.5 + value * scale,
    y: (value) => cssHeight * 0.5 + value * scale,
  };
}

function drawShape(path, transform) {
  const points = path.points;
  context.beginPath();
  points.forEach((point, index) => {
    const x = transform.x(point.x);
    const y = transform.y(point.y);
    if (index) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  if (path.closed) context.closePath();
  if (path.closed) {
    context.fillStyle = "rgba(232,196,107,.025)";
    context.fill();
  }
  context.strokeStyle = "rgba(232,196,107,.9)";
  context.lineWidth = path.closed ? 1.5 : 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  path.vertexIndices.forEach((pointIndex, vertexIndex) => {
    const point = path.points[pointIndex];
    const inner = (path.cornerTurns[vertexIndex] ?? 0) < 0;
    const x = transform.x(point.x);
    const y = transform.y(point.y);
    context.beginPath();
    context.arc(x, y, inner ? 4.5 : 3.5, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = inner ? "rgba(199,155,255,.9)" : "rgba(232,196,107,.78)";
    context.lineWidth = 1;
    context.stroke();
  });
}

function drawGuideField(transform) {
  context.save();
  context.setLineDash([3, 7]);
  context.strokeStyle = "rgba(214,232,226,.25)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(transform.x(-1.1), transform.y(0));
  context.lineTo(transform.x(1.1), transform.y(0));
  context.moveTo(transform.x(0), transform.y(-1.1));
  context.lineTo(transform.x(0), transform.y(1.1));
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(transform.x(0), transform.y(0), 3, 0, TAU);
  context.strokeStyle = "rgba(95,232,196,.28)";
  context.stroke();
  context.restore();
}

function drawContact(contact, transform, headIndex) {
  const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
  const x = transform.x(contact.x);
  const y = transform.y(contact.y);
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 16;
  context.fillStyle = "#fff3d6";
  context.beginPath();
  context.arc(x, y, 5.5, 0, TAU);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(x - contact.tangent.x * 11, y - contact.tangent.y * 11);
  context.lineTo(x + contact.tangent.x * 11, y + contact.tangent.y * 11);
  context.strokeStyle = color;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawPlayer(path, transform) {
  const active = collectContacts(path);
  const showTrails = !reducedMotion.matches;
  const headCount = effectiveHeadCount();

  if (state.playMethod === "radial") {
    if (showTrails) {
      for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
        for (let trail = 7; trail >= 1; trail -= 1) {
          const phase = phaseForHead(
            state.continuousPosition - state.traversalDirection * trail * 0.008,
            headIndex,
            headCount,
            "radial",
          );
          const angle = phase * TAU - Math.PI * 0.5;
          context.beginPath();
          context.moveTo(transform.centerX, transform.centerY);
          context.lineTo(
            transform.x(Math.cos(angle) * 1.14),
            transform.y(Math.sin(angle) * 1.14),
          );
          context.strokeStyle = HEAD_COLORS[headIndex % HEAD_COLORS.length];
          context.globalAlpha = (1 - trail / 8) * 0.075;
          context.lineWidth = 1;
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;
    for (const head of active.heads) {
      context.beginPath();
      context.moveTo(transform.centerX, transform.centerY);
      context.lineTo(
        transform.x(Math.cos(head.angle) * 1.14),
        transform.y(Math.sin(head.angle) * 1.14),
      );
      context.strokeStyle = HEAD_COLORS[head.headIndex % HEAD_COLORS.length];
      context.globalAlpha = headCount > 6 ? 0.5 : 0.78;
      context.lineWidth = head.headIndex === 0 ? 1.5 : 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (state.playMethod === "scan") {
    if (showTrails) {
      for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
        const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
        for (let trail = 6; trail >= 1; trail -= 1) {
          const trailPosition = state.continuousPosition - state.traversalDirection * trail * 0.012;
          const scanner = scannerAt(path, trailPosition, headIndex, headCount);
          addScannerPath(scanner, transform, 1.12);
          context.strokeStyle = color;
          context.globalAlpha = (1 - trail / 7) * 0.055;
          context.lineWidth = 1;
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    for (const head of active.heads) {
      const color = HEAD_COLORS[head.headIndex % HEAD_COLORS.length];
      addScannerPath(head, transform, 1.14);
      context.strokeStyle = color;
      context.globalAlpha = headCount > 6 ? 0.52 : 0.72;
      context.lineWidth = head.headIndex === 0 ? 1.5 : 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (showTrails) {
    for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
      const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
      for (let trail = 14; trail >= 1; trail -= 1) {
        const trailPosition = state.continuousPosition - state.traversalDirection * trail * 0.006;
        const phase = phaseForHead(trailPosition, headIndex, headCount);
        const point = traceContact(path, phase);
        const strength = 1 - trail / 15;
        context.beginPath();
        context.arc(transform.x(point.x), transform.y(point.y), 1 + strength * 2.2, 0, TAU);
        context.fillStyle = color;
        context.globalAlpha = strength * strength * 0.22;
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  for (const contact of active.contacts) drawContact(contact, transform, contact.headIndex);
  return active.contacts;
}

function normalizedContactCoordinates(contact, path) {
  return {
    x: clamp((contact.x + 1) * 0.5, 0, 1),
    y: clamp((contact.y + 1) * 0.5, 0, 1),
  };
}

function tangentForContact(contact, path) {
  if (contact.tangent && Number.isFinite(contact.tangent.x) && Number.isFinite(contact.tangent.y)) {
    return contact.tangent;
  }
  const vertexIndex = contact.vertexIndex ?? contact.cornerIndex ?? 0;
  const pointIndex = path.vertexIndices[vertexIndex] ?? 0;
  const previous = path.points[(pointIndex - 1 + path.points.length) % path.points.length];
  const next = path.points[(pointIndex + 1) % path.points.length];
  const length = Math.hypot(next.x - previous.x, next.y - previous.y);
  if (length <= 1e-9) return { x: 1, y: 0 };
  return { x: (next.x - previous.x) / length, y: (next.y - previous.y) / length };
}

function contactMotionVelocity(contact, headIndex = contact.headIndex ?? 0, useIntent = false) {
  const axis = contact.scanAxis ?? scanAxisForHead(headIndex);
  const relativeDirection = state.playMethod === "scan" ? 1 : headDirection(headIndex);
  const headTravel = Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : state.playMethod === "scan"
      ? state.continuousPosition + phaseOffsetForHead(headIndex, "scan")
      : directionalHeadTravel(state.continuousPosition, headIndex);
  const motionDirection = state.motionMode === "pingpong"
    ? pingPongMotionDirection(headTravel, 1, relativeDirection)
    : state.traversalDirection * relativeDirection;
  let scanSpeed = state.playing ? motionDirection * state.speed : useIntent ? motionDirection : 0;
  const rotationSpeed = state.autoRotate
    ? currentRotationDirection() * state.rotationSpeed * TAU
    : 0;
  if (useIntent && Math.abs(scanSpeed) <= 1e-9 && Math.abs(rotationSpeed) <= 1e-9) {
    scanSpeed = motionDirection;
  }
  let velocity = axis === "radial"
    ? {
      x: -contact.y * scanSpeed * TAU,
      y: contact.x * scanSpeed * TAU,
    }
    : axis === "horizontal"
    ? { x: 0, y: scanSpeed }
    : { x: scanSpeed, y: 0 };
  velocity = {
    x: velocity.x + rotationSpeed * contact.y,
    y: velocity.y - rotationSpeed * contact.x,
  };
  return { velocity, axis };
}

function incidenceForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  // A Point playhead travels along the contour, so it never crosses it.
  if (state.playMethod === "trace") return 0;
  const tangent = tangentForContact(contact, path);
  const { velocity: initialVelocity, axis } = contactMotionVelocity(contact, headIndex);
  let velocity = initialVelocity;
  let length = Math.hypot(velocity.x, velocity.y);
  if (length <= 1e-9) {
    velocity = axis === "radial"
      ? { x: -contact.y, y: contact.x }
      : axis === "horizontal" ? { x: 0, y: 1 } : { x: 1, y: 0 };
    length = 1;
  }
  const normal = { x: -tangent.y, y: tangent.x };
  return clamp(Math.abs((velocity.x * normal.x + velocity.y * normal.y) / length), 0, 1);
}

function sourceValueForContact(source, contact, path, headIndex = contact.headIndex ?? 0) {
  if (source === "corner") return clamp(contact.cornerStrength ?? contact.strength ?? 0, 0, 1);
  if (source === "incidence") return incidenceForContact(contact, path, headIndex);
  if (source === "center") return centerDistanceForContact(contact);
  if (source === "horizontal") return normalizedContactCoordinates(contact, path).x;
  if (source === "phase") {
    return wrap01(contact.u ?? contact.pathPhase ?? 0);
  }
  const normalized = normalizedContactCoordinates(contact, path);
  return clamp(normalized.y, 0, 1);
}

function centerDistanceForContact(contact) {
  const distance = Number.isFinite(contact.rayDistance)
    ? contact.rayDistance
    : Math.hypot(contact.x, contact.y);
  return clamp(distance, 0, 1);
}

function percussionLevelValue(contact, path, headIndex = contact.headIndex ?? 0) {
  let raw;
  if (state.percussionLevelSource === "fixed") raw = 1;
  else if (state.percussionLevelSource === "signed") {
    raw = clamp(((contact.turn ?? contact.cornerTurn ?? 0) + 1) * 0.5, 0, 1);
  } else {
    raw = sourceValueForContact(state.percussionLevelSource, contact, path, headIndex);
  }
  return mapCurve01(raw, state.percussionLevelCurve);
}

function mappingForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const normalized = normalizedContactCoordinates(contact, path);
  const pitchRaw = sourceValueForContact(state.pitchSource, contact, path, headIndex);
  const panSource = state.stereoSource === "vertical"
    ? normalized.y
    : state.stereoSource === "center" ? centerDistanceForContact(contact) : normalized.x;
  const panDirection = state.stereoInverted ? -1 : 1;
  return {
    pitchRaw,
    pitch: evaluateMappingCurve(pitchRaw, state.pitchCurveNodes),
    pan: clamp((panSource * 2 - 1) * panDirection * state.stereoWidth, -1, 1),
    normalized,
    incidence: incidenceForContact(contact, path, headIndex),
  };
}

function pingPongMotionDirection(travelPosition, multiplier = 1, relativeDirection = 1) {
  const step = state.traversalDirection * relativeDirection * 1e-5;
  const before = pingPong01(travelPosition * multiplier);
  const after = pingPong01((travelPosition + step) * multiplier);
  const delta = after - before;
  return Math.abs(delta) > 1e-9
    ? Math.sign(delta)
    : state.traversalDirection * relativeDirection;
}

function currentRotationDirection() {
  if (state.rotationMotionMode !== "pingpong") return state.rotationDirection;
  const step = state.rotationDirection * 1e-5;
  const delta = pingPong01(state.continuousRotation + step) - pingPong01(state.continuousRotation);
  return Math.abs(delta) > 1e-9 ? Math.sign(delta) : -state.rotationDirection;
}

function pointContourDirection(contact, path) {
  const relativeDirection = headDirection(contact.headIndex ?? 0, "trace");
  if (state.motionMode === "pingpong") {
    return pingPongMotionDirection(contact.headTravel, 1, relativeDirection);
  }
  return path.closed
    ? state.traversalDirection * relativeDirection
    : pingPongMotionDirection(contact.headTravel, 2, relativeDirection);
}

function contactContourDirection(contact, path) {
  if (state.playMethod === "trace") return pointContourDirection(contact, path);
  const tangent = tangentForContact(contact, path);
  const { velocity } = contactMotionVelocity(contact, contact.headIndex ?? 0, true);
  const alongContour = velocity.x * tangent.x + velocity.y * tangent.y;
  return Math.abs(alongContour) <= 1e-9 ? 1 : Math.sign(alongContour);
}

function cornerEnvelopeProfile(contact, path) {
  if (state.cornerSwell) {
    return {
      strength: contact.cornerStrength ?? 0,
      distance: clamp((contact.cornerDistance01 ?? 0) * 2, 0, 1),
      edgeFraction: 1 / Math.max(1, path.vertexCount),
    };
  }

  // Every reader follows a directed corner interval. Line and Radar therefore
  // rise only after crossing a corner unless the explicit swell mirror is on.
  const distances = path.vertexDistances;
  if (!distances.length || path.totalLength <= 1e-9) {
    return { strength: contact.cornerStrength ?? 0, distance: 0, edgeFraction: 1 };
  }

  const distance = clamp(contact.distance, 0, path.totalLength);
  const direction = contactContourDirection(contact, path);
  const epsilon = 1e-9;

  if (direction >= 0) {
    let cornerIndex = 0;
    for (let index = 1; index < distances.length; index += 1) {
      if (distances[index] <= distance + epsilon) cornerIndex = index;
      else break;
    }
    const start = distances[cornerIndex];
    const end = cornerIndex + 1 < distances.length
      ? distances[cornerIndex + 1]
      : path.totalLength;
    return {
      strength: path.cornerStrengths[cornerIndex] ?? 0,
      distance: end - start <= epsilon ? 0 : clamp((distance - start) / (end - start), 0, 1),
      edgeFraction: (end - start) / path.totalLength,
    };
  }

  let cornerIndex = distances.findIndex((value) => value >= distance - epsilon);
  let target;
  let start;
  if (cornerIndex < 0) {
    cornerIndex = 0;
    target = path.totalLength;
    start = distances[distances.length - 1];
  } else if (cornerIndex === 0) {
    target = 0;
    start = path.closed ? distances[distances.length - 1] - path.totalLength : 0;
  } else {
    target = distances[cornerIndex];
    start = distances[cornerIndex - 1];
  }
  return {
    strength: path.cornerStrengths[cornerIndex] ?? 0,
    distance: target - start <= epsilon
      ? 0
      : clamp((target - distance) / (target - start), 0, 1),
    edgeFraction: (target - start) / path.totalLength,
  };
}

function shepardRate(contact, headIndex = contact.headIndex ?? 0) {
  if (!state.playing) return 0;
  const visualLoopRate = state.motionMode === "pingpong"
    ? state.speed * 0.5
    : state.speed;
  const relativeDirection = state.playMethod === "scan" ? 1 : headDirection(headIndex);
  const travel = Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : state.playMethod === "scan"
      ? state.continuousPosition + phaseOffsetForHead(headIndex, "scan")
      : directionalHeadTravel(state.continuousPosition, headIndex);
  const motionDirection = state.motionMode === "pingpong"
    ? pingPongMotionDirection(travel, 1, relativeDirection)
    : state.traversalDirection * relativeDirection;
  return visualLoopRate
    * state.shepardCycles
    * state.shepardDirection
    * motionDirection;
}

function shepardPositionForContact(contact) {
  const circuitPhase = wrap01(contact.headPhase ?? contact.u ?? state.position);
  return wrap01(circuitPhase * state.shepardCycles * state.shepardDirection);
}

function synthParametersForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const drive = sourceValueForContact(state.timbreSource, contact, path, headIndex);
  return synthParametersForMode(state.soundMode, drive, {
    fmIndex: state.fmIndex,
    fmRatio: state.fmRatio,
    pmIndex: state.pmIndex,
    pmRatio: state.pmRatio,
    shepardRate: shepardRate(contact, headIndex),
    shepardWidth: state.shepardWidth,
    shepardPosition: state.soundMode === "shepard"
      ? shepardPositionForContact(contact)
      : null,
  });
}

function amplitudeGainForContact(contact, path) {
  if (path.shapeType === "circle") return 0.12;
  if (!state.amplitudeEnvelopeEnabled) return 0.18;
  const profile = cornerEnvelopeProfile(contact, path);
  const attackPhase = state.amplitudeEnvelopePoints[1]?.x ?? 0;
  const envelopePhase = state.cornerSwell
    ? attackPhase + profile.distance * (1 - attackPhase)
    : profile.distance;
  const envelope = sampleAmplitudeEnvelope(envelopePhase, state.amplitudeEnvelopePoints);
  const cornerPeak = 0.18 + 0.5 * clamp(profile.strength, 0, 1);
  return clamp(cornerPeak * envelope, 0, 1);
}

function continuousSynthVoices(contacts, path) {
  return scaleShapeVoiceGains(contacts.map((contact) => {
    const mapping = mappingForContact(contact, path);
    const synth = synthParametersForContact(contact, path);
    return {
      key: `shape:${contact.voiceKey}`,
      frequency: pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange),
      gain: amplitudeGainForContact(contact, path),
      pan: mapping.pan,
      waveform: "sine",
      ...synth,
    };
  }));
}

function makeCornerSnapshot(
  path,
  continuousPosition = state.continuousPosition,
  continuousRotation = state.continuousRotation,
) {
  const count = effectiveHeadCount();
  const vertices = path.vertexIndices.map((pointIndex, vertexIndex) => {
    const point = path.points[pointIndex];
    return {
      vertexIndex,
      x: point.x,
      y: point.y,
      strength: path.cornerStrengths[vertexIndex] ?? 0,
      turn: path.cornerTurns[vertexIndex] ?? 0,
      pathPhase: path.closed
        ? path.vertexDistances[vertexIndex] / Math.max(path.totalLength, 1e-9)
        : vertexIndex === 0 ? 0 : state.motionMode === "pingpong" ? 1 : 0.5,
    };
  });
  const heads = Array.from({ length: count }, (_, headIndex) => ({
    axis: state.playMethod === "scan"
      ? scanAxisForHead(headIndex)
      : state.playMethod === "radial" ? "radial"
      : "path",
    continuousPhase: state.playMethod === "scan"
      ? continuousPosition + phaseOffsetForHead(headIndex, "scan")
      : directionalHeadTravel(continuousPosition, headIndex, state.playMethod),
  }));
  return {
    signature: [
      state.playMethod,
      count,
      state.scanLineAxes.slice(0, count).join(","),
      state.playMethod === "scan" ? "" : directionsForMethod().slice(0, count).join(","),
      state.playMethod === "scan"
        ? ""
        : directionAdjustmentsForMethod().slice(0, count).map((value) => value.toFixed(4)).join(","),
      state.motionMode,
      state.rotationMotionMode,
      path.sides,
      path.vertexCount,
      path.shapeType,
      path.starDepth.toFixed(4),
      path.curvature.toFixed(4),
      path.aspect.toFixed(4),
      path.skew.toFixed(4),
      path.asymmetry.toFixed(4),
      offsetsForMethod().map((value) => value.toFixed(4)).join(","),
    ].join("|"),
    continuousPosition,
    continuousRotation,
    rotationDeg: path.rotationDeg,
    bounds: path.bounds,
    heads,
    vertices,
  };
}

function strikeCorner(path, vertex, headIndex, time01 = 0, head = null) {
  if (state.soundMode !== "percussion" || !state.audio || vertex.strength <= 0) return;
  const contact = {
    ...vertex,
    headIndex,
    headTravel: head?.continuousPhase,
    scanAxis: head?.axis === "path" ? undefined : head?.axis,
    cornerStrength: vertex.strength,
    cornerTurn: vertex.turn,
  };
  const levelValue = percussionLevelValue(contact, path, headIndex);
  const peak = cornerStrikePeak(levelValue, state.cornerAccent);
  if (peak <= 0) return;
  const mapping = mappingForContact(contact, path, headIndex);
  const envelope = {
    attackSeconds: cornerAttackSeconds(state.cornerAttack),
    decaySeconds: cornerDecaySeconds(state.cornerDecay),
  };
  const frequency = pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange);

  pendingCornerStrikes.push({
    spec: {
      key: `corner:${state.playMethod}:${headIndex}:${vertex.vertexIndex}`,
      frequency,
      gain: peak,
      pan: mapping.pan,
      waveform: "sine",
    },
    envelope,
    time01: clamp(time01, 0, 1),
  });
}

function flushCornerStrikes(frameSpanSeconds = 0) {
  if (!pendingCornerStrikes.length) return;
  const intents = pendingCornerStrikes;
  pendingCornerStrikes = [];
  const headroom = pool.availableStrikeHeadroom?.(STRIKE_BATCH_CEILING)
    ?? STRIKE_BATCH_CEILING;
  const normalizedSpecs = normalizeStrikeGains(
    intents.map((intent) => intent.spec),
    headroom,
  );
  const spread = Math.min(Math.max(frameSpanSeconds, 0), 0.03);
  intents.forEach((intent, index) => {
    pool.strike(normalizedSpecs[index], {
      ...intent.envelope,
      startDelaySeconds: intent.time01 * spread,
    });
  });
}

function projectedVertexPhase(snapshot, vertex, axis) {
  if (axis === "radial") {
    return wrap01(Math.atan2(vertex.y, vertex.x) / TAU + 0.25);
  }
  const horizontal = axis === "horizontal";
  const minimum = horizontal ? snapshot.bounds.minY : snapshot.bounds.minX;
  const span = horizontal ? snapshot.bounds.height : snapshot.bounds.width;
  if (span <= 1e-9) return null;
  return clamp(((horizontal ? vertex.y : vertex.x) - minimum) / span, 0, 1);
}

function hasCircularPlaybackSeam(head, path) {
  return head.axis === "radial" || (head.axis === "path" && path.closed);
}

function crossesPlaybackTarget(
  beforeHead,
  afterHead,
  beforeTarget,
  afterTarget,
  path,
) {
  if (state.motionMode !== "pingpong") {
    return crossesPeriodicTarget(
      beforeHead.continuousPhase,
      afterHead.continuousPhase,
      beforeTarget,
      afterTarget,
    );
  }

  const crossed = crossesPingPongTarget(
    beforeHead.continuousPhase,
    afterHead.continuousPhase,
    beforeTarget,
    afterTarget,
  );
  if (crossed || !hasCircularPlaybackSeam(afterHead, path)) return crossed;

  // A closed contour and a radar ray identify phase 0 with phase 1. Test the
  // other seam spelling as well so a ping-pong turnaround emits one strike.
  const seamEpsilon = 1e-6;
  const touchesSeam = beforeTarget <= seamEpsilon
    || beforeTarget >= 1 - seamEpsilon
    || afterTarget <= seamEpsilon
    || afterTarget >= 1 - seamEpsilon;
  if (!touchesSeam) return false;
  const alias = (target) => target < 0.5 ? target + 1 : target;
  return crossesPingPongTarget(
    beforeHead.continuousPhase,
    afterHead.continuousPhase,
    alias(beforeTarget),
    alias(afterTarget),
  );
}

function strikeCurrentCorners() {
  if (state.soundMode !== "percussion") return;
  const path = currentShape();
  const snapshot = makeCornerSnapshot(path);
  const epsilon = 1e-6;
  for (let headIndex = 0; headIndex < snapshot.heads.length; headIndex += 1) {
    const head = snapshot.heads[headIndex];
    for (const vertex of snapshot.vertices) {
      const target = head.axis === "path"
        ? vertex.pathPhase
        : projectedVertexPhase(snapshot, vertex, head.axis);
      if (target === null) continue;
      const phase = state.motionMode === "pingpong"
        ? pingPong01(head.continuousPhase)
        : wrap01(head.continuousPhase);
      const circularDistance = state.motionMode === "loop"
        || hasCircularPlaybackSeam(head, path);
      const distance = circularDistance
        ? Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target))
        : Math.abs(phase - target);
      if (distance <= epsilon) strikeCorner(path, vertex, headIndex, 0, head);
    }
  }
  cornerSnapshot = snapshot;
}

function emitCornerStrikes(previous, current, path, time01 = 1) {
  if (!previous || previous.signature !== current.signature) return;
  for (let headIndex = 0; headIndex < current.heads.length; headIndex += 1) {
    const beforeHead = previous.heads[headIndex];
    const afterHead = current.heads[headIndex];
    if (!beforeHead || beforeHead.axis !== afterHead.axis) continue;
    for (let vertexIndex = 0; vertexIndex < current.vertices.length; vertexIndex += 1) {
      const beforeVertex = previous.vertices[vertexIndex];
      const afterVertex = current.vertices[vertexIndex];
      if (!beforeVertex) continue;
      let beforeTarget;
      let afterTarget;
      if (["vertical", "horizontal", "radial"].includes(afterHead.axis)) {
        beforeTarget = projectedVertexPhase(previous, beforeVertex, afterHead.axis);
        afterTarget = projectedVertexPhase(current, afterVertex, afterHead.axis);
      } else {
        beforeTarget = beforeVertex.pathPhase;
        afterTarget = afterVertex.pathPhase;
      }
      if (beforeTarget === null || afterTarget === null) continue;
      const crossed = crossesPlaybackTarget(
        beforeHead,
        afterHead,
        beforeTarget,
        afterTarget,
        path,
      );
      if (crossed) {
        strikeCorner(path, afterVertex, headIndex, time01, afterHead);
      }
    }
  }
}

function trackCornerMotion(finalPath) {
  const finalSnapshot = makeCornerSnapshot(finalPath);
  if (!cornerSnapshot || cornerSnapshot.signature !== finalSnapshot.signature) {
    cornerSnapshot = finalSnapshot;
    return;
  }

  const positionDelta = finalSnapshot.continuousPosition - cornerSnapshot.continuousPosition;
  const rotationTravelDelta = finalSnapshot.continuousRotation - cornerSnapshot.continuousRotation;
  const steps = motionSubsteps(positionDelta, rotationTravelDelta * 360);
  let previous = cornerSnapshot;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const isFinal = step === steps;
    const intermediateRotationTravel = cornerSnapshot.continuousRotation + rotationTravelDelta * amount;
    const path = isFinal
      ? finalPath
      : buildShape({
        sides: state.sides,
        shapeType: state.shapeType,
        starDepth: state.starDepth,
        curvature: state.curvature,
        aspect: state.aspect,
        skew: state.skew,
        rotationDeg: rotationAngleAtTravel(intermediateRotationTravel),
        samplesPerEdge: 48,
      });
    const snapshot = isFinal
      ? finalSnapshot
      : makeCornerSnapshot(
        path,
        cornerSnapshot.continuousPosition + positionDelta * amount,
        intermediateRotationTravel,
      );
    emitCornerStrikes(previous, snapshot, path, amount);
    previous = snapshot;
  }
  cornerSnapshot = finalSnapshot;
}

function drawFrame(path) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = canvasTransform();
  drawGuideField(transform);
  drawShape(path, transform);
  return drawPlayer(path, transform);
}

const CURVE_LABELS = {
  linear: "linear",
  exponential: "expand highs",
  logarithmic: "expand lows",
  smooth: "smooth S-curve",
  inverted: "inverted",
};

function displayTurn(turn) {
  const degrees = turn * 180;
  if (Math.abs(degrees) < 0.05) return "0° smooth";
  return `${degrees > 0 ? "+" : ""}${Math.round(degrees)}° ${degrees < 0 ? "inner" : "outer"}`;
}

function contactOutputGain(contact, path) {
  if (state.soundMode === "percussion") {
    if ((contact.cornerStrength ?? 0) <= 0) return 0;
    return cornerStrikePeak(percussionLevelValue(contact, path), state.cornerAccent);
  }
  return amplitudeGainForContact(contact, path);
}

function synthValueLabel(parameters) {
  if (state.soundMode === "fm") {
    return `${parameters.modulationIndex.toFixed(2)} index @ ${parameters.modulationRatio.toFixed(2)}:1`;
  }
  if (state.soundMode === "pm") {
    return `${parameters.modulationIndex.toFixed(2)} rad @ ${parameters.modulationRatio.toFixed(2)}:1`;
  }
  if (state.soundMode === "shepard") {
    const direction = parameters.shepardRate >= 0 ? "+" : "";
    return `${direction}${parameters.shepardRate.toFixed(3)} oct/s · ${parameters.shepardWidth.toFixed(1)} oct`;
  }
  if (state.soundMode === "percussion") return `sine strike · ${Math.round(state.cornerDecay)} ms`;
  return "pure sine";
}

function envelopeDurationLabel() {
  if (state.soundMode === "percussion") return `${Math.round(state.cornerDecay)} ms`;
  if (state.shapeType === "circle") return "none";
  if (!state.amplitudeEnvelopeEnabled) return "bypassed";
  const release = state.amplitudeEnvelopePoints.at(-1)?.y ?? 0;
  return release <= 0.005 ? "R 0% · rests" : `R ${Math.round(release * 100)}% · holds`;
}

function updateOutputDashboard(contacts, path) {
  $("outputVoiceLabel").textContent = state.soundMode;
  $("pitchRouteSource").textContent = SOURCE_LABELS[state.pitchSource] ?? state.pitchSource;
  $("pitchRouteCurve").textContent = `${PITCH_CURVE_LABELS[state.pitchCurvePreset] ?? "Custom"} response → exponential Hz`;
  updateStereoMappingUi();
  $("levelRouteSource").textContent = state.soundMode === "percussion"
    ? SOURCE_LABELS[state.percussionLevelSource] ?? state.percussionLevelSource
    : state.shapeType === "circle" ? "Continuous contour" : state.cornerSwell ? "Mirrored corner interval" : "Directed corner interval";
  $("levelRouteCurve").textContent = state.soundMode === "percussion"
    ? CURVE_LABELS[state.percussionLevelCurve] ?? state.percussionLevelCurve
    : state.shapeType === "circle"
      ? "constant continuous level"
      : state.amplitudeEnvelopeEnabled
        ? `${AMPLITUDE_PRESET_LABELS[state.amplitudePreset] ?? "Custom"} ADSR${state.cornerSwell ? " · swell" : ""}`
        : "ADSR bypassed";
  const timbreMode = ["fm", "pm", "shepard"].includes(state.soundMode);
  $("timbreRoute").hidden = !timbreMode;
  $("timbreRouteSource").textContent = SOURCE_LABELS[state.timbreSource] ?? state.timbreSource;
  $("timbreRouteTarget").textContent = TIMBRE_TARGET_LABELS[state.soundMode] ?? "Timbre";
  $("timbreRouteCurve").textContent = `${timbreMappedRangeLabel()} mapped range`;

  if (!contacts.length) {
    $("outputContactLabel").textContent = "No active contact";
    for (const id of [
      "markPhaseOut", "markPositionOut", "markCenterOut", "markTurnOut", "markDistanceOut",
      "markIncidenceOut", "markTangentOut", "markPitchValueOut",
      "markFrequencyOut", "markGainOut", "markPanOut",
      "markSynthDriveOut", "markSynthValueOut",
    ]) $(id).textContent = "—";
    $("markDecayOut").textContent = envelopeDurationLabel();
    $("markRotationOut").textContent = `${Math.round(state.rotation)}°`;
    $("contactStream").innerHTML = "";
    return;
  }

  const contact = contacts[0];
  const mapping = mappingForContact(contact, path);
  const synth = synthParametersForContact(contact, path);
  const frequency = pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange);
  const tangentDegrees = Math.atan2(contact.tangent.y, contact.tangent.x) * 180 / Math.PI;
  $("outputContactLabel").textContent = `Contact 1 of ${contacts.length}`;
  $("markPhaseOut").textContent = wrap01(contact.u ?? contact.headPhase ?? 0).toFixed(3);
  $("markPositionOut").textContent = `${contact.x.toFixed(3)}, ${contact.y.toFixed(3)}`;
  $("markCenterOut").textContent = centerDistanceForContact(contact).toFixed(3);
  $("markTurnOut").textContent = displayTurn(contact.cornerTurn ?? 0);
  $("markDistanceOut").textContent = clamp(contact.cornerDistance01 ?? 0, 0, 9.999).toFixed(3);
  $("markIncidenceOut").textContent = mapping.incidence.toFixed(3);
  $("markTangentOut").textContent = `${Math.round(tangentDegrees)}°`;
  $("markPitchValueOut").textContent = mapping.pitch.toFixed(3);
  $("markFrequencyOut").textContent = `${Math.round(frequency)} Hz`;
  $("markGainOut").textContent = contactOutputGain(contact, path).toFixed(3);
  $("markPanOut").textContent = mapping.pan.toFixed(3);
  $("markSynthDriveOut").textContent = ["fm", "pm", "shepard"].includes(state.soundMode)
    ? synth.synthDrive.toFixed(3)
    : "-";
  $("markSynthValueOut").textContent = synthValueLabel(synth);
  $("markDecayOut").textContent = envelopeDurationLabel();
  $("markRotationOut").textContent = `${Math.round(state.rotation)}°`;

  $("contactStream").innerHTML = contacts.slice(0, 12).map((item, index) => {
    const itemMapping = mappingForContact(item, path);
    const itemFrequency = pitch01ToFrequency(itemMapping.pitch, state.baseFrequency, state.pitchRange);
    return `<div class="contact-row"><b>#${index + 1}</b><span>u ${wrap01(item.u ?? item.headPhase ?? 0).toFixed(3)}</span><span>∠ ${Math.round((item.cornerTurn ?? 0) * 180)}°</span><span>${Math.round(itemFrequency)} Hz</span></div>`;
  }).join("");
}

function updateUi(contacts, voiceCount, path) {
  $("position").value = String(state.position);
  $("positionOut").textContent = formatPlayheadPosition();
  $("position").setAttribute("aria-valuetext", formatPlayheadPosition());
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;

  const readerCount = effectiveHeadCount();
  const readerName = state.playMethod === "scan"
    ? `${readerCount} ${plural(readerCount, "LINE", "LINES")}`
    : state.playMethod === "radial"
      ? `${readerCount} ${plural(readerCount, "RAY", "RAYS")}`
    : `${readerCount} ${plural(readerCount, "POINT", "POINTS")}`;
  const contactText = `${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")}`;
  const audioText = state.audio
    ? `${voiceCount} ${plural(voiceCount, "VOICE", "VOICES")}`
    : "AUDIO OFF";
  $("stageReadout").textContent = `${readerName} · ${contactText} · ${audioText}`;
  updateSectionSummaries();
  renderHeadLayout();
  updateOutputDashboard(contacts, path);
}

function transportDeltaSeconds(now) {
  const performanceDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running"
    ? pool.context.currentTime
    : null;
  let audioDelta = 0;
  if (
    Number.isFinite(audioTime)
    && Number.isFinite(lastAudioClockTime)
    && audioTime >= lastAudioClockTime
  ) {
    audioDelta = audioTime - lastAudioClockTime;
  }
  lastAudioClockTime = Number.isFinite(audioTime) ? audioTime : null;
  // Browser/test fallbacks can expose a non-advancing AudioContext clock.
  // Prefer it whenever it moves; otherwise retain monotonic visual timing.
  return audioDelta > 1e-6
    ? Math.min(1, audioDelta)
    : Math.min(0.1, performanceDelta);
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = transportDeltaSeconds(now);

  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * deltaSeconds;
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }

  if (state.autoRotate) {
    state.continuousRotation += state.rotationDirection * state.rotationSpeed * deltaSeconds;
    state.rotation = rotationAngleAtTravel(state.continuousRotation);
  }

  const path = currentShape();
  const moving = state.playing || state.autoRotate;
  pendingCornerStrikes = [];
  if (state.soundMode === "percussion" && moving) {
    trackCornerMotion(path);
    flushCornerStrikes(deltaSeconds);
  } else {
    cornerSnapshot = null;
    if (state.soundMode === "percussion" && !moving) pool.silence();
  }
  const contacts = drawFrame(path);
  const continuousMode = state.soundMode !== "percussion";
  const synthVoices = continuousMode
    ? continuousSynthVoices(contacts, path)
    : [];

  if (state.audio && !document.hidden) {
    const shouldRefreshAudio = !moving || now - lastAudioUpdate >= AUDIO_UPDATE_INTERVAL_MS;
    if (shouldRefreshAudio) {
      if (continuousMode && moving) {
        const futurePosition = state.continuousPosition
          + (state.playing
            ? state.traversalDirection * state.speed * AUDIO_LOOKAHEAD_SECONDS
            : 0);
        const futureRotationTravel = state.continuousRotation
          + (state.autoRotate
            ? state.rotationDirection * state.rotationSpeed * AUDIO_LOOKAHEAD_SECONDS
            : 0);
        const futureRotation = rotationAngleAtTravel(futureRotationTravel);
        const futurePath = Math.abs(futureRotation - state.rotation) > 1e-9
          ? shapeAtRotation(futureRotation)
          : path;
        const futureContacts = collectContacts(futurePath, futurePosition).contacts;
        const futureVoices = continuousSynthVoices(futureContacts, futurePath);
        pool.setVoiceTrajectory(
          synthVoices,
          futureVoices,
          AUDIO_LOOKAHEAD_SECONDS,
        );
      } else {
        pool.setVoices([]);
      }
      lastAudioUpdate = now;
    }
  }

  if (!moving || now - lastUiUpdate > 60) {
    const voiceCount = continuousMode
      ? (moving ? Math.min(synthVoices.length, MAX_CONTINUOUS_VOICES) : 0)
      : pool.activeStrikeCount;
    updateUi(contacts, state.audio ? voiceCount : 0, path);
    lastUiUpdate = now;
  }
  if (moving) scheduleFrame();
}

function scrubFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  setPosition((event.clientX - bounds.left) / Math.max(1, bounds.width));
  dismissHelp();
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= 1e-9
    ? 0
    : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount),
  );
}

function pointerCanvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height),
  };
}

function pointerNearContour(event) {
  const point = pointerCanvasPoint(event);
  const path = currentShape();
  const transform = canvasTransform();
  const count = path.closed ? path.points.length : path.points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const a = path.points[index];
    const b = path.points[(index + 1) % path.points.length];
    if (distanceToSegment(point, {
      x: transform.x(a.x),
      y: transform.y(a.y),
    }, {
      x: transform.x(b.x),
      y: transform.y(b.y),
    }) <= 16) return true;
  }
  return false;
}

function pointerAngle(event) {
  const point = pointerCanvasPoint(event);
  const transform = canvasTransform();
  return Math.atan2(point.y - transform.centerY, point.x - transform.centerX);
}

canvas.addEventListener("pointerdown", (event) => {
  const spin = !state.autoRotate && pointerNearContour(event);
  pointerGesture = spin
    ? {
      type: "spin",
      pointerId: event.pointerId,
      startAngle: pointerAngle(event),
      startRotation: state.rotation,
    }
    : { type: "scrub", pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.toggle?.("is-spinning", spin);
  if (!spin) scrubFromPointer(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) return;
  if (pointerGesture.type === "scrub") {
    scrubFromPointer(event);
    return;
  }
  const angleDelta = Math.atan2(
    Math.sin(pointerAngle(event) - pointerGesture.startAngle),
    Math.cos(pointerAngle(event) - pointerGesture.startAngle),
  );
  setRotationAngle(pointerGesture.startRotation + angleDelta * 180 / Math.PI);
});

function endPointer(event) {
  if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) return;
  if (pointerGesture.type === "spin") announce(`Rotation ${Math.round(state.rotation)} degrees.`);
  pointerGesture = null;
  stageWrap.classList.remove?.("is-spinning");
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

window.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(tag)) return;
  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!state.playing);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.02 : 0.002;
    setPosition(state.position + (event.key === "ArrowLeft" ? -amount : amount));
    dismissHelp();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else invalidate();
});

window.addEventListener("pagehide", (event) => {
  state.audio = false;
  paintAudioState();
  if (event.persisted) pool.disable();
  else void pool.close();
});

window.addEventListener("pageshow", () => invalidate());

$("shape").addEventListener("input", dismissHelp);

syncFormTopology(false);
updateSidesOutput();
updateCurvatureOutput();
setPlayMethod(state.playMethod, false);
setMotionMode(state.motionMode, false);
setSoundMode(state.soundMode, false);
setPitchDimension(state.pitchSource, false);
setStereoDimension(state.stereoSource, false);
renderPitchCurve();
updateAmplitudeUi();
setTraversalDirection(1, false);
setRotationDirection(1, false);
setRotationMotionMode(state.rotationMotionMode, false);
setRotationPlaying(false, false);
paintAudioState();
renderHeadLayout();
updateSectionSummaries();
updatePlayheadReadouts();
lastFrameTime = performance.now();
scheduleFrame();
