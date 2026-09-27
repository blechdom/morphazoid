export const DEFAULT_SYNTH_STATE = Object.freeze({
  pitchSource: "angle",
  baseFrequency: 220,
  pitchRange: 2,
  depthAmount: 0.65,
  soundMode: "sine",
  modulationIndex: 3,
  modulationRatio: 1.5,
  cutoff: 9000,
  resonance: 0.6,
  articulation: "density",
  noteDuration: 0.28,
  stereoSpread: 0.9,
});
export const DEFAULT_DRUM_STATE = Object.freeze({
  subdivisions: 4,
  mappingMode: "branch-depth-turn",
  percussionStyle: "drum-bank",
  pitchDepth: 12,
  anglePitchDepth: 12,
  angleRange: 90,
  characterDepth: 0.72,
});
export const DEFAULT_MIC_STATE = Object.freeze({
  pitchSource: "angle",
  inputTrim: 1,
  intervalMs: 240,
  pitchScale: 1,
  dry: 0,
  feedback: 0.38,
  interval: 1,
  timeRatio: 1,
  pitchRange: 1.2,
  spread: 0.9,
  wet: 0.92,
});
export const DEFAULT_MIX_STATE = Object.freeze({
  presetId: "balanced",
  continuous: 1,
  notes: 1,
  triggers: 0.95,
  mic: 1.12,
});
export const DEFAULT_STATE = Object.freeze({
  mode: "continuous",
  presetId: "pythagorean",
  geometryModel: "rewrite",
  branchDecay: 1,
  childTimeRatio: 1,
  mutation: 0,
  pruningBias: 0,
  iterations: 7,
  angle: 45,
  turnAsymmetry: 0,
  lengthScale: 0.72,
  position: 0,
  speed: 0.3,
  direction: 1,
  traversalBehavior: "loop",
  structureMode: "final",
  playing: false,
  audio: false,
  level: 0.58,
});

export function createDefaultState() {
  return {
    ...DEFAULT_STATE,
    synth: { ...DEFAULT_SYNTH_STATE },
    drums: { ...DEFAULT_DRUM_STATE },
    mic: { ...DEFAULT_MIC_STATE },
    mix: { ...DEFAULT_MIX_STATE },
  };
}
