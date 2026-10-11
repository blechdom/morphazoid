export const MOTION_DEFAULTS = Object.freeze({
  realMotionTempo: 6, imagMotionTempo: 4.5,
  realMotionDepth: .035, imagMotionDepth: .035,
});
export const MOTION_LIMITS = Object.freeze({
  tempo: Object.freeze([.25, 60]), depth: Object.freeze([0, 1.5]),
});

const TAU = Math.PI * 2;
const AXES = Object.freeze({ real: 'cReal', imag: 'cImag' });
const DEFAULT_COORDINATE_LIMITS = Object.freeze({
  cReal: Object.freeze([-2, 1]), cImag: Object.freeze([-1.5, 1.5]),
});
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const cycle = phase => ((phase % 1) + 1) % 1;

function coordinateRange(candidate, fallback) {
  return Array.isArray(candidate) && candidate.length === 2 &&
    candidate.every(value => typeof value === 'number' && Number.isFinite(value)) && candidate[0] <= candidate[1]
    ? [...candidate] : [...fallback];
}
function setInterval(state, limits) {
  state.low = Math.max(limits[0], state.center - state.depth);
  state.high = Math.min(limits[1], state.center + state.depth);
}
function phaseAt(value, low, high) {
  const amplitude = (high - low) / 2;
  if (!(amplitude > 0)) return 0;
  return cycle(Math.asin(clamp((value - (low + high) / 2) / amplitude, -1, 1)) / TAU);
}
function pose(state) {
  return clamp((state.low + state.high) / 2 + (state.high - state.low) / 2 * Math.sin(state.phase * TAU), state.low, state.high);
}

/** Independent sine sweeps; the caller owns the clock and atomic audio updates.
 * Phase is measured in cycles. A beat is one complete back-and-forth cycle.
 * Coordinate echoes in sync() never recenter a sweep unless explicitly requested.
 */
export function createParameterMotion(parameters = {}, coordinateLimits = DEFAULT_COORDINATE_LIMITS) {
  const limits = Object.fromEntries(Object.values(AXES).map(key =>
    [key, coordinateRange(coordinateLimits?.[key], DEFAULT_COORDINATE_LIMITS[key])]));
  const states = {};
  const source = parameters && typeof parameters === 'object' ? parameters : {};
  for (const [axis, coordinate] of Object.entries(AXES)) {
    const tempoKey = `${axis}MotionTempo`, depthKey = `${axis}MotionDepth`;
    const value = clamp(finite(source[coordinate], 0), ...limits[coordinate]);
    const state = states[axis] = { playing: false, phase: 0, center: value, value,
      low: value, high: value,
      tempo: clamp(finite(source[tempoKey], MOTION_DEFAULTS[tempoKey]), ...MOTION_LIMITS.tempo),
      depth: clamp(finite(source[depthKey], MOTION_DEFAULTS[depthKey]), ...MOTION_LIMITS.depth) };
    setInterval(state, limits[coordinate]);
    state.phase = phaseAt(value, state.low, state.high);
  }
  const values = () => ({ cReal: states.real.value, cImag: states.imag.value });
  const snapshot = () => ({ real: { ...states.real }, imag: { ...states.imag } });
  function advance(deltaSeconds) {
    if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return values();
    for (const state of Object.values(states)) {
      if (!state.playing) continue;
      const period = 60 / state.tempo;
      // Reduce elapsed time before multiplication, including very large finite gaps.
      state.phase = cycle(state.phase + (deltaSeconds % period) / period);
      state.value = pose(state);
    }
    return values();
  }
  function sync(candidate = {}, options = {}) {
    const next = candidate && typeof candidate === 'object' ? candidate : {};
    const recenter = Array.isArray(options?.recenter) ? options.recenter : [];
    for (const [axis, coordinate] of Object.entries(AXES)) {
      const state = states[axis], oldDepth = state.depth;
      state.tempo = clamp(finite(next[`${axis}MotionTempo`], state.tempo), ...MOTION_LIMITS.tempo);
      state.depth = clamp(finite(next[`${axis}MotionDepth`], state.depth), ...MOTION_LIMITS.depth);
      if (recenter.includes(axis)) {
        state.center = state.value = clamp(finite(next[coordinate], state.value), ...limits[coordinate]);
        setInterval(state, limits[coordinate]);
        state.phase = phaseAt(state.value, state.low, state.high);
      } else if (state.depth !== oldDepth) {
        setInterval(state, limits[coordinate]);
        state.value = pose(state);
      }
    }
    return snapshot();
  }
  function setPlaying(axis, playing) {
    if (axis !== 'real' && axis !== 'imag') return false;
    states[axis].playing = !!playing;
    return true;
  }
  return { advance, sync, setPlaying, snapshot };
}
