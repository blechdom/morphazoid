// Slow readers follow the sampled contour itself. These tables are control
// signals, not bandlimited single-cycle oscillator waves.
export const TRACE_TABLE_SIZE = 2048;
export const TRACE_LAYERS = Object.freeze([
  Object.freeze({ id: 'broad', label: 'Broad', color: '#ffba76', rgba: [1, 186 / 255, 118 / 255, 1] }),
  Object.freeze({ id: 'curl', label: 'Curl', color: '#c69bff', rgba: [198 / 255, 155 / 255, 1, 1] }),
  Object.freeze({ id: 'fine', label: 'Fine', color: '#80d9ff', rgba: [128 / 255, 217 / 255, 1, 1] }),
]);
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const wrap = value => ((value % 1) + 1) % 1;

function pathsFrom(result, view) {
  if (!result?.points || !result.offsets || !result.closed || !result.view) return [];
  const { points, offsets, closed } = result;
  const vertexCount = Math.floor(points.length / 2), paths = [];
  const ratio = result.view.width / view.width;
  const dx = (result.view.x - view.x) / view.width, dy = (result.view.y - view.y) / view.width;
  for (let pathIndex = 0; pathIndex < Math.min(closed.length, offsets.length - 1); pathIndex++) {
    const begin = Math.min(vertexCount, offsets[pathIndex]), end = Math.min(vertexCount, offsets[pathIndex + 1]);
    if (end - begin < 2) continue;
    const vertices = [];
    let valid = true, area = 0;
    for (let i = begin; i < end; i++) {
      const x = dx + points[2 * i] * ratio, y = dy + points[2 * i + 1] * ratio;
      if (!Number.isFinite(x) || !Number.isFinite(y)) { valid = false; break; }
      vertices.push({ x, y });
    }
    if (!valid) continue;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      area += a.x * b.y - a.y * b.x;
    }
    const isClosed = Boolean(closed[pathIndex]);
    const first = vertices[0], last = vertices.at(-1);
    // All closed contours run counterclockwise; open contours start at the
    // lexicographically smaller endpoint, regardless of marching-grid ordering.
    if (isClosed ? area < 0 : first.x > last.x || (first.x === last.x && first.y > last.y)) vertices.reverse();
    const segmentCount = vertices.length - (isClosed ? 0 : 1);
    const lengths = new Float64Array(segmentCount + 1);
    for (let i = 0; i < segmentCount; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      lengths[i + 1] = lengths[i] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    const total = lengths[segmentCount];
    if (total > 1e-12 && Number.isFinite(total)) paths.push({ vertices, lengths, total, segmentCount, pathIndex, closed: isClosed });
  }
  return paths;
}

function atDistance(path, distance) {
  const { vertices, lengths, segmentCount, total, closed } = path;
  const position = closed ? wrap(distance / total) * total : clamp(distance, 0, total);
  let low = 0, high = segmentCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lengths[middle + 1] < position) low = middle + 1;
    else high = middle;
  }
  const a = vertices[low], b = vertices[(low + 1) % vertices.length];
  const fraction = clamp((position - lengths[low]) / Math.max(1e-20, lengths[low + 1] - lengths[low]), 0, 1);
  return { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
}

function nearest(path, point) {
  let distanceSquared = Infinity, distance = 0;
  for (let i = 0; i < path.segmentCount; i++) {
    const a = path.vertices[i], b = path.vertices[(i + 1) % path.vertices.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const fraction = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(1e-30, dx * dx + dy * dy), 0, 1);
    const next = (point.x - a.x - fraction * dx) ** 2 + (point.y - a.y - fraction * dy) ** 2;
    if (next < distanceSquared) {
      distanceSquared = next;
      distance = path.lengths[i] + fraction * (path.lengths[i + 1] - path.lengths[i]);
    }
  }
  return { distanceSquared, distance };
}

function longest(paths) {
  return paths.reduce((best, path) => !best || path.total > best.total ? path : best, null);
}

function canonicalAnchor(path) {
  if (!path) return { x: 0, y: 0 };
  if (!path.closed) return atDistance(path, path.total / 2);
  return path.vertices.reduce((best, vertex) => vertex.x > best.x || (vertex.x === best.x && vertex.y > best.y) ? vertex : best);
}

function traceLayer(path, result, anchor, featureSize) {
  if (!path) return { x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0), pathIndex: -1, closed: false, depth: result?.depth ?? 0 };
  const x = new Float32Array(TRACE_TABLE_SIZE), y = new Float32Array(TRACE_TABLE_SIZE), bend = new Float32Array(TRACE_TABLE_SIZE);
  const seam = path.closed ? nearest(path, anchor).distance : 0;
  // Neighbours are specified in geometric arc length, never a number of source
  // vertices. Subdividing the exact same polyline therefore cannot add strikes.
  const radius = Math.min(featureSize / 2, path.total / 8);
  for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
    const phase = i / TRACE_TABLE_SIZE;
    const distance = seam + path.total * (path.closed ? phase : .5 - .5 * Math.cos(TAU * phase));
    const point = atDistance(path, distance), before = atDistance(path, distance - radius), after = atDistance(path, distance + radius);
    const ax = point.x - before.x, ay = point.y - before.y, bx = after.x - point.x, by = after.y - point.y;
    x[i] = point.x; y[i] = point.y;
    if (Math.hypot(ax, ay) > 1e-12 && Math.hypot(bx, by) > 1e-12) {
      bend[i] = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) / Math.PI;
    }
  }
  return { x, y, bend, pathIndex: path.pathIndex, closed: path.closed, depth: result.depth };
}

/**
 * Build Broad / Curl / Fine readers in one view-relative coordinate system.
 * `anchor`, when provided, is an absolute complex-plane point (Y upwards).
 * Missing levels stay empty; we never duplicate a finer contour to fill them.
 */
export function createTraceBank(results, { finePath = -1, anchor = null, featureSize = .015 } = {}) {
  const sources = Array.isArray(results) ? results.slice(0, 3) : [null, null, results];
  while (sources.length < 3) sources.push(null);
  const sourceView = sources[2]?.view || sources.find(result => result?.view)?.view;
  const view = {
    x: finite(sourceView?.x, 0), y: finite(sourceView?.y, 0),
    width: Math.max(1e-10, finite(sourceView?.width, 3.4)), aspect: Math.max(.01, finite(sourceView?.aspect, 1)),
  };
  const paths = sources.map(result => pathsFrom(result, view));
  const fine = paths[2].find(path => path.pathIndex === finePath) || longest(paths[2]);
  const reference = fine || longest(paths[1]) || longest(paths[0]);
  const target = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)
    ? { x: (anchor.x - view.x) / view.width, y: (anchor.y - view.y) / view.width } : canonicalAnchor(reference);
  const selected = paths.map((candidates, index) => index === 2 ? fine : candidates.reduce((best, candidate) => {
    const proximity = nearest(candidate, target).distanceSquared;
    return !best || proximity < best.proximity ? { path: candidate, proximity } : best;
  }, null)?.path);
  const size = clamp(finite(featureSize, .015), .00005, 1);
  return { view, layers: sources.map((result, index) => traceLayer(selected[index], result, target, size)) };
}

/** The renderer and audio reader use this same cyclic, linear interpolation. */
export function sampleTraceLayer(layer, phase = 0) {
  const count = Math.min(layer?.x?.length ?? 0, layer?.y?.length ?? 0, layer?.bend?.length ?? 0);
  if (!count) return null;
  const position = wrap(finite(phase, 0)) * count, index = Math.floor(position), next = (index + 1) % count, mix = position - index;
  return {
    x: layer.x[index] + (layer.x[next] - layer.x[index]) * mix,
    y: layer.y[index] + (layer.y[next] - layer.y[index]) * mix,
    bend: layer.bend[index] + (layer.bend[next] - layer.bend[index]) * mix,
  };
}
