import {
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_PARAM_ORDER,
  WEBGPU_303_RUNTIME_DEFAULTS,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_SOURCE_SEQUENCE,
  WEBGPU_303_WORKGROUP_SIZES,
  WebGpu303Audio,
  formatWebGpu303Value,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303Sequence,
  webGpu303FundamentalFromSourceControl,
  webGpu303SequenceValue,
  webGpu303SourceControlFromFundamental,
  webGpu303Support,
} from "./src/webgpu-303.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const fract = (value) => value - Math.floor(value);
const sequence = (...values) => sanitizeWebGpu303Sequence(values);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function presetParams(values) {
  for (const key of WEBGPU_303_PARAM_ORDER) {
    if (!hasOwn(values, key)) {
      throw new Error(`WebGPU 303 preset is missing ${key}.`);
    }
  }
  return sanitizeWebGpu303Params(values);
}

const CLOCK_CONTROL_MIN = 0;
const CLOCK_CONTROL_MAX = 1;
const CLOCK_TIME_MIN = 0.01;
const CLOCK_TIME_MAX = 30;
const CLOCK_CONTROL_CURVE = 2.65;
const PATTERN_LANE_TOP = 0.07;
const PATTERN_LANE_HEIGHT = 0.8;
const PATTERN_FOOT_TOP = 0.89;
const PATTERN_FOOT_HEIGHT = 4;
const PARTIALS_BASE_Y = 0.92;
const PARTIALS_TOP_SCALE = 0.1;

function clockControlToTimeScale(value) {
  const normalized = clamp(value, CLOCK_CONTROL_MIN, CLOCK_CONTROL_MAX);
  return CLOCK_TIME_MIN + (CLOCK_TIME_MAX - CLOCK_TIME_MIN) * (normalized ** CLOCK_CONTROL_CURVE);
}

function timeScaleToClockControl(value) {
  const normalized = clamp(
    (Number(value) - CLOCK_TIME_MIN) / (CLOCK_TIME_MAX - CLOCK_TIME_MIN),
    0,
    1,
  );
  return normalized ** (1 / CLOCK_CONTROL_CURVE);
}

const controlGroups = Object.freeze({
  core: Object.freeze([
    {
      key: "fundamental",
      label: "Fundamental",
      min: 0,
      max: 100,
      step: 0.0001,
      toParam: webGpu303FundamentalFromSourceControl,
      fromParam: webGpu303SourceControlFromFundamental,
      format: (controlValue, paramValue) => (
        `${Number(controlValue).toFixed(4)} -> ${formatWebGpu303Value("fundamental", paramValue)}`
      ),
    },
    { key: "frequency", label: "Note range", min: 0.2, max: 100, step: 0.1 },
    {
      key: "timeScale",
      label: "Clock rate",
      min: CLOCK_CONTROL_MIN,
      max: CLOCK_CONTROL_MAX,
      step: 0.001,
      toParam: clockControlToTimeScale,
      fromParam: timeScaleToClockControl,
    },
    { key: "timeMod", label: "Bar length", min: 1, max: 128, step: 1 },
    { key: "gain", label: "Shader gain", min: 0, max: 0.75, step: 0.01 },
  ]),
  voice: Object.freeze([
    { key: "partials", label: "Partials", min: 1, max: 256, step: 1 },
    { key: "ratio", label: "Ratio", min: 1, max: 32, step: 0.01 },
    { key: "sampOffset", label: "Sample offset", min: 1, max: 32, step: 1 },
    { key: "dur", label: "Accent decay", min: 0.001, max: 2, step: 0.001 },
  ]),
  filter: Object.freeze([
    { key: "dist", label: "Drive", min: 0.01, max: 5, step: 0.01 },
    { key: "flt", label: "Sweep", min: -64, max: 64, step: 0.01 },
    { key: "res", label: "Resonance", min: 0, max: 15, step: 0.01 },
    { key: "lfo", label: "LFO", min: 0, max: 64, step: 0.01 },
    { key: "stereo", label: "Stereo", min: -8, max: 8, step: 0.001 },
    { key: "nse", label: "Seed", min: 0, max: 40000, step: 1 },
  ]),
});

const controlSpecs = Object.freeze([
  ...controlGroups.core,
  ...controlGroups.voice,
  ...controlGroups.filter,
]);
const controlSpecsByKey = new Map(controlSpecs.map((spec) => [spec.key, spec]));
const knobLabels = Object.freeze({
  flt: "Cutoff",
  res: "Reso",
  dist: "Drive",
  lfo: "Wobble",
  stereo: "Astral",
  fundamental: "Tune",
  frequency: "Range",
  ratio: "Fold",
  sampOffset: "Offset",
  partials: "Color",
  dur: "Decay",
  timeScale: "Speed",
  timeMod: "Steps",
  gain: "Level",
  nse: "Oracle",
});
const knobOrder = Object.freeze([
  "timeScale",
  "timeMod",
  "flt",
  "res",
  "dist",
  "lfo",
  "stereo",
  "fundamental",
  "frequency",
  "ratio",
  "sampOffset",
  "partials",
  "dur",
  "gain",
  "nse",
]);
const knobHueByKey = new Map(knobOrder.map((key, index) => [key, (index * 47 + 312) % 360]));
const integerParams = new Set(["partials", "timeMod", "sampOffset"]);
const SAFE_RANDOM_PARAM_RANGES = Object.freeze({
  partials: Object.freeze([64, 256]),
  frequency: Object.freeze([22, 96]),
  timeMod: Object.freeze([8, 128]),
  timeScale: Object.freeze([0.85, 16]),
  gain: Object.freeze([0.055, 0.13]),
  dist: Object.freeze([0.22, 2.2]),
  dur: Object.freeze([0.24, 1.45]),
  ratio: Object.freeze([1.2, 24]),
  sampOffset: Object.freeze([1, 18]),
  fundamental: Object.freeze([
    webGpu303FundamentalFromSourceControl(42),
    webGpu303FundamentalFromSourceControl(90),
  ]),
  stereo: Object.freeze([-7.5, 7.5]),
  nse: Object.freeze([1000, 39000]),
  res: Object.freeze([1.2, 12.5]),
  lfo: Object.freeze([0.1, 18]),
  flt: Object.freeze([-38, 42]),
});
const MUTATE_PATCH_PARAM_ORDER = Object.freeze(
  WEBGPU_303_PARAM_ORDER.filter((key) => key !== "timeScale" && key !== "timeMod"),
);
const MUTATE_PATCH_AMOUNTS = Object.freeze({
  nse: 0.18,
  lfo: 0.12,
  stereo: 0.11,
  flt: 0.11,
  dist: 0.09,
  res: 0.09,
  dur: 0.1,
  partials: 0.08,
  ratio: 0.07,
  frequency: 0.07,
  sampOffset: 0.07,
  fundamental: 0.055,
  gain: 0.05,
});

const presets = Object.freeze([
  {
    id: "source-acid-synth",
    label: "Source Acid Synth",
    params: WEBGPU_303_DEFAULTS,
    sequence: WEBGPU_303_SOURCE_SEQUENCE,
  },
  {
    id: "filter-snap",
    label: "Lysergic Ribbon",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(70),
      frequency: 54,
      timeMod: 24,
      timeScale: 7.4,
      gain: 0.1,
      dist: 0.82,
      dur: 0.42,
      ratio: 5.75,
      sampOffset: 1,
      stereo: 1.2,
      nse: 17317,
      res: 10.8,
      lfo: 2.8,
      flt: -12,
    }),
    sequence: sequence(0.08, 0.46, 0.2, 0.72, 0.3, 0.62, 0.38, 0.9, 0.34, 0.76, 0.49, 0.86, 0.28, 0.68, 0.4, 0.57, 0.18, 0.66, 0.36, 0.78, 0.24, 0.59, 0.44, 0.82),
  },
  {
    id: "wide-phase",
    label: "Astral Smear",
    params: presetParams({
      partials: 224,
      fundamental: webGpu303FundamentalFromSourceControl(68),
      frequency: 46,
      timeMod: 20,
      timeScale: 4.8,
      gain: 0.09,
      dist: 0.62,
      dur: 0.66,
      ratio: 9.5,
      sampOffset: 2,
      stereo: 7.5,
      nse: 29303,
      res: 8.6,
      lfo: 0.55,
      flt: 14,
    }),
    sequence: sequence(0.73, 0.18, 0.88, 0.26, 0.42, 0.12, 0.62, 0.32, 0.97, 0.36, 0.53, 0.22, 0.68, 0.28, 0.81, 0.44, 0.56, 0.18, 0.74, 0.38),
  },
  {
    id: "resonance-glass",
    label: "Glass Seance",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(81),
      frequency: 48,
      timeMod: 32,
      timeScale: 6.2,
      gain: 0.082,
      dist: 0.72,
      dur: 0.38,
      ratio: 3.6,
      sampOffset: 1,
      stereo: 2.4,
      nse: 9241,
      res: 12.8,
      lfo: 1.8,
      flt: -20,
    }),
    sequence: sequence(0.16, 0.71, 0.24, 0.88, 0.32, 0.6, 0.28, 0.93, 0.41, 0.78, 0.22, 0.99, 0.35, 0.49, 0.27, 0.85, 0.46, 0.69, 0.18, 0.92, 0.3, 0.56, 0.39, 0.76, 0.25, 0.64, 0.42, 0.82, 0.2, 0.58, 0.37, 0.9),
  },
  {
    id: "voltage-bloom",
    label: "Voltage Melt",
    params: presetParams({
      partials: 224,
      fundamental: webGpu303FundamentalFromSourceControl(55),
      frequency: 30,
      timeMod: 16,
      timeScale: 2.4,
      gain: 0.11,
      dist: 0.28,
      dur: 1.55,
      ratio: 14.5,
      sampOffset: 3,
      stereo: -6.2,
      nse: 21444,
      res: 5.5,
      lfo: 0.25,
      flt: 30,
    }),
    sequence: sequence(0.12, 0.18, 0.38, 0.29, 0.54, 0.41, 0.74, 0.48, 0.83, 0.59, 0.91, 0.7, 0.65, 0.35, 0.44, 0.22),
  },
  {
    id: "needle-stutter",
    label: "Liquid Needle",
    params: presetParams({
      partials: 160,
      fundamental: webGpu303FundamentalFromSourceControl(62),
      frequency: 76,
      timeMod: 48,
      timeScale: 13.5,
      gain: 0.075,
      dist: 1.35,
      dur: 0.22,
      ratio: 12,
      sampOffset: 4,
      stereo: 3.2,
      nse: 33111,
      res: 7,
      lfo: 11,
      flt: -24,
    }),
    sequence: sequence(0.1, 0.82, 0.24, 0.36, 0.72, 0.28, 0.68, 0.32, 0.86, 0.41, 0.54, 0.18, 0.75, 0.34, 0.58, 0.42, 0.9, 0.22, 0.53, 0.31, 0.84, 0.46, 0.63, 0.27, 0.95, 0.48, 0.57, 0.24, 0.71, 0.38, 0.56, 0.44, 0.88, 0.26, 0.66, 0.35, 0.79, 0.5, 0.62, 0.3, 0.92, 0.4, 0.7, 0.21, 0.83, 0.52, 0.61, 0.36),
  },
  {
    id: "drive-floor",
    label: "Floor Warp",
    params: presetParams({
      partials: 200,
      fundamental: webGpu303FundamentalFromSourceControl(46),
      frequency: 42,
      timeMod: 16,
      timeScale: 6.4,
      gain: 0.08,
      dist: 1.9,
      dur: 0.55,
      ratio: 1.35,
      sampOffset: 1,
      stereo: -2.5,
      nse: 12600,
      res: 5.8,
      lfo: 3.4,
      flt: 2.5,
    }),
    sequence: sequence(0.12, 0.78, 0.25, 0.88, 0.2, 0.72, 0.32, 0.84, 0.28, 0.63, 0.38, 0.76, 0.22, 0.54, 0.36, 0.68),
  },
  {
    id: "hollow-offset",
    label: "Hollow Halo",
    params: presetParams({
      partials: 96,
      fundamental: webGpu303FundamentalFromSourceControl(58),
      frequency: 36,
      timeMod: 8,
      timeScale: 4.4,
      gain: 0.11,
      dist: 1.1,
      dur: 1.05,
      ratio: 27,
      sampOffset: 18,
      stereo: -6.8,
      nse: 38400,
      res: 2.8,
      lfo: 1.2,
      flt: 24,
    }),
    sequence: sequence(0.08, 0.22, 0.08, 0.64, 0.1, 0.35, 0.78, 0.18),
  },
  {
    id: "vector-sweep",
    label: "Vector Mirage",
    params: presetParams({
      partials: 220,
      fundamental: webGpu303FundamentalFromSourceControl(84),
      frequency: 92,
      timeMod: 64,
      timeScale: 8.4,
      gain: 0.075,
      dist: 0.95,
      dur: 0.36,
      ratio: 16,
      sampOffset: 2,
      stereo: 6.2,
      nse: 24888,
      res: 9.2,
      lfo: 22,
      flt: 20,
    }),
    sequence: sequence(0.39, 0.21, 0.73, 0.34, 0.86, 0.47, 0.28, 0.92, 0.52, 0.32, 0.68, 0.43, 0.98, 0.26, 0.61, 0.44, 0.82, 0.39, 0.57, 0.3, 0.76, 0.5, 0.66, 0.36, 0.88, 0.24, 0.71, 0.45, 0.93, 0.33, 0.62, 0.55),
  },
  {
    id: "seed-scanner",
    label: "Oracle Scanner",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(77),
      frequency: 88,
      timeMod: 96,
      timeScale: 6.8,
      gain: 0.09,
      dist: 0.74,
      dur: 0.48,
      ratio: 8.6,
      sampOffset: 3,
      stereo: 4.4,
      nse: 39211,
      res: 8.8,
      lfo: 5.3,
      flt: -8,
    }),
    sequence: WEBGPU_303_SOURCE_SEQUENCE,
  },
  {
    id: "opal-cathedral",
    label: "Opal Cathedral",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(52),
      frequency: 28,
      timeMod: 32,
      timeScale: 2.8,
      gain: 0.12,
      dist: 0.28,
      dur: 1.4,
      ratio: 3.4,
      sampOffset: 1,
      stereo: 6.5,
      nse: 28777,
      res: 6.4,
      lfo: 0.33,
      flt: 26,
    }),
    sequence: sequence(0.1, 0.16, 0.23, 0.31, 0.42, 0.5, 0.58, 0.67, 0.74, 0.82, 0.9, 0.76, 0.63, 0.52, 0.41, 0.3, 0.22, 0.36, 0.48, 0.61, 0.73, 0.86, 0.69, 0.55, 0.44, 0.33, 0.24, 0.18, 0.29, 0.46, 0.62, 0.79),
  },
  {
    id: "prism-bath",
    label: "Prism Bath",
    params: presetParams({
      partials: 180,
      fundamental: webGpu303FundamentalFromSourceControl(88),
      frequency: 70,
      timeMod: 40,
      timeScale: 9.5,
      gain: 0.07,
      dist: 1.1,
      dur: 0.5,
      ratio: 13.2,
      sampOffset: 6,
      stereo: -5.5,
      nse: 15680,
      res: 11,
      lfo: 7.5,
      flt: -18,
    }),
    sequence: sequence(0.24, 0.72, 0.35, 0.68, 0.18, 0.82, 0.42, 0.91, 0.3, 0.64, 0.5, 0.76, 0.27, 0.58, 0.46, 0.87, 0.34, 0.7, 0.22, 0.79, 0.4, 0.95, 0.52, 0.66, 0.28, 0.61, 0.48, 0.84, 0.36, 0.74, 0.2, 0.89, 0.45, 0.69, 0.31, 0.8, 0.56, 0.73, 0.38, 0.93),
  },
]);

const support = webGpu303Support(globalThis);
const state = {
  params: sanitizeWebGpu303Params(),
  sequence: sanitizeWebGpu303Sequence(WEBGPU_303_SOURCE_SEQUENCE),
  presetId: "source-acid-synth",
  audioOn: false,
  synthPlaying: false,
  visualHoldTime: 0,
  chunkDuration: WEBGPU_303_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: WEBGPU_303_RUNTIME_DEFAULTS.workgroupSize,
  editingSequence: false,
};
const controlInputs = new Map();
const controlOutputs = new Map();
const knobControls = new Map();
const knobOutputs = new Map();

let engine = null;
let audioStartPromise = null;
let audioLifecycleGeneration = 0;
let animationFrame = 0;
let activeKnobDrag = null;

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function setRuntimeState() {
  $("chunkDurationOut").textContent = `${Math.round(state.chunkDuration * 1000)} ms`;
  $("workgroupSizeOut").textContent = `${state.workgroupSize} lanes`;
  $("runtimeState").textContent = `${state.workgroupSize} lanes`;
}

function setSupportState() {
  if (!support.audio) {
    $("gpuState").textContent = "Web Audio unavailable";
    $("streamState").textContent = "AudioContext missing";
  } else if (!support.webgpu) {
    $("gpuState").textContent = "WebGPU unavailable";
    $("streamState").textContent = "navigator.gpu missing";
  } else {
    $("gpuState").textContent = "WebGPU ready";
    $("streamState").textContent = "Separate WGSL engine";
  }
  $("audioButton").disabled = !support.supported;
  $("synthPlayButton").disabled = !support.supported || Boolean(audioStartPromise);
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").disabled = !support.supported || Boolean(audioStartPromise);
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  $("engineBadge").textContent = enabled
    ? state.synthPlaying ? "Synth playing" : "WebGPU ready"
    : "WGSL compute voice";
  $("stageReadout").textContent = enabled
    ? `WEBGPU - ${Math.round(engine?.sampleRate ?? 44100)} HZ - ${state.synthPlaying ? "SYNTH PLAYING" : "SYNTH PAUSED"}`
    : "WEBGPU - STANDBY - AUDIO OFF";
  $("stage").setAttribute(
    "aria-label",
    `WebGPU 303 acid pattern, harmonic partials, and output trace. Audio ${enabled ? "on" : "off"}.`,
  );
  if (enabled && engine) {
    $("gpuState").textContent = "WebGPU streaming";
    $("streamState").textContent = `${Math.round(engine.chunkDurationInSeconds * 1000)} ms chunks in Web Audio`;
  } else {
    setSupportState();
  }
  setSynthPlayButtonState();
}

function setSynthPlayButtonState() {
  const button = $("synthPlayButton");
  button.disabled = !support.supported || Boolean(audioStartPromise);
  button.setAttribute("aria-pressed", String(state.synthPlaying));
  button.textContent = state.synthPlaying ? "Pause synth" : "Play synth";
}

function setSynthPlayState(enabled, { quiet = false } = {}) {
  const nextPlaying = Boolean(enabled);
  if (!nextPlaying) {
    state.visualHoldTime = engine?.currentPlaybackTime?.() ?? state.visualHoldTime;
  }
  state.synthPlaying = nextPlaying;
  engine?.setPlaybackEnabled(nextPlaying);
  setAudioState(state.audioOn);
  if (!quiet) announce(nextPlaying ? "WebGPU 303 synth playing." : "WebGPU 303 synth paused.");
}

function syncParamOutputs() {
  for (const [key, input] of controlInputs) {
    const spec = input.controlSpec;
    const controlValue = spec?.fromParam ? spec.fromParam(state.params[key]) : state.params[key];
    input.value = String(controlValue);
    const output = controlOutputs.get(key);
    if (output) {
      output.textContent = spec?.format
        ? spec.format(controlValue, state.params[key])
        : formatWebGpu303Value(key, state.params[key]);
    }
  }
  for (const [key, knob] of knobControls) {
    const spec = knob.controlSpec;
    const controlValue = spec?.fromParam ? spec.fromParam(state.params[key]) : state.params[key];
    const percent = clamp((controlValue - spec.min) / Math.max(0.0001, spec.max - spec.min), 0, 1);
    const angle = -135 + percent * 270;
    const valueText = formatWebGpu303Value(key, state.params[key]);
    knob.style.setProperty("--knob-angle", `${angle}deg`);
    knob.style.setProperty("--knob-fill", `${percent * 75}%`);
    knob.setAttribute("aria-valuenow", String(Number(controlValue).toFixed(4)));
    knob.setAttribute("aria-valuetext", valueText);
    const output = knobOutputs.get(key);
    if (output) output.textContent = valueText;
  }
  $("coreState").textContent = formatWebGpu303Value("fundamental", state.params.fundamental);
  $("voiceState").textContent = formatWebGpu303Value("partials", state.params.partials);
  $("filterState").textContent = `drive ${Number(state.params.dist).toFixed(2)}`;
  $("patternState").textContent = presets.find(({ id }) => id === state.presetId)?.label ?? "custom";
  for (const button of $("presetButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === state.presetId));
  }
}

function applyParams(nextParams, presetId = "custom") {
  state.params = sanitizeWebGpu303Params(nextParams);
  state.presetId = presetId;
  syncParamOutputs();
  engine?.updateParams(state.params);
}

function applySequence(nextSequence, presetId = "custom") {
  state.sequence = sanitizeWebGpu303Sequence(nextSequence);
  state.presetId = presetId;
  syncParamOutputs();
  engine?.updateSequence(state.sequence);
}

function applyPreset(preset) {
  state.params = sanitizeWebGpu303Params(preset.params);
  state.sequence = sanitizeWebGpu303Sequence(preset.sequence ?? WEBGPU_303_SOURCE_SEQUENCE);
  state.presetId = preset.id;
  syncParamOutputs();
  engine?.updateParams(state.params);
  engine?.updateSequence(state.sequence);
}

function activeStepCount() {
  return Math.max(1, Math.min(WEBGPU_303_SEQUENCE_LENGTH, Math.round(state.params.timeMod)));
}

function resolvedStepValue(step) {
  return webGpu303SequenceValue(step, state.params, state.sequence);
}

function controlStep(spec) {
  const range = Math.max(0.0001, spec.max - spec.min);
  const nativeStep = Number(spec.step) || 0;
  return Math.max(nativeStep, range / 120);
}

function applyControlValue(spec, rawControlValue) {
  const controlValue = clamp(rawControlValue, spec.min, spec.max);
  const paramValue = spec.toParam ? spec.toParam(controlValue) : controlValue;
  applyParams({
    ...state.params,
    [spec.key]: paramValue,
  });
}

function currentControlValue(spec) {
  return spec.fromParam ? spec.fromParam(state.params[spec.key]) : state.params[spec.key];
}

function balancedKnobColumnCount(totalKnobs, maximumColumns) {
  const total = Math.max(1, Math.floor(Number(totalKnobs) || 1));
  const boundedMaximum = Math.floor(clamp(maximumColumns, 1, total));
  const rowCount = Math.ceil(total / boundedMaximum);
  return Math.ceil(total / rowCount);
}

function balanceKnobRows() {
  const bank = $("knobControls");
  const totalKnobs = bank.children.length;
  const firstKnob = bank.querySelector(".webgpu-knob");
  const bankBounds = bank.getBoundingClientRect();
  const knobBounds = firstKnob?.getBoundingClientRect();
  if (!totalKnobs || !bankBounds.width || !knobBounds?.width) return;

  const styles = getComputedStyle(bank);
  const columnGap = Number.parseFloat(styles.columnGap) || 0;
  const maximumColumns = Math.floor((bankBounds.width + columnGap) / (knobBounds.width + columnGap));
  const columns = balancedKnobColumnCount(totalKnobs, maximumColumns);
  bank.style.setProperty("--knob-columns", String(columns));
  bank.dataset.knobColumns = String(columns);
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function safeRandomParamValue(key) {
  const [minimum, maximum] = SAFE_RANDOM_PARAM_RANGES[key];
  const value = randomBetween(minimum, maximum);
  return integerParams.has(key) ? Math.round(value) : value;
}

function clampSafeParamValue(key, value) {
  const [minimum, maximum] = SAFE_RANDOM_PARAM_RANGES[key];
  const nextValue = clamp(value, minimum, maximum);
  return integerParams.has(key) ? Math.round(nextValue) : nextValue;
}

function energyManagedParams(params) {
  const nextParams = sanitizeWebGpu303Params(params);
  const driveCut = Math.max(0, nextParams.dist - 1) * 0.018;
  const resonanceCut = Math.max(0, nextParams.res - 7) * 0.0045;
  const decayCut = Math.max(0, 0.34 - nextParams.dur) * 0.09;
  const maxGain = clamp(0.135 - driveCut - resonanceCut - decayCut, 0.065, 0.13);
  nextParams.gain = clamp(nextParams.gain, SAFE_RANDOM_PARAM_RANGES.gain[0], maxGain);
  return nextParams;
}

function randomSafePatchParams() {
  const nextParams = {};
  for (const key of WEBGPU_303_PARAM_ORDER) nextParams[key] = safeRandomParamValue(key);
  return energyManagedParams(nextParams);
}

function mutateSafePatchParams(params = state.params) {
  const nextParams = sanitizeWebGpu303Params(params);
  for (const key of MUTATE_PATCH_PARAM_ORDER) {
    const [minimum, maximum] = SAFE_RANDOM_PARAM_RANGES[key];
    const currentValue = Number.isFinite(params[key]) ? params[key] : WEBGPU_303_DEFAULTS[key];
    const width = maximum - minimum;
    const amount = MUTATE_PATCH_AMOUNTS[key] ?? 0.075;
    nextParams[key] = clampSafeParamValue(key, currentValue + randomBetween(-width * amount, width * amount));
  }
  return energyManagedParams(nextParams);
}

function createRangeControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";
  wrapper.htmlFor = spec.key;

  const span = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = `${spec.key}Out`;
  output.htmlFor = spec.key;
  span.append(label, output);

  const input = document.createElement("input");
  input.id = spec.key;
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.fromParam ? spec.fromParam(state.params[spec.key]) : state.params[spec.key]);
  input.controlSpec = spec;
  input.setAttribute("aria-label", spec.label);
  input.addEventListener("input", () => {
    applyControlValue(spec, input.value);
  });

  controlInputs.set(spec.key, input);
  controlOutputs.set(spec.key, output);
  wrapper.append(span, input);
  return wrapper;
}

function createKnobControl(key) {
  const spec = controlSpecsByKey.get(key);
  const hue = knobHueByKey.get(key) ?? 0;
  const wrapper = document.createElement("div");
  wrapper.className = "webgpu-knob";
  wrapper.style.setProperty("--knob-hue", String(hue));
  wrapper.style.setProperty("--knob-hue-b", String((hue + 130) % 360));
  wrapper.style.setProperty("--knob-hue-c", String((hue + 260) % 360));

  const dial = document.createElement("div");
  dial.className = "webgpu-knob-dial";
  dial.style.setProperty("--knob-hue", String(hue));
  dial.style.setProperty("--knob-hue-b", String((hue + 130) % 360));
  dial.style.setProperty("--knob-hue-c", String((hue + 260) % 360));
  dial.tabIndex = 0;
  dial.controlSpec = spec;
  dial.dataset.paramKey = key;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", `${knobLabels[key] ?? spec.label} ${spec.label}`);
  dial.setAttribute("aria-valuemin", String(spec.min));
  dial.setAttribute("aria-valuemax", String(spec.max));

  const label = document.createElement("span");
  label.className = "webgpu-knob-label";
  label.textContent = knobLabels[key] ?? spec.label;

  const output = document.createElement("output");
  output.className = "webgpu-knob-value";
  output.htmlFor = key;

  dial.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activeKnobDrag = {
      spec,
      startY: event.clientY,
      startValue: currentControlValue(spec),
    };
    dial.setPointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointermove", (event) => {
    if (!activeKnobDrag || activeKnobDrag.spec.key !== key) return;
    event.preventDefault();
    const delta = activeKnobDrag.startY - event.clientY;
    const range = Math.max(0.0001, spec.max - spec.min);
    applyControlValue(spec, activeKnobDrag.startValue + (delta / 130) * range);
  });
  dial.addEventListener("pointerup", (event) => {
    if (!activeKnobDrag || activeKnobDrag.spec.key !== key) return;
    activeKnobDrag = null;
    dial.releasePointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointercancel", () => {
    if (activeKnobDrag?.spec.key === key) activeKnobDrag = null;
  });
  dial.addEventListener("wheel", (event) => {
    event.preventDefault();
    applyControlValue(spec, currentControlValue(spec) + Math.sign(-event.deltaY) * controlStep(spec));
  }, { passive: false });
  dial.addEventListener("keydown", (event) => {
    const step = controlStep(spec);
    const jump = step * 8;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      applyControlValue(spec, currentControlValue(spec) + step);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      applyControlValue(spec, currentControlValue(spec) - step);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      applyControlValue(spec, currentControlValue(spec) + jump);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      applyControlValue(spec, currentControlValue(spec) - jump);
    } else if (event.key === "Home") {
      event.preventDefault();
      applyControlValue(spec, spec.min);
    } else if (event.key === "End") {
      event.preventDefault();
      applyControlValue(spec, spec.max);
    }
  });

  knobControls.set(key, dial);
  knobOutputs.set(key, output);
  wrapper.append(dial, label, output);
  return wrapper;
}

function renderControls() {
  $("knobControls").replaceChildren(...knobOrder.map(createKnobControl));
  balanceKnobRows();
  requestAnimationFrame(balanceKnobRows);
  $("coreControls").replaceChildren(...controlGroups.core.map(createRangeControl));
  $("voiceControls").replaceChildren(...controlGroups.voice.map(createRangeControl));
  $("filterControls").replaceChildren(...controlGroups.filter.map(createRangeControl));
  const presetButtons = presets.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.presetId = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(preset.id === state.presetId));
    button.addEventListener("click", () => {
      applyPreset(preset);
      announce(`${preset.label} selected.`);
    });
    return button;
  });
  $("presetButtons").replaceChildren(...presetButtons);
  syncParamOutputs();
}

function outputChanged() {
  const value = clamp($("output").value, 0, 1);
  $("outputOut").textContent = `${Math.round(value * 100)}%`;
  engine?.setOutput(value);
}

async function startAudio() {
  if (state.audioOn && engine?.context) return true;
  if (audioStartPromise) return audioStartPromise;
  clearError();
  $("audioButton").disabled = true;
  const lifecycleGeneration = audioLifecycleGeneration;
  const nextEngine = new WebGpu303Audio(globalThis, {
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
  });
  nextEngine.setOutput(Number($("output").value));
  nextEngine.setPlaybackEnabled(state.synthPlaying);
  nextEngine.setErrorHandler((error) => {
    showError(error);
    setSynthPlayState(false, { quiet: true });
    setAudioState(false);
    setTimeout(() => {
      if (engine === nextEngine) void stopAudio({ quiet: true });
    }, 0);
  });
  engine = nextEngine;
  let pending;
  pending = nextEngine.start(state.params).then((context) => {
    if (
      lifecycleGeneration !== audioLifecycleGeneration
      || engine !== nextEngine
      || context !== nextEngine.context
    ) {
      void nextEngine.stop();
      return false;
    }
    nextEngine.setOutput(Number($("output").value));
    nextEngine.setPlaybackEnabled(state.synthPlaying);
    nextEngine.updateSequence(state.sequence);
    setAudioState(true);
    announce(state.synthPlaying ? "WebGPU 303 audio on and synth playing." : "WebGPU 303 audio ready.");
    return true;
  }).catch((error) => {
    if (engine === nextEngine) engine = null;
    setAudioState(false);
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
    $("audioButton").disabled = !support.supported;
    setSynthPlayButtonState();
  });
  audioStartPromise = pending;
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  audioLifecycleGeneration += 1;
  if (state.synthPlaying) setSynthPlayState(false, { quiet: true });
  const previous = engine;
  engine = null;
  audioStartPromise = null;
  if (previous) await previous.stop();
  setAudioState(false);
  if (!quiet) announce("WebGPU 303 audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

async function toggleSynthPlay() {
  if (state.synthPlaying) {
    setSynthPlayState(false);
    return;
  }
  if (!state.audioOn) {
    const started = await startAudio();
    if (!started) return;
  }
  setSynthPlayState(true);
}

async function restartAudio() {
  if (!state.audioOn) {
    setRuntimeState();
    return;
  }
  const wasPlaying = state.synthPlaying;
  await stopAudio({ quiet: true });
  state.synthPlaying = wasPlaying;
  await startAudio();
  setSynthPlayState(wasPlaying, { quiet: true });
}

function runtimeChanged() {
  state.chunkDuration = clamp($("chunkDuration").value, 0.03, 0.25);
  state.workgroupSize = WEBGPU_303_WORKGROUP_SIZES.includes(Number($("workgroupSize").value))
    ? Number($("workgroupSize").value)
    : WEBGPU_303_RUNTIME_DEFAULTS.workgroupSize;
  setRuntimeState();
}

function randomizePatch() {
  applyParams(randomSafePatchParams());
  announce("Safe patch parameters randomized.");
}

function mutatePatch() {
  applyParams(mutateSafePatchParams());
  announce("Patch parameters mutated safely.");
}

function clearSequence() {
  applySequence(WEBGPU_303_SOURCE_SEQUENCE);
  announce("Source noise sequence restored.");
}

function randomizeSequence() {
  const steps = activeStepCount();
  const nextSequence = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, index) => (
    index < steps ? Math.random() : -1
  ));
  applySequence(nextSequence);
  announce("Sequence randomized.");
}

function mutateSequence() {
  const steps = activeStepCount();
  const nextSequence = state.sequence.map((value, index) => {
    if (index >= steps) return -1;
    const base = value >= 0 ? value : resolvedStepValue(index);
    return clamp(base + (Math.random() - 0.5) * 0.24, 0, 0.9999);
  });
  applySequence(nextSequence);
  announce("Sequence mutated.");
}

function invertSequence() {
  const steps = activeStepCount();
  const nextSequence = state.sequence.map((_, index) => (
    index < steps ? clamp(1 - resolvedStepValue(index), 0, 0.9999) : -1
  ));
  applySequence(nextSequence);
  announce("Sequence inverted.");
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(rect.width * pixelRatio));
  const height = Math.max(280, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, pixelRatio };
}

function patternMetrics(width, height) {
  return {
    laneTop: height * PATTERN_LANE_TOP,
    laneHeight: height * PATTERN_LANE_HEIGHT,
    footTop: height * PATTERN_FOOT_TOP,
  };
}

function visualPlaybackTime() {
  if (!state.synthPlaying) return state.visualHoldTime;
  const playbackTime = engine?.currentPlaybackTime?.();
  if (playbackTime !== null && playbackTime !== undefined) {
    state.visualHoldTime = playbackTime;
    return playbackTime;
  }
  const fallback = performance.now() / 1000;
  state.visualHoldTime = fallback;
  return fallback;
}

function sequencePhaseAtTime(time, steps = activeStepCount()) {
  const stepCount = Math.max(1, steps);
  const position = fract((Math.max(0, Number(time) || 0) * state.params.timeScale) / stepCount) * stepCount;
  const activeStep = Math.min(stepCount - 1, Math.floor(position));
  return {
    beat: position / stepCount,
    activeStep,
    stepProgress: position - activeStep,
  };
}

function drawGrid(context, width, height) {
  context.strokeStyle = "rgba(102, 216, 255, 0.09)";
  context.lineWidth = 1;
  const step = 36;
  context.beginPath();
  for (let x = 0; x <= width; x += step) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += step) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawPattern(context, width, height, now) {
  const steps = activeStepCount();
  const { activeStep } = sequencePhaseAtTime(now, steps);
  const { laneTop, laneHeight, footTop } = patternMetrics(width, height);
  const cellWidth = width / steps;
  const barGap = steps > 96 ? 0.75 : steps > 64 ? 1 : steps > 32 ? 2 : 3;
  for (let step = 0; step < steps; step += 1) {
    const normalized = resolvedStepValue(step);
    const edited = state.sequence[step] >= 0;
    const active = step === activeStep;
    const x = step * cellWidth;
    const barHeight = 12 + normalized * laneHeight;
    const y = laneTop + laneHeight - barHeight;
    const barWidth = Math.max(1, cellWidth - barGap * 2);
    const hue = (step * 47 + normalized * 220 + now * 18 + (active ? 96 : 0)) % 360;
    const oppositeHue = (hue + 130) % 360;
    const gradient = context.createLinearGradient(x, y, x, y + barHeight);
    gradient.addColorStop(0, `hsl(${hue}, 100%, ${active ? 68 : 57}%)`);
    gradient.addColorStop(0.48, `hsl(${oppositeHue}, 100%, ${edited ? 58 : 46}%)`);
    gradient.addColorStop(1, `hsl(${(hue + 260) % 360}, 100%, 52%)`);

    context.save();
    context.shadowBlur = active ? 30 : edited ? 18 : 10;
    context.shadowColor = `hsla(${hue}, 100%, 62%, ${active ? 0.95 : 0.62})`;
    context.fillStyle = gradient;
    context.fillRect(x + barGap, y, barWidth, barHeight);
    context.restore();

    context.strokeStyle = active
      ? "rgba(255, 255, 255, 0.92)"
      : edited
        ? `hsla(${oppositeHue}, 100%, 72%, 0.62)`
        : "rgba(255, 255, 255, 0.12)";
    context.lineWidth = active ? 2 : 1;
    context.strokeRect(x + barGap + 0.5, y + 0.5, Math.max(1, barWidth - 1), Math.max(2, barHeight - 1));

    context.fillStyle = active
      ? `hsla(${hue}, 100%, 62%, 0.38)`
      : edited
        ? `hsla(${oppositeHue}, 100%, 62%, 0.22)`
        : "rgba(255, 255, 255, 0.055)";
    context.fillRect(x + barGap, footTop, barWidth, PATTERN_FOOT_HEIGHT);
  }

  const playheadX = (activeStep + 0.5) * cellWidth;
  const playheadHue = (now * 120) % 360;
  context.strokeStyle = `hsl(${playheadHue}, 100%, 64%)`;
  context.shadowBlur = 20;
  context.shadowColor = `hsla(${playheadHue}, 100%, 64%, 0.72)`;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(playheadX, height * 0.055);
  context.lineTo(playheadX, height * 0.92);
  context.stroke();
  context.shadowBlur = 0;
}

function drawPartials(context, width, height) {
  const count = Math.min(48, Math.max(4, Math.round(state.params.partials / 4)));
  context.lineWidth = 1;
  for (let index = 1; index <= count; index += 1) {
    const harmonic = index + state.params.sampOffset;
    const intensity = (1 / harmonic) * Math.min(1.4, state.params.res / 3 + 0.4);
    const x = (index / count) * width;
    const y = height * PARTIALS_BASE_Y - intensity * height * PARTIALS_TOP_SCALE;
    context.strokeStyle = index % 3 === 0 ? "rgba(255, 111, 174, 0.38)" : "rgba(157, 255, 87, 0.32)";
    context.beginPath();
    context.moveTo(x, height * PARTIALS_BASE_Y);
    context.lineTo(x, y);
    context.stroke();
  }
}

function drawTrace(context, width, height, now) {
  context.strokeStyle = "rgba(255, 255, 255, 0.78)";
  context.lineWidth = 2;
  context.beginPath();
  for (let x = 0; x < width; x += 2) {
    const phase = (x / width) * Math.PI * 8 + now * state.params.fundamental * 0.03;
    const fold = Math.sin(phase) + Math.sin(phase * state.params.ratio) * 0.34;
    const driven = Math.max(-1, Math.min(1, fold * state.params.dist * 0.58));
    const y = height * 0.14 + driven * height * 0.045;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function draw() {
  const canvas = $("stage");
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = resizeCanvas(canvas);
  const now = visualPlaybackTime();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#07090b";
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height);
  drawTrace(context, width, height, now);
  drawPattern(context, width, height, now);
  drawPartials(context, width, height);
  animationFrame = requestAnimationFrame(draw);
}

function editSequenceFromPointer(event) {
  const canvas = $("stage");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const steps = activeStepCount();
  const pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 0.9999);
  const pointerY = event.clientY - rect.top;
  const { laneTop, laneHeight } = patternMetrics(rect.width, rect.height);
  const step = Math.min(steps - 1, Math.floor(pointerX * steps));
  const normalized = clamp(1 - ((pointerY - laneTop) / laneHeight), 0, 0.9999);
  const nextSequence = [...state.sequence];
  nextSequence[step] = event.shiftKey ? -1 : normalized;
  applySequence(nextSequence);
}

function handleStagePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  state.editingSequence = true;
  $("stage").setPointerCapture?.(event.pointerId);
  editSequenceFromPointer(event);
}

function handleStagePointerMove(event) {
  if (!state.editingSequence) return;
  event.preventDefault();
  editSequenceFromPointer(event);
}

function handleStagePointerEnd(event) {
  if (!state.editingSequence) return;
  state.editingSequence = false;
  $("stage").releasePointerCapture?.(event.pointerId);
}

function resetPatch() {
  applyPreset(presets[0]);
  announce("WebGPU 303 patch reset.");
}

renderControls();
const knobRowsObserver = typeof globalThis.ResizeObserver === "function"
  ? new globalThis.ResizeObserver(() => balanceKnobRows())
  : null;
knobRowsObserver?.observe($("knobControls"));
globalThis.addEventListener?.("resize", balanceKnobRows);
setRuntimeState();
setSupportState();
outputChanged();
$("audioButton").addEventListener("click", toggleAudio);
$("synthPlayButton").addEventListener("click", () => {
  void toggleSynthPlay();
});
$("output").addEventListener("input", outputChanged);
$("chunkDuration").addEventListener("input", runtimeChanged);
$("chunkDuration").addEventListener("change", restartAudio);
$("workgroupSize").addEventListener("change", () => {
  runtimeChanged();
  void restartAudio();
});
$("resetPatch").addEventListener("click", resetPatch);
$("randomizePatch").addEventListener("click", randomizePatch);
$("mutatePatch").addEventListener("click", mutatePatch);
$("clearSequence").addEventListener("click", clearSequence);
$("randomizeSequence").addEventListener("click", randomizeSequence);
$("mutateSequence").addEventListener("click", mutateSequence);
$("invertSequence").addEventListener("click", invertSequence);
$("stage").addEventListener("pointerdown", handleStagePointerDown);
$("stage").addEventListener("pointermove", handleStagePointerMove);
$("stage").addEventListener("pointerup", handleStagePointerEnd);
$("stage").addEventListener("pointercancel", handleStagePointerEnd);
animationFrame = requestAnimationFrame(draw);

globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  knobRowsObserver?.disconnect();
  globalThis.removeEventListener?.("resize", balanceKnobRows);
  void stopAudio({ quiet: true });
});
