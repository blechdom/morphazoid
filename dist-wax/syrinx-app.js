import {
  ANIMALS,
  CALL_GESTURES,
  MODEL_LABELS,
  animalState,
  callsForAnimal,
  clamp,
  interpolateGesture,
  resolveSourceControls,
  sanitizeSyrinxState,
} from "./src/syrinx.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const animalSelect = $("animalSelect");
const callSelect = $("callSelect");
const canvas = $("stage");
const drawing = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const audioButton = $("audioButton");
const playButton = $("playButton");
const loopButton = $("loopButton");
const breathButton = $("breathButton");
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
  level: "level",
});

const MODEL_TOPOLOGY = Object.freeze({
  mammal: "two-mass fold flow → variable-area tract → lip / body modes",
  bird: "left + right labia → shared tracheal tract → OEC / beak modes",
  frog: "self-oscillating membrane → short tract → sac / head modes",
  rodent: "glottal jet → wall impingement → tract / mouth modes",
});

const HANDLE_COLORS = Object.freeze({
  tension: "#ff7b6f",
  cavityCoupling: "#72e7dc",
  tractLengthM: "#ffcf68",
  mouthOpening: "#bf9cff",
});

let state = animalState("raven");
let performanceState = { ...state, active: false };
let audioContext = null;
let graph = null;
let startingAudio = false;
let gesturePlaying = false;
let gestureStartTime = 0;
let gesturePhase = 0;
let manualBreath = false;
let audioDirty = true;
let lastConfigurationTime = -Infinity;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let pointerDrag = null;
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
  const text = String(value ?? "").replaceAll("-", " ");
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
  await context.audioWorklet.addModule(new URL("./src/syrinx-processor.js", import.meta.url));

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
    ? `${Math.round(gesturePhase * 100)}% through gesture`
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
  setGesturePresentation();
  announce(`${activeAnimal().label} ${activeGesture().label} started`);
  audioDirty = true;
}

function stopPerformance(message = "Call released") {
  gesturePlaying = false;
  manualBreath = false;
  gesturePhase = 0;
  performanceState = { ...state, active: false };
  breathButton.setAttribute("aria-pressed", "false");
  setGesturePresentation();
  postConfiguration(performanceState);
  audioDirty = false;
  if (message) announce(message);
}

function setManualBreath(active) {
  if (active === manualBreath) return;
  if (active) {
    gesturePlaying = false;
    gesturePhase = 0;
  }
  manualBreath = active;
  breathButton.setAttribute("aria-pressed", String(active));
  setGesturePresentation();
  performanceState = active ? { ...state, active: true } : { ...state, active: false };
  postConfiguration(performanceState);
  audioDirty = false;
  announce(active ? `${activeAnimal().label} manual pressure on` : "Manual pressure released");
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
    const bounds = animal.bounds[stateKey];
    const input = $(elementId);
    if (!input || !bounds) continue;
    input.min = String(bounds[0]);
    input.max = String(bounds[1]);
  }
}

function setInputValue(stateKey) {
  const input = $(CONTROL_IDS[stateKey]);
  if (input) input.value = String(state[stateKey]);
}

function updateControlValues() {
  for (const stateKey of Object.keys(CONTROL_IDS)) setInputValue(stateKey);
  $("pressureOut").textContent = formatPercent(state.pressure);
  $("tensionOut").textContent = formatPercent(state.tension);
  $("adductionOut").textContent = formatPercent(state.adduction);
  $("sourceScaleOut").textContent = formatPercent(state.sourceScale);
  $("tractLengthOut").textContent = formatLength(state.tractLengthM);
  $("mouthOpeningOut").textContent = formatPercent(state.mouthOpening);
  $("cavityCouplingOut").textContent = formatPercent(state.cavityCoupling);
  $("asymmetryOut").textContent = formatPercent(state.asymmetry);
  $("sourceBalanceOut").textContent = balanceLabel(state.sourceBalance);
  $("roughnessOut").textContent = formatPercent(state.roughness);
  $("gestureRateOut").textContent = `${state.gestureRate.toFixed(2)}×`;
  $("levelOut").textContent = formatPercent(state.level);
  $("sourceSummary").textContent = `pressure ${formatPercent(state.pressure)} · tension ${formatPercent(state.tension)}`;
  $("tractSummary").textContent = `${formatLength(state.tractLengthM)} · opening ${formatPercent(state.mouthOpening)}`;
  $("nonlinearSummary").textContent = `${formatPercent(state.asymmetry)} split · ${formatPercent(state.roughness)} rough`;
  $("gestureSummary").textContent = `${activeGesture().label.toLowerCase()} · ${state.gestureRate.toFixed(2)}×`;
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
  $("sourceBalanceControl").hidden = animal.model !== "bird";
  $("asymmetryLabel").textContent = animal.model === "bird"
    ? "Left / right asymmetry"
    : animal.model === "mammal"
      ? "Tissue / fold asymmetry"
      : animal.model === "frog" ? "Membrane irregularity" : "Jet instability";
  updateCallOptions();
  updateControlBounds();
  updateControlValues();
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
  document.body.classList.toggle("is-sounding", soundingState.active && (telemetry.rms > 0.0002 || !graph));
}

function loadAnimal(animalId) {
  stopPerformance("");
  const retainedLevel = state.level;
  state = animalState(animalId, { level: retainedLevel });
  performanceState = { ...state, active: false };
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
  announce(`${activeAnimal().label} loaded. ${activeAnimal().apparatus}. Species-informed ranges locked.`);
  audioDirty = false;
}

function loadCall(callId) {
  stopPerformance("");
  state = sanitizeSyrinxState({ ...state, callId }, state);
  updateCallOptions();
  updateControlValues();
  setGesturePresentation();
  announce(`${activeGesture().label} gesture selected`);
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
    loadAnimal(state.animalId);
    announce(`${activeAnimal().label} restored to its species-informed starting range`);
  });

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

function renderStage(time) {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  const layout = anatomyLayout(performanceState);
  drawWaveform(layout);
  drawLungs(layout, performanceState, time);
  drawTract(layout, performanceState, time);
  drawCavity(layout, performanceState, time);
  drawSource(layout, performanceState, time);
  drawProgress(layout);

  const animal = activeAnimal();
  const tensionRange = animal.bounds.tension;
  const tensionAmount = (performanceState.tension - tensionRange[0])
    / Math.max(0.0001, tensionRange[1] - tensionRange[0]);
  handles = [
    {
      type: "tension",
      label: "TENSION",
      x: layout.sourceX,
      y: layout.sourceY + 76 - clamp(tensionAmount) * 152,
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
  return nearest;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function dragControl(type, point) {
  const animal = activeAnimal();
  const bounds = animal.bounds[type];
  if (!bounds) return;
  const layout = anatomyLayout(state);
  let value = state[type];
  if (type === "tension") {
    const amount = clamp((layout.sourceY + 76 - point.y) / 152);
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
    const point = canvasPoint(event);
    const handle = handleAt(point.x, point.y);
    if (!handle) return;
    event.preventDefault();
    pointerDrag = handle;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    dragControl(handle.type, point);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDrag) return;
    event.preventDefault();
    dragControl(pointerDrag.type, canvasPoint(event));
  });
  const release = () => {
    if (pointerDrag) announce(`${pointerDrag.label.toLowerCase()} set within ${activeAnimal().label} range`);
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("keydown", (event) => {
    const animal = activeAnimal();
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
    const [minimum, maximum] = animal.bounds[key];
    setControl(key, state[key] + direction * (maximum - minimum) * 0.025, {
      announceChange: true,
    });
  });
}

function updatePerformance(time) {
  if (gesturePlaying) {
    const gesture = activeGesture();
    const duration = gesture.durationMs / state.gestureRate;
    let elapsed = time - gestureStartTime;
    if (elapsed >= duration) {
      if (state.loop) {
        elapsed %= duration;
        gestureStartTime = time - elapsed;
      } else {
        gesturePhase = 1;
        performanceState = interpolateGesture(gesture, 1, state);
        updatePerformancePresentation(performanceState);
        stopPerformance(`${gesture.label} complete`);
        return;
      }
    }
    gesturePhase = clamp(elapsed / Math.max(1, duration));
    performanceState = interpolateGesture(gesture, gesturePhase, state);
    setGesturePresentation();
    audioDirty = true;
  } else if (manualBreath) {
    performanceState = { ...state, active: true };
  } else {
    performanceState = { ...state, active: false };
  }
  updatePerformancePresentation(performanceState);

  if (audioDirty && time - lastConfigurationTime >= 26) {
    postConfiguration(performanceState);
    lastConfigurationTime = time;
    audioDirty = gesturePlaying;
  }
}

function animate(time) {
  updatePerformance(time);
  renderStage(time);
  animationFrame = requestAnimationFrame(animate);
}

function installLifecycle() {
  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(stageWrap);
  globalThis.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    stopPerformance("All pressure released");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPerformance("");
  });
  globalThis.addEventListener("pagehide", () => {
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
setAudioPresentation("off");
animationFrame = requestAnimationFrame(animate);
