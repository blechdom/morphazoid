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
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
  phaseForSpiralPoint,
  scaleRateForSpiralRadius,
} from "./src/spiral.js";
import { EdgeShape } from "./vendor/tactile/tactile.js";
import { createAmplitudeControl } from "./src/amplitude-control.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_VOICES = 16;
const MAX_PARAMETERS = 6;
const MAX_EDGE_CLASSES = 5;
const DEFAULT_TILING_TYPE = 20;
const CONTACT_REENTRY_GRACE_SECONDS = 0.08;
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
  direction: 1,
  loopSpeed: 0.12,
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
  intersectionDecay: 180,
  percussionAttack: 3,
  percussionDecay: 180,
  voiceCap: 8,
  stereoWidth: 0.8,
  pitchSource: "radius",
  sizeCoupling: false,
};

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const tileEditorCanvas = $("tileEditorCanvas");
const tileEditorContext = tileEditorCanvas.getContext("2d");
const pool = new VoicePool(MAX_VOICES);
const amplitudeControl = createAmplitudeControl($("amplitudeControl"), { onChange: scheduleFrame });

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
const movableVertexCache = new Map();

function wrap01(value) {
  return ((value % 1) + 1) % 1;
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

function resetContactTracking() {
  contactOnsets.clear();
  contactLastSeen.clear();
}

function invalidateGeometry() {
  geometryDirty = true;
  tileEditorDirty = true;
  resetContactTracking();
  if (state.audio) pool.setVoices([]);
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

bindRange("speed", "speed", (value) => `${value.toFixed(3)} cyc/s`);
bindRange("loopSpeed", "loopSpeed", (value) => `${value.toFixed(3)} cyc/s`);
bindRange("readerTurns", "readerTurns", (value) => `${value.toFixed(2)} turns`, resetContactTracking);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("contactLevel", "contactLevel", (value) => `${Math.round(value * 100)}%`);
bindRange("intersectionDecay", "intersectionDecay", (value) => `${Math.round(value)} ms`);
bindRange("percussionAttack", "percussionAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("percussionDecay", "percussionDecay", (value) => `${Math.round(value)} ms`);
bindRange("voiceCap", "voiceCap", (value) => `${Math.round(value)} ${plural(Math.round(value), "voice")}`);
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

function setLoopPhase(value) {
  state.loopPhase = clamp(Number(value) || 0, 0, 1);
  state.continuousLoopPhase = state.loopPhase;
  $("loopPhase").value = String(state.loopPhase);
  $("loopPhaseOut").textContent = `${(state.loopPhase * 100).toFixed(1)}%`;
  geometryDirty = true;
  resetContactTracking();
  scheduleFrame();
}

$("loopPhase").addEventListener("input", () => setLoopPhase($("loopPhase").value));

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
  if (state.timePath === "radius") return state.direction > 0 ? "Out → In" : "In → Out";
  return state.direction > 0 ? "Clockwise" : "Counterclockwise";
}

function loopDirectionLabel() {
  return state.loopDirection > 0 ? "Zoom out" : "Zoom in";
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
  $("timeDirection").textContent = directionLabel();
  $("loopDirection").textContent = loopDirectionLabel();
  $("coordinateReadout").textContent = `${coordinateLabel()} · ${directionLabel().toUpperCase()}`;
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
    updateTimeControls();
    announce(`${button.textContent} time selected.`);
    scheduleFrame();
  });
}

$("timeDirection").addEventListener("click", () => {
  state.direction *= -1;
  updateTimeControls();
  announce(`Time direction ${directionLabel()}.`);
});

$("loopDirection").addEventListener("click", () => {
  state.loopDirection *= -1;
  updateTimeControls();
  announce(`Loop direction ${loopDirectionLabel()}.`);
});

function setPosition(value) {
  state.position = clamp(Number(value) || 0, 0, 1);
  state.continuousPosition = state.position;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  resetContactTracking();
  scheduleFrame();
}

$("position").addEventListener("input", () => setPosition($("position").value));

function updateSummaries() {
  const timeName = state.timePath[0].toUpperCase() + state.timePath.slice(1);
  const active = [
    state.playing ? "time" : "",
    state.loopPlaying ? "loop" : "",
  ].filter(Boolean).join(" + ");
  $("playSummary").textContent = `${timeName} · ${active || "paused"}`;
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
  state.playing = Boolean(playing);
  lastFrameTime = performance.now();
  resetContactTracking();
  if (!state.playing && !state.loopPlaying) pool.setVoices([]);
  paintPlayback();
  scheduleFrame();
}

function setLoopPlaying(playing) {
  state.loopPlaying = Boolean(playing);
  lastFrameTime = performance.now();
  resetContactTracking();
  if (!state.playing && !state.loopPlaying) pool.setVoices([]);
  paintPlayback();
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
  state.audio = false;
  pool.disable();
  paintAudio();
}

$("audioButton").addEventListener("click", async () => {
  if (state.audio) disableAudio();
  else await enableAudio();
  scheduleFrame();
});

$("playButton").addEventListener("click", async () => {
  if (state.playing) setPlaying(false);
  else {
    if (!state.audio) await enableAudio();
    setPlaying(true);
  }
});

$("loopPlayButton").addEventListener("click", async () => {
  if (state.loopPlaying) setLoopPlaying(false);
  else {
    if (!state.audio) await enableAudio();
    setLoopPlaying(true);
  }
});

$("soundMode").addEventListener("change", () => {
  state.soundMode = $("soundMode").value;
  amplitudeControl.setVisible(state.soundMode !== "percussion");
  $("intersectionDecayControl").hidden = state.soundMode === "percussion";
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  pool.silence();
  resetContactTracking();
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

function addContactEnvelopes(contacts, nowSeconds) {
  const active = new Set();
  const result = contacts.map((contact) => {
    active.add(contact.voiceKey);
    const onset = !contactOnsets.has(contact.voiceKey);
    if (onset) contactOnsets.set(contact.voiceKey, nowSeconds);
    contactLastSeen.set(contact.voiceKey, nowSeconds);
    return {
      ...contact,
      onset,
      age: Math.max(0, nowSeconds - contactOnsets.get(contact.voiceKey)),
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
      * amplitudeControl.sample(
        clamp(contact.age / (state.intersectionDecay / 1000 * durationScale), 0, 1),
        0.75,
      );
    const synth = synthParametersForMode(state.soundMode, contact.incidence, {
      fmIndex: 4,
      fmRatio: 2,
      pmIndex: 2.4,
      pmRatio: 1,
      shepardRate: state.playing
        ? state.speed * state.direction * sizeRate
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

function updateAudio(data) {
  if (!state.audio) return;
  if (state.soundMode === "percussion") {
    pool.setVoices([]);
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
  } else if (state.playing || state.loopPlaying) {
    pool.setVoices(data.map((item) => ({
      key: `spiral:${item.contact.voiceKey}`,
      frequency: item.frequency,
      gain: item.gain,
      pan: item.pan,
      waveform: "sine",
      ...item.synth,
    })));
  } else pool.setVoices([]);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = wrap01(state.continuousPosition);
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
  const enveloped = addContactEnvelopes(selected, now / 1000);
  const data = voiceData(enveloped);
  drawScene(reader, contacts, selected);
  if (tileEditorDirty) drawTileEditor();
  updateAudio(data);
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  $("loopPhase").value = String(state.loopPhase);
  $("loopPhaseOut").textContent = `${(state.loopPhase * 100).toFixed(1)}%`;
  $("stageReadout").textContent = `${state.timePath.toUpperCase()} · ${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")} · ${state.audio ? `${data.length} ${plural(data.length, "VOICE", "VOICES")}` : "AUDIO OFF"}`;
  if (state.playing || state.loopPlaying) scheduleFrame();
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
  setPosition(phase);
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDrag = event.pointerId;
  stageWrap.classList.add("is-scrubbing");
  canvas.setPointerCapture(event.pointerId);
  scrubFromPointer(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (pointerDrag !== event.pointerId) return;
  scrubFromPointer(event);
});
const endPointer = (event) => {
  if (pointerDrag !== event.pointerId) return;
  pointerDrag = null;
  stageWrap.classList.remove("is-scrubbing");
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    setPosition(state.position - (event.shiftKey ? 0.05 : 0.01));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setPosition(state.position + (event.shiftKey ? 0.05 : 0.01));
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else scheduleFrame();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) pool.disable();
  else void pool.close();
});

configureTilingControls();
setPosition(state.position);
setLoopPhase(state.loopPhase);
updateTimeControls();
paintPlayback();
paintAudio();
scheduleFrame();
