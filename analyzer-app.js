import {
  clamp,
  computeRms,
  createAnalysisGraph,
  dbToUnit,
  estimatePeakFrequency,
  formatFrequency,
  frameIsDue,
  frequencyBin,
  frequencyToLogPosition,
  logPositionToFrequency,
  peakAbsolute,
  spectrogramColor,
  spectrumLogSamples,
} from "./src/analyzer.js";

const byId = (id) => document.getElementById(id);
const ui = {
  audioButton: byId("audioButton"),
  audioState: byId("audioState"),
  masterLevel: byId("masterLevel"),
  levelOut: byId("levelOut"),
  sourceTone: byId("sourceTone"),
  sourceMicrophone: byId("sourceMicrophone"),
  toneControls: byId("toneControls"),
  toneFrequency: byId("toneFrequency"),
  toneFrequencyOut: byId("toneFrequencyOut"),
  toneWaveform: byId("toneWaveform"),
  sourceNote: byId("sourceNote"),
  smoothing: byId("spectrumSmoothing"),
  smoothingOut: byId("spectrumSmoothingOut"),
  waterfallSpeed: byId("waterfallSpeed"),
  waterfallSpeedOut: byId("waterfallSpeedOut"),
  clearSpectrogram: byId("clearSpectrogram"),
  oscilloscope: byId("oscilloscope"),
  spectrum: byId("spectrum"),
  spectrogram: byId("spectrogram"),
  scopeState: byId("scopeState"),
  sourceMetric: byId("sourceMetric"),
  rmsMetric: byId("rmsMetric"),
  peakMetric: byId("peakMetric"),
  frequencyMetric: byId("frequencyMetric"),
  engineState: byId("engineState"),
  error: byId("audioError"),
  status: byId("analyzerStatus"),
};

const FFT_SIZE = 4_096;
const DISPLAY_FPS = 30;
const WATERFALL_FPS = 24;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const canvasContexts = new WeakMap();

let audioContext = null;
let analysisGraph = null;
let activeSource = null;
let audioEnabled = false;
let disposed = false;
let operationRevision = 0;
let animationFrame = 0;
let lastDisplayFrame = -Infinity;
let lastWaterfallFrame = -Infinity;
let waterfallCarry = 0;
let timeSamples = null;
let frequencySamples = null;
let resizeObserver = null;

function selectedSource() {
  return ui.sourceMicrophone.checked ? "microphone" : "tone";
}

function setAudioParam(param, value, smoothing = 0.01) {
  if (!param) return;
  const time = Number(audioContext?.currentTime) || 0;
  if (smoothing > 0 && typeof param.setTargetAtTime === "function") {
    param.setTargetAtTime(value, time, smoothing);
  } else if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

function setError(message = "") {
  ui.error.hidden = !message;
  ui.error.textContent = message;
}

function setStatus(message) {
  ui.status.textContent = message;
}

function sourceLabel(mode = selectedSource()) {
  if (mode === "microphone") return "Microphone";
  return `Test tone · ${formatFrequency(ui.toneFrequency.value)}`;
}

function updateSourceControls() {
  const mode = selectedSource();
  ui.toneControls.hidden = mode !== "tone";
  ui.sourceMetric.textContent = sourceLabel(mode);
  ui.sourceNote.textContent = mode === "microphone"
    ? "Microphone audio is analyzed locally and deliberately not sent to the speakers."
    : "Test tone is monitored at the selected master level. Start low when using headphones.";
}

function updateAudioUi() {
  ui.audioButton.setAttribute("aria-pressed", String(audioEnabled));
  ui.audioState.textContent = audioEnabled ? "on" : "off";
  ui.scopeState.hidden = audioEnabled;
  document.body.classList.toggle("is-audio-on", audioEnabled);
  ui.engineState.lastChild.textContent = audioEnabled
    ? ` ${sourceLabel()} active`
    : " Audio engine idle";
  const state = audioEnabled ? "Audio is on." : "Audio is off.";
  ui.oscilloscope.setAttribute(
    "aria-label",
    `Oscilloscope showing the limited master waveform. ${state}`,
  );
  ui.spectrum.setAttribute(
    "aria-label",
    `Log-frequency spectrum of the limited master signal. ${state}`,
  );
  ui.spectrogram.setAttribute(
    "aria-label",
    `Scrolling spectrogram of the limited master signal. ${state}`,
  );
}

function resetMetrics() {
  ui.rmsMetric.textContent = "−∞ dBFS";
  ui.peakMetric.textContent = "−∞ dBFS";
  ui.frequencyMetric.textContent = "—";
}

function canvasBox(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || 600));
  const cssHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || 260));
  const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2);
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
  if (resized) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  let context = canvasContexts.get(canvas);
  if (!context) {
    context = canvas.getContext("2d", { alpha: true });
    canvasContexts.set(canvas, context);
  }
  return {
    context,
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    dpr,
    resized,
  };
}

function clearLogicalCanvas(box) {
  const { context, cssWidth, cssHeight, dpr } = box;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
}

function drawGrid(box, { logFrequency = false } = {}) {
  const { context, cssWidth: width, cssHeight: height, dpr } = box;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.strokeStyle = "rgba(214, 232, 226, 0.075)";
  context.lineWidth = 1 / dpr;
  context.beginPath();
  for (let row = 1; row < 4; row += 1) {
    const y = (height * row) / 4;
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  if (logFrequency) {
    for (const frequency of [50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000]) {
      const x = frequencyToLogPosition(
        frequency,
        MIN_FREQUENCY,
        MAX_FREQUENCY,
      ) * width;
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
  } else {
    for (let column = 1; column < 8; column += 1) {
      const x = (width * column) / 8;
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
  }
  context.stroke();
  context.restore();
}

function drawIdleSignalCanvases() {
  for (const [canvas, logFrequency] of [
    [ui.oscilloscope, false],
    [ui.spectrum, true],
  ]) {
    const box = canvasBox(canvas);
    clearLogicalCanvas(box);
    drawGrid(box, { logFrequency });
  }
}

function clearSpectrogram() {
  const box = canvasBox(ui.spectrogram);
  const { context, pixelWidth, pixelHeight } = box;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "rgb(4 7 11)";
  context.fillRect(0, 0, pixelWidth, pixelHeight);
  waterfallCarry = 0;
}

function zeroCrossing(samples) {
  const end = Math.floor(samples.length * 0.55);
  for (let index = 1; index < end; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) return index;
  }
  return 0;
}

function drawOscilloscope(samples) {
  const box = canvasBox(ui.oscilloscope);
  const { context, cssWidth: width, cssHeight: height, dpr } = box;
  clearLogicalCanvas(box);
  drawGrid(box);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.strokeStyle = "#55d9ff";
  context.shadowColor = "rgba(85, 217, 255, 0.38)";
  context.shadowBlur = 7;
  context.lineWidth = Math.max(1, 1.35 / dpr);
  context.beginPath();
  const start = zeroCrossing(samples);
  const available = Math.max(2, samples.length - start);
  const step = available / Math.max(1, width - 1);
  for (let x = 0; x < width; x += 1) {
    const index = Math.min(samples.length - 1, start + Math.floor(x * step));
    const sample = clamp(samples[index], -1, 1);
    const y = (height * 0.5) - (sample * height * 0.44);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function drawSpectrum(decibels) {
  const box = canvasBox(ui.spectrum);
  const { context, cssWidth: width, cssHeight: height, dpr } = box;
  clearLogicalCanvas(box);
  drawGrid(box, { logFrequency: true });
  const columns = Math.max(64, Math.floor(width));
  const logSamples = spectrumLogSamples(decibels, {
    sampleRate: audioContext.sampleRate,
    fftSize: analysisGraph.analyser.fftSize,
    columns,
    minimumFrequency: MIN_FREQUENCY,
    maximumFrequency: Math.min(MAX_FREQUENCY, audioContext.sampleRate / 2),
    floorDb: analysisGraph.analyser.minDecibels,
  });
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(199, 155, 255, 0.62)");
  gradient.addColorStop(1, "rgba(85, 217, 255, 0.025)");
  context.fillStyle = gradient;
  context.strokeStyle = "#c79bff";
  context.lineWidth = Math.max(1, 1.2 / dpr);
  context.beginPath();
  context.moveTo(0, height);
  for (let index = 0; index < logSamples.length; index += 1) {
    const x = (index / Math.max(1, logSamples.length - 1)) * width;
    const unit = dbToUnit(
      logSamples[index],
      analysisGraph.analyser.minDecibels,
      analysisGraph.analyser.maxDecibels,
    );
    const y = height - (unit * height * 0.94);
    context.lineTo(x, y);
  }
  context.lineTo(width, height);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawSpectrogramColumn(decibels, cssColumns) {
  if (cssColumns < 1) return;
  const box = canvasBox(ui.spectrogram);
  const {
    context,
    pixelWidth: width,
    pixelHeight: height,
    dpr,
    resized,
  } = box;
  if (resized) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "rgb(4 7 11)";
    context.fillRect(0, 0, width, height);
  }
  const shift = Math.min(width, Math.max(1, Math.round(cssColumns * dpr)));
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (shift < width) {
    context.drawImage(
      ui.spectrogram,
      shift,
      0,
      width - shift,
      height,
      0,
      0,
      width - shift,
      height,
    );
  }

  const upper = Math.min(MAX_FREQUENCY, audioContext.sampleRate / 2);
  for (let y = 0; y < height; y += 1) {
    const logPosition = 1 - (y / Math.max(1, height - 1));
    const frequency = logPositionToFrequency(
      logPosition,
      MIN_FREQUENCY,
      upper,
    );
    const bin = frequencyBin(
      frequency,
      audioContext.sampleRate,
      analysisGraph.analyser.fftSize,
      decibels.length,
    );
    const unit = dbToUnit(
      decibels[bin],
      analysisGraph.analyser.minDecibels,
      analysisGraph.analyser.maxDecibels,
    );
    context.fillStyle = spectrogramColor(unit);
    context.fillRect(width - shift, y, shift, 1);
  }
}

function amplitudeText(value) {
  if (!(value > 0.00001)) return "−∞ dBFS";
  return `${Math.max(-120, 20 * Math.log10(value)).toFixed(1)} dBFS`;
}

function updateMetrics() {
  const rms = computeRms(timeSamples);
  const peak = peakAbsolute(timeSamples);
  const strongest = estimatePeakFrequency(
    frequencySamples,
    audioContext.sampleRate,
    analysisGraph.analyser.fftSize,
    {
      minimumFrequency: MIN_FREQUENCY,
      maximumFrequency: Math.min(MAX_FREQUENCY, audioContext.sampleRate / 2),
    },
  );
  ui.rmsMetric.textContent = amplitudeText(rms);
  ui.peakMetric.textContent = amplitudeText(peak);
  ui.frequencyMetric.textContent = strongest > 0 ? formatFrequency(strongest) : "—";
}

function scheduleVisualization() {
  if (
    animationFrame
    || !audioEnabled
    || disposed
    || document.hidden
  ) return;
  animationFrame = requestAnimationFrame(renderVisualization);
}

function renderVisualization(timestamp) {
  animationFrame = 0;
  if (!audioEnabled || disposed || document.hidden || !analysisGraph) return;

  const displayDue = frameIsDue(timestamp, lastDisplayFrame, DISPLAY_FPS);
  const waterfallDue = frameIsDue(timestamp, lastWaterfallFrame, WATERFALL_FPS);
  if (displayDue || waterfallDue) {
    analysisGraph.analyser.getFloatFrequencyData(frequencySamples);
  }
  if (displayDue) {
    analysisGraph.analyser.getFloatTimeDomainData(timeSamples);
    drawOscilloscope(timeSamples);
    drawSpectrum(frequencySamples);
    updateMetrics();
    lastDisplayFrame = timestamp;
  }
  if (waterfallDue) {
    const elapsed = Number.isFinite(lastWaterfallFrame)
      ? clamp((timestamp - lastWaterfallFrame) / 1_000, 0, 0.25)
      : 1 / WATERFALL_FPS;
    waterfallCarry += Number(ui.waterfallSpeed.value) * elapsed;
    const columns = Math.floor(waterfallCarry);
    waterfallCarry -= columns;
    drawSpectrogramColumn(frequencySamples, columns);
    lastWaterfallFrame = timestamp;
  }
  scheduleVisualization();
}

async function ensureAudioGraph() {
  if (audioContext && analysisGraph) return;
  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not available in this browser.");
  }
  audioContext = new AudioContextConstructor({ latencyHint: "interactive" });
  analysisGraph = createAnalysisGraph(audioContext, {
    level: Number(ui.masterLevel.value),
    fftSize: FFT_SIZE,
    smoothing: Number(ui.smoothing.value),
  });
  timeSamples = new Float32Array(analysisGraph.analyser.fftSize);
  frequencySamples = new Float32Array(analysisGraph.analyser.frequencyBinCount);
}

function stopActiveSource() {
  if (!activeSource) return;
  try {
    activeSource.oscillator?.stop();
  } catch {
    // An oscillator may already have reached its stopped state.
  }
  for (const node of [activeSource.oscillator, activeSource.gain, activeSource.node]) {
    try {
      node?.disconnect();
    } catch {
      // A partially disconnected source is already silent.
    }
  }
  for (const track of activeSource.stream?.getTracks?.() ?? []) track.stop();
  activeSource = null;
}

function startTestTone() {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = ui.toneWaveform.value;
  setAudioParam(oscillator.frequency, Number(ui.toneFrequency.value), 0);
  setAudioParam(gain.gain, 0.16, 0);
  oscillator.connect(gain);
  gain.connect(analysisGraph.input);
  analysisGraph.setMonitoring(true);
  oscillator.start();
  activeSource = { oscillator, gain, mode: "tone" };
}

async function startMicrophone(revision) {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    video: false,
  });
  if (
    revision !== operationRevision
    || !audioEnabled
    || disposed
  ) {
    for (const track of stream.getTracks()) track.stop();
    return false;
  }
  const node = audioContext.createMediaStreamSource(stream);
  const gain = audioContext.createGain();
  setAudioParam(gain.gain, 1, 0);
  node.connect(gain);
  gain.connect(analysisGraph.input);
  analysisGraph.setMonitoring(false);
  activeSource = { node, gain, stream, mode: "microphone" };
  return true;
}

async function activateSelectedSource() {
  const revision = ++operationRevision;
  stopActiveSource();
  analysisGraph?.setMonitoring(false);
  await ensureAudioGraph();
  if (audioContext.state === "suspended") await audioContext.resume();
  if (revision !== operationRevision || !audioEnabled || disposed) return;

  if (selectedSource() === "microphone") {
    const started = await startMicrophone(revision);
    if (!started) return;
  } else {
    startTestTone();
  }
  if (revision !== operationRevision || !audioEnabled || disposed) {
    stopActiveSource();
    return;
  }
  lastDisplayFrame = -Infinity;
  lastWaterfallFrame = -Infinity;
  ui.audioButton.disabled = false;
  updateAudioUi();
  setStatus(`${sourceLabel()} active. Audio is on.`);
  scheduleVisualization();
}

async function stopAudio({ closeContext = false } = {}) {
  ++operationRevision;
  audioEnabled = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  stopActiveSource();
  analysisGraph?.setMonitoring(false);
  updateAudioUi();
  resetMetrics();
  drawIdleSignalCanvases();
  setStatus("Analyzer ready. Audio is off.");
  if (closeContext) {
    analysisGraph?.disconnect();
    analysisGraph = null;
    const closingContext = audioContext;
    audioContext = null;
    try {
      await closingContext?.close?.();
    } catch {
      // Page teardown should finish even if the browser already closed audio.
    }
  } else if (audioContext?.state === "running") {
    try {
      await audioContext.suspend();
    } catch {
      // The visible off state is already silent because its source was stopped.
    }
  }
}

async function toggleAudio() {
  if (ui.audioButton.disabled || disposed) return;
  setError();
  ui.audioButton.disabled = true;
  if (audioEnabled) {
    await stopAudio();
    ui.audioButton.disabled = false;
    return;
  }

  audioEnabled = true;
  updateAudioUi();
  try {
    await activateSelectedSource();
  } catch (error) {
    const mode = selectedSource();
    await stopAudio();
    setError(mode === "microphone"
      ? "Microphone access could not start. Check this site's permission, then try Audio again."
      : (error?.message || "Audio could not start."));
    setStatus("Audio could not start.");
    ui.audioButton.disabled = false;
  }
}

async function changeSource() {
  updateSourceControls();
  setError();
  if (!audioEnabled) {
    setStatus(`${sourceLabel()} selected. Press Audio to begin.`);
    return;
  }
  ui.audioButton.disabled = true;
  try {
    await activateSelectedSource();
  } catch {
    await stopAudio();
    setError(
      selectedSource() === "microphone"
        ? "Microphone access could not start. Check this site's permission, then try Audio again."
        : "The selected source could not start.",
    );
    ui.audioButton.disabled = false;
  }
}

function updateToneFrequency() {
  const frequency = Number(ui.toneFrequency.value);
  ui.toneFrequencyOut.textContent = formatFrequency(frequency);
  ui.sourceMetric.textContent = sourceLabel();
  if (activeSource?.mode === "tone") {
    setAudioParam(activeSource.oscillator.frequency, frequency, 0.01);
    setStatus(`${sourceLabel()} active. Audio is on.`);
  }
}

function updateToneWaveform() {
  if (activeSource?.mode === "tone") activeSource.oscillator.type = ui.toneWaveform.value;
}

function installEvents() {
  ui.audioButton.addEventListener("click", toggleAudio);
  ui.masterLevel.addEventListener("input", () => {
    ui.levelOut.textContent = `${Math.round(Number(ui.masterLevel.value) * 100)}%`;
    analysisGraph?.setLevel(Number(ui.masterLevel.value));
  });
  ui.sourceTone.addEventListener("change", changeSource);
  ui.sourceMicrophone.addEventListener("change", changeSource);
  ui.toneFrequency.addEventListener("input", updateToneFrequency);
  ui.toneWaveform.addEventListener("change", updateToneWaveform);
  ui.smoothing.addEventListener("input", () => {
    ui.smoothingOut.textContent = `${Math.round(Number(ui.smoothing.value) * 100)}%`;
    analysisGraph?.setSmoothing(Number(ui.smoothing.value));
  });
  ui.waterfallSpeed.addEventListener("input", () => {
    ui.waterfallSpeedOut.textContent = `${Math.round(Number(ui.waterfallSpeed.value))} px/s`;
  });
  ui.clearSpectrogram.addEventListener("click", clearSpectrogram);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else {
      lastDisplayFrame = -Infinity;
      lastWaterfallFrame = -Infinity;
      scheduleVisualization();
    }
  });
  globalThis.addEventListener("pagehide", () => {
    disposed = true;
    stopAudio({ closeContext: true });
    resizeObserver?.disconnect();
  }, { once: true });
}

function initializeCanvasSizing() {
  drawIdleSignalCanvases();
  clearSpectrogram();
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      if (!audioEnabled) drawIdleSignalCanvases();
      const spectrogramBox = canvasBox(ui.spectrogram);
      if (spectrogramBox.resized) clearSpectrogram();
    });
    for (const canvas of [ui.oscilloscope, ui.spectrum, ui.spectrogram]) {
      resizeObserver.observe(canvas);
    }
  }
}

updateSourceControls();
updateToneFrequency();
updateAudioUi();
resetMetrics();
initializeCanvasSizing();
installEvents();
