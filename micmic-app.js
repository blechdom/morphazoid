import {
  MICMIC_PRESETS,
  GENERATION_RULE_PRESETS,
  MAX_GENERATION_STAGES,
  clamp,
  generationCountForDepth,
  generationTopology,
  generationVoiceSpecs,
  recorderExtension,
  recursionParameters,
} from "./src/micmic.js";
import { SignalsmithGenerationBank } from "./src/signalsmith-generation-bank.js?v=20260723-fixed-pool";

const $ = (id) => document.getElementById(id);
const GENERATION_COLORS = ["#fff3d6", "#55d9ff", "#5fe8c4", "#7db4ff", "#c79bff", "#ff826f", "#e8c46b"];
const DEFAULT_STATE = Object.freeze({
  ...MICMIC_PRESETS.bloom,
  preset: "bloom",
  inputTrim: 0.85,
  level: 0.58,
  mic: false,
  starting: false,
  frozen: false,
  recording: false,
  generationPreset: "plant",
  timeRatio: GENERATION_RULE_PRESETS.plant.timeRatio,
  generationAngle: GENERATION_RULE_PRESETS.plant.angle,
  generationAsymmetry: GENERATION_RULE_PRESETS.plant.asymmetry,
  generationPitchScale: GENERATION_RULE_PRESETS.plant.pitchScale,
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
let outputWave = new Float32Array(1024);
let safetyWave = new Float32Array(512);
let branchAWave = new Float32Array(512);
let branchBWave = new Float32Array(512);
let inputPeakHold = 0;
let hotSince = 0;
let lastUiMeterUpdate = 0;
let lastFrameTime = performance.now();
let generationVisualModel = null;

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

function buildGenerationVisualModel() {
  const generationCount = generationCountForDepth(state.depth);
  const topology = generationTopology({
    generations: generationCount,
    branching: state.branching,
    timeRatio: state.timeRatio,
    angle: state.generationAngle,
    asymmetry: state.generationAsymmetry,
  });
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
    topology,
    voices,
    audibleIds: new Set(voices.map((voice) => voice.key.replace(/^generation:/, ""))),
  };
}

function generationShapeGeometry() {
  generationVisualModel = buildGenerationVisualModel();
  const {
    generationCount,
    topology,
    voices,
    audibleIds,
  } = generationVisualModel;
  // Use one fixed projection instead of fitting the current bounds.  The seed
  // trunk is therefore always exactly 14 SVG units wide; taper only affects
  // its rewritten descendants.
  const project = (x, y) => ({ x: 8 + x * 14, y: 48 + y * 14 });
  const pathFor = (nodes) => nodes.map((node) => {
    const start = project(node.startX, node.startY);
    const end = project(node.x, node.y);
    return `M${start.x.toFixed(2)} ${start.y.toFixed(2)}L${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }).join("");
  const trunk = topology[0];
  const root = project(trunk.startX, trunk.startY);
  return {
    trunkPath: pathFor([trunk]),
    path: pathFor(topology.slice(1)),
    audiblePath: pathFor(topology.slice(1).filter((node) => audibleIds.has(node.id))),
    root,
    generationCount,
    branchCount: Math.max(0, topology.length - 1),
    audibleCount: voices.length,
    generationCounts: Array.from({ length: generationCount + 1 }, (_, generation) => (
      topology.filter((node) => node.generation === generation).length
    )),
  };
}

function renderGenerationShape() {
  const geometry = generationShapeGeometry();
  $("generationShapeTrunk").setAttribute("d", geometry.trunkPath);
  $("generationShapePath").setAttribute("d", geometry.path);
  $("generationShapeAudiblePath").setAttribute("d", geometry.audiblePath);
  $("generationShapeRoot").setAttribute("cx", geometry.root.x.toFixed(2));
  $("generationShapeRoot").setAttribute("cy", geometry.root.y.toFixed(2));
  $("generationShapeSummary").textContent = `${geometry.generationCount} gen · ${geometry.branchCount} visual · ${geometry.audibleCount} audible`;
  $("generationShapePreview").setAttribute(
    "aria-label",
    `Live ${geometry.generationCount}-generation L-system preview with ${geometry.branchCount} segments, ${Number(state.generationAngle.toFixed(1))} degree branch angle, and ${state.timeRatio.toFixed(2)} child length ratio.`,
  );
  return geometry;
}

function renderGenerationRules() {
  const timing = Array.from({ length: 4 }, (_, generation) => (
    state.interval * state.timeRatio ** generation
  ));
  const turns = generationTurns();
  const toSemitones = (degrees) => degrees / 180 * 12 * state.generationPitchScale;
  $("generationPreset").value = state.generationPreset;
  $("generationTimingReadout").textContent = timing.map(formatMilliseconds).join(" → ");
  $("generationPitchReadout").textContent = `${signed(turns.left, "°")} → ${signed(toSemitones(turns.left), " st")} · ${signed(turns.right, "°")} → ${signed(toSemitones(turns.right), " st")}`;
  const geometry = renderGenerationShape();
  $("generationCountReadout").textContent = geometry.generationCounts.slice(0, 4).join(" → ");
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
      new URL("./src/micmic-generation-processor.js?v=20260723-shared-topology", import.meta.url),
    );
    if (audioContext !== audio || graph !== audioGraph || audio.state === "closed") return;
    const node = new WorkletNode(audio, "morphazoid-micmic-generations", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { historySeconds: 32, maxVoices: 48 },
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
      { maxPitchSources: 5, maxVoices: 48, historySeconds: 32 },
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
    outputWave = new Float32Array(graph.outputAnalyser.fftSize);
    safetyWave = new Float32Array(graph.safetyAnalyser.fftSize);
    branchAWave = new Float32Array(graph.branchAnalyserA.fftSize);
    branchBWave = new Float32Array(graph.branchAnalyserB.fftSize);
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
      generations: parameters.generations,
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

function updateMeters(now) {
  if (!graph || !state.mic) {
    inputWave.fill(0);
    outputWave.fill(0);
    branchAWave.fill(0);
    branchBWave.fill(0);
    inputPeakHold *= 0.9;
    if (now - lastUiMeterUpdate > 100) {
      $("inputMeterBar").style.width = "0%";
      $("inputPeakMarker").style.left = `${Math.round(inputPeakHold * 100)}%`;
      $("inputMeterOut").textContent = "silent";
      $("outputMetric").textContent = "silent";
      lastUiMeterUpdate = now;
    }
    return;
  }

  const input = readAnalyser(graph.inputAnalyser, inputWave);
  const output = readAnalyser(graph.outputAnalyser, outputWave);
  const safety = readAnalyser(graph.safetyAnalyser, safetyWave);
  readAnalyser(graph.branchAnalyserA, branchAWave);
  readAnalyser(graph.branchAnalyserB, branchBWave);
  const meter = clamp(input.rms * 4.2);
  inputPeakHold = Math.max(clamp(input.peak), inputPeakHold * 0.965);

  if (now - lastUiMeterUpdate > 70) {
    $("inputMeterBar").style.width = `${Math.round(meter * 100)}%`;
    $("inputPeakMarker").style.left = `${Math.round(inputPeakHold * 100)}%`;
    $("inputMeterOut").textContent = formatDecibels(input.rms);
    $("outputMetric").textContent = formatDecibels(output.rms);
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

function capsulePath(drawContext, x, y, width, height) {
  const radius = Math.min(width, height) / 2;
  drawContext.beginPath();
  drawContext.moveTo(x + radius, y);
  drawContext.lineTo(x + width - radius, y);
  drawContext.quadraticCurveTo(x + width, y, x + width, y + radius);
  drawContext.lineTo(x + width, y + height - radius);
  drawContext.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  drawContext.lineTo(x + radius, y + height);
  drawContext.quadraticCurveTo(x, y + height, x, y + height - radius);
  drawContext.lineTo(x, y + radius);
  drawContext.quadraticCurveTo(x, y, x + radius, y);
  drawContext.closePath();
}

function drawCapsule(node, position, samples, timestamp) {
  const generation = node.generation;
  const active = state.mic;
  const color = GENERATION_COLORS[generation % GENERATION_COLORS.length];
  const root = generation === 0;
  const width = root ? clamp(cssWidth * 0.105, 62, 104) : clamp(59 - generation * 3.4, 25, 56);
  const height = root ? clamp(cssHeight * 0.105, 35, 54) : clamp(27 - generation * 1.4, 13, 25);
  const x = position.x - width / 2;
  const y = position.y - height / 2;
  const decay = root ? 1 : Math.pow(state.depth, generation * 0.72);
  const alpha = active ? 0.3 + decay * 0.7 : 0.17;

  context.save();
  context.globalAlpha = alpha;
  capsulePath(context, x, y, width, height);
  context.fillStyle = `${color}0b`;
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = root ? 1.3 : 0.8;
  context.shadowColor = color;
  context.shadowBlur = active ? (root ? 14 : 7 * decay) : 0;
  context.stroke();
  context.shadowBlur = 0;
  capsulePath(context, x + 3, y + 3, width - 6, height - 6);
  context.clip();

  context.beginPath();
  const sampleCount = Math.max(8, Math.floor(width));
  const phaseOffset = (generation * 31 + node.index * 17) % Math.max(1, samples.length);
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleIndex = Math.floor(index / Math.max(1, sampleCount - 1) * (samples.length - 1));
    const raw = active
      ? samples[(sampleIndex + phaseOffset) % samples.length] ?? 0
      : Math.sin(timestamp * 0.0013 + index * 0.7 + generation) * 0.08;
    const mutationJitter = Math.sin(index * 1.9 + generation * 2.4 + timestamp * 0.002) * state.mutation * 0.08;
    const wave = clamp(raw + mutationJitter, -1, 1);
    const px = x + 4 + index / Math.max(1, sampleCount - 1) * (width - 8);
    const py = y + height / 2 + wave * height * 0.34 * decay;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.strokeStyle = color;
  context.lineWidth = root ? 1.2 : 0.75;
  context.globalAlpha = active ? 0.92 : 0.3;
  context.stroke();
  context.restore();
}

function drawStage(timestamp) {
  context.clearRect(0, 0, cssWidth, cssHeight);
  const model = generationVisualModel ?? buildGenerationVisualModel();
  generationVisualModel = model;
  const nodes = model.topology;
  const generations = model.generationCount;
  const left = clamp(cssWidth * 0.12, 62, 135);
  const right = cssWidth - clamp(cssWidth * 0.08, 48, 92);
  const top = 58;
  const bottom = cssHeight - 56;
  const centerY = (top + bottom) / 2;
  const unit = Math.max(4, (right - left) / (MAX_GENERATION_STAGES + 1));
  const project = (x, y) => ({
    x: left + x * unit,
    y: centerY + y * unit,
  });
  const positions = new Map();
  for (const node of nodes) {
    positions.set(node.id, project(node.x, node.y));
  }

  const trunk = nodes[0];
  const seedPosition = trunk ? project(trunk.startX, trunk.startY) : null;
  if (seedPosition) {
    const seedWidth = clamp(cssWidth * 0.105, 62, 104);
    const seedHeight = clamp(cssHeight * 0.105, 35, 54);
    $("seedControl").style.left = `${seedPosition.x}px`;
    $("seedControl").style.top = `${seedPosition.y}px`;
    $("seedControl").style.width = `${seedWidth}px`;
    $("seedControl").style.height = `${seedHeight}px`;
  }

  context.save();
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let generation = 0; generation <= generations; generation += 1) {
    const x = left + (generation + 1) * unit;
    context.fillStyle = generation === 0 ? "rgba(255,243,214,.48)" : "rgba(119,131,126,.38)";
    context.fillText(`G${generation}`, x, 31);
  }
  context.restore();

  for (const node of nodes) {
    const start = project(node.startX, node.startY);
    const end = positions.get(node.id);
    const audible = node.generation === 0 || model.audibleIds.has(node.id);
    const color = GENERATION_COLORS[node.generation % GENERATION_COLORS.length];
    context.save();
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = audible ? color : "rgba(119,131,126,.48)";
    context.globalAlpha = audible
      ? (state.mic ? 0.18 + Math.pow(state.depth, node.generation) * 0.3 : 0.13)
      : 0.08;
    context.lineWidth = node.generation === 0 ? 1.8 : audible ? 0.9 : 0.55;
    context.stroke();

    if (state.mic && audible) {
      const travel = ((timestamp / Math.max(70, state.interval) + node.generation * 0.14 + node.index * 0.03) % 1);
      const pulse = {
        x: start.x + (end.x - start.x) * travel,
        y: start.y + (end.y - start.y) * travel,
      };
      context.beginPath();
      context.arc(pulse.x, pulse.y, 1.3, 0, Math.PI * 2);
      context.fillStyle = color;
      context.globalAlpha = 0.65 * Math.pow(state.depth, node.generation * 0.35);
      context.shadowColor = color;
      context.shadowBlur = 7;
      context.fill();
    }
    context.restore();
  }

  const soundingNodes = nodes.filter((node) => (
    node.generation === 0 || model.audibleIds.has(node.id)
  ));
  for (const node of [...soundingNodes].reverse()) {
    const samples = node.generation === 0
      ? inputWave
      : node.rule === "A" ? branchAWave : branchBWave;
    drawCapsule(node, positions.get(node.id), samples, timestamp);
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
}

function presetLabel() {
  return state.preset === "custom" ? "Custom" : MICMIC_PRESETS[state.preset]?.label ?? "Custom";
}

function paintControls() {
  const generations = generationCountForDepth(state.depth);
  const values = {
    level: [state.level, `${Math.round(state.level * 100)}%`],
    inputTrim: [state.inputTrim, `${Math.round(state.inputTrim * 100)}%`],
    depth: [state.depth, `${Math.round(state.depth * 100)}% · ${generations} gen`],
    interval: [state.interval, formatMilliseconds(state.interval)],
    branching: [state.branching, `${Math.round(state.branching * 100)}%`],
    mutation: [state.mutation, `${Math.round(state.mutation * 100)}%`],
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
  const generations = generationCountForDepth(state.depth);
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

  $("stateMetric").textContent = starting ? "starting" : live ? (state.frozen ? "paused" : "live") : "off";
  $("depthMetric").textContent = `${generations} gen`;
  $("listenSummary").textContent = starting ? "waiting for permission" : live ? (state.frozen ? "input paused · tail live" : "microphone live") : "microphone off";
  $("recursionSummary").textContent = `${label} · ${generations} generations`;
  $("mixSummary").textContent = `${Math.round(state.wet * 100)}% descendants · ${state.dry ? `${Math.round(state.dry * 100)}% root` : "root muted"}`;
  $("generationKeyEnd").textContent = `G${generations} DESCENDANT`;
  $("stageReadout").textContent = `${live ? (state.frozen ? "INPUT PAUSED" : "MIC LIVE") : "MIC OFF"} · ${label.toUpperCase()} · ${generations} GENERATIONS`;
  canvas.setAttribute("aria-label", `mic(mic) echo tree. ${live ? state.frozen ? "Input paused; recursive tail live" : "Microphone live" : "Microphone off"}. ${generations} estimated audible generations.`);

  for (const button of $("presetButtons").querySelectorAll("button")) {
    setPressed(button, button.dataset.preset === state.preset);
  }

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

function markCustom() {
  state.preset = "custom";
}

function bindRange(id, key, { presetParameter = true } = {}) {
  $(id).addEventListener("input", () => {
    state[key] = Number($(id).value);
    if (presetParameter) markCustom();
    applyAudioParameters();
    updateUi();
  });
}

for (const id of ["depth", "interval", "branching", "mutation", "wet", "dry", "spread"]) {
  bindRange(id, id);
}
bindRange("inputTrim", "inputTrim", { presetParameter: false });
bindRange("level", "level", { presetParameter: false });

function loadGenerationPreset(name, shouldAnnounce = true) {
  const preset = GENERATION_RULE_PRESETS[name] ?? GENERATION_RULE_PRESETS.clean;
  state.generationPreset = Object.prototype.hasOwnProperty.call(GENERATION_RULE_PRESETS, name) ? name : "clean";
  state.timeRatio = preset.timeRatio;
  state.generationAngle = preset.angle;
  state.generationAsymmetry = preset.asymmetry;
  state.generationPitchScale = preset.pitchScale;
  applyAudioParameters();
  updateUi();
  if (shouldAnnounce) announce(`${preset.label} generation rule loaded.`);
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

function applyPreset(name) {
  const preset = MICMIC_PRESETS[name];
  if (!preset) return;
  Object.assign(state, preset, { preset: name });
  applyAudioParameters();
  updateUi();
  announce(`${preset.label} recursion loaded.`);
}

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-preset]");
  if (button) applyPreset(button.dataset.preset);
});

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
