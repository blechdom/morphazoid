import {
  JAW_JAM_ACTIONS,
  JAW_JAM_BREATH_RATIOS,
  JAW_JAM_DEFAULTS,
  JAW_JAM_LIMITS,
  JAW_JAM_PATTERNS,
  JAW_JAM_SOUND_PRESETS,
  jawJamBreathRateBpm,
  jawJamPattern,
  jawJamPulseEnergy,
  jawJamResolvedMidi,
  jawJamStepConfiguration,
  jawJamStepIntervalSeconds,
  randomizeJawJamPattern,
  sanitizeJawJamPattern,
} from "./src/jaw-jam.js";
import {
  JAW_HARP_LIMITS,
  JAW_HARP_PRESETS,
  VOWEL_PRESETS,
  clamp,
  jawHarpPreset,
  naturalTineStrike,
} from "./src/jaw-harp.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const compactLayout = globalThis.matchMedia?.("(max-width: 720px), (pointer: coarse)");
const ACTION_ORDER = Object.freeze(["pluck", "sustain", "rest"]);
const ACTION_LABELS = Object.freeze({ pluck: "PLUCK", sustain: "HOLD", rest: "X" });
const PAINT_MODES = Object.freeze(["pitch", "pull", "air", "rate", "vowel", "voice", "sustain", "rest"]);
const PAINT_HINTS = Object.freeze({
  pitch: "Drag vertically for pitch, then sweep sideways to write several plucks in one gesture. Shift paints rests; Option paints holds.",
  pull: "Height sets tine pull. Sweep across pluck steps to shape a run of attacks.",
  air: "Height sets breath strength. Sweep across sounding steps to shape the lung pulse.",
  rate: "Height sets breath speed from 0.125× to 8× on a musical exponential scale.",
  vowel: "Sweep across sounding steps to stamp the selected vowel from the editor below.",
  voice: "Sweep across sounding steps to stamp the selected voice and physical material.",
  sustain: "Sweep across steps to carry the previous pitch without striking the tine again.",
  rest: "Sweep across steps to write hard rests that choke the tine and breath.",
});
const DEFAULT_LIMITS = Object.freeze({
  stepCount: [1, 32],
  midi: [27, 53],
  tempo: [36, 480],
  swing: [-0.42, 0.42],
  pluckIntensity: [0, 1],
  breathPower: [0, 3],
  breathRateMultiplier: [0.125, 8],
});
const SCHEDULER_INTERVAL_MS = 18;
const performerCanvas = $("performerStage");
const performerDrawing = performerCanvas?.getContext?.("2d", { alpha: true, desynchronized: true }) ?? null;
const PERFORMER_MATERIAL_COLORS = Object.freeze({
  khomus: "#df9d5a",
  munnharpe: "#d9ded9",
  marranzanu: "#c47d58",
  kubing: "#c7a464",
  "dan-moi": "#d8ba65",
});
let performerWidth = 0;
let performerHeight = 0;
let performerPixelRatio = 1;
let performerPluckStartedAt = -Infinity;
let performerPluckIntensity = 0;
let performerLastStrikeAt = -Infinity;
let performerReadoutSignature = "";
let performerResizePending = true;
let performanceSnapshotPattern = null;
let performanceSnapshots = new Map();
let clockReadoutSignature = "";
const performerResizeObserver = performerCanvas && typeof ResizeObserver === "function"
  ? new ResizeObserver(() => { performerResizePending = true; })
  : null;
performerResizeObserver?.observe(performerCanvas);
globalThis.addEventListener("resize", () => { performerResizePending = true; });

function limitsFor(key) {
  const limits = JAW_JAM_LIMITS?.[key];
  return Array.isArray(limits) && limits.length >= 2 ? limits : DEFAULT_LIMITS[key];
}

function ratioValue(entry) {
  return Number(entry?.value ?? entry?.ratio ?? entry);
}

function ratioLabel(value) {
  if (Math.abs(value - 1 / 3) < 1e-6) return "every 3 beats";
  if (Math.abs(value - 1 / 2) < 1e-6) return "every 2 beats";
  if (value === 1) return "1 per beat";
  return `${value}\u00d7 per beat`;
}

function noteName(midi) {
  if (!Number.isFinite(Number(midi))) return "\u2014";
  const names = ["C", "C\u266f", "D", "D\u266f", "E", "F", "F\u266f", "G", "G\u266f", "A", "A\u266f", "B"];
  const note = Math.round(Number(midi));
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

function midiFrequency(midi) {
  return 440 * (2 ** ((Number(midi) - 69) / 12));
}

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatSignedPercent(value) {
  const amount = Math.round(Number(value) * 100);
  return `${amount > 0 ? "+" : ""}${amount}%`;
}

function performerArticulationUnit(value) {
  return clamp((Number(value) + 1) / 3.2);
}

function syncPerformerCanvasSize() {
  if (!performerCanvas || !performerDrawing) return false;
  if (!performerResizePending && performerWidth > 0 && performerHeight > 0) return true;
  const rect = performerCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ratio = clamp(globalThis.devicePixelRatio || 1, 1, 2);
  performerResizePending = false;
  if (width === performerWidth && height === performerHeight && ratio === performerPixelRatio) return true;
  performerWidth = width;
  performerHeight = height;
  performerPixelRatio = ratio;
  performerCanvas.width = Math.max(1, Math.round(width * ratio));
  performerCanvas.height = Math.max(1, Math.round(height * ratio));
  performerDrawing.setTransform(ratio, 0, 0, ratio, 0, 0);
  return true;
}

function performerStroke(color, width = 1, alpha = 1) {
  performerDrawing.strokeStyle = color;
  performerDrawing.lineWidth = width;
  performerDrawing.globalAlpha = alpha;
  performerDrawing.stroke();
  performerDrawing.globalAlpha = 1;
}

function performerMaterialColor(materialId) {
  return PERFORMER_MATERIAL_COLORS[materialId] ?? "#df9d5a";
}

function performerBreathFlow(step, configuration) {
  if (!playing || step.action === "rest") return 0;
  const measuredFlow = Number(telemetry.breathFlow) || 0;
  if (Math.abs(measuredFlow) > 0.012) return measuredFlow;
  const balance = clamp(configuration?.breathBalance ?? 0.5, 0.02, 0.98);
  const depth = Number(step.breathPower) || 0;
  if (breathVisualPhase < balance) {
    return -Math.sin(Math.PI * breathVisualPhase / balance) * depth;
  }
  return Math.sin(Math.PI * (breathVisualPhase - balance) / (1 - balance)) * depth;
}

function triggerPerformerPluck(intensity = 0.75) {
  if (!performerDrawing || prefersReducedMotion) return;
  const now = performance.now();
  // The worklet confirmation and the visual scheduling ledger can report the
  // same attack a few milliseconds apart. Keep one physical finger gesture.
  if (now - performerLastStrikeAt < 28) return;
  performerLastStrikeAt = now;
  performerPluckStartedAt = now;
  performerPluckIntensity = clamp(Number(intensity) || 0, 0, 1);
}

function performerPluckMotion(time, direction = 1) {
  const seconds = Math.max(0, (time - performerPluckStartedAt) / 1_000);
  if (!Number.isFinite(seconds) || seconds > 1.35) return 0;
  const strength = 0.22 + performerPluckIntensity * 0.78;
  // A strong fundamental plus two shorter flexural modes keeps the second and
  // third visible swings alive instead of reducing the release to one bounce.
  const fundamental = Math.sin(seconds * 44) * Math.exp(-seconds * 3.35);
  const secondMode = 0.48 * Math.sin(seconds * 86 + 0.18) * Math.exp(-seconds * 5.1);
  const thirdMode = 0.25 * Math.sin(seconds * 132 + 0.42) * Math.exp(-seconds * 7.2);
  return direction * strength * (fundamental + secondMode + thirdMode);
}

function drawPerformerHair(model) {
  const { backX, browX, topY, mouthY, scale } = model;
  performerDrawing.beginPath();
  performerDrawing.moveTo(backX + 2 * scale, mouthY + 15 * scale);
  performerDrawing.bezierCurveTo(
    backX - 18 * scale, mouthY - 22 * scale,
    backX - 15 * scale, topY + 20 * scale,
    backX + 28 * scale, topY - 2 * scale,
  );
  performerDrawing.lineTo(backX + 47 * scale, topY + 7 * scale);
  performerDrawing.lineTo(backX + 59 * scale, topY - 4 * scale);
  performerDrawing.lineTo(backX + 75 * scale, topY + 9 * scale);
  performerDrawing.lineTo(backX + 92 * scale, topY + 1 * scale);
  performerDrawing.bezierCurveTo(
    browX - 30 * scale, topY + 3 * scale,
    browX - 10 * scale, topY + 14 * scale,
    browX, topY + 30 * scale,
  );
  performerDrawing.bezierCurveTo(
    browX - 38 * scale, topY + 19 * scale,
    backX + 24 * scale, topY + 30 * scale,
    backX + 2 * scale, mouthY + 15 * scale,
  );
  performerDrawing.closePath();
  performerDrawing.fillStyle = "rgba(91, 64, 45, 0.52)";
  performerDrawing.fill();
  performerStroke("#b77a4e", 1, 0.58);
  performerDrawing.beginPath();
  performerDrawing.moveTo(backX + 31 * scale, topY + 17 * scale);
  performerDrawing.quadraticCurveTo(backX + 48 * scale, topY + 4 * scale, backX + 62 * scale, topY + 17 * scale);
  performerDrawing.moveTo(backX + 58 * scale, topY + 18 * scale);
  performerDrawing.quadraticCurveTo(backX + 75 * scale, topY + 3 * scale, backX + 88 * scale, topY + 16 * scale);
  performerStroke("#df9d5a", 0.75, 0.3);
}

function drawPerformerHead(model, configuration, flow) {
  const {
    backX, browX, topY, lipX, lipTipX, mouthY, jawGap, scale,
  } = model;
  const exhale = clamp(flow / Math.max(0.2, Number(configuration?.breathDepth) || 1), 0, 1);
  const inhale = clamp(-flow / Math.max(0.2, Number(configuration?.breathDepth) || 1), 0, 1);
  drawPerformerHair(model);

  performerDrawing.beginPath();
  performerDrawing.moveTo(backX, mouthY + jawGap * 1.75);
  performerDrawing.bezierCurveTo(
    backX - 19 * scale, mouthY + 23 * scale,
    backX - 21 * scale, topY + 31 * scale,
    backX + 38 * scale, topY,
  );
  performerDrawing.bezierCurveTo(
    browX - 30 * scale, topY - 4 * scale,
    browX + 14 * scale, topY + 20 * scale,
    browX + 18 * scale, mouthY - 62 * scale,
  );
  performerDrawing.bezierCurveTo(
    browX + 41 * scale, mouthY - 61 * scale,
    browX + 65 * scale, mouthY - 51 * scale,
    browX + 60 * scale, mouthY - 34 * scale,
  );
  performerDrawing.bezierCurveTo(
    browX + 55 * scale, mouthY - 24 * scale,
    lipX + 13 * scale, mouthY - 26 * scale,
    lipTipX, mouthY - 5 * scale,
  );
  performerDrawing.bezierCurveTo(
    lipTipX + 12 * scale, mouthY + 1 * scale,
    lipTipX + 10 * scale, mouthY + 9 * scale,
    lipTipX - 1 * scale, mouthY + 11 * scale,
  );
  performerDrawing.bezierCurveTo(
    lipX + 27 * scale, mouthY + 34 * scale,
    lipX + 15 * scale, mouthY + jawGap + 32 * scale,
    lipX - 24 * scale, mouthY + jawGap + 48 * scale,
  );
  performerDrawing.bezierCurveTo(
    lipX - 70 * scale, mouthY + jawGap + 70 * scale,
    backX + 10 * scale, mouthY + jawGap + 66 * scale,
    backX, mouthY + jawGap * 1.75,
  );
  performerStroke("#7a827c", 1.15, 0.78);

  const eyeX = browX + 4 * scale;
  const eyeY = mouthY - 45 * scale;
  const eyeWidth = 8.8 * scale * (1 + exhale * 0.08);
  const eyeHeight = 3.2 * scale * (1 + exhale * 0.4 - inhale * 0.12);
  performerDrawing.beginPath();
  performerDrawing.moveTo(eyeX - eyeWidth, eyeY);
  performerDrawing.quadraticCurveTo(eyeX, eyeY - eyeHeight, eyeX + eyeWidth, eyeY);
  performerDrawing.quadraticCurveTo(eyeX, eyeY + eyeHeight, eyeX - eyeWidth, eyeY);
  performerDrawing.closePath();
  performerDrawing.fillStyle = "rgba(229, 229, 220, 0.84)";
  performerDrawing.fill();
  performerStroke("#a7ada7", 0.8, 0.72);
  performerDrawing.beginPath();
  performerDrawing.arc(eyeX + 1.5 * scale, eyeY, Math.max(1.4, eyeHeight * 0.68), 0, Math.PI * 2);
  performerDrawing.fillStyle = "rgba(118, 223, 211, 0.76)";
  performerDrawing.fill();
  performerDrawing.beginPath();
  performerDrawing.arc(eyeX + 1.7 * scale, eyeY, Math.max(0.7, eyeHeight * 0.3), 0, Math.PI * 2);
  performerDrawing.fillStyle = "#101512";
  performerDrawing.fill();

  performerDrawing.beginPath();
  performerDrawing.moveTo(browX + 44 * scale, mouthY - 31 * scale);
  performerDrawing.quadraticCurveTo(browX + 50 * scale, mouthY - 36 * scale, browX + 56 * scale, mouthY - 31 * scale);
  performerStroke("#a58871", 0.8, 0.62);

  const throatX = model.throatX;
  performerDrawing.beginPath();
  performerDrawing.moveTo(lipTipX - 2 * scale, mouthY - 3 * scale);
  performerDrawing.bezierCurveTo(
    lipX - 28 * scale, mouthY - 9 * scale,
    throatX + 43 * scale, mouthY - 18 * scale,
    throatX, mouthY + 2 * scale,
  );
  performerDrawing.bezierCurveTo(
    throatX - 7 * scale, mouthY + 16 * scale,
    throatX + 2 * scale, mouthY + jawGap * 0.92,
    throatX + 15 * scale, mouthY + jawGap,
  );
  performerDrawing.bezierCurveTo(
    throatX + 52 * scale, mouthY + jawGap * 0.76,
    lipX - 30 * scale, mouthY + jawGap * 0.7,
    lipTipX - 2 * scale, mouthY + 7 * scale,
  );
  performerDrawing.closePath();
  performerDrawing.fillStyle = "rgba(118, 223, 211, 0.055)";
  performerDrawing.fill();
  performerStroke("#76dfd3", 1.05, 0.58);

  const tongueX = throatX + (lipX - throatX) * (0.3 + performerArticulationUnit(configuration?.tonguePosition) * 0.58);
  const tongueY = mouthY + jawGap * 0.66 - performerArticulationUnit(configuration?.tongueHeight) * (jawGap * 0.58 + 8 * scale);
  performerDrawing.beginPath();
  performerDrawing.moveTo(lipTipX - 4 * scale, mouthY + 6 * scale);
  performerDrawing.bezierCurveTo(
    tongueX + 42 * scale, mouthY + jawGap * 0.7,
    tongueX + 30 * scale, tongueY,
    tongueX, tongueY,
  );
  performerDrawing.bezierCurveTo(
    tongueX - 43 * scale, tongueY + 2 * scale,
    throatX + 14 * scale, mouthY + jawGap,
    throatX + 15 * scale, mouthY + jawGap,
  );
  performerDrawing.bezierCurveTo(
    throatX + 56 * scale, mouthY + jawGap * 1.04,
    lipX - 25 * scale, mouthY + jawGap,
    lipTipX - 4 * scale, mouthY + 6 * scale,
  );
  performerDrawing.closePath();
  performerDrawing.fillStyle = "rgba(186, 154, 246, 0.13)";
  performerDrawing.fill();
  performerStroke("#ba9af6", 1.1, 0.72);

  const glottisUnit = performerArticulationUnit(configuration?.glottisOpening);
  const glottisX = throatX + (5 + glottisUnit * 15) * scale;
  const glottisY = mouthY + jawGap * 1.06;
  performerDrawing.beginPath();
  performerDrawing.moveTo(throatX + 10 * scale, glottisY - 7 * scale);
  performerDrawing.lineTo(glottisX, glottisY);
  performerDrawing.lineTo(throatX + 10 * scale, glottisY + 7 * scale);
  performerStroke("#ee786d", 1.5, 0.7);
}

function drawPerformerBreath(model, step, flow, time, breathRate) {
  const airUnit = stepControlUnit(step.breathPower, "breathPower");
  if (step.action === "rest" || airUnit < 0.01) return;
  const exhaling = flow >= 0;
  const direction = exhaling ? 1 : -1;
  const color = exhaling ? "#f0c46e" : "#76dfd3";
  const startX = model.throatX + 9 * model.scale;
  const endX = model.triggerX + 22 * model.scale;
  const motion = prefersReducedMotion ? 0.35 : (time * (0.00018 + Math.sqrt(breathRate) * 0.000055)) % 1;
  performerDrawing.save();
  performerDrawing.lineCap = "round";
  for (let index = 0; index < 8; index += 1) {
    const travel = (motion + index / 8) % 1;
    const position = exhaling ? travel : 1 - travel;
    const x = startX + (endX - startX) * position;
    const y = model.mouthY + Math.sin(index * 2.1 + time * 0.004) * model.scale * (1.5 + airUnit * 2.5);
    const length = model.scale * (5 + airUnit * 7);
    performerDrawing.beginPath();
    performerDrawing.moveTo(x - direction * length * 0.5, y);
    performerDrawing.lineTo(x + direction * length * 0.5, y);
    performerDrawing.lineTo(x + direction * (length * 0.5 - 3 * model.scale), y - 2.2 * model.scale);
    performerDrawing.moveTo(x + direction * length * 0.5, y);
    performerDrawing.lineTo(x + direction * (length * 0.5 - 3 * model.scale), y + 2.2 * model.scale);
    performerStroke(color, 0.9, 0.13 + airUnit * 0.52);
  }
  performerDrawing.restore();
}

function drawPerformerHarp(model, step, configuration, material, time, resolvedMidi) {
  const { bowX, lipX, mouthY, triggerX, scale } = model;
  const materialColor = performerMaterialColor(material.id);
  const bamboo = material.id === "kubing";
  const gap = (bamboo ? 10 : 8.5) * scale;
  const frameEnd = lipX + 5 * scale;
  const pluckDirection = Number(configuration?.pluckDirection) < 0 ? -1 : 1;
  const pluckMotion = step.action === "pluck" ? performerPluckMotion(time, pluckDirection) : 0;
  const energy = step.action === "rest" ? 0 : clamp((Number(telemetry.energy) || 0) / 1.6);
  const frequency = midiFrequency(resolvedMidi ?? step.midi);
  const liveVibration = playing && !prefersReducedMotion
    ? Math.sin(time * Math.min(0.22, frequency / 620)) * energy * 0.19
    : 0;
  const displacement = (pluckMotion + liveVibration) * (13 + stepControlUnit(step.pluckIntensity, "pluckIntensity") * 13) * scale;
  const triggerY = mouthY + displacement;

  performerDrawing.lineCap = "round";
  performerDrawing.beginPath();
  performerDrawing.moveTo(frameEnd, mouthY - gap);
  performerDrawing.lineTo(bowX + 16 * scale, mouthY - gap);
  performerDrawing.bezierCurveTo(
    bowX - 14 * scale, mouthY - gap,
    bowX - 14 * scale, mouthY + gap,
    bowX + 16 * scale, mouthY + gap,
  );
  performerDrawing.lineTo(frameEnd, mouthY + gap);
  performerStroke(materialColor, (bamboo ? 5.2 : 4.2) * scale, 0.22);
  performerDrawing.beginPath();
  performerDrawing.moveTo(frameEnd, mouthY - gap);
  performerDrawing.lineTo(bowX + 16 * scale, mouthY - gap);
  performerDrawing.bezierCurveTo(
    bowX - 14 * scale, mouthY - gap,
    bowX - 14 * scale, mouthY + gap,
    bowX + 16 * scale, mouthY + gap,
  );
  performerDrawing.lineTo(frameEnd, mouthY + gap);
  performerStroke(materialColor, (bamboo ? 1.6 : 1.05) * scale, 0.94);

  const reedStartX = bowX + 1 * scale;
  performerDrawing.beginPath();
  performerDrawing.moveTo(reedStartX, mouthY);
  performerDrawing.quadraticCurveTo((reedStartX + triggerX) * 0.54, mouthY - displacement * 0.44, triggerX, triggerY);
  performerStroke(bamboo ? "#d4b67a" : "#f3bd79", (bamboo ? 2.2 : 1.55) * scale, step.action === "rest" ? 0.38 : 0.96);
  if (energy > 0.04 && !prefersReducedMotion) {
    for (const side of [-1, 1]) {
      performerDrawing.beginPath();
      performerDrawing.moveTo(reedStartX, mouthY);
      performerDrawing.quadraticCurveTo(
        (reedStartX + triggerX) * 0.54,
        mouthY - displacement * 0.35 + side * energy * 4 * scale,
        triggerX,
        triggerY + side * energy * 7 * scale,
      );
      performerStroke(materialColor, 0.7 * scale, 0.13 + energy * 0.13);
    }
  }
  performerDrawing.beginPath();
  performerDrawing.moveTo(triggerX, triggerY - 8 * scale);
  performerDrawing.lineTo(triggerX, triggerY + 9 * scale);
  performerDrawing.lineTo(triggerX + 6 * scale, triggerY + 11 * scale);
  performerStroke(bamboo ? "#d4b67a" : "#f3bd79", 1.6 * scale, step.action === "rest" ? 0.38 : 0.96);

  const seconds = Math.max(0, (time - performerPluckStartedAt) / 1_000);
  if (seconds < 0.34 && step.action === "pluck" && !prefersReducedMotion) {
    const retreat = clamp(seconds / 0.34);
    const fingerX = triggerX + (17 + retreat * 30) * scale;
    const fingerY = triggerY + (10 + retreat * 11) * scale;
    performerDrawing.beginPath();
    performerDrawing.moveTo(fingerX + 30 * scale, fingerY + 12 * scale);
    performerDrawing.bezierCurveTo(
      fingerX + 18 * scale, fingerY + 1 * scale,
      fingerX + 8 * scale, fingerY - 2 * scale,
      fingerX, fingerY,
    );
    performerDrawing.bezierCurveTo(
      fingerX + 8 * scale, fingerY + 8 * scale,
      fingerX + 18 * scale, fingerY + 14 * scale,
      fingerX + 30 * scale, fingerY + 17 * scale,
    );
    performerDrawing.fillStyle = "rgba(181, 139, 108, 0.16)";
    performerDrawing.fill();
    performerStroke("#b58b6c", 1.1 * scale, 0.74 * (1 - retreat * 0.36));
  }

  const pulse = step.action === "rest" ? 0 : jawJamPulseEnergy(step);
  if (pulse > 0.01 && (playing || seconds < 0.5)) {
    const pulseTime = prefersReducedMotion ? 0.4 : (time * 0.0018) % 1;
    performerDrawing.beginPath();
    performerDrawing.arc(triggerX, triggerY, (7 + pulseTime * 18) * scale, 0, Math.PI * 2);
    performerStroke(materialColor, 0.9 * scale, (1 - pulseTime) * pulse * 0.34);
  }
}

function updatePerformerReadout(index, step, material, resolvedMidi) {
  const vowel = VOWEL_PRESETS.find(({ id }) => id === step.vowelId);
  const signature = `${index}:${step.action}:${resolvedMidi}:${material.id}:${step.vowelId}:${step.pluckIntensity}:${step.breathPower}`;
  if (signature === performerReadoutSignature) return;
  performerReadoutSignature = signature;
  if ($("performerStep")) $("performerStep").textContent = String(index + 1).padStart(2, "0");
  if ($("performerGesture")) $("performerGesture").textContent = step.action === "rest"
    ? "choke / rest"
    : `${step.action} · ${resolvedMidi === null ? "no pitch" : noteName(resolvedMidi)}`;
  if ($("performerVoice")) $("performerVoice").textContent = material.family;
  if ($("performerVowel")) $("performerVowel").textContent = vowel?.phoneme ?? `/${step.vowelId}/`;
  if ($("performerPull")) $("performerPull").textContent = formatPercent(step.action === "pluck" ? step.pluckIntensity : 0);
  if ($("performerAir")) $("performerAir").textContent = formatPercent(step.action === "rest" ? 0 : step.breathPower);
  if ($("performerPulse")) $("performerPulse").textContent = formatPercent(step.action === "rest" ? 0 : jawJamPulseEnergy(step));
  performerCanvas?.setAttribute(
    "aria-label",
    `Animated profile performing step ${index + 1}: ${step.action}, ${resolvedMidi === null ? "no pitch" : noteName(resolvedMidi)}, ${material.family}, vowel ${step.vowelId}`,
  );
}

function drawPerformerStage(time) {
  if (!syncPerformerCanvasSize() || !pattern?.steps?.length) return;
  const index = clamp(visibleStep >= 0 ? visibleStep : selectedStep, 0, pattern.stepCount - 1);
  const {
    step, configuration, material, resolvedMidi, breathRate,
  } = performanceSnapshot(index);
  const flow = performerBreathFlow(step, configuration);
  const scale = clamp(Math.min(performerHeight / 205, performerWidth / 650), 0.7, 1.38);
  const mouthY = performerHeight * 0.53;
  const lipX = performerWidth * (performerWidth < 560 ? 0.62 : 0.64);
  const articulationJaw = performerArticulationUnit(configuration.jawOpening);
  const lipRounding = performerArticulationUnit(configuration.lipRounding);
  const jawGap = (12 + articulationJaw * 22) * scale;
  const lipTipX = lipX + (-5 + lipRounding * 17) * scale;
  const model = {
    scale,
    mouthY,
    lipX,
    lipTipX,
    jawGap,
    throatX: lipX - 112 * scale,
    backX: lipX - 152 * scale,
    browX: lipX - 13 * scale,
    topY: Math.max(27, mouthY - 91 * scale),
    bowX: Math.max(22, lipX - 155 * scale),
    triggerX: Math.min(performerWidth - 60 * scale, lipX + 125 * scale),
  };

  performerDrawing.clearRect(0, 0, performerWidth, performerHeight);
  const haze = performerDrawing.createRadialGradient(
    model.lipX, model.mouthY, 4,
    model.lipX, model.mouthY, Math.max(performerWidth, performerHeight) * 0.52,
  );
  haze.addColorStop(0, "rgba(118, 223, 211, 0.035)");
  haze.addColorStop(1, "rgba(4, 6, 5, 0)");
  performerDrawing.fillStyle = haze;
  performerDrawing.fillRect(0, 0, performerWidth, performerHeight);

  drawPerformerHead(model, configuration, flow);
  drawPerformerBreath(model, step, flow, time, breathRate);
  drawPerformerHarp(model, step, configuration, material, time, resolvedMidi);

  const materialColor = performerMaterialColor(material.id);
  performerDrawing.fillStyle = materialColor;
  performerDrawing.globalAlpha = 0.72;
  performerDrawing.font = "650 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  performerDrawing.textAlign = "left";
  performerDrawing.fillText(material.label.toUpperCase(), 14, performerHeight - 19);
  performerDrawing.fillStyle = "#76dfd3";
  performerDrawing.textAlign = "center";
  performerDrawing.fillText(`/${step.vowelId.toUpperCase()}/`, model.lipX - 44 * scale, model.mouthY - 23 * scale);
  performerDrawing.fillStyle = "#e5e5dc";
  performerDrawing.textAlign = "right";
  performerDrawing.fillText(
    step.action === "rest" ? "REST · TINE CHOKED" : `${step.action.toUpperCase()} · ${resolvedMidi === null ? "—" : noteName(resolvedMidi)}`,
    performerWidth - 14,
    performerHeight - 19,
  );
  performerDrawing.globalAlpha = 1;
  updatePerformerReadout(index, step, material, resolvedMidi);
}

function mutablePattern(source) {
  const sanitized = sanitizeJawJamPattern(source);
  return {
    ...sanitized,
    steps: sanitized.steps.map((step) => ({ ...step })),
  };
}

const initialPattern = JAW_JAM_PATTERNS[0] ?? JAW_JAM_DEFAULTS;
let pattern = mutablePattern(initialPattern);
let selectedStep = 0;
let visibleStep = -1;
let stepViews = [];
let paintMode = "pitch";
let interactionMode = "draw";
let paintGesture = null;
let audioContext = null;
let graph = null;
let audioStartupPromise = null;
let audioDesiredOn = false;
let audioStatus = "off";
let audioTransitionGeneration = 0;
let pageLifecycleGeneration = 0;
let pageIsActive = true;
let playing = false;
let schedulerTimer = 0;
let transportGeneration = 0;
let sequenceStep = 0;
let absoluteStep = 0;
let nextStepTime = 0;
let scheduledLedger = [];
let clockOriginTime = 0;
let breathVisualPhase = 0;
let breathVisualTime = 0;
let animationFrame = 0;
let lastReadoutAt = 0;
let outputLevel = Number($("level")?.value) || 0.52;
let telemetry = {
  energy: 0,
  peak: 0,
  rms: 0,
  breathFlow: 0,
  harmonicIndex: 1,
  harmonicFrequencyHz: 0,
};

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function setAudioPresentation(status = "off", message = "") {
  audioStatus = status;
  const button = $("audioButton");
  if (button) {
    button.setAttribute("aria-pressed", String(status === "on"));
    button.disabled = status === "starting";
  }
  if ($("audioState")) $("audioState").textContent = status === "starting" ? "starting" : status;
  if ($("audioError")) {
    $("audioError").hidden = !message;
    $("audioError").textContent = message;
  }
}

function requestAudioState(on) {
  if (audioDesiredOn !== on) {
    audioDesiredOn = on;
    audioTransitionGeneration += 1;
  }
  return audioTransitionGeneration;
}

function firstPlayableConfiguration() {
  const index = pattern.steps.findIndex(({ action }) => action === "pluck");
  return jawJamStepConfiguration(pattern, index >= 0 ? index : 0) ?? {};
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  let releaseOutput = null;
  unlockAudioContext(context);
  try {
    await context.audioWorklet.addModule(new URL("./src/jaw-jam-processor.js", import.meta.url));
    const sourceNode = new AudioWorkletNode(context, "jaw-jam-physical-model", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { configuration: firstPlayableConfiguration() },
    });
    const compressor = context.createDynamicsCompressor();
    const masterGain = context.createGain();
    const analyser = context.createAnalyser();
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.075;
    masterGain.gain.value = outputLevel;
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.56;
    sourceNode.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    sourceNode.port.onmessage = handleProcessorMessage;
    sourceNode.onprocessorerror = () => {
      stopSequence({ silence: false, announceState: false });
      setAudioPresentation("error", "The Jaw Jam physical model stopped unexpectedly. Reload the page to reset it.");
    };
    return { context, sourceNode, compressor, masterGain, analyser, releaseOutput };
  } catch (error) {
    releaseOutput?.();
    try { await context.close?.(); } catch { /* Preserve the startup error. */ }
    throw error;
  }
}

async function ensureAudio() {
  const transitionGeneration = requestAudioState(true);
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      const lifecycleGeneration = pageLifecycleGeneration;
      const startup = createAudioGraph()
        .then((createdGraph) => {
          if (!pageIsActive || !audioDesiredOn || lifecycleGeneration !== pageLifecycleGeneration) {
            createdGraph.releaseOutput?.();
            void createdGraph.context.close?.();
            return false;
          }
          graph = createdGraph;
          audioContext = createdGraph.context;
          return true;
        })
        .catch((error) => {
          console.error(error);
          if (pageIsActive && lifecycleGeneration === pageLifecycleGeneration) {
            setAudioPresentation("error", error?.message || "Unable to start Jaw Jam audio.");
          }
          return false;
        })
        .finally(() => {
          if (audioStartupPromise === startup) audioStartupPromise = null;
        });
      audioStartupPromise = startup;
    }
    if (!(await audioStartupPromise)) return false;
  }
  const activeGraph = graph;
  const activeContext = audioContext;
  try {
    unlockAudioContext(activeContext);
    await activeContext.resume();
    if (
      !pageIsActive
      || !audioDesiredOn
      || transitionGeneration !== audioTransitionGeneration
      || activeGraph !== graph
    ) return false;
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    if (activeGraph === graph) setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioDesiredOn && audioStatus === "on" && audioContext) {
    const transitionGeneration = requestAudioState(false);
    const suspendingContext = audioContext;
    stopSequence({ silence: true, announceState: false });
    await suspendingContext.suspend();
    if (
      transitionGeneration !== audioTransitionGeneration
      || audioDesiredOn
      || suspendingContext !== audioContext
    ) return;
    setAudioPresentation("off");
    return;
  }
  await ensureAudio();
}

function handleProcessorMessage(event) {
  const message = event.data ?? {};
  if (message.type === "telemetry") {
    telemetry = { ...telemetry, ...message };
    return;
  }
  if (
    message.type === "sequence-step"
    && playing
    && Number(message.generation) === transportGeneration
    && Number.isInteger(Number(message.stepIndex))
  ) {
    setVisibleStep(Number(message.stepIndex));
  }
}

function seededRandom(seedValue) {
  let seed = (Math.trunc(Number(seedValue) || 0) ^ 0x4a61774a) >>> 0;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };
}

function schedulerLookaheadSeconds() {
  return compactLayout?.matches ? 0.28 : 0.19;
}

function scheduleStep(stepIndex, stepNumber, when) {
  const step = pattern.steps[stepIndex];
  const configuration = jawJamStepConfiguration(pattern, stepIndex);
  const message = {
    type: "sequence-event",
    generation: transportGeneration,
    stepIndex,
    when,
    action: step.action,
    configuration,
  };
  if (step.action === "pluck" && configuration) {
    const strike = naturalTineStrike(
      configuration,
      {
        velocity: step.pluckIntensity,
        direction: configuration.pluckDirection,
        position: configuration.pluckPosition,
      },
      seededRandom(stepNumber * 131 + stepIndex * 17 + transportGeneration * 7),
    );
    message.strike = {
      force: strike.force,
      direction: strike.direction,
      position: strike.position,
    };
  }
  graph.sourceNode.port.postMessage(message);
  scheduledLedger.push({
    generation: transportGeneration,
    step: stepIndex,
    absoluteStep: stepNumber,
    when,
  });
}

function advanceSequenceClock() {
  nextStepTime += jawJamStepIntervalSeconds(pattern, absoluteStep);
  sequenceStep = (sequenceStep + 1) % pattern.stepCount;
  absoluteStep += 1;
}

function scheduleSequenceAhead() {
  if (!playing || !graph || audioContext?.state !== "running") return;
  const recoveryFloor = audioContext.currentTime + 0.008;
  while (nextStepTime < audioContext.currentTime - 0.025) advanceSequenceClock();
  if (nextStepTime < recoveryFloor) nextStepTime = recoveryFloor;
  const horizon = audioContext.currentTime + schedulerLookaheadSeconds();
  while (nextStepTime < horizon) {
    scheduleStep(sequenceStep, absoluteStep, nextStepTime);
    advanceSequenceClock();
  }
}

function flushScheduledEvents({ silence = false } = {}) {
  transportGeneration += 1;
  scheduledLedger = [];
  graph?.sourceNode?.port.postMessage({
    type: "drop-scheduled",
    generation: transportGeneration,
    silence,
  });
  if (silence) graph?.sourceNode?.port.postMessage({ type: "silence" });
}

async function startSequence({ restart = false } = {}) {
  if (!(await ensureAudio())) return;
  if (playing && !restart) return;
  flushScheduledEvents({ silence: restart });
  sequenceStep = 0;
  absoluteStep = 0;
  visibleStep = -1;
  nextStepTime = audioContext.currentTime + 0.072;
  clockOriginTime = nextStepTime;
  breathVisualPhase = 0;
  breathVisualTime = audioContext.currentTime;
  graph.sourceNode.port.postMessage({ type: "breath-cycle-reset", phase: 0 });
  playing = true;
  updateTransportPresentation();
  setVisibleStep(-1);
  clearInterval(schedulerTimer);
  scheduleSequenceAhead();
  schedulerTimer = setInterval(scheduleSequenceAhead, SCHEDULER_INTERVAL_MS);
  announce("Jaw Jam sequence playing");
}

function stopSequence({ silence = true, announceState = true } = {}) {
  if (!playing && !schedulerTimer && !silence) return;
  playing = false;
  clearInterval(schedulerTimer);
  schedulerTimer = 0;
  flushScheduledEvents({ silence });
  setVisibleStep(-1);
  updateTransportPresentation();
  if (announceState) announce("Jaw Jam sequence stopped");
}

function restartSequence() {
  if (playing) void startSequence({ restart: true });
  else {
    sequenceStep = 0;
    absoluteStep = 0;
    setVisibleStep(-1);
    announce("Sequence returned to step one");
  }
}

function toggleSequence() {
  if (playing) stopSequence();
  else void startSequence({ restart: true });
}

function rescheduleFuture() {
  if (!playing || !graph || !audioContext) return;
  const now = audioContext.currentTime;
  const boundary = scheduledLedger.find((event) => event.when > now + 0.024);
  const fallbackStep = visibleStep >= 0 ? (visibleStep + 1) % pattern.stepCount : 0;
  const fallbackAbsolute = Math.max(0, absoluteStep - scheduledLedger.length);
  flushScheduledEvents({ silence: false });
  sequenceStep = boundary?.step ?? fallbackStep;
  absoluteStep = boundary?.absoluteStep ?? fallbackAbsolute;
  nextStepTime = Math.max(now + 0.032, boundary?.when ?? now + jawJamStepIntervalSeconds(pattern, absoluteStep));
  scheduleSequenceAhead();
}

function updateTransportPresentation() {
  const button = $("playButton");
  if (button) button.setAttribute("aria-pressed", String(playing));
  if ($("playLabel")) $("playLabel").textContent = playing ? "Pause" : "Play";
  if ($("playState")) {
    $("playState").textContent = playing
      ? `${Math.round(pattern.tempo)} BPM \u00b7 step ${Math.max(1, visibleStep + 1)}`
      : `space \u00b7 ${pattern.stepCount} steps`;
  }
}

function setVisibleStep(index) {
  const next = Number.isInteger(index) && index >= 0 && index < pattern.stepCount ? index : -1;
  if (visibleStep >= 0) stepViews[visibleStep]?.card.classList.remove("is-current");
  visibleStep = next;
  if (visibleStep >= 0) {
    stepViews[visibleStep]?.card.classList.add("is-current");
    const activeStep = pattern.steps[visibleStep];
    if (activeStep?.action === "pluck") triggerPerformerPluck(activeStep.pluckIntensity);
  }
  updateTransportPresentation();
  updatePerformanceReadout();
}

function cloneCurrentPattern(overrides = {}) {
  return mutablePattern({
    ...pattern,
    ...overrides,
    steps: (overrides.steps ?? pattern.steps).map((step) => ({ ...step })),
  });
}

function markCustom() {
  pattern = { ...pattern, id: "custom", label: "Custom performance" };
  if ($("patternSelect")) $("patternSelect").value = "custom";
}

function replaceStep(index, patch, { rebuild = false, reschedule = true } = {}) {
  const steps = pattern.steps.map((step, stepIndex) => (
    stepIndex === index ? { ...step, ...patch } : { ...step }
  ));
  pattern = mutablePattern({ ...pattern, id: "custom", label: "Custom performance", steps });
  markCustom();
  const previousSelection = selectedStep;
  selectedStep = clamp(index, 0, pattern.stepCount - 1);
  stepViews[previousSelection]?.card.classList.remove("is-selected");
  if (stepViews[previousSelection]?.card) stepViews[previousSelection].card.tabIndex = -1;
  if (rebuild) buildSequenceLane();
  else stepViews.forEach((_, stepIndex) => paintStep(stepIndex));
  stepViews[selectedStep]?.card.classList.add("is-selected");
  if (stepViews[selectedStep]?.card) stepViews[selectedStep].card.tabIndex = 0;
  updateSelectedStepSummary();
  updateInspector();
  updateGlobalPresentation();
  if (reschedule) rescheduleFuture();
}

function soundPresetMaterialId(preset) {
  return preset?.materialPresetId ?? preset?.presetId ?? preset?.settings?.presetId ?? "khomus";
}

function soundPresetLabel(preset) {
  return preset?.label ?? preset?.id ?? "Jaw voice";
}

function soundPresetFor(id) {
  return JAW_JAM_SOUND_PRESETS.find((preset) => preset.id === id) ?? JAW_JAM_SOUND_PRESETS[0];
}

function performanceSnapshot(index) {
  if (performanceSnapshotPattern !== pattern) {
    performanceSnapshotPattern = pattern;
    performanceSnapshots = new Map();
  }
  const safeIndex = clamp(Math.round(Number(index) || 0), 0, pattern.stepCount - 1);
  if (!performanceSnapshots.has(safeIndex)) {
    const step = pattern.steps[safeIndex];
    const preset = soundPresetFor(step.soundPresetId);
    performanceSnapshots.set(safeIndex, {
      step,
      preset,
      material: jawHarpPreset(soundPresetMaterialId(preset)),
      configuration: jawJamStepConfiguration(pattern, safeIndex) ?? {},
      resolvedMidi: jawJamResolvedMidi(pattern, safeIndex),
      breathRate: jawJamBreathRateBpm(pattern, safeIndex),
    });
  }
  return performanceSnapshots.get(safeIndex);
}

function stepPitchUnit(midi) {
  const [minimum, maximum] = limitsFor("midi");
  return clamp((Number(midi) - minimum) / Math.max(1, maximum - minimum));
}

function stepControlUnit(value, key) {
  const [minimum, maximum] = limitsFor(key);
  if (key === "breathRateMultiplier" && minimum > 0 && maximum > minimum) {
    return clamp(Math.log(Math.max(minimum, Number(value)) / minimum) / Math.log(maximum / minimum));
  }
  return clamp((Number(value) - minimum) / Math.max(1e-9, maximum - minimum));
}

function resolvedPatternMidi(source, stepIndex) {
  const current = source.steps[stepIndex];
  if (!current || current.action === "rest") return null;
  if (current.action === "pluck") return current.midi;
  for (let distance = 1; distance < source.stepCount; distance += 1) {
    const candidate = source.steps[(stepIndex - distance + source.stepCount) % source.stepCount];
    if (candidate.action === "rest") return null;
    if (candidate.action === "pluck") return candidate.midi;
  }
  return null;
}

function patternBreathRate(source, stepIndex) {
  const step = source.steps[stepIndex];
  return clamp(
    Number(source.tempo) * Number(source.breathRatio) * Number(step?.breathRateMultiplier),
    ...JAW_JAM_LIMITS.breathRateBpm,
  );
}

function setOutput(id, value) {
  const output = $(id);
  if (!output) return;
  output.value = value;
  output.textContent = value;
}

function buildInspectorOptions() {
  const vowelSelect = $("stepVowel");
  if (vowelSelect) {
    vowelSelect.replaceChildren(...VOWEL_PRESETS.map((vowel) => {
      const option = document.createElement("option");
      option.value = vowel.id;
      option.textContent = `${vowel.label} ${vowel.phoneme}`;
      return option;
    }));
  }

  const soundSelect = $("stepVoice");
  if (!soundSelect) return;
  const groups = new Map();
  for (const preset of JAW_JAM_SOUND_PRESETS) {
    const materialId = soundPresetMaterialId(preset);
    if (!groups.has(materialId)) {
      const group = document.createElement("optgroup");
      group.label = jawHarpPreset(materialId).label;
      groups.set(materialId, group);
    }
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = soundPresetLabel(preset);
    groups.get(materialId).append(option);
  }
  soundSelect.replaceChildren(...groups.values());
}

function updateInspector() {
  const step = pattern.steps[selectedStep];
  if (!step) return;
  const isRest = step.action === "rest";
  const isPluck = step.action === "pluck";
  setOutput("selectedStepNumber", String(selectedStep + 1).padStart(2, "0"));
  for (const action of ACTION_ORDER) {
    const button = $(`stepAction${action[0].toUpperCase()}${action.slice(1)}`);
    button?.setAttribute("aria-pressed", String(step.action === action));
  }
  if ($("stepVowel")) {
    $("stepVowel").value = step.vowelId;
    $("stepVowel").disabled = isRest;
  }
  if ($("stepVoice")) {
    $("stepVoice").value = step.soundPresetId;
    $("stepVoice").disabled = isRest;
  }
  if ($("stepPitch")) {
    $("stepPitch").value = String(step.midi);
    $("stepPitch").disabled = !isPluck;
    $("stepPitch").setAttribute("aria-valuetext", `${noteName(step.midi)}, ${Math.round(midiFrequency(step.midi))} hertz`);
  }
  if ($("stepPull")) {
    $("stepPull").value = String(step.pluckIntensity);
    $("stepPull").disabled = !isPluck;
    $("stepPull").setAttribute("aria-valuetext", formatPercent(step.pluckIntensity));
  }
  if ($("stepAir")) {
    $("stepAir").value = String(step.breathPower);
    $("stepAir").disabled = isRest;
    $("stepAir").setAttribute("aria-valuetext", formatPercent(step.breathPower));
  }
  if ($("stepRate")) {
    $("stepRate").value = String(step.breathRateMultiplier);
    $("stepRate").disabled = isRest;
    $("stepRate").setAttribute("aria-valuetext", `${Number(step.breathRateMultiplier).toFixed(2)} times`);
  }
  setOutput("stepPitchOut", noteName(step.midi));
  setOutput("stepPullOut", formatPercent(step.pluckIntensity));
  setOutput("stepAirOut", formatPercent(step.breathPower));
  setOutput("stepRateOut", `${Number(step.breathRateMultiplier).toFixed(2)}×`);
  $("stepInspectorTitle")?.closest(".jaw-jam-step-inspector")?.classList.toggle("is-rest", isRest);
}

function setSelectedStep(index, { focus = false, updateSummary = true } = {}) {
  const next = clamp(Math.round(Number(index) || 0), 0, pattern.stepCount - 1);
  if (next !== selectedStep) {
    stepViews[selectedStep]?.card.classList.remove("is-selected");
    if (stepViews[selectedStep]?.card) stepViews[selectedStep].card.tabIndex = -1;
    selectedStep = next;
    stepViews[selectedStep]?.card.classList.add("is-selected");
    if (stepViews[selectedStep]?.card) stepViews[selectedStep].card.tabIndex = 0;
  }
  if (focus) stepViews[selectedStep]?.card.focus();
  if (updateSummary) updateSelectedStepSummary();
  updateInspector();
}

function cycleStepAction(index, requestedAction = null) {
  const step = pattern.steps[index];
  const currentIndex = ACTION_ORDER.indexOf(step.action);
  const action = JAW_JAM_ACTIONS.includes?.(requestedAction)
    ? requestedAction
    : requestedAction && ACTION_ORDER.includes(requestedAction)
      ? requestedAction
      : ACTION_ORDER[(currentIndex + 1) % ACTION_ORDER.length];
  const inherited = jawJamResolvedMidi(pattern, index);
  const patch = { action };
  if (action === "pluck" && step.action !== "pluck") {
    patch.midi = inherited
      ?? (Number.isFinite(Number(step.midi))
        ? Number(step.midi)
        : Math.round((limitsFor("midi")[0] + limitsFor("midi")[1]) * 0.5));
    // Authored holds and rests store zero pull because they do not strike.
    // Give a newly converted pluck a playable attack instead of exposing that
    // dormant zero as an effectively silent note.
    patch.pluckIntensity = Math.max(Number(step.pluckIntensity) || 0, 0.72);
  }
  replaceStep(index, patch);
  announce(`Step ${index + 1}: ${ACTION_LABELS[action]}`);
}

function compactMaterialLabel(material) {
  const words = String(material?.family ?? material?.label ?? "voice").trim().split(/\s+/);
  return words.length > 1
    ? words.map((word) => word[0]).join("").slice(0, 3).toUpperCase()
    : words[0].slice(0, 6).toUpperCase();
}

function buildStep(index) {
  const step = pattern.steps[index];
  const card = document.createElement("article");
  card.className = "jaw-jam-step";
  card.dataset.step = String(index);
  card.tabIndex = index === selectedStep ? 0 : -1;
  card.setAttribute("role", "listitem");

  const header = document.createElement("header");
  const number = document.createElement("span");
  number.className = "jaw-jam-step-number";
  number.textContent = String(index + 1).padStart(2, "0");
  const pulse = document.createElement("span");
  pulse.className = "jaw-jam-pulse-meter";
  pulse.setAttribute("role", "img");
  const flash = document.createElement("span");
  flash.className = "jaw-jam-step-flash";
  flash.setAttribute("aria-hidden", "true");
  const action = document.createElement("button");
  action.type = "button";
  action.className = "jaw-jam-step-action";
  action.addEventListener("click", () => {
    cycleStepAction(index);
    stepViews[index]?.action.focus({ preventScroll: true });
  });
  header.append(number, action, pulse, flash);

  const pitchLane = document.createElement("div");
  pitchLane.className = "jaw-jam-pitch-lane";
  pitchLane.tabIndex = 0;
  pitchLane.setAttribute("role", "slider");
  pitchLane.setAttribute("aria-orientation", "vertical");
  pitchLane.setAttribute("aria-valuemin", String(limitsFor("midi")[0]));
  pitchLane.setAttribute("aria-valuemax", String(limitsFor("midi")[1]));
  const pitchTop = document.createElement("span");
  pitchTop.className = "jaw-jam-pitch-limit is-high";
  pitchTop.textContent = noteName(limitsFor("midi")[1]);
  const pitchBottom = document.createElement("span");
  pitchBottom.className = "jaw-jam-pitch-limit is-low";
  pitchBottom.textContent = noteName(limitsFor("midi")[0]);
  const block = document.createElement("span");
  block.className = "jaw-jam-note-block";
  const blockPull = document.createElement("i");
  blockPull.className = "jaw-jam-note-pull";
  blockPull.setAttribute("aria-hidden", "true");
  const blockAir = document.createElement("i");
  blockAir.className = "jaw-jam-note-air";
  blockAir.setAttribute("aria-hidden", "true");
  const blockLabel = document.createElement("b");
  const blockMeta = document.createElement("small");
  block.append(blockPull, blockAir, blockLabel, blockMeta);
  pitchLane.append(pitchTop, pitchBottom, block);
  pitchLane.addEventListener("keydown", (event) => {
    if (pattern.steps[index].action !== "pluck") return;
    const [minimum, maximum] = limitsFor("midi");
    let midi = Number(pattern.steps[index].midi);
    if (event.key === "ArrowUp") midi += event.shiftKey ? 12 : 1;
    else if (event.key === "ArrowDown") midi -= event.shiftKey ? 12 : 1;
    else if (event.key === "Home") midi = minimum;
    else if (event.key === "End") midi = maximum;
    else return;
    event.preventDefault();
    replaceStep(index, { midi: clamp(midi, minimum, maximum) });
  });

  const summary = document.createElement("footer");
  summary.className = "jaw-jam-step-summary";
  const vowelBadge = document.createElement("b");
  vowelBadge.className = "jaw-jam-step-vowel";
  const materialBadge = document.createElement("span");
  materialBadge.className = "jaw-jam-step-material";
  const parameterBars = document.createElement("span");
  parameterBars.className = "jaw-jam-step-parameter-bars";
  parameterBars.setAttribute("aria-hidden", "true");
  for (const parameter of ["pull", "air", "rate"]) {
    const bar = document.createElement("i");
    bar.className = `is-${parameter}`;
    parameterBars.append(bar);
  }
  summary.append(vowelBadge, materialBadge, parameterBars);
  card.append(header, pitchLane, summary);
  card.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".jaw-jam-pitch-lane")) setSelectedStep(index);
  });
  card.addEventListener("focus", () => setSelectedStep(index));
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      setSelectedStep((index + offset + pattern.stepCount) % pattern.stepCount, { focus: true });
    } else if (["p", "s", "x"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const requested = { p: "pluck", s: "sustain", x: "rest" }[event.key.toLowerCase()];
      cycleStepAction(index, requested);
      stepViews[index]?.card.focus({ preventScroll: true });
    }
  });
  return {
    card,
    number,
    pulse,
    action,
    pitchLane,
    block,
    blockLabel,
    blockMeta,
    vowelBadge,
    materialBadge,
  };
}

function paintStep(index) {
  const view = stepViews[index];
  const step = pattern.steps[index];
  if (!view || !step) return;
  const resolvedMidi = resolvedPatternMidi(pattern, index);
  const preset = soundPresetFor(step.soundPresetId);
  const material = jawHarpPreset(soundPresetMaterialId(preset));
  const action = step.action;
  view.card.classList.toggle("is-pluck", action === "pluck");
  view.card.classList.toggle("is-sustain", action === "sustain");
  view.card.classList.toggle("is-rest", action === "rest");
  view.card.classList.toggle("is-current", index === visibleStep);
  view.card.classList.toggle("is-selected", index === selectedStep);
  view.action.textContent = ACTION_LABELS[action];
  view.action.setAttribute("aria-label", `Step ${index + 1} action ${ACTION_LABELS[action]}; activate to cycle pluck, hold, and rest`);
  view.pitchLane.setAttribute("aria-disabled", String(action !== "pluck"));
  view.pitchLane.tabIndex = action === "pluck" ? 0 : -1;
  view.pitchLane.setAttribute("aria-label", action === "pluck"
    ? `Step ${index + 1} pitch ${noteName(step.midi)}. Drag vertically or use arrow keys.`
    : action === "sustain"
      ? `Step ${index + 1} sustains ${noteName(resolvedMidi)} without a new pluck`
      : `Step ${index + 1} hard rest`);
  view.pitchLane.setAttribute("aria-valuenow", String(resolvedMidi ?? step.midi));
  view.pitchLane.setAttribute("aria-valuetext", resolvedMidi === null
    ? "no inherited pitch"
    : `${noteName(resolvedMidi)}, ${Math.round(midiFrequency(resolvedMidi))} hertz`);
  const pitchUnit = stepPitchUnit(resolvedMidi ?? step.midi);
  view.card.style.setProperty("--pitch-position", `${((1 - pitchUnit) * 100).toFixed(2)}%`);
  const pullUnit = action === "pluck" ? stepControlUnit(step.pluckIntensity, "pluckIntensity") : 0;
  const airUnit = action === "rest" ? 0 : stepControlUnit(step.breathPower, "breathPower");
  const rateUnit = action === "rest" ? 0 : stepControlUnit(step.breathRateMultiplier, "breathRateMultiplier");
  const pulseEnergy = action === "rest" ? 0 : jawJamPulseEnergy(step);
  const breathRate = action === "rest" ? 0 : patternBreathRate(pattern, index);
  view.card.style.setProperty("--pull-level", pullUnit.toFixed(4));
  view.card.style.setProperty("--air-level", airUnit.toFixed(4));
  view.card.style.setProperty("--breath-rate-level", rateUnit.toFixed(4));
  view.card.style.setProperty("--pulse-energy", clamp(pulseEnergy).toFixed(4));
  view.card.style.setProperty("--breath-visual-duration", `${clamp(60 / Math.max(1, breathRate), 0.08, 3).toFixed(3)}s`);
  view.card.style.setProperty("--material-hue", String((JAW_HARP_PRESETS.findIndex(({ id }) => id === material.id) * 53 + 26) % 360));
  view.blockLabel.textContent = action === "rest" ? "X" : action === "sustain" ? "HOLD" : noteName(step.midi);
  view.blockMeta.textContent = action === "rest"
    ? "HARD STOP"
    : resolvedMidi === null
      ? "NO SOURCE"
      : `${noteName(resolvedMidi)} \u00b7 ${Math.round(midiFrequency(resolvedMidi))} HZ`;
  view.pulse.setAttribute(
    "aria-label",
    action === "rest"
      ? "No pulse: hard rest"
      : `Pulse: ${formatPercent(action === "pluck" ? step.pluckIntensity : 0)} tine pull plus ${formatPercent(step.breathPower)} breath strength; ${formatPercent(pulseEnergy)} combined`,
  );
  view.pulse.title = view.pulse.getAttribute("aria-label");
  view.vowelBadge.textContent = action === "rest" ? "—" : `/${step.vowelId}/`;
  view.materialBadge.textContent = action === "rest" ? "CHOKE" : compactMaterialLabel(material);
  view.materialBadge.title = action === "rest" ? "Hard rest" : `${material.label} · ${soundPresetLabel(preset)}`;
  view.card.setAttribute(
    "aria-label",
    `Step ${index + 1}, ${ACTION_LABELS[action]}, ${resolvedMidi === null ? "no pitch" : noteName(resolvedMidi)}, ${material.label}, vowel ${step.vowelId.toUpperCase()}`,
  );
}

function capturePaintGeometry() {
  const scroller = $("sequenceScroller");
  const pitchLane = stepViews[0]?.pitchLane;
  if (!scroller || !pitchLane || !stepViews.length) return null;
  const scrollLeft = scroller.scrollLeft;
  const scrollerRect = scroller.getBoundingClientRect();
  const centers = stepViews.map(({ card }) => {
    const rect = card.getBoundingClientRect();
    return rect.left + scrollLeft + rect.width * 0.5;
  });
  const pitchRect = pitchLane.getBoundingClientRect();
  return {
    scroller,
    scrollerRect,
    centers,
    firstCenter: centers[0],
    stride: centers.length > 1 ? centers[1] - centers[0] : 1,
    pitchTop: pitchRect.top,
    pitchHeight: pitchRect.height,
  };
}

function paintIndexFromClientX(clientX, gesture) {
  const geometry = gesture?.geometry;
  if (!geometry) return 0;
  const contentX = clientX + geometry.scroller.scrollLeft;
  return clamp(
    Math.round((contentX - geometry.firstCenter) / Math.max(1, geometry.stride)),
    0,
    geometry.centers.length - 1,
  );
}

function paintUnitFromClientY(clientY, gesture) {
  const geometry = gesture?.geometry;
  if (!geometry) return 0.5;
  const inset = Math.min(4, geometry.pitchHeight * 0.04);
  return clamp(1 - (clientY - geometry.pitchTop - inset) / Math.max(1, geometry.pitchHeight - inset * 2));
}

function paintPatchFor(index, unit, gesture) {
  const step = pattern.steps[index];
  if (!step) return null;
  if (gesture.mode === "pitch") {
    const [minimum, maximum] = limitsFor("midi");
    return {
      action: "pluck",
      midi: Math.round(minimum + unit * (maximum - minimum)),
      pluckIntensity: Math.max(Number(step.pluckIntensity) || 0, 0.72),
    };
  }
  if (gesture.mode === "pull") {
    if (step.action !== "pluck") return null;
    const [minimum, maximum] = limitsFor("pluckIntensity");
    return { pluckIntensity: minimum + unit * (maximum - minimum) };
  }
  if (gesture.mode === "air") {
    if (step.action === "rest") return null;
    const [minimum, maximum] = limitsFor("breathPower");
    return { breathPower: minimum + unit * (maximum - minimum) };
  }
  if (gesture.mode === "rate") {
    if (step.action === "rest") return null;
    const [minimum, maximum] = limitsFor("breathRateMultiplier");
    const raw = minimum * ((maximum / minimum) ** unit);
    return { breathRateMultiplier: Math.round(raw * 200) / 200 };
  }
  if (gesture.mode === "vowel") {
    return step.action === "rest" ? null : { vowelId: gesture.vowelId };
  }
  if (gesture.mode === "voice") {
    return step.action === "rest" ? null : { soundPresetId: gesture.soundPresetId };
  }
  if (gesture.mode === "sustain") return { action: "sustain" };
  if (gesture.mode === "rest") return { action: "rest" };
  return null;
}

function applyPaintPatch(index, unit, gesture) {
  const patch = paintPatchFor(index, unit, gesture);
  if (!patch) return;
  const current = pattern.steps[index];
  if (!Object.entries(patch).some(([key, value]) => current[key] !== value)) return;
  const steps = pattern.steps.slice();
  steps[index] = { ...current, ...patch };
  pattern = { ...pattern, id: "custom", label: "Custom performance", steps };
  if ($("patternSelect")) $("patternSelect").value = "custom";
  gesture.changed = true;
  gesture.touched.add(index);
  gesture.dirty.add(index);
  stepViews[index]?.card.classList.add("is-painted");
}

function flushPaintVisuals(gesture) {
  if (!gesture?.dirty?.size) return;
  const dirty = [...gesture.dirty];
  gesture.dirty.clear();
  for (const index of dirty) paintStep(index);
}

function maybeAutoScrollPaint(clientX, gesture) {
  const geometry = gesture?.geometry;
  const scroller = geometry?.scroller;
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  const rect = geometry.scrollerRect;
  const edge = Math.min(34, rect.width * 0.12);
  if (clientX < rect.left + edge) scroller.scrollLeft -= 14;
  else if (clientX > rect.right - edge) scroller.scrollLeft += 14;
}

function paintSequenceSample(event) {
  if (!paintGesture || event.pointerId !== paintGesture.pointerId) return;
  maybeAutoScrollPaint(event.clientX, paintGesture);
  const index = paintIndexFromClientX(event.clientX, paintGesture);
  const unit = paintUnitFromClientY(event.clientY, paintGesture);
  if (paintGesture.lastIndex === null) {
    applyPaintPatch(index, unit, paintGesture);
  } else if (index === paintGesture.lastIndex) {
    applyPaintPatch(index, unit, paintGesture);
  } else {
    const distance = Math.abs(index - paintGesture.lastIndex);
    const direction = Math.sign(index - paintGesture.lastIndex);
    for (let offset = 1; offset <= distance; offset += 1) {
      const amount = offset / distance;
      const crossedIndex = paintGesture.lastIndex + direction * offset;
      const crossedUnit = paintGesture.lastUnit + (unit - paintGesture.lastUnit) * amount;
      applyPaintPatch(crossedIndex, crossedUnit, paintGesture);
    }
  }
  paintGesture.lastIndex = index;
  paintGesture.lastUnit = unit;
}

function finishSequencePaint(event, { release = true } = {}) {
  const lane = $("sequenceLane");
  if (!paintGesture || (event && event.pointerId !== paintGesture.pointerId)) return;
  const finished = paintGesture;
  paintGesture = null;
  lane?.classList.remove("is-painting");
  if (release && event && lane?.hasPointerCapture?.(event.pointerId)) lane.releasePointerCapture(event.pointerId);
  for (const index of finished.touched) stepViews[index]?.card.classList.remove("is-painted");
  if (!finished.changed) {
    updateSelectedStepSummary();
    updateInspector();
    return;
  }
  pattern = mutablePattern(pattern);
  pattern.id = "custom";
  pattern.label = "Custom performance";
  stepViews.forEach((_, index) => paintStep(index));
  updateSelectedStepSummary();
  updateInspector();
  updateGlobalPresentation();
  rescheduleFuture();
  announce(`${PAINT_HINTS[finished.mode].split(".")[0]} across ${finished.touched.size} step${finished.touched.size === 1 ? "" : "s"}`);
}

function installSequencePainting() {
  const lane = $("sequenceLane");
  if (!lane) return;
  lane.addEventListener("pointerdown", (event) => {
    if (
      interactionMode !== "draw"
      || paintGesture
      || event.isPrimary === false
      || event.button !== 0
      || !event.target.closest?.(".jaw-jam-pitch-lane")
    ) return;
    const geometry = capturePaintGeometry();
    if (!geometry) return;
    event.preventDefault();
    const mode = event.shiftKey ? "rest" : event.altKey ? "sustain" : paintMode;
    paintGesture = {
      pointerId: event.pointerId,
      mode,
      vowelId: $("stepVowel")?.value ?? pattern.steps[selectedStep].vowelId,
      soundPresetId: $("stepVoice")?.value ?? pattern.steps[selectedStep].soundPresetId,
      lastIndex: null,
      lastUnit: 0.5,
      touched: new Set(),
      dirty: new Set(),
      changed: false,
      geometry,
    };
    lane.classList.add("is-painting");
    lane.setPointerCapture?.(event.pointerId);
    paintSequenceSample(event);
    flushPaintVisuals(paintGesture);
    setSelectedStep(paintGesture.lastIndex, { updateSummary: false });
  });
  lane.addEventListener("pointermove", (event) => {
    if (!paintGesture || event.pointerId !== paintGesture.pointerId) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [event]) paintSequenceSample(sample);
    flushPaintVisuals(paintGesture);
    setSelectedStep(paintGesture.lastIndex, { updateSummary: false });
  });
  lane.addEventListener("pointerup", (event) => {
    if (!paintGesture || event.pointerId !== paintGesture.pointerId) return;
    event.preventDefault();
    paintSequenceSample(event);
    setSelectedStep(paintGesture.lastIndex, { updateSummary: false });
    finishSequencePaint(event);
  });
  lane.addEventListener("pointercancel", (event) => finishSequencePaint(event));
  lane.addEventListener("lostpointercapture", (event) => finishSequencePaint(event, { release: false }));
}

function setInteractionMode(mode) {
  interactionMode = mode === "scroll" ? "scroll" : "draw";
  $("sequenceLane")?.classList.toggle("is-scroll-mode", interactionMode === "scroll");
  $("drawModeButton")?.setAttribute("aria-pressed", String(interactionMode === "draw"));
  $("scrollModeButton")?.setAttribute("aria-pressed", String(interactionMode === "scroll"));
  if ($("paintHint")) {
    $("paintHint").textContent = interactionMode === "scroll"
      ? "Drag the score sideways with one finger. Choose Draw when you are ready to write across steps."
      : PAINT_HINTS[paintMode];
  }
}

function setPaintMode(mode) {
  if (!PAINT_MODES.includes(mode)) return;
  paintMode = mode;
  for (const button of document.querySelectorAll("[data-paint-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.paintMode === paintMode));
  }
  setInteractionMode("draw");
}

function buildSequenceLane() {
  const lane = $("sequenceLane");
  if (!lane) return;
  selectedStep = clamp(selectedStep, 0, pattern.stepCount - 1);
  stepViews = pattern.steps.map((_, index) => buildStep(index));
  lane.style.setProperty("--jaw-jam-step-count", String(pattern.stepCount));
  lane.setAttribute("aria-label", `${pattern.stepCount}-step monophonic Jaw Jam sequence`);
  lane.replaceChildren(...stepViews.map(({ card }) => card));
  stepViews.forEach((_, index) => paintStep(index));
  updateSelectedStepSummary();
  updateInspector();
}

function updateSelectedStepSummary() {
  const target = $("selectedStepSummary");
  if (!target) return;
  const step = pattern.steps[selectedStep];
  const resolvedMidi = jawJamResolvedMidi(pattern, selectedStep);
  const preset = soundPresetFor(step.soundPresetId);
  const material = jawHarpPreset(soundPresetMaterialId(preset));
  const pitch = resolvedMidi === null ? "no sounding source" : `${noteName(resolvedMidi)} \u00b7 ${Math.round(midiFrequency(resolvedMidi))} Hz`;
  const pulse = jawJamPulseEnergy(step);
  const articulation = step.action === "rest"
    ? "pulse off"
    : `pull ${formatPercent(step.action === "pluck" ? step.pluckIntensity : 0)} + air ${formatPercent(step.breathPower)} = pulse ${formatPercent(pulse)}`;
  target.textContent = `Step ${String(selectedStep + 1).padStart(2, "0")} \u00b7 ${ACTION_LABELS[step.action]} \u00b7 ${pitch} \u00b7 ${material.label} / ${soundPresetLabel(preset)} \u00b7 ${step.vowelId.toUpperCase()} \u00b7 ${articulation}`;
}

function updatePerformanceReadout() {
  const target = $("performanceReadout");
  if (!target) return;
  const index = visibleStep >= 0 ? visibleStep : selectedStep;
  const { step, material, resolvedMidi: midi } = performanceSnapshot(index);
  target.textContent = visibleStep >= 0
    ? `${ACTION_LABELS[step.action]} ${String(index + 1).padStart(2, "0")} \u00b7 ${midi === null ? "silence" : noteName(midi)} \u00b7 ${material.family} \u00b7 /${step.vowelId}/`
    : `READY \u00b7 ${pattern.stepCount} STEPS \u00b7 ${JAW_JAM_SOUND_PRESETS.length} VOICES`;
}

function updateGlobalPresentation() {
  if ($("tempo")) $("tempo").value = String(pattern.tempo);
  if ($("tempoOut")) $("tempoOut").textContent = `${Math.round(pattern.tempo)} BPM`;
  if ($("swing")) $("swing").value = String(pattern.swing);
  if ($("swingOut")) $("swingOut").textContent = formatSignedPercent(pattern.swing);
  if ($("sequenceLength")) $("sequenceLength").value = String(pattern.stepCount);
  if ($("sequenceLengthOut")) $("sequenceLengthOut").textContent = `${pattern.stepCount} steps`;
  if ($("breathRatio")) $("breathRatio").value = String(pattern.breathRatio);
  if ($("breathRatioOut")) $("breathRatioOut").textContent = ratioLabel(pattern.breathRatio);
  if ($("level")) $("level").value = String(outputLevel);
  if ($("levelOut")) $("levelOut").textContent = formatPercent(outputLevel);
  updateTransportPresentation();
  updatePerformanceReadout();
}

function buildPatternOptions() {
  const select = $("patternSelect");
  if (!select) return;
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom performance";
  select.replaceChildren(...JAW_JAM_PATTERNS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }), custom);
  select.value = pattern.id;
}

function buildBreathRatioOptions() {
  const select = $("breathRatio");
  if (!select) return;
  select.replaceChildren(...JAW_JAM_BREATH_RATIOS.map((entry) => {
    const value = ratioValue(entry);
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = entry?.label ?? ratioLabel(value);
    return option;
  }));
  select.value = String(pattern.breathRatio);
}

function loadPattern(id) {
  const source = jawJamPattern(id);
  pattern = mutablePattern(source);
  selectedStep = 0;
  visibleStep = -1;
  buildSequenceLane();
  updateGlobalPresentation();
  rescheduleFuture();
  announce(`${source.label} loaded`);
}

function resizePattern(length) {
  const [minimum, maximum] = limitsFor("stepCount");
  const nextLength = clamp(Math.round(Number(length) || pattern.stepCount), minimum, maximum);
  const fallback = initialPattern.steps[0] ?? pattern.steps[0];
  const steps = Array.from({ length: nextLength }, (_, index) => ({
    ...(pattern.steps[index] ?? fallback),
    ...(index >= pattern.steps.length ? { action: "rest" } : {}),
  }));
  pattern = mutablePattern({
    ...pattern,
    id: "custom",
    label: "Custom performance",
    stepCount: nextLength,
    steps,
  });
  selectedStep = clamp(selectedStep, 0, nextLength - 1);
  buildSequenceLane();
  updateGlobalPresentation();
  rescheduleFuture();
  announce(`Sequence length ${nextLength} steps`);
}

function clearPattern() {
  pattern = mutablePattern({
    ...pattern,
    id: "custom",
    label: "Custom performance",
    steps: pattern.steps.map((step) => ({ ...step, action: "rest" })),
  });
  buildSequenceLane();
  updateGlobalPresentation();
  rescheduleFuture();
  announce("All steps changed to hard rests");
}

function randomizePattern() {
  pattern = mutablePattern(randomizeJawJamPattern(pattern, Math.random));
  pattern.id = "custom";
  pattern.label = "Custom performance";
  buildSequenceLane();
  updateGlobalPresentation();
  rescheduleFuture();
  announce("Virtuosic Jaw Jam pattern randomized");
}

function mutatePattern() {
  const steps = pattern.steps.map((step, index) => {
    if (Math.random() > 0.34) return { ...step };
    const next = { ...step };
    const choice = Math.floor(Math.random() * 7);
    if (choice === 0) next.midi = clamp(next.midi + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.25 ? 12 : 1), ...limitsFor("midi"));
    if (choice === 1) next.vowelId = VOWEL_PRESETS[Math.floor(Math.random() * VOWEL_PRESETS.length)].id;
    if (choice === 2) next.soundPresetId = JAW_JAM_SOUND_PRESETS[Math.floor(Math.random() * JAW_JAM_SOUND_PRESETS.length)].id;
    if (choice === 3) next.pluckIntensity = clamp(next.pluckIntensity + (Math.random() - 0.5) * 0.32, ...limitsFor("pluckIntensity"));
    if (choice === 4) next.breathPower = clamp(next.breathPower + (Math.random() - 0.5) * 0.9, ...limitsFor("breathPower"));
    if (choice === 5) next.breathRateMultiplier = clamp(next.breathRateMultiplier * (Math.random() < 0.5 ? 0.75 : 1.333), ...limitsFor("breathRateMultiplier"));
    if (choice === 6 && index > 0) next.action = Math.random() < 0.52 ? "sustain" : Math.random() < 0.7 ? "pluck" : "rest";
    return next;
  });
  if (!steps.some(({ action }) => action === "pluck")) steps[0] = { ...steps[0], action: "pluck" };
  pattern = mutablePattern({ ...pattern, id: "custom", label: "Custom performance", steps });
  buildSequenceLane();
  updateGlobalPresentation();
  rescheduleFuture();
  announce("Pattern mutated without changing its clock");
}

async function auditionSelectedStep() {
  if (!(await ensureAudio())) return;
  const step = pattern.steps[selectedStep];
  let configuration = jawJamStepConfiguration(pattern, selectedStep);
  const action = step.action === "rest" ? "rest" : "pluck";
  if (!configuration && step.action === "sustain") {
    // An orphaned sustain has no live sequence source, but its editor card is
    // still a complete timbre worth auditioning. Resolve that one preview as
    // a pluck at its stored pitch without changing the programmed action.
    const previewSteps = pattern.steps.map((candidate, index) => (
      index === selectedStep
        ? { ...candidate, action: "pluck", pluckIntensity: 0.78 }
        : candidate
    ));
    configuration = jawJamStepConfiguration({ ...pattern, steps: previewSteps }, selectedStep);
  }
  if (configuration && step.action === "sustain") {
    // Programmed sustains correctly carry zero pull. A one-shot audition needs
    // a representative pull from that selected physical body or it is nearly
    // silent and fails to reveal the sustain's material/vowel combination.
    configuration = {
      ...configuration,
      pluckForce: Math.max(
        configuration.pluckForce,
        jawHarpPreset(configuration.presetId).settings.pluckForce,
      ),
    };
  }
  const message = {
    type: "sequence-event",
    generation: transportGeneration,
    stepIndex: selectedStep,
    when: audioContext.currentTime + 0.018,
    action,
    configuration,
  };
  if (action === "pluck" && configuration) {
    const strike = naturalTineStrike(
      configuration,
      { velocity: step.action === "pluck" ? step.pluckIntensity : 0.78 },
      seededRandom(selectedStep * 97 + performance.now()),
    );
    message.strike = {
      force: strike.force,
      direction: strike.direction,
      position: strike.position,
    };
  }
  graph.sourceNode.port.postMessage(message);
  if (action === "pluck") triggerPerformerPluck(step.action === "pluck" ? step.pluckIntensity : 0.78);
  announce(step.action === "rest" ? `Step ${selectedStep + 1} stopped the reed` : `Auditioning step ${selectedStep + 1}`);
}

function panic() {
  stopSequence({ silence: true, announceState: false });
  graph?.sourceNode?.port.postMessage({ type: "panic", generation: ++transportGeneration });
  announce("Jaw Jam stopped and cleared");
}

function installInspectorRange(id, key, formatter) {
  const input = $(id);
  if (!input) return;
  const [minimum, maximum] = limitsFor(key);
  input.min = String(minimum);
  input.max = String(maximum);
  input.addEventListener("input", () => {
    replaceStep(selectedStep, { [key]: Number(input.value) }, { reschedule: false });
  });
  input.addEventListener("change", () => {
    rescheduleFuture();
    announce(`Step ${selectedStep + 1} ${formatter(Number(input.value))}`);
  });
}

function installControls() {
  $("audioButton")?.addEventListener("click", toggleAudio);
  $("playButton")?.addEventListener("click", toggleSequence);
  $("restartButton")?.addEventListener("click", restartSequence);
  $("auditionButton")?.addEventListener("click", () => { void auditionSelectedStep(); });
  $("panicButton")?.addEventListener("click", panic);
  $("clearPatternButton")?.addEventListener("click", clearPattern);
  $("randomPatternButton")?.addEventListener("click", randomizePattern);
  $("mutatePatternButton")?.addEventListener("click", mutatePattern);
  for (const button of document.querySelectorAll("[data-paint-mode]")) {
    button.addEventListener("click", () => setPaintMode(button.dataset.paintMode));
  }
  $("drawModeButton")?.addEventListener("click", () => setInteractionMode("draw"));
  $("scrollModeButton")?.addEventListener("click", () => setInteractionMode("scroll"));
  for (const action of ACTION_ORDER) {
    const button = $(`stepAction${action[0].toUpperCase()}${action.slice(1)}`);
    button?.addEventListener("click", () => cycleStepAction(selectedStep, action));
  }
  $("stepVowel")?.addEventListener("change", (event) => {
    replaceStep(selectedStep, { vowelId: event.currentTarget.value });
    announce(`Step ${selectedStep + 1} vowel ${event.currentTarget.selectedOptions[0]?.textContent ?? event.currentTarget.value}`);
  });
  $("stepVoice")?.addEventListener("change", (event) => {
    const preset = soundPresetFor(event.currentTarget.value);
    replaceStep(selectedStep, { soundPresetId: preset.id });
    announce(`Step ${selectedStep + 1} voice ${soundPresetLabel(preset)}`);
  });
  installInspectorRange("stepPitch", "midi", (value) => `pitch ${noteName(value)}`);
  installInspectorRange("stepPull", "pluckIntensity", (value) => `tine pull ${formatPercent(value)}`);
  installInspectorRange("stepAir", "breathPower", (value) => `air ${formatPercent(value)}`);
  installInspectorRange("stepRate", "breathRateMultiplier", (value) => `breath rate ${value.toFixed(2)} times`);
  $("patternSelect")?.addEventListener("change", (event) => {
    if (event.currentTarget.value !== "custom") loadPattern(event.currentTarget.value);
  });
  $("sequenceLength")?.addEventListener("input", (event) => {
    if ($("sequenceLengthOut")) $("sequenceLengthOut").textContent = `${Math.round(Number(event.currentTarget.value))} steps`;
  });
  $("sequenceLength")?.addEventListener("change", (event) => resizePattern(event.currentTarget.value));
  $("tempo")?.addEventListener("input", (event) => {
    pattern = cloneCurrentPattern({ tempo: Number(event.currentTarget.value), id: "custom", label: "Custom performance" });
    markCustom();
    updateGlobalPresentation();
  });
  $("tempo")?.addEventListener("change", () => {
    rescheduleFuture();
    announce(`Pluck clock ${Math.round(pattern.tempo)} BPM`);
  });
  $("swing")?.addEventListener("input", (event) => {
    pattern = cloneCurrentPattern({ swing: Number(event.currentTarget.value), id: "custom", label: "Custom performance" });
    markCustom();
    updateGlobalPresentation();
  });
  $("swing")?.addEventListener("change", () => {
    rescheduleFuture();
    announce(`Pluck swing ${formatSignedPercent(pattern.swing)}`);
  });
  $("breathRatio")?.addEventListener("change", (event) => {
    pattern = cloneCurrentPattern({ breathRatio: Number(event.currentTarget.value), id: "custom", label: "Custom performance" });
    markCustom();
    updateGlobalPresentation();
    rescheduleFuture();
    announce(`Breath clock ${ratioLabel(pattern.breathRatio)}`);
  });
  $("level")?.addEventListener("input", (event) => {
    outputLevel = clamp(Number(event.currentTarget.value), ...JAW_HARP_LIMITS.level);
    if ($("levelOut")) $("levelOut").textContent = formatPercent(outputLevel);
    graph?.masterGain?.gain.setTargetAtTime(outputLevel, audioContext.currentTime, 0.012);
  });
}

function handleMidiInput(event) {
  const { message, routeId, source } = event.detail ?? {};
  if (!message || (routeId && routeId !== "jaw-jam")) return;
  if (source === "wax" && document.documentElement.dataset.morphazoidWaxOutputMode === "midi") return;
  const noteOn = message.type === "noteOn" && Number(message.velocity) > 0;
  const noteOff = message.type === "noteOff" || (message.type === "noteOn" && Number(message.velocity) <= 0);
  if (!noteOn && !noteOff) return;
  event.preventDefault();
  if (noteOff) return;
  const [minimum, maximum] = limitsFor("midi");
  const midi = clamp(Math.round(Number(message.note) || 48), minimum, maximum);
  const velocity = clamp((Number(message.velocity) || 1) / 127, ...limitsFor("pluckIntensity"));
  replaceStep(selectedStep, { action: "pluck", midi, pluckIntensity: velocity });
  void auditionSelectedStep();
}

function installKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleSequence();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void auditionSelectedStep();
    }
  });
}

function updateClocks(time) {
  const audioTime = audioContext?.state === "running" ? audioContext.currentTime : time / 1000;
  const stepSeconds = 60 / Math.max(1, pattern.tempo);
  const pluckPhase = playing
    ? ((audioTime - clockOriginTime) / stepSeconds % 1 + 1) % 1
    : 0;
  const activeIndex = visibleStep >= 0 ? visibleStep : selectedStep;
  const snapshot = performanceSnapshot(activeIndex);
  const breathRate = snapshot.breathRate;
  if (!breathVisualTime) breathVisualTime = audioTime;
  const elapsed = clamp(audioTime - breathVisualTime, 0, 0.1);
  breathVisualTime = audioTime;
  if (playing) breathVisualPhase = (breathVisualPhase + elapsed * breathRate / 60) % 1;
  const pluckTurn = pluckPhase * 360;
  const breathTurn = breathVisualPhase * 360;
  if ($("pluckClockHand")) $("pluckClockHand").style.transform = `rotate(${pluckTurn}deg)`;
  if ($("breathClockHand")) $("breathClockHand").style.transform = `rotate(${breathTurn}deg)`;
  $("pluckClock")?.style.setProperty("--clock-phase", pluckPhase.toFixed(4));
  $("breathClock")?.style.setProperty("--clock-phase", breathVisualPhase.toFixed(4));
  const breathBalance = snapshot.configuration?.breathBalance ?? 0.5;
  const direction = breathVisualPhase < breathBalance ? "inhale" : "exhale";
  const nextClockSignature = `${Math.round(pattern.tempo)}:${pattern.breathRatio}:${direction}:${Math.round(breathRate)}`;
  if (nextClockSignature !== clockReadoutSignature) {
    clockReadoutSignature = nextClockSignature;
    if ($("pluckClockReadout")) $("pluckClockReadout").textContent = `${Math.round(pattern.tempo)} BPM`;
    if ($("breathClockReadout")) {
      $("breathClockReadout").textContent = `${ratioLabel(pattern.breathRatio)} \u00b7 ${direction} \u00b7 ${Math.round(breathRate)} cycles/min`;
    }
  }
}

function updateTelemetryReadouts() {
  if ($("telemetryEnergy")) $("telemetryEnergy").textContent = `${Math.round(clamp(telemetry.energy / 2) * 100)}%`;
  if ($("telemetryBreath")) {
    const flow = Number(telemetry.breathFlow) || 0;
    $("telemetryBreath").textContent = Math.abs(flow) < 0.01
      ? "turn"
      : `${flow < 0 ? "inhale" : "exhale"} ${Math.round(Math.abs(flow) * 100)}%`;
  }
  const index = visibleStep >= 0 ? visibleStep : selectedStep;
  const { step, material, resolvedMidi: midi } = performanceSnapshot(index);
  if ($("telemetryMaterial")) $("telemetryMaterial").textContent = material.family;
  if ($("telemetryVowel")) $("telemetryVowel").textContent = `/${step.vowelId}/`;
  if ($("telemetryPitch")) $("telemetryPitch").textContent = midi === null ? "\u2014" : `${noteName(midi)} \u00b7 ${Math.round(midiFrequency(midi))} Hz`;
}

function flushVisualLedger() {
  if (!playing || !audioContext) return;
  const now = audioContext.currentTime;
  let latest = null;
  while (scheduledLedger.length && scheduledLedger[0].when <= now + 0.004) {
    const candidate = scheduledLedger.shift();
    if (candidate.generation === transportGeneration) latest = candidate;
  }
  if (latest) setVisibleStep(latest.step);
}

function tick(time) {
  flushVisualLedger();
  updateClocks(time);
  drawPerformerStage(time);
  if (time - lastReadoutAt > 80) {
    lastReadoutAt = time;
    updateTelemetryReadouts();
  }
  animationFrame = requestAnimationFrame(tick);
}

buildPatternOptions();
buildBreathRatioOptions();
buildInspectorOptions();
buildSequenceLane();
updateGlobalPresentation();
installControls();
installSequencePainting();
setPaintMode("pitch");
installKeyboard();
setAudioPresentation("off");
globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
animationFrame = requestAnimationFrame(tick);

globalThis.addEventListener("blur", () => {
  if (playing) scheduleSequenceAhead();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) stopSequence({ silence: true, announceState: false });
});

globalThis.addEventListener("pagehide", () => {
  pageIsActive = false;
  pageLifecycleGeneration += 1;
  requestAudioState(false);
  stopSequence({ silence: true, announceState: false });
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  const closingGraph = graph;
  const closingContext = audioContext;
  graph = null;
  audioContext = null;
  audioStartupPromise = null;
  if (closingGraph?.sourceNode?.port) closingGraph.sourceNode.port.onmessage = null;
  closingGraph?.releaseOutput?.();
  void closingContext?.close?.();
});

globalThis.addEventListener("pageshow", () => {
  if (pageIsActive) return;
  pageIsActive = true;
  telemetry = { ...telemetry, energy: 0, peak: 0, rms: 0, breathFlow: 0 };
  setAudioPresentation("off");
  updateGlobalPresentation();
  animationFrame = requestAnimationFrame(tick);
});
