// Shared bounds for the score, motor, signed travel and native controls.
export const QUADRUPED_LIMITS = Object.freeze({
  tempoBpm: Object.freeze([10, 1000]),
  stride: Object.freeze([0.15, 2.4]),
  momentum: Object.freeze([0.12, 3]),
  gravity: Object.freeze([0.1, 3]),
  lopsided: Object.freeze([-1, 1]),
  spring: Object.freeze([0, 2.5]),
  pitchSemitones: Object.freeze([-36, 36]),
  minimumTimingWeight: 0.55,
  mood: Object.freeze([0, 1]),
  groundResonance: Object.freeze([0, 1]),
  outputLevel: Object.freeze([0, 0.72]),
  maxScheduledVoices: 48,
  maxHeadVoices: 16,
  schedulerLookaheadSeconds: 0.09,
});
