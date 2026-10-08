/** Rust delay control units. The original JavaScript instrument keeps its own curve. */
export const MIN_TIME_FOLD_MS = .05;
export const MAX_TIME_FOLD_MS = 3000;
const LOW_MS = 50, HIGH_MS = 1000;
const LOW_POSITION = 150, HIGH_POSITION = 900, LAST_POSITION = 1000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

/** Give short folds useful dial travel, retaining the existing larger-fold anchors. */
export function timeFoldFromSlider(position) {
  const value = clamp(position, 0, LAST_POSITION);
  if (value <= LOW_POSITION) return MIN_TIME_FOLD_MS * (LOW_MS / MIN_TIME_FOLD_MS) ** (value / LOW_POSITION);
  if (value <= HIGH_POSITION) return LOW_MS + (HIGH_MS - LOW_MS) * (value - LOW_POSITION) / (HIGH_POSITION - LOW_POSITION);
  return HIGH_MS + (MAX_TIME_FOLD_MS - HIGH_MS) * (value - HIGH_POSITION) / (LAST_POSITION - HIGH_POSITION);
}

/** Preserve exact preset/gesture values instead of quantizing them to whole milliseconds. */
export function sliderFromTimeFold(milliseconds) {
  const value = clamp(milliseconds, MIN_TIME_FOLD_MS, MAX_TIME_FOLD_MS);
  if (value <= LOW_MS) return LOW_POSITION * Math.log(value / MIN_TIME_FOLD_MS) / Math.log(LOW_MS / MIN_TIME_FOLD_MS);
  if (value <= HIGH_MS) return LOW_POSITION + (HIGH_POSITION - LOW_POSITION) * (value - LOW_MS) / (HIGH_MS - LOW_MS);
  return HIGH_POSITION + (LAST_POSITION - HIGH_POSITION) * (value - HIGH_MS) / (MAX_TIME_FOLD_MS - HIGH_MS);
}

export function formatTimeFold(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value > 0 && value < .001) return '<0.001 ms';
  return `${Number(value.toFixed(value < 1 ? 3 : 2))} ms`;
}
