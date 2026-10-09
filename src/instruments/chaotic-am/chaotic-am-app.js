import { registerHeaderPresets } from "../../site/header-presets.js";
import { chaoticAmPresets, CHAOTIC_AM_PRESET_PERFORMANCE_KEYS } from "./full-presets.js";
import {
  CHAOTIC_AM_DEFAULTS,
  CHAOTIC_AM_LIMITS,
  CHAOTIC_AM_PARAMETER_IDS,
  CHAOTIC_AM_PERFORMANCE_DEFAULTS,
  CHAOTIC_AM_PRESETS,
  DEFAULT_CHAOTIC_AM_PRESET_ID,
  ChaoticAmAudio,
  chaoticAmModulationDepth,
  chaoticAmFactoryControlChange,
  deriveChaoticAmStack,
  formatChaoticAmFrequency,
  formatChaoticAmNumber,
  logarithmicChaoticAmPosition,
  logarithmicChaoticAmValue,
  sanitizeChaoticAmParams,
  sanitizeChaoticAmPerformance,
  summarizeChaoticAmStack,
} from "./chaotic-am.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "../../families/chaotic/chaotic-synth-visuals.js";
import { getSharedMidiManager } from "../../midi-manager.js";
import { canvasSizing } from "../../graphics/canvas-sizing.js";

const $ = (id) => document.getElementById(id);
const VISUAL_FRAME_INTERVAL = 1_000 / 30;
let presetController = null;

const defaultPreset = CHAOTIC_AM_PRESETS.find(
  ({ id }) => id === DEFAULT_CHAOTIC_AM_PRESET_ID,
) ?? CHAOTIC_AM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  output: CHAOTIC_AM_DEFAULTS.output,
  performance: { ...CHAOTIC_AM_PERFORMANCE_DEFAULTS, ...defaultPreset.performance },
  expression: 1,
  sustain: false,
  bend: 0,
  midiHeldNotes: new Map(),
  midiSelectedNote: null,
  midiActive: false,
  audioStarting: false,
};

const audio = new ChaoticAmAudio(globalThis);
const canvas = $("stage");
const canvasContext = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const spectrum = createChaoticSpectrum();
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
    read: (input) => logarithmicChaoticAmValue(
      Number(input.value),
      CHAOTIC_AM_LIMITS.minCarrierHz,
      CHAOTIC_AM_LIMITS.maxCarrierHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticAmPosition(
        value,
        CHAOTIC_AM_LIMITS.minCarrierHz,
        CHAOTIC_AM_LIMITS.maxCarrierHz,
      ));
    },
  },
  startModFrequencyHz: {
    input: $("modFrequency"),
    output: $("modFrequencyOut"),
    read: (input) => logarithmicChaoticAmValue(
      Number(input.value),
      CHAOTIC_AM_LIMITS.minModFrequencyHz,
      CHAOTIC_AM_LIMITS.maxModFrequencyHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticAmPosition(
        value,
        CHAOTIC_AM_LIMITS.minModFrequencyHz,
        CHAOTIC_AM_LIMITS.maxModFrequencyHz,
      ));
    },
  },
  frequencyDivisor: {
    input: $("frequencyDivisor"),
    output: $("frequencyDivisorOut"),
    read: (input) => logarithmicChaoticAmValue(Number(input.value),
      CHAOTIC_AM_LIMITS.minFrequencyDivisor, CHAOTIC_AM_LIMITS.maxFrequencyDivisor),
    write: (value, input) => {
      input.value = String(logarithmicChaoticAmPosition(value,
        CHAOTIC_AM_LIMITS.minFrequencyDivisor, CHAOTIC_AM_LIMITS.maxFrequencyDivisor));
    },
  },
  startAmplitudeIndex: {
    input: $("amplitudeIndex"),
    output: $("amplitudeIndexOut"),
    read: (input) => {
      const depth = Math.min(64 / 65, Math.max(0, Number(input.value) || 0));
      return Math.min(64, depth / (1 - depth));
    },
    write: (value, input) => { input.value = String(chaoticAmModulationDepth(value)); },
  },
  indexDivisor: {
    input: $("indexDivisor"),
    output: $("indexDivisorOut"),
    read: (input) => logarithmicChaoticAmValue(Number(input.value),
      CHAOTIC_AM_LIMITS.minIndexDivisor, CHAOTIC_AM_LIMITS.maxIndexDivisor),
    write: (value, input) => {
      input.value = String(logarithmicChaoticAmPosition(value,
        CHAOTIC_AM_LIMITS.minIndexDivisor, CHAOTIC_AM_LIMITS.maxIndexDivisor));
    },
  },
  nonlinearity: {
    input: $("amplitudeWarp"),
    output: $("amplitudeWarpOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function logarithmicZeroValue(position, minimum, maximum) {
  const normalized = Number(position);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return logarithmicChaoticAmValue(
    Math.max(0, (normalized - 0.001) / 0.999),
    minimum,
    maximum,
  );
}

function logarithmicZeroPosition(value, minimum, maximum) {
  if (Number(value) <= 0) return 0;
  return 0.001 + logarithmicChaoticAmPosition(value, minimum, maximum) * 0.999;
}

const performanceControls = {
  ampAttackMs: {
    input: $("ampAttackMs"),
    output: $("ampAttackMsOut"),
    read: (input) => logarithmicZeroValue(input.value, 0.5, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroPosition(value, 0.5, 5_000));
    },
  },
  ampDecayMs: {
    input: $("ampDecayMs"),
    output: $("ampDecayMsOut"),
    read: (input) => logarithmicZeroValue(input.value, 1, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroPosition(value, 1, 5_000));
    },
  },
  ampSustainLevel: {
    input: $("ampSustainLevel"),
    output: $("ampSustainLevelOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  ampReleaseMs: {
    input: $("ampReleaseMs"),
    output: $("ampReleaseMsOut"),
    read: (input) => logarithmicChaoticAmValue(
      Number(input.value),
      2,
      10_000,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticAmPosition(value, 2, 10_000));
    },
  },
  glideTimeMs: {
    input: $("glideTimeMs"),
    output: $("glideTimeMsOut"),
    read: (input) => logarithmicZeroValue(input.value, 10, 2_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroPosition(value, 10, 2_000));
    },
  },
  rootMidiNote: {
    input: $("rootMidiNote"),
    output: $("rootMidiNoteOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  pitchBendRangeSemitones: {
    input: $("pitchBendRangeSemitones"),
    output: $("pitchBendRangeSemitonesOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function currentStack() {
  return deriveChaoticAmStack(state.settings, { sampleRate: audio.sampleRate });
}

function presetById(id) {
  return chaoticAmPresets.bank.find((preset) => preset.id === id) ?? null;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (milliseconds === 0) return "off";
  if (milliseconds >= 1_000) {
    return `${formatChaoticAmNumber(milliseconds / 1_000, 2)} s`;
  }
  if (milliseconds < 10) {
    return `${formatChaoticAmNumber(milliseconds, 1)} ms`;
  }
  return `${Math.round(milliseconds)} ms`;
}

function midiNoteName(note) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const safe = Math.max(0, Math.min(127, Math.round(Number(note) || 0)));
  return `${names[safe % 12]}${Math.floor(safe / 12) - 1}`;
}

function updateAdsrPreview() {
  const sustainY = 64 - state.performance.ampSustainLevel * 52;
  $("adsrCurve").setAttribute(
    "d",
    `M 8 64 Q 31 12 52 8 Q 76 ${sustainY} 103 ${sustainY} L 171 ${sustainY} Q 202 ${sustainY} 232 64`,
  );
}

function writePerformanceControls() {
  $("midiEnvelopeControls").hidden = state.performance.playMode !== "midi";
  for (const [key, control] of Object.entries(performanceControls)) {
    control.write(state.performance[key], control.input);
    control.input.dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS[key];
  }
  $("glideMode").value = state.performance.glideMode;
  $("glideMode").dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS.glideMode;
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
  performanceControls.pitchBendRangeSemitones.output.textContent = `±${formatChaoticAmNumber(
    state.performance.pitchBendRangeSemitones,
    1,
  )} st`;
  $("performanceState").textContent = state.performance.playMode === "drone"
    ? "Drone · continuous"
    : `${state.performance.glideMode} glide · mono`;
  $("expressionValue").textContent = `${Math.round(state.expression * 100)}%`;
  $("expressionMeter").style.setProperty("--expression", state.expression);
  $("sustainState").textContent = state.sustain ? "held" : "up";
  $("bendState").textContent = `${state.bend >= 0 ? "+" : ""}${formatChaoticAmNumber(
    state.bend * state.performance.pitchBendRangeSemitones,
    2,
  )} st`;
  $("currentNote").textContent = state.midiSelectedNote !== null
    ? `${midiNoteName(state.midiSelectedNote)} · ${state.midiSelectedNote}`
    : "—";
  updateAdsrPreview();
}

function clearMidiMonitorState() {
  state.midiHeldNotes.clear();
  state.midiSelectedNote = null;
  state.sustain = false;
  state.bend = 0;
  state.expression = 1;
}

function midiNoteOwner(action) {
  return `${String(action?.sourceId ?? "default")}\u0000${action?.channel ?? 0}\u0000${action?.note ?? 0}`;
}

function physicallyHeldMidiNotes() {
  return [...state.midiHeldNotes.values()].map(({ note }) => note);
}

function isMidiNoteHeld(note) {
  return [...state.midiHeldNotes.values()].some((entry) => entry.note === note);
}

function applyPerformanceSettings(settings, { message = null } = {}) {
  const previous = state.performance;
  const previousMode = previous.playMode;
  state.performance = { ...sanitizeChaoticAmPerformance({
    ...state.performance,
    ...settings,
  }) };
  if (state.performance.playMode !== previousMode) {
    audio.allSoundOff();
    audio.resetControllers();
    clearMidiMonitorState();
    $("midiActivity").textContent = "Waiting for MIDI";
  }
  audio.setPerformanceParameters(state.performance);
  if (CHAOTIC_AM_PRESET_PERFORMANCE_KEYS.some(key => previous[key] !== state.performance[key])) {
    state.activePresetId = null;
    updatePresetPresentation();
  }
  writePerformanceControls();
  if (message) announce(message);
}

function handleMidiAction(action) {
  let activity = "MIDI";
  if (!audio.running) {
    clearMidiMonitorState();
    activity = action.synthetic
      ? "MIDI disconnected · all sound off"
      : "Audio off · MIDI ignored";
    $("midiActivity").textContent = activity;
    $("midiActivity").classList.remove("is-active");
    requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
    writePerformanceControls();
    return;
  }
  if (action.type === "noteOn") {
    const owner = midiNoteOwner(action);
    state.midiHeldNotes.delete(owner);
    state.midiHeldNotes.set(owner, {
      note: action.note,
      velocity: action.velocity,
    });
    state.midiSelectedNote = action.note;
    activity = `${midiNoteName(action.note)} · velocity ${action.velocity}`;
  } else if (action.type === "noteOff") {
    state.midiHeldNotes.delete(midiNoteOwner(action));
    if (state.midiSelectedNote === action.note) {
      const physicallyHeld = physicallyHeldMidiNotes();
      if (physicallyHeld.length > 0) {
        state.midiSelectedNote = physicallyHeld.at(-1);
      } else if (!state.sustain) {
        state.midiSelectedNote = null;
      }
    }
    activity = `${midiNoteName(action.note)} released`;
  } else if (action.type === "pitchBend") {
    state.bend = action.normalized;
    activity = "Pitch bend";
  } else if (action.type === "controlChange") {
    const semantic = chaoticAmFactoryControlChange(
      action.controller,
      action.value,
    );
    activity = `CC${action.controller} · ${action.value}`;
    if (semantic?.type === "parameter") {
      applyPerformanceSettings({ [semantic.key]: semantic.value });
    } else if (semantic?.type === "synthesisParameter") {
      applySettings({
        ...state.settings,
        [semantic.key]: semantic.value,
      });
    } else if (semantic?.type === "expression") {
      state.expression = semantic.value;
    } else if (semantic?.type === "sustain") {
      state.sustain = semantic.down;
      if (!state.sustain && !isMidiNoteHeld(state.midiSelectedNote)) {
        const physicallyHeld = physicallyHeldMidiNotes();
        state.midiSelectedNote = physicallyHeld.at(-1) ?? null;
      }
    } else if (semantic?.type === "allSoundOff" || semantic?.type === "allNotesOff") {
      state.midiHeldNotes.clear();
      state.midiSelectedNote = null;
      state.sustain = false;
      if (action.synthetic) activity = "MIDI disconnected · all sound off";
    } else if (semantic?.type === "resetControllers") {
      state.expression = 1;
      state.sustain = false;
      state.bend = 0;
      if (!isMidiNoteHeld(state.midiSelectedNote)) {
        const physicallyHeld = physicallyHeldMidiNotes();
        state.midiSelectedNote = physicallyHeld.at(-1) ?? null;
      }
    }
  }
  $("midiActivity").textContent = activity;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  writePerformanceControls();
}

function dispatchMidiActionToAudio(action) {
  if (!audio.running || !action) return;
  if (action.type === "noteOn") {
    audio.noteOn(action.note, action.velocity, action.channel, action.sourceId);
  } else if (action.type === "noteOff") {
    audio.noteOff(action.note, action.channel, action.sourceId);
  } else if (action.type === "pitchBend") {
    audio.pitchBend(action.normalized);
  } else if (action.type === "controlChange") {
    audio.controlChange(action.controller, action.value);
  }
}

const sharedMidiMacroTargets = [
  { label: "Depth", input: controls.depth.input },
  { label: "Mod frequency", input: controls.startModFrequencyHz.input },
  { label: "AM depth", input: controls.startAmplitudeIndex.input },
  { label: "Chaos / shape", input: controls.nonlinearity.input },
  { label: "Attack", input: performanceControls.ampAttackMs.input },
  { label: "Release", input: performanceControls.ampReleaseMs.input },
  { label: "Glide", input: performanceControls.glideTimeMs.input },
  { label: "Output", input: $("output") },
];

function applySharedMidiMacro(logical) {
  if (logical?.type !== "macro") return false;
  const index = Math.round(Number(logical.index));
  const target = sharedMidiMacroTargets[index];
  if (!target) return false;
  const normalized = Math.min(1, Math.max(
    0,
    Number(logical.normalized ?? Number(logical.value) / 127) || 0,
  ));
  const minimum = Number(target.input.min) || 0;
  const maximum = Number(target.input.max) || 1;
  target.input.value = String(minimum + normalized * (maximum - minimum));
  target.input.dispatchEvent(new Event("input", { bubbles: true }));
  $("midiActivity").textContent = `Macro ${index + 1} · ${target.label}`;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  return true;
}

function handleSharedMidiMessage(message, nativeEvent) {
  if (!state.midiActive || disposed || !message) return;
  if (applySharedMidiMacro(message.logical)) return;
  const action = {
    ...message,
    synthetic: Boolean(message.synthetic)
      || (nativeEvent === null
        && message.type === "controlChange"
        && message.controller === 120),
  };
  dispatchMidiActionToAudio(action);
  handleMidiAction(action);
}

function prepareSharedMidiEnable() {
  clearMidiMonitorState();
  $("midiActivity").textContent = "Enabling MIDI…";
  writePerformanceControls();
}

function handleSharedMidiEnabledChange(enabled) {
  const active = Boolean(enabled);
  const changed = state.midiActive !== active;
  if (!active && state.midiActive) {
    audio.allSoundOff();
    audio.resetControllers();
    clearMidiMonitorState();
  }
  state.midiActive = active;
  applyPerformanceSettings({ playMode: active ? "midi" : "drone" });
  if (!changed) return;
  $("midiActivity").textContent = active
    ? "MIDI on · waiting for notes"
    : "MIDI off · Drone mode";
  announce(active
    ? "Shared MIDI on. Chaotic AM is in monophonic MIDI mode."
    : "Shared MIDI off. Chaotic AM returned to Drone mode.");
}

function handleSharedMidiProfileChange(profileState) {
  const label = profileState?.selectedProfile?.label
    ?? profileState?.selectedProfileId
    ?? "Auto";
  $("midiActivity").title = `Controller profile: ${label}`;
}

const sharedMidiManager = getSharedMidiManager(globalThis);
let unregisterMidiClient = null;

function registerSharedMidiClient() {
  if (unregisterMidiClient) return;
  unregisterMidiClient = sharedMidiManager.registerClient({
    id: "chaotic-am",
    onMessage: handleSharedMidiMessage,
    onEnabledChange: handleSharedMidiEnabledChange,
    onPrepareEnable: prepareSharedMidiEnable,
    onProfileChange: handleSharedMidiProfileChange,
  });
}

function compactDrive(value) {
  if (value >= 10_000) return value.toExponential(2);
  if (value >= 1_000) return formatChaoticAmNumber(value, 1);
  return formatChaoticAmNumber(value, 3);
}

function updatePresetPresentation() {
  const preset = presetById(state.activePresetId);
  $("presetState").textContent = preset?.label ?? "Custom";
  $("presetDescription").textContent = preset?.description
    ?? "A custom carrier with nested amplitude modulation.";
  presetController?.refresh();
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
  const flow = $("chaoticAmFlow");
  const active = stack.actualDepth > 0;
  const saturated = stack.settings.transferMode === "saturated";
  const frequency = formatChaoticAmFrequency(stack.settings.startModFrequencyHz);
  const carrier = formatChaoticAmFrequency(stack.settings.carrierHz);
  const amount = `${(chaoticAmModulationDepth(stack.settings.startAmplitudeIndex) * 100).toFixed(1)}%`;
  const repeat = active
    ? `${stack.actualDepth} nested ${stack.actualDepth === 1 ? "modulator" : "modulators"} · frequency ÷ ${formatChaoticAmNumber(stack.settings.frequencyDivisor)} · depth index ÷ ${formatChaoticAmNumber(stack.settings.indexDivisor)}`
    : "Modulation bypassed · carrier sine goes directly to output";

  flow.dataset.pathLabel = "NESTED MODULATORS → NONLINEAR SHAPE → POSITIVE GAIN × CARRIER → AUDIO";
  flow.innerHTML = `
    <svg class="chaotic-am-flow-detailed" viewBox="0 0 1020 210" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      <defs>
        <marker class="chaotic-path-arrow" id="chaoticAmArrow" viewBox="0 0 8 8"
          refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${flowBlock(18, 160, active ? "NESTED MODULATORS" : "MODULATION BYPASS", active ? frequency : "gain 1", "is-phase")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticAmArrow)" d="M 178 117 H 201" />
      ${flowBlock(208, 110, saturated ? "SATURATED" : "SMOOTH", active ? "tanh shape" : "bypassed", "is-warp")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticAmArrow)" d="M 318 117 H 341" />
      ${flowBlock(348, 120, "CHAOS / SHAPE", active ? formatChaoticAmNumber(stack.settings.nonlinearity) : "bypassed", "is-warp")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticAmArrow)" d="M 468 117 H 491" />
      ${flowBlock(498, 140, "POSITIVE AM GAIN", active ? `${amount} depth` : "unity", "is-phase")}
      <path class="chaotic-path-wire" marker-end="url(#chaoticAmArrow)" d="M 638 117 H 706" />
      <g class="chaotic-path-block is-control">
        <rect x="650" y="35" width="140" height="42" rx="4" />
        <text class="chaotic-path-title" x="720" y="52">AUDIBLE CARRIER</text>
        <text class="chaotic-path-value" x="720" y="67">${carrier}</text>
      </g>
      <path class="chaotic-path-control-wire" marker-end="url(#chaoticAmArrow)" d="M 720 77 V 102" />
      <g class="chaotic-path-junction">
        <circle cx="720" cy="117" r="10" />
        <text x="720" y="121">×</text>
      </g>
      <path class="chaotic-path-audio-wire" marker-end="url(#chaoticAmArrow)" d="M 730 117 H 773" />
      <g class="chaotic-path-output">
        <rect x="780" y="88" width="180" height="58" rx="4" />
        <text class="chaotic-path-title" x="870" y="110">CARRIER → AUDIO</text>
        <text class="chaotic-path-value" x="870" y="128">${carrier}</text>
      </g>
      <text class="chaotic-am-flow-note" x="18" y="191">${repeat}</text>
    </svg>
    <svg class="chaotic-am-flow-compact" viewBox="0 0 380 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="chaotic-am-compact-node is-phase">
        <rect x="8" y="34" width="82" height="46" rx="3" />
        <text class="chaotic-am-compact-title" x="49" y="52">${active ? `${stack.actualDepth} MODULATORS` : "BYPASS"}</text>
        <text class="chaotic-am-compact-value" x="49" y="68">${active ? frequency : "gain 1"}</text>
      </g>
      <text class="chaotic-am-compact-arrow" x="99" y="61">→</text>
      <g class="chaotic-am-compact-node is-warp">
        <rect x="112" y="34" width="70" height="46" rx="3" />
        <text class="chaotic-am-compact-title" x="147" y="52">SHAPE</text>
        <text class="chaotic-am-compact-value" x="147" y="68">${active ? (saturated ? "SATURATED" : "SMOOTH") : "BYPASSED"}</text>
      </g>
      <text class="chaotic-am-compact-arrow" x="190" y="61">→</text>
      <g class="chaotic-am-compact-node is-carrier">
        <rect x="204" y="34" width="74" height="46" rx="3" />
        <text class="chaotic-am-compact-title" x="241" y="52">× CARRIER</text>
        <text class="chaotic-am-compact-value" x="241" y="68">${carrier}</text>
      </g>
      <text class="chaotic-am-compact-arrow" x="286" y="61">→</text>
      <g class="chaotic-am-compact-node is-output">
        <rect x="300" y="34" width="72" height="46" rx="3" />
        <text class="chaotic-am-compact-title" x="336" y="52">AUDIO</text>
        <text class="chaotic-am-compact-value" x="336" y="68">${active ? `${amount} AM` : "PURE SINE"}</text>
      </g>
      <text class="chaotic-am-compact-caption" x="8" y="101">NESTED MODULATORS → POSITIVE GAIN × CARRIER</text>
    </svg>
  `;
  flow.setAttribute("aria-label", active
    ? `${stack.actualDepth} nested modulators starting at ${frequency} shape a positive amplitude gain with ${amount} AM depth and ${saturated ? "saturated" : "smooth"} nonlinear shaping. This gain multiplies the audible ${carrier} carrier. Frequency division changes the modulators; the carrier pitch remains ${carrier}.`
    : `Chaotic AM modulation is bypassed. The ${carrier} carrier sine reaches audio directly.`);
}

function updateControlOutputs(stack = currentStack()) {
  const { settings } = stack;
  const saturated = settings.transferMode === "saturated";
  const finalOperator = stack.operators[stack.audibleIndex];
  const finalFrequency = formatChaoticAmFrequency(finalOperator.frequencyHz);
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatChaoticAmFrequency(settings.carrierHz);
  controls.startModFrequencyHz.output.textContent = formatChaoticAmFrequency(
    settings.startModFrequencyHz,
  );
  controls.frequencyDivisor.output.textContent = `÷${formatChaoticAmNumber(settings.frequencyDivisor)}`;
  controls.startAmplitudeIndex.output.textContent = `${(chaoticAmModulationDepth(settings.startAmplitudeIndex) * 100).toFixed(1)}%`;
  controls.startAmplitudeIndex.input.setAttribute("aria-valuetext", controls.startAmplitudeIndex.output.textContent);
  controls.indexDivisor.output.textContent = `÷${formatChaoticAmNumber(settings.indexDivisor)}`;
  controls.nonlinearity.output.textContent = formatChaoticAmNumber(settings.nonlinearity);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;

  const summary = summarizeChaoticAmStack(stack);
  const bound = stack.boundedByFrequency ? " · modulation bandwidth limited" : "";
  $("algorithmState").textContent = stack.actualDepth === 0
    ? `${saturated ? "Saturated" : "Smooth"} · 0 turns · carrier ${finalFrequency}`
    : `${saturated ? "Saturated" : "Smooth"} · ${stack.actualDepth} ${stack.actualDepth === 1 ? "modulator" : "modulators"} · carrier ${finalFrequency}${bound}`;
  $("carrierReadout").textContent = `${formatChaoticAmFrequency(settings.carrierHz)} sine`;
  $("entryReadout").textContent = `${formatChaoticAmFrequency(settings.startModFrequencyHz)} · index ${formatChaoticAmNumber(settings.startAmplitudeIndex)} · ${(chaoticAmModulationDepth(settings.startAmplitudeIndex) * 100).toFixed(1)}% AM`;

  const amplitudeOperators = stack.operators.slice(1);
  $("turnsReadout").textContent = amplitudeOperators.length > 0
    ? amplitudeOperators.map(
      (operator) => (
        `${operator.turn}: ${formatChaoticAmFrequency(operator.frequencyHz)}`
        + ` · I ${formatChaoticAmNumber(operator.amplitudeIndex)} · ${(operator.modulationDepth * 100).toFixed(1)}% AM`
        + ` · k ${compactDrive(operator.drive)}`
      ),
    ).join(" · ")
    : "none · carrier sine is audible";
  $("transferMode").value = settings.transferMode;
  $("transferMode").dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS.transferMode;
  $("amplitudeIndexNote").textContent = "Controls the carrier’s amplitude movement from 0 to 98.5%.";
  for (const key of ["startModFrequencyHz", "startAmplitudeIndex", "nonlinearity", "frequencyDivisor", "indexDivisor"]) {
    const needsTwoModulators = key === "frequencyDivisor" || key === "indexDivisor";
    const disabled = stack.actualDepth < (needsTwoModulators ? 2 : 1);
    controls[key].input.disabled = disabled;
    controls[key].input.closest(".control")?.classList.toggle("is-bypassed", disabled);
  }
  $("transferMode").disabled = stack.actualDepth === 0;
  $("modulationStateNote").textContent = stack.actualDepth === 0
    ? "Modulation bypassed. Raise recursion depth to shape the carrier."
    : stack.actualDepth === 1
      ? "One modulator. Both divisors take effect from two modulators onward."
      : "Divisors shape the nested modulators; carrier pitch stays fixed.";
  const maximumDrive = saturated ? 32 : 9;
  $("transferReadout").textContent = `${saturated ? "saturated" : "smooth"} tanh control · k ${formatChaoticAmNumber(1 + settings.nonlinearity * (maximumDrive - 1))}`;
  $("operatorReadout").textContent = `carrier · ${finalFrequency} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatChaoticAmFrequency(settings.maximumFrequencyHz);

  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · AUDIO ${audio.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Chaotic AM algorithm with ${summary.actualDepth} nonlinear amplitude ${summary.actualDepth === 1 ? "turn" : "turns"}. Live log-frequency spectrum with foreground oscilloscope. Audio ${audio.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
    control.input.dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS[name];
  }
  $("output").value = String(state.output);
  $("output").dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS.output;
  $("transferMode").value = state.settings.transferMode;
  $("transferMode").dataset.parameterId = CHAOTIC_AM_PARAMETER_IDS.transferMode;
}

function applySettings(settings, { presetId = null, announceChange = false } = {}) {
  const safe = sanitizeChaoticAmParams(settings, { sampleRate: audio.sampleRate });
  state.settings = {
    transferMode: safe.transferMode,
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    startModFrequencyHz: safe.startModFrequencyHz,
    frequencyDivisor: safe.frequencyDivisor,
    startAmplitudeIndex: safe.startAmplitudeIndex,
    indexDivisor: safe.indexDivisor,
    nonlinearity: safe.nonlinearity,
  };
  state.activePresetId = presetId;
  writeControlsFromState();
  const stack = audio.updateSettings(state.settings);
  updatePresetPresentation();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
  if (announceChange) {
    const preset = presetById(presetId);
    announce(
      preset
        ? `${preset.label} Chaotic AM preset selected.`
        : "Chaotic AM parameters reset.",
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
      audio.allSoundOff();
      await audio.stop();
      clearMidiMonitorState();
      $("midiActivity").textContent = "Audio off · MIDI ignored";
      writePerformanceControls();
      announce("Chaotic AM audio off.");
    } else {
      clearMidiMonitorState();
      $("midiActivity").textContent = "Waiting for MIDI";
      writePerformanceControls();
      audio.setPerformanceParameters(state.performance);
      await audio.start(state.settings, state.output);
      audio.allSoundOff();
      audio.resetControllers();
      announce("Chaotic AM audio on.");
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
  const sizing = canvasSizing(bounds, window.devicePixelRatio, { pixelBudget: null });
  cssWidth = sizing.cssWidth;
  cssHeight = sizing.cssHeight;
  pixelRatio = sizing.pixelRatio;
  canvas.width = sizing.width;
  canvas.height = sizing.height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  visualizationDirty = true;
  scheduleVisualization();
}

function drawVisualization() {
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, cssWidth, cssHeight);
  drawChaoticLiveAnalysis(canvasContext, {
    analyser: audio.analyser,
    audioOn: audio.running,
    glow: "rgba(185, 140, 255, 0.38)",
    height: cssHeight,
    scopeGlow: "rgba(255, 240, 199, 0.68)",
    scopeStroke: "#fff0c7",
    spectrum,
    spectrumBarCap: "rgba(98, 236, 198, 0.76)",
    spectrumBarFill: "rgba(185, 140, 255, 0.3)",
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

for (const [name, control] of Object.entries(performanceControls)) {
  control.input.addEventListener("input", () => {
    applyPerformanceSettings({ [name]: control.read(control.input) });
  });
}

$("glideMode").addEventListener("change", () => {
  applyPerformanceSettings(
    { glideMode: $("glideMode").value },
    { message: `${$("glideMode").value} glide mode selected.` },
  );
});

$("transferMode").addEventListener("change", () => {
  applySettings({
    ...state.settings,
    transferMode: $("transferMode").value,
  });
  announce(
    $("transferMode").value === "saturated"
      ? "Saturated Chaotic AM transfer selected."
      : "Smooth continuous Chaotic AM transfer selected.",
  );
});


$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  audio.setLevel(state.output);
});

$("audioButton").addEventListener("click", toggleAudio);

$("resetChaoticAm").addEventListener("click", () => {
  clearError();
  audio.allSoundOff();
  audio.resetControllers();
  state.output = CHAOTIC_AM_DEFAULTS.output;
  state.performance = {
    ...CHAOTIC_AM_PERFORMANCE_DEFAULTS,
    ...defaultPreset.performance,
    playMode: state.midiActive ? "midi" : "drone",
  };
  clearMidiMonitorState();
  audio.setLevel(state.output);
  audio.setPerformanceParameters(state.performance);
  writePerformanceControls();
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
  unregisterMidiClient?.();
  unregisterMidiClient = null;
  audio.allSoundOff();
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
  registerSharedMidiClient();
  visualizationDirty = true;
  updateAudioUi();
  resizeCanvas();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !audio.running) return;
  audio.allSoundOff();
  audio.stop({ immediate: true }).finally(() => {
    state.audioStarting = false;
    clearMidiMonitorState();
    $("midiActivity").textContent = "Audio off · MIDI ignored";
    writePerformanceControls();
    visualizationDirty = true;
    updateAudioUi();
    scheduleVisualization();
    announce("Chaotic AM audio off.");
  });
});

writeControlsFromState();
writePerformanceControls();
registerSharedMidiClient();
updatePresetPresentation();
updateControlOutputs();
beginResizeObservation();
resizeCanvas();


presetController = registerHeaderPresets({
  id: "chaotic-am", presets: chaoticAmPresets.bank,
  capture: () => chaoticAmPresets.capture(state),
  randomize: chaoticAmPresets.randomize,
  apply(raw) {
    const snapshot = chaoticAmPresets.validate(raw);
    applyPerformanceSettings(snapshot.performance);
    applySettings(snapshot.settings, { presetId: snapshot.activePresetId });
  },
});
