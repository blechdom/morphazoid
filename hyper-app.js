import {
  VoicePool,
  clamp,
  normalizeStrikeGains,
  pitch01ToFrequency,
  sineCornerEnvelopeGain,
  synthParametersForMode,
} from "./src/audio.js";
import { projectPoint3, rotatePoint3 } from "./src/solid.js";
import {
  hyperplaneIntersections,
  hyperplaneOffsetForPhase,
  projectPoint4,
  transformedTesseract,
} from "./src/hyper.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const pool = new VoicePool(32);
const state = {
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.1,
  direction: 1,
  playing: false,
  autoRotate: false,
  rotationXW: 24,
  rotationYW: -18,
  rotationZW: 12,
  rotationSpeed: 0.06,
  audio: false,
  soundMode: "fm",
  level: 0.6,
  baseFrequency: 82,
  pitchRange: 4,
  fmIndex: 3.5,
  fmRatio: 1.5,
};
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;
let previousSigns = null;
let canvasDrag = null;

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function scheduleFrame() {
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
}
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/s`);
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  $("playSummary").textContent = `W plane · ${state.playing ? "playing" : "paused"}`;
  resetClocks();
  scheduleFrame();
});
$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  scheduleFrame();
});

function paintRotation() {
  setPressed($("manualRotation"), !state.autoRotate);
  setPressed($("autoRotation"), state.autoRotate);
  $("rotationSummary").textContent = state.autoRotate ? "auto · XW/YW/ZW" : "manual";
}
$("manualRotation").addEventListener("click", () => { state.autoRotate = false; paintRotation(); scheduleFrame(); });
$("autoRotation").addEventListener("click", () => { state.autoRotate = true; paintRotation(); resetClocks(); scheduleFrame(); });

function paintRotationAxes() {
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  paintRotation();
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
  if (state.autoRotate) state.autoRotate = false;
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
      $("audioState").textContent = "starting…";
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
    gain: sineCornerEnvelopeGain(contact.cornerStrength ?? 0, 0.18, 0.82, 0.58),
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

function emitCorners(tesseract, offset) {
  const signs = tesseract.vertices.map((point) => point.w - offset);
  if (state.audio && state.soundMode === "percussion" && previousSigns) {
    const intents = [];
    signs.forEach((sign, index) => {
      if ((previousSigns[index] ?? sign) * sign > 0) return;
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
    normalizeStrikeGains(intents, 0.78).forEach((spec) => pool.strike(spec, {
      attackSeconds: 0.003,
      decaySeconds: 0.12,
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
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = ((state.continuousPosition % 1) + 1) % 1;
  }
  if (state.autoRotate) {
    const degrees = state.rotationSpeed * 360 * delta;
    state.rotationXW = normalizeDegrees(state.rotationXW + degrees);
    state.rotationYW = normalizeDegrees(state.rotationYW + degrees * 0.57);
    state.rotationZW = normalizeDegrees(state.rotationZW - degrees * 0.31);
  }

  const tesseract = transformedTesseract(rotation());
  const offset = hyperplaneOffsetForPhase(state.continuousPosition);
  const contacts = hyperplaneIntersections(tesseract, offset);
  drawScene(tesseract, contacts, offset);
  emitCorners(tesseract, offset);
  const continuous = state.soundMode !== "percussion";
  const voices = continuous ? contacts.map(contactVoice) : [];
  if (state.audio) {
    if (continuous && (state.playing || state.autoRotate)) {
      const lookahead = 0.075;
      const futurePhase = state.continuousPosition + (state.playing ? state.direction * state.speed * lookahead : 0);
      const futureDegrees = state.autoRotate ? state.rotationSpeed * 360 * lookahead : 0;
      const future = transformedTesseract(rotation({
        xw: state.rotationXW + futureDegrees,
        yw: state.rotationYW + futureDegrees * 0.57,
        zw: state.rotationZW - futureDegrees * 0.31,
      }));
      const futureContacts = hyperplaneIntersections(future, hyperplaneOffsetForPhase(futurePhase));
      pool.setVoiceTrajectory(voices, futureContacts.map(contactVoice), lookahead);
    } else pool.setVoices(voices);
  }

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  $("stageReadout").textContent = `TESSERACT · ${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"} · ${state.audio ? `${Math.min(voices.length, 32)} VOICES` : "AUDIO OFF"}`;
  if (state.playing || state.autoRotate) scheduleFrame();
}

document.addEventListener("visibilitychange", () => document.hidden ? pool.silence() : scheduleFrame());
window.addEventListener("pagehide", (event) => event.persisted ? pool.disable() : void pool.close());
paintRotation();
scheduleFrame();
