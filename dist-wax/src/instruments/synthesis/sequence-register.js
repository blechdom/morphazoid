import { DEFAULT_TUNING_ID, getTuning, tuningRatioForDegree, tuningRatioForSemitoneCoordinate } from './tunings.js';

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

/** The same tuning/register mapping for the live score and offline level probe. */
export function mapSequenceToTuning(cycle, {
  tuningId = DEFAULT_TUNING_ID, rootFrequency = 220, pitchMode = 'nearest',
} = {}) {
  if (!cycle) return null;
  const tuning = getTuning(tuningId);
  const ratioForNote = note => Number.isSafeInteger(note.degree)
    ? tuningRatioForDegree(note.degree, tuning.id)
    : tuningRatioForSemitoneCoordinate(note.semitone, tuning.id, pitchMode);
  const register = cycle.parameters?.fullTraversal || cycle.studyId === 'keyboard-range-arpeggio'
    ? sequenceRegisterMultiplier(cycle.steps.flatMap(step => step.notes.map(ratioForNote)),
      rootFrequency, tuning.periodRatio) ?? 1 : 1;
  const steps = cycle.steps.map(step => ({
    ...step,
    notes: step.notes.flatMap(note => {
      let ratio = ratioForNote(note) * register;
      if (Number.isFinite(ratio) && ratio > 0 && Number.isFinite(rootFrequency) && rootFrequency > 0) {
        while (rootFrequency * ratio > 8000 && rootFrequency * ratio / tuning.periodRatio >= 20) ratio /= tuning.periodRatio;
        while (rootFrequency * ratio < 20 && rootFrequency * ratio * tuning.periodRatio <= 8000) ratio *= tuning.periodRatio;
      }
      const frequency = rootFrequency * ratio;
      return Number.isFinite(ratio) && ratio > 0 && frequency >= 20 && frequency <= 8000
        ? [{ ...note, ratio }] : [];
    }),
  }));
  return { ...cycle, tuningId: tuning.id, pitchMode, steps };
}
