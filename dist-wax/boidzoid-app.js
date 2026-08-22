import { VoicePool } from "./src/audio.js";
import {
  boidzoidSeed,
  createFlock,
  mapBoidToSineVoice,
  stepFlock,
} from "./src/boidzoid.js";
import { clamp, createFixedStepper, lerp, wrap } from "./src/physics-common.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const compactViewport = window.matchMedia?.("(max-width: 650px)")?.matches === true;
const query = new URLSearchParams(window.location.search);
const audio = new VoicePool(48, { continuousPeakCeiling: 0.68 });
const stepper = createFixedStepper({ step: 1 / 120, maxSubsteps: 6 });

const DEFAULTS = Object.freeze({
  seed: boidzoidSeed(query.get("seed") || "morphazpod-01"),
  running: true,
  audioOn: false,
  level: 0.36,
  count: compactViewport ? 16 : 24,
  morph: 0.42,
  speed: compactViewport ? 0.105 : 0.12,
  cohesion: 0.54,
  alignment: 0.68,
  separation: 0.72,
});

const TEMPERAMENTS = Object.freeze({
  lull: Object.freeze({ count: 12, morph: 0.12, speed: 0.07, cohesion: 0.76, alignment: 0.82, separation: 0.48 }),
  graze: Object.freeze({ count: compactViewport ? 16 : 24, morph: 0.42, speed: compactViewport ? 0.105 : 0.12, cohesion: 0.54, alignment: 0.68, separation: 0.72 }),
  murmur: Object.freeze({ count: compactViewport ? 20 : 32, morph: 0.64, speed: 0.145, cohesion: 0.68, alignment: 0.8, separation: 0.58 }),
  fury: Object.freeze({ count: compactViewport ? 24 : 42, morph: 0.92, speed: 0.2, cohesion: 0.25, alignment: 0.38, separation: 0.92 }),
});

const state = {
  ...DEFAULTS,
  boids: [],
  pointer: { active: false, x: 0.5, y: 0.5, mode: "attract" },
  lure: { active: false, x: 0.5, y: 0.5, mode: "attract" },
  audioStarting: false,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameAt = performance.now();
let lastUiAt = 0;
let pointerId = null;
let manualMode = false;
let lastCanvasLabel = "";

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function aspect() {
  return clamp(cssWidth / Math.max(1, cssHeight), 0.25, 4);
}

function effectiveFlockSettings() {
  const ferality = state.morph;
  const centerSpeed = clamp(state.speed * lerp(0.82, 1.16, ferality), 0.035, 0.29);
  return {
    seed: state.seed,
    count: state.boids.length || state.count,
    aspect: aspect(),
    perceptionRadius: lerp(0.22, 0.145, ferality),
    separationRadius: lerp(0.045, 0.065, ferality),
    alignment: state.alignment * lerp(1.18, 0.84, ferality),
    cohesion: state.cohesion * lerp(1.25, 0.78, ferality),
    separation: state.separation * lerp(0.92, 1.55, ferality),
    wander: lerp(0.018, 0.16, ferality),
    minSpeed: centerSpeed * 0.56,
    maxSpeed: centerSpeed * 1.46,
    maxForce: lerp(0.34, 0.82, ferality),
    pointerRadius: lerp(0.4, 0.27, ferality),
    pointerStrength: lerp(0.78, 1.24, ferality),
  };
}

function sineVoices() {
  const flock = effectiveFlockSettings();
  return state.boids.map((boid) => mapBoidToSineVoice(boid, {
    minimumFrequency: 70,
    maximumFrequency: 1_200,
    minimumSpeed: flock.minSpeed,
    maximumSpeed: flock.maxSpeed,
    aspect: flock.aspect,
    gain: 0.18,
  }));
}

function syncAudioVoices() {
  if (!state.audioOn) return;
  audio.setVoices(sineVoices(), {
    mode: "sine",
    requestedVoiceCount: state.boids.length,
  });
}

function resetFlock({ advanceSeed = false, announceReset = false } = {}) {
  if (advanceSeed) state.seed = boidzoidSeed(state.seed + 0x9e3779b9);
  state.boids = createFlock({ ...effectiveFlockSettings(), count: state.count });
  syncAudioVoices();
  if (manualMode) draw();
  if (announceReset) announce(`${state.count} arrow playheads scattered across the sine field.`);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(window.devicePixelRatio || 1, compactViewport ? 1.5 : 2);
  if (nextWidth === cssWidth && nextHeight === cssHeight && nextRatio === pixelRatio) return;
  cssWidth = nextWidth;
  cssHeight = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  syncAudioVoices();
  if (manualMode) draw();
}

function drawPlayheads() {
  const size = clamp(Math.min(cssWidth, cssHeight) * 0.018, 7, 12);
  context.save();
  for (const boid of state.boids) {
    const x = boid.x * cssWidth;
    const y = boid.y * cssHeight;
    const angle = Math.atan2(boid.vy * cssHeight, boid.vx * cssWidth);
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    if (!reducedMotion && boid.id % 4 === 0) {
      context.shadowColor = "#c9ffe0";
      context.shadowBlur = 8;
    }
    context.beginPath();
    context.moveTo(size * 1.15, 0);
    context.lineTo(size * 0.1, -size * 0.72);
    context.lineTo(size * 0.1, -size * 0.25);
    context.lineTo(-size * 1.05, -size * 0.25);
    context.lineTo(-size * 1.05, size * 0.25);
    context.lineTo(size * 0.1, size * 0.25);
    context.lineTo(size * 0.1, size * 0.72);
    context.closePath();
    context.fillStyle = "#c9ffe0";
    context.globalAlpha = 0.92;
    context.fill();
    context.restore();
  }
  context.restore();
}

function drawAttractor(attractor, label) {
  if (!attractor.active) return;
  const x = attractor.x * cssWidth;
  const y = attractor.y * cssHeight;
  const repel = attractor.mode === "repel";
  const color = repel ? "#ef91bd" : "#bdff67";
  const radius = Math.min(cssWidth, cssHeight) * 0.032;
  context.save();
  context.translate(x, y);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.globalAlpha = 0.72;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 0.28;
  context.beginPath();
  context.arc(0, 0, radius * 1.7, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 0.78;
  context.fillStyle = color;
  context.font = "7px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(`${label} / ${repel ? "REPEL" : "ATTRACT"}`, 0, radius * 2.2);
  context.restore();
}

function draw() {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#070b09";
  context.fillRect(0, 0, cssWidth, cssHeight);
  drawPlayheads();
  drawAttractor(state.pointer, "TOUCH");
  drawAttractor(state.lure, "LURE");
}

function simulationAttractors() {
  const attractors = [];
  if (state.pointer.active) {
    attractors.push({
      ...state.pointer,
      strength: state.pointer.mode === "repel" ? 1.35 : 1,
    });
  }
  if (state.lure.active) attractors.push({ ...state.lure, strength: 0.7 });
  return attractors;
}

function updateUi(now = performance.now(), force = false) {
  if (!force && now - lastUiAt < 100) return;
  lastUiAt = now;
  $("metricPlayheads").textContent = String(state.boids.length);
  $("metricMotion").textContent = state.running ? "drift" : "paused";
  $("podState").textContent = state.running ? state.audioOn ? "sounding" : "drifting" : "suspended";
  $("podState").classList.toggle("is-paused", !state.running);
  $("motionSummary").textContent = `${state.running ? "running" : "paused"} · ${state.lure.active ? "lured" : "untamed"}`;
  $("flockSummary").textContent = `${state.boids.length} · ${state.morph < 0.28 ? "calm" : state.morph > 0.72 ? "feral" : "balanced"}`;
  $("stageReadout").textContent = `${state.boids.length} ARROWS · CONTINUOUS SINE · ${state.audioOn ? "AUDIO ON" : "AUDIO OFF"}`;
  const canvasLabel = `${state.boids.length} flocking arrow playheads, each controlling one continuously moving sine wave. Audio is ${state.audioOn ? "on" : "off"}.`;
  if (canvasLabel !== lastCanvasLabel) {
    canvas.setAttribute("aria-label", canvasLabel);
    lastCanvasLabel = canvasLabel;
  }
}

function animate(now) {
  scheduledFrame = 0;
  const deltaSeconds = clamp((now - lastFrameAt) / 1_000, 0, 0.05);
  lastFrameAt = now;
  if (state.running && !document.hidden) {
    const settings = { ...effectiveFlockSettings(), attractors: simulationAttractors() };
    stepper.advance(deltaSeconds, (step) => { stepFlock(state.boids, step, settings); });
    syncAudioVoices();
  } else if (!state.running) stepper.reset();
  updateUi(now);
  draw();
  scheduledFrame = requestAnimationFrame(animate);
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  if (state.audioOn) {
    state.audioOn = false;
    audio.setVoices([]);
    audio.disable();
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    $("stageInvitation").classList.remove("is-awake");
    $("stageInvitation").querySelector("b").textContent = "turn on audio";
    $("stageInvitation").querySelector("span").textContent = "drag the surface to steer the arrows";
    updateUi(performance.now(), true);
    announce("Boidzoid sine audio off. The arrows continue to drift silently.");
    return;
  }

  state.audioStarting = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting";
  try {
    await audio.start();
    state.audioOn = true;
    audio.setLevel(state.level);
    syncAudioVoices();
    $("audioButton").setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    $("stageInvitation").classList.add("is-awake");
    $("stageInvitation").querySelector("b").textContent = "sine field on";
    $("stageInvitation").querySelector("span").textContent = "each arrow is one continuous sine";
    announce("Boidzoid audio on. Each arrow now controls one continuous sine wave.");
  } catch (error) {
    state.audioOn = false;
    audio.disable();
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    showError(error);
  } finally {
    state.audioStarting = false;
    $("audioButton").disabled = false;
    updateUi(performance.now(), true);
  }
}

function setRunning(running) {
  state.running = Boolean(running);
  $("flockButton").setAttribute("aria-pressed", String(state.running));
  $("flockButton").setAttribute("aria-label", state.running ? "Pause the flock" : "Run the flock");
  lastFrameAt = performance.now();
  stepper.reset();
  updateUi(performance.now(), true);
  announce(state.running ? "Flock running." : "Flock paused. The sine positions are held.");
}

function updateRangeOutput(id, value) {
  const formatters = {
    level: formatPercent,
    morph: formatPercent,
    boidCount: (number) => String(Math.round(number)),
    speed: (number) => `${number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} /s`,
    cohesion: formatPercent,
    alignment: formatPercent,
    separation: formatPercent,
  };
  $(`${id}Out`).textContent = formatters[id](Number(value));
}

function paintControls() {
  const fields = {
    level: state.level,
    morph: state.morph,
    boidCount: state.count,
    speed: state.speed,
    cohesion: state.cohesion,
    alignment: state.alignment,
    separation: state.separation,
  };
  for (const [id, value] of Object.entries(fields)) {
    $(id).value = String(value);
    updateRangeOutput(id, value);
  }
  updateUi(performance.now(), true);
}

function buttonLabel(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function applyTemperament(name) {
  const preset = TEMPERAMENTS[name];
  if (!preset) return;
  Object.assign(state, preset);
  for (const button of document.querySelectorAll("[data-temperament]")) {
    button.setAttribute("aria-pressed", String(button.dataset.temperament === name));
  }
  paintControls();
  resetFlock({ advanceSeed: true });
  announce(`${buttonLabel(name)} temperament loaded.`);
}

function normalizedPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
    y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
  };
}

function beginPointer(event) {
  if (event.button !== undefined && ![0, 2].includes(event.button)) return;
  event.preventDefault();
  pointerId = event.pointerId;
  Object.assign(state.pointer, normalizedPointer(event), {
    active: true,
    mode: event.shiftKey || event.button === 2 ? "repel" : "attract",
  });
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.add("is-steering");
}

function movePointer(event) {
  if (pointerId !== event.pointerId) return;
  event.preventDefault();
  Object.assign(state.pointer, normalizedPointer(event));
  state.pointer.mode = event.shiftKey || event.buttons === 2 ? "repel" : state.pointer.mode;
}

function endPointer(event) {
  if (pointerId !== event.pointerId) return;
  state.pointer.active = false;
  pointerId = null;
  stageWrap.classList.remove("is-steering");
  canvas.releasePointerCapture?.(event.pointerId);
}

function bindControls() {
  $("audioButton").addEventListener("click", () => { void toggleAudio(); });
  $("flockButton").addEventListener("click", () => setRunning(!state.running));
  $("scatterButton").addEventListener("click", () => resetFlock({ advanceSeed: true, announceReset: true }));
  $("clearLureButton").addEventListener("click", () => {
    state.lure.active = false;
    updateUi(performance.now(), true);
    announce("Persistent lure cleared.");
  });

  const simpleRanges = {
    level: "level",
    morph: "morph",
    speed: "speed",
    cohesion: "cohesion",
    alignment: "alignment",
    separation: "separation",
  };
  for (const [id, key] of Object.entries(simpleRanges)) {
    $(id).addEventListener("input", (event) => {
      state[key] = Number(event.target.value);
      updateRangeOutput(id, state[key]);
      if (id === "level") audio.setLevel(state.level);
      for (const button of document.querySelectorAll("[data-temperament]")) {
        button.setAttribute("aria-pressed", "false");
      }
      updateUi(performance.now(), true);
    });
  }

  $("boidCount").addEventListener("input", (event) => {
    state.count = Math.round(Number(event.target.value));
    updateRangeOutput("boidCount", state.count);
    resetFlock();
    updateUi(performance.now(), true);
  });
  for (const button of document.querySelectorAll("[data-temperament]")) {
    button.addEventListener("click", () => applyTemperament(button.dataset.temperament));
  }
  $("resetAll").addEventListener("click", () => {
    const preservedAudio = state.audioOn;
    Object.assign(state, DEFAULTS, { audioOn: preservedAudio, running: true });
    state.lure.active = false;
    paintControls();
    for (const button of document.querySelectorAll("[data-temperament]")) {
      button.setAttribute("aria-pressed", String(button.dataset.temperament === "graze"));
    }
    setRunning(true);
    audio.setLevel(state.level);
    resetFlock();
    announce("Boidzoid reset to its baseline sine flock.");
  });

  canvas.addEventListener("pointerdown", beginPointer);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("keydown", (event) => {
    const amount = event.shiftKey ? 0.06 : 0.025;
    const directions = {
      ArrowLeft: [-amount, 0],
      ArrowRight: [amount, 0],
      ArrowUp: [0, -amount],
      ArrowDown: [0, amount],
    };
    if (directions[event.key]) {
      event.preventDefault();
      state.lure.active = true;
      state.lure.x = wrap(state.lure.x + directions[event.key][0], 1);
      state.lure.y = wrap(state.lure.y + directions[event.key][1], 1);
      updateUi(performance.now(), true);
    } else if (event.key === "Escape") {
      state.lure.active = false;
      updateUi(performance.now(), true);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      setRunning(!state.running);
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetFlock({ advanceSeed: true, announceReset: true });
    }
  });
}

function installManualHook() {
  if (query.get("manual") !== "1") return false;
  globalThis.__BOIDZOID__ = Object.freeze({
    step(frames = 1) {
      const settings = { ...effectiveFlockSettings(), attractors: simulationAttractors() };
      for (let index = 0; index < clamp(Math.round(frames), 1, 1_000); index += 1) {
        stepFlock(state.boids, 1 / 120, settings);
      }
      syncAudioVoices();
      updateUi(performance.now(), true);
      draw();
      return this.snapshot();
    },
    snapshot() {
      return {
        boids: state.boids.map(({ id, x, y, vx, vy }) => ({ id, x, y, vx, vy })),
        voices: sineVoices(),
        audioOn: state.audioOn,
      };
    },
  });
  return true;
}

resizeCanvas();
resetFlock();
paintControls();
bindControls();
manualMode = installManualHook();
if (typeof ResizeObserver === "function") new ResizeObserver(resizeCanvas).observe(stageWrap);
else window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  lastFrameAt = performance.now();
  stepper.reset();
});
window.addEventListener("pagehide", () => { void audio.close(); }, { once: true });
if (manualMode) draw();
else scheduledFrame = requestAnimationFrame(animate);
