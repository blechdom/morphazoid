const freezeVoicing = ({ settings, performance, ...identity }) => Object.freeze({
  ...identity,
  settings: Object.freeze({ ...settings }),
  performance: Object.freeze({ ...performance }),
});

/**
 * Additional authored scenes for the recursive instruments' complete presets.
 * Existing factory scenes remain in their instrument modules. These additions
 * use continuous frequencies, audible final turns and short initial attacks;
 * slow modulation supplies movement without delaying the first audible sound.
 * Performance overrides describe MIDI articulation, never Audio or play mode.
 */
export const RECURSIVE_ADDITIONAL_VOICINGS = Object.freeze({
  am: Object.freeze([
    {
      id: "ripple-reed",
      label: "Ripple Reed",
      description: "A 13.7 Hz seed gives a 196 Hz carrier an immediate, deep amplitude flutter.",
      settings: {
        depth: 1, carrierHz: 13.7, startModFrequencyHz: 196,
        frequencyDivisor: 1.3, startAmplitudeIndex: 5, indexDivisor: 1.2,
      },
      performance: {
        ampAttackMs: 6, ampDecayMs: 95, ampSustainLevel: 0.78, ampReleaseMs: 150,
      },
    },
    {
      id: "copper-chime",
      label: "Copper Chime",
      description: "A 437 Hz modulator adds exposed 166 and 708 Hz sidebands around a 271 Hz carrier.",
      settings: {
        depth: 1, carrierHz: 437, startModFrequencyHz: 271,
        frequencyDivisor: 1.4, startAmplitudeIndex: 4.8, indexDivisor: 1.1,
      },
      performance: {
        ampAttackMs: 3, ampDecayMs: 640, ampSustainLevel: 0.26, ampReleaseMs: 880,
      },
    },
    {
      id: "paper-bass",
      label: "Paper Bass",
      description: "Two amplitude turns fold an 83 Hz seed and a 144 Hz middle tone around a 75 Hz bass carrier.",
      settings: {
        depth: 2, carrierHz: 83, startModFrequencyHz: 144,
        frequencyDivisor: 1.92, startAmplitudeIndex: 3.6, indexDivisor: 1.05,
      },
      performance: {
        ampAttackMs: 4, ampDecayMs: 150, ampSustainLevel: 0.56, ampReleaseMs: 95,
      },
    },
    {
      id: "glass-crown",
      label: "Glass Crown",
      description: "Three rising carriers meet a 521 Hz seed; the AM depth grows gently toward the 503 Hz final turn.",
      settings: {
        depth: 3, carrierHz: 521, startModFrequencyHz: 330,
        frequencyDivisor: 0.81, startAmplitudeIndex: 2.7, indexDivisor: 0.94,
      },
      performance: {
        ampAttackMs: 12, ampDecayMs: 310, ampSustainLevel: 0.48, ampReleaseMs: 620,
      },
    },
    {
      id: "gear-whisper",
      label: "Gear Whisper",
      description: "Five closely spaced amplitude turns make a dense low-mid texture around a 137 Hz carrier.",
      settings: {
        depth: 5, carrierHz: 29, startModFrequencyHz: 215,
        frequencyDivisor: 1.12, startAmplitudeIndex: 9, indexDivisor: 1.08,
      },
      performance: {
        ampAttackMs: 18, ampDecayMs: 180, ampSustainLevel: 0.82, ampReleaseMs: 340,
        glideMode: "legato", glideTimeMs: 65,
      },
    },
    {
      id: "shortwave-lace",
      label: "Shortwave Lace",
      description: "Four widening frequency steps carry a 317 Hz seed into bright sidebands around a 1.18 kHz final carrier.",
      settings: {
        depth: 4, carrierHz: 317, startModFrequencyHz: 387,
        frequencyDivisor: 0.69, startAmplitudeIndex: 6, indexDivisor: 0.88,
      },
      performance: {
        ampAttackMs: 2, ampDecayMs: 120, ampSustainLevel: 0.4, ampReleaseMs: 170,
      },
    },
    {
      id: "soft-beacon",
      label: "Soft Beacon",
      description: "A gentle 5.3 Hz seed moves through two restrained AM links while the 212 Hz carrier stays prominent.",
      settings: {
        depth: 2, carrierHz: 5.3, startModFrequencyHz: 318,
        frequencyDivisor: 1.5, startAmplitudeIndex: 0.8, indexDivisor: 1.6,
      },
      performance: {
        ampAttackMs: 45, ampDecayMs: 240, ampSustainLevel: 0.85, ampReleaseMs: 780,
        glideMode: "legato", glideTimeMs: 110,
      },
    },
  ].map(freezeVoicing)),
  fm: Object.freeze([
    {
      id: "warm-fold",
      label: "Warm Fold",
      description: "A 23 Hz seed moves a compact two-turn frequency recursion with a rounded, sustained articulation.",
      settings: {
        depth: 2, carrierHz: 23, offsetHz: 180, modulationHz: 1280, divisor: 1.4,
      },
      performance: {
        ampAttackMs: 9, ampDecayMs: 180, ampSustainLevel: 0.78, ampReleaseMs: 260,
      },
    },
    {
      id: "mercury-wire",
      label: "Mercury Wire",
      description: "A fast 337 Hz seed and an expanding recursive amount form a bright, moving two-turn voice.",
      settings: {
        depth: 2, carrierHz: 337, offsetHz: 90, modulationHz: 2650, divisor: 0.88,
      },
      performance: {
        ampAttackMs: 3, ampDecayMs: 360, ampSustainLevel: 0.34, ampReleaseMs: 470,
      },
    },
    {
      id: "pocket-motor",
      label: "Pocket Motor",
      description: "Three shrinking frequency turns wrap a 67 Hz seed into a compact, quickly articulated recursive tone.",
      settings: {
        depth: 3, carrierHz: 67, offsetHz: 0, modulationHz: 2100, divisor: 1.65,
      },
      performance: {
        ampAttackMs: 2, ampDecayMs: 105, ampSustainLevel: 0.52, ampReleaseMs: 80,
      },
    },
    {
      id: "reed-grid",
      label: "Reed Grid",
      description: "Four descending modulation amounts turn a 129 Hz seed and a bright entry oscillator into a dense sustained voice.",
      settings: {
        depth: 4, carrierHz: 129, offsetHz: 430, modulationHz: 6800, divisor: 2.1,
      },
      performance: {
        ampAttackMs: 17, ampDecayMs: 150, ampSustainLevel: 0.8, ampReleaseMs: 290,
        glideMode: "legato", glideTimeMs: 72,
      },
    },
    {
      id: "glass-prism",
      label: "Glass Prism",
      description: "A 271 Hz seed moves a high-offset entry oscillator through one broad recursive turn with a ringing MIDI decay.",
      settings: {
        depth: 1, carrierHz: 271, offsetHz: 1240, modulationHz: 3480, divisor: 1.3,
      },
      performance: {
        ampAttackMs: 3, ampDecayMs: 720, ampSustainLevel: 0.22, ampReleaseMs: 960,
      },
    },
    {
      id: "sine-arc",
      label: "Sine Arc",
      description: "The entry oscillator alone traces a 211–581 Hz sweep at a 91 Hz modulation rate, with no extra recursive turns.",
      settings: {
        depth: 0, carrierHz: 91, offsetHz: 211, modulationHz: 370, divisor: 2,
      },
      performance: {
        ampAttackMs: 22, ampDecayMs: 250, ampSustainLevel: 0.84, ampReleaseMs: 410,
        glideMode: "always", glideTimeMs: 85,
      },
    },
  ].map(freezeVoicing)),
  pm: Object.freeze([
    {
      id: "needle-bell",
      label: "Needle Bell",
      description: "A 331 Hz seed bends a 227 Hz carrier through one clear phase turn with a short attack and ringing release.",
      settings: {
        depth: 1, carrierHz: 331, startModFrequencyHz: 227,
        frequencyDivisor: 1.4, startPhaseIndex: 0.42, indexDivisor: 1.2,
      },
      performance: {
        ampAttackMs: 2, ampDecayMs: 560, ampSustainLevel: 0.28, ampReleaseMs: 810,
      },
    },
    {
      id: "tin-ribbon",
      label: "Tin Ribbon",
      description: "Two phase turns pull a 61 Hz seed through 287 and 221 Hz carriers, with a firm onset and short tail.",
      settings: {
        depth: 2, carrierHz: 61, startModFrequencyHz: 287,
        frequencyDivisor: 1.3, startPhaseIndex: 0.63, indexDivisor: 1.4,
      },
      performance: {
        ampAttackMs: 4, ampDecayMs: 130, ampSustainLevel: 0.62, ampReleaseMs: 145,
      },
    },
    {
      id: "hollow-step",
      label: "Hollow Step",
      description: "Three descending carriers and slowly falling phase indices fill out a 104 Hz final turn with a low, complex spectrum.",
      settings: {
        depth: 3, carrierHz: 97, startModFrequencyHz: 320,
        frequencyDivisor: 1.75, startPhaseIndex: 0.29, indexDivisor: 1.15,
      },
      performance: {
        ampAttackMs: 6, ampDecayMs: 170, ampSustainLevel: 0.58, ampReleaseMs: 130,
      },
    },
    {
      id: "electric-pollen",
      label: "Electric Pollen",
      description: "Four rising carrier frequencies and gently expanding phase indices make a bright cloud around a 691 Hz final turn.",
      settings: {
        depth: 4, carrierHz: 219, startModFrequencyHz: 381,
        frequencyDivisor: 0.82, startPhaseIndex: 0.36, indexDivisor: 0.95,
      },
      performance: {
        ampAttackMs: 11, ampDecayMs: 290, ampSustainLevel: 0.53, ampReleaseMs: 430,
      },
    },
    {
      id: "velvet-reed",
      label: "Velvet Reed",
      description: "A 43 Hz seed lightly bends two low-mid carriers, keeping the phase motion restrained and the MIDI articulation sustained.",
      settings: {
        depth: 2, carrierHz: 43, startModFrequencyHz: 187,
        frequencyDivisor: 1.2, startPhaseIndex: 0.12, indexDivisor: 0.84,
      },
      performance: {
        ampAttackMs: 28, ampDecayMs: 220, ampSustainLevel: 0.86, ampReleaseMs: 490,
        glideMode: "legato", glideTimeMs: 95,
      },
    },
    {
      id: "bright-splinter",
      label: "Bright Splinter",
      description: "Five rising phase carriers stretch a 113 Hz seed into an immediate, bright spectrum around a 1.18 kHz final turn.",
      settings: {
        depth: 5, carrierHz: 113, startModFrequencyHz: 336,
        frequencyDivisor: 0.73, startPhaseIndex: 0.78, indexDivisor: 1.6,
      },
      performance: {
        ampAttackMs: 2, ampDecayMs: 145, ampSustainLevel: 0.35, ampReleaseMs: 190,
      },
    },
    {
      id: "rubber-moon",
      label: "Rubber Moon",
      description: "An 8.2 Hz seed bends a 91 Hz carrier through a wide single phase turn; legato glide adds a second kind of pitch motion.",
      settings: {
        depth: 1, carrierHz: 8.2, startModFrequencyHz: 91,
        frequencyDivisor: 1.5, startPhaseIndex: 8.4, indexDivisor: 1.1,
      },
      performance: {
        ampAttackMs: 4, ampDecayMs: 60, ampSustainLevel: 0.8, ampReleaseMs: 120,
        glideMode: "legato", glideTimeMs: 105,
      },
    },
  ].map(freezeVoicing)),
});
