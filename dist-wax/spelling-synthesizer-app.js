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
import {
  loadSpellingPronunciations,
  spellingPhoneDefinition,
  spellingPronunciationTokens,
} from "./src/spelling-pronunciation.js";

const $ = (id) => document.getElementById(id);
const BOUNDARY_PATTERN = /\s|[.!?,;:]/;

const ENGINE_COLORS = Object.freeze({
  tube: Object.freeze({ color: "#d8ff57", rgb: "216, 255, 87" }),
  diphone: Object.freeze({ color: "#79dcff", rgb: "121, 220, 255" }),
  vocoder: Object.freeze({ color: "#ffcb69", rgb: "255, 203, 105" }),
});

const DEFAULTS = Object.freeze({
  engine: "diphone",
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
let heldVowel = null;

const readback = {
  phase: "idle",
  generation: 0,
  offset: 0,
  snapshot: "",
  plan: [],
  index: 0,
  timer: 0,
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
  startOver.hidden = !["paused", "interrupted"].includes(readback.phase);
}

function readbackHasPendingPlayback() {
  return readback.phase === "starting"
    || readback.phase === "playing"
    || (readback.phase === "interrupted" && readback.shouldAutoResume);
}

function median(values, fallback = 320) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
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

function physicalKeyId(event) {
  return String(event?.code || event?.key || "").toLowerCase();
}

function releaseHeldVowel({ releaseAudio = true, updateStage = true } = {}) {
  const held = heldVowel;
  heldVowel = null;
  if (!held?.sustaining) return false;
  clearAudioPlaybackQueue();
  if (releaseAudio) audio.release({ releaseMs: 72 });
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  $("voiceStage").classList.remove("is-speaking");
  if (updateStage) $("currentPair").textContent = "VOWEL · RELEASE";
  return true;
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

function clearReadbackTimer() {
  if (readback.timer) globalThis.clearTimeout(readback.timer);
  readback.timer = 0;
}

function cancelReadbackPlayback({ release = true } = {}) {
  clearReadbackTimer();
  readback.generation += 1;
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  $("voiceStage").classList.remove("is-speaking");
  if (release && audio.running) audio.release({ releaseMs: 24 });
}

function readbackBoundaryTiming(character) {
  if (/[.!?]/.test(character)) return { pauseMs: 420, releaseMs: 120 };
  if (/\n|\r/.test(character)) return { pauseMs: 240, releaseMs: 75 };
  if (/[:;]/.test(character)) return { pauseMs: 260, releaseMs: 90 };
  if (character.includes(",")) return { pauseMs: 180, releaseMs: 70 };
  return { pauseMs: 95, releaseMs: 55 };
}

function readbackDynamics(token, phone, definition) {
  const capital = /[A-Z]/.test(token.source);
  const dynamics = typingDynamics({
    intervalMs: 185,
    averageIntervalMs: 185,
    amount: state.rhythmAmount * 0.34,
    capital,
  });
  const stressedVowel = definition.vowel && phone.stress > 0;
  return {
    ...dynamics,
    durationMs: definition.vowel ? (stressedVowel ? 170 : 125) : 88,
    attackMs: definition.vowel ? 8 : 4,
    releaseMs: definition.vowel ? 34 : 24,
  };
}

function phoneCarrier(token, phoneIndex, fallback) {
  for (let index = phoneIndex; index < token.phones.length; index += 1) {
    const definition = spellingPhoneDefinition(token.phones[index].id);
    if (!definition?.vowel) continue;
    return definition.gestures.find((gesture) => isSpellingVowel(gesture)) ?? fallback;
  }
  return fallback;
}

function buildReadbackPlan(text, pronunciations) {
  const tokens = spellingPronunciationTokens(text, pronunciations);
  const voiceContext = { carrierVowel: "a" };
  const personality = state.personality;
  const engine = state.engine;
  const plan = [];

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token.type === "boundary") {
      let end = token.end;
      let pauseMs = 0;
      let releaseMs = 0;
      while (index < tokens.length && tokens[index].type === "boundary") {
        const boundary = readbackBoundaryTiming(tokens[index].source);
        pauseMs = Math.max(pauseMs, boundary.pauseMs);
        releaseMs = Math.max(releaseMs, boundary.releaseMs);
        end = tokens[index].end;
        index += 1;
      }
      plan.push({ type: "boundary", start: token.start, end, pauseMs, releaseMs });
      continue;
    }

    const events = [];
    const steps = [];
    let cursorMs = 0;
    for (let phoneIndex = 0; phoneIndex < token.phones.length; phoneIndex += 1) {
      const phone = token.phones[phoneIndex];
      const definition = spellingPhoneDefinition(phone.id);
      if (!definition) continue;
      const dynamics = readbackDynamics(token, phone, definition);
      const carrierVowel = phoneCarrier(token, phoneIndex, voiceContext.carrierVowel);
      const phoneEvents = definition.gestures.map((articulation, gestureIndex) => {
        const event = makeVoiceEvent(token.source, articulation, dynamics, {
          soundLabel: phone.id,
          voiceContext,
          personality,
          carrierVowel,
        });
        event.word = token;
        event.wordPhone = phone.id;
        event.wordSpeech = true;
        event.sampleKey = gestureIndex === 0 ? definition.sampleKey : "";
        if (definition.voicing !== null) {
          event.performance.articulationVoicing = definition.voicing;
        }
        return event;
      });
      events.push(...phoneEvents);
      const audibleEvents = engine === "tube" ? phoneEvents : phoneEvents.slice(0, 1);
      const internalSpacingMs = definition.vowel ? 52 : 38;
      let phoneEndMs = cursorMs;
      audibleEvents.forEach((event, gestureIndex) => {
        const offsetMs = cursorMs + gestureIndex * internalSpacingMs;
        steps.push({ event, offsetMs });
        phoneEndMs = Math.max(
          phoneEndMs,
          offsetMs + Math.max(0, audio.durationMs?.(event) ?? 100),
        );
      });
      const overlapMs = definition.vowel ? 28 : 16;
      cursorMs = Math.max(cursorMs + (definition.vowel ? 82 : 44), phoneEndMs - overlapMs);
    }
    if (!steps.length) {
      index += 1;
      continue;
    }
    const lastStep = steps.at(-1);
    const durationMs = Math.max(
      cursorMs,
      lastStep.offsetMs + Math.max(0, audio.durationMs?.(lastStep.event) ?? 100),
    ) + 20;
    plan.push({
      type: "word",
      start: token.start,
      end: token.end,
      token,
      events,
      steps,
      durationMs,
    });
    index += 1;
  }
  return plan;
}

function scheduleReadbackTimer(callback, delayMs, generation) {
  clearReadbackTimer();
  readback.timer = globalThis.setTimeout(() => {
    readback.timer = 0;
    if (generation !== readback.generation || readback.phase !== "playing") return;
    callback();
  }, Math.max(0, Math.round(delayMs)));
}

function failReadback(error, generation) {
  if (generation !== readback.generation) return;
  cancelReadbackPlayback();
  readback.phase = "paused";
  readback.shouldAutoResume = false;
  showError(error instanceof Error ? error.message : "The selected synth engine could not play readback.");
  updateReadbackUi();
  announce("Readback stopped.");
}

function finishReadback(generation) {
  if (generation !== readback.generation || readback.phase !== "playing") return;
  clearReadbackTimer();
  audio.release({ releaseMs: 45 });
  readback.offset = readback.snapshot.length;
  readback.phase = "complete";
  readback.shouldAutoResume = false;
  updateReadbackUi();
  announce("Readback finished.");
}

function playReadbackEntry(generation) {
  if (generation !== readback.generation || readback.phase !== "playing") return;
  const entry = readback.plan[readback.index];
  if (!entry) {
    finishReadback(generation);
    return;
  }
  if (entry.type === "boundary") {
    readback.offset = entry.end;
    audio.release({ releaseMs: entry.releaseMs });
    $("currentPair").textContent = entry.releaseMs >= 120 ? "PHRASE END" : "BREATH";
    scheduleReadbackTimer(() => {
      readback.index += 1;
      playReadbackEntry(generation);
    }, entry.pauseMs, generation);
    return;
  }

  readback.offset = entry.start;
  showVoiceEvent(entry.events.at(-1), { durationMs: entry.durationMs });
  const playStep = (stepIndex) => {
    if (generation !== readback.generation || readback.phase !== "playing") return;
    const step = entry.steps[stepIndex];
    if (!step) return;
    try {
      if (!audio.articulate(step.event)) {
        throw new Error("The selected synth engine could not play this pronunciation gesture.");
      }
    } catch (error) {
      failReadback(error, generation);
      return;
    }
    const next = entry.steps[stepIndex + 1];
    if (next) {
      scheduleReadbackTimer(
        () => playStep(stepIndex + 1),
        next.offsetMs - step.offsetMs,
        generation,
      );
      return;
    }
    scheduleReadbackTimer(() => {
      readback.offset = entry.end;
      readback.index += 1;
      playReadbackEntry(generation);
    }, Math.max(18, entry.durationMs - step.offsetMs), generation);
  };
  playStep(0);
}

function pauseReadback({
  phase = "paused",
  announceMessage = "",
  autoResume = false,
} = {}) {
  const wasActive = readback.phase === "starting" || readback.phase === "playing";
  clearReadbackResumeTimer();
  if (wasActive || readback.timer) cancelReadbackPlayback({ release: wasActive });
  readback.phase = phase;
  readback.shouldAutoResume = autoResume;
  updateReadbackUi();
  if (announceMessage) announce(announceMessage);
}

function forgetReadback() {
  clearReadbackResumeTimer();
  cancelReadbackPlayback({
    release: readback.phase === "starting" || readback.phase === "playing",
  });
  readback.phase = "idle";
  readback.offset = 0;
  readback.snapshot = "";
  readback.plan = [];
  readback.index = 0;
  readback.shouldAutoResume = false;
  updateReadbackUi();
}

async function prepareReadback(generation, { automatic = false } = {}) {
  const [started, pronunciations] = await Promise.all([
    ensureAudio(),
    loadSpellingPronunciations(readback.snapshot),
  ]);
  if (
    !started
    || generation !== readback.generation
    || readback.phase !== "starting"
  ) {
    if (generation === readback.generation && readback.phase === "starting") {
      readback.phase = "paused";
      updateReadbackUi();
    }
    return;
  }
  readback.plan = buildReadbackPlan(readback.snapshot, pronunciations);
  readback.index = readback.plan.findIndex((entry) => entry.end > readback.offset);
  if (readback.index < 0) {
    audio.release({ releaseMs: 45 });
    readback.phase = "complete";
    readback.offset = readback.snapshot.length;
    updateReadbackUi();
    announce("Readback finished.");
    return;
  }
  readback.phase = "playing";
  updateReadbackUi();
  announce(automatic
    ? "Readback continued."
    : readback.offset
      ? "Readback resumed."
      : `Reading with ${SPELLING_ENGINES[state.engine].name}, `
        + `${SPELLING_PERSONALITIES[state.personality].name}.`);
  playReadbackEntry(generation);
}

function startReadback({ restart = false, automatic = false } = {}) {
  const text = $("spellingInput").value;
  if (!text.trim()) {
    forgetReadback();
    announce("Type something first.");
    return false;
  }
  if (!/[A-Za-z]/.test(text)) {
    forgetReadback();
    readback.phase = "complete";
    readback.offset = text.length;
    updateReadbackUi();
    announce("No playable words were found.");
    return false;
  }
  clearError();
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  clearReadbackResumeTimer();
  cancelReadbackPlayback({ release: state.audioOn });
  flushPendingPair({ sound: false });
  clearQueuedInsertions();
  clearAudioPlaybackQueue();
  if (restart || readback.phase === "idle" || readback.phase === "complete") {
    readback.offset = 0;
  }
  readback.snapshot = text;
  readback.offset = Math.min(text.length, Math.max(0, readback.offset));
  readback.phase = "starting";
  readback.shouldAutoResume = false;
  const generation = readback.generation;
  updateReadbackUi();
  void prepareReadback(generation, { automatic });
  return true;
}

function scheduleReadbackContinuation() {
  clearReadbackResumeTimer();
  if (!readback.shouldAutoResume || !$("spellingInput").value.trim()) return;
  const generation = readback.generation;
  readback.resumeTimer = globalThis.setTimeout(() => {
    readback.resumeTimer = 0;
    if (
      generation !== readback.generation
      || readback.phase !== "interrupted"
      || !readback.shouldAutoResume
    ) return;
    if (heldVowel) {
      scheduleReadbackContinuation();
      return;
    }
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
    cancelReadbackPlayback();
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
    pauseReadback({ announceMessage: "Readback paused." });
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
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  if (readbackHasPendingPlayback()) {
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
  personality = state.personality,
  carrierVowel = voiceContext.carrierVowel,
} = {}) {
  const targetArticulation = articulation;
  const activeCarrier = isSpellingVowel(carrierVowel)
    ? carrierVowel
    : voiceContext.carrierVowel;
  const nextCarrier = isSpellingVowel(targetArticulation)
    ? targetArticulation
    : activeCarrier;
  const performance = spellingPerformanceState({
    personality,
    articulation: targetArticulation,
    carrierVowel: activeCarrier,
    dynamics,
  });
  const carrierPerformance = spellingPerformanceState({
    personality,
    articulation: nextCarrier,
    carrierVowel: nextCarrier,
    dynamics: { ...dynamics, breathAccent: dynamics.breathAccent * 0.35 },
  });
  const event = {
    character,
    articulation: targetArticulation,
    carrierVowel: nextCarrier,
    personality,
    performance,
    carrierPerformance,
    dynamics,
    pair,
    soundLabel,
  };
  if (isSpellingVowel(targetArticulation)) voiceContext.carrierVowel = targetArticulation;
  return event;
}

function showVoiceEvent(event, { durationMs = null } = {}) {
  const { performance, dynamics, pair } = event;
  const stage = $("voiceStage");
  const root = document.body.style;
  root.setProperty("--spelling-energy", dynamics.emphasis.toFixed(3));
  root.setProperty("--spelling-pace", dynamics.pace.toFixed(3));
  root.setProperty("--spelling-place", clamp01(performance.articulationPlace).toFixed(3));
  root.setProperty("--spelling-aperture", clamp01(performance.articulationAperture).toFixed(3));
  const wordPhones = event.word?.phones?.map((phone) => phone.id).join(" ") ?? "";
  stage.classList.toggle("is-word", Boolean(event.word));
  $("currentLetter").textContent = (event.word?.source ?? event.character).toUpperCase();
  $("currentSound").textContent = wordPhones
    || event.soundLabel
    || spellingSoundLabel(event.articulation);
  $("currentPair").textContent = event.word
    ? `WORD · ${SPELLING_PERSONALITIES[event.personality].name.toUpperCase()}`
    : event.sustain
    ? "HELD VOWEL · SUSTAIN"
    : pair
    ? `${pair.label} · ${pair.kind.toUpperCase()}`
    : `${performance.articulationManner.toUpperCase()} · ${SPELLING_PERSONALITIES[state.personality].name.toUpperCase()}`;
  stage.classList.remove("is-speaking");
  globalThis.requestAnimationFrame?.(() => stage.classList.add("is-speaking"));
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  if (!event.sustain) {
    visualTimer = globalThis.setTimeout(() => {
      stage.classList.remove("is-speaking");
    }, Number.isFinite(durationMs) ? durationMs : dynamics.durationMs + dynamics.releaseMs);
  }
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
  ) return;
  const character = event.key;
  const vowel = character?.length === 1 && isSpellingVowel(character);
  const keyId = physicalKeyId(event);
  if (event.repeat) {
    if (!vowel) return;
    event.preventDefault();
    if (!heldVowel || heldVowel.keyId !== keyId) {
      heldVowel = {
        keyId,
        character,
        capital: character === character.toUpperCase(),
        sustaining: false,
      };
    }
    if (heldVowel.sustaining) return;
    if (pendingPair?.character.toLowerCase() === character.toLowerCase()) {
      flushPendingPair({ sound: false });
    } else flushPendingPair();
    clearAudioPlaybackQueue();
    const dynamics = typingDynamics({
      intervalMs: state.averageIntervalMs,
      averageIntervalMs: state.averageIntervalMs,
      amount: state.rhythmAmount,
      capital: heldVowel.capital,
    });
    const articulation = spellingArticulation(character);
    const voiceEvent = makeVoiceEvent(character, articulation, dynamics);
    voiceEvent.sustain = true;
    heldVowel.sustaining = true;
    state.lastStreamCharacter = character.toLowerCase();
    showVoiceEvent(voiceEvent);
    soundEvent(voiceEvent);
    return;
  }
  if (heldVowel) releaseHeldVowel({ updateStage: false });
  if (vowel) {
    heldVowel = {
      keyId,
      character,
      capital: character === character.toUpperCase(),
      sustaining: false,
    };
  }
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

function handleEditorKeyup(event) {
  if (!heldVowel || heldVowel.keyId !== physicalKeyId(event)) return;
  releaseHeldVowel();
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
  if (readbackHasPendingPlayback()) {
    pauseReadback({ announceMessage: "Readback paused while the engine changed." });
  }
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
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
  if (readbackHasPendingPlayback()) {
    pauseReadback({ announceMessage: "Readback paused while the personality changed." });
  }
  releaseHeldVowel({ updateStage: false });
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
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  forgetReadback();
  clearQueuedInsertions();
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  clearPendingNativeInput();
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  $("voiceStage").classList.remove("is-speaking", "is-word");
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
  if (readbackHasPendingPlayback()) {
    pauseReadback({ announceMessage: "Readback paused while letter-pair joining changed." });
  }
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
$("spellingInput").addEventListener("keyup", handleEditorKeyup);
$("spellingInput").addEventListener("blur", () => releaseHeldVowel());
$("spellingInput").addEventListener("input", handleEditorInput);
$("spellingInput").addEventListener("compositionstart", () => {
  releaseHeldVowel();
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
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  audioOperationGeneration += 1;
  if (readbackHasPendingPlayback()) {
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
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  audioOperationGeneration += 1;
  if (readbackHasPendingPlayback()) pauseReadback({ phase: "paused" });
  else clearReadbackResumeTimer();
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

globalThis.addEventListener?.("blur", () => releaseHeldVowel());

updateUi();
