import {
  HAMBONE_DEFAULTS,
  HAMBONE_LIMITS,
  HAMBONE_PATTERNS,
  HAMBONE_PRESETS,
  HAMBONE_SOUNDS,
  HAMBONE_STEP_COUNT,
  HAMBONE_TRACT_SECTION_COUNT,
  HAMBONE_VELOCITIES,
  HAMBONE_VOICE_CHARACTERS,
  HAMBONE_VOICE_MODULATION_SOURCES,
  HAMBONE_VOICE_MODULATION_TARGETS,
  clamp,
  clonePattern,
  cycleStepVelocity,
  hamboneGeometry,
  hambonePattern,
  hambonePreset,
  hambonePoseForSound,
  hamboneSound,
  hamboneState,
  hamboneVoiceCharacter,
  mutateHamboneVoice,
  patternEventsAtStep,
  randomizeHamboneState,
  randomizePattern,
  sanitizeHamboneState,
  sanitizeHamboneVoice,
  sequenceStepIntervalSeconds,
} from "./src/hambone.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_SPECS = Object.freeze([
  { key: "lungPressure", format: formatPercent },
  { key: "lipTension", format: formatPercent },
  { key: "lipRounding", format: formatPercent },
  { key: "cheekVolume", format: formatPercent },
  { key: "cheekTension", format: formatPercent },
  { key: "tonguePosition", format: formatTonguePosition },
  { key: "tongueCurl", format: formatPercent },
  { key: "mouthOpening", format: formatPercent },
  { key: "tractLengthM", format: (value) => `${(value * 100).toFixed(1)} cm` },
  { key: "nasalMix", format: formatPercent },
  { key: "dooPitch", format: formatSemitones },
  { key: "earSpread", format: formatPercent },
  { key: "eyeDivergence", format: formatPercent },
  { key: "silliness", format: formatPercent },
  { key: "decay", format: formatPercent },
  { key: "humanize", format: formatPercent },
  { key: "tempo", format: (value) => `${Math.round(value)} BPM` },
  { key: "swing", format: formatPercent },
  { key: "level", format: formatPercent },
]);

let state = hamboneState("rubber-face");
let pattern = normalizePatternColumns(clonePattern(hambonePattern(state.patternId)));
let currentPatternId = state.patternId;
let sequenceLength = Math.min(32, HAMBONE_STEP_COUNT);
let voiceCount = 4;
let voiceSelectionMode = "round-robin";
let voiceCursor = 0;
let activeVoiceSlot = -1;
let voiceSlots = createDefaultVoiceSlots();
let audioContext = null;
let graph = null;
let startingAudio = false;
let sequencePlaying = false;
let schedulerTimer = 0;
let manualConfigurationResetTimer = 0;
let nextStepTime = 0;
let sequenceStep = 0;
let absoluteStep = 0;
let visibleStep = -1;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let hotspots = [];
let hands = [];
let toothGapGeometry = null;
const handPlacements = {
  left: { x: -0.62, y: 0.1 },
  right: { x: 0.62, y: 0.14 },
};
let pointerDrag = null;
let animationFrame = 0;
let visualQueue = [];
let soundAnimation = null;
let displayedPose = { ...state };
let lastDrawTime = performance.now();
let activeMouthSoundId = "";
let articulationTelemetryAvailable = false;
let articulationTelemetryAt = 0;
let lastTelemetryGestureSoundId = "";
let waveform = new Float32Array(1024);
let telemetry = {
  activeVoices: 0,
  queuedEvents: 0,
  lastSoundId: "",
  peak: 0,
  rms: 0,
};

function createDefaultVoiceSlots() {
  return HAMBONE_VOICE_CHARACTERS.slice(0, 8).map((character, index) => ({
    id: `voice-${index + 1}`,
    solo: false,
    assignment: "all",
    voice: sanitizeHamboneVoice({
      characterId: character.id,
      ...character.settings,
      modulation: {
        source: HAMBONE_VOICE_MODULATION_SOURCES[index % HAMBONE_VOICE_MODULATION_SOURCES.length],
        target: HAMBONE_VOICE_MODULATION_TARGETS[index % HAMBONE_VOICE_MODULATION_TARGETS.length],
        depth: 0.18 + (index % 4) * 0.08,
        rateHz: 2.4 + index * 0.53,
        phase: (index * 0.173) % 1,
      },
    }),
  }));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSemitones(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} st`;
}

function formatTonguePosition(value) {
  if (value < 0) return `${Math.round(Math.abs(value) * 100)}% past back`;
  if (value > 1) return `${Math.round((value - 1) * 100)}% past front`;
  return `${Math.round(value * 100)}% front`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function soundLevelIndex(value) {
  const amount = clamp(value);
  let best = 0;
  let distance = Infinity;
  HAMBONE_VELOCITIES.forEach((candidate, index) => {
    if (Math.abs(candidate - amount) < distance) {
      best = index;
      distance = Math.abs(candidate - amount);
    }
  });
  return best;
}

function normalizePatternColumns(source) {
  for (let step = 0; step < HAMBONE_STEP_COUNT; step += 1) {
    let winner = null;
    for (const sound of HAMBONE_SOUNDS) {
      const amount = Number(source?.[sound.id]?.[step]) || 0;
      if (amount > 0 && (!winner || amount > winner.amount)) winner = { id: sound.id, amount };
    }
    for (const sound of HAMBONE_SOUNDS) {
      if (source?.[sound.id]) source[sound.id][step] = sound.id === winner?.id ? winner.amount : 0;
    }
  }
  return source;
}

function clearStepExcept(step, soundId) {
  for (const sound of HAMBONE_SOUNDS) {
    if (sound.id !== soundId) pattern[sound.id][step] = 0;
  }
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").dataset.audioState = status;
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function audioConfiguration(overrides = null) {
  return overrides ? sanitizeHamboneState({ ...state, ...overrides }, state) : { ...state };
}

function postConfiguration(overrides = null) {
  graph?.sourceNode?.port.postMessage({
    type: "configure",
    configuration: audioConfiguration(overrides),
  });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL(
    "./src/hambone-processor.js?v=hambone-tract-20260829-4",
    import.meta.url,
  ));
  const sourceNode = new AudioWorkletNode(context, "hambone-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { configuration: audioConfiguration() },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = state.level;
  compressor.threshold.value = -12;
  compressor.knee.value = 16;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.0025;
  compressor.release.value = 0.16;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = (event) => {
    if (event.data?.type !== "telemetry") return;
    telemetry = { ...telemetry, ...event.data };
    if (
      Object.prototype.hasOwnProperty.call(event.data, "activeGesture")
      || Object.prototype.hasOwnProperty.call(event.data, "gestureProgress")
      || Object.prototype.hasOwnProperty.call(event.data, "lipDiameterCm")
    ) {
      articulationTelemetryAvailable = true;
      articulationTelemetryAt = performance.now();
    }
  };
  sourceNode.onprocessorerror = () => setAudioPresentation(
    "error",
    "The Hambone physical model stopped unexpectedly. Reload the page to reset it.",
  );
  return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
}

async function ensureAudio() {
  if (startingAudio) return false;
  if (!graph) {
    startingAudio = true;
    setAudioPresentation("starting");
    try {
      graph = await createAudioGraph();
      audioContext = graph.context;
    } catch (error) {
      console.error(error);
      setAudioPresentation("error", error?.message || "Unable to start Hambone audio.");
      startingAudio = false;
      return false;
    }
    startingAudio = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    postConfiguration();
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    stopSequence();
    graph.sourceNode.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    setAudioPresentation("off");
    announce("Hambone audio off");
    return;
  }
  if (await ensureAudio()) announce("Hambone audio on");
}

const VOICE_SOUND_IDS = new Set([
  "bop", "boop", "pff", "hee", "haw", "doo", "mwah", "drr", "burp",
  "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
]);
const TEMPO_STRETCH_SOUND_IDS = new Set([
  "pff", "whistle", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
]);

function flashSound(soundId, velocity = 1, voiceChoice = null) {
  const sound = hamboneSound(soundId);
  for (const element of document.querySelectorAll(`[data-sound-id="${sound.id}"]`)) {
    element.classList.add("is-hit");
    clearTimeout(element._hamboneFlashTimer);
    element._hamboneFlashTimer = setTimeout(
      () => element.classList.remove("is-hit"),
      70 + velocity * 90,
    );
  }
  if (voiceChoice?.slotIndex >= 0) {
    activeVoiceSlot = voiceChoice.slotIndex;
    const card = document.querySelector(`[data-voice-slot="${voiceChoice.slotIndex}"]`);
    card?.classList.add("is-active");
    clearTimeout(card?._hamboneVoiceFlashTimer);
    if (card) {
      card._hamboneVoiceFlashTimer = setTimeout(
        () => card.classList.remove("is-active"),
        140 + velocity * 180,
      );
    }
    $("soundReadout").textContent = `${sound.label} · ${voiceChoice.label}`;
  } else {
    activeVoiceSlot = -1;
    $("soundReadout").textContent = `${sound.label} · ${sound.subtitle}`;
  }
}

function seededVoiceRandom(seedValue) {
  let seed = (Math.trunc(Number(seedValue) || 0) ^ 0x766f6963) >>> 0;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };
}

function availableVoiceSlots(soundId = null) {
  const active = voiceSlots.slice(0, voiceCount);
  const soloed = active.filter((slot) => slot.solo);
  const candidates = soloed.length ? soloed : active;
  if (!soundId) return candidates;
  return candidates.filter((slot) => slot.assignment === "all" || slot.assignment === soundId);
}

function voiceChoiceForSound(soundId, seed = performance.now()) {
  if (!VOICE_SOUND_IDS.has(hamboneSound(soundId).id)) return null;
  const candidates = availableVoiceSlots(soundId);
  if (!candidates.length) return null;
  let slot = null;
  if (voiceSelectionMode === "random") {
    const draw = seededVoiceRandom(seed)();
    slot = candidates[Math.min(candidates.length - 1, Math.floor(draw * candidates.length))];
  } else {
    slot = candidates[voiceCursor % candidates.length];
    voiceCursor = (voiceCursor + 1) % Math.max(1, candidates.length);
  }
  const slotIndex = voiceSlots.indexOf(slot);
  const voice = sanitizeHamboneVoice(slot.voice);
  return {
    slotIndex,
    voice,
    label: hamboneVoiceCharacter(voice.characterId).label,
  };
}

function queueSoundVisual(
  soundId,
  velocity,
  delaySeconds = 0,
  step = null,
  configuration = null,
  voiceChoice = null,
) {
  visualQueue.push({
    type: "sound",
    soundId: hamboneSound(soundId).id,
    velocity: clamp(velocity, 0.01, 1),
    step,
    configuration,
    voiceChoice,
    due: performance.now() + Math.max(0, delaySeconds) * 1000,
  });
}

function postStrike(
  soundId,
  velocity = 1,
  delaySeconds = 0,
  step = null,
  configuration = null,
  voiceChoice = null,
) {
  if (!graph || audioContext?.state !== "running") return false;
  const boundedDelay = clamp(delaySeconds, 0, 2);
  const strikeConfiguration = configuration ? audioConfiguration(configuration) : null;
  graph.sourceNode.port.postMessage({
    type: "strike",
    soundId: hamboneSound(soundId).id,
    velocity: clamp(velocity, 0.01, 1),
    delaySeconds: boundedDelay,
    ...(strikeConfiguration ? { configuration: strikeConfiguration } : {}),
    ...(voiceChoice?.voice ? { voice: voiceChoice.voice } : {}),
  });
  queueSoundVisual(
    soundId,
    velocity,
    boundedDelay,
    step,
    strikeConfiguration,
    voiceChoice,
  );
  return true;
}

async function triggerSound(soundId, velocity = 1, configuration = null) {
  const sound = hamboneSound(soundId);
  if (!(await ensureAudio())) return false;
  const transientConfiguration = configuration
    ?? (sound.id === "slap" ? handStrikeConfiguration("left") : null)
    ?? (sound.id === "smack" ? handStrikeConfiguration("right") : null);
  const strikeConfiguration = transientConfiguration ?? state;
  const voiceChoice = voiceChoiceForSound(sound.id, performance.now());
  postStrike(sound.id, velocity, 0, null, strikeConfiguration, voiceChoice);
  clearTimeout(manualConfigurationResetTimer);
  if (transientConfiguration) {
    manualConfigurationResetTimer = setTimeout(() => {
      manualConfigurationResetTimer = 0;
      if (!sequencePlaying) postConfiguration();
    }, 720);
  }
  announce(`${sound.label}: ${sound.description}`);
  return true;
}

function deterministicHumanize(step, salt) {
  let value = ((step + 1) * 0x45d9f3b + (salt + 17) * 0x119de1f3) | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

function scheduleSequence() {
  if (!sequencePlaying || !graph || audioContext?.state !== "running") return;
  const lookaheadSeconds = 0.115;
  while (nextStepTime < audioContext.currentTime + lookaheadSeconds) {
    const step = sequenceStep % sequenceLength;
    const timeJitter = deterministicHumanize(absoluteStep, 5) * state.humanize * 0.014;
    const scheduledTime = Math.max(audioContext.currentTime + 0.004, nextStepTime + timeJitter);
    const delaySeconds = scheduledTime - audioContext.currentTime;
    const events = patternEventsAtStep(pattern, step);
    const event = events.reduce((winner, candidate) => (
      !winner || candidate.velocity > winner.velocity ? candidate : winner
    ), null);
    if (event) {
      const soundIndex = HAMBONE_SOUNDS.findIndex(({ id }) => id === event.soundId);
      const velocityMotion = 1 + deterministicHumanize(absoluteStep, soundIndex + 23)
        * state.humanize * 0.22;
      const voiceChoice = voiceChoiceForSound(event.soundId, absoluteStep * 131 + soundIndex);
      const strikeConfiguration = event.soundId === "slap"
        ? handStrikeConfiguration("left")
        : event.soundId === "smack"
          ? handStrikeConfiguration("right")
          : state;
      postStrike(
        event.soundId,
        event.velocity * velocityMotion,
        delaySeconds,
        step,
        strikeConfiguration,
        voiceChoice,
      );
    }
    visualQueue.push({
      type: "step",
      step,
      due: performance.now() + delaySeconds * 1000,
    });
    // Swing follows absolute time so odd sequence lengths do not produce two
    // consecutive long (or short) subdivisions at the loop boundary.
    nextStepTime += sequenceStepIntervalSeconds(state.tempo, state.swing, absoluteStep);
    sequenceStep = (sequenceStep + 1) % sequenceLength;
    absoluteStep += 1;
  }
}

async function startSequence({ restart = false } = {}) {
  if (!(await ensureAudio())) return;
  if (restart || !sequencePlaying) {
    sequenceStep = 0;
    absoluteStep = 0;
    nextStepTime = audioContext.currentTime + 0.055;
  }
  sequencePlaying = true;
  $("playButton").setAttribute("aria-pressed", "true");
  $("playLabel").textContent = "Pause face";
  $("playState").textContent = `${Math.round(state.tempo)} BPM · playing`;
  clearInterval(schedulerTimer);
  scheduleSequence();
  schedulerTimer = setInterval(scheduleSequence, 24);
  announce("Hambone sequence playing");
}

function stopSequence({ announceState = true } = {}) {
  if (!sequencePlaying && !schedulerTimer) return;
  sequencePlaying = false;
  clearInterval(schedulerTimer);
  clearTimeout(manualConfigurationResetTimer);
  manualConfigurationResetTimer = 0;
  schedulerTimer = 0;
  visualQueue = visualQueue.filter(({ type }) => type !== "step");
  postConfiguration();
  visibleStep = -1;
  updateGridPlayhead();
  $("playButton").setAttribute("aria-pressed", "false");
  $("playLabel").textContent = "Play face";
  $("playState").textContent = `space · ${sequenceLength} steps`;
  if (announceState) announce("Hambone sequence paused");
}

function toggleSequence() {
  if (sequencePlaying) stopSequence();
  else startSequence({ restart: true });
}

function restartSequence() {
  sequenceStep = 0;
  absoluteStep = 0;
  visibleStep = -1;
  updateGridPlayhead();
  if (sequencePlaying && audioContext) {
    visualQueue = visualQueue.filter(({ type }) => type !== "step");
    nextStepTime = audioContext.currentTime + 0.05;
    scheduleSequence();
  }
  announce("Sequence restarted at step one");
}

function setCurrentPattern(id, { announceState = true } = {}) {
  const preset = hambonePattern(id);
  pattern = normalizePatternColumns(clonePattern(preset));
  currentPatternId = preset.id;
  state = sanitizeHamboneState({ ...state, patternId: preset.id }, state);
  $("patternSelect").value = preset.id;
  renderPattern();
  if (announceState) announce(`${preset.label} pattern loaded`);
}

function markPatternCustom() {
  currentPatternId = "custom";
  $("patternSelect").value = "custom";
}

function scatterPattern() {
  pattern = normalizePatternColumns(randomizePattern(Math.random, 0.22 + state.silliness * 0.13));
  markPatternCustom();
  renderPattern();
  announce("A new full-face pattern was scattered across the grid");
}

function clearPattern() {
  pattern = clonePattern({});
  markPatternCustom();
  renderPattern();
  announce("Sequence grid cleared");
}

function cellLabel(sound, step, value) {
  const strength = ["off", "ghost", "medium", "accent"][soundLevelIndex(value)];
  return `${sound.label}, step ${step + 1}, ${strength}. One sound may occupy this step.`;
}

function renderCell(button, value) {
  const sound = hamboneSound(button.dataset.soundId);
  const step = Number(button.dataset.step);
  const level = soundLevelIndex(value);
  button.dataset.level = String(level);
  button.setAttribute("aria-pressed", String(level > 0));
  button.setAttribute("aria-label", cellLabel(sound, step, value));
  button.title = cellLabel(sound, step, value);
}

function updateGridPlayhead() {
  for (const cell of $("sequenceGrid").querySelectorAll(".hambone-step-cell")) {
    cell.classList.toggle("is-current", Number(cell.dataset.step) === visibleStep);
  }
  for (const heading of $("sequenceGrid").querySelectorAll(".hambone-step-number")) {
    heading.classList.toggle("is-current", Number(heading.dataset.step) === visibleStep);
  }
}

function renderPattern() {
  for (const button of $("sequenceGrid").querySelectorAll(".hambone-step-cell")) {
    renderCell(button, pattern[button.dataset.soundId][Number(button.dataset.step)]);
  }
  updateGridPlayhead();
}

function focusGridCell(row, step) {
  const safeRow = (row + HAMBONE_SOUNDS.length) % HAMBONE_SOUNDS.length;
  const safeStep = (step + sequenceLength) % sequenceLength;
  const target = $("sequenceGrid").querySelector(
    `.hambone-step-cell[data-row="${safeRow}"][data-step="${safeStep}"]`,
  );
  if (!target) return;
  for (const cell of $("sequenceGrid").querySelectorAll(".hambone-step-cell")) cell.tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
}

function handleGridKeydown(event) {
  const button = event.currentTarget;
  const row = Number(button.dataset.row);
  const step = Number(button.dataset.step);
  let target = null;
  if (event.key === "ArrowLeft") target = [row, step - 1];
  if (event.key === "ArrowRight") target = [row, step + 1];
  if (event.key === "ArrowUp") target = [row - 1, step];
  if (event.key === "ArrowDown") target = [row + 1, step];
  if (event.key === "Home") target = [row, 0];
  if (event.key === "End") target = [row, sequenceLength - 1];
  if (!target) return;
  event.preventDefault();
  focusGridCell(target[0], target[1]);
}

function buildSequenceGrid() {
  const grid = $("sequenceGrid");
  grid.replaceChildren();
  grid.style.setProperty("--hambone-sequence-steps", String(sequenceLength));
  grid.style.setProperty("--hambone-sequence-sounds", String(HAMBONE_SOUNDS.length));
  grid.setAttribute("aria-rowcount", String(HAMBONE_SOUNDS.length));
  grid.setAttribute("aria-colcount", String(sequenceLength));
  const headerRow = document.createElement("div");
  headerRow.className = "hambone-grid-header-row";
  headerRow.setAttribute("role", "row");
  headerRow.style.display = "contents";
  const corner = document.createElement("span");
  corner.className = "hambone-grid-corner";
  corner.setAttribute("aria-hidden", "true");
  corner.textContent = "POSE / STEP";
  headerRow.append(corner);
  for (let step = 0; step < sequenceLength; step += 1) {
    const heading = document.createElement("span");
    heading.className = "hambone-step-number";
    heading.setAttribute("role", "columnheader");
    heading.dataset.step = String(step);
    heading.textContent = String(step + 1).padStart(2, "0");
    headerRow.append(heading);
  }
  grid.append(headerRow);

  HAMBONE_SOUNDS.forEach((sound, rowIndex) => {
    const row = document.createElement("div");
    row.className = "hambone-grid-row";
    row.setAttribute("role", "row");
    row.style.display = "contents";
    const trigger = document.createElement("button");
    trigger.className = "hambone-row-trigger";
    trigger.type = "button";
    trigger.dataset.soundId = sound.id;
    trigger.setAttribute("role", "rowheader");
    trigger.setAttribute("aria-label", `Move the face to ${sound.label}: ${sound.subtitle}`);
    trigger.style.setProperty("--row-color", sound.color);
    trigger.innerHTML = `<b>${sound.label}</b><small>${sound.subtitle}</small>`;
    trigger.addEventListener("click", () => triggerSound(sound.id, 0.88));
    row.append(trigger);

    for (let step = 0; step < sequenceLength; step += 1) {
      const cell = document.createElement("button");
      cell.className = "hambone-step-cell";
      cell.type = "button";
      cell.dataset.soundId = sound.id;
      cell.dataset.row = String(rowIndex);
      cell.dataset.step = String(step);
      cell.setAttribute("role", "gridcell");
      cell.style.setProperty("--row-color", sound.color);
      cell.tabIndex = rowIndex === 0 && step === 0 ? 0 : -1;
      cell.addEventListener("click", () => {
        const next = cycleStepVelocity(pattern[sound.id][step]);
        if (next > 0) clearStepExcept(step, sound.id);
        pattern[sound.id][step] = next;
        markPatternCustom();
        renderPattern();
        if (next > 0) triggerSound(sound.id, next);
        announce(cellLabel(sound, step, next));
      });
      cell.addEventListener("keydown", handleGridKeydown);
      row.append(cell);
    }
    grid.append(row);
  });
  renderPattern();
}

function setSequenceLength(value, { announceState = true } = {}) {
  sequenceLength = clamp(
    Math.round(Number(value) || 32),
    1,
    HAMBONE_STEP_COUNT,
  );
  stopSequence({ announceState: false });
  sequenceStep = 0;
  absoluteStep = 0;
  visibleStep = -1;
  const control = $("sequenceLength");
  if (control) control.value = String(sequenceLength);
  const numberControl = $("sequenceLengthNumber");
  if (numberControl) numberControl.value = String(sequenceLength);
  const output = $("sequenceLengthOut");
  if (output) {
    output.value = `${sequenceLength} steps`;
    output.textContent = output.value;
  }
  buildSequenceGrid();
  $("sequenceGrid").setAttribute(
    "aria-label",
    `${HAMBONE_SOUNDS.length} Hambone sounds by ${sequenceLength} sequence steps. Only one sound can occupy each step.`,
  );
  $("playState").textContent = `space · ${sequenceLength} steps`;
  if (announceState) announce(`Sequence length: ${sequenceLength} steps`);
}

function buildPadGrid() {
  const padGrid = $("padGrid");
  if (!padGrid) return;
  const pads = HAMBONE_SOUNDS.map((sound, index) => {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const subtitle = document.createElement("small");
    const key = document.createElement("kbd");
    button.className = "hambone-pad";
    button.type = "button";
    button.dataset.soundId = sound.id;
    button.dataset.padIndex = String(index);
    button.style.setProperty("--pad-color", sound.color);
    button.setAttribute("aria-label", `${sound.label}: ${sound.subtitle}. Keyboard ${sound.key}.`);
    label.textContent = sound.label;
    subtitle.textContent = sound.subtitle;
    key.textContent = sound.key.toUpperCase();
    button.append(label, subtitle, key);
    return button;
  });
  padGrid.replaceChildren(...pads);
}

function makeVoiceOption(value, label, selectedValue) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = value === selectedValue;
  return option;
}

function voiceParameterSummary(voice) {
  const pitch = Math.round(voice.pitchOffsetSemitones);
  return `${pitch >= 0 ? "+" : ""}${pitch} st · ${voice.vibratoRateHz.toFixed(1)} Hz · ${Math.round(voice.roughness * 100)}% rough`;
}

function voiceModulationLabel(value) {
  const labels = {
    sine: "Sine LFO",
    triangle: "Triangle LFO",
    random: "Organic random",
    pitch: "Fold pitch",
    vibratoDepth: "Vibrato depth",
    breathiness: "Breathiness",
    roughness: "Fold roughness",
    tractScale: "Tract length",
  };
  return labels[value] ?? value;
}

function setVoiceSlotCharacter(slot, characterId) {
  const character = hamboneVoiceCharacter(characterId);
  slot.voice = sanitizeHamboneVoice({
    characterId: character.id,
    ...character.settings,
    modulation: slot.voice.modulation,
  });
}

function setVoiceSlotModulation(slot, updates) {
  slot.voice = sanitizeHamboneVoice({
    ...slot.voice,
    modulation: { ...slot.voice.modulation, ...updates },
  });
}

function buildVoiceRack({ preserveScroll = true } = {}) {
  const rack = $("voiceRack");
  if (!rack) return;
  const previousScroll = preserveScroll ? rack.scrollTop : 0;
  const cards = voiceSlots.slice(0, voiceCount).map((slot, index) => {
    const character = hamboneVoiceCharacter(slot.voice.characterId);
    const modulation = slot.voice.modulation;
    const card = document.createElement("article");
    card.className = "hambone-voice-card";
    card.dataset.voiceSlot = String(index);
    card.dataset.solo = String(slot.solo);
    card.setAttribute("role", "listitem");

    const header = document.createElement("header");
    header.className = "hambone-voice-card-header";
    const name = document.createElement("b");
    name.className = "hambone-voice-name";
    name.textContent = `${String(index + 1).padStart(2, "0")} · ${character.label}`;
    const summary = document.createElement("span");
    summary.textContent = voiceParameterSummary(slot.voice);
    header.append(name, summary);

    const controls = document.createElement("div");
    controls.className = "hambone-voice-card-controls";
    const characterSelect = document.createElement("select");
    characterSelect.className = "hambone-voice-character-select";
    characterSelect.setAttribute("aria-label", `Voice ${index + 1} character`);
    characterSelect.replaceChildren(...HAMBONE_VOICE_CHARACTERS.map((candidate) => (
      makeVoiceOption(candidate.id, candidate.label, character.id)
    )));
    characterSelect.addEventListener("change", () => {
      setVoiceSlotCharacter(slot, characterSelect.value);
      buildVoiceRack();
      announce(`Voice ${index + 1}: ${hamboneVoiceCharacter(characterSelect.value).label}`);
    });
    const soloButton = document.createElement("button");
    soloButton.className = "hambone-voice-solo";
    soloButton.type = "button";
    soloButton.textContent = "SOLO";
    soloButton.setAttribute("aria-pressed", String(slot.solo));
    soloButton.setAttribute("aria-label", `Solo voice ${index + 1}`);
    soloButton.addEventListener("click", () => {
      slot.solo = !slot.solo;
      voiceCursor = 0;
      buildVoiceRack();
      announce(`Voice ${index + 1} solo ${slot.solo ? "on" : "off"}`);
    });
    const mutateButton = document.createElement("button");
    mutateButton.className = "hambone-voice-mutate";
    mutateButton.type = "button";
    mutateButton.textContent = "MUT";
    mutateButton.setAttribute("aria-label", `Mutate voice ${index + 1}`);
    mutateButton.addEventListener("click", () => {
      slot.voice = mutateHamboneVoice(slot.voice, Math.random, 0.48);
      buildVoiceRack();
      announce(`Voice ${index + 1} mutated`);
    });
    controls.append(characterSelect, soloButton, mutateButton);

    const assignmentLabel = document.createElement("label");
    assignmentLabel.className = "hambone-voice-assignment";
    const assignmentText = document.createElement("span");
    assignmentText.textContent = "Assign";
    const assignmentSelect = document.createElement("select");
    assignmentSelect.setAttribute("aria-label", `Voice ${index + 1} sound assignment`);
    assignmentSelect.replaceChildren(
      makeVoiceOption("all", "All vocal gestures", slot.assignment),
      ...HAMBONE_SOUNDS
        .filter((sound) => VOICE_SOUND_IDS.has(sound.id))
        .map((sound) => makeVoiceOption(sound.id, sound.label, slot.assignment)),
    );
    assignmentSelect.addEventListener("change", () => {
      slot.assignment = assignmentSelect.value;
      voiceCursor = 0;
      announce(`Voice ${index + 1} assigned to ${assignmentSelect.selectedOptions[0].textContent}`);
    });
    assignmentLabel.append(assignmentText, assignmentSelect);

    const modBlock = document.createElement("div");
    modBlock.className = "hambone-voice-modulation";
    const modMatrix = document.createElement("div");
    modMatrix.className = "hambone-voice-mod-matrix";
    const sourceSelect = document.createElement("select");
    sourceSelect.className = "hambone-voice-mod-source";
    sourceSelect.setAttribute("aria-label", `Voice ${index + 1} modulation source`);
    sourceSelect.replaceChildren(...HAMBONE_VOICE_MODULATION_SOURCES.map((source) => (
      makeVoiceOption(source, voiceModulationLabel(source), modulation.source)
    )));
    sourceSelect.addEventListener("change", () => {
      setVoiceSlotModulation(slot, { source: sourceSelect.value });
      announce(`Voice ${index + 1} modulator: ${voiceModulationLabel(sourceSelect.value)}`);
    });
    const targetSelect = document.createElement("select");
    targetSelect.className = "hambone-voice-mod-target";
    targetSelect.setAttribute("aria-label", `Voice ${index + 1} modulation target`);
    targetSelect.replaceChildren(...HAMBONE_VOICE_MODULATION_TARGETS.map((target) => (
      makeVoiceOption(target, voiceModulationLabel(target), modulation.target)
    )));
    targetSelect.addEventListener("change", () => {
      setVoiceSlotModulation(slot, { target: targetSelect.value });
      announce(`Voice ${index + 1} modulates ${voiceModulationLabel(targetSelect.value)}`);
    });
    modMatrix.append(sourceSelect, targetSelect);

    const depthLabel = document.createElement("label");
    depthLabel.className = "hambone-voice-mod-depth-wrap";
    const depthText = document.createElement("span");
    depthText.textContent = "Depth";
    const depthInput = document.createElement("input");
    depthInput.className = "hambone-voice-mod-depth";
    depthInput.type = "range";
    depthInput.min = "0";
    depthInput.max = "1";
    depthInput.step = "0.01";
    depthInput.value = String(modulation.depth);
    depthInput.setAttribute("aria-label", `Voice ${index + 1} modulation depth`);
    const depthOutput = document.createElement("output");
    depthOutput.className = "hambone-voice-mod-depth-out";
    depthOutput.value = formatPercent(modulation.depth);
    depthOutput.textContent = depthOutput.value;
    depthInput.addEventListener("input", () => {
      setVoiceSlotModulation(slot, { depth: Number(depthInput.value) });
      depthOutput.value = formatPercent(slot.voice.modulation.depth);
      depthOutput.textContent = depthOutput.value;
    });
    depthInput.addEventListener("change", () => announce(
      `Voice ${index + 1} modulation depth: ${formatPercent(slot.voice.modulation.depth)}`,
    ));
    depthLabel.append(depthText, depthInput, depthOutput);

    const rateLabel = document.createElement("label");
    rateLabel.className = "hambone-voice-mod-rate-wrap";
    const rateText = document.createElement("span");
    rateText.textContent = "Rate";
    const rateInput = document.createElement("input");
    rateInput.className = "hambone-voice-mod-rate";
    rateInput.type = "range";
    rateInput.min = "0.05";
    rateInput.max = "20";
    rateInput.step = "0.05";
    rateInput.value = String(modulation.rateHz);
    rateInput.setAttribute("aria-label", `Voice ${index + 1} modulation rate`);
    const rateOutput = document.createElement("output");
    rateOutput.className = "hambone-voice-mod-rate-out";
    rateOutput.value = `${modulation.rateHz.toFixed(1)} Hz`;
    rateOutput.textContent = rateOutput.value;
    rateInput.addEventListener("input", () => {
      setVoiceSlotModulation(slot, { rateHz: Number(rateInput.value) });
      rateOutput.value = `${slot.voice.modulation.rateHz.toFixed(1)} Hz`;
      rateOutput.textContent = rateOutput.value;
    });
    rateInput.addEventListener("change", () => announce(
      `Voice ${index + 1} modulation rate: ${slot.voice.modulation.rateHz.toFixed(1)} hertz`,
    ));
    rateLabel.append(rateText, rateInput, rateOutput);
    modBlock.append(modMatrix, depthLabel, rateLabel);
    card.append(header, controls, assignmentLabel, modBlock);
    return card;
  });
  rack.replaceChildren(...cards);
  rack.scrollTop = previousScroll;
}

function updateHud(pose = state) {
  const geometry = hamboneGeometry(pose);
  const livePressure = Number.isFinite(Number(pose.lungPressure))
    ? Number(pose.lungPressure)
    : state.lungPressure;
  $("cavityReadout").textContent = `${Math.round(geometry.cheekVolumeMl)} ml · ${Math.round(geometry.cavityFrequencyHz)} Hz`;
  $("tractReadout").textContent = `${(pose.tractLengthM * 100).toFixed(1)} cm`;
  $("pressureReadout").textContent = formatPercent(livePressure);
  const activeSlot = activeVoiceSlot >= 0 ? voiceSlots[activeVoiceSlot] : null;
  const activeCharacter = activeSlot
    ? hamboneVoiceCharacter(activeSlot.voice.characterId)
    : null;
  $("voicesReadout").textContent = activeMouthSoundId
    ? activeCharacter
      ? `1 · ${activeCharacter.label}`
      : `1 · ${hamboneSound(activeMouthSoundId).label}`
    : `${voiceCount} ready · 1 at a time`;
  $("pressureSummary").textContent = `${formatPercent(livePressure)} pressure · ${pose.lipTension < 0.4 ? "soft" : pose.lipTension > 0.7 ? "tight" : "springy"} lips`;
  $("faceSummary").textContent = `${formatPercent(pose.cheekVolume)} puff · ${formatPercent(pose.cheekTension)} skin`;
  $("cavitySummary").textContent = `${(pose.tractLengthM * 100).toFixed(1)} cm · ${pose.nasalMix < 0.22 ? "mostly oral" : pose.nasalMix > 0.62 ? "nose open" : "oral + nasal"}`;
  if (sequencePlaying) $("playState").textContent = `${Math.round(state.tempo)} BPM · step ${visibleStep + 1 || 1}`;
}

function syncControls() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    const output = $(`${spec.key}Out`);
    if (!input || !output) continue;
    input.value = String(state[spec.key]);
    output.value = spec.format(state[spec.key]);
    output.textContent = output.value;
    updateRangeFill(input);
  }
  graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  updateHud();
}

function syncControlLimits() {
  for (const [key, limits] of Object.entries(HAMBONE_LIMITS)) {
    const input = $(key);
    if (!input || input.type !== "range") continue;
    input.min = String(limits[0]);
    input.max = String(limits[1]);
  }
}

function setStateValue(key, value, { fromCanvas = false } = {}) {
  state = sanitizeHamboneState({ ...state, [key]: value }, state);
  const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
  const input = $(key);
  const output = $(`${key}Out`);
  if (input) {
    input.value = String(state[key]);
    updateRangeFill(input);
  }
  if (output && spec) {
    output.value = spec.format(state[key]);
    output.textContent = output.value;
  }
  if (key === "level") {
    graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  } else {
    postConfiguration();
  }
  updateHud();
  if (fromCanvas && spec) announce(`${input?.previousElementSibling?.querySelector("b")?.textContent ?? key}: ${spec.format(state[key])}`);
}

function setPreset(id, { announceState = true } = {}) {
  const preset = hambonePreset(id);
  const transport = {
    tempo: state.tempo,
    swing: state.swing,
    humanize: state.humanize,
    level: state.level,
  };
  state = hamboneState(preset.id, transport);
  $("presetSelect").value = preset.id;
  $("presetDescription").textContent = preset.description;
  syncControls();
  postConfiguration();
  if (announceState) announce(`${preset.label} physical face loaded`);
}

function randomizeFace() {
  state = randomizeHamboneState(state);
  $("presetDescription").textContent = "A one-off mouth mutation: pressure, tissue, tongue, and cavity moved anywhere from human-ish to gleefully impossible.";
  syncControls();
  postConfiguration();
  announce("Hambone face anatomy randomized");
}

function resetAll() {
  stopSequence({ announceState: false });
  clearTimeout(manualConfigurationResetTimer);
  manualConfigurationResetTimer = 0;
  state = { ...HAMBONE_DEFAULTS };
  setPreset(HAMBONE_DEFAULTS.presetId, { announceState: false });
  setCurrentPattern(HAMBONE_DEFAULTS.patternId, { announceState: false });
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  soundAnimation = null;
  displayedPose = { ...state };
  activeMouthSoundId = "";
  activeVoiceSlot = -1;
  voiceCount = 4;
  voiceSelectionMode = "round-robin";
  voiceCursor = 0;
  voiceSlots = createDefaultVoiceSlots();
  if ($("voiceCount")) $("voiceCount").value = String(voiceCount);
  if ($("voiceCountOut")) {
    $("voiceCountOut").value = String(voiceCount);
    $("voiceCountOut").textContent = String(voiceCount);
  }
  if ($("voiceSelectionMode")) $("voiceSelectionMode").value = "roundRobin";
  buildVoiceRack({ preserveScroll: false });
  Object.assign(handPlacements.left, { x: -0.62, y: 0.1 });
  Object.assign(handPlacements.right, { x: 0.62, y: 0.14 });
  lastTelemetryGestureSoundId = "";
  telemetry = { ...telemetry, activeGesture: false, tractPressure: 0 };
  visualQueue = [];
  visibleStep = -1;
  updateGridPlayhead();
  announce("Hambone face and sequence reset");
}

function populateSelects() {
  $("presetSelect").replaceChildren(...HAMBONE_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));
  const patternOptions = HAMBONE_PATTERNS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  });
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom grid";
  custom.disabled = true;
  $("patternSelect").replaceChildren(...patternOptions, custom);
  $("presetSelect").value = state.presetId;
  $("patternSelect").value = currentPatternId;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function faceLayout(pose = state) {
  // Keep enough room for the title, but let the mutable face own the stage.
  // The old 21% reservation made the physical mouth read like a small diagram.
  const headingClearance = cssWidth > 720 ? Math.min(158, cssWidth * 0.15) : 0;
  const availableWidth = Math.max(220, cssWidth - headingClearance);
  const cx = headingClearance + availableWidth * (cssWidth > 720 ? 0.54 : 0.5);
  const cy = cssHeight * (cssWidth <= 680 ? 0.51 : 0.49);
  const tractWarp = clamp((pose.tractLengthM - 0.165) / 0.18, -0.72, 1.35);
  const widthScale = cssWidth > 720 ? 0.41 : 0.405;
  const ry = Math.min(cssHeight * 0.465, availableWidth * widthScale)
    * clamp(1 + tractWarp * 0.12, 0.72, 1.2);
  const rx = ry * clamp(0.76 + pose.cheekVolume * 0.25 - tractWarp * 0.05, 0.48, 1.48);
  const mouthY = cy + ry * 0.29;
  // A nonlinear jaw map keeps bilabial closures tight while letting the
  // ordinary human pose open into an outsized clown resonator.
  const opening = ry * clamp(
    0.018 + Math.pow(Math.max(0, pose.mouthOpening), 0.78) * 0.3,
    0.012,
    0.52,
  );
  return { cx, cy, rx, ry, mouthY, opening };
}

function telemetryNumber(key, fallback = Number.NaN) {
  const value = Number(telemetry[key]);
  return Number.isFinite(value) ? value : fallback;
}

function knownSoundId(id) {
  return HAMBONE_SOUNDS.some((sound) => sound.id === id) ? id : "";
}

function physicalTelemetryStatus(now) {
  if (!articulationTelemetryAvailable || now - articulationTelemetryAt > 500) return null;
  const soundId = knownSoundId(telemetry.lastSoundId);
  const active = Boolean(telemetry.activeGesture) && Boolean(soundId);
  const progress = clamp(telemetryNumber("gestureProgress", 0));
  const velocity = clamp(telemetryNumber("velocity", 1), 0.01, 1);
  const reportedAmount = telemetryNumber("gestureAmount");
  const fallbackAmount = Math.sin(Math.PI * progress);
  return {
    active,
    soundId,
    progress,
    velocity,
    amount: clamp(
      Math.abs(Number.isFinite(reportedAmount) ? reportedAmount : fallbackAmount)
        * (0.55 + velocity * 0.45),
    ),
  };
}

function limitedPoseValue(key, value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const limits = HAMBONE_LIMITS[key];
  return limits ? clamp(value, limits[0], limits[1]) : value;
}

function physicalTelemetryPose(articulation, basePose = state) {
  const pose = { ...basePose };
  const pressure = Math.abs(telemetryNumber("tractPressure", pose.lungPressure));
  const mouthOpening = telemetryNumber("mouthOpening");
  const tonguePosition = telemetryNumber("tonguePosition");
  const tongueCurl = telemetryNumber("tongueCurl");
  const velumOpening = telemetryNumber("velumOpening");
  const dooPitch = telemetryNumber("dooPitch");
  const earSpread = telemetryNumber("earSpread");
  const eyeDivergence = telemetryNumber("eyeDivergence");
  const cheekDisplacement = telemetryNumber("cheekDisplacement", 0);
  const lipDiameterCm = Math.max(0, telemetryNumber("lipDiameterCm", Number.NaN));
  const constrictionIndex = telemetryNumber("constrictionIndex");
  const oralSectionCount = Math.max(
    2,
    Math.round(telemetryNumber("oralSectionCount", HAMBONE_TRACT_SECTION_COUNT)),
  );
  const constrictionDiameterCm = Math.max(
    0,
    telemetryNumber("constrictionDiameterCm", Number.NaN),
  );
  const normalizedConstriction = Number.isFinite(constrictionIndex)
    ? clamp(
      constrictionIndex > 1.5
        ? constrictionIndex / Math.max(1, oralSectionCount - 1)
        : constrictionIndex,
    )
    : Number.NaN;
  const contact = Number.isFinite(constrictionDiameterCm)
    ? 1 - clamp(constrictionDiameterCm / 1.5)
    : 0;

  pose.lungPressure = limitedPoseValue("lungPressure", pressure, pose.lungPressure);
  pose.mouthOpening = limitedPoseValue("mouthOpening", mouthOpening, pose.mouthOpening);
  pose.tonguePosition = limitedPoseValue(
    "tonguePosition",
    tonguePosition,
    Number.isFinite(normalizedConstriction)
      ? normalizedConstriction * 1.25 - 0.12
      : pose.tonguePosition,
  );
  pose.tongueCurl = limitedPoseValue(
    "tongueCurl",
    Number.isFinite(tongueCurl) ? tongueCurl + contact * 0.12 : pose.tongueCurl + contact * 0.28,
    pose.tongueCurl,
  );
  pose.nasalMix = limitedPoseValue("nasalMix", velumOpening, pose.nasalMix);
  pose.dooPitch = limitedPoseValue("dooPitch", dooPitch, pose.dooPitch);
  pose.earSpread = limitedPoseValue("earSpread", earSpread, pose.earSpread);
  pose.eyeDivergence = limitedPoseValue("eyeDivergence", eyeDivergence, pose.eyeDivergence);
  pose.cheekVolume = limitedPoseValue(
    "cheekVolume",
    pose.cheekVolume + cheekDisplacement,
    pose.cheekVolume,
  );
  pose.cheekTension = limitedPoseValue(
    "cheekTension",
    pose.cheekTension + Math.abs(cheekDisplacement) * 0.16,
    pose.cheekTension,
  );

  if (Number.isFinite(lipDiameterCm)) {
    const lipAperture = clamp(lipDiameterCm / 3.2, 0, 1.4);
    pose.lipRounding = limitedPoseValue(
      "lipRounding",
      pose.lipRounding + (0.52 - lipAperture) * 0.52,
      pose.lipRounding,
    );
    pose.lipDiameterCm = lipDiameterCm;
  }
  pose.constrictionIndex = constrictionIndex;
  pose.constrictionDiameterCm = constrictionDiameterCm;
  pose.gestureProgress = articulation.progress;
  pose.tractPressure = pressure;
  pose.velumOpening = velumOpening;
  pose.cheekDisplacement = cheekDisplacement;
  return pose;
}

function activeMotion(now, physicalStatus = physicalTelemetryStatus(now)) {
  const amounts = Object.fromEntries(HAMBONE_SOUNDS.map(({ id }) => [id, 0]));
  if (physicalStatus) {
    // A fresh worklet report is the single source of truth: never combine its
    // mouth with the timer-based fallback animation.
    soundAnimation = null;
    if (!physicalStatus.active) {
      if (lastTelemetryGestureSoundId) $("soundReadout").textContent = "resting pose";
      activeMouthSoundId = "";
      activeVoiceSlot = -1;
      lastTelemetryGestureSoundId = "";
      return amounts;
    }
    activeMouthSoundId = physicalStatus.soundId;
    amounts[physicalStatus.soundId] = physicalStatus.amount;
    if (lastTelemetryGestureSoundId !== physicalStatus.soundId) {
      const slot = voiceSlots[activeVoiceSlot];
      flashSound(
        physicalStatus.soundId,
        physicalStatus.velocity,
        slot ? {
          slotIndex: activeVoiceSlot,
          label: hamboneVoiceCharacter(slot.voice.characterId).label,
        } : null,
      );
      lastTelemetryGestureSoundId = physicalStatus.soundId;
    }
    return amounts;
  }
  if (soundAnimation && now - soundAnimation.start >= soundAnimation.duration) {
    soundAnimation = null;
    activeVoiceSlot = -1;
    $("soundReadout").textContent = "resting pose";
  }
  const animation = soundAnimation;
  if (!animation) activeMouthSoundId = "";
  if (animation) {
    const phase = clamp((now - animation.start) / animation.duration);
    let envelope = Math.sin(Math.PI * phase);
    if (animation.soundId === "shh") {
      const burst = Math.min(1, phase * 12) * Math.pow(1 - phase, 0.72);
      envelope = burst * (0.78 + Math.sin(phase * 45) * 0.18);
    }
    if (animation.soundId === "shack") envelope = Math.max(
      Math.sin(Math.PI * Math.min(1, phase * 2.2)) * 0.55,
      Math.exp(-Math.abs(phase - 0.48) * 19),
    );
    if (animation.soundId === "pff") envelope *= 0.62 + Math.sin(phase * 44) * 0.28;
    if (animation.soundId === "whistle") {
      const attack = Math.min(1, phase * 13);
      const release = Math.min(1, (1 - phase) * 6);
      envelope = attack * release * (0.9 + Math.sin(phase * 54) * 0.06);
    }
    if (animation.soundId === "kick") envelope = Math.exp(-phase * 6.2);
    if (animation.soundId === "slap" || animation.soundId === "smack") {
      // Show the whole trip into and back out of the cheek. The acoustic
      // contact remains an impulse, but the hand is readable at a glance.
      envelope = Math.pow(Math.sin(Math.PI * phase), 0.72);
    }
    if (animation.soundId === "hee") envelope *= 0.74 + Math.sin(phase * 19) * 0.16;
    if (animation.soundId === "haw") envelope *= 0.8 + Math.sin(phase * 14) * 0.12;
    if (animation.soundId === "doo") envelope *= 0.88 + Math.sin(phase * 22) * 0.08;
    if (animation.soundId === "mwah") envelope *= 0.62 + phase * 0.55;
    if (animation.soundId === "drr") envelope *= 0.68 + Math.sin(phase * 58) * 0.29;
    if (animation.soundId === "burp") envelope *= 0.58
      + Math.sin(phase * 23 + Math.sin(phase * 11) * 2.1) * 0.24;
    if (["aah", "ooh", "wail", "holler", "hum"].includes(animation.soundId)) {
      const rates = { aah: 31, ooh: 28, wail: 39, holler: 24, hum: 33 };
      const depths = { aah: 0.08, ooh: 0.1, wail: 0.2, holler: 0.07, hum: 0.12 };
      envelope *= 0.82 + Math.sin(phase * rates[animation.soundId]) * depths[animation.soundId];
    }
    if (animation.soundId === "yodel") envelope *= 0.72
      + (Math.sin(phase * 26) > -0.12 ? 0.22 : -0.12);
    if (animation.soundId === "growl") envelope *= 0.68
      + Math.sin(phase * 47 + Math.sin(phase * 13) * 2.4) * 0.26;
    if (animation.soundId === "rattle") envelope *= 0.64
      + Math.sin(phase * 71 + Math.sin(phase * 19)) * 0.3;
    amounts[animation.soundId] = envelope * animation.velocity;
  }
  return amounts;
}

function flushVisualQueue(now) {
  const waiting = [];
  for (const event of visualQueue) {
    if (event.due > now + 2) {
      waiting.push(event);
      continue;
    }
    if (event.type === "step") {
      visibleStep = event.step;
      updateGridPlayhead();
      continue;
    }
    const sound = hamboneSound(event.soundId);
    const durations = {
      bop: 210,
      boop: 300,
      pop: 190,
      tlik: 150,
      shh: 250,
      shack: 340,
      slap: 270,
      pff: 520,
      whistle: 1080,
      kick: 360,
      smack: 285,
      hee: 430,
      haw: 440,
      doo: 390,
      mwah: 410,
      drr: 470,
      burp: 620,
      aah: 760,
      ooh: 780,
      wail: 920,
      yodel: 820,
      growl: 840,
      holler: 720,
      hum: 760,
      rattle: 780,
    };
    const visualTempoScale = TEMPO_STRETCH_SOUND_IDS.has(sound.id)
      ? clamp(Math.sqrt(118 / state.tempo), 0.68, 1.8)
      : 1;
    soundAnimation = {
      soundId: sound.id,
      velocity: event.velocity,
      configuration: event.configuration,
      voiceChoice: event.voiceChoice,
      start: now,
      duration: prefersReducedMotion
        ? 90
        : (durations[sound.id] ?? 320) * visualTempoScale,
    };
    activeMouthSoundId = sound.id;
    flashSound(sound.id, event.velocity, event.voiceChoice);
  }
  visualQueue = waiting;
}

function morphDisplayedPose(target, now, isSpeaking) {
  const elapsed = clamp(now - lastDrawTime, 0, 80);
  const timeConstant = prefersReducedMotion ? 1 : isSpeaking ? 46 : 125;
  const amount = 1 - Math.exp(-elapsed / timeConstant);
  const next = { ...target };
  for (const [key, value] of Object.entries(target)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const previous = Number(displayedPose[key]);
    next[key] = Number.isFinite(previous) ? previous + (value - previous) * amount : value;
  }
  displayedPose = next;
  lastDrawTime = now;
  return displayedPose;
}

function drawBackground(context, width, height, now, motion) {
  context.fillStyle = "#080507";
  context.fillRect(0, 0, width, height);
  context.save();
  context.strokeStyle = "rgba(255, 111, 121, 0.035)";
  context.lineWidth = 1;
  const grid = 34;
  for (let x = (now * 0.002) % grid; x < width; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += grid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  const total = Object.values(motion).reduce((sum, amount) => sum + amount, 0);
  const glow = context.createRadialGradient(width * 0.56, height * 0.5, 0, width * 0.56, height * 0.5, Math.min(width, height) * 0.6);
  glow.addColorStop(0, `rgba(255, 111, 121, ${0.025 + Math.min(0.12, total * 0.025)})`);
  glow.addColorStop(0.52, "rgba(101, 223, 232, 0.018)");
  glow.addColorStop(1, "rgba(8, 5, 7, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawAirPlume(context, layout, motion, now) {
  const amount = Math.max(
    motion.shh,
    motion.shack * 0.62,
    motion.pff * 0.44,
    motion.haw * 0.54,
    motion.hee * 0.42,
    motion.aah * 0.36,
    motion.wail * 0.44,
    motion.holler * 0.58,
  );
  if (amount < 0.008) return;
  const { cx, rx, mouthY } = layout;
  context.save();
  context.lineCap = "round";
  for (let index = 0; index < 17; index += 1) {
    const phase = ((index * 0.173 + now * 0.00022) % 1);
    const x = cx + rx * (0.36 + phase * 1.15);
    const wave = Math.sin(phase * Math.PI * 3 + index * 1.7 + now * 0.009);
    const y = mouthY + wave * rx * (0.035 + phase * 0.13);
    const size = 1 + (1 - phase) * 2.2;
    context.strokeStyle = `rgba(101, 223, 232, ${amount * (0.12 + (1 - phase) * 0.5)})`;
    context.lineWidth = size;
    context.beginPath();
    context.moveTo(x - 8 - amount * 7, y);
    context.lineTo(x + 6, y + wave * 2);
    context.stroke();
  }
  context.restore();
}

function drawToothWhistleJet(context, layout, motion, now) {
  const amount = motion.whistle ?? 0;
  if (amount < 0.008 || !toothGapGeometry) return;
  const gap = toothGapGeometry;
  const sourceX = gap.x;
  const sourceY = gap.y + gap.height * 0.46;
  const jetLength = layout.rx * (0.92 + amount * 0.5);
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";

  const glowRadius = Math.max(9, gap.width * (0.82 + amount * 0.65));
  const glow = context.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, glowRadius);
  glow.addColorStop(0, `rgba(247, 220, 106, ${0.54 + amount * 0.38})`);
  glow.addColorStop(0.28, `rgba(101, 223, 232, ${0.24 + amount * 0.34})`);
  glow.addColorStop(1, "rgba(101, 223, 232, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(sourceX, sourceY, glowRadius, 0, Math.PI * 2);
  context.fill();

  for (let lane = -2; lane <= 2; lane += 1) {
    const laneOffset = lane * Math.max(0.8, gap.height * 0.085);
    const gradient = context.createLinearGradient(sourceX, sourceY, sourceX + jetLength, sourceY);
    gradient.addColorStop(0, `rgba(247, 220, 106, ${amount * (0.66 - Math.abs(lane) * 0.08)})`);
    gradient.addColorStop(0.32, `rgba(101, 223, 232, ${amount * (0.5 - Math.abs(lane) * 0.055)})`);
    gradient.addColorStop(1, "rgba(101, 223, 232, 0)");
    context.strokeStyle = gradient;
    context.lineWidth = Math.max(0.7, 2.6 - Math.abs(lane) * 0.48) * (0.72 + amount * 0.34);
    context.beginPath();
    context.moveTo(sourceX, sourceY + laneOffset);
    for (let segment = 1; segment <= 12; segment += 1) {
      const progress = segment / 12;
      const whistleWave = Math.sin(now * 0.034 + progress * 15 + lane * 0.9)
        * (0.6 + progress * 2.8) * amount;
      context.lineTo(
        sourceX + jetLength * progress,
        sourceY + laneOffset * (1 + progress * 0.38) + whistleWave,
      );
    }
    context.stroke();
  }

  for (let particle = 0; particle < 9; particle += 1) {
    const phase = (particle / 9 + now * 0.00068) % 1;
    const x = sourceX + jetLength * phase;
    const y = sourceY + Math.sin(now * 0.026 + phase * 17 + particle) * (1 + phase * 4);
    context.fillStyle = `rgba(247, 220, 106, ${amount * (1 - phase) * 0.58})`;
    context.beginPath();
    context.arc(x, y, 0.8 + (1 - phase) * 1.3, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawFace(context, layout, pose, motion, now) {
  const { cx, cy, rx, ry, mouthY, opening } = layout;
  const whistle = motion.whistle ?? 0;
  const slap = Math.max(motion.slap, motion.smack * 0.34);
  const smack = motion.smack;
  const pop = motion.pop;
  const shack = motion.shack;
  const wobble = (slap * -1 + smack * 0.92 + pop * 0.38 + shack * 0.18)
    * (0.018 + state.silliness * 0.025);
  context.save();
  context.translate(cx, cy);
  context.rotate(wobble);
  context.translate(-cx, -cy);

  const clownEnergy = clamp(pose.silliness, 0, 1);

  // Two unruly side tufts push the same face beyond a neutral anatomical
  // diagram. They stay decorative: the mouth remains the only sound pose.
  for (const side of [-1, 1]) {
    const rootX = cx + side * rx * (0.72 + pose.earSpread * 0.1);
    const rootY = cy - ry * 0.72;
    const reach = rx * (0.23 + clownEnergy * 0.08 + Math.abs(wobble) * 0.8);
    const tuftGradient = context.createRadialGradient(
      rootX,
      rootY,
      0,
      rootX + side * reach * 0.45,
      rootY,
      reach,
    );
    tuftGradient.addColorStop(0, side < 0 ? "rgba(240, 127, 208, 0.34)" : "rgba(101, 223, 232, 0.3)");
    tuftGradient.addColorStop(1, side < 0 ? "rgba(187, 140, 255, 0.04)" : "rgba(247, 220, 106, 0.035)");
    context.fillStyle = tuftGradient;
    context.strokeStyle = side < 0
      ? "rgba(240, 127, 208, 0.48)"
      : "rgba(101, 223, 232, 0.46)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(rootX - side * rx * 0.08, rootY - ry * 0.1);
    context.bezierCurveTo(
      rootX + side * reach * 0.36,
      rootY - ry * 0.2,
      rootX + side * reach * 1.12,
      rootY - ry * 0.06,
      rootX + side * reach * 0.65,
      rootY + ry * 0.03,
    );
    context.bezierCurveTo(
      rootX + side * reach * 1.05,
      rootY + ry * 0.14,
      rootX + side * reach * 0.22,
      rootY + ry * 0.2,
      rootX - side * rx * 0.08,
      rootY + ry * 0.1,
    );
    context.closePath();
    context.fill();
    context.stroke();
  }

  // Ears are stereo controls, not ornaments: pulling either ear outward
  // widens the binaural spacing and lengthens the tiny interaural delay.
  const earSpread = clamp(pose.earSpread);
  for (const side of [-1, 1]) {
    const earX = cx + side * rx * (0.91 + earSpread * 0.32);
    const earY = cy - ry * 0.07;
    const earRx = rx * (0.12 + earSpread * 0.045);
    const earRy = ry * (0.19 + earSpread * 0.035);
    const earGlow = context.createRadialGradient(
      earX - side * earRx * 0.28,
      earY - earRy * 0.25,
      1,
      earX,
      earY,
      earRy,
    );
    earGlow.addColorStop(0, "rgba(255, 205, 156, 0.62)");
    earGlow.addColorStop(0.52, "rgba(255, 111, 121, 0.4)");
    earGlow.addColorStop(1, "rgba(101, 223, 232, 0.14)");
    context.fillStyle = earGlow;
    context.strokeStyle = `rgba(101, 223, 232, ${0.5 + earSpread * 0.38})`;
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(earX, earY, earRx, earRy, side * -0.12, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = `rgba(255, 177, 93, ${0.36 + earSpread * 0.3})`;
    context.lineWidth = 1.35;
    context.beginPath();
    context.arc(
      earX - side * earRx * 0.04,
      earY,
      earRx * 0.56,
      side < 0 ? -Math.PI * 0.58 : Math.PI * 0.42,
      side < 0 ? Math.PI * 0.67 : Math.PI * 1.67,
      side > 0,
    );
    context.stroke();
  }

  const faceGradient = context.createRadialGradient(cx - rx * 0.2, cy - ry * 0.32, rx * 0.05, cx, cy, ry * 1.05);
  faceGradient.addColorStop(0, "rgba(255, 229, 209, 0.27)");
  faceGradient.addColorStop(0.46, "rgba(255, 112, 126, 0.16)");
  faceGradient.addColorStop(1, "rgba(101, 223, 232, 0.065)");
  context.fillStyle = faceGradient;
  context.strokeStyle = "rgba(244, 238, 233, 0.78)";
  context.lineWidth = 1.7;
  context.beginPath();
  context.moveTo(cx, cy - ry);
  context.bezierCurveTo(cx + rx * 0.78, cy - ry * 0.98, cx + rx * (1.02 + pop * 0.12), cy - ry * 0.32, cx + rx * (0.94 + pop * 0.16), cy + ry * 0.2);
  context.bezierCurveTo(cx + rx * 0.88, cy + ry * 0.62, cx + rx * 0.42, cy + ry * 0.98, cx, cy + ry);
  context.bezierCurveTo(cx - rx * 0.42, cy + ry * 0.98, cx - rx * 0.88, cy + ry * 0.62, cx - rx * (0.94 + slap * 0.16), cy + ry * 0.2);
  context.bezierCurveTo(cx - rx * (1.02 + slap * 0.12), cy - ry * 0.32, cx - rx * 0.78, cy - ry * 0.98, cx, cy - ry);
  context.closePath();
  context.fill();
  context.stroke();

  // Membrane contour rings make the cheek slap model legible.
  for (const side of [-1, 1]) {
    const cheekX = cx + side * rx * 0.59;
    const cheekY = cy + ry * 0.11;
    const active = side < 0 ? Math.max(slap, smack * 0.18) : Math.max(pop, smack);
    const cheekGradient = context.createRadialGradient(
      cheekX,
      cheekY,
      0,
      cheekX,
      cheekY,
      rx * 0.31,
    );
    cheekGradient.addColorStop(0, side < 0
      ? `rgba(240, 127, 208, ${0.16 + active * 0.2})`
      : `rgba(247, 220, 106, ${0.14 + active * 0.2})`);
    cheekGradient.addColorStop(1, "rgba(8, 5, 7, 0)");
    context.fillStyle = cheekGradient;
    context.beginPath();
    context.ellipse(
      cheekX,
      cheekY,
      rx * 0.31 * (1 + active * 0.13),
      ry * 0.235 * (1 + active * 0.09),
      side * 0.08,
      0,
      Math.PI * 2,
    );
    context.fill();
    for (let ring = 1; ring <= 3; ring += 1) {
      context.strokeStyle = side < 0
        ? `rgba(187, 140, 255, ${0.08 + active * 0.2})`
        : `rgba(247, 220, 106, ${0.07 + active * 0.18})`;
      context.lineWidth = ring === 1 ? 1.2 : 0.7;
      context.beginPath();
      context.ellipse(
        cheekX,
        cheekY,
        rx * (0.14 + ring * 0.075) * (1 + active * 0.12),
        ry * (0.09 + ring * 0.05) * (1 + active * 0.08),
        side * 0.08,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }

  // Huge mismatched eyes, opposing pupils, and smeared diamond makeup make
  // the physical model read as one crazed clown instead of a neutral mask.
  const gazePhase = prefersReducedMotion ? 0.72 : now * 0.00125;
  for (const side of [-1, 1]) {
    const leftEye = side < 0;
    const eyeX = cx + side * rx * (leftEye ? 0.345 : 0.34);
    const eyeY = cy - ry * (leftEye ? 0.455 : 0.43);
    const eyeRx = rx * (leftEye ? 0.225 : 0.19) * (1 + clownEnergy * 0.08);
    const eyeRy = ry * (leftEye ? 0.155 : 0.185) * (1 + clownEnergy * 0.06);
    const eyeRotation = side * (0.08 + clownEnergy * 0.085);
    const paintColor = leftEye ? "240, 127, 208" : "101, 223, 232";

    context.fillStyle = `rgba(${paintColor}, ${0.085 + clownEnergy * 0.09})`;
    context.strokeStyle = `rgba(${paintColor}, ${0.23 + clownEnergy * 0.2})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(eyeX, eyeY - eyeRy * 1.55);
    context.lineTo(eyeX + eyeRx * 1.18, eyeY);
    context.lineTo(eyeX - side * eyeRx * 0.12, eyeY + eyeRy * (1.7 + clownEnergy * 0.38));
    context.lineTo(eyeX - eyeRx * 1.16, eyeY);
    context.closePath();
    context.fill();
    context.stroke();

    context.save();
    context.translate(eyeX, eyeY);
    context.rotate(eyeRotation);
    context.fillStyle = "rgba(250, 243, 224, 0.91)";
    context.strokeStyle = "rgba(244, 238, 233, 0.86)";
    context.lineWidth = 2.1;
    context.beginPath();
    context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    const gazeX = side * eyeRx * (pose.eyeDivergence * 0.78 - 0.08)
      + Math.sin(gazePhase + side * 2.35) * eyeRx * clownEnergy * 0.08
      + wobble * 55;
    const gazeY = Math.cos(gazePhase * 0.83 - side * 1.4) * eyeRy * clownEnergy * 0.2
      + (leftEye ? -1 : 1) * eyeRy * 0.05;
    const irisRadius = Math.max(5, Math.min(eyeRx, eyeRy) * (leftEye ? 0.4 : 0.36));
    const irisGradient = context.createRadialGradient(
      gazeX - irisRadius * 0.22,
      gazeY - irisRadius * 0.24,
      irisRadius * 0.08,
      gazeX,
      gazeY,
      irisRadius,
    );
    irisGradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    irisGradient.addColorStop(0.2, leftEye ? "rgba(240, 127, 208, 0.96)" : "rgba(247, 220, 106, 0.96)");
    irisGradient.addColorStop(1, leftEye ? "rgba(187, 140, 255, 0.92)" : "rgba(101, 223, 232, 0.92)");
    context.fillStyle = irisGradient;
    context.strokeStyle = "rgba(8, 5, 7, 0.86)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(gazeX, gazeY, irisRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(5, 3, 5, 0.96)";
    context.beginPath();
    context.arc(gazeX, gazeY, irisRadius * (leftEye ? 0.43 : 0.5), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.arc(gazeX - irisRadius * 0.24, gazeY - irisRadius * 0.28, Math.max(1.5, irisRadius * 0.13), 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.strokeStyle = leftEye
      ? "rgba(255, 111, 121, 0.72)"
      : "rgba(247, 220, 106, 0.68)";
    context.lineWidth = 2 + clownEnergy * 1.2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(eyeX - eyeRx * 1.02, eyeY - eyeRy * (1.18 + slap * 0.08));
    context.quadraticCurveTo(
      eyeX + side * eyeRx * 0.18,
      eyeY - eyeRy * (1.72 - shack * 0.22),
      eyeX + eyeRx * 1.05,
      eyeY - eyeRy * (1.07 - pop * 0.08),
    );
    context.stroke();
  }

  // Raise the nasal resonator between the eyes and give it one large clown
  // bulb. Its tint and side-path still expose the live velum/nasal state.
  const noseX = cx + Math.sin(gazePhase * 0.7) * rx * clownEnergy * 0.008;
  const noseY = cy - ry * (0.025 + pose.nasalMix * 0.34);
  const noseRx = rx * (0.115 + pose.nasalMix * 0.025);
  const noseRy = ry * (0.082 + pose.nasalMix * 0.018);
  context.strokeStyle = `rgba(101, 223, 232, ${0.22 + pose.nasalMix * 0.5})`;
  context.lineWidth = 1.35;
  if (pose.nasalMix > 0.02) {
    context.globalAlpha = 0.2 + pose.nasalMix * 0.42;
    context.beginPath();
    context.moveTo(cx, mouthY - opening * 0.58);
    context.bezierCurveTo(
      cx + rx * 0.14,
      mouthY - ry * 0.18,
      noseX + noseRx * 0.72,
      noseY + noseRy * 0.7,
      noseX + noseRx * 0.36,
      noseY,
    );
    context.stroke();
    context.globalAlpha = 1;
  }
  context.beginPath();
  context.moveTo(cx - rx * 0.015, cy - ry * 0.42);
  context.bezierCurveTo(
    cx + rx * 0.055,
    cy - ry * 0.34,
    noseX - noseRx * 0.42,
    noseY - noseRy * 0.66,
    noseX,
    noseY - noseRy * 0.35,
  );
  context.stroke();
  const noseGradient = context.createRadialGradient(
    noseX - noseRx * 0.3,
    noseY - noseRy * 0.38,
    noseRx * 0.06,
    noseX,
    noseY,
    noseRx,
  );
  noseGradient.addColorStop(0, "rgba(255, 205, 156, 0.96)");
  noseGradient.addColorStop(0.38, "rgba(255, 111, 121, 0.92)");
  noseGradient.addColorStop(1, "rgba(170, 26, 70, 0.82)");
  context.fillStyle = noseGradient;
  context.strokeStyle = `rgba(255, 177, 93, ${0.72 + pose.nasalMix * 0.2})`;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(noseX, noseY, noseRx, noseRy, -wobble * 2, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(38, 5, 17, 0.74)";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.ellipse(
      noseX + side * noseRx * 0.43,
      noseY + noseRy * 0.34,
      noseRx * 0.13,
      noseRy * 0.1,
      side * 0.16,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  const mouthPulse = Math.max(
    motion.bop * 0.48,
    motion.boop * 0.68,
    motion.shack,
    motion.pff * 0.5,
    motion.kick * 0.42,
    motion.smack * 0.3,
    motion.hee * 0.66,
    motion.haw * 0.82,
    motion.doo * 0.76,
    motion.mwah * 0.9,
    motion.drr * 0.58,
    motion.burp * 0.86,
    whistle * 0.34,
    motion.aah * 0.94,
    motion.ooh * 0.88,
    motion.wail,
    motion.yodel * 0.92,
    motion.growl * 0.86,
    motion.holler,
    motion.hum * 0.54,
    motion.rattle * 0.82,
  );
  const roundedGesture = motion.boop * 0.9
    + motion.pop * 0.46
    + motion.pff * 0.38
    + motion.doo * 0.8
    + motion.mwah * 0.95
    + motion.burp * 0.3
    + whistle * 0.72
    + motion.ooh * 1.05
    + motion.hum * 0.88;
  const spreadGesture = motion.shh * 0.48
    + motion.tlik * 0.22
    + motion.shack * 0.16
    + motion.hee * 0.72
    + motion.haw * 0.38
    + motion.drr * 0.22
    + motion.aah * 0.44
    + motion.wail * 0.62
    + motion.yodel * 0.36
    + motion.growl * 0.3
    + motion.holler * 0.52
    + motion.rattle * 0.18;
  const flutter = (motion.pff * Math.sin(now * 0.045)
    + motion.drr * Math.sin(now * 0.074)
    + motion.burp * Math.sin(now * 0.026 + Math.sin(now * 0.011))
    + motion.wail * Math.sin(now * 0.034)
    + motion.yodel * Math.sign(Math.sin(now * 0.022)) * 0.58
    + motion.growl * Math.sin(now * 0.058 + Math.sin(now * 0.017))
    + motion.rattle * Math.sin(now * 0.092)
    + whistle * Math.sin(now * 0.052) * 0.1)
    * (0.08 + state.silliness * 0.06);
  const lipDiameterCm = Number(pose.lipDiameterCm);
  const physicalLipAperture = Number.isFinite(lipDiameterCm)
    ? clamp(lipDiameterCm / 3.2, 0, 1.4)
    : Number.NaN;
  const mouthWidth = rx * clamp(
    0.6
      + pose.lipRounding * 0.1
      + spreadGesture * 0.42
      - roundedGesture * 0.3
      + flutter * 0.42,
    0.16,
    0.96,
  );
  let liveOpening = opening * clamp(
    1 + mouthPulse * (0.75 + state.silliness * 0.45)
      + motion.tlik * 0.42
      + motion.haw * 0.28
      + motion.burp * 0.34
      + motion.aah * 0.46
      + motion.wail * 0.48
      + motion.yodel * 0.34
      + motion.growl * 0.28
      + motion.holler * 0.5
      + motion.rattle * 0.22
      - motion.shh * 0.18
      - motion.hee * 0.12
      - motion.ooh * 0.08
      - motion.hum * 0.64
      + flutter,
    0.12,
    3.2,
  );
  if (Number.isFinite(physicalLipAperture)) {
    // The actual lip valve can seal an otherwise open jaw, as in bilabial
    // pressure build-up, without inventing a second visual mouth layer.
    liveOpening *= clamp(0.06 + physicalLipAperture * 1.3, 0.06, 1.55);
  }
  liveOpening = clamp(liveOpening, Math.max(1.2, ry * 0.004), ry * 0.56);

  const cornerCurl = ry * (0.018 + clownEnergy * 0.028 + shack * 0.024);
  const lipThickness = ry * clamp(
    0.038 + (1 - clamp(pose.lipTension)) * 0.02 + mouthPulse * 0.012,
    0.024,
    0.082,
  );
  const outerMouthWidth = Math.min(
    rx * 0.995,
    mouthWidth + rx * (0.055 + clownEnergy * 0.018),
  );
  const upperLipReach = liveOpening + lipThickness * (1.05 + motion.bop * 0.2 + motion.doo * 0.18);
  const lowerLipReach = liveOpening + lipThickness * (1.42 + motion.pff * 0.25 + motion.burp * 0.34);
  const lipGradient = context.createLinearGradient(
    cx,
    mouthY - upperLipReach,
    cx,
    mouthY + lowerLipReach,
  );
  lipGradient.addColorStop(0, "rgba(255, 155, 166, 0.91)");
  lipGradient.addColorStop(0.48, "rgba(255, 75, 101, 0.82)");
  lipGradient.addColorStop(1, "rgba(126, 18, 67, 0.88)");
  context.fillStyle = lipGradient;
  context.strokeStyle = `rgba(255, 111, 121, ${0.7 + mouthPulse * 0.25})`;
  context.lineWidth = clamp(2.2 + pose.lipTension * 1.5, 1.2, 8);
  context.beginPath();
  context.moveTo(cx - outerMouthWidth, mouthY - cornerCurl);
  context.bezierCurveTo(
    cx - outerMouthWidth * 0.56,
    mouthY - upperLipReach * 0.92,
    cx - outerMouthWidth * 0.2,
    mouthY - upperLipReach * 1.08,
    cx,
    mouthY - upperLipReach,
  );
  context.bezierCurveTo(
    cx + outerMouthWidth * 0.2,
    mouthY - upperLipReach * 1.08,
    cx + outerMouthWidth * 0.56,
    mouthY - upperLipReach * 0.92,
    cx + outerMouthWidth,
    mouthY - cornerCurl,
  );
  context.bezierCurveTo(
    cx + outerMouthWidth * 0.58,
    mouthY + lowerLipReach * 0.93,
    cx + outerMouthWidth * 0.2,
    mouthY + lowerLipReach * 1.08,
    cx,
    mouthY + lowerLipReach,
  );
  context.bezierCurveTo(
    cx - outerMouthWidth * 0.2,
    mouthY + lowerLipReach * 1.08,
    cx - outerMouthWidth * 0.58,
    mouthY + lowerLipReach * 0.93,
    cx - outerMouthWidth,
    mouthY - cornerCurl,
  );
  context.closePath();
  context.fill();
  context.stroke();

  // One oral opening inside the one lip mass. Every sound reshapes this same
  // path; no gesture draws a second mouth or a competing pose.
  context.fillStyle = "rgba(4, 3, 4, 0.96)";
  context.strokeStyle = `rgba(255, 199, 205, ${0.52 + mouthPulse * 0.32})`;
  context.lineWidth = clamp(1.5 + pose.lipTension * 1.15, 0.8, 6);
  context.beginPath();
  context.moveTo(cx - mouthWidth, mouthY - cornerCurl * 0.52);
  context.bezierCurveTo(cx - mouthWidth * 0.43, mouthY - liveOpening, cx + mouthWidth * 0.43, mouthY - liveOpening, cx + mouthWidth, mouthY - cornerCurl * 0.52);
  context.bezierCurveTo(cx + mouthWidth * 0.43, mouthY + liveOpening, cx - mouthWidth * 0.43, mouthY + liveOpening, cx - mouthWidth, mouthY - cornerCurl * 0.52);
  context.closePath();
  context.fill();
  context.stroke();

  // These are discrete upper teeth, not a white strip with separator marks.
  // One entire front-incisor cell is never drawn: the actual cavity behind it
  // remains visible and becomes Hambone's pressure-whistle nozzle.
  const teethX = cx - mouthWidth * 0.64;
  const teethY = mouthY - liveOpening * 0.72;
  const teethWidth = mouthWidth * 1.28;
  const teethHeight = Math.max(3, liveOpening * 0.31);
  const estimatedToothCount = Math.round(clamp(mouthWidth / 23, 8, 12));
  const toothCount = estimatedToothCount % 2 === 0
    ? estimatedToothCount
    : Math.min(12, estimatedToothCount + 1);
  const toothCellWidth = teethWidth / toothCount;
  const missingFrontIncisor = toothCount / 2;
  toothGapGeometry = {
    x: teethX + (missingFrontIncisor + 0.5) * toothCellWidth,
    y: teethY,
    width: toothCellWidth,
    height: teethHeight,
  };

  if (liveOpening > 3) {
    const toothFill = context.createLinearGradient(0, teethY, 0, teethY + teethHeight);
    toothFill.addColorStop(0, "rgba(255, 252, 231, 0.94)");
    toothFill.addColorStop(1, "rgba(224, 210, 181, 0.84)");
    for (let tooth = 0; tooth < toothCount; tooth += 1) {
      if (tooth === missingFrontIncisor) continue;
      const progress = (tooth + 0.5) / toothCount;
      const inset = clamp(toothCellWidth * 0.075, 0.65, 1.6);
      const toothX = teethX + tooth * toothCellWidth + inset;
      const width = toothCellWidth - inset * 2;
      const centrality = 1 - Math.min(1, Math.abs(progress - 0.5) * 2);
      const height = teethHeight * (0.86 + centrality * 0.14);
      const lean = Math.sin(progress * Math.PI * 3 + clownEnergy) * height * 0.06;
      const corner = Math.min(3.2, width * 0.16, height * 0.24);
      context.beginPath();
      context.moveTo(toothX + lean, teethY);
      context.lineTo(toothX + width + lean, teethY);
      context.lineTo(toothX + width - lean, teethY + height - corner);
      context.quadraticCurveTo(
        toothX + width * 0.78 - lean,
        teethY + height + corner * 0.2,
        toothX + width * 0.5 - lean,
        teethY + height,
      );
      context.quadraticCurveTo(
        toothX + width * 0.22 - lean,
        teethY + height + corner * 0.2,
        toothX - lean,
        teethY + height - corner,
      );
      context.closePath();
      context.fillStyle = toothFill;
      context.fill();
      context.strokeStyle = "rgba(91, 34, 51, 0.5)";
      context.lineWidth = 0.85;
      context.stroke();
    }

    // A small gum socket contour makes the missing incisor legible even when
    // the mouth is moving, while leaving the gap itself as untouched cavity.
    const gapLeft = toothGapGeometry.x - toothCellWidth * 0.42;
    const gapRight = toothGapGeometry.x + toothCellWidth * 0.42;
    context.strokeStyle = `rgba(255, 111, 121, ${0.56 + whistle * 0.36})`;
    context.lineWidth = 1.1 + whistle * 1.4;
    context.beginPath();
    context.moveTo(gapLeft, teethY + 0.5);
    context.quadraticCurveTo(
      toothGapGeometry.x,
      teethY + teethHeight * 0.22,
      gapRight,
      teethY + 0.5,
    );
    context.stroke();
  }

  // Tongue body and curled tip.
  const tongueX = cx + (pose.tonguePosition - 0.5) * mouthWidth * 0.66;
  const constrictionDiameterCm = Number(pose.constrictionDiameterCm);
  const constrictionContact = Number.isFinite(constrictionDiameterCm)
    ? 1 - clamp(constrictionDiameterCm / 1.5)
    : 0;
  const tongueLift = motion.tlik * liveOpening * 0.55
    + pose.tongueCurl * liveOpening * 0.2
    + constrictionContact * liveOpening * 0.32;
  context.fillStyle = `rgba(240, 127, 208, ${0.58 + motion.tlik * 0.32})`;
  context.strokeStyle = "rgba(255, 198, 228, 0.58)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cx - mouthWidth * 0.57, mouthY + liveOpening * 0.68);
  context.quadraticCurveTo(tongueX, mouthY + liveOpening * 0.24 - tongueLift, cx + mouthWidth * 0.58, mouthY + liveOpening * 0.7);
  context.quadraticCurveTo(cx, mouthY + liveOpening * 0.94, cx - mouthWidth * 0.57, mouthY + liveOpening * 0.68);
  context.fill();
  context.stroke();

  // Pressure path and valve diagrams stay visible through the skin.
  const pressureAlpha = 0.14 + Math.min(0.52, pose.lungPressure * 0.24 + telemetry.rms * 2);
  context.strokeStyle = `rgba(255, 177, 93, ${pressureAlpha})`;
  context.lineWidth = 1.3;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(cx, cy + ry * 0.92);
  context.bezierCurveTo(cx, cy + ry * 0.7, cx - rx * 0.08, mouthY + liveOpening, cx - mouthWidth * 0.65, mouthY);
  context.stroke();
  context.setLineDash([]);
  for (let bubble = 0; bubble < 6; bubble += 1) {
    const phase = (bubble / 6 + now * 0.00018 * Math.max(0.2, pose.lungPressure)) % 1;
    const bx = cx - Math.sin(phase * Math.PI) * rx * 0.05;
    const by = cy + ry * (0.88 - phase * 0.55);
    context.fillStyle = `rgba(255, 177, 93, ${pressureAlpha * (0.35 + phase * 0.45)})`;
    context.beginPath();
    context.arc(bx, by, 1.5 + pose.lungPressure * 1.2, 0, Math.PI * 2);
    context.fill();
  }

  // Chin/jaw impact mode.
  context.strokeStyle = `rgba(112, 169, 255, ${0.12 + shack * 0.65})`;
  context.lineWidth = 1 + shack * 2;
  context.beginPath();
  context.arc(cx, cy + ry * 0.64, rx * (0.3 + shack * 0.06), 0.12 * Math.PI, 0.88 * Math.PI);
  context.stroke();
  context.restore();
}

function drawWaveform(context, layout) {
  if (!graph?.analyser) return;
  graph.analyser.getFloatTimeDomainData(waveform);
  const { cx, cy, rx, ry } = layout;
  const width = rx * 1.35;
  const y = cy + ry * 0.84;
  context.save();
  context.strokeStyle = "rgba(124, 231, 189, 0.28)";
  context.lineWidth = 0.8;
  context.beginPath();
  for (let index = 0; index < waveform.length; index += 8) {
    const x = cx - width / 2 + index / (waveform.length - 1) * width;
    const sampleY = y + waveform[index] * ry * 0.09;
    if (index === 0) context.moveTo(x, sampleY);
    else context.lineTo(x, sampleY);
  }
  context.stroke();
  context.restore();
}

function labelWidth(context, label) {
  context.font = "650 7px ui-monospace, monospace";
  return Math.max(35, context.measureText(label).width + 14);
}

function drawHotspot(context, hotspot, active) {
  const width = labelWidth(context, hotspot.label);
  const height = 17;
  const desiredLabelX = hotspot.labelSide < 0
    ? hotspot.x - hotspot.r - width - 8
    : hotspot.x + hotspot.r + 8;
  const labelX = clamp(desiredLabelX, 8, Math.max(8, cssWidth - width - 8));
  const labelCenterY = hotspot.y + (hotspot.labelDy ?? 0);
  const labelY = labelCenterY - height / 2;
  const visibleRadius = hotspot.compact ? 3.5 + active * 4 : hotspot.r * (1 + active * 0.14);
  context.save();
  context.strokeStyle = colorWithAlpha(hotspot.color, 0.36 + active * 0.56);
  context.lineWidth = 1 + active * 1.2;
  context.beginPath();
  context.arc(hotspot.x, hotspot.y, visibleRadius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(hotspot.x + hotspot.labelSide * visibleRadius, hotspot.y);
  context.lineTo(hotspot.labelSide < 0 ? labelX + width : labelX, labelCenterY);
  context.stroke();
  roundedRect(context, labelX, labelY, width, height, 3);
  context.fillStyle = `rgba(8, 5, 7, ${0.72 + active * 0.2})`;
  context.fill();
  context.stroke();
  context.fillStyle = colorWithAlpha(hotspot.color, 0.74 + active * 0.26);
  context.font = "650 7px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(hotspot.label, labelX + width / 2, labelCenterY + 0.5);
  context.restore();
}

function colorWithAlpha(color, alpha) {
  const clean = String(color).replace("#", "");
  const red = parseInt(clean.slice(0, 2), 16);
  const green = parseInt(clean.slice(2, 4), 16);
  const blue = parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha)})`;
}

function buildHitGeometry(layout, pose) {
  const { cx, cy, rx, ry, mouthY, opening } = layout;
  const hitRadius = clamp(Math.min(rx, ry) * 0.09, 12, 22);
  const mouthReach = rx * clamp(0.6 + pose.lipRounding * 0.1, 0.16, 0.96);
  const whistleGap = toothGapGeometry ?? {
    x: cx + mouthReach * 0.065,
    y: mouthY - opening * 0.7,
    width: hitRadius,
    height: Math.max(4, opening * 0.3),
  };
  hotspots = [
    { soundId: "slap", label: "SLAP", color: hamboneSound("slap").color, x: cx - rx * 0.7, y: cy + ry * 0.1, r: hitRadius * 1.35, labelSide: -1 },
    { soundId: "pop", label: "POP", color: hamboneSound("pop").color, x: cx + rx * 0.7, y: cy + ry * 0.1, r: hitRadius * 1.35, labelSide: 1 },
    { soundId: "whistle", label: "FWEE", color: hamboneSound("whistle").color, x: whistleGap.x, y: whistleGap.y + whistleGap.height * 0.52, r: hitRadius * 0.92, labelSide: -1, labelDy: -48, compact: true },
    { soundId: "bop", label: "BOP", color: hamboneSound("bop").color, x: cx - mouthReach * 0.55, y: mouthY - opening * 0.58, r: hitRadius, labelSide: -1, labelDy: -30, compact: true },
    { soundId: "boop", label: "BOOP", color: hamboneSound("boop").color, x: cx + mouthReach * 0.55, y: mouthY - opening * 0.36, r: hitRadius, labelSide: 1, labelDy: -30, compact: true },
    { soundId: "pff", label: hamboneSound("pff").label, color: hamboneSound("pff").color, x: cx - mouthReach * 0.62, y: mouthY + opening * 0.58, r: hitRadius, labelSide: -1, labelDy: 30, compact: true },
    { soundId: "tlik", label: "TLIK", color: hamboneSound("tlik").color, x: cx + (pose.tonguePosition - 0.5) * mouthReach * 0.72, y: mouthY + opening * 0.72, r: hitRadius, labelSide: 1, labelDy: 34, compact: true },
    { soundId: "shh", label: hamboneSound("shh").label, color: hamboneSound("shh").color, x: cx + rx * 0.84, y: mouthY - opening * 0.3, r: hitRadius * 1.08, labelSide: 1 },
    { soundId: "shack", label: "SHACK!", color: hamboneSound("shack").color, x: cx + rx * 0.3, y: cy + ry * 0.76, r: hitRadius * 1.12, labelSide: 1 },
  ];
  const nodeRadius = clamp(Math.min(rx, ry) * 0.035, 7, 10);
  const tractLimits = HAMBONE_LIMITS.tractLengthM;
  const tractProgress = (pose.tractLengthM - tractLimits[0]) / Math.max(0.001, tractLimits[1] - tractLimits[0]);
  const noseY = cy - ry * (0.025 + pose.nasalMix * 0.34);
  const earOffset = rx * (0.91 + pose.earSpread * 0.32);
  const leftEyeRx = rx * 0.225 * (1 + clamp(pose.silliness) * 0.08);
  const rightEyeRx = rx * 0.19 * (1 + clamp(pose.silliness) * 0.08);
  const leftEyeX = cx - rx * 0.345
    - leftEyeRx * (pose.eyeDivergence * 0.78 - 0.08);
  const rightEyeX = cx + rx * 0.34
    + rightEyeRx * (pose.eyeDivergence * 0.78 - 0.08);
  handles = [
    { key: "nasalMix", label: "NASAL ↑", color: "#ff7b87", x: cx, y: noseY, r: nodeRadius * 1.45, axis: "y-invert", scale: ry * 0.34, feature: "nose", labelSide: 1 },
    { key: "earSpread", label: "STEREO ↔", color: "#65dfe8", x: cx - earOffset, y: cy - ry * 0.07, r: nodeRadius * 1.45, axis: "x-invert", scale: rx * 0.32, feature: "ear", labelSide: -1 },
    { key: "earSpread", label: "STEREO ↔", color: "#65dfe8", x: cx + earOffset, y: cy - ry * 0.07, r: nodeRadius * 1.45, axis: "x", scale: rx * 0.32, feature: "ear", labelSide: 1 },
    { key: "eyeDivergence", label: "REVERB ↔", color: "#bb8cff", x: leftEyeX, y: cy - ry * 0.455, r: nodeRadius * 1.35, axis: "x-invert", scale: leftEyeRx * 0.78, feature: "eye", labelSide: -1 },
    { key: "eyeDivergence", label: "REVERB ↔", color: "#bb8cff", x: rightEyeX, y: cy - ry * 0.43, r: nodeRadius * 1.35, axis: "x", scale: rightEyeRx * 0.78, feature: "eye", labelSide: 1 },
    { key: "cheekVolume", label: "cheek volume", color: hamboneSound("slap").color, x: cx - rx * (0.48 + pose.cheekVolume * 0.32), y: cy - ry * 0.05, r: nodeRadius, axis: "x-invert", scale: rx * 0.5 },
    { key: "cheekTension", label: "membrane tension", color: hamboneSound("pop").color, x: cx + rx * 0.72, y: cy + ry * (0.23 - pose.cheekTension * 0.33), r: nodeRadius, axis: "y-invert", scale: ry * 0.42 },
    { key: "lipTension", label: "lip tension", color: hamboneSound("bop").color, x: cx - rx * 0.05, y: mouthY - opening - nodeRadius * 1.7, r: nodeRadius, axis: "y-invert", scale: ry * 0.34 },
    { key: "lipRounding", label: "lip projection", color: hamboneSound("boop").color, x: cx + rx * (0.27 + pose.lipRounding * 0.16), y: mouthY, r: nodeRadius, axis: "x", scale: rx * 0.42 },
    { key: "mouthOpening", label: "mouth aperture", color: hamboneSound("shack").color, x: cx + rx * 0.32, y: mouthY + opening, r: nodeRadius, axis: "y", scale: ry * 0.28 },
    { key: "tonguePosition", label: "tongue position", color: hamboneSound("tlik").color, x: cx + (pose.tonguePosition - 0.5) * rx * 0.62, y: mouthY + opening * 0.62, r: nodeRadius, axis: "x", scale: rx * 0.62 },
    { key: "tongueCurl", label: "tongue curl", color: hamboneSound("pff").color, x: cx + (pose.tonguePosition - 0.5) * rx * 0.42, y: mouthY + opening * (0.8 - pose.tongueCurl * 0.62), r: nodeRadius * 0.82, axis: "y-invert", scale: ry * 0.2 },
    { key: "tractLengthM", label: "tract length", color: hamboneSound("shh").color, x: cx, y: cy + ry * (0.55 + tractProgress * 0.3), r: nodeRadius, axis: "y", scale: ry * 0.31 },
  ];
  const handRadius = clamp(Math.min(rx, ry) * 0.14, 22, 46);
  const leftTargetX = cx + handPlacements.left.x * rx;
  const leftTargetY = cy + handPlacements.left.y * ry;
  const rightTargetX = cx + handPlacements.right.x * rx;
  const rightTargetY = cy + handPlacements.right.y * ry;
  const leftDragging = pointerDrag?.type === "hand" && pointerDrag.handId === "left";
  const rightDragging = pointerDrag?.type === "hand" && pointerDrag.handId === "right";
  hands = [
    {
      id: "left",
      soundId: "slap",
      label: "LEFT SLAP",
      color: hamboneSound("slap").color,
      x: leftTargetX - (leftDragging ? 0 : rx * 0.3),
      y: leftTargetY + (leftDragging ? 0 : ry * 0.03),
      r: handRadius,
      side: -1,
      targetX: leftTargetX,
      targetY: leftTargetY,
    },
    {
      id: "right",
      soundId: "smack",
      label: "RIGHT SMACK",
      color: hamboneSound("smack").color,
      x: rightTargetX + (rightDragging ? 0 : rx * 0.3),
      y: rightTargetY + (rightDragging ? 0 : ry * 0.03),
      r: handRadius,
      side: 1,
      targetX: rightTargetX,
      targetY: rightTargetY,
    },
  ];
  for (const point of [...hotspots, ...handles, ...hands]) {
    point.x = clamp(point.x, 12, Math.max(12, cssWidth - 12));
    point.y = clamp(point.y, 12, Math.max(12, cssHeight - 12));
  }
}

function drawHandles(context) {
  for (const handle of handles) {
    const selected = pointerDrag?.key === handle.key;
    context.save();
    context.shadowColor = handle.color;
    context.shadowBlur = selected ? 15 : 7;
    context.fillStyle = selected ? handle.color : "#080507";
    context.strokeStyle = handle.color;
    context.lineWidth = selected ? 2 : 1.2;
    context.beginPath();
    context.arc(
      handle.x,
      handle.y,
      handle.r + (selected ? 2 : 0) + (handle.feature ? 2 : 0),
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = selected ? "#080507" : handle.color;
    context.beginPath();
    context.arc(handle.x, handle.y, 1.5, 0, Math.PI * 2);
    context.fill();
    if (handle.feature) {
      context.setLineDash([3, 3]);
      context.strokeStyle = colorWithAlpha(handle.color, selected ? 0.95 : 0.62);
      context.lineWidth = selected ? 2 : 1;
      context.beginPath();
      context.arc(handle.x, handle.y, handle.r * 1.72, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      const labelWidthPx = Math.max(48, labelWidth(context, handle.label));
      const labelX = clamp(
        handle.x + handle.labelSide * (handle.r * 1.8 + 7)
          - (handle.labelSide < 0 ? labelWidthPx : 0),
        5,
        Math.max(5, cssWidth - labelWidthPx - 5),
      );
      const labelY = clamp(handle.y - 9, 5, Math.max(5, cssHeight - 23));
      roundedRect(context, labelX, labelY, labelWidthPx, 18, 4);
      context.fillStyle = "rgba(8, 5, 7, 0.86)";
      context.fill();
      context.strokeStyle = colorWithAlpha(handle.color, 0.78);
      context.stroke();
      context.fillStyle = handle.color;
      context.font = "700 7px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(handle.label, labelX + labelWidthPx / 2, labelY + 9.5);
    }
    context.restore();
  }
}

function drawHands(context, motion) {
  for (const hand of hands) {
    const active = motion[hand.soundId] ?? 0;
    const selected = pointerDrag?.type === "hand" && pointerDrag.handId === hand.id;
    const r = hand.r * (1 + active * 0.1);
    const travel = 1 - (1 - clamp(active)) ** 2;
    const palmX = hand.x + (hand.targetX - hand.x) * travel;
    const palmY = hand.y + (hand.targetY - hand.y) * travel;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    if (travel > 0.08) {
      context.strokeStyle = colorWithAlpha(hand.color, 0.2 + travel * 0.56);
      context.lineWidth = 1.2 + travel * 1.8;
      for (let streak = -1; streak <= 1; streak += 1) {
        const offsetY = streak * r * 0.34;
        context.beginPath();
        context.moveTo(
          hand.x + (palmX - hand.x) * 0.08,
          hand.y + offsetY,
        );
        context.lineTo(
          hand.x + (palmX - hand.x) * 0.68,
          palmY + offsetY * 0.32,
        );
        context.stroke();
      }
    }

    // Forearm exits the stage edge so the palm reads immediately as a hand,
    // even at phone scale.
    context.strokeStyle = colorWithAlpha(hand.color, selected ? 0.72 : 0.4 + active * 0.24);
    context.lineWidth = r * 0.48;
    context.beginPath();
    context.moveTo(palmX + hand.side * r * 0.32, palmY + r * 0.42);
    context.lineTo(hand.x + hand.side * r * 2.15, hand.y + r * 1.25);
    context.stroke();

    context.translate(palmX, palmY);
    context.rotate(hand.side * (-0.2 + travel * 0.34));
    context.shadowColor = hand.color;
    context.shadowBlur = selected ? 22 : 8 + active * 12;
    context.fillStyle = selected
      ? colorWithAlpha(hand.color, 0.78)
      : `rgba(255, 205, 156, ${0.5 + active * 0.22})`;
    context.strokeStyle = colorWithAlpha(hand.color, 0.88);
    context.lineWidth = 2.2;
    context.beginPath();
    context.ellipse(0, r * 0.03, r * 0.66, r * 0.76, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    const fingerHeights = [0.95, 1.18, 1.26, 1.08];
    for (let finger = 0; finger < 4; finger += 1) {
      const fingerX = (finger - 1.5) * r * 0.28;
      context.strokeStyle = `rgba(255, 205, 156, ${0.72 + active * 0.18})`;
      context.lineWidth = r * 0.22;
      context.beginPath();
      context.moveTo(fingerX, -r * 0.36);
      context.lineTo(fingerX + hand.side * r * 0.035, -r * fingerHeights[finger]);
      context.stroke();
      context.strokeStyle = colorWithAlpha(hand.color, 0.68);
      context.lineWidth = 1.25;
      context.stroke();
    }
    context.strokeStyle = `rgba(255, 205, 156, ${0.72 + active * 0.18})`;
    context.lineWidth = r * 0.25;
    context.beginPath();
    context.moveTo(-hand.side * r * 0.43, -r * 0.05);
    context.lineTo(-hand.side * r * 0.94, -r * 0.36);
    context.stroke();
    context.strokeStyle = colorWithAlpha(hand.color, 0.72);
    context.lineWidth = 1.3;
    context.stroke();
    context.shadowBlur = 0;
    context.restore();

    if (travel > 0.54) {
      const impact = clamp((travel - 0.54) / 0.46);
      context.save();
      context.translate(hand.targetX, hand.targetY);
      context.strokeStyle = colorWithAlpha(hand.color, 0.34 + impact * 0.58);
      context.lineWidth = 1.2 + impact * 1.8;
      context.beginPath();
      context.arc(0, 0, r * (0.55 + impact * 0.9), 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = ray * Math.PI / 4;
        const inner = r * (0.52 + impact * 0.2);
        const outer = r * (0.78 + impact * 0.7);
        context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      }
      context.stroke();
      context.restore();
    }

    const labelWidthPx = Math.max(62, labelWidth(context, hand.label));
    const labelX = clamp(hand.x - labelWidthPx / 2, 6, Math.max(6, cssWidth - labelWidthPx - 6));
    const labelY = clamp(hand.y + r * 0.92, 6, Math.max(6, cssHeight - 26));
    context.save();
    roundedRect(context, labelX, labelY, labelWidthPx, 19, 4);
    context.fillStyle = "rgba(8, 5, 7, 0.88)";
    context.fill();
    context.strokeStyle = colorWithAlpha(hand.color, selected ? 1 : 0.74);
    context.lineWidth = selected ? 2 : 1;
    context.stroke();
    context.fillStyle = hand.color;
    context.font = "700 7px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      `${travel > 0.35 ? "SLAP!" : hand.label} · DRAG`,
      labelX + labelWidthPx / 2,
      labelY + 10,
    );
    context.restore();
  }
}

function drawStage(now = performance.now()) {
  flushVisualQueue(now);
  const physicalStatus = physicalTelemetryStatus(now);
  const motion = activeMotion(now, physicalStatus);
  const strongest = Object.entries(motion).sort((left, right) => right[1] - left[1])[0];
  const isSpeaking = Boolean(physicalStatus?.active) || strongest?.[1] > 0.01;
  const visualOverrides = soundAnimation?.configuration ?? null;
  const visualState = visualOverrides ? { ...state, ...visualOverrides } : state;
  const targetPose = physicalStatus
    ? physicalTelemetryPose(physicalStatus, visualState)
    : isSpeaking
      ? hambonePoseForSound(strongest[0], visualState, Math.min(0.82, strongest[1] * 0.72))
      : visualState;
  const pose = morphDisplayedPose(targetPose, now, isSpeaking);
  const layout = faceLayout(pose);
  drawBackground(drawing, cssWidth, cssHeight, now, motion);
  drawAirPlume(drawing, layout, motion, now);
  drawFace(drawing, layout, pose, motion, now);
  drawToothWhistleJet(drawing, layout, motion, now);
  drawWaveform(drawing, layout);
  buildHitGeometry(layout, pose);
  for (const hotspot of hotspots) drawHotspot(drawing, hotspot, motion[hotspot.soundId] ?? 0);
  drawHands(drawing, motion);
  drawHandles(drawing);
  updateHud(pose);
  animationFrame = requestAnimationFrame(drawStage);
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, rect.width);
  cssHeight = Math.max(1, rect.height);
  const requestedRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const pixelBudget = 2_800_000;
  pixelRatio = Math.min(requestedRatio, Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight)));
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * cssWidth / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * cssHeight / Math.max(1, rect.height),
  };
}

function distanceSquared(point, target) {
  return (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
}

function handStrikeConfiguration(handId) {
  const placement = handPlacements[handId] ?? { x: 0, y: 0 };
  const horizontal = clamp(placement.x, -1.2, 1.2);
  const vertical = clamp(placement.y, -0.76, 0.78);
  const cheekCenter = clamp(1 - Math.abs(horizontal) * 0.62);
  const height = clamp((placement.y + 0.72) / 1.46);
  const upperFace = clamp((-vertical + 0.08) / 0.8);
  const lowerFace = clamp((vertical + 0.02) / 0.8);
  const mouthZone = clamp(
    1 - Math.hypot(horizontal / 0.86, (vertical - 0.28) / 0.64),
  );
  const outerCheek = clamp(Math.abs(horizontal) / 1.05);
  return {
    cheekVolume: clamp(
      state.cheekVolume * 0.46 + cheekCenter * 0.82 - upperFace * 0.16,
      HAMBONE_LIMITS.cheekVolume[0],
      HAMBONE_LIMITS.cheekVolume[1],
    ),
    cheekTension: clamp(
      state.cheekTension * 0.44 + (1 - height) * 0.72 + outerCheek * 0.28,
      HAMBONE_LIMITS.cheekTension[0],
      HAMBONE_LIMITS.cheekTension[1],
    ),
    nasalMix: clamp(state.nasalMix * 0.54 + upperFace * 0.76, 0, 1),
    mouthOpening: clamp(
      state.mouthOpening * 0.68 + mouthZone * 0.72 + lowerFace * 0.16,
      HAMBONE_LIMITS.mouthOpening[0],
      HAMBONE_LIMITS.mouthOpening[1],
    ),
    lipRounding: clamp(
      state.lipRounding + mouthZone * 0.48 - outerCheek * 0.22,
      HAMBONE_LIMITS.lipRounding[0],
      HAMBONE_LIMITS.lipRounding[1],
    ),
    tonguePosition: clamp(
      state.tonguePosition + horizontal * 0.16 - lowerFace * 0.08,
      HAMBONE_LIMITS.tonguePosition[0],
      HAMBONE_LIMITS.tonguePosition[1],
    ),
    tractLengthM: clamp(
      state.tractLengthM * (0.86 + lowerFace * 0.28 + cheekCenter * 0.08),
      HAMBONE_LIMITS.tractLengthM[0],
      HAMBONE_LIMITS.tractLengthM[1],
    ),
    earSpread: clamp(state.earSpread * 0.7 + outerCheek * 0.46, 0, 1),
    eyeDivergence: clamp(state.eyeDivergence * 0.68 + upperFace * 0.38, 0, 1),
  };
}

function handlePointerDown(event) {
  const point = canvasPoint(event);
  const handle = [...handles]
    .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
    .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 12) ** 2);
  if (handle) {
    pointerDrag = {
      type: "parameter",
      pointerId: event.pointerId,
      key: handle.key,
      axis: handle.axis,
      scale: handle.scale,
      startX: point.x,
      startY: point.y,
      startValue: state[handle.key],
    };
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const hand = [...hands]
    .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
    .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 8) ** 2);
  if (hand) {
    pointerDrag = {
      type: "hand",
      pointerId: event.pointerId,
      handId: hand.id,
      soundId: hand.soundId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      distance: 0,
    };
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const hotspot = [...hotspots]
    .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
    .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 8) ** 2);
  if (hotspot) {
    triggerSound(hotspot.soundId, clamp(0.62 + state.lungPressure * 0.28, 0.55, 1));
    event.preventDefault();
  }
}

function handlePointerMove(event) {
  const point = canvasPoint(event);
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
    const overHandle = handles.some((candidate) => (
      distanceSquared(point, candidate) <= (candidate.r + 10) ** 2
    ));
    const overHand = hands.some((candidate) => (
      distanceSquared(point, candidate) <= (candidate.r + 8) ** 2
    ));
    const overHotspot = hotspots.some((candidate) => (
      distanceSquared(point, candidate) <= (candidate.r + 6) ** 2
    ));
    canvas.style.cursor = overHandle || overHand ? "grab" : overHotspot ? "pointer" : "default";
    return;
  }
  if (pointerDrag.type === "hand") {
    const layout = faceLayout(displayedPose);
    const placement = handPlacements[pointerDrag.handId];
    const minimumX = pointerDrag.handId === "left" ? -1.22 : -0.18;
    const maximumX = pointerDrag.handId === "left" ? 0.18 : 1.22;
    placement.x = clamp((point.x - layout.cx) / Math.max(1, layout.rx), minimumX, maximumX);
    placement.y = clamp((point.y - layout.cy) / Math.max(1, layout.ry), -0.76, 0.78);
    pointerDrag.distance += Math.hypot(point.x - pointerDrag.lastX, point.y - pointerDrag.lastY);
    pointerDrag.lastX = point.x;
    pointerDrag.lastY = point.y;
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }
  const dx = point.x - pointerDrag.startX;
  const dy = point.y - pointerDrag.startY;
  const [minimum, maximum] = HAMBONE_LIMITS[pointerDrag.key] ?? [
    Number($(pointerDrag.key)?.min) || 0,
    Number($(pointerDrag.key)?.max) || 1,
  ];
  let delta = 0;
  if (pointerDrag.axis === "x") delta = dx / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "x-invert") delta = -dx / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "y") delta = dy / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "y-invert") delta = -dy / pointerDrag.scale * (maximum - minimum);
  setStateValue(pointerDrag.key, pointerDrag.startValue + delta);
  event.preventDefault();
}

function endPointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const drag = pointerDrag;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  canvas.style.cursor = "grab";
  canvas.releasePointerCapture?.(event.pointerId);
  if (drag.type === "hand") {
    if (event.type !== "pointercancel") {
      const layout = faceLayout(displayedPose);
      const velocity = clamp(0.58 + drag.distance / Math.max(40, Math.min(layout.rx, layout.ry)) * 0.34, 0.58, 1);
      triggerSound(drag.soundId, velocity, handStrikeConfiguration(drag.handId));
      announce(`${drag.handId === "left" ? "Left slap" : "Right smack"}: ${Math.round(velocity * 100)}% impact through the mouth resonator`);
    }
    return;
  }
  const key = drag.key;
  const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
  announce(`${$(key)?.previousElementSibling?.querySelector("b")?.textContent ?? key}: ${spec?.format(state[key]) ?? state[key]}`);
}

function bindControls() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    if (!input) continue;
    input.addEventListener("input", () => setStateValue(spec.key, Number(input.value)));
  }
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleSequence);
  $("restartButton").addEventListener("click", restartSequence);
  $("randomPatternButton").addEventListener("click", scatterPattern);
  $("clearPatternButton").addEventListener("click", clearPattern);
  $("randomizeButton").addEventListener("click", randomizeFace);
  $("resetButton").addEventListener("click", resetAll);
  $("sequenceLength")?.addEventListener("input", () => {
    const previewLength = clamp(
      Math.round(Number($("sequenceLength").value) || 1),
      1,
      HAMBONE_STEP_COUNT,
    );
    if ($("sequenceLengthNumber")) $("sequenceLengthNumber").value = String(previewLength);
    if ($("sequenceLengthOut")) {
      $("sequenceLengthOut").value = `${previewLength} steps`;
      $("sequenceLengthOut").textContent = $("sequenceLengthOut").value;
    }
  });
  $("sequenceLength")?.addEventListener("change", () => (
    setSequenceLength($("sequenceLength").value)
  ));
  $("sequenceLengthNumber")?.addEventListener("change", () => (
    setSequenceLength($("sequenceLengthNumber").value)
  ));
  $("voiceCount")?.addEventListener("input", () => {
    voiceCount = clamp(Math.round(Number($("voiceCount").value) || 1), 1, voiceSlots.length);
    $("voiceCountOut").value = String(voiceCount);
    $("voiceCountOut").textContent = String(voiceCount);
    activeVoiceSlot = -1;
    voiceCursor = 0;
    buildVoiceRack();
  });
  $("voiceCount")?.addEventListener("change", () => announce(
    `${voiceCount} voice character${voiceCount === 1 ? "" : "s"}; one plays per event`,
  ));
  $("voiceSelectionMode")?.addEventListener("change", () => {
    voiceSelectionMode = $("voiceSelectionMode").value === "random" ? "random" : "round-robin";
    voiceCursor = 0;
    announce(`Voice choice: ${voiceSelectionMode === "random" ? "random per event" : "round robin"}`);
  });
  $("mutateVoicesButton")?.addEventListener("click", () => {
    for (const slot of voiceSlots.slice(0, voiceCount)) {
      slot.voice = mutateHamboneVoice(slot.voice, Math.random, 0.58);
    }
    buildVoiceRack();
    announce(`${voiceCount} voice characters mutated`);
  });
  $("presetSelect").addEventListener("change", () => setPreset($("presetSelect").value));
  $("patternSelect").addEventListener("change", () => {
    if ($("patternSelect").value !== "custom") setCurrentPattern($("patternSelect").value);
  });
  for (const button of $("padGrid").querySelectorAll("button[data-sound-id]")) {
    const sound = hamboneSound(button.dataset.soundId);
    button.style.setProperty("--pad-color", sound.color);
    button.addEventListener("click", () => triggerSound(sound.id, 0.9));
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", endPointerDrag);
  canvas.addEventListener("pointercancel", endPointerDrag);

  globalThis.addEventListener("keydown", (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target?.matches?.("input, select, textarea, button, [contenteditable='true']")) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleSequence();
      return;
    }
    const pressedKey = String(event.key).toLowerCase();
    const sound = HAMBONE_SOUNDS.find(({ key }) => String(key).toLowerCase() === pressedKey);
    if (!sound) return;
    event.preventDefault();
    triggerSound(sound.id, 0.9);
  });
}

function initialize() {
  syncControlLimits();
  populateSelects();
  buildPadGrid();
  buildVoiceRack({ preserveScroll: false });
  setSequenceLength(Number($("sequenceLength")?.value) || sequenceLength, { announceState: false });
  bindControls();
  syncControls();
  setAudioPresentation("off");
  resizeCanvas();
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stageWrap);
  animationFrame = requestAnimationFrame(drawStage);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopSequence({ announceState: false });
      graph?.sourceNode?.port.postMessage({ type: "silence" });
    }
  });
  globalThis.addEventListener("pagehide", () => {
    stopSequence({ announceState: false });
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    graph?.sourceNode?.port.postMessage({ type: "silence" });
    graph?.releaseOutput?.();
    audioContext?.close?.();
  }, { once: true });
}

initialize();
