import {
  STRIPED_STAIRCASE_DEFAULTS,
  advancePingPong,
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

const $ = (id) => document.getElementById(id);
const FRAME_UI_INTERVAL = 70;
const FIELD_REFRESH_DELAY = 92;
const PIXEL_BUDGET = 1_450_000;
const MAX_PIXEL_RATIO = 2;

const canvas = $("stage");
const stageWrap = $("stageWrap");
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

const state = {
  progress: STRIPED_STAIRCASE_DEFAULTS.progress,
  speed: STRIPED_STAIRCASE_DEFAULTS.speed,
  motionMode: STRIPED_STAIRCASE_DEFAULTS.motionMode,
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
};

let animationFrameId = 0;
let lastFrameTime = 0;
let lastUiTime = -Infinity;
let lastPublishedStep = -1;
let fieldRefreshTimer = 0;
let resizeObserver = null;
let disposed = false;

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
  lastPublishedStep = frame.stepIndex;
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
  $("clockReadout").textContent = state.motionMode === "slide"
    ? `interpolating · ${Math.round(frame.stepPhase * 100)}%`
    : `whole interval · ${Math.round(frame.stepPhase * 100)}%`;
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
    state.renderer.render(frame, state.settings, state.camera, state.direction);
    hideRenderError();
  } catch (error) {
    showRenderError(error);
  }
  publishStep(frame);
  updateInterface(false, timestamp);
}

function tick(timestamp) {
  animationFrameId = 0;
  if (disposed) return;
  if (state.playing && !document.hidden) {
    if (lastFrameTime > 0) {
      const elapsed = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
      const next = advancePingPong(state.progress, state.direction, elapsed * state.speed);
      state.progress = next.progress;
      state.direction = next.direction;
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
  updateViewButtons();
  updateInterface(true);
  refreshFieldNow();
  if (speak) announce(`${view.label} view loaded.`);
}

function markViewModified() {
  state.viewModified = true;
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
  }
  event.preventDefault();
}

function bindControls() {
  $("playButton").addEventListener("click", () => setPlaying(!state.playing, { speak: true }));

  $("progress").addEventListener("input", (event) => {
    state.progress = clamp(event.currentTarget.value, 0, 1);
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
      updateInterface(true);
      requestRender();
      if (changesField) scheduleFieldRefresh(130);
    });
    if (changesField) input.addEventListener("change", refreshFieldNow);
  }

  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => applyView(button.dataset.view));
  }
  $("resetView").addEventListener("click", () => applyView(state.selectedViewId));
  $("homeView").addEventListener("click", () => applyView(state.selectedViewId));
  $("zoomIn").addEventListener("click", () => zoomAtCenter(0.62, { speak: true }));
  $("zoomOut").addEventListener("click", () => zoomAtCenter(1.62, { speak: true }));

  $("resetAll").addEventListener("click", () => {
    state.progress = STRIPED_STAIRCASE_DEFAULTS.progress;
    state.speed = STRIPED_STAIRCASE_DEFAULTS.speed;
    state.motionMode = STRIPED_STAIRCASE_DEFAULTS.motionMode;
    state.direction = 1;
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
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.motionMode));
    }
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
