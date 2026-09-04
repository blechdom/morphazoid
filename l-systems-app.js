import {
  VoicePool,
  clamp,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import { createAmplitudeControl } from "./src/amplitude-control.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  advanceLSystemTraversal,
  allocateIterationVoiceHeads,
  branchAngleFrequency,
  branchVoiceGain,
  iterationPlaybackAtPhase,
  iterationPlaybackPhaseRate,
  L_SYSTEM_PRESETS,
  lSystemTraversalBoundaryGain,
  normalizeLSystemPoint,
  traceLSystem,
} from "./src/l-system.js";
import {
  advanceLSystemDrumTraversal,
  groupedLSystemDrumEvents,
  L_SYSTEM_DRUM_MAPPING_MODES,
  L_SYSTEM_DRUM_STYLES,
  lSystemDrumEventsForTraversal,
  lSystemDrumSubdivisionCount,
  lSystemDrumTraversalStepSize,
  lSystemDrumVoiceIndex,
  mappedLSystemDrumVoice,
  styledLSystemDrumVoice,
} from "./src/l-system-drums.js";
import { micBranchPlaybackRate } from "./src/mic-branch-dsp.js";
import { MicBranchEngine } from "./src/mic-branch-engine.js";
import {
  lSystemPlayingModeFor,
} from "./src/l-systems-suite.js";

const TAU = Math.PI * 2;
const DEFAULT_SYNTH_STATE = Object.freeze({
  pitchSource: "angle",
  baseFrequency: 220,
  pitchRange: 2,
  depthAmount: 0.65,
  soundMode: "sine",
  modulationIndex: 3,
  stereoSpread: 0.9,
});
const DEFAULT_DRUM_STATE = Object.freeze({
  subdivisions: 4,
  mappingMode: "branch-depth-turn",
  percussionStyle: "drum-bank",
  pitchDepth: 12,
  anglePitchDepth: 12,
  angleRange: 90,
  characterDepth: 0.72,
});
const DEFAULT_MIC_STATE = Object.freeze({
  inputTrim: 1,
  feedback: 0.38,
  interval: 1,
  timeRatio: 1,
  pitchRange: 1.2,
  spread: 0.9,
  wet: 0.92,
});
const DEFAULT_MIX_STATE = Object.freeze({
  presetId: "balanced",
  continuous: 1,
  notes: 1,
  triggers: 0.95,
  mic: 1.12,
});
const DEFAULT_STATE = Object.freeze({
  mode: "continuous",
  presetId: "pythagorean",
  iterations: 7,
  angle: 45,
  turnAsymmetry: 0,
  lengthScale: 0.72,
  position: 0,
  speed: 0.3,
  direction: 1,
  traversalBehavior: "loop",
  structureMode: "final",
  playing: false,
  audio: false,
  level: 0.58,
});
const MODE_COPY = Object.freeze({
  continuous: Object.freeze({
    map: "ANGLE PITCH",
  }),
  notes: Object.freeze({
    map: "NOTE EVENTS",
  }),
  triggers: Object.freeze({
    map: "TRIGGER EVENTS",
  }),
  mic: Object.freeze({
    map: "MIC DELAY",
  }),
});
const MIX_PRESETS = Object.freeze([
  Object.freeze({
    id: "balanced",
    label: "Balanced app",
    description: "Continuous, Notes, Triggers, and Mic sit at matching perceived weight.",
    mix: Object.freeze({ continuous: 1, notes: 1, triggers: 0.95, mic: 1.12 }),
    mic: Object.freeze({ inputTrim: 1, feedback: 0.38, interval: 1, timeRatio: 1, pitchRange: 1.2, spread: 0.9, wet: 0.92 }),
    drums: Object.freeze({ subdivisions: 4, characterDepth: 0.72 }),
  }),
  Object.freeze({
    id: "soft-canopy",
    label: "Soft canopy",
    description: "Lower event gain and a wider mic smear for gentler branching.",
    mix: Object.freeze({ continuous: 0.82, notes: 0.72, triggers: 0.68, mic: 0.86 }),
    mic: Object.freeze({ inputTrim: 0.82, feedback: 0.28, interval: 1.6, timeRatio: 1.08, pitchRange: 0.8, spread: 0.72, wet: 0.72 }),
    drums: Object.freeze({ subdivisions: 3, characterDepth: 0.48 }),
  }),
  Object.freeze({
    id: "percussive-grid",
    label: "Percussive grid",
    description: "Tighter divisions with note and trigger events pushed forward.",
    mix: Object.freeze({ continuous: 0.9, notes: 1.16, triggers: 1.08, mic: 0.96 }),
    mic: Object.freeze({ inputTrim: 0.94, feedback: 0.24, interval: 0.62, timeRatio: 0.94, pitchRange: 1.35, spread: 1, wet: 0.78 }),
    drums: Object.freeze({ subdivisions: 8, characterDepth: 0.86 }),
  }),
  Object.freeze({
    id: "recursive-wet",
    label: "Recursive wet",
    description: "Mic and sustained branches are louder, with a denser delayed tail.",
    mix: Object.freeze({ continuous: 1.04, notes: 0.9, triggers: 0.8, mic: 1.25 }),
    mic: Object.freeze({ inputTrim: 1.06, feedback: 0.52, interval: 1.18, timeRatio: 1.12, pitchRange: 1.8, spread: 1, wet: 1 }),
    drums: Object.freeze({ subdivisions: 5, characterDepth: 0.64 }),
  }),
]);
const STRUCTURE_DESCRIPTIONS = Object.freeze({
  final: "Only the final rewritten structure is scanned.",
  sequence: "Each generation gets a turn in one shared transport loop.",
  accumulate: "Earlier generations stay visible while the active generation advances.",
  together: "Every generation is phase-locked to the same reader position.",
  canon: "Generations run as an offset round through one transport loop.",
});

const $ = (id) => document.getElementById(id);
const app = $("lSystemsApp");
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d");
const presetById = new Map(L_SYSTEM_PRESETS.map((preset) => [preset.id, preset]));
const mappingById = new Map(L_SYSTEM_DRUM_MAPPING_MODES.map((mode) => [mode.id, mode]));
const styleById = new Map(L_SYSTEM_DRUM_STYLES.map((style) => [style.id, style]));
const synthPool = new VoicePool(128, { adaptive: true, maxVoices: 4096 });
const drumAudio = new FmDrumAudio(globalThis);
const micEngine = new MicBranchEngine(128, { adaptive: true, maxVoices: 4096 });
const drumVoices = loadDrumBank();
const state = createDefaultState();
const rangeBindings = [];
let amplitudeControl = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastVoiceSubmissionTime = -Infinity;
let lastSoundingVoiceCount = 0;
let lastSubmittedVoiceLimit = -1;
let lastSubmittedSoundMode = "";
let activeEventKeys = new Set();
let hitCount = 0;
let iterationTraces = buildIterationTraces(currentPreset(), state.iterations, sharedTraceOverrides());
let drumTraversalStepSize = lSystemDrumTraversalStepSize(
  iterationTraces,
  state.drums.subdivisions,
  state.structureMode,
);

function createDefaultState() {
  return {
    ...DEFAULT_STATE,
    synth: { ...DEFAULT_SYNTH_STATE },
    drums: { ...DEFAULT_DRUM_STATE },
    mic: { ...DEFAULT_MIC_STATE },
    mix: { ...DEFAULT_MIX_STATE },
  };
}

function text(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function setSelected(element, selected) {
  element?.setAttribute("aria-selected", String(Boolean(selected)));
  if (element) element.tabIndex = selected ? 0 : -1;
}

function option(label, value = label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function fillSelect(id, items, labelFor = (item) => item.label, valueFor = (item) => item.id) {
  const select = $(id);
  if (!select) return;
  select.textContent = "";
  for (const item of items) select.append(option(labelFor(item), valueFor(item)));
}

function getPath(path) {
  return String(path).split(".").reduce((target, key) => target?.[key], state);
}

function setPath(path, value) {
  const parts = String(path).split(".");
  const key = parts.pop();
  const target = parts.reduce((cursor, part) => cursor[part], state);
  target[key] = value;
}

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDeg(value) {
  return `${Number(value).toFixed(1).replace(/\.0$/, "")} deg`;
}

function formatOct(value) {
  return `${Number(value).toFixed(1)} oct`;
}

function formatHz(value) {
  return `${Math.round(Number(value))} Hz`;
}

function formatRatio(value) {
  return `${Number(value).toFixed(2)}x`;
}

function formatTurnPair(value) {
  const amount = Math.round(Math.abs(Number(value) || 0) * 100);
  if (amount < 1) return "even";
  return Number(value) > 0 ? `left +${amount}%` : `right +${amount}%`;
}

function formatRules(rules = {}) {
  return Object.entries(rules)
    .map(([symbol, replacement]) => `${symbol} -> ${replacement}`)
    .join(" | ");
}

function buildIterationTraces(preset, iterations, overrides = {}) {
  const finalIteration = Math.max(0, Math.floor(iterations));
  const iterationNumbers = finalIteration > 0
    ? Array.from({ length: finalIteration }, (_value, index) => index + 1)
    : [0];
  return iterationNumbers.map((iteration) => ({
    ...traceLSystem({ ...preset, ...overrides, iterations: iteration }),
    iteration,
  }));
}

function currentPreset() {
  return presetById.get(state.presetId) ?? L_SYSTEM_PRESETS[0];
}

function sharedTraceOverrides() {
  return {
    angle: state.angle,
    lengthScale: state.lengthScale,
    turnAsymmetry: state.turnAsymmetry,
  };
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice, index) => sanitizeFmDrumVoice({
      ...voice,
      ...stored[index],
      id: voice.id,
      key: voice.key,
      name: voice.name,
      family: voice.family,
      color: voice.color,
    }));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function refreshDrumTraversalStepSize() {
  drumTraversalStepSize = lSystemDrumTraversalStepSize(
    iterationTraces,
    state.drums.subdivisions,
    state.structureMode,
  );
}

function resetVoiceSubmission() {
  lastVoiceSubmissionTime = -Infinity;
  lastSoundingVoiceCount = 0;
  lastSubmittedVoiceLimit = -1;
  lastSubmittedSoundMode = "";
}

function voiceSubmissionInterval(voiceLimit) {
  if (voiceLimit > 1024) return 1 / 20;
  if (voiceLimit > 256) return 1 / 30;
  return 0;
}

function bindRange(id, path, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const binding = {
    input,
    path,
    paint() {
      const value = getPath(path);
      if (input && input.value !== String(value)) input.value = String(value);
      if (output) output.textContent = formatter(value);
    },
  };
  rangeBindings.push(binding);
  binding.paint();
  input?.addEventListener("input", () => {
    const nextValue = Number(input.value);
    setPath(path, nextValue);
    afterChange?.(nextValue);
    binding.paint();
    paintReadoutOnly();
    scheduleFrame();
  });
}

function syncRangeBindings() {
  for (const binding of rangeBindings) binding.paint();
}

function bindSelect(id, path, afterChange) {
  const select = $(id);
  if (!select) return;
  select.value = String(getPath(path));
  select.addEventListener("change", () => {
    setPath(path, select.value);
    afterChange?.(select.value);
    paintReadoutOnly();
    scheduleFrame();
  });
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
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

function setupResizeObserver() {
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resizeCanvas).observe(stageWrap);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
  resizeCanvas();
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  text("audioError", message);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function showSystemError(error) {
  const message = error instanceof Error ? error.message : String(error);
  text("systemError", message);
  $("systemError").hidden = false;
}

function clearSystemError() {
  $("systemError").hidden = true;
  $("systemError").textContent = "";
}

function setAudioUi(enabled) {
  state.audio = Boolean(enabled);
  setPressed($("audioButton"), state.audio);
  $("audioButton").dataset.audioState = state.audio ? "on" : "off";
  text("audioState", state.audio ? state.mode : "off");
  text("liveStatus", state.audio ? `${activeMode().title} audio on` : "Audio off");
  applyGlobalLevel();
  paintReadoutOnly();
}

function modeGain(modeId = state.mode) {
  return clamp(state.mix?.[modeId] ?? 1, 0, 1.5);
}

function activeAudioKind(modeId = state.mode) {
  return lSystemPlayingModeFor(modeId).audioKind;
}

function applyGlobalLevel() {
  text("levelOut", formatPercent(state.level));
  const synthMode = activeAudioKind() === "synth";
  synthPool.setLevel(clamp(state.level * (synthMode ? modeGain() : 0), 0, 1));
  drumAudio.setOutput(clamp(state.level * modeGain("triggers") * 0.9, 0, 0.9));
  drumAudio.setHostGain(state.audio && state.mode === "triggers" ? 1 : 0, 45);
  micEngine.setLevel(state.audio && state.mode === "mic"
    ? clamp(state.level * state.mic.inputTrim * modeGain("mic"), 0, 1)
    : 0);
}

function silenceAudioRoutes(rampMilliseconds = 45) {
  synthPool.setHostGain(0, rampMilliseconds);
  synthPool.silence();
  drumAudio.setHostGain(0, rampMilliseconds);
  micEngine.setLevel(0);
  micEngine.silence();
}

async function prepareActiveAudio() {
  if (!state.audio) return false;
  clearError();
  // Mute the outgoing route before an engine start or microphone permission
  // prompt can suspend this handoff.
  silenceAudioRoutes();
  if (activeAudioKind() === "synth") {
    await synthPool.enable();
    synthPool.setLevel(clamp(state.level * modeGain(), 0, 1));
    synthPool.setHostGain(1, 45);
    if (state.mode === "notes") synthPool.silence();
    return true;
  }
  if (state.mode === "triggers") {
    await drumAudio.start();
    drumAudio.setOutput(clamp(state.level * modeGain("triggers") * 0.9, 0, 0.9));
    drumAudio.setHostGain(1, 45);
    return true;
  }
  await micEngine.enable();
  micEngine.setFeedback(state.mic.feedback);
  micEngine.setLevel(clamp(state.level * state.mic.inputTrim * modeGain("mic"), 0, 1));
  return true;
}

async function enableAudio() {
  setAudioUi(true);
  try {
    await prepareActiveAudio();
    scheduleFrame();
  } catch (error) {
    showError(error);
    setAudioUi(false);
  }
}

async function disableAudio() {
  setAudioUi(false);
  synthPool.silence();
  synthPool.disable();
  drumAudio.setHostGain(0, 0);
  await drumAudio.close();
  micEngine.disable();
  resetVoiceSubmission();
  activeEventKeys = new Set();
  scheduleFrame();
}

function activeMode() {
  return lSystemPlayingModeFor(state.mode);
}

async function setMode(modeId) {
  const requestedMode = lSystemPlayingModeFor(modeId);
  const nextMode = requestedMode.id;
  if (nextMode === state.mode) return;
  const previousMode = state.mode;
  state.mode = nextMode;
  activeEventKeys = new Set();
  resetVoiceSubmission();
  paintMode();
  paintReadoutOnly();
  if (state.audio) {
    try {
      await prepareActiveAudio();
      text("liveStatus", `${activeMode().title} selected; audio still on`);
    } catch (error) {
      state.mode = previousMode;
      activeEventKeys = new Set();
      resetVoiceSubmission();
      paintMode();
      paintReadoutOnly();
      let restored = false;
      try {
        restored = await prepareActiveAudio();
      } catch {
        setAudioUi(false);
        silenceAudioRoutes(0);
      }
      showError(error);
      text("liveStatus", restored
        ? `${requestedMode.title} unavailable; ${activeMode().title} restored`
        : `${requestedMode.title} unavailable; audio off`);
    }
  } else {
    text("liveStatus", `${activeMode().title} selected`);
  }
  scheduleFrame();
}

function rebuildTrace() {
  activeEventKeys = new Set();
  resetVoiceSubmission();
  try {
    iterationTraces = buildIterationTraces(
      currentPreset(),
      state.iterations,
      sharedTraceOverrides(),
    );
    clearSystemError();
  } catch (error) {
    showSystemError(error);
  }
  refreshDrumTraversalStepSize();
  paintPreset();
  paintReadoutOnly();
  scheduleFrame();
}

function resetSystem() {
  const defaults = createDefaultState();
  state.presetId = defaults.presetId;
  state.iterations = defaults.iterations;
  state.angle = defaults.angle;
  state.turnAsymmetry = defaults.turnAsymmetry;
  state.lengthScale = defaults.lengthScale;
  state.position = defaults.position;
  state.direction = defaults.direction;
  state.traversalBehavior = defaults.traversalBehavior;
  state.structureMode = defaults.structureMode;
  updateIterationLimit();
  syncRangeBindings();
  syncSelects();
  rebuildTrace();
}

async function resetAll() {
  const next = createDefaultState();
  const audioWasOn = state.audio;
  Object.assign(state, next);
  state.synth = { ...next.synth };
  state.drums = { ...next.drums };
  state.mic = { ...next.mic };
  state.mix = { ...next.mix };
  hitCount = 0;
  updateIterationLimit();
  syncRangeBindings();
  syncSelects();
  amplitudeControl?.reset();
  rebuildTrace();
  renderDrumMap();
  paintMode();
  setAudioUi(audioWasOn);
  if (audioWasOn) await prepareActiveAudio().catch(showError);
  scheduleFrame();
}

function currentMixPreset() {
  return MIX_PRESETS.find((preset) => preset.id === state.mix.presetId) ?? MIX_PRESETS[0];
}

function applyMixPreset(presetId = state.mix.presetId) {
  const preset = MIX_PRESETS.find((candidate) => candidate.id === presetId) ?? MIX_PRESETS[0];
  state.mix.presetId = preset.id;
  Object.assign(state.mix, preset.mix);
  Object.assign(state.mic, preset.mic);
  Object.assign(state.drums, preset.drums);
  syncRangeBindings();
  syncSelects();
  refreshDrumTraversalStepSize();
  applyGlobalLevel();
  paintMix();
  paintMapping();
  renderDrumMap();
  scheduleFrame();
}

function applyPresetDefaults() {
  const preset = currentPreset();
  state.iterations = Math.min(
    preset.maxIterations ?? preset.iterations ?? state.iterations,
    preset.iterations ?? state.iterations,
  );
  state.angle = Number.isFinite(Number(preset.angle)) ? Number(preset.angle) : state.angle;
  state.lengthScale = Number.isFinite(Number(preset.lengthScale))
    ? Number(preset.lengthScale)
    : state.lengthScale;
  state.turnAsymmetry = 0;
  syncRangeBindings();
  updateIterationLimit();
  rebuildTrace();
}

function updateIterationLimit() {
  const preset = currentPreset();
  const input = $("iterations");
  if (!input) return;
  input.max = String(preset.maxIterations ?? Math.max(1, preset.iterations ?? state.iterations));
  if (state.iterations > Number(input.max)) {
    state.iterations = Number(input.max);
    syncRangeBindings();
  }
}

function syncSelects() {
  $("preset").value = state.presetId;
  $("structureMode").value = state.structureMode;
  $("mixPreset").value = state.mix.presetId;
  $("pitchSource").value = state.synth.pitchSource;
  $("soundMode").value = state.synth.soundMode;
  $("mappingMode").value = state.drums.mappingMode;
  $("percussionStyle").value = state.drums.percussionStyle;
}

function paintMode() {
  const mode = activeMode();
  app.dataset.playingMode = mode.id;
  text("currentModeReadout", mode.label);
  text("audioState", state.audio ? state.mode : "off");
  for (const button of $("playingMode").querySelectorAll("[data-playing-mode]")) {
    setSelected(button, button.dataset.playingMode === mode.id);
  }
  for (const bank of document.querySelectorAll("[data-mode-bank]")) {
    const selected = bank.dataset.modeBank === mode.id
      || (bank.dataset.modeBank === "synth" && ["continuous", "notes"].includes(mode.id));
    bank.hidden = !selected;
    bank.classList.toggle("is-active", selected);
  }
  $("synthBank").setAttribute("aria-labelledby", state.mode === "notes" ? "modeNotes" : "modeContinuous");
  text("synthBankTitle", state.mode === "notes" ? "Notes" : "Continuous");
}

function paintPreset() {
  const preset = currentPreset();
  text("axiomReadout", preset.axiom);
  text("rulesReadout", formatRules(preset.rules));
  const asymmetry = Math.round(Math.abs(state.turnAsymmetry) * 100);
  text("turnAsymmetryNote", asymmetry
    ? `${state.turnAsymmetry > 0 ? "Left" : "Right"} turns are ${asymmetry}% wider.`
    : "Left and right turns are balanced.");
  text("taperNote", state.lengthScale < 1
    ? `Each > symbol shortens following branches to ${Math.round(state.lengthScale * 100)}%.`
    : state.lengthScale > 1
      ? `Each > symbol lengthens following branches to ${Math.round(state.lengthScale * 100)}%.`
      : "Branch length stays constant unless the grammar changes direction.");
}

function paintMix() {
  const preset = currentMixPreset();
  text("mixDescription", preset.description);
}

function paintStructure(playback = iterationPlaybackAtPhase(
  iterationTraces,
  drawableTraversalPhase(state.position),
  state.structureMode,
)) {
  const finalIteration = iterationTraces.at(-1)?.iteration ?? 0;
  const entry = playback.entries[0];
  const localPhase = entry?.localPhase ?? state.position;
  const label = state.structureMode === "sequence"
    ? `I${playback.activeIteration}/${finalIteration}`
    : state.structureMode === "together"
      ? `${iterationTraces.length} iterations together`
      : state.structureMode === "accumulate"
        ? `accumulate to I${playback.activeIteration}`
        : state.structureMode === "canon"
          ? `${iterationTraces.length} iteration canon`
          : `final I${finalIteration}`;
  text("structureReadout", label.toUpperCase());
  text("structureDescription", STRUCTURE_DESCRIPTIONS[state.structureMode] ?? STRUCTURE_DESCRIPTIONS.final);
  text("positionOut", state.structureMode === "sequence"
    ? `I${playback.activeIteration} - ${(localPhase * 100).toFixed(1)}%`
    : state.structureMode === "accumulate"
      ? `to I${playback.activeIteration} - ${(localPhase * 100).toFixed(1)}%`
      : state.structureMode === "together"
        ? `sync - ${(state.position * 100).toFixed(1)}%`
        : state.structureMode === "canon"
          ? `round - ${(state.position * 100).toFixed(1)}%`
          : `${(state.position * 100).toFixed(1)}%`);
}

function paintMotion() {
  const playButton = $("playButton");
  const playLabel = state.playing ? "Pause" : "Play";
  setPressed(playButton, state.playing);
  text("playButtonLabel", playLabel);
  playButton.setAttribute("aria-label", `${playLabel} traversal`);
  playButton.title = playLabel;
  for (const button of $("playheadMotion").querySelectorAll("[data-motion]")) {
    setPressed(button, button.dataset.motion === state.traversalBehavior);
  }
  const directionButton = $("traversalDirection");
  const directionLabel = state.direction > 0 ? "forward" : "reverse";
  directionButton.dataset.direction = directionLabel;
  directionButton.setAttribute("aria-label", `Traversal direction: ${directionLabel}`);
  directionButton.title = `Direction: ${directionLabel}`;
  text("traversalDirectionText", directionLabel);
  text("currentTraversalReadout", `${state.traversalBehavior === "ping-pong" ? "Ping-pong" : "Loop"} ${directionLabel}`);
}

function paintMapping() {
  const mapping = mappingById.get(state.drums.mappingMode) ?? L_SYSTEM_DRUM_MAPPING_MODES[0];
  const style = styleById.get(state.drums.percussionStyle) ?? L_SYSTEM_DRUM_STYLES[0];
  text("mappingDescription", mapping.description);
  mapping.legend.forEach((entry, index) => {
    text(`mappingLegendLabel${index}`, entry.label);
    text(`mappingLegendDetail${index}`, entry.detail);
  });
  $("drumMap").dataset.mappingMode = mapping.id;
  $("drumMap").dataset.percussionStyle = style.id;
}

function paintSynthReadouts(requestedVoices = 0, soundingVoices = 0) {
  const status = synthPool.polyphonyStatus;
  const load = Number.isFinite(status.averageLoad)
    ? ` - DSP ${Math.round(status.averageLoad * 100)}%`
    : "";
  const count = requestedVoices > status.limit
    ? `${status.limit} / ${requestedVoices}`
    : `${Math.max(soundingVoices, status.limit)} ready`;
  const label = status.status === "fallback"
    ? "SAFE CAP"
    : status.status === "probing"
      ? "AUTO TEST"
      : status.status === "capped"
        ? "AUTO CAP"
        : status.status === "warming"
          ? "AUTO CHECK"
          : "AUTO";
  text("polyphonyReadout", state.mode === "notes"
    ? `NOTES - ${requestedVoices} events`
    : `${label} - ${count}${load}`);
  text("polyphonyDescription", state.mode === "notes"
    ? `Note mode uses ${state.drums.subdivisions} branch subdivisions through the ${state.synth.soundMode.toUpperCase()} engine.`
    : status.status === "fallback"
    ? "Playback is using the proven 128-voice fallback."
    : status.status === "capped" && requestedVoices > status.limit
      ? `Playback is holding at ${status.limit} voices; extra branches remain visual.`
      : `The synth renderer is ready for ${status.limit} ${state.synth.soundMode.toUpperCase()} voices.`);
}

function paintMicReadouts(requestedVoices = 0, soundingVoices = 0) {
  const status = micEngine.polyphonyStatus;
  const count = requestedVoices > status.limit
    ? `${status.limit} / ${requestedVoices}`
    : `${Math.max(soundingVoices, status.limit)} ready`;
  text("micVoiceReadout", state.audio && state.mode === "mic"
    ? `MIC ${state.playing ? "LIVE" : "ON"} - ${count}`
    : "MIC IDLE");
  text("micDescription", state.audio && state.mode === "mic"
    ? "Microphone input remains connected while this mode is selected."
    : "The live microphone is distributed through the active branch heads.");
}

function paintReadoutOnly(playback = iterationPlaybackAtPhase(
  iterationTraces,
  drawableTraversalPhase(state.position),
  state.structureMode,
), playheads = playbackHeads(playback)) {
  const copy = MODE_COPY[state.mode];
  const finalIteration = iterationTraces.at(-1)?.iteration ?? 0;
  text("stageReadout", [
    `I${finalIteration}`,
    `${playheads.length} heads`,
    state.playing ? "playing" : "paused",
    state.audio ? `audio ${state.mode}` : "audio off",
  ].join(" - "));
  text("mappingReadout", `${copy.map} - ${state.structureMode.toUpperCase()}`);
  text("currentSettingsSummary", `I${state.iterations}, ${formatDeg(state.angle)}, ${formatPercent(state.lengthScale)}`);
  paintMode();
  paintPreset();
  paintMix();
  paintStructure(playback);
  paintMotion();
  paintMapping();
}

function playbackHeads(playback) {
  return playback.entries.flatMap((entry) => entry.snapshot.heads.map((head) => ({
    ...head,
    iteration: entry.iteration,
    localPhase: entry.localPhase,
    sourceTrace: entry.trace,
    snapshotDistance: entry.snapshot.distance,
  })));
}

function playbackBounds(entries) {
  return entries.reduce((bounds, entry) => ({
    minX: Math.min(bounds.minX, entry.trace.bounds.minX),
    maxX: Math.max(bounds.maxX, entry.trace.bounds.maxX),
    minY: Math.min(bounds.minY, entry.trace.bounds.minY),
    maxY: Math.max(bounds.maxY, entry.trace.bounds.maxY),
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
}

function drawingTransform(bounds) {
  const margin = Math.max(22, Math.min(cssWidth, cssHeight) * 0.075);
  const dataWidth = Math.max(1e-9, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(1e-9, bounds.maxY - bounds.minY);
  const scale = Math.min(
    Math.max(1, cssWidth - margin * 2) / dataWidth,
    Math.max(1, cssHeight - margin * 2) / dataHeight,
  );
  const drawnWidth = dataWidth * scale;
  const drawnHeight = dataHeight * scale;
  return {
    scale,
    x: (point) => (cssWidth - drawnWidth) * 0.5 + (point.x - bounds.minX) * scale,
    y: (point) => (cssHeight + drawnHeight) * 0.5 - (point.y - bounds.minY) * scale,
  };
}

function drawSegment(segment, transform, strokeStyle, lineWidth = 1) {
  context.beginPath();
  context.moveTo(transform.x(segment.start), transform.y(segment.start));
  context.lineTo(transform.x(segment.end), transform.y(segment.end));
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawScene(playback, playheads) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = drawingTransform(playbackBounds(playback.entries));
  const layered = playback.entries.length > 1;
  const baseHue = state.mode === "triggers"
    ? 34
    : state.mode === "mic"
      ? 214
      : state.mode === "notes"
        ? 74
        : 164;
  playback.entries.forEach((entry, entryIndex) => {
    const sourceDepth = Math.max(1, entry.trace.maxForkDepth);
    const iterationHue = baseHue + entryIndex * 96 / Math.max(1, playback.entries.length - 1);
    entry.trace.segments.forEach((segment) => {
      const depth = segment.forkDepth / sourceDepth;
      const completed = segment.endDistance <= entry.snapshot.distance;
      drawSegment(
        segment,
        transform,
        completed
          ? `hsla(${iterationHue + depth * 42}, 82%, 66%, ${layered ? 0.27 : 0.66 + depth * 0.14})`
          : `rgba(215, 230, 224, ${layered ? 0.035 : 0.09 + depth * 0.11})`,
        layered ? Math.max(0.45, 0.9 - depth * 0.25) : Math.max(0.65, 1.4 - depth * 0.55),
      );
    });
  });

  const headRadius = Math.max(1.5, 5.2 - Math.log2(Math.max(1, playheads.length)) * 0.43);
  for (const playhead of playheads) {
    const depth = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
    drawSegment(
      { start: playhead.segment.start, end: playhead },
      transform,
      `hsla(${baseHue + 18 + depth * 75}, 92%, 72%, .95)`,
      Math.max(1, 2.3 - depth * 0.45),
    );
    const x = transform.x(playhead);
    const y = transform.y(playhead);
    context.save();
    context.shadowColor = state.mode === "triggers"
      ? "#ffb86b"
      : state.mode === "mic"
        ? "#7db4ff"
        : state.mode === "notes"
          ? "#d7ef7f"
          : "#5fe8c4";
    context.shadowBlur = playheads.length <= 32 ? 18 : 8;
    context.beginPath();
    context.arc(x, y, headRadius, 0, TAU);
    context.fillStyle = "#fff7df";
    context.fill();
    context.restore();
  }
}

function synthPitchValue(playhead, normalized) {
  if (state.synth.pitchSource === "angle") return null;
  if (state.synth.pitchSource === "depth") {
    return playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
  }
  if (state.synth.pitchSource === "progress") return playhead.localPhase;
  return normalized.y;
}

function synthVoiceForPlayhead(playhead, activePower, combinedGain) {
  const normalized = normalizeLSystemPoint(playhead, playhead.sourceTrace.bounds);
  const depth = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
  const drive = clamp(depth * state.synth.depthAmount, 0, 1);
  const mappedPitch = synthPitchValue(playhead, normalized);
  const frequency = state.synth.pitchSource === "angle"
    ? branchAngleFrequency(playhead.cumulativeTurn, state.synth.baseFrequency, state.synth.pitchRange)
    : pitch01ToFrequency(mappedPitch, state.synth.baseFrequency, state.synth.pitchRange);
  const topologyBoundaryBehavior = (
    state.traversalBehavior === "ping-pong"
    && ["final", "together"].includes(state.structureMode)
  ) ? "ping-pong" : "loop";
  return {
    key: `l-system-suite:synth:${playhead.voiceKey}`,
    frequency,
    gain: branchVoiceGain(playhead.powerShare, activePower, combinedGain)
      * amplitudeControl.sample(playhead.progress ?? 0, 1)
      * lSystemTraversalBoundaryGain(playhead.localPhase, topologyBoundaryBehavior),
    pan: clamp((normalized.x * 2 - 1) * state.synth.stereoSpread, -1, 1),
    waveform: "sine",
    gainSmoothingSeconds: 0.018,
    ...synthParametersForMode(state.synth.soundMode, drive, {
      fmIndex: state.synth.modulationIndex,
      fmRatio: 1.5,
      pmIndex: state.synth.modulationIndex,
      pmRatio: 1.5,
      shepardRate: state.playing ? state.speed * state.direction : 0,
      shepardWidth: 5,
      shepardPosition: playhead.localPhase,
    }),
  };
}

function synthVoicesForPlayheads(playheads, maxVoices = synthPool.voiceLimitFor(state.synth.soundMode)) {
  const selected = allocateIterationVoiceHeads(playheads, maxVoices);
  const groups = new Map();
  for (const playhead of selected) {
    const group = groups.get(playhead.iteration) ?? [];
    group.push(playhead);
    groups.set(playhead.iteration, group);
  }
  const layerGain = 0.38 / Math.sqrt(Math.max(1, groups.size));
  return [...groups.values()].flatMap((heads) => {
    const activePower = heads.reduce((sum, playhead) => sum + playhead.powerShare, 0);
    return heads.map((playhead) => synthVoiceForPlayhead(playhead, activePower, layerGain));
  });
}

function eventIntervalSeconds(eventCount = 1) {
  const speed = Math.max(0.015, Math.abs(Number(state.speed) || 0));
  const subdivisions = lSystemDrumSubdivisionCount(state.drums.subdivisions);
  const density = Math.max(1, subdivisions * Math.sqrt(Math.max(1, Number(eventCount) || 1)));
  return clamp(1 / (speed * density), 0.028, 1.2);
}

function micVoiceForPlayhead(playhead, activePower, combinedGain, eventCount = 1) {
  const normalized = normalizeLSystemPoint(playhead, playhead.sourceTrace.bounds);
  const depth01 = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
  const pitchValue = state.synth.pitchSource === "angle"
    ? playhead.cumulativeTurn / TAU
    : state.synth.pitchSource === "progress"
      ? playhead.localPhase - 0.5
      : state.synth.pitchSource === "depth"
        ? depth01 - 0.5
        : normalized.y - 0.5;
  const depthRatio = 1 + (state.mic.timeRatio - 1) * depth01;
  const delaySeconds = clamp(
    eventIntervalSeconds(eventCount) * state.mic.interval * depthRatio * (0.82 + (playhead.progress ?? 0) * 0.36),
    0.00002,
    20,
  );
  const topologyBoundaryBehavior = (
    state.traversalBehavior === "ping-pong"
    && ["final", "together"].includes(state.structureMode)
  ) ? "ping-pong" : "loop";
  return {
    key: `l-system-suite:mic:${playhead.voiceKey}`,
    rate: micBranchPlaybackRate(pitchValue, state.mic.pitchRange, 1),
    gain: branchVoiceGain(playhead.powerShare, activePower, combinedGain)
      * lSystemTraversalBoundaryGain(playhead.localPhase, topologyBoundaryBehavior),
    pan: clamp((normalized.x * 2 - 1) * state.mic.spread, -1, 1),
    depth: playhead.depth,
    delay: delaySeconds,
    sourceKey: "base",
    bounceKey: null,
  };
}

function micVoicesForPlayheads(playheads, maxVoices = micEngine.voiceLimit) {
  const selected = allocateIterationVoiceHeads(playheads, maxVoices);
  const groups = new Map();
  for (const playhead of selected) {
    const group = groups.get(playhead.iteration) ?? [];
    group.push(playhead);
    groups.set(playhead.iteration, group);
  }
  const layerGain = state.mic.wet * modeGain("mic") * 0.58 / Math.sqrt(Math.max(1, groups.size));
  return [...groups.values()].flatMap((heads) => {
    const activePower = heads.reduce((sum, playhead) => sum + playhead.powerShare, 0);
    return heads.map((playhead) => micVoiceForPlayhead(playhead, activePower, layerGain, playheads.length));
  });
}

function updateSynthAudio(playheads, phaseRate, now) {
  const lookahead = 0.065;
  const futurePhase = advanceLSystemTraversal(
    state.position,
    state.direction,
    phaseRate * lookahead,
    state.traversalBehavior,
  ).position;
  const futurePlayback = iterationPlaybackAtPhase(
    iterationTraces,
    drawableTraversalPhase(futurePhase),
    state.structureMode,
  );
  const futureHeads = playbackHeads(futurePlayback);
  const requestedVoices = Math.max(playheads.length, futureHeads.length);
  const voiceLimit = synthPool.setVoiceDemand(requestedVoices, state.synth.soundMode);
  const controlTime = now / 1000;
  const shouldSubmitVoices = voiceLimit !== lastSubmittedVoiceLimit
    || state.synth.soundMode !== lastSubmittedSoundMode
    || requestedVoices === 0
    || controlTime - lastVoiceSubmissionTime >= voiceSubmissionInterval(voiceLimit);
  if (shouldSubmitVoices) {
    const voices = synthVoicesForPlayheads(playheads, voiceLimit);
    synthPool.setVoiceTrajectory(
      voices,
      synthVoicesForPlayheads(futureHeads, voiceLimit),
      lookahead,
      {
        requestedVoiceCount: requestedVoices,
        mode: state.synth.soundMode,
        voiceLimit,
        releaseVoiceAllowance: Math.min(256, voiceLimit),
      },
    );
    lastVoiceSubmissionTime = controlTime;
    lastSoundingVoiceCount = voices.length;
    lastSubmittedVoiceLimit = voiceLimit;
    lastSubmittedSoundMode = state.synth.soundMode;
  }
  paintSynthReadouts(requestedVoices, lastSoundingVoiceCount);
}

function notePitchValue(event) {
  if (state.synth.pitchSource === "angle") return null;
  if (state.synth.pitchSource === "depth") {
    return (Number(event.depth) || 0) / Math.max(1, Number(event.maxForkDepth) || 1);
  }
  if (state.synth.pitchSource === "progress") return Number(event.progress) || 0;
  return Number(event.normalizedY) || 0;
}

function noteVoiceForEvent(event, eventCount) {
  const depth = (Number(event.depth) || 0) / Math.max(1, Number(event.maxForkDepth) || 1);
  const drive = clamp(depth * state.synth.depthAmount, 0, 1);
  const mappedPitch = notePitchValue(event);
  const frequency = state.synth.pitchSource === "angle"
    ? branchAngleFrequency(event.cumulativeTurn, state.synth.baseFrequency, state.synth.pitchRange)
    : pitch01ToFrequency(mappedPitch, state.synth.baseFrequency, state.synth.pitchRange);
  const headroom = 1 / Math.sqrt(Math.max(1, Number(eventCount) || 1));
  const boundary = lSystemTraversalBoundaryGain(
    clamp((Number(event.subdivisionIndex) || 0) / Math.max(1, Number(event.subdivisions) || 1), 0, 1),
    state.traversalBehavior,
  );
  return {
    key: `l-system-suite:note:${event.key}`,
    frequency,
    gain: clamp((0.16 + drive * 0.16 + Math.sqrt(event.powerShare || 0) * 0.18) * headroom * boundary, 0.001, 0.56),
    pan: clamp(((Number(event.normalizedX) || 0.5) * 2 - 1) * state.synth.stereoSpread, -1, 1),
    waveform: state.synth.soundMode === "pm" ? "sawtooth" : state.synth.soundMode === "fm" ? "triangle" : "sine",
    gainSmoothingSeconds: 0.006,
    ...synthParametersForMode(state.synth.soundMode, drive, {
      fmIndex: state.synth.modulationIndex,
      fmRatio: 1.5,
      pmIndex: state.synth.modulationIndex,
      pmRatio: 1.5,
      shepardRate: state.speed * state.direction,
      shepardWidth: 4,
      shepardPosition: Number(event.progress) || 0,
    }),
  };
}

function noteDurationSeconds(eventCount) {
  const eventSeconds = eventIntervalSeconds(eventCount);
  return clamp(eventSeconds * (0.58 + state.synth.depthAmount * 0.18), 0.035, 0.7);
}

function triggerNoteEvent(event, eventCount) {
  const voice = noteVoiceForEvent(event, eventCount);
  const fired = synthPool.strike(voice, {
    attackSeconds: 0.004,
    decaySeconds: noteDurationSeconds(eventCount),
    attackNoise: state.synth.soundMode === "fm" ? 0.06 : 0,
    retriggerMode: "crossfade",
  });
  if (!fired) return;
  text("mappingReadout", [
    `I${event.iteration}`,
    `SEG ${event.segmentIndex}`,
    `SUB ${event.subdivisionIndex + 1}/${event.subdivisions}`,
    `NOTE ${Math.round(voice.frequency)}HZ`,
  ].join(" - "));
}

function triggerNoteEvents(events, maxEvents) {
  const grouped = groupedLSystemDrumEvents(events, {
    mode: state.drums.mappingMode,
    maxEvents,
  });
  for (const { event, eventCount } of grouped) triggerNoteEvent(event, eventCount);
  paintSynthReadouts(events.length, Math.min(events.length, maxEvents));
}

function updateMicAudio(playheads) {
  const requestedVoices = playheads.length;
  const voiceLimit = micEngine.setVoiceDemand(requestedVoices);
  const voices = micVoicesForPlayheads(playheads, voiceLimit);
  micEngine.setFeedback(state.mic.feedback);
  micEngine.setVoices(voices, { requestedVoiceCount: requestedVoices });
  paintMicReadouts(requestedVoices, voices.length);
}

function triggerEvent(event, eventCount, voiceIndex = lSystemDrumVoiceIndex(
  event,
  { mode: state.drums.mappingMode },
)) {
  const mappedVoice = mappedLSystemDrumVoice(drumVoices[voiceIndex], event, {
    pitchDepth: state.drums.pitchDepth,
    anglePitchDepth: state.drums.anglePitchDepth,
    angleRange: state.drums.angleRange,
    characterDepth: state.drums.characterDepth,
    eventCount,
  });
  const voice = styledLSystemDrumVoice(mappedVoice, { style: state.drums.percussionStyle });
  hitCount += 1;
  text("mappingReadout", [
    `I${event.iteration}`,
    `SEG ${event.segmentIndex}`,
    `SUB ${event.subdivisionIndex + 1}/${event.subdivisions}`,
    `-> ${voice.name}`,
    `HITS ${hitCount}`,
  ].join(" - "));
  drumAudio.trigger(voice).catch(showError);
  flashVoice(voiceIndex);
}

function triggerEvents(events, maxEvents) {
  const grouped = groupedLSystemDrumEvents(events, {
    mode: state.drums.mappingMode,
    maxEvents,
  });
  for (const { event, eventCount, voiceIndex } of grouped) {
    triggerEvent(event, eventCount, voiceIndex);
  }
}

function renderDrumMap() {
  const map = $("drumMap");
  map.innerHTML = drumVoices.map((voice, index) => {
    const styledVoice = styledLSystemDrumVoice(voice, { style: state.drums.percussionStyle });
    return `<button class="l-system-drum-cell" type="button" data-voice-index="${index}" data-voice-id="${escapeHtml(voice.id)}" style="--voice-color: ${escapeHtml(voice.color)}">`
      + `<b>${escapeHtml(styledVoice.name)}</b><small>${escapeHtml(voice.key.toUpperCase())} - ${escapeHtml(styledVoice.family)}</small>`
      + "</button>";
  }).join("");
  for (const button of map.querySelectorAll(".l-system-drum-cell")) {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.voiceIndex) || 0;
      try {
        if (!state.audio) await enableAudio();
        else if (state.mode === "triggers") await prepareActiveAudio();
        const voice = styledLSystemDrumVoice(
          drumVoices[index],
          { style: state.drums.percussionStyle },
        );
        await drumAudio.trigger(voice);
        flashVoice(index);
      } catch (error) {
        showError(error);
      }
    });
  }
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  setTimeout(() => cell.classList.remove("is-active"), 180);
}

function drawableTraversalPhase(position) {
  return state.traversalBehavior === "ping-pong" && position >= 1
    ? 1 - 1e-9
    : position;
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  const phaseRate = iterationPlaybackPhaseRate(
    state.structureMode,
    iterationTraces.length,
    state.speed,
  );

  if (state.playing) {
    let advanced;
    if (state.audio && ["notes", "triggers"].includes(state.mode)) {
      advanced = advanceLSystemDrumTraversal(
        state.position,
        state.direction,
        phaseRate * delta,
        {
          behavior: state.traversalBehavior,
          maxPhaseStep: drumTraversalStepSize,
        },
      );
      const sweptEvents = lSystemDrumEventsForTraversal(
        iterationTraces,
        advanced.samples,
        {
          structureMode: state.structureMode,
          subdivisions: state.drums.subdivisions,
          activeEventKeys,
        },
      );
      activeEventKeys = sweptEvents.activeEventKeys;
      if (sweptEvents.events.length) {
        if (state.mode === "notes") triggerNoteEvents(sweptEvents.events, 40);
        else triggerEvents(sweptEvents.events, 48);
      }
    } else {
      advanced = advanceLSystemTraversal(
        state.position,
        state.direction,
        phaseRate * delta,
        state.traversalBehavior,
      );
    }
    state.position = advanced.position;
    if (advanced.direction !== state.direction) state.direction = advanced.direction;
  }

  const playback = iterationPlaybackAtPhase(
    iterationTraces,
    drawableTraversalPhase(state.position),
    state.structureMode,
  );
  const playheads = playbackHeads(playback);
  drawScene(playback, playheads);

  if (state.audio && state.playing && state.mode === "continuous") {
    updateSynthAudio(playheads, phaseRate, now);
  } else if (state.audio && state.playing && state.mode === "notes") {
    synthPool.setVoices([], { mode: state.synth.soundMode });
    paintMicReadouts(0, 0);
    resetVoiceSubmission();
  } else if (state.audio && state.playing && state.mode === "mic") {
    updateMicAudio(playheads);
    resetVoiceSubmission();
    paintSynthReadouts(0, 0);
  } else if (state.audio && state.playing && state.mode === "triggers") {
    paintSynthReadouts(0, 0);
    paintMicReadouts(0, 0);
    resetVoiceSubmission();
  } else if (state.audio) {
    if (["continuous", "notes"].includes(state.mode)) synthPool.setVoices([], { mode: state.synth.soundMode });
    if (state.mode === "mic") micEngine.silence();
    activeEventKeys = new Set();
    resetVoiceSubmission();
    paintSynthReadouts(0, 0);
    paintMicReadouts(0, 0);
  } else {
    resetVoiceSubmission();
    paintSynthReadouts(0, 0);
    paintMicReadouts(0, 0);
  }

  $("position").value = String(state.position);
  paintReadoutOnly(playback, playheads);
  if (state.playing) scheduleFrame();
}

function setupControls() {
  fillSelect("preset", L_SYSTEM_PRESETS, (preset) => preset.name);
  fillSelect("mixPreset", MIX_PRESETS, (preset) => preset.label);
  fillSelect("mappingMode", L_SYSTEM_DRUM_MAPPING_MODES);
  fillSelect("percussionStyle", L_SYSTEM_DRUM_STYLES);
  $("preset").value = state.presetId;
  $("mixPreset").value = state.mix.presetId;

  bindRange("level", "level", formatPercent, applyGlobalLevel);
  bindRange("position", "position", (value) => `${(value * 100).toFixed(1)}%`, () => {
    activeEventKeys = new Set();
  });
  bindRange("speed", "speed", (value) => `${Number(value).toFixed(2)} cyc/s`);
  bindRange("iterations", "iterations", (value) => String(Math.round(value)), (value) => {
    state.iterations = Math.round(value);
    rebuildTrace();
  });
  bindRange("angle", "angle", formatDeg, rebuildTrace);
  bindRange("turnAsymmetry", "turnAsymmetry", formatTurnPair, rebuildTrace);
  bindRange("lengthScale", "lengthScale", formatPercent, rebuildTrace);
  bindRange("continuousLevel", "mix.continuous", formatPercent, applyGlobalLevel);
  bindRange("noteLevel", "mix.notes", formatPercent, applyGlobalLevel);
  bindRange("triggerLevel", "mix.triggers", formatPercent, applyGlobalLevel);
  bindRange("micLevel", "mix.mic", formatPercent, applyGlobalLevel);
  bindRange("baseFrequency", "synth.baseFrequency", formatHz);
  bindRange("pitchRange", "synth.pitchRange", formatOct);
  bindRange("depthAmount", "synth.depthAmount", formatPercent);
  bindRange("modulationIndex", "synth.modulationIndex", (value) => Number(value).toFixed(1));
  bindRange("stereoSpread", "synth.stereoSpread", formatPercent);
  bindRange("subdivisions", "drums.subdivisions", (value) => String(lSystemDrumSubdivisionCount(value)), (value) => {
    state.drums.subdivisions = lSystemDrumSubdivisionCount(value);
    activeEventKeys = new Set();
    refreshDrumTraversalStepSize();
  });
  bindRange("pitchDepth", "drums.pitchDepth", (value) => `${Math.round(value)} st`);
  bindRange("anglePitchDepth", "drums.anglePitchDepth", (value) => `${Math.round(value)} st`);
  bindRange("angleRange", "drums.angleRange", formatDeg);
  bindRange("characterDepth", "drums.characterDepth", formatPercent);
  bindRange("inputTrim", "mic.inputTrim", formatPercent, applyGlobalLevel);
  bindRange("micFeedback", "mic.feedback", formatPercent, (value) => micEngine.setFeedback(value));
  bindRange("micInterval", "mic.interval", formatRatio);
  bindRange("micTimeRatio", "mic.timeRatio", formatRatio);
  bindRange("micPitchRange", "mic.pitchRange", formatOct);
  bindRange("micSpread", "mic.spread", formatPercent);
  bindRange("micWet", "mic.wet", formatPercent);

  bindSelect("structureMode", "structureMode", () => {
    activeEventKeys = new Set();
    refreshDrumTraversalStepSize();
  });
  bindSelect("pitchSource", "synth.pitchSource");
  bindSelect("soundMode", "synth.soundMode", resetVoiceSubmission);
  bindSelect("mappingMode", "drums.mappingMode", () => {
    activeEventKeys = new Set();
    paintMapping();
  });
  bindSelect("percussionStyle", "drums.percussionStyle", () => {
    renderDrumMap();
    paintMapping();
  });

  $("preset").addEventListener("change", () => {
    state.presetId = $("preset").value;
    applyPresetDefaults();
  });
  $("mixPreset").addEventListener("change", () => {
    applyMixPreset($("mixPreset").value);
    text("liveStatus", `${currentMixPreset().label} mix loaded`);
  });
  $("playButton").addEventListener("click", () => {
    state.playing = !state.playing;
    lastFrameTime = performance.now();
    activeEventKeys = new Set();
    paintMotion();
    scheduleFrame();
  });
  $("audioButton").addEventListener("click", () => {
    if (state.audio) disableAudio().catch(showError);
    else enableAudio();
  });
  $("traversalDirection").addEventListener("click", () => {
    state.direction *= -1;
    activeEventKeys = new Set();
    paintMotion();
    scheduleFrame();
  });
  $("playheadMotion").addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-motion]");
    if (!button) return;
    state.traversalBehavior = button.dataset.motion;
    activeEventKeys = new Set();
    paintMotion();
    scheduleFrame();
  });
  for (const button of $("playingMode").querySelectorAll("[data-playing-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.playingMode));
  }
  $("resetSystem").addEventListener("click", resetSystem);
  $("resetAll").addEventListener("click", () => {
    resetAll().catch(showError);
  });
}

function setupAmplitude() {
  amplitudeControl = createAmplitudeControl($("amplitudeControl"), {
    label: "Synth branch amplitude",
    onChange: () => {
      resetVoiceSubmission();
      scheduleFrame();
    },
  });
}

function boot() {
  setupControls();
  setupAmplitude();
  updateIterationLimit();
  renderDrumMap();
  paintMode();
  paintMix();
  paintReadoutOnly();
  applyGlobalLevel();
  setupResizeObserver();
  synthPool.onPolyphonyStatus = scheduleFrame;
  micEngine.onPolyphonyStatus = scheduleFrame;
  window.addEventListener("pagehide", () => {
    synthPool.close?.();
    drumAudio.close?.();
    micEngine.close?.();
  });
}

boot();
