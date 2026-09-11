import {
  SIMD_SYNTH_DEFAULTS,
  SIMD_SYNTH_DEFAULT_MOD_ROUTES,
  SIMD_SYNTH_DEFAULT_SEQUENCE,
  createSimdSynthSequence,
  sanitizeSimdSynthModRoutes,
  sanitizeSimdSynthParams,
  sanitizeSimdSynthSequence,
} from "./simd-synth.js";

const freeze = Object.freeze;

function preset(id, label, category, description, overrides = {}, sequence = null, modRoutes = null) {
  return freeze({
    id,
    label,
    category,
    description,
    params: freeze(sanitizeSimdSynthParams({ ...SIMD_SYNTH_DEFAULTS, ...overrides })),
    sequence: freeze(sanitizeSimdSynthSequence(sequence ?? SIMD_SYNTH_DEFAULT_SEQUENCE).map((step) => freeze(step))),
    modRoutes: freeze(sanitizeSimdSynthModRoutes(modRoutes ?? SIMD_SYNTH_DEFAULT_MOD_ROUTES).map((route) => freeze(route))),
  });
}

const route = (source, destination, amount) => [source, destination, amount, 0];

export const SIMD_SYNTH_PRESETS = freeze([
  preset(
    "vector-dawn", "Vector Dawn", "Foundation",
    "A bright table voice and a restrained FM octave meet in a gentle morph, then pass through serial low- and band-pass stages.",
  ),
  preset(
    "rubber-bass", "Rubber Bass", "Foundation",
    "Two low folded sources ring softly through a resonant low-pass and a short slippery comb for elastic bass movement.",
    { sourceA: 2, sourceB: 0, tuneB: -12, colorA: 0.28, colorB: 0.72, detailA: 5, detailB: 12, combine: 2, combineMix: 0.58, combineDrive: 2.1, shaper: 1, shaperAmount: 0.42, filter1: 1, cutoff1: 980, resonance1: 0.68, filter2: 0, filterRoute: 2, attack: 0.004, decay: 0.22, sustain: 0.7, release: 0.24, fx1: 4, fx1Amount: 0.28, fx1Time: 0.031, fx1Feedback: 0.42, fx2: 0, rootNote: 31, bpm: 106, gateLength: 0.82, stereo: 0.28 },
    createSimdSynthSequence(9321, 0.78),
    [route(1, 2, 0.18), route(5, 8, 0.22), route(8, 6, 0.64), route(9, 8, 0.9)],
  ),
  preset(
    "glass-cascade", "Glass Cascade", "Polyphonic",
    "Cascade FM and modal metal stack into parallel filters with a long diffusion tail, leaving enough release for overlapping chords.",
    { sourceA: 1, sourceB: 3, tuneA: 12, tuneB: 0, colorA: 0.18, colorB: 0.66, detailA: 4, detailB: 16, combine: 1, combineMix: 0.5, combineDrive: 0.82, shaper: 0, filter1: 2, cutoff1: 2600, resonance1: 0.58, filter2: 3, cutoff2: 5100, resonance2: 0.28, filterRoute: 2, filterBlend: 0.38, attack: 0.006, decay: 1.4, sustain: 0.2, release: 3.8, fx1: 1, fx1Amount: 0.34, fx1Time: 0.022, fx2: 5, fx2Amount: 0.36, fx2Time: 0.19, fx2Feedback: 0.62, rootNote: 55, bpm: 82, gateLength: 0.34, stereo: 0.94 },
    createSimdSynthSequence(8271, 0.48),
    [route(2, 4, 0.34), route(3, 10, 0.28), route(8, 6, 0.72), route(9, 9, 0.74)],
  ),
  preset(
    "drawbar-orbit", "Drawbar Orbit", "Polyphonic",
    "Two additive organs an octave apart use voice-split filters, slow chorus, and a moving stereo field for broad sustained harmony.",
    { sourceA: 5, sourceB: 5, tuneB: 12, colorA: 0.34, colorB: 0.66, motionA: 0.72, motionB: 0.48, detailA: 9, detailB: 7, combine: 1, combineDrive: 0.68, shaper: 0, filter1: 1, cutoff1: 6800, resonance1: 0.18, filter2: 2, cutoff2: 1800, resonance2: 0.44, filterRoute: 3, attack: 0.16, decay: 0.8, sustain: 0.86, release: 2.8, fx1: 1, fx1Amount: 0.48, fx1Time: 0.027, fx1Feedback: 0.18, fx2: 3, fx2Amount: 0.18, fx2Time: 0.42, fx2Feedback: 0.32, rootNote: 36, bpm: 74, gateLength: 0.92, stereo: 1 },
    createSimdSynthSequence(31991, 0.6),
    [route(1, 4, 0.42), route(2, 5, -0.3), route(8, 6, 0.82), route(9, 12, 0.76)],
  ),
  preset(
    "acid-alloy", "Acid Alloy", "Sequence",
    "A dense vector saw drives an FM partner through phase modulation, fold shaping, and two serial filters for an aggressive animated line.",
    { sourceA: 0, sourceB: 1, tuneB: 0, colorA: 0.94, colorB: 0.82, motionA: 0.42, motionB: 0.78, detailA: 24, detailB: 4, combine: 4, combineMix: 0.52, combineDrive: 2.8, shaper: 2, shaperAmount: 0.48, toneOrder: 0, filter1: 1, cutoff1: 2100, resonance1: 0.78, filter2: 2, cutoff2: 3300, resonance2: 0.62, filterRoute: 0, attack: 0.003, decay: 0.14, sustain: 0.5, release: 0.12, fx1: 2, fx1Amount: 0.18, fx1Time: 0.004, fx1Feedback: 0.52, fx2: 3, fx2Amount: 0.22, fx2Time: 0.19, fx2Feedback: 0.46, rootNote: 34, bpm: 132, swing: 0.18, gateLength: 0.58, stereo: 0.52 },
    createSimdSynthSequence(17011, 0.84),
    [route(3, 8, 0.52), route(1, 4, 0.28), route(8, 6, 0.86), route(9, 8, 0.98)],
  ),
  preset(
    "vowel-silk", "Vowel Silk", "Motion",
    "A formant bank dissolves into additive organ tone while the Y gesture sweeps a parallel band-pass path and chorus adds liquid width.",
    { sourceA: 6, sourceB: 5, tuneB: 0, colorA: 0.36, colorB: 0.44, motionA: 0.7, motionB: 0.34, detailA: 12, detailB: 9, combine: 0, combineMix: 0.26, combineDrive: 0.72, shaper: 1, shaperAmount: 0.12, filter1: 2, cutoff1: 1200, resonance1: 0.64, filter2: 2, cutoff2: 3600, resonance2: 0.52, filterRoute: 2, filterBlend: 0.58, attack: 0.08, decay: 0.6, sustain: 0.82, release: 1.8, fx1: 1, fx1Amount: 0.46, fx1Time: 0.024, fx1Feedback: 0.22, fx2: 4, fx2Amount: 0.24, fx2Time: 0.052, fx2Feedback: 0.38, rootNote: 48, bpm: 88, gateLength: 0.84, stereo: 0.84 },
    createSimdSynthSequence(4221, 0.52),
    [route(1, 2, 0.24), route(2, 5, 0.3), route(8, 6, 0.92), route(9, 9, 0.94)],
  ),
  preset(
    "particle-rain", "Particle Rain", "Motion",
    "Two particle clouds use opposite motion and a voice-split filter route, scattering short notes into a diffuse stereo rain.",
    { sourceA: 4, sourceB: 4, tuneA: 12, tuneB: 19, colorA: 0.54, colorB: 0.82, motionA: 0.88, motionB: 0.64, detailA: 14, detailB: 9, combine: 1, combineDrive: 0.58, shaper: 5, shaperAmount: 0.12, filter1: 3, cutoff1: 7400, resonance1: 0.18, filter2: 2, cutoff2: 2400, resonance2: 0.48, filterRoute: 3, attack: 0.002, decay: 0.18, sustain: 0.08, release: 0.42, fx1: 3, fx1Amount: 0.38, fx1Time: 0.36, fx1Feedback: 0.58, fx2: 5, fx2Amount: 0.28, fx2Time: 0.11, fx2Feedback: 0.52, rootNote: 50, bpm: 148, swing: 0.24, gateLength: 0.22, stereo: 1 },
    createSimdSynthSequence(57037, 0.58),
    [route(5, 4, 0.42), route(2, 12, 0.38), route(8, 13, 0.76), route(9, 14, 0.7)],
  ),
  preset(
    "modal-web", "Modal Web", "Resonant",
    "Inharmonic banks ring against a low vector fundamental through ring-filter routing, emphasizing brittle attacks and long metallic releases.",
    { sourceA: 3, sourceB: 0, tuneB: -12, colorA: 0.78, colorB: 0.1, motionA: 0.42, motionB: 0.12, detailA: 24, detailB: 8, combine: 1, combineDrive: 0.62, shaper: 3, shaperAmount: 0.18, toneOrder: 1, filter1: 2, cutoff1: 2900, resonance1: 0.74, filter2: 1, cutoff2: 6100, resonance2: 0.36, filterRoute: 4, filterBlend: 0.46, attack: 0.002, decay: 1.7, sustain: 0.04, release: 4.4, fx1: 1, fx1Amount: 0.24, fx2: 5, fx2Amount: 0.42, fx2Time: 0.28, fx2Feedback: 0.68, rootNote: 45, bpm: 68, gateLength: 0.18, stereo: 0.96 },
    createSimdSynthSequence(50147, 0.38),
    [route(3, 4, 0.3), route(1, 10, 0.28), route(8, 7, 0.64), route(9, 8, 0.86)],
  ),
  preset(
    "byte-teeth", "Byte Teeth", "Digital",
    "SIMD integer bytebeat scrapes against a folded table, then bit crushing and a fast ping-pong line expose sharp coded rhythms.",
    { sourceA: 7, sourceB: 2, tuneA: -12, tuneB: 12, colorA: 0.72, colorB: 0.84, motionA: 0.9, motionB: 0.74, detailA: 17, detailB: 6, combine: 5, combineMix: 0.42, combineDrive: 1.7, shaper: 5, shaperAmount: 0.58, filter1: 1, cutoff1: 4200, resonance1: 0.5, filter2: 3, cutoff2: 8300, resonance2: 0.2, filterRoute: 2, attack: 0.002, decay: 0.09, sustain: 0.3, release: 0.08, fx1: 2, fx1Amount: 0.36, fx1Time: 0.003, fx1Feedback: 0.64, fx2: 3, fx2Amount: 0.3, fx2Time: 0.073, fx2Feedback: 0.7, rootNote: 29, bpm: 164, swing: 0.31, gateLength: 0.44, stereo: 0.72, seed: 61169 },
    createSimdSynthSequence(61169, 0.9),
    [route(5, 3, 0.46), route(4, 7, 0.52), route(8, 6, 0.74), route(9, 8, 0.82)],
  ),
  preset(
    "feedback-reef", "Feedback Reef", "Extreme",
    "Formant and modal sources enter the bounded feedback filter route before a slow slippery comb, producing unstable-looking but limited reefs.",
    { sourceA: 6, sourceB: 3, tuneB: -5, colorA: 0.82, colorB: 0.6, motionA: 0.94, motionB: 0.72, detailA: 12, detailB: 22, combine: 3, combineMix: 0.7, combineDrive: 2.2, shaper: 2, shaperAmount: 0.36, toneOrder: 1, filter1: 2, cutoff1: 1380, resonance1: 0.86, filter2: 1, cutoff2: 4700, resonance2: 0.7, filterRoute: 5, filterBlend: 0.62, attack: 0.014, decay: 0.72, sustain: 0.58, release: 2.2, fx1: 4, fx1Amount: 0.58, fx1Time: 0.084, fx1Feedback: 0.74, fx2: 5, fx2Amount: 0.4, fx2Time: 0.22, fx2Feedback: 0.72, rootNote: 38, bpm: 97, swing: 0.17, gateLength: 0.76, stereo: 0.9 },
    createSimdSynthSequence(47231, 0.7),
    [route(5, 10, 0.4), route(1, 5, 0.48), route(8, 6, 0.94), route(9, 8, 1)],
  ),
  preset(
    "phase-choir", "Phase Choir", "Polyphonic",
    "Formant voices phase-modulate a soft organ with slow envelopes, letting held keyboard chords move between breathy and glassy registers.",
    { sourceA: 5, sourceB: 6, tuneB: 12, colorA: 0.28, colorB: 0.48, motionA: 0.38, motionB: 0.58, detailA: 9, detailB: 12, combine: 4, combineMix: 0.2, combineDrive: 0.86, shaper: 1, shaperAmount: 0.08, filter1: 1, cutoff1: 8600, resonance1: 0.12, filter2: 2, cutoff2: 2500, resonance2: 0.34, filterRoute: 2, filterBlend: 0.32, attack: 0.42, decay: 1.8, sustain: 0.78, release: 5.4, fx1: 1, fx1Amount: 0.55, fx1Time: 0.029, fx1Feedback: 0.24, fx2: 5, fx2Amount: 0.44, fx2Time: 0.31, fx2Feedback: 0.7, rootNote: 52, bpm: 56, gateLength: 0.96, stereo: 1 },
    createSimdSynthSequence(60101, 0.34),
    [route(1, 2, 0.2), route(2, 5, -0.22), route(8, 6, 0.88), route(9, 9, 0.82)],
  ),
  preset(
    "cheby-chimes", "Cheby Chimes", "Resonant",
    "Sparse modal attacks pass through a restrained Chebyshev series and opposing band/high filters, making clear pitched chimes with edge.",
    { sourceA: 3, sourceB: 1, tuneA: 12, tuneB: 24, colorA: 0.3, colorB: 0.18, motionA: 0.14, motionB: 0.28, detailA: 14, detailB: 3, combine: 0, combineMix: 0.18, combineDrive: 0.7, shaper: 3, shaperAmount: 0.42, filter1: 2, cutoff1: 3200, resonance1: 0.5, filter2: 3, cutoff2: 7200, resonance2: 0.22, filterRoute: 2, attack: 0.002, decay: 0.58, sustain: 0, release: 2.8, fx1: 3, fx1Amount: 0.28, fx1Time: 0.46, fx1Feedback: 0.58, fx2: 5, fx2Amount: 0.25, fx2Time: 0.14, fx2Feedback: 0.48, rootNote: 60, bpm: 92, gateLength: 0.12, stereo: 0.98 },
    createSimdSynthSequence(14417, 0.32),
    [route(4, 2, 0.28), route(3, 7, 0.34), route(8, 6, 0.78), route(9, 8, 0.7)],
  ),
  preset(
    "split-circuit", "Split Circuit", "Digital",
    "Alternating voices split between low- and high-pass circuits while FM and bytebeat sources subtract into a taut, percussive stereo machine.",
    { sourceA: 1, sourceB: 7, tuneA: 0, tuneB: -12, colorA: 0.84, colorB: 0.38, motionA: 0.74, motionB: 0.66, detailA: 4, detailB: 9, combine: 5, combineMix: 0.54, combineDrive: 1.4, shaper: 1, shaperAmount: 0.28, filter1: 1, cutoff1: 1600, resonance1: 0.6, filter2: 3, cutoff2: 6100, resonance2: 0.4, filterRoute: 3, attack: 0.002, decay: 0.16, sustain: 0.2, release: 0.18, fx1: 2, fx1Amount: 0.22, fx1Time: 0.005, fx1Feedback: 0.48, fx2: 3, fx2Amount: 0.16, fx2Time: 0.12, fx2Feedback: 0.46, rootNote: 36, bpm: 138, swing: 0.12, gateLength: 0.38, stereo: 1 },
    createSimdSynthSequence(36451, 0.82),
    [route(5, 3, 0.3), route(2, 12, 0.45), route(8, 6, 0.68), route(9, 9, 0.84)],
  ),
  preset(
    "slow-tide", "Slow Tide", "Motion",
    "Low vector and formant tones move through reversed filter order and two long time effects for a submerged, slowly shifting drone sequence.",
    { sourceA: 0, sourceB: 6, tuneA: -12, tuneB: 0, colorA: 0.2, colorB: 0.24, motionA: 0.72, motionB: 0.88, detailA: 10, detailB: 12, combine: 0, combineMix: 0.46, combineDrive: 0.58, shaper: 0, toneOrder: 1, filter1: 1, cutoff1: 1300, resonance1: 0.48, filter2: 2, cutoff2: 740, resonance2: 0.7, filterRoute: 1, attack: 0.62, decay: 2.4, sustain: 0.9, release: 6.2, fx1: 4, fx1Amount: 0.5, fx1Time: 0.12, fx1Feedback: 0.68, fx2: 5, fx2Amount: 0.52, fx2Time: 0.42, fx2Feedback: 0.78, fxOrder: 1, rootNote: 28, bpm: 42, gateLength: 1, stereo: 0.82 },
    createSimdSynthSequence(1139, 0.28),
    [route(1, 4, 0.38), route(2, 9, 0.36), route(8, 6, 0.76), route(9, 8, 0.92)],
  ),
  preset(
    "ring-organ", "Ring Organ", "Extreme",
    "Two nine-rank organs ring-modulate across a fifth before feedback filtering and fold shaping turn stable drawbars into a controlled growl.",
    { sourceA: 5, sourceB: 5, tuneA: -12, tuneB: -5, colorA: 0.64, colorB: 0.86, motionA: 0.8, motionB: 0.48, detailA: 9, detailB: 9, combine: 2, combineMix: 0.72, combineDrive: 3.1, shaper: 2, shaperAmount: 0.54, filter1: 1, cutoff1: 2400, resonance1: 0.68, filter2: 2, cutoff2: 1100, resonance2: 0.76, filterRoute: 5, filterBlend: 0.58, attack: 0.03, decay: 0.38, sustain: 0.68, release: 1.2, fx1: 1, fx1Amount: 0.34, fx2: 4, fx2Amount: 0.42, fx2Time: 0.046, fx2Feedback: 0.62, rootNote: 33, bpm: 118, swing: 0.2, gateLength: 0.68, stereo: 0.74 },
    createSimdSynthSequence(41023, 0.74),
    [route(3, 7, 0.46), route(1, 4, 0.28), route(8, 6, 0.98), route(9, 8, 0.92)],
  ),
  preset(
    "mono-init", "Clean Init", "Utility",
    "A reproducible, effects-light starting patch with one dominant vector source, fast recovery, and an easy route back from extreme edits.",
    { sourceA: 0, sourceB: 0, tuneA: 0, tuneB: 12, colorA: 0.08, colorB: 0.08, motionA: 0, motionB: 0, detailA: 8, detailB: 8, combine: 0, combineMix: 0, combineDrive: 0.72, shaper: 0, shaperAmount: 0, filter1: 1, cutoff1: 11000, resonance1: 0.08, filter2: 0, filterRoute: 0, attack: 0.006, decay: 0.3, sustain: 0.78, release: 0.38, stereo: 0.38, drift: 0, fx1: 0, fx1Amount: 0, fx2: 0, fx2Amount: 0, bpm: 110, swing: 0, rootNote: 48, scale: 0, gateLength: 0.72, xyX: 0, xyY: 0.7 },
    SIMD_SYNTH_DEFAULT_SEQUENCE,
    [route(0, 0, 0), route(0, 0, 0), route(8, 6, 0.72), route(9, 8, 0.86)],
  ),
]);

export const SIMD_SYNTH_INIT_PRESET = SIMD_SYNTH_PRESETS.find(({ id }) => id === "mono-init");

export function simdSynthPresetById(id) {
  return SIMD_SYNTH_PRESETS.find((presetEntry) => presetEntry.id === id) ?? SIMD_SYNTH_PRESETS[0];
}
