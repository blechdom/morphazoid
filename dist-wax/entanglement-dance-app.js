/**
 * Entanglement Dance — quantum entanglement heard as a slowed-down square dance.
 *
 * Physics: two-qubit Bell states (Φ+, Φ−, Ψ+, Ψ−) are modelled exactly.
 * Each qubit's Bloch-sphere equatorial angle drives a continuously drifting
 * pitch.  The correlation (or anti-correlation) in the Bell state means Alice
 * and Bob's melodic contours mirror or oppose each other — you hear the
 * entanglement as harmonic agreement or disagreement.
 *
 * A slow "caller" cycles through square-dance figures (Promenade, Do-Si-Do,
 * Swing, Allemande, Honor …).  On "Honor" the state collapses, striking a
 * correlated dyad that reveals the shared outcome.
 */

import { VoicePool } from "./src/audio.js";
import {
  blochAngles,
  bellProbabilities,
  bellCorrelation,
  bellConcurrence,
  sampleBellOutcome,
} from "./src/entanglement-dance.js";

// ─── constants ────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const DRAW_INTERVAL = 1_000 / 30;

const DEFAULTS = Object.freeze({
  bellState: "phi-plus",
  dephasing: 0,
  tempo: 2,         // BPM (0.3 – 8)
  aliceRoot: 220,   // Hz
  bobRoot: 110,     // Hz
  scaleSpread: 7,   // semitones — max pitch swing
  level: 0.44,
});

const FIGURES = Object.freeze([
  { id: "promenade",  label: "Promenade",      beats: 8,  phaseMultiplier: 0.25 },
  { id: "do-si-do",   label: "Do-Si-Do",       beats: 4,  phaseMultiplier: 1.0  },
  { id: "swing",      label: "Swing",          beats: 6,  phaseMultiplier: 0.75 },
  { id: "allemande",  label: "Allemande Left", beats: 4,  phaseMultiplier: 1.5  },
  { id: "honor",      label: "Honor",          beats: 2,  phaseMultiplier: 0.1  },
  { id: "circle",     label: "Circle",         beats: 6,  phaseMultiplier: 0.5  },
  { id: "pass-thru",  label: "Pass Through",   beats: 4,  phaseMultiplier: 0.8  },
]);

// Pentatonic semitone offsets from root
const PENT = Object.freeze([0, 2, 5, 7, 10, 12, 14, 17]);

// Bell state color themes (canvas)
const BELL_COLORS = Object.freeze({
  "phi-plus":  { alice: "#ff8fca", bob: "#69e7ff", cord: "#b59cff" },
  "phi-minus": { alice: "#ffb86b", bob: "#ff8fca", cord: "#ff8fca" },
  "psi-plus":  { alice: "#b8ff6a", bob: "#69e7ff", cord: "#5fe8c4" },
  "psi-minus": { alice: "#b8ff6a", bob: "#b59cff", cord: "#fff3d6" },
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;

const MEASURE_FLASH_MS = 680;

// ─── quantum model ────────────────────────────────────────────────────────────
// Physics functions (blochAngles, bellProbabilities, bellCorrelation,
// bellConcurrence, sampleBellOutcome) are imported from src/entanglement-dance.js.

// ─── figure sequencer ─────────────────────────────────────────────────────────

class FigureSequencer {
  constructor() {
    this.figureIndex = 0;
    this.beat = 0;
    this.beatFraction = 0;
  }

  get figure() { return FIGURES[this.figureIndex]; }

  /** Advance dt seconds at bps beats-per-second; returns true if the beat changed. */
  advance(dt, bps) {
    const prevBeat = this.beat;
    this.beatFraction += dt * bps;
    const whole = Math.floor(this.beatFraction);
    this.beatFraction -= whole;
    this.beat += whole;
    if (this.beat >= this.figure.beats) {
      this.beat = 0;
      this.figureIndex = (this.figureIndex + 1) % FIGURES.length;
      return "figure";
    }
    return prevBeat !== this.beat ? "beat" : null;
  }

  nextFigure() {
    this.beat = 0;
    this.beatFraction = 0;
    this.figureIndex = (this.figureIndex + 1) % FIGURES.length;
  }

  get figureFraction() {
    return (this.beat + this.beatFraction) / this.figure.beats;
  }
}

// ─── page state ──────────────────────────────────────────────────────────────

const state = {
  ...DEFAULTS,
  playing: false,
  audioOn: false,
  audioStarting: false,
  globalPhase: 0,
  lastOutcome: null,
  flashUntil: 0,
  measureFlashUntil: 0,
};

const sequencer = new FigureSequencer();
const voices = new VoicePool(12);

let frameId = null;
let lastFrameTime = 0;
let lastDrawTime = -Infinity;
let canvasW = 1;
let canvasH = 1;
let pixelRatio = 1;
let disposed = false;
let pageActive = true;
let audioRequest = 0;

const TRAIL_MAX = 80;
const aliceTrail = [];
const bobTrail = [];

const canvas = $("stage");
const stageWrap = $("stageWrap");
const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

// ─── audio helpers ───────────────────────────────────────────────────────────

/**
 * Map the Bloch equatorial angle (0..2π) to a frequency that smoothly sweeps
 * through the pentatonic scale above root, scaled by scaleSpread semitones.
 */
function angleToFrequency(angle, root, spread) {
  const normalized = ((angle % TAU) + TAU) % TAU;
  const t = normalized / TAU;
  const scaledIndex = t * (PENT.length - 1);
  const lo = Math.floor(scaledIndex) % PENT.length;
  const hi = (lo + 1) % PENT.length;
  const frac = scaledIndex - Math.floor(scaledIndex);
  const semitones = lerp(PENT[lo], PENT[hi], frac) * (spread / PENT[PENT.length - 1]);
  return root * Math.pow(2, semitones / 12);
}

function computeVoiceSpecs() {
  const { aliceAngle, bobAngle } = blochAngles(state.bellState, state.globalPhase);
  const coherence = 1 - state.dephasing;
  const base = 0.18 * (0.6 + 0.4 * coherence);
  return [
    { key: "ent-alice", frequency: angleToFrequency(aliceAngle, state.aliceRoot, state.scaleSpread), gain: base, pan: -0.72, waveform: "sine" },
    { key: "ent-bob",   frequency: angleToFrequency(bobAngle,   state.bobRoot,   state.scaleSpread), gain: base, pan:  0.72, waveform: "sine" },
  ];
}

function updateAudioVoices() {
  if (!state.audioOn) return;
  voices.setVoices(computeVoiceSpecs());
}

/** Strike the correlated dyad for a given two-bit outcome. */
function strikeOutcome(outcome) {
  if (!state.audioOn) return;
  const aliceFreq = outcome[0] === "0" ? state.aliceRoot : state.aliceRoot * 2;
  const bobFreq   = outcome[1] === "0" ? state.bobRoot   : state.bobRoot   * 2;
  voices.strike({ frequency: aliceFreq, gain: 0.26, pan: -0.72, waveform: "sine" },
    { attackSeconds: 0.006, decaySeconds: 0.65, startDelaySeconds: 0 });
  voices.strike({ frequency: bobFreq,   gain: 0.26, pan:  0.72, waveform: "sine" },
    { attackSeconds: 0.008, decaySeconds: 0.75, startDelaySeconds: 0.055 });
}

/** Caller's rhythmic beat pulse. */
function strikeBeat(isMeasure) {
  if (!state.audioOn) return;
  voices.strike(
    { frequency: isMeasure ? 200 : 158, gain: isMeasure ? 0.10 : 0.048, pan: 0, waveform: "sine" },
    { attackSeconds: 0.002, decaySeconds: isMeasure ? 0.38 : 0.16 },
  );
}

/** Short tonal announce when a new figure starts. */
function strikeFigureAnnounce(figure) {
  if (!state.audioOn) return;
  const table = {
    "promenade": [state.aliceRoot * 1.5,  state.bobRoot * 1.25],
    "do-si-do":  [state.aliceRoot * 1.25, state.bobRoot * 1.5],
    "swing":     [state.aliceRoot,         state.bobRoot * 2],
    "allemande": [state.aliceRoot * 2,     state.bobRoot],
    "honor":     [state.aliceRoot * 1.5,  state.bobRoot * 1.5],
    "circle":    [state.aliceRoot,         state.bobRoot],
    "pass-thru": [state.aliceRoot * 2,     state.bobRoot * 2],
  };
  const [af, bf] = table[figure.id] ?? [state.aliceRoot, state.bobRoot];
  voices.strike({ frequency: af, gain: 0.13, pan: -0.5, waveform: "sine" },
    { attackSeconds: 0.01, decaySeconds: 0.42 });
  voices.strike({ frequency: bf, gain: 0.13, pan:  0.5, waveform: "sine" },
    { attackSeconds: 0.012, decaySeconds: 0.42, startDelaySeconds: 0.08 });
}

// ─── measurement ─────────────────────────────────────────────────────────────

function measureNow() {
  const probs = bellProbabilities(state.bellState, 0, 0, state.dephasing);
  const outcome = sampleBellOutcome(probs);
  state.lastOutcome = outcome;
  state.measureFlashUntil = performance.now() + 680;
  strikeOutcome(outcome);
  strikeBeat(true);
  $("lastOutcome").textContent = outcome;
  announce(`Measured: ${outcome}. Alice ${outcome[0]}, Bob ${outcome[1]}.`);
}

// ─── readouts ────────────────────────────────────────────────────────────────

function updateReadouts() {
  const concurrence = bellConcurrence(state.dephasing);
  const probs = bellProbabilities(state.bellState, 0, 0, state.dephasing);
  const correlation = bellCorrelation(probs);
  const { aliceAngle, bobAngle } = blochAngles(state.bellState, state.globalPhase);
  const fig = sequencer.figure;
  const bellLabel = { "phi-plus": "Φ+", "phi-minus": "Φ−", "psi-plus": "Ψ+", "psi-minus": "Ψ−" }[state.bellState] ?? "?";
  const corrLabel = correlation > 0.02 ? "correlated" : correlation < -0.02 ? "anti-correlated" : "separable";
  const aDegs = Math.round(((aliceAngle % TAU) + TAU) % TAU * 180 / Math.PI);
  const bDegs = Math.round(((bobAngle   % TAU) + TAU) % TAU * 180 / Math.PI);
  const bpm = Number(state.tempo).toFixed(1);

  $("danceSummary").textContent    = `${fig.label} · ${bpm} BPM`;
  $("bellStateSummary").textContent = `${bellLabel} · ${corrLabel}`;
  $("voiceSummary").textContent    = `Alice ${state.aliceRoot} Hz · Bob ${state.bobRoot} Hz`;
  $("readoutSummary").textContent  = `C ${concurrence.toFixed(3)} · ${correlation >= 0 ? "+" : ""}${correlation.toFixed(3)}`;
  $("concurrenceReadout").textContent = concurrence.toFixed(3);
  $("correlationReadout").textContent = `${correlation >= 0 ? "+" : ""}${correlation.toFixed(3)}`;
  $("figureReadout").textContent   = fig.label;
  $("beatReadout").textContent     = `${sequencer.beat + 1} / ${fig.beats}`;
  $("aliceThetaReadout").textContent = `${aDegs}°`;
  $("bobThetaReadout").textContent   = `${bDegs}°`;
  $("levelOut").textContent        = pct(state.level);
  $("tempoOut").textContent        = `${bpm} BPM`;
  $("aliceRootOut").textContent    = `${state.aliceRoot} Hz`;
  $("bobRootOut").textContent      = `${state.bobRoot} Hz`;
  $("scaleSpreadOut").textContent  = `${state.scaleSpread} st`;
  $("dephasingOut").textContent    = pct(state.dephasing);
  $("stageReadout").textContent    = [
    `BELL ${bellLabel}`,
    fig.label.toUpperCase(),
    `C ${concurrence.toFixed(3)}`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
}

function updateTransport() {
  const btn = $("playButton");
  btn.setAttribute("aria-pressed", String(state.playing));
  btn.setAttribute("aria-label", state.playing ? "Pause dance" : "Play dance");
  document.body.classList.toggle("is-playing", state.playing);
}

function updateAudioInterface() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

// ─── canvas ───────────────────────────────────────────────────────────────────

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  pixelRatio = Math.max(1, Math.min(window.devicePixelRatio ?? 1, 3));
  const w = Math.round(rect.width  * pixelRatio);
  const h = Math.round(rect.height * pixelRatio);
  if (w !== canvasW || h !== canvasH) {
    canvasW = w; canvasH = h;
    canvas.width  = canvasW;
    canvas.height = canvasH;
    canvas.style.width  = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    aliceTrail.length = 0;
    bobTrail.length   = 0;
  }
}

function drawTrail(trail, color) {
  if (trail.length < 2) return;
  ctx.save();
  for (let i = 1; i < trail.length; i++) {
    const age = 1 - i / trail.length;
    ctx.globalAlpha = age * age * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth   = pixelRatio * lerp(0.5, 2.5, age);
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x,     trail[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDancer(cx, cy, r, color, label, highlight) {
  ctx.save();
  // Outer glow
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
  grd.addColorStop(0,   `${color}55`);
  grd.addColorStop(0.5, `${color}1a`);
  grd.addColorStop(1,   `${color}00`);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.6, 0, TAU);
  ctx.fill();
  // Core
  ctx.fillStyle = highlight ? color : `${color}cc`;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  // Letter
  ctx.fillStyle = "#07090b";
  ctx.font = `bold ${Math.round(r * 0.78)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

function drawCord(ax, ay, bx, by, concurrence, color) {
  ctx.save();
  ctx.globalAlpha = concurrence * 0.48;
  const grd = ctx.createLinearGradient(ax, ay, bx, by);
  grd.addColorStop(0,   `${color}aa`);
  grd.addColorStop(0.5, `${color}ff`);
  grd.addColorStop(1,   `${color}aa`);
  ctx.strokeStyle = grd;
  ctx.lineWidth = pixelRatio * lerp(0.8, 3.5, concurrence);
  ctx.setLineDash([Math.round(pixelRatio * 8), Math.round(pixelRatio * 5)]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitRing(cx, cy, rx, ry, color) {
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = color;
  ctx.lineWidth = pixelRatio;
  ctx.setLineDash([Math.round(pixelRatio * 4), Math.round(pixelRatio * 7)]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawFigureLabel(label, fraction, flashUntil) {
  const age = performance.now() < flashUntil ? 1 : 0.28;
  const cy = canvasH * 0.88;
  const cx = canvasW * 0.5;

  ctx.save();
  ctx.globalAlpha = age;
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.round(pixelRatio * 10)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.toUpperCase(), cx, cy);

  // Progress bar
  const barW = canvasW * 0.25;
  const bx = cx - barW * 0.5;
  const by = cy + pixelRatio * 14;
  ctx.globalAlpha = age * 0.32;
  ctx.fillStyle = "#ffffff44";
  ctx.fillRect(bx, by, barW, pixelRatio * 2);
  ctx.globalAlpha = age * 0.75;
  ctx.fillStyle = "#ffffffaa";
  ctx.fillRect(bx, by, barW * fraction, pixelRatio * 2);
  ctx.restore();
}

function drawMeasureFlash(flashUntil) {
  const t = 1 - (performance.now() - (flashUntil - 680)) / 680;
  if (t <= 0) return;
  ctx.save();
  ctx.globalAlpha = t * 0.14;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvasW, canvasH);

  const { aliceAngle, bobAngle } = blochAngles(state.bellState, state.globalPhase);
  const concurrence = bellConcurrence(state.dephasing);
  const colors = BELL_COLORS[state.bellState] ?? BELL_COLORS["phi-plus"];

  // Layout: Alice on left quadrant, Bob on right
  const orbitR = Math.min(canvasW, canvasH) * 0.22;
  const cy     = canvasH * 0.48;
  const aOx    = canvasW * 0.28;
  const bOx    = canvasW * 0.72;

  drawOrbitRing(aOx, cy, orbitR, orbitR * 0.62, colors.alice);
  drawOrbitRing(bOx, cy, orbitR, orbitR * 0.62, colors.bob);

  // Bloch-sphere equatorial positions
  const ax = aOx + Math.cos(aliceAngle) * orbitR;
  const ay = cy  + Math.sin(aliceAngle) * orbitR * 0.62;
  const bx = bOx + Math.cos(bobAngle)   * orbitR;
  const by_ = cy + Math.sin(bobAngle)   * orbitR * 0.62;

  // Trails
  aliceTrail.unshift({ x: ax, y: ay });
  bobTrail  .unshift({ x: bx, y: by_ });
  if (aliceTrail.length > TRAIL_MAX) aliceTrail.length = TRAIL_MAX;
  if (bobTrail  .length > TRAIL_MAX) bobTrail  .length = TRAIL_MAX;

  drawTrail(aliceTrail, colors.alice);
  drawTrail(bobTrail,   colors.bob);

  // Entanglement cord (drawn between the two orbits' current positions)
  drawCord(ax, ay, bx, by_, concurrence, colors.cord);

  const isMeasure = performance.now() < state.measureFlashUntil;
  const r = pixelRatio * 15;

  drawDancer(ax, ay,  r, colors.alice, "A", isMeasure);
  drawDancer(bx, by_, r, colors.bob,   "B", isMeasure);

  drawFigureLabel(sequencer.figure.label, sequencer.figureFraction, state.flashUntil);
  drawMeasureFlash(state.measureFlashUntil);
}

// ─── main loop ────────────────────────────────────────────────────────────────

function scheduleFrame() {
  if (!frameId && !disposed && pageActive) {
    frameId = requestAnimationFrame(onFrame);
  }
}

function onFrame(now) {
  frameId = null;
  if (disposed || !pageActive) return;

  const dt = Math.min((now - lastFrameTime) / 1_000, 0.1);
  lastFrameTime = now;

  if (state.playing) {
    const bps = state.tempo / 60;
    const fig = sequencer.figure;
    state.globalPhase += fig.phaseMultiplier * bps * TAU * dt;

    const event = sequencer.advance(dt, bps);
    if (event === "beat" || event === "figure") {
      strikeBeat(false);
      if (event === "figure") {
        state.flashUntil = now + 1_200;
        strikeFigureAnnounce(sequencer.figure);
        if (sequencer.figure.id === "honor") measureNow();
        updateReadouts();
      }
    }

    updateAudioVoices();
  }

  if (now - lastDrawTime >= DRAW_INTERVAL) {
    lastDrawTime = now;
    resizeCanvas();
    draw();
  }

  updateReadouts();
  scheduleFrame();
}

// ─── event wiring ─────────────────────────────────────────────────────────────

function announce(msg) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    if (!disposed && pageActive) $("liveStatus").textContent = msg;
  });
}

function togglePlaying() {
  if (!pageActive || disposed) return;
  state.playing = !state.playing;
  lastFrameTime = performance.now();
  updateTransport();
  if (state.playing) scheduleFrame();
  announce(state.playing ? "Dance playing." : "Dance paused.");
}

async function toggleAudio() {
  if (state.audioStarting || !pageActive || disposed) return;
  const req = ++audioRequest;
  $("audioError").hidden = true;

  if (state.audioOn) {
    voices.disable();
    state.audioOn = false;
    updateAudioInterface();
    announce("Audio off.");
    return;
  }

  state.audioStarting = true;
  updateAudioInterface();

  try {
    voices.setLevel(state.level);
    updateAudioVoices();
    await voices.start();
    if (req !== audioRequest) return;
    state.audioOn = true;
    announce("Audio on.");
  } catch (err) {
    if (req !== audioRequest) return;
    voices.disable();
    state.audioOn = false;
    const msg = err instanceof Error ? err.message : String(err);
    $("audioError").textContent = msg;
    $("audioError").hidden = false;
    announce(`Audio error: ${msg}`);
  } finally {
    if (req === audioRequest) {
      state.audioStarting = false;
      updateAudioInterface();
    }
  }
}

function setBellState(id) {
  state.bellState = id;
  document.querySelectorAll("[data-bell]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.bell === id));
  });
  aliceTrail.length = 0;
  bobTrail  .length = 0;
  const label = { "phi-plus": "Φ+", "phi-minus": "Φ−", "psi-plus": "Ψ+", "psi-minus": "Ψ−" }[id] ?? id;
  announce(`Bell state ${label}`);
  updateAudioVoices();
  updateReadouts();
}

$("audioButton").addEventListener("click", toggleAudio);
$("playButton").addEventListener("click", togglePlaying);

$("level").addEventListener("input", (e) => {
  state.level = clamp(Number(e.target.value), 0, 0.82);
  voices.setLevel(state.level);
  $("levelOut").textContent = pct(state.level);
});

$("tempo").addEventListener("input", (e) => {
  state.tempo = clamp(Number(e.target.value), 0.3, 8);
  $("tempoOut").textContent = `${Number(state.tempo).toFixed(1)} BPM`;
});

$("dephasing").addEventListener("input", (e) => {
  state.dephasing = clamp(Number(e.target.value), 0, 1);
  $("dephasingOut").textContent = pct(state.dephasing);
  aliceTrail.length = 0;
  bobTrail  .length = 0;
  updateAudioVoices();
  updateReadouts();
});

$("aliceRoot").addEventListener("input", (e) => {
  state.aliceRoot = clamp(Number(e.target.value), 55, 880);
  $("aliceRootOut").textContent = `${state.aliceRoot} Hz`;
  updateAudioVoices();
});

$("bobRoot").addEventListener("input", (e) => {
  state.bobRoot = clamp(Number(e.target.value), 27, 440);
  $("bobRootOut").textContent = `${state.bobRoot} Hz`;
  updateAudioVoices();
});

$("scaleSpread").addEventListener("input", (e) => {
  state.scaleSpread = clamp(Number(e.target.value), 2, 14);
  $("scaleSpreadOut").textContent = `${state.scaleSpread} st`;
  updateAudioVoices();
});

document.querySelectorAll("[data-bell]").forEach((btn) => {
  btn.addEventListener("click", () => setBellState(btn.dataset.bell));
});

$("callButton").addEventListener("click", () => {
  sequencer.nextFigure();
  state.flashUntil = performance.now() + 1_200;
  strikeFigureAnnounce(sequencer.figure);
  announce(`Figure: ${sequencer.figure.label}`);
  updateReadouts();
});

$("measureButton").addEventListener("click", () => {
  measureNow();
  updateReadouts();
});

$("resetDance").addEventListener("click", () => {
  const audioWas = state.audioOn;
  const startingWas = state.audioStarting;
  Object.assign(state, { ...DEFAULTS });
  state.playing = false;
  state.audioOn = audioWas;
  state.audioStarting = startingWas;
  state.globalPhase = 0;
  state.lastOutcome = null;
  state.flashUntil = 0;
  state.measureFlashUntil = 0;

  sequencer.figureIndex = 0;
  sequencer.beat = 0;
  sequencer.beatFraction = 0;
  aliceTrail.length = 0;
  bobTrail  .length = 0;

  $("tempo").value     = String(DEFAULTS.tempo);
  $("dephasing").value = String(DEFAULTS.dephasing);
  $("aliceRoot").value = String(DEFAULTS.aliceRoot);
  $("bobRoot").value   = String(DEFAULTS.bobRoot);
  $("scaleSpread").value = String(DEFAULTS.scaleSpread);
  $("level").value     = String(DEFAULTS.level);

  setBellState(DEFAULTS.bellState);
  updateTransport();
  updateAudioInterface();
  updateAudioVoices();
  updateReadouts();
  announce("Dance reset.");
});

canvas.addEventListener("keydown", (e) => {
  if (e.key === " ")                  { e.preventDefault(); togglePlaying(); }
  else if (e.key === "Escape")        { if (state.audioOn || state.audioStarting) toggleAudio(); }
  else if (e.key.toLowerCase() === "c") $("callButton").click();
  else if (e.key.toLowerCase() === "m") $("measureButton").click();
});

document.addEventListener("visibilitychange", () => {
  pageActive = document.visibilityState === "visible";
  if (pageActive) { lastFrameTime = performance.now(); scheduleFrame(); }
});

// ─── boot ─────────────────────────────────────────────────────────────────────

updateReadouts();
updateTransport();
updateAudioInterface();

lastFrameTime = performance.now();
scheduleFrame();

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  if (frameId) { cancelAnimationFrame(frameId); frameId = null; }
  voices.disable();
});
