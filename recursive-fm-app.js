import {
  DEFAULT_RECURSIVE_FM_PRESET_ID,
  RECURSIVE_FM_LIMITS,
  RECURSIVE_FM_PRESETS,
  deriveRecursiveFmStack,
  formatRecursiveFmFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeRecursiveFmSettings,
  summarizeRecursiveFmStack,
} from "./src/recursive-fm.js";
import {
  createChaoticSpectrogram,
  drawChaoticAnalysis,
} from "./src/chaotic-synth-visuals.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LEVEL = 0.58;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;
const PARAMETER_SMOOTHING_SECONDS = 0.018;

function setAudioParam(param, value, context, timeConstant = PARAMETER_SMOOTHING_SECONDS) {
  if (!param || !context) return;
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}

function setCompressorParameters(compressor) {
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
}

class RecursiveFmAudioEngine {
  constructor() {
    this.context = null;
    this.oscillators = [];
    this.modulationGains = [];
    this.tapGains = [];
    this.nodes = [];
    this.normalizationGain = null;
    this.masterGain = null;
    this.compressor = null;
    this.ceilingGain = null;
    this.analyser = null;
    this.waveform = null;
    this.selectedOperator = -1;
    this.stopping = false;
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48_000;
  }

  async start(settings, level = DEFAULT_LEVEL) {
    if (this.running) {
      if (this.context.state === "suspended") await this.context.resume();
      this.updateSettings(settings);
      this.setLevel(level);
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is not available in this browser.");

    // This constructor is called only from the Audio button's click handler.
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    this.stopping = false;

    const mixBus = context.createGain();
    const normalizationGain = context.createGain();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const ceilingGain = context.createGain();
    const analyser = context.createAnalyser();

    normalizationGain.gain.value = 0;
    masterGain.gain.value = 0;
    ceilingGain.gain.value = 0.82;
    setCompressorParameters(compressor);
    analyser.fftSize = 1_024;
    analyser.smoothingTimeConstant = 0.62;

    mixBus.connect(normalizationGain);
    normalizationGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ceilingGain);
    ceilingGain.connect(analyser);
    analyser.connect(context.destination);

    this.normalizationGain = normalizationGain;
    this.masterGain = masterGain;
    this.compressor = compressor;
    this.ceilingGain = ceilingGain;
    this.analyser = analyser;
    this.waveform = new Uint8Array(analyser.fftSize);
    this.nodes.push(
      mixBus,
      normalizationGain,
      masterGain,
      compressor,
      ceilingGain,
      analyser,
    );

    const maximumStack = deriveRecursiveFmStack({
      ...settings,
      depth: RECURSIVE_FM_LIMITS.maxDepth,
    }, { sampleRate: context.sampleRate });

    for (const operator of maximumStack.operators) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = operator.biasHz;
      const tapGain = context.createGain();
      tapGain.gain.value = 0;
      oscillator.connect(tapGain);
      tapGain.connect(mixBus);
      this.oscillators.push(oscillator);
      this.tapGains.push(tapGain);
      this.nodes.push(oscillator, tapGain);
    }

    for (let index = 1; index < maximumStack.operators.length; index += 1) {
      const modulationGain = context.createGain();
      modulationGain.gain.value = maximumStack.operators[index].modulationHz;
      this.oscillators[index - 1].connect(modulationGain);
      modulationGain.connect(this.oscillators[index].frequency);
      this.modulationGains[index] = modulationGain;
      this.nodes.push(modulationGain);
    }

    this.updateSettings(settings, { immediate: true });
    for (const oscillator of this.oscillators) oscillator.start();
    if (context.state === "suspended") await context.resume();
    this.setLevel(level);
  }

  updateSettings(settings, { immediate = false } = {}) {
    if (!this.context) return deriveRecursiveFmStack(settings);

    const context = this.context;
    const stack = deriveRecursiveFmStack(settings, { sampleRate: context.sampleRate });
    const maximumStack = deriveRecursiveFmStack({
      ...stack.settings,
      depth: RECURSIVE_FM_LIMITS.maxDepth,
    }, { sampleRate: context.sampleRate });
    const timeConstant = immediate ? 0.001 : PARAMETER_SMOOTHING_SECONDS;

    maximumStack.operators.forEach((operator, index) => {
      setAudioParam(
        this.oscillators[index]?.frequency,
        operator.biasHz,
        context,
        timeConstant,
      );
      if (index > 0) {
        setAudioParam(
          this.modulationGains[index]?.gain,
          operator.modulationHz,
          context,
          timeConstant,
        );
      }
    });

    if (this.selectedOperator !== stack.audibleIndex) {
      this.tapGains.forEach((tap, index) => {
        setAudioParam(
          tap.gain,
          index === stack.audibleIndex ? 1 : 0,
          context,
          immediate ? 0.001 : 0.008,
        );
      });
      this.selectedOperator = stack.audibleIndex;
    }
    setAudioParam(
      this.normalizationGain.gain,
      stack.normalizedGain,
      context,
      timeConstant,
    );
    return stack;
  }

  setLevel(level) {
    if (!this.context || !this.masterGain) return;
    const safeLevel = Math.min(1, Math.max(0, Number(level) || 0));
    setAudioParam(this.masterGain.gain, safeLevel, this.context, 0.012);
  }

  readWaveform() {
    if (!this.running || !this.analyser || !this.waveform) return null;
    this.analyser.getByteTimeDomainData(this.waveform);
    return this.waveform;
  }

  async stop({ immediate = false } = {}) {
    if (!this.context || this.stopping) return;
    this.stopping = true;
    const context = this.context;
    const oscillators = [...this.oscillators];
    const nodes = [...this.nodes];

    if (this.masterGain) {
      const now = context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      if (immediate) this.masterGain.gain.setValueAtTime(0, now);
      else this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
    }
    if (!immediate) {
      await new Promise((resolve) => window.setTimeout(resolve, 32));
    }

    for (const oscillator of oscillators) {
      try {
        oscillator.stop();
      } catch {
        // It may already have stopped while the page was unloading.
      }
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnection is best-effort during page shutdown.
      }
    }
    if (context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Some browsers abandon close() while a page is being discarded.
      }
    }

    if (this.context === context) {
      this.context = null;
      this.oscillators = [];
      this.modulationGains = [];
      this.tapGains = [];
      this.nodes = [];
      this.normalizationGain = null;
      this.masterGain = null;
      this.compressor = null;
      this.ceilingGain = null;
      this.analyser = null;
      this.waveform = null;
      this.selectedOperator = -1;
      this.stopping = false;
    }
  }
}

const defaultPreset = RECURSIVE_FM_PRESETS.find(
  ({ id }) => id === DEFAULT_RECURSIVE_FM_PRESET_ID,
) ?? RECURSIVE_FM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  level: DEFAULT_LEVEL,
  audioStarting: false,
};

const engine = new RecursiveFmAudioEngine();
const canvas = $("stage");
const canvasContext = canvas.getContext("2d");
const spectrogram = createChaoticSpectrogram(document);
const stageWrap = $("stageWrap");
let pixelRatio = 1;
let cssWidth = 1;
let cssHeight = 1;
let visualFrameId = null;
let lastVisualFrame = -Infinity;
let visualizationDirty = true;

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
    read: (input) => logarithmicSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(value));
    },
  },
  offsetHz: {
    input: $("offset"),
    output: $("offsetOut"),
    read: (input) => quadraticSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(value));
    },
  },
  modulationHz: {
    input: $("modulation"),
    output: $("modulationOut"),
    read: (input) => quadraticSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(value));
    },
  },
  divisor: {
    input: $("divisor"),
    output: $("divisorOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function currentStack() {
  return deriveRecursiveFmStack(
    state.settings,
    { sampleRate: engine.sampleRate },
  );
}

function presetById(id) {
  return RECURSIVE_FM_PRESETS.find((preset) => preset.id === id) ?? null;
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
    ?? "A custom recursive operator stack.";
}

function updateSignalFlow(stack) {
  const flow = $("recursiveFmFlow");
  const operators = stack.operators;
  const left = 58;
  const right = 810;
  const nodeY = 76;
  const busY = 151;
  const spacing = operators.length > 1
    ? (right - left) / (operators.length - 1)
    : 0;
  const nodeWidth = Math.max(40, Math.min(92, spacing * 0.64));
  const nodeHeight = 46;
  const positions = operators.map((_, index) => left + spacing * index);
  const edgeMarkup = operators.slice(1).map((operator, edgeIndex) => {
    const sourceX = positions[edgeIndex];
    const targetX = positions[edgeIndex + 1];
    const archY = edgeIndex % 2 === 0 ? 22 : 34;
    return `
      <path class="recursive-fm-mod-edge" marker-end="url(#recursiveFmArrow)"
        d="M ${sourceX + nodeWidth * 0.5} ${nodeY}
           C ${sourceX + spacing * 0.45} ${archY},
             ${targetX - spacing * 0.45} ${archY},
             ${targetX - nodeWidth * 0.5} ${nodeY}" />
      <text class="recursive-fm-edge-value" x="${(sourceX + targetX) * 0.5}" y="${archY - 5}">
        ∿ × ${formatRecursiveFmFrequency(operator.modulationHz)}
      </text>
      <circle class="recursive-fm-frequency-port" cx="${targetX - nodeWidth * 0.5}" cy="${nodeY}" r="4" />
    `;
  }).join("");
  const nodeMarkup = operators.map((operator, index) => {
    const x = positions[index];
    const audible = index === stack.audibleIndex;
    const title = operator.kind === "carrier"
      ? (operator.biasHz < 20 ? "LFO / CARRIER" : "CARRIER")
      : operator.kind === "offset-operator"
        ? "ENTRY OSC"
        : `RECURSIVE ${operator.turn}`;
    const value = operator.kind === "carrier"
      ? `${formatRecursiveFmFrequency(operator.biasHz)} sine`
      : `bias ${formatRecursiveFmFrequency(operator.biasHz)}`;
    return `
      <g class="recursive-fm-operator${index === 0 ? " is-carrier" : ""}${audible ? " is-audible" : ""}">
        <rect x="${x - nodeWidth * 0.5}" y="${nodeY - nodeHeight * 0.5}"
          width="${nodeWidth}" height="${nodeHeight}" rx="4" />
        <text class="recursive-fm-operator-title" x="${x}" y="${nodeY - 5}">${title}</text>
        <text class="recursive-fm-operator-value" x="${x}" y="${nodeY + 10}">${value}</text>
        <path class="recursive-fm-tap${audible ? " is-open" : ""}"
          d="M ${x} ${nodeY + nodeHeight * 0.5} L ${x} ${busY}" />
        <circle class="recursive-fm-tap-switch${audible ? " is-open" : ""}"
          cx="${x}" cy="${busY}" r="4" />
      </g>
    `;
  }).join("");
  flow.innerHTML = `
    <svg viewBox="0 0 1080 190" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker id="recursiveFmArrow" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${edgeMarkup}
      ${nodeMarkup}
      <path class="recursive-fm-output-bus" d="M ${left} ${busY} L 900 ${busY}" />
      <text class="recursive-fm-bus-label" x="${left}" y="176">
        oscillator taps · only operator ${stack.audibleIndex} is open
      </text>
      <path class="recursive-fm-audio-edge" marker-end="url(#recursiveFmArrow)"
        d="M 900 ${busY} L 934 ${busY}" />
      <g class="recursive-fm-output-node">
        <rect x="940" y="124" width="116" height="54" rx="4" />
        <text x="998" y="145">NORMALIZE</text>
        <text class="recursive-fm-output-value" x="998" y="161">
          ${(stack.normalizedGain * 100).toFixed(0)}% → AUDIO
        </text>
      </g>
    </svg>
  `;
  flow.setAttribute(
    "aria-label",
    `${
      operators[0].biasHz < 20 ? "LFO carrier" : "Carrier"
    } at ${formatRecursiveFmFrequency(operators[0].biasHz)} modulates the entry oscillator. `
      + `${operators.length - 1} frequency-modulation connections recursively nest each sine into the next oscillator. `
      + `Only operator ${stack.audibleIndex} reaches the normalized audio output.`,
  );
}

function updateControlOutputs(stack = currentStack()) {
  const { settings } = stack;
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatRecursiveFmFrequency(settings.carrierHz);
  controls.offsetHz.output.textContent = formatRecursiveFmFrequency(settings.offsetHz);
  controls.modulationHz.output.textContent = formatRecursiveFmFrequency(settings.modulationHz);
  controls.divisor.output.textContent = `÷${settings.divisor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;

  const summary = summarizeRecursiveFmStack(stack);
  $("structureState").textContent = `${summary.recursiveTurns} ${summary.recursiveTurns === 1 ? "recursion" : "recursions"} · bounded`;
  $("seedReadout").textContent = `${formatRecursiveFmFrequency(settings.carrierHz)} carrier`;
  $("entryReadout").textContent = `${formatRecursiveFmFrequency(settings.offsetHz)} → ${formatRecursiveFmFrequency(settings.offsetHz + settings.modulationHz)}`;
  const recursiveOperators = stack.operators.filter(
    (operator) => operator.kind === "recursive-operator",
  );
  $("turnsReadout").textContent = recursiveOperators.length > 0
    ? recursiveOperators.map(
      (operator, index) => (
        `${index + 1}: ${formatRecursiveFmFrequency(operator.modulationHz)}`
      ),
    ).join(" · ")
    : "none · entry is audible";
  $("operatorReadout").textContent = `operator ${stack.audibleIndex} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatRecursiveFmFrequency(settings.maximumFrequencyHz);
  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · ${engine.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Recursive FM algorithm with ${summary.recursiveTurns} recursive ${summary.recursiveTurns === 1 ? "operator" : "operators"}. Audio ${engine.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
  }
}

function applySettings(settings, { presetId = null, announce = false } = {}) {
  const safe = sanitizeRecursiveFmSettings(settings, { sampleRate: engine.sampleRate });
  state.settings = {
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    offsetHz: safe.offsetHz,
    modulationHz: safe.modulationHz,
    divisor: safe.divisor,
  };
  state.activePresetId = presetId;
  writeControlsFromState();
  const stack = engine.running
    ? engine.updateSettings(state.settings)
    : currentStack();
  updatePresetButtons();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
  if (announce) {
    const preset = presetById(presetId);
    $("liveStatus").textContent = preset
      ? `${preset.label} Recursive FM preset selected.`
      : "Recursive FM parameters reset.";
  }
}

function updateAudioUi() {
  const active = engine.running;
  $("audioButton").setAttribute("aria-pressed", String(active));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = active ? "on" : "off";
  updateControlOutputs();
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  $("liveStatus").textContent = `Audio error: ${message}`;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function resizeCanvas() {
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

function drawRoundedNode(context, x, y, radius, color, selected) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = selected ? color : "#07090b";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = selected ? 2 : 1;
  context.stroke();
}

function drawAlgorithm(context, stack, width, height) {
  const operators = stack.operators;
  const left = Math.max(28, width * 0.065);
  const right = width - left;
  const graphY = Math.max(92, Math.min(height * 0.47, height - 112));
  const available = Math.max(1, right - left);
  const spacing = operators.length > 1 ? available / (operators.length - 1) : 0;
  const radius = Math.max(7, Math.min(13, spacing * 0.23));
  const colors = ["#5fe8c4", "#7db4ff", "#b59cff"];

  context.save();
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 1; index < operators.length; index += 1) {
    const x1 = left + spacing * (index - 1);
    const x2 = left + spacing * index;
    const color = index === operators.length - 1
      ? "#fff3d6"
      : colors[Math.min(2, index)];
    context.beginPath();
    context.moveTo(x1 + radius + 3, graphY);
    context.lineTo(x2 - radius - 3, graphY);
    context.strokeStyle = color;
    context.globalAlpha = 0.42;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;

    if (spacing > 60) {
      context.fillStyle = "#77837e";
      context.fillText(
        formatRecursiveFmFrequency(operators[index].modulationHz),
        (x1 + x2) / 2,
        graphY - 17,
      );
    }
  }

  operators.forEach((operator, index) => {
    const x = left + spacing * index;
    const selected = index === stack.audibleIndex;
    const color = selected
      ? "#fff3d6"
      : (index === 0 ? colors[0] : (index === 1 ? colors[1] : colors[2]));
    drawRoundedNode(context, x, graphY, selected ? radius + 2 : radius, color, selected);
    context.fillStyle = selected ? "#07090b" : color;
    context.font = `${Math.max(6, Math.min(9, radius * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(index === 0 ? "C" : String(index), x, graphY + 0.5);
    if (spacing > 36 || operators.length <= 7) {
      context.fillStyle = selected ? "#fff3d6" : "#77837e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(
        index === 0 ? "CARRIER" : (index === 1 ? "ENTRY" : `TURN ${index - 1}`),
        x,
        graphY + radius + 17,
      );
    }
  });
  context.restore();
}

function drawScope(context, waveform, width, height) {
  const left = Math.max(24, width * 0.045);
  const right = width - left;
  const top = Math.max(height * 0.67, 125);
  const bottom = Math.max(top + 24, height - 43);
  const middle = (top + bottom) / 2;

  context.save();
  context.strokeStyle = "rgba(214, 232, 226, 0.08)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, middle);
  context.lineTo(right, middle);
  context.stroke();

  context.beginPath();
  if (waveform) {
    const slice = (right - left) / Math.max(1, waveform.length - 1);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index * slice;
      const normalized = waveform[index] / 128 - 1;
      const y = middle + normalized * (bottom - top) * 0.46;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = "#b59cff";
    context.shadowColor = "rgba(181, 156, 255, 0.35)";
    context.shadowBlur = 8;
  } else {
    context.moveTo(left, middle);
    context.lineTo(right, middle);
    context.strokeStyle = "rgba(119, 131, 126, 0.48)";
  }
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}

function drawVisualization() {
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, cssWidth, cssHeight);
  drawChaoticAnalysis(canvasContext, {
    analyser: engine.analyser,
    audioOn: engine.running,
    glow: "rgba(181, 156, 255, 0.35)",
    height: cssHeight,
    hue: 260,
    spectrogram,
    stroke: "#b59cff",
    waveform: engine.readWaveform(),
    width: cssWidth,
  });
}

function visualizationFrame(timestamp) {
  visualFrameId = null;
  const shouldAnimate = engine.running && !document.hidden;
  if (
    visualizationDirty
    || timestamp - lastVisualFrame >= VISUAL_FRAME_INTERVAL
  ) {
    drawVisualization();
    visualizationDirty = false;
    lastVisualFrame = timestamp;
  }
  if (shouldAnimate) visualFrameId = requestAnimationFrame(visualizationFrame);
}

function scheduleVisualization() {
  if (visualFrameId === null && !document.hidden) {
    visualFrameId = requestAnimationFrame(visualizationFrame);
  }
}

for (const [name, control] of Object.entries(controls)) {
  control.input.addEventListener("input", () => {
    const next = {
      ...state.settings,
      [name]: control.read(control.input),
    };
    applySettings(next);
  });
}

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = presetById(button.dataset.preset);
  if (!preset) return;
  clearError();
  applySettings(preset.settings, { presetId: preset.id, announce: true });
});

$("level").addEventListener("input", () => {
  state.level = Number($("level").value);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  engine.setLevel(state.level);
});

$("audioButton").addEventListener("click", async () => {
  if (state.audioStarting) return;
  clearError();
  state.audioStarting = true;
  updateAudioUi();
  try {
    if (engine.running) {
      await engine.stop();
      $("liveStatus").textContent = "Recursive FM audio off.";
    } else {
      await engine.start(state.settings, state.level);
      $("liveStatus").textContent = "Recursive FM audio on.";
    }
  } catch (error) {
    await engine.stop({ immediate: true });
    showError(error);
  } finally {
    state.audioStarting = false;
    visualizationDirty = true;
    updateAudioUi();
    scheduleVisualization();
  }
});

$("resetRecursiveFm").addEventListener("click", () => {
  clearError();
  state.level = DEFAULT_LEVEL;
  $("level").value = String(DEFAULT_LEVEL);
  $("levelOut").textContent = `${Math.round(DEFAULT_LEVEL * 100)}%`;
  engine.setLevel(DEFAULT_LEVEL);
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    announce: true,
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    visualizationDirty = true;
    scheduleVisualization();
  }
});

window.addEventListener("pagehide", () => {
  engine.stop({ immediate: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !engine.running) return;
  engine.stop({ immediate: true }).finally(() => {
    state.audioStarting = false;
    updateAudioUi();
    visualizationDirty = true;
    scheduleVisualization();
  });
});

if ("ResizeObserver" in window) {
  new ResizeObserver(resizeCanvas).observe(stageWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}

writeControlsFromState();
updatePresetButtons();
updateControlOutputs();
resizeCanvas();
