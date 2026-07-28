import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  buildSolid,
  deformSolid,
  planeBasis,
  planeIntersections,
  planeNormal,
  planeOffsetForPhase,
  pickRotationTarget,
  projectPoint3,
  rotatePoint3,
} from "./src/solid.js";
import {
  SOLID_DRUM_MAPPING_MODES,
  mappedSolidDrumVoice,
  normalizedSolidContact,
  solidDrumBounds,
  solidDrumContacts,
  solidDrumVoiceIndex,
} from "./src/solid-drums.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const audio = new FmDrumAudio(globalThis);
const defaults = {
  solidType: "cube",
  position: 0.5,
  speed: 0.12,
  direction: 1,
  rotationX: -24,
  rotationY: 36,
  rotationZ: 8,
  rotationXSpeed: 0.03,
  rotationYSpeed: 0.08,
  rotationZSpeed: 0.02,
  planeYaw: 45,
  planePitch: -22,
  planeYawSpeed: 0.04,
  planePitchSpeed: 0.03,
  formScaleX: 1,
  formScaleY: 1,
  formScaleZ: 1,
  formSkewX: 0,
  formSkewZ: 0,
  mappingMode: "edge-axis",
  pitchDepth: 12,
  characterDepth: 0.7,
  strikeLimit: 6,
  output: 0.65,
};
const state = {
  ...defaults,
  continuousPosition: defaults.position,
  playing: false,
  rotationXPlaying: false,
  rotationYPlaying: false,
  rotationZPlaying: false,
  planeYawPlaying: false,
  planePitchPlaying: false,
  audioOn: false,
};
const voices = loadDrumBank();
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const lastStrikeTimes = new Map();
let previousContactKeys = new Set();
let suppressStrikesUntil = 0;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let pointer = null;
let rotationTarget = "solid";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function wrap01(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
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

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const paint = () => {
    input.value = String(state[key]);
    if (output) output.textContent = formatter(state[key]);
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
  const wrappedPosition = wrap01(state.continuousPosition);
  state.continuousPosition += state.position - wrappedPosition;
});
bindRange("speed", "speed", (value) => `${value.toFixed(2)} cyc/s`);
bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  if (state.audioOn) audio.setOutput(state.output);
});
bindRange("planeYaw", "planeYaw", (value) => `${Math.round(value)}°`);
bindRange("planePitch", "planePitch", (value) => `${Math.round(value)}°`);
bindRange("rotationX", "rotationX", (value) => `${Math.round(value)}°`);
bindRange("rotationY", "rotationY", (value) => `${Math.round(value)}°`);
bindRange("rotationZ", "rotationZ", (value) => `${Math.round(value)}°`);
for (const key of [
  "rotationXSpeed", "rotationYSpeed", "rotationZSpeed",
  "planeYawSpeed", "planePitchSpeed",
]) {
  bindRange(key, key, (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} rev/s`);
}
for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) {
  bindRange(key, key, (value) => `${value.toFixed(2)}×`);
}
for (const key of ["formSkewX", "formSkewZ"]) {
  bindRange(key, key, (value) => `${Math.round(value * 100)}%`);
}
bindRange("pitchDepth", "pitchDepth", (value) => `±${Math.round(value)} st`);
bindRange("characterDepth", "characterDepth", (value) => `${Math.round(value * 100)}%`);
bindRange("strikeLimit", "strikeLimit", (value) => String(Math.round(value)));

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
    previousContactKeys.clear();
    lastStrikeTimes.clear();
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
    announce("Solid drums audio off.");
  } else if (await enableAudio()) {
    announce("Solid drums audio on.");
  }
  scheduleFrame();
});

$("solidType").addEventListener("change", (event) => {
  state.solidType = event.currentTarget.value;
  previousContactKeys.clear();
  updateSummaries();
  announce(`${state.solidType} wireframe selected.`);
  scheduleFrame();
});

function resetSolidForm() {
  for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) state[key] = 1;
  for (const key of ["formSkewX", "formSkewZ"]) state[key] = 0;
  for (const key of ["formScaleX", "formScaleY", "formScaleZ", "formSkewX", "formSkewZ"]) {
    $(key).value = String(state[key]);
    $(`${key}Out`).textContent = key.startsWith("formScale")
      ? `${state[key].toFixed(2)}×`
      : `${Math.round(state[key] * 100)}%`;
  }
  previousContactKeys.clear();
  announce("Solid proportions reset.");
  scheduleFrame();
}

$("resetSolidForm").addEventListener("click", resetSolidForm);

function paintTransport() {
  setPressed($("playButton"), state.playing);
  const surfaceAxes = [
    state.planeYawPlaying ? "yaw" : "",
    state.planePitchPlaying ? "pitch" : "",
  ].filter(Boolean);
  $("playSummary").textContent = state.playing || surfaceAxes.length
    ? `plane · ${[state.playing ? "position" : "", ...surfaceAxes].filter(Boolean).join("+")}`
    : "plane · paused";
}

const AXIS_MOTIONS = [
  { key: "rotationXPlaying", button: "rotationXPlay", label: "X rotation" },
  { key: "rotationYPlaying", button: "rotationYPlay", label: "Y rotation" },
  { key: "rotationZPlaying", button: "rotationZPlay", label: "Z rotation" },
  { key: "planeYawPlaying", button: "planeYawPlay", label: "surface yaw" },
  { key: "planePitchPlaying", button: "planePitchPlay", label: "surface pitch" },
];

function motionIsActive() {
  return state.playing
    || state.rotationXPlaying
    || state.rotationYPlaying
    || state.rotationZPlaying
    || state.planeYawPlaying
    || state.planePitchPlaying;
}

function paintMotionControls() {
  for (const motion of AXIS_MOTIONS) {
    const button = $(motion.button);
    setPressed(button, state[motion.key]);
    button.setAttribute("aria-label", `${state[motion.key] ? "Pause" : "Play"} ${motion.label}`);
    button.querySelector("span").textContent = state[motion.key] ? "Ⅱ" : "▶";
  }
  const axes = [
    state.rotationXPlaying ? "X" : "",
    state.rotationYPlaying ? "Y" : "",
    state.rotationZPlaying ? "Z" : "",
  ].filter(Boolean);
  $("rotationSummary").textContent = axes.length ? axes.join("+") : "paused";
  paintTransport();
}

for (const motion of AXIS_MOTIONS) {
  $(motion.button).addEventListener("click", () => {
    state[motion.key] = !state[motion.key];
    lastFrameTime = performance.now();
    previousContactKeys.clear();
    paintMotionControls();
    if (state[motion.key] && !state.audioOn) void enableAudio();
    announce(`${motion.label} ${state[motion.key] ? "playing" : "paused"}.`);
    scheduleFrame();
  });
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  lastFrameTime = performance.now();
  previousContactKeys.clear();
  paintTransport();
  if (state.playing && !state.audioOn) void enableAudio();
  announce(state.playing ? "Surface playing." : "Surface paused.");
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  announce(`Surface direction ${state.direction > 0 ? "forward" : "reverse"}.`);
});

function populateMappingModes() {
  $("mappingMode").innerHTML = SOLID_DRUM_MAPPING_MODES
    .map((mode) => `<option value="${mode.id}">${mode.label}</option>`)
    .join("");
  $("mappingMode").value = state.mappingMode;
}

function renderDrumMap() {
  $("drumMap").innerHTML = voices.map((voice, index) => [
    `<span class="solid-drum-cell" data-voice-index="${index}"`,
    ` style="--voice-color:${voice.color}">`,
    `<b>${voice.name}</b><small>${voice.key.toUpperCase()}</small></span>`,
  ].join("")).join("");
}

function updateSummaries() {
  $("formSummary").textContent = state.solidType;
  const mode = SOLID_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode);
  $("mappingSummary").textContent = mode?.label.toLowerCase() ?? "custom";
  $("mappingDescription").textContent = mode?.description ?? "";
}

$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  previousContactKeys.clear();
  suppressStrikesUntil = performance.now() + 80;
  updateSummaries();
  scheduleFrame();
});

function currentRotation() {
  return { x: state.rotationX, y: state.rotationY, z: state.rotationZ };
}

function transformedSolid(rotation = currentRotation()) {
  const solid = deformSolid(buildSolid(state.solidType), {
    scaleX: state.formScaleX,
    scaleY: state.formScaleY,
    scaleZ: state.formScaleZ,
    skewX: state.formSkewX,
    skewZ: state.formSkewZ,
  });
  return {
    ...solid,
    vertices: solid.vertices.map((point) => rotatePoint3(point, rotation)),
  };
}

function currentPlane(
  phase = state.continuousPosition,
  yaw = state.planeYaw,
  pitch = state.planePitch,
  solid = null,
) {
  const normal = planeNormal(yaw, pitch);
  const radius = solid?.vertices?.length
    ? Math.max(...solid.vertices.map((point) => Math.abs(
      normal.x * point.x + normal.y * point.y + normal.z * point.z
    ))) + 0.04
    : 1.05;
  return { normal, offset: planeOffsetForPhase(phase, radius) };
}

function projectionTransform() {
  const scale = Math.min(cssWidth, cssHeight) * 0.34;
  return {
    x: (value) => cssWidth * 0.5 + value * scale,
    y: (value) => cssHeight * 0.5 - value * scale,
  };
}

function projected(point, transform) {
  const result = projectPoint3(point);
  return { ...result, canvasX: transform.x(result.x), canvasY: transform.y(result.y) };
}

function planeCorners(plane, transform) {
  const { u, v } = planeBasis(plane.normal);
  const center = {
    x: plane.normal.x * plane.offset,
    y: plane.normal.y * plane.offset,
    z: plane.normal.z * plane.offset,
  };
  const size = 1.18;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => projected({
    x: center.x + (u.x * a + v.x * b) * size,
    y: center.y + (u.y * a + v.y * b) * size,
    z: center.z + (u.z * a + v.z * b) * size,
  }, transform));
}

function drawPlane(plane, transform) {
  const corners = planeCorners(plane, transform);
  const selected = rotationTarget === "surface";
  context.beginPath();
  corners.forEach((point, index) => {
    if (index) context.lineTo(point.canvasX, point.canvasY);
    else context.moveTo(point.canvasX, point.canvasY);
  });
  context.closePath();
  context.fillStyle = selected ? "rgba(125,180,255,.12)" : "rgba(125,180,255,.055)";
  context.fill();
  context.strokeStyle = selected ? "rgba(164,204,255,.88)" : "rgba(125,180,255,.38)";
  context.lineWidth = selected ? 1.6 : 1;
  context.setLineDash([4, 6]);
  context.stroke();
  context.setLineDash([]);
  if (selected) {
    for (const point of corners) {
      context.beginPath();
      context.arc(point.canvasX, point.canvasY, 2.5, 0, TAU);
      context.fillStyle = "#a4ccff";
      context.fill();
    }
  }
}

function mappingOptions(bounds) {
  return { mode: state.mappingMode, bounds };
}

function drawScene(solid, plane, contacts, bounds) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = projectionTransform();
  drawPlane(plane, transform);
  const edges = solid.edges.map((item) => ({
    item,
    depth: (solid.vertices[item.a].z + solid.vertices[item.b].z) * 0.5,
  })).sort((a, b) => a.depth - b.depth);
  for (const { item, depth } of edges) {
    const a = projected(solid.vertices[item.a], transform);
    const b = projected(solid.vertices[item.b], transform);
    const alpha = clamp(0.35 + (depth + 1) * 0.22, 0.22, 0.86);
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    context.strokeStyle = `rgba(232,196,107,${alpha})`;
    context.lineWidth = 1.2;
    context.stroke();
  }
  for (const vertex of solid.vertices) {
    const point = projected(vertex, transform);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 2.6 * point.scale, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = "rgba(232,196,107,.66)";
    context.stroke();
  }
  for (const contact of contacts) {
    const voiceIndex = solidDrumVoiceIndex(contact, mappingOptions(bounds));
    const point = projected(contact, transform);
    context.save();
    context.shadowColor = voices[voiceIndex].color;
    context.shadowBlur = 16;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 5, 0, TAU);
    context.fillStyle = voices[voiceIndex].color;
    context.fill();
    context.strokeStyle = "#fff3d6";
    context.lineWidth = 0.7;
    context.stroke();
    context.restore();
  }
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  clearTimeout(Number(cell.dataset.clearTimer) || 0);
  const timer = setTimeout(() => cell.classList.remove("is-active"), 150);
  cell.dataset.clearTimer = String(timer);
}

function updateMappingReadout(contact, voice, bounds) {
  const normalized = normalizedSolidContact(contact, bounds);
  const axis = ["X", "Y", "Z", "DIAGONAL"][normalized.axisIndex];
  $("mappingReadout").textContent = [
    `EDGE ${(contact.edgeIndex ?? 0) + 1}`,
    `${axis} AXIS`,
    `${Math.round(normalized.incidence * 100)}% INCIDENCE`,
    `→ ${voice.name}`,
    `${Math.round(voice.frequency)} HZ`,
  ].join(" · ");
}

function triggerContacts(contacts, bounds, now) {
  if (!state.audioOn || now < suppressStrikesUntil) return;
  const onsets = contacts.filter((contact) => !previousContactKeys.has(contact.voiceKey));
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const voiceIndex = solidDrumVoiceIndex(contact, mappingOptions(bounds));
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 75) continue;
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedSolidDrumVoice(voices[voiceIndex], contact, {
      bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    updateMappingReadout(contact, voice, bounds);
    emitted += 1;
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
  for (const axis of ["X", "Y", "Z"]) {
    if (!state[`rotation${axis}Playing`]) continue;
    state[`rotation${axis}`] = normalizeDegrees(
      state[`rotation${axis}`] + state[`rotation${axis}Speed`] * 360 * delta,
    );
  }
  if (state.planeYawPlaying) {
    state.planeYaw = normalizeDegrees(state.planeYaw + state.planeYawSpeed * 360 * delta);
  }
  if (state.planePitchPlaying) {
    state.planePitch = normalizeDegrees(state.planePitch + state.planePitchSpeed * 360 * delta);
  }

  const solid = transformedSolid();
  const plane = currentPlane(state.continuousPosition, state.planeYaw, state.planePitch, solid);
  const bounds = solidDrumBounds(solid);
  const contacts = solidDrumContacts(
    planeIntersections(solid, plane.normal, plane.offset),
    solid,
    plane.normal,
  );
  drawScene(solid, plane, contacts, bounds);
  triggerContacts(contacts, bounds, now);
  previousContactKeys = new Set(contacts.map(({ voiceKey }) => voiceKey));

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["X", "Y", "Z"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  $("planeYaw").value = String(state.planeYaw);
  $("planeYawOut").textContent = `${Math.round(state.planeYaw)}°`;
  $("planePitch").value = String(state.planePitch);
  $("planePitchOut").textContent = `${Math.round(state.planePitch)}°`;
  $("stageReadout").textContent = [
    state.solidType.toUpperCase(),
    `${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"}`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");

  if (motionIsActive()) scheduleFrame();
}

function paintRotationTarget() {
  setPressed($("selectSolid"), rotationTarget === "solid");
  setPressed($("selectSurface"), rotationTarget === "surface");
  stageWrap.classList.toggle("is-surface-target", rotationTarget === "surface");
}

function selectRotationTarget(target, shouldAnnounce = true) {
  if (!target || target === rotationTarget) return;
  rotationTarget = target;
  paintRotationTarget();
  if (shouldAnnounce) announce(`${target === "surface" ? "Surface" : "Shape"} selected for 3D rotation.`);
  scheduleFrame();
}

$("selectSolid").addEventListener("click", () => selectRotationTarget("solid"));
$("selectSurface").addEventListener("click", () => selectRotationTarget("surface"));

function targetAtPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const point = {
    x: (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height),
  };
  const solid = transformedSolid();
  const plane = currentPlane(state.continuousPosition, state.planeYaw, state.planePitch, solid);
  const transform = projectionTransform();
  const solidSegments = solid.edges.map(({ a, b }) => {
    const start = projected(solid.vertices[a], transform);
    const end = projected(solid.vertices[b], transform);
    return [
      { x: start.canvasX, y: start.canvasY },
      { x: end.canvasX, y: end.canvasY },
    ];
  });
  const polygon = planeCorners(plane, transform).map((corner) => ({
    x: corner.canvasX,
    y: corner.canvasY,
  }));
  return pickRotationTarget(point, solidSegments, polygon, 12);
}

canvas.addEventListener("pointerdown", (event) => {
  if (rotationTarget !== "surface") selectRotationTarget(targetAtPointer(event), false);
  if (rotationTarget === "surface") {
    state.planeYawPlaying = false;
    state.planePitchPlaying = false;
  } else {
    state.rotationXPlaying = false;
    state.rotationYPlaying = false;
  }
  paintMotionControls();
  pointer = {
    id: event.pointerId,
    target: rotationTarget,
    x: event.clientX,
    y: event.clientY,
    rx: state.rotationX,
    ry: state.rotationY,
    yaw: state.planeYaw,
    pitch: state.planePitch,
  };
  stageWrap.classList.add("is-spinning");
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (pointer.target === "surface") {
    state.planeYaw = normalizeDegrees(pointer.yaw + (event.clientX - pointer.x) * 0.45);
    state.planePitch = normalizeDegrees(pointer.pitch - (event.clientY - pointer.y) * 0.45);
  } else {
    state.rotationY = normalizeDegrees(pointer.ry + (event.clientX - pointer.x) * 0.45);
    state.rotationX = normalizeDegrees(pointer.rx - (event.clientY - pointer.y) * 0.45);
  }
  scheduleFrame();
});

function endPointer(event) {
  if (pointer?.id !== event.pointerId) return;
  pointer = null;
  stageWrap.classList.remove("is-spinning");
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.position = wrap01(state.position - (event.shiftKey ? 0.05 : 0.01));
    state.continuousPosition = state.position;
    scheduleFrame();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    state.position = wrap01(state.position + (event.shiftKey ? 0.05 : 0.01));
    state.continuousPosition = state.position;
    scheduleFrame();
  }
});

function reset() {
  Object.assign(state, defaults, {
    continuousPosition: defaults.position,
    playing: false,
    rotationXPlaying: false,
    rotationYPlaying: false,
    rotationZPlaying: false,
    planeYawPlaying: false,
    planePitchPlaying: false,
  });
  for (const key of [
    "position", "speed", "output",
    "planeYaw", "planePitch", "planeYawSpeed", "planePitchSpeed",
    "rotationX", "rotationY", "rotationZ",
    "rotationXSpeed", "rotationYSpeed", "rotationZSpeed",
    "formScaleX", "formScaleY", "formScaleZ", "formSkewX", "formSkewZ",
    "pitchDepth", "characterDepth", "strikeLimit",
  ]) {
    $(key).value = String(state[key]);
  }
  $("solidType").value = state.solidType;
  $("mappingMode").value = state.mappingMode;
  $("positionOut").textContent = "0.0%";
  $("speedOut").textContent = `${state.speed.toFixed(2)} cyc/s`;
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("planeYawOut").textContent = `${state.planeYaw}°`;
  $("planePitchOut").textContent = `${state.planePitch}°`;
  for (const axis of ["X", "Y", "Z"]) {
    $(`rotation${axis}Out`).textContent = `${state[`rotation${axis}`]}°`;
    $(`rotation${axis}SpeedOut`).textContent = `+${state[`rotation${axis}Speed`].toFixed(2)} rev/s`;
  }
  $("planeYawSpeedOut").textContent = `+${state.planeYawSpeed.toFixed(2)} rev/s`;
  $("planePitchSpeedOut").textContent = `+${state.planePitchSpeed.toFixed(2)} rev/s`;
  for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) {
    $(`${key}Out`).textContent = `${state[key].toFixed(2)}×`;
  }
  for (const key of ["formSkewX", "formSkewZ"]) {
    $(`${key}Out`).textContent = `${Math.round(state[key] * 100)}%`;
  }
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
  $("strikeLimitOut").textContent = String(state.strikeLimit);
  $("directionButton").textContent = "Direction · forward";
  previousContactKeys.clear();
  lastStrikeTimes.clear();
  suppressStrikesUntil = performance.now() + 80;
  if (state.audioOn) audio.setOutput(state.output);
  paintMotionControls();
  updateSummaries();
  announce("Solid Drum Machine reset.");
  scheduleFrame();
}

$("resetSolidDrums").addEventListener("click", reset);

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
updateSummaries();
paintMotionControls();
paintRotationTarget();
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();
