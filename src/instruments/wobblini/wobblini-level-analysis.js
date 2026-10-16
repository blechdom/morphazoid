/** Static RMS matching, not perceptual LUFS or a live compressor. Peak headroom
 * limits boosts; quiet/silent files never get unbounded amplification. */
export function analyzeTrackLevel(channels) {
  let sum = 0, count = 0, peak = 0;
  for (const channel of channels) for (const value of channel) {
    if (!Number.isFinite(value)) continue;
    sum += value * value; count++; peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (rms < 1e-6 || peak === 0) return { rms, peak, gainDb: 0 };
  const target = -18 - 20 * Math.log10(rms), headroom = -1 - 20 * Math.log10(peak);
  return { rms, peak, gainDb: Math.max(-12, Math.min(12, target, headroom)) };
}
