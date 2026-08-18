import { VoicePool } from "./src/audio.js";
import {
  LINEBREAKER_PRESETS,
  dft2D,
  dominantFourierBins,
  findClearLine,
  makeLinebreakerMask,
  probeLine,
  sampledPorosityDiagnostics,
  shiftedMagnitude,
} from "./src/linebreaker.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1_000 / 30;
const MAX_AUDIO_VOICES = 12;
const DEFAULTS = Object.freeze({
  preset: "sierpinski-carpet",
  depth: 3,
  angle: 0,
  offset: -0.5 + 0.5 / 27,
  width: 1,
  level: 0.46,
  rootFrequency: 73,
  scanRate: 0.2,
});

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const pool = new VoicePool(MAX_AUDIO_VOICES, { continuousPeakCeiling: 0.72 });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const state = {
  ...DEFAULTS,
  scanning: false,
  audio: false,
  audioChanging: false,
};

let mask = null;
let transform = null;
let spectrum = null;
let peaks = [];
let probe = null;
let porosity = null;
let maskRaster = null;
let spectrumRaster = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameId = 0;
let lastFrameTime = 0;
let lastDrawTime = -Infinity;
let lastUiTime = -Infinity;
let dirty = true;
let disposed = false;
let lastLayout = null;
let previousPhraseOccupied = true;
let lastGrainAt = -Infinity;
let resizeObserver = null;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function percent(value, digits = 1) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function signed(value, digits = 3) {
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function markDirty() {
  dirty = true;
  if (!frameId && !disposed) frameId = requestAnimationFrame(frame);
}

function preset() {
  return LINEBREAKER_PRESETS.find((candidate) => candidate.id === state.preset)
    ?? LINEBREAKER_PRESETS[0];
}

function structureSummary() {
  if (state.preset === "crossed-lines") return "explicit complete rails · toy obstruction";
  if (state.preset === "sierpinski-carpet") return "ordinary porous · complete rails remain";
  return "holes along sampled lines · Cantor product";
}

function rebuildRasters() {
  maskRaster = document.createElement("canvas");
  maskRaster.width = mask.size;
  maskRaster.height = mask.size;
  const maskContext = maskRaster.getContext("2d");
  const maskImage = maskContext.createImageData(mask.size, mask.size);
  for (let index = 0; index < mask.data.length; index += 1) {
    const pixel = index * 4;
    if (mask.data[index]) {
      maskImage.data[pixel] = 184;
      maskImage.data[pixel + 1] = 255;
      maskImage.data[pixel + 2] = 106;
      maskImage.data[pixel + 3] = 245;
    } else {
      maskImage.data[pixel] = 6;
      maskImage.data[pixel + 1] = 9;
      maskImage.data[pixel + 2] = 13;
      maskImage.data[pixel + 3] = 255;
    }
  }
  maskContext.putImageData(maskImage, 0, 0);

  spectrumRaster = document.createElement("canvas");
  spectrumRaster.width = mask.size;
  spectrumRaster.height = mask.size;
  const spectrumContext = spectrumRaster.getContext("2d");
  const spectrumImage = spectrumContext.createImageData(mask.size, mask.size);
  for (let index = 0; index < spectrum.length; index += 1) {
    const intensity = spectrum[index] ** 0.72;
    const pixel = index * 4;
    spectrumImage.data[pixel] = Math.round(9 + intensity * 242);
    spectrumImage.data[pixel + 1] = Math.round(9 + intensity * 126);
    spectrumImage.data[pixel + 2] = Math.round(18 + intensity * 219);
    spectrumImage.data[pixel + 3] = 255;
  }
  spectrumContext.putImageData(spectrumImage, 0, 0);
}

function updateProbe() {
  probe = probeLine(mask, {
    angleDegrees: state.angle,
    offset: state.offset,
    widthPixels: state.width,
    sampleCount: Math.max(128, mask.size * 4),
  });
}

function rebuildModel({ seekRail = false } = {}) {
  mask = makeLinebreakerMask(state.preset, state.depth);
  transform = dft2D(mask);
  spectrum = shiftedMagnitude(transform);
  peaks = dominantFourierBins(transform, 18);
  porosity = sampledPorosityDiagnostics(mask, {
    angleSteps: 24,
    offsetSteps: Math.min(mask.size, 81),
    sampleCount: Math.max(72, mask.size * 2),
  });
  if (seekRail) {
    const best = findClearLine(mask, {
      angleSteps: 36,
      offsetSteps: Math.min(mask.size, 81),
      widthPixels: state.width,
      sampleCount: Math.max(96, mask.size * 2),
    });
    if (best) {
      state.angle = best.angleDegrees;
      state.offset = best.offset;
    }
  }
  updateProbe();
  rebuildRasters();
  paintInterface();
  markDirty();
}

function paintProbeSummary() {
  const rail = probe.longestOccupiedFraction;
  const complete = probe.occupiedSamples === probe.sampleCount;
  const label = complete
    ? "complete rail"
    : rail >= 0.55
      ? "long occupied run"
      : "broken by gaps";
  $("probeSummary").textContent = `${label} · ${percent(probe.occupancy)}`;
  $("densityMetric").textContent = percent(mask.density);
  $("occupancyMetric").textContent = percent(probe.occupancy);
  $("railMetric").textContent = percent(rail);
  $("gapMetric").textContent = String(probe.clearGapCount);
  $("coverageMetric").textContent = percent(porosity.lineGapCoverage, 0);
  $("completeMetric").textContent = String(porosity.completeOccupiedLines);
  $("diagnosticSummary").textContent = `${porosity.sampledProbeCount} lines · finite sample`;
  $("soundSummary").textContent = complete
    ? "focused organ rail · stable chord"
    : `${state.preset === "cantor-dust" ? "grain cloud" : "articulated ensemble"} · ${probe.clearGapCount} rests`;
}

function paintTransport() {
  setPressed($("scanButton"), state.scanning);
  $("scanButton").setAttribute("aria-label", state.scanning ? "Pause angle scan" : "Start angle scan");
  $("scanLabel").textContent = state.scanning ? "Scanning angle" : "Scan angle";
}

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

function paintInterface() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.preset);
  }
  $("presetDescription").textContent = preset().description;
  $("structureSummary").textContent = structureSummary();
  $("depth").value = String(state.depth);
  $("depthOut").textContent = `${state.depth} · ${mask.size}²`;
  $("probeAngle").value = String(Math.round(state.angle));
  $("probeAngleOut").textContent = `${Math.round(state.angle)}°`;
  $("probeOffset").value = String(state.offset);
  $("probeOffsetOut").textContent = signed(state.offset);
  $("probeWidth").value = String(state.width);
  $("probeWidthOut").textContent = `${state.width} px`;
  $("rootFrequency").value = String(state.rootFrequency);
  $("rootFrequencyOut").textContent = `${Math.round(state.rootFrequency)} Hz`;
  $("scanRate").value = String(state.scanRate);
  $("scanRateOut").textContent = `${state.scanRate.toFixed(2)} Hz`;
  $("level").value = String(state.level);
  $("levelOut").textContent = percent(state.level, 0);
  $("stageReadout").textContent = `${preset().label.toUpperCase()} · DEPTH ${state.depth} · PROBE ${Math.round(state.angle)}° · AUDIO ${state.audio ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Linebreaker split view. ${preset().label}, depth ${state.depth}. The probe is ${percent(probe.occupancy)} occupied with ${probe.clearGapCount} sampled clear gaps. Audio ${state.audio ? "on" : "off"}.`,
  );
  paintProbeSummary();
  paintTransport();
  paintAudioState();
}

function setProbe({ angle = state.angle, offset = state.offset, width = state.width } = {}, {
  announceChange = false,
} = {}) {
  state.angle = ((Number(angle) % 180) + 180) % 180;
  state.offset = clamp(Number(offset), -0.49, 0.49);
  state.width = clamp(Math.round(Number(width)), 1, 5);
  updateProbe();
  paintInterface();
  markDirty();
  if (announceChange) {
    announce(`Probe ${Math.round(state.angle)} degrees, ${percent(probe.occupancy)} occupied, ${probe.clearGapCount} clear gaps.`);
  }
}

function foldFrequency(frequency, minimum = 45, maximum = 5_800) {
  let folded = Math.max(1, Number(frequency));
  while (folded < minimum) folded *= 2;
  while (folded > maximum) folded /= 2;
  return folded;
}

function peakHarmonic(peak) {
  const signedX = peak.x <= mask.size / 2 ? peak.x : peak.x - mask.size;
  const signedY = peak.y <= mask.size / 2 ? peak.y : peak.y - mask.size;
  return 1 + Math.abs(signedX) + Math.abs(signedY);
}

function phraseSample(now) {
  if (!probe.samples.length) return { occupied: false, index: 0 };
  const progress = ((now / 1_000 * state.scanRate) % 1 + 1) % 1;
  const index = Math.min(probe.samples.length - 1, Math.floor(progress * probe.samples.length));
  return { ...probe.samples[index], index, progress };
}

function makeVoices(now) {
  const phrase = phraseSample(now);
  const occupiedGate = phrase.occupied ? 1 : 0.018;
  const angleSemitones = state.angle / 15;
  const melodicRoot = state.rootFrequency * 2 ** (angleSemitones / 12);
  // Keep the complete ensemble below the pool ceiling so occupancy and run
  // length remain audible dynamics instead of being normalized to one level.
  const densityGain = 0.035 + probe.occupancy * 0.09
    + probe.longestOccupiedFraction * 0.07;
  const dusty = state.preset === "cantor-dust";
  const gapTexture = 1 - probe.occupancy;
  const tremolo = dusty
    ? 0.28 + 0.72 * (0.5 + 0.5 * Math.sin(now / 1_000 * TAU * (2 + state.depth * 0.65)))
    : 0.92 + 0.08 * Math.sin(now / 1_000 * TAU * 0.32);
  const gate = occupiedGate * tremolo;
  const panCenter = clamp(state.offset * 1.9, -0.92, 0.92);
  const voices = [];

  const organIntervals = [1, 2, 3, 4];
  const layerCount = Math.min(state.depth + 1, organIntervals.length);
  for (let layer = 0; layer < layerCount; layer += 1) {
    const harmonic = organIntervals[layer];
    const layerPan = clamp(panCenter + (layer - (layerCount - 1) / 2) * 0.18, -1, 1);
    voices.push({
      key: `linebreaker:scale:${layer}`,
      frequency: foldFrequency(melodicRoot * harmonic),
      gain: densityGain * gate * (0.6 / (1 + layer * 0.36)),
      pan: layerPan,
      waveform: dusty ? (layer % 2 ? "sine" : "triangle") : "triangle",
      mode: dusty ? (layer % 2 ? "pm" : "fm") : "pm",
      synthDrive: dusty ? 0.18 + gapTexture * 0.32 : 0.045 + gapTexture * 0.08,
      modulationIndex: dusty ? 0.7 + state.depth * 0.28 : 0.16 + layer * 0.045,
      modulationRatio: dusty ? 1.35 + layer * 0.47 : 1 + layer * 0.25,
    });
  }

  const maximumPeak = peaks[0]?.magnitude || 1;
  const ensembleCount = Math.min(MAX_AUDIO_VOICES - voices.length, dusty ? 8 : 6);
  for (let index = 0; index < ensembleCount; index += 1) {
    const peak = peaks[index];
    if (!peak) break;
    const harmonic = peakHarmonic(peak);
    const peakLevel = Math.sqrt(peak.magnitude / maximumPeak);
    const spread = ensembleCount > 1 ? index / (ensembleCount - 1) * 2 - 1 : 0;
    const granularPulse = dusty
      ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 1_000 * TAU * (3.1 + index * 0.37)))
      : 1;
    voices.push({
      key: `linebreaker:fourier:${index}`,
      frequency: foldFrequency(melodicRoot * harmonic),
      gain: (0.012 + 0.03 * peakLevel) * gate * granularPulse * (0.72 + gapTexture * 0.28),
      pan: clamp(panCenter * 0.6 + spread * (dusty ? 0.72 : 0.38), -1, 1),
      waveform: dusty && index % 3 === 0 ? "sawtooth" : "sine",
      mode: dusty ? (index % 2 ? "pm" : "fm") : "pm",
      synthDrive: dusty ? 0.2 + peakLevel * 0.25 : 0.035 + peakLevel * 0.04,
      modulationIndex: dusty ? 0.8 + peakLevel * 1.7 : 0.12 + peakLevel * 0.18,
      modulationRatio: 1 + (harmonic % 11) / (dusty ? 4 : 8),
    });
  }

  return { voices, phrase, melodicRoot };
}

function updateAudio(now) {
  if (!state.audio || document.hidden) {
    pool.setVoices([]);
    return;
  }
  const { voices, phrase, melodicRoot } = makeVoices(now);
  pool.setVoices(voices, { requestedVoiceCount: MAX_AUDIO_VOICES });

  if (phrase.occupied && !previousPhraseOccupied && now - lastGrainAt > 75) {
    lastGrainAt = now;
    pool.strike({
      key: "linebreaker:gap-edge",
      frequency: foldFrequency(melodicRoot * (1 + state.depth)),
      gain: 0.12 + (1 - probe.occupancy) * 0.12,
      pan: clamp(state.offset * 2, -1, 1),
      waveform: state.preset === "cantor-dust" ? "sawtooth" : "triangle",
    }, {
      attackSeconds: 0.003,
      decaySeconds: state.preset === "cantor-dust" ? 0.07 : 0.14,
      attackNoise: state.preset === "cantor-dust" ? 0.22 : 0.05,
      retriggerMode: "crossfade",
    });
  }
  previousPhraseOccupied = phrase.occupied;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message || "Web Audio could not start.";
  $("audioError").hidden = false;
  announce(`Audio error: ${$("audioError").textContent}`);
}

function disableAudio({ announceChange = true } = {}) {
  state.audio = false;
  pool.disable();
  paintInterface();
  markDirty();
  if (announceChange) announce("Linebreaker audio off.");
}

async function toggleAudio() {
  if (state.audioChanging) return;
  if (state.audio) {
    disableAudio();
    return;
  }
  state.audioChanging = true;
  $("audioButton").disabled = true;
  clearAudioError();
  try {
    await pool.enable();
    pool.setLevel(state.level);
    state.audio = true;
    previousPhraseOccupied = true;
    announce("Linebreaker audio on. Probe runs phrase the Fourier ensemble.");
  } catch (error) {
    state.audio = false;
    showAudioError(error);
  } finally {
    state.audioChanging = false;
    $("audioButton").disabled = false;
    paintInterface();
    markDirty();
  }
}

function calculateLayout(width, height) {
  const padding = clamp(width * 0.035, 18, 42);
  const top = width < 340 ? 118 : width < 620 ? 126 : 150;
  const bottom = 72;
  const gap = width < 340 ? 10 : width < 720 ? 14 : 30;
  const size = Math.max(56, Math.min(
    (width - padding * 2 - gap) / 2,
    height - top - bottom,
  ));
  const total = size * 2 + gap;
  const startX = (width - total) / 2;
  return {
    space: { x: startX, y: top, size },
    frequency: { x: startX + size + gap, y: top, size },
    trace: width < 720
      ? null
      : { x: startX, y: top + size + 22, width: total, height: Math.max(24, height - (top + size + 38)) },
    compact: size < 220,
  };
}

function drawGridSquare(box, raster, label, sublabel) {
  context.save();
  context.fillStyle = "rgba(3, 6, 9, 0.96)";
  context.fillRect(box.x - 1, box.y - 1, box.size + 2, box.size + 2);
  context.imageSmoothingEnabled = false;
  context.drawImage(raster, box.x, box.y, box.size, box.size);
  context.strokeStyle = "rgba(255, 255, 255, 0.2)";
  context.lineWidth = 1;
  context.strokeRect(box.x - 0.5, box.y - 0.5, box.size + 1, box.size + 1);
  context.fillStyle = "rgba(239, 244, 247, 0.85)";
  context.font = `600 ${box.size < 180 ? 6 : 8}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.fillText(label, box.x, box.y - 8);
  context.fillStyle = "rgba(149, 161, 169, 0.75)";
  context.textAlign = "right";
  context.fillText(sublabel, box.x + box.size, box.y - 8);
  context.restore();
}

function normalizedToCanvas(point, box) {
  return {
    x: box.x + (point.x + 0.5) * box.size,
    y: box.y + (point.y + 0.5) * box.size,
  };
}

function drawProbe(box, now) {
  if (probe.samples.length < 2) return;
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.size, box.size);
  context.clip();
  context.lineWidth = Math.max(1.5, box.size / mask.size * state.width * 0.42);
  context.lineCap = "butt";
  for (let index = 1; index < probe.samples.length; index += 1) {
    const previous = normalizedToCanvas(probe.samples[index - 1], box);
    const current = normalizedToCanvas(probe.samples[index], box);
    context.strokeStyle = probe.samples[index].occupied
      ? "rgba(255, 244, 214, 0.88)"
      : "rgba(255, 111, 174, 0.9)";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.stroke();
  }
  const phrase = phraseSample(now);
  const marker = normalizedToCanvas(phrase, box);
  context.fillStyle = phrase.occupied ? "#fff4d6" : "#ff6fae";
  context.shadowColor = context.fillStyle;
  context.shadowBlur = 9;
  context.beginPath();
  context.arc(marker.x, marker.y, 3.2, 0, TAU);
  context.fill();
  context.restore();
}

function drawFrequencyGuide(box) {
  const angle = (state.angle + 90) * Math.PI / 180;
  const centerX = box.x + box.size / 2;
  const centerY = box.y + box.size / 2;
  const radius = box.size * 0.48;
  context.save();
  context.strokeStyle = `rgba(255, 244, 214, ${0.16 + probe.longestOccupiedFraction * 0.34})`;
  context.lineWidth = 1;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(centerX - Math.cos(angle) * radius, centerY - Math.sin(angle) * radius);
  context.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(255, 244, 214, 0.72)";
  context.beginPath();
  context.arc(centerX, centerY, 2.2, 0, TAU);
  context.fill();
  context.restore();
}

function drawTrace(box, now) {
  if (!box || box.height < 18) return;
  context.save();
  context.fillStyle = "rgba(3, 6, 9, 0.72)";
  context.fillRect(box.x, box.y, box.width, box.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
  context.fillStyle = "rgba(149, 161, 169, 0.72)";
  context.font = "600 7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "top";
  context.fillText("PROBE PHRASE · OCCUPIED = TONE · GAP = REST", box.x + 8, box.y + 7);
  const y = box.y + box.height * 0.68;
  const left = box.x + 8;
  const width = box.width - 16;
  context.lineWidth = Math.max(1, width / probe.samples.length + 0.3);
  for (let index = 0; index < probe.samples.length; index += 1) {
    const x = left + index / Math.max(1, probe.samples.length - 1) * width;
    context.strokeStyle = probe.samples[index].occupied
      ? "rgba(184, 255, 106, 0.88)"
      : "rgba(255, 111, 174, 0.42)";
    context.beginPath();
    context.moveTo(x, y - (probe.samples[index].occupied ? 7 : 1));
    context.lineTo(x, y + (probe.samples[index].occupied ? 7 : 1));
    context.stroke();
  }
  const phrase = phraseSample(now);
  const cursorX = left + phrase.progress * width;
  context.strokeStyle = "#fff4d6";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cursorX, box.y + 20);
  context.lineTo(cursorX, box.y + box.height - 6);
  context.stroke();
  context.restore();
}

function drawStage(now) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = "rgba(3, 6, 9, 0.16)";
  context.fillRect(0, 0, cssWidth, cssHeight);
  lastLayout = calculateLayout(cssWidth, cssHeight);
  const compact = lastLayout.compact;
  drawGridSquare(
    lastLayout.space,
    maskRaster,
    compact ? "SPACE · X" : "SPACE · FINITE MASK",
    compact ? `${mask.size}²` : `${mask.occupiedCount} / ${mask.size ** 2} CELLS`,
  );
  drawGridSquare(
    lastLayout.frequency,
    spectrumRaster,
    compact ? "FOURIER · Ξ" : "FREQUENCY · LOG |DFT₂|",
    compact ? "|F₂|" : "UNITARY · SHIFTED",
  );
  drawProbe(lastLayout.space, now);
  drawFrequencyGuide(lastLayout.frequency);
  drawTrace(lastLayout.trace, now);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(
    2,
    Math.max(1, globalThis.devicePixelRatio || 1),
    Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight)),
  );
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  markDirty();
}

function frame(now) {
  frameId = 0;
  if (disposed) return;
  resizeIfNeeded();
  const elapsed = lastFrameTime ? Math.min(100, now - lastFrameTime) : 0;
  lastFrameTime = now;
  if (state.scanning && !document.hidden) {
    const scanSpeed = (reducedMotion ? 7 : 18) * (state.scanRate / DEFAULTS.scanRate);
    state.angle = (state.angle + elapsed / 1_000 * scanSpeed) % 180;
    updateProbe();
    dirty = true;
  }
  updateAudio(now);
  if (dirty || state.scanning || state.audio || now - lastDrawTime > 500) {
    if (dirty || now - lastDrawTime >= FRAME_INTERVAL) {
      drawStage(now);
      lastDrawTime = now;
      dirty = false;
    }
  }
  if (now - lastUiTime > 90 && (state.scanning || state.audio)) {
    paintInterface();
    lastUiTime = now;
  }
  if (state.scanning || state.audio || dirty) frameId = requestAnimationFrame(frame);
}

function resizeIfNeeded() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  if (nextWidth !== cssWidth || nextHeight !== cssHeight) resizeCanvas();
}

function setScanning(scanning) {
  state.scanning = Boolean(scanning);
  lastFrameTime = performance.now();
  paintTransport();
  announce(`Angle scan ${state.scanning ? "playing" : "paused"}.`);
  markDirty();
}

function seekClearestLine({ announceResult = true } = {}) {
  const best = findClearLine(mask, {
    angleSteps: 36,
    offsetSteps: Math.min(mask.size, 81),
    widthPixels: state.width,
    sampleCount: Math.max(96, mask.size * 2),
  });
  if (!best) return;
  state.scanning = false;
  setProbe({ angle: best.angleDegrees, offset: best.offset });
  paintTransport();
  if (announceResult) {
    announce(`Clearest sampled line: ${Math.round(state.angle)} degrees, ${percent(probe.longestOccupiedFraction)} longest occupied run. Finite search only.`);
  }
}

function resetInstrument() {
  Object.assign(state, DEFAULTS, { scanning: false });
  pool.setLevel(state.level);
  rebuildModel();
  paintInterface();
  announce("Linebreaker reset to the Sierpiński carpet.");
}

for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => {
    state.preset = button.dataset.preset;
    state.scanning = false;
    rebuildModel({ seekRail: true });
    announce(`${preset().label}. ${structureSummary()}.`);
  });
}

$("depth").addEventListener("change", () => {
  state.depth = clamp(Math.round(Number($("depth").value)), 2, 4);
  rebuildModel({ seekRail: true });
  announce(`Recursion depth ${state.depth}, ${mask.size} by ${mask.size} finite grid.`);
});

$("probeAngle").addEventListener("input", () => {
  state.scanning = false;
  setProbe({ angle: Number($("probeAngle").value) });
});

$("probeOffset").addEventListener("input", () => {
  state.scanning = false;
  setProbe({ offset: Number($("probeOffset").value) });
});

$("probeWidth").addEventListener("input", () => {
  state.scanning = false;
  setProbe({ width: Number($("probeWidth").value) });
});

$("rootFrequency").addEventListener("input", () => {
  state.rootFrequency = clamp(Number($("rootFrequency").value), 45, 180);
  $("rootFrequencyOut").textContent = `${Math.round(state.rootFrequency)} Hz`;
  markDirty();
});

$("scanRate").addEventListener("input", () => {
  state.scanRate = clamp(Number($("scanRate").value), 0.05, 0.8);
  $("scanRateOut").textContent = `${state.scanRate.toFixed(2)} Hz`;
  markDirty();
});

$("level").addEventListener("input", () => {
  state.level = clamp(Number($("level").value), 0, 1);
  pool.setLevel(state.level);
  $("levelOut").textContent = percent(state.level, 0);
});

$("audioButton").addEventListener("click", toggleAudio);
$("scanButton").addEventListener("click", () => setScanning(!state.scanning));
$("findLineButton").addEventListener("click", () => seekClearestLine());
$("resetButton").addEventListener("click", resetInstrument);

canvas.addEventListener("pointerdown", (event) => {
  if (!lastLayout) return;
  const bounds = canvas.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const box = lastLayout.space;
  if (point.x < box.x || point.x > box.x + box.size || point.y < box.y || point.y > box.y + box.size) return;
  event.preventDefault();
  canvas.focus();
  const normalized = {
    x: (point.x - box.x) / box.size - 0.5,
    y: (point.y - box.y) / box.size - 0.5,
  };
  const radians = state.angle * Math.PI / 180;
  const offset = -Math.sin(radians) * normalized.x + Math.cos(radians) * normalized.y;
  state.scanning = false;
  setProbe({ offset }, { announceChange: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.audio) {
      event.preventDefault();
      disableAudio();
    }
    return;
  }
  const interactive = /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(event.target?.tagName ?? "");
  if (interactive && event.target !== canvas) return;
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    setScanning(!state.scanning);
    return;
  }
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    seekClearestLine();
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    state.scanning = false;
    setProbe({ angle: state.angle + direction * (event.shiftKey ? 10 : 1) }, { announceChange: true });
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    state.scanning = false;
    setProbe({ offset: state.offset + direction * (event.shiftKey ? 0.05 : 0.01) }, { announceChange: true });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else markDirty();
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    pool.silence();
    return;
  }
  disposed = true;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  resizeObserver?.disconnect();
  if (!resizeObserver) window.removeEventListener("resize", resizeCanvas);
  void pool.close();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  disposed = false;
  lastFrameTime = performance.now();
  markDirty();
});

if (globalThis.ResizeObserver) {
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stageWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}

rebuildModel();
pool.setLevel(state.level);
paintInterface();
resizeCanvas();
markDirty();
