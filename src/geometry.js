/**
 * Pure geometry for the 2D shape instrument.
 *
 * Coordinates are centered at the origin and normalized to the unit disc.
 * Closed shapes put their true vertices on the unit circle. A two-sided shape
 * is deliberately an open, single-traversal line from (-1, 0) to (1, 0).
 *
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{
 *   minX: number,
 *   maxX: number,
 *   minY: number,
 *   maxY: number,
 *   width: number,
 *   height: number,
 *   center: Point,
 * }} Bounds
 * @typedef {{
 *   sides: number,
 *   curvature: number,
 *   rotationDeg?: number,
 *   samplesPerEdge?: number,
 * }} BuildShapeOptions
 * @typedef {{ pingPong?: boolean }} PointAtPathOptions
 * @typedef {{
 *   points: readonly Point[],
 *   closed: boolean,
 *   sides: number,
 *   curvature: number,
 *   rotationDeg: number,
 *   samplesPerEdge: number,
 *   bounds: Bounds,
 *   cumulativeLengths: readonly number[],
 *   totalLength: number,
 *   vertexIndices: readonly number[],
 *   vertexDistances: readonly number[],
 *   cornerStrengths: readonly number[],
 * }} ShapePath
 * @typedef {Point & {
 *   u: number,
 *   distance: number,
 *   segmentIndex: number,
 *   segmentT: number,
 *   tangent: Point,
 *   tangentAngle: number,
 *   cornerIndex: number,
 *   cornerStrength: number,
 *   cornerDistance: number,
 *   cornerDistance01: number,
 * }} PathContact
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-12;
const DEFAULT_SAMPLES_PER_EDGE = 32;
const MAX_SAMPLES_PER_EDGE = 256;
const OPEN_LINE_BEND = 0.75;
// Even at curvature -1, an edge retains 22% of its chord radius at midpoint.
const MAX_INWARD_FRACTION = 0.78;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function rotate(point, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPSILON) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function angleBetween(incoming, outgoing) {
  const a = normalize(incoming);
  const b = normalize(outgoing);
  if (
    (Math.abs(a.x) <= EPSILON && Math.abs(a.y) <= EPSILON) ||
    (Math.abs(b.x) <= EPSILON && Math.abs(b.y) <= EPSILON)
  ) {
    return 0;
  }
  return Math.acos(clamp(a.x * b.x + a.y * b.y, -1, 1));
}

/** @param {number} value */
export function wrap01(value) {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/** Map any real progress value onto 0 -> 1 -> 0 repeated motion. */
export function pingPong01(value) {
  if (!Number.isFinite(value)) return 0;
  const phase = ((value % 2) + 2) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** @param {readonly Point[]} points @returns {Bounds} */
export function boundsFromPoints(points) {
  if (points.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 0,
      height: 0,
      center: { x: 0, y: 0 },
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/** Normalize a point within bounds; degenerate axes map to their midpoint. */
export function pointInBounds01(point, bounds) {
  return {
    x: bounds.width <= EPSILON ? 0.5 : (point.x - bounds.minX) / bounds.width,
    y: bounds.height <= EPSILON ? 0.5 : (point.y - bounds.minY) / bounds.height,
  };
}

function polygonEdgeSample(edgeIndex, t, sides, curvature, rotationRad) {
  const sector = TAU / sides;
  const startAngle = -Math.PI / 2 + rotationRad + edgeIndex * sector;
  const endAngle = startAngle + sector;
  const start = { x: Math.cos(startAngle), y: Math.sin(startAngle) };
  const end = { x: Math.cos(endAngle), y: Math.sin(endAngle) };
  const chord = { x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t) };
  const chordDerivative = { x: end.x - start.x, y: end.y - start.y };

  if (curvature >= 0) {
    const theta = startAngle + sector * t;
    const circle = { x: Math.cos(theta), y: Math.sin(theta) };
    const circleDerivative = {
      x: -Math.sin(theta) * sector,
      y: Math.cos(theta) * sector,
    };
    return {
      point: {
        x: lerp(chord.x, circle.x, curvature),
        y: lerp(chord.y, circle.y, curvature),
      },
      derivative: {
        x: lerp(chordDerivative.x, circleDerivative.x, curvature),
        y: lerp(chordDerivative.y, circleDerivative.y, curvature),
      },
    };
  }

  const bend = -curvature * MAX_INWARD_FRACTION;
  const sine = Math.sin(Math.PI * t);
  const radialScale = 1 - bend * sine * sine;
  const scaleDerivative = -bend * Math.PI * Math.sin(TAU * t);
  return {
    point: { x: chord.x * radialScale, y: chord.y * radialScale },
    derivative: {
      x: chordDerivative.x * radialScale + chord.x * scaleDerivative,
      y: chordDerivative.y * radialScale + chord.y * scaleDerivative,
    },
  };
}

function openLineSample(t, curvature, rotationRad) {
  const localPoint = {
    x: -1 + 2 * t,
    y: curvature * OPEN_LINE_BEND * Math.sin(Math.PI * t),
  };
  const localDerivative = {
    x: 2,
    y: curvature * OPEN_LINE_BEND * Math.PI * Math.cos(Math.PI * t),
  };
  return {
    point: rotate(localPoint, rotationRad),
    derivative: rotate(localDerivative, rotationRad),
  };
}

function measure(points, closed) {
  const cumulativeLengths = new Array(points.length).fill(0);
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalLength += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
    cumulativeLengths[index] = totalLength;
  }
  if (closed && points.length > 1) {
    totalLength += Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    );
  }
  return { cumulativeLengths, totalLength };
}

/**
 * Build a normalized open line or closed curved regular polygon.
 * @param {BuildShapeOptions} options
 * @returns {ShapePath}
 */
export function buildShape(options) {
  if (!Number.isInteger(options.sides) || options.sides < 2 || options.sides > 16) {
    throw new RangeError("sides must be an integer from 2 through 16");
  }

  const sides = options.sides;
  const curvature = clamp(finiteOr(options.curvature, 0), -1, 1);
  const rotationDeg = finiteOr(options.rotationDeg, 0);
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const samplesPerEdge = clamp(
    Math.round(finiteOr(options.samplesPerEdge, DEFAULT_SAMPLES_PER_EDGE)),
    4,
    MAX_SAMPLES_PER_EDGE,
  );

  let points;
  let vertexIndices;
  let cornerStrengths;
  const closed = sides >= 3;

  if (!closed) {
    points = [];
    for (let sample = 0; sample <= samplesPerEdge; sample += 1) {
      points.push(openLineSample(sample / samplesPerEdge, curvature, rotationRad).point);
    }
    vertexIndices = [0, points.length - 1];
    // Endpoints become perceptual corners when ping-pong traversal reverses.
    cornerStrengths = [1, 1];
  } else {
    points = [];
    vertexIndices = [];
    cornerStrengths = [];
    for (let edge = 0; edge < sides; edge += 1) {
      vertexIndices.push(points.length);
      for (let sample = 0; sample < samplesPerEdge; sample += 1) {
        points.push(
          polygonEdgeSample(edge, sample / samplesPerEdge, sides, curvature, rotationRad).point,
        );
      }
    }
    for (let vertex = 0; vertex < sides; vertex += 1) {
      const incoming = polygonEdgeSample(
        (vertex - 1 + sides) % sides,
        1,
        sides,
        curvature,
        rotationRad,
      ).derivative;
      const outgoing = polygonEdgeSample(vertex, 0, sides, curvature, rotationRad).derivative;
      cornerStrengths.push(
        curvature >= 1 - EPSILON
          ? 0
          : clamp(angleBetween(incoming, outgoing) / Math.PI, 0, 1),
      );
    }
  }

  const { cumulativeLengths, totalLength } = measure(points, closed);
  const vertexDistances = vertexIndices.map((index) => cumulativeLengths[index]);
  return {
    points,
    closed,
    sides,
    curvature,
    rotationDeg,
    samplesPerEdge,
    bounds: boundsFromPoints(points),
    cumulativeLengths,
    totalLength,
    vertexIndices,
    vertexDistances,
    cornerStrengths,
  };
}

function segmentLength(path, segmentIndex) {
  const nextIndex = (segmentIndex + 1) % path.points.length;
  return Math.hypot(
    path.points[nextIndex].x - path.points[segmentIndex].x,
    path.points[nextIndex].y - path.points[segmentIndex].y,
  );
}

function nearestCorner(path, distance) {
  let cornerIndex = 0;
  let cornerDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.vertexDistances.length; index += 1) {
    const direct = Math.abs(distance - path.vertexDistances[index]);
    const candidate = path.closed ? Math.min(direct, path.totalLength - direct) : direct;
    if (candidate < cornerDistance) {
      cornerIndex = index;
      cornerDistance = candidate;
    }
  }
  return { cornerIndex, cornerDistance };
}

function contactOnSegment(path, segmentIndex, segmentT, distance) {
  const pointA = path.points[segmentIndex];
  const pointB = path.points[(segmentIndex + 1) % path.points.length];
  const tangent = normalize({ x: pointB.x - pointA.x, y: pointB.y - pointA.y });
  const normalizedDistance = path.closed && distance >= path.totalLength - EPSILON ? 0 : distance;
  const { cornerIndex, cornerDistance } = nearestCorner(path, normalizedDistance);
  const meanSideLength = path.totalLength / (path.closed ? path.sides : 1);
  return {
    x: lerp(pointA.x, pointB.x, segmentT),
    y: lerp(pointA.y, pointB.y, segmentT),
    u: path.totalLength <= EPSILON ? 0 : normalizedDistance / path.totalLength,
    distance: normalizedDistance,
    segmentIndex,
    segmentT,
    tangent,
    tangentAngle: Math.atan2(tangent.y, tangent.x),
    cornerIndex,
    cornerStrength: path.cornerStrengths[cornerIndex] ?? 0,
    cornerDistance,
    cornerDistance01: meanSideLength <= EPSILON ? 0 : cornerDistance / meanSideLength,
  };
}

function segmentAtDistance(path, distance) {
  const pointCount = path.points.length;
  if (!path.closed && distance >= path.totalLength - EPSILON) {
    return { segmentIndex: pointCount - 2, segmentT: 1 };
  }

  let low = 0;
  let high = pointCount - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (path.cumulativeLengths[middle] <= distance) low = middle;
    else high = middle - 1;
  }

  const segmentIndex = Math.min(low, path.closed ? pointCount - 1 : pointCount - 2);
  const length = segmentLength(path, segmentIndex);
  const segmentT = length <= EPSILON
    ? 0
    : clamp((distance - path.cumulativeLengths[segmentIndex]) / length, 0, 1);
  return { segmentIndex, segmentT };
}

/**
 * Constant-arclength lookup. Closed paths wrap; open paths clamp or ping-pong.
 * @param {ShapePath} path
 * @param {number} progress
 * @param {PointAtPathOptions} [options]
 * @returns {PathContact}
 */
export function pointAtPath(path, progress, options = {}) {
  if (path.points.length < 2 || path.totalLength <= EPSILON) {
    throw new RangeError("pointAtPath requires a non-degenerate path");
  }

  const u = path.closed
    ? wrap01(progress)
    : options.pingPong
      ? pingPong01(progress)
      : clamp(finiteOr(progress, 0), 0, 1);
  const distance = u * path.totalLength;
  const { segmentIndex, segmentT } = segmentAtDistance(path, distance);
  return contactOnSegment(path, segmentIndex, segmentT, distance);
}

function mergeContacts(a, b, epsilon) {
  const tangentSum = { x: a.tangent.x + b.tangent.x, y: a.tangent.y + b.tangent.y };
  const mergedTangent = Math.hypot(tangentSum.x, tangentSum.y) > epsilon
    ? normalize(tangentSum)
    : a.tangent;
  const preferred = a.cornerDistance <= b.cornerDistance ? a : b;
  const seam = Math.abs(a.u - b.u) > 0.5;
  return {
    ...preferred,
    u: seam ? 0 : (a.u + b.u) / 2,
    distance: seam ? 0 : (a.distance + b.distance) / 2,
    tangent: mergedTangent,
    tangentAngle: Math.atan2(mergedTangent.y, mergedTangent.x),
    cornerStrength: Math.max(a.cornerStrength, b.cornerStrength),
    cornerDistance: Math.min(a.cornerDistance, b.cornerDistance),
    cornerDistance01: Math.min(a.cornerDistance01, b.cornerDistance01),
  };
}

function axisIntersections(path, coordinate, fixedAxis, epsilon = 1e-8) {
  if (!Number.isFinite(coordinate) || path.points.length < 2) return [];
  const safeEpsilon = Math.max(EPSILON, Math.abs(epsilon));
  const varyingAxis = fixedAxis === "x" ? "y" : "x";
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;
  const candidates = [];
  const coincidentRuns = [];

  const addCandidate = (segmentIndex, segmentT) => {
    const length = segmentLength(path, segmentIndex);
    const distance = path.cumulativeLengths[segmentIndex] + length * segmentT;
    candidates.push(contactOnSegment(path, segmentIndex, segmentT, distance));
  };

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const pointA = path.points[segmentIndex];
    const pointB = path.points[(segmentIndex + 1) % path.points.length];
    const fixedDelta = pointB[fixedAxis] - pointA[fixedAxis];

    if (Math.abs(fixedDelta) <= safeEpsilon) {
      // A coincident segment has infinitely many hits. Save its interval so a
      // sampled straight edge becomes one continuous overlap, not one contact
      // per sample. The run's two outer endpoints are the useful finite result.
      if (Math.abs(coordinate - pointA[fixedAxis]) <= safeEpsilon) {
        const contactA = contactOnSegment(
          path,
          segmentIndex,
          0,
          path.cumulativeLengths[segmentIndex],
        );
        const length = segmentLength(path, segmentIndex);
        const contactB = contactOnSegment(
          path,
          segmentIndex,
          1,
          path.cumulativeLengths[segmentIndex] + length,
        );
        coincidentRuns.push(contactA[varyingAxis] <= contactB[varyingAxis]
          ? { low: contactA, high: contactB }
          : { low: contactB, high: contactA });
      }
      continue;
    }

    const segmentT = (coordinate - pointA[fixedAxis]) / fixedDelta;
    if (segmentT >= -safeEpsilon && segmentT <= 1 + safeEpsilon) {
      addCandidate(segmentIndex, clamp(segmentT, 0, 1));
    }
  }

  coincidentRuns.sort(
    (a, b) => a.low[varyingAxis] - b.low[varyingAxis]
      || a.high[varyingAxis] - b.high[varyingAxis],
  );
  const mergedRuns = [];
  for (const run of coincidentRuns) {
    const previous = mergedRuns[mergedRuns.length - 1];
    if (previous && run.low[varyingAxis] <= previous.high[varyingAxis] + safeEpsilon) {
      if (run.low[varyingAxis] < previous.low[varyingAxis]) previous.low = run.low;
      if (run.high[varyingAxis] > previous.high[varyingAxis]) previous.high = run.high;
    } else {
      mergedRuns.push({ ...run });
    }
  }
  for (const run of mergedRuns) {
    candidates.push(run.low);
    if (Math.abs(run.high[varyingAxis] - run.low[varyingAxis]) > safeEpsilon) {
      candidates.push(run.high);
    }
  }

  candidates.sort(
    (a, b) => a[varyingAxis] - b[varyingAxis] || a.distance - b.distance,
  );
  const deduped = [];
  for (const candidate of candidates) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      Math.abs(previous.x - candidate.x) <= safeEpsilon &&
      Math.abs(previous.y - candidate.y) <= safeEpsilon
    ) {
      deduped[deduped.length - 1] = mergeContacts(previous, candidate, safeEpsilon);
    } else {
      deduped.push(candidate);
    }
  }
  return deduped;
}

/**
 * Intersections with x = constant, sorted by y. Shared-vertex hits are merged.
 * @param {ShapePath} path
 * @param {number} x
 * @param {number} [epsilon]
 * @returns {PathContact[]}
 */
export function verticalIntersections(path, x, epsilon = 1e-8) {
  return axisIntersections(path, x, "x", epsilon);
}

/**
 * Intersections with y = constant, sorted left-to-right by x.
 * @param {ShapePath} path
 * @param {number} y
 * @param {number} [epsilon]
 * @returns {PathContact[]}
 */
export function horizontalIntersections(path, y, epsilon = 1e-8) {
  return axisIntersections(path, y, "y", epsilon);
}
