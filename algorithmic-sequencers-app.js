import {
  SEARCH_ALGORITHM_PRESETS,
  SEARCH_DATA_CURVES,
  deriveSearchStepTone,
  formatSearchComparison,
  generateSearchSequence,
  sanitizeSearchSequencerParams,
} from "./src/algorithmic-sequencers.js";

const $ = (id) => document.getElementById(id);
const FRAME_INTERVAL = 1_000 / 30;
const DEFAULTS = sanitizeSearchSequencerParams({
  algorithmId: "binary",
  curveId: "linear",
  size: 48,
  targetIndex: 34,
  tempo: 8,
  baseFrequencyHz: 180,
  pitchSpanOctaves: 3.2,
  noteSeconds: 0.11,
  output: 0.48,
});

const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const stageWrap = $("stageWrap");
const audioButton = $("audioButton");
const audioState = $("audioState");
const liveStatus = $("liveStatus");
const stageReadout = $("stageReadout");

const controls = {
  arraySize: $("arraySize"),
  arraySizeOut: $("arraySizeOut"),
  targetIndex: $("targetIndex"),
  targetIndexOut: $("targetIndexOut"),
  tempo: $("tempo"),
  tempoOut: $("tempoOut"),
  baseFrequency: $("baseFrequency"),
  baseFrequencyOut: $("baseFrequencyOut"),
  pitchSpan: $("pitchSpan"),
  pitchSpanOut: $("pitchSpanOut"),
  noteLength: $("noteLength"),
  noteLengthOut: $("noteLengthOut"),
  output: $("output"),
  outputOut: $("outputOut"),
  sequenceProgress: $("sequenceProgress"),
  sequenceProgressOut: $("sequenceProgressOut"),
};

const readouts = {
  algorithmState: $("algorithmState"),
  transportState: $("transportState"),
  dataState: $("dataState"),
  soundState: $("soundState"),
  presetDescription: $("presetDescription"),
  targetReadout: $("targetReadout"),
  probeReadout: $("probeReadout"),
  rangeReadout: $("rangeReadout"),
  comparisonReadout: $("comparisonReadout"),
  stepsReadout: $("stepsReadout"),
  signatureReadout: $("signatureReadout"),
};

const buttons = {
  play: $("playButton"),
  step: $("stepButton"),
  restart: $("restartSequence"),
  randomTarget: $("randomTarget"),
  randomInput: $("randomInput"),
  reset: $("resetSequencer"),
};

const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;

const state = {
  settings: { ...DEFAULTS },
  sequence: generateSearchSequence(DEFAULTS),
  cursor: -1,
  playing: false,
  audioOn: false,
  audioStarting: false,
  lastAdvanceTime: 0,
  lastDrawTime: -Infinity,
  pixelRatio: 1,
  cssWidth: 1,
  cssHeight: 1,
  audioContext: null,
  masterGain: null,
  disposed: false,
};

let frameId = null;

function compactNumber(value, maximumDigits = 2) {
  return Number(value).toFixed(maximumDigits).replace(/0+$/, "").replace(/\.$/, "");
}

function algorithmById(id) {
  return SEARCH_ALGORITHM_PRESETS.find((algorithm) => algorithm.id === id)
    ?? SEARCH_ALGORITHM_PRESETS[1];
}

function curveById(id) {
  return SEARCH_DATA_CURVES.find((curve) => curve.id === id) ?? SEARCH_DATA_CURVES[0];
}

function createRandomDataSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(values);
  return values[0] || Math.floor(Math.random() * 0xffff_ffff) || 1;
}

function activeStep() {
  if (state.cursor < 0) return null;
  return state.sequence.steps[state.cursor] ?? null;
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

function updateAudioStatus() {
  setPressed(audioButton, state.audioOn);
  audioButton.disabled = state.audioStarting;
  setText(audioState, state.audioOn ? "on" : "off");
  if (state.masterGain) {
    state.masterGain.gain.setTargetAtTime(
      state.audioOn ? state.settings.output : 0,
      state.audioContext.currentTime,
      0.018,
    );
  }
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || 1));
  const height = Math.max(1, Math.floor(rect.height || 1));
  const pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || globalThis.window?.devicePixelRatio || 1));
  if (
    canvas.width !== Math.floor(width * pixelRatio)
    || canvas.height !== Math.floor(height * pixelRatio)
  ) {
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
  }
  state.cssWidth = width;
  state.cssHeight = height;
  state.pixelRatio = pixelRatio;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function updateControlValues() {
  const settings = state.settings;
  controls.arraySize.value = String(settings.size);
  controls.arraySizeOut.value = `${settings.size} cells`;
  controls.targetIndex.max = String(settings.size - 1);
  controls.targetIndex.value = String(settings.targetIndex);
  controls.targetIndexOut.value = `#${settings.targetIndex}`;
  controls.tempo.value = String(settings.tempo);
  controls.tempoOut.value = `${compactNumber(settings.tempo, 1)} steps/s`;
  controls.baseFrequency.value = String(settings.baseFrequencyHz);
  controls.baseFrequencyOut.value = `${Math.round(settings.baseFrequencyHz)} Hz`;
  controls.pitchSpan.value = String(settings.pitchSpanOctaves);
  controls.pitchSpanOut.value = `${compactNumber(settings.pitchSpanOctaves, 1)} oct`;
  controls.noteLength.value = String(settings.noteSeconds);
  controls.noteLengthOut.value = `${Math.round(settings.noteSeconds * 1000)} ms`;
  controls.output.value = String(settings.output);
  controls.outputOut.value = `${Math.round(settings.output * 100)}%`;
  controls.sequenceProgress.max = String(Math.max(0, state.sequence.steps.length - 1));
  controls.sequenceProgress.value = String(Math.max(0, state.cursor));
  controls.sequenceProgressOut.value = state.cursor < 0
    ? "ready"
    : `${state.cursor + 1}/${state.sequence.steps.length}`;
}

function updateButtonGroups() {
  document.querySelectorAll("[data-algorithm]").forEach((button) => {
    setPressed(button, button.dataset.algorithm === state.settings.algorithmId);
  });
  document.querySelectorAll("[data-curve]").forEach((button) => {
    setPressed(button, button.dataset.curve === state.settings.curveId);
  });
}

function updateReadouts() {
  const algorithm = state.sequence.algorithm;
  const curve = state.sequence.curve;
  const step = activeStep();
  const hitText = state.sequence.foundStepIndex >= 0
    ? `${state.sequence.foundStepIndex + 1} probes`
    : "not found";
  const targetValue = compactNumber(state.sequence.targetValue, 3);

  setText(readouts.algorithmState, `${algorithm.shortLabel} - ${hitText}`);
  setText(readouts.transportState, state.playing ? "running" : "paused");
  setText(readouts.dataState, `${state.settings.size} cells - ${curve.label}`);
  setText(readouts.soundState, `${Math.round(state.settings.baseFrequencyHz)} Hz - ${compactNumber(state.settings.pitchSpanOctaves, 1)} oct`);
  setText(readouts.presetDescription, algorithm.description);
  setText(readouts.targetReadout, `#${state.settings.targetIndex} - ${targetValue}`);
  setText(readouts.probeReadout, step ? `#${step.index} - ${compactNumber(step.value, 3)}` : "ready");
  setText(readouts.rangeReadout, step ? `${step.low} to ${step.high}` : `0 to ${state.settings.size - 1}`);
  setText(readouts.comparisonReadout, formatSearchComparison(step));
  setText(readouts.stepsReadout, `${state.sequence.steps.length} probes`);
  setText(readouts.signatureReadout, algorithm.signature);
  setText(stageReadout, `${algorithm.shortLabel.toUpperCase()} - ${state.cursor < 0 ? "READY" : `STEP ${state.cursor + 1}/${state.sequence.steps.length}`} - AUDIO ${state.audioOn ? "ON" : "OFF"}`);
  setText(liveStatus, step ? `${algorithm.label}: ${formatSearchComparison(step)}` : `${algorithm.label} ready`);
  setPressed(buttons.play, state.playing);
  updateControlValues();
  updateButtonGroups();
  updateAudioStatus();
}

function regenerateSequence({ keepCursor = false } = {}) {
  state.settings = { ...sanitizeSearchSequencerParams(state.settings) };
  state.sequence = generateSearchSequence(state.settings);
  if (keepCursor) {
    state.cursor = Math.min(state.cursor, state.sequence.steps.length - 1);
  } else {
    state.cursor = -1;
  }
  updateReadouts();
}

function setSettings(patch, options) {
  const next = sanitizeSearchSequencerParams({
    ...state.settings,
    ...patch,
  });
  state.settings = { ...next };
  regenerateSequence(options);
}

function stopPlayback() {
  state.playing = false;
  state.lastAdvanceTime = 0;
  updateReadouts();
}

function advanceTo(index, { audible = false } = {}) {
  const lastIndex = state.sequence.steps.length - 1;
  state.cursor = Math.max(0, Math.min(lastIndex, Math.round(index)));
  const step = activeStep();
  if (audible && step) playStepTone(step);
  if (step?.found || state.cursor >= lastIndex) {
    state.playing = false;
    state.lastAdvanceTime = 0;
  }
  updateReadouts();
}

function stepOnce() {
  if (state.playing) stopPlayback();
  const nextIndex = state.cursor >= state.sequence.steps.length - 1
    ? 0
    : state.cursor + 1;
  advanceTo(nextIndex, { audible: true });
}

function restartSequence() {
  stopPlayback();
  state.cursor = -1;
  updateReadouts();
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  if (state.cursor >= state.sequence.steps.length - 1) state.cursor = -1;
  state.playing = true;
  state.lastAdvanceTime = 0;
  advanceTo(state.cursor + 1, { audible: true });
  updateReadouts();
}

async function ensureAudioContext() {
  if (state.audioContext) return state.audioContext;
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
  const audioContext = new AudioContextClass();
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);
  state.audioContext = audioContext;
  state.masterGain = masterGain;
  return audioContext;
}

async function toggleAudio() {
  if (state.audioOn) {
    state.audioOn = false;
    updateReadouts();
    return;
  }
  state.audioStarting = true;
  updateReadouts();
  try {
    const audioContext = await ensureAudioContext();
    await audioContext.resume?.();
    state.audioOn = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio could not start.";
    setText(liveStatus, message);
    state.audioOn = false;
  } finally {
    state.audioStarting = false;
    updateReadouts();
  }
}

function connectWithOptionalPanner(source, gain, panValue) {
  if (state.audioContext.createStereoPanner) {
    const panner = state.audioContext.createStereoPanner();
    panner.pan.value = panValue;
    source.connect(gain).connect(panner).connect(state.masterGain);
    return panner;
  }
  source.connect(gain).connect(state.masterGain);
  return gain;
}

function playOscillator({
  frequencyHz,
  gain,
  durationSeconds,
  pan,
  type = "sine",
  delaySeconds = 0,
}) {
  if (!state.audioContext || !state.masterGain) return;
  const audioContext = state.audioContext;
  const startTime = audioContext.currentTime + delaySeconds;
  const endTime = startTime + durationSeconds;
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequencyHz, startTime);
  envelope.gain.setValueAtTime(0, startTime);
  envelope.gain.linearRampToValueAtTime(gain, startTime + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, endTime);
  connectWithOptionalPanner(oscillator, envelope, pan);
  oscillator.start(startTime);
  oscillator.stop(endTime + 0.03);
}

function playStepTone(step) {
  if (!state.audioOn || !state.audioContext) return;
  const tone = deriveSearchStepTone(step, state.settings);
  playOscillator({
    frequencyHz: tone.frequencyHz,
    gain: tone.gain,
    durationSeconds: tone.durationSeconds,
    pan: tone.pan,
    type: step.found ? "triangle" : "sine",
  });
  playOscillator({
    frequencyHz: tone.targetFrequencyHz,
    gain: step.found ? tone.gain * 0.54 : tone.gain * 0.28,
    durationSeconds: tone.durationSeconds * 0.82,
    pan: 0,
    type: "triangle",
    delaySeconds: step.found ? 0.035 : 0,
  });
}

function drawText(text, x, y, color, size = 10, align = "left") {
  context2d.fillStyle = color;
  context2d.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context2d.textAlign = align;
  context2d.textBaseline = "middle";
  context2d.fillText(text, x, y);
}

function drawStage(now) {
  resizeCanvas();
  const width = state.cssWidth;
  const height = state.cssHeight;
  const step = activeStep();
  const values = state.sequence.values;
  const targetIndex = state.sequence.targetIndex;
  const padX = Math.max(34, Math.min(70, width * 0.06));
  const top = Math.max(84, height * 0.16);
  const bottom = Math.max(70, height * 0.13);
  const plotWidth = Math.max(1, width - padX * 2);
  const plotHeight = Math.max(1, height - top - bottom);
  const baseY = top + plotHeight;
  const accent = "#8de7ff";
  const gold = "#e8c46b";
  const violet = "#c79bff";
  const ink = "#dbe4e0";
  const muted = "rgba(219, 228, 224, 0.45)";
  const faint = "rgba(219, 228, 224, 0.12)";
  const currentPulse = reducedMotion ? 0.65 : 0.55 + Math.sin(now * 0.012) * 0.18;

  context2d.clearRect(0, 0, width, height);
  context2d.save();

  context2d.strokeStyle = faint;
  context2d.lineWidth = 1;
  for (let line = 0; line <= 4; line += 1) {
    const y = top + (plotHeight * line) / 4;
    context2d.beginPath();
    context2d.moveTo(padX, y);
    context2d.lineTo(width - padX, y);
    context2d.stroke();
  }

  if (step) {
    const lowX = padX + (plotWidth * step.low) / Math.max(1, values.length - 1);
    const highX = padX + (plotWidth * step.high) / Math.max(1, values.length - 1);
    context2d.fillStyle = "rgba(141, 231, 255, 0.07)";
    context2d.fillRect(lowX, top, Math.max(2, highX - lowX), plotHeight);
    context2d.strokeStyle = "rgba(141, 231, 255, 0.42)";
    context2d.beginPath();
    context2d.moveTo(lowX, top - 12);
    context2d.lineTo(highX, top - 12);
    context2d.moveTo(lowX, top - 17);
    context2d.lineTo(lowX, top - 6);
    context2d.moveTo(highX, top - 17);
    context2d.lineTo(highX, top - 6);
    context2d.stroke();
  }

  const targetX = padX + (plotWidth * targetIndex) / Math.max(1, values.length - 1);
  context2d.strokeStyle = "rgba(232, 196, 107, 0.62)";
  context2d.beginPath();
  context2d.moveTo(targetX, top - 24);
  context2d.lineTo(targetX, baseY + 14);
  context2d.stroke();

  const barWidth = Math.max(2, Math.min(10, plotWidth / values.length * 0.62));
  const history = new Set(
    state.sequence.steps.slice(0, Math.max(0, state.cursor + 1)).map((entry) => entry.index),
  );
  for (let index = 0; index < values.length; index += 1) {
    const x = padX + (plotWidth * index) / Math.max(1, values.length - 1);
    const barHeight = Math.max(2, values[index] * (plotHeight - 12));
    const isTarget = index === targetIndex;
    const isCurrent = step?.index === index;
    const isHistory = history.has(index);
    context2d.fillStyle = isCurrent
      ? `rgba(141, 231, 255, ${currentPulse})`
      : isTarget
        ? "rgba(232, 196, 107, 0.82)"
        : isHistory
          ? "rgba(199, 155, 255, 0.46)"
          : "rgba(219, 228, 224, 0.25)";
    context2d.fillRect(x - barWidth / 2, baseY - barHeight, barWidth, barHeight);
  }

  if (step) {
    const x = padX + (plotWidth * step.index) / Math.max(1, values.length - 1);
    const y = baseY - step.value * (plotHeight - 12);
    context2d.strokeStyle = step.found ? gold : accent;
    context2d.fillStyle = step.found ? "rgba(232, 196, 107, 0.2)" : "rgba(141, 231, 255, 0.14)";
    context2d.lineWidth = 1.5;
    context2d.beginPath();
    context2d.arc(x, y, step.found ? 18 : 13, 0, Math.PI * 2);
    context2d.fill();
    context2d.stroke();
    context2d.beginPath();
    context2d.moveTo(x, y);
    context2d.lineTo(targetX, baseY + 28);
    context2d.strokeStyle = "rgba(232, 196, 107, 0.28)";
    context2d.stroke();
  }

  const railY = height - 42;
  const railStart = padX;
  const railEnd = width - padX;
  context2d.strokeStyle = "rgba(219, 228, 224, 0.16)";
  context2d.beginPath();
  context2d.moveTo(railStart, railY);
  context2d.lineTo(railEnd, railY);
  context2d.stroke();
  state.sequence.steps.forEach((entry, index) => {
    const x = railStart + ((railEnd - railStart) * index) / Math.max(1, state.sequence.steps.length - 1);
    context2d.fillStyle = index <= state.cursor
      ? entry.found
        ? gold
        : violet
      : "rgba(219, 228, 224, 0.2)";
    context2d.beginPath();
    context2d.arc(x, railY, entry.found ? 4.2 : 2.8, 0, Math.PI * 2);
    context2d.fill();
  });

  drawText("target", targetX, baseY + 32, gold, 9, "center");
  if (width > 620) {
    drawText(state.sequence.algorithm.label.toUpperCase(), width - padX, top - 36, muted, 10, "right");
  }
  drawText(formatSearchComparison(step).toUpperCase(), padX, height - 20, ink, 10);
  drawText(`${state.sequence.steps.length} PROBES`, width - padX, height - 20, muted, 10, "right");

  context2d.restore();
}

function animationFrame(now) {
  frameId = null;
  if (state.disposed) return;
  if (state.playing) {
    const interval = 1_000 / state.settings.tempo;
    if (!state.lastAdvanceTime) state.lastAdvanceTime = now;
    if (now - state.lastAdvanceTime >= interval) {
      const skipped = Math.min(4, Math.floor((now - state.lastAdvanceTime) / interval));
      for (let count = 0; count < skipped && state.playing; count += 1) {
        advanceTo(state.cursor + 1, { audible: true });
      }
      state.lastAdvanceTime = now;
    }
  }
  if (now - state.lastDrawTime >= FRAME_INTERVAL || state.playing) {
    drawStage(now);
    state.lastDrawTime = now;
  }
  frameId = requestAnimationFrame(animationFrame);
}

function installEventHandlers() {
  audioButton.addEventListener("click", toggleAudio);
  buttons.play.addEventListener("click", togglePlayback);
  buttons.step.addEventListener("click", stepOnce);
  buttons.restart.addEventListener("click", restartSequence);
  buttons.randomTarget.addEventListener("click", () => {
    const targetIndex = Math.floor(Math.random() * state.settings.size);
    setSettings({ targetIndex });
  });
  buttons.randomInput.addEventListener("click", () => {
    stopPlayback();
    setSettings({
      curveId: "random",
      dataSeed: createRandomDataSeed(),
    });
  });
  buttons.reset.addEventListener("click", () => {
    state.settings = { ...DEFAULTS };
    stopPlayback();
    regenerateSequence();
  });

  document.querySelectorAll("[data-algorithm]").forEach((button) => {
    button.addEventListener("click", () => {
      stopPlayback();
      setSettings({ algorithmId: button.dataset.algorithm });
    });
  });
  document.querySelectorAll("[data-curve]").forEach((button) => {
    button.addEventListener("click", () => {
      stopPlayback();
      setSettings({
        curveId: button.dataset.curve,
        ...(button.dataset.curve === "random" ? { dataSeed: createRandomDataSeed() } : {}),
      });
    });
  });

  controls.arraySize.addEventListener("input", () => {
    const size = Number(controls.arraySize.value);
    setSettings({
      size,
      targetIndex: Math.min(state.settings.targetIndex, size - 1),
    });
  });
  controls.targetIndex.addEventListener("input", () => {
    setSettings({ targetIndex: Number(controls.targetIndex.value) });
  });
  controls.tempo.addEventListener("input", () => {
    setSettings({ tempo: Number(controls.tempo.value) }, { keepCursor: true });
  });
  controls.baseFrequency.addEventListener("input", () => {
    setSettings({ baseFrequencyHz: Number(controls.baseFrequency.value) }, { keepCursor: true });
  });
  controls.pitchSpan.addEventListener("input", () => {
    setSettings({ pitchSpanOctaves: Number(controls.pitchSpan.value) }, { keepCursor: true });
  });
  controls.noteLength.addEventListener("input", () => {
    setSettings({ noteSeconds: Number(controls.noteLength.value) }, { keepCursor: true });
  });
  controls.output.addEventListener("input", () => {
    setSettings({ output: Number(controls.output.value) }, { keepCursor: true });
  });
  controls.sequenceProgress.addEventListener("input", () => {
    stopPlayback();
    advanceTo(Number(controls.sequenceProgress.value), { audible: false });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPlayback();
  });
  globalThis.addEventListener?.("pagehide", () => {
    state.disposed = true;
    if (frameId !== null) cancelAnimationFrame(frameId);
    state.audioOn = false;
    state.audioContext?.close?.();
  });
}

function populateStaticLabels() {
  document.querySelectorAll("[data-algorithm]").forEach((button) => {
    const algorithm = algorithmById(button.dataset.algorithm);
    button.title = `${algorithm.label}: ${algorithm.signature}`;
  });
  document.querySelectorAll("[data-curve]").forEach((button) => {
    const curve = curveById(button.dataset.curve);
    button.title = curve.description;
  });
}

function start() {
  populateStaticLabels();
  installEventHandlers();
  regenerateSequence();
  resizeCanvas();
  drawStage(0);
  frameId = requestAnimationFrame(animationFrame);
}

start();
