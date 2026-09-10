import {
  WEBGPU_303_DEFAULTS,
  sanitizeWebGpu303Sequence,
  webGpu303FundamentalFromSourceControl,
} from "./webgpu-303.js";
import {
  SIMD_303_XL_DEFAULTS,
  sanitizeSimd303Params,
  sanitizeSimd303StepExpression,
  sanitizeSimd303XlParams,
} from "./simd-303.js";

const repeatTo = (length, values) => Array.from(
  { length },
  (_, index) => values[index % values.length],
);
const expressionStep = (accent = 0, gate = 1, slide = 0, chance = 1) => (
  [accent, gate, slide, chance]
);
const expressionPattern = (length, values) => repeatTo(length, values);
const tune = (value) => webGpu303FundamentalFromSourceControl(value);

function definePreset({
  id,
  label,
  category,
  description,
  params = {},
  sequence = [],
  xlParams = {},
  stepExpression = [],
}) {
  const expression = sanitizeSimd303StepExpression(stepExpression)
    .map((step) => Object.freeze(step));
  return Object.freeze({
    id,
    label,
    category,
    description,
    params: Object.freeze(sanitizeSimd303Params({ ...WEBGPU_303_DEFAULTS, ...params })),
    sequence: Object.freeze(sanitizeWebGpu303Sequence(sequence)),
    xlParams: Object.freeze(sanitizeSimd303XlParams({ ...SIMD_303_XL_DEFAULTS, ...xlParams })),
    stepExpression: Object.freeze(expression),
  });
}

const neutral = expressionStep();
const softAccent = expressionStep(0.38, 0.92);
const hardAccent = expressionStep(0.82, 0.86);
const shortGate = expressionStep(0.12, 0.32);

/**
 * SIMD-only expansion bank. Each patch owns its complete voice, pattern,
 * effects, and expression state so recalling one is always deterministic.
 */
export const SIMD_303_EXPANSION_PRESETS = Object.freeze([
  definePreset({
    id: "deep-rubber",
    label: "Deep Rubber",
    category: "Foundation",
    description: "A low, rounded mono bass with restrained resonance and almost no ambience.",
    params: {
      partials: 320, fundamental: tune(76), frequency: 28, timeMod: 16, timeScale: 5.6,
      gain: 0.115, dist: 0.68, dur: 0.76, ratio: 1.7, sampOffset: 1,
      stereo: 0.04, nse: 8221, res: 6.4, lfo: 0.18, flt: -7.5,
    },
    sequence: repeatTo(16, [0.08, 0.08, 0.31, 0.08, 0.44, 0.23, 0.08, 0.56]),
    xlParams: { spectrumMorph: 0.08, chorusMix: 0.03, delayMix: 0.04 },
    stepExpression: expressionPattern(16, [hardAccent, neutral, softAccent, neutral, neutral, shortGate, softAccent, neutral]),
  }),
  definePreset({
    id: "silver-squelch",
    label: "Silver Squelch",
    category: "Foundation",
    description: "Fast, resonant silver-box acid with short envelopes and pointed accents.",
    params: {
      partials: 384, fundamental: tune(82), frequency: 45, timeMod: 16, timeScale: 8.8,
      gain: 0.084, dist: 1.22, dur: 0.31, ratio: 2.05, sampOffset: 1,
      stereo: 0.22, nse: 16061, res: 12.6, lfo: 0.82, flt: -22,
    },
    sequence: repeatTo(16, [0.12, 0.63, 0.31, 0.78, 0.22, 0.52, 0.17, 0.88, 0.28, 0.67, 0.38, 0.73, 0.19, 0.57, 0.34, 0.81]),
    xlParams: { spectrumMorph: 0, chorusMix: 0.08, delayMix: 0.12, delaySteps: 2, delayFeedback: 0.22 },
    stepExpression: expressionPattern(16, [hardAccent, neutral, shortGate, softAccent]),
  }),
  definePreset({
    id: "dry-cell",
    label: "Dry Cell",
    category: "Foundation",
    description: "A compact eight-step reference patch with dry output and very little spectral motion.",
    params: {
      partials: 128, fundamental: tune(75), frequency: 32, timeMod: 8, timeScale: 7,
      gain: 0.12, dist: 0.38, dur: 0.18, ratio: 1.15, sampOffset: 1,
      stereo: 0, nse: 2450, res: 3.8, lfo: 0, flt: -4,
    },
    sequence: repeatTo(8, [0.1, 0.32, 0.18, 0.45, 0.1, 0.56, 0.27, 0.39]),
    xlParams: { spectrumMorph: 0, chorusMix: 0, delayMix: 0, delayFeedback: 0 },
    stepExpression: expressionPattern(8, [softAccent, neutral, neutral, shortGate]),
  }),
  definePreset({
    id: "round-robin",
    label: "Round Robin",
    category: "Foundation",
    description: "A warm twelve-step loop that alternates round fundamentals with restrained upper notes.",
    params: {
      partials: 256, fundamental: tune(78), frequency: 36, timeMod: 12, timeScale: 6.3,
      gain: 0.105, dist: 0.56, dur: 0.58, ratio: 3.4, sampOffset: 1,
      stereo: -0.35, nse: 11237, res: 7.2, lfo: 0.42, flt: -9,
    },
    sequence: repeatTo(12, [0.09, 0.38, 0.22, 0.49, 0.16, 0.61, 0.27, 0.44, 0.12, 0.54, 0.31, 0.7]),
    xlParams: { spectrumMorph: 0.72, chorusMix: 0.14, chorusDepth: 3.4, delayMix: 0.08 },
    stepExpression: expressionPattern(12, [hardAccent, neutral, softAccent, neutral, neutral, shortGate]),
  }),
  definePreset({
    id: "warm-diode",
    label: "Warm Diode",
    category: "Foundation",
    description: "Slow, driven acid with a broad positive sweep and a dense midrange body.",
    params: {
      partials: 280, fundamental: tune(72), frequency: 38, timeMod: 16, timeScale: 4.2,
      gain: 0.112, dist: 1.52, dur: 0.94, ratio: 3.2, sampOffset: 1,
      stereo: 0.6, nse: 20491, res: 8.2, lfo: 0.3, flt: 8,
    },
    sequence: repeatTo(16, [0.11, 0.2, 0.37, 0.26, 0.52, 0.34, 0.68, 0.42]),
    xlParams: { spectrumMorph: 0.34, chorusMix: 0.16, chorusDepth: 4.2, delayMix: 0.1, delaySteps: 3 },
    stepExpression: expressionPattern(16, [hardAccent, neutral, neutral, softAccent, neutral, neutral, shortGate, neutral]),
  }),

  definePreset({
    id: "square-bender",
    label: "Square Bender",
    category: "Spectrum",
    description: "Odd-harmonic square weightings turn the acid line into a woody, reedy bass.",
    params: {
      partials: 512, fundamental: tune(79), frequency: 42, timeMod: 16, timeScale: 6.9,
      gain: 0.096, dist: 0.72, dur: 0.52, ratio: 5.6, sampOffset: 1,
      stereo: -0.8, nse: 14553, res: 7.6, lfo: 1.1, flt: -10,
    },
    sequence: repeatTo(16, [0.14, 0.55, 0.26, 0.7, 0.19, 0.47, 0.33, 0.82]),
    xlParams: { spectrumMorph: 1, chorusMix: 0.1, delayMix: 0.1, delaySteps: 2 },
    stepExpression: expressionPattern(16, [hardAccent, neutral, softAccent, shortGate]),
  }),
  definePreset({
    id: "pulse-spike",
    label: "Pulse Spike",
    category: "Spectrum",
    description: "A nasal pulse spectrum, tight gates, and sharp resonance expose the brittle upper register.",
    params: {
      partials: 420, fundamental: tune(86), frequency: 58, timeMod: 16, timeScale: 10.8,
      gain: 0.068, dist: 1.36, dur: 0.2, ratio: 7.8, sampOffset: 1,
      stereo: 1.1, nse: 28970, res: 11.8, lfo: 4.2, flt: -28,
    },
    sequence: repeatTo(16, [0.21, 0.79, 0.35, 0.91, 0.28, 0.64, 0.42, 0.86, 0.18, 0.73, 0.31, 0.96, 0.46, 0.61, 0.24, 0.82]),
    xlParams: { spectrumMorph: 2, chorusMix: 0.08, delayMix: 0.16, delaySteps: 1.5, delayFeedback: 0.3 },
    stepExpression: expressionPattern(16, [hardAccent, shortGate, neutral, expressionStep(0.5, 0.22)]),
  }),
  definePreset({
    id: "triangle-drop",
    label: "Triangle Drop",
    category: "Spectrum",
    description: "Triangle harmonics and a long decay reveal the unusually soft edge of the 512-partial voice.",
    params: {
      partials: 512, fundamental: tune(70), frequency: 30, timeMod: 16, timeScale: 3.1,
      gain: 0.3, dist: 0.24, dur: 1.6, ratio: 2.6, sampOffset: 1,
      stereo: 0.4, nse: 7011, res: 3.2, lfo: 0.12, flt: 18,
    },
    sequence: repeatTo(16, [0.08, 0.16, 0.3, 0.43, 0.58, 0.72, 0.49, 0.24]),
    xlParams: { spectrumMorph: 3, chorusMix: 0.24, chorusDepth: 6.4, chorusRate: 0.16, delayMix: 0.12, delaySteps: 4 },
    stepExpression: expressionPattern(16, [softAccent, neutral, neutral, neutral, hardAccent, neutral, shortGate, neutral]),
  }),
  definePreset({
    id: "spectral-crossfade",
    label: "Spectral Crossfade",
    category: "Spectrum",
    description: "A saw-to-square hybrid preserves acid bite while opening a broad, animated harmonic middle.",
    params: {
      partials: 448, fundamental: tune(80), frequency: 50, timeMod: 20, timeScale: 7.6,
      gain: 0.086, dist: 0.92, dur: 0.44, ratio: 10.2, sampOffset: 2,
      stereo: 1.8, nse: 31881, res: 9.4, lfo: 2.7, flt: -15,
    },
    sequence: repeatTo(20, [0.12, 0.47, 0.25, 0.69, 0.38, 0.84, 0.31, 0.58, 0.18, 0.76]),
    xlParams: { spectrumMorph: 0.52, chorusMix: 0.22, chorusDepth: 5.6, delayMix: 0.14, delaySteps: 2.5 },
    stepExpression: expressionPattern(20, [hardAccent, neutral, shortGate, neutral, softAccent]),
  }),
  definePreset({
    id: "hollow-comb",
    label: "Hollow Comb",
    category: "Spectrum",
    description: "High harmonic offset and pulse-triangle interpolation hollow the center into a glassy comb.",
    params: {
      partials: 180, fundamental: tune(74), frequency: 34, timeMod: 12, timeScale: 5.1,
      gain: 0.25, dist: 0.88, dur: 0.82, ratio: 24, sampOffset: 14,
      stereo: -3.6, nse: 36701, res: 5.2, lfo: 1.6, flt: 24,
    },
    sequence: repeatTo(12, [0.09, 0.28, 0.51, 0.18, 0.66, 0.37]),
    xlParams: { spectrumMorph: 2.55, chorusMix: 0.36, chorusDepth: 8.2, chorusRate: 0.34, delayMix: 0.18, delaySteps: 3.5 },
    stepExpression: expressionPattern(12, [softAccent, neutral, hardAccent, shortGate, neutral, neutral]),
  }),

  definePreset({
    id: "sixteen-ratchet",
    label: "Sixteen Ratchet",
    category: "Motion",
    description: "Very short gates and rapid pitch alternation create a clipped, machine-like sixteenth-note relay.",
    params: {
      partials: 240, fundamental: tune(78), frequency: 52, timeMod: 16, timeScale: 15.4,
      gain: 0.075, dist: 1.08, dur: 0.13, ratio: 4.8, sampOffset: 1,
      stereo: 0.9, nse: 19117, res: 8.8, lfo: 9.5, flt: -18,
    },
    sequence: repeatTo(16, [0.12, 0.62, 0.18, 0.71, 0.27, 0.83, 0.34, 0.54]),
    xlParams: { spectrumMorph: 0.28, chorusMix: 0.06, delayMix: 0.2, delaySteps: 0.5, delayFeedback: 0.34 },
    stepExpression: expressionPattern(16, [expressionStep(0.76, 0.2), shortGate, expressionStep(0.25, 0.16), shortGate]),
  }),
  definePreset({
    id: "odd-orbit",
    label: "Odd Orbit",
    category: "Motion",
    description: "A fifteen-step cycle makes accents and pitch groupings continually rotate against the pulse.",
    params: {
      partials: 300, fundamental: tune(77), frequency: 44, timeMod: 15, timeScale: 7.2,
      gain: 0.092, dist: 0.76, dur: 0.47, ratio: 6.5, sampOffset: 2,
      stereo: 2.2, nse: 27031, res: 9.1, lfo: 1.35, flt: -11,
    },
    sequence: repeatTo(15, [0.11, 0.42, 0.68, 0.24, 0.79, 0.35, 0.56, 0.17, 0.88, 0.31, 0.63, 0.27, 0.74, 0.46, 0.2]),
    xlParams: { spectrumMorph: 0.9, chorusMix: 0.18, chorusDepth: 4.8, delayMix: 0.17, delaySteps: 3 },
    stepExpression: expressionPattern(15, [hardAccent, neutral, neutral, softAccent, shortGate]),
  }),
  definePreset({
    id: "probability-engine",
    label: "Probability Engine",
    category: "Motion",
    description: "Authored chance values thin a stable pattern into a changing but rhythmically anchored acid line.",
    params: {
      partials: 340, fundamental: tune(81), frequency: 48, timeMod: 16, timeScale: 8.1,
      gain: 0.094, dist: 0.96, dur: 0.4, ratio: 5.1, sampOffset: 1,
      stereo: -1.4, nse: 9347, res: 10.4, lfo: 2.1, flt: -16,
    },
    sequence: repeatTo(16, [0.15, 0.52, 0.29, 0.76, 0.22, 0.64, 0.38, 0.86]),
    xlParams: { spectrumMorph: 0.18, chorusMix: 0.12, delayMix: 0.24, delaySteps: 2, delayFeedback: 0.4 },
    stepExpression: expressionPattern(16, [
      expressionStep(0.8, 0.88, 0, 1), expressionStep(0, 0.7, 0, 0.42),
      expressionStep(0.34, 0.46, 0, 0.72), expressionStep(0, 1, 0, 0.28),
    ]),
  }),
  definePreset({
    id: "accent-telegraph",
    label: "Accent Telegraph",
    category: "Motion",
    description: "Alternating hard accents and narrow gates articulate a terse call-and-response pattern.",
    params: {
      partials: 286, fundamental: tune(83), frequency: 40, timeMod: 16, timeScale: 9.4,
      gain: 0.088, dist: 1.18, dur: 0.28, ratio: 2.8, sampOffset: 1,
      stereo: 0.3, nse: 23003, res: 11.2, lfo: 0.65, flt: -25,
    },
    sequence: repeatTo(16, [0.13, 0.57, 0.24, 0.69, 0.19, 0.49, 0.33, 0.8]),
    xlParams: { spectrumMorph: 0, chorusMix: 0.05, delayMix: 0.19, delaySteps: 1, delayFeedback: 0.28 },
    stepExpression: expressionPattern(16, [hardAccent, expressionStep(0, 0.25), softAccent, expressionStep(0, 0.42)]),
  }),
  definePreset({
    id: "slow-serpent",
    label: "Slow Serpent",
    category: "Motion",
    description: "A long, slow contour uses only shallow slides so its winding pitch motion stays controlled.",
    params: {
      partials: 360, fundamental: tune(73), frequency: 32, timeMod: 24, timeScale: 2.6,
      gain: 0.12, dist: 0.52, dur: 1.24, ratio: 4.4, sampOffset: 1,
      stereo: 1.5, nse: 12771, res: 6.8, lfo: 0.21, flt: 12,
    },
    sequence: repeatTo(24, [0.08, 0.14, 0.23, 0.35, 0.48, 0.62, 0.75, 0.56, 0.39, 0.27, 0.18, 0.11]),
    xlParams: { spectrumMorph: 0.42, chorusMix: 0.3, chorusDepth: 7.2, chorusRate: 0.12, delayMix: 0.16, delaySteps: 4 },
    stepExpression: expressionPattern(24, [
      hardAccent, expressionStep(0, 1, 0.12), expressionStep(0.25, 0.94, 0.18), neutral,
      neutral, expressionStep(0, 1, 0.1), softAccent, neutral,
    ]),
  }),

  definePreset({
    id: "dub-vessel",
    label: "Dub Vessel",
    category: "Space",
    description: "A sparse dark line feeds a four-step delay without losing its dry rhythmic center.",
    params: {
      partials: 260, fundamental: tune(71), frequency: 34, timeMod: 16, timeScale: 5.4,
      gain: 0.088, dist: 0.82, dur: 0.72, ratio: 3.8, sampOffset: 1,
      stereo: -1.8, nse: 30617, res: 7.8, lfo: 0.38, flt: 5,
    },
    sequence: repeatTo(16, [0.09, 0.09, 0.38, 0.09, 0.58, 0.23, 0.09, 0.46]),
    xlParams: { spectrumMorph: 0.22, chorusMix: 0.08, delayMix: 0.48, delaySteps: 4, delayFeedback: 0.62 },
    stepExpression: expressionPattern(16, [hardAccent, expressionStep(0, 0.28), neutral, expressionStep(0, 0.4)]),
  }),
  definePreset({
    id: "choral-acid",
    label: "Choral Acid",
    category: "Space",
    description: "Deep slow chorus spreads a square-leaning voice into an ensemble-like spectral cloud.",
    params: {
      partials: 420, fundamental: tune(76), frequency: 38, timeMod: 16, timeScale: 4.6,
      gain: 0.22, dist: 0.34, dur: 1.1, ratio: 6.2, sampOffset: 1,
      stereo: 2.8, nse: 17303, res: 5.8, lfo: 0.28, flt: 16,
    },
    sequence: repeatTo(16, [0.12, 0.32, 0.51, 0.68, 0.44, 0.27, 0.59, 0.76]),
    xlParams: { spectrumMorph: 0.88, chorusMix: 0.62, chorusDepth: 10.2, chorusRate: 0.18, delayMix: 0.12, delaySteps: 5 },
    stepExpression: expressionPattern(16, [softAccent, neutral, neutral, neutral, hardAccent, neutral, neutral, shortGate]),
  }),
  definePreset({
    id: "short-tape",
    label: "Short Tape",
    category: "Space",
    description: "A sub-step echo turns a dry pulse line into elastic slapback and comb-like repetitions.",
    params: {
      partials: 310, fundamental: tune(82), frequency: 46, timeMod: 16, timeScale: 7.8,
      gain: 0.078, dist: 0.9, dur: 0.36, ratio: 7.2, sampOffset: 2,
      stereo: -2.3, nse: 25319, res: 8.6, lfo: 1.8, flt: -13,
    },
    sequence: repeatTo(16, [0.16, 0.65, 0.28, 0.74, 0.36, 0.57, 0.21, 0.87]),
    xlParams: { spectrumMorph: 1.72, chorusMix: 0.1, delayMix: 0.42, delaySteps: 0.75, delayFeedback: 0.52 },
    stepExpression: expressionPattern(16, [hardAccent, shortGate, softAccent, neutral]),
  }),
  definePreset({
    id: "cathedral-tail",
    label: "Cathedral Tail",
    category: "Space",
    description: "Slow triangle-rich notes bloom into a long, high-feedback eight-step delay field.",
    params: {
      partials: 512, fundamental: tune(68), frequency: 26, timeMod: 16, timeScale: 2.2,
      gain: 0.2, dist: 0.22, dur: 1.82, ratio: 2.2, sampOffset: 1,
      stereo: 3.7, nse: 6113, res: 4.4, lfo: 0.1, flt: 28,
    },
    sequence: repeatTo(16, [0.08, 0.25, 0.42, 0.61, 0.78, 0.55, 0.34, 0.18]),
    xlParams: { spectrumMorph: 2.86, chorusMix: 0.44, chorusDepth: 9.4, chorusRate: 0.1, delayMix: 0.68, delaySteps: 8, delayFeedback: 0.76 },
    stepExpression: expressionPattern(16, [softAccent, neutral, neutral, neutral, hardAccent, neutral, neutral, expressionStep(0, 0.58)]),
  }),
  definePreset({
    id: "astral-void",
    label: "Astral Void",
    category: "Space",
    description: "Wide oscillator divergence, chorus, and syncopated delay form the bank's largest stereo image.",
    params: {
      partials: 236, fundamental: tune(80), frequency: 54, timeMod: 20, timeScale: 5.8,
      gain: 0.18, dist: 0.58, dur: 0.8, ratio: 11.5, sampOffset: 3,
      stereo: 6.8, nse: 34919, res: 7, lfo: 3.1, flt: 9,
    },
    sequence: repeatTo(20, [0.13, 0.48, 0.76, 0.29, 0.61, 0.22, 0.88, 0.4, 0.69, 0.34]),
    xlParams: { spectrumMorph: 1.36, chorusMix: 0.52, chorusDepth: 11, chorusRate: 0.42, delayMix: 0.43, delaySteps: 3.5, delayFeedback: 0.58 },
    stepExpression: expressionPattern(20, [hardAccent, neutral, expressionStep(0.28, 0.7), shortGate, neutral]),
  }),

  definePreset({
    id: "razor-512",
    label: "Razor 512",
    category: "Extremes",
    description: "All 512 partials, near-maximum resonance, and heavy drive create a deliberately dangerous edge.",
    params: {
      partials: 512, fundamental: tune(87), frequency: 72, timeMod: 16, timeScale: 9.8,
      gain: 0.048, dist: 2.85, dur: 0.27, ratio: 9.8, sampOffset: 1,
      stereo: 1.6, nse: 38591, res: 14.4, lfo: 6.8, flt: -34,
    },
    sequence: repeatTo(16, [0.17, 0.81, 0.3, 0.93, 0.46, 0.72, 0.24, 0.88]),
    xlParams: { spectrumMorph: 0.2, chorusMix: 0.08, delayMix: 0.12, delaySteps: 1, delayFeedback: 0.24 },
    stepExpression: expressionPattern(16, [hardAccent, expressionStep(0.1, 0.24), softAccent, shortGate]),
  }),
  definePreset({
    id: "foldstorm",
    label: "Foldstorm",
    category: "Extremes",
    description: "Maximum harmonic fold ratio and high offset expose metallic, inharmonic-feeling upper structures.",
    params: {
      partials: 360, fundamental: tune(77), frequency: 62, timeMod: 18, timeScale: 8.6,
      gain: 0.057, dist: 2.42, dur: 0.39, ratio: 31, sampOffset: 8,
      stereo: -4.8, nse: 22229, res: 9.8, lfo: 12, flt: -6,
    },
    sequence: repeatTo(18, [0.12, 0.73, 0.29, 0.9, 0.41, 0.64, 0.2, 0.82, 0.5]),
    xlParams: { spectrumMorph: 0.78, chorusMix: 0.28, chorusDepth: 6.8, chorusRate: 1.2, delayMix: 0.25, delaySteps: 1.25, delayFeedback: 0.44 },
    stepExpression: expressionPattern(18, [hardAccent, shortGate, expressionStep(0.42, 0.5), neutral, softAccent, neutral]),
  }),
  definePreset({
    id: "subduction",
    label: "Subduction",
    category: "Extremes",
    description: "An extremely low reference pitch lets the upper partial bank supply a seismic, layered rumble.",
    params: {
      partials: 512, fundamental: tune(45), frequency: 24, timeMod: 8, timeScale: 3.4,
      gain: 0.14, dist: 1.1, dur: 1.42, ratio: 18, sampOffset: 1,
      stereo: -0.6, nse: 10991, res: 5.6, lfo: 0.16, flt: 20,
    },
    sequence: repeatTo(8, [0.08, 0.23, 0.14, 0.37, 0.1, 0.48, 0.2, 0.31]),
    xlParams: { spectrumMorph: 0.12, chorusMix: 0.18, chorusDepth: 7.6, chorusRate: 0.08, delayMix: 0.1, delaySteps: 4 },
    stepExpression: expressionPattern(8, [hardAccent, neutral, softAccent, neutral]),
  }),
  definePreset({
    id: "ion-bird",
    label: "Ion Bird",
    category: "Extremes",
    description: "High tuning and a wide note range produce a bright, chirping line with automatic Nyquist pruning.",
    params: {
      partials: 512, fundamental: tune(91), frequency: 82, timeMod: 24, timeScale: 12.8,
      gain: 0.25, dist: 0.82, dur: 0.16, ratio: 12.4, sampOffset: 2,
      stereo: 2.9, nse: 31213, res: 10.6, lfo: 18, flt: -30,
    },
    sequence: repeatTo(24, [0.58, 0.76, 0.93, 0.64, 0.84, 0.7, 0.98, 0.61, 0.89, 0.74, 0.95, 0.67]),
    xlParams: { spectrumMorph: 2.12, chorusMix: 0.16, chorusDepth: 2.8, chorusRate: 2.4, delayMix: 0.22, delaySteps: 0.5, delayFeedback: 0.36 },
    stepExpression: expressionPattern(24, [expressionStep(0.7, 0.18), shortGate, expressionStep(0.24, 0.26), shortGate]),
  }),
  definePreset({
    id: "oracle-static",
    label: "Oracle Static",
    category: "Extremes",
    description: "A deterministic source-noise score, violent filter motion, and hybrid spectrum make a repeatable chaos patch.",
    params: {
      partials: 460, fundamental: tune(84), frequency: 88, timeMod: 32, timeScale: 11.2,
      gain: 0.1, dist: 1.76, dur: 0.3, ratio: 15.6, sampOffset: 4,
      stereo: -6.7, nse: 39917, res: 12.2, lfo: 32, flt: 44,
    },
    sequence: repeatTo(32, [-1]),
    xlParams: { spectrumMorph: 1.68, chorusMix: 0.34, chorusDepth: 9.8, chorusRate: 3.4, delayMix: 0.3, delaySteps: 1.75, delayFeedback: 0.48 },
    stepExpression: expressionPattern(32, [
      expressionStep(0.82, 0.28, 0, 1), expressionStep(0, 0.72, 0, 0.58),
      expressionStep(0.36, 0.42, 0, 0.84), expressionStep(0, 0.2, 0, 0.38),
    ]),
  }),
]);
