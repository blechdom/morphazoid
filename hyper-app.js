import {
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  normalizeStrikeGains,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import { projectPoint3, rotatePoint3 } from "./src/solid.js";
import {
  crossedHyperplaneLoop,
  crossedHyperplaneVertex,
  hyperplaneIntersections,
  hyperplaneOffsetForShapePhase,
  hyperplaneWRange,
  projectPoint4,
  transformedHyperShape,
} from "./src/hyper.js";
import { createAmplitudeControl } from "./src/amplitude-control.js";
import { installShapesNativeBridge } from "./src/shapes-native-bridge.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_HYPER_VOICES = 20;
const MAX_CORNER_STRIKES = 16;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const pool = new VoicePool(32, { continuousPeakCeiling: 0.78 });
const amplitudeControl = createAmplitudeControl($("amplitudeControl"), { onChange: scheduleFrame });
const state = {
  shapeType: "tesseract",
  profileSides: 4,
  profileShapeType: "polygon",
  profileStarDepth: 0.48,
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.1,
  direction: 1,
  playing: false,
  rotationXW: 24,
  rotationYW: -18,
  rotationZW: 12,
  rotationXWPlaying: false,
  rotationYWPlaying: false,
  rotationZWPlaying: false,
  rotationXWSpeed: 0.06,
  rotationYWSpeed: 0.04,
  rotationZWSpeed: -0.02,
  hyperScaleX: 1,
  hyperScaleY: 1,
  hyperScaleZ: 1,
  hyperScaleW: 1,
  audio: false,
  soundMode: "sine",
  level: 0.6,
  baseFrequency: 82,
  pitchRange: 4,
  fmIndex: 3.5,
  fmRatio: 1.5,
  percussionAttack: 3,
  percussionDecay: 120,
};
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let shapesHostParked = false;
let lastFrameTime = performance.now();
let lastAudioTime = null;
let previousSigns = null;
let canvasDrag = null;

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function scheduleFrame() {
  if (shapesHostParked) return;
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
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
  scheduleFrame();
}
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  input.value = String(state[key]);
  const update = () => { output.textContent = formatter(state[key]); };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    update();
    afterChange?.();
    scheduleFrame();
  });
  update();
}

bindRange("position", "position", (value) => `${((value * 2 - 1) * 100).toFixed(1)}%`, () => {
  const current = ((state.continuousPosition % 1) + 1) % 1;
  state.continuousPosition += state.position - current;
  previousSigns = null;
});
bindRange("speed", "speed", (value) => `${value.toFixed(2)} cyc/s`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
for (const axis of ["XW", "YW", "ZW"]) {
  bindRange(`rotation${axis}`, `rotation${axis}`, (value) => `${Math.round(value)}°`, () => { previousSigns = null; });
  bindRange(
    `rotation${axis}Speed`,
    `rotation${axis}Speed`,
    (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} rev/s`,
  );
}
for (const axis of ["X", "Y", "Z", "W"]) {
  bindRange(`hyperScale${axis}`, `hyperScale${axis}`, (value) => `${value.toFixed(2)}×`, () => {
    previousSigns = null;
  });
}
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);
bindRange("percussionAttack", "percussionAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("percussionDecay", "percussionDecay", (value) => `${Math.round(value)} ms`);

const SHAPE_LABELS = {
  tesseract: "Tesseract",
  hypersphere: "Hypersphere",
  hyperpyramid: "Hyperpyramid",
  klein: "Klein bottle",
  profile: "Profile hyperprism",
};

$("hyperShape").addEventListener("change", (event) => {
  state.shapeType = event.currentTarget.value;
  $("formSummary").textContent = SHAPE_LABELS[state.shapeType] ?? "Tesseract";
  previousSigns = null;
  pool.silence();
  scheduleFrame();
});

$("resetHyperForm").addEventListener("click", () => {
  for (const axis of ["X", "Y", "Z", "W"]) {
    state[`hyperScale${axis}`] = 1;
    $(`hyperScale${axis}`).value = "1";
    $(`hyperScale${axis}Out`).textContent = "1.00×";
  }
  previousSigns = null;
  pool.silence();
  scheduleFrame();
});

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  $("playSummary").textContent = `W plane · ${state.playing ? "playing" : "paused"}`;
  if (!state.playing && !rotationIsMoving()) pool.silence();
  resetClocks();
  scheduleFrame();
});
$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  scheduleFrame();
});

function rotationIsMoving() {
  return state.rotationXWPlaying || state.rotationYWPlaying || state.rotationZWPlaying;
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

for (const axis of ["XW", "YW", "ZW"]) {
  $(`rotation${axis}Play`).addEventListener("click", () => {
    state[`rotation${axis}Playing`] = !state[`rotation${axis}Playing`];
    previousSigns = null;
    paintRotation();
    resetClocks();
    if (!state.playing && !rotationIsMoving()) pool.silence();
    scheduleFrame();
  });
}

function paintRotationAxes() {
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  paintRotation();
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
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  const bounds = canvas.getBoundingClientRect();
  const horizontal = (event.clientX - canvasDrag.startX) / Math.max(1, bounds.width);
  const vertical = (event.clientY - canvasDrag.startY) / Math.max(1, bounds.height);
  state.rotationYW = normalizeDegrees(canvasDrag.rotationYW + horizontal * 240);
  state.rotationXW = normalizeDegrees(canvasDrag.rotationXW - vertical * 240);
  previousSigns = null;
  paintRotationAxes();
  scheduleFrame();
  event.preventDefault();
});

function finishCanvasDrag(event) {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  canvasDrag = null;
  stageWrap.classList.remove("is-spinning");
  paintRotationAxes();
}

canvas.addEventListener("pointerup", finishCanvasDrag);
canvas.addEventListener("pointercancel", finishCanvasDrag);
canvas.addEventListener("lostpointercapture", finishCanvasDrag);

$("soundMode").addEventListener("change", (event) => {
  state.soundMode = event.currentTarget.value;
  $("soundSummary").textContent = state.soundMode.toUpperCase();
  $("fmControls").hidden = !["fm", "pm"].includes(state.soundMode);
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  amplitudeControl.setVisible(state.soundMode !== "percussion");
  pool.silence();
  previousSigns = null;
  scheduleFrame();
});

$("audioButton").addEventListener("click", async () => {
  $("audioError").hidden = true;
  if (state.audio) {
    state.audio = false;
    pool.disable();
  } else {
    try {
      $("audioState").textContent = "off";
      await pool.enable();
      pool.setLevel(state.level);
      state.audio = true;
      resetClocks();
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  scheduleFrame();
});

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
    profile: {
      sides: state.profileSides,
      shapeType: state.profileShapeType,
      starDepth: state.profileStarDepth,
    },
  };
}

document.addEventListener("morphazoid:shapes-profile", (event) => {
  const profile = event.detail ?? {};
  state.profileSides = Math.round(clamp(profile.sides, 1, 32));
  state.profileShapeType = profile.kind === "star" ? "star" : "polygon";
  state.profileStarDepth = clamp(profile.starDepth, 0.05, 0.82);
  state.shapeType = "profile";
  $("hyperShape").value = "profile";
  $("formSummary").textContent = `${state.profileSides}-point ${state.profileShapeType} hyperprism`;
  previousSigns = null;
  scheduleFrame();
});

function currentHyperShape(nextRotation = rotation()) {
  return transformedHyperShape(state.shapeType, nextRotation, hyperForm());
}

function currentHyperplaneOffset(shape, phase = state.continuousPosition) {
  return hyperplaneOffsetForShapePhase(shape, phase);
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

function drawScene(tesseract, contacts, offset) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const edges = tesseract.edges.map((edge) => ({
    ...edge,
    depth: (viewPoint(tesseract.vertices[edge.a]).z + viewPoint(tesseract.vertices[edge.b]).z) * 0.5,
  })).sort((a, b) => a.depth - b.depth);
  for (const edge of edges) {
    const a = canvasPoint(tesseract.vertices[edge.a]);
    const b = canvasPoint(tesseract.vertices[edge.b]);
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    const isHiddenAxis = edge.axis === "w";
    context.strokeStyle = isHiddenAxis ? "rgba(199,155,255,.7)" : "rgba(232,196,107,.48)";
    context.lineWidth = isHiddenAxis ? 1.35 : 1;
    if (isHiddenAxis) context.setLineDash([3, 4]);
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

  for (const vertex of tesseract.vertices) {
    const point = canvasPoint(vertex);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 2.5, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = vertex.w >= offset ? "rgba(199,155,255,.7)" : "rgba(232,196,107,.55)";
    context.stroke();
  }
  for (const contact of contacts) {
    const point = canvasPoint(contact);
    context.save();
    context.shadowColor = "#c79bff";
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 5, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.restore();
  }
}

function contactVoice(contact, index) {
  const projected = viewPoint(contact);
  const pitch = clamp((projected.y + 1.2) / 2.4, 0, 1);
  const drive = clamp((contact.w + 1.25) / 2.5, 0, 1);
  return {
    key: `hyper:${contact.edgeIndex ?? index}`,
    frequency: pitch01ToFrequency(pitch, state.baseFrequency, state.pitchRange),
    gain: amplitudeControl.sample(contact.t ?? 0, 0.18 + 0.64 * (contact.cornerStrength ?? 0)),
    pan: clamp(projected.x, -1, 1),
    waveform: "sine",
    ...synthParametersForMode(state.soundMode, drive, {
      fmIndex: state.fmIndex,
      fmRatio: state.fmRatio,
      pmIndex: state.fmIndex * 0.7,
      pmRatio: state.fmRatio,
      shepardRate: state.playing ? state.speed * state.direction : 0,
      shepardWidth: 5,
    }),
  };
}

function evenlySelect(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => (
    items[Math.floor(index * items.length / limit)]
  ));
}

function emitCorners(tesseract, offset) {
  const signs = tesseract.vertices.map((point) => point.w - offset);
  if (state.audio && state.soundMode === "percussion" && previousSigns) {
    const intents = [];
    signs.forEach((sign, index) => {
      if (!crossedHyperplaneVertex(previousSigns[index], sign)) return;
      const point = tesseract.vertices[index];
      const projected = viewPoint(point);
      intents.push({
        key: `hyper:corner:${index}`,
        frequency: pitch01ToFrequency(clamp((projected.y + 1.2) / 2.4, 0, 1), state.baseFrequency, state.pitchRange),
        gain: 0.34,
        pan: clamp(projected.x, -1, 1),
        waveform: "sine",
      });
    });
    normalizeStrikeGains(
      evenlySelect(intents, MAX_CORNER_STRIKES),
      0.78,
    ).forEach((spec) => pool.strike(spec, {
      attackSeconds: cornerAttackSeconds(state.percussionAttack),
      decaySeconds: cornerDecaySeconds(state.percussionDecay),
    }));
  }
  previousSigns = signs;
}

function transportDelta(now) {
  const perfDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running" ? pool.context.currentTime : null;
  const audioDelta = Number.isFinite(audioTime) && Number.isFinite(lastAudioTime) && audioTime >= lastAudioTime
    ? audioTime - lastAudioTime
    : 0;
  lastAudioTime = Number.isFinite(audioTime) ? audioTime : null;
  return Math.min(1, audioDelta > 1e-6 ? audioDelta : perfDelta);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  const previousPosition = state.continuousPosition;
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = ((state.continuousPosition % 1) + 1) % 1;
  }
  const looped = state.playing && crossedHyperplaneLoop(
    previousPosition,
    state.continuousPosition,
  );
  for (const axis of ["XW", "YW", "ZW"]) {
    if (!state[`rotation${axis}Playing`]) continue;
    state[`rotation${axis}`] = normalizeDegrees(
      state[`rotation${axis}`] + state[`rotation${axis}Speed`] * 360 * delta,
    );
  }

  const tesseract = currentHyperShape();
  const offset = currentHyperplaneOffset(tesseract);
  const contacts = hyperplaneIntersections(tesseract, offset);
  drawScene(tesseract, contacts, offset);
  const moving = state.playing || rotationIsMoving();
  if (moving) {
    if (looped) {
      const { minW, maxW } = hyperplaneWRange(tesseract);
      const entryOffset = state.direction > 0 ? minW : maxW;
      previousSigns = tesseract.vertices.map((point) => point.w - entryOffset);
    }
    emitCorners(tesseract, offset);
  }
  const continuous = state.soundMode !== "percussion";
  const voicedContacts = evenlySelect(contacts, MAX_HYPER_VOICES);
  const voices = continuous ? voicedContacts.map(contactVoice) : [];
  if (state.audio) {
    if (continuous && moving) {
      const lookahead = 0.075;
      const futurePhase = state.continuousPosition + (state.playing ? state.direction * state.speed * lookahead : 0);
      const future = currentHyperShape(rotation({
        xw: state.rotationXW + (state.rotationXWPlaying ? state.rotationXWSpeed * 360 * lookahead : 0),
        yw: state.rotationYW + (state.rotationYWPlaying ? state.rotationYWSpeed * 360 * lookahead : 0),
        zw: state.rotationZW + (state.rotationZWPlaying ? state.rotationZWSpeed * 360 * lookahead : 0),
      }));
      const futureContacts = hyperplaneIntersections(
        future,
        currentHyperplaneOffset(future, futurePhase),
      );
      const futureVoices = evenlySelect(futureContacts, MAX_HYPER_VOICES).map(contactVoice);
      pool.setVoiceTrajectory(voices, futureVoices, lookahead);
    } else pool.setVoices([]);
  }

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  const shapeLabel = (SHAPE_LABELS[state.shapeType] ?? "Tesseract").toUpperCase();
  $("stageReadout").textContent = `${shapeLabel} · ${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"} · ${state.audio ? `${moving && continuous ? voices.length : pool.activeStrikeCount} VOICES` : "AUDIO OFF"}`;
  if (moving) scheduleFrame();
}

document.addEventListener("visibilitychange", () => document.hidden ? pool.silence() : scheduleFrame());

function bridgeRange(id, value) {
  const input = $(id);
  if (!input || !Number.isFinite(Number(value))) return;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function sharedProfileForHyper() {
  if (state.shapeType === "profile") {
    return {
      sides: state.profileSides,
      kind: state.profileSides === 1
        ? "circle"
        : state.profileSides === 2 ? "line" : state.profileShapeType,
      starDepth: state.profileStarDepth,
      lift: "prism",
    };
  }
  if (state.shapeType === "hypersphere") {
    return { sides: 1, kind: "circle", starDepth: 0.48, lift: "round" };
  }
  if (state.shapeType === "tesseract") {
    return { sides: 4, kind: "polygon", starDepth: 0.48, lift: "prism" };
  }
  return { sides: 4, kind: "polygon", starDepth: 0.48, lift: "local" };
}

function applySharedProfile(profile = {}) {
  if (profile.lift === "local") return;
  const sides = Math.round(clamp(profile.sides, 1, 32));
  if (profile.kind === "circle" || sides === 1) {
    state.shapeType = "hypersphere";
    $("hyperShape").value = "hypersphere";
    $("formSummary").textContent = SHAPE_LABELS.hypersphere;
    return;
  }
  state.profileSides = sides;
  state.profileShapeType = profile.kind === "star" ? "star" : "polygon";
  state.profileStarDepth = clamp(profile.starDepth, 0.05, 0.82);
  state.shapeType = "profile";
  $("hyperShape").value = "profile";
  $("formSummary").textContent = `${sides}-point ${state.profileShapeType} hyperprism`;
}

function hyperDimensionState() {
  return {
    shapeType: state.shapeType,
    profileSides: state.profileSides,
    profileShapeType: state.profileShapeType,
    profileStarDepth: state.profileStarDepth,
    hyperScaleX: state.hyperScaleX,
    hyperScaleY: state.hyperScaleY,
    hyperScaleZ: state.hyperScaleZ,
    hyperScaleW: state.hyperScaleW,
    rotationXW: state.rotationXW,
    rotationYW: state.rotationYW,
    rotationZW: state.rotationZW,
    rotationXWPlaying: state.rotationXWPlaying,
    rotationYWPlaying: state.rotationYWPlaying,
    rotationZWPlaying: state.rotationZWPlaying,
    rotationXWSpeed: state.rotationXWSpeed,
    rotationYWSpeed: state.rotationYWSpeed,
    rotationZWSpeed: state.rotationZWSpeed,
  };
}

function applyHyperDimensionState(dimension = {}) {
  if (!dimension || !Object.keys(dimension).length) return;
  const shapeTypes = new Set(["tesseract", "hypersphere", "hyperpyramid", "klein", "profile"]);
  if (shapeTypes.has(dimension.shapeType)) {
    state.shapeType = dimension.shapeType;
    $("hyperShape").value = state.shapeType;
    $("formSummary").textContent = SHAPE_LABELS[state.shapeType] ?? "Tesseract";
  }
  if (Number.isFinite(Number(dimension.profileSides))) {
    state.profileSides = Math.round(clamp(dimension.profileSides, 1, 32));
  }
  state.profileShapeType = dimension.profileShapeType === "star" ? "star" : "polygon";
  if (Number.isFinite(Number(dimension.profileStarDepth))) {
    state.profileStarDepth = clamp(dimension.profileStarDepth, 0.05, 0.82);
  }
  for (const key of ["hyperScaleX", "hyperScaleY", "hyperScaleZ", "hyperScaleW"]) {
    bridgeRange(key, dimension[key]);
  }
  for (const axis of ["XW", "YW", "ZW"]) {
    bridgeRange(`rotation${axis}`, dimension[`rotation${axis}`]);
    bridgeRange(`rotation${axis}Speed`, dimension[`rotation${axis}Speed`]);
    const playing = dimension[`rotation${axis}Playing`];
    if (typeof playing === "boolean") state[`rotation${axis}Playing`] = playing;
  }
  paintRotation();
}

function resetShapesBank(bank) {
  if (bank === "form") {
    $("resetHyperForm").click();
    return true;
  }

  if (bank === "play") {
    state.playing = false;
    state.position = 0.5;
    state.continuousPosition = 0.5;
    state.speed = 0.1;
    state.direction = 1;
    bridgeRange("position", state.position);
    bridgeRange("speed", state.speed);
    $("directionButton").textContent = "Direction · forward";
    setPressed($("playButton"), false);
    $("playSummary").textContent = "W plane · paused";
    previousSigns = null;
    resetClocks();
    if (!rotationIsMoving()) pool.silence();
    $("liveStatus").textContent = "Play controls reset.";
    scheduleFrame();
    return true;
  }

  if (bank === "rotation") {
    for (const [axis, angle, speed] of [
      ["XW", 24, 0.06],
      ["YW", -18, 0.04],
      ["ZW", 12, -0.02],
    ]) {
      state[`rotation${axis}`] = angle;
      state[`rotation${axis}Speed`] = speed;
      state[`rotation${axis}Playing`] = false;
      bridgeRange(`rotation${axis}`, angle);
      bridgeRange(`rotation${axis}Speed`, speed);
    }
    previousSigns = null;
    paintRotation();
    resetClocks();
    if (!state.playing) pool.silence();
    $("liveStatus").textContent = "Rotation controls reset.";
    scheduleFrame();
    return true;
  }

  if (bank === "sound") {
    $("soundMode").value = "sine";
    $("soundMode").dispatchEvent(new Event("change", { bubbles: true }));
    for (const [id, value] of [
      ["baseFrequency", 82],
      ["pitchRange", 4],
      ["fmIndex", 3.5],
      ["fmRatio", 1.5],
      ["percussionAttack", 3],
      ["percussionDecay", 120],
    ]) bridgeRange(id, value);
    amplitudeControl.reset();
    previousSigns = null;
    $("liveStatus").textContent = "Sound controls reset.";
    scheduleFrame();
    return true;
  }

  return false;
}

installShapesNativeBridge({
  geometry: "hyper",
  sound: "synth",
  capabilities: {
    continuousPosition: true,
    hostGain: true,
    sharedProfile: true,
    bankReset: true,
  },
  captureState: () => ({
    playback: {
      position: state.position,
      continuousPosition: state.continuousPosition,
      speed: state.speed,
      direction: state.direction,
      playing: state.playing,
    },
    audio: { enabled: state.audio, level: state.level },
    topology: sharedProfileForHyper(),
    dimension: hyperDimensionState(),
    synth: {
      mode: state.soundMode,
      baseFrequency: state.baseFrequency,
      pitchRange: state.pitchRange,
      fmIndex: state.fmIndex,
      fmRatio: state.fmRatio,
      pmIndex: state.fmIndex * 0.7,
      pmRatio: state.fmRatio,
      envelope: amplitudeControl.captureState(),
      percussionAttack: state.percussionAttack,
      percussionDecay: state.percussionDecay,
    },
  }),
  applyState: (snapshot = {}) => {
    shapesHostParked = false;
    const playback = snapshot.playback ?? {};
    const synth = snapshot.synth ?? {};
    applyHyperDimensionState(snapshot.dimension ?? {});
    applySharedProfile(snapshot.topology ?? sharedProfileForHyper());
    if (synth.mode && $("soundMode").querySelector(`option[value="${synth.mode}"]`)) {
      $("soundMode").value = synth.mode;
      $("soundMode").dispatchEvent(new Event("change", { bubbles: true }));
    }
    bridgeRange("baseFrequency", synth.baseFrequency);
    bridgeRange("pitchRange", synth.pitchRange);
    bridgeRange("fmIndex", synth.mode === "pm" ? Number(synth.pmIndex) / 0.7 : synth.fmIndex);
    bridgeRange("fmRatio", synth.mode === "pm" ? synth.pmRatio : synth.fmRatio);
    amplitudeControl.applyState(synth.envelope);
    bridgeRange("percussionAttack", synth.percussionAttack);
    bridgeRange("percussionDecay", synth.percussionDecay);
    bridgeRange("level", snapshot.audio?.level);
    bridgeRange("position", playback.position);
    bridgeRange("speed", playback.speed);
    state.continuousPosition = Number.isFinite(playback.continuousPosition)
      ? playback.continuousPosition
      : state.position;
    state.position = ((state.continuousPosition % 1) + 1) % 1;
    state.direction = playback.direction < 0 ? -1 : 1;
    $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
    state.playing = Boolean(playback.playing);
    setPressed($("playButton"), state.playing);
    $("playSummary").textContent = `W plane · ${state.playing ? "playing" : "paused"}`;
    previousSigns = null;
    resetClocks();
    scheduleFrame();
  },
  prepareAudio: async ({ gain = 0 } = {}) => {
    pool.setHostGain(gain);
    if (!state.audio) {
      await pool.enable();
      pool.setLevel(state.level);
      state.audio = true;
    }
    setPressed($("audioButton"), true);
    $("audioState").textContent = "on";
    resetClocks();
    scheduleFrame();
  },
  setHostGain: (gain, rampMilliseconds) => pool.setHostGain(gain, rampMilliseconds),
  parkAudio: () => {
    shapesHostParked = true;
    cancelAnimationFrame(scheduledFrame);
    scheduledFrame = 0;
    pool.setHostGain(0);
    pool.silence();
    scheduleFrame();
  },
  disableAudio: () => {
    state.audio = false;
    pool.disable();
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
    scheduleFrame();
  },
  resetBank: resetShapesBank,
});

window.addEventListener("pagehide", (event) => event.persisted ? pool.disable() : void pool.close());
paintRotation();
scheduleFrame();
