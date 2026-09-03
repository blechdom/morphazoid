import {
  DIGESTAZOID_DEFAULTS,
  DIGESTAZOID_GESTURES,
  DIGESTAZOID_LIMITS,
  DIGESTAZOID_PRESETS,
  digestazoidPreset,
  digestazoidState,
  sanitizeDigestazoidState,
} from "./src/digestazoid.js?v=digestazoid-model-20260902-3";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: true, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const clamp = (value, minimum = 0, maximum = 1) => Math.min(
  maximum,
  Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum),
);
const mix = (a, b, amount) => a + (b - a) * clamp(amount);
const smoothstep = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const percent = (value) => `${Math.round(clamp(value) * 100)}%`;
const loadPercent = (value) => `${Math.round(Math.max(0, finite(value)) * 100)}%`;
const signedPercent = (value) => `${value < 0 ? "−" : "+"}${Math.round(Math.abs(value) * 100)}%`;

const CONTROL_SPECS = Object.freeze([
  { id: "level", key: "level", format: percent },
  { id: "gas", key: "gas", format: loadPercent },
  { id: "liquid", key: "liquid", format: loadPercent },
  { id: "sludge", key: "sludge", format: loadPercent },
  { id: "viscosity", key: "viscosity", format: percent },
  { id: "bubbleSize", key: "bubbleSizeMm", format: (value) => `${value.toFixed(1)} mm` },
  { id: "peristalsisRate", key: "peristalsisRate", format: (value) => `${Math.round(value)}/min` },
  { id: "peristalsisDepth", key: "peristalsisDepth", format: percent },
  { id: "stomachCompliance", key: "stomachCompliance", format: (value) => `${value.toFixed(2)}×` },
  { id: "gutTension", key: "gutTension", format: percent },
  { id: "bodyPulse", key: "bodyPulse", format: (value) => `61 BPM · ${percent(value)}` },
  { id: "upperValve", key: "upperValve", format: percent },
  { id: "pyloricValve", key: "pyloricValve", format: percent },
  { id: "lowerValve", key: "lowerValve", format: percent },
  { id: "outletStretch", key: "outletStretch", format: percent },
  { id: "turbulence", key: "turbulence", format: percent },
  { id: "wetness", key: "wetness", format: percent },
  { id: "bodyResonance", key: "bodyResonance", format: percent },
]);

const TARGET_LABELS = Object.freeze({
  stomach: "compliant stomach wall",
  gasPocket: "floating stomach gas",
  upperValve: "upper esophageal valve",
  pyloricValve: "pyloric gate",
  smallIntestine: "small-intestine coil",
  ileocecalValve: "ileocecal valve",
  colon: "large-intestine wall",
  lowerValve: "lower rubber valve",
  outlet: "stretchable lower outlet",
  body: "abdominal wall",
});

const TARGET_ACTIONS = Object.freeze({
  upperValve: "pinch",
  pyloricValve: "pinch",
  ileocecalValve: "pinch",
  lowerValve: "pinch",
  outlet: "stretch",
  gasPocket: "drag",
  stomach: "squeeze",
  smallIntestine: "knead",
  colon: "knead",
  body: "poke",
});

let state = digestazoidState();
let telemetry = {
  pressures: { stomach: 0.18, intestine: 0.12, colon: 0.16 },
  fills: { gas: state.gas, liquid: state.liquid, sludge: state.sludge },
  valves: { upper: 0, pyloric: 0, ileocecal: 0, lower: 0 },
  peristalsisPhase: 0,
  wallMotion: 0,
  bubbleActivity: 0,
  bubbleVoiceCount: 0,
  upperFlow: 0,
  lowerFlow: 0,
  peak: 0,
  rms: 0,
  event: "",
};
let audioContext = null;
let graph = null;
let audioStartPromise = null;
let audioStopPromise = null;
let audioGeneration = 0;
let audioDesiredOn = false;
let animationFrame = 0;
let previousFrameAt = performance.now();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let pointerDrag = null;
let activeGestureId = "";
let gestureFlash = 0;
let eventFlash = 0;
let visualPhase = 0;
let bubbleSeed = 0x51a7f00d;
let manualGasTimer = 0;
let pageIsActive = true;

function randomUnit() {
  bubbleSeed = (Math.imul(bubbleSeed, 1664525) + 1013904223) >>> 0;
  return bubbleSeed / 0x100000000;
}

const visualBubbles = Array.from({ length: 26 }, (_, index) => ({
  phase: (index / 26 + randomUnit() * 0.2) % 1,
  lane: index % 5,
  size: 0.45 + randomUnit() * 0.85,
  wobble: randomUnit() * Math.PI * 2,
  deform: 0.6 + randomUnit() * 1.8,
  scars: 2 + Math.floor(randomUnit() * 4),
  drift: randomUnit() * 2 - 1,
}));

function announce(message) {
  const node = $("liveStatus");
  node.textContent = "";
  requestAnimationFrame(() => { node.textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = finite(input.min, 0);
  const maximum = finite(input.max, 1);
  const amount = clamp((finite(input.value, minimum) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  const transitioning = status === "starting" || status === "stopping";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").disabled = transitioning;
  $("audioState").textContent = transitioning ? status : on ? "on" : status === "error" ? "error" : "off";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function pressureValue(name, fallback) {
  return clamp(
    telemetry?.pressures?.[name]
      ?? telemetry?.[`${name}Pressure`]
      ?? fallback,
    0,
    2,
  );
}

function liveFill(name) {
  return clamp(telemetry?.fills?.[name] ?? telemetry?.[name] ?? state[name]);
}

function updateLiveReadouts() {
  const pressureMap = [
    ["stomach", "stomachPressureBar", "stomachPressureOut", 0.18],
    ["intestine", "intestinalPressureBar", "intestinalPressureOut", 0.12],
    ["colon", "colonPressureBar", "colonPressureOut", 0.16],
  ];
  for (const [name, barId, outputId, fallback] of pressureMap) {
    const pressure = pressureValue(name, fallback);
    $(barId).parentElement.style.setProperty("--pressure", `${Math.min(100, pressure * 62).toFixed(1)}%`);
    $(outputId).textContent = pressure.toFixed(2);
  }

  for (const name of ["gas", "liquid", "sludge"]) {
    const amount = liveFill(name);
    $(`${name}FillBar`).parentElement.style.setProperty("--amount", `${(amount * 100).toFixed(1)}%`);
    $(`${name}FillOut`).textContent = percent(amount);
  }

  const event = telemetry?.eventLabel || telemetry?.event || activeGestureId;
  const activeBubbles = Math.max(0, Math.round(finite(telemetry?.bubbleVoiceCount, 0)));
  if (event) $("eventOut").textContent = String(event).replaceAll("-", " ");
  else if (activeBubbles > 0) $("eventOut").textContent = `${activeBubbles} gas pockets`;
  else $("eventOut").textContent = state.performing ? "seething" : "listening";
}

function updateUI() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.id);
    const output = $(`${spec.id}Out`);
    if (!input) continue;
    input.value = String(state[spec.key]);
    updateRangeFill(input);
    if (output) output.textContent = spec.format(state[spec.key]);
  }
  $("listeningMode").value = state.listeningMode;
  $("presetSelect").value = state.presetId;
  const preset = digestazoidPreset(state.presetId);
  $("presetDescription").textContent = preset?.description
    ?? "A pressurized wet body with gas, bile-like liquid, yielding sludge, sticky valves, and compliant tissue.";
  $("contentsSummary").textContent = `${loadPercent(state.gas)} gas · ${state.viscosity > 0.66 ? "thick" : state.viscosity < 0.34 ? "thin" : "wet"}`;
  $("motionSummary").textContent = `${Math.round(state.peristalsisRate)}/min · ${percent(state.peristalsisDepth)} squeeze`;
  $("valvesSummary").textContent = `burp ${percent(state.upperValve)} · fart ${percent(state.lowerValve)}`;
  $("listeningSummary").textContent = `${state.listeningMode} · ${percent(state.wetness)} wet`;
  $("digestButton").setAttribute("aria-pressed", String(Boolean(state.performing)));
  $("digestState").textContent = state.performing ? "continuous motion on" : "continuous motion off";
  document.body.classList.toggle("is-performing", Boolean(state.performing));
  updateLiveReadouts();
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", state });
  updateMasterLevel();
}

function setState(patch, { configure = true } = {}) {
  state = sanitizeDigestazoidState({ ...state, ...patch }, state);
  updateUI();
  if (configure) postConfiguration();
  return state;
}

function updateMasterLevel() {
  if (!graph?.masterGain || !audioContext) return;
  graph.masterGain.gain.setTargetAtTime(clamp(state.level, 0, 0.8), audioContext.currentTime, 0.025);
}

function initializePresets() {
  const select = $("presetSelect");
  select.replaceChildren();
  for (const preset of DIGESTAZOID_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    select.append(option);
  }
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL(
    "./src/digestazoid-processor.js?v=digestazoid-worklet-20260902-3",
    import.meta.url,
  ));
  const sourceNode = new AudioWorkletNode(context, "digestazoid-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { state, seed: 0xd165e57 },
  });
  const compressor = context.createDynamicsCompressor();
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 7;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.18;
  masterGain.gain.value = state.level;
  analyser.fftSize = 1_024;
  analyser.smoothingTimeConstant = 0.68;
  sourceNode.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = (event) => {
    const message = event.data;
    if (message?.type === "telemetry") {
      telemetry = { ...telemetry, ...message };
      if (message.event || message.eventLabel) eventFlash = 1;
      else if (finite(message.bubbleVoiceCount) > 0) eventFlash = Math.max(eventFlash, 0.32);
    }
  };
  sourceNode.onprocessorerror = () => {
    audioDesiredOn = false;
    setAudioPresentation("error", "The Digestazoid physical model stopped. Reload the page to rebuild its pressure network.");
  };
  return { context, sourceNode, compressor, masterGain, analyser, releaseOutput };
}

async function ensureAudio() {
  audioDesiredOn = true;
  const generation = ++audioGeneration;
  if (audioStartPromise) {
    await audioStartPromise;
    if (!audioDesiredOn) return false;
    if (!graph) return ensureAudio();
    if (audioStopPromise) await audioStopPromise;
    if (!audioDesiredOn) return false;
    if (audioContext.state !== "running") await audioContext.resume();
    postConfiguration();
    setAudioPresentation("on");
    return true;
  }
  setAudioPresentation("starting");
  audioStartPromise = (async () => {
    try {
      if (audioStopPromise) await audioStopPromise;
      if (generation !== audioGeneration || !audioDesiredOn) return false;
      if (!graph) {
        graph = await createAudioGraph();
        audioContext = graph.context;
      }
      if (audioContext.state !== "running") await audioContext.resume();
      if (generation !== audioGeneration || !audioDesiredOn) {
        try { await audioContext.suspend(); } catch { /* superseded startup */ }
        return false;
      }
      postConfiguration();
      setAudioPresentation("on");
      return true;
    } catch (error) {
      console.error(error);
      audioDesiredOn = false;
      setAudioPresentation("error", error?.message || "Unable to start Digestazoid audio.");
      return false;
    } finally {
      audioStartPromise = null;
    }
  })();
  return audioStartPromise;
}

async function stopAudio() {
  audioDesiredOn = false;
  const generation = ++audioGeneration;
  releasePointerInteraction();
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  setAudioPresentation("stopping");
  const stopping = (async () => {
    if (audioContext?.state === "running") {
      try { await audioContext.suspend(); } catch { /* context teardown is best-effort */ }
    }
  })();
  audioStopPromise = stopping;
  try {
    await stopping;
  } finally {
    if (audioStopPromise === stopping) audioStopPromise = null;
  }
  if (generation !== audioGeneration || audioDesiredOn) return;
  setAudioPresentation("off");
}

function triggerGesture(id, force = 0.8, target = "") {
  const gesture = DIGESTAZOID_GESTURES.find((candidate) => candidate.id === id);
  if (!gesture) return;
  ensureAudio().then((ready) => {
    if (!ready) return;
    graph.sourceNode.port.postMessage({
      type: "gesture",
      id,
      force: clamp(force, 0.05, 1),
      target,
    });
  });
  activeGestureId = id;
  gestureFlash = 1;
  eventFlash = 1;
  $("eventOut").textContent = gesture.label.toLowerCase();
  document.querySelectorAll("[data-gesture]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.gesture === id);
  });
  setTimeout(() => {
    if (activeGestureId !== id) return;
    activeGestureId = "";
    document.querySelectorAll("[data-gesture]").forEach((button) => button.classList.remove("is-active"));
  }, Math.max(180, finite(gesture.durationMs, 700)));
  announce(`${gesture.label}. ${gesture.description ?? "Pressure gesture entered the digestive network."}`);
}

function postInteraction(action, target, values = {}) {
  graph?.sourceNode?.port.postMessage({
    type: "interaction",
    action,
    target,
    x: clamp(values.x),
    y: clamp(values.y),
    dx: clamp(values.dx, -1, 1),
    dy: clamp(values.dy, -1, 1),
    force: clamp(values.force),
  });
}

function togglePerforming() {
  const performing = !state.performing;
  setState({ performing });
  ensureAudio().then((ready) => {
    if (ready) graph.sourceNode.port.postMessage({ type: "set-performing", performing });
  });
  announce(performing ? "Continuous digestion started." : "Continuous digestion stopped; stored pressure will decay naturally.");
}

function applyPreset(id) {
  const retainedLevel = state.level;
  const retainedPerforming = state.performing;
  state = digestazoidState(id, { level: retainedLevel, performing: retainedPerforming });
  updateUI();
  postConfiguration();
  graph?.sourceNode?.port.postMessage({ type: "reset", state });
  announce(`${digestazoidPreset(id)?.label ?? "Digestive"} body loaded.`);
}

function randomizeBody() {
  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  setState({
    gas: randomBetween(0.12, 0.92),
    liquid: randomBetween(0.08, 0.86),
    sludge: randomBetween(0.04, 0.82),
    viscosity: randomBetween(0.12, 0.94),
    bubbleSizeMm: randomBetween(3, 18),
    peristalsisRate: randomBetween(6, 62),
    peristalsisDepth: randomBetween(0.22, 0.94),
    stomachCompliance: randomBetween(0.2, 0.92),
    gutTension: randomBetween(0.16, 0.9),
    upperValve: randomBetween(0.22, 0.86),
    pyloricValve: randomBetween(0.16, 0.88),
    lowerValve: randomBetween(0.18, 0.88),
    outletStretch: randomBetween(0.08, 0.9),
    turbulence: randomBetween(0.18, 0.86),
    wetness: randomBetween(0.18, 0.96),
    bodyResonance: randomBetween(0.18, 0.88),
  });
  graph?.sourceNode?.port.postMessage({ type: "reset", state });
  triggerGesture(["growl", "burble", "bubble", "slosh", "burple"][Math.floor(Math.random() * 5)], 0.68);
  announce("The meal was contaminated again inside bounded physical limits.");
}

function resetInstrument() {
  const level = state.level;
  state = digestazoidState(DIGESTAZOID_DEFAULTS.presetId, { level, performing: false });
  updateUI();
  graph?.sourceNode?.port.postMessage({ type: "reset", state });
  $("contactOut").textContent = "belly at rest";
  $("eventOut").textContent = "listening";
  announce("Digestazoid purged and reset.");
}

function beginGasChange(direction, button) {
  endGasChange();
  const adjust = () => {
    const previous = state.gas;
    setState({
      gas: clamp(
        state.gas + direction * 0.018,
        DIGESTAZOID_LIMITS.gas[0],
        DIGESTAZOID_LIMITS.gas[1],
      ),
    });
    if (Math.abs(state.gas - previous) > 1e-6) {
      postInteraction(direction > 0 ? "inflate" : "deflate", "gasPocket", {
        force: 0.68,
        x: 0.4,
        y: 0.3,
      });
    }
  };
  button.classList.add("is-held");
  ensureAudio();
  adjust();
  manualGasTimer = globalThis.setInterval(adjust, 48);
  announce(direction > 0 ? "Inflating the stomach gas pocket." : "Deflating the stomach gas pocket.");
}

function endGasChange() {
  if (manualGasTimer) globalThis.clearInterval(manualGasTimer);
  manualGasTimer = 0;
  $("inflateButton").classList.remove("is-held");
  $("deflateButton").classList.remove("is-held");
  postInteraction("release", "gasPocket", { force: 0 });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  const requestedRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const pixelBudgetRatio = Math.sqrt(2_600_000 / Math.max(1, cssWidth * cssHeight));
  pixelRatio = Math.max(1, Math.min(requestedRatio, pixelBudgetRatio));
  const width = Math.max(1, Math.round(cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(cssHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

function anatomyFrame() {
  const height = cssHeight * 0.88;
  const width = Math.min(cssWidth * (cssWidth < 560 ? 0.94 : 0.73), height * 0.76);
  const centerX = cssWidth * (cssWidth < 560 ? 0.47 : 0.45);
  return {
    x: centerX - width * 0.5,
    y: cssHeight * 0.075,
    width,
    height,
  };
}

function anatomyPoint(x, y, frame = anatomyFrame()) {
  return { x: frame.x + x * frame.width, y: frame.y + y * frame.height };
}

function stageToAnatomy(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  const frame = anatomyFrame();
  return {
    x: clamp(((clientX - bounds.left) - frame.x) / frame.width),
    y: clamp(((clientY - bounds.top) - frame.y) / frame.height),
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const VALVE_POINTS = Object.freeze({
  upperValve: Object.freeze({ x: 0.445, y: 0.235 }),
  pyloricValve: Object.freeze({ x: 0.515, y: 0.425 }),
  ileocecalValve: Object.freeze({ x: 0.685, y: 0.69 }),
  lowerValve: Object.freeze({ x: 0.515, y: 0.875 }),
});

function targetAtPoint(point) {
  const outletStretch = pointerDrag?.target === "outlet" ? pointerDrag.distance * 0.6 : 0;
  if (distance(point, { x: 0.515, y: 0.94 + outletStretch }) < 0.09) return "outlet";
  for (const [id, position] of Object.entries(VALVE_POINTS)) {
    if (distance(point, position) < 0.06) return id;
  }
  const stomachMetric = ((point.x - 0.39) / 0.19) ** 2 + ((point.y - 0.34) / 0.16) ** 2;
  if (stomachMetric < 0.42) return "gasPocket";
  if (stomachMetric < 1.2) return "stomach";
  if (point.x > 0.31 && point.x < 0.67 && point.y > 0.43 && point.y < 0.73) return "smallIntestine";
  const colonEdge = point.x < 0.32 || point.x > 0.66 || point.y < 0.43 || point.y > 0.72;
  if (point.x > 0.2 && point.x < 0.76 && point.y > 0.29 && point.y < 0.86 && colonEdge) return "colon";
  return "body";
}

function traceTorso(context, frame, wallMotion = 0) {
  const p = (x, y) => anatomyPoint(x, y, frame);
  const shoulderL = p(0.12 - wallMotion * 0.012, 0.1);
  const shoulderR = p(0.88 + wallMotion * 0.012, 0.1);
  const hipR = p(0.78 + wallMotion * 0.018, 0.92);
  const hipL = p(0.22 - wallMotion * 0.018, 0.92);
  context.beginPath();
  context.moveTo(p(0.42, 0.02).x, p(0.42, 0.02).y);
  context.bezierCurveTo(p(0.34, 0.04).x, p(0.34, 0.04).y, shoulderL.x, shoulderL.y, p(0.09, 0.24).x, p(0.09, 0.24).y);
  context.bezierCurveTo(p(0.05, 0.48).x, p(0.05, 0.48).y, hipL.x, hipL.y, p(0.39, 0.98).x, p(0.39, 0.98).y);
  context.bezierCurveTo(p(0.45, 1.01).x, p(0.45, 1.01).y, p(0.55, 1.01).x, p(0.55, 1.01).y, p(0.61, 0.98).x, p(0.61, 0.98).y);
  context.bezierCurveTo(hipR.x, hipR.y, p(0.95, 0.48).x, p(0.95, 0.48).y, p(0.91, 0.24).x, p(0.91, 0.24).y);
  context.bezierCurveTo(shoulderR.x, shoulderR.y, p(0.66, 0.04).x, p(0.66, 0.04).y, p(0.58, 0.02).x, p(0.58, 0.02).y);
  context.closePath();
}

function stomachPath(frame, pressure = 0, push = 0) {
  const p = (x, y) => anatomyPoint(x, y, frame);
  const swell = clamp(pressure * 0.025 + push * 0.035, 0, 0.065);
  const path = new Path2D();
  path.moveTo(p(0.43, 0.23).x, p(0.43, 0.23).y);
  path.bezierCurveTo(
    p(0.33 - swell, 0.22).x, p(0.33 - swell, 0.22).y,
    p(0.21 - swell, 0.3).x, p(0.21 - swell, 0.3).y,
    p(0.24 - swell, 0.42).x, p(0.24 - swell, 0.42).y,
  );
  path.bezierCurveTo(
    p(0.27, 0.52 + swell).x, p(0.27, 0.52 + swell).y,
    p(0.44 + swell, 0.5 + swell).x, p(0.44 + swell, 0.5 + swell).y,
    p(0.53 + swell, 0.42).x, p(0.53 + swell, 0.42).y,
  );
  path.bezierCurveTo(
    p(0.47, 0.36).x, p(0.47, 0.36).y,
    p(0.5, 0.27).x, p(0.5, 0.27).y,
    p(0.43, 0.23).x, p(0.43, 0.23).y,
  );
  path.closePath();
  return path;
}

function traceColon(context, frame) {
  const p = (x, y) => anatomyPoint(x, y, frame);
  context.beginPath();
  context.moveTo(p(0.69, 0.7).x, p(0.69, 0.7).y);
  context.bezierCurveTo(p(0.74, 0.64).x, p(0.74, 0.64).y, p(0.74, 0.41).x, p(0.74, 0.41).y, p(0.67, 0.35).x, p(0.67, 0.35).y);
  context.bezierCurveTo(p(0.57, 0.29).x, p(0.57, 0.29).y, p(0.36, 0.29).x, p(0.36, 0.29).y, p(0.27, 0.35).x, p(0.27, 0.35).y);
  context.bezierCurveTo(p(0.21, 0.44).x, p(0.21, 0.44).y, p(0.23, 0.67).x, p(0.23, 0.67).y, p(0.3, 0.73).x, p(0.3, 0.73).y);
  context.bezierCurveTo(p(0.36, 0.79).x, p(0.36, 0.79).y, p(0.45, 0.76).x, p(0.45, 0.76).y, p(0.5, 0.81).x, p(0.5, 0.81).y);
  context.bezierCurveTo(p(0.52, 0.83).x, p(0.52, 0.83).y, p(0.515, 0.86).x, p(0.515, 0.86).y, p(0.515, 0.89).x, p(0.515, 0.89).y);
}

function traceSmallIntestine(context, frame, phase = 0, depth = 0) {
  const p = (x, y) => anatomyPoint(x, y, frame);
  const squeeze = Math.sin(phase * Math.PI * 2) * depth * 0.007;
  context.beginPath();
  context.moveTo(p(0.51, 0.43).x, p(0.51, 0.43).y);
  context.bezierCurveTo(p(0.62, 0.43).x, p(0.62, 0.43).y, p(0.65, 0.48 + squeeze).x, p(0.65, 0.48 + squeeze).y, p(0.53, 0.5).x, p(0.53, 0.5).y);
  context.bezierCurveTo(p(0.37, 0.52).x, p(0.37, 0.52).y, p(0.33, 0.49 - squeeze).x, p(0.33, 0.49 - squeeze).y, p(0.34, 0.57).x, p(0.34, 0.57).y);
  context.bezierCurveTo(p(0.36, 0.64).x, p(0.36, 0.64).y, p(0.65, 0.54).x, p(0.65, 0.54).y, p(0.63, 0.63).x, p(0.63, 0.63).y);
  context.bezierCurveTo(p(0.61, 0.71).x, p(0.61, 0.71).y, p(0.35, 0.72).x, p(0.35, 0.72).y, p(0.38, 0.64).x, p(0.38, 0.64).y);
  context.bezierCurveTo(p(0.41, 0.58).x, p(0.41, 0.58).y, p(0.56, 0.59).x, p(0.56, 0.59).y, p(0.56, 0.65).x, p(0.56, 0.65).y);
  context.bezierCurveTo(p(0.55, 0.7).x, p(0.55, 0.7).y, p(0.62, 0.71).x, p(0.62, 0.71).y, p(0.685, 0.69).x, p(0.685, 0.69).y);
}

function drawLabel(context, frame, x, y, text, side = 1, color = "#b6a46b") {
  const point = anatomyPoint(x, y, frame);
  const length = frame.width * 0.12 * side;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.globalAlpha = 0.68;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.lineTo(point.x + length, point.y);
  context.stroke();
  context.font = `800 ${Math.max(7, Math.min(10, frame.width * 0.018))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = side > 0 ? "left" : "right";
  context.textBaseline = "bottom";
  context.fillText(text.toUpperCase(), point.x + length + side * 4, point.y - 2);
  context.restore();
}

function drawValve(context, frame, id, openness, active = false) {
  const position = VALVE_POINTS[id];
  const point = anatomyPoint(position.x, position.y, frame);
  const baseRadius = Math.max(7, frame.width * 0.027);
  const pressurePulse = active ? 1 + Math.sin(performance.now() * 0.025) * 0.08 : 1;
  context.save();
  context.translate(point.x, point.y);
  context.scale(pressurePulse, pressurePulse);
  const valveColor = id === "lowerValve" ? "#86521e" : id === "ileocecalValve" ? "#80852a" : "#9d3f29";
  context.shadowBlur = active ? 15 : 3;
  context.shadowColor = valveColor;
  context.fillStyle = "#090603";
  context.strokeStyle = valveColor;
  context.lineWidth = Math.max(2, frame.width * 0.008);
  context.beginPath();
  context.ellipse(0, 0, baseRadius, baseRadius * (0.35 + clamp(openness) * 0.65), 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(207, 190, 119, .48)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(-baseRadius * 0.55, 0);
  context.quadraticCurveTo(0, -baseRadius * 0.25 * openness, baseRadius * 0.55, 0);
  context.stroke();
  context.restore();
}

function drawGasBlister(context, x, y, radius, bubble, phase, pressure) {
  const rupture = smoothstep((phase - 0.8) / 0.2);
  const squash = 1 - rupture * 0.68;
  context.save();
  context.translate(x, y);
  context.rotate(Math.sin(phase * Math.PI * 3 + bubble.wobble) * 0.2);
  context.scale(1 + Math.sin(phase * 8 + bubble.deform) * 0.1 + rupture * 0.45, squash);
  context.beginPath();
  const segments = 14;
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = segment / segments * Math.PI * 2;
    const rot = radius * (1
      + Math.sin(angle * 3 + bubble.wobble) * 0.1
      + Math.sin(angle * 5 - phase * 7 + bubble.deform) * 0.055);
    const px = Math.cos(angle) * rot;
    const py = Math.sin(angle) * rot;
    if (segment === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fillStyle = `rgba(37, 30, 10, ${0.36 + pressure * 0.09})`;
  context.strokeStyle = `rgba(174, 165, 62, ${0.46 + pressure * 0.14})`;
  context.lineWidth = Math.max(1, radius * 0.12);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(218, 199, 103, .28)";
  context.lineWidth = Math.max(0.7, radius * 0.055);
  for (let scar = 0; scar < bubble.scars; scar += 1) {
    const angle = bubble.wobble + scar * 2.37;
    context.beginPath();
    context.moveTo(Math.cos(angle) * radius * 0.18, Math.sin(angle) * radius * 0.18);
    context.lineTo(Math.cos(angle + 0.22) * radius * 0.72, Math.sin(angle + 0.22) * radius * 0.72);
    context.stroke();
  }
  context.restore();

  if (rupture > 0.12) {
    context.save();
    context.globalAlpha = rupture * (1 - rupture * 0.45);
    context.strokeStyle = "rgba(181, 155, 52, .72)";
    context.lineWidth = Math.max(1, radius * 0.11);
    context.beginPath();
    context.ellipse(x, y, radius * (0.8 + rupture * 1.5), radius * 0.18, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

function drawContents(context, frame, stomach, time, push) {
  const stomachPressure = pressureValue("stomach", 0.18);
  const gas = liveFill("gas");
  const liquid = liveFill("liquid");
  const sludge = liveFill("sludge");
  const top = anatomyPoint(0, 0.22, frame).y;
  const bottom = anatomyPoint(0, 0.52, frame).y;
  context.save();
  context.clip(stomach);
  const liquidTop = mix(bottom, top, clamp(liquid * 0.78 + sludge * 0.18));
  const wetGradient = context.createLinearGradient(0, liquidTop, 0, bottom);
  wetGradient.addColorStop(0, `rgba(129, 126, 32, ${0.4 + state.wetness * 0.28})`);
  wetGradient.addColorStop(0.42, "rgba(75, 78, 19, .78)");
  wetGradient.addColorStop(1, "rgba(27, 29, 9, .96)");
  context.fillStyle = wetGradient;
  context.fillRect(frame.x, liquidTop, frame.width, bottom - liquidTop + frame.height * 0.1);

  context.fillStyle = `rgba(73, 77, 23, ${0.34 + sludge * 0.42})`;
  const sludgeTop = mix(bottom, top + frame.height * 0.16, sludge * 0.62);
  context.beginPath();
  context.moveTo(frame.x, sludgeTop);
  for (let index = 0; index <= 12; index += 1) {
    const x = frame.x + (index / 12) * frame.width;
    const y = sludgeTop
      + Math.sin(index * 1.8 + time * 0.72) * frame.height * 0.008
      + Math.sin(index * 0.61 - time * 0.29) * frame.height * 0.005;
    context.lineTo(x, y);
  }
  context.lineTo(frame.x + frame.width, bottom + frame.height * 0.1);
  context.lineTo(frame.x, bottom + frame.height * 0.1);
  context.closePath();
  context.fill();

  // Fibrous suspended matter makes the fluid read as viscous slurry instead
  // of luminous water. Positions remain deterministic so the surface crawls
  // rather than flickering frame to frame.
  for (let index = 0; index < 18; index += 1) {
    const lane = (index * 0.61803398875) % 1;
    const sink = (index * 0.41421356237 + time * (0.003 + (index % 4) * 0.001)) % 1;
    const x = frame.x + frame.width * (0.2 + lane * 0.42);
    const y = mix(liquidTop + 5, bottom - 3, sink);
    const width = frame.width * (0.004 + (index % 5) * 0.0014) * (1 + sludge * 0.7);
    context.beginPath();
    context.ellipse(x, y, width * 1.8, width, index * 1.7, 0, Math.PI * 2);
    context.fillStyle = index % 3 === 0 ? "rgba(120, 66, 24, .38)" : "rgba(164, 147, 47, .26)";
    context.fill();
  }

  context.beginPath();
  context.moveTo(frame.x, liquidTop);
  for (let index = 0; index <= 28; index += 1) {
    const x = frame.x + index / 28 * frame.width;
    const y = liquidTop + Math.sin(index * 1.97 + time * 1.4) * frame.height * 0.004
      + Math.sin(index * 0.47 - time * 0.42) * frame.height * 0.003;
    context.lineTo(x, y);
  }
  context.strokeStyle = `rgba(187, 167, 48, ${0.34 + state.wetness * 0.28})`;
  context.lineWidth = Math.max(2, frame.width * 0.007);
  context.stroke();

  const bubbleCount = Math.min(visualBubbles.length, Math.round(3 + gas * 10 + telemetry.bubbleActivity * 5));
  for (let index = 0; index < bubbleCount; index += 1) {
    const bubble = visualBubbles[index];
    const seethe = 0.012 + state.turbulence * 0.055 + state.peristalsisRate / 9000;
    const phase = (bubble.phase + time * seethe / (0.7 + bubble.size * 0.45)) % 1;
    const bx = anatomyPoint(
      0.275 + bubble.lane * 0.051 + Math.sin(time * bubble.deform + bubble.wobble) * 0.014
        + bubble.drift * 0.008,
      0,
      frame,
    ).x;
    const by = mix(bottom - 7, liquidTop + 2, smoothstep(phase));
    const radius = Math.max(2.5, frame.width * 0.008 * bubble.size * (0.55 + state.bubbleSizeMm / 12));
    drawGasBlister(context, bx, by, radius, bubble, phase, stomachPressure);
  }
  context.restore();

  context.save();
  context.strokeStyle = push > 0 ? "#c18b25" : "#8e3828";
  context.lineWidth = Math.max(4, frame.width * 0.018);
  context.shadowBlur = 4 + stomachPressure * 5;
  context.shadowColor = "rgba(112, 24, 17, .6)";
  context.stroke(stomach);
  context.strokeStyle = "rgba(192, 145, 94, .28)";
  context.lineWidth = Math.max(1, frame.width * 0.004);
  context.stroke(stomach);
  context.restore();
}

function drawDigestiveSystem(context, time) {
  const frame = anatomyFrame();
  const stomachPressure = pressureValue("stomach", 0.18);
  const intestinalPressure = pressureValue("intestine", 0.12);
  const colonPressure = pressureValue("colon", 0.16);
  const livePhase = Number.isFinite(telemetry.peristalsisPhase)
    ? telemetry.peristalsisPhase
    : visualPhase % 1;
  const wallMotion = clamp(Math.abs(telemetry.wallMotion) + stomachPressure * 0.12 + gestureFlash * 0.12);
  const stomachPush = pointerDrag?.target === "stomach" || pointerDrag?.target === "gasPocket"
    ? pointerDrag.force
    : 0;

  context.save();
  traceTorso(context, frame, wallMotion);
  const bodyGradient = context.createRadialGradient(
    frame.x + frame.width * 0.48,
    frame.y + frame.height * 0.42,
    frame.width * 0.08,
    frame.x + frame.width * 0.5,
    frame.y + frame.height * 0.48,
    frame.height * 0.55,
  );
  bodyGradient.addColorStop(0, "rgba(88, 28, 20, .26)");
  bodyGradient.addColorStop(0.46, "rgba(46, 25, 14, .38)");
  bodyGradient.addColorStop(1, "rgba(7, 6, 3, .86)");
  context.fillStyle = bodyGradient;
  context.fill();
  context.strokeStyle = "rgba(157, 116, 75, .3)";
  context.lineWidth = 1.25;
  context.stroke();

  traceTorso(context, frame, wallMotion * 0.25);
  context.setLineDash([2, 9]);
  context.strokeStyle = "rgba(177, 141, 89, .1)";
  context.stroke();
  context.setLineDash([]);

  context.save();
  traceTorso(context, frame, wallMotion * 0.2);
  context.clip();
  for (let index = 0; index < 22; index += 1) {
    const x = frame.x + frame.width * (0.14 + ((index * 0.61803398875) % 1) * 0.72);
    const y = frame.y + frame.height * (0.09 + ((index * 0.38196601125) % 1) * 0.82);
    const radius = frame.width * (0.012 + (index % 5) * 0.0045);
    context.beginPath();
    context.ellipse(x, y, radius * (1.2 + (index % 3) * 0.45), radius, index * 0.91, 0, Math.PI * 2);
    context.fillStyle = index % 4 === 0 ? "rgba(95, 83, 25, .09)" : "rgba(104, 25, 19, .11)";
    context.fill();
  }
  context.restore();

  // A quiet double body pulse makes the internal/heart reference visible but
  // never turns Digestazoid into a medical heart simulator.
  const beatPhase = (time * 61 / 60) % 1;
  const heartPulse = Math.exp(-70 * beatPhase) + 0.62 * Math.exp(-80 * Math.max(0, beatPhase - 0.18));
  const heart = anatomyPoint(0.62, 0.17, frame);
  context.globalAlpha = 0.1 + state.bodyPulse * 0.35;
  context.fillStyle = "#78271f";
  context.shadowBlur = 7 * state.bodyPulse;
  context.shadowColor = "#4f120e";
  context.beginPath();
  context.arc(heart.x, heart.y, frame.width * (0.025 + heartPulse * state.bodyPulse * 0.012), 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  // Esophagus and the two body openings are drawn before the organs so their
  // tubes appear to enter the persistent reservoir network.
  const mouth = anatomyPoint(0.5, 0.02, frame);
  const cardia = anatomyPoint(0.445, 0.235, frame);
  const upperFlow = clamp(Math.abs(telemetry.upperFlow) + (activeGestureId === "burp" || activeGestureId === "burple" ? gestureFlash : 0));
  context.beginPath();
  context.moveTo(mouth.x, mouth.y);
  context.bezierCurveTo(
    anatomyPoint(0.51, 0.08, frame).x, anatomyPoint(0.51, 0.08, frame).y,
    anatomyPoint(0.45, 0.14, frame).x, anatomyPoint(0.45, 0.14, frame).y,
    cardia.x, cardia.y,
  );
  context.lineCap = "round";
  context.lineWidth = Math.max(12, frame.width * 0.042);
  context.strokeStyle = "rgba(74, 30, 23, .94)";
  context.stroke();
  context.lineWidth = Math.max(3, frame.width * (0.01 + upperFlow * 0.008));
  context.strokeStyle = upperFlow > 0.04 ? "rgba(167, 126, 35, .88)" : "rgba(137, 67, 39, .48)";
  context.shadowBlur = upperFlow * 9;
  context.shadowColor = "#866419";
  context.stroke();
  context.shadowBlur = 0;

  // The colon is a broad segmented frame around the small gut.
  traceColon(context, frame);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(24, frame.width * (0.074 + colonPressure * 0.009));
  context.strokeStyle = "rgba(50, 24, 17, .98)";
  context.shadowBlur = 5;
  context.shadowColor = "rgba(92, 35, 20, .32)";
  context.stroke();
  traceColon(context, frame);
  context.lineWidth = Math.max(15, frame.width * (0.047 + colonPressure * 0.007));
  context.strokeStyle = `rgba(116, 51, 34, ${0.58 + clamp(state.gas) * 0.2})`;
  context.stroke();
  traceColon(context, frame);
  context.lineWidth = Math.max(2, frame.width * 0.008);
  context.setLineDash([frame.width * 0.018, frame.width * 0.035]);
  context.lineDashOffset = -livePhase * frame.width * 0.22;
  context.strokeStyle = `rgba(177, 121, 51, ${0.2 + state.peristalsisDepth * 0.28})`;
  context.stroke();
  context.setLineDash([]);
  context.shadowBlur = 0;

  // Several passes make the intestine read as a wet compliant tube instead of
  // an abstract line. The luminous dash is the travelling constriction.
  traceSmallIntestine(context, frame, livePhase, state.peristalsisDepth);
  context.lineWidth = Math.max(15, frame.width * (0.047 + intestinalPressure * 0.009));
  context.strokeStyle = "rgba(45, 45, 17, .98)";
  context.stroke();
  traceSmallIntestine(context, frame, livePhase, state.peristalsisDepth);
  context.lineWidth = Math.max(9, frame.width * (0.029 + state.liquid * 0.008));
  context.strokeStyle = `rgba(111, 104, 29, ${0.54 + state.wetness * 0.24})`;
  context.shadowBlur = 4;
  context.shadowColor = "rgba(94, 89, 20, .34)";
  context.stroke();
  traceSmallIntestine(context, frame, livePhase, state.peristalsisDepth);
  context.lineWidth = Math.max(2, frame.width * 0.006);
  context.setLineDash([frame.width * 0.014, frame.width * 0.045]);
  context.lineDashOffset = -(livePhase * frame.width * 0.65);
  context.strokeStyle = "rgba(186, 164, 67, .54)";
  context.stroke();
  context.setLineDash([]);
  context.shadowBlur = 0;

  const stomach = stomachPath(frame, stomachPressure, stomachPush);
  context.fillStyle = "rgba(48, 15, 11, .98)";
  context.fill(stomach);
  drawContents(context, frame, stomach, time, stomachPush);

  // Pyloric connection overlays the stomach rim and visibly joins the coil.
  const pylorus = anatomyPoint(0.515, 0.425, frame);
  const duodenum = anatomyPoint(0.6, 0.47, frame);
  context.beginPath();
  context.moveTo(pylorus.x, pylorus.y);
  context.quadraticCurveTo(anatomyPoint(0.59, 0.41, frame).x, anatomyPoint(0.59, 0.41, frame).y, duodenum.x, duodenum.y);
  context.lineWidth = Math.max(8, frame.width * 0.029);
  context.strokeStyle = "rgba(101, 93, 25, .86)";
  context.stroke();

  // Liquid/sludge packets migrate through the tube with peristaltic phase.
  const slugAmount = clamp(state.sludge * 0.65 + state.liquid * 0.25);
  for (let index = 0; index < 7; index += 1) {
    const phase = (livePhase + index / 7 + time * 0.008 * (1 + state.peristalsisRate / 30)) % 1;
    const angle = phase * Math.PI * 4.6;
    const radiusX = frame.width * mix(0.18, 0.08, phase);
    const radiusY = frame.height * mix(0.16, 0.06, phase);
    const center = anatomyPoint(0.49, 0.585, frame);
    const x = center.x + Math.cos(angle) * radiusX;
    const y = center.y + Math.sin(angle) * radiusY;
    const radius = frame.width * (0.007 + slugAmount * 0.012) * (0.65 + (index % 3) * 0.2);
    context.beginPath();
    context.ellipse(x, y, radius * (1 + state.viscosity * 0.8), radius, angle + Math.PI / 2, 0, Math.PI * 2);
    context.fillStyle = index % 2 ? "rgba(128, 126, 35, .78)" : "rgba(114, 63, 25, .72)";
    context.shadowBlur = 3;
    context.shadowColor = context.fillStyle;
    context.fill();
  }
  context.shadowBlur = 0;

  const valveTelemetry = telemetry.valves ?? {};
  drawValve(context, frame, "upperValve", finite(valveTelemetry.upper, 0.18), pointerDrag?.target === "upperValve");
  drawValve(context, frame, "pyloricValve", finite(valveTelemetry.pyloric, 0.3), pointerDrag?.target === "pyloricValve");
  drawValve(context, frame, "ileocecalValve", finite(valveTelemetry.ileocecal, 0.36), pointerDrag?.target === "ileocecalValve");
  drawValve(context, frame, "lowerValve", finite(valveTelemetry.lower, 0.16), pointerDrag?.target === "lowerValve" || activeGestureId.includes("fart"));

  // The outlet visibly stretches under direct pulling and its twin membranes
  // flutter apart only while pressure produces flow.
  const stretch = clamp(state.outletStretch * 0.1 + (pointerDrag?.target === "outlet" ? pointerDrag.distance * 0.7 : 0), 0, 0.18);
  const valve = anatomyPoint(0.515, 0.875, frame);
  const outlet = anatomyPoint(0.515, 0.94 + stretch, frame);
  const lowerFlow = clamp(Math.abs(telemetry.lowerFlow) + (activeGestureId.includes("fart") ? gestureFlash : 0));
  context.beginPath();
  context.moveTo(valve.x, valve.y);
  context.quadraticCurveTo(anatomyPoint(0.48, 0.91, frame).x, anatomyPoint(0.48, 0.91, frame).y, outlet.x, outlet.y);
  context.lineWidth = Math.max(13, frame.width * 0.042);
  context.strokeStyle = "rgba(70, 37, 20, .98)";
  context.stroke();
  context.save();
  context.translate(outlet.x, outlet.y);
  const flutter = lowerFlow * Math.sin(time * mix(80, 190, state.outletStretch));
  context.rotate(pointerDrag?.target === "outlet" ? Math.atan2(pointerDrag.dy, pointerDrag.dx) * 0.18 : 0);
  context.fillStyle = "#080603";
  context.strokeStyle = "#87541e";
  context.lineWidth = Math.max(2, frame.width * 0.007);
  context.shadowBlur = 4 + lowerFlow * 8;
  context.shadowColor = "#684017";
  context.beginPath();
  context.ellipse(-frame.width * 0.018, 0, frame.width * 0.026, frame.width * (0.014 + Math.abs(flutter) * 0.009), -0.16, 0, Math.PI * 2);
  context.ellipse(frame.width * 0.018, 0, frame.width * 0.026, frame.width * (0.014 + Math.abs(flutter) * 0.009), 0.16, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();

  if (lowerFlow > 0.03) {
    for (let index = 0; index < 9; index += 1) {
      const drift = ((time * (0.32 + index * 0.014) + index * 0.17) % 1);
      const x = outlet.x + Math.sin(index * 3.1 + time * 5) * frame.width * 0.045 * drift;
      const y = outlet.y + drift * frame.height * 0.11;
      const radius = frame.width * (0.008 + (index % 3) * 0.003) * (1 - drift * 0.45);
      context.save();
      context.translate(x, y);
      context.rotate(index * 1.13 + time * 0.2);
      context.scale(1.3 + drift * 0.8, 0.65 + (index % 2) * 0.25);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(105, 100, 29, ${(1 - drift) * lowerFlow * 0.42})`;
      context.fill();
      context.restore();
    }
  }

  if (upperFlow > 0.03) {
    for (let index = 0; index < 7; index += 1) {
      const rise = ((time * (0.42 + index * 0.02) + index * 0.13) % 1);
      const x = mouth.x + Math.sin(time * 7 + index * 2.4) * frame.width * 0.055 * rise;
      const y = mouth.y - rise * frame.height * 0.12;
      context.beginPath();
      context.arc(x, y, frame.width * (0.008 + index * 0.0017), 0, Math.PI * 2);
      context.strokeStyle = `rgba(157, 132, 46, ${(1 - rise) * upperFlow * 0.72})`;
      context.lineWidth = 1.2;
      context.stroke();
    }
  }

  drawLabel(context, frame, 0.24, 0.27, "stomach", -1, "#b66a43");
  drawLabel(context, frame, 0.73, 0.4, "colon", 1, "#9c6544");
  drawLabel(context, frame, 0.63, 0.55, "small gut", 1, "#aaa044");
  drawLabel(context, frame, 0.515, 0.875, "rubber valve", 1, "#a16a27");

  if (pointerDrag) {
    const point = anatomyPoint(pointerDrag.current.x, pointerDrag.current.y, frame);
    context.beginPath();
    context.arc(point.x, point.y, 12 + pointerDrag.force * 17, 0, Math.PI * 2);
    context.strokeStyle = "rgba(202, 180, 91, .88)";
    context.lineWidth = 1.5;
    context.setLineDash([3, 4]);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function paint(timeMilliseconds) {
  resizeCanvas();
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  const time = timeMilliseconds / 1_000;
  const backdrop = drawing.createRadialGradient(cssWidth * 0.46, cssHeight * 0.43, 0, cssWidth * 0.46, cssHeight * 0.43, Math.max(cssWidth, cssHeight) * 0.58);
  backdrop.addColorStop(0, `rgba(102, 35, 15, ${0.08 + eventFlash * 0.12})`);
  backdrop.addColorStop(0.46, "rgba(49, 30, 9, .08)");
  backdrop.addColorStop(1, "rgba(0, 0, 0, 0)");
  drawing.fillStyle = backdrop;
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  drawDigestiveSystem(drawing, time);
}

function animate(now) {
  const delta = Math.min(0.05, Math.max(0, (now - previousFrameAt) / 1_000));
  previousFrameAt = now;
  if (!pageIsActive) {
    animationFrame = requestAnimationFrame(animate);
    return;
  }
  const phaseRate = Math.max(0.02, state.peristalsisRate / 60);
  if (state.performing || pointerDrag || activeGestureId) visualPhase = (visualPhase + delta * phaseRate) % 1;
  gestureFlash *= Math.exp(-delta * 2.8);
  eventFlash *= Math.exp(-delta * 3.6);
  if (!prefersReducedMotion || pointerDrag || eventFlash > 0.01) paint(now);
  if (Math.floor(now / 50) !== Math.floor((now - delta * 1_000) / 50)) updateLiveReadouts();
  animationFrame = requestAnimationFrame(animate);
}

function pointerValues(event) {
  const point = stageToAnatomy(event.clientX, event.clientY);
  const pressure = event.pointerType === "mouse" ? (event.buttons ? 0.72 : 0) : finite(event.pressure, 0.72);
  return { point, pressure: clamp(pressure || 0.68, 0.08, 1) };
}

function beginPointerInteraction(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const { point, pressure } = pointerValues(event);
  const target = targetAtPoint(point);
  pointerDrag = {
    pointerId: event.pointerId,
    target,
    action: TARGET_ACTIONS[target] ?? "poke",
    start: point,
    current: point,
    dx: 0,
    dy: 0,
    distance: 0,
    force: pressure,
  };
  const initialInteraction = { ...pointerDrag };
  canvas.setPointerCapture?.(event.pointerId);
  $("contactOut").textContent = TARGET_LABELS[target] ?? target;
  ensureAudio().then((ready) => {
    if (!ready) return;
    const stillHeld = pointerDrag?.pointerId === initialInteraction.pointerId;
    postInteraction("start", initialInteraction.target, {
      x: initialInteraction.start.x,
      y: initialInteraction.start.y,
      force: initialInteraction.force,
    });
    postInteraction(initialInteraction.action, initialInteraction.target, {
      x: initialInteraction.start.x,
      y: initialInteraction.start.y,
      force: initialInteraction.force,
    });
    if (!stillHeld) {
      postInteraction("release", initialInteraction.target, {
        x: initialInteraction.start.x,
        y: initialInteraction.start.y,
        force: initialInteraction.force,
      });
    }
  });
  announce(`${TARGET_LABELS[target] ?? target}: ${pointerDrag.action}. Drag to change force, then release.`);
  event.preventDefault();
}

function movePointerInteraction(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const { point, pressure } = pointerValues(event);
  const dx = point.x - pointerDrag.start.x;
  const dy = point.y - pointerDrag.start.y;
  const travel = Math.hypot(dx, dy);
  pointerDrag.current = point;
  pointerDrag.dx = dx;
  pointerDrag.dy = dy;
  pointerDrag.distance = travel;
  pointerDrag.force = clamp(Math.max(pressure * 0.55, 0.26 + travel * 2.4));
  postInteraction(pointerDrag.action, pointerDrag.target, {
    x: point.x,
    y: point.y,
    dx,
    dy,
    force: pointerDrag.force,
  });
  $("contactOut").textContent = `${TARGET_LABELS[pointerDrag.target]} · ${percent(pointerDrag.force)}`;
  event.preventDefault();
}

function releasePointerInteraction(event = null) {
  if (!pointerDrag) return;
  if (event && event.pointerId !== undefined && pointerDrag.pointerId !== event.pointerId) return;
  const released = pointerDrag;
  pointerDrag = null;
  postInteraction("release", released.target, {
    x: released.current.x,
    y: released.current.y,
    dx: released.dx,
    dy: released.dy,
    force: released.force,
  });
  if (released.target === "outlet" && released.distance > 0.04) {
    triggerGesture("fart", clamp(0.35 + released.distance * 2.2), "outlet");
  } else if (released.target === "stomach" && released.force > 0.72) {
    triggerGesture(state.liquid > 0.48 ? "burple" : "growl", released.force, "stomach");
  }
  $("contactOut").textContent = `${TARGET_LABELS[released.target]} released`;
  event?.preventDefault?.();
}

function auditionCanvasTarget(event) {
  const point = stageToAnatomy(event.clientX, event.clientY);
  const target = targetAtPoint(point);
  const gesture = target === "upperValve" ? "burp"
    : target === "lowerValve" || target === "outlet" ? "fart"
    : target === "gasPocket" ? "bubble"
    : target === "stomach" ? "growl"
    : target === "smallIntestine" ? "burble"
    : target === "colon" ? "burple"
    : "slosh";
  triggerGesture(gesture, 0.78, target);
}

function bindControl(spec) {
  const input = $(spec.id);
  if (!input) return;
  input.addEventListener("input", () => {
    setState({ [spec.key]: finite(input.value, state[spec.key]) });
  });
  input.addEventListener("change", () => {
    announce(`${input.closest("label")?.querySelector("b")?.textContent ?? spec.id}: ${spec.format(state[spec.key])}.`);
  });
}

function bindGasButton(id, direction) {
  const button = $(id);
  const start = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    button.setPointerCapture?.(event.pointerId);
    beginGasChange(direction, button);
    event.preventDefault();
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", endGasChange);
  button.addEventListener("pointercancel", endGasChange);
  button.addEventListener("lostpointercapture", endGasChange);
  button.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !manualGasTimer) beginGasChange(direction, button);
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") endGasChange();
  });
}

function bindEvents() {
  for (const spec of CONTROL_SPECS) bindControl(spec);
  $("listeningMode").addEventListener("change", () => {
    setState({ listeningMode: $("listeningMode").value });
    announce(`Listening ${$("listeningMode").selectedOptions[0]?.textContent ?? state.listeningMode}.`);
  });
  $("audioButton").addEventListener("click", () => {
    if (audioDesiredOn && audioContext?.state === "running") stopAudio();
    else ensureAudio();
  });
  $("digestButton").addEventListener("click", togglePerforming);
  $("presetSelect").addEventListener("change", () => applyPreset($("presetSelect").value));
  $("nextPresetButton").addEventListener("click", () => {
    const current = Math.max(0, DIGESTAZOID_PRESETS.findIndex((preset) => preset.id === state.presetId));
    const next = DIGESTAZOID_PRESETS[(current + 1) % DIGESTAZOID_PRESETS.length];
    applyPreset(next.id);
  });
  $("randomizeButton").addEventListener("click", randomizeBody);
  $("resetButton").addEventListener("click", resetInstrument);
  document.querySelectorAll("[data-gesture]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      triggerGesture(button.dataset.gesture, clamp(finite(event.pressure, 0.8) || 0.8, 0.35, 1));
    });
    button.addEventListener("click", (event) => {
      if (event.detail === 0) triggerGesture(button.dataset.gesture, 0.8);
    });
  });
  bindGasButton("inflateButton", 1);
  bindGasButton("deflateButton", -1);

  canvas.addEventListener("pointerdown", beginPointerInteraction);
  canvas.addEventListener("pointermove", movePointerInteraction);
  canvas.addEventListener("pointerup", releasePointerInteraction);
  canvas.addEventListener("pointercancel", releasePointerInteraction);
  canvas.addEventListener("lostpointercapture", releasePointerInteraction);
  canvas.addEventListener("dblclick", auditionCanvasTarget);

  globalThis.addEventListener("keydown", (event) => {
    if (event.repeat && event.key !== "Escape") return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (/^[1-8]$/.test(event.key)) {
      const gesture = DIGESTAZOID_GESTURES[Number(event.key) - 1];
      if (gesture) triggerGesture(gesture.id, 0.82);
      event.preventDefault();
      return;
    }
    const gestureKeys = { g: "growl", u: "burble", b: "burp", p: "burple", f: "fart", s: "slosh" };
    const gesture = gestureKeys[event.key.toLowerCase()];
    if (gesture) {
      triggerGesture(gesture, 0.82);
      event.preventDefault();
      return;
    }
    if (event.key === " ") {
      togglePerforming();
      event.preventDefault();
    } else if (event.key === "Escape") {
      releasePointerInteraction();
      endGasChange();
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      setState({ performing: false });
      $("eventOut").textContent = "silenced";
      announce("Digestazoid silenced and every held valve released.");
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    paint(performance.now());
  });
  resizeObserver.observe(stageWrap);
  document.addEventListener("visibilitychange", () => {
    pageIsActive = !document.hidden;
    if (!pageIsActive) {
      releasePointerInteraction();
      endGasChange();
      graph?.sourceNode?.port.postMessage({ type: "interaction", action: "release-all" });
    }
  });
  globalThis.addEventListener("pagehide", () => {
    releasePointerInteraction();
    endGasChange();
    graph?.sourceNode?.port.postMessage({ type: "silence" });
    graph?.releaseOutput?.();
  }, { once: true });
}

initializePresets();
bindEvents();
updateUI();
resizeCanvas();
paint(performance.now());
animationFrame = requestAnimationFrame(animate);
