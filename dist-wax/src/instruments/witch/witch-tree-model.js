import { L_SYSTEM_PRESETS, traceLSystem } from '../l-system/l-system.js';

export const WITCH_TREE_TRAVERSAL_SECONDS = 2.05;
const SOURCES = [0, 1, 2, 0, 1, 2];
const ITERATIONS = [5, 3, 3, 6, 3, 3];
const ANGLES = [31, 25, 29, 41, 36, 18];
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));

/** One angle/grammar contract for the upright picture and its audible score.
 * Audio can reuse an output object while a captured branch is being bent. */
export function witchTreeSettings(state = {}, out = {}) {
  const shape = Math.round(clamp(state.treeShape, 0, 5));
  const spread = clamp(state.treeSpread ?? .5), curl = clamp(state.treeCurl ?? .5);
  out.shape = shape; out.spread = spread; out.curl = curl;
  out.angle = spread === .5 ? ANGLES[shape] : ANGLES[shape] * (.76 + .48 * spread);
  out.turnAsymmetry = (shape % 2 ? .15 : -.08) + (curl - .5) * .36;
  return out;
}

/** Native segment indices, parent distances and headings remain the source of
 * truth. Projection to the scene belongs to the renderer, never the score. */
export function traceWitchTree(state = {}) {
  const { shape, angle, turnAsymmetry } = witchTreeSettings(state);
  return traceLSystem({ ...L_SYSTEM_PRESETS[SOURCES[shape]], iterations: ITERATIONS[shape],
    angle, turnAsymmetry, maxSymbols: 6000 });
}
