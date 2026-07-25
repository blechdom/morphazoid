import {
  SHEPARD_DEFAULTS,
  SHEPARD_PRESETS,
  ShepardRissetAudio,
  sanitizeShepardParams,
} from "./src/shepard-risset.js";

const $ = (id) => document.getElementById(id);
const audio = new ShepardRissetAudio(globalThis);
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const waveform = new Float32Array(512);

const state = {
  direction: 1,
  speed: Math.abs(SHEPARD_DEFAULTS.rate),
  centerFrequency: SHEPARD_DEFAULTS.centerFrequency,
  width: SHEPARD_DEFAULTS.width,
  spread: SHEPARD_DEFAULTS.spread,
  cutoff: SHEPARD_DEFAULTS.cutoff,
  level: SHEPARD_DEFAULTS.level,
  preset: "classic-rise",
  audioOn: false,
  visualPhase: 0,
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = 0;
let canvasWidth = 1;
let canvasHeight = 1;
let disposed = false;

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function currentParameters() {
  return sanitizeShepardParams({
    centerFrequency: state.centerFrequency,
    rate: state.speed * state.direction,
    width: state.width,
    spread: state.spread,
    cutoff: state.cutoff,
    level: state.level,
  });
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function updateInterface() {
  const rising = state.direction > 0;
  setPressed($("directionRise"), rising);
  setPressed($("directionFall"), !rising);
  $("speed").value = String(state.speed);
  $("centerFrequency").value = String(state.centerFrequency);
  $("width").value = String(state.width);
  $("spread").value = String(state.spread);
  $("cutoff").value = String(state.cutoff);
  $("level").value = String(state.level);

  $("speedOut").textContent = `${state.speed.toFixed(2)} oct/s`;
  $("centerFrequencyOut").textContent = `${Math.round(state.centerFrequency)} Hz`;
  $("widthOut").textContent = `${state.width.toFixed(1)} oct`;
  $("spreadOut").textContent = `${Math.round(state.spread * 100)}%`;
  $("cutoffOut").textContent = state.cutoff >= 1_000
    ? `${(state.cutoff / 1_000).toFixed(1)} kHz`
    : `${Math.round(state.cutoff)} Hz`;
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  $("motionSummary").textContent = `${rising ? "rise" : "fall"} · ${state.speed.toFixed(2)} oct/s`;
  $("soundSummary").textContent = `${state.width.toFixed(1)} oct · ${Math.round(state.spread * 100)}% stereo`;
  $("directionMarker").textContent = rising ? "↑" : "↓";
  $("directionMarkerText").textContent = rising ? "endlessly rising" : "endlessly falling";
  canvas.setAttribute(
    "aria-label",
    `Animated barber-pole stripes and octave traces moving ${rising ? "upward" : "downward"}.`,
  );
  $("stageReadout").textContent = [
    rising ? "RISING" : "FALLING",
    `${state.speed.toFixed(2)} OCT/S`,
    `${state.width.toFixed(1)} OCT BANK`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");

  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.preset);
  }
  const selectedPreset = SHEPARD_PRESETS.find((preset) => preset.id === state.preset);
  $("presetSummary").textContent = selectedPreset?.label ?? "Custom";
  updateAudioParameters();
  draw(performance.now(), true);
}

function markCustom() {
  state.preset = null;
}

function applyPreset(id) {
  const preset = SHEPARD_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  state.preset = preset.id;
  state.direction = preset.rate < 0 ? -1 : 1;
  state.speed = Math.abs(preset.rate);
  state.centerFrequency = preset.centerFrequency;
  state.width = preset.width;
  state.spread = preset.spread;
  state.cutoff = preset.cutoff;
  updateInterface();
  announce(`${preset.label} preset loaded.`);
}

function bindRange(id, key, formatter = Number) {
  $(id).addEventListener("input", (event) => {
    state[key] = formatter(event.currentTarget.value);
    markCustom();
    updateInterface();
  });
}

for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}

for (const button of $("direction").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.direction = Number(button.dataset.value) < 0 ? -1 : 1;
    markCustom();
    updateInterface();
    announce(`Glissando now ${state.direction > 0 ? "rises" : "falls"}.`);
  });
}

bindRange("speed", "speed");
bindRange("centerFrequency", "centerFrequency");
bindRange("width", "width");
bindRange("spread", "spread");
bindRange("cutoff", "cutoff");
bindRange("level", "level");

async function toggleAudio() {
  const button = $("audioButton");
  button.disabled = true;
  clearAudioError();
  try {
    if (state.audioOn) {
      audio.stop();
      state.audioOn = false;
    } else {
      updateAudioParameters();
      await audio.start();
      state.audioOn = true;
    }
    setPressed(button, state.audioOn);
    $("audioState").textContent = state.audioOn ? "on" : "off";
    updateInterface();
    announce(`Audio ${state.audioOn ? "on" : "off"}.`);
  } catch (error) {
    state.audioOn = false;
    setPressed(button, false);
    $("audioState").textContent = "off";
    showAudioError(error);
    announce("Audio could not start.");
  } finally {
    button.disabled = false;
  }
}

$("audioButton").addEventListener("click", toggleAudio);

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    state.direction = event.key === "ArrowUp" ? 1 : -1;
    markCustom();
    updateInterface();
    announce(`Glissando now ${state.direction > 0 ? "rises" : "falls"}.`);
  } else if (event.key === " ") {
    event.preventDefault();
    toggleAudio();
  }
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(performance.now(), true);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBarberPole(ctx, width, height) {
  const poleWidth = Math.min(360, Math.max(150, width * 0.34));
  const poleHeight = Math.min(height * 0.72, 620);
  const x = (width - poleWidth) * 0.5;
  const y = (height - poleHeight) * 0.5;
  const radius = Math.min(82, poleWidth * 0.28);
  const stripeWidth = Math.max(24, poleWidth / 7);
  const diagonalLength = poleWidth + poleHeight;
  const travel = (state.visualPhase * stripeWidth * 3) % (stripeWidth * 3);

  ctx.save();
  roundedRectPath(ctx, x, y, poleWidth, poleHeight, radius);
  ctx.clip();

  const poleGradient = ctx.createLinearGradient(x, 0, x + poleWidth, 0);
  poleGradient.addColorStop(0, "rgba(0, 0, 0, 0.82)");
  poleGradient.addColorStop(0.18, "rgba(20, 24, 30, 0.82)");
  poleGradient.addColorStop(0.5, "rgba(46, 31, 40, 0.7)");
  poleGradient.addColorStop(0.82, "rgba(20, 24, 30, 0.82)");
  poleGradient.addColorStop(1, "rgba(0, 0, 0, 0.86)");
  ctx.fillStyle = poleGradient;
  ctx.fillRect(x, y, poleWidth, poleHeight);

  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(state.direction > 0 ? -Math.PI / 4 : Math.PI / 4);
  const colors = [
    "rgba(255, 120, 152, 0.62)",
    "rgba(242, 232, 218, 0.48)",
    "rgba(125, 180, 255, 0.52)",
  ];
  for (
    let stripe = -diagonalLength * 1.5;
    stripe < diagonalLength * 1.5;
    stripe += stripeWidth
  ) {
    const colorIndex = (
      Math.floor((stripe + diagonalLength * 1.5) / stripeWidth) % colors.length
    );
    ctx.fillStyle = colors[colorIndex];
    ctx.fillRect(
      stripe + travel * state.direction,
      -diagonalLength,
      stripeWidth * 0.58,
      diagonalLength * 2,
    );
  }
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, x, y, poleWidth, poleHeight, radius);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 243, 214, 0.28)";
  ctx.stroke();

  for (let ring = 1; ring < Math.round(state.width); ring += 1) {
    const ringY = y + poleHeight * ring / Math.round(state.width);
    ctx.beginPath();
    ctx.moveTo(x + 10, ringY);
    ctx.lineTo(x + poleWidth - 10, ringY);
    ctx.strokeStyle = "rgba(255, 243, 214, 0.09)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaveform(ctx, width, height) {
  if (!state.audioOn || !audio.getWaveform(waveform)) return;
  const yCenter = height * 0.5;
  const amplitude = Math.min(74, height * 0.12);
  ctx.save();
  ctx.beginPath();
  for (let index = 0; index < waveform.length; index += 1) {
    const x = index / (waveform.length - 1) * width;
    const y = yCenter + waveform[index] * amplitude;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255, 243, 214, 0.23)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  if (!force && timestamp - lastDrawTime < 1000 / 30) return;
  lastDrawTime = timestamp;
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  drawBarberPole(context2d, canvasWidth, canvasHeight);
  drawWaveform(context2d, canvasWidth, canvasHeight);
}

function animate(timestamp) {
  if (disposed) return;
  const elapsed = lastAnimationTime > 0
    ? Math.min(0.1, (timestamp - lastAnimationTime) / 1000)
    : 0;
  lastAnimationTime = timestamp;
  if (state.audioOn && !reducedMotion) {
    state.visualPhase += elapsed * state.speed * state.direction;
  }
  draw(timestamp);
  animationFrame = requestAnimationFrame(animate);
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
resizeObserver?.observe(canvas);
globalThis.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastAnimationTime = performance.now();
    resizeCanvas();
  }
});

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  audio.close();
}, { once: true });

updateInterface();
resizeCanvas();
animationFrame = requestAnimationFrame(animate);
