import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  SIMD_GRANULAR_DEFAULTS,
  SIMD_FREEZE_DEFAULTS,
  SIMD_IR_DEFAULTS,
  SIMD_MESH_DEFAULTS,
  SIMD_RESONATOR_DEFAULTS,
  SIMD_RESONATOR_MAX_MODES,
  SIMD_RESONATOR_WINDOW_NAMES,
  SIMD_SPATIAL_DEFAULTS,
  SIMD_SWARM_DEFAULTS,
  SIMD_WAVEGUIDE_DEFAULTS,
  createSimdAudioConfiguration,
  createSimdResonatorKernelViews,
  presetsForSimdEngine,
  sanitizeSimdFreezeSettings,
  sanitizeSimdGranularSettings,
  sanitizeSimdIrSettings,
  sanitizeSimdMeshSettings,
  sanitizeSimdResonatorSettings,
  sanitizeSimdSpatialSettings,
  sanitizeSimdSwarmSettings,
  sanitizeSimdWaveguideSettings,
  writeSimdAudioConfiguration,
} from "./src/simd-resonator.js";

const surface = document.body.dataset.simdSurface === "lab" ? "lab" : "resonator";
const isLabSurface = surface === "lab";
const AVAILABLE_ENGINES = Object.freeze(isLabSurface
  ? ["granular", "swarm", "freeze", "ir", "mesh", "waveguide", "spatial"]
  : ["resonator"]);
const INITIAL_ENGINE = AVAILABLE_ENGINES[0];
const DEMO_PRESET_BY_ENGINE = Object.freeze({
  granular: "granular:thicket",
  swarm: "swarm:chorus",
  freeze: "freeze:organ",
  ir: "ir:between",
  mesh: "mesh:drum",
  waveguide: "waveguide:steel",
  spatial: "spatial:left",
});

const elements = {
  audioButton: document.querySelector("#audioButton"), audioState: document.querySelector("#audioState"),
  outputLevel: document.querySelector("#outputLevel"), outputLevelOut: document.querySelector("#outputLevelOut"),
  canvas: document.querySelector("#resonatorCanvas"), canvasWrap: document.querySelector("#canvasWrap"),
  canvasCue: document.querySelector("#canvasCue"), strikeReadout: document.querySelector("#strikeReadout"),
  stageEngineName: document.querySelector("#stageEngineName"), micButton: document.querySelector("#micButton"),
  micButtonLabel: document.querySelector("#micButtonLabel"), micButtonHint: document.querySelector("#micButtonHint"),
  pluckButton: document.querySelector("#pluckButton"), inputSummary: document.querySelector("#inputSummary"),
  resonatorEngineButton: document.querySelector("#resonatorEngineButton"),
  granularEngineButton: document.querySelector("#granularEngineButton"),
  swarmEngineButton: document.querySelector("#swarmEngineButton"),
  freezeEngineButton: document.querySelector("#freezeEngineButton"),
  irEngineButton: document.querySelector("#irEngineButton"),
  meshEngineButton: document.querySelector("#meshEngineButton"),
  waveguideEngineButton: document.querySelector("#waveguideEngineButton"),
  spatialEngineButton: document.querySelector("#spatialEngineButton"),
  presetSelect: document.querySelector("#presetSelect"),
  presetDescription: document.querySelector("#presetDescription"),
  demoActionLabel: document.querySelector("#demoActionLabel"),
  demoDescription: document.querySelector("#demoDescription"),
  demoInputNote: document.querySelector("#demoInputNote"),
  engineSummary: document.querySelector("#engineSummary"),
  soundTitle: document.querySelector("#soundTitle"), bodySummary: document.querySelector("#bodySummary"),
  controls: ["A", "B", "C", "D"].map((suffix) => ({
    input: document.querySelector("#control" + suffix), label: document.querySelector("#control" + suffix + "Label"),
    output: document.querySelector("#control" + suffix + "Out"),
  })),
  backendMetric: document.querySelector("#backendMetric"), laneMetric: document.querySelector("#laneMetric"),
  modeMetric: document.querySelector("#modeMetric"), kernelMetric: document.querySelector("#kernelMetric"),
  fftMetric: document.querySelector("#fftMetric"), budgetMetric: document.querySelector("#budgetMetric"), resetButton: document.querySelector("#resetButton"),
  workerMetric: document.querySelector("#workerMetric"), workerNote: document.querySelector("#workerNote"),
  audioError: document.querySelector("#audioError"), liveStatus: document.querySelector("#liveStatus"),
  fftSummary: document.querySelector("#fftSummary"),
  fftSize: document.querySelector("#fftSize"), fftSizeOut: document.querySelector("#fftSizeOut"),
  fftWindow: document.querySelector("#fftWindow"),
  fftControls: ["fftHopRatio", "fftBandCount", "fftResponseMs", "fftDetail", "fftMix", "fftInputGain", "fftGateDb", "fftLowFrequency", "fftHighFrequency"].map((id) => ({
    input: document.querySelector("#" + id), output: document.querySelector("#" + id + "Out"), key: id,
  })),
};

const ENGINE_COPY = Object.freeze({
  resonator: Object.freeze({ title: "RESONATOR", short: "resonator", cue: "DRAG TO PLUCK", action: "PLUCK BODY", section: "Body", instruction: "TAP OR DRAG THE BODY", description: "A strike excites 128 independently ringing modes.", source: "Microphone input is split into FFT bands, phase-preserved, and resynthesized through the same body." }),
  granular: Object.freeze({ title: "GRAIN CLOUD", short: "grain cloud", cue: "HOLD FOR GRAINS", action: "PLAY GRAIN DEMO", section: "Cloud", instruction: "HOLD THE STAGE", description: "Short source fragments overlap from sparse dust to a solid cloud.", source: "Built-in texture or microphone input feeds the grain pool." }),
  swarm: Object.freeze({ title: "OSC SWARM", short: "osc swarm", cue: "HOLD FOR SWARM", action: "PLAY SWARM DEMO", section: "Swarm", instruction: "HOLD THE STAGE", description: "Up to 128 close oscillators gather around one pitch.", source: "Horizontal sets pitch; vertical opens the detune cloud." }),
  freeze: Object.freeze({ title: "SPECTRAL FREEZE", short: "spectral freeze", cue: "TAP TO FREEZE", action: "CAPTURE DEMO", section: "Spectrum", instruction: "TAP TO CAPTURE", description: "Parallel bins capture one instant, then sustain its spectrum.", source: "The capture comes from the built-in texture or live microphone." }),
  ir: Object.freeze({ title: "IR MORPH", short: "IR morph", cue: "TAP TO PROCESS", action: "PLAY SOURCE THROUGH IR", section: "Convolution", instruction: "PLAY THE SOURCE", description: "A four-hit phrase passes through two 128-tap filters and their morph.", source: "The IR shapes another sound; it is not the sound source. Mic can replace the demo." }),
  mesh: Object.freeze({ title: "MODAL MESH", short: "modal mesh", cue: "TAP THE MESH", action: "STRIKE MESH", section: "Mesh", instruction: "TAP A POSITION", description: "A strike excites a grid of modes that exchange energy.", source: "Position changes which parts of the virtual membrane ring." }),
  waveguide: Object.freeze({ title: "WAVEGUIDE BANK", short: "waveguide bank", cue: "DRAG TO PLUCK", action: "PLUCK STRING BANK", section: "Strings", instruction: "TAP OR DRAG TO PLUCK", description: "Sixteen parallel delay-line strings ring as one bank.", source: "Brightness damps each string; microphone input can drive the bank." }),
  spatial: Object.freeze({ title: "SPATIAL MIX", short: "spatial mix", cue: "HOLD FOR FIELD", action: "PLAY SPATIAL DEMO", section: "Field", instruction: "HOLD · USE HEADPHONES", description: "Parallel source gains place an oscillator field across stereo.", source: "Horizontal rotates the field; vertical changes the width of its arc." }),
});

const MIC_ENGINES = new Set(["resonator", "granular", "freeze", "ir", "waveguide"]);
const GATED_ENGINES = new Set(["granular", "swarm", "spatial"]);
const SOURCE_ENGINES = new Set(["granular", "freeze"]);
const RESONATOR_FFT_KEYS = Object.freeze([
  "fftSize", "fftWindow", "fftHopRatio", "fftBandCount", "fftResponseMs",
  "fftLowFrequency", "fftHighFrequency", "fftDetail", "fftMix", "fftInputGain", "fftGateDb",
]);

const CONTROL_SCHEMA = Object.freeze({
  resonator: Object.freeze([
    { key: "modeCount", label: "Modes", min: 32, max: 128, step: 4, format: (value) => String(Math.round(value)) },
    { key: "baseFrequency", label: "Base", min: 42, max: 220, step: 1, format: (value) => Math.round(value) + " Hz" },
    { key: "decaySeconds", label: "Decay", min: 0.35, max: 6, step: 0.05, format: (value) => Number(value).toFixed(2).replace(/0$/, "") + " s" },
    { key: "spread", label: "Spread", min: 0, max: 1, step: 0.01, format: percent },
  ]),
  granular: Object.freeze([
    { key: "grainCount", label: "Grains", min: 16, max: 64, step: 4, format: (value) => String(Math.round(value)) },
    { key: "density", label: "Density", min: 8, max: 720, step: 1, format: (value) => Math.round(value) + "/s" },
    { key: "grainSizeMs", label: "Size", min: 18, max: 260, step: 1, format: (value) => Math.round(value) + " ms" },
    { key: "pitchSemitones", label: "Pitch", min: -12, max: 12, step: 1, format: signedSemitones },
  ]),
  swarm: Object.freeze([
    { key: "voiceCount", label: "Voices", min: 16, max: 128, step: 4, format: (value) => String(Math.round(value)) },
    { key: "centerFrequency", label: "Center", min: 45, max: 880, step: 1, format: (value) => Math.round(value) + " Hz" },
    { key: "detuneCents", label: "Detune", min: 2, max: 90, step: 1, format: (value) => Math.round(value) + " ct" },
    { key: "stereoWidth", label: "Width", min: 0, max: 1, step: 0.01, format: percent },
  ]),
  freeze: Object.freeze([
    { key: "binCount", label: "Bins", min: 8, max: 64, step: 4, format: (value) => String(Math.round(value)) },
    { key: "holdSeconds", label: "Hold", min: 0.4, max: 30, step: 0.1, format: (value) => Number(value).toFixed(1) + " s" },
    { key: "tilt", label: "Tilt", min: -1, max: 1, step: 0.01, format: (value) => Math.round(value * 100) + "%" },
    { key: "stereoWidth", label: "Width", min: 0, max: 1, step: 0.01, format: percent },
  ]),
  ir: Object.freeze([
    { key: "tapCount", label: "Taps", min: 32, max: 128, step: 4, format: (value) => String(Math.round(value)) },
    { key: "morph", label: "Morph", min: 0, max: 1, step: 0.01, format: percent },
    { key: "decay", label: "Decay", min: 0.05, max: 1, step: 0.01, format: percent },
    { key: "tone", label: "Tone", min: 0, max: 1, step: 0.01, format: percent },
  ]),
  mesh: Object.freeze([
    { key: "modeCount", label: "Modes", min: 16, max: 64, step: 4, format: (value) => String(Math.round(value)) },
    { key: "baseFrequency", label: "Tension", min: 32, max: 180, step: 1, format: (value) => Math.round(value) + " Hz" },
    { key: "decaySeconds", label: "Decay", min: 0.3, max: 9, step: 0.1, format: (value) => Number(value).toFixed(1) + " s" },
    { key: "coupling", label: "Couple", min: 0, max: 1, step: 0.01, format: percent },
  ]),
  waveguide: Object.freeze([
    { key: "stringCount", label: "Strings", min: 4, max: 16, step: 4, format: (value) => String(Math.round(value)) },
    { key: "baseFrequency", label: "Base", min: 48, max: 440, step: 1, format: (value) => Math.round(value) + " Hz" },
    { key: "decaySeconds", label: "Decay", min: 0.25, max: 8, step: 0.05, format: (value) => Number(value).toFixed(1) + " s" },
    { key: "brightness", label: "Bright", min: 0.04, max: 1, step: 0.01, format: percent },
  ]),
  spatial: Object.freeze([
    { key: "sourceCount", label: "Sources", min: 8, max: 64, step: 4, format: (value) => String(Math.round(value)) },
    { key: "centerFrequency", label: "Center", min: 45, max: 660, step: 1, format: (value) => Math.round(value) + " Hz" },
    { key: "arcDegrees", label: "Arc", min: 20, max: 360, step: 1, format: (value) => Math.round(value) + "°" },
    { key: "rotationDegrees", label: "Rotate", min: -180, max: 180, step: 1, format: (value) => Math.round(value) + "°" },
  ]),
});

const canvasContext = elements.canvas.getContext("2d", { alpha: false });
const forceScalar = new URLSearchParams(globalThis.location.search).get("scalar") === "1";
const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
const state = {
  engine: INITIAL_ENGINE,
  settings: {
    resonator: { ...SIMD_RESONATOR_DEFAULTS }, granular: { ...SIMD_GRANULAR_DEFAULTS }, swarm: { ...SIMD_SWARM_DEFAULTS },
    freeze: { ...SIMD_FREEZE_DEFAULTS }, ir: { ...SIMD_IR_DEFAULTS }, mesh: { ...SIMD_MESH_DEFAULTS },
    waveguide: { ...SIMD_WAVEGUIDE_DEFAULTS }, spatial: { ...SIMD_SPATIAL_DEFAULTS },
  },
  requestedBackend: forceScalar ? "scalar" : "simd", backend: "none", simdAvailable: null, laneWidth: 0,
  context: null, node: null, limiter: null, masterGain: null, releaseOutput: null,
  audioReady: false, audioStarting: false, workletBooted: false, suspendedForVisibility: false,
  micStream: null, micSource: null, micStarting: false, micRequestGeneration: 0,
  worker: null, workerMode: "idle", workerControl: null, workerError: "",
  signalEnergy: new Float32Array(SIMD_RESONATOR_MAX_MODES), signalState: new Float32Array(SIMD_RESONATOR_MAX_MODES),
  fftInput: new Float32Array(SIMD_RESONATOR_MAX_MODES), fftOutput: new Float32Array(SIMD_RESONATOR_MAX_MODES),
  fftAnalysisMicros: null, fftTelemetryBands: SIMD_RESONATOR_DEFAULTS.fftBandCount,
  timings: Object.fromEntries(Object.keys(ENGINE_COPY).map((engine) => [engine, { scalar: null, simd: null }])),
  timingSource: Object.fromEntries(Object.keys(ENGINE_COPY).map((engine) => [engine, { scalar: null, simd: null }])),
  kernelMicros: null, budgetMicros: null, peak: 0, rms: 0,
  pointerActive: false, pointerId: null, keyboardGate: false, lastDragTrigger: 0,
  auditionTimer: 0,
  frameRequest: 0, disposed: false,
  presetId: null,
};

if (isLabSurface) {
  const initialPreset = presetsForSimdEngine(INITIAL_ENGINE).find((entry) => entry.id === DEMO_PRESET_BY_ENGINE[INITIAL_ENGINE]);
  if (initialPreset) {
    state.settings[INITIAL_ENGINE] = { ...initialPreset.settings };
    state.presetId = initialPreset.id;
  }
}

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function percent(value) { return Math.round(Number(value) * 100) + "%"; }
function signedSemitones(value) { const rounded = Math.round(value); return (rounded > 0 ? "+" : "") + rounded + " st"; }
function showError(message = "") { elements.audioError.textContent = message; elements.audioError.hidden = !message; if (message) elements.liveStatus.textContent = message; }
function setLiveStatus(message) { elements.liveStatus.textContent = message; }
function currentSettings() { return state.settings[state.engine]; }
function currentWorkCount() {
  const settings = currentSettings();
  if (state.engine === "granular") return settings.grainCount;
  if (state.engine === "swarm") return settings.voiceCount;
  if (state.engine === "freeze") return settings.binCount;
  if (state.engine === "ir") return settings.tapCount;
  if (state.engine === "waveguide") return settings.stringCount;
  if (state.engine === "spatial") return settings.sourceCount;
  return settings.modeCount;
}
function sanitizeSettings(engine, settings) {
  if (engine === "granular") return sanitizeSimdGranularSettings(settings);
  if (engine === "swarm") return sanitizeSimdSwarmSettings(settings);
  if (engine === "freeze") return sanitizeSimdFreezeSettings(settings);
  if (engine === "ir") return sanitizeSimdIrSettings(settings);
  if (engine === "mesh") return sanitizeSimdMeshSettings(settings);
  if (engine === "waveguide") return sanitizeSimdWaveguideSettings(settings);
  if (engine === "spatial") return sanitizeSimdSpatialSettings(settings);
  return sanitizeSimdResonatorSettings(settings);
}
function configurationFor(engine = state.engine, { includeSource = false } = {}) {
  const configuration = createSimdAudioConfiguration(engine, state.settings[engine], state.context?.sampleRate || 48_000);
  if (!SOURCE_ENGINES.has(engine) || includeSource) return configuration;
  const { source: _source, ...withoutSource } = configuration;
  return withoutSource;
}
function gestureReadout() {
  const settings = currentSettings();
  if (state.engine === "granular") return Math.round(settings.scanPosition * 100) + "% · " + Math.round(settings.grainSizeMs) + " ms";
  if (state.engine === "swarm") return Math.round(settings.centerFrequency) + " Hz · ±" + Math.round(settings.detuneCents) + " ct";
  if (state.engine === "freeze") return Math.round(settings.scanPosition * 100) + "% · " + Math.round(settings.tilt * 100) + "% tilt";
  if (state.engine === "ir") return Math.round(settings.morph * 100) + "% · " + Math.round(settings.decay * 100) + "% decay";
  if (state.engine === "mesh") return Math.round(settings.strikeX * 100) + "% · " + Math.round(settings.strikeY * 100) + "%";
  if (state.engine === "waveguide") return Math.round(settings.baseFrequency) + " Hz · " + Math.round(settings.brightness * 100) + "%";
  if (state.engine === "spatial") return Math.round(settings.rotationDegrees) + "° · " + Math.round(settings.arcDegrees) + "° arc";
  const brightness = settings.hardness < 0.34 ? "soft" : settings.hardness > 0.7 ? "hard" : "bright";
  return Math.round(settings.strikePosition * 100) + "% · " + brightness;
}

function currentWorkUnit() {
  if (state.engine === "granular") return "grains";
  if (state.engine === "swarm") return "voices";
  if (state.engine === "freeze") return "bins";
  if (state.engine === "ir") return "taps";
  if (state.engine === "waveguide") return "strings";
  if (state.engine === "spatial") return "sources";
  return "modes";
}

function canvasAriaLabel() {
  if (state.engine === "granular") return "Playable grain cloud. Hold to make grains. Horizontal sets scan position; vertical sets grain size. Arrow keys move; hold Enter or Space when Audio is on.";
  if (state.engine === "swarm") return "Playable oscillator swarm. Hold to sound. Horizontal sets center pitch; vertical sets detune. Arrow keys move; hold Enter or Space when Audio is on.";
  if (state.engine === "freeze") return "Playable spectral freeze. Tap to capture spectrum bins. Horizontal selects the built-in source position; vertical sets spectral tilt.";
  if (state.engine === "ir") return "Playable impulse response morph. Tap to fire an impulse. Horizontal morphs between responses; vertical sets decay.";
  if (state.engine === "mesh") return "Playable modal mesh. Tap or drag to strike a position in the coupled mesh.";
  if (state.engine === "waveguide") return "Playable waveguide bank. Tap or drag to pluck parallel strings. Horizontal sets pitch; vertical sets brightness.";
  if (state.engine === "spatial") return "Playable spatial source field. Hold to sound. Horizontal rotates the field; vertical sets its arc.";
  return "Playable resonator. Drag to set strike position and brightness. Arrow keys move; Enter or Space plays when Audio is on.";
}

function renderPresetOptions() {
  if (elements.presetSelect.dataset.engine !== state.engine) {
    elements.presetSelect.replaceChildren();
    const custom = document.createElement("option"); custom.value = ""; custom.textContent = "Custom";
    elements.presetSelect.append(custom);
    for (const preset of presetsForSimdEngine(state.engine)) {
      const option = document.createElement("option"); option.value = preset.id; option.textContent = preset.label;
      elements.presetSelect.append(option);
    }
    elements.presetSelect.dataset.engine = state.engine;
  }
  elements.presetSelect.value = state.presetId || "";
  const selected = presetsForSimdEngine(state.engine).find((entry) => entry.id === state.presetId);
  if (elements.presetDescription) elements.presetDescription.textContent = selected?.note || ENGINE_COPY[state.engine].description;
}

function formatFrequency(value) {
  return value >= 1_000 ? (value / 1_000).toFixed(value % 1_000 ? 1 : 0) + " kHz" : Math.round(value) + " Hz";
}

function renderFftSettings() {
  if (!elements.fftSummary || state.engine !== "resonator") return;
  const settings = state.settings.resonator;
  const rate = state.context?.sampleRate || 48_000;
  const frameMs = settings.fftSize / rate * 1_000;
  const hopSize = Math.max(32, Math.round(settings.fftSize * settings.fftHopRatio / 32) * 32);
  const hopMs = hopSize / rate * 1_000;
  const overlap = Math.round((1 - hopSize / settings.fftSize) * 100);
  elements.fftSize.value = String(settings.fftSize);
  elements.fftSizeOut.value = frameMs.toFixed(1) + " ms";
  elements.fftWindow.value = String(settings.fftWindow);
  elements.fftSummary.textContent = settings.fftBandCount + " bands · " + frameMs.toFixed(1) + " / " + hopMs.toFixed(1) + " ms";
  const values = {
    fftHopRatio: hopMs.toFixed(1) + " ms · " + overlap + "% overlap",
    fftBandCount: String(settings.fftBandCount),
    fftResponseMs: Math.round(settings.fftResponseMs) + " ms",
    fftDetail: percent(settings.fftDetail),
    fftMix: percent(settings.fftMix),
    fftInputGain: percent(settings.fftInputGain),
    fftGateDb: "−" + Math.abs(Math.round(settings.fftGateDb)) + " dB",
    fftLowFrequency: formatFrequency(settings.fftLowFrequency),
    fftHighFrequency: formatFrequency(settings.fftHighFrequency),
  };
  for (const control of elements.fftControls) {
    if (!control.input || !control.output) continue;
    control.input.value = String(settings[control.key]);
    control.output.value = values[control.key];
    control.input.setAttribute("aria-valuetext", values[control.key]);
  }
  elements.fftSize.setAttribute("aria-valuetext", settings.fftSize + " samples, " + frameMs.toFixed(1) + " milliseconds");
  elements.fftWindow.setAttribute("aria-valuetext", SIMD_RESONATOR_WINDOW_NAMES[settings.fftWindow]);
}

function renderSettings() {
  const schema = CONTROL_SCHEMA[state.engine];
  const settings = currentSettings();
  const copy = ENGINE_COPY[state.engine];
  elements.stageEngineName.textContent = copy.title;
  elements.soundTitle.textContent = copy.section;
  elements.engineSummary.textContent = copy.short;
  elements.pluckButton.textContent = copy.action;
  elements.canvasCue.textContent = copy.cue;
  if (elements.demoActionLabel) elements.demoActionLabel.textContent = copy.instruction;
  if (elements.demoDescription) elements.demoDescription.textContent = copy.description;
  if (elements.demoInputNote) elements.demoInputNote.textContent = copy.source;
  elements.strikeReadout.textContent = gestureReadout();
  elements.modeMetric.value = String(currentWorkCount());
  elements.bodySummary.textContent = currentWorkCount() + " " + currentWorkUnit();
  elements.canvas.setAttribute("aria-label", canvasAriaLabel());
  renderPresetOptions();
  renderFftSettings();
  for (let index = 0; index < schema.length; index += 1) {
    const definition = schema[index];
    const control = elements.controls[index];
    control.label.textContent = definition.label;
    control.input.min = String(definition.min); control.input.max = String(definition.max); control.input.step = String(definition.step);
    control.input.value = String(settings[definition.key]); control.input.dataset.key = definition.key;
    control.output.value = definition.format(settings[definition.key]);
  }
  for (const engine of AVAILABLE_ENGINES) elements[engine + "EngineButton"]?.setAttribute("aria-pressed", String(engine === state.engine));
}

function renderBackend() {
  if (!state.audioReady) {
    elements.backendMetric.value = state.audioStarting ? "loading" : "not loaded"; elements.laneMetric.value = "—";
    return;
  }
  elements.backendMetric.value = state.backend === "simd" ? "SIMD Wasm" : "scalar Wasm";
  elements.laneMetric.value = String(state.laneWidth || (state.backend === "simd" ? 4 : 1));
}
function renderAudioState() {
  const audioOn = Boolean(state.context && state.audioReady); const micSupported = MIC_ENGINES.has(state.engine); const micOn = Boolean(state.micStream);
  elements.audioButton.disabled = state.audioStarting; elements.audioButton.setAttribute("aria-pressed", String(audioOn));
  elements.audioState.textContent = state.audioStarting ? "loading" : state.suspendedForVisibility ? "paused" : audioOn ? "on" : "off";
  elements.micButton.disabled = state.micStarting || !micSupported; elements.micButton.setAttribute("aria-pressed", String(micOn));
  elements.micButtonLabel.textContent = !micSupported ? "MIC NOT USED" : state.micStarting ? "STARTING MICROPHONE" : micOn ? "MIC LIVE — DISABLE" : "ENABLE MICROPHONE";
  elements.micButtonHint.textContent = !micSupported ? "not used here" : micOn
    ? (state.engine === "resonator" ? "FFT resynth + Wasm body" : "processed through Wasm")
    : audioOn ? "headphones recommended" : "Audio first · headphones";
  elements.micButton.setAttribute("aria-label", !micSupported ? "Microphone is not used by this engine." : micOn ? "Disable microphone." : audioOn ? "Enable microphone. Headphones recommended." : "Enable microphone. Turn on Audio first and use headphones.");
  elements.inputSummary.textContent = !micSupported ? "gesture only" : micOn ? "mic live" : audioOn ? (SOURCE_ENGINES.has(state.engine) ? "built-in or mic" : "trigger or mic") : "Audio first";
}
function renderTelemetry() {
  elements.kernelMetric.value = state.kernelMicros === null ? "— µs" : Math.round(state.kernelMicros) + " µs";
  if (elements.fftMetric) {
    const settings = state.settings.resonator;
    const hopSize = Math.max(32, Math.round(settings.fftSize * settings.fftHopRatio / 32) * 32);
    elements.fftMetric.value = state.fftAnalysisMicros === null
      ? settings.fftSize + " / " + hopSize
      : settings.fftSize + " · " + Math.round(state.fftAnalysisMicros) + " µs";
  }
  if (state.kernelMicros === null || !(state.budgetMicros > 0)) elements.budgetMetric.value = "—";
  else { const load = state.kernelMicros / state.budgetMicros * 100; elements.budgetMetric.value = (load < 0.1 ? "<0.1" : load.toFixed(1)) + "%"; }
}

function sendConfiguration({ includeSource = false } = {}) {
  if (!state.node || !state.audioReady) return;
  state.node.port.postMessage({ type: "configure", configuration: configurationFor(state.engine, { includeSource }) });
}
function updateSettings(patch, { send = true, preservePreset = false } = {}) {
  state.settings[state.engine] = { ...sanitizeSettings(state.engine, { ...currentSettings(), ...patch }) };
  if (!preservePreset) state.presetId = null;
  renderSettings();
  if (send) sendConfiguration();
}

function applyPreset(presetId) {
  const selected = presetsForSimdEngine(state.engine).find((preset) => preset.id === presetId);
  if (!selected) { state.presetId = null; renderPresetOptions(); return; }
  if (isLabSurface) stopAudition();
  const retainedFftSettings = state.engine === "resonator"
    ? Object.fromEntries(RESONATOR_FFT_KEYS.map((key) => [key, state.settings.resonator[key]])) : {};
  state.settings[state.engine] = { ...sanitizeSettings(state.engine, { ...selected.settings, ...retainedFftSettings }) };
  state.presetId = selected.id;
  renderSettings(); sendConfiguration({ includeSource: SOURCE_ENGINES.has(state.engine) });
  setLiveStatus(selected.label + (isLabSurface && state.audioReady ? " loaded. Playing demo." : " preset loaded."));
  if (isLabSurface && state.audioReady) {
    const engine = state.engine;
    state.auditionTimer = globalThis.setTimeout(() => {
      if (state.engine === engine && state.presetId === selected.id) auditionCurrentEngine();
    }, 36);
  }
}
async function loadWasmBinary(relativeUrl, { required = true } = {}) {
  try {
    const response = await fetch(new URL(relativeUrl, import.meta.url));
    if (!response.ok) throw new Error("HTTP " + response.status);
    const bytes = await response.arrayBuffer();
    if (!WebAssembly.validate(bytes)) throw new Error("binary is not supported");
    return bytes;
  } catch (error) {
    if (required) throw new Error("Could not load " + relativeUrl + ": " + (error?.message || error));
    return null;
  }
}
function runBenchmarkBlock(kernel, configuration, block) {
  if (configuration.engine === "granular") {
    kernel.exports.process_granular(128, configuration.grainCount, configuration.spawnIncrement, configuration.grainSizeSamples, configuration.pitchRatio, configuration.scanPosition, configuration.scatter, configuration.stereoWidth, 0, block === 0 ? 6 : 0, configuration.outputScale);
  } else if (configuration.engine === "swarm") {
    kernel.exports.process_swarm(128, configuration.voiceCount, configuration.outputScale);
  } else if (configuration.engine === "freeze") {
    kernel.exports.process_freeze(128, configuration.binCount, block === 0 ? 0.7 : 0, 0, configuration.sourceOffset, configuration.outputScale);
  } else if (configuration.engine === "ir") {
    kernel.exports.process_ir(128, configuration.tapCount, configuration.morph, block === 0 ? 0.7 : 0, 0, configuration.outputScale);
  } else if (configuration.engine === "mesh") {
    kernel.exports.process_mesh(128, configuration.modeCount, block === 0 ? 0.7 : 0, configuration.coupling, configuration.outputScale);
  } else if (configuration.engine === "waveguide") {
    kernel.exports.process_waveguides(128, configuration.stringCount, block === 0 ? 0.7 : 0, 0, configuration.outputScale);
  } else if (configuration.engine === "spatial") {
    kernel.exports.process_spatial(128, configuration.sourceCount, configuration.outputScale);
  } else {
    kernel.exports.process_resonator(128, configuration.modeCount, block === 0 ? 0.5 : 0, configuration.outputScale);
  }
}
async function benchmarkWasmBinary(binary, configuration) {
  if (!binary) return null;
  const module = await WebAssembly.compile(binary);
  const kernel = createSimdResonatorKernelViews(new WebAssembly.Instance(module));
  kernel.exports.reset(); kernel.input.fill(0); writeSimdAudioConfiguration(kernel, configuration);
  for (let block = 0; block < 32; block += 1) runBenchmarkBlock(kernel, configuration, block);
  const iterations = 256; const started = globalThis.performance.now();
  for (let block = 0; block < iterations; block += 1) runBenchmarkBlock(kernel, configuration, block + 32);
  const elapsed = globalThis.performance.now() - started;
  return elapsed > 0 ? elapsed * 1_000 / iterations : null;
}
function renderWorkerState() {
  elements.workerMetric.value = state.workerMode;
  if (elements.workerNote) {
    elements.workerNote.textContent = state.workerMode === "shared" ? "shared memory ready"
      : state.workerMode === "copy" ? "copy fallback ready"
      : state.workerMode === "loading" ? "starting"
      : state.workerMode === "unavailable" ? "not available"
      : "loads with Audio";
  }
}
function stopWorkerPrep() {
  state.worker?.terminate(); state.worker = null; state.workerControl = null; state.workerMode = "idle"; state.workerError = ""; renderWorkerState();
}
function startWorkerPrep(scalarBytes, simdBytes) {
  stopWorkerPrep();
  if (typeof Worker !== "function") { state.workerMode = "unavailable"; renderWorkerState(); return; }
  const shared = Boolean(globalThis.crossOriginIsolated && typeof SharedArrayBuffer === "function");
  state.workerControl = shared ? new Int32Array(new SharedArrayBuffer(16)) : null;
  state.workerMode = "loading"; renderWorkerState();
  const worker = new Worker(new URL("./src/simd-audio-worker.js", import.meta.url), { type: "module", name: "morphazoid-simd-prep" });
  state.worker = worker;
  worker.onmessage = (event) => {
    if (worker !== state.worker) return;
    const message = event.data || {};
    if (message.type === "ready") {
      state.workerMode = message.shared ? "shared" : "copy";
      state.workerError = "";
      renderWorkerState();
    } else if (message.type === "error") {
      state.workerMode = "unavailable"; state.workerError = message.message || "Worker prep failed."; renderWorkerState();
    }
  };
  worker.onerror = (event) => { if (worker === state.worker) { state.workerMode = "unavailable"; state.workerError = event.message || "Worker script failed."; renderWorkerState(); } };
  worker.postMessage({
    type: "init", scalarBytes, simdBytes,
    sharedBuffer: state.workerControl?.buffer || null,
  });
}
function handleWorkletMessage(message, readyControl) {
  if (!message || typeof message !== "object") return;
  if (message.type === "boot") { state.workletBooted = true; return; }
  if (message.type === "ready") {
    state.backend = message.backend; state.laneWidth = message.laneWidth; state.simdAvailable = message.simdAvailable;
    readyControl?.resolve?.(message); renderBackend(); return;
  }
  if (message.type === "backend") {
    state.backend = message.backend; state.laneWidth = message.laneWidth; state.simdAvailable = message.simdAvailable;
    renderBackend(); setLiveStatus((state.backend === "simd" ? "SIMD" : "Scalar") + " Wasm is active."); return;
  }
  if (message.type === "engine") { setLiveStatus((ENGINE_COPY[message.engine]?.short || "Engine") + " is active."); return; }
  if (message.type === "telemetry") {
    state.backend = message.backend; state.laneWidth = message.laneWidth;
    const timingEngine = ENGINE_COPY[message.engine] ? message.engine : state.engine;
    if (Number.isFinite(message.kernelMicros) && message.kernelMicros > 0) {
      state.timings[timingEngine][message.backend] = message.kernelMicros;
      state.timingSource[timingEngine][message.backend] = "worklet";
    }
    if (timingEngine !== state.engine) { renderBackend(); return; }
    state.kernelMicros = Number.isFinite(message.kernelMicros) && message.kernelMicros > 0 ? message.kernelMicros : state.kernelMicros;
    state.budgetMicros = Number.isFinite(message.budgetMicros) ? message.budgetMicros : null;
    state.peak = Number.isFinite(message.peak) ? message.peak : 0; state.rms = Number.isFinite(message.rms) ? message.rms : 0;
    if (message.modalEnergy?.length) state.signalEnergy.set(message.modalEnergy);
    if (message.modalState?.length) state.signalState.set(message.modalState);
    if (message.fftInput?.length) state.fftInput.set(message.fftInput);
    if (message.fftOutput?.length) state.fftOutput.set(message.fftOutput);
    if (Number.isFinite(message.fftAnalysisMicros)) state.fftAnalysisMicros = message.fftAnalysisMicros;
    if (Number.isFinite(message.fftBandCount)) state.fftTelemetryBands = message.fftBandCount;
    renderBackend(); renderTelemetry(); return;
  }
  if (message.type === "error") {
    showError(message.message || "The Wasm engine reported an error.");
    if (!state.audioReady) readyControl?.reject?.(new Error(message.message));
  }
}
function createReadyControl() {
  let settled = false; let resolvePromise; let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return {
    promise,
    resolve(value) { if (!settled) { settled = true; resolvePromise(value); } },
    reject(error) { if (!settled) { settled = true; rejectPromise(error); } },
  };
}

async function startAudio() {
  if (state.context || state.audioStarting) return;
  if (!AudioContextConstructor || !globalThis.AudioWorkletNode) { showError("AudioWorklet is not available in this browser."); return; }
  state.audioStarting = true; state.workletBooted = false; showError(); renderAudioState(); renderBackend();
  let context;
  try {
    context = new AudioContextConstructor({ latencyHint: "interactive" });
    state.context = context; await context.resume();
    const workletPromise = context.audioWorklet.addModule(new URL("./src/simd-resonator-processor.js", import.meta.url));
    const scalarPromise = loadWasmBinary("./assets/wasm/simd-resonator-scalar.wasm");
    const simdPromise = forceScalar ? Promise.resolve(null) : loadWasmBinary("./assets/wasm/simd-resonator-simd.wasm", { required: false });
    const [scalarBytes, simdBytes] = await Promise.all([scalarPromise, simdPromise, workletPromise]);
    state.simdAvailable = Boolean(simdBytes);
    startWorkerPrep(scalarBytes, simdBytes);
    const startupConfiguration = configurationFor(state.engine, { includeSource: true });
    state.timings[state.engine].scalar = await benchmarkWasmBinary(scalarBytes, startupConfiguration);
    state.timings[state.engine].simd = await benchmarkWasmBinary(simdBytes, startupConfiguration);
    if (state.timings[state.engine].scalar > 0) state.timingSource[state.engine].scalar = "benchmark";
    if (state.timings[state.engine].simd > 0) state.timingSource[state.engine].simd = "benchmark";
    const node = new AudioWorkletNode(context, "morphazoid-simd-resonator", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
    state.node = node;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 8; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const masterGain = context.createGain(); masterGain.gain.value = 0;
    node.connect(limiter); limiter.connect(masterGain);
    state.limiter = limiter; state.masterGain = masterGain; state.releaseOutput = connectAudioOutput(context, masterGain, { runtime: globalThis });
    const readyControl = createReadyControl();
    node.port.onmessage = (event) => handleWorkletMessage(event.data, readyControl);
    node.addEventListener("processorerror", () => { const error = new Error("The AudioWorklet processor stopped."); readyControl.reject(error); showError(error.message); if (state.node === node) void stopAudio({ preserveError: true }); }, { once: true });
    node.port.start?.();
    node.port.postMessage({ type: "install", scalarBytes, simdBytes, requestedBackend: state.requestedBackend, configuration: startupConfiguration }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
    const timeout = globalThis.setTimeout(() => readyControl.reject(new Error("The Wasm worklet did not become ready.")), 6_000);
    await readyControl.promise; globalThis.clearTimeout(timeout);
    masterGain.gain.setTargetAtTime(Number(elements.outputLevel.value), context.currentTime, 0.012);
    state.audioReady = true; state.suspendedForVisibility = false;
    state.kernelMicros = state.timings[state.engine][state.backend]; state.budgetMicros = 128 / context.sampleRate * 1_000_000;
    renderFftSettings();
    setLiveStatus("Audio is on. " + ENGINE_COPY[state.engine].cue.toLowerCase() + ".");
  } catch (error) {
    showError(error?.message || "Audio could not start."); await stopAudio({ preserveError: true });
  } finally {
    state.audioStarting = false; renderAudioState(); renderBackend(); renderTelemetry();
  }
}

function stopMicrophone({ announce = true } = {}) {
  state.micRequestGeneration += 1;
  try { state.micSource?.disconnect(); } catch {}
  for (const track of state.micStream?.getTracks?.() || []) track.stop();
  state.micSource = null; state.micStream = null; state.micStarting = false;
  state.node?.port.postMessage({ type: "mic", active: false });
  renderAudioState(); if (announce) setLiveStatus("Microphone is off.");
}
async function stopAudio({ preserveError = false } = {}) {
  stopAudition();
  stopMicrophone({ announce: false });
  stopWorkerPrep();
  const context = state.context;
  state.audioReady = false; state.workletBooted = false; state.suspendedForVisibility = false;
  state.node?.port.postMessage({ type: "dispose" });
  try { state.node?.disconnect(); state.limiter?.disconnect(); state.masterGain?.disconnect(); } catch {}
  state.releaseOutput?.();
  state.releaseOutput = null; state.node = null; state.limiter = null; state.masterGain = null; state.context = null;
  state.backend = "none"; state.laneWidth = 0; state.simdAvailable = null; state.kernelMicros = null; state.budgetMicros = null;
  state.signalEnergy.fill(0); state.signalState.fill(0); state.fftInput.fill(0); state.fftOutput.fill(0); state.fftAnalysisMicros = null;
  if (context && context.state !== "closed") { try { await context.close(); } catch {} }
  if (!preserveError) showError();
  setLiveStatus("Audio is off. Microphone is off."); renderAudioState(); renderBackend(); renderTelemetry();
}
async function toggleAudio() { if (!state.audioStarting) { if (state.context) await stopAudio(); else await startAudio(); } }

async function startMicrophone() {
  if (!MIC_ENGINES.has(state.engine) || state.micStarting || state.micStream) return;
  if (!state.audioReady || !state.context || !state.node) { showError("Turn on Audio first."); elements.audioButton.focus(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { showError("Microphone input is not available in this browser."); return; }
  state.micStarting = true; const requestGeneration = ++state.micRequestGeneration; showError(); renderAudioState();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (requestGeneration !== state.micRequestGeneration || document.hidden || !state.audioReady || !state.context || !state.node || !MIC_ENGINES.has(state.engine)) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const source = state.context.createMediaStreamSource(stream); source.connect(state.node);
    state.micStream = stream; state.micSource = source; state.node.port.postMessage({ type: "mic", active: true });
    setLiveStatus(state.engine === "granular" ? "Microphone is filling the grain buffer."
      : state.engine === "freeze" ? "Microphone is ready to freeze."
      : state.engine === "ir" ? "Microphone is feeding the IR morph."
      : state.engine === "waveguide" ? "Microphone is feeding the string bank."
      : "Microphone is live through the FFT band resynth and SIMD resonator.");
  } catch (error) {
    if (requestGeneration !== state.micRequestGeneration) return;
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    showError(denied ? "Microphone permission was not granted." : "Microphone could not start.");
  } finally {
    if (requestGeneration === state.micRequestGeneration) { state.micStarting = false; renderAudioState(); }
  }
}
async function toggleMicrophone() { if (state.micStream) stopMicrophone(); else await startMicrophone(); }

function trigger(strength = 0.78) {
  if (!state.audioReady || !state.node) { showError("Turn on Audio first."); return false; }
  showError(); state.node.port.postMessage({ type: "trigger", engine: state.engine, strength: clamp(strength, 0.1, 1.3) });
  elements.canvasCue.textContent = state.engine === "granular" ? "GRAINS"
    : state.engine === "swarm" ? "SWARM"
    : state.engine === "freeze" ? "FROZEN"
    : state.engine === "ir" ? "CONVOLVING"
    : state.engine === "mesh" ? "STRUCK"
    : state.engine === "spatial" ? "FIELD"
    : "PLUCKED";
  globalThis.setTimeout(() => { if (!state.disposed) elements.canvasCue.textContent = ENGINE_COPY[state.engine].cue; }, 360);
  setLiveStatus(ENGINE_COPY[state.engine].short + " triggered."); return true;
}
function setGate(active) {
  if (!state.audioReady || !state.node) { if (active) showError("Turn on Audio first."); return false; }
  state.node.port.postMessage({ type: "gate", active: Boolean(active) }); return true;
}
function stopAudition() {
  if (state.auditionTimer) globalThis.clearTimeout(state.auditionTimer);
  state.auditionTimer = 0;
  if (GATED_ENGINES.has(state.engine) && state.node) state.node.port.postMessage({ type: "gate", active: false });
}
function auditionCurrentEngine() {
  stopAudition();
  if (!state.audioReady || !state.node) { showError("Turn on Audio first."); return false; }
  if (!GATED_ENGINES.has(state.engine)) return trigger(0.9);
  setGate(true);
  trigger(state.engine === "granular" ? 0.62 : 0.86);
  const engine = state.engine;
  state.auditionTimer = globalThis.setTimeout(() => {
    state.auditionTimer = 0;
    if (state.engine === engine) setGate(false);
  }, 1_250);
  return true;
}
function chooseBackend(backend) {
  if (backend === "simd" && (state.simdAvailable === false || forceScalar)) return;
  state.requestedBackend = backend; state.kernelMicros = state.timings[state.engine][backend];
  if (state.node && state.audioReady) state.node.port.postMessage({ type: "backend", backend });
  renderBackend(); renderTelemetry();
}
function chooseEngine(engine) {
  if (!AVAILABLE_ENGINES.includes(engine) || engine === state.engine) return;
  stopAudition(); setGate(false); if (!MIC_ENGINES.has(engine)) stopMicrophone({ announce: false });
  state.engine = engine; state.pointerActive = false; state.pointerId = null; state.keyboardGate = false;
  state.signalEnergy.fill(0); state.signalState.fill(0); state.fftInput.fill(0); state.fftOutput.fill(0); state.fftAnalysisMicros = null; state.peak = 0; state.rms = 0;
  state.kernelMicros = state.timings[engine][state.backend] || null;
  const demoPreset = isLabSurface
    ? presetsForSimdEngine(engine).find((entry) => entry.id === DEMO_PRESET_BY_ENGINE[engine])
    : null;
  if (demoPreset) {
    state.settings[engine] = { ...sanitizeSettings(engine, demoPreset.settings) };
    state.presetId = demoPreset.id;
  } else {
    state.presetId = null;
  }
  renderSettings(); renderAudioState(); renderBackend(); renderTelemetry();
  sendConfiguration({ includeSource: SOURCE_ENGINES.has(engine) });
  setLiveStatus(ENGINE_COPY[engine].short + (state.audioReady && isLabSurface ? " selected. Playing demo." : " selected."));
  if (state.audioReady && isLabSurface) {
    state.auditionTimer = globalThis.setTimeout(() => {
      if (state.engine === engine) auditionCurrentEngine();
    }, 36);
  }
}

function pointerSettings(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  if (!(bounds.width > 0) || !(bounds.height > 0)) return;
  const horizontal = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  const vertical = clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1);
  if (state.engine === "granular") updateSettings({ scanPosition: horizontal, grainSizeMs: 18 + vertical * 242 });
  else if (state.engine === "swarm") updateSettings({ centerFrequency: 45 * (880 / 45) ** horizontal, detuneCents: 2 + vertical * 88 });
  else if (state.engine === "freeze") updateSettings({ scanPosition: horizontal, tilt: vertical * 2 - 1 });
  else if (state.engine === "ir") updateSettings({ morph: horizontal, decay: 0.05 + vertical * 0.95 });
  else if (state.engine === "mesh") updateSettings({ strikeX: clamp(horizontal, 0.05, 0.95), strikeY: clamp(vertical, 0.05, 0.95) });
  else if (state.engine === "waveguide") updateSettings({ baseFrequency: 48 * (440 / 48) ** horizontal, brightness: 0.04 + vertical * 0.96 });
  else if (state.engine === "spatial") updateSettings({ rotationDegrees: horizontal * 360 - 180, arcDegrees: 20 + vertical * 340 });
  else updateSettings({ strikePosition: clamp(horizontal, 0.04, 0.96), hardness: vertical });
}
function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault(); state.pointerActive = true; state.pointerId = event.pointerId;
  elements.canvas.setPointerCapture?.(event.pointerId); pointerSettings(event); state.lastDragTrigger = event.timeStamp;
  if (GATED_ENGINES.has(state.engine)) {
    if (setGate(true)) trigger(state.engine === "granular" ? 0.55 : 0.78);
  } else {
    const strength = state.engine === "resonator" ? 0.45 + currentSettings().hardness * 0.55 : 0.82;
    trigger(strength);
  }
}
function handlePointerMove(event) {
  if (!state.pointerActive || event.pointerId !== state.pointerId) return;
  event.preventDefault(); pointerSettings(event);
  if (state.engine === "resonator" && event.timeStamp - state.lastDragTrigger >= 42) {
    state.lastDragTrigger = event.timeStamp; trigger(0.18 + currentSettings().hardness * 0.3);
  }
}
function releasePointer(event) {
  if (state.pointerId !== null && event.pointerId !== undefined && event.pointerId !== state.pointerId) return;
  if (GATED_ENGINES.has(state.engine)) setGate(false);
  state.pointerActive = false; state.pointerId = null;
}
function nudgeGesture(horizontalDelta, verticalDelta) {
  const settings = currentSettings();
  if (state.engine === "granular") updateSettings({ scanPosition: settings.scanPosition + horizontalDelta, grainSizeMs: settings.grainSizeMs + verticalDelta * 242 });
  else if (state.engine === "swarm") updateSettings({ centerFrequency: settings.centerFrequency * 2 ** (horizontalDelta * 4), detuneCents: settings.detuneCents + verticalDelta * 88 });
  else if (state.engine === "freeze") updateSettings({ scanPosition: settings.scanPosition + horizontalDelta, tilt: settings.tilt + verticalDelta * 2 });
  else if (state.engine === "ir") updateSettings({ morph: settings.morph + horizontalDelta, decay: settings.decay + verticalDelta });
  else if (state.engine === "mesh") updateSettings({ strikeX: settings.strikeX + horizontalDelta, strikeY: settings.strikeY + verticalDelta });
  else if (state.engine === "waveguide") updateSettings({ baseFrequency: settings.baseFrequency * 2 ** (horizontalDelta * 4), brightness: settings.brightness + verticalDelta });
  else if (state.engine === "spatial") updateSettings({ rotationDegrees: settings.rotationDegrees + horizontalDelta * 360, arcDegrees: settings.arcDegrees + verticalDelta * 340 });
  else updateSettings({ strikePosition: settings.strikePosition + horizontalDelta, hardness: settings.hardness + verticalDelta });
}
function handleCanvasKeydown(event) {
  const step = event.shiftKey ? 0.08 : 0.025;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudgeGesture(event.key === "ArrowLeft" ? -step : step, 0); return; }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); nudgeGesture(0, event.key === "ArrowUp" ? step : -step); return; }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!GATED_ENGINES.has(state.engine)) { if (!event.repeat) trigger(0.8); }
    else if (!state.keyboardGate && !event.repeat) { state.keyboardGate = setGate(true); if (state.keyboardGate) trigger(state.engine === "granular" ? 0.55 : 0.78); }
  }
}
function handleCanvasKeyup(event) {
  if ((event.key === "Enter" || event.key === " ") && state.keyboardGate) { event.preventDefault(); state.keyboardGate = false; setGate(false); }
}

function resizeCanvas() {
  const bounds = elements.canvasWrap.getBoundingClientRect(); const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio)); const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (elements.canvas.width !== width || elements.canvas.height !== height) { elements.canvas.width = width; elements.canvas.height = height; }
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}
function drawGrid(context, width, height) {
  context.fillStyle = "#03090a"; context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(105, 247, 204, 0.055)"; context.lineWidth = 1;
  for (let x = 0; x <= width; x += Math.max(28, width / 16)) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  for (let y = 0; y <= height; y += Math.max(24, height / 10)) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
}
function drawCursor(context, x, y, top, bottom) {
  context.strokeStyle = "rgba(255, 209, 102, 0.58)"; context.setLineDash([3, 5]);
  context.beginPath(); context.moveTo(x, top - 10); context.lineTo(x, bottom + 10); context.stroke(); context.setLineDash([]);
  context.fillStyle = "#ffd166"; context.beginPath(); context.arc(x, y, state.pointerActive ? 6 : 4, 0, Math.PI * 2); context.fill();
}
function drawFftResynthesis(context, left, right, top, bottom) {
  if (!state.micStream) return;
  const bandCount = Math.min(state.settings.resonator.fftBandCount, state.fftTelemetryBands);
  const span = right - left;
  const heightScale = (bottom - top) * 0.78;
  context.save();
  context.fillStyle = "rgba(105, 247, 204, 0.045)";
  context.fillRect(left, top, span, bottom - top);
  for (let band = 0; band < bandCount; band += 1) {
    const x = left + span * band / Math.max(1, bandCount - 1);
    const inputLevel = clamp(state.fftInput[band], 0, 1);
    const outputLevel = clamp(state.fftOutput[band], 0, 1);
    const width = Math.max(1, span / Math.max(1, bandCount) * 0.72);
    context.fillStyle = "rgba(167, 139, 250, " + (0.06 + inputLevel * 0.28) + ")";
    context.fillRect(x - width * 0.5, bottom - inputLevel * heightScale, width, inputLevel * heightScale);
    context.fillStyle = "rgba(105, 247, 204, " + (0.08 + outputLevel * 0.68) + ")";
    context.fillRect(x - Math.max(0.5, width * 0.18), bottom - outputLevel * heightScale, Math.max(1, width * 0.36), outputLevel * heightScale);
  }
  context.fillStyle = "rgba(105, 247, 204, 0.62)";
  context.font = "8px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText("FFT INPUT / RESYNTH", left + 7, bottom - 8);
  context.restore();
}

function drawResonator(context, width, height) {
  const settings = state.settings.resonator;
  const left = Math.max(24, width * 0.055); const right = width - left;
  const top = Math.max(42, height * 0.18); const bottom = Math.max(top + 30, height * 0.76);
  const visible = Math.min(32, settings.modeCount); const liveGlow = clamp(state.peak * 5 + state.rms * 3, 0, 1);
  drawFftResynthesis(context, left, right, top, bottom);
  for (let strand = 0; strand < visible; strand += 1) {
    const mode = Math.round(strand * (settings.modeCount - 1) / Math.max(1, visible - 1));
    const baseline = top + (bottom - top) * strand / Math.max(1, visible - 1);
    const energy = clamp(state.signalEnergy[mode] * 4.4, 0, 1); const modal = clamp(state.signalState[mode], -2, 2);
    context.beginPath();
    for (let point = 0; point <= 72; point += 1) {
      const normalized = point / 72;
      const displacement = modal * Math.sin(Math.PI * (mode + 1) * normalized) * (3 + energy * height * 0.09) * Math.sin(Math.PI * normalized) / (1 + strand * 0.018);
      const x = left + (right - left) * normalized; const y = baseline + displacement;
      if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    const alpha = 0.13 + energy * 0.7 + liveGlow * 0.08;
    context.strokeStyle = strand / Math.max(1, visible - 1) > 0.7 ? "rgba(167, 139, 250, " + alpha + ")" : "rgba(105, 247, 204, " + alpha + ")";
    context.lineWidth = 0.65 + energy * 1.5; context.stroke();
  }
  drawCursor(context, left + (right - left) * settings.strikePosition, top + (bottom - top) * (1 - settings.hardness), top, bottom);
}
function drawGranular(context, width, height, time) {
  const settings = state.settings.granular;
  const left = Math.max(24, width * 0.055); const right = width - left;
  const top = Math.max(42, height * 0.16); const bottom = Math.max(top + 40, height * 0.8);
  context.beginPath();
  for (let point = 0; point <= 128; point += 1) {
    const normalized = point / 128;
    const y = (top + bottom) * 0.5 + Math.sin(normalized * Math.PI * 2 * 7 + time * 0.00025) * 8 + Math.sin(normalized * Math.PI * 2 * 13) * 4;
    const x = left + (right - left) * normalized;
    if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.strokeStyle = "rgba(105, 247, 204, 0.22)"; context.lineWidth = 1; context.stroke();
  for (let grain = 0; grain < settings.grainCount; grain += 1) {
    const energy = clamp(state.signalEnergy[grain], 0, 1); if (energy <= 0.001) continue;
    const x = left + (right - left) * clamp(state.signalState[grain], 0, 1);
    const y = top + (bottom - top) * (((grain * 13) % 17) / 16) + Math.sin(time * 0.002 + grain) * 4;
    context.fillStyle = grain % 3 ? "rgba(105, 247, 204, " + (0.2 + energy * 0.75) + ")" : "rgba(167, 139, 250, " + (0.2 + energy * 0.75) + ")";
    context.beginPath(); context.arc(x, y, 1.5 + energy * 5, 0, Math.PI * 2); context.fill();
  }
  const sizeNorm = (settings.grainSizeMs - 18) / 242;
  drawCursor(context, left + (right - left) * settings.scanPosition, bottom - (bottom - top) * sizeNorm, top, bottom);
}

function drawSwarm(context, width, height, time) {
  const settings = state.settings.swarm;
  const centerX = width * 0.5; const centerY = height * 0.49;
  const maximumRadius = Math.min(width, height) * 0.36;
  const activity = clamp(state.rms * 12 + (state.pointerActive ? 0.2 : 0), 0.08, 1);
  for (let voice = 0; voice < settings.voiceCount; voice += 1) {
    const normalized = voice / Math.max(1, settings.voiceCount - 1);
    const angle = normalized * Math.PI * 14 + time * (0.00008 + normalized * 0.00004) + state.signalState[voice] * 0.2;
    const radius = maximumRadius * (0.22 + normalized * 0.76);
    const x = centerX + Math.cos(angle) * radius; const y = centerY + Math.sin(angle) * radius * 0.52;
    const alpha = (0.08 + clamp(state.signalEnergy[voice], 0, 1) * 0.4) * activity;
    context.fillStyle = voice % 4 ? "rgba(167, 139, 250, " + alpha + ")" : "rgba(255, 111, 145, " + alpha + ")";
    context.fillRect(x, y, 1.2 + activity * 1.8, 1.2 + activity * 1.8);
  }
  context.strokeStyle = "rgba(167, 139, 250, 0.2)"; context.beginPath();
  context.ellipse(centerX, centerY, maximumRadius, maximumRadius * 0.52, 0, 0, Math.PI * 2); context.stroke();
  const frequencyNorm = Math.log(settings.centerFrequency / 45) / Math.log(880 / 45);
  const detuneNorm = (settings.detuneCents - 2) / 88;
  drawCursor(context, width * (0.055 + frequencyNorm * 0.89), height * (0.8 - detuneNorm * 0.64), height * 0.16, height * 0.8);
}
function drawFreeze(context, width, height) {
  const settings = state.settings.freeze;
  const left = width * 0.06; const right = width * 0.94; const top = height * 0.16; const bottom = height * 0.8;
  for (let bin = 0; bin < settings.binCount; bin += 1) {
    const x = left + (right - left) * bin / Math.max(1, settings.binCount - 1);
    const energy = clamp(state.signalEnergy[bin] * 4, 0.01, 1);
    const barHeight = energy * (bottom - top) * 0.82;
    context.strokeStyle = bin % 4 ? "rgba(105, 247, 204, " + (0.16 + energy * 0.72) + ")" : "rgba(255, 209, 102, " + (0.18 + energy * 0.75) + ")";
    context.beginPath(); context.moveTo(x, bottom); context.lineTo(x, bottom - barHeight); context.stroke();
  }
  drawCursor(context, left + (right - left) * settings.scanPosition, bottom - (bottom - top) * ((settings.tilt + 1) * 0.5), top, bottom);
}
function drawIr(context, width, height) {
  const settings = state.settings.ir;
  const left = width * 0.06; const right = width * 0.94; const middle = height * 0.5; const heightScale = height * 0.28;
  context.strokeStyle = "rgba(167, 139, 250, 0.76)"; context.lineWidth = 1.2; context.beginPath();
  for (let tap = 0; tap < settings.tapCount; tap += 1) {
    const x = left + (right - left) * tap / Math.max(1, settings.tapCount - 1);
    const y = middle - clamp(state.signalState[tap], -1, 1) * heightScale;
    if (tap === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  for (let tap = 0; tap < settings.tapCount; tap += 4) {
    const energy = clamp(state.signalEnergy[tap], 0, 1); if (energy < 0.01) continue;
    context.fillStyle = "rgba(105, 247, 204, " + energy + ")";
    context.fillRect(left + (right - left) * tap / settings.tapCount, middle + heightScale + 8, 2, -energy * 24);
  }
  drawCursor(context, left + (right - left) * settings.morph, height * (0.8 - settings.decay * 0.64), height * 0.16, height * 0.8);
}
function drawMesh(context, width, height) {
  const settings = state.settings.mesh;
  const left = width * 0.14; const right = width * 0.86; const top = height * 0.16; const bottom = height * 0.82;
  context.strokeStyle = "rgba(105, 247, 204, 0.13)";
  for (let row = 0; row < 8; row += 1) {
    context.beginPath();
    for (let column = 0; column < 8; column += 1) {
      const index = row * 8 + column; const movement = clamp(state.signalState[index], -1, 1) * 10;
      const x = left + (right - left) * column / 7; const y = top + (bottom - top) * row / 7 + movement;
      if (column === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
  for (let column = 0; column < 8; column += 1) {
    context.beginPath();
    for (let row = 0; row < 8; row += 1) {
      const index = row * 8 + column; const movement = clamp(state.signalState[index], -1, 1) * 10;
      const x = left + (right - left) * column / 7; const y = top + (bottom - top) * row / 7 + movement;
      if (row === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
  for (let index = 0; index < Math.min(64, settings.modeCount); index += 1) {
    const column = index % 8; const row = Math.floor(index / 8); const energy = clamp(state.signalEnergy[index] * 3, 0, 1);
    context.fillStyle = "rgba(255, 209, 102, " + (0.16 + energy * 0.8) + ")";
    context.beginPath(); context.arc(left + (right - left) * column / 7, top + (bottom - top) * row / 7, 1.5 + energy * 4, 0, Math.PI * 2); context.fill();
  }
  drawCursor(context, left + (right - left) * settings.strikeX, bottom - (bottom - top) * settings.strikeY, top, bottom);
}
function drawWaveguides(context, width, height, time) {
  const settings = state.settings.waveguide;
  const left = width * 0.06; const right = width * 0.94; const top = height * 0.15; const bottom = height * 0.82;
  for (let string = 0; string < settings.stringCount; string += 1) {
    const y = top + (bottom - top) * string / Math.max(1, settings.stringCount - 1);
    const energy = clamp(state.signalEnergy[string] * 4, 0, 1);
    context.strokeStyle = string % 4 ? "rgba(105, 247, 204, " + (0.16 + energy * 0.64) + ")" : "rgba(255, 111, 145, " + (0.2 + energy * 0.72) + ")";
    context.beginPath();
    for (let point = 0; point <= 48; point += 1) {
      const normalized = point / 48;
      const x = left + (right - left) * normalized;
      const motion = Math.sin(normalized * Math.PI * (2 + string % 4) + time * 0.004) * energy * 11 * Math.sin(Math.PI * normalized);
      if (point === 0) context.moveTo(x, y + motion); else context.lineTo(x, y + motion);
    }
    context.stroke();
  }
  const pitchNorm = Math.log(settings.baseFrequency / 48) / Math.log(440 / 48);
  drawCursor(context, left + (right - left) * pitchNorm, bottom - (bottom - top) * ((settings.brightness - 0.04) / 0.96), top, bottom);
}
function drawSpatial(context, width, height, time) {
  const settings = state.settings.spatial;
  const centerX = width * 0.5; const centerY = height * 0.5; const radius = Math.min(width, height) * 0.34;
  context.strokeStyle = "rgba(167, 139, 250, 0.2)"; context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.stroke();
  for (let source = 0; source < settings.sourceCount; source += 1) {
    const normalized = source / Math.max(1, settings.sourceCount - 1);
    const angle = (settings.rotationDegrees + (normalized - 0.5) * settings.arcDegrees) * Math.PI / 180 + time * 0.000015;
    const energy = clamp(state.signalEnergy[source] * 0.8, 0, 1);
    const x = centerX + Math.sin(angle) * radius; const y = centerY - Math.cos(angle) * radius * 0.62;
    context.fillStyle = source % 3 ? "rgba(167, 139, 250, " + (0.18 + energy * 0.7) + ")" : "rgba(105, 247, 204, " + (0.18 + energy * 0.7) + ")";
    context.beginPath(); context.arc(x, y, 1.4 + energy * 3.2, 0, Math.PI * 2); context.fill();
  }
  const x = width * (0.055 + ((settings.rotationDegrees + 180) / 360) * 0.89);
  const y = height * (0.8 - ((settings.arcDegrees - 20) / 340) * 0.64);
  drawCursor(context, x, y, height * 0.16, height * 0.8);
}
function drawCanvas(time = 0) {
  resizeCanvas();
  const bounds = elements.canvas.getBoundingClientRect(); const width = bounds.width; const height = bounds.height;
  drawGrid(canvasContext, width, height);
  if (state.engine === "granular") drawGranular(canvasContext, width, height, time);
  else if (state.engine === "swarm") drawSwarm(canvasContext, width, height, time);
  else if (state.engine === "freeze") drawFreeze(canvasContext, width, height);
  else if (state.engine === "ir") drawIr(canvasContext, width, height);
  else if (state.engine === "mesh") drawMesh(canvasContext, width, height);
  else if (state.engine === "waveguide") drawWaveguides(canvasContext, width, height, time);
  else if (state.engine === "spatial") drawSpatial(canvasContext, width, height, time);
  else drawResonator(canvasContext, width, height);
  if (!state.audioReady) {
    canvasContext.fillStyle = "rgba(230, 241, 237, 0.36)";
    canvasContext.font = "9px ui-monospace, SFMono-Regular, Consolas, monospace";
    canvasContext.textAlign = "center"; canvasContext.fillText("AUDIO OFF", width / 2, height / 2 + 3);
  }
  if (!state.disposed) state.frameRequest = globalThis.requestAnimationFrame(drawCanvas);
}
function resetInstrument() {
  state.settings.resonator = { ...SIMD_RESONATOR_DEFAULTS };
  state.settings.granular = { ...SIMD_GRANULAR_DEFAULTS };
  state.settings.swarm = { ...SIMD_SWARM_DEFAULTS };
  state.settings.freeze = { ...SIMD_FREEZE_DEFAULTS };
  state.settings.ir = { ...SIMD_IR_DEFAULTS };
  state.settings.mesh = { ...SIMD_MESH_DEFAULTS };
  state.settings.waveguide = { ...SIMD_WAVEGUIDE_DEFAULTS };
  state.settings.spatial = { ...SIMD_SPATIAL_DEFAULTS };
  state.presetId = null;
  if (isLabSurface) {
    const demoPreset = presetsForSimdEngine(state.engine).find((entry) => entry.id === DEMO_PRESET_BY_ENGINE[state.engine]);
    if (demoPreset) {
      state.settings[state.engine] = { ...sanitizeSettings(state.engine, demoPreset.settings) };
      state.presetId = demoPreset.id;
    }
  }
  state.node?.port.postMessage({ type: "reset" });
  state.signalEnergy.fill(0); state.signalState.fill(0); state.peak = 0; state.rms = 0;
  for (const engine of Object.keys(state.timings)) { state.timings[engine] = { scalar: null, simd: null }; state.timingSource[engine] = { scalar: null, simd: null }; }
  showError(); renderSettings(); renderBackend(); sendConfiguration({ includeSource: SOURCE_ENGINES.has(state.engine) }); setLiveStatus("SIMD audio reset.");
}

elements.audioButton.addEventListener("click", () => { void toggleAudio(); });
elements.outputLevel.addEventListener("input", () => {
  const value = Number(elements.outputLevel.value); elements.outputLevelOut.value = percent(value);
  if (state.masterGain && state.context) state.masterGain.gain.setTargetAtTime(value, state.context.currentTime, 0.015);
});
elements.micButton.addEventListener("click", () => { void toggleMicrophone(); });
elements.pluckButton.addEventListener("click", () => auditionCurrentEngine());
elements.resonatorEngineButton?.addEventListener("click", () => chooseEngine("resonator"));
elements.granularEngineButton?.addEventListener("click", () => chooseEngine("granular"));
elements.swarmEngineButton?.addEventListener("click", () => chooseEngine("swarm"));
elements.freezeEngineButton?.addEventListener("click", () => chooseEngine("freeze"));
elements.irEngineButton?.addEventListener("click", () => chooseEngine("ir"));
elements.meshEngineButton?.addEventListener("click", () => chooseEngine("mesh"));
elements.waveguideEngineButton?.addEventListener("click", () => chooseEngine("waveguide"));
elements.spatialEngineButton?.addEventListener("click", () => chooseEngine("spatial"));
elements.presetSelect.addEventListener("change", () => applyPreset(elements.presetSelect.value));
for (const control of elements.controls) control.input.addEventListener("input", () => updateSettings({ [control.input.dataset.key]: control.input.value }));
elements.fftSize?.addEventListener("change", () => updateSettings({ fftSize: elements.fftSize.value }, { preservePreset: true }));
elements.fftWindow?.addEventListener("change", () => updateSettings({ fftWindow: elements.fftWindow.value }, { preservePreset: true }));
for (const control of elements.fftControls) control.input?.addEventListener("input", () => updateSettings({ [control.key]: control.input.value }, { preservePreset: true }));
elements.resetButton.addEventListener("click", resetInstrument);
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("pointermove", handlePointerMove);
elements.canvas.addEventListener("pointerup", releasePointer);
elements.canvas.addEventListener("pointercancel", releasePointer);
elements.canvas.addEventListener("lostpointercapture", releasePointer);
elements.canvas.addEventListener("keydown", handleCanvasKeydown);
elements.canvas.addEventListener("keyup", handleCanvasKeyup);
globalThis.addEventListener("blur", () => {
  if (state.keyboardGate || state.pointerActive) setGate(false);
  state.keyboardGate = false; state.pointerActive = false; state.pointerId = null;
});
document.addEventListener("visibilitychange", () => {
  if (!state.context || !state.audioReady) return;
  if (document.hidden) {
    setGate(false); stopMicrophone({ announce: false }); state.suspendedForVisibility = true;
    state.context.suspend().catch(() => {}); renderAudioState(); setLiveStatus("Audio paused while the page is hidden.");
  } else if (state.suspendedForVisibility) {
    state.context.resume().then(() => { state.suspendedForVisibility = false; renderAudioState(); setLiveStatus("Audio resumed. Microphone remains off."); }).catch(() => {});
  }
});
globalThis.addEventListener("pagehide", () => { state.disposed = true; globalThis.cancelAnimationFrame(state.frameRequest); void stopAudio(); }, { once: true });

const testApi = Object.freeze({
  getState() {
    return Object.freeze({
      audioOn: state.audioReady, audioStarting: state.audioStarting, contextState: state.context?.state || "none",
      workletBooted: state.workletBooted, micOn: Boolean(state.micStream), surface, engine: state.engine,
      availableEngines: [...AVAILABLE_ENGINES],
      backend: state.backend, simdAvailable: state.simdAvailable, workCount: currentWorkCount(),
      settings: Object.freeze({ ...currentSettings() }), presetId: state.presetId,
      workerMode: state.workerMode, workerError: state.workerError,
      kernelMicros: state.kernelMicros, fftAnalysisMicros: state.fftAnalysisMicros, peak: state.peak, rms: state.rms,
    });
  },
  trigger, pluck: trigger, audition: auditionCurrentEngine, chooseBackend, chooseEngine, setGate, applyPreset,
});
globalThis.__MORPHAZOID_SIMD_RESONATOR__ = testApi;
globalThis.__MORPHAZOID_SIMD_AUDIO__ = testApi;

renderSettings(); renderAudioState(); renderBackend(); renderTelemetry(); renderWorkerState();
state.frameRequest = globalThis.requestAnimationFrame(drawCanvas);
