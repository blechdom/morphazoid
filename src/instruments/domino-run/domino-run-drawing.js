import { MATERIALS, MAX_DOMINOES, sanitizeParams, dominoHeight, applyRunTransform } from './domino-run-model.js';

export const MAX_DRAWN_DOMINOES = MAX_DOMINOES;
export const MAX_DRAWING_STROKES = 64;
export const MAX_DRAWING_POINTS = 8192;
const MAX_STROKE_POINTS = 2048;
const EPSILON = 1e-7;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

function cleanPoints(raw, limit = MAX_STROKE_POINTS) {
  if (!Array.isArray(raw)) return [];
  const points = [];
  // Bound inspection too: malformed persisted input must not scan indefinitely.
  for (const point of raw.slice(0, MAX_STROKE_POINTS)) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    const next = { x: clamp(point.x, -10000, 10000), z: clamp(point.z, -10000, 10000) };
    if (!points.length || distance(points.at(-1), next) > EPSILON) points.push(next);
    if (points.length >= limit) break;
  }
  return points;
}

/** Fresh bounded persisted data; neither caller data nor engine state is mutated. */
export function sanitizeDrawing(raw) {
  const source = Array.isArray(raw) ? raw : raw?.version === 1 ? raw.strokes : [];
  const strokes = [];
  const usedIds = new Set();
  let remaining = MAX_DRAWING_POINTS;
  if (Array.isArray(source)) for (const candidate of source.slice(0, MAX_DRAWING_STROKES)) {
    if (remaining < 2) break;
    const points = cleanPoints(candidate?.points, Math.min(MAX_STROKE_POINTS, remaining));
    if (points.length < 2) continue;
    let id = Number.isInteger(candidate.id) && candidate.id >= 0 && candidate.id < MAX_DRAWING_STROKES
      ? candidate.id : strokes.length;
    // At most 64 strokes are inspected, so a free bounded ID always remains.
    // Wrapping avoids overflow and keeps sanitization stable on repeated saves.
    while (usedIds.has(id)) id = (id + 1) % MAX_DRAWING_STROKES;
    usedIds.add(id);
    strokes.push({ id, closed: candidate.closed === true, points });
    remaining -= points.length;
  }
  return { version: 1, strokes };
}

function pathMetrics(rawPoints, spacing, wantClosed) {
  const points = cleanPoints(rawPoints);
  if (points.length < 2) return { points, segments: [], length: 0, closed: false };
  const endpointGap = distance(points[0], points.at(-1));
  let closed = wantClosed === true && points.length >= 3 && endpointGap <= spacing * 1.5;
  if (closed && endpointGap < EPSILON) points.pop();
  if (points.length < 3) closed = false;
  const segments = [];
  let length = 0;
  const edges = points.length - 1 + Number(closed);
  for (let i = 0; i < edges; i += 1) {
    const from = points[i], to = points[(i + 1) % points.length];
    const extent = distance(from, to);
    if (extent <= EPSILON) continue;
    segments.push({ from, to, start: length, length: extent });
    length += extent;
  }
  // A tiny loop cannot support a useful three-tile ring. Keep it open instead.
  if (closed && length < spacing * 3) return pathMetrics(rawPoints, spacing, false);
  return { points, segments, length, closed };
}

function sampleMetrics(metrics, requestedSpacing, maxPoints) {
  const limit = clamp(Number.isFinite(maxPoints) ? Math.floor(maxPoints) : MAX_DRAWN_DOMINOES, 0, MAX_DRAWN_DOMINOES);
  if (limit < 2 || metrics.length < requestedSpacing || !metrics.segments.length) return [];
  // Redistribute a residual interval over the stroke instead of placing a tiny
  // final gap. Every intended arc interval is <= the requested spacing.
  const intervals = Math.ceil(metrics.length / requestedSpacing);
  const desired = intervals + Number(!metrics.closed);
  const count = Math.min(limit, desired);
  const step = metrics.length / intervals;
  const samples = [];
  let segmentIndex = 0;
  for (let i = 0; i < count; i += 1) {
    const along = i * step;
    while (segmentIndex < metrics.segments.length - 1
      && along > metrics.segments[segmentIndex].start + metrics.segments[segmentIndex].length) segmentIndex += 1;
    const segment = metrics.segments[segmentIndex];
    const fraction = clamp((along - segment.start) / segment.length, 0, 1);
    samples.push({
      x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
      z: segment.from.z + (segment.to.z - segment.from.z) * fraction,
    });
  }
  return samples;
}

/** Even arc-distance samples. Capacity truncates rather than creating long jumps. */
export function samplePolyline(points, { spacing = .72, closed = false, maxPoints = MAX_DRAWN_DOMINOES } = {}) {
  const step = Number.isFinite(spacing) && spacing > EPSILON ? spacing : .72;
  return sampleMetrics(pathMetrics(points, step, closed), step, maxPoints);
}

function emptyBounds() {
  return { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 1,
    width: 2, depth: 2, height: 1 };
}

/**
 * Build one directed path per authored stroke. Intersections and neighboring
 * stroke endpoints do not acquire implicit links. Size/spacing can resample
 * the preserved stroke; sound and material changes never replace its geometry.
 */
export function buildDrawnRun(rawDrawing, rawParams = {}) {
  const drawing = sanitizeDrawing(rawDrawing), params = sanitizeParams(rawParams);
  const dominoes = [], links = [], roots = [], strokeRanges = [];
  const base = 1.2 * params.size, step = base * params.spacing;
  let truncated = false;
  for (const stroke of drawing.strokes) {
    const metrics = pathMetrics(stroke.points, step, stroke.closed);
    const requestedCount = metrics.length < step ? 0
      : Math.ceil(metrics.length / step) + Number(!metrics.closed);
    const samples = sampleMetrics(metrics, step, MAX_DRAWN_DOMINOES - dominoes.length);
    if (samples.length < 2) {
      if (requestedCount >= 2) truncated = true;
      continue;
    }
    const first = dominoes.length;
    const complete = samples.length === requestedCount;
    const closed = metrics.closed && complete && samples.length >= 3;
    truncated ||= !complete;
    const phase = ((params.seed ^ Math.imul(stroke.id + 1, 0x45d9f3b)) >>> 0) / 4294967296 * Math.PI * 2;
    for (let i = 0; i < samples.length; i += 1) {
      const point = samples[i];
      const target = samples[i + 1] ?? (closed ? samples[0] : null);
      const before = samples[i - 1];
      // The last open domino keeps the final path direction, not a reversal.
      const angle = target ? Math.atan2(target.z - point.z, target.x - point.x)
        : Math.atan2(point.z - before.z, point.x - before.x);
      const variation = Math.sin(i * .46 + phase) * .65 + Math.sin(i * .17 + phase * 2) * .35;
      const height = dominoHeight(base, i / Math.max(1, requestedCount - 1), variation, params);
      const material = params.material === 'mixed'
        ? MATERIALS[Math.floor(i / 5 + stroke.id) % MATERIALS.length]
        : MATERIALS.find(candidate => candidate.id === params.material) ?? MATERIALS[0];
      const id = dominoes.length;
      dominoes.push({ id, x: point.x, z: point.z, elevation: 0, height,
        width: height * .5, depth: height * .16, angle,
        material: material.id, color: material.color });
      if (i > 0) links.push({ from: id - 1, to: id });
    }
    if (closed) links.push({ from: dominoes.length - 1, to: first });
    roots.push(first);
    strokeRanges.push({ strokeId: stroke.id, firstId: first, lastId: dominoes.length - 1,
      count: samples.length, requestedCount, closed, truncated: !complete });
  }
  let bounds = emptyBounds();
  if (dominoes.length) {
    const minX = Math.min(...dominoes.map(d => d.x - d.height));
    const maxX = Math.max(...dominoes.map(d => d.x + d.height));
    const minZ = Math.min(...dominoes.map(d => d.z - d.height));
    const maxZ = Math.max(...dominoes.map(d => d.z + d.height));
    const maxY = Math.max(...dominoes.map(d => d.height));
    bounds = { minX, maxX, minZ, maxZ, minY: 0, maxY,
      width: maxX - minX, depth: maxZ - minZ, height: maxY };
  }
  return applyRunTransform({ params, drawing, dominoes, links, roots, bounds, strokeRanges, truncated }, { recenter: false });
}
