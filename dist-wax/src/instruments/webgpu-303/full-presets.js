import {
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_SOURCE_SEQUENCE,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303Sequence,
  webGpu303FundamentalFromSourceControl,
} from "../../webgpu-303.js";
import {
  SIMD_303_STEP_EXPRESSION_DEFAULT,
  SIMD_303_XL_DEFAULTS,
  SIMD_303_XL_LIMITS,
  sanitizeSimd303Params,
  sanitizeSimd303StepExpression,
  sanitizeSimd303XlParams,
} from "../../simd-303.js";
import { SIMD_303_EXPANSION_PRESETS } from "../../simd-303-presets.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const sequence = (...values) => sanitizeWebGpu303Sequence(values);

function presetParams(values) {
  for (const key of WEBGPU_303_PARAM_ORDER) {
    if (!hasOwn(values, key)) throw new Error(`WebGPU 303 preset is missing ${key}.`);
  }
  return sanitizeWebGpu303Params(values);
}

const WEBGPU_303_BANK = Object.freeze([
  {
    id: "source-acid-synth",
    label: "Source Acid Synth",
    params: WEBGPU_303_DEFAULTS,
    sequence: WEBGPU_303_SOURCE_SEQUENCE,
  },
  {
    id: "filter-snap",
    label: "Lysergic Ribbon",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(70),
      frequency: 54,
      timeMod: 24,
      timeScale: 7.4,
      gain: 0.1,
      dist: 0.82,
      dur: 0.42,
      ratio: 5.75,
      sampOffset: 1,
      stereo: 1.2,
      nse: 17317,
      res: 10.8,
      lfo: 2.8,
      flt: -12,
    }),
    sequence: sequence(0.08, 0.46, 0.2, 0.72, 0.3, 0.62, 0.38, 0.9, 0.34, 0.76, 0.49, 0.86, 0.28, 0.68, 0.4, 0.57, 0.18, 0.66, 0.36, 0.78, 0.24, 0.59, 0.44, 0.82),
  },
  {
    id: "wide-phase",
    label: "Astral Smear",
    params: presetParams({
      partials: 224,
      fundamental: webGpu303FundamentalFromSourceControl(68),
      frequency: 46,
      timeMod: 20,
      timeScale: 4.8,
      gain: 0.09,
      dist: 0.62,
      dur: 0.66,
      ratio: 9.5,
      sampOffset: 2,
      stereo: 7.5,
      nse: 29303,
      res: 8.6,
      lfo: 0.55,
      flt: 14,
    }),
    sequence: sequence(0.73, 0.18, 0.88, 0.26, 0.42, 0.12, 0.62, 0.32, 0.97, 0.36, 0.53, 0.22, 0.68, 0.28, 0.81, 0.44, 0.56, 0.18, 0.74, 0.38),
  },
  {
    id: "resonance-glass",
    label: "Glass Seance",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(81),
      frequency: 48,
      timeMod: 32,
      timeScale: 6.2,
      gain: 0.082,
      dist: 0.72,
      dur: 0.38,
      ratio: 3.6,
      sampOffset: 1,
      stereo: 2.4,
      nse: 9241,
      res: 12.8,
      lfo: 1.8,
      flt: -20,
    }),
    sequence: sequence(0.16, 0.71, 0.24, 0.88, 0.32, 0.6, 0.28, 0.93, 0.41, 0.78, 0.22, 0.99, 0.35, 0.49, 0.27, 0.85, 0.46, 0.69, 0.18, 0.92, 0.3, 0.56, 0.39, 0.76, 0.25, 0.64, 0.42, 0.82, 0.2, 0.58, 0.37, 0.9),
  },
  {
    id: "voltage-bloom",
    label: "Voltage Melt",
    params: presetParams({
      partials: 224,
      fundamental: webGpu303FundamentalFromSourceControl(55),
      frequency: 30,
      timeMod: 16,
      timeScale: 2.4,
      gain: 0.11,
      dist: 0.28,
      dur: 1.55,
      ratio: 14.5,
      sampOffset: 3,
      stereo: -6.2,
      nse: 21444,
      res: 5.5,
      lfo: 0.25,
      flt: 30,
    }),
    sequence: sequence(0.12, 0.18, 0.38, 0.29, 0.54, 0.41, 0.74, 0.48, 0.83, 0.59, 0.91, 0.7, 0.65, 0.35, 0.44, 0.22),
  },
  {
    id: "needle-stutter",
    label: "Liquid Needle",
    params: presetParams({
      partials: 160,
      fundamental: webGpu303FundamentalFromSourceControl(62),
      frequency: 76,
      timeMod: 48,
      timeScale: 13.5,
      gain: 0.075,
      dist: 1.35,
      dur: 0.22,
      ratio: 12,
      sampOffset: 4,
      stereo: 3.2,
      nse: 33111,
      res: 7,
      lfo: 11,
      flt: -24,
    }),
    sequence: sequence(0.1, 0.82, 0.24, 0.36, 0.72, 0.28, 0.68, 0.32, 0.86, 0.41, 0.54, 0.18, 0.75, 0.34, 0.58, 0.42, 0.9, 0.22, 0.53, 0.31, 0.84, 0.46, 0.63, 0.27, 0.95, 0.48, 0.57, 0.24, 0.71, 0.38, 0.56, 0.44, 0.88, 0.26, 0.66, 0.35, 0.79, 0.5, 0.62, 0.3, 0.92, 0.4, 0.7, 0.21, 0.83, 0.52, 0.61, 0.36),
  },
  {
    id: "drive-floor",
    label: "Floor Warp",
    params: presetParams({
      partials: 200,
      fundamental: webGpu303FundamentalFromSourceControl(46),
      frequency: 42,
      timeMod: 16,
      timeScale: 6.4,
      gain: 0.08,
      dist: 1.9,
      dur: 0.55,
      ratio: 1.35,
      sampOffset: 1,
      stereo: -2.5,
      nse: 12600,
      res: 5.8,
      lfo: 3.4,
      flt: 2.5,
    }),
    sequence: sequence(0.12, 0.78, 0.25, 0.88, 0.2, 0.72, 0.32, 0.84, 0.28, 0.63, 0.38, 0.76, 0.22, 0.54, 0.36, 0.68),
  },
  {
    id: "hollow-offset",
    label: "Hollow Halo",
    params: presetParams({
      partials: 96,
      fundamental: webGpu303FundamentalFromSourceControl(58),
      frequency: 36,
      timeMod: 8,
      timeScale: 4.4,
      gain: 0.11,
      dist: 1.1,
      dur: 1.05,
      ratio: 27,
      sampOffset: 18,
      stereo: -6.8,
      nse: 38400,
      res: 2.8,
      lfo: 1.2,
      flt: 24,
    }),
    sequence: sequence(0.08, 0.22, 0.08, 0.64, 0.1, 0.35, 0.78, 0.18),
  },
  {
    id: "vector-sweep",
    label: "Vector Mirage",
    params: presetParams({
      partials: 220,
      fundamental: webGpu303FundamentalFromSourceControl(84),
      frequency: 92,
      timeMod: 64,
      timeScale: 8.4,
      gain: 0.075,
      dist: 0.95,
      dur: 0.36,
      ratio: 16,
      sampOffset: 2,
      stereo: 6.2,
      nse: 24888,
      res: 9.2,
      lfo: 22,
      flt: 20,
    }),
    sequence: sequence(0.39, 0.21, 0.73, 0.34, 0.86, 0.47, 0.28, 0.92, 0.52, 0.32, 0.68, 0.43, 0.98, 0.26, 0.61, 0.44, 0.82, 0.39, 0.57, 0.3, 0.76, 0.5, 0.66, 0.36, 0.88, 0.24, 0.71, 0.45, 0.93, 0.33, 0.62, 0.55),
  },
  {
    id: "seed-scanner",
    label: "Oracle Scanner",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(77),
      frequency: 88,
      timeMod: 96,
      timeScale: 6.8,
      gain: 0.09,
      dist: 0.74,
      dur: 0.48,
      ratio: 8.6,
      sampOffset: 3,
      stereo: 4.4,
      nse: 39211,
      res: 8.8,
      lfo: 5.3,
      flt: -8,
    }),
    sequence: WEBGPU_303_SOURCE_SEQUENCE,
  },
  {
    id: "opal-cathedral",
    label: "Opal Cathedral",
    params: presetParams({
      partials: 256,
      fundamental: webGpu303FundamentalFromSourceControl(52),
      frequency: 28,
      timeMod: 32,
      timeScale: 2.8,
      gain: 0.12,
      dist: 0.28,
      dur: 1.4,
      ratio: 3.4,
      sampOffset: 1,
      stereo: 6.5,
      nse: 28777,
      res: 6.4,
      lfo: 0.33,
      flt: 26,
    }),
    sequence: sequence(0.1, 0.16, 0.23, 0.31, 0.42, 0.5, 0.58, 0.67, 0.74, 0.82, 0.9, 0.76, 0.63, 0.52, 0.41, 0.3, 0.22, 0.36, 0.48, 0.61, 0.73, 0.86, 0.69, 0.55, 0.44, 0.33, 0.24, 0.18, 0.29, 0.46, 0.62, 0.79),
  },
  {
    id: "prism-bath",
    label: "Prism Bath",
    params: presetParams({
      partials: 180,
      fundamental: webGpu303FundamentalFromSourceControl(88),
      frequency: 70,
      timeMod: 40,
      timeScale: 9.5,
      gain: 0.07,
      dist: 1.1,
      dur: 0.5,
      ratio: 13.2,
      sampOffset: 6,
      stereo: -5.5,
      nse: 15680,
      res: 11,
      lfo: 7.5,
      flt: -18,
    }),
    sequence: sequence(0.24, 0.72, 0.35, 0.68, 0.18, 0.82, 0.42, 0.91, 0.3, 0.64, 0.5, 0.76, 0.27, 0.58, 0.46, 0.87, 0.34, 0.7, 0.22, 0.79, 0.4, 0.95, 0.52, 0.66, 0.28, 0.61, 0.48, 0.84, 0.36, 0.74, 0.2, 0.89, 0.45, 0.69, 0.31, 0.8, 0.56, 0.73, 0.38, 0.93),
  },
]);

const SAFE_RANGES = Object.freeze({
  partials: [64, 256], frequency: [22, 96], timeScale: [0.85, 16], gain: [0.055, 0.13],
  dist: [0.22, 2.2], dur: [0.24, 1.45], ratio: [1.2, 24], sampOffset: [1, 18],
  stereo: [-7.5, 7.5], nse: [1000, 39000], res: [1.2, 12.5], lfo: [0.1, 18], flt: [-38, 42],
});
const FUNDAMENTAL_CONTROL = [42, 90];
const BAR_LENGTHS = Object.freeze([8, 12, 16, 20, 24, 32, 48, 64]);
const MOTIF_LENGTHS = Object.freeze([2, 3, 4, 5, 6, 8]);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function full303Backend(simd) {
  const sanitizeParams = simd ? sanitizeSimd303Params : sanitizeWebGpu303Params;
  const sanitizeParamSet = params => {
    const full = sanitizeParams(params);
    return Object.fromEntries(WEBGPU_303_PARAM_ORDER.map(key => [key, full[key]]));
  };

  function capture(state) {
    const snapshot = {
      params: sanitizeParamSet(state.params),
      sequence: sanitizeWebGpu303Sequence(state.sequence),
    };
    if (simd) {
      snapshot.xlParams = sanitizeSimd303XlParams(state.xlParams);
      snapshot.stepExpression = sanitizeSimd303StepExpression(state.stepExpression);
    }
    return snapshot;
  }

  function validate(snapshot) {
    const complete = snapshot && typeof snapshot === "object" && snapshot.params && snapshot.sequence
      && WEBGPU_303_PARAM_ORDER.every(key => Number.isFinite(snapshot.params[key]))
      && snapshot.sequence.length === WEBGPU_303_SEQUENCE_LENGTH
      && (!simd || (snapshot.xlParams && Array.isArray(snapshot.stepExpression)
        && snapshot.stepExpression.length === WEBGPU_303_SEQUENCE_LENGTH));
    if (!complete || presetStateKey(snapshot) !== presetStateKey(capture(snapshot))) {
      throw new TypeError("Invalid complete 303 preset");
    }
    return snapshot;
  }

  const entry = (id, label, source, description) => Object.freeze({
    id, label, description, snapshot: Object.freeze(validate(capture(source))),
  });

  function bank() {
    const source = WEBGPU_303_BANK.map(preset => entry(preset.id, preset.label, {
      params: preset.params, sequence: preset.sequence,
      xlParams: SIMD_303_XL_DEFAULTS, stepExpression: [],
    }));
    if (!simd) return Object.freeze(source);
    return Object.freeze([...source, ...SIMD_303_EXPANSION_PRESETS.map(preset => entry(
      preset.id, preset.label, preset, preset.description,
    ))]);
  }

  function randomSequence(rng, steps) {
    const motifLength = rng.pick(MOTIF_LENGTHS);
    const motif = Array.from({ length: motifLength }, () => rng.between(0.04, 0.98));
    const drift = rng.between(0.1, 0.45);
    const noisy = rng.unit() < 0.2;
    return Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, index) => {
      if (index >= steps) return -1;
      if (noisy && rng.unit() < 0.3) return -1;
      return rng.unit() < drift ? rng.between(0.04, 0.98) : motif[index % motifLength];
    });
  }

  function randomExpression(rng, steps) {
    const slideRate = rng.between(0.08, 0.4);
    const accentRate = rng.between(0.2, 0.5);
    const chanceFloor = rng.between(0.5, 1);
    return Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, index) => {
      if (index >= steps) return [...SIMD_303_STEP_EXPRESSION_DEFAULT];
      const slide = index > 0 && rng.unit() < slideRate ? rng.between(0.2, 0.92) : 0;
      return [
        index % 4 === 0 || rng.unit() < accentRate ? rng.between(0.3, 1) : rng.between(0, 0.25),
        slide > 0 ? rng.between(0.78, 1) : rng.between(0.5, 1),
        slide,
        rng.unit() < 0.15 ? rng.between(chanceFloor, 1) : 1,
      ];
    });
  }

  function randomize(current, random = Math.random) {
    validate(current);
    const rng = presetRandom(random);
    const raw = {};
    for (const [key, [minimum, maximum]] of Object.entries(SAFE_RANGES)) {
      raw[key] = rng.between(minimum, key === "partials" && simd ? 512 : maximum);
    }
    raw.fundamental = webGpu303FundamentalFromSourceControl(rng.between(...FUNDAMENTAL_CONTROL));
    raw.timeMod = rng.pick(BAR_LENGTHS);
    const params = sanitizeParamSet(raw);
    const driveCut = Math.max(0, params.dist - 1) * 0.018;
    const resonanceCut = Math.max(0, params.res - 7) * 0.0045;
    const decayCut = Math.max(0, 0.34 - params.dur) * 0.09;
    params.gain = clamp(params.gain, SAFE_RANGES.gain[0], clamp(0.135 - driveCut - resonanceCut - decayCut, 0.065, 0.13));
    const snapshot = { params, sequence: sanitizeWebGpu303Sequence(randomSequence(rng, params.timeMod)) };
    if (simd) {
      const xl = {};
      for (const [key, [minimum, maximum]] of Object.entries(SIMD_303_XL_LIMITS)) {
        xl[key] = rng.between(minimum, key === "chorusMix" || key === "delayMix" ? maximum * 0.6 : maximum);
      }
      xl.delayFeedback = Math.min(xl.delayFeedback, 0.7);
      xl.delaySteps = rng.pick([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6]);
      snapshot.xlParams = sanitizeSimd303XlParams(xl);
      snapshot.stepExpression = sanitizeSimd303StepExpression(randomExpression(rng, params.timeMod));
    }
    return validate(snapshot);
  }

  return Object.freeze({ simd, capture, validate, randomize, presets: bank() });
}

export const FULL_WEBGPU_303 = full303Backend(false);
export const FULL_SIMD_303 = full303Backend(true);
