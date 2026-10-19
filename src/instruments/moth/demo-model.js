const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value, minimum, maximum, fallback) =>
  Math.min(maximum, Math.max(minimum, finite(value, fallback)));

export const MOTH_DEFAULTS = Object.freeze({
  leftFold: 0.2, rightFold: 0.2, span: 1,
  flapRate: 0.76,
});

export function mothSettings(values = {}) {
  return {
    leftFold: bounded(values.leftFold, 0, 1, MOTH_DEFAULTS.leftFold),
    rightFold: bounded(values.rightFold, 0, 1, MOTH_DEFAULTS.rightFold),
    span: bounded(values.span, 0.68, 1.35, MOTH_DEFAULTS.span),
    flapRate: bounded(values.flapRate, 0.15, 3, MOTH_DEFAULTS.flapRate),
  };
}

export function mothWingFrequency(fold, span) {
  return Math.min(900, Math.max(90, 185 * (1 + bounded(fold, 0, 1, 0) * 0.7)
    / bounded(span, 0.68, 1.35, 1)));
}

export function mothPose(values, cycles = 0, playing = false) {
  const settings = mothSettings(values);
  // Keep the transport's fractional phase when paused: the downloaded GLB's
  // full animation, not an extra sine on its wing roots, supplies the flap.
  const phase = ((finite(cycles, 0) % 1) + 1) % 1;
  return {
    leftFold: settings.leftFold,
    rightFold: settings.rightFold,
    phase,
    leftFlap: 0,
    rightFlap: 0,
    leftTip: settings.leftFold * 0.38,
    rightTip: settings.rightFold * 0.38,
    span: settings.span,
    leftHz: mothWingFrequency(settings.leftFold, settings.span),
    rightHz: mothWingFrequency(settings.rightFold, settings.span),
    playing,
  };
}

/** Ridge boundaries crossed by a stroke, in travel order; staying still is silent. */
export function mothBrushRidges(from, to, count = 8) {
  const start = bounded(from, 0, 1, 0);
  const end = bounded(to, 0, 1, start);
  const divisions = Math.max(2, Math.min(24, Math.trunc(finite(count, 8))));
  const result = [];
  if (end > start) {
    for (let i = 1; i < divisions; i += 1) {
      if (i / divisions > start + 1e-6 && i / divisions <= end + 1e-6) result.push(i);
    }
  } else if (end < start) {
    for (let i = divisions - 1; i > 0; i -= 1) {
      if (i / divisions < start - 1e-6 && i / divisions >= end - 1e-6) result.push(i);
    }
  }
  return result;
}
