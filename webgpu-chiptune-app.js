import {
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS,
  WEBGPU_CHIPTUNE_WORKGROUP_SIZES,
  WebGpuChiptuneAudio,
  formatWebGpuChiptuneValue,
  sanitizeWebGpuChiptuneParams,
  webGpuChiptuneStepSnapshot,
  webGpuChiptuneSupport,
} from "./src/webgpu-chiptune.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const fract = (value) => value - Math.floor(value);

function makeSpec(key, label, step = 0.01) {
  const [min, max] = WEBGPU_CHIPTUNE_LIMITS[key];
  return Object.freeze({ key, label, min, max, step });
}

const controlGroups = Object.freeze({
  pattern: Object.freeze([
    makeSpec("tempo", "Tempo"),
    makeSpec("transpose", "Transpose", 1),
    makeSpec("patternSeed", "Pattern seed", 0.001),
    makeSpec("pitchRange", "Pitch range"),
    makeSpec("gateRate", "Gate rate"),
    makeSpec("gateLength", "Gate length"),
  ]),
  voice: Object.freeze([
    makeSpec("pulseWidth", "Pulse width"),
    makeSpec("pwmDepth", "PWM depth"),
    makeSpec("pwmRate", "PWM motion"),
    makeSpec("upperOneLevel", "Upper voice A"),
    makeSpec("upperTwoLevel", "Upper voice B"),
    makeSpec("bassPulseLevel", "Bass pulse"),
    makeSpec("bassSineLevel", "Bass sine"),
    makeSpec("leadLevel", "Lead"),
    makeSpec("arpLevel", "Arpeggio"),
    makeSpec("noiseLevel", "Noise texture"),
    makeSpec("stereoWidth", "Voice width"),
  ]),
  drums: Object.freeze([
    makeSpec("kickLevel", "Kick"),
    makeSpec("snareLevel", "Snare"),
    makeSpec("hatLevel", "Hats"),
    makeSpec("shakerLevel", "Shaker"),
    makeSpec("kickTone", "Kick tone"),
    makeSpec("snareTone", "Snare tone"),
    makeSpec("drumDecay", "Drum decay"),
    makeSpec("drumMix", "Drum bus"),
    makeSpec("ghostDrums", "Ghost drums"),
  ]),
  echo: Object.freeze([
    makeSpec("echoTaps", "Echo taps", 1),
    makeSpec("echoTime", "Echo spacing"),
    makeSpec("echoDecay", "Echo decay"),
    makeSpec("echoStereo", "Ping-pong width"),
    makeSpec("fadeIn", "Startup fade"),
    makeSpec("gain", "Shader gain"),
  ]),
  advanced: Object.freeze([
    makeSpec("scaleMask", "Scale pitch classes", 1),
    makeSpec("upperOneSpan", "Upper A note span", 1),
    makeSpec("upperTwoSpan", "Upper B + lead span", 1),
    makeSpec("bassSpan", "Bass note span", 1),
    makeSpec("upperOneRegister", "Upper A register", 1),
    makeSpec("bassRegister", "Bass register", 1),
    makeSpec("arpRegister", "Arpeggio register", 1),
    makeSpec("sectionUnits", "Section length", 1),
    makeSpec("pitchClock", "Pitch clock", 0.25),
    makeSpec("bassClock", "Bass clock", 0.05),
    makeSpec("gateFastRatio", "Fast-gate ratio", 0.05),
    makeSpec("gateSwitchShortUnits", "Gate switch short", 0.25),
    makeSpec("gateSwitchLongUnits", "Gate switch long", 0.25),
    makeSpec("leadTrillRate", "Lead trill rate", 0.5),
    makeSpec("leadInterval", "Lead trill interval", 1),
    makeSpec("leadPhraseUnits", "Lead phrase length", 0.1),
    makeSpec("arpRate", "Arpeggio rate", 0.5),
    makeSpec("arpSpan", "Arpeggio span", 0.25),
    makeSpec("arpOctaveRate", "Arpeggio octave motion", 0.0625),
    makeSpec("arpOctaves", "Arpeggio octave range", 1),
    makeSpec("bassPulseWidth", "Bass pulse width"),
    makeSpec("drumRate", "Drum rate", 0.05),
    makeSpec("echoCrossfeed", "Echo crossfeed"),
    makeSpec("gateAttack", "Gate attack", 0.005),
    makeSpec("gateRelease", "Gate release"),
    makeSpec("texturePeriod", "Noise-texture period", 0.25),
    makeSpec("textureDecay", "Noise-texture decay", 0.05),
    makeSpec("kickCycle", "Kick cycle", 0.05),
    makeSpec("kickSubcycle", "Kick subcycle", 0.05),
    makeSpec("snareNoiseMix", "Snare noise / tone"),
    makeSpec("hatBalance", "Hat layer balance"),
    makeSpec("ghostDelayDivisor", "Ghost delay divisor", 0.25),
    makeSpec("ghostPan", "Ghost pan"),
  ]),
});

const controlSpecs = Object.freeze(Object.values(controlGroups).flat());
const controlSpecsByKey = new Map(controlSpecs.map((spec) => [spec.key, spec]));
const knobOrder = Object.freeze([
  "tempo",
  "patternSeed",
  "pitchRange",
  "gateLength",
  "pulseWidth",
  "pwmDepth",
  "bassPulseLevel",
  "leadLevel",
  "drumMix",
  "kickLevel",
  "snareLevel",
  "echoTime",
  "echoDecay",
  "echoStereo",
  "stereoWidth",
  "gain",
]);
const knobLabels = Object.freeze({
  tempo: "Tempo",
  patternSeed: "Seed",
  pitchRange: "Range",
  gateLength: "Gate",
  pulseWidth: "Pulse",
  pwmDepth: "PWM",
  bassPulseLevel: "Bass",
  leadLevel: "Lead",
  drumMix: "Drums",
  kickLevel: "Kick",
  snareLevel: "Snare",
  echoTime: "Echo",
  echoDecay: "Decay",
  echoStereo: "Pingpong",
  stereoWidth: "Width",
  gain: "Level",
});
const knobHueByKey = new Map(knobOrder.map((key, index) => [key, (index * 41 + 194) % 360]));
const integerParams = new Set(WEBGPU_CHIPTUNE_INTEGER_PARAMS);
const scaleLabels = Object.freeze(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]);
const gateStates = Object.freeze([
  Object.freeze({ duration: 0, label: "off", glyph: "·" }),
  Object.freeze({ duration: 0.8, label: "short", glyph: "˙" }),
  Object.freeze({ duration: 1, label: "medium", glyph: "•" }),
  Object.freeze({ duration: 2, label: "long", glyph: "■" }),
]);
const gateCodeKeys = Object.freeze([
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
]);
const gateCodeKeySet = new Set(gateCodeKeys);
const randomizableParamOrder = Object.freeze(
  WEBGPU_CHIPTUNE_PARAM_ORDER.filter((key) => !gateCodeKeySet.has(key)),
);

function patch(values = {}) {
  return sanitizeWebGpuChiptuneParams({ ...WEBGPU_CHIPTUNE_DEFAULTS, ...values });
}

const presets = Object.freeze([
  {
    id: "source-tracker",
    label: "Source Tracker",
    params: WEBGPU_CHIPTUNE_DEFAULTS,
  },
  {
    id: "pocket-console",
    label: "Pocket Console",
    params: patch({
      tempo: 1.65,
      transpose: -5,
      patternSeed: 2.451,
      pitchRange: 0.74,
      gateRate: 1.35,
      gateLength: 0.58,
      pulseWidth: 0.34,
      pwmDepth: 0.16,
      bassPulseLevel: 1.35,
      bassSineLevel: 0.72,
      leadLevel: 0.74,
      arpLevel: 0.68,
      noiseLevel: 0.38,
      kickLevel: 1.25,
      snareLevel: 0.92,
      hatLevel: 0.72,
      shakerLevel: 0.55,
      drumDecay: 0.68,
      ghostDrums: 0.3,
      echoTaps: 4,
      echoTime: 0.19,
      echoDecay: 0.22,
      gain: 0.72,
    }),
  },
  {
    id: "glass-cartridge",
    label: "Glass Cartridge",
    params: patch({
      tempo: 1.05,
      transpose: 5,
      patternSeed: 3.257,
      pitchRange: 1.32,
      gateLength: 1.28,
      pulseWidth: 0.28,
      pwmDepth: 0.39,
      pwmRate: 0.72,
      upperOneLevel: 1.22,
      upperTwoLevel: 1.1,
      bassPulseLevel: 0.52,
      bassSineLevel: 0.45,
      leadLevel: 1.42,
      arpLevel: 1.55,
      noiseLevel: 0.22,
      stereoWidth: 1.34,
      drumMix: 0.58,
      ghostDrums: 0.62,
      echoTaps: 8,
      echoTime: 0.24,
      echoDecay: 0.47,
      echoStereo: 1.35,
      gain: 0.6,
    }),
  },
  {
    id: "subterranean-menu",
    label: "Subterranean Menu",
    params: patch({
      tempo: 0.74,
      transpose: -12,
      patternSeed: 1.127,
      pitchRange: 0.55,
      gateRate: 0.72,
      gateLength: 1.62,
      pulseWidth: 0.58,
      pwmDepth: 0.1,
      upperOneLevel: 0.28,
      upperTwoLevel: 0.34,
      bassPulseLevel: 1.8,
      bassSineLevel: 1.72,
      leadLevel: 0.25,
      arpLevel: 0.42,
      noiseLevel: 0.7,
      kickLevel: 1.4,
      snareLevel: 0.5,
      hatLevel: 0.35,
      shakerLevel: 0.25,
      kickTone: 0.62,
      drumDecay: 1.55,
      drumMix: 1.15,
      ghostDrums: 0.22,
      echoTaps: 5,
      echoTime: 0.42,
      echoDecay: 0.42,
      gain: 0.58,
    }),
  },
  {
    id: "boss-corridor",
    label: "Boss Corridor",
    params: patch({
      tempo: 1.86,
      transpose: -2,
      patternSeed: 5.137,
      pitchRange: 1.65,
      gateRate: 1.7,
      gateLength: 0.42,
      pulseWidth: 0.2,
      pwmDepth: 0.18,
      pwmRate: 1.8,
      upperOneLevel: 1.4,
      upperTwoLevel: 1.28,
      bassPulseLevel: 1.25,
      bassSineLevel: 0.62,
      leadLevel: 1.5,
      arpLevel: 1.18,
      noiseLevel: 0.62,
      kickLevel: 1.55,
      snareLevel: 1.4,
      hatLevel: 1.25,
      shakerLevel: 1.12,
      kickTone: 1.72,
      snareTone: 1.45,
      drumDecay: 0.52,
      drumMix: 1.15,
      ghostDrums: 0.5,
      echoTaps: 3,
      echoTime: 0.14,
      echoDecay: 0.18,
      gain: 0.55,
    }),
  },
  {
    id: "empty-arcade",
    label: "Empty Arcade",
    params: patch({
      tempo: 0.55,
      transpose: 7,
      patternSeed: 6.403,
      pitchRange: 1.12,
      gateRate: 0.45,
      gateLength: 1.86,
      pulseWidth: 0.46,
      pwmDepth: 0.38,
      pwmRate: 0.11,
      upperOneLevel: 0.72,
      upperTwoLevel: 0.88,
      bassPulseLevel: 0.36,
      bassSineLevel: 0.58,
      leadLevel: 0.92,
      arpLevel: 1.35,
      noiseLevel: 0.8,
      stereoWidth: 1.42,
      kickLevel: 0.3,
      snareLevel: 0.46,
      hatLevel: 0.6,
      shakerLevel: 0.72,
      drumDecay: 2.2,
      drumMix: 0.42,
      ghostDrums: 0.82,
      echoTaps: 8,
      echoTime: 0.61,
      echoDecay: 0.66,
      echoStereo: 1.5,
      fadeIn: 0.3,
      gain: 0.56,
    }),
  },
]);

const SAFE_RANDOM_RANGES = Object.freeze({
  tempo: [0.55, 2.2],
  transpose: [-17, 9],
  patternSeed: [0.45, 7.4],
  pitchRange: [0.45, 1.6],
  gateRate: [0.45, 2.25],
  gateLength: [0.35, 1.75],
  pulseWidth: [0.12, 0.82],
  pwmDepth: [0.03, 0.4],
  pwmRate: [0.04, 2.1],
  upperOneLevel: [0.2, 1.45],
  upperTwoLevel: [0.2, 1.45],
  bassPulseLevel: [0.25, 1.55],
  bassSineLevel: [0.2, 1.45],
  leadLevel: [0.15, 1.5],
  arpLevel: [0.2, 1.55],
  noiseLevel: [0.08, 1.15],
  stereoWidth: [0.25, 1.45],
  kickLevel: [0.2, 1.55],
  snareLevel: [0.2, 1.45],
  hatLevel: [0.15, 1.35],
  shakerLevel: [0.1, 1.25],
  kickTone: [0.45, 2.2],
  snareTone: [0.5, 2.1],
  drumDecay: [0.45, 2.3],
  drumMix: [0.25, 1.25],
  ghostDrums: [0.05, 1],
  echoTaps: [2, 8],
  echoTime: [0.1, 0.62],
  echoDecay: [0.08, 0.67],
  echoStereo: [0.2, 1.45],
  fadeIn: [0.08, 1.7],
  gain: [0.42, 0.78],
  upperOneSpan: [8, 32],
  upperTwoSpan: [5, 22],
  bassSpan: [2, 10],
  upperOneRegister: [-24, 0],
  bassRegister: [-48, -24],
  arpRegister: [-24, 0],
  sectionUnits: [12, 52],
  pitchClock: [1.5, 8],
  bassClock: [0.5, 2],
  gateFastRatio: [1.2, 3.2],
  gateSwitchShortUnits: [2, 10],
  gateSwitchLongUnits: [8, 40],
  leadTrillRate: [4, 40],
  leadInterval: [-7, 14],
  leadPhraseUnits: [1.5, 6],
  arpRate: [12, 64],
  arpSpan: [4, 18],
  arpOctaveRate: [0.125, 2],
  arpOctaves: [1, 4],
  bassPulseWidth: [0.12, 0.82],
  drumRate: [0.5, 2.2],
  echoCrossfeed: [0.1, 0.85],
  gateAttack: [0.015, 0.16],
  gateRelease: [0.12, 1.2],
  texturePeriod: [2, 20],
  textureDecay: [0.15, 2],
  kickCycle: [1, 4],
  kickSubcycle: [0.5, 2.5],
  snareNoiseMix: [0.18, 0.85],
  hatBalance: [0.15, 0.85],
  ghostDelayDivisor: [2, 16],
  ghostPan: [-0.75, 0.75],
});

const support = webGpuChiptuneSupport(globalThis);
const state = {
  params: sanitizeWebGpuChiptuneParams(),
  presetId: "source-tracker",
  audioOn: false,
  synthPlaying: false,
  transportOffset: 0,
  transportStartedAt: 0,
  chunkDuration: WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize,
  editingStage: false,
  disposed: false,
};

const controlInputs = new Map();
const controlOutputs = new Map();
const knobControls = new Map();
const knobOutputs = new Map();
const scaleButtons = new Map();
const gateButtons = new Map();
const trackerNoteCache = new Map();
let trackerCacheParams = null;

let engine = null;
let audioStartPromise = null;
let audioLifecycleGeneration = 0;
let transportGeneration = 0;
let animationFrame = 0;
let activeKnobDrag = null;
let resizeObserver = null;
let waxStateListener = null;

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

function transportTime() {
  if (state.synthPlaying && state.audioOn && engine) {
    const gpuTime = engine.currentPlaybackTime();
    if (Number.isFinite(gpuTime)) return gpuTime;
  }
  if (!state.synthPlaying) return state.transportOffset;
  return state.transportOffset + Math.max(0, performance.now() / 1000 - state.transportStartedAt);
}

function alignVisualTransport(offset, actualStartTime, audioEngine) {
  const contextTime = Number(audioEngine?.context?.currentTime) || 0;
  const startDelay = Math.max(0, Number(actualStartTime) - contextTime);
  state.transportOffset = Math.max(0, Number(offset) || 0);
  state.transportStartedAt = performance.now() / 1000 + startDelay;
}

async function restartSynchronizedAudio(audioEngine, offset, generation) {
  audioEngine.setPlaybackEnabled(false);
  const actualStartTime = await audioEngine.restart({ offset });
  if (
    engine !== audioEngine
    || generation !== transportGeneration
    || !state.synthPlaying
  ) {
    audioEngine.pause();
    return false;
  }
  alignVisualTransport(offset, actualStartTime, audioEngine);
  audioEngine.setPlaybackEnabled(true);
  return true;
}

function setRuntimeState() {
  $("chunkDurationOut").textContent = Math.round(state.chunkDuration * 1000) + " ms";
  $("workgroupSizeOut").textContent = state.workgroupSize + " lanes";
  $("runtimeState").textContent = state.workgroupSize + " lanes";
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
    $("streamState").textContent = "WGSL tracker engine";
  }
  $("audioButton").disabled = !support.supported || Boolean(audioStartPromise);
}

function paintAudioReadout() {
  if (state.audioOn) {
    $("engineBadge").textContent = state.synthPlaying ? "Shader song playing" : "WebGPU armed";
    $("stageReadout").textContent = "WEBGPU · "
      + Math.round(engine?.sampleRate ?? 44100)
      + " HZ · "
      + (state.synthPlaying ? "TRACKER PLAYING" : "TRACKER PAUSED");
  } else {
    $("engineBadge").textContent = state.synthPlaying ? "Visual tracker · audio off" : "WGSL sound shader";
    $("stageReadout").textContent = state.synthPlaying
      ? "VISUAL TRANSPORT PLAYING · AUDIO OFF"
      : "WEBGPU · STANDBY · AUDIO OFF";
  }
  $("stage").setAttribute(
    "aria-label",
    "Procedural 32-step chiptune tracker. Horizontal position changes the pattern seed; "
      + "vertical position changes pitch range. Audio "
      + (state.audioOn ? "on" : "off")
      + ", transport "
      + (state.synthPlaying ? "playing." : "paused."),
  );
}

function setAudioState(enabled) {
  state.audioOn = Boolean(enabled);
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
  if (state.audioOn && engine) {
    $("gpuState").textContent = "WebGPU streaming";
    $("streamState").textContent = Math.round(engine.chunkDurationInSeconds * 1000)
      + " ms stereo chunks";
  } else {
    setSupportState();
  }
  paintAudioReadout();
}

function setSynthPlayButtonState() {
  const action = state.synthPlaying ? "Pause WebGPU Chiptune" : "Play WebGPU Chiptune";
  const button = $("synthPlayButton");
  button.disabled = state.disposed;
  button.setAttribute("aria-pressed", String(state.synthPlaying));
  button.setAttribute("aria-label", action);
  button.title = action + " (Space)";
  $("synthPlayLabel").textContent = state.synthPlaying ? "Pause chiptune" : "Play chiptune";
  $("synthPlayState").textContent = state.synthPlaying ? "playing · Space" : "paused · Space";
  paintAudioReadout();
}

function notifyWaxState() {
  waxStateListener?.({
    parameters: { ...state.params },
    activePresetId: state.presetId,
  });
}

function gateCodeKey(lane, step) {
  return "gate" + lane + Math.floor(step / 8);
}

function gateStateIndex(params, lane, step) {
  const code = Math.round(params[gateCodeKey(lane, step)] ?? 0);
  return (code >> ((step % 8) * 2)) & 3;
}

function setGateState(params, lane, step, stateIndex) {
  const key = gateCodeKey(lane, step);
  const shift = (step % 8) * 2;
  const code = Math.round(params[key] ?? 0);
  return {
    ...params,
    [key]: (code & ~(3 << shift)) | ((stateIndex & 3) << shift),
  };
}

function enabledPitchClassCount(mask) {
  let value = Math.round(mask);
  let count = 0;
  for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
    if ((value & (1 << pitchClass)) !== 0) count += 1;
  }
  return count;
}

function syncParamOutputs() {
  for (const [key, input] of controlInputs) {
    input.value = String(state.params[key]);
    const output = controlOutputs.get(key);
    if (output) output.textContent = formatWebGpuChiptuneValue(key, state.params[key]);
  }
  for (const [key, knob] of knobControls) {
    const spec = knob.controlSpec;
    const value = state.params[key];
    const percent = clamp((value - spec.min) / Math.max(0.0001, spec.max - spec.min), 0, 1);
    const angle = -135 + percent * 270;
    const valueText = formatWebGpuChiptuneValue(key, value);
    knob.style.setProperty("--knob-angle", angle + "deg");
    knob.style.setProperty("--knob-fill", percent * 75 + "%");
    knob.setAttribute("aria-valuenow", String(value));
    knob.setAttribute("aria-valuetext", valueText);
    const output = knobOutputs.get(key);
    if (output) output.textContent = valueText;
  }

  const scaleOutput = $("scaleMaskOut");
  if (scaleOutput) {
    scaleOutput.textContent = enabledPitchClassCount(state.params.scaleMask)
      + " notes · "
      + formatWebGpuChiptuneValue("scaleMask", state.params.scaleMask);
  }
  for (const [pitchClass, button] of scaleButtons) {
    const enabled = (state.params.scaleMask & (1 << pitchClass)) !== 0;
    button.setAttribute("aria-pressed", String(enabled));
  }
  for (const [identity, button] of gateButtons) {
    const [lane, stepText] = identity.split(":");
    const step = Number(stepText);
    const gateState = gateStates[gateStateIndex(state.params, lane, step)];
    button.dataset.gateState = String(gateStates.indexOf(gateState));
    button.textContent = gateState.glyph;
    button.setAttribute("aria-pressed", String(gateState.duration > 0));
    button.setAttribute("aria-label", "Gate " + lane + ", step " + (step + 1) + ", " + gateState.label);
    button.title = "Step " + (step + 1) + ": " + gateState.label;
  }

  $("patternState").textContent = Math.round(state.params.tempo * 60)
    + " BPM · "
    + (presets.find(({ id }) => id === state.presetId)?.label ?? "custom");
  $("voiceState").textContent = "seed " + state.params.patternSeed.toFixed(3);
  $("drumState").textContent = "bus " + Math.round(state.params.drumMix * 100) + "%";
  $("echoState").textContent = Math.round(state.params.echoTaps) + " taps";
  $("advancedState").textContent = enabledPitchClassCount(state.params.scaleMask)
    + "-note scale · editable gates";
  $("gestureReadout").textContent = "seed "
    + state.params.patternSeed.toFixed(3)
    + " · range "
    + state.params.pitchRange.toFixed(2)
    + "x";

  for (const button of $("presetButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === state.presetId));
  }
}

function applyParams(nextParams, presetId = "custom", { notify = true } = {}) {
  state.params = sanitizeWebGpuChiptuneParams(nextParams);
  state.presetId = presetId;
  syncParamOutputs();
  engine?.updateParams(state.params);
  if (notify) notifyWaxState();
}

function applyPreset(preset) {
  applyParams(preset.params, preset.id);
  announce(preset.label + " selected.");
}

function controlStep(spec) {
  const range = Math.max(0.0001, spec.max - spec.min);
  return Math.max(Number(spec.step) || 0, range / 140);
}

function applyControlValue(spec, rawValue) {
  let value = clamp(rawValue, spec.min, spec.max);
  if (integerParams.has(spec.key)) value = Math.round(value);
  applyParams({ ...state.params, [spec.key]: value });
}

function createRangeControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";
  wrapper.htmlFor = spec.key;

  const row = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = spec.key + "Out";
  output.htmlFor = spec.key;
  row.append(label, output);

  const input = document.createElement("input");
  input.id = spec.key;
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.controlSpec = spec;
  input.setAttribute("aria-label", spec.label);
  input.addEventListener("input", () => applyControlValue(spec, input.value));

  controlInputs.set(spec.key, input);
  controlOutputs.set(spec.key, output);
  wrapper.append(row, input);
  return wrapper;
}

function createScaleEditor() {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-advanced-editor";
  const heading = document.createElement("span");
  heading.className = "chiptune-editor-heading";
  const label = document.createElement("b");
  label.textContent = "Scale pitch classes";
  const output = document.createElement("output");
  output.id = "scaleMaskOut";
  heading.append(label, output);

  const grid = document.createElement("div");
  grid.className = "chiptune-scale-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Scale pitch classes");
  scaleButtons.clear();
  for (let pitchClass = 0; pitchClass < scaleLabels.length; pitchClass += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scaleLabels[pitchClass];
    button.addEventListener("click", () => {
      const bit = 1 << pitchClass;
      const nextMask = state.params.scaleMask ^ bit;
      if (nextMask === 0) {
        announce("The scale needs at least one pitch class.");
        return;
      }
      applyParams({ ...state.params, scaleMask: nextMask });
    });
    scaleButtons.set(pitchClass, button);
    grid.append(button);
  }
  wrapper.append(heading, grid);
  return wrapper;
}

function createGateLane(lane) {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-gate-lane";
  const label = document.createElement("b");
  label.textContent = "Gate " + lane;
  const grid = document.createElement("div");
  grid.className = "chiptune-gate-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Gate " + lane + " 32-step pattern");
  for (let step = 0; step < 32; step += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      const nextState = (gateStateIndex(state.params, lane, step) + 1) % gateStates.length;
      applyParams(setGateState(state.params, lane, step, nextState));
    });
    gateButtons.set(lane + ":" + step, button);
    grid.append(button);
  }
  wrapper.append(label, grid);
  return wrapper;
}

function createGateEditor() {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-advanced-editor chiptune-gate-editor";
  gateButtons.clear();
  wrapper.append(createGateLane("A"), createGateLane("B"));
  const note = document.createElement("small");
  note.textContent = "Each cell cycles off · short · medium · long.";
  wrapper.append(note);
  return wrapper;
}

function createKnobControl(key) {
  const spec = controlSpecsByKey.get(key);
  const hue = knobHueByKey.get(key) ?? 0;
  const wrapper = document.createElement("div");
  wrapper.className = "webgpu-knob";
  wrapper.style.setProperty("--knob-hue", String(hue));
  wrapper.style.setProperty("--knob-hue-b", String((hue + 126) % 360));
  wrapper.style.setProperty("--knob-hue-c", String((hue + 252) % 360));

  const dial = document.createElement("div");
  dial.className = "webgpu-knob-dial";
  dial.tabIndex = 0;
  dial.controlSpec = spec;
  dial.dataset.paramKey = key;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", (knobLabels[key] ?? spec.label) + " — " + spec.label);
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
      key,
      startY: event.clientY,
      startValue: state.params[key],
    };
    dial.setPointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointermove", (event) => {
    if (activeKnobDrag?.key !== key) return;
    event.preventDefault();
    const range = spec.max - spec.min;
    applyControlValue(spec, activeKnobDrag.startValue + ((activeKnobDrag.startY - event.clientY) / 130) * range);
  });
  dial.addEventListener("pointerup", (event) => {
    if (activeKnobDrag?.key !== key) return;
    activeKnobDrag = null;
    dial.releasePointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointercancel", () => {
    if (activeKnobDrag?.key === key) activeKnobDrag = null;
  });
  dial.addEventListener("wheel", (event) => {
    event.preventDefault();
    applyControlValue(spec, state.params[key] + Math.sign(-event.deltaY) * controlStep(spec));
  }, { passive: false });
  dial.addEventListener("keydown", (event) => {
    const step = controlStep(spec);
    const jump = step * 8;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      applyControlValue(spec, state.params[key] + step);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      applyControlValue(spec, state.params[key] - step);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      applyControlValue(spec, state.params[key] + jump);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      applyControlValue(spec, state.params[key] - jump);
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

function balancedKnobColumnCount(totalKnobs, maximumColumns) {
  const total = Math.max(1, Math.floor(Number(totalKnobs) || 1));
  const boundedMaximum = Math.floor(clamp(maximumColumns, 1, total));
  const rowCount = Math.ceil(total / boundedMaximum);
  return Math.ceil(total / rowCount);
}

function balanceKnobRows() {
  const bank = $("knobControls");
  const firstKnob = bank.querySelector(".webgpu-knob");
  const bankBounds = bank.getBoundingClientRect();
  const knobBounds = firstKnob?.getBoundingClientRect();
  if (!bank.children.length || !bankBounds.width || !knobBounds?.width) return;
  const styles = getComputedStyle(bank);
  const gap = Number.parseFloat(styles.columnGap) || 0;
  const maximumColumns = Math.floor((bankBounds.width + gap) / (knobBounds.width + gap));
  const columns = balancedKnobColumnCount(bank.children.length, maximumColumns);
  bank.style.setProperty("--knob-columns", String(columns));
  bank.dataset.knobColumns = String(columns);
}

function renderControls() {
  $("knobControls").replaceChildren(...knobOrder.map(createKnobControl));
  $("patternControls").replaceChildren(...controlGroups.pattern.map(createRangeControl));
  $("voiceControls").replaceChildren(...controlGroups.voice.map(createRangeControl));
  $("drumControls").replaceChildren(...controlGroups.drums.map(createRangeControl));
  $("echoControls").replaceChildren(...controlGroups.echo.map(createRangeControl));
  $("scaleControls").replaceChildren(createScaleEditor());
  $("gateControls").replaceChildren(createGateEditor());
  $("advancedControls").replaceChildren(
    ...controlGroups.advanced.filter(({ key }) => key !== "scaleMask").map(createRangeControl),
  );

  const buttons = presets.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.presetId = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(preset.id === state.presetId));
    button.addEventListener("click", () => applyPreset(preset));
    return button;
  });
  $("presetButtons").replaceChildren(...buttons);
  balanceKnobRows();
  requestAnimationFrame(balanceKnobRows);
  syncParamOutputs();
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function safeRandomValue(key) {
  if (key === "scaleMask") {
    const musicalMasks = [1717, 1453, 1387, 661, 1193, 2741, 4095];
    return musicalMasks[Math.floor(Math.random() * musicalMasks.length)];
  }
  const [minimum, maximum] = SAFE_RANDOM_RANGES[key];
  const value = randomBetween(minimum, maximum);
  return integerParams.has(key) ? Math.round(value) : value;
}

function randomGateLane() {
  const codes = [0, 0, 0, 0];
  let enabled = 0;
  for (let step = 0; step < 32; step += 1) {
    let gateState = 0;
    if (Math.random() < 0.42) {
      const roll = Math.random();
      gateState = roll < 0.28 ? 1 : roll < 0.62 ? 2 : 3;
      enabled += 1;
    }
    const segment = Math.floor(step / 8);
    codes[segment] |= gateState << ((step % 8) * 2);
  }
  if (enabled === 0) codes[0] = 3;
  return codes;
}

function energyManagedParams(params) {
  const next = sanitizeWebGpuChiptuneParams(params);
  const voiceKeys = [
    "upperOneLevel",
    "upperTwoLevel",
    "bassPulseLevel",
    "bassSineLevel",
    "leadLevel",
    "arpLevel",
    "noiseLevel",
  ];
  const voiceEnergy = voiceKeys.reduce((sum, key) => sum + next[key], 0) / voiceKeys.length;
  const drumEnergy = next.drumMix
    * (next.kickLevel + next.snareLevel + next.hatLevel + next.shakerLevel) / 4;
  const echoEnergy = next.echoDecay * Math.max(1, next.echoTaps / 4);
  const ceiling = clamp(0.9 - voiceEnergy * 0.12 - drumEnergy * 0.09 - echoEnergy * 0.08, 0.42, 0.76);
  next.gain = Math.min(next.gain, ceiling);
  return next;
}

function randomizePatch() {
  const next = {};
  for (const key of randomizableParamOrder) next[key] = safeRandomValue(key);
  const laneA = randomGateLane();
  const laneB = randomGateLane();
  laneA.forEach((code, index) => {
    next["gateA" + index] = code;
  });
  laneB.forEach((code, index) => {
    next["gateB" + index] = code;
  });
  applyParams(energyManagedParams(next));
  announce("Safe shader parameters randomized.");
}

function mutatePatch() {
  const next = { ...state.params };
  const shuffled = [...randomizableParamOrder].sort(() => Math.random() - 0.5);
  for (const key of shuffled.slice(0, 9)) {
    if (key === "scaleMask") {
      next[key] = safeRandomValue(key);
      continue;
    }
    const [minimum, maximum] = SAFE_RANDOM_RANGES[key];
    const amount = (maximum - minimum) * 0.09;
    next[key] = clamp(next[key] + randomBetween(-amount, amount), minimum, maximum);
    if (integerParams.has(key)) next[key] = Math.round(next[key]);
  }
  const lane = Math.random() < 0.5 ? "A" : "B";
  const step = Math.floor(Math.random() * 32);
  const gateMutation = setGateState(
    next,
    lane,
    step,
    (gateStateIndex(next, lane, step) + 1 + Math.floor(Math.random() * 3)) % 4,
  );
  applyParams(energyManagedParams(gateMutation));
  announce("Shader patch mutated.");
}

function outputChanged() {
  const value = clamp($("output").value, 0, 1);
  $("outputOut").textContent = Math.round(value * 100) + "%";
  engine?.setOutput(value);
}

async function startAudio() {
  if (state.audioOn && engine?.context) return true;
  if (audioStartPromise) return audioStartPromise;

  clearError();
  $("audioButton").disabled = true;
  const generation = audioLifecycleGeneration;
  const nextEngine = new WebGpuChiptuneAudio(globalThis, {
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
  });
  nextEngine.setOutput(Number($("output").value));
  nextEngine.setPlaybackEnabled(false);
  nextEngine.setErrorHandler((error) => {
    showError(error);
    if (engine === nextEngine) void stopAudio({ quiet: true });
  });
  engine = nextEngine;

  let pending;
  pending = nextEngine.start(state.params, {
    offset: 0,
    autoStart: false,
  }).then(async (context) => {
    if (
      generation !== audioLifecycleGeneration
      || engine !== nextEngine
      || context !== nextEngine.context
    ) {
      await nextEngine.stop();
      return false;
    }
    nextEngine.setOutput(Number($("output").value));
    nextEngine.setPlaybackEnabled(false);
    if (state.synthPlaying) {
      const offset = transportTime();
      const playGeneration = transportGeneration;
      await restartSynchronizedAudio(nextEngine, offset, playGeneration);
    }
    setAudioState(true);
    announce(state.synthPlaying
      ? "WebGPU Chiptune audio on and tracker playing."
      : "WebGPU Chiptune audio ready.");
    return true;
  }).catch(async (error) => {
    if (engine === nextEngine) engine = null;
    await nextEngine.stop().catch(() => {});
    setAudioState(false);
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
    $("audioButton").disabled = !support.supported;
  });

  audioStartPromise = pending;
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  audioLifecycleGeneration += 1;
  const previous = engine;
  engine = null;
  audioStartPromise = null;
  if (previous) await previous.stop();
  setAudioState(false);
  if (!quiet) announce("WebGPU Chiptune audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

function pauseTransport({ quiet = false } = {}) {
  if (!state.synthPlaying) return;
  state.transportOffset = transportTime();
  transportGeneration += 1;
  state.synthPlaying = false;
  engine?.setPlaybackEnabled(false);
  engine?.pause();
  setSynthPlayButtonState();
  if (!quiet) announce("WebGPU Chiptune paused.");
}

async function playTransport({ quiet = false } = {}) {
  if (state.synthPlaying) return;
  transportGeneration += 1;
  const generation = transportGeneration;
  const offset = state.transportOffset;
  state.synthPlaying = true;

  if (!state.audioOn || !engine) {
    state.transportStartedAt = performance.now() / 1000;
    setSynthPlayButtonState();
    if (!quiet) announce("Audio is off — turn it on to hear playback.");
    return;
  }

  const activeEngine = engine;
  state.transportStartedAt = Number.POSITIVE_INFINITY;
  setSynthPlayButtonState();
  try {
    const started = await restartSynchronizedAudio(activeEngine, offset, generation);
    if (started) {
      if (!quiet) announce("WebGPU Chiptune playing.");
    }
  } catch (error) {
    showError(error);
    await stopAudio({ quiet: true });
  }
}

async function toggleSynthPlay() {
  if (state.synthPlaying) pauseTransport();
  else await playTransport();
}

async function restartAudio() {
  setRuntimeState();
  if (!state.audioOn) return;
  await stopAudio({ quiet: true });
  await startAudio();
}

function runtimeChanged() {
  state.chunkDuration = clamp($("chunkDuration").value, 0.03, 0.25);
  const candidate = Number($("workgroupSize").value);
  state.workgroupSize = WEBGPU_CHIPTUNE_WORKGROUP_SIZES.includes(candidate)
    ? candidate
    : WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize;
  setRuntimeState();
}

function resetPatch() {
  applyParams(WEBGPU_CHIPTUNE_DEFAULTS, "source-tracker");
  state.transportOffset = 0;
  if (state.synthPlaying) {
    transportGeneration += 1;
    const generation = transportGeneration;
    if (state.audioOn && engine) {
      const activeEngine = engine;
      state.transportStartedAt = Number.POSITIVE_INFINITY;
      void restartSynchronizedAudio(activeEngine, 0, generation).catch(async (error) => {
        showError(error);
        await stopAudio({ quiet: true });
      });
    } else {
      state.transportStartedAt = performance.now() / 1000;
    }
  } else {
    engine?.pause();
  }
  announce("Source tracker patch restored.");
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const backingWidth = Math.max(1, Math.round(width * pixelRatio));
  const backingHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  return { width, height, pixelRatio };
}

const laneDefinitions = Object.freeze([
  ["upperOne", "UPPER A", "#53f6ff"],
  ["upperTwo", "UPPER B", "#9dff57"],
  ["lead", "LEAD", "#ff65bd"],
  ["arp", "ARP", "#f4c95d"],
  ["bass", "BASS", "#9c8dff"],
]);

function trackerNotesForLane(key, subdivisions) {
  if (trackerCacheParams !== state.params) {
    trackerCacheParams = state.params;
    trackerNoteCache.clear();
  }
  const cacheKey = key + ":" + subdivisions;
  let notes = trackerNoteCache.get(cacheKey);
  if (!notes) {
    const pointCount = 32 * subdivisions;
    notes = new Float32Array(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      const step = Math.floor(point / subdivisions);
      const substep = (point % subdivisions + 0.5) / subdivisions;
      notes[point] = webGpuChiptuneStepSnapshot(step, state.params, substep)[key];
    }
    trackerNoteCache.set(cacheKey, notes);
  }
  return notes;
}

function drawBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071218");
  gradient.addColorStop(0.48, "#08090f");
  gradient.addColorStop(1, "#170918");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(102, 216, 255, 0.065)";
  context.lineWidth = 1;
  const grid = Math.max(28, Math.round(width / 36));
  context.beginPath();
  for (let x = 0; x <= width; x += grid) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += grid) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawTracker(context, width, height, time) {
  const top = height * 0.24;
  const bottom = height * 0.88;
  const laneHeight = (bottom - top) / laneDefinitions.length;
  const cellWidth = width / 32;
  const activeStep = ((Math.floor(time * state.params.tempo * state.params.pitchClock) % 32) + 32) % 32;

  context.fillStyle = "rgba(157, 255, 87, 0.075)";
  context.fillRect(activeStep * cellWidth, top, cellWidth, bottom - top);

  context.textBaseline = "middle";
  context.font = Math.max(8, width / 150) + "px ui-monospace, SFMono-Regular, Consolas, monospace";

  for (let laneIndex = 0; laneIndex < laneDefinitions.length; laneIndex += 1) {
    const [key, label, color] = laneDefinitions[laneIndex];
    const laneTop = top + laneIndex * laneHeight;
    context.fillStyle = laneIndex % 2 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.12)";
    context.fillRect(0, laneTop, width, laneHeight);

    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.beginPath();
    context.moveTo(0, laneTop);
    context.lineTo(width, laneTop);
    context.stroke();

    context.fillStyle = color;
    context.globalAlpha = 0.68;
    context.fillText(label, 8, laneTop + laneHeight * 0.5);
    context.globalAlpha = 1;

    const subdivisions = key === "lead" || key === "arp" ? 8 : 1;
    const pointCount = 32 * subdivisions;
    const notes = trackerNotesForLane(key, subdivisions);
    let previousY = laneTop + laneHeight * 0.5;
    context.beginPath();
    for (let point = 0; point < pointCount; point += 1) {
      const note = notes[point];
      const normalized = clamp((note + 48) / 84, 0, 1);
      const x = (point + 0.5) * width / pointCount;
      const y = laneTop + laneHeight * (0.82 - normalized * 0.64);
      if (point === 0) context.moveTo(x, y);
      else {
        context.lineTo(x, previousY);
        context.lineTo(x, y);
      }
      previousY = y;
    }
    context.strokeStyle = color;
    context.globalAlpha = 0.66;
    context.lineWidth = Math.max(1, width / 900);
    context.stroke();
    context.globalAlpha = 1;

    for (let point = 0; point < pointCount; point += 1) {
      const step = Math.floor(point / subdivisions);
      const note = notes[point];
      const normalized = clamp((note + 48) / 84, 0, 1);
      const x = (point + 0.5) * width / pointCount;
      const y = laneTop + laneHeight * (0.82 - normalized * 0.64);
      const isActive = step === activeStep;
      const radius = isActive
        ? Math.max(2.2, cellWidth * 0.14)
        : Math.max(1, cellWidth * 0.065);
      context.fillStyle = color;
      context.globalAlpha = isActive ? 1 : 0.54;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  context.strokeStyle = "rgba(244, 201, 93, 0.2)";
  context.lineWidth = 1;
  for (let step = 0; step <= 32; step += 4) {
    const x = step * cellWidth;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  const drumTime = time * state.params.tempo * state.params.drumRate;
  const pulse = Math.exp(-fract(drumTime) * 8);
  const snare = Math.exp(-fract(drumTime - 0.5) * 11);
  const drumY = height * 0.935;
  context.fillStyle = "rgba(244, 201, 93, " + (0.08 + pulse * 0.55) + ")";
  context.fillRect(0, drumY, width * clamp(state.params.kickLevel / 2, 0, 1) * pulse, height * 0.016);
  context.fillStyle = "rgba(255, 101, 189, " + (0.08 + snare * 0.48) + ")";
  context.fillRect(
    width,
    drumY + height * 0.023,
    -width * clamp(state.params.snareLevel / 2, 0, 1) * snare,
    height * 0.012,
  );

  context.fillStyle = "#d8e7e7";
  context.globalAlpha = 0.72;
  context.font = Math.max(8, width / 120) + "px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.fillText(
    "STEP " + String(activeStep + 1).padStart(2, "0")
      + "  ·  " + Math.round(state.params.tempo * 60) + " BPM"
      + "  ·  " + Math.round(state.params.echoTaps) + " ECHO TAPS",
    8,
    height * 0.97,
  );
  context.globalAlpha = 1;
}

function draw() {
  if (state.disposed) return;
  const canvas = $("stage");
  const context = canvas.getContext("2d");
  const { width, height, pixelRatio } = resizeCanvas(canvas);
  const time = transportTime();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawBackground(context, width, height);
  drawTracker(context, width, height, time);
  animationFrame = requestAnimationFrame(draw);
}

function editStageFromPointer(event) {
  const canvas = $("stage");
  const rect = canvas.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const y = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  const [seedMin, seedMax] = WEBGPU_CHIPTUNE_LIMITS.patternSeed;
  const [rangeMin, rangeMax] = WEBGPU_CHIPTUNE_LIMITS.pitchRange;
  applyParams({
    ...state.params,
    patternSeed: seedMin + x * (seedMax - seedMin),
    pitchRange: rangeMax - y * (rangeMax - rangeMin),
  });
}

function stagePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  state.editingStage = true;
  $("stage").setPointerCapture?.(event.pointerId);
  editStageFromPointer(event);
}

function stagePointerMove(event) {
  if (!state.editingStage) return;
  event.preventDefault();
  editStageFromPointer(event);
}

function stagePointerEnd(event) {
  if (!state.editingStage) return;
  state.editingStage = false;
  $("stage").releasePointerCapture?.(event.pointerId);
  announce(
    "Pattern seed " + state.params.patternSeed.toFixed(3)
      + ", pitch range " + state.params.pitchRange.toFixed(2) + ".",
  );
}

function stageKeyDown(event) {
  const seedSpec = controlSpecsByKey.get("patternSeed");
  const rangeSpec = controlSpecsByKey.get("pitchRange");
  const multiplier = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    applyControlValue(seedSpec, state.params.patternSeed - 0.04 * multiplier);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    applyControlValue(seedSpec, state.params.patternSeed + 0.04 * multiplier);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    applyControlValue(rangeSpec, state.params.pitchRange + 0.02 * multiplier);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    applyControlValue(rangeSpec, state.params.pitchRange - 0.02 * multiplier);
  } else if (event.key === "Home") {
    event.preventDefault();
    applyParams({
      ...state.params,
      patternSeed: WEBGPU_CHIPTUNE_DEFAULTS.patternSeed,
      pitchRange: WEBGPU_CHIPTUNE_DEFAULTS.pitchRange,
    });
  } else {
    return;
  }
  announce(
    "Pattern seed " + state.params.patternSeed.toFixed(3)
      + ", pitch range " + state.params.pitchRange.toFixed(2) + ".",
  );
}

function pageKeyDown(event) {
  if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const interactive = event.target?.closest?.(
    "input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider']",
  );
  if (interactive) return;
  event.preventDefault();
  void toggleSynthPlay();
}

function registerWaxHostAdapter() {
  const wax = globalThis.MorphazoidWAX;
  if (!wax || typeof wax.register !== "function") return;
  try {
    wax.register({
      id: "webgpu-chiptune",
      stateVersion: 1,
      getState() {
        return {
          parameters: { ...state.params },
          activePresetId: state.presetId,
        };
      },
      applyState(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return;
        const presetId = typeof snapshot.activePresetId === "string"
          && presets.some(({ id }) => id === snapshot.activePresetId)
          ? snapshot.activePresetId
          : "custom";
        if (snapshot.parameters && typeof snapshot.parameters === "object") {
          applyParams({ ...state.params, ...snapshot.parameters }, presetId, { notify: false });
        }
      },
      subscribeState(listener) {
        waxStateListener = typeof listener === "function" ? listener : null;
        return () => {
          if (waxStateListener === listener) waxStateListener = null;
        };
      },
    });
  } catch (error) {
    console.warn("WebGPU Chiptune WAX registration failed.", error);
  }
}

renderControls();
setRuntimeState();
setSupportState();
setSynthPlayButtonState();
outputChanged();
clearError();
registerWaxHostAdapter();

$("audioButton").addEventListener("click", () => {
  void toggleAudio();
});
$("synthPlayButton").addEventListener("click", () => {
  void toggleSynthPlay();
});
$("output").addEventListener("input", outputChanged);
$("chunkDuration").addEventListener("input", runtimeChanged);
$("chunkDuration").addEventListener("change", () => {
  void restartAudio();
});
$("workgroupSize").addEventListener("change", () => {
  runtimeChanged();
  void restartAudio();
});
$("randomizePatch").addEventListener("click", randomizePatch);
$("mutatePatch").addEventListener("click", mutatePatch);
$("resetPatch").addEventListener("click", resetPatch);
$("stage").addEventListener("pointerdown", stagePointerDown);
$("stage").addEventListener("pointermove", stagePointerMove);
$("stage").addEventListener("pointerup", stagePointerEnd);
$("stage").addEventListener("pointercancel", stagePointerEnd);
$("stage").addEventListener("keydown", stageKeyDown);
document.addEventListener("keydown", pageKeyDown);

resizeObserver = "ResizeObserver" in globalThis
  ? new ResizeObserver(balanceKnobRows)
  : null;
resizeObserver?.observe($("stageWrap"));
resizeObserver?.observe($("knobControls"));
if (!resizeObserver) globalThis.addEventListener("resize", balanceKnobRows);

animationFrame = requestAnimationFrame(draw);

globalThis.addEventListener("pagehide", () => {
  state.disposed = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", balanceKnobRows);
  waxStateListener = null;
  void stopAudio({ quiet: true });
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || !state.disposed) return;
  state.disposed = false;
  resizeObserver?.observe($("stageWrap"));
  resizeObserver?.observe($("knobControls"));
  if (!resizeObserver) globalThis.addEventListener("resize", balanceKnobRows);
  setSynthPlayButtonState();
  animationFrame = requestAnimationFrame(draw);
});
