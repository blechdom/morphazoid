import {
  WAVE_POOL_BOUNDARIES,
  WAVE_POOL_GENERATORS,
  WAVE_POOL_LANE_IDS,
  WAVE_POOL_PRESETS,
  WAVE_POOL_RECEIVERS,
  WAVE_POOL_SEQUENCE_LENGTH,
  createWavePoolState,
  deriveWavePoolPhysics,
  sanitizeWavePoolState,
} from "./src/wave-pool.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => Math.min(
  maximum,
  Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum),
);
const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const LANE_COPY = Object.freeze({
  paddle: Object.freeze({ label: "Paddle", color: "#ff8b5c", key: "1", padId: "oneWaveButton" }),
  breaker: Object.freeze({ label: "Break", color: "#d7ff69", key: "2", padId: "splashButton" }),
  wall: Object.freeze({ label: "Water-on-wall", color: "#c39aff", key: "3", padId: "slapButton" }),
  vortex: Object.freeze({ label: "Vortex", color: "#55e8df", key: "4", padId: "vortexButton" }),
});

const CONTROL_SPECS = Object.freeze([
  ["tempoBpm", (value) => `${Math.round(value)} BPM`],
  ["swing", formatPercent],
  ["depthM", (value) => `${Number(value).toFixed(2).replace(/0$/, "")} m`],
  ["widthM", (value) => `${Number(value).toFixed(1).replace(/\.0$/, "")} m`],
  ["waveHeightM", (value) => `${Number(value).toFixed(2)} m`],
  ["wavePeriodSeconds", (value) => `${Number(value).toFixed(1)} s`],
  ["paddleForce", formatPercent],
  ["paddleCount", (value) => String(Math.round(value))],
  ["phaseSpread", formatPercent],
  ["machinery", formatPercent],
  ["breaking", formatPercent],
  ["splash", formatPercent],
  ["bubbleDensity", formatPercent],
  ["bubbleSize", formatBubbleRadius],
  ["whirlpool", formatPercent],
  ["aeration", formatPercent],
  ["wallImpact", formatPercent],
  ["panelTone", formatPercent],
  ["damping", formatPercent],
  ["level", formatPercent],
]);

let state = createWavePoolState("family-surge");
let physics = deriveWavePoolPhysics(state);
let graph = null;
let audioStarting = null;
let transportPlaying = false;
let pageActive = true;
let animationFrame = 0;
let visualTime = 0;
let previousFrameTime = performance.now();
let poolMetrics = { width: 1, height: 1, scale: 1, offsetX: 0, offsetY: 0, pixelRatio: 1 };
let focusedGridIndex = 0;
let telemetry = {
  playing: false,
  stepIndex: -1,
  generatorPhase: 0,
  surfaceEnergy: 0,
  breakerEnergy: 0,
  wallEnergy: 0,
  activeBubbles: 0,
  vortexStrength: 0,
  peak: 0,
  rms: 0,
};
const eventFlashes = { paddle: 0, breaker: 0, wall: 0, vortex: 0 };
const particles = [];

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatBubbleRadius() {
  const radius = Number(physics?.bubbleRadiusMm ?? 0);
  return `${radius.toFixed(radius < 1 ? 2 : 1)} mm`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency >= 10_000 ? 1 : 2)} kHz`;
  return `${Math.round(frequency)} Hz`;
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return seconds < 1 ? `${Math.round(seconds * 1_000)} ms` : `${seconds.toFixed(1)} s`;
}

function entryFor(collection, id) {
  return collection.find((entry) => entry.id === id) ?? collection[0];
}

function patternRows(source = state) {
  const pattern = source?.pattern ?? source?.patterns ?? {};
  return Object.fromEntries(WAVE_POOL_LANE_IDS.map((lane, laneIndex) => {
    const row = Array.isArray(pattern)
      ? (Array.isArray(pattern[laneIndex]) ? pattern[laneIndex] : pattern[laneIndex]?.steps)
      : pattern[lane];
    return [lane, Array.from({ length: WAVE_POOL_SEQUENCE_LENGTH }, (_, step) => (
      clamp(row?.[step] ?? 0)
    ))];
  }));
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function setAudioPresentation(status = "off", message = "") {
  const button = $("audioButton");
  const on = status === "on";
  button?.setAttribute("aria-pressed", String(on));
  if (button) {
    button.dataset.audioState = status;
    button.disabled = status === "starting";
  }
  if ($("audioState")) $("audioState").textContent = on ? "on" : "off";
  if ($("audioError")) {
    $("audioError").hidden = !message;
    $("audioError").textContent = message;
  }
}

function audioConfiguration() {
  // The worklet owns a conservative source ceiling. The visible level control
  // is applied exactly once by the final master gain.
  return { ...state, level: 1, pattern: patternRows(state) };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({
    type: "configure",
    configuration: audioConfiguration(),
  });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.resume();
  await context.audioWorklet.addModule(new URL("./src/wave-pool-processor.js", import.meta.url));
  const sourceNode = new AudioWorkletNode(context, "wave-pool-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { configuration: audioConfiguration() },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = clamp(state.level, 0, 0.7);
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.18;
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.54;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = ({ data }) => {
    if (data?.type !== "telemetry") return;
    telemetry = { ...telemetry, ...data };
    syncPlayhead();
  };
  sourceNode.onprocessorerror = () => {
    stopTransport({ announceChange: false });
    setAudioPresentation("off", "The Wave Pool model stopped unexpectedly. Reload to reset it.");
  };
  return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
}

async function ensureAudio() {
  if (graph) {
    unlockAudioContext(graph.context);
    await graph.context.resume();
    setAudioPresentation("on");
    return true;
  }
  if (audioStarting) return audioStarting;
  setAudioPresentation("starting");
  audioStarting = (async () => {
    try {
      graph = await createAudioGraph();
      postConfiguration();
      graph.sourceNode.port.postMessage({ type: "transport", playing: transportPlaying });
      setAudioPresentation("on");
      announce("Wave Pool audio is ready at a quiet thirty percent output.");
      return true;
    } catch (error) {
      console.error(error);
      graph = null;
      setAudioPresentation("off", error?.message || "Unable to start Wave Pool audio.");
      return false;
    } finally {
      audioStarting = null;
    }
  })();
  return audioStarting;
}

async function closeAudio() {
  stopTransport({ announceChange: false });
  const closing = graph;
  graph = null;
  if (!closing) {
    setAudioPresentation("off");
    return;
  }
  try {
    closing.sourceNode.port.postMessage({ type: "panic" });
    closing.releaseOutput?.();
    closing.sourceNode.disconnect();
    closing.masterGain.disconnect();
    closing.compressor.disconnect();
    closing.analyser.disconnect();
    await closing.context.close();
  } catch {
    // A closing browser context may already have detached its nodes.
  }
  telemetry = { ...telemetry, playing: false, stepIndex: -1, peak: 0, rms: 0 };
  setAudioPresentation("off");
  announce("Wave Pool audio is off.");
}

async function toggleAudio() {
  if (graph) await closeAudio();
  else await ensureAudio();
}

function syncTransportPresentation() {
  $("playButton")?.setAttribute("aria-pressed", String(transportPlaying));
  if ($("playLabel")) $("playLabel").textContent = transportPlaying ? "Stop pool" : "Run pool";
  if ($("playState")) $("playState").textContent = transportPlaying
    ? "space · sequence running"
    : "space · sequence stopped";
  if ($("stageState")) $("stageState").dataset.state = transportPlaying ? "running" : "ready";
  if ($("stageStateText")) $("stageStateText").textContent = transportPlaying ? "cycling" : "ready";
}

async function startTransport() {
  if (!(await ensureAudio())) return;
  transportPlaying = true;
  graph?.sourceNode?.port.postMessage({ type: "transport", playing: true });
  syncTransportPresentation();
  announce("Wave Pool sequence running.");
}

function stopTransport({ announceChange = true } = {}) {
  transportPlaying = false;
  graph?.sourceNode?.port.postMessage({ type: "transport", playing: false });
  syncTransportPresentation();
  if (announceChange) announce("Wave Pool sequence stopped; fluid memory is decaying.");
}

async function toggleTransport() {
  if (transportPlaying) stopTransport();
  else await startTransport();
}

function flashPad(lane) {
  eventFlashes[lane] = 1;
  const button = $(LANE_COPY[lane]?.padId);
  button?.classList.add("is-hit");
  globalThis.setTimeout(() => button?.classList.remove("is-hit"), 120);
}

function spawnVisualEvent(lane, strength = 1, normalizedX = 0.5, normalizedY = 0.5) {
  const count = reduceMotion ? 3 : Math.round(5 + strength * (lane === "breaker" ? 18 : 9));
  for (let index = 0; index < count && particles.length < 180; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.015 + Math.random() * 0.05) * (0.6 + strength);
    particles.push({
      lane,
      x: normalizedX,
      y: normalizedY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (lane === "breaker" ? 0.035 : 0),
      life: 0.5 + Math.random() * 0.7,
      maxLife: 1.2,
      size: 1.5 + Math.random() * 4 * strength,
    });
  }
}

async function triggerEvent(lane, strength = 1, position = {}) {
  if (!WAVE_POOL_LANE_IDS.includes(lane)) return;
  if (!(await ensureAudio())) return;
  const normalizedX = clamp(position.x ?? (lane === "paddle" ? 0.12 : lane === "wall" ? 0.88 : 0.62));
  const normalizedY = clamp(position.y ?? (lane === "vortex" ? 0.66 : 0.5));
  graph?.sourceNode?.port.postMessage({
    type: "trigger",
    lane,
    event: lane,
    strength: clamp(strength),
    position: { x: normalizedX, y: normalizedY },
  });
  flashPad(lane);
  spawnVisualEvent(lane, strength, normalizedX, normalizedY);
  announce(`${LANE_COPY[lane].label} event sent into the pool.`);
}

function setState(nextState, { rebuildPattern = false } = {}) {
  state = sanitizeWavePoolState(nextState, state);
  physics = deriveWavePoolPhysics(state);
  syncControls();
  syncReadouts();
  if (rebuildPattern) buildSequenceGrid();
  else syncSequenceGrid();
  postConfiguration();
}

function setControl(key, value) {
  const numeric = key === "paddleCount" ? Math.round(Number(value)) : Number(value);
  setState({ ...state, [key]: numeric });
  if (key === "level" && graph) {
    const now = graph.context.currentTime;
    graph.masterGain.gain.cancelScheduledValues(now);
    graph.masterGain.gain.setTargetAtTime(clamp(numeric, 0, 0.7), now, 0.018);
  }
}

function populateOptions(select, entries) {
  select?.replaceChildren(...entries.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    return option;
  }));
}

function buildPresetControls() {
  populateOptions($("presetSelect"), WAVE_POOL_PRESETS);
  $("presetButtons")?.replaceChildren(...WAVE_POOL_PRESETS.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.textContent = preset.shortLabel ?? preset.label;
    button.addEventListener("click", () => applyPreset(preset.id));
    return button;
  }));
  populateOptions($("boundaryId"), WAVE_POOL_BOUNDARIES);
  populateOptions($("receiverId"), WAVE_POOL_RECEIVERS);
  populateOptions($("generatorId"), WAVE_POOL_GENERATORS);
}

function applyPreset(presetId) {
  state = createWavePoolState(presetId);
  physics = deriveWavePoolPhysics(state);
  syncControls();
  syncReadouts();
  buildSequenceGrid();
  postConfiguration();
  const preset = entryFor(WAVE_POOL_PRESETS, state.presetId);
  announce(`${preset.label} loaded at ${formatPercent(state.level)} output.`);
}

function syncControls() {
  for (const [key, formatter] of CONTROL_SPECS) {
    const input = $(key);
    if (input && document.activeElement !== input) input.value = state[key];
    const output = $(`${key}Out`);
    if (output) output.textContent = formatter(state[key]);
  }
  for (const key of ["presetId", "generatorId", "boundaryId", "receiverId"]) {
    const select = $(key === "presetId" ? "presetSelect" : key);
    if (select && document.activeElement !== select) select.value = state[key];
  }
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.presetId));
  });

  const preset = entryFor(WAVE_POOL_PRESETS, state.presetId);
  const generator = entryFor(WAVE_POOL_GENERATORS, state.generatorId);
  const boundary = entryFor(WAVE_POOL_BOUNDARIES, state.boundaryId);
  const receiver = entryFor(WAVE_POOL_RECEIVERS, state.receiverId);
  if ($("presetDescription")) $("presetDescription").textContent = preset.description ?? "";
  if ($("boundaryDescription")) $("boundaryDescription").textContent = boundary.description ?? "";
  if ($("receiverDescription")) $("receiverDescription").textContent = receiver.description ?? "";
  if ($("generatorCode")) $("generatorCode").textContent = (generator.code ?? generator.label).toUpperCase();
  if ($("generatorSummary")) $("generatorSummary").textContent = `${generator.label} · ${Math.round(state.tempoBpm)} BPM`;
  if ($("boundarySummary")) $("boundarySummary").textContent = boundary.label;
  if ($("receiverSummary")) $("receiverSummary").textContent = receiver.label;
  if ($("waterSummary")) {
    const severity = Number(physics.breakerSeverity ?? physics.breakingSeverity ?? physics.breakSeverity ?? 0);
    $("waterSummary").textContent = severity > 0.72 ? "violent break" : severity > 0.34 ? "moderate break" : "unbroken surge";
  }
}

function valueFromPhysics(...keys) {
  for (const key of keys) {
    if (Number.isFinite(Number(physics?.[key]))) return Number(physics[key]);
  }
  return 0;
}

function syncReadouts() {
  const waveSpeed = valueFromPhysics("waveSpeedMps", "shallowWaterSpeedMps", "phaseSpeedMps");
  const wavelength = valueFromPhysics("wavelengthM", "waveLengthM");
  const travel = valueFromPhysics("wallTravelSeconds", "travelTimeSeconds", "waveTravelSeconds");
  const bubbleFrequency = valueFromPhysics("bubbleFrequencyHz", "bubbleResonanceHz");
  const reflection = valueFromPhysics("reflectionCoefficient", "boundaryReflection");
  const breaker = valueFromPhysics("breakerSeverity", "breakingSeverity", "breakSeverity");
  if ($("waveSpeedReadout")) $("waveSpeedReadout").textContent = `${waveSpeed.toFixed(2)} m/s`;
  if ($("wavelengthReadout")) $("wavelengthReadout").textContent = `${wavelength.toFixed(1)} m`;
  if ($("travelReadout")) $("travelReadout").textContent = formatSeconds(travel);
  if ($("bubbleReadout")) $("bubbleReadout").textContent = formatFrequency(bubbleFrequency);
  if ($("reflectionReadout")) $("reflectionReadout").textContent = `${Math.round(reflection * 100)}% pressure`;
  if ($("breakingReadout")) $("breakingReadout").textContent = `${Math.round(breaker * 100)}% severity`;
}

function nextVelocity(value) {
  if (value < 0.2) return 0.55;
  if (value < 0.68) return 0.78;
  if (value < 0.9) return 1;
  return 0;
}

function setPatternStep(lane, step, velocity) {
  const pattern = patternRows(state);
  pattern[lane][step] = clamp(velocity);
  setState({ ...state, pattern });
}

function buildSequenceGrid() {
  const grid = $("sequencerGrid");
  if (!grid) return;
  const rows = patternRows(state);
  const nodes = [];
  const corner = document.createElement("span");
  corner.className = "wave-pool-step-number";
  corner.setAttribute("aria-hidden", "true");
  nodes.push(corner);
  for (let step = 0; step < WAVE_POOL_SEQUENCE_LENGTH; step += 1) {
    const number = document.createElement("span");
    number.className = `wave-pool-step-number${step % 4 === 0 ? " is-beat" : ""}`;
    number.textContent = String(step + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    nodes.push(number);
  }
  WAVE_POOL_LANE_IDS.forEach((lane, laneIndex) => {
    const copy = LANE_COPY[lane];
    const label = document.createElement("span");
    label.className = "wave-pool-grid-label";
    label.style.setProperty("--lane", copy.color);
    label.textContent = copy.label;
    label.setAttribute("role", "rowheader");
    nodes.push(label);
    rows[lane].forEach((velocity, step) => {
      const button = document.createElement("button");
      const gridIndex = laneIndex * WAVE_POOL_SEQUENCE_LENGTH + step;
      button.type = "button";
      button.className = "wave-pool-step";
      button.dataset.lane = lane;
      button.dataset.step = String(step);
      button.dataset.gridIndex = String(gridIndex);
      button.style.setProperty("--lane", copy.color);
      button.style.setProperty("--velocity", String(velocity));
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-pressed", String(velocity > 0));
      button.setAttribute("aria-label", `${copy.label}, step ${step + 1}, ${velocity ? `${Math.round(velocity * 100)} percent` : "off"}`);
      button.tabIndex = gridIndex === focusedGridIndex ? 0 : -1;
      button.addEventListener("click", () => setPatternStep(lane, step, nextVelocity(rows[lane][step])));
      button.addEventListener("focus", () => { focusedGridIndex = gridIndex; });
      button.addEventListener("keydown", handleGridKeydown);
      nodes.push(button);
    });
  });
  grid.replaceChildren(...nodes);
  syncPlayhead();
}

function handleGridKeydown(event) {
  const button = event.currentTarget;
  const index = Number(button.dataset.gridIndex);
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % (WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH);
  else if (event.key === "ArrowLeft") next = (index - 1 + WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH) % (WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH);
  else if (event.key === "ArrowDown") next = (index + WAVE_POOL_SEQUENCE_LENGTH) % (WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH);
  else if (event.key === "ArrowUp") next = (index - WAVE_POOL_SEQUENCE_LENGTH + WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH) % (WAVE_POOL_LANE_IDS.length * WAVE_POOL_SEQUENCE_LENGTH);
  else if (event.key === "Home") next = Math.floor(index / WAVE_POOL_SEQUENCE_LENGTH) * WAVE_POOL_SEQUENCE_LENGTH;
  else if (event.key === "End") next = Math.floor(index / WAVE_POOL_SEQUENCE_LENGTH) * WAVE_POOL_SEQUENCE_LENGTH + WAVE_POOL_SEQUENCE_LENGTH - 1;
  else return;
  event.preventDefault();
  focusedGridIndex = next;
  document.querySelectorAll(".wave-pool-step").forEach((cell) => {
    cell.tabIndex = Number(cell.dataset.gridIndex) === next ? 0 : -1;
  });
  document.querySelector(`.wave-pool-step[data-grid-index="${next}"]`)?.focus();
}

function syncSequenceGrid() {
  const rows = patternRows(state);
  document.querySelectorAll(".wave-pool-step").forEach((button) => {
    const lane = button.dataset.lane;
    const step = Number(button.dataset.step);
    const velocity = rows[lane]?.[step] ?? 0;
    button.style.setProperty("--velocity", String(velocity));
    button.setAttribute("aria-pressed", String(velocity > 0));
    button.setAttribute("aria-label", `${LANE_COPY[lane].label}, step ${step + 1}, ${velocity ? `${Math.round(velocity * 100)} percent` : "off"}`);
  });
}

function syncPlayhead() {
  const step = transportPlaying ? Math.trunc(Number(telemetry.stepIndex)) : -1;
  document.querySelectorAll(".wave-pool-step").forEach((button) => {
    button.classList.toggle("is-playhead", Number(button.dataset.step) === step);
  });
}

function clearPattern() {
  const pattern = Object.fromEntries(WAVE_POOL_LANE_IDS.map((lane) => [
    lane,
    Array(WAVE_POOL_SEQUENCE_LENGTH).fill(0),
  ]));
  setState({ ...state, pattern });
  announce("All four water-event lanes cleared.");
}

function mutatePattern() {
  const pattern = patternRows(state);
  WAVE_POOL_LANE_IDS.forEach((lane, laneIndex) => {
    pattern[lane] = pattern[lane].map((velocity, step) => {
      const hash = ((step + 1) * 71 + (laneIndex + 3) * 97 + Math.round(state.tempoBpm) * 13) % 101;
      if (hash < 17) return velocity > 0 ? 0 : [0.55, 0.78, 1][hash % 3];
      return velocity;
    });
  });
  setState({ ...state, pattern });
  announce("The event lanes mutated without draining the pool.");
}

function resizePoolCanvas() {
  const canvas = $("stage");
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const scale = Math.min(bounds.width / 1040, bounds.height / 640);
  poolMetrics = {
    width: bounds.width,
    height: bounds.height,
    pixelRatio,
    scale,
    offsetX: (bounds.width - 1040 * scale) * 0.5,
    offsetY: (bounds.height - 640 * scale) * 0.5,
  };
}

function basinPath(drawing) {
  drawing.beginPath();
  drawing.moveTo(126, 72);
  drawing.lineTo(770, 72);
  drawing.quadraticCurveTo(838, 73, 886, 129);
  drawing.lineTo(952, 210);
  drawing.lineTo(898, 278);
  drawing.lineTo(958, 354);
  drawing.lineTo(867, 502);
  drawing.quadraticCurveTo(838, 554, 765, 560);
  drawing.lineTo(126, 560);
  drawing.closePath();
}

function drawSpiral(drawing, x, y, radius, phase, strength, color) {
  drawing.save();
  drawing.translate(x, y);
  drawing.rotate(phase);
  drawing.beginPath();
  const turns = 2.7;
  for (let point = 0; point <= 80; point += 1) {
    const t = point / 80;
    const angle = t * Math.PI * 2 * turns;
    const r = radius * (1 - t * 0.92);
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r * 0.72;
    if (point === 0) drawing.moveTo(px, py);
    else drawing.lineTo(px, py);
  }
  drawing.strokeStyle = color;
  drawing.globalAlpha = 0.22 + strength * 0.58;
  drawing.lineWidth = 1.4 + strength * 3;
  drawing.shadowBlur = 13;
  drawing.shadowColor = color;
  drawing.stroke();
  drawing.restore();
}

function drawPool(timestamp) {
  const canvas = $("stage");
  const drawing = canvas?.getContext("2d", { alpha: false, desynchronized: true });
  if (!drawing) return;
  const dt = Math.min(0.05, Math.max(0, (timestamp - previousFrameTime) / 1_000));
  previousFrameTime = timestamp;
  visualTime += reduceMotion ? 0 : dt;
  Object.keys(eventFlashes).forEach((key) => { eventFlashes[key] *= Math.exp(-dt * 5.8); });
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 0.045 * dt;
    particle.vx *= Math.exp(-dt * 1.8);
    if (particle.life <= 0) particles.splice(index, 1);
  }

  const { pixelRatio, scale, offsetX, offsetY } = poolMetrics;
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.fillStyle = "#020c12";
  drawing.fillRect(0, 0, poolMetrics.width, poolMetrics.height);
  drawing.save();
  drawing.translate(offsetX, offsetY);
  drawing.scale(scale, scale);

  const waterGradient = drawing.createLinearGradient(120, 70, 940, 560);
  waterGradient.addColorStop(0, "#063b4c");
  waterGradient.addColorStop(0.52, "#07566a");
  waterGradient.addColorStop(1, "#032d3f");
  basinPath(drawing);
  drawing.fillStyle = waterGradient;
  drawing.fill();
  drawing.save();
  basinPath(drawing);
  drawing.clip();

  const surface = clamp(telemetry.surfaceEnergy * 1.8 + eventFlashes.paddle * 0.5);
  const phase = Number(telemetry.generatorPhase) || (visualTime / Math.max(1.5, state.wavePeriodSeconds)) % 1;
  const waveCount = 8;
  for (let wave = 0; wave < waveCount; wave += 1) {
    const progress = ((phase + wave / waveCount) % 1);
    const x = 160 + progress * 700;
    const amplitude = 9 + state.waveHeightM * 14 + surface * 9;
    drawing.beginPath();
    for (let point = 0; point <= 48; point += 1) {
      const y = 91 + point / 48 * 444;
      const wobble = Math.sin(point * 0.7 + visualTime * 1.7 + wave) * amplitude;
      const curve = Math.sin(point / 48 * Math.PI) * state.phaseSpread * 36;
      if (point === 0) drawing.moveTo(x + wobble + curve, y);
      else drawing.lineTo(x + wobble + curve, y);
    }
    drawing.strokeStyle = `rgba(126, 245, 235, ${0.07 + progress * 0.19 + surface * 0.14})`;
    drawing.lineWidth = 1.2 + state.waveHeightM * 1.4;
    drawing.shadowBlur = 7 + surface * 8;
    drawing.shadowColor = "#55e8df";
    drawing.stroke();
  }

  drawing.shadowBlur = 0;
  drawing.globalAlpha = 0.14;
  drawing.strokeStyle = "#a7fbf0";
  drawing.lineWidth = 0.7;
  for (let row = 0; row < 18; row += 1) {
    drawing.beginPath();
    const y = 88 + row * 28;
    drawing.moveTo(132, y);
    for (let x = 132; x < 950; x += 18) {
      drawing.lineTo(x, y + Math.sin(x * 0.035 + row + visualTime * 0.5) * 3);
    }
    drawing.stroke();
  }
  drawing.globalAlpha = 1;

  const vortexStrength = clamp(state.whirlpool * 0.58 + telemetry.vortexStrength * 0.9 + eventFlashes.vortex);
  drawSpiral(drawing, 715, 220, 80, visualTime * 0.54, vortexStrength, "#67f5e8");
  drawSpiral(drawing, 670, 425, 64, -visualTime * 0.71, vortexStrength * 0.82, "#a9ffdd");

  const wallEnergy = clamp(telemetry.wallEnergy * 2 + eventFlashes.wall);
  if (wallEnergy > 0.02) {
    drawing.beginPath();
    for (let point = 0; point <= 24; point += 1) {
      const y = 130 + point * 15.6;
      const x = 882 + Math.sin(point * 1.4 + visualTime * 7) * (5 + wallEnergy * 18);
      if (point === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.strokeStyle = `rgba(239, 255, 251, ${0.18 + wallEnergy * 0.72})`;
    drawing.lineWidth = 2 + wallEnergy * 7;
    drawing.shadowBlur = 16;
    drawing.shadowColor = "#d7ff69";
    drawing.stroke();
  }

  particles.forEach((particle) => {
    const x = 126 + particle.x * 820;
    const y = 72 + particle.y * 488;
    const alpha = clamp(particle.life / particle.maxLife);
    drawing.beginPath();
    drawing.arc(x, y, particle.size * (0.5 + alpha), 0, Math.PI * 2);
    drawing.fillStyle = particle.lane === "wall"
      ? `rgba(213, 177, 255, ${alpha})`
      : `rgba(224, 255, 249, ${alpha * 0.85})`;
    drawing.fill();
  });
  drawing.restore();

  const boundary = entryFor(WAVE_POOL_BOUNDARIES, state.boundaryId);
  const boundaryColor = boundary.color ?? ({ steel: "#c39aff", liner: "#ff8b5c", acrylic: "#72dcff" }[state.boundaryId] ?? "#d7ff69");
  basinPath(drawing);
  drawing.strokeStyle = boundaryColor;
  drawing.globalAlpha = 0.7;
  drawing.lineWidth = 18;
  drawing.lineJoin = "round";
  drawing.stroke();
  drawing.globalAlpha = 1;
  drawing.strokeStyle = "rgba(235, 255, 251, 0.42)";
  drawing.lineWidth = 2;
  drawing.stroke();

  const paddleCount = Math.round(state.paddleCount);
  const paddleFlash = clamp(eventFlashes.paddle + surface);
  for (let paddle = 0; paddle < paddleCount; paddle += 1) {
    const y = 104 + (paddle + 0.5) * (420 / paddleCount);
    const stroke = Math.sin((phase + paddle / paddleCount * state.phaseSpread) * Math.PI * 2) * 7 * state.paddleForce;
    drawing.fillStyle = "#06141c";
    drawing.strokeStyle = paddleFlash > 0.1 ? "#ffb180" : "#58757b";
    drawing.lineWidth = 2;
    drawing.fillRect(82, y - 14, 72 + stroke, 28);
    drawing.strokeRect(82, y - 14, 72 + stroke, 28);
    drawing.fillStyle = `rgba(255, 139, 92, ${0.35 + paddleFlash * 0.65})`;
    drawing.fillRect(148 + stroke, y - 20, 7, 40);
  }

  drawing.fillStyle = "rgba(2, 13, 18, 0.86)";
  drawing.fillRect(28, 82, 47, 468);
  drawing.strokeStyle = "rgba(85, 232, 223, 0.28)";
  drawing.strokeRect(28, 82, 47, 468);
  drawing.fillStyle = "rgba(217, 255, 249, 0.58)";
  drawing.font = "700 9px system-ui, sans-serif";
  drawing.letterSpacing = "1px";
  drawing.save();
  drawing.translate(52, 316);
  drawing.rotate(-Math.PI / 2);
  drawing.textAlign = "center";
  drawing.fillText(state.generatorId === "pneumatic" ? "PNEUMATIC CAISSONS" : "HYDRAULIC PISTONS", 0, 0);
  drawing.restore();

  drawing.fillStyle = "rgba(2, 15, 22, 0.78)";
  drawing.fillRect(795, 590, 205, 27);
  drawing.fillStyle = boundaryColor;
  drawing.font = "700 10px system-ui, sans-serif";
  drawing.textAlign = "right";
  drawing.fillText(`${boundary.label.toUpperCase()} / WET BOUNDARY`, 987, 608);

  const playhead = Math.trunc(Number(telemetry.stepIndex));
  drawing.fillStyle = "rgba(2, 15, 22, 0.75)";
  drawing.fillRect(110, 590, 634, 27);
  for (let step = 0; step < WAVE_POOL_SEQUENCE_LENGTH; step += 1) {
    const x = 126 + step * 38;
    drawing.fillStyle = step === playhead && transportPlaying ? "#d7ff69" : "rgba(130, 215, 219, 0.22)";
    drawing.fillRect(x, 600, step === playhead && transportPlaying ? 22 : 13, 4);
  }

  drawing.restore();
  if ($("meterFill")) $("meterFill").style.width = `${Math.round(clamp(telemetry.peak / 0.72) * 100)}%`;
  animationFrame = requestAnimationFrame(drawPool);
}

function stageEventPosition(event) {
  const bounds = $("stage").getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
    y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
  };
}

function classifyPoolPosition({ x, y }) {
  if (x < 0.22) return "paddle";
  const d1 = Math.hypot(x - 0.69, y - 0.34);
  const d2 = Math.hypot(x - 0.65, y - 0.68);
  if (d1 < 0.14 || d2 < 0.13) return "vortex";
  if (x > 0.82 || y < 0.13 || y > 0.87) return "wall";
  return "breaker";
}

function handleStagePointer(event) {
  event.preventDefault();
  const position = stageEventPosition(event);
  triggerEvent(classifyPoolPosition(position), 0.82, position);
}

function interactiveTarget(target) {
  return target?.closest?.("input, select, textarea, button, a, [contenteditable='true']");
}

function handleKeyboard(event) {
  if (event.defaultPrevented || event.repeat || (interactiveTarget(event.target) && event.target !== $("stage"))) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleTransport();
    return;
  }
  const lane = WAVE_POOL_LANE_IDS.find((id) => event.key === LANE_COPY[id].key || event.code === `Digit${LANE_COPY[id].key}`);
  if (lane) {
    event.preventDefault();
    triggerEvent(lane, 0.86);
  }
}

function bindControls() {
  $("audioButton")?.addEventListener("click", toggleAudio);
  $("playButton")?.addEventListener("click", toggleTransport);
  $("oneWaveButton")?.addEventListener("click", () => triggerEvent("paddle", 0.9));
  $("splashButton")?.addEventListener("click", () => triggerEvent("breaker", 0.86));
  $("slapButton")?.addEventListener("click", () => triggerEvent("wall", 0.84));
  $("vortexButton")?.addEventListener("click", () => triggerEvent("vortex", 0.82));
  $("mutatePatternButton")?.addEventListener("click", mutatePattern);
  $("clearPatternButton")?.addEventListener("click", clearPattern);
  $("resetButton")?.addEventListener("click", () => {
    stopTransport({ announceChange: false });
    graph?.sourceNode?.port.postMessage({ type: "panic" });
    applyPreset("family-surge");
    announce("Wave Pool reset to the water-first Family Surge at thirty percent output.");
  });
  $("presetSelect")?.addEventListener("change", (event) => applyPreset(event.currentTarget.value));
  for (const key of ["generatorId", "boundaryId", "receiverId"]) {
    $(key)?.addEventListener("change", (event) => setState({ ...state, [key]: event.currentTarget.value }));
  }
  for (const [key] of CONTROL_SPECS) {
    $(key)?.addEventListener("input", (event) => setControl(key, event.currentTarget.value));
  }
  $("stage")?.addEventListener("pointerdown", handleStagePointer);
  globalThis.addEventListener("keydown", handleKeyboard);
  globalThis.addEventListener("resize", resizePoolCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    pageActive = document.hidden !== true;
    if (!pageActive) stopTransport({ announceChange: false });
  });
  globalThis.addEventListener("pagehide", () => {
    pageActive = false;
    graph?.sourceNode?.port.postMessage({ type: "panic" });
  });
}

function initialize() {
  buildPresetControls();
  bindControls();
  syncControls();
  syncReadouts();
  buildSequenceGrid();
  syncTransportPresentation();
  setAudioPresentation("off");
  resizePoolCanvas();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(drawPool);
}

initialize();
