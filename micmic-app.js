import {
  FIXED_FORK_DENSITY,
  MICMIC_PRESETS,
  GENERATION_RULE_PRESETS,
  MAX_GENERATION_STAGES,
  clamp,
  generationTopology,
  generationVoiceSpecs,
  recorderExtension,
  recursionParameters,
} from "./src/micmic.js?v=20260724-full-forks";
import { SignalsmithGenerationBank } from "./src/signalsmith-generation-bank.js?v=20260723-safe-grammar";

const $ = (id) => document.getElementById(id);
const GENERATION_COLORS = ["#fff3d6", "#55d9ff", "#5fe8c4", "#7db4ff", "#c79bff", "#ff826f", "#e8c46b"];
const REDUCED_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const DEFAULT_STATE = Object.freeze({
  ...MICMIC_PRESETS.bloom,
  inputTrim: 0.85,
  level: 0.58,
  mic: false,
  starting: false,
  frozen: false,
  recording: false,
  generations: GENERATION_RULE_PRESETS.pythagorean.generations,
  branching: FIXED_FORK_DENSITY,
  depth: GENERATION_RULE_PRESETS.pythagorean.depth,
  interval: GENERATION_RULE_PRESETS.pythagorean.interval,
  mutation: GENERATION_RULE_PRESETS.pythagorean.mutation,
  generationPreset: "pythagorean",
  timeRatio: GENERATION_RULE_PRESETS.pythagorean.timeRatio,
  generationAngle: GENERATION_RULE_PRESETS.pythagorean.angle,
  generationAsymmetry: GENERATION_RULE_PRESETS.pythagorean.asymmetry,
  generationPitchScale: GENERATION_RULE_PRESETS.pythagorean.pitchScale,
});

const state = { ...DEFAULT_STATE };
const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let audioContext = null;
let graph = null;
let mediaStream = null;
let microphoneSource = null;
let microphoneGeneration = 0;
let audioChanging = false;
let recorder = null;
let recordingStartedAt = 0;
let recordingMimeType = "";
let lastTakeUrl = "";
let lastTakeDuration = 0;
let lastTakeMimeType = "";
let inputWave = new Float32Array(1024);
let safetyWave = new Float32Array(512);
let inputPeakHold = 0;
let hotSince = 0;
let lastUiMeterUpdate = 0;
let lastFrameTime = performance.now();
let generationVisualModel = null;
let generationTopologyCache = null;
let stageGeometryCache = null;
let lastGenerationPreset = DEFAULT_STATE.generationPreset;
let currentInputEnvelope = 0;
let lastEnvelopeUpdateTime = null;
let envelopeHistoryHead = 0;
let envelopeHistoryLength = 0;
const ENVELOPE_HISTORY_SECONDS = 32;
const ENVELOPE_HISTORY_CAPACITY = 65_536;
const envelopeHistoryTimes = new Float64Array(ENVELOPE_HISTORY_CAPACITY);
const envelopeHistoryValues = new Float32Array(ENVELOPE_HISTORY_CAPACITY);

function signed(value, suffix = "") {
  const rounded = Number(Number(value).toFixed(2));
  return `${rounded >= 0 ? "+" : ""}${rounded}${suffix}`;
}

function formatMilliseconds(value) {
  const amount = Number(value);
  if (amount < 0.1) return `${Number(amount.toFixed(3))} ms`;
  if (amount < 1) return `${Number(amount.toFixed(2))} ms`;
  if (amount < 10) return `${Number(amount.toFixed(2))} ms`;
  return `${Math.round(amount)} ms`;
}

function generationTurns() {
  return {
    left: -state.generationAngle * (1 - state.generationAsymmetry),
    right: state.generationAngle * (1 + state.generationAsymmetry),
  };
}

function generationTopologyKey() {
  return [
    state.generations,
    state.branching,
    state.mutation,
    state.timeRatio,
    state.generationAngle,
    state.generationAsymmetry,
  ].join(":");
}

function buildGenerationVisualModel() {
  const generationCount = state.generations;
  const topologyKey = generationTopologyKey();
  if (generationTopologyCache?.key !== topologyKey) {
    generationTopologyCache = {
      key: topologyKey,
      topology: generationTopology({
        generations: generationCount,
        branching: state.branching,
        mutation: state.mutation,
        timeRatio: state.timeRatio,
        angle: state.generationAngle,
        asymmetry: state.generationAsymmetry,
      }),
    };
  }
  const topology = generationTopologyCache.topology;
  const voices = generationVoiceSpecs({
    generations: generationCount,
    interval: state.interval,
    depth: state.depth,
    branching: state.branching,
    spread: state.spread,
    mutation: state.mutation,
    timeRatio: state.timeRatio,
    angle: state.generationAngle,
    asymmetry: state.generationAsymmetry,
    pitchScale: state.generationPitchScale,
  });
  return {
    generationCount,
    topologyKey,
    topology,
    voices,
    audibleIds: new Set(voices.map((voice) => voice.key.replace(/^generation:/, ""))),
    voiceById: new Map(voices.map((voice) => [
      voice.key.replace(/^generation:/, ""),
      voice,
    ])),
  };
}

function renderGenerationRules() {
  const timing = Array.from({ length: 4 }, (_, generation) => (
    state.interval * state.timeRatio ** generation
  ));
  const turns = generationTurns();
  const toSemitones = (degrees) => degrees / 180 * 12 * state.generationPitchScale;
  $("generationPreset").value = state.generationPreset;
  $("generationPresetDescription").textContent = state.generationPreset === "custom"
    ? "Your current hand-shaped combination of recursion controls."
    : GENERATION_RULE_PRESETS[state.generationPreset]?.description ?? "";
  $("generationTimingReadout").textContent = timing.map(formatMilliseconds).join(" → ");
  $("generationPitchReadout").textContent = `${signed(turns.left, "°")} → ${signed(toSemitones(turns.left), " st")} · ${signed(turns.right, "°")} → ${signed(toSemitones(turns.right), " st")}`;
  generationVisualModel = buildGenerationVisualModel();
  const generationCounts = Array.from({ length: state.generations + 1 }, (_, generation) => (
    generationVisualModel.topology.filter((node) => node.generation === generation).length
  ));
  $("generationCountReadout").textContent = generationCounts.slice(0, 4).join(" → ");
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message) {
  const element = $("audioError");
  element.textContent = message;
  element.hidden = false;
  $("listenSection").open = true;
}

function clearError() {
  const element = $("audioError");
  element.textContent = "";
  element.hidden = true;
}

function levelToGain(value) {
  return Math.sqrt(clamp(value));
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function formatDecibels(rms) {
  const db = 20 * Math.log10(Math.max(0.00001, rms));
  return db < -58 ? "silent" : `${Math.round(db)} dB`;
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone access was blocked. Allow it for this site, then try again.";
  }
  if (error?.name === "NotFoundError") return "No microphone input was found.";
  if (error?.name === "NotReadableError") return "The microphone is busy in another application.";
  if (error?.name === "OverconstrainedError") return "This microphone could not provide a usable live stream.";
  return error instanceof Error ? error.message : "The microphone could not start.";
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function releaseMicrophone() {
  try {
    microphoneSource?.disconnect();
  } catch {
    // The source may already be disconnected after a device-level failure.
  }
  stopStream(mediaStream);
  microphoneSource = null;
  mediaStream = null;
}

function makeSoftClipCurve(size = 2048) {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const value = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(value * 1.25) / 1.25;
  }
  return curve;
}

function makeCeilingCurve(size = 2048) {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const value = index / (size - 1) * 2 - 1;
    curve[index] = clamp(value, -0.94, 0.94);
  }
  return curve;
}

function createShaper(audio, curve) {
  if (typeof audio.createWaveShaper !== "function") return audio.createGain();
  const shaper = audio.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

function createPanner(audio, initialPan) {
  if (typeof audio.createStereoPanner !== "function") return audio.createGain();
  const panner = audio.createStereoPanner();
  panner.pan.value = initialPan;
  return panner;
}

function connect(source, destination) {
  source.connect(destination);
  return destination;
}

function setCompressorParameters(compressor, now) {
  compressor.threshold?.setValueAtTime?.(-12, now);
  compressor.knee?.setValueAtTime?.(5, now);
  compressor.ratio?.setValueAtTime?.(18, now);
  compressor.attack?.setValueAtTime?.(0.003, now);
  compressor.release?.setValueAtTime?.(0.18, now);
}

function buildAudioGraph(audio) {
  const input = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const inputAnalyser = audio.createAnalyser();
  const seedGate = audio.createGain();
  const seedA = audio.createGain();
  const seedB = audio.createGain();
  const dryGain = audio.createGain();
  const delayA = audio.createDelay(6);
  const delayB = audio.createDelay(6);
  const branchAnalyserA = audio.createAnalyser();
  const branchAnalyserB = audio.createAnalyser();
  const lowpassA = audio.createBiquadFilter();
  const lowpassB = audio.createBiquadFilter();
  const highpassA = audio.createBiquadFilter();
  const highpassB = audio.createBiquadFilter();
  const clipA = createShaper(audio, makeSoftClipCurve());
  const clipB = createShaper(audio, makeSoftClipCurve());
  const feedbackAA = audio.createGain();
  const feedbackAB = audio.createGain();
  const feedbackBA = audio.createGain();
  const feedbackBB = audio.createGain();
  const tapA = audio.createGain();
  const tapB = audio.createGain();
  const panA = createPanner(audio, -0.9);
  const panB = createPanner(audio, 0.9);
  const wetBus = audio.createGain();
  const wetGain = audio.createGain();
  const mixBus = audio.createGain();
  const safetyAnalyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const ceiling = createShaper(audio, makeCeilingCurve());
  const masterGain = audio.createGain();
  const outputAnalyser = audio.createAnalyser();
  const recorderDestination = typeof audio.createMediaStreamDestination === "function"
    ? audio.createMediaStreamDestination()
    : null;

  input.gain.value = 0;
  highpass.type = "highpass";
  highpass.frequency.value = 55;
  highpass.Q.value = 0.707;
  inputAnalyser.fftSize = 2048;
  inputAnalyser.smoothingTimeConstant = 0.72;
  branchAnalyserA.fftSize = 1024;
  branchAnalyserB.fftSize = 1024;
  branchAnalyserA.smoothingTimeConstant = 0.66;
  branchAnalyserB.smoothingTimeConstant = 0.66;
  safetyAnalyser.fftSize = 1024;
  safetyAnalyser.smoothingTimeConstant = 0.5;
  outputAnalyser.fftSize = 2048;
  outputAnalyser.smoothingTimeConstant = 0.72;
  seedGate.gain.value = 0;
  dryGain.gain.value = 0;
  tapA.gain.value = 0.7;
  tapB.gain.value = 0.7;
  wetGain.gain.value = 0;
  masterGain.gain.value = 0;

  for (const filter of [lowpassA, lowpassB]) {
    filter.type = "lowpass";
    filter.frequency.value = 8_000;
    filter.Q.value = 0.6;
  }
  for (const filter of [highpassA, highpassB]) {
    filter.type = "highpass";
    filter.frequency.value = 70;
    filter.Q.value = 0.6;
  }
  for (const feedback of [feedbackAA, feedbackAB, feedbackBA, feedbackBB]) {
    feedback.gain.value = 0;
  }

  connect(input, highpass);
  connect(highpass, inputAnalyser);
  connect(inputAnalyser, dryGain);
  connect(dryGain, mixBus);
  connect(inputAnalyser, seedGate);
  connect(seedGate, seedA);
  connect(seedGate, seedB);
  connect(seedA, delayA);
  connect(seedB, delayB);

  connect(delayA, branchAnalyserA);
  connect(branchAnalyserA, tapA);
  connect(tapA, panA);
  connect(panA, wetBus);
  connect(branchAnalyserA, lowpassA);
  connect(lowpassA, highpassA);
  connect(highpassA, clipA);
  connect(clipA, feedbackAA);
  connect(feedbackAA, delayA);
  connect(clipA, feedbackAB);
  connect(feedbackAB, delayB);

  connect(delayB, branchAnalyserB);
  connect(branchAnalyserB, tapB);
  connect(tapB, panB);
  connect(panB, wetBus);
  connect(branchAnalyserB, lowpassB);
  connect(lowpassB, highpassB);
  connect(highpassB, clipB);
  connect(clipB, feedbackBB);
  connect(feedbackBB, delayB);
  connect(clipB, feedbackBA);
  connect(feedbackBA, delayA);

  connect(wetBus, wetGain);
  connect(wetGain, mixBus);
  connect(mixBus, safetyAnalyser);
  connect(safetyAnalyser, compressor);
  setCompressorParameters(compressor, audio.currentTime);
  connect(compressor, ceiling);
  connect(ceiling, masterGain);
  connect(masterGain, outputAnalyser);
  outputAnalyser.connect(audio.destination);
  if (recorderDestination) outputAnalyser.connect(recorderDestination);

  let lfo = null;
  let modulationA = null;
  let modulationB = null;
  if (typeof audio.createOscillator === "function") {
    lfo = audio.createOscillator();
    modulationA = audio.createGain();
    modulationB = audio.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.35;
    modulationA.gain.value = 0;
    modulationB.gain.value = 0;
    lfo.connect(modulationA);
    lfo.connect(modulationB);
    modulationA.connect(delayA.delayTime);
    modulationB.connect(delayB.delayTime);
    lfo.start();
  }

  return {
    input,
    inputAnalyser,
    seedGate,
    seedA,
    seedB,
    dryGain,
    delayA,
    delayB,
    branchAnalyserA,
    branchAnalyserB,
    lowpassA,
    lowpassB,
    highpassA,
    highpassB,
    feedbackAA,
    feedbackAB,
    feedbackBA,
    feedbackBB,
    tapA,
    tapB,
    panA,
    panB,
    wetBus,
    wetGain,
    safetyAnalyser,
    masterGain,
    outputAnalyser,
    recorderDestination,
    lfo,
    modulationA,
    modulationB,
  };
}

async function prepareGenerationProcessor(audio, audioGraph) {
  const WorkletNode = globalThis.AudioWorkletNode;
  if (!audio.audioWorklet?.addModule || !WorkletNode) return;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/micmic-generation-processor.js?v=20260723-safe-grammar", import.meta.url),
    );
    if (audioContext !== audio || graph !== audioGraph || audio.state === "closed") return;
    const node = new WorkletNode(audio, "morphazoid-micmic-generations", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { historySeconds: 30, maxVoices: 48 },
    });
    audioGraph.seedGate.connect(node);
    node.connect(audioGraph.wetBus);
    audioGraph.generationNode = node;
    audioGraph.generationRenderer = {
      setVoices(voices) {
        node.port.postMessage({ type: "voices", voices });
      },
    };

    // Keep the lightweight processor audible while the larger spectral WASM
    // engine loads.  Once ready, switch atomically to the high-quality bank.
    void SignalsmithGenerationBank.create(
      audio,
      audioGraph.seedGate,
      audioGraph.wetBus,
      { maxPitchSources: 3, maxVoices: 48, historySeconds: 30 },
    ).then((bank) => {
      if (audioContext !== audio || graph !== audioGraph || audio.state === "closed") {
        void bank.dispose();
        return;
      }
      audioGraph.seedGate.disconnect?.(node);
      node.port.postMessage?.({ type: "voices", voices: [] });
      node.disconnect?.();
      node.port.close?.();
      audioGraph.generationBank = bank;
      audioGraph.generationNode = bank;
      audioGraph.generationRenderer = bank;
      bank.setVoices(audioGraph.generationVoices ?? []);
      announce("Silky spectral pitch engine ready.");
    }).catch(() => {
      // The exact-delay/granular processor remains the offline-safe fallback.
    });
  } catch {
    // The bounded feedback matrix remains the compatible fallback.
    audioGraph.generationNode = null;
    audioGraph.generationRenderer = null;
  }
}

async function ensureAudioGraph() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextClass();
    graph = buildAudioGraph(audioContext);
    inputWave = new Float32Array(graph.inputAnalyser.fftSize);
    safetyWave = new Float32Array(graph.safetyAnalyser.fftSize);
    audioContext.addEventListener?.("statechange", updateUi);
    await prepareGenerationProcessor(audioContext, graph);
  }
  if (audioContext.state !== "running") await audioContext.resume();
  return audioContext;
}

function setAudioParam(parameter, value, immediate = false) {
  if (!parameter || !audioContext) return;
  const now = audioContext.currentTime;
  parameter.cancelScheduledValues?.(now);
  if (immediate) parameter.setValueAtTime?.(value, now);
  else parameter.setTargetAtTime?.(value, now, 0.02);
}

function applyAudioParameters(immediate = false) {
  if (!graph || !audioContext) return;
  const parameters = recursionParameters(state);
  const active = state.mic;
  const seedOpen = active && !state.frozen;
  const explicitGenerations = Boolean(graph.generationNode);
  const feedbackSelf = active && !explicitGenerations ? parameters.selfFeedback : 0;
  const feedbackCross = active && !explicitGenerations ? parameters.crossFeedback : 0;
  const maximumCutoff = Math.min(18_000, audioContext.sampleRate * 0.45);

  setAudioParam(graph.input.gain, active ? state.inputTrim : 0, immediate);
  setAudioParam(graph.seedGate.gain, seedOpen ? 1 : 0, immediate);
  setAudioParam(graph.seedA.gain, explicitGenerations ? 0 : parameters.seedA, immediate);
  setAudioParam(graph.seedB.gain, explicitGenerations ? 0 : parameters.seedB, immediate);
  setAudioParam(graph.dryGain.gain, seedOpen ? state.dry : 0, immediate);
  setAudioParam(graph.delayA.delayTime, parameters.intervalA, immediate);
  setAudioParam(graph.delayB.delayTime, parameters.intervalB, immediate);
  setAudioParam(graph.lowpassA.frequency, Math.min(parameters.lowpass, maximumCutoff), immediate);
  setAudioParam(graph.lowpassB.frequency, Math.min(parameters.lowpass * 0.91, maximumCutoff), immediate);
  setAudioParam(graph.highpassA.frequency, parameters.highpass, immediate);
  setAudioParam(graph.highpassB.frequency, parameters.highpass * 1.13, immediate);
  setAudioParam(graph.feedbackAA.gain, feedbackSelf, immediate);
  setAudioParam(graph.feedbackBB.gain, feedbackSelf, immediate);
  setAudioParam(graph.feedbackAB.gain, feedbackCross, immediate);
  setAudioParam(graph.feedbackBA.gain, feedbackCross, immediate);
  setAudioParam(graph.tapA.gain, explicitGenerations ? 0 : 0.7, immediate);
  setAudioParam(graph.tapB.gain, explicitGenerations ? 0 : 0.7, immediate);
  setAudioParam(graph.wetGain.gain, active ? state.wet * parameters.wetNormalization : 0, immediate);
  setAudioParam(graph.panA.pan, parameters.panA, immediate);
  setAudioParam(graph.panB.pan, parameters.panB, immediate);
  setAudioParam(graph.lfo?.frequency, parameters.modulationRate, immediate);
  setAudioParam(graph.modulationA?.gain, parameters.modulationDepth, immediate);
  setAudioParam(graph.modulationB?.gain, -parameters.modulationDepth, immediate);
  setAudioParam(graph.masterGain.gain, active ? levelToGain(state.level) : 0, immediate);
  const generationVoices = active ? generationVoiceSpecs({
      generations: state.generations,
      interval: state.interval,
      depth: state.depth,
      branching: state.branching,
      spread: state.spread,
      mutation: state.mutation,
      timeRatio: state.timeRatio,
      angle: state.generationAngle,
      asymmetry: state.generationAsymmetry,
      pitchScale: state.generationPitchScale,
    }) : [];
  graph.generationVoices = generationVoices;
  graph.generationRenderer?.setVoices(generationVoices);
}

async function startMicrophone() {
  if (state.mic || state.starting || audioChanging) return;
  const generation = ++microphoneGeneration;
  audioChanging = true;
  state.starting = true;
  clearEnvelopeHistory();
  clearError();
  updateUi();

  try {
    const audio = await ensureAudioGraph();
    if (generation !== microphoneGeneration) return;
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires HTTPS or localhost.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    });
    if (generation !== microphoneGeneration || document.hidden) {
      stopStream(stream);
      return;
    }

    releaseMicrophone();
    mediaStream = stream;
    microphoneSource = audio.createMediaStreamSource(stream);
    microphoneSource.connect(graph.input);
    for (const track of stream.getTracks?.() ?? []) {
      track.addEventListener?.("ended", () => {
        if (generation !== microphoneGeneration || !state.mic) return;
        stopMicrophone("Microphone disconnected.", false);
        showError("The microphone stream ended. Reconnect it and start again.");
      }, { once: true });
    }
    state.mic = true;
    state.frozen = false;
    applyAudioParameters();
    clearError();
    announce("mic(mic) microphone on. Speak to seed the echo tree.");
  } catch (error) {
    if (generation !== microphoneGeneration) return;
    state.mic = false;
    state.frozen = false;
    releaseMicrophone();
    applyAudioParameters(true);
    showError(microphoneErrorMessage(error));
    announce("Microphone could not start.");
  } finally {
    if (generation === microphoneGeneration) {
      state.starting = false;
      audioChanging = false;
      updateUi();
    }
  }
}

function stopMicrophone(message = "mic(mic) microphone off.", shouldAnnounce = true) {
  ++microphoneGeneration;
  state.starting = false;
  state.mic = false;
  state.frozen = false;
  audioChanging = false;
  applyAudioParameters(true);
  releaseMicrophone();
  if (state.recording) stopRecording();
  hotSince = 0;
  clearEnvelopeHistory();
  updateUi();
  if (shouldAnnounce) announce(message);
}

function panic(message = "Panic stop. Microphone and recursive feedback are off.") {
  if (graph && audioContext) {
    for (const parameter of [
      graph.input.gain,
      graph.seedGate.gain,
      graph.feedbackAA.gain,
      graph.feedbackAB.gain,
      graph.feedbackBA.gain,
      graph.feedbackBB.gain,
      graph.wetGain.gain,
      graph.masterGain.gain,
    ]) setAudioParam(parameter, 0, true);
  }
  stopMicrophone(message, false);
  announce(message);
}

async function toggleMicrophone() {
  if (state.starting) return;
  if (state.mic) stopMicrophone();
  else await startMicrophone();
}

function toggleFreeze() {
  if (!state.mic) return;
  state.frozen = !state.frozen;
  applyAudioParameters();
  updateUi();
  announce(state.frozen
    ? "Input paused. Existing descendants continue without new microphone sound."
    : "Input resumed. Live microphone sound is feeding the tree.");
}

async function toggleInput() {
  if (state.starting) return;
  if (!state.mic) await startMicrophone();
  else toggleFreeze();
}

function supportedRecorderMimeType() {
  if (!globalThis.MediaRecorder) return "";
  const choices = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function startRecording() {
  if (!state.mic || state.recording) return;
  if (!globalThis.MediaRecorder || !graph?.recorderDestination) {
    showError("Processed-output recording is not supported in this browser.");
    return;
  }
  clearError();
  recordingMimeType = supportedRecorderMimeType();
  try {
    recorder = recordingMimeType
      ? new MediaRecorder(graph.recorderDestination.stream, { mimeType: recordingMimeType })
      : new MediaRecorder(graph.recorderDestination.stream);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Recording could not start.");
    return;
  }

  const activeRecorder = recorder;
  const activeChunks = [];
  const activeStartedAt = performance.now();
  const requestedMimeType = recordingMimeType;
  activeRecorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) activeChunks.push(event.data);
  });
  activeRecorder.addEventListener("error", () => {
    if (recorder !== activeRecorder) return;
    state.recording = false;
    updateUi();
    showError("The browser stopped the processed recording.");
  });
  activeRecorder.addEventListener("stop", () => {
    if (recorder === activeRecorder) {
      state.recording = false;
      recorder = null;
    }
    const duration = Math.max(0, (performance.now() - activeStartedAt) / 1000);
    const mimeType = activeRecorder.mimeType || requestedMimeType || "audio/webm";
    if (!activeChunks.length) {
      updateUi();
      return;
    }
    if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
    const blob = new Blob(activeChunks, { type: mimeType });
    lastTakeUrl = URL.createObjectURL(blob);
    lastTakeDuration = duration;
    lastTakeMimeType = mimeType;
    const extension = recorderExtension(mimeType);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    $("downloadTake").href = lastTakeUrl;
    $("downloadTake").download = `micmic-${stamp}.${extension}`;
    updateUi();
    announce("Recursive recording ready to download.");
  }, { once: true });

  recordingStartedAt = activeStartedAt;
  activeRecorder.start(250);
  state.recording = true;
  updateUi();
  announce("Recording the processed mic(mic) output.");
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  if (recorder?.state && recorder.state !== "inactive") recorder.stop();
  updateUi();
}

function toggleRecording() {
  if (state.recording) stopRecording();
  else startRecording();
}

function clearLastTake() {
  if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
  lastTakeUrl = "";
  lastTakeDuration = 0;
  lastTakeMimeType = "";
  $("downloadTake").removeAttribute("href");
  updateUi();
  announce("Last recursive recording cleared.");
}

function readAnalyser(analyser, samples) {
  if (!analyser || !samples.length) return { rms: 0, peak: 0 };
  analyser.getFloatTimeDomainData(samples);
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(energy / samples.length), peak };
}

function clearEnvelopeHistory() {
  currentInputEnvelope = 0;
  lastEnvelopeUpdateTime = null;
  envelopeHistoryHead = 0;
  envelopeHistoryLength = 0;
}

function recordInputEnvelope(timestamp) {
  const time = timestamp / 1_000;
  const cutoff = time - ENVELOPE_HISTORY_SECONDS;
  while (
    envelopeHistoryLength > 0
    && envelopeHistoryTimes[envelopeHistoryHead] < cutoff
  ) {
    envelopeHistoryHead = (envelopeHistoryHead + 1) % ENVELOPE_HISTORY_CAPACITY;
    envelopeHistoryLength -= 1;
  }
  if (envelopeHistoryLength === ENVELOPE_HISTORY_CAPACITY) {
    envelopeHistoryHead = (envelopeHistoryHead + 1) % ENVELOPE_HISTORY_CAPACITY;
    envelopeHistoryLength -= 1;
  }
  const writeIndex = (
    envelopeHistoryHead + envelopeHistoryLength
  ) % ENVELOPE_HISTORY_CAPACITY;
  envelopeHistoryTimes[writeIndex] = time;
  envelopeHistoryValues[writeIndex] = currentInputEnvelope;
  envelopeHistoryLength += 1;
}

function inputEnvelopeAt(time) {
  if (!envelopeHistoryLength) return 0;
  const indexAt = (index) => (
    envelopeHistoryHead + index
  ) % ENVELOPE_HISTORY_CAPACITY;
  const firstIndex = indexAt(0);
  if (time < envelopeHistoryTimes[firstIndex]) return 0;
  const lastIndex = indexAt(envelopeHistoryLength - 1);
  if (time >= envelopeHistoryTimes[lastIndex]) {
    return envelopeHistoryValues[lastIndex];
  }
  let low = 0;
  let high = envelopeHistoryLength - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (envelopeHistoryTimes[indexAt(middle)] <= time) low = middle;
    else high = middle;
  }
  const beforeIndex = indexAt(low);
  const afterIndex = indexAt(high);
  const beforeTime = envelopeHistoryTimes[beforeIndex];
  const afterTime = envelopeHistoryTimes[afterIndex];
  const mix = clamp((time - beforeTime) / Math.max(1e-6, afterTime - beforeTime));
  return envelopeHistoryValues[beforeIndex]
    + (envelopeHistoryValues[afterIndex] - envelopeHistoryValues[beforeIndex]) * mix;
}

function updateMeters(now) {
  const elapsed = lastEnvelopeUpdateTime === null
    ? 1 / 60
    : clamp((now - lastEnvelopeUpdateTime) / 1_000, 0, 0.25);
  lastEnvelopeUpdateTime = now;
  const envelopeRelease = Math.exp(-elapsed / 0.16);
  if (!graph || !state.mic) {
    inputWave.fill(0);
    currentInputEnvelope *= envelopeRelease;
    inputPeakHold *= 0.9;
    if (now - lastUiMeterUpdate > 100) {
      $("inputMeterBar").style.width = "0%";
      $("inputPeakMarker").style.left = `${Math.round(inputPeakHold * 100)}%`;
      $("inputMeterOut").textContent = "silent";
      lastUiMeterUpdate = now;
    }
    return;
  }

  const input = readAnalyser(graph.inputAnalyser, inputWave);
  const safety = readAnalyser(graph.safetyAnalyser, safetyWave);
  const meter = clamp(input.rms * 4.2);
  const nextEnvelope = state.frozen
    ? 0
    : clamp(Math.max(input.rms * 5.5, input.peak * 0.9));
  currentInputEnvelope = Math.max(nextEnvelope, currentInputEnvelope * envelopeRelease);
  inputPeakHold = Math.max(clamp(input.peak), inputPeakHold * 0.965);

  if (now - lastUiMeterUpdate > 70) {
    $("inputMeterBar").style.width = `${Math.round(meter * 100)}%`;
    $("inputPeakMarker").style.left = `${Math.round(inputPeakHold * 100)}%`;
    $("inputMeterOut").textContent = formatDecibels(input.rms);
    lastUiMeterUpdate = now;
  }

  const dangerouslyHot = safety.rms > 0.82 || safety.peak > 1.5;
  if (dangerouslyHot) {
    if (!hotSince) hotSince = now;
    if (now - hotSince > 320) {
      panic("Safety stop. The recursive signal stayed too loud.");
      showError("Safety stop: the recursive signal stayed too loud. Lower Input trim or Depth before restarting.");
    }
  } else {
    hotSince = 0;
  }
}

function topologyBounds(topology) {
  return topology.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, node.startX, node.x),
    maxX: Math.max(bounds.maxX, node.startX, node.x),
    minY: Math.min(bounds.minY, node.startY, node.y),
    maxY: Math.max(bounds.maxY, node.startY, node.y),
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
}

// Match the L-system page: preserve the grammar's proportions, then fit the
// complete rewrite into the largest centered rectangle the stage can contain.
// Playback interval never participates in this transform.
function stageGenerationLayout(topology) {
  const bounds = topologyBounds(topology);
  const margin = Math.max(30, Math.min(cssWidth, cssHeight) * 0.075);
  const availableWidth = Math.max(1, cssWidth - margin * 2);
  const availableHeight = Math.max(1, cssHeight - margin * 2);
  const dataWidth = Math.max(1e-9, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(1e-9, bounds.maxY - bounds.minY);
  const scale = Math.min(availableWidth / dataWidth, availableHeight / dataHeight);
  const drawnWidth = dataWidth * scale;
  const drawnHeight = dataHeight * scale;
  const left = (cssWidth - drawnWidth) * 0.5;
  const top = (cssHeight - drawnHeight) * 0.5;
  const projectPoint = (x, y) => ({
    x: left + (x - bounds.minX) * scale,
    y: top + (bounds.maxY - y) * scale,
  });
  return {
    root: projectPoint(0, 0),
    seedSize: clamp(Math.min(cssWidth, cssHeight) * 0.085, 46, 62),
    project: (node) => projectPoint(node.x, node.y),
    projectPoint,
  };
}

function stageGeometry(model) {
  if (
    stageGeometryCache?.topologyKey === model.topologyKey
    && stageGeometryCache.width === cssWidth
    && stageGeometryCache.height === cssHeight
  ) {
    return stageGeometryCache;
  }
  const layout = stageGenerationLayout(model.topology);
  const segments = model.topology.map((node) => ({
    node,
    start: layout.projectPoint(node.startX, node.startY),
    end: layout.project(node),
  }));
  const PathConstructor = globalThis.Path2D;
  const ghostPath = typeof PathConstructor === "function"
    ? new PathConstructor()
    : null;
  if (ghostPath) {
    for (const segment of segments) {
      ghostPath.moveTo(segment.start.x, segment.start.y);
      ghostPath.lineTo(segment.end.x, segment.end.y);
    }
  }
  stageGeometryCache = {
    topologyKey: model.topologyKey,
    width: cssWidth,
    height: cssHeight,
    layout,
    segments,
    ghostPath,
  };
  return stageGeometryCache;
}

function branchEnvelopeAt(time) {
  return clamp(1 - Math.exp(-inputEnvelopeAt(time) * 5));
}

function drawVibratingBranch(node, start, end, voice, parentVoice, timestamp) {
  const color = GENERATION_COLORS[node.generation % GENERATION_COLORS.length];
  if (!state.mic) {
    context.save();
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.globalAlpha = 0.18;
    context.lineWidth = node.generation === 0 ? 1.85 : 0.95;
    context.lineCap = "round";
    context.stroke();
    context.restore();
    return;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const normalX = length > 1e-6 ? -dy / length : 0;
  const normalY = length > 1e-6 ? dx / length : 0;
  const steps = Math.max(5, Math.min(14, Math.ceil(length / 14)));
  const now = timestamp / 1_000;
  const startDelay = node.generation === 0
    ? 0
    : parentVoice?.delay ?? Math.max(0, (voice?.delay ?? 0) - (voice?.interval ?? 0));
  const endDelay = node.generation === 0 ? 0 : voice?.delay ?? startDelay;
  const rate = Math.sqrt(clamp(voice?.rate ?? 1, 0.25, 4));
  const maximumOffset = clamp(length * 0.055, 1.5, 8);
  const voiceLevel = node.generation === 0
    ? 1
    : clamp(Math.sqrt(Math.max(0, voice?.gain ?? 0) / 0.5) * Math.sqrt(clamp(state.wet)));
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const delayedTime = now - (startDelay + (endDelay - startDelay) * progress);
    const energy = branchEnvelopeAt(delayedTime) * voiceLevel;
    const carrier = Math.sin(
      timestamp * 0.009 * rate
      + progress * Math.PI * (3 + node.generation * 0.35)
      + node.index * 0.71,
    );
    const offset = REDUCED_MOTION
      ? 0
      : Math.sin(Math.PI * progress) * energy * maximumOffset * carrier;
    points.push({
      x: start.x + dx * progress + normalX * offset,
      y: start.y + dy * progress + normalY * offset,
      energy,
    });
  }

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = color;
  context.globalAlpha = state.mic
    ? 0.2 + Math.pow(state.depth, node.generation * 0.7) * 0.24
    : 0.18;
  context.lineWidth = node.generation === 0 ? 1.85 : 0.95;
  context.stroke();

  // Brighten only the energetic part of the polyline so attacks visibly
  // travel from the seed to each delayed descendant instead of flashing the
  // entire tree at once.
  let connected = false;
  let peakEnergy = 0;
  context.beginPath();
  for (let index = 1; index < points.length; index += 1) {
    const energy = Math.max(points[index - 1].energy, points[index].energy);
    if (energy < 0.015) {
      connected = false;
      continue;
    }
    if (!connected) context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    connected = true;
    peakEnergy = Math.max(peakEnergy, energy);
  }
  if (peakEnergy > 0) {
    context.strokeStyle = color;
    context.globalAlpha = 0.24 + peakEnergy * 0.72;
    context.lineWidth = (node.generation === 0 ? 1.9 : 1.05) + peakEnergy * 2.4;
    context.shadowColor = color;
    context.shadowBlur = 3 + peakEnergy * 12;
    context.stroke();
  }
  context.restore();
}

function drawStage(timestamp) {
  context.clearRect(0, 0, cssWidth, cssHeight);
  const model = generationVisualModel ?? buildGenerationVisualModel();
  generationVisualModel = model;
  const geometry = stageGeometry(model);
  const { layout, segments } = geometry;

  $("seedControl").style.left = `${layout.root.x}px`;
  $("seedControl").style.top = `${layout.root.y}px`;
  $("seedControl").style.width = `${layout.seedSize}px`;
  $("seedControl").style.height = `${layout.seedSize}px`;

  // The full rewrite remains visible as one connected quiet tree, even when
  // only a bounded subset of its branches can be rendered as audio voices.
  context.save();
  if (geometry.ghostPath) {
    context.strokeStyle = "rgba(119,131,126,.58)";
    context.globalAlpha = state.mic ? 0.34 : 0.28;
    context.lineWidth = 0.72;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(geometry.ghostPath);
  } else {
    context.beginPath();
    for (const segment of segments) {
      context.moveTo(segment.start.x, segment.start.y);
      context.lineTo(segment.end.x, segment.end.y);
    }
    context.strokeStyle = "rgba(119,131,126,.58)";
    context.globalAlpha = state.mic ? 0.34 : 0.28;
    context.lineWidth = 0.72;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }
  context.restore();

  for (const { node, start, end } of segments) {
    if (node.generation > 0 && !model.audibleIds.has(node.id)) continue;
    const voice = model.voiceById.get(node.id);
    const parentVoice = model.voiceById.get(node.parentId);
    drawVibratingBranch(node, start, end, voice, parentVoice, timestamp);
  }

  if (state.frozen) {
    context.save();
    context.fillStyle = "rgba(199,155,255,.72)";
    context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.letterSpacing = "0.12em";
    context.textAlign = "left";
    context.fillText("INPUT PAUSED · DESCENDANTS DECAYING", 18, cssHeight - 42);
    context.restore();
  }
}

function frame(timestamp) {
  const elapsed = Math.min(100, Math.max(0, timestamp - lastFrameTime));
  lastFrameTime = timestamp;
  inputPeakHold *= Math.pow(0.985, elapsed / 16.67);
  updateMeters(timestamp);
  recordInputEnvelope(timestamp);
  drawStage(timestamp);
  if (state.recording) {
    const duration = (timestamp - recordingStartedAt) / 1000;
    $("stageRecordTime").textContent = formatTime(duration);
    $("recordHint").textContent = `${formatTime(duration)} · click to finish`;
    $("captureSummary").textContent = `recording · ${formatTime(duration)}`;
  }
  requestAnimationFrame(frame);
}

function resizeStage() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  stageGeometryCache = null;
}

function presetLabel() {
  return state.generationPreset === "custom"
    ? "Custom growth"
    : GENERATION_RULE_PRESETS[state.generationPreset]?.label ?? "Custom growth";
}

function paintControls() {
  const values = {
    level: [state.level, `${Math.round(state.level * 100)}%`],
    inputTrim: [state.inputTrim, `${Math.round(state.inputTrim * 100)}%`],
    generations: [state.generations, `${state.generations} / ${MAX_GENERATION_STAGES}`],
    depth: [state.depth, `${Math.round(state.depth * 100)}%`],
    interval: [state.interval, formatMilliseconds(state.interval)],
    mutation: [state.mutation, `${Math.round(state.mutation * 100)}% rule variance`],
    timeRatio: [state.timeRatio, `${state.timeRatio.toFixed(2)}× per generation`],
    generationAngle: [state.generationAngle, `${Number(state.generationAngle.toFixed(1))}°`],
    generationAsymmetry: [state.generationAsymmetry, state.generationAsymmetry === 0 ? "even" : `${Math.round(Math.abs(state.generationAsymmetry) * 100)}% ${state.generationAsymmetry < 0 ? "left wider" : "right wider"}`],
    generationPitchScale: [state.generationPitchScale, `${state.generationPitchScale.toFixed(2)} oct / 180°`],
    wet: [state.wet, `${Math.round(state.wet * 100)}%`],
    dry: [state.dry, state.dry <= 0.001 ? "muted" : `${Math.round(state.dry * 100)}%`],
    spread: [state.spread, `${Math.round(state.spread * 100)}%`],
  };
  for (const [id, [value, output]] of Object.entries(values)) {
    $(id).value = String(value);
    $(`${id}Out`).textContent = output;
  }
}

function updateUi() {
  const generations = state.generations;
  const label = presetLabel();
  const live = state.mic;
  const starting = state.starting;
  const audioState = live ? "on" : "off";

  paintControls();
  renderGenerationRules();
  setPressed($("audioButton"), live);
  $("audioButton").disabled = starting;
  $("audioState").textContent = audioState;
  setPressed($("micButton"), live && !state.frozen);
  $("micButton").disabled = starting;
  $("micButtonLabel").textContent = starting
    ? "Allow microphone"
    : live ? (state.frozen ? "Resume input" : "Pause input") : "Start input";
  $("micButtonHint").textContent = starting
    ? "waiting for permission"
    : live
      ? (state.frozen ? "feed the tree again" : "tail continues while paused")
      : "allow microphone access";
  setPressed($("freezeButton"), false);
  $("freezeButton").disabled = !live;
  $("freezeLabel").textContent = "Stop audio";
  $("freezeHint").textContent = "disconnect and clear the tail";
  $("panicButton").disabled = !live && !starting;
  $("seedMicButton").disabled = starting;
  setPressed($("seedMicButton"), live && !state.frozen);
  const seedLabel = starting
    ? "Allow microphone"
    : live ? (state.frozen ? "Resume input" : "Pause input") : "Start input";
  $("seedMicButton").querySelector("b").textContent = seedLabel;
  $("seedMicButton").setAttribute("aria-label", seedLabel);

  $("listenSummary").textContent = starting ? "waiting for permission" : live ? (state.frozen ? "input paused · tail live" : "microphone live") : "microphone off";
  $("recursionSummary").textContent = `${label} · ${generations} generations`;
  $("mixSummary").textContent = `${Math.round(state.wet * 100)}% descendants · ${state.dry ? `${Math.round(state.dry * 100)}% root` : "root muted"}`;
  $("generationKeyEnd").textContent = `G${generations} DESCENDANT`;
  $("stageReadout").textContent = `${live ? (state.frozen ? "INPUT PAUSED" : "MIC LIVE") : "MIC OFF"} · ${label.toUpperCase()} · ${generations} GENERATIONS`;
  const segmentCount = generationVisualModel?.topology.length ?? 0;
  const voiceCount = generationVisualModel?.voices.length ?? 0;
  const audibleCount = generationVisualModel?.voices.filter((voice) => (
    voice.gain * state.wet > 0.00001
  )).length ?? 0;
  canvas.setAttribute("aria-label", `Live fitted mic(mic) L-system tree. ${live ? state.frozen ? "Input paused; recursive tail live" : "Microphone live" : "Microphone off"}.`);
  $("treeDescription").textContent = `${label}. ${generations} generations and ${segmentCount} connected segments; ${audibleCount} of ${voiceCount} bounded delayed descendant paths carry audible gain. Microphone loudness travels outward from the seed by vibrating the branches.`;

  const canRecord = live && Boolean(graph?.recorderDestination) && Boolean(globalThis.MediaRecorder);
  setPressed($("recordButton"), state.recording);
  $("recordButton").disabled = !canRecord;
  $("recordLabel").textContent = state.recording ? "Finish recording" : "Record recursion";
  if (!state.recording) $("recordHint").textContent = canRecord ? "records while you listen" : "start audio first";
  $("recordingBadge").hidden = !state.recording;
  $("captureSummary").textContent = state.recording
    ? `recording · ${formatTime((performance.now() - recordingStartedAt) / 1000)}`
    : lastTakeUrl ? "last take ready" : "ready to record output";
  $("lastTake").hidden = !lastTakeUrl;
  if (lastTakeUrl) {
    const extension = recorderExtension(lastTakeMimeType).toUpperCase();
    $("lastTakeOut").textContent = `${formatTime(lastTakeDuration)} · ${extension}`;
  }
}

function bindRange(id, key, marksGrowthCustom = false) {
  $(id).addEventListener("input", () => {
    state[key] = Number($(id).value);
    if (marksGrowthCustom) state.generationPreset = "custom";
    applyAudioParameters();
    updateUi();
  });
}

for (const id of ["generations", "depth", "interval", "mutation"]) {
  bindRange(id, id, true);
}
for (const id of ["wet", "dry", "spread"]) {
  bindRange(id, id);
}
bindRange("inputTrim", "inputTrim");
bindRange("level", "level");

function loadGenerationPreset(name, shouldAnnounce = true) {
  const resolvedName = Object.prototype.hasOwnProperty.call(GENERATION_RULE_PRESETS, name)
    ? name
    : lastGenerationPreset;
  const preset = GENERATION_RULE_PRESETS[resolvedName] ?? GENERATION_RULE_PRESETS.pythagorean;
  state.generationPreset = resolvedName;
  lastGenerationPreset = resolvedName;
  state.generations = preset.generations;
  state.branching = FIXED_FORK_DENSITY;
  state.depth = preset.depth;
  state.interval = preset.interval;
  state.mutation = preset.mutation;
  state.timeRatio = preset.timeRatio;
  state.generationAngle = preset.angle;
  state.generationAsymmetry = preset.asymmetry;
  state.generationPitchScale = preset.pitchScale;
  applyAudioParameters();
  updateUi();
  if (shouldAnnounce) announce(`${preset.label} recursion preset loaded.`);
}

$("generationPreset").addEventListener("change", (event) => loadGenerationPreset(event.currentTarget.value));
$("resetGenerationRules").addEventListener("click", () => loadGenerationPreset(state.generationPreset));

for (const id of ["timeRatio", "generationAngle", "generationAsymmetry", "generationPitchScale"]) {
  $(id).addEventListener("input", () => {
    state[id] = Number($(id).value);
    state.generationPreset = "custom";
    applyAudioParameters();
    updateUi();
  });
}

$("audioButton").addEventListener("click", () => void toggleMicrophone());
$("seedMicButton").addEventListener("click", () => void toggleInput());
$("micButton").addEventListener("click", () => void toggleInput());
$("freezeButton").addEventListener("click", () => stopMicrophone());
$("panicButton").addEventListener("click", () => panic());
$("recordButton").addEventListener("click", toggleRecording);
$("clearTake").addEventListener("click", clearLastTake);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.mic || state.starting) panic();
    return;
  }
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (event.repeat) return;
  if (event.key.toLowerCase() === "m") void toggleInput();
  if (event.key.toLowerCase() === "f" && state.mic) stopMicrophone();
  if (event.key.toLowerCase() === "r" && state.mic) toggleRecording();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && (state.mic || state.starting)) {
    panic("Microphone stopped because mic(mic) moved to the background.");
  }
});

window.addEventListener("pagehide", () => {
  ++microphoneGeneration;
  if (state.recording) stopRecording();
  state.mic = false;
  applyAudioParameters(true);
  releaseMicrophone();
  try {
    graph?.lfo?.stop();
  } catch {
    // The oscillator may already have stopped during browser teardown.
  }
  void audioContext?.close?.();
  if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
});

new ResizeObserver(resizeStage).observe(stageWrap);
resizeStage();
updateUi();
requestAnimationFrame(frame);
