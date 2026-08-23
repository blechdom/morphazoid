import {
  WEBGPU_SYNTHS_DEFAULTS,
  WEBGPU_SYNTHS_LIMITS,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_RUNTIME_DEFAULTS,
  WEBGPU_SYNTHS_SCALES,
  WEBGPU_SYNTHS_WORKGROUP_SIZES,
  WebGpuSynthLabAudio,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
  varyWebGpuSynthSequence,
  webGpuSynthModelLabel,
  webGpuSynthSupport,
} from "./src/webgpu-synths.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

const LANE_SPECS = Object.freeze([
  Object.freeze({ id: "pitch", label: "Pitch", color: "#74f7ff", description: "scale degree" }),
  Object.freeze({ id: "energy", label: "Pulse", color: "#ffda57", description: "gate + energy" }),
  Object.freeze({ id: "timbre", label: "Timbre", color: "#ff6eaa", description: "model color" }),
  Object.freeze({ id: "morph", label: "Morph", color: "#a78bff", description: "topology + motion" }),
]);

const MODEL_DETAILS = Object.freeze([
  "harmonic filter bank",
  "recursive operators",
  "table + nonlinear fold",
  "inharmonic resonators",
  "windowed micrograins",
]);

const MODEL_COLORS = Object.freeze(["#91ff63", "#74f7ff", "#ffda57", "#ff6eaa", "#a78bff"]);

const TECHNIQUES = Object.freeze([
  Object.freeze({ id: "euclid", label: "Euclidean DNA" }),
  Object.freeze({ id: "brownian", label: "Brownian Walk" }),
  Object.freeze({ id: "cellular", label: "Rule 110" }),
  Object.freeze({ id: "recurrence", label: "Golden Recurrence" }),
  Object.freeze({ id: "orbit", label: "Orbital Phase" }),
  Object.freeze({ id: "noise", label: "Seed Noise" }),
]);

function themedParams(overrides) {
  return sanitizeWebGpuSynthParams({ ...WEBGPU_SYNTHS_DEFAULTS, ...overrides });
}

const THEMES = Object.freeze([
  Object.freeze({
    id: "acid-fossil",
    label: "Acid Fossil",
    technique: "euclid",
    variation: 0.18,
    params: themedParams({ topology: 0.08, baseNote: 32, clock: 6.2, steps: 16, complexity: 0.82, color: 0.72, decay: 0.3, fold: 0.42, space: 0.28, chaos: 0.12, swing: 0.14, seed: 17011, scale: 2 }),
  }),
  Object.freeze({
    id: "recursive-chrome",
    label: "Recursive Chrome",
    technique: "recurrence",
    variation: 0.32,
    params: themedParams({ topology: 1.14, baseNote: 30, clock: 4.8, steps: 21, glide: 0.18, complexity: 0.74, color: 0.63, motion: 0.58, decay: 0.52, fold: 0.3, space: 0.66, chaos: 0.26, seed: 24117, scale: 3 }),
  }),
  Object.freeze({
    id: "folded-mutant",
    label: "Folded Mutant",
    technique: "cellular",
    variation: 0.54,
    params: themedParams({ topology: 2.18, baseNote: 38, clock: 8.4, steps: 32, glide: 0.04, complexity: 0.68, color: 0.38, motion: 0.72, decay: 0.2, fold: 0.88, space: 0.5, chaos: 0.48, swing: 0.06, seed: 39117, scale: 5 }),
  }),
  Object.freeze({
    id: "bell-swarm",
    label: "Bell Swarm",
    technique: "orbit",
    variation: 0.2,
    params: themedParams({ topology: 3.06, baseNote: 46, clock: 2.7, steps: 20, glide: 0, complexity: 0.9, color: 0.78, motion: 0.48, decay: 1.22, fold: 0.18, space: 0.9, chaos: 0.12, swing: 0.02, gain: 0.1, seed: 8271, scale: 4 }),
  }),
  Object.freeze({
    id: "dust-engine",
    label: "Dust Engine",
    technique: "brownian",
    variation: 0.46,
    params: themedParams({ topology: 3.88, baseNote: 27, clock: 7.7, steps: 24, glide: 0.42, complexity: 0.86, color: 0.9, motion: 0.82, decay: 0.34, fold: 0.56, space: 0.94, chaos: 0.72, swing: 0.21, gain: 0.11, seed: 51733, scale: 1 }),
  }),
  Object.freeze({
    id: "interzone",
    label: "Interzone",
    technique: "noise",
    variation: 0.68,
    params: themedParams({ topology: 1.72, baseNote: 24, clock: 11.3, steps: 48, glide: 0.28, complexity: 0.96, color: 0.54, motion: 0.93, decay: 0.14, fold: 0.74, space: 0.78, chaos: 0.94, swing: 0.31, gain: 0.085, seed: 64439, scale: 5 }),
  }),
]);

const CONTROL_GROUPS = Object.freeze({
  organism: Object.freeze([
    { key: "topology", label: "Model topology", step: 0.01 },
    { key: "complexity", label: "Complexity", step: 0.01 },
    { key: "color", label: "Color", step: 0.01 },
    { key: "fold", label: "Nonlinearity", step: 0.01 },
  ]),
  time: Object.freeze([
    { key: "clock", label: "Shader clock", step: 0.01 },
    { key: "steps", label: "Cycle length", step: 1 },
    { key: "swing", label: "Swing", step: 0.01 },
    { key: "glide", label: "Pitch memory", step: 0.01 },
    { key: "decay", label: "Event decay", step: 0.01 },
  ]),
  field: Object.freeze([
    { key: "baseNote", label: "Root note", step: 1 },
    { key: "scale", label: "Scale", type: "select", options: WEBGPU_SYNTHS_SCALES },
    { key: "motion", label: "Motion", step: 0.01 },
    { key: "space", label: "Stereo field", step: 0.01 },
    { key: "chaos", label: "Topology chaos", step: 0.01 },
    { key: "gain", label: "Shader gain", step: 0.001 },
    { key: "seed", label: "Shader seed", step: 1 },
  ]),
});

const CONTROL_SPECS = Object.freeze(Object.values(CONTROL_GROUPS).flat());
const CONTROL_BY_KEY = new Map(CONTROL_SPECS.map((spec) => [spec.key, spec]));
const KNOB_ORDER = Object.freeze(["topology", "complexity", "color", "fold", "motion", "chaos"]);
const KNOB_LABELS = Object.freeze({
  topology: "Organism",
  complexity: "Organs",
  color: "Pigment",
  fold: "Mutation",
  motion: "Orbit",
  chaos: "Instability",
});

const support = webGpuSynthSupport(globalThis);
const firstTheme = THEMES[0];
const state = {
  params: firstTheme.params,
  sequence: createWebGpuSynthSequence(firstTheme.technique, {
    steps: firstTheme.params.steps,
    seed: firstTheme.params.seed,
    variation: firstTheme.variation,
  }),
  themeId: firstTheme.id,
  techniqueId: firstTheme.technique,
  activeLane: 0,
  audioOn: false,
  synthPlaying: false,
  visualHoldTime: 0,
  chunkDuration: WEBGPU_SYNTHS_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize,
  editing: false,
};

const controlInputs = new Map();
const controlOutputs = new Map();
const knobControls = new Map();
const knobOutputs = new Map();
let engine = null;
let audioStartPromise = null;
let audioGeneration = 0;
let animationFrame = 0;
let activeKnobDrag = null;

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function formatParam(key, value) {
  if (key === "topology") return webGpuSynthModelLabel(value);
  if (key === "baseNote") return `MIDI ${Math.round(value)}`;
  if (key === "clock") return `${value.toFixed(2)} Hz`;
  if (key === "steps") return `${Math.round(value)} steps`;
  if (key === "decay") return `${Math.round(value * 1000)} ms`;
  if (key === "swing") return `${Math.round(value * 100)}%`;
  if (key === "gain") return `${Math.round(value * 100)}%`;
  if (key === "seed") return `${Math.round(value)}`;
  if (key === "scale") return WEBGPU_SYNTHS_SCALES[Math.round(value)];
  return `${Math.round(value * 100)}%`;
}

function syncReadouts() {
  for (const [key, input] of controlInputs) input.value = String(state.params[key]);
  for (const [key, output] of controlOutputs) output.textContent = formatParam(key, state.params[key]);
  for (const key of KNOB_ORDER) {
    const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
    const value = state.params[key];
    const normalized = (value - minimum) / (maximum - minimum);
    const dial = knobControls.get(key);
    dial?.style.setProperty("--knob-fill", `${normalized * 75}%`);
    dial?.style.setProperty("--knob-angle", `${-135 + normalized * 270}deg`);
    dial?.setAttribute("aria-valuenow", value.toFixed(3));
    dial?.setAttribute("aria-valuetext", formatParam(key, value));
    const output = knobOutputs.get(key);
    if (output) output.textContent = formatParam(key, value);
  }
  $("organismState").textContent = webGpuSynthModelLabel(state.params.topology);
  $("timeState").textContent = `${state.params.steps} steps · ${state.params.clock.toFixed(2)} Hz`;
  $("fieldState").textContent = `${WEBGPU_SYNTHS_SCALES[state.params.scale]} · MIDI ${state.params.baseNote}`;
  for (const node of $("modelRail").querySelectorAll("button")) {
    node.setAttribute("aria-pressed", String(Math.abs(Number(node.dataset.model) - state.params.topology) < 0.08));
  }
}

function applyParams(params, { preserveTheme = false } = {}) {
  state.params = sanitizeWebGpuSynthParams({ ...state.params, ...params });
  if (!preserveTheme) state.themeId = "custom";
  engine?.updateParams(state.params);
  syncReadouts();
  syncPressedStates();
}

function applySequence(sequence, { preserveTheme = false } = {}) {
  state.sequence = sanitizeWebGpuSynthSequence(sequence);
  if (!preserveTheme) state.themeId = "custom";
  engine?.updateSequence(state.sequence);
  syncPressedStates();
}

function syncPressedStates() {
  for (const button of $("themeButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === state.themeId));
  }
  for (const button of $("techniqueButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.technique === state.techniqueId));
  }
  const theme = THEMES.find(({ id }) => id === state.themeId);
  $("themeState").textContent = theme?.label ?? "Custom organism";
  const technique = TECHNIQUES.find(({ id }) => id === state.techniqueId);
  $("variationState").textContent = technique?.label ?? "Hand-drawn DNA";
}

function applyTheme(theme) {
  state.themeId = theme.id;
  state.techniqueId = theme.technique;
  state.params = sanitizeWebGpuSynthParams(theme.params);
  state.sequence = createWebGpuSynthSequence(theme.technique, {
    steps: state.params.steps,
    seed: state.params.seed,
    variation: theme.variation,
  });
  engine?.updateParams(state.params);
  engine?.updateSequence(state.sequence);
  syncReadouts();
  syncPressedStates();
  announce(`${theme.label} shader theme loaded.`);
}

function applyTechnique(technique) {
  state.techniqueId = technique.id;
  const variation = 0.3 + state.params.chaos * 0.6;
  applySequence(createWebGpuSynthSequence(technique.id, {
    steps: state.params.steps,
    seed: state.params.seed,
    variation,
  }));
  $("variationState").textContent = technique.label;
  announce(`${technique.label} generated four-lane DNA.`);
}

function changeParam(key, rawValue) {
  const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
  let value = clamp(rawValue, minimum, maximum);
  if (["steps", "baseNote", "seed", "scale"].includes(key)) value = Math.round(value);
  const previousSteps = state.params.steps;
  applyParams({ [key]: value });
  if (key === "steps" && value !== previousSteps) {
    const technique = TECHNIQUES.find(({ id }) => id === state.techniqueId) ?? TECHNIQUES[0];
    state.sequence = createWebGpuSynthSequence(technique.id, {
      steps: value,
      seed: state.params.seed,
      variation: 0.3 + state.params.chaos * 0.6,
    });
    engine?.updateSequence(state.sequence);
  }
}

function createRangeControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";
  wrapper.htmlFor = spec.key;
  const line = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = `${spec.key}Out`;
  output.htmlFor = spec.key;
  line.append(label, output);
  const input = document.createElement("input");
  const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[spec.key];
  input.id = spec.key;
  input.type = "range";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(spec.step);
  input.value = String(state.params[spec.key]);
  input.setAttribute("aria-label", spec.label);
  input.addEventListener("input", () => changeParam(spec.key, input.value));
  controlInputs.set(spec.key, input);
  controlOutputs.set(spec.key, output);
  wrapper.append(line, input);
  return wrapper;
}

function createSelectControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "select-control";
  wrapper.htmlFor = spec.key;
  const line = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = `${spec.key}Out`;
  output.htmlFor = spec.key;
  line.append(label, output);
  const shell = document.createElement("span");
  shell.className = "select-shell";
  const select = document.createElement("select");
  select.id = spec.key;
  select.setAttribute("aria-label", spec.label);
  spec.options.forEach((option, index) => {
    const element = document.createElement("option");
    element.value = String(index);
    element.textContent = option;
    select.append(element);
  });
  select.addEventListener("change", () => changeParam(spec.key, select.value));
  shell.append(select);
  controlInputs.set(spec.key, select);
  controlOutputs.set(spec.key, output);
  wrapper.append(line, shell);
  return wrapper;
}

function knobStep(spec) {
  return spec.step ?? ((WEBGPU_SYNTHS_LIMITS[spec.key][1] - WEBGPU_SYNTHS_LIMITS[spec.key][0]) / 100);
}

function createKnobControl(key, index) {
  const spec = CONTROL_BY_KEY.get(key);
  const color = MODEL_COLORS[index % MODEL_COLORS.length];
  const wrapper = document.createElement("div");
  wrapper.className = "webgpu-synth-knob";
  wrapper.style.setProperty("--knob-color", color);
  const dial = document.createElement("div");
  dial.className = "webgpu-synth-knob-dial";
  dial.style.setProperty("--knob-color", color);
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", spec.label);
  dial.setAttribute("aria-valuemin", String(WEBGPU_SYNTHS_LIMITS[key][0]));
  dial.setAttribute("aria-valuemax", String(WEBGPU_SYNTHS_LIMITS[key][1]));
  dial.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activeKnobDrag = { key, startY: event.clientY, startValue: state.params[key] };
    dial.setPointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointermove", (event) => {
    if (activeKnobDrag?.key !== key) return;
    event.preventDefault();
    const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
    changeParam(key, activeKnobDrag.startValue + ((activeKnobDrag.startY - event.clientY) / 130) * (maximum - minimum));
  });
  dial.addEventListener("pointerup", (event) => {
    if (activeKnobDrag?.key !== key) return;
    activeKnobDrag = null;
    dial.releasePointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointercancel", () => { if (activeKnobDrag?.key === key) activeKnobDrag = null; });
  dial.addEventListener("wheel", (event) => {
    event.preventDefault();
    changeParam(key, state.params[key] + Math.sign(-event.deltaY) * knobStep(spec));
  }, { passive: false });
  dial.addEventListener("keydown", (event) => {
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0;
    if (direction) {
      event.preventDefault();
      changeParam(key, state.params[key] + direction * knobStep(spec));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      changeParam(key, WEBGPU_SYNTHS_LIMITS[key][event.key === "Home" ? 0 : 1]);
    }
  });
  const label = document.createElement("span");
  label.className = "webgpu-synth-knob-label";
  label.textContent = KNOB_LABELS[key];
  const output = document.createElement("output");
  output.className = "webgpu-synth-knob-value";
  knobControls.set(key, dial);
  knobOutputs.set(key, output);
  wrapper.append(dial, label, output);
  return wrapper;
}

function renderControls() {
  for (const [group, specs] of Object.entries(CONTROL_GROUPS)) {
    $(`${group}Controls`).replaceChildren(...specs.map((spec) => (
      spec.type === "select" ? createSelectControl(spec) : createRangeControl(spec)
    )));
  }
  $("knobControls").replaceChildren(...KNOB_ORDER.map(createKnobControl));
  $("laneButtons").replaceChildren(...LANE_SPECS.map((lane, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${lane.label} · ${lane.description}`;
    button.style.setProperty("--lane-color", lane.color);
    button.setAttribute("aria-pressed", String(index === state.activeLane));
    button.addEventListener("click", () => {
      state.activeLane = index;
      for (const [buttonIndex, candidate] of [...$("laneButtons").children].entries()) {
        candidate.setAttribute("aria-pressed", String(buttonIndex === index));
      }
      announce(`${lane.label} lane selected for drawing.`);
    });
    return button;
  }));
  $("modelRail").replaceChildren(...WEBGPU_SYNTHS_MODELS.map((model, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-node";
    button.dataset.model = String(index);
    button.style.setProperty("--model-color", MODEL_COLORS[index]);
    const name = document.createElement("b");
    name.textContent = model;
    const detail = document.createElement("small");
    detail.textContent = MODEL_DETAILS[index];
    button.append(name, detail);
    button.addEventListener("click", () => {
      changeParam("topology", index);
      announce(`${model} topology selected.`);
    });
    return button;
  }));
  $("themeButtons").replaceChildren(...THEMES.map((theme) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.theme = theme.id;
    button.textContent = theme.label;
    button.addEventListener("click", () => applyTheme(theme));
    return button;
  }));
  $("techniqueButtons").replaceChildren(...TECHNIQUES.map((technique) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.technique = technique.id;
    button.textContent = technique.label;
    button.addEventListener("click", () => applyTechnique(technique));
    return button;
  }));
  syncReadouts();
  syncPressedStates();
}

function setRuntimeState() {
  $("chunkDurationOut").textContent = `${Math.round(state.chunkDuration * 1000)} ms`;
  $("workgroupSizeOut").textContent = `${state.workgroupSize} lanes`;
  $("runtimeState").textContent = `${state.workgroupSize} lanes`;
}

function setSupportState() {
  if (state.audioOn && engine) {
    $("gpuState").textContent = "WGSL streaming";
    $("streamState").textContent = `${Math.round(engine.chunkDurationInSeconds * 1000)} ms finished stereo buffers`;
  } else if (!support.audio) {
    $("gpuState").textContent = "Buffer playback unavailable";
    $("streamState").textContent = "AudioContext missing";
  } else if (!support.webgpu) {
    $("gpuState").textContent = "WebGPU unavailable";
    $("streamState").textContent = "navigator.gpu missing";
  } else {
    $("gpuState").textContent = "WebGPU ready";
    $("streamState").textContent = "WGSL owns the signal path";
  }
  $("audioButton").disabled = !support.supported || Boolean(audioStartPromise);
  $("synthPlayButton").disabled = !support.supported || Boolean(audioStartPromise);
}

function paintAudioReadout() {
  $("engineBadge").textContent = state.audioOn
    ? state.synthPlaying ? "WGSL organism running" : "WGSL organism ready"
    : "one shader · five organisms";
  $("stageReadout").textContent = state.audioOn
    ? `WEBGPU · ${Math.round(engine?.sampleRate ?? 44100)} HZ · ${state.synthPlaying ? "GENOME PLAYING" : "GENOME PAUSED"}`
    : "WEBGPU · STANDBY · AUDIO OFF";
  $("genomeStage").setAttribute("aria-label", `Four-lane WebGPU musical genome editor. Audio ${state.audioOn ? "on" : "off"}.`);
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  if (enabled && engine) {
    $("gpuState").textContent = "WGSL streaming";
    $("streamState").textContent = `${Math.round(engine.chunkDurationInSeconds * 1000)} ms finished stereo buffers`;
  } else setSupportState();
  paintAudioReadout();
  setSynthPlayState(state.synthPlaying, { quiet: true });
}

function setSynthPlayState(enabled, { quiet = false } = {}) {
  state.synthPlaying = Boolean(enabled && state.audioOn);
  engine?.setPlaybackEnabled(state.synthPlaying);
  $("synthPlayButton").setAttribute("aria-pressed", String(state.synthPlaying));
  $("synthPlayButton").textContent = state.synthPlaying ? "Pause genome" : "Play genome";
  paintAudioReadout();
  if (!quiet) announce(state.synthPlaying ? "WGSL genome playing." : "WGSL genome paused.");
}

async function startAudio() {
  if (state.audioOn && engine?.context) return true;
  if (audioStartPromise) return audioStartPromise;
  clearError();
  const generation = audioGeneration;
  const nextEngine = new WebGpuSynthLabAudio(globalThis, {
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
  });
  nextEngine.sequence = state.sequence;
  nextEngine.setOutput(Number($("output").value));
  nextEngine.setPlaybackEnabled(state.synthPlaying);
  nextEngine.setErrorHandler((error) => {
    showError(error);
    setSynthPlayState(false, { quiet: true });
    setAudioState(false);
    setTimeout(() => { if (engine === nextEngine) void stopAudio({ quiet: true }); }, 0);
  });
  engine = nextEngine;
  let pending;
  pending = nextEngine.start(state.params).then((context) => {
    if (generation !== audioGeneration || engine !== nextEngine || context !== nextEngine.context) {
      void nextEngine.stop();
      return false;
    }
    nextEngine.updateSequence(state.sequence);
    nextEngine.setOutput(Number($("output").value));
    nextEngine.setPlaybackEnabled(state.synthPlaying);
    setAudioState(true);
    announce("WebGPU shader initialized; finished stereo buffer stream ready.");
    return true;
  }).catch((error) => {
    if (engine === nextEngine) engine = null;
    setAudioState(false);
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
    setSupportState();
  });
  audioStartPromise = pending;
  setSupportState();
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  audioGeneration += 1;
  if (state.synthPlaying) setSynthPlayState(false, { quiet: true });
  const previous = engine;
  engine = null;
  audioStartPromise = null;
  if (previous) await previous.stop();
  setAudioState(false);
  if (!quiet) announce("WebGPU Synths audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

function toggleSynthPlay() {
  if (!state.audioOn) {
    announce("Turn Audio on before playing the WGSL genome.");
    return;
  }
  setSynthPlayState(!state.synthPlaying);
}

async function restartAudio() {
  if (!state.audioOn) return;
  const wasPlaying = state.synthPlaying;
  await stopAudio({ quiet: true });
  state.synthPlaying = wasPlaying;
  await startAudio();
  setSynthPlayState(wasPlaying, { quiet: true });
}

function outputChanged() {
  const value = clamp($("output").value, 0, 1);
  $("outputOut").textContent = `${Math.round(value * 100)}%`;
  engine?.setOutput(value);
}

function runtimeChanged() {
  state.chunkDuration = clamp($("chunkDuration").value, 0.03, 0.25);
  state.workgroupSize = WEBGPU_SYNTHS_WORKGROUP_SIZES.includes(Number($("workgroupSize").value))
    ? Number($("workgroupSize").value)
    : WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize;
  setRuntimeState();
}

function varyLane(lane) {
  const amount = 0.08 + state.params.chaos * 0.28;
  applySequence(varyWebGpuSynthSequence(state.sequence, lane, amount, state.params.seed + performance.now()));
  announce(`${lane === "all" ? "All genome lanes" : `${lane} lane`} varied.`);
}

function rotateSequence(direction) {
  const steps = state.params.steps;
  const active = state.sequence.slice(0, steps);
  const amount = ((direction % steps) + steps) % steps;
  const rotated = [...active.slice(steps - amount), ...active.slice(0, steps - amount)];
  applySequence([...rotated, ...state.sequence.slice(steps)]);
  announce(`Genome rotated ${direction > 0 ? "right" : "left"}.`);
}

function reverseSequence() {
  const steps = state.params.steps;
  applySequence([...state.sequence.slice(0, steps).reverse(), ...state.sequence.slice(steps)]);
  announce("Genome direction reversed.");
}

function invertActiveLane() {
  const steps = state.params.steps;
  const next = state.sequence.map((step, index) => (
    index < steps ? step.map((value, lane) => lane === state.activeLane ? 1 - value : value) : step
  ));
  applySequence(next);
  announce(`${LANE_SPECS[state.activeLane].label} lane inverted.`);
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

function laneMetrics(width, height) {
  const top = height * 0.34;
  const bottom = height * 0.92;
  const gap = Math.max(6, height * 0.012);
  const heightEach = (bottom - top - gap * 3) / 4;
  return { top, bottom, gap, heightEach, width };
}

function visualTime() {
  if (!state.synthPlaying) return state.visualHoldTime;
  const playback = engine?.currentPlaybackTime?.();
  if (playback !== null && playback !== undefined) {
    state.visualHoldTime = playback;
    return playback;
  }
  return state.visualHoldTime;
}

function drawOrganism(context, width, height, time) {
  const centerX = width * 0.73;
  const centerY = height * 0.18;
  const topology = state.params.topology;
  const lower = Math.floor(topology);
  const color = MODEL_COLORS[lower];
  context.save();
  context.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 7; ring += 1) {
    const points = 36;
    const radius = height * (0.025 + ring * 0.013) * (0.8 + state.params.complexity * 0.5);
    context.beginPath();
    for (let point = 0; point <= points; point += 1) {
      const angle = (point / points) * Math.PI * 2;
      const mutation = Math.sin(angle * (2 + lower) + time * (0.2 + state.params.motion) + ring) * radius * (0.08 + state.params.chaos * 0.28);
      const x = centerX + Math.cos(angle) * (radius + mutation) * (1 + state.params.space * 0.5);
      const y = centerY + Math.sin(angle) * (radius + mutation);
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = `${color}${Math.round((0.1 + ring * 0.035) * 255).toString(16).padStart(2, "0")}`;
    context.lineWidth = 1 + (ring === Math.round(topology) ? 1 : 0);
    context.stroke();
  }
  context.restore();
}

function drawLanes(context, width, height, time) {
  const { top, gap, heightEach } = laneMetrics(width, height);
  const steps = state.params.steps;
  const cellWidth = width / steps;
  const activeStep = Math.floor(time * state.params.clock) % steps;
  for (const [laneIndex, lane] of LANE_SPECS.entries()) {
    const y = top + laneIndex * (heightEach + gap);
    context.fillStyle = laneIndex === state.activeLane ? `${lane.color}12` : "rgba(255,255,255,0.018)";
    context.fillRect(0, y, width, heightEach);
    context.strokeStyle = laneIndex === state.activeLane ? `${lane.color}52` : "rgba(255,255,255,0.08)";
    context.strokeRect(0.5, y + 0.5, width - 1, heightEach - 1);
    context.fillStyle = `${lane.color}b8`;
    context.font = `${Math.max(8, height * 0.018)}px ui-monospace, monospace`;
    context.fillText(lane.label.toUpperCase(), 9, y + 14);
    context.beginPath();
    for (let step = 0; step < steps; step += 1) {
      const value = state.sequence[step][laneIndex];
      const x = (step + 0.5) * cellWidth;
      const valueY = y + heightEach - value * (heightEach - 8) - 4;
      if (laneIndex === 1) {
        const barWidth = Math.max(1, cellWidth - 3);
        context.fillStyle = value <= 0.01 ? "rgba(255,255,255,0.035)" : `${lane.color}${step === activeStep ? "f2" : "72"}`;
        context.fillRect(step * cellWidth + 1.5, valueY, barWidth, y + heightEach - 4 - valueY);
      } else {
        if (step === 0) context.moveTo(x, valueY);
        else context.lineTo(x, valueY);
      }
      if (step === activeStep) {
        context.fillStyle = lane.color;
        context.beginPath();
        context.arc(x, valueY, 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (laneIndex !== 1) {
      context.strokeStyle = `${lane.color}${laneIndex === state.activeLane ? "d8" : "78"}`;
      context.lineWidth = laneIndex === state.activeLane ? 2 : 1;
      context.stroke();
    }
  }
  const playheadX = (activeStep + 0.5) * cellWidth;
  context.save();
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.shadowBlur = 18;
  context.shadowColor = MODEL_COLORS[Math.round(state.params.topology)];
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(playheadX, top - 5);
  context.lineTo(playheadX, height * 0.94);
  context.stroke();
  context.restore();
}

function draw() {
  const canvas = $("genomeStage");
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = resizeCanvas(canvas);
  const time = visualTime();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06070a";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(116,247,255,0.055)";
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 32) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = 0; y < height; y += 32) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  drawOrganism(context, width, height, time);
  drawLanes(context, width, height, time);
  animationFrame = requestAnimationFrame(draw);
}

function editGenome(event) {
  const canvas = $("genomeStage");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const metrics = laneMetrics(rect.width, rect.height);
  const laneY = metrics.top + state.activeLane * (metrics.heightEach + metrics.gap);
  const localY = event.clientY - rect.top;
  const value = clamp(1 - ((localY - laneY) / metrics.heightEach), 0, 1);
  const step = Math.min(state.params.steps - 1, Math.floor(clamp((event.clientX - rect.left) / rect.width, 0, 0.9999) * state.params.steps));
  const next = state.sequence.map((genes) => [...genes]);
  next[step][state.activeLane] = event.shiftKey ? 0 : value;
  state.techniqueId = "custom";
  applySequence(next);
}

function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const rect = $("genomeStage").getBoundingClientRect();
  if ((event.clientY - rect.top) < rect.height * 0.31) return;
  event.preventDefault();
  state.editing = true;
  $("genomeStage").setPointerCapture?.(event.pointerId);
  editGenome(event);
}

function handlePointerMove(event) {
  if (!state.editing) return;
  event.preventDefault();
  editGenome(event);
}

function handlePointerEnd(event) {
  if (!state.editing) return;
  state.editing = false;
  $("genomeStage").releasePointerCapture?.(event.pointerId);
  announce(`${LANE_SPECS[state.activeLane].label} genome edited.`);
}

renderControls();
setRuntimeState();
setSupportState();
outputChanged();

$("audioButton").addEventListener("click", () => { void toggleAudio(); });
$("synthPlayButton").addEventListener("click", toggleSynthPlay);
$("output").addEventListener("input", outputChanged);
$("chunkDuration").addEventListener("input", runtimeChanged);
$("chunkDuration").addEventListener("change", () => { void restartAudio(); });
$("workgroupSize").addEventListener("change", () => { runtimeChanged(); void restartAudio(); });
$("resetPatch").addEventListener("click", () => applyTheme(THEMES[0]));
$("rotateLeft").addEventListener("click", () => rotateSequence(-1));
$("rotateRight").addEventListener("click", () => rotateSequence(1));
$("reverseSequence").addEventListener("click", reverseSequence);
$("invertLane").addEventListener("click", invertActiveLane);
for (const button of document.querySelectorAll("[data-vary]")) {
  button.addEventListener("click", () => varyLane(button.dataset.vary));
}
$("genomeStage").addEventListener("pointerdown", handlePointerDown);
$("genomeStage").addEventListener("pointermove", handlePointerMove);
$("genomeStage").addEventListener("pointerup", handlePointerEnd);
$("genomeStage").addEventListener("pointercancel", handlePointerEnd);
animationFrame = requestAnimationFrame(draw);

globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  void stopAudio({ quiet: true });
});
