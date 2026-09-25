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
