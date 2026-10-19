export const motionClock = () => ({ playing: false, cycles: 0, anchor: 0 });

export function motionCycles(clock, rate, now) {
  const base = Number.isFinite(clock?.cycles) ? clock.cycles : 0;
  if (!clock?.playing || !Number.isFinite(now) || !Number.isFinite(rate)) return base;
  return base + Math.max(0, now - clock.anchor) * Math.max(0, rate);
}

/** Rebase before Play/Pause or a rate edit so the pose does not jump. */
export function rebaseMotion(clock, rate, now, playing = clock.playing) {
  return { playing: Boolean(playing), cycles: motionCycles(clock, rate, now), anchor: now };
}
