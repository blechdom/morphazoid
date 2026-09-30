/** Two low-frequency modulators. The audio clock owns their phases; UI only observes. */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const wrapPhase = n => Number.isFinite(n) ? ((n % 1) + 1) % 1 : 0;
export const MODULATOR_SHAPES = Object.freeze(['sine', 'triangle', 'rise', 'fall']);
export const MODULATOR_TARGETS = Object.freeze({
  branchAngle: { label: 'Branch angle', modes: ['grammar'], min: 0, max: 360, amount: 180, circular: true },
  base: { label: 'Root', min: 20, max: 8000, amount: 4, log: true },
  index: { label: 'Mod amount', min: 0, max: 32, amount: 16 },
  ratio: { label: 'Mod ratio', min: .03125, max: 32, amount: 4, log: true },
  stereoWidth: { label: 'Stereo width', min: 0, max: 2, amount: 1 },
  space: { label: 'Stereo delay', min: 0, max: 1, amount: .5 },
  echoTime: { label: 'Echo time', modes: ['echoes'], min: .015, max: 3, amount: 3, log: true },
  grainSize: { label: 'Grain size', modes: ['grains', 'texture'], engines: { texture: ['hybrid'] }, min: .005, max: 1.5, amount: 3, log: true },
  scan: { label: 'Source scan', modes: ['grains', 'texture'], engines: { texture: ['hybrid'] }, min: 0, max: 1, amount: .5 },
  bandQ: { label: 'Band Q', modes: ['texture'], engines: { texture: ['noise', 'hybrid'] }, min: .3, max: 24, amount: 3, log: true },
  tilt: { label: 'Spectral tilt', modes: ['texture'], min: -3, max: 3, amount: 3 },
});
const TARGET_KEYS = Object.freeze(Object.keys(MODULATOR_TARGETS));
export const targetsForMode = mode => Object.entries(MODULATOR_TARGETS).filter(([, item]) => !item.modes || item.modes.includes(mode));
export function modulatorTargetAvailable(state, key) {
  const target = MODULATOR_TARGETS[key];
  return Boolean(target && (!target.modes || target.modes.includes(state.mode)) && (!target.engines?.[state.mode] || target.engines[state.mode].includes(state.engine)));
}
export function sanitizeModulatorState(input = {}, mode = input.mode) {
  const result = {};
  for (let i = 1; i <= 2; i++) {
    const prefix = `lfo${i}`, defaultTarget = i === 1 ? mode === 'grammar' ? 'branchAngle' : 'index' : 'stereoWidth';
    const target = MODULATOR_TARGETS[input[`${prefix}Target`]];
    result[`${prefix}On`] = input[`${prefix}On`] === true;
    result[`${prefix}Target`] = target && (!target.modes || target.modes.includes(mode)) ? input[`${prefix}Target`] : defaultTarget;
    result[`${prefix}Shape`] = MODULATOR_SHAPES.includes(input[`${prefix}Shape`]) ? input[`${prefix}Shape`] : 'sine';
  }
  return result;
}
export function modulatorSettings(state) {
  return [1, 2].map(i => ({ enabled: state[`lfo${i}On`] === true && modulatorTargetAvailable(state, state[`lfo${i}Target`]), target: state[`lfo${i}Target`], shape: state[`lfo${i}Shape`],
    rate: clamp(Number(state[`lfo${i}Rate`]) || .1, .01, 20), depth: clamp(Number(state[`lfo${i}Depth`]) || 0, 0, 1) }));
}
export function modulationValue(shape, phase) {
  const p = wrapPhase(phase);
  if (shape === 'triangle') return 1 - 4 * Math.abs(wrapPhase(p + .25) - .5);
  if (shape === 'rise') return p * 2 - 1;
  if (shape === 'fall') return 1 - p * 2;
  return Math.sin(p * Math.PI * 2);
}
export function advanceModulators(phases, slots, seconds) {
  for (let i = 0; i < 2; i++) phases[i] = wrapPhase(phases[i] + seconds * slots[i].rate);
  return phases;
}
/** Reuses target to avoid allocating on the audio thread. Two routes may sum. */
export function modulatedValues(state, slots, phases, target = {}) {
  for (const key of TARGET_KEYS) delete target[key];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i], descriptor = MODULATOR_TARGETS[slot.target];
    if (!slot.enabled || !slot.depth || !descriptor || (descriptor.modes && !descriptor.modes.includes(state.mode))) continue;
    const offset = modulationValue(slot.shape, phases[i]) * slot.depth * descriptor.amount;
    // Sum offsets before clamping so opposite routes cancel, including at a limit.
    target[slot.target] = (target[slot.target] ?? 0) + offset;
  }
  for (const key of TARGET_KEYS) {
    if (target[key] === undefined) continue;
    const descriptor = MODULATOR_TARGETS[key], base = state[key] ?? 0;
    const value = descriptor.log ? base * 2 ** target[key] : base + target[key];
    target[key] = descriptor.circular ? wrapPhase(value / 360) * 360 : clamp(value, descriptor.min, descriptor.max);
  }
  return target;
}
