import {
  BREATH_INSTRUMENTS,
  MODEL_TIERS,
  RHYTHM_PATTERNS,
  TOPOLOGIES,
  breathCycleFlow,
  breathCycleIntervalMs,
  breathDirectionAllowed,
  clamp,
  instrumentPreset,
  linkedBreathRateBpm,
  mouthFormants,
  rhythmHit,
  rhythmLoopIntervalMs,
  rhythmPattern,
  rhythmStepIntervalMs,
  sanitizeBreathAtlasState,
  sourceNeedsGesture,
  sourceRequiresBreath,
  stateForInstrument,
} from "./src/breath-atlas.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_SPECS = Object.freeze([
  { key: "sourcePitchHz", format: (value) => `${Math.round(value)} Hz` },
  { key: "breathPressure", format: formatPercent },
  { key: "breathRateBpm", format: (value) => `${Math.round(value)} cycles/min` },
  { key: "breathBalance", format: (value) => `${Math.round(value * 100)} / ${Math.round((1 - value) * 100)}` },
  { key: "damping", format: formatPercent },
  { key: "brightness", format: formatPercent },
  { key: "coupling", format: formatPercent },
  { key: "tonguePosition", format: formatPercent, mouth: true },
  { key: "tongueHeight", format: formatPercent, mouth: true },
  { key: "jawOpening", format: formatPercent, mouth: true },
  { key: "lipRounding", format: formatPercent, mouth: true },
  { key: "glottisOpening", format: formatPercent, mouth: true },
  { key: "boreLengthM", format: (value) => `${value.toFixed(2)} m` },
  { key: "gestureForce", format: formatPercent },
  { key: "gestureRateBpm", format: (value) => `${Math.round(value)} BPM` },
  { key: "dryResonance", format: formatPercent },
]);

const SOURCE_NAMES = Object.freeze({
  stringWind: "quill-driven string",
  freeReed: "pressure-controlled reed bank",
  lipReed: "lip valve + bore",
  edgeTone: "air jet + edge",
  mouthBow: "hand-driven string",
  jawReed: "plucked lamella + breath load",
});

const GESTURE_LABELS = Object.freeze({
  pluck: ["Pluck string", "⌁"],
  rub: ["Rub string", "≋"],
  bow: ["Bow string", "↔"],
});

let state = stateForInstrument("lesiba");
let audioContext = null;
let graph = null;
let startingAudio = false;
let manualBreathDirection = 0;
let commandedBreathFlow = 0;
let breathStartedAt = performance.now();
let rhythmStep = 0;
let nextRhythmAt = performance.now();
let gestureReleaseAt = 0;
let gestureIsActive = false;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let pointerDrag = null;
let lastFrameTime = performance.now();
let telemetry = {
  breathFlow: 0,
  gestureEnergy: 0,
  sourceMotion: 0,
  rms: 0,
  peak: 0,
};

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function activePreset() {
  return instrumentPreset(state.instrumentId);
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function audioConfiguration() {
  return { ...state };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
  if (graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.outputLevel, audioContext.currentTime, 0.018);
  }
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL("./src/breath-atlas-processor.js", import.meta.url));
  const sourceNode = new AudioWorkletNode(context, "breath-atlas-physical-model", {
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
  masterGain.gain.value = state.outputLevel;
  compressor.threshold.value = -14;
  compressor.knee.value = 15;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.58;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = (event) => {
    if (event.data?.type === "telemetry") telemetry = { ...telemetry, ...event.data };
  };
  sourceNode.onprocessorerror = () => setAudioPresentation(
    "error",
    "The breath physical model stopped unexpectedly. Reload the page to reset it.",
  );
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
      setAudioPresentation("error", error?.message || "Unable to start Breath Atlas audio.");
      startingAudio = false;
      return false;
    }
    startingAudio = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    postConfiguration();
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation("error", error?.message || "Unable to resume audio.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    await audioContext.suspend();
    setAudioPresentation("off");
    return;
  }
  await ensureAudio();
}

function sendBreath(flow) {
  const preset = activePreset();
  let next = clamp(flow, -1, 1);
  if (!breathDirectionAllowed(preset, next)) next = 0;
  if (Math.abs(next - commandedBreathFlow) < 0.005) return;
  commandedBreathFlow = next;
  graph?.sourceNode?.port.postMessage({ type: "breath", flow: next });
}

function effectiveBreathRate() {
  const preset = activePreset();
  return state.breathLinked && sourceNeedsGesture(preset) ? linkedBreathRateBpm(state) : state.breathRateBpm;
}

function breathFlowAt(time = performance.now()) {
  if (manualBreathDirection) return manualBreathDirection * state.breathPressure;
  if (!state.autoBreath) return 0;
  const interval = state.breathLinked && sourceNeedsGesture(activePreset())
    ? rhythmLoopIntervalMs(state) / state.breathSyncRatio
    : breathCycleIntervalMs(state.breathRateBpm);
  const linked = state.breathLinked && sourceNeedsGesture(activePreset());
  const phase = ((time - breathStartedAt) / Math.max(1, interval) + (linked ? state.breathBalance * 0.5 : 0)) % 1;
  return breathCycleFlow({ ...state, breathRateBpm: effectiveBreathRate() }, phase);
}

async function beginManualBreath(direction) {
  const preset = activePreset();
  if (!breathDirectionAllowed(preset, direction)) return;
  await ensureAudio();
  manualBreathDirection = direction < 0 ? -1 : 1;
  sendBreath(manualBreathDirection * state.breathPressure);
  updateBreathPresentation(commandedBreathFlow);
}

function endManualBreath(direction) {
  if (Math.sign(direction) !== manualBreathDirection) return;
  manualBreathDirection = 0;
  sendBreath(breathFlowAt());
}

async function beginGesture(force = state.gestureForce, { automatic = false } = {}) {
  const preset = activePreset();
  if (!sourceNeedsGesture(preset)) return;
  if (!automatic && !(await ensureAudio())) return;
  gestureIsActive = true;
  const gestureForce = clamp(force, 0.05, 1);
  graph?.sourceNode?.port.postMessage({ type: "gesture", active: true, force: gestureForce });
  graph?.sourceNode?.port.postMessage({ type: "excite", force: gestureForce });
  $("gestureButton").setAttribute("aria-pressed", "true");
  if (!automatic) announce(`${GESTURE_LABELS[preset.gesture]?.[0] ?? "Excite source"} ${Math.round(gestureForce * 100)} percent`);
}

function endGesture() {
  if (!gestureIsActive) return;
  gestureIsActive = false;
  gestureReleaseAt = 0;
  graph?.sourceNode?.port.postMessage({ type: "gesture", active: false, force: state.gestureForce });
  $("gestureButton").setAttribute("aria-pressed", "false");
}

function resetCoupledClock(time = performance.now()) {
  rhythmStep = 0;
  nextRhythmAt = time;
  breathStartedAt = time;
}

function loadInstrument(id) {
  const preset = instrumentPreset(id);
  const preserved = {
    outputLevel: state.outputLevel,
    breathPressure: state.breathPressure,
    breathRateBpm: state.breathRateBpm,
    breathBalance: state.breathBalance,
    gestureRateBpm: state.gestureRateBpm,
    breathSyncRatio: state.breathSyncRatio,
    breathLinked: state.breathLinked,
    rhythmId: state.rhythmId,
    autoBreath: state.autoBreath,
    autoGesture: state.autoGesture,
    dryResonance: state.dryResonance,
  };
  state = stateForInstrument(preset.id, preserved);
  manualBreathDirection = 0;
  commandedBreathFlow = 0;
  endGesture();
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  resetCoupledClock();
  postConfiguration();
  updatePresentation();
  announce(`${preset.label}. ${MODEL_TIERS[preset.tier].label}. ${preset.description}`);
}

function setControl(key, value, { announceChange = false } = {}) {
  state = sanitizeBreathAtlasState({ ...state, [key]: value }, state);
  if (["gestureRateBpm", "breathSyncRatio", "breathBalance"].includes(key)) resetCoupledClock();
  postConfiguration();
  updatePresentation();
  if (announceChange) announce(`${key} ${CONTROL_SPECS.find((spec) => spec.key === key)?.format(state[key]) ?? state[key]}`);
}

function toggleAutoBreath() {
  state = sanitizeBreathAtlasState({ ...state, autoBreath: !state.autoBreath }, state);
  breathStartedAt = performance.now();
  if (!state.autoBreath && !manualBreathDirection) sendBreath(0);
  updatePresentation();
  announce(`Automatic breath ${state.autoBreath ? "on" : "off"}`);
}

function toggleAutoGesture() {
  state = sanitizeBreathAtlasState({ ...state, autoGesture: !state.autoGesture }, state);
  resetCoupledClock();
  if (!state.autoGesture) endGesture();
  updatePresentation();
  announce(`Rhythmic hand ${state.autoGesture ? "on" : "off"}`);
}

function toggleBreathLink() {
  state = sanitizeBreathAtlasState({ ...state, breathLinked: !state.breathLinked }, state);
  resetCoupledClock();
  updatePresentation();
  announce(`Breath and hand clocks ${state.breathLinked ? "linked" : "independent"}`);
}

function updateBreathPresentation(flow = telemetry.breathFlow ?? commandedBreathFlow) {
  const amount = Math.abs(flow);
  const preset = activePreset();
  const direction = amount < 0.018 ? "rest" : flow < 0 ? "inhale" : "exhale";
  const suffix = sourceRequiresBreath(preset) && amount < 0.018
    ? " — source silent"
    : sourceNeedsGesture(preset) && amount < 0.018
      ? " — dry / very soft"
      : ` ${Math.round(amount * 100)}%`;
  $("breathReadout").textContent = `${direction}${suffix}`;
  $("inhaleButton").setAttribute("aria-pressed", String(manualBreathDirection < 0));
  $("exhaleButton").setAttribute("aria-pressed", String(manualBreathDirection > 0));
  $("breathSummary").textContent = `${preset.breathMode === "both" ? "signed" : preset.breathMode === "out" ? "outward" : "resonator load"} · ${Math.round(state.breathPressure * 100)}%`;
  const meterSegments = [...$("breathMeter").querySelectorAll("i")];
  const activeCount = Math.ceil(amount * 4);
  meterSegments.forEach((segment, index) => {
    const on = flow < 0 ? index < 4 && index >= 4 - activeCount : index >= 4 && index < 4 + activeCount;
    segment.classList.toggle("is-active", on);
  });
  $("breathMeter").querySelector("b").textContent = amount < 0.018 ? "0" : flow < 0 ? "←" : "→";
}

function updatePresentation() {
  const preset = activePreset();
  const topology = TOPOLOGIES[preset.topology];
  const evidence = MODEL_TIERS[preset.tier];
  $("instrumentSelect").value = preset.id;
  $("instrumentDescription").textContent = preset.description;
  $("modelNote").textContent = preset.modelNote;
  $("modelSource").href = preset.sourceUrl;
  $("modelSource").textContent = `${preset.sourceLabel} ↗`;
  $("regionBadge").textContent = preset.region.toUpperCase();
  $("topologyBadge").textContent = topology.label.toUpperCase();
  $("evidenceBadge").textContent = evidence.short;
  $("evidenceBadge").dataset.tier = preset.tier;
  $("headingPath").textContent = preset.path.join(" → ");
  $("sourceReadout").textContent = SOURCE_NAMES[preset.topology];
  $("sourceSummary").textContent = `${Math.round(state.sourcePitchHz)} Hz · ${state.boreLengthM.toFixed(2)} m`;
  const formants = mouthFormants(state).frequenciesHz;
  $("formantReadout").textContent = `${Math.round(formants[0])} · ${Math.round(formants[1])} Hz`;
  $("mouthSummary").textContent = `${state.jawOpening > 0.56 ? "open" : "closed"} · F1 ${Math.round(formants[0])} Hz`;

  const needsGesture = sourceNeedsGesture(preset);
  $("gestureButton").hidden = !needsGesture;
  $("autoGestureButton").hidden = !needsGesture;
  $("rhythmSection").hidden = !needsGesture;
  if (needsGesture) {
    const [label, glyph] = GESTURE_LABELS[preset.gesture] ?? ["Excite source", "⌁"];
    $("gestureLabel").textContent = label;
    $("gestureGlyph").textContent = glyph;
    $("gestureHint").textContent = preset.gesture === "pluck"
      ? "press or Space · dry pluck is deliberately soft"
      : "hold or Space · breath changes resonance";
  }
  const inhaleAllowed = breathDirectionAllowed(preset, -1);
  $("inhaleButton").disabled = !inhaleAllowed;
  $("inhaleHint").textContent = inhaleAllowed ? "hold · inward pressure" : "not a sounding drive";
  $("exhaleHint").textContent = "hold · outward pressure";

  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    const output = $(`${specification.key}Out`);
    if (!input || !output) continue;
    input.value = String(state[specification.key]);
    output.value = specification.format(state[specification.key]);
    updateRangeFill(input);
  }
  $("outputLevel").value = String(state.outputLevel);
  $("outputLevelOut").value = formatPercent(state.outputLevel);
  updateRangeFill($("outputLevel"));
  $("rhythmSelect").value = state.rhythmId;
  $("breathSyncRatio").value = String(state.breathSyncRatio);
  const pattern = rhythmPattern(state.rhythmId);
  $("rhythmDescription").textContent = pattern.description;
  $("autoGestureButton").setAttribute("aria-pressed", String(state.autoGesture));
  $("autoGestureState").textContent = `${pattern.label.toLowerCase()} · ${state.autoGesture ? "playing" : "stopped"}`;
  $("autoBreathButton").setAttribute("aria-pressed", String(state.autoBreath));
  $("autoBreathState").textContent = `${Math.round(effectiveBreathRate())} cycles/min · ${preset.breathMode === "out" ? "outward only" : "inhale + exhale"}`;
  $("breathLinkButton").setAttribute("aria-pressed", String(state.breathLinked));
  $("breathLinkState").textContent = state.breathLinked ? "linked · phase resets with loop" : "independent breath clock";
  const ratioLabel = state.breathSyncRatio === 0.5 ? "1 breath / 2 loops" : `${state.breathSyncRatio} breath${state.breathSyncRatio === 1 ? "" : "s"} / loop`;
  $("rhythmSummary").textContent = state.breathLinked ? ratioLabel : "independent clocks";
  updateBreathPresentation(telemetry.breathFlow ?? commandedBreathFlow);
}

function buildSelectors() {
  const tierOrder = ["measured", "established", "comparative"];
  $("instrumentSelect").replaceChildren(...tierOrder.map((tier) => {
    const group = document.createElement("optgroup");
    group.label = MODEL_TIERS[tier].label;
    group.replaceChildren(...BREATH_INSTRUMENTS.filter((preset) => preset.tier === tier).map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.label} · ${preset.region}`;
      return option;
    }));
    return group;
  }));
  $("rhythmSelect").replaceChildren(...RHYTHM_PATTERNS.map((pattern) => {
    const option = document.createElement("option");
    option.value = pattern.id;
    option.textContent = `${pattern.label} · ${pattern.steps.map((value) => value ? "●" : "·").join("")}`;
    return option;
  }));
}

function installHoldButton(id, begin, end) {
  const button = $(id);
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    begin();
  });
  const release = (event) => {
    if (event.pointerId !== undefined && button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture?.(event.pointerId);
    end();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      begin();
    }
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      end();
    }
  });
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("instrumentSelect").addEventListener("change", (event) => loadInstrument(event.currentTarget.value));
  $("autoBreathButton").addEventListener("click", toggleAutoBreath);
  $("autoGestureButton").addEventListener("click", toggleAutoGesture);
  $("breathLinkButton").addEventListener("click", toggleBreathLink);
  $("rhythmSelect").addEventListener("change", (event) => {
    state = sanitizeBreathAtlasState({ ...state, rhythmId: event.currentTarget.value }, state);
    resetCoupledClock();
    updatePresentation();
  });
  $("breathSyncRatio").addEventListener("change", (event) => setControl("breathSyncRatio", Number(event.currentTarget.value), { announceChange: true }));
  installHoldButton("inhaleButton", () => beginManualBreath(-1), () => endManualBreath(-1));
  installHoldButton("exhaleButton", () => beginManualBreath(1), () => endManualBreath(1));
  installHoldButton("gestureButton", () => beginGesture(), endGesture);
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    if (!input) continue;
    input.addEventListener("input", () => setControl(specification.key, Number(input.value)));
    input.addEventListener("change", () => setControl(specification.key, Number(input.value), { announceChange: true }));
  }
  $("outputLevel").addEventListener("input", (event) => {
    state = sanitizeBreathAtlasState({ ...state, outputLevel: Number(event.currentTarget.value) }, state);
    postConfiguration();
    updatePresentation();
  });
}

function installKeyboard() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
    if ((event.key === " " || event.key === "Enter") && !event.repeat && sourceNeedsGesture(activePreset())) {
      event.preventDefault();
      beginGesture();
    } else if (event.key === "[" && !event.repeat) beginManualBreath(-1);
    else if (event.key === "]" && !event.repeat) beginManualBreath(1);
    else if (event.key.toLowerCase() === "r" && !event.repeat && sourceNeedsGesture(activePreset())) toggleAutoGesture();
    else if (event.key === "Escape") {
      state = sanitizeBreathAtlasState({ ...state, autoGesture: false, autoBreath: false }, state);
      manualBreathDirection = 0;
      endGesture();
      sendBreath(0);
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      updatePresentation();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") endGesture();
    if (event.key === "[") endManualBreath(-1);
    if (event.key === "]") endManualBreath(1);
  });
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function stroke(color, width = 1, alpha = 1) {
  drawing.strokeStyle = color;
  drawing.lineWidth = width;
  drawing.globalAlpha = alpha;
  drawing.stroke();
  drawing.globalAlpha = 1;
}

function layout() {
  const compact = cssWidth < 660;
  const centerY = compact ? cssHeight * 0.55 : cssHeight * 0.53;
  const sourceX = compact ? cssWidth * 0.16 : cssWidth * 0.14;
  const valveX = compact ? cssWidth * 0.36 : cssWidth * 0.35;
  const mouthX = compact ? cssWidth * 0.66 : cssWidth * 0.68;
  const outputX = compact ? cssWidth * 0.89 : cssWidth * 0.9;
  return { compact, centerY, sourceX, valveX, mouthX, outputX };
}

function drawAirflow(model, flow) {
  const amount = Math.abs(flow);
  if (amount < 0.015) return;
  const outward = flow > 0;
  const from = outward ? model.sourceX - 45 : model.outputX + 15;
  const to = outward ? model.outputX + 20 : model.sourceX - 50;
  const color = outward ? "#efaa61" : "#74e0d1";
  const time = performance.now() * (0.0004 + amount * 0.002);
  for (let index = 0; index < 13; index += 1) {
    const phase = (time + index / 13) % 1;
    const x = from + (to - from) * phase;
    const y = model.centerY + Math.sin(index * 1.7 + time * 8) * (5 + amount * 8);
    drawing.beginPath();
    drawing.moveTo(x - Math.sign(to - from) * 6, y);
    drawing.lineTo(x + Math.sign(to - from) * 6, y);
    stroke(color, 1.2, 0.15 + amount * 0.5);
  }
}

function drawSource(model, preset, motion) {
  const x = model.valveX;
  const y = model.centerY;
  drawing.save();
  drawing.lineCap = "round";
  if (preset.topology === "stringWind" || preset.topology === "mouthBow") {
    drawing.beginPath();
    drawing.moveTo(model.sourceX - 48, y + 82);
    drawing.quadraticCurveTo(model.sourceX - 90, y, model.sourceX - 48, y - 82);
    stroke("#efaa61", 3, 0.68);
    drawing.beginPath();
    drawing.moveTo(model.sourceX - 48, y - 82);
    drawing.quadraticCurveTo(model.sourceX + motion * 18, y, model.sourceX - 48, y + 82);
    stroke("#e8e7dc", 1.4, 0.86);
    if (preset.topology === "stringWind") {
      drawing.beginPath();
      drawing.moveTo(model.sourceX - 5, y);
      drawing.lineTo(x - 20, y + motion * 18);
      stroke("#b8a0ef", 4, 0.76);
    }
  } else if (preset.topology === "freeReed" || preset.topology === "jawReed") {
    drawing.strokeStyle = "rgba(239,170,97,.55)";
    drawing.lineWidth = 2;
    drawing.strokeRect(x - 46, y - 29, 92, 58);
    drawing.beginPath();
    drawing.moveTo(x - 35, y);
    drawing.quadraticCurveTo(x + motion * 28, y - motion * 38, x + 37, y);
    stroke("#e8e7dc", 2, 0.9);
    if (preset.topology === "freeReed") {
      for (let index = 0; index < Math.min(8, preset.ratios.length); index += 1) {
        const pipeX = x - 42 + index * 12;
        const height = 55 + preset.ratios[index] * 12;
        drawing.beginPath();
        drawing.moveTo(pipeX, y - 34);
        drawing.lineTo(pipeX, y - 34 - height);
        stroke(index % 2 ? "#74e0d1" : "#efaa61", 4, 0.38);
      }
    }
  } else if (preset.topology === "lipReed") {
    drawing.beginPath();
    drawing.moveTo(x - 44, y - 9);
    drawing.quadraticCurveTo(x - 4, y - 22 - motion * 12, x + 30, y - 4);
    drawing.moveTo(x - 44, y + 9);
    drawing.quadraticCurveTo(x - 4, y + 22 + motion * 12, x + 30, y + 4);
    stroke("#ee796e", 5, 0.74);
    drawing.beginPath();
    drawing.moveTo(x + 31, y);
    drawing.lineTo(model.mouthX + 30, y);
    stroke("#efaa61", 22, 0.15);
    stroke("#efaa61", 1.2, 0.72);
  } else {
    drawing.beginPath();
    drawing.moveTo(x - 58, y - 26);
    drawing.lineTo(x - 5, y);
    drawing.lineTo(x + 32, y - 42);
    stroke("#74e0d1", 1.5, 0.8);
    drawing.beginPath();
    drawing.arc(x - 4, y, 8, 0, Math.PI * 2);
    stroke("#efaa61", 2, 0.8);
  }
  drawing.fillStyle = "rgba(232,231,220,.76)";
  drawing.font = "600 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(TOPOLOGIES[preset.topology].label.toUpperCase(), x, y + 116);
  drawing.restore();
}

function drawMouth(model, formants) {
  const x = model.mouthX;
  const y = model.centerY;
  const jawGap = 34 + state.jawOpening * 62;
  const lipReach = state.lipRounding * 20;
  const tongueX = x - 48 + state.tonguePosition * 76;
  const tongueY = y + jawGap * 0.36 - state.tongueHeight * 55;
  drawing.beginPath();
  drawing.moveTo(x - 95, y + jawGap * 0.95);
  drawing.bezierCurveTo(x - 125, y + 20, x - 118, y - 82, x - 48, y - 105);
  drawing.bezierCurveTo(x + 45, y - 130, x + 88, y - 56, x + 70 + lipReach, y - 9);
  drawing.bezierCurveTo(x + 91 + lipReach, y, x + 91 + lipReach, y + 16, x + 69 + lipReach, y + 19);
  drawing.bezierCurveTo(x + 69, y + 70, x + 10, y + jawGap + 82, x - 95, y + jawGap * 0.95);
  stroke("#727a74", 1.2, 0.72);
  drawing.beginPath();
  drawing.moveTo(x - 79, y + 11);
  drawing.bezierCurveTo(x - 25, y - 35, x + 35, y - 27, x + 69 + lipReach, y - 7);
  drawing.bezierCurveTo(x + 32, y + 19, x - 18, y + jawGap * 0.62, x - 79, y + 11);
  drawing.closePath();
  drawing.fillStyle = "rgba(116,224,209,.055)";
  drawing.fill();
  stroke("#74e0d1", 1.2, 0.66);
  drawing.beginPath();
  drawing.moveTo(x - 67, y + jawGap * 0.57);
  drawing.bezierCurveTo(tongueX - 42, tongueY + 13, tongueX - 20, tongueY, tongueX, tongueY);
  drawing.bezierCurveTo(tongueX + 42, tongueY, x + 24, y + jawGap * 0.62, x + 58, y + 21);
  stroke("#b8a0ef", 4, 0.64);

  const points = [
    { type: "tongue", x: tongueX, y: tongueY, color: "#b8a0ef", label: "TONGUE" },
    { type: "jaw", x: x + 8, y: y + jawGap + 64, color: "#ee796e", label: "JAW" },
    { type: "lips", x: x + 74 + lipReach, y: y + 6, color: "#74e0d1", label: "LIPS" },
  ];
  handles = [];
  for (const point of points) {
    drawing.beginPath();
    drawing.arc(point.x, point.y, 6, 0, Math.PI * 2);
    drawing.fillStyle = "#050706";
    drawing.fill();
    stroke(point.color, 1.5, 0.95);
    drawing.fillStyle = point.color;
    drawing.font = "600 6px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.textAlign = "center";
    drawing.fillText(point.label, point.x, point.y - 11);
    handles.push({ ...point, radius: 17 });
  }
  drawing.fillStyle = "rgba(116,224,209,.68)";
  drawing.textAlign = "center";
  drawing.font = "7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.fillText(`F1 ${Math.round(formants[0])}  ·  F2 ${Math.round(formants[1])}  ·  F3 ${Math.round(formants[2])}`, x - 4, y - 126);
}

function drawSignalPath(model, preset) {
  const y = model.centerY;
  const nodes = [model.sourceX - 70, model.valveX, model.mouthX, model.outputX];
  const labels = preset.path;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    drawing.beginPath();
    drawing.moveTo(nodes[index] + 30, y + 144);
    drawing.lineTo(nodes[index + 1] - 30, y + 144);
    stroke("#5a625c", 1, 0.4);
  }
  nodes.forEach((x, index) => {
    drawing.beginPath();
    drawing.arc(x, y + 144, 3, 0, Math.PI * 2);
    drawing.fillStyle = index === 0 ? "#efaa61" : index === 2 ? "#74e0d1" : "#8a918c";
    drawing.fill();
    drawing.font = "6px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.textAlign = "center";
    drawing.fillStyle = "rgba(232,231,220,.58)";
    drawing.fillText((labels[index] ?? "radiation").toUpperCase(), x, y + 160);
  });
}

function drawRhythm(model) {
  if (!sourceNeedsGesture(activePreset()) || model.compact) return;
  const pattern = rhythmPattern(state.rhythmId);
  const left = Math.max(28, cssWidth * 0.07);
  const baseline = cssHeight - 54;
  const width = Math.min(330, cssWidth * 0.38);
  drawing.fillStyle = "rgba(138,145,140,.65)";
  drawing.font = "6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText(`HAND LOOP · ${pattern.label.toUpperCase()} · BREATH ${state.breathLinked ? `${state.breathSyncRatio}×` : "FREE"}`, left, baseline - 27);
  pattern.steps.forEach((velocity, index) => {
    const x = left + index / Math.max(1, pattern.steps.length - 1) * width;
    const current = index === rhythmStep % pattern.steps.length;
    drawing.beginPath();
    drawing.arc(x, baseline, 3 + velocity * 5, 0, Math.PI * 2);
    drawing.fillStyle = current ? "#74e0d1" : velocity ? `rgba(184,160,239,${0.25 + velocity * 0.6})` : "rgba(138,145,140,.18)";
    drawing.fill();
  });
}

function drawStage() {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.fillStyle = "#050706";
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  drawing.strokeStyle = "rgba(116,224,209,.035)";
  drawing.lineWidth = 1;
  for (let x = 0; x < cssWidth; x += 36) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, cssHeight); drawing.stroke();
  }
  for (let y = 0; y < cssHeight; y += 36) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(cssWidth, y); drawing.stroke();
  }
  const model = layout();
  const preset = activePreset();
  const formants = mouthFormants(state).frequenciesHz;
  drawAirflow(model, telemetry.breathFlow ?? commandedBreathFlow);
  drawSource(model, preset, telemetry.sourceMotion ?? 0);
  drawMouth(model, formants);
  if (!model.compact) drawSignalPath(model, preset);
  drawRhythm(model);
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function updateMouthFromPointer(type, point) {
  const model = layout();
  if (type === "tongue") {
    const position = clamp((point.x - (model.mouthX - 70)) / 115);
    const height = clamp((model.centerY + 40 - point.y) / 92);
    state = sanitizeBreathAtlasState({ ...state, tonguePosition: position, tongueHeight: height }, state);
  } else if (type === "jaw") {
    const opening = clamp((point.y - model.centerY - 52) / 96);
    state = sanitizeBreathAtlasState({ ...state, jawOpening: opening }, state);
  } else if (type === "lips") {
    const rounding = clamp((point.x - model.mouthX - 70) / 28);
    state = sanitizeBreathAtlasState({ ...state, lipRounding: rounding }, state);
  }
  postConfiguration();
  updatePresentation();
}

function installCanvasInteractions() {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const point = canvasPoint(event);
    const handle = handles.find((candidate) => Math.hypot(point.x - candidate.x, point.y - candidate.y) <= candidate.radius);
    if (!handle) {
      if (sourceNeedsGesture(activePreset())) beginGesture();
      return;
    }
    event.preventDefault();
    pointerDrag = { type: handle.type, pointerId: event.pointerId };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    updateMouthFromPointer(handle.type, point);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateMouthFromPointer(pointerDrag.type, canvasPoint(event));
  });
  const finish = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
      if (sourceNeedsGesture(activePreset())) endGesture();
      return;
    }
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
}

function runRhythm(time) {
  const preset = activePreset();
  if (!sourceNeedsGesture(preset) || !state.autoGesture || !graph || audioContext?.state !== "running") return;
  const stepDuration = rhythmStepIntervalMs(state.gestureRateBpm);
  if (time >= nextRhythmAt) {
    const hit = rhythmHit(state, rhythmStep);
    if (hit.index === 0 && state.breathLinked) breathStartedAt = time;
    if (hit.active) {
      beginGesture(state.gestureForce * hit.velocity, { automatic: true });
      gestureReleaseAt = time + Math.min(stepDuration * 0.56, preset.gesture === "pluck" ? 70 : 190);
    }
    rhythmStep += 1;
    nextRhythmAt = time + stepDuration;
  }
  if (gestureIsActive && gestureReleaseAt && time >= gestureReleaseAt) endGesture();
}

function tick(time) {
  const elapsed = Math.min(100, time - lastFrameTime);
  lastFrameTime = time;
  runRhythm(time);
  const flow = breathFlowAt(time);
  if (graph && audioContext?.state === "running") sendBreath(flow);
  updateBreathPresentation(telemetry.breathFlow ?? flow);
  drawStage(elapsed);
  requestAnimationFrame(tick);
}

buildSelectors();
installControls();
installKeyboard();
installCanvasInteractions();
updatePresentation();
resizeCanvas();
globalThis.addEventListener("resize", resizeCanvas);
requestAnimationFrame(tick);
