import { REST_MOUTH, spellingMouthPose, blendMouthPose, spellingMouthPaths } from "./spelling-mouth.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { schema, presets, randomize } from "./full-presets.js";
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
  spellingMidiCharacter,
  spellingPair,
  spellingPerformanceState,
  spellingSoundLabel,
  spellingTextEdit,
  spellingTokens,
  typingDynamics,
} from "./spelling-synthesizer.js";
import { SpellingSynthesizerAudio } from "./spelling-synthesizer-audio.js";
import {
  loadSpellingPronunciations,
  spellingPhoneDefinition,
  spellingPronunciationTokens,
} from "./spelling-pronunciation.js";

const $ = (id) => document.getElementById(id);
const BOUNDARY_PATTERN = /\s|[.!?,;:]/;
const SAMPLE_TONES = Object.freeze({ clear: "Open", warm: "Soft", whisper: "Bright", reed: "Brighter", creature: "Dark" });

const ENGINE_COLORS = Object.freeze({
  tube: Object.freeze({ color: "#d8ff57", rgb: "216, 255, 87" }),
  diphone: Object.freeze({ color: "#79dcff", rgb: "121, 220, 255" }),
  vocoder: Object.freeze({ color: "#ffcb69", rgb: "255, 203, 105" }),
  bell: Object.freeze({ color: "#f7a4dd", rgb: "247, 164, 221" }),
  lpc: Object.freeze({ color: "#ff9c62", rgb: "255, 156, 98" }),
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
let mouthFrame = 0;
let pageActive = true;
let mouthPose = { ...REST_MOUTH };
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
  // Live transport choice: factory presets and Random must not overwrite it.
  loop: false,
  speed: 1,
  nextPhone: 0,
  nextGesture: 0,
  timerDeadline: 0,
  timerSpeed: 1,
  timerCallback: null,
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
  balancedOutput: true,
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
  $("readbackSpeed").value = String(readback.speed);
  $("readbackSpeedOut").textContent = `${readback.speed.toFixed(2)}×`;
  $("readbackSpeed").setAttribute("aria-valuetext", `${readback.speed.toFixed(2)} times normal speed`);
  setPressed($("readbackLoop"), readback.loop);
  $("readbackLoop").title = `Loop readback: ${readback.loop ? "on" : "off"}`;
  const labels = {
    idle: "Read it back to me",
    starting: "Preparing voice…",
    playing: "Pause readback",
    paused: "Resume readback",
    interrupted: "Continue readback",
    complete: "Read it again",
  };
  button.setAttribute("aria-label", labels[readback.phase] ?? labels.idle);
  button.title = labels[readback.phase] ?? labels.idle;
  // Preparing a new voice must still leave Pause reachable.
  button.disabled = false;
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
  restMouth();
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
  const palette = ENGINE_COLORS[state.engine];
  document.body.style.setProperty("--spelling-accent", palette.color);
  document.body.style.setProperty("--spelling-accent-rgb", palette.rgb);
  for (const button of $("engineButtons").querySelectorAll("[data-engine]")) {
    setPressed(button, button.dataset.engine === state.engine);
    button.disabled = state.switching;
  }

}

function personalityDisplayName(name = state.personality) {
  return state.engine === "diphone" ? `${SAMPLE_TONES[name]} tone` : SPELLING_PERSONALITIES[name].name;
}

function updatePersonalityUi() {
  const sample = state.engine === "diphone";
  $("personalityLabel").textContent = sample ? "Sample tone" : "Personality";
  $("personalityNote").textContent = sample
    ? "Tone only; KAL keeps its recorded voice."
    : "Pitch, breath and voice character.";
  for (const button of $("personalityButtons").querySelectorAll("[data-personality]")) {
    const key = button.dataset.personality;
    const profile = SPELLING_PERSONALITIES[key];
    setPressed(button, key === state.personality);
    button.querySelector("b").textContent = sample ? SAMPLE_TONES[key] : profile.name;
    button.querySelector("small").textContent = sample ? "sample tone" : profile.note;
    button.title = sample ? `${SAMPLE_TONES[key]} tone filter; the recorded KAL voice is unchanged` : profile.note;
  }
}

function updateAudioUi() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.starting;
  $("audioState").textContent = state.starting
    ? "starting"
    : state.audioOn
      ? SPELLING_ENGINES[state.engine].shortName.toLowerCase()
      : "off";
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

function updateUi() {
  updateEngineUi();
  updatePersonalityUi();
  updateAudioUi();
  updateControlUi();
  updateReadbackUi();
}

function clearReadbackResumeTimer() {
  if (readback.resumeTimer) globalThis.clearTimeout(readback.resumeTimer);
  readback.resumeTimer = 0;
}

function clearReadbackTimer() {
  if (readback.timer) globalThis.clearTimeout(readback.timer);
  readback.timer = 0;
  readback.timerCallback = null;
  readback.timerDeadline = 0;
}

function cancelReadbackPlayback({ release = true } = {}) {
  clearReadbackTimer();
  readback.generation += 1;
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  restMouth();
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
      const audibleEvents = ["tube", "bell"].includes(engine) ? phoneEvents : phoneEvents.slice(0, 1);
      const internalSpacingMs = definition.vowel ? 52 : 38;
      let phoneEndMs = cursorMs;
      audibleEvents.forEach((event, gestureIndex) => {
        const offsetMs = cursorMs + gestureIndex * internalSpacingMs;
        steps.push({ event, offsetMs, phoneIndex, gestureIndex });
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
  const delay = Math.max(0, Math.round(delayMs / readback.speed));
  readback.timerCallback = callback;
  readback.timerSpeed = readback.speed;
  readback.timerDeadline = performance.now() + delay;
  readback.timer = globalThis.setTimeout(() => {
    readback.timer = 0;
    readback.timerCallback = null;
    if (generation !== readback.generation || readback.phase !== "playing") return;
    callback();
  }, delay);
}

function setReadbackSpeed(value) {
  const number = Number(value);
  const speed = Number.isFinite(number) ? Math.min(2, Math.max(0.5, number)) : 1;
  const remaining = Math.max(0, readback.timerDeadline - performance.now()) * readback.timerSpeed;
  const callback = readback.timerCallback;
  readback.speed = speed;
  // Keep the elapsed fraction of the current phone or punctuation pause.
  if (callback) scheduleReadbackTimer(callback, remaining, readback.generation);
  updateReadbackUi();
}

function liveReadbackEvent(step) {
  const previous = step.event;
  const phone = previous.word.phones[step.phoneIndex];
  const definition = spellingPhoneDefinition(phone.id);
  const event = makeVoiceEvent(previous.character, previous.articulation,
    readbackDynamics(previous.word, phone, definition), {
      soundLabel: previous.soundLabel,
      voiceContext: { carrierVowel: previous.carrierVowel },
      carrierVowel: previous.carrierVowel,
    });
  Object.assign(event, {
    word: previous.word, wordPhone: previous.wordPhone,
    wordSpeech: true, sampleKey: previous.sampleKey,
  });
  if (definition.voicing !== null) event.performance.articulationVoicing = definition.voicing;
  return event;
}

function holdReadbackForVoiceChange() {
  if (!["playing", "starting"].includes(readback.phase)) return null;
  clearReadbackResumeTimer();
  cancelReadbackPlayback();
  readback.phase = "starting";
  readback.shouldAutoResume = false;
  updateReadbackUi();
  return readback.generation;
}

function continueReadbackAfterVoiceChange(generation) {
  if (generation === null || generation !== readback.generation
      || readback.phase !== "starting" || !pageActive) return;
  void prepareReadback(generation, { automatic: true });
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
  if (readback.loop && state.audioOn && audio.running
      && readback.plan.some((entry) => entry.type === "word")) {
    // Reuse the prepared pronunciation, timing and single cancellable scheduler.
    // Preserve punctuation pauses; don't add a release that cuts the next attack.
    readback.offset = 0;
    readback.index = 0;
    readback.nextPhone = readback.nextGesture = 0;
    playReadbackEntry(generation);
    return;
  }
  audio.release({ releaseMs: 45 });
  restMouth();
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
    readback.nextPhone = readback.nextGesture = 0;
    audio.release({ releaseMs: entry.releaseMs });
    restMouth();
    $("currentPair").textContent = entry.releaseMs >= 120 ? "PHRASE END" : "BREATH";
    scheduleReadbackTimer(() => {
      readback.index += 1;
      playReadbackEntry(generation);
    }, entry.pauseMs, generation);
    return;
  }

  readback.offset = entry.start;
  const playStep = (stepIndex) => {
    if (generation !== readback.generation || readback.phase !== "playing") return;
    const step = entry.steps[stepIndex];
    if (!step) return;
    const event = liveReadbackEvent(step);
    try {
      if (!audio.articulate(event)) {
        throw new Error("The selected synth engine could not play this pronunciation gesture.");
      }
      showVoiceEvent(event, { durationMs: audio.durationMs(event) });
      readback.nextPhone = step.phoneIndex;
      readback.nextGesture = step.gestureIndex + 1;
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
      readback.nextPhone = readback.nextGesture = 0;
      playReadbackEntry(generation);
    }, Math.max(18, entry.durationMs - step.offsetMs), generation);
  };
  // A backend can expand a diphthong into multiple gestures. Retain a phone +
  // gesture cursor across that change, not an engine-specific array index.
  const nextStep = entry.steps.findIndex(step => step.phoneIndex > readback.nextPhone
    || (step.phoneIndex === readback.nextPhone && step.gestureIndex >= readback.nextGesture));
  if (nextStep < 0) {
    readback.offset = entry.end;
    readback.index += 1;
    readback.nextPhone = readback.nextGesture = 0;
    playReadbackEntry(generation);
  } else playStep(nextStep);
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
  readback.nextPhone = readback.nextGesture = 0;
  readback.shouldAutoResume = false;
  updateReadbackUi();
}

async function prepareReadback(generation, { automatic = false } = {}) {
  const pronunciations = await loadSpellingPronunciations(readback.snapshot);
  if (engineSwitchPromise) {
    try { await engineSwitchPromise; } catch {}
  }
  if (
    !state.audioOn
    || !audio.running
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
  readback.phase = "playing";
  updateReadbackUi();
  if (readback.index < 0) {
    // A paused final punctuation or edited-away suffix may leave us at the end.
    finishReadback(generation);
    return;
  }
  announce(automatic
    ? "Readback continued."
    : readback.offset
      ? "Readback resumed."
      : `Reading with ${SPELLING_ENGINES[state.engine].name}, `
        + `${personalityDisplayName()}.`);
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
  if (!state.audioOn || (!audio.running && !state.switching)) {
    announce("Turn Audio on before starting readback.");
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
  readback.nextPhone = readback.nextGesture = 0;
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
  restMouth({ immediate: true });
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
    clearQueuedInsertions();
    clearAudioPlaybackQueue();
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

function mouthClock() {
  return Number.isFinite(audio.currentTime) ? audio.currentTime * 1_000 : performance.now();
}

function paintMouth(pose) {
  mouthPose = pose;
  const paths = spellingMouthPaths(pose);
  for (const [id, key] of [["mouthClip", "outline"], ["mouthOutline", "outline"],
    ["mouthLips", "lips"], ["mouthCavity", "cavity"], ["mouthTeeth", "teeth"], ["mouthTongue", "tongue"]]) {
    $(id).setAttribute("d", paths[key]);
  }
}

function moveMouth(event, durationMs = 0, immediate = false) {
  if (mouthFrame) globalThis.cancelAnimationFrame?.(mouthFrame);
  mouthFrame = 0;
  const from = mouthPose;
  const to = spellingMouthPose(event);
  // Sampled diphthongs have one audio event containing both vowel gestures.
  const glidePhones = event?.pair?.kind === "vowel pair"
    ? event.pair.sounds.map(sound => sound.articulation)
    : event?.wordPhone ? spellingPhoneDefinition(event.wordPhone)?.gestures ?? [] : [];
  const glide = !["tube", "bell"].includes(state.engine) && glidePhones.length > 1
    ? spellingMouthPose({ articulation: glidePhones.at(-1) }) : null;
  const transitionMs = !event ? 65 : to.open < .05 ? 20 : Math.min(65, Math.max(18, durationMs * .4));
  if (immediate || !globalThis.requestAnimationFrame) { paintMouth(to); return; }
  const start = mouthClock();
  const frame = () => {
    mouthFrame = 0;
    const elapsed = Math.max(0, mouthClock() - start);
    const glideProgress = Math.max(0, elapsed - transitionMs) / Math.max(80, durationMs * .7 - transitionMs);
    const target = glide ? blendMouthPose(to, glide, glideProgress) : to;
    const amount = Math.min(1, elapsed / transitionMs);
    paintMouth(blendMouthPose(from, target, amount * amount * (3 - 2 * amount)));
    if (elapsed < transitionMs || (glide && glideProgress < 1)) mouthFrame = globalThis.requestAnimationFrame(frame);
  };
  mouthFrame = globalThis.requestAnimationFrame(frame);
}

function restMouth({ immediate = false } = {}) {
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  visualTimer = 0;
  $("voiceStage").classList.remove("is-speaking");
  $("voiceStage").dataset.phone = "rest";
  $("voiceStage").setAttribute("aria-label", "Front-facing wireframe mouth, resting");
  moveMouth(null, 0, immediate || document.hidden || !pageActive);
}

function showVoiceEvent(event, { durationMs = null } = {}) {
  const { performance, dynamics, pair } = event;
  const stage = $("voiceStage");
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
  stage.classList.add("is-speaking");
  stage.dataset.phone = event.articulation;
  stage.setAttribute("aria-label", `Front-facing wireframe mouth: ${event.soundLabel || spellingSoundLabel(event.articulation)}`);
  moveMouth(event, Number.isFinite(durationMs) ? durationMs : dynamics.durationMs);
  if (visualTimer) globalThis.clearTimeout(visualTimer);
  if (!event.sustain) {
    visualTimer = globalThis.setTimeout(() => {
      restMouth();
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
        if (item.type === "release") {
          audio.release(item.options);
          restMouth();
        } else if (audio.articulate(item.event)) {
          showVoiceEvent(item.event, { durationMs: audio.durationMs(item.event) });
        }
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
  // Editing text is never permission to arm Audio. In particular, a paste
  // before Audio must not leave a suspended startup promise blocking the speaker.
  if (!state.audioOn && !state.starting) return;
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
  if (!state.audioOn && !state.starting) showVoiceEvent(event);
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
  if (!state.audioOn && !state.starting) showVoiceEvent(events.at(-1));
  const audibleEvents = ["tube", "bell"].includes(state.engine) ? events : events.slice(0, 1);
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
  if (!state.audioOn && !state.starting) restMouth();
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

function handleSpellingMidiInput(event) {
  const message = event?.detail?.message;
  if (message?.type !== "noteOn") return;
  const character = spellingMidiCharacter(message.note);
  if (!character) return;
  event.preventDefault?.();
  interruptReadbackForTyping();
  performInsertedText(character);
  announce(`MIDI note ${message.note} voiced ${character.toUpperCase()}.`);
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
    if (!state.audioOn && !state.starting) showVoiceEvent(voiceEvent);
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
  restMouth();
}

function handleEditorInput(event) {
  const input = $("spellingInput");
  const previous = state.editorText;
  const next = input.value;
  const inserted = insertedText(previous, next);
  const edit = spellingTextEdit(previous, next);
  const inputType = String(event?.inputType ?? "");
  state.editorText = next;
  if (state.composing) return;
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

async function selectEngine(name, {
  preview = true, announceSelection = true, preserveReadback = true,
} = {}) {
  if (!SPELLING_ENGINES[name] || state.switching || name === state.engine) return;
  const wasReading = readbackHasPendingPlayback();
  const readbackGeneration = preserveReadback ? holdReadbackForVoiceChange() : null;
  releaseHeldVowel({ releaseAudio: false, updateStage: false });
  const generation = ++audioOperationGeneration;
  flushPendingPair({ sound: false });
  clearAudioPlaybackQueue();
  state.switching = true;
  restMouth({ immediate: true });
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
  continueReadbackAfterVoiceChange(readbackGeneration);
  if (selected && preview && state.audioOn && !wasReading && !readbackHasPendingPlayback()) previewVoice();
}

function selectPersonality(name) {
  if (!SPELLING_PERSONALITIES[name]) return;
  const wasReading = readbackHasPendingPlayback();
  releaseHeldVowel({ updateStage: false });
  state.personality = name;
  updatePersonalityUi();
  if (state.audioOn && !wasReading) previewVoice();
  announce(`${personalityDisplayName(name)} selected.`);
}

function previewVoice() {
  const dynamics = typingDynamics({
    intervalMs: 360,
    averageIntervalMs: 360,
    amount: state.rhythmAmount * 0.55,
  });
  const event = makeVoiceEvent(state.carrierVowel, state.carrierVowel, dynamics);
  if (!state.audioOn && !state.starting) showVoiceEvent(event);
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
  restMouth({ immediate: true });
  $("voiceStage").classList.remove("is-word");
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
  $("spellingInput").focus({ preventScroll: true });
}

async function resetInstrument() {
  readback.loop = false;
  readback.speed = 1;
  state.personality = DEFAULTS.personality;
  state.level = DEFAULTS.level;
  state.rhythmAmount = DEFAULTS.rhythmAmount;
  state.diphthongDelay = DEFAULTS.diphthongDelay;
  state.pairGlides = DEFAULTS.pairGlides;
  clearEditor();
  clearError();
  updateUi();
  audio.setLevel(state.level);
  if (engineSwitchPromise) { try { await engineSwitchPromise; } catch {} }
  await selectEngine(DEFAULTS.engine, { preview: false, announceSelection: false });
  updateUi();
  announce("Spelling Synthesizer reset.");
}

$("audioButton").addEventListener("click", () => void toggleAudio());
$("clearButton").addEventListener("click", clearEditor);
$("readbackButton").addEventListener("click", toggleReadback);
$("readbackSpeed").addEventListener("input", event => setReadbackSpeed(event.target.value));
$("readbackLoop").addEventListener("click", () => {
  readback.loop = !readback.loop;
  updateReadbackUi();
  announce(readback.loop ? "Readback loop on." : "Readback loop off; this pass will finish.");
});
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
});

globalThis.addEventListener?.("morphazoid:midi-input", handleSpellingMidiInput);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  restMouth({ immediate: true });
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
  pageActive = false;
  restMouth({ immediate: true });
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
  pageActive = true;
  state.audioOn = false;
  state.starting = false;
  updateAudioUi();
});

globalThis.addEventListener?.("blur", () => releaseHeldVowel());

paintMouth(REST_MOUTH);
updateUi();

const presetController=registerHeaderPresets({id:"spelling-synthesizer",presets,randomize,capture:()=>schema.capture(state),apply:async snapshot=>{
 const next=schema.validate(snapshot);
 if(state.switching || state.starting) throw new Error("Wait for the current voice to finish loading");
 const generation = next.engine !== state.engine ? holdReadbackForVoiceChange() : null;
 try {
  if(next.engine!==state.engine) await selectEngine(next.engine,{preview:false,announceSelection:false,preserveReadback:false});
  if(state.engine!==next.engine) throw new Error("Requested voice is unavailable; previous scene retained");
  Object.assign(state,next); updateUi();
 } finally { continueReadbackAfterVoiceChange(generation); }
}});
