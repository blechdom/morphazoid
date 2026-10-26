// The same Play clock drives the silent canvas and the sample-clock visitor.
// Travel and paw phase are integrated so live preset edits cannot rewind them.
export const WITCH_CAT_GAITS = Object.freeze(['cat-prowl', 'cat-gallop', 'walk', 'tiptoe']);
export const WITCH_CAT_PERIOD = 30;
export const WITCH_CAT_DURATION = 7;
export const WITCH_CAT_STEPS_PER_SECOND = 48;

const clamp = (value, low, high, fallback) => Number.isFinite(value)
  ? Math.max(low, Math.min(high, value)) : fallback;
const speedOf = config => clamp(config.catSpeed, .5, 2, 1);
const gaitOf = config => WITCH_CAT_GAITS.includes(config.catGait) ? config.catGait : 'cat-prowl';

/** A small transferable clock; no DOM, timer, audio node, or renderer. */
export function createWitchCatClock(time = 0, config = {}, snapshot = null) {
  const safeTime = clamp(time, 0, Number.MAX_SAFE_INTEGER, 0);
  const visit = Math.floor(safeTime / WITCH_CAT_PERIOD);
  const elapsed = safeTime - visit * WITCH_CAT_PERIOD;
  const speed = speedOf(config), gait = gaitOf(config);
  const progress = visit > 0 ? Math.min(1, elapsed * speed / WITCH_CAT_DURATION) : 0;
  const clock = { time: safeTime, visit, progress,
    position: progress * WITCH_CAT_DURATION * WITCH_CAT_STEPS_PER_SECOND,
    active: visit > 0 && progress < 1, speed, gait };
  if (snapshot && snapshot.visit === visit && Number.isFinite(snapshot.progress) && Number.isFinite(snapshot.position)) {
    clock.progress = clamp(snapshot.progress, 0, 1, progress);
    clock.position = clamp(snapshot.position, 0, WITCH_CAT_DURATION * WITCH_CAT_STEPS_PER_SECOND, clock.position);
    clock.active = visit > 0 && snapshot.active === true && clock.progress < 1 && elapsed < WITCH_CAT_DURATION / .5;
    clock.speed = clamp(snapshot.speed, .5, 2, speed);
    clock.gait = WITCH_CAT_GAITS.includes(snapshot.gait) ? snapshot.gait : gait;
  }
  return clock;
}

/** Mutates the fixed clock. Skipped visits are never replayed. */
export function advanceWitchCatClock(clock, absolutePlayTime, config = {}) {
  const time = clamp(absolutePlayTime, 0, Number.MAX_SAFE_INTEGER, clock.time);
  const speed = speedOf(config), gait = gaitOf(config);
  const visit = Math.floor(time / WITCH_CAT_PERIOD);
  const elapsed = time - visit * WITCH_CAT_PERIOD;
  const oldTime = clock.time;
  if (time < oldTime || visit !== clock.visit) {
    // A seek or a new visit has no stale attacks to catch up. The current
    // visit starts at its own period boundary, regardless of the last speed.
    clock.visit = visit;
    clock.progress = visit > 0 ? Math.min(1, elapsed * speed / WITCH_CAT_DURATION) : 0;
    clock.position = clock.progress * WITCH_CAT_DURATION * WITCH_CAT_STEPS_PER_SECOND;
    clock.active = visit > 0 && clock.progress < 1;
  } else if (clock.active) {
    const travelSeconds = Math.min((1 - clock.progress) * WITCH_CAT_DURATION, (time - oldTime) * speed);
    clock.progress = Math.min(1, clock.progress + travelSeconds / WITCH_CAT_DURATION);
    clock.position += travelSeconds * WITCH_CAT_STEPS_PER_SECOND;
    clock.active = clock.progress < 1 && elapsed < WITCH_CAT_DURATION / .5;
  }
  clock.time = time;
  clock.speed = speed;
  clock.gait = gait;
  return clock;
}

export function snapshotWitchCatClock(clock) {
  return { time: clock.time, visit: clock.visit, progress: clock.progress,
    position: clock.position, active: clock.active, speed: clock.speed, gait: clock.gait };
}
