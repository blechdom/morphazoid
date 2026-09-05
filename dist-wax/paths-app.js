import { VoicePool } from "./src/audio.js";
import {
  DEFAULT_PATH_SETTINGS,
  PATH_FAMILIES,
  clamp,
  generatePath,
  partialPath,
  pathDetailLabel,
  pathFamilyFor,
  pathSvgData,
  samplePath,
  sanitizePathSettings,
} from "./src/paths.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const HEAD_COLORS = Object.freeze(["#63e1d0", "#efca72", "#ff8191", "#aa9cff", "#70b8ff"]);
const DEFAULTS = Object.freeze({
  ...DEFAULT_PATH_SETTINGS,
  mode: "draw",
  playing: true,
  direction: 1,
  cycleBehavior: "hold",
  position: 0,
  speed: 0.055,
  voiceEngine: "fm",
  pitchSource: "direction",
  rootFrequency: 65.4,
  pitchRange: 30,
  turnTone: 0.55,
  headCount: 1,
  level: 0.48,
});

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const voicePool = new VoicePool(8, { continuousPeakCeiling: 0.58 });

const state = {
  ...DEFAULTS,
  audio: false,
  path: generatePath(DEFAULTS),
};

const controls = {
  level: $("level"),
  position: $("position"),
  speed: $("speed"),
  cycleBehavior: $("cycleBehavior"),
  seed: $("seed"),
  pathFamily: $("pathFamily"),
  detail: $("detail"),
  aspect: $("aspect"),
  voiceEngine: $("voiceEngine"),
  pitchSource: $("pitchSource"),
  rootFrequency: $("rootFrequency"),
  pitchRange: $("pitchRange"),
  turnTone: $("turnTone"),
  headCount: $("headCount"),
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameAt = performance.now();
let pointer = null;
let statusTimer = 0;
let lastHeadSegments = new Map();
let view = { scale: 1, centerX: 0, centerY: 0 };

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", pressed ? "true" : "false");
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function compact(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.0+$/, "");
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function announce(message) {
  setText("liveStatus", message);
}

function showError(error) {
  const element = $("audioError");
  if (!element) return;
  element.hidden = false;
  element.textContent = error instanceof Error ? error.message : String(error);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { element.hidden = true; }, 6000);
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const data = new Uint32Array(1);
    globalThis.crypto.getRandomValues(data);
    return 1 + data[0] % 99999;
  }
  return 1 + Math.floor(Math.random() * 99999);
}

function pathSettings() {
  return sanitizePathSettings({
    family: state.family,
    detail: state.detail,
    aspect: state.aspect,
    seed: state.seed,
  });
}

function updateView() {
  const reference = state.path;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  reference.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  const width = Math.max(0.02, maxX - minX);
  const height = Math.max(0.02, maxY - minY);
  const padding = Math.min(58, Math.max(30, Math.min(cssWidth, cssHeight) * 0.085));
  view = {
    scale: Math.max(1, Math.min(
      (cssWidth - padding * 2) / width,
      (cssHeight - padding * 2) / height,
    )),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function screenPoint(point) {
  return {
    x: cssWidth / 2 + (point.x - view.centerX) * view.scale,
    y: cssHeight / 2 - (point.y - view.centerY) * view.scale,
  };
}

function regenerate({ resetTime = false, announceChange = true } = {}) {
  Object.assign(state, pathSettings());
  state.path = generatePath(pathSettings());
  if (resetTime) {
    state.position = state.direction > 0 ? 0 : 1;
    state.playing = true;
    lastFrameAt = performance.now();
  }
  lastHeadSegments = new Map();
  updateView();
  syncControls();
  updateReadouts(state.path, []);
  scheduleFrame();
  if (announceChange) {
    announce(`${state.path.family.label} path generated, seed ${state.seed}.`);
  }
}

function gradient(alpha = 1) {
  const result = context.createLinearGradient(24, 0, Math.max(25, cssWidth - 24), cssHeight);
  result.addColorStop(0, `rgba(99, 225, 208, ${alpha})`);
  result.addColorStop(0.27, `rgba(112, 184, 255, ${alpha})`);
  result.addColorStop(0.52, `rgba(170, 156, 255, ${alpha})`);
  result.addColorStop(0.76, `rgba(255, 129, 145, ${alpha})`);
  result.addColorStop(1, `rgba(239, 202, 114, ${alpha})`);
  return result;
}

function strokePoints(points, {
  alpha = 1,
  width = 1.5,
  glow = 0,
  color = null,
} = {}) {
  if (points.length < 2) return;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const screen = screenPoint(point);
    if (index) context.lineTo(screen.x, screen.y);
    else context.moveTo(screen.x, screen.y);
  });
  context.globalAlpha = alpha;
  context.lineCap = "square";
  context.lineJoin = "miter";
  context.lineWidth = width;
  context.strokeStyle = color ?? gradient(1);
  if (glow > 0) {
    context.shadowBlur = glow;
    context.shadowColor = "rgba(99, 225, 208, 0.42)";
  }
  context.stroke();
  context.restore();
}

function drawEndpoint(point, color, filled = false) {
  if (!point) return;
  const screen = screenPoint(point);
  context.save();
  context.beginPath();
  context.arc(screen.x, screen.y, 3.2, 0, TAU);
  context.lineWidth = 1.2;
  context.strokeStyle = color;
  context.fillStyle = filled ? color : "#050708";
  context.fill();
  context.stroke();
  context.restore();
}

function headPhases() {
  const phases = [];
  for (let index = 0; index < state.headCount; index += 1) {
    if (state.mode === "draw") {
      const phase = state.position - index * 0.055;
      if (phase < 0) continue;
      phases.push(clamp(phase, 0, 1));
    } else {
      phases.push(wrap01(state.position - state.direction * index / state.headCount));
    }
  }
  return phases;
}

function playheads(path) {
  return headPhases().map((phase, index) => ({
    ...samplePath(path, phase),
    phase,
    index,
  }));
}

function drawHead(head) {
  const screen = screenPoint(head);
  const color = HEAD_COLORS[head.index % HEAD_COLORS.length];
  const radius = head.index ? 4.3 : 5.5;
  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(-head.angle);
  context.beginPath();
  context.moveTo(-radius * 1.8, 0);
  context.lineTo(radius * 1.8, 0);
  context.lineWidth = 1;
  context.globalAlpha = 0.72;
  context.strokeStyle = color;
  context.stroke();
  context.rotate(head.angle);
  context.beginPath();
  context.arc(0, 0, radius * 2.25, 0, TAU);
  context.fillStyle = color;
  context.globalAlpha = 0.08 + Math.abs(head.curvature) * 0.13;
  context.fill();
  context.beginPath();
  context.arc(0, 0, radius, 0, TAU);
  context.globalAlpha = 1;
  context.fillStyle = "#050708";
  context.fill();
  context.lineWidth = head.index ? 1.5 : 2;
  context.strokeStyle = color;
  context.shadowBlur = head.index ? 7 : 12;
  context.shadowColor = color;
  context.stroke();
  context.restore();
}

function drawScene(path, heads) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  if (state.mode === "draw") {
    const visible = partialPath(path, state.position);
    strokePoints(visible, { alpha: 0.15, width: 7, glow: 13, color: "#63e1d0" });
    strokePoints(visible, { alpha: 0.94, width: 1.65 });
    drawEndpoint(path.points[0], "rgba(237, 245, 239, 0.44)");
    if (state.position >= 0.999) drawEndpoint(path.points.at(-1), "#efca72", true);
  } else {
    strokePoints(path.points, { alpha: 0.12, width: 6, glow: 8, color: "#70b8ff" });
    strokePoints(path.points, { alpha: 0.58, width: 1.35 });
    drawEndpoint(path.points[0], "rgba(237, 245, 239, 0.36)");
    drawEndpoint(path.points.at(-1), "rgba(239, 202, 114, 0.55)");
  }

  heads.slice().reverse().forEach(drawHead);
}

function pitchPosition(head) {
  if (state.pitchSource === "height") return clamp((1 - head.y) / 2, 0, 1);
  if (state.pitchSource === "curvature") return clamp((head.curvature + 1) / 2, 0, 1);
  if (state.pitchSource === "hierarchy") return clamp(head.hierarchy, 0, 1);
  return wrap01(head.angle / TAU);
}

function voiceForHead(head, index) {
  const pitch = pitchPosition(head);
  const semitones = (pitch - 0.5) * state.pitchRange;
  const frequency = clamp(state.rootFrequency * 2 ** (semitones / 12), 20, 8000);
  const curve = Math.abs(head.curvature);
  const voiceCountScale = 1 / Math.sqrt(Math.max(1, state.headCount));
  return {
    key: `path-${index}`,
    frequency,
    gain: (0.23 + curve * 0.07) * voiceCountScale,
    pan: clamp(head.x * 0.88, -1, 1),
    waveform: state.voiceEngine === "sine" ? "sine" : index % 2 ? "triangle" : "sine",
    mode: state.voiceEngine,
    synthDrive: clamp(0.16 + state.turnTone * (0.25 + curve * 0.72), 0, 1),
    modulationIndex: 0.35 + state.turnTone * (1.5 + curve * 9),
    modulationRatio: 1.25 + head.hierarchy * 2.5 + curve * 1.4,
    shepardRate: 0.2 + state.speed * 1.8,
    shepardWidth: 4 + state.turnTone * 5,
    shepardPosition: pitch,
    shepardTravel: state.direction * (0.2 + state.speed),
    gainSmoothingSeconds: 0.012,
  };
}

function triggerTurns(heads, voices) {
  if (!state.audio || !state.playing || state.turnTone <= 0.02) {
    lastHeadSegments = new Map();
    return;
  }
  const nextSegments = new Map();
  heads.forEach((head, index) => {
    const key = `path-${index}`;
    nextSegments.set(key, head.segmentIndex);
    const previous = lastHeadSegments.get(key);
    if (previous === undefined || previous === head.segmentIndex || Math.abs(head.curvature) < 0.16) return;
    const voice = voices[index];
    voicePool.strike({
      key: `turn-${key}`,
      frequency: voice.frequency * (head.curvature < 0 ? 0.75 : 1.5),
      gain: 0.032 * state.turnTone / Math.sqrt(Math.max(1, state.headCount)),
      pan: voice.pan,
      waveform: head.curvature < 0 ? "triangle" : "sine",
    }, {
      attackSeconds: 0.003,
      decaySeconds: 0.045 + Math.abs(head.curvature) * 0.07,
      attackNoise: 0.025 * state.turnTone,
      retriggerMode: "crossfade",
    });
  });
  lastHeadSegments = nextSegments;
}

function updateAudio(heads) {
  if (!state.audio || !state.playing || document.hidden) {
    voicePool.setVoices([], { mode: state.voiceEngine });
    lastHeadSegments = new Map();
    return;
  }
  const voices = heads.map(voiceForHead);
  voicePool.setVoices(voices, {
    mode: state.voiceEngine,
    requestedVoiceCount: voices.length,
  });
  triggerTurns(heads, voices);
}

async function setAudio(enabled) {
  if (!enabled) {
    state.audio = false;
    voicePool.setVoices([]);
    voicePool.disable();
    lastHeadSegments = new Map();
    updateReadouts(state.path, []);
    announce("Audio off.");
    return;
  }
  try {
    await voicePool.enable();
    voicePool.setLevel(state.level);
    state.audio = true;
    updateReadouts(state.path, []);
    scheduleFrame();
    announce("Audio on. The path head is sounding.");
  } catch (error) {
    state.audio = false;
    voicePool.disable();
    showError(error);
    updateReadouts(state.path, []);
  }
}

function syncControls() {
  const mapping = {
    level: state.level,
    position: state.position,
    speed: state.speed,
    cycleBehavior: state.cycleBehavior,
    seed: state.seed,
    pathFamily: state.family,
    detail: state.detail,
    aspect: state.aspect,
    voiceEngine: state.voiceEngine,
    pitchSource: state.pitchSource,
    rootFrequency: state.rootFrequency,
    pitchRange: state.pitchRange,
    turnTone: state.turnTone,
    headCount: state.headCount,
  };
  Object.entries(mapping).forEach(([key, value]) => {
    if (controls[key]) controls[key].value = String(value);
  });
  const family = pathFamilyFor(state.family);
  controls.detail.min = String(family.minDetail);
  controls.detail.max = String(family.maxDetail);
  document.querySelectorAll("[data-path-mode]").forEach((button) => {
    setPressed(button, button.dataset.pathMode === state.mode);
  });
}

function updateReadouts(path, heads = playheads(path)) {
  const family = pathFamilyFor(state.family);
  setText("levelOut", percent(state.level));
  setText("audioState", state.audio ? "on" : "off");
  setText("positionOut", `${(state.position * 100).toFixed(1)}%`);
  setText("speedOut", `${(state.speed * 100).toFixed(1)}%/s`);
  setText("seedOut", state.seed);
  setText("detailOut", pathDetailLabel(pathSettings()));
  setText("aspectOut", `${compact(state.aspect, 2)}:1`);
  setText("rootFrequencyOut", `${compact(state.rootFrequency)} Hz`);
  setText("pitchRangeOut", `${state.pitchRange} st`);
  setText("turnToneOut", percent(state.turnTone));
  setText("headCountOut", state.headCount);
  setText("pointsReadout", path.metrics.pointCount);
  setText("segmentsReadout", path.metrics.segmentCount);
  setText("turnsReadout", path.metrics.turns);
  setText("lengthReadout", compact(path.metrics.length, 1));
  setText(
    "stageReadout",
    `${family.label.toUpperCase()} / ${path.metrics.segmentCount} SEGMENTS / ${state.headCount} ${state.headCount === 1 ? "HEAD" : "HEADS"}`,
  );
  $("phaseBar").style.width = `${clamp(state.position, 0, 1) * 100}%`;
  $("playButton").title = state.playing ? "Pause" : "Play";
  $("playButton").setAttribute("aria-label", state.playing ? "Pause path time" : "Play path time");
  setPressed($("playButton"), state.playing);
  $("directionButton").dataset.direction = state.direction > 0 ? "forward" : "reverse";
  $("directionButton").setAttribute("aria-label", `Direction: ${state.direction > 0 ? "forward" : "reverse"}`);
  setPressed($("audioButton"), state.audio);
  $("audioButton").dataset.audioState = state.audio ? "on" : "off";
  canvas.setAttribute(
    "aria-label",
    `${family.label} ${state.mode} path with ${path.metrics.segmentCount} segments and ${state.headCount} sounding ${state.headCount === 1 ? "head" : "heads"}; audio ${state.audio ? "on" : "off"}.`,
  );
  controls.position.value = String(state.position);
  return heads;
}

function setMode(mode) {
  if (mode !== "draw" && mode !== "trace") return;
  state.mode = mode;
  lastHeadSegments = new Map();
  syncControls();
  scheduleFrame();
  announce(`${mode === "draw" ? "Draw" : "Trace"} mode.`);
}

function togglePlayback() {
  if (!state.playing && state.cycleBehavior === "hold") {
    if ((state.direction > 0 && state.position >= 1) || (state.direction < 0 && state.position <= 0)) {
      state.position = state.direction > 0 ? 0 : 1;
    }
  }
  state.playing = !state.playing;
  lastFrameAt = performance.now();
  if (!state.playing) voicePool.setVoices([]);
  updateReadouts(state.path, []);
  if (state.playing) scheduleFrame();
}

function evolveSeed() {
  state.seed += state.direction > 0 ? 1 : -1;
  if (state.seed > 99999) state.seed = 1;
  if (state.seed < 1) state.seed = 99999;
  regenerate({ resetTime: false, announceChange: false });
}

function advanceTime(delta) {
  if (!state.playing) return;
  const next = state.position + delta * state.speed * state.direction;
  if (next >= 0 && next <= 1) {
    state.position = next;
    return;
  }
  if (state.cycleBehavior === "hold") {
    state.position = state.direction > 0 ? 1 : 0;
    state.playing = false;
    voicePool.setVoices([]);
    return;
  }
  state.position = wrap01(next);
  if (state.cycleBehavior === "evolve") evolveSeed();
  lastHeadSegments = new Map();
}

function svgNumber(value) {
  return Number(value).toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function exportSvg() {
  const path = state.path;
  const data = pathSvgData(path);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  path.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, -point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, -point.y);
  });
  const padding = Math.max(0.04, Math.max(maxX - minX, maxY - minY) * 0.055);
  const viewX = minX - padding;
  const viewY = minY - padding;
  const viewWidth = maxX - minX + padding * 2;
  const viewHeight = maxY - minY + padding * 2;
  const svg = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"${svgNumber(viewX)} ${svgNumber(viewY)} ${svgNumber(viewWidth)} ${svgNumber(viewHeight)}\">`,
    `<title>Paths - ${path.family.label}, seed ${state.seed}</title>`,
    "<defs><linearGradient id=\"path-color\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#63e1d0\"/><stop offset=\"0.28\" stop-color=\"#70b8ff\"/><stop offset=\"0.52\" stop-color=\"#aa9cff\"/><stop offset=\"0.76\" stop-color=\"#ff8191\"/><stop offset=\"1\" stop-color=\"#efca72\"/></linearGradient></defs>",
    `<rect x=\"${svgNumber(viewX)}\" y=\"${svgNumber(viewY)}\" width=\"${svgNumber(viewWidth)}\" height=\"${svgNumber(viewHeight)}\" fill=\"#050708\"/>`,
    `<path id=\"generated-path\" data-layer=\"generated-path\" data-family=\"${state.family}\" d=\"${data}\" fill=\"none\" stroke=\"url(#path-color)\" stroke-width=\"0.006\" stroke-linecap=\"square\" stroke-linejoin=\"miter\"/>`,
    `<circle cx=\"${svgNumber(path.points[0].x)}\" cy=\"${svgNumber(-path.points[0].y)}\" r=\"0.012\" fill=\"#63e1d0\"/>`,
    `<circle cx=\"${svgNumber(path.points.at(-1).x)}\" cy=\"${svgNumber(-path.points.at(-1).y)}\" r=\"0.012\" fill=\"#efca72\"/>`,
    "</svg>",
  ].join("\n");
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `paths-${state.family}-${state.seed}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  announce("SVG exported.");
}

function bindControls() {
  $("audioButton").addEventListener("click", () => setAudio(!state.audio));
  $("playButton").addEventListener("click", togglePlayback);
  $("directionButton").addEventListener("click", () => {
    state.direction *= -1;
    lastHeadSegments = new Map();
    updateReadouts(state.path, []);
    scheduleFrame();
  });
  document.querySelectorAll("[data-path-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.pathMode));
  });

  controls.level.addEventListener("input", () => {
    state.level = Number(controls.level.value);
    voicePool.setLevel(state.level);
    updateReadouts(state.path, []);
  });
  controls.position.addEventListener("input", () => {
    state.position = Number(controls.position.value);
    lastHeadSegments = new Map();
    scheduleFrame();
  });
  controls.speed.addEventListener("input", () => {
    state.speed = Number(controls.speed.value);
    updateReadouts(state.path, []);
  });
  controls.cycleBehavior.addEventListener("change", () => {
    state.cycleBehavior = controls.cycleBehavior.value;
    updateReadouts(state.path, []);
  });
  controls.seed.addEventListener("input", () => {
    state.seed = Math.round(Number(controls.seed.value));
    updateReadouts(state.path, []);
  });
  controls.seed.addEventListener("change", () => regenerate({ resetTime: state.mode === "draw" }));

  controls.pathFamily.addEventListener("change", () => {
    state.family = controls.pathFamily.value;
    state.detail = pathFamilyFor(state.family).defaultDetail;
    regenerate({ resetTime: state.mode === "draw" });
  });
  controls.detail.addEventListener("input", () => {
    state.detail = Math.round(Number(controls.detail.value));
    regenerate({ resetTime: state.mode === "draw", announceChange: false });
  });
  controls.aspect.addEventListener("input", () => {
    state.aspect = Number(controls.aspect.value);
    regenerate({ resetTime: false, announceChange: false });
  });

  for (const id of ["rootFrequency", "pitchRange", "turnTone"]) {
    controls[id].addEventListener("input", () => {
      state[id] = Number(controls[id].value);
      updateReadouts(state.path, []);
      scheduleFrame();
    });
  }
  controls.headCount.addEventListener("input", () => {
    state.headCount = Math.round(Number(controls.headCount.value));
    lastHeadSegments = new Map();
    updateReadouts(state.path, []);
    scheduleFrame();
  });
  for (const id of ["voiceEngine", "pitchSource"]) {
    controls[id].addEventListener("change", () => {
      state[id] = controls[id].value;
      lastHeadSegments = new Map();
      scheduleFrame();
    });
  }

  $("newSeedButton").addEventListener("click", () => {
    state.seed = randomSeed();
    regenerate({ resetTime: state.mode === "draw" });
  });
  $("resetButton").addEventListener("click", () => {
    const keepAudio = state.audio;
    Object.assign(state, DEFAULTS, { audio: keepAudio });
    voicePool.setLevel(state.level);
    regenerate({ resetTime: false, announceChange: false });
    announce("Paths reset.");
  });
  $("exportSvgButton").addEventListener("click", exportSvg);

  canvas.addEventListener("pointerdown", (event) => {
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startPosition: state.position,
    };
    canvas.setPointerCapture?.(event.pointerId);
    stageWrap.classList.add("is-scrubbing");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    state.position = clamp(
      pointer.startPosition + (event.clientX - pointer.startX) / Math.max(1, cssWidth),
      0,
      1,
    );
    lastHeadSegments = new Map();
    scheduleFrame();
  });
  const finishPointer = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    canvas.releasePointerCapture?.(event.pointerId);
    pointer = null;
    stageWrap.classList.remove("is-scrubbing");
    scheduleFrame();
  };
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      state.position = clamp(state.position + (event.key === "ArrowRight" ? 0.01 : -0.01), 0, 1);
      lastHeadSegments = new Map();
      scheduleFrame();
    } else if (event.key.toLowerCase() === "r") {
      state.direction = 1;
      state.position = 0;
      state.playing = true;
      setMode("draw");
    } else if (event.key.toLowerCase() === "n") {
      state.seed = randomSeed();
      regenerate({ resetTime: state.mode === "draw" });
    }
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  updateView();
  scheduleFrame();
}

function frame(now = performance.now()) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  advanceTime(delta);
  const path = state.path;
  const heads = playheads(path);
  drawScene(path, heads);
  updateAudio(heads);
  updateReadouts(path, heads);
  if (state.playing || pointer) scheduleFrame();
}

function boot() {
  bindControls();
  syncControls();
  resizeCanvas();
  updateReadouts(state.path, []);
  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(stageWrap);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) voicePool.setVoices([]);
    else if (state.playing) {
      lastFrameAt = performance.now();
      scheduleFrame();
    }
  });
  window.addEventListener("pagehide", () => { void voicePool.close(); }, { once: true });
  scheduleFrame();
}

boot();
