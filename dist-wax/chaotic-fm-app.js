import {
  CHAOTIC_FM_DEFAULTS,
  CHAOTIC_FM_LIMITS,
  CHAOTIC_FM_PARAMETER_IDS,
  CHAOTIC_FM_PERFORMANCE_DEFAULTS,
  CHAOTIC_FM_PRESETS,
  DEFAULT_CHAOTIC_FM_PRESET_ID,
  ChaoticFmAudio,
  ChaoticFmWebMidi,
  chaoticFmFactoryControlChange,
  deriveChaoticFmStack,
  formatChaoticFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeChaoticFmParams,
  sanitizeChaoticFmPerformance,
} from "./src/chaotic-fm.js";
import { buildChaoticFmFlowDiagram } from "./src/chaotic-fm-flow.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";
import { getSharedMidiManager } from "./src/midi-manager.js";

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
const spectrum = createChaoticSpectrum();
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;

const defaultPreset = CHAOTIC_FM_PRESETS.find(
  (preset) => preset.id === DEFAULT_CHAOTIC_FM_PRESET_ID,
) ?? CHAOTIC_FM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  output: CHAOTIC_FM_DEFAULTS.output,
  // Keep the original page's immediate Audio-button sound. The portable
  // engine and plugin default remains MIDI.
  performance: {
    ...CHAOTIC_FM_PERFORMANCE_DEFAULTS,
    playMode: "drone",
  },
  expression: 1,
  sustain: false,
  bend: 0,
  midiHeldNotes: new Map(),
  activePresetId: defaultPreset.id,
  audioOn: false,
  audioStarting: false,
};

let waxStateListener = null;

function currentWaxState() {
  return {
    activePresetId: state.activePresetId,
    parameters: currentParameters(),
    performance: currentPerformance(),
  };
}

function notifyWaxStateChange(source = "user") {
  if (typeof waxStateListener !== "function") return;
  waxStateListener(currentWaxState(), source);
}

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

function logarithmicZeroSliderValue(position, minimum, maximum) {
  const normalized = Number(position);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return logarithmicSliderValue(
    Math.max(0, (normalized - 0.001) / 0.999),
    minimum,
    maximum,
  );
}

function logarithmicZeroSliderPosition(value, minimum, maximum) {
  if (Number(value) <= 0) return 0;
  return 0.001 + logarithmicSliderPosition(value, minimum, maximum) * 0.999;
}

const performanceControls = {
  ampAttackMs: {
    input: $("ampAttackMs"),
    output: $("ampAttackMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 0.5, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 0.5, 5_000));
    },
  },
  ampDecayMs: {
    input: $("ampDecayMs"),
    output: $("ampDecayMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 1, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 1, 5_000));
    },
  },
  ampSustainLevel: {
    input: $("ampSustainLevel"),
    output: $("ampSustainLevelOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  ampReleaseMs: {
    input: $("ampReleaseMs"),
    output: $("ampReleaseMsOut"),
    read: (input) => logarithmicSliderValue(Number(input.value), 2, 10_000),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(value, 2, 10_000));
    },
  },
  glideTimeMs: {
    input: $("glideTimeMs"),
    output: $("glideTimeMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 10, 2_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 10, 2_000));
    },
  },
  rootMidiNote: {
    input: $("rootMidiNote"),
    output: $("rootMidiNoteOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
  pitchBendRangeSemitones: {
    input: $("pitchBendRangeSemitones"),
    output: $("pitchBendRangeSemitonesOut"),
    read: (input) => Number(input.value),
    write: (value, input) => {
      input.value = String(value);
    },
  },
};

const midiBridge = new ChaoticFmWebMidi(globalThis, {
  target: audio,
  onAction: handleMidiAction,
});
const sharedMidiManager = getSharedMidiManager(globalThis);
let sharedMidiEnabled = false;
let unregisterMidiClient = null;

function registerSharedMidiClient() {
  if (unregisterMidiClient) return;
  unregisterMidiClient = sharedMidiManager.registerClient({
    id: "chaotic-fm",
    onMessage: handleSharedMidiMessage,
    onEnabledChange: handleSharedMidiEnabled,
    onPrepareEnable: prepareSharedMidiEnable,
    onProfileChange: handleSharedMidiProfileChange,
  });
}

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

function currentPerformance() {
  return { ...state.performance };
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (milliseconds === 0) return "off";
  if (milliseconds >= 1_000) return `${compactNumber(milliseconds / 1_000, 2)} s`;
  if (milliseconds < 10) return `${compactNumber(milliseconds, 1)} ms`;
  return `${Math.round(milliseconds)} ms`;
}

function midiNoteName(note) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const safe = Math.max(0, Math.min(127, Math.round(Number(note) || 0)));
  return `${names[safe % 12]}${Math.floor(safe / 12) - 1}`;
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

function updateAdsrPreview() {
  const sustainY = 64 - state.performance.ampSustainLevel * 52;
  $("adsrCurve").setAttribute(
    "d",
    `M 8 64 Q 31 12 52 8 Q 76 ${sustainY} 103 ${sustainY} L 171 ${sustainY} Q 202 ${sustainY} 232 64`,
  );
}

function writePerformanceControls() {
  for (const [key, control] of Object.entries(performanceControls)) {
    control.write(state.performance[key], control.input);
  }
  $("glideMode").value = state.performance.glideMode;
  performanceControls.ampAttackMs.output.textContent = formatMilliseconds(
    state.performance.ampAttackMs,
  );
  performanceControls.ampDecayMs.output.textContent = formatMilliseconds(
    state.performance.ampDecayMs,
  );
  performanceControls.ampSustainLevel.output.textContent = `${Math.round(
    state.performance.ampSustainLevel * 100,
  )}%`;
  performanceControls.ampReleaseMs.output.textContent = formatMilliseconds(
    state.performance.ampReleaseMs,
  );
  performanceControls.glideTimeMs.output.textContent = formatMilliseconds(
    state.performance.glideTimeMs,
  );
  performanceControls.rootMidiNote.output.textContent = `${midiNoteName(
    state.performance.rootMidiNote,
  )} · ${state.performance.rootMidiNote}`;
  performanceControls.pitchBendRangeSemitones.output.textContent = `±${compactNumber(
    state.performance.pitchBendRangeSemitones,
    1,
  )} st`;
  $("performanceState").textContent = state.performance.playMode === "drone"
    ? "Drone · continuous"
    : `${state.performance.glideMode} glide · mono`;
  $("expressionValue").textContent = `${Math.round(state.expression * 100)}%`;
  $("expressionMeter").style.setProperty("--expression", state.expression);
  $("sustainState").textContent = state.sustain ? "held" : "up";
  $("bendState").textContent = `${state.bend >= 0 ? "+" : ""}${compactNumber(
    state.bend * state.performance.pitchBendRangeSemitones,
    2,
  )} st`;
  const held = [...state.midiHeldNotes.values()].map(({ note }) => note);
  $("currentNote").textContent = held.length > 0
    ? `${midiNoteName(held.at(-1))} · ${held.at(-1)}`
    : "—";
  updateAdsrPreview();
}

function handleMidiAction(action) {
  let activity = "MIDI";
  let persistentChange = false;
  const noteOwner = `${String(action.sourceId ?? "default")}\u0000${action.channel ?? 0}\u0000${action.note ?? 0}`;
  if (action.type === "noteOn") {
    state.midiHeldNotes.delete(noteOwner);
    state.midiHeldNotes.set(noteOwner, {
      note: action.note,
      velocity: action.velocity,
    });
    activity = `${midiNoteName(action.note)} · velocity ${action.velocity}`;
  } else if (action.type === "noteOff") {
    state.midiHeldNotes.delete(noteOwner);
    activity = `${midiNoteName(action.note)} released`;
  } else if (action.type === "pitchBend") {
    state.bend = action.normalized;
    activity = "Pitch bend";
  } else if (action.type === "controlChange") {
    const semantic = chaoticFmFactoryControlChange(
      action.controller,
      action.value,
    );
    activity = `CC${action.controller} · ${action.value}`;
    if (semantic?.type === "parameter") {
      state.performance = { ...sanitizeChaoticFmPerformance({
        ...state.performance,
        [semantic.key]: semantic.value,
      }) };
      persistentChange = true;
    } else if (semantic?.type === "expression") {
      state.expression = semantic.value;
    } else if (semantic?.type === "sustain") {
      state.sustain = semantic.down;
    } else if (semantic?.type === "allSoundOff" || semantic?.type === "allNotesOff") {
      state.midiHeldNotes.clear();
    } else if (semantic?.type === "resetControllers") {
      state.expression = 1;
      state.sustain = false;
      state.bend = 0;
    }
  }
  $("midiActivity").textContent = activity;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  writePerformanceControls();
  if (persistentChange) notifyWaxStateChange("midi");
}

const MIDI_MACRO_TARGETS = Object.freeze([
  { kind: "algorithm", key: "carrierHz", label: "carrier" },
  { kind: "algorithm", key: "offsetHz", label: "offset" },
  { kind: "algorithm", key: "modulationAmount", label: "amount" },
  { kind: "algorithm", key: "nonlinearityHz", label: "nonlinearity" },
  { kind: "performance", key: "ampAttackMs", label: "attack" },
  { kind: "performance", key: "ampReleaseMs", label: "release" },
  { kind: "performance", key: "glideTimeMs", label: "glide" },
  { kind: "output", label: "output" },
]);

function writeNormalizedMidiInput(input, normalized) {
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const safe = Math.min(1, Math.max(0, Number(normalized) || 0));
  input.value = String(minimum + (maximum - minimum) * safe);
}

function applyLogicalMidiMacro(logical) {
  if (logical?.type !== "macro") return false;
  const target = MIDI_MACRO_TARGETS[logical.index];
  if (!target) return false;
  if (target.kind === "algorithm") {
    const control = controls[target.key];
    writeNormalizedMidiInput(control.input, logical.normalized);
    applySettings({
      ...state.settings,
      [target.key]: control.read(control.input),
    }, { source: "midi" });
  } else if (target.kind === "performance") {
    const control = performanceControls[target.key];
    writeNormalizedMidiInput(control.input, logical.normalized);
    applyPerformanceSettings(
      { [target.key]: control.read(control.input) },
      { source: "midi" },
    );
  } else {
    writeNormalizedMidiInput($("output"), logical.normalized);
    state.output = Number($("output").value);
    audio.setParameters(currentParameters());
    updateReadouts();
    notifyWaxStateChange("midi");
  }
  $("midiActivity").textContent = `Macro ${logical.index + 1} · ${target.label}`;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  return true;
}

function handleSharedMidiMessage(message, nativeEvent = null) {
  if (!message) return null;
  if (applyLogicalMidiMacro(message.logical)) return message;
  if (message.raw?.length) {
    return midiBridge.handleMessage({
      data: message.raw,
      nativeEvent,
      sourceId: message.sourceId,
    });
  }
  if (message.type === "noteOn") {
    audio.noteOn(message.note, message.velocity, message.channel, message.sourceId);
  } else if (message.type === "noteOff") {
    audio.noteOff(message.note, message.channel, message.sourceId);
  } else if (message.type === "pitchBend") {
    audio.pitchBend(message.normalized);
  } else if (message.type === "controlChange") {
    audio.controlChange(message.controller, message.value);
  }
  handleMidiAction(message);
  return message;
}

function handleSharedMidiEnabled(enabled) {
  const nextEnabled = Boolean(enabled);
  if (nextEnabled === sharedMidiEnabled) return;
  sharedMidiEnabled = nextEnabled;
  state.midiHeldNotes.clear();
  state.sustain = false;
  state.bend = 0;
  state.expression = 1;
  if (nextEnabled) {
    applyPerformanceSettings(
      { playMode: "midi" },
      {
        message: "MIDI on · monophonic performance mode selected.",
        source: "midi",
      },
    );
    $("midiActivity").textContent = state.audioOn
      ? "Ready for MIDI"
      : "MIDI on · turn Audio on to perform";
  } else {
    audio.allSoundOff();
    applyPerformanceSettings(
      { playMode: "drone" },
      {
        message: "MIDI off · drone mode restored.",
        source: "midi",
      },
    );
    $("midiActivity").textContent = "MIDI off · drone restored";
  }
  $("midiActivity").classList.remove("is-active");
  writePerformanceControls();
}

function handleSharedMidiProfileChange(profileState) {
  if (!sharedMidiEnabled) return;
  const label = profileState?.selectedProfile?.label ?? "Generic MIDI";
  $("midiActivity").textContent = `${label} mapping ready`;
}

function prepareSharedMidiEnable() {
  return true;
}

function updateSignalFlow(stack) {
  const flow = $("chaoticFmFlow");
  const diagram = buildChaoticFmFlowDiagram(stack, {
    outputLevel: state.output,
  });
  flow.innerHTML = diagram.markup;
  flow.setAttribute("aria-label", diagram.ariaLabel);
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
  updateSignalFlow(stack);
  $("stageReadout").textContent = [
    `${settings.depth} ${recursionWord}`,
    `${stack.operatorCount} operators`,
    state.performance.playMode,
    `audio ${state.audioOn ? "on" : "off"}`,
  ].join(" · ").toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Chaotic FM layered spectrum-bar and oscilloscope analysis with ${settings.depth} nonlinear ${recursionWord}. Audio ${state.audioOn ? "on" : "off"}.`,
  );
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function updateInterface() {
  writeControls();
  writePerformanceControls();
  updatePresetInterface();
  const stack = currentStack();
  updateReadouts(stack);
  audio.setParameters(currentParameters());
  audio.setPerformanceParameters(currentPerformance());
  visualizationDirty = true;
  scheduleVisualization();
}

function applyPerformanceSettings(settings, {
  message = null,
  source = "user",
} = {}) {
  state.performance = { ...sanitizeChaoticFmPerformance({
    ...state.performance,
    ...settings,
  }) };
  audio.setPerformanceParameters(currentPerformance());
  writePerformanceControls();
  updateReadouts();
  if (message) announce(message);
  notifyWaxStateChange(source);
}

function applySettings(settings, {
  presetId = null,
  message = null,
  source = "user",
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
  notifyWaxStateChange(source);
}

for (const [key, control] of Object.entries(controls)) {
  control.input.dataset.parameterId = CHAOTIC_FM_PARAMETER_IDS[key];
  control.input.addEventListener("input", () => {
    applySettings({
      ...state.settings,
      [key]: control.read(control.input),
    });
  });
}


for (const [key, control] of Object.entries(performanceControls)) {
  control.input.dataset.parameterId = CHAOTIC_FM_PARAMETER_IDS[key];
  control.input.addEventListener("input", () => {
    applyPerformanceSettings({ [key]: control.read(control.input) });
  });
}

$("output").dataset.parameterId = CHAOTIC_FM_PARAMETER_IDS.output;
$("glideMode").dataset.parameterId = CHAOTIC_FM_PARAMETER_IDS.glideMode;

$("glideMode").addEventListener("change", () => {
  applyPerformanceSettings(
    { glideMode: $("glideMode").value },
    { message: `${$("glideMode").value} glide mode selected.` },
  );
});

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
  notifyWaxStateChange("user");
});

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  state.audioStarting = true;
  updateAudioInterface();
  try {
    if (state.audioOn) {
      audio.allSoundOff();
      audio.stop();
      state.audioOn = false;
    } else {
      audio.setParameters(currentParameters());
      audio.setPerformanceParameters(currentPerformance());
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
  audio.allSoundOff();
  audio.resetControllers();
  state.output = CHAOTIC_FM_DEFAULTS.output;
  state.performance = {
    ...CHAOTIC_FM_PERFORMANCE_DEFAULTS,
    playMode: sharedMidiEnabled ? "midi" : "drone",
  };
  state.expression = 1;
  state.sustain = false;
  state.bend = 0;
  state.midiHeldNotes.clear();
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
  drawChaoticLiveAnalysis(context2d, {
    analyser: audio.analyser,
    audioOn: state.audioOn,
    height: cssHeight,
    scopeGlow: "rgba(255, 122, 166, 0.72)",
    scopeStroke: "#fff3d6",
    spectrum,
    spectrumBarCap: "rgba(255, 184, 107, 0.72)",
    spectrumBarFill: "rgba(255, 122, 166, 0.28)",
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
  audio.allSoundOff();
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
  unregisterMidiClient?.();
  unregisterMidiClient = null;
  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", resizeCanvas);
  state.audioOn = false;
  void audio.close();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || !disposed) return;
  disposed = false;
  resizeObserver?.observe(stageWrap);
  if (!resizeObserver) globalThis.addEventListener("resize", resizeCanvas);
  registerSharedMidiClient();
  updateAudioInterface();
  resizeCanvas();
  visualizationDirty = true;
  scheduleVisualization();
});

function registerWaxHostAdapter() {
  const wax = globalThis.MorphazoidWAX;
  if (!wax || typeof wax.register !== "function") return;

  try {
    wax.register({
      id: "chaotic-fm",
      stateVersion: 1,

      getState() {
        return currentWaxState();
      },

      applyState(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return;

        if (snapshot.parameters && typeof snapshot.parameters === "object") {
          const safe = sanitizeChaoticFmParams({
            ...currentParameters(),
            ...snapshot.parameters,
          }, {
            sampleRate: audio.context?.sampleRate ?? 48_000,
          });
          state.output = safe.output;
          const presetId = typeof snapshot.activePresetId === "string"
            && presetById(snapshot.activePresetId)
            ? snapshot.activePresetId
            : null;
          applySettings(safe, {
            presetId,
            source: "wax-hydration",
          });
        }

        if (snapshot.performance && typeof snapshot.performance === "object") {
          applyPerformanceSettings(snapshot.performance, {
            source: "wax-hydration",
          });
        }
      },

      subscribeState(listener) {
        waxStateListener = typeof listener === "function" ? listener : null;
        return () => {
          if (waxStateListener === listener) waxStateListener = null;
        };
      },

      async enableMidi() {
        registerSharedMidiClient();
        if (!state.audioOn) {
          applyPerformanceSettings(
            { playMode: "midi" },
            { source: "wax-hydration" },
          );
          await toggleAudio();
        }
        return sharedMidiManager.enable();
      },
    });
  } catch (error) {
    console.error("Chaotic FM WAX adapter failed to register", error);
  }
}

updateInterface();
updateAudioInterface();
resizeCanvas();
registerSharedMidiClient();
registerWaxHostAdapter();
