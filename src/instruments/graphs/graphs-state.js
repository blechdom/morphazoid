import { GRAPH_INSTRUMENT_PATCHES } from "../../families/graph/graph-instruments.js";

const DEFAULT_PATCH = "layeredGlass";

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

export const GRAPH_MODES = Object.freeze(["synth", "drums", "mic"]);
export const MODE_STATE_KEYS = Object.freeze({
  synth: Object.freeze([
    "mappingMode", "seedNote", "baseFrequency", "pitchRange", "tuningMode",
    "edoDivisions", "turnPitchScale", "soundMode", "modulationIndex",
    "modulationRatio", "articulation", "noteDuration", "attack", "decay",
    "sustain", "release", "stereoSpread", "triggerScope", "attackLaneCount",
  ]),
  drums: Object.freeze([
    "mappingMode", "seedNote", "baseFrequency", "percussionStyle",
    "pitchDepth", "turnPitchDepth", "characterDepth", "triggerScope", "attackLaneCount",
  ]),
  mic: Object.freeze([
    "pitchScale", "pitchAsymmetry", "pitchCurve", "pitchSlew", "damping",
    "wet", "dry", "spread", "inputTrim",
  ]),
});
const GRAPH_PRESET_STATE_KEYS = Object.freeze([
  "topology", "nodeCount", "density", "seed", "baseDelay", "distanceRatio",
  "timeCurve", "nodePass", "feedback", "feedbackTone", "tempo",
  "triggerScope",
]);

export function midiFrequency(note) {
  return 440 * 2 ** ((clamp(note, 0, 127, 69) - 69) / 12);
}

export function graphInstrumentPresetState(name, mode = "synth") {
  const patch = GRAPH_INSTRUMENT_PATCHES[name];
  if (!patch) return null;
  const instrumentMode = mode === "drums" ? "drums" : "synth";
  const state = { graphPatch: name };
  for (const key of GRAPH_PRESET_STATE_KEYS) {
    // Attack-point selection is a performance/sound choice on Graph Synth.
    // Preserving it prevents graph presets from introducing long silent waits.
    if (instrumentMode === "synth" && key === "triggerScope") continue;
    if (patch[key] !== undefined) state[key] = patch[key];
  }
  const pulseBeats = patch.pulseBeats ?? patch.pulseDivision;
  if (pulseBeats !== undefined) state.pulseDivision = pulseBeats;
  if (instrumentMode === "drums") Object.assign(state, patch.drums ?? {});
  return state;
}

export function graphInstrumentDefaultState(mode = "synth") {
  const instrumentMode = mode === "drums" ? "drums" : "synth";
  const seedNote = instrumentMode === "drums" ? 60 : 57;
  return {
    playing: false,
    audio: false,
    output: instrumentMode === "drums" ? 0.58 : 0.64,
    triggerScope: "all",
    feedbackTone: 0.78,
    seedNote,
    nodeMoving: false,
    nodeMotionMode: "wiggle",
    nodeMotionSpeed: 0.12,
    nodeMotionAmount: 0.07,
    nodeMotionPhase: 0,
    mappingMode: instrumentMode === "drums" ? "position-grid" : "turn",
    percussionStyle: "circuit",
    pitchDepth: 12,
    turnPitchDepth: 9,
    characterDepth: 0.72,
    baseFrequency: midiFrequency(seedNote),
    pitchRange: 2,
    tuningMode: "equal",
    edoDivisions: instrumentMode === "synth" ? 19 : 12,
    turnPitchScale: 1.1,
    soundMode: instrumentMode === "synth" ? "fm" : "sine",
    modulationIndex: 2.8,
    modulationRatio: 2,
    articulation: "trigger",
    attackLaneCount: 1,
    noteDuration: 210,
    attack: 8,
    decay: 90,
    sustain: 0.34,
    release: 220,
    stereoSpread: 0.84,
    pitchScale: 0.26,
    pitchAsymmetry: 0,
    pitchCurve: 1.35,
    pitchSlew: 165,
    damping: 4_800,
    wet: 1.08,
    dry: 0.18,
    spread: 0.82,
    inputTrim: 0.8,
    inputX: 0.08,
    inputY: 0.5,
    ...graphInstrumentPresetState(DEFAULT_PATCH, instrumentMode),
  };
}

