import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_LIMITS,
  JAW_HARP_PRESETS,
  JAW_HARP_RANDOM_LIMITS,
  JAW_HARP_RHYTHMS,
  JAW_HARP_STYLE_CUSTOM_ID,
  JAW_HARP_STYLE_GESTURE_KEYS,
  JAW_HARP_STYLE_REFERENCES,
  JAW_HARP_STYLE_SETTING_KEYS,
  JAW_HARP_VOWEL_SEQUENCES,
  MAX_TINE_PULL,
  VOWEL_PRESETS,
  applyJawHarpStyle,
  applyVowel,
  breathCycleFlow,
  breathLobeBoundaryCount,
  clamp,
  dominantHarmonic,
  effectiveBreathRateBpm,
  jawHarpPreset,
  jawHarpRhythm,
  jawHarpRhythmHit,
  jawHarpState,
  jawHarpStyle,
  jawHarpStyleGesture,
  jawHarpVowelSequence,
  jawHarpVowelSequenceStep,
  mouthFormants,
  mouthGeometry,
  naturalTineStrike,
  pluckForceFromPull,
  randomizeJawHarpState,
  reedMaterialProperties,
  repeatIntervalMs,
  sanitizeJawHarpState,
  tineReleaseMotion,
  vowelPreset,
} from "./src/jaw-harp.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_SPECS = Object.freeze([
  { key: "reedFrequencyHz", format: (value) => `${Math.round(value)} Hz` },
  { key: "reedDecaySeconds", format: (value) => `${value.toFixed(1)} s` },
  { key: "reedStiffness", format: formatPercent },
  { key: "pluckPosition", format: formatPercent },
  { key: "pluckForce", format: formatPercent },
  { key: "tonguePosition", format: (value) => `${Math.round(value * 100)}% front`, mouth: true },
  { key: "tongueHeight", format: formatPercent, mouth: true },
  { key: "jawOpening", format: formatPercent, mouth: true },
  { key: "lipRounding", format: formatPercent, mouth: true },
  { key: "formantFocus", format: formatPercent, mouth: true },
  { key: "cavityCoupling", format: formatPercent },
  { key: "frameCoupling", format: formatPercent },
  { key: "dryResonance", format: formatPercent },
  { key: "glottisOpening", format: formatPercent, mouth: true },
  { key: "breathDepth", format: formatPercent },
  { key: "breathNoiseAmount", format: formatPercent },
  { key: "breathFilter", format: (value) => `${Math.round(value * 100)}% open` },
  { key: "breathRateBpm", format: (value) => `${Math.round(value)} cycles/min` },
  { key: "breathBalance", format: (value) => `${Math.round(value * 100)} / ${Math.round((1 - value) * 100)}` },
  { key: "repeatRateBpm", format: (value) => `${Math.round(value)} BPM` },
  { key: "repeatSwing", format: (value) => `${Math.round(value * 100)}%` },
]);
const STYLE_SETTING_KEYS = new Set(JAW_HARP_STYLE_SETTING_KEYS);
// Randomized models can legitimately retain a near-zero performance force. Keep
// that setting intact, but use a dependable strike for the one-shot audition.
const RANDOMIZE_AUDITION_FORCE_FLOOR = JAW_HARP_DEFAULTS.pluckForce;

let state = jawHarpState("khomus");
let activeVowelId = "a";
let sequencedVowelId = null;
let vowelSequenceActiveStep = 0;
let vowelSequenceNextStep = 0;
let vowelSequenceBreathDirection = -1;
let referencePerformanceBaseline = null;
let referenceGestureStep = 0;
let audioContext = null;
let graph = null;
let audioPresentationStatus = "off";
let audioStartupPromise = null;
let audioDesiredOn = false;
let audioTransitionGeneration = 0;
let pageIsActive = true;
let pageLifecycleGeneration = 0;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let pointerDrag = null;
let tineIsHeld = false;
let tineReleaseGeneration = 0;
let performanceIntentGeneration = 0;
let pluckRequestSerial = 0;
let animationFrame = 0;
let lastPluckAt = -Infinity;
let pluckFlash = 0;
let visualTineRelease = null;
let repeatStep = 0;
let repeatHitCount = 0;
let nextRepeatAt = 0;
let repeatClockParkSerial = 0;
let repeatClockParkOwner = 0;
let breathCycleStartedAt = performance.now();
let breathSequenceLastAt = breathCycleStartedAt;
let breathSequencePhase = 0;
let manualBreathDirection = 0;
let manualBreathGeneration = 0;
let manualBreathOwner = null;
let commandedBreathFlow = 0;
let visualBreathFlow = 0;
let lastBreathTelemetryAt = -Infinity;
let waveform = new Float32Array(1024);
let telemetry = {
  displacement: 0,
  energy: 0,
  peak: 0,
  rms: 0,
  breathFlow: 0,
  formants: mouthFormants(state).frequenciesHz,
  ...dominantHarmonic(state),
};

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

const ARTICULATION_VISUAL_NEGATIVE = 0.42;
const ARTICULATION_VISUAL_POSITIVE = 0.58;
const ARTICULATION_VISUAL_MIN = -ARTICULATION_VISUAL_NEGATIVE * (1 - Math.exp(-2));
const ARTICULATION_VISUAL_MAX = 1 + ARTICULATION_VISUAL_POSITIVE * (1 - Math.exp(-2));

function articulationToVisual(value) {
  const amount = clamp(value, -2, 3);
  if (amount < 0) return -ARTICULATION_VISUAL_NEGATIVE * (1 - Math.exp(amount));
  if (amount > 1) return 1 + ARTICULATION_VISUAL_POSITIVE * (1 - Math.exp(1 - amount));
  return amount;
}

function rangeUnit(value, limits) {
  const [minimum, maximum] = limits;
  return clamp((value - minimum) / Math.max(1e-9, maximum - minimum));
}

function rangeValue(unit, limits) {
  const [minimum, maximum] = limits;
  return minimum + clamp(unit) * (maximum - minimum);
}

function logarithmicUnit(value, limits) {
  const [minimum, maximum] = limits;
  const safeValue = clamp(value, minimum, maximum);
  return clamp(Math.log(safeValue / minimum) / Math.log(maximum / minimum));
}

function logarithmicValue(unit, limits) {
  const [minimum, maximum] = limits;
  return minimum * ((maximum / minimum) ** clamp(unit));
}

function breathFlowForDisplay(time = performance.now()) {
  if (manualBreathDirection) return commandedBreathFlow;
  const telemetryIsFresh = graph
    && audioContext?.state === "running"
    && time - lastBreathTelemetryAt < 250;
  return telemetryIsFresh ? telemetry.breathFlow : commandedBreathFlow;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  return frequency >= 1000 ? `${(frequency / 1000).toFixed(2)} kHz` : `${Math.round(frequency)} Hz`;
}

function formatCycleRate(value) {
  const cyclesPerMinute = Math.max(0, Number(value) || 0);
  if (cyclesPerMinute >= 600) {
    const cyclesPerSecond = cyclesPerMinute / 60;
    return `${cyclesPerSecond >= 10 ? cyclesPerSecond.toFixed(0) : cyclesPerSecond.toFixed(1)}/SEC`;
  }
  return `${cyclesPerMinute >= 10 ? Math.round(cyclesPerMinute) : cyclesPerMinute.toFixed(1)}/MIN`;
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

function setAudioPresentation(status = "off", message = "") {
  audioPresentationStatus = status;
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioButton").disabled = status === "starting";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function requestAudioState(on) {
  if (audioDesiredOn !== on) {
    audioDesiredOn = on;
    audioTransitionGeneration += 1;
  }
  return audioTransitionGeneration;
}

function sequencedMouthPreset() {
  return state.vowelSequenceMode === "off" || !sequencedVowelId
    ? null
    : vowelPreset(sequencedVowelId);
}

function mouthPresentationState() {
  const vowel = sequencedMouthPreset();
  return vowel
    ? sanitizeJawHarpState({ ...state, ...vowel.settings, vowelId: vowel.id }, state)
    : state;
}

function audioConfiguration(performanceGesture = null) {
  const {
    styleId: _styleId,
    vowelSequenceId: _vowelSequenceId,
    vowelSequenceMode: _vowelSequenceMode,
    ...configuration
  } = state;
  const safeGesture = {};
  if (performanceGesture) {
    for (const key of JAW_HARP_STYLE_GESTURE_KEYS) {
      if (Object.hasOwn(performanceGesture, key)) safeGesture[key] = performanceGesture[key];
    }
  }
  const vowel = sequencedMouthPreset();
  return vowel
    ? { ...configuration, ...safeGesture, ...vowel.settings, vowelId: vowel.id }
    : { ...configuration, ...safeGesture };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
}

function setSequencedVowelStep(step) {
  const sequence = jawHarpVowelSequence(state.vowelSequenceId);
  vowelSequenceActiveStep = ((Math.trunc(Number(step) || 0) % sequence.steps.length)
    + sequence.steps.length) % sequence.steps.length;
  sequencedVowelId = jawHarpVowelSequenceStep(
    sequence.id,
    vowelSequenceActiveStep,
  ).id;
}

function resetBreathSequenceClock(time = performance.now(), phase = breathCyclePhaseAt(time)) {
  breathSequenceLastAt = time;
  breathSequencePhase = ((Number(phase) % 1) + 1) % 1;
}

function resetVowelSequence({ post = true, present = true, time = performance.now() } = {}) {
  vowelSequenceActiveStep = 0;
  vowelSequenceNextStep = 0;
  sequencedVowelId = null;
  if (state.vowelSequenceMode !== "off") {
    setSequencedVowelStep(0);
    if (state.vowelSequenceMode === "breath") vowelSequenceNextStep = 1;
  }
  resetBreathSequenceClock(time);
  vowelSequenceBreathDirection = breathSequencePhase < state.breathBalance ? -1 : 1;
  if (post) postConfiguration();
  if (present) updatePresentation();
}

function postNextReferenceGesture() {
  const gesture = jawHarpStyleGesture(state.styleId, referenceGestureStep);
  if (!graph) return false;
  if (state.vowelSequenceMode === "pluck") {
    setSequencedVowelStep(vowelSequenceNextStep);
  }
  graph.sourceNode.port.postMessage({
    type: "configure",
    configuration: audioConfiguration(gesture),
  });
  if (gesture) referenceGestureStep += 1;
  if (state.vowelSequenceMode === "pluck") {
    vowelSequenceNextStep = vowelSequenceActiveStep + 1;
    updateVowelSequencePresentation();
  }
  return true;
}

function breathLabel(flow = breathFlowForDisplay()) {
  const amount = Math.abs(flow);
  if (amount < 0.025) return "rest";
  return `${flow < 0 ? "inhale" : "exhale"} ${Math.round(amount * 100)}%`;
}

function sendManualBreath(flow) {
  const next = clamp(flow, JAW_HARP_LIMITS.breathFlow[0], JAW_HARP_LIMITS.breathFlow[1]);
  commandedBreathFlow = next;
  graph?.sourceNode?.port.postMessage({ type: "breath", flow: next, manual: true });
}

function releaseManualBreath() {
  commandedBreathFlow = breathFlowAt();
  graph?.sourceNode?.port.postMessage({ type: "breath", manual: false });
}

function breathCyclePhaseAt(time = performance.now()) {
  const interval = 60_000 / Math.max(0.1, effectiveBreathRateBpm(state));
  return ((Math.max(0, time - breathCycleStartedAt) / interval) % 1 + 1) % 1;
}

function anchorBreathCyclePhase(phase = 0, time = performance.now()) {
  const wrapped = ((Number(phase) % 1) + 1) % 1;
  const interval = 60_000 / Math.max(0.1, effectiveBreathRateBpm(state));
  breathCycleStartedAt = time - wrapped * interval;
  return wrapped;
}

function resetBreathCycle(phase = 0) {
  const wrapped = anchorBreathCyclePhase(phase);
  resetBreathSequenceClock(performance.now(), wrapped);
  if (state.vowelSequenceMode === "breath") {
    vowelSequenceBreathDirection = wrapped < state.breathBalance ? -1 : 1;
  }
  graph?.sourceNode?.port.postMessage({ type: "breath-cycle-reset", phase: wrapped });
}

function preserveBreathCyclePhase(previousPhase, time = performance.now()) {
  anchorBreathCyclePhase(previousPhase, time);
  resetBreathSequenceClock(time, previousPhase);
  if (state.vowelSequenceMode === "breath") {
    vowelSequenceBreathDirection = previousPhase < state.breathBalance ? -1 : 1;
  }
}

function breathFlowAt(time = performance.now()) {
  if (manualBreathDirection) return manualBreathDirection * state.breathDepth;
  if (!state.autoBreath) return 0;
  return breathCycleFlow(state, breathCyclePhaseAt(time));
}

function updateBreathVowelSequence(time = performance.now()) {
  if (
    state.vowelSequenceMode !== "breath"
    || !state.autoBreath
    || manualBreathDirection
  ) {
    resetBreathSequenceClock(time);
    return 0;
  }
  const elapsedMs = Math.max(0, time - breathSequenceLastAt);
  const elapsedCycles = elapsedMs * effectiveBreathRateBpm(state) / 60_000;
  const boundaries = breathLobeBoundaryCount(
    breathSequencePhase,
    elapsedCycles,
    state.breathBalance,
  );
  breathSequencePhase = (breathSequencePhase + elapsedCycles) % 1;
  breathSequenceLastAt = time;
  if (!boundaries) return 0;
  setSequencedVowelStep(vowelSequenceActiveStep + boundaries);
  vowelSequenceNextStep = vowelSequenceActiveStep + 1;
  vowelSequenceBreathDirection = breathSequencePhase < state.breathBalance ? -1 : 1;
  postConfiguration();
  updateVowelSequencePresentation();
  return boundaries;
}

function followManualBreathWithVowel(direction, time = performance.now()) {
  if (state.vowelSequenceMode !== "breath") return false;
  const nextDirection = direction < 0 ? -1 : 1;
  resetBreathSequenceClock(time);
  if (nextDirection === vowelSequenceBreathDirection) return false;
  vowelSequenceBreathDirection = nextDirection;
  setSequencedVowelStep(vowelSequenceActiveStep + 1);
  vowelSequenceNextStep = vowelSequenceActiveStep + 1;
  postConfiguration();
  updateVowelSequencePresentation();
  return true;
}

function updateBreathPresentation(flow = breathFlowForDisplay()) {
  const label = breathLabel(flow);
  $("breathReadout").textContent = label;
  $("breathSummary").textContent = manualBreathDirection
    ? `manual · ${label}`
    : state.autoBreath
      ? `auto · ${label}`
      : "manual · resting";
  $("inhaleButton").setAttribute("aria-pressed", String(manualBreathDirection < 0));
  $("exhaleButton").setAttribute("aria-pressed", String(manualBreathDirection > 0));
  $("breathCycleButton").setAttribute("aria-pressed", String(state.autoBreath));
  const effectiveRate = effectiveBreathRateBpm(state);
  $("breathCycleState").textContent = state.autoBreath
    ? `${Math.round(effectiveRate)} cycles/min · ${state.breathLinked ? "hand-clock × rate" : "free-running"}`
    : "off · hold either direction to breathe";
  const meters = [...$("breathMeter").querySelectorAll("i")];
  const amount = clamp(Math.abs(flow));
  const half = flow < 0 ? 0 : 4;
  const active = amount < 0.025 ? -1 : half + Math.min(3, Math.floor(amount * 4));
  meters.forEach((meter, index) => meter.classList.toggle("is-current", index === active));
}

async function beginManualBreath(direction, owner) {
  const requestedDirection = direction < 0 ? -1 : 1;
  const breathGeneration = ++manualBreathGeneration;
  manualBreathOwner = owner;
  manualBreathDirection = requestedDirection;
  followManualBreathWithVowel(requestedDirection);
  updateBreathPresentation(requestedDirection * state.breathDepth);
  if (!(await ensureAudio())) {
    if (
      breathGeneration === manualBreathGeneration
      && manualBreathDirection === requestedDirection
      && manualBreathOwner === owner
    ) {
      manualBreathDirection = 0;
      manualBreathOwner = null;
      updateBreathPresentation(0);
    }
    return;
  }
  if (
    breathGeneration !== manualBreathGeneration
    || manualBreathDirection !== requestedDirection
    || manualBreathOwner !== owner
  ) return;
  const flow = manualBreathDirection * state.breathDepth;
  sendManualBreath(flow);
  updateBreathPresentation(flow);
  announce(`${manualBreathDirection < 0 ? "Inhaling" : "Exhaling"} through the vibrating reed`);
}

function endManualBreath(direction, owner) {
  if (
    !manualBreathDirection
    || Math.sign(direction) !== manualBreathDirection
    || owner !== manualBreathOwner
  ) return;
  manualBreathGeneration += 1;
  manualBreathDirection = 0;
  manualBreathOwner = null;
  const flow = breathFlowAt();
  if (state.autoBreath) {
    const phase = breathCyclePhaseAt();
    followManualBreathWithVowel(phase < state.breathBalance ? -1 : 1);
  }
  releaseManualBreath();
  updateBreathPresentation(flow);
}

function toggleBreathCycle() {
  state = sanitizeJawHarpState({ ...state, autoBreath: !state.autoBreath }, state);
  markReferencePerformanceCustom("autoBreath");
  resetBreathCycle(state.autoBreath ? state.breathBalance * 0.5 : 0);
  postConfiguration();
  const flow = breathFlowAt();
  commandedBreathFlow = flow;
  updatePresentation();
  announce(`Automatic breath cycle ${state.autoBreath ? "on" : "off"}`);
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  let releaseOutput = null;
  unlockAudioContext(context);
  try {
    await context.audioWorklet.addModule(new URL("./src/jaw-harp-processor.js", import.meta.url));
    const sourceNode = new AudioWorkletNode(context, "jaw-harp-physical-model", {
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
    // Catch pathological mouth/reed peaks without letting a pluck duck the
    // ringing body. A short, gentle release keeps glottis moves continuous.
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.075;
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.56;
    sourceNode.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    sourceNode.port.onmessage = (event) => {
      if (event.data?.type !== "telemetry") return;
      telemetry = { ...telemetry, ...event.data };
      lastBreathTelemetryAt = performance.now();
    };
    sourceNode.onprocessorerror = () => setAudioPresentation(
      "error",
      "The jaw-harp physical model stopped unexpectedly. Reload the page to reset it.",
    );
    return {
      context, sourceNode, masterGain, compressor, analyser, releaseOutput,
    };
  } catch (error) {
    releaseOutput?.();
    try { await context.close?.(); } catch { /* The original startup error is more useful. */ }
    throw error;
  }
}

async function ensureAudio() {
  const transitionGeneration = requestAudioState(true);
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      const startupLifecycleGeneration = pageLifecycleGeneration;
      const startup = createAudioGraph()
        .then((createdGraph) => {
          if (
            !pageIsActive
            || !audioDesiredOn
            || startupLifecycleGeneration !== pageLifecycleGeneration
          ) {
            createdGraph.releaseOutput?.();
            void createdGraph.context.close?.();
            return false;
          }
          graph = createdGraph;
          audioContext = graph.context;
          return true;
        })
        .catch((error) => {
          console.error(error);
          if (
            pageIsActive
            && audioDesiredOn
            && startupLifecycleGeneration === pageLifecycleGeneration
            && audioStartupPromise === startup
          ) {
            setAudioPresentation("error", error?.message || "Unable to start jaw-harp audio.");
          }
          return false;
        })
        .finally(() => {
          if (audioStartupPromise === startup) audioStartupPromise = null;
        });
      audioStartupPromise = startup;
    }
    if (!(await audioStartupPromise)) return false;
  }
  const activeGraph = graph;
  const activeContext = audioContext;
  try {
    unlockAudioContext(activeContext);
    await activeContext.resume();
    if (
      !pageIsActive
      || !audioDesiredOn
      || transitionGeneration !== audioTransitionGeneration
      || activeGraph !== graph
      || activeContext !== audioContext
    ) {
      if (!audioDesiredOn && activeContext.state === "running") await activeContext.suspend();
      return false;
    }
    postConfiguration();
    activeGraph.sourceNode.port.postMessage({
      type: "breath-cycle-reset",
      phase: breathCyclePhaseAt(),
    });
    if (tineIsHeld) activeGraph.sourceNode.port.postMessage({ type: "hold-tine" });
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    if (
      pageIsActive
      && audioDesiredOn
      && transitionGeneration === audioTransitionGeneration
      && activeGraph === graph
    ) setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

function audioGraphIsRunning() {
  return Boolean(
    pageIsActive
    && audioDesiredOn
    && graph
    && audioContext === graph.context
    && audioContext.state === "running"
  );
}

async function toggleAudio() {
  if (audioDesiredOn && audioPresentationStatus === "on" && audioContext) {
    const transitionGeneration = requestAudioState(false);
    cancelHeldTine();
    cancelManualBreath({ present: false });
    state = sanitizeJawHarpState({ ...state, repeat: false }, state);
    commandedBreathFlow = 0;
    lastBreathTelemetryAt = -Infinity;
    updateTransportPresentation();
    updateBreathPresentation(0);
    graph.sourceNode.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    if (
      transitionGeneration !== audioTransitionGeneration
      || audioDesiredOn
    ) return;
    setAudioPresentation("off");
    return;
  }
  await ensureAudio();
}

async function pluck({
  force,
  velocity = 1,
  direction = state.pluckDirection,
  position = state.pluckPosition,
  automatic = false,
  announcePluck = !automatic,
} = {}) {
  if (tineIsHeld) return false;
  const intentGeneration = performanceIntentGeneration;
  const requestSerial = ++pluckRequestSerial;
  const startupNeeded = !audioGraphIsRunning();
  if (startupNeeded && !(await ensureAudio())) return false;
  if (
    intentGeneration !== performanceIntentGeneration
    || tineIsHeld
    || (startupNeeded && requestSerial !== pluckRequestSerial)
  ) return false;
  const requestedForce = Number(force);
  const strength = Number.isFinite(requestedForce)
    ? clamp(requestedForce, JAW_HARP_LIMITS.pluckForce[0], JAW_HARP_LIMITS.pluckForce[1])
    : naturalTineStrike(state, { velocity, direction, position }).force;
  const strikeDirection = Number(direction) < 0 ? -1 : 1;
  const strikePosition = clamp(
    Number(position),
    JAW_HARP_LIMITS.pluckPosition[0],
    JAW_HARP_LIMITS.pluckPosition[1],
  );
  postNextReferenceGesture();
  graph.sourceNode.port.postMessage({
    type: "strike-tine",
    force: strength,
    direction: strikeDirection,
    position: strikePosition,
    automatic,
  });
  presentPluck(strikeDirection, announcePluck, strength);
  return true;
}

function presentPluck(direction, announcePluck = true, force = state.pluckForce) {
  lastPluckAt = performance.now();
  pluckFlash = 1;
  visualTineRelease = {
    startedAt: lastPluckAt,
    force: clamp(force, JAW_HARP_LIMITS.pluckForce[0], JAW_HARP_LIMITS.pluckForce[1]),
    direction: direction < 0 ? -1 : 1,
  };
  $("pluckButton").classList.add("is-plucked");
  setTimeout(() => $("pluckButton").classList.remove("is-plucked"), 90);
  if (announcePluck) announce(`${jawHarpPreset(state.presetId).label} plucked ${direction < 0 ? "inward" : "outward"}`);
}

async function auditionRandomizedModel() {
  const intentGeneration = performanceIntentGeneration;
  const parkOwner = ++repeatClockParkSerial;
  const releaseDeferredRepeat = () => {
    if (repeatClockParkOwner !== parkOwner) return;
    repeatClockParkOwner = 0;
    if (state.repeat && nextRepeatAt === Infinity) nextRepeatAt = performance.now();
  };
  if (!pageIsActive || !audioDesiredOn) return false;
  if (!graph || audioContext?.state !== "running") {
    // Audio may still be starting or may have been browser-suspended. Hold the
    // repeat clock until the one preview strike has really been posted.
    if (state.repeat) {
      repeatClockParkOwner = parkOwner;
      nextRepeatAt = Infinity;
    }
    if (!(await ensureAudio())) {
      releaseDeferredRepeat();
      return false;
    }
  }
  if (
    intentGeneration !== performanceIntentGeneration
    || !pageIsActive
    || !audioDesiredOn
    || !graph
    || audioContext?.state !== "running"
    || tineIsHeld
  ) {
    releaseDeferredRepeat();
    return false;
  }
  const auditionBreathPhase = state.autoBreath ? state.breathBalance * 0.5 : 0;
  if (repeatClockParkOwner === parkOwner) repeatClockParkOwner = 0;
  resetBreathCycle(auditionBreathPhase);
  commandedBreathFlow = breathFlowAt();
  const force = clamp(
    state.pluckForce,
    RANDOMIZE_AUDITION_FORCE_FLOOR,
    JAW_HARP_RANDOM_LIMITS.pluckForce[1],
  );
  const struck = await pluck({
    force,
    direction: state.pluckDirection,
    position: state.pluckPosition,
    automatic: true,
    announcePluck: false,
  });
  if (!struck) {
    releaseDeferredRepeat();
    return false;
  }
  if (state.repeat) {
    // This preview is rhythm step zero. Advance the clock so the animation
    // frame that follows Randomize cannot immediately add a second strike.
    repeatStep = 1;
    repeatHitCount = 1;
    nextRepeatAt = performance.now()
      + repeatIntervalMs(state.repeatRateBpm, 0, state.repeatSwing) * 0.5;
    renderPulseMap();
  }
  return true;
}

async function releaseTine({
  force,
  direction,
  position = state.pluckPosition,
  announcePluck = true,
} = {}) {
  const releaseGeneration = ++tineReleaseGeneration;
  const intentGeneration = performanceIntentGeneration;
  // A running graph can accept the release synchronously. Avoid extending the
  // intentionally silent pull while an already-running context resolves a
  // redundant resume() promise on the main thread.
  const ready = audioGraphIsRunning() ? true : await ensureAudio();
  if (
    releaseGeneration !== tineReleaseGeneration
    || intentGeneration !== performanceIntentGeneration
  ) return false;
  if (!ready) {
    graph?.sourceNode?.port.postMessage({ type: "release-tine" });
    tineIsHeld = false;
    return false;
  }
  const strength = clamp(
    force,
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  postNextReferenceGesture();
  graph.sourceNode.port.postMessage({
    type: "release-tine", force: strength, direction, position,
  });
  tineIsHeld = false;
  presentPluck(direction, announcePluck, strength);
  return true;
}

function clearPointerInteraction() {
  if (!pointerDrag) return null;
  const drag = pointerDrag;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture?.(drag.pointerId);
  if (drag.type === "reed") $("pluckState").textContent = "space · varied finger pull";
  return drag;
}

function cancelHeldTine() {
  tineReleaseGeneration += 1;
  performanceIntentGeneration += 1;
  clearPointerInteraction();
  graph?.sourceNode?.port.postMessage({ type: "release-tine" });
  tineIsHeld = false;
  visualTineRelease = null;
  $("pluckState").textContent = "space · varied finger pull";
}

function cancelManualBreath({ present = true } = {}) {
  manualBreathGeneration += 1;
  manualBreathDirection = 0;
  manualBreathOwner = null;
  releaseManualBreath();
  if (present) updateBreathPresentation(commandedBreathFlow);
}

function cancelTransientPerformance() {
  cancelHeldTine();
  cancelManualBreath();
}

function updateTransportPresentation() {
  $("repeatButton").setAttribute("aria-pressed", String(state.repeat));
  $("repeatState").textContent = state.repeat ? `${Math.round(state.repeatRateBpm)} BPM` : "off";
}

function retimeRepeatClock(previousState, time = performance.now()) {
  if (!state.repeat || !Number.isFinite(nextRepeatAt)) return;
  const intervalStep = Math.max(0, repeatStep - 1);
  const previousInterval = repeatIntervalMs(
    previousState.repeatRateBpm,
    intervalStep,
    previousState.repeatSwing,
  ) * 0.5;
  const nextInterval = repeatIntervalMs(
    state.repeatRateBpm,
    intervalStep,
    state.repeatSwing,
  ) * 0.5;
  const remaining = clamp((nextRepeatAt - time) / Math.max(1, previousInterval));
  nextRepeatAt = time + nextInterval * remaining;
}

async function toggleRepeat() {
  const next = !state.repeat;
  const intentGeneration = performanceIntentGeneration;
  if (next && !(await ensureAudio())) return;
  if (intentGeneration !== performanceIntentGeneration) return;
  state = sanitizeJawHarpState({ ...state, repeat: next }, state);
  repeatStep = 0;
  repeatHitCount = 0;
  referenceGestureStep = 0;
  nextRepeatAt = performance.now();
  updateTransportPresentation();
  postConfiguration();
  announce(`Jaw-harp repeat ${next ? "on" : "off"}`);
}

function toggleBreathLink() {
  const changedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, breathLinked: !state.breathLinked }, state);
  markReferencePerformanceCustom("breathLinked");
  preserveBreathCyclePhase(previousPhase, changedAt);
  commandedBreathFlow = breathFlowAt(changedAt);
  updatePresentation();
  postConfiguration();
  announce(`Breath and plucking clocks ${state.breathLinked ? "linked" : "independent"}`);
}

function setRhythm(rhythmId) {
  const changedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, rhythmId }, state);
  markReferencePerformanceCustom("rhythmId");
  repeatStep = 0;
  repeatHitCount = 0;
  nextRepeatAt = changedAt;
  preserveBreathCyclePhase(previousPhase, changedAt);
  updatePresentation();
  postConfiguration();
  announce(`${jawHarpRhythm(state.rhythmId).label} pluck loop loaded`);
}

function setDirection(direction) {
  state = sanitizeJawHarpState({ ...state, pluckDirection: direction }, state);
  markReferencePerformanceCustom("pluckDirection");
  updatePresentation();
  postConfiguration();
}

function setControl(key, value, { mouth = false, announceChange = false } = {}) {
  const changedAt = performance.now();
  const previousState = state;
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({
    ...state,
    ...(mouth ? { vowelSequenceMode: "off" } : {}),
    [key]: value,
  }, state);
  if (mouth) {
    sequencedVowelId = null;
    vowelSequenceActiveStep = 0;
    vowelSequenceNextStep = 0;
  }
  markReferencePerformanceCustom(key);
  if (["repeatRateBpm", "repeatSwing"].includes(key)) {
    retimeRepeatClock(previousState, changedAt);
  }
  if (key === "breathBalance") {
    preserveBreathCyclePhase(previousPhase, changedAt);
  } else if (
    ["breathRateBpm", "repeatRateBpm", "breathsPerLoop"].includes(key)
    && effectiveBreathRateBpm(previousState) !== effectiveBreathRateBpm(state)
  ) preserveBreathCyclePhase(previousPhase, changedAt);
  if (mouth) activeVowelId = null;
  updatePresentation();
  if (key === "level" && graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
  } else postConfiguration();
  if (key === "breathDepth" && manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathDepth);
  }
  if (announceChange) announce(`${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()} changed`);
}

function loadHarp(presetId) {
  const retained = {
    tonguePosition: state.tonguePosition,
    tongueHeight: state.tongueHeight,
    jawOpening: state.jawOpening,
    lipRounding: state.lipRounding,
    glottisOpening: state.glottisOpening,
    cavityCoupling: state.cavityCoupling,
    breathDepth: state.breathDepth,
    breathNoiseAmount: state.breathNoiseAmount,
    breathFilter: state.breathFilter,
    breathRateBpm: state.breathRateBpm,
    breathBalance: state.breathBalance,
    autoBreath: state.autoBreath,
    formantFocus: state.formantFocus,
    repeatRateBpm: state.repeatRateBpm,
    repeatSwing: state.repeatSwing,
    repeat: state.repeat,
    rhythmId: state.rhythmId,
    breathLinked: state.breathLinked,
    breathsPerLoop: state.breathsPerLoop,
    dryResonance: state.dryResonance,
    level: state.level,
    pluckDirection: state.pluckDirection,
    vowelId: state.vowelId,
    vowelSequenceId: state.vowelSequenceId,
    vowelSequenceMode: state.vowelSequenceMode,
    styleId: state.styleId,
  };
  state = jawHarpState(presetId, retained);
  updatePresentation();
  postConfiguration();
  announce(`${jawHarpPreset(presetId).label} physical body loaded`);
  if (audioGraphIsRunning() && !tineIsHeld) {
    graph.sourceNode.port.postMessage({ type: "hold-tine" });
    void releaseTine({
      force: state.pluckForce,
      direction: state.pluckDirection,
      announcePluck: false,
    });
  }
}

function markReferencePerformanceCustom(...keys) {
  if (!keys.some((key) => STYLE_SETTING_KEYS.has(key))) return false;
  referencePerformanceBaseline = null;
  referenceGestureStep = 0;
  if (state.styleId === JAW_HARP_STYLE_CUSTOM_ID) return false;
  state = sanitizeJawHarpState({ ...state, styleId: JAW_HARP_STYLE_CUSTOM_ID }, state);
  return true;
}

function captureReferencePerformanceBaseline() {
  if (referencePerformanceBaseline) return;
  const settings = {};
  for (const key of JAW_HARP_STYLE_SETTING_KEYS) settings[key] = state[key];
  referencePerformanceBaseline = {
    settings,
    activeVowelId,
    styleId: state.styleId,
  };
}

function auditionReferencePerformance() {
  if (!audioGraphIsRunning() || tineIsHeld) return false;
  const auditionedAt = performance.now();
  if (state.repeat) nextRepeatAt = Infinity;
  void pluck({ automatic: true, announcePluck: false });
  if (state.repeat) {
    // The preview is beat one of the newly selected phrase. Continue at beat
    // two instead of inheriting a rest or direction from the previous style.
    repeatStep = 1;
    repeatHitCount = 1;
    nextRepeatAt = auditionedAt
      + repeatIntervalMs(state.repeatRateBpm, 0, state.repeatSwing) * 0.5;
    renderPulseMap();
  }
  return true;
}

function loadReferencePerformance(styleId) {
  if (styleId === JAW_HARP_STYLE_CUSTOM_ID) {
    if (!referencePerformanceBaseline) {
      referenceGestureStep = 0;
      state = sanitizeJawHarpState({ ...state, styleId: JAW_HARP_STYLE_CUSTOM_ID }, state);
      updatePresentation();
      postConfiguration();
      announce("Current performance kept as a custom setup");
      return;
    }
    const changedAt = performance.now();
    const previousState = state;
    const previousPhase = breathCyclePhaseAt(changedAt);
    const baseline = referencePerformanceBaseline;
    referencePerformanceBaseline = null;
    referenceGestureStep = 0;
    state = sanitizeJawHarpState({
      ...state,
      ...baseline.settings,
      styleId: baseline.styleId,
    }, previousState);
    repeatStep = 0;
    repeatHitCount = 0;
    nextRepeatAt = changedAt;
    activeVowelId = baseline.activeVowelId;
    preserveBreathCyclePhase(previousPhase, changedAt);
    resetVowelSequence({ post: false, present: false, time: changedAt });
    commandedBreathFlow = breathFlowAt(changedAt);
    updatePresentation();
    postConfiguration();
    if (manualBreathDirection) {
      sendManualBreath(manualBreathDirection * state.breathDepth);
    }
    auditionReferencePerformance();
    announce("Current performance restored; physical instrument edits kept");
    return;
  }
  const style = jawHarpStyle(styleId);
  if (!style) return;
  captureReferencePerformanceBaseline();
  referenceGestureStep = 0;
  const changedAt = performance.now();
  const previousState = state;
  const previousPhase = breathCyclePhaseAt(changedAt);
  const retainedLevel = state.level;
  const retainedRepeat = state.repeat;
  state = applyJawHarpStyle(state, style.id);
  state = sanitizeJawHarpState({
    ...state,
    level: retainedLevel,
    repeat: retainedRepeat,
  }, previousState);
  repeatStep = 0;
  repeatHitCount = 0;
  nextRepeatAt = changedAt;
  preserveBreathCyclePhase(previousPhase, changedAt);
  commandedBreathFlow = breathFlowAt(changedAt);
  activeVowelId = null;
  resetVowelSequence({ post: false, present: false, time: changedAt });
  updatePresentation();
  postConfiguration();
  if (manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathDepth);
  }
  auditionReferencePerformance();
  announce(`${style.label} reference performance loaded; physical instrument unchanged`);
}

function loadVowel(vowelId) {
  state = applyVowel({ ...state, vowelSequenceMode: "off" }, vowelId);
  markReferencePerformanceCustom("tonguePosition");
  activeVowelId = vowelId;
  sequencedVowelId = null;
  vowelSequenceActiveStep = 0;
  vowelSequenceNextStep = 0;
  updatePresentation();
  postConfiguration();
  announce(`${VOWEL_PRESETS.find(({ id }) => id === vowelId)?.phoneme ?? vowelId} mouth shape loaded`);
}

function setVowelSequence(sequenceId) {
  state = sanitizeJawHarpState({ ...state, vowelSequenceId: sequenceId }, state);
  markReferencePerformanceCustom("vowelSequenceId");
  resetVowelSequence();
  announce(`${jawHarpVowelSequence(state.vowelSequenceId).label} vowel phrase selected`);
}

function setVowelSequenceMode(mode) {
  state = sanitizeJawHarpState({ ...state, vowelSequenceMode: mode }, state);
  markReferencePerformanceCustom("vowelSequenceMode");
  resetVowelSequence();
  const labels = {
    off: "Vowel phrase off; manual mouth restored",
    pluck: "Vowel phrase follows sounding plucks",
    breath: "Vowel phrase follows inhale and exhale turns",
  };
  announce(labels[state.vowelSequenceMode]);
}

function randomizeModel() {
  const randomizedAt = performance.now();
  referencePerformanceBaseline = null;
  referenceGestureStep = 0;
  cancelHeldTine();
  cancelManualBreath({ present: false });
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  state = randomizeJawHarpState(state);
  state = sanitizeJawHarpState({
    ...state,
    styleId: JAW_HARP_STYLE_CUSTOM_ID,
  }, state);
  repeatStep = 0;
  repeatHitCount = 0;
  nextRepeatAt = randomizedAt;
  const startingBreathPhase = state.autoBreath ? state.breathBalance * 0.5 : 0;
  resetBreathCycle(startingBreathPhase);
  commandedBreathFlow = breathFlowAt();
  visualBreathFlow = 0;
  lastBreathTelemetryAt = -Infinity;
  visualTineRelease = null;
  activeVowelId = null;
  resetVowelSequence({ post: false, present: false });
  updatePresentation();
  postConfiguration();
  void auditionRandomizedModel();
  announce(`Jaw-harp model randomized · ${state.repeat ? `${Math.round(state.repeatRateBpm)} BPM repeat` : "repeat off"}`);
}

function updateVowelSequencePresentation() {
  const sequence = jawHarpVowelSequence(state.vowelSequenceId);
  const soundingVowelId = sequencedVowelId ?? activeVowelId;
  for (const button of $("vowelButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.vowel === soundingVowelId));
  }
  $("vowelSequenceSelect").value = sequence.id;
  for (const button of document.querySelectorAll("[data-vowel-sequence-mode]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.vowelSequenceMode === state.vowelSequenceMode),
    );
  }
  const mouthState = mouthPresentationState();
  const geometry = mouthGeometry(mouthState);
  const harmonic = dominantHarmonic(mouthState);
  const phoneme = soundingVowelId
    ? VOWEL_PRESETS.find(({ id }) => id === soundingVowelId)?.phoneme
    : "custom";
  const phrase = state.vowelSequenceMode === "off"
    ? ""
    : ` · step ${vowelSequenceActiveStep + 1}/${sequence.steps.length} · ${state.vowelSequenceMode}`;
  $("mouthSummary").textContent = `${phoneme}${phrase} · ${(geometry.lengthM * 100).toFixed(1)} cm cavity`;
  $("harmonicReadout").textContent = `${harmonic.index} × · ${formatFrequency(harmonic.frequencyHz)}`;
  $("cavityReadout").textContent = `${(geometry.lengthM * 100).toFixed(1)} cm · ${Math.round(geometry.volumeMl)} ml`;
}

function updateXYPadPresentation() {
  const breathPad = $("breathXYPad");
  const rhythmPad = $("rhythmXYPad");
  if (!breathPad || !rhythmPad) return;

  const breathRateUnit = logarithmicUnit(
    state.breathRateBpm,
    JAW_HARP_LIMITS.breathRateBpm,
  );
  const breathPressureUnit = rangeUnit(
    state.breathDepth,
    JAW_HARP_LIMITS.breathDepth,
  );
  breathPad.style.setProperty("--jaw-xy-left", `${(breathRateUnit * 100).toFixed(2)}%`);
  breathPad.style.setProperty("--jaw-xy-top", `${((1 - breathPressureUnit) * 100).toFixed(2)}%`);
  const pressurePercent = Math.round(state.breathDepth * 100);
  const effectiveRate = effectiveBreathRateBpm(state);
  const multiplier = state.breathRateBpm / JAW_HARP_DEFAULTS.breathRateBpm;
  const breathRateLabel = state.breathLinked
    ? `×${multiplier.toFixed(multiplier >= 10 ? 1 : 2)} · ${formatCycleRate(effectiveRate)} actual`
    : formatCycleRate(state.breathRateBpm);
  $("breathXYReadout").textContent = `${breathRateLabel} · ${pressurePercent}% pressure`;
  breathPad.setAttribute(
    "aria-label",
    `Breath gesture: ${breathRateLabel}, ${pressurePercent} percent pressure`,
  );

  const tempoUnit = logarithmicUnit(
    state.repeatRateBpm,
    JAW_HARP_LIMITS.repeatRateBpm,
  );
  const swingUnit = rangeUnit(state.repeatSwing, JAW_HARP_LIMITS.repeatSwing);
  rhythmPad.style.setProperty("--jaw-xy-left", `${(tempoUnit * 100).toFixed(2)}%`);
  rhythmPad.style.setProperty("--jaw-xy-top", `${((1 - swingUnit) * 100).toFixed(2)}%`);
  const swingPercent = Math.round(state.repeatSwing * 100);
  const signedSwing = `${swingPercent >= 0 ? "+" : ""}${swingPercent}%`;
  $("rhythmXYReadout").textContent = `${Math.round(state.repeatRateBpm)} BPM · ${signedSwing} swing`;
  rhythmPad.setAttribute(
    "aria-label",
    `Hand clock: ${Math.round(state.repeatRateBpm)} BPM and ${signedSwing} swing`,
  );
}

function updatePresentation() {
  const preset = jawHarpPreset(state.presetId);
  const material = reedMaterialProperties(state);
  const mouthState = mouthPresentationState();
  const geometry = mouthGeometry(mouthState);
  const formants = mouthFormants(mouthState);
  const harmonic = dominantHarmonic(mouthState);
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    if (!input) continue;
    input.value = String(state[specification.key]);
    $(`${specification.key}Out`).textContent = specification.format(state[specification.key]);
    updateRangeFill(input);
  }
  $("level").value = String(state.level);
  $("levelOut").textContent = formatPercent(state.level);
  updateRangeFill($("level"));
  $("harpSelect").value = state.presetId;
  $("harpDescription").textContent = `${preset.description} Material model: ${preset.material.youngsModulusGPa} GPa · ${Math.round(material.densityKgM3)} kg/m³ · loss ${preset.material.internalLossFactor}.`;
  const style = jawHarpStyle(state.styleId);
  $("styleSelect").value = style?.id ?? JAW_HARP_STYLE_CUSTOM_ID;
  $("styleDescription").textContent = style
    ? `${style.description}${referencePerformanceBaseline ? " Choose Current / Custom to restore the performance you had before browsing styles." : ""}`
    : "Manual performance edits are active. The selected physical instrument and material model are unchanged.";
  const styleSource = $("styleSource");
  styleSource.hidden = !style;
  if (style) {
    styleSource.href = style.source.url;
    styleSource.textContent = `Reference: ${style.source.label} · ${style.source.license} · suggested body: ${jawHarpPreset(style.recommendedPresetId).label} (not changed)`;
  } else {
    styleSource.removeAttribute("href");
    styleSource.textContent = "";
  }
  updateVowelSequencePresentation();
  $("reedReadout").textContent = formatFrequency(state.reedFrequencyHz);
  $("harmonicReadout").textContent = `${harmonic.index} × · ${formatFrequency(harmonic.frequencyHz)}`;
  $("cavityReadout").textContent = `${(geometry.lengthM * 100).toFixed(1)} cm · ${Math.round(geometry.volumeMl)} ml`;
  $("reedSummary").textContent = `${Math.round(state.reedFrequencyHz)} Hz · ${preset.family}`;
  $("couplingSummary").textContent = `${formatPercent(state.cavityCoupling)} mouth · ${formatPercent(state.frameCoupling)} frame`;
  const rhythm = jawHarpRhythm(state.rhythmId);
  $("rhythmSummary").textContent = `${Math.round(state.repeatRateBpm)} BPM · ${rhythm.label} · ${state.breathLinked ? `${state.breathsPerLoop}× breath` : "free breath"}`;
  $("rhythmSelect").value = state.rhythmId;
  $("breathsPerLoop").value = String(state.breathsPerLoop);
  $("breathLinkButton").setAttribute("aria-pressed", String(state.breathLinked));
  $("breathLinkState").textContent = state.breathLinked
    ? "linked · clock runs while the hand is muted"
    : "independent breath and hand clocks";
  renderPulseMap(rhythm);
  $("motionReadout").textContent = telemetry.rms > 0.0004 ? `${Math.round(clamp(telemetry.energy) * 100)}% energy` : "resting";
  $("pluckOutward").setAttribute("aria-pressed", String(state.pluckDirection > 0));
  $("pluckInward").setAttribute("aria-pressed", String(state.pluckDirection < 0));
  updateXYPadPresentation();
  updateBreathPresentation();
  updateTransportPresentation();
  telemetry.formants = telemetry.formants ?? formants.frequenciesHz;
}

function renderPulseMap(rhythm = jawHarpRhythm(state.rhythmId)) {
  const map = $("pulseMap");
  map.style.setProperty("--pulse-count", String(rhythm.steps.length));
  if (map.children.length !== rhythm.steps.length || map.dataset.rhythm !== rhythm.id) {
    map.dataset.rhythm = rhythm.id;
    map.replaceChildren(...rhythm.steps.map((velocity) => {
      const pulse = document.createElement("i");
      pulse.style.height = `${18 + velocity * 82}%`;
      pulse.style.opacity = String(velocity ? 0.35 + velocity * 0.65 : 0.2);
      return pulse;
    }));
  }
  [...map.children].forEach((node, index) => node.classList.toggle("is-current", index === repeatStep % rhythm.steps.length));
}

function buildPresets() {
  $("harpSelect").replaceChildren(...JAW_HARP_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} · ${preset.family}`;
    return option;
  }));
  const customStyleOption = document.createElement("option");
  customStyleOption.value = JAW_HARP_STYLE_CUSTOM_ID;
  customStyleOption.textContent = "Current / Custom";
  const styleGroups = JAW_HARP_PRESETS.map((preset) => {
    const group = document.createElement("optgroup");
    group.label = `${preset.label} / ${preset.family}`;
    group.append(...JAW_HARP_STYLE_REFERENCES
      .filter((style) => style.recommendedPresetId === preset.id)
      .map((style) => {
        const option = document.createElement("option");
        option.value = style.id;
        option.textContent = style.label;
        return option;
      }));
    return group;
  });
  $("styleSelect").replaceChildren(...styleGroups, customStyleOption);
  $("styleSelectLabel").textContent = `Reference performance · ${JAW_HARP_STYLE_REFERENCES.length} studies`;
  $("vowelButtons").replaceChildren(...VOWEL_PRESETS.map((vowel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.vowel = vowel.id;
    button.innerHTML = `${vowel.label}<small>${vowel.phoneme}</small>`;
    button.setAttribute("aria-pressed", String(vowel.id === activeVowelId));
    button.addEventListener("click", () => loadVowel(vowel.id));
    return button;
  }));
  $("vowelSequenceSelect").replaceChildren(...JAW_HARP_VOWEL_SEQUENCES.map((sequence) => {
    const option = document.createElement("option");
    option.value = sequence.id;
    option.textContent = sequence.label;
    return option;
  }));
  $("rhythmSelect").replaceChildren(...JAW_HARP_RHYTHMS.map((rhythm) => {
    const option = document.createElement("option");
    option.value = rhythm.id;
    option.textContent = `${rhythm.label} · ${rhythm.steps.map((velocity) => velocity ? "●" : "·").join("")}`;
    return option;
  }));
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("pluckButton").addEventListener("click", () => pluck());
  $("repeatButton").addEventListener("click", toggleRepeat);
  $("rhythmSelect").addEventListener("change", (event) => setRhythm(event.currentTarget.value));
  $("breathsPerLoop").addEventListener("change", (event) => setControl("breathsPerLoop", Number(event.currentTarget.value), { announceChange: true }));
  $("breathLinkButton").addEventListener("click", toggleBreathLink);
  $("harpSelect").addEventListener("change", (event) => loadHarp(event.currentTarget.value));
  $("styleSelect").addEventListener("change", (event) => loadReferencePerformance(event.currentTarget.value));
  $("vowelSequenceSelect").addEventListener("change", (event) => setVowelSequence(event.currentTarget.value));
  for (const button of document.querySelectorAll("[data-vowel-sequence-mode]")) {
    button.addEventListener("click", () => setVowelSequenceMode(button.dataset.vowelSequenceMode));
  }
  $("randomizeButton").addEventListener("click", randomizeModel);
  $("pluckOutward").addEventListener("click", () => setDirection(1));
  $("pluckInward").addEventListener("click", () => setDirection(-1));
  $("breathCycleButton").addEventListener("click", toggleBreathCycle);
  for (const [id, direction] of [["inhaleButton", -1], ["exhaleButton", 1]]) {
    const button = $(id);
    const pointerOwners = new Map();
    const keyboardOwner = { type: "button-key", id };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      const owner = { type: "pointer", id, pointerId: event.pointerId };
      pointerOwners.set(event.pointerId, owner);
      beginManualBreath(direction, owner);
    });
    const release = (event) => {
      const owner = pointerOwners.get(event.pointerId);
      pointerOwners.delete(event.pointerId);
      if (event.pointerId !== undefined && button.hasPointerCapture?.(event.pointerId)) {
        button.releasePointerCapture?.(event.pointerId);
      }
      if (owner) endManualBreath(direction, owner);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault();
        beginManualBreath(direction, keyboardOwner);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        endManualBreath(direction, keyboardOwner);
      }
    });
  }
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    input.addEventListener("input", () => setControl(specification.key, Number(input.value), { mouth: specification.mouth }));
    input.addEventListener("change", () => setControl(specification.key, Number(input.value), {
      mouth: specification.mouth,
      announceChange: true,
    }));
  }
  $("level").addEventListener("input", (event) => setControl("level", Number(event.currentTarget.value)));
  $("resetAll").addEventListener("click", () => {
    referencePerformanceBaseline = null;
    referenceGestureStep = 0;
    cancelHeldTine();
    cancelManualBreath({ present: false });
    state = { ...JAW_HARP_DEFAULTS };
    resetBreathCycle(state.breathBalance * 0.5);
    releaseManualBreath();
    activeVowelId = "a";
    sequencedVowelId = null;
    vowelSequenceActiveStep = 0;
    vowelSequenceNextStep = 0;
    resetBreathSequenceClock();
    updatePresentation();
    postConfiguration();
    announce("Jaw harp restored to Temir khomus and open A mouth");
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const maximumPixels = 2_800_000;
  const pixels = cssWidth * cssHeight * pixelRatio * pixelRatio;
  if (pixels > maximumPixels) pixelRatio *= Math.sqrt(maximumPixels / pixels);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function responsiveAnatomyScale(width, height, compact) {
  if (compact) return clamp(Math.min(width / 460, height / 330), 0.68, 1);
  return clamp(Math.min(width / 1_085, height / 657), 1, 1.42);
}

function lipExtensionPixels(lipVisual, faceWidth, lipX, anatomyScale) {
  const maximumRetraction = Math.min(
    58 * anatomyScale,
    Math.max(34 * anatomyScale, faceWidth * 0.2),
  );
  const availableProtrusion = Math.max(
    30 * anatomyScale,
    cssWidth - lipX - 42,
  );
  const maximumProtrusion = Math.min(
    72 * anatomyScale,
    Math.max(48 * anatomyScale, faceWidth * 0.17),
    availableProtrusion,
  );
  if (lipVisual < 0) {
    return -maximumRetraction * (lipVisual / ARTICULATION_VISUAL_MIN);
  }
  return maximumProtrusion * (lipVisual / ARTICULATION_VISUAL_MAX);
}

function layout() {
  const mouthState = mouthPresentationState();
  const compact = cssHeight < 400 || cssWidth < 670;
  const anatomyScale = responsiveAnatomyScale(cssWidth, cssHeight, compact);
  const mouthY = cssHeight * (compact ? 0.48 : 0.51);
  const faceWidth = Math.min(
    cssWidth * (compact ? 0.52 : 0.47),
    (compact ? 360 : 510) * anatomyScale,
  );
  const lipX = cssWidth * (compact ? 0.69 : 0.7);
  const throatX = lipX - faceWidth * 0.62;
  const jawTravel = Math.min(76 * anatomyScale, cssHeight * 0.14);
  const jawVisual = articulationToVisual(mouthState.jawOpening);
  const tonguePositionVisual = articulationToVisual(mouthState.tonguePosition);
  const tongueHeightVisual = articulationToVisual(mouthState.tongueHeight);
  const lipVisual = articulationToVisual(mouthState.lipRounding);
  const maximumReachableJawGap = Math.max(
    6 * anatomyScale,
    cssHeight - mouthY - 132 * anatomyScale,
  );
  const jawGap = clamp(
    24 * anatomyScale + jawVisual * jawTravel,
    6 * anatomyScale,
    Math.min(
      24 * anatomyScale + ARTICULATION_VISUAL_MAX * jawTravel,
      maximumReachableJawGap,
    ),
  );
  const tongueX = clamp(
    throatX + (lipX - throatX) * (0.28 + tonguePositionVisual * 0.55),
    28,
    cssWidth - 28,
  );
  const tongueY = clamp(
    mouthY + jawGap * 0.55
      - tongueHeightVisual * (jawGap * 0.72 + 28 * anatomyScale),
    28,
    cssHeight - 28,
  );
  const lipExtension = lipExtensionPixels(
    lipVisual,
    faceWidth,
    lipX,
    anatomyScale,
  );
  const noseProjection = Math.min(
    104 * anatomyScale,
    Math.max(78 * anatomyScale, faceWidth * 0.43),
    Math.max(72 * anatomyScale, cssWidth - lipX - 18),
  );
  const harpBowX = Math.max(compact ? 55 : 190, lipX - faceWidth * 0.92);
  const releaseMotion = visualTineRelease && !prefersReducedMotion
    ? tineReleaseMotion(
      state,
      (performance.now() - visualTineRelease.startedAt) / 1_000,
      visualTineRelease.force,
      visualTineRelease.direction,
    )
    : 0;
  const triggerPull = pointerDrag?.type === "reed"
    ? Math.tanh(pointerDrag.pull / 1.22) * Math.min(148, cssHeight * 0.28)
    : releaseMotion * Math.min(96, cssHeight * 0.18);
  const triggerX = clamp(
    lipX + 104 * anatomyScale + lipExtension * 0.42,
    harpBowX + 86 * anatomyScale,
    cssWidth - 30,
  );
  const focusPad = {
    left: throatX + 8 * anatomyScale,
    right: lipX - 20 * anatomyScale,
    top: mouthY - 17 * anatomyScale,
    bottom: mouthY + 17 * anatomyScale,
  };
  focusPad.x = focusPad.left
    + rangeUnit(state.formantFocus, JAW_HARP_LIMITS.formantFocus) * (focusPad.right - focusPad.left);
  focusPad.y = focusPad.bottom
    - rangeUnit(state.cavityCoupling, JAW_HARP_LIMITS.cavityCoupling) * (focusPad.bottom - focusPad.top);
  const glottisY = mouthY + jawGap * 1.06;
  const glottisLeft = throatX + 4 * anatomyScale;
  const glottisRight = throatX + 34 * anatomyScale;
  const glottisX = glottisLeft
    + rangeUnit(state.glottisOpening, JAW_HARP_LIMITS.glottisOpening) * (glottisRight - glottisLeft);
  return {
    compact,
    anatomyScale,
    mouthY,
    faceWidth,
    lipX,
    throatX,
    jawTravel,
    jawVisual,
    jawGap,
    tongueX,
    tongueY,
    lipExtension,
    noseProjection,
    focusPad,
    glottisX,
    glottisY,
    focusX: focusPad.x,
    harpBowX,
    triggerX,
    triggerY: mouthY + triggerPull,
  };
}

function strokePath(color, width = 1, alpha = 1) {
  drawing.strokeStyle = color;
  drawing.lineWidth = width;
  drawing.globalAlpha = alpha;
  drawing.stroke();
  drawing.globalAlpha = 1;
}

function drawParameterPad(pad, color, title, xAxis, yAxis) {
  const padWidth = pad.right - pad.left;
  drawing.save();
  drawing.fillStyle = color;
  drawing.globalAlpha = 0.045;
  drawing.fillRect(pad.left, pad.top, pad.right - pad.left, pad.bottom - pad.top);
  drawing.globalAlpha = 1;
  drawing.strokeStyle = color;
  drawing.lineWidth = 0.9;
  drawing.globalAlpha = 0.42;
  drawing.strokeRect(pad.left, pad.top, pad.right - pad.left, pad.bottom - pad.top);
  drawing.globalAlpha = 0.2;
  drawing.beginPath();
  drawing.moveTo(pad.left, (pad.top + pad.bottom) * 0.5);
  drawing.lineTo(pad.right, (pad.top + pad.bottom) * 0.5);
  drawing.moveTo((pad.left + pad.right) * 0.5, pad.top);
  drawing.lineTo((pad.left + pad.right) * 0.5, pad.bottom);
  drawing.stroke();
  drawing.globalAlpha = 0.88;
  drawing.fillStyle = color;
  drawing.font = `650 ${padWidth < 100 ? 7 : 8}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "left";
  drawing.fillText(title, pad.left, pad.top - 9);
  drawing.textAlign = "right";
  drawing.fillText(yAxis, pad.right, pad.top - 9);
  drawing.textAlign = "center";
  drawing.globalAlpha = 0.66;
  drawing.fillText(xAxis, (pad.left + pad.right) * 0.5, pad.bottom + 12);
  drawing.restore();
}

function drawNode(x, y, color, label, type, radius = 7) {
  drawing.save();
  drawing.shadowColor = color;
  drawing.shadowBlur = 12;
  drawing.fillStyle = "#040605";
  drawing.strokeStyle = color;
  drawing.lineWidth = 1.5;
  drawing.beginPath();
  drawing.arc(x, y, radius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.shadowBlur = 0;
  drawing.fillStyle = color;
  drawing.font = "600 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, x, y - radius - 9);
  drawing.restore();
  handles.push({ type, x, y, radius: radius + 14 });
}

function drawHair(model, topY, backX) {
  const {
    compact, anatomyScale, throatX, lipX, mouthY,
  } = model;
  const crestY = Math.max(12, topY - (compact ? 8 : 13) * anatomyScale);
  const frontX = lipX - (compact ? 29 : 42) * anatomyScale;
  const headOverlapY = compact ? 3 : 5;
  const frontHairY = topY + 28 + headOverlapY;
  const backHairY = topY + 49 + headOverlapY;
  drawing.save();
  drawing.beginPath();
  drawing.moveTo(backX - 4 * anatomyScale, mouthY + 8 * anatomyScale);
  drawing.bezierCurveTo(
    backX - 31 * anatomyScale,
    mouthY - 18 * anatomyScale,
    backX - 36 * anatomyScale,
    topY + 48 * anatomyScale,
    throatX + 10 * anatomyScale,
    crestY + 9 * anatomyScale,
  );
  drawing.lineTo(throatX + 36 * anatomyScale, crestY);
  drawing.lineTo(throatX + 47 * anatomyScale, crestY + 12 * anatomyScale);
  drawing.lineTo(throatX + 65 * anatomyScale, crestY + 2 * anatomyScale);
  drawing.lineTo(throatX + 78 * anatomyScale, crestY + 16 * anatomyScale);
  drawing.lineTo(throatX + 96 * anatomyScale, crestY + 8 * anatomyScale);
  drawing.bezierCurveTo(
    frontX - 17 * anatomyScale,
    crestY + 11 * anatomyScale,
    frontX - 7 * anatomyScale,
    topY + 14 * anatomyScale,
    frontX,
    topY + (frontHairY - topY) * anatomyScale,
  );
  drawing.bezierCurveTo(
    frontX - 28 * anatomyScale,
    topY + (20 + headOverlapY) * anatomyScale,
    throatX + 27 * anatomyScale,
    topY + (31 + headOverlapY) * anatomyScale,
    throatX - 5 * anatomyScale,
    topY + (backHairY - topY) * anatomyScale,
  );
  drawing.bezierCurveTo(
    backX + 8 * anatomyScale,
    topY + 68 * anatomyScale,
    backX + 7 * anatomyScale,
    mouthY - 11 * anatomyScale,
    backX - 4 * anatomyScale,
    mouthY + 8 * anatomyScale,
  );
  drawing.closePath();
  drawing.fillStyle = "rgba(70, 55, 43, 0.48)";
  drawing.fill();
  strokePath("#b77a4e", 1, 0.54);
  drawing.beginPath();
  drawing.moveTo(throatX + 16 * anatomyScale, topY + 24 * anatomyScale);
  drawing.bezierCurveTo(
    throatX + 31 * anatomyScale,
    topY + 12 * anatomyScale,
    throatX + 43 * anatomyScale,
    topY + 25 * anatomyScale,
    throatX + 55 * anatomyScale,
    topY + 11 * anatomyScale,
  );
  drawing.moveTo(throatX + 53 * anatomyScale, topY + 25 * anatomyScale);
  drawing.bezierCurveTo(
    throatX + 69 * anatomyScale,
    topY + 11 * anatomyScale,
    throatX + 79 * anatomyScale,
    topY + 26 * anatomyScale,
    throatX + 92 * anatomyScale,
    topY + 15 * anatomyScale,
  );
  strokePath("#df9d5a", 0.75, 0.28);
  drawing.restore();
}

function drawEye(model) {
  const {
    compact, anatomyScale, lipX, mouthY,
  } = model;
  const normalizedFlow = clamp(
    visualBreathFlow / Math.max(0.2, state.breathDepth),
    -1,
    1,
  );
  const exhale = Math.max(0, normalizedFlow);
  const inhale = Math.max(0, -normalizedFlow);
  const eyeX = lipX - (compact ? 4 : 7) * anatomyScale;
  const eyeY = mouthY - (compact ? 70 : 84) * anatomyScale;
  const halfWidth = (compact ? 8.8 : 10.5)
    * anatomyScale * (1 + exhale * 0.06);
  const halfHeight = (compact ? 3.5 : 4.1)
    * anatomyScale * (1 + exhale * 0.36 - inhale * 0.11);
  drawing.save();
  drawing.beginPath();
  drawing.moveTo(eyeX - halfWidth, eyeY);
  drawing.quadraticCurveTo(eyeX, eyeY - halfHeight, eyeX + halfWidth, eyeY);
  drawing.quadraticCurveTo(eyeX, eyeY + halfHeight, eyeX - halfWidth, eyeY);
  drawing.closePath();
  drawing.fillStyle = "rgba(229, 229, 220, 0.82)";
  drawing.fill();
  strokePath("#9ea59f", 0.8, 0.82);
  drawing.beginPath();
  drawing.arc(
    eyeX + halfWidth * 0.16,
    eyeY,
    Math.max(1.25 * anatomyScale, halfHeight * 0.68),
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = "rgba(118, 223, 211, 0.72)";
  drawing.fill();
  drawing.beginPath();
  drawing.arc(
    eyeX + halfWidth * 0.18,
    eyeY,
    Math.max(0.65 * anatomyScale, halfHeight * 0.3),
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = "#111715";
  drawing.fill();
  drawing.beginPath();
  drawing.moveTo(
    eyeX - halfWidth - anatomyScale,
    eyeY - halfHeight - 4 * anatomyScale,
  );
  drawing.quadraticCurveTo(
    eyeX,
    eyeY - halfHeight - (7 + exhale) * anatomyScale,
    eyeX + halfWidth + 2 * anatomyScale,
    eyeY - halfHeight - 4 * anatomyScale,
  );
  strokePath("#8a6043", 1, 0.64);
  drawing.restore();
}

function drawHead(model) {
  const mouthState = mouthPresentationState();
  const {
    anatomyScale, throatX, lipX, mouthY, faceWidth, jawGap, lipExtension,
    noseProjection,
  } = model;
  const topY = mouthY - Math.min(230 * anatomyScale, cssHeight * 0.35);
  const backX = throatX - faceWidth * 0.18;
  drawHair(model, topY, backX);
  drawing.beginPath();
  drawing.moveTo(backX, mouthY + jawGap * 1.85);
  drawing.bezierCurveTo(
    backX - 25 * anatomyScale,
    mouthY + 40 * anatomyScale,
    backX - 32 * anatomyScale,
    topY + 58 * anatomyScale,
    throatX + 20 * anatomyScale,
    topY,
  );
  drawing.bezierCurveTo(
    lipX - 40 * anatomyScale,
    topY - 12 * anatomyScale,
    lipX + noseProjection * 0.47,
    topY + 48 * anatomyScale,
    lipX + noseProjection * 0.49,
    mouthY - 101 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX + noseProjection * 0.7,
    mouthY - 100 * anatomyScale,
    lipX + noseProjection,
    mouthY - 84 * anatomyScale,
    lipX + noseProjection * 0.92,
    mouthY - 61 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX + noseProjection * 0.84,
    mouthY - 49 * anatomyScale,
    lipX + noseProjection * 0.64,
    mouthY - 47 * anatomyScale,
    lipX + noseProjection * 0.53,
    mouthY - 50 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX + 37 * anatomyScale,
    mouthY - 30 * anatomyScale,
    lipX + 29 * anatomyScale + lipExtension,
    mouthY - 14 * anatomyScale,
    lipX + 23 * anatomyScale + lipExtension,
    mouthY - 7 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX + 34 * anatomyScale + lipExtension,
    mouthY + 2 * anatomyScale,
    lipX + 34 * anatomyScale + lipExtension,
    mouthY + 13 * anatomyScale,
    lipX + 19 * anatomyScale + lipExtension,
    mouthY + 17 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX + 36 * anatomyScale,
    mouthY + 50 * anatomyScale,
    lipX + 30 * anatomyScale,
    mouthY + jawGap + 46 * anatomyScale,
    lipX - 20 * anatomyScale,
    mouthY + jawGap + 78 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX - 90 * anatomyScale,
    mouthY + jawGap + 126 * anatomyScale,
    throatX - 12 * anatomyScale,
    mouthY + jawGap + 126 * anatomyScale,
    backX,
    mouthY + jawGap * 1.85,
  );
  strokePath("#6e756f", 1.15, 0.75);

  drawEye(model);
  drawing.beginPath();
  drawing.moveTo(
    lipX + noseProjection * 0.68,
    mouthY - 57 * anatomyScale,
  );
  drawing.quadraticCurveTo(
    lipX + noseProjection * 0.76,
    mouthY - 62 * anatomyScale,
    lipX + noseProjection * 0.82,
    mouthY - 56 * anatomyScale,
  );
  strokePath("#9a7c68", 0.9, 0.62);

  drawing.beginPath();
  drawing.moveTo(
    lipX + 21 * anatomyScale + lipExtension,
    mouthY - 5 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX - 24 * anatomyScale,
    mouthY - 14 * anatomyScale,
    throatX + 72 * anatomyScale,
    mouthY - 30 * anatomyScale,
    throatX + 22 * anatomyScale,
    mouthY + 2 * anatomyScale,
  );
  drawing.bezierCurveTo(
    throatX - 4 * anatomyScale,
    mouthY + 20 * anatomyScale,
    throatX + 2 * anatomyScale,
    mouthY + jawGap * 0.9,
    throatX + 24 * anatomyScale,
    mouthY + jawGap * 1.2,
  );
  drawing.bezierCurveTo(
    throatX + 74 * anatomyScale,
    mouthY + jawGap * 0.74,
    lipX - 36 * anatomyScale,
    mouthY + jawGap * 0.83,
    lipX + 18 * anatomyScale + lipExtension,
    mouthY + 12 * anatomyScale,
  );
  drawing.closePath();
  drawing.fillStyle = "rgba(118, 223, 211, 0.055)";
  drawing.fill();
  strokePath("#76dfd3", 1.15, 0.54);

  drawing.beginPath();
  const tongueLipX = lipX + 15 * anatomyScale + lipExtension * 0.72;
  drawing.moveTo(tongueLipX, mouthY + 12 * anatomyScale);
  drawing.bezierCurveTo(
    model.tongueX + 64 * anatomyScale,
    mouthY + jawGap * 0.72,
    model.tongueX + 44 * anatomyScale,
    model.tongueY + 3 * anatomyScale,
    model.tongueX,
    model.tongueY,
  );
  drawing.bezierCurveTo(
    model.tongueX - 66 * anatomyScale,
    model.tongueY + 2 * anatomyScale,
    throatX + 34 * anatomyScale,
    mouthY + jawGap * 0.8,
    throatX + 24 * anatomyScale,
    mouthY + jawGap * 1.2,
  );
  drawing.bezierCurveTo(
    throatX + 94 * anatomyScale,
    mouthY + jawGap * 1.18,
    lipX - 58 * anatomyScale,
    mouthY + jawGap * 1.22,
    tongueLipX,
    mouthY + 12 * anatomyScale,
  );
  drawing.closePath();
  drawing.fillStyle = "rgba(186, 154, 246, 0.12)";
  drawing.fill();
  strokePath("#ba9af6", 1.3, 0.7);

  drawing.beginPath();
  drawing.moveTo(
    lipX + 40 * anatomyScale,
    mouthY + jawGap + 53 * anatomyScale,
  );
  drawing.bezierCurveTo(
    lipX - 20 * anatomyScale,
    mouthY + jawGap + 75 * anatomyScale,
    throatX + 72 * anatomyScale,
    mouthY + jawGap * 1.55,
    throatX + 18 * anatomyScale,
    mouthY + jawGap * 1.22,
  );
  strokePath("#aeb4ae", 1, 0.42);

  drawing.beginPath();
  drawing.moveTo(
    throatX + 17 * anatomyScale,
    model.glottisY - 13 * anatomyScale,
  );
  drawing.lineTo(model.glottisX, model.glottisY);
  drawing.lineTo(
    throatX + 17 * anatomyScale,
    model.glottisY + 13 * anatomyScale,
  );
  strokePath("#ee786d", 2, 0.7);

  const formants = mouthFormants(mouthState).frequenciesHz;
  const waveCount = clamp(3 + Math.round(articulationToVisual(mouthState.formantFocus) * 5), 1, 16);
  for (let index = 0; index < waveCount; index += 1) {
    const amount = (index + 0.5) / waveCount;
    const x = throatX + (lipX - throatX) * amount;
    const radius = anatomyScale
      * (5 + Math.sin(amount * Math.PI) * (8 + mouthState.cavityCoupling * 11));
    drawing.beginPath();
    drawing.arc(
      x,
      mouthY + 3 * anatomyScale,
      radius,
      -Math.PI * 0.55,
      Math.PI * 0.55,
    );
    strokePath(index % 2 ? "#76dfd3" : "#f0c46e", 0.8, 0.15 + telemetry.energy * 0.25);
  }
  drawing.fillStyle = "rgba(118, 223, 211, 0.62)";
  drawing.font = `${Math.min(9, 7 * anatomyScale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "left";
  drawing.fillText(
    `F1 ${Math.round(formants[0])}`,
    throatX + 36 * anatomyScale,
    mouthY - 40 * anatomyScale,
  );
  drawing.fillText(
    `F2 ${Math.round(formants[1])}`,
    throatX + 95 * anatomyScale,
    mouthY - 40 * anatomyScale,
  );
  drawing.fillText(
    `F3 ${Math.round(formants[2])}`,
    throatX + 154 * anatomyScale,
    mouthY - 40 * anatomyScale,
  );
}

function drawBreathFlow(model) {
  const flow = visualBreathFlow;
  const amount = Math.sqrt(clamp(
    Math.abs(flow) / Math.max(0.001, JAW_HARP_LIMITS.breathFlow[1]),
  ));
  if (amount < 0.02) return;
  const { anatomyScale } = model;
  const exhaling = flow > 0;
  const startX = model.throatX + 24 * anatomyScale;
  const endX = model.triggerX + 38 * anatomyScale;
  const direction = exhaling ? 1 : -1;
  const color = exhaling ? "#f0c46e" : "#68bff1";
  const rateMotion = logarithmicUnit(
    effectiveBreathRateBpm(state),
    JAW_HARP_LIMITS.breathRateBpm,
  );
  const time = performance.now() * (0.00055 + amount * 0.0014 + rateMotion * 0.0032);
  drawing.save();
  drawing.lineCap = "round";
  for (let index = 0; index < 9; index += 1) {
    const travel = (time + index / 9) % 1;
    const position = exhaling ? travel : 1 - travel;
    const x = startX + (endX - startX) * position;
    const y = model.mouthY + Math.sin(index * 2.17 + time * Math.PI * 2)
      * anatomyScale * (3 + amount * 5);
    const length = anatomyScale * (7 + amount * 11);
    drawing.beginPath();
    drawing.moveTo(x - direction * length * 0.5, y);
    drawing.lineTo(x + direction * length * 0.5, y);
    drawing.lineTo(
      x + direction * (length * 0.5 - 4 * anatomyScale),
      y - 3 * anatomyScale,
    );
    drawing.moveTo(x + direction * length * 0.5, y);
    drawing.lineTo(
      x + direction * (length * 0.5 - 4 * anatomyScale),
      y + 3 * anatomyScale,
    );
    strokePath(color, 1.05, 0.16 + amount * 0.52);
  }
  drawing.fillStyle = color;
  drawing.globalAlpha = 0.7;
  drawing.font = `650 ${Math.min(9, 7 * anatomyScale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "center";
  drawing.fillText(
    exhaling ? "EXHALE · PRESSURE OUT" : "INHALE · PRESSURE IN",
    (startX + endX) * 0.5,
    model.mouthY + 29 * anatomyScale,
  );
  drawing.restore();
}

function drawHarp(model) {
  const {
    anatomyScale, harpBowX, lipX, mouthY, triggerX, triggerY,
  } = model;
  const gap = 15 * anatomyScale;
  const frameEnd = lipX + 10 * anatomyScale;
  drawing.lineCap = "round";
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28 * anatomyScale, mouthY - gap);
  drawing.bezierCurveTo(
    harpBowX - 22 * anatomyScale,
    mouthY - gap,
    harpBowX - 22 * anatomyScale,
    mouthY + gap,
    harpBowX + 28 * anatomyScale,
    mouthY + gap,
  );
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 5.5 * anatomyScale, 0.25);
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28 * anatomyScale, mouthY - gap);
  drawing.bezierCurveTo(
    harpBowX - 22 * anatomyScale,
    mouthY - gap,
    harpBowX - 22 * anatomyScale,
    mouthY + gap,
    harpBowX + 28 * anatomyScale,
    mouthY + gap,
  );
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 1.35 * anatomyScale, 0.95);

  drawing.beginPath();
  drawing.moveTo(harpBowX + 2 * anatomyScale, mouthY);
  drawing.quadraticCurveTo((harpBowX + triggerX) * 0.5, mouthY - (triggerY - mouthY) * 0.42, triggerX, triggerY);
  strokePath("#f0c46e", 2.1 * anatomyScale, 0.95);
  drawing.beginPath();
  drawing.moveTo(triggerX, triggerY - 16 * anatomyScale);
  drawing.lineTo(triggerX, triggerY + 16 * anatomyScale);
  drawing.lineTo(
    triggerX + 10 * anatomyScale,
    triggerY + 20 * anatomyScale,
  );
  strokePath("#f0c46e", 2.2 * anatomyScale, 0.95);

  drawing.fillStyle = "rgba(223, 157, 90, 0.64)";
  drawing.font = `600 ${Math.min(9, 7 * anatomyScale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "center";
  drawing.fillText(
    "FRAME",
    harpBowX + 70 * anatomyScale,
    mouthY + 38 * anatomyScale,
  );
  drawing.fillText(
    "FREE REED",
    (harpBowX + triggerX) * 0.5,
    mouthY - 28 * anatomyScale,
  );
}

function drawStage() {
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.fillStyle = "#040605";
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  drawing.strokeStyle = "rgba(223, 157, 90, 0.024)";
  drawing.lineWidth = 1;
  for (let x = 0; x < cssWidth; x += 34) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, cssHeight); drawing.stroke();
  }
  for (let y = 0; y < cssHeight; y += 34) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(cssWidth, y); drawing.stroke();
  }
  const model = layout();
  handles = [];
  drawHead(model);
  drawBreathFlow(model);
  drawHarp(model);
  const mouthState = mouthPresentationState();
  drawParameterPad(
    model.focusPad,
    "#76dfd3",
    model.compact ? "RESONATOR" : `RESONATOR ${Math.round(mouthState.cavityCoupling * 100)}%`,
    "FOCUS →",
    "COUPLE ↑",
  );
  drawNode(
    model.triggerX + 6 * model.anatomyScale,
    model.triggerY,
    "#f0c46e",
    "PULL / PLUCK",
    "reed",
    8,
  );
  drawNode(model.tongueX, model.tongueY, "#ba9af6", "TONGUE", "tongue", 7);
  drawNode(
    clamp(
      model.lipX + 24 * model.anatomyScale + model.lipExtension,
      22,
      cssWidth - 22,
    ),
    model.mouthY + 5 * model.anatomyScale,
    "#76dfd3",
    "LIPS",
    "lips",
    7,
  );
  drawNode(
    model.lipX - 20 * model.anatomyScale,
    model.mouthY + model.jawGap + 74 * model.anatomyScale,
    "#ee786d",
    "JAW",
    "jaw",
    7,
  );
  drawNode(model.focusPad.x, model.focusPad.y, "#76dfd3", "FOCUS / CAVITY", "focus", 7);
  drawNode(model.glottisX, model.glottisY, "#ee786d", "GLOTTIS", "glottis", 7);
  pluckFlash *= prefersReducedMotion ? 0 : 0.91;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function nearestHandle(point) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance <= handle.radius && distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared);
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function interactionAt(point) {
  const node = nearestHandle(point);
  if (node) return node;
  const model = layout();
  const reedStart = {
    x: model.harpBowX + 2 * model.anatomyScale,
    y: model.mouthY,
  };
  const reedEnd = {
    x: model.triggerX + 8 * model.anatomyScale,
    y: model.triggerY,
  };
  if (distanceToSegment(point, reedStart, reedEnd) <= 24) {
    return { type: "reed", x: model.triggerX, y: model.triggerY, radius: 24 };
  }
  return null;
}

function commitParameterPatch(patch, { mouthChanged = false } = {}) {
  const changedAt = performance.now();
  const previousState = state;
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, ...patch }, state);
  if (mouthChanged) {
    state = sanitizeJawHarpState({ ...state, vowelSequenceMode: "off" }, state);
    sequencedVowelId = null;
    vowelSequenceActiveStep = 0;
    vowelSequenceNextStep = 0;
  }
  markReferencePerformanceCustom(...Object.keys(patch));
  if (mouthChanged) activeVowelId = null;
  if ("repeatRateBpm" in patch || "repeatSwing" in patch) {
    retimeRepeatClock(previousState, changedAt);
  }
  if (
    ("breathRateBpm" in patch || "repeatRateBpm" in patch)
    && effectiveBreathRateBpm(previousState) !== effectiveBreathRateBpm(state)
  ) preserveBreathCyclePhase(previousPhase, changedAt);
  updatePresentation();
  postConfiguration();
  if ("breathDepth" in patch && manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathDepth);
  }
}

function setFromPointer(type, point, drag) {
  const model = layout();
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  const horizontalSpan = Math.max(90, model.lipX - model.throatX);
  const verticalSpan = Math.max(90, cssHeight * 0.36);
  let patch = null;
  if (type === "tongue") {
    const position = drag.startValues.tonguePosition + dx / horizontalSpan * 2.5;
    const height = drag.startValues.tongueHeight - dy / verticalSpan * 2.5;
    patch = { tonguePosition: position, tongueHeight: height };
  } else if (type === "jaw") {
    patch = { jawOpening: drag.startValues.jawOpening + dy / verticalSpan * 2.5 };
  } else if (type === "lips") {
    patch = { lipRounding: drag.startValues.lipRounding + dx / horizontalSpan * 3.5 };
  } else if (type === "focus") {
    const width = Math.max(1, model.focusPad.right - model.focusPad.left);
    const height = Math.max(1, model.focusPad.bottom - model.focusPad.top);
    const formantUnit = rangeUnit(
      drag.startValues.formantFocus,
      JAW_HARP_LIMITS.formantFocus,
    ) + dx / width;
    const couplingUnit = rangeUnit(
      drag.startValues.cavityCoupling,
      JAW_HARP_LIMITS.cavityCoupling,
    ) - dy / height;
    patch = {
      formantFocus: rangeValue(formantUnit, JAW_HARP_LIMITS.formantFocus),
      cavityCoupling: rangeValue(couplingUnit, JAW_HARP_LIMITS.cavityCoupling),
    };
  } else if (type === "glottis") {
    const glottisUnit = rangeUnit(
      drag.startValues.glottisOpening,
      JAW_HARP_LIMITS.glottisOpening,
    ) + dx / (30 * model.anatomyScale);
    patch = { glottisOpening: rangeValue(glottisUnit, JAW_HARP_LIMITS.glottisOpening) };
  }
  if (patch) commitParameterPatch(patch, { mouthChanged: true });
}

function installCanvasInteractions() {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (pointerDrag) return;
    const point = canvasPoint(event);
    const handle = interactionAt(point);
    if (!handle) return;
    event.preventDefault();
    pointerDrag = {
      type: handle.type,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startValues: {
        tonguePosition: state.tonguePosition,
        tongueHeight: state.tongueHeight,
        jawOpening: state.jawOpening,
        lipRounding: state.lipRounding,
        formantFocus: state.formantFocus,
        cavityCoupling: state.cavityCoupling,
        glottisOpening: state.glottisOpening,
      },
      pull: 0,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    if (handle.type === "reed") {
      tineReleaseGeneration += 1;
      performanceIntentGeneration += 1;
      tineIsHeld = true;
      visualTineRelease = null;
      graph?.sourceNode?.port.postMessage({ type: "hold-tine" });
      $("pluckState").textContent = "tine held · pull, wait, then release";
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(event);
    if (pointerDrag.type === "reed") {
      const pullUnit = Math.max(42, Math.min(112, cssHeight * 0.19));
      pointerDrag.pull = clamp(
        (point.y - pointerDrag.startY) / pullUnit,
        -MAX_TINE_PULL,
        MAX_TINE_PULL,
      );
      const force = pluckForceFromPull(pointerDrag.pull, state.pluckForce);
      $("pluckState").textContent = `${Math.round(Math.abs(pointerDrag.pull) * 100)}% tension · ${Math.round(force * 100)}% attack · release to strike`;
    } else setFromPointer(pointerDrag.type, point, pointerDrag);
  });
  const clearPointer = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    return clearPointerInteraction();
  };
  const releasePointer = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    if (pointerDrag.type === "reed") {
      const pullUnit = Math.max(42, Math.min(112, cssHeight * 0.19));
      pointerDrag.pull = clamp(
        (point.y - pointerDrag.startY) / pullUnit,
        -MAX_TINE_PULL,
        MAX_TINE_PULL,
      );
    }
    const drag = clearPointer(event);
    if (drag?.type === "reed") {
      const force = pluckForceFromPull(drag.pull, state.pluckForce);
      if (force > 0) {
        void releaseTine({ force, direction: drag.pull < 0 ? -1 : 1 });
      } else {
        cancelHeldTine();
      }
    }
  };
  const cancelPointer = (event) => {
    const drag = clearPointer(event);
    if (drag?.type === "reed") cancelHeldTine();
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("lostpointercapture", cancelPointer);
}

function xyPadPatch(type, horizontalUnit, verticalUnit) {
  if (type === "air") {
    return {
      breathRateBpm: logarithmicValue(horizontalUnit, JAW_HARP_LIMITS.breathRateBpm),
      breathDepth: rangeValue(verticalUnit, JAW_HARP_LIMITS.breathDepth),
    };
  }
  if (type === "rhythm") {
    return {
      repeatRateBpm: logarithmicValue(horizontalUnit, JAW_HARP_LIMITS.repeatRateBpm),
      repeatSwing: rangeValue(verticalUnit, JAW_HARP_LIMITS.repeatSwing),
    };
  }
  return null;
}

function currentXYPadUnits(type) {
  if (type === "air") {
    return {
      horizontal: logarithmicUnit(state.breathRateBpm, JAW_HARP_LIMITS.breathRateBpm),
      vertical: rangeUnit(state.breathDepth, JAW_HARP_LIMITS.breathDepth),
    };
  }
  if (type === "rhythm") {
    return {
      horizontal: logarithmicUnit(state.repeatRateBpm, JAW_HARP_LIMITS.repeatRateBpm),
      vertical: rangeUnit(state.repeatSwing, JAW_HARP_LIMITS.repeatSwing),
    };
  }
  return null;
}

function installXYPadInteractions() {
  for (const pad of document.querySelectorAll("[data-jaw-xy-pad]")) {
    const type = pad.dataset.jawXyPad;
    let pointerId = null;
    const updateFromPointer = (event) => {
      const bounds = pad.getBoundingClientRect();
      const horizontal = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width));
      const vertical = 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height));
      const patch = xyPadPatch(type, horizontal, vertical);
      if (patch) commitParameterPatch(patch);
    };
    pad.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (pointerId !== null) return;
      event.preventDefault();
      pointerId = event.pointerId;
      pad.setPointerCapture?.(event.pointerId);
      pad.classList.add("is-dragging");
      updateFromPointer(event);
    });
    pad.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      updateFromPointer(event);
    });
    const releasePointer = (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      pad.classList.remove("is-dragging");
      if (pad.hasPointerCapture?.(event.pointerId)) pad.releasePointerCapture?.(event.pointerId);
    };
    pad.addEventListener("pointerup", releasePointer);
    pad.addEventListener("pointercancel", releasePointer);
    pad.addEventListener("lostpointercapture", releasePointer);
    pad.addEventListener("keydown", (event) => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowDown: [0, -1],
        ArrowUp: [0, 1],
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.05 : 0.0125;
      const current = currentXYPadUnits(type);
      if (!current) return;
      const patch = xyPadPatch(
        type,
        current.horizontal + direction[0] * step,
        current.vertical + direction[1] * step,
      );
      if (patch) commitParameterPatch(patch);
    });
  }
}

function installKeyboard() {
  const inhaleOwner = { type: "keyboard", key: "[" };
  const exhaleOwner = { type: "keyboard", key: "]" };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelHeldTine();
      cancelManualBreath({ present: false });
      state = sanitizeJawHarpState({ ...state, repeat: false }, state);
      commandedBreathFlow = 0;
      lastBreathTelemetryAt = -Infinity;
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      updateTransportPresentation();
      updateBreathPresentation(0);
      announce("Jaw harp stopped");
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
    const key = event.key.toLowerCase();
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      pluck();
    } else if ("aeiou".includes(key) && !event.repeat) {
      event.preventDefault();
      loadVowel(key);
    } else if (/^[1-5]$/.test(event.key) && !event.repeat) {
      event.preventDefault();
      loadHarp(JAW_HARP_PRESETS[Number(event.key) - 1].id);
    } else if (key === "r" && !event.repeat) {
      event.preventDefault();
      toggleRepeat();
    } else if (event.key === "[" && !event.repeat) {
      event.preventDefault();
      beginManualBreath(-1, inhaleOwner);
    } else if (event.key === "]" && !event.repeat) {
      event.preventDefault();
      beginManualBreath(1, exhaleOwner);
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "[") endManualBreath(-1, inhaleOwner);
    if (event.key === "]") endManualBreath(1, exhaleOwner);
  });
}

function handleMidiInput(event) {
  const { message, routeId, source } = event.detail ?? {};
  if (!message || (routeId && routeId !== "jaw-harp")) return;
  if (
    source === "wax"
    && document.documentElement.dataset.morphazoidWaxOutputMode === "midi"
  ) return;
  const isNoteOn = message.type === "noteOn" && Number(message.velocity) > 0;
  const isNoteOff = message.type === "noteOff"
    || (message.type === "noteOn" && Number(message.velocity) <= 0);
  if (!isNoteOn && !isNoteOff) return;
  // Claim the event synchronously so browser and WAX fallbacks cannot add a
  // second click or discard velocity while audio startup is awaited.
  event.preventDefault();
  if (isNoteOff) return;
  const numericNote = Number(message.note);
  const note = clamp(Number.isFinite(numericNote) ? Math.round(numericNote) : 60, 0, 127);
  const frequency = clamp(
    440 * (2 ** ((note - 69) / 12)),
    JAW_HARP_LIMITS.reedFrequencyHz[0],
    JAW_HARP_LIMITS.reedFrequencyHz[1],
  );
  const velocity = clamp((Number(message.velocity) || 1) / 127, 0.01, 1);
  setControl("reedFrequencyHz", frequency);
  void pluck({ velocity, automatic: true, announcePluck: false });
}

function tick(time) {
  updateBreathVowelSequence(time);
  if (state.repeat && graph && audioContext?.state === "running" && time >= nextRepeatAt) {
    const hit = jawHarpRhythmHit(state, repeatStep);
    if (hit.active && !tineIsHeld) {
      pluck({
        automatic: true,
        velocity: hit.velocity,
        direction: repeatHitCount % 2 ? -state.pluckDirection : state.pluckDirection,
      });
      repeatHitCount += 1;
    }
    renderPulseMap();
    nextRepeatAt = time + repeatIntervalMs(state.repeatRateBpm, repeatStep, state.repeatSwing) * 0.5;
    repeatStep += 1;
  }
  const flow = breathFlowAt(time);
  commandedBreathFlow = flow;
  const displayedFlow = breathFlowForDisplay(time);
  const breathResponse = prefersReducedMotion
    ? 1
    : 0.16 + logarithmicUnit(
      effectiveBreathRateBpm(state),
      JAW_HARP_LIMITS.breathRateBpm,
    ) * 0.52;
  visualBreathFlow += (displayedFlow - visualBreathFlow) * breathResponse;
  if (graph?.analyser) graph.analyser.getFloatTimeDomainData(waveform);
  $("motionReadout").textContent = telemetry.rms > 0.0004 ? `${Math.round(clamp(telemetry.energy) * 100)}% energy` : "resting";
  updateBreathPresentation(displayedFlow);
  drawStage();
  animationFrame = requestAnimationFrame(tick);
}

buildPresets();
installControls();
installCanvasInteractions();
installXYPadInteractions();
installKeyboard();
updatePresentation();
resizeCanvas();
globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
globalThis.addEventListener("resize", resizeCanvas);
globalThis.addEventListener("blur", cancelTransientPerformance);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelTransientPerformance();
});
new ResizeObserver(resizeCanvas).observe(stageWrap);
animationFrame = requestAnimationFrame(tick);

globalThis.addEventListener("pagehide", () => {
  pageIsActive = false;
  pageLifecycleGeneration += 1;
  requestAudioState(false);
  cancelTransientPerformance();
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  const closingGraph = graph;
  const closingContext = audioContext;
  graph = null;
  audioContext = null;
  audioStartupPromise = null;
  closingGraph?.releaseOutput?.();
  void closingContext?.close?.();
});

globalThis.addEventListener("pageshow", () => {
  if (pageIsActive) return;
  pageIsActive = true;
  manualBreathDirection = 0;
  commandedBreathFlow = 0;
  visualBreathFlow = 0;
  lastBreathTelemetryAt = -Infinity;
  waveform.fill(0);
  telemetry = { ...telemetry, displacement: 0, energy: 0, peak: 0, rms: 0, breathFlow: 0 };
  visualTineRelease = null;
  setAudioPresentation("off");
  updatePresentation();
  animationFrame = requestAnimationFrame(tick);
});
