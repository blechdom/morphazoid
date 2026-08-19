import {
  INSTRUMENTS,
  INSTRUMENT_BY_ID,
  MotionDifferencer,
  TriggerGate,
  cloneZones,
  countMotionByZone,
  crossedHorizontalLines,
  defaultGridZones,
  displayPointToNormalized,
  findColorCentroid,
  motionCentroid,
  rasterizeZones,
  sampleFrameColor,
  starterZones,
  clamp,
} from "./src/gesturama-core.js";
import { DrumEngine, MicrophoneRecorder } from "./src/gesturama-audio.js";
import { drawZones } from "./src/gesturama-zones.js";

const root = document.querySelector("#gesturama");

const elements = {
  root,
  stage: document.querySelector("#camera-stage"),
  video: document.querySelector("#camera-feed"),
  paintCanvas: document.querySelector("#paint-canvas"),
  feedbackCanvas: document.querySelector("#feedback-canvas"),
  triggerGrid: document.querySelector("#trigger-grid"),
  gridCells: [...root.querySelectorAll("#trigger-grid [data-grid-cell]")],
  colorTrackerMarker: document.querySelector("#color-tracker-marker"),
  startScreen: document.querySelector("#start-screen"),
  startButton: document.querySelector("#start-button"),
  cameraButton: document.querySelector("#camera-button"),
  mirrorButton: document.querySelector("#mirror-button"),
  muteButton: document.querySelector("#mute-button"),
  audioButton: document.querySelector("#audioButton"),
  audioState: document.querySelector("#audioState"),
  headerVolume: document.querySelector("#output"),
  headerVolumeOut: document.querySelector("#outputOut"),
  presetSelect: document.querySelector("#preset-select"),
  presetButtons: [...root.querySelectorAll("[data-preset]")],
  presetDescription: document.querySelector("#preset-description"),
  toolButtons: [...root.querySelectorAll("button[data-tool]")],
  instrumentButtons: [...root.querySelectorAll("button[data-instrument]")],
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  clearButton: document.querySelector("#clear-button"),
  starterKitButton: document.querySelector("#starter-kit-button"),
  brushSize: document.querySelector("#brush-size"),
  sensitivity: document.querySelector("#sensitivity"),
  volume: document.querySelector("#volume"),
  showMotion: document.querySelector("#show-motion"),
  stageStatus: document.querySelector("#stage-status"),
  stageStatusText: document.querySelector("#stage-status-text"),
  cameraStatus: document.querySelector("#camera-status"),
  zoneCount: document.querySelector("#zone-count"),
  motionMeter: document.querySelector("#motion-meter-fill"),
  motionViewButton: document.querySelector("#motion-view-button"),
  harpStrings: document.querySelector("#harp-strings"),
  sampleColorButton: document.querySelector("#sample-color-button"),
  trackedColor: document.querySelector("#tracked-color"),
  trackedColorValue: document.querySelector("#tracked-color-value"),
  trackerStatus: document.querySelector("#tracker-status"),
  colorTolerance: document.querySelector("#color-tolerance"),
  colorToleranceOutput: document.querySelector("#color-tolerance-output"),
  showColorMask: document.querySelector("#show-color-mask"),
  clearTrackedColor: document.querySelector("#clear-tracked-color"),
  recordSampleButton: document.querySelector("#record-sample-button"),
  sampleStatus: document.querySelector("#sample-status"),
  recordButtonLabel: document.querySelector("#record-sample-button .record-button-label"),
  clearSampleButton: document.querySelector("#clear-sample-button"),
  coach: document.querySelector("#coach"),
  coachClose: document.querySelector("#coach-close"),
  coachPaint: document.querySelector("#coach-paint"),
  coachPlay: document.querySelector("#coach-play"),
  toast: document.querySelector("#toast"),
  debugPanel: document.querySelector("#debug-panel"),
  debugMotion: document.querySelector("#debug-motion"),
  debugHits: document.querySelector("#debug-hits"),
};

const audio = new DrumEngine();
const recorder = new MicrophoneRecorder(audio, { maxDurationMs: 8_000 });
const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const motionViewCanvas = document.createElement("canvas");
const motionViewContext = motionViewCanvas.getContext("2d");
let motionViewImageData = null;
let differencer = new MotionDifferencer(240, 135);
const paintTriggerGate = new TriggerGate();
const gridTriggerGate = new TriggerGate();
const gridZones = defaultGridZones();

const state = {
  started: false,
  preset: "drums",
  tool: "brush",
  instrument: "kick",
  zones: [],
  nextZoneId: 1,
  history: [],
  future: [],
  gesture: null,
  stream: null,
  cameraGeneration: 0,
  cameraStarting: false,
  mirrored: true,
  cameraReady: false,
  cameraError: null,
  owners: new Uint16Array(240 * 135),
  areas: new Map(),
  stageWidth: 1,
  stageHeight: 1,
  lastAnalysisAt: 0,
  lastMotionMask: null,
  lastMotionLevels: null,
  motionFrameVersion: 0,
  renderedMotionFrameVersion: -1,
  lastColorMask: null,
  lastMotionCount: 0,
  calibratingUntil: 0,
  hitTimes: new Map(),
  hitCounts: new Map(INSTRUMENTS.map((instrument) => [instrument.id, 0])),
  colorPickerArmed: false,
  trackedColor: null,
  trackerPoint: null,
  trackerTargetKey: null,
  trackerCandidateKey: null,
  trackerCandidateSince: 0,
  trackerLostAt: null,
  trackerNextAllowedAt: new Map(),
  motionView: false,
  performancePoint: null,
  performancePointAt: 0,
  performanceSource: null,
  performanceLostAt: null,
  activePadKey: null,
  harpNextAllowedAt: new Map(),
  harpTimeouts: new Set(),
  harpHits: 0,
  recording: false,
  recordToken: 0,
  recordStartedAt: 0,
  recordTimer: 0,
  hasPainted: false,
  hasPlayed: false,
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("is-visible"), 2_400);
}

function setStageStatus(label, kind = "ready") {
  elements.stageStatusText.textContent = label;
  elements.stageStatus.dataset.kind = kind;
}

function colorCss(color, alpha) {
  if (!color) return "";
  const channels = `${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}`;
  return alpha === undefined ? `rgb(${channels})` : `rgba(${channels}, ${alpha})`;
}

function setTrackerStatus(label, kind = "idle") {
  if (!elements.trackerStatus) return;
  elements.trackerStatus.textContent = label;
  elements.trackerStatus.dataset.state = kind;
}

function resetTrackerTarget() {
  state.trackerTargetKey = null;
  state.trackerCandidateKey = null;
  state.trackerCandidateSince = 0;
  state.trackerLostAt = null;
  for (const cell of elements.gridCells) cell.classList.remove("is-tracked");
  if (elements.colorTrackerMarker) elements.colorTrackerMarker.hidden = true;
}

function updateTrackedColorControls() {
  const color = state.trackedColor;
  const cssColor = colorCss(color);
  elements.sampleColorButton?.setAttribute("aria-pressed", String(state.colorPickerArmed));
  elements.stage.classList.toggle("is-picking-color", state.colorPickerArmed);
  if (elements.trackedColor) {
    elements.trackedColor.dataset.active = String(Boolean(color));
    elements.trackedColor.style.backgroundColor = cssColor;
  }
  if (elements.trackedColorValue) {
    elements.trackedColorValue.textContent = color
      ? `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
      : "Not set";
  }
  if (elements.clearTrackedColor) elements.clearTrackedColor.disabled = !color;
  elements.root.style.setProperty("--tracked-color", cssColor || INSTRUMENT_BY_ID.get("kick").color);
}

function clearTrackedColor({ announce = true } = {}) {
  state.colorPickerArmed = false;
  state.trackedColor = null;
  state.trackerPoint = null;
  state.lastColorMask = null;
  state.trackerNextAllowedAt.clear();
  resetPerformancePoint({ hideMarker: true });
  resetTrackerTarget();
  updateTrackedColorControls();
  setTrackerStatus("NOT SET", "idle");
  differencer.reset();
  state.calibratingUntil = performance.now() + (state.cameraReady ? 500 : 0);
  setStageStatus(state.cameraReady ? "Calibrating motion" : "Camera off", state.cameraReady ? "calibrating" : "ready");
  if (announce) showToast("Color tracking cleared — motion tracking is active");
}

function armColorPicker() {
  if (!state.started || !state.cameraReady) {
    showToast("Start the camera before picking a color");
    setTrackerStatus("CAMERA OFF", "idle");
    return;
  }
  state.colorPickerArmed = true;
  resetPerformancePoint({ hideMarker: true });
  resetTrackerTarget();
  updateTrackedColorControls();
  setTrackerStatus("TAP VIDEO", "armed");
  setStageStatus("Tap a video color", "calibrating");
  updateStatus();
  showToast("Tap the color you want to track in the video");
  elements.paintCanvas.focus({ preventScroll: true });
}

function cancelColorPicker() {
  state.colorPickerArmed = false;
  updateTrackedColorControls();
  setTrackerStatus(state.trackedColor ? "READY" : "NOT SET", state.trackedColor ? "tracking" : "idle");
  setStageStatus(
    state.cameraReady ? (state.trackedColor ? "Finding color" : "Calibrating motion") : "Camera off",
    state.cameraReady ? "calibrating" : "ready",
  );
  updateStatus();
  showToast("Color picker cancelled");
}

function updateStatus() {
  const audioOn = Boolean(audio.context) && !audio.muted;
  elements.cameraStatus.textContent = state.cameraReady ? "Camera live" : "Camera off";
  elements.cameraStatus.dataset.live = String(state.cameraReady);
  elements.zoneCount.textContent = `12 grid · ${state.zones.length} ${state.zones.length === 1 ? "paint zone" : "paint zones"}`;
  elements.cameraButton.setAttribute("aria-pressed", String(state.cameraReady));
  elements.cameraButton.querySelector("span:last-child").textContent = state.cameraReady ? "Camera on" : "Camera off";
  elements.mirrorButton.setAttribute("aria-pressed", String(state.mirrored));
  elements.muteButton.setAttribute("aria-pressed", String(audio.muted));
  elements.muteButton.querySelector("span:last-child").textContent = audio.muted ? "Unmute" : "Mute";
  elements.audioButton?.setAttribute("aria-pressed", String(audioOn));
  if (elements.audioState) elements.audioState.textContent = audioOn ? "on" : "off";
  elements.coachPaint?.classList.toggle("is-done", state.hasPainted || Boolean(state.trackedColor));
  elements.coachPlay?.classList.toggle("is-done", state.hasPlayed);
  elements.undoButton.disabled = state.history.length === 0;
  elements.redoButton.disabled = state.future.length === 0;
}

function saveHistory() {
  state.history.push(cloneZones(state.zones));
  if (state.history.length > 40) state.history.shift();
  state.future = [];
  updateStatus();
}

function rebuildOwnershipMap() {
  // Grid zones are rasterized first so user-painted zones replace them where
  // they overlap. This makes painted instruments the unambiguous priority.
  const result = rasterizeZones(
    [...gridZones, ...state.zones],
    analysisCanvas.width,
    analysisCanvas.height,
    { hitSlop: 1.25 },
  );
  state.owners = result.owners;
  state.areas = result.areas;
  paintTriggerGate.reset();
  gridTriggerGate.reset();
  state.trackerNextAllowedAt.clear();
}

function resizeStage() {
  const bounds = elements.stage.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return;
  state.stageWidth = bounds.width;
  state.stageHeight = bounds.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [elements.paintCanvas, elements.feedbackCanvas]) {
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
  }
  analysisCanvas.width = 240;
  analysisCanvas.height = Math.max(90, Math.round(240 * bounds.height / bounds.width));
  motionViewCanvas.width = analysisCanvas.width;
  motionViewCanvas.height = analysisCanvas.height;
  motionViewImageData = motionViewContext.createImageData(analysisCanvas.width, analysisCanvas.height);
  state.renderedMotionFrameVersion = -1;
  differencer.resize(analysisCanvas.width, analysisCanvas.height);
  state.lastMotionMask = null;
  state.lastMotionLevels = null;
  rebuildOwnershipMap();
}

function renderFrame(now) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const paintContext = elements.paintCanvas.getContext("2d");
  paintContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawZones(paintContext, state.zones, state.stageWidth, state.stageHeight, {
    now,
    armed: state.cameraReady,
    hitTimes: state.hitTimes,
  });
  drawFeedback();
  requestAnimationFrame(renderFrame);
}

function drawFeedback() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const context = elements.feedbackCanvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, state.stageWidth, state.stageHeight);

  const cellWidth = state.stageWidth / analysisCanvas.width;
  const cellHeight = state.stageHeight / analysisCanvas.height;
  if (state.motionView) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, state.stageWidth, state.stageHeight);
    if (state.lastMotionLevels && motionViewImageData) {
      if (state.renderedMotionFrameVersion !== state.motionFrameVersion) {
        const motionPixels = motionViewImageData.data;
        for (let index = 0; index < state.lastMotionLevels.length; index += 1) {
          const level = state.lastMotionLevels[index];
          const target = index * 4;
          motionPixels[target] = level;
          motionPixels[target + 1] = level;
          motionPixels[target + 2] = level;
          motionPixels[target + 3] = 255;
        }
        motionViewContext.putImageData(motionViewImageData, 0, 0);
        state.renderedMotionFrameVersion = state.motionFrameVersion;
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(motionViewCanvas, 0, 0, state.stageWidth, state.stageHeight);
    }
    return;
  }

  if (elements.showMotion?.checked && state.lastMotionMask) {
    context.fillStyle = "rgba(255, 255, 255, 0.2)";
    for (let index = 0; index < state.lastMotionMask.length; index += 1) {
      if (!state.lastMotionMask[index]) continue;
      const x = index % analysisCanvas.width;
      const y = Math.floor(index / analysisCanvas.width);
      context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.4, cellHeight + 0.4);
    }
  }

  if (elements.showColorMask?.checked && state.lastColorMask && state.trackedColor) {
    context.fillStyle = colorCss(state.trackedColor, 0.34);
    for (let index = 0; index < state.lastColorMask.length; index += 1) {
      if (!state.lastColorMask[index]) continue;
      const x = index % analysisCanvas.width;
      const y = Math.floor(index / analysisCanvas.width);
      context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.6, cellHeight + 0.6);
    }
  }
}

function drawVideoCover() {
  const targetWidth = analysisCanvas.width;
  const targetHeight = analysisCanvas.height;
  const sourceWidth = elements.video.videoWidth;
  const sourceHeight = elements.video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;

  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  let sourceX = 0;
  let sourceY = 0;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceAspect > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
    sourceX = (sourceWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceWidth / targetAspect;
    sourceY = (sourceHeight - cropHeight) / 2;
  }

  analysisContext.save();
  analysisContext.setTransform(1, 0, 0, 1, 0, 0);
  analysisContext.clearRect(0, 0, targetWidth, targetHeight);
  if (state.mirrored) {
    analysisContext.translate(targetWidth, 0);
    analysisContext.scale(-1, 1);
  }
  analysisContext.drawImage(
    elements.video,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  analysisContext.restore();
  return true;
}

function gridCellAtPoint(point) {
  if (!elements.gridCells.length) return null;
  const stageBounds = elements.stage.getBoundingClientRect();
  const displayX = stageBounds.left + point.x * stageBounds.width;
  const displayY = stageBounds.top + point.y * stageBounds.height;
  const renderedCells = elements.gridCells.filter((cell) => {
    const bounds = cell.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
  if (renderedCells.length) {
    return renderedCells.find((cell) => {
      const bounds = cell.getBoundingClientRect();
      return displayX >= bounds.left && displayX <= bounds.right
        && displayY >= bounds.top && displayY <= bounds.bottom;
    }) ?? null;
  }

  // The default overlay is a four-column grid. This fallback keeps pointer and
  // synthetic-camera tests deterministic in browsers without a rendered layout.
  const columns = 4;
  const rows = Math.max(1, Math.ceil(elements.gridCells.length / columns));
  const column = clamp(Math.floor(point.x * columns), 0, columns - 1);
  const row = clamp(Math.floor(point.y * rows), 0, rows - 1);
  return elements.gridCells[row * columns + column] ?? null;
}

async function triggerGridCell(cell, strength = 0.78) {
  const instrument = cell?.dataset.instrument;
  if (!INSTRUMENT_BY_ID.has(instrument)) return;
  cell.classList.remove("is-hit");
  requestAnimationFrame(() => cell.classList.add("is-hit"));
  setTimeout(() => cell.classList.remove("is-hit"), 220);
  await triggerZone({ id: `grid-${cell.dataset.gridCell}`, instrument }, strength);
}

function buildColorMask(rgba, target, tolerance) {
  const mask = new Uint8Array(analysisCanvas.width * analysisCanvas.height);
  const toleranceSquared = tolerance ** 2;
  for (let pixel = 0, source = 0; pixel < mask.length; pixel += 1, source += 4) {
    const red = rgba[source] - target.r;
    const green = rgba[source + 1] - target.g;
    const blue = rgba[source + 2] - target.b;
    if (red * red + green * green + blue * blue <= toleranceSquared) mask[pixel] = 1;
  }
  return mask;
}

function updateColorTracking(rgba, now) {
  if (!state.trackedColor) {
    state.lastColorMask = null;
    return null;
  }

  const tolerance = Number(elements.colorTolerance?.value ?? 28);
  const centroid = findColorCentroid(
    rgba,
    analysisCanvas.width,
    analysisCanvas.height,
    state.trackedColor,
    { tolerance, stride: 1, origin: state.trackerPoint, minComponentPixels: 4 },
  );
  state.lastColorMask = elements.showColorMask?.checked
    ? buildColorMask(rgba, state.trackedColor, tolerance)
    : null;

  // Reject tiny isolated matches, which are usually compression or sensor noise.
  if (!centroid || centroid.count < 4) {
    setTrackerStatus("SEARCHING", "armed");
    setStageStatus("Finding color", "calibrating");
    return null;
  }

  state.trackerLostAt = null;
  const point = { x: centroid.normalizedX, y: centroid.normalizedY };
  state.trackerPoint = point;
  const marker = elements.colorTrackerMarker;
  if (marker) {
    marker.hidden = false;
    marker.style.left = `${point.x * 100}%`;
    marker.style.top = `${point.y * 100}%`;
  }
  setTrackerStatus("TRACKING", "tracking");
  setStageStatus(audio.muted ? "Tracking · muted" : "Color armed", audio.muted ? "muted" : "live");
  return centroid;
}

function stopActivePad(release = 0.12) {
  if (!state.activePadKey) return;
  audio.stopGesturePad(state.activePadKey, { release });
  state.activePadKey = null;
}

function resetPerformancePoint({ hideMarker = false } = {}) {
  stopActivePad(0.08);
  state.performancePoint = null;
  state.performancePointAt = 0;
  state.performanceSource = null;
  state.performanceLostAt = null;
  state.trackerTargetKey = null;
  state.trackerCandidateKey = null;
  state.trackerCandidateSince = 0;
  for (const cell of elements.gridCells) cell.classList.remove("is-tracked");
  if (hideMarker && elements.colorTrackerMarker) elements.colorTrackerMarker.hidden = true;
}

function handlePerformanceLoss(now, { color = false } = {}) {
  if (state.performanceLostAt === null) state.performanceLostAt = now;
  if (now - state.performanceLostAt < 110) return;
  resetPerformancePoint({ hideMarker: color });
}

function settlePointTarget(target, now, cooldown = 90) {
  if (!target) {
    state.trackerCandidateKey = null;
    state.trackerCandidateSince = 0;
    return { active: false, entered: false };
  }
  if (target.key === state.trackerTargetKey) {
    state.trackerCandidateKey = null;
    state.trackerCandidateSince = 0;
    return { active: true, entered: false };
  }
  if (state.trackerCandidateKey !== target.key) {
    state.trackerCandidateKey = target.key;
    state.trackerCandidateSince = now;
    return { active: false, entered: false };
  }
  if (now - state.trackerCandidateSince < 70) return { active: false, entered: false };
  const nextAllowedAt = state.trackerNextAllowedAt.get(target.key) ?? 0;
  if (now < nextAllowedAt) return { active: false, entered: false };
  state.trackerTargetKey = target.key;
  state.trackerCandidateKey = null;
  state.trackerCandidateSince = 0;
  state.trackerNextAllowedAt.set(target.key, now + cooldown);
  return { active: true, entered: true };
}

function gridPointParameters(cell, point) {
  const index = Number(cell?.dataset.gridCell ?? 0);
  const column = index % 4;
  const row = Math.floor(index / 4);
  const stageBounds = elements.stage.getBoundingClientRect();
  const cellBounds = cell?.getBoundingClientRect();
  const hasRenderedBounds = stageBounds.width > 0
    && stageBounds.height > 0
    && cellBounds?.width > 0
    && cellBounds?.height > 0;
  return {
    index,
    x: hasRenderedBounds
      ? clamp((point.x * stageBounds.width - (cellBounds.left - stageBounds.left)) / cellBounds.width, 0, 1)
      : clamp(point.x * 4 - column, 0, 1),
    y: hasRenderedBounds
      ? clamp((point.y * stageBounds.height - (cellBounds.top - stageBounds.top)) / cellBounds.height, 0, 1)
      : clamp(point.y * 3 - row, 0, 1),
    baseFrequency: 82.4069 * 2 ** (index / 12),
  };
}

function paintedZonePointParameters(zone, point) {
  const points = zone.points ?? [];
  let minX = Math.min(...points.map((candidate) => candidate.x));
  let maxX = Math.max(...points.map((candidate) => candidate.x));
  let minY = Math.min(...points.map((candidate) => candidate.y));
  let maxY = Math.max(...points.map((candidate) => candidate.y));
  if (zone.type === "dot" && points[0]) {
    minX = points[0].x - zone.radius;
    maxX = points[0].x + zone.radius;
    minY = points[0].y - zone.radius;
    maxY = points[0].y + zone.radius;
  }
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    minX = point.x - 0.01;
    maxX = point.x + 0.01;
    minY = point.y - 0.01;
    maxY = point.y + 0.01;
  }
  const width = Math.max(0.02, maxX - minX);
  const height = Math.max(0.02, maxY - minY);
  return {
    x: clamp((point.x - minX) / width, 0, 1),
    y: clamp((point.y - minY) / height, 0, 1),
    baseFrequency: 82.4069 * 2 ** (((Math.max(1, zone.id) - 1) % 12) / 12),
  };
}

function performContinuousPad(target, parameters, speed, now) {
  if (state.activePadKey && state.activePadKey !== target?.key) stopActivePad();
  const settled = settlePointTarget(target, now, 80);
  if (!settled.active || !target || !parameters) return;
  const voiceOptions = {
    x: parameters.x,
    y: parameters.y,
    velocity: clamp(0.35 + speed * 0.32, 0.35, 1),
    baseFrequency: parameters.baseFrequency,
  };
  if (settled.entered || state.activePadKey !== target.key) {
    state.activePadKey = target.key;
    audio.startGesturePad(target.key, voiceOptions).catch((error) => showToast(error.message));
    state.hasPlayed = true;
  } else {
    audio.updateGesturePad(target.key, voiceOptions);
  }
}

function pointSpeed(point, now, source) {
  if (!state.performancePoint || state.performanceSource !== source) return 0;
  const elapsed = now - state.performancePointAt;
  if (elapsed <= 0 || elapsed > 260) return 0;
  return Math.hypot(point.x - state.performancePoint.x, point.y - state.performancePoint.y) * 1_000 / elapsed;
}

function markGridTarget(cell) {
  for (const candidate of elements.gridCells) {
    candidate.classList.toggle("is-tracked", candidate === cell);
  }
}

function clearScheduledHarpPlucks() {
  for (const timeout of state.harpTimeouts) clearTimeout(timeout);
  state.harpTimeouts.clear();
}

function pluckHarpCrossings(previous, point, speed, now) {
  const strings = [...(elements.harpStrings?.querySelectorAll("[data-harp-string]") ?? [])];
  const lineCount = strings.length || 12;
  const crossed = crossedHorizontalLines(previous, point, lineCount);
  crossed.forEach((stringIndex, order) => {
    const string = strings[stringIndex];
    const note = Number(string?.dataset.note ?? 60 + stringIndex);
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const nextAllowedAt = state.harpNextAllowedAt.get(stringIndex) ?? 0;
    if (now < nextAllowedAt) return;
    state.harpNextAllowedAt.set(stringIndex, now + 55);
    const velocity = clamp(0.28 + speed * 0.5, 0.28, 1);
    const delay = Math.round((1 - point.x) * 16 * order);
    const timeout = setTimeout(() => {
      state.harpTimeouts.delete(timeout);
      if (state.preset !== "harp" || !state.cameraReady || document.hidden) return;
      state.harpHits += 1;
      updateDebug();
      audio.pluckString(stringIndex, frequency, velocity, clamp(point.x, 0.04, 0.96))
        .catch((error) => showToast(error.message));
      string?.classList.remove("is-hit");
      requestAnimationFrame(() => string?.classList.add("is-hit"));
      setTimeout(() => string?.classList.remove("is-hit"), 240);
    }, delay);
    state.harpTimeouts.add(timeout);
    state.hasPlayed = true;
  });
}

function processPerformancePoint(point, now, { source, strength = 0.78 } = {}) {
  state.performanceLostAt = null;
  const previous = state.performanceSource === source ? state.performancePoint : null;
  const speed = pointSpeed(point, now, source);
  const paintedZone = zoneAtPoint(point);

  if (state.preset === "harp") {
    stopActivePad();
    markGridTarget(null);
    state.trackerTargetKey = null;
    state.trackerCandidateKey = null;
    if (previous) pluckHarpCrossings(previous, point, speed, now);
  } else if (paintedZone && state.preset === "pads" && paintedZone.instrument !== "sample") {
    markGridTarget(null);
    const target = { key: `pad-zone:${paintedZone.id}`, kind: "pad-zone", zone: paintedZone };
    performContinuousPad(target, paintedZonePointParameters(paintedZone, point), speed, now);
  } else if (paintedZone) {
    stopActivePad();
    markGridTarget(null);
    const target = { key: `zone:${paintedZone.id}`, kind: "zone", zone: paintedZone };
    const instrument = INSTRUMENT_BY_ID.get(paintedZone.instrument);
    const settled = settlePointTarget(target, now, instrument?.cooldown ?? 120);
    if (settled.entered) triggerZone(paintedZone, clamp(strength + speed * 0.08, 0.5, 1));
  } else if (state.preset === "drums") {
    stopActivePad();
    const cell = gridCellAtPoint(point);
    markGridTarget(cell);
    const target = cell ? { key: `grid:${cell.dataset.gridCell}`, kind: "grid", cell } : null;
    const instrument = INSTRUMENT_BY_ID.get(cell?.dataset.instrument);
    const settled = settlePointTarget(target, now, instrument?.cooldown ?? 100);
    if (settled.entered) triggerGridCell(cell, clamp(strength + speed * 0.08, 0.5, 1));
  } else if (state.preset === "pads") {
    const cell = gridCellAtPoint(point);
    markGridTarget(cell);
    const target = cell ? { key: `pad:${cell.dataset.gridCell}`, kind: "pad", cell } : null;
    performContinuousPad(target, cell ? gridPointParameters(cell, point) : null, speed, now);
  }

  state.performancePoint = point;
  state.performancePointAt = now;
  state.performanceSource = source;
  updateStatus();
  updateDebug();
}

function processMotionPerformance(result, now, sensitivity) {
  const scores = countMotionByZone(result.mask, state.owners);
  if (state.preset === "harp") {
    paintTriggerGate.update(state.zones, new Map(), state.areas, now, sensitivity);
    gridTriggerGate.update(gridZones, new Map(), state.areas, now, sensitivity);
    const centroid = motionCentroid(result.mask, analysisCanvas.width, analysisCanvas.height, { minPixels: 5 });
    if (!centroid) {
      handlePerformanceLoss(now);
      return;
    }
    processPerformancePoint(
      { x: centroid.normalizedX, y: centroid.normalizedY },
      now,
      { source: "motion", strength: clamp(0.5 + centroid.count / 260, 0.5, 1) },
    );
    return;
  }

  const paintHits = paintTriggerGate.update(state.zones, scores, state.areas, now, sensitivity);
  const activePaintZones = state.zones
    .filter((zone) => paintTriggerGate.isActive(zone.id))
    .sort((first, second) => (scores.get(second.id) ?? 0) - (scores.get(first.id) ?? 0));
  if (activePaintZones.length) {
    gridTriggerGate.update(gridZones, new Map(), state.areas, now, sensitivity);
    if (state.preset === "pads") {
      for (const hit of paintHits) {
        if (hit.zone.instrument === "sample") triggerZone(hit.zone, hit.strength);
      }
      const zone = activePaintZones.find((candidate) => candidate.instrument !== "sample");
      if (!zone) {
        resetPerformancePoint();
        return;
      }
      const zoneMotion = new Uint8Array(result.mask.length);
      for (let index = 0; index < result.mask.length; index += 1) {
        if (result.mask[index] && state.owners[index] === zone.id) zoneMotion[index] = 1;
      }
      const centroid = motionCentroid(zoneMotion, analysisCanvas.width, analysisCanvas.height, { minPixels: 3 });
      if (centroid) {
        processPerformancePoint(
          { x: centroid.normalizedX, y: centroid.normalizedY },
          now,
          { source: "motion", strength: clamp(0.5 + centroid.count / 180, 0.5, 1) },
        );
      } else {
        handlePerformanceLoss(now);
      }
      return;
    }
    resetPerformancePoint();
    for (const hit of paintHits) triggerZone(hit.zone, hit.strength);
    return;
  }

  if (state.preset === "drums") {
    const gridHits = gridTriggerGate.update(gridZones, scores, state.areas, now, sensitivity);
    for (const hit of gridHits) {
      const cell = elements.gridCells[hit.zone.id - gridZones[0].id];
      if (cell) triggerGridCell(cell, hit.strength);
    }
    if (!result.count) markGridTarget(null);
    return;
  }

  gridTriggerGate.update(gridZones, new Map(), state.areas, now, sensitivity);
  const centroid = motionCentroid(result.mask, analysisCanvas.width, analysisCanvas.height, { minPixels: 5 });
  if (!centroid) {
    handlePerformanceLoss(now);
    return;
  }
  processPerformancePoint(
    { x: centroid.normalizedX, y: centroid.normalizedY },
    now,
    { source: "motion", strength: clamp(0.5 + centroid.count / 260, 0.5, 1) },
  );
}

function analyzeVideo(now) {
  if (!state.cameraReady || document.hidden) return;
  if (now - state.lastAnalysisAt < 42) return;
  if (state.lastAnalysisAt && now - state.lastAnalysisAt > 260) differencer.reset();
  state.lastAnalysisAt = now;
  if (!drawVideoCover()) return;

  const frame = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  if (state.colorPickerArmed) {
    state.lastColorMask = null;
    setStageStatus("Tap a video color", "calibrating");
    return;
  }
  const colorTrackingActive = Boolean(state.trackedColor);
  const trackedCentroid = colorTrackingActive ? updateColorTracking(frame.data, now) : null;
  const sensitivity = Number(elements.sensitivity?.value ?? 64);
  const lumaThreshold = Math.round(44 - sensitivity * 0.26);
  const result = differencer.process(frame.data, lumaThreshold, 1);
  state.lastMotionMask = result.mask;
  state.lastMotionLevels = result.levels;
  state.motionFrameVersion += 1;
  state.lastMotionCount = result.count;
  const motionRatio = result.count / result.mask.length;
  if (elements.motionMeter) elements.motionMeter.style.width = `${Math.min(100, motionRatio * 420)}%`;

  // A sampled color is an alternate, more selective trigger source. Motion
  // analysis continues for its meter/overlay, but does not double-fire zones.
  if (colorTrackingActive) {
    if (trackedCentroid) {
      processPerformancePoint(
        { x: trackedCentroid.normalizedX, y: trackedCentroid.normalizedY },
        now,
        { source: "color", strength: clamp(0.58 + trackedCentroid.count / 280, 0.58, 1) },
      );
    } else {
      handlePerformanceLoss(now, { color: true });
    }
    updateDebug();
    return;
  }

  if (!result.primed || now < state.calibratingUntil) {
    setStageStatus("Calibrating motion", "calibrating");
    handlePerformanceLoss(now);
    return;
  }
  if (motionRatio > 0.42) {
    differencer.reset();
    state.calibratingUntil = now + 500;
    setStageStatus("Recalibrating", "calibrating");
    resetPerformancePoint();
    return;
  }

  setStageStatus(audio.muted ? "Camera active · muted" : "Camera active", audio.muted ? "muted" : "live");
  processMotionPerformance(result, now, sensitivity);
  updateDebug();
}

function analysisLoop(now) {
  analyzeVideo(now);
  requestAnimationFrame(analysisLoop);
}

async function triggerZone(zone, strength = 0.82) {
  state.hitTimes.set(zone.id, performance.now());
  state.hitCounts.set(zone.instrument, (state.hitCounts.get(zone.instrument) ?? 0) + 1);
  state.hasPlayed = true;
  updateStatus();
  updateDebug();
  try {
    await audio.trigger(zone.instrument, strength);
  } catch (error) {
    showToast(error.message);
  }
}

async function previewInstrument(instrumentId) {
  if (instrumentId === "sample" && !audio.hasSample) {
    showToast("Record a microphone sample first");
    return;
  }
  try {
    await audio.trigger(instrumentId, 0.72);
    const button = elements.instrumentButtons.find((candidate) => candidate.dataset.instrument === instrumentId);
    button?.classList.remove("is-hit");
    requestAnimationFrame(() => button?.classList.add("is-hit"));
    setTimeout(() => button?.classList.remove("is-hit"), 220);
  } catch (error) {
    showToast(error.message);
  }
}

function updateDebug() {
  if (elements.debugPanel.hidden) return;
  elements.debugMotion.textContent = String(state.lastMotionCount);
  elements.debugHits.textContent = `${INSTRUMENTS
    .map((instrument) => `${instrument.short}:${state.hitCounts.get(instrument.id)}`)
    .join("  ")}  STR:${state.harpHits}`;
}

function normalizePreset(value) {
  const aliases = {
    drums: "drums",
    "drum-grid": "drums",
    pads: "pads",
    "resonant-pads": "pads",
    harp: "harp",
    "video-harp": "harp",
  };
  return aliases[value] ?? "drums";
}

function setPreset(value, announce = true) {
  const preset = normalizePreset(value);
  clearScheduledHarpPlucks();
  state.preset = preset;
  state.gesture = null;
  resetPerformancePoint();
  resetTrackerTarget();
  paintTriggerGate.reset();
  gridTriggerGate.reset();
  state.trackerNextAllowedAt.clear();
  state.harpNextAllowedAt.clear();
  audio.stopAllGesturePads({ release: 0.06 });
  elements.stage.dataset.preset = preset;
  if (elements.presetSelect && normalizePreset(elements.presetSelect.value) !== preset) {
    const matchingOption = [...elements.presetSelect.options]
      .find((option) => normalizePreset(option.value) === preset);
    if (matchingOption) elements.presetSelect.value = matchingOption.value;
  }
  for (const control of elements.presetButtons) {
    const selected = normalizePreset(control.dataset.preset ?? control.value) === preset;
    if (control.matches("button")) control.setAttribute("aria-pressed", String(selected));
  }
  if (elements.harpStrings) {
    elements.harpStrings.hidden = preset !== "harp";
    elements.harpStrings.setAttribute("aria-hidden", String(preset !== "harp"));
  }
  if (elements.triggerGrid) elements.triggerGrid.setAttribute("aria-hidden", String(preset === "harp"));
  if (elements.presetDescription) {
    elements.presetDescription.textContent = {
      drums: "Camera movement enters cells to fire one-shot drums.",
      pads: "Enter a cell to start a pad; move within it to shape tone and texture.",
      harp: "Cross horizontal strings; speed shapes volume and position shapes timbre.",
    }[preset];
  }
  setStageStatus(state.cameraReady ? `${preset === "harp" ? "Harp" : preset === "pads" ? "Pads" : "Drums"} active` : "Camera off", state.cameraReady ? "live" : "ready");
  updateStatus();
  if (announce) showToast(`${preset === "harp" ? "Video harp" : preset === "pads" ? "Resonant pads" : "Drum grid"} preset`);
}

function setTool(tool) {
  state.tool = tool;
  for (const button of elements.toolButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  }
  elements.stage.dataset.tool = tool;
}

function setInstrument(instrument) {
  if (!INSTRUMENT_BY_ID.has(instrument)) return;
  state.instrument = instrument;
  for (const button of elements.instrumentButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.instrument === instrument));
  }
  elements.root.style.setProperty("--active-paint", INSTRUMENT_BY_ID.get(instrument).color);
}

function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function stopCamera() {
  state.cameraGeneration += 1;
  state.cameraStarting = false;
  clearScheduledHarpPlucks();
  if (state.stream) {
    stopMediaStream(state.stream);
  }
  state.stream = null;
  state.cameraReady = false;
  elements.video.srcObject = null;
  elements.stage.classList.remove("has-camera");
  differencer.reset();
  state.lastMotionMask = null;
  state.lastMotionLevels = null;
  state.lastColorMask = null;
  state.colorPickerArmed = false;
  resetPerformancePoint({ hideMarker: true });
  audio.stopAllGesturePads({ release: 0.04 });
  resetTrackerTarget();
  updateTrackedColorControls();
  if (state.trackedColor) setTrackerStatus("CAMERA OFF", "idle");
  setStageStatus("Camera off", "ready");
  updateStatus();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not provide camera access.");
  stopCamera();
  const generation = state.cameraGeneration;
  state.cameraStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1_280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    });
    if (generation !== state.cameraGeneration || document.hidden) {
      stopMediaStream(stream);
      return false;
    }
    state.stream = stream;
    elements.video.srcObject = stream;
    try {
      await elements.video.play();
    } catch (error) {
      if (generation !== state.cameraGeneration || document.hidden) {
        stopMediaStream(stream);
        if (elements.video.srcObject === stream) elements.video.srcObject = null;
        return false;
      }
      stopCamera();
      throw error;
    }
    if (generation !== state.cameraGeneration || document.hidden) {
      stopMediaStream(stream);
      if (elements.video.srcObject === stream) elements.video.srcObject = null;
      return false;
    }
    state.cameraReady = true;
    state.cameraError = null;
    elements.stage.classList.add("has-camera");
    differencer.reset();
    resetTrackerTarget();
    state.calibratingUntil = performance.now() + 800;
    if (state.trackedColor) setTrackerStatus("READY", "tracking");
    updateStatus();
    return true;
  } finally {
    if (generation === state.cameraGeneration) state.cameraStarting = false;
  }
}

function setStartButtonLabel(label) {
  elements.startButton.querySelector("span").textContent = label;
}

async function startExperience() {
  elements.startButton.disabled = true;
  setStartButtonLabel("Starting…");
  state.cameraError = null;
  let cameraRequested = false;
  try {
    await audio.ensureStarted();
    audio.setMuted(false);
    cameraRequested = true;
    if (!(await startCamera())) return;
    state.started = true;
    elements.startScreen.hidden = true;
    elements.coach.hidden = false;
    setStageStatus("Calibrating motion", "calibrating");
    updateStatus();
    showToast("Camera ready — move to perform or paint a sound zone");
  } catch (error) {
    state.cameraError = error;
    if (cameraRequested && (error?.name === "NotAllowedError" || error?.name === "SecurityError")) {
      showToast("Camera permission blocked — allow access, then retry");
    } else {
      showToast(cameraRequested
        ? "Camera unavailable — check access, then retry"
        : "Audio unavailable — check browser access, then retry");
    }
  } finally {
    elements.startButton.disabled = false;
    setStartButtonLabel(state.cameraError ? "Retry camera" : "Start camera");
  }
}

function getNormalizedPointer(event) {
  return displayPointToNormalized(event.clientX, event.clientY, elements.stage.getBoundingClientRect());
}

function sampleTrackedColorAt(point) {
  if (!state.cameraReady || !drawVideoCover()) {
    showToast("The camera frame is not ready yet");
    setTrackerStatus("CAMERA OFF", "idle");
    return false;
  }
  const frame = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const color = sampleFrameColor(
    frame.data,
    analysisCanvas.width,
    analysisCanvas.height,
    point.x * analysisCanvas.width,
    point.y * analysisCanvas.height,
    { radius: 2 },
  );
  if (!color) {
    showToast("Could not read a color there — try again");
    return false;
  }

  state.colorPickerArmed = false;
  state.trackedColor = color;
  state.trackerPoint = { ...point };
  state.lastColorMask = null;
  state.trackerNextAllowedAt.clear();
  resetPerformancePoint({ hideMarker: true });
  resetTrackerTarget();
  updateTrackedColorControls();
  setTrackerStatus("SEARCHING", "armed");
  const label = `${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}`;
  showToast(`Tracking rgb(${label}) — move it through the instrument`);
  updateStatus();
  return true;
}

function brushSizeNormalized() {
  return Number(elements.brushSize.value) / Math.min(state.stageWidth, state.stageHeight);
}

function zoneAtPoint(point) {
  const x = clamp(Math.floor(point.x * analysisCanvas.width), 0, analysisCanvas.width - 1);
  const y = clamp(Math.floor(point.y * analysisCanvas.height), 0, analysisCanvas.height - 1);
  const id = state.owners[y * analysisCanvas.width + x];
  return state.zones.find((zone) => zone.id === id) ?? null;
}

function eraseAt(point) {
  const zone = zoneAtPoint(point);
  if (!zone) return;
  if (!state.gesture.historySaved) {
    saveHistory();
    state.gesture.historySaved = true;
  }
  state.zones = state.zones.filter((candidate) => candidate.id !== zone.id);
  rebuildOwnershipMap();
  updateStatus();
}

function handlePointerDown(event) {
  if (!state.started) return;
  const point = getNormalizedPointer(event);
  if (state.colorPickerArmed) {
    event.preventDefault();
    sampleTrackedColorAt(point);
    return;
  }
  elements.paintCanvas.setPointerCapture(event.pointerId);

  if (state.tool === "erase") {
    state.gesture = { pointerId: event.pointerId, type: "erase", historySaved: false };
    eraseAt(point);
    return;
  }

  saveHistory();
  const zone = {
    id: state.nextZoneId,
    type: state.tool,
    instrument: state.instrument,
    points: [point],
    size: brushSizeNormalized(),
  };
  state.nextZoneId += 1;
  if (state.tool === "line" || state.tool === "rect") zone.points.push({ ...point });
  if (state.tool === "dot") zone.radius = Math.max(zone.size / 2, 0.015);
  state.zones.push(zone);
  state.gesture = { pointerId: event.pointerId, type: state.tool, zone, start: point };
  updateStatus();
}

function handlePointerMove(event) {
  const point = getNormalizedPointer(event);
  if (state.colorPickerArmed) return;
  if (!state.gesture || state.gesture.pointerId !== event.pointerId) return;
  if (state.gesture.type === "erase") {
    eraseAt(point);
    return;
  }

  const zone = state.gesture.zone;
  if (zone.type === "brush") {
    const previous = zone.points.at(-1);
    const dx = (point.x - previous.x) * state.stageWidth;
    const dy = (point.y - previous.y) * state.stageHeight;
    if (dx * dx + dy * dy >= 5) zone.points.push(point);
  } else if (zone.type === "dot") {
    const dx = (point.x - state.gesture.start.x) * state.stageWidth;
    const dy = (point.y - state.gesture.start.y) * state.stageHeight;
    zone.radius = clamp(Math.hypot(dx, dy) / Math.min(state.stageWidth, state.stageHeight), zone.size / 2, 0.32);
  } else {
    zone.points[1] = point;
  }
}

function finishPointer(event) {
  if (!state.gesture || state.gesture.pointerId !== event.pointerId) return;
  const gesture = state.gesture;
  if (gesture.type === "rect") {
    const zone = gesture.zone;
    const width = Math.abs(zone.points[1].x - zone.points[0].x) * state.stageWidth;
    const height = Math.abs(zone.points[1].y - zone.points[0].y) * state.stageHeight;
    if (width < 18 && height < 18) {
      const padWidth = clamp(brushSizeNormalized() * 3.6, 0.12, 0.34);
      const padHeight = padWidth * state.stageWidth / state.stageHeight * 0.58;
      zone.points[0] = {
        x: clamp(gesture.start.x - padWidth / 2, 0, 1),
        y: clamp(gesture.start.y - padHeight / 2, 0, 1),
      };
      zone.points[1] = {
        x: clamp(gesture.start.x + padWidth / 2, 0, 1),
        y: clamp(gesture.start.y + padHeight / 2, 0, 1),
      };
    }
  }
  state.gesture = null;
  state.hasPainted = state.hasPainted || gesture.type !== "erase";
  rebuildOwnershipMap();
  updateStatus();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(cloneZones(state.zones));
  state.zones = state.history.pop();
  rebuildOwnershipMap();
  updateStatus();
  showToast("Undid last paint gesture");
}

function redo() {
  if (!state.future.length) return;
  state.history.push(cloneZones(state.zones));
  state.zones = state.future.pop();
  rebuildOwnershipMap();
  updateStatus();
  showToast("Redid paint gesture");
}

function clearZones() {
  if (!state.zones.length) return;
  saveHistory();
  state.zones = [];
  rebuildOwnershipMap();
  updateStatus();
  showToast("Canvas cleared — Undo brings it back");
}

function loadStarterKit() {
  saveHistory();
  state.zones = starterZones(state.nextZoneId);
  state.nextZoneId += state.zones.length;
  state.hasPainted = true;
  rebuildOwnershipMap();
  updateStatus();
  showToast("Four-pad drum kit loaded");
}

async function toggleMute() {
  const hadAudioContext = Boolean(audio.context);
  try {
    if (!audio.context) await audio.ensureStarted();
  } catch (error) {
    showToast(error.message);
    return;
  }
  audio.setMuted(hadAudioContext ? !audio.muted : false);
  setStageStatus(audio.muted ? "Muted" : state.cameraReady ? "Camera active" : "Camera off", audio.muted ? "muted" : state.cameraReady ? "live" : "ready");
  updateStatus();
  showToast(audio.muted ? "Sound muted" : "Sound on");
}

function setMotionView(enabled, announce = true) {
  state.motionView = Boolean(enabled);
  elements.motionViewButton?.setAttribute("aria-pressed", String(state.motionView));
  elements.stage.classList.toggle("is-motion-view", state.motionView);
  elements.stage.dataset.motionView = state.motionView ? "mono" : "color";
  elements.feedbackCanvas.classList.toggle("is-motion-view", state.motionView);
  if (announce) showToast(state.motionView ? "Black + white motion view" : "Color camera view");
}

function updateSampleControls(message, kind) {
  if (elements.sampleStatus) {
    elements.sampleStatus.textContent = message ?? (audio.hasSample ? "Sample ready" : "No sample");
    elements.sampleStatus.dataset.state = kind ?? (audio.hasSample ? "ready" : "empty");
  }
  elements.recordSampleButton?.setAttribute("aria-pressed", String(state.recording));
  if (elements.recordButtonLabel) {
    elements.recordButtonLabel.textContent = state.recording ? "Stop recording" : "Record sample";
  }
  if (elements.clearSampleButton) elements.clearSampleButton.disabled = !audio.hasSample || state.recording;
}

function stopRecordClock() {
  clearInterval(state.recordTimer);
  state.recordTimer = 0;
}

function finishRecording(buffer, token) {
  if (token !== state.recordToken) return;
  state.recordToken += 1;
  state.recording = false;
  stopRecordClock();
  if (buffer) {
    setInstrument("sample");
    updateSampleControls("Sample ready", "ready");
    showToast("Microphone sample ready — paint it or press 5");
  } else {
    updateSampleControls("No sample", "empty");
  }
}

async function toggleSampleRecording() {
  if (state.recording) {
    const token = state.recordToken;
    try {
      const buffer = await recorder.stop();
      finishRecording(buffer, token);
    } catch (error) {
      finishRecording(null, token);
      updateSampleControls("Recording failed", "error");
      showToast(error.message);
    }
    return;
  }

  const token = state.recordToken + 1;
  state.recordToken = token;
  if (elements.recordSampleButton) elements.recordSampleButton.disabled = true;
  try {
    await recorder.start({ maxDurationMs: 8_000 });
    state.recording = true;
    state.recordStartedAt = performance.now();
    updateSampleControls("Recording…", "recording");
    state.recordTimer = setInterval(() => {
      const seconds = (performance.now() - state.recordStartedAt) / 1_000;
      if (elements.sampleStatus) elements.sampleStatus.textContent = `Recording ${seconds.toFixed(1)}s`;
    }, 100);
    recorder.finished
      .then((buffer) => finishRecording(buffer, token))
      .catch((error) => {
        if (token !== state.recordToken) return;
        finishRecording(null, token);
        updateSampleControls("Recording failed", "error");
        showToast(error.message);
      });
  } catch (error) {
    updateSampleControls("Microphone unavailable", "error");
    showToast(error.message);
  } finally {
    if (elements.recordSampleButton) elements.recordSampleButton.disabled = false;
  }
}

function clearSample() {
  if (state.recording) return;
  audio.clearSample();
  if (state.instrument === "sample") setInstrument("kick");
  updateSampleControls("No sample", "empty");
  showToast("Microphone sample cleared");
}

function handleKeyboard(event) {
  const target = event.target;
  if (target.closest?.("input, button, select, textarea, summary, a[href], [contenteditable='true'], [role='button']")) return;
  if (target.closest?.(".masthead")) return;
  if (event.key === "Escape" && state.colorPickerArmed) {
    cancelColorPicker();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  const instrument = INSTRUMENTS.find((candidate) => candidate.key === event.key);
  if (instrument) {
    setInstrument(instrument.id);
    previewInstrument(instrument.id);
    return;
  }
  const shortcuts = { b: "brush", l: "line", r: "rect", o: "dot", e: "erase" };
  if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
  if (event.key === " ") {
    event.preventDefault();
    toggleMute();
  }
  if (event.key === "[" || event.key === "]") {
    const direction = event.key === "[" ? -1 : 1;
    elements.brushSize.value = String(clamp(Number(elements.brushSize.value) + direction * 4, 12, 96));
  }
}

setStartButtonLabel("Start camera");
elements.startButton.addEventListener("click", startExperience);
elements.cameraButton.addEventListener("click", async () => {
  if (state.cameraStarting) {
    stopCamera();
    showToast("Camera start cancelled");
    return;
  }
  if (state.cameraReady) {
    stopCamera();
    showToast("Camera off — pointer and touch still paint");
    return;
  }
  try {
    if (await startCamera()) showToast("Camera ready — movement is live");
  } catch (error) {
    showToast("Could not start camera");
  }
});
elements.mirrorButton.addEventListener("click", () => {
  state.mirrored = !state.mirrored;
  elements.video.classList.toggle("is-unmirrored", !state.mirrored);
  differencer.reset();
  resetPerformancePoint({ hideMarker: true });
  resetTrackerTarget();
  updateStatus();
  showToast(state.mirrored ? "Camera mirrored" : "Camera unmirrored");
});
elements.muteButton.addEventListener("click", toggleMute);
elements.audioButton?.addEventListener("click", toggleMute);
elements.presetSelect?.addEventListener("change", () => setPreset(elements.presetSelect.value));
elements.presetButtons
  .filter((control) => control.matches("button"))
  .forEach((button) => button.addEventListener("click", () => setPreset(button.dataset.preset)));
elements.toolButtons.forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
elements.instrumentButtons.forEach((button) => button.addEventListener("click", () => {
  setInstrument(button.dataset.instrument);
  if (state.started) previewInstrument(button.dataset.instrument);
}));
elements.undoButton.addEventListener("click", undo);
elements.redoButton.addEventListener("click", redo);
elements.clearButton.addEventListener("click", clearZones);
elements.starterKitButton.addEventListener("click", loadStarterKit);
elements.sampleColorButton?.addEventListener("click", () => {
  if (!state.colorPickerArmed) {
    armColorPicker();
    return;
  }
  cancelColorPicker();
});
elements.clearTrackedColor?.addEventListener("click", () => clearTrackedColor());
elements.motionViewButton?.addEventListener("click", () => setMotionView(!state.motionView));
elements.recordSampleButton?.addEventListener("click", toggleSampleRecording);
elements.clearSampleButton?.addEventListener("click", clearSample);
elements.colorTolerance?.addEventListener("input", () => {
  if (elements.colorToleranceOutput) elements.colorToleranceOutput.textContent = elements.colorTolerance.value;
});
function setVolume(percent) {
  const value = clamp(Number(percent), 0, 100);
  audio.setVolume(value / 100);
  elements.volume.value = String(value);
  if (elements.headerVolume) elements.headerVolume.value = String(value);
  if (elements.headerVolumeOut) elements.headerVolumeOut.textContent = `${Math.round(value)}%`;
}

elements.volume.addEventListener("input", () => setVolume(elements.volume.value));
elements.headerVolume?.addEventListener("input", () => setVolume(elements.headerVolume.value));
elements.coachClose.addEventListener("click", () => { elements.coach.hidden = true; });
elements.paintCanvas.addEventListener("pointerdown", handlePointerDown);
elements.paintCanvas.addEventListener("pointermove", handlePointerMove);
elements.paintCanvas.addEventListener("pointerup", finishPointer);
elements.paintCanvas.addEventListener("pointercancel", finishPointer);
elements.paintCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", handleKeyboard);
window.addEventListener("pagehide", () => {
  state.recordToken += 1;
  state.recording = false;
  stopRecordClock();
  recorder.cancel();
  clearScheduledHarpPlucks();
  audio.stopAllGesturePads({ release: 0.01 });
  stopCamera();
  audio.close();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearScheduledHarpPlucks();
  resetPerformancePoint({ hideMarker: true });
  resetTrackerTarget();
  audio.stopAllGesturePads({ release: document.hidden ? 0.02 : 0.06 });
  paintTriggerGate.reset();
  gridTriggerGate.reset();
  if (document.hidden) {
    state.lastMotionMask = null;
    state.lastMotionLevels = null;
    return;
  }
  differencer.reset();
  state.calibratingUntil = performance.now() + 500;
});

const resizeObserver = new ResizeObserver(resizeStage);
resizeObserver.observe(elements.stage);

const debugEnabled = new URLSearchParams(window.location.search).has("debug");
elements.debugPanel.hidden = !debugEnabled;
if (debugEnabled) {
  window.__GESTURAMA_DEBUG__ = Object.freeze({
    getState: () => ({
      preset: state.preset,
      zones: cloneZones(state.zones),
      motionPixels: state.lastMotionCount,
      hitCounts: Object.fromEntries(state.hitCounts),
      harpHits: state.harpHits,
      cameraReady: state.cameraReady,
      motionView: state.motionView,
      recording: state.recording,
      hasSample: audio.hasSample,
      activePad: state.activePadKey,
      trackedColor: state.trackedColor ? { ...state.trackedColor } : null,
      trackerTarget: state.trackerTargetKey,
    }),
    loadStarterKit,
    setPreset,
    armColorPicker,
    clearTrackedColor,
    setMotionView,
  });
}

setInstrument("kick");
setTool("brush");
setPreset(elements.presetSelect?.value ?? "drums", false);
setMotionView(false, false);
setVolume(elements.volume.value);
updateSampleControls();
updateTrackedColorControls();
if (elements.colorToleranceOutput && elements.colorTolerance) {
  elements.colorToleranceOutput.textContent = elements.colorTolerance.value;
}
updateStatus();
requestAnimationFrame(renderFrame);
requestAnimationFrame(analysisLoop);
