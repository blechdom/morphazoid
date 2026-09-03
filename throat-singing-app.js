import {
  FALSE_FOLD_AUDIBILITY_THRESHOLD,
  THROAT_SINGING_LIMITS,
  THROAT_SINGING_STYLE_PRESETS,
  closurePatternFrequencyHz,
  dualFocusTargets,
  harmonicFrequencyHz,
  heardDroneFrequencyHz,
  modulateThroatSingingPerformance,
  sanitizeThroatSingingState,
  throatSingingState,
  throatSingingTractProfile,
  throatSingingWaveguideDeformations,
  trueFoldFrequencyForDroneHz,
  ventricularFoldSupercycle,
  vocalFryModulationSupercycle,
} from "./src/throat-singing.js";
import { glottalHarmonics } from "./src/throatazoid.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const TAU = Math.PI * 2;
const HARMONICS = Object.freeze(Array.from({ length: 17 }, (_, index) => index + 4));
const NOTE_KEYS = Object.freeze([
  { key: "a", label: "A1", frequency: 55 },
  { key: "s", label: "C2", frequency: 65.406 },
  { key: "d", label: "D2", frequency: 73.416 },
  { key: "f", label: "E2", frequency: 82.407 },
  { key: "g", label: "G2", frequency: 97.999 },
  { key: "h", label: "A2", frequency: 110 },
  { key: "j", label: "C3", frequency: 130.813 },
  { key: "k", label: "D3", frequency: 146.832 },
]);
const EXTRA_DEFAULTS = Object.freeze({
  phantomAirways: 1,
  impossibleFocus: 0,
  sourceInstability: 0,
});
const styleExtras = (values) => Object.freeze({ ...EXTRA_DEFAULTS, ...values });
const EXTRA_STYLE_VALUES = Object.freeze({
  "open-drone": styleExtras({ sublingualCoupling: 0.06, pulseRate: 0, pulseDepth: 0 }),
  sygyt: styleExtras({ sublingualCoupling: 0.3, pulseRate: 0, pulseDepth: 0 }),
  xoomei: styleExtras({ sublingualCoupling: 0.2, pulseRate: 0, pulseDepth: 0 }),
  kargyraa: styleExtras({ sublingualCoupling: 0.06, pulseRate: 0.55, pulseDepth: 0.08 }),
  borbangnadyr: styleExtras({ sublingualCoupling: 0.2, pulseRate: 0, pulseDepth: 0 }),
  ezengileer: styleExtras({ sublingualCoupling: 0.16, pulseRate: 2.6, pulseDepth: 0.48 }),
  "western-overtone": styleExtras({ sublingualCoupling: 0.12, pulseRate: 0, pulseDepth: 0 }),
  "low-chant": styleExtras({ sublingualCoupling: 0.04, pulseRate: 0.32, pulseDepth: 0.08 }),
});
const RUNTIME_EXTRA_KEYS = new Set([
  "phantomAirways",
  "impossibleFocus",
  "sourceInstability",
]);

const CONTROL_BINDINGS = Object.freeze([
  { id: "trueFoldHz", key: "trueFoldHz", format: (value) => `${Math.round(value)} Hz` },
  { id: "sourcePressure", key: "intensity", format: formatPercent },
  { id: "adduction", key: "foldTenseness", format: formatPercent },
  { id: "vocalFry", key: "creakAmount", format: formatPercent },
  { id: "growlRoughness", key: "roughness", format: formatPercent },
  { id: "ventricularCoupling", key: "falseFoldCoupling", format: formatPercent },
  { id: "periodDivision", key: "falseFoldDivision", format: formatDivision },
  { id: "harmonicNumber", key: "harmonicNumber", format: (value) => `H${Math.round(value)}` },
  { id: "focusAmount", key: "formantConvergence", format: formatPercent },
  { id: "pharynxConstriction", key: "uvularConstriction", format: formatPercent },
  { id: "oralConstriction", key: "alveolarConstriction", format: formatPercent },
  { id: "lipRounding", key: "lipRounding", format: formatPercent },
  { id: "sublingualCoupling", key: "sublingualCoupling", extra: true, format: formatPercent },
  { id: "vibratoDepth", key: "vibratoDepthCents", format: (value) => `${Math.round(value)} cents` },
  { id: "vibratoRate", key: "vibratoRateHz", format: (value) => `${value.toFixed(1)} Hz` },
  {
    id: "ornamentRate",
    key: "motionRateHz",
    format: (value) => `${value.toFixed(1)} Hz`,
  },
  {
    id: "ornamentDepth",
    key: "motionDepth",
    toInput: (value) => value * 3,
    fromInput: (value) => value / 3,
    format: (value) => `${value.toFixed(1)} harmonics`,
  },
  { id: "pulseRate", key: "pulseRate", extra: true, format: (value) => `${value.toFixed(1)} Hz` },
  { id: "pulseDepth", key: "pulseDepth", extra: true, format: formatPercent },
  { id: "phantomAirways", key: "phantomAirways", extra: true, format: (value) => `${Math.round(value)} ${Math.round(value) === 1 ? "airway" : "airways"}` },
  { id: "impossibleFocus", key: "impossibleFocus", extra: true, format: formatPercent },
  { id: "sourceInstability", key: "sourceInstability", extra: true, format: formatPercent },
  { id: "level", key: "level", format: formatPercent },
]);

let state = throatSingingState("open-drone", { level: 0.28 });
let extras = { ...EXTRA_STYLE_VALUES["open-drone"] };
let activeStyleId = "open-drone";
let modelProvenance = { kind: "preset", id: "open-drone" };
let audioContext = null;
let graph = null;
let audioOn = false;
let audioWanted = false;
let audioStarting = null;
let audioGeneration = 0;
let singing = false;
let gestureStartedAt = Number.NEGATIVE_INFINITY;
let animationFrame = 0;
let lastAudioUpdateAt = Number.NEGATIVE_INFINITY;
let lastTractSignature = "";
let lastWaveKey = "";
let lastVentricularWaveKey = "";
let performanceStartedAt = performance.now();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let pointerDrag = null;
let handles = [];
let tractPressure = 0;
let spectrum = new Float32Array(2048);
let currentPerformance = modulateThroatSingingPerformance(state, 0);
let currentFocus = currentPerformance.focus;
let pageActive = true;
let sourceWaveTransitionGeneration = 0;
let sourceWaveMuted = false;

function clamp(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDivision(value) {
  const division = Math.round(value);
  if (division === 1) return "same period";
  return `1 closure / ${division} fold cycles${division > 3 ? " · extended" : ""}`;
}

function formatFrequency(value, digits = 2) {
  const frequency = Math.max(0, Number(value) || 0);
  return frequency >= 1_000
    ? `${(frequency / 1_000).toFixed(digits)} kHz`
    : `${Math.round(frequency)} Hz`;
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function setAudioError(message = "") {
  const error = $("audioError");
  error.textContent = message;
  error.hidden = !message;
}

function currentStyle() {
  return THROAT_SINGING_STYLE_PRESETS.find(({ id }) => id === activeStyleId)
    ?? THROAT_SINGING_STYLE_PRESETS[0];
}

function styleById(styleId) {
  return THROAT_SINGING_STYLE_PRESETS.find(({ id }) => id === styleId)
    ?? THROAT_SINGING_STYLE_PRESETS[0];
}

function compactStyleLabel(style) {
  return style.label.replace(/ — comparison$/, "");
}

function styleScopeLabel(style) {
  if (style.isTuvan) return "Tuvan reference";
  return style.isExploration ? "Synthetic exploration" : "non-Tuvan comparison";
}

function markCustomEdit() {
  sourceWaveTransitionGeneration += 1;
  sourceWaveMuted = false;
  if (modelProvenance.kind === "custom") return;
  modelProvenance = { kind: "custom", fromId: modelProvenance.id };
}

function provenancePresentation() {
  const speculativeLab = extras.phantomAirways > 1
    || extras.impossibleFocus > 0.01
    || extras.sourceInstability > 0.01;
  const labSuffix = speculativeLab ? " · speculative lab" : "";
  if (modelProvenance.kind === "preset") {
    const style = styleById(modelProvenance.id);
    return {
      heading: `${styleScopeLabel(style)} · ${compactStyleLabel(style)}${labSuffix}`,
      description: style.description,
    };
  }

  const from = styleById(modelProvenance.fromId);
  return {
    heading: `Custom edit · from ${styleScopeLabel(from)}${labSuffix}`,
    description: `Custom engine state derived from ${compactStyleLabel(from)}; it is not a named singing tradition.`,
  };
}

function sanitizedAppState(candidate, fallback = state) {
  const next = sanitizeThroatSingingState(candidate, fallback);
  return next;
}

function updateRangeFill(input) {
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const progress = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(progress * 100).toFixed(2)}%`);
}

function controlValue(binding) {
  const raw = binding.extra ? extras[binding.key] : state[binding.key];
  return binding.toInput ? binding.toInput(raw) : raw;
}

function updateControl(binding) {
  const input = $(binding.id);
  const output = $(`${binding.id}Out`);
  if (!input) return;
  const value = controlValue(binding);
  input.value = String(value);
  updateRangeFill(input);
  if (output) output.textContent = binding.format(value);
}

function performanceElapsed(now = performance.now()) {
  return Math.max(0, now - performanceStartedAt) / 1_000;
}

function gestureOffsetAt(now = performance.now()) {
  const age = Math.max(0, now - gestureStartedAt);
  const duration = 1_850;
  if (!Number.isFinite(age) || age >= duration) return 0;
  const phase = age / duration;
  const envelope = Math.sin(Math.PI * phase) ** 1.4;
  return Math.sin(phase * TAU * 2.5) * envelope * (0.7 + state.motionDepth * 3.4);
}

function performanceAt(now = performance.now()) {
  const performanceState = modulateThroatSingingPerformance(state, performanceElapsed(now));
  const harmonicOffset = gestureOffsetAt(now);
  const baseDroneHz = performanceState.heardDroneHz;
  const baseHarmonic = state.harmonicNumber;
  const targetHarmonic = clamp(
    baseHarmonic + harmonicOffset,
    THROAT_SINGING_LIMITS.harmonicNumber[0],
    THROAT_SINGING_LIMITS.harmonicNumber[1],
  );
  const focusFrequencyHz = baseDroneHz
    * targetHarmonic
    * Math.pow(2, performanceState.motionWave * state.motionDepth * 0.04);
  return {
    ...performanceState,
    heardDroneHz: baseDroneHz,
    targetHarmonic,
    focusFrequencyHz,
    focus: dualFocusTargets(performanceState, focusFrequencyHz),
  };
}

function updateReadouts(now = performance.now()) {
  currentPerformance = performanceAt(now);
  currentFocus = currentPerformance.focus;
  const drone = currentPerformance.heardDroneHz;
  const closurePattern = closurePatternFrequencyHz(state);
  const harmonicFrequency = harmonicFrequencyHz(state);
  const provenance = provenancePresentation();
  const merged = currentFocus.merged || state.formantConvergence >= 0.9;
  $("levelOut").textContent = formatPercent(state.level);
  $("traditionOut").textContent = provenance.heading;
  $("styleDescription").textContent = provenance.description;
  const sourceQuality = state.creakAmount >= 0.15
    ? "creaky"
    : state.foldTenseness >= 0.67 ? "pressed" : "modal";
  $("foldReadout").textContent = `${Math.round(state.trueFoldHz)} Hz · ${sourceQuality}`;
  $("ventricularReadout").textContent = state.falseFoldCoupling < 0.08
    ? state.falseFoldDivision > 1 ? `${state.falseFoldDivision}:1 armed · folds open` : "folds open"
    : `${state.falseFoldDivision}:1 · ${formatPercent(state.falseFoldCoupling)} · ${Math.round(closurePattern)} Hz pattern`;
  $("focusReadout").textContent = `${formatFrequency(currentFocus.targetHz)} · ${Math.round(currentFocus.bandwidthHz)} Hz BW`;
  $("tractReadout").textContent = `${merged ? "merged F2/F3" : "split F2/F3"} · ${state.tractLengthCm.toFixed(1)} cm`;
  $("sourceSummary").textContent = state.falseFoldDivision > 1
    ? `${Math.round(state.trueFoldHz)} Hz folds · ${Math.round(closurePattern)} Hz pattern`
    : state.creakAmount >= 0.08
      ? `${Math.round(state.trueFoldHz)} Hz folds · creak ${formatPercent(state.creakAmount)}`
      : `${Math.round(state.trueFoldHz)} Hz folds · one pulse`;
  $("focusSummary").textContent = `H${currentPerformance.targetHarmonic.toFixed(0)} · ${merged ? "F2/F3 merged" : `${Math.round(currentFocus.separationHz)} Hz split`}`;
  $("motionSummary").textContent = state.motionRateHz > 0.05 || extras.pulseRate > 0.05
    ? `${state.motionRateHz.toFixed(1)} Hz focus · ${extras.pulseRate.toFixed(1)} Hz pulse`
    : "steady focus";
  const anatomySummary = $("anatomySummary");
  if (anatomySummary) anatomySummary.textContent = extras.phantomAirways > 1
    ? `${Math.round(extras.phantomAirways)} impossible airways · ${formatPercent(extras.impossibleFocus)} focus`
    : extras.impossibleFocus > 0.01 || extras.sourceInstability > 0.01
      ? `${formatPercent(extras.impossibleFocus)} focus · ${formatPercent(extras.sourceInstability)} instability`
      : "human model intact";
  $("stageDroneOut").textContent = formatFrequency(currentPerformance.heardDroneHz);
  $("stageOvertoneOut").textContent = `H${currentPerformance.targetHarmonic.toFixed(1)} · ${formatFrequency(currentFocus.targetHz)}`;
  $("stageFormantOut").textContent = merged
    ? `F2 ≈ F3 · ${Math.round(currentFocus.separationHz)} Hz`
    : `F2 ↔ F3 · ${Math.round(currentFocus.separationHz)} Hz`;

  for (const binding of CONTROL_BINDINGS) updateControl(binding);
  document.querySelectorAll("[data-style-id]").forEach((button) => {
    setPressed(
      button,
      modelProvenance.kind === "preset" && button.dataset.styleId === modelProvenance.id,
    );
  });
  document.querySelectorAll("[data-note-frequency]").forEach((button) => {
    const note = Number(button.dataset.noteFrequency);
    setPressed(button, Math.abs(note - drone) < 0.75);
  });
}

function editModelValue(key, value, { message = "", immediate = false } = {}) {
  state = sanitizedAppState({ ...state, [key]: value }, state);
  if (key !== "level") markCustomEdit();
  updateReadouts();
  applyAudioParameters(immediate);
  if (message) announce(message);
}

function editExtraValue(key, value, { message = "" } = {}) {
  if (key === "pulseRate") extras[key] = clamp(value, 0, 10);
  else if (key === "phantomAirways") extras[key] = Math.round(clamp(value, 1, 4));
  else extras[key] = clamp(value);
  if (!RUNTIME_EXTRA_KEYS.has(key)) markCustomEdit();
  updateReadouts();
  applyAudioParameters();
  if (message) announce(message);
}

function performSilentModelSwap(commit) {
  const live = Boolean(graph && audioContext && singing && audioOn && audioContext.state === "running");
  const generation = ++sourceWaveTransitionGeneration;
  if (!live) {
    sourceWaveMuted = false;
    commit(true);
    return;
  }

  sourceWaveMuted = true;
  setAudioParam(graph.masterGain.gain, 0, false, 0.0035);
  setTimeout(() => {
    if (generation !== sourceWaveTransitionGeneration || !graph) return;
    commit(true);
    setTimeout(() => {
      if (generation !== sourceWaveTransitionGeneration || !graph) return;
      sourceWaveMuted = false;
      applyAudioParameters(false);
    }, 7);
  }, 18);
}

function loadStyle(styleId, { announceChange = true, preserveRuntime = true } = {}) {
  const next = throatSingingState(styleId);
  performSilentModelSwap((immediate) => {
    state = sanitizedAppState({
      ...next,
      level: preserveRuntime ? state.level : next.level,
    }, next);
    const runtimeExtras = preserveRuntime
      ? Object.fromEntries([...RUNTIME_EXTRA_KEYS].map((key) => [key, extras[key]]))
      : {};
    extras = {
      ...(EXTRA_STYLE_VALUES[styleId] ?? EXTRA_STYLE_VALUES["open-drone"]),
      ...runtimeExtras,
    };
    activeStyleId = next.styleId;
    modelProvenance = { kind: "preset", id: next.styleId };
    performanceStartedAt = performance.now();
    lastTractSignature = "";
    updateReadouts();
    applyAudioParameters(immediate);
    if (announceChange) {
      const style = currentStyle();
      announce(`${style.label}. ${style.description}`);
    }
  });
}

function buildStyleButtons() {
  const root = $("styleButtons");
  root.replaceChildren();
  for (const style of THROAT_SINGING_STYLE_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.styleId = style.id;
    button.title = style.evidence?.notice ?? style.description;
    const compactLabel = style.label.replace(/ — comparison$/, "");
    const scope = style.isTuvan ? "Tuvan" : style.isExploration ? "explore" : "comparison";
    button.innerHTML = `<b>${compactLabel}</b><small>${scope}</small>`;
    button.addEventListener("click", () => loadStyle(style.id));
    root.append(button);
  }
}

function setHarmonic(harmonic, { announceChange = true } = {}) {
  const requested = Math.round(clamp(
    harmonic,
    THROAT_SINGING_LIMITS.harmonicNumber[0],
    Math.min(20, THROAT_SINGING_LIMITS.harmonicNumber[1]),
  ));
  state = sanitizedAppState({ ...state, harmonicNumber: requested }, state);
  markCustomEdit();
  updateReadouts();
  applyAudioParameters();
  if (announceChange) {
    announce(`Focused harmonic H${requested}, ${formatFrequency(harmonicFrequencyHz(state))}.`);
  }
}

function setDroneFrequency(droneFrequency, { announceChange = true } = {}) {
  const audibleDivision = state.falseFoldDivision > 1
    && state.falseFoldCoupling >= FALSE_FOLD_AUDIBILITY_THRESHOLD
    ? state.falseFoldDivision
    : 1;
  const trueFoldHz = trueFoldFrequencyForDroneHz(droneFrequency, audibleDivision);
  state = sanitizedAppState({ ...state, trueFoldHz }, state);
  markCustomEdit();
  performanceStartedAt = performance.now();
  updateReadouts();
  applyAudioParameters();
  if (announceChange) announce(`Drone ${formatFrequency(heardDroneFrequencyHz(state))}.`);
}

function buildNoteButtons() {
  const root = $("noteButtons");
  root.replaceChildren();
  for (const note of NOTE_KEYS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.noteFrequency = String(note.frequency);
    button.dataset.noteKey = note.key;
    button.textContent = note.label;
    button.title = `${note.label} drone · ${note.key.toUpperCase()} key`;
    button.addEventListener("click", () => setDroneFrequency(note.frequency));
    root.append(button);
  }
}

function installControls() {
  for (const binding of CONTROL_BINDINGS) {
    const input = $(binding.id);
    if (!input) continue;
    input.addEventListener("input", () => {
      const inputValue = Number(input.value);
      const value = binding.fromInput ? binding.fromInput(inputValue) : inputValue;
      if (binding.extra) editExtraValue(binding.key, value);
      else editModelValue(binding.key, value);
    });
    input.addEventListener("change", () => {
      if (binding.key === "harmonicNumber") {
        announce(`Focused harmonic H${state.harmonicNumber}, ${formatFrequency(harmonicFrequencyHz(state))}.`);
      }
    });
  }
}

function makeSoftClipCurve(size = 4096, drive = 1.55) {
  const curve = new Float32Array(size);
  const normalizer = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const sample = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(sample * drive) / normalizer;
  }
  return curve;
}

function connect(from, to, output, input) {
  if (output === undefined) from.connect(to);
  else from.connect(to, output, input);
  return to;
}

function setAudioParam(parameter, value, immediate = false, timeConstant = 0.035) {
  if (!parameter || !audioContext) return;
  const now = audioContext.currentTime;
  try {
    if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
    else parameter.cancelScheduledValues?.(now);
  } catch {
    const heldValue = parameter.value;
    parameter.cancelScheduledValues?.(now);
    parameter.setValueAtTime?.(heldValue, now);
  }
  if (immediate) parameter.setValueAtTime?.(value, now);
  else parameter.setTargetAtTime?.(value, now, timeConstant);
}

function crossfadeWaveGains(gains, fromIndex, toIndex, immediate = false) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const end = now + 0.012;
  for (let index = 0; index < gains.length; index += 1) {
    const parameter = gains[index]?.gain;
    if (!parameter) continue;
    try {
      if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
      else parameter.cancelScheduledValues?.(now);
    } catch {
      const heldValue = parameter.value;
      parameter.cancelScheduledValues?.(now);
      parameter.setValueAtTime?.(heldValue, now);
    }
    const target = index === toIndex ? 1 : 0;
    if (immediate) parameter.setValueAtTime?.(target, now);
    else parameter.linearRampToValueAtTime?.(target, end);
  }
  if (immediate && fromIndex !== toIndex) gains[fromIndex]?.gain?.setValueAtTime?.(0, now);
}

async function createPhysicalTract(audio) {
  if (!audio.audioWorklet?.addModule || typeof globalThis.AudioWorkletNode !== "function") return null;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/throatazoid-tract-processor.js", import.meta.url),
    );
    const processor = new globalThis.AudioWorkletNode(audio, "throatazoid-tract", {
      numberOfInputs: 8,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    processor.port.onmessage = (event) => {
      if (event.data?.type === "pressure") {
        tractPressure = clamp(event.data.value);
      }
    };
    return processor;
  } catch (error) {
    console.warn("Throat Singing waveguide unavailable; using a resonator fallback.", error);
    return null;
  }
}

function buildAudioGraph(audio, physicalTract) {
  const glottalOscillator = audio.createOscillator();
  const glottalOscillatorB = audio.createOscillator();
  const glottalWaveGain = audio.createGain();
  const glottalWaveGainB = audio.createGain();
  const foldGate = audio.createGain();
  const dividerOscillator = audio.createOscillator();
  const dividerOscillatorB = audio.createOscillator();
  const dividerWaveGain = audio.createGain();
  const dividerWaveGainB = audio.createGain();
  const dividerDepth = audio.createGain();
  const roughnessOscillator = audio.createOscillator();
  const roughnessDepth = audio.createGain();
  const roughnessAmplitudeDepth = audio.createGain();
  const creakOscillator = audio.createOscillator();
  const creakPitchDepth = audio.createGain();
  const creakAmplitudeDepth = audio.createGain();
  const instabilityOscillator = audio.createOscillator();
  const instabilityDepth = audio.createGain();
  const pulseOscillator = audio.createOscillator();
  const pulseDepth = audio.createGain();
  const sourceLowpass = audio.createBiquadFilter();
  const pressureGain = audio.createGain();
  const sourceBus = audio.createGain();
  const sublingualFilter = audio.createBiquadFilter();
  const sublingualDelay = audio.createDelay(0.02);
  const sublingualGain = audio.createGain();
  const fallbackF1 = audio.createBiquadFilter();
  const fallbackF2 = audio.createBiquadFilter();
  const tractOutput = physicalTract ?? fallbackF2;
  const droneLowpass = audio.createBiquadFilter();
  const droneGain = audio.createGain();
  const bodyGain = audio.createGain();
  const focusF2 = audio.createBiquadFilter();
  const focusF3 = audio.createBiquadFilter();
  const focusBandpass = audio.createBiquadFilter();
  const focusGain = audio.createGain();
  const mix = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const compressor = audio.createDynamicsCompressor();
  const shaper = audio.createWaveShaper();
  const masterGain = audio.createGain();
  const analyser = audio.createAnalyser();

  glottalWaveGain.gain.value = 1;
  glottalWaveGainB.gain.value = 0;
  foldGate.gain.value = 0;
  dividerWaveGain.gain.value = 1;
  dividerWaveGainB.gain.value = 0;
  dividerDepth.gain.value = 0;
  roughnessOscillator.type = "sine";
  roughnessOscillator.frequency.value = 19.7;
  roughnessDepth.gain.value = 0;
  roughnessAmplitudeDepth.gain.value = 0;
  const creakCycle = vocalFryModulationSupercycle();
  creakOscillator.setPeriodicWave(audio.createPeriodicWave(
    creakCycle.real,
    creakCycle.imaginary,
    { disableNormalization: true },
  ));
  creakOscillator.frequency.value = 24;
  creakPitchDepth.gain.value = 0;
  creakAmplitudeDepth.gain.value = 0;
  instabilityOscillator.type = "triangle";
  instabilityOscillator.frequency.value = 7.13;
  instabilityDepth.gain.value = 0;
  pulseOscillator.type = "sine";
  pulseOscillator.frequency.value = 0.01;
  pulseDepth.gain.value = 0;
  sourceLowpass.type = "lowpass";
  sourceLowpass.frequency.value = 7_500;
  sourceLowpass.Q.value = 0.75;
  pressureGain.gain.value = 0;
  sourceBus.gain.value = 0.82;
  sublingualFilter.type = "bandpass";
  sublingualFilter.frequency.value = 1_400;
  sublingualFilter.Q.value = 5;
  sublingualDelay.delayTime.value = 0.0017;
  sublingualGain.gain.value = 0;
  fallbackF1.type = "peaking";
  fallbackF1.frequency.value = 330;
  fallbackF1.Q.value = 3.2;
  fallbackF1.gain.value = 8;
  fallbackF2.type = "peaking";
  fallbackF2.frequency.value = 1_100;
  fallbackF2.Q.value = 4.2;
  fallbackF2.gain.value = 6;
  droneLowpass.type = "lowpass";
  droneLowpass.frequency.value = 820;
  droneLowpass.Q.value = 0.78;
  droneGain.gain.value = 0.72;
  bodyGain.gain.value = 0.14;
  focusF2.type = "peaking";
  focusF3.type = "peaking";
  focusBandpass.type = "bandpass";
  focusGain.gain.value = 0.4;
  mix.gain.value = 0.72;
  highpass.type = "highpass";
  highpass.frequency.value = 34;
  highpass.Q.value = 0.707;
  compressor.threshold.value = -18;
  compressor.knee.value = 8;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  shaper.curve = makeSoftClipCurve();
  shaper.oversample = "2x";
  masterGain.gain.value = 0;
  analyser.fftSize = 4096;
  analyser.minDecibels = -104;
  analyser.maxDecibels = -12;
  analyser.smoothingTimeConstant = 0.78;

  connect(glottalOscillator, glottalWaveGain);
  connect(glottalWaveGain, foldGate);
  connect(glottalOscillatorB, glottalWaveGainB);
  connect(glottalWaveGainB, foldGate);
  connect(dividerOscillator, dividerWaveGain);
  connect(dividerWaveGain, dividerDepth);
  connect(dividerOscillatorB, dividerWaveGainB);
  connect(dividerWaveGainB, dividerDepth);
  dividerDepth.connect(foldGate.gain);
  connect(roughnessOscillator, roughnessDepth);
  roughnessDepth.connect(glottalOscillator.detune);
  roughnessDepth.connect(glottalOscillatorB.detune);
  roughnessDepth.connect(dividerOscillator.detune);
  roughnessDepth.connect(dividerOscillatorB.detune);
  connect(roughnessOscillator, roughnessAmplitudeDepth);
  roughnessAmplitudeDepth.connect(pressureGain.gain);
  connect(creakOscillator, creakPitchDepth);
  creakPitchDepth.connect(glottalOscillator.detune);
  creakPitchDepth.connect(glottalOscillatorB.detune);
  connect(creakOscillator, creakAmplitudeDepth);
  creakAmplitudeDepth.connect(pressureGain.gain);
  connect(instabilityOscillator, instabilityDepth);
  instabilityDepth.connect(glottalOscillator.detune);
  instabilityDepth.connect(glottalOscillatorB.detune);
  instabilityDepth.connect(dividerOscillator.detune);
  instabilityDepth.connect(dividerOscillatorB.detune);
  connect(foldGate, sourceLowpass);
  connect(sourceLowpass, pressureGain);
  connect(pressureGain, sourceBus);
  connect(pulseOscillator, pulseDepth);
  pulseDepth.connect(pressureGain.gain);

  if (physicalTract) {
    connect(sourceBus, physicalTract, 0, 0);
    connect(sourceBus, sublingualFilter);
    connect(sublingualFilter, sublingualDelay);
    connect(sublingualDelay, sublingualGain);
    connect(sublingualGain, physicalTract, 0, 0);
  } else {
    connect(sourceBus, fallbackF1);
    connect(fallbackF1, fallbackF2);
    connect(sourceBus, sublingualFilter);
    connect(sublingualFilter, sublingualDelay);
    connect(sublingualDelay, sublingualGain);
    connect(sublingualGain, fallbackF1);
  }

  connect(tractOutput, droneLowpass);
  connect(droneLowpass, droneGain);
  connect(droneGain, mix);
  connect(tractOutput, bodyGain);
  connect(bodyGain, mix);
  connect(tractOutput, focusF2);
  connect(focusF2, focusF3);
  connect(focusF3, focusBandpass);
  connect(focusBandpass, focusGain);
  connect(focusGain, mix);
  connect(mix, highpass);
  connect(highpass, compressor);
  connect(compressor, shaper);
  connect(shaper, masterGain);
  connect(masterGain, analyser);
  const releaseAudioOutput = connectAudioOutput(audio, analyser, { runtime: globalThis });

  const startTime = audio.currentTime + 0.01;
  for (const oscillator of [
    glottalOscillator,
    glottalOscillatorB,
    dividerOscillator,
    dividerOscillatorB,
    roughnessOscillator,
    creakOscillator,
    instabilityOscillator,
    pulseOscillator,
  ]) {
    oscillator.start(startTime);
  }

  return {
    glottalOscillator,
    glottalOscillators: [glottalOscillator, glottalOscillatorB],
    glottalWaveGains: [glottalWaveGain, glottalWaveGainB],
    glottalWaveSlot: 0,
    foldGate,
    dividerOscillator,
    dividerOscillators: [dividerOscillator, dividerOscillatorB],
    dividerWaveGains: [dividerWaveGain, dividerWaveGainB],
    dividerWaveSlot: 0,
    dividerDepth,
    roughnessOscillator,
    roughnessDepth,
    roughnessAmplitudeDepth,
    creakOscillator,
    creakPitchDepth,
    creakAmplitudeDepth,
    creakCycle,
    instabilityOscillator,
    instabilityDepth,
    pulseOscillator,
    pulseDepth,
    sourceLowpass,
    pressureGain,
    sourceBus,
    sublingualFilter,
    sublingualDelay,
    sublingualGain,
    fallbackF1,
    fallbackF2,
    physicalTract,
    droneLowpass,
    droneGain,
    bodyGain,
    focusF2,
    focusF3,
    focusBandpass,
    focusGain,
    mix,
    compressor,
    shaper,
    masterGain,
    analyser,
    releaseAudioOutput,
  };
}

async function ensureAudioGraph() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
  if (audioContext && audioContext.state !== "closed" && graph) {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    return graph;
  }
  if (audioStarting) return audioStarting;
  const generation = audioGeneration;
  audioStarting = (async () => {
    const context = new AudioContextClass({ latencyHint: "interactive" });
    unlockAudioContext(context);
    await context.resume();
    const physicalTract = await createPhysicalTract(context);
    if (generation !== audioGeneration || !pageActive) {
      await context.close();
      return null;
    }
    audioContext = context;
    graph = buildAudioGraph(context, physicalTract);
    spectrum = new Float32Array(graph.analyser.frequencyBinCount);
    lastTractSignature = "";
    lastWaveKey = "";
    lastVentricularWaveKey = "";
    applyAudioParameters(true);
    return graph;
  })().finally(() => { audioStarting = null; });
  return audioStarting;
}

function updateGlottalWaveform(performanceState, immediate = false) {
  if (!graph?.glottalOscillator?.setPeriodicWave || !audioContext?.createPeriodicWave) return;
  const sourceTenseness = clamp(
    performanceState.foldTenseness
      + performanceState.creakAmount * 0.22,
  );
  const waveKey = (Math.round(sourceTenseness * 24) / 24).toFixed(3);
  if (waveKey === lastWaveKey) return;
  const { real, imaginary } = glottalHarmonics(Number(waveKey), 72, 1024);
  const wave = audioContext.createPeriodicWave(real, imaginary, { disableNormalization: false });
  const oscillators = graph.glottalOscillators ?? [graph.glottalOscillator];
  const gains = graph.glottalWaveGains ?? [];
  const currentSlot = graph.glottalWaveSlot ?? 0;
  if (!lastWaveKey || immediate || oscillators.length < 2) {
    if (currentSlot === 0) graph.glottalOscillator.setPeriodicWave(wave);
    else oscillators[currentSlot].setPeriodicWave(wave);
  } else {
    const nextSlot = currentSlot === 0 ? 1 : 0;
    oscillators[nextSlot].setPeriodicWave(wave);
    crossfadeWaveGains(gains, currentSlot, nextSlot);
    graph.glottalWaveSlot = nextSlot;
  }
  lastWaveKey = waveKey;
}

function updateVentricularWaveform(performanceState, immediate = false) {
  if (!graph?.dividerOscillator?.setPeriodicWave || !audioContext?.createPeriodicWave) {
    return graph?.ventricularCycle ?? null;
  }
  const tenseness = Math.round(performanceState.foldTenseness * 24) / 24;
  const waveKey = `${performanceState.falseFoldDivision}:${tenseness.toFixed(3)}`;
  if (waveKey === lastVentricularWaveKey && graph.ventricularCycle) {
    return graph.ventricularCycle;
  }
  const cycle = ventricularFoldSupercycle({
    ...performanceState,
    foldTenseness: tenseness,
  });
  const wave = audioContext.createPeriodicWave(cycle.real, cycle.imaginary, {
    disableNormalization: true,
  });
  const oscillators = graph.dividerOscillators ?? [graph.dividerOscillator];
  const gains = graph.dividerWaveGains ?? [];
  const currentSlot = graph.dividerWaveSlot ?? 0;
  if (!lastVentricularWaveKey || immediate || oscillators.length < 2) {
    if (currentSlot === 0) graph.dividerOscillator.setPeriodicWave(wave);
    else oscillators[currentSlot].setPeriodicWave(wave);
  } else {
    const nextSlot = currentSlot === 0 ? 1 : 0;
    oscillators[nextSlot].setPeriodicWave(wave);
    crossfadeWaveGains(gains, currentSlot, nextSlot);
    graph.dividerWaveSlot = nextSlot;
  }
  graph.ventricularCycle = cycle;
  lastVentricularWaveKey = waveKey;
  return cycle;
}

function physicalTractConfiguration(performanceState) {
  const deformationRecords = throatSingingWaveguideDeformations(performanceState);
  const tractDeformations = deformationRecords.map((deformation) => ({
    center: deformation.centerSection,
    radius: Math.max(1.5, deformation.radiusSections),
    height: deformation.kind === "expansion"
      ? deformation.strength * 0.82
      : -deformation.strength * (deformation.id === "alveolar-oral" ? 1.44 : 0.96),
    strength: 1,
  }));
  tractDeformations.push({
    center: 9,
    radius: 2.4,
    height: -performanceState.falseFoldCoupling * 0.64,
    strength: 1,
  });
  const bodyLength = clamp((performanceState.tractLengthCm - 13) / 9);
  const mouthCount = Math.round(clamp(extras.phantomAirways, 1, 4));
  const mouths = Array.from({ length: mouthCount }, (_, index) => {
    const offset = mouthCount === 1 ? 0 : index / (mouthCount - 1) * 2 - 1;
    return {
      aperture: clamp(performanceState.mouthOpening * (1 + offset * 0.14), 0.05, 1),
      length: clamp(bodyLength + offset * 0.12),
      closed: false,
    };
  });
  return {
    mouthCount,
    throatCount: mouthCount,
    selectedMouth: 0,
    articulateAll: true,
    classicTopology: mouthCount === 1,
    bodyLength,
    tension: performanceState.foldTenseness,
    mutation: mouthCount > 1 ? 0.12 + (mouthCount - 2) * 0.08 : 0,
    coupling: mouthCount > 1 ? 0.24 + (mouthCount - 2) * 0.12 : 0,
    spread: mouthCount > 1 ? 0.82 : 0,
    oralClosure: 0,
    lipDiameter: lerp(2.9, 0.62, performanceState.lipRounding),
    articulationPlace: 0.5,
    articulationIndex: 22,
    articulationAperture: 1,
    articulationVoicing: 1,
    glottalClosure: 0,
    nasalCoupling: 0,
    articulationManner: "vowel",
    fricationGain: 0,
    burstGain: 0,
    exciterIntensity: performanceState.intensity,
    voiceMode: "shared",
    performanceGate: singing && audioOn ? 1 : 0,
    pressureSourceCount: 1,
    pressureSources: [{ open: true, level: performanceState.intensity }],
    tongueCount: 1,
    noseCount: 0,
    mouths,
    throats: mouths,
    tongues: [{
      position: clamp(0.35 + performanceState.uvularConstriction * 0.27),
      height: clamp(0.08 + performanceState.alveolarConstriction * 0.26),
      curl: clamp(0.28 + performanceState.frontCavityExpansion * 0.3),
    }],
    tractDeformations,
    noses: [],
  };
}

function applyAudioParameters(immediate = false, now = performance.now()) {
  if (!graph || !audioContext) return;
  const performanceState = performanceAt(now);
  currentPerformance = performanceState;
  currentFocus = performanceState.focus;
  const live = singing && audioOn && audioContext.state === "running";
  const pressure = performanceState.intensity;
  const creak = performanceState.creakAmount;
  const coupling = performanceState.falseFoldCoupling;
  const division = performanceState.falseFoldDivision;
  const ventricularCycle = updateVentricularWaveform(performanceState, immediate || !live);
  const meanClosure = ventricularCycle?.meanClosure ?? 0;
  const meanSquaredClosure = ventricularCycle?.meanSquaredClosure ?? 0;
  const gateRms = Math.sqrt(Math.max(
    0.08,
    1 - 2 * coupling * meanClosure + coupling * coupling * meanSquaredClosure,
  ));
  const closureCompensation = clamp(1 / gateRms, 1, 1.25);
  const pulseDepth = extras.pulseDepth;
  const gate = live ? 1 : 0;
  const voicedPressure = pressure * (1 - creak * 0.16);
  const pulseBase = gate * voicedPressure * (1 - pulseDepth * 0.34) * closureCompensation;

  updateGlottalWaveform(performanceState, immediate || !live);
  setAudioParam(graph.glottalOscillator.frequency, performanceState.trueFoldHz, immediate, 0.025);
  setAudioParam(graph.glottalOscillators?.[1]?.frequency, performanceState.trueFoldHz, immediate, 0.025);
  setAudioParam(
    graph.creakOscillator.frequency,
    performanceState.trueFoldHz * (graph.creakCycle?.baseFrequencyRatio ?? 0.2),
    immediate,
    0.035,
  );
  setAudioParam(graph.creakPitchDepth.gain, creak * (34 + creak * 56), immediate, 0.055);
  setAudioParam(
    graph.creakAmplitudeDepth.gain,
    gate * pressure * creak * 0.24,
    immediate || !live,
    0.05,
  );
  setAudioParam(
    graph.dividerOscillator.frequency,
    performanceState.trueFoldHz / Math.max(1, division),
    immediate,
    0.025,
  );
  setAudioParam(
    graph.dividerOscillators?.[1]?.frequency,
    performanceState.trueFoldHz / Math.max(1, division),
    immediate,
    0.025,
  );
  setAudioParam(graph.foldGate.gain, 1 - coupling * meanClosure, immediate, 0.025);
  setAudioParam(graph.dividerDepth.gain, coupling, immediate, 0.03);
  setAudioParam(graph.roughnessOscillator.frequency, 17 + performanceState.roughness * 16, immediate, 0.08);
  setAudioParam(
    graph.roughnessDepth.gain,
    performanceState.roughness * 28 + extras.sourceInstability * 32,
    immediate,
    0.07,
  );
  setAudioParam(
    graph.roughnessAmplitudeDepth.gain,
    gate * pressure * performanceState.roughness * 0.1,
    immediate || !live,
    0.06,
  );
  setAudioParam(
    graph.instabilityOscillator.frequency,
    5.7 + extras.sourceInstability * 6.2,
    immediate,
    0.08,
  );
  setAudioParam(graph.instabilityDepth.gain, extras.sourceInstability * 76, immediate, 0.07);
  setAudioParam(graph.pulseOscillator.frequency, Math.max(0.01, extras.pulseRate), immediate, 0.08);
  setAudioParam(graph.pulseDepth.gain, gate * pressure * pulseDepth * 0.34, immediate || !live, 0.04);
  setAudioParam(graph.pressureGain.gain, pulseBase, immediate || !live, live ? 0.045 : 0.018);
  setAudioParam(
    graph.sourceLowpass.frequency,
    3_200 + performanceState.foldTenseness * 8_800,
    immediate,
    0.045,
  );
  setAudioParam(
    graph.sublingualFilter.frequency,
    clamp(performanceState.focus.targetHz * 0.78, 480, 4_800),
    immediate,
    0.04,
  );
  setAudioParam(graph.sublingualFilter.Q, 2.2 + extras.sublingualCoupling * 8, immediate, 0.05);
  setAudioParam(
    graph.sublingualDelay.delayTime,
    0.0011 + (1 - performanceState.frontCavityExpansion) * 0.0016,
    immediate,
    0.055,
  );
  setAudioParam(graph.sublingualGain.gain, extras.sublingualCoupling * 0.19, immediate, 0.055);

  const focus = performanceState.focus;
  const focusQ = clamp(
    focus.targetHz / Math.max(24, focus.bandwidthHz) * (1 + extras.impossibleFocus * 2.4),
    1.2,
    96,
  );
  const focusBoost = 4 + performanceState.formantConvergence * 14
    + extras.impossibleFocus * 18;
  setAudioParam(graph.focusF2.frequency, clamp(focus.f2Hz, 120, 9_000), immediate, 0.022);
  setAudioParam(graph.focusF3.frequency, clamp(focus.f3Hz, 140, 10_000), immediate, 0.022);
  setAudioParam(graph.focusF2.Q, focusQ * 0.78, immediate, 0.035);
  setAudioParam(graph.focusF3.Q, focusQ * 0.78, immediate, 0.035);
  setAudioParam(graph.focusF2.gain, focusBoost, immediate, 0.035);
  setAudioParam(graph.focusF3.gain, focusBoost, immediate, 0.035);
  setAudioParam(graph.focusBandpass.frequency, clamp(focus.targetHz, 140, 10_000), immediate, 0.02);
  setAudioParam(graph.focusBandpass.Q, focusQ, immediate, 0.03);
  setAudioParam(
    graph.focusGain.gain,
    0.22 + performanceState.formantConvergence * 0.58 + extras.impossibleFocus * 0.22,
    immediate,
    0.04,
  );
  setAudioParam(
    graph.droneGain.gain,
    0.46 + (1 - performanceState.formantConvergence) * 0.38 + coupling * 0.16,
    immediate,
    0.05,
  );
  setAudioParam(graph.bodyGain.gain, 0.13 + creak * 0.06, immediate, 0.05);
  setAudioParam(graph.droneLowpass.frequency, 620 + heardDroneFrequencyHz(performanceState) * 2.2, immediate, 0.04);
  setAudioParam(
    graph.masterGain.gain,
    audioOn && !sourceWaveMuted ? Math.sqrt(clamp(state.level, 0, 0.8)) * 0.47 : 0,
    immediate || !audioOn,
    sourceWaveMuted ? 0.0035 : 0.035,
  );

  if (graph.physicalTract) {
    const tractState = physicalTractConfiguration(performanceState);
    const signature = JSON.stringify([
      performanceState.tractLengthCm.toFixed(3),
      performanceState.foldTenseness.toFixed(3),
      performanceState.uvularConstriction.toFixed(3),
      performanceState.alveolarConstriction.toFixed(3),
      performanceState.frontCavityExpansion.toFixed(3),
      performanceState.mouthOpening.toFixed(3),
      performanceState.lipRounding.toFixed(3),
      performanceState.falseFoldCoupling.toFixed(3),
      extras.phantomAirways,
      tractState.performanceGate,
    ]);
    if (signature !== lastTractSignature) {
      graph.physicalTract.port.postMessage({ type: "configure", state: tractState });
      lastTractSignature = signature;
    }
  } else {
    setAudioParam(graph.fallbackF1.frequency, 260 + performanceState.mouthOpening * 280, immediate, 0.04);
    setAudioParam(graph.fallbackF2.frequency, clamp(focus.f2Hz * 0.68, 620, 2_600), immediate, 0.04);
  }
}

function setAudioPresentation(status) {
  setPressed($("audioButton"), status === "on");
  $("audioState").textContent = status === "on" ? "on" : "off";
  $("audioButton").disabled = status === "starting";
  setPressed($("singButton"), singing);
  $("singButtonLabel").textContent = singing ? "Release drone" : "Begin drone";
  $("singState").textContent = singing
    ? "sounding · click to release"
    : audioOn ? "ready · space or click" : "space · click to latch";
}

async function setAudioEnabled(enabled) {
  const nextWanted = Boolean(enabled);
  const requestGeneration = nextWanted === audioWanted
    ? audioGeneration
    : ++audioGeneration;
  audioWanted = nextWanted;
  if (!enabled) {
    singing = false;
    audioOn = false;
    setAudioPresentation("off");
    applyAudioParameters();
    const context = audioContext;
    setTimeout(() => {
      if (!audioWanted && context?.state === "running") context.suspend().catch(() => {});
    }, 70);
    announce("Audio off.");
    return;
  }
  setAudioPresentation("starting");
  setAudioError();
  try {
    await ensureAudioGraph();
    if (!audioWanted || requestGeneration !== audioGeneration || !pageActive) return;
    unlockAudioContext(audioContext);
    await audioContext.resume();
    audioOn = true;
    setAudioPresentation("on");
    applyAudioParameters(true);
    announce("Audio ready. Begin the drone, then move the overtone focus.");
  } catch (error) {
    audioWanted = false;
    audioOn = false;
    setAudioPresentation("off");
    setAudioError(error instanceof Error ? error.message : "The audio model could not start.");
  }
}

async function setSinging(enabled) {
  const next = Boolean(enabled);
  if (next && !audioOn) {
    await setAudioEnabled(true);
    if (!audioOn) return;
  }
  singing = next;
  if (next && !Number.isFinite(performanceStartedAt)) performanceStartedAt = performance.now();
  lastTractSignature = "";
  setAudioPresentation(audioOn ? "on" : "off");
  applyAudioParameters();
  announce(next
    ? `Drone sounding at ${formatFrequency(heardDroneFrequencyHz(state))}; H${state.harmonicNumber} focused at ${formatFrequency(harmonicFrequencyHz(state))}.`
    : "Drone released.");
}

function triggerGesture() {
  gestureStartedAt = performance.now();
  $("gestureButton").classList.add("is-active");
  $("gestureState").textContent = "moving focus";
  if (!singing) setSinging(true);
  setTimeout(() => {
    if (performance.now() - gestureStartedAt >= 1_800) {
      $("gestureButton").classList.remove("is-active");
      $("gestureState").textContent = "one phrase";
    }
  }, 1_900);
  announce("Overtone ornament started.");
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* The context may already be closed. */ }
}

async function destroyAudio() {
  audioGeneration += 1;
  audioWanted = false;
  audioOn = false;
  singing = false;
  const context = audioContext;
  const activeGraph = graph;
  graph = null;
  audioContext = null;
  activeGraph?.releaseAudioOutput?.();
  for (const node of Object.values(activeGraph ?? {})) safeDisconnect(node);
  try { await context?.close?.(); } catch { /* Best-effort page cleanup. */ }
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(rect.width));
  cssHeight = Math.max(1, Math.round(rect.height));
  pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(cssHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function roundedRect(context, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function anatomyGeometry(profile) {
  const left = cssWidth * 0.15;
  const right = cssWidth * 0.87;
  const lower = cssHeight * 0.75;
  const mouthLine = cssHeight * 0.54;
  const points = profile.diametersCm.map((diameter, index) => {
    const progress = index / Math.max(1, profile.diametersCm.length - 1);
    const x = lerp(left, right, progress);
    const rise = progress < 0.28
      ? (progress / 0.28) * (lower - mouthLine)
      : lower - mouthLine;
    const curve = progress >= 0.28
      ? Math.sin((progress - 0.28) / 0.72 * Math.PI) * cssHeight * 0.035
      : 0;
    return {
      x,
      y: lower - rise - curve,
      diameter,
      progress,
    };
  });
  return { left, right, lower, mouthLine, points };
}

function tubePolygon(points) {
  const scale = clamp(Math.min(cssWidth / 76, cssHeight / 42), 5, 13);
  const upper = [];
  const lower = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const nx = -dy / magnitude;
    const ny = dx / magnitude;
    const width = points[index].diameter * scale;
    upper.push({ x: points[index].x - nx * width, y: points[index].y - ny * width });
    lower.push({ x: points[index].x + nx * width, y: points[index].y + ny * width });
  }
  return { upper, lower: lower.reverse() };
}

function tracePolygon(context, points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function drawBackdrop(context) {
  context.fillStyle = "#050706";
  context.fillRect(0, 0, cssWidth, cssHeight);
  const glow = context.createRadialGradient(
    cssWidth * 0.58,
    cssHeight * 0.5,
    0,
    cssWidth * 0.58,
    cssHeight * 0.5,
    Math.max(cssWidth, cssHeight) * 0.58,
  );
  glow.addColorStop(0, "rgba(175,140,255,0.055)");
  glow.addColorStop(0.48, "rgba(215,179,92,0.018)");
  glow.addColorStop(1, "rgba(5,7,6,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.strokeStyle = "rgba(215,179,92,0.025)";
  context.lineWidth = 1;
  for (let x = 0; x <= cssWidth; x += 36) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, cssHeight);
    context.stroke();
  }
  for (let y = 0; y <= cssHeight; y += 36) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(cssWidth, y + 0.5);
    context.stroke();
  }
}

function analyserEnergyAt(frequency) {
  if (!graph?.analyser || !audioContext || graph.analyser.frequencyBinCount === 0) return null;
  const index = Math.round(frequency / (audioContext.sampleRate / 2) * graph.analyser.frequencyBinCount);
  if (index < 0 || index >= spectrum.length) return null;
  const decibels = spectrum[index];
  if (!Number.isFinite(decibels)) return 0;
  return clamp((decibels + 100) / 78);
}

function theoreticalEnergy(harmonic, performanceState) {
  const distance = Math.abs(harmonic - performanceState.targetHarmonic);
  const focusWidth = lerp(2.3, 0.24, performanceState.formantConvergence);
  const focused = Math.exp(-0.5 * (distance / focusWidth) ** 2);
  const sourceTilt = 1 / Math.pow(harmonic, lerp(0.35, 0.95, 1 - performanceState.foldTenseness));
  return clamp(sourceTilt * 1.9 + focused * performanceState.formantConvergence * 0.9);
}

function harmonicEnergy(harmonic, performanceState) {
  const measured = analyserEnergyAt(performanceState.heardDroneHz * harmonic);
  if (measured !== null && singing && audioOn) return measured;
  return theoreticalEnergy(harmonic, performanceState);
}

function drawSpectrum(context, performanceState) {
  if (cssWidth < 470 || cssHeight < 250) return;
  const box = {
    x: cssWidth * 0.53,
    y: Math.max(54, cssHeight * 0.12),
    width: cssWidth * 0.39,
    height: Math.min(128, cssHeight * 0.24),
  };
  roundedRect(context, box.x, box.y, box.width, box.height, 5);
  context.fillStyle = "rgba(5,7,6,0.62)";
  context.fill();
  context.strokeStyle = "rgba(215,179,92,0.12)";
  context.stroke();
  context.save();
  roundedRect(context, box.x, box.y, box.width, box.height, 5);
  context.clip();

  const baseline = box.y + box.height - 18;
  const barWidth = box.width / HARMONICS.length;
  context.strokeStyle = "rgba(233,228,212,0.055)";
  for (let row = 1; row <= 3; row += 1) {
    const y = box.y + (box.height - 22) * row / 4;
    context.beginPath();
    context.moveTo(box.x, y);
    context.lineTo(box.x + box.width, y);
    context.stroke();
  }

  const envelope = [];
  for (let index = 0; index < HARMONICS.length; index += 1) {
    const harmonic = HARMONICS[index];
    const energy = harmonicEnergy(harmonic, performanceState);
    const x = box.x + (index + 0.5) * barWidth;
    const height = energy * (box.height - 30);
    const selected = Math.round(performanceState.targetHarmonic) === harmonic;
    const gradient = context.createLinearGradient(0, baseline - height, 0, baseline);
    gradient.addColorStop(0, selected ? "rgba(242,217,134,0.98)" : "rgba(175,140,255,0.78)");
    gradient.addColorStop(1, selected ? "rgba(215,179,92,0.22)" : "rgba(175,140,255,0.08)");
    context.fillStyle = gradient;
    context.fillRect(x - Math.max(1, barWidth * 0.16), baseline - height, Math.max(2, barWidth * 0.32), height);
    context.fillStyle = selected ? "#f2d986" : "rgba(141,145,138,0.72)";
    context.font = "6px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(String(harmonic), x, baseline + 11);
    const distanceHz = Math.abs(performanceState.heardDroneHz * harmonic - performanceState.focus.targetHz);
    const formant = Math.exp(-0.5 * (distanceHz / Math.max(30, performanceState.focus.bandwidthHz)) ** 2);
    envelope.push({ x, y: baseline - 7 - formant * (box.height - 40) });
  }
  context.strokeStyle = "rgba(112,217,207,0.66)";
  context.lineWidth = 1.2;
  context.beginPath();
  envelope.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();
  context.restore();

  context.fillStyle = "rgba(141,145,138,0.68)";
  context.font = "7px ui-monospace, monospace";
  context.textAlign = "left";
  context.fillText("HARMONIC ENERGY / TRACT ENVELOPE", box.x + 8, box.y + 12);
}

function drawTube(context, profile, geometry, now) {
  const polygon = tubePolygon(geometry.points);
  const complete = [...polygon.upper, ...polygon.lower];
  const tubeGradient = context.createLinearGradient(geometry.left, 0, geometry.right, 0);
  tubeGradient.addColorStop(0, "rgba(255,124,105,0.22)");
  tubeGradient.addColorStop(0.45, "rgba(215,179,92,0.14)");
  tubeGradient.addColorStop(0.76, "rgba(175,140,255,0.22)");
  tubeGradient.addColorStop(1, "rgba(112,217,207,0.12)");
  tracePolygon(context, complete);
  context.fillStyle = tubeGradient;
  context.fill();
  context.strokeStyle = "rgba(233,228,212,0.38)";
  context.lineWidth = 1.15;
  context.stroke();

  context.strokeStyle = "rgba(215,179,92,0.11)";
  context.lineWidth = 0.8;
  for (let index = 0; index < geometry.points.length; index += 2) {
    const upper = polygon.upper[index];
    const lower = polygon.lower[polygon.lower.length - 1 - index];
    if (!upper || !lower) continue;
    context.beginPath();
    context.moveTo(upper.x, upper.y);
    context.lineTo(lower.x, lower.y);
    context.stroke();
  }

  context.strokeStyle = "rgba(242,217,134,0.42)";
  context.lineWidth = 1;
  context.beginPath();
  geometry.points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();

  if (singing) {
    const bubbleCount = prefersReducedMotion ? 4 : 11;
    for (let index = 0; index < bubbleCount; index += 1) {
      const travel = ((now * 0.00012 * (0.55 + state.intensity) + index / bubbleCount) % 1 + 1) % 1;
      const phase = travel;
      const pointIndex = Math.min(geometry.points.length - 1, Math.floor(phase * geometry.points.length));
      const point = geometry.points[pointIndex];
      const focused = Math.abs(phase - 0.73) < 0.13;
      context.beginPath();
      context.arc(point.x, point.y, focused ? 2.2 + tractPressure * 2 : 1.4 + tractPressure, 0, TAU);
      context.fillStyle = focused ? "rgba(242,217,134,0.75)" : "rgba(255,124,105,0.48)";
      context.fill();
    }
  }

  for (const deformation of profile.deformations) {
    const point = geometry.points[deformation.centerSection];
    if (!point) continue;
    context.strokeStyle = deformation.kind === "expansion"
      ? "rgba(112,217,207,0.34)"
      : deformation.id === "alveolar-oral"
        ? "rgba(175,140,255,0.5)"
        : "rgba(215,179,92,0.46)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(point.x, point.y, 5 + deformation.strength * 8, 0, TAU);
    context.stroke();
  }
}

function drawHeadOutline(context, geometry, now, performanceState) {
  const { left, right, lower, mouthLine } = geometry;
  context.save();
  context.strokeStyle = "rgba(233,228,212,0.11)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left - cssWidth * 0.07, lower + cssHeight * 0.13);
  context.bezierCurveTo(left - cssWidth * 0.12, lower - cssHeight * 0.1, left - cssWidth * 0.09, mouthLine - cssHeight * 0.28, left + cssWidth * 0.08, mouthLine - cssHeight * 0.35);
  context.bezierCurveTo(left + cssWidth * 0.35, mouthLine - cssHeight * 0.45, right - cssWidth * 0.03, mouthLine - cssHeight * 0.2, right + cssWidth * 0.04, mouthLine - cssHeight * 0.04);
  context.lineTo(right + cssWidth * 0.065, mouthLine);
  context.lineTo(right + cssWidth * 0.018, mouthLine + cssHeight * 0.04);
  context.bezierCurveTo(right - cssWidth * 0.02, mouthLine + cssHeight * 0.12, right - cssWidth * 0.2, mouthLine + cssHeight * 0.18, right - cssWidth * 0.34, lower + cssHeight * 0.12);
  context.stroke();

  context.fillStyle = "rgba(255,124,105,0.16)";
  roundedRect(context, left - 11, lower - 20, 22, 42, 9);
  context.fill();
  context.strokeStyle = "rgba(255,124,105,0.48)";
  context.stroke();

  const foldY = lower - 5;
  for (const offset of [-1, 1]) {
    context.beginPath();
    context.ellipse(left + offset * 5, foldY, 2.2, 12, offset * 0.08, 0, TAU);
    context.fillStyle = "rgba(255,124,105,0.7)";
    context.fill();
  }
  const falseY = lower - 28;
  const visiblePulse = prefersReducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.012);
  const falseFoldGap = lerp(
    8.5,
    2.2 + visiblePulse * 1.4,
    performanceState.falseFoldCoupling,
  );
  for (const offset of [-1, 1]) {
    context.beginPath();
    context.ellipse(left + offset * falseFoldGap, falseY, 2.8, 10, offset * 0.12, 0, TAU);
    context.fillStyle = `rgba(215,179,92,${0.24 + performanceState.falseFoldCoupling * 0.62})`;
    context.fill();
  }
  context.restore();
}

function drawHandle(context, handle) {
  const active = pointerDrag?.id === handle.id;
  context.save();
  context.beginPath();
  context.arc(handle.x, handle.y, handle.radius + (active ? 4 : 0), 0, TAU);
  context.fillStyle = handle.fill;
  context.globalAlpha = active ? 0.28 : 0.14;
  context.fill();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(handle.x, handle.y, handle.radius, 0, TAU);
  context.fillStyle = "#050706";
  context.fill();
  context.strokeStyle = handle.fill;
  context.lineWidth = active ? 2 : 1.2;
  context.stroke();
  context.beginPath();
  context.arc(handle.x, handle.y, 2.3, 0, TAU);
  context.fillStyle = handle.fill;
  context.fill();
  context.font = "7px ui-monospace, monospace";
  context.textAlign = handle.align ?? "center";
  context.fillStyle = handle.fill;
  context.fillText(handle.label, handle.labelX ?? handle.x, handle.y - handle.radius - 8);
  context.restore();
}

function updateHandles() {
  const focusLeft = cssWidth * 0.48;
  const focusRight = cssWidth * 0.82;
  const focusTop = cssHeight * 0.3;
  const focusBottom = cssHeight * 0.56;
  const handleHarmonic = state.harmonicNumber;
  const harmonicUnit = (handleHarmonic - 4) / 16;
  handles = [
    {
      id: "tongue",
      label: `OVERTONE FOCUS · H${handleHarmonic.toFixed(0)}`,
      x: lerp(focusLeft, focusRight, harmonicUnit),
      y: lerp(focusBottom, focusTop, state.formantConvergence),
      radius: 10,
      fill: "#af8cff",
    },
    {
      id: "pharynx",
      label: "PHARYNX",
      x: cssWidth * 0.36,
      y: lerp(cssHeight * 0.66, cssHeight * 0.38, state.uvularConstriction),
      radius: 9,
      fill: "#d7b35c",
    },
    {
      id: "false-folds",
      label: `FALSE FOLDS · ${state.falseFoldDivision}:1 · ${Math.round(state.falseFoldCoupling * 100)}%`,
      x: cssWidth * 0.17,
      y: lerp(cssHeight * 0.78, cssHeight * 0.48, state.falseFoldCoupling),
      radius: 9,
      fill: "#ff7c69",
      align: "left",
      labelX: cssWidth * 0.1,
    },
  ];
}

function draw(now = performance.now()) {
  resizeCanvas();
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawBackdrop(drawing);
  const performanceState = performanceAt(now);
  currentPerformance = performanceState;
  currentFocus = performanceState.focus;
  const profile = throatSingingTractProfile(performanceState);
  const geometry = anatomyGeometry(profile);
  drawHeadOutline(drawing, geometry, now, performanceState);
  drawTube(drawing, profile, geometry, now);
  drawSpectrum(drawing, performanceState);
  updateHandles();
  for (const handle of handles) drawHandle(drawing, handle);

  if (graph?.analyser && singing && audioOn) {
    graph.analyser.getFloatFrequencyData(spectrum);
  }
  const gestureAge = now - gestureStartedAt;
  if (gestureAge >= 0 && gestureAge < 1_850) {
    $("gestureButton").classList.add("is-active");
  }
  if (graph && now - lastAudioUpdateAt >= 25) {
    applyAudioParameters(false, now);
    lastAudioUpdateAt = now;
  }
  if (now % 120 < 18) updateReadouts(now);
  animationFrame = requestAnimationFrame(draw);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * cssWidth / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * cssHeight / Math.max(1, rect.height),
  };
}

function hitHandle(point) {
  return handles
    .map((handle) => ({ handle, distance: Math.hypot(point.x - handle.x, point.y - handle.y) }))
    .sort((left, right) => left.distance - right.distance)
    .find(({ handle, distance }) => distance <= handle.radius + 16)?.handle ?? null;
}

function applyPointerDrag(point) {
  if (!pointerDrag) return;
  if (pointerDrag.id === "tongue") {
    const harmonic = Math.round(lerp(4, 20, clamp((point.x - cssWidth * 0.48) / (cssWidth * 0.34))));
    const convergence = 1 - clamp((point.y - cssHeight * 0.3) / (cssHeight * 0.26));
    state = sanitizedAppState({
      ...state,
      harmonicNumber: harmonic,
      formantConvergence: convergence,
      alveolarConstriction: clamp(0.1 + convergence * 0.9),
    }, state);
  } else if (pointerDrag.id === "pharynx") {
    const amount = 1 - clamp((point.y - cssHeight * 0.38) / (cssHeight * 0.28));
    state = sanitizedAppState({ ...state, uvularConstriction: amount }, state);
  } else if (pointerDrag.id === "false-folds") {
    const amount = 1 - clamp((point.y - cssHeight * 0.48) / (cssHeight * 0.3));
    state = sanitizedAppState({ ...state, falseFoldCoupling: amount }, state);
  }
  markCustomEdit();
  lastTractSignature = "";
  updateReadouts();
  applyAudioParameters();
}

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  const handle = hitHandle(point);
  if (!handle) return;
  event.preventDefault();
  pointerDrag = { id: handle.id, pointerId: event.pointerId };
  canvas.setPointerCapture?.(event.pointerId);
  canvas.classList.add("is-dragging");
  applyPointerDrag(point);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  applyPointerDrag(canvasPoint(event));
});

function releasePointer(event) {
  if (!pointerDrag || (event?.pointerId !== undefined && event.pointerId !== pointerDrag.pointerId)) return;
  const moved = pointerDrag.id;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (event?.pointerId !== undefined) canvas.releasePointerCapture?.(event.pointerId);
  const messages = {
    tongue: `Overtone focus H${state.harmonicNumber}, convergence ${formatPercent(state.formantConvergence)}.`,
    pharynx: `Upper-pharynx constriction ${formatPercent(state.uvularConstriction)}.`,
    "false-folds": `Ventricular-fold coupling ${formatPercent(state.falseFoldCoupling)}, ${formatDivision(state.falseFoldDivision)}.`,
  };
  announce(messages[moved]);
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);

canvas.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 3 : 1;
  if (event.key === "ArrowLeft") setHarmonic(state.harmonicNumber - step, { announceChange: false });
  if (event.key === "ArrowRight") setHarmonic(state.harmonicNumber + step, { announceChange: false });
  if (event.key === "ArrowUp") editModelValue(
    "formantConvergence",
    state.formantConvergence + step * 0.03,
  );
  if (event.key === "ArrowDown") editModelValue(
    "formantConvergence",
    state.formantConvergence - step * 0.03,
  );
  announce(`H${state.harmonicNumber}, formant convergence ${formatPercent(state.formantConvergence)}.`);
});

function keyboardTargetIsEditable(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement
    || target instanceof HTMLElement && target.closest("summary, [role='button']")
    || target?.isContentEditable;
}

globalThis.addEventListener("keydown", (event) => {
  if (event.repeat || keyboardTargetIsEditable(event.target)) return;
  const key = event.key.toLowerCase();
  if (event.code === "Space") {
    event.preventDefault();
    setSinging(!singing);
    return;
  }
  const note = NOTE_KEYS.find((entry) => entry.key === key);
  if (note) {
    event.preventDefault();
    setDroneFrequency(note.frequency);
    return;
  }
  if (/^[4-9]$/.test(key)) {
    event.preventDefault();
    setHarmonic(Number(key));
  } else if (key === "0") {
    event.preventDefault();
    setHarmonic(10);
  }
});

$("audioButton").addEventListener("click", () => setAudioEnabled(!audioWanted));
$("singButton").addEventListener("click", () => setSinging(!singing));
$("gestureButton").addEventListener("click", triggerGesture);
$("resetButton").addEventListener("click", () => {
  loadStyle("open-drone", { announceChange: false, preserveRuntime: false });
  setAudioPresentation(audioOn ? "on" : "off");
  announce("Throat Singing reset to the open discovery drone.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    singing = false;
    setAudioPresentation(audioOn ? "on" : "off");
    applyAudioParameters();
  }
});

globalThis.addEventListener("pagehide", () => {
  pageActive = false;
  cancelAnimationFrame(animationFrame);
  destroyAudio();
}, { once: true });

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
resizeObserver?.observe(stageWrap);
globalThis.addEventListener("resize", resizeCanvas, { passive: true });

buildStyleButtons();
buildNoteButtons();
installControls();
resizeCanvas();
updateReadouts();
setAudioPresentation("off");
animationFrame = requestAnimationFrame(draw);
