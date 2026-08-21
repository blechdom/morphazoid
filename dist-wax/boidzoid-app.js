import {
  boidzoidSeed,
  createFlock,
  mapCrossingToVoice,
  minimumImage,
  stepFlock,
} from "./src/boidzoid.js";
import { KarplusStrongAudio } from "./src/karplus-strong.js";
import { clamp, createFixedStepper, lerp, wrap } from "./src/physics-common.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const skinCanvas = document.createElement("canvas");
const skinContext = skinCanvas.getContext("2d", { alpha: false });
const audio = new KarplusStrongAudio(globalThis);
const stepper = createFixedStepper({ step: 1 / 120, maxSubsteps: 6 });
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const compactViewport = window.matchMedia?.("(max-width: 650px)")?.matches === true;
const query = new URLSearchParams(window.location.search);
const ROOT_NAMES = Object.freeze({ 36: "C", 38: "D", 40: "E", 41: "F", 43: "G", 45: "A", 47: "B" });
const SCALE_LABELS = Object.freeze({
  dorian: "Dorian",
  minorPentatonic: "Minor pentatonic",
  majorPentatonic: "Major pentatonic",
  wholeTone: "Whole tone",
  pelog: "Pelog",
});
const PITCH_COLORS = Object.freeze([
  "#bdff67", "#73f0aa", "#5cf3c4", "#58e4dc", "#65dff1", "#80c9ff",
  "#9aafff", "#ad83ff", "#cb7cff", "#e582e6", "#ef91bd", "#f0b184",
]);

const DEFAULTS = Object.freeze({
  seed: boidzoidSeed(query.get("seed") || "morphazpod-01"),
  running: true,
  audioOn: false,
  level: 0.46,
  count: compactViewport ? 16 : 24,
  morph: 0.42,
  speed: compactViewport ? 0.105 : 0.12,
  cohesion: 0.54,
  alignment: 0.68,
  separation: 0.72,
  columns: compactViewport ? 14 : 18,
  rows: compactViewport ? 9 : 11,
  rootMidi: 38,
  scale: "dorian",
  pitchSpread: 3,
  decay: 1.8,
  damping: 0.46,
  brightness: 0.74,
  body: 0.38,
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
  trails: new Map(),
  pulses: [],
  pointer: { active: false, x: 0.5, y: 0.5, mode: "attract", startedX: 0, startedY: 0 },
  lure: { active: false, x: 0.5, y: 0.5, mode: "attract" },
  pluckCount: 0,
  lastCell: null,
  nextAudioAt: 0,
  audioStarting: false,
  skinRevision: 0,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameAt = performance.now();
let lastTrailAt = 0;
let lastUiAt = 0;
let pointerId = null;

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function rootName() {
  return ROOT_NAMES[state.rootMidi] ?? "D";
}

function scaleLabel() {
  return SCALE_LABELS[state.scale] ?? state.scale;
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
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
    rows: state.rows,
    columns: state.columns,
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
    crossingCooldown: compactViewport ? 0.15 : 0.12,
  };
}

function voiceOptions() {
  const flock = effectiveFlockSettings();
  return {
    rootMidi: state.rootMidi,
    scale: state.scale,
    octaves: state.pitchSpread,
    decay: state.decay,
    damping: state.damping,
    brightness: state.brightness,
    body: state.body,
    level: state.level,
    seed: state.seed + state.skinRevision * 97,
    aspect: aspect(),
    minSpeed: flock.minSpeed,
    maxSpeed: flock.maxSpeed,
    rows: state.rows,
    columns: state.columns,
  };
}

function resetFlock({ advanceSeed = false, announceReset = false } = {}) {
  if (advanceSeed) state.seed = boidzoidSeed(state.seed + 0x9e3779b9);
  const settings = effectiveFlockSettings();
  state.boids = createFlock({ ...settings, count: state.count });
  state.trails.clear();
  state.pulses = [];
  state.lastCell = null;
  if (announceReset) announce(`${state.count} playheads scattered across the karpet.`);
  scheduleFrame();
}

function rebaseSkin() {
  stepFlock(state.boids, 0, effectiveFlockSettings());
  state.trails.clear();
  state.pulses = [];
  buildSkinCache();
}

function noteColor(pitchClass, alpha = 1) {
  const color = PITCH_COLORS[wrap(Math.round(pitchClass), PITCH_COLORS.length)];
  if (alpha >= 0.999) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function skinScalePath(drawingContext, centerX, centerY, width, height) {
  drawingContext.beginPath();
  drawingContext.moveTo(centerX, centerY - height * 0.52);
  drawingContext.bezierCurveTo(
    centerX + width * 0.31,
    centerY - height * 0.46,
    centerX + width * 0.53,
    centerY - height * 0.2,
    centerX + width * 0.5,
    centerY + height * 0.02,
  );
  drawingContext.bezierCurveTo(
    centerX + width * 0.47,
    centerY + height * 0.26,
    centerX + width * 0.19,
    centerY + height * 0.45,
    centerX,
    centerY + height * 0.57,
  );
  drawingContext.bezierCurveTo(
    centerX - width * 0.19,
    centerY + height * 0.45,
    centerX - width * 0.47,
    centerY + height * 0.26,
    centerX - width * 0.5,
    centerY + height * 0.02,
  );
  drawingContext.bezierCurveTo(
    centerX - width * 0.53,
    centerY - height * 0.2,
    centerX - width * 0.31,
    centerY - height * 0.46,
    centerX,
    centerY - height * 0.52,
  );
  drawingContext.closePath();
}

function cellCenter(row, column) {
  return {
    x: wrap((column + 0.5 + (row % 2 ? 0.5 : 0)) / state.columns, 1),
    y: (row + 0.5) / state.rows,
  };
}

function skinVariation(row, column) {
  const value = Math.imul((row + 1) ^ state.seed, 0x45d9f3b)
    ^ Math.imul((column + 3) ^ (state.seed >>> 4), 0x119de1f3)
    ^ Math.imul(state.skinRevision + 1, 0x9e3779b1);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

function buildSkinCache() {
  if (cssWidth < 2 || cssHeight < 2) return;
  skinCanvas.width = canvas.width;
  skinCanvas.height = canvas.height;
  skinContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  skinContext.clearRect(0, 0, cssWidth, cssHeight);

  const base = skinContext.createLinearGradient(0, 0, cssWidth, cssHeight);
  base.addColorStop(0, "#06100b");
  base.addColorStop(0.48, "#09110d");
  base.addColorStop(1, "#110b16");
  skinContext.fillStyle = base;
  skinContext.fillRect(0, 0, cssWidth, cssHeight);

  const cellWidth = cssWidth / state.columns;
  const cellHeight = cssHeight / state.rows;
  const voice = voiceOptions();
  for (let row = -1; row <= state.rows; row += 1) {
    for (let column = -1; column <= state.columns; column += 1) {
      const wrappedRow = wrap(row, state.rows);
      const wrappedColumn = wrap(column, state.columns);
      const center = cellCenter(wrappedRow, wrappedColumn);
      let x = (column + 0.5 + (wrappedRow % 2 ? 0.5 : 0)) * cellWidth;
      if (row < 0) x += cellWidth * 0.5;
      const y = (row + 0.5) * cellHeight;
      const recipe = mapCrossingToVoice({
        row: wrappedRow,
        column: wrappedColumn,
        cellId: wrappedRow * state.columns + wrappedColumn,
        rows: state.rows,
        columns: state.columns,
        x: center.x,
        y: center.y,
      }, voice);
      const variation = skinVariation(wrappedRow, wrappedColumn);
      const scaleGradient = skinContext.createLinearGradient(
        x - cellWidth * 0.45,
        y - cellHeight * 0.46,
        x + cellWidth * 0.42,
        y + cellHeight * 0.52,
      );
      scaleGradient.addColorStop(0, noteColor(recipe.pitchClass, 0.085 + variation * 0.025));
      scaleGradient.addColorStop(0.58, `rgba(13, 31, 23, ${0.68 + variation * 0.13})`);
      scaleGradient.addColorStop(1, "rgba(42, 21, 51, 0.25)");
      skinScalePath(skinContext, x, y, cellWidth * 1.13, cellHeight * 1.16);
      skinContext.fillStyle = scaleGradient;
      skinContext.fill();
      skinContext.lineWidth = Math.max(0.65, Math.min(1.25, cellWidth * 0.018));
      skinContext.strokeStyle = noteColor(recipe.pitchClass, 0.16 + variation * 0.08);
      skinContext.stroke();

      skinContext.beginPath();
      skinContext.moveTo(x - cellWidth * 0.36, y + cellHeight * 0.03);
      skinContext.quadraticCurveTo(x, y + cellHeight * 0.28, x + cellWidth * 0.36, y + cellHeight * 0.03);
      skinContext.strokeStyle = `rgba(189, 255, 103, ${0.025 + variation * 0.025})`;
      skinContext.stroke();
    }
  }

  const sheen = skinContext.createRadialGradient(
    cssWidth * 0.42,
    cssHeight * 0.38,
    0,
    cssWidth * 0.42,
    cssHeight * 0.38,
    Math.max(cssWidth, cssHeight) * 0.78,
  );
  sheen.addColorStop(0, "rgba(112, 255, 191, 0.075)");
  sheen.addColorStop(0.45, "rgba(43, 138, 104, 0.018)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.48)");
  skinContext.fillStyle = sheen;
  skinContext.fillRect(0, 0, cssWidth, cssHeight);
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
  buildSkinCache();
  scheduleFrame();
}

function pushTrails(now) {
  if (now - lastTrailAt < (reducedMotion ? 90 : 42)) return;
  lastTrailAt = now;
  const maxLength = reducedMotion ? 3 : compactViewport ? 7 : 11;
  const activeIds = new Set();
  for (const boid of state.boids) {
    activeIds.add(boid.id);
    const trail = state.trails.get(boid.id) ?? [];
    trail.push({ x: boid.x, y: boid.y });
    if (trail.length > maxLength) trail.splice(0, trail.length - maxLength);
    state.trails.set(boid.id, trail);
  }
  for (const id of state.trails.keys()) {
    if (!activeIds.has(id)) state.trails.delete(id);
  }
}

function drawFlockConnections() {
  context.save();
  context.lineWidth = 0.55;
  for (let left = 0; left < state.boids.length; left += 1) {
    for (let right = left + 1; right < state.boids.length; right += 1) {
      const a = state.boids[left];
      const b = state.boids[right];
      const dx = minimumImage(b.x - a.x);
      const dy = minimumImage(b.y - a.y);
      const distance = Math.hypot(dx * aspect(), dy);
      if (distance > 0.105) continue;
      context.globalAlpha = (1 - distance / 0.105) * 0.16;
      context.strokeStyle = left % 3 === 0 ? "#ad83ff" : "#5cf3c4";
      context.beginPath();
      context.moveTo(a.x * cssWidth, a.y * cssHeight);
      context.lineTo((a.x + dx) * cssWidth, (a.y + dy) * cssHeight);
      context.stroke();
    }
  }
  context.restore();
}

function drawTrails() {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const boid of state.boids) {
    const trail = state.trails.get(boid.id) ?? [];
    if (trail.length < 2) continue;
    context.strokeStyle = boid.id % 4 === 0 ? "rgba(173, 131, 255, 0.25)" : "rgba(92, 243, 196, 0.22)";
    context.lineWidth = boid.id % 7 === 0 ? 1.4 : 0.9;
    context.beginPath();
    let started = false;
    for (let index = 0; index < trail.length; index += 1) {
      const point = trail[index];
      const previous = trail[index - 1];
      if (previous && (Math.abs(point.x - previous.x) > 0.4 || Math.abs(point.y - previous.y) > 0.4)) {
        started = false;
      }
      if (!started) {
        context.moveTo(point.x * cssWidth, point.y * cssHeight);
        started = true;
      } else context.lineTo(point.x * cssWidth, point.y * cssHeight);
    }
    context.stroke();
  }
  context.restore();
}

function drawPulses(now) {
  state.pulses = state.pulses.filter((pulse) => now - pulse.startedAt < (reducedMotion ? 440 : 1_050));
  const cellWidth = cssWidth / state.columns;
  const cellHeight = cssHeight / state.rows;
  context.save();
  for (const pulse of state.pulses) {
    const age = clamp((now - pulse.startedAt) / (reducedMotion ? 440 : 1_050));
    const center = cellCenter(pulse.row, pulse.column);
    const x = center.x * cssWidth;
    const y = center.y * cssHeight;
    const alpha = (1 - age) ** 1.7;
    skinScalePath(context, x, y, cellWidth * (1.12 + age * 0.34), cellHeight * (1.16 + age * 0.34));
    context.fillStyle = noteColor(pulse.pitchClass, alpha * 0.18);
    context.fill();
    context.lineWidth = 1.2 + (1 - age) * 0.8;
    context.strokeStyle = noteColor(pulse.pitchClass, alpha * 0.78);
    context.stroke();
    if (!reducedMotion) {
      context.beginPath();
      context.arc(x, y, Math.min(cellWidth, cellHeight) * (0.18 + age * 0.95), 0, Math.PI * 2);
      context.strokeStyle = noteColor(pulse.pitchClass, alpha * 0.36);
      context.lineWidth = 0.8;
      context.stroke();
    }
  }
  context.restore();
}

function drawBoids() {
  const scale = clamp(Math.min(cssWidth, cssHeight) / 640, 0.7, 1.3);
  context.save();
  for (const boid of state.boids) {
    const x = boid.x * cssWidth;
    const y = boid.y * cssHeight;
    const angle = Math.atan2(boid.vy * cssHeight, boid.vx * cssWidth);
    const size = (boid.id % 7 === 0 ? 7.8 : 5.8) * scale;
    const accent = boid.id % 5 === 0 ? "#bdff67" : boid.id % 3 === 0 ? "#ad83ff" : "#5cf3c4";
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    if (!reducedMotion && boid.id % 3 === 0) {
      context.shadowColor = accent;
      context.shadowBlur = 10;
    }
    context.beginPath();
    context.moveTo(size * 2.1, 0);
    context.bezierCurveTo(size * 0.8, -size * 0.78, -size * 0.42, -size * 0.66, -size * 1.28, 0);
    context.bezierCurveTo(-size * 0.42, size * 0.66, size * 0.8, size * 0.78, size * 2.1, 0);
    context.fillStyle = accent;
    context.globalAlpha = 0.88;
    context.fill();
    context.shadowBlur = 0;
    context.beginPath();
    context.moveTo(-size * 1.15, 0);
    context.lineTo(-size * 2.05, -size * 0.74);
    context.lineTo(-size * 1.72, 0);
    context.lineTo(-size * 2.05, size * 0.74);
    context.strokeStyle = accent;
    context.globalAlpha = 0.5;
    context.lineWidth = Math.max(0.75, scale);
    context.stroke();
    context.beginPath();
    context.arc(size * 0.95, -size * 0.15, Math.max(1, size * 0.15), 0, Math.PI * 2);
    context.fillStyle = "#06100c";
    context.globalAlpha = 0.9;
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

function draw(now = performance.now()) {
  scheduledFrame = 0;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  if (skinCanvas.width > 0) {
    context.drawImage(skinCanvas, 0, 0, skinCanvas.width, skinCanvas.height, 0, 0, cssWidth, cssHeight);
  }
  drawPulses(now);
  drawFlockConnections();
  drawTrails();
  drawBoids();
  drawAttractor(state.pointer, "TOUCH");
  drawAttractor(state.lure, "LURE");
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(draw);
}

function addCrossingPulse(crossing, recipe, now) {
  state.pulses.push({
    row: crossing.row,
    column: crossing.column,
    pitchClass: recipe.pitchClass,
    startedAt: now,
  });
  if (state.pulses.length > 72) state.pulses.splice(0, state.pulses.length - 72);
}

function handleCrossings(crossings, now) {
  if (crossings.length === 0) return;
  const mapped = crossings.map((crossing) => ({
    crossing,
    recipe: mapCrossingToVoice(crossing, voiceOptions()),
  }));
  for (const { crossing, recipe } of mapped) addCrossingPulse(crossing, recipe, now);
  state.pluckCount += mapped.length;
  state.lastCell = mapped.at(-1).crossing;

  if (!state.audioOn || now < state.nextAudioAt) return;
  const chosen = mapped.reduce((best, candidate) => (
    !best || candidate.crossing.energy > best.crossing.energy ? candidate : best
  ), null);
  state.nextAudioAt = now + (compactViewport ? 105 : 72);
  void audio.pluck(chosen.recipe.frequency, chosen.recipe.settings, {
    velocity: chosen.recipe.velocity,
    pan: chosen.recipe.pan,
  }).catch(showError);
}

function simulationAttractors() {
  const attractors = [];
  if (state.pointer.active) {
    attractors.push({
      active: true,
      x: state.pointer.x,
      y: state.pointer.y,
      mode: state.pointer.mode,
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
  $("metricCell").textContent = state.lastCell
    ? `${String(state.lastCell.column + 1).padStart(2, "0")}.${String(state.lastCell.row + 1).padStart(2, "0")}`
    : "—";
  $("metricPlucks").textContent = String(state.pluckCount);
  $("podState").textContent = state.running ? state.audioOn ? "listening" : "drifting" : "suspended";
  $("podState").classList.toggle("is-paused", !state.running);
  $("motionSummary").textContent = `${state.running ? "running" : "paused"} · ${state.lure.active ? "lured" : "untamed"}`;
  $("flockSummary").textContent = `${state.boids.length} · ${state.morph < 0.28 ? "calm" : state.morph > 0.72 ? "feral" : "balanced"}`;
  $("skinSummary").textContent = `${rootName()} · ${scaleLabel()} · ${state.columns}×${state.rows}`;
  $("stageReadout").textContent = `${state.boids.length} PLAYHEADS · ${rootName()} ${scaleLabel()} · ${state.audioOn ? "POD AWAKE" : "POD ASLEEP"}`;
  canvas.setAttribute("aria-label", `${state.boids.length} flocking playheads crossing a ${state.columns} by ${state.rows} snake-scale ${rootName()} ${scaleLabel()} Karplus string surface.`);
}

function animate(now) {
  scheduledFrame = 0;
  const deltaSeconds = clamp((now - lastFrameAt) / 1_000, 0, 0.05);
  lastFrameAt = now;
  if (state.running && !document.hidden) {
    const settings = { ...effectiveFlockSettings(), attractors: simulationAttractors() };
    const crossings = [];
    stepper.advance(deltaSeconds, (step) => {
      crossings.push(...stepFlock(state.boids, step, settings));
    });
    handleCrossings(crossings, now);
    pushTrails(now);
  } else if (!state.running) stepper.reset();
  updateUi(now);
  draw(now);
  scheduledFrame = requestAnimationFrame(animate);
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  if (state.audioOn) {
    state.audioOn = false;
    audio.setOutput(0);
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    $("stageInvitation").classList.remove("is-awake");
    $("stageInvitation").querySelector("b").textContent = "turn on audio";
    $("stageInvitation").querySelector("span").textContent = "drag the skin to shepherd the pod";
    updateUi(performance.now(), true);
    announce("Boidzoid audio off. The pod continues to drift silently.");
    return;
  }

  state.audioStarting = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting";
  try {
    await audio.start();
    state.audioOn = true;
    state.nextAudioAt = performance.now() + 80;
    audio.setOutput(state.level);
    $("audioButton").setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    $("stageInvitation").classList.add("is-awake");
    $("stageInvitation").querySelector("b").textContent = "pod awake";
    $("stageInvitation").querySelector("span").textContent = "every ridge crossing plucks the karpet";
    announce("Boidzoid audio on. Ridge crossings now pluck the Karplus karpet.");
  } catch (error) {
    state.audioOn = false;
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
  announce(state.running ? "Flock running." : "Flock paused.");
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
    skinDensity: () => `${state.columns} × ${state.rows}`,
    pitchSpread: (number) => `${Number(number).toFixed(0)} oct`,
    decay: (number) => `${Number(number).toFixed(2).replace(/0$/, "")} s`,
    damping: formatPercent,
    brightness: formatPercent,
    body: formatPercent,
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
    skinDensity: state.columns,
    pitchSpread: state.pitchSpread,
    decay: state.decay,
    damping: state.damping,
    brightness: state.brightness,
    body: state.body,
  };
  for (const [id, value] of Object.entries(fields)) {
    $(id).value = String(value);
    updateRangeOutput(id, value);
  }
  $("rootNote").value = String(state.rootMidi);
  $("scaleMode").value = state.scale;
  updateUi(performance.now(), true);
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

function buttonLabel(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
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
  const point = normalizedPointer(event);
  pointerId = event.pointerId;
  Object.assign(state.pointer, point, {
    active: true,
    mode: event.shiftKey || event.button === 2 ? "repel" : "attract",
    startedX: event.clientX,
    startedY: event.clientY,
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
  $("remapButton").addEventListener("click", () => {
    state.skinRevision += 1;
    rebaseSkin();
    announce("The snake skin shed. String materials have been remapped.");
  });

  const simpleRanges = {
    level: "level",
    morph: "morph",
    speed: "speed",
    cohesion: "cohesion",
    alignment: "alignment",
    separation: "separation",
    pitchSpread: "pitchSpread",
    decay: "decay",
    damping: "damping",
    brightness: "brightness",
    body: "body",
  };
  for (const [id, key] of Object.entries(simpleRanges)) {
    $(id).addEventListener("input", (event) => {
      state[key] = Number(event.target.value);
      updateRangeOutput(id, state[key]);
      if (id === "level") audio.setOutput(state.audioOn ? state.level : 0);
      if (["pitchSpread"].includes(id)) buildSkinCache();
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
  $("skinDensity").addEventListener("input", (event) => {
    state.columns = Math.round(Number(event.target.value));
    state.rows = Math.max(6, Math.round(state.columns * 11 / 18));
    updateRangeOutput("skinDensity", state.columns);
    rebaseSkin();
    updateUi(performance.now(), true);
  });
  $("rootNote").addEventListener("change", (event) => {
    state.rootMidi = Number(event.target.value);
    buildSkinCache();
    updateUi(performance.now(), true);
  });
  $("scaleMode").addEventListener("change", (event) => {
    state.scale = event.target.value;
    buildSkinCache();
    updateUi(performance.now(), true);
  });
  for (const button of document.querySelectorAll("[data-temperament]")) {
    button.addEventListener("click", () => applyTemperament(button.dataset.temperament));
  }
  $("resetAll").addEventListener("click", () => {
    const preservedAudio = state.audioOn;
    Object.assign(state, DEFAULTS, { audioOn: preservedAudio, running: true, pluckCount: 0, skinRevision: 0 });
    state.lure.active = false;
    paintControls();
    for (const button of document.querySelectorAll("[data-temperament]")) {
      button.setAttribute("aria-pressed", String(button.dataset.temperament === "graze"));
    }
    setRunning(true);
    audio.setOutput(state.audioOn ? state.level : 0);
    resetFlock();
    buildSkinCache();
    announce("Boidzoid reset to the baseline Morphazpod.");
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
        handleCrossings(stepFlock(state.boids, 1 / 120, settings), performance.now());
      }
      pushTrails(performance.now());
      updateUi(performance.now(), true);
      draw();
      return this.snapshot();
    },
    snapshot() {
      return {
        boids: state.boids.map(({ id, x, y, vx, vy, cellId }) => ({ id, x, y, vx, vy, cellId })),
        plucks: state.pluckCount,
        rows: state.rows,
        columns: state.columns,
      };
    },
  });
  return true;
}

resizeCanvas();
resetFlock();
paintControls();
bindControls();
const manual = installManualHook();
if (typeof ResizeObserver === "function") new ResizeObserver(resizeCanvas).observe(stageWrap);
else window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  lastFrameAt = performance.now();
  stepper.reset();
});
window.addEventListener("pagehide", () => { void audio.close(); }, { once: true });
if (manual) {
  draw();
} else {
  scheduledFrame = requestAnimationFrame(animate);
}
