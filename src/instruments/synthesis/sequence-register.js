/**
 * Fit a complete pitch contour with one common tuning-period transposition.
 * Unlike folding notes individually, this preserves its order and intervals.
 * Null means the span cannot fit without changing its shape; callers retain
 * their existing per-note safety handling for that exceptional case.
 */
export function sequenceRegisterMultiplier(ratios, rootFrequency, periodRatio = 2) {
  if (!Array.isArray(ratios) || !ratios.length) return 1;
  if (!Number.isFinite(rootFrequency) || rootFrequency <= 0
    || !Number.isFinite(periodRatio) || periodRatio <= 1
    || ratios.some(ratio => !Number.isFinite(ratio) || ratio <= 0)) return null;
  const lowest = Math.min(...ratios) * rootFrequency;
  const highest = Math.max(...ratios) * rootFrequency;
  if (lowest >= 20 && highest <= 8000) return 1;
  const period = Math.log(periodRatio);
  const minimum = Math.ceil(Math.log(20 / lowest) / period - 1e-10);
  const maximum = Math.floor(Math.log(8000 / highest) / period + 1e-10);
  if (minimum > maximum) return null;
  const multiplier = periodRatio ** Math.max(minimum, Math.min(maximum, 0));
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}
