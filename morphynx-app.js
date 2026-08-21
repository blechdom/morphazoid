import {
  ANIMALS,
  MODEL_LABELS,
  animalGroups,
  animalState,
  callsForAnimal,
  clamp,
  interpolateGesture,
  resolveGestureTimeline,
} from "./src/syrinx.js";
import {
  DEFAULT_MORPHYNX_STATE,
  MORPHYNX_ANATOMIES,
  MORPHYNX_HUMAN_BRANCH_TRIM,
  MORPHYNX_VOICE_PRESETS,
  morphynxConfiguration,
  morphynxFormants,
  morphynxKeyboardCommand,
  morphynxLevelMatchTrim,
  morphynxVoiceState,
} from "./src/morphynx.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const drawing = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const heldKeys = new Map();
const CONTROL_IDS = Object.freeze({
  pressure: "pressure",
  tension: "tension",
  adduction: "adduction",
  tractLengthM: "tractLength",
  mouthOpening: "mouthOpening",
  cavityCoupling: "cavityCoupling",
  asymmetry: "asymmetry",
  sourceBalance: "sourceBalance",
  roughness: "roughness",
});
const ANATOMY_IDS = Object.freeze({
  throatCount: "throatCount",
  tongueCount: "tongueCount",
  noseCount: "noseCount",
  mutation: "mutation",
  coupling: "coupling",
  growl: "growl",
});
const HANDLE_COLORS = Object.freeze({
  morph: "#ff4da8",
  tension: "#ff9c42",
  tractLengthM: "#61eee1",
  mouthOpening: "#ad78ff",
});

const state = {
  ...DEFAULT_MORPHYNX_STATE,
  animal: animalState(DEFAULT_MORPHYNX_STATE.animalId, {
    biologicalLock: false,
    loopGapMs: DEFAULT_MORPHYNX_STATE.loopGapMs,
  }),
  keyboardLatch: false,
  latchedVoice: false,
  anatomy: {
    throatCount: 1,
    tongueCount: 1,
    noseCount: 1,
    mutation: 0,
    coupling: 0,
    growl: 0,
  },
};

let audioContext = null;
let graph = null;
let startingAudio = false;
let audioOn = false;
let mediaStream = null;
let microphonePromise = null;
let gesturePlaying = false;
let gestureStartTime = 0;
let gesturePhase = 0;
let activePhonemeBeforeKeys = state.phoneme;
let recorder = null;
let recordedChunks = [];
let lastTakeUrl = "";
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let pointerHandle = null;
let handles = [];
let animationFrame = 0;
let lastAudioUpdate = Number.NEGATIVE_INFINITY;
let latestConfiguration = morphynxConfiguration({ animal: state.animal });
let humanBranchTrim = MORPHYNX_HUMAN_BRANCH_TRIM;
let levelMatchSamples = 0;
let levelMatchReady = false;
const branchTelemetry = {
  animal: { peak: 0, rms: 0, receivedAt: 0 },
  human: { peak: 0, rms: 0, receivedAt: 0 },
};
const waveform = new Float32Array(1_024);

const percent = (value) => `${Math.round(clamp(value) * 100)}%`;
const centimeters = (value) => `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)} cm`;
const selectionValue = () => state.anatomyId
  ? `anatomy:${state.anatomyId}`
  : `voice:${state.voicePreset}`;

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message = "") {
  const error = $("audioError");
  error.hidden = !message;
  error.textContent = message;
}

function resetBranchLevelMatch() {
  humanBranchTrim = MORPHYNX_HUMAN_BRANCH_TRIM;
  levelMatchSamples = 0;
  levelMatchReady = false;
  branchTelemetry.animal = { peak: 0, rms: 0, receivedAt: 0 };
  branchTelemetry.human = { peak: 0, rms: 0, receivedAt: 0 };
}

function reopenBranchLevelMatch() {
  levelMatchSamples = 0;
  levelMatchReady = false;
  branchTelemetry.animal.receivedAt = 0;
  branchTelemetry.human.receivedAt = 0;
}

function receiveBranchTelemetry(branch, message) {
  const meter = branchTelemetry[branch];
  if (!meter || message?.type !== "telemetry") return;
  meter.peak = Math.max(0, Number(message.peak) || 0);
  meter.rms = Math.max(0, Number(message.rms) || 0);
  meter.receivedAt = performance.now();
  if (!graph || !gateActive() || !latestConfiguration.human.levelMatchEligible) return;
  if (levelMatchReady && (state.morph === 0 || state.morph === 1)) return;
  if (latestConfiguration.source.pressure < 0.04) return;
  const animal = branchTelemetry.animal;
  const human = branchTelemetry.human;
  if (Math.abs(animal.receivedAt - human.receivedAt) > 180) return;
  if (animal.rms < 0.0005 || human.rms < 0.0005) return;
  const target = morphynxLevelMatchTrim(animal, human, humanBranchTrim);
  const response = target < humanBranchTrim ? 0.24 : 0.12;
  humanBranchTrim += (target - humanBranchTrim) * response;
  levelMatchSamples += 1;
  if (levelMatchSamples >= 24) levelMatchReady = true;
  const effectiveTrim = Math.max(
    humanBranchTrim,
    latestConfiguration.human.minimumLevelTrim,
  );
  const gain = Math.sin(state.morph * Math.PI * 0.5) * effectiveTrim;
  graph.humanMorphGain.gain.setTargetAtTime(gain, audioContext.currentTime, 0.1);
  if (levelMatchSamples === 24 && (state.morph === 0 || state.morph === 1)) {
    configureAudio(performance.now(), true);
  }
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function populateAnimalOptions() {
  const select = $("animalSelect");
  select.replaceChildren();
  for (const group of animalGroups()) {
    const container = document.createElement("optgroup");
    container.label = group.label;
    for (const animal of group.animals) container.append(option(animal.id, animal.label));
    select.append(container);
  }
  select.value = state.animalId;
}

function populateCallOptions() {
  const select = $("callSelect");
  select.replaceChildren(...callsForAnimal(state.animalId).map((call) => option(call.id, call.label)));
  if (!callsForAnimal(state.animalId).some(({ id }) => id === state.callId)) {
    state.callId = callsForAnimal(state.animalId)[0]?.id ?? "";
  }
  select.value = state.callId;
}

function populateVoiceOptions() {
  const select = $("voicePresetSelect");
  const voices = document.createElement("optgroup");
  voices.label = "Playable voices";
  for (const preset of MORPHYNX_VOICE_PRESETS) {
    voices.append(option(`voice:${preset.id}`, `${preset.label} · ${preset.description}`));
  }
  const anatomies = document.createElement("optgroup");
  anatomies.label = "Alien anatomies · keys 1–0";
  for (const anatomy of MORPHYNX_ANATOMIES) {
    anatomies.append(option(`anatomy:${anatomy.id}`, `${anatomy.label} · ${anatomy.description}`));
  }
  select.replaceChildren(voices, anatomies);
  select.value = selectionValue();
}

function baseVoice() {
  const voice = morphynxVoiceState({
    voicePreset: state.voicePreset,
    anatomyId: state.anatomyId,
    phoneme: state.phoneme,
    capitalLetter: state.capitalLetter,
  });
  const capital = Boolean(state.capitalLetter);
  for (const key of ["throatCount", "tongueCount", "noseCount"]) {
    voice[key] = capital
      ? Math.max(Number(voice[key]) || 1, state.anatomy[key])
      : state.anatomy[key];
  }
  for (const key of ["mutation", "coupling", "growl"]) {
    voice[key] = capital
      ? Math.max(Number(voice[key]) || 0, state.anatomy[key])
      : state.anatomy[key];
  }
  return voice;
}

function loadVoiceSelection(value, { announceChange = true } = {}) {
  const [kind, id] = String(value).split(":", 2);
  state.anatomyId = kind === "anatomy" ? id : "";
  state.voicePreset = kind === "voice" ? id : state.voicePreset;
  const voice = morphynxVoiceState({
    voicePreset: state.voicePreset,
    anatomyId: state.anatomyId,
    phoneme: "",
  });
  state.anatomy = {
    throatCount: Math.round(clamp(voice.throatCount ?? 1, 1, 7)),
    tongueCount: Math.round(clamp(voice.tongueCount ?? 1, 1, 5)),
    noseCount: Math.round(clamp(voice.noseCount ?? 1, 1, 3)),
    mutation: clamp(voice.mutation ?? 0),
    coupling: clamp(voice.coupling ?? 0),
    growl: clamp(voice.growl ?? 0),
  };
  resetBranchLevelMatch();
  syncAnatomyInputs();
  updateUi();
  configureAudio(performance.now(), true);
  if (announceChange) announce(`${voiceName()} loaded. Letter keys reshape this anatomy.`);
}

function voiceName() {
  if (state.anatomyId) {
    return MORPHYNX_ANATOMIES.find(({ id }) => id === state.anatomyId)?.label ?? "Alien anatomy";
  }
  return MORPHYNX_VOICE_PRESETS.find(({ id }) => id === state.voicePreset)?.label ?? "Voice";
}

function activeAnimal() {
  return ANIMALS[state.animalId] ?? ANIMALS.raven;
}

function activeCall() {
  return callsForAnimal(state.animalId).find(({ id }) => id === state.callId)
    ?? callsForAnimal(state.animalId)[0];
}

function gateActive() {
  return gesturePlaying || heldKeys.size > 0 || state.latchedVoice;
}

function motionValue(time) {
  if (!state.motionEnabled) return 0;
  return Math.sin(time * 0.0021) * state.motionDepth;
}

function performanceAnimal(time) {
  if (!gesturePlaying) return state.animal;
  const call = activeCall();
  if (!call) return state.animal;
  const duration = call.durationMs / state.gestureRate;
  const timeline = resolveGestureTimeline(
    time - gestureStartTime,
    duration,
    state.loop,
    state.loopGapMs,
  );
  if (timeline.complete) {
    gesturePlaying = false;
    gesturePhase = 1;
    updateUi();
    announce(`${call.label} complete`);
    return state.animal;
  }
  gesturePhase = timeline.phase;
  if (timeline.inGap) return { ...state.animal, active: false };
  return interpolateGesture(call, timeline.phase, {
    ...state.animal,
    biologicalLock: false,
  });
}

function sourceModeGains(active = gateActive()) {
  if (!active) return { internal: 0, mic: 0 };
  if (state.sourceMode === "mic") return { internal: 0, mic: 1 };
  if (state.sourceMode === "hybrid") return { internal: 0.72, mic: 0.68 };
  return { internal: 1, mic: 0 };
}

function setAudioPresentation(status = "off") {
  audioOn = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(audioOn));
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : audioOn ? "on" : "off";
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL("./src/syrinx-processor.js", import.meta.url));
  const configuration = morphynxConfiguration({
    animal: state.animal,
    voice: baseVoice(),
    morph: state.morph,
    active: false,
  });
  const createSourceNode = (source, tract, seed) => new AudioWorkletNode(
    context,
    "syrinx-physical-model",
    {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { configuration: { source, tract, seed } },
    },
  );
  const animalNode = createSourceNode(
    configuration.animalSource,
    configuration.animalTract,
    0x4d4f5250,
  );
  const humanNode = createSourceNode(
    configuration.humanSource,
    configuration.humanTract,
    0x4c415259,
  );
  const animalMorphGain = context.createGain();
  const humanMorphGain = context.createGain();
  const internalGain = context.createGain();
  const micGain = context.createGain();
  const mixBus = context.createGain();
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  const recordingDestination = context.createMediaStreamDestination();
  animalMorphGain.gain.value = configuration.mix.animalGain;
  humanMorphGain.gain.value = configuration.mix.humanGain;
  internalGain.gain.value = 0;
  micGain.gain.value = 0;
  masterGain.gain.value = state.level;
  compressor.threshold.value = -12;
  compressor.knee.value = 14;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  analyser.fftSize = 1_024;
  analyser.smoothingTimeConstant = 0.64;
  animalNode.connect(animalMorphGain).connect(internalGain);
  humanNode.connect(humanMorphGain).connect(internalGain);
  internalGain.connect(mixBus);
  micGain.connect(mixBus);
  mixBus.connect(masterGain).connect(compressor).connect(analyser);
  analyser.connect(recordingDestination);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  animalNode.port.onmessage = (event) => receiveBranchTelemetry("animal", event.data);
  humanNode.port.onmessage = (event) => receiveBranchTelemetry("human", event.data);
  for (const sourceNode of [animalNode, humanNode]) {
    sourceNode.onprocessorerror = () => showError("A Morphynx physical-model branch stopped. Reload to reset it.");
  }
  return {
    context,
    animalNode,
    humanNode,
    animalMorphGain,
    humanMorphGain,
    internalGain,
    micGain,
    mixBus,
    masterGain,
    compressor,
    analyser,
    recordingDestination,
    releaseOutput,
    micSource: null,
    micFilters: [],
  };
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
      showError(error?.message || "Unable to start Morphynx audio.");
      setAudioPresentation("off");
      startingAudio = false;
      return false;
    }
    startingAudio = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    setAudioPresentation("on");
    showError("");
    if (state.sourceMode !== "internal") await ensureMicrophone();
    configureAudio(performance.now(), true);
    return true;
  } catch (error) {
    console.error(error);
    showError(error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (!graph || audioContext?.state === "closed") {
    await ensureAudio();
    return;
  }
  if (audioContext.state === "running") {
    await audioContext.suspend();
    setAudioPresentation("off");
    announce("Morphynx audio suspended");
  } else {
    await ensureAudio();
    announce("Morphynx audio ready");
  }
}

async function ensureMicrophone() {
  if (graph?.micSource && mediaStream?.active) return true;
  if (microphonePromise) return microphonePromise;
  microphonePromise = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone input is unavailable in this browser.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    mediaStream = stream;
    const source = audioContext.createMediaStreamSource(stream);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 52;
    highpass.Q.value = 0.7;
    const filters = [0, 1, 2].map((index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = "peaking";
      filter.Q.value = 2.4 + index * 0.55;
      filter.gain.value = 7 - index * 1.5;
      return filter;
    });
    source.connect(highpass);
    highpass.connect(filters[0]);
    filters[0].connect(filters[1]);
    filters[1].connect(filters[2]);
    filters[2].connect(graph.micGain);
    graph.micSource = source;
    graph.micFilters = filters;
    configureAudio(performance.now(), true);
    return true;
  })().catch((error) => {
    showError(error?.name === "NotAllowedError"
      ? "Microphone permission was denied. Choose Internal to keep playing."
      : error?.message || "Microphone input could not start.");
    setSourceMode("internal", { requestMicrophone: false });
    return false;
  }).finally(() => {
    microphonePromise = null;
  });
  return microphonePromise;
}

function configureAudio(time = performance.now(), immediate = false) {
  const performance = performanceAnimal(time);
  const active = gesturePlaying
    ? gateActive() && performance.active !== false
    : gateActive();
  latestConfiguration = morphynxConfiguration({
    animal: performance,
    voice: baseVoice(),
    morph: state.morph,
    active,
    motion: motionValue(time),
    humanTrim: humanBranchTrim,
    calibrateEndpoints: !levelMatchReady,
  });
  if (!graph || (!immediate && time - lastAudioUpdate < 28)) return;
  lastAudioUpdate = time;
  graph.animalNode.port.postMessage({
    type: "configure",
    source: latestConfiguration.animalSource,
    tract: latestConfiguration.animalTract,
  });
  graph.humanNode.port.postMessage({
    type: "configure",
    source: latestConfiguration.humanSource,
    tract: latestConfiguration.humanTract,
  });
  const now = audioContext.currentTime;
  const gains = sourceModeGains(active);
  graph.animalMorphGain.gain.setTargetAtTime(
    latestConfiguration.mix.animalGain,
    now,
    0.032,
  );
  graph.humanMorphGain.gain.setTargetAtTime(
    latestConfiguration.mix.humanGain,
    now,
    0.032,
  );
  graph.internalGain.gain.setTargetAtTime(gains.internal, now, 0.018);
  graph.micGain.gain.setTargetAtTime(gains.mic, now, 0.018);
  graph.masterGain.gain.setTargetAtTime(state.level, now, 0.025);
  const formants = morphynxFormants(state.phoneme, baseVoice());
  graph.micFilters.forEach((filter, index) => {
    filter.frequency.setTargetAtTime(formants.frequencies[index], now, 0.025);
    filter.gain.setTargetAtTime((7 - index * 1.5) * (0.45 + state.morph * 0.75), now, 0.025);
  });
}

function setSourceMode(mode, { requestMicrophone = true } = {}) {
  state.sourceMode = ["internal", "mic", "hybrid"].includes(mode) ? mode : "internal";
  if (requestMicrophone && state.sourceMode !== "internal") void ensureAudio();
  updateUi();
  configureAudio(performance.now(), true);
  announce(`${state.sourceMode === "internal" ? "Internal physical model" : state.sourceMode === "mic" ? "Microphone tract" : "Hybrid source"} selected`);
}

async function playGesture() {
  if (gesturePlaying) {
    gesturePlaying = false;
    configureAudio(performance.now(), true);
    updateUi();
    announce("Call released");
    return;
  }
  if (!await ensureAudio()) return;
  gesturePlaying = true;
  gestureStartTime = performance.now();
  gesturePhase = 0;
  updateUi();
  configureAudio(gestureStartTime, true);
  announce(`${activeAnimal().label} ${activeCall()?.label ?? "call"} entered the Morphynx tract`);
}

function stopAll(message = "All pressure released") {
  gesturePlaying = false;
  state.latchedVoice = false;
  heldKeys.clear();
  state.capitalLetter = "";
  syncPhonemeButtons();
  configureAudio(performance.now(), true);
  updateUi();
  if (message) announce(message);
}

function recorderMimeType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (globalThis.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return "";
}

async function toggleRecording() {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  if (!globalThis.MediaRecorder) {
    showError("Recording is unavailable in this browser.");
    return;
  }
  if (!await ensureAudio()) return;
  recordedChunks = [];
  const mimeType = recorderMimeType();
  recorder = new MediaRecorder(graph.recordingDestination.stream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) recordedChunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
    if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
    lastTakeUrl = URL.createObjectURL(blob);
    $("downloadTake").href = lastTakeUrl;
    $("downloadTake").download = `morphynx-${new Date().toISOString().replaceAll(":", "-")}.webm`;
    $("downloadTake").hidden = false;
    document.body.classList.remove("is-recording");
    $("recordButton").setAttribute("aria-pressed", "false");
    $("recordState").textContent = "saved";
    announce("Morphynx take ready to download");
  });
  recorder.start(250);
  document.body.classList.add("is-recording");
  $("recordButton").setAttribute("aria-pressed", "true");
  $("recordState").textContent = "recording";
  announce("Recording Morphynx output");
}

function loadAnimal(animalId) {
  const previousLevel = state.level;
  state.animalId = ANIMALS[animalId] ? animalId : "raven";
  state.animal = animalState(state.animalId, {
    biologicalLock: false,
    level: previousLevel,
    gestureRate: state.gestureRate,
    loopGapMs: state.loopGapMs,
  });
  resetBranchLevelMatch();
  state.callId = state.animal.callId;
  populateCallOptions();
  syncAnimalInputs();
  if (gesturePlaying) gestureStartTime = performance.now();
  configureAudio(performance.now(), true);
  updateUi();
  announce(`${activeAnimal().label} loaded as the animal anchor`);
}

function loadCall(callId) {
  if (!callsForAnimal(state.animalId).some(({ id }) => id === callId)) return;
  state.callId = callId;
  state.animal = { ...state.animal, callId };
  if (gesturePlaying) gestureStartTime = performance.now();
  updateUi();
  configureAudio(performance.now(), true);
  announce(`${activeCall()?.label ?? "Call"} selected`);
}

function syncAnimalInputs() {
  for (const [key, id] of Object.entries(CONTROL_IDS)) $(id).value = String(state.animal[key]);
}

function syncAnatomyInputs() {
  for (const [key, id] of Object.entries(ANATOMY_IDS)) $(id).value = String(state.anatomy[key]);
}

function updateRange(input) {
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const value = Number(input.value) || 0;
  input.style.setProperty("--range-fill", `${clamp((value - minimum) / (maximum - minimum)) * 100}%`);
}

function balanceLabel(value) {
  if (Math.abs(value - 0.5) < 0.025) return "center";
  return `${Math.round(Math.abs(value - 0.5) * 200)}% ${value < 0.5 ? "left" : "right"}`;
}

function updateUi() {
  const voice = baseVoice();
  const call = activeCall();
  const active = gateActive();
  $("animalSelect").value = state.animalId;
  $("callSelect").value = state.callId;
  $("voicePresetSelect").value = selectionValue();
  $("morphAmount").value = String(state.morph);
  $("morphAmountOut").textContent = `${Math.round(state.morph * 100)}% larynx`;
  $("morphSummary").textContent = state.sourceMode === "mic"
    ? "The morph retunes the live microphone formants; physical topology is bypassed."
    : `${activeAnimal().apparatus} and ${voice.throatCount} ${voice.throatCount === 1 ? "laryngeal voice" : "detuned laryngeal voices"} crossfade without swapping models.`;
  $("stageMorphMarker").style.left = `${state.morph * 100}%`;
  $("modelReadout").textContent = state.morph <= 0.01
    ? MODEL_LABELS[latestConfiguration.animalSource.model] ?? latestConfiguration.animalSource.model
    : state.morph >= 0.99
      ? "Two-mass larynx"
      : `${MODEL_LABELS[latestConfiguration.animalSource.model] ?? "Animal source"} ↔ two-mass larynx`;
  $("voiceReadout").textContent = `${voiceName()} · ${state.phoneme.toUpperCase()}${state.capitalLetter ? "+" : ""}`;
  $("tractReadout").textContent = state.morph <= 0.01
    ? centimeters(latestConfiguration.animalTract.tractLengthM)
    : state.morph >= 0.99
      ? centimeters(latestConfiguration.humanTract.tractLengthM)
      : `${centimeters(latestConfiguration.animalTract.tractLengthM)} ↔ ${centimeters(latestConfiguration.humanTract.tractLengthM)}`;
  $("pressureReadout").textContent = active ? `${percent(latestConfiguration.source.pressure)} open` : "resting";
  $("sourceSummary").textContent = `pressure ${percent(state.animal.pressure)} · tension ${percent(state.animal.tension)}`;
  $("playLabel").textContent = `${gesturePlaying ? "Release" : "Play"} ${call?.label?.toLowerCase() ?? "call"}`;
  $("playState").textContent = gesturePlaying ? `${Math.round(gesturePhase * 100)}%` : "ready";
  $("playButton").setAttribute("aria-pressed", String(gesturePlaying));
  $("loopButton").setAttribute("aria-pressed", String(state.loop));
  $("loopState").textContent = state.loop ? "on" : "off";
  $("keyboardLatch").setAttribute("aria-pressed", String(state.keyboardLatch));
  $("keyboardLatch").querySelector("small").textContent = state.keyboardLatch
    ? "on · last letter sustains"
    : "off · release closes the gate";
  $("keyboardState").textContent = state.latchedVoice
    ? `${state.phoneme.toUpperCase()} latched · Escape releases`
    : "A–Z hold · Shift mutates";
  $("motionEnabled").setAttribute("aria-pressed", String(state.motionEnabled));
  $("motionEnabled").querySelector("small").textContent = state.motionEnabled ? "on" : "off";
  $("anatomySummary").textContent = `${voice.throatCount} ${voice.throatCount === 1 ? "voice" : "voices"} · ${voice.tongueCount} ${voice.tongueCount === 1 ? "tongue" : "tongues"} · ${voice.noseCount} ${voice.noseCount === 1 ? "cavity" : "cavities"}`;
  $("gestureSummary").textContent = `${state.gestureRate.toFixed(2)}× · ${(state.loopGapMs / 1_000).toFixed(2)} s gap`;
  $("levelOut").textContent = percent(state.level);
  $("pressureOut").textContent = percent(state.animal.pressure);
  $("tensionOut").textContent = percent(state.animal.tension);
  $("adductionOut").textContent = percent(state.animal.adduction);
  $("tractLengthOut").textContent = centimeters(state.animal.tractLengthM);
  $("mouthOpeningOut").textContent = percent(state.animal.mouthOpening);
  $("cavityCouplingOut").textContent = percent(state.animal.cavityCoupling);
  $("asymmetryOut").textContent = percent(state.animal.asymmetry);
  $("sourceBalanceOut").textContent = balanceLabel(state.animal.sourceBalance);
  $("roughnessOut").textContent = percent(state.animal.roughness);
  $("throatCountOut").textContent = String(state.anatomy.throatCount);
  $("tongueCountOut").textContent = String(state.anatomy.tongueCount);
  $("noseCountOut").textContent = String(state.anatomy.noseCount);
  $("mutationOut").textContent = percent(state.anatomy.mutation);
  $("couplingOut").textContent = percent(state.anatomy.coupling);
  $("growlOut").textContent = percent(state.anatomy.growl);
  $("motionDepthOut").textContent = percent(state.motionDepth);
  $("gestureRateOut").textContent = `${state.gestureRate.toFixed(2)}×`;
  $("loopGapOut").textContent = state.loopGapMs === 0 ? "continuous" : `${(state.loopGapMs / 1_000).toFixed(2)} s`;
  for (const button of $("sourceButtons").querySelectorAll("[data-source]")) {
    button.setAttribute("aria-pressed", String(button.dataset.source === state.sourceMode));
  }
  const physicalControlsAudible = state.sourceMode !== "mic";
  for (const id of [...Object.values(CONTROL_IDS), ...Object.values(ANATOMY_IDS)]) {
    $(id).disabled = !physicalControlsAudible;
  }
  $("motionEnabled").disabled = !physicalControlsAudible;
  $("motionDepth").disabled = !physicalControlsAudible;
  $("physicalModeNote").textContent = physicalControlsAudible
    ? "These controls reshape both physical engines, so they remain audible across the full morph."
    : "Mic mode bypasses the physical engines; choose Internal or Hybrid to use these controls.";
  $("anatomyModeNote").textContent = physicalControlsAudible
    ? "Larynx voices add detuned physical sources; every tongue adds a tract constriction; each nasal cavity adds another resonance mode. Their influence grows toward the larynx end."
    : "Mic mode keeps the live formant filter only; choose Internal or Hybrid to hear anatomy topology.";
  for (const input of document.querySelectorAll('input[type="range"]')) updateRange(input);
  document.body.classList.toggle("is-sounding", active);
  syncPhonemeButtons();
}

function protectedTarget(target) {
  if (target?.isContentEditable) return true;
  return Boolean(target?.closest?.('input:not([type="range"]), select, textarea, [role="textbox"], [contenteditable="true"]'));
}

function keyIdentity(event, command) {
  return event.code || `key:${command.phoneme}`;
}

async function beginPhoneme(command, identity, capital = false) {
  if (!command || command.type !== "phoneme" || heldKeys.has(identity)) return;
  if (heldKeys.size === 0 && !state.latchedVoice) activePhonemeBeforeKeys = state.phoneme;
  heldKeys.set(identity, { ...command, identity, capital });
  state.phoneme = command.phoneme;
  state.capitalLetter = capital ? command.letter : "";
  if (baseVoice().articulationManner === "vowel") {
    reopenBranchLevelMatch();
  }
  if (state.keyboardLatch) state.latchedVoice = true;
  updateUi();
  await ensureAudio();
  configureAudio(performance.now(), true);
  announce(`${capital ? "SHIFT+" : ""}${command.letter?.toUpperCase() || "ʔ"} ${capital ? "mutation" : "articulation"} ${state.keyboardLatch ? "latched" : "held"}`);
}

function endPhoneme(identity) {
  const entry = heldKeys.get(identity);
  if (!entry) return;
  heldKeys.delete(identity);
  const remaining = [...heldKeys.values()].at(-1);
  if (remaining) {
    state.phoneme = remaining.phoneme;
    state.capitalLetter = remaining.capital ? remaining.letter : "";
  } else if (!state.keyboardLatch) {
    state.phoneme = activePhonemeBeforeKeys;
    state.capitalLetter = "";
  }
  if (baseVoice().articulationManner === "vowel") {
    reopenBranchLevelMatch();
  }
  updateUi();
  configureAudio(performance.now(), true);
}

function loadAnatomyShortcut(command) {
  if (!command || command.type !== "anatomy") return;
  loadVoiceSelection(`anatomy:${command.id}`, { announceChange: false });
  announce(`${command.name} anatomy loaded from the number row`);
}

function syncPhonemeButtons() {
  for (const button of $("phonemeButtons").querySelectorAll("[data-phoneme]")) {
    const held = [...heldKeys.values()].some(({ phoneme }) => phoneme === button.dataset.phoneme);
    const latched = state.latchedVoice && state.phoneme === button.dataset.phoneme;
    button.setAttribute("aria-pressed", String(held || latched));
    button.classList.toggle("is-capital", Boolean((held || latched) && state.capitalLetter));
  }
}

function installPhonemeButtons() {
  const fragment = document.createDocumentFragment();
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const command = morphynxKeyboardCommand(letter);
    const button = document.createElement("button");
    button.className = "morphynx-phoneme-key";
    button.type = "button";
    button.textContent = letter;
    button.dataset.phoneme = command.phoneme;
    button.setAttribute("aria-label", `${letter} articulation`);
    button.setAttribute("aria-pressed", "false");
    const identity = `pointer:${letter}`;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      void beginPhoneme(command, identity, event.shiftKey);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, () => endPhoneme(identity));
    }
    fragment.append(button);
  }
  $("phonemeButtons").replaceChildren(fragment);
}

function installKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || protectedTarget(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stopAll();
      return;
    }
    const command = morphynxKeyboardCommand(event.key, event.code);
    if (!command) return;
    event.preventDefault();
    if (event.repeat) return;
    if (command.type === "anatomy") {
      loadAnatomyShortcut(command);
      return;
    }
    void beginPhoneme(command, keyIdentity(event, command), event.shiftKey);
  });
  document.addEventListener("keyup", (event) => {
    const command = morphynxKeyboardCommand(event.key, event.code);
    if (command?.type !== "phoneme") return;
    const identity = keyIdentity(event, command);
    if (!heldKeys.has(identity)) return;
    event.preventDefault();
    endPhoneme(identity);
  });
  globalThis.addEventListener("blur", () => {
    for (const identity of [...heldKeys.keys()]) endPhoneme(identity);
  });
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", playGesture);
  $("loopButton").addEventListener("click", () => {
    state.loop = !state.loop;
    updateUi();
    announce(`Call loop ${state.loop ? "on" : "off"}`);
  });
  $("recordButton").addEventListener("click", toggleRecording);
  $("animalSelect").addEventListener("change", (event) => loadAnimal(event.currentTarget.value));
  $("callSelect").addEventListener("change", (event) => loadCall(event.currentTarget.value));
  $("voicePresetSelect").addEventListener("change", (event) => loadVoiceSelection(event.currentTarget.value));
  $("morphAmount").addEventListener("input", (event) => {
    state.morph = clamp(Number(event.currentTarget.value));
    updateUi();
    configureAudio(performance.now(), true);
  });
  $("morphAmount").addEventListener("change", () => announce(`Morph set to ${Math.round(state.morph * 100)} percent larynx`));
  for (const button of $("sourceButtons").querySelectorAll("[data-source]")) {
    button.addEventListener("click", () => setSourceMode(button.dataset.source));
  }
  for (const [key, id] of Object.entries(CONTROL_IDS)) {
    $(id).addEventListener("input", (event) => {
      state.animal = { ...state.animal, [key]: Number(event.currentTarget.value) };
      reopenBranchLevelMatch();
      updateUi();
      configureAudio(performance.now(), true);
    });
  }
  for (const [key, id] of Object.entries(ANATOMY_IDS)) {
    $(id).addEventListener("input", (event) => {
      const integer = ["throatCount", "tongueCount", "noseCount"].includes(key);
      state.anatomy[key] = integer
        ? Math.round(Number(event.currentTarget.value))
        : clamp(Number(event.currentTarget.value));
      reopenBranchLevelMatch();
      updateUi();
      configureAudio(performance.now(), true);
    });
  }
  $("level").addEventListener("input", (event) => {
    state.level = clamp(Number(event.currentTarget.value));
    updateUi();
    configureAudio(performance.now(), true);
  });
  $("gestureRate").addEventListener("input", (event) => {
    state.gestureRate = clamp(Number(event.currentTarget.value), 0.25, 2.5);
    updateUi();
  });
  $("loopGap").addEventListener("input", (event) => {
    state.loopGapMs = clamp(Number(event.currentTarget.value), 0, 8_000);
    updateUi();
  });
  $("motionDepth").addEventListener("input", (event) => {
    state.motionDepth = clamp(Number(event.currentTarget.value));
    updateUi();
  });
  $("keyboardLatch").addEventListener("click", () => {
    state.keyboardLatch = !state.keyboardLatch;
    if (!state.keyboardLatch) state.latchedVoice = false;
    updateUi();
    configureAudio(performance.now(), true);
    announce(`Type latch ${state.keyboardLatch ? "armed" : "off"}`);
  });
  $("motionEnabled").addEventListener("click", () => {
    state.motionEnabled = !state.motionEnabled;
    updateUi();
    announce(`Anatomy motion ${state.motionEnabled ? "on" : "off"}`);
  });
  document.querySelector("[data-reset-all]").addEventListener("click", resetAll);
}

function resetAll() {
  stopAll("");
  Object.assign(state, {
    ...DEFAULT_MORPHYNX_STATE,
    animal: animalState(DEFAULT_MORPHYNX_STATE.animalId, {
      biologicalLock: false,
      loopGapMs: DEFAULT_MORPHYNX_STATE.loopGapMs,
    }),
    keyboardLatch: false,
    latchedVoice: false,
  });
  state.anatomy = {
    throatCount: 1,
    tongueCount: 1,
    noseCount: 1,
    mutation: 0,
    coupling: 0,
    growl: 0,
  };
  resetBranchLevelMatch();
  populateAnimalOptions();
  populateCallOptions();
  populateVoiceOptions();
  syncAnimalInputs();
  syncAnatomyInputs();
  $("gestureRate").value = String(state.gestureRate);
  $("loopGap").value = String(state.loopGapMs);
  $("motionDepth").value = String(state.motionDepth);
  $("level").value = String(state.level);
  updateUi();
  configureAudio(performance.now(), true);
  announce("Morphynx restored to Raven × Playable default");
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixels = cssWidth * cssHeight * pixelRatio * pixelRatio;
  if (pixels > 2_800_000) pixelRatio *= Math.sqrt(2_800_000 / pixels);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function roundedRect(x, y, width, height, radius) {
  drawing.beginPath();
  drawing.roundRect(x, y, width, height, radius);
}

function traceTube(points, color, width, glow = 0) {
  drawing.save();
  drawing.lineCap = "round";
  drawing.lineJoin = "round";
  drawing.beginPath();
  points.forEach(([x, y], index) => index ? drawing.lineTo(x, y) : drawing.moveTo(x, y));
  drawing.strokeStyle = "rgba(0, 0, 0, 0.9)";
  drawing.lineWidth = width + 8;
  drawing.stroke();
  drawing.strokeStyle = color;
  drawing.shadowBlur = glow;
  drawing.shadowColor = color;
  drawing.lineWidth = width;
  drawing.stroke();
  drawing.restore();
}

function drawWaveform(x, y, width, height, time) {
  if (graph?.analyser && audioOn) graph.analyser.getFloatTimeDomainData(waveform);
  drawing.save();
  roundedRect(x, y, width, height, Math.min(width, height) * 0.18);
  drawing.fillStyle = "rgba(0, 0, 0, 0.86)";
  drawing.fill();
  drawing.strokeStyle = "rgba(202, 255, 73, 0.26)";
  drawing.lineWidth = 1;
  drawing.stroke();
  drawing.beginPath();
  for (let index = 0; index < 96; index += 1) {
    const sample = audioOn
      ? waveform[Math.floor(index / 95 * (waveform.length - 1))]
      : Math.sin(index * 0.42 + time * 0.004) * 0.08;
    const px = x + index / 95 * width;
    const py = y + height * 0.5 + sample * height * 0.42;
    index ? drawing.lineTo(px, py) : drawing.moveTo(px, py);
  }
  drawing.strokeStyle = "#caff49";
  drawing.shadowBlur = 12;
  drawing.shadowColor = "#caff49";
  drawing.lineWidth = 2;
  drawing.stroke();
  drawing.restore();
}

function drawHandle(type, x, y, label) {
  const color = HANDLE_COLORS[type];
  drawing.save();
  drawing.beginPath();
  drawing.arc(x, y, 9, 0, Math.PI * 2);
  drawing.fillStyle = "#050307";
  drawing.fill();
  drawing.strokeStyle = color;
  drawing.shadowBlur = gateActive() ? 14 : 7;
  drawing.shadowColor = color;
  drawing.lineWidth = 3;
  drawing.stroke();
  drawing.fillStyle = "rgba(255, 255, 255, 0.62)";
  drawing.font = "700 7px monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, x, y + 23);
  drawing.restore();
  handles.push({ type, x, y, label });
}

function drawStage(time) {
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  handles = [];
  const width = cssWidth;
  const height = cssHeight;
  const scale = Math.min(width / 980, height / 680);
  const centerY = height * 0.57;
  const active = gateActive();
  const pulse = active ? 1 + Math.sin(time * 0.012) * 0.045 : 1;
  const voice = baseVoice();
  const branchCount = Math.min(7, Math.max(1, voice.throatCount));
  const animalBlend = 1 - state.morph;
  const sourceX = width * 0.28;
  const sourceY = centerY;
  const chamberRadius = Math.max(42, 72 * scale) * pulse;

  drawing.save();
  drawing.globalAlpha = 0.42 + animalBlend * 0.42;
  drawing.fillStyle = "rgba(97, 238, 225, 0.14)";
  drawing.strokeStyle = "#61eee1";
  drawing.lineWidth = Math.max(3, 5 * scale);
  for (const side of [-1, 1]) {
    drawing.beginPath();
    drawing.ellipse(sourceX - 72 * scale, centerY + side * 54 * scale, 48 * scale, 68 * scale * pulse, side * 0.12, 0, Math.PI * 2);
    drawing.fill();
    drawing.stroke();
  }
  drawing.restore();

  drawing.save();
  drawing.beginPath();
  drawing.arc(sourceX, sourceY, chamberRadius, 0, Math.PI * 2);
  drawing.fillStyle = "rgba(255, 77, 168, 0.16)";
  drawing.fill();
  drawing.strokeStyle = "#ff4da8";
  drawing.shadowBlur = active ? 25 : 10;
  drawing.shadowColor = "#ff4da8";
  drawing.lineWidth = Math.max(4, 7 * scale);
  drawing.stroke();
  drawing.restore();
  drawWaveform(sourceX - chamberRadius * 0.68, sourceY - chamberRadius * 0.3, chamberRadius * 1.36, chamberRadius * 0.6, time);

  const tractStartX = sourceX + chamberRadius * 0.78;
  const tractEndX = width * (0.72 + state.morph * 0.1);
  const spread = Math.min(height * 0.36, 260 * scale);
  for (let index = 0; index < branchCount; index += 1) {
    const unit = branchCount === 1 ? 0 : index / (branchCount - 1) - 0.5;
    const endY = centerY + unit * spread;
    const motion = state.motionEnabled
      ? Math.sin(time * 0.0018 + index * 1.37) * 18 * state.motionDepth
      : 0;
    const color = ["#ff4da8", "#ff9c42", "#ad78ff", "#caff49", "#61eee1"][index % 5];
    const points = [
      [tractStartX, centerY + unit * chamberRadius * 0.3],
      [width * 0.46, centerY + unit * spread * 0.28 - motion],
      [width * 0.59, centerY + unit * spread * 0.65 + motion],
      [tractEndX, endY],
    ];
    traceTube(points, color, Math.max(9, (20 - branchCount * 0.8) * scale), active ? 10 : 3);
    drawing.save();
    drawing.beginPath();
    drawing.ellipse(tractEndX + 12 * scale, endY, 24 * scale, (11 + latestConfiguration.tract.mouthOpening * 15) * scale, 0, 0, Math.PI * 2);
    drawing.fillStyle = "#050307";
    drawing.fill();
    drawing.strokeStyle = color;
    drawing.lineWidth = 6 * scale;
    drawing.stroke();
    drawing.restore();
  }

  const noseCount = Math.min(3, Math.max(1, voice.noseCount));
  for (let index = 0; index < noseCount; index += 1) {
    const y = centerY - chamberRadius * 0.65 - index * 18 * scale;
    traceTube([
      [sourceX + chamberRadius * 0.15, centerY - chamberRadius * 0.55],
      [sourceX + chamberRadius * 0.5 + index * 10 * scale, y - 30 * scale],
    ], "#61eee1", 5 * scale, 2);
  }

  drawing.save();
  drawing.globalAlpha = 0.34 + state.morph * 0.28;
  drawing.strokeStyle = "rgba(255, 255, 255, 0.68)";
  drawing.lineWidth = Math.max(2, 3 * scale);
  drawing.setLineDash([6, 8]);
  drawing.beginPath();
  drawing.moveTo(sourceX - 150 * scale, centerY - 130 * scale);
  drawing.quadraticCurveTo(sourceX + 30 * scale, centerY - 220 * scale, tractEndX + 62 * scale, centerY - spread * 0.62);
  drawing.stroke();
  drawing.restore();

  const morphX = width * (0.18 + state.morph * 0.64);
  drawHandle("morph", morphX, height * 0.2, "MORPH");
  drawHandle("tension", sourceX, sourceY - chamberRadius - 22 * scale, "TENSION");
  const lengthUnit = clamp((state.animal.tractLengthM - 0.018) / (0.82 - 0.018));
  drawHandle("tractLengthM", width * (0.4 + lengthUnit * 0.36), centerY + spread * 0.62, "TRACT");
  drawHandle("mouthOpening", tractEndX + 12 * scale, centerY - latestConfiguration.tract.mouthOpening * 70 * scale, "MOUTH");
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function nearestHandle(point) {
  let match = null;
  let distance = 32;
  for (const handle of handles) {
    const next = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (next < distance) {
      match = handle;
      distance = next;
    }
  }
  return match;
}

function dragHandle(handle, point) {
  if (handle.type === "morph") {
    state.morph = clamp((point.x / cssWidth - 0.18) / 0.64);
    $("morphAmount").value = String(state.morph);
  } else if (handle.type === "tension") {
    state.animal = { ...state.animal, tension: clamp(1 - point.y / cssHeight) };
    $("tension").value = String(state.animal.tension);
  } else if (handle.type === "tractLengthM") {
    const unit = clamp((point.x / cssWidth - 0.4) / 0.36);
    state.animal = { ...state.animal, tractLengthM: 0.018 + unit * (0.82 - 0.018) };
    $("tractLength").value = String(state.animal.tractLengthM);
  } else if (handle.type === "mouthOpening") {
    state.animal = { ...state.animal, mouthOpening: clamp(1 - point.y / cssHeight) };
    $("mouthOpening").value = String(state.animal.mouthOpening);
  }
  updateUi();
  configureAudio(performance.now(), true);
}

function installCanvas() {
  canvas.addEventListener("pointerdown", (event) => {
    const handle = nearestHandle(canvasPoint(event));
    if (!handle) return;
    event.preventDefault();
    pointerHandle = handle;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    dragHandle(handle, canvasPoint(event));
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerHandle) return;
    event.preventDefault();
    dragHandle(pointerHandle, canvasPoint(event));
  });
  const release = () => {
    if (pointerHandle) announce(`${pointerHandle.label.toLowerCase()} set`);
    pointerHandle = null;
    canvas.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("keydown", (event) => {
    let key = "";
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
    const step = key === "tractLengthM" ? 0.012 : 0.025;
    const minimum = key === "tractLengthM" ? 0.018 : 0;
    const maximum = key === "tractLengthM" ? 0.82 : 1;
    state.animal = { ...state.animal, [key]: clamp(state.animal[key] + direction * step, minimum, maximum) };
    $(CONTROL_IDS[key]).value = String(state.animal[key]);
    updateUi();
    configureAudio(performance.now(), true);
  });
}

function animate(time) {
  configureAudio(time);
  if (graph?.analyser && audioOn) graph.analyser.getFloatTimeDomainData(waveform);
  drawStage(time);
  if (gesturePlaying) updateUi();
  animationFrame = requestAnimationFrame(animate);
}

function installLifecycle() {
  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(stageWrap);
  globalThis.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAll("");
  });
  globalThis.addEventListener("pagehide", () => {
    stopAll("");
    if (recorder?.state === "recording") recorder.stop();
    mediaStream?.getTracks?.().forEach((track) => track.stop());
    cancelAnimationFrame(animationFrame);
    graph?.releaseOutput?.();
    graph?.animalNode?.disconnect?.();
    graph?.humanNode?.disconnect?.();
    audioContext?.close?.().catch?.(() => {});
    if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
  }, { once: true });
}

populateAnimalOptions();
populateCallOptions();
populateVoiceOptions();
installPhonemeButtons();
installControls();
installKeyboard();
installCanvas();
installLifecycle();
syncAnimalInputs();
syncAnatomyInputs();
setAudioPresentation("off");
updateUi();
resizeCanvas();
animationFrame = requestAnimationFrame(animate);
