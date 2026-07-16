/**
 * Pure lattice geometry adapted from the Tessamorigami scanner and the
 * Tessamorphisma edge-net builder. The lattice is never traversed: one fixed
 * line intersects a periodically translated, deduplicated curved-edge net.
 */

import {
  EdgeShape,
  IsohedralTiling,
  mul,
  tilingTypes,
} from "../vendor/tactile/tactile.js";

const SAMPLES_PER_EDGE = 12;
const KEY_PRECISION = 1e7;
const EPSILON = 1e-9;
const DEFAULT_TYPE = 20;

const EDGE_SHAPE_NAMES = new Map([
  [EdgeShape.J, "J"],
  [EdgeShape.U, "U"],
  [EdgeShape.S, "S"],
  [EdgeShape.I, "I"],
]);

function prototileName(sideCount) {
  if (sideCount === 3) return "Triangle";
  if (sideCount === 4) return "Quadrilateral";
  if (sideCount === 5) return "Pentagon";
  if (sideCount === 6) return "Hexagon";
  return `${sideCount}-sided`;
}

function makeTilingInfo(type) {
  const tiling = new IsohedralTiling(type);
  const sideCount = tiling.vertices().length;
  const code = `IH${String(type).padStart(2, "0")}`;
  const edgeShapes = Array.from(
    { length: tiling.numEdgeShapes() },
    (_, index) => tiling.getEdgeShape(index),
  );
  return Object.freeze({
    type,
    code,
    label: `${prototileName(sideCount)} \u00b7 ${code}`,
    family: prototileName(sideCount),
    sideCount,
    defaultParameters: Object.freeze(tiling.getParameters()),
    edgeShapes: Object.freeze(edgeShapes),
    edgeShapeNames: Object.freeze(edgeShapes.map((shape) => EDGE_SHAPE_NAMES.get(shape))),
  });
}

/** All 72 isohedral tiling families exposed by Tactile. */
export const TILING_TYPES = Object.freeze(tilingTypes.map(makeTilingInfo));
const TILING_INFO_BY_TYPE = new Map(TILING_TYPES.map((info) => [info.type, info]));

export function tilingInfo(type = DEFAULT_TYPE) {
  return TILING_INFO_BY_TYPE.get(Number(type)) ?? TILING_INFO_BY_TYPE.get(DEFAULT_TYPE);
}

export function edgeShapeName(shape) {
  return EDGE_SHAPE_NAMES.get(shape) ?? "?";
}

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function cubicPoint(start, control1, control2, end, amount) {
  const inverse = 1 - amount;
  return {
    x: inverse ** 3 * start.x
      + 3 * inverse * inverse * amount * control1.x
      + 3 * inverse * amount * amount * control2.x
      + amount ** 3 * end.x,
    y: inverse ** 3 * start.y
      + 3 * inverse * inverse * amount * control1.y
      + 3 * inverse * amount * amount * control2.y
      + amount ** 3 * end.y,
  };
}

/** Sample one legal isohedral edge in edge-local coordinates. */
export function edgeCurve(shapeClass, amount, edgeShapeId = 0, samples = SAMPLES_PER_EDGE) {
  const bend = shapeClass === EdgeShape.I ? 0 : clamp(amount, -1, 1);
  const direction = Math.abs(Math.trunc(edgeShapeId)) % 2 ? -1 : 1;
  const signed = bend * direction;
  let control1 = { x: 0.28, y: signed * 0.42 };
  let control2 = { x: 0.72, y: -signed * 0.42 };

  if (shapeClass === EdgeShape.U) {
    control1 = { x: 0.28, y: signed * 0.38 };
    control2 = { x: 0.72, y: signed * 0.38 };
  } else if (shapeClass === EdgeShape.S) {
    control2 = { x: 1 - control1.x, y: -control1.y };
  } else if (shapeClass === EdgeShape.I) {
    control1 = { x: 1 / 3, y: 0 };
    control2 = { x: 2 / 3, y: 0 };
  }

  const count = Math.max(1, Math.trunc(samples));
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    points.push(cubicPoint(
      { x: 0, y: 0 },
      control1,
      control2,
      { x: 1, y: 0 },
      index / count,
    ));
  }
  points[0] = { x: 0, y: 0 };
  points[points.length - 1] = { x: 1, y: 0 };
  return points;
}

function pointKey(point) {
  return `${Math.round(point.x * KEY_PRECISION)},${Math.round(point.y * KEY_PRECISION)}`;
}

function moduloKey(value) {
  const rounded = Math.round(value * KEY_PRECISION);
  return ((rounded % KEY_PRECISION) + KEY_PRECISION) % KEY_PRECISION;
}

function boundsOverlap(first, second, margin = 0) {
  return !(
    first.maxX < second.minX - margin
    || first.minX > second.maxX + margin
    || first.maxY < second.minY - margin
    || first.minY > second.maxY + margin
  );
}

function pointsBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return points.reduce(
    (total, point) => ({
      x: total.x + point.x / points.length,
      y: total.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
}

function appendDistinct(target, points) {
  for (const point of points) {
    const previous = target[target.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-7) {
      target.push(point);
    }
  }
}

function configuredTiling(type, parameters) {
  const info = tilingInfo(type);
  const tiling = new IsohedralTiling(info.type);
  const requested = Array.isArray(parameters)
    ? parameters.map(Number)
    : info.defaultParameters;
  if (
    requested.length === info.defaultParameters.length
    && requested.every(Number.isFinite)
  ) {
    tiling.setParameters(requested);
  }
  return { info, tiling };
}

function resolvedEdgeCurves(info, tiling, edgeCurves, curve = 0) {
  return Array.from({ length: tiling.numEdgeShapes() }, (_, index) => {
    if (info.edgeShapes[index] === EdgeShape.I) return 0;
    const requested = Array.isArray(edgeCurves) ? Number(edgeCurves[index]) : Number(curve);
    return clamp(Number.isFinite(requested) ? requested : 0, -1, 1);
  });
}

/** Safe range used by both native parameter sliders and vertex dragging. */
export function tilingParameterRange(type, index) {
  const info = tilingInfo(type);
  const center = info.defaultParameters[index];
  if (!Number.isFinite(center)) return { min: 0, max: 0 };
  const span = info.type === 1 ? 0.25 : 0.35;
  return { min: center - span, max: center + span };
}

/** Build one editable prototile without repeating it into a lattice. */
export function buildPrototile({
  type = DEFAULT_TYPE,
  parameters,
  edgeCurves,
  curve = 0,
} = {}) {
  const { info, tiling } = configuredTiling(type, parameters);
  const bends = resolvedEdgeCurves(info, tiling, edgeCurves, curve);
  const outline = [];
  const edges = [];
  let edgeIndex = 0;
  for (const segment of tiling.shape()) {
    const points = edgeCurve(
      segment.shape,
      bends[segment.id],
      segment.id,
    ).map((point) => mul(segment.T, point));
    if (segment.rev) points.reverse();
    appendDistinct(outline, points);
    edges.push({
      edgeIndex,
      edgeShapeId: segment.id,
      edgeShape: segment.shape,
      points,
    });
    edgeIndex += 1;
  }
  if (outline.length > 2) {
    const first = outline[0];
    const last = outline[outline.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-7) outline.pop();
  }
  const vertices = tiling.vertices();
  return {
    type: info.type,
    info,
    parameters: tiling.getParameters(),
    edgeCurves: bends,
    vertices,
    outline,
    edges,
    bounds: pointsBounds([...outline, ...vertices]),
  };
}

/**
 * Project a dragged corner onto the legal parameter space for its IH family.
 * Tactile's vertices are linear in the native parameters; a damped
 * minimum-norm solve preserves that structure when a drag is underdetermined.
 */
export function parametersForDraggedVertex({
  type = DEFAULT_TYPE,
  parameters,
  vertexIndex = 0,
  target,
} = {}) {
  const { info, tiling } = configuredTiling(type, parameters);
  const current = tiling.getParameters();
  if (!current.length || !target) return current;
  const vertices = tiling.vertices();
  const index = Math.trunc(Number(vertexIndex));
  const vertex = vertices[index];
  if (!vertex || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return current;

  const jacobian = current.map((value, parameterIndex) => {
    const range = tilingParameterRange(info.type, parameterIndex);
    const direction = value + 1e-5 <= range.max ? 1 : -1;
    const step = direction * 1e-5;
    const probeParameters = [...current];
    probeParameters[parameterIndex] += step;
    const probe = new IsohedralTiling(info.type);
    probe.setParameters(probeParameters);
    const moved = probe.vertices()[index];
    return {
      x: (moved.x - vertex.x) / step,
      y: (moved.y - vertex.y) / step,
    };
  });

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const derivative of jacobian) {
    xx += derivative.x * derivative.x;
    xy += derivative.x * derivative.y;
    yy += derivative.y * derivative.y;
  }
  const damping = 1e-8;
  xx += damping;
  yy += damping;
  const determinant = xx * yy - xy * xy;
  if (Math.abs(determinant) < EPSILON) return current;

  const deltaX = target.x - vertex.x;
  const deltaY = target.y - vertex.y;
  const solveX = (yy * deltaX - xy * deltaY) / determinant;
  const solveY = (xx * deltaY - xy * deltaX) / determinant;
  return current.map((value, parameterIndex) => {
    const range = tilingParameterRange(info.type, parameterIndex);
    const delta = jacobian[parameterIndex].x * solveX
      + jacobian[parameterIndex].y * solveY;
    return clamp(value + delta, range.min, range.max);
  });
}

function translatedBounds(bounds, period, margin) {
  return {
    minX: Math.min(bounds.minX, bounds.minX + period.x) - margin,
    minY: Math.min(bounds.minY, bounds.minY + period.y) - margin,
    maxX: Math.max(bounds.maxX, bounds.maxX + period.x) + margin,
    maxY: Math.max(bounds.maxY, bounds.maxY + period.y) + margin,
  };
}

/**
 * Build a visible tiling plus one full translation period of extra geometry.
 * `scale` is the approximate world-space tile size.
 */
export function buildLattice({
  type = DEFAULT_TYPE,
  parameters,
  edgeCurves,
  curve = 0,
  scale = 0.28,
  alignPeriodToDegrees = 180,
  bounds = { minX: -1.5, minY: -1, maxX: 1.5, maxY: 1 },
} = {}) {
  const { info, tiling } = configuredTiling(type, parameters);

  const tileScale = clamp(scale, 0.08, 0.65);
  const naturalCenter = centroid(tiling.vertices());
  const worldCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const translations = [tiling.getT1(), tiling.getT2()];
  const lengths = translations.map((point) => Math.hypot(point.x, point.y));
  const periodAxis = lengths[1] > EPSILON && lengths[1] < lengths[0] ? 1 : 0;
  const naturalPeriod = translations[periodAxis];
  const desiredAngle = (Number(alignPeriodToDegrees) * Math.PI) / 180;
  const rotation = desiredAngle - Math.atan2(naturalPeriod.y, naturalPeriod.x);
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const rotate = (point) => ({
    x: point.x * cosRotation - point.y * sinRotation,
    y: point.x * sinRotation + point.y * cosRotation,
  });
  const unrotate = (point) => ({
    x: point.x * cosRotation + point.y * sinRotation,
    y: -point.x * sinRotation + point.y * cosRotation,
  });
  const worldPoint = (point) => {
    const rotated = rotate({
      x: (point.x - naturalCenter.x) * tileScale,
      y: (point.y - naturalCenter.y) * tileScale,
    });
    return { x: worldCenter.x + rotated.x, y: worldCenter.y + rotated.y };
  };
  const period = rotate({
    x: naturalPeriod.x * tileScale,
    y: naturalPeriod.y * tileScale,
  });
  const sourceBounds = translatedBounds(bounds, period, tileScale * 1.5);

  const naturalCorners = [
    { x: sourceBounds.minX, y: sourceBounds.minY },
    { x: sourceBounds.maxX, y: sourceBounds.minY },
    { x: sourceBounds.maxX, y: sourceBounds.maxY },
    { x: sourceBounds.minX, y: sourceBounds.maxY },
  ].map((point) => {
    const natural = unrotate({
      x: (point.x - worldCenter.x) / tileScale,
      y: (point.y - worldCenter.y) / tileScale,
    });
    return { x: natural.x + naturalCenter.x, y: natural.y + naturalCenter.y };
  });
  const naturalBounds = pointsBounds(naturalCorners);
  const instances = [];
  const seenInstances = new Set();
  for (const instance of tiling.fillRegionBounds(
    naturalBounds.minX - 3,
    naturalBounds.minY - 3,
    naturalBounds.maxX + 3,
    naturalBounds.maxY + 3,
  )) {
    const key = `${instance.t1},${instance.t2},${instance.aspect}`;
    if (seenInstances.has(key)) continue;
    seenInstances.add(key);
    instances.push(instance);
  }

  const bends = resolvedEdgeCurves(info, tiling, edgeCurves, curve);
  const curves = new Map();
  const curveFor = (segment) => {
    const key = `${segment.id}:${segment.shape}`;
    if (!curves.has(key)) {
      curves.set(key, edgeCurve(segment.shape, bends[segment.id], segment.id));
    }
    return curves.get(key);
  };

  const determinant = translations[0].x * translations[1].y
    - translations[0].y * translations[1].x;
  const periodicPointKey = (point) => {
    if (Math.abs(determinant) < EPSILON) return pointKey(point);
    const first = (point.x * translations[1].y - point.y * translations[1].x) / determinant;
    const second = (translations[0].x * point.y - translations[0].y * point.x) / determinant;
    return periodAxis === 0
      ? `${moduloKey(first)},${Math.round(second * KEY_PRECISION)}`
      : `${Math.round(first * KEY_PRECISION)},${moduloKey(second)}`;
  };

  const allTiles = [];
  const allEdges = new Map();
  for (const instance of instances) {
    const outline = [];
    let edgeIndex = 0;
    for (const segment of tiling.shape()) {
      const transform = mul(instance.T, segment.T);
      const naturalPoints = curveFor(segment).map((point) => mul(transform, point));
      if (segment.rev) naturalPoints.reverse();
      const worldPoints = naturalPoints.map(worldPoint);
      appendDistinct(outline, worldPoints);

      const firstKey = pointKey(naturalPoints[0]);
      const lastKey = pointKey(naturalPoints[naturalPoints.length - 1]);
      if (firstKey !== lastKey) {
        const reversed = firstKey > lastKey;
        const key = reversed ? `${lastKey}|${firstKey}` : `${firstKey}|${lastKey}`;
        const periodicFirst = periodicPointKey(naturalPoints[0]);
        const periodicLast = periodicPointKey(naturalPoints[naturalPoints.length - 1]);
        const periodicKey = periodicFirst > periodicLast
          ? `${periodicLast}|${periodicFirst}`
          : `${periodicFirst}|${periodicLast}`;
        const claim = `${instance.t1},${instance.t2},${instance.aspect},${edgeIndex}`;
        const existing = allEdges.get(key);
        if (existing) {
          existing.claims.push(claim);
        } else {
          const points = reversed ? worldPoints.slice().reverse() : worldPoints;
          allEdges.set(key, {
            key,
            periodicKey,
            points,
            bounds: pointsBounds(points),
            aspect: instance.aspect,
            edgeIndex,
            edgeShapeId: segment.id,
            edgeShape: segment.shape,
            claims: [claim],
          });
        }
      }
      edgeIndex += 1;
    }

    if (outline.length > 2) {
      const first = outline[0];
      const last = outline[outline.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-7) outline.pop();
    }
    const tileBounds = pointsBounds(outline);
    if (boundsOverlap(tileBounds, sourceBounds, tileScale * 0.1)) {
      allTiles.push({
        points: outline,
        bounds: tileBounds,
        color: Math.abs(instance.aspect),
        aspect: instance.aspect,
      });
    }
  }

  const edges = [...allEdges.values()].filter((edge) => (
    boundsOverlap(edge.bounds, sourceBounds, tileScale * 0.1)
  ));

  return {
    type: info.type,
    info,
    parameters: tiling.getParameters(),
    edgeCurves: bends,
    scale: tileScale,
    bounds: { ...bounds },
    sourceBounds,
    period,
    periodAxis,
    tiles: allTiles,
    edges,
  };
}

/** The exact background translation for one normalized playback phase. */
export function latticeOffsetForPhase(lattice, phase = 0) {
  const amount = Number.isFinite(Number(phase)) ? Number(phase) : 0;
  return {
    x: -lattice.period.x * amount || 0,
    y: -lattice.period.y * amount || 0,
  };
}

/** Build an arbitrary-angle line at a normalized position through the field. */
export function createScanLine(bounds, position = 0.5, angleDegrees = 90) {
  const radians = (Number(angleDegrees) * Math.PI) / 180;
  const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -tangent.y, y: tangent.x };
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const halfHeight = (bounds.maxY - bounds.minY) / 2;
  const support = Math.abs(normal.x) * halfWidth + Math.abs(normal.y) * halfHeight;
  const tangentSupport = Math.abs(tangent.x) * halfWidth + Math.abs(tangent.y) * halfHeight;
  const linePosition = clamp(Number(position), 0, 1);
  const offset = (linePosition * 2 - 1) * support;
  return {
    position: linePosition,
    angleDegrees: ((Number(angleDegrees) % 180) + 180) % 180,
    tangent,
    normal,
    center,
    support,
    tangentSupport,
    origin: {
      x: center.x + normal.x * offset,
      y: center.y + normal.y * offset,
    },
  };
}

function intersectSegmentWithLine(start, end, scan) {
  const distanceStart = (start.x - scan.origin.x) * scan.normal.x
    + (start.y - scan.origin.y) * scan.normal.y;
  const distanceEnd = (end.x - scan.origin.x) * scan.normal.x
    + (end.y - scan.origin.y) * scan.normal.y;
  const denominator = distanceStart - distanceEnd;
  if (Math.abs(denominator) < EPSILON || distanceStart * distanceEnd > 0) return null;
  const amount = distanceStart / denominator;
  if (amount < -EPSILON || amount > 1 + EPSILON) return null;
  return {
    x: lerp(start.x, end.x, amount),
    y: lerp(start.y, end.y, amount),
    amount: clamp(amount, 0, 1),
  };
}

function contactForSegment(edge, segmentIndex, scan) {
  const start = edge.points[segmentIndex];
  const end = edge.points[segmentIndex + 1];
  const point = intersectSegmentWithLine(start, end, scan);
  if (!point) return null;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < EPSILON) return null;
  const tangent = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  };
  const edgeNormal = { x: -tangent.y, y: tangent.x };
  const along = (point.x - scan.center.x) * scan.tangent.x
    + (point.y - scan.center.y) * scan.tangent.y;
  let angle = Math.atan2(tangent.y, tangent.x);
  angle = ((angle % Math.PI) + Math.PI) % Math.PI;
  return {
    ...point,
    along,
    along01: clamp(along / Math.max(scan.tangentSupport * 2, EPSILON) + 0.5, 0, 1),
    incidence: clamp(Math.abs(
      scan.normal.x * edgeNormal.x + scan.normal.y * edgeNormal.y
    ), 0, 1),
    orientation: angle / Math.PI,
    tangent,
    edgeKey: edge.key,
    voiceKey: edge.periodicKey,
    aspect: edge.aspect,
    edgeIndex: edge.edgeIndex,
    edgeShapeId: edge.edgeShapeId,
    segmentIndex,
  };
}

function mergeContact(group) {
  const strongest = group.reduce((best, contact) => (
    contact.incidence > best.incidence ? contact : best
  ));
  const edgeKeys = [...new Set(group.map((contact) => contact.edgeKey))].sort();
  const voiceKeys = [...new Set(group.map((contact) => contact.voiceKey))].sort();
  return {
    ...strongest,
    x: group.reduce((sum, contact) => sum + contact.x, 0) / group.length,
    y: group.reduce((sum, contact) => sum + contact.y, 0) / group.length,
    edgeKeys,
    voiceKey: voiceKeys.join("&"),
  };
}

/** Intersect one scan line with the translated edge net and merge vertex hits. */
export function contactsForLine(
  lattice,
  scan,
  tolerance = lattice.scale * 0.018,
  offset = { x: 0, y: 0 },
) {
  const translation = {
    x: Number(offset?.x) || 0,
    y: Number(offset?.y) || 0,
  };
  const baseScan = {
    ...scan,
    center: {
      x: scan.center.x - translation.x,
      y: scan.center.y - translation.y,
    },
    origin: {
      x: scan.origin.x - translation.x,
      y: scan.origin.y - translation.y,
    },
  };
  const raw = [];
  for (const edge of lattice.edges) {
    for (let index = 0; index + 1 < edge.points.length; index += 1) {
      const contact = contactForSegment(edge, index, baseScan);
      if (contact) raw.push(contact);
    }
  }

  raw.sort((first, second) => first.along - second.along);
  const groups = [];
  const mergeDistance = Math.max(EPSILON, tolerance);
  for (const contact of raw) {
    let group = null;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      const anchor = candidate[0];
      if (contact.along - anchor.along > mergeDistance * 2) break;
      if (Math.hypot(contact.x - anchor.x, contact.y - anchor.y) <= mergeDistance) {
        group = candidate;
        break;
      }
    }
    if (group) group.push(contact);
    else groups.push([contact]);
  }

  return groups
    .map(mergeContact)
    .map((contact) => ({
      ...contact,
      x: contact.x + translation.x,
      y: contact.y + translation.y,
    }))
    .sort((first, second) => first.along - second.along);
}

/** Keep an even spatial sample when a dense line exceeds the voice budget. */
export function evenlySelectContacts(contacts, count) {
  const limit = Math.max(0, Math.trunc(Number(count) || 0));
  if (limit === 0) return [];
  if (contacts.length <= limit) return [...contacts];
  if (limit === 1) return [contacts[Math.floor(contacts.length / 2)]];
  return Array.from({ length: limit }, (_, index) => (
    contacts[Math.round((index * (contacts.length - 1)) / (limit - 1))]
  ));
}

/** Same-sine onset emphasis for a newly intersected edge. */
export function intersectionAccentMultiplier(ageSeconds, amount = 0.65) {
  const age = Math.max(0, Number(ageSeconds) || 0);
  return 1 + 1.25 * clamp(Number(amount) || 0, 0, 1) * Math.exp(-age / 0.14);
}
