export const TAU = Math.PI * 2;

export const DEFAULT_JULIA_BOUNDS = Object.freeze({
  minX: -2,
  maxX: 2,
  minY: -2,
  maxY: 2,
});

const DEFAULT_MAX_ITERATIONS = 96;
const DEFAULT_RESOLUTION = 224;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pointKey(point) {
  return `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;
}

function distanceBetween(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Return the first escape iteration for z -> z² + c, or the iteration cap. */
export function escapeTimeJulia(
  x,
  y,
  cReal = -0.7,
  cImag = 0.27015,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  escapeRadius = 2,
) {
  let zx = finite(x, 0);
  let zy = finite(y, 0);
  const cr = finite(cReal, -0.7);
  const ci = finite(cImag, 0.27015);
  const limit = clamp(Math.trunc(finite(maxIterations, DEFAULT_MAX_ITERATIONS)), 1, 4096);
  const radius = clamp(finite(escapeRadius, 2), 1.01, 1e6);
  const radiusSquared = radius * radius;

  for (let iteration = 0; iteration < limit; iteration += 1) {
    const zxSquared = zx * zx;
    const zySquared = zy * zy;
    if (zxSquared + zySquared > radiusSquared) return iteration;
    zy = 2 * zx * zy + ci;
    zx = zxSquared - zySquared + cr;
  }
  return limit;
}

/** Sample a square, top-down escape-time field suitable for Canvas pixels. */
export function generateJuliaField({
  cReal = -0.7,
  cImag = 0.27015,
  resolution = DEFAULT_RESOLUTION,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  escapeRadius = 2,
  bounds = DEFAULT_JULIA_BOUNDS,
} = {}) {
  const size = clamp(Math.trunc(finite(resolution, DEFAULT_RESOLUTION)), 8, 1024);
  const limit = clamp(Math.trunc(finite(maxIterations, DEFAULT_MAX_ITERATIONS)), 1, 4096);
  const safeBounds = {
    minX: finite(bounds?.minX, DEFAULT_JULIA_BOUNDS.minX),
    maxX: finite(bounds?.maxX, DEFAULT_JULIA_BOUNDS.maxX),
    minY: finite(bounds?.minY, DEFAULT_JULIA_BOUNDS.minY),
    maxY: finite(bounds?.maxY, DEFAULT_JULIA_BOUNDS.maxY),
  };
  if (safeBounds.minX === safeBounds.maxX) safeBounds.maxX += 1;
  if (safeBounds.minY === safeBounds.maxY) safeBounds.maxY += 1;
  if (safeBounds.minX > safeBounds.maxX) {
    [safeBounds.minX, safeBounds.maxX] = [safeBounds.maxX, safeBounds.minX];
  }
  if (safeBounds.minY > safeBounds.maxY) {
    [safeBounds.minY, safeBounds.maxY] = [safeBounds.maxY, safeBounds.minY];
  }

  const values = Array.from({ length: size }, () => new Uint16Array(size));
  let insideCount = 0;
  for (let row = 0; row < size; row += 1) {
    const y = safeBounds.maxY
      - (row / (size - 1)) * (safeBounds.maxY - safeBounds.minY);
    for (let column = 0; column < size; column += 1) {
      const x = safeBounds.minX
        + (column / (size - 1)) * (safeBounds.maxX - safeBounds.minX);
      const iterations = escapeTimeJulia(
        x,
        y,
        cReal,
        cImag,
        limit,
        escapeRadius,
      );
      values[row][column] = iterations;
      if (iterations === limit) insideCount += 1;
    }
  }

  return {
    values,
    width: size,
    height: size,
    maxIterations: limit,
    escapeRadius: clamp(finite(escapeRadius, 2), 1.01, 1e6),
    cReal: finite(cReal, -0.7),
    cImag: finite(cImag, 0.27015),
    bounds: safeBounds,
    insideCount,
  };
}

function segmentPairsForCase(type, centerInside) {
  const T = 0;
  const R = 1;
  const B = 2;
  const L = 3;
  switch (type) {
    case 1: return [[L, B]];
    case 2: return [[B, R]];
    case 3: return [[L, R]];
    case 4: return [[T, R]];
    case 5: return centerInside ? [[T, L], [B, R]] : [[T, R], [B, L]];
    case 6: return [[T, B]];
    case 7: return [[T, L]];
    case 8: return [[T, L]];
    case 9: return [[T, B]];
    case 10: return centerInside ? [[T, R], [B, L]] : [[T, L], [B, R]];
    case 11: return [[T, R]];
    case 12: return [[L, R]];
    case 13: return [[B, R]];
    case 14: return [[L, B]];
    default: return [];
  }
}

function contourLength(points, closed = true) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let length = 0;
  const end = closed ? points.length : points.length - 1;
  for (let index = 0; index < end; index += 1) {
    length += distanceBetween(points[index], points[(index + 1) % points.length]);
  }
  return length;
}

/**
 * Extract every stitched marching-squares contour from an escape-time field.
 * Ambiguous checkerboards are resolved by sampling the actual Julia function
 * at the cell center instead of guessing from entry direction.
 */
export function extractMarchingSquaresContours(field) {
  const values = field?.values;
  const height = Math.trunc(field?.height ?? values?.length ?? 0);
  const width = Math.trunc(field?.width ?? values?.[0]?.length ?? 0);
  const limit = Math.trunc(field?.maxIterations ?? 0);
  if (!values || width < 2 || height < 2 || limit < 1) return [];

  const segments = [];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const tl = values[y][x] === limit;
      const tr = values[y][x + 1] === limit;
      const br = values[y + 1][x + 1] === limit;
      const bl = values[y + 1][x] === limit;
      const type = (Number(tl) << 3) | (Number(tr) << 2) | (Number(br) << 1) | Number(bl);
      if (type === 0 || type === 15) continue;

      let centerInside = false;
      if (type === 5 || type === 10) {
        const centerX = field.bounds.minX
          + ((x + 0.5) / (width - 1)) * (field.bounds.maxX - field.bounds.minX);
        const centerY = field.bounds.maxY
          - ((y + 0.5) / (height - 1)) * (field.bounds.maxY - field.bounds.minY);
        centerInside = escapeTimeJulia(
          centerX,
          centerY,
          field.cReal,
          field.cImag,
          limit,
          field.escapeRadius,
        ) === limit;
      }

      const edges = [
        { x: x + 0.5, y },
        { x: x + 1, y: y + 0.5 },
        { x: x + 0.5, y: y + 1 },
        { x, y: y + 0.5 },
      ];
      for (const [from, to] of segmentPairsForCase(type, centerInside)) {
        segments.push({ a: edges[from], b: edges[to] });
      }
    }
  }

  const adjacency = new Map();
  const connect = (point, edgeIndex) => {
    const key = pointKey(point);
    const incident = adjacency.get(key) ?? [];
    incident.push(edgeIndex);
    adjacency.set(key, incident);
  };
  segments.forEach((segment, index) => {
    connect(segment.a, index);
    connect(segment.b, index);
  });

  const visited = new Uint8Array(segments.length);
  const contours = [];
  const openEndpointEdges = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if ((adjacency.get(pointKey(segment.a))?.length ?? 0) === 1
      || (adjacency.get(pointKey(segment.b))?.length ?? 0) === 1) {
      openEndpointEdges.push(index);
    }
  }
  const edgeOrder = [
    ...openEndpointEdges,
    ...Array.from({ length: segments.length }, (_value, index) => index),
  ];
  for (const startEdge of edgeOrder) {
    if (visited[startEdge]) continue;
    visited[startEdge] = 1;
    const first = segments[startEdge];
    const aDegree = adjacency.get(pointKey(first.a))?.length ?? 0;
    const bDegree = adjacency.get(pointKey(first.b))?.length ?? 0;
    const startPoint = bDegree === 1 && aDegree !== 1 ? first.b : first.a;
    const secondPoint = startPoint === first.a ? first.b : first.a;
    const startKey = pointKey(startPoint);
    let currentKey = pointKey(secondPoint);
    let currentPoint = secondPoint;
    const rawPoints = [startPoint, secondPoint];
    let closed = currentKey === startKey;

    for (let guard = 0; !closed && guard <= segments.length; guard += 1) {
      const nextEdge = (adjacency.get(currentKey) ?? []).find((index) => !visited[index]);
      if (nextEdge === undefined) break;
      visited[nextEdge] = 1;
      const segment = segments[nextEdge];
      const nextPoint = pointKey(segment.a) === currentKey ? segment.b : segment.a;
      currentPoint = nextPoint;
      currentKey = pointKey(currentPoint);
      if (currentKey === startKey) {
        closed = true;
      } else {
        rawPoints.push(currentPoint);
      }
    }

    if (rawPoints.length < 2) continue;
    const points = rawPoints.map((point) => ({
      x: point.x,
      y: height - 1 - point.y,
    }));
    contours.push({
      points,
      closed,
      length: contourLength(points, closed),
    });
  }
  return contours;
}

/** Choose the longest valid closed component, ignoring edge-clipped paths. */
export function selectLongestClosedContour(contours) {
  let selected = null;
  for (const contour of Array.isArray(contours) ? contours : []) {
    if (!contour?.closed || contour.points?.length < 3) continue;
    if (!selected || contour.length > selected.length) selected = contour;
  }
  return selected;
}

function squaredSegmentDistance(point, start, end) {
  let x = start.x;
  let y = start.y;
  let dx = end.x - x;
  let dy = end.y - y;
  if (dx !== 0 || dy !== 0) {
    const amount = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
    if (amount > 1) {
      x = end.x;
      y = end.y;
    } else if (amount > 0) {
      x += dx * amount;
      y += dy * amount;
    }
  }
  dx = point.x - x;
  dy = point.y - y;
  return dx * dx + dy * dy;
}

function simplifyOpen(points, squaredTolerance) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const marked = new Uint8Array(points.length);
  marked[0] = 1;
  marked[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let greatest = squaredTolerance;
    let split = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = squaredSegmentDistance(points[index], points[first], points[last]);
      if (distance > greatest) {
        greatest = distance;
        split = index;
      }
    }
    if (split < 0) continue;
    marked[split] = 1;
    stack.push([first, split], [split, last]);
  }
  return points.filter((_point, index) => marked[index]).map((point) => ({ ...point }));
}

/** Ramer-Douglas-Peucker reduction that treats the contour seam symmetrically. */
export function simplifyClosedContour(points, tolerance = 0) {
  const source = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({ x: point.x, y: point.y }));
  if (source.length > 1 && pointKey(source[0]) === pointKey(source.at(-1))) source.pop();
  if (source.length < 4 || !(tolerance > 0)) return source;

  let opposite = 1;
  let greatest = -1;
  for (let index = 1; index < source.length; index += 1) {
    const distance = (source[index].x - source[0].x) ** 2
      + (source[index].y - source[0].y) ** 2;
    if (distance > greatest) {
      greatest = distance;
      opposite = index;
    }
  }
  const squaredTolerance = tolerance * tolerance;
  const firstArc = simplifyOpen(source.slice(0, opposite + 1), squaredTolerance);
  const secondArc = simplifyOpen([...source.slice(opposite), source[0]], squaredTolerance);
  const reduced = [...firstArc.slice(0, -1), ...secondArc.slice(0, -1)];
  return reduced.length >= 3 ? reduced : source;
}

function signedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += point.x * next.y - next.x * point.y;
  }
  return twiceArea * 0.5;
}

/** Build constant-arclength and signed-turn metadata for a closed contour. */
export function buildBoundaryPath(points) {
  let clean = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({ x: point.x, y: point.y }));
  clean = clean.filter((point, index) => index === 0 || pointKey(point) !== pointKey(clean[index - 1]));
  if (clean.length > 1 && pointKey(clean[0]) === pointKey(clean.at(-1))) clean.pop();
  if (clean.length < 3) return null;
  if (signedArea(clean) < 0) clean.reverse();

  const turns = clean.map((point, index) => {
    const previous = clean[(index - 1 + clean.length) % clean.length];
    const next = clean[(index + 1) % clean.length];
    const incoming = { x: point.x - previous.x, y: point.y - previous.y };
    const outgoing = { x: next.x - point.x, y: next.y - point.y };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    return Math.atan2(cross, dot);
  });

  let totalLength = 0;
  let cumulativeTurn = 0;
  const segments = clean.map((start, index) => {
    const end = clean[(index + 1) % clean.length];
    const length = distanceBetween(start, end);
    const segment = {
      index,
      start,
      end,
      length,
      startDistance: totalLength,
      endDistance: totalLength + length,
      turn: turns[index],
      cumulativeTurn,
    };
    totalLength += length;
    cumulativeTurn += turns[index];
    return segment;
  }).filter((segment) => segment.length > 1e-9);
  if (segments.length < 3 || totalLength <= 1e-9) return null;

  return {
    points: clean,
    segments,
    turns,
    totalLength,
    totalTurn: turns.reduce((sum, turn) => sum + turn, 0),
    area: signedArea(clean),
  };
}

/** Sample a closed boundary at constant normalized arclength. */
export function sampleBoundary(path, phase) {
  if (!path?.segments?.length || !(path.totalLength > 0)) return null;
  const wrappedPhase = wrap01(finite(phase, 0));
  const distance = wrappedPhase * path.totalLength;
  let low = 0;
  let high = path.segments.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) * 0.5);
    if (distance < path.segments[middle].endDistance) high = middle;
    else low = middle + 1;
  }
  const segment = path.segments[low];
  const segmentProgress = clamp(
    (distance - segment.startDistance) / Math.max(1e-9, segment.length),
    0,
    1,
  );
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * segmentProgress,
    y: segment.start.y + (segment.end.y - segment.start.y) * segmentProgress,
    tangentX: (segment.end.x - segment.start.x) / segment.length,
    tangentY: (segment.end.y - segment.start.y) / segment.length,
    turn: segment.turn,
    cumulativeTurn: segment.cumulativeTurn,
    segmentIndex: segment.index,
    segmentProgress,
    phase: wrappedPhase,
    distance,
    segment,
  };
}

/**
 * Convert cumulative signed curvature to an unwrapped Shepard octave value.
 * One simple CCW circuit has +2π total turn and therefore rises by one octave
 * with the default mapping. Negative phases naturally reverse every turn.
 */
export function cumulativeTurnOctaves(path, continuousPhase, {
  octavesPerTurn = 1,
  polarity = 1,
  glide = 0.35,
} = {}) {
  if (!path) return { octavePosition: 0, octavePhase: 0, turnRadians: 0, sample: null };
  const phase = finite(continuousPhase, 0);
  const lap = Math.floor(phase);
  const sample = sampleBoundary(path, phase - lap);
  if (!sample) return { octavePosition: 0, octavePhase: 0, turnRadians: 0, sample: null };
  const glideFraction = clamp(finite(glide, 0.35), 0.0001, 1);
  const linear = clamp(sample.segmentProgress / glideFraction, 0, 1);
  const eased = linear * linear * (3 - 2 * linear);
  const turnRadians = lap * path.totalTurn
    + sample.cumulativeTurn
    + sample.turn * eased;
  const octavePosition = (polarity < 0 ? -1 : 1)
    * Math.max(0, finite(octavesPerTurn, 1))
    * turnRadians / TAU;
  return {
    octavePosition,
    octavePhase: wrap01(octavePosition),
    turnRadians,
    sample,
  };
}

/** Generate the field, all components, and the longest playable boundary. */
export function generateJuliaBoundary(options = {}) {
  const field = generateJuliaField(options);
  const contours = extractMarchingSquaresContours(field);
  const primaryContour = selectLongestClosedContour(contours);
  if (!primaryContour) {
    return { field, contours, primaryContour: null, boundary: null };
  }
  const simplifiedPoints = simplifyClosedContour(
    primaryContour.points,
    Math.max(0, finite(options.simplifyTolerance, 0)),
  );
  const boundary = buildBoundaryPath(simplifiedPoints)
    ?? buildBoundaryPath(primaryContour.points);
  return { field, contours, primaryContour, boundary };
}
