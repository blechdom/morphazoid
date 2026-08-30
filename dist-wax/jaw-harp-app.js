import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_LIMITS,
  JAW_HARP_PRESETS,
  JAW_HARP_RANDOM_LIMITS,
  JAW_HARP_RHYTHMS,
  MAX_TINE_PULL,
  VOWEL_PRESETS,
  applyVowel,
  breathCycleFlow,
  clamp,
  dominantHarmonic,
  effectiveBreathRateBpm,
  jawHarpPreset,
  jawHarpRhythm,
  jawHarpRhythmHit,
  jawHarpState,
  mouthFormants,
  mouthGeometry,
  pluckForceFromPull,
  randomizeJawHarpState,
  reedMaterialProperties,
  repeatIntervalMs,
  sanitizeJawHarpState,
  tineReleaseMotion,
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
  { key: "breathRateBpm", format: (value) => `${Math.round(value)} cycles/min` },
  { key: "breathBalance", format: (value) => `${Math.round(value * 100)} / ${Math.round((1 - value) * 100)}` },
  { key: "repeatRateBpm", format: (value) => `${Math.round(value)} BPM` },
  { key: "repeatSwing", format: (value) => `${Math.round(value * 100)}%` },
]);
const TEMPO_SLIDER_TICKS = Object.freeze([36, 60, 120, 240, 480]);
// Randomized models can legitimately retain a near-zero performance force. Keep
// that setting intact, but use a dependable strike for the one-shot audition.
const RANDOMIZE_AUDITION_FORCE_FLOOR = JAW_HARP_DEFAULTS.pluckForce;

let state = jawHarpState("khomus");
let activeVowelId = "a";
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

function audioConfiguration() {
  return { ...state };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
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
  graph?.sourceNode?.port.postMessage({ type: "breath-cycle-reset", phase: wrapped });
}

function preserveBreathCyclePhase(previousPhase, time = performance.now()) {
  anchorBreathCyclePhase(previousPhase, time);
}

function breathFlowAt(time = performance.now()) {
  if (manualBreathDirection) return manualBreathDirection * state.breathDepth;
  if (!state.autoBreath) return 0;
  return breathCycleFlow(state, breathCyclePhaseAt(time));
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
  releaseManualBreath();
  updateBreathPresentation(flow);
}

function toggleBreathCycle() {
  state = sanitizeJawHarpState({ ...state, autoBreath: !state.autoBreath }, state);
  resetBreathCycle(state.autoBreath ? state.breathBalance * 0.5 : 0);
  postConfiguration();
  const flow = breathFlowAt();
  commandedBreathFlow = flow;
  updateBreathPresentation(flow);
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
  force = state.pluckForce,
  direction = state.pluckDirection,
  position = state.pluckPosition,
  automatic = false,
  announcePluck = !automatic,
} = {}) {
  if (tineIsHeld) return false;
  const intentGeneration = performanceIntentGeneration;
  if (!audioGraphIsRunning() && !(await ensureAudio())) return false;
  if (intentGeneration !== performanceIntentGeneration || tineIsHeld) return false;
  const strength = clamp(
    force,
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  graph.sourceNode.port.postMessage({
    type: "pluck", force: strength, direction, position, automatic,
  });
  presentPluck(direction, announcePluck, strength);
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
  graph.sourceNode.port.postMessage({
    type: "pluck",
    force,
    direction: state.pluckDirection,
    position: state.pluckPosition,
    automatic: true,
  });
  presentPluck(state.pluckDirection, false, force);
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
  if (drag.type === "reed") $("pluckState").textContent = "space · pull canvas trigger";
  return drag;
}

function cancelHeldTine() {
  tineReleaseGeneration += 1;
  performanceIntentGeneration += 1;
  clearPointerInteraction();
  graph?.sourceNode?.port.postMessage({ type: "release-tine" });
  tineIsHeld = false;
  visualTineRelease = null;
  $("pluckState").textContent = "space · pull canvas trigger";
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
  nextRepeatAt = performance.now();
  updateTransportPresentation();
  postConfiguration();
  announce(`Jaw-harp repeat ${next ? "on" : "off"}`);
}

function toggleBreathLink() {
  const changedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, breathLinked: !state.breathLinked }, state);
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
  $("pluckOutward").setAttribute("aria-pressed", String(state.pluckDirection > 0));
  $("pluckInward").setAttribute("aria-pressed", String(state.pluckDirection < 0));
  postConfiguration();
}

function setControl(key, value, { mouth = false, announceChange = false } = {}) {
  const changedAt = performance.now();
  const previousState = state;
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, [key]: value }, state);
  if (["repeatRateBpm", "repeatSwing"].includes(key)) {
    retimeRepeatClock(previousState, changedAt);
  }
  if (
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

function loadVowel(vowelId) {
  state = applyVowel(state, vowelId);
  activeVowelId = vowelId;
  updatePresentation();
  postConfiguration();
  announce(`${VOWEL_PRESETS.find(({ id }) => id === vowelId)?.phoneme ?? vowelId} mouth shape loaded`);
}

function randomizeModel() {
  const randomizedAt = performance.now();
  cancelHeldTine();
  cancelManualBreath({ present: false });
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  state = randomizeJawHarpState(state);
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
  updatePresentation();
  postConfiguration();
  void auditionRandomizedModel();
  announce(`Jaw-harp model randomized · ${state.repeat ? `${Math.round(state.repeatRateBpm)} BPM repeat` : "repeat off"}`);
}

function updatePresentation() {
  const preset = jawHarpPreset(state.presetId);
  const material = reedMaterialProperties(state);
  const geometry = mouthGeometry(state);
  const formants = mouthFormants(state);
  const harmonic = dominantHarmonic(state);
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
  for (const button of $("vowelButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.vowel === activeVowelId));
  }
  $("reedReadout").textContent = formatFrequency(state.reedFrequencyHz);
  $("harmonicReadout").textContent = `${harmonic.index} × · ${formatFrequency(harmonic.frequencyHz)}`;
  $("cavityReadout").textContent = `${(geometry.lengthM * 100).toFixed(1)} cm · ${Math.round(geometry.volumeMl)} ml`;
  $("reedSummary").textContent = `${Math.round(state.reedFrequencyHz)} Hz · ${preset.family}`;
  $("mouthSummary").textContent = `${activeVowelId ? VOWEL_PRESETS.find(({ id }) => id === activeVowelId)?.phoneme : "custom"} · ${(geometry.lengthM * 100).toFixed(1)} cm cavity`;
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
  $("vowelButtons").replaceChildren(...VOWEL_PRESETS.map((vowel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.vowel = vowel.id;
    button.innerHTML = `${vowel.label}<small>${vowel.phoneme}</small>`;
    button.setAttribute("aria-pressed", String(vowel.id === activeVowelId));
    button.addEventListener("click", () => loadVowel(vowel.id));
    return button;
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
    cancelHeldTine();
    cancelManualBreath({ present: false });
    state = { ...JAW_HARP_DEFAULTS };
    resetBreathCycle(state.breathBalance * 0.5);
    releaseManualBreath();
    activeVowelId = "a";
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

function lipExtensionPixels(lipVisual, faceWidth, lipX) {
  const maximumRetraction = Math.min(58, Math.max(34, faceWidth * 0.2));
  const availableProtrusion = Math.max(30, cssWidth - lipX - 42);
  const maximumProtrusion = Math.min(
    72,
    Math.max(48, faceWidth * 0.17),
    availableProtrusion,
  );
  if (lipVisual < 0) {
    return -maximumRetraction * (lipVisual / ARTICULATION_VISUAL_MIN);
  }
  return maximumProtrusion * (lipVisual / ARTICULATION_VISUAL_MAX);
}

function layout() {
  const compact = cssHeight < 400 || cssWidth < 670;
  const mouthY = cssHeight * (compact ? 0.55 : 0.51);
  const faceWidth = Math.min(cssWidth * (compact ? 0.52 : 0.47), compact ? 360 : 510);
  const lipX = cssWidth * (compact ? 0.69 : 0.7);
  const throatX = lipX - faceWidth * 0.62;
  const jawTravel = Math.min(76, cssHeight * 0.14);
  const jawVisual = articulationToVisual(state.jawOpening);
  const tonguePositionVisual = articulationToVisual(state.tonguePosition);
  const tongueHeightVisual = articulationToVisual(state.tongueHeight);
  const lipVisual = articulationToVisual(state.lipRounding);
  const maximumReachableJawGap = Math.max(6, cssHeight - mouthY - 94);
  const jawGap = clamp(
    24 + jawVisual * jawTravel,
    6,
    Math.min(24 + ARTICULATION_VISUAL_MAX * jawTravel, maximumReachableJawGap),
  );
  const tongueX = clamp(
    throatX + (lipX - throatX) * (0.28 + tonguePositionVisual * 0.55),
    28,
    cssWidth - 28,
  );
  const tongueY = clamp(
    mouthY + jawGap * 0.55 - tongueHeightVisual * (jawGap * 0.72 + 28),
    28,
    cssHeight - 28,
  );
  const lipExtension = lipExtensionPixels(lipVisual, faceWidth, lipX);
  const noseProjection = Math.min(
    104,
    Math.max(78, faceWidth * 0.43),
    Math.max(72, cssWidth - lipX - 18),
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
    lipX + 104 + lipExtension * 0.42,
    harpBowX + 86,
    cssWidth - 30,
  );
  const padRight = Math.min(
    cssWidth - 18,
    Math.max(compact ? 124 : 130, harpBowX - 14),
  );
  const padWidth = compact
    ? clamp(padRight - 12, 96, 108)
    : clamp(padRight - 18, 112, 164);
  const padHeight = compact ? 60 : 76;
  const padLeft = Math.max(16, padRight - padWidth);
  const airTop = clamp(
    mouthY - (compact ? 72 : 118),
    compact ? 84 : 150,
    Math.max(compact ? 84 : 150, cssHeight - padHeight - (compact ? 104 : 194)),
  );
  const rhythmBottom = Math.min(
    cssHeight - (compact ? 26 : 54),
    mouthY + (compact ? 100 : 170),
  );
  const airPad = {
    left: padLeft,
    right: padRight,
    top: airTop,
    bottom: airTop + padHeight,
  };
  airPad.x = airPad.left
    + logarithmicUnit(state.breathRateBpm, JAW_HARP_LIMITS.breathRateBpm) * (airPad.right - airPad.left);
  airPad.y = airPad.bottom
    - rangeUnit(state.breathDepth, JAW_HARP_LIMITS.breathDepth) * (airPad.bottom - airPad.top);
  const rhythmPad = {
    left: padLeft,
    right: padRight,
    top: rhythmBottom - padHeight,
    bottom: rhythmBottom,
  };
  rhythmPad.x = rhythmPad.left
    + logarithmicUnit(state.repeatRateBpm, JAW_HARP_LIMITS.repeatRateBpm) * (rhythmPad.right - rhythmPad.left);
  rhythmPad.y = rhythmPad.bottom
    - rangeUnit(state.repeatSwing, JAW_HARP_LIMITS.repeatSwing) * (rhythmPad.bottom - rhythmPad.top);
  const focusPad = {
    left: throatX + 8,
    right: lipX - 20,
    top: mouthY - 17,
    bottom: mouthY + 17,
  };
  focusPad.x = focusPad.left
    + rangeUnit(state.formantFocus, JAW_HARP_LIMITS.formantFocus) * (focusPad.right - focusPad.left);
  focusPad.y = focusPad.bottom
    - rangeUnit(state.cavityCoupling, JAW_HARP_LIMITS.cavityCoupling) * (focusPad.bottom - focusPad.top);
  const glottisY = mouthY + jawGap * 1.06;
  const glottisLeft = throatX + 4;
  const glottisRight = throatX + 34;
  const glottisX = glottisLeft
    + rangeUnit(state.glottisOpening, JAW_HARP_LIMITS.glottisOpening) * (glottisRight - glottisLeft);
  return {
    compact,
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
    airPad,
    rhythmPad,
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

function drawAirPadDetails(pad) {
  const narrow = pad.right - pad.left < 120;
  const flow = breathFlowForDisplay();
  const amount = Math.round(clamp(Math.abs(flow) / Math.max(0.01, state.breathDepth)) * 100);
  const multiplier = state.breathRateBpm / JAW_HARP_DEFAULTS.breathRateBpm;
  const mode = manualBreathDirection
    ? "MANUAL BREATH"
    : state.autoBreath
      ? narrow
        ? `AUTO · ${state.breathLinked ? `LINK ×${multiplier.toFixed(multiplier >= 10 ? 1 : 2)}` : "FREE"}`
        : `AUTO · ${state.breathLinked ? `LINKED ×${multiplier.toFixed(multiplier >= 10 ? 1 : 2)}` : "FREE"} · IN ${Math.round(state.breathBalance * 100)} / OUT ${Math.round((1 - state.breathBalance) * 100)}`
      : narrow ? "AUTO OFF · HOLD BREATH" : "AUTO OFF · HOLD IN / OUT";
  const phase = !manualBreathDirection && state.autoBreath && Math.abs(flow) < 0.025
    ? "TURNAROUND · AIR ≈ 0"
    : flow < 0
      ? `← INHALE ${amount}%`
      : flow > 0
        ? `EXHALE ${amount}% →`
        : "REST · AIR 0%";
  drawing.save();
  drawing.fillStyle = "#68bff1";
  drawing.font = `650 ${pad.right - pad.left < 100 ? 6.2 : 7.2}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.globalAlpha = 0.82;
  drawing.textAlign = "center";
  drawing.fillText(mode, (pad.left + pad.right) * 0.5, pad.top + 11);
  drawing.globalAlpha = 0.94;
  drawing.fillText(phase, (pad.left + pad.right) * 0.5, pad.bottom - 7);
  drawing.restore();
}

function drawRhythmPadDetails(pad) {
  const rhythm = jawHarpRhythm(state.rhythmId);
  drawing.save();
  drawing.fillStyle = "#f0c46e";
  drawing.font = `650 ${pad.right - pad.left < 100 ? 6.2 : 7.2}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.globalAlpha = 0.78;
  drawing.textAlign = "center";
  drawing.fillText(
    `REPEAT ${state.repeat ? "ON" : "OFF"} · ${rhythm.steps.length}-STEP LOOP`,
    (pad.left + pad.right) * 0.5,
    pad.top + 11,
  );
  drawing.restore();
}

function drawTempoSlider(pad) {
  const railY = clamp(pad.y, pad.top, pad.bottom);
  const tempoX = clamp(pad.x, pad.left, pad.right);
  const width = Math.max(1, pad.right - pad.left);
  const tickHeight = Math.max(3, Math.min(5, (pad.bottom - pad.top) * 0.1));
  drawing.save();
  drawing.strokeStyle = "#f0c46e";
  drawing.lineCap = "round";
  drawing.globalAlpha = 0.68;
  drawing.lineWidth = 2;
  drawing.beginPath();
  drawing.moveTo(pad.left, railY);
  drawing.lineTo(pad.right, railY);
  drawing.stroke();
  drawing.globalAlpha = 0.72;
  drawing.lineWidth = 0.8;
  for (const bpm of TEMPO_SLIDER_TICKS) {
    const x = pad.left
      + logarithmicUnit(bpm, JAW_HARP_LIMITS.repeatRateBpm) * width;
    drawing.beginPath();
    drawing.moveTo(x, railY - tickHeight);
    drawing.lineTo(x, railY + tickHeight);
    drawing.stroke();
  }
  drawing.globalAlpha = 0.26;
  drawing.beginPath();
  drawing.moveTo(tempoX, pad.top);
  drawing.lineTo(tempoX, pad.bottom);
  drawing.stroke();
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
  const { compact, throatX, lipX, mouthY } = model;
  const crestY = Math.max(12, topY - (compact ? 8 : 13));
  const frontX = lipX - (compact ? 29 : 42);
  drawing.save();
  drawing.beginPath();
  drawing.moveTo(backX - 4, mouthY + 8);
  drawing.bezierCurveTo(backX - 31, mouthY - 18, backX - 36, topY + 48, throatX + 10, crestY + 9);
  drawing.lineTo(throatX + 36, crestY);
  drawing.lineTo(throatX + 47, crestY + 12);
  drawing.lineTo(throatX + 65, crestY + 2);
  drawing.lineTo(throatX + 78, crestY + 16);
  drawing.lineTo(throatX + 96, crestY + 8);
  drawing.bezierCurveTo(frontX - 17, crestY + 11, frontX - 7, topY + 14, frontX, topY + 28);
  drawing.bezierCurveTo(frontX - 28, topY + 20, throatX + 27, topY + 31, throatX - 5, topY + 49);
  drawing.bezierCurveTo(backX + 8, topY + 68, backX + 7, mouthY - 11, backX - 4, mouthY + 8);
  drawing.closePath();
  drawing.fillStyle = "rgba(70, 55, 43, 0.48)";
  drawing.fill();
  strokePath("#b77a4e", 1, 0.54);
  drawing.beginPath();
  drawing.moveTo(throatX + 16, topY + 24);
  drawing.bezierCurveTo(throatX + 31, topY + 12, throatX + 43, topY + 25, throatX + 55, topY + 11);
  drawing.moveTo(throatX + 53, topY + 25);
  drawing.bezierCurveTo(throatX + 69, topY + 11, throatX + 79, topY + 26, throatX + 92, topY + 15);
  strokePath("#df9d5a", 0.75, 0.28);
  drawing.restore();
}

function drawEye(model) {
  const { compact, lipX, mouthY } = model;
  const normalizedFlow = clamp(
    visualBreathFlow / Math.max(0.2, state.breathDepth),
    -1,
    1,
  );
  const exhale = Math.max(0, normalizedFlow);
  const inhale = Math.max(0, -normalizedFlow);
  const eyeX = lipX - (compact ? 4 : 7);
  const eyeY = mouthY - (compact ? 70 : 84);
  const halfWidth = (compact ? 8.8 : 10.5) * (1 + exhale * 0.06);
  const halfHeight = (compact ? 3.5 : 4.1) * (1 + exhale * 0.36 - inhale * 0.11);
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
  drawing.arc(eyeX + halfWidth * 0.16, eyeY, Math.max(1.25, halfHeight * 0.68), 0, Math.PI * 2);
  drawing.fillStyle = "rgba(118, 223, 211, 0.72)";
  drawing.fill();
  drawing.beginPath();
  drawing.arc(eyeX + halfWidth * 0.18, eyeY, Math.max(0.65, halfHeight * 0.3), 0, Math.PI * 2);
  drawing.fillStyle = "#111715";
  drawing.fill();
  drawing.beginPath();
  drawing.moveTo(eyeX - halfWidth - 1, eyeY - halfHeight - 4);
  drawing.quadraticCurveTo(eyeX, eyeY - halfHeight - 7 - exhale, eyeX + halfWidth + 2, eyeY - halfHeight - 4);
  strokePath("#8a6043", 1, 0.64);
  drawing.restore();
}

function drawHead(model) {
  const {
    throatX, lipX, mouthY, faceWidth, jawGap, lipExtension, noseProjection,
  } = model;
  const topY = mouthY - Math.min(230, cssHeight * 0.35);
  const backX = throatX - faceWidth * 0.18;
  drawHair(model, topY, backX);
  drawing.beginPath();
  drawing.moveTo(backX, mouthY + jawGap * 1.85);
  drawing.bezierCurveTo(backX - 25, mouthY + 40, backX - 32, topY + 58, throatX + 20, topY);
  drawing.bezierCurveTo(
    lipX - 40,
    topY - 12,
    lipX + noseProjection * 0.47,
    topY + 48,
    lipX + noseProjection * 0.49,
    mouthY - 101,
  );
  drawing.bezierCurveTo(
    lipX + noseProjection * 0.7,
    mouthY - 100,
    lipX + noseProjection,
    mouthY - 84,
    lipX + noseProjection * 0.92,
    mouthY - 61,
  );
  drawing.bezierCurveTo(
    lipX + noseProjection * 0.84,
    mouthY - 49,
    lipX + noseProjection * 0.64,
    mouthY - 47,
    lipX + noseProjection * 0.53,
    mouthY - 50,
  );
  drawing.bezierCurveTo(lipX + 37, mouthY - 30, lipX + 29 + lipExtension, mouthY - 14, lipX + 23 + lipExtension, mouthY - 7);
  drawing.bezierCurveTo(lipX + 34 + lipExtension, mouthY + 2, lipX + 34 + lipExtension, mouthY + 13, lipX + 19 + lipExtension, mouthY + 17);
  drawing.bezierCurveTo(lipX + 36, mouthY + 50, lipX + 30, mouthY + jawGap + 46, lipX - 20, mouthY + jawGap + 78);
  drawing.bezierCurveTo(lipX - 90, mouthY + jawGap + 126, throatX - 12, mouthY + jawGap + 126, backX, mouthY + jawGap * 1.85);
  strokePath("#6e756f", 1.15, 0.75);

  drawEye(model);
  drawing.beginPath();
  drawing.moveTo(lipX + noseProjection * 0.68, mouthY - 57);
  drawing.quadraticCurveTo(
    lipX + noseProjection * 0.76,
    mouthY - 62,
    lipX + noseProjection * 0.82,
    mouthY - 56,
  );
  strokePath("#9a7c68", 0.9, 0.62);

  drawing.beginPath();
  drawing.moveTo(lipX + 21 + lipExtension, mouthY - 5);
  drawing.bezierCurveTo(lipX - 24, mouthY - 14, throatX + 72, mouthY - 30, throatX + 22, mouthY + 2);
  drawing.bezierCurveTo(throatX - 4, mouthY + 20, throatX + 2, mouthY + jawGap * 0.9, throatX + 24, mouthY + jawGap * 1.2);
  drawing.bezierCurveTo(throatX + 74, mouthY + jawGap * 0.74, lipX - 36, mouthY + jawGap * 0.83, lipX + 18 + lipExtension, mouthY + 12);
  drawing.closePath();
  drawing.fillStyle = "rgba(118, 223, 211, 0.055)";
  drawing.fill();
  strokePath("#76dfd3", 1.15, 0.54);

  drawing.beginPath();
  const tongueLipX = lipX + 15 + lipExtension * 0.72;
  drawing.moveTo(tongueLipX, mouthY + 12);
  drawing.bezierCurveTo(model.tongueX + 64, mouthY + jawGap * 0.72, model.tongueX + 44, model.tongueY + 3, model.tongueX, model.tongueY);
  drawing.bezierCurveTo(model.tongueX - 66, model.tongueY + 2, throatX + 34, mouthY + jawGap * 0.8, throatX + 24, mouthY + jawGap * 1.2);
  drawing.bezierCurveTo(throatX + 94, mouthY + jawGap * 1.18, lipX - 58, mouthY + jawGap * 1.22, tongueLipX, mouthY + 12);
  drawing.closePath();
  drawing.fillStyle = "rgba(186, 154, 246, 0.12)";
  drawing.fill();
  strokePath("#ba9af6", 1.3, 0.7);

  drawing.beginPath();
  drawing.moveTo(lipX + 40, mouthY + jawGap + 53);
  drawing.bezierCurveTo(lipX - 20, mouthY + jawGap + 75, throatX + 72, mouthY + jawGap * 1.55, throatX + 18, mouthY + jawGap * 1.22);
  strokePath("#aeb4ae", 1, 0.42);

  drawing.beginPath();
  drawing.moveTo(throatX + 17, model.glottisY - 13);
  drawing.lineTo(model.glottisX, model.glottisY);
  drawing.lineTo(throatX + 17, model.glottisY + 13);
  strokePath("#ee786d", 2, 0.7);

  const formants = mouthFormants(state).frequenciesHz;
  const waveCount = clamp(3 + Math.round(articulationToVisual(state.formantFocus) * 5), 1, 16);
  for (let index = 0; index < waveCount; index += 1) {
    const amount = (index + 0.5) / waveCount;
    const x = throatX + (lipX - throatX) * amount;
    const radius = 5 + Math.sin(amount * Math.PI) * (8 + state.cavityCoupling * 11);
    drawing.beginPath();
    drawing.arc(x, mouthY + 3, radius, -Math.PI * 0.55, Math.PI * 0.55);
    strokePath(index % 2 ? "#76dfd3" : "#f0c46e", 0.8, 0.15 + telemetry.energy * 0.25);
  }
  drawing.fillStyle = "rgba(118, 223, 211, 0.62)";
  drawing.font = "7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText(`F1 ${Math.round(formants[0])}`, throatX + 36, mouthY - 40);
  drawing.fillText(`F2 ${Math.round(formants[1])}`, throatX + 95, mouthY - 40);
  drawing.fillText(`F3 ${Math.round(formants[2])}`, throatX + 154, mouthY - 40);
}

function drawBreathFlow(model) {
  const flow = visualBreathFlow;
  const amount = Math.sqrt(clamp(
    Math.abs(flow) / Math.max(0.001, JAW_HARP_LIMITS.breathFlow[1]),
  ));
  if (amount < 0.02) return;
  const exhaling = flow > 0;
  const startX = model.throatX + 24;
  const endX = model.triggerX + 38;
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
    const y = model.mouthY + Math.sin(index * 2.17 + time * Math.PI * 2) * (3 + amount * 5);
    const length = 7 + amount * 11;
    drawing.beginPath();
    drawing.moveTo(x - direction * length * 0.5, y);
    drawing.lineTo(x + direction * length * 0.5, y);
    drawing.lineTo(x + direction * (length * 0.5 - 4), y - 3);
    drawing.moveTo(x + direction * length * 0.5, y);
    drawing.lineTo(x + direction * (length * 0.5 - 4), y + 3);
    strokePath(color, 1.05, 0.16 + amount * 0.52);
  }
  drawing.fillStyle = color;
  drawing.globalAlpha = 0.7;
  drawing.font = "650 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(exhaling ? "EXHALE · PRESSURE OUT" : "INHALE · PRESSURE IN", (startX + endX) * 0.5, model.mouthY + 29);
  drawing.restore();
}

function drawHarp(model) {
  const { harpBowX, lipX, mouthY, triggerX, triggerY } = model;
  const gap = 15;
  const frameEnd = lipX + 10;
  drawing.lineCap = "round";
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28, mouthY - gap);
  drawing.bezierCurveTo(harpBowX - 22, mouthY - gap, harpBowX - 22, mouthY + gap, harpBowX + 28, mouthY + gap);
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 5.5, 0.25);
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28, mouthY - gap);
  drawing.bezierCurveTo(harpBowX - 22, mouthY - gap, harpBowX - 22, mouthY + gap, harpBowX + 28, mouthY + gap);
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 1.35, 0.95);

  drawing.beginPath();
  drawing.moveTo(harpBowX + 2, mouthY);
  drawing.quadraticCurveTo((harpBowX + triggerX) * 0.5, mouthY - (triggerY - mouthY) * 0.42, triggerX, triggerY);
  strokePath("#f0c46e", 2.1, 0.95);
  drawing.beginPath();
  drawing.moveTo(triggerX, triggerY - 16);
  drawing.lineTo(triggerX, triggerY + 16);
  drawing.lineTo(triggerX + 10, triggerY + 20);
  strokePath("#f0c46e", 2.2, 0.95);

  drawing.fillStyle = "rgba(223, 157, 90, 0.64)";
  drawing.font = "600 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText("FRAME", harpBowX + 70, mouthY + 38);
  drawing.fillText("FREE REED", (harpBowX + triggerX) * 0.5, mouthY - 28);
}

function drawSpectrum(model) {
  if (model.compact) return;
  const harmonic = dominantHarmonic(state);
  const left = Math.max(30, cssWidth * 0.48);
  const right = cssWidth - 34;
  const baseline = cssHeight - 57;
  const maximumHarmonic = Math.max(24, harmonic.index);
  const count = Math.min(maximumHarmonic, Math.max(8, Math.floor((right - left) / 8)));
  drawing.fillStyle = "rgba(140, 145, 140, 0.62)";
  drawing.font = "6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText("REED HARMONICS / MOUTH-SELECTED PARTIAL", left, baseline - 52);
  for (let bar = 0; bar < count; bar += 1) {
    const index = count === maximumHarmonic
      ? bar + 1
      : Math.round(1 + bar / Math.max(1, count - 1) * (maximumHarmonic - 1));
    const x = left + bar / Math.max(1, count - 1) * (right - left);
    const selected = index === harmonic.index;
    const height = selected ? 42 : Math.max(5, 28 / Math.sqrt(index));
    drawing.beginPath();
    drawing.moveTo(x, baseline);
    drawing.lineTo(x, baseline - height);
    strokePath(selected ? "#76dfd3" : "#df9d5a", selected ? 2 : 1, selected ? 0.95 : 0.34);
    if (selected) {
      drawing.fillStyle = "#76dfd3";
      drawing.textAlign = "center";
      drawing.fillText(`${index}×`, x, baseline - height - 7);
    }
  }
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
  drawSpectrum(model);
  const effectiveAirRate = effectiveBreathRateBpm(state);
  drawParameterPad(
    model.airPad,
    "#68bff1",
    model.compact
      ? `BREATH ${formatCycleRate(effectiveAirRate)}`
      : `BREATH ${formatCycleRate(effectiveAirRate)} · ${Math.round(state.breathDepth * 100)}%`,
    state.breathLinked
      ? model.compact ? "×.02 ← RATE → ×28.6" : "×0.02 ← BREATH MULTIPLIER → ×28.6"
      : model.compact ? "SLOW ← SPEED → FAST" : "1/MIN ← CYCLE SPEED → 20/SEC",
    model.compact ? "PRESS ↑" : "PRESSURE ↑",
  );
  drawAirPadDetails(model.airPad);
  drawParameterPad(
    model.rhythmPad,
    "#f0c46e",
    model.compact
      ? `TEMPO ${Math.round(state.repeatRateBpm)} BPM`
      : `PLUCK ${Math.round(state.repeatRateBpm)} BPM · ${state.repeatSwing >= 0 ? "+" : ""}${Math.round(state.repeatSwing * 100)}%`,
    "36 ← BPM → 480",
    "SWING ↑",
  );
  drawTempoSlider(model.rhythmPad);
  drawRhythmPadDetails(model.rhythmPad);
  drawParameterPad(
    model.focusPad,
    "#76dfd3",
    model.compact ? "RESONATOR" : `RESONATOR ${Math.round(state.cavityCoupling * 100)}%`,
    "FOCUS →",
    "COUPLE ↑",
  );
  drawNode(model.triggerX + 6, model.triggerY, "#f0c46e", "PULL / PLUCK", "reed", 8);
  drawNode(model.airPad.x, model.airPad.y, "#68bff1", "BREATH", "air", 8);
  drawNode(model.rhythmPad.x, model.rhythmPad.y, "#f0c46e", "TEMPO", "rhythm", 8);
  drawNode(model.tongueX, model.tongueY, "#ba9af6", "TONGUE", "tongue", 7);
  drawNode(
    clamp(model.lipX + 24 + model.lipExtension, 22, cssWidth - 22),
    model.mouthY + 5,
    "#76dfd3",
    "LIPS",
    "lips",
    7,
  );
  drawNode(model.lipX - 20, model.mouthY + model.jawGap + 74, "#ee786d", "JAW", "jaw", 7);
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
  if (
    point.x >= model.airPad.left
    && point.x <= model.airPad.right
    && point.y >= model.airPad.top
    && point.y <= model.airPad.bottom
  ) return { type: "air", x: point.x, y: point.y, radius: 0 };
  if (
    point.x >= model.rhythmPad.left
    && point.x <= model.rhythmPad.right
    && point.y >= model.rhythmPad.top
    && point.y <= model.rhythmPad.bottom
  ) return { type: "rhythm", x: point.x, y: point.y, radius: 0 };
  const reedStart = { x: model.harpBowX + 2, y: model.mouthY };
  const reedEnd = { x: model.triggerX + 8, y: model.triggerY };
  if (distanceToSegment(point, reedStart, reedEnd) <= 24) {
    return { type: "reed", x: model.triggerX, y: model.triggerY, radius: 24 };
  }
  return null;
}

function setFromPointer(type, point, drag) {
  const model = layout();
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  const horizontalSpan = Math.max(90, model.lipX - model.throatX);
  const verticalSpan = Math.max(90, cssHeight * 0.36);
  let patch = null;
  let mouthChanged = false;
  if (type === "tongue") {
    const position = drag.startValues.tonguePosition + dx / horizontalSpan * 2.5;
    const height = drag.startValues.tongueHeight - dy / verticalSpan * 2.5;
    patch = { tonguePosition: position, tongueHeight: height };
    mouthChanged = true;
  } else if (type === "jaw") {
    const jawOpening = drag.startValues.jawOpening + dy / verticalSpan * 2.5;
    patch = { jawOpening };
    mouthChanged = true;
  } else if (type === "lips") {
    const lipRounding = drag.startValues.lipRounding + dx / horizontalSpan * 3.5;
    patch = { lipRounding };
    mouthChanged = true;
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
    mouthChanged = true;
  } else if (type === "glottis") {
    const glottisUnit = rangeUnit(
      drag.startValues.glottisOpening,
      JAW_HARP_LIMITS.glottisOpening,
    ) + dx / 30;
    patch = { glottisOpening: rangeValue(glottisUnit, JAW_HARP_LIMITS.glottisOpening) };
    mouthChanged = true;
  } else if (type === "air") {
    const width = Math.max(1, model.airPad.right - model.airPad.left);
    const height = Math.max(1, model.airPad.bottom - model.airPad.top);
    const rateUnit = logarithmicUnit(
      drag.startValues.breathRateBpm,
      JAW_HARP_LIMITS.breathRateBpm,
    ) + dx / width;
    const pressureUnit = rangeUnit(
      drag.startValues.breathDepth,
      JAW_HARP_LIMITS.breathDepth,
    ) - dy / height;
    patch = {
      breathRateBpm: logarithmicValue(rateUnit, JAW_HARP_LIMITS.breathRateBpm),
      breathDepth: rangeValue(pressureUnit, JAW_HARP_LIMITS.breathDepth),
    };
  } else if (type === "rhythm") {
    const width = Math.max(1, model.rhythmPad.right - model.rhythmPad.left);
    const height = Math.max(1, model.rhythmPad.bottom - model.rhythmPad.top);
    const tempoUnit = logarithmicUnit(
      drag.startValues.repeatRateBpm,
      JAW_HARP_LIMITS.repeatRateBpm,
    ) + dx / width;
    const swingUnit = rangeUnit(
      drag.startValues.repeatSwing,
      JAW_HARP_LIMITS.repeatSwing,
    ) - dy / height;
    patch = {
      repeatRateBpm: logarithmicValue(tempoUnit, JAW_HARP_LIMITS.repeatRateBpm),
      repeatSwing: rangeValue(swingUnit, JAW_HARP_LIMITS.repeatSwing),
    };
  }
  if (!patch) return;
  const changedAt = performance.now();
  const previousState = state;
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeJawHarpState({ ...state, ...patch }, state);
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
        breathDepth: state.breathDepth,
        breathRateBpm: state.breathRateBpm,
        repeatRateBpm: state.repeatRateBpm,
        repeatSwing: state.repeatSwing,
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

function tick(time) {
  if (state.repeat && graph && audioContext?.state === "running" && time >= nextRepeatAt) {
    const hit = jawHarpRhythmHit(state, repeatStep);
    if (hit.active && !tineIsHeld) {
      pluck({
        automatic: true,
        force: state.pluckForce * hit.velocity,
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
installKeyboard();
updatePresentation();
resizeCanvas();
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
