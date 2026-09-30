import { cleanEvents, sanitizeDSPState } from './dsp.js';

/** Scalar routing changes do not alter the prepared Branching score family. */
export function motionBankKey(state = {}) {
  return JSON.stringify(Object.keys(state).sort().filter(key => !/^motion|^lfo/.test(key) && key !== 'branchAngle' && !(state.mode === 'grammar' && key === 'turns'))
    .map(key => [key, state[key]]));
}

/** Worker-side only: complete, bounded bank; never called by the audio callback.
 * Keep structures for drawing. FractalAudio removes them from worklet messages. */
export function buildMotionBank(input, { version = 0, generateStructure } = {}) {
  if (typeof generateStructure !== 'function') throw new TypeError('A structure generator is required.');
  const state = sanitizeDSPState(input), values = Array.from({ length: 65 }, (_, i) => i);
  if (!Number.isInteger(state.branch)) values.push(state.branch);
  values.sort((a, b) => a - b);
  const frames = values.map(branch => {
    const frameState = { ...input, branch }, structure = generateStructure(frameState, { turnsGeometry: state.mode === 'grammar' });
    return { branch, events: cleanEvents(structure, { ...state, branch }),
      branchGeometry: Array.isArray(structure?.branchGeometry) ? structure.branchGeometry.slice(0, 768) : null, branchTurns: structure?.branchTurns ?? null, structure };
  });
  return { version, stateKey: motionBankKey(input), base: state.base, mode: state.mode, frames };
}

export { selectMotionFrame } from './motions.js';
