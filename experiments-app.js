const TAU = Math.PI * 2;
const MAX_CONTINUOUS_VOICES = 12;
const PENTATONIC = [0, 2, 3, 5, 7, 10, 12, 14];

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
const wrap01 = (value) => ((value % 1) + 1) % 1;
const percent = (value) => `${Math.round(clamp(value, 0, 1) * 100)}%`;
const compact = (value, digits = 2) => Number(value).toFixed(digits).replace(/\.?0+$/, "");

function gcd(first, second) {
  let a = Math.abs(Math.round(first));
  let b = Math.abs(Math.round(second));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

class ExperimentAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.voices = [];
    this.level = 0.45;
    this.running = false;
  }

  async start() {
    if (!this.context) {
      const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (typeof AudioContextCtor !== "function") {
        throw new Error("Web Audio is not available in this browser.");
      }
      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = this.level;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.12;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.running = true;
  }

  setLevel(level) {
    this.level = clamp(Number(level) || 0, 0, 0.82);
    const now = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(this.level, now, 0.025);
  }

  ensureVoice(index, type = "sine") {
    if (this.voices[index]) {
      this.voices[index].oscillator.type = type;
      return this.voices[index];
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = type;
    oscillator.frequency.value = 220;
    gain.gain.value = 0;
    if (panner) {
      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      oscillator.connect(gain);
      gain.connect(this.master);
    }
    oscillator.start();
    this.voices[index] = { oscillator, gain, panner };
    return this.voices[index];
  }

  setDrone(items = []) {
    if (!this.running || !this.context) return;
    const now = this.context.currentTime;
    for (let index = 0; index < MAX_CONTINUOUS_VOICES; index += 1) {
      const item = items[index];
      if (!item || item.gain <= 0) {
        this.voices[index]?.gain.gain.setTargetAtTime(0, now, 0.04);
        continue;
      }
      const voice = this.ensureVoice(index, item.type ?? "sine");
      const frequency = clamp(Number(item.frequency) || 220, 18, 16_000);
      const gain = clamp(Number(item.gain) || 0, 0, 0.32);
      voice.oscillator.frequency.setTargetAtTime(frequency, now, 0.025);
      voice.gain.gain.setTargetAtTime(gain, now, 0.04);
      voice.panner?.pan.setTargetAtTime(clamp(item.pan ?? 0, -1, 1), now, 0.04);
    }
  }

  trigger({ frequency, gain = 0.18, duration = 0.12, type = "sine", pan = 0 }) {
    if (!this.running || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(clamp(frequency, 20, 12_000), now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(clamp(gain, 0.001, 0.8), now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      oscillator.connect(envelope);
      envelope.connect(panner);
      panner.connect(this.master);
    } else {
      oscillator.connect(envelope);
      envelope.connect(this.master);
    }
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  silence() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) voice?.gain.gain.setTargetAtTime(0, now, 0.035);
  }

  async stop() {
    this.running = false;
    this.silence();
    if (this.context?.state === "running") await this.context.suspend();
  }

  dispose() {
    this.running = false;
    this.silence();
    this.context?.close?.();
  }
}

const canvas = $("stage");
const context2d = canvas?.getContext("2d", { alpha: true, desynchronized: true });
const audio = new ExperimentAudio();
const experiment = document.body?.dataset?.experiment ?? "moire";
const controls = new Map();
const state = {
  audioOn: false,
  audioStarting: false,
  time: 0,
  lastFrame: 0,
  level: Number($("level")?.value) || 0.45,
  moirePhase: 0,
  springY: [],
  springV: [],
  springCount: 0,
  gearAngle: 0,
  lastGearA: null,
  lastGearB: null,
  lastGearHit: 0,
  caRows: [],
  caAccumulator: 0,
  caSeed: 1,
  caStats: { density: 0, transitions: 0 },
};

let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let animationFrame = 0;
let patternCanvas = null;

function readControl(id, fallback = 0) {
  const element = $(id);
  if (!element) return fallback;
  return Number(element.value) || fallback;
}

function bindRange(id, key, formatter = (value) => compact(value)) {
  const element = $(id);
  if (!element) return;
  const output = $(`${id}Out`);
  const sync = () => {
    state[key] = Number(element.value);
    if (output) output.textContent = formatter(state[key]);
    if (experiment === "springs" && key === "springMasses") ensureSpringState(true);
    if (experiment === "automata" && (key === "caWidth" || key === "caRule")) seedAutomata();
    updateSummaries();
  };
  element.addEventListener("input", sync);
  controls.set(id, sync);
  sync();
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setAudioState() {
  $("audioButton")?.setAttribute("aria-pressed", String(state.audioOn));
  setText("audioState", state.audioOn ? "on" : "off");
}

function resizeCanvas() {
  if (!canvas || !context2d) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (width === canvasWidth && height === canvasHeight && scale === canvasScale) return;
  canvasWidth = width;
  canvasHeight = height;
  canvasScale = scale;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context2d.setTransform(scale, 0, 0, scale, 0, 0);
}

function clearStage() {
  const ctx = context2d;
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function updateCommonAudio() {
  audio.setLevel(state.level);
  if (!state.audioOn) return;
  const active = EXPERIMENTS[experiment];
  audio.setDrone(active.drone ? active.drone() : []);
}

function updateSummaries() {
  const active = EXPERIMENTS[experiment];
  active.summary?.();
}

function drawMoire() {
  const ctx = context2d;
  clearStage();
  const spacing = state.moireSpacing;
  const angle = (state.moireAngle * Math.PI) / 180;
  const phase = state.moirePhase * spacing;
  const diagonal = Math.hypot(canvasWidth, canvasHeight) * 0.72;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  function stripeSet(rotation, offset, strokeStyle, alpha, width = 2) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = width;
    for (let x = -diagonal * 1.4; x <= diagonal * 1.4; x += spacing) {
      const shifted = x + offset;
      ctx.beginPath();
      ctx.moveTo(shifted, -diagonal);
      ctx.lineTo(shifted, diagonal);
      ctx.stroke();
    }
    ctx.restore();
  }

  const fringe = moireFringeSpan();
  if (Number.isFinite(fringe) && fringe < 2200) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 2);
    ctx.strokeStyle = "rgba(240, 203, 118, 0.16)";
    ctx.lineWidth = Math.max(7, fringe * 0.035);
    for (let x = -diagonal * 1.4; x <= diagonal * 1.4; x += fringe) {
      ctx.beginPath();
      ctx.moveTo(x + phase * 0.3, -diagonal);
      ctx.lineTo(x + phase * 0.3, diagonal);
      ctx.stroke();
    }
    ctx.restore();
  }

  stripeSet(-angle / 2, phase, "rgba(103, 226, 208, 0.82)", 0.9, 1.7);
  stripeSet(angle / 2, -phase * 0.72, "rgba(255, 143, 156, 0.76)", 0.9, 1.7);

  ctx.fillStyle = "rgba(219, 228, 224, 0.07)";
  ctx.fillRect(0, canvasHeight - 42, canvasWidth, 42);
}

function moireFringeSpan() {
  const angle = Math.max(0.001, (state.moireAngle * Math.PI) / 180);
  return state.moireSpacing / (2 * Math.sin(angle / 2));
}

function moireBeatHz() {
  const fringe = moireFringeSpan();
  return clamp((state.moireDrift * state.moireSpacing) / Math.max(36, fringe) * 9, 0.02, 8);
}

function chladniValue(x, y, n = state.chladniN, m = state.chladniM) {
  return Math.sin(n * Math.PI * x) * Math.sin(m * Math.PI * y);
}

function drawChladni() {
  const ctx = context2d;
  clearStage();
  const gridWidth = 180;
  const gridHeight = 128;
  if (!patternCanvas) patternCanvas = document.createElement("canvas");
  if (patternCanvas.width !== gridWidth || patternCanvas.height !== gridHeight) {
    patternCanvas.width = gridWidth;
    patternCanvas.height = gridHeight;
  }
  const pctx = patternCanvas.getContext("2d");
  const image = pctx.createImageData(gridWidth, gridHeight);
  const n = Math.round(state.chladniN);
  const m = Math.round(state.chladniM);
  const t = state.time;
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const u = x / (gridWidth - 1);
      const v = y / (gridHeight - 1);
      const value = chladniValue(u, v, n, m);
      const node = Math.exp(-Math.abs(value) * 34);
      const shimmer = 0.5 + 0.5 * Math.sin(t * 3 + value * 8);
      const index = (y * gridWidth + x) * 4;
      image.data[index] = Math.round(16 + node * 228 + shimmer * 18);
      image.data[index + 1] = Math.round(22 + node * 195 + Math.abs(value) * 36);
      image.data[index + 2] = Math.round(25 + node * 138 + Math.abs(value) * 72);
      image.data[index + 3] = 255;
    }
  }
  pctx.putImageData(image, 0, 0);
  const side = Math.min(canvasWidth, canvasHeight) * 0.76;
  const x = (canvasWidth - side) / 2;
  const y = (canvasHeight - side) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(patternCanvas, x, y, side, side);
  ctx.strokeStyle = "rgba(219, 228, 224, 0.34)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, side, side);
  ctx.fillStyle = "rgba(255, 143, 156, 0.92)";
  ctx.beginPath();
  ctx.arc(x + state.excitationX * side, y + state.excitationY * side, 7, 0, TAU);
  ctx.fill();
}

function ensureSpringState(force = false) {
  const count = Math.round(state.springMasses || readControl("springMasses", 14));
  if (!force && state.springCount === count && state.springY.length === count) return;
  state.springCount = count;
  state.springY = Array.from({ length: count }, (_, index) => {
    const center = (count - 1) / 2;
    return -0.42 * Math.exp(-((index - center) ** 2) / Math.max(2, count * 0.26));
  });
  state.springV = Array.from({ length: count }, () => 0);
}

function pluckSpring(normalizedX = 0.5) {
  ensureSpringState();
  const index = clamp(Math.round(normalizedX * (state.springCount - 1)), 0, state.springCount - 1);
  for (let offset = -2; offset <= 2; offset += 1) {
    const target = index + offset;
    if (target < 0 || target >= state.springCount) continue;
    state.springY[target] -= 0.5 * Math.exp(-Math.abs(offset) * 0.72);
  }
  audio.trigger({ frequency: 96, gain: 0.2, duration: 0.18, type: "triangle", pan: normalizedX * 2 - 1 });
}

function stepSprings(dt) {
  ensureSpringState();
  const count = state.springCount;
  const nextY = state.springY.slice();
  const nextV = state.springV.slice();
  const stiffness = state.springStiffness * 38;
  const damping = state.springDamping * 16;
  const drive = state.springDrive;
  const step = Math.min(dt, 1 / 45);
  for (let i = 0; i < count; i += 1) {
    const left = i === 0 ? 0 : state.springY[i - 1];
    const right = i === count - 1 ? 0 : state.springY[i + 1];
    let force = stiffness * (left + right - 2 * state.springY[i]);
    if (i === 0) force += drive * 18 * Math.sin(state.time * TAU * 0.8);
    force -= damping * state.springV[i];
    nextV[i] = clamp(state.springV[i] + force * step, -9, 9);
    nextY[i] = clamp(state.springY[i] + nextV[i] * step, -1.15, 1.15);
  }
  state.springY = nextY;
  state.springV = nextV;
}

function drawSprings() {
  const ctx = context2d;
  clearStage();
  ensureSpringState();
  const margin = Math.max(34, canvasWidth * 0.08);
  const usable = canvasWidth - margin * 2;
  const baseline = canvasHeight * 0.56;
  const amplitude = Math.min(canvasHeight * 0.28, 150);
  const points = state.springY.map((value, index) => ({
    x: margin + ((index + 1) / (state.springCount + 1)) * usable,
    y: baseline + value * amplitude,
  }));
  ctx.strokeStyle = "rgba(119, 131, 126, 0.38)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin, baseline);
  ctx.lineTo(canvasWidth - margin, baseline);
  ctx.stroke();
  ctx.strokeStyle = "rgba(103, 226, 208, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, baseline);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(canvasWidth - margin, baseline);
  ctx.stroke();
  for (const point of points) {
    const displacement = Math.abs((point.y - baseline) / amplitude);
    ctx.fillStyle = `rgba(${Math.round(120 + displacement * 120)}, ${Math.round(190 + displacement * 40)}, 208, 0.95)`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5 + displacement * 5, 0, TAU);
    ctx.fill();
  }
}

function drawGear(ctx, cx, cy, radius, teeth, angle, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(11, 14, 17, 0.86)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let tooth = 0; tooth < teeth * 2; tooth += 1) {
    const a = (tooth / (teeth * 2)) * TAU;
    const r = radius * (tooth % 2 === 0 ? 1.09 : 0.98);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (tooth === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(219, 228, 224, 0.24)";
  ctx.lineWidth = 1;
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const a = (tooth / teeth) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius * 0.28, Math.sin(a) * radius * 0.28);
    ctx.lineTo(Math.cos(a) * radius * 0.86, Math.sin(a) * radius * 0.86);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.22, 0, TAU);
  ctx.strokeStyle = "rgba(240, 203, 118, 0.75)";
  ctx.stroke();
  ctx.restore();
}

function stepGears(dt) {
  const teethA = Math.round(state.gearTeethA);
  const teethB = Math.round(state.gearTeethB);
  state.gearAngle += state.gearSpeed * TAU * dt;
  const toothA = Math.floor((state.gearAngle / TAU) * teethA);
  const toothB = Math.floor((-state.gearAngle * teethA / teethB / TAU) * teethB);
  if (state.audioOn && state.time - state.lastGearHit > 0.018) {
    if (state.lastGearA !== null && toothA !== state.lastGearA) {
      audio.trigger({ frequency: 58 + teethA * 1.8, gain: 0.2, duration: 0.075, type: "triangle", pan: -0.32 });
      state.lastGearHit = state.time;
    }
    if (state.lastGearB !== null && toothB !== state.lastGearB) {
      audio.trigger({ frequency: 140 + teethB * 3.4, gain: 0.13, duration: 0.045, type: "square", pan: 0.32 });
      state.lastGearHit = state.time;
    }
  }
  state.lastGearA = toothA;
  state.lastGearB = toothB;
}

function drawGears() {
  const ctx = context2d;
  clearStage();
  const teethA = Math.round(state.gearTeethA);
  const teethB = Math.round(state.gearTeethB);
  const base = Math.min(canvasWidth, canvasHeight) * 0.19;
  const radiusA = base * Math.sqrt(teethA / 16);
  const radiusB = base * Math.sqrt(teethB / 16);
  const gap = radiusA + radiusB;
  const cxA = canvasWidth / 2 - gap / 2;
  const cxB = canvasWidth / 2 + gap / 2;
  const cy = canvasHeight * 0.55;
  drawGear(ctx, cxA, cy, radiusA, teethA, state.gearAngle, "rgba(103, 226, 208, 0.88)");
  drawGear(ctx, cxB, cy, radiusB, teethB, -state.gearAngle * teethA / teethB, "rgba(255, 143, 156, 0.86)");
  ctx.strokeStyle = "rgba(240, 203, 118, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvasWidth / 2, cy - 24);
  ctx.lineTo(canvasWidth / 2, cy + 24);
  ctx.stroke();
}

function ruleBit(rule, left, center, right) {
  const index = (left << 2) | (center << 1) | right;
  return (rule >> index) & 1;
}

function randomUnit() {
  state.caSeed = (1664525 * state.caSeed + 1013904223) >>> 0;
  return state.caSeed / 0x100000000;
}

function seedAutomata() {
  const width = Math.round(state.caWidth || readControl("caWidth", 72));
  const density = clamp(state.caDensity ?? readControl("caDensity", 0.18), 0, 1);
  state.caSeed = ((Date.now() * 2654435761) >>> 0) || 1;
  const row = Array.from({ length: width }, (_, index) => {
    if (density <= 0.001) return index === Math.floor(width / 2) ? 1 : 0;
    return randomUnit() < density ? 1 : 0;
  });
  if (!row.some(Boolean)) row[Math.floor(width / 2)] = 1;
  state.caRows = [row];
  state.caAccumulator = 0;
  updateCaStats(row);
  const prefill = 72;
  for (let index = 0; index < prefill; index += 1) stepAutomataRow(false);
}

function updateCaStats(row) {
  const live = row.reduce((sum, cell) => sum + cell, 0);
  let transitions = 0;
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] !== row[(index + 1) % row.length]) transitions += 1;
  }
  state.caStats = {
    density: live / row.length,
    transitions,
  };
}

function stepAutomataRow(audition = true) {
  if (!state.caRows.length) seedAutomata();
  const previous = state.caRows[state.caRows.length - 1];
  const rule = Math.round(state.caRule);
  const next = previous.map((cell, index) => ruleBit(
    rule,
    previous[(index - 1 + previous.length) % previous.length],
    cell,
    previous[(index + 1) % previous.length],
  ));
  state.caRows.push(next);
  if (state.caRows.length > 170) state.caRows.shift();
  updateCaStats(next);
  if (audition) soundAutomataRow(next);
}

function soundAutomataRow(row) {
  if (!state.audioOn) return;
  const stride = Math.max(1, Math.floor(row.length / 12));
  for (let index = 0; index < row.length; index += stride) {
    if (!row[index]) continue;
    const degree = PENTATONIC[Math.floor((index / row.length) * PENTATONIC.length)];
    const frequency = 92 * 2 ** (degree / 12);
    audio.trigger({
      frequency,
      gain: 0.055 + state.caStats.density * 0.05,
      duration: 0.045,
      type: index % 2 ? "triangle" : "sine",
      pan: (index / (row.length - 1)) * 2 - 1,
    });
  }
}

function stepAutomata(dt) {
  if (!state.caRows.length) seedAutomata();
  state.caAccumulator += dt * state.caRate;
  const maxSteps = 6;
  let steps = 0;
  while (state.caAccumulator >= 1 && steps < maxSteps) {
    state.caAccumulator -= 1;
    stepAutomataRow();
    steps += 1;
  }
}

function drawAutomata() {
  const ctx = context2d;
  clearStage();
  if (!state.caRows.length) seedAutomata();
  const width = state.caRows[0].length;
  const topInset = canvasWidth < 520 ? 112 : 0;
  const drawableHeight = Math.max(120, canvasHeight - topInset - 28);
  const cell = Math.max(3, Math.min(canvasWidth / width, canvasHeight / 90));
  const rowsVisible = Math.min(state.caRows.length, Math.floor((drawableHeight * 0.92) / cell));
  const startRow = Math.max(0, state.caRows.length - rowsVisible);
  const gridWidth = width * cell;
  const x0 = (canvasWidth - gridWidth) / 2;
  const y0 = topInset + (drawableHeight - rowsVisible * cell) / 2;
  for (let rowIndex = startRow; rowIndex < state.caRows.length; rowIndex += 1) {
    const row = state.caRows[rowIndex];
    const age = (rowIndex - startRow) / Math.max(1, rowsVisible - 1);
    const y = y0 + (rowIndex - startRow) * cell;
    for (let x = 0; x < width; x += 1) {
      if (!row[x]) continue;
      const hueMix = x / Math.max(1, width - 1);
      ctx.fillStyle = hueMix < 0.5
        ? `rgba(103, 226, 208, ${0.28 + age * 0.66})`
        : `rgba(240, 203, 118, ${0.22 + age * 0.62})`;
      ctx.fillRect(x0 + x * cell, y, Math.ceil(cell), Math.ceil(cell));
    }
  }
  ctx.strokeStyle = "rgba(219, 228, 224, 0.16)";
  ctx.strokeRect(x0, y0, gridWidth, rowsVisible * cell);
}

function springModeAmplitudes() {
  ensureSpringState();
  const count = state.springCount;
  const modes = [];
  for (let mode = 1; mode <= Math.min(8, count); mode += 1) {
    let projection = 0;
    for (let index = 0; index < count; index += 1) {
      projection += state.springY[index] * Math.sin((mode * Math.PI * (index + 1)) / (count + 1));
    }
    modes.push(Math.abs(projection) / count);
  }
  return modes;
}

const EXPERIMENTS = {
  moire: {
    bind() {
      bindRange("moireSpacing", "moireSpacing", (value) => `${Math.round(value)} px`);
      bindRange("moireAngle", "moireAngle", (value) => `${compact(value, 1)} deg`);
      bindRange("moireDrift", "moireDrift", (value) => `${compact(value, 2)} cyc/s`);
      bindRange("moireTone", "moireTone", (value) => `${Math.round(value)} Hz`);
    },
    update(dt) {
      state.moirePhase = wrap01(state.moirePhase + state.moireDrift * dt);
    },
    draw: drawMoire,
    drone() {
      const beat = moireBeatHz();
      const base = state.moireTone;
      return [
        { frequency: base, gain: 0.13, type: "sine", pan: -0.32 },
        { frequency: base + beat, gain: 0.13, type: "sine", pan: 0.32 },
        { frequency: base * 2, gain: 0.045, type: "triangle", pan: 0 },
      ];
    },
    summary() {
      const fringe = moireFringeSpan();
      setText("metricPrimary", `${Math.round(fringe)} px`);
      setText("metricSecondary", `${compact(moireBeatHz(), 2)} Hz`);
      setText("stageReadout", `MOIRE ORGAN · ${compact(state.moireAngle, 1)} DEG · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  chladni: {
    bind() {
      bindRange("chladniN", "chladniN", (value) => `${Math.round(value)}`);
      bindRange("chladniM", "chladniM", (value) => `${Math.round(value)}`);
      bindRange("excitationX", "excitationX", percent);
      bindRange("excitationY", "excitationY", percent);
      bindRange("chladniDrive", "chladniDrive", percent);
    },
    update() {},
    draw: drawChladni,
    drone() {
      const n = Math.round(state.chladniN);
      const m = Math.round(state.chladniM);
      const mode = Math.sqrt(n * n + m * m);
      const excitation = Math.abs(chladniValue(state.excitationX, state.excitationY, n, m));
      const root = 48 * mode;
      const gain = state.chladniDrive * (0.025 + excitation * 0.17);
      return [
        { frequency: root, gain, type: "sine", pan: -0.18 },
        { frequency: root * Math.sqrt((n + 1) ** 2 + m ** 2) / mode, gain: gain * 0.46, type: "triangle", pan: 0.2 },
        { frequency: root * Math.sqrt(n ** 2 + (m + 1) ** 2) / mode, gain: gain * 0.36, type: "sine", pan: 0 },
      ];
    },
    summary() {
      const n = Math.round(state.chladniN);
      const m = Math.round(state.chladniM);
      const frequency = 48 * Math.sqrt(n * n + m * m);
      const excitation = Math.abs(chladniValue(state.excitationX, state.excitationY, n, m));
      setText("metricPrimary", `${Math.round(frequency)} Hz`);
      setText("metricSecondary", percent(excitation * state.chladniDrive));
      setText("patternSummary", `${n} by ${m}`);
      setText("stageReadout", `CHLADNI PLATE · MODE ${n}:${m} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  springs: {
    bind() {
      bindRange("springMasses", "springMasses", (value) => `${Math.round(value)}`);
      bindRange("springStiffness", "springStiffness", (value) => compact(value, 2));
      bindRange("springDamping", "springDamping", percent);
      bindRange("springDrive", "springDrive", percent);
      $("pluckSpring")?.addEventListener("click", () => pluckSpring(0.5));
      canvas?.addEventListener("pointerdown", (event) => {
        const rect = canvas.getBoundingClientRect();
        pluckSpring((event.clientX - rect.left) / Math.max(1, rect.width));
      });
      ensureSpringState(true);
    },
    update(dt) {
      stepSprings(dt);
    },
    draw: drawSprings,
    drone() {
      const amplitudes = springModeAmplitudes();
      const stiffness = Math.sqrt(state.springStiffness);
      return amplitudes.map((amount, index) => ({
        frequency: 54 + 360 * stiffness * Math.sin(((index + 1) * Math.PI) / (2 * (state.springCount + 1))),
        gain: clamp(amount * 1.9, 0.004, 0.13),
        type: index % 2 ? "triangle" : "sine",
        pan: lerp(-0.52, 0.52, index / Math.max(1, amplitudes.length - 1)),
      }));
    },
    summary() {
      const amplitudes = springModeAmplitudes();
      const energy = clamp(state.springY.reduce((sum, value, index) => sum + value * value + state.springV[index] * state.springV[index] * 0.01, 0) / state.springCount, 0, 1);
      const strongest = amplitudes.reduce((best, value, index) => value > best.value ? { value, index } : best, { value: -1, index: 0 });
      setText("metricPrimary", percent(energy));
      setText("metricSecondary", `${strongest.index + 1}`);
      setText("patternSummary", `${state.springCount} masses`);
      setText("stageReadout", `SPRING CHOIR · ${state.springCount} MASSES · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  gears: {
    bind() {
      bindRange("gearTeethA", "gearTeethA", (value) => `${Math.round(value)}`);
      bindRange("gearTeethB", "gearTeethB", (value) => `${Math.round(value)}`);
      bindRange("gearSpeed", "gearSpeed", (value) => `${compact(value, 2)} rev/s`);
      bindRange("gearAccent", "gearAccent", percent);
    },
    update(dt) {
      stepGears(dt);
    },
    draw: drawGears,
    drone() {
      const teethA = Math.round(state.gearTeethA);
      const teethB = Math.round(state.gearTeethB);
      const rate = Math.max(0.02, state.gearSpeed);
      return [
        { frequency: 42 + teethA * rate * 6, gain: 0.035 + state.gearAccent * 0.03, type: "sawtooth", pan: -0.28 },
        { frequency: 42 + teethB * rate * 6, gain: 0.032 + state.gearAccent * 0.025, type: "triangle", pan: 0.28 },
      ];
    },
    summary() {
      const teethA = Math.round(state.gearTeethA);
      const teethB = Math.round(state.gearTeethB);
      const divisor = gcd(teethA, teethB);
      setText("metricPrimary", `${teethA / divisor}:${teethB / divisor}`);
      setText("metricSecondary", `${compact(state.gearSpeed * teethA, 2)} Hz`);
      setText("patternSummary", `${teethA} and ${teethB} teeth`);
      setText("stageReadout", `GEAR RATIO DRUMS · ${teethA}:${teethB} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  automata: {
    bind() {
      bindRange("caRule", "caRule", (value) => `${Math.round(value)}`);
      bindRange("caWidth", "caWidth", (value) => `${Math.round(value)}`);
      bindRange("caRate", "caRate", (value) => `${compact(value, 1)} rows/s`);
      bindRange("caDensity", "caDensity", percent);
      for (const button of document.querySelectorAll("[data-ca-rule]")) {
        button.addEventListener("click", () => {
          const rule = Number(button.dataset.caRule);
          const slider = $("caRule");
          if (slider) slider.value = String(rule);
          state.caRule = rule;
          seedAutomata();
          updateAutomataButtons();
          updateSummaries();
        });
      }
      $("seedAutomata")?.addEventListener("click", seedAutomata);
      seedAutomata();
      updateAutomataButtons();
    },
    update(dt) {
      stepAutomata(dt);
    },
    draw: drawAutomata,
    drone() {
      const density = state.caStats.density;
      const transitions = state.caStats.transitions / Math.max(1, state.caWidth);
      return [
        { frequency: 68 + density * 260, gain: 0.025 + density * 0.07, type: "triangle", pan: -0.2 },
        { frequency: 136 + transitions * 360, gain: 0.018 + transitions * 0.055, type: "sine", pan: 0.2 },
      ];
    },
    summary() {
      setText("metricPrimary", percent(state.caStats.density));
      setText("metricSecondary", `${state.caStats.transitions}`);
      setText("patternSummary", `Rule ${Math.round(state.caRule)}`);
      setText("stageReadout", `CELLULAR AUTOMATA · RULE ${Math.round(state.caRule)} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
      updateAutomataButtons();
    },
  },
};

function updateAutomataButtons() {
  for (const button of document.querySelectorAll("[data-ca-rule]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.caRule) === Math.round(state.caRule)));
  }
}

function bindCommonControls() {
  const level = $("level");
  const levelOut = $("levelOut");
  if (level) {
    const sync = () => {
      state.level = Number(level.value) || 0;
      if (levelOut) levelOut.textContent = percent(state.level);
      audio.setLevel(state.level);
    };
    level.addEventListener("input", sync);
    sync();
  }
  $("audioButton")?.addEventListener("click", async () => {
    if (state.audioStarting) return;
    if (state.audioOn) {
      state.audioOn = false;
      await audio.stop();
      setAudioState();
      updateSummaries();
      return;
    }
    state.audioStarting = true;
    setAudioState();
    try {
      await audio.start();
      state.audioOn = true;
      updateCommonAudio();
      setText("liveStatus", "Audio on.");
    } catch (error) {
      setText("liveStatus", error instanceof Error ? error.message : String(error));
      state.audioOn = false;
    } finally {
      state.audioStarting = false;
      setAudioState();
      updateSummaries();
    }
  });
}

function frame(nowMilliseconds = 0) {
  resizeCanvas();
  const now = nowMilliseconds / 1000;
  const dt = state.lastFrame ? clamp(now - state.lastFrame, 0, 0.05) : 0;
  state.lastFrame = now;
  state.time += dt;
  const active = EXPERIMENTS[experiment] ?? EXPERIMENTS.moire;
  active.update?.(dt);
  active.draw?.();
  updateCommonAudio();
  active.summary?.();
  animationFrame = requestAnimationFrame(frame);
}

function boot() {
  if (!canvas || !context2d) return;
  bindCommonControls();
  const active = EXPERIMENTS[experiment] ?? EXPERIMENTS.moire;
  active.bind?.();
  updateSummaries();
  animationFrame = requestAnimationFrame(frame);
}

globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  audio.dispose();
});

boot();
