import {
  frequencyToMidiPitch,
  frequencyToNormalized,
  midiNoteToFrequency,
  normalizedToFrequency,
} from "./constellation-analysis.js";

const EPSILON = 1e-7;
const MAX_GRAPHS = 192;
const MAX_NODES_PER_GRAPH = 256;
const MAX_EDGES_PER_GRAPH = 1_024;
export const MAX_PROJECTION_BEATS = 4_096;
export const MAX_PROJECTED_EVENTS = 4_096;
export const MAX_PROJECTION_QUEUE = 16_384;
const MAX_PROJECTION_ADMISSIONS = 65_536;
const MAX_EVENT_DEPTH = 192;
const MAX_FLATTENED_INSTANCES = 65_536;
const MAX_FLATTENED_NODES = 65_536;
const MAX_FLATTENED_EDGES = 262_144;

export const SIGNAL_TYPES = Object.freeze(["trigger", "audio", "control", "midi"]);
export const EVENT_SIGNAL_TYPES = Object.freeze(["trigger", "control", "midi"]);

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const freeze = (value) => deepFreeze(value);

export function quantizeBeat(value, division = 0.25) {
  const grid = Math.max(1 / 64, finite(division, 0.25));
  return Math.round(Math.max(0, finite(value, 0)) / grid) * grid;
}

export function formatBeat(value) {
  const beat = Math.max(0, finite(value, 0));
  const whole = Math.floor(beat + EPSILON);
  const fraction = beat - whole;
  const common = [[0, ""], [.125, "⅛"], [.25, "¼"], [1 / 3, "⅓"], [.5, "½"], [2 / 3, "⅔"], [.75, "¾"], [.875, "⅞"]];
  const nearest = common.reduce((best, candidate) => (
    Math.abs(candidate[0] - fraction) < Math.abs(best[0] - fraction) ? candidate : best
  ), common[0]);
  if (Math.abs(nearest[0] - fraction) < 0.012) return `${whole || ""}${nearest[1] || (whole ? "" : "0")}`;
  return beat.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

const port = (id, direction, signal, label = id) => freeze({ id, direction, signal, label });

const preset = (id, label, params = {}, description = "") => freeze({
  id,
  label,
  description,
  params: { ...params },
});

const hiccupHeadPreset = (id, label) => preset(
  id,
  label,
  { facePresetId: id },
  `Hiccup Head physical-model preset: ${label}.`,
);

const webGpu303Preset = (id, label) => preset(
  id,
  label,
  { synthPresetId: id },
  `WebGPU 303 patch: ${label}.`,
);

/**
 * Preset metadata is intentionally engine-neutral. The graph owns stable IDs
 * and parameter snapshots; an audio adapter may resolve the full authored
 * Hiccup Head or WebGPU 303 preset without importing either standalone UI.
 */
export const DEVICE_PRESET_LIBRARY = freeze({
  "pulse-clock": [
    preset("quarter", "Quarter notes", { generator: { signal: "trigger", steps: [1], stepBeats: 1 } }),
    preset("eighth", "Eighth notes", { generator: { signal: "trigger", steps: [1], stepBeats: .5 } }),
    preset("sixteenth", "Sixteenth notes", { generator: { signal: "trigger", steps: [1], stepBeats: .25 } }),
  ],
  "clock-divider": [
    preset("divide-2", "Divide by 2", { division: 2 }),
    preset("divide-3", "Divide by 3", { division: 3 }),
    preset("divide-4", "Divide by 4", { division: 4 }),
  ],
  "clock-multiplier": [
    preset("multiply-2", "Multiply by 2", { multiplier: 2, spacingBeats: .25 }),
    preset("multiply-3", "Multiply by 3", { multiplier: 3, spacingBeats: 1 / 6 }),
    preset("multiply-4", "Multiply by 4", { multiplier: 4, spacingBeats: .125 }),
  ],
  "swing-clock": [
    preset("straight", "Straight", { amount: 0, stepBeats: .25 }),
    preset("light-swing", "Light swing", { amount: .12, stepBeats: .25 }),
    preset("deep-swing", "Deep swing", { amount: .28, stepBeats: .25 }),
  ],
  "midi-clock": [
    preset("midi-clock-24", "MIDI clock · 24 PPQN", {
      generator: { signal: "midi", steps: [1], stepBeats: 1 / 24, midi: { type: "clock" } },
      ppqn: 24,
    }),
  ],
  "graph-delay": [
    preset("short-echo", "Short echo", { delaySeconds: .14, feedback: .24, mix: .32 }),
    preset("dub-loop", "Dub loop", { delaySeconds: .38, feedback: .62, mix: .58 }),
    preset("long-orbit", "Long orbit", { delaySeconds: .82, feedback: .48, mix: .52 }),
  ],
  filter: [
    preset("open", "Open", { cutoff: 12_000, resonance: .7 }),
    preset("warm", "Warm low-pass", { cutoff: 2_200, resonance: 2.2 }),
    preset("resonant", "Resonant", { cutoff: 1_100, resonance: 9.5 }),
  ],
  reverb: [
    preset("room", "Room", { mix: .24, decay: 1.1 }),
    preset("hall", "Hall", { mix: .48, decay: 2.8 }),
    preset("void", "Void", { mix: .72, decay: 5.4 }),
  ],
  compressor: [
    preset("gentle", "Gentle glue", { threshold: -12, ratio: 2.5, attack: .012, release: .22 }),
    preset("punch", "Punch", { threshold: -20, ratio: 5, attack: .004, release: .14 }),
    preset("limit", "Limiter", { threshold: -6, ratio: 16, attack: .001, release: .08 }),
  ],
  "hiccup-head": [
    hiccupHeadPreset("humming-head", "Humming head"),
    hiccupHeadPreset("rubber-face", "Rubber face"),
    hiccupHeadPreset("chipmunk-box", "Chipmunk box"),
    hiccupHeadPreset("cavern-gob", "Cavern gob"),
    hiccupHeadPreset("tin-grin", "Tin grin"),
    hiccupHeadPreset("whisper-gremlin", "PHSHK gremlin"),
    hiccupHeadPreset("vowel-engine", "Vowel engine"),
    hiccupHeadPreset("inside-out", "Inside-out singer"),
    hiccupHeadPreset("slap-canyon", "Slap canyon"),
    hiccupHeadPreset("feral-baron", "Feral baron"),
    hiccupHeadPreset("open-throat", "Open throat"),
    hiccupHeadPreset("head-voice", "Head voice"),
    hiccupHeadPreset("humming-mask", "Humming mask"),
    hiccupHeadPreset("rattle-cave", "Rattle cave"),
    hiccupHeadPreset("sloppy-oracle", "Sloppy oracle"),
    hiccupHeadPreset("moan-cellar", "Moan cellar"),
  ],
  "webgpu-303": [
    webGpu303Preset("source-acid-synth", "Source Acid Synth"),
    webGpu303Preset("filter-snap", "Lysergic Ribbon"),
    webGpu303Preset("wide-phase", "Astral Smear"),
    webGpu303Preset("resonance-glass", "Glass Seance"),
    webGpu303Preset("voltage-bloom", "Voltage Melt"),
    webGpu303Preset("needle-stutter", "Liquid Needle"),
    webGpu303Preset("drive-floor", "Floor Warp"),
    webGpu303Preset("hollow-offset", "Hollow Halo"),
    webGpu303Preset("vector-sweep", "Vector Mirage"),
    webGpu303Preset("seed-scanner", "Oracle Scanner"),
    webGpu303Preset("opal-cathedral", "Opal Cathedral"),
    webGpu303Preset("prism-bath", "Prism Bath"),
  ],
  "surround-output": [
    preset("stereo", "Stereo", { layoutId: "stereo", channelCount: 2, renderMode: "speakers" }),
    preset("binaural", "Binaural headphones", { layoutId: "binaural", channelCount: 2, renderMode: "binaural" }),
    preset("quad", "Quad", { layoutId: "quad", channelCount: 4, renderMode: "discrete" }),
    preset("4-1", "4.1", { layoutId: "4-1", channelCount: 5, renderMode: "discrete" }),
    preset("5-1", "5.1", { layoutId: "5-1", channelCount: 6, renderMode: "discrete" }),
    preset("7-1", "7.1", { layoutId: "7-1", channelCount: 8, renderMode: "discrete" }),
    preset("8-circle", "8-channel ring", { layoutId: "8-circle", channelCount: 8, renderMode: "discrete" }),
    preset("8-cube", "8-channel cube", { layoutId: "8-cube", channelCount: 8, renderMode: "discrete" }),
    preset("7-4-1", "7.1.4 / 7:4:1", { layoutId: "7-4-1", channelCount: 12, renderMode: "discrete" }),
  ],
  recorder: [
    preset("stereo-mix", "Stereo mix", { recordMode: "mix", channelCount: 2, format: "browser" }),
    preset("stereo-stem", "Individual stereo stem", { recordMode: "stem", channelCount: 2, format: "browser" }),
  ],
  "stereo-recorder": [
    preset("stereo-mix", "Stereo mix", { recordMode: "mix", channelCount: 2, format: "browser" }),
  ],
  "stem-recorder": [
    preset("stereo-stem", "Individual stereo stem", { recordMode: "stem", channelCount: 2, format: "browser" }),
  ],
  spectrum: [
    preset("octave", "Octave bands", { fftSize: 2_048, bandMode: "octave" }),
    preset("third-octave", "Third-octave bands", { fftSize: 4_096, bandMode: "third-octave" }),
  ],
});

const EMPTY_DEVICE_PRESETS = freeze([]);

export function devicePresets(deviceId) {
  return DEVICE_PRESET_LIBRARY[deviceId] ?? EMPTY_DEVICE_PRESETS;
}

export function devicePreset(deviceId, presetId) {
  const choices = devicePresets(deviceId);
  if (presetId === undefined || presetId === null || presetId === "") return choices[0] ?? null;
  return choices.find((choice) => choice.id === presetId) ?? null;
}

export const PRIMITIVE_LIBRARY = freeze({
  clock: {
    label: "Clock",
    category: "trigger",
    color: "#e8c46b",
    ports: [port("trigger-out", "out", "trigger", "pulse")],
    generator: { signal: "trigger", steps: [1, 0, 1, 0], stepBeats: 0.25, noteOffsets: [0] },
    runtime: { kind: "clock", role: "source" },
  },
  euclid: {
    label: "Euclidean pulse",
    category: "trigger",
    color: "#ffad69",
    ports: [port("trigger-out", "out", "trigger", "pulse")],
    generator: { signal: "trigger", steps: [1, 0, 0, 1, 0, 1, 0, 0], stepBeats: 0.5, noteOffsets: [0, 0, 7, 0, 0, 5, 0, 0] },
    runtime: { kind: "clock", role: "euclidean-source" },
  },
  chance: {
    label: "Chance gate",
    category: "trigger",
    color: "#ff82c8",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
    runtime: { kind: "clock", role: "chance-gate" },
  },
  divider: {
    label: "Clock divider",
    category: "trigger",
    color: "#efcf75",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
    runtime: { kind: "clock", role: "divider", eventTransform: "clock-divider" },
  },
  "clock-multiplier": {
    label: "Clock multiplier",
    category: "trigger",
    color: "#f4d96f",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
    runtime: { kind: "clock", role: "multiplier", eventTransform: "clock-multiplier" },
  },
  "swing-clock": {
    label: "Swing clock",
    category: "trigger",
    color: "#ffb66f",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
    runtime: { kind: "clock", role: "swing", eventTransform: "clock-swing" },
  },
  "phase-clock": {
    label: "Clock phase",
    category: "trigger",
    color: "#f7c97b",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
    runtime: { kind: "clock", role: "phase", eventTransform: "clock-phase" },
  },
  "sync-bridge": {
    label: "Clock / MIDI sync",
    category: "trigger",
    color: "#ffd166",
    ports: [
      port("trigger-in", "in", "trigger", "clock in"),
      port("midi-in", "in", "midi", "MIDI sync in"),
      port("trigger-out", "out", "trigger", "clock out"),
      port("midi-out", "out", "midi", "MIDI sync out"),
    ],
    emits: { trigger: ["trigger", "midi"], midi: ["midi", "trigger"] },
    runtime: { kind: "clock", role: "sync-bridge", conversion: "clock-midi-sync" },
  },
  "midi-input": {
    label: "MIDI input",
    category: "midi",
    color: "#7cf29a",
    ports: [port("midi-out", "out", "midi", "hardware / keyboard")],
    runtime: { kind: "midi", role: "input" },
  },
  "midi-clock": {
    label: "MIDI clock",
    category: "midi",
    color: "#ff72b6",
    ports: [port("midi-out", "out", "midi", "24 PPQN")],
    generator: {
      signal: "midi",
      steps: [1],
      stepBeats: 1 / 24,
      noteOffsets: [0],
      midi: { type: "clock" },
    },
    runtime: { kind: "midi", role: "clock-source", ppqn: 24 },
  },
  "midi-router": {
    label: "MIDI router",
    category: "midi",
    color: "#ff72b6",
    ports: [port("midi-in", "in", "midi"), port("midi-out", "out", "midi")],
    runtime: { kind: "midi", role: "through" },
  },
  "midi-output": {
    label: "MIDI output",
    category: "midi",
    color: "#ff9ccd",
    output: true,
    ports: [port("midi-in", "in", "midi")],
    runtime: { kind: "midi", role: "output" },
  },
  lfo: {
    label: "LFO",
    category: "control",
    color: "#b299ff",
    ports: [port("control-out", "out", "control", "mod")],
    generator: { signal: "control", steps: [.15, .5, .85, .5], stepBeats: 0.5, noteOffsets: [0] },
  },
  envelope: {
    label: "Envelope",
    category: "control",
    color: "#c79cff",
    ports: [port("trigger-in", "in", "trigger"), port("control-out", "out", "control")],
    converts: { trigger: "control" },
  },
  "drum-voice": {
    label: "Drum voice",
    category: "instrument",
    color: "#ff8f70",
    playable: true,
    instrumentType: "drums",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("midi-in", "in", "midi"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    playableSignals: ["trigger", "midi"],
    emits: { trigger: ["trigger", "midi"], midi: ["midi"] },
    runtime: { kind: "instrument", engine: "constellation-drums" },
  },
  oscillator: {
    label: "Oscillator",
    category: "instrument",
    color: "#70e3e8",
    playable: true,
    instrumentType: "pitched",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("midi-in", "in", "midi"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    playableSignals: ["trigger", "midi"],
    emits: { trigger: ["trigger", "midi"], midi: ["midi"] },
    runtime: { kind: "instrument", engine: "constellation-oscillator" },
  },
  voice: {
    label: "Voice source",
    category: "instrument",
    color: "#ff82c8",
    playable: true,
    instrumentType: "pitched",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("midi-in", "in", "midi"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    playableSignals: ["trigger", "midi"],
    emits: { trigger: ["trigger", "midi"], midi: ["midi"] },
    runtime: { kind: "instrument", engine: "constellation-voice" },
  },
  "hiccup-head": {
    label: "Hiccup Head",
    category: "instrument",
    color: "#ff82c8",
    playable: true,
    instrumentType: "hiccup-head",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("midi-in", "in", "midi"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    playableSignals: ["trigger", "midi"],
    emits: { trigger: ["trigger", "midi"], midi: ["midi"] },
    runtime: { kind: "instrument", engine: "hiccup-head" },
  },
  "webgpu-303": {
    label: "WebGPU 303",
    category: "instrument",
    color: "#c49aff",
    playable: true,
    instrumentType: "webgpu-303",
    ports: [
      port("trigger-in", "in", "trigger", "step / reset"),
      port("midi-in", "in", "midi"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    playableSignals: ["trigger", "midi"],
    emits: { trigger: ["trigger", "midi"], midi: ["midi"] },
    runtime: { kind: "instrument", engine: "webgpu-303", transportAware: true },
  },
  gain: {
    label: "Gain",
    category: "routing",
    color: "#8de7ff",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
    runtime: { kind: "output", role: "gain" },
  },
  filter: {
    label: "Filter",
    category: "effect",
    color: "#a7e879",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("midi-in", "in", "midi"), port("audio-out", "out", "audio"), port("midi-out", "out", "midi")],
    runtime: { kind: "output", role: "filter" },
  },
  delay: {
    label: "Delay",
    category: "effect",
    color: "#70d8e7",
    ports: [
      port("audio-in", "in", "audio"),
      port("control-in", "in", "control"),
      port("trigger-in", "in", "trigger"),
      port("midi-in", "in", "midi"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
      port("midi-out", "out", "midi"),
    ],
    runtime: { kind: "output", role: "delay" },
  },
  reverb: {
    label: "Reverb",
    category: "effect",
    color: "#8fd59b",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("midi-in", "in", "midi"), port("audio-out", "out", "audio"), port("midi-out", "out", "midi")],
    runtime: { kind: "output", role: "reverb" },
  },
  compressor: {
    label: "Compressor",
    category: "effect",
    color: "#ffad69",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("midi-in", "in", "midi"), port("audio-out", "out", "audio"), port("midi-out", "out", "midi")],
    runtime: { kind: "output", role: "compressor" },
  },
  mixer: {
    label: "Mixer",
    category: "routing",
    color: "#8de7ff",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
    runtime: { kind: "output", role: "mixer" },
  },
  output: {
    label: "Output",
    category: "routing",
    color: "#c7fcfb",
    output: true,
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control")],
    runtime: { kind: "output", role: "stereo" },
  },
  "surround-output": {
    label: "Surround output",
    category: "routing",
    color: "#61f0dd",
    output: true,
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control", "position")],
    runtime: { kind: "output", role: "surround", multichannel: true },
  },
  recorder: {
    label: "Recorder",
    category: "routing",
    color: "#ff6f91",
    ports: [
      port("audio-in", "in", "audio"),
      port("trigger-in", "in", "trigger", "record transport"),
      port("control-in", "in", "control", "record level"),
      port("audio-out", "out", "audio", "monitor through"),
    ],
    runtime: { kind: "recorder", role: "audio-tap", passThrough: true },
  },
  scope: {
    label: "Oscilloscope",
    category: "monitor",
    color: "#74efff",
    ports: [port("audio-in", "in", "audio"), port("audio-out", "out", "audio")],
    runtime: { kind: "monitor", role: "scope", analysis: "waveform", passThrough: true },
  },
  "level-meter": {
    label: "Level meter",
    category: "monitor",
    color: "#b7f56a",
    ports: [port("audio-in", "in", "audio"), port("audio-out", "out", "audio"), port("control-out", "out", "control", "amplitude")],
    runtime: { kind: "monitor", role: "level", analysis: "rms-peak", passThrough: true },
  },
  spectrum: {
    label: "Spectrum / FFT",
    category: "monitor",
    color: "#6fd8ff",
    ports: [port("audio-in", "in", "audio"), port("audio-out", "out", "audio")],
    runtime: { kind: "monitor", role: "spectrum", analysis: "fft", passThrough: true },
  },
  "frequency-tracker": {
    label: "Frequency tracker",
    category: "monitor",
    color: "#9ce5ff",
    ports: [port("audio-in", "in", "audio"), port("audio-out", "out", "audio"), port("control-out", "out", "control", "frequency")],
    runtime: { kind: "monitor", role: "frequency", analysis: "fundamental", passThrough: true },
  },
  "control-display": {
    label: "Numeric control display",
    category: "monitor",
    color: "#d2bbff",
    ports: [port("control-in", "in", "control"), port("control-out", "out", "control")],
    runtime: { kind: "monitor", role: "numeric-control", analysis: "control-value", passThrough: true },
  },
  "frequency-to-midi": {
    label: "Frequency to MIDI",
    category: "converter",
    color: "#ff8fc4",
    ports: [port("control-in", "in", "control", "frequency"), port("midi-out", "out", "midi", "MIDI note")],
    converts: { control: "midi" },
    runtime: { kind: "converter", conversion: "frequency-to-midi" },
  },
  "midi-to-frequency": {
    label: "MIDI to frequency",
    category: "converter",
    color: "#be9cff",
    ports: [port("midi-in", "in", "midi", "MIDI note"), port("control-out", "out", "control", "frequency")],
    converts: { midi: "control" },
    runtime: { kind: "converter", conversion: "midi-to-frequency" },
  },
  "midi-to-control": {
    label: "MIDI to control",
    category: "converter",
    color: "#c9a8ff",
    ports: [port("midi-in", "in", "midi"), port("control-out", "out", "control")],
    converts: { midi: "control" },
    runtime: { kind: "converter", conversion: "midi-to-control" },
  },
  "amplitude-to-midi": {
    label: "Amplitude to MIDI",
    category: "converter",
    color: "#ff9aaf",
    ports: [port("audio-in", "in", "audio"), port("audio-out", "out", "audio"), port("midi-out", "out", "midi")],
    runtime: { kind: "converter", conversion: "amplitude-to-midi", analysis: "rms-gate", passThrough: true },
  },
  "audio-to-fft-bands": {
    label: "Audio to FFT bands",
    category: "converter",
    color: "#7edfff",
    ports: [
      port("audio-in", "in", "audio"),
      port("audio-out", "out", "audio"),
      port("low-out", "out", "control", "low"),
      port("mid-out", "out", "control", "mid"),
      port("high-out", "out", "control", "high"),
      port("air-out", "out", "control", "air"),
    ],
    runtime: { kind: "converter", conversion: "audio-to-fft-bands", analysis: "fft-bands", passThrough: true },
  },
});

const graphInterfacePort = (id, direction, signal, nodeId = id, label = id) => freeze({ id, direction, signal, nodeId, label });

function graphPortNode(interfacePort, x, y) {
  return {
    id: interfacePort.nodeId,
    type: "port",
    direction: interfacePort.direction,
    signal: interfacePort.signal,
    label: interfacePort.label,
    x,
    y,
  };
}

function primitiveNode(id, primitiveId, x, y, options = {}) {
  const primitive = PRIMITIVE_LIBRARY[primitiveId] ?? PRIMITIVE_LIBRARY.gain;
  return {
    id,
    type: "primitive",
    primitiveId,
    label: options.label ?? primitive.label,
    x,
    y,
    rootNote: clamp(options.rootNote, 0, 127, 48),
    gateBeats: Math.max(1 / 64, finite(options.gateBeats, 0.35)),
    soundId: options.soundId ?? primitiveId,
    presetId: options.presetId ?? null,
    deviceCore: Boolean(options.deviceCore),
    params: { ...(options.params ?? {}) },
    generator: options.generator ? clone(options.generator) : primitive.generator ? clone(primitive.generator) : undefined,
  };
}

function internalEdge(id, fromNodeId, toNodeId, signal, options = {}) {
  return {
    id,
    from: { nodeId: fromNodeId, portId: options.fromPortId ?? `${signal}-out` },
    to: { nodeId: toNodeId, portId: options.toPortId ?? `${signal}-in` },
    signal,
    timing: {
      delayBeats: quantizeBeat(options.delayBeats ?? 0, 1 / 64),
      probability: clamp(options.probability, 0, 1, 1),
    },
    gain: clamp(options.gain, 0, 2, 1),
    feedback: Boolean(options.feedback),
  };
}

function soundGraphTemplate({
  id,
  label,
  primitiveId = "oscillator",
  soundId = id,
  rootNote = 48,
  tone = "filter",
  presetId = null,
  params = {},
}) {
  const interfacePorts = [
    graphInterfacePort("trigger-in", "in", "trigger", "trigger-in", "trigger"),
    graphInterfacePort("midi-in", "in", "midi", "midi-in", "MIDI"),
    graphInterfacePort("control-in", "in", "control", "control-in", "control"),
    graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio"),
    graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "follow"),
    graphInterfacePort("midi-out", "out", "midi", "midi-out", "MIDI"),
  ];
  return {
    id,
    label,
    kind: "sound",
    presetId,
    description: `${label} is itself a trigger, MIDI, control, and audio subgraph.`,
    interface: interfacePorts,
    nodes: [
      graphPortNode(interfacePorts[0], .05, .2),
      graphPortNode(interfacePorts[1], .05, .48),
      graphPortNode(interfacePorts[2], .05, .76),
      primitiveNode("voice", primitiveId, .34, .3, {
        label,
        soundId,
        rootNote,
        presetId,
        params,
        deviceCore: true,
      }),
      primitiveNode("envelope", "envelope", .34, .72, { label: "Amplitude envelope" }),
      primitiveNode("tone", tone, .66, .3, { label: tone === "filter" ? "Tone filter" : "Voice gain", params: { cutoff: 2200, gain: .72 } }),
      graphPortNode(interfacePorts[3], .95, .2),
      graphPortNode(interfacePorts[4], .95, .5),
      graphPortNode(interfacePorts[5], .95, .78),
    ],
    edges: [
      internalEdge("trigger-voice", "trigger-in", "voice", "trigger"),
      internalEdge("midi-voice", "midi-in", "voice", "midi"),
      internalEdge("trigger-envelope", "trigger-in", "envelope", "trigger"),
      internalEdge("voice-follow", "voice", "trigger-out", "trigger"),
      internalEdge("voice-midi", "voice", "midi-out", "midi"),
      internalEdge("envelope-control", "envelope", "tone", "control"),
      internalEdge("external-control", "control-in", "tone", "control"),
      internalEdge("voice-tone", "voice", "tone", "audio"),
      internalEdge("tone-output", "tone", "audio-out", "audio"),
    ],
  };
}

function clockGraphTemplate({ id, label, primitiveId = "clock", generator, presetId = null, params = {} }) {
  const outputPort = graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "pulse");
  return {
    id,
    label,
    kind: "trigger",
    presetId,
    description: `${label} generates timestamped control-flow pulses.`,
    interface: [outputPort],
    nodes: [
      primitiveNode("generator", primitiveId, .34, .5, {
        label,
        generator: generator ?? params.generator,
        params,
        presetId,
        deviceCore: true,
      }),
      graphPortNode(outputPort, .94, .5),
    ],
    edges: [internalEdge("pulse-output", "generator", "trigger-out", "trigger")],
  };
}

function clockProcessorGraphTemplate({ id, label, primitiveId, presetId = null, params = {} }) {
  const inputPort = graphInterfacePort("trigger-in", "in", "trigger", "trigger-in", "clock in");
  const outputPort = graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "clock out");
  return {
    id,
    label,
    kind: "trigger",
    presetId,
    description: `${label} transforms timestamped clock pulses without creating a private transport.`,
    interface: [inputPort, outputPort],
    nodes: [
      graphPortNode(inputPort, .05, .5),
      primitiveNode("clock", primitiveId, .5, .5, { label, params, presetId, deviceCore: true }),
      graphPortNode(outputPort, .95, .5),
    ],
    edges: [
      internalEdge("clock-input", "trigger-in", "clock", "trigger"),
      internalEdge("clock-output", "clock", "trigger-out", "trigger"),
    ],
  };
}

function midiGraphTemplate({ id, label, primitiveId, presetId = null, params = {}, source = false, output = false }) {
  const inputPort = source ? null : graphInterfacePort("midi-in", "in", "midi", "midi-in", "MIDI in");
  const outputPort = output ? null : graphInterfacePort("midi-out", "out", "midi", "midi-out", "MIDI out");
  const interfacePorts = [inputPort, outputPort].filter(Boolean);
  const nodes = [
    ...(inputPort ? [graphPortNode(inputPort, .05, .5)] : []),
    primitiveNode("midi", primitiveId, .5, .5, {
      label,
      generator: params.generator,
      params,
      presetId,
      deviceCore: true,
    }),
    ...(outputPort ? [graphPortNode(outputPort, .95, .5)] : []),
  ];
  const edges = [
    ...(inputPort ? [internalEdge("midi-input", "midi-in", "midi", "midi")] : []),
    ...(outputPort ? [internalEdge("midi-output", "midi", "midi-out", "midi")] : []),
  ];
  return {
    id,
    label,
    kind: "midi",
    presetId,
    description: output ? "A timestamped MIDI event destination." : `${label} routes timestamped MIDI events.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function controlGraphTemplate({ id, label, primitiveId = "lfo", generator, presetId = null, params = {} }) {
  const outputPort = graphInterfacePort("control-out", "out", "control", "control-out", "control");
  return {
    id,
    label,
    kind: "control",
    presetId,
    description: `${label} is a control-signal subgraph.`,
    interface: [outputPort],
    nodes: [
      primitiveNode("modulator", primitiveId, .36, .5, {
        label,
        generator,
        params,
        presetId,
        deviceCore: true,
      }),
      graphPortNode(outputPort, .94, .5),
    ],
    edges: [internalEdge("control-output", "modulator", "control-out", "control")],
  };
}

function effectGraphTemplate({ id, label, primitiveId, triggerDelayBeats = 0, presetId = null, params = {} }) {
  const interfacePorts = [
    graphInterfacePort("audio-in", "in", "audio", "audio-in", "audio in"),
    graphInterfacePort("control-in", "in", "control", "control-in", "control"),
    graphInterfacePort("midi-in", "in", "midi", "midi-in", "MIDI in"),
    graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio out"),
    graphInterfacePort("midi-out", "out", "midi", "midi-out", "MIDI thru"),
  ];
  const supportsTrigger = primitiveId === "delay";
  if (supportsTrigger) {
    interfacePorts.push(
      graphInterfacePort("trigger-in", "in", "trigger", "trigger-in", "trigger"),
      graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "echo trigger"),
    );
  }
  const nodes = [
    graphPortNode(interfacePorts[0], .05, .32),
    graphPortNode(interfacePorts[1], .05, .72),
    graphPortNode(interfacePorts[2], .05, .9),
    primitiveNode("effect", primitiveId, .5, .42, {
      label,
      presetId,
      deviceCore: true,
      params: { delaySeconds: .22, feedback: .36, cutoff: 1800, mix: .5, ...params },
    }),
    graphPortNode(interfacePorts[3], .95, .32),
    graphPortNode(interfacePorts[4], .95, .76),
  ];
  const edges = [
    internalEdge("audio-effect", "audio-in", "effect", "audio"),
    internalEdge("control-effect", "control-in", "effect", "control"),
    internalEdge("effect-output", "effect", "audio-out", "audio"),
    internalEdge("midi-effect", "midi-in", "effect", "midi"),
    internalEdge("midi-through", "effect", "midi-out", "midi"),
  ];
  if (supportsTrigger) {
    nodes.push(graphPortNode(interfacePorts[5], .05, .56), graphPortNode(interfacePorts[6], .95, .56));
    edges.push(
      internalEdge("trigger-effect", "trigger-in", "effect", "trigger"),
      internalEdge("trigger-echo", "effect", "trigger-out", "trigger", { delayBeats: triggerDelayBeats }),
    );
  }
  return {
    id,
    label,
    kind: "effect",
    presetId,
    description: `${label} is a signal-flow graph with exposed audio, MIDI, and control ports.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function routingGraphTemplate({ id, label, primitiveId = "mixer", output = false, presetId = null, params = {} }) {
  const inputPort = graphInterfacePort("audio-in", "in", "audio", "audio-in", "audio in");
  const controlPort = graphInterfacePort("control-in", "in", "control", "control-in", "level");
  const outputPort = output ? null : graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio out");
  const interfacePorts = [inputPort, controlPort, ...(outputPort ? [outputPort] : [])];
  const nodes = [
    graphPortNode(inputPort, .05, .35),
    graphPortNode(controlPort, .05, .72),
    primitiveNode("route", primitiveId, .55, .42, {
      label,
      presetId,
      deviceCore: true,
      params: { gain: .8, ...params },
    }),
    ...(outputPort ? [graphPortNode(outputPort, .95, .35)] : []),
  ];
  const edges = [
    internalEdge("audio-route", "audio-in", "route", "audio"),
    internalEdge("control-route", "control-in", "route", "control"),
    ...(outputPort ? [internalEdge("route-output", "route", "audio-out", "audio") ] : []),
  ];
  return {
    id,
    label,
    kind: "routing",
    presetId,
    description: output ? "The final signal-flow sink." : `${label} combines audio subgraphs.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function primitiveGraphTemplate({ id, label, primitiveId, kind, presetId = null, params = {} }) {
  const primitive = PRIMITIVE_LIBRARY[primitiveId];
  const exposedPorts = primitive?.ports ?? [];
  const interfacePorts = exposedPorts.map((item) => graphInterfacePort(
    item.id,
    item.direction,
    item.signal,
    item.id,
    item.label,
  ));
  const inputPorts = interfacePorts.filter(({ direction }) => direction === "in");
  const outputPorts = interfacePorts.filter(({ direction }) => direction === "out");
  const nodes = [
    ...inputPorts.map((item, index) => graphPortNode(item, .05, (index + 1) / (inputPorts.length + 1))),
    primitiveNode("device", primitiveId, .5, .5, { label, params, presetId, deviceCore: true }),
    ...outputPorts.map((item, index) => graphPortNode(item, .95, (index + 1) / (outputPorts.length + 1))),
  ];
  const edges = interfacePorts.map((item) => item.direction === "in"
    ? internalEdge(`${item.id}-device`, item.nodeId, "device", item.signal, { toPortId: item.id })
    : internalEdge(`device-${item.id}`, "device", item.nodeId, item.signal, { fromPortId: item.id }));
  return {
    id,
    label,
    kind,
    presetId,
    description: `${label} is a typed ${kind} subgraph.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function blankGraphTemplate({ id, label }) {
  const interfacePorts = SIGNAL_TYPES.flatMap((signal) => [
    graphInterfacePort(`${signal}-in`, "in", signal, `${signal}-in`, `${signal} in`),
    graphInterfacePort(`${signal}-out`, "out", signal, `${signal}-out`, `${signal} out`),
  ]);
  const nodes = interfacePorts.map((item, index) => graphPortNode(item, item.direction === "in" ? .07 : .93, .2 + (index >> 1) * .3));
  const edges = SIGNAL_TYPES.map((signal) => internalEdge(`${signal}-through`, `${signal}-in`, `${signal}-out`, signal));
  return {
    id,
    label,
    kind: "graph",
    description: "An editable graph with trigger, audio, control, and MIDI boundaries.",
    interface: interfacePorts,
    nodes,
    edges,
  };
}

export const DEVICE_LIBRARY = freeze([
  { id: "pulse-clock", label: "Pulse Clock", category: "trigger", color: "#e8c46b", imageHref: "assets/instruments/graph-drums.webp", description: "A clock graph whose pulse pattern can be edited from the timeline.", build: "clock", defaultPresetId: "sixteenth" },
  { id: "euclidean-clock", label: "Euclidean Clock", category: "trigger", color: "#ffad69", imageHref: "assets/instruments/l-system-drums.webp", description: "A rotating uneven trigger graph.", build: "euclid" },
  { id: "clock-divider", label: "Clock Divider", category: "trigger", color: "#efcf75", imageHref: "assets/instruments/gear-ratio-drums.webp", description: "Keeps every nth pulse in the shared beat domain.", build: "clock-divider", defaultPresetId: "divide-2" },
  { id: "clock-multiplier", label: "Clock Multiplier", category: "trigger", color: "#f4d96f", imageHref: "assets/instruments/gear-ratio-drums.webp", description: "Emits a bounded burst of subdivisions for every incoming pulse.", build: "clock-multiplier", defaultPresetId: "multiply-2" },
  { id: "swing-clock", label: "Swing Clock", category: "trigger", color: "#ffb66f", imageHref: "assets/instruments/pendulum-wave.webp", description: "Offsets alternate shared-clock pulses without starting another timer.", build: "swing-clock", defaultPresetId: "light-swing" },
  { id: "phase-clock", label: "Clock Phase", category: "trigger", color: "#f7c97b", imageHref: "assets/instruments/rolling-measure.webp", description: "Moves a clock branch by a deterministic beat offset.", build: "phase-clock" },
  { id: "sync-bridge", label: "Clock / MIDI Sync", category: "trigger", color: "#ffd166", imageHref: "assets/instruments/recursive-pm.webp", description: "Bridges trigger pulses and timestamped MIDI sync events.", build: "sync-bridge" },
  { id: "midi-input", label: "MIDI Input", category: "midi", color: "#7cf29a", imageHref: "assets/instruments/recursive-pm.webp", description: "Explicit ingress for hardware, computer-keyboard, and external MIDI events.", build: "midi-input" },
  { id: "midi-clock", label: "MIDI Clock", category: "midi", color: "#ff72b6", imageHref: "assets/instruments/rolling-measure.webp", description: "A true 24-PPQN timestamped MIDI clock source.", build: "midi-clock", defaultPresetId: "midi-clock-24" },
  { id: "midi-router", label: "MIDI Router", category: "midi", color: "#ff72b6", imageHref: "assets/instruments/recursive-pm.webp", description: "Merges, fans out, and safely delays MIDI event flow.", build: "midi-router" },
  { id: "midi-output", label: "MIDI Output", category: "midi", color: "#ff9ccd", imageHref: "assets/instruments/recursive-pm.webp", description: "A graph destination for timestamped MIDI messages.", build: "midi-output" },
  { id: "graph-drums", label: "Graph Drums", category: "sound", color: "#ff8f70", imageHref: "assets/instruments/graph-drums.webp", href: "graph-drums.html", description: "A nested percussion signal graph.", build: "drums" },
  { id: "graph-synth", label: "Graph Synth", category: "sound", color: "#b299ff", imageHref: "assets/instruments/graph-synth.webp", href: "graph-synth.html", description: "Oscillator, envelope, filter, and output as one enterable graph.", build: "synth" },
  { id: "lattice", label: "Lattice Voice", category: "sound", color: "#69d9dc", imageHref: "assets/instruments/lattice.webp", href: "lattice.html", description: "A bright metallic sound graph.", build: "lattice" },
  { id: "spiral", label: "Spiral Voice", category: "sound", color: "#e8c46b", imageHref: "assets/instruments/spiral.webp", href: "spiral.html", description: "A rotating harmonic sound graph.", build: "spiral" },
  { id: "sample-voice", label: "Voice Fragment", category: "sound", color: "#ff82c8", imageHref: "assets/instruments/vocalzoid.webp", href: "vocalzoid.html", description: "A vocal-colored source graph.", build: "voice" },
  { id: "hiccup-head", label: "Hiccup Head", category: "sound", color: "#ff82c8", imageHref: "assets/instruments/hiccup-head.webp", href: "hiccup-head.html", description: "A clockable physical-mouth graph with selectable authored face presets.", build: "hiccup-head", defaultPresetId: "rubber-face" },
  { id: "webgpu-303", label: "WebGPU 303", category: "sound", color: "#c49aff", imageHref: "assets/instruments/webgpu-303.webp", href: "webgpu-303.html", description: "A transport-aware GPU acid graph with selectable authored patches.", build: "webgpu-303", defaultPresetId: "source-acid-synth" },
  { id: "graph-delay", label: "Graph Delay", category: "effect", color: "#70d8e7", imageHref: "assets/instruments/graph-delay.webp", href: "graph-delay.html", description: "Audio delay plus optional delayed trigger and MIDI thru.", build: "delay", defaultPresetId: "short-echo" },
  { id: "filter", label: "Filter Graph", category: "effect", color: "#a7e879", imageHref: "assets/instruments/enveloper.webp", description: "A modulatable audio filter graph with MIDI thru.", build: "filter", defaultPresetId: "warm" },
  { id: "reverb", label: "Reverb Graph", category: "effect", color: "#8fd59b", imageHref: "assets/instruments/shepard-risset.webp", description: "A diffuse audio-space graph with MIDI thru.", build: "reverb", defaultPresetId: "hall" },
  { id: "compressor", label: "Compressor", category: "effect", color: "#ffad69", imageHref: "assets/instruments/fm-drums.webp", description: "A dynamics signal graph with MIDI thru.", build: "compressor", defaultPresetId: "punch" },
  { id: "lfo", label: "LFO Graph", category: "control", color: "#b299ff", imageHref: "assets/instruments/moire-organ.webp", description: "A repeating control-flow graph.", build: "lfo" },
  { id: "mixer", label: "Mixer Graph", category: "routing", color: "#8de7ff", imageHref: "assets/instruments/blowhole.webp", description: "A nested audio summing graph.", build: "mixer" },
  { id: "output", label: "Output Graph", category: "routing", color: "#c7fcfb", imageHref: "assets/instruments/enveloper.webp", description: "The final signal-flow destination.", build: "output" },
  { id: "surround-output", label: "Surround Output", category: "routing", color: "#61f0dd", imageHref: "assets/instruments/surround-field.webp", href: "surround-field.html", description: "Stereo, binaural, quad, 4.1, 5.1, 7.1, ring, cube, or 7.1.4 output.", build: "surround-output", defaultPresetId: "stereo" },
  { id: "stereo-recorder", label: "Stereo Mix Recorder", category: "routing", color: "#ff6f91", imageHref: "assets/instruments/enveloper.webp", description: "An inline, monitor-through stereo mix capture point.", build: "recorder", defaultPresetId: "stereo-mix" },
  { id: "stem-recorder", label: "Stereo Stem Recorder", category: "routing", color: "#ff88a6", imageHref: "assets/instruments/enveloper.webp", description: "An inline capture point for one named stereo instrument or effect stem.", build: "recorder", defaultPresetId: "stereo-stem" },
  { id: "scope", label: "Oscilloscope", category: "monitor", color: "#74efff", imageHref: "assets/instruments/moire-organ.webp", description: "Waveform monitor with transparent audio thru.", build: "scope" },
  { id: "level-meter", label: "Level Meter", category: "monitor", color: "#b7f56a", imageHref: "assets/instruments/enveloper.webp", description: "RMS and peak monitor with amplitude control output.", build: "level-meter" },
  { id: "spectrum", label: "Spectrum / FFT", category: "monitor", color: "#6fd8ff", imageHref: "assets/instruments/fourier-epicycles.webp", description: "FFT spectrum monitor with selectable band resolution.", build: "spectrum", defaultPresetId: "octave" },
  { id: "frequency-tracker", label: "Frequency Tracker", category: "monitor", color: "#9ce5ff", imageHref: "assets/instruments/fourier-epicycles.webp", description: "Tracks fundamental frequency and emits it as control.", build: "frequency-tracker" },
  { id: "control-display", label: "Numeric Control Display", category: "monitor", color: "#d2bbff", imageHref: "assets/instruments/enveloper.webp", description: "Displays and passes a timestamped control value.", build: "control-display" },
  { id: "frequency-to-midi", label: "Frequency → MIDI", category: "converter", color: "#ff8fc4", imageHref: "assets/instruments/recursive-pm.webp", description: "Deterministically quantizes frequency control events to MIDI notes.", build: "frequency-to-midi" },
  { id: "midi-to-frequency", label: "MIDI → Frequency", category: "converter", color: "#be9cff", imageHref: "assets/instruments/recursive-pm.webp", description: "Maps MIDI notes to normalized control plus exact Hz metadata.", build: "midi-to-frequency" },
  { id: "midi-to-control", label: "MIDI → Control", category: "converter", color: "#c9a8ff", imageHref: "assets/instruments/recursive-pm.webp", description: "Maps MIDI values to bounded 0–1 control events.", build: "midi-to-control" },
  { id: "amplitude-to-midi", label: "Amplitude → MIDI", category: "converter", color: "#ff9aaf", imageHref: "assets/instruments/enveloper.webp", description: "Runtime RMS gate to MIDI notes with transparent audio thru.", build: "amplitude-to-midi" },
  { id: "audio-to-fft-bands", label: "Audio → FFT Bands", category: "converter", color: "#7edfff", imageHref: "assets/instruments/fourier-epicycles.webp", description: "Transparent audio analysis with low, mid, high, and air control outputs.", build: "audio-to-fft-bands" },
  { id: "blank-graph", label: "Empty Subgraph", category: "graphs", color: "#d5bcff", imageHref: "assets/instruments/recursive-fm.webp", description: "A graph boundary ready to contain other graphs or primitives.", build: "blank" },
].map((device) => ({ ...device })));

export const INSTRUMENT_LIBRARY = DEVICE_LIBRARY;

const DEVICE_BY_ID = new Map(DEVICE_LIBRARY.map((device) => [device.id, device]));

function buildDeviceGraph(device, graphId, label, options = {}) {
  const generator = options.generator;
  const shared = { id: graphId, label, presetId: options.presetId, params: options.params };
  switch (device.build) {
    case "clock": return clockGraphTemplate({ ...shared, primitiveId: "clock", generator });
    case "euclid": return clockGraphTemplate({ ...shared, primitiveId: "euclid", generator });
    case "clock-divider": return clockProcessorGraphTemplate({ ...shared, primitiveId: "divider" });
    case "clock-multiplier": return clockProcessorGraphTemplate({ ...shared, primitiveId: "clock-multiplier" });
    case "swing-clock": return clockProcessorGraphTemplate({ ...shared, primitiveId: "swing-clock" });
    case "phase-clock": return clockProcessorGraphTemplate({ ...shared, primitiveId: "phase-clock", params: { offsetBeats: .25, ...options.params } });
    case "sync-bridge": return primitiveGraphTemplate({ ...shared, primitiveId: "sync-bridge", kind: "trigger" });
    case "midi-input": return midiGraphTemplate({ ...shared, primitiveId: "midi-input", source: true });
    case "midi-clock": return midiGraphTemplate({ ...shared, primitiveId: "midi-clock", source: true });
    case "midi-router": return midiGraphTemplate({ ...shared, primitiveId: "midi-router" });
    case "midi-output": return midiGraphTemplate({ ...shared, primitiveId: "midi-output", output: true });
    case "drums": return soundGraphTemplate({ ...shared, primitiveId: "drum-voice", soundId: options.soundId ?? "drums", rootNote: options.rootNote ?? 48, tone: "gain" });
    case "lattice": return soundGraphTemplate({ ...shared, soundId: options.soundId ?? "lattice bell", rootNote: options.rootNote ?? 60 });
    case "spiral": return soundGraphTemplate({ ...shared, soundId: options.soundId ?? "spiral shepard", rootNote: options.rootNote ?? 64 });
    case "voice": return soundGraphTemplate({ ...shared, primitiveId: "voice", soundId: options.soundId ?? "voice", rootNote: options.rootNote ?? 67 });
    case "hiccup-head": return soundGraphTemplate({ ...shared, primitiveId: "hiccup-head", soundId: options.soundId ?? "hiccup", rootNote: options.rootNote ?? 48, tone: "gain" });
    case "webgpu-303": return soundGraphTemplate({ ...shared, primitiveId: "webgpu-303", soundId: options.soundId ?? "webgpu-303", rootNote: options.rootNote ?? 36, tone: "gain" });
    case "delay": return effectGraphTemplate({ ...shared, primitiveId: "delay", triggerDelayBeats: options.triggerDelayBeats ?? .5 });
    case "filter": return effectGraphTemplate({ ...shared, primitiveId: "filter" });
    case "reverb": return effectGraphTemplate({ ...shared, primitiveId: "reverb" });
    case "compressor": return effectGraphTemplate({ ...shared, primitiveId: "compressor" });
    case "lfo": return controlGraphTemplate({ ...shared, primitiveId: "lfo", generator });
    case "mixer": return routingGraphTemplate({ ...shared, primitiveId: "mixer" });
    case "output": return routingGraphTemplate({ ...shared, primitiveId: "output", output: true });
    case "surround-output": return routingGraphTemplate({ ...shared, primitiveId: "surround-output", output: true });
    case "recorder": return primitiveGraphTemplate({ ...shared, primitiveId: "recorder", kind: "recorder" });
    case "scope":
    case "level-meter":
    case "spectrum":
    case "frequency-tracker":
    case "control-display":
      return primitiveGraphTemplate({ ...shared, primitiveId: device.build, kind: "monitor" });
    case "frequency-to-midi":
    case "midi-to-frequency":
    case "midi-to-control":
    case "amplitude-to-midi":
    case "audio-to-fft-bands":
      return primitiveGraphTemplate({ ...shared, primitiveId: device.build, kind: "converter" });
    case "blank": return blankGraphTemplate({ id: graphId, label });
    case "synth":
    default: return soundGraphTemplate({ ...shared, soundId: options.soundId ?? "graph synth", rootNote: options.rootNote ?? 48 });
  }
}

function uniqueId(existing, base) {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function getGraph(patch, graphId = patch?.selectedGraphId ?? patch?.rootGraphId) {
  return Array.isArray(patch?.graphs)
    ? patch.graphs.find((graph) => graph?.id === graphId) ?? null
    : null;
}

export function currentGraph(patch) {
  return getGraph(patch, patch?.selectedGraphId) ?? getGraph(patch, patch?.rootGraphId);
}

export function portsForNode(patch, graph, node) {
  if (!node) return [];
  if (node.type === "subgraph") {
    const graphInterface = getGraph(patch, node.graphId)?.interface;
    return Array.isArray(graphInterface) ? graphInterface : [];
  }
  if (node.type === "primitive") return PRIMITIVE_LIBRARY[node.primitiveId]?.ports ?? [];
  if (node.type === "port") {
    return node.direction === "in"
      ? [port(`${node.signal}-out`, "out", node.signal, node.label)]
      : [port(`${node.signal}-in`, "in", node.signal, node.label)];
  }
  return [];
}

export function graphBreadcrumbs(patch, graphId = patch?.selectedGraphId) {
  const target = getGraph(patch, graphId) ?? getGraph(patch, patch?.rootGraphId);
  if (!target) return [];
  const byId = new Map((patch.graphs ?? []).map((graph) => [graph.id, graph]));
  const parent = new Map();
  for (const graph of patch.graphs ?? []) {
    for (const node of graph.nodes ?? []) {
      if (node.type === "subgraph" && byId.has(node.graphId)) parent.set(node.graphId, { graphId: graph.id, node });
    }
  }
  const result = [];
  let graph = target;
  const seen = new Set();
  while (graph && !seen.has(graph.id)) {
    seen.add(graph.id);
    const relation = parent.get(graph.id);
    result.unshift({ graphId: graph.id, label: relation?.node?.label ?? graph.label, instanceNodeId: relation?.node?.id ?? null });
    graph = relation ? byId.get(relation.graphId) : null;
  }
  return result;
}

export function selectGraph(patch, graphId) {
  const next = clone(patch);
  if (getGraph(next, graphId)) next.selectedGraphId = graphId;
  return next;
}

function addDeviceNodeMutable(patch, graphId, deviceId, options = {}) {
  const graph = getGraph(patch, graphId);
  const device = DEVICE_BY_ID.get(deviceId) ?? DEVICE_BY_ID.get("graph-synth");
  if (!graph || !device) return null;
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  const graphIds = new Set(patch.graphs.map(({ id }) => id));
  const nodeId = uniqueId(nodeIds, options.id ?? device.id);
  const childGraphId = uniqueId(graphIds, options.graphId ?? `${graph.id}-${nodeId}`);
  const label = options.label ?? device.label;
  const selectedPreset = devicePreset(device.id, options.presetId ?? device.defaultPresetId);
  const buildOptions = {
    ...options,
    presetId: selectedPreset?.id ?? null,
    generator: options.generator ?? selectedPreset?.params?.generator,
    params: { ...(selectedPreset?.params ?? {}), ...(options.params ?? {}) },
  };
  const childGraph = buildDeviceGraph(device, childGraphId, label, buildOptions);
  childGraph.deviceId = device.id;
  childGraph.presetId = buildOptions.presetId;
  const node = {
    id: nodeId,
    type: "subgraph",
    graphId: childGraphId,
    deviceId: device.id,
    presetId: buildOptions.presetId,
    label,
    x: clamp(options.x, 0, 1, .18 + (graph.nodes.length % 4) * .2),
    y: clamp(options.y, 0, 1, .2 + (Math.floor(graph.nodes.length / 4) % 3) * .3),
    params: clone(buildOptions.params),
  };
  patch.graphs.push(childGraph);
  graph.nodes.push(node);
  return node;
}

export function addDeviceNode(patch, graphId, deviceId, options = {}) {
  const next = clone(patch);
  addDeviceNodeMutable(next, graphId, deviceId, options);
  return next;
}

/** Apply one authored device preset without mutating the source patch. */
export function applyDevicePreset(patch, graphId, nodeId, presetId) {
  const next = clone(patch);
  const graph = getGraph(next, graphId);
  const node = graph?.nodes?.find(({ id }) => id === nodeId);
  if (!node) return next;
  const deviceId = node.deviceId ?? node.primitiveId;
  const selectedPreset = devicePreset(deviceId, presetId);
  if (!selectedPreset) return next;
  node.presetId = selectedPreset.id;
  node.params = { ...(node.params ?? {}), ...clone(selectedPreset.params) };
  if (selectedPreset.params?.generator) node.generator = clone(selectedPreset.params.generator);
  if (node.type !== "subgraph") return next;

  const child = getGraph(next, node.graphId);
  if (!child) return next;
  child.presetId = selectedPreset.id;
  const core = child.nodes?.find((candidate) => candidate?.type === "primitive" && candidate.deviceCore)
    ?? child.nodes?.find((candidate) => candidate?.type === "primitive");
  if (!core) return next;
  core.presetId = selectedPreset.id;
  core.params = { ...(core.params ?? {}), ...clone(selectedPreset.params) };
  if (selectedPreset.params?.generator) core.generator = clone(selectedPreset.params.generator);
  return next;
}

function endpointPort(patch, graph, nodeId, signal, direction, requestedPortId) {
  const node = (Array.isArray(graph?.nodes) ? graph.nodes : []).find(({ id }) => id === nodeId);
  if (!node) return null;
  const ports = portsForNode(patch, graph, node);
  if (requestedPortId !== undefined) {
    return ports.find((item) => (
      item
      && item.id === requestedPortId
      && item.direction === direction
      && item.signal === signal
    )) ?? null;
  }
  return ports.find((item) => item && item.direction === direction && item.signal === signal) ?? null;
}

function addConnectionMutable(patch, graphId, fromNodeId, toNodeId, signal, options = {}) {
  const graph = getGraph(patch, graphId);
  if (!graph || !SIGNAL_TYPES.includes(signal)) return null;
  const fromPort = endpointPort(patch, graph, fromNodeId, signal, "out", options.fromPortId);
  const toPort = endpointPort(patch, graph, toNodeId, signal, "in", options.toPortId);
  if (!fromPort || !toPort) return null;
  const ids = new Set(graph.edges.map(({ id }) => id));
  const id = uniqueId(ids, options.id ?? `${fromNodeId}-${signal}-${toNodeId}`);
  const edge = {
    id,
    from: { nodeId: fromNodeId, portId: fromPort.id },
    to: { nodeId: toNodeId, portId: toPort.id },
    signal,
    timing: {
      delayBeats: quantizeBeat(options.delayBeats ?? 0, 1 / 64),
      probability: clamp(options.probability, 0, 1, 1),
    },
    gain: clamp(options.gain, 0, 2, 1),
    feedback: signal === "audio" && Boolean(options.feedback),
  };
  if (fromNodeId === toNodeId && signal !== "audio" && edge.timing.delayBeats <= 0) {
    edge.timing.delayBeats = .25;
  }
  graph.edges.push(edge);
  if (signal === "audio" && !edge.feedback && unsafeAudioCycle(patch)) edge.feedback = true;
  return edge;
}

export function addConnection(patch, graphId, fromNodeId, toNodeId, signal, options = {}) {
  const next = clone(patch);
  addConnectionMutable(next, graphId, fromNodeId, toNodeId, signal, options);
  return next;
}

export function removeConnection(patch, graphId, edgeId) {
  const next = clone(patch);
  const graph = getGraph(next, graphId);
  if (graph) graph.edges = graph.edges.filter(({ id }) => id !== edgeId);
  return next;
}

export function updateConnection(patch, graphId, edgeId, patchValue = {}) {
  const next = clone(patch);
  const edge = getGraph(next, graphId)?.edges?.find(({ id }) => id === edgeId);
  if (!edge) return next;
  if (patchValue.delayBeats !== undefined) edge.timing.delayBeats = quantizeBeat(patchValue.delayBeats, 1 / 64);
  if (patchValue.probability !== undefined) edge.timing.probability = clamp(patchValue.probability, 0, 1, edge.timing.probability);
  if (patchValue.gain !== undefined) edge.gain = clamp(patchValue.gain, 0, 2, edge.gain);
  if (patchValue.feedback !== undefined) edge.feedback = Boolean(patchValue.feedback);
  return next;
}

export function updateGraphNode(patch, graphId, nodeId, patchValue = {}) {
  const next = clone(patch);
  const node = getGraph(next, graphId)?.nodes?.find(({ id }) => id === nodeId);
  if (!node) return next;
  if (patchValue.label !== undefined) node.label = String(patchValue.label || node.label);
  if (patchValue.rootNote !== undefined) node.rootNote = clamp(patchValue.rootNote, 0, 127, node.rootNote);
  if (patchValue.gateBeats !== undefined) node.gateBeats = Math.max(1 / 64, quantizeBeat(patchValue.gateBeats, 1 / 64));
  if (patchValue.soundId !== undefined) node.soundId = String(patchValue.soundId || node.soundId);
  if (patchValue.presetId !== undefined) node.presetId = String(patchValue.presetId || "") || null;
  if (patchValue.generator) node.generator = { ...(node.generator ?? {}), ...clone(patchValue.generator) };
  if (patchValue.params) node.params = { ...(node.params ?? {}), ...clone(patchValue.params) };
  return next;
}

export function moveGraphNode(patch, graphId, nodeId, x, y) {
  const next = clone(patch);
  const node = getGraph(next, graphId)?.nodes?.find(({ id }) => id === nodeId);
  if (node) {
    node.x = clamp(x, 0, 1, node.x);
    node.y = clamp(y, 0, 1, node.y);
  }
  return next;
}

function nodeAddress(prefix, nodeId) {
  return `${prefix}/${nodeId}`;
}

function portNodePorts(node) {
  return node.direction === "in"
    ? [port(`${node.signal}-out`, "out", node.signal)]
    : [port(`${node.signal}-in`, "in", node.signal)];
}

function flatNodePorts(patch, graph, node) {
  return node.type === "port" ? portNodePorts(node) : portsForNode(patch, graph, node);
}

/** Flatten graph instances while retaining the instance stack needed by every view. */
export function flattenPatch(patch, rootGraphId = patch?.rootGraphId) {
  const root = getGraph(patch, rootGraphId);
  if (!root) return {
    nodes: [], edges: [], nodeByAddress: new Map(), rootGraphId, truncated: false,
  };
  const nodes = [];
  const edges = [];
  const nodeByAddress = new Map();
  const graphStack = new Set();
  let instanceCount = 0;
  let truncated = false;

  const visit = (graph, prefix, instances) => {
    if (!graph || graphStack.has(graph.id)) return;
    if (instanceCount >= MAX_FLATTENED_INSTANCES) {
      truncated = true;
      return;
    }
    instanceCount += 1;
    graphStack.add(graph.id);
    const local = new Map();
    const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph.edges) ? graph.edges : [];
    for (const node of graphNodes.slice(0, MAX_NODES_PER_GRAPH)) {
      if (nodes.length >= MAX_FLATTENED_NODES) {
        truncated = true;
        break;
      }
      if (!node || typeof node !== "object" || !node.id) continue;
      if (node.type === "subgraph") {
        const child = getGraph(patch, node.graphId);
        if (!child) continue;
        const childPrefix = nodeAddress(prefix, node.id);
        const nextInstances = [...instances, {
          parentGraphId: graph.id,
          nodeId: node.id,
          graphId: child.id,
          label: node.label,
          deviceId: node.deviceId,
          presetId: node.presetId ?? child.presetId ?? null,
        }];
        visit(child, childPrefix, nextInstances);
        const childInterface = Array.isArray(child.interface) ? child.interface : [];
        const interfaceById = new Map(childInterface
          .filter((item) => item && typeof item === "object" && item.id)
          .map((item) => [item.id, item]));
        local.set(node.id, {
          node,
          ports: portsForNode(patch, graph, node),
          addressForPort: (portId) => {
            const interfacePort = interfaceById.get(portId);
            return interfacePort ? nodeAddress(childPrefix, interfacePort.nodeId) : null;
          },
        });
        continue;
      }
      const address = nodeAddress(prefix, node.id);
      const primitive = node.type === "primitive" ? PRIMITIVE_LIBRARY[node.primitiveId] : null;
      const flat = {
        address,
        graphId: graph.id,
        graphPath: prefix,
        node,
        primitive,
        instances,
      };
      nodes.push(flat);
      nodeByAddress.set(address, flat);
      local.set(node.id, {
        node,
        ports: flatNodePorts(patch, graph, node),
        addressForPort: () => address,
      });
    }
    for (const edge of graphEdges.slice(0, MAX_EDGES_PER_GRAPH)) {
      if (edges.length >= MAX_FLATTENED_EDGES) {
        truncated = true;
        break;
      }
      if (!edge || typeof edge !== "object" || !SIGNAL_TYPES.includes(edge.signal)) continue;
      const from = local.get(edge.from?.nodeId);
      const to = local.get(edge.to?.nodeId);
      const fromPort = from?.ports?.find((item) => (
        item
        && item.id === edge.from?.portId
        && item.direction === "out"
        && item.signal === edge.signal
      ));
      const toPort = to?.ports?.find((item) => (
        item
        && item.id === edge.to?.portId
        && item.direction === "in"
        && item.signal === edge.signal
      ));
      if (!fromPort || !toPort) continue;
      const sourceAddress = from?.addressForPort(edge.from?.portId);
      const targetAddress = to?.addressForPort(edge.to?.portId);
      if (
        !sourceAddress
        || !targetAddress
        || !nodeByAddress.has(sourceAddress)
        || !nodeByAddress.has(targetAddress)
      ) continue;
      edges.push({
        ...clone(edge),
        graphId: graph.id,
        sourceAddress,
        targetAddress,
      });
    }
    graphStack.delete(graph.id);
  };

  visit(root, root.id, []);
  return { nodes, edges, nodeByAddress, rootGraphId, truncated };
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicUnit(value) {
  return hashString(value) / 0xffffffff;
}

function compareQueued(first, second) {
  return first.beat - second.beat
    || first.sequence - second.sequence
    || String(first.address).localeCompare(String(second.address));
}

function pushQueue(queue, event) {
  queue.push(event);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compareQueued(queue[parent], event) <= 0) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = event;
}

function popQueue(queue) {
  if (!queue.length) return null;
  const first = queue[0];
  const last = queue.pop();
  if (!queue.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= queue.length) break;
    const right = index * 2 + 2;
    const child = right < queue.length && compareQueued(queue[right], queue[left]) < 0 ? right : left;
    if (compareQueued(last, queue[child]) <= 0) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

function generatorEvents(
  flat,
  durationBeats,
  sequenceStart = 0,
  maximum = MAX_PROJECTED_EVENTS,
  maximumScans = MAX_PROJECTION_ADMISSIONS,
) {
  const generator = flat.node.generator ?? flat.primitive?.generator;
  if (!generator) return { events: [], scans: 0, truncated: false };
  const steps = Array.isArray(generator.steps) && generator.steps.length ? generator.steps : [1];
  const stepBeats = Math.max(1 / 64, finite(generator.stepBeats, 1));
  const phaseBeats = finite(generator.phaseBeats, 0);
  const noteOffsets = Array.isArray(generator.noteOffsets) && generator.noteOffsets.length ? generator.noteOffsets : [0];
  const generatedSignal = EVENT_SIGNAL_TYPES.includes(generator.signal) ? generator.signal : "trigger";
  const events = [];
  const firstStep = Math.max(0, Math.floor((-phaseBeats) / stepBeats));
  if (!Number.isSafeInteger(firstStep)) return { events, scans: 0, truncated: true };
  const maximumSteps = Math.ceil((durationBeats - phaseBeats) / stepBeats) + steps.length;
  const eventLimit = Math.max(0, Math.floor(finite(maximum, 0)));
  const scanLimit = Math.max(0, Math.floor(finite(maximumScans, 0)));
  let scans = 0;
  let step = firstStep;
  for (; step < maximumSteps && scans < scanLimit && events.length < eventLimit; step += 1) {
    scans += 1;
    const beat = phaseBeats + step * stepBeats;
    if (beat < -EPSILON || beat >= durationBeats - EPSILON) continue;
    const patternIndex = ((step % steps.length) + steps.length) % steps.length;
    const value = finite(steps[patternIndex], 0);
    if (value <= 0) continue;
    events.push({
      address: flat.address,
      beat,
      signal: generatedSignal,
      value: clamp(value, 0, 1, 1),
      noteOffset: finite(noteOffsets[patternIndex % noteOffsets.length], 0),
      midi: generatedSignal === "midi"
        ? clone(generator.midi ?? { type: "clock" })
        : null,
      depth: 0,
      sequence: sequenceStart + events.length,
      routeKey: `${flat.address}:generator:${step}`,
      originAddress: flat.address,
      occurrence: step,
      edgePath: [],
      rule: { kind: "generator", graphId: flat.graphId, nodeId: flat.node.id, occurrence: step },
    });
  }
  return { events, scans, truncated: step < maximumSteps };
}

export function midiMessageType(event) {
  return String(
    event?.midi?.type
      ?? event?.message?.type
      ?? event?.midiType
      ?? event?.type
      ?? "",
  ).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function midiMessageVelocity(event) {
  const value = event?.midi?.velocity ?? event?.message?.velocity ?? event?.velocity ?? event?.value;
  if (value === null || value === undefined || value === "") return 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return clamp(number > 1 ? number / 127 : number, 0, 1, 1);
}

export function midiMessageHasNote(event) {
  const type = midiMessageType(event);
  if (!["note", "noteon", "noteoff"].includes(type)) return false;
  const note = event?.midi?.note ?? event?.message?.note ?? event?.note;
  return note !== null && note !== undefined && note !== "" && Number.isFinite(Number(note));
}

export function midiMessageHasControlValue(event) {
  const type = midiMessageType(event);
  if (["note", "noteon", "noteoff"].includes(type)) return midiMessageHasNote(event);
  if (type === "controlchange") {
    return Number.isFinite(Number(event?.midi?.value ?? event?.message?.value ?? event?.value));
  }
  if (type === "pitchbend") {
    return Number.isFinite(Number(
      event?.midi?.normalized
        ?? event?.message?.normalized
        ?? event?.normalized
        ?? event?.midi?.value
        ?? event?.value,
    ));
  }
  if (["polypressure", "channelpressure"].includes(type)) {
    return Number.isFinite(Number(
      event?.midi?.pressure
        ?? event?.message?.pressure
        ?? event?.pressure
        ?? event?.midi?.value
        ?? event?.value,
    ));
  }
  return false;
}

export function isMidiClockEvent(event) {
  return ["clock", "timingclock"].includes(midiMessageType(event));
}

export function isMidiNoteRelease(event) {
  const type = midiMessageType(event);
  if (type === "noteoff") return true;
  return ["note", "noteon"].includes(type)
    && (event?.gate === false || midiMessageVelocity(event) <= 0);
}

export function isMidiNoteAttack(event) {
  const type = midiMessageType(event);
  return ["note", "noteon"].includes(type)
    && midiMessageHasNote(event)
    && !isMidiNoteRelease(event)
    && midiMessageVelocity(event) > 0;
}

function eventMidiNote(flat, event) {
  const fallback = clamp(flat.node.rootNote, 0, 127, 48) + finite(event.noteOffset, 0);
  const candidate = event?.note ?? event?.midi?.note;
  const note = candidate !== null && candidate !== undefined && candidate !== ""
    && Number.isFinite(Number(candidate))
    ? Number(candidate)
    : fallback;
  return Math.round(clamp(note, 0, 127, fallback));
}

function convertedEvent(flat, event, targetSignal, suffix = targetSignal) {
  const runtime = flat.primitive?.runtime ?? {};
  const params = flat.node.params ?? {};
  const routeKey = `${event.routeKey}|${flat.address}:${suffix}`;
  if (targetSignal === "midi") {
    const minimumHz = Math.max(1, finite(params.minimumHz, 20));
    const maximumHz = Math.max(minimumHz + 1, finite(params.maximumHz, 20_000));
    const frequencyHz = runtime.conversion === "frequency-to-midi"
      ? normalizedToFrequency(event.value, { minHz: minimumHz, maxHz: maximumHz })
      : finite(event.frequencyHz, midiNoteToFrequency(eventMidiNote(flat, event)));
    const note = runtime.conversion === "frequency-to-midi"
      ? frequencyToMidiPitch(frequencyHz)?.note ?? 69
      : eventMidiNote(flat, event);
    const messageType = runtime.conversion === "clock-midi-sync" && event.signal === "trigger"
      ? "clock"
      : event.signal === "midi"
        ? event.midi?.type ?? event.type ?? "note"
        : "note";
    return {
      ...event,
      signal: "midi",
      routeKey,
      note,
      frequencyHz,
      midi: {
        ...(event.midi ?? {}),
        type: messageType,
        channel: Math.round(clamp(params.channel, 0, 15, event.midi?.channel ?? 0)),
        ...(messageType === "note" ? { note, velocity: clamp(event.value, 0, 1, 1) } : {}),
      },
    };
  }
  if (targetSignal === "control" && event.signal === "midi") {
    if (runtime.conversion === "midi-to-frequency" && !midiMessageHasNote(event)) return null;
    if (runtime.conversion === "midi-to-control" && !midiMessageHasControlValue(event)) return null;
    const note = eventMidiNote(flat, event);
    const frequencyHz = midiNoteToFrequency(note);
    const minimumHz = Math.max(1, finite(params.minimumHz, 20));
    const maximumHz = Math.max(minimumHz + 1, finite(params.maximumHz, 20_000));
    const frequencyValue = frequencyToNormalized(frequencyHz, {
      minHz: minimumHz,
      maxHz: maximumHz,
    });
    return {
      ...event,
      signal: "control",
      routeKey,
      note,
      frequencyHz,
      value: runtime.conversion === "midi-to-frequency"
        ? frequencyValue
        : clamp(event.midi?.value ?? event.midi?.velocity ?? event.value, 0, 1, note / 127),
    };
  }
  if (targetSignal === "trigger" && event.signal === "midi") {
    return {
      ...event,
      signal: "trigger",
      routeKey,
      sourceMidi: event.midi ? clone(event.midi) : null,
      midi: null,
      note: null,
      frequencyHz: null,
    };
  }
  return { ...event, signal: targetSignal, routeKey };
}

export function clockEventBranches(event, {
  eventTransform = null,
  params = {},
  occurrence = event?.occurrence,
} = {}) {
  if (event?.signal !== "trigger") return [{ event, delayBeats: 0, branchIndex: 0 }];
  const pulse = Math.abs(Math.trunc(finite(occurrence, 0)));
  if (eventTransform === "clock-divider") {
    const division = Math.round(clamp(params.division, 1, 64, 2));
    return pulse % division === 0 ? [{ event, delayBeats: 0, branchIndex: 0 }] : [];
  }
  if (eventTransform === "clock-multiplier") {
    const multiplier = Math.round(clamp(params.multiplier, 1, 16, 2));
    const spacingBeats = Math.max(1 / 64, finite(params.spacingBeats, .25));
    return Array.from({ length: multiplier }, (_, branchIndex) => ({
      event,
      delayBeats: branchIndex * spacingBeats,
      branchIndex,
    }));
  }
  if (eventTransform === "clock-swing") {
    const amount = clamp(params.amount, 0, .49, .12);
    const stepBeats = Math.max(1 / 64, finite(params.stepBeats, .25));
    return [{ event, delayBeats: pulse % 2 ? amount * stepBeats : 0, branchIndex: 0 }];
  }
  if (eventTransform === "clock-phase") {
    return [{ event, delayBeats: Math.max(0, finite(params.offsetBeats, .25)), branchIndex: 0 }];
  }
  return [{ event, delayBeats: 0, branchIndex: 0 }];
}

function clockTransformedEvents(flat, event) {
  const transform = flat.primitive?.runtime?.eventTransform;
  return clockEventBranches(event, {
    eventTransform: transform,
    params: flat.node.params ?? {},
    occurrence: event.occurrence,
  }).map((branch) => ({
    ...branch.event,
    beat: branch.event.beat + branch.delayBeats,
    sequence: branch.event.sequence + branch.branchIndex,
    routeKey: transform === "clock-multiplier"
      ? `${branch.event.routeKey}|${flat.address}:multiply-${branch.branchIndex}`
      : branch.event.routeKey,
  }));
}

function outputEventsForNode(flat, event) {
  const primitive = flat.primitive;
  return clockTransformedEvents(flat, event).flatMap((transformed) => {
    const emitted = primitive?.emits?.[transformed.signal];
    const converted = primitive?.converts?.[transformed.signal];
    const outputSignals = Array.isArray(emitted) && emitted.length
      ? emitted
      : [converted ?? transformed.signal];
    return outputSignals
      .filter((signal) => EVENT_SIGNAL_TYPES.includes(signal))
      .flatMap((signal, index) => {
        if (
          transformed.signal === "midi"
          && signal === "trigger"
          && primitive?.runtime?.conversion === "clock-midi-sync"
          && !isMidiClockEvent(transformed)
        ) return [];
        const converted = signal === transformed.signal && outputSignals.length === 1
          ? transformed
          : convertedEvent(flat, transformed, signal, `${signal}-${index}`);
        return converted ? [converted] : [];
      });
  });
}

/**
 * Simulate trigger/control/MIDI flow over a bounded beat horizon. Audio edges are
 * intentionally excluded: they describe the separately compiled signal graph.
 */
export function projectGraphEvents(patch, options = {}) {
  const requestedDurationBeats = Math.max(.25, finite(
    options.durationBeats ?? options.toBeat,
    patch?.cycleBeats ?? 16,
  ));
  const durationBeats = Math.min(MAX_PROJECTION_BEATS, requestedDurationBeats);
  const maximum = Math.max(1, Math.min(MAX_PROJECTED_EVENTS, Math.floor(finite(options.maximum, MAX_PROJECTED_EVENTS))));
  const maximumDepth = Math.max(1, Math.min(MAX_EVENT_DEPTH, Math.floor(finite(options.maximumDepth, MAX_EVENT_DEPTH))));
  const flattened = flattenPatch(patch, patch?.rootGraphId);
  const outgoing = new Map(flattened.nodes.map(({ address }) => [address, []]));
  for (const edge of flattened.edges) {
    if (edge.signal === "audio") continue;
    if (!outgoing.has(edge.sourceAddress)) outgoing.set(edge.sourceAddress, []);
    outgoing.get(edge.sourceAddress).push(edge);
  }
  const queue = [];
  const queueLimit = Math.min(MAX_PROJECTION_QUEUE, Math.max(256, maximum * 4));
  const admissionLimit = Math.min(MAX_PROJECTION_ADMISSIONS, Math.max(1_024, maximum * 16));
  const seedLimit = Math.min(maximum, queueLimit);
  let admitted = 0;
  let generationScans = 0;
  let truncated = flattened.truncated || requestedDurationBeats > durationBeats + EPSILON;
  const enqueue = (event) => {
    if (queue.length >= queueLimit || admitted >= admissionLimit) {
      truncated = true;
      return false;
    }
    pushQueue(queue, event);
    admitted += 1;
    return true;
  };
  let sequence = 0;
  for (const flat of flattened.nodes) {
    const remainingSeeds = seedLimit - queue.length;
    const remainingScans = MAX_PROJECTION_ADMISSIONS - generationScans;
    if (remainingSeeds <= 0 || remainingScans <= 0) {
      truncated = true;
      break;
    }
    const generated = generatorEvents(flat, durationBeats, sequence, remainingSeeds, remainingScans);
    generationScans += generated.scans;
    if (generated.truncated) truncated = true;
    for (const event of generated.events) enqueue(event);
    sequence += generated.events.length + 1;
  }
  const projected = [];
  const seen = new Set();
  while (queue.length && projected.length < maximum) {
    const event = popQueue(queue);
    if (!event || event.beat < -EPSILON || event.beat >= durationBeats - EPSILON || event.depth > maximumDepth) continue;
    const flat = flattened.nodeByAddress.get(event.address);
    if (!flat) continue;
    const visitKey = `${event.routeKey}@${event.address}:${event.signal}:${event.beat.toFixed(6)}:${event.noteOffset}`;
    if (seen.has(visitKey)) continue;
    seen.add(visitKey);
    const primitive = flat.primitive;
    const probability = flat.node.primitiveId === "chance" ? clamp(flat.node.params?.probability, 0, 1, .5) : 1;
    if (probability < 1 && deterministicUnit(`${patch.seed}:${event.routeKey}:node`) > probability) continue;
    const rootNote = clamp(flat.node.rootNote, 0, 127, 48);
    const projectedNote = event.signal === "midi" && !midiMessageHasNote(event)
      ? null
      : eventMidiNote(flat, event);
    const playableSignals = primitive?.playableSignals ?? ["trigger"];
    projected.push({
      id: `${event.routeKey}@${event.beat.toFixed(6)}`,
      address: flat.address,
      graphId: flat.graphId,
      graphPath: flat.graphPath,
      nodeId: flat.node.id,
      label: flat.node.label,
      primitiveId: flat.node.primitiveId ?? "port",
      category: primitive?.category ?? "interface",
      color: primitive?.color ?? "#82939a",
      signal: event.signal,
      beat: event.beat,
      value: event.value,
      note: projectedNote,
      velocity: event.value,
      durationBeats: Math.max(1 / 64, finite(flat.node.gateBeats, .25)),
      playable: Boolean(
        primitive?.playable
        && playableSignals.includes(event.signal)
        && (event.signal !== "midi" || isMidiNoteAttack(event)),
      ),
      instrumentType: primitive?.instrumentType ?? "control",
      instrumentId: flat.node.soundId ?? flat.node.primitiveId,
      soundId: flat.node.soundId ?? flat.node.primitiveId,
      presetId: flat.node.presetId ?? null,
      midi: event.midi ? clone(event.midi) : null,
      frequencyHz: Number.isFinite(event.frequencyHz) ? event.frequencyHz : null,
      runtime: primitive?.runtime ? clone(primitive.runtime) : null,
      instances: clone(flat.instances),
      originAddress: event.originAddress,
      sourceEdgeId: event.sourceEdgeId ?? null,
      sourceGraphId: event.sourceGraphId ?? null,
      occurrence: event.occurrence,
      edgePath: clone(event.edgePath ?? []),
      rule: clone(event.rule),
    });
    let branch = 0;
    for (const outputEvent of outputEventsForNode(flat, event)) {
      for (const edge of outgoing.get(event.address) ?? []) {
        if (queue.length >= queueLimit || admitted >= admissionLimit) {
          truncated = true;
          break;
        }
        if (edge.signal !== outputEvent.signal) continue;
        const edgeProbability = clamp(edge.timing?.probability, 0, 1, 1);
        if (edgeProbability < 1 && deterministicUnit(`${patch.seed}:${outputEvent.routeKey}:${edge.graphId}:${edge.id}`) > edgeProbability) continue;
        const nextBeat = outputEvent.beat + Math.max(0, finite(edge.timing?.delayBeats, 0));
        if (nextBeat >= durationBeats - EPSILON) continue;
        enqueue({
          ...outputEvent,
          address: edge.targetAddress,
          beat: nextBeat,
          value: clamp(outputEvent.value * finite(edge.gain, 1), 0, 1, outputEvent.value),
          depth: event.depth + 1,
          sequence: event.sequence + branch + 1,
          routeKey: `${outputEvent.routeKey}>${edge.graphId}:${edge.id}`,
          sourceEdgeId: edge.id,
          sourceGraphId: edge.graphId,
          edgePath: [
            ...(event.edgePath ?? []),
            {
              graphId: edge.graphId,
              edgeId: edge.id,
              signal: edge.signal,
              fromNodeId: edge.from?.nodeId ?? null,
              fromPortId: edge.from?.portId ?? null,
              toNodeId: edge.to?.nodeId ?? null,
              toPortId: edge.to?.portId ?? null,
            },
          ],
          rule: { kind: "edge", graphId: edge.graphId, edgeId: edge.id },
        });
        branch += 1;
      }
    }
  }
  projected.sort((first, second) => first.beat - second.beat || String(first.id).localeCompare(String(second.id)));
  return {
    events: projected,
    durationBeats,
    truncated: truncated || queue.length > 0 || projected.length >= maximum,
    flattened,
  };
}

export function projectTimeline(patch, graphId = patch?.selectedGraphId, options = {}) {
  const graph = getGraph(patch, graphId) ?? currentGraph(patch);
  if (!graph) return { graph: null, lanes: [], events: [], durationBeats: 0, truncated: false };
  const projection = projectGraphEvents(patch, { ...options, durationBeats: options.durationBeats ?? patch.cycleBeats });
  const directNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const laneById = new Map();
  const events = [];
  for (const displayNode of graph.nodes) {
    if (displayNode.type === "port") continue;
    const laneId = `${graph.id}:${displayNode.id}`;
    const child = displayNode.type === "subgraph" ? getGraph(patch, displayNode.graphId) : null;
    const primitive = displayNode.type === "primitive" ? PRIMITIVE_LIBRARY[displayNode.primitiveId] : null;
    const device = DEVICE_BY_ID.get(displayNode.deviceId);
    laneById.set(laneId, {
      id: laneId,
      graphId: graph.id,
      nodeId: displayNode.id,
      label: displayNode.label,
      category: child?.kind ?? primitive?.category ?? device?.category ?? "graph",
      color: device?.color ?? primitive?.color ?? "#8de7ff",
      deviceId: displayNode.deviceId ?? displayNode.primitiveId,
      subgraphId: displayNode.graphId ?? null,
    });
  }
  for (const event of projection.events) {
    if (event.category === "interface") continue;
    let displayNode = null;
    if (event.graphId === graph.id) displayNode = directNodeById.get(event.nodeId);
    if (!displayNode) {
      const instance = event.instances.find((item) => item.parentGraphId === graph.id);
      if (instance) displayNode = directNodeById.get(instance.nodeId);
    }
    if (!displayNode || displayNode.type === "port") continue;
    const laneId = `${graph.id}:${displayNode.id}`;
    events.push({ ...event, laneId, displayNodeId: displayNode.id, displayGraphId: graph.id });
  }
  const lanes = [...laneById.values()];
  const laneOrder = new Map(lanes.map((lane, index) => [lane.id, index]));
  events.sort((first, second) => first.beat - second.beat
    || (laneOrder.get(first.laneId) ?? 0) - (laneOrder.get(second.laneId) ?? 0)
    || String(first.id).localeCompare(String(second.id)));
  return {
    graph,
    lanes,
    events,
    durationBeats: projection.durationBeats,
    truncated: projection.truncated,
  };
}

export function moveProjectedEvent(patch, event, requestedBeat) {
  const nextBeat = quantizeBeat(requestedBeat, .25);
  const delta = nextBeat - finite(event?.beat, 0);
  if (!event || Math.abs(delta) < EPSILON) return clone(patch);
  const edgePath = Array.isArray(event.edgePath) ? event.edgePath : [];
  const displayedEdge = event.displayGraphId
    ? [...edgePath].reverse().find((item) => item?.graphId === event.displayGraphId)
    : null;
  const causalEdge = displayedEdge
    ? { kind: "edge", graphId: displayedEdge.graphId, edgeId: displayedEdge.edgeId }
    : event.rule?.kind === "edge"
      ? event.rule
      : null;
  if (causalEdge) {
    const edge = getGraph(patch, causalEdge.graphId)?.edges?.find(({ id }) => id === causalEdge.edgeId);
    return updateConnection(patch, causalEdge.graphId, causalEdge.edgeId, {
      delayBeats: Math.max(0, finite(edge?.timing?.delayBeats, 0) + delta),
    });
  }
  if (event.rule?.kind === "generator") {
    const node = getGraph(patch, event.rule.graphId)?.nodes?.find(({ id }) => id === event.rule.nodeId);
    return updateGraphNode(patch, event.rule.graphId, event.rule.nodeId, {
      generator: { phaseBeats: Math.max(0, finite(node?.generator?.phaseBeats, 0) + delta) },
    });
  }
  return clone(patch);
}

function edgeSetHasCycle(edges, sourceFor, targetFor) {
  const adjacency = new Map();
  const indegree = new Map();
  for (const edge of edges) {
    const source = sourceFor(edge);
    const target = targetFor(edge);
    if (source === undefined || source === null || target === undefined || target === null) continue;
    if (!adjacency.has(source)) adjacency.set(source, []);
    if (!adjacency.has(target)) adjacency.set(target, []);
    if (!indegree.has(source)) indegree.set(source, 0);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
    adjacency.get(source).push(target);
  }
  const ready = [...adjacency.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    visited += 1;
    for (const next of adjacency.get(id) ?? []) {
      const nextIndegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) ready.push(next);
    }
  }
  return visited < adjacency.size;
}

function zeroDelayEventCycle(graph) {
  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => (
    edge
    && edge.signal !== "audio"
    && SIGNAL_TYPES.includes(edge.signal)
    && finite(edge.timing?.delayBeats, 0) <= EPSILON
  ));
  return edgeSetHasCycle(edges, (edge) => edge.from?.nodeId, (edge) => edge.to?.nodeId);
}

function flattenedHasUnsafeAudioCycle(flattened) {
  const directAudioEdges = flattened.edges.filter((edge) => (
    edge.signal === "audio" && edge.feedback !== true
  ));
  return edgeSetHasCycle(
    directAudioEdges,
    (edge) => edge.sourceAddress,
    (edge) => edge.targetAddress,
  );
}

function unsafeAudioCycle(patch) {
  const flattened = flattenPatch(patch, patch?.rootGraphId);
  return flattened.truncated || flattenedHasUnsafeAudioCycle(flattened);
}

function recursiveGraphReference(patch) {
  const graphs = Array.isArray(patch?.graphs) ? patch.graphs : [];
  const adjacency = new Map(graphs
    .filter((graph) => graph && typeof graph.id === "string")
    .map(({ id }) => [id, []]));
  for (const graph of graphs) {
    if (!graph || !Array.isArray(graph.nodes)) continue;
    for (const node of graph.nodes) {
      if (node?.type === "subgraph") adjacency.get(graph.id)?.push(node.graphId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

export function validatePatch(patch) {
  const errors = [];
  if (!patch || typeof patch !== "object") return { valid: false, errors: ["Patch must be an object."] };
  const graphs = Array.isArray(patch.graphs) ? patch.graphs : [];
  if (!Array.isArray(patch.graphs)) errors.push("Patch graphs must be an array.");
  if (!graphs.length) errors.push("Patch needs at least one graph.");
  if (graphs.length > MAX_GRAPHS) errors.push(`Patch exceeds ${MAX_GRAPHS} graphs.`);
  const graphIds = new Set();
  for (const graph of graphs) {
    if (!graph || typeof graph !== "object") {
      errors.push("Every graph must be an object.");
      continue;
    }
    if (typeof graph.id !== "string" || !graph.id || graphIds.has(graph.id)) {
      errors.push(`Duplicate or missing graph id: ${graph.id ?? "(missing)"}.`);
    }
    graphIds.add(graph.id);
  }
  if (!graphIds.has(patch.rootGraphId)) errors.push("Root graph is missing.");
  for (const graph of graphs) {
    if (!graph || typeof graph !== "object") continue;
    const graphLabel = typeof graph.id === "string" && graph.id ? graph.id : "(missing graph)";
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const graphInterface = Array.isArray(graph.interface) ? graph.interface : [];
    if (!Array.isArray(graph.nodes)) errors.push(`${graphLabel} nodes must be an array.`);
    if (!Array.isArray(graph.edges)) errors.push(`${graphLabel} edges must be an array.`);
    if (!Array.isArray(graph.interface)) errors.push(`${graphLabel} interface must be an array.`);
    const nodeIds = new Set();
    const nodeById = new Map();
    if (nodes.length > MAX_NODES_PER_GRAPH) errors.push(`${graphLabel} exceeds ${MAX_NODES_PER_GRAPH} nodes.`);
    if (edges.length > MAX_EDGES_PER_GRAPH) errors.push(`${graphLabel} exceeds ${MAX_EDGES_PER_GRAPH} edges.`);
    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        errors.push(`Every node in ${graphLabel} must be an object.`);
        continue;
      }
      if (typeof node.id !== "string" || !node.id || nodeIds.has(node.id)) {
        errors.push(`Duplicate or missing node id in ${graphLabel}.`);
      }
      nodeIds.add(node.id);
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
      if (!["primitive", "subgraph", "port"].includes(node.type)) {
        errors.push(`Unknown node type on ${graphLabel}/${node.id ?? "(missing)"}.`);
      } else if (node.type === "primitive" && !PRIMITIVE_LIBRARY[node.primitiveId]) {
        errors.push(`Unknown primitive ${node.primitiveId ?? "(missing)"} on ${graphLabel}/${node.id}.`);
      } else if (node.type === "subgraph" && !graphIds.has(node.graphId)) {
        errors.push(`Missing subgraph ${node.graphId} from ${graphLabel}/${node.id}.`);
      } else if (node.type === "port" && (
        !["in", "out"].includes(node.direction)
        || !SIGNAL_TYPES.includes(node.signal)
      )) {
        errors.push(`Invalid boundary port ${graphLabel}/${node.id}.`);
      }
    }

    const interfaceIds = new Set();
    const interfaceNodeIds = new Set();
    for (const interfacePort of graphInterface) {
      if (!interfacePort || typeof interfacePort !== "object") {
        errors.push(`Every interface port in ${graphLabel} must be an object.`);
        continue;
      }
      if (typeof interfacePort.id !== "string" || !interfacePort.id || interfaceIds.has(interfacePort.id)) {
        errors.push(`Duplicate or missing interface id in ${graphLabel}.`);
      }
      interfaceIds.add(interfacePort.id);
      if (interfaceNodeIds.has(interfacePort.nodeId)) {
        errors.push(`Interface node ${interfacePort.nodeId} is exposed more than once in ${graphLabel}.`);
      }
      interfaceNodeIds.add(interfacePort.nodeId);
      const boundaryNode = nodeById.get(interfacePort.nodeId);
      if (
        !["in", "out"].includes(interfacePort.direction)
        || !SIGNAL_TYPES.includes(interfacePort.signal)
        || boundaryNode?.type !== "port"
        || boundaryNode.direction !== interfacePort.direction
        || boundaryNode.signal !== interfacePort.signal
      ) {
        errors.push(`Invalid interface target ${graphLabel}/${interfacePort.id ?? "(missing)"}.`);
      }
    }

    const edgeIds = new Set();
    for (const edge of edges) {
      if (!edge || typeof edge !== "object") {
        errors.push(`Every edge in ${graphLabel} must be an object.`);
        continue;
      }
      const edgeLabel = edge.id ?? "(missing)";
      if (typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)) {
        errors.push(`Duplicate or missing edge id in ${graphLabel}.`);
      }
      edgeIds.add(edge.id);
      const knownSignal = SIGNAL_TYPES.includes(edge.signal);
      if (!knownSignal) errors.push(`Unknown signal type on ${graphLabel}/${edgeLabel}.`);
      if (!nodeIds.has(edge.from?.nodeId) || !nodeIds.has(edge.to?.nodeId)) {
        errors.push(`Dangling edge ${graphLabel}/${edgeLabel}.`);
      }
      const explicitPorts = typeof edge.from?.portId === "string" && typeof edge.to?.portId === "string";
      const fromPort = knownSignal && explicitPorts
        ? endpointPort(patch, graph, edge.from?.nodeId, edge.signal, "out", edge.from.portId)
        : null;
      const toPort = knownSignal && explicitPorts
        ? endpointPort(patch, graph, edge.to?.nodeId, edge.signal, "in", edge.to.portId)
        : null;
      if (knownSignal && (!fromPort || !toPort)) {
        errors.push(`Incompatible ${edge.signal} ports on ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.feedback !== undefined && typeof edge.feedback !== "boolean") {
        errors.push(`Feedback must be boolean on ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.feedback === true && edge.signal !== "audio") {
        errors.push(`Feedback is only supported on audio edges: ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.signal !== "audio" && finite(edge.timing?.delayBeats, -1) < 0) {
        errors.push(`Negative event delay on ${graphLabel}/${edgeLabel}.`);
      }
    }
    if (zeroDelayEventCycle(graph)) {
      errors.push(`Zero-delay trigger/control cycle (MIDI event routes included) in ${graphLabel}.`);
    }
  }
  const recursive = recursiveGraphReference(patch);
  if (recursive) errors.push("Subgraph references must not recurse into themselves.");
  if (!errors.length && !recursive) {
    const flattened = flattenPatch(patch, patch.rootGraphId);
    if (flattened.truncated) {
      errors.push("Patch expands beyond the flattened graph limit.");
    } else if (flattenedHasUnsafeAudioCycle(flattened)) {
      errors.push("Unsafe audio cycle without an explicit feedback connection.");
    }
  }
  return { valid: errors.length === 0, errors };
}

function createEmptyPatch({ id, label, description, tempo, cycleBeats, seed }) {
  const rootGraphId = `${id}-patch`;
  return {
    schemaVersion: 2,
    id,
    label,
    description,
    tempo,
    meter: [4, 4],
    cycleBeats,
    seed,
    rootGraphId,
    selectedGraphId: rootGraphId,
    graphs: [{
      id: rootGraphId,
      label: "Patch",
      kind: "patch",
      description,
      interface: [],
      nodes: [],
      edges: [],
    }],
  };
}

const SOURCE_PATTERNS = freeze({
  straight: { signal: "trigger", steps: [1, 0, 0, 0, .9, 0, 0, 0, 1, 0, 0, 0, .82, 0, 0, 0], stepBeats: .25, noteOffsets: [0] },
  broken: { signal: "trigger", steps: [1, 0, .35, 0, 0, .8, 0, .25, 1, 0, 0, .58, 0, 0, .72, 0], stepBeats: .25, noteOffsets: [0, 0, 7, 0, 5, 0, 10, 0] },
  tresillo: { signal: "trigger", steps: [1, 0, 0, 1, 0, 0, 1, 0], stepBeats: .5, noteOffsets: [0, 0, 7, 0, 0, 5, 0, 0] },
  five: { signal: "trigger", steps: [1, 0, 1, 0, 0, 1, 0, 1, 0, 0], stepBeats: .5, noteOffsets: [0, 0, 3, 0, 0, 7, 0, 10, 0, 0] },
  sparse: { signal: "trigger", steps: [1, 0, 0, 0, 0, 0, .6, 0], stepBeats: 1, noteOffsets: [0, 0, 0, 0, 0, 0, 7, 0] },
});

const PATCH_RECIPES = [
  { id: "pulse-cascade", label: "Pulse Cascade", description: "A clock fans into percussion and a nested synth, then both signals pass through independent effects.", tempo: 124, cycleBeats: 16, seed: 11, pattern: "straight", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "compressor", fxB: "graph-delay", voiceDelay: 1, probability: 1 },
  { id: "polyrhythm-mesh", label: "Polyrhythm Mesh", description: "Uneven trigger divisions cross between drum, lattice, filter, and control subgraphs.", tempo: 112, cycleBeats: 20, seed: 23, pattern: "five", source: "euclidean-clock", rhythm: "graph-drums", voice: "lattice", fxA: "filter", fxB: "graph-delay", voiceDelay: 1.5, probability: .82 },
  { id: "feedback-garden", label: "Feedback Garden", description: "Delayed triggers return through a bounded cycle while audio follows a separate feedback-safe route.", tempo: 88, cycleBeats: 16, seed: 37, pattern: "sparse", source: "pulse-clock", rhythm: "lattice", voice: "sample-voice", fxA: "reverb", fxB: "graph-delay", voiceDelay: 2, probability: .72, triggerFeedback: true, audioFeedback: true },
  { id: "clock-division-lab", label: "Clock Division Lab", description: "Fast control-flow branches launch different sounds at independent edge delays.", tempo: 148, cycleBeats: 12, seed: 41, pattern: "broken", source: "pulse-clock", rhythm: "graph-drums", voice: "spiral", fxA: "compressor", fxB: "filter", voiceDelay: .75, probability: .66 },
  { id: "modulation-orchard", label: "Modulation Orchard", description: "A slow LFO graph bends two audio branches while triggers remain rhythmically independent.", tempo: 76, cycleBeats: 16, seed: 59, pattern: "tresillo", source: "euclidean-clock", rhythm: "graph-synth", voice: "sample-voice", fxA: "filter", fxB: "reverb", voiceDelay: 2.5, probability: .9 },
  { id: "dub-circuit", label: "Dub Circuit", description: "Percussion and bass share an echo graph whose audio and trigger feedback remain explicitly distinct.", tempo: 104, cycleBeats: 16, seed: 67, pattern: "broken", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "filter", fxB: "graph-delay", voiceDelay: 1.25, probability: .86, triggerFeedback: true, audioFeedback: true },
  { id: "probability-rain", label: "Probability Rain", description: "Deterministic seeded probability makes a repeatable cloud of trigger arrivals.", tempo: 132, cycleBeats: 16, seed: 79, pattern: "straight", source: "euclidean-clock", rhythm: "lattice", voice: "spiral", fxA: "graph-delay", fxB: "reverb", voiceDelay: .5, probability: .48 },
  { id: "nested-machines", label: "Nested Machines", description: "Graphs contain sound graphs, effect graphs, control graphs, routing graphs, and another editable blank graph.", tempo: 118, cycleBeats: 16, seed: 97, pattern: "tresillo", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "compressor", fxB: "graph-delay", voiceDelay: 1, probability: .94, blank: true },
];

function makePatchPreset(recipe) {
  const patch = createEmptyPatch(recipe);
  const graphId = patch.rootGraphId;
  const add = (id, deviceId, x, y, options = {}) => addDeviceNodeMutable(patch, graphId, deviceId, { id, x, y, ...options });
  add("clock", recipe.source, .07, .34, {
    label: recipe.source === "euclidean-clock" ? "Uneven clock" : "Patch clock",
    generator: SOURCE_PATTERNS[recipe.pattern],
  });
  add("rhythm", recipe.rhythm, .32, .2, { label: DEVICE_BY_ID.get(recipe.rhythm)?.label, soundId: recipe.rhythm, rootNote: 48 });
  add("voice", recipe.voice, .32, .66, { label: DEVICE_BY_ID.get(recipe.voice)?.label, soundId: recipe.voice, rootNote: 55 });
  add("effect-a", recipe.fxA, .58, .2, { label: DEVICE_BY_ID.get(recipe.fxA)?.label });
  add("effect-b", recipe.fxB, .58, .66, { label: DEVICE_BY_ID.get(recipe.fxB)?.label, triggerDelayBeats: .75 });
  add("modulator", "lfo", .34, .91, {
    label: "Slow control",
    generator: { signal: "control", steps: [.15, .45, .85, .5], stepBeats: 1 },
  });
  add("mixer", "mixer", .79, .43, { label: "Patch mixer" });
  add("output", "output", .94, .43, { label: "Audio output" });
  if (recipe.blank) add("nested", "blank-graph", .77, .82, { label: "Open subgraph" });

  addConnectionMutable(patch, graphId, "clock", "rhythm", "trigger", { id: "clock-rhythm", delayBeats: 0 });
  addConnectionMutable(patch, graphId, "clock", "voice", "trigger", { id: "clock-voice", delayBeats: recipe.voiceDelay, probability: recipe.probability });
  addConnectionMutable(patch, graphId, "rhythm", "effect-a", "audio", { id: "rhythm-effect" });
  addConnectionMutable(patch, graphId, "effect-a", "mixer", "audio", { id: "effect-a-mix", gain: .88 });
  addConnectionMutable(patch, graphId, "voice", "effect-b", "audio", { id: "voice-effect" });
  addConnectionMutable(patch, graphId, "effect-b", "mixer", "audio", { id: "effect-b-mix", gain: .82 });
  addConnectionMutable(patch, graphId, "modulator", "effect-a", "control", { id: "mod-effect-a", gain: .7 });
  addConnectionMutable(patch, graphId, "modulator", "effect-b", "control", { id: "mod-effect-b", gain: .45 });
  addConnectionMutable(patch, graphId, "mixer", "output", "audio", { id: "mix-output" });
  addConnectionMutable(patch, graphId, "rhythm", "effect-b", "trigger", { id: "rhythm-echo-trigger", delayBeats: .25, probability: .7 });
  if (recipe.triggerFeedback) addConnectionMutable(patch, graphId, "effect-b", "voice", "trigger", { id: "echo-voice-cycle", delayBeats: 2, probability: .54 });
  if (recipe.audioFeedback) addConnectionMutable(patch, graphId, "effect-b", "effect-b", "audio", { id: "effect-feedback", gain: .28, feedback: true });
  return patch;
}

function makeComposerStudioPreset() {
  const patch = createEmptyPatch({
    id: "composer-studio",
    label: "Composer Studio",
    description: "A shared-clock instrument, effect, MIDI, analysis, surround, and recording patch: signals may merge into one input or fan from one output to many destinations.",
    tempo: 126,
    cycleBeats: 8,
    seed: 131,
  });
  const graphId = patch.rootGraphId;
  const add = (id, deviceId, x, y, options = {}) => addDeviceNodeMutable(
    patch,
    graphId,
    deviceId,
    { id, x, y, ...options },
  );
  const connect = (id, fromNodeId, toNodeId, signal, options = {}) => addConnectionMutable(
    patch,
    graphId,
    fromNodeId,
    toNodeId,
    signal,
    { id, ...options },
  );

  add("master-clock", "pulse-clock", .04, .12, { label: "Shared 16th clock", presetId: "sixteenth" });
  add("divider", "clock-divider", .16, .06, { label: "Quarter branch", presetId: "divide-4" });
  add("swing", "swing-clock", .16, .18, { label: "Swing branch", presetId: "deep-swing" });
  add("midi-clock", "midi-clock", .04, .3, { label: "MIDI clock · 24 PPQN" });
  add("sync", "sync-bridge", .16, .3, { label: "Clock / MIDI sync" });
  add("midi-input", "midi-input", .04, .43, { label: "Hardware / keyboard MIDI" });
  add("hiccup", "hiccup-head", .3, .08, { label: "Rubber Face", presetId: "rubber-face", rootNote: 48 });
  add("acid", "webgpu-303", .3, .22, { label: "Lysergic Ribbon", presetId: "filter-snap", rootNote: 36 });
  add("synth", "graph-synth", .3, .36, { label: "Graph Synth", rootNote: 55 });
  add("lfo", "lfo", .3, .5, {
    label: "Shared modulation",
    generator: { signal: "control", steps: [.12, .38, .82, .56], stepBeats: .5 },
  });
  add("hiccup-stem", "stem-recorder", .43, .08, { label: "Hiccup stereo stem" });
  add("acid-stem", "stem-recorder", .43, .22, { label: "303 stereo stem" });
  add("hiccup-delay", "graph-delay", .56, .08, { label: "Hiccup dub", presetId: "dub-loop" });
  add("acid-filter", "filter", .56, .22, { label: "Acid resonator", presetId: "resonant" });
  add("mixer", "mixer", .7, .2, { label: "Many-in mix" });
  add("mix-recorder", "stereo-recorder", .83, .12, { label: "Stereo master recorder" });
  add("surround", "surround-output", .96, .12, { label: "7.1.4 surround", presetId: "7-4-1" });

  add("scope", "scope", .82, .28, { label: "Mix scope" });
  add("level", "level-meter", .82, .39, { label: "Mix level" });
  add("spectrum", "spectrum", .82, .5, { label: "Third-octave spectrum", presetId: "third-octave" });
  add("pitch", "frequency-tracker", .82, .61, { label: "Fundamental tracker" });
  add("fft", "audio-to-fft-bands", .68, .67, { label: "FFT band controls" });
  add("amp-midi", "amplitude-to-midi", .68, .79, {
    label: "Amplitude notes",
    params: { note: 48, channel: 9, openThreshold: .18, closeThreshold: .1 },
  });
  add("frequency-midi", "frequency-to-midi", .54, .62, {
    label: "Frequency notes",
    params: { minimumHz: 40, maximumHz: 4_000, channel: 0 },
  });
  add("midi-frequency", "midi-to-frequency", .54, .76, {
    label: "MIDI pitch control",
    params: { minimumHz: 20, maximumHz: 20_000 },
  });
  add("midi-control", "midi-to-control", .54, .88, { label: "MIDI value control" });
  add("number", "control-display", .82, .84, { label: "Merged control display" });
  add("midi-router", "midi-router", .38, .76, { label: "MIDI merge / fan-out" });
  add("midi-output", "midi-output", .38, .91, { label: "External MIDI output" });

  // One shared clock fans into multiple independently transformable branches.
  connect("clock-swing", "master-clock", "swing", "trigger");
  connect("clock-hiccup", "master-clock", "hiccup", "trigger");
  connect("clock-sync", "master-clock", "sync", "trigger");
  connect("sync-divider", "sync", "divider", "trigger");
  connect("divider-synth", "divider", "synth", "trigger");
  connect("swing-acid", "swing", "acid", "trigger");
  connect("midi-clock-output", "midi-clock", "midi-output", "midi");
  connect("midi-input-sync", "midi-input", "sync", "midi");
  connect("midi-input-router", "midi-input", "midi-router", "midi");

  // Several instrument/effect outputs merge into one mixer input.
  connect("hiccup-stem-in", "hiccup", "hiccup-stem", "audio");
  connect("hiccup-delay-in", "hiccup-stem", "hiccup-delay", "audio");
  connect("hiccup-mix", "hiccup-delay", "mixer", "audio", { gain: .82 });
  connect("acid-stem-in", "acid", "acid-stem", "audio");
  connect("acid-filter-in", "acid-stem", "acid-filter", "audio");
  connect("acid-mix", "acid-filter", "mixer", "audio", { gain: .76 });
  connect("synth-mix", "synth", "mixer", "audio", { gain: .68 });
  connect("mix-recorder-in", "mixer", "mix-recorder", "audio");
  connect("recorder-surround", "mix-recorder", "surround", "audio");

  // The same mix fans out to non-destructive analysis and conversion taps.
  connect("mix-scope", "mixer", "scope", "audio");
  connect("mix-level", "mixer", "level", "audio");
  connect("mix-spectrum", "mixer", "spectrum", "audio");
  connect("mix-pitch", "mixer", "pitch", "audio");
  connect("mix-fft", "mixer", "fft", "audio");
  connect("mix-amplitude-midi", "mixer", "amp-midi", "audio");

  // Control may fan out or merge; explicit port IDs select FFT band outputs.
  connect("lfo-delay", "lfo", "hiccup-delay", "control", { gain: .55 });
  connect("lfo-filter", "lfo", "acid-filter", "control", { gain: .72 });
  connect("lfo-frequency-midi", "lfo", "frequency-midi", "control");
  connect("pitch-frequency-midi", "pitch", "frequency-midi", "control");
  connect("level-number", "level", "number", "control");
  connect("midi-frequency-number", "midi-frequency", "number", "control");
  connect("midi-control-number", "midi-control", "number", "control");
  for (const band of ["low", "mid", "high", "air"]) {
    connect(`fft-${band}-number`, "fft", "number", "control", { fromPortId: `${band}-out` });
  }

  // MIDI can merge and fan out. Note input auditions Acid without returning its
  // thru to the merge; divided sync pulses may create new Graph Synth notes.
  connect("hiccup-midi-router", "hiccup", "midi-router", "midi");
  connect("synth-midi-router", "synth", "midi-router", "midi");
  connect("frequency-midi-router", "frequency-midi", "midi-router", "midi");
  connect("amplitude-midi-router", "amp-midi", "midi-router", "midi");
  connect("midi-input-acid", "midi-input", "acid", "midi");
  connect("midi-router-output", "midi-router", "midi-output", "midi");
  connect("midi-router-frequency", "midi-router", "midi-frequency", "midi");
  connect("midi-router-control", "midi-router", "midi-control", "midi");

  return patch;
}

function makeFeedbackObservatoryPreset() {
  const patch = createEmptyPatch({
    id: "feedback-observatory",
    label: "Feedback Observatory",
    description: "Delayed MIDI recirculates through bounded event routes while an explicitly marked audio delay loop remains a continuous signal-flow feedback path.",
    tempo: 94,
    cycleBeats: 16,
    seed: 149,
  });
  const graphId = patch.rootGraphId;
  const add = (id, deviceId, x, y, options = {}) => addDeviceNodeMutable(
    patch,
    graphId,
    deviceId,
    { id, x, y, ...options },
  );
  const connect = (id, fromNodeId, toNodeId, signal, options = {}) => addConnectionMutable(
    patch,
    graphId,
    fromNodeId,
    toNodeId,
    signal,
    { id, ...options },
  );

  add("clock", "pulse-clock", .05, .12, {
    label: "Broken clock",
    generator: SOURCE_PATTERNS.broken,
  });
  add("hiccup", "hiccup-head", .2, .08, { label: "Cavern Gob", presetId: "cavern-gob", rootNote: 43 });
  add("acid", "webgpu-303", .2, .24, { label: "Glass Seance", presetId: "resonance-glass", rootNote: 31 });
  add("delay", "graph-delay", .38, .12, { label: "Feedback delay", presetId: "long-orbit" });
  add("mixer", "mixer", .55, .12, { label: "Feedback mix" });
  add("scope", "scope", .7, .07, { label: "Feedback scope" });
  add("recorder", "stereo-recorder", .84, .07, { label: "Observed mix recorder" });
  add("surround", "surround-output", .96, .07, { label: "Binaural output", presetId: "binaural" });
  add("level", "level-meter", .69, .22, { label: "Feedback level" });
  add("spectrum", "spectrum", .83, .22, { label: "Feedback spectrum", presetId: "octave" });
  add("pitch", "frequency-tracker", .69, .36, { label: "Feedback pitch" });
  add("fft", "audio-to-fft-bands", .83, .36, { label: "Feedback bands" });
  add("amp-midi", "amplitude-to-midi", .69, .5, {
    label: "Level gate notes",
    params: { note: 36, channel: 9, openThreshold: .22, closeThreshold: .12 },
  });
  add("lfo", "lfo", .07, .56, {
    label: "Pitch scanner",
    generator: { signal: "control", steps: [.18, .32, .64, .86], stepBeats: .75 },
  });
  add("frequency-midi", "frequency-to-midi", .23, .56, {
    label: "Scanner to MIDI",
    params: { minimumHz: 55, maximumHz: 1_760, channel: 1 },
  });
  add("midi-router", "midi-router", .39, .62, { label: "Delayed MIDI loop" });
  add("midi-input", "midi-input", .23, .7, { label: "External MIDI input" });
  add("midi-output", "midi-output", .55, .55, { label: "MIDI monitor out" });
  add("midi-frequency", "midi-to-frequency", .55, .68, { label: "MIDI pitch value" });
  add("midi-control", "midi-to-control", .55, .81, { label: "MIDI velocity value" });
  add("number", "control-display", .75, .75, { label: "Feedback numbers" });

  connect("clock-hiccup", "clock", "hiccup", "trigger");
  connect("clock-acid", "clock", "acid", "trigger", { delayBeats: .25 });
  connect("hiccup-delay", "hiccup", "delay", "audio");
  connect("delay-audio-feedback", "delay", "delay", "audio", { gain: .32, feedback: true });
  connect("delay-mixer", "delay", "mixer", "audio", { gain: .78 });
  connect("acid-mixer", "acid", "mixer", "audio", { gain: .68 });
  connect("mixer-scope", "mixer", "scope", "audio");
  connect("scope-recorder", "scope", "recorder", "audio");
  connect("recorder-surround", "recorder", "surround", "audio");
  connect("mixer-level", "mixer", "level", "audio");
  connect("mixer-spectrum", "mixer", "spectrum", "audio");
  connect("mixer-pitch", "mixer", "pitch", "audio");
  connect("mixer-fft", "mixer", "fft", "audio");
  connect("mixer-amplitude-midi", "mixer", "amp-midi", "audio");

  connect("lfo-frequency-midi", "lfo", "frequency-midi", "control");
  connect("pitch-frequency-midi", "pitch", "frequency-midi", "control");
  connect("frequency-midi-router", "frequency-midi", "midi-router", "midi");
  connect("midi-input-router", "midi-input", "midi-router", "midi");
  connect("hiccup-midi-router", "hiccup", "midi-router", "midi");
  connect("amplitude-midi-router", "amp-midi", "midi-router", "midi");
  connect("midi-delayed-self", "midi-router", "midi-router", "midi", {
    delayBeats: .5,
    probability: .36,
  });
  connect("midi-delayed-acid", "midi-router", "acid", "midi", {
    delayBeats: .25,
    probability: .54,
  });
  connect("midi-output", "midi-router", "midi-output", "midi");
  connect("midi-frequency", "midi-router", "midi-frequency", "midi");
  connect("midi-control", "midi-router", "midi-control", "midi");
  connect("frequency-number", "midi-frequency", "number", "control");
  connect("velocity-number", "midi-control", "number", "control");
  connect("level-number", "level", "number", "control");
  connect("fft-low-number", "fft", "number", "control", { fromPortId: "low-out" });
  connect("fft-high-number", "fft", "number", "control", { fromPortId: "high-out" });

  return patch;
}

export const PATCH_PRESETS = freeze([
  makeComposerStudioPreset(),
  makeFeedbackObservatoryPreset(),
  ...PATCH_RECIPES.map(makePatchPreset),
]);
export const COMPOSITION_PRESETS = PATCH_PRESETS;

export function clonePatchPreset(id = PATCH_PRESETS[0]?.id) {
  return clone(PATCH_PRESETS.find((preset) => preset.id === id) ?? PATCH_PRESETS[0]);
}

export const cloneCompositionPreset = clonePatchPreset;

export function createPatch(options = {}) {
  if (typeof options === "string") return clonePatchPreset(options);
  return clonePatchPreset(options.presetId ?? options.id);
}

export const createComposition = createPatch;
