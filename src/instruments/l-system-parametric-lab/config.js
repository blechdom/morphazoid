import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE } from '../micmic/native/model.js';
import { captureMastering } from '../micmic/native/mastering.js';
import { defaultLab, sanitizeLab } from './model.js';
const scene = (id, label, lab, parameters = {}) => ({ id, label, snapshot: {
  parameters: { ...DEFAULT_PARAMETERS, generations: lab.iterations ?? 6, angle: 35, intervalMs: 180, mutation: 0,
    ...parameters, lab: sanitizeLab({ ...defaultLab(), ...lab }) },
  performance: { wet: DEFAULT_PERFORMANCE.wet, dry: DEFAULT_PERFORMANCE.dry, mastering: captureMastering(DEFAULT_PERFORMANCE.mastering) },
} });
export const PRESETS = Object.freeze([
  scene('module-pine', 'Module Pine', { iterations: 8, lengthRatio: .72, delayRatio: .72 }),
  scene('unfolding-fan', 'Unfolding Fan', { iterations: 5, branchCount: 4, angleIncrement: 8, lengthRatio: .78 }, { angle: 22, pitchScale: .4 }),
  scene('five-finger', 'Five Finger Canopy', { iterations: 5, branchCount: 5, lengthRatio: .58, delayRatio: .82 }, { angle: 20, intervalMs: 96 }),
  scene('six-petals', 'Six Petal Echo', { iterations: 4, branchCount: 6, angleIncrement: 12, lengthRatio: .65, pitchRatio: 1.04 }, { angle: 24, intervalMs: 280 }),
  scene('long-spiral', 'Long Spiral', { iterations: 8, lengthRatio: .92, angleIncrement: 18, delayRatio: 1.05 }, { angle: 12, curls: .45, pitchScale: .6 }),
  scene('shortening-chimes', 'Shortening Chimes', { iterations: 10, lengthRatio: .6, minLength: .007, delayRatio: .52, pitchRatio: 1.08 }, { angle: 62, intervalMs: 450 }),
  scene('falling-folds', 'Falling Folds', { iterations: 8, lengthRatio: .82, angleIncrement: -7, delayRatio: .9, pitchRatio: .92 }, { angle: 42, intervalMs: 320 }),
  scene('open-roots', 'Open Roots', { iterations: 6, branchCount: 3, lengthRatio: 1.08, minLength: .002, delayRatio: 1.15 }, { angle: 52, pitchScale: .3, depth: .88 }),
]);
export const config = Object.freeze({ id: 'l-system-parametric-lab', label: 'L-system Parametric Lab', mode: 'parametric',
  image: 'assets/instruments/l-system-parametric-lab.webp', presets: PRESETS, kinds: ['parametric'],
  description: 'Numeric rule modules carry branch length, turn, delay and pitch into the same visible and audible structure.',
  start: 'Choose an input and enable Audio. Explore module ratios, branch count and the stopping length.', nextId: 'l-system-experiments', nextHref: 'l-system-experiments.html', nextLabel: 'L-system Experiments' });
