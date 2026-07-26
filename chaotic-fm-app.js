import {
  CHAOTIC_FM_DEFAULTS,
  CHAOTIC_FM_LIMITS,
  CHAOTIC_FM_PRESETS,
  DEFAULT_CHAOTIC_FM_PRESET_ID,
  ChaoticFmAudio,
  deriveChaoticFmStack,
  formatChaoticFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeChaoticFmParams,
} from "./src/chaotic-fm.js";
import {
  createChaoticSpectrogram,
  drawChaoticAnalysis,
} from "./src/chaotic-synth-visuals.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1_000 / 30;
const audio = new ChaoticFmAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const stageWrap = $("stageWrap");
const waveform = new Float32Array(512);
const spectrogram = createChaoticSpectrogram(document);
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;

const defaultPreset = CHAOTIC_FM_PRESETS.find(
  (preset) => preset.id === DEFAULT_CHAOTIC_FM_PRESET_ID,
) ?? CHAOTIC_FM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  output: CHAOTIC_FM_DEFAULTS.output,
  activePresetId: defaultPreset.id,
  audioOn: false,
  audioStarting: false,
};

let frameId = null;
let lastDrawTime = -Infinity;
let visualizationDirty = true;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let disposed = false;

const controls = {
  depth: {
    input: $("depth"),
    output: $("depthOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  carrierHz: {
    input: $("carrier"),
    output: $("carrierOut"),
    read: (input) => logarithmicSliderValue(
      Number(input.value),
      CHAOTIC_FM_LIMITS.minCarrierHz,
      CHAOTIC_FM_LIMITS.maxCarrierHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(
        value,
        CHAOTIC_FM_LIMITS.minCarrierHz,
        CHAOTIC_FM_LIMITS.maxCarrierHz,
      ));
    },
  },
  offsetHz: {
    input: $("offset"),
    output: $("offsetOut"),
    read: (input) => quadraticSliderValue(
      Number(input.value),
      CHAOTIC_FM_LIMITS.maxOffsetHz,
    ),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(
        value,
        CHAOTIC_FM_LIMITS.maxOffsetHz,
      ));
    },
  },
  modulationAmount: {
    input: $("modulationAmount"),
    output: $("modulationAmountOut"),
    read: (input) => quadraticSliderValue(
      Number(input.value),
      CHAOTIC_FM_LIMITS.maxModulationAmount,
    ),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(
        value,
        CHAOTIC_FM_LIMITS.maxModulationAmount,
      ));
    },
  },
  amountDivisor: {
    input: $("amountDivisor"),
    output: $("amountDivisorOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  nonlinearityHz: {
    input: $("nonlinearity"),
    output: $("nonlinearityOut"),
    read: (input) => logarithmicSliderValue(
      Number(input.value),
      CHAOTIC_FM_LIMITS.minNonlinearityHz,
      CHAOTIC_FM_LIMITS.maxNonlinearityHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(
        value,
        CHAOTIC_FM_LIMITS.minNonlinearityHz,
        CHAOTIC_FM_LIMITS.maxNonlinearityHz,
      ));
    },
  },
};

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function compactNumber(value, maximumDigits = 3) {
  return Number(value)
    .toFixed(maximumDigits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function presetById(id) {
  return CHAOTIC_FM_PRESETS.find((preset) => preset.id === id) ?? null;
}

function currentParameters() {
  return {
    ...state.settings,
    output: state.output,
  };
}

function currentStack() {
  return deriveChaoticFmStack(currentParameters(), {
    sampleRate: audio.context?.sampleRate ?? 48_000,
  });
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  announce(`Audio error: ${message}`);
}

function writeControls() {
  for (const [key, control] of Object.entries(controls)) {
    control.write(state.settings[key], control.input);
  }
  $("output").value = String(state.output);
}

function updatePresetInterface() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.activePresetId);
  }
  const preset = presetById(state.activePresetId);
  $("presetState").textContent = preset?.label ?? "Custom";
  $("presetDescription").textContent = preset?.description
    ?? "A custom nonlinear recursive oscillator stack.";
}

function updateReadouts(stack = currentStack()) {
  const settings = stack.settings;
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatChaoticFrequency(settings.carrierHz);
  controls.offsetHz.output.textContent = formatChaoticFrequency(settings.offsetHz);
  controls.modulationAmount.output.textContent = formatChaoticFrequency(
    settings.modulationAmount,
  );
  controls.amountDivisor.output.textContent = `÷${compactNumber(settings.amountDivisor)}`;
  controls.nonlinearityHz.output.textContent = formatChaoticFrequency(
    settings.nonlinearityHz,
  );
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;

  const recursionWord = settings.depth === 1 ? "recursion" : "recursions";
  $("algorithmState").textContent = `${settings.depth} ${recursionWord} · tanh`;
  $("carrierReadout").textContent = `${formatChaoticFrequency(settings.carrierHz)} sine`;
  $("entryReadout").textContent = [
    formatChaoticFrequency(stack.entry.minimumFrequencyHz),
    "→",
    formatChaoticFrequency(stack.entry.maximumFrequencyHz),
  ].join(" ");
  if (stack.turns.length > 0) {
    $("turnsReadout").textContent = stack.turns.map(
      (turn) => (
        `${turn.index}: ±${formatChaoticFrequency(turn.nonlinearityHz)}`
        + ` · amount ${compactNumber(turn.amount, 2)}`
      ),
    ).join(" · ");
  } else {
    $("turnsReadout").textContent = "none · entry is audible";
  }
  $("operatorReadout").textContent = `operator ${stack.audibleOperator} · depth-crossfaded`;
  $("stageReadout").textContent = [
    `${settings.depth} ${recursionWord}`,
    `${stack.operatorCount} operators`,
    `audio ${state.audioOn ? "on" : "off"}`,
  ].join(" · ").toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Chaotic FM analysis with ${settings.depth} nonlinear ${recursionWord}. Audio ${state.audioOn ? "on" : "off"}.`,
  );
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function updateInterface() {
  writeControls();
  updatePresetInterface();
  const stack = currentStack();
  updateReadouts(stack);
  audio.setParameters(currentParameters());
  visualizationDirty = true;
  scheduleVisualization();
}

function applySettings(settings, {
  presetId = null,
  message = null,
} = {}) {
  const safe = sanitizeChaoticFmParams({
    ...state.settings,
    ...settings,
    output: state.output,
  }, {
    sampleRate: audio.context?.sampleRate ?? 48_000,
  });
  state.settings = {
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    offsetHz: safe.offsetHz,
    modulationAmount: safe.modulationAmount,
    amountDivisor: safe.amountDivisor,
    nonlinearityHz: safe.nonlinearityHz,
  };
  state.activePresetId = presetId;
  updateInterface();
  if (message) announce(message);
}

for (const [key, control] of Object.entries(controls)) {
  control.input.addEventListener("input", () => {
    applySettings({
      ...state.settings,
      [key]: control.read(control.input),
    });
  });
}

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = presetById(button.dataset.preset);
  if (!preset) return;
  clearError();
  applySettings(preset.settings, {
    presetId: preset.id,
    message: `${preset.label} Chaotic FM preset selected.`,
  });
});

$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  audio.setParameters(currentParameters());
  updateReadouts();
});

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  state.audioStarting = true;
  updateAudioInterface();
  try {
    if (state.audioOn) {
      audio.stop();
      state.audioOn = false;
    } else {
      audio.setParameters(currentParameters());
      await audio.start();
      state.audioOn = true;
    }
    announce(`Audio ${state.audioOn ? "on" : "off"}.`);
  } catch (error) {
    audio.stop();
    state.audioOn = false;
    showError(error);
  } finally {
    state.audioStarting = false;
    updateAudioInterface();
    updateReadouts();
    visualizationDirty = true;
    scheduleVisualization();
  }
}

$("audioButton").addEventListener("click", toggleAudio);

$("resetChaoticFm").addEventListener("click", () => {
  clearError();
  state.output = CHAOTIC_FM_DEFAULTS.output;
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    message: "Chaotic FM parameters reset.",
  });
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    toggleAudio();
    return;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const increment = event.key === "ArrowUp" ? 1 : -1;
  applySettings({
    ...state.settings,
    depth: state.settings.depth + increment,
  });
  announce(`Recursion depth ${state.settings.depth}.`);
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  visualizationDirty = true;
  scheduleVisualization();
}

function drawConnection(context, startX, endX, y, amount, timestamp) {
  const width = Math.max(1, endX - startX);
  const turns = Math.max(2, Math.min(7, Math.round(Math.log10(amount + 1) * 2)));
  const amplitude = Math.min(9, Math.max(2, width * 0.055));
  const motion = state.audioOn && !reducedMotion
    ? timestamp * 0.002
    : 0;
  context.beginPath();
  context.moveTo(startX, y);
  for (let step = 1; step <= 24; step += 1) {
    const progress = step / 24;
    const x = startX + width * progress;
    const envelope = Math.sin(progress * Math.PI);
    const wave = Math.sin(progress * Math.PI * 2 * turns + motion);
    context.lineTo(x, y + wave * amplitude * envelope);
  }
  context.stroke();
}

function drawNode(context, x, y, radius, color, label, selected) {
  context.beginPath();
  context.arc(x, y, selected ? radius + 2 : radius, 0, TAU);
  context.fillStyle = selected ? color : "#07090b";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = selected ? 2 : 1;
  context.stroke();

  if (!selected && label.startsWith("T")) {
    context.beginPath();
    const curveWidth = radius * 0.9;
    for (let index = 0; index <= 12; index += 1) {
      const normalized = index / 6 - 1;
      const curveX = x + normalized * curveWidth;
      const curveY = y - Math.tanh(normalized * 2) * radius * 0.36;
      if (index === 0) context.moveTo(curveX, curveY);
      else context.lineTo(curveX, curveY);
    }
    context.strokeStyle = color;
    context.globalAlpha = 0.72;
    context.lineWidth = 0.8;
    context.stroke();
    context.globalAlpha = 1;
  }

  context.fillStyle = selected ? "#07090b" : color;
  context.font = `${Math.max(6, Math.min(9, radius * 0.68))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y + 0.5);
}

function drawAlgorithm(context, stack, width, height, timestamp) {
  const count = stack.operatorCount;
  const left = Math.max(28, width * 0.065);
  const right = width - left;
  const graphY = Math.max(150, Math.min(height * 0.46, height - 126));
  const spacing = count > 1 ? Math.max(1, (right - left) / (count - 1)) : 1;
  const radius = Math.max(6, Math.min(13, spacing * 0.23));

  context.save();
  context.strokeStyle = "rgba(255, 122, 166, 0.42)";
  context.lineWidth = 1;
  for (let index = 1; index < count; index += 1) {
    const startX = left + spacing * (index - 1) + radius + 3;
    const endX = left + spacing * index - radius - 3;
    const amount = index === 1
      ? stack.entry.modulationAmount
      : stack.turns[index - 2]?.amount ?? 0;
    drawConnection(context, startX, endX, graphY, amount, timestamp);
  }

  for (let index = 0; index < count; index += 1) {
    const x = left + spacing * index;
    const selected = index === count - 1;
    const color = selected
      ? "#fff3d6"
      : (index === 0 ? "#5fe8c4" : (index === 1 ? "#ffb86b" : "#ff7aa6"));
    const label = index === 0 ? "C" : (index === 1 ? "E" : `T${index - 1}`);
    drawNode(context, x, graphY, radius, color, label, selected);

    if (spacing > 42 || count <= 7) {
      context.fillStyle = selected ? "#fff3d6" : "#77837e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "center";
      context.fillText(
        index === 0 ? "CARRIER" : (index === 1 ? "ENTRY" : `TURN ${index - 1}`),
        x,
        graphY + radius + 18,
      );
    }
  }
  context.restore();
}

function drawScope(context, width, height) {
  const left = Math.max(24, width * 0.045);
  const right = width - left;
  const top = Math.max(height * 0.67, 220);
  const bottom = Math.max(top + 24, height - 43);
  const center = (top + bottom) * 0.5;
  const hasWaveform = state.audioOn && audio.getWaveform(waveform);

  context.save();
  context.strokeStyle = "rgba(214, 232, 226, 0.08)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, center);
  context.lineTo(right, center);
  context.stroke();

  context.beginPath();
  if (hasWaveform) {
    const slice = (right - left) / Math.max(1, waveform.length - 1);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index * slice;
      const y = center - waveform[index] * (bottom - top) * 0.46;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = "#ff7aa6";
    context.shadowColor = "rgba(255, 122, 166, 0.38)";
    context.shadowBlur = 8;
  } else {
    context.moveTo(left, center);
    context.lineTo(right, center);
    context.strokeStyle = "rgba(119, 131, 126, 0.48)";
  }
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}

function draw(timestamp) {
  if (!context2d || disposed) return;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context2d.clearRect(0, 0, cssWidth, cssHeight);
  const hasWaveform = state.audioOn && audio.getWaveform(waveform);
  drawChaoticAnalysis(context2d, {
    analyser: audio.analyser,
    audioOn: state.audioOn,
    glow: "rgba(255, 122, 166, 0.38)",
    height: cssHeight,
    hue: 340,
    spectrogram,
    stroke: "#ff7aa6",
    waveform: hasWaveform ? waveform : null,
    width: cssWidth,
  });
}

function visualizationFrame(timestamp) {
  frameId = null;
  if (disposed || document.hidden) return;
  if (
    visualizationDirty
    || timestamp - lastDrawTime >= FRAME_INTERVAL
  ) {
    draw(timestamp);
    lastDrawTime = timestamp;
    visualizationDirty = false;
  }
  if (state.audioOn) scheduleVisualization();
}

function scheduleVisualization() {
  if (frameId === null && !document.hidden && !disposed) {
    frameId = requestAnimationFrame(visualizationFrame);
  }
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
resizeObserver?.observe(stageWrap);
if (!resizeObserver) globalThis.addEventListener("resize", resizeCanvas);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    visualizationDirty = true;
    scheduleVisualization();
  }
});

globalThis.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.audioOn) return;
  audio.stop();
  state.audioOn = false;
  updateAudioInterface();
  updateReadouts();
  visualizationDirty = true;
  scheduleVisualization();
  announce("Audio off.");
});

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", resizeCanvas);
  void audio.close();
}, { once: true });

updateInterface();
updateAudioInterface();
resizeCanvas();
