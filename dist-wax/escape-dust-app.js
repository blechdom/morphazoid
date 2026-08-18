import { VoicePool } from "./src/audio.js";
import {
  ESCAPE_DUST_DEFAULTS,
  classicalSurvivalRatio,
  createEscapeDustSimulation,
  deriveEscapeDustSound,
  openingBounds,
  stepEscapeDustSimulation,
  wavePositionDensity,
} from "./src/escape-dust.js";

const $ = (id) => document.getElementById(id);
const DRAW_INTERVAL = 1_000 / 30;
const HISTORY_LIMIT = 56;
const COLORS = Object.freeze({
  background: "#050608",
  panel: "#090c10",
  ink: "#dbe4e0",
  muted: "#77837e",
  line: "rgba(214, 232, 226, 0.14)",
  cyan: "#69e7ff",
  cyanSoft: "rgba(105, 231, 255, 0.2)",
  violet: "#b59cff",
  violetSoft: "rgba(181, 156, 255, 0.2)",
  amber: "#ffb86b",
  amberSoft: "rgba(255, 184, 107, 0.16)",
  cream: "#fff3d6",
});

const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const voices = new VoicePool(12, {
  adaptive: true,
  maxVoices: 18,
  continuousPeakCeiling: 0.62,
});

const state = {
  packetPosition: ESCAPE_DUST_DEFAULTS.packetPosition,
  packetMomentum: ESCAPE_DUST_DEFAULTS.packetMomentum,
  packetSpread: ESCAPE_DUST_DEFAULTS.packetSpread,
  openingWidth: ESCAPE_DUST_DEFAULTS.openingWidth,
  seed: ESCAPE_DUST_DEFAULTS.seed,
  stepRate: 2,
  level: 0.44,
  view: "overlay",
  playing: false,
  audioOn: false,
  audioStarting: false,
};

let simulation = createSimulation();
let sound = deriveEscapeDustSound(simulation);
let history = [historyPoint()];
let frameId = null;
let lastFrameTime = 0;
let lastDrawTime = -Infinity;
let stepAccumulator = 0;
let visualizationDirty = true;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let flashUntil = 0;
let disposed = false;
let pageActive = true;
let audioRequest = 0;
let draggingPacket = false;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentage(value, digits = 1) {
  return `${(clamp(Number(value) || 0, 0, 1) * 100).toFixed(digits)}%`;
}

function compact(value, digits = 3) {
  return Number(value).toFixed(digits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");
}

function noteName(midi) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const safe = Math.round(midi);
  return `${names[((safe % 12) + 12) % 12]}${Math.floor(safe / 12) - 1}`;
}

function createSimulation() {
  return createEscapeDustSimulation({
    ...ESCAPE_DUST_DEFAULTS,
    packetPosition: state.packetPosition,
    packetMomentum: state.packetMomentum,
    packetSpread: state.packetSpread,
    openingWidth: state.openingWidth,
    seed: state.seed,
  });
}

function historyPoint() {
  return {
    step: simulation.step,
    classical: classicalSurvivalRatio(simulation.classical),
    wave: clamp(simulation.wave.norm, 0, 1),
    flux: clamp(
      simulation.wave.escapedThisStep
        + simulation.classical.escapedThisStep / simulation.classical.initialCount,
      0,
      1,
    ),
  };
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    if (!disposed && pageActive) $("liveStatus").textContent = message;
  });
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  announce(`Audio error: ${message}`);
}

function clearAudioError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function openingLabel(width, settings = simulation?.settings) {
  if (Math.abs(width - 1 / 3) < 0.003) return "1/3";
  return settings?.openingCells && settings?.waveSize
    ? `${settings.openingCells}/${settings.waveSize} · ${percentage(width, 1)}`
    : percentage(width, 1);
}

function updateTransportInterface() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause Escape Dust" : "Play Escape Dust");
  $("transportSummary").textContent = `${state.playing ? "playing" : "paused"} · step ${simulation.step}`;
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioStarting = String(state.audioStarting);
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function updateModeInterface() {
  for (const button of $("viewModeButtons").querySelectorAll("[data-view]")) {
    setPressed(button, button.dataset.view === state.view);
  }
}

function updateSoundLedger() {
  const telemetry = sound.telemetry;
  const audibleAccent = state.view === "classical"
    ? sound.classicalEscapeAccent
    : state.view === "wave"
      ? sound.waveEscapeAccent
      : sound.escapeAccent;
  $("soundSummary").textContent = `${noteName(telemetry.rootMidi)} · ${telemetry.voiceCount} wave · ${telemetry.resting ? "rest" : "sounding"}`;
  $("melodyMapping").textContent = `q/p → ${noteName(telemetry.rootMidi)} · degree +${telemetry.melodicDegree} · phase ${telemetry.phaseSlope.toFixed(2)}`;
  $("harmonyMapping").textContent = `violet baker chord · ${telemetry.voiceCount} voices`;
  $("textureMapping").textContent = `spread/entropy → PM grain ${percentage(telemetry.texture, 0)}`;
  $("dynamicsMapping").textContent = `wave norm → ensemble ${percentage(telemetry.waveNorm, 1)}`;
  $("rhythmMapping").textContent = `branches → L ${percentage(telemetry.leftFraction, 0)} / R ${percentage(telemetry.rightFraction, 0)}`;
  $("phraseMapping").textContent = `step ${telemetry.phraseStep + 1}/8 · rest every ${telemetry.restStride}`;
  $("accentMapping").textContent = `${state.view} flux → amber strike ${percentage(audibleAccent.flux, 1)}`;
}

function updateReadouts() {
  const classicalRatio = classicalSurvivalRatio(simulation.classical);
  const total = simulation.classical.initialCount;
  const survivors = simulation.classical.survivors;
  const waveNorm = clamp(simulation.wave.norm, 0, 1);
  const totalLeak = clamp(simulation.wave.totalLeak, 0, 1);

  $("packetPosition").value = String(state.packetPosition);
  $("packetMomentum").value = String(state.packetMomentum);
  $("packetSpread").value = String(state.packetSpread);
  $("openingWidth").value = String(state.openingWidth);
  $("seed").value = String(state.seed);
  $("stepRate").value = String(state.stepRate);
  $("level").value = String(state.level);
  $("packetPositionOut").textContent = state.packetPosition.toFixed(3);
  $("packetMomentumOut").textContent = state.packetMomentum.toFixed(3);
  $("packetSpreadOut").textContent = state.packetSpread.toFixed(3);
  $("openingWidthOut").textContent = openingLabel(simulation.settings.openingWidth);
  $("seedOut").textContent = String(state.seed);
  $("stepRateOut").textContent = `${state.stepRate.toFixed(1)} steps/s`;
  $("levelOut").textContent = percentage(state.level, 0);
  $("packetSummary").textContent = `q ${state.packetPosition.toFixed(2)} · p ${state.packetMomentum.toFixed(2)} · σ ${state.packetSpread.toFixed(3)}`;
  $("stepReadout").textContent = String(simulation.step);
  $("survivorReadout").textContent = `${survivors} / ${total}`;
  $("classicalRatioReadout").textContent = percentage(classicalRatio, 1);
  $("classicalFluxReadout").textContent = `${simulation.classical.escapedThisStep} ${simulation.classical.escapedThisStep === 1 ? "point" : "points"}`;
  $("waveNormReadout").textContent = simulation.wave.norm.toFixed(4);
  $("waveLeakReadout").textContent = percentage(totalLeak, 1);
  $("waveFluxReadout").textContent = simulation.wave.escapedThisStep.toFixed(4);
  $("leakSummary").textContent = simulation.step === 0
    ? "both layers intact"
    : `points ${percentage(classicalRatio, 0)} · wave ${percentage(waveNorm, 0)}`;
  $("stageReadout").textContent = [
    `STEP ${simulation.step}`,
    `${survivors} POINTS`,
    `WAVE ${percentage(waveNorm, 1)}`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `Escape Dust at map step ${simulation.step}. ${survivors} of ${total} classical points survive. Wave norm ${simulation.wave.norm.toFixed(4)}, with ${percentage(totalLeak, 1)} total leakage. The middle opening is ${openingLabel(simulation.settings.openingWidth)} of phase space. Showing ${state.view} layers.`,
  );
  updateTransportInterface();
  updateAudioInterface();
  updateModeInterface();
  updateSoundLedger();
}

function updateAudioVoices() {
  voices.setLevel(state.level);
  if (!state.audioOn || state.view === "classical" || sound.telemetry.resting) {
    voices.setVoices([], { mode: "pm", requestedVoiceCount: 0 });
    return;
  }
  voices.setVoices(sound.waveVoices, {
    mode: "pm",
    requestedVoiceCount: sound.waveVoices.length,
  });
}

function triggerStepSound() {
  if (!state.audioOn) return;
  if (state.view !== "wave" && !sound.telemetry.resting) {
    for (const click of sound.classicalClicks) {
      voices.strike(click, {
        attackSeconds: 0.0015,
        decaySeconds: 0.045,
        attackNoise: 0.09,
        startDelaySeconds: click.delay,
        retriggerMode: "crossfade",
      });
    }
  }
  const accent = state.view === "classical"
    ? sound.classicalEscapeAccent
    : state.view === "wave"
      ? sound.waveEscapeAccent
      : sound.escapeAccent;
  if (accent.gain > 0) {
    voices.strike(accent, {
      attackSeconds: 0.002,
      decaySeconds: 0.18 + simulation.settings.openingWidth * 0.16,
      attackNoise: accent.attackNoise,
      retriggerMode: "crossfade",
    });
  }
}

async function turnAudioOn() {
  if (state.audioOn || state.audioStarting || disposed || !pageActive) return;
  const request = ++audioRequest;
  state.audioStarting = true;
  clearAudioError();
  updateAudioInterface();
  try {
    voices.setLevel(state.level);
    await voices.enable();
    if (request !== audioRequest || disposed || !pageActive) {
      voices.disable();
      return;
    }
    state.audioOn = true;
    updateAudioVoices();
    announce("Escape Dust audio on. Wave norm shapes the violet chord; survivors and leakage articulate it.");
  } catch (error) {
    if (request === audioRequest) showAudioError(error);
  } finally {
    if (request === audioRequest) state.audioStarting = false;
    updateAudioInterface();
    updateReadouts();
  }
}

function turnAudioOff({ announceChange = true } = {}) {
  audioRequest += 1;
  state.audioOn = false;
  state.audioStarting = false;
  voices.disable();
  updateAudioInterface();
  updateReadouts();
  if (announceChange) announce("Escape Dust audio off.");
}

function toggleAudio() {
  if (state.audioOn || state.audioStarting) turnAudioOff();
  else void turnAudioOn();
}

function appendHistory() {
  history.push(historyPoint());
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
}

function stepOnce({ announceStep = false } = {}) {
  simulation = stepEscapeDustSimulation(simulation, { openingWidth: state.openingWidth });
  state.openingWidth = simulation.settings.openingWidth;
  sound = deriveEscapeDustSound(simulation);
  appendHistory();
  flashUntil = performance.now() + (reducedMotion ? 80 : 260);
  updateReadouts();
  updateAudioVoices();
  triggerStepSound();
  visualizationDirty = true;
  scheduleFrame();
  if (announceStep) {
    announce(`Step ${simulation.step}. ${simulation.classical.survivors} classical survivors. Wave norm ${simulation.wave.norm.toFixed(3)}.`);
  }
}

function restartSimulation({ announceChange = true, pause = false } = {}) {
  if (pause) state.playing = false;
  simulation = createSimulation();
  state.openingWidth = simulation.settings.openingWidth;
  sound = deriveEscapeDustSound(simulation);
  history = [historyPoint()];
  stepAccumulator = 0;
  flashUntil = 0;
  updateReadouts();
  updateAudioVoices();
  visualizationDirty = true;
  scheduleFrame();
  if (announceChange) announce("Escape Dust restarted with the current packet and opening.");
}

function togglePlaying() {
  state.playing = !state.playing;
  stepAccumulator = 0;
  lastFrameTime = performance.now();
  updateTransportInterface();
  visualizationDirty = true;
  scheduleFrame();
  announce(state.playing ? "Escape Dust playing." : "Escape Dust paused.");
}

function setView(view, { announceChange = true } = {}) {
  if (!["classical", "wave", "overlay"].includes(view)) return;
  state.view = view;
  updateReadouts();
  updateAudioVoices();
  visualizationDirty = true;
  scheduleFrame();
  if (announceChange) announce(`${view} layer view selected.`);
}

function cycleView() {
  const order = ["classical", "wave", "overlay"];
  setView(order[(order.indexOf(state.view) + 1) % order.length]);
}

function resetAll() {
  Object.assign(state, {
    packetPosition: ESCAPE_DUST_DEFAULTS.packetPosition,
    packetMomentum: ESCAPE_DUST_DEFAULTS.packetMomentum,
    packetSpread: ESCAPE_DUST_DEFAULTS.packetSpread,
    openingWidth: ESCAPE_DUST_DEFAULTS.openingWidth,
    seed: ESCAPE_DUST_DEFAULTS.seed,
    stepRate: 2,
    level: 0.44,
    view: "overlay",
    playing: false,
  });
  voices.setLevel(state.level);
  restartSimulation({ announceChange: false, pause: true });
  announce("Escape Dust reset to its default open triadic packet.");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (width === cssWidth && height === cssHeight && ratio === pixelRatio) return;
  cssWidth = width;
  cssHeight = height;
  pixelRatio = ratio;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
  visualizationDirty = true;
  scheduleFrame();
}

function stageLayout() {
  const compactStage = cssWidth < 720;
  const top = cssWidth < 520 ? 98 : 126;
  const bottom = cssWidth < 520 ? 44 : 62;
  const usableHeight = Math.max(80, cssHeight - top - bottom);
  if (compactStage) {
    const size = Math.max(80, Math.min(cssWidth - 36, usableHeight));
    return {
      compact: true,
      phase: { x: (cssWidth - size) / 2, y: top + (usableHeight - size) / 2, size },
      chart: null,
    };
  }
  const phaseSize = Math.max(120, Math.min(usableHeight, cssWidth * 0.5 - 54));
  const phaseX = Math.max(32, (cssWidth * 0.54 - phaseSize) / 2);
  const chartX = phaseX + phaseSize + 44;
  return {
    compact: false,
    phase: { x: phaseX, y: top + (usableHeight - phaseSize) / 2, size: phaseSize },
    chart: {
      x: chartX,
      y: top,
      width: Math.max(120, cssWidth - chartX - 34),
      height: usableHeight,
    },
  };
}

function drawGrid() {
  const ctx = context2d;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.strokeStyle = "rgba(105, 231, 255, 0.028)";
  ctx.lineWidth = 1;
  for (let x = 0.5; x < cssWidth; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssHeight);
    ctx.stroke();
  }
  for (let y = 0.5; y < cssHeight; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssWidth, y);
    ctx.stroke();
  }
}

function drawWaveDensity(rect) {
  if (state.view === "classical") return;
  const { size: gridSize, values } = simulation.waveDensity;
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  if (maximum <= 0) return;
  const normScale = Math.sqrt(clamp(simulation.wave.norm, 0, 1));
  const cell = rect.size / gridSize;
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const amount = Math.sqrt(values[row * gridSize + column] / maximum) * normScale;
      if (amount < 0.01) continue;
      context2d.fillStyle = `rgba(181, 156, 255, ${amount * (state.view === "overlay" ? 0.52 : 0.74)})`;
      context2d.fillRect(
        rect.x + column * cell,
        rect.y + row * cell,
        Math.ceil(cell + 0.35),
        Math.ceil(cell + 0.35),
      );
    }
  }
}

function drawClassicalPoints(rect) {
  if (state.view === "wave") return;
  const ctx = context2d;
  const radius = rect.size < 260 ? 1.15 : 1.55;
  ctx.fillStyle = state.view === "overlay" ? "rgba(105, 231, 255, 0.78)" : COLORS.cyan;
  ctx.shadowBlur = reducedMotion ? 0 : 5;
  ctx.shadowColor = COLORS.cyan;
  for (const point of simulation.classical.points) {
    if (!point.alive) continue;
    const x = rect.x + point.q * rect.size;
    const y = rect.y + (1 - point.p) * rect.size;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawOpening(rect, now) {
  const ctx = context2d;
  const bounds = openingBounds(simulation.settings.openingWidth);
  const x = rect.x + bounds.start * rect.size;
  const width = bounds.width * rect.size;
  const flashing = now < flashUntil;
  ctx.fillStyle = flashing ? "rgba(255, 184, 107, 0.2)" : COLORS.amberSoft;
  ctx.fillRect(x, rect.y, width, rect.size);
  ctx.strokeStyle = COLORS.amber;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(x, rect.y);
  ctx.lineTo(x, rect.y + rect.size);
  ctx.moveTo(x + width, rect.y);
  ctx.lineTo(x + width, rect.y + rect.size);
  ctx.stroke();
  ctx.setLineDash([]);

  const escaped = simulation.classical.points.filter(
    (point) => point.escapedAt === simulation.step,
  );
  if (escaped.length) {
    ctx.fillStyle = "rgba(255, 184, 107, 0.88)";
    for (const point of escaped.slice(0, 120)) {
      ctx.fillRect(
        rect.x + point.escapeQ * rect.size - 1,
        rect.y + (1 - point.escapeP) * rect.size - 1,
        2,
        2,
      );
    }
  }
}

function drawPhaseSpace(layout, now) {
  const rect = layout.phase;
  const ctx = context2d;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  const partitionBounds = openingBounds(simulation.settings.openingWidth);
  for (const at of [partitionBounds.start, partitionBounds.end]) {
    ctx.beginPath();
    ctx.moveTo(rect.x + at * rect.size, rect.y);
    ctx.lineTo(rect.x + at * rect.size, rect.y + rect.size);
    ctx.moveTo(rect.x, rect.y + at * rect.size);
    ctx.lineTo(rect.x + rect.size, rect.y + at * rect.size);
    ctx.stroke();
  }
  drawWaveDensity(rect);
  drawOpening(rect, now);
  drawClassicalPoints(rect);
  ctx.strokeStyle = "rgba(219, 228, 224, 0.34)";
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "8px ui-monospace, monospace";
  ctx.textBaseline = "bottom";
  ctx.fillText("PHASE SPACE · q × p", rect.x, rect.y - 7);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.amber;
  ctx.fillText(`OPEN ${openingLabel(simulation.settings.openingWidth)}`, rect.x + rect.size, rect.y - 7);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawPositionSpectrum(chart, density) {
  const ctx = context2d;
  const x = chart.x;
  const y = chart.y + 20;
  const width = chart.width;
  const height = Math.min(92, chart.height * 0.24);
  let maximum = 0;
  for (const value of density) maximum = Math.max(maximum, value);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, y, width, height);
  if (maximum > 0) {
    const normScale = Math.sqrt(clamp(simulation.wave.norm, 0, 1));
    const bar = width / density.length;
    for (let index = 0; index < density.length; index += 1) {
      const amount = Math.sqrt(density[index] / maximum) * normScale;
      ctx.fillStyle = `rgba(181, 156, 255, ${0.06 + amount * 0.78})`;
      ctx.fillRect(x + index * bar, y + height * (1 - amount), Math.max(1, bar), height * amount);
    }
  }
  const bounds = openingBounds(simulation.settings.openingWidth);
  ctx.fillStyle = "rgba(255, 184, 107, 0.18)";
  ctx.fillRect(x + bounds.start * width, y, bounds.width * width, height);
  ctx.strokeStyle = COLORS.line;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = COLORS.violet;
  ctx.font = "8px ui-monospace, monospace";
  ctx.fillText("UNNORMALIZED WAVE · POSITION ENERGY", x, y - 7);
}

function drawTimeline(chart) {
  const ctx = context2d;
  const x = chart.x;
  const y = chart.y + Math.min(92, chart.height * 0.24) + 70;
  const width = chart.width;
  const height = Math.max(76, chart.height - (y - chart.y) - 28);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLORS.line;
  for (let lane = 1; lane < 4; lane += 1) {
    const lineY = y + lane * height / 4;
    ctx.beginPath();
    ctx.moveTo(x, lineY + 0.5);
    ctx.lineTo(x + width, lineY + 0.5);
    ctx.stroke();
  }
  if (history.length > 1) {
    const pointX = (index) => x + index / Math.max(1, history.length - 1) * width;
    const drawLine = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      history.forEach((point, index) => {
        const px = pointX(index);
        const py = y + height * (1 - clamp(point[key], 0, 1));
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    };
    drawLine("classical", COLORS.cyan);
    drawLine("wave", COLORS.violet);
    const barWidth = Math.max(1, width / history.length - 1);
    ctx.fillStyle = "rgba(255, 184, 107, 0.48)";
    history.forEach((point, index) => {
      const barHeight = clamp(point.flux, 0, 1) * height;
      ctx.fillRect(pointX(index), y + height - barHeight, barWidth, barHeight);
    });
  }
  ctx.strokeStyle = "rgba(219, 228, 224, 0.26)";
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "8px ui-monospace, monospace";
  ctx.fillText("SURVIVAL / NORM OVER MAP STEPS", x, y - 7);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText("POINTS", x, y + height + 15);
  ctx.fillStyle = COLORS.violet;
  ctx.fillText("WAVE", x + 52, y + height + 15);
  ctx.fillStyle = COLORS.amber;
  ctx.fillText("FLUX", x + 94, y + height + 15);
}

function drawCompactTelemetry(rect) {
  const ctx = context2d;
  const width = rect.size;
  const y = rect.y + rect.size - 20;
  const classical = classicalSurvivalRatio(simulation.classical);
  const wave = clamp(simulation.wave.norm, 0, 1);
  ctx.fillStyle = "rgba(5, 6, 8, 0.8)";
  ctx.fillRect(rect.x, y, width, 20);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(rect.x, y + 4, width * classical, 3);
  ctx.fillStyle = COLORS.violet;
  ctx.fillRect(rect.x, y + 12, width * wave, 3);
}

function drawStage(now) {
  drawGrid();
  const layout = stageLayout();
  drawPhaseSpace(layout, now);
  if (layout.chart) {
    drawPositionSpectrum(layout.chart, wavePositionDensity(simulation.wave));
    drawTimeline(layout.chart);
  } else {
    drawCompactTelemetry(layout.phase);
  }
}

function drawFrame(now) {
  frameId = null;
  if (disposed || !pageActive || document.hidden) return;
  const delta = lastFrameTime ? Math.min(250, now - lastFrameTime) : 0;
  lastFrameTime = now;
  if (state.playing) {
    stepAccumulator += delta;
    const stepInterval = 1_000 / state.stepRate;
    let catchup = 0;
    while (stepAccumulator >= stepInterval && catchup < 4) {
      stepAccumulator -= stepInterval;
      stepOnce();
      catchup += 1;
    }
  }
  if (visualizationDirty || now - lastDrawTime >= DRAW_INTERVAL || now < flashUntil) {
    drawStage(now);
    lastDrawTime = now;
    visualizationDirty = false;
  }
  if (state.playing || now < flashUntil) scheduleFrame();
}

function scheduleFrame() {
  if (frameId !== null || disposed || !pageActive || document.hidden) return;
  frameId = requestAnimationFrame(drawFrame);
}

function updatePacketFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const layout = stageLayout();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const rect = layout.phase;
  if (x < rect.x || x > rect.x + rect.size || y < rect.y || y > rect.y + rect.size) return false;
  state.packetPosition = clamp((x - rect.x) / rect.size, 0.02, 0.98);
  state.packetMomentum = clamp(1 - (y - rect.y) / rect.size, 0.02, 0.98);
  restartSimulation({ announceChange: false });
  return true;
}

function bindRange(id, key, { restart = false } = {}) {
  $(id).addEventListener("input", (event) => {
    state[key] = Number(event.currentTarget.value);
    if (key === "seed") state[key] = Math.round(state[key]);
    if (restart) restartSimulation({ announceChange: false });
    else {
      updateReadouts();
      if (key === "level") voices.setLevel(state.level);
    }
  });
  $(id).addEventListener("change", () => {
    if (restart) announce(`Packet restarted after changing ${id.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}.`);
  });
}

bindRange("packetPosition", "packetPosition", { restart: true });
bindRange("packetMomentum", "packetMomentum", { restart: true });
bindRange("packetSpread", "packetSpread", { restart: true });
bindRange("openingWidth", "openingWidth", { restart: true });
bindRange("seed", "seed", { restart: true });
bindRange("stepRate", "stepRate");
bindRange("level", "level");

$("audioButton").addEventListener("click", toggleAudio);
$("playButton").addEventListener("click", togglePlaying);
$("stepButton").addEventListener("click", () => stepOnce({ announceStep: true }));
$("restartButton").addEventListener("click", () => restartSimulation());
$("resetEscapeDust").addEventListener("click", resetAll);
$("viewModeButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) setView(button.dataset.view);
});

canvas.addEventListener("pointerdown", (event) => {
  if (!updatePacketFromPointer(event)) return;
  draggingPacket = true;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
canvas.addEventListener("pointermove", (event) => {
  if (!draggingPacket) return;
  updatePacketFromPointer(event);
  event.preventDefault();
});
canvas.addEventListener("pointerup", (event) => {
  if (!draggingPacket) return;
  draggingPacket = false;
  canvas.releasePointerCapture?.(event.pointerId);
  announce(`Packet moved to q ${state.packetPosition.toFixed(2)}, p ${state.packetMomentum.toFixed(2)} and restarted.`);
});
canvas.addEventListener("pointercancel", () => {
  draggingPacket = false;
});

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, select, textarea, button, a") || target.isContentEditable
  );
}

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    turnAudioOff();
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (event.key === " ") {
    event.preventDefault();
    togglePlaying();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    stepOnce({ announceStep: true });
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    restartSimulation();
  } else if (event.key.toLowerCase() === "v") {
    event.preventDefault();
    cycleView();
  }
});

const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resizeCanvas) : null;
resizeObserver?.observe(stageWrap);
if (!resizeObserver) globalThis.addEventListener("resize", resizeCanvas);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    voices.silence();
    return;
  }
  lastFrameTime = performance.now();
  if (state.audioOn) updateAudioVoices();
  visualizationDirty = true;
  scheduleFrame();
});

globalThis.addEventListener("pagehide", (event) => {
  pageActive = false;
  audioRequest += 1;
  state.playing = false;
  state.audioOn = false;
  state.audioStarting = false;
  voices.disable();
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  if (event.persisted) return;
  disposed = true;
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", resizeCanvas);
  void voices.close();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || disposed) return;
  pageActive = true;
  lastFrameTime = performance.now();
  updateReadouts();
  visualizationDirty = true;
  scheduleFrame();
});

voices.setLevel(state.level);
updateReadouts();
resizeCanvas();
scheduleFrame();
