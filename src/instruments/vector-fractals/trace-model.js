// Slow readers follow the sampled contour itself. These tables are control
// signals, not bandlimited single-cycle oscillator waves.
export const TRACE_TABLE_SIZE = 2048;
export const READER_CONTACT_LIMIT = 3;
export const READER_SEGMENT_LIMIT = 2048;
export const READER_BEAD_LIMIT = 256;
const READER_CANDIDATE_LIMIT = 64;
export const TRACE_LAYERS = Object.freeze([
  Object.freeze({ id: 'broad', label: 'Broad', color: '#ffba76', rgba: [1, 186 / 255, 118 / 255, 1] }),
  Object.freeze({ id: 'curl', label: 'Curl', color: '#c69bff', rgba: [198 / 255, 155 / 255, 1, 1] }),
  Object.freeze({ id: 'fine', label: 'Fine', color: '#80d9ff', rgba: [128 / 255, 217 / 255, 1, 1] }),
]);
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const wrap = value => ((value % 1) + 1) % 1;

function pathsFrom(result, view, travelerDirection = null) {
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
      const previous = vertices.at(-1);
      if (!travelerDirection || !previous || previous.x !== x || previous.y !== y) vertices.push({ x, y });
    }
    if (!valid) continue;
    const isClosed = Boolean(closed[pathIndex]);
    if (travelerDirection && isClosed && vertices.length > 1
      && vertices[0].x === vertices.at(-1).x && vertices[0].y === vertices.at(-1).y) vertices.pop();
    if (vertices.length < 2) continue;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      area += a.x * b.y - a.y * b.x;
    }
    const first = vertices[0], last = vertices.at(-1);
    // Trace retains its counterclockwise direction. Traveler may reverse closed
    // paths; open crops have no clockwise direction and retain a stable endpoint.
    if (isClosed ? travelerDirection === 'clockwise' ? area > 0 : area < 0
      : first.x > last.x || (first.x === last.x && first.y > last.y)) vertices.reverse();
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

function canonicalAnchor(path, top = false) {
  if (!path) return { x: 0, y: 0 };
  if (!path.closed) return atDistance(path, path.total / 2);
  if (top) return path.vertices.reduce((best, vertex) => vertex.y > best.y || (vertex.y === best.y && vertex.x > best.x) ? vertex : best);
  return path.vertices.reduce((best, vertex) => vertex.x > best.x || (vertex.x === best.x && vertex.y > best.y) ? vertex : best);
}

function turningSignal(path, featureSize) {
  // Accumulate turns on the original source segments before making the bounded
  // control table. Resampling headings first can lose complete tiny curls.
  const { vertices, lengths, segmentCount, total, closed } = path;
  const headings = new Float64Array(segmentCount), integral = new Float64Array(segmentCount + 1);
  let firstX = 0, firstY = 0, previousX = 0, previousY = 0;
  for (let i = 0; i < segmentCount; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const length = lengths[i + 1] - lengths[i];
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    const x = (b.x - a.x) / segmentLength, y = (b.y - a.y) / segmentLength;
    if (i === 0) { firstX = x; firstY = y; }
    else headings[i] = headings[i - 1] + Math.atan2(previousX * y - previousY * x, previousX * x + previousY * y);
    integral[i + 1] = integral[i] + headings[i] * length;
    previousX = x; previousY = y;
  }
  // The actual winding is retained, including non-simple paths. Open paths
  // retrace their turns without inventing a 180-degree turn at either crop edge.
  const turnPerLap = closed ? headings[segmentCount - 1]
    + Math.atan2(previousX * firstY - previousY * firstX, previousX * firstX + previousY * firstY) : 0;
  const primitive = distance => {
    if (!closed && distance <= 0) return 0;
    if (!closed && distance >= total) return integral[segmentCount] + (distance - total) * headings[segmentCount - 1];
    const lap = closed ? Math.floor(distance / total) : 0;
    const position = distance - lap * total;
    let low = 0, high = segmentCount - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (lengths[middle + 1] < position) low = middle + 1;
      else high = middle;
    }
    const partial = integral[low] + (position - lengths[low]) * headings[low];
    // A winding-aware extension makes smoothing and interpolation continuous at
    // the seam. Averaging wrapped atan2 values would erase a full revolution.
    return partial + lap * integral[segmentCount]
      + turnPerLap * (total * lap * (lap - 1) / 2 + lap * position);
  };
  const radius = Math.min(featureSize * total / 2, total / 8);
  return { turnPerLap, at: distance => (primitive(distance + radius) - primitive(distance - radius)) / (2 * radius) };
}

function featuresAt(path, distance, featureSize) {
  // Neighbours are specified in geometric arc length, never a number of source
  // vertices. Subdividing the exact same polyline therefore cannot add strikes.
  const radius = Math.min(featureSize * path.total / 2, path.total / 8);
  const point = atDistance(path, distance), before = atDistance(path, distance - radius), after = atDistance(path, distance + radius);
  const ax = point.x - before.x, ay = point.y - before.y, bx = after.x - point.x, by = after.y - point.y;
  let bend = 0;
  if (Math.hypot(ax, ay) > 1e-12 && Math.hypot(bx, by) > 1e-12) bend = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) / Math.PI;
  // Fold measures indentation against a broader chord. It is intentionally a
  // different geometric signal from the fine neighbourhood's turning angle.
  const broadRadius = Math.min(radius * 4, path.total / 4);
  const left = atDistance(path, distance - broadRadius), right = atDistance(path, distance + broadRadius);
  const dx = right.x - left.x, dy = right.y - left.y;
  const fraction = clamp(((point.x - left.x) * dx + (point.y - left.y) * dy) / Math.max(1e-30, dx * dx + dy * dy), 0, 1);
  const span = path.closed ? 2 * broadRadius : Math.min(path.total, distance + broadRadius) - Math.max(0, distance - broadRadius);
  const fold = clamp(Math.hypot(point.x - left.x - fraction * dx, point.y - left.y - fraction * dy) / Math.max(1e-12, span / 2), 0, 1);
  return { ...point, bend, fold };
}

function traceLayer(path, result, anchor, featureSize, traveler = false) {
  if (!path) return { x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0), fold: new Float32Array(0),
    ...(traveler ? { turn: new Float32Array(0), turnPerLap: 0 } : {}), pathIndex: -1, closed: false, depth: result?.depth ?? 0 };
  const x = new Float32Array(TRACE_TABLE_SIZE), y = new Float32Array(TRACE_TABLE_SIZE), bend = new Float32Array(TRACE_TABLE_SIZE), fold = new Float32Array(TRACE_TABLE_SIZE);
  const seam = path.closed ? nearest(path, anchor).distance : 0;
  const turn = traveler ? new Float32Array(TRACE_TABLE_SIZE) : null, initialTurn = path.turning?.at(seam) ?? 0;
  for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
    const phase = i / TRACE_TABLE_SIZE;
    const distance = seam + path.total * (path.closed ? phase : .5 - .5 * Math.cos(TAU * phase));
    const point = featuresAt(path, distance, featureSize);
    x[i] = point.x; y[i] = point.y; bend[i] = point.bend; fold[i] = point.fold;
    if (turn) turn[i] = path.turning.at(distance) - initialTurn;
  }
  return { x, y, bend, fold, ...(turn ? { turn, turnPerLap: path.turning.turnPerLap } : {}), pathIndex: path.pathIndex, closed: path.closed, depth: result.depth };
}

/**
 * Build Broad / Curl / Fine readers in one view-relative coordinate system.
 * `anchor`, when provided, is an absolute complex-plane point (Y upwards).
 * Missing levels stay empty; we never duplicate a finer contour to fill them.
 */
export function createTraceBank(results, { finePath = -1, anchor = null, featureSize = .015, contourReader = 'trace', travelerDirection = 'clockwise', travelerDetrend = false, drumPlacement = 'distance', drumTurnStep = 30, drumTurnColor = true, drumSpacing = .04, radarX = 0, radarY = 0, scanAngle = 0 } = {}) {
  const sources = Array.isArray(results) ? results.slice(0, 3) : [null, null, results];
  while (sources.length < 3) sources.push(null);
  const sourceView = sources[2]?.view || sources.find(result => result?.view)?.view;
  const view = {
    x: finite(sourceView?.x, 0), y: finite(sourceView?.y, 0),
    width: Math.max(1e-10, finite(sourceView?.width, 3.4)), aspect: Math.max(.01, finite(sourceView?.aspect, 1)),
  };
  const reader = ['traveler', 'radar', 'scan'].includes(contourReader) ? contourReader : 'trace';
  const traveler = reader === 'traveler', direction = travelerDirection === 'counterclockwise' ? 'counterclockwise' : 'clockwise';
  const paths = sources.map(result => pathsFrom(result, view, traveler ? direction : null));
  const fine = paths[2].find(path => path.pathIndex === finePath) || longest(paths[2]);
  const reference = fine || longest(paths[1]) || longest(paths[0]);
  const explicitAnchor = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y);
  const target = explicitAnchor
    ? { x: (anchor.x - view.x) / view.width, y: (anchor.y - view.y) / view.width } : canonicalAnchor(reference, traveler);
  const selected = paths.map((candidates, index) => index === 2 ? fine : candidates.reduce((best, candidate) => {
    const proximity = nearest(candidate, target).distanceSquared;
    return !best || proximity < best.proximity ? { path: candidate, proximity } : best;
  }, null)?.path);
  const size = clamp(finite(featureSize, .015), .00005, 1);
  const angle = clamp(finite(scanAngle, 0), -180, 180), radians = angle * Math.PI / 180;
  const extent = (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) / view.aspect) / 2;
  const bank = {
    view, reader, ...(traveler ? { travelerDirection: direction } : {}), radarX: clamp(finite(radarX, 0), -.5, .5), radarY: clamp(finite(radarY, 0), -.5, .5),
    scanAngle: angle, scanMin: -extent, scanMax: extent, layers: [],
  };
  bank.layers = sources.map((result, index) => {
    const path = selected[index], layerAnchor = traveler && !explicitAnchor ? canonicalAnchor(path, true) : target;
    if (traveler && path) {
      path.turning = turningSignal(path, size);
      if (travelerDetrend && path.closed) {
        const original = path.turning;
        path.turning = { turnPerLap: 0, at: distance => original.at(distance) - distance / path.total * original.turnPerLap };
      }
    }
    const layer = traceLayer(path, result, layerAnchor, size, traveler);
    const followsPath = reader === 'trace' || traveler;
    const activePaths = followsPath ? path ? [path] : [] : boundedPaths(paths[index]);
    layer.readerSegmentCount = activePaths.reduce((sum, path) => sum + path.segmentCount, 0);
    layer.contacts = followsPath
      ? layer.x.length ? [{ x: layer.x, y: layer.y, bend: layer.bend, fold: layer.fold,
        ...(traveler ? { turn: layer.turn, turnPerLap: layer.turnPerLap } : {}), presence: new Float32Array(TRACE_TABLE_SIZE).fill(1) }] : []
      : projectedContacts(activePaths, bank, size);
    const percussion = drumPlacement === 'turn'
      ? turningPercussion(activePaths, bank, layerAnchor, size, clamp(finite(drumTurnStep, 30), 5, 180), drumTurnColor)
      : percussionFor(activePaths, bank, layerAnchor, size, clamp(finite(drumSpacing, .04), .006, .2));
    layer.beads = percussion.beads; layer.events = percussion.events;
    layer.beadSpacing = percussion.spacing;
    return layer;
  });
  return bank;
}

// Angular-distance beads are computed in the worker, then crossed by the audio
// clock. Subdividing a straight segment never manufactures extra drum attacks.
function turningPercussion(paths, bank, anchor, featureSize, degrees, color) {
  const curves = paths.map(path => path.original || path).map(path => {
    const signal = turningSignal(path, featureSize), seam = path.closed ? nearest(path, anchor).distance : 0;
    const positions = [], turns = [], distances = [0];
    const count = TRACE_TABLE_SIZE;
    for (let i = 0; i <= count; i++) {
      const distance = seam + path.total * i / count;
      positions.push(distance); turns.push(signal.at(distance));
      if (i) distances.push(distances[i - 1] + Math.abs(turns[i] - turns[i - 1]));
    }
    return { path, positions, turns, distances, total: distances[count] };
  });
  const total = curves.reduce((sum, curve) => sum + curve.total, 0);
  const step = Math.max(degrees * TAU / 360, total / (READER_BEAD_LIMIT - 1));
  const beads = [], events = [];
  for (const curve of curves) {
    let next = step, cursor = 1;
    while (next < curve.total - 1e-9 && beads.length < READER_BEAD_LIMIT) {
      while (cursor < curve.distances.length - 1 && curve.distances[cursor] < next) cursor++;
      const delta = curve.distances[cursor] - curve.distances[cursor - 1];
      const mix = delta > 1e-15 ? (next - curve.distances[cursor - 1]) / delta : 0;
      const fraction = (cursor - 1 + mix) / TRACE_TABLE_SIZE;
      const distance = curve.positions[cursor - 1] * (1 - mix) + curve.positions[cursor] * mix;
      const point = featuresAt(curve.path, distance, featureSize);
      const sign = Math.sign(curve.turns[cursor] - curve.turns[cursor - 1]);
      const phases = eventPhases(point, bank, curve.path.closed, fraction), id = beads.length;
      beads.push({ id, ...point, pathIndex: curve.path.pathIndex, phases });
      for (const phase of phases) events.push({ phase, bead: id, ...point,
        ...(color ? { turnSign: sign * (!curve.path.closed && ['trace', 'traveler'].includes(bank.reader) && phase > .5 ? -1 : 1) } : {}) });
      next += step;
    }
  }
  events.sort((a, b) => a.phase - b.phase || a.bead - b.bead);
  return { beads, events, spacing: step * 360 / TAU };
}

/** Positions wrap; Traveler's accumulated turn preserves its winding per lap. */
export function sampleTraceLayer(layer, phase = 0) {
  const count = Math.min(layer?.x?.length ?? 0, layer?.y?.length ?? 0, layer?.bend?.length ?? 0);
  if (!count) return null;
  const travel = finite(phase, 0), position = wrap(travel) * count, index = Math.floor(position), next = (index + 1) % count, mix = position - index;
  const turnPerLap = finite(layer.turnPerLap, 0);
  const turn = layer.turn?.length === count ? layer.turn[index]
    + (layer.turn[next] + (next === 0 ? turnPerLap : 0) - layer.turn[index]) * mix
    + Math.floor(travel) * turnPerLap : 0;
  return {
    x: layer.x[index] + (layer.x[next] - layer.x[index]) * mix,
    y: layer.y[index] + (layer.y[next] - layer.y[index]) * mix,
    bend: layer.bend[index] + (layer.bend[next] - layer.bend[index]) * mix,
    fold: layer.fold?.length === count ? layer.fold[index] + (layer.fold[next] - layer.fold[index]) * mix : 0,
    turn,
  };
}

// Keep original segments whenever they fit. For unusually dense results the
// intersection model uses bounded arc resampling; bead placement still uses the
// original path. The longest 128 paths share one per-layer segment budget.
function boundedPaths(paths) {
  const candidates = [...paths].sort((a, b) => b.total - a.total || a.pathIndex - b.pathIndex).slice(0, 128);
  const count = candidates.reduce((sum, path) => sum + path.segmentCount, 0);
  if (count <= READER_SEGMENT_LIMIT) return candidates;
  const minimum = candidates.reduce((sum, path) => sum + (path.closed ? 3 : 1), 0);
  const total = candidates.reduce((sum, path) => sum + path.total, 0);
  let remaining = READER_SEGMENT_LIMIT - minimum;
  return candidates.map(path => {
    const base = path.closed ? 3 : 1;
    const extra = Math.min(remaining, Math.floor((READER_SEGMENT_LIMIT - minimum) * path.total / total));
    remaining -= extra;
    const segmentCount = base + extra, vertices = [], lengths = new Float64Array(segmentCount + 1);
    for (let i = 0; i <= segmentCount; i++) {
      lengths[i] = path.total * i / segmentCount;
      if (i < segmentCount || !path.closed) vertices.push(atDistance(path, lengths[i]));
    }
    return { ...path, original: path, vertices, lengths, segmentCount };
  });
}

function percussionFor(paths, bank, anchor, featureSize, requestedSpacing) {
  const originals = paths.map(path => path.original || path);
  const countsFor = spacing => originals.map(path => path.closed ? Math.max(1, Math.round(path.total / spacing)) : Math.max(2, Math.round(path.total / spacing) + 1));
  let spacing = requestedSpacing, counts = countsFor(spacing);
  // Raising a common spacing, rather than slicing the event list, leaves each
  // retained contour evenly beaded when the percussion budget is reached.
  while (counts.reduce((sum, count) => sum + count, 0) > READER_BEAD_LIMIT) {
    spacing *= 1.1; counts = countsFor(spacing);
  }
  const beads = [], events = [];
  originals.forEach((path, pathIndex) => {
    const count = counts[pathIndex], seam = path.closed ? nearest(path, anchor).distance : 0;
    const initialTurn = path.turning?.at(seam) ?? 0;
    for (let i = 0; i < count; i++) {
      const distance = seam + path.total * i / (path.closed ? count : count - 1);
      const point = featuresAt(path, distance, featureSize);
      if (path.turning) point.turn = path.turning.at(distance) - initialTurn;
      const phases = eventPhases(point, bank, path.closed, i / (path.closed ? count : count - 1));
      const id = beads.length, bead = { id, ...point, pathIndex: path.pathIndex, phases };
      beads.push(bead);
      for (const phase of phases) events.push({ phase, bead: id, ...point });
    }
  });
  events.sort((a, b) => a.phase - b.phase || a.bead - b.bead);
  return { beads, events, spacing };
}

function eventPhases(point, bank, closed, arcFraction) {
  if (bank.reader === 'radar') {
    const dx = point.x - bank.radarX, dy = point.y - bank.radarY;
    if (Math.hypot(dx, dy) < 1e-9) return [];
    const phase = wrap((Math.atan2(dy, dx) + Math.PI / 2) / TAU);
    return [phase > 1 - 1e-10 ? 0 : phase];
  }
  let forward;
  if (bank.reader === 'scan') {
    const angle = bank.scanAngle * Math.PI / 180;
    const position = (point.x * Math.cos(angle) + point.y * Math.sin(angle) - bank.scanMin) / (bank.scanMax - bank.scanMin);
    if (position < -1e-7 || position > 1 + 1e-7) return [];
    forward = clamp(position, 0, 1) / 2;
  } else {
    if (closed) return [arcFraction];
    forward = Math.acos(clamp(1 - 2 * arcFraction, -1, 1)) / TAU;
  }
  if (forward < 1e-10) return [0];
  if (Math.abs(forward - .5) < 1e-10) return [.5];
  return [forward, 1 - forward];
}

/** Guide geometry in bank.view-relative width units; Y points upwards. */
export function readerGuide(bank, phase = 0) {
  if (!bank || bank.reader === 'trace' || bank.reader === 'traveler') return null;
  const position = wrap(finite(phase, 0));
  const reach = Math.hypot(1, 1 / bank.view.aspect) + 1;
  if (bank.reader === 'radar') {
    const angle = TAU * position - Math.PI / 2;
    const x = bank.radarX, y = bank.radarY, dx = Math.cos(angle), dy = Math.sin(angle);
    return { type: 'radar', reader: 'radar', x, y, dx, dy, angle, center: { x, y }, x1: x, y1: y, x2: x + dx * reach, y2: y + dy * reach };
  }
  const angle = bank.scanAngle * Math.PI / 180, nx = Math.cos(angle), ny = Math.sin(angle);
  const coordinate = bank.scanMin + (bank.scanMax - bank.scanMin) * (1 - Math.abs(2 * position - 1));
  const x = nx * coordinate, y = ny * coordinate, dx = -ny, dy = nx;
  return { type: 'scan', reader: 'scan', nx, ny, coordinate, x, y, dx, dy, x1: x - dx * reach, y1: y - dy * reach, x2: x + dx * reach, y2: y + dy * reach };
}

function intersections(paths, guide) {
  const result = [];
  for (const path of paths) {
    for (let i = 0; i < path.segmentCount; i++) {
      const a = path.vertices[i], b = path.vertices[(i + 1) % path.vertices.length];
      const sx = b.x - a.x, sy = b.y - a.y;
      let fraction, order;
      if (guide.reader === 'radar') {
        const denominator = guide.dx * sy - guide.dy * sx;
        if (Math.abs(denominator) < 1e-12) continue;
        const ax = a.x - guide.x, ay = a.y - guide.y;
        fraction = (ax * guide.dy - ay * guide.dx) / denominator;
        order = (ax * sy - ay * sx) / denominator;
        if (order < 1e-9) continue;
      } else {
        const denominator = sx * guide.nx + sy * guide.ny;
        if (Math.abs(denominator) < 1e-12) continue;
        fraction = (guide.coordinate - a.x * guide.nx - a.y * guide.ny) / denominator;
        order = (a.x + fraction * sx) * guide.dx + (a.y + fraction * sy) * guide.dy;
      }
      if (fraction < -1e-9 || fraction > 1 + 1e-9) continue;
      fraction = clamp(fraction, 0, 1);
      const distance = path.lengths[i] + fraction * (path.lengths[i + 1] - path.lengths[i]);
      result.push({ x: a.x + fraction * sx, y: a.y + fraction * sy, path, distance, order });
    }
  }
  result.sort((a, b) => a.order - b.order || a.path.pathIndex - b.path.pathIndex || a.distance - b.distance);
  const unique = [];
  for (const point of result) {
    const previous = unique.at(-1);
    if (previous?.path === point.path && Math.hypot(previous.x - point.x, previous.y - point.y) < 1e-8) continue;
    unique.push(point);
    if (unique.length >= READER_CANDIDATE_LIMIT) break;
  }
  return unique;
}

function arcSeparation(a, b) {
  if (a.path !== b.path) return Infinity;
  const delta = Math.abs(a.distance - b.distance) / a.path.total;
  return a.path.closed ? Math.min(delta, 1 - delta) : delta;
}

function continuousContact(a, b) {
  return a && b && arcSeparation(a, b) < .12 && Math.hypot(a.x - b.x, a.y - b.y) < .08;
}

function projectedContacts(paths, bank, featureSize) {
  if (!paths.length) return [];
  const samples = Array.from({ length: TRACE_TABLE_SIZE }, (_, i) => intersections(paths, readerGuide(bank, i / TRACE_TABLE_SIZE)));
  const tracks = Array.from({ length: READER_CONTACT_LIMIT }, () => ({ point: null, missing: 0 }));
  const histories = Array.from({ length: READER_CONTACT_LIMIT }, () => new Array(TRACE_TABLE_SIZE).fill(null));
  // One warm-up lap gives a branch already crossing phase zero the same voice
  // identity it had before the seam. Existing branches win before new contacts.
  for (let step = 0; step < TRACE_TABLE_SIZE * 2; step++) {
    const index = step % TRACE_TABLE_SIZE, candidates = samples[index], used = new Set(), assignments = new Array(READER_CONTACT_LIMIT).fill(null);
    const matches = [];
    tracks.forEach((track, slot) => {
      if (!track.point) return;
      candidates.forEach((point, candidate) => {
        const arc = arcSeparation(track.point, point);
        if (continuousContact(track.point, point)) matches.push({ slot, candidate, cost: arc + .05 * Math.hypot(point.x - track.point.x, point.y - track.point.y) });
      });
    });
    matches.sort((a, b) => a.cost - b.cost || a.slot - b.slot || a.candidate - b.candidate);
    for (const match of matches) {
      if (assignments[match.slot] || used.has(match.candidate)) continue;
      assignments[match.slot] = candidates[match.candidate]; used.add(match.candidate);
    }
    tracks.forEach((track, slot) => {
      if (!assignments[slot] && (!track.point || track.missing >= 8)) {
        const candidate = candidates.findIndex((_, i) => !used.has(i));
        if (candidate >= 0) { assignments[slot] = candidates[candidate]; used.add(candidate); }
      }
      const point = assignments[slot];
      if (point) { track.point = point; track.missing = 0; }
      else track.missing++;
      if (step >= TRACE_TABLE_SIZE) histories[slot][index] = point;
    });
  }
  return histories.map((history, slot) => {
    const table = { slot, x: new Float32Array(TRACE_TABLE_SIZE), y: new Float32Array(TRACE_TABLE_SIZE), bend: new Float32Array(TRACE_TABLE_SIZE), fold: new Float32Array(TRACE_TABLE_SIZE), presence: new Float32Array(TRACE_TABLE_SIZE) };
    let last = history.findLast(Boolean);
    if (!last) return null;
    for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
      const point = history[i];
      if (point) last = point;
      const features = featuresAt(last.path.original || last.path, last.distance, featureSize);
      table.x[i] = last.x; table.y[i] = last.y; table.bend[i] = features.bend; table.fold[i] = features.fold;
      table.presence[i] = point ? 1 : 0;
    }
    // Symmetric precomputed fades at births/deaths and unmatched branch jumps
    // avoid either a sounding teleport or a hard gate, including at phase zero.
    for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
      const previous = history[(i + TRACE_TABLE_SIZE - 1) % TRACE_TABLE_SIZE], current = history[i];
      if (continuousContact(previous, current) || (!previous && !current)) continue;
      for (let offset = -8; offset <= 8; offset++) {
        const at = (i + offset + TRACE_TABLE_SIZE) % TRACE_TABLE_SIZE;
        table.presence[at] = Math.min(table.presence[at], Math.max(0, (Math.abs(offset + .5) - .5) / 8));
      }
    }
    return table;
  }).filter(Boolean);
}

/** Sample every sounding contact without inventing intersections between slots. */
export function sampleReaderLayer(layer, phase = 0) {
  const contacts = layer?.contacts;
  if (!Array.isArray(contacts)) {
    const legacy = sampleTraceLayer(layer, phase);
    return legacy ? [{ ...legacy, slot: 0, presence: 1 }] : [];
  }
  const samples = [];
  contacts.forEach((contact, slot) => {
    const sample = sampleTraceLayer(contact, phase), count = contact.presence?.length ?? 0;
    if (!sample || !count) return;
    const position = wrap(finite(phase, 0)) * count, index = Math.floor(position), mix = position - index;
    const presence = contact.presence[index] * (1 - mix) + contact.presence[(index + 1) % count] * mix;
    if (presence > 1e-5) samples.push({ ...sample, slot: contact.slot ?? slot, presence });
  });
  return samples;
}
