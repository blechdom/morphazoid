import {
  TILING_TYPES,
  buildPrototile,
  constrainPrototileEdit,
  edgeShapeName,
  parametersForDraggedVertex,
  tilingInfo,
  tilingParameterRange,
} from "./src/lattice.js";
import {
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
  phaseForSpiralPoint,
  spiralLoopLogOffset,
} from "./src/spiral.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  SPIRAL_DRUM_MAPPING_MODES,
  mappedSpiralDrumVoice,
  normalizedSpiralContact,
  spiralDrumVoiceIndex,
} from "./src/spiral-drums.js";
import { EdgeShape } from "./vendor/tactile/tactile.js";
import {
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import { FM_DRUM_MIDI_FIRST_NOTE } from "./src/fm-drums-midi.js";
import { emitMidiOutputPreview } from "./src/midi-output-preview.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_PARAMETERS = 6;
const MAX_EDGE_CLASSES = 5;
const DEFAULT_TILING_TYPE = 20;
const GEOMETRY_EDIT_SETTLE_MS = 180;
const MIDI_PREVIEW_ROUTE_ID = "spiral-drums";
const MIDI_PREVIEW_REENTRY_MS = 75;
const MIDI_PREVIEW_FRAME_INTERVAL_MS = 40;
const MANUAL_AUDITION_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "PageDown",
  "PageUp",
]);
const TILE_COLORS = [
  "rgba(95,232,196,.050)",
  "rgba(232,196,107,.050)",
  "rgba(125,180,255,.045)",
  "rgba(255,130,111,.042)",
];
const defaults = Object.freeze({
  tilingType: DEFAULT_TILING_TYPE,
  spiralA: 1,
  spiralB: 5,
  patternScale: 0,
  patternRotation: 0,
  timePath: "radius",
  position: 0,
  loopPhase: 0,
  speed: .12,
  traversalDirection: 1,
  motionMode: "loop",
  loopSpeed: .05,
  loopDirection: 1,
  readerTurns: 2,
  sizeCoupling: false,
  mappingMode: "radius-angle",
  pitchDepth: 12,
  characterDepth: .7,
  strikeLimit: 6,
  output: .65,
});
const defaultInfo = tilingInfo(DEFAULT_TILING_TYPE);
const state = {
  ...defaults,
  parameters: [...defaultInfo.defaultParameters],
  edgeCurves: defaultInfo.edgeShapes.map(() => 0),
  continuousPosition: defaults.position,
  continuousLoopPhase: defaults.loopPhase,
  playing: false,
  loopPlaying: false,
  audioOn: false,
};

const audio = new FmDrumAudio(globalThis);
const voices = loadDrumBank();
const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const tileEditorCanvas = $("tileEditorCanvas");
const tileEditorContext = tileEditorCanvas.getContext("2d");
const lastStrikeTimes = new Map();
let midiPreviewContactKeys = new Set();
const midiPreviewLastStrikeTimes = new Map();
const midiPreviewControlValues = new Map();
const pendingMidiPreviewSignals = new Map();
let lastMidiPreviewFlushTime = Number.NEGATIVE_INFINITY;
const movableVertexCache = new Map();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let worldScale = 1;
let tessellation = null;
let geometryDirty = true;
let tileEditorDirty = true;
let tileEditorDrag = null;
let tileEditorView = null;
let pointerDrag = null;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let previousContactKeys = new Set();
let suppressStrikesUntil = 0;
let suppressStrikeFrames = 2;
let suppressMidiPreviewUntil = 0;
let suppressMidiPreviewFrames = 2;
let manualAudition = false;
let manualAuditionMoved = false;
let midiPreviewAudition = false;
let midiPreviewAuditionMoved = false;

function clamp(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : 0));
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pingPong01(value) {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function publishMidiPreview(detail) {
  return emitMidiOutputPreview({
    ...detail,
    routeId: MIDI_PREVIEW_ROUTE_ID,
  });
}

function queueMidiPreviewSignal(detail) {
  pendingMidiPreviewSignals.set(`${detail.kind}:${detail.sourceId}`, detail);
  scheduleFrame();
}

function flushMidiPreviewSignals(now) {
  if (!pendingMidiPreviewSignals.size) return;
  if (
    now >= lastMidiPreviewFlushTime
    && now - lastMidiPreviewFlushTime < MIDI_PREVIEW_FRAME_INTERVAL_MS
  ) {
    scheduleFrame();
    return;
  }
  lastMidiPreviewFlushTime = now;
  for (const detail of pendingMidiPreviewSignals.values()) publishMidiPreview(detail);
  pendingMidiPreviewSignals.clear();
}

function emitMidiPreviewControl({ source, sourceId, rawValue, min, max, displayValue, unit = "" }) {
  const signature = `${rawValue}:${displayValue}`;
  if (midiPreviewControlValues.get(sourceId) === signature) return;
  midiPreviewControlValues.set(sourceId, signature);
  queueMidiPreviewSignal({
    kind: "control",
    source,
    sourceId,
    rawValue,
    min,
    max,
    displayValue,
    unit,
  });
}

function emitReaderPhasePreview() {
  emitMidiPreviewControl({
    source: "Reader phase",
    sourceId: "spiral-drums-reader-phase",
    rawValue: state.position,
    min: 0,
    max: 1,
    displayValue: `${(state.position * 100).toFixed(1)}%`,
    unit: "phase",
  });
}

function emitZoomPhasePreview() {
  emitMidiPreviewControl({
    source: "Zoom phase",
    sourceId: "spiral-drums-zoom-phase",
    rawValue: state.loopPhase,
    min: 0,
    max: 1,
    displayValue: `${spiralLoopLogOffset(state.loopPhase).toFixed(2)} log scale`,
    unit: "phase",
  });
}

function emitReaderPathPreview() {
  const paths = ["radius", "angle", "spiral"];
  const pathIndex = Math.max(0, paths.indexOf(state.timePath));
  emitMidiPreviewControl({
    source: "Reader path",
    sourceId: "spiral-drums-reader-path",
    rawValue: pathIndex,
    min: 0,
    max: paths.length - 1,
    displayValue: state.timePath[0].toUpperCase() + state.timePath.slice(1),
  });
}

function emitReaderModePreview() {
  emitMidiPreviewControl({
    source: "Reader motion",
    sourceId: "spiral-drums-reader-mode",
    rawValue: state.motionMode === "pingpong" ? 1 : 0,
    min: 0,
    max: 1,
    displayValue: state.motionMode === "pingpong" ? "Ping-pong" : "Loop",
  });
}

function emitReaderDirectionPreview() {
  const displayValue = state.motionMode === "pingpong"
    ? (state.traversalDirection > 0 ? "Forward" : "Reverse")
    : directionLabel();
  emitMidiPreviewControl({
    source: "Reader direction",
    sourceId: "spiral-drums-reader-direction",
    rawValue: state.traversalDirection,
    min: -1,
    max: 1,
    displayValue,
  });
}

function emitZoomDirectionPreview() {
  emitMidiPreviewControl({
    source: "Zoom direction",
    sourceId: "spiral-drums-zoom-direction",
    rawValue: state.loopDirection,
    min: -1,
    max: 1,
    displayValue: state.loopDirection > 0 ? "Forward" : "Reverse",
  });
}

function emitReaderTimebasePreview() {
  queueMidiPreviewSignal({
    kind: "timebase",
    source: "Reader speed",
    sourceId: "spiral-drums-reader-timebase",
    rate: state.speed,
    unit: "cycles/s",
    running: state.playing,
    displayValue: `${state.speed.toFixed(3)} cyc/s`,
  });
}

function emitZoomTimebasePreview() {
  queueMidiPreviewSignal({
    kind: "timebase",
    source: "Zoom speed",
    sourceId: "spiral-drums-zoom-timebase",
    rate: state.loopSpeed,
    unit: "cycles/s",
    running: state.loopPlaying,
    displayValue: `${state.loopSpeed.toFixed(3)} cyc/s`,
  });
}

function emitReaderTransportPreview() {
  publishMidiPreview({
    kind: "transport",
    source: "Spiral drum reader",
    sourceId: "spiral-drums-reader-transport",
    state: state.playing ? "start" : "stop",
    position: state.position,
  });
}

function emitZoomTransportPreview() {
  publishMidiPreview({
    kind: "transport",
    source: "Spiral drum zoom",
    sourceId: "spiral-drums-zoom-transport",
    state: state.loopPlaying ? "start" : "stop",
    position: state.loopPhase,
  });
}

for (const id of [
  "position",
  "speed",
  "loopPhase",
  "loopSpeed",
  "playButton",
  "loopPlayButton",
  "traversalDirection",
  "loopDirection",
]) {
  $(id).setAttribute("data-no-midi-preview", "");
}
for (const groupId of ["timePath", "playheadMotion"]) {
  for (const button of $(groupId).querySelectorAll("button")) {
    button.setAttribute("data-no-midi-preview", "");
  }
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function suppressContactStrikes(duration = GEOMETRY_EDIT_SETTLE_MS) {
  const interactionTime = Math.max(performance.now(), lastFrameTime);
  suppressStrikesUntil = Math.max(suppressStrikesUntil, interactionTime + duration);
  suppressStrikeFrames = Math.max(suppressStrikeFrames, 2);
}

function suppressMidiPreviewNotes(duration = GEOMETRY_EDIT_SETTLE_MS) {
  const interactionTime = Math.max(performance.now(), lastFrameTime);
  suppressMidiPreviewUntil = Math.max(suppressMidiPreviewUntil, interactionTime + duration);
  suppressMidiPreviewFrames = Math.max(suppressMidiPreviewFrames, 2);
}

function clearMidiPreviewSuppression() {
  suppressMidiPreviewUntil = 0;
  suppressMidiPreviewFrames = 0;
}

function clearStrikeSuppression() {
  suppressStrikesUntil = 0;
  suppressStrikeFrames = 0;
}

function invalidateGeometry() {
  geometryDirty = true;
  tileEditorDirty = true;
  suppressContactStrikes();
  suppressMidiPreviewNotes();
  scheduleFrame();
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice) => {
      const saved = stored.find((candidate) => candidate?.id === voice.id);
      return sanitizeFmDrumVoice({ ...voice, ...saved, id: voice.id, key: voice.key });
    });
  } catch {
    return fallback;
  }
}

function setAudioState(enabled) {
  if (!enabled) endManualAudition();
  state.audioOn = Boolean(enabled);
  setPressed($("audioButton"), state.audioOn);
  $("audioState").textContent = state.audioOn ? "on" : "off";
  audio.setOutput(state.audioOn ? state.output : 0);
}

async function enableAudio() {
  try {
    $("audioError").hidden = true;
    await audio.start();
    setAudioState(true);
    scheduleFrame();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const paint = () => {
    input.value = String(state[key]);
    output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    afterChange?.();
    paint();
    scheduleFrame();
  });
  paint();
  return paint;
}

bindRange(
  "speed",
  "speed",
  (value) => `${value.toFixed(3)} cyc/s`,
  emitReaderTimebasePreview,
);
bindRange(
  "loopSpeed",
  "loopSpeed",
  (value) => `${value.toFixed(3)} cyc/s`,
  emitZoomTimebasePreview,
);
bindRange(
  "readerTurns",
  "readerTurns",
  (value) => `${value.toFixed(2)} turns`,
  () => {
    suppressContactStrikes();
    suppressMidiPreviewNotes();
  },
);
bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  if (state.audioOn) audio.setOutput(state.output);
});
bindRange("pitchDepth", "pitchDepth", (value) => `±${Math.round(value)} st`);
bindRange(
  "characterDepth",
  "characterDepth",
  (value) => `${Math.round(value * 100)}%`,
);
bindRange("strikeLimit", "strikeLimit", (value) => String(Math.round(value)));
bindRange("spiralA", "spiralA", (value) => String(Math.round(value)), () => {
  state.spiralA = Math.round(state.spiralA);
  if (state.spiralA === 0 && state.spiralB === 0) {
    state.spiralB = 1;
    $("spiralB").value = "1";
    $("spiralBOut").textContent = "1";
  }
  invalidateGeometry();
  updateSummaries();
});
bindRange("spiralB", "spiralB", (value) => String(Math.round(value)), () => {
  state.spiralB = Math.round(state.spiralB);
  if (state.spiralA === 0 && state.spiralB === 0) {
    state.spiralA = 1;
    $("spiralA").value = "1";
    $("spiralAOut").textContent = "1";
  }
  invalidateGeometry();
  updateSummaries();
});
bindRange(
  "patternScale",
  "patternScale",
  (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
  invalidateGeometry,
);
bindRange(
  "patternRotation",
  "patternRotation",
  (value) => `${Math.round(value)}°`,
  invalidateGeometry,
);

function setLoopPhase(value, { audition = false } = {}) {
  const nextLoopPhase = clamp(value);
  const moved = Math.abs(nextLoopPhase - state.loopPhase) > 1e-9;
  state.loopPhase = nextLoopPhase;
  state.continuousLoopPhase = state.loopPhase;
  $("loopPhase").value = String(state.loopPhase);
  paintLoopPhase();
  geometryDirty = true;
  if (audition && moved) {
    manualAuditionMoved = true;
    clearStrikeSuppression();
  }
  else suppressContactStrikes();
  if (midiPreviewAudition && moved) {
    midiPreviewAuditionMoved = true;
    clearMidiPreviewSuppression();
  } else {
    suppressMidiPreviewNotes();
  }
  emitZoomPhasePreview();
  scheduleFrame();
}

function paintLoopPhase() {
  const offset = spiralLoopLogOffset(state.loopPhase);
  const phaseDirection = state.loopPhase < .5 ? 1 : -1;
  const zoomingIn = phaseDirection * state.loopDirection > 0;
  $("loopPhaseOut").textContent = `${offset.toFixed(2)} · ${zoomingIn ? "IN" : "OUT"}`;
}

$("loopPhase").addEventListener("input", (event) => {
  const audition = beginManualAudition(event);
  beginMidiPreviewAudition(event);
  setLoopPhase($("loopPhase").value, { audition });
});

const tilingSelect = $("tilingType");
tilingSelect.innerHTML = [...new Set(TILING_TYPES.map((info) => info.family))]
  .map((family) => {
    const options = TILING_TYPES
      .filter((info) => info.family === family)
      .map((info) => `<option value="${info.type}">${info.label}</option>`)
      .join("");
    return `<optgroup label="${family}">${options}</optgroup>`;
  })
  .join("");
tilingSelect.value = String(state.tilingType);

function formatBend(value, rigid = false) {
  if (rigid) return "fixed straight";
  if (Math.abs(value) < .005) return "straight";
  return `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "reverse" : "forward"}`;
}

function paintParameterControl(index) {
  const value = state.parameters[index] ?? 0;
  $(`parameter${index}`).value = String(value);
  $(`parameter${index}Out`).textContent = value.toFixed(3);
}

function paintEdgeControl(index) {
  const info = tilingInfo(state.tilingType);
  const rigid = info.edgeShapes[index] === EdgeShape.I;
  const value = rigid ? 0 : (state.edgeCurves[index] ?? 0);
  $(`edgeCurve${index}`).value = String(value);
  $(`edgeCurve${index}Out`).textContent = formatBend(value, rigid);
}

function configureTilingControls() {
  const info = tilingInfo(state.tilingType);
  $("parameterCount").textContent = [
    info.defaultParameters.length,
    plural(info.defaultParameters.length, "parameter"),
    "· guarded",
  ].join(" ");
  for (let index = 0; index < MAX_PARAMETERS; index += 1) {
    const visible = index < info.defaultParameters.length;
    const wrapper = $(`parameterControl${index}`);
    const input = $(`parameter${index}`);
    wrapper.hidden = !visible;
    if (!visible) continue;
    const range = tilingParameterRange(info.type, index);
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = ".005";
    $(`parameterLabel${index}`).textContent = `Shape ${index + 1}`;
    paintParameterControl(index);
  }
  const bendableCount = info.edgeShapes.filter((shape) => shape !== EdgeShape.I).length;
  $("edgeCount").textContent = `${bendableCount} bendable ${plural(
    bendableCount,
    "class",
    "classes",
  )}`;
  for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
    const exists = index < info.edgeShapes.length;
    const wrapper = $(`edgeControl${index}`);
    const input = $(`edgeCurve${index}`);
    if (!exists) {
      wrapper.hidden = true;
      continue;
    }
    const shape = info.edgeShapes[index];
    const rigid = shape === EdgeShape.I;
    wrapper.hidden = rigid;
    input.disabled = rigid;
    $(`edgeLabel${index}`).textContent = [
      `Edge ${String.fromCharCode(65 + index)}`,
      `· ${edgeShapeName(shape)}${rigid ? " rigid" : ""}`,
    ].join(" ");
    paintEdgeControl(index);
  }
  const editable = info.defaultParameters.length > 0;
  $("resetTileVertices").disabled = !editable;
  tileEditorCanvas.setAttribute("aria-disabled", String(!editable));
  $("tileEditorLegend").textContent = editable
    ? "movable corner"
    : "symmetry-locked corners";
  tileEditorDirty = true;
}

function parametersChanged(first, second, tolerance = 1e-8) {
  return first.some((value, index) => Math.abs(value - second[index]) > tolerance);
}

function movableVerticesFor(model) {
  if (movableVertexCache.has(model.type)) return movableVertexCache.get(model.type);
  const movable = model.vertices.map((vertex, vertexIndex) => {
    if (!model.parameters.length) return false;
    const horizontal = parametersForDraggedVertex({
      type: model.type,
      parameters: model.parameters,
      vertexIndex,
      target: { x: vertex.x + .025, y: vertex.y },
    });
    const vertical = parametersForDraggedVertex({
      type: model.type,
      parameters: model.parameters,
      vertexIndex,
      target: { x: vertex.x, y: vertex.y + .025 },
    });
    return parametersChanged(model.parameters, horizontal)
      || parametersChanged(model.parameters, vertical);
  });
  movableVertexCache.set(model.type, movable);
  return movable;
}

function editorScreenPoint(point, view) {
  return {
    x: view.width / 2 + (point.x - view.center.x) * view.scale,
    y: view.height / 2 - (point.y - view.center.y) * view.scale,
  };
}

function editorPointerPoint(event, view) {
  const bounds = tileEditorCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * view.width / Math.max(bounds.width, 1),
    y: (event.clientY - bounds.top) * view.height / Math.max(bounds.height, 1),
  };
}

function editorNaturalPoint(event, view) {
  const point = editorPointerPoint(event, view);
  return {
    x: view.center.x + (point.x - view.width / 2) / view.scale,
    y: view.center.y - (point.y - view.height / 2) / view.scale,
  };
}

function traceEditorPoints(points, view, close = false) {
  if (!points.length) return;
  const first = editorScreenPoint(points[0], view);
  tileEditorContext.beginPath();
  tileEditorContext.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = editorScreenPoint(points[index], view);
    tileEditorContext.lineTo(point.x, point.y);
  }
  if (close) tileEditorContext.closePath();
}

function drawTileEditor(lockedView = tileEditorDrag?.view) {
  const model = buildPrototile({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
  });
  const bounds = tileEditorCanvas.getBoundingClientRect();
  const width = Math.round(clamp(bounds.width || 320, 220, 480));
  const height = Math.round(clamp(bounds.height || 220, 160, 330));
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (tileEditorCanvas.width !== pixelWidth) tileEditorCanvas.width = pixelWidth;
  if (tileEditorCanvas.height !== pixelHeight) tileEditorCanvas.height = pixelHeight;
  tileEditorContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  tileEditorContext.clearRect(0, 0, width, height);
  const view = lockedView && lockedView.width === width && lockedView.height === height
    ? lockedView
    : {
      width,
      height,
      center: {
        x: (model.bounds.minX + model.bounds.maxX) / 2,
        y: (model.bounds.minY + model.bounds.maxY) / 2,
      },
      scale: Math.min(
        (width - 54) / Math.max(model.bounds.maxX - model.bounds.minX, .2),
        (height - 54) / Math.max(model.bounds.maxY - model.bounds.minY, .2),
      ),
    };
  traceEditorPoints(model.outline, view, true);
  tileEditorContext.fillStyle = "rgba(255,130,111,.12)";
  tileEditorContext.fill();
  tileEditorContext.strokeStyle = "rgba(214,232,226,.72)";
  tileEditorContext.lineWidth = 1.2;
  tileEditorContext.lineJoin = "round";
  tileEditorContext.stroke();
  traceEditorPoints(model.vertices, view, true);
  tileEditorContext.strokeStyle = "rgba(255,130,111,.24)";
  tileEditorContext.lineWidth = .8;
  tileEditorContext.stroke();
  const movable = movableVerticesFor(model);
  model.vertices.forEach((vertex, index) => {
    const point = editorScreenPoint(vertex, view);
    tileEditorContext.beginPath();
    tileEditorContext.arc(point.x, point.y, movable[index] ? 6 : 3.5, 0, TAU);
    tileEditorContext.fillStyle = movable[index]
      ? "#ff826f"
      : "rgba(214,232,226,.38)";
    tileEditorContext.fill();
    if (movable[index]) {
      tileEditorContext.strokeStyle = "#fff3d6";
      tileEditorContext.lineWidth = 1;
      tileEditorContext.stroke();
    }
  });
  tileEditorView = { ...view, model, movable };
  tileEditorDirty = false;
}

function guardedPrototileEdit(parameters = state.parameters, edgeCurves = state.edgeCurves) {
  return constrainPrototileEdit({
    type: state.tilingType,
    currentParameters: state.parameters,
    parameters,
    currentEdgeCurves: state.edgeCurves,
    edgeCurves,
  });
}

tileEditorCanvas.addEventListener("pointerdown", (event) => {
  if (tileEditorDirty || !tileEditorView) drawTileEditor();
  const point = editorPointerPoint(event, tileEditorView);
  let nearest = -1;
  let nearestDistance = 15;
  tileEditorView.model.vertices.forEach((vertex, index) => {
    if (!tileEditorView.movable[index]) return;
    const screen = editorScreenPoint(vertex, tileEditorView);
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  if (nearest < 0) {
    announce(tileEditorView.model.parameters.length
      ? "Choose a coral movable corner."
      : "This tile's corners are fixed by symmetry.");
    return;
  }
  tileEditorDrag = {
    vertexIndex: nearest,
    constrained: false,
    view: {
      width: tileEditorView.width,
      height: tileEditorView.height,
      center: { ...tileEditorView.center },
      scale: tileEditorView.scale,
    },
  };
  tileEditorCanvas.style.cursor = "grabbing";
  tileEditorCanvas.setPointerCapture(event.pointerId);
  tileEditorCanvas.focus();
  event.preventDefault?.();
});

tileEditorCanvas.addEventListener("pointermove", (event) => {
  if (!tileEditorDrag) return;
  const requested = parametersForDraggedVertex({
    type: state.tilingType,
    parameters: state.parameters,
    vertexIndex: tileEditorDrag.vertexIndex,
    target: editorNaturalPoint(event, tileEditorDrag.view),
  });
  const guarded = guardedPrototileEdit(requested);
  state.parameters = guarded.parameters;
  state.edgeCurves = guarded.edgeCurves;
  tileEditorDrag.constrained ||= guarded.constrained;
  state.parameters.forEach((_, index) => paintParameterControl(index));
  invalidateGeometry();
  drawTileEditor(tileEditorDrag.view);
  event.preventDefault?.();
});

function finishTileEditorDrag() {
  if (!tileEditorDrag) return;
  const constrained = tileEditorDrag.constrained;
  tileEditorDrag = null;
  tileEditorCanvas.style.cursor = "";
  tileEditorDirty = true;
  drawTileEditor();
  announce(constrained
    ? "Overlap guard limited the vertex edit."
    : "Spiral tile updated.");
}

tileEditorCanvas.addEventListener("pointerup", finishTileEditorDrag);
tileEditorCanvas.addEventListener("pointercancel", finishTileEditorDrag);

for (let index = 0; index < MAX_PARAMETERS; index += 1) {
  $(`parameter${index}`).addEventListener("input", () => {
    const requested = [...state.parameters];
    requested[index] = Number($(`parameter${index}`).value);
    const guarded = guardedPrototileEdit(requested);
    state.parameters = guarded.parameters;
    state.edgeCurves = guarded.edgeCurves;
    state.parameters.forEach((_, controlIndex) => paintParameterControl(controlIndex));
    if (guarded.constrained) announce("Overlap guard limited the shape parameter.");
    invalidateGeometry();
  });
}

for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
  $(`edgeCurve${index}`).addEventListener("input", () => {
    const info = tilingInfo(state.tilingType);
    if (info.edgeShapes[index] === EdgeShape.I) return;
    const requested = [...state.edgeCurves];
    requested[index] = Number($(`edgeCurve${index}`).value);
    const guarded = guardedPrototileEdit(state.parameters, requested);
    state.parameters = guarded.parameters;
    state.edgeCurves = guarded.edgeCurves;
    state.edgeCurves.forEach((_, controlIndex) => paintEdgeControl(controlIndex));
    if (guarded.constrained) announce("Overlap guard limited the edge bend.");
    invalidateGeometry();
  });
}

function setTilingType(type, shouldAnnounce = true) {
  const info = tilingInfo(type);
  state.tilingType = info.type;
  state.parameters = [...info.defaultParameters];
  state.edgeCurves = info.edgeShapes.map(() => 0);
  tilingSelect.value = String(info.type);
  configureTilingControls();
  updateSummaries();
  invalidateGeometry();
  if (shouldAnnounce) announce(`${info.label} selected with straight matching edges.`);
}

tilingSelect.addEventListener("change", () => {
  setTilingType(Number(tilingSelect.value));
});

$("resetTileVertices").addEventListener("click", () => {
  state.parameters = [...tilingInfo(state.tilingType).defaultParameters];
  state.parameters.forEach((_, index) => paintParameterControl(index));
  invalidateGeometry();
  announce("Tile vertices reset to this family's defaults.");
});

$("straightenEdges").addEventListener("click", () => {
  state.edgeCurves = tilingInfo(state.tilingType).edgeShapes.map(() => 0);
  state.edgeCurves.forEach((_, index) => paintEdgeControl(index));
  invalidateGeometry();
  announce("All bendable edges straightened.");
});

$("resetForm").addEventListener("click", () => {
  setTilingType(DEFAULT_TILING_TYPE, false);
  announce("Spiral tile reset to IH20.");
});

$("resetWinding").addEventListener("click", () => {
  Object.assign(state, {
    spiralA: defaults.spiralA,
    spiralB: defaults.spiralB,
    patternScale: defaults.patternScale,
    patternRotation: defaults.patternRotation,
  });
  for (const key of ["spiralA", "spiralB", "patternScale", "patternRotation"]) {
    $(key).value = String(state[key]);
  }
  $("spiralAOut").textContent = "1";
  $("spiralBOut").textContent = "5";
  $("patternScaleOut").textContent = "+0.00";
  $("patternRotationOut").textContent = "0°";
  updateSummaries();
  invalidateGeometry();
  announce("Spiral winding reset.");
});

function directionLabel() {
  if (state.timePath === "radius") {
    return state.traversalDirection > 0 ? "Out → In" : "In → Out";
  }
  return state.traversalDirection > 0 ? "Clockwise" : "Counterclockwise";
}

function coordinateLabel() {
  if (state.timePath === "radius") return state.sizeCoupling ? "R" : "LOG R";
  if (state.timePath === "angle") return "THETA";
  return "LOG R + THETA";
}

function updateSummaries() {
  const timeName = state.timePath[0].toUpperCase() + state.timePath.slice(1);
  const active = [
    state.playing ? "time" : "",
    state.loopPlaying ? "loop" : "",
    manualAudition ? "scrub" : "",
  ].filter(Boolean).join(" + ");
  $("playSummary").textContent = `${timeName} · ${active || "paused"} · ${state.motionMode} · ${state.traversalDirection > 0 ? "forward" : "reverse"}`;
  $("formSummary").textContent = tilingInfo(state.tilingType).label;
  $("windingSummary").textContent = `A${state.spiralA} · B${state.spiralB}`;
  const mode = SPIRAL_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode);
  $("mappingSummary").textContent = mode?.label.toLowerCase() ?? "custom";
  $("mappingDescription").textContent = mode?.description ?? "";
}

function updateTimeControls() {
  for (const button of $("timePath").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.timePath);
  }
  $("readerTurnsControl").hidden = state.timePath !== "spiral";
  const forward = state.traversalDirection > 0;
  $("traversalDirectionGlyph").textContent = forward ? "→" : "←";
  $("traversalDirectionText").textContent = state.motionMode === "pingpong"
    ? (forward ? "FWD" : "REV")
    : state.timePath === "radius"
      ? (forward ? "OUT→IN" : "IN→OUT")
      : (forward ? "CW" : "CCW");
  $("traversalDirection").setAttribute(
    "aria-label",
    state.motionMode === "pingpong"
      ? `Time direction: ${forward ? "forward" : "reverse"} ping-pong travel`
      : `Time direction: ${directionLabel()}`,
  );
  for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.motionMode);
  }
  $("loopDirection").textContent = "Reverse zoom";
  $("coordinateReadout").textContent = `${coordinateLabel()} · ${state.motionMode === "pingpong" ? "PING-PONG · " : ""}${directionLabel().toUpperCase()}`;
  setPressed($("sizeCoupling"), state.sizeCoupling);
  $("sizeCoupling").textContent = [
    "Size affects reader time",
    `· ${state.sizeCoupling ? "on" : "off"}`,
  ].join(" ");
  $("sizeCoupling").setAttribute(
    "aria-label",
    `Size affects reader time ${state.sizeCoupling ? "on" : "off"}`,
  );
  updateSummaries();
}

for (const button of $("timePath").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.timePath = button.dataset.value;
    previousContactKeys.clear();
    suppressContactStrikes();
    suppressMidiPreviewNotes();
    updateTimeControls();
    emitReaderPathPreview();
    emitReaderDirectionPreview();
    announce(`${button.textContent} time selected.`);
    scheduleFrame();
  });
}

$("traversalDirection").addEventListener("click", () => {
  state.traversalDirection *= -1;
  updateTimeControls();
  emitReaderDirectionPreview();
  announce(`Time direction ${directionLabel()}.`);
});

function setMotionMode(motion, shouldAnnounce = true) {
  const nextMotion = motion === "pingpong" ? "pingpong" : "loop";
  if (nextMotion !== state.motionMode) {
    state.continuousPosition = nextMotion === "pingpong"
      ? rebasePingPongPosition(state.continuousPosition, state.position)
      : rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
    );
    state.motionMode = nextMotion;
  }
  updateTimeControls();
  emitReaderModePreview();
  emitReaderDirectionPreview();
  if (shouldAnnounce) {
    announce(`${nextMotion === "pingpong" ? "Ping-pong" : "Loop"} time movement selected.`);
  }
  scheduleFrame();
}

for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
  button.addEventListener("click", () => setMotionMode(button.dataset.value));
}

$("loopDirection").addEventListener("click", () => {
  state.loopDirection *= -1;
  updateTimeControls();
  paintLoopPhase();
  emitZoomDirectionPreview();
  announce("Zoom direction reversed.");
});

function beginManualAudition(event) {
  if (event?.isTrusted !== true || !state.audioOn) return false;
  if (!manualAudition) manualAuditionMoved = false;
  manualAudition = true;
  updateSummaries();
  scheduleFrame();
  return true;
}

function beginMidiPreviewAudition(event) {
  if (event?.isTrusted !== true) return false;
  if (!midiPreviewAudition) midiPreviewAuditionMoved = false;
  midiPreviewAudition = true;
  scheduleFrame();
  return true;
}

function endManualAudition() {
  if (!manualAudition) return;
  manualAudition = false;
  manualAuditionMoved = false;
  updateSummaries();
  scheduleFrame();
}

function endMidiPreviewAudition() {
  if (!midiPreviewAudition) return;
  midiPreviewAudition = false;
  midiPreviewAuditionMoved = false;
  scheduleFrame();
}

function endAuditions() {
  endManualAudition();
  endMidiPreviewAudition();
}

function bindManualAuditionLifecycle(input) {
  input.addEventListener("pointerdown", (event) => {
    const audioAudition = beginManualAudition(event);
    const previewAudition = beginMidiPreviewAudition(event);
    if (audioAudition || previewAudition) input.setPointerCapture?.(event.pointerId);
  });
  input.addEventListener("pointerup", endAuditions);
  input.addEventListener("pointercancel", endAuditions);
  input.addEventListener("lostpointercapture", endAuditions);
  input.addEventListener("keydown", (event) => {
    if (MANUAL_AUDITION_KEYS.has(event.key)) {
      beginManualAudition(event);
      beginMidiPreviewAudition(event);
    }
  });
  input.addEventListener("keyup", (event) => {
    if (MANUAL_AUDITION_KEYS.has(event.key)) endAuditions();
  });
  input.addEventListener("change", endAuditions);
  input.addEventListener("blur", endAuditions);
}

function setPosition(value, { suppress = true, audition = false } = {}) {
  const nextPosition = clamp(value);
  const moved = Math.abs(nextPosition - state.position) > 1e-9;
  state.continuousPosition = state.motionMode === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(
      state.continuousPosition,
      wrap01(state.continuousPosition),
      nextPosition,
    );
  state.position = nextPosition;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  if (audition && moved) {
    manualAuditionMoved = true;
    clearStrikeSuppression();
  }
  else if (suppress) suppressContactStrikes();
  if (midiPreviewAudition && moved) {
    midiPreviewAuditionMoved = true;
    clearMidiPreviewSuppression();
  } else if (suppress) {
    suppressMidiPreviewNotes();
  }
  emitReaderPhasePreview();
  scheduleFrame();
}

$("position").addEventListener("input", (event) => {
  const audition = beginManualAudition(event);
  beginMidiPreviewAudition(event);
  setPosition($("position").value, { audition });
});

for (const input of [$("position"), $("loopPhase")]) {
  bindManualAuditionLifecycle(input);
}

function paintPlayback() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    state.playing ? "Pause spiral time" : "Play spiral time",
  );
  setPressed($("loopPlayButton"), state.loopPlaying);
  $("loopPlayButton").setAttribute(
    "aria-label",
    state.loopPlaying ? "Pause tessellation loop" : "Play tessellation loop",
  );
  updateSummaries();
}

function setPlaying(playing) {
  endAuditions();
  state.playing = Boolean(playing);
  lastFrameTime = performance.now();
  previousContactKeys.clear();
  clearStrikeSuppression();
  paintPlayback();
  emitReaderTransportPreview();
  emitReaderTimebasePreview();
  scheduleFrame();
}

function setLoopPlaying(playing) {
  endAuditions();
  state.loopPlaying = Boolean(playing);
  lastFrameTime = performance.now();
  previousContactKeys.clear();
  clearStrikeSuppression();
  paintPlayback();
  emitZoomTransportPreview();
  emitZoomTimebasePreview();
  scheduleFrame();
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Spiral drums audio off.");
  } else if (await enableAudio()) {
    announce("Spiral drums audio on.");
  }
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  setPlaying(!state.playing);
});

$("loopPlayButton").addEventListener("click", () => {
  setLoopPlaying(!state.loopPlaying);
});

$("sizeCoupling").addEventListener("click", () => {
  if (state.timePath === "radius" && (geometryDirty || !tessellation)) rebuildGeometry();
  const radialAnchor = state.timePath === "radius"
    ? createSpiralReader({
      ...tessellation.bounds,
      mode: "radius",
      phase: state.position,
      sizeCoupled: state.sizeCoupling,
    }).points[0]
    : null;
  state.sizeCoupling = !state.sizeCoupling;
  if (radialAnchor) {
    setPosition(phaseForSpiralPoint(radialAnchor, {
      ...tessellation.bounds,
      mode: "radius",
      sizeCoupled: state.sizeCoupling,
    }));
  }
  previousContactKeys.clear();
  suppressContactStrikes();
  updateTimeControls();
  scheduleFrame();
  announce(`Shape size ${state.sizeCoupling ? "now" : "no longer"} affects reader time.`);
});

function populateMappingModes() {
  $("mappingMode").innerHTML = SPIRAL_DRUM_MAPPING_MODES
    .map((mode) => `<option value="${mode.id}">${mode.label}</option>`)
    .join("");
  $("mappingMode").value = state.mappingMode;
}

function renderDrumMap() {
  $("drumMap").innerHTML = voices.map((voice, index) => [
    `<span class="spiral-drum-cell" data-voice-index="${index}"`,
    ` style="--voice-color:${voice.color}">`,
    `<b>${voice.name}</b><small>${voice.key.toUpperCase()}</small></span>`,
  ].join("")).join("");
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  clearTimeout(Number(cell.dataset.clearTimer) || 0);
  const timer = setTimeout(() => cell.classList.remove("is-active"), 150);
  cell.dataset.clearTimer = String(timer);
}

$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  previousContactKeys.clear();
  suppressContactStrikes(80);
  updateSummaries();
  scheduleFrame();
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  worldScale = Math.min(cssWidth, cssHeight) * .455;
  tileEditorDirty = true;
  scheduleFrame();
}

function rebuildGeometry() {
  tessellation = buildSpiralTessellation({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
    spiralA: state.spiralA,
    spiralB: state.spiralB,
    logOffset: state.patternScale,
    angleOffset: state.patternRotation * Math.PI / 180,
    loopPhase: state.loopPhase,
  });
  state.parameters = [...tessellation.parameters];
  state.edgeCurves = [...tessellation.edgeCurves];
  geometryDirty = false;
}

function screenPoint(point) {
  return {
    x: cssWidth / 2 + point.x * worldScale,
    y: cssHeight / 2 - point.y * worldScale,
  };
}

function traceWorldPoints(points, close = false) {
  if (!points.length) return;
  const first = screenPoint(points[0]);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = screenPoint(points[index]);
    context.lineTo(point.x, point.y);
  }
  if (close) context.closePath();
}

function drumMappingOptions(contactCount = 1) {
  return {
    mode: state.mappingMode,
    bounds: tessellation?.bounds,
    contactCount,
  };
}

function drawScene(reader, contacts) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  for (const tile of tessellation.tiles) {
    traceWorldPoints(tile.points, true);
    context.fillStyle = TILE_COLORS[tile.color % TILE_COLORS.length];
    context.fill();
  }
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const edge of tessellation.edges) {
    traceWorldPoints(edge.points);
    context.strokeStyle = "rgba(214,232,226,.22)";
    context.lineWidth = .75;
    context.stroke();
  }
  const center = screenPoint({ x: 0, y: 0 });
  context.beginPath();
  context.arc(center.x, center.y, tessellation.bounds.innerRadius * worldScale, 0, TAU);
  context.fillStyle = "rgba(7,9,11,.86)";
  context.fill();
  context.strokeStyle = "rgba(255,130,111,.45)";
  context.lineWidth = 1;
  context.stroke();

  traceWorldPoints(reader.points);
  context.strokeStyle = "rgba(255,196,107,.92)";
  context.lineWidth = 1.8;
  context.shadowColor = "rgba(255,130,111,.35)";
  context.shadowBlur = 9;
  context.stroke();
  context.shadowBlur = 0;

  for (const contact of contacts) {
    const point = screenPoint(contact);
    const voiceIndex = spiralDrumVoiceIndex(
      contact,
      drumMappingOptions(contacts.length),
    );
    context.beginPath();
    context.arc(point.x, point.y, 3.2, 0, TAU);
    context.fillStyle = voices[voiceIndex].color;
    context.fill();
    context.strokeStyle = "#fff3d6";
    context.lineWidth = .6;
    context.stroke();
  }
}

function updateMappingReadout(contact, voice) {
  const normalized = normalizedSpiralContact(contact, tessellation.bounds);
  $("mappingReadout").textContent = [
    `${Math.round(normalized.radius01 * 100)}% SCALE`,
    `${Math.round(normalized.angle01 * 360)}°`,
    `→ ${voice.name}`,
    `${Math.round(voice.frequency)} HZ`,
  ].join(" · ");
}

function emitMidiPreviewNotes(contacts, now, suppressed) {
  const currentKeys = new Set(contacts.map(({ voiceKey }) => voiceKey));
  const moving = state.playing
    || state.loopPlaying
    || (midiPreviewAudition && midiPreviewAuditionMoved);
  if (!moving || suppressed) {
    midiPreviewContactKeys = currentKeys;
    return;
  }

  const onsets = contacts.filter((contact) => !midiPreviewContactKeys.has(contact.voiceKey));
  midiPreviewContactKeys = currentKeys;
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const voiceIndex = spiralDrumVoiceIndex(
      contact,
      drumMappingOptions(contacts.length),
    );
    const lastStrike = midiPreviewLastStrikeTimes.get(voiceIndex)
      ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < MIDI_PREVIEW_REENTRY_MS) continue;
    midiPreviewLastStrikeTimes.set(voiceIndex, now);
    const voice = mappedSpiralDrumVoice(voices[voiceIndex], contact, {
      bounds: tessellation.bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    emitMidiOutputPreview({
      kind: "note",
      routeId: MIDI_PREVIEW_ROUTE_ID,
      source: "Spiral drum crossing",
      sourceId: "spiral-drums-crossing",
      voiceId: contact.voiceKey,
      channel: 10,
      note: FM_DRUM_MIDI_FIRST_NOTE + voiceIndex,
      velocity: Math.max(1, Math.round(clamp(voice.level) * 127)),
      durationMs: Math.max(1, Math.round((voice.attack + voice.decay) * 1000)),
    });
    emitted += 1;
  }
}

function triggerContacts(contacts, now, suppressed) {
  if (
    !state.audioOn
    || (
      !state.playing
      && !state.loopPlaying
      && !(manualAudition && manualAuditionMoved)
    )
    || suppressed
  ) return;
  const onsets = contacts.filter((contact) => !previousContactKeys.has(contact.voiceKey));
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const voiceIndex = spiralDrumVoiceIndex(
      contact,
      drumMappingOptions(contacts.length),
    );
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 75) continue;
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedSpiralDrumVoice(voices[voiceIndex], contact, {
      bounds: tessellation.bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    updateMappingReadout(contact, voice);
    emitted += 1;
  }
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(.1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * delta;
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }
  if (state.loopPlaying) {
    state.continuousLoopPhase += state.loopDirection * state.loopSpeed * delta;
    state.loopPhase = wrap01(state.continuousLoopPhase);
    // Animated zoom is musical motion, not a manual edit: keep onsets enabled.
    geometryDirty = true;
  }
  if (geometryDirty || !tessellation) rebuildGeometry();
  const reader = createSpiralReader({
    ...tessellation.bounds,
    mode: state.timePath,
    phase: state.position,
    turns: state.readerTurns,
    sizeCoupled: state.sizeCoupling,
  });
  const contacts = contactsForSpiralReader(tessellation, reader);
  const suppressed = suppressStrikeFrames > 0 || now < suppressStrikesUntil;
  const midiPreviewSuppressed = suppressMidiPreviewFrames > 0
    || now < suppressMidiPreviewUntil;
  emitMidiPreviewNotes(contacts, now, midiPreviewSuppressed);
  triggerContacts(contacts, now, suppressed);
  previousContactKeys = new Set(contacts.map(({ voiceKey }) => voiceKey));
  if (suppressStrikeFrames > 0) suppressStrikeFrames -= 1;
  if (suppressMidiPreviewFrames > 0) suppressMidiPreviewFrames -= 1;
  drawScene(reader, contacts);
  if (tileEditorDirty) drawTileEditor();
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  emitReaderPhasePreview();
  $("loopPhase").value = String(state.loopPhase);
  paintLoopPhase();
  emitZoomPhasePreview();
  const motion = [
    state.playing ? "TIME" : "",
    state.loopPlaying ? "LOOP" : "",
    manualAudition ? "SCRUB" : "",
  ].filter(Boolean).join(" + ") || "PAUSED";
  $("stageReadout").textContent = [
    state.timePath.toUpperCase(),
    `${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")}`,
    motion,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  flushMidiPreviewSignals(now);
  if (
    state.playing
    || state.loopPlaying
    || manualAudition
    || midiPreviewAudition
    || pendingMidiPreviewSignals.size > 0
  ) scheduleFrame();
}

function canvasWorldPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width);
  const y = (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height);
  return {
    x: (x - cssWidth / 2) / worldScale,
    y: (cssHeight / 2 - y) / worldScale,
  };
}

function scrubFromPointer(event) {
  if (geometryDirty || !tessellation) rebuildGeometry();
  const phase = phaseForSpiralPoint(canvasWorldPoint(event), {
    ...tessellation.bounds,
    mode: state.timePath,
    turns: state.readerTurns,
    sizeCoupled: state.sizeCoupling,
  });
  setPosition(phase, { audition: manualAudition });
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDrag = event.pointerId;
  stageWrap.classList.add("is-scrubbing");
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
  beginManualAudition(event);
  beginMidiPreviewAudition(event);
  scrubFromPointer(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (pointerDrag !== event.pointerId) return;
  scrubFromPointer(event);
});

function finishStagePointer(event) {
  if (pointerDrag !== event.pointerId) return;
  cancelStagePointer();
}

function cancelStagePointer() {
  pointerDrag = null;
  stageWrap.classList.remove("is-scrubbing");
  endAuditions();
}

canvas.addEventListener("pointerup", finishStagePointer);
canvas.addEventListener("pointercancel", finishStagePointer);
canvas.addEventListener("lostpointercapture", finishStagePointer);
canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    const audition = beginManualAudition(event);
    beginMidiPreviewAudition(event);
    setPosition(state.position - (event.shiftKey ? .05 : .01), { audition });
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    const audition = beginManualAudition(event);
    beginMidiPreviewAudition(event);
    setPosition(state.position + (event.shiftKey ? .05 : .01), { audition });
  }
});
canvas.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") endAuditions();
});
canvas.addEventListener("blur", endAuditions);

function reset() {
  Object.assign(state, defaults, {
    parameters: [...tilingInfo(DEFAULT_TILING_TYPE).defaultParameters],
    edgeCurves: tilingInfo(DEFAULT_TILING_TYPE).edgeShapes.map(() => 0),
    continuousPosition: defaults.position,
    continuousLoopPhase: defaults.loopPhase,
    playing: false,
    loopPlaying: false,
  });
  tilingSelect.value = String(state.tilingType);
  for (const key of [
    "speed",
    "loopSpeed",
    "readerTurns",
    "output",
    "pitchDepth",
    "characterDepth",
    "strikeLimit",
    "spiralA",
    "spiralB",
    "patternScale",
    "patternRotation",
  ]) {
    $(key).value = String(state[key]);
  }
  $("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
  $("loopSpeedOut").textContent = `${state.loopSpeed.toFixed(3)} cyc/s`;
  $("readerTurnsOut").textContent = `${state.readerTurns.toFixed(2)} turns`;
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
  $("strikeLimitOut").textContent = String(state.strikeLimit);
  $("spiralAOut").textContent = String(state.spiralA);
  $("spiralBOut").textContent = String(state.spiralB);
  $("patternScaleOut").textContent = "+0.00";
  $("patternRotationOut").textContent = "0°";
  $("mappingMode").value = state.mappingMode;
  setPosition(state.position, { suppress: false });
  state.loopPhase = defaults.loopPhase;
  state.continuousLoopPhase = defaults.loopPhase;
  $("loopPhase").value = String(state.loopPhase);
  paintLoopPhase();
  configureTilingControls();
  updateTimeControls();
  paintPlayback();
  previousContactKeys.clear();
  lastStrikeTimes.clear();
  midiPreviewContactKeys.clear();
  midiPreviewLastStrikeTimes.clear();
  if (state.audioOn) audio.setOutput(state.output);
  invalidateGeometry();
  emitReaderPhasePreview();
  emitZoomPhasePreview();
  emitReaderPathPreview();
  emitReaderModePreview();
  emitReaderDirectionPreview();
  emitZoomDirectionPreview();
  emitReaderTimebasePreview();
  emitZoomTimebasePreview();
  emitReaderTransportPreview();
  emitZoomTransportPreview();
  announce("Spiral Drum Machine reset.");
}

$("resetSpiralDrums").addEventListener("click", reset);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelStagePointer();
    setAudioState(false);
  }
  else scheduleFrame();
});

window.addEventListener("pageshow", scheduleFrame);
window.addEventListener("blur", cancelStagePointer);
window.addEventListener("pagehide", () => {
  cancelStagePointer();
  if (audio.context && audio.context.state !== "closed") void audio.context.close();
});

populateMappingModes();
renderDrumMap();
configureTilingControls();
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();
reset();
