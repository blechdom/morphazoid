import {
  CHAOTIC_PM_DEFAULTS,
  CHAOTIC_PM_LIMITS,
  CHAOTIC_PM_PARAMETER_IDS,
  CHAOTIC_PM_PRESETS,
  DEFAULT_CHAOTIC_PM_PRESET_ID,
  ChaoticPmAudio,
  deriveChaoticPmStack,
  formatChaoticPmFrequency,
  formatChaoticPmNumber,
  logarithmicChaoticPmPosition,
  logarithmicChaoticPmValue,
  sanitizeChaoticPmParams,
  summarizeChaoticPmStack,
} from "./src/chaotic-pm.js";
import {
  createChaoticSpectrogram,
  drawChaoticAnalysis,
} from "./src/chaotic-synth-visuals.js";

const $ = (id) => document.getElementById(id);
const VISUAL_FRAME_INTERVAL = 1_000 / 30;

const defaultPreset = CHAOTIC_PM_PRESETS.find(
  ({ id }) => id === DEFAULT_CHAOTIC_PM_PRESET_ID,
) ?? CHAOTIC_PM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  output: CHAOTIC_PM_DEFAULTS.output,
  audioStarting: false,
};

const audio = new ChaoticPmAudio(globalThis);
const canvas = $("stage");
const canvasContext = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const spectrogram = createChaoticSpectrogram(document);
const stageWrap = $("stageWrap");
let pixelRatio = 1;
let cssWidth = 1;
let cssHeight = 1;
let visualFrameId = null;
let lastVisualFrame = -Infinity;
let visualizationDirty = true;
let resizeObserver = null;
let usingWindowResizeFallback = false;
let disposed = false;

const controls = {
  depth: {
    input: $("depth"),
    output: $("depthOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  carrierHz: {
    input: $("carrier"),
    output: $("carrierOut"),
    read: (input) => logarithmicChaoticPmValue(
      Number(input.value),
      CHAOTIC_PM_LIMITS.minCarrierHz,
      CHAOTIC_PM_LIMITS.maxCarrierHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticPmPosition(
        value,
        CHAOTIC_PM_LIMITS.minCarrierHz,
        CHAOTIC_PM_LIMITS.maxCarrierHz,
      ));
    },
  },
  startModFrequencyHz: {
    input: $("modFrequency"),
    output: $("modFrequencyOut"),
    read: (input) => logarithmicChaoticPmValue(
      Number(input.value),
      CHAOTIC_PM_LIMITS.minModFrequencyHz,
      CHAOTIC_PM_LIMITS.maxModFrequencyHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticPmPosition(
        value,
        CHAOTIC_PM_LIMITS.minModFrequencyHz,
        CHAOTIC_PM_LIMITS.maxModFrequencyHz,
      ));
    },
  },
  frequencyDivisor: {
    input: $("frequencyDivisor"),
    output: $("frequencyDivisorOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  startPhaseIndex: {
    input: $("phaseIndex"),
    output: $("phaseIndexOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  indexDivisor: {
    input: $("indexDivisor"),
    output: $("indexDivisorOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  nonlinearity: {
    input: $("phaseWarp"),
    output: $("phaseWarpOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function currentStack() {
  return deriveChaoticPmStack(state.settings, { sampleRate: audio.sampleRate });
}

function presetById(id) {
  return CHAOTIC_PM_PRESETS.find((preset) => preset.id === id) ?? null;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function compactDrive(value) {
  if (value >= 10_000) return value.toExponential(2);
  if (value >= 1_000) return formatChaoticPmNumber(value, 1);
  return formatChaoticPmNumber(value, 3);
}

function updatePresetButtons() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preset === state.activePresetId),
    );
  }
  const preset = presetById(state.activePresetId);
  $("presetState").textContent = preset?.label ?? "Custom";
  $("presetDescription").textContent = preset?.description
    ?? "A custom stack of recursively warped phase operators.";
}

function flowBlock(x, width, title, value, className = "is-warp") {
  return `
    <g class="chaotic-path-block ${className}">
      <rect x="${x}" y="91" width="${width}" height="52" rx="4" />
      <text class="chaotic-path-title" x="${x + width / 2}" y="112">${title}</text>
      <text class="chaotic-path-value" x="${x + width / 2}" y="129">${value}</text>
    </g>
  `;
}

function updateSignalFlow(stack) {
  const flow = $("chaoticPmFlow");
  const operator = stack.operators[1] ?? null;
  const finalOperator = stack.operators[stack.audibleIndex];
  const active = Boolean(operator);
  const index = active ? formatChaoticPmNumber(operator.phaseIndex) : "bypassed";
  const frequency = active ? formatChaoticPmFrequency(operator.frequencyHz) : "no turn";
  const drive = active ? compactDrive(operator.drive) : "—";
  const gain = active ? formatChaoticPmNumber(operator.gain) : "—";
  const repeat = active
    ? `${stack.actualDepth} ${stack.actualDepth === 1 ? "turn" : "turns"} · f ÷ ${formatChaoticPmNumber(stack.settings.frequencyDivisor)} · I ÷ ${formatChaoticPmNumber(stack.settings.indexDivisor)}`
    : "0 turns · carrier sine goes directly to output";

  flow.innerHTML = `
    <svg viewBox="0 0 1260 210" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      <defs>
        <marker class="chaotic-path-arrow" id="chaoticPmArrow" viewBox="0 0 8 8"
          refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>

      <g class="chaotic-path-operator is-seed">
        <rect x="18" y="91" width="112" height="52" rx="4" />
        <text class="chaotic-path-title" x="74" y="112">PREVIOUS SINE</text>
        <text class="chaotic-path-value" x="74" y="129">${formatChaoticPmFrequency(stack.settings.carrierHz)}</text>
      </g>
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 130 117 H 157" />
      ${flowBlock(162, 88, "× INDEX", index, "is-phase")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 250 117 H 282" />

      <g class="chaotic-path-block is-control">
        <rect x="250" y="35" width="88" height="42" rx="4" />
        <text class="chaotic-path-title" x="294" y="52">PHASOR</text>
        <text class="chaotic-path-value" x="294" y="67">${frequency}</text>
      </g>
      <path class="chaotic-path-control-wire" marker-end="url(#chaoticPmArrow)" d="M 294 77 V 106" />
      <g class="chaotic-path-junction">
        <circle cx="294" cy="117" r="10" />
        <text x="294" y="121">+</text>
      </g>
      <text class="chaotic-pm-flow-label" x="294" y="151">PHASOR + PREVIOUS × INDEX</text>
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 304 117 H 331" />

      ${flowBlock(336, 104, "SIGNED % 1", active ? "negative stays −" : "—", "is-phase")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 440 117 H 467" />
      ${flowBlock(472, 126, "× (WARP × f²)", drive, "is-warp")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 598 117 H 625" />
      ${flowBlock(630, 86, "TANH", active ? "phase shape" : "—", "is-warp")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 716 117 H 743" />
      ${flowBlock(748, 88, "× GAIN", gain, "is-warp")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 836 117 H 863" />
      ${flowBlock(868, 90, "SINE", active ? "next signal" : "carrier", "is-phase")}
      <path class="chaotic-path-audio-wire" marker-end="url(#chaoticPmArrow)" d="M 958 117 H 1001" />

      <g class="chaotic-path-output">
        <rect x="1006" y="88" width="160" height="58" rx="4" />
        <text class="chaotic-path-title" x="1086" y="110">FINAL TURN → AUDIO</text>
        <text class="chaotic-path-value" x="1086" y="128">${formatChaoticPmFrequency(finalOperator.frequencyHz)} · ${(stack.normalizedGain * 100).toFixed(0)}%</text>
      </g>
      <path class="chaotic-pm-repeat-bracket" d="M 18 164 V 174 H 958 V 164" />
      <text class="chaotic-pm-flow-note" x="18" y="191">${repeat}</text>
    </svg>
  `;

  flow.setAttribute(
    "aria-label",
    active
      ? `Live Chaotic PM turn. A ${frequency} phasor is added to the previous sine times index ${index}; signed remainder modulo one preserves negative values; the result is multiplied by phase warp times frequency squared, drive ${drive}; tanh shaped; multiplied by gain ${gain}; and sent through sine. The path repeats for ${stack.actualDepth} turns; the final ${formatChaoticPmFrequency(finalOperator.frequencyHz)} operator is sent to normalized audio.`
      : `Chaotic PM depth is zero. The ${formatChaoticPmFrequency(stack.settings.carrierHz)} carrier sine bypasses the nonlinear turn and reaches normalized audio directly.`,
  );
}

function updateControlOutputs(stack = currentStack()) {
  const { settings } = stack;
  const finalOperator = stack.operators[stack.audibleIndex];
  const finalFrequency = formatChaoticPmFrequency(finalOperator.frequencyHz);
  const finalBand = finalOperator.frequencyHz < 20 ? " · sub-audio" : "";
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatChaoticPmFrequency(settings.carrierHz);
  controls.startModFrequencyHz.output.textContent = formatChaoticPmFrequency(
    settings.startModFrequencyHz,
  );
  controls.frequencyDivisor.output.textContent = `÷${formatChaoticPmNumber(settings.frequencyDivisor)}`;
  controls.startPhaseIndex.output.textContent = formatChaoticPmNumber(settings.startPhaseIndex);
  controls.indexDivisor.output.textContent = `÷${formatChaoticPmNumber(settings.indexDivisor)}`;
  controls.nonlinearity.output.textContent = formatChaoticPmNumber(settings.nonlinearity);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;

  const summary = summarizeChaoticPmStack(stack);
  const bound = stack.boundedByFrequency
    ? " · frequency bounded"
    : (stack.boundedByIndex ? " · index bounded" : "");
  $("algorithmState").textContent = stack.actualDepth === 0
    ? `0 turns · carrier ${finalFrequency}${finalBand}`
    : `${stack.actualDepth} ${stack.actualDepth === 1 ? "turn" : "turns"} · final ${finalFrequency}${finalBand}${bound}`;
  $("carrierReadout").textContent = `${formatChaoticPmFrequency(settings.carrierHz)} sine`;
  $("entryReadout").textContent = `${formatChaoticPmFrequency(settings.startModFrequencyHz)} · index ${formatChaoticPmNumber(settings.startPhaseIndex)}`;

  const phaseOperators = stack.operators.filter(
    (operator) => operator.kind === "chaotic-phase-operator",
  );
  $("turnsReadout").textContent = phaseOperators.length > 0
    ? phaseOperators.map(
      (operator) => (
        `${operator.turn}: ${formatChaoticPmFrequency(operator.frequencyHz)}`
        + ` · I ${formatChaoticPmNumber(operator.phaseIndex)}`
        + ` · drive ${compactDrive(operator.drive)}`
      ),
    ).join(" · ")
    : "none · carrier sine is audible";
  const gain = 1.2 - Math.sqrt(settings.nonlinearity);
  $("transferReadout").textContent = `signed %1 · tanh · gain ${formatChaoticPmNumber(gain)}`;
  $("operatorReadout").textContent = `operator ${stack.audibleIndex} · ${finalFrequency}${finalBand} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatChaoticPmFrequency(settings.maximumFrequencyHz);

  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · AUDIO ${audio.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Chaotic PM algorithm with ${summary.actualDepth} nonlinear phase ${summary.actualDepth === 1 ? "turn" : "turns"}. Audio ${audio.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
    control.input.dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS[name];
  }
  $("output").value = String(state.output);
  $("output").dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS.output;
}

function applySettings(settings, { presetId = null, announceChange = false } = {}) {
  const safe = sanitizeChaoticPmParams(settings, { sampleRate: audio.sampleRate });
  state.settings = {
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    startModFrequencyHz: safe.startModFrequencyHz,
    frequencyDivisor: safe.frequencyDivisor,
    startPhaseIndex: safe.startPhaseIndex,
    indexDivisor: safe.indexDivisor,
    nonlinearity: safe.nonlinearity,
  };
  state.activePresetId = presetId;
  writeControlsFromState();
  const stack = audio.updateSettings(state.settings);
  updatePresetButtons();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
  if (announceChange) {
    const preset = presetById(presetId);
    announce(
      preset
        ? `${preset.label} Chaotic PM preset selected.`
        : "Chaotic PM parameters reset.",
    );
  }
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

function updateAudioUi() {
  $("audioButton").setAttribute("aria-pressed", String(audio.running));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = audio.running ? "on" : "off";
  updateControlOutputs();
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  state.audioStarting = true;
  updateAudioUi();
  try {
    if (audio.running) {
      await audio.stop();
      announce("Chaotic PM audio off.");
    } else {
      await audio.start(state.settings, state.output);
      announce("Chaotic PM audio on.");
    }
  } catch (error) {
    await audio.stop({ immediate: true });
    showError(error);
  } finally {
    state.audioStarting = false;
    visualizationDirty = true;
    updateAudioUi();
    scheduleVisualization();
  }
}

function resizeCanvas() {
  if (disposed) return;
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  visualizationDirty = true;
  scheduleVisualization();
}

function drawVisualization() {
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, cssWidth, cssHeight);
  drawChaoticAnalysis(canvasContext, {
    analyser: audio.analyser,
    audioOn: audio.running,
    glow: "rgba(185, 140, 255, 0.38)",
    height: cssHeight,
    hue: 266,
    spectrogram,
    stroke: "#b98cff",
    waveform: audio.readWaveform(),
    width: cssWidth,
  });
}

function visualizationFrame(timestamp) {
  visualFrameId = null;
  if (disposed) return;
  const shouldAnimate = audio.running && !document.hidden;
  if (visualizationDirty || timestamp - lastVisualFrame >= VISUAL_FRAME_INTERVAL) {
    drawVisualization();
    visualizationDirty = false;
    lastVisualFrame = timestamp;
  }
  if (shouldAnimate) visualFrameId = requestAnimationFrame(visualizationFrame);
}

function scheduleVisualization() {
  if (!disposed && visualFrameId === null && !document.hidden) {
    visualFrameId = requestAnimationFrame(visualizationFrame);
  }
}

function beginResizeObservation() {
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(stageWrap);
    return;
  }
  usingWindowResizeFallback = true;
  window.addEventListener("resize", resizeCanvas);
}

function endResizeObservation() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (usingWindowResizeFallback) {
    window.removeEventListener("resize", resizeCanvas);
    usingWindowResizeFallback = false;
  }
}

for (const [name, control] of Object.entries(controls)) {
  control.input.addEventListener("input", () => {
    applySettings({
      ...state.settings,
      [name]: control.read(control.input),
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
    announceChange: true,
  });
});

$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  audio.setLevel(state.output);
});

$("audioButton").addEventListener("click", toggleAudio);

canvas.addEventListener("keydown", (event) => {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  toggleAudio();
});

$("resetChaoticPm").addEventListener("click", () => {
  clearError();
  state.output = CHAOTIC_PM_DEFAULTS.output;
  audio.setLevel(state.output);
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    announceChange: true,
  });
});

document.addEventListener("visibilitychange", () => {
  if (!disposed && !document.hidden) {
    visualizationDirty = true;
    scheduleVisualization();
  }
});

window.addEventListener("pagehide", () => {
  disposed = true;
  if (visualFrameId !== null) {
    cancelAnimationFrame(visualFrameId);
    visualFrameId = null;
  }
  endResizeObservation();
  audio.stop({ immediate: true });
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !disposed) return;
  disposed = false;
  beginResizeObservation();
  visualizationDirty = true;
  updateAudioUi();
  resizeCanvas();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !audio.running) return;
  audio.stop({ immediate: true }).finally(() => {
    state.audioStarting = false;
    visualizationDirty = true;
    updateAudioUi();
    scheduleVisualization();
    announce("Chaotic PM audio off.");
  });
});

writeControlsFromState();
updatePresetButtons();
updateControlOutputs();
beginResizeObservation();
resizeCanvas();
