import { normalizeHandContour } from './hand-contour.js';

const DIGITS = ['mcp', 'pip', 'dip', 'spread'];
const WRIST = ['flex', 'side', 'twist'];
const FOOT = ['arch', 'twist', 'stretch'];
const record = value => value && typeof value === 'object' ? value : {};
const group = (value, keys) => {
  const result = {};
  for (const key of keys) {
    const curve = normalizeHandContour(record(value)[key]);
    if (curve.some(value => value !== 0)) result[key] = curve;
  }
  return result;
};
/** Sparse corrections leave the original generator and its timing untouched. */
export function normalizeHandMotionEdits(value) {
  const input = record(value), result = {};
  const fingers = Array.from({length: 5}, (_, index) => group(input.fingers?.[index], DIGITS));
  if (fingers.some(finger => Object.keys(finger).length)) result.fingers = fingers;
  for (const [key, keys] of [['wrist', WRIST], ['foot', FOOT]]) {
    const normalized = group(input[key], keys);
    if (Object.keys(normalized).length) result[key] = normalized;
  }
  return result;
}
export function getHandAnimationEdit(config, index, joint) {
  const edits = config.motion?.edits;
  return (index < 5 ? edits?.fingers?.[index] : edits?.[index === 5 ? 'wrist' : 'foot'])?.[joint];
}
/** Mutates only this joint's correction; null removes it. Normalize at commit. */
export function setHandAnimationEdit(config, index, joint, curve) {
  const edits = config.motion.edits ??= {};
  const target = index < 5
    ? (edits.fingers ??= Array.from({length: 5}, () => ({})))[index] ??= {}
    : edits[index === 5 ? 'wrist' : 'foot'] ??= {};
  if (curve == null) delete target[joint];
  else target[joint] = normalizeHandContour(curve);
}
