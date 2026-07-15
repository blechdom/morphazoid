/**
 * Return true when a moving periodic phase crosses a target, including across
 * cycle wrap and when the target itself moves (for a rotating shape).
 */
export function crossesPeriodicTarget(
  previousPhase,
  currentPhase,
  previousTarget,
  currentTarget = previousTarget,
) {
  const previous = previousPhase - previousTarget;
  const current = currentPhase - currentTarget;
  const epsilon = 1e-9;
  if (current > previous) {
    return Math.floor(current + epsilon) > Math.floor(previous + epsilon);
  }
  if (current < previous) {
    return Math.ceil(current - epsilon) < Math.ceil(previous - epsilon);
  }
  return false;
}

/**
 * Return true when a triangular 0 -> 1 -> 0 reader crosses a moving target.
 * The two target preimages are tested on a period-two travel phase, so a
 * frame that straddles a turnaround still observes the endpoint exactly once.
 */
export function crossesPingPongTarget(
  previousTravel,
  currentTravel,
  previousTarget,
  currentTarget = previousTarget,
) {
  if (
    !Number.isFinite(previousTarget) ||
    !Number.isFinite(currentTarget)
  ) {
    return false;
  }

  const previous = previousTravel / 2;
  const current = currentTravel / 2;
  const outward = crossesPeriodicTarget(
    previous,
    current,
    previousTarget / 2,
    currentTarget / 2,
  );
  const returning = crossesPeriodicTarget(
    previous,
    current,
    1 - previousTarget / 2,
    1 - currentTarget / 2,
  );
  return outward || returning;
}

/** Keep fast reader/rotation motion fine enough to expose in-frame crossings. */
export function motionSubsteps(positionDelta, rotationDeltaDegrees) {
  return Math.min(
    120,
    Math.max(
      1,
      Math.ceil(Math.abs(positionDelta) / 0.025),
      Math.ceil(Math.abs(rotationDeltaDegrees) / 2),
    ),
  );
}

/** Move an absolute slider without discarding completed playback cycles. */
export function rebaseContinuousPosition(continuousPosition, wrappedPosition, nextPosition) {
  return continuousPosition + nextPosition - wrappedPosition;
}

/**
 * Move a physical ping-pong slider while retaining the reader's current leg
 * and completed period-two journeys.
 */
export function rebasePingPongPosition(continuousPosition, nextPosition) {
  const physical = Math.max(0, Math.min(1, nextPosition));
  const periodPhase = ((continuousPosition % 2) + 2) % 2;
  const periodBase = continuousPosition - periodPhase;
  return periodPhase <= 1
    ? periodBase + physical
    : periodBase + 2 - physical;
}
