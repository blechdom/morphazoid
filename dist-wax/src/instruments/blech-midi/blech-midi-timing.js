const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Scale a file's existing tempo map; this does not rewrite tempo events or seek.
 * Without a musical source tempo (for example SMPTE), only the ratio applies.
 * effectiveBpm describes the initial tempo, not later changes within the score.
 */
export function resolveBlechFileTiming({ sourceTempo, masterTempo, linked = false,
  freeTempo = null, ratio = 1, minRate = 0.01, maxRate = 8 } = {}) {
  const source = positive(sourceTempo, null), speed = positive(ratio, 1);
  const minimum = Math.max(0.001, Math.min(0.5, positive(minRate, 0.01)));
  const maximum = Math.max(minimum, Math.min(8, positive(maxRate, 8)));
  const base = linked ? positive(masterTempo, source) : positive(freeTempo, source);
  const requestedRate = source === null ? speed : speed * (base / source);
  const rate = Math.max(minimum, Math.min(maximum, requestedRate));
  return { requestedRate, rate, effectiveBpm: source === null ? null : source * rate,
    limited: rate !== requestedRate };
}
