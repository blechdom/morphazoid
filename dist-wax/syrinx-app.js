import {
  ANIMALS,
  CALL_GESTURES,
  CONTROL_LIMITS,
  MODEL_LABELS,
  animalState,
  callsForAnimal,
  clamp,
  interpolateGesture,
  modulateSyrinxState,
  randomizeSyrinxState,
  resolveGestureTimeline,
  resolveSourceControls,
  sampleModulationWave,
  sanitizeSyrinxState,
} from "./src/syrinx.js?v=syrinx-ui-20260820-1";
import { connectAudioOutput } from "./src/audio-output-manager.js?v=syrinx-ui-20260819-1";
import { unlockAudioContext } from "./src/audio.js?v=syrinx-ui-20260819-1";
import {
  DEFAULT_TONGUE_STATE,
  TONGUE_ANATOMIES,
  sanitizeTongueState,
  tongueAirwayAperture,
  tongueCavityGuides,
  tongueGeometry,
} from "./src/tongue-physics.js?v=syrinx-ui-20260820-1";
import {
  FERAL_TONGUE_PRESETS,
  TONGUE_MOTION_PRESETS,
  TONGUE_PARAMETER_LIMITS,
  modulateTongueState,
  sampleTongueMotionPreset,
} from "./src/tongue-performance.js?v=syrinx-ui-20260820-1";
import { createHybrinxTimeline } from "./src/hybrinx-timeline.js?v=hybrinx-20260821-1";

const $ = (id) => document.getElementById(id);
const animalSelect = $("animalSelect");
const callSelect = $("callSelect");
const canvas = $("stage");
const drawing = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const viewportModulationLayer = $("viewportModulationLayer");
const viewportTonguePresets = $("viewportTonguePresets");
const viewportTonguePresetTrigger = $("viewportTonguePresetTrigger");
const audioButton = $("audioButton");
const playButton = $("playButton");
const loopButton = $("loopButton");
const breathButton = $("breathButton");
const UI_MODE = document.body.classList.contains("syrinx-ui-page");
const TONGUE_MODE = document.body.classList.contains("tongued-beasts-page");
const HYBRINX_MODE = document.body.classList.contains("hybrinx-page");
const hybrinxTimeline = HYBRINX_MODE
  ? createHybrinxTimeline($("hybrinxTimelineSection"))
  : null;
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_IDS = Object.freeze({
  pressure: "pressure",
  tension: "tension",
  adduction: "adduction",
  sourceScale: "sourceScale",
  tractLengthM: "tractLength",
  mouthOpening: "mouthOpening",
  cavityCoupling: "cavityCoupling",
  asymmetry: "asymmetry",
  sourceBalance: "sourceBalance",
  roughness: "roughness",
  gestureRate: "gestureRate",
  loopGapMs: "loopGap",
  level: "level",
});

const MODEL_TOPOLOGY = Object.freeze({
  mammal: "two-mass fold flow → variable-area tract → lip / body modes",
  bird: "left + right labia → shared tracheal tract → OEC / beak modes",
  frog: "self-oscillating membrane → short tract → sac / head modes",
  rodent: "glottal jet → wall impingement → tract / mouth modes",
});

const HANDLE_COLORS = Object.freeze({
  pressure: "#ff7b6f",
  tension: "#ff9a72",
  adduction: "#ffcf68",
  sourceScale: "#f5e4a7",
  cavityCoupling: "#72e7dc",
  tractLengthM: "#ffcf68",
  mouthOpening: "#bf9cff",
  asymmetry: "#d08cff",
  sourceBalance: "#64cfff",
  roughness: "#ff72b6",
});

const SILHOUETTE_PRESETS = Object.freeze({
  lion: { family: "mammal", ears: "round", snout: 0.64, mane: 1 },
  wolf: { family: "mammal", ears: "point", snout: 0.86 },
  dog: { family: "mammal", ears: "drop", snout: 0.68 },
  elephant: { family: "elephant", ears: "fan", snout: 1 },
  alligator: { family: "reptile", ears: "none", snout: 1 },
  cat: { family: "mammal", ears: "point", snout: 0.46 },
  horse: { family: "mammal", ears: "long", snout: 0.9 },
  reddeer: { family: "mammal", ears: "long", snout: 0.72, antlers: 1 },
  hyena: { family: "mammal", ears: "round", snout: 0.67, mane: 0.45 },
  wildboar: { family: "boar", ears: "point", snout: 0.76, tusk: 1 },
  cow: { family: "mammal", ears: "wide", snout: 0.7, horns: 1 },
  raven: { family: "bird", ears: "none", snout: 0.8 },
  songbird: { family: "bird", ears: "none", snout: 0.48 },
  dove: { family: "bird", ears: "none", snout: 0.4 },
  owl: { family: "owl", ears: "point", snout: 0.28 },
  bullfrog: { family: "frog", ears: "none", snout: 0.38 },
  treefrog: { family: "frog", ears: "none", snout: 0.3 },
  mouse: { family: "mouse", ears: "round", snout: 0.48 },
});

const TONGUE_HOST_EFFECTS = Object.freeze({
  lion: "The roar source stays low and nonlinear; the tongue splits the long supralaryngeal tract into two cavities, making the roar more vowel-like without removing its roughness.",
  wolf: "The howl's stable pitch remains laryngeal. Tongue motion adds slow, independent resonance sweeps that can turn one held howl into several vowel-colored states.",
  dog: "Fast bark pressure transients remain intact, while focused tongue constrictions shorten and brighten their oral release; broad settings color the sustained growl more strongly.",
  elephant: "The enormous host tract keeps resonance guides low. A normalized human tongue produces slow, widely spaced spectral movement, but this is especially unlike literal elephant oral anatomy.",
  alligator: "The laryngeal bellow remains the source. A raised tongue adds strong internal reflections and a hollow split-cavity color inside an otherwise reptilian, highly speculative hybrid.",
  cat: "Meow and purr source regimes stay separate. Tongue body motion strongly colors the meow; the low purr gains subtler upper resonances rather than a new fundamental.",
  horse: "Biphonic folds continue to produce two source tracks. The tongue filters both together, so their inharmonic relationship stays while shared formant bands move.",
  reddeer: "The retractable long tract still controls global spacing. The tongue adds local oral constrictions on top, independently moving cavity resonances during a roar.",
  hyena: "Whoop and giggle timing remain laryngeal gestures. The tongue makes their notes share moving spectral envelopes, strongest on sustained whoops.",
  wildboar: "Grunts keep their low pulsatile source and squeals keep their rough high source. One tongue posture filters both, revealing how source and articulation can decouple.",
  cow: "The stable moo remains a large-fold source. Back-versus-front tongue posture adds formant motion that is clearest in the open-mouth call.",
  raven: "The two syringeal sides keep their detuning and biphonation. The tongue reshapes only the shared downstream tract, filtering both sides together before beak radiation.",
  songbird: "Rapid bilateral syrinx gestures stay upstream. A human-scale normalized tongue imposes much larger oral filtering than a real small avian tongue, creating deliberately impossible vowel-bird phrases.",
  dove: "The coo source and pulse pattern remain syringeal. A broad tongue setting shifts the coo's shared tract envelope; tip lift adds a sharper anterior notch.",
  owl: "The hoot remains a low syringeal tone with head and beak radiation. Tongue height changes its oral spectral concentration while the source pitch stays put.",
  bullfrog: "The membrane and sac/head modes remain dominant. Tongue filtering matters mainly along the modeled oral path, so this closed-mouth caller changes less than an open-mouthed mammal.",
  treefrog: "Fast membrane chirps keep their pressure-driven timing. The tiny host tract pushes tongue-created cavity guides upward, producing bright, short filtering rather than speech-like vowels.",
  mouse: "The jet-wall whistle still selects the ultrasonic mode upstream. The tongue filters the tract and audible mapping; it does not directly retune the whistle's Strouhal mechanism.",
});

const TONGUE_CONTROL_KEYS = Object.freeze(Object.keys(TONGUE_PARAMETER_LIMITS));
const VIEWPORT_MODULATION_TARGETS = Object.freeze([
  "pressure",
  "tension",
  "adduction",
  "roughness",
  "asymmetry",
  "sourceBalance",
  "cavityCoupling",
  "tractLengthM",
  "mouthOpening",
]);
const PARAMETER_MODULATOR_DEFINITIONS = Object.freeze([
  { target: "tonguePosition", elementId: "tonguePosition", family: "tongue", rateHz: 1.7, depth: 0.42, shape: "sine" },
  { target: "tongueHeight", elementId: "tongueHeight", family: "tongue", rateHz: 3.1, depth: 0.48, shape: "triangle" },
  { target: "tongueShape", elementId: "tongueShape", family: "tongue", rateHz: 0.73, depth: 0.52, shape: "sine" },
  { target: "tongueTip", elementId: "tongueTip", family: "tongue", rateHz: 7.8, depth: 0.58, shape: "square" },
  { target: "tongueExtension", elementId: "tongueExtension", family: "tongue", rateHz: 1.2, depth: 0.68, shape: "triangle" },
  { target: "tongueCurl", elementId: "tongueCurl", family: "tongue", rateHz: 4.3, depth: 0.62, shape: "sine" },
  { target: "tongueLateral", elementId: "tongueLateral", family: "tongue", rateHz: 2.4, depth: 0.54, shape: "square" },
  { target: "pressure", elementId: "pressure", family: "host", rateHz: 0.82, depth: 0.5, shape: "triangle" },
  { target: "tension", elementId: "tension", family: "host", rateHz: 5.4, depth: 0.34, shape: "sine" },
  { target: "adduction", elementId: "adduction", family: "host", rateHz: 2.6, depth: 0.48, shape: "square" },
  { target: "sourceScale", elementId: "sourceScale", family: "host", rateHz: 0.17, depth: 0.6, shape: "triangle" },
  { target: "tractLengthM", elementId: "tractLength", family: "host", rateHz: 0.13, depth: 0.46, shape: "sine" },
  { target: "mouthOpening", elementId: "mouthOpening", family: "host", rateHz: 3.7, depth: 0.72, shape: "square" },
  { target: "cavityCoupling", elementId: "cavityCoupling", family: "host", rateHz: 0.47, depth: 0.62, shape: "sine" },
  { target: "asymmetry", elementId: "asymmetry", family: "host", rateHz: 1.33, depth: 0.7, shape: "sample-hold" },
  { target: "sourceBalance", elementId: "sourceBalance", family: "host", rateHz: 0.29, depth: 0.82, shape: "triangle" },
  { target: "roughness", elementId: "roughness", family: "host", rateHz: 8.6, depth: 0.66, shape: "sample-hold" },
  { target: "gestureRate", elementId: "gestureRate", family: "host", rateHz: 0.21, depth: 0.58, shape: "triangle" },
  { target: "loopGapMs", elementId: "loopGap", family: "host", rateHz: 0.08, depth: 0.82, shape: "sample-hold" },
]);

const IDLE_TONGUE_ARTICULATION = Object.freeze({
  active: false,
  airwayGate: null,
  gatePosition: null,
  lateralBypass: 0,
  flutterHz: 0,
  flutterDepth: 0,
  turbulence: 0,
  flowDirection: 1,
  voicing: 1,
  burstGain: 0,
  burstFrequencyHz: 1_050,
});

let state = animalState("raven", UI_MODE
  ? { biologicalLock: false, loopGapMs: 1_000 }
  : { loopGapMs: 0 });
let tongueState = sanitizeTongueState(TONGUE_MODE ? DEFAULT_TONGUE_STATE : {
  ...DEFAULT_TONGUE_STATE,
  tongueEnabled: false,
});
let performanceTongueState = tongueState;
let tongueArticulation = IDLE_TONGUE_ARTICULATION;
let tongueMotionId = "";
let tongueMotionStartTime = 0;
const parameterModulators = PARAMETER_MODULATOR_DEFINITIONS.map((definition, index) => ({
  ...definition,
  enabled: false,
  phase: (index * 0.173) % 1,
}));
let performanceState = { ...state, active: false };
const modulators = [
  { enabled: false, target: "tension", shape: "sine", rateHz: 5.4, depth: 0.12, phase: 0 },
  { enabled: false, target: "pressure", shape: "triangle", rateHz: 0.25, depth: 0.18, phase: 0.17 },
  { enabled: false, target: "mouthOpening", shape: "sine", rateHz: 0.4, depth: 0.16, phase: 0.41 },
];
let audioContext = null;
let graph = null;
let startingAudio = false;
let gesturePlaying = false;
let gestureStartTime = 0;
let gesturePhase = 0;
let loopGapRemainingMs = 0;
let manualBreath = false;
let audioDirty = true;
let lastConfigurationTime = -Infinity;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let pointerDrag = null;
let activePointerId = null;
let expandedViewportModulatorTarget = "";
let viewportTonguePresetsPinned = false;
let tongueHitGeometry = null;
let tongueDragStartedBreath = false;
let canvasBreathControl = null;
let canvasBreathPressed = false;
let waveform = new Float32Array(1_024);
let telemetry = {
  pressure: 0,
  sections: estimatedTractSections(state.tractLengthM),
  tractLengthM: state.tractLengthM,
  peak: 0,
  rms: 0,
  whistleMode: 1,
};
let animationFrame = 0;

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  return frequency >= 1_000
    ? `${(frequency / 1_000).toFixed(frequency >= 5_000 ? 1 : 2)} kHz`
    : `${Math.round(frequency)} Hz`;
}

function formatLength(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)} cm`;
}

function formatLoopGap(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1) return "continuous";
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(milliseconds % 1_000 ? 2 : 1)} s`;
}

function estimatedTractSections(lengthM, rate = 48_000) {
  const outputRate = Math.max(8_000, Math.min(384_000, Number(rate) || 48_000));
  const waveguideRate = outputRate <= 50_000 ? outputRate * 2 : Math.min(outputRate, 96_000);
  return Math.max(5, Math.min(232, Math.round(lengthM * waveguideRate / 343)));
}

function balanceLabel(value) {
  const balance = clamp(value);
  if (Math.abs(balance - 0.5) < 0.025) return "center";
  const amount = Math.round(Math.abs(balance - 0.5) * 200);
  return `${amount}% ${balance < 0.5 ? "left" : "right"}`;
}

function titleCase(value) {
  const text = String(value ?? "")
    .replaceAll("-", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function activeAnimal() {
  return ANIMALS[state.animalId] ?? ANIMALS.raven;
}

function activeGesture() {
  return CALL_GESTURES[state.callId] ?? callsForAnimal(state.animalId)[0];
}

function sourceConfiguration(soundingState = performanceState) {
  return resolveSourceControls(soundingState);
}

function tractConfiguration(soundingState = performanceState) {
  const animal = ANIMALS[soundingState.animalId] ?? activeAnimal();
  return {
    animalId: animal.id,
    model: soundingState.sourceModel,
    tractLengthM: soundingState.tractLengthM,
    mouthOpening: soundingState.mouthOpening,
    cavityCoupling: soundingState.cavityCoupling,
    cavityFrequencyHz: animal.cavityFrequencyHz,
    ...performanceTongueState,
    airwayGate: tongueArticulation.airwayGate,
    gatePosition: tongueArticulation.gatePosition,
    lateralBypass: tongueArticulation.lateralBypass,
    flutterHz: tongueArticulation.flutterHz,
    flutterDepth: tongueArticulation.flutterDepth,
    turbulence: tongueArticulation.turbulence,
    flowDirection: tongueArticulation.flowDirection,
    articulationVoicing: tongueArticulation.voicing,
    articulationPressure: soundingState.active ? soundingState.pressure : 0,
    burstGain: tongueArticulation.burstGain,
    burstFrequencyHz: tongueArticulation.burstFrequencyHz,
  };
}

function postConfiguration(soundingState = performanceState, resetTract = false) {
  if (!graph?.sourceNode) return;
  graph.sourceNode.port.postMessage({
    type: "configure",
    source: sourceConfiguration(soundingState),
    tract: tractConfiguration(soundingState),
    resetTract,
  });
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  audioButton.setAttribute("aria-pressed", String(on));
  const audioState = $("audioState");
  audioState.textContent = on ? "on" : "off";
  audioButton.disabled = status === "starting";
  const error = $("audioError");
  error.hidden = !message;
  error.textContent = message;
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL("./src/syrinx-processor.js?v=tongue-live-20260820-1", import.meta.url));

  const sourceNode = new AudioWorkletNode(context, "syrinx-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: {
      configuration: {
        source: sourceConfiguration({ ...state, active: false }),
        tract: tractConfiguration(state),
        seed: 0x51f15e,
      },
    },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = state.level;
  compressor.threshold.value = -11;
  compressor.knee.value = 12;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
  analyser.fftSize = 1_024;
  analyser.smoothingTimeConstant = 0.62;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });

  sourceNode.port.onmessage = (event) => {
    if (event.data?.type !== "telemetry") return;
    telemetry = { ...telemetry, ...event.data };
  };
  sourceNode.onprocessorerror = () => {
    setAudioPresentation("error", "The physical-model audio processor stopped unexpectedly. Reload the page to reset it.");
  };

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
      setAudioPresentation("error", error?.message || "Unable to start the physical-model audio engine.");
      startingAudio = false;
      return false;
    }
    startingAudio = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    setAudioPresentation("on");
    audioDirty = true;
    postConfiguration(performanceState);
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    stopPerformance("Audio paused");
    await audioContext.suspend();
    setAudioPresentation("off");
    return;
  }
  await ensureAudio();
}

function setGesturePresentation() {
  playButton.setAttribute("aria-pressed", String(gesturePlaying));
  const gesture = activeGesture();
  $("playLabel").textContent = gesturePlaying
    ? `Stop ${gesture.label.toLowerCase()}`
    : `Play ${gesture.label.toLowerCase()}`;
  $("playState").textContent = gesturePlaying
    ? loopGapRemainingMs > 0
      ? `next call in ${formatLoopGap(loopGapRemainingMs)}`
      : `${Math.round(gesturePhase * 100)}% through gesture`
    : "ready";
  loopButton.setAttribute("aria-pressed", String(state.loop));
  $("loopState").textContent = state.loop ? "on" : "off";
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function playGesture() {
  if (gesturePlaying) {
    stopPerformance(`${activeGesture().label} stopped`);
    return;
  }
  manualBreath = false;
  breathButton.setAttribute("aria-pressed", "false");
  gesturePlaying = true;
  gestureStartTime = performance.now();
  gesturePhase = 0;
  loopGapRemainingMs = 0;
  setGesturePresentation();
  announce(`${activeAnimal().label} ${activeGesture().label} started`);
  audioDirty = true;
}

function stopPerformance(message = "Call released") {
  gesturePlaying = false;
  manualBreath = false;
  gesturePhase = 0;
  loopGapRemainingMs = 0;
  performanceState = { ...state, active: false };
  breathButton.setAttribute("aria-pressed", "false");
  setGesturePresentation();
  postConfiguration(performanceState);
  audioDirty = false;
  if (message) announce(message);
}

function setManualBreath(active) {
  if (active === manualBreath) return;
  manualBreath = active;
  breathButton.setAttribute("aria-pressed", String(active));
  setGesturePresentation();
  performanceState = active
    ? { ...state, active: true }
    : gesturePlaying
      ? interpolateGesture(activeGesture(), gesturePhase, state)
      : { ...state, active: false };
  postConfiguration(performanceState);
  audioDirty = gesturePlaying
    || Boolean(tongueMotionId)
    || hasActiveParameterModulators();
  const transportNote = gesturePlaying ? "; call transport continues" : "";
  announce(active
    ? `${activeAnimal().label} manual pressure on${transportNote}`
    : `Manual pressure released${transportNote}`);
}

function updateCallOptions() {
  const calls = callsForAnimal(state.animalId);
  callSelect.replaceChildren(...calls.map((gesture) => {
    const option = document.createElement("option");
    option.value = gesture.id;
    option.textContent = gesture.label;
    option.selected = gesture.id === state.callId;
    return option;
  }));
  if (!calls.some(({ id }) => id === state.callId)) state.callId = calls[0].id;
  callSelect.value = state.callId;
}

function updateControlBounds() {
  const animal = activeAnimal();
  for (const [stateKey, elementId] of Object.entries(CONTROL_IDS)) {
    if (stateKey === "level") continue;
    const bounds = state.biologicalLock
      ? animal.bounds[stateKey] ?? CONTROL_LIMITS[stateKey]
      : CONTROL_LIMITS[stateKey];
    const input = $(elementId);
    if (!input || !bounds) continue;
    input.min = String(bounds[0]);
    input.max = String(bounds[1]);
  }
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const progress = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(progress * 100).toFixed(2)}%`);
}

function setInputValue(stateKey) {
  const input = $(CONTROL_IDS[stateKey]);
  if (!input) return;
  input.value = String(state[stateKey]);
  updateRangeFill(input);
}

function updateControlValues() {
  for (const stateKey of Object.keys(CONTROL_IDS)) setInputValue(stateKey);
  $("pressureOut").textContent = formatPercent(state.pressure);
  $("tensionOut").textContent = formatPercent(state.tension);
  $("adductionOut").textContent = formatPercent(state.adduction);
  if ($("sourceScaleOut")) $("sourceScaleOut").textContent = formatPercent(state.sourceScale);
  $("tractLengthOut").textContent = formatLength(state.tractLengthM);
  $("mouthOpeningOut").textContent = formatPercent(state.mouthOpening);
  $("cavityCouplingOut").textContent = formatPercent(state.cavityCoupling);
  $("asymmetryOut").textContent = formatPercent(state.asymmetry);
  $("sourceBalanceOut").textContent = balanceLabel(state.sourceBalance);
  $("roughnessOut").textContent = formatPercent(state.roughness);
  $("gestureRateOut").textContent = `${state.gestureRate.toFixed(2)}×`;
  if ($("loopGapOut")) $("loopGapOut").textContent = formatLoopGap(state.loopGapMs);
  $("levelOut").textContent = formatPercent(state.level);
  $("sourceSummary").textContent = `pressure ${formatPercent(state.pressure)} · tension ${formatPercent(state.tension)}`;
  $("tractSummary").textContent = `${formatLength(state.tractLengthM)} · opening ${formatPercent(state.mouthOpening)}`;
  $("nonlinearSummary").textContent = `${formatPercent(state.asymmetry)} split · ${formatPercent(state.roughness)} rough`;
  $("gestureSummary").textContent = UI_MODE
    ? `${activeGesture().label.toLowerCase()} · ${state.gestureRate.toFixed(2)}× · ${formatLoopGap(state.loopGapMs)} gap`
    : `${activeGesture().label.toLowerCase()} · ${state.gestureRate.toFixed(2)}×`;
}

function updateTonguePresentation(soundingState = state) {
  if (!TONGUE_MODE) return;
  const anatomy = TONGUE_ANATOMIES[tongueState.tongueAnatomy];
  const effectiveTongue = performanceTongueState ?? tongueState;
  const guides = tongueCavityGuides(soundingState.tractLengthM, effectiveTongue);
  const enabled = Boolean(tongueState.tongueEnabled);
  const requestedGate = tongueArticulation.airwayGate;
  const naturalAperture = tongueAirwayAperture(effectiveTongue);
  const lateral = clamp(tongueArticulation.lateralBypass);
  const aperture = enabled
    ? lateral + clamp(requestedGate == null ? naturalAperture : requestedGate) * (1 - lateral)
    : 1;
  const airwayLabel = tongueArticulation.flutterHz > 0
    ? `flutter ${tongueArticulation.flutterHz.toFixed(1)} Hz`
    : aperture <= 0.07
      ? "sealed"
      : aperture <= 0.35 ? "pinched" : aperture >= 0.9 ? "open" : `${Math.round(aperture * 100)}% open`;
  const toggle = $("tongueEnabled");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "Tongue in circuit" : "Bypass tongue";
  }
  if ($("tongueAnatomy")) $("tongueAnatomy").value = tongueState.tongueAnatomy;
  for (const key of TONGUE_CONTROL_KEYS) {
    const input = $(key);
    if (!input) continue;
    input.value = String(tongueState[key]);
    updateRangeFill(input);
  }
  if ($("tonguePositionOut")) {
    $("tonguePositionOut").textContent = tongueState.tonguePosition < 0.34
      ? "back"
      : tongueState.tonguePosition > 0.66 ? "front" : "central";
  }
  if ($("tongueHeightOut")) $("tongueHeightOut").textContent = formatPercent(tongueState.tongueHeight);
  if ($("tongueShapeOut")) {
    $("tongueShapeOut").textContent = tongueState.tongueShape < 0.34
      ? "broad"
      : tongueState.tongueShape > 0.66 ? "focused" : "rounded";
  }
  if ($("tongueTipOut")) $("tongueTipOut").textContent = formatPercent(tongueState.tongueTip);
  if ($("tongueExtensionOut")) $("tongueExtensionOut").textContent = formatPercent(tongueState.tongueExtension);
  if ($("tongueCurlOut")) {
    $("tongueCurlOut").textContent = tongueState.tongueCurl < 0.38
      ? "down"
      : tongueState.tongueCurl > 0.62 ? "up" : "flat";
  }
  if ($("tongueLateralOut")) $("tongueLateralOut").textContent = formatPercent(tongueState.tongueLateral);
  if ($("tongueSummary")) {
    const motion = tongueMotionId ? ` · ${TONGUE_MOTION_PRESETS[tongueMotionId].label}` : "";
    $("tongueSummary").textContent = `${anatomy.label.replace(" muscular hydrostat", "")} · ${enabled ? "coupled" : "bypassed"}${motion}`;
  }
  if ($("tongueDescription")) $("tongueDescription").textContent = anatomy.description;
  if ($("tongueImpact")) $("tongueImpact").textContent = TONGUE_HOST_EFFECTS[soundingState.animalId]
    ?? "The animal source remains upstream while the tongue reshapes the shared vocal-tract filter.";
  if ($("tongueModelReadout")) $("tongueModelReadout").textContent = anatomy.label;
  if ($("rearCavityReadout")) {
    $("rearCavityReadout").textContent = enabled ? formatFrequency(guides.rearQuarterWaveHz) : "unchanged";
  }
  if ($("frontCavityReadout")) {
    $("frontCavityReadout").textContent = enabled ? formatFrequency(guides.frontQuarterWaveHz) : "unchanged";
  }
  if ($("airwayApertureReadout")) $("airwayApertureReadout").textContent = airwayLabel;
  if ($("tongueAirwayOut")) $("tongueAirwayOut").textContent = airwayLabel;
  if ($("tongueMotionOut")) {
    $("tongueMotionOut").textContent = tongueMotionId
      ? TONGUE_MOTION_PRESETS[tongueMotionId].label
      : "free hand";
  }
  document.body.classList.toggle("tongue-is-bypassed", !enabled);
  document.body.classList.toggle("tongue-airway-sealed", enabled && aperture <= 0.07);
}

function setTongueControl(key, value, announceChange = false) {
  tongueState = sanitizeTongueState({ ...tongueState, [key]: value }, tongueState);
  if (!tongueMotionId) performanceTongueState = tongueState;
  updateTonguePresentation(performanceState);
  audioDirty = true;
  if (announceChange) {
    const label = key === "tongueAnatomy"
      ? TONGUE_ANATOMIES[tongueState.tongueAnatomy].label
      : `${titleCase(key)} ${Math.round(tongueState[key] * 100)} percent`;
    announce(label);
  }
}

function updateTongueMotionButtons() {
  if (!TONGUE_MODE) return;
  document.querySelectorAll("[data-tongue-motion]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tongueMotion === tongueMotionId));
  });
}

function setTongueMotion(id, { announceChange = true, startAudio = true } = {}) {
  if (!TONGUE_MODE) return;
  const next = Object.hasOwn(TONGUE_MOTION_PRESETS, id) ? id : "";
  tongueMotionId = next;
  tongueMotionStartTime = performance.now();
  if (!next) {
    tongueArticulation = IDLE_TONGUE_ARTICULATION;
    performanceTongueState = tongueState;
  } else {
    tongueState = sanitizeTongueState({ ...tongueState, tongueEnabled: true }, tongueState);
    if (startAudio) void ensureAudio();
  }
  updateTongueMotionButtons();
  updateTonguePresentation(performanceState);
  audioDirty = true;
  if (announceChange) {
    announce(next
      ? `${TONGUE_MOTION_PRESETS[next].label} tongue motion started; grab the tongue to interrupt it`
      : "Automatic tongue motion stopped; free-hand control active");
  }
}

function applyFeralTonguePreset(id) {
  const preset = FERAL_TONGUE_PRESETS[id];
  if (!TONGUE_MODE || !preset) return;
  state = sanitizeSyrinxState({
    ...state,
    biologicalLock: false,
    ...preset.host,
  }, state);
  tongueState = sanitizeTongueState({
    ...tongueState,
    tongueEnabled: true,
    ...preset.tongue,
  }, tongueState);
  const shapes = preset.modulation.shapes;
  expandedViewportModulatorTarget = "";
  parameterModulators.forEach((modulator, index) => {
    modulator.enabled = true;
    modulator.rateHz = clamp(
      preset.modulation.rateBase + (index % 7) * preset.modulation.rateSpread,
      0.02,
      modulator.family === "host" ? 20 : 30,
    );
    modulator.depth = clamp(preset.modulation.depth - (index % 4) * 0.055);
    modulator.shape = shapes[index % shapes.length];
    modulator.phase = (index * 0.137) % 1;
    updateParameterModulatorUI(modulator);
  });
  updateControlValues();
  setTongueMotion(preset.motion, { announceChange: false });
  audioDirty = true;
  announce(`${preset.label}: every source, tract, tongue, and wiggle parameter is live`);
}

function installTongueListeners() {
  if (!TONGUE_MODE) return;
  $("tongueEnabled")?.addEventListener("click", () => {
    setTongueControl("tongueEnabled", !tongueState.tongueEnabled);
    announce(`Tongue ${tongueState.tongueEnabled ? "coupled to" : "bypassed from"} the tract`);
  });
  $("tongueAnatomy")?.addEventListener("change", (event) => {
    setTongueControl("tongueAnatomy", event.currentTarget.value, true);
  });
  for (const key of TONGUE_CONTROL_KEYS) {
    const input = $(key);
    input?.addEventListener("input", () => {
      if (tongueMotionId) setTongueMotion("", { announceChange: false, startAudio: false });
      setTongueControl(key, Number(input.value));
    });
    input?.addEventListener("change", () => setTongueControl(key, Number(input.value), true));
  }
  document.querySelectorAll("[data-tongue-motion]").forEach((button) => {
    button.addEventListener("click", () => {
      const requested = button.dataset.tongueMotion;
      setTongueMotion(requested === tongueMotionId ? "" : requested);
    });
  });
  document.querySelectorAll("[data-feral-preset]").forEach((button) => {
    button.addEventListener("click", () => applyFeralTonguePreset(button.dataset.feralPreset));
  });
  updateTongueMotionButtons();
}

function updateAnimalPresentation() {
  const animal = activeAnimal();
  animalSelect.value = animal.id;
  $("animalDescription").textContent = animal.description;
  $("specimenTitle").textContent = animal.label.replace(" · audible USV map", "");
  $("apparatusReadout").textContent = animal.apparatus;
  $("topologyReadout").textContent = MODEL_TOPOLOGY[animal.model];
  $("modelBasisReadout").textContent = animal.rangeBasis;
  $("bandwidthReadout").textContent = animal.audibleMapping
    ? `${formatFrequency(animal.physicalFrequencyRangeHz[0])}–${formatFrequency(animal.physicalFrequencyRangeHz[1])} physiology → audible map`
    : `${formatFrequency(animal.frequencyRangeHz[0])}–${formatFrequency(animal.frequencyRangeHz[1])} model range`;
  $("modelReadout").textContent = MODEL_LABELS[animal.model];
  $("sourceBalanceControl").hidden = !UI_MODE && animal.model !== "bird";
  $("asymmetryLabel").textContent = animal.model === "bird"
    ? "Left / right asymmetry"
    : animal.model === "mammal"
      ? "Tissue / fold asymmetry"
      : animal.model === "frog" ? "Membrane irregularity" : "Jet instability";
  updateCallOptions();
  updateControlBounds();
  updateControlValues();
  updateTonguePresentation();
  setGesturePresentation();
}

function updatePerformancePresentation(soundingState) {
  const source = resolveSourceControls(soundingState);
  const length = telemetry.tractLengthM || soundingState.tractLengthM;
  const sectionCount = telemetry.sections || estimatedTractSections(
    length,
    audioContext?.sampleRate,
  );
  $("frequencyReadout").textContent = formatFrequency(source.frequencyHz);
  $("tractReadout").textContent = `${formatLength(length)} · ${sectionCount} sections`;
  $("pressureReadout").textContent = soundingState.active
    ? `${Math.round(Math.abs(telemetry.pressure) * 100)}% tract load`
    : "resting";
  $("pressureGestureBar").style.setProperty("--gesture-value", clamp(soundingState.active ? soundingState.pressure : 0));
  $("tensionGestureBar").style.setProperty("--gesture-value", clamp(soundingState.tension));
  $("mouthGestureBar").style.setProperty("--gesture-value", clamp(soundingState.mouthOpening));
  updateTonguePresentation(soundingState);
  document.body.classList.toggle("is-sounding", soundingState.active && (telemetry.rms > 0.0002 || !graph));
}

function loadAnimal(animalId) {
  const transportWasRunning = gesturePlaying;
  const retained = {
    level: state.level,
    loop: state.loop,
    gestureRate: state.gestureRate,
    loopGapMs: state.loopGapMs,
    biologicalLock: state.biologicalLock,
  };
  state = animalState(animalId, retained);
  gesturePhase = 0;
  loopGapRemainingMs = 0;
  if (transportWasRunning) gestureStartTime = performance.now();
  performanceState = manualBreath
    ? { ...state, active: true }
    : transportWasRunning
      ? interpolateGesture(activeGesture(), 0, state)
      : { ...state, active: false };
  telemetry = {
    ...telemetry,
    pressure: 0,
    sections: estimatedTractSections(state.tractLengthM, audioContext?.sampleRate),
    tractLengthM: state.tractLengthM,
    rms: 0,
    peak: 0,
  };
  updateAnimalPresentation();
  postConfiguration(performanceState, true);
  const rangeNote = state.biologicalLock
    ? "Species-informed ranges locked."
    : "Universal performance ranges active.";
  const transportNote = transportWasRunning ? " Call transport continues." : "";
  announce(`${activeAnimal().label} loaded. ${rangeNote}${transportNote}`);
  audioDirty = transportWasRunning;
}

function loadCall(callId) {
  state = sanitizeSyrinxState({ ...state, callId }, state);
  gesturePhase = 0;
  loopGapRemainingMs = 0;
  if (gesturePlaying) gestureStartTime = performance.now();
  performanceState = manualBreath
    ? { ...state, active: true }
    : gesturePlaying
      ? interpolateGesture(activeGesture(), 0, state)
      : { ...state, active: false };
  updateCallOptions();
  updateControlValues();
  setGesturePresentation();
  postConfiguration(performanceState);
  audioDirty = gesturePlaying;
  announce(`${activeGesture().label} gesture selected${gesturePlaying ? "; call transport continues" : ""}`);
}

function setControl(stateKey, value, { announceChange = false } = {}) {
  state = sanitizeSyrinxState({ ...state, [stateKey]: value }, state);
  updateControlValues();
  audioDirty = true;
  if (!gesturePlaying && !manualBreath) performanceState = { ...state, active: false };
  if (stateKey === "level" && graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
  }
  if (announceChange) announce(`${titleCase(stateKey)} ${state[stateKey].toFixed(2)}`);
}

function syncModulatorFromControls(index) {
  const number = index + 1;
  const modulator = modulators[index];
  if (!modulator || !UI_MODE || !$("modulationSummary")) return;
  modulator.target = $(`mod${number}Target`).value;
  modulator.shape = $(`mod${number}Shape`).value;
  modulator.rateHz = Number($(`mod${number}Rate`).value);
  modulator.depth = Number($(`mod${number}Depth`).value);
  audioDirty = true;
}

function setModulator(index, values) {
  const modulator = modulators[index];
  if (!modulator || !UI_MODE || !$("modulationSummary")) return;
  Object.assign(modulator, values);
  const number = index + 1;
  $(`mod${number}Enable`).setAttribute("aria-pressed", String(modulator.enabled));
  $(`mod${number}Target`).value = modulator.target;
  $(`mod${number}Shape`).value = modulator.shape;
  $(`mod${number}Rate`).value = String(modulator.rateHz);
  $(`mod${number}Depth`).value = String(modulator.depth);
  updateRangeFill($(`mod${number}Rate`));
  updateRangeFill($(`mod${number}Depth`));
  audioDirty = true;
}

function updateModulationPresentation(time = performance.now()) {
  if (!UI_MODE || !$("modulationSummary")) return;
  let enabledCount = 0;
  modulators.forEach((modulator, index) => {
    const number = index + 1;
    const enabled = Boolean(modulator.enabled);
    if (enabled) enabledCount += 1;
    $(`mod${number}Enable`).setAttribute("aria-pressed", String(enabled));
    $(`mod${number}RateOut`).textContent = `${modulator.rateHz.toFixed(2)} Hz`;
    $(`mod${number}DepthOut`).textContent = formatPercent(modulator.depth);
    const wave = enabled
      ? sampleModulationWave(modulator.shape, time * 0.001 * modulator.rateHz + modulator.phase, index)
      : 0;
    $(`mod${number}Activity`).textContent = enabled
      ? `${titleCase(modulator.target)} ${wave >= 0 ? "+" : ""}${Math.round(wave * modulator.depth * 100)}%`
      : "off";
    updateRangeFill($(`mod${number}Rate`));
    updateRangeFill($(`mod${number}Depth`));
  });
  $("modulationSummary").textContent = enabledCount
    ? `${enabledCount} LFO${enabledCount === 1 ? "" : "s"} moving`
    : "3 assignable LFOs / all off";
}

function clearModulators() {
  modulators.forEach((_, index) => setModulator(index, { enabled: false }));
  updateModulationPresentation();
}

function installModulationListeners() {
  if (!UI_MODE || !$("modulationSummary")) return;
  modulators.forEach((_, index) => {
    const number = index + 1;
    $(`mod${number}Enable`).addEventListener("click", () => {
      modulators[index].enabled = !modulators[index].enabled;
      updateModulationPresentation();
      audioDirty = true;
      announce(`LFO ${number} ${modulators[index].enabled ? "on" : "off"}`);
    });
    for (const suffix of ["Target", "Shape", "Rate", "Depth"]) {
      const input = $(`mod${number}${suffix}`);
      input.addEventListener("input", () => {
        syncModulatorFromControls(index);
        updateModulationPresentation();
      });
      input.addEventListener("change", () => {
        syncModulatorFromControls(index);
        updateModulationPresentation();
        announce(`LFO ${number} now moves ${titleCase(modulators[index].target)}`);
      });
    }
  });
  $("vibratoButton").addEventListener("click", () => {
    clearModulators();
    setModulator(0, { enabled: true, target: "tension", shape: "sine", rateHz: 5.4, depth: 0.12, phase: 0 });
    updateModulationPresentation();
    announce("Vibrato macro: membrane tension at 5.4 hertz");
  });
  $("howlDriftButton").addEventListener("click", () => {
    setModulator(0, { enabled: true, target: "tension", shape: "sine", rateHz: 0.18, depth: 0.22, phase: 0 });
    setModulator(1, { enabled: true, target: "pressure", shape: "triangle", rateHz: 0.09, depth: 0.14, phase: 0.17 });
    setModulator(2, { enabled: true, target: "mouthOpening", shape: "sine", rateHz: 0.13, depth: 0.12, phase: 0.41 });
    updateModulationPresentation();
    announce("Howl drift macro: slow pitch, pressure, and mouth motion");
  });
  $("clearModulatorsButton").addEventListener("click", () => {
    clearModulators();
    announce("All modulators cleared");
  });
}

function parameterModulatorsFor(family) {
  return parameterModulators.filter((modulator) => (
    modulator.family === family && modulator.enabled
  ));
}

function hasActiveParameterModulators() {
  return parameterModulators.some((modulator) => modulator.enabled);
}

function updateParameterModulatorUI(modulator) {
  if (!modulator) return;
  const expanded = expandedViewportModulatorTarget === modulator.target
    && Boolean(modulator.enabled);
  const button = modulator.button;
  if (button) {
    button.setAttribute("aria-pressed", String(Boolean(modulator.enabled)));
    const action = !modulator.enabled
      ? `Enable ${titleCase(modulator.target)} viewport modulation`
      : expanded
        ? `Disable ${titleCase(modulator.target)} viewport modulation`
        : `Open ${titleCase(modulator.target)} modulation controls; modulation is on`;
    button.setAttribute(
      "aria-label",
      action,
    );
    button.title = `${titleCase(modulator.target)} ${modulator.shape} modulation`;
  }
  if (modulator.rateInput) modulator.rateInput.value = String(modulator.rateHz);
  if (modulator.depthInput) modulator.depthInput.value = String(modulator.depth);
  if (modulator.rateOutput) modulator.rateOutput.textContent = `${modulator.rateHz.toFixed(2)} Hz`;
  if (modulator.depthOutput) modulator.depthOutput.textContent = formatPercent(modulator.depth);
  if (modulator.viewportControl) {
    modulator.viewportControl.classList.toggle("is-active", Boolean(modulator.enabled));
    modulator.viewportControl.classList.toggle("is-expanded", expanded);
    if (modulator.controls) modulator.controls.hidden = !expanded;
    button?.setAttribute("aria-expanded", String(expanded));
  }
}

function createViewportModulationRange(
  modulator,
  kind,
  label,
  minimum,
  maximum,
  step,
  value,
) {
  const holder = document.createElement("label");
  holder.className = "viewport-mod-range";
  const heading = document.createElement("span");
  heading.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", `${titleCase(modulator.target)} modulation ${label.toLowerCase()}`);
  const output = document.createElement("output");
  heading.append(output);
  holder.append(heading, input);
  input.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    expandedViewportModulatorTarget = modulator.target;
    modulator.viewportControl?.classList.add("is-adjusting");
    updateParameterModulatorUI(modulator);
    if (input.setPointerCapture) input.setPointerCapture(event.pointerId);
  });
  const finishPointerAdjustment = (event) => {
    if (event.type !== "lostpointercapture"
      && input.hasPointerCapture?.(event.pointerId)) {
      input.releasePointerCapture(event.pointerId);
    }
    modulator.viewportControl?.classList.remove("is-adjusting");
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    input.addEventListener(type, finishPointerAdjustment);
  }
  input.addEventListener("input", () => {
    modulator[kind] = Number(input.value);
    updateParameterModulatorUI(modulator);
    audioDirty = true;
  });
  input.addEventListener("change", () => {
    announce(`${titleCase(modulator.target)} wiggle ${label.toLowerCase()} ${output.textContent}`);
  });
  if (kind === "rateHz") {
    modulator.rateInput = input;
    modulator.rateOutput = output;
  } else {
    modulator.depthInput = input;
    modulator.depthOutput = output;
  }
  return holder;
}

function collapseViewportModulatorControls(exceptTarget = "") {
  expandedViewportModulatorTarget = exceptTarget;
  parameterModulators.forEach(updateParameterModulatorUI);
}

function closeViewportModulatorControls(modulator) {
  if (!modulator) return;
  modulator.button?.focus({ preventScroll: true });
  expandedViewportModulatorTarget = "";
  parameterModulators.forEach(updateParameterModulatorUI);
  announce(`${titleCase(modulator.target)} controls closed; modulation keeps running`);
}

function installViewportParameterModulators() {
  if (!TONGUE_MODE || !viewportModulationLayer) return;
  const fragment = document.createDocumentFragment();
  parameterModulators.forEach((modulator) => {
    if (!VIEWPORT_MODULATION_TARGETS.includes(modulator.target)) return;
    const control = document.createElement("div");
    control.className = "viewport-modulator";
    control.dataset.viewportModulator = modulator.target;
    control.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "viewport-mod-toggle";
    button.textContent = "∿";
    button.id = `${modulator.elementId}ViewportModButton`;
    button.setAttribute("aria-pressed", "false");
    const controls = document.createElement("div");
    controls.className = "viewport-mod-controls";
    controls.id = `${modulator.elementId}ViewportModControls`;
    controls.hidden = true;
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", `${titleCase(modulator.target)} modulation speed and width`);
    button.setAttribute("aria-controls", controls.id);
    button.addEventListener("click", () => {
      setViewportTonguePresetPaletteOpen(false, { pinned: false });
      if (modulator.enabled && expandedViewportModulatorTarget !== modulator.target) {
        expandedViewportModulatorTarget = modulator.target;
      } else {
        modulator.enabled = !modulator.enabled;
        expandedViewportModulatorTarget = modulator.enabled ? modulator.target : "";
      }
      if (modulator.enabled) void ensureAudio();
      parameterModulators.forEach(updateParameterModulatorUI);
      audioDirty = true;
      announce(`${titleCase(modulator.target)} viewport modulation ${modulator.enabled ? "on; speed and width controls open" : "off"}`);
    });
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "viewport-mod-close";
    closeButton.textContent = "×";
    closeButton.setAttribute(
      "aria-label",
      `Close ${titleCase(modulator.target)} modulation controls; modulation stays on`,
    );
    closeButton.title = "Close controls · modulation stays on";
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeViewportModulatorControls(modulator);
    });
    controls.append(
      closeButton,
      createViewportModulationRange(
        modulator,
        "rateHz",
        "SPEED",
        0.02,
        20,
        0.01,
        modulator.rateHz,
      ),
      createViewportModulationRange(
        modulator,
        "depth",
        "WIDTH",
        0,
        1,
        0.01,
        modulator.depth,
      ),
    );
    control.append(button, controls);
    modulator.button = button;
    modulator.controls = controls;
    modulator.viewportControl = control;
    control.style.setProperty("--viewport-mod-color", HANDLE_COLORS[modulator.target]);
    fragment.append(control);
    updateParameterModulatorUI(modulator);
  });
  viewportModulationLayer.replaceChildren(fragment);
  viewportModulationLayer.addEventListener("pointerdown", (event) => {
    setViewportTonguePresetPaletteOpen(false, { pinned: false });
    event.stopPropagation();
  });
}

function positionViewportParameterModulators(viewportHandles = handles) {
  if (!TONGUE_MODE || !viewportModulationLayer) return;
  parameterModulators.forEach((modulator) => {
    const control = modulator.viewportControl;
    if (!control) return;
    const handle = viewportHandles.find(({ type }) => type === modulator.target);
    if (!handle?.modAnchor) {
      control.hidden = true;
      return;
    }
    const x = clamp(handle.modAnchor.x, 18, Math.max(18, cssWidth - 18));
    const y = clamp(handle.modAnchor.y, 18, Math.max(18, cssHeight - 18));
    const popoverWidth = cssWidth <= 520 ? 142 : 168;
    const horizontalDirection = handle.modDirection?.x ?? 0;
    const verticalDirection = handle.modDirection?.y ?? 0;
    const canOpenLeft = x >= popoverWidth + 34;
    const canOpenRight = cssWidth - x >= popoverWidth + 34;
    const opensLeft = horizontalDirection < 0 && canOpenLeft
      ? true
      : horizontalDirection > 0 && canOpenRight
        ? false
        : x > cssWidth * 0.5;
    const opensUp = verticalDirection < 0 && y >= 94
      ? true
      : verticalDirection > 0 && cssHeight - y >= 94
        ? false
        : y > cssHeight * 0.56;
    const placement = `${x.toFixed(2)}:${y.toFixed(2)}:${Number(opensLeft)}:${Number(opensUp)}`;
    if (control.dataset.placement !== placement) {
      control.dataset.placement = placement;
      control.style.left = `${x}px`;
      control.style.top = `${y}px`;
      control.classList.toggle("opens-left", opensLeft);
      control.classList.toggle("opens-up", opensUp);
    }
    control.hidden = false;
  });
}

function setViewportTonguePresetPaletteOpen(open, { pinned = viewportTonguePresetsPinned } = {}) {
  if (!viewportTonguePresets || !viewportTonguePresetTrigger) return;
  viewportTonguePresetsPinned = Boolean(pinned && open);
  viewportTonguePresets.classList.toggle("is-open", Boolean(open));
  viewportTonguePresetTrigger.setAttribute("aria-expanded", String(Boolean(open)));
}

function installViewportTonguePresetPalette() {
  if (!TONGUE_MODE || !viewportTonguePresets || !viewportTonguePresetTrigger) return;
  let closeTimer = 0;
  const cancelClose = () => {
    globalThis.clearTimeout(closeTimer);
    closeTimer = 0;
  };
  const keepOpen = () => {
    cancelClose();
    if (!viewportTonguePresets.classList.contains("is-open")) {
      collapseViewportModulatorControls();
    }
    setViewportTonguePresetPaletteOpen(true);
  };
  const closeAfterPointerExit = () => {
    cancelClose();
    closeTimer = globalThis.setTimeout(() => {
      if (viewportTonguePresetsPinned
        || viewportTonguePresets.matches(":hover")
        || viewportTonguePresets.contains(document.activeElement)) return;
      setViewportTonguePresetPaletteOpen(false, { pinned: false });
    }, 180);
  };
  viewportTonguePresets.addEventListener("pointerenter", keepOpen);
  viewportTonguePresets.addEventListener("pointerleave", closeAfterPointerExit);
  viewportTonguePresets.addEventListener("focusin", keepOpen);
  viewportTonguePresets.addEventListener("focusout", closeAfterPointerExit);
  viewportTonguePresets.addEventListener("pointerdown", (event) => event.stopPropagation());
  viewportTonguePresetTrigger.addEventListener("click", () => {
    const pin = !viewportTonguePresetsPinned;
    setViewportTonguePresetPaletteOpen(
      pin || viewportTonguePresets.matches(":hover") || viewportTonguePresets.matches(":focus-within"),
      { pinned: pin },
    );
  });
  document.addEventListener("pointerdown", (event) => {
    if (viewportTonguePresets.contains(event.target)) return;
    setViewportTonguePresetPaletteOpen(false, { pinned: false });
    if (viewportTonguePresets.contains(document.activeElement)) document.activeElement.blur?.();
  });
}

function disableTongueParameterModulators() {
  parameterModulators.forEach((modulator) => {
    if (modulator.family !== "tongue") return;
    modulator.enabled = false;
    updateParameterModulatorUI(modulator);
  });
}

function resetTongueParameterModulators() {
  parameterModulators.forEach((modulator, index) => {
    if (modulator.family !== "tongue") return;
    const definition = PARAMETER_MODULATOR_DEFINITIONS[index];
    Object.assign(modulator, definition, { enabled: false });
    modulator.phase = (index * 0.173) % 1;
    updateParameterModulatorUI(modulator);
  });
}

function resetParameterModulators() {
  expandedViewportModulatorTarget = "";
  parameterModulators.forEach((modulator, index) => {
    const definition = PARAMETER_MODULATOR_DEFINITIONS[index];
    Object.assign(modulator, definition, { enabled: false });
    modulator.phase = (index * 0.173) % 1;
    updateParameterModulatorUI(modulator);
  });
  performanceState = manualBreath
    ? { ...state, active: true }
    : gesturePlaying
      ? interpolateGesture(activeGesture(), gesturePhase, state)
      : { ...state, active: false };
  if (!tongueMotionId) performanceTongueState = tongueState;
  audioDirty = true;
  announce("All viewport modulators stopped and reset to their starting speed and width");
}

function resetTonguePerformance() {
  if (!TONGUE_MODE) return;
  tongueState = sanitizeTongueState(DEFAULT_TONGUE_STATE);
  performanceTongueState = tongueState;
  tongueArticulation = IDLE_TONGUE_ARTICULATION;
  resetTongueParameterModulators();
  setTongueMotion("", { announceChange: false, startAudio: false });
  setViewportTonguePresetPaletteOpen(false, { pinned: false });
  updateTonguePresentation(performanceState);
  audioDirty = true;
  announce("Tongue reset to its free-hand starting pose; call transport continues");
}

function randomizeBody() {
  const wasPlaying = gesturePlaying;
  state = randomizeSyrinxState(state);
  if (TONGUE_MODE) {
    tongueState = sanitizeTongueState({
      ...tongueState,
      tongueEnabled: true,
      ...Object.fromEntries(TONGUE_CONTROL_KEYS.map((key) => [key, Math.random()])),
    }, tongueState);
    expandedViewportModulatorTarget = "";
    parameterModulators.forEach((modulator, index) => {
      modulator.enabled = Math.random() > 0.28;
      const maximumRate = modulator.family === "host" ? 20 : 30;
      modulator.rateHz = 0.02 + Math.random() ** 2 * (maximumRate - 0.02);
      modulator.depth = 0.36 + Math.random() * 0.64;
      modulator.shape = ["sine", "triangle", "square", "sample-hold"][index % 4];
      updateParameterModulatorUI(modulator);
    });
    const motions = Object.keys(TONGUE_MOTION_PRESETS);
    setTongueMotion(motions[Math.floor(Math.random() * motions.length)], {
      announceChange: false,
    });
  }
  performanceState = manualBreath
    ? { ...state, active: true }
    : wasPlaying
      ? interpolateGesture(activeGesture(), gesturePhase, state)
      : { ...state, active: false };
  updateControlValues();
  if (graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
  }
  postConfiguration(performanceState, true);
  audioDirty = true;
  announce(TONGUE_MODE
    ? `${activeAnimal().label} mutated with a new feral tongue and live parameter wiggles`
    : `${activeAnimal().label} parameters randomized; selected preset and transport retained`);
}

function installControlListeners() {
  animalSelect.addEventListener("change", () => loadAnimal(animalSelect.value));
  callSelect.addEventListener("change", () => loadCall(callSelect.value));
  for (const [stateKey, elementId] of Object.entries(CONTROL_IDS)) {
    const input = $(elementId);
    input?.addEventListener("input", () => setControl(stateKey, Number(input.value)));
    input?.addEventListener("change", () => setControl(stateKey, Number(input.value), {
      announceChange: true,
    }));
  }
  audioButton.addEventListener("click", toggleAudio);
  playButton.addEventListener("click", playGesture);
  loopButton.addEventListener("click", () => {
    state = sanitizeSyrinxState({ ...state, loop: !state.loop }, state);
    setGesturePresentation();
    announce(`Call loop ${state.loop ? "on" : "off"}`);
  });
  document.querySelector("[data-reset-all]")?.addEventListener("click", () => {
    if (TONGUE_MODE) {
      tongueState = sanitizeTongueState(DEFAULT_TONGUE_STATE);
      performanceTongueState = tongueState;
      tongueArticulation = IDLE_TONGUE_ARTICULATION;
      setTongueMotion("", { announceChange: false, startAudio: false });
      resetParameterModulators();
    }
    loadAnimal(state.animalId);
    announce(state.biologicalLock
      ? `${activeAnimal().label} restored to its species-informed starting range`
      : `${activeAnimal().label} restored with universal performance ranges`);
  });
  $("randomizeButton")?.addEventListener("click", randomizeBody);
  installModulationListeners();
  installViewportParameterModulators();
  installViewportTonguePresetPalette();
  installTongueListeners();
  $("resetViewportTongue")?.addEventListener("click", resetTonguePerformance);
  $("resetViewportModulators")?.addEventListener("click", resetParameterModulators);

  breathButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    breathButton.setPointerCapture?.(event.pointerId);
    setManualBreath(true);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    breathButton.addEventListener(type, () => setManualBreath(false));
  }
  breathButton.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      setManualBreath(true);
    }
  });
  breathButton.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setManualBreath(false);
    }
  });
  breathButton.addEventListener("click", (event) => event.preventDefault());
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  const maximumPixels = 2_800_000;
  pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixels = cssWidth * cssHeight * pixelRatio * pixelRatio;
  if (pixels > maximumPixels) pixelRatio *= Math.sqrt(maximumPixels / pixels);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) * 0.5, Math.abs(height) * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function anatomyLayout(soundingState) {
  const compact = cssHeight < 360;
  const centerY = cssHeight * (compact ? 0.54 : 0.5);
  const lengthProgress = Math.log(soundingState.tractLengthM / 0.018) / Math.log(0.82 / 0.018);
  const sourceX = cssWidth * (compact ? 0.32 : 0.29);
  const sourceY = centerY;
  const tractStartX = sourceX + Math.min(52, cssWidth * 0.055);
  const mouthX = cssWidth * (0.62 + clamp(lengthProgress) * 0.24);
  const mouthGap = 7 + soundingState.mouthOpening * Math.min(46, cssHeight * 0.1);
  const cavityX = tractStartX + (mouthX - tractStartX) * 0.52;
  const cavityY = centerY - Math.min(88, cssHeight * 0.18);
  const cavityRadius = 17 + soundingState.cavityCoupling * Math.min(54, cssHeight * 0.1);
  return {
    compact,
    centerY,
    lungX: cssWidth * 0.15,
    lungY: centerY,
    sourceX,
    sourceY,
    tractStartX,
    mouthX,
    mouthGap,
    cavityX,
    cavityY,
    cavityRadius,
  };
}

function drawLungs(layout, soundingState, time) {
  const pressure = soundingState.active ? soundingState.pressure : 0;
  const breathPulse = prefersReducedMotion ? 0 : Math.sin(time * 0.004) * pressure * 3;
  drawing.save();
  drawing.translate(layout.lungX, layout.lungY);
  drawing.lineWidth = 1;
  drawing.strokeStyle = `rgba(255,123,111,${0.25 + pressure * 0.5})`;
  drawing.fillStyle = `rgba(255,123,111,${0.025 + pressure * 0.07})`;
  for (const side of [-1, 1]) {
    drawing.beginPath();
    drawing.moveTo(side * 6, -34);
    drawing.bezierCurveTo(
      side * (28 + breathPulse),
      -42,
      side * (52 + breathPulse),
      -5,
      side * (43 + breathPulse),
      35,
    );
    drawing.bezierCurveTo(side * 35, 59, side * 8, 47, side * 7, 17);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
  }
  drawing.strokeStyle = "rgba(255,207,104,0.35)";
  drawing.beginPath();
  drawing.moveTo(0, -44);
  drawing.lineTo(0, 8);
  drawing.lineTo(layout.sourceX - layout.lungX, layout.sourceY - layout.lungY);
  drawing.stroke();
  drawing.fillStyle = "rgba(255,123,111,0.65)";
  drawing.font = "7px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText("PRESSURE", 0, 72);
  drawing.restore();
}

function drawMammalSource(layout, soundingState, time) {
  const active = soundingState.active ? 1 : 0;
  const vibration = prefersReducedMotion ? 0 : Math.sin(time * 0.03) * active * (2 + soundingState.pressure * 5);
  drawing.save();
  drawing.translate(layout.sourceX, layout.sourceY);
  drawing.strokeStyle = "rgba(255,123,111,0.82)";
  drawing.fillStyle = "rgba(255,123,111,0.09)";
  drawing.lineWidth = 1.3;
  for (const side of [-1, 1]) {
    drawing.beginPath();
    drawing.moveTo(side * (5 + vibration), -34);
    drawing.quadraticCurveTo(side * (13 - vibration * 0.5), 0, side * (5 - vibration), 34);
    drawing.lineTo(side * 19, 29);
    drawing.quadraticCurveTo(side * 27, 0, side * 19, -29);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
  }
  drawing.restore();
}

function drawBirdSource(layout, soundingState, time) {
  const vibration = prefersReducedMotion ? 0 : Math.sin(time * 0.035) * (soundingState.active ? 4 : 0);
  drawing.save();
  drawing.translate(layout.sourceX, layout.sourceY);
  drawing.strokeStyle = "rgba(255,207,104,0.75)";
  drawing.lineWidth = 1.2;
  drawing.beginPath();
  drawing.moveTo(-42, 35);
  drawing.quadraticCurveTo(-26, 10, -5, 2);
  drawing.moveTo(42, 35);
  drawing.quadraticCurveTo(26, 10, 5, 2);
  drawing.moveTo(0, -34);
  drawing.lineTo(0, 34);
  drawing.stroke();
  for (const side of [-1, 1]) {
    drawing.fillStyle = side < 0 ? "rgba(255,123,111,0.16)" : "rgba(114,231,220,0.16)";
    drawing.strokeStyle = side < 0 ? "#ff7b6f" : "#72e7dc";
    drawing.beginPath();
    drawing.ellipse(side * (10 + vibration * side), 9, 5, 17, side * 0.26, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
  }
  drawing.restore();
}

function drawFrogSource(layout, soundingState, time) {
  const pulse = soundingState.active && !prefersReducedMotion
    ? (Math.sin(time * 0.018) * 0.5 + 0.5) * soundingState.pressure
    : 0;
  drawing.save();
  drawing.translate(layout.sourceX, layout.sourceY);
  drawing.strokeStyle = "#72e7dc";
  drawing.fillStyle = `rgba(114,231,220,${0.04 + pulse * 0.1})`;
  drawing.lineWidth = 1.2;
  drawing.beginPath();
  drawing.ellipse(0, 0, 22 + pulse * 5, 35 + pulse * 3, 0, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.strokeStyle = "rgba(255,207,104,0.72)";
  drawing.beginPath();
  drawing.moveTo(-16, 0);
  drawing.quadraticCurveTo(0, -8 - pulse * 5, 16, 0);
  drawing.moveTo(-16, 4);
  drawing.quadraticCurveTo(0, 12 + pulse * 5, 16, 4);
  drawing.stroke();
  drawing.restore();
}

function drawWhistleSource(layout, soundingState, time) {
  const pressure = soundingState.active ? soundingState.pressure : 0;
  drawing.save();
  drawing.translate(layout.sourceX, layout.sourceY);
  drawing.strokeStyle = "rgba(114,231,220,0.78)";
  drawing.lineWidth = 1.2;
  drawing.strokeRect(-28, -17, 20, 34);
  drawing.beginPath();
  drawing.moveTo(-8, -6);
  drawing.lineTo(17, -2);
  drawing.lineTo(26, -27);
  drawing.moveTo(17, -2);
  drawing.lineTo(28, 15);
  drawing.stroke();
  if (pressure > 0) {
    drawing.strokeStyle = `rgba(255,207,104,${0.35 + pressure * 0.5})`;
    drawing.setLineDash([3, 3]);
    drawing.lineDashOffset = prefersReducedMotion ? 0 : -time * 0.03;
    drawing.beginPath();
    drawing.moveTo(-8, 0);
    drawing.quadraticCurveTo(8, Math.sin(time * 0.02) * 4, 24, -18);
    drawing.stroke();
  }
  drawing.restore();
}

function drawSource(layout, soundingState, time) {
  if (soundingState.sourceModel === "bird") drawBirdSource(layout, soundingState, time);
  else if (soundingState.sourceModel === "frog") drawFrogSource(layout, soundingState, time);
  else if (soundingState.sourceModel === "rodent") drawWhistleSource(layout, soundingState, time);
  else drawMammalSource(layout, soundingState, time);
}

function tractEdges(layout, soundingState) {
  const sourceRadius = 11 + soundingState.sourceScale * 11;
  const upperStart = layout.sourceY - sourceRadius;
  const lowerStart = layout.sourceY + sourceRadius;
  const upperEnd = layout.sourceY - layout.mouthGap;
  const lowerEnd = layout.sourceY + layout.mouthGap;
  return { upperStart, lowerStart, upperEnd, lowerEnd };
}

function drawTract(layout, soundingState, time) {
  const edges = tractEdges(layout, soundingState);
  const active = soundingState.active;
  drawing.save();
  drawing.lineWidth = 1.2;
  drawing.fillStyle = "rgba(255,207,104,0.028)";
  drawing.strokeStyle = "rgba(255,207,104,0.62)";
  drawing.beginPath();
  drawing.moveTo(layout.tractStartX, edges.upperStart);
  drawing.bezierCurveTo(
    layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.24,
    edges.upperStart - 17,
    layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.64,
    layout.centerY - 31,
    layout.mouthX,
    edges.upperEnd,
  );
  drawing.lineTo(layout.mouthX, edges.lowerEnd);
  drawing.bezierCurveTo(
    layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.64,
    layout.centerY + 31,
    layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.24,
    edges.lowerStart + 17,
    layout.tractStartX,
    edges.lowerStart,
  );
  drawing.closePath();
  drawing.fill();
  drawing.stroke();

  drawing.strokeStyle = `rgba(114,231,220,${active ? 0.26 : 0.08})`;
  drawing.setLineDash([2, 8]);
  drawing.lineDashOffset = prefersReducedMotion ? 0 : -time * 0.02 * (0.4 + soundingState.pressure);
  for (const offset of [-7, 0, 7]) {
    drawing.beginPath();
    drawing.moveTo(layout.tractStartX, layout.centerY + offset);
    drawing.bezierCurveTo(
      layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.36,
      layout.centerY + offset * 1.8,
      layout.tractStartX + (layout.mouthX - layout.tractStartX) * 0.7,
      layout.centerY + offset * 0.4,
      layout.mouthX,
      layout.centerY + offset * soundingState.mouthOpening,
    );
    drawing.stroke();
  }
  drawing.setLineDash([]);
  drawing.strokeStyle = "rgba(191,156,255,0.7)";
  drawing.beginPath();
  drawing.moveTo(layout.mouthX, edges.upperEnd - 5);
  drawing.quadraticCurveTo(layout.mouthX + 16, layout.centerY - layout.mouthGap * 0.35, layout.mouthX + 25, layout.centerY);
  drawing.quadraticCurveTo(layout.mouthX + 16, layout.centerY + layout.mouthGap * 0.35, layout.mouthX, edges.lowerEnd + 5);
  drawing.stroke();
  drawing.restore();
}

function drawCavity(layout, soundingState, time) {
  const active = soundingState.active ? soundingState.pressure : 0;
  const pulse = prefersReducedMotion ? 0 : Math.sin(time * 0.009) * active * 3;
  drawing.save();
  drawing.strokeStyle = `rgba(114,231,220,${0.35 + soundingState.cavityCoupling * 0.45})`;
  drawing.fillStyle = `rgba(114,231,220,${0.02 + active * 0.045})`;
  drawing.lineWidth = 1;
  drawing.beginPath();
  drawing.moveTo(layout.cavityX, layout.centerY - 13);
  drawing.lineTo(layout.cavityX, layout.cavityY + layout.cavityRadius);
  drawing.stroke();
  drawing.beginPath();
  drawing.ellipse(
    layout.cavityX,
    layout.cavityY,
    layout.cavityRadius + pulse,
    layout.cavityRadius * 0.77 + pulse,
    0,
    0,
    Math.PI * 2,
  );
  drawing.fill();
  drawing.stroke();
  drawing.fillStyle = "rgba(114,231,220,0.58)";
  drawing.font = "7px ui-monospace, monospace";
  drawing.textAlign = "center";
  const label = soundingState.sourceModel === "bird"
    ? "OEC MODES"
    : soundingState.sourceModel === "frog"
      ? "SAC / HEAD MODES"
      : soundingState.sourceModel === "rodent" ? "PHARYNX MODES" : "BODY MODES";
  drawing.fillText(label, layout.cavityX, layout.cavityY + 3);
  drawing.restore();
}

function drawWaveform(layout) {
  if (!graph?.analyser) return;
  if (waveform.length !== graph.analyser.fftSize) waveform = new Float32Array(graph.analyser.fftSize);
  graph.analyser.getFloatTimeDomainData(waveform);
  const left = layout.tractStartX;
  const right = Math.min(cssWidth - 18, layout.mouthX + 28);
  const width = Math.max(1, right - left);
  const y = Math.min(cssHeight - 128, layout.centerY + Math.max(68, cssHeight * 0.18));
  drawing.save();
  drawing.strokeStyle = "rgba(232,236,230,0.1)";
  drawing.lineWidth = 1;
  drawing.beginPath();
  for (let index = 0; index < waveform.length; index += 4) {
    const x = left + index / (waveform.length - 1) * width;
    const pointY = y + waveform[index] * Math.min(36, cssHeight * 0.06);
    if (index === 0) drawing.moveTo(x, pointY);
    else drawing.lineTo(x, pointY);
  }
  drawing.stroke();
  drawing.restore();
}

function drawHandle(handle) {
  const color = HANDLE_COLORS[handle.type];
  drawing.save();
  drawing.translate(handle.x, handle.y);
  drawing.fillStyle = "#030608";
  drawing.strokeStyle = color;
  drawing.lineWidth = 1.2;
  drawing.shadowColor = color;
  drawing.shadowBlur = pointerDrag?.type === handle.type ? 16 : 8;
  drawing.beginPath();
  drawing.arc(0, 0, handle.radius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.shadowBlur = 0;
  drawing.fillStyle = color;
  drawing.font = "6px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText(handle.label, 0, handle.radius + 13);
  drawing.restore();
}

function drawProgress(layout) {
  if (!gesturePlaying) return;
  const radius = 30;
  drawing.save();
  drawing.translate(layout.sourceX, layout.sourceY);
  drawing.strokeStyle = "rgba(255,207,104,0.15)";
  drawing.lineWidth = 2;
  drawing.beginPath();
  drawing.arc(0, 0, radius, -Math.PI / 2, Math.PI * 1.5);
  drawing.stroke();
  drawing.strokeStyle = "rgba(255,207,104,0.82)";
  drawing.beginPath();
  drawing.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gesturePhase);
  drawing.stroke();
  drawing.restore();
}

function controlBounds(type) {
  const animal = activeAnimal();
  return (state.biologicalLock ? animal.bounds[type] : CONTROL_LIMITS[type])
    ?? CONTROL_LIMITS[type]
    ?? [0, 1];
}

function normalizedControl(type, value = state[type]) {
  const [minimum, maximum] = controlBounds(type);
  return clamp((value - minimum) / Math.max(1e-9, maximum - minimum));
}

function universalFaceLayout(soundingState) {
  const tractAmount = normalizedControl("tractLengthM", soundingState.tractLengthM);
  const radius = Math.max(58, Math.min(cssWidth * 0.3, cssHeight * 0.34));
  const faceX = cssWidth * 0.5 + radius * 0.14;
  const faceY = cssHeight * 0.5 - radius * 0.37;
  const snout = radius * (0.48 + tractAmount * 0.3);
  const mouthX = faceX + snout;
  const mouthY = faceY + radius * 0.14;
  const mouthGap = 5 + soundingState.mouthOpening * radius * 0.25;
  const sourceX = faceX - radius * 0.54;
  const sourceY = faceY + radius * 0.5;
  const canWidth = radius * (0.34 + soundingState.sourceScale * 0.13);
  const canHeight = radius * (0.24 + soundingState.adduction * 0.09);
  const lungX = faceX - radius * 0.78;
  const lungY = faceY + radius * 1.05;
  const cavityX = faceX + radius * 0.02;
  const cavityY = faceY - radius * 0.04;
  const cavityRadius = radius * (0.16 + soundingState.cavityCoupling * 0.18);
  const breathRadius = Math.max(25, Math.min(48, radius * 0.16));
  const breathX = lungX;
  const breathY = Math.min(cssHeight - breathRadius - 22, lungY + radius * 0.48);
  return {
    radius, faceX, faceY, snout, mouthX, mouthY, mouthGap,
    sourceX, sourceY, canWidth, canHeight, lungX, lungY,
    cavityX, cavityY, cavityRadius, breathX, breathY, breathRadius,
  };
}

function silhouetteModulation(time) {
  let rateFingerprint = 0;
  let depthFingerprint = 0;
  let motion = 0;
  modulators.forEach((modulator, index) => {
    const weight = (index + 1) / 6;
    const rate = clamp((modulator.rateHz - 0.02) / 11.98);
    const depth = clamp(modulator.depth);
    rateFingerprint += rate * weight;
    depthFingerprint += depth * (0.5 - index * 0.1);
    motion += Math.sin(
      time * 0.0004 * (0.5 + modulator.rateHz) * (index + 1)
        + modulator.phase * Math.PI * 2,
    ) * (0.015 + depth * 0.08) * (modulator.enabled ? 1 : 0.35);
  });
  return {
    rate: clamp(rateFingerprint),
    depth: clamp(depthFingerprint),
    motion,
  };
}

function drawAnimalSilhouette(layout, soundingState, time) {
  const preset = SILHOUETTE_PRESETS[soundingState.animalId] ?? SILHOUETTE_PRESETS.raven;
  const r = layout.radius;
  const pressure = normalizedControl("pressure", soundingState.pressure);
  const tension = normalizedControl("tension", soundingState.tension);
  const closure = normalizedControl("adduction", soundingState.adduction);
  const tract = normalizedControl("tractLengthM", soundingState.tractLengthM);
  const mouth = normalizedControl("mouthOpening", soundingState.mouthOpening);
  const cavity = normalizedControl("cavityCoupling", soundingState.cavityCoupling);
  const asymmetry = normalizedControl("asymmetry", soundingState.asymmetry);
  const balance = normalizedControl("sourceBalance", soundingState.sourceBalance);
  const roughness = normalizedControl("roughness", soundingState.roughness);
  const level = clamp(soundingState.level);
  const pace = clamp((soundingState.gestureRate - 0.25) / 2.25);
  const gap = clamp(soundingState.loopGapMs / 8_000);
  const modulation = silhouetteModulation(time);
  const bob = prefersReducedMotion
    ? 0
    : Math.sin(time * (0.00028 + pace * 0.0012 + modulation.rate * 0.0008))
      * r * (0.008 + modulation.depth * 0.025);
  const tilt = (asymmetry - 0.5) * 0.16 + (balance - 0.5) * 0.12 + modulation.motion * 0.18;
  const headScale = 0.86 + cavity * 0.2;
  const bodyScale = 0.84 + pressure * 0.22;
  const snoutLength = r * preset.snout * (0.7 + tract * 0.42);
  const jawGap = r * (0.015 + mouth * 0.075);
  const earHeight = r * (0.19 + tension * 0.26);
  const earSpread = r * (0.13 + (1 - closure) * 0.13);
  const jitter = r * roughness * 0.035;
  const alpha = 0.1 + level * 0.22;
  const glow = 3 + level * 13 + modulation.depth * 9;

  drawing.save();
  drawing.translate(layout.faceX, layout.faceY + bob);
  drawing.rotate(tilt);
  drawing.scale(0.98 + level * 0.035, 0.98 + pressure * 0.025);
  drawing.lineJoin = "round";
  drawing.lineCap = "round";
  drawing.lineWidth = 1.2 + level * 1.3 + roughness * 0.45
    + pace * 0.35 + modulation.rate * 0.6 + modulation.depth * 0.5;
  drawing.strokeStyle = "rgba(114,231,220," + alpha.toFixed(3) + ")";
  drawing.fillStyle = "rgba(114,231,220," + (0.018 + level * 0.026).toFixed(3) + ")";
  drawing.shadowColor = "#72e7dc";
  drawing.shadowBlur = glow;
  drawing.setLineDash([3 + gap * 8, 4 + (1 - gap) * 14]);
  drawing.lineDashOffset = prefersReducedMotion
    ? 0
    : -time * (0.004 + pace * 0.014 + modulation.rate * 0.012);

  drawing.beginPath();
  drawing.ellipse(
    -r * 0.48,
    r * 0.62,
    r * 0.62 * bodyScale,
    r * 0.4 * (0.88 + pressure * 0.2),
    -0.08 - tilt * 0.4,
    0,
    Math.PI * 2,
  );
  drawing.fill();
  drawing.stroke();

  if (preset.family === "bird") {
    drawing.beginPath();
    drawing.ellipse(-r * 0.04, 0, r * 0.35 * headScale, r * 0.38 * headScale, -0.12, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(r * 0.23, -jawGap);
    drawing.lineTo(r * 0.23 + snoutLength, modulation.motion * r * 0.04);
    drawing.lineTo(r * 0.23, jawGap);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(-r * 0.42, r * 0.34);
    drawing.quadraticCurveTo(-r * (0.62 + roughness * 0.12), r * 0.72, -r * 0.82, r * 0.88);
    drawing.stroke();
  } else if (preset.family === "owl") {
    drawing.beginPath();
    drawing.ellipse(0, 0, r * 0.43 * headScale, r * 0.46 * headScale, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
    for (const side of [-1, 1]) {
      drawing.beginPath();
      drawing.arc(side * r * 0.15, -r * 0.06, r * (0.075 + cavity * 0.03), 0, Math.PI * 2);
      drawing.stroke();
    }
    drawing.beginPath();
    drawing.moveTo(0, r * 0.02);
    drawing.lineTo(snoutLength * 0.42, jawGap * 0.2);
    drawing.lineTo(0, jawGap);
    drawing.closePath();
    drawing.stroke();
  } else if (preset.family === "frog") {
    drawing.beginPath();
    drawing.ellipse(0, r * 0.08, r * (0.48 + cavity * 0.1), r * (0.3 + pressure * 0.06), 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
    for (const side of [-1, 1]) {
      drawing.beginPath();
      drawing.arc(side * r * 0.27, -r * 0.13, r * (0.055 + tension * 0.025), 0, Math.PI * 2);
      drawing.stroke();
    }
    drawing.beginPath();
    drawing.moveTo(-r * 0.28, r * 0.14);
    drawing.quadraticCurveTo(0, r * (0.18 + mouth * 0.12), r * 0.34, r * 0.12);
    drawing.stroke();
  } else if (preset.family === "reptile") {
    drawing.beginPath();
    drawing.moveTo(-r * 0.36, -r * 0.2);
    drawing.lineTo(r * 0.18 + snoutLength, -r * (0.13 + closure * 0.04));
    drawing.quadraticCurveTo(r * 0.34 + snoutLength, 0, r * 0.16 + snoutLength, jawGap);
    drawing.lineTo(-r * 0.38, r * 0.25);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    drawing.beginPath();
    drawing.arc(-r * 0.05, -r * 0.18, r * 0.045, 0, Math.PI * 2);
    drawing.stroke();
  } else if (preset.family === "elephant") {
    drawing.beginPath();
    drawing.ellipse(0, 0, r * 0.4 * headScale, r * 0.46 * headScale, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
    drawing.beginPath();
    drawing.ellipse(-r * 0.22, r * 0.03, r * (0.26 + cavity * 0.12), r * (0.34 + pressure * 0.08), -0.14, 0, Math.PI * 2);
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(r * 0.25, r * 0.03);
    drawing.bezierCurveTo(
      r * 0.35 + snoutLength * 0.3,
      r * 0.18,
      r * 0.2 + snoutLength * 0.42,
      r * (0.58 + tract * 0.22),
      r * (0.44 + mouth * 0.12),
      r * (0.72 + tract * 0.18),
    );
    drawing.stroke();
  } else {
    const boarBias = preset.family === "boar" ? 0.1 : 0;
    drawing.beginPath();
    drawing.ellipse(0, 0, r * (0.38 + boarBias) * headScale, r * 0.43 * headScale, -0.04, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(r * 0.2, -r * 0.13);
    drawing.quadraticCurveTo(
      r * 0.26 + snoutLength * 0.65,
      -r * (0.12 + roughness * 0.04),
      r * 0.18 + snoutLength,
      -jawGap,
    );
    drawing.lineTo(r * 0.18 + snoutLength, jawGap);
    drawing.quadraticCurveTo(r * 0.33, r * (0.18 + mouth * 0.06), r * 0.08, r * 0.25);
    drawing.stroke();
  }

  if (preset.ears !== "none" && preset.family !== "elephant") {
    for (const side of [-1, 1]) {
      const x = side * earSpread - r * 0.05;
      if (preset.ears === "round" || preset.ears === "fan") {
        drawing.beginPath();
        drawing.ellipse(x, -r * 0.35, r * (preset.family === "mouse" ? 0.16 : 0.11), earHeight * 0.5, side * 0.18, 0, Math.PI * 2);
        drawing.stroke();
      } else if (preset.ears === "drop") {
        drawing.beginPath();
        drawing.moveTo(x - r * 0.08, -r * 0.3);
        drawing.quadraticCurveTo(x - side * r * 0.14, -r * 0.04, x + side * r * 0.04, r * 0.05);
        drawing.stroke();
      } else {
        const width = preset.ears === "wide" ? r * 0.18 : r * 0.1;
        const height = preset.ears === "long" ? earHeight * 1.25 : earHeight;
        drawing.beginPath();
        drawing.moveTo(x - width, -r * 0.28);
        drawing.lineTo(x + side * r * (0.03 + modulation.motion), -r * 0.28 - height);
        drawing.lineTo(x + width, -r * 0.25);
        drawing.closePath();
        drawing.stroke();
      }
    }
  }

  if (preset.mane) {
    const teeth = 18;
    drawing.beginPath();
    for (let index = 0; index <= teeth; index += 1) {
      const angle = index / teeth * Math.PI * 2;
      const tooth = index % 2 ? jitter + r * 0.045 * preset.mane : 0;
      const radius = r * (0.48 + preset.mane * 0.08) + tooth;
      const x = Math.cos(angle) * radius - r * 0.06;
      const y = Math.sin(angle) * radius + r * 0.02;
      if (index === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.closePath();
    drawing.stroke();
  }

  if (preset.horns || preset.antlers) {
    for (const side of [-1, 1]) {
      drawing.beginPath();
      drawing.moveTo(side * r * 0.2, -r * 0.34);
      drawing.quadraticCurveTo(side * r * 0.42, -r * (0.56 + tension * 0.16), side * r * 0.58, -r * (0.52 + tension * 0.24));
      if (preset.antlers) {
        drawing.moveTo(side * r * 0.36, -r * 0.52);
        drawing.lineTo(side * r * 0.28, -r * (0.72 + closure * 0.12));
        drawing.moveTo(side * r * 0.47, -r * 0.59);
        drawing.lineTo(side * r * 0.55, -r * (0.77 + cavity * 0.1));
      }
      drawing.stroke();
    }
  }

  if (preset.tusk) {
    drawing.beginPath();
    drawing.arc(r * 0.48 + snoutLength * 0.55, jawGap, r * (0.07 + mouth * 0.04), Math.PI * 0.9, Math.PI * 1.75);
    drawing.stroke();
  }

  drawing.setLineDash([]);
  drawing.shadowBlur = 0;
  drawing.fillStyle = "rgba(114,231,220," + (0.16 + level * 0.22).toFixed(3) + ")";
  drawing.font = "700 7px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText(activeAnimal().label.toUpperCase() + " FORM", -r * 0.18, r * 1.14);
  drawing.restore();
}

function drawTongue(layout) {
  tongueHitGeometry = null;
  if (!TONGUE_MODE || !performanceTongueState.tongueEnabled) return;
  const r = layout.radius;
  const { state: tongue, center, width } = tongueGeometry(performanceTongueState);
  const oralStart = layout.faceX - r * 0.24;
  const mouthEnd = layout.mouthX + r * 0.025;
  const maximumTipX = Math.max(mouthEnd, Math.min(cssWidth - 18, mouthEnd + r * 1.58));
  const tipX = mouthEnd + (maximumTipX - mouthEnd) * tongue.tongueExtension;
  const internalSpan = Math.max(r * 0.32, mouthEnd - oralStart);
  const centerX = oralStart + internalSpan * clamp((center - 0.32) / 0.66);
  const halfWidth = internalSpan * Math.max(0.075, width * 1.42);
  const floorY = layout.mouthY + layout.mouthGap * 0.24;
  const roofY = floorY - r * 0.255;
  const bodyTop = floorY - r * (0.035 + tongue.tongueHeight * 0.235);
  const curlOffset = (tongue.tongueCurl - 0.5) * r * 0.42;
  const tipY = floorY - r * tongue.tongueTip * 0.13 - curlOffset;
  const stretched = tongue.tongueExtension > 0.08;
  const thickness = r * (0.035 + (1 - tongue.tongueExtension * 0.52) * 0.055);

  drawing.save();
  drawing.shadowColor = "#ff5f87";
  drawing.shadowBlur = pointerDrag?.type === "tongue" ? 24 : 9;
  drawing.fillStyle = pointerDrag?.type === "tongue"
    ? "rgba(255,95,135,0.48)"
    : "rgba(255,95,135,0.3)";
  drawing.strokeStyle = "rgba(255,128,157,0.92)";
  drawing.lineWidth = pointerDrag?.type === "tongue" ? 2.4 : 1.7;
  drawing.beginPath();
  drawing.moveTo(oralStart, floorY + r * 0.035);
  drawing.bezierCurveTo(
    centerX - halfWidth,
    floorY,
    centerX - halfWidth * 0.62,
    bodyTop,
    centerX,
    bodyTop,
  );
  drawing.bezierCurveTo(
    centerX + halfWidth * 0.58,
    bodyTop,
    mouthEnd + (tipX - mouthEnd) * 0.5,
    tipY - thickness * (0.5 + tongue.tongueCurl * 0.5),
    tipX,
    tipY - thickness * 0.15,
  );
  drawing.quadraticCurveTo(
    tipX - Math.max(thickness, (tipX - mouthEnd) * 0.28),
    tipY + thickness,
    oralStart,
    floorY + r * 0.035,
  );
  drawing.closePath();
  drawing.fill();
  drawing.stroke();

  drawing.shadowBlur = 0;
  drawing.setLineDash([2 + tongue.tongueExtension * 4, 4]);
  drawing.strokeStyle = "rgba(255,185,201,0.62)";
  drawing.beginPath();
  drawing.moveTo(centerX, bodyTop + r * 0.012);
  drawing.lineTo(centerX, floorY + r * 0.02);
  drawing.stroke();
  if (stretched) {
    drawing.beginPath();
    drawing.moveTo(mouthEnd, floorY - thickness * 0.12);
    drawing.quadraticCurveTo((mouthEnd + tipX) * 0.5, tipY, tipX - thickness * 0.4, tipY);
    drawing.stroke();
  }
  if (tongue.tongueLateral > 0.12) {
    drawing.strokeStyle = `rgba(114,231,220,${0.2 + tongue.tongueLateral * 0.58})`;
    drawing.beginPath();
    drawing.moveTo(centerX - halfWidth * 0.3, bodyTop + thickness * 0.25);
    drawing.quadraticCurveTo(mouthEnd, tipY + thickness * 0.52, tipX - thickness, tipY + thickness * 0.4);
    drawing.stroke();
  }
  drawing.setLineDash([]);
  const handleRadius = Math.max(10, r * 0.048);
  drawing.fillStyle = "#080507";
  drawing.strokeStyle = "#ffb4c6";
  drawing.lineWidth = 1.5;
  drawing.beginPath();
  drawing.arc(tipX, tipY, handleRadius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.fillStyle = "#ff5f87";
  drawing.beginPath();
  drawing.arc(tipX, tipY, 2.7, 0, Math.PI * 2);
  drawing.fill();
  if (bodyTop <= roofY + r * 0.018 || tipY <= roofY + r * 0.018) {
    drawing.strokeStyle = "rgba(255,207,104,0.9)";
    drawing.lineWidth = 1;
    for (const offset of [-1, 0, 1]) {
      drawing.beginPath();
      drawing.moveTo(tipX + offset * 5, roofY - 2);
      drawing.lineTo(tipX + offset * 7, roofY - 8 - Math.abs(offset) * 2);
      drawing.stroke();
    }
  }
  drawing.fillStyle = "rgba(255,173,193,0.76)";
  drawing.font = "700 7px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText(pointerDrag?.type === "tongue" ? "PULL / SEAL / FLIP" : "GRAB TONGUE", centerX, floorY + r * 0.09);
  drawing.restore();

  tongueHitGeometry = {
    rootX: oralStart,
    rootY: floorY,
    mouthX: mouthEnd,
    tipX,
    tipY,
    floorY,
    roofY,
    maximumTipX,
    radius: r,
    thickness: Math.max(handleRadius + 8, thickness * 2.2),
  };
}

function drawUniversalFace(layout, soundingState, time) {
  const r = layout.radius;
  const activePressure = soundingState.active ? soundingState.pressure : 0;
  const breath = prefersReducedMotion ? 0 : Math.sin(time * 0.006) * activePressure;
  const source = resolveSourceControls(soundingState);

  drawAnimalSilhouette(layout, soundingState, time);

  drawing.save();
  drawing.lineJoin = "round";
  drawing.lineCap = "round";

  drawing.fillStyle = "rgba(232,236,230," + (0.018 + soundingState.level * 0.025).toFixed(3) + ")";
  drawing.strokeStyle = "rgba(232,236,230,0.38)";
  drawing.lineWidth = 1.4;
  drawing.beginPath();
  drawing.moveTo(layout.faceX - r * 0.55, layout.faceY + r * 0.72);
  drawing.bezierCurveTo(layout.faceX - r * 0.8, layout.faceY + r * 0.28, layout.faceX - r * 0.72, layout.faceY - r * 0.58, layout.faceX - r * 0.18, layout.faceY - r * 0.78);
  drawing.bezierCurveTo(layout.faceX + r * 0.24, layout.faceY - r * 0.94, layout.faceX + r * 0.52, layout.faceY - r * 0.55, layout.faceX + r * 0.5, layout.faceY - r * 0.23);
  drawing.lineTo(layout.mouthX - r * 0.04, layout.mouthY - layout.mouthGap * 0.6);
  drawing.lineTo(layout.mouthX, layout.mouthY - layout.mouthGap * 0.18);
  drawing.lineTo(layout.mouthX - r * 0.03, layout.mouthY + layout.mouthGap * 0.18);
  drawing.bezierCurveTo(layout.faceX + r * 0.5, layout.faceY + r * 0.55, layout.faceX + r * 0.2, layout.faceY + r * 0.78, layout.faceX - r * 0.04, layout.faceY + r * 0.78);
  drawing.bezierCurveTo(layout.faceX - r * 0.18, layout.faceY + r * 0.88, layout.faceX - r * 0.28, layout.faceY + r * 1.08, layout.faceX - r * 0.34, layout.faceY + r * 1.3);
  drawing.lineTo(layout.faceX - r * 0.76, layout.faceY + r * 1.3);
  drawing.bezierCurveTo(layout.faceX - r * 0.66, layout.faceY + r * 1.02, layout.faceX - r * 0.58, layout.faceY + r * 0.86, layout.faceX - r * 0.55, layout.faceY + r * 0.72);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();

  drawing.strokeStyle = "rgba(114,231,220,0.2)";
  drawing.beginPath();
  drawing.arc(layout.faceX + r * 0.18, layout.faceY - r * 0.27, r * 0.035, 0, Math.PI * 2);
  drawing.stroke();

  const lungScale = 1 + activePressure * 0.34 + breath * 0.06;
  drawing.fillStyle = `rgba(255,123,111,${0.025 + activePressure * 0.08})`;
  drawing.strokeStyle = `rgba(255,123,111,${0.3 + activePressure * 0.55})`;
  for (const side of [-1, 1]) {
    drawing.beginPath();
    drawing.ellipse(
      layout.lungX + side * r * 0.2,
      layout.lungY,
      r * 0.18 * lungScale,
      r * 0.28 * lungScale,
      side * 0.12,
      0,
      Math.PI * 2,
    );
    drawing.fill();
    drawing.stroke();
  }

  drawing.strokeStyle = `rgba(255,207,104,${0.25 + activePressure * 0.55})`;
  drawing.lineWidth = 2 + activePressure * 2;
  drawing.beginPath();
  drawing.moveTo(layout.lungX, layout.lungY - r * 0.27);
  drawing.bezierCurveTo(
    layout.lungX,
    layout.lungY - r * 0.54,
    layout.sourceX - r * 0.18,
    layout.sourceY + r * 0.28,
    layout.sourceX - layout.canWidth * 0.5,
    layout.sourceY,
  );
  drawing.stroke();

  const canLeft = layout.sourceX - layout.canWidth * 0.5;
  const canRight = layout.sourceX + layout.canWidth * 0.5;
  drawing.fillStyle = "rgba(255,207,104,0.045)";
  drawing.strokeStyle = "rgba(255,207,104,0.72)";
  drawing.lineWidth = 1.4;
  drawing.beginPath();
  drawing.rect(canLeft, layout.sourceY - layout.canHeight * 0.5, layout.canWidth, layout.canHeight);
  drawing.fill();
  drawing.stroke();
  drawing.beginPath();
  drawing.ellipse(canLeft, layout.sourceY, layout.canHeight * 0.16, layout.canHeight * 0.5, 0, 0, Math.PI * 2);
  drawing.stroke();
  drawing.beginPath();
  drawing.ellipse(canRight, layout.sourceY, layout.canHeight * 0.16, layout.canHeight * 0.5, 0, 0, Math.PI * 2);
  drawing.stroke();

  const tractThickness = r * (0.08 + soundingState.mouthOpening * 0.055);
  drawing.fillStyle = "rgba(114,231,220,0.035)";
  drawing.strokeStyle = "rgba(114,231,220,0.55)";
  drawing.beginPath();
  drawing.moveTo(canRight, layout.sourceY - tractThickness);
  drawing.bezierCurveTo(
    layout.faceX - r * 0.28,
    layout.faceY + r * 0.26,
    layout.faceX + r * 0.18,
    layout.faceY + r * 0.02,
    layout.mouthX,
    layout.mouthY - layout.mouthGap * 0.25,
  );
  drawing.lineTo(layout.mouthX, layout.mouthY + layout.mouthGap * 0.25);
  drawing.bezierCurveTo(
    layout.faceX + r * 0.16,
    layout.faceY + r * 0.16,
    layout.faceX - r * 0.28,
    layout.faceY + r * 0.42,
    canRight,
    layout.sourceY + tractThickness,
  );
  drawing.closePath();
  drawing.fill();
  drawing.stroke();

  drawTongue(layout);

  const cavityPulse = prefersReducedMotion ? 0 : Math.sin(time * 0.009) * activePressure * r * 0.025;
  drawing.fillStyle = `rgba(114,231,220,${0.025 + activePressure * 0.05})`;
  drawing.strokeStyle = `rgba(114,231,220,${0.35 + soundingState.cavityCoupling * 0.5})`;
  drawing.beginPath();
  drawing.ellipse(
    layout.cavityX,
    layout.cavityY,
    layout.cavityRadius + cavityPulse,
    (layout.cavityRadius + cavityPulse) * 0.78,
    -0.12,
    0,
    Math.PI * 2,
  );
  drawing.fill();
  drawing.stroke();

  const visualRate = 0.028 + Math.log2(source.frequencyHz + 1) * 0.003;
  const flap = soundingState.active && !prefersReducedMotion
    ? Math.sin(time * visualRate) * r * (0.015 + soundingState.pressure * 0.035)
    : 0;
  const foldGap = r * (0.018 + (1 - soundingState.adduction) * 0.07);
  const foldHeight = layout.canHeight * (0.31 + soundingState.tension * 0.32);
  drawing.shadowColor = "#ff7b6f";
  drawing.shadowBlur = soundingState.active ? 16 : 5;
  drawing.strokeStyle = "#ff7b6f";
  drawing.lineWidth = 2.2;
  for (const side of [-1, 1]) {
    const asymmetry = side * (soundingState.asymmetry - 0.5) * r * 0.035;
    drawing.beginPath();
    drawing.moveTo(layout.sourceX + side * (foldGap + flap) + asymmetry, layout.sourceY - foldHeight);
    drawing.quadraticCurveTo(
      layout.sourceX + side * (foldGap * 0.3 - flap),
      layout.sourceY,
      layout.sourceX + side * (foldGap - flap) - asymmetry,
      layout.sourceY + foldHeight,
    );
    drawing.stroke();
  }
  drawing.shadowBlur = 0;

  if (activePressure > 0.01) {
    const particleCount = 15;
    for (let index = 0; index < particleCount; index += 1) {
      const travel = ((time * (0.00012 + activePressure * 0.00034)) + index / particleCount) % 1;
      const inverse = 1 - travel;
      const controlX = layout.faceX + r * 0.02;
      const controlY = layout.faceY + r * 0.16;
      const x = inverse * inverse * canRight + 2 * inverse * travel * controlX + travel * travel * layout.mouthX;
      const y = inverse * inverse * layout.sourceY + 2 * inverse * travel * controlY + travel * travel * layout.mouthY;
      drawing.fillStyle = `rgba(114,231,220,${0.18 + activePressure * 0.58})`;
      drawing.beginPath();
      drawing.arc(x, y, 1.5 + activePressure * 1.8, 0, Math.PI * 2);
      drawing.fill();
    }
  }

  drawing.strokeStyle = "rgba(191,156,255,0.85)";
  drawing.lineWidth = 2;
  drawing.beginPath();
  drawing.moveTo(layout.mouthX - r * 0.12, layout.mouthY - layout.mouthGap * 0.5);
  drawing.quadraticCurveTo(layout.mouthX + r * 0.04, layout.mouthY - layout.mouthGap, layout.mouthX + r * 0.1, layout.mouthY);
  drawing.quadraticCurveTo(layout.mouthX + r * 0.04, layout.mouthY + layout.mouthGap, layout.mouthX - r * 0.12, layout.mouthY + layout.mouthGap * 0.5);
  drawing.stroke();

  drawing.fillStyle = "rgba(232,236,230,0.46)";
  drawing.font = "7px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText("LUNGS / PRESSURE", layout.lungX, layout.lungY + r * 0.42);
  drawing.fillText("FOLD CAN", layout.sourceX, layout.sourceY + layout.canHeight * 0.75);
  drawing.fillText("RESONANCE", layout.cavityX, layout.cavityY + 3);

  drawing.fillStyle = manualBreath ? "#ff7b6f" : "rgba(3,6,8,0.9)";
  drawing.strokeStyle = manualBreath ? "#ffb1a9" : "rgba(255,123,111,0.78)";
  drawing.lineWidth = manualBreath ? 2.4 : 1.5;
  drawing.shadowColor = "#ff7b6f";
  drawing.shadowBlur = manualBreath ? 24 : 8;
  drawing.beginPath();
  drawing.arc(layout.breathX, layout.breathY, layout.breathRadius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.shadowBlur = 0;
  drawing.fillStyle = manualBreath ? "#030608" : "#ff9a90";
  drawing.font = "700 " + Math.max(7, Math.round(r * 0.034)) + "px ui-monospace, monospace";
  drawing.textAlign = "center";
  drawing.fillText("HOLD", layout.breathX, layout.breathY - 2);
  drawing.fillText("BREATH", layout.breathX, layout.breathY + Math.max(8, r * 0.045));
  drawing.restore();
}

function universalHandleList(layout, displayedState) {
  const r = layout.radius;
  const modulationGap = Math.min(30, Math.max(22, r * 0.09));
  const rail = (type, label, x1, y1, x2, y2, modOffsetX, modOffsetY) => {
    const amount = normalizedControl(type, displayedState[type]);
    return {
      type,
      label,
      x: x1 + (x2 - x1) * amount,
      y: y1 + (y2 - y1) * amount,
      radius: 12,
      rail: { x1, y1, x2, y2 },
      modAnchor: {
        x: (x1 + x2) * 0.5 + modOffsetX * modulationGap,
        y: (y1 + y2) * 0.5 + modOffsetY * modulationGap,
      },
      modDirection: { x: modOffsetX, y: modOffsetY },
    };
  };
  return [
    rail("pressure", "PRESSURE", layout.lungX - r * 0.46, layout.lungY + r * 0.32, layout.lungX - r * 0.46, layout.lungY - r * 0.36, -1, 0),
    rail("tension", "TENSION", layout.sourceX - r * 0.36, layout.sourceY + r * 0.31, layout.sourceX - r * 0.36, layout.sourceY - r * 0.31, -1, 0),
    rail("adduction", "CLOSURE", layout.sourceX + r * 0.36, layout.sourceY + r * 0.31, layout.sourceX + r * 0.36, layout.sourceY - r * 0.31, 1, 0),
    rail("roughness", "ROUGH", layout.sourceX + r * 0.58, layout.sourceY + r * 0.31, layout.sourceX + r * 0.58, layout.sourceY - r * 0.31, 1, 0),
    rail("asymmetry", "ASYMMETRY", layout.sourceX - r * 0.38, layout.sourceY + r * 0.48, layout.sourceX + r * 0.38, layout.sourceY + r * 0.48, 0, 1),
    rail("sourceBalance", "BALANCE", layout.sourceX - r * 0.38, layout.sourceY - r * 0.48, layout.sourceX + r * 0.38, layout.sourceY - r * 0.48, 0, -1),
    rail("cavityCoupling", "CAVITY", layout.cavityX - r * 0.22, layout.cavityY - r * 0.3, layout.cavityX + r * 0.26, layout.cavityY - r * 0.3, 0, -1),
    rail("tractLengthM", "TRACT", layout.faceX + r * 0.12, layout.mouthY - r * 0.45, layout.faceX + r * 0.72, layout.mouthY - r * 0.45, 0, -1),
    rail("mouthOpening", "MOUTH", layout.mouthX + r * 0.17, layout.mouthY + r * 0.27, layout.mouthX + r * 0.17, layout.mouthY - r * 0.27, 1, 0),
  ];
}

function drawUniversalRail(handle) {
  const color = HANDLE_COLORS[handle.type];
  const { x1, y1, x2, y2 } = handle.rail;
  drawing.save();
  drawing.lineCap = "round";
  drawing.strokeStyle = color;
  drawing.globalAlpha = 0.09;
  drawing.lineWidth = 16;
  drawing.beginPath();
  drawing.moveTo(x1, y1);
  drawing.lineTo(x2, y2);
  drawing.stroke();
  drawing.globalAlpha = 0.42;
  drawing.lineWidth = 1.4;
  drawing.stroke();
  drawing.fillStyle = color;
  drawing.globalAlpha = 0.3;
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    drawing.beginPath();
    drawing.arc(x, y, 3, 0, Math.PI * 2);
    drawing.fill();
  }
  drawing.restore();
}

function renderUniversalStage(time) {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  const layout = universalFaceLayout(performanceState);
  canvasBreathControl = {
    x: layout.breathX,
    y: layout.breathY,
    radius: layout.breathRadius,
  };
  drawUniversalFace(layout, performanceState, time);
  drawProgress(layout);
  const handleLayout = universalFaceLayout(state);
  handles = universalHandleList(handleLayout, performanceState);
  handles.forEach(drawUniversalRail);
  handles.forEach(drawHandle);
  positionViewportParameterModulators(handles);
}

function renderStage(time) {
  if (UI_MODE) {
    renderUniversalStage(time);
    return;
  }
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  const layout = anatomyLayout(performanceState);
  drawWaveform(layout);
  drawLungs(layout, performanceState, time);
  drawTract(layout, performanceState, time);
  drawCavity(layout, performanceState, time);
  drawSource(layout, performanceState, time);
  drawProgress(layout);

  const displayedState = UI_MODE ? state : performanceState;
  handles = [
    {
      type: "tension",
      label: "TENSION",
      x: layout.sourceX,
      y: layout.sourceY + 76 - normalizedControl("tension", displayedState.tension) * 152,
      radius: 7,
    },
    {
      type: "cavityCoupling",
      label: "COUPLING",
      x: layout.cavityX + layout.cavityRadius,
      y: layout.cavityY,
      radius: 7,
    },
    {
      type: "tractLengthM",
      label: "LENGTH",
      x: layout.mouthX - 35,
      y: layout.centerY,
      radius: 7,
    },
    {
      type: "mouthOpening",
      label: performanceState.sourceModel === "bird" ? "BEAK" : "MOUTH",
      x: layout.mouthX + 24,
      y: layout.centerY - layout.mouthGap,
      radius: 7,
    },
  ];
  if (UI_MODE) {
    handles.push(
      {
        type: "pressure",
        label: "PRESSURE",
        x: layout.lungX - 58,
        y: layout.lungY + 58 - normalizedControl("pressure") * 116,
        radius: 7,
      },
      {
        type: "sourceScale",
        label: "SIZE",
        x: layout.sourceX - 54 + normalizedControl("sourceScale") * 108,
        y: layout.sourceY - 57,
        radius: 7,
      },
      {
        type: "adduction",
        label: "CLOSURE",
        x: layout.sourceX + 51,
        y: layout.sourceY + 54 - normalizedControl("adduction") * 108,
        radius: 7,
      },
      {
        type: "asymmetry",
        label: "ASYMMETRY",
        x: layout.sourceX - 54 + normalizedControl("asymmetry") * 108,
        y: layout.sourceY + 61,
        radius: 7,
      },
      {
        type: "sourceBalance",
        label: "BALANCE",
        x: layout.sourceX - 54 + normalizedControl("sourceBalance") * 108,
        y: layout.sourceY - 81,
        radius: 7,
      },
      {
        type: "roughness",
        label: "ROUGHNESS",
        x: layout.sourceX + 75,
        y: layout.sourceY + 54 - normalizedControl("roughness") * 108,
        radius: 7,
      },
    );
  }
  if (cssHeight > 235 && cssWidth > 540) for (const handle of handles) drawHandle(handle);
}

function handleAt(x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(x - handle.x, y - handle.y);
    if (distance <= handle.radius + 14 && distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  if (nearest) return nearest;
  const point = { x, y };
  for (const handle of handles) {
    if (!handle.rail) continue;
    const distance = distanceToSegment(
      point,
      handle.rail.x1,
      handle.rail.y1,
      handle.rail.x2,
      handle.rail.y2,
    );
    if (distance <= 17 && distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function distanceToSegment(point, startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const amount = clamp(
    ((point.x - startX) * dx + (point.y - startY) * dy)
      / Math.max(1e-9, dx * dx + dy * dy),
  );
  return Math.hypot(
    point.x - (startX + dx * amount),
    point.y - (startY + dy * amount),
  );
}

function tongueAtPoint(point) {
  if (!TONGUE_MODE || !tongueHitGeometry || !tongueState.tongueEnabled) return false;
  const geometry = tongueHitGeometry;
  if (Math.hypot(point.x - geometry.tipX, point.y - geometry.tipY) <= geometry.thickness + 9) {
    return true;
  }
  return distanceToSegment(
    point,
    geometry.rootX,
    geometry.rootY,
    geometry.tipX,
    geometry.tipY,
  ) <= geometry.thickness;
}

function dragTongue(point) {
  const geometry = tongueHitGeometry;
  if (!geometry) return;
  const insideReach = clamp(
    (Math.min(point.x, geometry.mouthX) - geometry.rootX)
      / Math.max(1, geometry.mouthX - geometry.rootX),
  );
  const extension = clamp(
    (point.x - geometry.mouthX)
      / Math.max(1, geometry.maximumTipX - geometry.mouthX),
  );
  const height = clamp(
    (geometry.floorY - point.y)
      / Math.max(1, geometry.floorY - geometry.roofY),
  );
  const curl = clamp(0.5 + (geometry.floorY - point.y) / (geometry.radius * 0.46));
  const tip = clamp(
    (geometry.floorY - point.y + geometry.radius * 0.035)
      / (geometry.radius * 0.21),
  );
  const startLateral = pointerDrag?.startTongue?.tongueLateral ?? tongueState.tongueLateral;
  tongueState = sanitizeTongueState({
    ...tongueState,
    tongueEnabled: true,
    tonguePosition: insideReach,
    tongueHeight: height,
    tongueShape: clamp(tongueState.tongueShape * 0.55 + extension * 0.38 + height * 0.24),
    tongueTip: tip,
    tongueExtension: extension,
    tongueCurl: curl,
    tongueLateral: height >= 0.88 ? 0 : startLateral,
  }, tongueState);
  performanceTongueState = tongueState;
  tongueArticulation = IDLE_TONGUE_ARTICULATION;
  updateTonguePresentation(performanceState);
  audioDirty = true;
}

function dragControl(type, point) {
  const bounds = controlBounds(type);
  if (!bounds) return;
  if (UI_MODE) {
    const handle = handles.find((candidate) => candidate.type === type);
    if (!handle?.rail) return;
    const { x1, y1, x2, y2 } = handle.rail;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const amount = clamp(((point.x - x1) * dx + (point.y - y1) * dy) / Math.max(1e-9, dx * dx + dy * dy));
    const value = type === "tractLengthM"
      ? Math.exp(Math.log(bounds[0]) + amount * Math.log(bounds[1] / bounds[0]))
      : bounds[0] + amount * (bounds[1] - bounds[0]);
    setControl(type, value);
    return;
  }
  const layout = anatomyLayout(state);
  let value = state[type];
  if (type === "pressure") {
    const amount = clamp((layout.lungY + 58 - point.y) / 116);
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  } else if (type === "tension") {
    const amount = clamp((layout.sourceY + 76 - point.y) / 152);
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  } else if (type === "adduction" || type === "roughness") {
    const amount = clamp((layout.sourceY + 54 - point.y) / 108);
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  } else if (type === "sourceScale"
    || type === "asymmetry"
    || type === "sourceBalance") {
    const amount = clamp((point.x - (layout.sourceX - 54)) / 108);
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  } else if (type === "cavityCoupling") {
    const amount = clamp((point.x - layout.cavityX) / Math.max(24, cssWidth * 0.11));
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  } else if (type === "tractLengthM") {
    const amount = clamp((point.x / cssWidth - 0.58) / 0.31);
    value = Math.exp(Math.log(bounds[0]) + amount * Math.log(bounds[1] / bounds[0]));
  } else if (type === "mouthOpening") {
    const amount = clamp((layout.centerY + 58 - point.y) / 116);
    value = bounds[0] + amount * (bounds[1] - bounds[0]);
  }
  setControl(type, value);
}

function installCanvasInteraction() {
  canvas.addEventListener("pointerdown", (event) => {
    if (activePointerId != null && activePointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    if (tongueAtPoint(point)) {
      event.preventDefault();
      void ensureAudio();
      if (tongueMotionId) setTongueMotion("", { announceChange: false, startAudio: false });
      disableTongueParameterModulators();
      tongueDragStartedBreath = !gesturePlaying && !manualBreath;
      if (tongueDragStartedBreath) setManualBreath(true);
      pointerDrag = {
        type: "tongue",
        label: "TONGUE",
        pointerId: event.pointerId,
        startTongue: { ...tongueState },
      };
      activePointerId = event.pointerId;
      canvas.classList.add("is-dragging", "is-tongue-dragging");
      canvas.setPointerCapture?.(event.pointerId);
      dragTongue(point);
      return;
    }
    if (UI_MODE
      && canvasBreathControl
      && Math.hypot(point.x - canvasBreathControl.x, point.y - canvasBreathControl.y)
        <= canvasBreathControl.radius + 8) {
      event.preventDefault();
      canvasBreathPressed = true;
      activePointerId = event.pointerId;
      canvas.classList.add("is-breathing");
      canvas.setPointerCapture?.(event.pointerId);
      setManualBreath(true);
      return;
    }
    const handle = handleAt(point.x, point.y);
    if (!handle) return;
    event.preventDefault();
    pointerDrag = { ...handle, pointerId: event.pointerId };
    activePointerId = event.pointerId;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    dragControl(handle.type, point);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    if (canvasBreathPressed) {
      event.preventDefault();
      return;
    }
    if (!pointerDrag) return;
    event.preventDefault();
    if (pointerDrag.type === "tongue") dragTongue(canvasPoint(event));
    else dragControl(pointerDrag.type, canvasPoint(event));
  });
  const release = (event) => {
    if (activePointerId != null && event?.pointerId != null && event.pointerId !== activePointerId) return;
    let releaseMessage = "";
    if (canvasBreathPressed) {
      canvasBreathPressed = false;
      canvas.classList.remove("is-breathing");
      setManualBreath(false);
    }
    if (pointerDrag?.type === "tongue") {
      const aperture = tongueAirwayAperture(tongueState);
      releaseMessage = `Free-hand tongue set: ${Math.round(tongueState.tongueExtension * 100)} percent stretch, ${aperture <= 0.07 ? "airway sealed" : `${Math.round(aperture * 100)} percent airway`}`;
    } else if (pointerDrag) {
      releaseMessage = `${pointerDrag.label.toLowerCase()} set within ${state.biologicalLock ? activeAnimal().label : "universal"} range`;
    }
    pointerDrag = null;
    if (tongueDragStartedBreath) {
      tongueDragStartedBreath = false;
      setManualBreath(false);
    }
    if (releaseMessage) announce(releaseMessage);
    activePointerId = null;
    canvas.classList.remove("is-dragging", "is-tongue-dragging");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      canvasBreathPressed = true;
      canvas.classList.add("is-breathing");
      setManualBreath(true);
      return;
    }
    let key = null;
    let direction = 0;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      key = "tension";
      direction = event.key === "ArrowUp" ? 1 : -1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      key = "tractLengthM";
      direction = event.key === "ArrowRight" ? 1 : -1;
    } else if (event.key === "[" || event.key === "]") {
      key = "mouthOpening";
      direction = event.key === "]" ? 1 : -1;
    }
    if (!key) return;
    event.preventDefault();
    const [minimum, maximum] = controlBounds(key);
    setControl(key, state[key] + direction * (maximum - minimum) * 0.025, {
      announceChange: true,
    });
  });
  canvas.addEventListener("keyup", (event) => {
    if ((event.key === " " || event.key === "Enter") && canvasBreathPressed) {
      event.preventDefault();
      canvasBreathPressed = false;
      canvas.classList.remove("is-breathing");
      setManualBreath(false);
    }
  });
}

function updatePerformance(time) {
  const elapsedSeconds = time * 0.001;
  const hostParameterModulators = TONGUE_MODE ? parameterModulatorsFor("host") : [];
  const transportState = hostParameterModulators.length
    ? modulateSyrinxState(state, hostParameterModulators, elapsedSeconds)
    : state;
  if (gesturePlaying) {
    const gesture = activeGesture();
    const duration = gesture.durationMs / transportState.gestureRate;
    const timeline = resolveGestureTimeline(
      time - gestureStartTime,
      duration,
      state.loop,
      transportState.loopGapMs,
    );
    if (timeline.complete) {
      gesturePhase = 1;
      loopGapRemainingMs = 0;
      performanceState = interpolateGesture(gesture, 1, state);
      updatePerformancePresentation(performanceState);
      stopPerformance(`${gesture.label} complete`);
      return;
    }
    gesturePhase = timeline.phase;
    loopGapRemainingMs = timeline.remainingGapMs;
    performanceState = manualBreath
      ? { ...state, active: true }
      : timeline.active
        ? interpolateGesture(gesture, gesturePhase, state)
        : { ...state, active: false };
    setGesturePresentation();
    audioDirty = true;
  } else if (manualBreath) {
    performanceState = { ...state, active: true };
  } else {
    performanceState = { ...state, active: false };
  }
  if (UI_MODE) {
    performanceState = modulateSyrinxState(performanceState, modulators, elapsedSeconds);
    updateModulationPresentation(time);
  }
  if (TONGUE_MODE) {
    if (tongueMotionId) {
      const motion = sampleTongueMotionPreset(
        tongueMotionId,
        Math.max(0, time - tongueMotionStartTime) * 0.001,
        tongueState,
      );
      performanceTongueState = motion.tongue;
      tongueArticulation = motion.articulation;
      performanceState = {
        ...sanitizeSyrinxState({
          ...performanceState,
          ...motion.host,
          active: true,
        }, performanceState),
        active: true,
      };
    } else {
      performanceTongueState = tongueState;
      tongueArticulation = IDLE_TONGUE_ARTICULATION;
    }
    if (hostParameterModulators.length) {
      performanceState = modulateSyrinxState(
        performanceState,
        hostParameterModulators,
        elapsedSeconds,
      );
    }
    const tongueParameterModulators = parameterModulatorsFor("tongue");
    if (tongueParameterModulators.length) {
      performanceTongueState = modulateTongueState(
        performanceTongueState,
        tongueParameterModulators,
        elapsedSeconds,
      );
    }
  }
  updatePerformancePresentation(performanceState);

  if (audioDirty && time - lastConfigurationTime >= 26) {
    postConfiguration(performanceState);
    lastConfigurationTime = time;
    audioDirty = gesturePlaying || Boolean(tongueMotionId) || hasActiveParameterModulators();
  }
}

function updateHybrinxTimeline() {
  if (!hybrinxTimeline) return;
  hybrinxTimeline.update({
    gesture: activeGesture(),
    animalLabel: activeAnimal().label,
    baseState: state,
    performanceState,
    phase: gesturePhase,
    playing: gesturePlaying,
    loop: state.loop,
    gapRemainingMs: loopGapRemainingMs,
    gestureRate: state.gestureRate,
    loopGapMs: state.loopGapMs,
  });
}

function animate(time) {
  updatePerformance(time);
  updateHybrinxTimeline();
  renderStage(time);
  animationFrame = requestAnimationFrame(animate);
}

function installLifecycle() {
  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(stageWrap);
  globalThis.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (TONGUE_MODE) collapseViewportModulatorControls();
    if (TONGUE_MODE) {
      setViewportTonguePresetPaletteOpen(false, { pinned: false });
      if (viewportTonguePresets?.contains(document.activeElement)) document.activeElement.blur?.();
    }
    if (TONGUE_MODE) setTongueMotion("", { announceChange: false, startAudio: false });
    stopPerformance("All pressure released");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (TONGUE_MODE) setTongueMotion("", { announceChange: false, startAudio: false });
      stopPerformance("");
    }
  });
  globalThis.addEventListener("pagehide", () => {
    if (TONGUE_MODE) setTongueMotion("", { announceChange: false, startAudio: false });
    stopPerformance("");
    cancelAnimationFrame(animationFrame);
    graph?.releaseOutput?.();
    graph?.sourceNode?.disconnect?.();
    audioContext?.close?.().catch?.(() => {});
  }, { once: true });
}

installControlListeners();
installCanvasInteraction();
installLifecycle();
resizeCanvas();
updateAnimalPresentation();
updatePerformancePresentation(performanceState);
updateModulationPresentation(0);
updateHybrinxTimeline();
setAudioPresentation("off");
animationFrame = requestAnimationFrame(animate);
