import {
  BARBER_DELAY_DEFAULTS,
  BARBER_DELAY_PRESETS,
  BarberDelayAudio,
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
const requestedMode = document.body.dataset.delayMode;
const mode = requestedMode === "sludge" || requestedMode === "sandy"
  ? requestedMode
  : "candy";
const isCandy = mode === "candy";
const isSandy = mode === "sandy";
const presets = BARBER_DELAY_PRESETS[mode];
const audio = new BarberDelayAudio(mode, globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const waveform = new Float32Array(512);
const colors = isCandy
  ? ["#dc3c50", "#fff0d1", "#c9f04b", "#e650a0", "#8c32a0"]
  : isSandy
    ? ["#20ccaa", "#21102f", "#00dcc8", "#7548bd", "#258d82"]
    : ["#506428", "#d8c99e", "#50c8ff", "#3c5032", "#76552f"];

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
  $("scopeState").textContent = state.audioOn ? "SCOPE · LIVE" : "SCOPE · IDLE";
  canvas.setAttribute(
    "aria-label",
    isCandy
      ? `Unboxed red, pink, cream, lime, and purple winding delay stripes with small waveform fragments moving ${settings.directionUp ? "upward" : "downward"} and fading into the stage edges. Audio ${state.audioOn ? "on" : "off"}.`
      : isSandy
        ? `A ${settings.pitchOctaves.toFixed(1)} octave log-pitch path moving ${settings.directionUp ? "upward" : "downward"}, with ${settings.numVoices} paired grain markers, ${formatMilliseconds(settings.grainSize)} grains, and feedback echoes. Audio ${state.audioOn ? "on" : "off"}.`
        : `Unboxed olive, cyan, cream, and earth centered-hump delay paths with small waveform fragments moving ${settings.directionUp ? "upward" : "downward"} and fading into the stage edges. Audio ${state.audioOn ? "on" : "off"}.`,
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

function drawAudioFragment(ctx, x, y, size, color, alpha, seed = 0) {
  const halfWidth = Math.max(4, size * 1.45);
  const amplitude = Math.max(2, size * 0.58);
  const lean = Math.sin(seed * 2.17) * amplitude * 0.24;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(seed * 1.31) * 0.16);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(0.8, Math.min(1.65, size * 0.18));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-halfWidth, lean);
  ctx.lineTo(-halfWidth * 0.58, -amplitude * 0.34);
  ctx.lineTo(-halfWidth * 0.25, amplitude * 0.52);
  ctx.lineTo(0, -amplitude);
  ctx.lineTo(halfWidth * 0.24, amplitude * 0.78);
  ctx.lineTo(halfWidth * 0.57, -amplitude * 0.28);
  ctx.lineTo(halfWidth, -lean);
  ctx.stroke();

  ctx.globalAlpha = alpha * 0.46;
  ctx.lineWidth = Math.max(0.65, size * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, -amplitude * 1.52);
  ctx.lineTo(0, amplitude * 1.45);
  ctx.stroke();
  ctx.restore();
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

function drawCandyField(ctx, width, height) {
  const fieldWidth = Math.min(width * 0.82, 920);
  const fieldHeight = Math.min(height * 0.72, 610);
  const x = (width - fieldWidth) * 0.5;
  const y = (height - fieldHeight) * 0.51;
  const stripeHeight = Math.max(16, fieldHeight / 18);
  const travel = state.visualPhase * stripeHeight * 5;

  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(state.settings.directionUp ? -0.55 : 0.55);
  const diagonal = width + height;
  const origin = -diagonal;
  for (let band = -36; band < 38; band += 1) {
    const offset = band * stripeHeight + travel;
    const bandY = wrapPhase(offset / (stripeHeight * 5)) * stripeHeight * 5
      + origin
      + band * stripeHeight;
    ctx.beginPath();
    for (let step = 0; step <= 28; step += 1) {
      const px = origin + step / 28 * diagonal * 2;
      const py = bandY + Math.sin((px / 88) + band * 0.7) * 8;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let step = 28; step >= 0; step -= 1) {
      const px = origin + step / 28 * diagonal * 2;
      const py = bandY + stripeHeight * 0.68 + Math.sin((px / 88) + band * 0.7) * 8;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = colors[((band % colors.length) + colors.length) % colors.length];
    ctx.globalAlpha = 0.34;
    ctx.fill();
  }
  ctx.restore();

  const heads = state.settings.numVoices;
  for (let index = 0; index < heads; index += 1) {
    const phase = wrapPhase(state.visualPhase + index / heads);
    const angle = phase * Math.PI * 4 + (state.settings.directionUp ? 0 : Math.PI);
    const headX = width * 0.5 + Math.cos(angle) * fieldWidth * (0.12 + phase * 0.2);
    const headY = y + fieldHeight * (0.1 + phase * 0.8);
    const window = barberDelayWindow(phase, state.settings.tilt);
    drawAudioFragment(
      ctx,
      headX,
      headY,
      3.5 + window * 4.2,
      colors[index % colors.length],
      0.25 + window * 0.7,
      index + phase,
    );
  }
}

function drawSludgeField(ctx, width, height) {
  const fieldWidth = width * 1.04;
  const fieldHeight = Math.min(height * 0.54, 440);
  const left = (width - fieldWidth) * 0.5;
  const centerY = height * 0.52;
  const amplitude = fieldHeight * 0.36;
  const direction = state.settings.directionUp ? 1 : -1;

  ctx.save();
  const glow = ctx.createRadialGradient(
    width * 0.5,
    centerY,
    4,
    width * 0.5,
    centerY,
    fieldWidth * 0.45,
  );
  glow.addColorStop(0, "rgba(80, 200, 255, 0.09)");
  glow.addColorStop(1, "rgba(80, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(left, centerY - fieldHeight * 0.7, fieldWidth, fieldHeight * 1.4);

  ctx.setLineDash([5, 8]);
  ctx.strokeStyle = "rgba(216, 201, 158, 0.22)";
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
    ctx.strokeStyle = colors[(stripe + 5) % colors.length];
    ctx.lineWidth = stripe === 0 ? 5 : 2.4;
    ctx.globalAlpha = stripe === 0 ? 0.54 : 0.25;
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
  ctx.strokeStyle = "rgba(156, 173, 69, 0.42)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  const heads = state.settings.numVoices;
  for (let index = 0; index < heads; index += 1) {
    const phase = wrapPhase(state.visualPhase + index / heads);
    const x = left + phase * fieldWidth;
    const y = centerY + Math.cos(Math.PI * phase) * amplitude * direction;
    const window = barberDelayWindow(phase, state.settings.tilt);
    drawAudioFragment(
      ctx,
      x,
      y,
      3.5 + window * 4.5,
      colors[index % colors.length],
      0.22 + window * 0.76,
      index + phase * 2,
    );
  }
  ctx.restore();
}

function drawSandyField(ctx, width, height) {
  const fieldWidth = Math.min(width * 0.82, 900);
  const fieldHeight = Math.min(height * 0.48, 390);
  const left = (width - fieldWidth) * 0.5;
  const top = Math.max(126, height * 0.25);
  const centerY = top + fieldHeight * 0.5;
  const pitchSpan = fieldHeight * (
    0.22 + 0.72 * Math.sqrt(state.settings.pitchOctaves / 10)
  );
  const grainScale = (
    (Math.sqrt(state.settings.grainSize) - Math.sqrt(0.005))
    / (Math.sqrt(0.5) - Math.sqrt(0.005))
  );
  const pathWidth = 1.2 + grainScale * 8;
  const blend = state.settings.blend;

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
      x: left + phase * fieldWidth,
      y: centerY - normalizedPitch * pitchSpan * 0.5,
    };
  };

  ctx.save();

  // The foreground path is log pitch over one sweep. Sand breaks it into
  // grain-sized pieces; Syrup joins the same path continuously.
  const pathGradient = ctx.createLinearGradient(
    left,
    centerY,
    left + fieldWidth,
    centerY,
  );
  for (let index = 0; index < colors.length; index += 1) {
    pathGradient.addColorStop(index / (colors.length - 1), colors[index]);
  }
  const segmentCount = Math.max(
    16,
    Math.min(180, Math.round(1 / Math.max(0.005, state.settings.grainSize))),
  );
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const startPhase = segment / segmentCount;
    const endPhase = Math.min(
      1,
      startPhase + (0.35 + blend * 0.65) / segmentCount,
    );
    const start = pointAtPhase(startPhase);
    const end = pointAtPhase(endPhase);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = pathGradient;
    ctx.globalAlpha = 0.18 + blend * 0.34;
    ctx.lineWidth = pathWidth;
    ctx.lineCap = blend > 0.7 ? "round" : "butt";
    ctx.stroke();
  }

  const heads = state.settings.numVoices;
  for (let index = 0; index < heads; index += 1) {
    const phase = wrapPhase(state.visualPhase + index / heads);
    const point = pointAtPhase(phase);
    const history = sandySyrupBaseDelay(
      state.settings.pitchOctaves,
      phase,
      state.settings.fbDelay,
    );
    const window = barberDelayWindow(phase, state.settings.tilt);
    const color = colors[index % colors.length];

    // Feedback is shown as fading prior grains, not as decorative background
    // lines. Their separation follows the selected history length.
    const echoes = Math.min(4, Math.ceil(state.settings.feedback * 4));
    for (let echo = echoes; echo >= 1; echo -= 1) {
      const echoPhase = wrapPhase(
        phase - (
          state.settings.directionUp ? 1 : -1
        ) * echo * (0.018 + history / 15 * 0.028),
      );
      const echoPoint = pointAtPhase(echoPhase);
      drawAudioFragment(
        ctx,
        echoPoint.x,
        echoPoint.y,
        2.4 + grainScale * 3,
        color,
        state.settings.feedback * (0.12 / echo),
        index + echoPhase * 4,
      );
    }

    const fragmentSize = 3.5 + grainScale * 8 + window * 2.5;
    drawAudioFragment(
      ctx,
      point.x,
      point.y,
      fragmentSize,
      color,
      0.3 + window * 0.68,
      index + phase * 3,
    );

    // The second marker is the complementary Hann grain stream.
    drawAudioFragment(
      ctx,
      point.x + (state.settings.directionUp ? 1 : -1) * (4 + grainScale * 8),
      point.y + 5,
      fragmentSize * 0.62,
      color,
      0.2 + (1 - window) * 0.48,
      index + phase * 5 + 0.5,
    );
  }
  ctx.restore();
}

function drawScope(ctx, width, height) {
  const left = Math.max(20, width * 0.07);
  const right = width - left;
  const center = height * 0.82;
  const amplitude = Math.min(56, height * 0.09);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left, center);
  ctx.lineTo(right, center);
  ctx.strokeStyle = "rgba(219, 228, 224, 0.07)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (state.audioOn && audio.getTimeDomainData(waveform)) {
    ctx.beginPath();
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index / (waveform.length - 1) * (right - left);
      const y = center + waveform[index] * amplitude;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = isCandy
      ? "rgba(255, 240, 209, 0.44)"
      : isSandy
        ? "rgba(32, 204, 170, 0.48)"
        : "rgba(80, 200, 255, 0.42)";
    ctx.lineWidth = 1;
    ctx.stroke();
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
  else drawSludgeField(context2d, canvasWidth, canvasHeight);
  drawScope(context2d, canvasWidth, canvasHeight);
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
    state.visualPhase = wrapPhase(
      state.visualPhase
      + elapsed * state.settings.speed * (state.settings.directionUp ? 1 : -1),
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
