/** Estimate a beat from the last four tap intervals. No clock or audio ownership. */
export function createTapTempoTracker({ minInterval = 60, resetAfter = 4000, windowSize = 4 } = {}) {
  let previous = null;
  const intervals = [];
  const reset = () => { previous = null; intervals.length = 0; };
  return {
    reset,
    tap(timestamp, timeout = resetAfter) {
      if (!Number.isFinite(timestamp)) return null;
      const interval = previous === null ? null : timestamp - previous;
      if (interval !== null && interval >= 0 && interval < minInterval) return null;
      if (interval === null || interval <= 0 || interval > timeout) {
        reset(); previous = timestamp; return null;
      }
      previous = timestamp;
      intervals.push(interval);
      if (intervals.length > windowSize) intervals.shift();
      return 60000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length);
    },
  };
}

function interpolate(points, value, inverse = false) {
  const curve = inverse ? points.map(([x, y]) => [y, x]) : points;
  const index = Math.max(1, curve.findIndex(([x]) => x >= value));
  const [x1, y1] = value > curve.at(-1)[0] ? curve.at(-2) : curve[index - 1];
  const [x2, y2] = value > curve.at(-1)[0] ? curve.at(-1) : curve[index];
  return y1 + (value - x1) / (x2 - x1) * (y2 - y1);
}

/** Physical beat frequency -> the original control's UI domain. */
export function tapTempoValue(bpm, mapping = {}, current = 0) {
  const hz = bpm / 60 / (mapping.frequencyScale ?? 1);
  const { unit = "bpm", scale = 1, floor = 0, span = 1, exponent = 1, factor = 1, inputScale = 1, referenceBpm = 120 } = mapping;
  let value;
  if (unit === "bpm") value = bpm / scale;
  else if (unit === "hz") value = hz * scale;
  else if (unit === "seconds") value = 1 / hz / scale;
  else if (unit === "milliseconds") value = 1000 / hz / scale;
  else if (unit === "powerHz") value = Math.max(0, (hz - floor) / span) ** (1 / exponent);
  else if (unit === "exponentialHz") value = inputScale * Math.log(hz / floor) / Math.log(factor);
  else if (unit === "shapeHz") value = Math.log1p(hz / 4 * Math.expm1(5.6)) / 5.6;
  else if (unit === "juliaHz") value = interpolate(mapping.points ?? [[-1, .001], [0, .017], [1, .25]], hz, true);
  else if (unit === "piecewiseMilliseconds") value = interpolate(mapping.points, 1000 / hz, true);
  else if (unit === "multiplier") value = bpm / referenceBpm;
  else if (unit === "inverseMultiplier") value = referenceBpm / bpm;
  else if (unit === "exponentialMultiplier") value = Math.log(bpm / referenceBpm) / Math.log(mapping.base ?? 2);
  else throw new TypeError(`Unknown tap tempo unit: ${unit}`);
  return mapping.signed && current < 0 ? -value : value;
}

/** UI domain -> beat frequency, also used to allow deliberately slow tapping. */
export function tapTempoBpm(raw, mapping = {}) {
  const value = mapping.signed ? Math.abs(raw) : raw;
  const { unit = "bpm", scale = 1, floor = 0, span = 1, exponent = 1, factor = 1, inputScale = 1, referenceBpm = 120, frequencyScale = 1 } = mapping;
  if (unit === "bpm") return value * scale;
  if (unit === "hz") return value / scale * 60 * frequencyScale;
  if (unit === "seconds") return 60 / (value * scale);
  if (unit === "milliseconds") return 60000 / (value * scale);
  if (unit === "powerHz") return (floor + span * value ** exponent) * 60 * frequencyScale;
  if (unit === "exponentialHz") return floor * factor ** (value / inputScale) * 60 * frequencyScale;
  if (unit === "shapeHz") return 4 * Math.expm1(5.6 * value) / Math.expm1(5.6) * 60 * frequencyScale;
  if (unit === "juliaHz") return interpolate(mapping.points ?? [[-1, .001], [0, .017], [1, .25]], value) * 60;
  if (unit === "piecewiseMilliseconds") return 60000 / interpolate(mapping.points, value);
  if (unit === "multiplier") return value * referenceBpm;
  if (unit === "inverseMultiplier") return referenceBpm / value;
  if (unit === "exponentialMultiplier") return (mapping.base ?? 2) ** value * referenceBpm;
  throw new TypeError(`Unknown tap tempo unit: ${unit}`);
}
