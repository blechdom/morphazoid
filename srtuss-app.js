import {
  SRTUSS_DURATION_SECONDS,
  SRTUSS_MAX_VOICES,
  SRTUSS_PENDING_SOUND_PROJECTS,
  SRTUSS_RUNTIME_DEFAULTS,
  SRTUSS_SOUND_PROJECTS,
  SRTUSS_TAPE_RATE_LIMITS,
  SRTUSS_VOICE_LIMITS,
  SrtussAudio,
  sanitizeSrtussVoices,
  srtussProjectById,
  srtussSupport,
} from "./src/srtuss.js?v=20260908-voice-card-1";
import {
  SRTUSS_MIX_PART_ID,
  SRTUSS_MASTER_FAMILIES,
  SRTUSS_MASTER_GLOBAL_DEFAULTS,
  SRTUSS_MASTER_MACROS,
  SRTUSS_MASTER_PARAM_DEFAULTS,
  SRTUSS_MASTER_PARAM_LIMITS,
  SRTUSS_MASTER_PARAM_ORDER,
  SRTUSS_MASTER_PRESETS,
  SRTUSS_MASTER_PROJECT_IDS,
  SRTUSS_MASTER_STEM_DEFAULTS,
  SRTUSS_MASTER_STEMS,
  sanitizeSrtussMasterGlobals,
  sanitizeSrtussMasterPartId,
  sanitizeSrtussMasterParams,
  sanitizeSrtussMasterStems,
  srtussMasterFamily,
  srtussMasterPart,
  srtussMasterPartMacros,
  srtussMasterParts,
} from "./src/srtuss-master.js?v=20260908-voice-card-1";

const $ = (id) => document.getElementById(id);
const support = srtussSupport(globalThis);
const MASTER_PROJECT_IDS = new Set(SRTUSS_MASTER_PROJECT_IDS);
const DEFAULT_PRESET_ID = "parts-ldlfrs";
const PARAM_INPUT_SELECTOR = "[data-master-param]";
const STEM_INPUT_SELECTOR = "[data-master-stem]";
const RACK_GLOBAL_CONTROLS = Object.freeze({
  clock: Object.freeze(["globalClock", "globalClockOut"]),
  tune: Object.freeze(["globalTune", "globalTuneOut"]),
  width: Object.freeze(["globalWidth", "globalWidthOut"]),
  space: Object.freeze(["globalSpace", "globalSpaceOut"]),
  drive: Object.freeze(["globalDrive", "globalDriveOut"]),
});

const EXACT_ONLY_METADATA = Object.freeze({
  MljSRt: Object.freeze({
    description:
      "The exact Chiptune source combines procedural diatonic sequences, PWM and polyBLEP voices, synthetic drums, and stereo taps.",
    techniqueTags: Object.freeze([
      "procedural sequence",
      "PWM / polyBLEP",
      "diatonic lock",
      "synthetic drums",
      "stereo taps",
    ]),
  }),
  ldfSW2: Object.freeze({
    description:
      "The exact Acid Jam source combines a nine-unit beat grid, filtered additive harmonics, gated phase modulation, synthetic drums, and hard clipping.",
    techniqueTags: Object.freeze([
      "additive acid",
      "random note steps",
      "phase modulation",
      "synthetic drums",
      "hard clipping",
    ]),
  }),
});

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function projectLabel(project) {
  return project?.title
    ?.replace(/\s*\(sound\)\s*$/i, "")
    .replace(/^sound\s*-\s*/i, "") ?? "Unknown sound";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function on(id, type, handler, options) {
  $(id)?.addEventListener(type, handler, options);
}

function clearError() {
  const error = $("audioError");
  if (!error) return;
  error.textContent = "";
  error.hidden = true;
}

function showError(error) {
  const target = $("audioError");
  if (!target) return;
  target.textContent = error instanceof Error ? error.message : String(error);
  target.hidden = false;
}

function announce(message) {
  const target = $("liveStatus");
  if (!target) return;
  target.textContent = "";
  requestAnimationFrame(() => {
    if (target.isConnected) target.textContent = message;
  });
}

function uniqueVoiceId(candidate, usedIds, index) {
  const requested = String(candidate ?? "voice-" + (index + 1))
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .slice(0, 48) || "voice-" + (index + 1);
  let id = requested;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = requested + "-" + suffix;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function normalizeUiVoices(voices, fallbackProjectId = SRTUSS_SOUND_PROJECTS[0].id) {
  const source = Array.isArray(voices) && voices.length ? voices : [{}];
  const prepared = source.slice(0, SRTUSS_MAX_VOICES).map((candidate = {}, index) => ({
    ...candidate,
    id: candidate.id ?? "voice-" + (index + 1),
    timeRate: candidate.tapeRate ?? candidate.timeRate ?? 1,
  }));
  const engineVoices = sanitizeSrtussVoices(prepared, fallbackProjectId);
  const usedIds = new Set();
  return Object.freeze(engineVoices.map((base, index) => {
    const candidate = prepared[index] ?? {};
    return Object.freeze({
      id: uniqueVoiceId(base.id, usedIds, index),
      projectId: base.projectId,
      mode: base.mode,
      partId: base.partId,
      groupId: base.groupId,
      enabled: base.enabled,
      solo: base.solo,
      tapeRate: base.timeRate,
      level: base.level,
      pan: base.pan,
      params: sanitizeSrtussMasterParams(candidate.params ?? base.params),
      stems: sanitizeSrtussMasterStems(candidate.stems ?? base.stems),
    });
  }));
}

function snapshotVoice(voice) {
  return {
    id: voice.id,
    projectId: voice.projectId,
    mode: voice.mode,
    partId: voice.partId,
    groupId: voice.groupId,
    enabled: voice.enabled,
    solo: voice.solo,
    tapeRate: voice.tapeRate,
    level: voice.level,
    pan: voice.pan,
    params: { ...voice.params },
    stems: { ...voice.stems },
  };
}

function sceneFromPreset(preset) {
  const globals = sanitizeSrtussMasterGlobals(preset.globals);
  const voices = normalizeUiVoices(
    preset.voices.map((voice) => ({
      ...voice,
      mode: preset.mode,
      tapeRate: voice.tapeRate ?? voice.timeRate ?? 1,
    })),
  );
  return {
    globals,
    voices,
    selectedVoiceId: voices[0].id,
    presetId: preset.id,
    soundId: null,
  };
}

function sceneFromOriginal(projectId) {
  const project = srtussProjectById(projectId) ?? SRTUSS_SOUND_PROJECTS[0];
  const id = "exact-" + project.id.toLowerCase() + "-voice";
  const voices = normalizeUiVoices([{
    id,
    projectId: project.id,
    mode: "original",
    enabled: true,
    solo: false,
    tapeRate: 1,
    level: 1,
    pan: 0,
    params: SRTUSS_MASTER_PARAM_DEFAULTS,
    stems: SRTUSS_MASTER_STEM_DEFAULTS,
  }], project.id);
  return {
    globals: sanitizeSrtussMasterGlobals(SRTUSS_MASTER_GLOBAL_DEFAULTS),
    voices,
    selectedVoiceId: voices[0].id,
    presetId: null,
    soundId: project.id,
  };
}

const search = new URLSearchParams(location.search);
const requestedSound = srtussProjectById(search.get("sound"))?.id ?? null;
const requestedPreset = SRTUSS_MASTER_PRESETS.find(
  ({ id }) => id === search.get("preset"),
);
const defaultPreset = SRTUSS_MASTER_PRESETS.find(
  ({ id }) => id === DEFAULT_PRESET_ID,
) ?? SRTUSS_MASTER_PRESETS[0];
const initialScene = requestedSound
  ? sceneFromOriginal(requestedSound)
  : sceneFromPreset(requestedPreset ?? defaultPreset);

const state = {
  ...initialScene,
  audioOn: false,
  audioStatus: "off",
  playing: false,
  offsetSeconds: 0,
  transportAnchorMs: performance.now(),
  transportSample: 0,
  voicePhases: Object.freeze([]),
  voicePhaseAtSeconds: 0,
  chunkDuration: SRTUSS_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: SRTUSS_RUNTIME_DEFAULTS.workgroupSize,
  compilingProjectId: null,
};

let engine = null;
let audioStartPromise = null;
let audioStopPromise = null;
let audioGeneration = 0;
let animationFrame = 0;
let sceneRevision = 0;
let commitTimer = null;
let voiceSerial = 1;
let committedScene = null;

function selectedVoice() {
  return state.voices.find(({ id }) => id === state.selectedVoiceId)
    ?? state.voices[0];
}

function selectedVoiceIndex() {
  return Math.max(0, state.voices.findIndex(({ id }) => id === selectedVoice()?.id));
}

function snapshotScene() {
  return {
    globals: { ...state.globals },
    voices: state.voices.map(snapshotVoice),
    selectedVoiceId: state.selectedVoiceId,
    presetId: state.presetId,
    soundId: state.soundId,
  };
}

function restoreScene(scene) {
  state.globals = sanitizeSrtussMasterGlobals(scene.globals);
  state.voices = normalizeUiVoices(scene.voices);
  state.selectedVoiceId = state.voices.some(({ id }) => id === scene.selectedVoiceId)
    ? scene.selectedVoiceId
    : state.voices[0].id;
  state.presetId = scene.presetId ?? null;
  state.soundId = scene.soundId ?? null;
}

committedScene = snapshotScene();

function replaceQuery({ presetId = null, soundId = null } = {}) {
  const url = new URL(location.href);
  if (presetId) url.searchParams.set("preset", presetId);
  else url.searchParams.delete("preset");
  if (soundId) url.searchParams.set("sound", soundId);
  else url.searchParams.delete("sound");
  history.replaceState(null, "", url);
}

function markSceneChanged() {
  state.presetId = null;
  state.soundId = null;
  sceneRevision += 1;
  replaceQuery();
  renderPresetSelection();
}

function replaceVoice(voiceId, patch) {
  const source = state.voices.map((voice) => (
    voice.id === voiceId ? { ...snapshotVoice(voice), ...patch } : snapshotVoice(voice)
  ));
  state.voices = normalizeUiVoices(source, selectedVoice()?.projectId);
  if (!state.voices.some(({ id }) => id === state.selectedVoiceId)) {
    state.selectedVoiceId = state.voices[0].id;
  }
}

function readEngineTransportSample(targetEngine) {
  if (!targetEngine) return state.transportSample;
  const value = typeof targetEngine.currentPlaybackTransportSample === "function"
    ? targetEngine.currentPlaybackTransportSample()
    : targetEngine.currentPlaybackSampleOffset?.();
  return Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : state.transportSample;
}

function currentTransportSeconds() {
  if (state.audioStatus === "on" && engine?.sampleRate) {
    return readEngineTransportSample(engine) / engine.sampleRate;
  }
  if (!state.playing) return state.offsetSeconds;
  return state.offsetSeconds
    + Math.max(0, performance.now() - state.transportAnchorMs) / 1000;
}

function captureEnginePlayback(targetEngine) {
  if (!targetEngine?.sampleRate) return;
  try {
    state.transportSample = readEngineTransportSample(targetEngine);
    state.offsetSeconds = state.transportSample / targetEngine.sampleRate;
    state.transportAnchorMs = performance.now();
    state.voicePhaseAtSeconds = state.offsetSeconds;
    const phases = targetEngine.snapshotVoicePhases?.(state.transportSample);
    if (Array.isArray(phases)) state.voicePhases = phases;
  } catch {
    // A failing device must not prevent teardown.
  }
}

function resolvedRuntimeVoices(scene = state) {
  const globals = sanitizeSrtussMasterGlobals(scene.globals);
  return sanitizeSrtussVoices(scene.voices.map((voice) => {
    const family = srtussMasterFamily(voice.projectId);
    const masterMode = voice.mode === "master" && Boolean(family);
    const partId = sanitizeSrtussMasterPartId(
      voice.projectId, voice.partId, masterMode ? "master" : "original",
    );
    const sourceParams = sanitizeSrtussMasterParams(voice.params);
    const params = masterMode
      ? sanitizeSrtussMasterParams({
        ...sourceParams,
        clock: 1,
        tune: sourceParams.tune + globals.tune,
        space: sourceParams.space + globals.space,
        drive: sourceParams.drive + globals.drive,
      })
      : SRTUSS_MASTER_PARAM_DEFAULTS;
    const clockMultiplier = masterMode
      ? sourceParams.clock * globals.clock
      : 1;
    return {
      id: voice.id,
      projectId: voice.projectId,
      partId,
      groupId: voice.groupId,
      mode: masterMode ? "master" : "original",
      enabled: voice.enabled,
      solo: voice.solo,
      timeRate: voice.tapeRate * clockMultiplier,
      level: voice.level,
      pan: voice.pan,
      width: globals.width,
      params,
      stems: masterMode && partId === SRTUSS_MIX_PART_ID
        ? voice.stems
        : SRTUSS_MASTER_STEM_DEFAULTS,
    };
  }), scene.voices[0]?.projectId);
}

function phasesForStart(runtimeVoices, atSeconds) {
  const saved = new Map(
    state.voicePhases.map((phase) => [phase.id + ":" + phase.projectId, phase]),
  );
  const elapsed = Math.max(0, atSeconds - state.voicePhaseAtSeconds);
  return runtimeVoices.map((voice) => {
    const phase = saved.get(voice.id + ":" + voice.projectId);
    const sourceSeconds = phase
      ? finiteNumber(phase.sourceSeconds, 0) + elapsed * voice.timeRate
      : atSeconds * voice.timeRate;
    return Object.freeze({
      id: voice.id,
      projectId: voice.projectId,
      sourceSeconds:
        ((sourceSeconds % SRTUSS_DURATION_SECONDS) + SRTUSS_DURATION_SECONDS)
        % SRTUSS_DURATION_SECONDS,
    });
  });
}

function formatTime(seconds) {
  const wrapped =
    ((finiteNumber(seconds, 0) % SRTUSS_DURATION_SECONDS) + SRTUSS_DURATION_SECONDS)
    % SRTUSS_DURATION_SECONDS;
  const minutes = Math.floor(wrapped / 60);
  const remainder = wrapped - minutes * 60;
  return String(minutes).padStart(2, "0")
    + ":"
    + remainder.toFixed(3).padStart(6, "0");
}

function formatRate(value) {
  return finiteNumber(value, 1).toFixed(2) + "x";
}

function formatLevel(value) {
  return Math.round(finiteNumber(value, 0) * 100) + "%";
}

function formatPan(value) {
  const amount = finiteNumber(value, 0);
  if (Math.abs(amount) < 0.005) return "Center";
  return (amount < 0 ? "L " : "R ") + Math.round(Math.abs(amount) * 100);
}

function formatRackGlobal(key, value) {
  const amount = finiteNumber(value, SRTUSS_MASTER_GLOBAL_DEFAULTS[key] ?? 0);
  if (key === "clock" || key === "width") return amount.toFixed(2) + "x";
  if (key === "tune") {
    return (amount > 0 ? "+" : "") + Math.round(amount) + " st";
  }
  const percent = Math.round(amount * 100);
  return (percent > 0 ? "+" : "") + percent;
}

function renderRackGlobals() {
  for (const [key, [inputId, outputId]] of Object.entries(RACK_GLOBAL_CONTROLS)) {
    const input = $(inputId);
    if (input) input.value = String(state.globals[key]);
    setText(outputId, formatRackGlobal(key, state.globals[key]));
  }
}

function formatMacroValue(macro, value) {
  const amount = finiteNumber(value, macro.default);
  if (macro.id === "clock") return amount.toFixed(2) + "x";
  if (macro.id === "tune") {
    return (amount > 0 ? "+" : "") + Math.round(amount) + " st";
  }
  const percent = Math.round(amount * 100);
  return (percent > 0 ? "+" : "") + percent;
}

function knobPosition(macro, value) {
  return clamp(
    (finiteNumber(value, macro.default) - macro.min) / (macro.max - macro.min),
    0,
    1,
  );
}

function controlsLocked() {
  return document.body.dataset.runtimeReady !== "true"
    || state.audioStatus === "starting"
    || state.audioStatus === "stopping";
}

function renderPresetSelection() {
  for (const button of document.querySelectorAll("[data-master-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.masterPreset === state.presetId),
    );
  }
  for (const button of document.querySelectorAll("[data-original-sound]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.originalSound === state.soundId),
    );
  }
}

function renderPresetButtons() {
  const container = $("presetButtons");
  if (!container) return;
  container.replaceChildren();
  for (const preset of SRTUSS_MASTER_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "srtuss-preset-button";
    button.dataset.masterPreset = preset.id;
    button.setAttribute("aria-pressed", String(preset.id === state.presetId));
    const name = document.createElement("b");
    name.textContent = preset.label;
    const detail = document.createElement("span");
    detail.textContent = preset.kind === "parts"
      ? preset.voices.length + " independent parts"
      : preset.mode === "original"
      ? "Exact source"
      : preset.voices.length + " layered songs";
    button.append(name, detail);
    button.title = preset.description;
    button.addEventListener("click", () => {
      void applyPreset(preset);
    });
    container.append(button);
  }
}

function renderOriginalButtons() {
  const container = $("originalButtons");
  if (!container) return;
  container.replaceChildren();
  SRTUSS_SOUND_PROJECTS.forEach((project, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "srtuss-preset-button srtuss-original-button";
    button.dataset.originalSound = project.id;
    button.setAttribute("aria-pressed", String(project.id === state.soundId));
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const label = document.createElement("b");
    label.textContent = projectLabel(project);
    button.append(number, label);
    button.addEventListener("click", () => {
      void applyOriginalProject(project.id);
    });
    container.append(button);
  });
}

function renderPendingProjects() {
  const container = $("pendingProjects");
  if (!container) return;
  container.replaceChildren();
  for (const project of SRTUSS_PENDING_SOUND_PROJECTS) {
    const link = document.createElement("a");
    link.href = project.sourceUrl;
    link.textContent = project.id + " · " + project.title;
    link.title = "Open source-pending Shadertoy project";
    container.append(link);
  }
}

function voicePartLabel(voice) {
  const project = srtussProjectById(voice.projectId);
  if (voice.mode === "original") return projectLabel(project);
  return srtussMasterPart(voice.projectId, voice.partId)?.label ?? projectLabel(project);
}

function voiceTargetLabel(voice, index = state.voices.indexOf(voice)) {
  return "P" + String(Math.max(0, index) + 1).padStart(2, "0")
    + " · " + voicePartLabel(voice);
}

function selectVoiceForEditing(voiceId, { quiet = false } = {}) {
  const voice = state.voices.find(({ id }) => id === voiceId);
  if (!voice || voice.id === state.selectedVoiceId) return;
  state.selectedVoiceId = voice.id;
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  if (!quiet) announce(voiceTargetLabel(voice) + " now controls the knob bank.");
}


function renderPartTarget() {
  const voice = selectedVoice();
  if (!voice) return;
  const index = selectedVoiceIndex();
  const project = srtussProjectById(voice.projectId);
  const target = $("macroVoiceSelect");
  if (target) {
    target.replaceChildren();
    state.voices.forEach((candidate, candidateIndex) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = voiceTargetLabel(candidate, candidateIndex)
        + " — " + projectLabel(srtussProjectById(candidate.projectId));
      target.append(option);
    });
    target.value = voice.id;
  }

  const anySolo = state.voices.some((candidate) => candidate.enabled && candidate.solo);
  const targetStatus = $("macroTargetStatus");
  if (targetStatus) {
    targetStatus.textContent = !voice.enabled
      ? "Muted"
      : voice.solo
        ? "Soloed"
        : anySolo
          ? "Hidden by solo"
          : "In the full mix";
    targetStatus.dataset.state = !voice.enabled
      ? "muted"
      : voice.solo
        ? "solo"
        : anySolo
          ? "masked"
          : "mix";
  }
  const previous = $("previousVoice");
  const next = $("nextVoice");
  if (previous) previous.title = "Edit " + voicePartLabel(
    state.voices[(index - 1 + state.voices.length) % state.voices.length],
  );
  if (next) next.title = "Edit " + voicePartLabel(
    state.voices[(index + 1) % state.voices.length],
  );

  setText("macroTargetName", voiceTargetLabel(voice, index) + " controls");
  const masterControls = $("masterControls");
  if (masterControls) {
    masterControls.dataset.voiceId = voice.id;
    masterControls.dataset.projectId = project?.id ?? "";
    masterControls.dataset.partId = voice.partId;
  }
}

function createVoiceAction(voice, index, action, pressed) {
  const button = document.createElement("button");
  const target = voiceTargetLabel(voice, index);
  button.type = "button";
  button.className = "srtuss-voice-action srtuss-voice-action--" + action;
  button.dataset.voiceAction = action;
  button.dataset.voiceId = voice.id;
  button.setAttribute("aria-pressed", String(pressed));
  if (action === "edit") {
    button.textContent = pressed ? "Editing" : "Edit";
    button.setAttribute("aria-label", (pressed ? "Editing " : "Edit ") + target);
    button.addEventListener("click", () => selectVoiceForEditing(voice.id));
  } else if (action === "mute") {
    button.textContent = pressed ? "Muted" : "Mute";
    button.setAttribute("aria-label", (pressed ? "Unmute " : "Mute ") + target);
    button.addEventListener("click", () => toggleVoiceEnabled(voice.id));
  } else {
    button.textContent = pressed ? "Soloed" : "Solo";
    button.setAttribute("aria-label", (pressed ? "Release solo for " : "Solo ") + target);
    button.addEventListener("click", () => toggleVoiceSolo(voice.id));
  }
  return button;
}

function renderVoiceDeck() {
  const container = $("voiceDeck");
  if (!container) return;
  container.replaceChildren();
  const anySolo = state.voices.some((voice) => voice.enabled && voice.solo);
  state.voices.forEach((voice, index) => {
    const project = srtussProjectById(voice.projectId);
    const part = srtussMasterPart(voice.projectId, voice.partId);
    const partLabel = voicePartLabel(voice);
    const audible = voice.enabled && (!anySolo || voice.solo);
    const selected = voice.id === state.selectedVoiceId;
    const card = document.createElement("article");
    card.className = "srtuss-voice-card";
    card.dataset.voiceId = voice.id;
    card.dataset.mode = voice.mode;
    card.dataset.partRole = part?.role ?? "mix";
    card.dataset.enabled = String(voice.enabled);
    card.dataset.solo = String(voice.solo);
    card.dataset.selected = String(selected);
    card.setAttribute("role", "group");
    card.setAttribute(
      "aria-label",
      voiceTargetLabel(voice, index) + " from " + projectLabel(project),
    );

    const head = document.createElement("span");
    head.className = "srtuss-voice-card__head";
    const number = document.createElement("small");
    number.textContent = "P" + String(index + 1).padStart(2, "0");
    const editState = document.createElement("span");
    editState.className = "srtuss-voice-card__edit-state";
    editState.textContent = selected ? "EDITING" : "VOICE";
    head.append(number, editState);

    const name = document.createElement("b");
    name.className = "srtuss-voice-card__name";
    name.textContent = partLabel;

    const mode = document.createElement("span");
    mode.className = "srtuss-voice-card__mode";
    mode.textContent = projectLabel(project) + " · " + voice.mode;

    const meter = document.createElement("span");
    meter.className = "srtuss-voice-card__meter";
    meter.style.setProperty("--voice-level", String(audible ? voice.level : 0));
    meter.setAttribute("aria-hidden", "true");
    const meterFill = document.createElement("i");
    meterFill.style.width = (audible ? voice.level * 100 : 0) + "%";
    meter.append(meterFill);

    const actions = document.createElement("span");
    actions.className = "srtuss-voice-card__actions";
    actions.append(
      createVoiceAction(voice, index, "edit", selected),
      createVoiceAction(voice, index, "mute", !voice.enabled),
      createVoiceAction(voice, index, "solo", voice.solo),
    );

    card.append(head, name, mode, meter, actions);
    container.append(card);
  });
  document.body.dataset.voiceCount = String(state.voices.length);
}

function macroLabel(family, macro) {
  return family?.macroLabels?.[macro.id] ?? macro.label;
}

function macroIsSupported(voice, macroId) {
  return srtussMasterPartMacros(voice.projectId, voice.partId, voice.mode).includes(macroId);
}

function createMacroKnob(voice, family, macro) {
  const targetLabel = voiceTargetLabel(voice);
  const label = document.createElement("label");
  label.className = "srtuss-knob";
  label.dataset.macroId = macro.id;
  label.dataset.voiceId = voice.id;
  const position = knobPosition(macro, voice.params[macro.id]);
  label.style.setProperty("--knob-position", String(position));

  const dial = document.createElement("span");
  dial.className = "srtuss-knob__dial";
  dial.style.setProperty("--knob-position", String(position));
  const input = document.createElement("input");
  input.id = "master-" + macro.id;
  input.type = "range";
  input.min = String(macro.min);
  input.max = String(macro.max);
  input.step = String(macro.step);
  input.value = String(voice.params[macro.id]);
  input.dataset.masterParam = macro.id;
  input.dataset.controlBank = "rotary";
  input.dataset.supported = "true";
  input.dataset.voiceId = voice.id;
  input.setAttribute(
    "aria-label",
    macroLabel(family, macro) + " for " + targetLabel,
  );
  dial.append(input);

  const name = document.createElement("span");
  name.className = "srtuss-knob__label";
  name.textContent = macroLabel(family, macro);
  const output = document.createElement("output");
  output.className = "srtuss-knob__value";
  output.htmlFor = input.id;
  output.dataset.masterParamOutput = macro.id;
  output.textContent = formatMacroValue(macro, voice.params[macro.id]);

  label.append(dial, name, output);
  label.title = macro.description + " Affects " + targetLabel + ".";
  input.addEventListener("input", handleMacroInput);
  input.addEventListener("change", () => {
    void commitScene();
  });
  return label;
}


function createStemControl(voice, stem) {
  const label = document.createElement("label");
  label.className = "srtuss-stem-control control";
  const heading = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = stem.label;
  const output = document.createElement("output");
  const input = document.createElement("input");
  input.id = "stem-" + stem.id;
  input.type = "range";
  input.min = "0";
  input.max = "1.25";
  input.step = "0.01";
  input.value = String(voice.stems[stem.id]);
  input.dataset.masterStem = stem.id;
  output.htmlFor = input.id;
  output.dataset.masterStemOutput = stem.id;
  output.textContent = formatLevel(voice.stems[stem.id]);
  heading.append(name, output);
  label.append(heading, input);
  label.title = stem.description;
  input.addEventListener("input", handleStemInput);
  input.addEventListener("change", () => {
    void commitScene();
  });
  return label;
}

function createMacroNotice(voice) {
  const note = document.createElement("p");
  note.className = "control-note srtuss-macro-empty";
  note.textContent = voice.mode === "original"
    ? "This is the exact, unparameterized source. Choose Master mode in the right pane to expose controls."
    : "This source has no mapped controls for the selected part.";
  return note;
}

function renderMacroControls() {
  const voice = selectedVoice();
  if (!voice) return;
  const family = srtussMasterFamily(voice.projectId);
  const macroIds = new Set(
    srtussMasterPartMacros(voice.projectId, voice.partId, voice.mode),
  );
  const macros = SRTUSS_MASTER_MACROS.filter(({ id }) => macroIds.has(id));
  setText(
    "macroControlCount",
    macros.length
      ? macros.length + " controls · this part only"
      : "No mapped controls",
  );

  const masterControls = $("masterControls");
  if (masterControls) {
    masterControls.dataset.empty = String(macros.length === 0);
    masterControls.replaceChildren(
      ...(macros.length
        ? macros.map((macro) => createMacroKnob(voice, family, macro))
        : [createMacroNotice(voice)]),
    );
  }
}

function renderTechniqueDetails(voice, family) {
  const part = srtussMasterPart(voice.projectId, voice.partId);
  const description = family?.description
    ?? EXACT_ONLY_METADATA[voice.projectId]?.description
    ?? "This source remains available as an exact original program.";
  const tags = family?.techniqueTags
    ?? EXACT_ONLY_METADATA[voice.projectId]?.techniqueTags
    ?? Object.freeze(["exact source"]);
  setText(
    "techniqueDescription",
    description
      + (part && part.id !== SRTUSS_MIX_PART_ID ? " Selected part: " + part.description : "")
      + (family ? " Clock: " + family.clockLabel + "." : "")
      + (
        voice.mode === "original"
          ? " Original mode bypasses the master macros and part selector."
          : " Its effective controls appear once in the knob bank."
      ),
  );
  const container = $("techniqueTags");
  if (!container) return;
  container.replaceChildren();
  for (const technique of tags) {
    const tag = document.createElement("span");
    tag.className = "srtuss-technique-tag";
    tag.textContent = technique;
    container.append(tag);
  }
}

function renderStemControls(voice, family) {
  const container = $("stemControls");
  if (!container) return;
  container.replaceChildren();
  if (!family) {
    const note = document.createElement("p");
    note.className = "control-note";
    note.textContent = "This source is exact-only; master stems are unavailable.";
    container.append(note);
    return;
  }
  if (voice.partId !== SRTUSS_MIX_PART_ID) {
    const note = document.createElement("p");
    note.className = "control-note";
    note.textContent = "This is already an isolated source part. Use Level, Pan, Rate, Mute, Solo, and the technique controls above.";
    container.append(note);
    return;
  }
  const supported = new Set(family.supportedStems);
  for (const stem of SRTUSS_MASTER_STEMS) {
    if (supported.has(stem.id)) container.append(createStemControl(voice, stem));
  }
}

function renderInspector(voice, family) {
  const project = srtussProjectById(voice.projectId);
  const index = selectedVoiceIndex();
  const selectedPart = srtussMasterPart(voice.projectId, voice.partId);
  const selectedLabel = voice.mode === "original" ? projectLabel(project) : selectedPart?.label;
  setText(
    "selectedVoiceName",
    "Part " + String(index + 1).padStart(2, "0") + " · "
      + (selectedLabel ?? projectLabel(project)),
  );

  const source = $("selectedVoiceSource");
  if (source) {
    source.replaceChildren();
    SRTUSS_SOUND_PROJECTS.forEach((candidate, sourceIndex) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = String(sourceIndex + 1).padStart(2, "0")
        + " · "
        + projectLabel(candidate);
      option.selected = candidate.id === voice.projectId;
      source.append(option);
    });
  }

  const mode = $("selectedVoiceMode");
  if (mode) {
    mode.replaceChildren();
    const original = document.createElement("option");
    original.value = "original";
    original.textContent = "Original · exact source";
    const master = document.createElement("option");
    master.value = "master";
    master.textContent = family
      ? "Master · decomposed controls"
      : "Master · unavailable for this source";
    master.disabled = !family;
    mode.append(original, master);
    mode.value = family ? voice.mode : "original";
  }

  const partSelect = $("selectedVoicePart");
  if (partSelect) {
    partSelect.replaceChildren();
    const mixOption = document.createElement("option");
    mixOption.value = SRTUSS_MIX_PART_ID;
    mixOption.textContent = "Complete mix · all generators";
    partSelect.append(mixOption);
    if (family && voice.mode === "master") {
      for (const part of srtussMasterParts(voice.projectId)) {
        const option = document.createElement("option");
        option.value = part.id;
        option.textContent = part.label + " · " + part.role;
        partSelect.append(option);
      }
    }
    partSelect.value = sanitizeSrtussMasterPartId(voice.projectId, voice.partId, voice.mode);
  }
  const inspectorValues = [
    ["selectedVoiceLevel", "selectedVoiceLevelOut", voice.level, formatLevel],
    ["selectedVoicePan", "selectedVoicePanOut", voice.pan, formatPan],
    ["selectedVoiceRate", "selectedVoiceRateOut", voice.tapeRate, formatRate],
  ];
  for (const [inputId, outputId, value, formatter] of inspectorValues) {
    const input = $(inputId);
    if (input) input.value = String(value);
    setText(outputId, formatter(value));
  }

  renderTechniqueDetails(voice, family);
  renderStemControls(voice, family);
}

function renderSelectedVoiceInterface() {
  const voice = selectedVoice();
  if (!voice) return;
  const family = srtussMasterFamily(voice.projectId);
  renderMacroControls();
  renderPartTarget();
  renderInspector(voice, family);
  updateControlAvailability();
}

function updateRuntimeReadout() {
  setText("chunkDurationOut", Math.round(state.chunkDuration * 1000) + " ms");
  setText("workgroupSizeOut", state.workgroupSize + " lanes");
  setText(
    "runtimeState",
    Math.round(state.chunkDuration * 1000)
      + " ms · "
      + state.workgroupSize
      + " lanes · "
      + state.voices.length
      + "/"
      + SRTUSS_MAX_VOICES
      + " parts",
  );
}

function renderSupportState() {
  const layerSummary = state.voices.length
    + (state.voices.length === 1 ? " voice" : " voices");
  if (!support.supported) {
    setText("gpuState", support.webgpu ? "Web Audio unavailable" : "WebGPU unavailable");
    setText("streamState", "A WebGPU-capable browser is required for sound.");
    return;
  }
  if (state.audioStatus === "starting") {
    setText("gpuState", "Starting WebGPU audio");
    setText(
      "streamState",
      "Compiling " + layerSummary + " across "
        + SRTUSS_MASTER_FAMILIES.length + " master families",
    );
  } else if (state.audioStatus === "stopping") {
    setText("gpuState", "Stopping WebGPU audio");
    setText("streamState", "Releasing queued buffers and GPU resources");
  } else if (state.audioStatus === "error") {
    setText("gpuState", "Audio start failed");
    setText("streamState", "The transport and editable rack remain available");
  } else if (state.audioOn && state.compilingProjectId) {
    const project = srtussProjectById(state.compilingProjectId);
    setText("gpuState", "Preparing " + projectLabel(project));
    setText("streamState", "The current rack continues until the crossfade is ready");
  } else if (state.audioOn) {
    setText("gpuState", "WebGPU master ready");
    setText(
      "streamState",
      state.playing
        ? "Streaming " + layerSummary + " without CPU synthesis"
        : "Armed and paused · " + layerSummary,
    );
  } else {
    setText("gpuState", "WebGPU available");
    setText(
      "streamState",
      state.playing
        ? "Transport playing silently; Audio remains off"
        : "Audio is explicit; the rack is silent",
    );
  }
}

function updateControlAvailability() {
  const ready = document.body.dataset.runtimeReady === "true";
  const locked = controlsLocked();
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  const hasMappedVoice = state.voices.some((candidate) => (
    candidate.mode === "master" && Boolean(srtussMasterFamily(candidate.projectId))
  ));

  const audioButton = $("audioButton");
  if (audioButton) {
    audioButton.disabled = !ready
      || !support.supported
      || state.audioStatus === "starting"
      || state.audioStatus === "stopping";
  }
  const playButton = $("synthPlayButton");
  if (playButton) playButton.disabled = !ready;

  for (const id of [
    "randomizePatch",
    "mutatePatch",
    "selectedVoiceSource",
    "selectedVoiceMode",
    "selectedVoicePart",
    "selectedVoiceLevel",
    "selectedVoicePan",
    "selectedVoiceRate",
    "macroVoiceSelect",
  ]) {
    const control = $(id);
    if (control) control.disabled = locked;
  }
  const randomize = $("randomizePatch");
  const mutate = $("mutatePatch");
  if (randomize) randomize.disabled = locked || !family;
  if (mutate) mutate.disabled = locked || !family;
  const partControl = $("selectedVoicePart");
  if (partControl) partControl.disabled = locked || !family || voice?.mode !== "master";
  const voiceSelect = $("macroVoiceSelect");
  if (voiceSelect) voiceSelect.disabled = locked || state.voices.length <= 1;
  const navigationDisabled = locked || state.voices.length <= 1;
  for (const id of ["previousVoice", "nextVoice"]) {
    const control = $(id);
    if (control) control.disabled = navigationDisabled;
  }
  for (const control of document.querySelectorAll("[data-voice-action]")) {
    control.disabled = locked;
  }

  for (const input of document.querySelectorAll(PARAM_INPUT_SELECTOR)) {
    input.disabled = locked
      || voice?.mode !== "master"
      || input.dataset.supported !== "true";
  }
  for (const input of document.querySelectorAll(STEM_INPUT_SELECTOR)) {
    input.disabled = locked || voice?.mode !== "master";
  }
  for (const [inputId] of Object.values(RACK_GLOBAL_CONTROLS)) {
    const input = $(inputId);
    if (input) input.disabled = locked || !hasMappedVoice;
  }

  for (const button of document.querySelectorAll(
    "[data-master-preset], [data-original-sound]",
  )) {
    button.disabled = locked;
  }
  const add = $("addVoice");
  if (add) add.disabled = locked || state.voices.length >= SRTUSS_MAX_VOICES;
  const explode = $("explodeSelectedVoice");
  if (explode) explode.disabled = locked || voice?.mode !== "master"
    || voice?.partId !== SRTUSS_MIX_PART_ID || !family
    || state.voices.length - 1 + family.parts.length > SRTUSS_MAX_VOICES;
  const remove = $("removeSelectedVoice");
  if (remove) remove.disabled = locked || state.voices.length <= 1;
  const reset = $("resetMaster");
  if (reset) reset.disabled = locked;

  const runtimeLocked = !ready || state.audioStatus !== "off";
  const chunkDuration = $("chunkDuration");
  const workgroupSize = $("workgroupSize");
  if (chunkDuration) chunkDuration.disabled = runtimeLocked;
  if (workgroupSize) workgroupSize.disabled = runtimeLocked;
  const output = $("output");
  if (output) output.disabled = !ready;
}

function renderAll() {
  renderPresetButtons();
  renderOriginalButtons();
  renderVoiceDeck();
  renderRackGlobals();
  renderSelectedVoiceInterface();
  const output = $("output");
  if (output) output.value = String(state.globals.output);
  setText("outputOut", formatLevel(state.globals.output));
  updateRuntimeReadout();
  renderSupportState();
  renderPresetSelection();
}

function syncMacroControlValues(paramId, value) {
  const macro = SRTUSS_MASTER_MACROS.find(({ id }) => id === paramId);
  if (!macro) return;
  for (const input of document.querySelectorAll(
    "[data-master-param=\"" + paramId + "\"]",
  )) {
    input.value = String(value);
    const knob = input.closest(".srtuss-knob");
    const dial = input.closest(".srtuss-knob__dial");
    const position = String(knobPosition(macro, value));
    knob?.style.setProperty("--knob-position", position);
    dial?.style.setProperty("--knob-position", position);
  }
  for (const output of document.querySelectorAll(
    "[data-master-param-output=\"" + paramId + "\"]",
  )) {
    output.textContent = formatMacroValue(macro, value);
  }
}

function syncStemControlValues(stemId, value) {
  for (const input of document.querySelectorAll(
    "[data-master-stem=\"" + stemId + "\"]",
  )) {
    input.value = String(value);
  }
  for (const output of document.querySelectorAll(
    "[data-master-stem-output=\"" + stemId + "\"]",
  )) {
    output.textContent = formatLevel(value);
  }
}

function handleMacroInput(event) {
  const input = event.currentTarget;
  const paramId = input.dataset.masterParam;
  const voice = selectedVoice();
  if (!voice || !SRTUSS_MASTER_PARAM_ORDER.includes(paramId)) return;
  if (!macroIsSupported(voice, paramId)) return;
  const params = sanitizeSrtussMasterParams({
    ...voice.params,
    [paramId]: Number(input.value),
  });
  replaceVoice(voice.id, { params });
  markSceneChanged();
  syncMacroControlValues(paramId, params[paramId]);
  scheduleSceneCommit();
}

function handleStemInput(event) {
  const input = event.currentTarget;
  const stemId = input.dataset.masterStem;
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  if (!voice || voice.mode !== "master" || !family?.supportedStems.includes(stemId)) {
    return;
  }
  const stems = sanitizeSrtussMasterStems({
    ...voice.stems,
    [stemId]: Number(input.value),
  });
  replaceVoice(voice.id, { stems });
  markSceneChanged();
  syncStemControlValues(stemId, stems[stemId]);
  scheduleSceneCommit();
}

function updateSelectedVoiceScalar(field, rawValue) {
  const voice = selectedVoice();
  if (!voice) return;
  let value;
  if (field === "level") {
    value = clamp(
      finiteNumber(rawValue, voice.level),
      SRTUSS_VOICE_LIMITS.level[0],
      SRTUSS_VOICE_LIMITS.level[1],
    );
  } else if (field === "pan") {
    value = clamp(
      finiteNumber(rawValue, voice.pan),
      SRTUSS_VOICE_LIMITS.pan[0],
      SRTUSS_VOICE_LIMITS.pan[1],
    );
  } else {
    value = clamp(
      finiteNumber(rawValue, voice.tapeRate),
      SRTUSS_TAPE_RATE_LIMITS[0],
      SRTUSS_TAPE_RATE_LIMITS[1],
    );
  }
  replaceVoice(voice.id, { [field === "rate" ? "tapeRate" : field]: value });
  markSceneChanged();
  if (field === "level") setText("selectedVoiceLevelOut", formatLevel(value));
  else if (field === "pan") setText("selectedVoicePanOut", formatPan(value));
  else setText("selectedVoiceRateOut", formatRate(value));
  renderVoiceDeck();
  scheduleSceneCommit();
}

function updateRackGlobal(key, rawValue) {
  if (!(key in RACK_GLOBAL_CONTROLS)) return;
  state.globals = sanitizeSrtussMasterGlobals({
    ...state.globals,
    [key]: Number(rawValue),
  });
  markSceneChanged();
  renderRackGlobals();
  scheduleSceneCommit();
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function randomMacroValue(id) {
  const limits = SRTUSS_MASTER_PARAM_LIMITS[id];
  if (id === "clock") return randomBetween(0.72, 1.38);
  if (id === "tune") return Math.round(randomBetween(-12, 12));
  return randomBetween(
    Math.max(limits.min, -0.72),
    Math.min(limits.max, 0.72),
  );
}

function randomizeSelectedVoice() {
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  if (!voice || !family) {
    announce("This exact-only source has no master parameter map.");
    return;
  }
  const supportedMacros = new Set(family.supportedMacros);
  const params = {};
  for (const id of SRTUSS_MASTER_PARAM_ORDER) {
    params[id] = supportedMacros.has(id)
      ? randomMacroValue(id)
      : SRTUSS_MASTER_PARAM_DEFAULTS[id];
  }
  const supportedStems = new Set(family.supportedStems);
  const stems = {};
  for (const stem of SRTUSS_MASTER_STEMS) {
    stems[stem.id] = supportedStems.has(stem.id)
      ? randomBetween(0.42, 1.05)
      : SRTUSS_MASTER_STEM_DEFAULTS[stem.id];
  }
  replaceVoice(voice.id, {
    mode: "master",
    params: sanitizeSrtussMasterParams(params),
    stems: sanitizeSrtussMasterStems(stems),
  });
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({ message: "Randomized the selected master voice." });
}

function mutateSelectedVoice() {
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  if (!voice || !family) {
    announce("This exact-only source has no master parameter map.");
    return;
  }
  const supportedMacros = new Set(family.supportedMacros);
  const params = {};
  for (const id of SRTUSS_MASTER_PARAM_ORDER) {
    const limits = SRTUSS_MASTER_PARAM_LIMITS[id];
    const current = voice.params[id];
    if (!supportedMacros.has(id)) {
      params[id] = current;
    } else if (id === "clock") {
      params[id] = clamp(current + randomBetween(-0.14, 0.14), limits.min, limits.max);
    } else if (id === "tune") {
      params[id] = clamp(current + Math.round(randomBetween(-5, 5)), limits.min, limits.max);
    } else {
      params[id] = clamp(current + randomBetween(-0.2, 0.2), limits.min, limits.max);
    }
  }
  const supportedStems = new Set(family.supportedStems);
  const stems = {};
  for (const stem of SRTUSS_MASTER_STEMS) {
    const current = voice.stems[stem.id];
    stems[stem.id] = supportedStems.has(stem.id)
      ? clamp(current + randomBetween(-0.16, 0.16), 0, 1.25)
      : current;
  }
  replaceVoice(voice.id, {
    mode: "master",
    params: sanitizeSrtussMasterParams(params),
    stems: sanitizeSrtussMasterStems(stems),
  });
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({ message: "Mutated the selected master voice." });
}

async function applyPreset(preset) {
  const next = sceneFromPreset(preset);
  restoreScene(next);
  state.presetId = preset.id;
  state.soundId = null;
  sceneRevision += 1;
  replaceQuery({ presetId: preset.id });
  clearError();
  renderAll();
  engine?.setOutput(state.globals.output);
  await commitScene({
    message: "Loaded " + preset.label + " without restarting transport.",
  });
}

async function applyOriginalProject(projectId) {
  const project = srtussProjectById(projectId);
  if (!project) return;
  restoreScene(sceneFromOriginal(project.id));
  state.presetId = null;
  state.soundId = project.id;
  sceneRevision += 1;
  replaceQuery({ soundId: project.id });
  clearError();
  renderAll();
  engine?.setOutput(state.globals.output);
  await commitScene({
    message: "Loaded the exact " + projectLabel(project) + " source without restarting transport.",
  });
}

function nextDynamicVoiceId() {
  const used = new Set(state.voices.map(({ id }) => id));
  let id;
  do {
    id = "master-voice-" + String(voiceSerial).padStart(2, "0");
    voiceSerial += 1;
  } while (used.has(id));
  return id;
}

function addVoice() {
  if (state.voices.length >= SRTUSS_MAX_VOICES) return;
  const current = selectedVoice();
  let projectId = srtussMasterFamily(current?.projectId)
    ? current.projectId
    : SRTUSS_MASTER_PROJECT_IDS[0];
  let family = srtussMasterFamily(projectId);
  const usedParts = new Set(
    state.voices
      .filter((voice) => voice.projectId === projectId)
      .map(({ partId }) => partId),
  );
  let part = family.parts.find(({ id }) => !usedParts.has(id));
  if (!part) {
    const currentProjectIndex = Math.max(0, SRTUSS_MASTER_PROJECT_IDS.indexOf(projectId));
    projectId = SRTUSS_MASTER_PROJECT_IDS[
      (currentProjectIndex + 1) % SRTUSS_MASTER_PROJECT_IDS.length
    ];
    family = srtussMasterFamily(projectId);
    part = family.parts[0];
  }
  const id = nextDynamicVoiceId();
  const joinsSelectedGroup = current?.mode === "master"
    && current.projectId === projectId
    && current.partId !== SRTUSS_MIX_PART_ID;
  state.voices = normalizeUiVoices([
    ...state.voices.map(snapshotVoice),
    {
      id,
      groupId: joinsSelectedGroup ? current.groupId : id,
      projectId,
      partId: part.id,
      mode: "master",
      enabled: true,
      solo: false,
      tapeRate: joinsSelectedGroup ? current.tapeRate : 1,
      level: joinsSelectedGroup ? current.level : 0.55,
      pan: joinsSelectedGroup ? current.pan : 0,
      params: joinsSelectedGroup ? current.params : SRTUSS_MASTER_PARAM_DEFAULTS,
      stems: joinsSelectedGroup ? current.stems : SRTUSS_MASTER_STEM_DEFAULTS,
    },
  ], projectId);
  state.selectedVoiceId = id;
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: "Added " + part.label + " from "
      + projectLabel(srtussProjectById(projectId)) + ".",
  });
}

function explodeSelectedVoice() {
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  if (!voice || voice.mode !== "master" || voice.partId !== SRTUSS_MIX_PART_ID || !family) {
    announce("Select a Master complete mix to explode it into source parts.");
    return;
  }
  const nextCount = state.voices.length - 1 + family.parts.length;
  if (nextCount > SRTUSS_MAX_VOICES) {
    announce("That song needs " + family.parts.length
      + " tracks; remove another part first to stay within "
      + SRTUSS_MAX_VOICES + ".");
    return;
  }

  const groupId = "exploded-" + voice.id;
  const phaseSources = {};
  const expanded = [];
  for (const candidate of state.voices) {
    if (candidate.id !== voice.id) {
      expanded.push(snapshotVoice(candidate));
      continue;
    }
    family.parts.forEach((part, partIndex) => {
      const id = partIndex === 0 ? voice.id : nextDynamicVoiceId();
      phaseSources[id] = voice.id;
      expanded.push({
        ...snapshotVoice(voice),
        id,
        groupId,
        partId: part.id,
        mode: "master",
      });
    });
  }

  state.voices = normalizeUiVoices(expanded, voice.projectId);
  state.selectedVoiceId = voice.id;
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: "Exploded " + projectLabel(srtussProjectById(voice.projectId))
      + " into " + family.parts.length + " synchronized source parts.",
    phaseSources,
  });
}

function removeSelectedVoice() {
  if (state.voices.length <= 1) return;
  const index = selectedVoiceIndex();
  const removed = selectedVoice();
  const survivors = state.voices.filter(({ id }) => id !== removed.id);
  state.voices = normalizeUiVoices(survivors.map(snapshotVoice));
  state.selectedVoiceId = state.voices[Math.min(index, state.voices.length - 1)].id;
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: "Removed " + projectLabel(srtussProjectById(removed.projectId)) + ".",
  });
}

function resetMaster() {
  void applyPreset(defaultPreset);
}

function scheduleSceneCommit() {
  if (commitTimer !== null) return;
  commitTimer = setTimeout(() => {
    commitTimer = null;
    void commitScene();
  }, 55);
}

async function commitScene({ message = "", phaseSources } = {}) {
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  const revision = sceneRevision;
  const snapshot = snapshotScene();
  const targetEngine = engine;

  if (!targetEngine || state.audioStatus !== "on") {
    if (state.audioStatus !== "starting") committedScene = snapshot;
    if (message) {
      announce(
        message + (
          state.audioStatus === "starting"
            ? " It will join when Audio is ready."
            : " Audio remains off."
        ),
      );
    }
    return false;
  }

  try {
    await targetEngine.setVoices(resolvedRuntimeVoices(snapshot), {
      restart: false,
      phaseSources,
    });
    if (
      revision !== sceneRevision
      || targetEngine !== engine
      || state.audioStatus !== "on"
    ) {
      return false;
    }
    targetEngine.setOutput(snapshot.globals.output);
    committedScene = snapshot;
    state.compilingProjectId = null;
    if (message) announce(message);
    renderVoiceDeck();
    renderSupportState();
    return true;
  } catch (error) {
    if (
      revision !== sceneRevision
      || targetEngine !== engine
      || error?.name === "AbortError"
    ) {
      return false;
    }
    restoreScene(committedScene);
    sceneRevision += 1;
    state.compilingProjectId = null;
    targetEngine.setOutput(state.globals.output);
    renderAll();
    showError(error);
    announce("That edit could not compile. Restored the last playable rack.");
    return false;
  }
}

function setAudioStatus(status) {
  state.audioStatus = status;
  state.audioOn = status === "on";
  document.body.dataset.audio = status;
  const button = $("audioButton");
  if (button) {
    button.setAttribute("aria-pressed", String(state.audioOn));
    const action = state.audioOn ? "Turn audio off" : "Turn audio on";
    button.setAttribute("aria-label", action);
    button.title = action;
  }
  setText("audioState", status);
  if (!state.audioOn && status !== "starting") {
    delete document.body.dataset.activeSound;
  }
  updateControlAvailability();
  renderSupportState();
}

function setPlaybackState(playing, { quiet = false } = {}) {
  const atSeconds = currentTransportSeconds();
  state.offsetSeconds = atSeconds;
  state.transportAnchorMs = performance.now();
  state.playing = Boolean(playing);
  document.body.dataset.playing = String(state.playing);
  const action = state.playing ? "Pause srtuss master synth" : "Play srtuss master synth";
  const button = $("synthPlayButton");
  if (button) {
    button.setAttribute("aria-pressed", String(state.playing));
    button.setAttribute("aria-label", action);
    button.title = action + " (Space)";
  }
  setText("synthPlayLabel", state.playing ? "Pause master" : "Play master");
  setText("synthPlayState", state.playing ? "playing · Space" : "paused · Space");
  if (engine && state.audioOn) {
    const targetEngine = engine;
    void targetEngine.setPlaybackEnabled(state.playing).catch((error) => {
      void handleEngineFailure(targetEngine, error);
    });
  }
  if (!quiet) {
    if (state.playing && !state.audioOn) {
      announce("Audio is off — turn it on to hear playback");
    } else {
      announce(state.playing ? "Master transport playing." : "Master transport paused.");
    }
  }
  renderSupportState();
}

function handleEngineStatus(targetEngine, status) {
  if (targetEngine !== engine) return;
  if (status.kind === "compiling") {
    state.compilingProjectId = status.project?.id ?? null;
  } else if ([
    "ready",
    "selected",
    "queued",
    "switched",
    "voices-updated",
    "voices-queued",
    "voices-switched",
  ].includes(status.kind)) {
    if (!["queued", "voices-queued"].includes(status.kind)) {
      state.compilingProjectId = null;
    }
  }
  if (status.project?.id && [
    "ready",
    "selected",
    "switched",
    "voices-updated",
    "voices-switched",
  ].includes(status.kind)) {
    document.body.dataset.activeSound = status.project.id;
  }
  renderSupportState();
}

async function handleEngineFailure(targetEngine, error) {
  if (engine !== targetEngine) return;
  const generation = ++audioGeneration;
  captureEnginePlayback(targetEngine);
  engine = null;
  audioStartPromise = null;
  state.compilingProjectId = null;
  setAudioStatus("stopping");
  const pending = (async () => {
    await targetEngine.stop({ fade: false }).catch(() => {});
    if (generation !== audioGeneration || engine) return false;
    setAudioStatus("error");
    showError(error);
    return true;
  })();
  audioStopPromise = pending;
  try {
    await pending;
  } finally {
    if (audioStopPromise === pending) audioStopPromise = null;
  }
}

async function startAudio() {
  if (audioStopPromise) await audioStopPromise;
  if (state.audioOn) return true;
  if (audioStartPromise) return audioStartPromise;
  clearError();

  const generation = ++audioGeneration;
  const atSeconds = currentTransportSeconds();
  state.offsetSeconds = atSeconds;
  state.transportAnchorMs = performance.now();
  const initialRuntimeVoices = resolvedRuntimeVoices();
  const initialPhases = phasesForStart(initialRuntimeVoices, atSeconds);
  const nextEngine = new SrtussAudio(globalThis, {
    projectId: initialRuntimeVoices[0].projectId,
    voices: initialRuntimeVoices,
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
    output: state.globals.output,
  });
  nextEngine.setStatusHandler((status) => handleEngineStatus(nextEngine, status));
  nextEngine.setErrorHandler((error) => {
    void handleEngineFailure(nextEngine, error);
  });
  engine = nextEngine;
  setAudioStatus("starting");

  let pending;
  pending = (async () => {
    try {
      const context = await nextEngine.start({
        autoStart: false,
        transportSeconds: atSeconds,
        voicePhases: initialPhases,
      });
      if (
        generation !== audioGeneration
        || engine !== nextEngine
        || context !== nextEngine.context
      ) {
        await nextEngine.stop({ fade: false });
        return false;
      }

      let appliedRevision = -1;
      while (appliedRevision !== sceneRevision) {
        appliedRevision = sceneRevision;
        await nextEngine.setVoices(resolvedRuntimeVoices(), { restart: false });
        if (
          generation !== audioGeneration
          || engine !== nextEngine
          || context !== nextEngine.context
        ) {
          await nextEngine.stop({ fade: false });
          return false;
        }
      }

      const joinSeconds = currentTransportSeconds();
      nextEngine.alignStoppedTransport(joinSeconds);
      state.offsetSeconds = joinSeconds;
      state.transportSample = Math.round(joinSeconds * nextEngine.sampleRate);
      state.transportAnchorMs = performance.now();
      nextEngine.setOutput(state.globals.output);
      committedScene = snapshotScene();
      setAudioStatus("on");
      await nextEngine.setPlaybackEnabled(state.playing);
      if (generation !== audioGeneration || engine !== nextEngine) return false;
      announce(
        state.playing
          ? "WebGPU audio armed and joined the running master transport."
          : "WebGPU audio armed. Press Play to hear the master rack.",
      );
      return true;
    } catch (error) {
      await nextEngine.stop({ fade: false }).catch(() => {});
      if (generation !== audioGeneration) return false;
      if (engine === nextEngine) engine = null;
      state.compilingProjectId = null;
      setAudioStatus("error");
      showError(error);
      return false;
    } finally {
      if (audioStartPromise === pending) audioStartPromise = null;
      renderSupportState();
    }
  })();
  audioStartPromise = pending;
  return pending;
}

async function stopAudio({ quiet = false, fade = true } = {}) {
  if (audioStopPromise) return audioStopPromise;
  const generation = ++audioGeneration;
  const previous = engine;
  if (previous) captureEnginePlayback(previous);
  else {
    state.offsetSeconds = currentTransportSeconds();
    state.transportAnchorMs = performance.now();
  }
  engine = null;
  audioStartPromise = null;
  state.compilingProjectId = null;
  setAudioStatus("stopping");
  const pending = (async () => {
    try {
      if (previous) await previous.stop({ fade });
      if (generation !== audioGeneration || engine) return false;
      setAudioStatus("off");
      if (!quiet) announce("srtuss audio off. Master transport state is preserved.");
      return true;
    } catch (error) {
      if (generation !== audioGeneration || engine) return false;
      setAudioStatus("error");
      showError(error);
      return false;
    }
  })();
  audioStopPromise = pending;
  try {
    return await pending;
  } finally {
    if (audioStopPromise === pending) audioStopPromise = null;
  }
}

async function toggleAudio() {
  if (state.audioStatus === "starting" || state.audioStatus === "stopping") return;
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

async function restartTransport() {
  const targetEngine = engine;
  const generation = audioGeneration;
  try {
    if (targetEngine) {
      await targetEngine.restart(0);
      if (targetEngine !== engine || generation !== audioGeneration) return;
    }
    state.offsetSeconds = 0;
    state.transportSample = 0;
    state.transportAnchorMs = performance.now();
    state.voicePhaseAtSeconds = 0;
    state.voicePhases = Object.freeze([]);
    setText("timeline", formatTime(0));
    announce(
      targetEngine
        ? "Master transport restarted at zero."
        : "Master transport reset to zero. Audio remains off.",
    );
  } catch (error) {
    if (targetEngine !== engine || error?.name === "AbortError") return;
    showError(error);
  }
}

function updateTimeline() {
  setText("timeline", formatTime(currentTransportSeconds()));
  animationFrame = requestAnimationFrame(updateTimeline);
}

function changeSelectedSource(projectId) {
  const voice = selectedVoice();
  const project = srtussProjectById(projectId);
  if (!voice || !project || voice.projectId === project.id) return;
  const mode = voice.mode === "master" && MASTER_PROJECT_IDS.has(project.id)
    ? "master"
    : "original";
  replaceVoice(voice.id, {
    projectId: project.id,
    mode,
    partId: SRTUSS_MIX_PART_ID,
    groupId: voice.id,
  });
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: "Part " + (selectedVoiceIndex() + 1) + " now uses "
      + projectLabel(project) + ".",
  });
}

function changeSelectedMode(mode) {
  const voice = selectedVoice();
  const family = voice ? srtussMasterFamily(voice.projectId) : null;
  if (!voice) return;
  const nextMode = mode === "master" && family ? "master" : "original";
  if (voice.mode === nextMode) return;
  replaceVoice(voice.id, {
    mode: nextMode,
    partId: nextMode === "master" ? voice.partId : SRTUSS_MIX_PART_ID,
  });
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: "Part " + (selectedVoiceIndex() + 1) + " switched to "
      + nextMode + " mode.",
  });
}

function changeSelectedPart(partId) {
  const voice = selectedVoice();
  if (!voice || voice.mode !== "master") return;
  const nextPartId = sanitizeSrtussMasterPartId(voice.projectId, partId, voice.mode);
  if (nextPartId === voice.partId) return;
  replaceVoice(voice.id, { partId: nextPartId });
  markSceneChanged();
  clearError();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  const part = srtussMasterPart(voice.projectId, nextPartId);
  void commitScene({
    message: "Selected " + (part?.label ?? "complete mix")
      + " without restarting transport.",
  });
}

function toggleVoiceEnabled(voiceId) {
  const voice = state.voices.find(({ id }) => id === voiceId);
  if (!voice) return;
  const enabling = !voice.enabled;
  replaceVoice(voice.id, {
    enabled: enabling,
    solo: enabling ? voice.solo : false,
  });
  markSceneChanged();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: enabling
      ? "Enabled " + voicePartLabel(voice) + "."
      : "Muted " + voicePartLabel(voice) + ".",
  });
}

function toggleVoiceSolo(voiceId) {
  const voice = state.voices.find(({ id }) => id === voiceId);
  if (!voice) return;
  const solo = !voice.solo;
  replaceVoice(voice.id, {
    enabled: solo ? true : voice.enabled,
    solo,
  });
  markSceneChanged();
  renderVoiceDeck();
  renderSelectedVoiceInterface();
  void commitScene({
    message: solo
      ? "Soloed " + voicePartLabel(voice) + "."
      : "Released solo for " + voicePartLabel(voice) + ".",
  });
}
function selectAdjacentVoice(offset) {
  if (state.voices.length <= 1) return;
  const index = (
    selectedVoiceIndex() + offset + state.voices.length
  ) % state.voices.length;
  selectVoiceForEditing(state.voices[index].id);
}



function configureStaticControls() {
  const level = $("selectedVoiceLevel");
  if (level) {
    level.min = String(SRTUSS_VOICE_LIMITS.level[0]);
    level.max = String(SRTUSS_VOICE_LIMITS.level[1]);
    level.step = "0.01";
  }
  const pan = $("selectedVoicePan");
  if (pan) {
    pan.min = String(SRTUSS_VOICE_LIMITS.pan[0]);
    pan.max = String(SRTUSS_VOICE_LIMITS.pan[1]);
    pan.step = "0.01";
  }
  const rate = $("selectedVoiceRate");
  if (rate) {
    rate.min = String(SRTUSS_TAPE_RATE_LIMITS[0]);
    rate.max = String(SRTUSS_TAPE_RATE_LIMITS[1]);
    rate.step = "0.01";
  }
}

on("audioButton", "click", () => {
  void toggleAudio();
});
on("synthPlayButton", "click", () => {
  setPlaybackState(!state.playing);
});
on("addVoice", "click", addVoice);
on("explodeSelectedVoice", "click", explodeSelectedVoice);
on("removeSelectedVoice", "click", removeSelectedVoice);
on("randomizePatch", "click", randomizeSelectedVoice);
on("mutatePatch", "click", mutateSelectedVoice);
on("resetMaster", "click", resetMaster);

on("selectedVoiceSource", "change", (event) => {
  changeSelectedSource(event.currentTarget.value);
});
on("selectedVoiceMode", "change", (event) => {
  changeSelectedMode(event.currentTarget.value);
});
on("selectedVoicePart", "change", (event) => {
  changeSelectedPart(event.currentTarget.value);
});
on("macroVoiceSelect", "change", (event) => {
  selectVoiceForEditing(event.currentTarget.value);
});
on("previousVoice", "click", () => {
  selectAdjacentVoice(-1);
});
on("nextVoice", "click", () => {
  selectAdjacentVoice(1);
});
on("selectedVoiceLevel", "input", (event) => {
  updateSelectedVoiceScalar("level", event.currentTarget.value);
});
on("selectedVoiceLevel", "change", () => {
  void commitScene();
});
on("selectedVoicePan", "input", (event) => {
  updateSelectedVoiceScalar("pan", event.currentTarget.value);
});
on("selectedVoicePan", "change", () => {
  void commitScene();
});
on("selectedVoiceRate", "input", (event) => {
  updateSelectedVoiceScalar("rate", event.currentTarget.value);
});
on("selectedVoiceRate", "change", () => {
  void commitScene();
});

for (const [key, [inputId]] of Object.entries(RACK_GLOBAL_CONTROLS)) {
  on(inputId, "input", (event) => {
    updateRackGlobal(key, event.currentTarget.value);
  });
  on(inputId, "change", () => {
    void commitScene();
  });
}

on("output", "input", (event) => {
  state.globals = sanitizeSrtussMasterGlobals({
    ...state.globals,
    output: Number(event.currentTarget.value),
  });
  setText("outputOut", formatLevel(state.globals.output));
  engine?.setOutput(state.globals.output);
  markSceneChanged();
  scheduleSceneCommit();
});
on("chunkDuration", "input", (event) => {
  state.chunkDuration = clamp(Number(event.currentTarget.value), 0.03, 0.25);
  updateRuntimeReadout();
});
on("workgroupSize", "change", (event) => {
  const requested = Number(event.currentTarget.value);
  state.workgroupSize = [32, 64, 128, 256].includes(requested)
    ? requested
    : SRTUSS_RUNTIME_DEFAULTS.workgroupSize;
  updateRuntimeReadout();
});

document.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented
    || event.code !== "Space"
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.isComposing
  ) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest(
    "input, select, textarea, button, a, summary, audio, video, "
      + "[contenteditable], [role=slider], [role=spinbutton], [role=combobox], "
      + "[role=textbox], [role=switch], [role=tab], [role=menu], [role=listbox], "
      + "[role=tree], [role=grid]",
  )) {
    return;
  }
  const playButton = $("synthPlayButton");
  if (!playButton || playButton.disabled) return;
  event.preventDefault();
  playButton.click();
});

function handlePageHide() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  sceneRevision += 1;
  void stopAudio({ quiet: true, fade: false });
}

function handlePageShow(event) {
  if (!event.persisted) return;
  if (!animationFrame) updateTimeline();
  renderAll();
}

window.addEventListener("pagehide", handlePageHide);
window.addEventListener("pageshow", handlePageShow);

function markRuntimeReady() {
  document.body.dataset.runtimeReady = "true";
  const notice = $("startupNotice");
  if (notice) notice.hidden = true;
  updateControlAvailability();
  renderSupportState();
}

configureStaticControls();
renderPendingProjects();
renderAll();
setAudioStatus("off");
setPlaybackState(false, { quiet: true });
if (state.presetId) replaceQuery({ presetId: state.presetId });
else if (state.soundId) replaceQuery({ soundId: state.soundId });
updateTimeline();
markRuntimeReady();
