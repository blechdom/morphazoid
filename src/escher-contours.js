import { samplePoincareGeodesic } from "./escher-tessellation.js";

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clampInteger = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(numeric) ? Math.floor(numeric) : fallback,
  ));
};

const modulo = (value, size) => {
  const safeSize = Math.max(1, Math.floor(finite(size, 1)));
  return ((Math.floor(finite(value)) % safeSize) + safeSize) % safeSize;
};

const freezePoint = (point) => Object.freeze({
  x: finite(point?.x),
  y: finite(point?.y),
});

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += pointDistance(points[index - 1], points[index]);
  }
  return length;
}

function signedTurn(incoming, outgoing) {
  const firstLength = Math.hypot(incoming.x, incoming.y);
  const secondLength = Math.hypot(outgoing.x, outgoing.y);
  if (!(firstLength > EPSILON) || !(secondLength > EPSILON)) return 0;
  return Math.atan2(
    incoming.x * outgoing.y - incoming.y * outgoing.x,
    incoming.x * outgoing.x + incoming.y * outgoing.y,
  );
}

function edgeTangent(points, fromStart = true) {
  if (points.length < 2) return { x: 1, y: 0 };
  if (fromStart) {
    for (let index = 1; index < points.length; index += 1) {
      const vector = {
        x: points[index].x - points[0].x,
        y: points[index].y - points[0].y,
      };
      if (Math.hypot(vector.x, vector.y) > EPSILON) return vector;
    }
  } else {
    const last = points.length - 1;
    for (let index = last - 1; index >= 0; index -= 1) {
      const vector = {
        x: points[last].x - points[index].x,
        y: points[last].y - points[index].y,
      };
      if (Math.hypot(vector.x, vector.y) > EPSILON) return vector;
    }
  }
  return { x: 1, y: 0 };
}

function edgeCurvature(points, length) {
  if (points.length < 3 || !(length > EPSILON)) return 0;
  let total = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const incoming = {
      x: points[index].x - points[index - 1].x,
      y: points[index].y - points[index - 1].y,
    };
    const outgoing = {
      x: points[index + 1].x - points[index].x,
      y: points[index + 1].y - points[index].y,
    };
    total += Math.abs(signedTurn(incoming, outgoing));
  }
  return total / length;
}

function polygonArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twiceArea += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return twiceArea / 2;
}

function polygonCenter(points) {
  const area = polygonArea(points);
  if (Math.abs(area) > EPSILON) {
    let x = 0;
    let y = 0;
    for (let index = 0; index < points.length; index += 1) {
      const next = (index + 1) % points.length;
      const cross = points[index].x * points[next].y - points[next].x * points[index].y;
      x += (points[index].x + points[next].x) * cross;
      y += (points[index].y + points[next].y) * cross;
    }
    const divisor = 6 * area;
    return { x: x / divisor, y: y / divisor };
  }
  const sum = points.reduce((result, point) => ({
    x: result.x + point.x,
    y: result.y + point.y,
  }), { x: 0, y: 0 });
  return {
    x: sum.x / Math.max(1, points.length),
    y: sum.y / Math.max(1, points.length),
  };
}

function appendDistinct(target, points) {
  for (const point of points) {
    const previous = target[target.length - 1];
    if (!previous || pointDistance(previous, point) > EPSILON) target.push(point);
  }
}

function canonicalEdgeKey(points, precision = 10_000) {
  const first = points[0];
  const last = points[points.length - 1];
  const firstKey = `${Math.round(first.x * precision)},${Math.round(first.y * precision)}`;
  const lastKey = `${Math.round(last.x * precision)},${Math.round(last.y * precision)}`;
  return firstKey < lastKey ? `${firstKey}|${lastKey}` : `${lastKey}|${firstKey}`;
}

function euclideanColorIndex(tile, tileIndex, preset, geometry) {
  const [first = 0, second = 0] = String(tile.key ?? "0,0")
    .split(",")
    .map(Number);
  const aspect = finite(tile.aspect, tileIndex);
  const colors = Math.max(1, finite(preset?.colors, 1));
  const center = polygonCenter(tile.points ?? []);
  if (preset?.id === "counterform-current") return modulo(first + second + aspect, 2);
  if (preset?.id === "night-flight") {
    return modulo((center.x < 0 ? 0 : 1) + first + aspect, 2);
  }
  if (preset?.id === "triple-orbit") return modulo(first + second * 2 + aspect, 3);
  if (preset?.id === "glide-parade") {
    return modulo(first + modulo(second, 2) * 2 + aspect, 4);
  }
  if (preset?.id === "metamorphosis-band") {
    const minimum = finite(geometry?.bounds?.minX, -1);
    const width = Math.max(EPSILON, finite(geometry?.bounds?.maxX, 1) - minimum);
    const position = Math.min(0.999, Math.max(0, (center.x - minimum) / width));
    return modulo(Math.floor(position * colors) + aspect, colors);
  }
  return modulo(Math.abs(aspect), colors);
}

function euclideanCandidates(geometry, preset) {
  const claimsByTile = new Map();
  for (const edge of geometry?.edges ?? []) {
    for (const claim of edge.adjacentTiles ?? []) {
      if (!claimsByTile.has(claim.key)) claimsByTile.set(claim.key, []);
      claimsByTile.get(claim.key).push({
        edgeIndex: finite(claim.edgeIndex),
        sourceEdgeId: edge.key ?? edge.adjacencyKey ?? `${claim.key}:${claim.edgeIndex}`,
        points: (edge.points ?? []).map((point) => ({ x: finite(point.x), y: finite(point.y) })),
        adjacentSourceIds: (edge.adjacentTiles ?? [])
          .map(({ key }) => key)
          .filter((key) => key !== claim.key),
      });
    }
  }

  const expectedEdgeCount = Math.max(
    1,
    ...[...claimsByTile.values()].map((claims) => (
      new Set(claims.map(({ edgeIndex }) => edgeIndex)).size
    )),
  );

  return (geometry?.tiles ?? []).map((tile, tileIndex) => {
    const id = `tile:${tile.key ?? tileIndex}`;
    const claims = (claimsByTile.get(tile.key) ?? [])
      .filter(({ points }) => points.length >= 2)
      .sort((first, second) => first.edgeIndex - second.edgeIndex);
    const claimsByIndex = new Map(claims.map((claim) => [claim.edgeIndex, claim]));
    const points = (tile.points ?? []).map((point) => ({ x: finite(point.x), y: finite(point.y) }));
    const samplesPerEdge = points.length / expectedEdgeCount;
    let edges;
    if (Number.isInteger(samplesPerEdge) && samplesPerEdge >= 1) {
      edges = Array.from({ length: expectedEdgeCount }, (_, edgeIndex) => {
        const start = edgeIndex * samplesPerEdge;
        const edgePoints = Array.from({ length: samplesPerEdge + 1 }, (__, offset) => (
          points[(start + offset) % points.length]
        ));
        const claim = claimsByIndex.get(edgeIndex);
        return {
          sourceEdgeId: claim?.sourceEdgeId ?? `${id}:edge:${edgeIndex}`,
          points: edgePoints,
          adjacentSourceIds: claim?.adjacentSourceIds ?? [],
        };
      });
    } else {
      edges = [{
        sourceEdgeId: `${id}:outline`,
        points: [...points, points[0]],
        adjacentSourceIds: [],
      }];
    }
    return {
      id,
      model: "euclidean",
      role: "tile",
      sourceId: String(tile.key ?? tileIndex),
      tileId: String(tile.key ?? tileIndex),
      level: 0,
      sector: null,
      aspect: finite(tile.aspect, 0),
      color: euclideanColorIndex(tile, tileIndex, preset, geometry),
      depth: 0,
      parentId: null,
      reflectionEdge: null,
      points,
      rawEdges: edges,
    };
  }).filter(({ points }) => points.length >= 3);
}

function squareVertices(radius, rotation) {
  return Array.from({ length: 4 }, (_, index) => {
    const angle = rotation + Math.PI / 4 + index * Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function closestPair(points, target) {
  return points.map((point, index) => ({
    point,
    index,
    distance: pointDistance(point, target),
  })).sort((first, second) => first.distance - second.distance || first.index - second.index)
    .slice(0, 2)
    .map(({ point }) => point);
}

function straightEdges(id, points) {
  return points.map((point, index) => ({
    sourceEdgeId: `${id}:edge:${index}`,
    points: [point, points[(index + 1) % points.length]],
    adjacentSourceIds: [],
  }));
}

function similarityCandidates(geometry) {
  const candidates = [];
  for (const orbit of geometry ?? []) {
    const outer = squareVertices(orbit.scale, orbit.rotation);
    const inner = squareVertices(orbit.innerScale, orbit.rotation + Math.PI / 4);
    outer.forEach((corner, sector) => {
      const adjacent = closestPair(inner, corner);
      const id = `similarity:${orbit.level}:${sector}`;
      const points = [corner, adjacent[0], adjacent[1]].map((point) => ({ ...point }));
      candidates.push({
        id,
        model: "similarity",
        role: "similarity-cell",
        sourceId: `${orbit.level}:${sector}`,
        tileId: `${orbit.level}:${sector}`,
        level: finite(orbit.level),
        sector,
        aspect: sector,
        color: (finite(orbit.level) + sector) % 4,
        depth: finite(orbit.level),
        parentId: orbit.level > 0 ? `similarity:${orbit.level - 1}:${sector}` : null,
        reflectionEdge: null,
        points,
        rawEdges: straightEdges(id, points),
      });
    });
  }
  return candidates;
}

function hyperbolicCandidates(geometry, preset) {
  return (geometry ?? []).map((tile) => {
    const id = `hyperbolic:${tile.id}`;
    const segmentCount = tile.depth <= 1 ? 12 : tile.depth <= 3 ? 6 : 3;
    const rawEdges = tile.points.map((start, edgeIndex) => {
      const end = tile.points[(edgeIndex + 1) % tile.points.length];
      return {
        sourceEdgeId: `${id}:edge:${edgeIndex}`,
        points: samplePoincareGeodesic(start, end, segmentCount).map((point) => ({ ...point })),
        adjacentSourceIds: [],
      };
    });
    const points = [];
    for (const edge of rawEdges) appendDistinct(points, edge.points.slice(0, -1));
    const parts = String(tile.id).split(".");
    const reflectionEdge = parts.length > 1 ? Number(parts.at(-1)) : null;
    const parentSourceId = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
    return {
      id,
      model: "hyperbolic",
      role: "hyperbolic-tile",
      sourceId: String(tile.id),
      tileId: String(tile.id),
      level: finite(tile.depth),
      sector: reflectionEdge,
      aspect: tile.color ?? 0,
      color: preset?.id === "hyperbolic-current"
        ? modulo(finite(tile.depth) + String(tile.id).split(".").length, preset.colors)
        : modulo(tile.color ?? 0, preset?.colors ?? 2),
      depth: finite(tile.depth),
      parentId: parentSourceId === null ? null : `hyperbolic:${parentSourceId}`,
      reflectionEdge,
      points,
      rawEdges,
    };
  }).filter(({ points }) => points.length >= 3);
}

function connectSharedEdges(candidates) {
  const claims = new Map();
  for (const contour of candidates) {
    contour.rawEdges.forEach((edge, edgeIndex) => {
      const key = canonicalEdgeKey(edge.points);
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key).push({ contour, edge, edgeIndex });
    });
  }
  for (const group of claims.values()) {
    if (group.length < 2) continue;
    for (const claim of group) {
      const others = group
        .filter(({ contour }) => contour.id !== claim.contour.id)
        .map(({ contour }) => contour.id);
      claim.edge.adjacentIds = [...new Set([...(claim.edge.adjacentIds ?? []), ...others])];
    }
  }
}

function contourFieldBounds(candidates) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of candidates) {
    for (const point of contour.points) {
      minX = Math.min(minX, finite(point.x));
      minY = Math.min(minY, finite(point.y));
      maxX = Math.max(maxX, finite(point.x));
      maxY = Math.max(maxY, finite(point.y));
    }
  }
  if (!Number.isFinite(minX)) return Object.freeze({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
  return Object.freeze({ minX, minY, maxX, maxY });
}

function finalizeContour(candidate, retainedIds) {
  const points = candidate.points.map(freezePoint);
  const center = polygonCenter(points);
  let distance = 0;
  const edges = candidate.rawEdges.map((source, index, allEdges) => {
    const edgePoints = source.points.map(freezePoint);
    const length = polylineLength(edgePoints);
    const previousPoints = allEdges[(index - 1 + allEdges.length) % allEdges.length].points;
    const turn = signedTurn(
      edgeTangent(previousPoints, false),
      edgeTangent(source.points, true),
    );
    const startDistance = distance;
    distance += length;
    const explicitAdjacent = (source.adjacentIds ?? []).filter((id) => retainedIds.has(id));
    const sourceAdjacent = (source.adjacentSourceIds ?? [])
      .map((sourceId) => `tile:${sourceId}`)
      .filter((id) => retainedIds.has(id));
    return Object.freeze({
      id: `${candidate.id}:edge:${index}`,
      index,
      sourceEdgeId: source.sourceEdgeId,
      points: Object.freeze(edgePoints),
      length,
      curvature: edgeCurvature(edgePoints, length),
      turn,
      startDistance,
      endDistance: distance,
      adjacentIds: Object.freeze([...new Set([...explicitAdjacent, ...sourceAdjacent])]),
    });
  }).filter(({ length }) => length > EPSILON);
  const adjacency = new Set();
  for (const edge of edges) {
    for (const id of edge.adjacentIds) adjacency.add(id);
  }
  return Object.freeze({
    id: candidate.id,
    model: candidate.model,
    role: candidate.role,
    sourceId: candidate.sourceId,
    tileId: candidate.tileId,
    level: candidate.level,
    sector: candidate.sector,
    aspect: candidate.aspect,
    color: candidate.color,
    depth: candidate.depth,
    parentId: candidate.parentId,
    reflectionEdge: candidate.reflectionEdge,
    center: freezePoint(center),
    area: Math.abs(polygonArea(points)),
    perimeter: edges.reduce((sum, edge) => sum + edge.length, 0),
    points: Object.freeze(points),
    edges: Object.freeze(edges),
    adjacentIds: Object.freeze([...adjacency].sort()),
  });
}

/**
 * Convert the exact visible Escher geometry into closed arclength contours.
 * The returned paths are the same sampled tile borders used by the renderer;
 * no reader line, substitute orbit, or invented nesting is introduced.
 */
export function buildEscherContours({
  preset,
  geometry,
  maxContours = 192,
  maxPoints = 24_576,
} = {}) {
  const model = preset?.model ?? "euclidean";
  let candidates;
  if (model === "hyperbolic") candidates = hyperbolicCandidates(geometry, preset);
  else if (model === "similarity") candidates = similarityCandidates(geometry);
  else candidates = euclideanCandidates(geometry, preset);
  connectSharedEdges(candidates);
  const bounds = contourFieldBounds(candidates);

  if (model === "euclidean") {
    candidates.sort((first, second) => {
      const firstCenter = polygonCenter(first.points);
      const secondCenter = polygonCenter(second.points);
      return Math.hypot(firstCenter.x, firstCenter.y) - Math.hypot(secondCenter.x, secondCenter.y)
        || first.id.localeCompare(second.id);
    });
  }
  const safeContourLimit = clampInteger(maxContours, 1, 4096, 192);
  const safePointLimit = clampInteger(maxPoints, 64, 1_000_000, 24_576);
  const retained = [];
  let pointCount = 0;
  for (const candidate of candidates) {
    if (retained.length >= safeContourLimit) break;
    const candidatePoints = candidate.points.length;
    if (pointCount + candidatePoints > safePointLimit) {
      if (retained.length) break;
      continue;
    }
    retained.push(candidate);
    pointCount += candidatePoints;
  }
  const retainedIds = new Set(retained.map(({ id }) => id));
  const contours = Object.freeze(retained.map((candidate) => finalizeContour(candidate, retainedIds)));
  const byId = Object.freeze(Object.fromEntries(contours.map((contour) => [contour.id, contour])));
  return Object.freeze({
    presetId: String(preset?.id ?? "unknown"),
    model,
    contours,
    byId,
    bounds,
    sourceCount: candidates.length,
    truncated: contours.length < candidates.length,
  });
}

export function contourPointAtDistance(contour, distance = 0) {
  const perimeter = finite(contour?.perimeter);
  const edges = contour?.edges ?? [];
  if (!(perimeter > EPSILON) || !edges.length) {
    return Object.freeze({
      point: freezePoint(contour?.points?.[0]),
      tangent: Object.freeze({ x: 1, y: 0 }),
      distance: 0,
      edgeDistance: 0,
      edgeProgress: 0,
      edgeId: null,
      edgeIndex: 0,
    });
  }
  const wrapped = ((finite(distance) % perimeter) + perimeter) % perimeter;
  const edge = edges.find(({ endDistance }) => wrapped < endDistance - EPSILON) ?? edges.at(-1);
  const localDistance = Math.max(0, wrapped - edge.startDistance);
  let traversed = 0;
  let point = edge.points[0];
  let tangent = { x: 1, y: 0 };
  for (let index = 1; index < edge.points.length; index += 1) {
    const start = edge.points[index - 1];
    const end = edge.points[index];
    const segmentLength = pointDistance(start, end);
    if (localDistance <= traversed + segmentLength + EPSILON || index === edge.points.length - 1) {
      const amount = segmentLength > EPSILON
        ? Math.min(1, Math.max(0, (localDistance - traversed) / segmentLength))
        : 0;
      point = {
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      };
      const inverseLength = segmentLength > EPSILON ? 1 / segmentLength : 0;
      tangent = {
        x: (end.x - start.x) * inverseLength,
        y: (end.y - start.y) * inverseLength,
      };
      break;
    }
    traversed += segmentLength;
  }
  return Object.freeze({
    point: freezePoint(point),
    tangent: freezePoint(tangent),
    distance: wrapped,
    edgeDistance: localDistance,
    edgeProgress: edge.length > EPSILON ? Math.min(1, localDistance / edge.length) : 0,
    edgeId: edge.id,
    edgeIndex: edge.index,
  });
}

export function contourEvents(contour) {
  return Object.freeze((contour?.edges ?? []).map((edge) => Object.freeze({
    id: `${contour.id}:corner:${edge.index}`,
    contourId: contour.id,
    edgeId: edge.id,
    edgeIndex: edge.index,
    afterDistance: edge.startDistance,
    point: edge.points[0],
    turn: edge.turn,
    curvature: edge.curvature,
  })));
}

function defaultContour(contours, model) {
  if (model === "similarity") {
    return [...contours].sort((first, second) => (
      first.level - second.level || first.sector - second.sector || first.id.localeCompare(second.id)
    ))[0] ?? null;
  }
  if (model === "hyperbolic") {
    return [...contours].sort((first, second) => (
      first.depth - second.depth || first.id.localeCompare(second.id)
    ))[0] ?? null;
  }
  return [...contours].sort((first, second) => (
    Math.hypot(first.center.x, first.center.y) - Math.hypot(second.center.x, second.center.y)
      || second.area - first.area
      || first.id.localeCompare(second.id)
  ))[0] ?? null;
}

function graphNeighbors(field, selected, reach, limit) {
  const result = [selected];
  const seen = new Set([selected.id]);
  let frontier = [selected];
  for (let hop = 0; hop < reach && frontier.length && result.length < limit; hop += 1) {
    const next = [];
    for (const contour of frontier) {
      for (const adjacentId of contour.adjacentIds) {
        if (seen.has(adjacentId)) continue;
        const adjacent = field.byId[adjacentId];
        if (!adjacent) continue;
        seen.add(adjacentId);
        result.push(adjacent);
        next.push(adjacent);
        if (result.length >= limit) break;
      }
      if (result.length >= limit) break;
    }
    frontier = next;
  }
  return result;
}

export function selectEscherContours(field, {
  mode = "shape",
  selectedId = null,
  neighborReach = 2,
  maxActive = 12,
} = {}) {
  const contours = field?.contours ?? [];
  if (!contours.length) return Object.freeze([]);
  const selected = field.byId?.[selectedId] ?? defaultContour(contours, field.model);
  const limit = clampInteger(maxActive, 1, 64, 12);
  if (mode === "neighbors") {
    return Object.freeze(graphNeighbors(
      field,
      selected,
      clampInteger(neighborReach, 1, 8, 2),
      limit,
    ));
  }
  if (mode === "pattern") {
    let matches = contours.filter((contour) => {
      if (contour.id === selected.id) return true;
      if (field.model === "similarity") return contour.sector === selected.sector;
      if (field.model === "euclidean") return contour.aspect === selected.aspect;
      return contour.role === selected.role;
    }).sort((first, second) => {
      if (first.id === selected.id) return -1;
      if (second.id === selected.id) return 1;
      if (field.model === "similarity") return first.level - second.level || first.id.localeCompare(second.id);
      return pointDistance(first.center, selected.center) - pointDistance(second.center, selected.center)
        || first.id.localeCompare(second.id);
    });
    if (field.model === "hyperbolic") {
      const byDepth = new Map();
      for (const contour of matches) {
        if (!byDepth.has(contour.depth)) byDepth.set(contour.depth, []);
        byDepth.get(contour.depth).push(contour);
      }
      const representatives = [selected];
      const seen = new Set([selected.id]);
      const depths = [...byDepth.keys()].sort((first, second) => first - second);
      for (let pass = 0; representatives.length < limit; pass += 1) {
        let added = false;
        for (const depth of depths) {
          const candidate = byDepth.get(depth)[pass];
          if (!candidate || seen.has(candidate.id)) continue;
          representatives.push(candidate);
          seen.add(candidate.id);
          added = true;
          if (representatives.length >= limit) break;
        }
        if (!added) break;
      }
      matches = representatives;
    }
    return Object.freeze(matches.slice(0, limit));
  }
  return Object.freeze([selected]);
}
