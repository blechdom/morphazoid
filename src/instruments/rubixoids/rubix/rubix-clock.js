/** Piecewise-linear swung transport, split at note boundaries before rendering. */
export function rubixSimdClock(beat, rate, swing, divisions = 1) {
  const pair = Math.floor(beat / 2);
  const within = beat - pair * 2;
  const long = within < 1 + swing;
  const duration = long ? 1 + swing : 1 - swing;
  const phase = (pair * 2 + (long ? within / duration : 1 + (within - 1 - swing) / duration)) * divisions;
  const slope = rate * divisions / duration;
  return { phase, slope, secondsToNext: (Math.floor(phase + 1e-9) + 1 - phase) / slope };
}

/** Finish the current long/short pair before changing its swing shape. */
export function rubixSimdSwingEdit(beat, swing, pendingSwing, target, active = true, applyAt) {
  if (pendingSwing && beat >= pendingSwing.beat - 1e-8) {
    swing = pendingSwing.swing;
    pendingSwing = null;
  }
  if (!active || applyAt === null || !Number.isFinite(swing)) {
    return { swing: target, pendingSwing: null };
  }
  if (target === swing && !pendingSwing) return { swing, pendingSwing: null };
  const boundary = Number.isFinite(applyAt) ? applyAt
    : pendingSwing?.beat ?? (Math.floor(beat / 2 + 1e-8) + 1) * 2;
  if (boundary <= beat + 1e-8) return { swing: target, pendingSwing: null };
  return { swing, pendingSwing: { beat: boundary, swing: target } };
}

/** Preserve the next musical position when a preset changes score subdivisions. */
export function rubixRetimedOrdinal(ordinal, previousSubdivisions, subdivisions) {
  return ordinal === null ? null : Math.ceil(ordinal / previousSubdivisions * subdivisions - 1e-8);
}

/** Keep submitted notes; recover a moved deadline without a burst or lasting drift. */
export function rubixLiveGridDeadline(gridTime, now, previous, interval) {
  // At most 1/8 of an interval is recovered per note. Equal-length bridging
  // would perpetuate the first delayed note's offset indefinitely.
  const earliest = previous ? previous.when + Math.min(previous.duration, interval) * 0.875 : -Infinity;
  return Math.max(gridTime, now + 0.003, earliest);
}
