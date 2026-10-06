import { buildPath, cleanPoints, distance, clamp } from './model.js';
import { boundsFromPoints } from '../../geometry.js';

function measure(points) {
  const cumulativeLengths = [0]; let totalLength = 0;
  for (let i = 0; i < points.length; i++) {
    totalLength += distance(points[i], points[(i + 1) % points.length]);
    if (i < points.length - 1) cumulativeLengths.push(totalLength);
  }
  return { cumulativeLengths, totalLength };
}
// Offsets are expressed in the editor's 0–1 stage, after form and fitting.
function fitOffset(bounds, offset) {
  return {
    x: clamp(Number.isFinite(offset?.x) ? offset.x : 0, (-1 - bounds.minX) / 2, (1 - bounds.maxX) / 2),
    y: clamp(Number.isFinite(offset?.y) ? offset.y : 0, (-1 - bounds.minY) / 2, (1 - bounds.maxY) / 2),
  };
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
  const offset = fitOffset(boundsFromPoints(points), blob.offset);
  for (const p of points) { p.x += offset.x * 2; p.y += offset.y * 2; }
  return {
    points, closed: true, ...measured, bounds: boundsFromPoints(points),
    vertexIndices, vertexDistances: vertexIndices.map(i => measured.cumulativeLengths[i]),
    cornerTurns, cornerStrengths: cornerTurns.map(turn => params.cornerMode === 'even' ? Math.max(.35, Math.abs(turn)) : Math.abs(turn)),
    sides: Math.max(3, vertexIndices.length), vertexCount: vertexIndices.length, shapeType: 'polygon', starDepth: 0,
    curvature: params.curvature, aspect: params.aspect, skew: params.skew, asymmetry: 0, rotationDeg: 0, samplesPerEdge: 16,
    transform: { sx, sy, skew: params.skew, fit, offsetX: offset.x, offsetY: offset.y }, anchorIndices, locations: raw.locations,
  };
}
export function transformAnchor(point, path, degrees) {
  const { sx, sy, skew, fit, offsetX = 0, offsetY = 0 } = path.transform;
  const formedY = (point.y * 2 - 1) * sy / fit;
  const x = (point.x * 2 - 1) * sx / fit + skew * formedY + offsetX * 2, y = formedY + offsetY * 2;
  const a = degrees * Math.PI / 180;
  return { x: (x * Math.cos(a) - y * Math.sin(a) + 1) / 2, y: (x * Math.sin(a) + y * Math.cos(a) + 1) / 2 };
}
export function inverseAnchor(point, path, degrees) {
  const { sx, sy, skew, fit, offsetX = 0, offsetY = 0 } = path.transform, a = -degrees * Math.PI / 180;
  const u = point.x * 2 - 1, v = point.y * 2 - 1;
  const x = (u * Math.cos(a) - v * Math.sin(a) - offsetX * 2) * fit, y = (u * Math.sin(a) + v * Math.cos(a) - offsetY * 2) * fit;
  return { x: ((x - skew * y) / sx + 1) / 2, y: (y / sy + 1) / 2 };
}

/** Move from a gesture's starting source path without changing authored geometry. */
export function translateBlob(blob, path, delta) {
  const { offsetX = 0, offsetY = 0 } = path.transform;
  const bounds = {
    minX: path.bounds.minX - offsetX * 2, maxX: path.bounds.maxX - offsetX * 2,
    minY: path.bounds.minY - offsetY * 2, maxY: path.bounds.maxY - offsetY * 2,
  };
  const offset = fitOffset(bounds, {
    x: offsetX + (Number.isFinite(delta?.x) ? delta.x : 0),
    y: offsetY + (Number.isFinite(delta?.y) ? delta.y : 0),
  });
  return { ...blob, offset };
}

/** Nonzero winding on the same sampled closed contour that Canvas fills. */
export function containsPoint(path, unitPoint) {
  if (!path?.closed || path.points.length < 3 || !Number.isFinite(unitPoint?.x) || !Number.isFinite(unitPoint?.y)) return false;
  const x = unitPoint.x * 2 - 1, y = unitPoint.y * 2 - 1;
  let winding = 0;
  for (let i = 0; i < path.points.length; i++) {
    const a = path.points[i], b = path.points[(i + 1) % path.points.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(a.x, b.x) - 1e-10 && x <= Math.max(a.x, b.x) + 1e-10 && y >= Math.min(a.y, b.y) - 1e-10 && y <= Math.max(a.y, b.y) + 1e-10) return true;
    if (a.y <= y && b.y > y && cross > 0) winding++;
    else if (a.y > y && b.y <= y && cross < 0) winding--;
  }
  return winding !== 0;
}
