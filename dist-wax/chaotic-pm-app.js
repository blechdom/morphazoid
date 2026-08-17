import {
  CHAOTIC_PM_DEFAULTS,
  CHAOTIC_PM_LIMITS,
  CHAOTIC_PM_PARAMETER_IDS,
  CHAOTIC_PM_PERFORMANCE_DEFAULTS,
  CHAOTIC_PM_PRESETS,
  DEFAULT_CHAOTIC_PM_PRESET_ID,
  ChaoticPmAudio,
  chaoticPmFactoryControlChange,
  deriveChaoticPmStack,
  formatChaoticPmFrequency,
  formatChaoticPmNumber,
  logarithmicChaoticPmPosition,
  logarithmicChaoticPmValue,
  sanitizeChaoticPmParams,
  sanitizeChaoticPmPerformance,
  summarizeChaoticPmStack,
} from "./src/chaotic-pm.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";
import { getSharedMidiManager } from "./src/midi-manager.js";

const $ = (id) => document.getElementById(id);
const VISUAL_FRAME_INTERVAL = 1_000 / 30;

const defaultPreset = CHAOTIC_PM_PRESETS.find(
  ({ id }) => id === DEFAULT_CHAOTIC_PM_PRESET_ID,
) ?? CHAOTIC_PM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  output: CHAOTIC_PM_DEFAULTS.output,
  performance: { ...CHAOTIC_PM_PERFORMANCE_DEFAULTS },
  expression: 1,
  sustain: false,
  bend: 0,
  midiHeldNotes: new Map(),
  midiSelectedNote: null,
  midiActive: false,
  audioStarting: false,
};

const audio = new ChaoticPmAudio(globalThis);
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

function logarithmicZeroValue(position, minimum, maximum) {
  const normalized = Number(position);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return logarithmicChaoticPmValue(
    Math.max(0, (normalized - 0.001) / 0.999),
    minimum,
    maximum,
  );
}

function logarithmicZeroPosition(value, minimum, maximum) {
  if (Number(value) <= 0) return 0;
  return 0.001 + logarithmicChaoticPmPosition(value, minimum, maximum) * 0.999;
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
    read: (input) => logarithmicChaoticPmValue(
      Number(input.value),
      2,
      10_000,
    ),
    write: (value, input) => {
      input.value = String(logarithmicChaoticPmPosition(value, 2, 10_000));
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

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (milliseconds === 0) return "off";
  if (milliseconds >= 1_000) {
    return `${formatChaoticPmNumber(milliseconds / 1_000, 2)} s`;
  }
  if (milliseconds < 10) {
    return `${formatChaoticPmNumber(milliseconds, 1)} ms`;
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
  for (const [key, control] of Object.entries(performanceControls)) {
    control.write(state.performance[key], control.input);
    control.input.dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS[key];
  }
  $("glideMode").value = state.performance.glideMode;
  $("glideMode").dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS.glideMode;
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
  performanceControls.pitchBendRangeSemitones.output.textContent = `±${formatChaoticPmNumber(
    state.performance.pitchBendRangeSemitones,
    1,
  )} st`;
  $("performanceState").textContent = state.performance.playMode === "drone"
    ? "Drone · continuous"
    : `${state.performance.glideMode} glide · mono`;
  $("expressionValue").textContent = `${Math.round(state.expression * 100)}%`;
  $("expressionMeter").style.setProperty("--expression", state.expression);
  $("sustainState").textContent = state.sustain ? "held" : "up";
  $("bendState").textContent = `${state.bend >= 0 ? "+" : ""}${formatChaoticPmNumber(
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
  const previousMode = state.performance.playMode;
  state.performance = { ...sanitizeChaoticPmPerformance({
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
    const semantic = chaoticPmFactoryControlChange(
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
  { label: "Phase index", input: controls.startPhaseIndex.input },
  { label: "Chaos / warp", input: controls.nonlinearity.input },
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
    ? "Shared MIDI on. Chaotic PM is in monophonic MIDI mode."
    : "Shared MIDI off. Chaotic PM returned to Drone mode.");
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
    id: "chaotic-pm",
    onMessage: handleSharedMidiMessage,
    onEnabledChange: handleSharedMidiEnabledChange,
    onPrepareEnable: prepareSharedMidiEnable,
    onProfileChange: handleSharedMidiProfileChange,
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
    ?? "A custom stack of recursively shaped phase operators.";
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
  const legacy = stack.settings.transferMode === "legacy";
  const index = active ? formatChaoticPmNumber(operator.phaseIndex) : "bypassed";
  const frequency = active ? formatChaoticPmFrequency(operator.frequencyHz) : "no turn";
  const drive = active ? compactDrive(operator.drive) : "—";
  const gain = active ? formatChaoticPmNumber(operator.gain) : "—";
  const repeat = active
    ? `${stack.actualDepth} ${stack.actualDepth === 1 ? "turn" : "turns"} · f ÷ ${formatChaoticPmNumber(stack.settings.frequencyDivisor)} · I ÷ ${formatChaoticPmNumber(stack.settings.indexDivisor)}`
    : "0 turns · carrier sine goes directly to output";

  if (!legacy) {
    flow.dataset.pathLabel = "LIVE TURN · PREVIOUS → TANH CONTROL → CHAOS MIX → × INDEX (RAD) + PHASOR → SINE";
    flow.innerHTML = `
      <svg class="chaotic-pm-flow-detailed" viewBox="0 0 1260 210" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
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
        ${flowBlock(162, 90, "TANH", active ? `k ${drive}` : "—", "is-warp")}
        <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 252 117 H 279" />
        ${flowBlock(284, 110, "CHAOS MIX", active ? formatChaoticPmNumber(stack.settings.nonlinearity) : "—", "is-warp")}
        <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 394 117 H 421" />
        ${flowBlock(426, 100, "× INDEX (RAD)", index, "is-phase")}
        <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 526 117 H 553" />

        <g class="chaotic-path-block is-control">
          <rect x="521" y="35" width="88" height="42" rx="4" />
          <text class="chaotic-path-title" x="565" y="52">PHASOR</text>
          <text class="chaotic-path-value" x="565" y="67">${frequency}</text>
        </g>
        <path class="chaotic-path-control-wire" marker-end="url(#chaoticPmArrow)" d="M 565 77 V 106" />
        <g class="chaotic-path-junction">
          <circle cx="565" cy="117" r="10" />
          <text x="565" y="121">+</text>
        </g>
        <path class="chaotic-path-wire" marker-end="url(#chaoticPmArrow)" d="M 575 117 H 602" />
        ${flowBlock(607, 90, "SINE", active ? "next signal" : "carrier", "is-phase")}
        <path class="chaotic-path-audio-wire" marker-end="url(#chaoticPmArrow)" d="M 697 117 H 735" />

        <g class="chaotic-path-output">
          <rect x="740" y="88" width="170" height="58" rx="4" />
          <text class="chaotic-path-title" x="825" y="110">FINAL TURN → AUDIO</text>
          <text class="chaotic-path-value" x="825" y="128">${formatChaoticPmFrequency(finalOperator.frequencyHz)} · ${(stack.normalizedGain * 100).toFixed(0)}%</text>
        </g>
        <path class="chaotic-pm-repeat-bracket" d="M 18 164 V 174 H 697 V 164" />
        <text class="chaotic-pm-flow-note" x="18" y="191">${repeat} · continuous periodic phase</text>
      </svg>
      <svg class="chaotic-pm-flow-compact" viewBox="0 0 380 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g class="chaotic-pm-compact-node is-carrier">
          <rect x="8" y="34" width="70" height="46" rx="3" />
          <text class="chaotic-pm-compact-title" x="43" y="52">CARRIER</text>
          <text class="chaotic-pm-compact-value" x="43" y="68">${formatChaoticPmFrequency(stack.settings.carrierHz)}</text>
        </g>
        <text class="chaotic-pm-compact-arrow" x="88" y="61">→</text>
        <g class="chaotic-pm-compact-node is-phase">
          <rect x="100" y="34" width="78" height="46" rx="3" />
          <text class="chaotic-pm-compact-title" x="139" y="52">PHASE ENTRY</text>
          <text class="chaotic-pm-compact-value" x="139" y="68">${frequency} · I ${index}</text>
        </g>
        <text class="chaotic-pm-compact-arrow" x="188" y="61">→</text>
        <g class="chaotic-pm-compact-node is-warp">
          <rect x="200" y="34" width="80" height="46" rx="3" />
          <text class="chaotic-pm-compact-title" x="240" y="52">${stack.actualDepth === 0 ? "BYPASS" : `${stack.actualDepth} ${stack.actualDepth === 1 ? "TURN" : "TURNS"}`}</text>
          <text class="chaotic-pm-compact-value" x="240" y="68">${stack.actualDepth === 0 ? "CARRIER TAP" : "TANH CONTROL · PM"}</text>
        </g>
        <text class="chaotic-pm-compact-arrow" x="290" y="61">→</text>
        <g class="chaotic-pm-compact-node is-output">
          <rect x="302" y="34" width="70" height="46" rx="3" />
          <text class="chaotic-pm-compact-title" x="337" y="52">AUDIO</text>
          <text class="chaotic-pm-compact-value" x="337" y="68">OP ${stack.audibleIndex} · ${formatChaoticPmFrequency(finalOperator.frequencyHz)}</text>
        </g>
        <text class="chaotic-pm-compact-caption" x="8" y="101">PREVIOUS → TANH CONTROL → PHASE INDEX (RAD) + PHASOR → SINE</text>
      </svg>
    `;
    flow.setAttribute(
      "aria-label",
      active
        ? `Live Smooth Chaotic PM turn. The previous sine is continuously tanh-shaped with dimensionless drive ${drive}, mixed by chaos ${formatChaoticPmNumber(stack.settings.nonlinearity)}, multiplied by phase index ${index} radians, added to a ${frequency} phasor, and sent through sine. The path repeats for ${stack.actualDepth} turns; the final ${formatChaoticPmFrequency(finalOperator.frequencyHz)} operator is sent to normalized audio.`
        : `Chaotic PM depth is zero. The ${formatChaoticPmFrequency(stack.settings.carrierHz)} carrier sine bypasses the nonlinear turn and reaches normalized audio directly.`,
    );
    return;
  }

  flow.dataset.pathLabel = "LIVE TURN · PHASOR + PREVIOUS × INDEX → SIGNED %1 → × (WARP × f²) → TANH → × GAIN → SINE";

  flow.innerHTML = `
    <svg class="chaotic-pm-flow-detailed" viewBox="0 0 1260 210" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
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
    <svg class="chaotic-pm-flow-compact" viewBox="0 0 380 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="chaotic-pm-compact-node is-carrier">
        <rect x="8" y="34" width="70" height="46" rx="3" />
        <text class="chaotic-pm-compact-title" x="43" y="52">CARRIER</text>
        <text class="chaotic-pm-compact-value" x="43" y="68">${formatChaoticPmFrequency(stack.settings.carrierHz)}</text>
      </g>
      <text class="chaotic-pm-compact-arrow" x="88" y="61">→</text>
      <g class="chaotic-pm-compact-node is-phase">
        <rect x="100" y="34" width="78" height="46" rx="3" />
        <text class="chaotic-pm-compact-title" x="139" y="52">PHASE ENTRY</text>
        <text class="chaotic-pm-compact-value" x="139" y="68">${formatChaoticPmFrequency(stack.settings.startModFrequencyHz)} · I ${formatChaoticPmNumber(stack.settings.startPhaseIndex)}</text>
      </g>
      <text class="chaotic-pm-compact-arrow" x="188" y="61">→</text>
      <g class="chaotic-pm-compact-node is-warp">
        <rect x="200" y="34" width="80" height="46" rx="3" />
        <text class="chaotic-pm-compact-title" x="240" y="52">${stack.actualDepth === 0 ? "BYPASS" : `${stack.actualDepth} ${stack.actualDepth === 1 ? "TURN" : "TURNS"}`}</text>
        <text class="chaotic-pm-compact-value" x="240" y="68">${stack.actualDepth === 0 ? "CARRIER TAP" : "%1 · TANH · SINE"}</text>
      </g>
      <text class="chaotic-pm-compact-arrow" x="290" y="61">→</text>
      <g class="chaotic-pm-compact-node is-output">
        <rect x="302" y="34" width="70" height="46" rx="3" />
        <text class="chaotic-pm-compact-title" x="337" y="52">AUDIO</text>
        <text class="chaotic-pm-compact-value" x="337" y="68">OP ${stack.audibleIndex} · ${formatChaoticPmFrequency(finalOperator.frequencyHz)}</text>
      </g>
      <text class="chaotic-pm-compact-caption" x="8" y="101">PHASOR + PREVIOUS × INDEX → SIGNED %1 → TANH → SINE</text>
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
  const legacy = settings.transferMode === "legacy";
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
    ? `${legacy ? "Raw" : "Smooth"} · 0 turns · carrier ${finalFrequency}${finalBand}`
    : `${legacy ? "Raw" : "Smooth"} · ${stack.actualDepth} ${stack.actualDepth === 1 ? "turn" : "turns"} · final ${finalFrequency}${finalBand}${bound}`;
  $("carrierReadout").textContent = `${formatChaoticPmFrequency(settings.carrierHz)} sine`;
  $("entryReadout").textContent = `${formatChaoticPmFrequency(settings.startModFrequencyHz)} · index ${formatChaoticPmNumber(settings.startPhaseIndex)} ${legacy ? "cycles" : "rad"}`;

  const phaseOperators = stack.operators.filter(
    (operator) => operator.kind === "chaotic-phase-operator",
  );
  $("turnsReadout").textContent = phaseOperators.length > 0
    ? phaseOperators.map(
      (operator) => (
        `${operator.turn}: ${formatChaoticPmFrequency(operator.frequencyHz)}`
        + ` · I ${formatChaoticPmNumber(operator.phaseIndex)} ${legacy ? "cyc" : "rad"}`
        + ` · ${legacy ? "raw drive" : "k"} ${compactDrive(operator.drive)}`
      ),
    ).join(" · ")
    : "none · carrier sine is audible";
  $("transferMode").value = settings.transferMode;
  $("transferMode").dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS.transferMode;
  $("phaseIndexNote").textContent = legacy
    ? "Legacy/Raw index · cycles"
    : "Smooth index · radians";
  const gain = 1.2 - Math.sqrt(settings.nonlinearity);
  $("transferReadout").textContent = legacy
    ? `legacy signed %1 · tanh · gain ${formatChaoticPmNumber(gain)}`
    : `continuous tanh control · k ${formatChaoticPmNumber(1 + settings.nonlinearity * 8)}`;
  $("operatorReadout").textContent = `operator ${stack.audibleIndex} · ${finalFrequency}${finalBand} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatChaoticPmFrequency(settings.maximumFrequencyHz);

  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · AUDIO ${audio.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Chaotic PM algorithm with ${summary.actualDepth} nonlinear phase ${summary.actualDepth === 1 ? "turn" : "turns"}. Live log-frequency spectrum with foreground oscilloscope. Audio ${audio.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
    control.input.dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS[name];
  }
  $("output").value = String(state.output);
  $("output").dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS.output;
  $("transferMode").value = state.settings.transferMode;
  $("transferMode").dataset.parameterId = CHAOTIC_PM_PARAMETER_IDS.transferMode;
}

function applySettings(settings, { presetId = null, announceChange = false } = {}) {
  const safe = sanitizeChaoticPmParams(settings, { sampleRate: audio.sampleRate });
  state.settings = {
    transferMode: safe.transferMode,
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
      audio.allSoundOff();
      await audio.stop();
      clearMidiMonitorState();
      $("midiActivity").textContent = "Audio off · MIDI ignored";
      writePerformanceControls();
      announce("Chaotic PM audio off.");
    } else {
      clearMidiMonitorState();
      $("midiActivity").textContent = "Waiting for MIDI";
      writePerformanceControls();
      audio.setPerformanceParameters(state.performance);
      await audio.start(state.settings, state.output);
      audio.allSoundOff();
      audio.resetControllers();
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
    $("transferMode").value === "legacy"
      ? "Legacy Raw Chaotic PM transfer selected."
      : "Smooth continuous Chaotic PM transfer selected.",
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
  audio.allSoundOff();
  audio.resetControllers();
  state.output = CHAOTIC_PM_DEFAULTS.output;
  state.performance = {
    ...CHAOTIC_PM_PERFORMANCE_DEFAULTS,
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
    announce("Chaotic PM audio off.");
  });
});

writeControlsFromState();
writePerformanceControls();
registerSharedMidiClient();
updatePresetButtons();
updateControlOutputs();
beginResizeObservation();
resizeCanvas();
