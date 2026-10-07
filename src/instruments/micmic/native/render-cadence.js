const DEFAULT_FRAME_MS = 1000 / 60;
const MAX_CALIBRATION_INTERVAL_MS = 50;
const FASTER_INTERVALS_REQUIRED = 3;

/** Keep native RAF cadence separate from intentional draw throttling. Slower
 * refresh is learned only while the caller explicitly runs cheap calibration;
 * late callbacks during live rendering remain evidence of missed frames. */
export function createRenderCadence() {
  let baselineFrameMs, previousTime, previousContinuous, skippedCallbacks;
  let calibrationMean, calibrationSamples, fasterMean, fasterSamples;
  let observedIntervals, lastIntervalMs, lastExpectedFrameMs;

  function reset() {
    baselineFrameMs = DEFAULT_FRAME_MS;
    previousTime = null;
    previousContinuous = false;
    skippedCallbacks = 0;
    calibrationMean = 0;
    calibrationSamples = 0;
    fasterMean = 0;
    fasterSamples = 0;
    observedIntervals = 0;
    lastIntervalMs = 0;
    lastExpectedFrameMs = DEFAULT_FRAME_MS;
  }

  function record(nowMs, { continuous = true, calibrating = false } = {}) {
    if (!Number.isFinite(nowMs) || (previousTime !== null && nowMs <= previousTime)) return baselineFrameMs;
    const interval = previousTime === null ? 0 : nowMs - previousTime;
    const uninterrupted = previousContinuous && continuous;
    previousTime = nowMs;
    previousContinuous = continuous;
    if (!continuous) {
      skippedCallbacks = 0;
      fasterSamples = 0;
      return baselineFrameMs;
    }
    if (!uninterrupted) return baselineFrameMs;
    observedIntervals++;
    lastIntervalMs = interval;
    if (interval > MAX_CALIBRATION_INTERVAL_MS) {
      fasterSamples = 0;
      return baselineFrameMs;
    }

    if (calibrating) {
      // A missed calibration callback is a multiple of the native period.
      // Average the fastest coherent cluster without retaining sample arrays.
      if (!calibrationSamples || interval < calibrationMean * .85) {
        calibrationMean = interval;
        calibrationSamples = 1;
      } else if (interval <= calibrationMean * 1.15) {
        calibrationSamples++;
        calibrationMean += (interval - calibrationMean) / calibrationSamples;
      }
      baselineFrameMs = calibrationMean;
      fasterSamples = 0;
      return baselineFrameMs;
    }

    // A display can move to a faster refresh mode. Require several adjacent
    // callbacks to prove it; never relearn a slower baseline under GPU load.
    if (interval < baselineFrameMs * .9) {
      if (!fasterSamples || Math.abs(interval - fasterMean) > fasterMean * .1) {
        fasterMean = interval;
        fasterSamples = 1;
      } else {
        fasterSamples++;
        fasterMean += (interval - fasterMean) / fasterSamples;
      }
      if (fasterSamples >= FASTER_INTERVALS_REQUIRED) {
        baselineFrameMs = fasterMean;
        fasterSamples = 0;
      }
    } else fasterSamples = 0;
    return baselineFrameMs;
  }

  function skipped() { skippedCallbacks++; }

  function rendered() {
    lastExpectedFrameMs = baselineFrameMs * (skippedCallbacks + 1);
    skippedCallbacks = 0;
    return lastExpectedFrameMs;
  }

  function diagnostics() {
    return { baselineFrameMs, refreshRate: 1000 / baselineFrameMs,
      calibrated: calibrationSamples > 0, calibrationSamples, observedIntervals,
      skippedCallbacks, lastIntervalMs, lastExpectedFrameMs };
  }

  reset();
  return { record, skipped, rendered, reset, diagnostics };
}
