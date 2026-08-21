import {
  IDENTITY_TRANSFORM,
  applyMarkPointTransforms,
  interpolateRecordedPoint,
  interpolateSteadyPoint,
  markPathLength,
  pathBounds,
  polarCoordinateSources,
  polyphonyGainScale,
  reflectionTransforms,
  sanitizeMark,
  simplifyTimedPoints,
} from "./src/playhead-paint.js";
import { PlayheadPaintAudio } from "./src/playhead-paint-audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const STORAGE_KEY = "morphazoid:playhead-paint:v1";
const MIN_MARK_DURATION_MS = 60;
const STEADY_MARK_GAP_MS = 90;
const AUDIO_LOOKAHEAD_SECONDS = 0.075;
const MAX_MARKS = 400;
const MAX_HISTORY = 40;
const AXIS_IDS = Object.freeze(["horizontal", "vertical", "diagonal", "antiDiagonal"]);
const MAP_TARGETS = Object.freeze([
  { id: "none", label: "None" },
  { id: "pitch", label: "Pitch" },
  { id: "pan", label: "Stereo pan" },
  { id: "brightness", label: "Brightness" },
  { id: "gain", label: "Level" },
  { id: "modulationDepth", label: "FM depth" },
  { id: "shepard", label: "Shepard spiral" },
  { id: "ouroboros", label: "Ouroboros orbit" },
]);

const DEFAULT_ENVELOPE = Object.freeze({
  attackMs: 12,
  decayMs: 120,
  sustain: 0.72,
  releaseMs: 240,
});

const LAYER_DEFAULTS = Object.freeze([
  Object.freeze({
    id: "aqua",
    name: "Aqua",
    color: "#68dfbc",
    waveform: "sine",
    pitchOffset: 0,
    gain: 0.58,
    brightness: 0.58,
    envelope: Object.freeze({ ...DEFAULT_ENVELOPE }),
  }),
  Object.freeze({
    id: "rose",
    name: "Rose",
    color: "#f27ea8",
    waveform: "triangle",
    pitchOffset: -12,
    gain: 0.54,
    brightness: 0.72,
    envelope: Object.freeze({ attackMs: 8, decayMs: 150, sustain: 0.64, releaseMs: 320 }),
  }),
  Object.freeze({
    id: "gold",
    name: "Gold",
    color: "#f4cf63",
    waveform: "fm",
    pitchOffset: 7,
    gain: 0.46,
    brightness: 0.78,
    envelope: Object.freeze({ attackMs: 4, decayMs: 95, sustain: 0.52, releaseMs: 190 }),
  }),
  Object.freeze({
    id: "violet",
    name: "Violet",
    color: "#a995ef",
    waveform: "sawtooth",
    pitchOffset: -5,
    gain: 0.38,
    brightness: 0.42,
    envelope: Object.freeze({ attackMs: 55, decayMs: 260, sustain: 0.78, releaseMs: 620 }),
  }),
]);

function copyEnvelope(envelope = DEFAULT_ENVELOPE) {
  return {
    attackMs: clamp(Number(envelope.attackMs) || 0, 0, 1_200),
    decayMs: clamp(Number(envelope.decayMs) || 0, 0, 2_000),
    sustain: clamp(Number(envelope.sustain) || 0, 0, 1),
    releaseMs: clamp(Number(envelope.releaseMs) || 8, 8, 4_000),
  };
}

function copyTransform(transform = IDENTITY_TRANSFORM) {
  return {
    translateX: clamp(Number(transform?.translateX) || 0, -2, 2),
    translateY: clamp(Number(transform?.translateY) || 0, -2, 2),
    rotationDeg: clamp(Number(transform?.rotationDeg ?? transform?.rotation) || 0, -720, 720),
    scaleX: clamp(Number(transform?.scaleX) || 1, 0.05, 8),
    scaleY: clamp(Number(transform?.scaleY) || 1, 0.05, 8),
  };
}

function cloneMark(mark) {
  return {
    ...mark,
    samples: mark.samples.map((point) => ({ ...point })),
    axes: [...mark.axes],
    envelope: copyEnvelope(mark.envelope),
    transform: copyTransform(mark.transform),
  };
}

function cloneMarks(marks) {
  return marks.map(cloneMark);
}

function cloneLayers(source = LAYER_DEFAULTS) {
  return LAYER_DEFAULTS.map((fallback, index) => {
    const candidate = source[index] ?? {};
    const waveform = ["sine", "triangle", "sawtooth", "square", "fm"].includes(candidate.waveform)
      ? candidate.waveform
      : fallback.waveform;
    return {
      ...fallback,
      waveform,
      envelope: copyEnvelope(candidate.envelope ?? fallback.envelope),
    };
  });
}

const canvas = $("paintStage");
const stageWrap = $("stageWrap");
const drawingContext = canvas.getContext("2d", { alpha: false, desynchronized: true });
const audio = new PlayheadPaintAudio({ runtime: globalThis, maxVoices: 32, level: 0.56 });

const state = {
  marks: [],
  layers: cloneLayers(),
  selectedLayer: 0,
  selectedMarkId: null,
  tool: "draw",
  axes: [],
  brushSize: 0.014,
  mapping: {
    coordinateMode: "cartesian",
    radialSpokes: 8,
    xTarget: "pan",
    yTarget: "pitch",
    sizeTarget: "brightness",
    pitchMin: 55,
    pitchMax: 1_760,
  },
  sceneTransform: copyTransform(),
  transformTarget: "all",
  playbackMode: "original",
  playbackRate: 1,
  steadySpeed: 0.35,
  loopGapMs: 300,
  positionMs: 0,
  playbackStartedAtMs: 0,
  playing: false,
  output: 0.56,
  audioOn: false,
  audioStarting: false,
  audioGeneration: 0,
  history: [],
  draft: null,
  pointerId: null,
  pointerMode: null,
  pointerPoint: null,
  pointerStartedAt: 0,
  eraseHistorySaved: false,
  lastCaptureEndedAt: 0,
  timelineEndMs: 0,
};

let cssSize = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let markSequence = Date.now();
let activeLiveKeys = new Set();
let activePlaybackKeys = new Set();
let visualPlayheads = [];
let reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

function layerAt(index) {
  return state.layers[clamp(Math.round(Number(index) || 0), 0, state.layers.length - 1)];
}

function layerForMark(mark) {
  return state.layers.find(({ id }) => id === mark.layerId) ?? state.layers[0];
}

function selectedLayer() {
  return layerAt(state.selectedLayer);
}

function selectedMark() {
  return state.marks.find(({ id }) => id === state.selectedMarkId) ?? null;
}

function nextMarkId() {
  markSequence += 1;
  return `mark-${markSequence}`;
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function handleAudioPromise(promise) {
  Promise.resolve(promise).catch((error) => {
    if (error?.name !== "AbortError") showError(error);
  });
}

function pushHistory() {
  state.history.push(cloneMarks(state.marks));
  if (state.history.length > MAX_HISTORY) state.history.shift();
  $("undoButton").disabled = state.history.length === 0;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      marks: state.marks,
      layers: state.layers,
      selectedLayer: state.selectedLayer,
      axes: state.axes,
      brushSize: state.brushSize,
      mapping: state.mapping,
      sceneTransform: state.sceneTransform,
      playbackMode: state.playbackMode,
      playbackRate: state.playbackRate,
      steadySpeed: state.steadySpeed,
      loopGapMs: state.loopGapMs,
      output: state.output,
    }));
  } catch {
    // Persistence is optional. Drawing and audio remain available without it.
  }
}

function safeMapping(candidate = {}) {
  const validTarget = (value, fallback) => MAP_TARGETS.some(({ id }) => id === value) ? value : fallback;
  const pitchMin = clamp(Number(candidate.pitchMin) || 55, 24, 440);
  return {
    coordinateMode: ["cartesian", "polar", "spokes"].includes(candidate.coordinateMode)
      ? candidate.coordinateMode
      : "cartesian",
    radialSpokes: clamp(Math.round(Number(candidate.radialSpokes) || 8), 3, 32),
    xTarget: validTarget(candidate.xTarget, "pan"),
    yTarget: validTarget(candidate.yTarget, "pitch"),
    sizeTarget: validTarget(candidate.sizeTarget, "brightness"),
    pitchMin,
    pitchMax: clamp(Number(candidate.pitchMax) || 1_760, Math.max(220, pitchMin), 6_000),
  };
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return;
    state.layers = cloneLayers(Array.isArray(saved.layers) ? saved.layers : undefined);
    if (Array.isArray(saved.marks)) {
      const restored = [];
      let pointBudget = 60_000;
      for (let index = 0; index < Math.min(MAX_MARKS, saved.marks.length); index += 1) {
        const mark = sanitizeMark(saved.marks[index], { fallbackId: `saved-${index}` });
        if (!mark?.samples?.length || mark.samples.length > pointBudget) continue;
        pointBudget -= mark.samples.length;
        restored.push(mark);
      }
      state.marks = restored;
    }
    state.selectedLayer = clamp(Math.round(Number(saved.selectedLayer) || 0), 0, state.layers.length - 1);
    state.axes = AXIS_IDS.filter((axis) => saved.axes?.includes(axis));
    state.brushSize = clamp(Number(saved.brushSize) || state.brushSize, 0.005, 0.06);
    state.mapping = safeMapping(saved.mapping);
    state.sceneTransform = copyTransform(saved.sceneTransform);
    state.playbackMode = saved.playbackMode === "steady" ? "steady" : "original";
    state.playbackRate = clamp(Number(saved.playbackRate) || 1, 0.25, 2);
    state.steadySpeed = clamp(Number(saved.steadySpeed) || 0.35, 0.05, 1.5);
    state.loopGapMs = clamp(Number(saved.loopGapMs) || 0, 0, 3_000);
    state.output = clamp(Number(saved.output) || 0.56, 0, 0.9);
  } catch {
    // Ignore corrupt or unavailable saved data.
  }
  state.timelineEndMs = state.marks.reduce(
    (maximum, mark) => Math.max(maximum, mark.startOffsetMs + mark.durationMs),
    0,
  );
}

function createSelectOptions(select, selected) {
  const fragment = document.createDocumentFragment();
  for (const target of MAP_TARGETS) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.label;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = selected;
}

function renderMappingOptions() {
  createSelectOptions($("xTarget"), state.mapping.xTarget);
  createSelectOptions($("yTarget"), state.mapping.yTarget);
  createSelectOptions($("sizeTarget"), state.mapping.sizeTarget);
}

function updateCoordinateUi() {
  const mode = state.mapping.coordinateMode;
  const radial = mode !== "cartesian";
  const spokes = mode === "spokes";
  $("coordinateMode").value = mode;
  $("xSourceLabel").textContent = radial ? "Center radius" : "X axis";
  $("ySourceLabel").textContent = spokes
    ? "Spoke bearing / phase"
    : radial ? "Bearing / cyclic phase" : "Y axis";
  $("coordinateReadout").textContent = spokes
    ? `RADIUS / ${state.mapping.radialSpokes} SPOKES`
    : radial ? "RADIUS / BEARING" : "X / Y";
  $("radialSpokesControl").hidden = !spokes;
  $("radialSpokes").value = String(state.mapping.radialSpokes);
  $("radialSpokesOut").textContent = String(state.mapping.radialSpokes);
  $("stageSourceOne").textContent = radial ? "R" : "X";
  $("stageSourceTwo").textContent = spokes ? `S${state.mapping.radialSpokes}` : radial ? "B/φ" : "Y";
}

function renderPalette() {
  const fragment = document.createDocumentFragment();
  state.layers.forEach((layer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pp-layer-swatch";
    button.classList.toggle("is-active", index === state.selectedLayer);
    button.style.setProperty("--layer-color", layer.color);
    button.setAttribute("aria-label", `${layer.name} sound color`);
    button.setAttribute("aria-pressed", String(index === state.selectedLayer));
    button.title = `${layer.name}: ${layer.waveform}`;
    button.addEventListener("click", () => {
      state.selectedLayer = index;
      state.selectedMarkId = null;
      renderPalette();
      updateInspector();
      updateStatus();
      saveState();
      scheduleFrame();
    });
    fragment.append(button);
  });
  $("paintPalette").replaceChildren(fragment);
}

function formatFrequency(frequency) {
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency >= 2_000 ? 1 : 2)} kHz`;
  return `${Math.round(frequency)} Hz`;
}

function activeEnvelope() {
  return selectedMark()?.envelope ?? selectedLayer().envelope;
}

function updateEnvelopeControls() {
  const envelope = activeEnvelope();
  $("attack").value = String(envelope.attackMs);
  $("decay").value = String(envelope.decayMs);
  $("sustain").value = String(envelope.sustain);
  $("release").value = String(envelope.releaseMs);
  $("attackOut").textContent = `${Math.round(envelope.attackMs)} ms`;
  $("decayOut").textContent = `${Math.round(envelope.decayMs)} ms`;
  $("sustainOut").textContent = `${Math.round(envelope.sustain * 100)}%`;
  $("releaseOut").textContent = `${Math.round(envelope.releaseMs)} ms`;
  $("envelopeScope").textContent = selectedMark()
    ? `${selectedMark().id.toUpperCase()} MARK`
    : `${selectedLayer().name.toUpperCase()} DEFAULT`;
}

function transformBeingEdited() {
  if (state.transformTarget === "selected") return selectedMark()?.transform ?? null;
  return state.sceneTransform;
}

function updateTransformControls() {
  const transform = transformBeingEdited() ?? copyTransform();
  const disabled = state.transformTarget === "selected" && !selectedMark();
  for (const id of ["translateX", "translateY", "rotation", "scaleX", "scaleY"]) {
    $(id).disabled = disabled;
  }
  $("resetTransform").disabled = disabled;
  $("translateX").value = String(transform.translateX);
  $("translateY").value = String(transform.translateY);
  $("rotation").value = String(transform.rotationDeg);
  $("scaleX").value = String(transform.scaleX);
  $("scaleY").value = String(transform.scaleY);
  $("translateXOut").textContent = `${Math.round(transform.translateX * 100)}%`;
  $("translateYOut").textContent = `${Math.round(transform.translateY * 100)}%`;
  $("rotationOut").textContent = `${Math.round(transform.rotationDeg)}°`;
  $("scaleXOut").textContent = `${Math.round(transform.scaleX * 100)}%`;
  $("scaleYOut").textContent = `${Math.round(transform.scaleY * 100)}%`;
  $("transformReadout").textContent = state.transformTarget === "selected"
    ? selectedMark()?.id.toUpperCase() ?? "SELECT A MARK"
    : "ALL MARKS";
}

function updateInspector() {
  const layer = selectedLayer();
  $("layerName").textContent = `${layer.name.toUpperCase()} / ${layer.waveform.toUpperCase()}`;
  $("layerName").style.color = layer.color;
  $("waveform").value = layer.waveform;
  $("brushSize").value = String(state.brushSize);
  $("brushSizeOut").textContent = String(Math.round(state.brushSize * 1_000));
  $("xTarget").value = state.mapping.xTarget;
  $("yTarget").value = state.mapping.yTarget;
  $("sizeTarget").value = state.mapping.sizeTarget;
  $("pitchMin").value = String(state.mapping.pitchMin);
  $("pitchMax").value = String(state.mapping.pitchMax);
  $("pitchMinOut").textContent = formatFrequency(state.mapping.pitchMin);
  $("pitchMaxOut").textContent = formatFrequency(state.mapping.pitchMax);
  updateCoordinateUi();
  $("playbackModeOriginal").checked = state.playbackMode === "original";
  $("playbackModeSteady").checked = state.playbackMode === "steady";
  $("playbackRate").value = String(state.playbackRate);
  $("playbackRateOut").textContent = `${state.playbackRate.toFixed(2)}×`;
  $("steadySpeed").value = String(state.steadySpeed);
  $("steadySpeedOut").textContent = `${state.steadySpeed.toFixed(2)} /s`;
  $("loopGap").value = String(state.loopGapMs);
  $("loopGapOut").textContent = `${Math.round(state.loopGapMs)} ms`;
  $("output").value = String(state.output);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("transformTarget").value = state.transformTarget;
  updateEnvelopeControls();
  updateTransformControls();
}

function localOriginForMark(mark) {
  const bounds = pathBounds(mark.samples);
  return { x: bounds.centerX, y: bounds.centerY };
}

function transformedPoint(mark, point, reflection, localOrigin = localOriginForMark(mark)) {
  return applyMarkPointTransforms(
    point,
    mark.transform ?? IDENTITY_TRANSFORM,
    reflection,
    state.sceneTransform,
    { localOrigin },
  );
}

function coreAxes(axes) {
  return axes.map((axis) => {
    if (axis === "diagonal") return "antiDiagonal";
    if (axis === "antiDiagonal") return "diagonal";
    return axis;
  });
}

function transformsForMark(mark) {
  return reflectionTransforms(coreAxes(mark.axes));
}

function voicePointsForMark(mark, point) {
  const localOrigin = localOriginForMark(mark);
  const reflections = transformsForMark(mark);
  const gainScale = polyphonyGainScale(reflections.length);
  // Coincident positions still retain their D4 IDs. Dropping them on an axis
  // would gate voices off and retrigger them immediately after the crossing.
  return reflections.map((reflection) => ({
    transformId: reflection.id,
    point: transformedPoint(mark, point, reflection, localOrigin),
    gainScale,
  }));
}

function visualPointKey(markId, point) {
  return `${markId}:${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}`;
}

function dedupeVisualPoints(markId, points) {
  const seen = new Set();
  return points.filter(({ point }) => {
    const key = visualPointKey(markId, point);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sizeValue(mark) {
  return clamp((mark.brushSize - 0.005) / 0.055, 0, 1);
}

function coordinateSources(point) {
  if (state.mapping.coordinateMode === "cartesian") {
    const first = clamp(point.x, 0, 1);
    const second = clamp(point.y, 0, 1);
    return { first, second, phase: second, centerBlend: 1 };
  }
  const polar = polarCoordinateSources(point, {
    spokes: state.mapping.coordinateMode === "spokes" ? state.mapping.radialSpokes : 0,
  });
  return {
    first: polar.radius,
    second: polar.bearing,
    phase: polar.phase,
    centerBlend: polar.centerBlend,
  };
}

function voiceSpec(mark, point) {
  const layer = layerForMark(mark);
  const sources = coordinateSources(point);
  const values = {
    frequency: Math.sqrt(state.mapping.pitchMin * state.mapping.pitchMax),
    gain: layer.gain,
    pan: 0,
    brightness: layer.brightness,
    modulationDepth: layer.waveform === "fm" ? 0.58 : 0.16,
    shepardPosition: null,
    ouroborosPhase: null,
    ouroborosAmount: 1,
  };

  const applyRoute = (target, rawValue, {
    cyclicValue = rawValue,
    cyclicAmount = 1,
  } = {}) => {
    const value = clamp(Number(rawValue) || 0, 0, 1);
    if (target === "pitch") {
      values.frequency = state.mapping.pitchMin
        * ((state.mapping.pitchMax / state.mapping.pitchMin) ** value);
    } else if (target === "pan") {
      values.pan = value * 2 - 1;
    } else if (target === "brightness") {
      values.brightness = value;
    } else if (target === "gain") {
      values.gain = layer.gain * (0.16 + value * 0.84);
    } else if (target === "modulationDepth") {
      values.modulationDepth = value;
    } else if (target === "shepard") {
      // Shepard is keyed as a fixed three-voice bank, so use seam-free bearing
      // rather than relabeling octave identities at the circular phase seam.
      values.shepardPosition = value;
    } else if (target === "ouroboros") {
      values.ouroborosPhase = clamp(Number(cyclicValue) || 0, 0, 1);
      values.ouroborosAmount = clamp(Number(cyclicAmount) || 0, 0, 1);
    }
  };

  applyRoute(state.mapping.xTarget, sources.first);
  applyRoute(state.mapping.yTarget, sources.second, {
    cyclicValue: sources.phase,
    cyclicAmount: sources.centerBlend,
  });
  applyRoute(state.mapping.sizeTarget, sizeValue(mark));
  values.frequency *= 2 ** (layer.pitchOffset / 12);

  if (Number.isFinite(values.ouroborosPhase)) {
    const phase = values.ouroborosPhase * Math.PI * 2;
    const amount = values.ouroborosAmount;
    values.frequency *= 2 ** (Math.sin(phase) * 0.72 * amount);
    values.pan = clamp(
      values.pan * (1 - 0.58 * amount) + Math.cos(phase) * 0.58 * amount,
      -1,
      1,
    );
    const orbitBrightness = 0.5 + Math.sin(phase + Math.PI / 2) * 0.46;
    values.brightness += (orbitBrightness - values.brightness) * amount;
    const orbitModulation = Math.max(
      values.modulationDepth,
      0.18 + (0.5 + Math.cos(phase * 2) * 0.5) * 0.68,
    );
    values.modulationDepth += (orbitModulation - values.modulationDepth) * amount;
  }

  return {
    ...values,
    frequency: clamp(values.frequency, 20, 20_000),
    gain: clamp(values.gain, 0.001, 1),
    pan: clamp(values.pan, -1, 1),
    brightness: clamp(values.brightness, 0, 1),
    modulationDepth: clamp(values.modulationDepth, 0, 1),
    waveform: layer.waveform === "fm" ? "sine" : layer.waveform,
    shepardPosition: values.shepardPosition,
    ouroborosPhase: values.ouroborosPhase,
    ouroborosAmount: values.ouroborosAmount,
    adsr: copyEnvelope(mark.envelope),
  };
}

function audioSpecsForPoint(mark, point, gainScale = 1) {
  const spec = voiceSpec(mark, point);
  const normalizedGain = clamp(spec.gain * gainScale, 0.001, 1);
  if (!Number.isFinite(spec.shepardPosition)) {
    return [{ suffix: "tone", spec: { ...spec, gain: normalizedGain } }];
  }

  const centerFrequency = Math.sqrt(state.mapping.pitchMin * state.mapping.pitchMax)
    * 2 ** (layerForMark(mark).pitchOffset / 12);
  const phase = spec.shepardPosition;
  return [-1, 0, 1].map((octave, index) => {
    const octavePosition = octave + phase - 0.5;
    const windowPosition = clamp(Math.abs(octavePosition) / 1.5, 0, 1);
    const windowGain = Math.cos(windowPosition * Math.PI / 2) ** 2;
    return {
      suffix: `shepard-${index}`,
      spec: {
        ...spec,
        frequency: clamp(centerFrequency * 2 ** octavePosition, 20, 20_000),
        gain: normalizedGain * Math.max(0.001, windowGain),
      },
    };
  });
}

function playbackPlan() {
  if (!state.marks.length) return { entries: [], durationMs: 0 };
  if (state.playbackMode === "original") {
    const firstOffset = Math.min(...state.marks.map((mark) => mark.startOffsetMs));
    const entries = state.marks.map((mark) => ({
      mark,
      startMs: Math.max(0, mark.startOffsetMs - firstOffset),
      durationMs: Math.max(MIN_MARK_DURATION_MS, mark.durationMs),
      mode: "original",
    }));
    const contentEnd = Math.max(...entries.map(({ mark, startMs, durationMs }) => (
      startMs + durationMs + mark.envelope.releaseMs
    )));
    return { entries, durationMs: contentEnd + state.loopGapMs };
  }

  let cursor = 0;
  const entries = state.marks.map((mark) => {
    const length = markPathLength(mark);
    const durationMs = Math.max(MIN_MARK_DURATION_MS, length / state.steadySpeed * 1_000);
    const entry = { mark, startMs: cursor, durationMs, mode: "steady" };
    cursor += durationMs + STEADY_MARK_GAP_MS;
    return entry;
  });
  const contentEnd = Math.max(
    0,
    ...entries.map(({ mark, startMs, durationMs }) => startMs + durationMs + mark.envelope.releaseMs),
  );
  return { entries, durationMs: contentEnd + state.loopGapMs };
}

function entryPointAt(entry, localMs) {
  if (entry.mode === "steady") {
    return interpolateSteadyPoint(entry.mark, clamp(localMs / entry.durationMs, 0, 1));
  }
  return interpolateRecordedPoint(entry.mark, clamp(localMs, 0, entry.durationMs));
}

function voicesAtPosition(plan, positionMs) {
  const voices = new Map();
  for (const entry of plan.entries) {
    const localMs = positionMs - entry.startMs;
    if (localMs < 0 || localMs >= entry.durationMs) continue;
    const sourcePoint = entryPointAt(entry, localMs);
    for (const { transformId, point, gainScale } of voicePointsForMark(entry.mark, sourcePoint)) {
      for (const variant of audioSpecsForPoint(entry.mark, point, gainScale)) {
        const key = `play:${entry.mark.id}:${transformId}:${variant.suffix}`;
        voices.set(key, {
          key,
          visualKey: `${entry.mark.id}:${transformId}`,
          mark: entry.mark,
          point,
          spec: variant.spec,
        });
      }
    }
  }
  return voices;
}

function clockMs() {
  if (state.audioOn && Number.isFinite(audio.context?.currentTime)) {
    return audio.context.currentTime * 1_000;
  }
  return performance.now();
}

function currentPlaybackPosition(plan = playbackPlan(), nowMs = clockMs()) {
  if (!plan.durationMs) return 0;
  if (!state.playing) return clamp(state.positionMs, 0, plan.durationMs);
  const elapsed = Math.max(0, nowMs - state.playbackStartedAtMs) * state.playbackRate;
  return elapsed % plan.durationMs;
}

function syncPlaybackAudio(plan, positionMs) {
  const current = voicesAtPosition(plan, positionMs);
  const visuals = new Map();
  const visualPositions = new Set();
  for (const voice of current.values()) {
    if (visuals.has(voice.visualKey)) continue;
    const positionKey = visualPointKey(voice.mark.id, voice.point);
    if (visualPositions.has(positionKey)) continue;
    visualPositions.add(positionKey);
    visuals.set(voice.visualKey, {
      key: voice.visualKey,
      point: voice.point,
      color: layerForMark(voice.mark).color,
    });
  }
  visualPlayheads = [...visuals.values()];

  if (!state.audioOn || !audio.running) {
    activePlaybackKeys.clear();
    return;
  }

  const now = audio.context.currentTime;
  for (const [key, voice] of current) {
    if (!activePlaybackKeys.has(key)) {
      activePlaybackKeys.add(key);
      handleAudioPromise(audio.noteOn(key, voice.spec, { when: now }).then((started) => {
        if (!started) activePlaybackKeys.delete(key);
      }));
    } else {
      audio.updateVoice(key, voice.spec, { when: now });
    }
  }

  for (const key of [...activePlaybackKeys]) {
    if (current.has(key)) continue;
    activePlaybackKeys.delete(key);
    audio.noteOff(key, { when: now });
  }

  if (!plan.durationMs) return;
  const futurePosition = positionMs + AUDIO_LOOKAHEAD_SECONDS * 1_000 * state.playbackRate;
  if (futurePosition >= plan.durationMs) return;
  const future = voicesAtPosition(plan, futurePosition);
  for (const [key, voice] of future) {
    if (!current.has(key)) continue;
    audio.updateVoice(key, voice.spec, { when: now + AUDIO_LOOKAHEAD_SECONDS });
  }
}

function releasePlaybackVoices(releaseMs = 28) {
  const when = audio.context?.currentTime;
  for (const key of activePlaybackKeys) audio.noteOff(key, { when, releaseMs });
  activePlaybackKeys.clear();
  visualPlayheads = [];
}

function syncLiveVoices(mark, sourcePoint, start = false) {
  const points = voicePointsForMark(mark, sourcePoint);
  visualPlayheads = dedupeVisualPoints(mark.id, points).map(({ transformId, point }) => ({
    key: `live:${mark.id}:${transformId}`,
    point,
    color: layerForMark(mark).color,
  }));
  if (!state.audioOn || !audio.running) return;

  const now = audio.context.currentTime;
  const nextKeys = new Set();
  for (const { transformId, point, gainScale } of points) {
    for (const variant of audioSpecsForPoint(mark, point, gainScale)) {
      const key = `live:${mark.id}:${transformId}:${variant.suffix}`;
      nextKeys.add(key);
      if (start || !activeLiveKeys.has(key)) {
        activeLiveKeys.add(key);
        handleAudioPromise(audio.noteOn(key, variant.spec, { when: now }).then((started) => {
          if (!started) activeLiveKeys.delete(key);
        }));
      } else {
        audio.updateVoice(key, variant.spec, { when: now });
      }
    }
  }
  for (const key of [...activeLiveKeys]) {
    if (nextKeys.has(key)) continue;
    activeLiveKeys.delete(key);
    audio.noteOff(key, { when: now, releaseMs: 24 });
  }
}

function releaseLiveVoices(mark) {
  const when = audio.context?.currentTime;
  for (const key of activeLiveKeys) {
    audio.noteOff(key, { when, releaseMs: mark?.envelope?.releaseMs });
  }
  activeLiveKeys.clear();
  visualPlayheads = [];
}

function setAudioUi(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioButton").dataset.audioState = state.audioStarting ? "starting" : enabled ? "on" : "off";
  $("audioState").textContent = enabled ? "on" : "off";
}

async function enableAudio() {
  if (state.audioStarting) return false;
  const joinPlan = playbackPlan();
  let joinPosition = state.playing
    ? currentPlaybackPosition(joinPlan, performance.now())
    : state.positionMs;
  state.audioStarting = true;
  const generation = ++state.audioGeneration;
  $("audioButton").disabled = true;
  setAudioUi(false);
  clearError();
  try {
    await audio.start();
    if (generation !== state.audioGeneration || !audio.running) return false;
    if (state.playing) joinPosition = currentPlaybackPosition(joinPlan, performance.now());
    state.audioStarting = false;
    audio.setOutput(state.output);
    setAudioUi(true);
    if (state.playing) {
      state.positionMs = joinPosition;
      state.playbackStartedAtMs = clockMs() - joinPosition / state.playbackRate;
      syncPlaybackAudio(joinPlan, joinPosition);
    }
    announce("Playhead Paint audio on.");
    return true;
  } catch (error) {
    if (generation === state.audioGeneration) showError(error);
    state.audioStarting = false;
    setAudioUi(false);
    return false;
  } finally {
    if (generation === state.audioGeneration) {
      state.audioStarting = false;
      $("audioButton").disabled = false;
      setAudioUi(state.audioOn);
    }
  }
}

function disableAudio({ announceChange = true } = {}) {
  const leavePlan = playbackPlan();
  const leavePosition = state.playing
    ? currentPlaybackPosition(leavePlan, clockMs())
    : state.positionMs;
  state.audioGeneration += 1;
  state.audioStarting = false;
  releaseLiveVoices(state.draft);
  releasePlaybackVoices();
  audio.panic({ releaseMs: 12 });
  audio.setOutput(0);
  setAudioUi(false);
  if (state.playing) {
    state.positionMs = leavePosition;
    state.playbackStartedAtMs = performance.now() - leavePosition / state.playbackRate;
  }
  if (announceChange) announce("Playhead Paint audio off.");
}

function startPlayback() {
  const plan = playbackPlan();
  if (!plan.entries.length || !plan.durationMs) {
    announce("Draw a mark before starting playback.");
    return;
  }
  state.positionMs = clamp(state.positionMs, 0, plan.durationMs);
  state.playbackStartedAtMs = clockMs() - state.positionMs / state.playbackRate;
  state.playing = true;
  updateTransport(plan, state.positionMs);
  scheduleFrame();
  announce(state.audioOn
    ? `${state.playbackMode === "steady" ? "Steady" : "Original-time"} drawing playback started.`
    : "Drawing playback started silently. Turn Audio on to hear it.");
}

function pausePlayback() {
  if (!state.playing) return;
  const plan = playbackPlan();
  state.positionMs = currentPlaybackPosition(plan);
  state.playing = false;
  releasePlaybackVoices();
  updateTransport(plan, state.positionMs);
  scheduleFrame();
}

function stopPlayback() {
  state.playing = false;
  state.positionMs = 0;
  releasePlaybackVoices();
  updateTransport(playbackPlan(), 0);
  scheduleFrame();
}

function preservePlaybackPosition(update) {
  const oldPlan = playbackPlan();
  const oldPosition = currentPlaybackPosition(oldPlan);
  const ratio = oldPlan.durationMs ? oldPosition / oldPlan.durationMs : 0;
  update();
  const newPlan = playbackPlan();
  state.positionMs = ratio * newPlan.durationMs;
  if (state.playing) state.playbackStartedAtMs = clockMs() - state.positionMs / state.playbackRate;
  releasePlaybackVoices();
  updateStatus();
  updateTransport(newPlan, state.positionMs);
  saveState();
  scheduleFrame();
}

function updateTransport(plan = playbackPlan(), positionMs = currentPlaybackPosition(plan)) {
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playIcon").textContent = state.playing ? "\u25a0" : "\u25b6";
  $("playLabel").textContent = state.playing ? "Pause" : "Play";
  if (!plan.durationMs) {
    $("playbackReadout").textContent = "READY";
  } else {
    $("playbackReadout").textContent = `${(positionMs / 1_000).toFixed(1)} / ${(plan.durationMs / 1_000).toFixed(1)} S`;
  }
}

function updateSymmetryUi() {
  for (const button of document.querySelectorAll("[data-axis]")) {
    button.setAttribute("aria-pressed", String(state.axes.includes(button.dataset.axis)));
  }
  const voices = reflectionTransforms(coreAxes(state.axes)).length;
  $("symmetryCount").textContent = `${voices} ${voices === 1 ? "VOICE" : "VOICES"}`;
  $("voiceCount").textContent = String(voices);
  $("voiceCount").parentElement.lastChild.textContent = voices === 1 ? " PLAYHEAD" : " PLAYHEADS";
}

function updateStatus() {
  const plan = playbackPlan();
  $("markCount").textContent = String(state.marks.length);
  $("selectedReadout").textContent = selectedMark()
    ? `${selectedMark().id.toUpperCase()} / ${layerForMark(selectedMark()).name.toUpperCase()}`
    : "NO SELECTION";
  $("timelineReadout").textContent = `${(plan.durationMs / 1_000).toFixed(1)} S LOOP`;
  $("loopDurationOut").textContent = `${(plan.durationMs / 1_000).toFixed(1)} S`;
  $("undoButton").disabled = state.history.length === 0;
  updateSymmetryUi();
}

function setTool(tool) {
  state.tool = ["draw", "select", "erase"].includes(tool) ? tool : "draw";
  for (const button of document.querySelectorAll("[data-tool]")) {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  canvas.style.cursor = state.tool === "erase" ? "cell" : state.tool === "select" ? "default" : "crosshair";
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    y: 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
    pressure: clamp(Number(event.pressure) || (event.pointerType === "mouse" ? 0.5 : 0.5), 0, 1),
  };
}

function updateCursor(point) {
  state.pointerPoint = point;
  const temporaryMark = {
    brushSize: state.brushSize,
    envelope: selectedLayer().envelope,
    layerId: selectedLayer().id,
  };
  const spec = voiceSpec(temporaryMark, point);
  $("cursorReadout").textContent = `${formatFrequency(spec.frequency)} / ${Math.round((spec.pan + 1) * 50)}% PAN`;
  $("cursorReadout").style.setProperty("--cursor-x", `${point.x * 100}%`);
  $("cursorReadout").style.setProperty("--cursor-y", `${(1 - point.y) * 100}%`);
  $("cursorReadout").style.setProperty("--cursor-color", selectedLayer().color);
  $("cursorReadout").hidden = false;
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const amount = denominator > 0
    ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator, 0, 1)
    : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function distanceToMark(mark, point) {
  let nearest = Infinity;
  const localOrigin = localOriginForMark(mark);
  for (const reflection of transformsForMark(mark)) {
    const path = mark.samples.map((sample) => transformedPoint(mark, sample, reflection, localOrigin));
    if (path.length === 1) nearest = Math.min(nearest, Math.hypot(point.x - path[0].x, point.y - path[0].y));
    for (let index = 1; index < path.length; index += 1) {
      nearest = Math.min(nearest, distancePointToSegment(point, path[index - 1], path[index]));
    }
  }
  return nearest;
}

function markAtPoint(point, threshold = 0.026) {
  let best = null;
  let bestDistance = threshold;
  for (let index = state.marks.length - 1; index >= 0; index -= 1) {
    const mark = state.marks[index];
    const distance = distanceToMark(mark, point);
    if (distance >= bestDistance) continue;
    best = mark;
    bestDistance = distance;
  }
  return best;
}

function selectAt(point) {
  const mark = markAtPoint(point, 0.032);
  state.selectedMarkId = mark?.id ?? null;
  if (mark) {
    state.selectedLayer = Math.max(0, state.layers.findIndex(({ id }) => id === mark.layerId));
    state.transformTarget = "selected";
    renderPalette();
    announce(`${mark.id} selected.`);
  } else {
    announce("Selection cleared.");
  }
  updateInspector();
  updateStatus();
  scheduleFrame();
}

function eraseAt(point) {
  const mark = markAtPoint(point, Math.max(0.025, state.brushSize * 1.6));
  if (!mark) return false;
  if (!state.eraseHistorySaved) {
    pushHistory();
    state.eraseHistorySaved = true;
  }
  state.marks = state.marks.filter(({ id }) => id !== mark.id);
  if (state.selectedMarkId === mark.id) state.selectedMarkId = null;
  state.timelineEndMs = state.marks.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.startOffsetMs + candidate.durationMs),
    0,
  );
  updateInspector();
  updateStatus();
  saveState();
  scheduleFrame();
  return true;
}

function appendDraftSample(event) {
  if (!state.draft) return;
  const point = canvasPoint(event);
  const elapsed = Math.max(0, Number(event.timeStamp) - state.pointerStartedAt);
  const previous = state.draft.samples[state.draft.samples.length - 1];
  const sample = { ...point, tMs: Math.max(previous?.tMs ?? 0, elapsed) };
  if (
    !previous
    || Math.hypot(sample.x - previous.x, sample.y - previous.y) >= 0.0015
    || sample.tMs - previous.tMs >= 24
  ) {
    state.draft.samples.push(sample);
  } else {
    state.draft.samples[state.draft.samples.length - 1] = sample;
  }
  state.draft.durationMs = Math.max(MIN_MARK_DURATION_MS, sample.tMs);
  updateCursor(point);
  syncLiveVoices(state.draft, point);
}

function nextStartOffset(now) {
  if (!state.marks.length) return 0;
  const gap = state.lastCaptureEndedAt
    ? clamp(now - state.lastCaptureEndedAt, 0, 10_000)
    : 250;
  return state.timelineEndMs + gap;
}

function handlePointerDown(event) {
  if (state.pointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const point = canvasPoint(event);
  updateCursor(point);

  if (state.tool === "select") {
    selectAt(point);
    return;
  }

  if (state.playing) pausePlayback();
  state.pointerId = event.pointerId;
  state.pointerMode = state.tool;
  state.pointerStartedAt = Number(event.timeStamp) || performance.now();
  state.eraseHistorySaved = false;
  canvas.setPointerCapture?.(event.pointerId);

  if (state.tool === "erase") {
    eraseAt(point);
    return;
  }

  pushHistory();
  if (state.marks.length >= MAX_MARKS) state.marks.shift();
  const now = performance.now();
  const layer = selectedLayer();
  state.selectedMarkId = null;
  state.draft = {
    id: nextMarkId(),
    layerId: layer.id,
    samples: [{ ...point, tMs: 0 }],
    startOffsetMs: nextStartOffset(now),
    durationMs: MIN_MARK_DURATION_MS,
    brushSize: state.brushSize,
    envelope: copyEnvelope(layer.envelope),
    axes: [...state.axes],
    transform: copyTransform(),
  };
  syncLiveVoices(state.draft, point, true);
  updateStatus();
  scheduleFrame();
}

function handlePointerMove(event) {
  const point = canvasPoint(event);
  updateCursor(point);
  if (state.pointerId !== event.pointerId) {
    scheduleFrame();
    return;
  }
  event.preventDefault();
  if (state.pointerMode === "erase") {
    eraseAt(point);
    return;
  }
  const samples = typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [event];
  for (const sampleEvent of samples.length ? samples : [event]) appendDraftSample(sampleEvent);
  scheduleFrame();
}

function finishPointer(event, { lost = false } = {}) {
  if (state.pointerId === null || (!lost && event.pointerId !== state.pointerId)) return;
  const pointerId = state.pointerId;
  if (!lost && state.pointerMode === "draw" && Number.isFinite(event.clientX)) appendDraftSample(event);
  state.pointerId = null;
  try { canvas.releasePointerCapture?.(pointerId); } catch { /* Capture was already released. */ }

  if (state.draft) {
    const draft = state.draft;
    const elapsed = Math.max(0, (Number(event.timeStamp) || performance.now()) - state.pointerStartedAt);
    draft.durationMs = Math.max(MIN_MARK_DURATION_MS, elapsed, draft.samples.at(-1)?.tMs ?? 0);
    draft.samples = simplifyTimedPoints(draft.samples, 0.0022);
    const mark = sanitizeMark(draft, { fallbackId: draft.id });
    if (mark?.samples?.length) {
      state.marks.push(mark);
      state.timelineEndMs = Math.max(state.timelineEndMs, mark.startOffsetMs + mark.durationMs);
      state.lastCaptureEndedAt = performance.now();
      announce(`${layerForMark(mark).name} mark recorded with ${reflectionTransforms(mark.axes).length} playheads.`);
    }
    releaseLiveVoices(mark ?? draft);
  }

  state.draft = null;
  state.pointerMode = null;
  state.eraseHistorySaved = false;
  updateStatus();
  saveState();
  scheduleFrame();
}

function applyEnvelopeControl() {
  const next = {
    attackMs: Number($("attack").value),
    decayMs: Number($("decay").value),
    sustain: Number($("sustain").value),
    releaseMs: Number($("release").value),
  };
  const mark = selectedMark();
  if (mark) mark.envelope = copyEnvelope(next);
  else selectedLayer().envelope = copyEnvelope(next);
  updateEnvelopeControls();
  saveState();
}

function applyTransformControl() {
  const transform = transformBeingEdited();
  if (!transform) return;
  transform.translateX = Number($("translateX").value);
  transform.translateY = Number($("translateY").value);
  transform.rotationDeg = Number($("rotation").value);
  transform.scaleX = Number($("scaleX").value);
  transform.scaleY = Number($("scaleY").value);
  updateTransformControls();
  saveState();
  scheduleFrame();
}

function bindControls() {
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  for (const button of document.querySelectorAll("[data-axis]")) {
    button.addEventListener("click", () => {
      const axis = button.dataset.axis;
      state.axes = state.axes.includes(axis)
        ? state.axes.filter((candidate) => candidate !== axis)
        : AXIS_IDS.filter((candidate) => [...state.axes, axis].includes(candidate));
      updateSymmetryUi();
      saveState();
      scheduleFrame();
      const count = reflectionTransforms(coreAxes(state.axes)).length;
      announce(`${axis.replace(/([A-Z])/g, " $1")} reflection ${button.getAttribute("aria-pressed") === "true" ? "on" : "off"}. ${count} playheads.`);
    });
  }

  $("playButton").addEventListener("click", () => state.playing ? pausePlayback() : startPlayback());
  $("stopButton").addEventListener("click", stopPlayback);
  $("audioButton").addEventListener("click", () => {
    if (state.audioOn) disableAudio();
    else void enableAudio();
  });
  $("output").addEventListener("input", () => {
    state.output = Number($("output").value);
    $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
    if (state.audioOn) audio.setOutput(state.output);
    saveState();
  });

  for (const input of document.querySelectorAll('input[name="playbackMode"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      preservePlaybackPosition(() => { state.playbackMode = input.value; });
      updateInspector();
    });
  }
  $("playbackRate").addEventListener("input", () => {
    const oldRate = state.playbackRate;
    const plan = playbackPlan();
    const position = currentPlaybackPosition(plan);
    state.playbackRate = Number($("playbackRate").value);
    state.positionMs = position;
    if (state.playing) state.playbackStartedAtMs = clockMs() - position / state.playbackRate;
    $("playbackRateOut").textContent = `${state.playbackRate.toFixed(2)}×`;
    if (oldRate !== state.playbackRate) releasePlaybackVoices();
    saveState();
  });
  $("steadySpeed").addEventListener("input", () => preservePlaybackPosition(() => {
    state.steadySpeed = Number($("steadySpeed").value);
    $("steadySpeedOut").textContent = `${state.steadySpeed.toFixed(2)} /s`;
  }));
  $("loopGap").addEventListener("input", () => preservePlaybackPosition(() => {
    state.loopGapMs = Number($("loopGap").value);
    $("loopGapOut").textContent = `${Math.round(state.loopGapMs)} ms`;
  }));

  $("waveform").addEventListener("change", () => {
    selectedLayer().waveform = $("waveform").value;
    renderPalette();
    updateInspector();
    saveState();
  });
  $("brushSize").addEventListener("input", () => {
    state.brushSize = Number($("brushSize").value);
    $("brushSizeOut").textContent = String(Math.round(state.brushSize * 1_000));
    saveState();
  });
  $("coordinateMode").addEventListener("change", () => {
    state.mapping.coordinateMode = $("coordinateMode").value;
    updateCoordinateUi();
    saveState();
    scheduleFrame();
    announce(state.mapping.coordinateMode === "cartesian"
      ? "Cartesian X and Y mapping selected."
      : state.mapping.coordinateMode === "polar"
        ? "Center polar radar selected. Assign radius and angle to sound parameters."
        : `${state.mapping.radialSpokes}-spoke radial mapping selected.`);
  });
  $("radialSpokes").addEventListener("input", () => {
    state.mapping.radialSpokes = Number($("radialSpokes").value);
    updateCoordinateUi();
    saveState();
    scheduleFrame();
  });
  for (const id of ["xTarget", "yTarget", "sizeTarget"]) {
    $(id).addEventListener("change", () => {
      state.mapping[id] = $(id).value;
      saveState();
      scheduleFrame();
    });
  }
  $("pitchMin").addEventListener("input", () => {
    state.mapping.pitchMin = Math.min(Number($("pitchMin").value), state.mapping.pitchMax);
    $("pitchMinOut").textContent = formatFrequency(state.mapping.pitchMin);
    saveState();
  });
  $("pitchMax").addEventListener("input", () => {
    state.mapping.pitchMax = Math.max(Number($("pitchMax").value), state.mapping.pitchMin);
    $("pitchMaxOut").textContent = formatFrequency(state.mapping.pitchMax);
    saveState();
  });

  for (const id of ["attack", "decay", "sustain", "release"]) {
    $(id).addEventListener("input", applyEnvelopeControl);
  }
  $("transformTarget").addEventListener("change", () => {
    state.transformTarget = $("transformTarget").value;
    updateTransformControls();
  });
  for (const id of ["translateX", "translateY", "rotation", "scaleX", "scaleY"]) {
    $(id).addEventListener("input", applyTransformControl);
  }
  $("resetTransform").addEventListener("click", () => {
    const mark = state.transformTarget === "selected" ? selectedMark() : null;
    if (state.transformTarget === "selected" && !mark) return;
    if (mark) mark.transform = copyTransform();
    else state.sceneTransform = copyTransform();
    updateTransformControls();
    saveState();
    scheduleFrame();
  });

  $("undoButton").addEventListener("click", () => {
    const previous = state.history.pop();
    if (!previous) return;
    state.marks = previous;
    state.selectedMarkId = null;
    state.timelineEndMs = state.marks.reduce(
      (maximum, mark) => Math.max(maximum, mark.startOffsetMs + mark.durationMs),
      0,
    );
    stopPlayback();
    updateInspector();
    updateStatus();
    saveState();
    announce("Last drawing edit undone.");
  });
  $("clearButton").addEventListener("click", () => {
    if (!state.marks.length) return;
    pushHistory();
    stopPlayback();
    state.marks = [];
    state.selectedMarkId = null;
    state.timelineEndMs = 0;
    state.lastCaptureEndedAt = 0;
    updateInspector();
    updateStatus();
    saveState();
    announce("Drawing cleared. Undo is available.");
  });

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("lostpointercapture", (event) => finishPointer(event, { lost: true }));
  canvas.addEventListener("pointerleave", () => {
    if (state.pointerId === null) $("cursorReadout").hidden = true;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const tagName = document.activeElement?.tagName ?? "";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !/INPUT|SELECT|TEXTAREA/.test(tagName)) {
      event.preventDefault();
      $("undoButton").click();
      return;
    }
    if (event.code !== "Space" || /INPUT|SELECT|BUTTON|TEXTAREA/.test(tagName)) return;
    event.preventDefault();
    if (state.playing) pausePlayback();
    else startPlayback();
  });
}

function drawGrid() {
  drawingContext.save();
  drawingContext.lineWidth = 1;
  if (state.mapping.coordinateMode === "cartesian") {
    for (let index = 1; index < 8; index += 1) {
      const position = index / 8 * cssSize;
      drawingContext.strokeStyle = index === 4 ? "rgba(228, 239, 236, .12)" : "rgba(228, 239, 236, .045)";
      drawingContext.beginPath();
      drawingContext.moveTo(position, 0);
      drawingContext.lineTo(position, cssSize);
      drawingContext.moveTo(0, position);
      drawingContext.lineTo(cssSize, position);
      drawingContext.stroke();
    }
  } else {
    const center = cssSize / 2;
    const spokeCount = state.mapping.coordinateMode === "spokes" ? state.mapping.radialSpokes : 12;
    drawingContext.strokeStyle = "rgba(228, 239, 236, .055)";
    for (let ring = 1; ring <= 4; ring += 1) {
      drawingContext.beginPath();
      drawingContext.arc(center, center, Math.SQRT1_2 * cssSize * ring / 4, 0, Math.PI * 2);
      drawingContext.stroke();
    }
    for (let spoke = 0; spoke < spokeCount; spoke += 1) {
      const angle = spoke / spokeCount * Math.PI * 2;
      const dx = Math.cos(angle) * cssSize;
      const dy = Math.sin(angle) * cssSize;
      drawingContext.beginPath();
      drawingContext.moveTo(center, center);
      drawingContext.lineTo(center + dx, center + dy);
      drawingContext.stroke();
    }
    drawingContext.fillStyle = "rgba(104, 223, 188, .65)";
    drawingContext.beginPath();
    drawingContext.arc(center, center, 2.5, 0, Math.PI * 2);
    drawingContext.fill();
  }

  drawingContext.strokeStyle = "rgba(104, 223, 188, .4)";
  drawingContext.setLineDash([5, 7]);
  for (const axis of state.axes) {
    drawingContext.beginPath();
    if (axis === "horizontal") {
      drawingContext.moveTo(0, cssSize / 2);
      drawingContext.lineTo(cssSize, cssSize / 2);
    } else if (axis === "vertical") {
      drawingContext.moveTo(cssSize / 2, 0);
      drawingContext.lineTo(cssSize / 2, cssSize);
    } else if (axis === "diagonal") {
      drawingContext.moveTo(0, cssSize);
      drawingContext.lineTo(cssSize, 0);
    } else {
      drawingContext.moveTo(0, 0);
      drawingContext.lineTo(cssSize, cssSize);
    }
    drawingContext.stroke();
  }
  drawingContext.setLineDash([]);
  drawingContext.restore();
}

function drawMark(mark, { alpha = 1, draft = false } = {}) {
  const layer = layerForMark(mark);
  const selected = mark.id === state.selectedMarkId;
  const lineWidth = Math.max(1.4, mark.brushSize * cssSize * (selected ? 1.22 : 1));
  const localOrigin = localOriginForMark(mark);
  for (const reflection of transformsForMark(mark)) {
    const path = mark.samples.map((sample) => transformedPoint(mark, sample, reflection, localOrigin));
    if (!path.length) continue;
    drawingContext.save();
    drawingContext.globalAlpha = alpha * (reflection.id === "identity" ? 0.96 : 0.72);
    drawingContext.strokeStyle = layer.color;
    drawingContext.fillStyle = layer.color;
    drawingContext.lineWidth = lineWidth;
    drawingContext.lineCap = "round";
    drawingContext.lineJoin = "round";
    if (draft) drawingContext.setLineDash([lineWidth * 1.2, lineWidth * 0.9]);
    drawingContext.beginPath();
    path.forEach((point, index) => {
      const x = point.x * cssSize;
      const y = (1 - point.y) * cssSize;
      if (!index) drawingContext.moveTo(x, y);
      else drawingContext.lineTo(x, y);
    });
    if (path.length === 1) {
      drawingContext.arc(path[0].x * cssSize, (1 - path[0].y) * cssSize, lineWidth / 2, 0, Math.PI * 2);
      drawingContext.fill();
    } else {
      drawingContext.stroke();
    }
    if (selected) {
      drawingContext.globalAlpha = 0.82;
      drawingContext.strokeStyle = "#ffffff";
      drawingContext.lineWidth = 1;
      drawingContext.setLineDash([3, 5]);
      drawingContext.stroke();
    }
    drawingContext.restore();
  }
}

function drawPlayheads(timestamp) {
  for (const playhead of visualPlayheads) {
    const x = playhead.point.x * cssSize;
    const y = (1 - playhead.point.y) * cssSize;
    if (x < -20 || x > cssSize + 20 || y < -20 || y > cssSize + 20) continue;
    drawingContext.save();
    drawingContext.strokeStyle = playhead.color;
    drawingContext.fillStyle = playhead.color;
    drawingContext.globalAlpha = 0.95;
    drawingContext.lineWidth = 1.5;
    drawingContext.beginPath();
    drawingContext.arc(x, y, 4.5, 0, Math.PI * 2);
    drawingContext.fill();
    if (!reducedMotion) {
      const pulse = 8 + (timestamp % 900) / 900 * 8;
      drawingContext.globalAlpha = 0.55 - (pulse - 8) / 32;
      drawingContext.beginPath();
      drawingContext.arc(x, y, pulse, 0, Math.PI * 2);
      drawingContext.stroke();
    }
    drawingContext.restore();
  }
}

function drawStage(timestamp = performance.now()) {
  scheduledFrame = 0;
  drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawingContext.fillStyle = "#080b0e";
  drawingContext.fillRect(0, 0, cssSize, cssSize);
  drawGrid();
  for (const mark of state.marks) drawMark(mark, { alpha: 0.9 });
  if (state.draft) drawMark(state.draft, { alpha: 0.82, draft: true });

  if (state.playing) {
    const plan = playbackPlan();
    const position = currentPlaybackPosition(plan);
    state.positionMs = position;
    syncPlaybackAudio(plan, position);
    updateTransport(plan, position);
  }
  drawPlayheads(timestamp);
  if (state.playing || state.draft || visualPlayheads.length) scheduleFrame();
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(drawStage);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextSize = Math.max(1, Math.round(Math.min(bounds.width, bounds.height || bounds.width)));
  cssSize = nextSize;
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(2_800_000 / (cssSize * cssSize)),
  ));
  canvas.width = Math.round(cssSize * pixelRatio);
  canvas.height = Math.round(cssSize * pixelRatio);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = 0;
  drawStage(performance.now());
}

function teardown({ close = false } = {}) {
  state.playing = false;
  state.pointerId = null;
  state.draft = null;
  disableAudio({ announceChange: false });
  if (close) handleAudioPromise(audio.close());
}

restoreState();
renderMappingOptions();
renderPalette();
updateInspector();
updateStatus();
updateTransport();
setTool(state.tool);
setAudioUi(false);
bindControls();

if (typeof ResizeObserver === "function") {
  new ResizeObserver(resizeCanvas).observe(stageWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}
resizeCanvas();

window.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
  scheduleFrame();
});
window.addEventListener("blur", () => {
  if (state.pointerId !== null) finishPointer({ pointerId: state.pointerId, timeStamp: performance.now() }, { lost: true });
  releaseLiveVoices(state.draft);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  if (state.pointerId !== null) finishPointer({ pointerId: state.pointerId, timeStamp: performance.now() }, { lost: true });
  disableAudio({ announceChange: false });
});
window.addEventListener("pagehide", () => teardown({ close: true }));
