import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  pointInBounds01,
  verticalIntersections,
  wrap01,
} from "./src/geometry.js";
import {
  crossesPingPongTarget,
  crossesPeriodicTarget,
  motionSubsteps,
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import {
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  cornerStrikePeak,
  pitch01ToFrequency,
  sineCornerEnvelopeGain,
} from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const SPEED_MIN = 0.01;
const SPEED_MAX = 1.2;
const MAX_CONTINUOUS_VOICES = 32;
const HEAD_COLORS = ["#5fe8c4", "#7db4ff", "#c79bff", "#ffb86b"];
const AUDIO_SETTINGS_KEY = "morphazoid:shape:audio:v1";
const PERSISTED_AUDIO_KEYS = new Set([
  "baseFrequency",
  "pitchRange",
  "level",
  "soundMode",
  "sineAccent",
  "sineDecay",
  "cornerAccent",
  "cornerAttack",
  "cornerDecay",
  "stereoWidth",
  "mappingFrame",
]);

const state = {
  sides: 4,
  curvature: 0,
  curvatureDirection: 1,
  rotation: 0,
  playMethod: "trace",
  lineCount: 1,
  lineLayout: "parallel",
  scanMotion: "loop",
  heads: 1,
  autoRotate: false,
  rotationSpeed: 0.12,
  rotationDirection: 1,
  audio: false,
  playing: false,
  position: 0,
  continuousPosition: 0,
  speed: 0.06,
  traversalDirection: 1,
  baseFrequency: 110,
  pitchRange: 2.5,
  level: 0.65,
  soundMode: "sine",
  sineAccent: 0.75,
  sineDecay: 0.65,
  cornerAccent: 0.9,
  cornerAttack: 3,
  cornerDecay: 90,
  stereoWidth: 1,
  mappingFrame: "instrument",
};

function loadAudioSettings() {
  try {
    const stored = globalThis.localStorage?.getItem(AUDIO_SETTINGS_KEY);
    if (!stored) return;
    const values = JSON.parse(stored);
    if (!values || typeof values !== "object") return;
    for (const key of PERSISTED_AUDIO_KEYS) {
      if (!(key in values)) continue;
      if (typeof state[key] === "number" && Number.isFinite(Number(values[key]))) {
        state[key] = Number(values[key]);
      } else if (typeof state[key] === "string" && typeof values[key] === "string") {
        state[key] = values[key];
      }
    }
  } catch {
    // Storage is an optional convenience; audio remains fully usable without it.
  }
}

function persistAudioSettings() {
  try {
    const values = {};
    for (const key of PERSISTED_AUDIO_KEYS) values[key] = state[key];
    globalThis.localStorage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(values));
  } catch {
    // Ignore unavailable or full storage.
  }
}

loadAudioSettings();
state.baseFrequency = clamp(state.baseFrequency, 55, 440);
state.pitchRange = clamp(state.pitchRange, 0, 6);
state.level = clamp(state.level, 0, 1);
state.soundMode = state.soundMode === "percussion" ? "percussion" : "sine";
state.sineAccent = clamp(state.sineAccent, 0, 1);
state.sineDecay = clamp(state.sineDecay, 0, 1);
state.cornerAccent = clamp(state.cornerAccent, 0, 1);
state.cornerAttack = clamp(state.cornerAttack, 0.5, 30);
if (state.cornerDecay < 20) state.cornerDecay = 90;
state.cornerDecay = clamp(state.cornerDecay, 20, 800);
state.stereoWidth = clamp(state.stereoWidth, 0, 1);
state.mappingFrame = state.mappingFrame === "shape" ? "shape" : "instrument";

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d");
const pool = new VoicePool(MAX_CONTINUOUS_VOICES);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let draggingPointer = null;
let lastFrameTime = performance.now();
let lastUiUpdate = 0;
let cachedShape = null;
let cachedShapeKey = "";
let cachedLocalShape = null;
let cachedLocalShapeKey = "";
let audioChanging = false;
let scheduledFrame = 0;
let cornerSnapshot = null;

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function invalidate() {
  scheduleFrame();
}

function dismissHelp() {
  invalidate();
}

function resetCornerTracking() {
  cornerSnapshot = null;
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function formatSides(value = state.sides) {
  return value === 2 ? "2 · open line" : `${value} · polygon`;
}

function formatCurvature(value = state.curvature) {
  if (Math.abs(value) < 0.005) return "straight";
  const amount = `${Math.round(Math.abs(value) * 100)}%`;
  if (state.sides === 2) return `${amount} ${value < 0 ? "negative" : "positive"} bend`;
  return `${amount} ${value < 0 ? "inward" : "outward"}`;
}

function effectiveHeadCount() {
  return state.playMethod === "scan" ? state.lineCount : state.heads;
}

function activeLineLayout() {
  return state.lineCount > 1 ? state.lineLayout : "parallel";
}

function updateCanvasLabel() {
  const reader = state.playMethod === "scan"
    ? `${state.lineCount} ${activeLineLayout()} ${state.scanMotion} scanning ${plural(state.lineCount, "line")}`
    : `${state.heads} tracing ${plural(state.heads, "head")}`;
  canvas.setAttribute("aria-label", `Shape instrument canvas. ${formatSides()}; ${reader}.`);
}

function updateLineControls() {
  const showLayout = state.playMethod === "scan" && state.lineCount > 1;
  $("lineLayoutControl").hidden = !showLayout;
  $("scanMotionControl").hidden = state.playMethod !== "scan";
  $("probeType").textContent = state.playMethod === "scan"
    ? `${state.lineCount} ${activeLineLayout().toUpperCase()} ${plural(state.lineCount, "LINE", "LINES")}`
    : `${state.heads} TRACE ${plural(state.heads, "HEAD", "HEADS")}`;
  updateTraversalDirection();
  updateCanvasLabel();
}

function speedFromSlider(value) {
  return SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** clamp(value, 0, 1);
}

function sliderFromSpeed(value) {
  return Math.log(value / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
}

function setPressed(button, pressed) {
  button.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const updateOutput = () => {
    if (output) output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    if (key === "rotation") state.rotation = normalizeDegrees(state.rotation);
    updateOutput();
    afterChange?.();
    if (PERSISTED_AUDIO_KEYS.has(key)) persistAudioSettings();
    dismissHelp();
  });
  input.value = String(state[key]);
  updateOutput();
  return updateOutput;
}

const updateSidesOutput = bindRange("sides", "sides", formatSides, () => {
  updateCurvatureOutput();
  updateTraversalDirection();
  updateCanvasLabel();
  resetCornerTracking();
});
bindRange("rotation", "rotation", (value) => `${Math.round(value)}°`);
const updateLineCountOutput = bindRange("lineCount", "lineCount", (value) => {
  return `${value} ${plural(value, "line")}`;
}, () => {
  updateLineControls();
  resetCornerTracking();
});
const updateHeadsOutput = bindRange("heads", "heads", (value) => {
  return `${value} ${plural(value, "point")}`;
}, () => {
  updateLineControls();
  resetCornerTracking();
});
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/s`);
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("sineAccent", "sineAccent", (value) => `${Math.round(value * 100)}%`);
bindRange("sineDecay", "sineDecay", (value) => `${Math.round(value * 100)}%`);
bindRange("cornerAccent", "cornerAccent", (value) => `${Math.round(value * 100)}%`);
bindRange("cornerAttack", "cornerAttack", (value) => `${Number(value).toFixed(value % 1 ? 1 : 0)} ms`);
bindRange("cornerDecay", "cornerDecay", (value) => `${Math.round(cornerDecaySeconds(value) * 1000)} ms`);
bindRange("stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`);

function updateCurvatureOutput() {
  $("curvature").value = String(Math.abs(state.curvature));
  $("curvatureOut").textContent = formatCurvature();
  for (const button of $("curvatureDirection").querySelectorAll("button")) {
    setPressed(button, Number(button.dataset.value) === state.curvatureDirection);
  }
}

function setCurvatureAmount(amount) {
  state.curvature = clamp(Number(amount), 0, 1) * state.curvatureDirection;
  updateCurvatureOutput();
  updateCanvasLabel();
  resetCornerTracking();
  dismissHelp();
}

function setCurvatureDirection(direction, shouldAnnounce = true) {
  state.curvatureDirection = direction < 0 ? -1 : 1;
  state.curvature = Math.abs(state.curvature) * state.curvatureDirection;
  updateCurvatureOutput();
  resetCornerTracking();
  if (shouldAnnounce) announce(`Roundness bends ${state.curvatureDirection < 0 ? "inward" : "outward"}.`);
  dismissHelp();
}

$("curvature").addEventListener("input", () => setCurvatureAmount($("curvature").value));
for (const button of $("curvatureDirection").querySelectorAll("button")) {
  button.addEventListener("click", () => setCurvatureDirection(Number(button.dataset.value)));
}

function setPlayMethod(method, shouldAnnounce = true) {
  const nextMethod = method === "trace" ? "trace" : "scan";
  if (nextMethod !== state.playMethod) {
    state.continuousPosition = nextMethod === "scan" && state.scanMotion === "pingpong"
      ? rebasePingPongPosition(state.continuousPosition, state.position)
      : rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
      );
  }
  state.playMethod = nextMethod;
  for (const button of $("playMethod").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.playMethod);
  }

  const isScan = state.playMethod === "scan";
  $("headsControl").hidden = isScan;
  $("lineCountControl").hidden = !isScan;
  $("positionLabel").textContent = "Playhead position";
  updateLineCountOutput();
  updateHeadsOutput();
  updateLineControls();
  resetCornerTracking();
  if (shouldAnnounce) {
    announce(isScan
      ? `Line playheads selected. ${state.lineCount} ${plural(state.lineCount, "line")} active.`
      : `Point playheads selected. ${state.heads} ${plural(state.heads, "point")} active.`);
  }
  dismissHelp();
}

for (const button of $("playMethod").querySelectorAll("button")) {
  button.addEventListener("click", () => setPlayMethod(button.dataset.value));
}

function setLineLayout(layout, shouldAnnounce = true) {
  state.lineLayout = layout === "crossed" ? "crossed" : "parallel";
  for (const button of $("lineLayout").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.lineLayout);
  }
  updateLineControls();
  resetCornerTracking();
  if (shouldAnnounce) announce(`${state.lineLayout} scan lines selected.`);
  invalidate();
}

for (const button of $("lineLayout").querySelectorAll("button")) {
  button.addEventListener("click", () => setLineLayout(button.dataset.value));
}

function setScanMotion(motion, shouldAnnounce = true) {
  const nextMotion = motion === "loop" ? "loop" : "pingpong";
  if (nextMotion !== state.scanMotion) {
    if (nextMotion === "pingpong") {
      state.continuousPosition = rebasePingPongPosition(
        state.continuousPosition,
        state.position,
      );
    } else {
      state.continuousPosition = rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
      );
    }
    state.scanMotion = nextMotion;
    resetCornerTracking();
  }
  for (const button of $("scanMotion").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.scanMotion);
  }
  updateTraversalDirection();
  updateCanvasLabel();
  if (shouldAnnounce) announce(`${state.scanMotion === "pingpong" ? "Ping-pong" : "Loop"} line movement selected.`);
  invalidate();
}

for (const button of $("scanMotion").querySelectorAll("button")) {
  button.addEventListener("click", () => setScanMotion(button.dataset.value));
}

function setSoundMode(mode, shouldAnnounce = true) {
  const nextMode = mode === "percussion" ? "percussion" : "sine";
  if (nextMode !== state.soundMode) {
    pool.silence();
    state.soundMode = nextMode;
    resetCornerTracking();
  }
  $("soundMode").value = state.soundMode;
  $("sineArticulation").hidden = state.soundMode !== "sine";
  $("percussionArticulation").hidden = state.soundMode !== "percussion";
  persistAudioSettings();
  if (shouldAnnounce) {
    announce(state.soundMode === "sine"
      ? "Continuous sine with corner amplitude selected."
      : "Percussion corner strikes selected.");
  }
  invalidate();
}

$("soundMode").value = state.soundMode;
$("soundMode").addEventListener("change", (event) => {
  setSoundMode(event.currentTarget.value);
});

function setRotationPlaying(playing, shouldAnnounce = true) {
  state.autoRotate = Boolean(playing);
  setPressed($("rotationPlayButton"), state.autoRotate);
  $("rotationPlayButton").setAttribute("aria-label", state.autoRotate ? "Pause rotation" : "Start rotation");
  lastFrameTime = performance.now();
  if (shouldAnnounce) announce(state.autoRotate ? "Rotation playing." : "Rotation paused.");
  dismissHelp();
}

$("rotationPlayButton").addEventListener("click", () => setRotationPlaying(!state.autoRotate));

function setRotationDirection(direction, shouldAnnounce = true) {
  state.rotationDirection = direction < 0 ? -1 : 1;
  setPressed($("rotationReverse"), state.rotationDirection < 0);
  setPressed($("rotationForward"), state.rotationDirection > 0);
  if (shouldAnnounce) {
    announce(`Rotation direction ${state.rotationDirection > 0 ? "clockwise" : "counterclockwise"}.`);
  }
  invalidate();
}

$("rotationReverse").addEventListener("click", () => setRotationDirection(-1));
$("rotationForward").addEventListener("click", () => setRotationDirection(1));

$("mappingFrame").value = state.mappingFrame;
$("mappingFrame").addEventListener("change", (event) => {
  state.mappingFrame = event.currentTarget.value;
  persistAudioSettings();
  dismissHelp();
});

const speedInput = $("speed");
speedInput.value = String(sliderFromSpeed(state.speed));
speedInput.addEventListener("input", () => {
  state.speed = speedFromSlider(Number(speedInput.value));
  $("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
  dismissHelp();
});

function setPosition(value) {
  const nextPosition = clamp(value, 0, 1);
  state.continuousPosition = state.playMethod === "scan" && state.scanMotion === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(
      state.continuousPosition,
      state.position,
      nextPosition,
    );
  state.position = nextPosition;
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
}

$("position").addEventListener("input", () => {
  setPosition(Number($("position").value));
  dismissHelp();
});

function setPlaying(playing) {
  state.playing = Boolean(playing);
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause playhead" : "Play playhead");
  lastFrameTime = performance.now();
  if (state.playing && state.audio) strikeCurrentCorners();
  announce(state.playing ? "Playing." : "Paused.");
  dismissHelp();
}

$("playButton").addEventListener("click", () => setPlaying(!state.playing));

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

async function toggleAudio() {
  if (audioChanging) return;
  if (state.audio) {
    state.audio = false;
    pool.disable();
    paintAudioState();
    announce("Audio off.");
    invalidate();
    return;
  }

  audioChanging = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting…";
  $("audioError").hidden = true;
  try {
    await pool.enable();
    pool.setVoices([]);
    pool.setLevel(state.level);
    state.audio = true;
    paintAudioState();
    announce(state.soundMode === "sine"
      ? "Audio on. Continuous sine corner envelopes are ready."
      : "Audio on. Percussion corner strikes are ready.");
    dismissHelp();
  } catch (error) {
    state.audio = false;
    $("audioState").textContent = "unavailable";
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
  } finally {
    audioChanging = false;
    $("audioButton").disabled = false;
  }
}

$("audioButton").addEventListener("click", toggleAudio);

function updateTraversalDirection() {
  const forward = state.traversalDirection > 0;
  const crossed = state.playMethod === "scan" && activeLineLayout() === "crossed";
  const bouncing = state.playMethod === "scan" && state.scanMotion === "pingpong";
  const openPoints = state.playMethod === "trace" && state.sides === 2;
  const closedPoints = state.playMethod === "trace" && state.sides > 2;

  $("reverseDirectionGlyph").textContent = crossed ? "↖" : closedPoints ? "↺" : "←";
  $("forwardDirectionGlyph").textContent = crossed ? "↘" : closedPoints ? "↻" : "→";
  $("reverseDirectionText").textContent = bouncing ? "REV" : crossed ? "←+↑" : openPoints ? "REV" : closedPoints ? "CCW" : "R→L";
  $("forwardDirectionText").textContent = bouncing ? "FWD" : crossed ? "→+↓" : openPoints ? "FWD" : closedPoints ? "CW" : "L→R";
  setPressed($("traversalReverse"), !forward);
  setPressed($("traversalForward"), forward);

  $("traversalReverse").setAttribute(
    "aria-label",
    bouncing
      ? "Reverse ping-pong travel"
      : crossed
      ? "Scan right to left and bottom to top"
      : openPoints
        ? "Reverse point traversal"
        : closedPoints ? "Trace counterclockwise" : "Scan right to left",
  );
  $("traversalForward").setAttribute(
    "aria-label",
    bouncing
      ? "Forward ping-pong travel"
      : crossed
      ? "Scan left to right and top to bottom"
      : openPoints
        ? "Forward point traversal"
        : closedPoints ? "Trace clockwise" : "Scan left to right",
  );
}

function setTraversalDirection(direction, shouldAnnounce = true) {
  state.traversalDirection = direction < 0 ? -1 : 1;
  updateTraversalDirection();
  if (shouldAnnounce) announce(`Playhead direction ${state.traversalDirection > 0 ? "forward" : "reverse"}.`);
  invalidate();
}

$("traversalReverse").addEventListener("click", () => setTraversalDirection(-1));
$("traversalForward").addEventListener("click", () => setTraversalDirection(1));

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  invalidate();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function currentShape() {
  const key = `${state.sides}|${state.curvature.toFixed(4)}|${state.rotation.toFixed(4)}`;
  if (cachedShape && cachedShapeKey === key) return cachedShape;
  cachedShapeKey = key;
  cachedShape = buildShape({
    sides: state.sides,
    curvature: state.curvature,
    rotationDeg: state.rotation,
    samplesPerEdge: 48,
  });
  return cachedShape;
}

function currentLocalShape() {
  const key = `${state.sides}|${state.curvature.toFixed(4)}`;
  if (cachedLocalShape && cachedLocalShapeKey === key) return cachedLocalShape;
  cachedLocalShapeKey = key;
  cachedLocalShape = buildShape({
    sides: state.sides,
    curvature: state.curvature,
    rotationDeg: 0,
    samplesPerEdge: 48,
  });
  return cachedLocalShape;
}

function phaseForHead(position, headIndex, headCount) {
  if (headIndex === 0 && Math.abs(position - 1) < 1e-9) return 1;
  return wrap01(position + headIndex / headCount);
}

function traceContact(path, phase) {
  return pointAtPath(path, path.closed ? phase : phase * 2, { pingPong: !path.closed });
}

function scanAxisForHead(headIndex) {
  return activeLineLayout() === "crossed" && headIndex % 2 === 1
    ? "horizontal"
    : "vertical";
}

function scanPhaseOffset(headIndex, headCount) {
  if (activeLineLayout() !== "crossed") return headIndex / headCount;
  const axisCount = headIndex % 2 === 0
    ? Math.ceil(headCount / 2)
    : Math.floor(headCount / 2);
  return Math.floor(headIndex / 2) / Math.max(1, axisCount);
}

function scanPhaseAt(position, headIndex, headCount) {
  const offsetPosition = position + scanPhaseOffset(headIndex, headCount);
  if (state.scanMotion === "pingpong") return pingPong01(offsetPosition);
  if (
    headIndex === 0 &&
    state.position === 1 &&
    Math.abs(position - state.continuousPosition) < 1e-9
  ) {
    return 1;
  }
  return wrap01(offsetPosition);
}

function scannerAt(path, position, headIndex, headCount) {
  const phase = scanPhaseAt(position, headIndex, headCount);
  const axis = scanAxisForHead(headIndex);
  const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
  const maximum = axis === "horizontal" ? path.bounds.maxY : path.bounds.maxX;
  const span = maximum - minimum;
  return {
    headIndex,
    phase,
    axis,
    coordinate: span <= 1e-9
      ? (minimum + maximum) / 2
      : minimum + phase * span,
  };
}

function collectContacts(path, position = state.continuousPosition) {
  const contacts = [];
  const heads = [];
  const headCount = effectiveHeadCount();
  for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
    if (state.playMethod === "scan") {
      const scanner = scannerAt(path, position, headIndex, headCount);
      const intersections = (scanner.axis === "horizontal"
        ? horizontalIntersections(path, scanner.coordinate)
        : verticalIntersections(path, scanner.coordinate)).map((contact, contactIndex) => ({
        ...contact,
        headIndex,
        headPhase: scanner.phase,
        scanAxis: scanner.axis,
        voiceKey: `scan:${scanner.axis}:${headIndex}:${contactIndex}`,
      }));
      heads.push({ ...scanner, contacts: intersections });
      contacts.push(...intersections);
    } else {
      const phase = phaseForHead(position, headIndex, headCount);
      const headTravel = position + headIndex / headCount;
      const contact = {
        ...traceContact(path, phase),
        headIndex,
        headTravel,
        headPhase: phase,
        voiceKey: `trace:${headIndex}`,
      };
      heads.push({ headIndex, phase, contact });
      contacts.push(contact);
    }
  }
  return { contacts, heads };
}

function addScannerPath(scanner, transform, extent) {
  context.beginPath();
  if (scanner.axis === "horizontal") {
    context.moveTo(transform.x(-extent), transform.y(scanner.coordinate));
    context.lineTo(transform.x(extent), transform.y(scanner.coordinate));
  } else {
    context.moveTo(transform.x(scanner.coordinate), transform.y(-extent));
    context.lineTo(transform.x(scanner.coordinate), transform.y(extent));
  }
}

function canvasTransform() {
  const scale = Math.min(cssWidth, cssHeight) * 0.39;
  return {
    scale,
    centerX: cssWidth * 0.5,
    centerY: cssHeight * 0.5,
    x: (value) => cssWidth * 0.5 + value * scale,
    y: (value) => cssHeight * 0.5 + value * scale,
  };
}

function drawShape(path, transform) {
  const points = path.points;
  context.beginPath();
  points.forEach((point, index) => {
    const x = transform.x(point.x);
    const y = transform.y(point.y);
    if (index) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  if (path.closed) context.closePath();
  if (path.closed) {
    context.fillStyle = "rgba(232,196,107,.025)";
    context.fill();
  }
  context.strokeStyle = "rgba(232,196,107,.9)";
  context.lineWidth = path.closed ? 1.5 : 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  for (const vertexIndex of path.vertexIndices) {
    const point = path.points[vertexIndex];
    const x = transform.x(point.x);
    const y = transform.y(point.y);
    context.beginPath();
    context.arc(x, y, 3.5, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = "rgba(232,196,107,.78)";
    context.lineWidth = 1;
    context.stroke();
  }
}

function drawGuideField(transform) {
  context.save();
  context.setLineDash([3, 7]);
  context.strokeStyle = "rgba(214,232,226,.12)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(transform.x(-1.1), transform.y(0));
  context.lineTo(transform.x(1.1), transform.y(0));
  context.moveTo(transform.x(0), transform.y(-1.1));
  context.lineTo(transform.x(0), transform.y(1.1));
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(transform.x(0), transform.y(0), 3, 0, TAU);
  context.strokeStyle = "rgba(95,232,196,.28)";
  context.stroke();
  context.restore();
}

function drawContact(contact, transform, headIndex) {
  const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
  const x = transform.x(contact.x);
  const y = transform.y(contact.y);
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 16;
  context.fillStyle = "#fff3d6";
  context.beginPath();
  context.arc(x, y, 5.5, 0, TAU);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(x - contact.tangent.x * 11, y - contact.tangent.y * 11);
  context.lineTo(x + contact.tangent.x * 11, y + contact.tangent.y * 11);
  context.strokeStyle = color;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawPlayer(path, transform) {
  const active = collectContacts(path);
  const showTrails = !reducedMotion.matches;
  const headCount = effectiveHeadCount();

  if (state.playMethod === "scan") {
    if (showTrails) {
      for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
        const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
        for (let trail = 6; trail >= 1; trail -= 1) {
          const trailPosition = state.continuousPosition - state.traversalDirection * trail * 0.012;
          const scanner = scannerAt(path, trailPosition, headIndex, headCount);
          addScannerPath(scanner, transform, 1.12);
          context.strokeStyle = color;
          context.globalAlpha = (1 - trail / 7) * 0.055;
          context.lineWidth = 1;
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    for (const head of active.heads) {
      const color = HEAD_COLORS[head.headIndex % HEAD_COLORS.length];
      addScannerPath(head, transform, 1.14);
      context.strokeStyle = color;
      context.globalAlpha = headCount > 6 ? 0.52 : 0.72;
      context.lineWidth = head.headIndex === 0 ? 1.5 : 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (showTrails) {
    for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
      const color = HEAD_COLORS[headIndex % HEAD_COLORS.length];
      for (let trail = 14; trail >= 1; trail -= 1) {
        const trailPosition = state.position - state.traversalDirection * trail * 0.006;
        const phase = phaseForHead(trailPosition, headIndex, headCount);
        const point = traceContact(path, phase);
        const strength = 1 - trail / 15;
        context.beginPath();
        context.arc(transform.x(point.x), transform.y(point.y), 1 + strength * 2.2, 0, TAU);
        context.fillStyle = color;
        context.globalAlpha = strength * strength * 0.22;
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  for (const contact of active.contacts) drawContact(contact, transform, contact.headIndex);
  return active.contacts;
}

function mappingForContact(contact, path) {
  if (state.mappingFrame === "shape") {
    const radians = (-path.rotationDeg * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const localContact = {
      x: contact.x * cosine - contact.y * sine,
      y: contact.x * sine + contact.y * cosine,
    };
    const normalized = pointInBounds01(localContact, currentLocalShape().bounds);
    return {
      pitch: clamp(1 - normalized.y, 0, 1),
      pan: clamp(normalized.x * 2 - 1, -1, 1) * state.stereoWidth,
    };
  }
  return {
    pitch: clamp((1 - contact.y) * 0.5, 0, 1),
    pan: clamp(contact.x, -1, 1) * state.stereoWidth,
  };
}

function pingPongMotionDirection(travelPosition, multiplier = 1) {
  const step = state.traversalDirection * 1e-5;
  const before = pingPong01(travelPosition * multiplier);
  const after = pingPong01((travelPosition + step) * multiplier);
  const delta = after - before;
  return Math.abs(delta) > 1e-9 ? Math.sign(delta) : state.traversalDirection;
}

function pointContourDirection(contact, path) {
  return path.closed
    ? state.traversalDirection
    : pingPongMotionDirection(contact.headTravel, 2);
}

function cornerEnvelopeProfile(contact, path) {
  // A scanner can reverse at a projected shape extremum without crossing a
  // vertex, and rotation can move its contour contact independently of the
  // scanner. Geometric corner distance keeps those line envelopes continuous.
  if (state.playMethod === "scan") {
    return {
      strength: contact.cornerStrength ?? 0,
      distance: clamp(contact.cornerDistance01 ?? 0, 0, 1),
    };
  }

  // Point heads have an unambiguous path direction, so preserve the original
  // Tesselateher profile: each corner peaks, then decays along the next edge.
  const distances = path.vertexDistances;
  if (!distances.length || path.totalLength <= 1e-9) {
    return { strength: contact.cornerStrength ?? 0, distance: 0 };
  }

  const distance = clamp(contact.distance, 0, path.totalLength);
  const direction = pointContourDirection(contact, path);
  const epsilon = 1e-9;

  if (direction >= 0) {
    let cornerIndex = 0;
    for (let index = 1; index < distances.length; index += 1) {
      if (distances[index] <= distance + epsilon) cornerIndex = index;
      else break;
    }
    const start = distances[cornerIndex];
    const end = cornerIndex + 1 < distances.length
      ? distances[cornerIndex + 1]
      : path.totalLength;
    return {
      strength: path.cornerStrengths[cornerIndex] ?? 0,
      distance: end - start <= epsilon ? 0 : clamp((distance - start) / (end - start), 0, 1),
    };
  }

  let cornerIndex = distances.findIndex((value) => value >= distance - epsilon);
  let target;
  let start;
  if (cornerIndex < 0) {
    cornerIndex = 0;
    target = path.totalLength;
    start = distances[distances.length - 1];
  } else if (cornerIndex === 0) {
    target = 0;
    start = path.closed ? distances[distances.length - 1] - path.totalLength : 0;
  } else {
    target = distances[cornerIndex];
    start = distances[cornerIndex - 1];
  }
  return {
    strength: path.cornerStrengths[cornerIndex] ?? 0,
    distance: target - start <= epsilon
      ? 0
      : clamp((target - distance) / (target - start), 0, 1),
  };
}

function continuousSineVoices(contacts, path) {
  return contacts.map((contact) => {
    const mapping = mappingForContact(contact, path);
    const corner = cornerEnvelopeProfile(contact, path);
    return {
      key: `sine:${contact.voiceKey}`,
      frequency: pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange),
      gain: sineCornerEnvelopeGain(
        corner.strength,
        corner.distance,
        state.sineAccent,
        state.sineDecay,
      ),
      pan: mapping.pan,
      waveform: "sine",
    };
  });
}

function makeCornerSnapshot(path, continuousPosition = state.continuousPosition) {
  const count = effectiveHeadCount();
  const vertices = path.vertexIndices.map((pointIndex, vertexIndex) => {
    const point = path.points[pointIndex];
    return {
      vertexIndex,
      x: point.x,
      y: point.y,
      strength: path.cornerStrengths[vertexIndex] ?? 0,
      pathPhase: path.closed
        ? path.vertexDistances[vertexIndex] / Math.max(path.totalLength, 1e-9)
        : vertexIndex === 0 ? 0 : 0.5,
    };
  });
  const heads = Array.from({ length: count }, (_, headIndex) => ({
    axis: state.playMethod === "scan"
      ? scanAxisForHead(headIndex)
      : "path",
    continuousPhase: continuousPosition + (state.playMethod === "scan"
      ? scanPhaseOffset(headIndex, count)
      : headIndex / count),
  }));
  return {
    signature: [
      state.playMethod,
      count,
      activeLineLayout(),
      state.scanMotion,
      path.sides,
      path.curvature.toFixed(4),
    ].join("|"),
    continuousPosition,
    rotationDeg: path.rotationDeg,
    bounds: path.bounds,
    heads,
    vertices,
  };
}

function strikeCorner(path, vertex, headIndex) {
  const peak = cornerStrikePeak(vertex.strength, state.cornerAccent);
  if (state.soundMode !== "percussion" || !state.audio || peak <= 0) return;
  const mapping = mappingForContact(vertex, path);
  const envelope = {
    attackSeconds: cornerAttackSeconds(state.cornerAttack),
    decaySeconds: cornerDecaySeconds(state.cornerDecay),
  };
  const frequency = pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange);

  pool.strike({
    key: `corner:${state.playMethod}:${headIndex}:${vertex.vertexIndex}`,
    frequency,
    gain: peak,
    pan: mapping.pan,
    waveform: "sine",
  }, envelope);
}

function projectedVertexPhase(snapshot, vertex, axis) {
  const horizontal = axis === "horizontal";
  const minimum = horizontal ? snapshot.bounds.minY : snapshot.bounds.minX;
  const span = horizontal ? snapshot.bounds.height : snapshot.bounds.width;
  if (span <= 1e-9) return null;
  return clamp(((horizontal ? vertex.y : vertex.x) - minimum) / span, 0, 1);
}

function strikeCurrentCorners() {
  if (state.soundMode !== "percussion") return;
  const path = currentShape();
  const snapshot = makeCornerSnapshot(path);
  const epsilon = 1e-6;
  for (let headIndex = 0; headIndex < snapshot.heads.length; headIndex += 1) {
    const head = snapshot.heads[headIndex];
    for (const vertex of snapshot.vertices) {
      const target = head.axis === "path"
        ? vertex.pathPhase
        : projectedVertexPhase(snapshot, vertex, head.axis);
      if (target === null) continue;
      const phase = head.axis === "path"
        ? wrap01(head.continuousPhase)
        : state.scanMotion === "pingpong"
          ? pingPong01(head.continuousPhase)
          : wrap01(head.continuousPhase);
      const distance = state.scanMotion === "loop" || head.axis === "path"
        ? Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target))
        : Math.abs(phase - target);
      if (distance <= epsilon) strikeCorner(path, vertex, headIndex);
    }
  }
  cornerSnapshot = snapshot;
}

function emitCornerStrikes(previous, current, path) {
  if (!previous || previous.signature !== current.signature) return;
  for (let headIndex = 0; headIndex < current.heads.length; headIndex += 1) {
    const beforeHead = previous.heads[headIndex];
    const afterHead = current.heads[headIndex];
    if (!beforeHead || beforeHead.axis !== afterHead.axis) continue;
    for (let vertexIndex = 0; vertexIndex < current.vertices.length; vertexIndex += 1) {
      const beforeVertex = previous.vertices[vertexIndex];
      const afterVertex = current.vertices[vertexIndex];
      if (!beforeVertex) continue;
      let beforeTarget;
      let afterTarget;
      if (afterHead.axis === "vertical" || afterHead.axis === "horizontal") {
        beforeTarget = projectedVertexPhase(previous, beforeVertex, afterHead.axis);
        afterTarget = projectedVertexPhase(current, afterVertex, afterHead.axis);
      } else {
        beforeTarget = beforeVertex.pathPhase;
        afterTarget = afterVertex.pathPhase;
      }
      if (beforeTarget === null || afterTarget === null) continue;
      const crossed = afterHead.axis !== "path" && state.scanMotion === "pingpong"
        ? crossesPingPongTarget(
          beforeHead.continuousPhase,
          afterHead.continuousPhase,
          beforeTarget,
          afterTarget,
        )
        : crossesPeriodicTarget(
          beforeHead.continuousPhase,
          afterHead.continuousPhase,
          beforeTarget,
          afterTarget,
        );
      if (crossed) {
        strikeCorner(path, afterVertex, headIndex);
      }
    }
  }
}

function trackCornerMotion(finalPath) {
  const finalSnapshot = makeCornerSnapshot(finalPath);
  if (!cornerSnapshot || cornerSnapshot.signature !== finalSnapshot.signature) {
    cornerSnapshot = finalSnapshot;
    return;
  }

  const positionDelta = finalSnapshot.continuousPosition - cornerSnapshot.continuousPosition;
  const rotationDelta = normalizeDegrees(finalSnapshot.rotationDeg - cornerSnapshot.rotationDeg);
  const steps = motionSubsteps(positionDelta, rotationDelta);
  let previous = cornerSnapshot;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const isFinal = step === steps;
    const path = isFinal
      ? finalPath
      : buildShape({
        sides: state.sides,
        curvature: state.curvature,
        rotationDeg: normalizeDegrees(cornerSnapshot.rotationDeg + rotationDelta * amount),
        samplesPerEdge: 48,
      });
    const snapshot = isFinal
      ? finalSnapshot
      : makeCornerSnapshot(
        path,
        cornerSnapshot.continuousPosition + positionDelta * amount,
      );
    emitCornerStrikes(previous, snapshot, path);
    previous = snapshot;
  }
  cornerSnapshot = finalSnapshot;
}

function drawFrame(path) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = canvasTransform();
  drawGuideField(transform);
  drawShape(path, transform);
  return drawPlayer(path, transform);
}

function updateUi(contacts, voiceCount) {
  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;

  const readerCount = effectiveHeadCount();
  const readerName = state.playMethod === "scan"
    ? `${readerCount} ${plural(readerCount, "LINE", "LINES")}`
    : `${readerCount} ${plural(readerCount, "POINT", "POINTS")}`;
  const contactText = `${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")}`;
  const audioText = state.audio
    ? `${voiceCount} ${plural(voiceCount, "VOICE", "VOICES")}`
    : "AUDIO OFF";
  $("stageReadout").textContent = `${readerName} · ${contactText} · ${audioText}`;
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * deltaSeconds;
    state.position = state.playMethod === "scan" && state.scanMotion === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }

  if (state.autoRotate) {
    state.rotation = normalizeDegrees(
      state.rotation + state.rotationDirection * state.rotationSpeed * 360 * deltaSeconds,
    );
  }

  const path = currentShape();
  const moving = state.playing || state.autoRotate;
  if (state.soundMode === "percussion") trackCornerMotion(path);
  else cornerSnapshot = null;
  const contacts = drawFrame(path);
  const sineVoices = state.soundMode === "sine"
    ? continuousSineVoices(contacts, path)
    : [];

  if (state.audio && !document.hidden) {
    pool.setVoices(state.soundMode === "sine" ? sineVoices : []);
  }

  if (!moving || now - lastUiUpdate > 60) {
    const voiceCount = state.soundMode === "sine"
      ? Math.min(sineVoices.length, MAX_CONTINUOUS_VOICES)
      : pool.activeStrikeCount;
    updateUi(contacts, state.audio ? voiceCount : 0);
    lastUiUpdate = now;
  }
  if (moving) scheduleFrame();
}

function scrubFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  setPosition((event.clientX - bounds.left) / Math.max(1, bounds.width));
  dismissHelp();
}

canvas.addEventListener("pointerdown", (event) => {
  draggingPointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  scrubFromPointer(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId === draggingPointer) scrubFromPointer(event);
});

function endPointer(event) {
  if (event.pointerId === draggingPointer) draggingPointer = null;
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

window.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(tag)) return;
  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!state.playing);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.02 : 0.002;
    setPosition(state.position + (event.key === "ArrowLeft" ? -amount : amount));
    dismissHelp();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else invalidate();
});

window.addEventListener("pagehide", (event) => {
  state.audio = false;
  paintAudioState();
  if (event.persisted) pool.disable();
  else void pool.close();
});

window.addEventListener("pageshow", () => invalidate());

$("shape").addEventListener("input", dismissHelp);

updateSidesOutput();
updateCurvatureOutput();
setLineLayout("parallel", false);
setPlayMethod(state.playMethod, false);
setScanMotion(state.scanMotion, false);
setSoundMode(state.soundMode, false);
setTraversalDirection(1, false);
setRotationDirection(1, false);
setRotationPlaying(false, false);
paintAudioState();
$("speedOut").textContent = `${state.speed.toFixed(3)} cyc/s`;
lastFrameTime = performance.now();
scheduleFrame();
