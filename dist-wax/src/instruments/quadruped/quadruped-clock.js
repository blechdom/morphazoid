// The audio device owns elapsed time while Audio is enabled, including when
// suspended. Explicit Audio-off uses a monotonic wall clock for silent motion.
export function createQuadrupedClock(performanceMs, audioTime = null) {
  return { performanceMs, audioTime, deltaSeconds: 0 };
}

export function readQuadrupedClock(clock, performanceMs, audioTime = null) {
  const wall = Math.max(clock.performanceMs, Number.isFinite(performanceMs) ? performanceMs : clock.performanceMs);
  const audio = Number.isFinite(audioTime) ? audioTime : null;
  const delta = audio !== null && clock.audioTime !== null
    ? audio - clock.audioTime : (wall - clock.performanceMs) / 1000;
  return { performanceMs: wall, audioTime: audio, deltaSeconds: Math.max(0, Math.min(2, delta)) };
}
