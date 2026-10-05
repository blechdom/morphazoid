import { buildPath, cleanPoints, distance } from './model.js';
import { boundsFromPoints } from '../../geometry.js';

function measure(points) {
  const cumulativeLengths = [0]; let totalLength = 0;
  for (let i = 0; i < points.length; i++) {
    totalLength += distance(points[i], points[(i + 1) % points.length]);
    if (i < points.length - 1) cumulativeLengths.push(totalLength);
  }
  return { cumulativeLengths, totalLength };
}
export function rotatePath(path, degrees) {
  if (!degrees) return path;
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const points = path.points.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  return { ...path, points, bounds: boundsFromPoints(points), rotationDeg: degrees };
}

// Adapt authored contours to the same path contract used by Shape's readers.
export function buildPerformancePath(blob, params) {
  const raw = buildPath(blob);
  if (!raw) return null;
  const anchors = cleanPoints(blob.points);
  const points = Array.from({ length: raw.samples.length / 2 }, (_, i) => ({ x: raw.samples[i * 2] * 2 - 1, y: raw.samples[i * 2 + 1] * 2 - 1 }));
  const anchorIndices = [...new Set(anchors.map(p => {
    let best = 0, nearest = Infinity;
    points.forEach((sample, i) => { const d = Math.hypot(sample.x - (p.x * 2 - 1), sample.y - (p.y * 2 - 1)); if (d < nearest) { best = i; nearest = d; } });
    return best;
  }))].sort((a, b) => a - b);
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 });
  // Roundness bends the space between authored points; the anchors stay put.
  if (params.curvature) for (let a = 0; a < anchorIndices.length; a++) {
    const start = anchorIndices[a], end = a + 1 < anchorIndices.length ? anchorIndices[a + 1] : anchorIndices[0] + points.length;
    for (let i = start + 1; i < end; i++) {
      const p = points[i % points.length], t = (i - start) / (end - start), scale = 1 + params.curvature * .45 * Math.sin(Math.PI * t) ** 2;
      p.x = center.x + (p.x - center.x) * scale; p.y = center.y + (p.y - center.y) * scale;
    }
  }
  const sx = 2 ** params.aspect, sy = 2 ** -params.aspect;
  for (const p of points) { p.y *= sy; p.x = p.x * sx + params.skew * p.y; }
  const fit = Math.max(1, ...points.map(p => Math.hypot(p.x, p.y)));
  for (const p of points) { p.x /= fit; p.y /= fit; }
  const measured = measure(points);
  const vertexIndices = params.cornerMode === 'even'
    ? Array.from({ length: params.corners }, (_, i) => {
      const target = measured.totalLength * i / params.corners;
      return measured.cumulativeLengths.reduce((best, length, index) => Math.abs(length - target) < Math.abs(measured.cumulativeLengths[best] - target) ? index : best, 0);
    })
    : (blob.tool === 'pencil' && anchorIndices.length > 32
      ? anchorIndices.filter((_, i) => i % Math.ceil(anchorIndices.length / 24) === 0)
      : anchorIndices.length > 32 ? Array.from({ length: 32 }, (_, i) => anchorIndices[Math.floor(i * anchorIndices.length / 32)]) : anchorIndices);
  const cornerTurns = vertexIndices.map(index => {
    const p = points[index], a = points[(index - 3 + points.length) % points.length], b = points[(index + 3) % points.length];
    return Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / Math.PI;
  });
  return {
    points, closed: true, ...measured, bounds: boundsFromPoints(points),
    vertexIndices, vertexDistances: vertexIndices.map(i => measured.cumulativeLengths[i]),
    cornerTurns, cornerStrengths: cornerTurns.map(turn => params.cornerMode === 'even' ? Math.max(.35, Math.abs(turn)) : Math.abs(turn)),
    sides: Math.max(3, vertexIndices.length), vertexCount: vertexIndices.length, shapeType: 'polygon', starDepth: 0,
    curvature: params.curvature, aspect: params.aspect, skew: params.skew, asymmetry: 0, rotationDeg: 0, samplesPerEdge: 16,
    transform: { sx, sy, skew: params.skew, fit }, anchorIndices, locations: raw.locations,
  };
}
export function transformAnchor(point, path, degrees) {
  const { sx, sy, skew, fit } = path.transform;
  const y = (point.y * 2 - 1) * sy / fit, x = ((point.x * 2 - 1) * sx + skew * y * fit) / fit;
  const a = degrees * Math.PI / 180;
  return { x: (x * Math.cos(a) - y * Math.sin(a) + 1) / 2, y: (x * Math.sin(a) + y * Math.cos(a) + 1) / 2 };
}
export function inverseAnchor(point, path, degrees) {
  const { sx, sy, skew, fit } = path.transform, a = -degrees * Math.PI / 180;
  const u = point.x * 2 - 1, v = point.y * 2 - 1;
  const x = (u * Math.cos(a) - v * Math.sin(a)) * fit, y = (u * Math.sin(a) + v * Math.cos(a)) * fit;
  return { x: ((x - skew * y) / sx + 1) / 2, y: (y / sy + 1) / 2 };
}
