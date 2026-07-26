import {
  DEFAULT_WEIERSTRASS_PRESET_ID,
  WEIERSTRASS_DEFAULTS,
  WEIERSTRASS_FM_PRESETS,
  WEIERSTRASS_LIMITS,
  WEIERSTRASS_PM_PRESETS,
  WEIERSTRASS_PRESETS,
  WEIERSTRASS_WAVE_PRESETS,
  WeierstrassAudio,
  deriveWeierstrassBank,
  deriveWeierstrassFmHeadroom,
  deriveWeierstrassPmHeadroom,
  formatWeierstrassFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeWeierstrassParams,
} from "./src/weierstrass.js";
import {
  createChaoticSpectrogram,
  drawChaoticScope,
  drawChaoticSpectrogram,
  updateChaoticSpectrogram,
} from "./src/chaotic-synth-visuals.js";

const $ = (id) => document.getElementById(id);
const FRAME_INTERVAL = 1_000 / 30;
const TAU = Math.PI * 2;
const audio = new WeierstrassAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const stageWrap = $("stageWrap");
const waveform = new Float32Array(512);
const spectrogram = createChaoticSpectrogram(document, {
  width: 360,
  height: 96,
});
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;

const defaultPreset = WEIERSTRASS_PRESETS.find(
  (preset) => preset.id === DEFAULT_WEIERSTRASS_PRESET_ID,
) ?? WEIERSTRASS_WAVE_PRESETS[0];
const defaultFmPreset = WEIERSTRASS_FM_PRESETS[0];
const defaultPmPreset = WEIERSTRASS_PM_PRESETS[0];

const state = {
  settings: {
    ...defaultPreset.settings,
    fmDepthHz: defaultFmPreset.settings.fmDepthHz,
    offsetHz: defaultFmPreset.settings.offsetHz,
    pmCarrierFrequencyHz: defaultPmPreset.settings.pmCarrierFrequencyHz,
    pmIndexCycles: defaultPmPreset.settings.pmIndexCycles,
  },
  fmMemory: {
    fmDepthHz: defaultFmPreset.settings.fmDepthHz,
    offsetHz: defaultFmPreset.settings.offsetHz,
  },
  pmMemory: {
    pmCarrierFrequencyHz: defaultPmPreset.settings.pmCarrierFrequencyHz,
    pmIndexCycles: defaultPmPreset.settings.pmIndexCycles,
  },
  output: WEIERSTRASS_DEFAULTS.output,
  activePresetId: defaultPreset.id,
  audioOn: false,
  audioStarting: false,
  visualZoom: 1,
};

let frameId = null;
let lastDrawTime = -Infinity;
let visualizationDirty = true;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let disposed = false;

const controls = {
  terms: {
    input: $("terms"),
    output: $("termsOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  startExponent: {
    input: $("startExponent"),
    output: $("startExponentOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  amplitudeRatio: {
    input: $("amplitudeRatio"),
    output: $("amplitudeRatioOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  frequencyRatio: {
    input: $("frequencyRatio"),
    output: $("frequencyRatioOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  baseFrequencyHz: {
    input: $("baseFrequency"),
    output: $("baseFrequencyOut"),
    read: (input) => logarithmicSliderValue(
      Number(input.value),
      WEIERSTRASS_LIMITS.minBaseFrequencyHz,
      WEIERSTRASS_LIMITS.maxBaseFrequencyHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(
        value,
        WEIERSTRASS_LIMITS.minBaseFrequencyHz,
        WEIERSTRASS_LIMITS.maxBaseFrequencyHz,
      ));
    },
  },
  fmDepthHz: {
    input: $("fmDepth"),
    output: $("fmDepthOut"),
    read: (input) => quadraticSliderValue(
      Number(input.value),
      WEIERSTRASS_LIMITS.maxFmDepthHz,
    ),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(
        value,
        WEIERSTRASS_LIMITS.maxFmDepthHz,
      ));
    },
  },
  offsetHz: {
    input: $("offset"),
    output: $("offsetOut"),
    read: (input) => quadraticSliderValue(
      Number(input.value),
      WEIERSTRASS_LIMITS.maxOffsetHz,
    ),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(
        value,
        WEIERSTRASS_LIMITS.maxOffsetHz,
      ));
    },
  },
  pmCarrierFrequencyHz: {
    input: $("pmCarrierFrequency"),
    output: $("pmCarrierFrequencyOut"),
    read: (input) => logarithmicSliderValue(
      Number(input.value),
      WEIERSTRASS_LIMITS.minPmCarrierFrequencyHz,
      WEIERSTRASS_LIMITS.maxPmCarrierFrequencyHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(
        value,
        WEIERSTRASS_LIMITS.minPmCarrierFrequencyHz,
        WEIERSTRASS_LIMITS.maxPmCarrierFrequencyHz,
      ));
    },
  },
  pmIndexCycles: {
    input: $("pmIndex"),
    output: $("pmIndexOut"),
    read: (input) => quadraticSliderValue(
      Number(input.value),
      WEIERSTRASS_LIMITS.maxPmIndexCycles,
    ),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(
        value,
        WEIERSTRASS_LIMITS.maxPmIndexCycles,
      ));
    },
  },
};

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function compactNumber(value, maximumDigits = 3) {
  const compact = Number(value)
    .toFixed(maximumDigits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return compact === "" || compact === "-" ? "0" : compact;
}

function formatCycleCount(value) {
  const cycles = compactNumber(value, 3);
  return `${cycles} ${Math.abs(Number(value) - 1) < 1e-9 ? "cycle" : "cycles"}`;
}

function presetById(id) {
  return WEIERSTRASS_PRESETS.find((preset) => preset.id === id) ?? null;
}

function presetsForMode(mode) {
  if (mode === "fm") return WEIERSTRASS_FM_PRESETS;
  if (mode === "pm") return WEIERSTRASS_PM_PRESETS;
  return WEIERSTRASS_WAVE_PRESETS;
}

function modeLabel(mode) {
  if (mode === "fm") return "FM";
  if (mode === "pm") return "PM";
  return "Wave";
}

function settingsMatchPreset(settings, preset) {
  if (!preset || settings.mode !== preset.mode) return false;
  const sharedKeys = [
    "terms",
    "startExponent",
    "amplitudeRatio",
    "frequencyRatio",
    "baseFrequencyHz",
  ];
  if (sharedKeys.some((key) => settings[key] !== preset.settings[key])) {
    return false;
  }
  if (settings.mode === "fm") {
    return (
      settings.fmDepthHz === preset.settings.fmDepthHz
      && settings.offsetHz === preset.settings.offsetHz
    );
  }
  if (settings.mode === "pm") {
    return (
      settings.pmCarrierFrequencyHz
        === preset.settings.pmCarrierFrequencyHz
      && settings.pmIndexCycles === preset.settings.pmIndexCycles
    );
  }
  return true;
}

function matchingPresetId(settings) {
  return presetsForMode(settings.mode).find(
    (preset) => settingsMatchPreset(settings, preset),
  )?.id ?? null;
}

function currentParameters() {
  return {
    ...state.settings,
    output: state.output,
  };
}

function currentSampleRate() {
  return audio.context?.sampleRate ?? 48_000;
}

function currentBank() {
  return deriveWeierstrassBank(currentParameters(), {
    sampleRate: currentSampleRate(),
  });
}

function currentHeadroom() {
  return deriveWeierstrassFmHeadroom(currentParameters(), {
    sampleRate: currentSampleRate(),
  });
}

function currentPmHeadroom() {
  return deriveWeierstrassPmHeadroom(currentParameters(), {
    sampleRate: currentSampleRate(),
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

function updateModeInterface() {
  for (const button of $("modeButtons").querySelectorAll("[data-mode]")) {
    setPressed(button, button.dataset.mode === state.settings.mode);
  }
  for (const button of $("presetButtons").querySelectorAll("[data-mode]")) {
    button.hidden = button.dataset.mode !== state.settings.mode;
  }
  $("fmControls").hidden = state.settings.mode !== "fm";
  $("pmControls").hidden = state.settings.mode !== "pm";
  $("depthLedgerRow").hidden = state.settings.mode !== "fm";
  $("pmLedgerRow").hidden = state.settings.mode !== "pm";
}

function updatePresetInterface() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.activePresetId);
  }
  const preset = presetById(state.activePresetId);
  const label = modeLabel(state.settings.mode);
  $("presetState").textContent = preset?.label ?? `Custom ${label}`;
  $("presetDescription").textContent = preset?.description
    ?? (
      state.settings.mode === "pm"
        ? "A custom raw-phase Weierstrass PM bank."
        : `A custom normalized Weierstrass ${label} bank.`
    );
}

function activeFrequencyRange(bank) {
  let minimum = Infinity;
  let maximum = 0;
  for (const partial of bank.partials) {
    if (!partial.active) continue;
    minimum = Math.min(minimum, partial.frequencyHz);
    maximum = Math.max(maximum, partial.frequencyHz);
  }
  if (!Number.isFinite(minimum) || maximum <= 0) return null;
  return { minimum, maximum };
}

function updateReadouts(
  bank = currentBank(),
  headroom = currentHeadroom(),
  pmHeadroom = currentPmHeadroom(),
) {
  const settings = bank.settings;
  controls.terms.output.textContent = String(settings.terms);
  controls.startExponent.output.textContent = String(settings.startExponent);
  controls.amplitudeRatio.output.textContent = compactNumber(
    settings.amplitudeRatio,
    3,
  );
  controls.frequencyRatio.output.textContent = `${compactNumber(
    settings.frequencyRatio,
    3,
  )}×`;
  controls.baseFrequencyHz.output.textContent = formatWeierstrassFrequency(
    settings.baseFrequencyHz,
  );
  controls.fmDepthHz.output.textContent = formatWeierstrassFrequency(
    settings.fmDepthHz,
  );
  controls.offsetHz.output.textContent = formatWeierstrassFrequency(
    settings.offsetHz,
  );
  controls.pmCarrierFrequencyHz.output.textContent = (
    formatWeierstrassFrequency(settings.pmCarrierFrequencyHz)
  );
  controls.pmIndexCycles.output.textContent = formatCycleCount(
    settings.pmIndexCycles,
  );
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;

  const label = modeLabel(settings.mode);
  $("algorithmState").textContent = settings.mode === "fm"
    ? "FM · normalized + bounded"
    : settings.mode === "pm"
      ? "PM · source wrap + bounded"
      : "Wave · normalized";
  $("modeReadout").textContent = settings.mode === "fm"
    ? "normalized bank → signed oscillator Hz"
    : settings.mode === "pm"
      ? "sin(2π · wrap(W + I · sin φ))"
      : "normalized active Wave bank";
  $("frequencyPolicyNote").textContent = settings.mode === "pm"
    ? "Logarithmic · PM source “fundamental” ÷ 8 because its phasor reset over 240 seconds"
    : "Logarithmic · source “fundamental” ÷ 2 because its π phasor ran at half-rate";
  $("termReadout").textContent = [
    `${bank.requestedCount} requested`,
    `${bank.activeCount} active`,
    `${bank.culledCount} culled`,
  ].join(" · ");
  const range = activeFrequencyRange(bank);
  $("rangeReadout").textContent = range
    ? `${formatWeierstrassFrequency(range.minimum)} → ${formatWeierstrassFrequency(range.maximum)}`
    : "no portable active partials";

  const preset = presetById(state.activePresetId);
  if (preset) {
    const sourceParts = [
      `${compactNumber(preset.source.legacyFundamental)} source`,
      `→ ${formatWeierstrassFrequency(preset.source.baseFrequencyHz)}`,
    ];
    if (
      preset.source.legacyStartExponent
      !== preset.source.playableStartExponent
    ) {
      sourceParts.push(
        `· exponent ${preset.source.legacyStartExponent}→${preset.source.playableStartExponent}`,
      );
    } else if (preset.source.origin === "native") {
      sourceParts.push("· native PM tuple");
    } else if (settings.mode === "pm") {
      sourceParts.push("· source timing ÷ 8");
    }
    $("sourceReadout").textContent = sourceParts.join(" ");
  } else {
    $("sourceReadout").textContent = (
      settings.mode === "pm"
        ? `PM source eighth-rate policy · ${formatWeierstrassFrequency(settings.baseFrequencyHz)}`
        : `π-source half-rate policy · ${formatWeierstrassFrequency(settings.baseFrequencyHz)}`
    );
  }

  const depthStatus = headroom.limited ? "bounded" : "rendered";
  $("depthReadout").textContent = [
    `${formatWeierstrassFrequency(headroom.requestedDepthHz)} requested`,
    `${formatWeierstrassFrequency(headroom.effectiveDepthHz)} ${depthStatus}`,
  ].join(" · ");
  const pmStatus = pmHeadroom.limited ? "bounded" : "rendered";
  const pmParts = [
    `${formatCycleCount(pmHeadroom.requestedIndexCycles)} requested`,
    `${formatCycleCount(pmHeadroom.effectiveIndexCycles)} ${pmStatus}`,
  ];
  if (pmHeadroom.bankScale + 1e-9 < 1) {
    pmParts.push(`${Math.round(pmHeadroom.bankScale * 100)}% W scale`);
  }
  $("pmReadout").textContent = pmParts.join(" · ");
  $("ceilingReadout").textContent = (
    settings.mode === "pm"
      ? `${formatWeierstrassFrequency(settings.maximumFrequencyHz)} · phase-rate budget`
      : `${formatWeierstrassFrequency(settings.maximumFrequencyHz)} · tapered + signed clamp`
  );
  $("stageReadout").textContent = [
    label,
    `${bank.requestedCount} requested`,
    `${bank.activeCount} active`,
    `audio ${state.audioOn ? "on" : "off"}`,
  ].join(" · ").toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Weierstrass ${label} bank with ${bank.requestedCount} requested, `
      + `${bank.activeCount} active, and ${bank.culledCount} culled terms. `
      + `Audio ${state.audioOn ? "on" : "off"}.`,
  );
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function updateInterface() {
  writeControls();
  updateModeInterface();
  updatePresetInterface();
  const bank = currentBank();
  const headroom = currentHeadroom();
  const pmHeadroom = currentPmHeadroom();
  updateReadouts(bank, headroom, pmHeadroom);
  audio.setParameters(currentParameters());
  visualizationDirty = true;
  scheduleVisualization();
}

function applySettings(settings, {
  presetId,
  message = null,
} = {}) {
  const nextMode = settings.mode ?? state.settings.mode;
  const mergedSettings = {
    ...state.settings,
    ...settings,
  };
  if (nextMode !== "fm") {
    mergedSettings.fmDepthHz = state.fmMemory.fmDepthHz;
    mergedSettings.offsetHz = state.fmMemory.offsetHz;
  }
  if (nextMode !== "pm") {
    mergedSettings.pmCarrierFrequencyHz = (
      state.pmMemory.pmCarrierFrequencyHz
    );
    mergedSettings.pmIndexCycles = state.pmMemory.pmIndexCycles;
  }
  const safe = sanitizeWeierstrassParams({
    ...mergedSettings,
    output: state.output,
  }, {
    sampleRate: currentSampleRate(),
  });
  state.settings = {
    mode: safe.mode,
    terms: safe.terms,
    startExponent: safe.startExponent,
    amplitudeRatio: safe.amplitudeRatio,
    frequencyRatio: safe.frequencyRatio,
    baseFrequencyHz: safe.baseFrequencyHz,
    fmDepthHz: safe.fmDepthHz,
    offsetHz: safe.offsetHz,
    pmCarrierFrequencyHz: safe.pmCarrierFrequencyHz,
    pmIndexCycles: safe.pmIndexCycles,
  };
  if (safe.mode === "fm") {
    state.fmMemory.fmDepthHz = safe.fmDepthHz;
    state.fmMemory.offsetHz = safe.offsetHz;
  }
  if (safe.mode === "pm") {
    state.pmMemory.pmCarrierFrequencyHz = safe.pmCarrierFrequencyHz;
    state.pmMemory.pmIndexCycles = safe.pmIndexCycles;
  }
  state.activePresetId = presetId === undefined
    ? matchingPresetId(state.settings)
    : presetId;
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

$("modeButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button || button.dataset.mode === state.settings.mode) return;
  clearError();
  applySettings({
    ...state.settings,
    mode: button.dataset.mode,
    fmDepthHz: state.fmMemory.fmDepthHz,
    offsetHz: state.fmMemory.offsetHz,
    pmCarrierFrequencyHz: state.pmMemory.pmCarrierFrequencyHz,
    pmIndexCycles: state.pmMemory.pmIndexCycles,
  }, {
    message: `${modeLabel(button.dataset.mode)} mode selected. Shared lattice preserved.`,
  });
});

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = presetById(button.dataset.preset);
  if (!preset) return;
  clearError();
  applySettings(preset.settings, {
    presetId: preset.id,
    message: `${preset.label} ${modeLabel(preset.mode)} preset selected.`,
  });
});

$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  audio.setParameters(currentParameters());
  updateReadouts();
});

$("visualZoom").addEventListener("input", () => {
  state.visualZoom = Number($("visualZoom").value);
  $("visualZoomOut").textContent = `${state.visualZoom.toFixed(1)}×`;
  visualizationDirty = true;
  scheduleVisualization();
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

$("resetWeierstrass").addEventListener("click", () => {
  clearError();
  state.output = WEIERSTRASS_DEFAULTS.output;
  state.fmMemory.fmDepthHz = defaultFmPreset.settings.fmDepthHz;
  state.fmMemory.offsetHz = defaultFmPreset.settings.offsetHz;
  state.pmMemory.pmCarrierFrequencyHz = (
    defaultPmPreset.settings.pmCarrierFrequencyHz
  );
  state.pmMemory.pmIndexCycles = defaultPmPreset.settings.pmIndexCycles;
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    message: "Weierstrass parameters reset.",
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
    terms: state.settings.terms + increment,
  });
  announce(`${state.settings.terms} requested terms.`);
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

function logarithmicX(frequency, minimum, maximum, left, right) {
  const safe = Math.min(maximum, Math.max(minimum, frequency));
  const position = Math.log(safe / minimum) / Math.log(maximum / minimum);
  return left + position * (right - left);
}

function latticeFrequencyBounds(bank) {
  const fullMinimum = WEIERSTRASS_LIMITS.minBaseFrequencyHz;
  const fullMaximum = bank.settings.maximumFrequencyHz;
  const fullMinimumLog = Math.log(fullMinimum);
  const fullMaximumLog = Math.log(fullMaximum);
  if (state.visualZoom <= 1) {
    return { minimum: fullMinimum, maximum: fullMaximum };
  }
  const activeRange = activeFrequencyRange(bank);
  const center = activeRange
    ? (Math.log(activeRange.minimum) + Math.log(activeRange.maximum)) * 0.5
    : (fullMinimumLog + fullMaximumLog) * 0.5;
  const span = (fullMaximumLog - fullMinimumLog) / state.visualZoom;
  const minimumLog = Math.min(
    fullMaximumLog - span,
    Math.max(fullMinimumLog, center - span * 0.5),
  );
  return {
    minimum: Math.exp(minimumLog),
    maximum: Math.exp(minimumLog + span),
  };
}

function analysisRegions(width, height) {
  const left = Math.max(24, width * 0.045);
  const right = width - left;
  const scopeTop = Math.max(108, Math.min(height * 0.19, 146));
  const scopeBottom = Math.max(
    scopeTop + 48,
    Math.min(height * 0.3, scopeTop + 96),
  );
  const spectrogramTop = scopeBottom + 8;
  const spectrogramBottom = Math.max(
    spectrogramTop + 42,
    Math.min(height * 0.43, spectrogramTop + 96),
  );
  return {
    left,
    right,
    scopeTop,
    scopeBottom,
    spectrogramTop,
    spectrogramBottom,
  };
}

function drawPartialLattice(context, bank, width, height, timestamp) {
  const left = Math.max(28, width * 0.055);
  const right = width - left;
  const top = Math.max(250, height * 0.51);
  const bottom = Math.max(top + 80, height - 54);
  const frequencyBounds = latticeFrequencyBounds(bank);
  const minimumHz = frequencyBounds.minimum;
  const maximumHz = frequencyBounds.maximum;
  const motion = state.audioOn && !reducedMotion
    ? timestamp * 0.00018
    : 0;

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(214, 232, 226, 0.08)";
  context.beginPath();
  for (let octave = 0.001; octave <= maximumHz; octave *= 10) {
    if (octave < minimumHz) continue;
    const x = logarithmicX(octave, minimumHz, maximumHz, left, right);
    context.moveTo(x, top);
    context.lineTo(x, bottom);
  }
  context.stroke();

  context.beginPath();
  let started = false;
  for (const partial of bank.partials) {
    if (!partial.active) continue;
    const x = logarithmicX(
      partial.frequencyHz,
      minimumHz,
      maximumHz,
      left,
      right,
    );
    const progress = bank.requestedCount > 1
      ? partial.index / (bank.requestedCount - 1)
      : 0.5;
    const y = bottom - progress * (bottom - top);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  }
  context.strokeStyle = "rgba(125, 180, 255, 0.28)";
  context.stroke();

  for (const partial of bank.partials) {
    const clampedFrequency = Number.isFinite(partial.frequencyHz)
      ? partial.frequencyHz
      : maximumHz;
    const x = logarithmicX(
      clampedFrequency,
      minimumHz,
      maximumHz,
      left,
      right,
    );
    const progress = bank.requestedCount > 1
      ? partial.index / (bank.requestedCount - 1)
      : 0.5;
    const y = bottom - progress * (bottom - top);
    const normalizedMagnitude = Math.abs(partial.normalizedWeight);
    const radius = partial.active
      ? 2.6 + Math.sqrt(normalizedMagnitude) * 9
      : 2.2;

    context.beginPath();
    context.arc(
      x,
      y + (partial.active ? Math.sin(motion + partial.index) * 1.5 : 0),
      radius,
      0,
      TAU,
    );
    if (!partial.active) {
      context.fillStyle = "rgba(119, 131, 126, 0.12)";
      context.strokeStyle = "rgba(119, 131, 126, 0.32)";
    } else if (partial.taper < 0.999) {
      context.fillStyle = "rgba(232, 196, 107, 0.2)";
      context.strokeStyle = "#e8c46b";
    } else {
      context.fillStyle = state.settings.mode === "fm"
        ? "rgba(199, 155, 255, 0.2)"
        : state.settings.mode === "pm"
          ? "rgba(255, 159, 115, 0.2)"
          : "rgba(125, 180, 255, 0.2)";
      context.strokeStyle = state.settings.mode === "fm"
        ? "#c79bff"
        : state.settings.mode === "pm"
          ? "#ff9f73"
          : "#7db4ff";
    }
    context.fill();
    context.stroke();
    if (bank.requestedCount <= 16 || partial.index % 4 === 0) {
      context.fillStyle = partial.active ? "#aebbb5" : "#59625e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "center";
      context.fillText(`n${partial.exponent}`, x, y - radius - 7);
    }
  }

  context.fillStyle = "#77837e";
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.fillText(formatWeierstrassFrequency(minimumHz), left, bottom + 20);
  context.textAlign = "right";
  context.fillText(formatWeierstrassFrequency(maximumHz), right, bottom + 20);
  context.restore();
}

function drawAnalysis(context, width, height) {
  const regions = analysisRegions(width, height);
  const hasWaveform = state.audioOn && audio.getWaveform(waveform);
  const stroke = state.settings.mode === "fm"
    ? "#c79bff"
    : state.settings.mode === "pm"
      ? "#ff9f73"
      : "#7db4ff";
  const glow = state.settings.mode === "fm"
    ? "rgba(199, 155, 255, 0.4)"
    : state.settings.mode === "pm"
      ? "rgba(255, 159, 115, 0.4)"
      : "rgba(125, 180, 255, 0.4)";
  if (state.audioOn) {
    updateChaoticSpectrogram(spectrogram, audio.analyser, {
      hue: state.settings.mode === "fm"
        ? 270
        : state.settings.mode === "pm"
          ? 18
          : 215,
    });
  }
  drawChaoticScope(context, hasWaveform ? waveform : null, regions, {
    stroke,
    glow,
  });
  drawChaoticSpectrogram(context, spectrogram, regions);
}

function draw(timestamp) {
  if (!context2d || disposed) return;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context2d.clearRect(0, 0, cssWidth, cssHeight);
  drawAnalysis(context2d, cssWidth, cssHeight);
  drawPartialLattice(
    context2d,
    currentBank(),
    cssWidth,
    cssHeight,
    timestamp,
  );
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
