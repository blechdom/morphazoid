import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_PRESETS,
  VOWEL_PRESETS,
  applyVowel,
  clamp,
  dominantHarmonic,
  jawHarpPreset,
  jawHarpState,
  mouthFormants,
  mouthGeometry,
  randomizeJawHarpState,
  repeatIntervalMs,
  sanitizeJawHarpState,
} from "./src/jaw-harp.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_SPECS = Object.freeze([
  { key: "reedFrequencyHz", format: (value) => `${Math.round(value)} Hz` },
  { key: "reedDecaySeconds", format: (value) => `${value.toFixed(1)} s` },
  { key: "reedStiffness", format: formatPercent },
  { key: "pluckPosition", format: formatPercent },
  { key: "pluckForce", format: formatPercent },
  { key: "tonguePosition", format: (value) => `${Math.round(value * 100)}% front`, mouth: true },
  { key: "tongueHeight", format: formatPercent, mouth: true },
  { key: "jawOpening", format: formatPercent, mouth: true },
  { key: "lipRounding", format: formatPercent, mouth: true },
  { key: "formantFocus", format: formatPercent, mouth: true },
  { key: "cavityCoupling", format: formatPercent },
  { key: "frameCoupling", format: formatPercent },
  { key: "glottisOpening", format: formatPercent, mouth: true },
  { key: "breath", format: formatPercent },
  { key: "repeatRateBpm", format: (value) => `${Math.round(value)} BPM` },
  { key: "repeatSwing", format: (value) => `${Math.round(value * 100)}%` },
]);

let state = jawHarpState("khomus");
let activeVowelId = "a";
let audioContext = null;
let graph = null;
let startingAudio = false;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let pointerDrag = null;
let animationFrame = 0;
let lastPluckAt = -Infinity;
let pluckFlash = 0;
let repeatStep = 0;
let nextRepeatAt = 0;
let waveform = new Float32Array(1024);
let telemetry = {
  displacement: 0,
  energy: 0,
  peak: 0,
  rms: 0,
  formants: mouthFormants(state).frequenciesHz,
  ...dominantHarmonic(state),
};

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  return frequency >= 1000 ? `${(frequency / 1000).toFixed(2)} kHz` : `${Math.round(frequency)} Hz`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
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
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioButton").disabled = status === "starting";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function audioConfiguration() {
  return { ...state };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL("./src/jaw-harp-processor.js", import.meta.url));
  const sourceNode = new AudioWorkletNode(context, "jaw-harp-physical-model", {
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
  masterGain.gain.value = state.level;
  compressor.threshold.value = -13;
  compressor.knee.value = 14;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.56;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = (event) => {
    if (event.data?.type === "telemetry") telemetry = { ...telemetry, ...event.data };
  };
  sourceNode.onprocessorerror = () => setAudioPresentation(
    "error",
    "The jaw-harp physical model stopped unexpectedly. Reload the page to reset it.",
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
      setAudioPresentation("error", error?.message || "Unable to start jaw-harp audio.");
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
    setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    state = sanitizeJawHarpState({ ...state, repeat: false }, state);
    updateTransportPresentation();
    graph.sourceNode.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    setAudioPresentation("off");
    return;
  }
  await ensureAudio();
}

async function pluck({ force = state.pluckForce, direction = state.pluckDirection, position = state.pluckPosition, automatic = false } = {}) {
  if (!(await ensureAudio())) return false;
  const strength = clamp(force, 0.04, 1);
  graph.sourceNode.port.postMessage({ type: "pluck", force: strength, direction, position });
  lastPluckAt = performance.now();
  pluckFlash = 1;
  $("pluckButton").classList.add("is-plucked");
  setTimeout(() => $("pluckButton").classList.remove("is-plucked"), 90);
  if (!automatic) announce(`${jawHarpPreset(state.presetId).label} plucked ${direction < 0 ? "inward" : "outward"}`);
  return true;
}

function updateTransportPresentation() {
  $("repeatButton").setAttribute("aria-pressed", String(state.repeat));
  $("repeatState").textContent = state.repeat ? `${Math.round(state.repeatRateBpm)} BPM` : "off";
}

async function toggleRepeat() {
  const next = !state.repeat;
  if (next && !(await ensureAudio())) return;
  state = sanitizeJawHarpState({ ...state, repeat: next }, state);
  repeatStep = 0;
  nextRepeatAt = performance.now();
  updateTransportPresentation();
  announce(`Jaw-harp repeat ${next ? "on" : "off"}`);
}

function setDirection(direction) {
  state = sanitizeJawHarpState({ ...state, pluckDirection: direction }, state);
  $("pluckOutward").setAttribute("aria-pressed", String(state.pluckDirection > 0));
  $("pluckInward").setAttribute("aria-pressed", String(state.pluckDirection < 0));
  postConfiguration();
}

function setControl(key, value, { mouth = false, announceChange = false } = {}) {
  state = sanitizeJawHarpState({ ...state, [key]: value }, state);
  if (mouth) activeVowelId = null;
  updatePresentation();
  if (key === "level" && graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
  } else postConfiguration();
  if (announceChange) announce(`${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()} changed`);
}

function loadHarp(presetId) {
  const retained = {
    tonguePosition: state.tonguePosition,
    tongueHeight: state.tongueHeight,
    jawOpening: state.jawOpening,
    lipRounding: state.lipRounding,
    glottisOpening: state.glottisOpening,
    cavityCoupling: state.cavityCoupling,
    breath: state.breath,
    formantFocus: state.formantFocus,
    repeatRateBpm: state.repeatRateBpm,
    repeatSwing: state.repeatSwing,
    repeat: state.repeat,
    level: state.level,
    pluckDirection: state.pluckDirection,
    vowelId: state.vowelId,
  };
  state = jawHarpState(presetId, retained);
  updatePresentation();
  postConfiguration();
  announce(`${jawHarpPreset(presetId).label} physical body loaded`);
}

function loadVowel(vowelId) {
  state = applyVowel(state, vowelId);
  activeVowelId = vowelId;
  updatePresentation();
  postConfiguration();
  announce(`${VOWEL_PRESETS.find(({ id }) => id === vowelId)?.phoneme ?? vowelId} mouth shape loaded`);
}

function randomizeModel() {
  state = randomizeJawHarpState(state);
  activeVowelId = null;
  updatePresentation();
  postConfiguration();
  announce("Jaw-harp reed, mouth, coupling, and rhythm randomized");
}

function updatePresentation() {
  const preset = jawHarpPreset(state.presetId);
  const geometry = mouthGeometry(state);
  const formants = mouthFormants(state);
  const harmonic = dominantHarmonic(state);
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    if (!input) continue;
    input.value = String(state[specification.key]);
    $(`${specification.key}Out`).textContent = specification.format(state[specification.key]);
    updateRangeFill(input);
  }
  $("level").value = String(state.level);
  $("levelOut").textContent = formatPercent(state.level);
  updateRangeFill($("level"));
  $("harpSelect").value = state.presetId;
  $("harpDescription").textContent = preset.description;
  for (const button of $("vowelButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.vowel === activeVowelId));
  }
  $("reedReadout").textContent = formatFrequency(state.reedFrequencyHz);
  $("harmonicReadout").textContent = `${harmonic.index} × · ${formatFrequency(harmonic.frequencyHz)}`;
  $("cavityReadout").textContent = `${(geometry.lengthM * 100).toFixed(1)} cm · ${Math.round(geometry.volumeMl)} ml`;
  $("reedSummary").textContent = `${Math.round(state.reedFrequencyHz)} Hz · ${preset.family}`;
  $("mouthSummary").textContent = `${activeVowelId ? VOWEL_PRESETS.find(({ id }) => id === activeVowelId)?.phoneme : "custom"} · ${(geometry.lengthM * 100).toFixed(1)} cm cavity`;
  $("couplingSummary").textContent = `${formatPercent(state.cavityCoupling)} mouth · ${formatPercent(state.frameCoupling)} frame`;
  $("rhythmSummary").textContent = `${Math.round(state.repeatRateBpm)} BPM · ${formatPercent(state.repeatSwing)} swing`;
  $("motionReadout").textContent = telemetry.rms > 0.0004 ? `${Math.round(clamp(telemetry.energy) * 100)}% energy` : "resting";
  $("pluckOutward").setAttribute("aria-pressed", String(state.pluckDirection > 0));
  $("pluckInward").setAttribute("aria-pressed", String(state.pluckDirection < 0));
  updateTransportPresentation();
  telemetry.formants = telemetry.formants ?? formants.frequenciesHz;
}

function buildPresets() {
  $("harpSelect").replaceChildren(...JAW_HARP_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} · ${preset.family}`;
    return option;
  }));
  $("vowelButtons").replaceChildren(...VOWEL_PRESETS.map((vowel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.vowel = vowel.id;
    button.innerHTML = `${vowel.label}<small>${vowel.phoneme}</small>`;
    button.setAttribute("aria-pressed", String(vowel.id === activeVowelId));
    button.addEventListener("click", () => loadVowel(vowel.id));
    return button;
  }));
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("pluckButton").addEventListener("click", () => pluck());
  $("repeatButton").addEventListener("click", toggleRepeat);
  $("harpSelect").addEventListener("change", (event) => loadHarp(event.currentTarget.value));
  $("randomizeButton").addEventListener("click", randomizeModel);
  $("pluckOutward").addEventListener("click", () => setDirection(1));
  $("pluckInward").addEventListener("click", () => setDirection(-1));
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.key);
    input.addEventListener("input", () => setControl(specification.key, Number(input.value), { mouth: specification.mouth }));
    input.addEventListener("change", () => setControl(specification.key, Number(input.value), {
      mouth: specification.mouth,
      announceChange: true,
    }));
  }
  $("level").addEventListener("input", (event) => setControl("level", Number(event.currentTarget.value)));
  $("resetAll").addEventListener("click", () => {
    state = { ...JAW_HARP_DEFAULTS };
    activeVowelId = "a";
    updatePresentation();
    postConfiguration();
    announce("Jaw harp restored to Temir khomus and open A mouth");
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const maximumPixels = 2_800_000;
  const pixels = cssWidth * cssHeight * pixelRatio * pixelRatio;
  if (pixels > maximumPixels) pixelRatio *= Math.sqrt(maximumPixels / pixels);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function layout() {
  const compact = cssHeight < 400 || cssWidth < 670;
  const mouthY = cssHeight * (compact ? 0.55 : 0.51);
  const faceWidth = Math.min(cssWidth * (compact ? 0.52 : 0.47), compact ? 360 : 510);
  const lipX = cssWidth * (compact ? 0.69 : 0.7);
  const throatX = lipX - faceWidth * 0.62;
  const jawGap = 24 + state.jawOpening * Math.min(76, cssHeight * 0.14);
  const tongueX = throatX + (lipX - throatX) * (0.28 + state.tonguePosition * 0.55);
  const tongueY = mouthY + jawGap * 0.55 - state.tongueHeight * (jawGap * 0.72 + 28);
  const lipExtension = state.lipRounding * 22;
  const triggerPull = pointerDrag?.type === "reed"
    ? pointerDrag.pull * Math.min(58, cssHeight * 0.1)
    : clamp(telemetry.displacement || 0, -1, 1) * Math.min(22, cssHeight * 0.04);
  return {
    compact,
    mouthY,
    faceWidth,
    lipX,
    throatX,
    jawGap,
    tongueX,
    tongueY,
    lipExtension,
    harpBowX: Math.max(compact ? 55 : 190, lipX - faceWidth * 0.92),
    triggerX: Math.min(cssWidth - 54, lipX + 104 + lipExtension),
    triggerY: mouthY + triggerPull,
  };
}

function strokePath(color, width = 1, alpha = 1) {
  drawing.strokeStyle = color;
  drawing.lineWidth = width;
  drawing.globalAlpha = alpha;
  drawing.stroke();
  drawing.globalAlpha = 1;
}

function drawNode(x, y, color, label, type, radius = 7) {
  drawing.save();
  drawing.shadowColor = color;
  drawing.shadowBlur = 12;
  drawing.fillStyle = "#040605";
  drawing.strokeStyle = color;
  drawing.lineWidth = 1.5;
  drawing.beginPath();
  drawing.arc(x, y, radius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.shadowBlur = 0;
  drawing.fillStyle = color;
  drawing.font = "600 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, x, y - radius - 9);
  drawing.restore();
  handles.push({ type, x, y, radius: radius + 10 });
}

function drawHead(model) {
  const { throatX, lipX, mouthY, faceWidth, jawGap, lipExtension } = model;
  const topY = mouthY - Math.min(230, cssHeight * 0.35);
  const backX = throatX - faceWidth * 0.18;
  drawing.beginPath();
  drawing.moveTo(backX, mouthY + jawGap * 1.85);
  drawing.bezierCurveTo(backX - 25, mouthY + 40, backX - 32, topY + 58, throatX + 20, topY);
  drawing.bezierCurveTo(lipX - 40, topY - 12, lipX + 48, topY + 52, lipX + 47, mouthY - 88);
  drawing.bezierCurveTo(lipX + 76, mouthY - 77, lipX + 70, mouthY - 56, lipX + 44, mouthY - 51);
  drawing.bezierCurveTo(lipX + 37, mouthY - 30, lipX + 29 + lipExtension, mouthY - 14, lipX + 23 + lipExtension, mouthY - 7);
  drawing.bezierCurveTo(lipX + 34 + lipExtension, mouthY + 2, lipX + 34 + lipExtension, mouthY + 13, lipX + 19 + lipExtension, mouthY + 17);
  drawing.bezierCurveTo(lipX + 36, mouthY + 50, lipX + 30, mouthY + jawGap + 46, lipX - 20, mouthY + jawGap + 78);
  drawing.bezierCurveTo(lipX - 90, mouthY + jawGap + 126, throatX - 12, mouthY + jawGap + 126, backX, mouthY + jawGap * 1.85);
  strokePath("#6e756f", 1.15, 0.75);

  drawing.beginPath();
  drawing.moveTo(lipX + 21 + lipExtension, mouthY - 5);
  drawing.bezierCurveTo(lipX - 24, mouthY - 14, throatX + 72, mouthY - 30, throatX + 22, mouthY + 2);
  drawing.bezierCurveTo(throatX - 4, mouthY + 20, throatX + 2, mouthY + jawGap * 0.9, throatX + 24, mouthY + jawGap * 1.2);
  drawing.bezierCurveTo(throatX + 74, mouthY + jawGap * 0.74, lipX - 36, mouthY + jawGap * 0.83, lipX + 18 + lipExtension, mouthY + 12);
  drawing.closePath();
  drawing.fillStyle = "rgba(118, 223, 211, 0.055)";
  drawing.fill();
  strokePath("#76dfd3", 1.15, 0.54);

  drawing.beginPath();
  drawing.moveTo(lipX + 15, mouthY + 12);
  drawing.bezierCurveTo(model.tongueX + 64, mouthY + jawGap * 0.72, model.tongueX + 44, model.tongueY + 3, model.tongueX, model.tongueY);
  drawing.bezierCurveTo(model.tongueX - 66, model.tongueY + 2, throatX + 34, mouthY + jawGap * 0.8, throatX + 24, mouthY + jawGap * 1.2);
  drawing.bezierCurveTo(throatX + 94, mouthY + jawGap * 1.18, lipX - 58, mouthY + jawGap * 1.22, lipX + 15, mouthY + 12);
  drawing.closePath();
  drawing.fillStyle = "rgba(186, 154, 246, 0.12)";
  drawing.fill();
  strokePath("#ba9af6", 1.3, 0.7);

  drawing.beginPath();
  drawing.moveTo(lipX + 40, mouthY + jawGap + 53);
  drawing.bezierCurveTo(lipX - 20, mouthY + jawGap + 75, throatX + 72, mouthY + jawGap * 1.55, throatX + 18, mouthY + jawGap * 1.22);
  strokePath("#aeb4ae", 1, 0.42);

  const glottisY = mouthY + jawGap * 1.06;
  drawing.beginPath();
  drawing.moveTo(throatX + 17, glottisY - 13);
  drawing.lineTo(throatX + 17 + state.glottisOpening * 10, glottisY);
  drawing.lineTo(throatX + 17, glottisY + 13);
  strokePath("#ee786d", 2, 0.7);

  const formants = mouthFormants(state).frequenciesHz;
  const waveCount = 3 + Math.round(state.formantFocus * 5);
  for (let index = 0; index < waveCount; index += 1) {
    const amount = (index + 0.5) / waveCount;
    const x = throatX + (lipX - throatX) * amount;
    const radius = 5 + Math.sin(amount * Math.PI) * (8 + state.cavityCoupling * 11);
    drawing.beginPath();
    drawing.arc(x, mouthY + 3, radius, -Math.PI * 0.55, Math.PI * 0.55);
    strokePath(index % 2 ? "#76dfd3" : "#f0c46e", 0.8, 0.15 + telemetry.energy * 0.25);
  }
  drawing.fillStyle = "rgba(118, 223, 211, 0.62)";
  drawing.font = "7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText(`F1 ${Math.round(formants[0])}`, throatX + 36, mouthY - 40);
  drawing.fillText(`F2 ${Math.round(formants[1])}`, throatX + 95, mouthY - 40);
  drawing.fillText(`F3 ${Math.round(formants[2])}`, throatX + 154, mouthY - 40);
}

function drawHarp(model) {
  const { harpBowX, lipX, mouthY, triggerX, triggerY } = model;
  const gap = 15;
  const frameEnd = lipX + 10;
  drawing.lineCap = "round";
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28, mouthY - gap);
  drawing.bezierCurveTo(harpBowX - 22, mouthY - gap, harpBowX - 22, mouthY + gap, harpBowX + 28, mouthY + gap);
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 5.5, 0.25);
  drawing.beginPath();
  drawing.moveTo(frameEnd, mouthY - gap);
  drawing.lineTo(harpBowX + 28, mouthY - gap);
  drawing.bezierCurveTo(harpBowX - 22, mouthY - gap, harpBowX - 22, mouthY + gap, harpBowX + 28, mouthY + gap);
  drawing.lineTo(frameEnd, mouthY + gap);
  strokePath("#df9d5a", 1.35, 0.95);

  drawing.beginPath();
  drawing.moveTo(harpBowX + 2, mouthY);
  drawing.quadraticCurveTo((harpBowX + triggerX) * 0.5, mouthY - (triggerY - mouthY) * 0.42, triggerX, triggerY);
  strokePath("#f0c46e", 2.1, 0.95);
  drawing.beginPath();
  drawing.moveTo(triggerX, triggerY - 16);
  drawing.lineTo(triggerX, triggerY + 16);
  drawing.lineTo(triggerX + 10, triggerY + 20);
  strokePath("#f0c46e", 2.2, 0.95);

  drawing.fillStyle = "rgba(223, 157, 90, 0.64)";
  drawing.font = "600 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText("FRAME", harpBowX + 70, mouthY + 38);
  drawing.fillText("FREE REED", (harpBowX + triggerX) * 0.5, mouthY - 28);
}

function drawSpectrum(model) {
  if (model.compact) return;
  const harmonic = dominantHarmonic(state);
  const left = Math.max(30, cssWidth * 0.48);
  const right = cssWidth - 34;
  const baseline = cssHeight - 57;
  const count = Math.min(24, Math.floor((right - left) / 12));
  drawing.fillStyle = "rgba(140, 145, 140, 0.62)";
  drawing.font = "6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText("REED HARMONICS / MOUTH-SELECTED PARTIAL", left, baseline - 52);
  for (let index = 1; index <= count; index += 1) {
    const x = left + (index - 1) / Math.max(1, count - 1) * (right - left);
    const selected = index === harmonic.index;
    const height = selected ? 42 : Math.max(5, 28 / Math.sqrt(index));
    drawing.beginPath();
    drawing.moveTo(x, baseline);
    drawing.lineTo(x, baseline - height);
    strokePath(selected ? "#76dfd3" : "#df9d5a", selected ? 2 : 1, selected ? 0.95 : 0.34);
    if (selected) {
      drawing.fillStyle = "#76dfd3";
      drawing.textAlign = "center";
      drawing.fillText(`${index}×`, x, baseline - height - 7);
    }
  }
}

function drawStage() {
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.fillStyle = "#040605";
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  drawing.strokeStyle = "rgba(223, 157, 90, 0.024)";
  drawing.lineWidth = 1;
  for (let x = 0; x < cssWidth; x += 34) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, cssHeight); drawing.stroke();
  }
  for (let y = 0; y < cssHeight; y += 34) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(cssWidth, y); drawing.stroke();
  }
  const model = layout();
  handles = [];
  drawHead(model);
  drawHarp(model);
  drawSpectrum(model);
  drawNode(model.triggerX + 6, model.triggerY, "#f0c46e", "PULL / PLUCK", "reed", 8);
  drawNode(model.tongueX, model.tongueY, "#ba9af6", "TONGUE", "tongue", 7);
  drawNode(model.lipX + 24 + model.lipExtension, model.mouthY + 5, "#76dfd3", "LIPS", "lips", 7);
  drawNode(model.lipX - 20, model.mouthY + model.jawGap + 74, "#ee786d", "JAW", "jaw", 7);
  drawNode(model.throatX + (model.lipX - model.throatX) * (0.46 + state.formantFocus * 0.23), model.mouthY - 3, "#76dfd3", "FOCUS", "focus", 6);
  pluckFlash *= prefersReducedMotion ? 0 : 0.91;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function nearestHandle(point) {
  return handles.find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.radius) ?? null;
}

function setFromPointer(type, point) {
  const model = layout();
  if (type === "tongue") {
    const position = clamp((point.x - (model.throatX + (model.lipX - model.throatX) * 0.28)) / ((model.lipX - model.throatX) * 0.55));
    const maximumY = model.mouthY + model.jawGap * 0.55;
    const height = clamp((maximumY - point.y) / (model.jawGap * 0.72 + 28));
    state = sanitizeJawHarpState({ ...state, tonguePosition: position, tongueHeight: height }, state);
    activeVowelId = null;
  } else if (type === "jaw") {
    state = sanitizeJawHarpState({ ...state, jawOpening: clamp((point.y - model.mouthY - 48) / Math.min(92, cssHeight * 0.18)) }, state);
    activeVowelId = null;
  } else if (type === "lips") {
    state = sanitizeJawHarpState({ ...state, lipRounding: clamp((point.x - model.lipX - 24) / 24) }, state);
    activeVowelId = null;
  } else if (type === "focus") {
    state = sanitizeJawHarpState({ ...state, formantFocus: clamp((point.x - model.throatX) / (model.lipX - model.throatX)) }, state);
    activeVowelId = null;
  }
  updatePresentation();
  postConfiguration();
}

function installCanvasInteractions() {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const point = canvasPoint(event);
    const handle = nearestHandle(point);
    if (!handle) {
      pluck();
      return;
    }
    event.preventDefault();
    pointerDrag = { type: handle.type, pointerId: event.pointerId, startY: point.y, pull: 0 };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    if (handle.type !== "reed") setFromPointer(handle.type, point);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(event);
    if (pointerDrag.type === "reed") {
      pointerDrag.pull = clamp((point.y - pointerDrag.startY) / Math.min(90, cssHeight * 0.17), -1, 1);
    } else setFromPointer(pointerDrag.type, point);
  });
  const finishPointer = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const drag = pointerDrag;
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
    canvas.releasePointerCapture?.(event.pointerId);
    if (drag.type === "reed" && Math.abs(drag.pull) > 0.04) {
      pluck({
        force: clamp(0.18 + Math.abs(drag.pull) * 0.82, 0.08, 1),
        direction: drag.pull < 0 ? -1 : 1,
      });
    }
  };
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
}

function installKeyboard() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
    const key = event.key.toLowerCase();
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      pluck();
    } else if ("aeiou".includes(key) && !event.repeat) {
      event.preventDefault();
      loadVowel(key);
    } else if (/^[1-5]$/.test(event.key) && !event.repeat) {
      event.preventDefault();
      loadHarp(JAW_HARP_PRESETS[Number(event.key) - 1].id);
    } else if (key === "r" && !event.repeat) {
      event.preventDefault();
      toggleRepeat();
    } else if (event.key === "Escape") {
      state = sanitizeJawHarpState({ ...state, repeat: false }, state);
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      updateTransportPresentation();
      announce("Jaw harp stopped");
    }
  });
}

function tick(time) {
  if (state.repeat && graph && audioContext?.state === "running" && time >= nextRepeatAt) {
    pluck({ automatic: true, direction: repeatStep % 2 ? -state.pluckDirection : state.pluckDirection });
    document.querySelectorAll(".jaw-pulse-map i").forEach((node, index) => node.classList.toggle("is-current", index === repeatStep % 8));
    nextRepeatAt = time + repeatIntervalMs(state.repeatRateBpm, repeatStep, state.repeatSwing);
    repeatStep += 1;
  }
  if (graph?.analyser) graph.analyser.getFloatTimeDomainData(waveform);
  $("motionReadout").textContent = telemetry.rms > 0.0004 ? `${Math.round(clamp(telemetry.energy) * 100)}% energy` : "resting";
  drawStage();
  animationFrame = requestAnimationFrame(tick);
}

buildPresets();
installControls();
installCanvasInteractions();
installKeyboard();
updatePresentation();
resizeCanvas();
globalThis.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(stageWrap);
animationFrame = requestAnimationFrame(tick);

globalThis.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  graph?.releaseOutput?.();
  audioContext?.close?.();
});
