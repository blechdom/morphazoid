import {
  ANIMALS,
  CALL_GESTURES,
  CONTROL_LIMITS,
  animalState,
  clamp,
  interpolateGesture,
  sampleGestureCurve,
  sampleModulationWave,
  sanitizeSyrinxState,
} from "./syrinx.js";
import { sanitizeTongueState } from "./tongue-physics.js";

const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const integerInRange = (value, fallback, minimum, maximum) => (
  Math.trunc(clamp(finiteOr(value, fallback), minimum, maximum))
);

export const CREATURAZOID_MAX_STEPS = 64;
export const CREATURAZOID_STEP_COUNT = CREATURAZOID_MAX_STEPS;
export const CREATURAZOID_DYNAMICS = Object.freeze([0, 0.42, 0.72, 1]);
export const CREATURAZOID_VELOCITIES = CREATURAZOID_DYNAMICS;

export const CREATURAZOID_LIMITS = Object.freeze({
  tempo: Object.freeze([48, 360]),
  swing: Object.freeze([0, 0.46]),
  patternLength: Object.freeze([1, CREATURAZOID_MAX_STEPS]),
  morph: Object.freeze([0, 1]),
  pitchSemitones: Object.freeze([-24, 24]),
  vibratoRateHz: Object.freeze([0, 20]),
  vibratoDepthSemitones: Object.freeze([0, 6]),
  modulationRateHz: Object.freeze([0, 20]),
  modulationDepth: Object.freeze([0, 1]),
  timbre: Object.freeze([-1, 1]),
  morphTimeMs: Object.freeze([12, 240]),
  attackMs: Object.freeze([8, 48]),
  bodyScale: Object.freeze([0.55, 1.35]),
  bodyRoundness: Object.freeze([-1, 1]),
  earSpread: Object.freeze([0, 1]),
  tongueReach: Object.freeze([0, 1]),
  tongueMotion: Object.freeze([0, 1]),
  level: Object.freeze([0, 1]),
});

export const CREATURAZOID_EAR_TYPES = Object.freeze([
  "round",
  "point",
  "drop",
  "fan",
  "long",
  "wide",
]);

export const CREATURAZOID_TAIL_TYPES = Object.freeze([
  "brush",
  "whip",
  "tuft",
  "fan",
]);

export const CREATURAZOID_MORPH_CONTROLS = Object.freeze([
  "pressure",
  "tension",
  "adduction",
  "sourceScale",
  "tractLengthM",
  "mouthOpening",
  "cavityCoupling",
  "asymmetry",
  "sourceBalance",
  "roughness",
]);

export const CREATURAZOID_MODULATION_SHAPES = Object.freeze([
  "sine",
  "triangle",
  "square",
  "sample-hold",
]);

export const CREATURAZOID_GESTURE_TYPES = Object.freeze([
  "vocal",
  "percussive",
]);

const ARTICULATION_LIMITS = Object.freeze({
  pressure: Object.freeze([0, 1]),
  airwayGate: Object.freeze([0, 1]),
  voicing: Object.freeze([0, 1]),
  turbulence: Object.freeze([0, 1.5]),
  burstGain: Object.freeze([0, 1.5]),
  burstFrequencyHz: Object.freeze([80, 12_000]),
  flutterHz: Object.freeze([0, 60]),
  flutterDepth: Object.freeze([0, 1]),
  sourceGain: Object.freeze([0, 1.5]),
  flowDirection: Object.freeze([-1, 1]),
});

const ARTICULATION_DEFAULTS = Object.freeze({
  pressure: 1,
  airwayGate: 1,
  voicing: 1,
  turbulence: 0,
  burstGain: 0,
  burstFrequencyHz: 1_050,
  flutterHz: 0,
  flutterDepth: 0,
  sourceGain: 1,
  flowDirection: 1,
});

function freezeArticulationCurve(value, name) {
  const [minimum, maximum] = ARTICULATION_LIMITS[name];
  const fallback = ARTICULATION_DEFAULTS[name];
  const points = Array.isArray(value) && Array.isArray(value[0])
    ? value
    : [[0, finiteOr(value, fallback)], [1, finiteOr(value, fallback)]];
  return Object.freeze(points
    .map(([phase, amount]) => Object.freeze([
      clamp(phase),
      clamp(finiteOr(amount, fallback), minimum, maximum),
    ]))
    .sort((left, right) => left[0] - right[0]));
}

function freezeContact(contact) {
  if (!contact || typeof contact !== "object") return null;
  const strikes = Array.isArray(contact.strikes) ? contact.strikes : [];
  const scrapeGain = Array.isArray(contact.scrapeGain) ? contact.scrapeGain : [[0, 0], [1, 0]];
  return Object.freeze({
    kind: String(contact.kind ?? "impact"),
    gain: clamp(finiteOr(contact.gain, 1), 0, 1.5),
    brightness: clamp(finiteOr(contact.brightness, 0.5)),
    scrapeNoiseMix: clamp(finiteOr(contact.scrapeNoiseMix, 0.18), 0, 0.45),
    scrapeRateHz: clamp(finiteOr(contact.scrapeRateHz, 0), 0, 60),
    scrapeGain: Object.freeze(scrapeGain.map(([phase, amount]) => Object.freeze([
      clamp(phase),
      clamp(finiteOr(amount, 0), 0, 1.5),
    ])).sort((left, right) => left[0] - right[0])),
    strikes: Object.freeze(strikes.map((strike = {}) => Object.freeze({
      phase: clamp(finiteOr(strike.phase, 0)),
      gain: clamp(finiteOr(strike.gain, 1), 0, 1.5),
      modeRatio: clamp(finiteOr(strike.modeRatio, 1), 0.25, 16),
      noiseMix: clamp(finiteOr(strike.noiseMix, 0.5)),
      decayMs: clamp(finiteOr(strike.decayMs, 120), 15, 600),
      pan: clamp(finiteOr(strike.pan, 0), -1, 1),
    })).sort((left, right) => left.phase - right.phase)),
  });
}

function defineArticulation({ id, mechanism, motion, contact = null, ...curves }) {
  return Object.freeze({
    id,
    mechanism,
    motion,
    contact: freezeContact(contact),
    curves: Object.freeze(Object.fromEntries(Object.keys(ARTICULATION_LIMITS).map((name) => [
      name,
      freezeArticulationCurve(curves[name] ?? ARTICULATION_DEFAULTS[name], name),
    ]))),
  });
}

// These gestures remain acoustic rather than sampled. Hooves, jaws, feathers,
// paws, tongues, and breath drive the same airway closure, turbulence, burst,
// and cavity mechanisms used by the physical voice below.
const CREATURAZOID_ARTICULATIONS = Object.freeze({
  neigh: defineArticulation({
    id: "neigh", mechanism: "compressed whinny with a hard glottal release", motion: "neigh",
    pressure: [[0, 0.28], [0.018, 1], [0.1, 0.54], [0.22, 0.96], [0.48, 0.62], [0.76, 0.9], [1, 0]],
    airwayGate: [[0, 0.02], [0.026, 0.02], [0.045, 1], [1, 1]],
    voicing: [[0, 0.58], [0.05, 1], [0.82, 0.76], [1, 0]],
    turbulence: [[0, 0.16], [0.16, 0.06], [0.78, 0.2], [1, 0]],
    burstGain: [[0, 0.7], [0.05, 0.7], [0.08, 0], [1, 0]],
    burstFrequencyHz: [[0, 920], [1, 1_480]],
  }),
  hiss: defineArticulation({
    id: "hiss", mechanism: "unvoiced feline oral turbulence", motion: "hiss",
    pressure: [[0, 0], [0.035, 0.72], [0.18, 1], [0.78, 0.86], [1, 0]],
    airwayGate: [[0, 0.28], [0.08, 0.42], [0.72, 0.3], [1, 0.72]],
    voicing: 0,
    turbulence: [[0, 0], [0.04, 0.9], [0.72, 0.76], [1, 0]],
    burstFrequencyHz: 6_800,
    sourceGain: 0,
  }),
  stomp: defineArticulation({
    id: "stomp", mechanism: "hoof impact coupled into the chest cavity", motion: "stomp",
    contact: { kind: "hoof", gain: 1.3, brightness: 0.12, strikes: [
      { phase: 0, gain: 1, modeRatio: 0.62, noiseMix: 0.18, decayMs: 220 },
      { phase: 0.09, gain: 0.38, modeRatio: 1.8, noiseMix: 0.28, decayMs: 72 },
    ] },
    pressure: [[0, 1], [0.12, 0.84], [0.42, 0.26], [1, 0]],
    airwayGate: [[0, 0.02], [0.085, 0.02], [0.105, 1], [1, 1]],
    voicing: [[0, 0.08], [0.2, 0.02], [1, 0]],
    turbulence: [[0, 0.22], [0.16, 0.06], [1, 0]],
    burstGain: [[0, 1.5], [0.11, 1.5], [0.14, 0], [1, 0]],
    burstFrequencyHz: [[0, 86], [0.3, 118], [1, 82]],
    sourceGain: 0.12,
  }),
  horn: defineArticulation({
    id: "horn", mechanism: "startled elephant trumpet with a lip slap", motion: "horn",
    pressure: [[0, 0.36], [0.02, 1], [0.22, 0.76], [0.58, 0.94], [1, 0]],
    airwayGate: [[0, 0.025], [0.035, 0.025], [0.055, 1], [1, 1]],
    voicing: [[0, 0.72], [0.06, 1], [0.82, 0.88], [1, 0]],
    turbulence: [[0, 0.28], [0.12, 0.08], [0.86, 0.2], [1, 0]],
    burstGain: [[0, 0.92], [0.05, 0.92], [0.08, 0], [1, 0]],
    burstFrequencyHz: 460,
    sourceGain: 1.18,
  }),
  caw: defineArticulation({
    id: "caw", mechanism: "abrupt corvid beak-and-syrinx knock", motion: "caw",
    pressure: [[0, 0.48], [0.025, 1], [0.22, 0.62], [0.52, 0.82], [1, 0]],
    airwayGate: [[0, 0.03], [0.045, 0.03], [0.07, 1], [1, 1]],
    voicing: [[0, 0.35], [0.08, 0.92], [0.72, 0.54], [1, 0]],
    turbulence: [[0, 0.34], [0.18, 0.14], [1, 0]],
    burstGain: [[0, 0.76], [0.065, 0.76], [0.1, 0], [1, 0]],
    burstFrequencyHz: 1_760,
  }),
  bark: defineArticulation({
    id: "bark", mechanism: "sudden canine glottal-and-jaw burst", motion: "bark",
    pressure: [[0, 0.62], [0.018, 1], [0.18, 0.74], [0.62, 0.26], [1, 0]],
    airwayGate: [[0, 0.02], [0.045, 0.02], [0.075, 1], [1, 1]],
    voicing: [[0, 0.42], [0.08, 1], [0.62, 0.34], [1, 0]],
    turbulence: [[0, 0.45], [0.2, 0.12], [1, 0]],
    burstGain: [[0, 1.12], [0.07, 1.12], [0.11, 0], [1, 0]],
    burstFrequencyHz: 720,
    sourceGain: 1.14,
  }),
  claw: defineArticulation({
    id: "claw", mechanism: "repeating keratin claw scrapes", motion: "claw",
    contact: { kind: "claw", gain: 0.88, brightness: 0.52, scrapeNoiseMix: 0.12, scrapeRateHz: 17, scrapeGain: [[0, 0], [0.03, 1], [0.84, 0.72], [1, 0]], strikes: [
      { phase: 0.03, gain: 0.4, modeRatio: 5.5, noiseMix: 0.32, decayMs: 44, pan: -0.7 },
      { phase: 0.22, gain: 0.34, modeRatio: 7.2, noiseMix: 0.38, decayMs: 38, pan: 0.65 },
      { phase: 0.47, gain: 0.44, modeRatio: 6.1, noiseMix: 0.34, decayMs: 48, pan: -0.55 },
      { phase: 0.74, gain: 0.3, modeRatio: 8.4, noiseMix: 0.4, decayMs: 34, pan: 0.7 },
    ] },
    pressure: [[0, 0.28], [0.08, 0.82], [0.32, 0.5], [0.48, 0.94], [0.72, 0.55], [0.86, 0.84], [1, 0]],
    airwayGate: [[0, 0.24], [0.18, 0.48], [0.38, 0.2], [0.58, 0.52], [0.78, 0.18], [1, 0.7]],
    voicing: 0.18,
    turbulence: [[0, 0.08], [0.08, 0.46], [0.3, 0.18], [0.48, 0.52], [0.7, 0.16], [0.86, 0.42], [1, 0]],
    burstFrequencyHz: [[0, 4_800], [0.55, 7_200], [1, 3_600]],
    flutterHz: 22,
    flutterDepth: 0.34,
    sourceGain: 0.16,
  }),
  whip: defineArticulation({
    id: "whip", mechanism: "tail-driven air rush ending in a keratin crack", motion: "whip",
    contact: { kind: "tail", gain: 1.08, brightness: 0.58, scrapeNoiseMix: 0.08, scrapeRateHz: 7, scrapeGain: [[0, 0], [0.06, 0.2], [0.58, 1], [0.73, 0.08], [1, 0]], strikes: [
      { phase: 0.7, gain: 1.2, modeRatio: 7.2, noiseMix: 0.22, decayMs: 42, pan: 0.82 },
    ] },
    pressure: [[0, 0], [0.12, 0.38], [0.48, 0.92], [0.62, 1], [0.82, 0.3], [1, 0]],
    airwayGate: [[0, 0.82], [0.56, 0.32], [0.62, 0.02], [0.69, 0.02], [0.72, 1], [1, 1]],
    voicing: 0.14,
    turbulence: [[0, 0.04], [0.2, 0.22], [0.55, 0.48], [0.7, 0.1], [1, 0]],
    burstGain: [[0, 0], [0.58, 1.42], [0.72, 1.42], [0.75, 0], [1, 0]],
    burstFrequencyHz: [[0, 1_400], [0.7, 5_200], [1, 2_600]],
    sourceGain: 0.18,
  }),
  footsteps: defineArticulation({
    id: "footsteps", mechanism: "four alternating paw-and-hoof contacts", motion: "footsteps",
    contact: { kind: "feet", gain: 1.04, brightness: 0.15, strikes: [
      { phase: 0, gain: 0.78, modeRatio: 0.72, noiseMix: 0.18, decayMs: 150, pan: -0.5 },
      { phase: 0.24, gain: 1, modeRatio: 0.88, noiseMix: 0.16, decayMs: 180, pan: 0.5 },
      { phase: 0.48, gain: 0.72, modeRatio: 0.68, noiseMix: 0.2, decayMs: 140, pan: -0.42 },
      { phase: 0.72, gain: 0.94, modeRatio: 0.82, noiseMix: 0.18, decayMs: 170, pan: 0.42 },
    ] },
    pressure: [[0, 0.92], [0.14, 0.18], [0.24, 0.88], [0.38, 0.16], [0.48, 1], [0.62, 0.18], [0.72, 0.82], [0.88, 0.14], [1, 0]],
    airwayGate: [[0, 0.02], [0.045, 0.02], [0.065, 1], [0.22, 1], [0.24, 0.02], [0.285, 0.02], [0.305, 1], [0.46, 1], [0.48, 0.02], [0.525, 0.02], [0.545, 1], [0.7, 1], [0.72, 0.02], [0.765, 0.02], [0.785, 1], [1, 1]],
    voicing: 0.12,
    turbulence: [[0, 0.15], [0.14, 0], [0.24, 0.12], [0.38, 0], [0.48, 0.15], [0.62, 0], [0.72, 0.12], [0.88, 0], [1, 0]],
    burstGain: 1.28,
    burstFrequencyHz: [[0, 118], [0.3, 96], [0.55, 132], [0.8, 88], [1, 80]],
    sourceGain: 0.12,
  }),
  ruffle: defineArticulation({
    id: "ruffle", mechanism: "layered feather-vane flutter", motion: "ruffle",
    contact: { kind: "feather", gain: 0.34, brightness: 0.2, scrapeNoiseMix: 0.025, scrapeRateHz: 19, scrapeGain: [[0, 0], [0.04, 0.62], [0.22, 0.38], [0.4, 0.76], [0.62, 0.34], [0.78, 0.64], [1, 0]], strikes: [] },
    pressure: [[0, 0], [0.06, 0.62], [0.28, 0.86], [0.55, 0.48], [0.76, 0.9], [1, 0]],
    airwayGate: [[0, 0.46], [0.32, 0.7], [0.62, 0.38], [1, 0.74]],
    voicing: 0.58,
    turbulence: [[0, 0], [0.05, 0.065], [0.22, 0.03], [0.38, 0.075], [0.58, 0.025], [0.76, 0.06], [1, 0]],
    burstFrequencyHz: 3_600,
    flutterHz: [[0, 13], [0.5, 24], [1, 9]],
    flutterDepth: [[0, 0.42], [0.5, 0.82], [1, 0]],
    sourceGain: 0.42,
  }),
  pant: defineArticulation({
    id: "pant", mechanism: "four short open-mouth breath pulses", motion: "pant",
    pressure: [[0, 0.12], [0.06, 0.86], [0.18, 0.1], [0.3, 0.92], [0.42, 0.1], [0.54, 1], [0.66, 0.1], [0.78, 0.82], [0.92, 0.08], [1, 0]],
    airwayGate: [[0, 0.36], [0.08, 0.96], [0.2, 0.38], [0.32, 0.98], [0.44, 0.36], [0.56, 1], [0.68, 0.38], [0.8, 0.96], [1, 0.5]],
    voicing: 0.38,
    turbulence: [[0, 0.04], [0.06, 0.2], [0.18, 0.02], [0.3, 0.22], [0.42, 0.02], [0.54, 0.24], [0.66, 0.02], [0.78, 0.19], [0.94, 0], [1, 0]],
    burstFrequencyHz: 1_900,
    flutterHz: 7,
    flutterDepth: 0.18,
    sourceGain: 0.3,
  }),
  lap: defineArticulation({
    id: "lap", mechanism: "repeating tongue-and-palate wet clicks", motion: "lap",
    contact: { kind: "wet", gain: 0.72, brightness: 0.28, strikes: [
      { phase: 0.06, gain: 0.82, modeRatio: 1.25, noiseMix: 0.16, decayMs: 72, pan: -0.2 },
      { phase: 0.3, gain: 0.94, modeRatio: 1.4, noiseMix: 0.14, decayMs: 68, pan: 0.2 },
      { phase: 0.54, gain: 1, modeRatio: 1.16, noiseMix: 0.18, decayMs: 76, pan: -0.16 },
      { phase: 0.78, gain: 0.88, modeRatio: 1.32, noiseMix: 0.16, decayMs: 70, pan: 0.16 },
    ] },
    pressure: [[0, 0.82], [0.16, 0.12], [0.24, 0.9], [0.4, 0.12], [0.48, 0.96], [0.64, 0.12], [0.72, 0.86], [0.9, 0.08], [1, 0]],
    airwayGate: [[0, 0.02], [0.055, 0.02], [0.075, 0.86], [0.22, 0.86], [0.24, 0.02], [0.295, 0.02], [0.315, 0.88], [0.46, 0.88], [0.48, 0.02], [0.535, 0.02], [0.555, 0.9], [0.7, 0.9], [0.72, 0.02], [0.775, 0.02], [0.795, 0.88], [1, 0.88]],
    voicing: 0.18,
    turbulence: [[0, 0.08], [0.08, 0.22], [0.2, 0.02], [0.32, 0.24], [0.44, 0.02], [0.56, 0.24], [0.68, 0.02], [0.8, 0.2], [1, 0]],
    burstGain: 0.88,
    burstFrequencyHz: [[0, 1_260], [0.5, 1_820], [1, 980]],
    sourceGain: 0.18,
  }),
  crunch: defineArticulation({
    id: "crunch", mechanism: "irregular tooth fractures and jaw grit", motion: "crunch",
    contact: { kind: "teeth", gain: 0.98, brightness: 0.42, scrapeNoiseMix: 0.1, scrapeRateHz: 11, scrapeGain: [[0, 0.2], [0.08, 0.64], [0.72, 0.42], [1, 0]], strikes: [
      { phase: 0, gain: 1, modeRatio: 3, noiseMix: 0.28, decayMs: 72 },
      { phase: 0.27, gain: 0.76, modeRatio: 5, noiseMix: 0.32, decayMs: 46, pan: -0.18 },
      { phase: 0.56, gain: 1.14, modeRatio: 2.5, noiseMix: 0.24, decayMs: 88, pan: 0.15 },
      { phase: 0.82, gain: 0.62, modeRatio: 4.2, noiseMix: 0.34, decayMs: 38 },
    ] },
    pressure: [[0, 0.96], [0.14, 0.28], [0.27, 0.86], [0.43, 0.22], [0.56, 1], [0.72, 0.24], [0.82, 0.72], [1, 0]],
    airwayGate: [[0, 0.02], [0.07, 0.02], [0.09, 1], [0.25, 1], [0.27, 0.02], [0.34, 0.02], [0.36, 1], [0.54, 1], [0.56, 0.02], [0.63, 0.02], [0.65, 1], [0.8, 1], [0.82, 0.02], [0.87, 0.02], [0.89, 1], [1, 1]],
    voicing: 0.22,
    turbulence: [[0, 0.28], [0.18, 0.08], [0.3, 0.36], [0.46, 0.08], [0.58, 0.42], [0.74, 0.08], [0.84, 0.32], [1, 0]],
    burstGain: [[0, 1.22], [0.4, 0.92], [0.68, 1.48], [1, 0.72]],
    burstFrequencyHz: [[0, 1_300], [0.35, 2_600], [0.68, 900], [1, 2_200]],
    sourceGain: 0.22,
  }),
  jump: defineArticulation({
    id: "jump", mechanism: "launch compression followed by a landing thump", motion: "jump",
    contact: { kind: "landing", gain: 1.2, brightness: 0.12, strikes: [
      { phase: 0, gain: 0.46, modeRatio: 0.82, noiseMix: 0.2, decayMs: 130, pan: -0.14 },
      { phase: 0.8, gain: 1.2, modeRatio: 0.52, noiseMix: 0.24, decayMs: 260, pan: 0.12 },
    ] },
    pressure: [[0, 0.94], [0.16, 0.26], [0.5, 0.08], [0.74, 0.22], [0.79, 1], [0.92, 0.2], [1, 0]],
    airwayGate: [[0, 0.02], [0.065, 0.02], [0.09, 1], [0.74, 1], [0.76, 0.02], [0.825, 0.02], [0.85, 1], [1, 1]],
    voicing: [[0, 0.18], [0.18, 0.08], [0.72, 0.04], [0.88, 0.16], [1, 0]],
    turbulence: [[0, 0.2], [0.16, 0.04], [0.7, 0.02], [0.8, 0.2], [1, 0]],
    burstGain: [[0, 1.18], [0.2, 0], [0.72, 0], [0.84, 1.5], [1, 0]],
    burstFrequencyHz: [[0, 142], [0.5, 260], [0.82, 92], [1, 80]],
    sourceGain: 0.16,
  }),
});

const EMPTY_MORPH_BIAS = Object.freeze(Object.fromEntries(
  CREATURAZOID_MORPH_CONTROLS.map((name) => [name, 0]),
));

const freezeMorphBias = (source = {}) => Object.freeze(Object.fromEntries(
  CREATURAZOID_MORPH_CONTROLS.map((name) => [
    name,
    clamp(finiteOr(source?.[name], 0), -1, 1),
  ]),
));

// Robust output calibration from 400 deterministic renders: every gesture in
// every persistent body, measured as its maximum sliding 50 ms stereo RMS
// after rhythmic cropping and physical contact mixing. Quiet medians rise
// toward 0.14; a worst-body safety pass reins in resonant outliers. This gain
// remains upstream of the shared compressor and independent of step velocity.
const CREATURAZOID_LEVEL_MAKEUP = Object.freeze({
  roar: 1,
  chuff: 1,
  howl: 1,
  yip: 1,
  bark: 1,
  growl: 1,
  rumble: 2.36,
  bellow: 1,
  gator: 1,
  purr: 6.8,
  whinny: 1,
  nicker: 1.31,
  cervid: 1,
  harsh: 1,
  moose: 1,
  moan: 1,
  whoop: 1,
  giggle: 1,
  grunt: 1.57,
  moo: 0.69,
  lowmoo: 2.22,
  croak: 3.4,
  rattle: 4.05,
  coo: 4.08,
  double: 3.23,
  hoot: 3.26,
  owlpair: 3.78,
  trill: 4.77,
  phrase: 3.96,
  boom: 0.63,
  gunk: 1,
  chirp: 0.36,
  frogtrill: 0.37,
  sweep: 1.7,
  ticks: 3.05,
  trumpet: 1,
  neigh: 1,
  hiss: 6.81,
  "hoof-stomp": 1.32,
  "horn-surprise": 1,
  caw: 7,
  "snap-bark": 1,
  clawing: 3.23,
  "tail-whip": 2.93,
  footsteps: 1,
  "feather-ruffle": 5.75,
  panting: 4.29,
  lapping: 4.63,
  crunching: 1.75,
  jumping: 1,
});

// Two extreme resonators still contain family-specific nulls after the global
// sound calibration. These compact corrections were measured separately so a
// Pocket Needle purr or a Split Chamber frog does not vanish, while the other
// six bodies and louder calls retain their natural contrast.
const CREATURAZOID_BODY_FAMILY_LEVEL_TRIM = Object.freeze({
  "pocket-needle": Object.freeze({ mammal: 1.25 }),
});

const CREATURAZOID_BODY_SOUND_LEVEL_TRIM = Object.freeze({
  "pocket-needle": Object.freeze({
    purr: 3,
    rumble: 1.9,
    trumpet: 1.82,
    nicker: 1.35,
    lowmoo: 1.34,
    "horn-surprise": 1.36,
  }),
  "split-chamber": Object.freeze({
    chirp: 1.5,
    frogtrill: 1.45,
    purr: 1.25,
  }),
  // The jet's cropped edge lands directly on very efficient, lightly built
  // resonators in these two bodies; attenuate only that pairing rather than
  // holding every quieter body below the audible onset floor.
  "elastic-tower": Object.freeze({ ticks: 0.55 }),
  "paper-giant": Object.freeze({ ticks: 0.88, "feather-ruffle": 2.1 }),
  "long-hollow": Object.freeze({ "feather-ruffle": 1.2 }),
});

function defineSound({
  animalId,
  callId,
  articulationId = null,
  durationMs = null,
  sequenceOnsetPhase = null,
  ...sound
}) {
  const animal = ANIMALS[animalId];
  const gesture = CALL_GESTURES[callId];
  const articulation = articulationId ? CREATURAZOID_ARTICULATIONS[articulationId] : null;
  if (!animal || !gesture || !animal.callIds.includes(callId)) {
    throw new TypeError(`Invalid Creaturazoid source pairing: ${animalId}/${callId}`);
  }
  if (articulationId && !articulation) {
    throw new TypeError(`Invalid Creaturazoid articulation: ${articulationId}`);
  }
  const resolvedDurationMs = integerInRange(
    durationMs == null ? gesture.durationMs : durationMs,
    gesture.durationMs,
    80,
    3_200,
  );
  return Object.freeze({
    ...sound,
    animalId,
    callId,
    family: animal.model,
    gestureType: articulation ? "percussive" : "vocal",
    articulation,
    durationMs: resolvedDurationMs,
    sequenceOnsetPhase: sequenceOnsetPhase == null
      ? null
      : clamp(finiteOr(sequenceOnsetPhase, 0), 0, 0.9),
    levelMakeup: clamp(CREATURAZOID_LEVEL_MAKEUP[sound.id] ?? 1, 0.36, 7),
    // Hiccup semantics: the onset owns one column and the gesture sounds
    // through following rest columns until the next onset retargets the body.
    recommendedSpaceSteps: integerInRange(
      sound.recommendedSpaceSteps,
      Math.ceil(resolvedDurationMs / (15_000 / 84)),
      1,
      16,
    ),
    pitchSemitones: clamp(sound.pitchSemitones ?? 0, -24, 24),
    timbre: clamp(sound.timbre ?? 0, -1, 1),
  });
}

// One key summons one complete Hybrinx animal/call identity. Mammals remain
// the largest body family, while lower-register bird calls and four compact
// verified gestures provide enough vocabulary for rhythmic cross-family cuts.
export const CREATURAZOID_SOUNDS = Object.freeze([
  defineSound({ id: "roar", label: "ROAR", key: "1", color: "#ff7b6f", animalId: "lion", callId: "lion-roar", pitchSemitones: 0, timbre: -0.32 }),
  defineSound({ id: "chuff", label: "CHUFF", key: "2", color: "#ffcf68", animalId: "lion", callId: "lion-grunt", pitchSemitones: 3, timbre: 0.12 }),
  defineSound({ id: "howl", label: "HOWL", key: "3", color: "#64cfff", animalId: "wolf", callId: "wolf-howl", pitchSemitones: 1, timbre: -0.05 }),
  defineSound({ id: "yip", label: "YIP", key: "z", color: "#ff5f87", animalId: "wolf", callId: "wolf-yip", pitchSemitones: -3, timbre: 0.36 }),
  defineSound({ id: "bark", label: "BARK", key: "4", color: "#ff7b6f", animalId: "dog", callId: "dog-bark", pitchSemitones: 4, timbre: 0.18 }),
  defineSound({ id: "growl", label: "GROWL", key: "8", color: "#d08cff", animalId: "dog", callId: "dog-growl", pitchSemitones: -3, timbre: -0.55 }),
  defineSound({ id: "rumble", label: "RUMBLE", key: "9", color: "#59f1df", animalId: "elephant", callId: "elephant-rumble", pitchSemitones: 2, timbre: -0.62 }),
  defineSound({ id: "bellow", label: "BELLOW", key: "0", color: "#baff54", animalId: "alligator", callId: "alligator-bellow", pitchSemitones: 0, timbre: -0.48 }),
  defineSound({ id: "gator", label: "GATOR", key: "t", color: "#e3ff9f", animalId: "alligator", callId: "alligator-grunt", pitchSemitones: 4, timbre: -0.22 }),
  defineSound({ id: "purr", label: "PURR", key: "5", color: "#ff5f87", animalId: "cat", callId: "cat-purr", pitchSemitones: -2, timbre: -0.4 }),
  defineSound({ id: "whinny", label: "WHINNY", key: "6", color: "#ffcf68", animalId: "horse", callId: "horse-whinny", pitchSemitones: 3, timbre: 0.24 }),
  defineSound({ id: "nicker", label: "NICKER", key: "y", color: "#ff7b6f", animalId: "horse", callId: "horse-nicker", pitchSemitones: 1, timbre: -0.16 }),
  defineSound({ id: "cervid", label: "CERVID", key: "i", color: "#e3ff9f", animalId: "reddeer", callId: "reddeer-common-roar", pitchSemitones: 0, timbre: -0.24 }),
  defineSound({ id: "harsh", label: "HARSH", key: "o", color: "#d08cff", animalId: "reddeer", callId: "reddeer-harsh-roar", pitchSemitones: 2, timbre: -0.58 }),
  defineSound({ id: "moose", label: "MOOSE", key: "g", color: "#baff54", animalId: "moose", callId: "moose-bull-grunt", pitchSemitones: 0, timbre: -0.38 }),
  defineSound({ id: "moan", label: "MOAN", key: "h", color: "#b6fff5", animalId: "moose", callId: "moose-cow-moan", pitchSemitones: -2, timbre: -0.52 }),
  defineSound({ id: "whoop", label: "WHOOP", key: "p", color: "#64cfff", animalId: "hyena", callId: "hyena-whoop", pitchSemitones: 1, timbre: -0.15 }),
  defineSound({ id: "giggle", label: "GIGGLE", key: "a", color: "#ff5f87", animalId: "hyena", callId: "hyena-giggle", pitchSemitones: 4, timbre: 0.18 }),
  defineSound({ id: "grunt", label: "GRUNT", key: "s", color: "#ff7b6f", animalId: "wildboar", callId: "wildboar-grunt", pitchSemitones: 2, timbre: -0.36 }),
  defineSound({ id: "moo", label: "MOO", key: "d", color: "#ffcf68", animalId: "cow", callId: "cow-moo", pitchSemitones: -1, timbre: -0.32 }),
  defineSound({ id: "lowmoo", label: "LOW MOO", key: "f", color: "#baff54", animalId: "cow", callId: "cow-contact", pitchSemitones: -3, timbre: -0.5 }),
  defineSound({ id: "croak", label: "CROAK", key: "7", color: "#64cfff", animalId: "raven", callId: "raven-croak", pitchSemitones: 1, timbre: -0.08 }),
  defineSound({ id: "rattle", label: "RATTLE", key: "j", color: "#59f1df", animalId: "raven", callId: "raven-rattle", pitchSemitones: 4, timbre: 0.3 }),
  defineSound({ id: "coo", label: "COO", key: "q", color: "#d08cff", animalId: "dove", callId: "dove-coo", pitchSemitones: 0, timbre: -0.18 }),
  defineSound({ id: "double", label: "DOUBLE", key: "k", color: "#ff5f87", animalId: "dove", callId: "dove-double", pitchSemitones: 3, timbre: 0.12 }),
  defineSound({ id: "hoot", label: "HOOT", key: "w", color: "#ffcf68", animalId: "owl", callId: "owl-hoot", pitchSemitones: -1, timbre: -0.3 }),
  defineSound({ id: "owlpair", label: "OWL 2", key: "l", color: "#e3ff9f", animalId: "owl", callId: "owl-double", pitchSemitones: 2, timbre: -0.02 }),
  defineSound({ id: "trill", label: "CHIRR", key: "c", color: "#baff54", animalId: "songbird", callId: "songbird-trill", pitchSemitones: -24, timbre: 0.34 }),
  defineSound({ id: "phrase", label: "PHRASE", key: "b", color: "#59f1df", animalId: "songbird", callId: "songbird-phrase", pitchSemitones: -20, timbre: 0.24 }),
  defineSound({ id: "boom", label: "BOOM", key: "e", color: "#64cfff", animalId: "bullfrog", callId: "bullfrog-call", pitchSemitones: 0, timbre: -0.38 }),
  defineSound({ id: "gunk", label: "GUNK", key: "r", color: "#baff54", animalId: "bullfrog", callId: "bullfrog-grunt", pitchSemitones: 4, timbre: 0.14 }),
  defineSound({ id: "chirp", label: "CHIRP", key: "x", color: "#ffcf68", animalId: "treefrog", callId: "treefrog-chirp", pitchSemitones: -24, timbre: 0.46 }),
  defineSound({ id: "frogtrill", label: "RIPPLE", key: "n", color: "#59f1df", animalId: "treefrog", callId: "treefrog-trill", pitchSemitones: -20, timbre: 0.3 }),
  defineSound({ id: "sweep", label: "JET", key: "u", color: "#d08cff", animalId: "mouse", callId: "mouse-sweep", pitchSemitones: -24, timbre: 0.38 }),
  defineSound({ id: "ticks", label: "TICKS", key: "v", color: "#64cfff", animalId: "mouse", callId: "mouse-steps", pitchSemitones: -24, timbre: 0.5 }),
  defineSound({ id: "trumpet", label: "BLARE", key: "m", color: "#ff7b6f", animalId: "elephant", callId: "elephant-trumpet", pitchSemitones: -4, timbre: 0.12 }),
  defineSound({ id: "neigh", label: "NEIGH", key: "!", color: "#ffcf68", animalId: "horse", callId: "horse-whinny", articulationId: "neigh", durationMs: 980, sequenceOnsetPhase: 0.045, pitchSemitones: 1, timbre: 0.2 }),
  defineSound({ id: "hiss", label: "HISS", key: "@", color: "#59f1df", animalId: "cat", callId: "cat-purr", articulationId: "hiss", durationMs: 520, sequenceOnsetPhase: 0.035, pitchSemitones: 2, timbre: 0.7 }),
  defineSound({ id: "hoof-stomp", label: "STOMP", key: "#", color: "#baff54", animalId: "horse", callId: "horse-nicker", articulationId: "stomp", durationMs: 240, sequenceOnsetPhase: 0, pitchSemitones: -12, timbre: -0.84 }),
  defineSound({ id: "horn-surprise", label: "HORN!", key: "$", color: "#ff7b6f", animalId: "elephant", callId: "elephant-trumpet", articulationId: "horn", durationMs: 620, sequenceOnsetPhase: 0.055, pitchSemitones: 1, timbre: 0.36 }),
  defineSound({ id: "caw", label: "CAW", key: "%", color: "#64cfff", animalId: "raven", callId: "raven-croak", articulationId: "caw", durationMs: 360, sequenceOnsetPhase: 0.07, pitchSemitones: -3, timbre: -0.2 }),
  defineSound({ id: "snap-bark", label: "BARK!", key: "^", color: "#ff5f87", animalId: "dog", callId: "dog-bark", articulationId: "bark", durationMs: 190, sequenceOnsetPhase: 0.075, pitchSemitones: -2, timbre: -0.18 }),
  defineSound({ id: "clawing", label: "CLAW", key: "&", color: "#ffcf68", animalId: "cat", callId: "cat-purr", articulationId: "claw", durationMs: 540, sequenceOnsetPhase: 0.03, pitchSemitones: 7, timbre: 0.76 }),
  defineSound({ id: "tail-whip", label: "TAILWHIP", key: "*", color: "#d08cff", animalId: "lion", callId: "lion-grunt", articulationId: "whip", durationMs: 340, sequenceOnsetPhase: 0.58, pitchSemitones: 8, timbre: 0.62 }),
  defineSound({ id: "footsteps", label: "STEPS", key: "(", color: "#baff54", animalId: "horse", callId: "horse-nicker", articulationId: "footsteps", durationMs: 760, sequenceOnsetPhase: 0, pitchSemitones: -10, timbre: -0.72 }),
  defineSound({ id: "feather-ruffle", label: "RUFFLE", key: ")", color: "#59f1df", animalId: "raven", callId: "raven-rattle", articulationId: "ruffle", durationMs: 680, sequenceOnsetPhase: 0.04, pitchSemitones: -2, timbre: 0.72 }),
  defineSound({ id: "panting", label: "PANT", key: "-", color: "#ff7b6f", animalId: "dog", callId: "dog-bark", articulationId: "pant", durationMs: 860, sequenceOnsetPhase: 0.06, pitchSemitones: -5, timbre: 0.34 }),
  defineSound({ id: "lapping", label: "LAP", key: "=", color: "#ff5f87", animalId: "cat", callId: "cat-purr", articulationId: "lap", durationMs: 720, sequenceOnsetPhase: 0.06, pitchSemitones: 3, timbre: 0.48 }),
  defineSound({ id: "crunching", label: "CRUNCH", key: "[", color: "#e3ff9f", animalId: "wildboar", callId: "wildboar-grunt", articulationId: "crunch", durationMs: 560, sequenceOnsetPhase: 0, pitchSemitones: -1, timbre: 0.42 }),
  defineSound({ id: "jumping", label: "JUMP", key: "]", color: "#ffcf68", animalId: "bullfrog", callId: "bullfrog-grunt", articulationId: "jump", durationMs: 620, sequenceOnsetPhase: 0, pitchSemitones: -8, timbre: -0.4 }),
]);

const soundById = new Map(CREATURAZOID_SOUNDS.map((sound) => [sound.id, sound]));
const soundByKey = new Map(CREATURAZOID_SOUNDS.map((sound) => [sound.key, sound]));

export const CREATURAZOID_PERCUSSIVE_SOUND_IDS = Object.freeze(
  CREATURAZOID_SOUNDS.filter(({ gestureType }) => gestureType === "percussive").map(({ id }) => id),
);

// The drawing layer may use these normalized anatomical proportions directly.
// Mobile pinnae join the horn crowns, feather vanes, exposed breath organs,
// and extensible neck; bony orbital shelves replace cartoon eyebrows.
export const CREATURAZOID_ANATOMY_DESIGNS = Object.freeze([
  Object.freeze({
    id: "scapular-wings",
    label: "Crown horns + scapular plumage + mobile pinnae",
    description: "Paired crown horns and mobile pinnae recoil above a mammalian skull while feathered forelimbs flare from the visible pectoral girdle.",
    structures: Object.freeze(["crown horns", "mobile pinnae", "pectoral girdle", "primary flight feathers", "extensible laryngeal tract"]),
    proportions: Object.freeze({ wingSpan: 0.96, wingSweep: 0.48, beakLength: 0.42, cheekVolume: 0.24, throatVolume: 0.72, toothExposure: 0.34 }),
  }),
  Object.freeze({
    id: "branchial-mantle",
    label: "Lateral horns + branchial fan + ear valves",
    description: "Lateral horn scoops and broad ear valves bracket opercular cheeks, a resonant throat sac, and a compact fan of secondary feathers.",
    structures: Object.freeze(["lateral horns", "ear valves", "opercular folds", "secondary feathers", "inflatable vocal sac"]),
    proportions: Object.freeze({ wingSpan: 0.7, wingSweep: 0.22, beakLength: 0.3, cheekVolume: 0.62, throatVolume: 0.94, toothExposure: 0.22 }),
  }),
  Object.freeze({
    id: "costal-glider",
    label: "Antler forks + costal feathers + pinnae",
    description: "Forked antlers, directional pinnae, and rib-mounted flight feathers expose an oversized lung pair beneath a long feeding neck.",
    structures: Object.freeze(["forked antlers", "directional pinnae", "costal feather rays", "inflatable lung pair", "nasal capsule"]),
    proportions: Object.freeze({ wingSpan: 0.86, wingSweep: 0.76, beakLength: 0.24, cheekVolume: 0.18, throatVolume: 0.58, toothExposure: 0.28 }),
  }),
]);

const anatomyDesignById = new Map(CREATURAZOID_ANATOMY_DESIGNS.map((design) => [design.id, design]));

export function creaturazoidSound(id) {
  return soundById.get(String(id ?? "")) ?? CREATURAZOID_SOUNDS[0];
}

const MEAN_MOUTH_SOUNDS = new Set([
  "roar", "growl", "gator", "harsh", "bark", "snap-bark", "hiss", "cervid", "grunt",
]);
const HAPPY_MOUTH_SOUNDS = new Set([
  "yip", "giggle", "purr", "whoop", "double", "frogtrill",
]);
const HUNGRY_MOUTH_SOUNDS = new Set([
  "lapping", "crunching", "chuff", "nicker", "panting",
]);
const GOBSMACKED_MOUTH_SOUNDS = new Set([
  "horn-surprise", "trumpet", "hoot", "owlpair", "boom", "jumping",
]);
const HOWLING_MOUTH_SOUNDS = new Set([
  "howl", "moan", "bellow", "neigh", "whinny", "moo", "lowmoo",
]);

/**
 * Resolve distinct facial mechanics from a sound identity. Channels remain
 * independent so an owl may be both open-beaked and shocked, while a caw
 * keeps its bill geometry without borrowing a mammal smile.
 */
export function creaturazoidMouthExpression(soundOrId) {
  const sound = soundOrId && typeof soundOrId === "object"
    ? creaturazoidSound(soundOrId.id ?? soundOrId.soundId)
    : creaturazoidSound(soundOrId);
  const mean = Number(MEAN_MOUTH_SOUNDS.has(sound.id));
  const happy = Number(HAPPY_MOUTH_SOUNDS.has(sound.id));
  const hungry = Number(HUNGRY_MOUTH_SOUNDS.has(sound.id));
  const gobsmacked = Number(GOBSMACKED_MOUTH_SOUNDS.has(sound.id));
  const howl = Number(HOWLING_MOUTH_SOUNDS.has(sound.id));
  const openBeak = Number(sound.family === "bird");
  const kind = mean
    ? "mean"
    : happy
      ? "happy"
      : hungry
        ? "hungry"
        : howl
          ? "howl"
          : gobsmacked
            ? "gobsmacked"
            : openBeak
              ? "open-beak"
              : "neutral";
  return Object.freeze({ kind, mean, happy, hungry, gobsmacked, howl, openBeak });
}

export function creaturazoidSoundForKey(key) {
  return soundByKey.get(String(key ?? "").toLowerCase()) ?? null;
}

export function creaturazoidArticulationAt(soundOrId, normalizedPhase = 0) {
  const sound = typeof soundOrId === "object"
    ? creaturazoidSound(soundOrId.id ?? soundOrId.soundId)
    : creaturazoidSound(soundOrId);
  const phase = clamp(normalizedPhase);
  const articulation = sound.articulation;
  const sampled = Object.fromEntries(Object.keys(ARTICULATION_LIMITS).map((name) => [
    name,
    articulation
      ? sampleGestureCurve(articulation.curves[name], phase)
      : ARTICULATION_DEFAULTS[name],
  ]));
  return Object.freeze({
    ...sampled,
    id: articulation?.id ?? "voice",
    mechanism: articulation?.mechanism ?? "voiced animal call",
    motion: articulation?.motion ?? "vocal",
    contact: articulation?.contact ?? null,
    gestureType: sound.gestureType,
  });
}

export function creaturazoidRecommendedSpaceSteps(soundOrId, tempo = 84) {
  const sound = typeof soundOrId === "object"
    ? creaturazoidSound(soundOrId.id ?? soundOrId.soundId)
    : creaturazoidSound(soundOrId);
  const bpm = clamp(tempo, ...CREATURAZOID_LIMITS.tempo);
  const stepDurationMs = 15_000 / bpm;
  return integerInRange(
    Math.ceil(sound.durationMs / stepDurationMs),
    sound.recommendedSpaceSteps,
    1,
    16,
  );
}

const DEFAULT_TRACT_DIAMETER_PROFILE = Object.freeze([0.7, 0.84, 1, 1.08, 1.02, 0.9, 0.78, 0.68]);

const freezeEnvelopePoints = (points = [], speed = false) => Object.freeze(
  points.map(([phase, value]) => Object.freeze([
    clamp(phase),
    speed ? clamp(value, 0.02, 30) : clamp(value),
  ])),
);

const freezeBodyModulations = (modulations = []) => Object.freeze(modulations.map((modulation) => (
  Object.freeze({
    target: CREATURAZOID_MORPH_CONTROLS.includes(modulation?.target)
      ? modulation.target
      : "tension",
    shape: CREATURAZOID_MODULATION_SHAPES.includes(modulation?.shape)
      ? modulation.shape
      : "sine",
    phase: finiteOr(modulation?.phase, 0),
    speed: freezeEnvelopePoints(modulation?.speed ?? [[0, 2], [1, 2]], true),
    depth: freezeEnvelopePoints(modulation?.depth ?? [[0, 0], [1, 0]]),
  })
)));

export function sanitizeCreaturazoidBodyState(source = {}, fallback = {}) {
  const candidate = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const state = Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map((name) => {
    const [minimum, maximum] = CONTROL_LIMITS[name];
    const fallbackValue = name === "tractLengthM" ? 0.17 : name === "sourceBalance" ? 0.5 : 0.5;
    return [name, clamp(finiteOr(candidate[name], finiteOr(base[name], fallbackValue)), minimum, maximum)];
  }));
  const rawProfile = Array.isArray(candidate.tractDiameterProfile)
    ? candidate.tractDiameterProfile
    : Array.isArray(base.tractDiameterProfile)
      ? base.tractDiameterProfile
      : DEFAULT_TRACT_DIAMETER_PROFILE;
  state.tractDiameterProfile = Object.freeze(rawProfile.slice(0, 16).map((value) => clamp(value, 0.12, 2.4)));
  state.tractDiameterScale = clamp(
    finiteOr(candidate.tractDiameterScale, finiteOr(base.tractDiameterScale, 1)),
    0.35,
    1.8,
  );
  state.cavityFrequencyHz = clamp(
    finiteOr(candidate.cavityFrequencyHz, finiteOr(base.cavityFrequencyHz, 520)),
    80,
    6_000,
  );
  return Object.freeze(state);
}

const CREATURAZOID_SHAPE_LIMITS = Object.freeze({
  bodyScale: CREATURAZOID_LIMITS.bodyScale,
  bodyRoundness: CREATURAZOID_LIMITS.bodyRoundness,
  headScale: Object.freeze([0.55, 1.45]),
  neckLength: Object.freeze([0.45, 1.55]),
  neckWidth: Object.freeze([0.45, 1.55]),
  thoraxWidth: Object.freeze([0.55, 1.5]),
  bellyDepth: Object.freeze([0.45, 1.55]),
  muzzleLength: Object.freeze([0.45, 1.55]),
  mouthWidth: Object.freeze([0.5, 1.6]),
  mouthDepth: Object.freeze([0.5, 1.65]),
  jawTaper: Object.freeze([-1, 1]),
  lipCurl: Object.freeze([-1, 1]),
  wingSpan: Object.freeze([0.5, 1.5]),
  hornScale: Object.freeze([0.45, 1.55]),
  eyeScale: Object.freeze([0.55, 1.45]),
  earLength: Object.freeze([0.4, 1.7]),
  earWidth: Object.freeze([0.4, 1.7]),
  earDroop: Object.freeze([-1, 1]),
  earRotation: Object.freeze([-1, 1]),
  tailLength: Object.freeze([0.45, 1.75]),
  tailThickness: Object.freeze([0.35, 1.7]),
  tailCurl: Object.freeze([-1, 1]),
  tailTuft: Object.freeze([0, 1]),
  tongueWidth: Object.freeze([0.45, 1.55]),
});

const CREATURAZOID_SHAPE_DEFAULTS = Object.freeze({
  bodyScale: 1,
  bodyRoundness: 0,
  headScale: 1,
  neckLength: 1,
  neckWidth: 1,
  thoraxWidth: 1,
  bellyDepth: 1,
  muzzleLength: 1,
  mouthWidth: 1,
  mouthDepth: 1,
  jawTaper: 0,
  lipCurl: 0,
  wingSpan: 1,
  hornScale: 1,
  eyeScale: 1,
  earLength: 1,
  earWidth: 1,
  earDroop: 0,
  earRotation: 0,
  tailLength: 1,
  tailThickness: 1,
  tailCurl: 0,
  tailTuft: 0.5,
  tongueWidth: 1,
  earType: "point",
  tailType: "brush",
  tongueAnatomy: "canine",
});

export function sanitizeCreaturazoidShape(source = {}, fallback = CREATURAZOID_SHAPE_DEFAULTS) {
  const candidate = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : CREATURAZOID_SHAPE_DEFAULTS;
  const shape = Object.fromEntries(Object.entries(CREATURAZOID_SHAPE_LIMITS).map(([name, limits]) => [
    name,
    clamp(
      finiteOr(candidate[name], finiteOr(base[name], CREATURAZOID_SHAPE_DEFAULTS[name])),
      limits[0],
      limits[1],
    ),
  ]));
  const earType = String(candidate.earType ?? base.earType ?? CREATURAZOID_SHAPE_DEFAULTS.earType);
  const tailType = String(candidate.tailType ?? base.tailType ?? CREATURAZOID_SHAPE_DEFAULTS.tailType);
  const tongueAnatomy = String(
    candidate.tongueAnatomy ?? base.tongueAnatomy ?? CREATURAZOID_SHAPE_DEFAULTS.tongueAnatomy,
  );
  shape.earType = CREATURAZOID_EAR_TYPES.includes(earType) ? earType : CREATURAZOID_SHAPE_DEFAULTS.earType;
  shape.tailType = CREATURAZOID_TAIL_TYPES.includes(tailType) ? tailType : CREATURAZOID_SHAPE_DEFAULTS.tailType;
  shape.tongueAnatomy = ["human", "macaque", "canine", "avian"].includes(tongueAnatomy)
    ? tongueAnatomy
    : CREATURAZOID_SHAPE_DEFAULTS.tongueAnatomy;
  return Object.freeze(shape);
}

function defineBodyPreset({ bodyState, shape, response, palette, modulations, settings, ...preset }) {
  const frozenBodyState = sanitizeCreaturazoidBodyState(bodyState);
  const frozenShape = sanitizeCreaturazoidShape(shape);
  const frozenResponse = Object.freeze({
    attackMs: clamp(response.attackMs, ...CREATURAZOID_LIMITS.attackMs),
    retargetMs: clamp(response.retargetMs, ...CREATURAZOID_LIMITS.morphTimeMs),
    deformationGain: clamp(response.deformationGain, 0.5, 1.5),
  });
  const frozenPalette = Object.freeze([...palette]);
  const frozenModulations = freezeBodyModulations(modulations);
  return Object.freeze({
    ...preset,
    color: frozenPalette[0],
    palette: frozenPalette,
    bodyState: frozenBodyState,
    tractDiameterProfile: frozenBodyState.tractDiameterProfile,
    tractDiameterScale: frozenBodyState.tractDiameterScale,
    cavityFrequencyHz: frozenBodyState.cavityFrequencyHz,
    shape: frozenShape,
    response: frozenResponse,
    modulations: frozenModulations,
    settings: Object.freeze({
      ...settings,
      morph: 1,
      attackMs: frozenResponse.attackMs,
      morphTimeMs: frozenResponse.retargetMs,
      bodyScale: frozenShape.bodyScale,
      bodyRoundness: frozenShape.bodyRoundness,
      bodyState: frozenBodyState,
      morphBias: EMPTY_MORPH_BIAS,
    }),
  });
}

// These are bodies, not source animals. A call may swap the physical source
// mechanism underneath, but these dimensions, resonances, colors, response
// times, and motion envelopes remain the host for every event.
export const CREATURAZOID_BODY_PRESETS = Object.freeze([
  defineBodyPreset({
    id: "colossal-barrel", label: "Colossal Barrel",
    description: "An immense round reservoir with a long, broad airway and slow-moving walls.",
    modulationTarget: "roughness", palette: ["#baff54", "#59f1df", "#ff5f87", "#ffcf68", "#d08cff", "#64cfff", "#ff7b6f", "#e3ff9f", "#b6fff5"],
    bodyState: { pressure: 0.92, tension: 0.24, adduction: 0.72, sourceScale: 0.94, tractLengthM: 0.62, mouthOpening: 0.58, cavityCoupling: 0.78, asymmetry: 0.28, sourceBalance: 0.46, roughness: 0.68, tractDiameterProfile: [1.45, 1.62, 1.72, 1.66, 1.5, 1.3, 1.12, 0.96], tractDiameterScale: 1.68, cavityFrequencyHz: 180 },
    shape: { bodyScale: 1.25, bodyRoundness: 0.96, headScale: 0.9, neckLength: 0.98, neckWidth: 1.12, thoraxWidth: 1.34, bellyDepth: 1.42, muzzleLength: 1.08, mouthWidth: 1.18, mouthDepth: 1.32, jawTaper: 0.22, lipCurl: -0.08, wingSpan: 1.04, hornScale: 1.22, eyeScale: 0.72, earType: "drop", earLength: 1.2, earWidth: 1.35, earDroop: 0.8, earRotation: -0.2, tailType: "brush", tailLength: 0.9, tailThickness: 1.5, tailCurl: 0.55, tailTuft: 0.9, tongueAnatomy: "canine", tongueWidth: 1.35 },
    response: { attackMs: 34, retargetMs: 34, deformationGain: 1.24 },
    settings: { anatomyDesignId: "costal-glider", pitchSemitones: -8, timbre: -0.48, vibratoRateHz: 2.2, vibratoDepthSemitones: 0.24, modulationRateHz: 2.6, modulationDepth: 0.68, modulationShape: "triangle", earSpread: 0.72, tongueReach: 0.68, tongueMotion: 0.38 },
    modulations: [
      { target: "roughness", shape: "triangle", phase: 0.1, speed: [[0, 1.4], [0.5, 3.1], [1, 1.2]], depth: [[0, 0.12], [0.38, 0.72], [1, 0.18]] },
      { target: "cavityCoupling", shape: "sine", phase: 0.35, speed: [[0, 0.5], [0.7, 1.6], [1, 0.7]], depth: [[0, 0.1], [0.55, 0.62], [1, 0.16]] },
      { target: "pressure", shape: "square", phase: 0, speed: [[0, 2.1], [0.5, 4.2], [1, 2.4]], depth: [[0, 0], [0.2, 0.3], [0.85, 0.22], [1, 0]] },
    ],
  }),
  defineBodyPreset({
    id: "pocket-needle", label: "Pocket Needle",
    description: "A tiny angular body with a pinched tube, light source, and immediate reflexes.",
    modulationTarget: "beak", palette: ["#59f1df", "#ffcf68", "#ff5f87", "#baff54", "#64cfff", "#d08cff", "#b6fff5", "#ff7b6f", "#e3ff9f"],
    bodyState: { pressure: 0.58, tension: 0.78, adduction: 0.34, sourceScale: 0.14, tractLengthM: 0.035, mouthOpening: 0.72, cavityCoupling: 0.16, asymmetry: 0.12, sourceBalance: 0.56, roughness: 0.08, tractDiameterProfile: [0.38, 0.34, 0.3, 0.26, 0.24, 0.2, 0.18, 0.16], tractDiameterScale: 0.46, cavityFrequencyHz: 3_900 },
    shape: { bodyScale: 0.62, bodyRoundness: -0.78, headScale: 0.7, neckLength: 0.62, neckWidth: 0.52, thoraxWidth: 0.6, bellyDepth: 0.54, muzzleLength: 1.28, mouthWidth: 0.62, mouthDepth: 0.58, jawTaper: 0.85, lipCurl: -0.4, wingSpan: 0.72, hornScale: 0.62, eyeScale: 0.86, earType: "point", earLength: 0.7, earWidth: 0.55, earDroop: -0.7, earRotation: 0.7, tailType: "whip", tailLength: 1.4, tailThickness: 0.45, tailCurl: -0.4, tailTuft: 0.12, tongueAnatomy: "macaque", tongueWidth: 0.58 },
    response: { attackMs: 10, retargetMs: 14, deformationGain: 0.92 },
    settings: { anatomyDesignId: "costal-glider", pitchSemitones: 9, timbre: 0.62, vibratoRateHz: 9.4, vibratoDepthSemitones: 1.1, modulationRateHz: 8.2, modulationDepth: 0.56, modulationShape: "sample-hold", earSpread: 0.32, tongueReach: 0.38, tongueMotion: 0.9 },
    modulations: [
      { target: "tension", shape: "sample-hold", phase: 0.2, speed: [[0, 8], [0.45, 15], [1, 9]], depth: [[0, 0.08], [0.16, 0.62], [0.82, 0.46], [1, 0]] },
      { target: "mouthOpening", shape: "square", phase: 0, speed: [[0, 6], [0.5, 12], [1, 7]], depth: [[0, 0], [0.08, 0.7], [0.72, 0.3], [1, 0]] },
      { target: "sourceBalance", shape: "triangle", phase: 0.5, speed: [[0, 3], [0.6, 8], [1, 4]], depth: [[0, 0.12], [0.5, 0.78], [1, 0.14]] },
    ],
  }),
  defineBodyPreset({
    id: "long-hollow", label: "Long Hollow",
    description: "A narrow extended throat with widely spaced resonances and a light-walled chest.",
    modulationTarget: "cavity", palette: ["#64cfff", "#baff54", "#d08cff", "#59f1df", "#ff7b6f", "#ffcf68", "#e3ff9f", "#b6fff5", "#ff5f87"],
    bodyState: { pressure: 0.75, tension: 0.38, adduction: 0.55, sourceScale: 0.62, tractLengthM: 0.78, mouthOpening: 0.48, cavityCoupling: 0.82, asymmetry: 0.16, sourceBalance: 0.5, roughness: 0.28, tractDiameterProfile: [0.62, 0.58, 0.5, 0.42, 0.38, 0.46, 0.54, 0.66], tractDiameterScale: 0.84, cavityFrequencyHz: 260 },
    shape: { bodyScale: 1.04, bodyRoundness: -0.48, headScale: 0.84, neckLength: 1.48, neckWidth: 0.64, thoraxWidth: 0.78, bellyDepth: 0.7, muzzleLength: 1.12, mouthWidth: 0.78, mouthDepth: 1.4, jawTaper: 0.65, lipCurl: 0.2, wingSpan: 1.12, hornScale: 1.08, eyeScale: 0.82, earType: "long", earLength: 1.6, earWidth: 0.48, earDroop: -0.3, earRotation: 0.2, tailType: "tuft", tailLength: 1.55, tailThickness: 0.55, tailCurl: 0.2, tailTuft: 0.7, tongueAnatomy: "canine", tongueWidth: 0.78 },
    response: { attackMs: 28, retargetMs: 30, deformationGain: 1.08 },
    settings: { anatomyDesignId: "costal-glider", pitchSemitones: -4, timbre: -0.16, vibratoRateHz: 4.1, vibratoDepthSemitones: 0.52, modulationRateHz: 3.3, modulationDepth: 0.52, modulationShape: "sine", earSpread: 0.64, tongueReach: 0.82, tongueMotion: 0.56 },
    modulations: [
      { target: "cavityCoupling", shape: "sine", phase: 0.25, speed: [[0, 0.6], [0.5, 2.3], [1, 0.8]], depth: [[0, 0.06], [0.42, 0.78], [1, 0.12]] },
      { target: "tractLengthM", shape: "triangle", phase: 0, speed: [[0, 0.3], [0.55, 1.1], [1, 0.4]], depth: [[0, 0], [0.3, 0.42], [0.8, 0.66], [1, 0]] },
    ],
  }),
  defineBodyPreset({
    id: "dense-squat", label: "Dense Squat",
    description: "A low compact mass with thick closure, a short pipe, and abrasive internal surfaces.",
    modulationTarget: "roughness", palette: ["#ff7b6f", "#ffcf68", "#baff54", "#ff5f87", "#59f1df", "#d08cff", "#e3ff9f", "#64cfff", "#b6fff5"],
    bodyState: { pressure: 0.88, tension: 0.28, adduction: 0.8, sourceScale: 0.86, tractLengthM: 0.13, mouthOpening: 0.42, cavityCoupling: 0.7, asymmetry: 0.42, sourceBalance: 0.44, roughness: 0.8, tractDiameterProfile: [1.3, 1.42, 1.5, 1.44, 1.34, 1.2, 1.04, 0.9], tractDiameterScale: 1.48, cavityFrequencyHz: 320 },
    shape: { bodyScale: 1.08, bodyRoundness: 0.9, headScale: 1.22, neckLength: 0.5, neckWidth: 1.32, thoraxWidth: 1.38, bellyDepth: 1.18, muzzleLength: 0.72, mouthWidth: 1.45, mouthDepth: 0.8, jawTaper: -0.45, lipCurl: 0.75, wingSpan: 0.7, hornScale: 0.92, eyeScale: 0.72, earType: "round", earLength: 0.75, earWidth: 1.2, earDroop: 0.15, earRotation: -0.4, tailType: "brush", tailLength: 0.7, tailThickness: 1.65, tailCurl: 0.8, tailTuft: 1, tongueAnatomy: "canine", tongueWidth: 1.4 },
    response: { attackMs: 18, retargetMs: 20, deformationGain: 1.32 },
    settings: { anatomyDesignId: "branchial-mantle", pitchSemitones: -6, timbre: -0.7, vibratoRateHz: 3.1, vibratoDepthSemitones: 0.3, modulationRateHz: 5.4, modulationDepth: 0.74, modulationShape: "square", earSpread: 0.52, tongueReach: 0.58, tongueMotion: 0.72 },
    modulations: [
      { target: "roughness", shape: "sample-hold", phase: 0.7, speed: [[0, 4], [0.45, 9], [1, 5]], depth: [[0, 0.2], [0.34, 0.86], [0.76, 0.64], [1, 0.1]] },
      { target: "adduction", shape: "square", phase: 0.1, speed: [[0, 2], [0.5, 6], [1, 3]], depth: [[0, 0.05], [0.2, 0.58], [0.9, 0.4], [1, 0]] },
    ],
  }),
  defineBodyPreset({
    id: "elastic-tower", label: "Elastic Tower",
    description: "A tall spring-loaded column whose neck, outlet, and source bend at different speeds.",
    modulationTarget: "pressure", palette: ["#d08cff", "#59f1df", "#baff54", "#64cfff", "#ff5f87", "#ffcf68", "#b6fff5", "#ff7b6f", "#e3ff9f"],
    bodyState: { pressure: 0.72, tension: 0.52, adduction: 0.48, sourceScale: 0.45, tractLengthM: 0.46, mouthOpening: 0.66, cavityCoupling: 0.44, asymmetry: 0.22, sourceBalance: 0.52, roughness: 0.25, tractDiameterProfile: [0.72, 0.66, 0.58, 0.52, 0.62, 0.74, 0.82, 0.76], tractDiameterScale: 0.76, cavityFrequencyHz: 650 },
    shape: { bodyScale: 0.94, bodyRoundness: -0.1, headScale: 0.8, neckLength: 1.4, neckWidth: 0.7, thoraxWidth: 0.76, bellyDepth: 0.82, muzzleLength: 0.92, mouthWidth: 0.85, mouthDepth: 1.25, jawTaper: 0.55, lipCurl: -0.25, wingSpan: 1.28, hornScale: 1.16, eyeScale: 0.84, earType: "fan", earLength: 1.25, earWidth: 1.3, earDroop: -0.4, earRotation: 0.55, tailType: "fan", tailLength: 1.2, tailThickness: 0.75, tailCurl: -0.65, tailTuft: 0.85, tongueAnatomy: "macaque", tongueWidth: 0.9 },
    response: { attackMs: 20, retargetMs: 24, deformationGain: 1.18 },
    settings: { anatomyDesignId: "scapular-wings", pitchSemitones: 2, timbre: 0.12, vibratoRateHz: 6.8, vibratoDepthSemitones: 0.92, modulationRateHz: 5.8, modulationDepth: 0.62, modulationShape: "triangle", earSpread: 0.78, tongueReach: 0.72, tongueMotion: 0.84 },
    modulations: [
      { target: "pressure", shape: "triangle", phase: 0, speed: [[0, 2.5], [0.5, 7.5], [1, 3]], depth: [[0, 0], [0.15, 0.64], [0.72, 0.48], [1, 0]] },
      { target: "mouthOpening", shape: "sine", phase: 0.33, speed: [[0, 1.2], [0.6, 5], [1, 1.5]], depth: [[0, 0.08], [0.5, 0.82], [1, 0.14]] },
      { target: "tension", shape: "sine", phase: 0.75, speed: [[0, 4], [0.5, 9], [1, 5]], depth: [[0, 0.1], [0.35, 0.5], [0.85, 0.72], [1, 0.08]] },
    ],
  }),
  defineBodyPreset({
    id: "wide-bladder", label: "Wide Bladder",
    description: "A broad inflatable cavity with a soft source and a heavily breathing lower body.",
    modulationTarget: "cavity", palette: ["#ff5f87", "#baff54", "#59f1df", "#d08cff", "#ffcf68", "#64cfff", "#ff7b6f", "#b6fff5", "#e3ff9f"],
    bodyState: { pressure: 0.82, tension: 0.32, adduction: 0.58, sourceScale: 0.72, tractLengthM: 0.24, mouthOpening: 0.32, cavityCoupling: 0.95, asymmetry: 0.2, sourceBalance: 0.5, roughness: 0.42, tractDiameterProfile: [1.62, 1.72, 1.78, 1.7, 1.54, 1.36, 1.18, 1], tractDiameterScale: 1.76, cavityFrequencyHz: 140 },
    shape: { bodyScale: 1.14, bodyRoundness: 1, headScale: 0.92, neckLength: 0.64, neckWidth: 1.2, thoraxWidth: 1.46, bellyDepth: 1.5, muzzleLength: 0.7, mouthWidth: 1.55, mouthDepth: 1.1, jawTaper: -0.65, lipCurl: 0.55, wingSpan: 0.76, hornScale: 0.84, eyeScale: 0.78, earType: "wide", earLength: 0.65, earWidth: 1.6, earDroop: 0.35, earRotation: -0.65, tailType: "tuft", tailLength: 0.85, tailThickness: 1.2, tailCurl: 0.9, tailTuft: 0.8, tongueAnatomy: "human", tongueWidth: 1.5 },
    response: { attackMs: 30, retargetMs: 32, deformationGain: 1.4 },
    settings: { anatomyDesignId: "branchial-mantle", pitchSemitones: -5, timbre: -0.34, vibratoRateHz: 2.8, vibratoDepthSemitones: 0.34, modulationRateHz: 4.2, modulationDepth: 0.78, modulationShape: "sine", earSpread: 0.82, tongueReach: 0.76, tongueMotion: 0.48 },
    modulations: [
      { target: "cavityCoupling", shape: "sine", phase: 0, speed: [[0, 0.7], [0.5, 3.2], [1, 0.9]], depth: [[0, 0], [0.24, 0.9], [0.82, 0.72], [1, 0]] },
      { target: "pressure", shape: "square", phase: 0.4, speed: [[0, 1.8], [0.6, 4.8], [1, 2]], depth: [[0, 0.08], [0.35, 0.54], [1, 0.06]] },
    ],
  }),
  defineBodyPreset({
    id: "split-chamber", label: "Split Chamber",
    description: "A deliberately uneven paired body with two differently loaded sides and a shifting center.",
    modulationTarget: "split", palette: ["#59f1df", "#d08cff", "#ff5f87", "#64cfff", "#baff54", "#ff7b6f", "#ffcf68", "#e3ff9f", "#b6fff5"],
    bodyState: { pressure: 0.68, tension: 0.56, adduction: 0.52, sourceScale: 0.48, tractLengthM: 0.3, mouthOpening: 0.54, cavityCoupling: 0.62, asymmetry: 0.82, sourceBalance: 0.3, roughness: 0.52, tractDiameterProfile: [0.92, 1.22, 0.76, 1.18, 0.7, 1.08, 0.66, 0.9], tractDiameterScale: 1.04, cavityFrequencyHz: 520 },
    shape: { bodyScale: 0.96, bodyRoundness: 0.14, headScale: 1.04, neckLength: 0.9, neckWidth: 0.92, thoraxWidth: 1, bellyDepth: 0.94, muzzleLength: 0.9, mouthWidth: 1.12, mouthDepth: 0.92, jawTaper: 0.1, lipCurl: -0.6, wingSpan: 1.16, hornScale: 1.34, eyeScale: 0.88, earType: "point", earLength: 1.1, earWidth: 0.72, earDroop: -0.2, earRotation: 0.35, tailType: "whip", tailLength: 1.3, tailThickness: 0.7, tailCurl: 0, tailTuft: 0.25, tongueAnatomy: "canine", tongueWidth: 1 },
    response: { attackMs: 16, retargetMs: 18, deformationGain: 1.26 },
    settings: { anatomyDesignId: "scapular-wings", pitchSemitones: 0, timbre: 0.08, vibratoRateHz: 7.2, vibratoDepthSemitones: 0.78, modulationRateHz: 6.4, modulationDepth: 0.82, modulationShape: "sample-hold", earSpread: 0.9, tongueReach: 0.64, tongueMotion: 0.8 },
    modulations: [
      { target: "asymmetry", shape: "sample-hold", phase: 0.13, speed: [[0, 3], [0.45, 11], [1, 4]], depth: [[0, 0.1], [0.22, 0.92], [0.75, 0.7], [1, 0.12]] },
      { target: "sourceBalance", shape: "triangle", phase: 0.55, speed: [[0, 1], [0.6, 6], [1, 2]], depth: [[0, 0.18], [0.48, 0.88], [1, 0.2]] },
      { target: "roughness", shape: "square", phase: 0, speed: [[0, 5], [0.5, 13], [1, 6]], depth: [[0, 0], [0.2, 0.56], [0.88, 0.4], [1, 0]] },
    ],
  }),
  defineBodyPreset({
    id: "paper-giant", label: "Paper-Thin Giant",
    description: "A huge but lightly built frame with an open outlet, thin walls, and fluttering resonances.",
    modulationTarget: "balance", palette: ["#baff54", "#64cfff", "#ff7b6f", "#59f1df", "#d08cff", "#ffcf68", "#e3ff9f", "#b6fff5", "#ff5f87"],
    bodyState: { pressure: 0.62, tension: 0.68, adduction: 0.3, sourceScale: 0.28, tractLengthM: 0.58, mouthOpening: 0.78, cavityCoupling: 0.38, asymmetry: 0.55, sourceBalance: 0.64, roughness: 0.14, tractDiameterProfile: [0.52, 0.46, 0.42, 0.38, 0.34, 0.4, 0.48, 0.6], tractDiameterScale: 0.56, cavityFrequencyHz: 450 },
    shape: { bodyScale: 1.2, bodyRoundness: -0.88, headScale: 0.9, neckLength: 1.24, neckWidth: 0.54, thoraxWidth: 0.72, bellyDepth: 0.62, muzzleLength: 1.3, mouthWidth: 0.65, mouthDepth: 1.6, jawTaper: 0.9, lipCurl: -0.75, wingSpan: 1.48, hornScale: 1.46, eyeScale: 0.82, earType: "fan", earLength: 1.45, earWidth: 1.35, earDroop: -0.5, earRotation: 0.8, tailType: "fan", tailLength: 1.7, tailThickness: 0.4, tailCurl: -0.8, tailTuft: 1, tongueAnatomy: "avian", tongueWidth: 0.55 },
    response: { attackMs: 14, retargetMs: 16, deformationGain: 1.12 },
    settings: { anatomyDesignId: "costal-glider", pitchSemitones: 5, timbre: 0.48, vibratoRateHz: 8.6, vibratoDepthSemitones: 1.26, modulationRateHz: 7.6, modulationDepth: 0.66, modulationShape: "triangle", earSpread: 0.7, tongueReach: 0.88, tongueMotion: 0.7 },
    modulations: [
      { target: "sourceBalance", shape: "triangle", phase: 0.2, speed: [[0, 2], [0.5, 8], [1, 3]], depth: [[0, 0.12], [0.42, 0.86], [1, 0.16]] },
      { target: "mouthOpening", shape: "square", phase: 0.6, speed: [[0, 4], [0.6, 12], [1, 5]], depth: [[0, 0], [0.14, 0.62], [0.8, 0.48], [1, 0]] },
    ],
  }),
]);

// Compatibility names remain while the application migrates from “voice” to
// the canonical persistent-body vocabulary.
export const CREATURAZOID_VOICE_PRESETS = CREATURAZOID_BODY_PRESETS;

function makePatternRows(entries = []) {
  const rows = Object.fromEntries(CREATURAZOID_SOUNDS.map(({ id }) => [
    id,
    Array(CREATURAZOID_MAX_STEPS).fill(0),
  ]));
  for (const [rawStep, rawSoundId, rawVelocity = 0.72] of entries) {
    const step = Math.trunc(finiteOr(rawStep, -1));
    const sound = soundById.get(String(rawSoundId ?? ""));
    if (!sound || step < 0 || step >= CREATURAZOID_MAX_STEPS) continue;
    for (const values of Object.values(rows)) values[step] = 0;
    rows[sound.id][step] = clamp(rawVelocity);
  }
  for (const values of Object.values(rows)) Object.freeze(values);
  return Object.freeze(rows);
}

function defineSequencePreset({ length, events, ...preset }) {
  const safeLength = integerInRange(length, 16, 1, CREATURAZOID_MAX_STEPS);
  return Object.freeze({
    ...preset,
    length: safeLength,
    stepCount: safeLength,
    tempo: clamp(preset.tempo, ...CREATURAZOID_LIMITS.tempo),
    swing: clamp(preset.swing, ...CREATURAZOID_LIMITS.swing),
    rows: makePatternRows(events.filter(([step]) => step >= 0 && step < safeLength)),
  });
}

// Hiccup Head earns its pulse by repeating a legible sixteen-step phrase.
// Creaturazoid keeps the same dance-floor grammar, but assigns each role to a
// physical creature action and still retargets only one shared body at a time.
function repeatSequencePhrase(length, phrase) {
  const events = [];
  for (let phraseStart = 0; phraseStart < length; phraseStart += 16) {
    for (const [step, soundId, velocity] of phrase) {
      if (phraseStart + step < length) events.push([phraseStart + step, soundId, velocity]);
    }
  }
  return events;
}

export const CREATURAZOID_SEQUENCE_PRESETS = Object.freeze([
  defineSequencePreset({
    id: "hoof-and-hiss", label: "Hoof House", color: "#ff7b6f", length: 32, tempo: 126, swing: 0.08, dance: true,
    events: [[0, "hoof-stomp", 1], [1, "caw", 0.42], [2, "growl", 0.72], [4, "snap-bark", 1], [5, "caw", 0.42], [6, "chirp", 0.72], [7, "yip", 0.72], [8, "hoof-stomp", 1], [9, "caw", 0.42], [10, "grunt", 0.72], [11, "frogtrill", 0.42], [12, "snap-bark", 1], [13, "caw", 0.42], [14, "chuff", 0.72], [15, "tail-whip", 1], [16, "hoof-stomp", 1], [17, "caw", 0.42], [18, "growl", 0.72], [20, "snap-bark", 1], [21, "caw", 0.42], [22, "hoof-stomp", 0.72], [23, "yip", 0.72], [24, "hoof-stomp", 1], [25, "caw", 0.42], [26, "chirp", 0.72], [27, "chuff", 0.42], [28, "snap-bark", 1], [29, "caw", 0.42], [30, "neigh", 0.72], [31, "yip", 1]],
  }),
  defineSequencePreset({
    id: "feeding-frenzy", label: "Feeding Funk", color: "#59f1df", length: 32, tempo: 116, swing: 0.32, dance: true,
    events: repeatSequencePhrase(32, [[0, "hoof-stomp", 1], [1, "lapping", 0.42], [2, "growl", 0.72], [4, "snap-bark", 1], [5, "lapping", 0.42], [6, "chirp", 0.72], [7, "gunk", 0.72], [8, "hoof-stomp", 1], [9, "lapping", 0.42], [10, "grunt", 0.72], [11, "frogtrill", 0.42], [12, "snap-bark", 1], [13, "lapping", 0.42], [14, "crunching", 0.72], [15, "chuff", 1]]),
  }),
  defineSequencePreset({
    id: "stampede-signal", label: "Stampede Techno", color: "#ff5f87", length: 64, tempo: 144, swing: 0.1, dance: true,
    events: [...repeatSequencePhrase(64, [[0, "hoof-stomp", 1], [1, "growl", 0.42], [2, "caw", 0.72], [3, "grunt", 0.42], [4, "hoof-stomp", 0.72], [5, "chirp", 0.42], [6, "caw", 0.72], [7, "frogtrill", 1], [8, "hoof-stomp", 1], [9, "chuff", 0.42], [10, "caw", 0.72], [11, "growl", 0.72], [12, "hoof-stomp", 0.72], [13, "footsteps", 0.42], [14, "snap-bark", 1]]), [31, "horn-surprise", 1], [63, "horn-surprise", 1]],
  }),
  defineSequencePreset({
    id: "creature-parade", label: "Hyena Breaks", color: "#ffcf68", length: 32, tempo: 142, swing: 0.18, dance: true,
    events: [[0, "hoof-stomp", 1], [1, "caw", 0.42], [3, "hoof-stomp", 0.72], [4, "snap-bark", 1], [5, "growl", 0.42], [6, "yip", 0.72], [7, "chirp", 0.72], [8, "hoof-stomp", 1], [9, "caw", 0.42], [10, "hoof-stomp", 0.72], [12, "snap-bark", 1], [13, "giggle", 0.42], [14, "grunt", 0.72], [15, "caw", 0.72], [16, "hoof-stomp", 1], [17, "caw", 0.42], [18, "frogtrill", 0.42], [19, "hoof-stomp", 0.72], [20, "snap-bark", 1], [21, "chuff", 0.42], [23, "yip", 1], [24, "hoof-stomp", 1], [25, "caw", 0.42], [26, "hoof-stomp", 0.72], [27, "growl", 0.42], [28, "snap-bark", 1], [30, "yip", 0.72], [31, "caw", 1]],
  }),
  defineSequencePreset({
    id: "murmuration", label: "Ruffle Garage", color: "#d08cff", length: 32, tempo: 132, swing: 0.32, dance: true,
    events: [[0, "hoof-stomp", 1], [1, "caw", 0.42], [2, "growl", 0.72], [4, "snap-bark", 1], [5, "feather-ruffle", 0.72], [8, "hoof-stomp", 1], [9, "caw", 0.42], [10, "croak", 0.72], [11, "chirp", 0.42], [12, "snap-bark", 1], [13, "yip", 0.42], [14, "frogtrill", 0.72], [15, "chuff", 1], [16, "hoof-stomp", 1], [17, "caw", 0.42], [18, "growl", 0.72], [20, "snap-bark", 1], [21, "feather-ruffle", 0.72], [24, "hoof-stomp", 1], [25, "caw", 0.42], [26, "grunt", 0.72], [27, "chirp", 0.42], [28, "snap-bark", 1], [29, "yip", 0.42], [30, "chuff", 0.72], [31, "frogtrill", 1]],
  }),
  defineSequencePreset({
    id: "owl-blinks", label: "Howl / owl relay", color: "#64cfff", length: 64, tempo: 112, swing: 0.16,
    events: [[0, "howl", 1], [14, "chirp", 0.42], [15, "yip", 1], [16, "feather-ruffle", 0.42], [17, "owlpair", 0.72], [29, "ticks", 0.42], [30, "bark", 0.72], [31, "trumpet", 1], [41, "hoot", 0.72], [48, "phrase", 1], [58, "moose", 0.42], [59, "rattle", 0.72], [60, "footsteps", 0.72], [61, "chuff", 1], [62, "gunk", 0.42]],
  }),
  defineSequencePreset({
    id: "swamp-skip", label: "Swamp skip", color: "#baff54", length: 32, tempo: 146, swing: 0.3,
    events: [[0, "bellow", 1], [9, "chirp", 0.42], [10, "gunk", 1], [11, "bark", 0.72], [12, "clawing", 0.42], [13, "croak", 0.42], [15, "frogtrill", 1], [24, "moose", 0.42], [25, "rattle", 1], [27, "grunt", 0.72], [28, "chirp", 1], [29, "panting", 0.72], [30, "yip", 0.72], [31, "ticks", 1]],
  }),
  defineSequencePreset({
    id: "nervous-comet", label: "Bovine birdbath", color: "#e3ff9f", length: 64, tempo: 96, swing: 0.12,
    events: [[0, "lowmoo", 1], [12, "chirp", 0.42], [13, "yip", 0.72], [14, "tail-whip", 1], [15, "coo", 0.72], [24, "moose", 0.42], [25, "ticks", 0.72], [27, "double", 1], [36, "gunk", 0.42], [37, "moo", 1], [48, "phrase", 0.72], [58, "bark", 0.42], [59, "rattle", 1], [60, "hoof-stomp", 0.72], [61, "sweep", 0.72], [62, "chuff", 1]],
  }),
  defineSequencePreset({
    id: "fang-and-feather", label: "Fang & feather", color: "#ff7b6f", length: 64, tempo: 124, swing: 0.26,
    events: [[0, "roar", 1], [14, "chirp", 0.42], [15, "yip", 1], [16, "feather-ruffle", 0.42], [17, "rattle", 0.72], [26, "grunt", 1], [27, "croak", 0.42], [28, "clawing", 0.72], [29, "chuff", 0.72], [32, "frogtrill", 1], [42, "growl", 0.72], [51, "moose", 0.42], [52, "bark", 1], [54, "owlpair", 0.72], [62, "gator", 0.42], [63, "ticks", 1]],
  }),
  defineSequencePreset({
    id: "rose-migration", label: "Antler migration", color: "#b6fff5", length: 64, tempo: 108, swing: 0.18,
    events: [[0, "cervid", 1], [13, "chirp", 0.42], [14, "moose", 1], [15, "footsteps", 0.72], [16, "phrase", 0.72], [27, "chuff", 0.72], [28, "rattle", 0.42], [29, "jumping", 1], [30, "yip", 1], [32, "whinny", 1], [43, "ticks", 0.72], [44, "bark", 1], [46, "croak", 0.42], [48, "owlpair", 1], [59, "nicker", 0.42], [60, "gunk", 1], [62, "moose", 0.42]],
  }),
  defineSequencePreset({
    id: "whole-menagerie", label: "Menagerie pinball", color: "#59f1df", length: 64, tempo: 152, swing: 0.2,
    events: [[0, "rumble", 1], [12, "chirp", 0.42], [13, "moose", 1], [14, "hoof-stomp", 1], [15, "phrase", 0.72], [26, "bark", 0.42], [27, "rattle", 1], [28, "crunching", 0.72], [29, "gunk", 0.72], [30, "yip", 1], [32, "giggle", 1], [40, "croak", 0.42], [41, "chuff", 0.72], [43, "double", 1], [48, "frogtrill", 0.72], [58, "sweep", 0.72], [59, "gator", 0.42], [61, "ticks", 0.42], [62, "trumpet", 1]],
  }),
]);

const bodyPresetById = new Map(CREATURAZOID_BODY_PRESETS.map((preset) => [preset.id, preset]));
const sequencePresetById = new Map(CREATURAZOID_SEQUENCE_PRESETS.map((preset) => [preset.id, preset]));
const legacyBodyPresetIds = Object.freeze({
  "prismatic-chimera": "colossal-barrel",
  "sunbird-spark": "long-hollow",
  "midnight-howler": "elastic-tower",
  "poison-frog-pop": "wide-bladder",
  "copper-lion": "dense-squat",
  "violet-mouse-comet": "pocket-needle",
  "rose-dove-dream": "paper-giant",
  "teal-marsh-bell": "split-chamber",
});

export const CREATURAZOID_PRESETS = CREATURAZOID_BODY_PRESETS;
export const CREATURAZOID_PATTERNS = CREATURAZOID_SEQUENCE_PRESETS;

const defaultSequencePreset = sequencePresetById.get("hoof-and-hiss");

export const CREATURAZOID_DEFAULTS = Object.freeze({
  bodyPresetId: "colossal-barrel",
  voicePresetId: "colossal-barrel",
  sequencePresetId: defaultSequencePreset.id,
  anatomyDesignId: CREATURAZOID_BODY_PRESETS[0].settings.anatomyDesignId,
  tempo: defaultSequencePreset.tempo,
  swing: defaultSequencePreset.swing,
  patternLength: defaultSequencePreset.length,
  morph: CREATURAZOID_BODY_PRESETS[0].settings.morph,
  pitchSemitones: CREATURAZOID_BODY_PRESETS[0].settings.pitchSemitones,
  vibratoRateHz: CREATURAZOID_BODY_PRESETS[0].settings.vibratoRateHz,
  vibratoDepthSemitones: CREATURAZOID_BODY_PRESETS[0].settings.vibratoDepthSemitones,
  modulationRateHz: CREATURAZOID_BODY_PRESETS[0].settings.modulationRateHz,
  modulationDepth: CREATURAZOID_BODY_PRESETS[0].settings.modulationDepth,
  modulationShape: CREATURAZOID_BODY_PRESETS[0].settings.modulationShape,
  timbre: CREATURAZOID_BODY_PRESETS[0].settings.timbre,
  morphTimeMs: CREATURAZOID_BODY_PRESETS[0].settings.morphTimeMs,
  attackMs: CREATURAZOID_BODY_PRESETS[0].settings.attackMs,
  bodyScale: CREATURAZOID_BODY_PRESETS[0].settings.bodyScale,
  bodyRoundness: CREATURAZOID_BODY_PRESETS[0].settings.bodyRoundness,
  earSpread: CREATURAZOID_BODY_PRESETS[0].settings.earSpread,
  tongueReach: CREATURAZOID_BODY_PRESETS[0].settings.tongueReach,
  tongueMotion: CREATURAZOID_BODY_PRESETS[0].settings.tongueMotion,
  level: 0.48,
  biologicalLock: false,
  bodyState: CREATURAZOID_BODY_PRESETS[0].bodyState,
  bodyShape: CREATURAZOID_BODY_PRESETS[0].shape,
  morphBias: CREATURAZOID_BODY_PRESETS[0].settings.morphBias,
});

export const CREATURAZOID_QUICK_MORPH = Object.freeze({
  durationMs: CREATURAZOID_DEFAULTS.morphTimeMs,
  minimumMs: CREATURAZOID_LIMITS.morphTimeMs[0],
  maximumMs: CREATURAZOID_LIMITS.morphTimeMs[1],
  curve: "smoothstep",
  monophonic: true,
});

export function creaturazoidBodyPreset(id) {
  const requested = String(id ?? "");
  const canonicalId = legacyBodyPresetIds[requested] ?? requested;
  return bodyPresetById.get(canonicalId) ?? bodyPresetById.get(CREATURAZOID_DEFAULTS.bodyPresetId);
}

export function creaturazoidVoicePreset(id) {
  return creaturazoidBodyPreset(id);
}

export function creaturazoidSequencePreset(id) {
  return sequencePresetById.get(String(id ?? "")) ?? sequencePresetById.get(CREATURAZOID_DEFAULTS.sequencePresetId);
}

export function creaturazoidAnatomyDesign(id) {
  return anatomyDesignById.get(String(id ?? "")) ?? anatomyDesignById.get(CREATURAZOID_DEFAULTS.anatomyDesignId);
}

export const creaturazoidPreset = creaturazoidBodyPreset;
export const creaturazoidPattern = creaturazoidSequencePreset;

function sanitizeMorphBias(source, fallback = EMPTY_MORPH_BIAS) {
  const candidate = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : EMPTY_MORPH_BIAS;
  return Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map((name) => [
    name,
    clamp(finiteOr(candidate[name], finiteOr(base[name], 0)), -1, 1),
  ]));
}

export function sanitizeCreaturazoidState(source = {}, fallback = CREATURAZOID_DEFAULTS) {
  const candidate = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : CREATURAZOID_DEFAULTS;
  const requestedBodyPresetId = candidate.bodyPresetId
    ?? candidate.voicePresetId
    ?? base.bodyPresetId
    ?? base.voicePresetId;
  const bodyPreset = creaturazoidBodyPreset(requestedBodyPresetId);
  const result = {};
  for (const [name, limits] of Object.entries(CREATURAZOID_LIMITS)) {
    const defaultValue = CREATURAZOID_DEFAULTS[name];
    result[name] = clamp(
      finiteOr(candidate[name], finiteOr(base[name], defaultValue)),
      limits[0],
      limits[1],
    );
  }
  result.patternLength = Math.trunc(result.patternLength);
  result.bodyPresetId = bodyPreset.id;
  result.voicePresetId = bodyPreset.id;
  result.sequencePresetId = sequencePresetById.has(String(candidate.sequencePresetId ?? base.sequencePresetId))
    ? String(candidate.sequencePresetId ?? base.sequencePresetId)
    : CREATURAZOID_DEFAULTS.sequencePresetId;
  result.anatomyDesignId = anatomyDesignById.has(String(candidate.anatomyDesignId ?? base.anatomyDesignId))
    ? String(candidate.anatomyDesignId ?? base.anatomyDesignId)
    : CREATURAZOID_DEFAULTS.anatomyDesignId;
  const shape = String(candidate.modulationShape ?? base.modulationShape ?? "sine");
  result.modulationShape = CREATURAZOID_MODULATION_SHAPES.includes(shape) ? shape : "sine";
  result.morphBias = sanitizeMorphBias(candidate.morphBias, base.morphBias);
  result.bodyState = sanitizeCreaturazoidBodyState(
    candidate.bodyState,
    base.bodyState ?? bodyPreset.bodyState,
  );
  result.bodyShape = sanitizeCreaturazoidShape({
    ...bodyPreset.shape,
    ...(base.bodyShape ?? {}),
    ...(candidate.bodyShape ?? {}),
    bodyScale: result.bodyScale,
    bodyRoundness: result.bodyRoundness,
  }, bodyPreset.shape);
  result.tractDiameterProfile = result.bodyState.tractDiameterProfile;
  result.tractDiameterScale = result.bodyState.tractDiameterScale;
  result.cavityFrequencyHz = result.bodyState.cavityFrequencyHz;
  result.modulationTarget = String(
    candidate.modulationTarget
      ?? base.modulationTarget
      ?? bodyPreset.modulationTarget,
  );
  // Creaturazoid is intentionally one impossible, rapidly changing animal.
  // Family-specific biological ranges would prevent the cross-species morph.
  result.biologicalLock = false;
  return result;
}

export function creaturazoidState(presetId = CREATURAZOID_DEFAULTS.bodyPresetId, overrides = {}) {
  const preset = creaturazoidBodyPreset(presetId);
  return sanitizeCreaturazoidState({
    ...CREATURAZOID_DEFAULTS,
    ...preset.settings,
    bodyState: preset.bodyState,
    bodyShape: preset.shape,
    modulationTarget: preset.modulationTarget,
    ...overrides,
    bodyState: {
      ...preset.bodyState,
      ...(overrides?.bodyState ?? {}),
    },
    morphBias: {
      ...preset.settings.morphBias,
      ...(overrides?.morphBias ?? {}),
    },
    bodyPresetId: preset.id,
    voicePresetId: preset.id,
  });
}

function differentRandomItem(values, current, randomUnit) {
  const candidates = values.filter((value) => value !== current);
  return candidates[Math.min(candidates.length - 1, Math.floor(randomUnit() * candidates.length))]
    ?? values[0];
}

/**
 * Make a visibly new specimen from the current persistent body. Every major
 * geometry axis crosses a minimum fraction of its range; ear, tail, tongue,
 * and skeletal plans always change rather than re-rolling the same outline.
 */
export function mutateCreaturazoidState(candidate = CREATURAZOID_DEFAULTS, random = Math.random) {
  const safe = sanitizeCreaturazoidState(candidate);
  const randomUnit = () => clamp(finiteOr(random(), 0.5));
  const randomSigned = () => randomUnit() * 2 - 1;
  const sampleFar = (current, limits, minimumDistance = 0.22) => {
    const [minimum, maximum] = limits;
    const span = maximum - minimum;
    const distance = span * minimumDistance;
    const leftMaximum = current - distance;
    const rightMinimum = current + distance;
    const canMoveLeft = leftMaximum >= minimum;
    const canMoveRight = rightMinimum <= maximum;
    const moveLeft = canMoveLeft && (!canMoveRight || randomUnit() < 0.5);
    if (moveLeft) return minimum + randomUnit() * (leftMaximum - minimum);
    if (canMoveRight) return rightMinimum + randomUnit() * (maximum - rightMinimum);
    return current < (minimum + maximum) * 0.5 ? maximum : minimum;
  };

  const bodyScale = sampleFar(safe.bodyScale, CREATURAZOID_LIMITS.bodyScale, 0.25);
  const bodyRoundness = sampleFar(safe.bodyRoundness, CREATURAZOID_LIMITS.bodyRoundness, 0.27);
  const bodyShape = { ...safe.bodyShape, bodyScale, bodyRoundness };
  for (const name of [
    "headScale", "neckLength", "neckWidth", "thoraxWidth", "bellyDepth",
    "muzzleLength", "mouthWidth", "mouthDepth", "jawTaper", "lipCurl",
    "wingSpan", "hornScale", "eyeScale", "earLength", "earWidth",
    "earDroop", "earRotation", "tailLength", "tailThickness", "tailCurl",
    "tailTuft", "tongueWidth",
  ]) {
    bodyShape[name] = sampleFar(safe.bodyShape[name], CREATURAZOID_SHAPE_LIMITS[name]);
  }
  bodyShape.earType = differentRandomItem(CREATURAZOID_EAR_TYPES, safe.bodyShape.earType, randomUnit);
  bodyShape.tailType = differentRandomItem(CREATURAZOID_TAIL_TYPES, safe.bodyShape.tailType, randomUnit);
  bodyShape.tongueAnatomy = differentRandomItem(
    ["human", "macaque", "canine", "avian"],
    safe.bodyShape.tongueAnatomy,
    randomUnit,
  );

  const bodyState = { ...safe.bodyState };
  for (const name of [
    "pressure", "tension", "adduction", "sourceScale", "mouthOpening",
    "cavityCoupling", "asymmetry", "sourceBalance", "roughness",
  ]) {
    const limits = CONTROL_LIMITS[name];
    bodyState[name] = clamp(
      safe.bodyState[name] + randomSigned() * (limits[1] - limits[0]) * 0.1,
      ...limits,
    );
  }
  bodyState.tractLengthM = clamp(
    safe.bodyState.tractLengthM * (2 ** (randomSigned() * 0.28)),
    ...CONTROL_LIMITS.tractLengthM,
  );
  bodyState.tractDiameterScale = clamp(
    safe.bodyState.tractDiameterScale * (2 ** (randomSigned() * 0.2)),
    0.35,
    1.8,
  );
  bodyState.cavityFrequencyHz = clamp(
    safe.bodyState.cavityFrequencyHz * (2 ** (randomSigned() * 0.28)),
    80,
    6_000,
  );
  const morphBias = Object.fromEntries(Object.keys(safe.morphBias).map((key) => [
    key,
    clamp(safe.morphBias[key] + randomSigned() * 0.38, -1, 1),
  ]));

  return sanitizeCreaturazoidState({
    ...safe,
    anatomyDesignId: differentRandomItem(
      CREATURAZOID_ANATOMY_DESIGNS.map(({ id }) => id),
      safe.anatomyDesignId,
      randomUnit,
    ),
    bodyScale,
    bodyRoundness,
    attackMs: safe.attackMs + randomSigned() * 8,
    morph: clamp(safe.morph + randomSigned() * 0.24),
    pitchSemitones: safe.pitchSemitones + Math.round(randomSigned() * 7),
    timbre: clamp(safe.timbre + randomSigned() * 0.42, -1, 1),
    morphTimeMs: safe.morphTimeMs + randomSigned() * 45,
    vibratoRateHz: safe.vibratoRateHz + randomSigned() * 4,
    vibratoDepthSemitones: safe.vibratoDepthSemitones + randomSigned() * 1.2,
    modulationRateHz: safe.modulationRateHz + randomSigned() * 4,
    modulationDepth: safe.modulationDepth + randomSigned() * 0.3,
    earSpread: sampleFar(safe.earSpread, CREATURAZOID_LIMITS.earSpread, 0.2),
    tongueReach: sampleFar(safe.tongueReach, CREATURAZOID_LIMITS.tongueReach, 0.24),
    tongueMotion: sampleFar(safe.tongueMotion, CREATURAZOID_LIMITS.tongueMotion, 0.2),
    bodyState,
    bodyShape,
    morphBias,
  }, safe);
}

function bodyPresetForState(candidate) {
  return creaturazoidBodyPreset(candidate?.bodyPresetId ?? candidate?.voicePresetId);
}

/**
 * Gives every source family the same persistent specimen dimensions. The call
 * still chooses its source engine, calibrated fundamental, and native gesture,
 * while its pressure, tissue, tract, cavity, and outlet begin at this body.
 */
export function creaturazoidBodyBaseline(eventOrId, candidate = CREATURAZOID_DEFAULTS) {
  const sound = eventFrom(eventOrId);
  const state = sanitizeCreaturazoidState(candidate);
  const preset = bodyPresetForState(state);
  const native = animalState(sound.animalId, {
    callId: sound.callId,
    active: false,
    loop: false,
    biologicalLock: false,
    level: state.level,
  });
  const body = state.bodyState ?? bodyPresetForState(state).bodyState;
  const sizeRatio = state.bodyScale / Math.max(0.01, preset.shape.bodyScale);
  const roundnessDelta = state.bodyRoundness - preset.shape.bodyRoundness;
  const diameterFactor = (sizeRatio ** 0.85) * (2 ** (roundnessDelta * 0.28));
  const shapedBody = {
    ...body,
    sourceScale: clamp(body.sourceScale * (sizeRatio ** 0.72), ...CONTROL_LIMITS.sourceScale),
    tractLengthM: clamp(body.tractLengthM * (sizeRatio ** 1.12), ...CONTROL_LIMITS.tractLengthM),
    cavityCoupling: clamp(body.cavityCoupling + roundnessDelta * 0.12),
    roughness: clamp(body.roughness + roundnessDelta * 0.08),
    tractDiameterProfile: Object.freeze(body.tractDiameterProfile.map((diameter) => (
      clamp(diameter * (2 ** (roundnessDelta * 0.15)), 0.12, 2.4)
    ))),
    tractDiameterScale: clamp(body.tractDiameterScale * diameterFactor, 0.35, 1.8),
    cavityFrequencyHz: clamp(
      body.cavityFrequencyHz / ((sizeRatio ** 1.08) * (2 ** (roundnessDelta * 0.45))),
      80,
      6_000,
    ),
  };
  const anchored = sanitizeSyrinxState({
    ...native,
    ...Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map((name) => [name, shapedBody[name]])),
    animalId: sound.animalId,
    callId: sound.callId,
    active: false,
    loop: false,
    biologicalLock: false,
    level: state.level,
  }, native);
  const biased = applyCreaturazoidMorphBias(anchored, state.morphBias, state.morph);
  return Object.freeze({
    ...biased,
    animalId: sound.animalId,
    callId: sound.callId,
    sourceModel: sound.family,
    bodyPresetId: state.bodyPresetId,
    bodyScale: state.bodyScale,
    bodyRoundness: state.bodyRoundness,
    attackMs: state.attackMs,
    tractDiameterProfile: shapedBody.tractDiameterProfile,
    tractDiameterScale: shapedBody.tractDiameterScale,
    cavityFrequencyHz: shapedBody.cavityFrequencyHz,
  });
}

export function creaturazoidNativeAttackPhase(eventOrId) {
  const sound = eventFrom(eventOrId);
  const points = CALL_GESTURES[sound.callId]?.curves?.pressure ?? [[0, 0], [1, 0]];
  const peak = Math.max(0, ...points.map(([, value]) => finiteOr(value, 0)));
  const threshold = peak * 0.65;
  return clamp(points.find(([phase, value]) => phase > 0 && value >= threshold)?.[0] ?? 0.08);
}

/** Compress only the native attack prefix, then map the remaining contour
 * monotonically onto the rest of the one-shot duration. Later pressure peaks
 * keep their order and the gesture still ends at exactly phase one. */
export function creaturazoidAttackPhase(eventOrId, normalizedPhase, candidate = CREATURAZOID_DEFAULTS) {
  const sound = eventFrom(eventOrId);
  const state = sanitizeCreaturazoidState(candidate);
  const phase = clamp(normalizedPhase);
  const nativeAttack = creaturazoidNativeAttackPhase(sound);
  const targetAttack = Math.min(nativeAttack, state.attackMs / Math.max(80, sound.durationMs));
  if (nativeAttack <= targetAttack + 1e-9 || targetAttack <= 1e-9) return phase;
  if (phase <= targetAttack) return clamp(phase / targetAttack * nativeAttack);
  return clamp(
    nativeAttack
      + (phase - targetAttack) / Math.max(1e-9, 1 - targetAttack) * (1 - nativeAttack),
  );
}

/** The first authored phase worth putting directly on a sequencer edge.
 * Vocal calls jump to their established 65%-pressure attack point. Physical
 * actions use an explicit acoustic onset so a closed airway, an approaching
 * claw, or the wind-up of a tail does not consume the rhythmic slot. */
export function creaturazoidSequenceOnsetPhase(eventOrId) {
  const sound = eventFrom(eventOrId);
  return sound.sequenceOnsetPhase == null
    ? creaturazoidNativeAttackPhase(sound)
    : clamp(sound.sequenceOnsetPhase, 0, 0.9);
}

/** Crop, rather than squeeze, the weak native prefix. This constant timeline
 * translation preserves the duration between every retained peak and motion
 * keyframe while putting useful acoustic energy on phase zero. */
export function creaturazoidRhythmicGesturePhase(eventOrId, normalizedPhase) {
  const phase = clamp(normalizedPhase);
  const onset = creaturazoidSequenceOnsetPhase(eventOrId);
  return phase >= 1 ? 1 : onset + phase * (1 - onset);
}

export function creaturazoidSequenceDurationSeconds(eventOrId) {
  const sound = eventFrom(eventOrId);
  return sound.durationMs / 1_000 * (1 - creaturazoidSequenceOnsetPhase(sound));
}

export function creaturazoidLevelMakeup(eventOrId) {
  return clamp(eventFrom(eventOrId).levelMakeup ?? 1, 0.36, 7);
}

export function creaturazoidBodyLevelTrim(eventOrId, candidate = CREATURAZOID_DEFAULTS) {
  const sound = eventFrom(eventOrId);
  const requestedBodyId = typeof candidate === "string"
    ? candidate
    : candidate?.bodyPresetId ?? candidate?.voicePresetId;
  const bodyId = creaturazoidBodyPreset(requestedBodyId).id;
  const familyTrim = CREATURAZOID_BODY_FAMILY_LEVEL_TRIM[bodyId]?.[sound.family] ?? 1;
  const soundTrim = CREATURAZOID_BODY_SOUND_LEVEL_TRIM[bodyId]?.[sound.id] ?? 1;
  return clamp(familyTrim * soundTrim, 0.36, 3.75);
}

/**
 * Sample-addressed control times for one physical gesture. Eight points per
 * fastest modulation cycle keep vibrato fluid, while explicit morph markers
 * ensure that even the 12 ms body transition cannot fall between snapshots.
 */
export function creaturazoidContourOffsets(
  durationSeconds,
  candidate = CREATURAZOID_DEFAULTS,
  soundOrId = null,
  options = {},
) {
  const duration = clamp(finiteOr(durationSeconds, 0.08), 0.001, 3.2);
  const safe = sanitizeCreaturazoidState(candidate);
  const preset = bodyPresetForState(safe);
  const sequenced = Boolean(options?.sequenced ?? options?.rhythmic);
  const nominalRate = Math.max(0.001, preset.settings.modulationRateHz);
  const bodyRateScale = safe.modulationRateHz / nominalRate;
  const fastestBodyMotionHz = Math.max(0, ...preset.modulations.flatMap(({ speed }) => (
    speed.map(([, rateHz]) => rateHz * bodyRateScale)
  )));
  const fastestMotionHz = Math.max(
    safe.vibratoRateHz,
    safe.modulationRateHz,
    fastestBodyMotionHz,
    0.001,
  );
  const controlInterval = clamp(1 / (fastestMotionHz * 8), 0.006, 0.02);
  const offsets = new Set([0, duration]);
  for (let offset = controlInterval; offset < duration; offset += controlInterval) {
    offsets.add(offset);
  }
  const morphDuration = Math.min(duration, safe.morphTimeMs / 1_000);
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
    offsets.add(morphDuration * fraction);
  }
  const attackDuration = Math.min(duration, safe.attackMs / 1_000);
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
    offsets.add(attackDuration * fraction);
  }
  if (soundOrId != null) {
    const sound = typeof soundOrId === "object"
      ? creaturazoidSound(soundOrId.id ?? soundOrId.soundId)
      : creaturazoidSound(soundOrId);
    const onset = sequenced ? creaturazoidSequenceOnsetPhase(sound) : 0;
    const addAuthoredPhase = (phase) => {
      const authored = clamp(finiteOr(phase, 0));
      if (authored + 1e-12 < onset) return;
      offsets.add(clamp((authored - onset) / Math.max(1e-9, 1 - onset)) * duration);
    };
    for (const points of Object.values(CALL_GESTURES[sound.callId]?.curves ?? {})) {
      for (const [phase] of points) addAuthoredPhase(phase);
    }
    for (const modulation of preset.modulations) {
      for (const [phase] of modulation.speed) addAuthoredPhase(phase);
      for (const [phase] of modulation.depth) addAuthoredPhase(phase);
    }
    if (sound.articulation) {
      for (const points of Object.values(sound.articulation.curves)) {
        for (const [phase] of points) addAuthoredPhase(phase);
      }
      const contact = sound.articulation.contact;
      if (contact) {
        for (const [phase] of contact.scrapeGain) addAuthoredPhase(phase);
        for (const strike of contact.strikes) addAuthoredPhase(strike.phase);
      }
    }
  }
  return Object.freeze([...offsets].sort((left, right) => left - right));
}

function patternLengthFrom(source, requestedLength) {
  if (Number.isFinite(Number(requestedLength))) {
    return integerInRange(requestedLength, 16, 1, CREATURAZOID_MAX_STEPS);
  }
  if (Number.isFinite(Number(source?.length))) {
    return integerInRange(source.length, 16, 1, CREATURAZOID_MAX_STEPS);
  }
  if (Number.isFinite(Number(source?.stepCount))) {
    return integerInRange(source.stepCount, 16, 1, CREATURAZOID_MAX_STEPS);
  }
  const rows = source?.rows ?? source;
  const longestRow = rows && typeof rows === "object" && !Array.isArray(rows)
    ? Math.max(0, ...Object.values(rows).map((values) => Array.isArray(values) ? values.length : 0))
    : 0;
  return integerInRange(longestRow || CREATURAZOID_DEFAULTS.patternLength, 16, 1, CREATURAZOID_MAX_STEPS);
}

function stepVelocity(value) {
  if (value && typeof value === "object") {
    return clamp(value.velocity ?? value.dynamic ?? value.amount ?? 0);
  }
  return clamp(value);
}

export function sanitizeCreaturazoidPattern(source = creaturazoidSequencePreset(), requestedLength) {
  const resolved = typeof source === "string" ? creaturazoidSequencePreset(source) : source;
  const candidate = resolved && typeof resolved === "object" ? resolved : {};
  const length = patternLengthFrom(candidate, requestedLength);
  const inputRows = candidate.rows ?? (Array.isArray(candidate) ? {} : candidate);
  const inputSteps = candidate.steps ?? (Array.isArray(candidate) ? candidate : null);
  const rows = Object.fromEntries(CREATURAZOID_SOUNDS.map(({ id }) => [
    id,
    Array(CREATURAZOID_MAX_STEPS).fill(0),
  ]));

  for (let step = 0; step < length; step += 1) {
    let winner = null;
    let winnerVelocity = 0;
    for (const sound of CREATURAZOID_SOUNDS) {
      const velocity = stepVelocity(inputRows?.[sound.id]?.[step]);
      if (velocity > winnerVelocity) {
        winner = sound;
        winnerVelocity = velocity;
      }
    }
    if (winner) rows[winner.id][step] = winnerVelocity;

    if (Array.isArray(inputSteps) && step < inputSteps.length) {
      const column = inputSteps[step];
      const soundId = typeof column === "string" ? column : column?.soundId ?? column?.id;
      const explicitSound = soundById.get(String(soundId ?? ""));
      for (const values of Object.values(rows)) values[step] = 0;
      if (explicitSound) {
        const velocity = typeof column === "string" ? 0.72 : stepVelocity(column);
        if (velocity > 0) rows[explicitSound.id][step] = velocity;
      }
    }
  }
  return { length, stepCount: length, rows };
}

export function cloneCreaturazoidPattern(source = creaturazoidSequencePreset(), requestedLength) {
  return sanitizeCreaturazoidPattern(source, requestedLength);
}

const wrappedStep = (step, length) => (
  (Math.trunc(finiteOr(step, 0)) % length + length) % length
);

export function creaturazoidStepEvent(pattern, step) {
  const safe = sanitizeCreaturazoidPattern(pattern);
  const index = wrappedStep(step, safe.length);
  for (const sound of CREATURAZOID_SOUNDS) {
    const velocity = safe.rows[sound.id][index];
    if (velocity > 0) {
      return Object.freeze({
        soundId: sound.id,
        velocity,
        dynamic: velocity,
        step: index,
        sound,
      });
    }
  }
  return null;
}

export function creaturazoidEventsAtStep(pattern, step) {
  const event = creaturazoidStepEvent(pattern, step);
  return Object.freeze(event ? [event] : []);
}

export function setCreaturazoidStep(pattern, step, soundOrId = null, velocity = 0.72) {
  const safe = sanitizeCreaturazoidPattern(pattern);
  const index = wrappedStep(step, safe.length);
  const soundId = typeof soundOrId === "object" ? soundOrId?.id ?? soundOrId?.soundId : soundOrId;
  const sound = soundById.get(String(soundId ?? ""));
  const amount = stepVelocity(velocity);
  const rows = Object.fromEntries(Object.entries(safe.rows).map(([id, values]) => [id, [...values]]));
  for (const values of Object.values(rows)) values[index] = 0;
  if (sound && amount > 0) rows[sound.id][index] = amount;
  return { length: safe.length, stepCount: safe.length, rows };
}

export function cycleCreaturazoidDynamics(value) {
  const current = stepVelocity(value);
  const exactIndex = CREATURAZOID_DYNAMICS.findIndex((candidate) => (
    Math.abs(candidate - current) < 0.02
  ));
  if (exactIndex >= 0) {
    return CREATURAZOID_DYNAMICS[(exactIndex + 1) % CREATURAZOID_DYNAMICS.length];
  }
  return CREATURAZOID_DYNAMICS.find((candidate) => candidate > current) ?? 0;
}

export function cycleCreaturazoidStep(pattern, step, soundOrId) {
  const safe = sanitizeCreaturazoidPattern(pattern);
  const soundId = typeof soundOrId === "object" ? soundOrId?.id ?? soundOrId?.soundId : soundOrId;
  const sound = soundById.get(String(soundId ?? ""));
  if (!sound) return setCreaturazoidStep(safe, step, null, 0);
  const current = creaturazoidStepEvent(safe, step);
  const nextVelocity = current?.soundId === sound.id
    ? cycleCreaturazoidDynamics(current.velocity)
    : 0.72;
  return setCreaturazoidStep(safe, step, sound.id, nextVelocity);
}

export function creaturazoidStepIntervalSeconds(tempo, swing = 0, step = 0) {
  const bpm = clamp(tempo, ...CREATURAZOID_LIMITS.tempo);
  const amount = clamp(swing, ...CREATURAZOID_LIMITS.swing);
  const straightSixteenth = 15 / bpm;
  return straightSixteenth * (Math.trunc(finiteOr(step, 0)) % 2 === 0 ? 1 + amount : 1 - amount);
}

export const sequenceStepIntervalSeconds = creaturazoidStepIntervalSeconds;

export function applyCreaturazoidMorphBias(candidate, morphBias = EMPTY_MORPH_BIAS, amount = 1) {
  const base = sanitizeSyrinxState({ ...candidate, biologicalLock: false });
  const bias = sanitizeMorphBias(morphBias);
  const depth = clamp(amount);
  const next = { ...base, biologicalLock: false };
  for (const name of CREATURAZOID_MORPH_CONTROLS) {
    const signed = bias[name] * depth;
    const [minimum, maximum] = CONTROL_LIMITS[name];
    next[name] = name === "tractLengthM"
      ? clamp(base[name] * (2 ** (signed * 1.7)), minimum, maximum)
      : clamp(base[name] + signed * (maximum - minimum) * 0.32, minimum, maximum);
  }
  return {
    ...sanitizeSyrinxState(next, base),
    active: Boolean(candidate?.active),
    biologicalLock: false,
    ...(Number.isFinite(Number(candidate?.sourceFrequencyRatio))
      ? { sourceFrequencyRatio: clamp(candidate.sourceFrequencyRatio, 0.03, 24) }
      : {}),
  };
}

function eventFrom(eventOrId) {
  if (typeof eventOrId === "string") return soundById.get(eventOrId) ?? CREATURAZOID_SOUNDS[0];
  const id = eventOrId?.soundId ?? eventOrId?.id;
  return soundById.get(String(id ?? "")) ?? CREATURAZOID_SOUNDS[0];
}

function eventResolutionOptions(stateOrOptions, maybeOptions) {
  const candidate = stateOrOptions && typeof stateOrOptions === "object" ? stateOrOptions : {};
  const isOptions = [
    "state", "globalState", "phase", "gesturePhase", "elapsedSeconds", "velocity", "dynamic",
    "sequenced", "rhythmic",
  ].some((name) => Object.hasOwn(candidate, name));
  if (isOptions) return { ...candidate, state: candidate.state ?? candidate.globalState ?? candidate };
  return { ...(maybeOptions ?? {}), state: candidate };
}

// Exact integral of the smoothstep-interpolated Hybrinx speed envelope. This
// makes oscillator phase deterministic at a call phase instead of depending
// on when the sequencer happened to start on the AudioContext clock.
function integrateEnvelope(points, normalizedPhase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const end = clamp(normalizedPhase);
  let area = 0;
  let cursor = 0;
  let cursorValue = finiteOr(points[0]?.[1], 0);
  for (let index = 1; index < points.length && cursor < end; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const start = clamp(left[0]);
    const finish = clamp(right[0]);
    if (start > cursor) {
      const flatEnd = Math.min(end, start);
      area += Math.max(0, flatEnd - cursor) * cursorValue;
      cursor = flatEnd;
      if (cursor >= end) break;
    }
    const span = Math.max(1e-9, finish - start);
    const segmentEnd = Math.min(end, finish);
    const amount = clamp((segmentEnd - start) / span);
    const leftValue = finiteOr(left[1], 0);
    const delta = finiteOr(right[1], 0) - leftValue;
    const easedArea = amount ** 3 - 0.5 * amount ** 4;
    area += span * (leftValue * amount + delta * easedArea);
    cursor = segmentEnd;
    cursorValue = sampleGestureCurve(points, cursor);
  }
  if (cursor < end) area += (end - cursor) * cursorValue;
  return area;
}

function applyBodyMotion(candidate, sound, callPhase, globalState) {
  const preset = bodyPresetForState(globalState);
  const nominalRate = Math.max(0.001, preset.settings.modulationRateHz);
  const nominalDepth = Math.max(0.001, preset.settings.modulationDepth);
  const rateScale = globalState.modulationRateHz / nominalRate;
  const depthScale = globalState.modulationDepth / nominalDepth;
  const durationSeconds = Math.max(0.08, sound.durationMs / 1_000);
  const next = { ...candidate };
  const resolvedModulators = [];

  for (const modulation of preset.modulations) {
    const [minimum, maximum] = CONTROL_LIMITS[modulation.target];
    const rateHz = clamp(sampleGestureCurve(modulation.speed, callPhase) * rateScale, 0.02, 30);
    const depth = clamp(sampleGestureCurve(modulation.depth, callPhase) * depthScale);
    const oscillatorPhase = modulation.phase
      + integrateEnvelope(modulation.speed, callPhase) * durationSeconds * rateScale;
    const wave = sampleModulationWave(modulation.shape, oscillatorPhase, sound.id.length);
    if (modulation.target === "pressure") {
      // A body tremor may articulate air that is already flowing, but it must
      // never create a pre-onset drone or erase the call's authored rests.
      next.pressure = clamp(next.pressure * (1 + wave * depth * 0.5), minimum, maximum);
    } else {
      next[modulation.target] = clamp(
        next[modulation.target] + wave * depth * (maximum - minimum) * 0.5,
        minimum,
        maximum,
      );
    }
    resolvedModulators.push(Object.freeze({
      target: modulation.target,
      shape: modulation.shape,
      rateHz,
      depth,
      wave,
      oscillatorPhase,
    }));
  }

  const sourceFrequencyRatio = candidate.sourceFrequencyRatio;
  return Object.freeze({
    host: Object.freeze({
      ...sanitizeSyrinxState(next, candidate),
      active: Boolean(candidate.active),
      gesturePhase: finiteOr(candidate.gesturePhase, callPhase),
      ...(Number.isFinite(sourceFrequencyRatio) ? { sourceFrequencyRatio } : {}),
    }),
    rateScale,
    depthScale,
    modulators: Object.freeze(resolvedModulators),
  });
}

const GROWLY_TONGUE_SOUND_IDS = new Set([
  "roar", "chuff", "growl", "rumble", "bellow", "gator", "purr",
  "cervid", "harsh", "moose", "moan", "grunt", "moo", "lowmoo",
  "snap-bark", "panting", "crunching",
]);

const CHIRPY_TONGUE_SOUND_IDS = new Set([
  "yip", "giggle", "croak", "rattle", "trill", "phrase", "chirp",
  "frogtrill", "ticks", "caw", "feather-ruffle",
]);

/**
 * Resolve the visible tongue and the Hybrinx area-function articulator from
 * one shared state. Body dimensions provide the persistent anatomy; each
 * gesture only moves that attached organ through a call-local trajectory.
 */
export function creaturazoidTongueState(performanceState = {}, candidate = CREATURAZOID_DEFAULTS) {
  const safe = sanitizeCreaturazoidState(candidate);
  const shape = safe.bodyShape ?? bodyPresetForState(safe).shape;
  const soundId = String(performanceState.soundId ?? "growl");
  const articulationMotion = String(performanceState.articulation?.motion ?? "vocal");
  const phase = clamp(
    performanceState.articulationPhase
      ?? performanceState.authoredPhase
      ?? performanceState.gesturePhase
      ?? 0,
  );
  const callPhase = clamp(performanceState.callPhase ?? phase);
  const active = Boolean(performanceState.active);
  const velocity = clamp(performanceState.velocity ?? 0);
  const envelope = active
    ? clamp(performanceState.bodyMotion?.envelope ?? performanceState.pressure ?? 0)
    : 0;
  const motionAmount = safe.tongueMotion * envelope * (0.35 + velocity * 0.65);
  const voicedWave = active
    ? Math.sin(callPhase * Math.PI * (4 + safe.tongueMotion * 12)) * motionAmount
    : 0;
  const fourBeatContact = active
    ? Math.max(0, Math.cos(phase * Math.PI * 8)) ** 6
    : 0;
  const irregularContact = active
    ? Math.max(0, Math.sin(phase * Math.PI * 7 + 0.38)) ** 4
    : 0;
  const growly = GROWLY_TONGUE_SOUND_IDS.has(soundId) ? 1 : 0;
  const chirpy = CHIRPY_TONGUE_SOUND_IDS.has(soundId) ? 1 : 0;
  const lap = articulationMotion === "lap" ? fourBeatContact : 0;
  const crunch = articulationMotion === "crunch" ? irregularContact : 0;
  const pant = articulationMotion === "pant" ? fourBeatContact : 0;
  const caw = articulationMotion === "caw" ? Math.max(0, 1 - phase * 7) : 0;
  const roundness = clamp(safe.bodyRoundness, -1, 1);
  // A physically broader mouth needs more lift to displace a comparable
  // fraction of its airway; very small bodies get relief so chirps stay fast.
  const bodyOcclusionLift = clamp(
    Math.max(0, roundness) * 0.12 + Math.max(0, safe.bodyScale - 1) * 0.18,
    0,
    0.2,
  );
  const compactRelief = clamp(
    Math.max(0, -roundness) * 0.055 + Math.max(0, 0.8 - safe.bodyScale) * 0.08,
    0,
    0.08,
  );

  return Object.freeze(sanitizeTongueState({
    tongueEnabled: true,
    tongueAnatomy: shape.tongueAnatomy ?? "canine",
    tonguePosition: clamp(
      0.4 - roundness * 0.08 - growly * 0.09 + chirpy * 0.31
        + voicedWave * 0.11 + lap * 0.18 - crunch * 0.09,
      0.16,
      0.9,
    ),
    tongueHeight: clamp(
      0.3 + safe.tongueMotion * 0.13 + growly * 0.08 + chirpy * 0.24
        + bodyOcclusionLift - compactRelief
        + Math.max(0, voicedWave) * 0.2 + lap * 0.45 + crunch * 0.4 + caw * 0.12,
      0.16,
      0.92,
    ),
    tongueShape: clamp(
      0.38 - growly * 0.16 + chirpy * 0.34 + Math.abs(voicedWave) * 0.14 + crunch * 0.18,
      0.16,
      0.88,
    ),
    tongueTip: clamp(
      0.28 + chirpy * 0.3 + bodyOcclusionLift * 0.65 - compactRelief * 0.5
        + Math.max(0, voicedWave) * 0.22
        + lap * 0.46 + crunch * 0.42 + caw * 0.18,
      0.1,
      0.92,
    ),
    tongueExtension: clamp(
      0.05 + safe.tongueReach * (active ? 0.78 : 0.68) + envelope * 0.08
        + lap * 0.3 + pant * 0.18 + caw * 0.08,
      0.04,
      0.96,
    ),
    tongueCurl: clamp(
      0.46 + finiteOr(shape.lipCurl, 0) * 0.12 + voicedWave * 0.22
        + lap * 0.24 - pant * 0.18 + crunch * 0.3,
      0.08,
      0.94,
    ),
    tongueLateral: clamp(
      0.1 + growly * 0.1 + Math.abs(voicedWave) * 0.12 + pant * 0.08 + lap * 0.04,
      0.05,
      0.38,
    ),
  }));
}

/**
 * Resolves one sequencer event into a complete, unlocked Hybrinx state.
 * The second argument may be either a Creaturazoid state or an options object
 * containing state, phase, elapsedSeconds, and velocity.
 */
export function resolveCreaturazoidEventState(eventOrId, stateOrOptions = CREATURAZOID_DEFAULTS, maybeOptions = {}) {
  const sound = eventFrom(eventOrId);
  const options = eventResolutionOptions(stateOrOptions, maybeOptions);
  const globalState = sanitizeCreaturazoidState(options.state);
  const phase = clamp(options.phase ?? options.gesturePhase ?? 0);
  const velocity = clamp(options.velocity ?? options.dynamic ?? 1);
  const sequenced = Boolean(options.sequenced ?? options.rhythmic);
  const authoredPhase = sequenced
    ? creaturazoidRhythmicGesturePhase(sound, phase)
    : phase;
  const callPhase = sequenced
    ? authoredPhase
    : creaturazoidAttackPhase(sound, phase, globalState);
  const base = creaturazoidBodyBaseline(sound, globalState);
  const effectiveTimbre = clamp(
    globalState.timbre + sound.timbre * 0.42,
    -1,
    1,
  );
  const timbreState = applyCreaturazoidMorphBias(base, {
    tension: effectiveTimbre * 0.2,
    sourceScale: effectiveTimbre * -0.14,
    tractLengthM: effectiveTimbre * -0.1,
    mouthOpening: effectiveTimbre * 0.22,
    cavityCoupling: effectiveTimbre * -0.12,
    roughness: effectiveTimbre < 0 ? Math.abs(effectiveTimbre) * 0.18 : effectiveTimbre * -0.08,
  });
  const gestured = interpolateGesture(sound.callId, callPhase, timbreState);
  const bodyMotionResolution = applyBodyMotion(gestured, sound, callPhase, globalState);
  const modulated = bodyMotionResolution.host;
  const articulationPhase = sequenced ? authoredPhase : phase;
  const articulation = creaturazoidArticulationAt(sound, articulationPhase);
  const articulatedPressure = sound.articulation
    ? Math.max(
      modulated.pressure * articulation.voicing,
      base.pressure * articulation.pressure,
    )
    : modulated.pressure;
  const localSeconds = phase * sound.durationMs / 1_000 * (
    sequenced ? 1 - creaturazoidSequenceOnsetPhase(sound) : 1
  );
  const vibratoValue = sampleModulationWave("sine", localSeconds * globalState.vibratoRateHz);
  const effectivePitchSemitones = clamp(
    globalState.pitchSemitones
      + sound.pitchSemitones
      + vibratoValue * globalState.vibratoDepthSemitones,
    -48,
    48,
  );
  const sourceFrequencyRatio = clamp(
    (gestured.sourceFrequencyRatio ?? 1) * (2 ** (effectivePitchSemitones / 12)),
    0.03,
    24,
  );
  const sounding = sanitizeSyrinxState({
    ...modulated,
    pressure: articulatedPressure * (0.24 + velocity * 0.76),
    level: globalState.level * velocity,
    active: phase < 1 && velocity > 0,
    biologicalLock: false,
  }, base);
  const authoredEnvelope = clamp(
    base.pressure > 1e-6 ? gestured.pressure / base.pressure : 0,
  );
  const bodyMotion = Object.freeze({
    envelope: authoredEnvelope,
    rateScale: bodyMotionResolution.rateScale,
    depthScale: bodyMotionResolution.depthScale,
    modulators: bodyMotionResolution.modulators,
  });

  const resolved = {
    ...sounding,
    soundId: sound.id,
    sourceFamily: sound.family,
    active: phase < 1 && velocity > 0,
    biologicalLock: false,
    gesturePhase: phase,
    authoredPhase,
    callPhase,
    sourceFrequencyRatio,
    effectivePitchSemitones,
    effectiveTimbre,
    modulationValue: bodyMotion.modulators[0]?.wave ?? 0,
    bodyMotion,
    bodyPresetId: globalState.bodyPresetId,
    bodyScale: globalState.bodyScale,
    bodyRoundness: globalState.bodyRoundness,
    attackMs: globalState.attackMs,
    tractDiameterProfile: base.tractDiameterProfile,
    tractDiameterScale: base.tractDiameterScale,
    cavityFrequencyHz: base.cavityFrequencyHz,
    velocity,
    morphTimeMs: globalState.morphTimeMs,
    articulation,
    articulationPhase,
    gestureType: sound.gestureType,
    sequenced,
  };
  resolved.tongue = creaturazoidTongueState(resolved, globalState);
  return resolved;
}

export function creaturazoidQuickMorphProgress(elapsedMs, durationMs = CREATURAZOID_QUICK_MORPH.durationMs) {
  const elapsed = Math.max(0, finiteOr(elapsedMs, 0));
  const duration = clamp(durationMs, CREATURAZOID_QUICK_MORPH.minimumMs, CREATURAZOID_QUICK_MORPH.maximumMs);
  const linear = clamp(elapsed / duration);
  return linear * linear * (3 - 2 * linear);
}

export function interpolateCreaturazoidMorph(fromState, toState, amount, options = {}) {
  const from = sanitizeSyrinxState({ ...fromState, biologicalLock: false });
  const to = sanitizeSyrinxState({ ...toState, biologicalLock: false });
  const linear = clamp(amount);
  const mix = options.curve === "linear" ? linear : linear * linear * (3 - 2 * linear);
  const targetIdentity = mix >= 0.5;
  const identity = targetIdentity ? to : from;
  const result = {
    ...identity,
    biologicalLock: false,
    active: mix <= 0
      ? Boolean(fromState?.active)
      : mix >= 1
        ? Boolean(toState?.active)
        : Boolean(fromState?.active || toState?.active),
  };
  for (const name of Object.keys(CONTROL_LIMITS)) {
    const [minimum, maximum] = CONTROL_LIMITS[name];
    result[name] = clamp(from[name] + (to[name] - from[name]) * mix, minimum, maximum);
  }
  result.gesturePhase = clamp(
    finiteOr(fromState?.gesturePhase, 0)
      + (finiteOr(toState?.gesturePhase, 0) - finiteOr(fromState?.gesturePhase, 0)) * mix,
  );
  result.sourceFrequencyRatio = clamp(
    finiteOr(fromState?.sourceFrequencyRatio, 1)
      + (finiteOr(toState?.sourceFrequencyRatio, 1) - finiteOr(fromState?.sourceFrequencyRatio, 1)) * mix,
    0.03,
    24,
  );
  return result;
}
