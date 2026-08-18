import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";

const TAU = Math.PI * 2;
const MAX_CONTINUOUS_VOICES = 48;
const MOIRE_DEFAULT_VOICES = 8;
const MOIRE_BANK_GAIN = 0.12;
const MOIRE_OCTAVES_PER_DEGREE_SECOND = 0.045;
const MOIRE_RISING_COLORS = ["103, 226, 208", "146, 221, 127"];
const MOIRE_FALLING_COLORS = ["255, 143, 156", "240, 203, 118"];
const PENTATONIC = [0, 2, 3, 5, 7, 10, 12, 14];
const DNA_BASES = "TCAG";
const CODON_CODES = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const REACTION_GRID_WIDTH = 112;
const REACTION_GRID_HEIGHT = 76;
const AMINO_NAMES = Object.freeze({
  A: "Ala", C: "Cys", D: "Asp", E: "Glu", F: "Phe", G: "Gly", H: "His",
  I: "Ile", K: "Lys", L: "Leu", M: "Met", N: "Asn", P: "Pro", Q: "Gln",
  R: "Arg", S: "Ser", T: "Thr", V: "Val", W: "Trp", Y: "Tyr", "*": "Stop",
});

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

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function stageTopInset() {
  return canvasWidth < 520 ? 112 : 82;
}

function hashUnit(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function codonAmino(codon) {
  if (!/^[ACGT]{3}$/.test(codon)) return "?";
  const index = DNA_BASES.indexOf(codon[0]) * 16
    + DNA_BASES.indexOf(codon[1]) * 4
    + DNA_BASES.indexOf(codon[2]);
  return CODON_CODES[index] ?? "?";
}

class ExperimentAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.outputRelease = null;
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
      this.outputRelease = connectAudioOutput(this.context, this.compressor);
    }
    if (this.context.state === "suspended") {
      unlockAudioContext(this.context);
      await this.context.resume();
    }
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
    this.outputRelease?.();
    this.outputRelease = null;
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
  moireUpPhase: 0,
  moireDownPhase: 0,
  moireInterval: 1,
  moireVoices: MOIRE_DEFAULT_VOICES,
  moireSecondPair: false,
  moireLayerOffset: 0.6,
  moireUpAngle: 4,
  moireDownAngle: 4,
  moireOverlap: 0.65,
  moireTone: 164,
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
  primeStatus: [],
  primeList: [],
  primeCursor: 2,
  primeAccumulator: 0,
  pendulumSigns: [],
  chaosSystems: [],
  chaosTrails: [[], []],
  chaosElapsed: 0,
  reactionA: null,
  reactionB: null,
  reactionNextA: null,
  reactionNextB: null,
  reactionStats: { coverage: 0, edges: 0 },
  reactionAccumulator: 0,
  orbitalN: 2,
  orbitalL: 1,
  orbitalM: 1,
  orbitalLastSector: -1,
  dnaSequence: "ATGGCTTACGAACTGCCATTCGGTAACTAG",
  dnaIndex: 0,
  dnaAccumulator: 0,
  dnaAmino: "Met",
  neuralWeights: [],
  neuralBiases: [],
  neuralLayers: [[1, 0, 0, 0], Array(6).fill(0), Array(3).fill(0)],
  neuralInput: 0,
  neuralPulseAge: 0,
  neuralAccumulator: 0,
  neuralSeed: 19,
  fourierWave: "square",
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
  const scene = moireScene();
  const diagonal = Math.hypot(canvasWidth, canvasHeight);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  function drawVoiceLine(voice) {
    if (voice.weight < 0.0001 || voice.gain <= 0) return;
    const { rotation, offset } = moireLineGeometry(voice);
    const colors = voice.direction > 0 ? MOIRE_RISING_COLORS : MOIRE_FALLING_COLORS;
    const color = colors[voice.layer] ?? colors[0];
    const focus = clamp(state.moireOverlap / 2, 0, 1);
    const opacity = Math.sqrt(voice.weight) * lerp(1, 0.26, focus);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = `rgba(${color}, ${0.04 + opacity * 0.13})`;
    ctx.lineWidth = 7 + voice.weight * 8;
    ctx.beginPath();
    ctx.moveTo(-diagonal, offset);
    ctx.lineTo(diagonal, offset);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${color}, ${0.08 + opacity * 0.86})`;
    ctx.lineWidth = 1 + voice.weight * 2;
    ctx.beginPath();
    ctx.moveTo(-diagonal, offset);
    ctx.lineTo(diagonal, offset);
    ctx.stroke();
    ctx.restore();
  }

  for (const voice of scene.voices) drawVoiceLine(voice);

  if (state.moireOverlap > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const crossing of scene.crossings) {
      const intensity = clamp(crossing.strength * state.moireOverlap, 0, 1.6);
      if (intensity < 0.015) continue;
      const x = centerX + crossing.x;
      const y = centerY + crossing.y;
      const halfLength = 18 + intensity * 38;
      const centerAlpha = Math.min(0.96, 0.18 + intensity * 0.62);
      for (const rotation of crossing.rotations) {
        const dx = Math.cos(rotation) * halfLength;
        const dy = Math.sin(rotation) * halfLength;
        const highlight = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
        highlight.addColorStop(0, "rgba(248, 251, 247, 0)");
        highlight.addColorStop(0.5, `rgba(248, 251, 247, ${centerAlpha})`);
        highlight.addColorStop(1, "rgba(248, 251, 247, 0)");
        ctx.strokeStyle = highlight;
        ctx.lineWidth = 1.2 + intensity * 2.2;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      }
      const radius = 3 + intensity * 7;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(252, 253, 250, ${centerAlpha})`);
      glow.addColorStop(0.35, `rgba(248, 251, 247, ${centerAlpha * 0.58})`);
      glow.addColorStop(1, "rgba(248, 251, 247, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function wrapCentered(value, span) {
  return (wrap01(value / span + 0.5) - 0.5) * span;
}

function moireSpectralWindow(octaveOffset, width) {
  const distance = Math.abs(octaveOffset) / Math.max(0.001, width * 0.5);
  if (distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

function moireAngleRate(angle) {
  return Math.max(0, angle) * MOIRE_OCTAVES_PER_DEGREE_SECOND;
}

function moireAudibleFrequency(octaveOffset, registerShift) {
  const minimum = Math.log2(20);
  const maximum = Math.log2(12_000);
  const shoulder = 0.7;
  const raw = Math.log2(state.moireTone) + octaveOffset + registerShift;
  let audible = raw;
  if (raw < minimum + shoulder) {
    audible = minimum + shoulder * Math.exp((raw - minimum - shoulder) / shoulder);
  } else if (raw > maximum - shoulder) {
    audible = maximum - shoulder * Math.exp((maximum - shoulder - raw) / shoulder);
  }
  return 2 ** audible;
}

function moireShepardVoices() {
  const interval = clamp(state.moireInterval, 0.1, 2);
  const voiceCount = clamp(Math.round(state.moireVoices), 4, 12);
  const layerCount = state.moireSecondPair ? 2 : 1;
  const cycleSpan = interval * voiceCount;
  const halfSpan = cycleSpan * 0.5;
  const lowerShift = Math.ceil(Math.log2(20 / state.moireTone) + halfSpan);
  const upperShift = Math.floor(Math.log2(12_000 / state.moireTone) - halfSpan);
  const centerShift = Math.round(
    (Math.log2(20 / state.moireTone) + Math.log2(12_000 / state.moireTone)) * 0.5,
  );
  const registerShift = lowerShift <= upperShift
    ? clamp(0, lowerShift, upperShift)
    : centerShift;
  const voices = [];

  for (let layer = 0; layer < layerCount; layer += 1) {
    const layerPosition = layerCount === 1 ? 0 : layer - (layerCount - 1) * 0.5;
    const layerShift = layerPosition * state.moireLayerOffset * interval;
    for (const direction of [1, -1]) {
      for (let slot = 0; slot < voiceCount; slot += 1) {
        const centeredSlot = slot - (voiceCount - 1) * 0.5;
        const directionalPhase = direction > 0 ? state.moireUpPhase : state.moireDownPhase;
        const octaveOffset = wrapCentered(
          centeredSlot * interval + directionalPhase + layerShift,
          cycleSpan,
        );
        const normalizedPosition = octaveOffset / halfSpan;
        voices.push({
          bank: `${layer}:${direction}`,
          direction,
          layer,
          layerPosition,
          slot,
          octaveOffset,
          normalizedPosition,
          frequency: moireAudibleFrequency(octaveOffset, registerShift),
          weight: moireSpectralWindow(octaveOffset, cycleSpan),
          overlap: 0,
          gain: 0,
          pan: clamp(normalizedPosition * 0.72 + layerPosition * 0.12, -0.84, 0.84),
        });
      }
    }
  }
  return voices;
}

function moireVisualSpan() {
  const available = Math.min(canvasHeight * 0.88, canvasWidth * 0.72);
  const intervalAmount = clamp((state.moireInterval - 0.1) / 1.9, 0, 1);
  return available * lerp(0.46, 1, Math.sqrt(intervalAmount));
}

function moireLineGeometry(voice) {
  const risingAngle = (state.moireUpAngle * Math.PI) / 180;
  const fallingAngle = (-state.moireDownAngle * Math.PI) / 180;
  const baseRotation = voice.direction > 0 ? risingAngle : fallingAngle;
  const pairSeparation = risingAngle - fallingAngle;
  return {
    rotation: baseRotation + voice.layerPosition * pairSeparation * 0.35,
    offset: -voice.normalizedPosition * moireVisualSpan() * 0.5,
  };
}

function moireLineIntersection(first, second) {
  const firstLine = moireLineGeometry(first);
  const secondLine = moireLineGeometry(second);
  const firstNormal = [-Math.sin(firstLine.rotation), Math.cos(firstLine.rotation)];
  const secondNormal = [-Math.sin(secondLine.rotation), Math.cos(secondLine.rotation)];
  const determinant = firstNormal[0] * secondNormal[1] - firstNormal[1] * secondNormal[0];
  if (Math.abs(determinant) < 1e-5) return null;
  return {
    x: (firstLine.offset * secondNormal[1] - firstNormal[1] * secondLine.offset) / determinant,
    y: (firstNormal[0] * secondLine.offset - firstLine.offset * secondNormal[0]) / determinant,
    rotations: [firstLine.rotation, secondLine.rotation],
  };
}

function moireScene() {
  const voices = moireShepardVoices();
  const rising = voices.filter((voice) => voice.direction > 0);
  const falling = voices.filter((voice) => voice.direction < 0);
  const crossings = [];
  const halfWidth = canvasWidth * 0.52;
  const halfHeight = canvasHeight * 0.52;

  for (const upVoice of rising) {
    for (const downVoice of falling) {
      const point = moireLineIntersection(upVoice, downVoice);
      if (!point || Math.abs(point.x) > halfWidth || Math.abs(point.y) > halfHeight) continue;
      const edgeFade = Math.max(
        0,
        1 - Math.max(Math.abs(point.x) / halfWidth, Math.abs(point.y) / halfHeight),
      );
      const strength = Math.sqrt(upVoice.weight * downVoice.weight) * Math.sqrt(edgeFade);
      if (strength < 0.005) continue;
      upVoice.overlap = Math.max(upVoice.overlap, strength);
      downVoice.overlap = Math.max(downVoice.overlap, strength);
      crossings.push({ ...point, strength });
    }
  }

  const bankGain = MOIRE_BANK_GAIN / Math.sqrt(state.moireSecondPair ? 2 : 1);
  const focus = clamp(state.moireOverlap / 2, 0, 1);
  const remoteLevel = lerp(1, 0.2, focus);
  const banks = new Map();
  for (const voice of voices) {
    const crossingLift = voice.overlap * state.moireOverlap * 1.25;
    const amplitude = voice.weight * (remoteLevel + crossingLift);
    voice.amplitude = amplitude;
    const bank = banks.get(voice.bank) ?? [];
    bank.push(voice);
    banks.set(voice.bank, bank);
  }
  for (const bank of banks.values()) {
    const power = bank.reduce((sum, voice) => sum + voice.weight ** 2, 0);
    const normalization = power > 1e-12 ? 1 / Math.sqrt(power) : 0;
    for (const voice of bank) voice.gain = bankGain * voice.amplitude * normalization;
  }

  return { voices, crossings };
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

function resetPrimeSieve() {
  const limit = Math.round(state.primeLimit || readControl("primeLimit", 120));
  state.primeStatus = Array(limit + 1).fill(0);
  state.primeStatus[0] = -1;
  state.primeStatus[1] = -1;
  state.primeList = [];
  state.primeCursor = 2;
  state.primeAccumulator = 0;
}

function stepPrimeSieve(audition = true) {
  const limit = Math.round(state.primeLimit);
  if (state.primeStatus.length !== limit + 1 || state.primeCursor > limit) {
    resetPrimeSieve();
  }
  const value = state.primeCursor;
  const isPrime = state.primeStatus[value] === 0;
  if (isPrime) {
    state.primeStatus[value] = 1;
    state.primeList.push(value);
    for (let multiple = value * value; multiple <= limit; multiple += value) {
      if (state.primeStatus[multiple] === 0) state.primeStatus[multiple] = -1;
    }
  }
  if (audition && state.audioOn) {
    if (isPrime) {
      const position = value / Math.max(2, limit);
      audio.trigger({
        frequency: state.primeRoot * 2 ** (position * state.primeSpread),
        gain: 0.13,
        duration: 0.14,
        type: "triangle",
        pan: position * 2 - 1,
      });
    } else if (value % 4 === 0) {
      audio.trigger({
        frequency: state.primeRoot * 0.5,
        gain: 0.025,
        duration: 0.035,
        type: "square",
        pan: -0.7 + 1.4 * (value / limit),
      });
    }
  }
  state.primeCursor += 1;
}

function updatePrimeSieve(dt) {
  if (!state.primeStatus.length) resetPrimeSieve();
  state.primeAccumulator += dt * state.primeRate;
  let steps = 0;
  while (state.primeAccumulator >= 1 && steps < 8) {
    state.primeAccumulator -= 1;
    stepPrimeSieve();
    steps += 1;
  }
}

function drawPrimeSieve() {
  const ctx = context2d;
  clearStage();
  if (!state.primeStatus.length) resetPrimeSieve();
  const limit = Math.round(state.primeLimit);
  const top = stageTopInset() + 8;
  const margin = canvasWidth < 520 ? 14 : 34;
  const columns = clamp(Math.floor((canvasWidth - margin * 2) / (canvasWidth < 520 ? 30 : 42)), 6, 20);
  const rows = Math.ceil(limit / columns);
  const cellWidth = (canvasWidth - margin * 2) / columns;
  const cellHeight = Math.min(cellWidth, (canvasHeight - top - 22) / Math.max(1, rows));
  const gridHeight = rows * cellHeight;
  const y0 = top + Math.max(0, (canvasHeight - top - gridHeight) * 0.45);
  for (let value = 1; value <= limit; value += 1) {
    const index = value - 1;
    const x = margin + (index % columns) * cellWidth;
    const y = y0 + Math.floor(index / columns) * cellHeight;
    const status = state.primeStatus[value];
    const current = value === Math.min(limit, state.primeCursor);
    ctx.fillStyle = status === 1
      ? "rgba(103, 226, 208, 0.9)"
      : status === -1
        ? "rgba(255, 143, 156, 0.13)"
        : "rgba(219, 228, 224, 0.08)";
    ctx.fillRect(x + 1, y + 1, Math.max(2, cellWidth - 3), Math.max(2, cellHeight - 3));
    if (current) {
      ctx.strokeStyle = "rgba(240, 203, 118, 0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, Math.max(2, cellWidth - 3), Math.max(2, cellHeight - 3));
    }
    if (cellHeight >= 16 && cellWidth >= 22) {
      ctx.fillStyle = status === 1 ? "#07110f" : "rgba(219, 228, 224, 0.66)";
      ctx.font = `${Math.max(8, Math.min(11, cellHeight * 0.42))}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(value), x + cellWidth / 2, y + cellHeight / 2);
    }
  }
}

function drawLissajous() {
  const ctx = context2d;
  clearStage();
  const top = stageTopInset();
  const centerX = canvasWidth / 2;
  const centerY = top + (canvasHeight - top) * 0.5;
  const radiusX = Math.min(canvasWidth * 0.4, 330);
  const radiusY = Math.min((canvasHeight - top) * 0.4, 230);
  const xRatio = Math.round(state.lissajousX);
  const yRatio = Math.round(state.lissajousY);
  const offset = state.lissajousPhase * Math.PI / 180;
  ctx.strokeStyle = "rgba(219, 228, 224, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX - radiusX, centerY);
  ctx.lineTo(centerX + radiusX, centerY);
  ctx.moveTo(centerX, centerY - radiusY);
  ctx.lineTo(centerX, centerY + radiusY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(103, 226, 208, 0.82)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let index = 0; index <= 900; index += 1) {
    const phase = (index / 900) * TAU;
    const x = centerX + Math.sin(xRatio * phase + offset) * radiusX;
    const y = centerY + Math.sin(yRatio * phase) * radiusY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const motion = state.time * state.lissajousRate * TAU;
  const dotX = centerX + Math.sin(xRatio * motion + offset) * radiusX;
  const dotY = centerY + Math.sin(yRatio * motion) * radiusY;
  ctx.fillStyle = "rgba(255, 143, 156, 0.98)";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 7, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(240, 203, 118, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(dotX, dotY);
  ctx.stroke();
}

function pendulumPeriods() {
  const count = Math.round(state.pendulumCount);
  const rephase = Math.max(4, state.pendulumRephase);
  const step = Math.round(state.pendulumStep);
  return Array.from({ length: count }, (_, index) => rephase / (12 + index * step));
}

function updatePendulums() {
  const periods = pendulumPeriods();
  if (state.pendulumSigns.length !== periods.length) state.pendulumSigns = Array(periods.length).fill(null);
  periods.forEach((period, index) => {
    const angle = Math.cos((state.time / period) * TAU);
    const sign = angle >= 0;
    if (state.pendulumSigns[index] !== null && sign !== state.pendulumSigns[index] && state.audioOn) {
      audio.trigger({
        frequency: state.pendulumTone * 2 ** (index / 12),
        gain: 0.045,
        duration: 0.075,
        type: index % 2 ? "sine" : "triangle",
        pan: periods.length === 1 ? 0 : (index / (periods.length - 1)) * 2 - 1,
      });
    }
    state.pendulumSigns[index] = sign;
  });
}

function pendulumCoherence() {
  const periods = pendulumPeriods();
  let x = 0;
  let y = 0;
  periods.forEach((period) => {
    const phase = (state.time / period) * TAU;
    x += Math.cos(phase);
    y += Math.sin(phase);
  });
  return Math.hypot(x, y) / Math.max(1, periods.length);
}

function drawPendulums() {
  const ctx = context2d;
  clearStage();
  const periods = pendulumPeriods();
  const top = stageTopInset() + 12;
  const margin = canvasWidth < 520 ? 22 : 48;
  const width = canvasWidth - margin * 2;
  const length = Math.min((canvasHeight - top) * 0.62, 260);
  const pivotY = top + 18;
  ctx.strokeStyle = "rgba(219, 228, 224, 0.24)";
  ctx.beginPath();
  ctx.moveTo(margin, pivotY);
  ctx.lineTo(canvasWidth - margin, pivotY);
  ctx.stroke();
  periods.forEach((period, index) => {
    const ratio = periods.length === 1 ? 0.5 : index / (periods.length - 1);
    const pivotX = margin + ratio * width;
    const phase = (state.time / period) * TAU;
    const angle = Math.cos(phase) * state.pendulumSwing * Math.PI / 180;
    const bobX = pivotX + Math.sin(angle) * length;
    const bobY = pivotY + Math.cos(angle) * length;
    ctx.strokeStyle = `rgba(103, 226, 208, ${0.28 + ratio * 0.58})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();
    ctx.fillStyle = ratio < 0.5 ? "rgba(103, 226, 208, 0.95)" : "rgba(240, 203, 118, 0.95)";
    ctx.beginPath();
    ctx.arc(bobX, bobY, Math.max(3, 6 - periods.length * 0.08), 0, TAU);
    ctx.fill();
  });
}

function resetDoublePendulum() {
  const offset = (state.chaosOffset || readControl("chaosOffset", 0.35)) * Math.PI / 180;
  state.chaosSystems = [
    { a: 2.12, b: 1.34, av: 0, bv: 0 },
    { a: 2.12 + offset, b: 1.34, av: 0, bv: 0 },
  ];
  state.chaosTrails = [[], []];
  state.chaosElapsed = 0;
}

function doublePendulumAcceleration(system) {
  const gravity = state.chaosGravity;
  const lengthA = 1;
  const lengthB = state.chaosLength;
  const delta = system.a - system.b;
  const denominator = 3 - Math.cos(2 * delta);
  const aa = (
    -3 * gravity * Math.sin(system.a)
    - gravity * Math.sin(system.a - 2 * system.b)
    - 2 * Math.sin(delta) * (system.bv ** 2 * lengthB + system.av ** 2 * lengthA * Math.cos(delta))
  ) / (lengthA * denominator);
  const ba = (
    2 * Math.sin(delta) * (
      2 * system.av ** 2 * lengthA
      + 2 * gravity * Math.cos(system.a)
      + system.bv ** 2 * lengthB * Math.cos(delta)
    )
  ) / (lengthB * denominator);
  return { aa, ba };
}

function stepDoublePendulum(dt) {
  if (!state.chaosSystems.length) resetDoublePendulum();
  const totalStep = Math.min(0.035, dt * state.chaosSpeed);
  const substeps = 5;
  const step = totalStep / substeps;
  for (let pass = 0; pass < substeps; pass += 1) {
    state.chaosSystems.forEach((system) => {
      const { aa, ba } = doublePendulumAcceleration(system);
      system.av = clamp(system.av + aa * step, -18, 18);
      system.bv = clamp(system.bv + ba * step, -18, 18);
      system.a += system.av * step;
      system.b += system.bv * step;
    });
  }
  state.chaosElapsed += totalStep;
}

function chaosDivergence() {
  if (state.chaosSystems.length < 2) return 0;
  const [first, second] = state.chaosSystems;
  return Math.hypot(first.a - second.a, first.b - second.b);
}

function drawDoublePendulum() {
  const ctx = context2d;
  clearStage();
  if (!state.chaosSystems.length) resetDoublePendulum();
  const top = stageTopInset();
  const originX = canvasWidth / 2;
  const lengthA = Math.min(canvasWidth * 0.21, (canvasHeight - top) * 0.29, 150);
  const lengthB = lengthA * state.chaosLength;
  const originY = top + Math.min(lengthA * 0.78, (canvasHeight - top) * 0.22);
  const colors = ["rgba(103, 226, 208, 0.92)", "rgba(255, 143, 156, 0.88)"];
  state.chaosSystems.forEach((system, index) => {
    const x1 = originX + Math.sin(system.a) * lengthA;
    const y1 = originY + Math.cos(system.a) * lengthA;
    const x2 = x1 + Math.sin(system.b) * lengthB;
    const y2 = y1 + Math.cos(system.b) * lengthB;
    const trail = state.chaosTrails[index];
    trail.push({ x: x2, y: y2 });
    if (trail.length > 220) trail.shift();
    ctx.strokeStyle = index === 0 ? "rgba(103, 226, 208, 0.24)" : "rgba(255, 143, 156, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    trail.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.strokeStyle = colors[index];
    ctx.lineWidth = index === 0 ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = colors[index];
    ctx.beginPath();
    ctx.arc(x1, y1, 6, 0, TAU);
    ctx.arc(x2, y2, 8, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(240, 203, 118, 0.95)";
  ctx.beginPath();
  ctx.arc(originX, originY, 5, 0, TAU);
  ctx.fill();
}

function seedReactionAt(normalizedX = 0.5, normalizedY = 0.5, radius = 5) {
  if (!state.reactionB) return;
  const centerX = Math.round(clamp(normalizedX, 0, 1) * (REACTION_GRID_WIDTH - 1));
  const centerY = Math.round(clamp(normalizedY, 0, 1) * (REACTION_GRID_HEIGHT - 1));
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
      const x = (centerX + offsetX + REACTION_GRID_WIDTH) % REACTION_GRID_WIDTH;
      const y = (centerY + offsetY + REACTION_GRID_HEIGHT) % REACTION_GRID_HEIGHT;
      const index = y * REACTION_GRID_WIDTH + x;
      state.reactionA[index] = 0.45;
      state.reactionB[index] = 0.92;
    }
  }
}

function resetReactionDiffusion() {
  const size = REACTION_GRID_WIDTH * REACTION_GRID_HEIGHT;
  state.reactionA = new Float32Array(size).fill(1);
  state.reactionB = new Float32Array(size);
  state.reactionNextA = new Float32Array(size);
  state.reactionNextB = new Float32Array(size);
  state.reactionAccumulator = 0;
  for (let spot = 0; spot < 9; spot += 1) {
    seedReactionAt(
      0.16 + hashUnit(spot, 2) * 0.68,
      0.2 + hashUnit(spot, 7) * 0.6,
      3 + Math.floor(hashUnit(spot, 11) * 4),
    );
  }
  for (let pass = 0; pass < 36; pass += 1) stepReactionGrid(false);
}

function stepReactionGrid(updateStats = true) {
  if (!state.reactionA) return;
  const width = REACTION_GRID_WIDTH;
  const height = REACTION_GRID_HEIGHT;
  const feed = state.reactionFeed;
  const kill = state.reactionKill;
  const diffusionB = state.reactionDiffusion;
  let coverage = 0;
  let edgeEnergy = 0;
  for (let y = 0; y < height; y += 1) {
    const north = (y - 1 + height) % height;
    const south = (y + 1) % height;
    for (let x = 0; x < width; x += 1) {
      const west = (x - 1 + width) % width;
      const east = (x + 1) % width;
      const index = y * width + x;
      const a = state.reactionA[index];
      const b = state.reactionB[index];
      const lapA = -a
        + 0.2 * (
          state.reactionA[north * width + x]
          + state.reactionA[south * width + x]
          + state.reactionA[y * width + west]
          + state.reactionA[y * width + east]
        )
        + 0.05 * (
          state.reactionA[north * width + west]
          + state.reactionA[north * width + east]
          + state.reactionA[south * width + west]
          + state.reactionA[south * width + east]
        );
      const lapB = -b
        + 0.2 * (
          state.reactionB[north * width + x]
          + state.reactionB[south * width + x]
          + state.reactionB[y * width + west]
          + state.reactionB[y * width + east]
        )
        + 0.05 * (
          state.reactionB[north * width + west]
          + state.reactionB[north * width + east]
          + state.reactionB[south * width + west]
          + state.reactionB[south * width + east]
        );
      const reaction = a * b * b;
      state.reactionNextA[index] = clamp(a + lapA - reaction + feed * (1 - a), 0, 1);
      state.reactionNextB[index] = clamp(b + diffusionB * lapB + reaction - (kill + feed) * b, 0, 1);
      if (updateStats) {
        coverage += b;
        edgeEnergy += Math.abs(b - state.reactionB[y * width + east]);
      }
    }
  }
  [state.reactionA, state.reactionNextA] = [state.reactionNextA, state.reactionA];
  [state.reactionB, state.reactionNextB] = [state.reactionNextB, state.reactionB];
  if (updateStats) {
    const size = width * height;
    state.reactionStats = { coverage: coverage / size, edges: edgeEnergy / size };
  }
}

function updateReactionDiffusion(dt) {
  if (!state.reactionA) resetReactionDiffusion();
  state.reactionAccumulator += dt * 38 * state.reactionSpeed;
  let steps = 0;
  while (state.reactionAccumulator >= 1 && steps < 6) {
    state.reactionAccumulator -= 1;
    stepReactionGrid();
    steps += 1;
  }
}

function drawReactionDiffusion() {
  const ctx = context2d;
  clearStage();
  if (!state.reactionA) resetReactionDiffusion();
  if (!patternCanvas) patternCanvas = document.createElement("canvas");
  if (patternCanvas.width !== REACTION_GRID_WIDTH || patternCanvas.height !== REACTION_GRID_HEIGHT) {
    patternCanvas.width = REACTION_GRID_WIDTH;
    patternCanvas.height = REACTION_GRID_HEIGHT;
  }
  const pctx = patternCanvas.getContext("2d");
  const image = pctx.createImageData(REACTION_GRID_WIDTH, REACTION_GRID_HEIGHT);
  for (let index = 0; index < state.reactionB.length; index += 1) {
    const b = state.reactionB[index];
    const x = index % REACTION_GRID_WIDTH;
    const neighbor = state.reactionB[
      Math.floor(index / REACTION_GRID_WIDTH) * REACTION_GRID_WIDTH
      + (x + 1) % REACTION_GRID_WIDTH
    ];
    const concentration = clamp(b * 2.15, 0, 1);
    const edge = clamp(Math.abs(b - neighbor) * 12, 0, 1);
    const pixel = index * 4;
    image.data[pixel] = Math.round(6 + concentration * 225 + edge * 18);
    image.data[pixel + 1] = Math.round(10 + concentration * 48 + edge * 176);
    image.data[pixel + 2] = Math.round(16 + concentration * 72 + edge * 154);
    image.data[pixel + 3] = 255;
  }
  pctx.putImageData(image, 0, 0);
  const top = stageTopInset();
  const margin = canvasWidth < 520 ? 12 : 34;
  const targetWidth = canvasWidth - margin * 2;
  const targetHeight = canvasHeight - top - 24;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(patternCanvas, margin, top, targetWidth, targetHeight);
  ctx.strokeStyle = "rgba(219, 228, 224, 0.18)";
  ctx.strokeRect(margin, top, targetWidth, targetHeight);
}

function associatedLaguerre(order, alpha, value) {
  if (order <= 0) return 1;
  if (order === 1) return 1 + alpha - value;
  let previous = 1;
  let current = 1 + alpha - value;
  for (let index = 2; index <= order; index += 1) {
    const next = ((2 * index - 1 + alpha - value) * current - (index - 1 + alpha) * previous) / index;
    previous = current;
    current = next;
  }
  return current;
}

function orbitalAmplitude(x, y) {
  const rotation = state.orbitalRotation * Math.PI / 180;
  const rotatedX = x * Math.cos(rotation) - y * Math.sin(rotation);
  const rotatedY = x * Math.sin(rotation) + y * Math.cos(rotation);
  const radius = Math.hypot(rotatedX, rotatedY);
  const angle = Math.atan2(rotatedY, rotatedX);
  const n = state.orbitalN;
  const l = state.orbitalL;
  const m = state.orbitalM;
  const rho = (2 * radius) / Math.max(1, n);
  const radial = Math.exp(-rho / 2) * rho ** l * associatedLaguerre(n - l - 1, 2 * l + 1, rho);
  const angular = m === 0 ? 1 : Math.cos(m * angle);
  return radial * angular;
}

function setOrbital(n, l, m) {
  state.orbitalN = n;
  state.orbitalL = l;
  state.orbitalM = m;
  state.orbitalLastSector = -1;
  updateOrbitalButtons();
  updateSummaries();
}

function updateOrbitalButtons() {
  for (const button of document.querySelectorAll("[data-orbital]")) {
    const [n, l, m] = button.dataset.orbital.split(":").map(Number);
    button.setAttribute("aria-pressed", String(
      n === state.orbitalN && l === state.orbitalL && m === state.orbitalM,
    ));
  }
}

function updateOrbital() {
  const sectors = Math.max(1, state.orbitalM * 2);
  const sector = Math.floor(wrap01(state.time * state.orbitalRate) * sectors);
  if (sector !== state.orbitalLastSector && state.orbitalLastSector >= 0 && state.audioOn) {
    audio.trigger({
      frequency: state.orbitalTone * 2 ** ((state.orbitalN + sector) / 12),
      gain: 0.065,
      duration: 0.12,
      type: state.orbitalL % 2 ? "triangle" : "sine",
      pan: sectors === 1 ? 0 : (sector / (sectors - 1)) * 2 - 1,
    });
  }
  state.orbitalLastSector = sector;
}

function drawAtomicOrbital() {
  const ctx = context2d;
  clearStage();
  const gridWidth = 176;
  const gridHeight = 132;
  if (!patternCanvas) patternCanvas = document.createElement("canvas");
  if (patternCanvas.width !== gridWidth || patternCanvas.height !== gridHeight) {
    patternCanvas.width = gridWidth;
    patternCanvas.height = gridHeight;
  }
  const amplitudes = new Float32Array(gridWidth * gridHeight);
  let maximum = 0;
  const scale = state.orbitalScale;
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const px = ((x / (gridWidth - 1)) * 2 - 1) * scale;
      const py = ((y / (gridHeight - 1)) * 2 - 1) * scale;
      const amplitude = orbitalAmplitude(px, py);
      amplitudes[y * gridWidth + x] = amplitude;
      maximum = Math.max(maximum, Math.abs(amplitude));
    }
  }
  const pctx = patternCanvas.getContext("2d");
  const image = pctx.createImageData(gridWidth, gridHeight);
  amplitudes.forEach((amplitude, index) => {
    const amount = Math.pow(Math.abs(amplitude) / Math.max(1e-6, maximum), 0.42);
    const pixel = index * 4;
    image.data[pixel] = Math.round(8 + (amplitude < 0 ? amount * 240 : amount * 45));
    image.data[pixel + 1] = Math.round(11 + amount * 200);
    image.data[pixel + 2] = Math.round(16 + (amplitude >= 0 ? amount * 215 : amount * 75));
    image.data[pixel + 3] = 255;
  });
  pctx.putImageData(image, 0, 0);
  const top = stageTopInset();
  const side = Math.min(canvasWidth * 0.82, canvasHeight - top - 24);
  const x = (canvasWidth - side) / 2;
  const y = top + (canvasHeight - top - side) / 2;
  ctx.drawImage(patternCanvas, x, y, side, side);
  const scan = state.time * state.orbitalRate * TAU;
  ctx.strokeStyle = "rgba(240, 203, 118, 0.72)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(canvasWidth / 2, y + side / 2);
  ctx.lineTo(canvasWidth / 2 + Math.cos(scan) * side * 0.48, y + side / 2 + Math.sin(scan) * side * 0.48);
  ctx.stroke();
  ctx.fillStyle = "rgba(240, 203, 118, 0.95)";
  ctx.beginPath();
  ctx.arc(canvasWidth / 2, y + side / 2, 4, 0, TAU);
  ctx.fill();
}

function sanitizeDna(value) {
  return String(value).toUpperCase().replace(/[^ACGT]/g, "").slice(0, 120);
}

function setDnaSequence(value) {
  state.dnaSequence = sanitizeDna(value) || "ATG";
  state.dnaIndex = 0;
  state.dnaAccumulator = 0;
  const input = $("dnaSequence");
  if (input && input.value !== state.dnaSequence) input.value = state.dnaSequence;
  updateDnaCurrent();
}

function updateDnaCurrent() {
  const sequence = state.dnaSequence;
  const codonStart = Math.floor(state.dnaIndex / 3) * 3;
  const codon = sequence.slice(codonStart, codonStart + 3);
  const code = codonAmino(codon);
  state.dnaCodon = codon.padEnd(3, "-");
  state.dnaAmino = AMINO_NAMES[code] ?? "Incomplete";
}

function stepDna() {
  const sequence = state.dnaSequence;
  if (!sequence.length) return;
  const base = sequence[state.dnaIndex];
  const baseIndex = "ACGT".indexOf(base);
  const codonBoundary = state.dnaIndex % 3 === 0;
  updateDnaCurrent();
  if (state.audioOn) {
    audio.trigger({
      frequency: state.dnaTone * [1, 9 / 8, 5 / 4, 3 / 2][Math.max(0, baseIndex)],
      gain: 0.09,
      duration: 0.11,
      type: baseIndex % 2 ? "triangle" : "sine",
      pan: -0.75 + baseIndex * 0.5,
    });
    if (codonBoundary) {
      const aminoIndex = Math.max(0, "ACDEFGHIKLMNPQRSTVWY*".indexOf(codonAmino(state.dnaCodon)));
      audio.trigger({
        frequency: state.dnaTone * 0.5 * 2 ** (aminoIndex / 24),
        gain: 0.075,
        duration: 0.24,
        type: "sine",
        pan: 0,
      });
    }
  }
  state.dnaIndex = (state.dnaIndex + 1) % sequence.length;
}

function updateDna(dt) {
  state.dnaAccumulator += dt * state.dnaRate;
  let steps = 0;
  while (state.dnaAccumulator >= 1 && steps < 5) {
    state.dnaAccumulator -= 1;
    stepDna();
    steps += 1;
  }
  updateDnaCurrent();
}

function mutateDna() {
  const sequence = state.dnaSequence.split("");
  if (!sequence.length) return;
  const index = Math.floor(Math.random() * sequence.length);
  const choices = "ACGT".replace(sequence[index], "");
  sequence[index] = choices[Math.floor(Math.random() * choices.length)];
  setDnaSequence(sequence.join(""));
  state.dnaIndex = index;
  setText("liveStatus", `Base ${index + 1} mutated to ${sequence[index]}.`);
}

function drawDna() {
  const ctx = context2d;
  clearStage();
  const sequence = state.dnaSequence;
  if (!sequence.length) return;
  const top = stageTopInset() + 12;
  const bottom = canvasHeight - 54;
  const centerY = top + (bottom - top) / 2;
  const amplitude = Math.min(76, (bottom - top) * 0.3);
  const visible = Math.min(sequence.length, Math.round(state.dnaWindow));
  const x0 = canvasWidth < 520 ? 18 : 44;
  const width = canvasWidth - x0 * 2;
  const baseColors = {
    A: "rgba(103, 226, 208, 0.95)",
    C: "rgba(240, 203, 118, 0.95)",
    G: "rgba(146, 221, 127, 0.95)",
    T: "rgba(255, 143, 156, 0.95)",
  };
  const points = [];
  for (let slot = 0; slot < visible; slot += 1) {
    const offset = slot - Math.floor(visible / 2);
    const index = (state.dnaIndex + offset + sequence.length) % sequence.length;
    const x = x0 + (slot / Math.max(1, visible - 1)) * width;
    const phase = slot * state.dnaTwist * 0.34;
    const yA = centerY + Math.sin(phase) * amplitude;
    const yB = centerY - Math.sin(phase) * amplitude;
    points.push({ index, x, yA, yB, base: sequence[index], current: offset === 0 });
  }
  ctx.lineWidth = 2;
  for (let strand = 0; strand < 2; strand += 1) {
    ctx.strokeStyle = strand === 0 ? "rgba(103, 226, 208, 0.48)" : "rgba(255, 143, 156, 0.42)";
    ctx.beginPath();
    points.forEach((point, index) => {
      const y = strand === 0 ? point.yA : point.yB;
      if (index === 0) ctx.moveTo(point.x, y);
      else ctx.lineTo(point.x, y);
    });
    ctx.stroke();
  }
  points.forEach((point) => {
    ctx.strokeStyle = point.current ? "rgba(255, 255, 255, 0.86)" : "rgba(219, 228, 224, 0.18)";
    ctx.lineWidth = point.current ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(point.x, point.yA);
    ctx.lineTo(point.x, point.yB);
    ctx.stroke();
    ctx.fillStyle = baseColors[point.base];
    ctx.beginPath();
    ctx.arc(point.x, point.yA, point.current ? 7 : 4, 0, TAU);
    ctx.arc(point.x, point.yB, point.current ? 7 : 4, 0, TAU);
    ctx.fill();
    if (point.current) {
      ctx.fillStyle = "#f5f7f4";
      ctx.font = "700 15px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(point.base, point.x, centerY + 5);
    }
  });
  ctx.fillStyle = "rgba(219, 228, 224, 0.7)";
  ctx.font = "12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${state.dnaCodon}  ->  ${state.dnaAmino}`, canvasWidth / 2, canvasHeight - 22);
}

function neuralRandom() {
  state.neuralSeed = (1664525 * state.neuralSeed + 1013904223) >>> 0;
  return state.neuralSeed / 0x100000000;
}

function resetNeuralNetwork() {
  state.neuralSeed = Math.floor(Math.random() * 0xffffffff) || 19;
  state.neuralWeights = [
    Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => neuralRandom() * 2.4 - 1.2)),
    Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => neuralRandom() * 2.4 - 1.2)),
  ];
  state.neuralBiases = [
    Array.from({ length: 6 }, () => neuralRandom() * 0.7 - 0.35),
    Array.from({ length: 3 }, () => neuralRandom() * 0.7 - 0.35),
  ];
  fireNeuralInput(state.neuralInput, false);
}

function fireNeuralInput(inputIndex = state.neuralInput, audition = true) {
  if (!state.neuralWeights.length) resetNeuralNetwork();
  state.neuralInput = clamp(Math.round(inputIndex), 0, 3);
  const input = Array.from({ length: 4 }, (_, index) => index === state.neuralInput ? 1 : 0.08);
  const hidden = state.neuralWeights[0].map((weights, index) => sigmoid(
    weights.reduce((sum, weight, source) => sum + weight * input[source], state.neuralBiases[0][index])
      * state.neuralGain
      + (hashUnit(index, state.neuralInput + state.time) - 0.5) * state.neuralNoise,
  ));
  const output = state.neuralWeights[1].map((weights, index) => sigmoid(
    weights.reduce((sum, weight, source) => sum + weight * hidden[source], state.neuralBiases[1][index])
      * state.neuralGain,
  ));
  state.neuralLayers = [input, hidden, output];
  state.neuralPulseAge = 0;
  state.neuralPulseCount = (state.neuralPulseCount || 0) + 1;
  if (audition && state.audioOn) {
    hidden.forEach((activation, index) => {
      if (activation < state.neuralThreshold) return;
      audio.trigger({
        frequency: 118 * 2 ** (PENTATONIC[index] / 12),
        gain: 0.035 + activation * 0.035,
        duration: 0.09,
        type: "triangle",
        pan: -0.25,
      });
    });
    output.forEach((activation, index) => {
      if (activation < state.neuralThreshold) return;
      audio.trigger({
        frequency: 236 * 2 ** ([0, 3, 7][index] / 12),
        gain: 0.055 + activation * 0.05,
        duration: 0.2,
        type: "sine",
        pan: 0.52,
      });
    });
  }
  updateNeuralButtons();
}

function updateNeuralButtons() {
  for (const button of document.querySelectorAll("[data-neural-input]")) {
    button.setAttribute("aria-pressed", String(
      Number(button.dataset.neuralInput) === state.neuralInput,
    ));
  }
}

function updateNeural(dt) {
  if (!state.neuralWeights.length) resetNeuralNetwork();
  state.neuralPulseAge += dt;
  state.neuralAccumulator += dt * state.neuralRate;
  if (state.neuralAccumulator >= 1) {
    state.neuralAccumulator %= 1;
    fireNeuralInput((state.neuralInput + 1) % 4);
  }
}

function neuralNodePositions() {
  const top = stageTopInset() + 8;
  const bottom = canvasHeight - 30;
  const xs = [canvasWidth * 0.2, canvasWidth * 0.52, canvasWidth * 0.82];
  return state.neuralLayers.map((layer, layerIndex) => layer.map((activation, index) => ({
    x: xs[layerIndex],
    y: top + ((index + 1) / (layer.length + 1)) * (bottom - top),
    activation,
  })));
}

function drawNeuralNetwork() {
  const ctx = context2d;
  clearStage();
  if (!state.neuralWeights.length) resetNeuralNetwork();
  const positions = neuralNodePositions();
  const travel = clamp(state.neuralPulseAge * state.neuralRate * 1.8, 0, 2);
  for (let layer = 0; layer < 2; layer += 1) {
    const sourceNodes = positions[layer];
    const targetNodes = positions[layer + 1];
    targetNodes.forEach((target, targetIndex) => {
      sourceNodes.forEach((source, sourceIndex) => {
        const weight = state.neuralWeights[layer][targetIndex][sourceIndex];
        const activity = source.activation * target.activation;
        ctx.strokeStyle = weight >= 0
          ? `rgba(103, 226, 208, ${0.07 + activity * 0.42})`
          : `rgba(255, 143, 156, ${0.07 + activity * 0.42})`;
        ctx.lineWidth = 0.5 + Math.abs(weight) * 1.2;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        const localTravel = travel - layer;
        if (localTravel >= 0 && localTravel <= 1 && activity > 0.16) {
          ctx.fillStyle = "rgba(240, 203, 118, 0.9)";
          ctx.beginPath();
          ctx.arc(lerp(source.x, target.x, localTravel), lerp(source.y, target.y, localTravel), 2.5, 0, TAU);
          ctx.fill();
        }
      });
    });
  }
  positions.forEach((layer, layerIndex) => {
    layer.forEach((node) => {
      const active = node.activation >= state.neuralThreshold;
      ctx.fillStyle = active
        ? layerIndex === 2 ? "rgba(240, 203, 118, 0.96)" : "rgba(103, 226, 208, 0.94)"
        : "rgba(22, 28, 31, 0.95)";
      ctx.strokeStyle = active ? "rgba(245, 247, 244, 0.74)" : "rgba(219, 228, 224, 0.25)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 8 + node.activation * 7, 0, TAU);
      ctx.fill();
      ctx.stroke();
    });
  });
}

function fourierCoefficient(wave, harmonic) {
  if (wave === "sine") return harmonic === 1 ? 1 : 0;
  if (wave === "square") return harmonic % 2 ? 4 / (Math.PI * harmonic) : 0;
  if (wave === "triangle") {
    if (harmonic % 2 === 0) return 0;
    return (8 / (Math.PI ** 2 * harmonic ** 2)) * (harmonic % 4 === 1 ? 1 : -1);
  }
  return (2 / (Math.PI * harmonic)) * (harmonic % 2 === 1 ? 1 : -1);
}

function fourierPartials() {
  const count = Math.round(state.fourierHarmonics);
  const partials = [];
  for (let harmonic = 1; harmonic <= count; harmonic += 1) {
    const coefficient = fourierCoefficient(state.fourierWave, harmonic);
    if (Math.abs(coefficient) > 1e-8) partials.push({ harmonic, coefficient });
  }
  return partials;
}

function fourierSample(phase) {
  return fourierPartials().reduce(
    (sum, partial) => sum + partial.coefficient * Math.sin(partial.harmonic * phase),
    0,
  );
}

function fourierTarget(phase) {
  if (state.fourierWave === "sine") return Math.sin(phase);
  if (state.fourierWave === "square") return Math.sin(phase) >= 0 ? 1 : -1;
  if (state.fourierWave === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(phase));
  const wrapped = ((phase + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapped / Math.PI;
}

function fourierError() {
  let sum = 0;
  const samples = 96;
  for (let index = 0; index < samples; index += 1) {
    const phase = (index / samples) * TAU - Math.PI;
    const error = fourierSample(phase) - fourierTarget(phase);
    sum += error * error;
  }
  return Math.sqrt(sum / samples);
}

function setFourierWave(wave) {
  state.fourierWave = wave;
  updateFourierButtons();
  updateSummaries();
}

function updateFourierButtons() {
  for (const button of document.querySelectorAll("[data-fourier-wave]")) {
    button.setAttribute("aria-pressed", String(button.dataset.fourierWave === state.fourierWave));
  }
}

function drawFourierEpicycles() {
  const ctx = context2d;
  clearStage();
  const top = stageTopInset();
  const centerY = top + (canvasHeight - top) * 0.5;
  const centerX = canvasWidth < 600 ? canvasWidth * 0.31 : canvasWidth * 0.32;
  const traceX = canvasWidth < 600 ? canvasWidth * 0.62 : canvasWidth * 0.58;
  const traceWidth = canvasWidth - traceX - 18;
  const scale = Math.min(canvasWidth * 0.2, (canvasHeight - top) * 0.29, 150);
  const phase = state.time * state.fourierRate * TAU;
  let x = centerX;
  let y = centerY;
  fourierPartials().forEach(({ harmonic, coefficient }, index) => {
    const radius = Math.abs(coefficient) * scale;
    const direction = coefficient < 0 ? -1 : 1;
    const nextX = x + Math.cos(harmonic * phase) * radius * direction;
    const nextY = y + Math.sin(harmonic * phase) * radius * direction;
    ctx.strokeStyle = `rgba(219, 228, 224, ${0.1 + 0.22 * (1 - index / Math.max(1, state.fourierHarmonics))})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = index % 2 ? "rgba(255, 143, 156, 0.72)" : "rgba(103, 226, 208, 0.78)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nextX, nextY);
    ctx.stroke();
    x = nextX;
    y = nextY;
  });
  ctx.strokeStyle = "rgba(240, 203, 118, 0.42)";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(traceX, y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(240, 203, 118, 0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const traceAmplitude = Math.min((canvasHeight - top) * 0.34, 170);
  for (let index = 0; index <= 220; index += 1) {
    const amount = index / 220;
    const sample = fourierSample(phase - amount * TAU * 1.5);
    const px = traceX + amount * traceWidth;
    const py = centerY + sample * traceAmplitude * 0.62;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(245, 247, 244, 0.95)";
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, TAU);
  ctx.fill();
}

function lensGeometry() {
  const thetaE = Math.sqrt(Math.max(0.02, state.lensMass));
  const beta = state.lensOffset + Math.sin(state.time * state.lensRate * TAU) * state.lensOrbit;
  const discriminant = Math.sqrt(beta * beta + 4 * thetaE * thetaE);
  const positive = (beta + discriminant) / 2;
  const negative = (beta - discriminant) / 2;
  const u = Math.max(0.025, Math.abs(beta) / thetaE);
  const totalMagnification = (u * u + 2) / (u * Math.sqrt(u * u + 4));
  const majorMagnification = (totalMagnification + 1) / 2;
  const minorMagnification = Math.max(0, (totalMagnification - 1) / 2);
  const potential = (theta) => 0.5 * (theta - beta) ** 2 - thetaE ** 2 * Math.log(Math.max(0.001, Math.abs(theta)));
  return {
    thetaE,
    beta,
    positive,
    negative,
    majorMagnification,
    minorMagnification,
    delay: Math.abs(potential(positive) - potential(negative)),
  };
}

function drawGravityLens() {
  const ctx = context2d;
  clearStage();
  const top = stageTopInset();
  const centerX = canvasWidth / 2;
  const centerY = top + (canvasHeight - top) * 0.5;
  const available = Math.min(canvasWidth, canvasHeight - top);
  const scale = available * 0.19;
  for (let index = 0; index < 90; index += 1) {
    const x = hashUnit(index, 3) * canvasWidth;
    const y = top + hashUnit(index, 9) * (canvasHeight - top);
    const glow = hashUnit(index, 14);
    ctx.fillStyle = `rgba(219, 228, 224, ${0.1 + glow * 0.42})`;
    ctx.fillRect(x, y, glow > 0.86 ? 2 : 1, glow > 0.86 ? 2 : 1);
  }
  const geometry = lensGeometry();
  const angle = -0.28 + Math.sin(state.time * state.lensRate * 0.37) * 0.2;
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const sourceX = centerX + geometry.beta * scale * axisX;
  const sourceY = centerY + geometry.beta * scale * axisY;
  ctx.strokeStyle = "rgba(146, 221, 127, 0.42)";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(sourceX, sourceY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(103, 226, 208, 0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, geometry.thetaE * scale, 0, TAU);
  ctx.stroke();
  const images = [
    { theta: geometry.positive, magnification: geometry.majorMagnification, color: "rgba(103, 226, 208, 0.94)" },
    { theta: geometry.negative, magnification: geometry.minorMagnification, color: "rgba(255, 143, 156, 0.9)" },
  ];
  images.forEach((image, index) => {
    const radius = Math.abs(image.theta) * scale;
    const imageAngle = image.theta >= 0 ? angle : angle + Math.PI;
    const arc = clamp(0.18 + Math.log1p(image.magnification) * 0.34, 0.18, 1.1);
    ctx.strokeStyle = image.color;
    ctx.lineWidth = 3 + Math.min(9, Math.log1p(image.magnification) * 3);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, imageAngle - arc / 2, imageAngle + arc / 2);
    ctx.stroke();
    const x = centerX + Math.cos(imageAngle) * radius;
    const y = centerY + Math.sin(imageAngle) * radius;
    ctx.fillStyle = image.color;
    ctx.beginPath();
    ctx.arc(x, y, index === 0 ? 5 : 3.5, 0, TAU);
    ctx.fill();
  });
  const lensRadius = 10 + geometry.thetaE * 4;
  const lensGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, lensRadius * 2.4);
  lensGradient.addColorStop(0, "rgba(2, 2, 3, 1)");
  lensGradient.addColorStop(0.48, "rgba(7, 8, 10, 0.98)");
  lensGradient.addColorStop(1, "rgba(240, 203, 118, 0)");
  ctx.fillStyle = lensGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, lensRadius * 2.4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(240, 203, 118, 0.66)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, lensRadius, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "rgba(146, 221, 127, 0.72)";
  ctx.beginPath();
  ctx.arc(sourceX, sourceY, 3, 0, TAU);
  ctx.fill();
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
      bindRange("moireInterval", "moireInterval", (value) => `${compact(value, 2)} oct · ${compact(2 ** value, 2)}×`);
      bindRange("moireVoices", "moireVoices", (value) => `${Math.round(value)} voices`);
      const secondPair = $("moireSecondPair");
      const pairOffset = $("moireLayerOffset");
      if (secondPair) {
        const syncSecondPair = () => {
          state.moireSecondPair = secondPair.checked;
          setText("moireSecondPairState", state.moireSecondPair ? "four lattices" : "two lattices");
          if (pairOffset) pairOffset.disabled = !state.moireSecondPair;
          pairOffset?.closest(".control")?.classList.toggle("is-disabled", !state.moireSecondPair);
          updateSummaries();
        };
        secondPair.addEventListener("change", syncSecondPair);
        syncSecondPair();
      }
      bindRange("moireLayerOffset", "moireLayerOffset", (value) => `${compact(value, 2)} intervals`);
      bindRange("moireUpAngle", "moireUpAngle", (value) => `${compact(value, 1)} deg · ${compact(moireAngleRate(value), 3)} oct/s`);
      bindRange("moireDownAngle", "moireDownAngle", (value) => `${compact(value, 1)} deg · ${compact(moireAngleRate(value), 3)} oct/s`);
      bindRange("moireOverlap", "moireOverlap", (value) => `${Math.round(value * 100)}%`);
      bindRange("moireTone", "moireTone", (value) => `${Math.round(value)} Hz`);
    },
    update(dt) {
      const cycleSpan = state.moireInterval * Math.round(state.moireVoices);
      state.moireUpPhase = wrapCentered(
        state.moireUpPhase + moireAngleRate(state.moireUpAngle) * dt,
        cycleSpan,
      );
      state.moireDownPhase = wrapCentered(
        state.moireDownPhase - moireAngleRate(state.moireDownAngle) * dt,
        cycleSpan,
      );
    },
    draw: drawMoire,
    drone() {
      return moireScene().voices.map((voice) => ({
        frequency: voice.frequency,
        gain: voice.gain,
        type: "sine",
        pan: voice.pan,
      }));
    },
    summary() {
      const voices = moireScene().voices;
      const voiceCount = Math.round(state.moireVoices);
      const pairCount = state.moireSecondPair ? 2 : 1;
      const frequencies = voices.map((voice) => voice.frequency);
      const minimum = Math.round(Math.min(...frequencies));
      const maximum = Math.round(Math.max(...frequencies));
      setText("metricPrimary", `${voices.length}`);
      setText("metricSecondary", `${minimum}–${maximum} Hz`);
      setText("patternSummary", `${voiceCount}+${voiceCount} · ${pairCount} ${pairCount === 1 ? "pair" : "pairs"}`);
      setText("stageReadout", `RISSET-MOIRE · GREEN +${compact(moireAngleRate(state.moireUpAngle), 3)} · PINK -${compact(moireAngleRate(state.moireDownAngle), 3)} OCT/S · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
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
  primes: {
    bind() {
      bindRange("primeLimit", "primeLimit", (value) => `${Math.round(value)}`);
      bindRange("primeRate", "primeRate", (value) => `${compact(value, 1)} n/s`);
      bindRange("primeRoot", "primeRoot", (value) => `${Math.round(value)} Hz`);
      bindRange("primeSpread", "primeSpread", (value) => `${compact(value, 1)} oct`);
      $("primeLimit")?.addEventListener("input", resetPrimeSieve);
      $("restartPrimes")?.addEventListener("click", resetPrimeSieve);
      resetPrimeSieve();
    },
    update: updatePrimeSieve,
    draw: drawPrimeSieve,
    drone() {
      const tested = Math.max(1, state.primeCursor - 2);
      const density = state.primeList.length / tested;
      const latest = state.primeList[state.primeList.length - 1] || 2;
      return [
        { frequency: state.primeRoot * 0.5, gain: 0.018 + density * 0.045, type: "sine", pan: -0.15 },
        { frequency: state.primeRoot * 0.5 + latest % 12, gain: 0.014 + density * 0.03, type: "triangle", pan: 0.15 },
      ];
    },
    summary() {
      const tested = Math.max(0, Math.min(state.primeLimit - 1, state.primeCursor - 2));
      setText("metricPrimary", `${state.primeList.length}`);
      setText("metricSecondary", `${Math.min(state.primeCursor, state.primeLimit)} / ${Math.round(state.primeLimit)}`);
      setText("patternSummary", `${tested} tested`);
      setText("stageReadout", `PRIME SIEVE · N ${Math.min(state.primeCursor, state.primeLimit)} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  lissajous: {
    bind() {
      bindRange("lissajousX", "lissajousX", (value) => `${Math.round(value)}`);
      bindRange("lissajousY", "lissajousY", (value) => `${Math.round(value)}`);
      bindRange("lissajousPhase", "lissajousPhase", (value) => `${Math.round(value)} deg`);
      bindRange("lissajousRate", "lissajousRate", (value) => `${compact(value, 2)} cyc/s`);
      bindRange("lissajousTone", "lissajousTone", (value) => `${Math.round(value)} Hz`);
    },
    update() {},
    draw: drawLissajous,
    drone() {
      return [
        { frequency: state.lissajousTone * state.lissajousX, gain: 0.09, type: "sine", pan: -0.38 },
        { frequency: state.lissajousTone * state.lissajousY, gain: 0.09, type: "sine", pan: 0.38 },
        { frequency: state.lissajousTone, gain: 0.028, type: "triangle", pan: 0 },
      ];
    },
    summary() {
      const x = Math.round(state.lissajousX);
      const y = Math.round(state.lissajousY);
      const divisor = gcd(x, y);
      setText("metricPrimary", `${x / divisor}:${y / divisor}`);
      setText("metricSecondary", `${compact(1 / Math.max(0.01, state.lissajousRate), 2)} s`);
      setText("patternSummary", `${x} by ${y} oscillations`);
      setText("stageReadout", `LISSAJOUS ORBITS · ${x}:${y} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  pendulums: {
    bind() {
      bindRange("pendulumCount", "pendulumCount", (value) => `${Math.round(value)}`);
      bindRange("pendulumRephase", "pendulumRephase", (value) => `${compact(value, 1)} s`);
      bindRange("pendulumStep", "pendulumStep", (value) => `${Math.round(value)} cycle`);
      bindRange("pendulumSwing", "pendulumSwing", (value) => `${Math.round(value)} deg`);
      bindRange("pendulumTone", "pendulumTone", (value) => `${Math.round(value)} Hz`);
    },
    update() {
      updatePendulums();
    },
    draw: drawPendulums,
    drone() {
      const coherence = pendulumCoherence();
      return [
        { frequency: state.pendulumTone * 0.5, gain: 0.012 + coherence * 0.052, type: "sine", pan: 0 },
        { frequency: state.pendulumTone * (1 + coherence * 0.5), gain: 0.012 + coherence * 0.025, type: "triangle", pan: 0 },
      ];
    },
    summary() {
      const rephase = Math.max(1, state.pendulumRephase);
      const remaining = rephase - (state.time % rephase);
      setText("metricPrimary", percent(pendulumCoherence()));
      setText("metricSecondary", `${compact(remaining, 1)} s`);
      setText("patternSummary", `${Math.round(state.pendulumCount)} periods`);
      setText("stageReadout", `PENDULUM WAVE · ${Math.round(state.pendulumCount)} BOBS · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  doublependulum: {
    bind() {
      bindRange("chaosGravity", "chaosGravity", (value) => `${compact(value, 2)} m/s2`);
      bindRange("chaosLength", "chaosLength", (value) => `${compact(value, 2)} x`);
      bindRange("chaosOffset", "chaosOffset", (value) => `${compact(value, 2)} deg`);
      bindRange("chaosSpeed", "chaosSpeed", (value) => `${compact(value, 2)} x`);
      bindRange("chaosTone", "chaosTone", (value) => `${Math.round(value)} Hz`);
      $("chaosOffset")?.addEventListener("input", resetDoublePendulum);
      $("releaseChaos")?.addEventListener("click", resetDoublePendulum);
      resetDoublePendulum();
    },
    update: stepDoublePendulum,
    draw: drawDoublePendulum,
    drone() {
      const divergence = clamp(chaosDivergence(), 0, Math.PI * 2);
      const energy = state.chaosSystems.reduce(
        (sum, system) => sum + system.av * system.av + system.bv * system.bv,
        0,
      ) / Math.max(1, state.chaosSystems.length);
      return [
        { frequency: state.chaosTone + Math.sqrt(energy) * 3, gain: 0.07, type: "triangle", pan: -0.32 },
        { frequency: state.chaosTone + Math.sqrt(energy) * 3 + divergence * 13, gain: 0.07, type: "sine", pan: 0.32 },
      ];
    },
    summary() {
      const degrees = chaosDivergence() * 180 / Math.PI;
      setText("metricPrimary", `${compact(degrees, 2)} deg`);
      setText("metricSecondary", `${compact(state.chaosElapsed, 1)} s`);
      setText("patternSummary", `${compact(state.chaosOffset, 2)} deg apart`);
      setText("stageReadout", `DOUBLE PENDULUM · DIVERGENCE ${compact(degrees, 1)} DEG · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  reaction: {
    bind() {
      bindRange("reactionFeed", "reactionFeed", (value) => compact(value, 4));
      bindRange("reactionKill", "reactionKill", (value) => compact(value, 4));
      bindRange("reactionDiffusion", "reactionDiffusion", (value) => compact(value, 2));
      bindRange("reactionSpeed", "reactionSpeed", (value) => `${compact(value, 1)} x`);
      for (const button of document.querySelectorAll("[data-reaction]")) {
        button.addEventListener("click", () => {
          const [feed, kill] = button.dataset.reaction.split(":").map(Number);
          const feedInput = $("reactionFeed");
          const killInput = $("reactionKill");
          if (feedInput) feedInput.value = String(feed);
          if (killInput) killInput.value = String(kill);
          controls.get("reactionFeed")?.();
          controls.get("reactionKill")?.();
          resetReactionDiffusion();
          updateReactionButtons();
        });
      }
      $("seedReaction")?.addEventListener("click", resetReactionDiffusion);
      canvas?.addEventListener("pointerdown", (event) => {
        const rect = canvas.getBoundingClientRect();
        const top = stageTopInset();
        seedReactionAt(
          (event.clientX - rect.left) / Math.max(1, rect.width),
          (event.clientY - rect.top - top) / Math.max(1, rect.height - top),
          6,
        );
      });
      resetReactionDiffusion();
      updateReactionButtons();
    },
    update: updateReactionDiffusion,
    draw: drawReactionDiffusion,
    drone() {
      const coverage = state.reactionStats.coverage;
      const edges = state.reactionStats.edges;
      return [
        { frequency: 72 + coverage * 680, gain: 0.035 + coverage * 0.08, type: "sine", pan: -0.28 },
        { frequency: 118 + edges * 3100, gain: 0.025 + edges * 0.4, type: "triangle", pan: 0.28 },
        { frequency: 54 + (state.reactionFeed + state.reactionKill) * 720, gain: 0.025, type: "sine", pan: 0 },
      ];
    },
    summary() {
      setText("metricPrimary", percent(state.reactionStats.coverage * 2.5));
      setText("metricSecondary", compact(state.reactionStats.edges, 3));
      setText("patternSummary", `F ${compact(state.reactionFeed, 4)} · K ${compact(state.reactionKill, 4)}`);
      setText("stageReadout", `REACTION-DIFFUSION · F ${compact(state.reactionFeed, 4)} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
      updateReactionButtons();
    },
  },
  orbitals: {
    bind() {
      bindRange("orbitalScale", "orbitalScale", (value) => `${compact(value, 1)} a0`);
      bindRange("orbitalRotation", "orbitalRotation", (value) => `${Math.round(value)} deg`);
      bindRange("orbitalRate", "orbitalRate", (value) => `${compact(value, 2)} rev/s`);
      bindRange("orbitalTone", "orbitalTone", (value) => `${Math.round(value)} Hz`);
      for (const button of document.querySelectorAll("[data-orbital]")) {
        button.addEventListener("click", () => {
          const [n, l, m] = button.dataset.orbital.split(":").map(Number);
          setOrbital(n, l, m);
        });
      }
      setOrbital(2, 1, 1);
    },
    update: updateOrbital,
    draw: drawAtomicOrbital,
    drone() {
      const root = state.orbitalTone * (1 + state.orbitalL * 0.22);
      const nodeGain = 0.045 / Math.max(1, state.orbitalN);
      return Array.from({ length: Math.min(6, state.orbitalN + state.orbitalL) }, (_, index) => ({
        frequency: root * (index + 1),
        gain: nodeGain / Math.sqrt(index + 1),
        type: index % 2 ? "triangle" : "sine",
        pan: lerp(-0.45, 0.45, index / Math.max(1, state.orbitalN + state.orbitalL - 1)),
      }));
    },
    summary() {
      const label = `${state.orbitalN}${["s", "p", "d", "f"][state.orbitalL] ?? "?"}`;
      setText("metricPrimary", `${compact(-13.6 / (state.orbitalN ** 2), 2)} eV`);
      setText("metricSecondary", `${state.orbitalN - 1}`);
      setText("patternSummary", `${label} slice · m ${state.orbitalM}`);
      setText("stageReadout", `ATOMIC ORBITALS · ${label.toUpperCase()} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
      updateOrbitalButtons();
    },
  },
  dna: {
    bind() {
      bindRange("dnaRate", "dnaRate", (value) => `${compact(value, 1)} bases/s`);
      bindRange("dnaTone", "dnaTone", (value) => `${Math.round(value)} Hz`);
      bindRange("dnaWindow", "dnaWindow", (value) => `${Math.round(value)} bases`);
      bindRange("dnaTwist", "dnaTwist", (value) => compact(value, 2));
      const sequence = $("dnaSequence");
      sequence?.addEventListener("input", () => setDnaSequence(sequence.value));
      $("mutateDna")?.addEventListener("click", mutateDna);
      $("restartDna")?.addEventListener("click", () => {
        state.dnaIndex = 0;
        state.dnaAccumulator = 0;
        updateDnaCurrent();
      });
      setDnaSequence(sequence?.value || state.dnaSequence);
    },
    update: updateDna,
    draw: drawDna,
    drone() {
      const counts = { A: 0, C: 0, G: 0, T: 0 };
      for (const base of state.dnaSequence) counts[base] += 1;
      const total = Math.max(1, state.dnaSequence.length);
      return "ACGT".split("").map((base, index) => ({
        frequency: state.dnaTone * [1, 9 / 8, 5 / 4, 3 / 2][index] * 0.5,
        gain: 0.008 + (counts[base] / total) * 0.055,
        type: index % 2 ? "triangle" : "sine",
        pan: -0.6 + index * 0.4,
      }));
    },
    summary() {
      setText("metricPrimary", state.dnaCodon);
      setText("metricSecondary", state.dnaAmino);
      setText("patternSummary", `${state.dnaSequence.length} bases`);
      setText("stageReadout", `DNA TRANSLATOR · BASE ${state.dnaIndex + 1} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
  neural: {
    bind() {
      bindRange("neuralThreshold", "neuralThreshold", percent);
      bindRange("neuralGain", "neuralGain", (value) => `${compact(value, 1)} x`);
      bindRange("neuralRate", "neuralRate", (value) => `${compact(value, 2)} pulse/s`);
      bindRange("neuralNoise", "neuralNoise", percent);
      for (const button of document.querySelectorAll("[data-neural-input]")) {
        button.addEventListener("click", () => fireNeuralInput(Number(button.dataset.neuralInput)));
      }
      $("randomizeNeural")?.addEventListener("click", resetNeuralNetwork);
      resetNeuralNetwork();
      updateNeuralButtons();
    },
    update: updateNeural,
    draw: drawNeuralNetwork,
    drone() {
      return state.neuralLayers[2].map((activation, index) => ({
        frequency: 72 * 2 ** ([0, 4, 7][index] / 12),
        gain: 0.012 + activation * 0.035,
        type: index % 2 ? "triangle" : "sine",
        pan: -0.4 + index * 0.4,
      }));
    },
    summary() {
      const active = state.neuralLayers.flat().filter((value) => value >= state.neuralThreshold).length;
      const confidence = Math.max(...state.neuralLayers[2]);
      setText("metricPrimary", `${active}`);
      setText("metricSecondary", percent(confidence));
      setText("patternSummary", `input ${state.neuralInput + 1} · fixed weights`);
      setText("stageReadout", `NEURAL PULSE · INPUT ${state.neuralInput + 1} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
      updateNeuralButtons();
    },
  },
  fourier: {
    bind() {
      bindRange("fourierHarmonics", "fourierHarmonics", (value) => `${Math.round(value)}`);
      bindRange("fourierRate", "fourierRate", (value) => `${compact(value, 2)} cyc/s`);
      bindRange("fourierTone", "fourierTone", (value) => `${Math.round(value)} Hz`);
      for (const button of document.querySelectorAll("[data-fourier-wave]")) {
        button.addEventListener("click", () => setFourierWave(button.dataset.fourierWave));
      }
      setFourierWave("square");
    },
    update() {},
    draw: drawFourierEpicycles,
    drone() {
      const partials = fourierPartials();
      const total = partials.reduce((sum, partial) => sum + Math.abs(partial.coefficient), 0) || 1;
      return partials.map(({ harmonic, coefficient }) => ({
        frequency: state.fourierTone * harmonic,
        gain: 0.19 * Math.abs(coefficient) / Math.sqrt(total),
        type: "sine",
        pan: clamp((harmonic / Math.max(1, state.fourierHarmonics)) * 1.2 - 0.6, -0.6, 0.6),
      }));
    },
    summary() {
      setText("metricPrimary", `${fourierPartials().length}`);
      setText("metricSecondary", compact(fourierError(), 3));
      setText("patternSummary", `${state.fourierWave} series`);
      setText("stageReadout", `FOURIER EPICYCLES · ${state.fourierWave.toUpperCase()} · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
      updateFourierButtons();
    },
  },
  lensing: {
    bind() {
      bindRange("lensMass", "lensMass", (value) => `${compact(value, 2)} M`);
      bindRange("lensOffset", "lensOffset", (value) => compact(value, 2));
      bindRange("lensOrbit", "lensOrbit", (value) => compact(value, 2));
      bindRange("lensRate", "lensRate", (value) => `${compact(value, 2)} cyc/s`);
      bindRange("lensTone", "lensTone", (value) => `${Math.round(value)} Hz`);
    },
    update() {},
    draw: drawGravityLens,
    drone() {
      const geometry = lensGeometry();
      const total = Math.max(1, geometry.majorMagnification + geometry.minorMagnification);
      return [
        {
          frequency: state.lensTone * 2 ** (clamp(geometry.positive, -2, 2) / 12),
          gain: clamp(0.16 * geometry.majorMagnification / total, 0.018, 0.14),
          type: "sine",
          pan: 0.48,
        },
        {
          frequency: state.lensTone * 2 ** (clamp(geometry.negative, -2, 2) / 12),
          gain: clamp(0.16 * geometry.minorMagnification / total, 0.012, 0.12),
          type: "triangle",
          pan: -0.48,
        },
      ];
    },
    summary() {
      const geometry = lensGeometry();
      setText("metricPrimary", compact(geometry.thetaE, 2));
      setText("metricSecondary", compact(geometry.delay, 3));
      setText("patternSummary", `source beta ${compact(geometry.beta, 2)}`);
      setText("stageReadout", `GRAVITY LENS · TWO IMAGES · AUDIO ${state.audioOn ? "ON" : "OFF"}`);
    },
  },
};

function updateAutomataButtons() {
  for (const button of document.querySelectorAll("[data-ca-rule]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.caRule) === Math.round(state.caRule)));
  }
}

function updateReactionButtons() {
  for (const button of document.querySelectorAll("[data-reaction]")) {
    const [feed, kill] = button.dataset.reaction.split(":").map(Number);
    const selected = Math.abs(feed - state.reactionFeed) < 0.00005
      && Math.abs(kill - state.reactionKill) < 0.00005;
    button.setAttribute("aria-pressed", String(selected));
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
