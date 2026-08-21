import {
  CASCADING_PM_LIMITS,
  CASCADING_PM_PRESETS,
  DEFAULT_CASCADING_PM_PRESET_ID,
  CascadingPmAudioEngine,
  cascadeRatioForStageCount,
  deriveCascadeStack,
  formatCascadeFrequency,
  phaseIndexSliderPosition,
  phaseIndexSliderValue,
  ratioSliderPosition,
  ratioSliderValue,
  rootHzSliderPosition,
  rootHzSliderValue,
  sanitizeCascadingPmSettings,
} from "./src/cascading-pm.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LEVEL = 0.58;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;

const defaultPreset = CASCADING_PM_PRESETS.find(
  ({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID,
) ?? CASCADING_PM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  level: DEFAULT_LEVEL,
  audioStarting: false,
};

const engine = new CascadingPmAudioEngine(window);
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
let resizeObserver = null;

function formatPhaseIndex(value, { unit = true } = {}) {
  const number = Math.max(0, Number(value) || 0);
  const digits = number >= 10 ? 1 : (number >= 1 ? 2 : 3);
  const label = number.toFixed(digits).replace(/\.?0+$/, "");
  return unit ? `${label} rad` : label;
}

function formatCascadeRatio(value) {
  const number = Number(value) || 0;
  // Several presets deliberately sit just off simple ratios. Preserve a
  // decimal through the extended musical range so 11.3 does not read as 11.
  const digits = number < 10 ? 2 : (number < 100 ? 1 : 0);
  return number.toFixed(digits).replace(/\.?0+$/, "");
}

function currentStack() {
  return deriveCascadeStack(state.settings, { sampleRate: engine.sampleRate });
}

function presetById(id) {
  return CASCADING_PM_PRESETS.find((preset) => preset.id === id) ?? null;
}

function renderPresetButtons() {
  const group = $("presetButtons");
  group.replaceChildren(...CASCADING_PM_PRESETS.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", "false");
    return button;
  }));
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
    ?? "A custom chain of nested phase offsets.";
}

// ---------------------------------------------------------------------------
// Canvas visualization
// ---------------------------------------------------------------------------

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
  const rootColor = "#67e8f9";
  const phaseColor = "#c084fc";
  const carrierColor = "#f472b6";

  context.save();
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 0; index < connections.length; index++) {
    const x1 = left + spacing * index;
    const x2 = left + spacing * (index + 1);
    const middle = (x1 + x2) * 0.5;
    context.beginPath();
    context.moveTo(x1 + radius + 3, graphY);
    context.bezierCurveTo(middle - 8, graphY, middle - 8, graphY - 11, middle, graphY - 11);
    context.bezierCurveTo(middle + 8, graphY - 11, middle + 8, graphY, x2 - radius - 3, graphY);
    context.strokeStyle = index === connections.length - 1 ? carrierColor : phaseColor;
    context.globalAlpha = 0.48;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;

    if (spacing > 54) {
      context.fillStyle = "#8d7b9d";
      context.fillText(formatPhaseIndex(connections[index].phaseIndex), middle, graphY - 23);
    }
  }

  for (let index = 0; index < count; index++) {
    const oscillator = oscillators[index];
    const x = left + spacing * index;
    const isRoot = index === 0;
    const isCarrier = index === count - 1;
    const color = isCarrier ? carrierColor : (isRoot ? rootColor : phaseColor);
    const r = isCarrier ? radius + 2 : radius;

    context.beginPath();
    context.arc(x, graphY, r, 0, Math.PI * 2);
    context.fillStyle = isCarrier ? "rgba(244, 114, 182, 0.14)" : "#07090b";
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = isCarrier ? 2 : 1.25;
    context.stroke();

    context.fillStyle = color;
    context.font = `${Math.max(6, Math.min(9, r * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(String(index), x, graphY + 0.5);

    if (spacing > 32 || count <= 7) {
      context.fillStyle = isCarrier ? carrierColor : "#887c91";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(isRoot ? "ROOT" : (isCarrier ? "OUT" : "PHASE"), x, graphY + r + 16);
      if (spacing > 54) {
        context.fillText(formatCascadeFrequency(oscillator.freq), x, graphY + r + 28);
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
    scopeGlow: "rgba(192, 132, 252, 0.66)",
    scopeStroke: "#ffe4f6",
    spectrum,
    spectrumBarCap: "rgba(103, 232, 249, 0.72)",
    spectrumBarFill: "rgba(192, 132, 252, 0.25)",
    waveform: engine.readWaveform(),
    width: cssWidth,
  });
  drawCascadeNodes(canvasContext, currentStack(), cssWidth, cssHeight);
}

function visualizationFrame(timestamp) {
  visualFrameId = null;
  if (visualizationDirty || timestamp - lastVisualFrame >= VISUAL_FRAME_INTERVAL) {
    drawVisualization();
    visualizationDirty = false;
    lastVisualFrame = timestamp;
  }
  if (engine.running && !document.hidden) {
    visualFrameId = requestAnimationFrame(visualizationFrame);
  }
}

function scheduleVisualization() {
  if (visualFrameId === null && !document.hidden) {
    visualFrameId = requestAnimationFrame(visualizationFrame);
  }
}

// ---------------------------------------------------------------------------
// Signal-flow diagram
// ---------------------------------------------------------------------------

function buildFlowSvg(stack) {
  const { oscillators, connections, settings } = stack;
  const count = oscillators.length;
  // Twelve operators still need readable node/index labels at desktop widths.
  const graphWidth = Math.max(900, count * 116 + 235);
  const left = 62;
  const outputX = graphWidth - 132;
  const right = outputX - 126;
  const nodeY = 110;
  const busY = 180;
  const spacing = count > 1 ? (right - left) / (count - 1) : 0;
  const nodeWidth = Math.max(48, Math.min(88, spacing * 0.55));
  const nodeHeight = 46;
  const positions = Array.from({ length: count }, (_, index) => left + spacing * index);

  const connectionMarkup = connections.map((connection, index) => {
    const sourceEdge = positions[index] + nodeWidth * 0.5;
    const targetEdge = positions[index + 1] - nodeWidth * 0.5;
    const junctionX = targetEdge - 9;
    const indexX = sourceEdge + (junctionX - sourceEdge) * 0.5;
    const blockWidth = Math.max(42, Math.min(64, spacing * 0.31));
    return `
      <path class="cascading-pm-phase-wire"
        d="M ${sourceEdge} ${nodeY} L ${indexX - blockWidth * 0.5} ${nodeY}
           M ${indexX + blockWidth * 0.5} ${nodeY} L ${junctionX - 7} ${nodeY}
           M ${junctionX + 7} ${nodeY} L ${targetEdge} ${nodeY}" />
      <g class="cascading-pm-index-block">
        <rect x="${indexX - blockWidth * 0.5}" y="${nodeY - 17}" width="${blockWidth}" height="34" rx="3" />
        <text class="cascading-pm-index-label" x="${indexX}" y="${nodeY - 4}">× INDEX</text>
        <text class="cascading-pm-index-value" x="${indexX}" y="${nodeY + 9}">${formatPhaseIndex(connection.phaseIndex)}</text>
      </g>
      <g class="cascading-pm-junction">
        <circle cx="${junctionX}" cy="${nodeY}" r="7" />
        <text x="${junctionX}" y="${nodeY + 3}">+</text>
      </g>`;
  }).join("");

  const nodeMarkup = oscillators.map((oscillator, index) => {
    const x = positions[index];
    const isRoot = index === 0;
    const isCarrier = index === count - 1;
    const className = `cascading-pm-stage-node${isRoot ? " is-root" : ""}${isCarrier ? " is-carrier" : ""}`;
    const label = isRoot ? "ROOT SINE" : (isCarrier ? "CARRIER" : `PHASE ${index}`);
    return `
      <g class="${className}">
        <rect x="${x - nodeWidth * 0.5}" y="${nodeY - nodeHeight * 0.5}" width="${nodeWidth}" height="${nodeHeight}" rx="4" />
        <text class="cascading-pm-stage-title" x="${x}" y="${nodeY - 6}">${label}</text>
        <text class="cascading-pm-stage-value" x="${x}" y="${nodeY + 8}">${formatCascadeFrequency(oscillator.freq)}</text>
        ${isCarrier ? `<path class="cascading-pm-phase-wire" style="stroke:var(--cascading-pm-output);opacity:.72" d="M ${x} ${nodeY + nodeHeight * 0.5} L ${x} ${busY}" />` : ""}
      </g>`;
  }).join("");

  return `
    <svg class="cascading-pm-flow-detailed" viewBox="0 0 ${graphWidth} 218" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker id="cascadingPmArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${connectionMarkup}
      ${nodeMarkup}
      <path class="cascading-pm-phase-wire" style="stroke:var(--cascading-pm-output);opacity:.72" marker-end="url(#cascadingPmArrow)" d="M ${positions[count - 1]} ${busY} L ${outputX - 6} ${busY}" />
      <g class="cascading-pm-output-node">
        <rect x="${outputX}" y="${busY - 28}" width="118" height="52" rx="4" />
        <text class="cascading-pm-output-label" x="${outputX + 59}" y="${busY - 9}">FINAL SINE</text>
        <text class="cascading-pm-output-value" x="${outputX + 59}" y="${busY + 8}">BOUNDED → AUDIO</text>
      </g>
      <text style="font-family:ui-monospace,monospace;font-size:6px;fill:var(--faint);letter-spacing:.07em" x="${left}" y="208">
        sᵢ = sin(φᵢ + Iᵢsᵢ₋₁) · index ${formatPhaseIndex(settings.phaseIndex)} · taper ${settings.indexTaper.toFixed(2)}×
      </text>
    </svg>
    <svg class="cascading-pm-flow-compact" viewBox="0 0 380 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="cascading-pm-compact-node is-root">
        <rect x="8" y="33" width="72" height="44" rx="3" />
        <text class="cascading-pm-compact-title" x="44" y="51">ROOT SINE</text>
        <text class="cascading-pm-compact-value" x="44" y="66">${formatCascadeFrequency(oscillators[0].freq)}</text>
      </g>
      <text class="cascading-pm-compact-arrow" x="88" y="59">→</text>
      <g class="cascading-pm-compact-node">
        <rect x="102" y="33" width="88" height="44" rx="3" />
        <text class="cascading-pm-compact-title" x="146" y="51">${count - 1} OFFSETS</text>
        <text class="cascading-pm-compact-value" x="146" y="66">${formatPhaseIndex(settings.phaseIndex)}</text>
      </g>
      <text class="cascading-pm-compact-arrow" x="198" y="59">→</text>
      <g class="cascading-pm-compact-node is-carrier">
        <rect x="212" y="33" width="80" height="44" rx="3" />
        <text class="cascading-pm-compact-title" x="252" y="51">CARRIER</text>
        <text class="cascading-pm-compact-value" x="252" y="66">${formatCascadeFrequency(oscillators[count - 1].freq)}</text>
      </g>
      <text class="cascading-pm-compact-arrow" x="300" y="59">→</text>
      <g class="cascading-pm-compact-node is-carrier">
        <rect x="314" y="33" width="60" height="44" rx="3" />
        <text class="cascading-pm-compact-title" x="344" y="51">AUDIO</text>
        <text class="cascading-pm-compact-value" x="344" y="66">OUT</text>
      </g>
      <text class="cascading-pm-compact-caption" x="8" y="99">INDEX = PHASE OFFSET IN RADIANS · BASE FREQUENCIES STAY FIXED</text>
    </svg>`;
}

function updateSignalFlow(stack) {
  const flow = $("cascadingPmFlow");
  flow.innerHTML = buildFlowSvg(stack);
  const carrier = stack.oscillators[stack.oscillators.length - 1];
  flow.setAttribute(
    "aria-label",
    `${stack.oscillators.length}-stage phase cascade. The root sine at ${formatCascadeFrequency(stack.oscillators[0].freq)} offsets each successive phase by indices starting at ${formatPhaseIndex(stack.settings.phaseIndex)}, ending at the ${formatCascadeFrequency(carrier.freq)} carrier.`,
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function updateControlOutputs(stack = currentStack()) {
  const { settings, oscillators, connections } = stack;
  const direction = settings.cascadeRatio < 1
    ? "descending"
    : (settings.cascadeRatio > 1 ? "rising" : "equal");
  $("stagesOut").textContent = String(settings.stages);
  $("rootHzOut").textContent = formatCascadeFrequency(settings.rootHz);
  $("cascadeRatioOut").textContent = `×${formatCascadeRatio(settings.cascadeRatio)}`;
  $("cascadeRatio").setAttribute(
    "aria-valuetext",
    `times ${formatCascadeRatio(settings.cascadeRatio)}; ${direction} stage frequencies`,
  );
  $("phaseIndexOut").textContent = formatPhaseIndex(settings.phaseIndex);
  $("indexTaperOut").textContent = `${settings.indexTaper.toFixed(2)}×`;
  $("taperHint").style.color = Math.abs(settings.indexTaper - 1) < 0.015 ? "var(--cascading-pm-root)" : "";

  $("structureState").textContent = `${settings.stages} stages · ×${formatCascadeRatio(settings.cascadeRatio)} · ${direction}`;
  $("rootReadout").textContent = `${formatCascadeFrequency(settings.rootHz)}${settings.rootHz < 20 ? " LFO" : ""}`;
  $("carrierReadout").textContent = formatCascadeFrequency(oscillators[oscillators.length - 1].freq);
  $("stagesReadout").textContent = oscillators.map((oscillator) => formatCascadeFrequency(oscillator.freq)).join(" → ");
  $("indicesReadout").textContent = connections.length
    ? `${connections.map((connection) => (
      `${formatPhaseIndex(connection.phaseIndex)}${connection.wasLimited ? " (safe)" : ""}`
    )).join(" · ")}`
    : "—";
  const safetyLimits = [];
  if (stack.boundedByFrequency) safetyLimits.push("base frequency");
  if (stack.boundedByBandwidth) safetyLimits.push("PM bandwidth");
  if (stack.boundedByInternalIndex) safetyLimits.push("phase index");
  const rawCarrierHz = oscillators[oscillators.length - 1].rawFrequencyHz;
  const outputStageNumber = stack.outputIndex + 1;
  if (rawCarrierHz < 20) {
    $("outputReadout").textContent = `stage ${outputStageNumber} · ${formatCascadeFrequency(rawCarrierHz)} base · sub-audio`;
    $("cascadeSafetyNote").textContent = "The final base carrier is below 20 Hz. Raise Root or Cascade ratio to bring it into the audio range; PM sidebands may still remain audible.";
  } else {
    $("outputReadout").textContent = safetyLimits.length
      ? `stage ${outputStageNumber} · safety limited`
      : `stage ${outputStageNumber} · bounded final sine`;
    $("cascadeSafetyNote").textContent = safetyLimits.length
      ? `Safety guard active: ${safetyLimits.join(" + ")} limited to retain bandwidth headroom below Nyquist.`
      : "Every connection offsets phase, not oscillator frequency. Base frequencies and phase indices retain bandwidth headroom below Nyquist.";
  }

  updateSignalFlow(stack);
  $("stageReadout").textContent = `${settings.stages} STAGES · PHASE CHAIN · ${engine.running ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Cascading PM live spectrum with a foreground oscilloscope and a ${settings.stages}-stage nested phase chain. Audio ${engine.running ? "on" : "off"}.`,
  );
}

function applySettings(rawSettings, { presetId = null, syncControls = false } = {}) {
  const safe = sanitizeCascadingPmSettings(rawSettings, { sampleRate: engine.sampleRate });
  state.settings = { ...safe };
  if (presetId !== null) {
    state.activePresetId = presetId;
  } else if (state.activePresetId) {
    const preset = presetById(state.activePresetId);
    if (preset && Object.keys(preset.settings).some((key) => safe[key] !== preset.settings[key])) {
      state.activePresetId = null;
    }
  }

  if (syncControls) writeControlsFromState();
  const stack = engine.running ? engine.updateSettings(safe) : currentStack();
  updatePresetButtons();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
}

const controls = {
  stages: {
    input: $("stages"),
    read: (input) => Math.round(Number(input.value)),
    write: (value, input) => { input.value = String(value); },
  },
  rootHz: {
    input: $("rootHz"),
    read: (input) => rootHzSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(rootHzSliderPosition(value)); },
  },
  cascadeRatio: {
    input: $("cascadeRatio"),
    read: (input) => ratioSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(ratioSliderPosition(value)); },
  },
  phaseIndex: {
    input: $("phaseIndex"),
    read: (input) => phaseIndexSliderValue(Number(input.value)),
    write: (value, input) => { input.value = String(phaseIndexSliderPosition(value)); },
  },
  indexTaper: {
    input: $("indexTaper"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

// Keep the direct integer control in lockstep with the synthesis guardrails.
controls.stages.input.min = String(CASCADING_PM_LIMITS.minStages);
controls.stages.input.max = String(CASCADING_PM_LIMITS.maxStages);

function writeControlsFromState() {
  for (const [key, control] of Object.entries(controls)) {
    control.write(state.settings[key], control.input);
  }
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

function updateAudioUi() {
  const active = engine.running;
  $("audioButton").setAttribute("aria-pressed", String(active));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = active ? "on" : "off";
  updateControlOutputs();
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
  const preset = presetById(button.dataset.preset);
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
      $("liveStatus").textContent = "Cascading PM audio off.";
    } else {
      await engine.start(state.settings, state.level);
      $("liveStatus").textContent = "Cascading PM audio on.";
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

$("resetCascadingPm").addEventListener("click", () => {
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
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stageWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}

renderPresetButtons();
writeControlsFromState();
updatePresetButtons();
updateControlOutputs();
resizeCanvas();

// Useful for module-level smoke tests without exposing mutable state.
export { buildFlowSvg, formatPhaseIndex };
