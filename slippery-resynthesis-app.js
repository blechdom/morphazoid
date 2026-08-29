import {
  SLIPPERY_RESYNTHESIS_DEFAULTS,
  SLIPPERY_RESYNTHESIS_FFT_SIZE,
  SLIPPERY_RESYNTHESIS_LIMITS,
  SLIPPERY_RESYNTHESIS_PRESETS,
  SlipperyResynthesisAudio,
  sanitizeSlipperyResynthesisParams,
  slipperyGlidePhase,
  slipperyHann,
  wrapUnit,
} from "./src/slippery-resynthesis.js";

const $ = (id) => document.getElementById(id);
const audio = new SlipperyResynthesisAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const reducedMotion = (
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
);
const firstPreset = SLIPPERY_RESYNTHESIS_PRESETS[0];

const state = {
  settings: {
    ...sanitizeSlipperyResynthesisParams({
      ...SLIPPERY_RESYNTHESIS_DEFAULTS,
      ...firstPreset.settings,
    }),
  },
  preset: firstPreset.id,
  source: "microphone",
  loopFile: true,
  fileUrl: null,
  fileLabel: null,
  audioOn: false,
  visualPhase: 0.117,
};

const inputSpectrum = new Float32Array(SLIPPERY_RESYNTHESIS_FFT_SIZE / 2);
const outputSpectrum = new Float32Array(SLIPPERY_RESYNTHESIS_FFT_SIZE / 2);
inputSpectrum.fill(-100);
outputSpectrum.fill(-100);

let canvasWidth = 1;
let canvasHeight = 1;
let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = 0;
let sourceTransition = false;
let disposed = false;

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function formatFrequency(frequency) {
  if (frequency >= 1_000) {
    return `${(frequency / 1_000).toFixed(frequency % 1_000 === 0 ? 1 : 1)} kHz`;
  }
  return `${Math.round(frequency)} Hz`;
}

function formatRate(rate) {
  return `${rate < 0.1 ? rate.toFixed(3) : rate.toFixed(2)} oct/s`;
}

function coherenceLabel(value) {
  if (value >= 0.995) return "locked";
  if (value <= 0.08) return "loose";
  return `${Math.round(value * 100)}% locked`;
}

function signedSemitones(octaves) {
  const semitones = Math.round(octaves * 12);
  return `${semitones > 0 ? "+" : ""}${semitones} st`;
}

function glideShapeLabel(value) {
  if (Math.abs(value) < 0.025) return "linear";
  return value < 0
    ? `${Math.round(Math.abs(value) * 100)}% edge linger`
    : `${Math.round(value * 100)}% center linger`;
}

function tiltLabel(value) {
  if (Math.abs(value) < 0.05) return "flat";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB/oct`;
}

function selectedSource() {
  if (state.source === "microphone") return { kind: "microphone" };
  if (!state.fileUrl) {
    throw new Error(
      "Choose a local audio file, or select Mic, before switching Audio on.",
    );
  }
  return { kind: "file", element: $("fileAudio") };
}

function updateAudioParameters() {
  state.settings = { ...audio.setParameters(state.settings) };
}

function updateInterface({ drawNow = true } = {}) {
  const settings = state.settings;
  const rising = settings.direction > 0;
  const sourceLabel = state.source === "microphone" ? "MIC" : "FILE";
  const oscillatorCount = settings.bandCount * settings.bankWidth;

  setPressed($("audioButton"), state.audioOn);
  setPressed($("sourceMic"), state.source === "microphone");
  setPressed($("sourceFile"), state.source === "file");
  setPressed($("loopFile"), state.loopFile);
  setPressed($("directionUp"), rising);
  setPressed($("directionDown"), !rising);
  setPressed($("trackingLive"), !settings.hold);
  setPressed($("trackingHold"), settings.hold);

  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("outputLevel").value = String(settings.outputLevel);
  $("slipRate").value = String(settings.slipRate);
  $("bankWidth").value = String(settings.bankWidth);
  $("coherence").value = String(settings.coherence);
  $("bandCount").max = String(Math.min(
    SLIPPERY_RESYNTHESIS_LIMITS.maxBands,
    Math.floor(
      SLIPPERY_RESYNTHESIS_LIMITS.maxOscillators / settings.bankWidth,
    ),
  ));
  $("bandCount").value = String(settings.bandCount);
  $("response").value = String(Math.round(settings.response * 1_000));
  $("consonantDetail").value = String(settings.consonantDetail);
  $("transpose").value = String(Math.round(settings.transpose * 12));
  $("glideShape").value = String(settings.glideShape);
  $("spectralTilt").value = String(settings.spectralTilt);
  $("carrierColor").value = String(settings.carrierColor);
  $("stereoWidth").value = String(settings.stereoWidth);
  $("gate").value = String(settings.gateDb);
  $("highFrequency").value = String(settings.highFrequency);
  $("dryWet").value = String(settings.dryWet);
  $("inputGain").value = String(settings.inputGain);

  $("outputLevelOut").textContent = `${Math.round(settings.outputLevel * 100)}%`;
  $("slipRateOut").textContent = formatRate(settings.slipRate);
  $("bankWidthOut").textContent = String(settings.bankWidth);
  $("coherenceOut").textContent = coherenceLabel(settings.coherence);
  $("bandCountOut").textContent = String(settings.bandCount);
  $("responseOut").textContent = `${Math.round(settings.response * 1_000)} ms`;
  $("consonantDetailOut").textContent = `${Math.round(settings.consonantDetail * 100)}%`;
  $("transposeOut").textContent = signedSemitones(settings.transpose);
  $("glideShapeOut").textContent = glideShapeLabel(settings.glideShape);
  $("spectralTiltOut").textContent = tiltLabel(settings.spectralTilt);
  $("carrierColorOut").textContent = `${Math.round(settings.carrierColor * 100)}%`;
  $("stereoWidthOut").textContent = `${Math.round(settings.stereoWidth * 100)}%`;
  $("gateOut").textContent = `−${Math.abs(Math.round(settings.gateDb))} dB`;
  $("highFrequencyOut").textContent = formatFrequency(settings.highFrequency);
  $("dryWetOut").textContent = `${Math.round(settings.dryWet * 100)}% slip`;
  $("inputGainOut").textContent = `${Math.round(settings.inputGain * 100)}%`;

  $("slipRate").setAttribute(
    "aria-valuetext",
    `${settings.slipRate.toFixed(2)} octaves per second`,
  );
  $("coherence").setAttribute(
    "aria-valuetext",
    coherenceLabel(settings.coherence),
  );
  $("response").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.response * 1_000)} milliseconds`,
  );
  $("consonantDetail").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.consonantDetail * 100)} percent`,
  );
  $("transpose").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.transpose * 12)} semitones`,
  );
  $("glideShape").setAttribute(
    "aria-valuetext",
    glideShapeLabel(settings.glideShape),
  );
  $("spectralTilt").setAttribute(
    "aria-valuetext",
    tiltLabel(settings.spectralTilt),
  );
  $("carrierColor").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.carrierColor * 100)} percent harmonic color`,
  );
  $("stereoWidth").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.stereoWidth * 100)} percent stereo width`,
  );
  $("gate").setAttribute(
    "aria-valuetext",
    `minus ${Math.abs(Math.round(settings.gateDb))} decibels`,
  );
  $("highFrequency").setAttribute(
    "aria-valuetext",
    formatFrequency(settings.highFrequency),
  );

  $("motionSummary").textContent = [
    rising ? "rise" : "fall",
    formatRate(settings.slipRate),
    `${settings.bankWidth} layers`,
  ].join(" · ");
  $("spectrumSummary").textContent = [
    settings.hold ? "held" : "live",
    `${settings.bandCount} bands`,
    `${Math.round(settings.consonantDetail * 100)}% consonants`,
  ].join(" · ");
  $("characterSummary").textContent = [
    signedSemitones(settings.transpose),
    glideShapeLabel(settings.glideShape),
    `${Math.round(settings.carrierColor * 100)}% color`,
  ].join(" · ");
  $("mixSummary").textContent = [
    `${Math.round(settings.dryWet * 100)}% slip`,
    `${Math.round(settings.inputGain * 100)}% input`,
  ].join(" · ");
  $("sourceSummary").textContent = state.source === "microphone"
    ? "microphone · headphones"
    : state.fileLabel
      ? `file · ${state.loopFile ? "loop" : "once"}`
      : "file · choose audio";
  $("sourceNote").textContent = state.source === "microphone"
    ? "Switch Audio on to allow microphone access. Use headphones; the resynthesized signal can feed back through speakers."
    : "Choose a local file, then switch Audio on. The file stays in this browser and is never uploaded.";
  $("fileControls").hidden = state.source !== "file";
  $("fileName").textContent = state.fileLabel ?? "Choose local audio…";

  const preset = SLIPPERY_RESYNTHESIS_PRESETS.find(({ id }) => id === state.preset);
  $("presetSummary").textContent = preset?.label ?? "Custom";
  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.preset);
  }

  $("stageReadout").textContent = [
    sourceLabel,
    `FFT ${SLIPPERY_RESYNTHESIS_FFT_SIZE}`,
    `${settings.bandCount} BANDS`,
    `${oscillatorCount} OSC`,
    `${rising ? "↑" : "↓"} ${formatRate(settings.slipRate).toUpperCase()}`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  $("stageCaption").textContent = settings.hold
    ? "held spectrum → moving octave banks"
    : `${coherenceLabel(settings.coherence)} spectrum → moving octave banks`;
  canvas.setAttribute(
    "aria-label",
    `A logarithmic ${state.source === "microphone" ? "microphone" : "file"} spectrum and its ${settings.bandCount}-band Shepard resynthesis moving ${rising ? "upward" : "downward"} at ${settings.slipRate.toFixed(2)} octaves per second. Spectral tracking ${settings.hold ? "held" : "live"}. Audio ${state.audioOn ? "on" : "off"}.`,
  );

  updateAudioParameters();
  if (drawNow) draw(performance.now(), true);
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const preset of SLIPPERY_RESYNTHESIS_PRESETS) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.setAttribute("aria-pressed", String(preset.id === state.preset));
    label.textContent = preset.label;
    button.append(label);
    button.addEventListener("click", () => applyPreset(preset.id));
    fragment.append(button);
  }
  $("presetGrid").replaceChildren(fragment);
}

function markCustom() {
  state.preset = null;
}

function setParameter(key, value) {
  state.settings = {
    ...sanitizeSlipperyResynthesisParams({
      ...state.settings,
      [key]: value,
    }),
  };
  markCustom();
  updateInterface();
}

function applyPreset(id) {
  const preset = SLIPPERY_RESYNTHESIS_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  const { inputGain, outputLevel } = state.settings;
  state.settings = {
    ...sanitizeSlipperyResynthesisParams({
      ...SLIPPERY_RESYNTHESIS_DEFAULTS,
      ...preset.settings,
      inputGain,
      outputLevel,
      hold: false,
    }),
  };
  state.preset = preset.id;
  updateInterface();
  announce(`${preset.label} preset loaded.`);
}

async function startAudio() {
  updateAudioParameters();
  await audio.start(selectedSource());
  state.audioOn = true;
}

async function stopAudio() {
  await audio.stop();
  state.audioOn = false;
}

async function toggleAudio() {
  if (sourceTransition) return;
  sourceTransition = true;
  $("audioButton").disabled = true;
  clearAudioError();
  try {
    if (state.audioOn) await stopAudio();
    else await startAudio();
    updateInterface();
    announce(`Audio ${state.audioOn ? "on" : "off"}.`);
  } catch (error) {
    state.audioOn = false;
    await audio.stop().catch(() => {});
    showAudioError(error);
    updateInterface();
    announce("Audio could not start.");
  } finally {
    sourceTransition = false;
    $("audioButton").disabled = false;
  }
}

async function chooseSource(source) {
  if (source === state.source || sourceTransition) return;
  sourceTransition = true;
  clearAudioError();
  const restart = state.audioOn;
  try {
    if (restart) await stopAudio();
    state.source = source;
    updateInterface();
    if (restart) await startAudio();
    updateInterface();
    announce(`${source === "microphone" ? "Microphone" : "File"} source selected.`);
  } catch (error) {
    state.audioOn = false;
    await audio.stop().catch(() => {});
    showAudioError(error);
    updateInterface();
    announce("Audio source could not start.");
  } finally {
    sourceTransition = false;
  }
}

function bindRange(id, key, transform = Number) {
  $(id).addEventListener("input", (event) => {
    setParameter(key, transform(event.currentTarget.value));
  });
}

$("audioButton").addEventListener("click", toggleAudio);
for (const button of $("sourceChoice").querySelectorAll("[data-source]")) {
  button.addEventListener("click", () => chooseSource(button.dataset.source));
}
for (const button of $("directionChoice").querySelectorAll("[data-direction]")) {
  button.addEventListener("click", () => {
    setParameter("direction", Number(button.dataset.direction));
    announce(`Spectrum now ${state.settings.direction > 0 ? "rises" : "falls"}.`);
  });
}
for (const button of $("trackingChoice").querySelectorAll("[data-tracking]")) {
  button.addEventListener("click", () => {
    setParameter("hold", button.dataset.tracking === "hold");
    announce(`Spectrum ${state.settings.hold ? "held" : "tracking live input"}.`);
  });
}

bindRange("outputLevel", "outputLevel");
bindRange("slipRate", "slipRate");
bindRange("bankWidth", "bankWidth");
bindRange("coherence", "coherence");
bindRange("bandCount", "bandCount");
bindRange("response", "response", (value) => Number(value) / 1_000);
bindRange("consonantDetail", "consonantDetail");
bindRange("transpose", "transpose", (value) => Number(value) / 12);
bindRange("glideShape", "glideShape");
bindRange("spectralTilt", "spectralTilt");
bindRange("carrierColor", "carrierColor");
bindRange("stereoWidth", "stereoWidth");
bindRange("gate", "gateDb");
bindRange("highFrequency", "highFrequency");
bindRange("dryWet", "dryWet");
bindRange("inputGain", "inputGain");

$("loopFile").addEventListener("click", () => {
  state.loopFile = !state.loopFile;
  $("fileAudio").loop = state.loopFile;
  updateInterface();
  announce(`File loop ${state.loopFile ? "on" : "off"}.`);
});

$("filePicker").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const nextUrl = URL.createObjectURL(file);
  const previousUrl = state.fileUrl;
  const restart = state.audioOn && state.source === "file";
  clearAudioError();
  try {
    if (restart) await stopAudio();
    state.fileUrl = nextUrl;
    state.fileLabel = file.name;
    $("fileAudio").src = nextUrl;
    $("fileAudio").load();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    if (restart) await startAudio();
    updateInterface();
    announce(`${file.name} loaded locally.`);
  } catch (error) {
    state.audioOn = false;
    showAudioError(error);
    updateInterface();
    announce("The selected file could not start.");
  }
});

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  state.settings = { ...SLIPPERY_RESYNTHESIS_DEFAULTS };
  state.preset = null;
  updateInterface();
  announce("All Slippery Resynthesis parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    setParameter("direction", event.key === "ArrowUp" ? 1 : -1);
    announce(`Spectrum now ${state.settings.direction > 0 ? "rises" : "falls"}.`);
  } else if (event.key === " ") {
    event.preventDefault();
    setParameter("hold", !state.settings.hold);
    announce(`Spectrum ${state.settings.hold ? "held" : "tracking live input"}.`);
  }
});

function frequencyAtX(x, width) {
  const position = Math.max(0, Math.min(1, x / Math.max(1, width)));
  return 20 * (20_000 / 20) ** position;
}

function idleSpectrumDb(frequency) {
  const logFrequency = Math.log2(Math.max(20, frequency));
  const peaks = [82, 164, 246, 410, 820, 1_640, 3_250, 6_400];
  let energy = 0;
  for (let index = 0; index < peaks.length; index += 1) {
    const distance = (logFrequency - Math.log2(peaks[index])) / (0.09 + index * 0.012);
    energy += Math.exp(-distance * distance * 0.5) * (1 - index * 0.07);
  }
  return -96 + Math.min(1, energy) * 62;
}

function spectrumDbAt(data, frequency, fallback = false) {
  if (fallback) return idleSpectrumDb(frequency);
  const sampleRate = audio.context?.sampleRate ?? 48_000;
  const position = frequency / (sampleRate * 0.5) * (data.length - 1);
  if (position < 0 || position >= data.length - 1) return -100;
  const left = Math.floor(position);
  const mix = position - left;
  const first = Number.isFinite(data[left]) ? data[left] : -100;
  const second = Number.isFinite(data[left + 1]) ? data[left + 1] : first;
  return first + (second - first) * mix;
}

function displayMagnitude(db) {
  const normalized = Math.max(0, Math.min(1, (db + 96) / 76));
  return normalized ** 1.35;
}

function drawSpectrumPath({
  data,
  sourceShift = 0,
  color,
  fill = null,
  alpha = 1,
  lineWidth = 1,
  fallback = false,
  amplitudeScale = 1,
}) {
  const left = Math.max(18, canvasWidth * 0.035);
  const right = canvasWidth - left;
  const top = Math.max(48, canvasHeight * 0.13);
  const bottom = canvasHeight - Math.max(67, canvasHeight * 0.13);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const points = Math.max(140, Math.min(520, Math.round(width * 0.62)));

  context2d.beginPath();
  for (let point = 0; point <= points; point += 1) {
    const x = left + point / points * width;
    const outputFrequency = frequencyAtX(point / points * width, width);
    const sourceFrequency = outputFrequency / 2 ** sourceShift;
    const magnitude = displayMagnitude(
      spectrumDbAt(data, sourceFrequency, fallback),
    );
    const y = bottom - magnitude * height * amplitudeScale;
    if (point === 0) context2d.moveTo(x, y);
    else context2d.lineTo(x, y);
  }

  context2d.save();
  context2d.globalAlpha = alpha;
  context2d.strokeStyle = color;
  context2d.lineWidth = lineWidth;
  context2d.lineJoin = "round";
  context2d.shadowColor = color;
  context2d.shadowBlur = alpha > 0.5 ? 9 : 5;
  context2d.stroke();
  if (fill) {
    context2d.lineTo(right, bottom);
    context2d.lineTo(left, bottom);
    context2d.closePath();
    const gradient = context2d.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, fill);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context2d.fillStyle = gradient;
    context2d.shadowBlur = 0;
    context2d.fill();
  }
  context2d.restore();
}

function drawGrid() {
  const left = Math.max(18, canvasWidth * 0.035);
  const right = canvasWidth - left;
  const top = Math.max(48, canvasHeight * 0.13);
  const bottom = canvasHeight - Math.max(67, canvasHeight * 0.13);
  const frequencies = [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000];
  context2d.save();
  context2d.lineWidth = 1;
  for (const frequency of frequencies) {
    const position = Math.log(frequency / 20) / Math.log(20_000 / 20);
    const x = left + position * (right - left);
    context2d.beginPath();
    context2d.moveTo(x, top);
    context2d.lineTo(x, bottom);
    context2d.strokeStyle = frequency === 1_000
      ? "rgba(255, 255, 255, 0.09)"
      : "rgba(255, 255, 255, 0.035)";
    context2d.stroke();
  }
  for (let row = 0; row <= 4; row += 1) {
    const y = top + row / 4 * (bottom - top);
    context2d.beginPath();
    context2d.moveTo(left, y);
    context2d.lineTo(right, y);
    context2d.strokeStyle = "rgba(255, 255, 255, 0.035)";
    context2d.stroke();
  }
  context2d.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  if (!force && timestamp - lastDrawTime < 1_000 / 30) return;
  lastDrawTime = timestamp;
  const hasLiveSpectrum = state.audioOn && audio.getSpectra(
    inputSpectrum,
    outputSpectrum,
  );
  const fallback = !hasLiveSpectrum;

  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  drawGrid();

  drawSpectrumPath({
    data: inputSpectrum,
    color: "#5fe8c4",
    fill: "rgba(95, 232, 196, 0.12)",
    alpha: fallback ? 0.32 : 0.72,
    lineWidth: 1.15,
    fallback,
    amplitudeScale: 0.72,
  });

  for (let layer = 0; layer < state.settings.bankWidth; layer += 1) {
    const phase = wrapUnit(
      state.visualPhase + layer / state.settings.bankWidth,
    );
    const warpedPhase = slipperyGlidePhase(
      phase,
      state.settings.glideShape,
    );
    const octaveOffset = (
      state.settings.direction
      * state.settings.bankWidth
      * (warpedPhase - 0.5)
    );
    const weight = slipperyHann(phase);
    if (weight < 0.025) continue;
    const pink = layer % 2 === 0;
    drawSpectrumPath({
      data: inputSpectrum,
      sourceShift: octaveOffset + state.settings.transpose,
      color: pink ? "#ff7898" : "#7db4ff",
      alpha: (fallback ? 0.2 : 0.13) + weight * (fallback ? 0.34 : 0.44),
      lineWidth: 0.7 + weight * 1.15,
      fallback,
      amplitudeScale: 0.78 + weight * 0.17,
    });
  }

  if (hasLiveSpectrum) {
    drawSpectrumPath({
      data: outputSpectrum,
      color: "#ff9bb2",
      alpha: 0.88,
      lineWidth: 1.4,
      amplitudeScale: 0.86,
    });
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(performance.now(), true);
}

function animate(timestamp) {
  if (disposed) return;
  const elapsed = lastAnimationTime > 0
    ? Math.min(0.1, (timestamp - lastAnimationTime) / 1_000)
    : 0;
  lastAnimationTime = timestamp;
  if (!reducedMotion) {
    state.visualPhase = wrapUnit(
      state.visualPhase
      + elapsed * state.settings.slipRate / state.settings.bankWidth,
    );
  }
  draw(timestamp);
  animationFrame = requestAnimationFrame(animate);
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
resizeObserver?.observe(canvas);
globalThis.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastAnimationTime = performance.now();
    resizeCanvas();
  }
});

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  audio.close();
}, { once: true });

renderPresets();
updateInterface({ drawNow: false });
resizeCanvas();
animationFrame = requestAnimationFrame(animate);
