import {
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  sanitizeWebGpu303Sequence,
  webGpu303SequenceValue,
} from "./webgpu-303.js";
import {
  sanitizeSimd303Params,
  sanitizeSimd303StepExpression,
  sanitizeSimd303XlParams,
} from "./simd-303.js";

export const SIMD_303_MORPH_SCOPES = Object.freeze(["tone", "effects", "all"]);
export const SIMD_303_MORPH_UNITS = Object.freeze(["seconds", "steps", "bars"]);
export const SIMD_303_MORPH_TIME_LIMITS = Object.freeze({
  seconds: Object.freeze([0.1, 120]),
  steps: Object.freeze([1, 128]),
  bars: Object.freeze([0.25, 16]),
});

const PROTECTED_PARAM_KEYS = new Set(["timeScale", "timeMod", "gain", "swing", "sequencePhase"]);
const EFFECT_PARAM_KEYS = new Set(["stereo"]);
const PATTERN_PARAM_KEYS = new Set(["nse"]);
const LOG_PARAM_KEYS = new Set(["fundamental", "frequency", "dist", "dur", "ratio", "lfo"]);
const INTEGER_PARAM_KEYS = new Set(["partials", "sampOffset", "timeMod"]);
const EFFECT_XL_KEYS = new Set([
  "chorusMix",
  "chorusDepth",
  "chorusRate",
  "delayMix",
  "delaySteps",
  "delayFeedback",
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const mix = (from, to, amount) => from + (to - from) * amount;
const positiveMix = (from, to, amount) => (
  from > 0 && to > 0
    ? Math.exp(mix(Math.log(from), Math.log(to), amount))
    : mix(from, to, amount)
);

export function simd303MorphCurve(progress) {
  const amount = clamp(finite(progress), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function simd303MorphTimeFromControl(control, unit = "seconds") {
  const resolvedUnit = SIMD_303_MORPH_UNITS.includes(unit) ? unit : "seconds";
  const [minimum, maximum] = SIMD_303_MORPH_TIME_LIMITS[resolvedUnit];
  const amount = clamp(finite(control), 0, 1);
  return minimum * ((maximum / minimum) ** amount);
}

export function simd303MorphDurationSeconds(value, unit = "seconds", params = {}) {
  const resolvedUnit = SIMD_303_MORPH_UNITS.includes(unit) ? unit : "seconds";
  const amount = Math.max(0.001, finite(value, 1));
  const sanitized = sanitizeSimd303Params(params);
  if (resolvedUnit === "steps") return amount / Math.max(0.01, sanitized.timeScale);
  if (resolvedUnit === "bars") {
    return amount * sanitized.timeMod / Math.max(0.01, sanitized.timeScale);
  }
  return amount;
}

export function formatSimd303MorphTime(value, unit = "seconds") {
  const amount = Math.max(0, finite(value));
  if (unit === "steps") return `${amount < 10 ? amount.toFixed(1) : Math.round(amount)} steps`;
  if (unit === "bars") return `${amount < 10 ? amount.toFixed(2) : Math.round(amount)} bars`;
  if (amount < 1) return `${Math.round(amount * 1_000)} ms`;
  return `${amount < 10 ? amount.toFixed(2) : Math.round(amount)} sec`;
}

export function createSimd303MorphSnapshot(source = {}) {
  const params = Object.freeze(sanitizeSimd303Params(source.params));
  const sequence = Object.freeze(sanitizeWebGpu303Sequence(source.sequence));
  const xlParams = Object.freeze(sanitizeSimd303XlParams(source.xlParams));
  const stepExpression = Object.freeze(
    sanitizeSimd303StepExpression(source.stepExpression).map((step) => Object.freeze(step)),
  );
  return Object.freeze({
    params,
    sequence,
    xlParams,
    stepExpression,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : "Custom",
  });
}

export function resolveSimd303MorphTarget(source, destination, scope = "tone") {
  const from = createSimd303MorphSnapshot(source);
  const to = createSimd303MorphSnapshot(destination);
  const resolvedScope = SIMD_303_MORPH_SCOPES.includes(scope) ? scope : "tone";
  const params = { ...from.params };
  const xlParams = { ...from.xlParams };

  for (const key of WEBGPU_303_BUFFER_PARAM_ORDER) {
    if (PROTECTED_PARAM_KEYS.has(key)) continue;
    const isEffect = EFFECT_PARAM_KEYS.has(key);
    const isPattern = PATTERN_PARAM_KEYS.has(key);
    if (
      resolvedScope === "all"
      || (resolvedScope === "effects" && isEffect)
      || (resolvedScope === "tone" && !isEffect && !isPattern)
    ) {
      params[key] = to.params[key];
    }
  }

  for (const key of Object.keys(xlParams)) {
    const isEffect = EFFECT_XL_KEYS.has(key);
    if (
      resolvedScope === "all"
      || (resolvedScope === "effects" && isEffect)
      || (resolvedScope === "tone" && !isEffect)
    ) {
      xlParams[key] = to.xlParams[key];
    }
  }

  return createSimd303MorphSnapshot({
    params,
    sequence: resolvedScope === "all" ? to.sequence : from.sequence,
    xlParams,
    stepExpression: resolvedScope === "all" ? to.stepExpression : from.stepExpression,
    label: `${from.label} → ${to.label}`,
  });
}

export function interpolateSimd303MorphSnapshot(source, destination, progress) {
  const from = source?.params ? source : createSimd303MorphSnapshot(source);
  const to = destination?.params ? destination : createSimd303MorphSnapshot(destination);
  const amount = simd303MorphCurve(progress);
  if (amount <= 0) return createSimd303MorphSnapshot(from);
  if (amount >= 1) return createSimd303MorphSnapshot(to);

  const params = {};
  for (const key of WEBGPU_303_BUFFER_PARAM_ORDER) {
    const fromValue = finite(from.params[key]);
    const toValue = finite(to.params[key], fromValue);
    const value = LOG_PARAM_KEYS.has(key)
      ? positiveMix(fromValue, toValue, amount)
      : mix(fromValue, toValue, amount);
    params[key] = INTEGER_PARAM_KEYS.has(key) ? Math.round(value) : value;
  }

  const sequence = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, index) => mix(
    webGpu303SequenceValue(index, from.params, from.sequence),
    webGpu303SequenceValue(index, to.params, to.sequence),
    amount,
  ));
  const xlParams = Object.fromEntries(Object.keys(from.xlParams).map((key) => [
    key,
    key === "chorusRate" || key === "delaySteps"
      ? positiveMix(from.xlParams[key], to.xlParams[key], amount)
      : mix(from.xlParams[key], to.xlParams[key], amount),
  ]));
  const stepExpression = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, step) => (
    from.stepExpression[step].map((value, component) => (
      mix(value, to.stepExpression[step][component], amount)
    ))
  ));

  return { params, sequence, xlParams, stepExpression, label: `${from.label} → ${to.label}` };
}
