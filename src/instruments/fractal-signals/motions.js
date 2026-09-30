/** Direct parameter transports. Values/directions are normalized and serializable.
 * Reflection direction is the leg for positive tempo; negative tempo retraces it.
 * Exact manual anchors are retained, avoiding log encode/decode changes to presets. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const wrap = (value, period = 1) => { const result = value % period; return result < 0 ? (result + period) % period : result === 0 ? 0 : result; };
export const MOTION_TARGETS = Object.freeze({
  branch: Object.freeze({ onKey: 'motionBranchOn', tempoKey: 'motionBranchTempo', min: 0, max: 64, fallback: .65 }),
  branchAngle: Object.freeze({ onKey: 'motionAngleOn', tempoKey: 'motionAngleTempo', min: 0, max: 360, fallback: 0, circular: true }),
  base: Object.freeze({ onKey: 'motionRootOn', tempoKey: 'motionRootTempo', min: 20, max: 8000, fallback: 440, log: true }),
  index: Object.freeze({ onKey: 'motionIndexOn', tempoKey: 'motionIndexTempo', min: 0, max: 32, fallback: 3 }),
  scan: Object.freeze({ onKey: 'motionScanOn', tempoKey: 'motionScanTempo', min: 0, max: 1, fallback: .45, circular: true, preserveMax: true, modes: ['grains', 'texture'] }),
  turns: Object.freeze({ onKey: 'motionTurnsOn', tempoKey: 'motionTurnsTempo', min: 0, max: 32, fallback: 1.25, circular: true, preserveMax: true, modes: ['grammar'] }),
});
const TARGETS = Object.entries(MOTION_TARGETS);
const anchor = (state, key, spec) => {
  const value = finite(state?.[key], spec.fallback);
  return spec.circular && !(spec.preserveMax && value === spec.max) ? wrap(value, spec.max) : clamp(value, spec.min, spec.max);
};
const normalize = (value, spec) => spec.log
  ? Math.log(value / spec.min) / Math.log(spec.max / spec.min)
  : (value - spec.min) / (spec.max - spec.min);
const expand = (value, spec) => spec.log
  ? spec.min * (spec.max / spec.min) ** value
  : spec.min + value * (spec.max - spec.min);

export function sanitizeMotionState(input = {}) {
  const state = {};
  for (const [, spec] of TARGETS) {
    state[spec.onKey] = input[spec.onKey] === true;
    state[spec.tempoKey] = clamp(finite(input[spec.tempoKey], 6), -120, 120);
  }
  return state;
}

export function createMotions(state, snapshot) {
  const motions = { values: {}, directions: {}, actual: {} };
  for (const [key, spec] of TARGETS) {
    const value = anchor(state, key, spec), position = normalize(value, spec);
    const restored = snapshot?.values?.[key];
    motions.values[key] = Number.isFinite(restored) ? (spec.circular && !(spec.preserveMax && restored === 1) ? wrap(restored) : clamp(restored, 0, 1)) : position;
    motions.directions[key] = snapshot?.directions?.[key] === -1 ? -1 : 1;
    motions.actual[key] = motions.values[key] === position ? value : expand(motions.values[key], spec);
  }
  return motions;
}

export function rebaseMotions(motions, previousState, nextState, { resetMotions = false } = {}) {
  for (const [key, spec] of TARGETS) {
    const value = anchor(nextState, key, spec);
    if (!resetMotions && value === anchor(previousState, key, spec)) continue;
    motions.values[key] = normalize(value, spec);
    motions.actual[key] = value;
    if (resetMotions) motions.directions[key] = 1;
  }
  return motions;
}

/** One full rotation or reflected round trip per beat. No allocations per call. */
export function advanceMotions(motions, state, seconds, { branchReady = true, turnsReady = true } = {}) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return motions;
  for (const [key, spec] of TARGETS) {
    if (!state[spec.onKey] || (spec.modes && !spec.modes.includes(state.mode)) || (key === 'branch' && !branchReady) || (key === 'turns' && !turnsReady)) continue;
    const tempo = clamp(finite(state[spec.tempoKey], 6), -120, 120);
    if (tempo === 0) continue;
    const step = tempo / 60 * seconds;
    if (spec.circular) {
      motions.values[key] = wrap(motions.values[key] + step);
    } else {
      const phase = motions.directions[key] < 0 ? 2 - motions.values[key] : motions.values[key];
      const next = wrap(phase + step * 2, 2);
      motions.values[key] = next <= 1 ? next : 2 - next;
      motions.directions[key] = next < 1 ? 1 : -1;
    }
    motions.actual[key] = expand(motions.values[key], spec);
  }
  return motions;
}

export function motionValues(state, motions, target = {}) {
  for (const [key, spec] of TARGETS) target[key] = motions?.actual?.[key] ?? anchor(state, key, spec);
  return target;
}

export function motionSnapshot(motions, target = { values: {}, directions: {} }) {
  for (const [key] of TARGETS) {
    target.values[key] = motions.values[key];
    target.directions[key] = motions.directions[key];
  }
  return target;
}

/** Nearest prepared value; ties consistently choose the lower frame. */
export function selectMotionFrame(bank, value) {
  const frames = bank?.frames;
  if (!frames?.length || !Number.isFinite(value)) return -1;
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].branch < value) low = middle + 1;
    else high = middle;
  }
  return low > 0 && value - frames[low - 1].branch <= frames[low].branch - value ? low - 1 : low;
}
