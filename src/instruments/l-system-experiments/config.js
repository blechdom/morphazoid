import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE } from '../micmic/native/model.js';
import { captureMastering } from '../micmic/native/mastering.js';
import { defaultLab, sanitizeLab } from '../l-system-parametric-lab/model.js';
export const KIND_LABELS = Object.freeze({ context: 'Context-sensitive branches', 'thue-morse': 'Thue–Morse sequence',
  fibonacci: 'Algae / Fibonacci sequence', penrose: 'Penrose triangle tiling', sphinx: 'Sphinx tiling' });
const scene = (id, label, kind, lab = {}, parameters = {}) => ({ id, label, snapshot: {
  parameters: { ...DEFAULT_PARAMETERS, generations: lab.iterations ?? 6, angle: 45, intervalMs: 120, mutation: 0,
    ...parameters, lab: sanitizeLab({ ...defaultLab(kind), ...lab }) },
  performance: { wet: DEFAULT_PERFORMANCE.wet, dry: DEFAULT_PERFORMANCE.dry, mastering: captureMastering(DEFAULT_PERFORMANCE.mastering) },
} });
export const PRESETS = Object.freeze([
  scene('neighbor-canopy', 'Neighbor Canopy', 'context', { iterations: 6, contextStrength: .7 }),
  scene('neighbor-sparse', 'Neighbor Openings', 'context', { iterations: 8, contextStrength: .2, symbolRatio: 1.8 }, { angle: 28, intervalMs: 240 }),
  scene('thue-morse', 'Thue–Morse Fold', 'thue-morse', { iterations: 7, symbolRatio: 1.5 }, { angle: 90, timeRatio: 1 }),
  scene('thue-wave', 'Thue–Morse Wave', 'thue-morse', { iterations: 8, symbolRatio: .65 }, { angle: 30, timeRatio: 1, intervalMs: 60 }),
  scene('fibonacci', 'Algae Spiral', 'fibonacci', { iterations: 9, symbolRatio: 1.618 }, { angle: 60, timeRatio: 1 }),
  scene('fibonacci-wide', 'Fibonacci River', 'fibonacci', { iterations: 10, symbolRatio: 2.2 }, { angle: 22.5, intervalMs: 95, timeRatio: 1 }),
  scene('penrose-star', 'Penrose Star', 'penrose', { iterations: 4, symbolRatio: 1.618 }, { angle: 36, intervalMs: 85, timeRatio: 1 }),
  scene('penrose-glass', 'Penrose Glass', 'penrose', { iterations: 5, symbolRatio: .75 }, { angle: 36, intervalMs: 190, timeRatio: 1, pitchScale: .45 }),
  scene('sphinx', 'Sphinx Mosaic', 'sphinx', { iterations: 3, symbolRatio: 1.5 }, { angle: 60, intervalMs: 110, timeRatio: 1 }),
  scene('sphinx-short', 'Sphinx Shimmer', 'sphinx', { iterations: 4, symbolRatio: .6 }, { angle: 60, intervalMs: 40, timeRatio: 1, depth: .85 }),
]);
export const config = Object.freeze({ id: 'l-system-experiments', label: 'L-system Experiments', mode: 'experiments',
  image: 'assets/instruments/l-system-experiments.webp', presets: PRESETS, kinds: Object.keys(KIND_LABELS),
  description: 'Compare neighbor-dependent branches, symbolic sequences and recursive tiling edges as live delay structures.',
  start: 'Choose an input and enable Audio. Select a rule family, then change iterations and symbol ratio.', nextId: 'micmic-rust', nextHref: 'l-mic-rust.html', nextLabel: 'L-system Delay Rust' });
