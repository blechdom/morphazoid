import {
  BARBER_DELAY_DEFAULTS,
  BARBER_DELAY_PRESETS,
  BarberDelayAudio,
  barberDelayCurve,
  barberDelayPitchEstimate,
  barberDelaySliderPosition,
  barberDelaySliderValue,
  barberDelayWindow,
  sandySyrupBaseDelay,
  sandySyrupTargetRate,
  sanitizeBarberDelayParams,
} from "./src/barber-delay.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const CANDY_RED = "#dc2f3f";
const CANDY_WHITE = "#fff7ea";
const requestedMode = document.body.dataset.delayMode;
const mode = requestedMode === "sandy" ? "sandy" : "candy";
const isCandy = mode === "candy";
const isSandy = mode === "sandy";
const presets = BARBER_DELAY_PRESETS[mode];
const audio = new BarberDelayAudio(mode, globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const waveform = new Float32Array(512);
const colors = isCandy
  ? [CANDY_RED, CANDY_WHITE]
  : ["#20ccaa", "#9b79de", "#00dcc8", "#7548bd", "#4aaea2"];

const initialPreset = isSandy ? null : presets[0];
const state = {
  settings: {
    ...sanitizeBarberDelayParams(
      initialPreset?.settings ?? BARBER_DELAY_DEFAULTS[mode],
      mode,
    ),
  },
  preset: initialPreset?.id ?? null,
  source: "microphone",
  loopFile: true,
  fileUrl: null,
  fileLabel: null,
  audioOn: false,
  ratioLock: false,
  visualPhase: 0,
  tapTimes: [],
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = 0;
let canvasWidth = 1;
let canvasHeight = 1;
let disposed = false;
let sourceTransition = false;

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

function formatMilliseconds(seconds) {
  return `${Math.round(seconds * 1_000)} ms`;
}

function formatSpeed(speed) {
  return `${speed < 1 ? speed.toFixed(3) : speed.toFixed(2)} Hz`;
}

function controlScale(input) {
  return {
    minimum: Number(input.dataset.valueMin ?? input.min),
    maximum: Number(input.dataset.valueMax ?? input.max),
    step: Number(input.dataset.valueStep ?? input.step),
    curve: Number(input.dataset.curve ?? 1),
    curved: Object.hasOwn(input.dataset, "curve"),
  };
}

function readControlValue(input) {
  const scale = controlScale(input);
  if (!scale.curved) return Number(input.value);
  return barberDelaySliderValue(
    input.value,
    scale.minimum,
    scale.maximum,
    scale.curve,
    scale.step,
  );
}

function writeControlValue(id, value) {
  const input = $(id);
  const scale = controlScale(input);
  input.value = String(
    scale.curved
      ? barberDelaySliderPosition(
        value,
        scale.minimum,
        scale.maximum,
        scale.curve,
      )
      : value,
  );
}

function setControlValueText(id, value) {
  $(id)?.setAttribute("aria-valuetext", value);
}

function signed(value) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

function clampToInput(id, value) {
  const input = $(id);
  const scale = controlScale(input);
  return Math.min(scale.maximum, Math.max(scale.minimum, value));
}

function updateAudioParameters() {
  audio.setParameters(state.settings);
}

function markCustom() {
  state.preset = null;
}

function updatePitchReadout() {
  const estimate = barberDelayPitchEstimate(state.settings, mode);
  if (isSandy) {
    const semitoneSpan = Math.round(Math.abs(estimate.semitones));
    $("productOut").textContent = `${estimate.octaves.toFixed(2)} oct`;
    $("ratioOut").textContent = "1.00×";
    $("semitonesOut").textContent = `${estimate.lowRatio.toFixed(2)}× → ${estimate.highRatio.toFixed(2)}×`;
    $("pitchRelationshipSummary").textContent = `±${semitoneSpan} st`;
    $("pitchReadout").textContent = `≈ ±${semitoneSpan} st`;
    $("pitchCaption").textContent = `${estimate.lowRatio.toFixed(2)}× → 1.00× → ${estimate.highRatio.toFixed(2)}×`;
    return;
  }
  const semitoneCopy = estimate.symmetric
    ? `±${Math.round(Math.abs(estimate.semitones))} st`
    : `${signed(estimate.semitones)} st`;
  $("productOut").textContent = estimate.product.toFixed(3);
  $("ratioOut").textContent = estimate.symmetric
    ? "1.00×"
    : `${estimate.ratio.toFixed(2)}×`;
  $("semitonesOut").textContent = semitoneCopy;
  $("pitchRelationshipSummary").textContent = semitoneCopy;
  $("pitchReadout").textContent = `≈ ${semitoneCopy}`;
  $("pitchCaption").textContent = estimate.symmetric
    ? `${estimate.lowRatio.toFixed(2)}× → 1.00× → ${estimate.highRatio.toFixed(2)}×`
    : `estimated endpoint · ${estimate.ratio.toFixed(2)}×`;
}

function updateInterface({ drawNow = true } = {}) {
  const settings = state.settings;
  const directionGlyph = settings.directionUp ? "↑" : "↓";
  setPressed($("directionUp"), settings.directionUp);
  setPressed($("directionDown"), !settings.directionUp);
  setPressed($("sourceMic"), state.source === "microphone");
  setPressed($("sourceFile"), state.source === "file");
  setPressed($("loopFile"), state.loopFile);
  setPressed($("ratioLock"), state.ratioLock);
  setPressed($("audioButton"), state.audioOn);

  writeControlValue("speed", settings.speed);
  if (isSandy) {
    writeControlValue("pitchOctaves", settings.pitchOctaves);
    writeControlValue("grainSize", settings.grainSize);
    writeControlValue("blend", settings.blend);
  } else {
    writeControlValue("range", settings.range);
  }
  writeControlValue("voices", settings.numVoices);
  writeControlValue("tilt", settings.tilt);
  writeControlValue("feedback", settings.feedback);
  writeControlValue("feedbackTime", settings.fbDelay);
  writeControlValue("dryWet", settings.dryWet);
  writeControlValue("inputGain", settings.inputGain);
  writeControlValue("outputLevel", settings.outputLevel);

  const speedText = formatSpeed(settings.speed);
  $("speedOut").textContent = speedText;
  setControlValueText("speed", speedText);
  if (isSandy) {
    const pitchOctavesText = `${settings.pitchOctaves.toFixed(2)} oct`;
    const grainSizeText = formatMilliseconds(settings.grainSize);
    const blendText = settings.blend <= 0.005
      ? "Sand"
      : settings.blend >= 0.995
        ? "Syrup"
        : `${Math.round(settings.blend * 100)}% syrup`;
    $("pitchOctavesOut").textContent = pitchOctavesText;
    $("grainSizeOut").textContent = grainSizeText;
    $("blendOut").textContent = blendText;
    setControlValueText("pitchOctaves", pitchOctavesText);
    setControlValueText("grainSize", grainSizeText);
    setControlValueText("blend", blendText);
  } else {
    const rangeText = formatMilliseconds(settings.range);
    $("rangeOut").textContent = rangeText;
    setControlValueText("range", rangeText);
  }
  $("voicesOut").textContent = String(settings.numVoices);
  $("tiltOut").textContent = Math.abs(settings.tilt) < 0.005
    ? "centered"
    : `${Math.round(Math.abs(settings.tilt) * 100)}% ${settings.tilt < 0 ? "early" : "late"}`;
  $("feedbackOut").textContent = `${Math.round(settings.feedback * 100)}%`;
  const feedbackTimeText = formatMilliseconds(settings.fbDelay);
  $("feedbackTimeOut").textContent = feedbackTimeText;
  $("dryWetOut").textContent = `${Math.round(settings.dryWet * 100)}% wet`;
  $("inputGainOut").textContent = `${Math.round(settings.inputGain * 100)}%`;
  $("outputLevelOut").textContent = `${Math.round(settings.outputLevel * 100)}%`;
  setControlValueText("feedbackTime", feedbackTimeText);
  $("audioState").textContent = state.audioOn ? "on" : "off";

  $("motionSummary").textContent = isSandy
    ? `${directionGlyph} · ${formatSpeed(settings.speed)} · ${settings.pitchOctaves.toFixed(1)} oct`
    : `${directionGlyph} · ${formatSpeed(settings.speed)} · ${formatMilliseconds(settings.range)}`;
  $("soundSummary").textContent = isSandy
    ? `${Math.round(settings.blend * 100)}% syrup · ${Math.round(settings.dryWet * 100)}% wet`
    : `${Math.round(settings.feedback * 100)}% feedback · ${Math.round(settings.dryWet * 100)}% wet`;
  $("sourceSummary").textContent = state.source === "microphone"
    ? "microphone · headphones"
    : state.fileLabel
      ? `file · ${state.loopFile ? "loop" : "once"}`
      : "file · choose audio";
  $("sourceNote").textContent = state.source === "microphone"
    ? "Switch Audio on to allow microphone access. Use headphones—speaker-to-microphone feedback can become loud even with the internal loop bounded."
    : "Pick a local file, then switch Audio on. The file stays in this browser.";
  $("fileControls").hidden = state.source !== "file";
  $("fileName").textContent = state.fileLabel ?? "Choose local audio…";

  const selectedPreset = presets.find((preset) => preset.id === state.preset);
  $("presetSummary").textContent = selectedPreset?.label ?? "Custom";
  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.preset);
  }

  $("stageReadout").textContent = [
    `${settings.numVoices} HEADS`,
    `${directionGlyph} ${formatSpeed(settings.speed).toUpperCase()}`,
    isSandy
      ? `${settings.pitchOctaves.toFixed(1)} OCT · ${formatMilliseconds(settings.fbDelay).toUpperCase()} HISTORY`
      : formatMilliseconds(settings.range).toUpperCase(),
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  $("scopeState").textContent = `LIVE SCOPES · ${state.audioOn ? "ACTIVE" : "IDLE"}`;
  canvas.setAttribute(
    "aria-label",
    isCandy
      ? `${settings.numVoices} unboxed live oscilloscopes alternate white on red and red on white along a candy-striped centered-hump path moving ${settings.directionUp ? "upward" : "downward"}. Audio ${state.audioOn ? "on" : "off"}.`
      : `An escalator of ${settings.numVoices} live oscilloscope screens moves ${settings.directionUp ? "upward" : "downward"} through a ${settings.pitchOctaves.toFixed(1)} octave Shepard–Risset loop, fading each delay head in and out. Audio ${state.audioOn ? "on" : "off"}.`,
  );

  updatePitchReadout();
  updateAudioParameters();
  if (drawNow) draw(performance.now(), true);
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const preset of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(preset.id === state.preset));
    button.title = [
      `${preset.settings.speed} Hz`,
      isSandy
        ? `${preset.settings.pitchOctaves} oct · ${formatMilliseconds(preset.settings.fbDelay)} history`
        : formatMilliseconds(preset.settings.range),
      `${preset.settings.numVoices} heads`,
    ].join(" · ");
    button.addEventListener("click", () => applyPreset(preset.id));
    fragment.append(button);
  }
  $("presetGrid").replaceChildren(fragment);
}

function applyPreset(id) {
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset) return;
  const { inputGain, outputLevel } = state.settings;
  state.settings = {
    ...sanitizeBarberDelayParams({
      ...preset.settings,
      inputGain,
      outputLevel,
    }, mode),
  };
  state.preset = preset.id;
  updateInterface();
  if (isSandy) audio.reseedSandyGrains();
  announce(`${preset.label} preset loaded.`);
}

function setParameter(key, value) {
  state.settings = {
    ...sanitizeBarberDelayParams({
      ...state.settings,
      [key]: value,
    }, mode),
  };
  markCustom();
  updateInterface();
}

function bindRange(id, key, transform = Number) {
  $(id)?.addEventListener("input", (event) => {
    const value = transform(readControlValue(event.currentTarget));
    if (isCandy && state.ratioLock && key === "speed" && value > 0) {
      state.settings = {
        ...sanitizeBarberDelayParams({
          ...state.settings,
          speed: value,
          range: clampToInput("range", 1 / value),
        }, mode),
      };
      markCustom();
      updateInterface();
      return;
    }
    if (isCandy && state.ratioLock && key === "range" && value > 0) {
      state.settings = {
        ...sanitizeBarberDelayParams({
          ...state.settings,
          range: value,
          speed: clampToInput("speed", 1 / value),
        }, mode),
      };
      markCustom();
      updateInterface();
      return;
    }
    setParameter(key, value);
  });
}

for (const button of $("directionChoice").querySelectorAll("[data-direction]")) {
  button.addEventListener("click", () => {
    setParameter("directionUp", Number(button.dataset.direction) > 0);
    announce(`Delay now moves ${state.settings.directionUp ? "up" : "down"}.`);
  });
}

bindRange("speed", "speed");
if (isSandy) {
  bindRange("pitchOctaves", "pitchOctaves");
  bindRange("grainSize", "grainSize");
  bindRange("blend", "blend");
} else {
  bindRange("range", "range");
}
bindRange("voices", "numVoices", (value) => Math.round(Number(value)));
bindRange("tilt", "tilt");
bindRange("feedback", "feedback");
bindRange("feedbackTime", "fbDelay");
bindRange("dryWet", "dryWet");
bindRange("inputGain", "inputGain");
bindRange("outputLevel", "outputLevel");

function resetTapSequence() {
  state.tapTimes.length = 0;
  if ($("tapRangeState")) $("tapRangeState").textContent = "tap twice";
}

$("tapRange")?.addEventListener("click", () => {
  const now = performance.now();
  if (state.tapTimes.length && now - state.tapTimes.at(-1) > 3_000) {
    state.tapTimes.length = 0;
  }
  state.tapTimes.push(now);
  if (state.tapTimes.length > 5) state.tapTimes.shift();
  if (state.tapTimes.length < 2) {
    $("tapRangeState").textContent = "one more";
    announce("Tap range started.");
    return;
  }
  const intervals = [];
  for (let index = 1; index < state.tapTimes.length; index += 1) {
    intervals.push(state.tapTimes[index] - state.tapTimes[index - 1]);
  }
  const averageSeconds = (
    intervals.reduce((sum, interval) => sum + interval, 0)
    / intervals.length
    / 1_000
  );
  const range = Math.round(clampToInput("range", averageSeconds) * 1_000) / 1_000;
  state.settings = {
    ...sanitizeBarberDelayParams({
      ...state.settings,
      range,
      ...(state.ratioLock && range > 0
        ? { speed: clampToInput("speed", 1 / range) }
        : {}),
    }, mode),
  };
  markCustom();
  $("tapRangeState").textContent = formatMilliseconds(range);
  updateInterface();
  announce(`Delay range tapped at ${formatMilliseconds(range)}.`);
});

$("ratioLock")?.addEventListener("click", () => {
  state.ratioLock = !state.ratioLock;
  if (state.ratioLock && state.settings.speed > 0) {
    state.settings = {
      ...sanitizeBarberDelayParams({
        ...state.settings,
        range: clampToInput("range", 1 / state.settings.speed),
      }, mode),
    };
    markCustom();
  }
  updateInterface();
  announce(`One-to-one speed and range lock ${state.ratioLock ? "on" : "off"}.`);
});

function selectedSource() {
  if (state.source === "microphone") return { kind: "microphone" };
  if (!state.fileUrl) {
    throw new Error("Choose a local audio file, or select Mic, before switching Audio on.");
  }
  return { kind: "file", element: $("fileAudio") };
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

$("audioButton").addEventListener("click", toggleAudio);

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

for (const button of $("sourceChoice").querySelectorAll("[data-source]")) {
  button.addEventListener("click", () => chooseSource(button.dataset.source));
}

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
    announce(`${file.name} loaded.`);
  } catch (error) {
    state.audioOn = false;
    showAudioError(error);
    updateInterface();
    announce("The selected file could not start.");
  }
});

$("[data-reset-all]")?.addEventListener("click", () => {
  state.settings = {
    ...sanitizeBarberDelayParams(BARBER_DELAY_DEFAULTS[mode], mode),
  };
  state.preset = null;
  state.ratioLock = false;
  resetTapSequence();
  updateInterface();
  announce("All delay parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    setParameter("directionUp", event.key === "ArrowRight");
    announce(`Delay now moves ${state.settings.directionUp ? "up" : "down"}.`);
  }
});

function wrapPhase(value) {
  return ((value % 1) + 1) % 1;
}

function fadeStageArtwork(ctx, width, height) {
  const radius = Math.max(1, width * 0.56);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(1, height / Math.max(1, width));
  const fade = ctx.createRadialGradient(0, 0, radius * 0.42, 0, 0, radius);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(0.56, "rgba(0, 0, 0, 1)");
  fade.addColorStop(0.78, "rgba(0, 0, 0, 0.76)");
  fade.addColorStop(0.94, "rgba(0, 0, 0, 0.14)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fade;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

function readScopeSignal() {
  const hasSignal = state.audioOn && audio.getTimeDomainData(waveform);
  let signalPeak = 0.02;
  if (hasSignal) {
    for (const sample of waveform) {
      if (Number.isFinite(sample)) {
        signalPeak = Math.max(signalPeak, Math.abs(sample));
      }
    }
  }
  return { hasSignal, signalPeak };
}

function drawCandyOscilloscope(
  ctx,
  head,
  scope,
  hasSignal,
  signalPeak,
) {
  const halfWidth = scope.width * 0.5;
  const headAlpha = 0.08 + head.window * 0.92;
  const pointCount = Math.max(36, Math.round(scope.width));
  const displayGain = Math.min(4.5, 0.72 / Math.max(0.02, signalPeak));
  const sampleStride = Math.max(0.22, Math.min(4.5, head.rate ** 0.42));
  const sampleOffset = Math.floor(
    wrapPhase(
      head.phase
      + head.history / Math.max(0.1, state.settings.range) * 0.25,
    ) * waveform.length,
  );

  ctx.save();
  ctx.translate(head.x, head.y);
  // Stand each scope across the pitch path so neighboring heads remain
  // visually separate instead of joining into one long waveform ribbon.
  ctx.rotate(head.angle + Math.PI * 0.5);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let point = 0; point < pointCount; point += 1) {
    const normalized = point / Math.max(1, pointCount - 1);
    const samplePosition = (
      sampleOffset
      + Math.floor(normalized * (waveform.length - 1) * sampleStride)
    ) % waveform.length;
    const sample = hasSignal && Number.isFinite(waveform[samplePosition])
      ? waveform[samplePosition]
      : 0;
    const x = -halfWidth + normalized * scope.width;
    const y = -sample * scope.height * 0.42 * displayGain;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  // The broad under-stroke is the scope body: candy-colored, curved, and
  // deliberately unboxed. The thin live trace alternates white/red on top.
  ctx.globalAlpha = headAlpha * (hasSignal ? 0.9 : 0.62);
  ctx.strokeStyle = head.back;
  ctx.lineWidth = scope.compact ? 10 : 15;
  ctx.shadowColor = head.back;
  ctx.shadowBlur = scope.compact ? 6 : 10;
  ctx.stroke();

  ctx.globalAlpha = headAlpha * (hasSignal ? 1 : 0.78);
  ctx.strokeStyle = head.ink;
  ctx.lineWidth = scope.compact ? 1.4 : 2;
  ctx.shadowColor = head.ink;
  ctx.shadowBlur = hasSignal ? (scope.compact ? 3 : 6) : 2;
  ctx.stroke();
  ctx.restore();
}

function drawCandyField(ctx, width, height) {
  const headCount = state.settings.numVoices;
  const compact = width <= 520 || height < 360;
  const fieldWidth = Math.min(width * 0.94, 980);
  const fieldHeight = Math.min(height * 0.54, 440);
  const left = (width - fieldWidth) * 0.5;
  const centerY = height * 0.52;
  const amplitude = fieldHeight * 0.52;
  const direction = state.settings.directionUp ? 1 : -1;
  const scope = {
    width: compact
      ? Math.max(32, Math.min(50, fieldWidth / (headCount * 0.92)))
      : Math.max(68, Math.min(104, fieldWidth / (headCount * 1.05))),
    height: compact ? 18 : 32,
    compact,
  };
  const { hasSignal, signalPeak } = readScopeSignal();

  ctx.save();
  const glow = ctx.createRadialGradient(
    width * 0.5,
    centerY,
    4,
    width * 0.5,
    centerY,
    fieldWidth * 0.45,
  );
  glow.addColorStop(0, "rgba(220, 47, 63, 0.18)");
  glow.addColorStop(0.55, "rgba(255, 247, 234, 0.055)");
  glow.addColorStop(1, "rgba(220, 47, 63, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(left, centerY - fieldHeight * 0.7, fieldWidth, fieldHeight * 1.4);

  ctx.setLineDash([5, 8]);
  ctx.strokeStyle = "rgba(255, 247, 234, 0.24)";
  ctx.beginPath();
  ctx.moveTo(left, centerY);
  ctx.lineTo(left + fieldWidth, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let stripe = -4; stripe <= 4; stripe += 1) {
    ctx.beginPath();
    for (let step = 0; step <= 100; step += 1) {
      const phase = step / 100;
      const x = left + phase * fieldWidth;
      const pitchPath = Math.cos(Math.PI * phase) * amplitude * direction;
      const ripple = Math.sin((phase * Math.PI * 8) + state.visualPhase * Math.PI * 2) * 4;
      const y = centerY + pitchPath + stripe * 12 + ripple;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = stripe % 2 === 0 ? CANDY_RED : CANDY_WHITE;
    ctx.lineWidth = stripe === 0 ? 6 : 2.6;
    ctx.globalAlpha = stripe === 0 ? 0.66 : 0.3;
    ctx.stroke();
  }

  // The dotted hump is delay position; its apex is the source-pitch crossing.
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  for (let step = 0; step <= 100; step += 1) {
    const phase = step / 100;
    const x = left + phase * fieldWidth;
    const hump = Math.sin(Math.PI * phase) ** 2;
    const y = centerY + amplitude * 0.72 - hump * amplitude * 0.72;
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255, 247, 234, 0.42)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  const heads = [];
  for (let index = 0; index < headCount; index += 1) {
    const phase = wrapPhase(state.visualPhase + index / headCount);
    const x = left + phase * fieldWidth;
    const y = centerY + Math.cos(Math.PI * phase) * amplitude * direction;
    const window = barberDelayWindow(phase, state.settings.tilt);
    const tangentAngle = Math.atan2(
      -Math.PI * Math.sin(Math.PI * phase) * amplitude * direction,
      fieldWidth,
    );
    const tapeRate = 1 + (
      state.settings.directionUp ? -1 : 1
    ) * state.settings.speed * state.settings.range * Math.PI
      * Math.sin(TAU * phase);
    heads.push({
      x,
      y,
      angle: tangentAngle,
      index,
      phase,
      window,
      history: barberDelayCurve(
        "candy",
        phase,
        state.settings.directionUp,
      ) * state.settings.range,
      rate: Math.max(0.04, Math.abs(tapeRate)),
      back: index % 2 === 0 ? CANDY_RED : CANDY_WHITE,
      ink: index % 2 === 0 ? CANDY_WHITE : CANDY_RED,
    });
  }
  heads.sort((a, b) => a.window - b.window);
  for (const head of heads) {
    drawCandyOscilloscope(
      ctx,
      head,
      scope,
      hasSignal,
      signalPeak,
    );
  }
  ctx.restore();
}

function sandyScopeRateLabel(rate) {
  if (rate < 0.1) return rate.toFixed(2);
  if (rate < 10) return rate.toFixed(2);
  return rate.toFixed(1);
}

function sandyScopeDelayLabel(seconds) {
  return seconds < 1
    ? Math.round(seconds * 1_000) + "ms"
    : seconds.toFixed(seconds < 10 ? 1 : 0) + "s";
}

function drawSandyOscilloscope(
  ctx,
  head,
  scope,
  hasSignal,
  signalPeak,
) {
  const scopeLeft = head.x - scope.width * 0.5;
  const scopeTop = head.y - scope.height * 0.5;
  const headerHeight = scope.compact ? 9 : 14;
  const screenInset = scope.compact ? 3 : 5;
  const screenLeft = scopeLeft + screenInset;
  const screenTop = scopeTop + headerHeight;
  const screenWidth = scope.width - screenInset * 2;
  const screenHeight = scope.height - headerHeight - screenInset;
  const centerY = screenTop + screenHeight * 0.5;
  const headAlpha = 0.08 + head.window * 0.92;

  ctx.save();
  ctx.globalAlpha = headAlpha;
  ctx.shadowColor = head.color;
  ctx.shadowBlur = scope.compact ? 5 : 12;
  ctx.fillStyle = "rgba(3, 5, 12, 0.96)";
  ctx.fillRect(scopeLeft, scopeTop, scope.width, scope.height);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = head.color;
  ctx.lineWidth = head.window > 0.7 ? 1.4 : 0.8;
  ctx.strokeRect(
    scopeLeft + 0.5,
    scopeTop + 0.5,
    scope.width - 1,
    scope.height - 1,
  );

  ctx.fillStyle = head.color;
  ctx.font = (scope.compact ? "5.5px" : "7px") + " ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(
    "H" + String(head.index + 1).padStart(2, "0")
      + " · " + sandyScopeRateLabel(head.rate) + "×",
    scopeLeft + screenInset,
    scopeTop + headerHeight * 0.48,
  );
  if (!scope.compact) {
    ctx.textAlign = "right";
    ctx.globalAlpha = headAlpha * 0.72;
    ctx.fillText(
      sandyScopeDelayLabel(head.history),
      scopeLeft + scope.width - screenInset,
      scopeTop + headerHeight * 0.48,
    );
  }

  ctx.globalAlpha = headAlpha;
  ctx.fillStyle = "rgba(0, 8, 12, 0.94)";
  ctx.fillRect(screenLeft, screenTop, screenWidth, screenHeight);

  ctx.beginPath();
  for (let column = 1; column < 4; column += 1) {
    const x = screenLeft + screenWidth * column / 4;
    ctx.moveTo(x, screenTop);
    ctx.lineTo(x, screenTop + screenHeight);
  }
  for (let row = 1; row < 3; row += 1) {
    const y = screenTop + screenHeight * row / 3;
    ctx.moveTo(screenLeft, y);
    ctx.lineTo(screenLeft + screenWidth, y);
  }
  ctx.globalAlpha = headAlpha * 0.16;
  ctx.strokeStyle = head.color;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(screenLeft, screenTop, screenWidth, screenHeight);
  ctx.clip();
  ctx.beginPath();
  const pointCount = Math.max(28, Math.round(screenWidth));
  const displayGain = Math.min(4.5, 0.72 / Math.max(0.02, signalPeak));
  const sampleStride = Math.max(0.22, Math.min(4.5, head.rate ** 0.42));
  const sampleOffset = Math.floor(
    wrapPhase(
      head.phase
      + head.history / Math.max(0.1, state.settings.fbDelay) * 0.25,
    ) * waveform.length,
  );
  for (let point = 0; point < pointCount; point += 1) {
    const samplePosition = (
      sampleOffset
      + Math.floor(
        point / Math.max(1, pointCount - 1)
        * (waveform.length - 1)
        * sampleStride,
      )
    ) % waveform.length;
    const sample = hasSignal && Number.isFinite(waveform[samplePosition])
      ? waveform[samplePosition]
      : 0;
    const x = screenLeft + point / Math.max(1, pointCount - 1) * screenWidth;
    const y = centerY - sample * screenHeight * 0.42 * displayGain;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.globalAlpha = headAlpha * (hasSignal ? 0.98 : 0.32);
  ctx.strokeStyle = head.color;
  ctx.lineWidth = scope.compact ? 0.85 : 1.15;
  ctx.shadowColor = head.color;
  ctx.shadowBlur = hasSignal ? (scope.compact ? 3 : 6) : 0;
  ctx.stroke();
  ctx.restore();

  ctx.globalAlpha = headAlpha * 0.82;
  ctx.fillStyle = head.color;
  const meterHeight = Math.max(1, (screenHeight - 2) * head.window);
  ctx.fillRect(
    screenLeft + screenWidth - 2,
    screenTop + screenHeight - 1 - meterHeight,
    1,
    meterHeight,
  );
  ctx.restore();
}

function drawSandyField(ctx, width, height) {
  const headCount = state.settings.numVoices;
  const compact = height < 360;
  const fieldWidth = Math.min(width * 0.86, 940);
  const rawScopeWidth = fieldWidth / Math.max(4, headCount * 0.62);
  const scopeWidth = compact
    ? Math.max(58, Math.min(88, rawScopeWidth))
    : Math.max(92, Math.min(166, rawScopeWidth));
  const scopeHeight = scopeWidth * (compact ? 0.5 : 0.54);
  const trackLeft = (width - fieldWidth) * 0.5 + scopeWidth * 0.5;
  const trackRight = (width + fieldWidth) * 0.5 - scopeWidth * 0.5;
  const top = compact
    ? Math.max(92, height * 0.45)
    : Math.max(158, height * 0.24);
  const bottom = compact
    ? Math.max(top + 42, height - 42)
    : Math.min(height - 126, top + Math.min(370, height * 0.45));
  const centerY = (top + bottom) * 0.5;
  const pitchHeight = Math.max(42, bottom - top);
  const { hasSignal, signalPeak } = readScopeSignal();

  const pointAtPhase = (phase) => {
    const rate = sandySyrupTargetRate(
      state.settings.pitchOctaves,
      phase,
      state.settings.directionUp,
    );
    const normalizedPitch = (
      Math.log2(rate) / Math.max(0.25, state.settings.pitchOctaves * 0.5)
    );
    return {
      rate,
      x: trackLeft + phase * (trackRight - trackLeft),
      y: centerY - normalizedPitch * pitchHeight * 0.5,
    };
  };

  ctx.save();
  const guidePhases = [0, 0.5, 1];
  for (const phase of guidePhases) {
    const guide = pointAtPhase(phase);
    ctx.beginPath();
    ctx.moveTo((width - fieldWidth) * 0.5, guide.y);
    ctx.lineTo((width + fieldWidth) * 0.5, guide.y);
    ctx.strokeStyle = "rgba(32, 204, 170, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!compact) {
      ctx.fillStyle = "rgba(186, 222, 216, 0.38)";
      ctx.font = "7px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        sandyScopeRateLabel(guide.rate) + "×",
        (width - fieldWidth) * 0.5,
        guide.y - 4,
      );
    }
  }

  const first = pointAtPhase(0);
  const last = pointAtPhase(1);
  const railGradient = ctx.createLinearGradient(
    first.x,
    first.y,
    last.x,
    last.y,
  );
  railGradient.addColorStop(0, "rgba(32, 204, 170, 0.05)");
  railGradient.addColorStop(0.5, "rgba(0, 220, 200, 0.36)");
  railGradient.addColorStop(1, "rgba(117, 72, 189, 0.05)");

  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
  ctx.lineWidth = scopeHeight * 0.38;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = railGradient;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = "rgba(117, 72, 189, 0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.bezierCurveTo(
    last.x + scopeWidth * 0.7,
    last.y + pitchHeight * 0.18,
    first.x - scopeWidth * 0.7,
    first.y - pitchHeight * 0.18,
    first.x,
    first.y,
  );
  ctx.stroke();
  ctx.setLineDash([]);

  const stepCount = Math.max(10, headCount * 2);
  const railAngle = Math.atan2(last.y - first.y, last.x - first.x);
  const normalX = Math.cos(railAngle + Math.PI * 0.5);
  const normalY = Math.sin(railAngle + Math.PI * 0.5);
  for (let step = 0; step <= stepCount; step += 1) {
    const point = pointAtPhase(step / stepCount);
    ctx.beginPath();
    ctx.moveTo(point.x - normalX * 7, point.y - normalY * 7);
    ctx.lineTo(point.x + normalX * 7, point.y + normalY * 7);
    ctx.strokeStyle = "rgba(32, 204, 170, 0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(32, 204, 170, 0.055)";
  ctx.font = (compact ? "34px" : "58px") + " ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("∞", width * 0.5, centerY);

  const heads = [];
  for (let index = 0; index < headCount; index += 1) {
    const phase = wrapPhase(state.visualPhase + index / headCount);
    const point = pointAtPhase(phase);
    heads.push({
      ...point,
      index,
      phase,
      history: sandySyrupBaseDelay(
        state.settings.pitchOctaves,
        phase,
        state.settings.fbDelay,
      ),
      window: barberDelayWindow(phase, state.settings.tilt),
      color: colors[index % colors.length],
    });
  }
  heads.sort((a, b) => a.window - b.window);
  const scope = {
    width: scopeWidth,
    height: scopeHeight,
    compact,
  };
  for (const head of heads) {
    drawSandyOscilloscope(
      ctx,
      head,
      scope,
      hasSignal,
      signalPeak,
    );
  }
  ctx.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  if (!force && timestamp - lastDrawTime < 1_000 / 30) return;
  lastDrawTime = timestamp;
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  if (isCandy) drawCandyField(context2d, canvasWidth, canvasHeight);
  else if (isSandy) drawSandyField(context2d, canvasWidth, canvasHeight);
  fadeStageArtwork(context2d, canvasWidth, canvasHeight);
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
  if (state.audioOn && !reducedMotion) {
    // Both centered paths run left to right. Their geometry handles whether
    // the heads climb or fall, so reversing phase here would flip Candy twice.
    state.visualPhase = wrapPhase(
      state.visualPhase
      + elapsed * state.settings.speed,
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
updateInterface();
resizeCanvas();
animationFrame = requestAnimationFrame(animate);
