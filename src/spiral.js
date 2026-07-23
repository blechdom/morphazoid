/** Log-polar isohedral tessellation and reader geometry for Spiral. */

import {
  EdgeShape,
  IsohedralTiling,
  mul,
} from "../vendor/tactile/tactile.js";
import {
  clamp,
  edgeCurve,
  tilingInfo,
} from "./lattice.js";

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const KEY_PRECISION = 1e5;
const DEFAULT_BOUNDS = Object.freeze({
  innerRadius: 0.045,
  outerRadius: 1.08,
});
export const SPIRAL_ZOOM_DEPTH = Math.log(
  DEFAULT_BOUNDS.outerRadius / DEFAULT_BOUNDS.innerRadius,
);

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pointKey(point) {
  return `${Math.round(point.x * KEY_PRECISION)},${Math.round(point.y * KEY_PRECISION)}`;
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

function boundsOverlap(first, second, margin = 0) {
  return !(
    first.maxX < second.minX - margin
    || first.minX > second.maxX + margin
    || first.maxY < second.minY - margin
    || first.minY > second.maxY + margin
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
  const requested = Array.isArray(parameters) ? parameters.map(Number) : info.defaultParameters;
  if (
    requested.length === info.defaultParameters.length
    && requested.every(Number.isFinite)
  ) tiling.setParameters(requested);
  return { info, tiling };
}

function resolvedEdgeCurves(info, tiling, edgeCurves) {
  return Array.from({ length: tiling.numEdgeShapes() }, (_, index) => {
    if (info.edgeShapes[index] === EdgeShape.I) return 0;
    const requested = Number(edgeCurves?.[index]);
    return clamp(Number.isFinite(requested) ? requested : 0, -1, 1);
  });
}

export function spiralPoint(logPoint) {
  const radius = Math.exp(logPoint.x);
  return {
    x: radius * Math.cos(logPoint.y),
    y: radius * Math.sin(logPoint.y),
  };
}

/** A constant-speed deep zoom that reverses only at the stage's full radial span. */
export function spiralLoopLogOffset(phase, amplitude = SPIRAL_ZOOM_DEPTH) {
  const numericPhase = Number(phase);
  const numericAmplitude = Number(amplitude);
  const position = Number.isFinite(numericPhase) ? wrap01(numericPhase) : 0;
  const scale = Number.isFinite(numericAmplitude) ? numericAmplitude : SPIRAL_ZOOM_DEPTH;
  if (position < EPSILON || 1 - position < EPSILON) return 0;
  return (position <= 0.5 ? position * 2 : (1 - position) * 2) * scale;
}

/** Stable pitch color for a contact's edge class and isohedral tile aspect. */
export function shapePitchForSpiralContact(contact = {}) {
  const edgeShape = Math.trunc(Number(contact.edgeShapeId) || 0);
  const aspect = Math.trunc(Number(contact.aspect) || 0);
  const edge = Math.trunc(Number(contact.edgeIndex) || 0);
  const pitchClass = ((edgeShape * 5 + aspect * 3 + edge * 7) % 12 + 12) % 12;
  return pitchClass / 11;
}

/** Let angle lead the pitch while tile/edge identity separates each contact. */
export function angleShapePitchForSpiralContact(contact = {}) {
  const angle = wrap01(Number(contact.angle01) || 0);
  const shape = shapePitchForSpiralContact(contact);
  return wrap01(angle * 0.72 + shape * 0.34);
}

/** Similarity transform that sends A*T1 + B*T2 to one complete angular turn. */
export function createSpiralTransform({
  firstTranslation,
  secondTranslation,
  spiralA = 1,
  spiralB = 5,
  logOffset = 0,
  angleOffset = 0,
}) {
  let a = Math.trunc(Number(spiralA) || 0);
  let b = Math.trunc(Number(spiralB) || 0);
  let period = {
    x: a * firstTranslation.x + b * secondTranslation.x,
    y: a * firstTranslation.y + b * secondTranslation.y,
  };
  if (Math.hypot(period.x, period.y) < EPSILON) {
    a = 1;
    b = 0;
    period = { ...firstTranslation };
  }
  const periodLength = Math.max(EPSILON, Math.hypot(period.x, period.y));
  const rotation = Math.PI / 2 - Math.atan2(period.y, period.x);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const scale = TAU / periodLength;
  const mapNatural = (point) => ({
    x: (point.x * cosine - point.y * sine) * scale + logOffset,
    y: (point.x * sine + point.y * cosine) * scale + angleOffset,
  });
  const mapLogToNatural = (point) => {
    const x = (point.x - logOffset) / scale;
    const y = (point.y - angleOffset) / scale;
    return {
      x: x * cosine + y * sine,
      y: -x * sine + y * cosine,
    };
  };
  return {
    spiralA: a,
    spiralB: b,
    period,
    scale,
    rotation,
    logOffset,
    angleOffset,
    mapNatural,
    mapLogToNatural,
  };
}

/** Build one visible, deduplicated spiral tessellation from editable IH tile data. */
export function buildSpiralTessellation({
  type = 20,
  parameters,
  edgeCurves,
  spiralA = 1,
  spiralB = 5,
  logOffset = 0,
  angleOffset = 0,
  loopPhase = 0,
  innerRadius = DEFAULT_BOUNDS.innerRadius,
  outerRadius = DEFAULT_BOUNDS.outerRadius,
  maxTiles = 900,
} = {}) {
  const { info, tiling } = configuredTiling(type, parameters);
  const bounds = {
    innerRadius: clamp(Number(innerRadius) || DEFAULT_BOUNDS.innerRadius, 0.02, 0.3),
    outerRadius: clamp(Number(outerRadius) || DEFAULT_BOUNDS.outerRadius, 0.7, 1.5),
  };
  const loopOffset = spiralLoopLogOffset(loopPhase);
  const transform = createSpiralTransform({
    firstTranslation: tiling.getT1(),
    secondTranslation: tiling.getT2(),
    spiralA,
    spiralB,
    logOffset: Number(logOffset) + loopOffset,
    angleOffset,
  });
  const logInner = Math.log(bounds.innerRadius);
  const logOuter = Math.log(bounds.outerRadius);
  const margin = Math.min(1.4, Math.max(0.35, transform.scale * 0.8));
  const domainCorners = [
    { x: logInner - margin, y: -Math.PI - margin },
    { x: logOuter + margin, y: -Math.PI - margin },
    { x: logOuter + margin, y: Math.PI + margin },
    { x: logInner - margin, y: Math.PI + margin },
  ].map(transform.mapLogToNatural);
  const naturalBounds = pointsBounds(domainCorners);
  const instances = [];
  for (const instance of tiling.fillRegionBounds(
    naturalBounds.minX - 3,
    naturalBounds.minY - 3,
    naturalBounds.maxX + 3,
    naturalBounds.maxY + 3,
  )) {
    instances.push(instance);
    if (instances.length >= Math.max(50, Math.trunc(maxTiles))) break;
  }

  const bends = resolvedEdgeCurves(info, tiling, edgeCurves);
  const curveCache = new Map();
  const curveFor = (segment) => {
    const key = `${segment.id}:${segment.shape}`;
    if (!curveCache.has(key)) {
      curveCache.set(key, edgeCurve(segment.shape, bends[segment.id], segment.id, 10));
    }
    return curveCache.get(key);
  };
  const visibleBounds = {
    minX: -bounds.outerRadius * 1.08,
    minY: -bounds.outerRadius * 1.08,
    maxX: bounds.outerRadius * 1.08,
    maxY: bounds.outerRadius * 1.08,
  };
  const tiles = [];
  const tileKeys = new Set();
  const edgeMap = new Map();

  for (const instance of instances) {
    const outline = [];
    let edgeIndex = 0;
    for (const segment of tiling.shape()) {
      const naturalTransform = mul(instance.T, segment.T);
      const points = curveFor(segment).map((point) => {
        const natural = mul(naturalTransform, point);
        const logPoint = transform.mapNatural(natural);
        return { ...spiralPoint(logPoint), logRadius: logPoint.x, angle: logPoint.y };
      });
      if (segment.rev) points.reverse();
      appendDistinct(outline, points);
      const edgeBounds = pointsBounds(points);
      if (boundsOverlap(edgeBounds, visibleBounds, 0.04)) {
        const firstKey = pointKey(points[0]);
        const lastKey = pointKey(points[points.length - 1]);
        const key = firstKey < lastKey
          ? `${firstKey}|${lastKey}`
          : `${lastKey}|${firstKey}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            key,
            periodicKey: `${instance.t1}:${instance.t2}:${instance.aspect}:${edgeIndex}`,
            points,
            bounds: edgeBounds,
            aspect: instance.aspect,
            edgeIndex,
            edgeShapeId: segment.id,
            edgeShape: segment.shape,
          });
        }
      }
      edgeIndex += 1;
    }
    if (outline.length > 2) {
      const tileBounds = pointsBounds(outline);
      if (boundsOverlap(tileBounds, visibleBounds, 0.04)) {
        const key = outline.map(pointKey).sort().join("|");
        if (!tileKeys.has(key)) {
          tileKeys.add(key);
          tiles.push({
            key,
            points: outline,
            bounds: tileBounds,
            aspect: instance.aspect,
            color: Math.abs(instance.aspect) % 4,
          });
        }
      }
    }
  }

  return {
    type: info.type,
    info,
    parameters: tiling.getParameters(),
    edgeCurves: bends,
    transform,
    bounds,
    logInner,
    logOuter,
    scale: bounds.outerRadius * 0.012,
    tiles,
    edges: [...edgeMap.values()],
  };
}

/**
 * Couple a contact's audible rate to its visible log-polar scale. Smaller
 * inner shapes run up to twice as fast/high; larger outer shapes run down to
 * half speed/pitch, with the geometric middle left unchanged.
 */
export function scaleRateForSpiralRadius(
  radius,
  innerRadius = DEFAULT_BOUNDS.innerRadius,
  outerRadius = DEFAULT_BOUNDS.outerRadius,
) {
  const inner = clamp(Number(innerRadius) || DEFAULT_BOUNDS.innerRadius, 0.02, 0.3);
  const outer = clamp(Number(outerRadius) || DEFAULT_BOUNDS.outerRadius, 0.7, 1.5);
  const low = Math.min(inner, outer);
  const high = Math.max(inner, outer);
  const numericRadius = Number(radius);
  const contactRadius = clamp(
    Number.isFinite(numericRadius) ? numericRadius : Math.sqrt(low * high),
    low,
    high,
  );
  const sizePosition = clamp(
    (Math.log(contactRadius) - Math.log(low))
      / Math.max(EPSILON, Math.log(high) - Math.log(low)),
    0,
    1,
  );
  return 2 ** (1 - 2 * sizePosition);
}

export function createSpiralReader({
  mode = "radius",
  phase = 0,
  innerRadius = DEFAULT_BOUNDS.innerRadius,
  outerRadius = DEFAULT_BOUNDS.outerRadius,
  turns = 2,
  sizeCoupled = false,
} = {}) {
  const position = clamp(Number(phase) || 0, 0, 1);
  const inner = clamp(Number(innerRadius) || DEFAULT_BOUNDS.innerRadius, 0.02, 0.3);
  const outer = clamp(Number(outerRadius) || DEFAULT_BOUNDS.outerRadius, 0.7, 1.5);
  const logInner = Math.log(inner);
  const logOuter = Math.log(outer);
  const readerMode = ["radius", "angle", "spiral"].includes(mode) ? mode : "radius";
  const points = [];

  if (readerMode === "radius") {
    const radius = sizeCoupled
      ? lerp(outer, inner, position)
      : Math.exp(lerp(logOuter, logInner, position));
    const samples = 128;
    for (let index = 0; index <= samples; index += 1) {
      const angle = index / samples * TAU;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  } else if (readerMode === "angle") {
    const angle = -Math.PI / 2 - position * TAU;
    points.push(
      { x: Math.cos(angle) * inner, y: Math.sin(angle) * inner },
      { x: Math.cos(angle) * outer, y: Math.sin(angle) * outer },
    );
  } else {
    const winding = clamp(Number(turns) || 2, 0.25, 6);
    const samples = 144;
    for (let index = 0; index <= samples; index += 1) {
      const amount = index / samples;
      const radius = Math.exp(lerp(logOuter, logInner, amount));
      const angle = -Math.PI / 2 - position * TAU + amount * winding * TAU;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }

  return {
    mode: readerMode,
    phase: position,
    turns: clamp(Number(turns) || 2, 0.25, 6),
    sizeCoupled: Boolean(sizeCoupled),
    innerRadius: inner,
    outerRadius: outer,
    points,
  };
}

function segmentIntersection(firstStart, firstEnd, secondStart, secondEnd) {
  const first = { x: firstEnd.x - firstStart.x, y: firstEnd.y - firstStart.y };
  const second = { x: secondEnd.x - secondStart.x, y: secondEnd.y - secondStart.y };
  const determinant = first.x * second.y - first.y * second.x;
  if (Math.abs(determinant) < EPSILON) return null;
  const delta = { x: secondStart.x - firstStart.x, y: secondStart.y - firstStart.y };
  const firstAmount = (delta.x * second.y - delta.y * second.x) / determinant;
  const secondAmount = (delta.x * first.y - delta.y * first.x) / determinant;
  if (
    firstAmount < -EPSILON || firstAmount > 1 + EPSILON
    || secondAmount < -EPSILON || secondAmount > 1 + EPSILON
  ) return null;
  return {
    x: firstStart.x + first.x * firstAmount,
    y: firstStart.y + first.y * firstAmount,
    firstAmount: clamp(firstAmount, 0, 1),
    secondAmount: clamp(secondAmount, 0, 1),
  };
}

/** Intersect the visible spiral edge net with any intrinsic reader path. */
export function contactsForSpiralReader(tessellation, reader, tolerance = tessellation.scale * 0.8) {
  const readerSegments = [];
  let readerLength = 0;
  for (let index = 0; index + 1 < reader.points.length; index += 1) {
    const start = reader.points[index];
    const end = reader.points[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    readerSegments.push({
      start,
      end,
      length,
      along: readerLength,
      bounds: pointsBounds([start, end]),
    });
    readerLength += length;
  }

  const contacts = [];
  for (const edge of tessellation.edges) {
    for (let edgeIndex = 0; edgeIndex + 1 < edge.points.length; edgeIndex += 1) {
      const edgeStart = edge.points[edgeIndex];
      const edgeEnd = edge.points[edgeIndex + 1];
      const edgeBounds = pointsBounds([edgeStart, edgeEnd]);
      const edgeLength = Math.hypot(edgeEnd.x - edgeStart.x, edgeEnd.y - edgeStart.y);
      if (edgeLength < EPSILON) continue;
      for (let readerIndex = 0; readerIndex < readerSegments.length; readerIndex += 1) {
        const readerSegment = readerSegments[readerIndex];
        if (!boundsOverlap(edgeBounds, readerSegment.bounds, tolerance)) continue;
        const point = segmentIntersection(
          edgeStart,
          edgeEnd,
          readerSegment.start,
          readerSegment.end,
        );
        if (!point || readerSegment.length < EPSILON) continue;
        const edgeTangent = {
          x: (edgeEnd.x - edgeStart.x) / edgeLength,
          y: (edgeEnd.y - edgeStart.y) / edgeLength,
        };
        const readerTangent = {
          x: (readerSegment.end.x - readerSegment.start.x) / readerSegment.length,
          y: (readerSegment.end.y - readerSegment.start.y) / readerSegment.length,
        };
        let orientation = Math.atan2(edgeTangent.y, edgeTangent.x);
        orientation = ((orientation % Math.PI) + Math.PI) % Math.PI;
        const angle = Math.atan2(point.y, point.x);
        contacts.push({
          x: point.x,
          y: point.y,
          radius: Math.hypot(point.x, point.y),
          angle,
          angle01: wrap01((angle + Math.PI) / TAU),
          along: readerSegment.along + readerSegment.length * point.secondAmount,
          along01: (readerSegment.along + readerSegment.length * point.secondAmount)
            / Math.max(readerLength, EPSILON),
          incidence: Math.abs(
            edgeTangent.x * readerTangent.y - edgeTangent.y * readerTangent.x
          ),
          orientation: orientation / Math.PI,
          edgeKey: edge.key,
          voiceKey: edge.periodicKey,
          aspect: edge.aspect,
          edgeIndex: edge.edgeIndex,
          edgeShapeId: edge.edgeShapeId,
          segmentIndex: edgeIndex,
          readerSegmentIndex: readerIndex,
        });
      }
    }
  }

  contacts.sort((first, second) => first.along - second.along);
  const deduped = [];
  const mergeDistance = Math.max(EPSILON, Number(tolerance) || tessellation.scale);
  for (const contact of contacts) {
    const existing = deduped.find((candidate) => (
      Math.hypot(candidate.x - contact.x, candidate.y - contact.y) <= mergeDistance
    ));
    if (!existing) deduped.push(contact);
    else if (contact.incidence > existing.incidence) Object.assign(existing, contact);
  }
  return deduped.sort((first, second) => first.along - second.along);
}

/** Convert a world-space pointer into the selected intrinsic time coordinate. */
export function phaseForSpiralPoint(point, {
  mode = "radius",
  innerRadius = DEFAULT_BOUNDS.innerRadius,
  outerRadius = DEFAULT_BOUNDS.outerRadius,
  turns = 2,
  sizeCoupled = false,
} = {}) {
  const angle = Math.atan2(point.y, point.x);
  const radius = clamp(Math.hypot(point.x, point.y), innerRadius, outerRadius);
  const radial = mode === "radius" && sizeCoupled
    ? clamp((outerRadius - radius) / Math.max(EPSILON, outerRadius - innerRadius), 0, 1)
    : clamp(
      (Math.log(outerRadius) - Math.log(Math.max(innerRadius, radius)))
        / Math.max(EPSILON, Math.log(outerRadius) - Math.log(innerRadius)),
      0,
      1,
    );
  if (mode === "radius") return radial;
  if (mode === "spiral") {
    return wrap01((-Math.PI / 2 + radial * clamp(Number(turns) || 2, 0.25, 6) * TAU - angle) / TAU);
  }
  return wrap01((-Math.PI / 2 - angle) / TAU);
}
