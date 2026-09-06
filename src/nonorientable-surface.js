/**
 * Pure geometry and plane-slice analysis for the Möbius and Klein instruments.
 *
 * The meshes carry their topological edge identifications. This matters for
 * the Klein immersion: two sheets can occupy the same 3D point without becoming
 * adjacent in the surface or in the playhead's intersection curves.
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-8;

export const NONORIENTABLE_SURFACES = Object.freeze(["moebius", "klein"]);

export const SURFACE_LIMITS = Object.freeze({
  minimumUSegments: 12,
  maximumUSegments: 72,
  minimumVSegments: 4,
  maximumVSegments: 28,
  maximumTriangles: 4_032,
  maximumSliceSegments: 512,
  maximumVoiceComponents: 6,
});

export function clamp(value, minimum = 0, maximum = 1) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  if (!Number.isFinite(Number(value))) return low;
  return Math.min(high, Math.max(low, Number(value)));
}

export function wrap01(value) {
  const finite = Number.isFinite(Number(value)) ? Number(value) : 0;
  return ((finite % 1) + 1) % 1;
}

export function wrapSigned(value) {
  const finite = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (((finite + 1) % 2) + 2) % 2 - 1;
}

export function sanitizeSurfaceKind(kind) {
  return kind === "klein" ? "klein" : "moebius";
}

function oddHalfTwists(value) {
  const rounded = Math.round(clamp(value, 1, 7));
  return rounded % 2 === 1 ? rounded : Math.min(7, rounded + 1);
}

/**
 * Canonicalize an unwrapped longitudinal coordinate. Each completed lap flips
 * the transverse chart direction; after two laps the local frame returns.
 */
export function canonicalSurfaceCoordinates(kind, longitudinal = 0, transverse = 0) {
  const surface = sanitizeSurfaceKind(kind);
  const phase = Number.isFinite(Number(longitudinal)) ? Number(longitudinal) : 0;
  const lap = Math.floor(phase);
  const u = phase - lap;
  const orientation = Math.abs(lap) % 2 === 0 ? 1 : -1;
  const intrinsicV = surface === "klein"
    ? wrapSigned(transverse)
    : clamp(transverse, -1, 1);
  return {
    kind: surface,
    lap,
    u,
    intrinsicV,
    chartV: intrinsicV * orientation,
    orientation,
  };
}

function moebiusPoint(coordinates, options) {
  const radius = clamp(options.radius ?? 0.72, 0.48, 1.05);
  const width = clamp(options.width ?? 0.38, 0.12, 0.68);
  const fold = clamp(options.fold ?? 1, 0.35, 1.65);
  const halfTwists = oddHalfTwists(options.halfTwists ?? 1);
  const angle = coordinates.u * TAU;
  const cross = coordinates.chartV * width;
  const twistAngle = angle * halfTwists * 0.5;
  const radial = radius + cross * Math.cos(twistAngle);
  return {
    x: radial * Math.cos(angle),
    y: cross * Math.sin(twistAngle) * fold,
    z: radial * Math.sin(angle),
    halfTwists,
  };
}

/**
 * Figure-eight immersion of a Klein bottle. It intentionally self-intersects
 * in three-space; the mesh connectivity remains intrinsic to the surface.
 */
function kleinPoint(coordinates, options) {
  const radius = clamp(options.radius ?? 1.5, 1.05, 2.4);
  const width = clamp(options.width ?? 0.42, 0.18, 0.72);
  const fold = clamp(options.fold ?? 1, 0.35, 1.65);
  const u = coordinates.u * TAU;
  const v = coordinates.chartV * Math.PI;
  const halfCosine = Math.cos(u * 0.5);
  const halfSine = Math.sin(u * 0.5);
  const sinV = Math.sin(v);
  const sin2V = Math.sin(v * 2);
  const radial = radius + width * (
    halfCosine * sinV - fold * halfSine * sin2V
  );
  const vertical = width * (
    halfSine * sinV + fold * halfCosine * sin2V
  );
  const scale = 0.9 / (radius + width * 2);
  return {
    x: radial * Math.cos(u) * scale,
    y: vertical * scale * 1.38,
    z: radial * Math.sin(u) * scale,
  };
}

export function surfacePoint(kind, longitudinal = 0, transverse = 0, options = {}) {
  const coordinates = canonicalSurfaceCoordinates(kind, longitudinal, transverse);
  const point = coordinates.kind === "klein"
    ? kleinPoint(coordinates, options)
    : moebiusPoint(coordinates, options);
  return { ...point, ...coordinates };
}

function pointBounds(vertices) {
  const initial = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  return vertices.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), initial);
}

/**
 * Build a bounded mesh whose last longitudinal strip is sewn back to the first
 * with v reflected. Möbius keeps two real lateral edges; Klein also wraps v.
 */
export function buildSurfaceMesh(kind, options = {}) {
  const surface = sanitizeSurfaceKind(kind);
  const defaultU = surface === "klein" ? 56 : 52;
  const defaultV = surface === "klein" ? 20 : 14;
  const uSegments = Math.round(clamp(
    options.uSegments ?? defaultU,
    SURFACE_LIMITS.minimumUSegments,
    SURFACE_LIMITS.maximumUSegments,
  ));
  const vSegments = Math.round(clamp(
    options.vSegments ?? defaultV,
    SURFACE_LIMITS.minimumVSegments,
    SURFACE_LIMITS.maximumVSegments,
  ));
  const vCount = surface === "klein" ? vSegments : vSegments + 1;
  const vertices = [];
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    const longitudinal = uIndex / uSegments;
    for (let vIndex = 0; vIndex < vCount; vIndex += 1) {
      const transverse = -1 + vIndex / vSegments * 2;
      vertices.push({
        ...surfacePoint(surface, longitudinal, transverse, options),
        uIndex,
        vIndex,
      });
    }
  }

  const at = (uIndex, vIndex) => uIndex * vCount + vIndex;
  const reflectedVIndex = (vIndex) => surface === "klein"
    ? (vSegments - vIndex) % vSegments
    : vSegments - vIndex;
  const triangles = [];
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    const nextU = (uIndex + 1) % uSegments;
    const seam = uIndex === uSegments - 1;
    for (let vIndex = 0; vIndex < vSegments; vIndex += 1) {
      const nextV = surface === "klein" ? (vIndex + 1) % vSegments : vIndex + 1;
      const nextA = seam ? reflectedVIndex(vIndex) : vIndex;
      const nextB = seam ? reflectedVIndex(nextV) : nextV;
      const a = at(uIndex, vIndex);
      const b = at(nextU, nextA);
      const c = at(nextU, nextB);
      const d = at(uIndex, nextV);
      triangles.push(
        { a, b, c, seam },
        { a, b: c, c: d, seam },
      );
    }
  }

  return {
    kind: surface,
    uSegments,
    vSegments,
    vCount,
    vertices,
    triangles,
    bounds: pointBounds(vertices),
  };
}

function dot(normal, point) {
  return normal.x * point.x + normal.y * point.y + normal.z * point.z;
}
function normalizedPlaneNormal(normal) {
  const finiteAxis = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const safe = {
    x: finiteAxis(normal?.x),
    y: finiteAxis(normal?.y),
    z: finiteAxis(normal?.z),
  };
  const magnitude = Math.hypot(safe.x, safe.y, safe.z) || 1;
  safe.x /= magnitude;
  safe.y /= magnitude;
  safe.z /= magnitude;
  return safe;
}

function interpolateVertex(a, b, amount) {
  const t = clamp(amount, 0, 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    intrinsicV: a.intrinsicV + (b.intrinsicV - a.intrinsicV) * t,
    chartV: a.chartV + (b.chartV - a.chartV) * t,
    u: a.u + (b.u - a.u) * t,
  };
}

function intersectionOnEdge(vertices, firstIndex, secondIndex, firstDistance, secondDistance, epsilon) {
  const first = vertices[firstIndex];
  const second = vertices[secondIndex];
  if (Math.abs(firstDistance) <= epsilon) {
    return { key: "v:" + firstIndex, point: { ...first } };
  }
  if (Math.abs(secondDistance) <= epsilon) {
    return { key: "v:" + secondIndex, point: { ...second } };
  }
  if (firstDistance * secondDistance >= 0) return null;
  const amount = firstDistance / (firstDistance - secondDistance);
  const low = Math.min(firstIndex, secondIndex);
  const high = Math.max(firstIndex, secondIndex);
  return {
    key: "e:" + low + ":" + high,
    point: interpolateVertex(first, second, amount),
  };
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function segmentFromTriangle(mesh, triangle, triangleIndex, normal, offset, epsilon) {
  const indices = [triangle.a, triangle.b, triangle.c];
  const distances = indices.map((index) => dot(normal, mesh.vertices[index]) - offset);
  if (distances.every((distance) => Math.abs(distance) <= epsilon)) return null;
  const intersections = [
    intersectionOnEdge(mesh.vertices, indices[0], indices[1], distances[0], distances[1], epsilon),
    intersectionOnEdge(mesh.vertices, indices[1], indices[2], distances[1], distances[2], epsilon),
    intersectionOnEdge(mesh.vertices, indices[2], indices[0], distances[2], distances[0], epsilon),
  ].filter(Boolean);
  const unique = [...new Map(intersections.map((item) => [item.key, item])).values()];
  if (unique.length < 2) return null;

  let first = unique[0];
  let second = unique[1];
  if (unique.length > 2) {
    let longest = -1;
    for (let a = 0; a < unique.length; a += 1) {
      for (let b = a + 1; b < unique.length; b += 1) {
        const length = distance3(unique[a].point, unique[b].point);
        if (length > longest) {
          longest = length;
          first = unique[a];
          second = unique[b];
        }
      }
    }
  }
  const length = distance3(first.point, second.point);
  if (!Number.isFinite(length) || length <= epsilon) return null;
  return {
    a: first.point,
    b: second.point,
    aKey: first.key,
    bKey: second.key,
    length,
    seam: Boolean(triangle.seam),
    triangleIndex,
  };
}

function analyzeComponents(segments) {
  const incident = new Map();
  segments.forEach((segment, index) => {
    for (const key of [segment.aKey, segment.bKey]) {
      const entries = incident.get(key) ?? [];
      entries.push(index);
      incident.set(key, entries);
    }
  });

  const remaining = new Set(segments.map((_, index) => index));
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    remaining.delete(first);
    const indices = [];
    while (queue.length) {
      const index = queue.pop();
      indices.push(index);
      const segment = segments[index];
      for (const key of [segment.aKey, segment.bKey]) {
        for (const neighbor of incident.get(key) ?? []) {
          if (!remaining.has(neighbor)) continue;
          remaining.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }

    let length = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let transverse = 0;
    let seamLength = 0;
    const nodeDegrees = new Map();
    const topologyKeys = new Set();
    for (const index of indices) {
      const segment = segments[index];
      const weight = segment.length;
      const midpoint = {
        x: (segment.a.x + segment.b.x) * 0.5,
        y: (segment.a.y + segment.b.y) * 0.5,
        z: (segment.a.z + segment.b.z) * 0.5,
        intrinsicV: (segment.a.intrinsicV + segment.b.intrinsicV) * 0.5,
      };
      length += weight;
      x += midpoint.x * weight;
      y += midpoint.y * weight;
      z += midpoint.z * weight;
      transverse += Math.abs(midpoint.intrinsicV) * weight;
      if (segment.seam) seamLength += weight;
      nodeDegrees.set(segment.aKey, (nodeDegrees.get(segment.aKey) ?? 0) + 1);
      nodeDegrees.set(segment.bKey, (nodeDegrees.get(segment.bKey) ?? 0) + 1);
      topologyKeys.add(segment.aKey);
      topologyKeys.add(segment.bKey);
    }
    const divisor = Math.max(length, EPSILON);
    components.push({
      segmentIndices: indices,
      length,
      centroid: { x: x / divisor, y: y / divisor, z: z / divisor },
      transverseAmount: clamp(transverse / divisor, 0, 1),
      seamAmount: clamp(seamLength / divisor, 0, 1),
      closed: [...nodeDegrees.values()].every((degree) => degree === 2),
      topologyKeys: [...topologyKeys].sort(),
    });
  }

  return components
    .sort((a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x)
    .map((component, index) => ({ ...component, index }));
}

/**
 * Intersect every triangle with n·p = offset and join segments only through
 * shared topological mesh edges. Coincident sheets therefore remain separate.
 */
export function sliceSurface(mesh, normal, offset, epsilon = 1e-7) {
  const safeNormal = normalizedPlaneNormal(normal);
  const safeOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const segments = [];
  const segmentByEndpoints = new Map();
  let truncated = false;
  for (let index = 0; index < mesh.triangles.length; index += 1) {
    const segment = segmentFromTriangle(
      mesh,
      mesh.triangles[index],
      index,
      safeNormal,
      safeOffset,
      Math.max(EPSILON, Math.abs(Number(epsilon) || 0)),
    );
    if (!segment) continue;
    const segmentKey = [segment.aKey, segment.bKey].sort().join("|");
    const duplicate = segmentByEndpoints.get(segmentKey);
    if (duplicate) {
      duplicate.seam ||= segment.seam;
      continue;
    }
    segmentByEndpoints.set(segmentKey, segment);

    if (segments.length >= SURFACE_LIMITS.maximumSliceSegments) {
      truncated = true;
      break;
    }
    segments.push(segment);
  }
  return {
    normal: safeNormal,
    offset: safeOffset,
    segments,
    components: analyzeComponents(segments),
    truncated,
  };
}

export function meshRangeAlong(mesh, normal) {
  const safeNormal = normalizedPlaneNormal(normal);
  const projections = mesh.vertices.map((point) => dot(safeNormal, point));
  return {
    minimum: Math.min(...projections),
    maximum: Math.max(...projections),
  };
}

export function planeOffsetForMeshPhase(mesh, normal, phase) {
  const range = meshRangeAlong(mesh, normal);
  const amount = wrap01(phase);
  return range.minimum + (range.maximum - range.minimum) * amount;
}

/**
 * Convert slice components into bounded, deterministic synth intents. Web Audio
 * remains app-owned; this function only exposes causal geometric quantities.
 */
export function mapSliceComponents(mesh, slice, {
  pitchRange = 2.5,
  timbre = 0.55,
  stereoWidth = 0.82,
  seamVoice = 0.5,
  maximumComponents = SURFACE_LIMITS.maximumVoiceComponents,
} = {}) {
  const selected = [...slice.components]
    .sort((a, b) => b.length - a.length)
    .slice(0, Math.round(clamp(maximumComponents, 1, SURFACE_LIMITS.maximumVoiceComponents)))
    .sort((a, b) => a.centroid.y - b.centroid.y || a.index - b.index);
  const totalLength = selected.reduce((sum, component) => sum + component.length, 0) || 1;
  const heightSpan = Math.max(EPSILON, mesh.bounds.maxY - mesh.bounds.minY);
  const horizontalSpan = Math.max(EPSILON, mesh.bounds.maxX - mesh.bounds.minX);
  return selected.map((component, voiceIndex) => {
    const height = clamp((component.centroid.y - mesh.bounds.minY) / heightSpan, 0, 1);
    const horizontal = clamp(
      (component.centroid.x - mesh.bounds.minX) / horizontalSpan * 2 - 1,
      -1,
      1,
    );
    const lengthShare = clamp(component.length / totalLength, 0, 1);
    const drive = clamp(
      0.08 + clamp(timbre, 0, 1)
        * (component.transverseAmount * 0.68 + component.seamAmount * 0.32),
      0,
      1,
    );
    return {
      key: "slice:" + voiceIndex,
      componentIndex: component.index,
      pitch01: height,
      centroid: { ...component.centroid },
      topologyKeys: [...component.topologyKeys],
      pitchOctaves: height * clamp(pitchRange, 0.25, 5),
      pan: horizontal * clamp(stereoWidth, 0, 1),
      gain: 0.12 + Math.sqrt(lengthShare) * 0.26,
      drive,
      haloSemitones: 3 + component.transverseAmount * 7 + component.seamAmount * 2,
      haloGain: (0.025 + component.seamAmount * 0.12) * clamp(seamVoice, 0, 1),
      seamAmount: component.seamAmount,
      transverseAmount: component.transverseAmount,
      closed: component.closed,
      length: component.length,
    };
  });
}

function topologyOverlap(firstKeys = [], secondKeys = []) {
  if (!firstKeys.length || !secondKeys.length) return 0;
  const second = new Set(secondKeys);
  let shared = 0;
  for (const key of firstKeys) {
    if (second.has(key)) shared += 1;
  }
  return shared / Math.max(1, Math.min(firstKeys.length, secondKeys.length));
}

function componentMatchCost(mesh, previous, current) {
  const spans = {
    x: mesh.bounds.maxX - mesh.bounds.minX,
    y: mesh.bounds.maxY - mesh.bounds.minY,
    z: mesh.bounds.maxZ - mesh.bounds.minZ,
  };
  const diagonal = Math.max(EPSILON, Math.hypot(spans.x, spans.y, spans.z));
  const distance = distance3(previous.centroid, current.centroid) / diagonal;
  const overlap = topologyOverlap(previous.topologyKeys, current.topologyKeys);
  if (distance > 0.72 || (distance > 0.42 && overlap === 0)) return Infinity;
  const lengthDelta = Math.min(
    1,
    Math.abs(Math.log(
      Math.max(EPSILON, current.length) / Math.max(EPSILON, previous.length),
    )),
  );
  return Math.max(
    0,
    distance * 1.55
      + lengthDelta * 0.22
      + (overlap > 0 ? -overlap * 0.28 : 0.1),
  );
}

// Give nearby slice components durable IDs across frames. The assignment is
// one-to-one and minimizes total geometric/topological cost, so disconnected
// curves cannot exchange trajectories merely because their y-order crosses.
// New branches receive IDs; a split lets only its best child inherit.
export function trackSliceComponents(
  mesh,
  previousTracks = [],
  components = [],
  nextId = 0,
) {
  const previous = (Array.isArray(previousTracks) ? previousTracks : [])
    .slice(0, SURFACE_LIMITS.maximumVoiceComponents);
  const current = (Array.isArray(components) ? components : [])
    .slice(0, SURFACE_LIMITS.maximumVoiceComponents);
  const newTrackCost = 0.72;
  const memo = new Map();

  function solve(index, usedMask) {
    if (index >= current.length) return { cost: 0, matches: [] };
    const memoKey = `${index}:${usedMask}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const newRest = solve(index + 1, usedMask);
    let best = {
      cost: newTrackCost + newRest.cost,
      matches: [null, ...newRest.matches],
    };
    for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
      const bit = 1 << previousIndex;
      if (usedMask & bit) continue;
      const pairCost = componentMatchCost(
        mesh,
        previous[previousIndex],
        current[index],
      );
      if (!Number.isFinite(pairCost) || pairCost > newTrackCost) continue;
      const rest = solve(index + 1, usedMask | bit);
      const cost = pairCost + rest.cost;
      if (cost < best.cost) {
        best = {
          cost,
          matches: [previousIndex, ...rest.matches],
        };
      }
    }
    memo.set(memoKey, best);
    return best;
  }

  const assignment = solve(0, 0).matches;
  const priorMaximum = previous.reduce(
    (maximum, track) => Math.max(maximum, Number(track.id) || 0),
    -1,
  );
  let availableId = Math.max(0, Math.floor(Number(nextId) || 0), priorMaximum + 1);
  const trackedComponents = current.map((component, index) => {
    const previousIndex = assignment[index];
    const componentId = previousIndex === null
      ? availableId++
      : previous[previousIndex].id;
    return {
      ...component,
      componentId,
      key: `slice:${componentId}`,
    };
  });
  const tracks = trackedComponents.map((component) => ({
    id: component.componentId,
    centroid: { ...component.centroid },
    length: component.length,
    topologyKeys: [...component.topologyKeys],
  }));
  return {
    components: trackedComponents,
    tracks,
    nextId: availableId,
  };
}
