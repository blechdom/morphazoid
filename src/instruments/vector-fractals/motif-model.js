/** Finite-scale contour fingerprints. No DOM, audio, or frame-clock dependencies.
 * Turning and Procrustes errors are geometric estimates, not probabilities of
 * fractal identity. Smoothing stability is not independent grid-refinement proof.
 */
export const MOTIF_SAMPLE_LIMIT = 512;
export const MOTIF_CAPTURE_LIMIT = 2048;
export const MOTIF_SEARCH_LIMIT = 384;
const TAU = 2 * Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;
const wrap = x => ((x % 1) + 1) % 1;
const countFor = (x, fallback, max) => clamp(Math.round(finite(x, fallback)), 32, max);
const lerp = (a, b, t) => a + (b - a) * t;

function polyline(points, closed = false) {
  if (!points || points.length < 4 || points.length > 524288) return null;
  const clean = [], inputIndices = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!clean.length || x !== clean.at(-2) || y !== clean.at(-1)) { clean.push(x, y); inputIndices.push(i / 2); }
  }
  const repeatedEndpoint = closed && clean.length > 4 && clean[0] === clean.at(-2) && clean[1] === clean.at(-1);
  if (repeatedEndpoint) { clean.splice(-2); inputIndices.pop(); }
  const count = clean.length / 2, segments = count - Number(!closed);
  if (count < 2) return null;
  const lengths = new Float64Array(segments + 1);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % count;
    lengths[i + 1] = lengths[i] + Math.hypot(clean[j * 2] - clean[i * 2], clean[j * 2 + 1] - clean[i * 2 + 1]);
  }
  const length = lengths[segments];
  return length > 0 && Number.isFinite(length) ? { points: Float64Array.from(clean), inputIndices, originalCount: points.length / 2, repeatedEndpoint, lengths, length, count, segments, closed } : null;
}

function locate(path, phase) {
  const distance = (path.closed ? wrap(phase) : clamp(phase, 0, 1)) * path.length;
  let low = 0, high = path.segments - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (path.lengths[mid + 1] < distance) low = mid + 1;
    else high = mid;
  }
  const t = clamp((distance - path.lengths[low]) / (path.lengths[low + 1] - path.lengths[low]), 0, 1);
  return { index: low, next: (low + 1) % path.count, t };
}

function pointAt(path, phase) {
  const { index, next, t } = locate(path, phase);
  return { x: lerp(path.points[index * 2], path.points[next * 2], t), y: lerp(path.points[index * 2 + 1], path.points[next * 2 + 1], t) };
}

function pathFromResult(result, pathIndex) {
  if (!result?.points || !result.offsets || !result.closed || !result.view || !Number.isInteger(pathIndex)) return null;
  if (pathIndex < 0 || pathIndex >= result.closed.length || pathIndex + 1 >= result.offsets.length) return null;
  const begin = result.offsets[pathIndex], end = result.offsets[pathIndex + 1];
  if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end > result.points.length / 2 || end - begin > 262144 || end - begin < 2) return null;
  const { x, y, width } = result.view;
  if (![x, y, width].every(Number.isFinite) || width <= 0) return null;
  const points = new Float64Array((end - begin) * 2);
  for (let i = begin; i < end; i++) {
    points[(i - begin) * 2] = x + result.points[i * 2] * width;
    points[(i - begin) * 2 + 1] = y + result.points[i * 2 + 1] * width;
  }
  return polyline(points, Boolean(result.closed[pathIndex]));
}

/** Nearest position on the original contour's arc-length clock. */
export function closestMotifCenter(result, pathIndex, worldPoint) {
  const path = pathFromResult(result, pathIndex);
  if (!path || !Number.isFinite(worldPoint?.x) || !Number.isFinite(worldPoint?.y)) return null;
  let best = Infinity, phase = 0;
  for (let i = 0; i < path.segments; i++) {
    const j = (i + 1) % path.count, x = path.points[i * 2], y = path.points[i * 2 + 1];
    const dx = path.points[j * 2] - x, dy = path.points[j * 2 + 1] - y;
    const t = clamp(((worldPoint.x - x) * dx + (worldPoint.y - y) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = (worldPoint.x - x - t * dx) ** 2 + (worldPoint.y - y - t * dy) ** 2;
    if (d < best) { best = d; phase = lerp(path.lengths[i], path.lengths[i + 1], t) / path.length; }
  }
  return phase;
}

/** Hit-test the actual displayed contour levels in world units, retaining the
 * source and its arc-length position so a broad curve cannot select a fine speck. */
export function pickMotifContour(results, worldPoint, radius) {
  if (!Number.isFinite(worldPoint?.x) || !Number.isFinite(worldPoint?.y) || !Number.isFinite(radius) || radius < 0) return null;
  let best = radius * radius, picked = null;
  for (let layerIndex = 0; layerIndex < Math.min(3, results?.length ?? 0); layerIndex++) {
    const result = results[layerIndex], view = result?.view;
    if (!result?.points || !result.offsets || !result.closed || !view || ![view.x, view.y, view.width].every(Number.isFinite) || view.width <= 0) continue;
    const x = (worldPoint.x - view.x) / view.width, y = (worldPoint.y - view.y) / view.width;
    for (let pathIndex = 0; pathIndex < result.closed.length; pathIndex++) {
      const begin = result.offsets[pathIndex], end = result.offsets[pathIndex + 1], count = end - begin;
      if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end > result.points.length / 2 || count < 2 || count > 262144) continue;
      const segments = count - Number(!result.closed[pathIndex]);
      let length = 0, distance = best, along = 0, valid = true, hit = false;
      for (let i = 0; i < segments; i++) {
        const a = (begin + i) * 2, b = (begin + (i + 1) % count) * 2;
        const ax = result.points[a], ay = result.points[a + 1];
        const dx = result.points[b] - ax, dy = result.points[b + 1] - ay;
        if (![ax, ay, dx, dy].every(Number.isFinite)) { valid = false; break; }
        const squared = dx * dx + dy * dy, segmentLength = Math.sqrt(squared);
        if (squared > 0) {
          const t = clamp(((x - ax) * dx + (y - ay) * dy) / squared, 0, 1);
          const residual = ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2) * view.width ** 2;
          if (residual <= distance) { distance = residual; along = length + t * segmentLength; hit = true; }
        }
        length += segmentLength;
      }
      if (valid && hit && length > 0) {
        best = distance;
        picked = { result, pathIndex, layerIndex, center: along / length };
      }
    }
  }
  return picked;
}

function capturePath(path, source, options) {
  const span = clamp(finite(options.span, .25), .02, 1);
  const center = path.closed ? wrap(finite(options.center, .5)) : clamp(finite(options.center, .5), span / 2, 1 - span / 2);
  const start = center - span / 2, samples = countFor(options.samples, 1024, MOTIF_CAPTURE_LIMIT);
  const points = new Float64Array(samples * 2), sourcePositions = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const phase = start + span * i / (samples - 1), p = pointAt(path, phase);
    points[i * 2] = p.x; points[i * 2 + 1] = p.y; sourcePositions[i] = phase;
  }
  return { points, sourcePositions, closed: path.closed && span === 1,
    source: { ...source, start, span, center, pathClosed: path.closed, pathLength: path.length } };
}

/** A detached, world-coordinate excerpt survives zoom, result replacement, and transfers. */
export function captureMotif(result, pathIndex, options = {}) {
  const path = pathFromResult(result, pathIndex);
  if (!path) return null;
  return capturePath(path, { view: { ...result.view }, domain: result.domain || 'mandelbrot', cReal: finite(result.cReal, 0),
    cImag: finite(result.cImag, 0), depth: result.depth, pathIndex }, options);
}

function scalarAt(values, phase) {
  const at = clamp(phase, 0, 1) * (values.length - 1), i = Math.floor(at);
  return lerp(values[i], values[Math.min(i + 1, values.length - 1)], at - i);
}
function packedAt(values, phase) {
  const at = clamp(phase, 0, 1) * (values.length / 2 - 1), i = Math.floor(at), j = Math.min(i + 1, values.length / 2 - 1), t = at - i;
  return { x: lerp(values[i * 2], values[j * 2], t), y: lerp(values[i * 2 + 1], values[j * 2 + 1], t) };
}

// Three box convolutions approximate a Gaussian. Open ends are extended along
// their endpoint tangent; closed curves wrap. Work is O(samples), even at coarse detail.
function smoothPoints(points, detail, closed) {
  const n = points.length / 2, unique = n - Number(closed), radius = Math.max(1, Math.round(detail * (n - 1)));
  let current = Float64Array.from(points);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(points.length);
    for (let axis = 0; axis < 2; axis++) {
      const prefix = new Float64Array(unique + radius * 2 + 1);
      for (let j = -radius; j < unique + radius; j++) {
        let value;
        if (closed) value = current[((j % unique + unique) % unique) * 2 + axis];
        else if (j < 0) value = current[axis] + j * (current[2 + axis] - current[axis]);
        else if (j >= unique) value = current[(unique - 1) * 2 + axis] + (j - unique + 1) * (current[(unique - 1) * 2 + axis] - current[(unique - 2) * 2 + axis]);
        else value = current[j * 2 + axis];
        prefix[j + radius + 1] = prefix[j + radius] + value;
      }
      for (let i = 0; i < unique; i++) next[i * 2 + axis] = (prefix[i + radius * 2 + 1] - prefix[i]) / (radius * 2 + 1);
      if (closed) next[(n - 1) * 2 + axis] = next[axis];
    }
    current = next;
  }
  return current;
}

function turning(points, closed) {
  const n = points.length / 2, unique = n - Number(closed), turn = new Float64Array(n);
  let previous = 0, orientation = 0;
  for (let i = 0; i < n; i++) {
    const before = closed ? (i - 1 + unique) % unique : Math.max(0, i - 1);
    const after = closed ? (i + 1) % unique : Math.min(n - 1, i + 1);
    const angle = Math.atan2(points[after * 2 + 1] - points[before * 2 + 1], points[after * 2] - points[before * 2]);
    if (!i) orientation = angle;
    else turn[i] = turn[i - 1] + Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
    previous = angle;
  }
  return { turn, orientation };
}

function normalizedPoints(points) {
  const n = points.length / 2, firstX = points[0], firstY = points[1];
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const weight = (i === 0 || i === n - 1 ? .5 : 1) / (n - 1);
    x += (points[i * 2] - firstX) * weight; y += (points[i * 2 + 1] - firstY) * weight;
  }
  const center = { x: firstX + x, y: firstY + y }, normalized = new Float64Array(points.length);
  let sum = 0;
  for (let i = 0; i < n; i++) { normalized[i * 2] = points[i * 2] - center.x; normalized[i * 2 + 1] = points[i * 2 + 1] - center.y; sum += (normalized[i * 2] ** 2 + normalized[i * 2 + 1] ** 2) * (i === 0 || i === n - 1 ? .5 : 1); }
  const scale = Math.sqrt(sum / (n - 1));
  if (!(scale > 0)) return null;
  for (let i = 0; i < normalized.length; i++) normalized[i] /= scale;
  return { normalized, center, scale };
}

/** Smooth positions first, then remeasure arc length. Uniform vertex counts alone
 * are insufficient: resolving small wiggles changes the traversal clock too. */
export function describeMotif(snapshot, options = {}) {
  const raw = polyline(snapshot?.points, Boolean(snapshot?.closed));
  if (!raw) return null;
  const samples = countFor(options.samples, 256, MOTIF_SAMPLE_LIMIT), detail = clamp(finite(options.detail, .012), .002, .15);
  const denseCount = clamp(Math.max(512, samples * 2), 512, MOTIF_CAPTURE_LIMIT);
  const dense = new Float64Array(denseCount * 2), rawPositions = new Float64Array(denseCount);
  for (let i = 0; i < denseCount; i++) {
    const phase = i / (denseCount - 1), p = pointAt(raw, phase);
    dense[i * 2] = p.x; dense[i * 2 + 1] = p.y;
    // Chords across corners can shorten a resampled excerpt. Propagate source
    // indices through the measured lengths rather than assuming those clocks
    // remained identical after capture.
    const position = locate(raw, phase), hasPositions = snapshot.sourcePositions?.length === raw.originalCount;
    if (hasPositions) {
      const first = snapshot.sourcePositions[raw.inputIndices[position.index]];
      const period = finite(snapshot.source?.span, snapshot.sourcePositions.at(-1) - snapshot.sourcePositions[0]);
      const next = snapshot.sourcePositions[raw.inputIndices[position.next]] + (raw.closed && position.next === 0 ? period : 0);
      rawPositions[i] = raw.closed && i === denseCount - 1 ? snapshot.sourcePositions[0] + period : lerp(first, next, position.t);
    } else rawPositions[i] = phase;
  }
  // Work near the origin so convolution does not lose tiny differences at zoom.
  const ox = dense[0], oy = dense[1];
  for (let i = 0; i < denseCount; i++) { dense[i * 2] -= ox; dense[i * 2 + 1] -= oy; }
  const levels = [Math.min(.15, detail * 4), Math.min(.15, detail * 2), detail].map(d => smoothPoints(dense, d, raw.closed));
  const finePath = polyline(levels[2], false);
  if (!finePath) return null;
  const sourceT = new Float64Array(samples), sourcePositions = new Float64Array(samples), sourcePoints = new Float64Array(samples * 2), points = new Float64Array(samples * 2);
  const turns = levels.map(level => turning(level, raw.closed));
  const turn = new Float64Array(samples), bands = Array.from({ length: 3 }, () => new Float64Array(samples));
  for (let i = 0; i < samples; i++) {
    const pos = locate(finePath, i / (samples - 1)), t = (pos.index + pos.t) / (denseCount - 1);
    const p = pointAt(finePath, i / (samples - 1)), original = pointAt(raw, t);
    sourceT[i] = t; sourcePositions[i] = scalarAt(rawPositions, t);
    points[i * 2] = p.x + ox; points[i * 2 + 1] = p.y + oy;
    sourcePoints[i * 2] = original.x; sourcePoints[i * 2 + 1] = original.y;
    const broad = scalarAt(turns[0].turn, t), medium = scalarAt(turns[1].turn, t), fine = scalarAt(turns[2].turn, t);
    bands[0][i] = broad; bands[1][i] = medium - broad; bands[2][i] = fine - medium; turn[i] = fine;
  }
  const normalized = normalizedPoints(points);
  if (!normalized) return null;
  return { ...normalized, points, sourcePoints, sourceT, sourcePositions, turn, bands, length: finePath.length, rawLength: raw.length,
    orientation: turns[2].orientation, totalTurn: raw.closed ? Math.round(turn.at(-1) / TAU) * TAU : turn.at(-1), closed: raw.closed, samples, detail, source: { ...snapshot.source }, snapshot,
    originalPhase: Float64Array.from({ length: samples }, (_, i) => i / (samples - 1)) };
}

function phaseForOriginal(descriptor, phase) {
  const values = descriptor.sourceT, target = clamp(phase, 0, 1);
  let low = 0, high = values.length - 2;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid + 1] < target) low = mid + 1; else high = mid; }
  return (low + clamp((target - values[low]) / Math.max(1e-15, values[low + 1] - values[low]), 0, 1)) / (values.length - 1);
}

export function sampleMotifDescriptor(descriptor, phase = 0, { timing = 'normalized' } = {}) {
  if (!descriptor?.turn?.length) return null;
  const u = timing === 'original' ? phaseForOriginal(descriptor, phase) : clamp(finite(phase, 0), 0, 1);
  const point = packedAt(descriptor.sourcePoints, u), smooth = packedAt(descriptor.points, u);
  return { ...point, smoothX: smooth.x, smoothY: smooth.y, phase: u, sourceT: scalarAt(descriptor.sourceT, u),
    sourcePosition: scalarAt(descriptor.sourcePositions, u), originalPhase: scalarAt(descriptor.originalPhase, u),
    turn: scalarAt(descriptor.turn, u), bands: descriptor.bands.map(band => scalarAt(band, u)) };
}

function transformed(descriptor, reversed, mirrored, shift = 0) {
  const n = descriptor.samples, period = n - 1;
  const packed = key => {
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const at = descriptor.closed ? ((i + shift) % period) : i;
      const j = reversed ? period - at : at;
      out[i * 2] = descriptor[key][j * 2]; out[i * 2 + 1] = descriptor[key][j * 2 + 1] * (key === 'normalized' && mirrored ? -1 : 1);
    }
    return out;
  };
  const series = (values, accumulate = false, renormalize = false) => {
    const out = new Float64Array(n), lap = values[period] - values[0];
    const at = index => {
      const k = descriptor.closed ? (index % period) : index, cycles = descriptor.closed ? Math.floor(index / period) : 0;
      return reversed ? values[period - k] - (accumulate ? cycles * lap : 0) : values[k] + (accumulate ? cycles * lap : 0);
    };
    const start = at(shift);
    for (let i = 0; i < n; i++) out[i] = at(i + shift) - (renormalize ? start : 0);
    return out;
  };
  const turn = series(descriptor.turn, true, true), bands = descriptor.bands.map(band => series(band, true, true));
  if (mirrored) for (const values of [turn, ...bands]) for (let i = 0; i < n; i++) values[i] *= -1;
  const sourceT = series(descriptor.sourceT, true, true);
  if (reversed) for (let i = 0; i < n; i++) sourceT[i] *= -1;
  const originalPhase = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i + shift) / period;
    originalPhase[i] = reversed ? 1 - (descriptor.closed ? wrap(u) : u) : descriptor.closed ? wrap(u) : u;
  }
  return { ...descriptor, points: packed('points'), sourcePoints: packed('sourcePoints'), normalized: packed('normalized'),
    sourceT, sourcePositions: series(descriptor.sourcePositions, true, false), originalPhase, turn, bands,
    orientation: descriptor.orientation + scalarAt(descriptor.turn, reversed ? 1 - shift / period : shift / period) + (reversed ? Math.PI : 0), totalTurn: descriptor.totalTurn * (reversed ? -1 : 1) * (mirrored ? -1 : 1), reversed, mirrored, shift: shift / period };
}

function fitRotation(a, b, map) {
  let dot = 0, cross = 0;
  for (let i = 0; i < a.samples; i++) {
    const p = packedAt(b.normalized, map ? map[i] : i / (a.samples - 1));
    const x = a.normalized[i * 2], y = a.normalized[i * 2 + 1];
    dot += p.x * x + p.y * y; cross += p.x * y - p.y * x;
  }
  return Math.atan2(cross, dot);
}
function errors(a, b, map, angle) {
  const n = a.samples, c = Math.cos(angle), s = Math.sin(angle), overlay = new Float64Array(n * 2);
  let geometry = 0, turningError = 0;
  for (let i = 0; i < n; i++) {
    const u = map ? map[i] : i / (n - 1), p = packedAt(b.normalized, u), x = c * p.x - s * p.y, y = s * p.x + c * p.y;
    overlay[i * 2] = x; overlay[i * 2 + 1] = y;
    geometry += (a.normalized[i * 2] - x) ** 2 + (a.normalized[i * 2 + 1] - y) ** 2;
    turningError += ((a.turn[i] - scalarAt(b.turn, u)) / TAU) ** 2;
  }
  const geometryError = Math.sqrt(geometry / n), turnError = Math.sqrt(turningError / n);
  return { geometryError, turnError, error: Math.hypot(geometryError, 2 * turnError), overlay };
}

// A narrow monotone DTW uses only (1,1), (1,2), (2,1) steps. It cannot stop one
// traveler while the other crosses an arbitrary run, or wander beyond tolerance.
function elasticMap(a, b, angle, tolerance) {
  const n = a.samples, band = Math.max(1, Math.floor(tolerance * (n - 1))), costs = new Float64Array(n * n).fill(Infinity), steps = new Uint8Array(n * n);
  const c = Math.cos(angle), s = Math.sin(angle);
  const cost = (i, j) => {
    const x = c * b.normalized[j * 2] - s * b.normalized[j * 2 + 1], y = s * b.normalized[j * 2] + c * b.normalized[j * 2 + 1];
    return (a.normalized[i * 2] - x) ** 2 + (a.normalized[i * 2 + 1] - y) ** 2 + 4 * ((a.turn[i] - b.turn[j]) / TAU) ** 2;
  };
  costs[0] = cost(0, 0);
  for (let i = 1; i < n; i++) for (let j = Math.max(1, i - band); j <= Math.min(n - 1, i + band); j++) {
    const value = cost(i, j), index = i * n + j;
    const choices = [costs[(i - 1) * n + j - 1] + value,
      j > 1 ? costs[(i - 1) * n + j - 2] + value + cost(i, j - 1) + .0004 : Infinity,
      i > 1 ? costs[(i - 2) * n + j - 1] + value + cost(i - 1, j) + .0004 : Infinity];
    const step = choices.indexOf(Math.min(...choices)); costs[index] = choices[step]; steps[index] = step + 1;
  }
  const pairs = [[n - 1, n - 1]];
  let i = n - 1, j = n - 1;
  while (i > 0 && j > 0) {
    const step = steps[i * n + j];
    if (!step) break;
    i -= step === 3 ? 2 : 1; j -= step === 2 ? 2 : 1; pairs.push([i, j]);
  }
  pairs.reverse();
  const map = new Float64Array(n);
  for (let p = 1; p < pairs.length; p++) {
    const [ia, ja] = pairs[p - 1], [ib, jb] = pairs[p];
    for (let k = ia; k <= ib; k++) map[k] = lerp(ja, jb, (k - ia) / (ib - ia)) / (n - 1);
  }
  return map;
}

function matchDescriptors(a, b, options) {
  let best = null;
  const period = a.samples - 1, step = Math.max(1, Math.floor(period / 24));
  for (const reversed of options.reverse ? [false, true] : [false]) for (const mirrored of options.mirror ? [false, true] : [false]) {
    const shifts = a.closed && b.closed ? Array.from({ length: Math.ceil(period / step) }, (_, i) => i * step) : [0];
    let local = null;
    const examine = shift => {
      const candidate = transformed(b, reversed, mirrored, (shift + period) % period), angle = fitRotation(a, candidate), metric = errors(a, candidate, null, angle);
      if (!local || metric.error < local.error) local = { ...metric, b: candidate, angle, shift: (shift + period) % period, reversed, mirrored };
    };
    shifts.forEach(examine);
    if (shifts.length > 1) { const seed = local.shift; for (let d = -step + 1; d < step; d++) examine(seed + d); }
    const tolerance = clamp(finite(options.elastic, 0), 0, .15);
    let correspondence = Float64Array.from({ length: a.samples }, (_, i) => i / period);
    if (tolerance > 0) {
      const map = elasticMap(a, local.b, local.angle, tolerance), angle = fitRotation(a, local.b, map), metric = errors(a, local.b, map, angle);
      if (metric.error < local.error) { local = { ...local, ...metric, angle }; correspondence = map; }
    }
    if (!best || local.error < best.error) best = { ...local, correspondence };
  }
  return best;
}

function descriptorFor(input, options) {
  if (input?.turn && input.samples === options.samples && input.detail === options.detail) return input;
  return describeMotif(input?.snapshot || input, options);
}

/** Repeat the descriptor measurement at different output sample counts using
 * the SAME captured polyline. This probes discretization of our fingerprint;
 * it cannot reveal features absent from the capture or certify the fractal grid.
 */
function resamplingStability(a, b, detail, samples) {
  const lowSamples = Math.max(32, Math.floor(samples / 2)), highSamples = Math.min(MOTIF_SAMPLE_LIMIT, samples * 2);
  const errorsByCurve = [a, b].map(descriptor => {
    const low = describeMotif(descriptor.snapshot, { detail, samples: lowSamples });
    const high = describeMotif(descriptor.snapshot, { detail, samples: highSamples });
    return errors(high, low, null, fitRotation(high, low));
  });
  const error = Math.max(...errorsByCurve.map(item => item.error));
  const value = Math.exp(-4 * error);
  return { value, error, geometryError: Math.max(...errorsByCurve.map(item => item.geometryError)),
    turnError: Math.max(...errorsByCurve.map(item => item.turnError)), lowSamples, highSamples,
    label: value > .92 ? 'stable under resampling' : value > .7 ? 'sampling-sensitive' : 'strongly sampling-sensitive',
    basis: 'same captured geometry; not independent grid refinement' };
}

/** Translation/uniform-scale/rotation invariant comparison. Scores are bounded
 * visual-audio ranking aids. Reflection and bounded timing changes are opt-in. */
export function compareMotifs(reference, candidate, options = {}) {
  const detail = clamp(finite(options.detail, reference?.detail ?? .012), .002, .15), samples = countFor(options.samples, reference?.samples ?? 256, MOTIF_SAMPLE_LIMIT);
  const a = descriptorFor(reference, { detail, samples }), rawB = descriptorFor(candidate, { detail, samples });
  if (!a || !rawB) return null;
  const match = matchDescriptors(a, rawB, options);
  const coarseA = describeMotif(a.snapshot, { detail: Math.min(.15, detail * 2), samples });
  const coarseB = describeMotif(rawB.snapshot, { detail: Math.min(.15, detail * 2), samples });
  const coarseCandidate = transformed(coarseB, match.reversed, match.mirrored, match.shift);
  const coarse = errors(coarseA, coarseCandidate, match.correspondence, fitRotation(coarseA, coarseCandidate, match.correspondence));
  const stability = clamp(1 - Math.abs(coarse.error - match.error) / .35, 0, 1);
  return { a, b: match.b, mirrored: match.mirrored, reversed: match.reversed, shift: match.b.shift,
    correspondence: match.correspondence, overlay: { a: a.normalized, b: match.overlay }, rotation: match.angle,
    geometryError: match.geometryError, turnError: match.turnError, error: match.error, similarity: Math.exp(-3 * match.error),
    samplingStability: options.samplingStability === false ? null : resamplingStability(a, rawB, detail, samples),
    stability: { value: stability, fineError: match.error, coarseError: coarse.error,
      label: stability > .85 ? 'stable across smoothing' : stability > .55 ? 'detail-sensitive' : 'strongly detail-sensitive' } };
}

function sameSource(a, b) {
  return a?.pathIndex === b?.pathIndex && a?.depth === b?.depth && a?.domain === b?.domain && a?.cReal === b?.cReal && a?.cImag === b?.cImag
    && ['x', 'y', 'width', 'aspect'].every(key => a?.view?.[key] === b?.view?.[key]);
}
function overlap(a, b, closed) {
  const distance = Math.abs(a.center - b.center), wrapped = closed ? Math.min(distance, 1 - distance) : distance;
  return wrapped < (a.span + b.span) * .42;
}

/** Bounded local search over several motif sizes and paths. It ranks approximate
 * candidates and deliberately excludes overlapping excerpts, including A itself.
 * Run in a worker: an upper bound on work is not a real-time audio guarantee. */
export function findMotifs(reference, result, options = {}) {
  const maxCandidates = clamp(Math.round(finite(options.maxCandidates, 192)), 1, MOTIF_SEARCH_LIMIT), limit = clamp(Math.round(finite(options.limit, 4)), 1, 8);
  const count = Math.min(result?.closed?.length || 0, (result?.offsets?.length || 1) - 1, 4096);
  const source = reference?.source || reference?.snapshot?.source;
  const indices = Array.isArray(options.pathIndices) ? options.pathIndices.slice(0, 4096) : Array.from({ length: count }, (_, i) => i);
  const paths = [];
  let vertexBudget = 262144;
  for (const pathIndex of new Set(indices)) {
    const vertices = (result?.offsets?.[pathIndex + 1] ?? 0) - (result?.offsets?.[pathIndex] ?? 0);
    if (!Number.isInteger(pathIndex) || vertices < 2 || vertices > vertexBudget) continue;
    vertexBudget -= vertices;
    const path = pathFromResult(result, pathIndex);
    if (path) { paths.push({ pathIndex, path }); paths.sort((a, b) => b.path.length - a.path.length); if (paths.length > 8) paths.pop(); }
  }
  const baseSpan = clamp(finite(source?.span, .25), .02, 1);
  const spans = [...new Set((options.spans || [baseSpan * .5, baseSpan, baseSpan * 2, baseSpan * .25]).map(span => clamp(finite(span, .25), .02, 1)))].slice(0, 8);
  const coarseBudget = Math.max(1, Math.floor(maxCandidates * .72));
  const perSize = Math.max(2, Math.ceil(coarseBudget / Math.max(1, paths.length * spans.length))), candidates = [];
  let examined = 0, visited = 0;
  const examine = (path, pathIndex, center, span) => {
    const candidateSource = { view: { ...result.view }, domain: result.domain || 'mandelbrot', cReal: finite(result.cReal, 0), cImag: finite(result.cImag, 0), depth: result.depth, pathIndex };
    if (sameSource(source, candidateSource) && overlap({ center: finite(source.center, wrap(source.start + source.span / 2)), span: source.span }, { center, span }, path.closed)) return;
    const snapshot = capturePath(path, candidateSource, { center, span, samples: 512 });
    const comparison = compareMotifs(reference, snapshot, { ...options, samplingStability: false, samples: countFor(options.samples, 96, MOTIF_SAMPLE_LIMIT) });
    examined++;
    if (comparison) candidates.push({ snapshot, comparison, pathIndex, center: snapshot.source.center, span: snapshot.source.span });
  };
  // Interleave sizes and paths so a budget cannot consume only the first path.
  search: for (let position = 0; position < perSize; position++) for (const span of spans) for (const { path, pathIndex } of paths) {
    if (examined >= coarseBudget) break search;
    const center = path.closed ? position / perSize : span / 2 + (1 - span) * position / (perSize - 1);
    visited++;
    examine(path, pathIndex, center, span);
  }
  candidates.sort((a, b) => a.comparison.error - b.comparison.error);
  // Refine local centers and sizes around promising, spatially distinct seeds.
  // This remains a candidate search, not an exhaustive minimum over the contour.
  const seeds = [];
  for (const candidate of candidates) {
    if (!seeds.some(seed => seed.pathIndex === candidate.pathIndex && overlap(seed, candidate, Boolean(result.closed[candidate.pathIndex])))) seeds.push(candidate);
    if (seeds.length >= 8) break;
  }
  refine: for (const [centerOffset, size] of [[-.5, 1], [.5, 1], [0, .85], [0, 1.15], [-.25, 1], [.25, 1]]) for (const seed of seeds) {
    if (examined >= maxCandidates) break refine;
    const { path } = paths.find(item => item.pathIndex === seed.pathIndex);
    const span = clamp(seed.span * size, .02, 1), position = seed.center + centerOffset / perSize;
    const center = path.closed ? wrap(position) : clamp(position, span / 2, 1 - span / 2);
    examine(path, seed.pathIndex, center, span);
  }
  candidates.sort((a, b) => a.comparison.error - b.comparison.error);
  const matches = [];
  for (const candidate of candidates) {
    if (!matches.some(match => match.pathIndex === candidate.pathIndex && overlap(match, candidate, Boolean(result.closed[candidate.pathIndex])))) matches.push(candidate);
    if (matches.length >= limit) break;
  }
  return { matches, examined, limited: examined >= maxCandidates || count > paths.length || visited < perSize * paths.length * spans.length };
}
