import {
  STRIPED_STAIRCASE_DEFAULTS,
  advancePingPong,
  cameraAtStaircaseDepth,
  cameraFromView,
  clamp,
  createStaircaseFrame,
  createStripedStaircaseRenderer,
  formatComplexCoordinate,
  normalizeStaircaseSettings,
  panCamera,
  staircaseBoundary,
  viewById,
  zoomCameraAt,
  zoomLevel,
} from "./src/striped-staircase.js";
import { VoicePool } from "./src/audio.js";
import {
  contourVoiceTrajectory,
  createStaircaseShapeField,
  staircaseGeometryRate,
  staircaseDepthContourContacts,
  voicesForStaircaseContacts,
} from "./src/striped-staircase-audio.js";

const $ = (id) => document.getElementById(id);
const FRAME_UI_INTERVAL = 70;
const FIELD_REFRESH_DELAY = 92;
const CONTOUR_TRAJECTORY_DELTA = 1 / 96;
const PIXEL_BUDGET = 1_450_000;
const MAX_PIXEL_RATIO = 2;
const PALETTES = Object.freeze({ glass: 0, ember: 1, ultraviolet: 2, ink: 3 });
const PALETTE_SOUND_SCHEMES = Object.freeze({
  glass: "shepard",
  ember: "rattlesnake",
  ultraviolet: "ouroboros",
  ink: "ink",
});
const SOUND_SCHEME_LABELS = Object.freeze({
  manual: "manual geometry",
  shepard: "Shepard register",
  ouroboros: "Ouroboros cycle",
  rattlesnake: "Rattlesnake edge",
  decomposition: "spatial decomposition",
  ink: "white sound / black silence",
});
const pool = new VoicePool(24);

const canvas = $("stage");
const stageWrap = $("stageWrap");
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

const state = {
  progress: STRIPED_STAIRCASE_DEFAULTS.progress,
  speed: STRIPED_STAIRCASE_DEFAULTS.speed,
  motionMode: STRIPED_STAIRCASE_DEFAULTS.motionMode,
  timingMode: "equal",
  diveOctaves: 6,
  playing: !reducedMotion?.matches,
  direction: 1,
  settings: {
    startIteration: STRIPED_STAIRCASE_DEFAULTS.startIteration,
    maxIterations: STRIPED_STAIRCASE_DEFAULTS.maxIterations,
    steps: STRIPED_STAIRCASE_DEFAULTS.steps,
    spacingCurve: STRIPED_STAIRCASE_DEFAULTS.spacingCurve,
    stripePeriod: STRIPED_STAIRCASE_DEFAULTS.stripePeriod,
    edgeSoftness: STRIPED_STAIRCASE_DEFAULTS.edgeSoftness,
  },
  selectedViewId: "seahorse",
  viewModified: false,
  camera: cameraFromView(viewById("seahorse")),
  renderer: null,
  renderState: "loading",
  contextLost: false,
  palette: "glass",
  audio: false,
  level: 0.48,
  soundPolarity: "white",
  colorSoundMode: "manual",
  playbackMode: "fill",
  baseFrequency: 73,
  pitchRange: 3,
  noiseAmount: 0.55,
  durationScale: 0.55,
  stereoSpread: 0.85,
  massLevel: 0.9,
  contourLevel: 0.55,
  rhythmLevel: 0.7,
  microLevel: 0.45,
};

let animationFrameId = 0;
let lastFrameTime = 0;
let lastUiTime = -Infinity;
let lastPublishedStep = -1;
let fieldRefreshTimer = 0;
let resizeObserver = null;
let disposed = false;
let lastSoundedStep = -1;
let diveAnchorCamera = state.camera;
let soundField = null;
let lastDrumTimeSlice = -1;

const activePointers = new Map();
let dragGesture = null;
let pinchGesture = null;

function compact(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

function zoomText() {
  const zoom = zoomLevel(state.camera);
  if (zoom < 10) return `${zoom.toFixed(2)}×`;
  if (zoom < 100) return `${zoom.toFixed(1)}×`;
  return `${Math.round(zoom).toLocaleString()}×`;
}

function coordinateDigits() {
  return Math.round(clamp(Math.ceil(-Math.log10(state.camera.scale)) + 5, 6, 12));
}

function currentFrame() {
  return createStaircaseFrame(state.progress, state.settings, state.motionMode);
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function updateDiveAnchorFromCamera() {
  if (state.timingMode !== "dive") return;
  diveAnchorCamera = Object.freeze({
    centerX: state.camera.centerX,
    centerY: state.camera.centerY,
    scale: clamp(
      state.camera.scale * 2 ** (state.progress * state.diveOctaves),
      0.00008,
      2.25,
    ),
  });
}

function refineDiveField() {
  if (state.timingMode !== "dive" || !state.renderer || state.contextLost) return;
  try {
    state.renderer.renderField({
      ...state.camera,
      scale: clamp(state.camera.scale * 1.28, 0.00008, 2.25),
    }, state.settings.maxIterations);
    setRenderState("LIVE FIELD");
  } catch (error) {
    showRenderError(error);
  }
}

function syncDiveCamera({ refine = false } = {}) {
  if (state.timingMode !== "dive") return;
  state.camera = cameraAtStaircaseDepth(diveAnchorCamera, state.progress, state.diveOctaves);
  if (refine) refineDiveField();
}

function soundMapping() {
  const colorSoundMode = state.colorSoundMode === "follow"
    ? PALETTE_SOUND_SCHEMES[state.palette]
    : state.colorSoundMode;
  return {
    baseFrequency: state.baseFrequency,
    pitchRange: state.pitchRange,
    noiseAmount: state.noiseAmount,
    durationScale: state.durationScale,
    stereoSpread: state.stereoSpread,
    microLevel: state.microLevel,
    colorSoundMode,
    transportProgress: state.progress,
    transportRate: state.speed * state.direction,
  };
}

function sonifyFrame(frame, { force = false } = {}) {
  if (!state.audio || (!force && frame.stepIndex === lastSoundedStep)) return;
  lastSoundedStep = frame.stepIndex;
  soundField = createStaircaseShapeField(
    state.camera,
    frame.bandLow,
    frame.bandHigh,
    state.settings.maxIterations,
    { polarity: state.soundPolarity },
  );
  lastDrumTimeSlice = -1;
  $("blobCountOut").textContent = soundField.components.length
    ? `${soundField.components.length} connected ${soundField.components.length === 1 ? "shape" : "shapes"}`
    : "black silence";
}

function triggerShapeDrums(contacts, frame) {
  if (contacts.timeSlice === lastDrumTimeSlice) return;
  lastDrumTimeSlice = contacts.timeSlice;
  const voices = voicesForStaircaseContacts(contacts, frame, soundMapping(), "fill");
  const depthAmount = frame.stepCount <= 1 ? 0 : frame.stepIndex / (frame.stepCount - 1);
  for (let index = 0; index < Math.min(8, voices.length); index += 1) {
    const contact = contacts.runs[index];
    const voice = voices[index];
    pool.strike({
      ...voice,
      key: `drum:${frame.stepIndex}:${contacts.timeSlice}:${index}`,
      gain: clamp(voice.gain * 1.65 * state.rhythmLevel, 0, 0.24),
    }, {
      attackSeconds: 0.002 + (1 - contact.size) * 0.008,
      decaySeconds: clamp(state.durationScale * (0.05 + contact.size * 0.48), 0.03, 1.2),
      attackNoise: clamp(
        state.noiseAmount * state.microLevel * 1.8
          * (contact.edgeRatio * 0.7 + depthAmount * 0.55),
        0,
        1,
      ),
    });
  }
}

function updatePlayheadAudio(frame) {
  if (!state.audio || !state.playing || !soundField) {
    if (state.audio) pool.setVoices([]);
    return;
  }
  const phase = state.direction > 0 ? frame.stepPhase : 1 - frame.stepPhase;
  const sweepDepth = frame.renderLow + (frame.renderHigh - frame.renderLow) * phase;
  const contacts = staircaseDepthContourContacts(soundField, sweepDepth, phase);
  if (state.playbackMode === "drums") {
    pool.setVoices([]);
    triggerShapeDrums(contacts, frame);
  } else if (state.playbackMode === "ensemble") {
    const fill = voicesForStaircaseContacts(contacts, frame, soundMapping(), "fill")
      .slice(0, 12)
      .map((voice) => ({ ...voice, key: `mass:${voice.key}`, gain: voice.gain * state.massLevel }));
    const edge = voicesForStaircaseContacts(contacts, frame, soundMapping(), "edge")
      .slice(0, 12)
      .map((voice) => ({ ...voice, key: `contour:${voice.key}`, gain: voice.gain * state.contourLevel }));
    const futurePhase = clamp(phase + CONTOUR_TRAJECTORY_DELTA, 0, 1);
    const futureDepth = frame.renderLow + (frame.renderHigh - frame.renderLow) * futurePhase;
    const futureContacts = staircaseDepthContourContacts(soundField, futureDepth, futurePhase);
    const futureFill = voicesForStaircaseContacts(futureContacts, frame, soundMapping(), "fill")
      .slice(0, 12)
      .map((voice) => ({ ...voice, key: `mass:${voice.key}`, gain: voice.gain * state.massLevel }));
    const futureEdge = voicesForStaircaseContacts(futureContacts, frame, soundMapping(), "edge")
      .slice(0, 12)
      .map((voice) => ({ ...voice, key: `contour:${voice.key}`, gain: voice.gain * state.contourLevel }));
    const trajectory = contourVoiceTrajectory(
      [...fill, ...edge],
      [...futureFill, ...futureEdge],
    );
    pool.setVoiceTrajectory(trajectory.current, trajectory.future, 0.055);
    triggerShapeDrums(contacts, frame);
  } else {
    const mode = state.playbackMode === "edge" ? "edge" : "fill";
    const layerLevel = mode === "edge" ? state.contourLevel : state.massLevel;
    const voices = voicesForStaircaseContacts(contacts, frame, soundMapping(), mode)
      .map((voice) => ({ ...voice, gain: voice.gain * layerLevel }));
    const futurePhase = clamp(phase + CONTOUR_TRAJECTORY_DELTA, 0, 1);
    const futureDepth = frame.renderLow + (frame.renderHigh - frame.renderLow) * futurePhase;
    const future = voicesForStaircaseContacts(
      staircaseDepthContourContacts(soundField, futureDepth, futurePhase),
      frame,
      soundMapping(),
      mode,
    ).map((voice) => ({ ...voice, gain: voice.gain * layerLevel }));
    const trajectory = contourVoiceTrajectory(voices, future);
    pool.setVoiceTrajectory(trajectory.current, trajectory.future, 0.055);
  }
  $("contactCountOut").textContent = `${contacts.runs.length} simultaneous contour ${contacts.runs.length === 1 ? "branch" : "branches"} · depth ${sweepDepth.toFixed(2)}`;
}

function announce(message) {
  const liveStatus = $("liveStatus");
  if (!liveStatus) return;
  liveStatus.textContent = "";
  requestAnimationFrame(() => {
    liveStatus.textContent = message;
  });
}

function setRenderState(value) {
  state.renderState = value;
  const readout = $("renderReadout");
  if (readout) readout.textContent = value;
}

function showRenderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("renderError").hidden = false;
  $("renderErrorCopy").textContent = message;
  setRenderState("RENDER OFFLINE");
}

function hideRenderError() {
  $("renderError").hidden = true;
  $("renderErrorCopy").textContent = "";
}

function publishStep(frame, source = "transport") {
  if (source === "transport" && frame.stepIndex === lastPublishedStep) return;
  const changedStep = frame.stepIndex !== lastPublishedStep;
  lastPublishedStep = frame.stepIndex;
  sonifyFrame(frame);
  if (changedStep && source === "transport") refineDiveField();
  globalThis.dispatchEvent?.(new CustomEvent("morphazoid:striped-staircase-step", {
    detail: Object.freeze({
      source,
      progress: frame.progress,
      stepIndex: frame.stepIndex,
      stepNumber: frame.stepNumber,
      stepCount: frame.stepCount,
      stepPhase: frame.stepPhase,
      bandLow: frame.bandLow,
      bandHigh: frame.bandHigh,
      renderLow: frame.renderLow,
      renderHigh: frame.renderHigh,
      motionMode: frame.motionMode,
      direction: state.direction,
    }),
  }));
}

function updatePlayButton() {
  const button = $("playButton");
  button.setAttribute("aria-pressed", String(state.playing));
  button.setAttribute("aria-label", state.playing ? "Pause depth motion" : "Play depth motion");
}

function setPlaying(playing, { speak = false } = {}) {
  state.playing = Boolean(playing);
  if (!state.playing && state.audio) pool.setVoices([]);
  lastFrameTime = 0;
  updatePlayButton();
  updateInterface(true);
  requestRender();
  if (speak) announce(state.playing ? "Depth motion playing." : "Depth motion paused.");
}

function updateRail(frame) {
  for (const button of $("depthRail").children) {
    const index = Number(button.dataset.step);
    button.toggleAttribute("aria-current", index === frame.stepIndex);
    if (index === frame.stepIndex) button.setAttribute("aria-current", "step");
    button.classList.toggle("is-passed", state.direction > 0
      ? index < frame.stepIndex
      : index > frame.stepIndex);
  }
}

function buildRail() {
  const rail = $("depthRail");
  const normalized = normalizeStaircaseSettings(state.settings);
  const buttons = [];
  for (let index = 0; index < normalized.steps; index += 1) {
    const button = document.createElement("button");
    const low = staircaseBoundary(index, normalized);
    const high = staircaseBoundary(index + 1, normalized);
    const depth = normalized.steps <= 1 ? 0 : index / (normalized.steps - 1);
    button.type = "button";
    button.dataset.step = String(index);
    button.style.setProperty("--step-width", `${Math.round(100 - 62 * Math.pow(depth, 0.72))}%`);
    button.setAttribute(
      "aria-label",
      `Step ${index + 1} of ${normalized.steps}, iterations ${low.toFixed(1)} to ${high.toFixed(1)}`,
    );
    button.title = `step ${index + 1} · ${low.toFixed(1)}—${high.toFixed(1)} iter`;
    button.addEventListener("click", () => {
      state.progress = clamp((index + 0.015) / normalized.steps, 0, 1);
      syncDiveCamera({ refine: true });
      publishStep(currentFrame(), "rail");
      updateInterface(true);
      requestRender();
      announce(`Depth step ${index + 1} of ${normalized.steps}.`);
    });
    buttons.push(button);
  }
  rail.replaceChildren(...buttons);
  updateRail(currentFrame());
}

function updateViewButtons() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.selectedViewId));
  }
}

function updateInterface(force = false, timestamp = performance.now()) {
  if (!force && timestamp - lastUiTime < FRAME_UI_INTERVAL) return;
  lastUiTime = timestamp;
  const frame = currentFrame();
  const bandLow = state.motionMode === "slide" ? frame.renderLow : frame.bandLow;
  const bandHigh = state.motionMode === "slide" ? frame.renderHigh : frame.bandHigh;
  const step = String(frame.stepNumber).padStart(2, "0");
  const count = String(frame.stepCount).padStart(2, "0");
  const band = `${bandLow.toFixed(1)}—${bandHigh.toFixed(1)}`;
  const direction = state.direction > 0 ? "inward" : "outward";
  const center = formatComplexCoordinate(
    state.camera.centerX,
    state.camera.centerY,
    coordinateDigits(),
  );
  const zoom = zoomText();
  const view = viewById(state.selectedViewId);

  $("progress").value = String(state.progress);
  $("progressOut").textContent = state.progress.toFixed(3);
  $("speedOut").textContent = `${state.speed.toFixed(3)} T/s`;
  $("stepReadout").textContent = `${step} / ${count}`;
  $("bandReadout").textContent = `iter ${band}`;
  const clockLabel = state.timingMode === "geometry"
    ? "shape time"
    : state.timingMode === "dive" ? "depth zoom" : "equal time";
  $("clockReadout").textContent = `${clockLabel} · ${Math.round(frame.stepPhase * 100)}%`;
  $("stageStepReadout").textContent = `STEP ${step} / ${count}`;
  $("stageBandReadout").textContent = `ITER ${band}`;
  $("flowSummary").textContent = `${state.motionMode} · ${state.playing ? `moving ${direction}` : "paused"}`;
  $("coordinateReadout").textContent = center;
  $("centerOut").textContent = center;
  $("zoomReadout").textContent = zoom;
  $("zoomOutText").textContent = `${zoom} · WebGL live`;
  $("viewSummary").textContent = `${view.label}${state.viewModified ? " · moved" : ""} · ${zoom}`;
  $("stripeSummary").textContent = `${frame.stepCount} steps · width ${compact(state.settings.stripePeriod, 1)}`;
  $("startIterationOut").textContent = compact(state.settings.startIteration, 0);
  $("maxIterationsOut").textContent = `${compact(state.settings.maxIterations, 0)} iter`;
  $("stepsOut").textContent = compact(state.settings.steps, 0);
  $("stripePeriodOut").textContent = `${state.settings.stripePeriod.toFixed(1)} iter`;
  $("edgeSoftnessOut").textContent = `${state.settings.edgeSoftness.toFixed(1)} iter`;
  $("colorSummary").textContent = state.palette[0].toUpperCase() + state.palette.slice(1);
  const playbackLabel = state.playbackMode === "edge"
    ? "edge line"
    : state.playbackMode === "drums"
      ? "shape drums"
      : state.playbackMode === "ensemble" ? "four heads" : "shape fill";
  const scheme = soundMapping().colorSoundMode;
  $("soundSummary").textContent = `${playbackLabel} · ${SOUND_SCHEME_LABELS[scheme]} · ${state.audio ? "audio on" : "audio off"}`;
  $("baseFrequencyOut").textContent = `${Math.round(state.baseFrequency)} Hz`;
  $("pitchRangeOut").textContent = `${state.pitchRange.toFixed(1)} oct`;
  $("noiseAmountOut").textContent = `${Math.round(state.noiseAmount * 100)}%`;
  $("durationScaleOut").textContent = `${state.durationScale.toFixed(2)}×`;
  $("stereoSpreadOut").textContent = `${Math.round(state.stereoSpread * 100)}%`;
  $("massLevelOut").textContent = `${Math.round(state.massLevel * 100)}%`;
  $("contourLevelOut").textContent = `${Math.round(state.contourLevel * 100)}%`;
  $("rhythmLevelOut").textContent = `${Math.round(state.rhythmLevel * 100)}%`;
  $("microLevelOut").textContent = `${Math.round(state.microLevel * 100)}%`;
  $("diveOctavesOut").textContent = `${state.diveOctaves.toFixed(1)} oct`;
  updatePlayButton();
  updateRail(frame);
}

function resizeRenderer() {
  if (!state.renderer || disposed) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const requestedRatio = Math.min(MAX_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
  const budgetRatio = Math.sqrt(PIXEL_BUDGET / Math.max(1, cssWidth * cssHeight));
  const ratio = Math.min(requestedRatio, budgetRatio);
  try {
    const changed = state.renderer.resize(cssWidth * ratio, cssHeight * ratio);
    if (changed) {
      setRenderState("BUILDING FIELD");
      state.renderer.renderField(state.camera, state.settings.maxIterations);
      setRenderState("LIVE FIELD");
    }
  } catch (error) {
    showRenderError(error);
  }
}

function refreshFieldNow() {
  if (!state.renderer || state.contextLost || disposed) return;
  if (fieldRefreshTimer) {
    clearTimeout(fieldRefreshTimer);
    fieldRefreshTimer = 0;
  }
  try {
    setRenderState("REFINING FIELD");
    state.renderer.renderField(state.camera, state.settings.maxIterations);
    setRenderState("LIVE FIELD");
    hideRenderError();
    requestRender();
  } catch (error) {
    showRenderError(error);
  }
}

function scheduleFieldRefresh(delay = FIELD_REFRESH_DELAY) {
  if (fieldRefreshTimer) clearTimeout(fieldRefreshTimer);
  setRenderState("NAVIGATING");
  fieldRefreshTimer = globalThis.setTimeout(() => {
    fieldRefreshTimer = 0;
    refreshFieldNow();
  }, delay);
}

function draw(timestamp) {
  if (!state.renderer || state.contextLost) return;
  const frame = currentFrame();
  try {
    state.renderer.render(
      frame,
      state.settings,
      state.camera,
      state.direction,
      PALETTES[state.palette] ?? 0,
    );
    hideRenderError();
  } catch (error) {
    showRenderError(error);
  }
  publishStep(frame);
  updatePlayheadAudio(frame);
  updateInterface(false, timestamp);
}

function tick(timestamp) {
  animationFrameId = 0;
  if (disposed) return;
  if (state.playing && !document.hidden) {
    if (lastFrameTime > 0) {
      const elapsed = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
      const timingRate = state.timingMode === "geometry"
        ? staircaseGeometryRate(state.progress, state.settings)
        : 1;
      const next = advancePingPong(
        state.progress,
        state.direction,
        elapsed * state.speed * timingRate,
      );
      state.progress = next.progress;
      state.direction = next.direction;
      if (state.timingMode === "dive") {
        state.camera = cameraAtStaircaseDepth(
          diveAnchorCamera,
          state.progress,
          state.diveOctaves,
        );
      }
    }
    lastFrameTime = timestamp;
  } else {
    lastFrameTime = 0;
  }
  draw(timestamp);
  if (state.playing && !document.hidden) requestRender();
}

function requestRender() {
  if (!animationFrameId && !disposed) animationFrameId = requestAnimationFrame(tick);
}

function applyView(id, { speak = true } = {}) {
  const view = viewById(id);
  state.selectedViewId = view.id;
  state.viewModified = false;
  state.camera = cameraFromView(view);
  diveAnchorCamera = state.camera;
  syncDiveCamera();
  lastSoundedStep = -1;
  updateViewButtons();
  $("viewPreset").value = view.id;
  updateInterface(true);
  refreshFieldNow();
  sonifyFrame(currentFrame(), { force: true });
  if (speak) announce(`${view.label} view loaded.`);
}

function markViewModified() {
  state.viewModified = true;
  updateDiveAnchorFromCamera();
  updateInterface(true);
}

function canvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    aspect: rect.width / Math.max(1, rect.height),
    height: rect.height,
  };
}

function zoomAtClient(clientX, clientY, factor, { refresh = true } = {}) {
  const point = canvasPoint(clientX, clientY);
  state.camera = zoomCameraAt(state.camera, point, factor, point.aspect);
  markViewModified();
  requestRender();
  if (refresh) scheduleFieldRefresh();
}

function zoomAtCenter(factor, { speak = false } = {}) {
  const rect = canvas.getBoundingClientRect();
  zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  if (speak) announce(`Zoom ${zoomText()}.`);
}

function beginSinglePointer(pointer) {
  dragGesture = {
    pointerId: pointer.pointerId,
    startX: pointer.clientX,
    startY: pointer.clientY,
    camera: state.camera,
  };
  pinchGesture = null;
}

function beginPinch() {
  const pointers = [...activePointers.values()].slice(0, 2);
  if (pointers.length < 2) return;
  const [first, second] = pointers;
  const midpoint = {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
  pinchGesture = {
    distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
    midpoint,
    camera: state.camera,
  };
  dragGesture = null;
}

function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  canvas.setPointerCapture?.(event.pointerId);
  activePointers.set(event.pointerId, {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (activePointers.size >= 2) beginPinch();
  else beginSinglePointer(activePointers.get(event.pointerId));
  stageWrap.classList.add("is-panning");
  if (fieldRefreshTimer) {
    clearTimeout(fieldRefreshTimer);
    fieldRefreshTimer = 0;
  }
  setRenderState("NAVIGATING");
  event.preventDefault();
}

function handlePointerMove(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  });

  const rect = canvas.getBoundingClientRect();
  if (activePointers.size >= 2) {
    if (!pinchGesture) beginPinch();
    const [first, second] = [...activePointers.values()].slice(0, 2);
    const midpoint = {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    };
    const distance = Math.max(1, Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY,
    ));
    const anchor = canvasPoint(pinchGesture.midpoint.x, pinchGesture.midpoint.y);
    const zoomed = zoomCameraAt(
      pinchGesture.camera,
      anchor,
      pinchGesture.distance / distance,
      anchor.aspect,
    );
    state.camera = panCamera(
      zoomed,
      midpoint.x - pinchGesture.midpoint.x,
      midpoint.y - pinchGesture.midpoint.y,
      rect.height,
    );
  } else if (dragGesture?.pointerId === event.pointerId) {
    state.camera = panCamera(
      dragGesture.camera,
      event.clientX - dragGesture.startX,
      event.clientY - dragGesture.startY,
      rect.height,
    );
  }
  markViewModified();
  requestRender();
  event.preventDefault();
}

function endPointer(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);
  canvas.releasePointerCapture?.(event.pointerId);
  if (activePointers.size >= 2) beginPinch();
  else if (activePointers.size === 1) beginSinglePointer([...activePointers.values()][0]);
  else {
    dragGesture = null;
    pinchGesture = null;
    stageWrap.classList.remove("is-panning");
    refreshFieldNow();
    sonifyFrame(currentFrame(), { force: true });
  }
  event.preventDefault();
}

function bindControls() {
  $("playButton").addEventListener("click", () => setPlaying(!state.playing, { speak: true }));

  $("audioButton").addEventListener("click", async () => {
    const button = $("audioButton");
    button.disabled = true;
    $("audioError").hidden = true;
    try {
      if (state.audio) {
        state.audio = false;
        pool.disable();
        $("audioState").textContent = "off";
        $("blobCountOut").textContent = "waiting for audio";
      } else {
        await pool.enable();
        pool.setLevel(state.level);
        state.audio = true;
        lastSoundedStep = -1;
        $("audioState").textContent = "on";
        sonifyFrame(currentFrame(), { force: true });
      }
    } catch (error) {
      state.audio = false;
      $("audioState").textContent = "error";
      $("audioError").textContent = error instanceof Error ? error.message : String(error);
      $("audioError").hidden = false;
    } finally {
      button.disabled = false;
      setPressed(button, state.audio);
      updateInterface(true);
    }
  });

  $("level").addEventListener("input", (event) => {
    state.level = clamp(event.currentTarget.value, 0, 1);
    $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
    pool.setLevel(state.level);
  });

  $("progress").addEventListener("input", (event) => {
    state.progress = clamp(event.currentTarget.value, 0, 1);
    syncDiveCamera({ refine: true });
    publishStep(currentFrame(), "scrub");
    updateInterface(true);
    requestRender();
  });

  $("speed").addEventListener("input", (event) => {
    state.speed = clamp(event.currentTarget.value, 0.005, 0.12);
    updateInterface(true);
  });

  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => {
      state.motionMode = button.dataset.mode === "slide" ? "slide" : "steps";
      for (const candidate of document.querySelectorAll("[data-mode]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      publishStep(currentFrame(), "mode");
      updateInterface(true);
      requestRender();
      announce(state.motionMode === "slide"
        ? "Slide mode. The active depth interval now glides continuously."
        : "Steps mode. One whole depth interval is active at a time.");
    });
  }

  for (const button of document.querySelectorAll("[data-timing]")) {
    button.addEventListener("click", () => {
      const nextMode = ["equal", "geometry", "dive"].includes(button.dataset.timing)
        ? button.dataset.timing
        : "equal";
      if (nextMode === "dive" && state.timingMode !== "dive") {
        diveAnchorCamera = Object.freeze({
          centerX: state.camera.centerX,
          centerY: state.camera.centerY,
          scale: clamp(
            state.camera.scale * 2 ** (state.progress * state.diveOctaves),
            0.00008,
            2.25,
          ),
        });
      }
      state.timingMode = nextMode;
      for (const candidate of document.querySelectorAll("[data-timing]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      $("timingNote").textContent = state.timingMode === "geometry"
        ? "Fine, deep bands receive less time, so the staircase accelerates as its shapes shrink."
        : state.timingMode === "dive"
          ? "The depth clock zooms toward the selected coordinate, then follows the same path back out."
          : "Every depth step receives the same amount of time.";
      $("diveOctaves").disabled = state.timingMode !== "dive";
      if (state.timingMode === "dive") {
        syncDiveCamera({ refine: true });
      }
      updateInterface(true);
      requestRender();
      announce(`${button.textContent} selected.`);
    });
  }

  $("diveOctaves").addEventListener("input", (event) => {
    state.diveOctaves = clamp(event.currentTarget.value, 1, 10);
    if (state.timingMode === "dive") {
      syncDiveCamera({ refine: true });
    }
    updateInterface(true);
    requestRender();
  });

  for (const button of document.querySelectorAll("[data-palette]")) {
    button.addEventListener("click", () => {
      state.palette = PALETTES[button.dataset.palette] === undefined ? "glass" : button.dataset.palette;
      for (const candidate of document.querySelectorAll("[data-palette]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      if (state.colorSoundMode === "follow") pool.silence();
      updateInterface(true);
      requestRender();
      announce(`${button.textContent} color palette selected.`);
    });
  }

  for (const button of document.querySelectorAll("[data-playback]")) {
    button.addEventListener("click", () => {
      state.playbackMode = ["fill", "edge", "drums", "ensemble"].includes(button.dataset.playback)
        ? button.dataset.playback
        : "fill";
      for (const candidate of document.querySelectorAll("[data-playback]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      $("playbackModeNote").textContent = state.playbackMode === "edge"
        ? "Each branch of the animated wavy depth contour becomes a continuously changing oscillator."
        : state.playbackMode === "drums"
          ? "Depth changes, contour entrances, splits, and merges become contour-weighted attacks."
          : state.playbackMode === "ensemble"
            ? "Four synchronized heads read mass, contour, topology/rhythm, and micro-detail from the same moving depth contour."
          : "The animated depth contour sustains every simultaneous branch as it travels inward and bifurcates.";
      pool.silence();
      lastDrumTimeSlice = -1;
      updateInterface(true);
      requestRender();
      announce(`${button.textContent} playback selected.`);
    });
  }

  for (const button of document.querySelectorAll("[data-polarity]")) {
    button.addEventListener("click", () => {
      state.soundPolarity = button.dataset.polarity === "black" ? "black" : "white";
      for (const candidate of document.querySelectorAll("[data-polarity]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      lastSoundedStep = -1;
      sonifyFrame(currentFrame(), { force: true });
      updateInterface(true);
    });
  }

  $("colorSoundMode").addEventListener("change", (event) => {
    const requested = event.currentTarget.value;
    state.colorSoundMode = [
      "manual", "follow", "shepard", "ouroboros", "rattlesnake", "decomposition", "ink",
    ].includes(requested) ? requested : "manual";
    pool.silence();
    lastDrumTimeSlice = -1;
    updateInterface(true);
    requestRender();
    const resolved = soundMapping().colorSoundMode;
    announce(`${SOUND_SCHEME_LABELS[resolved]} sound mapping selected.`);
  });

  const soundControls = [
    ["baseFrequency", "baseFrequency", 36, 220],
    ["pitchRange", "pitchRange", 0, 6],
    ["noiseAmount", "noiseAmount", 0, 1],
    ["durationScale", "durationScale", 0.1, 1.5],
    ["stereoSpread", "stereoSpread", 0, 1],
    ["massLevel", "massLevel", 0, 1],
    ["contourLevel", "contourLevel", 0, 1],
    ["rhythmLevel", "rhythmLevel", 0, 1],
    ["microLevel", "microLevel", 0, 1],
  ];
  for (const [id, key, minimum, maximum] of soundControls) {
    $(id).addEventListener("input", (event) => {
      state[key] = clamp(event.currentTarget.value, minimum, maximum);
      updateInterface(true);
    });
  }

  const settingControls = [
    ["startIteration", "startIteration", false],
    ["maxIterations", "maxIterations", true],
    ["steps", "steps", false],
    ["stripePeriod", "stripePeriod", false],
    ["edgeSoftness", "edgeSoftness", false],
  ];
  for (const [id, key, changesField] of settingControls) {
    const input = $(id);
    input.addEventListener("input", () => {
      state.settings[key] = Number(input.value);
      if (key === "steps") buildRail();
      lastSoundedStep = -1;
      sonifyFrame(currentFrame(), { force: true });
      updateInterface(true);
      requestRender();
      if (changesField) scheduleFieldRefresh(130);
    });
    if (changesField) input.addEventListener("change", refreshFieldNow);
  }

  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => applyView(button.dataset.view));
  }
  $("viewPreset").addEventListener("change", (event) => applyView(event.currentTarget.value));
  $("resetView").addEventListener("click", () => applyView(state.selectedViewId));
  $("homeView").addEventListener("click", () => applyView(state.selectedViewId));
  $("zoomIn").addEventListener("click", () => zoomAtCenter(0.62, { speak: true }));
  $("zoomOut").addEventListener("click", () => zoomAtCenter(1.62, { speak: true }));

  $("resetAll").addEventListener("click", () => {
    state.progress = STRIPED_STAIRCASE_DEFAULTS.progress;
    state.speed = STRIPED_STAIRCASE_DEFAULTS.speed;
    state.motionMode = STRIPED_STAIRCASE_DEFAULTS.motionMode;
    state.timingMode = "equal";
    state.diveOctaves = 6;
    state.direction = 1;
    state.palette = "glass";
    state.soundPolarity = "white";
    state.colorSoundMode = "manual";
    state.playbackMode = "fill";
    state.baseFrequency = 73;
    state.pitchRange = 3;
    state.noiseAmount = 0.55;
    state.durationScale = 0.55;
    state.stereoSpread = 0.85;
    state.massLevel = 0.9;
    state.contourLevel = 0.55;
    state.rhythmLevel = 0.7;
    state.microLevel = 0.45;
    state.settings = {
      startIteration: STRIPED_STAIRCASE_DEFAULTS.startIteration,
      maxIterations: STRIPED_STAIRCASE_DEFAULTS.maxIterations,
      steps: STRIPED_STAIRCASE_DEFAULTS.steps,
      spacingCurve: STRIPED_STAIRCASE_DEFAULTS.spacingCurve,
      stripePeriod: STRIPED_STAIRCASE_DEFAULTS.stripePeriod,
      edgeSoftness: STRIPED_STAIRCASE_DEFAULTS.edgeSoftness,
    };
    $("progress").value = String(state.progress);
    $("speed").value = String(state.speed);
    $("startIteration").value = String(state.settings.startIteration);
    $("maxIterations").value = String(state.settings.maxIterations);
    $("steps").value = String(state.settings.steps);
    $("stripePeriod").value = String(state.settings.stripePeriod);
    $("edgeSoftness").value = String(state.settings.edgeSoftness);
    $("diveOctaves").value = String(state.diveOctaves);
    $("diveOctaves").disabled = true;
    $("baseFrequency").value = String(state.baseFrequency);
    $("pitchRange").value = String(state.pitchRange);
    $("noiseAmount").value = String(state.noiseAmount);
    $("durationScale").value = String(state.durationScale);
    $("stereoSpread").value = String(state.stereoSpread);
    $("massLevel").value = String(state.massLevel);
    $("contourLevel").value = String(state.contourLevel);
    $("rhythmLevel").value = String(state.rhythmLevel);
    $("microLevel").value = String(state.microLevel);
    $("colorSoundMode").value = state.colorSoundMode;
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.motionMode));
    }
    for (const button of document.querySelectorAll("[data-timing]")) {
      button.setAttribute("aria-pressed", String(button.dataset.timing === state.timingMode));
    }
    for (const button of document.querySelectorAll("[data-palette]")) {
      button.setAttribute("aria-pressed", String(button.dataset.palette === state.palette));
    }
    for (const button of document.querySelectorAll("[data-polarity]")) {
      button.setAttribute("aria-pressed", String(button.dataset.polarity === state.soundPolarity));
    }
    for (const button of document.querySelectorAll("[data-playback]")) {
      button.setAttribute("aria-pressed", String(button.dataset.playback === state.playbackMode));
    }
    $("playbackModeNote").textContent = "The animated depth contour sustains every simultaneous branch as it travels inward and bifurcates.";
    $("timingNote").textContent = "Every depth step receives the same amount of time.";
    lastSoundedStep = -1;
    setPlaying(!reducedMotion?.matches);
    buildRail();
    applyView("seahorse", { speak: false });
    publishStep(currentFrame(), "reset");
    announce("Striped Staircase reset.");
  });
}

function bindCanvasInteraction() {
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", (event) => {
    if (activePointers.has(event.pointerId)) endPointer(event);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1;
    const delta = clamp(event.deltaY * unit, -260, 260);
    zoomAtClient(event.clientX, event.clientY, Math.exp(delta * 0.0019));
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    zoomAtClient(event.clientX, event.clientY, 0.48);
    announce(`Zoom ${zoomText()}.`);
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      setPlaying(!state.playing, { speak: true });
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAtCenter(0.62, { speak: true });
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomAtCenter(1.62, { speak: true });
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      applyView(state.selectedViewId);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const frame = currentFrame();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const index = clamp(frame.stepIndex + offset, 0, frame.stepCount - 1);
      state.progress = clamp((index + 0.015) / frame.stepCount, 0, 1);
      syncDiveCamera({ refine: true });
      publishStep(currentFrame(), "keyboard");
      updateInterface(true);
      requestRender();
      announce(`Depth step ${index + 1} of ${frame.stepCount}.`);
    }
  });
}

function initializeRenderer() {
  try {
    state.renderer?.destroy?.();
    state.renderer = createStripedStaircaseRenderer(canvas);
    state.contextLost = false;
    hideRenderError();
    resizeRenderer();
    refreshFieldNow();
    requestRender();
  } catch (error) {
    state.renderer = null;
    showRenderError(error);
  }
}

function dispose() {
  if (disposed) return;
  disposed = true;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if (fieldRefreshTimer) clearTimeout(fieldRefreshTimer);
  resizeObserver?.disconnect?.();
  state.renderer?.destroy?.();
  state.renderer = null;
  void pool.close();
}

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  state.contextLost = true;
  setRenderState("CONTEXT LOST");
  showRenderError("The GPU context was interrupted. Waiting for the browser to restore it.");
});
canvas.addEventListener("webglcontextrestored", () => {
  state.renderer = null;
  initializeRenderer();
  announce("Live fractal rendering restored.");
});

document.addEventListener("visibilitychange", () => {
  lastFrameTime = 0;
  if (document.hidden) pool.silence();
  if (!document.hidden) requestRender();
});
globalThis.addEventListener("pagehide", dispose, { once: true });

reducedMotion?.addEventListener?.("change", (event) => {
  if (event.matches && state.playing) setPlaying(false);
});

bindControls();
bindCanvasInteraction();
buildRail();
updateViewButtons();
updateInterface(true);
initializeRenderer();

if (typeof ResizeObserver === "function") {
  resizeObserver = new ResizeObserver(() => {
    resizeRenderer();
    requestRender();
  });
  resizeObserver.observe(stageWrap);
} else {
  globalThis.addEventListener("resize", () => {
    resizeRenderer();
    requestRender();
  });
}

requestRender();
