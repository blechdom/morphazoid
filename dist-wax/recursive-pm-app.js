import {
  DEFAULT_RECURSIVE_PM_PRESET_ID,
  RECURSIVE_PM_LIMITS,
  RECURSIVE_PM_PRESETS,
  RecursivePmAudioEngine,
  deriveRecursivePmStack,
  formatRecursivePmFrequency,
  formatRecursivePmNumber,
  logarithmicRecursivePmPosition,
  logarithmicRecursivePmValue,
  sanitizeRecursivePmSettings,
  summarizeRecursivePmStack,
} from "./src/recursive-pm.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";
import {
  RECURSIVE_PM_PERFORMANCE_DEFAULTS,
  RecursivePmMidiPerformance,
  recursivePmVelocityGain,
  sanitizeRecursivePmPerformance,
} from "./src/recursive-pm-midi.js";
import { getSharedMidiManager } from "./src/midi-manager.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LEVEL = 0.58;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;

const defaultPreset = RECURSIVE_PM_PRESETS.find(
  ({ id }) => id === DEFAULT_RECURSIVE_PM_PRESET_ID,
) ?? RECURSIVE_PM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  activePresetId: defaultPreset.id,
  level: DEFAULT_LEVEL,
  performance: { ...RECURSIVE_PM_PERFORMANCE_DEFAULTS },
  audioStarting: false,
  midiActive: false,
};

const engine = new RecursivePmAudioEngine(window);
const midiPerformance = new RecursivePmMidiPerformance({
  rootMidiNote: state.performance.rootMidiNote,
  pitchBendRangeSemitones: state.performance.pitchBendRangeSemitones,
});
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
    read: (input) => logarithmicRecursivePmValue(
      Number(input.value),
      RECURSIVE_PM_LIMITS.minCarrierHz,
      RECURSIVE_PM_LIMITS.maxCarrierHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicRecursivePmPosition(
        value,
        RECURSIVE_PM_LIMITS.minCarrierHz,
        RECURSIVE_PM_LIMITS.maxCarrierHz,
      ));
    },
  },
  startModFrequencyHz: {
    input: $("modFrequency"),
    output: $("modFrequencyOut"),
    read: (input) => logarithmicRecursivePmValue(
      Number(input.value),
      RECURSIVE_PM_LIMITS.minModFrequencyHz,
      RECURSIVE_PM_LIMITS.maxModFrequencyHz,
    ),
    write: (value, input) => {
      input.value = String(logarithmicRecursivePmPosition(
        value,
        RECURSIVE_PM_LIMITS.minModFrequencyHz,
        RECURSIVE_PM_LIMITS.maxModFrequencyHz,
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
};

const performanceControls = {
  ampAttackMs: { input: $("ampAttackMs"), output: $("ampAttackMsOut") },
  ampDecayMs: { input: $("ampDecayMs"), output: $("ampDecayMsOut") },
  ampSustainLevel: {
    input: $("ampSustainLevel"),
    output: $("ampSustainLevelOut"),
  },
  ampReleaseMs: { input: $("ampReleaseMs"), output: $("ampReleaseMsOut") },
  glideTimeMs: { input: $("glideTimeMs"), output: $("glideTimeMsOut") },
  rootMidiNote: { input: $("rootMidiNote"), output: $("rootMidiNoteOut") },
  pitchBendRangeSemitones: {
    input: $("pitchBendRangeSemitones"),
    output: $("pitchBendRangeSemitonesOut"),
  },
};

const MIDI_NOTE_NAMES = [
  "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B",
];

function midiNoteName(note) {
  const safe = Math.max(0, Math.min(127, Math.round(Number(note) || 0)));
  return `${MIDI_NOTE_NAMES[safe % 12]}${Math.floor(safe / 12) - 1}`;
}

function formatMilliseconds(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds >= 1_000) {
    return `${(milliseconds / 1_000).toFixed(milliseconds % 1_000 ? 2 : 0)} s`;
  }
  return milliseconds === 0 ? "off" : `${Math.round(milliseconds)} ms`;
}

function currentStack() {
  return deriveRecursivePmStack(
    state.settings,
    { sampleRate: engine.sampleRate },
  );
}

function presetById(id) {
  return RECURSIVE_PM_PRESETS.find((preset) => preset.id === id) ?? null;
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
    ?? "A custom recursive phase-operator stack.";
}

function updateSignalFlow(stack) {
  const flow = $("recursivePmFlow");
  const operators = stack.operators;
  const graphWidth = Math.max(960, operators.length * 150 + 210);
  const left = 58;
  const outputX = graphWidth - 130;
  const busEnd = outputX - 45;
  const right = busEnd - 100;
  const nodeY = 108;
  const busY = 182;
  const spacing = operators.length > 1
    ? (right - left) / (operators.length - 1)
    : 0;
  const nodeWidth = Math.max(44, Math.min(92, spacing * 0.58));
  const nodeHeight = 48;
  const positions = operators.map((_, index) => left + spacing * index);
  const inputMarkup = operators.slice(1).map((operator, edgeIndex) => {
    const sourceX = positions[edgeIndex];
    const targetX = positions[edgeIndex + 1];
    const sourceEdge = sourceX + nodeWidth * 0.5;
    const phaseInputX = targetX - nodeWidth * 0.5;
    const indexX = (sourceEdge + phaseInputX) * 0.5;
    const indexWidth = Math.max(40, Math.min(68, spacing * 0.35));
    const phasorWidth = Math.max(52, Math.min(76, nodeWidth * 0.86));
    return `
      <path class="chaotic-path-wire"
        d="M ${sourceEdge} ${nodeY} L ${indexX - indexWidth * 0.5} ${nodeY}
           M ${indexX + indexWidth * 0.5} ${nodeY} L ${phaseInputX} ${nodeY}" />
      <g class="chaotic-path-block">
        <rect x="${indexX - indexWidth * 0.5}" y="${nodeY - 18}"
          width="${indexWidth}" height="36" rx="3" />
        <text class="chaotic-path-title" x="${indexX}" y="${nodeY - 4}">× INDEX</text>
        <text class="chaotic-path-value" x="${indexX}" y="${nodeY + 10}">
          ${formatRecursivePmNumber(operator.phaseIndex)}
        </text>
      </g>
      <g class="chaotic-path-block is-control">
        <rect x="${phaseInputX - phasorWidth * 0.5}" y="39"
          width="${phasorWidth}" height="34" rx="3" />
        <text class="chaotic-path-title" x="${phaseInputX}" y="52">PHASOR</text>
        <text class="chaotic-path-value" x="${phaseInputX}" y="66">
          ${formatRecursivePmFrequency(operator.frequencyHz)}
        </text>
      </g>
      <path class="chaotic-path-control-wire"
        d="M ${phaseInputX} 73 L ${phaseInputX} ${nodeY}" />
      <g class="chaotic-path-junction">
        <circle cx="${phaseInputX}" cy="${nodeY}" r="7" />
        <text x="${phaseInputX}" y="${nodeY + 3}">+</text>
      </g>
    `;
  }).join("");
  const operatorMarkup = operators.map((operator, index) => {
    const x = positions[index];
    const audible = index === stack.audibleIndex;
    const title = operator.kind === "carrier"
      ? "CARRIER SINE"
      : `PM TURN ${operator.turn}`;
    const value = operator.kind === "carrier"
      ? formatRecursivePmFrequency(operator.frequencyHz)
      : "sine operator";
    return `
      <g class="chaotic-path-operator${index === 0 ? " is-seed" : ""}${audible ? " is-audible" : ""}">
        <rect x="${x - nodeWidth * 0.5}" y="${nodeY - nodeHeight * 0.5}"
          width="${nodeWidth}" height="${nodeHeight}" rx="4" />
        <text class="chaotic-path-title" x="${x}" y="${nodeY - 4}">${title}</text>
        <text class="chaotic-path-value" x="${x}" y="${nodeY + 10}">${value}</text>
        <path class="chaotic-path-tap${audible ? " is-open" : ""}"
          d="M ${x} ${nodeY + nodeHeight * 0.5} L ${x} ${busY}" />
        <circle class="chaotic-path-tap-switch${audible ? " is-open" : ""}"
          cx="${x}" cy="${busY}" r="4" />
      </g>
    `;
  }).join("");
  const firstTurn = operators[1] ?? null;
  flow.innerHTML = `
    <svg class="recursive-pm-flow-detailed" viewBox="0 0 ${graphWidth} 210" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker class="chaotic-path-arrow" id="recursivePmArrow" viewBox="0 0 8 8"
          refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${inputMarkup}
      ${operatorMarkup}
      <path class="chaotic-path-bus" d="M ${left} ${busY} L ${busEnd} ${busY}" />
      <text class="chaotic-path-bus-label" x="${left}" y="201">
        operator taps · only operator ${stack.audibleIndex} is open
      </text>
      <path class="chaotic-path-audio-wire" marker-end="url(#recursivePmArrow)"
        d="M ${busEnd} ${busY} L ${outputX - 6} ${busY}" />
      <g class="chaotic-path-output">
        <rect x="${outputX}" y="148" width="116" height="48" rx="4" />
        <text class="chaotic-path-title" x="${outputX + 58}" y="166">NORMALIZE</text>
        <text class="chaotic-path-value" x="${outputX + 58}" y="181">
          ${(stack.normalizedGain * 100).toFixed(0)}% → AUDIO
        </text>
      </g>
    </svg>
    <svg class="recursive-pm-flow-compact" viewBox="0 0 380 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="recursive-pm-compact-node is-carrier">
        <rect x="8" y="35" width="70" height="45" rx="3" />
        <text class="recursive-pm-compact-title" x="43" y="53">CARRIER</text>
        <text class="recursive-pm-compact-value" x="43" y="68">${formatRecursivePmFrequency(operators[0].frequencyHz)}</text>
      </g>
      <text class="recursive-pm-compact-arrow" x="88" y="61">→</text>
      <g class="recursive-pm-compact-node is-phase">
        <rect x="100" y="35" width="82" height="45" rx="3" />
        <text class="recursive-pm-compact-title" x="141" y="53">INDEX + PHASOR</text>
        <text class="recursive-pm-compact-value" x="141" y="68">${firstTurn ? `×${formatRecursivePmNumber(firstTurn.phaseIndex)} · ${formatRecursivePmFrequency(firstTurn.frequencyHz)}` : "CARRIER TAP"}</text>
      </g>
      <text class="recursive-pm-compact-arrow" x="192" y="61">→</text>
      <g class="recursive-pm-compact-node is-turns">
        <rect x="204" y="35" width="78" height="45" rx="3" />
        <text class="recursive-pm-compact-title" x="243" y="53">${stack.actualDepth === 0 ? "FINAL TAP" : `${stack.actualDepth} PM ${stack.actualDepth === 1 ? "TURN" : "TURNS"}`}</text>
        <text class="recursive-pm-compact-value" x="243" y="68">OP ${stack.audibleIndex} OPEN</text>
      </g>
      <text class="recursive-pm-compact-arrow" x="292" y="61">→</text>
      <g class="recursive-pm-compact-node is-output">
        <rect x="304" y="35" width="68" height="45" rx="3" />
        <text class="recursive-pm-compact-title" x="338" y="53">AUDIO</text>
        <text class="recursive-pm-compact-value" x="338" y="68">NORMALIZED</text>
      </g>
      <text class="recursive-pm-compact-caption" x="8" y="101">PREVIOUS SINE × INDEX + PHASOR → NEXT SINE</text>
    </svg>
  `;
  flow.setAttribute(
    "aria-label",
    `Carrier sine at ${formatRecursivePmFrequency(operators[0].frequencyHz)} feeds `
      + `${stack.actualDepth} phase-modulation stages. At each stage the previous sine `
      + "is multiplied by the displayed index and added to the displayed phasor. "
      + `Only operator ${stack.audibleIndex} reaches the normalized output.`,
  );
}

function updateControlOutputs(stack = currentStack()) {
  const { settings } = stack;
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatRecursivePmFrequency(settings.carrierHz);
  controls.startModFrequencyHz.output.textContent = formatRecursivePmFrequency(
    settings.startModFrequencyHz,
  );
  controls.frequencyDivisor.output.textContent = `÷${formatRecursivePmNumber(settings.frequencyDivisor)}`;
  controls.startPhaseIndex.output.textContent = formatRecursivePmNumber(settings.startPhaseIndex);
  controls.indexDivisor.output.textContent = `÷${formatRecursivePmNumber(settings.indexDivisor)}`;

  const summary = summarizeRecursivePmStack(stack);
  const bounded = stack.actualDepth < stack.requestedDepth ? "frequency bounded" : "bounded";
  $("structureState").textContent = `${summary.actualDepth} ${summary.actualDepth === 1 ? "recursion" : "recursions"} · ${bounded}`;
  $("carrierReadout").textContent = `${formatRecursivePmFrequency(settings.carrierHz)} sine`;
  $("entryReadout").textContent = `${formatRecursivePmFrequency(settings.startModFrequencyHz)} · index ${formatRecursivePmNumber(settings.startPhaseIndex)}`;
  const phaseOperators = stack.operators.filter(
    (operator) => operator.kind === "phase-operator",
  );
  $("turnsReadout").textContent = phaseOperators.length > 0
    ? phaseOperators.map(
      (operator) => (
        `${operator.turn}: ${formatRecursivePmFrequency(operator.frequencyHz)}`
        + ` × ${formatRecursivePmNumber(operator.phaseIndex)}`
      ),
    ).join(" · ")
    : "none · carrier sine is audible";
  $("operatorReadout").textContent = `operator ${stack.audibleIndex} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatRecursivePmFrequency(settings.maximumFrequencyHz);
  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · ${engine.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Recursive PM algorithm with ${summary.actualDepth} recursive ${summary.actualDepth === 1 ? "operator" : "operators"}. Audio ${engine.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
  }
}

function applySettings(settings, { presetId = null, announce = false } = {}) {
  const safe = sanitizeRecursivePmSettings(
    settings,
    { sampleRate: engine.sampleRate },
  );
  state.settings = {
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    startModFrequencyHz: safe.startModFrequencyHz,
    frequencyDivisor: safe.frequencyDivisor,
    startPhaseIndex: safe.startPhaseIndex,
    indexDivisor: safe.indexDivisor,
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
      ? `${preset.label} Recursive PM preset selected.`
      : "Recursive PM parameters reset.";
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

function updateAdsrPreview() {
  const sustainY = 64 - state.performance.ampSustainLevel * 52;
  $("adsrCurve").setAttribute(
    "d",
    `M 8 64 Q 31 12 52 8 Q 76 ${sustainY} 103 ${sustainY} L 171 ${sustainY} Q 202 ${sustainY} 232 64`,
  );
}

function writePerformanceControls() {
  for (const [key, control] of Object.entries(performanceControls)) {
    control.input.value = String(state.performance[key]);
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
  performanceControls.pitchBendRangeSemitones.output.textContent = `±${state.performance.pitchBendRangeSemitones} st`;

  const glideOverride = midiPerformance.glideOverride;
  const glideLabel = glideOverride === null
    ? state.performance.glideMode
    : `CC65 ${glideOverride ? "on" : "off"}`;
  $("performanceState").textContent = state.performance.playMode === "drone"
    ? "Drone · continuous"
    : `${glideLabel} glide · mono`;
  $("currentNote").textContent = midiPerformance.currentNote === null
    ? "—"
    : `${midiNoteName(midiPerformance.currentNote)} · ${midiPerformance.currentNote}`;
  $("bendState").textContent = `${midiPerformance.bendNormalized >= 0 ? "+" : ""}${(
    midiPerformance.bendNormalized
      * state.performance.pitchBendRangeSemitones
  ).toFixed(2)} st`;
  $("sustainState").textContent = midiPerformance.sustain ? "held" : "up";
  $("expressionValue").textContent = `${Math.round(
    midiPerformance.expression * 100,
  )}%`;
  $("expressionMeter").style.setProperty(
    "--expression",
    midiPerformance.expression,
  );
  updateAdsrPreview();
}

function glideForGate(event) {
  if (midiPerformance.glideOverride === false) return false;
  if (midiPerformance.glideOverride === true) return event.legato;
  return state.performance.glideMode === "always"
    || (state.performance.glideMode === "legato" && event.legato);
}

function performGateOn(event) {
  engine.noteOn(event.notePitchRatio, event.velocityGain, {
    attackMs: state.performance.ampAttackMs,
    decayMs: state.performance.ampDecayMs,
    sustainLevel: state.performance.ampSustainLevel,
    glideTimeMs: state.performance.glideTimeMs,
    glide: glideForGate(event),
    retrigger: !event.legato,
    bendSemitones: event.bendSemitones,
  });
}

function syncCurrentNoteToAudio() {
  if (state.performance.playMode !== "midi"
    || midiPerformance.currentNote === null) return;
  performGateOn({
    notePitchRatio: midiPerformance.currentNotePitchRatio(),
    bendSemitones: midiPerformance.currentBendSemitones(),
    velocityGain: recursivePmVelocityGain(midiPerformance.currentVelocity),
    legato: false,
  });
}

function applyMidiPerformanceEvent(event) {
  if (event.type === "parameter") {
    state.performance = {
      ...sanitizeRecursivePmPerformance({
        ...state.performance,
        [event.key]: event.value,
      }),
    };
    if (event.key === "ampSustainLevel") {
      engine.setSustainLevel(state.performance.ampSustainLevel);
    }
    return;
  }
  if (event.type === "expression") {
    if (state.performance.playMode === "midi") engine.setExpression(event.value);
    return;
  }
  if (state.performance.playMode !== "midi") return;
  if (event.type === "gateOn") performGateOn(event);
  else if (event.type === "gateOff") engine.noteOff(state.performance.ampReleaseMs);
  else if (event.type === "allSoundOff") engine.allSoundOff();
  else if (event.type === "pitchBend") {
    engine.setPitchBend(event.bendSemitones);
  }
  else if (event.type === "retune") {
    engine.setPitchRatio(event.notePitchRatio, { glideSeconds: 0 });
  }
}

function handleMidiAction(action) {
  const events = midiPerformance.handle(action);
  for (const event of events) applyMidiPerformanceEvent(event);

  let activity = "MIDI";
  if (action.type === "noteOn") {
    activity = `${midiNoteName(action.note)} · velocity ${action.velocity}`;
  } else if (action.type === "noteOff") {
    activity = `${midiNoteName(action.note)} released`;
  } else if (action.type === "pitchBend") {
    activity = "Pitch bend";
  } else if (action.type === "controlChange") {
    activity = `CC${action.controller} · ${action.value}`;
  }
  $("midiActivity").textContent = activity;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  writePerformanceControls();
}

const sharedMidiMacroTargets = [
  { label: "Depth", input: controls.depth.input },
  { label: "Mod frequency", input: controls.startModFrequencyHz.input },
  { label: "Phase index", input: controls.startPhaseIndex.input },
  { label: "Index divisor", input: controls.indexDivisor.input },
  { label: "Attack", input: performanceControls.ampAttackMs.input },
  { label: "Release", input: performanceControls.ampReleaseMs.input },
  { label: "Glide", input: performanceControls.glideTimeMs.input },
  { label: "Output", input: $("level") },
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

function handleSharedMidiMessage(message) {
  if (!state.midiActive || disposed || !message) return;
  if (applySharedMidiMacro(message.logical)) return;
  handleMidiAction(message);
}

function setPlayMode(mode, { announce = false } = {}) {
  state.performance = {
    ...sanitizeRecursivePmPerformance({
      ...state.performance,
      playMode: mode,
    }),
  };
  engine.setPlayMode(state.performance.playMode);
  engine.setExpression(
    state.performance.playMode === "midi" ? midiPerformance.expression : 1,
  );
  if (state.performance.playMode === "midi") syncCurrentNoteToAudio();
  writePerformanceControls();
  if (announce) {
    $("liveStatus").textContent = state.performance.playMode === "midi"
      ? "Recursive PM MIDI mode. Play a connected keyboard; the last held note has priority."
      : "Recursive PM Drone mode. Audio is continuous and presets retain their original carrier.";
  }
}

function panicMidiPerformance() {
  for (const controller of [120, 121]) {
    const events = midiPerformance.handle({
      type: "controlChange",
      controller,
      value: 0,
      channel: 0,
      sourceId: "shared-midi",
    });
    for (const event of events) applyMidiPerformanceEvent(event);
  }
}

function prepareSharedMidiEnable() {
  panicMidiPerformance();
  $("midiActivity").textContent = "Enabling MIDI…";
  writePerformanceControls();
}

function handleSharedMidiEnabledChange(enabled) {
  const active = Boolean(enabled);
  const changed = state.midiActive !== active;
  if (!active && state.midiActive) panicMidiPerformance();
  state.midiActive = active;
  setPlayMode(active ? "midi" : "drone");
  if (!changed) return;
  $("midiActivity").textContent = active
    ? "MIDI on · waiting for notes"
    : "MIDI off · Drone mode";
  $("liveStatus").textContent = active
    ? "Shared MIDI on. Recursive PM is in monophonic MIDI mode."
    : "Shared MIDI off. Recursive PM returned to Drone mode.";
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
    id: "recursive-pm",
    onMessage: handleSharedMidiMessage,
    onEnabledChange: handleSharedMidiEnabledChange,
    onPrepareEnable: prepareSharedMidiEnable,
    onProfileChange: handleSharedMidiProfileChange,
  });
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

function drawOperatorNode(context, x, y, radius, color, selected) {
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = selected ? color : "#07090b";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = selected ? 2 : 1;
  context.stroke();

  if (!selected) {
    context.beginPath();
    context.arc(x, y, Math.max(2.5, radius * 0.38), -Math.PI * 0.7, Math.PI * 0.55);
    context.strokeStyle = color;
    context.globalAlpha = 0.55;
    context.stroke();
  }
  context.restore();
}

function drawAlgorithm(context, stack, width, height) {
  const operators = stack.operators;
  const left = Math.max(28, width * 0.065);
  const right = width - left;
  const graphY = Math.max(92, Math.min(height * 0.47, height - 112));
  const available = Math.max(1, right - left);
  const spacing = operators.length > 1 ? available / (operators.length - 1) : 0;
  const radius = Math.max(7, Math.min(13, spacing * 0.23 || 13));

  context.save();
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 1; index < operators.length; index += 1) {
    const x1 = left + spacing * (index - 1);
    const x2 = left + spacing * index;
    const selected = index === operators.length - 1;
    context.beginPath();
    context.moveTo(x1 + radius + 3, graphY);
    context.lineTo(x2 - radius - 3, graphY);
    context.strokeStyle = selected ? "#fff1c7" : "#ff8fd8";
    context.globalAlpha = 0.42;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;

    if (spacing > 62) {
      context.fillStyle = "#77837e";
      context.fillText(
        `× ${formatRecursivePmNumber(operators[index].phaseIndex)}`,
        (x1 + x2) / 2,
        graphY - 17,
      );
    }
  }

  operators.forEach((operator, index) => {
    const x = left + spacing * index;
    const selected = index === stack.audibleIndex;
    const color = selected
      ? "#fff1c7"
      : (index === 0 ? "#65f0c7" : "#ff8fd8");
    drawOperatorNode(
      context,
      x,
      graphY,
      selected ? radius + 2 : radius,
      color,
      selected,
    );
    context.fillStyle = selected ? "#07090b" : color;
    context.font = `${Math.max(6, Math.min(9, radius * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(index === 0 ? "C" : "ϕ", x, graphY + 0.5);

    if (spacing > 38 || operators.length <= 7) {
      context.fillStyle = selected ? "#fff1c7" : "#77837e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(
        index === 0 ? "CARRIER" : `TURN ${index}`,
        x,
        graphY + radius + 17,
      );
      if (index > 0 && spacing > 52) {
        context.fillText(
          formatRecursivePmFrequency(operator.frequencyHz),
          x,
          graphY + radius + 29,
        );
      }
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
    context.strokeStyle = "#ff8fd8";
    context.shadowColor = "rgba(255, 143, 216, 0.35)";
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
  drawChaoticLiveAnalysis(canvasContext, {
    analyser: engine.analyser,
    audioOn: engine.running,
    glow: "rgba(255, 143, 216, 0.35)",
    height: cssHeight,
    spectrum,
    spectrumBarCap: "rgba(255, 241, 199, 0.82)",
    spectrumBarFill: "rgba(255, 143, 216, 0.28)",
    stroke: "#ff8fd8",
    waveform: engine.readWaveform(),
    width: cssWidth,
  });
}

function visualizationFrame(timestamp) {
  visualFrameId = null;
  if (disposed) return;
  const shouldAnimate = engine.running && !document.hidden;
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
    state.performance = {
      ...sanitizeRecursivePmPerformance({
        ...state.performance,
        [name]: Number(control.input.value),
      }),
    };
    if (name === "rootMidiNote"
      || name === "pitchBendRangeSemitones") {
      const events = name === "rootMidiNote"
        ? midiPerformance.setRootMidiNote(state.performance.rootMidiNote)
        : midiPerformance.setPitchBendRange(
          state.performance.pitchBendRangeSemitones,
        );
      for (const event of events) applyMidiPerformanceEvent(event);
    }
    if (name === "ampSustainLevel") {
      engine.setSustainLevel(state.performance.ampSustainLevel);
    }
    writePerformanceControls();
  });
}

$("glideMode").addEventListener("change", () => {
  state.performance = {
    ...sanitizeRecursivePmPerformance({
      ...state.performance,
      glideMode: $("glideMode").value,
    }),
  };
  writePerformanceControls();
});

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
      $("liveStatus").textContent = "Recursive PM audio off.";
    } else {
      await engine.start(state.settings, state.level);
      engine.setPlayMode(state.performance.playMode, { immediate: true });
      engine.setExpression(
        state.performance.playMode === "midi" ? midiPerformance.expression : 1,
        { immediate: true },
      );
      syncCurrentNoteToAudio();
      $("liveStatus").textContent = "Recursive PM audio on.";
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

$("resetRecursivePm").addEventListener("click", () => {
  clearError();
  for (const event of midiPerformance.handle({
    type: "controlChange",
    controller: 120,
    value: 0,
  })) applyMidiPerformanceEvent(event);
  for (const event of midiPerformance.handle({
    type: "controlChange",
    controller: 121,
    value: 0,
  })) applyMidiPerformanceEvent(event);
  state.performance = {
    ...RECURSIVE_PM_PERFORMANCE_DEFAULTS,
    playMode: state.midiActive ? "midi" : "drone",
  };
  midiPerformance.setPitchBendRange(
    state.performance.pitchBendRangeSemitones,
  );
  midiPerformance.setRootMidiNote(state.performance.rootMidiNote);
  setPlayMode(state.performance.playMode);
  state.level = DEFAULT_LEVEL;
  $("level").value = String(DEFAULT_LEVEL);
  $("levelOut").textContent = `${Math.round(DEFAULT_LEVEL * 100)}%`;
  engine.setLevel(DEFAULT_LEVEL);
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    announce: true,
  });
  writePerformanceControls();
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
  unregisterMidiClient?.();
  unregisterMidiClient = null;
  engine.stop({ immediate: true });
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
  if (event.key !== "Escape" || !engine.running) return;
  engine.stop({ immediate: true }).finally(() => {
    state.audioStarting = false;
    updateAudioUi();
    visualizationDirty = true;
    scheduleVisualization();
  });
});

writeControlsFromState();
writePerformanceControls();
registerSharedMidiClient();
updatePresetButtons();
updateControlOutputs();
beginResizeObservation();
resizeCanvas();
