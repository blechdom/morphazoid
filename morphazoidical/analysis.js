/**
 * Morphazoidical's pure real-time geometry analysis layer.
 *
 * The legacy Shape path remains the input contract for this prototype, while
 * this module adds explicit semantics, topology, reader intervals, stable
 * contact identities, and registry-addressable values. No DOM or Web Audio
 * globals are touched here, so the same snapshot can feed tests, Canvas,
 * mappings, exports, and sound.
 */

import {
  horizontalIntersections,
  rayIntersections,
  verticalIntersections,
} from "../src/geometry.js";

const TAU = Math.PI * 2;
const DEFAULT_EPSILON = 1e-8;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length > 1e-12
    ? { x: vector.x / length, y: vector.y / length }
    : { x: 1, y: 0 };
}

function wrapAngle(angle) {
  const wrapped = (angle + Math.PI) % TAU;
  return (wrapped < 0 ? wrapped + TAU : wrapped) - Math.PI;
}

function segmentCount(path) {
  return path.closed ? path.points.length : Math.max(0, path.points.length - 1);
}

function segmentEndpoints(path, index) {
  return [path.points[index], path.points[(index + 1) % path.points.length]];
}

function segmentLength(path, index) {
  const [a, b] = segmentEndpoints(path, index);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathSignedArea(path) {
  if (!path.closed || path.points.length < 3) return null;
  let twiceArea = 0;
  for (let index = 0; index < path.points.length; index += 1) {
    const point = path.points[index];
    const next = path.points[(index + 1) % path.points.length];
    twiceArea += point.x * next.y - next.x * point.y;
  }
  return twiceArea * 0.5;
}

function lengthCentroid(path) {
  const count = segmentCount(path);
  let weightedX = 0;
  let weightedY = 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const [a, b] = segmentEndpoints(path, index);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    weightedX += (a.x + b.x) * 0.5 * length;
    weightedY += (a.y + b.y) * 0.5 * length;
    total += length;
  }
  if (total <= 1e-12) return { x: 0, y: 0 };
  return { x: weightedX / total, y: weightedY / total };
}

function areaCentroid(path, signedArea) {
  if (!path.closed || signedArea === null || Math.abs(signedArea) <= 1e-12) {
    return lengthCentroid(path);
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < path.points.length; index += 1) {
    const point = path.points[index];
    const next = path.points[(index + 1) % path.points.length];
    const weight = point.x * next.y - next.x * point.y;
    x += (point.x + next.x) * weight;
    y += (point.y + next.y) * weight;
  }
  const divisor = 6 * signedArea;
  return { x: x / divisor, y: y / divisor };
}

function boundsFor(points) {
  if (!points.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
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
  };
}

function convexHull(points, epsilon = DEFAULT_EPSILON) {
  const unique = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, sorted) => (
      index === 0
      || Math.abs(point.x - sorted[index - 1].x) > epsilon
      || Math.abs(point.y - sorted[index - 1].y) > epsilon
    ));
  if (unique.length <= 2) return unique.map((point) => ({ ...point }));
  const buildHalf = (source) => {
    const half = [];
    for (const point of source) {
      while (half.length >= 2) {
        const a = half[half.length - 2];
        const b = half[half.length - 1];
        if (cross(subtract(b, a), subtract(point, b)) > epsilon) break;
        half.pop();
      }
      half.push(point);
    }
    return half;
  };
  const lower = buildHalf(unique);
  const upper = buildHalf([...unique].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((point) => ({ ...point }));
}

function closedPolylineLength(points) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    total += Math.hypot(next.x - points[index].x, next.y - points[index].y);
  }
  return total;
}

function signedAreaOfPoints(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return sum * 0.5;
}

function principalComponents(points, center) {
  if (!points.length) return { angle: 0, eccentricity: 0, major: 0, minor: 0 };
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  xx /= points.length;
  yy /= points.length;
  xy /= points.length;
  const trace = xx + yy;
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
  const major = Math.max(0, (trace + discriminant) * 0.5);
  const minor = Math.max(0, (trace - discriminant) * 0.5);
  return {
    angle: 0.5 * Math.atan2(2 * xy, xx - yy),
    eccentricity: major > 1e-12 ? Math.sqrt(Math.max(0, 1 - minor / major)) : 0,
    major,
    minor,
  };
}

function pointSegmentDistance(point, start, end) {
  const delta = subtract(end, start);
  const lengthSquared = dot(delta, delta);
  const amount = lengthSquared > 1e-16
    ? clamp(dot(subtract(point, start), delta) / lengthSquared, 0, 1)
    : 0;
  return Math.hypot(
    point.x - lerp(start.x, end.x, amount),
    point.y - lerp(start.y, end.y, amount),
  );
}

/** Test a point against a closed contour using even/odd or nonzero winding. */
export function pointContainment(path, point, {
  fillRule = "nonzero",
  epsilon = DEFAULT_EPSILON,
} = {}) {
  if (!path?.closed || path.points.length < 3) {
    return { valid: false, inside: null, onBoundary: false, winding: null, fillRule };
  }
  let winding = 0;
  let parity = false;
  for (let index = 0; index < path.points.length; index += 1) {
    const a = path.points[index];
    const b = path.points[(index + 1) % path.points.length];
    if (pointSegmentDistance(point, a, b) <= epsilon) {
      return { valid: true, inside: true, onBoundary: true, winding, fillRule };
    }
    const crossesRay = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crossesRay) parity = !parity;
    if (a.y <= point.y) {
      if (b.y > point.y && cross(subtract(b, a), subtract(point, a)) > epsilon) winding += 1;
    } else if (b.y <= point.y && cross(subtract(b, a), subtract(point, a)) < -epsilon) {
      winding -= 1;
    }
  }
  return {
    valid: true,
    inside: fillRule === "evenodd" ? parity : winding !== 0,
    onBoundary: false,
    winding,
    fillRule,
  };
}

function orientation(a, b, c) {
  return cross(subtract(b, a), subtract(c, a));
}

function segmentIntersection(a, b, c, d, epsilon) {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const denominator = cross(r, s);
  const relative = subtract(c, a);
  if (Math.abs(denominator) <= epsilon) {
    if (Math.abs(cross(relative, r)) > epsilon) return null;
    const rr = dot(r, r);
    if (rr <= epsilon ** 2) return null;
    const first = dot(relative, r) / rr;
    const second = first + dot(s, r) / rr;
    const low = Math.max(0, Math.min(first, second));
    const high = Math.min(1, Math.max(first, second));
    if (high < low - epsilon) return null;
    if (high - low <= epsilon) {
      return {
        kind: "touch",
        point: { x: lerp(a.x, b.x, clamp((low + high) * 0.5, 0, 1)), y: lerp(a.y, b.y, clamp((low + high) * 0.5, 0, 1)) },
        tA: clamp((low + high) * 0.5, 0, 1),
        tB: null,
      };
    }
    return {
      kind: "overlap",
      start: { x: lerp(a.x, b.x, low), y: lerp(a.y, b.y, low) },
      end: { x: lerp(a.x, b.x, high), y: lerp(a.y, b.y, high) },
      point: { x: lerp(a.x, b.x, (low + high) * 0.5), y: lerp(a.y, b.y, (low + high) * 0.5) },
      tA: (low + high) * 0.5,
      tB: null,
    };
  }
  const t = cross(relative, s) / denominator;
  const u = cross(relative, r) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null;
  const boundedT = clamp(t, 0, 1);
  const boundedU = clamp(u, 0, 1);
  const endpoint = boundedT <= epsilon || boundedT >= 1 - epsilon
    || boundedU <= epsilon || boundedU >= 1 - epsilon;
  return {
    kind: endpoint ? "touch" : "cross",
    point: { x: lerp(a.x, b.x, boundedT), y: lerp(a.y, b.y, boundedT) },
    tA: boundedT,
    tB: boundedU,
    crossingAngle: Math.abs(wrapAngle(Math.atan2(r.y, r.x) - Math.atan2(s.y, s.x))),
  };
}

function adjacentSegments(first, second, count, closed) {
  if (first === second || Math.abs(first - second) === 1) return true;
  return closed && ((first === 0 && second === count - 1) || (second === 0 && first === count - 1));
}

/** Classify every nonadjacent sampled-segment self-intersection. */
export function classifySelfIntersections(path, {
  epsilon = DEFAULT_EPSILON,
  gridCells = 32,
} = {}) {
  const count = segmentCount(path);
  if (count < 3) return [];
  const bounds = boundsFor(path.points);
  const columns = Math.max(4, Math.min(64, Math.trunc(gridCells)));
  const rows = columns;
  const width = Math.max(bounds.width, epsilon);
  const height = Math.max(bounds.height, epsilon);
  const buckets = new Map();
  const boxes = [];
  const keyFor = (x, y) => `${x}:${y}`;
  const cellX = (x) => clamp(Math.floor((x - bounds.minX) / width * columns), 0, columns - 1);
  const cellY = (y) => clamp(Math.floor((y - bounds.minY) / height * rows), 0, rows - 1);
  for (let index = 0; index < count; index += 1) {
    const [a, b] = segmentEndpoints(path, index);
    const box = {
      minX: Math.min(a.x, b.x) - epsilon,
      maxX: Math.max(a.x, b.x) + epsilon,
      minY: Math.min(a.y, b.y) - epsilon,
      maxY: Math.max(a.y, b.y) + epsilon,
    };
    boxes.push(box);
    for (let x = cellX(box.minX); x <= cellX(box.maxX); x += 1) {
      for (let y = cellY(box.minY); y <= cellY(box.maxY); y += 1) {
        const key = keyFor(x, y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
    }
  }
  const candidateKeys = new Set();
  for (const bucket of buckets.values()) {
    for (let first = 0; first < bucket.length; first += 1) {
      for (let second = first + 1; second < bucket.length; second += 1) {
        const a = Math.min(bucket[first], bucket[second]);
        const b = Math.max(bucket[first], bucket[second]);
        if (!adjacentSegments(a, b, count, path.closed)) candidateKeys.add(`${a}:${b}`);
      }
    }
  }
  const intersections = [];
  for (const key of candidateKeys) {
    const [first, second] = key.split(":").map(Number);
    const aBox = boxes[first];
    const bBox = boxes[second];
    if (aBox.maxX < bBox.minX || bBox.maxX < aBox.minX || aBox.maxY < bBox.minY || bBox.maxY < aBox.minY) continue;
    const [a, b] = segmentEndpoints(path, first);
    const [c, d] = segmentEndpoints(path, second);
    const hit = segmentIntersection(a, b, c, d, epsilon);
    if (hit) intersections.push({ ...hit, segmentA: first, segmentB: second, multiplicity: 2 });
  }
  return intersections.sort((a, b) => a.segmentA - b.segmentA || a.segmentB - b.segmentB);
}

/** Compute cached, whole-path metrics. */
export function analyzePath(path, {
  center = { x: 0, y: 0 },
  fillRule = "nonzero",
  epsilon = DEFAULT_EPSILON,
  includeSelfIntersections = true,
} = {}) {
  if (!path?.points?.length) throw new TypeError("analyzePath requires a ShapePath");
  const signedArea = pathSignedArea(path);
  const area = signedArea === null ? null : Math.abs(signedArea);
  const centroid = areaCentroid(path, signedArea);
  const perimeterCentroid = lengthCentroid(path);
  const bounds = path.bounds ?? boundsFor(path.points);
  const hull = convexHull(path.points, epsilon);
  const hullArea = hull.length >= 3 ? Math.abs(signedAreaOfPoints(hull)) : 0;
  const hullPerimeter = hull.length >= 2 ? closedPolylineLength(hull) : 0;
  const perimeter = finiteOr(path.totalLength, 0);
  const components = principalComponents(path.points, centroid);
  const radii = path.points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const radiusMean = radii.reduce((sum, value) => sum + value, 0) / Math.max(1, radii.length);
  const radiusDeviation = Math.sqrt(
    radii.reduce((sum, value) => sum + (value - radiusMean) ** 2, 0) / Math.max(1, radii.length),
  );
  const centerContainment = pointContainment(path, center, { fillRule, epsilon });
  const selfIntersections = includeSelfIntersections
    ? classifySelfIntersections(path, { epsilon })
    : [];
  const crossings = includeSelfIntersections
    ? selfIntersections.filter((item) => item.kind === "cross").length
    : null;
  const touches = includeSelfIntersections
    ? selfIntersections.filter((item) => item.kind === "touch").length
    : null;
  const overlaps = includeSelfIntersections
    ? selfIntersections.filter((item) => item.kind === "overlap").length
    : null;
  const orientationName = !path.closed
    ? "open"
    : Math.abs(signedArea ?? 0) <= epsilon
      ? "degenerate"
      : signedArea > 0 ? "clockwise" : "counterclockwise";
  const simpleClosed = includeSelfIntersections
    ? path.closed && selfIntersections.length === 0 && area !== null && area > epsilon
    : null;
  const compactness = path.closed && area !== null && perimeter > epsilon
    ? clamp(4 * Math.PI * area / (perimeter ** 2), 0, 1)
    : null;
  const solidity = simpleClosed && hullArea > epsilon ? clamp(area / hullArea, 0, 1) : null;
  const convexity = path.closed && hullPerimeter > epsilon && perimeter > epsilon
    ? clamp(hullPerimeter / perimeter, 0, 1)
    : null;
  const logicalEdgeCount = path.shapeType === "circle"
    ? 1
    : (path.vertexIndices?.length ?? 0) > 0
      ? path.closed ? path.vertexIndices.length : Math.max(1, path.vertexIndices.length - 1)
      : segmentCount(path);
  const features = {
    "geometry.closed": Boolean(path.closed),
    "geometry.perimeter": perimeter,
    "geometry.samples": path.points.length,
    "geometry.segments": segmentCount(path),
    "geometry.logicalEdges": logicalEdgeCount,
    "geometry.area": area,
    "geometry.signedArea": signedArea,
    "geometry.orientation": orientationName,
    "geometry.centroid.x": centroid.x,
    "geometry.centroid.y": centroid.y,
    "geometry.bounds.width": bounds.width,
    "geometry.bounds.height": bounds.height,
    "geometry.compactness": compactness,
    "geometry.solidity": solidity,
    "geometry.convexity": convexity,
    "geometry.hull.area": path.closed ? hullArea : null,
    "geometry.hull.perimeter": hullPerimeter,
    "geometry.principalAxis": components.angle,
    "geometry.eccentricity": components.eccentricity,
    "geometry.radius.minimum": Math.min(...radii),
    "geometry.radius.maximum": Math.max(...radii),
    "geometry.radius.mean": radiusMean,
    "geometry.radius.deviation": radiusDeviation,
    "geometry.center.inside": centerContainment.valid ? centerContainment.inside : null,
    "geometry.center.winding": centerContainment.winding,
    "geometry.selfIntersections": includeSelfIntersections ? selfIntersections.length : null,
    "geometry.crossings": crossings,
    "geometry.touches": touches,
    "geometry.overlaps": overlaps,
  };
  return {
    closed: path.closed,
    pointCount: path.points.length,
    segmentCount: segmentCount(path),
    logicalEdgeCount,
    vertexCount: path.vertexCount ?? path.vertexIndices?.length ?? 0,
    perimeter,
    signedArea,
    area,
    orientation: orientationName,
    centroid,
    perimeterCentroid,
    center: { ...center },
    bounds,
    hull,
    hullArea,
    hullPerimeter,
    compactness,
    solidity,
    convexity,
    principalAxis: components.angle,
    eccentricity: components.eccentricity,
    radius: {
      minimum: Math.min(...radii),
      maximum: Math.max(...radii),
      mean: radiusMean,
      deviation: radiusDeviation,
    },
    centerContainment,
    fillRule,
    selfIntersections,
    intersections: selfIntersections,
    topology: { crossings, touches, overlaps, simpleClosed },
    quality: {
      method: "sampled-polyline",
      samples: path.points.length,
      analytic: false,
      selfIntersectionsEvaluated: includeSelfIntersections,
    },
    features,
  };
}

function logicalEdgeFor(path, segmentIndex, segmentT = 0) {
  const vertices = path.vertexIndices ?? [];
  if (!vertices.length) return { logicalEdgeIndex: -1, logicalEdgeT: null };
  let logicalEdgeIndex = 0;
  for (let index = 1; index < vertices.length; index += 1) {
    if (vertices[index] <= segmentIndex) logicalEdgeIndex = index;
    else break;
  }
  const start = vertices[logicalEdgeIndex];
  const next = logicalEdgeIndex + 1 < vertices.length
    ? vertices[logicalEdgeIndex + 1]
    : path.closed ? path.points.length : path.points.length - 1;
  const span = Math.max(1, next - start);
  return {
    logicalEdgeIndex,
    logicalEdgeT: clamp((segmentIndex - start + clamp(finiteOr(segmentT, 0), 0, 1)) / span, 0, 1),
  };
}

function distanceToHull(point, hull) {
  if (hull.length < 2) return Infinity;
  let distance = Infinity;
  for (let index = 0; index < hull.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance(point, hull[index], hull[(index + 1) % hull.length]));
  }
  return distance;
}

/** Add local, center-relative, edge, and inside/outside semantics to a contact. */
export function analyzeContact(path, contact, pathAnalysis = null, {
  center = pathAnalysis?.center ?? { x: 0, y: 0 },
  epsilon = DEFAULT_EPSILON,
} = {}) {
  const geometry = pathAnalysis ?? analyzePath(path, { center, epsilon });
  const segmentIndex = clamp(Math.trunc(finiteOr(contact.segmentIndex, 0)), 0, Math.max(0, segmentCount(path) - 1));
  const [start, end] = segmentEndpoints(path, segmentIndex);
  const tangent = normalize(contact.tangent ?? subtract(end, start));
  const segmentT = clamp(finiteOr(contact.segmentT, contact.amount ?? 0), 0, 1);
  const atStart = segmentT <= epsilon;
  const atEnd = segmentT >= 1 - epsilon;
  const previousIndex = segmentIndex > 0 ? segmentIndex - 1 : path.closed ? segmentCount(path) - 1 : segmentIndex;
  const nextIndex = segmentIndex + 1 < segmentCount(path) ? segmentIndex + 1 : path.closed ? 0 : segmentIndex;
  const [previousStart, previousEnd] = segmentEndpoints(path, previousIndex);
  const [nextStart, nextEnd] = segmentEndpoints(path, nextIndex);
  // Incoming/current/outgoing are sampled one-sided headings. Keeping all
  // three explicit makes "angle relative to the last segment" well-defined at
  // both logical corners and ordinary curve samples.
  const incoming = normalize(subtract(previousEnd, previousStart));
  const outgoing = normalize(subtract(nextEnd, nextStart));
  const orientationSign = (geometry.signedArea ?? 0) >= 0 ? 1 : -1;
  const outwardNormal = path.closed
    ? orientationSign > 0
      ? { x: tangent.y, y: -tangent.x }
      : { x: -tangent.y, y: tangent.x }
    : null;
  const x = finiteOr(contact.x, lerp(start.x, end.x, segmentT));
  const y = finiteOr(contact.y, lerp(start.y, end.y, segmentT));
  const radial = { x: x - center.x, y: y - center.y };
  const radius = Math.hypot(radial.x, radial.y);
  const radialUnit = radius > epsilon ? { x: radial.x / radius, y: radial.y / radius } : { x: 0, y: 0 };
  const polarAngle = radius > epsilon ? Math.atan2(radial.y, radial.x) : 0;
  const tangentAngle = Math.atan2(tangent.y, tangent.x);
  const incomingAngle = Math.atan2(incoming.y, incoming.x);
  const outgoingAngle = Math.atan2(outgoing.y, outgoing.x);
  const normalAngle = outwardNormal ? Math.atan2(outwardNormal.y, outwardNormal.x) : null;
  const localTurn = wrapAngle(tangentAngle - incomingAngle);
  const curvatureTurn = wrapAngle(outgoingAngle - incomingAngle);
  const localLength = segmentLength(path, previousIndex) * 0.5
    + segmentLength(path, segmentIndex)
    + segmentLength(path, nextIndex) * 0.5;
  const curvature = localLength > epsilon ? curvatureTurn / localLength : 0;
  const nearestCornerTurn = Number.isFinite(contact.cornerTurn) ? contact.cornerTurn * Math.PI : 0;
  const cornerSigned = nearestCornerTurn * orientationSign;
  const cornerClass = !path.closed
    ? "unavailable"
    : Math.abs(cornerSigned) <= 1e-5
      ? "smooth"
      : cornerSigned > 0 ? "convex" : "reflex";
  const hullDistance = distanceToHull({ x, y }, geometry.hull);
  const hullClass = !path.closed
    ? "unavailable"
    : hullDistance <= Math.max(epsilon * 10, 1e-5) ? "hull-boundary" : "reentrant";
  const boundsX = geometry.bounds.width > epsilon
    ? (x - geometry.bounds.minX) / geometry.bounds.width
    : 0.5;
  const boundsY = geometry.bounds.height > epsilon
    ? (y - geometry.bounds.minY) / geometry.bounds.height
    : 0.5;
  const logical = logicalEdgeFor(path, segmentIndex, segmentT);
  const hasLogicalCorners = (path.vertexIndices?.length ?? 0) > 0 && contact.cornerIndex !== -1;
  const features = {
    "contact.position.x": x,
    "contact.position.y": y,
    "contact.bounds.x": clamp(boundsX, 0, 1),
    "contact.bounds.y": clamp(boundsY, 0, 1),
    "contact.contourPhase": Number.isFinite(contact.u) ? contact.u : null,
    "contact.contourDistance": Number.isFinite(contact.distance) ? contact.distance : null,
    "contact.segment.index": segmentIndex,
    "contact.segment.phase": segmentT,
    "contact.logicalEdge.index": logical.logicalEdgeIndex >= 0 ? logical.logicalEdgeIndex : null,
    "contact.logicalEdge.phase": logical.logicalEdgeT,
    "contact.radius": radius,
    "contact.polarAngle": polarAngle,
    "contact.tangentAngle": tangentAngle,
    "contact.incomingAngle": incomingAngle,
    "contact.outgoingAngle": outgoingAngle,
    "contact.normalAngle": normalAngle,
    "contact.turn": localTurn,
    "contact.curvature": curvature,
    "contact.radialAlignment": radius > epsilon ? dot(tangent, radialUnit) : 0,
    "contact.centerFacing": outwardNormal && radius > epsilon ? dot(outwardNormal, radialUnit) : null,
    "contact.tangentRadiusAngle": wrapAngle(tangentAngle - polarAngle),
    "contact.corner.distance": hasLogicalCorners && Number.isFinite(contact.cornerDistance)
      ? contact.cornerDistance
      : null,
    "contact.corner.strength": Number.isFinite(contact.cornerStrength) ? contact.cornerStrength : 0,
    "contact.corner.class": cornerClass,
    "contact.hull.class": hullClass,
    "contact.reader.boundaryRole": contact.boundaryRole ?? "unavailable",
    "contact.reader.rank": Number.isFinite(contact.readerRank) ? contact.readerRank : null,
    "contact.reader.incidence": Number.isFinite(contact.readerIncidence) ? contact.readerIncidence : null,
    "contact.reader.transversality": Number.isFinite(contact.readerTransversality)
      ? contact.readerTransversality
      : null,
    "contact.motion.speed": Number.isFinite(contact.motionSpeed) ? contact.motionSpeed : 0,
    "contact.motion.contourVelocity": Number.isFinite(contact.contourVelocity) ? contact.contourVelocity : 0,
    "contact.motion.age": Number.isFinite(contact.age) ? contact.age : 0,
  };
  return {
    ...contact,
    x,
    y,
    segmentIndex,
    segmentT,
    tangent,
    incoming,
    outgoing,
    outwardNormal,
    logicalEdgeIndex: logical.logicalEdgeIndex,
    logicalEdgeT: logical.logicalEdgeT,
    radius,
    polarAngle,
    tangentAngle,
    turn: localTurn,
    curvature,
    radialAlignment: features["contact.radialAlignment"],
    centerFacing: features["contact.centerFacing"],
    cornerClass,
    hullClass,
    boundaryRole: contact.boundaryRole ?? "unavailable",
    features,
    quality: {
      method: "sampled-segment",
      tangentAmbiguous: atStart || atEnd,
      exactIntersection: contact.contactKind !== "proximity",
    },
  };
}

function contactsForReader(path, reader) {
  if (!reader) return [];
  if (reader.type === "vertical") return verticalIntersections(path, reader.x);
  if (reader.type === "horizontal") return horizontalIntersections(path, reader.y);
  if (reader.type === "ray") return rayIntersections(path, reader.angle, reader.origin);
  return Array.isArray(reader.contacts) ? reader.contacts : [];
}

function readerCoordinate(contact, reader) {
  if (reader?.type === "vertical") return contact.y;
  if (reader?.type === "horizontal") return contact.x;
  if (reader?.type === "ray") {
    if (Number.isFinite(contact.rayDistance)) return contact.rayDistance;
    const origin = reader.origin ?? { x: 0, y: 0 };
    return (contact.x - origin.x) * Math.cos(reader.angle)
      + (contact.y - origin.y) * Math.sin(reader.angle);
  }
  return Number.isFinite(contact.u) ? contact.u : 0;
}

function readerDirection(reader) {
  if (reader?.type === "vertical") return { x: 0, y: 1 };
  if (reader?.type === "horizontal") return { x: 1, y: 0 };
  if (reader?.type === "ray") return { x: Math.cos(reader.angle), y: Math.sin(reader.angle) };
  return { x: 1, y: 0 };
}

/** Analyze ordered reader contacts and explicit inside intervals. */
export function analyzeReader(path, reader, pathAnalysis = null, {
  contacts = null,
  center = pathAnalysis?.center ?? { x: 0, y: 0 },
  fillRule = pathAnalysis?.fillRule ?? "nonzero",
  epsilon = DEFAULT_EPSILON,
} = {}) {
  const geometry = pathAnalysis ?? analyzePath(path, { center, fillRule, epsilon });
  const source = contacts ?? contactsForReader(path, reader);
  const analyzed = source.map((contact) => analyzeContact(path, contact, geometry, { center, epsilon }));
  analyzed.sort((a, b) => readerCoordinate(a, reader) - readerCoordinate(b, reader));
  const direction = readerDirection(reader);
  const hasDirectionalReader = ["vertical", "horizontal", "ray"].includes(reader?.type);
  const probe = Math.max(epsilon * 100, 1e-5);
  for (let index = 0; index < analyzed.length; index += 1) {
    const contact = analyzed[index];
    contact.readerRank = index;
    contact.features["contact.reader.rank"] = index;
    if (hasDirectionalReader) {
      const transversality = clamp(Math.abs(cross(direction, contact.tangent)), 0, 1);
      contact.readerTransversality = transversality;
      contact.readerIncidence = Math.asin(transversality);
      contact.features["contact.reader.transversality"] = transversality;
      contact.features["contact.reader.incidence"] = contact.readerIncidence;
    } else {
      contact.readerTransversality = null;
      contact.readerIncidence = null;
      contact.features["contact.reader.transversality"] = null;
      contact.features["contact.reader.incidence"] = null;
    }
    if (!path.closed || !reader || reader.type === "path") {
      contact.boundaryRole = "unavailable";
    } else {
      const before = pointContainment(path, {
        x: contact.x - direction.x * probe,
        y: contact.y - direction.y * probe,
      }, { fillRule, epsilon });
      const after = pointContainment(path, {
        x: contact.x + direction.x * probe,
        y: contact.y + direction.y * probe,
      }, { fillRule, epsilon });
      contact.boundaryRole = before.inside === after.inside
        ? "touch"
        : !before.inside && after.inside ? "enter" : "exit";
    }
    contact.features["contact.reader.boundaryRole"] = contact.boundaryRole;
  }
  const coordinates = analyzed.map((contact) => readerCoordinate(contact, reader));
  const spacings = coordinates.slice(1).map((value, index) => Math.abs(value - coordinates[index]));
  const supportsIntervals = path.closed && ["vertical", "horizontal", "ray"].includes(reader?.type);
  const insideIntervals = [];
  if (supportsIntervals && analyzed.length >= 2) {
    for (let index = 0; index + 1 < analyzed.length; index += 1) {
      const a = analyzed[index];
      const b = analyzed[index + 1];
      const midpoint = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      if (pointContainment(path, midpoint, { fillRule, epsilon }).inside) {
        insideIntervals.push({
          from: coordinates[index],
          to: coordinates[index + 1],
          length: Math.abs(coordinates[index + 1] - coordinates[index]),
          startContactIndex: index,
          endContactIndex: index + 1,
          start: { x: a.x, y: a.y },
          end: { x: b.x, y: b.y },
        });
      }
    }
  }
  const insideSpan = insideIntervals.reduce((sum, interval) => sum + interval.length, 0);
  const transversalities = analyzed
    .map((contact) => contact.readerTransversality)
    .filter(Number.isFinite);
  const finiteExtent = reader?.type === "ray"
    ? Math.max(geometry.bounds.width, geometry.bounds.height, geometry.radius.maximum)
    : reader?.type === "vertical" ? geometry.bounds.height
      : reader?.type === "horizontal" ? geometry.bounds.width : 1;
  const features = {
    "reader.contactCount": analyzed.length,
    "reader.insideIntervalCount": supportsIntervals ? insideIntervals.length : null,
    "reader.insideSpan": supportsIntervals ? insideSpan : null,
    "reader.insideFraction": supportsIntervals && finiteExtent > epsilon
      ? clamp(insideSpan / finiteExtent, 0, 1)
      : null,
    "reader.spacing.minimum": spacings.length ? Math.min(...spacings) : null,
    "reader.spacing.mean": spacings.length
      ? spacings.reduce((sum, value) => sum + value, 0) / spacings.length
      : null,
    "reader.contactDelta": 0,
    "reader.transversality.minimum": transversalities.length ? Math.min(...transversalities) : null,
    "reader.transversality.mean": transversalities.length
      ? transversalities.reduce((sum, value) => sum + value, 0) / transversalities.length
      : null,
  };
  return {
    ...(reader ?? { type: "path" }),
    contacts: analyzed,
    direction,
    coordinates,
    spacings,
    insideIntervals,
    insideSpan,
    extent: finiteExtent,
    features,
  };
}

function circularPhaseDistance(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.5;
  const direct = Math.abs(a - b);
  return Math.min(direct, 1 - direct);
}

/**
 * Assign stable IDs by minimum predicted position/phase cost and report typed
 * births/deaths. This deliberately preserves identity independently of display
 * sorting.
 */
export function trackContacts(previousTracking, contacts, {
  timestamp = 0,
  maximumDistance = 0.3,
  readerKey = "reader:0",
} = {}) {
  const previous = previousTracking?.contacts ?? [];
  const nextSerialStart = previousTracking?.nextSerial ?? 1;
  let nextSerial = nextSerialStart;
  const candidates = [];
  for (let oldIndex = 0; oldIndex < previous.length; oldIndex += 1) {
    for (let newIndex = 0; newIndex < contacts.length; newIndex += 1) {
      const oldContact = previous[oldIndex];
      const newContact = contacts[newIndex];
      const spatial = Math.hypot(oldContact.x - newContact.x, oldContact.y - newContact.y);
      const phase = circularPhaseDistance(oldContact.u, newContact.u);
      const edgePenalty = oldContact.logicalEdgeIndex === newContact.logicalEdgeIndex ? 0 : 0.06;
      candidates.push({ oldIndex, newIndex, cost: spatial + phase * 0.22 + edgePenalty, spatial });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  const usedOld = new Set();
  const usedNew = new Set();
  const assignment = new Map();
  for (const candidate of candidates) {
    if (candidate.spatial > maximumDistance || usedOld.has(candidate.oldIndex) || usedNew.has(candidate.newIndex)) continue;
    usedOld.add(candidate.oldIndex);
    usedNew.add(candidate.newIndex);
    assignment.set(candidate.newIndex, previous[candidate.oldIndex]);
  }
  const tracked = contacts.map((contact, index) => {
    const old = assignment.get(index);
    const id = old?.id ?? `${readerKey}:contact:${nextSerial++}`;
    const bornAt = old?.bornAt ?? timestamp;
    return {
      ...contact,
      id,
      bornAt,
      age: Math.max(0, timestamp - bornAt),
      previous: old ? { x: old.x, y: old.y, u: old.u, timestamp: old.timestamp } : null,
      timestamp,
    };
  });
  const births = tracked.filter((_, index) => !assignment.has(index));
  const deaths = previous.filter((_, index) => !usedOld.has(index));
  return {
    contacts: tracked,
    births,
    deaths,
    splits: [],
    merges: [],
    timestamp,
    nextSerial,
    readerKey,
  };
}

function eventRecord(type, timestamp, contact, detail = {}) {
  return {
    id: `${type}:${timestamp.toFixed(6)}:${contact?.id ?? detail.index ?? "set"}`,
    type,
    timestamp,
    contactId: contact?.id ?? null,
    position: contact ? { x: contact.x, y: contact.y } : null,
    ...detail,
  };
}

/** Create one immutable-style snapshot shared by every runtime consumer. */
export function analyzeFrame({
  path,
  reader = null,
  contacts = null,
  previousFrame = null,
  timestamp = 0,
  center = { x: 0, y: 0 },
  fillRule = "nonzero",
  epsilon = DEFAULT_EPSILON,
  includeSelfIntersections = true,
} = {}) {
  const geometry = analyzePath(path, {
    center,
    fillRule,
    epsilon,
    includeSelfIntersections,
  });
  const readerAnalysis = analyzeReader(path, reader, geometry, {
    contacts,
    center,
    fillRule,
    epsilon,
  });
  const readerKey = reader?.id ?? `reader:${reader?.type ?? "path"}`;
  const tracking = trackContacts(previousFrame?.tracking, readerAnalysis.contacts, {
    timestamp,
    readerKey,
  });
  const deltaTime = previousFrame && timestamp > previousFrame.timestamp
    ? timestamp - previousFrame.timestamp
    : 0;
  for (const contact of tracking.contacts) {
    const contactDeltaTime = contact.previous && timestamp > contact.previous.timestamp
      ? timestamp - contact.previous.timestamp
      : deltaTime;
    if (contact.previous && contactDeltaTime > 0) {
      contact.motionSpeed = Math.hypot(
        contact.x - contact.previous.x,
        contact.y - contact.previous.y,
      ) / contactDeltaTime;
      let contourDelta = Number.isFinite(contact.u) && Number.isFinite(contact.previous.u)
        ? contact.u - contact.previous.u
        : 0;
      if (path.closed) {
        if (contourDelta > 0.5) contourDelta -= 1;
        else if (contourDelta < -0.5) contourDelta += 1;
      }
      contact.contourVelocity = contourDelta / contactDeltaTime;
    } else {
      contact.motionSpeed = 0;
      contact.contourVelocity = 0;
    }
    contact.features["contact.motion.speed"] = contact.motionSpeed;
    contact.features["contact.motion.contourVelocity"] = contact.contourVelocity;
    contact.features["contact.motion.age"] = contact.age;
  }
  readerAnalysis.contacts = tracking.contacts;
  const previousCount = previousFrame?.contacts?.length ?? tracking.contacts.length;
  const contactDelta = tracking.contacts.length - previousCount;
  readerAnalysis.features["reader.contactDelta"] = contactDelta;
  const events = [
    ...tracking.births.map((contact) => eventRecord("contact_birth", timestamp, contact)),
    ...tracking.deaths.map((contact) => eventRecord("contact_death", timestamp, contact)),
  ];
  if (tracking.births.length >= 2 && tracking.deaths.length === 0) {
    events.push(eventRecord("contact_pair_birth", timestamp, tracking.births[0], { count: tracking.births.length }));
  }
  if (tracking.deaths.length >= 2 && tracking.births.length === 0) {
    events.push(eventRecord("contact_pair_death", timestamp, tracking.deaths[0], { count: tracking.deaths.length }));
  }
  for (const contact of tracking.births) {
    if (contact.boundaryRole === "enter") events.push(eventRecord("reader_entry", timestamp, contact));
    if (contact.boundaryRole === "exit") events.push(eventRecord("reader_exit", timestamp, contact));
  }
  const eventCounts = {
    births: tracking.births.length,
    deaths: tracking.deaths.length,
    // Structural split/merge semantics require a planarized graph or swept
    // tracker. Preserve unavailability instead of reporting a false zero.
    splits: null,
    merges: null,
    entries: events.filter((event) => event.type === "reader_entry").length,
    exits: events.filter((event) => event.type === "reader_exit").length,
  };
  const eventFeatures = {
    "events.births": eventCounts.births,
    "events.deaths": eventCounts.deaths,
    "events.splits": eventCounts.splits,
    "events.merges": eventCounts.merges,
    "events.entries": eventCounts.entries,
    "events.exits": eventCounts.exits,
  };
  return {
    timestamp,
    path,
    geometry,
    reader: readerAnalysis,
    contacts: tracking.contacts,
    tracking,
    events,
    eventCounts,
    eventFeatures,
    features: {
      ...geometry.features,
      ...readerAnalysis.features,
      ...eventFeatures,
    },
    quality: {
      geometry: geometry.quality,
      temporal: "frame-sampled",
      bifurcationRefined: false,
    },
  };
}

/** Flatten a frame into the stable feature-ID namespace used by mappings. */
export function flattenFeatureValues(frame, { contactIndex = 0 } = {}) {
  if (!frame) return {};
  const contact = frame.contacts?.[contactIndex] ?? null;
  return {
    ...(frame.geometry?.features ?? {}),
    ...(frame.reader?.features ?? {}),
    ...(contact?.features ?? {}),
    "events.births": frame.eventCounts?.births ?? 0,
    "events.deaths": frame.eventCounts?.deaths ?? 0,
    "events.splits": frame.eventCounts?.splits ?? null,
    "events.merges": frame.eventCounts?.merges ?? null,
    "events.entries": frame.eventCounts?.entries ?? 0,
    "events.exits": frame.eventCounts?.exits ?? 0,
  };
}
