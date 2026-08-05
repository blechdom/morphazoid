import {
  TILING_TYPES,
  buildLattice,
  buildPrototile,
  constrainPrototileEdit,
  contactsForLine,
  createScanLine,
  edgeShapeName,
  latticeOffsetForPhase,
  parametersForDraggedVertex,
  tilingInfo,
  tilingParameterRange,
} from "./src/lattice.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  LATTICE_DRUM_MAPPING_MODES,
  latticeDrumVoiceIndex,
  mappedLatticeDrumVoice,
  normalizedLatticeContact,
} from "./src/lattice-drums.js";
import {
  LATTICE_TILE_COLORS,
  latticeColorPairForIndex,
  latticeColorPairLabel,
  normalizedLatticeColorPair,
} from "./src/lattice-colors.js";
import { EdgeShape } from "./vendor/tactile/tactile.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_TILING = 20;
const MAX_PARAMETERS = 6;
const MAX_EDGE_CLASSES = 5;
const formatDegrees = (value) => `${Number(value).toFixed(1)}°`;
const wrapLineAngle = (value) => {
  const wrapped = ((Number(value) % 180) + 180) % 180;
  return Math.round(wrapped * 10) / 10;
};
const OPEN_TILE_SCALE = .46;
const DENSE_TILE_SCALE = .14;
const TILE_COLORS = LATTICE_TILE_COLORS.map(({ fill }) => fill);
const audio = new FmDrumAudio(globalThis);
const defaults = {
  position: .5,
  speed: .36,
  patternAngle: 0,
  lineAngle: 90,
  direction: -1,
  tilingType: DEFAULT_TILING,
  density: .52,
  mappingMode: "edge-angle",
  pitchDepth: 12,
  characterDepth: .7,
  strikeLimit: 6,
  output: .65,
};
const state = {
  ...defaults,
  continuousPosition: defaults.position,
  playing: false,
  audioOn: false,
  parameters: [...tilingInfo(DEFAULT_TILING).defaultParameters],
  edgeCurves: tilingInfo(DEFAULT_TILING).edgeShapes.map(() => 0),
};
const voices = loadDrumBank();
const canvas = $("stage");
const drawing = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const tileEditorCanvas = $("tileEditorCanvas");
const tileEditorDrawing = tileEditorCanvas.getContext("2d");
const lastStrikeTimes = new Map();
let lattice = null;
let geometryDirty = true;
let suppressStrikes = 2;
let previousContactKeys = new Set();
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let worldScale = 1;
let viewBounds = { minX: -1.5, minY: -1, maxX: 1.5, maxY: 1 };
let pointerDrag = null;
let tileEditorDrag = null;
let tileEditorView = null;
let tileEditorDirty = true;
const movableVertexCache = new Map();

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function wrap01(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
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

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function tileScale() {
  return OPEN_TILE_SCALE + (DENSE_TILE_SCALE - OPEN_TILE_SCALE) * state.density;
}

function invalidateGeometry() {
  geometryDirty = true;
  tileEditorDirty = true;
  suppressStrikes = 2;
  previousContactKeys.clear();
  scheduleFrame();
}

function setAudioState(enabled) {
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
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

function populateTilingTypes() {
  const groups = new Map();
  for (const info of TILING_TYPES) {
    if (!groups.has(info.family)) groups.set(info.family, []);
    groups.get(info.family).push(info);
  }
  const fragment = document.createDocumentFragment();
  for (const [family, types] of groups) {
    const group = document.createElement("optgroup");
    group.label = family;
    for (const info of types) {
      const option = document.createElement("option");
      option.value = String(info.type);
      option.textContent = info.label;
      option.selected = info.type === state.tilingType;
      group.append(option);
    }
    fragment.append(group);
  }
  $("tilingType").replaceChildren(fragment);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

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
    `${info.defaultParameters.length}`,
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
  $("edgeCount").textContent = `${bendableCount} bendable ${plural(bendableCount, "class", "classes")}`;
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
  tileEditorDrawing.beginPath();
  tileEditorDrawing.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = editorScreenPoint(points[index], view);
    tileEditorDrawing.lineTo(point.x, point.y);
  }
  if (close) tileEditorDrawing.closePath();
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
  tileEditorDrawing.setTransform(ratio, 0, 0, ratio, 0, 0);
  tileEditorDrawing.clearRect(0, 0, width, height);

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
  tileEditorDrawing.fillStyle = "rgba(255, 184, 107, .13)";
  tileEditorDrawing.fill();
  tileEditorDrawing.strokeStyle = "rgba(214, 232, 226, .7)";
  tileEditorDrawing.lineWidth = 1.2;
  tileEditorDrawing.lineJoin = "round";
  tileEditorDrawing.stroke();

  traceEditorPoints(model.vertices, view, true);
  tileEditorDrawing.strokeStyle = "rgba(255, 184, 107, .24)";
  tileEditorDrawing.lineWidth = .8;
  tileEditorDrawing.stroke();

  const movable = movableVerticesFor(model);
  model.vertices.forEach((vertex, index) => {
    const point = editorScreenPoint(vertex, view);
    tileEditorDrawing.beginPath();
    tileEditorDrawing.arc(point.x, point.y, movable[index] ? 6 : 3.5, 0, Math.PI * 2);
    tileEditorDrawing.fillStyle = movable[index]
      ? "#ffb86b"
      : "rgba(214, 232, 226, .38)";
    tileEditorDrawing.fill();
    if (movable[index]) {
      tileEditorDrawing.strokeStyle = "#fff3d6";
      tileEditorDrawing.lineWidth = 1;
      tileEditorDrawing.stroke();
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

$("resetTileVertices").addEventListener("click", () => {
  state.parameters = [...tilingInfo(state.tilingType).defaultParameters];
  for (let index = 0; index < state.parameters.length; index += 1) {
    paintParameterControl(index);
  }
  invalidateGeometry();
  announce("Tile vertices reset to this family's defaults.");
});

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
  $(`parameter${index}`).addEventListener("input", () => {
    const requested = [...state.parameters];
    requested[index] = Number($(`parameter${index}`).value);
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
  $(`edgeCurve${index}`).addEventListener("input", () => {
    const info = tilingInfo(state.tilingType);
    if (info.edgeShapes[index] === EdgeShape.I) return;
    const requested = [...state.edgeCurves];
    requested[index] = Number($(`edgeCurve${index}`).value);
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
  $("tilingType").value = String(info.type);
  configureTilingControls();
  invalidateGeometry();
  if (shouldAnnounce) announce(`${info.label} selected with straight edges.`);
}

function populateMappingModes() {
  const fragment = document.createDocumentFragment();
  for (const mode of LATTICE_DRUM_MAPPING_MODES) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label;
    fragment.append(option);
  }
  $("mappingMode").replaceChildren(fragment);
  $("mappingMode").value = state.mappingMode;
}

function currentMappingMode() {
  return LATTICE_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode)
    ?? LATTICE_DRUM_MAPPING_MODES[0];
}

function renderMappingLegend(mode = currentMappingMode()) {
  const fragment = document.createDocumentFragment();
  for (const item of mode.legend) {
    const cell = document.createElement("span");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    label.textContent = item.label;
    detail.textContent = item.detail;
    cell.append(label, detail);
    fragment.append(cell);
  }
  $("mappingLegend").replaceChildren(fragment);
}

function pairAssignment(index) {
  const pair = latticeColorPairForIndex(index);
  if (!pair) return null;
  return {
    pair,
    label: latticeColorPairLabel(pair),
    colors: pair.map((colorIndex) => LATTICE_TILE_COLORS[colorIndex]),
  };
}

function renderDrumMap() {
  const fragment = document.createDocumentFragment();
  voices.forEach((voice, index) => {
    const cell = document.createElement("span");
    cell.className = "lattice-drum-cell";
    cell.dataset.voiceIndex = String(index);
    cell.style.setProperty("--voice-color", voice.color);
    const name = document.createElement("b");
    const assignment = document.createElement("small");
    name.textContent = voice.name;
    if (state.mappingMode === "tile-color-pair") {
      assignment.className = "lattice-drum-assignment";
      const mappedPair = pairAssignment(index);
      if (mappedPair) {
        const swatch = document.createElement("i");
        const label = document.createElement("span");
        swatch.className = "lattice-pair-swatch";
        swatch.style.setProperty("--pair-first", mappedPair.colors[0].solid);
        swatch.style.setProperty("--pair-second", mappedPair.colors[1].solid);
        label.textContent = mappedPair.label;
        assignment.append(swatch, label);
        cell.setAttribute("aria-label", `${mappedPair.label}: ${voice.name}`);
      } else {
        assignment.textContent = "Junction";
        cell.setAttribute("aria-label", `Junction: ${voice.name}`);
      }
    } else {
      assignment.textContent = voice.key.toUpperCase();
      cell.setAttribute("aria-label", `${voice.name}, key ${voice.key.toUpperCase()}`);
    }
    cell.append(name, assignment);
    fragment.append(cell);
  });
  $("drumMap").replaceChildren(fragment);
  $("drumMap").dataset.mappingMode = state.mappingMode;
}

function mappingPlaceholder(mode = currentMappingMode()) {
  if (mode.id === "tile-color-pair") return "TOUCHING TILE COLORS → DRUM VOICE";
  if (mode.id === "position-grid") return "CONTACT POSITION → DRUM VOICE";
  if (mode.id === "incidence-density") return "INCIDENCE + DENSITY → DRUM VOICE";
  return "EDGE CLASS + ANGLE → DRUM VOICE";
}

function updateMappingControls(shouldAnnounce = false) {
  const mode = currentMappingMode();
  $("mappingSummary").textContent = mode.label.toLowerCase();
  $("mappingDescription").textContent = mode.description;
  $("mappingReadout").textContent = mappingPlaceholder(mode);
  renderMappingLegend(mode);
  renderDrumMap();
  if (shouldAnnounce) announce(`${mode.label}. ${mode.description}`);
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  clearTimeout(Number(cell.dataset.clearTimer) || 0);
  const timer = setTimeout(() => cell.classList.remove("is-active"), 150);
  cell.dataset.clearTimer = String(timer);
}

function mappingOptions(contactCount) {
  return {
    mode: state.mappingMode,
    bounds: viewBounds,
    contactCount,
    densityCeiling: 16,
  };
}

function contactOnsetKey(contact) {
  return contact.onsetKey ?? contact.voiceKey;
}

function contactTileColors(contact) {
  return Array.isArray(contact?.adjacentTiles)
    ? contact.adjacentTiles.map(({ color }) => color)
    : [];
}

function mappingReadoutLead(contact, contactCount, voiceIndex) {
  if (state.mappingMode === "tile-color-pair") {
    if (contact.isVertexContact) {
      const edgeCount = Math.max(2, contact.edgeKeys?.length ?? 0);
      return ["JUNCTION", `${edgeCount} EDGES`];
    }
    const colors = contactTileColors(contact);
    if (colors.length !== 2) return ["OPEN BOUNDARY", "JUNCTION VOICE"];
    return [
      latticeColorPairLabel(colors).toUpperCase(),
      `PAIR ${String(voiceIndex + 1).padStart(2, "0")}`,
    ];
  }
  if (state.mappingMode === "position-grid") {
    const position = normalizedLatticeContact(contact, viewBounds);
    return [
      `X ${Math.round(position.x * 100)}%`,
      `Y ${Math.round(position.y * 100)}%`,
    ];
  }
  if (state.mappingMode === "incidence-density") {
    return [
      `INCIDENCE ${Math.round(clamp(contact.incidence) * 100)}%`,
      `${contactCount} CONTACTS`,
    ];
  }
  return [
    `EDGE ${String.fromCharCode(65 + (Math.abs(contact.edgeShapeId || 0) % 4))}`,
    `${Math.round(contact.orientation * 180)}°`,
  ];
}

function updateMappingReadout(contact, contactCount, voiceIndex, voice) {
  $("mappingReadout").textContent = [
    ...mappingReadoutLead(contact, contactCount, voiceIndex),
    `→ ${voice.name}`,
    `${Math.round(voice.frequency)} HZ`,
  ].join(" · ");
}

function triggerContacts(contacts, now) {
  if (!state.playing || !state.audioOn || suppressStrikes > 0) return;
  const onsets = contacts.filter((contact) => !previousContactKeys.has(contactOnsetKey(contact)));
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const voiceIndex = latticeDrumVoiceIndex(contact, mappingOptions(contacts.length));
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 75) continue;
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedLatticeDrumVoice(voices[voiceIndex], contact, {
      bounds: viewBounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    updateMappingReadout(contact, contacts.length, voiceIndex, voice);
    emitted += 1;
  }
}

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

function rebuildGeometry() {
  const buildAtScale = (scale) => buildLattice({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
    scale,
    alignPeriodToDegrees: 180 + state.patternAngle,
    bounds: viewBounds,
  });
  const worldArea = (viewBounds.maxX - viewBounds.minX)
    * (viewBounds.maxY - viewBounds.minY);
  const tileBudget = Math.max(140, Math.round(worldArea * 70));
  let appliedScale = tileScale();
  let nextLattice = buildAtScale(appliedScale);
  for (let attempt = 0; attempt < 4 && nextLattice.tiles.length > tileBudget; attempt += 1) {
    appliedScale = Math.min(
      OPEN_TILE_SCALE,
      appliedScale * Math.sqrt(nextLattice.tiles.length / tileBudget) * 1.03,
    );
    nextLattice = buildAtScale(appliedScale);
  }
  lattice = nextLattice;
  geometryDirty = false;
  const limited = appliedScale > tileScale() + .002;
  $("densityOut").textContent = `${lattice.tiles.length} tiles${limited ? " · limit" : ""}`;
}

function tracePoints(points, close = false) {
  if (!points.length) return;
  drawing.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    drawing.lineTo(points[index].x, points[index].y);
  }
  if (close) drawing.closePath();
}

function drawContactMarker(contact, voiceIndex) {
  const radius = 4.2 / worldScale;
  const voiceColor = voices[voiceIndex].color;
  const pairMode = state.mappingMode === "tile-color-pair";
  const colors = contactTileColors(contact);
  if (!pairMode) {
    drawing.beginPath();
    drawing.arc(contact.x, contact.y, radius, 0, Math.PI * 2);
    drawing.fillStyle = voiceColor;
    drawing.fill();
    drawing.strokeStyle = "#fff3d6";
    drawing.lineWidth = .8 / worldScale;
    drawing.stroke();
    return;
  }

  if (contact.isVertexContact || colors.length !== 2) {
    drawing.beginPath();
    drawing.arc(contact.x, contact.y, radius, 0, Math.PI * 2);
    drawing.fillStyle = voiceColor;
    drawing.fill();
    drawing.strokeStyle = "#fff3d6";
    drawing.lineWidth = .9 / worldScale;
    drawing.stroke();
    drawing.beginPath();
    drawing.arc(contact.x, contact.y, radius * .52, 0, Math.PI * 2);
    drawing.fillStyle = "#07090b";
    drawing.fill();
    drawing.strokeStyle = voiceColor;
    drawing.lineWidth = .8 / worldScale;
    drawing.stroke();
    return;
  }

  const [first, second] = normalizedLatticeColorPair(colors);
  const splitAngle = Math.atan2(contact.tangent.y, contact.tangent.x);
  drawing.beginPath();
  drawing.moveTo(contact.x, contact.y);
  drawing.arc(contact.x, contact.y, radius, splitAngle, splitAngle + Math.PI);
  drawing.closePath();
  drawing.fillStyle = LATTICE_TILE_COLORS[first].solid;
  drawing.fill();
  drawing.beginPath();
  drawing.moveTo(contact.x, contact.y);
  drawing.arc(
    contact.x,
    contact.y,
    radius,
    splitAngle + Math.PI,
    splitAngle + Math.PI * 2,
  );
  drawing.closePath();
  drawing.fillStyle = LATTICE_TILE_COLORS[second].solid;
  drawing.fill();
  drawing.beginPath();
  drawing.arc(contact.x, contact.y, radius, 0, Math.PI * 2);
  drawing.strokeStyle = voiceColor;
  drawing.lineWidth = 1.45 / worldScale;
  drawing.stroke();
}

function drawLattice(scan, offset, contacts) {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.save();
  drawing.translate(cssWidth / 2, cssHeight / 2);
  drawing.scale(worldScale, -worldScale);

  drawing.save();
  drawing.translate(offset.x, offset.y);
  for (const tile of lattice.tiles) {
    drawing.beginPath();
    tracePoints(tile.points, true);
    drawing.fillStyle = TILE_COLORS[tile.color % TILE_COLORS.length];
    drawing.fill();
  }
  drawing.beginPath();
  for (const edge of lattice.edges) tracePoints(edge.points);
  drawing.strokeStyle = "rgba(214, 232, 226, .31)";
  drawing.lineWidth = .8 / worldScale;
  drawing.lineCap = "round";
  drawing.lineJoin = "round";
  drawing.stroke();
  drawing.restore();

  const lineExtent = Math.hypot(
    viewBounds.maxX - viewBounds.minX,
    viewBounds.maxY - viewBounds.minY,
  );
  drawing.beginPath();
  drawing.moveTo(
    scan.origin.x - scan.tangent.x * lineExtent,
    scan.origin.y - scan.tangent.y * lineExtent,
  );
  drawing.lineTo(
    scan.origin.x + scan.tangent.x * lineExtent,
    scan.origin.y + scan.tangent.y * lineExtent,
  );
  drawing.strokeStyle = "rgba(255, 243, 214, .9)";
  drawing.lineWidth = 4.5 / worldScale;
  drawing.stroke();
  drawing.strokeStyle = "#ffb86b";
  drawing.lineWidth = 1.4 / worldScale;
  drawing.stroke();

  for (const contact of contacts) {
    const voiceIndex = latticeDrumVoiceIndex(contact, mappingOptions(contacts.length));
    drawContactMarker(contact, voiceIndex);
  }
  drawing.restore();
}

function updateInterface(contacts) {
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  $("motionSummary").textContent = `${state.playing ? "playing" : "paused"} · ${state.speed.toFixed(3)} cyc/s`;
  const info = tilingInfo(state.tilingType);
  $("formSummary").textContent = info.label;
  $("stageReadout").textContent = [
    `${contacts.length} ${contacts.length === 1 ? "CONTACT" : "CONTACTS"}`,
    state.playing ? "PLAYING" : "PAUSED",
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = Math.min(.1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * deltaSeconds;
    state.position = wrap01(state.continuousPosition);
  }
  if (geometryDirty || !lattice) rebuildGeometry();
  const scan = createScanLine(viewBounds, .5, state.lineAngle);
  const offset = latticeOffsetForPhase(lattice, state.position);
  const contacts = contactsForLine(lattice, scan, undefined, offset);
  triggerContacts(contacts, now);
  previousContactKeys = new Set(contacts.map(contactOnsetKey));
  if (suppressStrikes > 0) suppressStrikes -= 1;
  drawLattice(scan, offset, contacts);
  if (tileEditorDirty) drawTileEditor();
  updateInterface(contacts);
  if (state.playing) scheduleFrame();
}

function setPosition(value) {
  state.position = wrap01(value);
  state.continuousPosition = state.position;
  suppressStrikes = 1;
  scheduleFrame();
}

function reset() {
  Object.assign(state, defaults, {
    continuousPosition: defaults.position,
    playing: false,
    parameters: [...tilingInfo(DEFAULT_TILING).defaultParameters],
    edgeCurves: tilingInfo(DEFAULT_TILING).edgeShapes.map(() => 0),
  });
  setPressed($("playButton"), false);
  $("tilingType").value = String(state.tilingType);
  $("density").value = String(state.density);
  $("speed").value = String(state.speed);
  $("patternAngle").value = String(state.patternAngle);
  $("lineAngle").value = String(state.lineAngle);
  $("mappingMode").value = state.mappingMode;
  $("pitchDepth").value = String(state.pitchDepth);
  $("characterDepth").value = String(state.characterDepth);
  $("strikeLimit").value = String(state.strikeLimit);
  $("output").value = String(state.output);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
  $("patternAngleOut").textContent = formatDegrees(state.patternAngle);
  $("lineAngleOut").textContent = formatDegrees(state.lineAngle);
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
  $("strikeLimitOut").textContent = String(state.strikeLimit);
  for (const button of $("directionChoice").querySelectorAll("button")) {
    setPressed(button, Number(button.dataset.direction) === state.direction);
  }
  updateMappingControls();
  configureTilingControls();
  if (state.audioOn) audio.setOutput(state.output);
  invalidateGeometry();
  announce("Lattice Drum Machine reset.");
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Lattice drums audio off.");
  } else if (await enableAudio()) {
    announce("Lattice drums audio on.");
  }
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  previousContactKeys.clear();
  suppressStrikes = state.playing ? 1 : 0;
  announce(state.playing ? "Lattice playing." : "Lattice paused.");
  scheduleFrame();
});

$("position").addEventListener("input", () => setPosition(Number($("position").value)));
$("speed").addEventListener("input", () => {
  state.speed = Number($("speed").value);
  $("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
  scheduleFrame();
});
$("patternAngle").addEventListener("input", () => {
  state.patternAngle = Number($("patternAngle").value);
  $("patternAngleOut").textContent = formatDegrees(state.patternAngle);
  invalidateGeometry();
});
$("lineAngle").addEventListener("input", () => {
  state.lineAngle = Number($("lineAngle").value);
  $("lineAngleOut").textContent = formatDegrees(state.lineAngle);
  suppressStrikes = 2;
  scheduleFrame();
});
$("directionChoice").addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  state.direction = Number(button.dataset.direction) < 0 ? -1 : 1;
  for (const choice of $("directionChoice").querySelectorAll("button")) {
    setPressed(choice, choice === button);
  }
  scheduleFrame();
});
$("tilingType").addEventListener("change", () => {
  setTilingType(Number($("tilingType").value));
});
$("density").addEventListener("input", () => {
  state.density = Number($("density").value);
  invalidateGeometry();
});
$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  previousContactKeys.clear();
  suppressStrikes = 1;
  updateMappingControls(true);
  scheduleFrame();
});
$("pitchDepth").addEventListener("input", () => {
  state.pitchDepth = Number($("pitchDepth").value);
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
});
$("characterDepth").addEventListener("input", () => {
  state.characterDepth = Number($("characterDepth").value);
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
});
$("strikeLimit").addEventListener("input", () => {
  state.strikeLimit = Number($("strikeLimit").value);
  $("strikeLimitOut").textContent = String(state.strikeLimit);
});
$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  if (state.audioOn) audio.setOutput(state.output);
});
$("straightenEdges").addEventListener("click", () => {
  state.edgeCurves = tilingInfo(state.tilingType).edgeShapes.map(() => 0);
  for (let index = 0; index < MAX_EDGE_CLASSES; index += 1) {
    paintEdgeControl(index);
  }
  invalidateGeometry();
  announce("All bendable edges straightened.");
});
$("resetForm").addEventListener("click", () => {
  state.density = defaults.density;
  state.lineAngle = defaults.lineAngle;
  $("density").value = String(state.density);
  $("lineAngle").value = String(state.lineAngle);
  $("lineAngleOut").textContent = formatDegrees(state.lineAngle);
  setPosition(defaults.position);
  setTilingType(DEFAULT_TILING, false);
  announce("Lattice reset to IH20, straight edges, and a 90 degree centered line.");
});
$("resetLatticeDrums").addEventListener("click", reset);

function canvasWorldPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left - cssWidth / 2) / worldScale,
    y: -(event.clientY - bounds.top - cssHeight / 2) / worldScale,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (geometryDirty || !lattice) rebuildGeometry();
  pointerDrag = { point: canvasWorldPoint(event), phase: state.continuousPosition };
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
  setPosition(pointerDrag.phase + phaseDelta);
});
canvas.addEventListener("pointerup", () => { pointerDrag = null; });
canvas.addEventListener("pointercancel", () => { pointerDrag = null; });

window.addEventListener("keydown", (event) => {
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(event.target?.tagName || "")) return;
  if (event.code === "Space" || event.key === " ") {
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    setPosition(state.position - (event.shiftKey ? .05 : .01));
  } else if (event.key === "ArrowRight") {
    setPosition(state.position + (event.shiftKey ? .05 : .01));
  } else if (event.key === "ArrowUp") {
    state.lineAngle = wrapLineAngle(state.lineAngle + (event.shiftKey ? 1 : .1));
    $("lineAngle").value = String(state.lineAngle);
    $("lineAngleOut").textContent = formatDegrees(state.lineAngle);
    scheduleFrame();
  } else if (event.key === "ArrowDown") {
    state.lineAngle = wrapLineAngle(state.lineAngle - (event.shiftKey ? 1 : .1));
    $("lineAngle").value = String(state.lineAngle);
    $("lineAngleOut").textContent = formatDegrees(state.lineAngle);
    scheduleFrame();
  } else return;
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) setAudioState(false);
});
window.addEventListener("pageshow", scheduleFrame);
window.addEventListener("pagehide", () => {
  if (audio.context && audio.context.state !== "closed") void audio.context.close();
});

populateTilingTypes();
populateMappingModes();
new ResizeObserver(resizeCanvas).observe(stageWrap);
reset();
