import { projectPoint3, rotatePoint3 } from "./src/solid.js";
import {
  hyperplaneIntersections,
  hyperplaneOffsetForPhase,
  projectPoint4,
  transformedHyperShape,
} from "./src/hyper.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  HYPER_DRUM_MAPPING_MODES,
  hyperContactVoiceKey,
  hyperDrumVoiceIndex,
  mappedHyperDrumVoice,
  normalizedHyperContact,
} from "./src/hyper-drums.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const audio = new FmDrumAudio(globalThis);
const defaults = Object.freeze({
  shapeType: "tesseract",
  position: 0.5,
  speed: 0.1,
  direction: 1,
  rotationXW: 24,
  rotationYW: -18,
  rotationZW: 12,
  rotationXWSpeed: 0.06,
  rotationYWSpeed: 0.04,
  rotationZWSpeed: -0.02,
  hyperScaleX: 1,
  hyperScaleY: 1,
  hyperScaleZ: 1,
  hyperScaleW: 1,
  mappingMode: "axis-depth",
  pitchDepth: 12,
  characterDepth: 0.7,
  strikeLimit: 6,
  output: 0.65,
});
const state = {
  ...defaults,
  continuousPosition: defaults.position,
  playing: false,
  rotationXWPlaying: false,
  rotationYWPlaying: false,
  rotationZWPlaying: false,
  audioOn: false,
};
const voices = loadDrumBank();
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const previousContactKeys = new Set();
const lastStrikeTimes = new Map();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let suppressStrikeFrames = 2;
let canvasDrag = null;

const SHAPE_LABELS = Object.freeze({
  tesseract: "Tesseract",
  hypersphere: "Hypersphere",
  hyperpyramid: "Hyperpyramid",
  klein: "Klein bottle",
});

function clamp(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(numeric) ? numeric : minimum,
  ));
}

function wrap01(value) {
  return ((Number(value) % 1) + 1) % 1;
}

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice) => {
      const saved = stored.find((candidate) => candidate?.id === voice.id);
      return sanitizeFmDrumVoice({
        ...voice,
        ...saved,
        id: voice.id,
        key: voice.key,
      });
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

function clearContactHistory(suppressFrames = 1) {
  previousContactKeys.clear();
  suppressStrikeFrames = Math.max(suppressStrikeFrames, suppressFrames);
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

bindRange("position", "position", (value) => `${((value * 2 - 1) * 100).toFixed(1)}%`, () => {
  const current = wrap01(state.continuousPosition);
  state.continuousPosition += state.position - current;
  clearContactHistory(1);
});
bindRange("speed", "speed", (value) => `${value.toFixed(2)} cyc/s`);
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
for (const axis of ["XW", "YW", "ZW"]) {
  bindRange(
    `rotation${axis}`,
    `rotation${axis}`,
    (value) => `${Math.round(value)}°`,
    () => clearContactHistory(1),
  );
  bindRange(
    `rotation${axis}Speed`,
    `rotation${axis}Speed`,
    (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} rev/s`,
  );
}
for (const axis of ["X", "Y", "Z", "W"]) {
  bindRange(
    `hyperScale${axis}`,
    `hyperScale${axis}`,
    (value) => `${value.toFixed(2)}×`,
    () => clearContactHistory(2),
  );
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
    clearContactHistory(0);
    suppressStrikeFrames = 0;
    scheduleFrame();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Hyper drums audio off.");
  } else if (await enableAudio()) {
    announce("Hyper drums audio on.");
  }
  scheduleFrame();
});

function rotationIsMoving() {
  return state.rotationXWPlaying
    || state.rotationYWPlaying
    || state.rotationZWPlaying;
}

function paintPlayback() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    state.playing ? "Pause hyperplane" : "Play hyperplane",
  );
  $("playSummary").textContent = `W plane · ${state.playing ? "playing" : "paused"}`;
}

function paintRotation() {
  const axes = [];
  for (const axis of ["XW", "YW", "ZW"]) {
    const playing = state[`rotation${axis}Playing`];
    const button = $(`rotation${axis}Play`);
    setPressed(button, playing);
    button.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${axis} rotation`);
    button.querySelector("span").textContent = playing ? "Ⅱ" : "▶";
    if (playing) axes.push(axis);
  }
  $("rotationSummary").textContent = axes.length ? axes.join("+") : "paused";
}

function paintRotationAxes() {
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  paintRotation();
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  lastFrameTime = performance.now();
  previousContactKeys.clear();
  suppressStrikeFrames = 0;
  paintPlayback();
  if (state.playing && !state.audioOn) void enableAudio();
  announce(state.playing ? "Hyperplane playing." : "Hyperplane paused.");
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  announce(`Hyperplane direction ${state.direction > 0 ? "forward" : "reverse"}.`);
});

for (const axis of ["XW", "YW", "ZW"]) {
  $(`rotation${axis}Play`).addEventListener("click", () => {
    state[`rotation${axis}Playing`] = !state[`rotation${axis}Playing`];
    lastFrameTime = performance.now();
    previousContactKeys.clear();
    suppressStrikeFrames = 0;
    paintRotation();
    if (state[`rotation${axis}Playing`] && !state.audioOn) void enableAudio();
    scheduleFrame();
  });
}

$("hyperShape").addEventListener("change", () => {
  state.shapeType = $("hyperShape").value;
  $("formSummary").textContent = SHAPE_LABELS[state.shapeType] ?? "Tesseract";
  lastStrikeTimes.clear();
  clearContactHistory(2);
  scheduleFrame();
});

$("resetHyperForm").addEventListener("click", () => {
  for (const axis of ["X", "Y", "Z", "W"]) {
    state[`hyperScale${axis}`] = 1;
    $(`hyperScale${axis}`).value = "1";
    $(`hyperScale${axis}Out`).textContent = "1.00×";
  }
  clearContactHistory(2);
  announce("Hyper form reset.");
  scheduleFrame();
});

function populateMappingModes() {
  $("mappingMode").innerHTML = HYPER_DRUM_MAPPING_MODES
    .map((mode) => `<option value="${mode.id}">${mode.label}</option>`)
    .join("");
  $("mappingMode").value = state.mappingMode;
}

function updateMappingSummary() {
  const mode = HYPER_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode);
  $("mappingSummary").textContent = mode?.label.toLowerCase() ?? "custom";
  $("mappingDescription").textContent = mode?.description ?? "";
}

$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  clearContactHistory(1);
  updateMappingSummary();
  scheduleFrame();
});

function renderDrumMap() {
  $("drumMap").innerHTML = voices.map((voice, index) => [
    `<span class="hyper-drum-cell" data-voice-index="${index}"`,
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

function rotation(overrides = {}) {
  return {
    xw: overrides.xw ?? state.rotationXW,
    yw: overrides.yw ?? state.rotationYW,
    zw: overrides.zw ?? state.rotationZW,
    xy: 16,
    yz: -9,
  };
}

function hyperForm() {
  return {
    x: state.hyperScaleX,
    y: state.hyperScaleY,
    z: state.hyperScaleZ,
    w: state.hyperScaleW,
  };
}

function currentHyperShape() {
  return transformedHyperShape(state.shapeType, rotation(), hyperForm());
}

function currentHyperplaneOffset() {
  return hyperplaneOffsetForPhase(
    state.continuousPosition,
    1.25 * state.hyperScaleW,
  );
}

function viewPoint(point) {
  const fourProjected = projectPoint4(point);
  const viewed = rotatePoint3(fourProjected, { x: -16, y: 27, z: 0 });
  return { ...projectPoint3(viewed, 3.8), w: point.w };
}

function canvasPoint(point) {
  const projected = viewPoint(point);
  const scale = Math.min(cssWidth, cssHeight) * 0.31;
  return {
    ...projected,
    canvasX: cssWidth * 0.5 + projected.x * scale,
    canvasY: cssHeight * 0.5 - projected.y * scale,
  };
}

function boundsForShape(shape) {
  const viewed = shape.vertices.map(viewPoint);
  const bounds = {
    minX: Math.min(...viewed.map(({ x }) => x)),
    maxX: Math.max(...viewed.map(({ x }) => x)),
    minY: Math.min(...viewed.map(({ y }) => y)),
    maxY: Math.max(...viewed.map(({ y }) => y)),
    minDepth: Math.min(...viewed.map(({ z }) => z)),
    maxDepth: Math.max(...viewed.map(({ z }) => z)),
    minW: Math.min(...shape.vertices.map(({ w }) => w)),
    maxW: Math.max(...shape.vertices.map(({ w }) => w)),
  };
  for (const pair of [
    ["minX", "maxX"],
    ["minY", "maxY"],
    ["minDepth", "maxDepth"],
    ["minW", "maxW"],
  ]) {
    if (Math.abs(bounds[pair[1]] - bounds[pair[0]]) < 1e-8) {
      bounds[pair[0]] -= 1;
      bounds[pair[1]] += 1;
    }
  }
  return bounds;
}

function enrichContacts(shape, contacts) {
  return contacts.map((contact) => {
    const edge = shape.edges[contact.edgeIndex];
    const pointA = shape.vertices[edge.a];
    const pointB = shape.vertices[edge.b];
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const dz = pointB.z - pointA.z;
    const dw = pointB.w - pointA.w;
    const viewed = viewPoint(contact);
    return {
      ...contact,
      projectedX: viewed.x,
      projectedY: viewed.y,
      projectedDepth: viewed.z,
      incidence: clamp(Math.abs(dw) / Math.max(1e-9, Math.hypot(dx, dy, dz, dw))),
      voiceKey: hyperContactVoiceKey(contact),
    };
  });
}

function mappingOptions(bounds) {
  return {
    mode: state.mappingMode,
    bounds,
  };
}

function drawScene(shape, contacts, offset, bounds) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const edges = shape.edges.map((edge) => ({
    ...edge,
    depth: (
      viewPoint(shape.vertices[edge.a]).z
      + viewPoint(shape.vertices[edge.b]).z
    ) * 0.5,
  })).sort((first, second) => first.depth - second.depth);

  for (const edge of edges) {
    const a = canvasPoint(shape.vertices[edge.a]);
    const b = canvasPoint(shape.vertices[edge.b]);
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    const wAxis = edge.axis === "w";
    context.strokeStyle = wAxis
      ? "rgba(199,155,255,.72)"
      : "rgba(232,196,107,.45)";
    context.lineWidth = wAxis ? 1.35 : 1;
    if (wAxis) context.setLineDash([3, 4]);
    context.stroke();
    context.setLineDash([]);
  }

  const planeY = cssHeight * (0.5 - offset * 0.08);
  const gradient = context.createLinearGradient?.(0, planeY, cssWidth, planeY);
  if (gradient) {
    gradient.addColorStop(0, "rgba(199,155,255,0)");
    gradient.addColorStop(0.5, "rgba(199,155,255,.34)");
    gradient.addColorStop(1, "rgba(199,155,255,0)");
  }
  context.beginPath();
  context.moveTo(cssWidth * 0.15, planeY);
  context.lineTo(cssWidth * 0.85, planeY);
  context.strokeStyle = gradient || "rgba(199,155,255,.3)";
  context.lineWidth = 1;
  context.stroke();

  for (const vertex of shape.vertices) {
    const point = canvasPoint(vertex);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 2.5, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = vertex.w >= offset
      ? "rgba(199,155,255,.7)"
      : "rgba(232,196,107,.55)";
    context.stroke();
  }

  for (const contact of contacts) {
    const point = canvasPoint(contact);
    const voiceIndex = hyperDrumVoiceIndex(contact, mappingOptions(bounds));
    context.save();
    context.shadowColor = voices[voiceIndex].color;
    context.shadowBlur = 16;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 4.5, 0, TAU);
    context.fillStyle = voices[voiceIndex].color;
    context.fill();
    context.strokeStyle = "#fff3d6";
    context.lineWidth = 0.7;
    context.stroke();
    context.restore();
  }
}

function evenlySelect(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => (
    items[Math.floor(index * items.length / limit)]
  ));
}

function updateMappingReadout(contact, voice, bounds) {
  const normalized = normalizedHyperContact(contact, bounds);
  $("mappingReadout").textContent = [
    `${String(contact.axis || "4D").toUpperCase()} EDGE`,
    `${Math.round(normalized.depth * 100)}% DEPTH`,
    `→ ${voice.name}`,
    `${Math.round(voice.frequency)} HZ`,
  ].join(" · ");
}

function triggerContacts(contacts, now, bounds, moving) {
  if (!state.audioOn || !moving || suppressStrikeFrames > 0) return;
  const onsets = contacts.filter(({ voiceKey }) => !previousContactKeys.has(voiceKey));
  const selected = evenlySelect(onsets, Math.round(state.strikeLimit));
  for (const contact of selected) {
    const voiceIndex = hyperDrumVoiceIndex(contact, mappingOptions(bounds));
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 75) continue;
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedHyperDrumVoice(voices[voiceIndex], contact, {
      bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    updateMappingReadout(contact, voice, bounds);
  }
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  scheduleFrame();
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = wrap01(state.continuousPosition);
  }
  for (const axis of ["XW", "YW", "ZW"]) {
    if (!state[`rotation${axis}Playing`]) continue;
    state[`rotation${axis}`] = normalizeDegrees(
      state[`rotation${axis}`]
        + state[`rotation${axis}Speed`] * 360 * delta,
    );
  }

  const shape = currentHyperShape();
  const offset = currentHyperplaneOffset();
  const bounds = boundsForShape(shape);
  const contacts = enrichContacts(
    shape,
    hyperplaneIntersections(shape, offset),
  );
  const moving = state.playing || rotationIsMoving() || Boolean(canvasDrag);
  triggerContacts(contacts, now, bounds, moving);
  previousContactKeys.clear();
  for (const { voiceKey } of contacts) previousContactKeys.add(voiceKey);
  if (suppressStrikeFrames > 0) suppressStrikeFrames -= 1;
  drawScene(shape, contacts, offset, bounds);

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  const shapeLabel = (SHAPE_LABELS[state.shapeType] ?? "Tesseract").toUpperCase();
  const motion = [
    state.playing ? "W PLANE" : "",
    rotationIsMoving() ? "ROTATION" : "",
    canvasDrag ? "DRAG" : "",
  ].filter(Boolean).join(" + ") || "PAUSED";
  $("stageReadout").textContent = [
    shapeLabel,
    `${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"}`,
    motion,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  if (moving) scheduleFrame();
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
  state.rotationXWPlaying = false;
  state.rotationYWPlaying = false;
  canvasDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    rotationXW: state.rotationXW,
    rotationYW: state.rotationYW,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.add("is-spinning");
  paintRotation();
  scheduleFrame();
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  const bounds = canvas.getBoundingClientRect();
  const horizontal = (event.clientX - canvasDrag.startX) / Math.max(1, bounds.width);
  const vertical = (event.clientY - canvasDrag.startY) / Math.max(1, bounds.height);
  state.rotationYW = normalizeDegrees(canvasDrag.rotationYW + horizontal * 240);
  state.rotationXW = normalizeDegrees(canvasDrag.rotationXW - vertical * 240);
  paintRotationAxes();
  scheduleFrame();
  event.preventDefault();
});

function finishCanvasDrag(event) {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  canvasDrag = null;
  stageWrap.classList.remove("is-spinning");
  paintRotationAxes();
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishCanvasDrag);
canvas.addEventListener("pointercancel", finishCanvasDrag);
canvas.addEventListener("lostpointercapture", finishCanvasDrag);

function setPosition(value) {
  state.position = wrap01(value);
  state.continuousPosition = state.position;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  clearContactHistory(1);
  scheduleFrame();
}

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

function reset() {
  Object.assign(state, defaults, {
    continuousPosition: defaults.position,
    playing: false,
    rotationXWPlaying: false,
    rotationYWPlaying: false,
    rotationZWPlaying: false,
  });
  for (const key of [
    "position",
    "speed",
    "output",
    "pitchDepth",
    "characterDepth",
    "strikeLimit",
    "rotationXW",
    "rotationYW",
    "rotationZW",
    "rotationXWSpeed",
    "rotationYWSpeed",
    "rotationZWSpeed",
    "hyperScaleX",
    "hyperScaleY",
    "hyperScaleZ",
    "hyperScaleW",
  ]) {
    $(key).value = String(state[key]);
  }
  $("positionOut").textContent = "0.0%";
  $("speedOut").textContent = "0.10 cyc/s";
  $("outputOut").textContent = "65%";
  $("pitchDepthOut").textContent = "±12 st";
  $("characterDepthOut").textContent = "70%";
  $("strikeLimitOut").textContent = "6";
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
    const speed = state[`rotation${axis}Speed`];
    $(`rotation${axis}SpeedOut`).textContent = `${speed >= 0 ? "+" : ""}${speed.toFixed(2)} rev/s`;
  }
  for (const axis of ["X", "Y", "Z", "W"]) {
    $(`hyperScale${axis}Out`).textContent = "1.00×";
  }
  $("hyperShape").value = state.shapeType;
  $("formSummary").textContent = SHAPE_LABELS[state.shapeType];
  $("mappingMode").value = state.mappingMode;
  $("directionButton").textContent = "Direction · forward";
  paintPlayback();
  paintRotation();
  updateMappingSummary();
  lastStrikeTimes.clear();
  clearContactHistory(2);
  if (state.audioOn) audio.setOutput(state.output);
  announce("Hyper Drum Machine reset.");
  scheduleFrame();
}

$("resetHyperDrums").addEventListener("click", reset);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) setAudioState(false);
  else scheduleFrame();
});
window.addEventListener("pageshow", scheduleFrame);
window.addEventListener("pagehide", () => {
  if (audio.context && audio.context.state !== "closed") void audio.context.close();
});

populateMappingModes();
renderDrumMap();
paintPlayback();
paintRotation();
updateMappingSummary();
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();
reset();
