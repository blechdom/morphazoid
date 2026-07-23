import {
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  mapCurve01,
  normalizeStrikeGains,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  TILING_TYPES,
  buildLattice,
  buildPrototile,
  centeredContactWindow,
  constrainPrototileEdit,
  contactsForLine,
  createScanLine,
  edgeShapeName,
  latticeOffsetForPhase,
  parametersForDraggedVertex,
  tilingInfo,
  tilingParameterRange,
} from "./src/lattice.js";
import { EdgeShape } from "./vendor/tactile/tactile.js";
import { createAmplitudeControl } from "./src/amplitude-control.js";

const $ = (id) => document.getElementById(id);
const SPEED_MIN = 0.01;
const SPEED_MAX = 4;
const MAX_VOICES = 16;
const MAX_PARAMETERS = 6;
const MAX_EDGE_CLASSES = 5;
const DEFAULT_TILING_TYPE = 20;
const DEFAULT_DENSITY = 0.52;
const MAX_DENSITY = 0.8;
const OPEN_TILE_SCALE = 0.46;
const DENSE_TILE_SCALE = 0.14;
const DEFAULT_TILE_SCALE = OPEN_TILE_SCALE
  + (DENSE_TILE_SCALE - OPEN_TILE_SCALE) * DEFAULT_DENSITY;
const MAX_TILES_PER_WORLD_AREA = 70;
const GEOMETRY_EDIT_SETTLE_MS = 180;
const CONTACT_REENTRY_GRACE_SECONDS = 0.08;
const STRIKE_BATCH_CEILING = 0.78;
const SOUND_MODE_LABELS = {
  sine: "Sine",
  percussion: "Percussion",
  shepard: "Shepard glissando",
  fm: "FM",
  pm: "PM",
};
const SOUND_MODES = new Set(Object.keys(SOUND_MODE_LABELS));
const TILE_COLORS = [
  "rgba(255, 184, 107, 0.070)",
  "rgba(125, 180, 255, 0.052)",
  "rgba(95, 232, 196, 0.042)",
  "rgba(255, 239, 196, 0.045)",
  "rgba(255, 132, 92, 0.040)",
];

const defaultInfo = tilingInfo(DEFAULT_TILING_TYPE);
const state = {
  tilingType: DEFAULT_TILING_TYPE,
  parameters: [...defaultInfo.defaultParameters],
  edgeCurves: defaultInfo.edgeShapes.map(() => 0),
  density: DEFAULT_DENSITY,
  scanMotion: "loop",
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.08,
  traversalDirection: -1,
  patternDirectionAngle: 0,
  angle: 90,
  playing: false,
  audio: false,
  level: 0.65,
  baseFrequency: 110,
  pitchRange: 3.5,
  contactLevel: 0.35,
  intersectionAccent: 0.75,
  intersectionDecay: 100,
  voiceCap: 8,
  soundMode: "sine",
  synthSource: "incidence",
  percussionAttack: 3,
  percussionDecay: 110,
  shepardCycles: 1,
  shepardDirection: 1,
  shepardWidth: 4,
  fmIndex: 3,
  fmRatio: 2,
  pmIndex: 2,
  pmRatio: 1,
  pitchSource: "height",
  pitchCurve: "linear",
  levelSource: "incidence",
  levelCurve: "linear",
  stereoWidth: 1,
};

state.level = clamp(state.level, 0, 1);
state.baseFrequency = clamp(state.baseFrequency, 20, 440);
state.pitchRange = clamp(state.pitchRange, 0, 6);
state.contactLevel = clamp(state.contactLevel, 0, 1);
state.intersectionAccent = clamp(state.intersectionAccent, 0, 1);
state.intersectionDecay = clamp(state.intersectionDecay, 20, 2000);
state.voiceCap = Math.round(clamp(state.voiceCap, 1, MAX_VOICES));
state.patternDirectionAngle = clamp(state.patternDirectionAngle, 0, 90);
state.soundMode = SOUND_MODES.has(state.soundMode) ? state.soundMode : "sine";
state.synthSource = ["height", "along", "incidence", "orientation"].includes(state.synthSource)
  ? state.synthSource
  : "incidence";
state.percussionAttack = clamp(state.percussionAttack, 0.5, 30);
state.percussionDecay = clamp(state.percussionDecay, 15, 2000);
state.shepardCycles = clamp(state.shepardCycles, 0.25, 4);
state.shepardDirection = state.shepardDirection < 0 ? -1 : 1;
state.shepardWidth = clamp(state.shepardWidth, 1, 8);
state.fmIndex = clamp(state.fmIndex, 0, 12);
state.fmRatio = clamp(state.fmRatio, 0.25, 8);
state.pmIndex = clamp(state.pmIndex, 0, 8);
state.pmRatio = clamp(state.pmRatio, 0.25, 8);
state.stereoWidth = clamp(state.stereoWidth, 0, 1);
if (!['height', 'along', 'incidence', 'orientation'].includes(state.pitchSource)) {
  state.pitchSource = "height";
}
if (!['fixed', 'incidence', 'center', 'orientation'].includes(state.levelSource)) {
  state.levelSource = "incidence";
}
const curveNames = ["linear", "exponential", "logarithmic", "smooth", "inverted"];
if (!curveNames.includes(state.pitchCurve)) state.pitchCurve = "linear";
if (!curveNames.includes(state.levelCurve)) state.levelCurve = "linear";

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
let viewBounds = { minX: -1.5, minY: -1, maxX: 1.5, maxY: 1 };
let lattice = null;
let geometryDirty = true;
let tileEditorDirty = true;
let pointerDrag = null;
let tileEditorDrag = null;
let tileEditorView = null;
let audioChanging = false;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastUiUpdate = 0;
const contactOnsets = new Map();
const contactLastSeen = new Map();
const movableVertexCache = new Map();
let suppressContactOnsetsUntil = 0;
let suppressContactOnsetFrames = 0;

function wrap01(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function pingPong01(value) {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function speedFromSlider(value) {
  return SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** clamp(value, 0, 1);
}

function sliderFromSpeed(value) {
  return Math.log(value / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
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

function resetContactTracking() {
  contactOnsets.clear();
  contactLastSeen.clear();
}

function restartContinuousEnvelopes() {
  resetContactTracking();
  suppressContactOnsetsUntil = 0;
  suppressContactOnsetFrames = 0;
}

function suppressGeometryOnsets(duration = GEOMETRY_EDIT_SETTLE_MS) {
  suppressContactOnsetsUntil = Math.max(
    suppressContactOnsetsUntil,
    performance.now() + duration,
  );
  suppressContactOnsetFrames = Math.max(suppressContactOnsetFrames, 2);
}

function invalidateGeometry() {
  geometryDirty = true;
  tileEditorDirty = true;
  suppressGeometryOnsets();
  scheduleFrame();
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const paint = () => {
    input.value = String(state[key]);
    if (output) output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    if (key === "voiceCap") state.voiceCap = Math.round(state.voiceCap);
    paint();
    afterChange?.();
    scheduleFrame();
  });
  paint();
  return paint;
}

function bindSelect(id, key, afterChange) {
  const select = $(id);
  select.value = state[key];
  select.addEventListener("change", () => {
    state[key] = select.value;
    afterChange?.();
    scheduleFrame();
  });
}

function tileScaleForDensity(density = state.density) {
  const amount = clamp(Number(density), 0, MAX_DENSITY);
  return OPEN_TILE_SCALE + (DENSE_TILE_SCALE - OPEN_TILE_SCALE) * amount;
}

function densityForTileScale(scale) {
  return clamp(
    (OPEN_TILE_SCALE - Number(scale)) / (OPEN_TILE_SCALE - DENSE_TILE_SCALE),
    0,
    MAX_DENSITY,
  );
}

function effectiveCycleRate() {
  return state.speed * DEFAULT_TILE_SCALE / tileScaleForDensity();
}

function paintSpeed() {
  $("speedOut").textContent = `${effectiveCycleRate().toFixed(3)} cyc/s`;
}

const paintDensity = bindRange("density", "density", (value) => {
  if (value < 0.34) return "open";
  if (value > 0.68) return "dense";
  return "medium";
}, () => {
  invalidateGeometry();
  paintSpeed();
});
const paintAngle = bindRange(
  "angle",
  "angle",
  (value) => `${Math.round(value)}\u00b0`,
  () => suppressGeometryOnsets(),
);
$("resetLineAngle").addEventListener("click", () => {
  state.angle = 90;
  paintAngle();
  suppressGeometryOnsets();
  scheduleFrame();
  announce("Line angle reset to 90 degrees.");
});
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => {
  pool.setLevel(state.level);
});
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("contactLevel", "contactLevel", (value) => `${Math.round(value * 100)}%`);
bindRange(
  "intersectionAccent",
  "intersectionAccent",
  (value) => `${Math.round(value * 100)}%`,
);
bindRange("intersectionDecay", "intersectionDecay", (value) => `${Math.round(value)} ms`);
bindRange("voiceCap", "voiceCap", (value) => (
  `${Math.round(value)} ${plural(Math.round(value), "voice")}`
));
bindRange("percussionAttack", "percussionAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("percussionDecay", "percussionDecay", (value) => `${Math.round(value)} ms`);
bindRange("shepardCycles", "shepardCycles", (value) => `${value.toFixed(2)} oct / loop`);
bindRange("shepardWidth", "shepardWidth", (value) => `${value.toFixed(1)} oct`);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("pmIndex", "pmIndex", (value) => `${value.toFixed(2)} rad`);
bindRange("pmRatio", "pmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`);

bindSelect("pitchSource", "pitchSource");
bindSelect("pitchCurve", "pitchCurve");
bindSelect("levelSource", "levelSource");
bindSelect("levelCurve", "levelCurve");
bindSelect("synthSource", "synthSource");

function setSoundMode(mode, shouldAnnounce = true) {
  const nextMode = SOUND_MODES.has(mode) ? mode : "sine";
  if (nextMode !== state.soundMode) {
    pool.silence();
    state.soundMode = nextMode;
    if (state.playing && state.soundMode !== "percussion") restartContinuousEnvelopes();
    else {
      resetContactTracking();
      suppressGeometryOnsets();
    }
  }
  $("soundMode").value = state.soundMode;
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  $("shepardArticulation").hidden = state.soundMode !== "shepard";
  $("fmArticulation").hidden = state.soundMode !== "fm";
  $("pmArticulation").hidden = state.soundMode !== "pm";
  $("synthMapping").hidden = !["fm", "pm"].includes(state.soundMode);
  amplitudeControl.setVisible(state.soundMode !== "percussion");
  updateSummaries();
  if (shouldAnnounce) announce(`${SOUND_MODE_LABELS[state.soundMode]} voice selected.`);
  scheduleFrame();
}

$("soundMode").addEventListener("change", (event) => {
  setSoundMode(event.currentTarget.value);
});
$("shepardDirection").value = String(state.shepardDirection);
$("shepardDirection").addEventListener("change", (event) => {
  state.shepardDirection = Number(event.currentTarget.value) < 0 ? -1 : 1;
  scheduleFrame();
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
  if (Math.abs(value) < 0.005) return "straight";
  return `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "reverse" : "forward"}`;
}

function paintParameterControl(index) {
  const value = state.parameters[index] ?? 0;
  $("parameter" + index).value = String(value);
  $("parameter" + index + "Out").textContent = value.toFixed(3);
}

function paintEdgeControl(index) {
  const info = tilingInfo(state.tilingType);
  const rigid = info.edgeShapes[index] === EdgeShape.I;
  const value = rigid ? 0 : (state.edgeCurves[index] ?? 0);
  $("edgeCurve" + index).value = String(value);
  $("edgeCurve" + index + "Out").textContent = formatBend(value, rigid);
}

function configureTilingControls() {
  const info = tilingInfo(state.tilingType);
  $("parameterCount").textContent = `${info.defaultParameters.length} ${plural(info.defaultParameters.length, "parameter")} · guarded`;
  for (let index = 0; index < MAX_PARAMETERS; index += 1) {
    const visible = index < info.defaultParameters.length;
    const wrapper = $("parameterControl" + index);
    const input = $("parameter" + index);
    wrapper.hidden = !visible;
    if (!visible) continue;
    const range = tilingParameterRange(info.type, index);
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = "0.005";
    $("parameterLabel" + index).textContent = `Shape ${index + 1}`;
    paintParameterControl(index);
  }

  const bendableCount = info.edgeShapes.filter((shape) => shape !== EdgeShape.I).length;
  $("edgeCount").textContent = `${bendableCount} bendable ${plural(bendableCount, "class", "classes")}`;
  for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
    const exists = index < info.edgeShapes.length;
    const wrapper = $("edgeControl" + index);
    const input = $("edgeCurve" + index);
    if (!exists) {
      wrapper.hidden = true;
      continue;
    }
    const shape = info.edgeShapes[index];
    const rigid = shape === EdgeShape.I;
    wrapper.hidden = rigid;
    input.disabled = rigid;
    $("edgeLabel" + index).textContent = `Edge ${String.fromCharCode(65 + index)} \u00b7 ${edgeShapeName(shape)}${rigid ? " rigid" : ""}`;
    paintEdgeControl(index);
  }
  const hasVertexParameters = info.defaultParameters.length > 0;
  $("resetTileVertices").disabled = !hasVertexParameters;
  tileEditorCanvas.setAttribute("aria-disabled", String(!hasVertexParameters));
  $("tileEditorLegend").textContent = hasVertexParameters
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
  const canvasBounds = tileEditorCanvas.getBoundingClientRect();
  const width = Math.round(clamp(canvasBounds.width || 320, 220, 480));
  const height = Math.round(clamp(canvasBounds.height || 220, 160, 330));
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
        (width - 54) / Math.max(model.bounds.maxX - model.bounds.minX, 0.2),
        (height - 54) / Math.max(model.bounds.maxY - model.bounds.minY, 0.2),
      ),
    };

  traceEditorPoints(model.outline, view, true);
  tileEditorContext.fillStyle = "rgba(255, 184, 107, 0.13)";
  tileEditorContext.fill();
  tileEditorContext.strokeStyle = "rgba(214, 232, 226, 0.70)";
  tileEditorContext.lineWidth = 1.2;
  tileEditorContext.lineJoin = "round";
  tileEditorContext.stroke();

  traceEditorPoints(model.vertices, view, true);
  tileEditorContext.strokeStyle = "rgba(255, 184, 107, 0.24)";
  tileEditorContext.lineWidth = 0.8;
  tileEditorContext.stroke();

  const movable = movableVerticesFor(model);
  model.vertices.forEach((vertex, index) => {
    const point = editorScreenPoint(vertex, view);
    tileEditorContext.beginPath();
    tileEditorContext.arc(point.x, point.y, movable[index] ? 6 : 3.5, 0, Math.PI * 2);
    tileEditorContext.fillStyle = movable[index]
      ? "#ffb86b"
      : "rgba(214, 232, 226, 0.38)";
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

$("resetTileVertices").addEventListener("click", () => {
  state.parameters = [...tilingInfo(state.tilingType).defaultParameters];
  for (let index = 0; index < state.parameters.length; index += 1) {
    paintParameterControl(index);
  }
  invalidateGeometry();
  announce("Tile vertices reset to this family's defaults.");
});

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
      ? "Choose an orange movable corner."
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
  for (let index = 0; index < state.parameters.length; index += 1) {
    paintParameterControl(index);
  }
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
    : "Tile vertices updated; lattice parameters synchronized.");
}

tileEditorCanvas.addEventListener("pointerup", finishTileEditorDrag);
tileEditorCanvas.addEventListener("pointercancel", finishTileEditorDrag);

for (let index = 0; index < MAX_PARAMETERS; index += 1) {
  $("parameter" + index).addEventListener("input", () => {
    const requested = [...state.parameters];
    requested[index] = Number($("parameter" + index).value);
    const guarded = guardedPrototileEdit(requested);
    state.parameters = guarded.parameters;
    state.edgeCurves = guarded.edgeCurves;
    for (let controlIndex = 0; controlIndex < state.parameters.length; controlIndex += 1) {
      paintParameterControl(controlIndex);
    }
    if (guarded.constrained) announce("Overlap guard limited the shape parameter.");
    invalidateGeometry();
  });
}

for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
  $("edgeCurve" + index).addEventListener("input", () => {
    const info = tilingInfo(state.tilingType);
    if (info.edgeShapes[index] === EdgeShape.I) return;
    const requested = [...state.edgeCurves];
    requested[index] = Number($("edgeCurve" + index).value);
    const guarded = guardedPrototileEdit(state.parameters, requested);
    state.parameters = guarded.parameters;
    state.edgeCurves = guarded.edgeCurves;
    for (let controlIndex = 0; controlIndex < state.edgeCurves.length; controlIndex += 1) {
      paintEdgeControl(controlIndex);
    }
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
  if (shouldAnnounce) announce(`${info.label} selected with straight edges.`);
}

tilingSelect.addEventListener("change", () => setTilingType(Number(tilingSelect.value)));

const speedInput = $("speed");
speedInput.value = String(sliderFromSpeed(state.speed));
speedInput.addEventListener("input", () => {
  state.speed = speedFromSlider(Number(speedInput.value));
  paintSpeed();
});
paintSpeed();

function setScanMotion(motion, shouldAnnounce = true) {
  if (!["loop", "pingpong"].includes(motion)) return;
  state.scanMotion = motion;
  state.continuousPosition = state.position;
  for (const button of $("scanMotion").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === motion);
  }
  if (shouldAnnounce) {
    announce(motion === "loop" ? "Pattern movement loops." : "Pattern movement ping-pongs.");
  }
  updateSummaries();
  scheduleFrame();
}

for (const button of $("scanMotion").querySelectorAll("button")) {
  button.addEventListener("click", () => setScanMotion(button.dataset.value));
}

function setPosition(value) {
  state.position = clamp(Number(value), 0, 1);
  state.continuousPosition = state.position;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  scheduleFrame();
}

function setContinuousPosition(value) {
  state.continuousPosition = Number(value) || 0;
  state.position = state.scanMotion === "pingpong"
    ? pingPong01(state.continuousPosition)
    : wrap01(state.continuousPosition);
  scheduleFrame();
}

$("position").addEventListener("input", () => setPosition($("position").value));

function patternDirectionName(angle = state.patternDirectionAngle) {
  if (angle <= 0.5) return "R→L";
  if (angle >= 89.5) return "U→D";
  return `${Math.round(angle)}°`;
}

function paintPatternDirection() {
  const angle = state.patternDirectionAngle;
  const name = patternDirectionName(angle);
  $("patternDirectionAngle").value = String(angle);
  $("patternDirectionAngleOut").textContent = name;
  $("patternDirectionGlyph").textContent = angle <= 0.5 ? "\u2190" : angle >= 89.5 ? "\u2193" : "\u2199";
  $("patternDirectionText").textContent = name;
  $("patternDirection").setAttribute(
    "aria-label",
    angle < 45
      ? "Pattern moves right to left; switch to top to bottom"
      : "Pattern moves top to bottom; switch to right to left",
  );
}

function setPatternDirectionAngle(value, shouldAnnounce = false) {
  state.patternDirectionAngle = clamp(Number(value), 0, 90);
  paintPatternDirection();
  invalidateGeometry();
  updateSummaries();
  if (shouldAnnounce) {
    announce(state.patternDirectionAngle < 45
      ? "Pattern moves right to left."
      : "Pattern moves top to bottom.");
  }
}

$("patternDirection").addEventListener("click", () => {
  setPatternDirectionAngle(state.patternDirectionAngle < 45 ? 90 : 0, true);
});
$("patternDirectionAngle").addEventListener("input", () => {
  setPatternDirectionAngle($("patternDirectionAngle").value);
});

function setPlaying(playing) {
  const wasPlaying = state.playing;
  state.playing = Boolean(playing);
  if (!state.playing) pool.silence();
  else if (!wasPlaying && state.soundMode !== "percussion") restartContinuousEnvelopes();
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause pattern" : "Play pattern");
  lastFrameTime = performance.now();
  updateSummaries();
  announce(state.playing ? "Pattern playing." : "Pattern paused.");
  scheduleFrame();
}

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

function disableAudio() {
  state.audio = false;
  pool.disable();
  paintAudioState();
  announce("Audio off.");
  scheduleFrame();
}

async function enableAudio() {
  if (state.audio) return true;
  if (audioChanging) return false;

  audioChanging = true;
  $("audioButton").disabled = true;
  paintAudioState();
  $("audioError").hidden = true;
  try {
    await pool.enable();
    pool.setVoices([]);
    pool.setLevel(state.level);
    state.audio = true;
    if (state.playing && state.soundMode !== "percussion") restartContinuousEnvelopes();
    else {
      resetContactTracking();
      suppressGeometryOnsets();
    }
    paintAudioState();
    announce(`Audio on. ${SOUND_MODE_LABELS[state.soundMode]} is ready.`);
    scheduleFrame();
    return true;
  } catch (error) {
    state.audio = false;
    paintAudioState();
    $("audioError").textContent = error instanceof Error
      ? error.message
      : "Web Audio could not start.";
    $("audioError").hidden = false;
    return false;
  } finally {
    audioChanging = false;
    $("audioButton").disabled = false;
  }
}

async function toggleAudio() {
  if (state.audio) disableAudio();
  else await enableAudio();
}

async function togglePlayback() {
  if (state.playing) {
    setPlaying(false);
    return;
  }
  if (!state.audio) await enableAudio();
  setPlaying(true);
}

$("playButton").addEventListener("click", togglePlayback);
$("audioButton").addEventListener("click", toggleAudio);

function updateSummaries() {
  const info = tilingInfo(state.tilingType);
  $("playSummary").textContent = `Pattern \u00b7 ${state.playing ? state.scanMotion : "paused"} \u00b7 ${patternDirectionName()}`;
  $("formSummary").textContent = info.label;
  $("soundSummary").textContent = SOUND_MODE_LABELS[state.soundMode];
}

$("straightenEdges").addEventListener("click", () => {
  state.edgeCurves = tilingInfo(state.tilingType).edgeShapes.map(() => 0);
  for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) paintEdgeControl(index);
  invalidateGeometry();
  announce("All bendable edges straightened.");
});

$("resetForm").addEventListener("click", () => {
  state.density = DEFAULT_DENSITY;
  state.angle = 90;
  paintDensity();
  paintAngle();
  setPosition(0.5);
  setTilingType(DEFAULT_TILING_TYPE, false);
  announce("Lattice reset to IH20, straight edges, and a 90 degree centered line.");
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const halfHeight = 1.04;
  const halfWidth = halfHeight * (cssWidth / cssHeight);
  viewBounds = {
    minX: -halfWidth,
    minY: -halfHeight,
    maxX: halfWidth,
    maxY: halfHeight,
  };
  worldScale = cssHeight / (halfHeight * 2);
  invalidateGeometry();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);

function rebuildGeometry() {
  const buildAtDensity = (density) => buildLattice({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
    scale: tileScaleForDensity(density),
    // The background follows its own motion bearing; the reader line keeps an
    // independent angle so changing either control produces new contacts.
    alignPeriodToDegrees: 180 + state.patternDirectionAngle,
    bounds: viewBounds,
  });
  const worldArea = (viewBounds.maxX - viewBounds.minX) * (viewBounds.maxY - viewBounds.minY);
  const tileBudget = Math.max(140, Math.round(worldArea * MAX_TILES_PER_WORLD_AREA));
  const requestedDensity = clamp(state.density, 0, MAX_DENSITY);
  let appliedDensity = requestedDensity;
  let nextLattice = buildAtDensity(appliedDensity);
  for (let attempt = 0; attempt < 4 && nextLattice.tiles.length > tileBudget; attempt += 1) {
    if (appliedDensity <= 0) break;
    const scale = tileScaleForDensity(appliedDensity);
    const guardedScale = Math.min(
      OPEN_TILE_SCALE,
      scale * Math.sqrt(nextLattice.tiles.length / tileBudget) * 1.03,
    );
    const guardedDensity = densityForTileScale(guardedScale);
    appliedDensity = guardedDensity < appliedDensity - 0.002
      ? guardedDensity
      : Math.max(0, appliedDensity - 0.02);
    nextLattice = buildAtDensity(appliedDensity);
  }
  const densityLimited = appliedDensity < requestedDensity - 0.002;
  state.density = appliedDensity;
  lattice = nextLattice;
  paintDensity();
  paintSpeed();
  geometryDirty = false;
  $("densityOut").textContent = `${lattice.tiles.length} tiles${densityLimited ? " · limit" : ""}`;
}

function tracePoints(points, close = false) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  if (close) context.closePath();
}

function drawLattice(scan, offset, contacts, voicedContacts) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.save();
  context.translate(cssWidth / 2, cssHeight / 2);
  context.scale(worldScale, -worldScale);

  context.save();
  context.translate(offset.x, offset.y);
  for (const tile of lattice.tiles) {
    tracePoints(tile.points, true);
    context.fillStyle = TILE_COLORS[tile.color % TILE_COLORS.length];
    context.fill();
  }

  context.beginPath();
  for (const edge of lattice.edges) {
    context.moveTo(edge.points[0].x, edge.points[0].y);
    for (let index = 1; index < edge.points.length; index += 1) {
      context.lineTo(edge.points[index].x, edge.points[index].y);
    }
  }
  context.strokeStyle = "rgba(214, 232, 226, 0.31)";
  context.lineWidth = 0.8 / worldScale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.restore();

  const lineExtent = Math.hypot(
    viewBounds.maxX - viewBounds.minX,
    viewBounds.maxY - viewBounds.minY,
  );
  context.beginPath();
  context.moveTo(
    scan.origin.x - scan.tangent.x * lineExtent,
    scan.origin.y - scan.tangent.y * lineExtent,
  );
  context.lineTo(
    scan.origin.x + scan.tangent.x * lineExtent,
    scan.origin.y + scan.tangent.y * lineExtent,
  );
  context.strokeStyle = "rgba(255, 243, 214, 0.88)";
  context.lineWidth = 4.5 / worldScale;
  context.stroke();
  context.strokeStyle = "#ffb86b";
  context.lineWidth = 1.4 / worldScale;
  context.stroke();

  const voiced = new Set(voicedContacts);
  for (const contact of contacts) {
    const sounding = voiced.has(contact);
    if (contact.accent > 0.025) {
      context.beginPath();
      context.arc(contact.x, contact.y, (5 + contact.accent * 9) / worldScale, 0, Math.PI * 2);
      context.strokeStyle = `rgba(255, 184, 107, ${0.08 + contact.accent * 0.48})`;
      context.lineWidth = (0.8 + contact.accent * 1.2) / worldScale;
      context.stroke();
    }
    context.beginPath();
    context.arc(contact.x, contact.y, (sounding ? 4 : 2.5) / worldScale, 0, Math.PI * 2);
    context.fillStyle = sounding ? "#fff3d6" : "rgba(255, 184, 107, 0.55)";
    context.fill();
    if (sounding) {
      context.strokeStyle = "#ffb86b";
      context.lineWidth = 1 / worldScale;
      context.stroke();
    }
  }

  context.restore();
}

function normalizedContact(contact) {
  return {
    x: clamp(
      (contact.x - viewBounds.minX) / Math.max(viewBounds.maxX - viewBounds.minX, 1e-9),
      0,
      1,
    ),
    y: clamp(
      (contact.y - viewBounds.minY) / Math.max(viewBounds.maxY - viewBounds.minY, 1e-9),
      0,
      1,
    ),
  };
}

function rawPitchMark(contact) {
  if (state.pitchSource === "along") return contact.along01;
  if (state.pitchSource === "incidence") return contact.incidence;
  if (state.pitchSource === "orientation") return contact.orientation;
  return normalizedContact(contact).y;
}

function rawLevelMark(contact) {
  if (state.levelSource === "fixed") return 1;
  if (state.levelSource === "center") return 1 - Math.abs(contact.along01 * 2 - 1);
  if (state.levelSource === "orientation") return contact.orientation;
  return contact.incidence;
}

function rawSynthMark(contact) {
  if (state.synthSource === "along") return contact.along01;
  if (state.synthSource === "orientation") return contact.orientation;
  if (state.synthSource === "height") return normalizedContact(contact).y;
  return contact.incidence;
}

function shepardRate() {
  if (!state.playing) return 0;
  const rate = effectiveCycleRate();
  const visualLoopRate = state.scanMotion === "pingpong" ? rate * 0.5 : rate;
  return visualLoopRate
    * state.shepardCycles
    * state.shepardDirection
    * state.traversalDirection;
}

function synthParametersForContact(contact) {
  return synthParametersForMode(state.soundMode, rawSynthMark(contact), {
    fmIndex: state.fmIndex,
    fmRatio: state.fmRatio,
    pmIndex: state.pmIndex,
    pmRatio: state.pmRatio,
    shepardRate: shepardRate(),
    shepardWidth: state.shepardWidth,
  });
}

function mappingForContact(contact) {
  const normalized = normalizedContact(contact);
  const pitchRaw = clamp(rawPitchMark(contact), 0, 1);
  const levelRaw = clamp(rawLevelMark(contact), 0, 1);
  const pitch = mapCurve01(pitchRaw, state.pitchCurve);
  const levelMark = mapCurve01(levelRaw, state.levelCurve);
  const baseGain = state.contactLevel * 0.14 * (0.2 + 0.8 * levelMark);
  return {
    pitchRaw,
    levelRaw,
    pitch,
    levelMark,
    frequency: pitch01ToFrequency(pitch, state.baseFrequency, state.pitchRange),
    gain: baseGain * amplitudeControl.sample(
      Number.isFinite(contact.accentAge)
        ? clamp(contact.accentAge / (state.intersectionDecay / 1000), 0, 1)
        : (amplitudeControl.state.points[2]?.x ?? 0.25),
      1 + 1.25 * state.intersectionAccent,
    ),
    strikeGain: state.contactLevel
      * 0.65
      * (0.2 + 0.8 * levelMark)
      * (0.5 + 0.5 * state.intersectionAccent),
    pan: (normalized.x * 2 - 1) * state.stereoWidth,
    normalized,
  };
}

function addIntersectionAccents(contacts, nowSeconds, suppressOnsets = false) {
  const activeKeys = new Set();
  const accented = contacts.map((contact) => {
    const key = contact.voiceKey;
    activeKeys.add(key);
    const tracked = contactOnsets.has(key);
    const onset = !suppressOnsets && !tracked;
    if (!tracked) contactOnsets.set(key, suppressOnsets ? nowSeconds - 1 : nowSeconds);
    else if (suppressOnsets) {
      contactOnsets.set(key, Math.min(contactOnsets.get(key), nowSeconds - 1));
    }
    contactLastSeen.set(key, nowSeconds);
    const accentAge = suppressOnsets
      ? Number.POSITIVE_INFINITY
      : Math.max(0, nowSeconds - contactOnsets.get(key));
    return {
      ...contact,
      accentAge,
      accent: Number.isFinite(accentAge)
        ? Math.exp(-accentAge / (state.intersectionDecay / 1000))
        : 0,
      onset,
    };
  });
  for (const key of contactOnsets.keys()) {
    if (activeKeys.has(key)) continue;
    const lastSeen = contactLastSeen.get(key) ?? Number.NEGATIVE_INFINITY;
    if (nowSeconds - lastSeen <= CONTACT_REENTRY_GRACE_SECONDS) continue;
    contactOnsets.delete(key);
    contactLastSeen.delete(key);
  }
  return accented;
}

function voiceData(contacts) {
  return contacts.map((contact) => {
    const mapping = mappingForContact(contact);
    const synth = synthParametersForContact(contact);
    return {
      contact,
      mapping,
      synth,
      voice: {
        key: `lattice:${contact.voiceKey}`,
        frequency: mapping.frequency,
        gain: mapping.gain,
        pan: mapping.pan,
        waveform: "sine",
        ...synth,
      },
    };
  });
}

function emitIntersectionStrikes(data) {
  if (state.soundMode !== "percussion" || !state.audio) return;
  const intents = data
    .filter((item) => item.contact.onset)
    .map((item) => ({
      key: `intersection:${item.contact.voiceKey}`,
      frequency: item.mapping.frequency,
      gain: item.mapping.strikeGain,
      pan: item.mapping.pan,
      waveform: "sine",
    }));
  if (!intents.length) return;
  const headroom = pool.availableStrikeHeadroom(STRIKE_BATCH_CEILING);
  for (const spec of normalizeStrikeGains(intents, headroom)) {
    pool.strike(spec, {
      attackSeconds: cornerAttackSeconds(state.percussionAttack),
      decaySeconds: cornerDecaySeconds(state.percussionDecay),
      retriggerMode: "crossfade",
      crossfadeSeconds: 0.014,
    });
  }
}

const SOURCE_LABELS = {
  height: "Vertical position",
  along: "Position along line",
  incidence: "Line / edge incidence",
  orientation: "Edge orientation",
  fixed: "Fixed",
  center: "Distance from line center",
};

const CURVE_LABELS = {
  linear: "linear",
  exponential: "expand highs",
  logarithmic: "expand lows",
  smooth: "smooth S-curve",
  inverted: "inverted",
};

function updateOutput(data) {
  $("outputVoiceLabel").textContent = state.soundMode;
  $("pitchRouteSource").textContent = SOURCE_LABELS[state.pitchSource];
  $("pitchRouteCurve").textContent = `${CURVE_LABELS[state.pitchCurve]} mark \u2192 exponential Hz`;
  $("levelRouteSource").textContent = SOURCE_LABELS[state.levelSource];
  $("levelRouteCurve").textContent = CURVE_LABELS[state.levelCurve];
  $("markPhaseOut").textContent = state.position.toFixed(3);
  const modulationMode = ["fm", "pm"].includes(state.soundMode);
  $("synthRoute").hidden = !modulationMode && state.soundMode !== "shepard";
  $("synthRouteSource").textContent = modulationMode
    ? SOURCE_LABELS[state.synthSource]
    : "Pattern transport";
  $("synthRouteTarget").textContent = modulationMode ? "Mod depth" : "Glissando";
  $("synthRouteCurve").textContent = modulationMode
    ? "linear geometry drive"
    : `${state.shepardCycles.toFixed(2)} octaves per loop`;

  if (!data.length) {
    $("outputContactLabel").textContent = "No active contact";
    for (const id of [
      "markPositionOut",
      "markIncidenceOut",
      "markAngleOut",
      "markPitchValueOut",
      "markFrequencyOut",
      "markGainOut",
      "markPanOut",
      "markSynthDriveOut",
      "markSynthValueOut",
    ]) $(id).textContent = "-";
    $("contactStream").innerHTML = "";
    return;
  }

  const first = data[0];
  $("outputContactLabel").textContent = `Contact 1 of ${data.length}`;
  $("markPositionOut").textContent = `${first.contact.x.toFixed(3)}, ${first.contact.y.toFixed(3)}`;
  $("markIncidenceOut").textContent = first.contact.incidence.toFixed(3);
  $("markAngleOut").textContent = `${Math.round(first.contact.orientation * 180)}\u00b0`;
  $("markPitchValueOut").textContent = first.mapping.pitch.toFixed(3);
  $("markFrequencyOut").textContent = `${Math.round(first.mapping.frequency)} Hz`;
  $("markGainOut").textContent = first.mapping.gain.toFixed(3);
  $("markPanOut").textContent = first.mapping.pan.toFixed(3);
  $("markSynthDriveOut").textContent = modulationMode
    ? first.synth.synthDrive.toFixed(3)
    : state.soundMode === "shepard" ? state.position.toFixed(3) : "-";
  if (state.soundMode === "fm") {
    $("markSynthValueOut").textContent = `${first.synth.modulationIndex.toFixed(2)} index @ ${first.synth.modulationRatio.toFixed(2)}:1`;
  } else if (state.soundMode === "pm") {
    $("markSynthValueOut").textContent = `${first.synth.modulationIndex.toFixed(2)} rad @ ${first.synth.modulationRatio.toFixed(2)}:1`;
  } else if (state.soundMode === "shepard") {
    const direction = first.synth.shepardRate >= 0 ? "+" : "";
    $("markSynthValueOut").textContent = `${direction}${first.synth.shepardRate.toFixed(3)} oct/s \u00b7 ${first.synth.shepardWidth.toFixed(1)} oct`;
  } else if (state.soundMode === "percussion") {
    $("markSynthValueOut").textContent = `${Math.round(state.percussionDecay)} ms strike`;
  } else {
    $("markSynthValueOut").textContent = "intersection envelope";
  }
  $("contactStream").innerHTML = data.slice(0, 12).map((item, index) => (
    `<div class="contact-row"><b>#${index + 1}</b>`
      + `<span>x ${item.mapping.normalized.x.toFixed(3)}</span>`
      + `<span>${Math.round(item.contact.orientation * 180)}&deg;</span>`
      + `<span>${Math.round(item.mapping.frequency)} Hz</span></div>`
  )).join("");
}

function updateUi(allContacts, data, voiceCount) {
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  $("stageReadout").textContent = `1 LINE \u00b7 ${allContacts.length} ${plural(allContacts.length, "CONTACT", "CONTACTS")} \u00b7 ${state.audio ? `${voiceCount} ${plural(voiceCount, "VOICE", "VOICES")}` : "AUDIO OFF"}`;
  updateSummaries();
  updateOutput(data);
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (state.playing) {
    state.continuousPosition += state.traversalDirection * effectiveCycleRate() * deltaSeconds;
    state.position = state.scanMotion === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }
  if (geometryDirty || !lattice) rebuildGeometry();

  const scan = createScanLine(viewBounds, 0.5, state.angle);
  const offset = latticeOffsetForPhase(lattice, state.position);
  const rawContacts = contactsForLine(lattice, scan, undefined, offset);
  const geometryEditing = suppressContactOnsetFrames > 0 || now < suppressContactOnsetsUntil;
  if (suppressContactOnsetFrames > 0) suppressContactOnsetFrames -= 1;
  const contacts = addIntersectionAccents(rawContacts, now / 1000, geometryEditing);
  const voicedContacts = centeredContactWindow(contacts, state.voiceCap);
  const data = voiceData(voicedContacts);
  if (state.playing && !geometryEditing) emitIntersectionStrikes(data);
  drawLattice(scan, offset, contacts, voicedContacts);
  if (tileEditorDirty) drawTileEditor();

  const continuousMode = state.soundMode !== "percussion";
  if (state.audio && !document.hidden) {
    pool.setVoices(continuousMode && state.playing ? data.map((item) => item.voice) : []);
  }
  if (!state.playing || now - lastUiUpdate > 60) {
    const voiceCount = continuousMode
      ? (state.playing ? data.length : 0)
      : pool.activeStrikeCount;
    updateUi(contacts, data, state.audio ? voiceCount : 0);
    lastUiUpdate = now;
  }
  if (
    state.playing
    || contacts.some((contact) => contact.accent > 0.025)
    || (state.soundMode === "percussion" && pool.activeStrikeCount > 0)
  ) scheduleFrame();
}

function canvasWorldPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left - cssWidth / 2) / worldScale,
    y: -(event.clientY - bounds.top - cssHeight / 2) / worldScale,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (geometryDirty || !lattice) rebuildGeometry();
  pointerDrag = {
    point: canvasWorldPoint(event),
    phase: state.continuousPosition,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerDrag || !lattice) return;
  const point = canvasWorldPoint(event);
  const delta = {
    x: point.x - pointerDrag.point.x,
    y: point.y - pointerDrag.point.y,
  };
  const periodSquared = lattice.period.x ** 2 + lattice.period.y ** 2;
  if (periodSquared < 1e-9) return;
  const phaseDelta = -(delta.x * lattice.period.x + delta.y * lattice.period.y) / periodSquared;
  setContinuousPosition(pointerDrag.phase + phaseDelta);
});
function endPointer() {
  pointerDrag = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

window.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(tag)) return;
  if (event.code === "Space" || event.key === " ") void togglePlayback();
  else if (event.key === "ArrowLeft") setPosition(state.position - (event.shiftKey ? 0.05 : 0.01));
  else if (event.key === "ArrowRight") setPosition(state.position + (event.shiftKey ? 0.05 : 0.01));
  else if (event.key === "ArrowUp") {
    state.angle = (state.angle + 1) % 180;
    paintAngle();
    suppressGeometryOnsets();
    scheduleFrame();
  } else if (event.key === "ArrowDown") {
    state.angle = (state.angle + 179) % 180;
    paintAngle();
    suppressGeometryOnsets();
    scheduleFrame();
  } else return;
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else scheduleFrame();
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) void pool.close();
});
window.addEventListener("pageshow", scheduleFrame);

configureTilingControls();
setScanMotion(state.scanMotion, false);
setSoundMode(state.soundMode, false);
setPosition(state.position);
paintPatternDirection();
updateSummaries();
paintAudioState();
scheduleFrame();
