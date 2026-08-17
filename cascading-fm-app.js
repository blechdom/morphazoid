import {
  CASCADING_FM_LIMITS,
  CASCADING_FM_PRESETS,
  DEFAULT_CASCADING_FM_PRESET_ID,
  cascadeFrequencyDirection,
  cascadeRatioForStageCount,
  deriveCascadeStack,
  formatCascadeFrequency,
  formatCascadeRatio,
  modDepthSliderPosition,
  modDepthSliderValue,
  ratioSliderPosition,
  ratioSliderValue,
  rootHzSliderPosition,
  rootHzSliderValue,
  sanitizeCascadingFmSettings,
} from "./src/cascading-fm.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LEVEL = 0.58;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;
const PARAMETER_SMOOTHING_SECONDS = 0.018;

// ---------------------------------------------------------------------------
// Audio parameter helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------------

class CascadingFmAudioEngine {
  constructor() {
    this.context = null;
    this.oscillators = [];
    this.modulationGains = [];
    this.tapGains = [];
    this.mixBus = null;
    this.normalizationGain = null;
    this.masterGain = null;
    this.compressor = null;
    this.ceilingGain = null;
    this.analyser = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
    this.settings = sanitizeCascadingFmSettings();
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48_000;
  }

  async start(settings, level = DEFAULT_LEVEL) {
    if (this.running) {
      if (this.context.state === "suspended") {
        unlockAudioContext(this.context);
        await this.context.resume();
      }
      this.updateSettings(settings);
      this.setLevel(level);
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio is not available in this browser.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    this.stopping = false;

    const mixBus = context.createGain();
    const normalizationGain = context.createGain();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const ceilingGain = context.createGain();
    const analyser = context.createAnalyser();

    mixBus.gain.value = 1;
    normalizationGain.gain.value = 1;
    masterGain.gain.value = 0;
    ceilingGain.gain.value = 0.82;
    setCompressorParameters(compressor);
    analyser.fftSize = 2_048;
    analyser.minDecibels = -90;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0.45;

    mixBus.connect(normalizationGain);
    normalizationGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ceilingGain);
    ceilingGain.connect(analyser);
    analyser.connect(context.destination);

    this.mixBus = mixBus;
    this.normalizationGain = normalizationGain;
    this.masterGain = masterGain;
    this.compressor = compressor;
    this.ceilingGain = ceilingGain;
    this.analyser = analyser;
    this.waveform = new Uint8Array(512);
    this.nodes.push(mixBus, normalizationGain, masterGain, compressor, ceilingGain, analyser);

    // Pre-allocate maximum number of oscillators so stage count can change
    // without tearing down the audio graph.
    const maxStages = CASCADING_FM_LIMITS.maxStages;
    const initStack = deriveCascadeStack({ ...sanitizeCascadingFmSettings(settings), stages: maxStages });

    for (let i = 0; i < maxStages; i++) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = initStack.oscillators[i]?.freq ?? 0.01;
      const tap = context.createGain();
      tap.gain.value = 0;
      osc.connect(tap);
      tap.connect(mixBus);
      this.oscillators.push(osc);
      this.tapGains.push(tap);
      this.nodes.push(osc, tap);
    }

    // Pre-allocate modulation gains connecting osc[i] → osc[i+1].frequency
    for (let i = 0; i < maxStages - 1; i++) {
      const modGain = context.createGain();
      modGain.gain.value = 0;
      this.oscillators[i].connect(modGain);
      modGain.connect(this.oscillators[i + 1].frequency);
      this.modulationGains.push(modGain);
      this.nodes.push(modGain);
    }

    this.updateSettings(settings, { immediate: true });

    for (const osc of this.oscillators) osc.start();
    if (context.state === "suspended") {
      unlockAudioContext(context);
      await context.resume();
    }
    this.setLevel(level);
  }

  updateSettings(rawSettings, { immediate = false } = {}) {
    const stack = deriveCascadeStack(rawSettings);
    this.settings = stack.settings;
    if (!this.context) return stack;

    const context = this.context;
    const tc = immediate ? 0.001 : PARAMETER_SMOOTHING_SECONDS;
    const { stages } = stack.settings;
    const maxStages = CASCADING_FM_LIMITS.maxStages;

    // Update oscillator frequencies
    for (let i = 0; i < maxStages; i++) {
      const freq = i < stages ? stack.oscillators[i].freq : 0.01;
      setAudioParam(this.oscillators[i]?.frequency, freq, context, tc);
    }

    // Update modulation gains — only active connections carry signal
    for (let i = 0; i < maxStages - 1; i++) {
      const conn = i < stages - 1 ? stack.connections[i] : null;
      setAudioParam(this.modulationGains[i]?.gain, conn ? conn.depthHz : 0, context, tc);
    }

    // Route only the output stage to the mix bus
    for (let i = 0; i < maxStages; i++) {
      const isOutput = i === stages - 1;
      setAudioParam(
        this.tapGains[i]?.gain,
        isOutput ? 1 : 0,
        context,
        immediate ? 0.001 : 0.008,
      );
    }

    // Adjust overall normalization for stage count
    setAudioParam(this.normalizationGain?.gain, stack.normalizedGain, context, tc);

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
      if (immediate) {
        this.masterGain.gain.setValueAtTime(0, now);
      } else {
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
      }
    }
    if (!immediate) {
      await new Promise((resolve) => window.setTimeout(resolve, 32));
    }
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        // May already have stopped while the page was unloading.
      }
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnection is best-effort during shutdown.
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
      this.mixBus = null;
      this.normalizationGain = null;
      this.masterGain = null;
      this.compressor = null;
      this.ceilingGain = null;
      this.analyser = null;
      this.waveform = null;
      this.nodes = [];
      this.stopping = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

const defaultPreset = CASCADING_FM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_FM_PRESET_ID)
  ?? CASCADING_FM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  level: DEFAULT_LEVEL,
  audioStarting: false,
};

const engine = new CascadingFmAudioEngine();

// ---------------------------------------------------------------------------
// Canvas / visualization
// ---------------------------------------------------------------------------

const canvas = $("stage");
const canvasContext = canvas.getContext("2d");
const spectrum = createChaoticSpectrum();
const stageWrap = $("stageWrap");
let pixelRatio = 1;
let cssWidth = 1;
let cssHeight = 1;
let visualFrameId = null;
let lastVisualFrame = -Infinity;
let visualizationDirty = true;

function drawCascadeNodes(context, stack, width, height) {
  const { oscillators, connections } = stack;
  if (!oscillators?.length) return;
  const count = oscillators.length;
  const left = Math.max(28, width * 0.07);
  const right = width - left;
  const graphY = Math.max(80, Math.min(height * 0.43, height - 128));
  const available = Math.max(1, right - left);
  const spacing = count > 1 ? available / (count - 1) : 0;
  const radius = Math.max(7, Math.min(14, spacing * 0.22));

  const rootColor = "#5fe8c4";
  const midColor = "#4ade80";
  const carrierColor = "#a3e635";

  context.save();
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Draw connection lines
  for (let i = 0; i < connections.length; i++) {
    const x1 = left + spacing * i;
    const x2 = left + spacing * (i + 1);
    const color = i === connections.length - 1 ? carrierColor : midColor;
    context.beginPath();
    context.moveTo(x1 + radius + 3, graphY);
    context.lineTo(x2 - radius - 3, graphY);
    context.strokeStyle = color;
    context.globalAlpha = 0.38;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;

    if (spacing > 58) {
      context.fillStyle = "#6b7c7a";
      context.fillText(
        formatCascadeFrequency(connections[i].depthHz),
        (x1 + x2) / 2,
        graphY - 18,
      );
    }
  }

  // Draw stage nodes
  for (let i = 0; i < count; i++) {
    const x = left + spacing * i;
    const isRoot = i === 0;
    const isCarrier = oscillators[i].isCarrier;
    const color = isCarrier ? carrierColor : (isRoot ? rootColor : midColor);
    const r = isCarrier ? radius + 2 : radius;

    context.beginPath();
    context.arc(x, graphY, r, 0, Math.PI * 2);
    context.fillStyle = isCarrier ? "rgba(163, 230, 53, 0.14)" : "#07090b";
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = isCarrier ? 2 : 1.25;
    context.stroke();

    // Stage number
    context.fillStyle = isCarrier ? carrierColor : color;
    context.font = `${Math.max(6, Math.min(9, r * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(String(i), x, graphY + 0.5);

    // Stage label below
    if (spacing > 32 || count <= 7) {
      context.fillStyle = isCarrier ? carrierColor : "#77837e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(
        isRoot ? "ROOT" : (isCarrier ? "OUT" : "MOD"),
        x,
        graphY + r + 16,
      );
      if (spacing > 54) {
        context.fillText(
          formatCascadeFrequency(oscillators[i].freq),
          x,
          graphY + r + 28,
        );
      }
    }
  }

  context.restore();
}

function drawVisualization() {
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, cssWidth, cssHeight);
  drawChaoticLiveAnalysis(canvasContext, {
    analyser: engine.analyser,
    audioOn: engine.running,
    height: cssHeight,
    scopeGlow: "rgba(74, 222, 128, 0.72)",
    scopeStroke: "#fff3d6",
    spectrum,
    spectrumBarCap: "rgba(95, 232, 196, 0.72)",
    spectrumBarFill: "rgba(74, 222, 128, 0.26)",
    waveform: engine.readWaveform(),
    width: cssWidth,
  });
  drawCascadeNodes(canvasContext, currentStack(), cssWidth, cssHeight);
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

// ---------------------------------------------------------------------------
// Signal flow SVG
// ---------------------------------------------------------------------------

function buildFlowSvg(stack) {
  const { oscillators, connections, settings, normalizedGain } = stack;
  const direction = cascadeFrequencyDirection(settings.cascadeRatio);
  const count = oscillators.length;
  // Keep deep 9–12-stage cascades legible without shrinking a 2,000px
  // diagram into the stage viewport.
  const graphWidth = Math.max(840, count * 112 + 240);
  const left = 58;
  const outputX = graphWidth - 132;
  const busEnd = outputX - 50;
  const right = busEnd - 80;
  const nodeY = 110;
  const busY = 178;
  const spacing = count > 1 ? (right - left) / (count - 1) : 0;
  const nodeW = Math.max(42, Math.min(88, spacing * 0.62));
  const nodeH = 46;
  const positions = Array.from({ length: count }, (_, i) => left + spacing * i);

  const connMarkup = connections.map((conn, i) => {
    const srcX = positions[i];
    const tgtX = positions[i + 1];
    const srcEdge = srcX + nodeW * 0.5;
    const tgtEdge = tgtX - nodeW * 0.5;
    const midX = (srcEdge + tgtEdge) * 0.5;
    const mw = Math.max(36, Math.min(60, spacing * 0.32));
    return `
      <path class="cascading-fm-signal-wire"
        d="M ${srcEdge} ${nodeY} L ${midX - mw * 0.5} ${nodeY}
           M ${midX + mw * 0.5} ${nodeY} L ${tgtEdge} ${nodeY}" />
      <g class="cascading-fm-mod-block">
        <rect x="${midX - mw * 0.5}" y="${nodeY - 16}" width="${mw}" height="32" rx="3" />
        <text class="cascading-fm-mod-label" x="${midX}" y="${nodeY - 4}">× MOD</text>
        <text class="cascading-fm-mod-value" x="${midX}" y="${nodeY + 9}">
          ${formatCascadeFrequency(conn.depthHz)}
        </text>
      </g>`;
  }).join("");

  const nodeMarkup = oscillators.map((osc, i) => {
    const x = positions[i];
    const isRoot = i === 0;
    const isCarrier = osc.isCarrier;
    const cls = `cascading-fm-stage-node${isRoot ? " is-lfo" : ""}${isCarrier ? " is-carrier" : ""}`;
    const label = isRoot ? "ROOT SINE" : (isCarrier ? "CARRIER" : `MOD ${i}`);
    return `
      <g class="${cls}">
        <rect x="${x - nodeW * 0.5}" y="${nodeY - nodeH * 0.5}"
          width="${nodeW}" height="${nodeH}" rx="4" />
        <text class="cascading-fm-stage-title" x="${x}" y="${nodeY - 6}">${label}</text>
        <text class="cascading-fm-stage-value" x="${x}" y="${nodeY + 8}">
          ${formatCascadeFrequency(osc.freq)}
        </text>
        <path class="cascading-fm-signal-wire${isCarrier ? "" : " is-faint"}"
          d="M ${x} ${nodeY + nodeH * 0.5} L ${x} ${busY}"
          ${isCarrier ? "" : 'style="stroke-dasharray:3 4;opacity:0.18"'} />
      </g>`;
  }).join("");

  const taperNote = settings.cascadeRatio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

  return `
    <svg class="cascading-fm-flow-detailed" viewBox="0 0 ${graphWidth} 218"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker id="cascadingFmArrow" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${connMarkup}
      ${nodeMarkup}
      <path class="cascading-fm-signal-wire"
        style="stroke:var(--cascading-fm-output);opacity:0.72"
        d="M ${positions[count - 1]} ${nodeY + nodeH * 0.5} L ${positions[count - 1]} ${busY}"
      />
      <path class="cascading-fm-signal-wire"
        style="stroke:var(--cascading-fm-output);opacity:0.72;stroke-width:1.25"
        marker-end="url(#cascadingFmArrow)"
        d="M ${positions[count - 1]} ${busY} L ${outputX - 6} ${busY}" />
      <g class="cascading-fm-output-node">
        <rect x="${outputX}" y="${busY - 28}" width="118" height="52" rx="4" />
        <text class="cascading-fm-output-label" x="${outputX + 59}" y="${busY - 9}">NORMALIZE</text>
        <text class="cascading-fm-output-value" x="${outputX + 59}" y="${busY + 8}">
          ${(normalizedGain * 100).toFixed(0)}% → AUDIO
        </text>
      </g>
      <text style="font-family:ui-monospace,monospace;font-size:6px;fill:var(--faint);letter-spacing:.08em"
        x="${left}" y="208">
        root ${formatCascadeFrequency(settings.rootHz)} · ${formatCascadeRatio(settings.cascadeRatio)} ${direction} · flat-index taper ≈${taperNote}×
      </text>
    </svg>
    <svg class="cascading-fm-flow-compact" viewBox="0 0 380 112"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="cascading-fm-compact-node is-lfo">
        <rect x="8" y="33" width="72" height="44" rx="3" />
        <text class="cascading-fm-compact-title" x="44" y="51">ROOT SINE</text>
        <text class="cascading-fm-compact-value" x="44" y="66">${formatCascadeFrequency(oscillators[0].freq)}</text>
      </g>
      <text class="cascading-fm-compact-arrow" x="88" y="59">→</text>
      <g class="cascading-fm-compact-node">
        <rect x="102" y="33" width="88" height="44" rx="3" />
        <text class="cascading-fm-compact-title" x="146" y="51">${count - 2} MOD${count - 2 === 1 ? "" : "S"}</text>
        <text class="cascading-fm-compact-value" x="146" y="66">${formatCascadeRatio(settings.cascadeRatio)} ${direction}</text>
      </g>
      <text class="cascading-fm-compact-arrow" x="198" y="59">→</text>
      <g class="cascading-fm-compact-node is-carrier">
        <rect x="212" y="33" width="80" height="44" rx="3" />
        <text class="cascading-fm-compact-title" x="252" y="51">CARRIER</text>
        <text class="cascading-fm-compact-value" x="252" y="66">${formatCascadeFrequency(oscillators[count - 1].freq)}</text>
      </g>
      <text class="cascading-fm-compact-arrow" x="300" y="59">→</text>
      <g class="cascading-fm-compact-node is-carrier">
        <rect x="314" y="33" width="60" height="44" rx="3" />
        <text class="cascading-fm-compact-title" x="344" y="51">AUDIO</text>
        <text class="cascading-fm-compact-value" x="344" y="66">OUT</text>
      </g>
      <text class="cascading-fm-compact-caption" x="8" y="99">EACH SINE MODULATES NEXT OSCILLATOR FREQUENCY</text>
    </svg>`;
}

// ---------------------------------------------------------------------------
// Control bindings
// ---------------------------------------------------------------------------

function currentStack() {
  return deriveCascadeStack(state.settings);
}

function updateSignalFlow(stack) {
  const flow = $("cascadingFmFlow");
  flow.innerHTML = buildFlowSvg(stack);
  const direction = cascadeFrequencyDirection(stack.settings.cascadeRatio);
  flow.setAttribute(
    "aria-label",
    `${stack.oscillators.length}-stage ${direction} cascade: root oscillator at `
      + `${formatCascadeFrequency(stack.oscillators[0].freq)} modulates `
      + `${stack.oscillators.length - 1} successive stage${stack.oscillators.length - 1 === 1 ? "" : "s"} `
      + `up to the carrier at ${formatCascadeFrequency(stack.oscillators[stack.oscillators.length - 1].freq)}.`,
  );
}

function updateControlOutputs(stack = currentStack()) {
  const { settings, oscillators, connections } = stack;
  const direction = cascadeFrequencyDirection(settings.cascadeRatio);
  $("stagesOut").textContent = String(settings.stages);
  $("rootHzOut").textContent = formatCascadeFrequency(settings.rootHz);
  $("cascadeRatioOut").textContent = formatCascadeRatio(settings.cascadeRatio);
  $("cascadeRatio").setAttribute(
    "aria-valuetext",
    `${formatCascadeRatio(settings.cascadeRatio)}; ${direction} stage frequencies`,
  );
  $("modDepthOut").textContent = formatCascadeFrequency(settings.modDepth);
  $("depthTaperOut").textContent = `${settings.depthTaper.toFixed(2)}×`;

  const flatTaper = settings.cascadeRatio;
  $("flatTaperReadout").textContent = `${flatTaper.toFixed(flatTaper < 0.1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")}×`;
  $("taperHint").style.color = Math.abs(settings.depthTaper - flatTaper) < 0.015 ? "var(--cascading-fm-mid)" : "";

  $("structureState").textContent = `${settings.stages} stages · ${formatCascadeRatio(settings.cascadeRatio)} · ${direction}`;
  $("rootReadout").textContent = `${formatCascadeFrequency(settings.rootHz)}${settings.rootHz < 20 ? " LFO" : " oscillator"}`;
  $("carrierReadout").textContent = formatCascadeFrequency(oscillators[oscillators.length - 1].freq);
  $("stagesReadout").textContent = oscillators.map((o) => formatCascadeFrequency(o.freq)).join(" → ");
  $("depthsReadout").textContent = connections.length > 0
    ? connections.map((c) => formatCascadeFrequency(c.depthHz)).join(" · ")
    : "—";
  const rawCarrierHz = settings.rootHz
    * Math.pow(settings.cascadeRatio, settings.stages - 1);
  const outputStageNumber = stack.outputIndex + 1;
  if (rawCarrierHz < 20) {
    $("outputReadout").textContent = `stage ${outputStageNumber} · ${formatCascadeFrequency(rawCarrierHz)} base · sub-audio`;
  } else if (rawCarrierHz > CASCADING_FM_LIMITS.audioCeiling) {
    $("outputReadout").textContent = `stage ${outputStageNumber} · base limited to ${formatCascadeFrequency(CASCADING_FM_LIMITS.audioCeiling)}`;
  } else {
    $("outputReadout").textContent = `stage ${outputStageNumber} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  }

  updateSignalFlow(stack);
  $("stageReadout").textContent = `${settings.stages} STAGES · DRONE · ${engine.running ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Cascading FM live spectrum with a foreground oscilloscope and a ${settings.stages}-stage cascade. Audio ${engine.running ? "on" : "off"}.`,
  );
}

function applySettings(rawSettings, { presetId = null, syncControls = false } = {}) {
  const safe = sanitizeCascadingFmSettings(rawSettings);
  state.settings = { ...safe };
  if (presetId !== null) state.activePresetId = presetId;
  else if (state.activePresetId) {
    const current = CASCADING_FM_PRESETS.find(({ id }) => id === state.activePresetId);
    if (
      current
      && Object.keys(safe).some((k) => safe[k] !== current.settings[k])
    ) {
      state.activePresetId = null;
    }
  }
  // Presets and reset replace the complete tuple, so they synchronize every
  // control. Manual input deliberately leaves the active range thumb alone;
  // writing it back during an input event makes nonlinear sliders feel sticky.
  if (syncControls) writeControlsFromState();
  const stack = engine.running ? engine.updateSettings(safe) : currentStack();
  updatePresetButtons();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
}

function updatePresetButtons() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preset === state.activePresetId),
    );
  }
  const preset = CASCADING_FM_PRESETS.find(({ id }) => id === state.activePresetId);
  $("presetState").textContent = preset?.label ?? "Custom";
  $("presetDescription").textContent = preset?.description ?? "A custom cascade configuration.";
}

// Control definitions — each entry maps a settings key to its slider element.

const controls = {
  stages: {
    input: $("stages"),
    output: $("stagesOut"),
    read: (input) => Math.round(Number(input.value)),
    write: (value, input) => { input.value = String(value); },
  },
  rootHz: {
    input: $("rootHz"),
    output: $("rootHzOut"),
    read: (input) => rootHzSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(rootHzSliderPosition(value)); },
  },
  cascadeRatio: {
    input: $("cascadeRatio"),
    output: $("cascadeRatioOut"),
    read: (input) => ratioSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(ratioSliderPosition(value)); },
  },
  modDepth: {
    input: $("modDepth"),
    output: $("modDepthOut"),
    read: (input) => modDepthSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(modDepthSliderPosition(value)); },
  },
  depthTaper: {
    input: $("depthTaper"),
    output: $("depthTaperOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

controls.stages.input.min = String(CASCADING_FM_LIMITS.minStages);
controls.stages.input.max = String(CASCADING_FM_LIMITS.maxStages);

function writeControlsFromState() {
  for (const [key, control] of Object.entries(controls)) {
    control.write(state.settings[key], control.input);
  }
}

// ---------------------------------------------------------------------------
// Audio UI
// ---------------------------------------------------------------------------

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

function updateAudioUi() {
  const active = engine.running;
  $("audioButton").setAttribute("aria-pressed", String(active));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = active ? "on" : "off";
  updateControlOutputs();
}

// ---------------------------------------------------------------------------
// Canvas resize
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

for (const [key, control] of Object.entries(controls)) {
  control.input.addEventListener("input", () => {
    const value = control.read(control.input);
    if (key === "stages") {
      applySettings({
        ...state.settings,
        stages: value,
        cascadeRatio: cascadeRatioForStageCount(
          state.settings.cascadeRatio,
          state.settings.stages,
          value,
        ),
      }, { syncControls: true });
      return;
    }
    applySettings({ ...state.settings, [key]: value });
  });
}

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = CASCADING_FM_PRESETS.find(({ id }) => id === button.dataset.preset);
  if (!preset) return;
  clearError();
  applySettings(preset.settings, { presetId: preset.id, syncControls: true });
  $("liveStatus").textContent = `${preset.label} preset selected.`;
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
      $("liveStatus").textContent = "Cascading FM audio off.";
    } else {
      await engine.start(state.settings, state.level);
      $("liveStatus").textContent = "Cascading FM audio on.";
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

$("resetCascadingFm").addEventListener("click", () => {
  clearError();
  state.level = DEFAULT_LEVEL;
  $("level").value = String(DEFAULT_LEVEL);
  $("levelOut").textContent = `${Math.round(DEFAULT_LEVEL * 100)}%`;
  engine.setLevel(DEFAULT_LEVEL);
  applySettings(defaultPreset.settings, { presetId: defaultPreset.id, syncControls: true });
  $("liveStatus").textContent = "Parameters reset.";
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

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  updateAudioUi();
  visualizationDirty = true;
  scheduleVisualization();
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

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

writeControlsFromState();
updatePresetButtons();
updateControlOutputs();
resizeCanvas();
