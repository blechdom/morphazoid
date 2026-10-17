import {
  FALSE_FOLD_AUDIBILITY_THRESHOLD,
  THROAT_SINGING_LIMITS,
  THROAT_SINGING_STYLE_PRESETS,
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
} from "./throat-singing.js";
import { glottalHarmonics } from "../../families/tract/throatazoid.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { unlockAudioContext } from "../../audio.js";
import { canvasSizing } from "../../graphics/canvas-sizing.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { COMPUTER_KEYBOARD_LAYOUTS } from "../../midi-manager.js";
import { createVoiceEffects } from "./voice-effects.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import {
  THROAT_SINGER_PRESETS, ORNAMENT_PATTERNS, PITCH_MELODIES, breathEnvelope,
  sanitizePerformanceSettings, sanitizeSingerExtras, evaluateSingerPerformance, randomizeSingerPreset,
} from "./performance-patterns.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const TAU = Math.PI * 2;
const HARMONICS = Object.freeze(Array.from({ length: 21 }, (_, index) => index + 4));
const FOCUS_FIELD = Object.freeze({ left: 0.45, right: 0.83, top: 0.205, bottom: 0.58 });
const AIRFLOW_FIELD = Object.freeze({ x: 0.27, top: 0.67, bottom: 0.87 });
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const NOTE_KEYS = Object.freeze(Object.entries(COMPUTER_KEYBOARD_LAYOUTS.piano.noteOffsets).map(([code, offset]) => ({
  code, key: code.replace(/^(Key|Digit)/, "").toLowerCase(), offset,
  label: `${NOTE_NAMES[offset % 12]}${2 + Math.floor(offset / 12)}`,
  frequency: 65.40639132514966 * 2 ** (offset / 12),
})));
const knobWidgets = [];
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
    format: (value) => `${value.toFixed(1)} H`,
  },
  { id: "pulseRate", key: "pulseRate", extra: true, format: (value) => `${value.toFixed(1)} Hz` },
  { id: "pulseDepth", key: "pulseDepth", extra: true, format: formatPercent },
  { id: "phantomAirways", key: "phantomAirways", extra: true, format: (value) => `${Math.round(value)} ${Math.round(value) === 1 ? "airway" : "airways"}` },
  { id: "impossibleFocus", key: "impossibleFocus", extra: true, format: formatPercent },
  { id: "sourceInstability", key: "sourceInstability", extra: true, format: formatPercent },
  ...[
    ["pitchVoices", (v) => `${Math.round(v)}`],
    ["pitchSpreadSemitones", (v) => `${v.toFixed(1)} st`],
    ["overtoneVoices", (v) => `${Math.round(v)}`],
    ["overtoneSpread", (v) => `${v.toFixed(1)} H`],
    ["reverbMix", formatPercent], ["delayMix", formatPercent],
    ["delayTimeSeconds", (v) => `${v.toFixed(2)} s`], ["delayFeedback", formatPercent],
  ].map(([id, format]) => ({ id, key: id, extra: true, format })),
  { id: "level", key: "level", format: formatPercent },
]);

let state = throatSingingState("open-drone", { level: 0.28 });
let extras = { ...sanitizeSingerExtras(EXTRA_STYLE_VALUES["open-drone"]) };
let activeStyleId = "open-drone";
let modelProvenance = { kind: "preset", id: "open-drone" };
let audioContext = null;
let graph = null;
let audioOn = false;
let audioWanted = false;
let audioStarting = null;
let audioGeneration = 0;
let singing = false;
let animationFrame = 0;
let lastReadoutAt = -Infinity;
let lastTractSignature = "";
let lastWaveKey = "";
let lastVentricularWaveKey = "";
let performanceSeconds = 0;
let clockLastSeconds = performance.now() / 1_000;
let clockIsAudio = false;
let ornamentCycles = 0;
let melodyCycles = 0;
let vibratoCycles = 0;
let pulseCycles = 0;
let breathCycles = 0;
let automaticBreathAtSeconds = -Infinity;
let performanceSettings = sanitizePerformanceSettings({ ornamentPlaying: false, melodyPlaying: false });
let melodyGlideRateHz = performanceSettings.melodyRateHz;
let manualBreathAtSeconds = -Infinity;
let currentBreath = { gain: 1, inhaling: false, phase: 0 };
let voiceGateFrom = 0;
let voiceGateTarget = 0;
let voiceGateStarted = performance.now() / 1000;
let glideFromHz = state.trueFoldHz;
let glideStartedSeconds = 0;
let currentAnimation = {};
let currentPerformanceExtras = extras;
let ornamentFinished = false;
const trackCompleted = { ornament: false, melody: false };
let presetController = null;
let audioScheduler = 0;
let scheduledAudioTime = null;
let nextAudioScheduleTime = 0;
// Anatomy uses one fixed coordinate system; resizing applies one uniform scale.
let cssWidth = 900;
let cssHeight = 720;
let viewWidth = 1;
let viewHeight = 1;
let viewScale = 1;
let viewX = 0;
let viewY = 0;
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
  return `1:${division}`;
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

function compactStyleLabel(style) {
  return style.label.replace(/ — comparison$/, "");
}

function markCustomEdit() {
  sourceWaveTransitionGeneration += 1;
  sourceWaveMuted = false;
  presetController?.refresh();
  if (modelProvenance.kind === "custom") return;
  modelProvenance = { kind: "custom", fromId: modelProvenance.id };
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

function performanceElapsed() {
  const useAudio = audioContext?.state === "running";
  const clock = useAudio ? audioContext.currentTime : performance.now() / 1_000;
  if (useAudio !== clockIsAudio) {
    clockIsAudio = useAudio;
    clockLastSeconds = clock;
  }
  const elapsed = Math.max(0, clock - clockLastSeconds);
  if (singing) {
    performanceSeconds += elapsed;
    vibratoCycles += elapsed * state.vibratoRateHz;
    pulseCycles += elapsed * extras.pulseRate;
    const previousBreathCycles = breathCycles;
    const breathRateHz = performanceSettings.breathRateBpm / 60;
    breathCycles += elapsed * breathRateHz;
    if (breathRateHz > 0 && Math.floor(breathCycles) > Math.floor(previousBreathCycles)) {
      automaticBreathAtSeconds = performanceSeconds - (breathCycles % 1) / breathRateHz;
    }
  }
  if (performanceSettings.ornamentPlaying) ornamentCycles += elapsed * state.motionRateHz;
  if (performanceSettings.melodyPlaying) {
    const previousCycles = melodyCycles;
    melodyCycles += elapsed * performanceSettings.melodyRateHz;
    if (melodyNotePosition(previousCycles) !== melodyNotePosition(melodyCycles)) {
      melodyGlideRateHz = performanceSettings.melodyRateHz;
    }
  }
  clockLastSeconds = clock;
  return performanceSeconds;
}

function melodyNotePosition(cycles) {
  const melody = PITCH_MELODIES.find(({ id }) => id === performanceSettings.melodyId);
  return Math.floor(cycles * (melody?.notes.length ?? 1));
}

function performanceAt(_now = performance.now(), aheadSeconds = 0) {
  const seconds = performanceElapsed() + (singing ? aheadSeconds : 0);
  const futureMelodyCycles = melodyCycles + (performanceSettings.melodyPlaying ? aheadSeconds * performanceSettings.melodyRateHz : 0);
  const evaluated = evaluateSingerPerformance({ ...state, trueFoldHz: glideBaseFrequency(aheadSeconds) }, extras, performanceSettings, seconds, {
    ornamentCycles: ornamentCycles + (performanceSettings.ornamentPlaying ? aheadSeconds * state.motionRateHz : 0),
    melodyCycles: futureMelodyCycles,
    // Keep the current note's glide contour intact when changing tempo.
    melodyGlideRateHz: melodyNotePosition(futureMelodyCycles) === melodyNotePosition(melodyCycles)
      ? melodyGlideRateHz : performanceSettings.melodyRateHz,
    vibratoCycles: vibratoCycles + (singing ? aheadSeconds * state.vibratoRateHz : 0),
    pulseCycles: pulseCycles + (singing ? aheadSeconds * extras.pulseRate : 0),
  });
  if (!aheadSeconds) {
    currentAnimation = evaluated.animation;
    currentPerformanceExtras = evaluated.extras;
    for (const track of ["ornament", "melody"]) {
      if (evaluated[`${track}Finished`] && performanceSettings[`${track}Playing`]) {
        trackCompleted[track] = true;
        performanceSettings = sanitizePerformanceSettings({ ...performanceSettings, [`${track}Playing`]: false });
      }
    }
    ornamentFinished = evaluated.ornamentFinished || trackCompleted.ornament;
  }
  const performanceState = { ...evaluated.performance };
  const breathRateHz = performanceSettings.breathRateBpm / 60;
  const futureBreathCycles = breathCycles + (singing ? aheadSeconds * breathRateHz : 0);
  const predictedBreathAtSeconds = breathRateHz > 0 && Math.floor(futureBreathCycles) > Math.floor(breathCycles)
    ? seconds - (futureBreathCycles % 1) / breathRateHz : automaticBreathAtSeconds;
  const breath = breathEnvelope(seconds, {
    automaticBreathAtSeconds: predictedBreathAtSeconds, manualBreathAtSeconds,
  });
  if (!aheadSeconds) currentBreath = breath;
  performanceState.breathGain = breath.gain;
  return performanceState;
}

function glideBaseFrequency(aheadSeconds = 0) {
  const amount = performanceSettings.portamentoSeconds > 0
    ? clamp((performance.now() / 1000 + aheadSeconds - glideStartedSeconds) / performanceSettings.portamentoSeconds) : 1;
  return glideFromHz * (state.trueFoldHz / glideFromHz) ** (amount * amount * (3 - 2 * amount));
}

function voiceEnvelope(aheadSeconds = 0) {
  const duration = voiceGateTarget ? .35 : .22;
  const phase = clamp((performance.now() / 1000 + aheadSeconds - voiceGateStarted) / duration);
  return lerp(voiceGateFrom, voiceGateTarget, phase * phase * (3 - 2 * phase));
}

function updateReadouts(now = performance.now()) {
  currentPerformance = performanceAt(now);
  currentFocus = currentPerformance.focus;
  const drone = currentPerformance.heardDroneHz;
  $("levelOut").textContent = formatPercent(state.level);
  $("styleSelect").value = activeStyleId;

  for (const binding of CONTROL_BINDINGS) updateControl(binding);
  updatePhraseControls();
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
  presetController?.refresh();
}

function editModelValue(key, value, { message = "", immediate = false } = {}) {
  performanceElapsed();
  if (key === "trueFoldHz") {
    glideFromHz = glideBaseFrequency(); glideStartedSeconds = performance.now() / 1000;
  }
  state = sanitizedAppState({ ...state, [key]: value }, state);
  if (key !== "level") markCustomEdit();
  updateReadouts();
  applyAudioParameters(immediate);
  if (message) announce(message);
}

function editExtraValue(key, value, { message = "" } = {}) {
  performanceElapsed();
  extras = { ...sanitizeSingerExtras({ ...extras, [key]: value }) };
  markCustomEdit();
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
    return Promise.resolve();
  }

  sourceWaveMuted = true;
  setAudioParam(graph.masterGain.gain, 0, false, 0.0035);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (generation !== sourceWaveTransitionGeneration || !graph) { resolve(); return; }
      try { commit(true); } catch (error) { sourceWaveMuted = false; reject(error); return; }
      setTimeout(() => {
        if (generation === sourceWaveTransitionGeneration && graph) {
          sourceWaveMuted = false;
          applyAudioParameters(false);
        }
        resolve();
      }, 7);
    }, 18);
  });
}

function loadStyle(styleId, { announceChange = true, preserveRuntime = true } = {}) {
  const next = throatSingingState(styleId);
  return performSilentModelSwap((immediate) => {
    performanceElapsed();
    state = sanitizedAppState({
      ...next,
      level: preserveRuntime ? state.level : next.level,
    }, next);
    const runtimeExtras = preserveRuntime
      ? Object.fromEntries([...RUNTIME_EXTRA_KEYS].map((key) => [key, extras[key]]))
      : {};
    extras = { ...sanitizeSingerExtras({
      ...(preserveRuntime ? extras : {}),
      ...(EXTRA_STYLE_VALUES[styleId] ?? EXTRA_STYLE_VALUES["open-drone"]), ...runtimeExtras,
    }) };
    glideFromHz = state.trueFoldHz;
    activeStyleId = next.styleId;
    modelProvenance = { kind: "preset", id: next.styleId };
    performanceSettings = sanitizePerformanceSettings({
      ...performanceSettings,
      ornamentId: ({ borbangnadyr: "roll", ezengileer: "double-pulse", sygyt: "flutter",
        xoomei: "spiral", kargyraa: "rock", "western-overtone": "ripple", "low-chant": "breath-wave" })[styleId] ?? "none",
    });
    ornamentCycles = 0; trackCompleted.ornament = false;
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
  const select = $("styleSelect");
  for (const style of THROAT_SINGING_STYLE_PRESETS) {
    const option = document.createElement("option");
    option.value = style.id; option.textContent = compactStyleLabel(style); select.append(option);
  }
  select.addEventListener("change", () => loadStyle(select.value));
}

function setHarmonic(harmonic, { announceChange = true } = {}) {
  const requested = Math.round(clamp(
    harmonic,
    THROAT_SINGING_LIMITS.harmonicNumber[0],
    THROAT_SINGING_LIMITS.harmonicNumber[1],
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
  glideFromHz = glideBaseFrequency();
  glideStartedSeconds = performance.now() / 1000;
  state = sanitizedAppState({ ...state, trueFoldHz }, state);
  markCustomEdit();
  updateReadouts();
  applyAudioParameters();
  if (announceChange) announce(`Drone ${formatFrequency(heardDroneFrequencyHz(state))}.`);
}

function buildNoteButtons() {
  const root = $("noteButtons"); root.replaceChildren();
  for (const octave of [1, 0]) {
    const row = document.createElement("div"); row.className = "throat-keyboard-row";
    for (const note of NOTE_KEYS.filter(({ offset }) => Math.floor(offset / 12) === octave)) {
      const button = document.createElement("button"); button.type = "button";
      button.dataset.noteFrequency = String(note.frequency); button.dataset.noteKey = note.key;
      button.dataset.black = String(note.label.includes("♯"));
      button.setAttribute("aria-label", `${note.label} drone, ${note.key.toUpperCase()} key`);
      button.innerHTML = `<kbd>${note.key.toUpperCase()}</kbd><span>${note.label}</span>`;
      button.addEventListener("click", () => setDroneFrequency(note.frequency)); row.append(button);
    }
    root.append(row);
  }
}

function installKnobs() {
  document.querySelectorAll(".throat-panel .control input[type=range]").forEach(input => {
    const control = input.closest(".control");
    if (control.classList.contains("throat-slider")) return;
    const output = control.querySelector("output");
    const dial = document.createElement("span"); dial.className = "throat-dial";
    input.before(dial); dial.append(input);
    if (output) dial.append(output);
    knobWidgets.push(enhanceRangeKnob(input));
  });
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

function captureSingerPreset() {
  const { level, active, ...parameters } = state;
  return { state: parameters, extras: { ...extras }, settings: { ...performanceSettings } };
}

function applySingerPreset(snapshot) {
  if (!snapshot?.state || !snapshot.extras || !snapshot.settings) throw new Error("Incomplete voice preset");
  const nextState = sanitizedAppState({ ...snapshot.state, level: state.level, active: state.active });
  const nextSettings = sanitizePerformanceSettings(snapshot.settings);
  return performSilentModelSwap((immediate) => {
    performanceElapsed();
    state = nextState;
    extras = { ...sanitizeSingerExtras(snapshot.extras) };
    performanceSettings = nextSettings;
    ornamentCycles = 0;
    melodyCycles = 0;
    melodyGlideRateHz = performanceSettings.melodyRateHz;
    trackCompleted.ornament = trackCompleted.melody = false;
    glideFromHz = state.trueFoldHz;
    activeStyleId = state.styleId;
    modelProvenance = { kind: "custom", fromId: state.styleId };
    lastTractSignature = "";
    updateReadouts();
    applyAudioParameters(immediate);
  });
}

function updatePhraseControls() {
  $("ornamentSelect").value = performanceSettings.ornamentId;
  $("melodySelect").value = performanceSettings.melodyId;
  for (const [id, key, format] of [
    ["melodyRate", "melodyRateHz", v => `${v.toFixed(2)} Hz`],
    ["melodyDepth", "melodyDepthSemitones", v => `${v.toFixed(1)} st`],
    ["breathRate", "breathRateBpm", v => v === 0 ? "Never" : `${Number(v.toFixed(1))}/min`],
    ["portamento", "portamentoSeconds", v => v === 0 ? "Off" : `${v.toFixed(2)} s`],
  ]) {
    $(id).value = String(performanceSettings[key]);
    $(`${id}Out`).textContent = format(performanceSettings[key]);
    $(id).setAttribute("aria-valuetext", format(performanceSettings[key]));
  }
  for (const [track, buttonId, finished] of [["ornament", "gestureButton", ornamentFinished], ["melody", "melodyButton", currentAnimation.melodyFinished]]) {
    const playing = performanceSettings[`${track}Playing`] && !finished;
    setPressed($(buttonId), playing);
    $(buttonId).setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${track}`);
    $(buttonId).title = `${playing ? "Pause" : "Play"} ${track}`;
    const reverse = performanceSettings[`${track}Direction`] === "reverse";
    setPressed($(`${track}Direction`), reverse);
    $(`${track}Direction`).firstElementChild.textContent = reverse ? "←" : "→";
    $(`${track}Direction`).setAttribute("aria-label", `${track} direction: ${reverse ? "reverse" : "forward"}`);
    setPressed($(`${track}PingPong`), performanceSettings[`${track}PingPong`]);
    setPressed($(`${track}Repeat`), performanceSettings[`${track}Repeat`]);
  }
  $("breathButton").classList.toggle("is-inhaling", currentBreath.inhaling);
  canvas.dataset.ornament = performanceSettings.ornamentId;
  canvas.dataset.melody = performanceSettings.melodyId;
  canvas.dataset.phase = (currentAnimation.ornamentPhase ?? 0).toFixed(3);
  canvas.dataset.melodyPhase = (currentAnimation.melodyPhase ?? 0).toFixed(3);
  canvas.dataset.pitchHz = currentPerformance.trueFoldHz.toFixed(2);
  canvas.dataset.breathGain = currentBreath.gain.toFixed(3);
  canvas.dataset.breathState = currentBreath.inhaling ? "inhaling" : "singing";
  canvas.dataset.voiceGain = voiceEnvelope().toFixed(3);
  canvas.dataset.pitchVoices = String(extras.pitchVoices);
  canvas.dataset.overtoneVoices = String(extras.overtoneVoices);
  for (const widget of knobWidgets) widget.update();
}

function editPerformanceSetting(key, value) {
  performanceElapsed();
  performanceSettings = sanitizePerformanceSettings({ ...performanceSettings, [key]: value });
  if (key === "ornamentId") {
    ornamentCycles = 0; trackCompleted.ornament = false;
    if (value !== "none") state = sanitizedAppState({ ...state, motionRateHz: state.motionRateHz || .75, motionDepth: state.motionDepth || .5 });
  }
  if (key === "melodyId") {
    melodyCycles = 0; trackCompleted.melody = false;
    melodyGlideRateHz = performanceSettings.melodyRateHz;
  }
  if (key === "melodyRateHz" && (!performanceSettings.melodyPlaying || melodyCycles === 0)) {
    melodyGlideRateHz = performanceSettings.melodyRateHz;
  }
  markCustomEdit(); updateReadouts(); applyAudioParameters();
}

function toggleTrack(track) {
  const finished = trackCompleted[track];
  if (finished) { if (track === "ornament") ornamentCycles = 0; else melodyCycles = 0; trackCompleted[track] = false; }
  if (finished && track === "melody") melodyGlideRateHz = performanceSettings.melodyRateHz;
  if (performanceSettings[`${track}Id`] === (track === "ornament" ? "none" : "steady")) {
    editPerformanceSetting(`${track}Id`, track === "ornament" ? "swell" : "arch");
  }
  editPerformanceSetting(`${track}Playing`, finished || !performanceSettings[`${track}Playing`]);
}

function installPatternControls() {
  for (const [selectId, key, bank, nextId] of [
    ["ornamentSelect", "ornamentId", ORNAMENT_PATTERNS, "ornamentNext"],
    ["melodySelect", "melodyId", PITCH_MELODIES, "melodyNext"],
  ]) {
    const select = $(selectId);
    select.replaceChildren(...bank.map(pattern => {
      const option = document.createElement("option"); option.value = pattern.id; option.textContent = pattern.label; return option;
    }));
    select.addEventListener("change", () => editPerformanceSetting(key, select.value));
    $(nextId).addEventListener("click", () => {
      const index = bank.findIndex(({ id }) => id === performanceSettings[key]);
      editPerformanceSetting(key, bank[(Math.max(0, index) + 1) % bank.length].id);
    });
  }
  for (const track of ["ornament", "melody"]) {
    $(`${track}Direction`).addEventListener("click", () => editPerformanceSetting(`${track}Direction`, performanceSettings[`${track}Direction`] === "forward" ? "reverse" : "forward"));
    for (const mode of ["PingPong", "Repeat"]) $(`${track}${mode}`).addEventListener("click", () => editPerformanceSetting(`${track}${mode}`, !performanceSettings[`${track}${mode}`]));
  }
  for (const [id, key] of [["melodyRate","melodyRateHz"], ["melodyDepth","melodyDepthSemitones"], ["breathRate","breathRateBpm"], ["portamento","portamentoSeconds"]]) {
    $(id).addEventListener("input", event => editPerformanceSetting(key, Number(event.target.value)));
  }
  $("breathButton").addEventListener("click", () => {
    manualBreathAtSeconds = performanceElapsed(); updateReadouts(); applyAudioParameters(); announce("Breath taken.");
  });
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
  if (scheduledAudioTime !== null) {
    parameter.linearRampToValueAtTime?.(value, scheduledAudioTime);
    return;
  }
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
      new URL("../../families/tract/throatazoid-tract-processor.js", import.meta.url),
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
  const voiceEffects = createVoiceEffects(audio, { input: mix, overtoneInput: tractOutput, output: highpass });
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
    voiceEffects,
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
    nasalCoupling: 0.08 + performanceState.lipRounding * 0.08,
    articulationManner: "vowel",
    fricationGain: 0,
    burstGain: 0,
    exciterIntensity: performanceState.intensity,
    voiceMode: "shared",
    performanceGate: audioOn && voiceEnvelope() > .001 ? 1 : 0,
    pressureSourceCount: 1,
    pressureSources: [{ open: true, level: performanceState.intensity }],
    tongueCount: 1,
    noseCount: 1,
    mouths,
    throats: mouths,
    tongues: [{
      position: clamp(0.35 + performanceState.uvularConstriction * 0.27),
      height: clamp(0.08 + performanceState.alveolarConstriction * 0.26),
      curl: clamp(0.28 + performanceState.frontCavityExpansion * 0.3),
    }],
    tractDeformations,
    noses: [{ openness: 0.08 + performanceState.lipRounding * 0.08, length: 0.5, resonance: 0.35 }],
  };
}

function applyAudioParameters(immediate = false, now = performance.now(), aheadSeconds = 0) {
  if (!graph || !audioContext) return;
  const performanceState = performanceAt(now, aheadSeconds);
  if (scheduledAudioTime === null) {
    nextAudioScheduleTime = audioContext.currentTime;
    currentPerformance = performanceState;
    currentFocus = performanceState.focus;
  }
  const live = audioOn && audioContext.state === "running" && (singing || voiceEnvelope(aheadSeconds) > .001);
  const pressure = performanceState.intensity;
  const creak = performanceState.creakAmount;
  const coupling = performanceState.falseFoldCoupling;
  const division = performanceState.falseFoldDivision;
  const ventricularCycle = scheduledAudioTime === null
    ? updateVentricularWaveform(performanceState, immediate || !live) : graph.ventricularCycle;
  const meanClosure = ventricularCycle?.meanClosure ?? 0;
  const meanSquaredClosure = ventricularCycle?.meanSquaredClosure ?? 0;
  const gateRms = Math.sqrt(Math.max(
    0.08,
    1 - 2 * coupling * meanClosure + coupling * coupling * meanSquaredClosure,
  ));
  const closureCompensation = clamp(1 / gateRms, 1, 1.25);
  const pulseDepth = extras.pulseDepth;
  const gate = live ? voiceEnvelope(aheadSeconds) * performanceState.breathGain : 0;
  const voicedPressure = pressure * (1 - creak * 0.16);
  const pulseBase = gate * voicedPressure
    * (1 - pulseDepth * 0.34 + performanceState.pressurePulseWave * 0.34) * closureCompensation;

  if (scheduledAudioTime === null) updateGlottalWaveform(performanceState, immediate || !live);
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
  // Source pulses share the performance clock with their visible motion.
  setAudioParam(graph.pulseDepth.gain, 0, immediate || !live, 0.04);
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
    audioOn && !sourceWaveMuted ? Math.sqrt(clamp(state.level, 0, 1)) * 0.47 : 0,
    immediate || !audioOn,
    sourceWaveMuted ? 0.0035 : 0.035,
  );

  graph.voiceEffects.update({ ...performanceState, harmonicNumber: performanceState.targetHarmonic, focusQ, extras, voiceGain: gate }, scheduledAudioTime ?? audioContext.currentTime, performanceSettings.portamentoSeconds, { replaceScheduled: scheduledAudioTime === null });
  if (scheduledAudioTime !== null) return;
  updatePhysicalTract(performanceState, immediate);
}

function updatePhysicalTract(performanceState, immediate = false) {
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
    setAudioParam(graph.fallbackF2.frequency, clamp(performanceState.focus.f2Hz * 0.68, 620, 2_600), immediate, 0.04);
  }
}

function scheduleAudioPerformance() {
  if (!graph || audioContext?.state !== "running" || !pageActive) return;
  const current = performanceAt();
  updatePhysicalTract(current);
  updateGlottalWaveform(current);
  updateVentricularWaveform(current);
  const now = audioContext.currentTime;
  nextAudioScheduleTime = Math.max(nextAudioScheduleTime, now + 0.005);
  try {
    while (nextAudioScheduleTime < now + 0.18) {
      scheduledAudioTime = nextAudioScheduleTime;
      applyAudioParameters(false, performance.now(), nextAudioScheduleTime - now);
      nextAudioScheduleTime += 0.025;
    }
  } finally {
    scheduledAudioTime = null;
  }
}

function setAudioPresentation(status) {
  setPressed($("audioButton"), status === "on");
  $("audioState").textContent = status === "on" ? "on" : "off";
  $("audioButton").disabled = status === "starting";
  setPressed($("singButton"), singing);
  $("singButton").setAttribute("aria-label", singing ? "Pause voice" : "Play voice");
  $("singButton").title = singing ? "Pause voice" : "Play voice";
}

async function setAudioEnabled(enabled) {
  const nextWanted = Boolean(enabled);
  const requestGeneration = nextWanted === audioWanted
    ? audioGeneration
    : ++audioGeneration;
  audioWanted = nextWanted;
  if (!enabled) {
    performanceElapsed();
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

function setSinging(enabled) {
  const next = Boolean(enabled);
  performanceElapsed();
  voiceGateFrom = voiceEnvelope();
  voiceGateStarted = performance.now() / 1000;
  voiceGateTarget = next ? 1 : 0;
  singing = next;
  lastTractSignature = "";
  setAudioPresentation(audioOn ? "on" : "off");
  applyAudioParameters();
  announce(next
    ? `Drone sounding at ${formatFrequency(heardDroneFrequencyHz(state))}; H${state.harmonicNumber} focused at ${formatFrequency(harmonicFrequencyHz(state))}.`
    : "Drone released.");
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* The context may already be closed. */ }
}

async function destroyAudio() {
  clearInterval(audioScheduler);
  audioGeneration += 1;
  audioWanted = false;
  audioOn = false;
  singing = false;
  const context = audioContext;
  const activeGraph = graph;
  graph = null;
  audioContext = null;
  activeGraph?.releaseAudioOutput?.();
  activeGraph?.voiceEffects?.destroy();
  for (const node of Object.values(activeGraph ?? {})) safeDisconnect(node);
  try { await context?.close?.(); } catch { /* Best-effort page cleanup. */ }
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  const sizing = canvasSizing(rect, globalThis.devicePixelRatio, { pixelBudget: null });
  viewWidth = sizing.cssWidth;
  viewHeight = sizing.cssHeight;
  viewScale = Math.min(viewWidth / cssWidth, viewHeight / cssHeight);
  viewX = (viewWidth - cssWidth * viewScale) / 2;
  viewY = (viewHeight - cssHeight * viewScale) / 2;
  Object.assign(canvas.dataset, { modelWidth: String(cssWidth), modelHeight: String(cssHeight), viewScale: String(viewScale), viewScaleX: String(viewScale), viewScaleY: String(viewScale) });
  pixelRatio = sizing.pixelRatio;
  const width = Math.max(1, sizing.width);
  const height = Math.max(1, sizing.height);
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
  const scale = clamp(Math.min(cssWidth / 58, cssHeight / 30), 6, 19);
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
    x: cssWidth * 0.04,
    y: cssHeight * 0.14,
    width: cssWidth * 0.30,
    height: Math.min(96, cssHeight * 0.14),
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
  tubeGradient.addColorStop(0.76, "rgba(255,130,158,0.26)");
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

  if (singing && currentBreath.gain > .01) {
    const bubbleCount = prefersReducedMotion ? 4 : 11;
    for (let index = 0; index < bubbleCount; index += 1) {
      const travel = ((now * 0.00012 * (0.55 + currentPerformance.intensity) + index / bubbleCount) % 1 + 1) % 1;
      const phase = travel;
      const pointIndex = Math.min(geometry.points.length - 1, Math.floor(phase * geometry.points.length));
      const point = geometry.points[pointIndex];
      const focused = Math.abs(phase - 0.73) < 0.13;
      context.beginPath();
      context.arc(point.x, point.y, (focused ? 2.2 + tractPressure * 2 : 1.4 + tractPressure) * currentBreath.gain, 0, TAU);
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
        ? "rgba(255,130,158,0.66)"
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
  context.strokeStyle = "rgba(233,228,212,0.26)";
  context.lineWidth = 1.5;
  // Keep the rear neck/head edge, leaving the crown open.
  context.beginPath();
  context.moveTo(left - cssWidth * 0.07, lower + cssHeight * 0.13);
  context.bezierCurveTo(left - cssWidth * 0.12, lower - cssHeight * 0.1,
    left - cssWidth * 0.09, mouthLine - cssHeight * 0.18,
    left + cssWidth * 0.045, mouthLine - cssHeight * 0.25);
  context.stroke();
  context.beginPath();
  // An upright nose bridge, without an eyebrow, frames the front of the airway.
  context.moveTo(right + cssWidth * 0.018, mouthLine - cssHeight * 0.30);
  context.lineTo(right + cssWidth * 0.058, mouthLine - cssHeight * 0.14);
  context.quadraticCurveTo(right + cssWidth * 0.084, mouthLine - cssHeight * 0.095, right + cssWidth * 0.01, mouthLine - cssHeight * 0.115);
  context.lineTo(right + cssWidth * 0.008, mouthLine - cssHeight * 0.022);
  const lipExtension = cssWidth * (0.018 + performanceState.lipRounding * 0.03);
  const lipGap = cssHeight * (0.009 + performanceState.mouthOpening * 0.024);
  context.quadraticCurveTo(right + lipExtension, mouthLine - lipGap, right + lipExtension, mouthLine);
  context.stroke();

  // The nasal branch shares the changing lip/airway state sent to the waveguide.
  const nasalPulse = prefersReducedMotion ? 0.5 : ((currentAnimation.nose ?? 0) + 1) * 0.5;
  context.beginPath();
  context.moveTo(cssWidth * 0.42, mouthLine - cssHeight * 0.025);
  context.bezierCurveTo(cssWidth * 0.47, mouthLine - cssHeight * 0.17,
    cssWidth * 0.69, mouthLine - cssHeight * 0.15,
    right + cssWidth * 0.013, mouthLine - cssHeight * 0.13);
  context.strokeStyle = `rgba(112,217,207,${0.2 + (singing ? nasalPulse * 0.25 : 0)})`;
  context.lineWidth = 3 + performanceState.lipRounding * 3;
  context.stroke();

  // Both lip edges move with the actual mouth aperture and rounding.
  context.strokeStyle = "rgba(255,124,105,0.75)";
  context.lineWidth = 2.5;
  for (const direction of [-1, 1]) {
    context.beginPath();
    context.moveTo(right - cssWidth * 0.012, mouthLine + direction * lipGap);
    context.quadraticCurveTo(right + lipExtension * 0.8, mouthLine + direction * lipGap * 1.3,
      right + lipExtension, mouthLine + direction * lipGap * 0.55);
    context.stroke();
  }

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
  const visiblePulse = prefersReducedMotion ? 0.5 : ((currentAnimation.pulse ?? 0) + 1) * 0.5;
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

function drawTongue(context, geometry, performanceState) {
  const floorY = geometry.mouthLine + cssHeight * 0.095;
  const lift = performanceState.alveolarConstriction * cssHeight * 0.072;
  const rearLift = performanceState.uvularConstriction * cssHeight * 0.045;
  context.beginPath();
  context.moveTo(cssWidth * 0.32, floorY + cssHeight * 0.035);
  context.bezierCurveTo(cssWidth * 0.36, floorY - rearLift,
    cssWidth * 0.48, floorY - rearLift * 1.5, cssWidth * 0.54, floorY - lift * 0.5);
  context.bezierCurveTo(cssWidth * 0.65, floorY - lift * 1.7,
    cssWidth * 0.74, floorY - lift * 1.9, cssWidth * 0.81, floorY - lift * 0.25);
  context.quadraticCurveTo(cssWidth * 0.7, floorY + cssHeight * 0.065,
    cssWidth * 0.32, floorY + cssHeight * 0.035);
  context.fillStyle = "rgba(255,166,186,0.72)";
  context.fill();
  context.strokeStyle = "rgba(255,130,158,0.8)";
  context.lineWidth = 1.5;
  context.stroke();
}

function drawHandle(context, handle) {
  const active = pointerDrag?.id === handle.id;
  const radius = Math.max(handle.radius, 8 / viewScale);
  context.save();
  context.beginPath();
  context.arc(handle.x, handle.y, radius + (active ? 4 : 0), 0, TAU);
  context.fillStyle = handle.fill;
  context.globalAlpha = active ? 0.28 : 0.14;
  context.fill();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(handle.x, handle.y, radius, 0, TAU);
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
  const labelY = handle.labelBelow ? handle.y + radius + 14 : handle.y - radius - 8;
  context.fillText(handle.label, handle.labelX ?? handle.x, labelY);
  context.restore();
}

function updateHandles() {
  const focusLeft = cssWidth * FOCUS_FIELD.left;
  const focusRight = cssWidth * FOCUS_FIELD.right;
  const focusTop = cssHeight * FOCUS_FIELD.top;
  const focusBottom = cssHeight * FOCUS_FIELD.bottom;
  const handleHarmonic = pointerDrag ? state.harmonicNumber : currentPerformance.targetHarmonic;
  const harmonicUnit = (handleHarmonic - 4) / 20;
  handles = [
    {
      id: "tongue",
      label: `OVERTONE FOCUS · H${handleHarmonic.toFixed(0)}`,
      x: lerp(focusLeft, focusRight, harmonicUnit),
      y: lerp(focusBottom, focusTop, currentPerformance.formantConvergence),
      radius: 10,
      fill: "#af8cff",
    },
    {
      id: "pharynx",
      label: "PHARYNX",
      x: cssWidth * 0.36,
      y: lerp(cssHeight * 0.66, cssHeight * 0.38, currentPerformance.uvularConstriction),
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
    {
      id: "mouth", label: "MOUTH",
      x: cssWidth * 0.70,
      y: lerp(cssHeight * 0.70, cssHeight * 0.64, currentPerformance.alveolarConstriction),
      radius: 9, fill: "#ff829e",
    },
    {
      id: "lips", label: "LIPS",
      x: lerp(cssWidth * 0.885, cssWidth * 0.95, currentPerformance.lipRounding),
      y: cssHeight * 0.54,
      radius: 9, fill: "#ff7c69",
      labelBelow: true,
    },
    {
      id: "airflow", label: "AIRFLOW",
      x: cssWidth * AIRFLOW_FIELD.x,
      y: lerp(cssHeight * AIRFLOW_FIELD.bottom, cssHeight * AIRFLOW_FIELD.top, state.intensity),
      radius: 9, fill: "#70d9cf",
    },
  ];
}

function draw(now = performance.now()) {
  resizeCanvas();
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.fillStyle = "#050706"; drawing.fillRect(0, 0, viewWidth, viewHeight);
  drawing.setTransform(pixelRatio * viewScale, 0, 0, pixelRatio * viewScale, pixelRatio * viewX, pixelRatio * viewY);
  drawBackdrop(drawing);
  const performanceState = performanceAt(now);
  currentPerformance = performanceState;
  currentFocus = performanceState.focus;
  const profile = throatSingingTractProfile(performanceState);
  const geometry = anatomyGeometry(profile);
  drawHeadOutline(drawing, geometry, performanceElapsed() * 1_000, performanceState);
  drawTongue(drawing, geometry, performanceState);
  drawTube(drawing, profile, geometry, performanceElapsed() * 1_000);
  drawSpectrum(drawing, performanceState);
  updateHandles();
  for (const handle of handles) drawHandle(drawing, handle);

  if (graph?.analyser && singing && audioOn) {
    graph.analyser.getFloatFrequencyData(spectrum);
  }
  if (now - lastReadoutAt >= 120) {
    lastReadoutAt = now;
    updateReadouts(now);
  }
  animationFrame = requestAnimationFrame(draw);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * viewWidth / Math.max(1, rect.width) - viewX) / viewScale,
    y: ((event.clientY - rect.top) * viewHeight / Math.max(1, rect.height) - viewY) / viewScale,
  };
}

function hitHandle(point) {
  return handles
    .map((handle) => ({ handle, distance: Math.hypot(point.x - handle.x, point.y - handle.y) }))
    .sort((left, right) => left.distance - right.distance)
    .find(({ handle, distance }) => distance <= Math.max(handle.radius + 16, 24 / viewScale))?.handle ?? null;
}

function applyPointerDrag(point) {
  if (!pointerDrag) return;
  const dx = point.x - pointerDrag.startPoint.x;
  const dy = point.y - pointerDrag.startPoint.y;
  const initial = pointerDrag.startState;
  if (pointerDrag.id === "tongue") {
    const harmonic = Math.round(clamp(initial.harmonicNumber + dx * 20 / (cssWidth * (FOCUS_FIELD.right - FOCUS_FIELD.left)), 4, 24));
    const convergence = clamp(initial.formantConvergence - dy / (cssHeight * (FOCUS_FIELD.bottom - FOCUS_FIELD.top)));
    state = sanitizedAppState({
      ...state,
      harmonicNumber: harmonic,
      formantConvergence: convergence,
    }, state);
  } else if (pointerDrag.id === "pharynx") {
    const amount = clamp(initial.uvularConstriction - dy / (cssHeight * 0.28));
    state = sanitizedAppState({ ...state, uvularConstriction: amount }, state);
  } else if (pointerDrag.id === "false-folds") {
    const amount = clamp(initial.falseFoldCoupling - dy / (cssHeight * 0.3));
    const division = Math.round(clamp(initial.falseFoldDivision + dx / (cssWidth * 0.035), 1, 7));
    state = sanitizedAppState({ ...state, falseFoldCoupling: amount, falseFoldDivision: division }, state);
  } else if (pointerDrag.id === "mouth") {
    state = sanitizedAppState({ ...state, alveolarConstriction: clamp(initial.alveolarConstriction - dy / (cssHeight * 0.18)) }, state);
  } else if (pointerDrag.id === "lips") {
    state = sanitizedAppState({ ...state,
      lipRounding: clamp(initial.lipRounding + dx / (cssWidth * 0.1)),
      mouthOpening: clamp(initial.mouthOpening - dy / (cssHeight * 0.18)),
    }, state);
  } else if (pointerDrag.id === "airflow") {
    state = sanitizedAppState({ ...state,
      intensity: clamp(initial.intensity - dy / (cssHeight * (AIRFLOW_FIELD.bottom - AIRFLOW_FIELD.top))),
    }, state);
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
  pointerDrag = { id: handle.id, pointerId: event.pointerId, startPoint: point, startState: { ...state } };
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
    mouth: `Mouth constriction ${formatPercent(state.alveolarConstriction)}.`,
    lips: `Lip rounding ${formatPercent(state.lipRounding)}, mouth opening ${formatPercent(state.mouthOpening)}.`,
    airflow: `Source pressure ${formatPercent(state.intensity)}.`,
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
  const note = NOTE_KEYS.find((entry) => entry.code === event.code);
  if (note) {
    event.preventDefault();
    setDroneFrequency(note.frequency);
    return;
  }

});

$("audioButton").addEventListener("click", () => setAudioEnabled(!audioWanted));
$("singButton").addEventListener("click", () => setSinging(!singing));
$("gestureButton").addEventListener("click", () => toggleTrack("ornament"));
$("melodyButton").addEventListener("click", () => toggleTrack("melody"));
$("resetButton").addEventListener("click", () => {
  performanceElapsed();
  performanceSettings = sanitizePerformanceSettings({ ornamentPlaying: false, melodyPlaying: false });
  performanceSeconds = 0;
  ornamentCycles = 0;
  melodyCycles = 0;
  melodyGlideRateHz = performanceSettings.melodyRateHz;
  vibratoCycles = 0;
  pulseCycles = 0;
  breathCycles = 0;
  automaticBreathAtSeconds = -Infinity;
  manualBreathAtSeconds = -Infinity;
  trackCompleted.ornament = trackCompleted.melody = false;
  loadStyle("open-drone", { announceChange: false, preserveRuntime: false });
  setAudioPresentation(audioOn ? "on" : "off");
  announce("Throat Singer reset to the open discovery drone.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setSinging(false);
  }
});

globalThis.addEventListener("pagehide", () => {
  pageActive = false;
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  for (const widget of knobWidgets) widget.destroy();
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
installPatternControls();
installKnobs();
resizeCanvas();
updateReadouts();
setAudioPresentation("off");
animationFrame = requestAnimationFrame(draw);


presetController = registerHeaderPresets({
  id: "throat-singing",
  presets: THROAT_SINGER_PRESETS,
  capture: captureSingerPreset,
  apply: applySingerPreset,
  onApplied: () => { if (!singing) setSinging(true); },
  randomize: (_previous, random) => {
    const randomized = randomizeSingerPreset(random, state.level);
    const { level, active, ...parameters } = randomized.state;
    return { state: parameters, extras: randomized.extras, settings: randomized.settings };
  },
});
audioScheduler = setInterval(scheduleAudioPerformance, 20);
