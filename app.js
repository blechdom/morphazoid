import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  pointInBounds01,
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
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  cornerStrikePeak,
  mapCurve01,
  normalizeStrikeGains,
  pitch01ToFrequency,
  sineCornerEnvelopeGain,
  synthParametersForMode,
} from "./src/audio.js";
import {
  canonicalHeadOffsets,
  sanitizeHeadOffsets,
  updateHeadOffset,
  wrapOffset,
} from "./src/playheads.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const SPEED_MIN = 0.01;
const SPEED_MAX = 4;
const MAX_CONTINUOUS_VOICES = 32;
const STRIKE_BATCH_CEILING = 0.78;
const AUDIO_LOOKAHEAD_SECONDS = 0.075;
const AUDIO_UPDATE_INTERVAL_MS = 24;
const HEAD_COLORS = ["#5fe8c4", "#7db4ff", "#c79bff", "#ffb86b"];
const AUDIO_SETTINGS_KEY = "morphazoid:shape:audio:v1";
const SOUND_MODE_LABELS = {
  sine: "Sine",
  percussion: "Percussion",
  shepard: "Shepard glissando",
  fm: "FM",
  pm: "PM",
};
const SOUND_MODES = new Set(Object.keys(SOUND_MODE_LABELS));
const PITCH_SUMMARY_LABELS = {
  height: "Height",
  center: "Center distance",
  corner: "Corner",
  incidence: "Incidence",
  phase: "Contour phase",
};
const PERSISTED_AUDIO_KEYS = new Set([
  "baseFrequency",
  "pitchRange",
  "level",
  "soundMode",
  "sineAccent",
  "sineDecay",
  "cornerAccent",
  "cornerAttack",
  "cornerDecay",
  "synthSource",
  "shepardCycles",
  "shepardDirection",
  "shepardWidth",
  "fmIndex",
  "fmRatio",
  "pmIndex",
  "pmRatio",
  "stereoWidth",
  "mappingFrame",
  "pitchSource",
  "pitchCurve",
  "hitLevelSource",
  "hitLevelCurve",
]);

const state = {
  sides: 4,
  curvature: 0,
  curvatureDirection: 1,
  shapeType: "polygon",
  starDepth: 0.48,
  aspect: 0,
  skew: 0,
  asymmetry: 0,
  rotation: 0,
  playMethod: "trace",
  lineCount: 1,
  lineLayout: "parallel",
  scanMotion: "loop",
  heads: 1,
  traceHeadOffsets: [0],
  scanHeadOffsets: [0],
  autoRotate: false,
  rotationSpeed: 0.12,
  rotationDirection: 1,
  audio: false,
  playing: false,
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.06,
  traversalDirection: 1,
  baseFrequency: 110,
  pitchRange: 2.5,
  level: 0.65,
  soundMode: "fm",
  sineAccent: 0.75,
  sineDecay: 0.65,
  cornerAccent: 0.9,
  cornerAttack: 3,
  cornerDecay: 90,
  synthSource: "incidence",
  shepardCycles: 1,
  shepardDirection: 1,
  shepardWidth: 4,
  fmIndex: 3,
  fmRatio: 2,
  pmIndex: 2,
  pmRatio: 1,
  stereoWidth: 1,
  mappingFrame: "instrument",
  pitchSource: "height",
  pitchCurve: "linear",
  hitLevelSource: "corner",
  hitLevelCurve: "linear",
};

function loadAudioSettings() {
  try {
    const stored = globalThis.localStorage?.getItem(AUDIO_SETTINGS_KEY);
    if (!stored) return;
    const values = JSON.parse(stored);
    if (!values || typeof values !== "object") return;
    for (const key of PERSISTED_AUDIO_KEYS) {
      if (!(key in values)) continue;
      if (typeof state[key] === "number" && Number.isFinite(Number(values[key]))) {
        state[key] = Number(values[key]);
      } else if (typeof state[key] === "string" && typeof values[key] === "string") {
        state[key] = values[key];
      }
    }
  } catch {
    // Storage is an optional convenience; audio remains fully usable without it.
  }
}

function persistAudioSettings() {
  try {
    const values = {};
    for (const key of PERSISTED_AUDIO_KEYS) values[key] = state[key];
    globalThis.localStorage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(values));
  } catch {
    // Ignore unavailable or full storage.
  }
}

loadAudioSettings();
state.baseFrequency = clamp(state.baseFrequency, 55, 440);
state.pitchRange = clamp(state.pitchRange, 0, 6);
state.level = clamp(state.level, 0, 1);
state.soundMode = SOUND_MODES.has(state.soundMode) ? state.soundMode : "sine";
state.sineAccent = clamp(state.sineAccent, 0, 1);
state.sineDecay = clamp(state.sineDecay, 0, 1);
state.cornerAccent = clamp(state.cornerAccent, 0, 1);
state.cornerAttack = clamp(state.cornerAttack, 0.5, 30);
if (state.cornerDecay < 15) state.cornerDecay = 90;
state.cornerDecay = clamp(state.cornerDecay, 15, 2000);
state.synthSource = ["height", "corner", "incidence", "phase"].includes(state.synthSource)
  ? state.synthSource
  : "incidence";
state.shepardCycles = clamp(state.shepardCycles, 0.25, 4);
state.shepardDirection = state.shepardDirection < 0 ? -1 : 1;
state.shepardWidth = clamp(state.shepardWidth, 1, 8);
state.fmIndex = clamp(state.fmIndex, 0, 12);
state.fmRatio = clamp(state.fmRatio, 0.25, 8);
state.pmIndex = clamp(state.pmIndex, 0, 8);
state.pmRatio = clamp(state.pmRatio, 0.25, 8);
state.stereoWidth = clamp(state.stereoWidth, 0, 1);
state.mappingFrame = state.mappingFrame === "shape" ? "shape" : "instrument";
state.pitchSource = ["height", "center", "corner", "incidence", "phase"].includes(state.pitchSource)
  ? state.pitchSource
  : "height";
state.pitchCurve = ["linear", "exponential", "logarithmic", "smooth", "inverted"].includes(state.pitchCurve)
  ? state.pitchCurve
  : "linear";
state.hitLevelSource = ["corner", "incidence", "fixed", "signed"].includes(state.hitLevelSource)
  ? state.hitLevelSource
  : "corner";
state.hitLevelCurve = ["linear", "exponential", "logarithmic", "smooth", "inverted"].includes(state.hitLevelCurve)
  ? state.hitLevelCurve
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
let lastFrameTime = performance.now();
let lastAudioClockTime = null;
let lastUiUpdate = 0;
let lastAudioUpdate = -Infinity;
let cachedShape = null;
let cachedShapeKey = "";
let cachedLocalShape = null;
let cachedLocalShapeKey = "";
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
  if (value === 2) return "2 · open line";
  return state.shapeType === "star" ? `${value} · star points` : `${value} · polygon`;
}

function formatCurvature(value = state.curvature) {
  if (Math.abs(value) < 0.005) return "straight";
  const amount = `${Math.round(Math.abs(value) * 100)}%`;
  if (state.sides === 2) return `${amount} ${value < 0 ? "negative" : "positive"} bend`;
  return `${amount} ${value < 0 ? "inward" : "outward"}`;
}

function effectiveHeadCount() {
  return state.playMethod === "scan" ? state.lineCount : state.heads;
}

function activeLineLayout() {
  return state.lineCount > 1 ? state.lineLayout : "parallel";
}

function activeOffsetLayout(method = state.playMethod) {
  return method === "scan" && activeLineLayout() === "crossed" ? "crossed" : "parallel";
}

function offsetsForMethod(method = state.playMethod) {
  return method === "scan" ? state.scanHeadOffsets : state.traceHeadOffsets;
}

function setOffsetsForMethod(method, offsets) {
  if (method === "scan") state.scanHeadOffsets = offsets;
  else state.traceHeadOffsets = offsets;
}

function phaseOffsetForHead(headIndex, method = state.playMethod) {
  const count = method === "scan" ? state.lineCount : state.heads;
  const offsets = sanitizeHeadOffsets(offsetsForMethod(method), count, activeOffsetLayout(method));
  return offsets[headIndex] ?? 0;
}

function resetActiveHeadOffsets(shouldAnnounce = true) {
  const count = effectiveHeadCount();
  setOffsetsForMethod(
    state.playMethod,
    canonicalHeadOffsets(count, activeOffsetLayout()),
  );
  resetCornerTracking();
  renderHeadLayout();
  if (shouldAnnounce) announce("Playheads reset to equal spacing.");
  invalidate();
}

function renderHeadLayout() {
  const count = effectiveHeadCount();
  const offsets = sanitizeHeadOffsets(offsetsForMethod(), count, activeOffsetLayout());
  const crossed = state.playMethod === "scan" && activeLineLayout() === "crossed";
  setOffsetsForMethod(state.playMethod, offsets);
  $("headLayoutTrack").classList.toggle("is-crossed", crossed);
  for (let index = 0; index < 12; index += 1) {
    const marker = $(`headMarker${index}`);
    marker.hidden = index >= count;
    if (marker.hidden) continue;
    const displayPhase = wrap01(0.5 + offsets[index]);
    const axis = crossed ? (index % 2 === 0 ? "Vertical line" : "Horizontal line") : "Playhead";
    marker.style.left = `${displayPhase * 100}%`;
    marker.style.top = crossed ? (index % 2 === 0 ? "28%" : "72%") : "50%";
    marker.style.setProperty("--head-color", HEAD_COLORS[index % HEAD_COLORS.length]);
    marker.setAttribute("role", "slider");
    marker.setAttribute("aria-orientation", "horizontal");
    marker.setAttribute("aria-valuenow", displayPhase.toFixed(3));
    marker.setAttribute("aria-valuetext", `${(displayPhase * 100).toFixed(1)} percent relative phase`);
    marker.setAttribute("aria-label", `${axis} ${index + 1} relative phase ${(displayPhase * 100).toFixed(1)} percent`);
  }
}

function updateSectionSummaries() {
  const reader = state.playMethod === "scan" ? "Lines" : state.playMethod === "radial" ? "Radar" : "Points";
  $("playSummary").textContent = `${reader} · ${state.playing ? "playing" : "paused"}`;
  $("formSummary").textContent = state.sides === 2
    ? "open line"
    : state.shapeType === "star" ? `${state.sides}-point star` : `${state.sides} sides`;
  $("soundSummary").textContent = SOUND_MODE_LABELS[state.soundMode];
  $("mappingSummary").textContent = `${PITCH_SUMMARY_LABELS[state.pitchSource] ?? "Mark"} → pitch`;
}

function updateCanvasLabel() {
  const reader = state.playMethod === "scan"
    ? `${state.lineCount} ${activeLineLayout()} ${state.scanMotion} scanning ${plural(state.lineCount, "line")}`
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
  const showLayout = state.playMethod === "scan" && state.lineCount > 1;
  $("lineLayoutControl").hidden = !showLayout;
  $("scanMotionControl").hidden = state.playMethod !== "scan";
  $("probeType").textContent = state.playMethod === "scan"
    ? `${state.lineCount} ${activeLineLayout().toUpperCase()} ${plural(state.lineCount, "LINE", "LINES")}`
    : state.playMethod === "radial"
      ? `${state.heads} RADAR ${plural(state.heads, "RAY", "RAYS")}`
    : `${state.heads} TRACE ${plural(state.heads, "HEAD", "HEADS")}`;
  updateTraversalDirection();
  updateCanvasLabel();
  renderHeadLayout();
  updatePlayheadStepper();
  updateSectionSummaries();
}

function speedFromSlider(value) {
  return SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** clamp(value, 0, 1);
}

function sliderFromSpeed(value) {
  return Math.log(value / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
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
    if (PERSISTED_AUDIO_KEYS.has(key)) persistAudioSettings();
    dismissHelp();
  });
  input.value = String(state[key]);
  updateOutput();
  return updateOutput;
}

const updateSidesOutput = bindRange("sides", "sides", formatSides, () => {
  updateCurvatureOutput();
  updateTraversalDirection();
  updateCanvasLabel();
  $("starDepthControl").hidden = state.shapeType !== "star" || state.sides < 3;
  updateSectionSummaries();
  resetCornerTracking();
});
bindRange("rotation", "rotation", (value) => `${Math.round(value)}°`);
const updateLineCountOutput = bindRange("lineCount", "lineCount", (value) => {
  return `${value} ${plural(value, "line")}`;
}, () => {
  state.scanHeadOffsets = canonicalHeadOffsets(state.lineCount, activeOffsetLayout("scan"));
  updateLineControls();
  resetCornerTracking();
});
const updateHeadsOutput = bindRange("heads", "heads", (value) => {
  return `${value} ${plural(value, "point")}`;
}, () => {
  state.traceHeadOffsets = canonicalHeadOffsets(state.heads);
  updateLineControls();
  resetCornerTracking();
});
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/s`);
const updateStarDepthOutput = bindRange("starDepth", "starDepth", (value) => `${Math.round(value * 100)}%`, resetCornerTracking);
const updateAspectOutput = bindRange("aspect", "aspect", (value) => {
  if (Math.abs(value) < 0.005) return "even";
  return `${Math.round(Math.abs(value) * 100)}% ${value > 0 ? "wide" : "tall"}`;
}, resetCornerTracking);
const updateSkewOutput = bindRange("skew", "skew", (value) => `${Math.round(value * 100)}%`, resetCornerTracking);
const updateAsymmetryOutput = bindRange("asymmetry", "asymmetry", (value) => `${Math.round(value * 100)}%`, resetCornerTracking);
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("sineAccent", "sineAccent", (value) => `${Math.round(value * 100)}%`);
bindRange("sineDecay", "sineDecay", (value) => `${Math.round(value * 100)}%`);
bindRange("cornerAccent", "cornerAccent", (value) => `${Math.round(value * 100)}%`);
bindRange("cornerAttack", "cornerAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("cornerDecay", "cornerDecay", (value) => `${Math.round(cornerDecaySeconds(value) * 1000)} ms`);
bindRange("shepardCycles", "shepardCycles", (value) => `${value.toFixed(2)} oct / loop`);
bindRange("shepardWidth", "shepardWidth", (value) => `${value.toFixed(1)} oct`);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("pmIndex", "pmIndex", (value) => `${value.toFixed(2)} rad`);
bindRange("pmRatio", "pmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`);

function updateCurvatureOutput() {
  $("curvature").value = String(Math.abs(state.curvature));
  $("curvatureOut").textContent = formatCurvature();
  for (const button of $("curvatureDirection").querySelectorAll("button")) {
    setPressed(button, Number(button.dataset.value) === state.curvatureDirection);
  }
}

function setCurvatureAmount(amount) {
  state.curvature = clamp(Number(amount), 0, 1) * state.curvatureDirection;
  updateCurvatureOutput();
  updateCanvasLabel();
  resetCornerTracking();
  dismissHelp();
}

function setCurvatureDirection(direction, shouldAnnounce = true) {
  state.curvatureDirection = direction < 0 ? -1 : 1;
  state.curvature = Math.abs(state.curvature) * state.curvatureDirection;
  updateCurvatureOutput();
  resetCornerTracking();
  if (shouldAnnounce) announce(`Roundness bends ${state.curvatureDirection < 0 ? "inward" : "outward"}.`);
  dismissHelp();
}

$("curvature").addEventListener("input", () => setCurvatureAmount($("curvature").value));
for (const button of $("curvatureDirection").querySelectorAll("button")) {
  button.addEventListener("click", () => setCurvatureDirection(Number(button.dataset.value)));
}

function setShapeType(type, shouldAnnounce = true) {
  state.shapeType = type === "star" ? "star" : "polygon";
  for (const button of $("shapeType").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.shapeType);
  }
  $("starDepthControl").hidden = state.shapeType !== "star" || state.sides < 3;
  updateSidesOutput();
  updateSectionSummaries();
  resetCornerTracking();
  if (shouldAnnounce) {
    announce(state.shapeType === "star"
      ? "Star topology selected. Inner and outer corners alternate."
      : "Polygon topology selected.");
  }
  invalidate();
}

for (const button of $("shapeType").querySelectorAll("button")) {
  button.addEventListener("click", () => setShapeType(button.dataset.value));
}

$("resetForm").addEventListener("click", () => {
  state.sides = 4;
  state.curvature = 0;
  state.curvatureDirection = 1;
  state.starDepth = 0.48;
  state.aspect = 0;
  state.skew = 0;
  state.asymmetry = 0;
  $("sides").value = "4";
  $("starDepth").value = "0.48";
  $("aspect").value = "0";
  $("skew").value = "0";
  $("asymmetry").value = "0";
  updateSidesOutput();
  updateCurvatureOutput();
  updateStarDepthOutput();
  updateAspectOutput();
  updateSkewOutput();
  updateAsymmetryOutput();
  setShapeType("polygon", false);
  announce("Form reset.");
  invalidate();
});

function setPlayMethod(method, shouldAnnounce = true) {
  const nextMethod = ["trace", "scan", "radial"].includes(method) ? method : "trace";
  if (nextMethod !== state.playMethod) {
    state.continuousPosition = nextMethod === "scan" && state.scanMotion === "pingpong"
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
  $("positionLabel").textContent = state.playMethod === "radial" ? "Radar angle" : "Playhead position";
  updateLineCountOutput();
  updateHeadsOutput();
  updateLineControls();
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
    state.scanHeadOffsets = canonicalHeadOffsets(state.lineCount, activeOffsetLayout("scan"));
    updateLineCountOutput();
  } else {
    state.heads = Math.round(clamp(state.heads + delta, 1, 12));
    $("heads").value = String(state.heads);
    state.traceHeadOffsets = canonicalHeadOffsets(state.heads);
    updateHeadsOutput();
  }
  updateLineControls();
  resetCornerTracking();
  announce(`${$("playheadCountOut").textContent} active.`);
  invalidate();
}

$("removePlayhead").addEventListener("click", () => changePlayheadCount(-1));
$("addPlayhead").addEventListener("click", () => changePlayheadCount(1));

function setLineLayout(layout, shouldAnnounce = true) {
  const nextLayout = layout === "crossed" ? "crossed" : "parallel";
  if (nextLayout !== state.lineLayout) {
    state.lineLayout = nextLayout;
    state.scanHeadOffsets = canonicalHeadOffsets(state.lineCount, activeOffsetLayout("scan"));
  }
  for (const button of $("lineLayout").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.lineLayout);
  }
  updateLineControls();
  resetCornerTracking();
  if (shouldAnnounce) announce(`${state.lineLayout} scan lines selected.`);
  invalidate();
}

for (const button of $("lineLayout").querySelectorAll("button")) {
  button.addEventListener("click", () => setLineLayout(button.dataset.value));
}

function setScanMotion(motion, shouldAnnounce = true) {
  const nextMotion = motion === "loop" ? "loop" : "pingpong";
  if (nextMotion !== state.scanMotion) {
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
    state.scanMotion = nextMotion;
    resetCornerTracking();
  }
  for (const button of $("scanMotion").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.scanMotion);
  }
  updateTraversalDirection();
  updateCanvasLabel();
  if (shouldAnnounce) announce(`${state.scanMotion === "pingpong" ? "Ping-pong" : "Loop"} line movement selected.`);
  invalidate();
}

for (const button of $("scanMotion").querySelectorAll("button")) {
  button.addEventListener("click", () => setScanMotion(button.dataset.value));
}

function setCustomHeadOffset(index, displayPhase, shouldAnnounce = false) {
  const count = effectiveHeadCount();
  const offsets = sanitizeHeadOffsets(offsetsForMethod(), count, activeOffsetLayout());
  setOffsetsForMethod(
    state.playMethod,
    updateHeadOffset(offsets, index, wrapOffset(displayPhase - 0.5)),
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
    const current = wrap01(0.5 + phaseOffsetForHead(index));
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
  $("sineArticulation").hidden = state.soundMode !== "sine";
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  $("shepardArticulation").hidden = state.soundMode !== "shepard";
  $("fmArticulation").hidden = state.soundMode !== "fm";
  $("pmArticulation").hidden = state.soundMode !== "pm";
  $("hitMapping").hidden = state.soundMode !== "percussion";
  $("synthMapping").hidden = !["fm", "pm"].includes(state.soundMode);
  updateSectionSummaries();
  persistAudioSettings();
  if (shouldAnnounce) {
    const descriptions = {
      sine: "Continuous sine with corner amplitude selected.",
      percussion: "Percussion corner strikes selected.",
      shepard: "Transport-locked Shepard glissando selected.",
      fm: "Frequency modulation driven by a geometry mark selected.",
      pm: "Phase modulation driven by a geometry mark selected.",
    };
    announce(descriptions[state.soundMode]);
  }
  invalidate();
}

$("soundMode").value = state.soundMode;
$("soundMode").addEventListener("change", (event) => {
  setSoundMode(event.currentTarget.value);
});

$("shepardDirection").value = String(state.shepardDirection);
$("shepardDirection").addEventListener("change", (event) => {
  state.shepardDirection = Number(event.currentTarget.value) < 0 ? -1 : 1;
  persistAudioSettings();
  invalidate();
});

function setRotationPlaying(playing, shouldAnnounce = true) {
  state.autoRotate = Boolean(playing);
  setPressed($("rotationPlayButton"), state.autoRotate);
  $("rotationPlayButton").setAttribute("aria-label", state.autoRotate ? "Pause rotation" : "Start rotation");
  $("rotationDirection").hidden = !state.autoRotate;
  lastFrameTime = performance.now();
  lastAudioClockTime = pool.context?.currentTime ?? null;
  if (shouldAnnounce) announce(state.autoRotate ? "Rotation playing." : "Rotation paused.");
  dismissHelp();
}

$("rotationPlayButton").addEventListener("click", () => setRotationPlaying(!state.autoRotate));

function setRotationDirection(direction, shouldAnnounce = true) {
  state.rotationDirection = direction < 0 ? -1 : 1;
  const clockwise = state.rotationDirection > 0;
  $("rotationDirectionGlyph").textContent = clockwise ? "↻" : "↺";
  $("rotationDirectionText").textContent = clockwise ? "CW" : "CCW";
  $("rotationDirection").setAttribute("aria-label", `Rotation direction: ${clockwise ? "clockwise" : "counterclockwise"}`);
  if (shouldAnnounce) {
    announce(`Rotation direction ${state.rotationDirection > 0 ? "clockwise" : "counterclockwise"}.`);
  }
  invalidate();
}

$("rotationDirection").addEventListener("click", () => setRotationDirection(-state.rotationDirection));

$("mappingFrame").value = state.mappingFrame;
$("mappingFrame").addEventListener("change", (event) => {
  state.mappingFrame = event.currentTarget.value;
  persistAudioSettings();
  dismissHelp();
});

for (const [id, key] of [
  ["pitchSource", "pitchSource"],
  ["pitchCurve", "pitchCurve"],
  ["hitLevelSource", "hitLevelSource"],
  ["hitLevelCurve", "hitLevelCurve"],
  ["synthSource", "synthSource"],
]) {
  $(id).value = state[key];
  $(id).addEventListener("change", (event) => {
    state[key] = event.currentTarget.value;
    persistAudioSettings();
    if (key === "pitchSource") updateSectionSummaries();
    dismissHelp();
  });
}

const speedInput = $("speed");
speedInput.value = String(sliderFromSpeed(state.speed));
speedInput.addEventListener("input", () => {
  state.speed = speedFromSlider(Number(speedInput.value));
  $("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
  dismissHelp();
});

function setPosition(value) {
  const nextPosition = clamp(value, 0, 1);
  state.continuousPosition = state.playMethod === "scan" && state.scanMotion === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(
      state.continuousPosition,
      state.position,
      nextPosition,
    );
  state.position = nextPosition;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
}

$("position").addEventListener("input", () => {
  setPosition(Number($("position").value));
  dismissHelp();
});

function setPlaying(playing) {
  state.playing = Boolean(playing);
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause playhead" : "Play playhead");
  $("traversalDirection").hidden = !state.playing;
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
  const crossed = state.playMethod === "scan" && activeLineLayout() === "crossed";
  const bouncing = state.playMethod === "scan" && state.scanMotion === "pingpong";
  const openPoints = state.playMethod === "trace" && state.sides === 2;
  const closedPoints = state.playMethod === "trace" && state.sides > 2;
  const glyph = crossed
    ? (forward ? "↘" : "↖")
    : closedPoints ? (forward ? "↻" : "↺") : (forward ? "→" : "←");
  const text = bouncing
    ? (forward ? "FWD" : "REV")
    : crossed ? (forward ? "→+↓" : "←+↑")
      : openPoints ? (forward ? "FWD" : "REV")
        : closedPoints ? (forward ? "CW" : "CCW") : (forward ? "L→R" : "R→L");
  const label = bouncing
    ? `${forward ? "Forward" : "Reverse"} ping-pong travel`
    : crossed
      ? (forward ? "Scan left to right and top to bottom" : "Scan right to left and bottom to top")
      : openPoints
        ? `${forward ? "Forward" : "Reverse"} point traversal`
        : closedPoints
          ? `Trace ${forward ? "clockwise" : "counterclockwise"}`
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
    state.asymmetry.toFixed(4),
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
    asymmetry: state.asymmetry,
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
    asymmetry: state.asymmetry,
    rotationDeg,
    samplesPerEdge: 48,
  });
}

function currentLocalShape() {
  const key = [
    state.sides,
    state.shapeType,
    state.starDepth.toFixed(4),
    state.curvature.toFixed(4),
    state.aspect.toFixed(4),
    state.skew.toFixed(4),
    state.asymmetry.toFixed(4),
  ].join("|");
  if (cachedLocalShape && cachedLocalShapeKey === key) return cachedLocalShape;
  cachedLocalShapeKey = key;
  cachedLocalShape = buildShape({
    sides: state.sides,
    shapeType: state.shapeType,
    starDepth: state.starDepth,
    curvature: state.curvature,
    aspect: state.aspect,
    skew: state.skew,
    asymmetry: state.asymmetry,
    rotationDeg: 0,
    samplesPerEdge: 48,
  });
  return cachedLocalShape;
}

function phaseForHead(position, headIndex, headCount) {
  if (headIndex === 0 && Math.abs(position - 1) < 1e-9) return 1;
  return wrap01(position + phaseOffsetForHead(headIndex, "trace"));
}

function traceContact(path, phase) {
  return pointAtPath(path, path.closed ? phase : phase * 2, { pingPong: !path.closed });
}

function scanAxisForHead(headIndex) {
  return activeLineLayout() === "crossed" && headIndex % 2 === 1
    ? "horizontal"
    : "vertical";
}

function scanPhaseOffset(headIndex, headCount) {
  return phaseOffsetForHead(headIndex, "scan");
}

function scanPhaseAt(position, headIndex, headCount) {
  const offsetPosition = position + scanPhaseOffset(headIndex, headCount);
  if (state.scanMotion === "pingpong") return pingPong01(offsetPosition);
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
  const phase = scanPhaseAt(position, headIndex, headCount);
  const axis = scanAxisForHead(headIndex);
  const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
  const maximum = axis === "horizontal" ? path.bounds.maxY : path.bounds.maxX;
  const span = maximum - minimum;
  return {
    headIndex,
    phase,
    axis,
    coordinate: span <= 1e-9
      ? (minimum + maximum) / 2
      : minimum + phase * span,
  };
}

function radialAt(path, position, headIndex) {
  const phase = wrap01(position + phaseOffsetForHead(headIndex, "radial"));
  const angle = phase * TAU - Math.PI * 0.5;
  const intersections = rayIntersections(path, angle).map((contact, contactIndex) => ({
    ...contact,
    headIndex,
    headPhase: phase,
    scanAxis: "radial",
    voiceKey: `radial:${headIndex}:${contactIndex}`,
  }));
  return { headIndex, phase, angle, contacts: intersections };
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
      const headTravel = position + phaseOffsetForHead(headIndex, "trace");
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
  context.strokeStyle = "rgba(214,232,226,.12)";
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
          const phase = wrap01(
            state.continuousPosition + phaseOffsetForHead(headIndex, "radial")
              - state.traversalDirection * trail * 0.008,
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
        const trailPosition = state.position - state.traversalDirection * trail * 0.006;
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
  if (state.mappingFrame === "shape") {
    const radians = (-path.rotationDeg * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const localContact = {
      x: contact.x * cosine - contact.y * sine,
      y: contact.x * sine + contact.y * cosine,
    };
    const normalized = pointInBounds01(localContact, currentLocalShape().bounds);
    return { x: clamp(normalized.x, 0, 1), y: clamp(normalized.y, 0, 1) };
  }
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

function incidenceForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  if (state.playMethod === "trace") return clamp(contact.cornerStrength ?? contact.strength ?? 0, 0, 1);
  const tangent = tangentForContact(contact, path);
  const axis = contact.scanAxis ?? scanAxisForHead(headIndex);
  const scanSpeed = state.playing ? state.traversalDirection * state.speed : 0;
  const rotationSpeed = state.autoRotate
    ? state.rotationDirection * state.rotationSpeed * TAU
    : 0;
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

function rawMarkForSource(source, contact, path, headIndex = contact.headIndex ?? 0) {
  if (source === "corner") return clamp(contact.cornerStrength ?? contact.strength ?? 0, 0, 1);
  if (source === "incidence") return incidenceForContact(contact, path, headIndex);
  if (source === "center") return centerDistanceForContact(contact);
  if (source === "phase") {
    return wrap01(contact.u ?? contact.pathPhase ?? 0);
  }
  const normalized = normalizedContactCoordinates(contact, path);
  return clamp(1 - normalized.y, 0, 1);
}

function centerDistanceForContact(contact) {
  const distance = Number.isFinite(contact.rayDistance)
    ? contact.rayDistance
    : Math.hypot(contact.x, contact.y);
  return clamp(distance, 0, 1);
}

function hitLevelMark(contact, path, headIndex = contact.headIndex ?? 0) {
  let raw;
  if (state.hitLevelSource === "fixed") raw = 1;
  else if (state.hitLevelSource === "signed") {
    raw = clamp(((contact.turn ?? contact.cornerTurn ?? 0) + 1) * 0.5, 0, 1);
  } else {
    raw = rawMarkForSource(state.hitLevelSource, contact, path, headIndex);
  }
  return mapCurve01(raw, state.hitLevelCurve);
}

function mappingForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const normalized = normalizedContactCoordinates(contact, path);
  const pitchRaw = rawMarkForSource(state.pitchSource, contact, path, headIndex);
  return {
    pitchRaw,
    pitch: mapCurve01(pitchRaw, state.pitchCurve),
    pan: clamp(normalized.x * 2 - 1, -1, 1) * state.stereoWidth,
    normalized,
    incidence: incidenceForContact(contact, path, headIndex),
  };
}

function pingPongMotionDirection(travelPosition, multiplier = 1) {
  const step = state.traversalDirection * 1e-5;
  const before = pingPong01(travelPosition * multiplier);
  const after = pingPong01((travelPosition + step) * multiplier);
  const delta = after - before;
  return Math.abs(delta) > 1e-9 ? Math.sign(delta) : state.traversalDirection;
}

function pointContourDirection(contact, path) {
  return path.closed
    ? state.traversalDirection
    : pingPongMotionDirection(contact.headTravel, 2);
}

function cornerEnvelopeProfile(contact, path) {
  // A scanner can reverse at a projected shape extremum without crossing a
  // vertex, and rotation can move its contour contact independently of the
  // scanner. Geometric corner distance keeps those line envelopes continuous.
  if (state.playMethod === "scan") {
    return {
      strength: contact.cornerStrength ?? 0,
      distance: clamp(contact.cornerDistance01 ?? 0, 0, 1),
    };
  }

  // Point heads have an unambiguous path direction, so preserve the original
  // Tesselateher profile: each corner peaks, then decays along the next edge.
  const distances = path.vertexDistances;
  if (!distances.length || path.totalLength <= 1e-9) {
    return { strength: contact.cornerStrength ?? 0, distance: 0 };
  }

  const distance = clamp(contact.distance, 0, path.totalLength);
  const direction = pointContourDirection(contact, path);
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
  };
}

function shepardRate() {
  if (!state.playing) return 0;
  const visualLoopRate = state.playMethod === "scan" && state.scanMotion === "pingpong"
    ? state.speed * 0.5
    : state.speed;
  return visualLoopRate
    * state.shepardCycles
    * state.shepardDirection
    * state.traversalDirection;
}

function synthParametersForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const drive = rawMarkForSource(state.synthSource, contact, path, headIndex);
  return synthParametersForMode(state.soundMode, drive, {
    fmIndex: state.fmIndex,
    fmRatio: state.fmRatio,
    pmIndex: state.pmIndex,
    pmRatio: state.pmRatio,
    shepardRate: shepardRate(),
    shepardWidth: state.shepardWidth,
  });
}

function continuousSynthVoices(contacts, path) {
  return contacts.map((contact) => {
    const mapping = mappingForContact(contact, path);
    const corner = cornerEnvelopeProfile(contact, path);
    const synth = synthParametersForContact(contact, path);
    return {
      key: `shape:${contact.voiceKey}`,
      frequency: pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange),
      gain: sineCornerEnvelopeGain(
        corner.strength,
        corner.distance,
        state.sineAccent,
        state.sineDecay,
      ),
      pan: mapping.pan,
      waveform: "sine",
      ...synth,
    };
  });
}

function makeCornerSnapshot(path, continuousPosition = state.continuousPosition) {
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
        : vertexIndex === 0 ? 0 : 0.5,
    };
  });
  const heads = Array.from({ length: count }, (_, headIndex) => ({
    axis: state.playMethod === "scan"
      ? scanAxisForHead(headIndex)
      : state.playMethod === "radial" ? "radial"
      : "path",
    continuousPhase: continuousPosition + (state.playMethod === "scan"
      ? phaseOffsetForHead(headIndex, "scan")
      : phaseOffsetForHead(headIndex, "trace")),
  }));
  return {
    signature: [
      state.playMethod,
      count,
      activeLineLayout(),
      state.scanMotion,
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
    rotationDeg: path.rotationDeg,
    bounds: path.bounds,
    heads,
    vertices,
  };
}

function strikeCorner(path, vertex, headIndex, time01 = 0) {
  if (state.soundMode !== "percussion" || !state.audio || vertex.strength <= 0) return;
  const levelMark = hitLevelMark(vertex, path, headIndex);
  const peak = cornerStrikePeak(levelMark, state.cornerAccent);
  if (peak <= 0) return;
  const mapping = mappingForContact(vertex, path, headIndex);
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
      const phase = head.axis === "path"
        ? wrap01(head.continuousPhase)
        : head.axis !== "radial" && state.scanMotion === "pingpong"
          ? pingPong01(head.continuousPhase)
          : wrap01(head.continuousPhase);
      const distance = state.scanMotion === "loop" || head.axis === "path" || head.axis === "radial"
        ? Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target))
        : Math.abs(phase - target);
      if (distance <= epsilon) strikeCorner(path, vertex, headIndex);
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
      const crossed = ["vertical", "horizontal"].includes(afterHead.axis)
        && state.scanMotion === "pingpong"
        ? crossesPingPongTarget(
          beforeHead.continuousPhase,
          afterHead.continuousPhase,
          beforeTarget,
          afterTarget,
        )
        : crossesPeriodicTarget(
          beforeHead.continuousPhase,
          afterHead.continuousPhase,
          beforeTarget,
          afterTarget,
        );
      if (crossed) {
        strikeCorner(path, afterVertex, headIndex, time01);
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
  const rotationDelta = normalizeDegrees(finalSnapshot.rotationDeg - cornerSnapshot.rotationDeg);
  const steps = motionSubsteps(positionDelta, rotationDelta);
  let previous = cornerSnapshot;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const isFinal = step === steps;
    const path = isFinal
      ? finalPath
      : buildShape({
        sides: state.sides,
        shapeType: state.shapeType,
        starDepth: state.starDepth,
        curvature: state.curvature,
        aspect: state.aspect,
        skew: state.skew,
        asymmetry: state.asymmetry,
        rotationDeg: normalizeDegrees(cornerSnapshot.rotationDeg + rotationDelta * amount),
        samplesPerEdge: 48,
      });
    const snapshot = isFinal
      ? finalSnapshot
      : makeCornerSnapshot(
        path,
        cornerSnapshot.continuousPosition + positionDelta * amount,
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

const SOURCE_LABELS = {
  height: "Vertical position",
  center: "Distance from center",
  corner: "Corner magnitude",
  incidence: "Incidence",
  phase: "Contour phase",
  fixed: "Fixed",
  signed: "Inner / outer polarity",
};

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
    return cornerStrikePeak(hitLevelMark(contact, path), state.cornerAccent);
  }
  const corner = cornerEnvelopeProfile(contact, path);
  return sineCornerEnvelopeGain(
    corner.strength,
    corner.distance,
    state.sineAccent,
    state.sineDecay,
  );
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
  if (state.soundMode === "percussion") return `${Math.round(state.cornerDecay)} ms strike`;
  return "corner envelope";
}

function updateOutputDashboard(contacts, path) {
  $("outputVoiceLabel").textContent = state.soundMode;
  $("pitchRouteSource").textContent = SOURCE_LABELS[state.pitchSource] ?? state.pitchSource;
  $("pitchRouteCurve").textContent = `${CURVE_LABELS[state.pitchCurve]} mark → exponential Hz`;
  $("levelRouteSource").textContent = state.soundMode === "percussion"
    ? SOURCE_LABELS[state.hitLevelSource] ?? state.hitLevelSource
    : "Corner distance + magnitude";
  $("levelRouteCurve").textContent = state.soundMode === "percussion"
    ? CURVE_LABELS[state.hitLevelCurve] ?? state.hitLevelCurve
    : "spatial amplitude envelope";
  const modulationMode = ["fm", "pm"].includes(state.soundMode);
  $("synthRoute").hidden = !modulationMode && state.soundMode !== "shepard";
  $("synthRouteSource").textContent = modulationMode
    ? SOURCE_LABELS[state.synthSource]
    : "Shape transport";
  $("synthRouteTarget").textContent = modulationMode ? "Mod depth" : "Glissando";
  $("synthRouteCurve").textContent = modulationMode
    ? "linear geometry drive"
    : `${state.shepardCycles.toFixed(2)} octaves per loop`;

  if (!contacts.length) {
    $("outputContactLabel").textContent = "No active contact";
    for (const id of [
      "markPhaseOut", "markPositionOut", "markCenterOut", "markTurnOut", "markDistanceOut",
      "markIncidenceOut", "markTangentOut", "markPitchValueOut",
      "markFrequencyOut", "markGainOut", "markPanOut",
      "markSynthDriveOut", "markSynthValueOut",
    ]) $(id).textContent = "—";
    $("markDecayOut").textContent = state.soundMode === "percussion"
      ? `${Math.round(state.cornerDecay)} ms`
      : `${Math.round(state.sineDecay * 100)}% profile`;
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
  $("markSynthDriveOut").textContent = ["fm", "pm"].includes(state.soundMode)
    ? synth.synthDrive.toFixed(3)
    : state.soundMode === "shepard" ? wrap01(contact.u ?? contact.headPhase ?? 0).toFixed(3) : "-";
  $("markSynthValueOut").textContent = synthValueLabel(synth);
  $("markDecayOut").textContent = state.soundMode === "percussion"
    ? `${Math.round(state.cornerDecay)} ms`
    : `${Math.round(state.sineDecay * 100)}% profile`;
  $("markRotationOut").textContent = `${Math.round(state.rotation)}°`;

  $("contactStream").innerHTML = contacts.slice(0, 12).map((item, index) => {
    const itemMapping = mappingForContact(item, path);
    const itemFrequency = pitch01ToFrequency(itemMapping.pitch, state.baseFrequency, state.pitchRange);
    return `<div class="contact-row"><b>#${index + 1}</b><span>u ${wrap01(item.u ?? item.headPhase ?? 0).toFixed(3)}</span><span>∠ ${Math.round((item.cornerTurn ?? 0) * 180)}°</span><span>${Math.round(itemFrequency)} Hz</span></div>`;
  }).join("");
}

function updateUi(contacts, voiceCount, path) {
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
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
    state.position = state.playMethod === "scan" && state.scanMotion === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }

  if (state.autoRotate) {
    state.rotation = normalizeDegrees(
      state.rotation + state.rotationDirection * state.rotationSpeed * 360 * deltaSeconds,
    );
  }

  const path = currentShape();
  const moving = state.playing || state.autoRotate;
  pendingCornerStrikes = [];
  if (state.soundMode === "percussion") {
    trackCornerMotion(path);
    flushCornerStrikes(deltaSeconds);
  } else cornerSnapshot = null;
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
        const futureRotation = normalizeDegrees(
          state.rotation + (state.autoRotate
            ? state.rotationDirection * state.rotationSpeed * 360 * AUDIO_LOOKAHEAD_SECONDS
            : 0),
        );
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
        pool.setVoices(continuousMode ? synthVoices : []);
      }
      lastAudioUpdate = now;
    }
  }

  if (!moving || now - lastUiUpdate > 60) {
    const voiceCount = continuousMode
      ? Math.min(synthVoices.length, MAX_CONTINUOUS_VOICES)
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
  state.rotation = normalizeDegrees(pointerGesture.startRotation + angleDelta * 180 / Math.PI);
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
  invalidate();
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

updateSidesOutput();
updateCurvatureOutput();
setShapeType(state.shapeType, false);
setLineLayout("parallel", false);
setPlayMethod(state.playMethod, false);
setScanMotion(state.scanMotion, false);
setSoundMode(state.soundMode, false);
setTraversalDirection(1, false);
setRotationDirection(1, false);
setRotationPlaying(false, false);
paintAudioState();
renderHeadLayout();
updateSectionSummaries();
$("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
lastFrameTime = performance.now();
scheduleFrame();
