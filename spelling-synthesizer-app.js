import {
  SPELLING_ENGINES,
  SPELLING_PERSONALITIES,
  insertedText,
  isSpellingPairPrefix,
  isSpellingVowel,
  previousTypedLetter,
  remapSpellingOffset,
  spellingArticulation,
  spellingContextualArticulation,
  spellingPair,
  spellingPerformanceState,
  spellingSoundLabel,
  spellingTextEdit,
  spellingTokens,
  typingDynamics,
} from "./src/spelling-synthesizer.js";
import { SpellingSynthesizerAudio } from "./src/spelling-synthesizer-audio.js";

const $ = (id) => document.getElementById(id);
const BOUNDARY_PATTERN = /\s|[.!?,;:]/;

const ENGINE_COLORS = Object.freeze({
  tube: Object.freeze({ color: "#d8ff57", rgb: "216, 255, 87" }),
  diphone: Object.freeze({ color: "#79dcff", rgb: "121, 220, 255" }),
  vocoder: Object.freeze({ color: "#ffcb69", rgb: "255, 203, 105" }),
});

const READBACK_PERSONALITIES = Object.freeze({
  clear: Object.freeze({ rate: 0.92, pitch: 1, volume: 1 }),
  warm: Object.freeze({ rate: 0.84, pitch: 0.78, volume: 0.96 }),
  whisper: Object.freeze({ rate: 0.88, pitch: 1.08, volume: 0.72 }),
  reed: Object.freeze({ rate: 1.02, pitch: 1.34, volume: 0.9 }),
  creature: Object.freeze({ rate: 0.76, pitch: 0.52, volume: 0.98 }),
});

const DEFAULTS = Object.freeze({
  engine: "tube",
  personality: "clear",
  level: 0.46,
  rhythmAmount: 0.72,
  diphthongDelay: 180,
  pairGlides: true,
});

const state = {
  ...DEFAULTS,
  audioOn: false,
  starting: false,
  switching: false,
  carrierVowel: "a",
  lastTypedAt: 0,
  averageIntervalMs: 320,
  intervals: [],
  lastStreamCharacter: "",
  editorText: $("spellingInput").value,
  composing: false,
  compositionStartText: "",
};

let startPromise = null;
let pendingNativeInput = null;
let pendingNativeTimer = 0;
let pendingPair = null;
let visualTimer = 0;
let queuedInsertTimers = [];
let audioPlaybackQueue = [];
let audioPlaybackDraining = false;
let audioPlaybackTimer = 0;
let audioPlaybackWake = null;
let audioPlaybackGeneration = 0;
let audioOperationGeneration = 0;
let engineSwitchPromise = null;

const readback = {
  phase: "idle",
  generation: 0,
  utterance: null,
  startTimer: 0,
  offset: 0,
  baseOffset: 0,
  snapshot: "",
  resumeTimer: 0,
  shouldAutoResume: false,
};

const audio = new SpellingSynthesizerAudio({
  engine: state.engine,
  level: state.level,
  onFallback({ requested, actual, error }) {
    state.engine = actual;
    showError(
      `${SPELLING_ENGINES[requested].name} is unavailable here. `
        + `${SPELLING_ENGINES[actual].name} is playing instead. `
        + `${error instanceof Error ? error.message : ""}`.trim(),
    );
  },
});

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message) {
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function readbackAvailable() {
  return Boolean(
    globalThis.speechSynthesis
    && typeof globalThis.SpeechSynthesisUtterance === "function",
  );
}

function updateReadbackUi() {
  const button = $("readbackButton");
  const startOver = $("readbackStartOver");
  const labels = {
    idle: "Read it back to me",
    starting: "Preparing voice…",
    playing: "Pause readback",
    paused: "Resume readback",
    interrupted: "Continue readback",
    complete: "Read it again",
  };
  button.textContent = labels[readback.phase] ?? labels.idle;
  button.disabled = readback.phase === "starting";
  button.setAttribute(
    "aria-pressed",
    String(readback.phase === "starting" || readback.phase === "playing"),
  );
  startOver.hidden = !["paused", "interrupted", "complete"].includes(readback.phase);
}

function median(values, fallback = 320) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function countLabel(value) {
  const count = [...String(value ?? "")].length;
  return `${count} character${count === 1 ? "" : "s"}`;
}

function clearQueuedInsertions() {
  for (const timer of queuedInsertTimers) globalThis.clearTimeout(timer);
  queuedInsertTimers = [];
}

function clearAudioPlaybackQueue() {
  audioPlaybackQueue = [];
  audioPlaybackGeneration += 1;
  if (audioPlaybackTimer) globalThis.clearTimeout(audioPlaybackTimer);
  audioPlaybackTimer = 0;
  const wake = audioPlaybackWake;
  audioPlaybackWake = null;
  wake?.();
}

function waitForAudioPlayback(delayMs) {
  return new Promise((resolve) => {
    const finish = () => {
      audioPlaybackTimer = 0;
      audioPlaybackWake = null;
      resolve();
    };
    audioPlaybackWake = finish;
    audioPlaybackTimer = globalThis.setTimeout(finish, delayMs);
  });
}

function clearPendingNativeInput() {
  if (pendingNativeTimer) globalThis.clearTimeout(pendingNativeTimer);
  pendingNativeTimer = 0;
  pendingNativeInput = null;
}

function flushPendingPair({ sound = true } = {}) {
  if (!pendingPair) return;
  globalThis.clearTimeout(pendingPair.timer);
  const pending = pendingPair;
  pendingPair = null;
  if (sound) processCharacter(pending.character, pending.options);
}

function updateEngineUi() {
  const engine = SPELLING_ENGINES[state.engine];
  const index = Object.keys(SPELLING_ENGINES).indexOf(state.engine);
  const palette = ENGINE_COLORS[state.engine];
  document.body.style.setProperty("--spelling-accent", palette.color);
  document.body.style.setProperty("--spelling-accent-rgb", palette.rgb);
  for (const button of $("engineButtons").querySelectorAll("[data-engine]")) {
    setPressed(button, button.dataset.engine === state.engine);
    button.disabled = state.switching;
  }
  $("engineIndex").textContent = `0${index + 1} / 03`;
  $("engineTitle").textContent = engine.name;
  $("engineLineage").textContent = engine.lineage;
  $("engineDescription").textContent = engine.description;
  $("stageEngineOut").textContent = engine.name;
}

function updatePersonalityUi() {
  for (const button of $("personalityButtons").querySelectorAll("[data-personality]")) {
    setPressed(button, button.dataset.personality === state.personality);
  }
}

function updateAudioUi() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.starting;
  $("audioState").textContent = state.starting
    ? "starting"
    : state.audioOn
      ? SPELLING_ENGINES[state.engine].shortName.toLowerCase()
      : "type to start";
  document.body.classList.toggle("has-spelling-audio", state.audioOn);
}

function updateControlUi() {
  $("level").value = String(state.level);
  const levelPercent = Math.round(state.level / 0.82 * 100);
  $("levelOut").textContent = `${levelPercent}%`;
  $("level").setAttribute("aria-valuetext", `${levelPercent} percent`);
  $("rhythmAmount").value = String(state.rhythmAmount);
  const rhythmPercent = Math.round(state.rhythmAmount * 100);
  $("rhythmAmountOut").textContent = `${rhythmPercent}%`;
  $("rhythmAmount").setAttribute("aria-valuetext", `${rhythmPercent} percent`);
  $("diphthongDelay").value = String(state.diphthongDelay);
  $("diphthongDelayOut").textContent = `${Math.round(state.diphthongDelay)} ms`;
  $("diphthongDelay").setAttribute(
    "aria-valuetext",
    `${Math.round(state.diphthongDelay)} milliseconds`,
  );
  $("pairGlidesButton").setAttribute("aria-checked", String(state.pairGlides));
  $("pairGlidesState").textContent = state.pairGlides ? "on" : "off";
}

function updateTextUi() {
  const text = $("spellingInput").value;
  $("characterCount").textContent = countLabel(text);
  const trail = [...text.toUpperCase().replace(/\s+/g, " · ")].slice(-42).join("");
  $("letterTrail").textContent = trail || "YOUR LETTERS WILL GATHER HERE";
}

function updateUi() {
  updateEngineUi();
  updatePersonalityUi();
  updateAudioUi();
  updateControlUi();
  updateTextUi();
  updateReadbackUi();
}

function clearReadbackResumeTimer() {
  if (readback.resumeTimer) globalThis.clearTimeout(readback.resumeTimer);
  readback.resumeTimer = 0;
}

function clearReadbackStartTimer() {
  if (readback.startTimer) globalThis.clearTimeout(readback.startTimer);
  readback.startTimer = 0;
}

function cancelReadbackUtterance() {
  clearReadbackStartTimer();
  readback.generation += 1;
  readback.utterance = null;
  globalThis.speechSynthesis?.cancel?.();
}

function pauseReadback({
  phase = "paused",
  announceMessage = "",
  autoResume = false,
} = {}) {
  const wasActive = readback.phase === "starting" || readback.phase === "playing";
  clearReadbackResumeTimer();
  if (wasActive || readback.utterance) cancelReadbackUtterance();
  readback.phase = phase;
  readback.shouldAutoResume = autoResume;
  updateReadbackUi();
  if (announceMessage) announce(announceMessage);
}

function forgetReadback() {
  clearReadbackResumeTimer();
  cancelReadbackUtterance();
  readback.phase = "idle";
  readback.offset = 0;
  readback.baseOffset = 0;
  readback.snapshot = "";
  readback.shouldAutoResume = false;
  updateReadbackUi();
}

function readbackVoice() {
  const voices = globalThis.speechSynthesis?.getVoices?.() ?? [];
  const language = document.documentElement.lang || "en";
  return voices.find((voice) => voice.default && voice.lang?.startsWith(language))
    ?? voices.find((voice) => voice.lang?.startsWith(language))
    ?? voices.find((voice) => voice.default)
    ?? null;
}

function startReadback({ restart = false, automatic = false } = {}) {
  const text = $("spellingInput").value;
  if (!text.trim()) {
    forgetReadback();
    announce("Type something first.");
    return false;
  }
  if (!readbackAvailable()) {
    showError("Whole-text readback is not available in this browser.");
    announce("Whole-text readback is unavailable.");
    updateReadbackUi();
    return false;
  }
  clearError();
  clearReadbackResumeTimer();
  cancelReadbackUtterance();
  flushPendingPair({ sound: false });
  clearQueuedInsertions();
  clearAudioPlaybackQueue();
  if (state.audioOn) audio.release({ releaseMs: 24 });
  if (restart || readback.phase === "idle" || readback.phase === "complete") {
    readback.offset = 0;
  }
  readback.snapshot = text;
  readback.offset = Math.min(text.length, Math.max(0, readback.offset));
  if (readback.offset >= text.length) readback.offset = 0;
  readback.baseOffset = readback.offset;
  readback.phase = "starting";
  readback.shouldAutoResume = false;
  const generation = readback.generation;
  const utterance = new globalThis.SpeechSynthesisUtterance(text.slice(readback.baseOffset));
  const profile = READBACK_PERSONALITIES[state.personality]
    ?? READBACK_PERSONALITIES.clear;
  const selectedVoice = readbackVoice();
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || document.documentElement.lang || "en-US";
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  utterance.volume = Math.min(
    1,
    profile.volume * (0.68 + state.level / 0.82 * 0.32),
  );
  readback.utterance = utterance;
  utterance.addEventListener("start", () => {
    if (generation !== readback.generation || readback.utterance !== utterance) return;
    clearReadbackStartTimer();
    readback.phase = "playing";
    updateReadbackUi();
    announce(automatic
      ? `Readback continued from character ${readback.baseOffset + 1}.`
      : readback.baseOffset
        ? `Readback resumed from character ${readback.baseOffset + 1}.`
        : "Reading from the beginning.");
  });
  utterance.addEventListener("boundary", (event) => {
    if (generation !== readback.generation || readback.utterance !== utterance) return;
    if (Number.isFinite(event.charIndex)) {
      readback.offset = Math.min(text.length, readback.baseOffset + event.charIndex);
    }
  });
  utterance.addEventListener("end", () => {
    if (generation !== readback.generation || readback.utterance !== utterance) return;
    clearReadbackStartTimer();
    readback.utterance = null;
    readback.offset = text.length;
    readback.phase = "complete";
    updateReadbackUi();
    announce("Readback finished.");
  });
  utterance.addEventListener("error", (event) => {
    if (generation !== readback.generation || readback.utterance !== utterance) return;
    clearReadbackStartTimer();
    readback.utterance = null;
    if (event.error === "canceled" || event.error === "interrupted") return;
    readback.phase = "paused";
    showError(`Readback stopped${event.error ? `: ${event.error}` : "."}`);
    updateReadbackUi();
  });
  readback.startTimer = globalThis.setTimeout(() => {
    if (
      generation !== readback.generation
      || readback.utterance !== utterance
      || readback.phase !== "starting"
    ) return;
    cancelReadbackUtterance();
    readback.phase = "paused";
    showError("The browser speech voice did not start. Try readback again.");
    updateReadbackUi();
  }, 4_000);
  try {
    globalThis.speechSynthesis.speak(utterance);
  } catch (error) {
    clearReadbackStartTimer();
    readback.utterance = null;
    readback.phase = "paused";
    showError(error instanceof Error ? error.message : "The browser speech voice could not start.");
    updateReadbackUi();
    return false;
  }
  updateReadbackUi();
  return true;
}

function scheduleReadbackContinuation() {
  clearReadbackResumeTimer();
  if (!readback.shouldAutoResume || !$("spellingInput").value.trim()) return;
  readback.resumeTimer = globalThis.setTimeout(() => {
    readback.resumeTimer = 0;
    if (readback.phase !== "interrupted" || !readback.shouldAutoResume) return;
    startReadback({ automatic: true });
  }, 900);
}

function interruptReadbackForTyping(edit = null) {
  if (edit) {
    readback.offset = remapSpellingOffset(readback.offset, edit);
  }
  const wasActive = readback.phase === "starting" || readback.phase === "playing";
  const continuing = readback.phase === "interrupted" && readback.shouldAutoResume;
  if (wasActive) {
    cancelReadbackUtterance();
    readback.phase = "interrupted";
    readback.shouldAutoResume = true;
    updateReadbackUi();
    announce("Readback paused where you started typing.");
  } else if (readback.phase === "paused") {
    updateReadbackUi();
  } else if (readback.phase === "complete") {
    readback.phase = "idle";
    readback.offset = 0;
    updateReadbackUi();
  }
  if (wasActive || continuing) scheduleReadbackContinuation();
}

function toggleReadback() {
  if (readback.phase === "starting" || readback.phase === "playing") {
    pauseReadback({ announceMessage: `Readback paused after character ${readback.offset + 1}.` });
    return;
  }
  startReadback({ restart: readback.phase === "idle" || readback.phase === "complete" });
}

async function ensureAudio() {
  const generation = audioOperationGeneration;
  if (engineSwitchPromise) {
    try { await engineSwitchPromise; } catch {}
  }
  if (generation !== audioOperationGeneration) return false;
  if (audio.running && state.audioOn) return true;
  if (startPromise) return startPromise;
  state.starting = true;
  clearError();
  updateAudioUi();
  const operation = (async () => {
    try {
      const actualEngine = await audio.enable();
      if (generation !== audioOperationGeneration) {
        await audio.disable();
        return false;
      }
      state.engine = actualEngine;
      state.audioOn = true;
      announce(
        `${SPELLING_ENGINES[actualEngine].name} ready. Type in the writing field to play it.`,
      );
      return true;
    } catch (error) {
      state.audioOn = false;
      if (error?.name === "AbortError" || generation !== audioOperationGeneration) {
        return false;
      }
      showError(error instanceof Error ? error.message : "The voice could not start.");
      announce("Spelling Synthesizer audio could not start.");
      return false;
    } finally {
      state.starting = false;
      if (startPromise === operation) startPromise = null;
      updateUi();
    }
  })();
  startPromise = operation;
  return operation;
}

async function stopAudio(message = "Spelling Synthesizer audio off.") {
  audioOperationGeneration += 1;
  if (readback.phase === "starting" || readback.phase === "playing") {
    pauseReadback();
  }
  flushPendingPair({ sound: false });
  clearQueuedInsertions();
  clearAudioPlaybackQueue();
  state.audioOn = false;
  state.starting = false;
  await audio.disable();
  updateAudioUi();
  announce(message);
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else {
    const started = await ensureAudio();
    if (started) $("spellingInput").focus({ preventScroll: true });
  }
}

function makeVoiceEvent(character, articulation, dynamics, {
  pair = null,
  soundLabel = "",
  voiceContext = state,
} = {}) {
  const targetArticulation = articulation;
  const nextCarrier = isSpellingVowel(targetArticulation)
    ? targetArticulation
    : voiceContext.carrierVowel;
  const performance = spellingPerformanceState({
    personality: state.personality,
    articulation: targetArticulation,
    carrierVowel: voiceContext.carrierVowel,
    dynamics,
  });
  const carrierPerformance = spellingPerformanceState({
    personality: state.personality,
    articulation: nextCarrier,
    carrierVowel: nextCarrier,
    dynamics: { ...dynamics, breathAccent: dynamics.breathAccent * 0.35 },
  });
  const event = {
    character,
    articulation: targetArticulation,
    carrierVowel: nextCarrier,
    personality: state.personality,
    performance,
    carrierPerformance,
    dynamics,
    pair,
    soundLabel,
  };
  if (isSpellingVowel(targetArticulation)) voiceContext.carrierVowel = targetArticulation;
  return event;
}

function showVoiceEvent(event) {
  const { performance, dynamics, pair } = event;
  const stage = $("voiceStage");
  const root = document.body.style;
  root.setProperty("--spelling-energy", dynamics.emphasis.toFixed(3));
  root.setProperty("--spelling-pace", dynamics.pace.toFixed(3));
  root.setProperty("--spelling-place", clamp01(performance.articulationPlace).toFixed(3));
  root.setProperty("--spelling-aperture", clamp01(performance.articulationAperture).toFixed(3));
  $("currentLetter").textContent = event.character.toUpperCase();
  $("currentSound").textContent = event.soundLabel || spellingSoundLabel(event.articulation);
  $("currentPair").textContent = pair
    ? `${pair.label} · ${pair.kind.toUpperCase()}`
    : `${performance.articulationManner.toUpperCase()} · ${SPELLING_PERSONALITIES[state.personality].name.toUpperCase()}`;
  const keysPerMinute = Math.round(60_000 / Math.max(70, state.averageIntervalMs));
  $("paceOut").textContent = `${keysPerMinute} keys/min`;
  $("emphasisOut").textContent = `${Math.round(dynamics.emphasis * 100)}%`;
  $("emphasisBar").style.width = `${Math.max(4, dynamics.emphasis * 100)}%`;
  stage.classList.remove("is-speaking");
  globalThis.requestAnimationFrame?.(() => stage.classList.add("is-speaking"));
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = globalThis.setTimeout(() => {
    stage.classList.remove("is-speaking");
  }, dynamics.durationMs + dynamics.releaseMs);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

async function drainAudioPlaybackQueue() {
  if (audioPlaybackDraining) return;
  audioPlaybackDraining = true;
  const generation = audioPlaybackGeneration;
  try {
    const started = await ensureAudio();
    if (!started || generation !== audioPlaybackGeneration) return;
    let previousQueuedAt = null;
    while (audioPlaybackQueue.length && generation === audioPlaybackGeneration) {
      const item = audioPlaybackQueue.shift();
      if (previousQueuedAt !== null) {
        const spacing = Math.min(180, Math.max(12, item.queuedAt - previousQueuedAt));
        await waitForAudioPlayback(spacing);
        if (generation !== audioPlaybackGeneration) return;
      }
      try {
        if (item.type === "release") audio.release(item.options);
        else audio.articulate(item.event);
      } catch (error) {
        clearAudioPlaybackQueue();
        showError(error instanceof Error ? error.message : "The voice could not play that sound.");
        announce("Spelling Synthesizer audio stopped on an invalid sound.");
        return;
      }
      previousQueuedAt = item.queuedAt;
    }
  } finally {
    audioPlaybackDraining = false;
    if (audioPlaybackQueue.length) void drainAudioPlaybackQueue();
  }
}

function queueAudioPlayback(item) {
  if (audioPlaybackQueue.length >= 48) audioPlaybackQueue.shift();
  audioPlaybackQueue.push({
    ...item,
    queuedAt: Number.isFinite(item.queuedAt) ? item.queuedAt : performance.now(),
  });
  void drainAudioPlaybackQueue();
}

function soundEvent(event, queuedAt = performance.now()) {
  queueAudioPlayback({ type: "articulate", event, queuedAt });
}

function captureTypingDynamics({ capital = false, at = performance.now() } = {}) {
  const interval = state.lastTypedAt
    ? Math.max(45, at - state.lastTypedAt)
    : state.averageIntervalMs;
  state.lastTypedAt = at;
  state.intervals.push(interval);
  state.intervals = state.intervals.slice(-7);
  state.averageIntervalMs = median(state.intervals, 320);
  const dynamics = typingDynamics({
    intervalMs: interval,
    averageIntervalMs: state.averageIntervalMs,
    amount: state.rhythmAmount,
    capital,
  });
  return dynamics;
}

function processCharacter(character, {
  capital = false,
  at = performance.now(),
  nextCharacter = "",
  articulation: resolvedArticulation = "",
} = {}) {
  const articulation = resolvedArticulation
    || spellingContextualArticulation(character, nextCharacter);
  if (!articulation) return false;
  const dynamics = captureTypingDynamics({ capital, at });
  const event = makeVoiceEvent(character, articulation, dynamics);
  state.lastStreamCharacter = character.toLowerCase();
  showVoiceEvent(event);
  soundEvent(event, at);
  return true;
}

function processResolvedPair(pair, firstCharacter, secondCharacter, {
  capital = false,
  at = performance.now(),
} = {}) {
  const dynamics = captureTypingDynamics({ capital, at });
  const source = `${firstCharacter}${secondCharacter}`;
  const glideSpacing = pair.kind === "vowel pair"
    ? Math.min(90, Math.max(38, Math.round(state.diphthongDelay * 0.62)))
    : 54;
  const events = pair.sounds.map((sound, index) => {
    const scaledDynamics = pair.sounds.length > 1
      ? {
        ...dynamics,
        durationMs: Math.max(120, dynamics.durationMs * 0.72),
        releaseMs: Math.max(32, dynamics.releaseMs * 0.72),
      }
      : dynamics;
    const event = makeVoiceEvent(source, sound.articulation, scaledDynamics, {
      pair,
      soundLabel: index === pair.sounds.length - 1 ? pair.label : sound.label,
    });
    event.pairStepIndex = index;
    event.pairStepCount = pair.sounds.length;
    return event;
  });
  state.lastStreamCharacter = secondCharacter.toLowerCase();
  showVoiceEvent(events.at(-1));
  const audibleEvents = state.engine === "tube" ? events : events.slice(0, 1);
  audibleEvents.forEach((event, index) => soundEvent(event, at + index * glideSpacing));
  return true;
}

function scheduleTypedCharacter(character, options = {}) {
  const at = Number.isFinite(options.at) ? options.at : performance.now();
  const position = Number.isFinite(options.position) ? options.position : null;
  if (pendingPair) {
    const pending = pendingPair;
    globalThis.clearTimeout(pending.timer);
    pendingPair = null;
    const adjacent = pending.options.position === null
      || position === null
      || position === pending.options.position + pending.character.length;
    const pair = state.pairGlides && adjacent
      ? spellingPair(pending.character, character)
      : null;
    if (pair) {
      return processResolvedPair(pair, pending.character, character, {
        capital: Boolean(pending.options.capital || options.capital),
        at,
      });
    }
    processCharacter(pending.character, {
      ...pending.options,
      nextCharacter: character,
    });
  }
  if (
    state.pairGlides
    && state.diphthongDelay > 0
    && isSpellingPairPrefix(character)
  ) {
    const pending = {
      character,
      options: { ...options, at, position },
      timer: 0,
    };
    pending.timer = globalThis.setTimeout(() => {
      if (pendingPair !== pending) return;
      pendingPair = null;
      processCharacter(pending.character, pending.options);
    }, state.diphthongDelay);
    pendingPair = pending;
    return true;
  }
  return processCharacter(character, { ...options, at });
}

function processBoundary(character) {
  flushPendingPair();
  state.lastStreamCharacter = "";
  state.lastTypedAt = 0;
  const options = {
    releaseMs: /[.!?]/.test(character) ? 120 : 62,
    performance: spellingPerformanceState({
      personality: state.personality,
      articulation: state.carrierVowel,
      carrierVowel: state.carrierVowel,
    }),
  };
  if (
    state.audioOn
    || state.starting
    || startPromise
    || audioPlaybackDraining
    || audioPlaybackQueue.length
  ) queueAudioPlayback({ type: "release", options });
  $("currentPair").textContent = /[.!?]/.test(character) ? "PHRASE END" : "BREATH";
}

function queueInsertedText(text) {
  clearQueuedInsertions();
  flushPendingPair();
  const source = [...String(text ?? "")].slice(0, 32).join("");
  const tokens = spellingTokens(source, {
    joinPairs: state.pairGlides && state.diphthongDelay > 0,
  });
  tokens.forEach((token, index) => {
    const timer = globalThis.setTimeout(() => {
      if (token.type === "boundary") processBoundary(token.source);
      else if (token.source.length === 2) {
        processResolvedPair(
          spellingPair(token.source[0], token.source[1]),
          token.source[0],
          token.source[1],
          { capital: token.source !== token.source.toLowerCase() },
        );
      } else processCharacter(token.source, {
        capital: token.source !== token.source.toLowerCase(),
        articulation: token.sounds[0]?.articulation,
      });
    }, index * 88);
    queuedInsertTimers.push(timer);
  });
}

function performInsertedText(text, { position = null } = {}) {
  const source = String(text ?? "");
  const characters = [...source];
  if (characters.length !== 1) {
    queueInsertedText(source);
    return;
  }
  const character = characters[0];
  if (BOUNDARY_PATTERN.test(character)) {
    processBoundary(character);
    return;
  }
  if (spellingArticulation(character)) {
    scheduleTypedCharacter(character, {
      capital: /^[a-z]$/i.test(character) && character === character.toUpperCase(),
      position,
    });
  }
}

function handleEditorKeydown(event) {
  if (
    event.defaultPrevented
    || event.isComposing
    || state.composing
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.repeat
  ) return;
  const character = event.key;
  if (spellingArticulation(character)) void ensureAudio();
  if (
    character.length === 1
    && (BOUNDARY_PATTERN.test(character) || spellingArticulation(character))
  ) interruptReadbackForTyping();
  if (character.length === 1 && BOUNDARY_PATTERN.test(character)) {
    clearPendingNativeInput();
    pendingNativeInput = character;
    pendingNativeTimer = globalThis.setTimeout(clearPendingNativeInput, 500);
    processBoundary(character);
    return;
  }
  if (spellingArticulation(character)) {
    const input = $("spellingInput");
    state.lastStreamCharacter = previousTypedLetter(input.value, input.selectionStart);
    clearPendingNativeInput();
    pendingNativeInput = character;
    pendingNativeTimer = globalThis.setTimeout(clearPendingNativeInput, 500);
    scheduleTypedCharacter(character, {
      capital: /^[a-z]$/i.test(character)
        && (event.shiftKey || character === character.toUpperCase()),
      position: input.selectionStart,
    });
  }
}

function cancelPendingEditorPerformance(next) {
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearPendingNativeInput();
  clearAudioPlaybackQueue();
  const input = $("spellingInput");
  state.lastStreamCharacter = previousTypedLetter(next, input.selectionStart);
  state.lastTypedAt = 0;
  state.intervals = [];
  state.averageIntervalMs = 320;
  if (state.audioOn) audio.release({ releaseMs: 38 });
}

function handleEditorInput(event) {
  const input = $("spellingInput");
  const previous = state.editorText;
  const next = input.value;
  const inserted = insertedText(previous, next);
  const edit = spellingTextEdit(previous, next);
  const inputType = String(event?.inputType ?? "");
  state.editorText = next;
  updateTextUi();
  if (state.composing) return;
  if ([...edit.inserted].some((character) => spellingArticulation(character))) {
    void ensureAudio();
  }
  if (edit.removed || edit.inserted) interruptReadbackForTyping(edit);

  const isDeletion = inputType.startsWith("delete")
    || (!inserted && next.length < previous.length);
  const isNonPerformanceReplacement = inputType === "insertReplacementText"
    || inputType.startsWith("history")
    || inputType === "insertFromDrop";
  if (isDeletion || isNonPerformanceReplacement) {
    cancelPendingEditorPerformance(next);
    return;
  }

  let unplayed = inserted;
  if (
    pendingNativeInput
    && unplayed.slice(0, pendingNativeInput.length).toLowerCase()
      === pendingNativeInput.toLowerCase()
  ) {
    unplayed = unplayed.slice(pendingNativeInput.length);
  }
  clearPendingNativeInput();
  if (unplayed) {
    state.lastStreamCharacter = previousTypedLetter(
      next,
      Math.max(0, (input.selectionStart ?? next.length) - unplayed.length),
    );
    performInsertedText(unplayed, {
      position: edit.start + Math.max(0, edit.inserted.length - unplayed.length),
    });
  }
}

async function selectEngine(name, { preview = true, announceSelection = true } = {}) {
  if (!SPELLING_ENGINES[name] || state.switching) return;
  const generation = ++audioOperationGeneration;
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  state.switching = true;
  clearError();
  state.engine = name;
  updateEngineUi();
  const operation = (async () => {
    if (startPromise) await startPromise;
    return audio.selectEngine(name);
  })();
  engineSwitchPromise = operation;
  let actual = name;
  let selected = false;
  try {
    actual = await operation;
    if (generation !== audioOperationGeneration) {
      await audio.disable();
      return;
    }
    state.engine = actual;
    selected = true;
    if (announceSelection) announce(`${SPELLING_ENGINES[actual].name} selected.`);
  } catch (error) {
    state.engine = audio.activeEngine;
    state.audioOn = audio.running;
    if (error?.name !== "AbortError") {
      showError(error instanceof Error ? error.message : "The engine could not start.");
    }
  } finally {
    if (engineSwitchPromise === operation) engineSwitchPromise = null;
    state.switching = false;
    updateUi();
  }
  if (selected && preview && state.audioOn) previewVoice();
}

function selectPersonality(name) {
  if (!SPELLING_PERSONALITIES[name]) return;
  state.personality = name;
  updatePersonalityUi();
  if (state.audioOn) previewVoice();
  announce(`${SPELLING_PERSONALITIES[name].name} personality selected.`);
}

function previewVoice() {
  const dynamics = typingDynamics({
    intervalMs: 360,
    averageIntervalMs: 360,
    amount: state.rhythmAmount * 0.55,
  });
  const event = makeVoiceEvent(state.carrierVowel, state.carrierVowel, dynamics);
  showVoiceEvent(event);
  soundEvent(event);
}

function clearEditor() {
  forgetReadback();
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  clearPendingNativeInput();
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  $("voiceStage").classList.remove("is-speaking");
  $("spellingInput").value = "";
  state.editorText = "";
  state.composing = false;
  state.compositionStartText = "";
  state.lastStreamCharacter = "";
  state.lastTypedAt = 0;
  state.intervals = [];
  state.averageIntervalMs = 320;
  state.carrierVowel = "a";
  audio.release({ releaseMs: 45 });
  $("currentLetter").textContent = "A";
  $("currentSound").textContent = "AE";
  $("currentPair").textContent = "READY";
  $("paceOut").textContent = "waiting";
  $("emphasisOut").textContent = "24%";
  $("emphasisBar").style.width = "24%";
  updateTextUi();
  $("spellingInput").focus({ preventScroll: true });
}

async function resetInstrument() {
  state.engine = DEFAULTS.engine;
  state.personality = DEFAULTS.personality;
  state.level = DEFAULTS.level;
  state.rhythmAmount = DEFAULTS.rhythmAmount;
  state.diphthongDelay = DEFAULTS.diphthongDelay;
  state.pairGlides = DEFAULTS.pairGlides;
  clearEditor();
  clearError();
  updateUi();
  audio.setLevel(state.level);
  await selectEngine(state.engine, { preview: false, announceSelection: false });
  updateUi();
  announce("Spelling Synthesizer reset.");
}

$("audioButton").addEventListener("click", () => void toggleAudio());
$("clearButton").addEventListener("click", clearEditor);
$("readbackButton").addEventListener("click", toggleReadback);
$("readbackStartOver").addEventListener("click", () => startReadback({ restart: true }));
$("resetButton").addEventListener("click", () => void resetInstrument());

$("level").addEventListener("input", (event) => {
  state.level = Math.min(0.82, Math.max(0, Number(event.target.value) || 0));
  audio.setLevel(state.level);
  updateControlUi();
});

$("rhythmAmount").addEventListener("input", (event) => {
  state.rhythmAmount = clamp01(event.target.value);
  updateControlUi();
});

$("diphthongDelay").addEventListener("input", (event) => {
  state.diphthongDelay = Math.min(320, Math.max(0, Math.round(Number(event.target.value) || 0)));
  updateControlUi();
});

$("pairGlidesButton").addEventListener("click", () => {
  state.pairGlides = !state.pairGlides;
  if (!state.pairGlides) flushPendingPair();
  updateControlUi();
  announce(`Letter-pair joining ${state.pairGlides ? "on" : "off"}.`);
});

for (const button of $("engineButtons").querySelectorAll("[data-engine]")) {
  button.addEventListener("click", () => void selectEngine(button.dataset.engine));
}

for (const button of $("personalityButtons").querySelectorAll("[data-personality]")) {
  button.addEventListener("click", () => selectPersonality(button.dataset.personality));
}

$("spellingInput").addEventListener("keydown", handleEditorKeydown);
$("spellingInput").addEventListener("input", handleEditorInput);
$("spellingInput").addEventListener("compositionstart", () => {
  interruptReadbackForTyping();
  clearReadbackResumeTimer();
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearPendingNativeInput();
  state.composing = true;
  state.compositionStartText = state.editorText;
});
$("spellingInput").addEventListener("compositionend", () => {
  state.composing = false;
  const input = $("spellingInput");
  const edit = spellingTextEdit(state.compositionStartText, input.value);
  const addition = insertedText(state.compositionStartText, input.value);
  state.editorText = input.value;
  if (edit.removed || edit.inserted) interruptReadbackForTyping(edit);
  if (addition) {
    state.lastStreamCharacter = previousTypedLetter(
      input.value,
      Math.max(0, (input.selectionStart ?? input.value.length) - addition.length),
    );
    performInsertedText(addition, { position: edit.start });
  }
  updateTextUi();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  audioOperationGeneration += 1;
  if (readback.phase === "starting" || readback.phase === "playing") {
    pauseReadback({ announceMessage: "Readback paused because this tab was hidden." });
  }
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  state.audioOn = false;
  state.starting = false;
  void audio.disable().finally(updateAudioUi);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  void stopAudio();
});

globalThis.addEventListener?.("pagehide", (event) => {
  audioOperationGeneration += 1;
  pauseReadback({ phase: "paused" });
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  state.audioOn = false;
  state.starting = false;
  if (event.persisted) void audio.disable();
  else void audio.close();
});

globalThis.addEventListener?.("pageshow", (event) => {
  if (!event.persisted) return;
  state.audioOn = false;
  state.starting = false;
  updateAudioUi();
});

updateUi();
