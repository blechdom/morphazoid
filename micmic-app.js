import {
  FIXED_FORK_DENSITY,
  MICMIC_PRESETS,
  GENERATION_RULE_PRESETS,
  MAX_ADAPTIVE_GENERATION_VOICES,
  MAX_GENERATION_STAGES,
  MAX_GENERATION_VOICES,
  clamp,
  generationTopology,
  generationVoiceSpecs,
  recursionParameters,
  sliderFromTimeFold,
  timeFoldFromSlider,
} from "./src/micmic.js?v=20260726-independent-timing";
import { AdaptivePolyphonyController } from "./src/adaptive-polyphony.js";
import {
  GRANULAR_ECONOMY_PITCH_CLASSES,
  GranularEconomyRenderer,
} from "./src/granular-economy-renderer.js?v=20260725-presets";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { SignalsmithGenerationBank } from "./src/signalsmith-generation-bank.js?v=20260725-presets";

const $ = (id) => document.getElementById(id);
const GENERATION_COLORS = ["#fff3d6", "#55d9ff", "#5fe8c4", "#7db4ff", "#c79bff", "#ff826f", "#e8c46b"];
const REDUCED_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const GENERATION_CAPACITY_MODE = "sine";
const MIN_ADAPTIVE_GENERATION_VOICES = 32;
const MAX_PARTIAL_TELEMETRY_VOICES = 256;
const GENERATION_RENDERER_READY_TIMEOUT = 1_200;
const GENERATION_HISTORY_SECONDS = 40;
const SIGNALSMITH_PITCH_DETAIL_OPTIONS = Object.freeze([3, 7, 10, 16]);
const PITCH_DETAIL_OPTIONS = Object.freeze([
  ...SIGNALSMITH_PITCH_DETAIL_OPTIONS,
  GRANULAR_ECONOMY_PITCH_CLASSES,
]);
const DEFAULT_STATE = Object.freeze({
  ...MICMIC_PRESETS.bloom,
  inputTrim: 0.85,
  level: 0.58,
  mic: false,
  starting: false,
  frozen: false,
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
  pruningBias: 0,
  pitchDetail: GRANULAR_ECONOMY_PITCH_CLASSES,
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
let generationCapacityController = createGenerationCapacityController();
let generationCapacityStatus = generationCapacityController.decision(GENERATION_CAPACITY_MODE);
let generationVoiceLimit = MAX_GENERATION_VOICES;
let generationVoiceDemand = 0;
let generationStructuralDemand = 0;
let generationRenderCapacity = null;
let generationRenderCapacityActive = false;
let generationRenderCapacityHasSample = false;
let generationRenderCapacitySampleAt = -Infinity;
let lastPlaybackStatsAt = -Infinity;
let lastUnderrunEvents = 0;
let lastUnderrunDuration = 0;
let generationBankRevision = 0;
let generationPitchDetailReport = null;
let pitchDetailChanging = false;
const ENVELOPE_HISTORY_SECONDS = 40;
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

function normalizePitchDetail(value, fallback = GRANULAR_ECONOMY_PITCH_CLASSES) {
  const amount = Math.round(Number(value));
  return PITCH_DETAIL_OPTIONS.includes(amount) ? amount : fallback;
}

function isGranularPitchDetail(value = state.pitchDetail) {
  return normalizePitchDetail(value) === GRANULAR_ECONOMY_PITCH_CLASSES;
}

function pitchDetailSelectionLabel(value = state.pitchDetail) {
  return isGranularPitchDetail(value)
    ? "Maximum"
    : `${normalizePitchDetail(value)}-lane pitch detail`;
}

function createGenerationCapacityController(
  initialVoices = MAX_GENERATION_VOICES,
) {
  const baseline = Math.max(
    MIN_ADAPTIVE_GENERATION_VOICES,
    Math.min(MAX_GENERATION_VOICES, Math.round(Number(initialVoices) || 0)),
  );
  const hardLimits = Object.fromEntries(
    ["sine", "fm", "pm", "shepard"].map((mode) => [
      mode,
      MAX_ADAPTIVE_GENERATION_VOICES,
    ]),
  );
  return new AdaptivePolyphonyController({
    initialVoices: baseline,
    minVoices: MIN_ADAPTIVE_GENERATION_VOICES,
    hardLimits,
    growBelow: 0.35,
    growPeakBelow: 0.6,
    targetLoad: 0.5,
    shrinkAbove: 0.65,
    shrinkPeakAbove: 0.85,
    growAfter: 4,
    shrinkAfter: 2,
    growthFactor: 1.25,
    cooldownWindows: 20,
  });
}

function hasFreshGenerationRenderCapacity() {
  return generationRenderCapacityHasSample
    && performance.now() - generationRenderCapacitySampleAt < 2_000;
}

function isPartialCapacitySource(source) {
  return [
    "signalsmith-mixer",
    "granular-economy",
    "granular-fallback",
  ].includes(source);
}

function voiceLimitForCapacityDecision(decision) {
  if (decision?.source === "playback-stats") {
    return Math.max(
      MIN_ADAPTIVE_GENERATION_VOICES,
      Math.min(
        MAX_ADAPTIVE_GENERATION_VOICES,
        generationVoiceLimit,
        decision?.limit ?? generationVoiceLimit,
      ),
    );
  }
  const telemetryGuard = (
    decision?.source === "render-capacity"
    && hasFreshGenerationRenderCapacity()
  )
    ? MAX_ADAPTIVE_GENERATION_VOICES
    : decision?.telemetry === "available" && isPartialCapacitySource(decision?.source)
      ? MAX_PARTIAL_TELEMETRY_VOICES
      : MAX_GENERATION_VOICES;
  return Math.max(
    MIN_ADAPTIVE_GENERATION_VOICES,
    Math.min(telemetryGuard, decision?.limit ?? MAX_GENERATION_VOICES),
  );
}

function applyGenerationCapacityDecision(decision) {
  if (!decision) return;
  const nextLimit = voiceLimitForCapacityDecision(decision);
  const limitChanged = nextLimit !== generationVoiceLimit;
  generationCapacityStatus = decision;
  generationVoiceLimit = nextLimit;
  if (limitChanged && graph && state.mic) applyAudioParameters();
  updateUi();
}

function resetGenerationCapacityCalibration() {
  const baseline = Math.max(
    MIN_ADAPTIVE_GENERATION_VOICES,
    Math.min(MAX_GENERATION_VOICES, generationVoiceLimit),
  );
  generationCapacityController = createGenerationCapacityController(baseline);
  generationCapacityStatus = generationCapacityController.decision(
    GENERATION_CAPACITY_MODE,
  );
  generationVoiceLimit = baseline;
  generationRenderCapacityHasSample = false;
  generationRenderCapacitySampleAt = -Infinity;
  if (graph && audioContext) applyAudioParameters();
}

function currentTelemetryRenderer() {
  return graph?.directRendererKind ?? "granular-fallback";
}

function observeGenerationRenderLoad(report) {
  if (report?.type !== "render-load") return;
  if (report.supported === false) {
    if (!hasFreshGenerationRenderCapacity()) {
      generationRenderCapacityHasSample = false;
      generationCapacityController.setTelemetryUnavailable("safe-fallback");
      applyGenerationCapacityDecision(
        generationCapacityController.decision(GENERATION_CAPACITY_MODE),
      );
    }
    return;
  }
  if (hasFreshGenerationRenderCapacity()) return;
  generationRenderCapacityHasSample = false;
  if (report.timing !== "high-res") return;
  if (report.renderer && report.renderer !== currentTelemetryRenderer()) return;
  applyGenerationCapacityDecision(generationCapacityController.observe({
    mode: GENERATION_CAPACITY_MODE,
    averageLoad: report.averageLoad,
    peakLoad: report.peakLoad,
    underrunRatio: 0,
    activeVoices: report.renderedVoices ?? report.activeVoices,
    requestedVoices: generationVoiceDemand,
    source: report.renderer ?? "worklet",
    valid: report.supported !== false,
  }));
}

function startGenerationCapacityMonitoring(audio) {
  let capacity = null;
  try {
    capacity = audio?.renderCapacity;
  } catch {
    return;
  }
  if (!capacity || typeof capacity.start !== "function") return;
  try {
    generationRenderCapacityHasSample = false;
    capacity.onupdate = (event) => {
      const averageLoad = Number(event?.averageLoad);
      const peakLoad = Number(event?.peakLoad);
      if (!Number.isFinite(averageLoad) || !Number.isFinite(peakLoad)) return;
      generationRenderCapacityHasSample = true;
      generationRenderCapacitySampleAt = performance.now();
      applyGenerationCapacityDecision(generationCapacityController.observe({
        mode: GENERATION_CAPACITY_MODE,
        averageLoad,
        peakLoad,
        underrunRatio: event?.underrunRatio,
        activeVoices: graph?.generationVoices?.length ?? 0,
        requestedVoices: generationVoiceDemand,
        source: "render-capacity",
      }));
    };
    capacity.start({ updateInterval: 0.5 });
    generationRenderCapacity = capacity;
    generationRenderCapacityActive = true;
  } catch {
    capacity.onupdate = null;
    generationRenderCapacity = null;
    generationRenderCapacityActive = false;
  }
}

function stopGenerationCapacityMonitoring() {
  if (generationRenderCapacity) {
    try {
      generationRenderCapacity.stop?.();
    } catch {
      // Closing AudioContext may already have stopped monitoring.
    }
    generationRenderCapacity.onupdate = null;
  }
  generationRenderCapacity = null;
  generationRenderCapacityActive = false;
  generationRenderCapacityHasSample = false;
  generationRenderCapacitySampleAt = -Infinity;
}

function pollGenerationPlaybackStats() {
  if (!audioContext || !state.mic) return;
  const now = Number(audioContext.currentTime) || 0;
  if (now - lastPlaybackStatsAt < 1) return;
  lastPlaybackStatsAt = now;
  if (
    generationRenderCapacityHasSample
    && !hasFreshGenerationRenderCapacity()
  ) {
    generationRenderCapacityHasSample = false;
    generationCapacityController.setTelemetryUnavailable("stale-render-capacity");
    applyGenerationCapacityDecision(
      generationCapacityController.decision(GENERATION_CAPACITY_MODE),
    );
  }
  let stats = null;
  try {
    stats = audioContext.playbackStats;
  } catch {
    return;
  }
  if (!stats) return;
  const events = Math.max(0, Number(stats.underrunEvents) || 0);
  const duration = Math.max(0, Number(stats.underrunDuration) || 0);
  const hadUnderrun = events > lastUnderrunEvents
    || duration > lastUnderrunDuration + 1e-6;
  lastUnderrunEvents = events;
  lastUnderrunDuration = duration;
  if (!hadUnderrun) return;
  applyGenerationCapacityDecision(generationCapacityController.observe({
    mode: GENERATION_CAPACITY_MODE,
    averageLoad: 1,
    peakLoad: 1,
    underrunRatio: 1,
    activeVoices: graph?.generationVoices?.length ?? 0,
    requestedVoices: generationVoiceDemand,
    source: "playback-stats",
  }));
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

function currentGenerationVoiceSpecs(maximumVoices) {
  return generationVoiceSpecs({
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
    pruningBias: state.pruningBias,
    maximumVoices,
  });
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
  generationStructuralDemand = Math.max(0, topology.length - 1);
  const allVoices = currentGenerationVoiceSpecs(MAX_ADAPTIVE_GENERATION_VOICES);
  generationVoiceDemand = allVoices.length;
  const voices = generationVoiceDemand <= generationVoiceLimit
    ? allVoices
    : currentGenerationVoiceSpecs(generationVoiceLimit);
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
  const timing = Array.from({ length: Math.min(4, state.generations) }, (_, generation) => (
    state.interval * state.timeRatio ** generation
  ));
  const turns = generationTurns();
  const toOctavePercent = (degrees) => (
    degrees / 180 * state.generationPitchScale * 100
  );
  for (const name of Object.keys(GENERATION_RULE_PRESETS)) {
    setPressed($(`generationPreset-${name}`), state.generationPreset === name);
  }
  $("generationPresetDescription").textContent = state.generationPreset === "custom"
    ? "Your current hand-shaped combination of recursion controls."
    : GENERATION_RULE_PRESETS[state.generationPreset]?.description ?? "";
  const finalTiming = state.interval * state.timeRatio ** state.generations;
  $("generationTimingReadout").textContent = (
    timing.map(formatMilliseconds).join(" → ")
    + (state.generations > timing.length
      ? ` … ${formatMilliseconds(finalTiming)} at G${state.generations}`
      : "")
  );
  $("generationPitchReadout").textContent = (
    `${signed(turns.left, "°")} → ${signed(toOctavePercent(turns.left), "% octave")}`
    + ` · ${signed(turns.right, "°")} → ${signed(toOctavePercent(turns.right), "% octave")}`
  );
  generationVisualModel = buildGenerationVisualModel();
  const generationCounts = Array.from({ length: state.generations + 1 }, (_, generation) => (
    generationVisualModel.topology.filter((node) => node.generation === generation).length
  ));
  const shownCounts = generationCounts.slice(0, 6);
  $("generationCountReadout").textContent = (
    shownCounts.join(" → ")
    + (generationCounts.length > shownCounts.length
      ? ` → … → ${generationCounts.at(-1)} at G${state.generations}`
      : "")
  );
  $("currentSettingsSummary").textContent = (
    `${state.generations} gen · ${formatMilliseconds(state.interval)} root fold`
  );
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
  const currentRendererGain = audio.createGain();
  const wetBus = audio.createGain();
  const wetGain = audio.createGain();
  const mixBus = audio.createGain();
  const safetyAnalyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const ceiling = createShaper(audio, makeCeilingCurve());
  const masterGain = audio.createGain();

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
  seedGate.gain.value = 0;
  dryGain.gain.value = 0;
  tapA.gain.value = 0.7;
  tapB.gain.value = 0.7;
  currentRendererGain.gain.value = 1;
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

  connect(currentRendererGain, wetBus);
  connect(wetBus, wetGain);
  connect(wetGain, mixBus);
  connect(mixBus, safetyAnalyser);
  connect(safetyAnalyser, compressor);
  setCompressorParameters(compressor, audio.currentTime);
  connect(compressor, ceiling);
  connect(ceiling, masterGain);
  const releaseAudioOutput = connectAudioOutput(audio, masterGain, { runtime: globalThis });

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
    currentRendererGain,
    wetBus,
    wetGain,
    safetyAnalyser,
    masterGain,
    releaseAudioOutput,
    lfo,
    modulationA,
    modulationB,
  };
}

function waitForGenerationRendererReady(node, expectedRenderer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error("The granular audio renderer did not become ready."));
    }, GENERATION_RENDERER_READY_TIMEOUT);
    node.port.onmessage = (event) => {
      const report = event?.data;
      if (report?.type === "renderer-ready") {
        if (report.renderer !== expectedRenderer) {
          finish(reject, new Error("The granular audio renderer reported the wrong mode."));
          return;
        }
        finish(resolve);
        return;
      }
      observeGenerationRenderLoad(report);
    };
    node.onprocessorerror = () => {
      finish(reject, new Error("The granular audio renderer could not start."));
    };
    node.port.start?.();
  });
}

function handleEconomyRendererError(audio, audioGraph, node) {
  if (
    audioContext !== audio
    || graph !== audioGraph
    || audioGraph.generationNode !== node
  ) return;
  audioGraph.generationNode = null;
  audioGraph.generationRenderer = null;
  audioGraph.directRendererKind = "bounded-fallback";
  audioGraph.pitchEngineState = "unavailable";
  try {
    audioGraph.seedGate.disconnect?.(node);
    node.disconnect?.();
    node.onprocessorerror = null;
    node.port.onmessage = null;
    node.port.close?.();
  } catch {
    // The failed processor may already have detached itself.
  }
  resetGenerationCapacityCalibration();
  updateUi();
  showError("Economy pitch stopped. The bounded audio fallback is still running.");
  announce("Economy pitch stopped. The bounded audio fallback is active.");
}

async function prepareGenerationProcessor(audio, audioGraph) {
  const WorkletNode = globalThis.AudioWorkletNode;
  if (!audio.audioWorklet?.addModule || !WorkletNode) return;
  const pitchSources = normalizePitchDetail(state.pitchDetail);
  const useGranularEconomy = isGranularPitchDetail(pitchSources);
  const directRendererKind = useGranularEconomy
    ? "granular-economy"
    : "granular-fallback";
  let node = null;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/micmic-generation-processor.js?v=20260725-presets", import.meta.url),
    );
    if (audioContext !== audio || graph !== audioGraph || audio.state === "closed") return;
    node = new WorkletNode(audio, "morphazoid-micmic-generations", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        historySeconds: GENERATION_HISTORY_SECONDS,
        maxVoices: MAX_ADAPTIVE_GENERATION_VOICES,
        renderer: directRendererKind,
      },
    });
    audioGraph.seedGate.connect(node);
    node.connect(audioGraph.currentRendererGain);
    await waitForGenerationRendererReady(node, directRendererKind);
    if (audioContext !== audio || graph !== audioGraph || audio.state === "closed") {
      node.disconnect?.();
      node.port.onmessage = null;
      node.port.close?.();
      return;
    }
    audioGraph.generationNode = node;
    audioGraph.directRendererKind = directRendererKind;
    audioGraph.pitchEngineState = "loading";
    audioGraph.generationRenderer = {
      setVoices(voices, options = {}) {
        node.port.postMessage({ type: "voices", voices, ...options });
      },
    };
    const bankRevision = ++generationBankRevision;
    generationPitchDetailReport = null;

    if (useGranularEconomy) {
      let economyRenderer = null;
      economyRenderer = new GranularEconomyRenderer(node, {
        maxPitchSources: pitchSources,
        maxVoices: MAX_ADAPTIVE_GENERATION_VOICES,
        onPitchDetail(report) {
          if (
            bankRevision !== generationBankRevision
            || audioContext !== audio
            || graph !== audioGraph
            || audioGraph.generationRenderer !== economyRenderer
          ) return;
          generationPitchDetailReport = report;
          updateUi();
        },
      });
      audioGraph.generationRenderer = economyRenderer;
      audioGraph.pitchEngineState = "economy-ready";
      node.onprocessorerror = () => handleEconomyRendererError(
        audio,
        audioGraph,
        node,
      );
      announce(`Economy ${pitchSources}-class granular pitch engine ready.`);
      updateUi();
      return;
    }

    // Keep the fused granular processor audible while the larger spectral
    // WASM pool loads, then switch atomically to the selected Silky bank.
    const bankCreation = SignalsmithGenerationBank.create(
      audio,
      audioGraph.seedGate,
      audioGraph.currentRendererGain,
      {
        maxPitchSources: pitchSources,
        maxVoices: MAX_ADAPTIVE_GENERATION_VOICES,
        historySeconds: GENERATION_HISTORY_SECONDS,
        onRenderLoad: observeGenerationRenderLoad,
        onPitchDetail(report) {
          if (
            bankRevision !== generationBankRevision
            || audioContext !== audio
            || graph !== audioGraph
            || audioGraph.generationBank?.maxPitchSources !== pitchSources
          ) return;
          generationPitchDetailReport = report;
          updateUi();
        },
      },
    );
    let managedBankCreation;
    managedBankCreation = bankCreation.then(async (bank) => {
      if (
        bankRevision !== generationBankRevision
        || audioContext !== audio
        || graph !== audioGraph
        || audio.state === "closed"
      ) {
        await bank.dispose();
        return null;
      }
      audioGraph.seedGate.disconnect?.(node);
      node.port.postMessage?.({ type: "voices", voices: [] });
      node.disconnect?.();
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.close?.();
      audioGraph.generationBank = bank;
      audioGraph.generationNode = bank;
      audioGraph.generationRenderer = bank;
      audioGraph.directRendererKind = "signalsmith-mixer";
      audioGraph.pitchEngineState = "ready";
      bank.setVoices(
        audioGraph.generationVoices ?? [],
        audioGraph.generationVoiceOptions ?? {},
      );
      announce(`Silky ${pitchSources}-lane pitch engine ready.`);
      updateUi();
      return bank;
    }).catch(() => {
      // The exact-delay/granular processor remains the offline-safe fallback.
      if (
        bankRevision === generationBankRevision
        && audioContext === audio
        && graph === audioGraph
      ) {
        audioGraph.pitchEngineState = "fallback";
        updateUi();
      }
      return null;
    }).finally(() => {
      if (audioGraph.generationBankPromise === managedBankCreation) {
        audioGraph.generationBankPromise = null;
      }
    });
    audioGraph.generationBankPromise = managedBankCreation;
    void managedBankCreation;
  } catch {
    // The bounded feedback matrix remains the compatible fallback.
    try {
      audioGraph.seedGate.disconnect?.(node);
      node?.disconnect?.();
      if (node) node.onprocessorerror = null;
      if (node?.port) {
        node.port.onmessage = null;
        node.port.close?.();
      }
    } catch {
      // A processor-constructor failure may already have detached the node.
    }
    audioGraph.generationNode = null;
    audioGraph.generationRenderer = null;
    audioGraph.directRendererKind = "bounded-fallback";
    audioGraph.pitchEngineState = "unavailable";
  }
}

async function ensureAudioGraph() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
  if (!audioContext || audioContext.state === "closed") {
    stopGenerationCapacityMonitoring();
    generationCapacityController = createGenerationCapacityController();
    generationCapacityStatus = generationCapacityController.decision(GENERATION_CAPACITY_MODE);
    generationVoiceLimit = MAX_GENERATION_VOICES;
    lastPlaybackStatsAt = -Infinity;
    lastUnderrunEvents = 0;
    lastUnderrunDuration = 0;
    audioContext = new AudioContextClass();
    unlockAudioContext(audioContext);
    await audioContext.resume();
    graph = buildAudioGraph(audioContext);
    inputWave = new Float32Array(graph.inputAnalyser.fftSize);
    safetyWave = new Float32Array(graph.safetyAnalyser.fftSize);
    audioContext.addEventListener?.("statechange", updateUi);
    await prepareGenerationProcessor(audioContext, graph);
    startGenerationCapacityMonitoring(audioContext);
  }
  if (audioContext.state !== "running") {
    unlockAudioContext(audioContext);
    await audioContext.resume();
  }
  return audioContext;
}

async function changePitchDetail(value) {
  const nextDetail = normalizePitchDetail(value, state.pitchDetail);
  if (
    nextDetail === state.pitchDetail
    || state.mic
    || state.starting
    || pitchDetailChanging
    || audioChanging
  ) {
    updateUi();
    return;
  }

  state.pitchDetail = nextDetail;
  generationPitchDetailReport = null;
  const closingAudio = audioContext;
  const closingGraph = graph;
  if (!closingAudio || closingAudio.state === "closed") {
    updateUi();
    announce(`${pitchDetailSelectionLabel(nextDetail)} selected. It will load when audio starts.`);
    return;
  }

  pitchDetailChanging = true;
  audioChanging = true;
  ++microphoneGeneration;
  ++generationBankRevision;
  stopGenerationCapacityMonitoring();
  updateUi();

  try {
    closingGraph?.lfo?.stop?.();
  } catch {
    // The stopped graph may already have released its processors.
  }
  try {
    await closingGraph?.generationBankPromise;
  } catch {
    // A rejected bank creation has already cleaned up its partial pool.
  }
  try {
    await closingGraph?.generationBank?.dispose?.();
  } catch {
    // Closing the context below remains the final resource guard.
  }
  closingGraph?.releaseAudioOutput?.();
  if (audioContext === closingAudio) audioContext = null;
  if (graph === closingGraph) graph = null;
  try {
    await closingAudio.close?.();
  } catch {
    // A fresh context can still be created after a browser-side close error.
  } finally {
    pitchDetailChanging = false;
    audioChanging = false;
    updateUi();
    announce(`${pitchDetailSelectionLabel(nextDetail)} selected. It will load on the next Start.`);
  }
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
  const topology = generationTopology({
    generations: state.generations,
    branching: state.branching,
    mutation: state.mutation,
    timeRatio: state.timeRatio,
    angle: state.generationAngle,
    asymmetry: state.generationAsymmetry,
  });
  generationStructuralDemand = Math.max(0, topology.length - 1);
  const allGenerationVoices = currentGenerationVoiceSpecs(
    MAX_ADAPTIVE_GENERATION_VOICES,
  );
  generationVoiceDemand = allGenerationVoices.length;
  const capacityDecision = generationCapacityController.setDemand(
    GENERATION_CAPACITY_MODE,
    active ? generationVoiceDemand : 0,
  );
  generationCapacityStatus = capacityDecision;
  generationVoiceLimit = voiceLimitForCapacityDecision(capacityDecision);
  const generationVoices = !active
    ? []
    : generationVoiceDemand <= generationVoiceLimit
      ? allGenerationVoices
      : currentGenerationVoiceSpecs(generationVoiceLimit);
  const voiceOptions = {
    requestedVoiceCount: active ? generationVoiceDemand : 0,
    voiceLimit: generationVoiceLimit,
  };
  graph.generationVoices = generationVoices;
  graph.generationVoiceOptions = voiceOptions;
  graph.generationRenderer?.setVoices(generationVoices, voiceOptions);
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
    announce("L-mic microphone on. Speak to seed the echo tree.");
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

function stopMicrophone(message = "L-mic microphone off.", shouldAnnounce = true) {
  ++microphoneGeneration;
  state.starting = false;
  state.mic = false;
  state.frozen = false;
  audioChanging = false;
  applyAudioParameters(true);
  releaseMicrophone();
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
  pollGenerationPlaybackStats();
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

function paintGenerationCapacity() {
  const structuralDemand = Math.max(
    generationStructuralDemand,
    (generationVisualModel?.topology.length ?? 1) - 1,
  );
  const inHistoryDemand = Math.min(generationVoiceDemand, structuralDemand);
  const renderedVoiceCount = Math.min(generationVoiceLimit, inHistoryDemand);
  const adjusted = renderedVoiceCount < inHistoryDemand
    ? " · device-adjusted"
    : "";
  const historyLimited = inHistoryDemand < structuralDemand
    ? ` · ${(structuralDemand - inHistoryDemand).toLocaleString("en-US")} beyond 39 s`
    : "";
  $("generationCapacityInline").textContent = (
    `${renderedVoiceCount} of ${inHistoryDemand.toLocaleString("en-US")} branches`
    + ` ${state.mic ? "active" : "ready"}`
    + ` · ${pruningBiasLabel(state.pruningBias)} pruning${adjusted}${historyLimited}`
  );
}

function pruningBiasLabel(value) {
  const amount = clamp(value);
  if (amount <= 0.02) return "breadth first";
  if (amount >= 0.98) return "depth first";
  if (Math.abs(amount - 0.5) <= 0.02) return "balanced";
  return `${Math.round(amount * 100)}% depth`;
}

function paintPitchDetail() {
  const control = $("pitchDetail");
  const granularEconomy = isGranularPitchDetail();
  control.value = String(state.pitchDetail);
  control.disabled = Boolean(
    state.mic || state.starting || pitchDetailChanging || audioChanging,
  );

  let status = granularEconomy
    ? "Maximum economy · 0 active shifted pitches · exact unison"
    : `${state.pitchDetail} shifted lanes · exact unison`;
  if (pitchDetailChanging) {
    status = granularEconomy
      ? "Retiring the old pitch engine · Maximum economy next"
      : `Retiring the old pitch engine · ${state.pitchDetail} lanes next`;
  } else if (
    state.mic
    && ["signalsmith-mixer", "granular-economy"].includes(
      graph?.directRendererKind,
    )
  ) {
    const report = generationPitchDetailReport;
    if (report?.requestedPitchClasses > 0) {
      status = granularEconomy
        ? `Maximum economy · ${report.exactShiftedPitches} active shifted pitches`
        : `${report.requestedPitchClasses} requested · ${report.renderedPitchClasses} distinct rendered`;
      if (granularEconomy && report.requestedShiftedPitches > 0) {
        status += ` of ${report.requestedShiftedPitches} requested`;
      }
      if (report.mergedShiftedPitches > 0) {
        status += ` · ${report.mergedShiftedPitches} merged`;
      }
      if (report.unisonActive) status += " · exact unison";
    } else {
      status = granularEconomy
        ? "Maximum economy · 0 active shifted pitches · measuring pitch map…"
        : `${state.pitchDetail} shifted lanes · measuring pitch map…`;
    }
  } else if (
    granularEconomy
    && state.mic
    && graph?.pitchEngineState === "unavailable"
  ) {
    status = "Maximum economy unavailable · bounded audio fallback";
  } else if (
    state.mic
    && ["fallback", "unavailable"].includes(graph?.pitchEngineState)
  ) {
    status = `${state.pitchDetail}-lane silky engine unavailable · granular fallback`;
  } else if (state.mic) {
    status = granularEconomy
      ? "Maximum economy loading · 0 active shifted pitches"
      : `${state.pitchDetail} shifted lanes selected · silky engine loading…`;
  }
  $("pitchDetailStatus").textContent = status;
}

function paintControls() {
  const values = {
    level: [state.level, `${Math.round(state.level * 100)}%`],
    inputTrim: [state.inputTrim, `${Math.round(state.inputTrim * 100)}%`],
    generations: [state.generations, `${state.generations} / ${MAX_GENERATION_STAGES}`],
    depth: [state.depth, `${Math.round(state.depth * 100)}%`],
    interval: [Math.round(sliderFromTimeFold(state.interval)), formatMilliseconds(state.interval)],
    mutation: [state.mutation, `${Math.round(state.mutation * 100)}% rule variance`],
    timeRatio: [state.timeRatio, `${state.timeRatio.toFixed(2)}× per generation`],
    generationAngle: [state.generationAngle, `${Number(state.generationAngle.toFixed(1))}°`],
    generationAsymmetry: [state.generationAsymmetry, state.generationAsymmetry === 0 ? "even" : `${Math.round(Math.abs(state.generationAsymmetry) * 100)}% ${state.generationAsymmetry < 0 ? "left wider" : "right wider"}`],
    generationPitchScale: [
      state.generationPitchScale,
      `${Math.round(state.generationPitchScale * 100)}% / 180°`,
    ],
    pruningBias: [state.pruningBias, pruningBiasLabel(state.pruningBias)],
    wet: [state.wet, `${Math.round(state.wet * 100)}%`],
    dry: [state.dry, state.dry <= 0.001 ? "muted" : `${Math.round(state.dry * 100)}%`],
    spread: [state.spread, `${Math.round(state.spread * 100)}%`],
  };
  for (const [id, [value, output]] of Object.entries(values)) {
    $(id).value = String(value);
    $(`${id}Out`).textContent = output;
  }
  $("pruningBias").setAttribute(
    "aria-valuetext",
    pruningBiasLabel(state.pruningBias),
  );
  $("interval").setAttribute(
    "aria-valuetext",
    formatMilliseconds(state.interval),
  );
  $("timeRatio").setAttribute(
    "aria-valuetext",
    `${state.timeRatio.toFixed(2)}× per generation`,
  );
}

function updateUi() {
  const generations = state.generations;
  const label = presetLabel();
  const live = state.mic;
  const starting = state.starting;
  const controlsChanging = starting || pitchDetailChanging || audioChanging;
  const audioState = live ? "on" : "off";

  paintControls();
  paintPitchDetail();
  renderGenerationRules();
  paintGenerationCapacity();
  setPressed($("audioButton"), live);
  $("audioButton").disabled = controlsChanging;
  $("audioState").textContent = audioState;
  setPressed($("micButton"), live && !state.frozen);
  $("micButton").disabled = controlsChanging;
  $("micButtonLabel").textContent = starting
    ? "Allow microphone"
    : live ? (state.frozen ? "Resume input" : "Pause input") : "Start input";
  $("micButtonHint").textContent = starting
    ? "permission pending"
    : live
      ? (state.frozen ? "input paused" : "microphone live")
      : "microphone off";
  setPressed($("freezeButton"), false);
  $("freezeButton").disabled = !live;
  $("freezeLabel").textContent = "Stop audio";
  $("freezeHint").textContent = live ? "recursive tail active" : "tail clear";
  $("panicButton").disabled = !live && !starting;
  $("seedMicButton").disabled = controlsChanging;
  setPressed($("seedMicButton"), live && !state.frozen);
  const seedLabel = starting
    ? "Allow microphone"
    : live ? (state.frozen ? "Resume input" : "Pause input") : "Start input";
  $("seedMicButton").querySelector("b").textContent = seedLabel;
  $("seedMicButton").setAttribute("aria-label", seedLabel);
  $("listenSummary").textContent = pitchDetailChanging
    ? "changing pitch engine"
    : starting
      ? "waiting for permission"
      : live
        ? (state.frozen ? "input paused · tail live" : "microphone live")
        : "microphone off";
  $("presetSummary").textContent = `${label} · ${pitchDetailSelectionLabel()}`;
  $("recursionSummary").textContent = `${label} · ${generations} generations`;
  $("mixSummary").textContent = `${Math.round(state.wet * 100)}% descendants · ${state.dry ? `${Math.round(state.dry * 100)}% root` : "root muted"}`;
  $("generationKeyEnd").textContent = `G${generations} DESCENDANT`;
  $("stageReadout").textContent = `${live ? (state.frozen ? "INPUT PAUSED" : "MIC LIVE") : "MIC OFF"} · ${label.toUpperCase()} · ${generations} GENERATIONS`;
  const segmentCount = generationVisualModel?.topology.length ?? 0;
  const voiceCount = generationVisualModel?.voices.length ?? 0;
  const audibleCount = generationVisualModel?.voices.filter((voice) => (
    voice.gain * state.wet > 0.00001
  )).length ?? 0;
  canvas.setAttribute("aria-label", `Live fitted L-mic L-system tree. ${live ? state.frozen ? "Input paused; recursive tail live" : "Microphone live" : "Microphone off"}.`);
  $("treeDescription").textContent = `${label}. ${generations} generations and ${segmentCount} connected segments; ${audibleCount} of ${voiceCount} ${pruningBiasLabel(state.pruningBias)} delayed descendant paths carry audible gain. Microphone loudness travels outward from the seed by vibrating the branches.`;
}

function bindRange(id, key, marksGrowthCustom = false) {
  $(id).addEventListener("input", () => {
    state[key] = Number($(id).value);
    if (marksGrowthCustom) state.generationPreset = "custom";
    applyAudioParameters();
    updateUi();
  });
}

for (const id of ["generations", "depth", "mutation"]) {
  bindRange(id, id, true);
}
$("interval").addEventListener("input", () => {
  state.interval = timeFoldFromSlider($("interval").value);
  state.generationPreset = "custom";
  applyAudioParameters();
  updateUi();
});
bindRange("pruningBias", "pruningBias");
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

for (const name of Object.keys(GENERATION_RULE_PRESETS)) {
  $(`generationPreset-${name}`).addEventListener("click", () => (
    loadGenerationPreset(name)
  ));
}
$("resetGenerationRules").addEventListener("click", () => loadGenerationPreset(state.generationPreset));
$("pitchDetail").addEventListener("change", (event) => {
  void changePitchDetail(event.currentTarget.value);
});

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
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && (state.mic || state.starting)) {
    panic("Microphone stopped because L-mic moved to the background.");
  }
});

window.addEventListener("pagehide", () => {
  ++microphoneGeneration;
  generationBankRevision += 1;
  stopGenerationCapacityMonitoring();
  state.mic = false;
  applyAudioParameters(true);
  releaseMicrophone();
  try {
    graph?.lfo?.stop();
  } catch {
    // The oscillator may already have stopped during browser teardown.
  }
  graph?.releaseAudioOutput?.();
  void audioContext?.close?.();
});

new ResizeObserver(resizeStage).observe(stageWrap);
resizeStage();
updateUi();
requestAnimationFrame(frame);
