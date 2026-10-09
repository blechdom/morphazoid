const freezePreset = ({ settings, performance, ...identity }) => Object.freeze({
  ...identity,
  settings: Object.freeze({ ...settings }),
  performance: Object.freeze({ ...performance }),
});

/**
 * Authored for nested AM around an audible carrier. The first eight IDs retain
 * their existing order; their sounds now explore amplitude modulation directly.
 * Frequencies are continuous choices, without scale or interval quantization.
 * Articulation overrides belong to presets; output and play mode remain live.
 */
export const CHAOTIC_AM_PRESETS = Object.freeze([
  {
    id: "subzero-thread",
    label: "Subzero Thread",
    description: "A 156 Hz carrier pulses at 8.7 Hz, with two slower nested motions loosening its outline.",
    settings: {
      transferMode: "smooth", depth: 3, carrierHz: 156,
      startModFrequencyHz: 8.7, frequencyDivisor: 1.7,
      startAmplitudeIndex: 4.5, indexDivisor: 1.2, nonlinearity: 0.18,
    },
    performance: {
      ampAttackMs: 7, ampDecayMs: 150, ampSustainLevel: 0.78, ampReleaseMs: 220,
      glideMode: "legato", glideTimeMs: 70,
    },
  },
  {
    id: "forty-fold",
    label: "Forty Fold",
    description: "A 188 Hz carrier holds its pitch while nested 40 and 25 Hz modulators make a firm, rippling flutter.",
    settings: {
      transferMode: "smooth", depth: 2, carrierHz: 188,
      startModFrequencyHz: 40, frequencyDivisor: 1.6,
      startAmplitudeIndex: 6.66, indexDivisor: 1.25, nonlinearity: 0.512,
    },
    performance: {
      ampAttackMs: 5, ampDecayMs: 120, ampSustainLevel: 0.76, ampReleaseMs: 180,
    },
  },
  {
    id: "still-glass",
    label: "Still Glass",
    description: "A clear 641 Hz carrier carries a restrained, three-layer cluster of nonmatching sidebands.",
    settings: {
      transferMode: "smooth", depth: 3, carrierHz: 641,
      startModFrequencyHz: 173, frequencyDivisor: 1.47,
      startAmplitudeIndex: 1.4, indexDivisor: 1.6, nonlinearity: 0.08,
    },
    performance: {
      ampAttackMs: 3, ampDecayMs: 570, ampSustainLevel: 0.24, ampReleaseMs: 850,
    },
  },
  {
    id: "runaway-stair",
    label: "Runaway Stair",
    description: "Six rising modulation rates and growing inner depths roughen a 293 Hz carrier into a dense buzz.",
    settings: {
      transferMode: "saturated", depth: 6, carrierHz: 293,
      startModFrequencyHz: 146, frequencyDivisor: 0.78,
      startAmplitudeIndex: 6.2, indexDivisor: 0.88, nonlinearity: 0.67,
    },
    performance: {
      ampAttackMs: 2, ampDecayMs: 105, ampSustainLevel: 0.58, ampReleaseMs: 125,
    },
  },
  {
    id: "braided-orbit",
    label: "Braided Orbit",
    description: "Four closely spaced flutter rates braid a deep, shifting envelope around a steady 226 Hz carrier.",
    settings: {
      transferMode: "smooth", depth: 4, carrierHz: 226,
      startModFrequencyHz: 11.3, frequencyDivisor: 0.84,
      startAmplitudeIndex: 8, indexDivisor: 1.05, nonlinearity: 0.42,
    },
    performance: {
      ampAttackMs: 12, ampDecayMs: 210, ampSustainLevel: 0.83, ampReleaseMs: 420,
      glideMode: "legato", glideTimeMs: 95,
    },
  },
  {
    id: "low-ember",
    label: "Low Ember",
    description: "A 97 Hz bass carrier glows through three descending pulse rates with sharply shaped amplitude edges.",
    settings: {
      transferMode: "saturated", depth: 3, carrierHz: 97,
      startModFrequencyHz: 23.8, frequencyDivisor: 1.8,
      startAmplitudeIndex: 4, indexDivisor: 1.35, nonlinearity: 0.82,
    },
    performance: {
      ampAttackMs: 4, ampDecayMs: 130, ampSustainLevel: 0.65, ampReleaseMs: 110,
    },
  },
  {
    id: "kilohertz-veil",
    label: "Kilohertz Veil",
    description: "A 997 Hz carrier stays exposed above four gently shaped layers of audio-rate amplitude detail.",
    settings: {
      transferMode: "smooth", depth: 4, carrierHz: 997,
      startModFrequencyHz: 307, frequencyDivisor: 1.63,
      startAmplitudeIndex: 1.8, indexDivisor: 0.92, nonlinearity: 0.12,
    },
    performance: {
      ampAttackMs: 14, ampDecayMs: 320, ampSustainLevel: 0.55, ampReleaseMs: 640,
    },
  },
  {
    id: "chrome-cascade",
    label: "Chrome Cascade",
    description: "Five descending audio-rate modulators add a dense metallic rim to a 374 Hz carrier.",
    settings: {
      transferMode: "saturated", depth: 5, carrierHz: 374,
      startModFrequencyHz: 613, frequencyDivisor: 1.21,
      startAmplitudeIndex: 7.4, indexDivisor: 1.08, nonlinearity: 0.73,
    },
    performance: {
      ampAttackMs: 2, ampDecayMs: 430, ampSustainLevel: 0.34, ampReleaseMs: 510,
    },
  },
  {
    id: "velvet-pulse",
    label: "Velvet Pulse",
    description: "A rounded 4.8 Hz tremolo breathes over a 271 Hz carrier, with a slower inner envelope.",
    settings: {
      transferMode: "smooth", depth: 2, carrierHz: 271,
      startModFrequencyHz: 4.8, frequencyDivisor: 2.6,
      startAmplitudeIndex: 2.5, indexDivisor: 1.4, nonlinearity: 0.16,
    },
    performance: {
      ampAttackMs: 24, ampDecayMs: 230, ampSustainLevel: 0.86, ampReleaseMs: 690,
      glideMode: "legato", glideTimeMs: 120,
    },
  },
  {
    id: "copper-rattle",
    label: "Copper Rattle",
    description: "One strongly shaped 1133 Hz modulator throws exposed metallic sidebands around a 457 Hz carrier.",
    settings: {
      transferMode: "saturated", depth: 1, carrierHz: 457,
      startModFrequencyHz: 1133, frequencyDivisor: 1.3,
      startAmplitudeIndex: 11, indexDivisor: 1.1, nonlinearity: 0.92,
    },
    performance: {
      ampAttackMs: 2, ampDecayMs: 290, ampSustainLevel: 0.28, ampReleaseMs: 330,
    },
  },
  {
    id: "split-lantern",
    label: "Split Lantern",
    description: "Nested 53.7 and 95.9 Hz modulators chop a 538 Hz carrier into a tight, bright flutter.",
    settings: {
      transferMode: "saturated", depth: 2, carrierHz: 538,
      startModFrequencyHz: 53.7, frequencyDivisor: 0.56,
      startAmplitudeIndex: 18, indexDivisor: 0.72, nonlinearity: 0.91,
    },
    performance: {
      ampAttackMs: 3, ampDecayMs: 85, ampSustainLevel: 0.48, ampReleaseMs: 95,
    },
  },
  {
    id: "paper-meteor",
    label: "Paper Meteor",
    description: "Six rising audio-rate layers brush faint, bright sidebands across a prominent 823 Hz carrier.",
    settings: {
      transferMode: "smooth", depth: 6, carrierHz: 823,
      startModFrequencyHz: 1040, frequencyDivisor: 0.86,
      startAmplitudeIndex: 0.85, indexDivisor: 1.4, nonlinearity: 0.04,
    },
    performance: {
      ampAttackMs: 5, ampDecayMs: 470, ampSustainLevel: 0.32, ampReleaseMs: 730,
    },
  },
].map(freezePreset));
