/**
 * Exact P3 Penrose-rhomb geometry built through Robinson-triangle subdivision.
 *
 * The two Robinson triangles are bisected thick and thin rhombs. Repeated
 * golden-ratio subdivision preserves their matching hierarchy; pairing equal
 * triangles along their marked base reconstructs the familiar P3 rhombs.
 * This module is browser-free so the construction can be checked in Node.
 */

export const PENROSE_PHI = (1 + Math.sqrt(5)) / 2;
export const PENROSE_GENERATION_MIN = 1;
export const PENROSE_GENERATION_MAX = 7;
export const PENROSE_PRESENTATIONS = Object.freeze([
  Object.freeze({
    id: "p3",
    shortLabel: "P3 rhombs",
    label: "P3 rhombs · substitution",
    tileLabels: Object.freeze(["thin rhomb", "thick rhomb"]),
    description: "Thick and thin rhombs reconstructed from Robinson-triangle substitution.",
  }),
  Object.freeze({
    id: "pentagrid",
    shortLabel: "P3 pentagrid",
    label: "P3 rhombs · pentagrid",
    tileLabels: Object.freeze(["thin rhomb", "thick rhomb"]),
    description: "The same P3 rhombs generated from de Bruijn’s five independently shifted line families.",
  }),
  Object.freeze({
    id: "p2",
    shortLabel: "P2 kite + dart",
    label: "P2 kites + darts",
    tileLabels: Object.freeze(["kite", "dart"]),
    description: "The equivalent kite-and-dart presentation, paired along each half-tile’s mirror axis.",
  }),
  Object.freeze({
    id: "p1",
    shortLabel: "P1 pentagons",
    label: "P1 pentagons",
    tileLabels: Object.freeze([
      "pentagon P5",
      "pentagon P3",
      "pentagon P2",
      "star",
      "boat",
      "diamond",
    ]),
    description: "Penrose’s original matched pentagons, star, boat, and diamond presentation.",
  }),
  Object.freeze({
    id: "robinson",
    shortLabel: "Robinson triangles",
    label: "Robinson triangles",
    tileLabels: Object.freeze(["golden triangle", "golden gnomon"]),
    description: "The acute and obtuse golden half-tiles before they are recomposed into P3 rhombs.",
  }),
]);

const TAU = Math.PI * 2;
const POINT_PRECISION = 100_000_000;
const PRESENTATION_BY_ID = new Map(PENROSE_PRESENTATIONS.map((entry) => [entry.id, entry]));

export function clampPenroseValue(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
}

function point(x, y) {
  return Object.freeze({ x, y });
}

function interpolate(first, second, amount) {
  return point(
    first.x + (second.x - first.x) * amount,
    first.y + (second.y - first.y) * amount,
  );
}

function rotatePoint(current, angle) {
  if (!angle) return current;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return point(
    current.x * cosine - current.y * sine,
    current.x * sine + current.y * cosine,
  );
}

function pointKey(current) {
  return `${Math.round(current.x * POINT_PRECISION)},${Math.round(current.y * POINT_PRECISION)}`;
}

function edgeKey(first, second) {
  return [pointKey(first), pointKey(second)].sort().join("|");
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function polygonCenter(points) {
  return point(
    points.reduce((sum, current) => sum + current.x, 0) / points.length,
    points.reduce((sum, current) => sum + current.y, 0) / points.length,
  );
}

function orderPolygon(points) {
  const center = polygonCenter(points);
  const ordered = [...points].sort((first, second) => (
    Math.atan2(first.y - center.y, first.x - center.x)
      - Math.atan2(second.y - center.y, second.x - center.x)
  ));
  if (polygonArea(ordered) < 0) ordered.reverse();
  return Object.freeze(ordered);
}

/** Build the conventional ten-triangle sun seed. */
export function createPenroseSunSeed(rotation = -Math.PI / 2) {
  return Object.freeze(Array.from({ length: 10 }, (_, index) => {
    let b = rotatePoint(point(
      Math.cos((2 * index - 1) * Math.PI / 10),
      Math.sin((2 * index - 1) * Math.PI / 10),
    ), rotation);
    let c = rotatePoint(point(
      Math.cos((2 * index + 1) * Math.PI / 10),
      Math.sin((2 * index + 1) * Math.PI / 10),
    ), rotation);
    if (index % 2 === 0) [b, c] = [c, b];
    return Object.freeze({
      type: "thin",
      a: point(0, 0),
      b,
      c,
      generation: 0,
    });
  }));
}

/** Build five P2 kites around the origin as ten labelled half-kites. */
export function createPenroseKiteSeed(rotation = -Math.PI / 2) {
  const at = (angle) => rotatePoint(point(Math.cos(angle), Math.sin(angle)), rotation);
  const origin = point(0, 0);
  const seed = [];
  for (let index = 0; index < 5; index += 1) {
    const axis = index * TAU / 5;
    seed.push(
      Object.freeze({
        type: "kite",
        a: origin,
        b: at(axis - Math.PI / 5),
        c: at(axis),
        generation: 0,
      }),
      Object.freeze({
        type: "kite",
        a: origin,
        b: at(axis + Math.PI / 5),
        c: at(axis),
        generation: 0,
      }),
    );
  }
  return Object.freeze(seed);
}

/** Apply one golden-ratio Robinson subdivision. */
export function subdividePenroseTriangles(triangles) {
  const next = [];
  for (const triangle of triangles ?? []) {
    const { type, a, b, c } = triangle;
    const generation = Math.max(0, Math.trunc(Number(triangle.generation) || 0)) + 1;
    if (type === "thin") {
      const split = interpolate(a, b, 1 / PENROSE_PHI);
      next.push(
        Object.freeze({ type: "thin", a: c, b: split, c: b, generation }),
        Object.freeze({ type: "thick", a: split, b: c, c: a, generation }),
      );
    } else {
      const firstSplit = interpolate(b, a, 1 / PENROSE_PHI);
      const secondSplit = interpolate(b, c, 1 / PENROSE_PHI);
      next.push(
        Object.freeze({ type: "thick", a: secondSplit, b: c, c: a, generation }),
        Object.freeze({ type: "thick", a: firstSplit, b: secondSplit, c: b, generation }),
        Object.freeze({ type: "thin", a: secondSplit, b: firstSplit, c: a, generation }),
      );
    }
  }
  return Object.freeze(next);
}

/** Apply one P2 kite-and-dart Robinson subdivision. */
export function subdividePenroseKiteDartTriangles(triangles) {
  const next = [];
  for (const triangle of triangles ?? []) {
    const { type, a, b, c } = triangle;
    const generation = Math.max(0, Math.trunc(Number(triangle.generation) || 0)) + 1;
    if (type === "kite") {
      const firstSplit = interpolate(a, b, 1 / (PENROSE_PHI * PENROSE_PHI));
      const secondSplit = interpolate(a, c, 1 / PENROSE_PHI);
      next.push(
        Object.freeze({ type: "dart", a: firstSplit, b: secondSplit, c: a, generation }),
        Object.freeze({ type: "kite", a: b, b: firstSplit, c: secondSplit, generation }),
        Object.freeze({ type: "kite", a: b, b: c, c: secondSplit, generation }),
      );
    } else {
      const split = interpolate(c, b, 1 / PENROSE_PHI);
      next.push(
        Object.freeze({ type: "kite", a: c, b: split, c: a, generation }),
        Object.freeze({ type: "dart", a: split, b: a, c: b, generation }),
      );
    }
  }
  return Object.freeze(next);
}

function rhombOrientation(points) {
  const diagonals = [
    { first: points[0], second: points[2] },
    { first: points[1], second: points[3] },
  ].map((diagonal) => ({
    ...diagonal,
    length: Math.hypot(
      diagonal.second.x - diagonal.first.x,
      diagonal.second.y - diagonal.first.y,
    ),
  }));
  const longest = diagonals[0].length >= diagonals[1].length ? diagonals[0] : diagonals[1];
  const angle = Math.atan2(
    longest.second.y - longest.first.y,
    longest.second.x - longest.first.x,
  );
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

function orientationFamily(angle) {
  return ((Math.round(angle / (Math.PI / 5)) % 5) + 5) % 5;
}

/** Pair Robinson triangles along their marked bases into complete P3 rhombs. */
export function pairPenroseTriangles(triangles) {
  const byBase = new Map();
  for (const triangle of triangles ?? []) {
    const key = edgeKey(triangle.b, triangle.c);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(triangle);
  }

  const tiles = [];
  let boundaryTriangles = 0;
  for (const [baseKey, pair] of byBase) {
    if (pair.length !== 2 || pair[0].type !== pair[1].type) {
      boundaryTriangles += pair.length;
      continue;
    }
    const points = orderPolygon([pair[0].a, pair[0].b, pair[1].a, pair[0].c]);
    const center = polygonCenter(points);
    const orientation = rhombOrientation(points);
    const type = pair[0].type;
    tiles.push(Object.freeze({
      id: `${type}:${pointKey(center)}`,
      kind: type === "thin" ? 0 : 1,
      type,
      points,
      center,
      area: Math.abs(polygonArea(points)),
      orientation,
      family: orientationFamily(orientation),
      split: Object.freeze([pair[0].b, pair[0].c]),
      generation: pair[0].generation,
      baseKey,
    }));
  }

  tiles.sort((first, second) => (
    first.center.y - second.center.y
      || first.center.x - second.center.x
      || first.type.localeCompare(second.type)
  ));
  return Object.freeze({ tiles: Object.freeze(tiles), boundaryTriangles });
}

function mirrorPointAcrossLine(first, second, current) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-16) return current;
  const relativeX = current.x - first.x;
  const relativeY = current.y - first.y;
  const amount = (relativeX * dx + relativeY * dy) / lengthSquared;
  return point(
    first.x + 2 * amount * dx - relativeX,
    first.y + 2 * amount * dy - relativeY,
  );
}

/** Pair P2 half-kites and half-darts along their labelled mirror axes. */
export function pairPenroseKiteDartTriangles(triangles) {
  const buckets = new Map();
  for (const triangle of triangles ?? []) {
    const middle = point(
      (triangle.a.x + triangle.c.x) / 2,
      (triangle.a.y + triangle.c.y) / 2,
    );
    const key = `${triangle.type}:${pointKey(middle)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(triangle);
  }

  const used = new Set();
  const specs = [];
  for (const candidates of buckets.values()) {
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const firstTriangle = candidates[firstIndex];
      if (used.has(firstTriangle)) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const secondTriangle = candidates[secondIndex];
        if (used.has(secondTriangle)) continue;
        const reflected = mirrorPointAcrossLine(
          firstTriangle.a,
          firstTriangle.c,
          firstTriangle.b,
        );
        const tolerance = Math.hypot(
          firstTriangle.c.x - firstTriangle.a.x,
          firstTriangle.c.y - firstTriangle.a.y,
        ) * 1e-6;
        if (Math.hypot(
          reflected.x - secondTriangle.b.x,
          reflected.y - secondTriangle.b.y,
        ) > tolerance) continue;
        used.add(firstTriangle);
        used.add(secondTriangle);
        specs.push({
          kind: firstTriangle.type === "kite" ? 0 : 1,
          type: firstTriangle.type,
          points: [
            firstTriangle.b,
            firstTriangle.a,
            secondTriangle.b,
            firstTriangle.c,
          ],
          split: [firstTriangle.a, firstTriangle.c],
          generation: firstTriangle.generation,
        });
        break;
      }
    }
  }
  return Object.freeze({
    specs: Object.freeze(specs),
    boundaryTriangles: Math.max(0, (triangles?.length ?? 0) - used.size),
  });
}

function buildPenroseEdges(tiles) {
  const edgeMap = new Map();
  for (const tile of tiles) {
    tile.points.forEach((first, index) => {
      const second = tile.points[(index + 1) % tile.points.length];
      const key = edgeKey(first, second);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: key,
          first,
          second,
          center: point((first.x + second.x) / 2, (first.y + second.y) / 2),
          length: Math.hypot(second.x - first.x, second.y - first.y),
          angle: ((Math.atan2(second.y - first.y, second.x - first.x) % Math.PI) + Math.PI) % Math.PI,
          tileIds: [],
          tileTypes: [],
          tileKinds: [],
        });
      }
      const edge = edgeMap.get(key);
      edge.tileIds.push(tile.id);
      edge.tileTypes.push(tile.type);
      edge.tileKinds.push(tile.kind ?? (tile.type === "thick" ? 1 : 0));
    });
  }
  return Object.freeze([...edgeMap.values()].map((edge) => Object.freeze({
    ...edge,
    tileIds: Object.freeze(edge.tileIds),
    tileTypes: Object.freeze(edge.tileTypes),
    tileKinds: Object.freeze(edge.tileKinds),
  })));
}

function geometryBounds(tiles) {
  const points = tiles.flatMap((tile) => tile.points);
  if (!points.length) return Object.freeze({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
  return Object.freeze({
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  });
}

function normalizePolygonWinding(points) {
  const next = points.map((current) => point(current.x, current.y));
  if (polygonArea(next) < 0) next.reverse();
  return Object.freeze(next);
}

function polygonOrientation(points) {
  if (points.length === 4) return rhombOrientation(points);
  let longest = null;
  points.forEach((first, index) => {
    const second = points[(index + 1) % points.length];
    const length = Math.hypot(second.x - first.x, second.y - first.y);
    if (!longest || length > longest.length) longest = { first, second, length };
  });
  if (!longest) return 0;
  const angle = Math.atan2(
    longest.second.y - longest.first.y,
    longest.second.x - longest.first.x,
  );
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

function tileRecordsFromSpecs(specs, presentation) {
  const records = (specs ?? []).map((spec, index) => {
    const points = normalizePolygonWinding(spec.points ?? []);
    const center = polygonCenter(points);
    const orientation = polygonOrientation(points);
    return Object.freeze({
      id: `${presentation}:${spec.type ?? spec.kind ?? 0}:${index}:${pointKey(center)}`,
      kind: Math.max(0, Math.trunc(Number(spec.kind) || 0)),
      type: spec.type ?? `class-${Math.max(0, Math.trunc(Number(spec.kind) || 0)) + 1}`,
      label: spec.label ?? spec.type ?? `class ${Math.max(0, Math.trunc(Number(spec.kind) || 0)) + 1}`,
      points,
      center,
      area: Math.abs(polygonArea(points)),
      orientation,
      family: orientationFamily(orientation),
      split: spec.split ? Object.freeze(spec.split.map((current) => point(current.x, current.y))) : null,
      generation: Math.max(0, Math.trunc(Number(spec.generation) || 0)),
    });
  });
  records.sort((first, second) => (
    first.center.y - second.center.y
      || first.center.x - second.center.x
      || first.type.localeCompare(second.type)
  ));
  return Object.freeze(records);
}

function normalizeTileSpecs(specs, rotation = 0, coverageScale = 1) {
  const allPoints = specs.flatMap((spec) => spec.points ?? []);
  if (!allPoints.length) return Object.freeze([]);
  const minX = Math.min(...allPoints.map(({ x }) => x));
  const minY = Math.min(...allPoints.map(({ y }) => y));
  const maxX = Math.max(...allPoints.map(({ x }) => x));
  const maxY = Math.max(...allPoints.map(({ y }) => y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const safeCoverageScale = clampPenroseValue(coverageScale, 1, PENROSE_PHI * PENROSE_PHI);
  const scale = 1.92 * safeCoverageScale / Math.max(1e-9, maxX - minX, maxY - minY);
  const transform = (current) => rotatePoint(
    point((current.x - centerX) * scale, (current.y - centerY) * scale),
    rotation,
  );
  return Object.freeze(specs.map((spec) => Object.freeze({
    ...spec,
    points: Object.freeze(spec.points.map(transform)),
    split: spec.split ? Object.freeze(spec.split.map(transform)) : null,
  })));
}

function finalizeGenericTiling({
  presentation,
  generation,
  sourceGeneration = generation,
  variation = 0,
  specs,
  triangles = [],
  generations = [],
  boundaryTriangles = 0,
}) {
  const info = PRESENTATION_BY_ID.get(presentation) ?? PRESENTATION_BY_ID.get("p3");
  const tiles = tileRecordsFromSpecs(specs, presentation);
  const edges = buildPenroseEdges(tiles);
  const byType = {};
  tiles.forEach((tile) => {
    byType[tile.type] = (byType[tile.type] ?? 0) + 1;
  });
  const thickCount = byType.thick ?? 0;
  const thinCount = byType.thin ?? 0;
  return Object.freeze({
    presentation,
    presentationInfo: info,
    generation,
    sourceGeneration,
    variation,
    triangles: Object.freeze(triangles),
    generations: Object.freeze(generations),
    tiles,
    edges,
    bounds: geometryBounds(tiles),
    boundaryTriangles,
    counts: Object.freeze({
      total: tiles.length,
      thick: thickCount,
      thin: thinCount,
      ratio: thinCount ? thickCount / thinCount : 0,
      byType: Object.freeze(byType),
    }),
  });
}

function createRobinsonSpecs(triangles) {
  return Object.freeze(triangles.map((triangle) => Object.freeze({
    kind: triangle.type === "thin" ? 0 : 1,
    type: triangle.type === "thin" ? "golden-triangle" : "golden-gnomon",
    label: triangle.type === "thin" ? "golden triangle" : "golden gnomon",
    points: Object.freeze([triangle.a, triangle.b, triangle.c]),
    generation: triangle.generation,
  })));
}

function pentagridOffsets(variation) {
  const seed = Math.max(0, Math.trunc(Number(variation) || 0));
  const raw = Array.from({ length: 5 }, (_, index) => (
    ((index + 1) * Math.SQRT2 * 0.37
      + seed * (index + 1) * Math.sqrt(3) * 0.1732050807568877) % 1
  ));
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  return raw.map((value) => value - mean);
}

const WORLD_PRESENTATIONS = new Set(["p3", "pentagrid", "robinson"]);
const PENTAGRID_DUAL_ERROR = 5;

function finiteCoordinate(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function penroseWorldEdgeScale(presentation, generation) {
  if (presentation !== "pentagrid") return PENROSE_PHI ** -generation;
  // Preserve the normalized finite pentagrid's generation-dependent visual
  // scale without deriving any geometry from a particular query's bounds.
  // The canonical P3 and Robinson views instead use exact inflation scale.
  return 0.96 / (5.1 + generation * 0.58);
}

function worldVertex(indices, directions, rotation, scale, fieldId) {
  let x = 0;
  let y = 0;
  for (let index = 0; index < 5; index += 1) {
    x += indices[index] * directions[index].x;
    y += indices[index] * directions[index].y;
  }
  const transformed = rotatePoint(point(x * scale, y * scale), rotation);
  return Object.freeze({
    x: transformed.x,
    y: transformed.y,
    vertexId: `${fieldId}:v:${indices.join(",")}`,
    pentagridIndices: Object.freeze([...indices]),
  });
}

function worldPolygonBounds(points) {
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function boundsOverlap(first, second) {
  return first.maxX >= second.minX
    && first.minX <= second.maxX
    && first.maxY >= second.minY
    && first.minY <= second.maxY;
}

function stableWorldEdgeKey(first, second) {
  const firstId = first.vertexId ?? pointKey(first);
  const secondId = second.vertexId ?? pointKey(second);
  return [firstId, secondId].sort().join("|");
}

function buildPenroseWorldEdges(tiles) {
  const edgeMap = new Map();
  for (const tile of tiles) {
    tile.points.forEach((first, index) => {
      const second = tile.points[(index + 1) % tile.points.length];
      const id = stableWorldEdgeKey(first, second);
      if (!edgeMap.has(id)) {
        const firstId = first.vertexId ?? pointKey(first);
        const secondId = second.vertexId ?? pointKey(second);
        const [stableFirst, stableSecond] = firstId.localeCompare(secondId) <= 0
          ? [first, second] : [second, first];
        edgeMap.set(id, {
          id,
          first: stableFirst,
          second: stableSecond,
          center: point((stableFirst.x + stableSecond.x) / 2, (stableFirst.y + stableSecond.y) / 2),
          length: Math.hypot(stableSecond.x - stableFirst.x, stableSecond.y - stableFirst.y),
          angle: ((Math.atan2(stableSecond.y - stableFirst.y, stableSecond.x - stableFirst.x) % Math.PI) + Math.PI) % Math.PI,
          tileIds: [],
          tileTypes: [],
          tileKinds: [],
        });
      }
      const edge = edgeMap.get(id);
      edge.tileIds.push(tile.id);
      edge.tileTypes.push(tile.type);
      edge.tileKinds.push(tile.kind);
    });
  }
  return Object.freeze([...edgeMap.values()].map((edge) => {
    const neighbors = edge.tileIds.map((tileId, index) => ({
      tileId,
      tileType: edge.tileTypes[index],
      tileKind: edge.tileKinds[index],
    })).sort((first, second) => first.tileId.localeCompare(second.tileId));
    return Object.freeze({
      ...edge,
      tileIds: Object.freeze(neighbors.map(({ tileId }) => tileId)),
      tileTypes: Object.freeze(neighbors.map(({ tileType }) => tileType)),
      tileKinds: Object.freeze(neighbors.map(({ tileKind }) => tileKind)),
    });
  }));
}

function worldTileRecord({
  id,
  kind,
  type,
  label,
  points,
  generation,
  pentagrid,
  split = null,
}) {
  const wound = polygonArea(points) < 0 ? [...points].reverse() : [...points];
  const frozenPoints = Object.freeze(wound);
  const center = polygonCenter(frozenPoints);
  const orientation = polygonOrientation(frozenPoints);
  return Object.freeze({
    id,
    kind,
    type,
    label,
    points: frozenPoints,
    vertexIds: Object.freeze(frozenPoints.map(({ vertexId }) => vertexId)),
    center,
    area: Math.abs(polygonArea(frozenPoints)),
    orientation,
    family: orientationFamily(orientation),
    split: split ? Object.freeze([...split]) : null,
    generation,
    pentagrid,
  });
}

function worldRhombDiagonal(points, type) {
  const diagonals = [
    { first: points[0], second: points[2] },
    { first: points[1], second: points[3] },
  ].map((diagonal) => ({
    ...diagonal,
    length: Math.hypot(
      diagonal.second.x - diagonal.first.x,
      diagonal.second.y - diagonal.first.y,
    ),
  }));
  return type === "thick"
    ? (diagonals[0].length >= diagonals[1].length ? diagonals[0] : diagonals[1])
    : (diagonals[0].length <= diagonals[1].length ? diagonals[0] : diagonals[1]);
}

function robinsonTilesFromWorldRhomb(rhomb, generation) {
  const diagonal = worldRhombDiagonal(rhomb.points, rhomb.type);
  const splitIds = new Set([diagonal.first.vertexId, diagonal.second.vertexId]);
  const others = rhomb.points.filter(({ vertexId }) => !splitIds.has(vertexId));
  return others.map((other) => worldTileRecord({
    id: `${rhomb.id}:triangle:${other.vertexId}`,
    kind: rhomb.kind,
    type: rhomb.type === "thin" ? "golden-triangle" : "golden-gnomon",
    label: rhomb.type === "thin" ? "golden triangle" : "golden gnomon",
    points: [diagonal.first, other, diagonal.second],
    generation,
    pentagrid: rhomb.pentagrid,
  }));
}

/**
 * Query one immutable window of an infinite de Bruijn Penrose field.
 *
 * Center, radius, and halo use absolute world coordinates. Radius is the
 * half-size of the square visible window and halo expands the generated cache
 * on every side. Points are never fitted or recentered, so overlapping calls
 * return stable geometry and IDs. P2 and P1 deliberately remain on the finite
 * API until their oriented local derivations are available.
 */
export function createPenroseWorldWindow({
  generation = 6,
  rotation = -Math.PI / 2,
  presentation = "p3",
  variation = 0,
  center = { x: 0, y: 0 },
  radius = 1,
  halo = 0.25,
} = {}) {
  if (!WORLD_PRESENTATIONS.has(presentation)) {
    throw new RangeError(`World-window Penrose presentation is not supported: ${presentation}`);
  }
  const targetGeneration = Math.round(clampPenroseValue(
    generation,
    PENROSE_GENERATION_MIN,
    PENROSE_GENERATION_MAX,
  ));
  const safeVariation = Math.max(0, Math.trunc(Number(variation) || 0));
  const safeRotation = finiteCoordinate(rotation, -Math.PI / 2);
  const safeCenter = point(
    finiteCoordinate(center?.x),
    finiteCoordinate(center?.y),
  );
  const edgeScale = penroseWorldEdgeScale(presentation, targetGeneration);
  const safeRadius = Math.max(edgeScale, Math.abs(finiteCoordinate(radius, 1)));
  const safeHalo = Math.max(0, finiteCoordinate(halo, 0.25));
  const extent = safeRadius + safeHalo;
  const innerBounds = Object.freeze({
    minX: safeCenter.x - safeRadius,
    minY: safeCenter.y - safeRadius,
    maxX: safeCenter.x + safeRadius,
    maxY: safeCenter.y + safeRadius,
  });
  const queryBounds = Object.freeze({
    minX: safeCenter.x - extent,
    minY: safeCenter.y - extent,
    maxX: safeCenter.x + extent,
    maxY: safeCenter.y + extent,
  });
  const offsets = pentagridOffsets(safeVariation);
  const directions = Array.from({ length: 5 }, (_, index) => point(
    Math.cos(TAU * index / 5),
    Math.sin(TAU * index / 5),
  ));
  const inverseCenter = rotatePoint(safeCenter, -safeRotation);
  const canonicalCenter = point(inverseCenter.x / edgeScale, inverseCenter.y / edgeScale);
  const gridBias = point(
    offsets.reduce((sum, value, index) => sum + value * directions[index].x, 0),
    offsets.reduce((sum, value, index) => sum + value * directions[index].y, 0),
  );
  const gridCenter = point(
    (canonicalCenter.x - gridBias.x) / 2.5,
    (canonicalCenter.y - gridBias.y) / 2.5,
  );
  const canonicalRadius = Math.SQRT2 * extent / edgeScale;
  const gridRadius = (canonicalRadius + PENTAGRID_DUAL_ERROR) / 2.5 + 1e-8;
  const fieldId = `pg:${safeVariation}`;
  const rhombs = [];

  for (let firstFamily = 0; firstFamily < 5; firstFamily += 1) {
    const firstDirection = directions[firstFamily];
    const firstOffset = offsets[firstFamily];
    const firstProjection = gridCenter.x * firstDirection.x + gridCenter.y * firstDirection.y;
    const firstMinimum = Math.ceil(firstProjection - gridRadius + firstOffset);
    const firstMaximum = Math.floor(firstProjection + gridRadius + firstOffset);
    for (let secondFamily = firstFamily + 1; secondFamily < 5; secondFamily += 1) {
      const secondDirection = directions[secondFamily];
      const secondOffset = offsets[secondFamily];
      const determinant = firstDirection.x * secondDirection.y
        - firstDirection.y * secondDirection.x;
      if (Math.abs(determinant) < 1e-12) continue;
      const secondProjection = gridCenter.x * secondDirection.x + gridCenter.y * secondDirection.y;
      const secondMinimum = Math.ceil(secondProjection - gridRadius + secondOffset);
      const secondMaximum = Math.floor(secondProjection + gridRadius + secondOffset);
      const difference = secondFamily - firstFamily;
      const familyGap = Math.min(difference, 5 - difference);
      const kind = familyGap === 1 ? 1 : 0;

      for (let firstLine = firstMinimum; firstLine <= firstMaximum; firstLine += 1) {
        const firstCoordinate = firstLine - firstOffset;
        for (let secondLine = secondMinimum; secondLine <= secondMaximum; secondLine += 1) {
          const secondCoordinate = secondLine - secondOffset;
          const x = (firstCoordinate * secondDirection.y
            - secondCoordinate * firstDirection.y) / determinant;
          const y = (secondCoordinate * firstDirection.x
            - firstCoordinate * secondDirection.x) / determinant;
          if (Math.hypot(x - gridCenter.x, y - gridCenter.y) > gridRadius) continue;

          const indices = directions.map((direction, index) => {
            if (index === firstFamily) return firstLine;
            if (index === secondFamily) return secondLine;
            return Math.ceil(x * direction.x + y * direction.y + offsets[index]);
          });
          const vertex = (firstDelta, secondDelta) => {
            const next = [...indices];
            next[firstFamily] += firstDelta;
            next[secondFamily] += secondDelta;
            return worldVertex(next, directions, safeRotation, edgeScale, fieldId);
          };
          const points = [vertex(0, 0), vertex(1, 0), vertex(1, 1), vertex(0, 1)];
          if (!boundsOverlap(worldPolygonBounds(points), queryBounds)) continue;
          const type = kind === 0 ? "thin" : "thick";
          const diagonal = worldRhombDiagonal(points, type);
          rhombs.push(worldTileRecord({
            id: `${fieldId}:tile:${firstFamily}:${firstLine}:${secondFamily}:${secondLine}`,
            kind,
            type,
            label: `${type} rhomb`,
            points,
            generation: targetGeneration,
            split: [diagonal.first, diagonal.second],
            pentagrid: Object.freeze({
              firstFamily,
              firstLine,
              secondFamily,
              secondLine,
              indices: Object.freeze(indices),
            }),
          }));
        }
      }
    }
  }

  rhombs.sort((first, second) => first.id.localeCompare(second.id));
  const tiles = Object.freeze(presentation === "robinson"
    ? rhombs.flatMap((rhomb) => robinsonTilesFromWorldRhomb(rhomb, targetGeneration))
    : rhombs);
  const edges = buildPenroseWorldEdges(tiles);
  const byType = {};
  tiles.forEach((tile) => {
    byType[tile.type] = (byType[tile.type] ?? 0) + 1;
  });
  const thinCount = byType.thin ?? byType["golden-triangle"] ?? 0;
  const thickCount = byType.thick ?? byType["golden-gnomon"] ?? 0;
  return Object.freeze({
    presentation,
    presentationInfo: PRESENTATION_BY_ID.get(presentation),
    generation: targetGeneration,
    sourceGeneration: targetGeneration,
    variation: safeVariation,
    triangles: Object.freeze([]),
    generations: Object.freeze([]),
    tiles,
    edges,
    bounds: geometryBounds(tiles),
    boundaryTriangles: 0,
    edgeScale,
    window: Object.freeze({
      center: safeCenter,
      radius: safeRadius,
      halo: safeHalo,
      innerBounds,
      queryBounds,
    }),
    field: Object.freeze({
      id: fieldId,
      method: "de-bruijn-pentagrid",
      offsets: Object.freeze([...offsets]),
    }),
    counts: Object.freeze({
      total: tiles.length,
      thick: thickCount,
      thin: thinCount,
      ratio: thinCount ? thickCount / thinCount : 0,
      byType: Object.freeze(byType),
    }),
  });
}

/** De Bruijn pentagrid P3 patch; variation changes the five grid phases. */
export function createPenrosePentagridSpecs({
  generation = 6,
  variation = 0,
  coverageScale = 1,
} = {}) {
  const targetGeneration = Math.round(clampPenroseValue(
    generation,
    PENROSE_GENERATION_MIN,
    PENROSE_GENERATION_MAX,
  ));
  const safeCoverageScale = clampPenroseValue(
    coverageScale,
    1,
    PENROSE_PHI * PENROSE_PHI,
  );
  const radius = (3.1 + targetGeneration * 0.58) * safeCoverageScale;
  const gridLimit = 2 * radius / 5 + 4;
  const outputLimit = radius + 2;
  const offsets = pentagridOffsets(variation);
  const directions = Array.from({ length: 5 }, (_, index) => point(
    Math.cos(Math.PI * index / 5),
    Math.sin(Math.PI * index / 5),
  ));
  const specs = [];

  for (let firstFamily = 0; firstFamily < 5; firstFamily += 1) {
    const firstDirection = directions[firstFamily];
    const firstOffset = offsets[firstFamily];
    for (let secondFamily = firstFamily + 1; secondFamily < 5; secondFamily += 1) {
      const secondDirection = directions[secondFamily];
      const secondOffset = offsets[secondFamily];
      const determinant = firstDirection.x * secondDirection.y
        - firstDirection.y * secondDirection.x;
      if (Math.abs(determinant) < 1e-9) continue;
      const difference = secondFamily - firstFamily;
      const kind = Math.min(difference, 5 - difference) - 1;
      const firstMinimum = Math.ceil(-gridLimit - firstOffset);
      const firstMaximum = Math.floor(gridLimit - firstOffset);
      const secondMinimum = Math.ceil(-gridLimit - secondOffset);
      const secondMaximum = Math.floor(gridLimit - secondOffset);

      for (let firstLine = firstMinimum; firstLine <= firstMaximum; firstLine += 1) {
        const firstCoordinate = firstLine - firstOffset;
        for (let secondLine = secondMinimum; secondLine <= secondMaximum; secondLine += 1) {
          const secondCoordinate = secondLine - secondOffset;
          const x = (firstCoordinate * secondDirection.y
            - secondCoordinate * firstDirection.y) / determinant;
          const y = (secondCoordinate * firstDirection.x
            - firstCoordinate * secondDirection.x) / determinant;
          if (x * x + y * y > gridLimit * gridLimit) continue;

          const indices = new Array(5);
          let degenerate = false;
          for (let index = 0; index < 5; index += 1) {
            if (index === firstFamily) indices[index] = firstLine;
            else if (index === secondFamily) indices[index] = secondLine;
            else {
              const value = x * directions[index].x + y * directions[index].y + offsets[index];
              if (Math.abs(value - Math.round(value)) < 1e-7) degenerate = true;
              indices[index] = Math.ceil(value);
            }
          }
          if (degenerate) continue;

          const vertex = (firstDelta, secondDelta) => {
            let vertexX = 0;
            let vertexY = 0;
            for (let index = 0; index < 5; index += 1) {
              const coefficient = indices[index]
                + (index === firstFamily ? firstDelta : index === secondFamily ? secondDelta : 0);
              vertexX += coefficient * directions[index].x;
              vertexY += coefficient * directions[index].y;
            }
            return point(vertexX, vertexY);
          };
          const points = [vertex(0, 0), vertex(1, 0), vertex(1, 1), vertex(0, 1)];
          if (
            points.every((current) => current.x < -outputLimit)
            || points.every((current) => current.y < -outputLimit)
            || points.every((current) => current.x > outputLimit)
            || points.every((current) => current.y > outputLimit)
          ) continue;
          specs.push(Object.freeze({
            kind,
            type: kind === 0 ? "thin" : "thick",
            label: kind === 0 ? "thin rhomb" : "thick rhomb",
            points: Object.freeze(points),
            generation: targetGeneration,
          }));
        }
      }
    }
  }
  return normalizeTileSpecs(specs, -Math.PI / 2, safeCoverageScale);
}

/*
 * P1 decomposition below follows the public-domain L-system implementation in
 * Ginden/tilings, itself based on Andrew Stacey’s documented Penrose package.
 */
const P1_DEG = Math.PI / 180;
const P1_COS18 = Math.cos(18 * P1_DEG);
const P1_COS36 = Math.cos(36 * P1_DEG);
const P1_COS72 = Math.cos(72 * P1_DEG);
const P1_COS108 = Math.cos(108 * P1_DEG);
const P1_SIN18 = Math.sin(18 * P1_DEG);
const P1_SIN36 = Math.sin(36 * P1_DEG);
const P1_SIN72 = Math.sin(72 * P1_DEG);
const P1_SIN108 = Math.sin(108 * P1_DEG);
const P1_TAN54 = Math.tan(54 * P1_DEG);
const P1_TAN72 = Math.tan(72 * P1_DEG);
const P1_INFLATION = PENROSE_PHI * PENROSE_PHI;
const P1_RULES = Object.freeze({
  P: "[s>P][1sF+Q][1+sF+Q][1*sF+Q][1-sF+Q][1_sF+Q]",
  Q: "[s>P][1+sFR][1*sF*R][1-sF+Q][1_sF+Q][1sF+Q][->fsD]",
  R: "[s>P][1-sF+Q][1+sF*R][1*sFR][1_sF*R][1sFR][_>fsD][>fsD]",
  G: "[s>G][se[>d+R][e1B]][+se[>d+R][e1B]][-se[>d+R][e1B]][*se[>d+R][e1B]][_se[>d+R][e1B]]",
  B: "[s>G][se[>d+R][e1B]][+se[>d+R][e1B]][-se[>d+R][e1B]]",
  D: "[s>d+R][s>eG][se1B]",
});
const P1_PENTAGON = Object.freeze([
  point(0, 0),
  point(P1_COS108, P1_SIN108),
  point(1 + P1_COS72 + Math.cos(144 * P1_DEG), P1_SIN72 + Math.sin(144 * P1_DEG)),
  point(1 + P1_COS72, P1_SIN72),
  point(1, 0),
]);
const P1_OUTLINES = Object.freeze({
  P: P1_PENTAGON,
  Q: P1_PENTAGON,
  R: P1_PENTAGON,
  G: Object.freeze([
    point(1, 0), point(1 - P1_COS36, -P1_SIN36),
    point(1 - P1_COS36 - P1_COS108, -P1_SIN36 - P1_SIN108),
    point(P1_COS108, -P1_SIN108),
    point(-1 + 3 * P1_COS108 + P1_COS36, -P1_SIN36 - P1_SIN108),
    point(-1 + 2 * P1_COS108 + P1_COS36, -P1_SIN36),
    point(-1 + 2 * P1_COS108, 0), point(2 * P1_COS108, 0),
    point(P1_COS108, P1_SIN108), point(0, 0),
  ]),
  B: Object.freeze([
    point(-1 + 2 * P1_COS108, 0), point(2 * P1_COS108, 0),
    point(P1_COS108, P1_SIN108), point(0, 0), point(1, 0),
    point(1 - P1_COS36, -P1_SIN36),
    point(-1 + 2 * P1_COS108 + P1_COS36, -P1_SIN36),
  ]),
  D: Object.freeze([
    point(0, 0), point(P1_COS18, P1_SIN18), point(2 * P1_COS18, 0),
    point(P1_COS18, -P1_SIN18),
  ]),
});
const P1_KIND = Object.freeze({ P: 0, Q: 1, R: 2, G: 3, B: 4, D: 5 });
const P1_TYPE = Object.freeze({
  P: "pentagon-p5", Q: "pentagon-p3", R: "pentagon-p2",
  G: "star", B: "boat", D: "diamond",
});
const P1_LABEL = Object.freeze({
  P: "pentagon P5", Q: "pentagon P3", R: "pentagon P2",
  G: "star", B: "boat", D: "diamond",
});

function affineMultiply(first, second) {
  return [
    first[0] * second[0] + first[1] * second[3],
    first[0] * second[1] + first[1] * second[4],
    first[0] * second[2] + first[1] * second[5] + first[2],
    first[3] * second[0] + first[4] * second[3],
    first[3] * second[1] + first[4] * second[4],
    first[3] * second[2] + first[4] * second[5] + first[5],
  ];
}

function affineApply(transform, current) {
  return point(
    transform[0] * current.x + transform[1] * current.y + transform[2],
    transform[3] * current.x + transform[4] * current.y + transform[5],
  );
}

function affineRotation(angle) {
  return [Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle), 0];
}

function affineTranslation(x, y) {
  return [1, 0, x, 0, 1, y];
}

function affineScaling(scale) {
  return [scale, 0, 0, 0, scale, 0];
}

function p1TileTransform(symbol, state) {
  if (symbol === "P" || symbol === "Q" || symbol === "R") {
    return affineMultiply(state.transform, affineMultiply(
      affineTranslation(-state.step / 2, -state.step * P1_TAN54 / 2),
      affineScaling(state.step),
    ));
  }
  if (symbol === "G" || symbol === "B") {
    return affineMultiply(state.transform, affineMultiply(
      affineTranslation(state.step * P1_COS72, state.step * P1_TAN54 * P1_COS72),
      affineScaling(state.step),
    ));
  }
  return affineMultiply(state.transform, affineMultiply(
    affineRotation(90 * P1_DEG),
    affineMultiply(affineTranslation(-state.step * P1_COS18, 0), affineScaling(state.step)),
  ));
}

function interpretP1(sequence, depth, initialState, specs) {
  let state = { ...initialState };
  const stack = [];
  const local = (transform) => {
    state.transform = affineMultiply(state.transform, transform);
  };
  for (const symbol of sequence) {
    if (symbol === "[") stack.push({ transform: [...state.transform], step: state.step });
    else if (symbol === "]") state = stack.pop();
    else if (symbol === "1") continue;
    else if (symbol === "+") local(affineRotation(72 * P1_DEG));
    else if (symbol === "*") local(affineRotation(144 * P1_DEG));
    else if (symbol === "-") local(affineRotation(288 * P1_DEG));
    else if (symbol === "_") local(affineRotation(216 * P1_DEG));
    else if (symbol === ">") local(affineRotation(Math.PI));
    else if (symbol === "|") local([-1, 0, 0, 0, 1, 0]);
    else if (symbol === "s") state.step /= P1_INFLATION;
    else if (symbol === "f") local(affineTranslation(0, P1_TAN54 * state.step / 2));
    else if (symbol === "F") local(affineTranslation(0, P1_TAN54 * state.step));
    else if (symbol === "d") local(affineTranslation(
      0,
      (P1_TAN54 / 2 - P1_TAN72 / 2 + P1_SIN36) * state.step,
    ));
    else if (symbol === "e") local(affineTranslation(0, P1_TAN54 * P1_COS36 * state.step));
    else if (Object.hasOwn(P1_RULES, symbol)) {
      if (depth > 0) {
        state = interpretP1(P1_RULES[symbol], depth - 1, state, specs);
        continue;
      }
      const transform = p1TileTransform(symbol, state);
      specs.push(Object.freeze({
        kind: P1_KIND[symbol],
        type: P1_TYPE[symbol],
        label: P1_LABEL[symbol],
        points: Object.freeze(P1_OUTLINES[symbol].map((current) => affineApply(transform, current))),
        generation: depth,
      }));
    }
  }
  return state;
}

export function createPenroseP1Specs({
  generation = 6,
  rotation = -Math.PI / 2,
  coverageScale = 1,
} = {}) {
  const targetGeneration = Math.round(clampPenroseValue(
    generation,
    PENROSE_GENERATION_MIN,
    PENROSE_GENERATION_MAX,
  ));
  const depth = Math.min(4, Math.max(1, Math.ceil(targetGeneration * 0.58)));
  const specs = [];
  interpretP1("P", depth, {
    transform: [1, 0, 0, 0, 1, 0],
    step: P1_INFLATION ** depth,
  }, specs);
  const safeCoverageScale = clampPenroseValue(
    coverageScale,
    1,
    PENROSE_PHI * PENROSE_PHI,
  );
  const cropRadius = Math.max(1.4, P1_INFLATION ** (depth - 1) / 3) * safeCoverageScale;
  const cropped = specs.filter((spec) => spec.points.some((current) => (
    Math.abs(current.x) <= cropRadius && Math.abs(current.y) <= cropRadius
  )));
  return Object.freeze({
    depth,
    specs: normalizeTileSpecs(cropped, rotation, safeCoverageScale),
  });
}

function scaleTrianglePatch(triangles, scale) {
  if (Math.abs(scale - 1) < 1e-10) return triangles;
  const scaledPoint = (current) => point(current.x * scale, current.y * scale);
  return Object.freeze(triangles.map((triangle) => Object.freeze({
    ...triangle,
    a: scaledPoint(triangle.a),
    b: scaledPoint(triangle.b),
    c: scaledPoint(triangle.c),
  })));
}

/** Build one of the standard finite Penrose presentations. */
export function createPenroseTiling({
  generation = 6,
  rotation = -Math.PI / 2,
  presentation = "p3",
  variation = 0,
  overscan = 0,
} = {}) {
  const targetGeneration = Math.round(clampPenroseValue(
    generation,
    PENROSE_GENERATION_MIN,
    PENROSE_GENERATION_MAX,
  ));
  const safePresentation = PRESENTATION_BY_ID.has(presentation) ? presentation : "p3";
  const safeOverscan = Math.round(clampPenroseValue(overscan, 0, 2));
  const sourceGeneration = targetGeneration + safeOverscan;
  const coverageScale = PENROSE_PHI ** safeOverscan;

  if (safePresentation === "pentagrid") {
    return finalizeGenericTiling({
      presentation: safePresentation,
      generation: targetGeneration,
      sourceGeneration,
      variation,
      specs: createPenrosePentagridSpecs({
        generation: targetGeneration,
        variation,
        coverageScale,
      }),
    });
  }

  if (safePresentation === "p1") {
    const generated = createPenroseP1Specs({
      generation: targetGeneration,
      rotation,
      coverageScale,
    });
    return finalizeGenericTiling({
      presentation: safePresentation,
      generation: targetGeneration,
      sourceGeneration,
      variation,
      specs: generated.specs,
    });
  }

  if (safePresentation === "p2") {
    const generations = [scaleTrianglePatch(createPenroseKiteSeed(rotation), coverageScale)];
    while (generations.length <= sourceGeneration) {
      generations.push(subdividePenroseKiteDartTriangles(generations.at(-1)));
    }
    const triangles = generations[sourceGeneration];
    const paired = pairPenroseKiteDartTriangles(triangles);
    return finalizeGenericTiling({
      presentation: safePresentation,
      generation: targetGeneration,
      sourceGeneration,
      variation,
      specs: paired.specs.map((spec) => Object.freeze({
        ...spec,
        label: spec.type,
      })),
      triangles,
      generations,
      boundaryTriangles: paired.boundaryTriangles,
    });
  }

  const generations = [scaleTrianglePatch(createPenroseSunSeed(rotation), coverageScale)];
  while (generations.length <= sourceGeneration) {
    generations.push(subdividePenroseTriangles(generations.at(-1)));
  }
  const triangles = generations[sourceGeneration];

  if (safePresentation === "robinson") {
    return finalizeGenericTiling({
      presentation: safePresentation,
      generation: targetGeneration,
      sourceGeneration,
      variation,
      specs: createRobinsonSpecs(triangles),
      triangles,
      generations,
    });
  }

  const paired = pairPenroseTriangles(triangles);
  const edges = buildPenroseEdges(paired.tiles);
  const thickCount = paired.tiles.filter(({ type }) => type === "thick").length;
  const thinCount = paired.tiles.length - thickCount;
  return Object.freeze({
    presentation: safePresentation,
    presentationInfo: PRESENTATION_BY_ID.get(safePresentation),
    variation,
    generation: targetGeneration,
    sourceGeneration,
    triangles,
    generations: Object.freeze(generations),
    tiles: paired.tiles,
    edges,
    bounds: geometryBounds(paired.tiles),
    boundaryTriangles: paired.boundaryTriangles,
    counts: Object.freeze({
      total: paired.tiles.length,
      thick: thickCount,
      thin: thinCount,
      ratio: thinCount ? thickCount / thinCount : 0,
      byType: Object.freeze({ thick: thickCount, thin: thinCount }),
    }),
  });
}

/**
 * Build a reader by finite-patch phase or absolute world center/normal offset.
 * `span` is the half-length from the center to either endpoint.
 */
export function createPenroseReader({
  bounds,
  phase = 0.5,
  angle = Math.PI / 2,
  offset: requestedOffset,
  center: requestedCenter,
  span: requestedSpan,
} = {}) {
  const safeBounds = bounds ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const safeAngle = finiteCoordinate(angle, Math.PI / 2);
  const direction = point(Math.cos(safeAngle), Math.sin(safeAngle));
  // Use the right-hand normal so phase zero is the visual left/bottom side
  // for the familiar 90° vertical and 0° horizontal readers.
  const normal = point(direction.y, -direction.x);
  const corners = [
    point(safeBounds.minX, safeBounds.minY),
    point(safeBounds.maxX, safeBounds.minY),
    point(safeBounds.maxX, safeBounds.maxY),
    point(safeBounds.minX, safeBounds.maxY),
  ];
  const projections = corners.map((corner) => corner.x * normal.x + corner.y * normal.y);
  const minimum = Math.min(...projections);
  const maximum = Math.max(...projections);
  const safePhase = clampPenroseValue(phase);
  const phaseOffset = minimum + (maximum - minimum) * safePhase;
  const hasExplicitOffset = requestedOffset !== null
    && requestedOffset !== undefined
    && Number.isFinite(Number(requestedOffset));
  const hasExplicitCenter = requestedCenter !== null
    && typeof requestedCenter === "object";
  let readerCenter = hasExplicitCenter ? point(
    finiteCoordinate(requestedCenter.x),
    finiteCoordinate(requestedCenter.y),
  ) : null;
  let offset = hasExplicitOffset ? finiteCoordinate(requestedOffset) : phaseOffset;
  if (readerCenter && !hasExplicitOffset) {
    offset = readerCenter.x * normal.x + readerCenter.y * normal.y;
  }
  if (readerCenter) {
    const correction = offset - (readerCenter.x * normal.x + readerCenter.y * normal.y);
    readerCenter = point(
      readerCenter.x + normal.x * correction,
      readerCenter.y + normal.y * correction,
    );
  } else {
    readerCenter = point(normal.x * offset, normal.y * offset);
  }
  const defaultSpan = Math.hypot(
    safeBounds.maxX - safeBounds.minX,
    safeBounds.maxY - safeBounds.minY,
  ) * 0.72;
  const span = requestedSpan !== null
    && requestedSpan !== undefined
    && Number.isFinite(Number(requestedSpan))
    ? Math.max(1e-9, Math.abs(Number(requestedSpan)))
    : Math.max(1e-9, defaultSpan);
  const tangentOffset = readerCenter.x * direction.x + readerCenter.y * direction.y;
  return Object.freeze({
    phase: hasExplicitOffset || hasExplicitCenter ? null : safePhase,
    angle: safeAngle,
    direction,
    normal,
    offset,
    tangentOffset,
    center: readerCenter,
    span,
    first: point(readerCenter.x - direction.x * span, readerCenter.y - direction.y * span),
    second: point(readerCenter.x + direction.x * span, readerCenter.y + direction.y * span),
  });
}

function penroseReaderTangentOffset(reader) {
  const explicit = Number(reader?.tangentOffset);
  if (reader?.tangentOffset !== null && reader?.tangentOffset !== undefined
    && Number.isFinite(explicit)) return explicit;
  const center = reader?.center ?? point(
    ((reader?.first?.x ?? 0) + (reader?.second?.x ?? 0)) / 2,
    ((reader?.first?.y ?? 0) + (reader?.second?.y ?? 0)) / 2,
  );
  return center.x * reader.direction.x + center.y * reader.direction.y;
}

/** Intersect the reader with unique physical tile edges. */
export function contactsForPenroseReader(tiling, reader) {
  if (!tiling?.edges || !reader) return Object.freeze([]);
  const tangentOffset = penroseReaderTangentOffset(reader);
  const tangentSpan = Math.max(1e-9, Math.hypot(
    reader.second.x - reader.first.x,
    reader.second.y - reader.first.y,
  ) / 2);
  const contacts = [];
  for (const edge of tiling.edges) {
    const firstDistance = edge.first.x * reader.normal.x
      + edge.first.y * reader.normal.y - reader.offset;
    const secondDistance = edge.second.x * reader.normal.x
      + edge.second.y * reader.normal.y - reader.offset;
    if (Math.abs(firstDistance) > 1e-9 && Math.abs(secondDistance) > 1e-9
      && Math.sign(firstDistance) === Math.sign(secondDistance)) continue;
    const denominator = firstDistance - secondDistance;
    const amount = Math.abs(denominator) < 1e-12 ? 0 : firstDistance / denominator;
    if (amount < -1e-9 || amount > 1 + 1e-9) continue;
    const intersection = interpolate(edge.first, edge.second, clampPenroseValue(amount));
    const along = intersection.x * reader.direction.x
      + intersection.y * reader.direction.y - tangentOffset;
    if (Math.abs(along) > tangentSpan + 1e-9) continue;
    const along01 = clampPenroseValue(along / (tangentSpan * 2) + 0.5);
    const incidence = clampPenroseValue(Math.abs(
      Math.cos(edge.angle - reader.angle)
    ));
    contacts.push(Object.freeze({
      id: edge.id,
      edgeId: edge.id,
      point: intersection,
      along,
      along01,
      height01: 1 - along01,
      amount: clampPenroseValue(amount),
      incidence,
      orientation: edge.angle / Math.PI,
      edgeAngle: edge.angle,
      family: orientationFamily(edge.angle),
      tileIds: edge.tileIds,
      tileTypes: edge.tileTypes,
      tileKinds: edge.tileKinds,
      boundary: edge.tileIds.length === 1,
    }));
  }
  contacts.sort((first, second) => first.along - second.along || first.id.localeCompare(second.id));
  return Object.freeze(contacts);
}

/** Rank physical edges that will next enter a reader moving through the tiling. */
export function upcomingPenroseEdges(tiling, reader, direction = 1, limit = 64) {
  if (!tiling?.edges || !reader) return Object.freeze([]);
  const scanDirection = Number(direction) < 0 ? -1 : 1;
  const tangentOffset = penroseReaderTangentOffset(reader);
  const tangentSpan = Math.max(1e-9, Math.hypot(
    reader.second.x - reader.first.x,
    reader.second.y - reader.first.y,
  ) / 2);
  const candidates = [];
  for (const edge of tiling.edges) {
    if (edge.tileIds.length < 2) continue;
    const firstNormalDistance = edge.first.x * reader.normal.x
      + edge.first.y * reader.normal.y - reader.offset;
    const secondNormalDistance = edge.second.x * reader.normal.x
      + edge.second.y * reader.normal.y - reader.offset;
    const firstAlong = edge.first.x * reader.direction.x
      + edge.first.y * reader.direction.y - tangentOffset;
    const secondAlong = edge.second.x * reader.direction.x
      + edge.second.y * reader.direction.y - tangentOffset;
    let firstAmount = 0;
    let secondAmount = 1;
    const alongDelta = secondAlong - firstAlong;
    if (Math.abs(alongDelta) < 1e-12) {
      if (Math.abs(firstAlong) > tangentSpan + 1e-9) continue;
    } else {
      const firstIntersection = (-tangentSpan - firstAlong) / alongDelta;
      const secondIntersection = (tangentSpan - firstAlong) / alongDelta;
      firstAmount = Math.max(0, Math.min(firstIntersection, secondIntersection));
      secondAmount = Math.min(1, Math.max(firstIntersection, secondIntersection));
      if (firstAmount > secondAmount + 1e-9) continue;
    }
    const firstDistance = firstNormalDistance
      + (secondNormalDistance - firstNormalDistance) * firstAmount;
    const secondDistance = firstNormalDistance
      + (secondNormalDistance - firstNormalDistance) * secondAmount;
    const firstPoint = interpolate(edge.first, edge.second, clampPenroseValue(firstAmount));
    const secondPoint = interpolate(edge.first, edge.second, clampPenroseValue(secondAmount));
    if (firstDistance * secondDistance <= 0) continue;
    if (Math.abs(firstDistance - secondDistance) < 1e-12) continue;
    let distance;
    let pointAtEntry;
    if (scanDirection > 0 && firstDistance > 0 && secondDistance > 0) {
      if (firstDistance <= secondDistance) {
        distance = firstDistance;
        pointAtEntry = firstPoint;
      } else {
        distance = secondDistance;
        pointAtEntry = secondPoint;
      }
    } else if (scanDirection < 0 && firstDistance < 0 && secondDistance < 0) {
      if (firstDistance >= secondDistance) {
        distance = -firstDistance;
        pointAtEntry = firstPoint;
      } else {
        distance = -secondDistance;
        pointAtEntry = secondPoint;
      }
    } else continue;
    if (!(distance > 1e-9)) continue;
    const along = pointAtEntry.x * reader.direction.x
      + pointAtEntry.y * reader.direction.y - tangentOffset;
    if (Math.abs(along) > tangentSpan + 1e-9) continue;
    candidates.push(Object.freeze({
      edge,
      edgeId: edge.id,
      distance,
      point: pointAtEntry,
      along,
    }));
  }
  candidates.sort((first, second) => (
    first.distance - second.distance
      || Math.abs(first.along) - Math.abs(second.along)
      || first.edgeId.localeCompare(second.edgeId)
  ));
  return Object.freeze(candidates.slice(0, Math.max(0, Math.trunc(Number(limit) || 0))));
}

/** Greedily color the tile-adjacency graph so shared edges separate visually. */
export function colorPenroseTiles(tiling, colorCount = 6, seedColors = null) {
  const count = Math.max(2, Math.trunc(Number(colorCount) || 6));
  const adjacency = new Map((tiling?.tiles ?? []).map(({ id }) => [id, new Set()]));
  for (const edge of tiling?.edges ?? []) {
    if (edge.tileIds.length !== 2) continue;
    const [first, second] = edge.tileIds;
    adjacency.get(first)?.add(second);
    adjacency.get(second)?.add(first);
  }
  const colors = new Map();
  if (seedColors && typeof seedColors.get === "function") {
    for (const tile of tiling?.tiles ?? []) {
      const seeded = Number(seedColors.get(tile.id));
      if (Number.isInteger(seeded) && seeded >= 0 && seeded < count) {
        colors.set(tile.id, seeded);
      }
    }
  }
  const ordered = [...(tiling?.tiles ?? [])]
    .filter(({ id }) => !colors.has(id))
    .sort((first, second) => (
    (adjacency.get(second.id)?.size ?? 0) - (adjacency.get(first.id)?.size ?? 0)
      || first.id.localeCompare(second.id)
  ));
  for (const tile of ordered) {
    const used = new Set(
      [...(adjacency.get(tile.id) ?? [])]
        .map((id) => colors.get(id))
        .filter((value) => value !== undefined),
    );
    const preferred = ((tile.kind * 3 + tile.family * 2) % count + count) % count;
    let selected = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const candidate = (preferred + offset) % count;
      if (!used.has(candidate)) {
        selected = candidate;
        break;
      }
    }
    colors.set(tile.id, selected);
  }
  return colors;
}

export function newlyEnteredPenroseContacts(contacts, previousKeys) {
  const previous = previousKeys instanceof Set ? previousKeys : new Set(previousKeys ?? []);
  return (contacts ?? []).filter((contact) => !previous.has(contact.edgeId));
}

export function penrosePitch01(contact, source = "family") {
  if (!contact) return 0.5;
  if (source === "height") {
    const relativeHeight = Number(contact.height01);
    if (Number.isFinite(relativeHeight)) return clampPenroseValue(relativeHeight);
    return clampPenroseValue((1 - contact.point.y) / 2);
  }
  if (source === "along") return clampPenroseValue(contact.along01);
  if (source === "incidence") return clampPenroseValue(contact.incidence);
  if (source === "tile") {
    if (contact.tileTypes.includes("thick") && contact.tileTypes.includes("thin")) return 0.5;
    if (contact.tileTypes.includes("thick")) return 0.72;
    if (contact.tileTypes.includes("thin")) return 0.28;
    const kinds = contact.tileKinds ?? [];
    if (kinds.length) return clampPenroseValue(
      kinds.reduce((sum, value) => sum + value, 0) / kinds.length / 5,
    );
    return 0.5;
  }
  return clampPenroseValue((contact.family ?? 0) / 4);
}

export function pointInPenroseTile(tile, target) {
  if (!tile?.points || !target) return false;
  let inside = false;
  for (let index = 0; index < tile.points.length; index += 1) {
    const first = tile.points[index];
    const second = tile.points[(index + 1) % tile.points.length];
    const cross = (second.x - first.x) * (target.y - first.y)
      - (second.y - first.y) * (target.x - first.x);
    const withinX = target.x >= Math.min(first.x, second.x) - 1e-10
      && target.x <= Math.max(first.x, second.x) + 1e-10;
    const withinY = target.y >= Math.min(first.y, second.y) - 1e-10
      && target.y <= Math.max(first.y, second.y) + 1e-10;
    if (Math.abs(cross) < 1e-10 && withinX && withinY) return true;
    const crossesRay = (first.y > target.y) !== (second.y > target.y)
      && target.x < (second.x - first.x) * (target.y - first.y)
        / (second.y - first.y) + first.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

export function penroseTileAtPoint(tiling, target) {
  return tiling?.tiles?.find((tile) => pointInPenroseTile(tile, target)) ?? null;
}

export function normalizedPenrosePhase(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % 1) + 1) % 1;
}

export function penroseOrientationLabel(family) {
  const index = ((Math.round(Number(family) || 0) % 5) + 5) % 5;
  return `${Math.round(index * TAU / 5 * 180 / Math.PI)}° family`;
}
