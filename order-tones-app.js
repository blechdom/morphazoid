import { VoicePool } from "./src/audio.js";
import {
  ORDER_TONES_PRESETS,
  dominantPeakBins,
  multiplicativeOrder,
  orderFindingDistribution,
  phasorContributions,
  qftCosetDistribution,
  recoverFactorsFromMeasurement,
  simulateOrderFindingShots,
} from "./src/order-tones.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_AUDIO_VOICES = 8;
const MAX_QFT_VOICES = 4;
const FRAME_INTERVAL = 1_000 / 30;
const DEFAULTS = Object.freeze({
  modulus: 15,
  base: 2,
  precision: 8,
  view: "computational",
  level: 0.52,
});

const canvas = $("stage");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const stageWrap = $("stageWrap");
const pool = new VoicePool(MAX_AUDIO_VOICES);
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const state = {
  ...DEFAULTS,
  playing: false,
  audio: false,
  audioChanging: false,
  sequenceIndex: 0,
  selectedBin: 64,
  hoverBin: null,
  shots: [],
  histogram: [],
  receipt: null,
  batchCounter: 0,
};

let experiment = null;
let selectedCoset = null;
let selectedPhasors = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameId = 0;
let lastFrameTime = 0;
let lastDrawTime = -Infinity;
let stepAccumulator = 0;
let dirty = true;
let disposed = false;
let lastLayout = null;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
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

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message || "Web Audio could not start.";
  $("audioError").hidden = false;
  announce(`Audio error: ${$("audioError").textContent}`);
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function presetForModulus(modulus = state.modulus) {
  return ORDER_TONES_PRESETS.find((preset) => preset.modulus === Number(modulus))
    ?? ORDER_TONES_PRESETS[0];
}

function compactFraction(value, maximumDigits = 4) {
  return Number(value)
    .toFixed(maximumDigits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function percent(value, digits = 2) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function residueFrequency(residue) {
  const normalized = experiment.modulus > 1 ? (residue - 1) / (experiment.modulus - 1) : 0;
  const semitone = Math.round(normalized * 24);
  return 110 * 2 ** (semitone / 12);
}

function binFrequency(bin) {
  const phase = bin / experiment.registerSize;
  const semitone = Math.round(phase * 31);
  return 130.81 * 2 ** (semitone / 12);
}

function currentOffset() {
  return wrap(state.sequenceIndex, experiment.order);
}

function rebuildSelectedCoset() {
  const offset = currentOffset();
  selectedCoset = qftCosetDistribution(experiment.order, state.precision, offset);
  selectedPhasors = phasorContributions(
    experiment.order,
    state.precision,
    offset,
    state.selectedBin,
  );
}

function strongestNonzeroPeak() {
  return dominantPeakBins(experiment.probabilities, 1, { includeZero: false })[0] ?? 0;
}

function populateBaseSelect(preferredBase) {
  const select = $("orderBase");
  const preset = presetForModulus();
  select.replaceChildren();
  for (const base of preset.bases) {
    const option = document.createElement("option");
    const order = multiplicativeOrder(base, preset.modulus);
    option.value = String(base);
    option.textContent = `${base} · order ${order}`;
    select.append(option);
  }
  const chosen = preset.bases.includes(Number(preferredBase))
    ? Number(preferredBase)
    : preset.defaultBase;
  state.base = chosen;
  select.value = String(chosen);
}

function rebuildExperiment({ preserveBin = false, announceChange = false } = {}) {
  experiment = orderFindingDistribution(state.modulus, state.base, state.precision);
  state.sequenceIndex = wrap(state.sequenceIndex, experiment.order);
  state.selectedBin = preserveBin
    ? clamp(Math.round(state.selectedBin), 0, experiment.registerSize - 1)
    : strongestNonzeroPeak();
  state.hoverBin = null;
  state.shots = [];
  state.histogram = [];
  state.receipt = null;
  rebuildSelectedCoset();
  pool.setVoices([]);
  paintControls();
  updateAudioVoices();
  renderShotHistogram();
  renderReceipt();
  markDirty();
  if (announceChange) {
    announce(`Now sounding ${state.base} to the x modulo ${state.modulus}, order ${experiment.order}.`);
  }
}

function sequenceEquation() {
  const exponent = currentOffset();
  const residue = experiment.residues[exponent];
  return `x ${exponent} · ${state.base}^${exponent} mod ${state.modulus} = ${residue}`;
}

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

function paintControls() {
  $("orderN").value = String(state.modulus);
  $("orderBase").value = String(state.base);
  $("orderPrecision").value = String(state.precision);
  $("level").value = String(state.level);
  $("levelOut").textContent = percent(state.level, 0);
  $("binSlider").max = String(experiment.registerSize - 1);
  $("binSlider").value = String(state.selectedBin);
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause modular sequence" : "Play modular sequence");
  $("transportLabel").textContent = state.playing ? "Residues playing" : "Play residues";
  $("sequenceReadout").textContent = sequenceEquation();
  setPressed($("computationalView"), state.view === "computational");
  setPressed($("iqftView"), state.view === "iqft");
  $("functionReadout").textContent = `f(x) = ${state.base}ˣ mod ${state.modulus}`;
  $("residueReadout").textContent = `${experiment.residues.join(" → ")} → 1`;
  $("periodReadout").textContent = `r = ${experiment.order}`;
  $("cosetReadout").textContent = `x = ${currentOffset()} mod ${experiment.order} · residue ${experiment.residues[currentOffset()]}`;
  $("modularSummary").textContent = `${state.base}ˣ mod ${state.modulus} · period ${experiment.order}`;
  $("transformSummary").textContent = state.view === "iqft"
    ? `iQFT · bin ${state.selectedBin}`
    : `Computational · x = ${currentOffset()}`;
  $("binSliderOut").textContent = `${state.selectedBin} / ${experiment.registerSize}`;
  $("binNote").textContent = `Phase k/Q = ${compactFraction(state.selectedBin / experiment.registerSize)} · probability ${percent(experiment.probabilities[state.selectedBin])}`;
  $("stageReadout").textContent = `N ${state.modulus} · a ${state.base} · r ${experiment.order} · ${state.precision} QUBITS · AUDIO ${state.audio ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Order Tones. ${state.base} to the x modulo ${state.modulus} has order ${experiment.order}. Selected inverse-QFT bin ${state.selectedBin} has probability ${percent(experiment.probabilities[state.selectedBin])}. Audio ${state.audio ? "on" : "off"}.`,
  );
  paintAudioState();
}

function setSelectedBin(bin, { announceSelection = false } = {}) {
  const selected = clamp(Math.round(Number(bin) || 0), 0, experiment.registerSize - 1);
  if (selected === state.selectedBin) return;
  state.selectedBin = selected;
  selectedPhasors = phasorContributions(
    experiment.order,
    state.precision,
    currentOffset(),
    state.selectedBin,
  );
  $("binSlider").value = String(selected);
  paintControls();
  updateAudioVoices();
  markDirty();
  if (announceSelection) {
    announce(`Bin ${selected}; probability ${percent(experiment.probabilities[selected])}.`);
  }
}

function setSequenceIndex(index, { strike = false, announceStep = false } = {}) {
  const next = wrap(Math.round(index), experiment.order);
  if (next === state.sequenceIndex && !strike) return;
  state.sequenceIndex = next;
  rebuildSelectedCoset();
  if (strike && state.audio) strikeResidue(experiment.residues[currentOffset()]);
  paintControls();
  updateAudioVoices();
  markDirty();
  if (announceStep) announce(sequenceEquation());
}

function setView(view, { announceView = true } = {}) {
  const next = view === "iqft" ? "iqft" : "computational";
  if (next === state.view) return;
  state.view = next;
  paintControls();
  updateAudioVoices();
  markDirty();
  if (announceView) {
    announce(next === "iqft"
      ? "Inverse QFT view. Probability peaks and selected-bin phasors visible."
      : "Computational view. Modular residues visible before the transform.");
  }
}

function disableAudio({ announceChange = true } = {}) {
  state.audio = false;
  pool.disable();
  paintControls();
  if (announceChange) announce("Audio off.");
  markDirty();
}

async function enableAudio() {
  if (state.audio) return true;
  if (state.audioChanging) return false;
  state.audioChanging = true;
  $("audioButton").disabled = true;
  clearAudioError();
  try {
    await pool.enable();
    pool.setLevel(state.level);
    state.audio = true;
    paintControls();
    updateAudioVoices();
    announce("Audio on. Modular tones are ready.");
    markDirty();
    return true;
  } catch (error) {
    state.audio = false;
    paintControls();
    showAudioError(error);
    return false;
  } finally {
    state.audioChanging = false;
    $("audioButton").disabled = false;
  }
}

async function toggleAudio() {
  if (state.audio) disableAudio();
  else await enableAudio();
}

function setPlaying(playing) {
  state.playing = Boolean(playing);
  setPressed($("playButton"), state.playing);
  stepAccumulator = 0;
  lastFrameTime = performance.now();
  paintControls();
  updateAudioVoices();
  markDirty();
}

function togglePlayback() {
  if (state.playing) {
    setPlaying(false);
    announce("Modular sequence paused.");
    return;
  }
  setPlaying(true);
  if (state.audio) strikeResidue(experiment.residues[currentOffset()]);
  announce(state.audio
    ? "Modular sequence playing."
    : "Modular sequence playing silently. Turn Audio on to hear it.");
}

function strikeResidue(residue) {
  pool.strike({
    key: `order-residue:${residue}`,
    frequency: residueFrequency(residue),
    gain: 0.28,
    pan: clamp((residue / state.modulus) * 1.4 - 0.7, -0.72, 0.72),
    waveform: "sine",
  }, {
    attackSeconds: 0.008,
    decaySeconds: 0.22,
    retriggerMode: "crossfade",
    crossfadeSeconds: 0.015,
  });
}

function strikeMeasurement(bin, gain = 0.38, delay = 0) {
  pool.strike({
    key: `order-shot:${bin}`,
    frequency: binFrequency(bin),
    gain,
    pan: clamp((bin / Math.max(1, experiment.registerSize - 1)) * 1.5 - 0.75, -0.8, 0.8),
    waveform: "triangle",
  }, {
    attackSeconds: 0.004,
    decaySeconds: 0.32,
    startDelaySeconds: delay,
    retriggerMode: "crossfade",
    crossfadeSeconds: 0.012,
  });
}

function updateAudioVoices() {
  if (!state.audio || document.hidden) {
    pool.setVoices([]);
    return;
  }
  if (state.view === "computational") {
    if (!state.playing) {
      pool.setVoices([]);
      return;
    }
    const residue = experiment.residues[currentOffset()];
    pool.setVoices([{
      key: "order-sequence",
      frequency: residueFrequency(residue),
      gain: 0.18,
      pan: clamp((residue / state.modulus) * 1.2 - 0.6, -0.65, 0.65),
      waveform: "sine",
    }]);
    return;
  }

  const peaks = dominantPeakBins(experiment.probabilities, MAX_QFT_VOICES);
  const peakProbability = Math.max(...peaks.map((bin) => experiment.probabilities[bin]), 1e-12);
  pool.setVoices(peaks.map((bin) => ({
    key: `order-peak:${bin}`,
    frequency: binFrequency(bin),
    gain: 0.08 + 0.14 * Math.sqrt(experiment.probabilities[bin] / peakProbability)
      + (bin === state.selectedBin ? 0.04 : 0),
    pan: clamp((bin / Math.max(1, experiment.registerSize - 1)) * 1.3 - 0.65, -0.72, 0.72),
    waveform: "sine",
  })));
}

function receiptConvergent(receipt) {
  if (!receipt?.convergents?.length) return null;
  if (receipt.denominator) {
    const exact = receipt.convergents.find(({ denominator }) => denominator === receipt.denominator);
    if (exact) return exact;
  }
  const withinModulus = receipt.convergents.filter(({ denominator }) => denominator <= state.modulus);
  return withinModulus.at(-1) ?? receipt.convergents.at(-1);
}

function renderReceipt() {
  const receipt = state.receipt;
  const card = $("resultCard");
  if (!receipt) {
    card.dataset.result = "idle";
    $("measurementReadout").textContent = "—";
    $("fractionReadout").textContent = "—";
    $("orderReadout").textContent = "—";
    $("factorReadout").textContent = "Take a shot";
    $("resultStatus").textContent = "A shot samples the probability comb; not every sample yields factors.";
    $("measurementSummary").textContent = "No shots yet";
    return;
  }
  const convergent = receiptConvergent(receipt);
  card.dataset.result = receipt.success ? "success" : "failure";
  $("measurementReadout").textContent = `k = ${receipt.measuredBin} · ${percent(experiment.probabilities[receipt.measuredBin])}`;
  $("fractionReadout").textContent = convergent
    ? `${receipt.measuredBin}/${receipt.registerSize} ≈ ${convergent.numerator}/${convergent.denominator}`
    : `${receipt.measuredBin}/${receipt.registerSize}`;
  $("orderReadout").textContent = receipt.order ? `r = ${receipt.order}` : "not recovered";
  $("factorReadout").textContent = receipt.success && receipt.factors
    ? `${state.modulus} = ${receipt.factors[0]} × ${receipt.factors[1]}`
    : receipt.reason.replaceAll("-", " ");
  $("resultStatus").textContent = receipt.message;
  const successes = state.shots.length > 1
    ? state.shots.reduce((count, bin) => count + Number(
      recoverFactorsFromMeasurement(state.modulus, state.base, bin, state.precision).success,
    ), 0)
    : Number(receipt.success);
  $("measurementSummary").textContent = state.shots.length > 1
    ? `${state.shots.length} shots · ${successes} factor receipts`
    : receipt.success ? "1 shot · factors found" : `1 shot · ${receipt.reason.replaceAll("-", " ")}`;
}

function renderShotHistogram() {
  const container = $("shotsHistogram");
  container.replaceChildren();
  if (!state.shots.length) {
    container.setAttribute("aria-label", "No measurement shots yet");
    return;
  }
  const populated = state.histogram
    .map((count, bin) => ({ count, bin }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.bin - right.bin)
    .slice(0, 12);
  const maximum = Math.max(...populated.map(({ count }) => count), 1);
  for (const { count, bin } of populated) {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "order-shot-bar";
    bar.style.setProperty("--shot-height", String(count / maximum));
    bar.dataset.bin = String(bin);
    bar.setAttribute("aria-label", `Bin ${bin}: ${count} ${count === 1 ? "shot" : "shots"}`);
    bar.innerHTML = `<i aria-hidden="true"></i><b>${bin}</b><small>${count}</small>`;
    bar.addEventListener("click", () => {
      setView("iqft", { announceView: false });
      setSelectedBin(bin, { announceSelection: true });
    });
    container.append(bar);
  }
  container.setAttribute(
    "aria-label",
    `${state.shots.length} measurement shots. Most frequent ${populated.map(({ bin, count }) => `bin ${bin}: ${count}`).join(", ")}.`,
  );
}

function takeShots(count) {
  const simulation = simulateOrderFindingShots({
    modulus: state.modulus,
    base: state.base,
    precision: state.precision,
    count,
    seed: `order-tones:${state.modulus}:${state.base}:${state.precision}:${state.batchCounter}`,
  });
  state.batchCounter += 1;
  state.shots = [...simulation.shots];
  state.histogram = [...simulation.histogram];
  const chosenReceipt = simulation.receipts.find((receipt) => receipt.success)
    ?? simulation.receipts.at(-1);
  state.receipt = chosenReceipt;
  state.view = "iqft";
  setSelectedBin(chosenReceipt.measuredBin);
  renderShotHistogram();
  renderReceipt();
  paintControls();
  updateAudioVoices();
  markDirty();

  if (state.audio) {
    if (count === 1) strikeMeasurement(chosenReceipt.measuredBin);
    else {
      const strongest = state.histogram
        .map((shotCount, bin) => ({ shotCount, bin }))
        .filter(({ shotCount }) => shotCount > 0)
        .sort((left, right) => right.shotCount - left.shotCount || left.bin - right.bin)
        .slice(0, 6);
      const maximum = strongest[0]?.shotCount ?? 1;
      strongest.forEach(({ shotCount, bin }, index) => {
        strikeMeasurement(bin, 0.12 + 0.22 * shotCount / maximum, Math.min(0.048, index * 0.008));
      });
    }
  }
  announce(count === 1
    ? `Measured bin ${chosenReceipt.measuredBin}. ${chosenReceipt.message}`
    : `Measured 64 shots. ${chosenReceipt.message}`);
}

function resetInstrument() {
  state.modulus = DEFAULTS.modulus;
  state.base = DEFAULTS.base;
  state.precision = DEFAULTS.precision;
  state.view = DEFAULTS.view;
  state.level = DEFAULTS.level;
  state.playing = false;
  state.sequenceIndex = 0;
  state.batchCounter = 0;
  populateBaseSelect(state.base);
  rebuildExperiment();
  announce("Order Tones reset.");
}

function canvasColors() {
  const styles = getComputedStyle(document.body);
  return {
    accent: styles.getPropertyValue("--accent").trim() || "#8ce6ff",
    ink: styles.getPropertyValue("--ink").trim() || "#dbe4e0",
    muted: styles.getPropertyValue("--muted").trim() || "#77837e",
    faint: styles.getPropertyValue("--faint").trim() || "#454e4b",
    line: styles.getPropertyValue("--line-strong").trim() || "rgba(214,232,226,.18)",
    bg: styles.getPropertyValue("--bg-deep").trim() || "#050608",
    violet: styles.getPropertyValue("--violet").trim() || "#c79bff",
    orange: styles.getPropertyValue("--orange").trim() || "#ffb86b",
  };
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width || stageWrap.clientWidth || 1));
  const height = Math.max(1, Math.round(bounds.height || stageWrap.clientHeight || 1));
  const ratio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  if (width === cssWidth && height === cssHeight && ratio === pixelRatio) return;
  cssWidth = width;
  cssHeight = height;
  pixelRatio = ratio;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  dirty = true;
}

function stageLayout() {
  const compact = cssWidth < 620 || cssHeight < 360;
  // Leave the compact stage's upper-left title block clear before beginning
  // the analytical labels and residue orbit.
  const top = 82;
  const phasorHeight = Math.max(54, cssHeight * (compact ? 0.22 : 0.26));
  const phasorTop = cssHeight - phasorHeight - (compact ? 14 : 24);
  const upperHeight = Math.max(80, phasorTop - top - 20);
  return {
    compact,
    orbit: {
      x: cssWidth * (compact ? 0.22 : 0.245),
      y: top + upperHeight * 0.52,
      radius: Math.max(28, Math.min(cssWidth * (compact ? 0.14 : 0.15), upperHeight * 0.33)),
    },
    comb: {
      x: cssWidth * (compact ? 0.43 : 0.47),
      y: top + (compact ? 14 : 8),
      width: cssWidth * (compact ? 0.52 : 0.47),
      height: upperHeight * (compact ? 0.70 : 0.75),
    },
    phasor: {
      x: compact ? 18 : 32,
      y: phasorTop,
      width: cssWidth - (compact ? 36 : 64),
      height: phasorHeight,
    },
  };
}

function drawLabel(text, x, y, color, align = "left", size = 9) {
  context.fillStyle = color;
  context.font = `500 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(text, x, y);
}

function drawOrbit(layout, colors, now) {
  const { x: centerX, y: centerY, radius } = layout.orbit;
  context.save();
  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  context.setLineDash([3, 6]);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, TAU);
  context.stroke();
  context.setLineDash([]);

  const points = experiment.residues.map((residue, index) => {
    const angle = -Math.PI / 2 + TAU * index / experiment.order;
    return {
      residue,
      index,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });
  context.strokeStyle = state.view === "computational" ? colors.accent : colors.faint;
  context.globalAlpha = state.view === "computational" ? 0.75 : 0.35;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (points.length > 1) context.lineTo(points[0].x, points[0].y);
  context.stroke();
  context.globalAlpha = 1;

  for (const point of points) {
    const active = point.index === currentOffset();
    const pulse = reducedMotion ? 1 : 1 + 0.08 * Math.sin(now / 180);
    context.fillStyle = active ? colors.accent : colors.bg;
    context.strokeStyle = active ? colors.accent : colors.line;
    context.lineWidth = active ? 2 : 1;
    context.beginPath();
    context.arc(point.x, point.y, (active ? 7 : 4) * (active ? pulse : 1), 0, TAU);
    context.fill();
    context.stroke();
    drawLabel(String(point.residue), point.x, point.y - 10, active ? colors.ink : colors.muted, "center", active ? 10 : 8);
    if (!layout.compact) drawLabel(`x${point.index}`, point.x, point.y + 16, colors.faint, "center", 7);
  }

  drawLabel("MODULAR RESIDUE ORBIT", centerX - radius, centerY - radius - 22, colors.muted, "left", 8);
  drawLabel(`${state.base}ˣ mod ${state.modulus}`, centerX, centerY + 3, colors.ink, "center", layout.compact ? 8 : 10);
  drawLabel(`r = ${experiment.order}`, centerX, centerY + 17, colors.accent, "center", 8);
  context.restore();
}

function drawComb(layout, colors) {
  const { x, y, width, height } = layout.comb;
  const baseline = y + height;
  const probabilities = experiment.probabilities;
  const maxProbability = Math.max(...probabilities);
  const barWidth = width / probabilities.length;
  const hovered = state.hoverBin;
  context.save();
  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, baseline + 0.5);
  context.lineTo(x + width, baseline + 0.5);
  context.stroke();

  for (let bin = 0; bin < probabilities.length; bin += 1) {
    const probability = probabilities[bin];
    const barHeight = probability > 1e-8
      ? Math.max(1, probability / maxProbability * (height - 15))
      : 0;
    if (barHeight <= 0) continue;
    const selected = bin === state.selectedBin;
    context.globalAlpha = selected ? 1 : state.view === "iqft" ? 0.58 : 0.22;
    context.fillStyle = selected ? colors.orange : colors.accent;
    context.fillRect(
      x + bin * barWidth,
      baseline - barHeight,
      Math.max(0.7, barWidth * 0.76),
      barHeight,
    );
  }
  context.globalAlpha = 1;

  if (state.histogram.length) {
    const maximum = Math.max(...state.histogram, 1);
    context.fillStyle = colors.violet;
    context.globalAlpha = 0.5;
    for (let bin = 0; bin < state.histogram.length; bin += 1) {
      if (!state.histogram[bin]) continue;
      const dotX = x + (bin + 0.5) * barWidth;
      const dotY = baseline - state.histogram[bin] / maximum * (height - 18);
      context.beginPath();
      context.arc(dotX, dotY, 2.2, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  const selectedX = x + (state.selectedBin + 0.5) * barWidth;
  context.strokeStyle = colors.orange;
  context.beginPath();
  context.moveTo(selectedX, y);
  context.lineTo(selectedX, baseline + 5);
  context.stroke();
  if (hovered !== null && hovered !== state.selectedBin) {
    const hoverX = x + (hovered + 0.5) * barWidth;
    context.strokeStyle = colors.ink;
    context.globalAlpha = 0.6;
    context.setLineDash([2, 3]);
    context.beginPath();
    context.moveTo(hoverX, y);
    context.lineTo(hoverX, baseline);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  drawLabel("INVERSE-QFT PROBABILITY", x, y - 10, colors.muted, "left", 8);
  drawLabel("0", x, baseline + 13, colors.faint, "left", 7);
  drawLabel(`${experiment.registerSize - 1}`, x + width, baseline + 13, colors.faint, "right", 7);
  const readBin = hovered ?? state.selectedBin;
  const readX = clamp(x + (readBin + 0.5) * barWidth, x + 35, x + width - 35);
  drawLabel(
    `k ${readBin} · ${percent(probabilities[readBin], 1)}`,
    readX,
    y + 9,
    readBin === state.selectedBin ? colors.orange : colors.ink,
    "center",
    8,
  );
  context.restore();
}

function drawPhasors(layout, colors) {
  const { x, y, width, height } = layout.phasor;
  const contributions = selectedPhasors.contributions;
  const points = [{ x: 0, y: 0 }];
  let real = 0;
  let imaginary = 0;
  for (const contribution of contributions) {
    const magnitude = Math.hypot(contribution.real, contribution.imaginary) || 1;
    real += contribution.real / magnitude;
    imaginary += contribution.imaginary / magnitude;
    points.push({ x: real, y: imaginary });
  }
  let minX = Math.min(...points.map((point) => point.x));
  let maxX = Math.max(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxY = Math.max(...points.map((point) => point.y));
  if (maxX - minX < 1) { minX -= 0.5; maxX += 0.5; }
  if (maxY - minY < 1) { minY -= 0.5; maxY += 0.5; }
  const labelWidth = layout.compact ? 0 : Math.min(190, width * 0.25);
  const graphX = x + labelWidth;
  const graphWidth = width - labelWidth;
  const scale = Math.min(
    graphWidth * 0.88 / (maxX - minX),
    height * 0.62 / (maxY - minY),
  );
  const originX = graphX + graphWidth * 0.5 - (minX + maxX) * 0.5 * scale;
  const originY = y + height * 0.56 + (minY + maxY) * 0.5 * scale;

  context.save();
  context.strokeStyle = colors.line;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
  context.globalAlpha = state.view === "iqft" ? 0.92 : 0.25;
  context.strokeStyle = colors.violet;
  context.lineWidth = 1.2;
  context.beginPath();
  points.forEach((point, index) => {
    const drawX = originX + point.x * scale;
    const drawY = originY - point.y * scale;
    if (index === 0) context.moveTo(drawX, drawY);
    else context.lineTo(drawX, drawY);
  });
  context.stroke();
  const endpoint = points.at(-1);
  context.fillStyle = colors.orange;
  context.beginPath();
  context.arc(originX + endpoint.x * scale, originY - endpoint.y * scale, 3.5, 0, TAU);
  context.fill();
  context.globalAlpha = 1;

  drawLabel(
    `SELECTED-BIN PHASORS · k ${state.selectedBin}`,
    x,
    y + 15,
    colors.muted,
    "left",
    8,
  );
  if (!layout.compact) {
    drawLabel(`${contributions.length} PATHS`, x, y + 32, colors.faint, "left", 8);
    drawLabel(
      `COSET P ${percent(selectedPhasors.probability, 2)}`,
      x,
      y + 48,
      colors.ink,
      "left",
      8,
    );
    drawLabel(
      state.view === "iqft" ? "ALIGNMENT AUDIBLE" : "TRANSFORM BYPASSED",
      x,
      y + 64,
      state.view === "iqft" ? colors.accent : colors.faint,
      "left",
      8,
    );
  }
  context.restore();
}

function drawStage(now) {
  resizeCanvas();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const colors = canvasColors();
  const layout = stageLayout();
  lastLayout = layout;
  drawOrbit(layout, colors, now);
  drawComb(layout, colors);
  drawPhasors(layout, colors);
}

function frame(now) {
  frameId = 0;
  if (disposed) return;
  resizeCanvas();
  const elapsed = lastFrameTime ? Math.min(250, now - lastFrameTime) : 0;
  lastFrameTime = now;
  if (state.playing && !document.hidden) {
    stepAccumulator += elapsed;
    const stepDuration = reducedMotion ? 760 : 460;
    while (stepAccumulator >= stepDuration) {
      stepAccumulator -= stepDuration;
      setSequenceIndex(state.sequenceIndex + 1, { strike: true });
    }
  }
  if (dirty || state.playing || now - lastDrawTime >= 500) {
    if (dirty || now - lastDrawTime >= FRAME_INTERVAL) {
      drawStage(now);
      lastDrawTime = now;
      dirty = false;
    }
  }
  if (state.playing || dirty) frameId = requestAnimationFrame(frame);
}

function binAtCanvasPoint(event) {
  if (!lastLayout) return null;
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const comb = lastLayout.comb;
  if (x < comb.x || x > comb.x + comb.width || y < comb.y - 16 || y > comb.y + comb.height + 18) {
    return null;
  }
  return clamp(
    Math.floor((x - comb.x) / comb.width * experiment.registerSize),
    0,
    experiment.registerSize - 1,
  );
}

$("orderN").addEventListener("change", () => {
  state.modulus = Number($("orderN").value);
  populateBaseSelect(presetForModulus().defaultBase);
  rebuildExperiment({ announceChange: true });
});

$("orderBase").addEventListener("change", () => {
  state.base = Number($("orderBase").value);
  rebuildExperiment({ announceChange: true });
});

$("orderPrecision").addEventListener("change", () => {
  state.precision = Number($("orderPrecision").value);
  rebuildExperiment({ announceChange: true });
});

$("level").addEventListener("input", () => {
  state.level = clamp(Number($("level").value), 0, 1);
  pool.setLevel(state.level);
  $("levelOut").textContent = percent(state.level, 0);
});

$("audioButton").addEventListener("click", toggleAudio);
$("playButton").addEventListener("click", togglePlayback);
$("computationalView").addEventListener("click", () => setView("computational"));
$("iqftView").addEventListener("click", () => setView("iqft"));
$("binSlider").addEventListener("input", () => {
  setView("iqft", { announceView: false });
  setSelectedBin($("binSlider").value);
});
$("oneShotButton").addEventListener("click", () => takeShots(1));
$("shots64Button").addEventListener("click", () => takeShots(64));
$("resetButton").addEventListener("click", resetInstrument);

canvas.addEventListener("pointermove", (event) => {
  const bin = binAtCanvasPoint(event);
  if (bin === state.hoverBin) return;
  state.hoverBin = bin;
  canvas.style.cursor = bin === null ? "default" : "crosshair";
  markDirty();
});

canvas.addEventListener("pointerleave", () => {
  if (state.hoverBin === null) return;
  state.hoverBin = null;
  canvas.style.cursor = "default";
  markDirty();
});

canvas.addEventListener("pointerdown", (event) => {
  const bin = binAtCanvasPoint(event);
  if (bin === null) return;
  event.preventDefault();
  canvas.focus();
  setView("iqft", { announceView: false });
  setSelectedBin(bin, { announceSelection: true });
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
    togglePlayback();
    return;
  }
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  if (state.view === "iqft") {
    setSelectedBin(state.selectedBin + direction * (event.shiftKey ? 8 : 1), { announceSelection: true });
  } else {
    setSequenceIndex(state.sequenceIndex + direction, { strike: true, announceStep: true });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else {
    updateAudioVoices();
    markDirty();
  }
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    pool.silence();
    return;
  }
  disposed = true;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  void pool.close();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  disposed = false;
  lastFrameTime = performance.now();
  updateAudioVoices();
  markDirty();
});

if (globalThis.ResizeObserver) {
  const resizeObserver = new ResizeObserver(() => markDirty());
  resizeObserver.observe(stageWrap);
} else {
  window.addEventListener("resize", markDirty);
}

populateBaseSelect(state.base);
rebuildExperiment();
paintAudioState();
markDirty();
