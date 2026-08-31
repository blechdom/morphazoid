import {
  SHADER_PLAYGROUND_COMBOS,
  SHADER_PLAYGROUND_MODULES,
  SHADER_PLAYGROUND_PRESETS,
  SHADER_PLAYGROUND_LIMITS,
  SHADER_PLAYGROUND_LAYOUT_DEFAULTS,
  SHADER_PLAYGROUND_RUNTIME_DEFAULTS,
  ShaderSynthPlaygroundAudio,
  canConnectShaderPlaygroundPorts,
  createShaderPlaygroundCombo,
  createShaderPlaygroundPatch,
  layoutShaderPlaygroundPatch,
  sanitizeShaderPlaygroundPatch,
  shaderPlaygroundSupport,
  validateShaderPlaygroundPatch,
} from "./src/shader-synth-playground.js?v=20260831-state-bypass";
import {
  WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  sanitizeWebGpuSynthOrganRanks,
} from "./src/webgpu-synths.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const copy = (value) => globalThis.structuredClone
  ? globalThis.structuredClone(value)
  : JSON.parse(JSON.stringify(value));
const MIDI_PATCH_ROOT_NOTE = 48;
const MIDI_PITCH_BEND_SEMITONES = 2;
const PERFORMANCE_OCTAVE_MIN = 1;
const PERFORMANCE_OCTAVE_MAX = 6;
const PERFORMANCE_NOTE_KEYS = Object.freeze([
  "Z", "S", "X", "D", "C", "V", "G", "B", "H", "N", "J", "M", "Q",
]);
const PERFORMANCE_NOTE_NAMES = Object.freeze([
  "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B", "C",
]);
const PERFORMANCE_ACCIDENTALS = new Set([1, 3, 6, 8, 10]);

const SIGNAL_COLORS = Object.freeze({
  audio: "#74f7ff",
  control: "#ffda57",
  trigger: "#ff6eaa",
  stereo: "#91ff63",
});

const CATEGORY_COLORS = Object.freeze({
  source: "#74f7ff",
  modulation: "#ffda57",
  geometry: "#ff8ccf",
  dynamics: "#ff6eaa",
  nonlinear: "#a78bff",
  space: "#e883ee",
  spectral: "#ff9f68",
  filter: "#67c8ff",
  utility: "#91ff63",
  output: "#91ff63",
});

const HISTORY_MODULE_IDS = new Set([
  "delay",
  "reverb",
  "recombobulator",
  "spectral-resynth",
  "flanger",
  "chorus",
  "vibrato",
  "doppler-sweep",
  "fft-robotizer",
  "spectral-gate",
  "vibrato",
  "fir-lowpass",
  "fir-highpass",
  "fir-bandpass",
  "sample-rate-reducer",
]);

const CATEGORY_LABELS = Object.freeze({
  source: "Sources · instruments",
  modulation: "Modulation · arpeggiators",
  geometry: "Geometry · coordinates · patterns",
  control: "Clocks · arpeggiators · control",
  compose: "Mix · VCA",
  dynamics: "Dynamics",
  nonlinear: "Shapers · distortion",
  shape: "Waveshaping",
  space: "Delay · reverb · motion",
  spectral: "FFT · spectral · robot",
  filter: "FIR · frequency filters",
  utility: "Mix · route · rhythm",
  output: "Output",
});

const CATEGORY_ORDER = Object.freeze([
  "space",
  "source",
  "modulation",
  "geometry",
  "spectral",
  "filter",
  "control",
  "compose",
  "dynamics",
  "nonlinear",
  "shape",
  "utility",
  "output",
]);

const FEATURED_MODULE_ORDER = Object.freeze([
  "delay",
  "reverb",
  "flanger",
  "chorus",
  "vibrato",
  "doppler-sweep",
  "fft-robotizer",
  "spectral-gate",
  "spectral-resynth",
  "additive-drawbar-organ",
  "air-swoosh",
  "laser-woosh",
  "robot-voice",
  "shepard-risset-spiral",
  "procedural-bird-flock",
  "thunder-impact-cell",
  "chord-arpeggiator",
  "euclidean-arpeggiator",
  "random-walk-arpeggiator",
  "gpu-arp",
  "mirror-fold-sequencer",
  "sdf-orbit-sequencer",
  "polar-kaleidoscope-sequencer",
  "voronoi-cell-sequencer",
  "truchet-path-sequencer",
  "kifs-fold-sequencer",
  "interference-lattice-sequencer",
  "phase-plane",
  "tile-mirror-domain",
  "polar-fold-domain",
  "sdf-pattern-field",
  "sdf-logic",
  "interference-field",
  "voronoi-event-field",
  "truchet-router",
  "am-tremolo",
]);

const COMBO_FAMILY_CATEGORIES = Object.freeze({
  "wave-pan": "tonal",
  "fold-motion": "texture",
  "noise-events": "rhythmic",
  "pm-strikes": "rhythmic",
  "partial-shimmer": "texture",
  "ring-fold": "experimental",
  "dual-spectrum": "tonal",
  "pm-layer": "experimental",
  "gated-hybrid": "rhythmic",
  "phase-pulse": "rhythmic",
  "folded-partials": "texture",
  "three-source-drone": "texture",
});

const rawModuleEntries = Array.isArray(SHADER_PLAYGROUND_MODULES)
  ? SHADER_PLAYGROUND_MODULES.map((module) => [module.id, module])
  : Object.entries(SHADER_PLAYGROUND_MODULES ?? {});

function listOfPorts(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value ?? {}).map(([id, port]) => (
    typeof port === "string" ? { id, type: port } : { id, ...port }
  ));
}

function listOfParams(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value ?? {}).map(([id, param]) => (
    typeof param === "number" ? { id, default: param } : { id, ...param }
  ));
}

function normalizeModule([fallbackId, definition]) {
  const id = definition.id ?? fallbackId;
  const category = definition.category ?? definition.group ?? definition.kind ?? "utility";
  const faust = definition.faust ?? definition.faustPrimitive ?? definition.faustEquivalent ?? "";
  const shaderSource = definition.shaderSource ?? definition.shaderReference ?? null;
  return {
    ...definition,
    id,
    label: definition.label ?? definition.name ?? definition.title ?? id,
    category,
    role: definition.role ?? definition.description ?? definition.audio ?? "A shader synthesis building block.",
    color: definition.color ?? CATEGORY_COLORS[category] ?? SIGNAL_COLORS.audio,
    inputs: listOfPorts(definition.inputs ?? definition.ports?.inputs).map((port) => ({
      ...port,
      id: port.id ?? port.name,
      label: port.label ?? port.name ?? port.id,
      type: port.type ?? port.signal ?? "audio",
    })),
    outputs: listOfPorts(definition.outputs ?? definition.ports?.outputs).map((port) => ({
      ...port,
      id: port.id ?? port.name,
      label: port.label ?? port.name ?? port.id,
      type: port.type ?? port.signal ?? "audio",
    })),
    params: listOfParams(definition.params ?? definition.parameters).map((param) => ({
      ...param,
      id: param.id ?? param.name,
      label: param.label ?? param.name ?? param.id,
      min: Number.isFinite(param.min) ? param.min : 0,
      max: Number.isFinite(param.max) ? param.max : 1,
      step: Number.isFinite(param.step) ? param.step : 0.01,
      default: Number.isFinite(param.default) ? param.default : Number(param.value) || 0,
      unit: param.unit ?? "",
      behavior: param.behavior ?? param.description ?? param.effect ?? "Changes this module's response.",
      low: param.low ?? param.lowLabel ?? "subtle",
      high: param.high ?? param.highLabel ?? "strong",
    })),
    wgsl: definition.wgsl ?? definition.shader ?? definition.syntax ?? "// WGSL expression supplied by the module implementation.",
    execution: definition.execution ?? definition.executionShape ?? "Evaluated in the GPU sample pass.",
    shaderSource,
    shaderSourceLabel: typeof shaderSource === "string"
      ? shaderSource
      : shaderSource?.label ?? shaderSource?.name ?? shaderSource?.title ?? "",
    shaderSourceUrl: typeof shaderSource === "object" ? shaderSource?.url ?? "" : "",
    faust,
    faustSymbol: typeof faust === "string" ? faust : faust?.symbol ?? faust?.name ?? faust?.expression ?? "",
    faustUrl: typeof faust === "object" ? faust?.url ?? "" : "",
  };
}

const modules = rawModuleEntries.map(normalizeModule);
const moduleById = new Map(modules.map((module) => [module.id, module]));
const presets = (Array.isArray(SHADER_PLAYGROUND_PRESETS)
  ? SHADER_PLAYGROUND_PRESETS.map((preset) => [preset.id, preset])
  : Object.entries(SHADER_PLAYGROUND_PRESETS ?? {}))
  .map(([fallbackId, preset]) => ({
    ...preset,
    id: preset.id ?? fallbackId,
    label: preset.label ?? preset.name ?? fallbackId,
  }));
const combos = (Array.isArray(SHADER_PLAYGROUND_COMBOS) ? SHADER_PLAYGROUND_COMBOS : [])
  .map((combo) => ({
    ...combo,
    label: combo.label ?? combo.name ?? combo.id,
    category: combo.category ?? COMBO_FAMILY_CATEGORIES[combo.family] ?? "experimental",
  }));
const comboById = new Map(combos.map((combo) => [combo.id, combo]));

function safeSupport() {
  try {
    const result = shaderPlaygroundSupport(globalThis);
    if (typeof result === "boolean") return { supported: result, webgpu: result, audio: result };
    return {
      supported: Boolean(result?.supported ?? (result?.webgpu && result?.audio)),
      webgpu: Boolean(result?.webgpu ?? result?.gpu),
      audio: Boolean(result?.audio ?? result?.webAudio),
      ...result,
    };
  } catch {
    const audio = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
    const webgpu = Boolean(globalThis.navigator?.gpu);
    return { supported: audio && webgpu, audio, webgpu };
  }
}

const support = safeSupport();

function spatialGraphAvailable() {
  return !globalThis.matchMedia?.("(max-width: 720px)")?.matches;
}

function patchFromPreset(preset) {
  if (!preset) return null;
  if (preset.patch) return copy(preset.patch);
  if (Array.isArray(preset.nodes)) return copy(preset);
  try {
    return createShaderPlaygroundPatch(preset.id);
  } catch {
    return null;
  }
}

function sanitizePatch(patch) {
  try {
    return sanitizeShaderPlaygroundPatch(copy(patch));
  } catch {
    return copy(patch);
  }
}

function initialPatch() {
  const presetPatch = patchFromPreset(presets[0]);
  if (presetPatch) return sanitizePatch(presetPatch);
  try {
    return sanitizePatch(createShaderPlaygroundPatch());
  } catch {
    return { name: "New shader patch", nodes: [], connections: [] };
  }
}

function patchNodes(patch = state.patch) {
  return Array.isArray(patch?.nodes) ? patch.nodes : [];
}

function patchConnections(patch = state.patch) {
  if (Array.isArray(patch?.connections)) return patch.connections;
  if (Array.isArray(patch?.edges)) return patch.edges;
  return [];
}

function nodeModuleId(node) {
  return node?.moduleId ?? node?.module ?? node?.type ?? node?.kind;
}

function nodePosition(node) {
  return {
    x: Number(node?.x ?? node?.position?.x) || 0,
    y: Number(node?.y ?? node?.position?.y) || 0,
  };
}

function setNodePosition(node, x, y) {
  if (node.position && typeof node.position === "object") {
    node.position.x = x;
    node.position.y = y;
  } else {
    node.x = x;
    node.y = y;
  }
}

function connectionEnds(connection) {
  return {
    fromNode: connection.from?.nodeId ?? connection.from?.node ?? connection.fromNode ?? connection.sourceNode ?? connection.source,
    fromPort: connection.from?.portId ?? connection.from?.port ?? connection.fromPort ?? connection.sourcePort ?? connection.output,
    toNode: connection.to?.nodeId ?? connection.to?.node ?? connection.toNode ?? connection.targetNode ?? connection.target,
    toPort: connection.to?.portId ?? connection.to?.port ?? connection.toPort ?? connection.targetPort ?? connection.input,
  };
}

function connectionId(connection, index = 0) {
  const ends = connectionEnds(connection);
  return connection.id ?? `${ends.fromNode}:${ends.fromPort}>${ends.toNode}:${ends.toPort}:${index}`;
}

function makeConnection(from, to) {
  return {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    from: { node: from.nodeId, port: from.portId },
    to: { node: to.nodeId, port: to.portId },
  };
}

function setConnections(patch, connections) {
  if (Array.isArray(patch.edges) && !Array.isArray(patch.connections)) patch.edges = connections;
  else patch.connections = connections;
}

function defaultParams(module) {
  return Object.fromEntries(module.params.map((param) => [param.id, param.default]));
}

function makeNode(module, index = patchNodes().length) {
  const viewport = $("graphViewport");
  const width = Math.max(520, viewport?.clientWidth || 720);
  const {
    nodeWidth, nodeHeight, gapX, gapY, marginX, marginTop,
  } = SHADER_PLAYGROUND_LAYOUT_DEFAULTS;
  const columnCount = Math.max(1, Math.floor((width - marginX * 2 + gapX) / (nodeWidth + gapX)));
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  const node = {
    id: `${module.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: module.id,
    x: marginX + column * (nodeWidth + gapX),
    y: marginTop + row * (nodeHeight + gapY),
    params: defaultParams(module),
  };
  if (module.stateful) node.enabled = true;
  return node;
}

function findNode(nodeId) {
  return patchNodes().find((node) => node.id === nodeId);
}

function moduleForNode(node) {
  return moduleById.get(nodeModuleId(node));
}

function findPort(endpoint) {
  const node = findNode(endpoint.nodeId);
  const module = moduleForNode(node);
  if (!module) return null;
  const ports = endpoint.direction === "input" ? module.inputs : module.outputs;
  return ports.find((port) => port.id === endpoint.portId) ?? null;
}

const state = {
  patch: initialPatch(),
  presetId: presets[0]?.id ?? null,
  comboId: null,
  selectedNodeId: null,
  selectedCableId: null,
  pendingPort: null,
  viewMode: spatialGraphAvailable() ? "patch" : "chain",
  drag: null,
  connectionDrag: null,
  suppressPortClickUntil: 0,
  audioOn: false,
  playing: false,
  engine: null,
  audioStartPromise: null,
  audioPhase: null,
  audioGeneration: 0,
  latestChunk: new Float32Array(0),
  rms: 0,
  scopeFrame: 0,
  performanceOctave: 3,
  organRanks: sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS),
  midi: {
    notes: new Map(),
    sustainChannels: new Set(),
    bends: new Map(),
    latchedVoice: null,
  },
};

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  globalThis.requestAnimationFrame?.(() => { live.textContent = message; });
}

function midiChannelKey(message = {}) {
  return `${String(message.sourceId || "midi")}:${clamp(Math.round(message.channel), 0, 15)}`;
}

function midiNoteKey(message = {}) {
  return `${midiChannelKey(message)}:${clamp(Math.round(message.note), 0, 127)}`;
}

function midiNoteName(note) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const value = clamp(Math.round(note), 0, 127);
  return `${names[value % 12]}${Math.floor(value / 12) - 1}`;
}

function performanceBaseNote() {
  return (state.performanceOctave + 1) * 12;
}

function randomPerformanceNote(baseNote, noteCount, random = Math.random) {
  const firstNote = Math.min(127, Math.max(0, Math.round(Number(baseNote) || 0)));
  const count = Math.min(128 - firstNote, Math.max(1, Math.round(Number(noteCount) || 1)));
  const draw = Math.min(1, Math.max(0, Number(random()) || 0));
  return firstNote + Math.min(count - 1, Math.floor(draw * count));
}

function syncPerformanceNoteButtons(voice = performanceMidiVoice()) {
  const selectedNote = voice?.note;
  const baseNote = performanceBaseNote();
  const container = $("performanceNoteButtons");
  if (!container) return;
  const disabled = !support.supported || Boolean(state.audioStartPromise || state.audioPhase);
  container.setAttribute(
    "aria-label",
    `Play notes from ${midiNoteName(baseNote)} to ${midiNoteName(baseNote + 12)}`,
  );
  for (const button of container.querySelectorAll("button[data-performance-note]")) {
    const active = Number(button.dataset.performanceNote) === selectedNote;
    button.setAttribute("aria-pressed", String(active));
    button.disabled = disabled;
  }
  $("performanceRandomNote").disabled = disabled;
  $("performanceOctaveDown").disabled = disabled || state.performanceOctave <= PERFORMANCE_OCTAVE_MIN;
  $("performanceOctaveUp").disabled = disabled || state.performanceOctave >= PERFORMANCE_OCTAVE_MAX;
}

function renderPerformanceNoteButtons() {
  const container = $("performanceNoteButtons");
  if (!container) return;
  const baseNote = performanceBaseNote();
  const buttons = PERFORMANCE_NOTE_NAMES.map((name, offset) => {
    const note = baseNote + offset;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `performance-note${PERFORMANCE_ACCIDENTALS.has(offset) ? " is-accidental" : ""}`;
    button.dataset.performanceNote = String(note);
    button.setAttribute("aria-label", `Play ${midiNoteName(note)}. Computer key ${PERFORMANCE_NOTE_KEYS[offset]}.`);
    button.setAttribute("aria-pressed", "false");
    const pitch = document.createElement("b");
    pitch.textContent = name;
    const key = document.createElement("small");
    key.textContent = PERFORMANCE_NOTE_KEYS[offset];
    button.append(pitch, key);
    return button;
  });
  container.replaceChildren(...buttons);
  syncPerformanceNoteButtons();
}

function shiftPerformanceOctave(direction) {
  const next = clamp(
    state.performanceOctave + Math.sign(Number(direction) || 0),
    PERFORMANCE_OCTAVE_MIN,
    PERFORMANCE_OCTAVE_MAX,
  );
  if (next === state.performanceOctave) return;
  state.performanceOctave = next;
  renderPerformanceNoteButtons();
  syncMidiReadout();
  announce(`On-screen notes now span C${next} to C${next + 1}.`);
}

function selectedMidiVoice() {
  return [...state.midi.notes.values()].at(-1) ?? null;
}

function performanceMidiVoice() {
  return selectedMidiVoice() ?? state.midi.latchedVoice;
}

function midiVoicePitch(voice = performanceMidiVoice()) {
  if (!voice) return 0;
  const bend = state.midi.bends.get(voice.channelKey) ?? 0;
  return voice.note - MIDI_PATCH_ROOT_NOTE + bend * MIDI_PITCH_BEND_SEMITONES;
}

function midiOutputLevel() {
  return clamp(Number($("output")?.value), 0, 1);
}

function syncMidiReadout(voice = performanceMidiVoice()) {
  const readout = $("midiNoteState");
  if (!readout) return;
  if (!voice) {
    readout.textContent = `C${state.performanceOctave}`;
    readout.title = "Selected pitch. Turn MIDI on for the two-row computer keyboard: Z–M and Q–U; brackets change its octave.";
    syncPerformanceNoteButtons(null);
    return;
  }
  readout.textContent = midiNoteName(voice.note);
  readout.title = `${voice.onscreen ? "On-screen note" : voice.virtual ? "Computer key" : "MIDI input"} · pitch only · last-note priority`;
  syncPerformanceNoteButtons(voice);
}

function applyMidiPerformance({ refresh = true } = {}) {
  const heldVoice = selectedMidiVoice();
  if (heldVoice) state.midi.latchedVoice = { ...heldVoice, released: false };
  const voice = heldVoice ?? state.midi.latchedVoice;
  const performancePitch = midiVoicePitch(voice);
  // MIDI note input is a pitch-only performance overlay. It never owns the
  // transport or output gain, and the final released note remains selected.
  // Request a fresh GPU generation for responsive pitch. The audio engine
  // keeps the existing queue audible until that buffer is ready, then
  // crossfades the two generations without touching transport or master gain.
  state.engine?.setPerformancePitch?.(performancePitch, { refresh });
  syncMidiReadout(voice);
}

function releaseMidiNotes(channelKey = null, sourceId = null) {
  const sourcePrefix = sourceId ? `${String(sourceId)}:` : null;
  for (const [key, voice] of [...state.midi.notes]) {
    if (channelKey && voice.channelKey !== channelKey) continue;
    if (sourcePrefix && !voice.channelKey.startsWith(sourcePrefix)) continue;
    state.midi.notes.delete(key);
  }
  if (channelKey) {
    state.midi.sustainChannels.delete(channelKey);
    state.midi.bends.delete(channelKey);
  } else if (sourcePrefix) {
    for (const key of [...state.midi.sustainChannels]) {
      if (key.startsWith(sourcePrefix)) state.midi.sustainChannels.delete(key);
    }
    for (const key of [...state.midi.bends.keys()]) {
      if (key.startsWith(sourcePrefix)) state.midi.bends.delete(key);
    }
  } else {
    state.midi.sustainChannels.clear();
    state.midi.bends.clear();
  }
  applyMidiPerformance();
}

function handleMidiNoteOn(message) {
  const key = midiNoteKey(message);
  const voice = {
    key,
    channelKey: midiChannelKey(message),
    note: clamp(Math.round(message.note), 0, 127),
    velocity: clamp(Math.round(message.velocity), 1, 127),
    released: false,
    virtual: Boolean(message.virtual),
  };
  // Re-inserting an already-held note makes it the unambiguous last-note voice.
  state.midi.notes.delete(key);
  state.midi.notes.set(key, voice);
  applyMidiPerformance();
  announce(`${midiNoteName(voice.note)} selected. Playback stays where it is.`);
}

function handleMidiNoteOff(message) {
  const key = midiNoteKey(message);
  const voice = state.midi.notes.get(key);
  if (!voice) return;
  if (state.midi.sustainChannels.has(voice.channelKey)) voice.released = true;
  else state.midi.notes.delete(key);
  applyMidiPerformance();
  const fallback = selectedMidiVoice();
  announce(fallback
    ? `${midiNoteName(voice.note)} released. ${midiNoteName(fallback.note)} remains selected.`
    : `${midiNoteName(voice.note)} remains selected.`);
}

function handleMidiControlChange(message) {
  const channelKey = midiChannelKey(message);
  const controller = Math.round(message.controller);
  if (controller === 64) {
    if (Number(message.value) >= 64) {
      state.midi.sustainChannels.add(channelKey);
    } else {
      state.midi.sustainChannels.delete(channelKey);
      for (const [key, voice] of [...state.midi.notes]) {
        if (voice.channelKey === channelKey && voice.released) state.midi.notes.delete(key);
      }
      applyMidiPerformance();
    }
    return true;
  }
  if ([120, 123].includes(controller)) {
    releaseMidiNotes(message.synthetic ? null : channelKey, message.synthetic ? message.sourceId : null);
    return true;
  }
  if (controller === 121) {
    state.midi.bends.delete(channelKey);
    state.midi.sustainChannels.delete(channelKey);
    for (const [key, voice] of [...state.midi.notes]) {
      if (voice.channelKey === channelKey && voice.released) state.midi.notes.delete(key);
    }
    applyMidiPerformance();
    return true;
  }
  return false;
}

async function auditionPerformanceNote(note) {
  const selectedNote = clamp(Math.round(note), 0, 127);
  for (const [key, voice] of [...state.midi.notes]) {
    if (voice.onscreen) state.midi.notes.delete(key);
  }
  const channelKey = "onscreen-keyboard:0";
  const voice = {
    key: `${channelKey}:${selectedNote}`,
    channelKey,
    note: selectedNote,
    velocity: 100,
    released: false,
    virtual: true,
    onscreen: true,
  };
  state.midi.notes.set(voice.key, voice);
  state.midi.latchedVoice = { ...voice };
  applyMidiPerformance();
  const started = await startAudio({ play: true });
  if (started) announce(`${midiNoteName(selectedNote)} selected and the patch is running. Other notes retune it without gating.`);
}

async function auditionRandomPerformanceNote() {
  const baseNote = performanceBaseNote();
  const noteCount = PERFORMANCE_NOTE_NAMES.length;
  let note = randomPerformanceNote(baseNote, noteCount);
  const currentNote = performanceMidiVoice()?.note;
  if (note === currentNote && noteCount > 1) {
    note = baseNote + ((note - baseNote + 1) % noteCount);
  }
  await auditionPerformanceNote(note);
}

function selectMidiProgram(program) {
  const select = $("patchSelect");
  const options = [...(select?.options ?? [])].filter((option) => option.value);
  if (!options.length) return false;
  const option = options[((Math.round(program) % options.length) + options.length) % options.length];
  if (!option) return false;
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function handlePlaygroundMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (routeId !== "shader-synth-playground" || !message) return;
  let handled = true;
  if (message.type === "noteOn") handleMidiNoteOn(message);
  else if (message.type === "noteOff") handleMidiNoteOff(message);
  else if (message.type === "pitchBend") {
    state.midi.bends.set(midiChannelKey(message), clamp(message.normalized, -1, 1));
    if (performanceMidiVoice()?.channelKey === midiChannelKey(message)) applyMidiPerformance();
  } else if (message.type === "controlChange") handled = handleMidiControlChange(message);
  else if (message.type === "programChange") handled = selectMidiProgram(message.program ?? 0);
  else handled = false;
  if (handled) event.preventDefault();
}

function showError(error) {
  const element = $("audioError");
  element.textContent = error instanceof Error ? error.message : String(error);
  element.hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function validationSummary() {
  try {
    const result = validateShaderPlaygroundPatch(state.patch);
    if (result === true || result?.valid === true) {
      const output = patchNodes().find((node) => nodeModuleId(node) === "output");
      const hasOutputRoute = output && patchConnections().some((connection) => connectionEnds(connection).toNode === output.id);
      return { valid: Boolean(hasOutputRoute), issues: hasOutputRoute ? [] : ["Output is waiting for a signal cable."] };
    }
    if (result === false) return { valid: false, issues: ["Incomplete signal route"] };
    if (Array.isArray(result)) return { valid: result.length === 0, issues: result };
    const issues = result?.errors ?? result?.issues ?? [];
    return { valid: !issues.length, issues };
  } catch (error) {
    return { valid: false, issues: [error instanceof Error ? error.message : String(error)] };
  }
}

function syncPatch({ render = true, announceChange = false } = {}) {
  for (const node of patchNodes()) constrainDependentNodeParameters(node, moduleForNode(node));
  state.patch = sanitizePatch(state.patch);
  const validation = validateShaderPlaygroundPatch(state.patch);
  if (state.engine) {
    if (validation.valid) {
      try {
        state.engine.updatePatch(state.patch);
        state.engine.setPlaybackEnabled(state.playing);
      } catch (error) {
        state.engine.setPlaybackEnabled(false);
        showError(error);
      }
    } else {
      state.engine.setPlaybackEnabled(false);
    }
  }
  if (render) renderPatch();
  else {
    drawCables();
    syncPatchStatus();
    const patchSelect = $("patchSelect");
    if (patchSelect) {
      patchSelect.value = currentPatchSelection();
      if (patchSelect.options[0]) patchSelect.options[0].textContent = "Custom patch";
    }
  }
  if (announceChange) announce("Patch updated. Changes are live in the GPU render queue.");
}

function syncPatchStatus() {
  const nodeCount = patchNodes().length;
  const maxNodeCount = SHADER_PLAYGROUND_LIMITS?.maxNodes ?? 16;
  const cableCount = patchConnections().length;
  const validation = validationSummary();
  const descriptor = validation.valid ? "ready" : "open route";
  $("patchStatus").textContent = `${descriptor} · ${nodeCount}/${maxNodeCount} modules · ${cableCount} ${cableCount === 1 ? "cable" : "cables"}`;
  $("patchStatus").title = "Each GPU sample evaluates the graph in order. This playground currently reserves sixteen node slots per patch.";
  if ($("graphLoad")) $("graphLoad").textContent = `${nodeCount}/${maxNodeCount} modules`;
  $("graphViewport").setAttribute(
    "aria-label",
    `Shader audio patch with ${nodeCount} modules and ${cableCount} connections. Audio ${state.audioOn ? "on" : "off"}.`,
  );
  $("graphEmptyState").hidden = nodeCount !== 0;
  syncExecutionShape();
}

function syncExecutionShape() {
  const activeModuleIds = patchNodes().map((node) => nodeModuleId(node));
  const activeHistoryModules = [...new Set(activeModuleIds
    .filter((moduleId) => HISTORY_MODULE_IDS.has(moduleId)))];
  const activeStatefulModules = [...new Set(patchNodes()
    .filter((node) => moduleForNode(node)?.stateful && node.enabled !== false)
    .map((node) => nodeModuleId(node)))];
  const hasHistoryPass = activeHistoryModules.length > 0;
  const hasStatePass = activeStatefulModules.length > 0;
  const hasExtraGpuPass = hasHistoryPass || hasStatePass;
  const historyStage = $("gpuHistoryPass");
  const historyDivider = $("gpuHistoryPassDivider");
  const flow = $("executionFlowStrip");
  historyStage.hidden = !hasExtraGpuPass;
  historyDivider.hidden = !hasExtraGpuPass;
  historyStage.innerHTML = hasStatePass
    ? `GPU state <b>${hasHistoryPass ? "State + FX" : "Ordered passes"}</b>`
    : "GPU history <b>Post FX</b>";
  flow.classList.toggle("has-history-pass", hasExtraGpuPass);
  flow.setAttribute(
    "aria-label",
    hasStatePass
      ? `Current audio path: CPU to GPU, sample graph, ${activeStatefulModules.length} ordered GPU state ${activeStatefulModules.length === 1 ? "pass" : "passes"}${hasHistoryPass ? ", post effects" : ""}, then one GPU to CPU readback`
      : hasHistoryPass
        ? "Current audio path: CPU to GPU, sample pass, GPU history and post effects pass, then one GPU to CPU readback"
      : "Current audio path: CPU to GPU, sample pass, then one GPU to CPU readback",
  );

  const historyLane = $("blockStateLane");
  const postFxLane = $("separateGpuPassLane");
  historyLane.classList.toggle("is-active-path", hasExtraGpuPass);
  postFxLane.classList.toggle("is-active-path", hasExtraGpuPass);

  if (hasStatePass) {
    const stateLabels = activeStatefulModules
      .map((moduleId) => moduleById.get(moduleId)?.label ?? moduleId)
      .join(", ");
    const historySuffix = hasHistoryPass
      ? " The terminal history effects then run before the same final readback."
      : "";
    const stateVerb = activeStatefulModules.length === 1 ? "keeps" : "keep";
    $("sampleInvocationModel").textContent = `The sample graph captures connected signals on the GPU. Each active state module runs in graph order, and the graph is reevaluated so later modules receive its new output.${historySuffix}`;
    $("blockStateHeading").textContent = "Active GPU state";
    $("blockStateDescription").textContent = `${stateLabels} ${stateVerb} private state only while present in this patch.`;
    $("separateGpuPassHeading").textContent = "Ordered state passes";
    $("separateGpuPassDescription").textContent = "Intermediate graph signals, grids, spectral history, and modal state remain on the GPU. Only the completed stereo chunk returns to the CPU.";
  } else if (hasHistoryPass) {
    const labels = activeHistoryModules
      .map((moduleId) => moduleById.get(moduleId)?.label ?? moduleId)
      .join(", ");
    $("sampleInvocationModel").textContent = "The first GPU pass evaluates the sample graph. A post-FX pass then reads persistent GPU history; CPU transfer still happens only after the finished chunk.";
    $("blockStateHeading").textContent = "GPU history";
    $("blockStateDescription").textContent = `${labels} read earlier samples from a persistent GPU buffer.`;
    $("separateGpuPassHeading").textContent = "Post FX pass";
    $("separateGpuPassDescription").textContent = "History effects run after the sample pass and before the single stereo readback.";
  } else {
    $("sampleInvocationModel").textContent = "One GPU invocation computes one sample and evaluates every visible module. CPU transfers happen around the finished chunk, never between nodes.";
    $("blockStateHeading").textContent = "Block / state";
    $("blockStateDescription").textContent = "History, ordered feedback, and shared memory support recursive filters, evolving grids, spectral windows, and resonators. Their private GPU storage exists only while a matching module is present.";
    $("separateGpuPassHeading").textContent = "Separate GPU pass";
    $("separateGpuPassDescription").textContent = "Block transforms, reductions, and physical grids exchange intermediate GPU buffers between dispatches before the single final readback.";
  }
}

function formatValue(param, value) {
  if (typeof param.format === "function") return param.format(value);
  const numeric = Number(value);
  if (Array.isArray(param.options)) return param.options[clamp(Math.round(numeric), 0, param.options.length - 1)] ?? String(numeric);
  if (param.unit === "%") return `${Math.round(numeric * 100)}%`;
  if (param.unit === "Hz") return numeric >= 1000 ? `${(numeric / 1000).toFixed(2)} kHz` : `${numeric.toFixed(numeric < 10 ? 2 : 0)} Hz`;
  if (param.unit === "ms") return `${Math.round(numeric)} ms`;
  if (param.unit === "s") return `${numeric.toFixed(2)} s`;
  if (param.unit === "st" || param.unit === "semitones") return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)} st`;
  if (param.unit === "x" || param.unit === "×") return `${numeric.toFixed(2)}×`;
  const decimals = param.step >= 1 ? 0 : param.step >= 0.1 ? 1 : param.step >= 0.01 ? 2 : 3;
  return `${numeric.toFixed(decimals)}${param.unit ? ` ${param.unit}` : ""}`;
}

function moduleSearchText(module) {
  return [
    module.id,
    module.label,
    module.category,
    CATEGORY_LABELS[module.category],
    module.role,
    module.shaderSourceLabel,
    module.faustSymbol,
    module.execution,
    ...(Array.isArray(module.aliases) ? module.aliases : []),
    ...(Array.isArray(module.tags) ? module.tags : []),
    ...module.params.map((param) => `${param.id} ${param.label}`),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function renderHearMenu() {
  const select = $("moduleHearSelect");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a module…";
  const fragments = [placeholder];
  const grouped = new Map();
  for (const module of modules) {
    const category = module.category || "utility";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(module);
  }
  const categories = [...grouped.keys()].sort((left, right) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left);
    const rightIndex = CATEGORY_ORDER.indexOf(right);
    return (leftIndex < 0 ? CATEGORY_ORDER.length : leftIndex)
      - (rightIndex < 0 ? CATEGORY_ORDER.length : rightIndex);
  });
  for (const category of categories) {
    const group = document.createElement("optgroup");
    group.label = CATEGORY_LABELS[category] ?? category;
    for (const module of grouped.get(category)) {
      const option = document.createElement("option");
      option.value = module.id;
      option.textContent = module.label;
      group.append(option);
    }
    fragments.push(group);
  }
  select.replaceChildren(...fragments);
}

function renderPalette() {
  const query = $("moduleSearch").value.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const visible = modules.filter((module) => terms.every((term) => moduleSearchText(module).includes(term)));
  const groups = new Map();
  for (const module of visible) {
    const category = module.category || "utility";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(module);
  }
  for (const entries of groups.values()) {
    entries.sort((left, right) => {
      const leftIndex = FEATURED_MODULE_ORDER.indexOf(left.id);
      const rightIndex = FEATURED_MODULE_ORDER.indexOf(right.id);
      if (leftIndex < 0 && rightIndex < 0) return 0;
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    });
  }
  const fragments = [];
  const orderedGroups = [...groups].sort(([left], [right]) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left);
    const rightIndex = CATEGORY_ORDER.indexOf(right);
    return (leftIndex < 0 ? CATEGORY_ORDER.length : leftIndex)
      - (rightIndex < 0 ? CATEGORY_ORDER.length : rightIndex);
  });
  for (const [category, entries] of orderedGroups) {
    const section = document.createElement("details");
    section.className = "module-group";
    section.open = Boolean(query);

    const heading = document.createElement("summary");
    const categoryName = document.createElement("span");
    categoryName.textContent = CATEGORY_LABELS[category] ?? category;
    const categoryCount = document.createElement("small");
    categoryCount.textContent = String(entries.length);
    heading.append(categoryName, categoryCount);

    const list = document.createElement("div");
    list.className = "module-group-list";
    section.append(heading, list);
    for (const module of entries) {
      const row = document.createElement("div");
      row.className = "module-row";
      row.style.setProperty("--module-color", module.color);
      row.dataset.moduleId = module.id;
      row.title = module.role;

      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "module-name-button";
      nameButton.dataset.addModule = module.id;
      nameButton.setAttribute("aria-label", `Add ${module.label} to the patch. ${module.role}`);
      const name = document.createElement("b");
      name.textContent = module.label;
      nameButton.append(name);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "module-action-button module-add-button";
      add.dataset.addModule = module.id;
      add.textContent = "+";
      add.setAttribute("aria-label", `Add ${module.label} to the patch`);

      row.append(nameButton, add);
      list.append(row);
    }
    fragments.push(section);
  }
  if (!fragments.length) {
    const empty = document.createElement("p");
    empty.className = "palette-empty";
    empty.textContent = "No modules match that search.";
    fragments.push(empty);
  }
  $("modulePalette").replaceChildren(...fragments);
}

function isAuthoredScene(combo) {
  return combo?.collection === "authored-scenes" || combo?.kind === "scene";
}

function currentPatchSelection() {
  if (state.presetId) return `preset:${state.presetId}`;
  if (state.comboId) return `combo:${state.comboId}`;
  return "";
}

function appendPatchOptions(select, label, entries, kind) {
  if (!entries.length) return;
  const group = document.createElement("optgroup");
  group.label = label;
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = `${kind}:${entry.id}`;
    option.textContent = entry.label;
    group.append(option);
  }
  select.append(group);
}

function renderPresets() {
  const select = document.createElement("select");
  select.id = "patchSelect";
  select.name = "preset";
  select.setAttribute("aria-label", "Choose a starting point, authored scene, or variation");

  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = state.presetId || state.comboId ? "Choose a patch…" : "Custom patch";
  select.append(custom);

  const seenPatchIds = new Set(presets.map((preset) => preset.id));
  const uniqueCombos = combos.filter((combo) => {
    if (seenPatchIds.has(combo.id)) return false;
    seenPatchIds.add(combo.id);
    return true;
  });
  appendPatchOptions(select, "Starting points", presets, "preset");
  appendPatchOptions(select, "Authored scenes", uniqueCombos.filter(isAuthoredScene), "combo");
  appendPatchOptions(select, "Variations", uniqueCombos.filter((combo) => !isAuthoredScene(combo)), "combo");
  select.value = currentPatchSelection();
  $("presetButtons").replaceChildren(select);
}

function patchFromCombo(combo) {
  if (!combo) return null;
  try {
    return createShaderPlaygroundCombo(combo.id);
  } catch {
    return combo.patch ? copy(combo.patch) : null;
  }
}

function selectPrimarySoundNode() {
  return patchNodes().find((node) => {
    const module = moduleForNode(node);
    if (!module?.outputs.some((port) => ["audio", "stereo"].includes(port.type))) return false;
    return module.category === "source" || !module.inputs.some((port) => port.required && ["audio", "stereo"].some((type) => port.types?.includes(type)));
  }) ?? patchNodes()[0];
}

function loadCombo(combo) {
  const patch = patchFromCombo(combo);
  if (!patch) return;
  state.patch = sanitizePatch(patch);
  state.comboId = combo.id;
  state.presetId = null;
  state.selectedNodeId = selectPrimarySoundNode()?.id ?? null;
  state.selectedCableId = null;
  state.pendingPort = null;
  syncPatch();
  globalThis.requestAnimationFrame?.(() => fitGraph({ silent: true }));
  announce(`${combo.label} selected. ${combo.route}.`);
}

function endpointForPortButton(button) {
  return {
    nodeId: button.dataset.nodeId,
    portId: button.dataset.portId,
    direction: button.dataset.direction,
    type: button.dataset.portType,
  };
}

function sameEndpoint(first, second) {
  return Boolean(
    first
    && second
    && first.nodeId === second.nodeId
    && first.portId === second.portId
    && first.direction === second.direction,
  );
}

function applyPortConnectionState(button, endpoint = endpointForPortButton(button)) {
  const isPending = sameEndpoint(state.pendingPort, endpoint);
  const compatibility = state.pendingPort && !isPending
    ? connectionCompatible(state.pendingPort, endpoint)
    : null;
  button.classList.toggle("is-pending", isPending);
  button.classList.toggle("is-compatible", Boolean(compatibility?.valid));
  button.classList.toggle("is-incompatible", Boolean(state.pendingPort && !isPending && !compatibility?.valid));
  button.setAttribute("aria-pressed", String(isPending));
  const baseTitle = button.dataset.baseTitle || button.title;
  button.dataset.baseTitle = baseTitle;
  button.title = compatibility?.valid ? `Connect here. ${baseTitle}` : baseTitle;
}

function refreshConnectionUI() {
  const viewport = $("graphViewport");
  viewport.classList.toggle("is-connecting", state.viewMode === "patch" && Boolean(state.pendingPort));
  viewport.dataset.connectionStep = state.pendingPort ? "2" : "1";
  $("patchNodes").querySelectorAll(".node-port").forEach((button) => applyPortConnectionState(button));
}

function syncViewMode() {
  const patchMode = state.viewMode === "patch";
  $("graphViewport").dataset.viewMode = state.viewMode;
  $("shaderSynthPlayground").dataset.viewMode = state.viewMode;
  $("viewModeToggle").setAttribute("aria-pressed", String(patchMode));
  $("viewModeToggle").textContent = "Patch view";
  $("viewModeToggle").title = patchMode
    ? "Switch to the compact signal overview"
    : "Switch to the draggable patch canvas";
  $("resetView").hidden = !patchMode;
}

function setViewMode(mode) {
  state.viewMode = mode === "patch" ? "patch" : "chain";
  state.pendingPort = null;
  state.selectedCableId = null;
  hidePendingCable();
  syncViewMode();
  setConnectionHint(state.viewMode === "patch"
    ? "Step 1 of 2 — select or drag an OUT port."
    : "Simple signal overview. Choose Patch cables to change exact routing.");
  renderPatch();
  announce(state.viewMode === "patch"
    ? "Cable patching view. Select or drag from an output port."
    : "Simplified signal overview.");
}

function portButton(node, port, direction) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "node-port";
  button.dataset.nodeId = node.id;
  button.dataset.portId = port.id;
  button.dataset.direction = direction;
  button.dataset.portType = port.type;
  button.textContent = port.label;
  button.title = `${port.label}: ${port.description ?? port.role ?? `${port.type} ${direction}`}`;
  button.setAttribute("aria-label", `${port.label}, ${port.type} ${direction}`);
  applyPortConnectionState(button, {
    nodeId: node.id,
    portId: port.id,
    direction,
    type: port.type,
  });
  return button;
}

function miniValue(node, module) {
  const values = module.params.slice(0, 2).map((param) => {
    const value = Number(node.params?.[param.id] ?? param.default);
    return `${param.label} ${formatValue(param, value)}`;
  });
  return values.join(" · ");
}

function compactDestinationList(labels) {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= 2) return unique.join(" + ");
  return `${unique.slice(0, 2).join(" + ")} +${unique.length - 2}`;
}

function nodeFlowSummary(node, module) {
  const outgoing = patchConnections()
    .map((connection) => connectionEnds(connection))
    .filter((ends) => ends.fromNode === node.id);
  if (outgoing.length) {
    const types = [...new Set(outgoing.map((ends) => (
      module.outputs.find((port) => port.id === ends.fromPort)?.type
    )).filter(Boolean))];
    const destinations = outgoing.map((ends) => moduleForNode(findNode(ends.toNode))?.label);
    return `${types.join(" + ") || "signal"} → ${compactDestinationList(destinations)}`;
  }
  if (module.outputs.length) {
    const outputTypes = [...new Set(module.outputs.map((port) => port.type))];
    return `${outputTypes.join(" + ")} → unconnected`;
  }
  const inputTypes = [...new Set(module.inputs.flatMap((port) => port.types ?? [port.type]))];
  return `${inputTypes.join(" + ") || "signal"} → audio out`;
}

function createNodeElement(node, index) {
  const module = moduleForNode(node);
  if (!module) return null;
  const isSelected = node.id === state.selectedNodeId;
  const element = document.createElement("article");
  element.className = "patch-node";
  if (isSelected) element.classList.add("is-selected");
  const isBypassed = module.stateful && node.enabled === false;
  if (isBypassed) element.classList.add("is-bypassed");
  element.dataset.nodeId = node.id;
  element.style.setProperty("--node-color", module.color);
  const position = nodePosition(node);
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.tabIndex = isSelected || (!state.selectedNodeId && index === 0) ? 0 : -1;
  element.setAttribute("aria-controls", "nodeInspector");
  element.setAttribute("aria-label", `${module.label} module${isBypassed ? ", GPU state bypassed" : ""}${isSelected ? ", selected; parameters shown in the inspector" : ""}`);
  if (isSelected) element.setAttribute("aria-current", "true");

  const header = document.createElement("header");
  header.className = "node-header";
  header.dataset.dragNode = node.id;
  const copyBlock = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = module.label;
  const category = document.createElement("small");
  category.textContent = module.category;
  const flowSummary = document.createElement("span");
  flowSummary.className = "node-flow-summary";
  flowSummary.textContent = nodeFlowSummary(node, module);
  copyBlock.append(label, category, flowSummary);
  const nodeIndex = document.createElement("span");
  nodeIndex.className = "node-index";
  if (isSelected) nodeIndex.classList.add("is-selection-status");
  nodeIndex.textContent = isSelected ? "Selected" : String(index + 1).padStart(2, "0");
  header.append(copyBlock, nodeIndex);

  const body = document.createElement("div");
  body.className = "node-body";
  const inputs = document.createElement("div");
  inputs.className = "node-inputs";
  const inputLabel = document.createElement("span");
  inputLabel.className = "port-column-title";
  inputLabel.textContent = "← IN";
  inputs.append(inputLabel, ...module.inputs.map((port) => portButton(node, port, "input")));
  const outputs = document.createElement("div");
  outputs.className = "node-outputs";
  const outputLabel = document.createElement("span");
  outputLabel.className = "port-column-title";
  outputLabel.textContent = "OUT →";
  outputs.append(outputLabel, ...module.outputs.map((port) => portButton(node, port, "output")));
  body.append(inputs, outputs);
  const readout = document.createElement("span");
  readout.className = "node-mini-value";
  readout.textContent = isBypassed ? "GPU state off · input A through" : miniValue(node, module) || module.execution;
  body.append(readout);
  element.append(header, body);
  return element;
}

function cablePath(from, to) {
  if (to.x < from.x) {
    const viewport = $("graphViewport");
    const routeRight = Math.min((viewport?.clientWidth || from.x + 48) - 8, from.x + 36);
    const routeLeft = Math.max(8, to.x - 36);
    const betweenRows = Math.abs(to.y - from.y) > 64;
    const turnY = betweenRows
      ? (from.y + to.y) * 0.5
      : Math.max(34, Math.min(from.y, to.y) - 44);
    return [
      `M ${from.x.toFixed(1)} ${from.y.toFixed(1)}`,
      `C ${routeRight.toFixed(1)} ${from.y.toFixed(1)}, ${routeRight.toFixed(1)} ${(turnY - 8).toFixed(1)}, ${from.x.toFixed(1)} ${turnY.toFixed(1)}`,
      `L ${to.x.toFixed(1)} ${turnY.toFixed(1)}`,
      `C ${routeLeft.toFixed(1)} ${(turnY + 8).toFixed(1)}, ${routeLeft.toFixed(1)} ${to.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    ].join(" ");
  }
  const reach = Math.max(48, Math.min(180, Math.abs(to.x - from.x) * 0.48));
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${(from.x + reach).toFixed(1)} ${from.y.toFixed(1)}, ${(to.x - reach).toFixed(1)} ${to.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function portCenter(nodeId, portId, direction) {
  const port = $("patchNodes").querySelector(
    `.node-port[data-node-id="${CSS.escape(nodeId)}"][data-port-id="${CSS.escape(portId)}"][data-direction="${direction}"]`,
  );
  if (!port) return null;
  const portBox = port.getBoundingClientRect();
  const viewportBox = $("graphViewport").getBoundingClientRect();
  return {
    x: direction === "output" ? portBox.right - viewportBox.left : portBox.left - viewportBox.left,
    y: portBox.top + portBox.height / 2 - viewportBox.top,
  };
}

function cableSignalType(connection) {
  const ends = connectionEnds(connection);
  const node = findNode(ends.fromNode);
  const module = moduleForNode(node);
  return module?.outputs.find((port) => port.id === ends.fromPort)?.type ?? "audio";
}

function drawCables() {
  const layer = $("patchCableLayer");
  const svg = $("patchCables");
  const width = $("graphViewport").clientWidth;
  const height = $("graphViewport").clientHeight;
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
  layer.replaceChildren();
  patchConnections().forEach((connection, index) => {
    const ends = connectionEnds(connection);
    const from = portCenter(ends.fromNode, ends.fromPort, "output");
    const to = portCenter(ends.toNode, ends.toPort, "input");
    if (!from || !to) return;
    const id = connectionId(connection, index);
    const signalType = cableSignalType(connection);
    const pathData = cablePath(from, to);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.cableId = id;
    group.dataset.portType = signalType;
    const visible = document.createElementNS("http://www.w3.org/2000/svg", "path");
    visible.setAttribute("d", pathData);
    visible.setAttribute("class", `patch-cable${state.selectedCableId === id ? " is-selected" : ""}`);
    visible.dataset.portType = signalType;
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", pathData);
    hit.setAttribute("class", "patch-cable-hit");
    hit.dataset.cableId = id;
    hit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.selectedCableId === id) {
        removeSelectedCable();
        return;
      }
      state.selectedCableId = id;
      state.selectedNodeId = null;
      state.pendingPort = null;
      drawCables();
      renderInspector();
      setConnectionHint("Cable selected. Press Delete or tap it again to remove it.");
    });
    group.append(visible, hit);
    layer.append(group);
  });
}

function renderPatch() {
  syncViewMode();
  const rawNodes = patchNodes();
  const order = state.viewMode === "chain" ? validateShaderPlaygroundPatch(state.patch).order ?? [] : [];
  const orderedIds = [...order, ...rawNodes.map((node) => node.id).filter((id) => !order.includes(id))];
  const byId = new Map(rawNodes.map((node) => [node.id, node]));
  const nodes = state.viewMode === "chain" ? orderedIds.map((id) => byId.get(id)).filter(Boolean) : rawNodes;
  $("patchNodes").replaceChildren(...nodes.map(createNodeElement).filter(Boolean));
  refreshConnectionUI();
  renderPresets();
  renderPatchControls();
  renderInspector();
  syncPatchStatus();
  globalThis.requestAnimationFrame?.(drawCables);
}

function describePort(port, direction) {
  const directionLabel = direction === "input" ? "IN" : "OUT";
  return `${directionLabel} · ${port.type}`;
}

const ORGAN_RANK_FIELDS = Object.freeze([
  Object.freeze({ key: "ratio", label: "Ratio", min: 0.125, max: 16, step: 0.001, unit: "" }),
  Object.freeze({ key: "level", label: "Level", min: 0, max: 1, step: 0.01, unit: "" }),
  Object.freeze({ key: "amRate", label: "AM rate", min: 0, max: 30, step: 0.01, unit: "Hz" }),
  Object.freeze({ key: "amDepth", label: "AM depth", min: 0, max: 1, step: 0.01, unit: "" }),
]);

function renderOrganRankControls(module) {
  const section = $("organRankSection");
  const controls = $("organRankControls");
  const visible = module?.id === "additive-drawbar-organ";
  section.hidden = !visible;
  if (!visible) {
    controls.replaceChildren();
    return;
  }
  const rows = state.organRanks.map((rank, rankIndex) => {
    const row = document.createElement("div");
    row.className = "organ-rank-row";
    const number = document.createElement("b");
    const laneLabel = module.lanes?.[rankIndex]?.label ?? `Rank ${rankIndex + 1}`;
    number.textContent = laneLabel.split("·").at(-1)?.trim() || String(rankIndex + 1).padStart(2, "0");
    number.title = laneLabel;
    row.append(number);
    for (const field of ORGAN_RANK_FIELDS) {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.className = "sr-only";
      caption.textContent = `Organ rank ${rankIndex + 1} ${field.label}`;
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.value = String(rank[field.key]);
      input.dataset.organRank = String(rankIndex);
      input.dataset.organRankField = field.key;
      input.setAttribute("aria-label", caption.textContent);
      label.append(caption, input);
      row.append(label);
    }
    return row;
  });
  controls.replaceChildren(...rows);
}

function createPatchOrganRankControls(module, node) {
  const disclosure = document.createElement("details");
  disclosure.className = "patch-organ-ranks";
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = "Harmonic lanes";
  const count = document.createElement("small");
  count.textContent = `${WEBGPU_SYNTHS_ORGAN_RANK_COUNT} × ${ORGAN_RANK_FIELDS.length}`;
  summary.append(title, count);

  const lanes = document.createElement("div");
  lanes.className = "patch-organ-rank-list";
  state.organRanks.forEach((rank, rankIndex) => {
    const lane = document.createElement("section");
    lane.className = "patch-organ-rank";
    const laneName = document.createElement("h4");
    const laneLabel = module.lanes?.[rankIndex]?.label ?? `Rank ${rankIndex + 1}`;
    laneName.textContent = laneLabel;
    const knobs = document.createElement("div");
    knobs.className = "patch-organ-rank-knobs";
    for (const field of ORGAN_RANK_FIELDS) {
      const value = clamp(rank[field.key], field.min, field.max);
      const control = document.createElement("label");
      control.className = "patch-knob-control is-organ-rank";
      const name = document.createElement("span");
      name.className = "patch-knob-label";
      name.textContent = field.label;
      const dial = document.createElement("span");
      dial.className = "patch-knob-dial";
      dial.setAttribute("aria-hidden", "true");
      setKnobPosition(dial, parameterNormalizedValue(field, value));
      dial.append(document.createElement("i"));
      const input = document.createElement("input");
      input.id = `patch-${node.id}-rank-${rankIndex}-${field.key}`;
      input.type = "range";
      input.dataset.organRank = String(rankIndex);
      input.dataset.organRankField = field.key;
      input.setAttribute("aria-label", `${laneLabel} ${field.label}`);
      configureParameterRange(input, field, value);
      const output = document.createElement("output");
      output.htmlFor = input.id;
      output.textContent = formatValue(field, value);
      control.append(name, dial, input, output);
      knobs.append(control);
    }
    lane.append(laneName, knobs);
    lanes.append(lane);
  });
  disclosure.append(summary, lanes);
  return disclosure;
}

function syncOrganRankControlSurfaces(rankIndex, field) {
  const descriptor = ORGAN_RANK_FIELDS.find((candidate) => candidate.key === field);
  const value = state.organRanks[rankIndex]?.[field];
  if (!descriptor || !Number.isFinite(value)) return;
  for (const input of document.querySelectorAll("input[data-organ-rank][data-organ-rank-field]")) {
    if (Number(input.dataset.organRank) !== rankIndex || input.dataset.organRankField !== field) continue;
    if (input.type === "range") configureParameterRange(input, descriptor, value);
    else input.value = String(value);
    input.closest(".patch-knob-control")
      ?.querySelector("output")
      ?.replaceChildren(formatValue(descriptor, value));
  }
}

function updateOrganRankParameter(input) {
  const rankIndex = Number(input?.dataset?.organRank);
  const field = input?.dataset?.organRankField;
  const descriptor = ORGAN_RANK_FIELDS.find((candidate) => candidate.key === field);
  if (!Number.isInteger(rankIndex) || rankIndex < 0 || rankIndex >= WEBGPU_SYNTHS_ORGAN_RANK_COUNT || !descriptor) return false;
  const ranks = state.organRanks.map((rank) => ({ ...rank }));
  ranks[rankIndex][field] = clamp(input.value, descriptor.min, descriptor.max);
  state.organRanks = sanitizeWebGpuSynthOrganRanks(ranks);
  syncOrganRankControlSurfaces(rankIndex, field);
  state.engine?.updateOrganRanks?.(state.organRanks);
  return true;
}

function syncAllOrganRankControlSurfaces() {
  state.organRanks.forEach((_rank, rankIndex) => {
    for (const field of ORGAN_RANK_FIELDS) syncOrganRankControlSurfaces(rankIndex, field.key);
  });
}

function parameterNormalizedValue(param, value) {
  const clamped = clamp(value, param.min, param.max);
  if (param.scale === "log" && param.min > 0 && param.max > param.min) {
    return clamp(Math.log(clamped / param.min) / Math.log(param.max / param.min), 0, 1);
  }
  return clamp((clamped - param.min) / Math.max(Number.EPSILON, param.max - param.min), 0, 1);
}

function dynamicParameterMaximum(moduleId, paramId, steps, specMaximum) {
  const stepCount = Math.max(1, Math.round(Number(steps) || 1));
  if (["euclidean-gate", "euclidean-arpeggiator"].includes(moduleId) && paramId === "pulses") {
    return Math.min(specMaximum, stepCount);
  }
  if (["euclidean-gate", "euclidean-arpeggiator", "bitmask-rhythm"].includes(moduleId) && paramId === "rotation") {
    return Math.min(specMaximum, Math.max(0, stepCount - 1));
  }
  return specMaximum;
}

function isStepDependentParameter(moduleId, paramId) {
  return (["euclidean-gate", "euclidean-arpeggiator"].includes(moduleId) && paramId === "pulses")
    || (["euclidean-gate", "euclidean-arpeggiator", "bitmask-rhythm"].includes(moduleId) && paramId === "rotation");
}

function effectiveParameterDescriptor(module, node, param) {
  const stepsParam = module?.params.find(({ id }) => id === "steps");
  const steps = node?.params?.steps ?? stepsParam?.default ?? 1;
  const maximum = dynamicParameterMaximum(module?.id, param.id, steps, param.max);
  return maximum === param.max ? param : { ...param, max: maximum };
}

function constrainDependentNodeParameters(node, module) {
  if (!node || !module) return [];
  node.params ??= {};
  const changed = [];
  for (const param of module.params) {
    const effective = effectiveParameterDescriptor(module, node, param);
    const current = Number(node.params[param.id] ?? param.default);
    const value = clamp(current, effective.min, effective.max);
    if (value === current) continue;
    node.params[param.id] = value;
    changed.push(param);
  }
  return changed;
}

function setKnobPosition(dial, normalized) {
  if (!dial) return;
  dial.style.setProperty("--knob-position", String(normalized));
  dial.style.setProperty("--knob-fill", `${normalized * 75}%`);
  dial.style.setProperty("--knob-angle", `${-135 + normalized * 270}deg`);
}

function configureParameterRange(input, param, value) {
  const normalized = parameterNormalizedValue(param, value);
  if (param.scale === "log" && param.min > 0 && param.max > param.min) {
    input.min = "0";
    input.max = "1";
    input.step = "0.001";
    input.value = String(normalized);
    input.dataset.valueScale = "log";
  } else {
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(param.step);
    input.value = String(clamp(value, param.min, param.max));
    delete input.dataset.valueScale;
  }
  setKnobPosition(
    input.closest?.(".patch-knob-control")?.querySelector(".patch-knob-dial"),
    normalized,
  );
}

function syncParameterControlSurfaces(node, param, value) {
  const effective = effectiveParameterDescriptor(moduleForNode(node), node, param);
  const formatted = formatValue(effective, value);
  for (const input of document.querySelectorAll("input[type=\"range\"][data-node-id][data-param-id]")) {
    if (input.dataset.nodeId !== node.id || input.dataset.paramId !== param.id) continue;
    configureParameterRange(input, effective, value);
    input.closest(".node-control, .patch-knob-control")
      ?.querySelector("output")
      ?.replaceChildren(formatted);
  }
}

function renderPatchControls() {
  const groups = [];
  let parameterCount = 0;
  let organRanksAdded = false;
  patchNodes().forEach((node, nodeIndex) => {
    const module = moduleForNode(node);
    if (!module?.params.length) return;
    parameterCount += module.params.length;
    const group = document.createElement("section");
    group.className = "patch-control-module";
    if (node.id === state.selectedNodeId) group.classList.add("is-selected");
    group.dataset.nodeId = node.id;
    group.style.setProperty("--module-color", module.color);
    group.setAttribute("aria-labelledby", `patch-control-title-${node.id}`);

    const heading = document.createElement("header");
    const index = document.createElement("span");
    index.textContent = String(nodeIndex + 1).padStart(2, "0");
    index.setAttribute("aria-hidden", "true");
    const title = document.createElement("h3");
    title.id = `patch-control-title-${node.id}`;
    title.textContent = module.label;
    heading.append(index, title);

    const grid = document.createElement("div");
    grid.className = "patch-control-grid";
    for (const rawParam of module.params) {
      const param = effectiveParameterDescriptor(module, node, rawParam);
      const value = clamp(node.params?.[param.id] ?? param.default, param.min, param.max);
      const control = document.createElement("label");
      control.className = "patch-knob-control";
      control.title = param.behavior;

      const name = document.createElement("span");
      name.className = "patch-knob-label";
      name.textContent = param.label;

      const dial = document.createElement("span");
      dial.className = "patch-knob-dial";
      dial.setAttribute("aria-hidden", "true");
      setKnobPosition(dial, parameterNormalizedValue(param, value));
      const indicator = document.createElement("i");
      dial.append(indicator);

      const input = document.createElement("input");
      input.id = `patch-${node.id}-${param.id}`;
      input.type = "range";
      input.dataset.nodeId = node.id;
      input.dataset.paramId = param.id;
      input.setAttribute("aria-label", `${module.label} ${param.label}`);
      configureParameterRange(input, param, value);

      const output = document.createElement("output");
      output.htmlFor = input.id;
      output.textContent = formatValue(param, value);
      control.append(name, dial, input, output);
      grid.append(control);
    }
    group.append(heading, grid);
    if (module.id === "additive-drawbar-organ" && !organRanksAdded) {
      organRanksAdded = true;
      parameterCount += WEBGPU_SYNTHS_ORGAN_RANK_COUNT * ORGAN_RANK_FIELDS.length;
      group.append(createPatchOrganRankControls(module, node));
    }
    groups.push(group);
  });

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "patch-controls-empty";
    empty.textContent = "No adjustable parameters in this patch.";
    groups.push(empty);
  }
  $("patchControls").replaceChildren(...groups);
  $("patchControlCount").textContent = `${parameterCount} ${parameterCount === 1 ? "parameter" : "parameters"}`;
}

function appendInspectorReference(target, prefix, label, url) {
  if (!label) return;
  target.append(` · ${prefix}: `);
  if (!url) {
    target.append(label);
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  target.append(link);
}

function renderInspector() {
  const node = findNode(state.selectedNodeId);
  const module = moduleForNode(node);
  const inspector = $("nodeInspector");
  $("inspectorEmpty").hidden = Boolean(module);
  $("inspectorContent").hidden = !module;
  if (!module) {
    delete inspector.dataset.selectedNode;
    inspector.style.removeProperty("--node-color");
    inspector.removeAttribute("aria-describedby");
    $("organRankSection").hidden = true;
    $("organRankControls").replaceChildren();
    $("statefulNodeToggle").hidden = true;
    return;
  }
  inspector.dataset.selectedNode = node.id;
  inspector.style.setProperty("--node-color", module.color);
  inspector.setAttribute("aria-describedby", "selectedNodeTitle selectedNodeRole");
  $("selectedNodeKind").textContent = module.category;
  $("selectedNodeTitle").textContent = module.label;
  $("selectedNodeRole").textContent = module.role;
  const statefulToggle = $("statefulNodeToggle");
  const statefulEnabled = $("statefulNodeEnabled");
  const stateIsActive = module.stateful && node.enabled !== false;
  statefulToggle.hidden = !module.stateful;
  statefulEnabled.checked = stateIsActive;
  statefulEnabled.setAttribute("aria-label", `${module.label} GPU state`);
  $("statefulNodeState").textContent = stateIsActive ? "On" : "Bypassed";
  const ioRows = [];
  for (const [direction, ports] of [["input", module.inputs], ["output", module.outputs]]) {
    for (const port of ports) {
      const row = document.createElement("div");
      row.className = "io-row";
      row.dataset.signalType = port.type;
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const type = document.createElement("b");
      type.textContent = describePort(port, direction);
      const description = document.createElement("span");
      description.textContent = `${port.label} — ${port.description ?? port.role ?? `${port.type} signal`}`;
      row.append(dot, type, description);
      ioRows.push(row);
    }
  }
  if (!ioRows.length) {
    const row = document.createElement("div");
    row.className = "io-row";
    row.dataset.signalType = "control";
    row.innerHTML = "<i aria-hidden=\"true\"></i><b>INTERNAL</b><span>No patchable ports.</span>";
    ioRows.push(row);
  }
  $("ioSummary").replaceChildren(...ioRows);

  const controls = module.params.map((rawParam, index) => {
    const param = effectiveParameterDescriptor(module, node, rawParam);
    const value = clamp(node.params?.[param.id] ?? param.default, param.min, param.max);
    const label = document.createElement("label");
    label.className = "node-control";
    const heading = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = param.label;
    const output = document.createElement("output");
    output.textContent = formatValue(param, value);
    output.htmlFor = `${node.id}-${param.id}`;
    heading.append(name, output);
    const input = document.createElement("input");
    input.id = `${node.id}-${param.id}`;
    input.type = "range";
    input.dataset.paramId = param.id;
    input.dataset.nodeId = node.id;
    input.setAttribute("aria-label", `${module.label} ${param.label}`);
    configureParameterRange(input, param, value);
    const effect = document.createElement("span");
    effect.className = "parameter-effect";
    const spectrum = document.createElement("span");
    spectrum.textContent = `${param.low} ↔ ${param.high}`;
    effect.append(spectrum);
    label.append(heading, input, effect);
    if (index === 0) input.dataset.primaryParameter = "true";
    return label;
  });
  $("nodeControls").replaceChildren(...controls);
  $("parameterTitle").closest(".inspector-section").hidden = controls.length === 0;
  renderOrganRankControls(module);
  const firstParam = module.params[0]
    ? effectiveParameterDescriptor(module, node, module.params[0])
    : null;
  updateBehavior(module, node, firstParam);
  $("selectedNodeShader").textContent = typeof module.wgsl === "string"
    ? module.wgsl
    : module.wgsl?.code ?? JSON.stringify(module.wgsl, null, 2);
  const execution = $("selectedNodeExecution");
  execution.replaceChildren(String(module.execution).replace(/[.\s]+$/, ""));
  appendInspectorReference(execution, "Source", module.shaderSourceLabel, module.shaderSourceUrl);
  appendInspectorReference(execution, "FAUST", module.faustSymbol, module.faustUrl);
  execution.append(".");
  const protectedNode = Boolean(module.required || module.fixed || module.id === "output" || module.category === "output");
  $("deleteNode").disabled = protectedNode;
  $("deleteNode").textContent = protectedNode ? "Output stays in the patch" : "Remove selected module";
}

function updateBehavior(module, node, param) {
  if (!param) {
    $("parameterBehavior").textContent = `${module.role} It has no exposed numeric controls.`;
    drawParameterResponse(module, null, 0);
    return;
  }
  const value = clamp(node.params?.[param.id] ?? param.default, param.min, param.max);
  const normalized = (value - param.min) / Math.max(Number.EPSILON, param.max - param.min);
  const region = normalized < 0.34 ? param.low : normalized > 0.66 ? param.high : "the transition between both behaviors";
  $("parameterBehavior").textContent = `${param.label} is ${formatValue(param, value)}: ${param.behavior} This setting is in ${region}.`;
  drawParameterResponse(module, param, normalized);
}

function drawParameterResponse(module, param, amount) {
  const canvas = $("parameterResponseCanvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.lineWidth = 3;
  context.strokeStyle = module.color;
  context.shadowBlur = 11;
  context.shadowColor = module.color;
  context.beginPath();
  const category = `${module.category} ${module.id}`.toLocaleLowerCase();
  for (let x = 0; x <= width; x += 3) {
    const phase = x / width;
    let y;
    if (/nonlinear|fold|clip|shape|drive/.test(category)) {
      const sample = phase * 2 - 1;
      const drive = 1 + amount * 8;
      const shaped = Math.sin(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, sample * drive)));
      y = height * (0.5 - shaped * 0.37);
    } else if (/mod|lfo|phase|fm|ring/.test(category)) {
      y = height * (0.5 - Math.sin(phase * Math.PI * 2 * (1 + amount * 5)) * (0.12 + amount * 0.3));
    } else if (/noise|random/.test(category)) {
      const random = Math.sin((x + 13) * 91.713 + amount * 82.1) * 0.5 + Math.sin(x * 7.13) * 0.5;
      y = height * (0.5 - random * (0.08 + amount * 0.34));
    } else {
      y = height * (0.5 - Math.sin(phase * Math.PI * 2) * (0.12 + amount * 0.33));
    }
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.shadowBlur = 0;
  if (param) {
    context.fillStyle = "rgba(230, 237, 242, 0.64)";
    context.font = "20px ui-monospace, monospace";
    context.fillText(`${param.label}: ${Math.round(amount * 100)}% of range`, 18, height - 18);
  }
}

function setConnectionHint(message, type = "") {
  const hint = $("connectionHint");
  hint.textContent = message;
  hint.dataset.state = state.pendingPort ? "connecting" : "";
  hint.style.setProperty("--signal-color", SIGNAL_COLORS[type] ?? "var(--accent)");
}

function connectionCompatible(first, second) {
  if (!first || !second || first.direction === second.direction) {
    return { valid: false, reason: "Connect an output port to an input port." };
  }
  const output = first.direction === "output" ? first : second;
  const input = first.direction === "input" ? first : second;
  const outputPort = findPort(output);
  const inputPort = findPort(input);
  if (!outputPort || !inputPort) return { valid: false, reason: "Choose an output port and an input port." };
  try {
    return canConnectShaderPlaygroundPorts(
      state.patch,
      { node: output.nodeId, port: output.portId },
      { node: input.nodeId, port: input.portId },
    );
  } catch {
    const valid = inputPort.types?.includes(outputPort.type)
      ?? (outputPort.type === inputPort.type || (outputPort.type === "audio" && inputPort.type === "stereo"));
    return { valid, reason: valid ? "Compatible ports." : `${outputPort.type} cannot feed ${inputPort.type}.` };
  }
}

function handlePortClick(button) {
  const endpoint = endpointForPortButton(button);
  if (sameEndpoint(state.pendingPort, endpoint)) {
    state.pendingPort = null;
    setConnectionHint("Connection cancelled. Start again from any OUT or IN port.");
    renderPatch();
    return;
  }
  if (!state.pendingPort) {
    state.pendingPort = endpoint;
    setConnectionHint(
      `Step 2 of 2 — choose a glowing ${endpoint.direction === "input" ? "OUT" : "IN"} port for ${button.textContent}.`,
      endpoint.type,
    );
    renderPatch();
    return;
  }
  const compatibility = connectionCompatible(state.pendingPort, endpoint);
  if (!compatibility.valid) {
    setConnectionHint(compatibility.reason ?? `${state.pendingPort.type} cannot feed ${endpoint.type} here.`, endpoint.type);
    return;
  }
  const from = state.pendingPort.direction === "output" ? state.pendingPort : endpoint;
  const to = state.pendingPort.direction === "input" ? state.pendingPort : endpoint;
  const connections = patchConnections().filter((connection) => {
    const ends = connectionEnds(connection);
    return !(ends.toNode === to.nodeId && ends.toPort === to.portId);
  });
  const duplicate = connections.some((connection) => {
    const ends = connectionEnds(connection);
    return ends.fromNode === from.nodeId && ends.fromPort === from.portId
      && ends.toNode === to.nodeId && ends.toPort === to.portId;
  });
  if (!duplicate) connections.push(makeConnection(from, to));
  setConnections(state.patch, connections);
  state.pendingPort = null;
  state.selectedCableId = null;
  state.presetId = null;
  state.comboId = null;
  setConnectionHint("Connected. The route is live.");
  syncPatch({ announceChange: true });
}

function hidePendingCable() {
  const preview = $("pendingCable");
  preview.hidden = true;
  preview.setAttribute("d", "");
}

function beginPortDrag(event, button) {
  if (event.button !== 0) return;
  state.connectionDrag = {
    pointerId: event.pointerId,
    endpoint: endpointForPortButton(button),
    button,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  button.setPointerCapture?.(event.pointerId);
  event.stopPropagation();
}

function movePortConnection(event) {
  const drag = state.connectionDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    state.pendingPort = drag.endpoint;
    setConnectionHint(
      `Step 2 of 2 — release on a glowing ${drag.endpoint.direction === "input" ? "OUT" : "IN"} port.`,
      drag.endpoint.type,
    );
    refreshConnectionUI();
  }
  const start = portCenter(drag.endpoint.nodeId, drag.endpoint.portId, drag.endpoint.direction);
  if (!start) return;
  const viewportBox = $("graphViewport").getBoundingClientRect();
  const pointer = {
    x: event.clientX - viewportBox.left,
    y: event.clientY - viewportBox.top,
  };
  const preview = $("pendingCable");
  preview.dataset.portType = drag.endpoint.type;
  preview.setAttribute("d", drag.endpoint.direction === "output"
    ? cablePath(start, pointer)
    : cablePath(pointer, start));
  preview.hidden = false;
  event.preventDefault();
}

function endPortConnection(event) {
  const drag = state.connectionDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.button.hasPointerCapture?.(event.pointerId)) drag.button.releasePointerCapture(event.pointerId);
  hidePendingCable();
  state.connectionDrag = null;
  if (!drag.moved) return;
  if (event.type === "pointercancel") {
    state.pendingPort = null;
    refreshConnectionUI();
    return;
  }

  state.suppressPortClickUntil = Date.now() + 300;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".node-port");
  if (target && !sameEndpoint(drag.endpoint, endpointForPortButton(target))) {
    handlePortClick(target);
  } else {
    setConnectionHint(
      `Start selected. Now click a glowing ${drag.endpoint.direction === "input" ? "OUT" : "IN"} port.`,
      drag.endpoint.type,
    );
    refreshConnectionUI();
  }
  event.preventDefault();
}

function addModule(moduleId, { select = true } = {}) {
  const module = moduleById.get(moduleId);
  if (!module) return null;
  const nodes = patchNodes();
  if (nodes.length >= (SHADER_PLAYGROUND_LIMITS?.maxNodes ?? 16)) {
    announce(`This GPU pass is full at ${SHADER_PLAYGROUND_LIMITS?.maxNodes ?? 16} modules.`);
    return null;
  }
  if ((module.required || module.fixed || module.category === "output") && nodes.some((node) => nodeModuleId(node) === module.id)) {
    const existing = nodes.find((node) => nodeModuleId(node) === module.id);
    state.selectedNodeId = existing.id;
    renderPatch();
    announce(`${module.label} is already in the patch.`);
    return existing;
  }
  const node = makeNode(module, nodes.length);
  nodes.push(node);
  state.patch.nodes = nodes;
  state.presetId = null;
  state.comboId = null;
  if (select) state.selectedNodeId = node.id;
  syncPatch();
  if (state.viewMode === "chain") setViewMode("patch");
  setConnectionHint(`Step 1 of 2 — select or drag an OUT port to connect ${module.label}.`);
  announce(`${module.label} added. Cable patching view opened.`);
  return node;
}

function removeSelectedNode() {
  const node = findNode(state.selectedNodeId);
  const module = moduleForNode(node);
  if (!node || !module || module.required || module.fixed || module.category === "output") return;
  state.patch.nodes = patchNodes().filter((candidate) => candidate.id !== node.id);
  setConnections(state.patch, patchConnections().filter((connection) => {
    const ends = connectionEnds(connection);
    return ends.fromNode !== node.id && ends.toNode !== node.id;
  }));
  state.selectedNodeId = null;
  state.presetId = null;
  state.comboId = null;
  syncPatch();
  announce(`${module.label} and its cables removed.`);
}

function removeSelectedCable() {
  if (!state.selectedCableId) return false;
  const connections = patchConnections().filter((connection, index) => connectionId(connection, index) !== state.selectedCableId);
  if (connections.length === patchConnections().length) return false;
  setConnections(state.patch, connections);
  state.selectedCableId = null;
  state.presetId = null;
  state.comboId = null;
  syncPatch();
  announce("Cable removed.");
  return true;
}

function auditionModule(moduleId) {
  const focus = moduleById.get(moduleId);
  if (!focus) return;
  if (focus.auditionPatch) {
    state.patch = sanitizePatch(copy(focus.auditionPatch));
  } else {
    const preferredPreset = presets.find((candidate) => candidate.id === focus.auditionPreset);
    const containingPreset = [preferredPreset, ...presets]
      .filter(Boolean)
      .find((preset) => patchFromPreset(preset)?.nodes?.some((node) => nodeModuleId(node) === focus.id));
    if (containingPreset) {
      state.patch = sanitizePatch(patchFromPreset(containingPreset));
    } else {
      const containingCombo = combos.find((combo) => combo.moduleTypes?.includes(focus.id));
      state.patch = containingCombo
        ? sanitizePatch(patchFromCombo(containingCombo))
        : createFallbackAuditionPatch(focus);
    }
  }
  const selected = patchNodes().find((node) => nodeModuleId(node) === focus.id);
  state.selectedNodeId = selected?.id ?? null;
  state.selectedCableId = null;
  state.pendingPort = null;
  state.presetId = null;
  state.comboId = null;
  syncPatch();
  fitGraph({ silent: true });
  announce(`${focus.label} audition selected. Its live controls are ready, and playback is starting.`);
}

function requestedModuleId(search, validModuleIds) {
  const requested = new URLSearchParams(String(search ?? "")).get("module");
  return requested && validModuleIds.has(requested) ? requested : null;
}

function createFallbackAuditionPatch(focus) {
  const templateId = focus.outputs.some((port) => port.type === "control")
    ? "folded-pulse"
    : focus.inputs.length > 1
      ? "moving-drone"
      : "folded-pulse";
  const template = createShaderPlaygroundPatch(templateId);
  if (focus.id === "output") return template;

  let replacement;
  if (focus.outputs.some((port) => port.type === "control")) {
    replacement = template.nodes.find((node) => node.type === "lfo");
  } else if (focus.inputs.length > 1) {
    replacement = template.nodes.find((node) => node.type === "ring");
  } else if (focus.category === "source") {
    replacement = template.nodes.find((node) => node.type === "oscillator");
  } else {
    replacement = template.nodes.find((node) => node.type === "fold");
  }
  if (!replacement) return template;
  replacement.type = focus.id;
  replacement.params = defaultParams(focus);
  const inputIds = new Set(focus.inputs.map((port) => port.id));
  const outputId = focus.outputs[0]?.id;
  template.connections = template.connections.filter((connection) => {
    if (connection.to.node === replacement.id && !inputIds.has(connection.to.port)) return false;
    if (connection.from.node === replacement.id && !outputId) return false;
    return true;
  }).map((connection) => {
    if (connection.from.node === replacement.id) return { ...connection, from: { node: replacement.id, port: outputId } };
    return connection;
  });
  return sanitizePatch(template);
}

function loadPreset(preset) {
  const patch = patchFromPreset(preset);
  if (!patch) return;
  state.patch = sanitizePatch(patch);
  state.presetId = preset.id;
  state.comboId = null;
  state.selectedNodeId = patchNodes()[0]?.id ?? null;
  state.selectedCableId = null;
  state.pendingPort = null;
  syncPatch();
  globalThis.requestAnimationFrame?.(() => fitGraph({ silent: true }));
  announce(`${preset.label} selected. Its parameters are ready to audition.`);
}

function clearPatch() {
  const outputModule = modules.find((module) => module.category === "output" || module.id === "output");
  const outputNode = outputModule ? makeNode(outputModule, 0) : null;
  state.patch = {
    name: "Empty shader patch",
    nodes: outputNode ? [outputNode] : [],
    connections: [],
  };
  state.patch = sanitizePatch(state.patch);
  state.presetId = null;
  state.comboId = null;
  state.selectedNodeId = outputNode?.id ?? null;
  state.selectedCableId = null;
  state.pendingPort = null;
  syncPatch();
  announce("Patch cleared. Add a source to begin another route.");
}

function fitGraph({ silent = false } = {}) {
  const nodes = patchNodes();
  if (!nodes.length) return;
  const viewport = $("graphViewport");
  const width = Math.max(430, viewport.clientWidth);
  const height = Math.max(340, viewport.clientHeight);
  const layout = layoutShaderPlaygroundPatch(state.patch, { width, height });
  const positionById = new Map(layout.map((position) => [position.id, position]));
  nodes.forEach((node) => {
    const position = positionById.get(node.id);
    if (position) setNodePosition(node, position.x, position.y);
  });
  syncPatch({ render: true });
  if (!silent) announce("Graph arranged from sources to output.");
}

function beginNodeDrag(event, header) {
  if (state.viewMode !== "patch") return;
  if (globalThis.matchMedia?.("(max-width: 720px)").matches) return;
  if (event.button !== 0) return;
  const node = findNode(header.dataset.dragNode);
  if (!node) return;
  const position = nodePosition(node);
  state.drag = {
    nodeId: node.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: position.x,
    y: position.y,
  };
  state.selectedNodeId = node.id;
  state.selectedCableId = null;
  header.closest(".patch-node")?.classList.add("is-dragging", "is-selected");
  header.setPointerCapture?.(event.pointerId);
  renderInspector();
  event.preventDefault();
}

function moveNodeDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  const node = findNode(state.drag.nodeId);
  const element = $("patchNodes").querySelector(`[data-node-id="${CSS.escape(state.drag.nodeId)}"]`);
  if (!node || !element) return;
  const x = clamp(
    state.drag.x + event.clientX - state.drag.startX,
    6,
    Math.max(6, $("graphViewport").clientWidth - SHADER_PLAYGROUND_LAYOUT_DEFAULTS.nodeWidth - 6),
  );
  const y = clamp(
    state.drag.y + event.clientY - state.drag.startY,
    SHADER_PLAYGROUND_LAYOUT_DEFAULTS.marginTop,
    Math.max(
      SHADER_PLAYGROUND_LAYOUT_DEFAULTS.marginTop,
      $("graphViewport").clientHeight - SHADER_PLAYGROUND_LAYOUT_DEFAULTS.nodeHeight - 6,
    ),
  );
  setNodePosition(node, Math.round(x), Math.round(y));
  element.style.left = `${Math.round(x)}px`;
  element.style.top = `${Math.round(y)}px`;
  drawCables();
}

function endNodeDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  $("patchNodes").querySelector(`[data-node-id="${CSS.escape(state.drag.nodeId)}"]`)?.classList.remove("is-dragging");
  state.drag = null;
  state.presetId = null;
  state.comboId = null;
  syncPatch({ render: false });
}

function resolveParameterTarget(input, nodes, moduleLookup) {
  const node = nodes.find((candidate) => candidate.id === input?.dataset?.nodeId) ?? null;
  const module = node ? moduleLookup(node) : null;
  const param = module?.params.find((candidate) => candidate.id === input?.dataset?.paramId) ?? null;
  return { node, module, param };
}

function updateNodeParameter(input) {
  const { node, module, param: rawParam } = resolveParameterTarget(input, patchNodes(), moduleForNode);
  if (!node || !module || !rawParam) return;
  const param = effectiveParameterDescriptor(module, node, rawParam);
  node.params ??= {};
  const sliderValue = Number(input.value);
  const value = input.dataset.valueScale === "log"
    ? param.min * ((param.max / param.min) ** clamp(sliderValue, 0, 1))
    : clamp(sliderValue, param.min, param.max);
  node.params[param.id] = value;
  const constrained = constrainDependentNodeParameters(node, module);
  syncParameterControlSurfaces(node, rawParam, node.params[param.id]);
  if (param.id === "steps") {
    for (const candidate of module.params) {
      if (!isStepDependentParameter(module.id, candidate.id)) continue;
      syncParameterControlSurfaces(node, candidate, node.params[candidate.id] ?? candidate.default);
    }
  }
  for (const candidate of constrained) {
    syncParameterControlSurfaces(node, candidate, node.params[candidate.id]);
  }
  state.presetId = null;
  state.comboId = null;
  syncPatch({ render: false });
  const nodeElement = $("patchNodes").querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (nodeElement) nodeElement.querySelector(".node-mini-value").textContent = miniValue(node, module);
  if (node.id === state.selectedNodeId) updateBehavior(module, node, effectiveParameterDescriptor(module, node, rawParam));
  syncPatchStatus();
}

function updateStatefulNodeEnabled(input) {
  const node = findNode(state.selectedNodeId);
  const module = moduleForNode(node);
  if (!node || !module?.stateful) return;
  node.enabled = Boolean(input.checked);
  state.presetId = null;
  state.comboId = null;
  syncPatch({ render: true });
  announce(node.enabled
    ? `${module.label} GPU state is active.`
    : `${module.label} is bypassed. Input A passes through and its private GPU state is released.`);
}

function normalizeChunk(...args) {
  const payload = args[0];
  if (payload instanceof Float32Array) {
    const mono = new Float32Array(Math.floor(payload.length / 2));
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] = (payload[index * 2] + payload[index * 2 + 1]) * 0.5;
    }
    return mono;
  }
  if (Array.isArray(payload)) {
    if (payload[0] instanceof Float32Array && payload[1] instanceof Float32Array) {
      const length = Math.min(payload[0].length, payload[1].length);
      const mono = new Float32Array(length);
      for (let index = 0; index < length; index += 1) mono[index] = (payload[0][index] + payload[1][index]) * 0.5;
      return mono;
    }
    return Float32Array.from(payload.flat?.() ?? payload);
  }
  const left = payload?.left ?? payload?.channels?.[0];
  const right = payload?.right ?? payload?.channels?.[1];
  if (left instanceof Float32Array) {
    if (!(right instanceof Float32Array)) return left;
    const length = Math.min(left.length, right.length);
    const mono = new Float32Array(length);
    for (let index = 0; index < length; index += 1) mono[index] = (left[index] + right[index]) * 0.5;
    return mono;
  }
  if (payload?.samples instanceof Float32Array) return payload.samples;
  return new Float32Array(0);
}

function receiveChunk(...args) {
  const chunk = normalizeChunk(...args);
  if (!chunk.length) return;
  state.latestChunk = chunk;
  let sum = 0;
  const stride = Math.max(1, Math.floor(chunk.length / 2048));
  let count = 0;
  for (let index = 0; index < chunk.length; index += stride) {
    const value = Number.isFinite(chunk[index]) ? chunk[index] : 0;
    sum += value * value;
    count += 1;
  }
  state.rms = Math.sqrt(sum / Math.max(1, count));
}

function drawScope() {
  const canvas = $("scopeCanvas");
  const context = canvas.getContext("2d");
  if (context) {
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.strokeStyle = "#91ff63";
    context.lineWidth = 2.4;
    context.shadowBlur = 8;
    context.shadowColor = "rgba(145,255,99,.5)";
    const samples = state.latestChunk;
    if (samples.length) {
      const stride = samples.length / width;
      for (let x = 0; x < width; x += 1) {
        const value = clamp(samples[Math.min(samples.length - 1, Math.floor(x * stride))], -1, 1);
        const y = height * (0.5 - value * 0.43);
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
    } else {
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
    }
    context.stroke();
    context.shadowBlur = 0;
  }
  const db = state.rms > 0.000001 ? 20 * Math.log10(state.rms) : -Infinity;
  $("signalLevel").textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB RMS` : "silent";
  state.scopeFrame = globalThis.requestAnimationFrame?.(drawScope) ?? 0;
}

function syncTransport() {
  const startup = {
    preparing: { button: "Preparing GPU…", gpu: "preparing GPU", hint: "Preparing Web Audio and the GPU device…" },
    compiling: { button: "Compiling shaders…", gpu: "compiling shaders", hint: "Compiling the WebGPU audio shaders…" },
    rendering: { button: "Rendering audio…", gpu: "rendering first chunk", hint: "Rendering the first GPU audio chunk…" },
  }[state.audioPhase] ?? null;
  const starting = Boolean(startup || state.audioStartPromise);
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioButton").setAttribute("aria-busy", String(starting));
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("playgroundPlayButton").setAttribute("aria-pressed", String(state.playing));
  $("playgroundPlayButton").setAttribute("aria-busy", String(starting));
  $("playgroundPlayLabel").textContent = startup?.button ?? (state.playing ? "Pause patch" : "Run patch");
  $("audioButton").disabled = !support.supported || starting;
  $("playgroundPlayButton").disabled = !support.supported || starting;
  $("gpuState").textContent = !support.audio
    ? "Web Audio unavailable"
    : !support.webgpu
      ? "WebGPU unavailable"
      : startup
        ? startup.gpu
        : state.audioOn
          ? state.playing ? "streaming" : "ready"
          : "available";
  $("performanceNoteHint").textContent = !support.supported
    ? "WebGPU audio unavailable"
    : startup
      ? startup.hint
      : state.playing
        ? "Keys / MIDI retune while running"
        : "Click to start · MIDI on: Z–M / Q–U";
  syncPerformanceNoteButtons();
  syncPatchStatus();
}

function syncExecutionReadout(engine = state.engine) {
  const duration = Number(engine?.chunkDuration) || SHADER_PLAYGROUND_RUNTIME_DEFAULTS.chunkDuration;
  const sampleRate = Number(engine?.sampleRate) || 44100;
  const sampleCount = Number(engine?.chunkSamples) || Math.round(sampleRate * duration);
  const lookahead = duration * SHADER_PLAYGROUND_RUNTIME_DEFAULTS.bufferedChunks
    + SHADER_PLAYGROUND_RUNTIME_DEFAULTS.schedulePadding;
  $("gpuChunkDuration").textContent = `~${Math.round(duration * 1000)} ms chunk`;
  $("gpuChunkSampleCount").textContent = `${sampleCount.toLocaleString()} samples @ ${(sampleRate / 1000).toFixed(1)} kHz`;
  $("gpuChunkChannelCount").textContent = "stereo";
  $("gpuLookaheadDuration").textContent = `~${Math.round(lookahead * 1000)} ms queued`;
  $("graphNodeLimit").textContent = String(SHADER_PLAYGROUND_LIMITS?.maxNodes ?? 16);
}

async function startAudio({ play = state.playing } = {}) {
  if (state.audioOn && state.engine) {
    state.playing = Boolean(play);
    state.engine.setPlaybackEnabled(state.playing);
    syncTransport();
    return true;
  }
  if (state.audioStartPromise) return state.audioStartPromise;
  clearError();
  const validation = validateShaderPlaygroundPatch(state.patch);
  if (!validation.valid) {
    state.playing = false;
    showError(`Complete the graph before starting audio. ${validation.errors.join(" ")}`);
    syncTransport();
    return false;
  }
  const generation = state.audioGeneration;
  let nextEngine;
  try {
    nextEngine = new ShaderSynthPlaygroundAudio(globalThis);
  } catch {
    nextEngine = new ShaderSynthPlaygroundAudio();
  }
  nextEngine.setOutput(midiOutputLevel());
  nextEngine.setPerformancePitch?.(midiVoicePitch());
  nextEngine.setPlaybackEnabled(Boolean(play));
  nextEngine.updateOrganRanks?.(state.organRanks);
  nextEngine.setChunkHandler((...args) => receiveChunk(...args));
  nextEngine.setStatusHandler?.((phase) => {
    if (state.engine !== nextEngine) return;
    if (!["preparing", "compiling", "rendering"].includes(phase)) return;
    state.audioPhase = phase;
    syncTransport();
  });
  nextEngine.setErrorHandler((error) => {
    showError(error);
    if (state.engine === nextEngine) {
      state.playing = false;
      state.audioOn = false;
      state.audioPhase = null;
      syncTransport();
    }
  });
  state.engine = nextEngine;
  let pending;
  pending = Promise.resolve(nextEngine.start(state.patch)).then(() => {
    if (generation !== state.audioGeneration || state.engine !== nextEngine) {
      void nextEngine.stop();
      return false;
    }
    state.audioOn = true;
    state.playing = Boolean(play);
    state.audioPhase = null;
    nextEngine.setOutput(midiOutputLevel());
    nextEngine.setPerformancePitch?.(midiVoicePitch());
    nextEngine.setPlaybackEnabled(state.playing);
    nextEngine.updatePatch(state.patch);
    syncExecutionReadout(nextEngine);
    syncTransport();
    announce(state.playing ? "WebGPU audio is on and the patch is running." : "WebGPU audio is ready. Press Run patch or choose a note to hear it.");
    return true;
  }).catch(async (error) => {
    await nextEngine.stop().catch(() => {});
    if (state.engine === nextEngine) {
      state.engine = null;
      state.audioOn = false;
      state.playing = false;
      state.audioPhase = null;
      showError(error);
      syncTransport();
    }
    return false;
  }).finally(() => {
    if (state.audioStartPromise === pending) state.audioStartPromise = null;
    syncTransport();
  });
  state.audioStartPromise = pending;
  syncTransport();
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  state.audioGeneration += 1;
  const previous = state.engine;
  state.engine = null;
  state.audioStartPromise = null;
  state.audioPhase = null;
  state.audioOn = false;
  state.playing = false;
  state.latestChunk = new Float32Array(0);
  state.rms = 0;
  if (previous) await previous.stop();
  syncTransport();
  if (!quiet) announce("Shader playground audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio({ play: false });
}

async function togglePlay() {
  const next = !state.playing;
  if (next && !state.audioOn) {
    state.playing = true;
    syncTransport();
    const started = await startAudio({ play: true });
    if (!started) state.playing = false;
  } else {
    state.playing = next;
    state.engine?.setPlaybackEnabled(next);
    syncTransport();
    announce(next ? "Patch playing. Parameter changes are live." : "Patch paused. The graph remains editable.");
  }
}

$("moduleSearch").addEventListener("input", renderPalette);
$("moduleHearSelect").addEventListener("change", (event) => {
  const moduleId = event.target.value;
  if (!moduleId) return;
  auditionModule(moduleId);
  event.target.value = "";
  void startAudio({ play: true });
});
$("modulePalette").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-module]");
  if (add) addModule(add.dataset.addModule);
});

$("presetButtons").addEventListener("change", (event) => {
  if (event.target.id !== "patchSelect") return;
  const value = event.target.value;
  if (value.startsWith("preset:")) {
    const preset = presets.find((candidate) => candidate.id === value.slice(7));
    if (preset) loadPreset(preset);
  } else if (value.startsWith("combo:")) {
    const combo = comboById.get(value.slice(6));
    if (combo) loadCombo(combo);
  }
});

function selectGraphNode(nodeId, { focus = false } = {}) {
  const node = findNode(nodeId);
  if (!node) return;
  state.selectedNodeId = node.id;
  state.selectedCableId = null;
  state.pendingPort = null;
  renderPatch();
  const module = moduleForNode(node);
  setConnectionHint(`${module?.label ?? "Module"} selected. Its live controls are in the inspector.`);
  if (focus) {
    $("patchNodes").querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)?.focus();
  }
}

$("patchNodes").addEventListener("click", (event) => {
  const port = event.target.closest(".node-port");
  if (port) {
    event.stopPropagation();
    if (Date.now() < state.suppressPortClickUntil) return;
    handlePortClick(port);
    return;
  }
  const element = event.target.closest(".patch-node");
  if (!element || state.drag) return;
  selectGraphNode(element.dataset.nodeId);
});

$("patchNodes").addEventListener("keydown", (event) => {
  if (event.target.closest(".node-port")) return;
  const element = event.target.closest(".patch-node");
  if (!element) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectGraphNode(element.dataset.nodeId, { focus: true });
    return;
  }
  if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
  const nodes = [...$("patchNodes").querySelectorAll(".patch-node")];
  const index = nodes.indexOf(element);
  const offset = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const next = nodes[(index + offset + nodes.length) % nodes.length];
  if (!next) return;
  event.preventDefault();
  selectGraphNode(next.dataset.nodeId, { focus: true });
});

$("patchNodes").addEventListener("pointerdown", (event) => {
  const port = event.target.closest(".node-port");
  if (port) {
    beginPortDrag(event, port);
    return;
  }
  const header = event.target.closest("[data-drag-node]");
  if (header) beginNodeDrag(event, header);
});
$("patchNodes").addEventListener("pointermove", (event) => {
  movePortConnection(event);
  moveNodeDrag(event);
});
$("patchNodes").addEventListener("pointerup", (event) => {
  endPortConnection(event);
  endNodeDrag(event);
});
$("patchNodes").addEventListener("pointercancel", (event) => {
  endPortConnection(event);
  endNodeDrag(event);
});

$("nodeControls").addEventListener("input", (event) => {
  if (event.target.matches("input[type=\"range\"][data-param-id]")) updateNodeParameter(event.target);
});
$("statefulNodeEnabled").addEventListener("change", (event) => {
  updateStatefulNodeEnabled(event.target);
});
$("patchControls").addEventListener("input", (event) => {
  if (event.target.matches("input[type=\"range\"][data-param-id]")) {
    updateNodeParameter(event.target);
  } else if (event.target.matches("input[data-organ-rank][data-organ-rank-field]")) {
    updateOrganRankParameter(event.target);
  }
});
$("organRankControls").addEventListener("input", (event) => {
  const input = event.target.closest("input[data-organ-rank][data-organ-rank-field]");
  if (input) updateOrganRankParameter(input);
});
$("resetOrganRanks").addEventListener("click", () => {
  state.organRanks = sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS);
  state.engine?.updateOrganRanks?.(state.organRanks);
  renderOrganRankControls(moduleForNode(findNode(state.selectedNodeId)));
  syncAllOrganRankControlSurfaces();
  announce("The nine additive-organ harmonic lanes were reset.");
});
$("deleteNode").addEventListener("click", removeSelectedNode);
$("viewModeToggle").addEventListener("click", () => {
  setViewMode(state.viewMode === "patch" ? "chain" : "patch");
});
$("resetView").addEventListener("click", () => fitGraph());
$("clearPatch").addEventListener("click", clearPatch);
$("audioButton").addEventListener("click", () => { void toggleAudio(); });
$("playgroundPlayButton").addEventListener("click", () => { void togglePlay(); });
$("performanceNoteButtons").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-performance-note]");
  if (button) void auditionPerformanceNote(Number(button.dataset.performanceNote));
});
$("performanceRandomNote").addEventListener("click", () => { void auditionRandomPerformanceNote(); });
$("performanceOctaveDown").addEventListener("click", () => shiftPerformanceOctave(-1));
$("performanceOctaveUp").addEventListener("click", () => shiftPerformanceOctave(1));
$("output").addEventListener("input", () => {
  const output = clamp($("output").value, 0, 1);
  $("outputOut").textContent = `${Math.round(output * 100)}%`;
  state.engine?.setOutput(midiOutputLevel());
});

$("graphViewport").addEventListener("pointerdown", (event) => {
  if (event.target !== $("graphViewport") && event.target !== $("patchNodes")) return;
  state.pendingPort = null;
  state.selectedCableId = null;
  setConnectionHint(state.viewMode === "patch"
    ? "Step 1 of 2 — select or drag an OUT port."
    : "Simple signal overview. Choose Patch cables to change exact routing.");
  renderPatch();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    event.preventDefault();
    $("moduleSearch").focus();
    return;
  }
  if (event.key === "Escape") {
    state.pendingPort = null;
    state.selectedCableId = null;
    setConnectionHint(state.viewMode === "patch"
      ? "Connection cancelled. Start again from any OUT or IN port."
      : "Simple signal overview. Choose Patch cables to change exact routing.");
    renderPatch();
    return;
  }
  if (!['Delete', 'Backspace'].includes(event.key) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (removeSelectedCable()) event.preventDefault();
  else if (state.selectedNodeId) {
    removeSelectedNode();
    event.preventDefault();
  }
});

const graphObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(() => drawCables())
  : null;
graphObserver?.observe($("graphViewport"));
globalThis.addEventListener?.("resize", drawCables);
globalThis.addEventListener?.("morphazoid:midi-input", handlePlaygroundMidiInput);
globalThis.addEventListener?.("pagehide", () => {
  if (state.scopeFrame) cancelAnimationFrame(state.scopeFrame);
  graphObserver?.disconnect();
  globalThis.removeEventListener?.("morphazoid:midi-input", handlePlaygroundMidiInput);
  void stopAudio({ quiet: true });
}, { once: true });

if (globalThis.matchMedia?.("(max-width: 720px)")?.matches) {
  $("patchControlsPanel").open = false;
}
renderHearMenu();
renderPalette();
renderPerformanceNoteButtons();
syncExecutionReadout();
renderPatch();
syncTransport();
syncMidiReadout();
$("output").dispatchEvent(new Event("input"));
state.scopeFrame = globalThis.requestAnimationFrame?.(drawScope) ?? 0;

if (patchNodes().length) {
  state.selectedNodeId = patchNodes()[0].id;
  renderPatch();
  globalThis.requestAnimationFrame?.(() => fitGraph({ silent: true }));
}

const initialModuleId = requestedModuleId(
  globalThis.location?.search,
  new Set(moduleById.keys()),
);
if (initialModuleId) {
  auditionModule(initialModuleId);
  $("moduleHearSelect").value = "";
  announce(`${moduleById.get(initialModuleId).label} audition loaded. Press Run patch or play a note to hear it.`);
}

const initialPanel = new URLSearchParams(globalThis.location?.search ?? "").get("panel");
if (initialPanel === "execution") {
  $("executionShapeDetails").open = true;
}
