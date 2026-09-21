/**
 * Keep normal-frame timing, but never compress a long paint stall into a burst.
 * The frame covers [now - span, now]. Only its last 30 ms may be replayed, with
 * the original spacing retained. This is not yet a paint-independent scheduler.
 */
export function planShapeCornerStrikes(intents, frameSpanSeconds, now) {
  const span = Number.isFinite(frameSpanSeconds) ? Math.max(0, frameSpanSeconds) : 0;
  const recentStart = Math.max(0, span - 0.03);
  return intents.flatMap(intent => {
    const phase = Math.max(0, Math.min(1, Number(intent.time01) || 0));
    const offset = phase * span;
    if (offset + 1e-9 < recentStart) return [];
    return [{ ...intent, startAt: now + Math.max(0, offset - recentStart) }];
  });
}
