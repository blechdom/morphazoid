import {
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  normalizeStrikeGains,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  TILING_TYPES,
  buildPrototile,
  constrainPrototileEdit,
  edgeShapeName,
  evenlySelectContacts,
  parametersForDraggedVertex,
  tilingInfo,
  tilingParameterRange,
} from "./src/lattice.js";
import {
  angleShapePitchForSpiralContact,
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
  phaseForSpiralPoint,
  scaleRateForSpiralRadius,
  shapePitchForSpiralContact,
  spiralLoopLogOffset,
} from "./src/spiral.js";
import { EdgeShape } from "./vendor/tactile/tactile.js";
import { createAmplitudeControl } from "./src/amplitude-control.js";
import {
  pingPongMotionDirection,
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import { emitMidiOutputPreview } from "./src/midi-output-preview.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_VOICES = 16;
const MAX_PARAMETERS = 6;
const MAX_EDGE_CLASSES = 5;
const DEFAULT_TILING_TYPE = 20;
const CONTACT_REENTRY_GRACE_SECONDS = 0.08;
const GEOMETRY_EDIT_SETTLE_MS = 180;
const OPEN_ENVELOPE_GAIN = 0.00001;
const MIDI_PREVIEW_ROUTE_ID = "spiral";
const MIDI_PREVIEW_GATE_MS = 90;
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
const SOUND_LABELS = {
  sine: "Sine",
  percussion: "Percussion",
  shepard: "Shepard",
  fm: "FM",
  pm: "PM",
};

const defaultInfo = tilingInfo(DEFAULT_TILING_TYPE);
const state = {
  tilingType: DEFAULT_TILING_TYPE,
  parameters: [...defaultInfo.defaultParameters],
  edgeCurves: defaultInfo.edgeShapes.map(() => 0),
  spiralA: 1,
  spiralB: 5,
  patternScale: 0,
  patternRotation: 0,
  timePath: "radius",
  position: 0,
  continuousPosition: 0,
  loopPhase: 0,
  continuousLoopPhase: 0,
  speed: 0.12,
  traversalDirection: 1,
  motionMode: "loop",
  loopSpeed: 0.05,
  loopDirection: 1,
  readerTurns: 2,
  playing: false,
  loopPlaying: false,
  audio: false,
  level: 0.65,
  soundMode: "sine",
  baseFrequency: 110,
  pitchRange: 3.5,
  contactLevel: 0.38,
  percussionAttack: 3,
  percussionDecay: 180,
  voiceCap: 8,
  stereoWidth: 0.8,
  pitchSource: "angleShape",
  sizeCoupling: false,
};

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const tileEditorCanvas = $("tileEditorCanvas");
const tileEditorContext = tileEditorCanvas.getContext("2d");
const pool = new VoicePool(MAX_VOICES);
const amplitudeControl = createAmplitudeControl($("amplitudeControl"), {
  timing: "milliseconds",
  onChange() {
    suppressContactOnsets();
    scheduleFrame();
  },
});

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
let audioChanging = false;
const contactOnsets = new Map();
const contactLastSeen = new Map();
let midiPreviewContactKeys = new Set();
const midiPreviewLastNoteTimes = new Map();
const midiPreviewControlValues = new Map();
const pendingMidiPreviewSignals = new Map();
let lastMidiPreviewFlushTime = Number.NEGATIVE_INFINITY;
const movableVertexCache = new Map();
let suppressContactOnsetsUntil = 0;
let suppressContactOnsetFrames = 0;
let suppressMidiPreviewUntil = 0;
let suppressMidiPreviewFrames = 2;
let geometryWasEditing = false;
let manualAudition = false;
let manualAuditionMoved = false;
let midiPreviewAudition = false;
let midiPreviewAuditionMoved = false;

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pingPong01(value) {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function midiNoteForFrequency(frequency) {
  const note = 69 + 12 * Math.log2(Math.max(1e-9, frequency) / 440);
  return Math.round(clamp(note, 0, 127));
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
    sourceId: "spiral-reader-phase",
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
    sourceId: "spiral-zoom-phase",
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
    sourceId: "spiral-reader-path",
    rawValue: pathIndex,
    min: 0,
    max: paths.length - 1,
    displayValue: state.timePath[0].toUpperCase() + state.timePath.slice(1),
  });
}

function emitReaderModePreview() {
  emitMidiPreviewControl({
    source: "Reader motion",
    sourceId: "spiral-reader-mode",
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
    sourceId: "spiral-reader-direction",
    rawValue: state.traversalDirection,
    min: -1,
    max: 1,
    displayValue,
  });
}

function emitZoomDirectionPreview() {
  emitMidiPreviewControl({
    source: "Zoom direction",
    sourceId: "spiral-zoom-direction",
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
    sourceId: "spiral-reader-timebase",
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
    sourceId: "spiral-zoom-timebase",
    rate: state.loopSpeed,
    unit: "cycles/s",
    running: state.loopPlaying,
    displayValue: `${state.loopSpeed.toFixed(3)} cyc/s`,
  });
}

function emitReaderTransportPreview() {
  publishMidiPreview({
    kind: "transport",
    source: "Spiral reader",
    sourceId: "spiral-reader-transport",
    state: state.playing ? "start" : "stop",
    position: state.position,
  });
}

function emitZoomTransportPreview() {
  publishMidiPreview({
    kind: "transport",
    source: "Spiral zoom",
    sourceId: "spiral-zoom-transport",
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

function resetContactTracking() {
  contactOnsets.clear();
  contactLastSeen.clear();
}

function suppressContactOnsets(duration = GEOMETRY_EDIT_SETTLE_MS) {
  const interactionTime = Math.max(performance.now(), lastFrameTime);
  suppressContactOnsetsUntil = Math.max(
    suppressContactOnsetsUntil,
    interactionTime + duration,
  );
  suppressContactOnsetFrames = Math.max(suppressContactOnsetFrames, 2);
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

function clearContactOnsetSuppression() {
  suppressContactOnsetsUntil = 0;
  suppressContactOnsetFrames = 0;
  geometryWasEditing = false;
}

function releaseSettledContactOnsets() {
  const openVoiceKeys = new Set(pool.pendingVoices
    .filter((voice) => voice.gain > OPEN_ENVELOPE_GAIN)
    .map((voice) => voice.key));
  for (const key of contactOnsets.keys()) {
    if (openVoiceKeys.has(`spiral:${key}`)) continue;
    contactOnsets.delete(key);
    contactLastSeen.delete(key);
  }
}

function invalidateGeometry() {
  geometryDirty = true;
  tileEditorDirty = true;
  suppressContactOnsets();
  suppressMidiPreviewNotes();
  scheduleFrame();
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
bindRange("readerTurns", "readerTurns", (value) => `${value.toFixed(2)} turns`, () => {
  suppressContactOnsets();
  suppressMidiPreviewNotes();
});
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("contactLevel", "contactLevel", (value) => `${Math.round(value * 100)}%`);
bindRange("percussionAttack", "percussionAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("percussionDecay", "percussionDecay", (value) => `${Math.round(value)} ms`);
bindRange(
  "voiceCap",
  "voiceCap",
  (value) => `${Math.round(value)} ${plural(Math.round(value), "voice")}`,
  () => {
    suppressContactOnsets();
    suppressMidiPreviewNotes();
  },
);
bindRange("stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`);
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
bindRange("patternScale", "patternScale", (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`, invalidateGeometry);
bindRange("patternRotation", "patternRotation", (value) => `${Math.round(value)}°`, invalidateGeometry);

function setLoopPhase(value, { audition = false } = {}) {
  const nextLoopPhase = clamp(Number(value) || 0, 0, 1);
  const moved = Math.abs(nextLoopPhase - state.loopPhase) > 1e-9;
  state.loopPhase = nextLoopPhase;
  state.continuousLoopPhase = state.loopPhase;
  $("loopPhase").value = String(state.loopPhase);
  paintLoopPhase();
  geometryDirty = true;
  if (audition && moved) {
    manualAuditionMoved = true;
    clearContactOnsetSuppression();
  }
  else suppressContactOnsets();
  if (midiPreviewAudition && moved) {
    midiPreviewAuditionMoved = true;
    clearMidiPreviewSuppression();
  } else {
    suppressMidiPreviewNotes();
  }
  emitZoomPhasePreview();
  scheduleFrame();
}

$("loopPhase").addEventListener("input", (event) => {
  const audition = beginManualAudition(event);
  beginMidiPreviewAudition(event);
  setLoopPhase($("loopPhase").value, { audition });
});

function paintLoopPhase() {
  const offset = spiralLoopLogOffset(state.loopPhase);
  const phaseDirection = state.loopPhase < 0.5 ? 1 : -1;
  const zoomingIn = phaseDirection * state.loopDirection > 0;
  $("loopPhaseOut").textContent = `${offset.toFixed(2)} · ${zoomingIn ? "IN" : "OUT"}`;
}

function formatBend(value, rigid = false) {
  if (rigid) return "fixed straight";
  if (Math.abs(value) < 0.005) return "straight";
  return `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "reverse" : "forward"}`;
}

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
  $("parameterCount").textContent = `${info.defaultParameters.length} ${plural(info.defaultParameters.length, "parameter")} · guarded`;
  for (let index = 0; index < MAX_PARAMETERS; index += 1) {
    const visible = index < info.defaultParameters.length;
    const wrapper = $(`parameterControl${index}`);
    wrapper.hidden = !visible;
    if (!visible) continue;
    const range = tilingParameterRange(info.type, index);
    const input = $(`parameter${index}`);
    input.min = String(range.min);
    input.max = String(range.max);
    $("parameterLabel" + index).textContent = `Shape ${index + 1}`;
    paintParameterControl(index);
  }
  const bendableCount = info.edgeShapes.filter((shape) => shape !== EdgeShape.I).length;
  $("edgeCount").textContent = `${bendableCount} bendable ${plural(bendableCount, "class", "classes")}`;
  for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
    const exists = index < info.edgeShapes.length;
    const wrapper = $(`edgeControl${index}`);
    if (!exists) {
      wrapper.hidden = true;
      continue;
    }
    const shape = info.edgeShapes[index];
    const rigid = shape === EdgeShape.I;
    wrapper.hidden = rigid;
    $(`edgeCurve${index}`).disabled = rigid;
    $(`edgeLabel${index}`).textContent = `Edge ${String.fromCharCode(65 + index)} · ${edgeShapeName(shape)}`;
    paintEdgeControl(index);
  }
  const editable = info.defaultParameters.length > 0;
  $("resetTileVertices").disabled = !editable;
  tileEditorCanvas.setAttribute("aria-disabled", String(!editable));
  $("tileEditorLegend").textContent = editable ? "movable corner" : "symmetry-locked corners";
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
      target: { x: vertex.x + 0.025, y: vertex.y },
    });
    const vertical = parametersForDraggedVertex({
      type: model.type,
      parameters: model.parameters,
      vertexIndex,
      target: { x: vertex.x, y: vertex.y + 0.025 },
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
  tileEditorCanvas.width = Math.round(width * ratio);
  tileEditorCanvas.height = Math.round(height * ratio);
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
        (width - 54) / Math.max(model.bounds.maxX - model.bounds.minX, 0.2),
        (height - 54) / Math.max(model.bounds.maxY - model.bounds.minY, 0.2),
      ),
    };
  traceEditorPoints(model.outline, view, true);
  tileEditorContext.fillStyle = "rgba(255,130,111,.12)";
  tileEditorContext.fill();
  tileEditorContext.strokeStyle = "rgba(214,232,226,.72)";
  tileEditorContext.lineWidth = 1.2;
  tileEditorContext.lineJoin = "round";
  tileEditorContext.stroke();
  const movable = movableVerticesFor(model);
  model.vertices.forEach((vertex, index) => {
    const point = editorScreenPoint(vertex, view);
    tileEditorContext.beginPath();
    tileEditorContext.arc(point.x, point.y, movable[index] ? 6 : 3.5, 0, TAU);
    tileEditorContext.fillStyle = movable[index] ? "#ff826f" : "rgba(214,232,226,.38)";
    tileEditorContext.fill();
    if (movable[index]) {
      tileEditorContext.strokeStyle = "#fff3d6";
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
  if (nearest < 0) return;
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
  announce(constrained ? "Overlap guard limited the vertex edit." : "Spiral tile updated.");
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

tilingSelect.addEventListener("change", () => setTilingType(Number(tilingSelect.value)));

$("resetTileVertices").addEventListener("click", () => {
  state.parameters = [...tilingInfo(state.tilingType).defaultParameters];
  state.parameters.forEach((_, index) => paintParameterControl(index));
  invalidateGeometry();
});

$("straightenEdges").addEventListener("click", () => {
  state.edgeCurves = tilingInfo(state.tilingType).edgeShapes.map(() => 0);
  state.edgeCurves.forEach((_, index) => paintEdgeControl(index));
  invalidateGeometry();
});

$("resetForm").addEventListener("click", () => setTilingType(DEFAULT_TILING_TYPE, false));

$("resetWinding").addEventListener("click", () => {
  Object.assign(state, { spiralA: 1, spiralB: 5, patternScale: 0, patternRotation: 0 });
  for (const key of ["spiralA", "spiralB", "patternScale", "patternRotation"]) {
    $(key).value = String(state[key]);
  }
  $("spiralAOut").textContent = "1";
  $("spiralBOut").textContent = "5";
  $("patternScaleOut").textContent = "+0.00";
  $("patternRotationOut").textContent = "0°";
  updateSummaries();
  invalidateGeometry();
});

function directionLabel() {
  if (state.timePath === "radius") {
    return state.traversalDirection > 0 ? "Out → In" : "In → Out";
  }
  return state.traversalDirection > 0 ? "Clockwise" : "Counterclockwise";
}

function loopDirectionLabel() {
  return "Reverse zoom";
}

function coordinateLabel() {
  if (state.timePath === "radius") return state.sizeCoupling ? "R" : "LOG R";
  if (state.timePath === "angle") return "THETA";
  return "LOG R + THETA";
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
  $("loopDirection").textContent = loopDirectionLabel();
  $("coordinateReadout").textContent = `${coordinateLabel()} · ${state.motionMode === "pingpong" ? "PING-PONG · " : ""}${directionLabel().toUpperCase()}`;
  setPressed($("sizeCoupling"), state.sizeCoupling);
  $("sizeCoupling").textContent = `Size affects time + pitch · ${state.sizeCoupling ? "on" : "off"}`;
  $("sizeCoupling").setAttribute(
    "aria-label",
    `Size affects time and pitch ${state.sizeCoupling ? "on" : "off"}`,
  );
  updateMappingSummary();
  updateSummaries();
}

for (const button of $("timePath").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.timePath = button.dataset.value;
    resetContactTracking();
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
  if (event?.isTrusted !== true || !state.audio) return false;
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
  if (!state.playing && !state.loopPlaying) pool.setVoices([]);
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

function setPosition(value, { audition = false } = {}) {
  const nextPosition = clamp(Number(value) || 0, 0, 1);
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
    clearContactOnsetSuppression();
  }
  else suppressContactOnsets();
  if (midiPreviewAudition && moved) {
    midiPreviewAuditionMoved = true;
    clearMidiPreviewSuppression();
  } else {
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

for (const input of [
  $("position"),
  $("loopPhase"),
]) bindManualAuditionLifecycle(input);

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
  $("soundSummary").textContent = SOUND_LABELS[state.soundMode];
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
  resetContactTracking();
  clearContactOnsetSuppression();
  if (!state.playing && !state.loopPlaying) pool.setVoices([]);
  paintPlayback();
  emitReaderTransportPreview();
  emitReaderTimebasePreview();
  scheduleFrame();
}

function setLoopPlaying(playing) {
  endAuditions();
  state.loopPlaying = Boolean(playing);
  lastFrameTime = performance.now();
  resetContactTracking();
  clearContactOnsetSuppression();
  if (!state.playing && !state.loopPlaying) pool.setVoices([]);
  paintPlayback();
  emitZoomTransportPreview();
  emitZoomTimebasePreview();
  scheduleFrame();
}

function paintAudio() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

async function enableAudio() {
  if (state.audio || audioChanging) return;
  audioChanging = true;
  $("audioButton").disabled = true;
  paintAudio();
  $("audioError").hidden = true;
  try {
    await pool.enable();
    pool.setLevel(state.level);
    pool.setVoices([]);
    state.audio = true;
    paintAudio();
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
    paintAudio();
  } finally {
    audioChanging = false;
    $("audioButton").disabled = false;
  }
}

function disableAudio() {
  endManualAudition();
  state.audio = false;
  pool.disable();
  paintAudio();
}

$("audioButton").addEventListener("click", async () => {
  if (state.audio) disableAudio();
  else await enableAudio();
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  setPlaying(!state.playing);
});

$("loopPlayButton").addEventListener("click", () => {
  setLoopPlaying(!state.loopPlaying);
});

$("soundMode").addEventListener("change", () => {
  state.soundMode = $("soundMode").value;
  amplitudeControl.setVisible(state.soundMode !== "percussion");
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  pool.silence();
  resetContactTracking();
  clearContactOnsetSuppression();
  updateSummaries();
  scheduleFrame();
});

function updateMappingSummary() {
  const label = $("pitchSource").selectedOptions?.[0]?.textContent ?? state.pitchSource;
  $("mappingSummary").textContent = state.sizeCoupling
    ? `${label} + size → pitch/time`
    : `${label} → pitch`;
}

$("pitchSource").addEventListener("change", () => {
  state.pitchSource = $("pitchSource").value;
  updateMappingSummary();
  scheduleFrame();
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
  pool.silence();
  resetContactTracking();
  clearContactOnsetSuppression();
  updateTimeControls();
  scheduleFrame();
  announce(`Shape size ${state.sizeCoupling ? "now" : "no longer"} affects time and pitch.`);
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  worldScale = Math.min(cssWidth, cssHeight) * 0.455;
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

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

function drawScene(reader, contacts, voicedContacts) {
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
    context.lineWidth = 0.75;
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
  context.shadowColor = "rgba(255,184,107,.35)";
  context.shadowBlur = 9;
  context.stroke();
  context.shadowBlur = 0;

  const voicedKeys = new Set(voicedContacts.map((contact) => contact.voiceKey));
  for (const contact of contacts) {
    const point = screenPoint(contact);
    context.beginPath();
    context.arc(point.x, point.y, voicedKeys.has(contact.voiceKey) ? 3.8 : 2.2, 0, TAU);
    context.fillStyle = voicedKeys.has(contact.voiceKey) ? "#fff3d6" : "rgba(125,180,255,.72)";
    context.fill();
  }
}

function addContactEnvelopes(contacts, nowSeconds, suppressOnsets = false) {
  const active = new Set();
  const result = contacts.map((contact) => {
    active.add(contact.voiceKey);
    const tracked = contactOnsets.has(contact.voiceKey);
    const onset = !suppressOnsets && !tracked;
    if (onset) contactOnsets.set(contact.voiceKey, nowSeconds);
    if (tracked || onset) contactLastSeen.set(contact.voiceKey, nowSeconds);
    return {
      ...contact,
      onset,
      age: tracked
        ? Math.max(0, nowSeconds - contactOnsets.get(contact.voiceKey))
        : suppressOnsets ? Number.POSITIVE_INFINITY : 0,
    };
  });
  for (const key of contactOnsets.keys()) {
    if (active.has(key)) continue;
    if (nowSeconds - (contactLastSeen.get(key) ?? -Infinity) <= CONTACT_REENTRY_GRACE_SECONDS) continue;
    contactOnsets.delete(key);
    contactLastSeen.delete(key);
  }
  return result;
}

function pitchMark(contact) {
  if (state.pitchSource === "angleShape") return angleShapePitchForSpiralContact(contact);
  if (state.pitchSource === "shape") return shapePitchForSpiralContact(contact);
  if (state.pitchSource === "angle") return contact.angle01;
  if (state.pitchSource === "reader") return contact.along01;
  if (state.pitchSource === "orientation") return contact.orientation;
  return clamp(
    (tessellation.logOuter - Math.log(Math.max(tessellation.bounds.innerRadius, contact.radius)))
      / Math.max(1e-9, tessellation.logOuter - tessellation.logInner),
    0,
    1,
  );
}

function voiceData(contacts) {
  return contacts.map((contact) => {
    const pitch = pitchMark(contact);
    const sizeRate = state.sizeCoupling
      ? scaleRateForSpiralRadius(
        contact.radius,
        tessellation.bounds.innerRadius,
        tessellation.bounds.outerRadius,
      )
      : 1;
    const durationScale = 1 / sizeRate;
    const pitchScale = state.sizeCoupling
      ? (state.pitchSource === "radius" ? Math.sqrt(sizeRate) : sizeRate)
      : 1;
    const gain = state.contactLevel * 0.13
      * (0.25 + 0.75 * contact.incidence)
      * amplitudeControl.sampleAtTime(
        contact.age / durationScale,
        0.75,
      );
    const synth = synthParametersForMode(state.soundMode, contact.incidence, {
      fmIndex: 4,
      fmRatio: 2,
      pmIndex: 2.4,
      pmRatio: 1,
      shepardRate: state.playing
        ? state.speed
          * (state.motionMode === "pingpong"
            ? pingPongMotionDirection(
              state.continuousPosition,
              state.traversalDirection,
            )
            : state.traversalDirection)
          * sizeRate
        : state.loopPlaying ? state.loopSpeed * state.loopDirection * sizeRate : 0,
      shepardWidth: 4,
    });
    return {
      contact,
      frequency: pitch01ToFrequency(pitch, state.baseFrequency, state.pitchRange) * pitchScale,
      gain,
      pan: clamp(contact.x / tessellation.bounds.outerRadius, -1, 1) * state.stereoWidth,
      synth,
      sizeRate,
      durationScale,
    };
  });
}

function emitMidiPreviewNotes(data, now, suppressed) {
  const currentKeys = new Set(data.map(({ contact }) => contact.voiceKey));
  const moving = state.playing
    || state.loopPlaying
    || (midiPreviewAudition && midiPreviewAuditionMoved);
  if (!moving || suppressed) {
    midiPreviewContactKeys = currentKeys;
    return;
  }

  const onsets = data.filter(({ contact }) => !midiPreviewContactKeys.has(contact.voiceKey));
  midiPreviewContactKeys = currentKeys;
  for (const item of onsets) {
    const lastNoteTime = midiPreviewLastNoteTimes.get(item.contact.voiceKey)
      ?? Number.NEGATIVE_INFINITY;
    if (now - lastNoteTime < CONTACT_REENTRY_GRACE_SECONDS * 1000) continue;
    midiPreviewLastNoteTimes.set(item.contact.voiceKey, now);
    const incidenceGain = 0.25 + 0.75 * item.contact.incidence;
    const velocityGain = state.soundMode === "percussion"
      ? state.level * state.contactLevel * 0.55 * incidenceGain
      : state.level * state.contactLevel * incidenceGain;
    const durationMs = state.soundMode === "percussion"
      ? 1000 * (
        cornerAttackSeconds(state.percussionAttack * item.durationScale)
        + cornerDecaySeconds(state.percussionDecay * item.durationScale)
      )
      : MIDI_PREVIEW_GATE_MS;
    emitMidiOutputPreview({
      kind: "note",
      routeId: MIDI_PREVIEW_ROUTE_ID,
      source: "Spiral crossing",
      sourceId: "spiral-crossing",
      voiceId: item.contact.voiceKey,
      channel: 1,
      note: midiNoteForFrequency(item.frequency),
      frequencyHz: item.frequency,
      velocity: Math.max(1, Math.round(clamp(velocityGain, 0, 1) * 127)),
      durationMs: Math.max(1, Math.round(durationMs)),
    });
  }
}

function updateAudio(data, suppressVoiceStarts = false) {
  if (!state.audio) return;
  if (state.soundMode === "percussion") {
    pool.setVoices([]);
    if (!state.playing && !state.loopPlaying && !(manualAudition && manualAuditionMoved)) return;
    const strikeItems = data.filter((item) => item.contact.onset);
    const intents = strikeItems.map((item) => ({
      key: `spiral:strike:${item.contact.voiceKey}`,
      frequency: item.frequency,
      gain: state.contactLevel * 0.55 * (0.25 + 0.75 * item.contact.incidence),
      pan: item.pan,
      waveform: "sine",
    }));
    const normalized = normalizeStrikeGains(intents, pool.availableStrikeHeadroom(0.78));
    normalized.forEach((spec, index) => {
      const durationScale = strikeItems[index]?.durationScale ?? 1;
      pool.strike(spec, {
        attackSeconds: cornerAttackSeconds(state.percussionAttack * durationScale),
        decaySeconds: cornerDecaySeconds(state.percussionDecay * durationScale),
      });
    });
  } else if (state.playing || state.loopPlaying || (manualAudition && manualAuditionMoved)) {
    pool.setVoices(data.map((item) => ({
      key: `spiral:${item.contact.voiceKey}`,
      frequency: item.frequency,
      gain: item.gain,
      pan: item.pan,
      waveform: "sine",
      ...item.synth,
    })), { allowVoiceStarts: !suppressVoiceStarts });
  } else pool.setVoices([]);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
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
  const selected = evenlySelectContacts(contacts, state.voiceCap);
  const geometryEditing = suppressContactOnsetFrames > 0 || now < suppressContactOnsetsUntil;
  if (suppressContactOnsetFrames > 0) suppressContactOnsetFrames -= 1;
  if (!geometryEditing && geometryWasEditing) releaseSettledContactOnsets();
  geometryWasEditing = geometryEditing;
  const enveloped = addContactEnvelopes(selected, now / 1000, geometryEditing);
  const data = voiceData(enveloped);
  const midiPreviewSuppressed = suppressMidiPreviewFrames > 0
    || now < suppressMidiPreviewUntil;
  emitMidiPreviewNotes(data, now, midiPreviewSuppressed);
  if (suppressMidiPreviewFrames > 0) suppressMidiPreviewFrames -= 1;
  drawScene(reader, contacts, selected);
  if (tileEditorDirty) drawTileEditor();
  updateAudio(data, geometryEditing);
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
  const audioStatus = !state.audio
    ? "AUDIO OFF"
    : state.soundMode !== "percussion"
      && (state.playing || state.loopPlaying || (manualAudition && manualAuditionMoved))
      ? `${pool.pendingVoices.length} ${plural(pool.pendingVoices.length, "VOICE", "VOICES")}`
      : "AUDIO ON";
  $("stageReadout").textContent = `${state.timePath.toUpperCase()} · ${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")} · ${motion} · ${audioStatus}`;
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
  return { x: (x - cssWidth / 2) / worldScale, y: (cssHeight / 2 - y) / worldScale };
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
  beginManualAudition(event);
  beginMidiPreviewAudition(event);
  scrubFromPointer(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (pointerDrag !== event.pointerId) return;
  scrubFromPointer(event);
});
const endPointer = (event) => {
  if (pointerDrag !== event.pointerId) return;
  cancelStagePointer();
};
function cancelStagePointer() {
  pointerDrag = null;
  stageWrap.classList.remove("is-scrubbing");
  endAuditions();
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("lostpointercapture", endPointer);
canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    const audition = beginManualAudition(event);
    beginMidiPreviewAudition(event);
    setPosition(state.position - (event.shiftKey ? 0.05 : 0.01), { audition });
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    const audition = beginManualAudition(event);
    beginMidiPreviewAudition(event);
    setPosition(state.position + (event.shiftKey ? 0.05 : 0.01), { audition });
  }
});
canvas.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") endAuditions();
});
canvas.addEventListener("blur", endAuditions);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelStagePointer();
    pool.silence();
  }
  else scheduleFrame();
});
window.addEventListener("blur", cancelStagePointer);
window.addEventListener("pagehide", (event) => {
  cancelStagePointer();
  if (event.persisted) pool.disable();
  else void pool.close();
});

configureTilingControls();
setPosition(state.position);
setLoopPhase(state.loopPhase);
updateTimeControls();
paintPlayback();
paintAudio();
emitReaderPathPreview();
emitReaderModePreview();
emitReaderDirectionPreview();
emitZoomDirectionPreview();
emitReaderTimebasePreview();
emitZoomTimebasePreview();
emitReaderTransportPreview();
emitZoomTransportPreview();
scheduleFrame();
