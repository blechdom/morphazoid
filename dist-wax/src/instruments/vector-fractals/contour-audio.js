import { TABLE_SIZE, TAU, fft, frameFromSpectrum, sanitizeState } from './model.js';

/** Arc length is a sampling coordinate, never equal time per adaptive vertex. */
export function contourSamples(points, closed, count = TABLE_SIZE) {
  const n = Math.floor((points?.length ?? 0) / 2);
  const x = new Float64Array(count), y = new Float64Array(count);
  if (n < 2) return { x, y };
  const segments = closed ? n : n - 1;
  const length = new Float64Array(segments + 1);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n;
    length[i + 1] = length[i] + Math.hypot(points[j * 2] - points[i * 2], points[j * 2 + 1] - points[i * 2 + 1]);
  }
  const total = length[segments];
  if (!Number.isFinite(total)) throw new Error('Contour coordinates must be finite.');
  if (total < 1e-15) return { x, y };
  // Canonical open-arc direction reduces flips between contour refinements.
  const reverse = !closed && (points[0] > points[(n - 1) * 2] || (points[0] === points[(n - 1) * 2] && points[1] > points[(n - 1) * 2 + 1]));
  for (let i = 0; i < count; i++) {
    let position = closed ? i / count : .5 - .5 * Math.cos(TAU * i / count);
    if (reverse) position = 1 - position;
    const target = position * total;
    let lo = 0, hi = segments - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (length[mid + 1] < target) lo = mid + 1; else hi = mid; }
    const j = (lo + 1) % n, mix = (target - length[lo]) / Math.max(1e-20, length[lo + 1] - length[lo]);
    x[i] = points[lo * 2] + mix * (points[j * 2] - points[lo * 2]);
    y[i] = points[lo * 2 + 1] + mix * (points[j * 2 + 1] - points[lo * 2 + 1]);
  }
  return { x, y };
}

export function createContourBank(input, path) {
  const state = sanitizeState({ ...input, mode: 'explorer' });
  const { x, y } = contourSamples(path?.points, Boolean(path?.closed));
  fft(x, y);
  return { state, frames: [frameFromSpectrum(x, y)], contour: true, silent: !path || path.points.length < 4 };
}
