/**
 * Globally coherent P2 (kite-and-dart) geometry derived from a marked P3
 * pentagrid window.
 *
 * This is a local derivation, not a second finite substitution patch. On an
 * oriented P3 tiling, keep the two edges incident to the marked vertex of each
 * thin rhomb and the long diagonal of each thick rhomb. The bounded faces of
 * that graph are exactly the P2 kites and darts.
 *
 * Sources:
 * - de Bruijn (1981), https://alexandria.tue.nl/repository/freearticles/597566.pdf
 * - Bettencourt (2015), section 5.1, figures 31-32:
 *   https://www.cs.toronto.edu/~jessebett/projects/penrose-tiling/Thesis/Bettencourt_Penrose_Tiling_Thesis_2015_reducedsize.pdf
 * - Owens & Stepney (2010), figures 18.2-18.3:
 *   https://www-users.york.ac.uk/~ss44/bib/ss/nonstd/penroselife.pdf
 *
 * Source vertices retain exact five-dimensional pentagrid addresses and stable
 * ids. Without the P3 marking, a bare geometric thin rhomb is ambiguous.
 */

const EPSILON = 1e-9;
const TAU = Math.PI * 2;

const point = ({ x, y }) => Object.freeze({ x: Number(x), y: Number(y) });
const modulo = (value, modulus) => ((value % modulus) + modulus) % modulus;
const pairKey = (first, second) => (
  first < second ? `${first}|${second}` : `${second}|${first}`
);

function verticesForRhomb(tile) {
  if (!Array.isArray(tile?.points) || tile.points.length !== 4) {
    throw new TypeError(`P3 rhomb ${tile?.id ?? "(unknown)"} must have four points`);
  }
  const vertices = tile.points.map((source, index) => {
    const address = source.pentagridIndices
      ?? tile.vertexAddresses?.[index]
      ?? tile.vertexIndices?.[index];
    const id = source.vertexId ?? tile.vertexIds?.[index];
    if (!id) {
      throw new TypeError(`P3 rhomb ${tile?.id ?? "(unknown)"} needs stable vertex ids`);
    }
    return Object.freeze({
      id: String(id),
      point: point(source),
      address: Array.isArray(address) ? Object.freeze(address.map(Number)) : null,
      marked: Boolean(source.marked),
    });
  });
  if (new Set(vertices.map(({ id }) => id)).size !== 4) {
    throw new TypeError(`P3 rhomb ${tile?.id ?? "(unknown)"} repeats a vertex id`);
  }
  return Object.freeze(vertices);
}

/**
 * Find a P3 rhomb's de Bruijn mark.
 *
 * With pentagrid offsets summing to zero, the four corner address sums are
 * (1,2,2,3) or (2,3,3,4). The unique index-1 or index-4 corner is marked.
 */
export function markedPenroseRhombVertexIndex(tile) {
  const vertices = verticesForRhomb(tile);
  if (Number.isInteger(tile.markedVertexIndex)) return modulo(tile.markedVertexIndex, 4);
  if (tile.markedVertexId != null) {
    const index = vertices.findIndex(({ id }) => id === String(tile.markedVertexId));
    if (index >= 0) return index;
  }
  const explicit = vertices
    .map(({ marked }, index) => (marked ? index : -1))
    .filter((index) => index >= 0);
  if (explicit.length === 1) return explicit[0];

  const indexed = vertices.map(({ address }, index) => ({
    index,
    sum: address?.reduce((total, value) => total + value, 0),
  }));
  if (indexed.some(({ sum }) => !Number.isInteger(sum))) {
    throw new TypeError(
      `Thin P3 rhomb ${tile?.id ?? "(unknown)"} needs pentagrid addresses or an explicit mark`,
    );
  }
  const indexOne = indexed.filter(({ sum }) => modulo(sum, 5) === 1);
  const indexFour = indexed.filter(({ sum }) => modulo(sum, 5) === 4);
  if (indexOne.length === 1) return indexOne[0].index;
  if (indexFour.length === 1) return indexFour[0].index;
  throw new RangeError(
    `P3 rhomb ${tile?.id ?? "(unknown)"} has invalid address sums: ${indexed.map(({ sum }) => sum).join(",")}`,
  );
}

function rhombType(tile) {
  const type = String(tile?.type ?? "").toLowerCase();
  if (type.includes("thin") || Number(tile?.kind) === 0) return "thin";
  if (type.includes("thick") || type.includes("fat") || Number(tile?.kind) === 1) return "thick";
  throw new TypeError(`Unknown P3 rhomb type for ${tile?.id ?? "(unknown)"}`);
}

function signedArea(vertices) {
  return vertices.reduce((area, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return area + vertex.point.x * next.point.y - next.point.x * vertex.point.y;
  }, 0) / 2;
}

function polygonCenter(vertices) {
  const area = signedArea(vertices);
  if (Math.abs(area) < EPSILON) {
    return point({
      x: vertices.reduce((sum, vertex) => sum + vertex.point.x, 0) / vertices.length,
      y: vertices.reduce((sum, vertex) => sum + vertex.point.y, 0) / vertices.length,
    });
  }
  let x = 0;
  let y = 0;
  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    const cross = vertex.point.x * next.point.y - next.point.x * vertex.point.y;
    x += (vertex.point.x + next.point.x) * cross;
    y += (vertex.point.y + next.point.y) * cross;
  });
  return point({ x: x / (6 * area), y: y / (6 * area) });
}

function canonicalCycle(ids) {
  const variants = [];
  for (const sequence of [ids, [...ids].reverse()]) {
    for (let index = 0; index < sequence.length; index += 1) {
      variants.push([...sequence.slice(index), ...sequence.slice(0, index)].join("|"));
    }
  }
  return variants.sort()[0];
}

function selectedSegments(rhombs) {
  const verticesById = new Map();
  const segments = new Map();
  const add = (first, second, rhomb) => {
    verticesById.set(first.id, first);
    verticesById.set(second.id, second);
    const id = pairKey(first.id, second.id);
    if (!segments.has(id)) {
      segments.set(id, {
        id,
        firstId: first.id,
        secondId: second.id,
        sourceRhombIds: new Set(),
      });
    }
    segments.get(id).sourceRhombIds.add(rhomb.id);
  };

  for (const rhomb of rhombs) {
    const vertices = verticesForRhomb(rhomb);
    if (rhombType(rhomb) === "thin") {
      const marked = markedPenroseRhombVertexIndex(rhomb);
      add(vertices[marked], vertices[(marked + 1) % 4], rhomb);
      add(vertices[marked], vertices[(marked + 3) % 4], rhomb);
      continue;
    }
    const pairs = [[0, 2], [1, 3]];
    const lengths = pairs.map(([first, second]) => Math.hypot(
      vertices[second].point.x - vertices[first].point.x,
      vertices[second].point.y - vertices[first].point.y,
    ));
    const [first, second] = lengths[0] >= lengths[1] ? pairs[0] : pairs[1];
    add(vertices[first], vertices[second], rhomb);
  }
  return { verticesById, segments };
}

function traceFaces(verticesById, segments) {
  const neighbors = new Map([...verticesById.keys()].map((id) => [id, new Set()]));
  for (const { firstId, secondId } of segments.values()) {
    neighbors.get(firstId).add(secondId);
    neighbors.get(secondId).add(firstId);
  }
  const ordered = new Map([...neighbors].map(([id, entries]) => {
    const origin = verticesById.get(id).point;
    return [id, [...entries].sort((firstId, secondId) => {
      const first = verticesById.get(firstId).point;
      const second = verticesById.get(secondId).point;
      return Math.atan2(first.y - origin.y, first.x - origin.x)
        - Math.atan2(second.y - origin.y, second.x - origin.x)
        || firstId.localeCompare(secondId);
    })];
  }));

  const starts = [...segments.values()]
    .flatMap(({ firstId, secondId }) => [[firstId, secondId], [secondId, firstId]])
    .sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d));
  const visited = new Set();
  const faces = [];
  for (const [startFirst, startSecond] of starts) {
    if (visited.has(`${startFirst}>${startSecond}`)) continue;
    const ids = [];
    let firstId = startFirst;
    let secondId = startSecond;
    let closed = false;
    for (let step = 0; step <= segments.size * 2 + 1; step += 1) {
      const directed = `${firstId}>${secondId}`;
      if (visited.has(directed)) break;
      visited.add(directed);
      ids.push(firstId);
      const exits = ordered.get(secondId);
      const reverse = exits.indexOf(firstId);
      if (reverse < 0) break;
      const nextId = exits[modulo(reverse - 1, exits.length)];
      firstId = secondId;
      secondId = nextId;
      if (firstId === startFirst && secondId === startSecond) {
        closed = true;
        break;
      }
    }
    if (!closed || ids.length < 3) continue;
    const face = ids.map((id) => verticesById.get(id));
    if (signedArea(face) > EPSILON) faces.push(Object.freeze(face));
  }
  return faces;
}

function classifyFace(vertices) {
  let reflex = 0;
  let reflexIndex = -1;
  vertices.forEach((vertex, index) => {
    const previous = vertices[modulo(index - 1, vertices.length)].point;
    const current = vertex.point;
    const next = vertices[(index + 1) % vertices.length].point;
    const cross = (current.x - previous.x) * (next.y - current.y)
      - (current.y - previous.y) * (next.x - current.x);
    if (cross < -EPSILON) {
      reflex += 1;
      reflexIndex = index;
    }
  });
  if (reflex === 0) return { type: "kite", reflexIndex };
  if (reflex === 1) return { type: "dart", reflexIndex };
  return null;
}

function orientationFor(vertices, type, reflexIndex) {
  let pair;
  if (type === "dart") {
    pair = [reflexIndex, modulo(reflexIndex + 2, 4)];
  } else {
    const diagonals = [[0, 2], [1, 3]];
    const lengths = diagonals.map(([first, second]) => Math.hypot(
      vertices[second].point.x - vertices[first].point.x,
      vertices[second].point.y - vertices[first].point.y,
    ));
    pair = lengths[0] >= lengths[1] ? diagonals[0] : diagonals[1];
  }
  const first = vertices[pair[0]].point;
  const second = vertices[pair[1]].point;
  return modulo(Math.atan2(second.y - first.y, second.x - first.x), Math.PI);
}

function intersectsBounds(vertices, bounds) {
  if (!bounds) return true;
  const xs = vertices.map(({ point: current }) => current.x);
  const ys = vertices.map(({ point: current }) => current.y);
  return Math.max(...xs) >= bounds.minX - EPSILON
    && Math.min(...xs) <= bounds.maxX + EPSILON
    && Math.max(...ys) >= bounds.minY - EPSILON
    && Math.min(...ys) <= bounds.maxY + EPSILON;
}

function geometryBounds(tiles) {
  const points = tiles.flatMap((tile) => tile.points);
  if (!points.length) return Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  return Object.freeze({
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  });
}

function buildEdges(tiles) {
  const edges = new Map();
  for (const tile of tiles) {
    tile.vertexIds.forEach((firstId, index) => {
      const nextIndex = (index + 1) % 4;
      const secondId = tile.vertexIds[nextIndex];
      const key = pairKey(firstId, secondId);
      if (!edges.has(key)) {
        const first = tile.points[index];
        const second = tile.points[nextIndex];
        edges.set(key, {
          id: `p2-edge:${key}`,
          first,
          second,
          center: point({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }),
          length: Math.hypot(second.x - first.x, second.y - first.y),
          angle: modulo(Math.atan2(second.y - first.y, second.x - first.x), Math.PI),
          tileIds: [],
          tileTypes: [],
          tileKinds: [],
        });
      }
      const edge = edges.get(key);
      edge.tileIds.push(tile.id);
      edge.tileTypes.push(tile.type);
      edge.tileKinds.push(tile.kind);
    });
  }
  return Object.freeze([...edges.values()]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((edge) => Object.freeze({
      ...edge,
      tileIds: Object.freeze(edge.tileIds.sort()),
      tileTypes: Object.freeze(edge.tileTypes),
      tileKinds: Object.freeze(edge.tileKinds),
    })));
}

/**
 * Derive a stable P2 world window from a stable, marked P3 world window.
 *
 * The source should include at least one rhomb of halo beyond bounds. Open
 * faces at the source boundary are omitted instead of being fabricated.
 */
export function derivePenroseP2World(rhombWorld, { bounds = null } = {}) {
  const rhombs = Array.isArray(rhombWorld) ? rhombWorld : rhombWorld?.tiles;
  if (!Array.isArray(rhombs)) {
    throw new TypeError("derivePenroseP2World expects a P3 world window or rhomb array");
  }
  const { verticesById, segments } = selectedSegments(rhombs);
  const rejectedFaces = [];
  const tiles = traceFaces(verticesById, segments)
    .filter((vertices) => intersectsBounds(vertices, bounds))
    .map((vertices) => {
      if (vertices.length !== 4) {
        rejectedFaces.push({ reason: "not-a-quadrilateral", vertexIds: vertices.map(({ id }) => id) });
        return null;
      }
      const classification = classifyFace(vertices);
      if (!classification) {
        rejectedFaces.push({ reason: "not-a-kite-or-dart", vertexIds: vertices.map(({ id }) => id) });
        return null;
      }
      const { type, reflexIndex } = classification;
      const vertexIds = Object.freeze(vertices.map(({ id }) => id));
      const points = Object.freeze(vertices.map(({ point: current }) => current));
      const orientation = orientationFor(vertices, type, reflexIndex);
      const sourceRhombIds = new Set();
      vertexIds.forEach((firstId, index) => {
        const secondId = vertexIds[(index + 1) % 4];
        for (const id of segments.get(pairKey(firstId, secondId))?.sourceRhombIds ?? []) {
          sourceRhombIds.add(id);
        }
      });
      return Object.freeze({
        id: `p2:${type}:${canonicalCycle(vertexIds)}`,
        kind: type === "kite" ? 0 : 1,
        type,
        label: type,
        points,
        vertexIds,
        center: polygonCenter(vertices),
        area: signedArea(vertices),
        orientation,
        family: modulo(Math.round(orientation / (TAU / 10)), 5),
        sourceRhombIds: Object.freeze([...sourceRhombIds].sort()),
        generation: rhombWorld?.generation ?? 0,
      });
    })
    .filter(Boolean)
    .sort((first, second) => first.id.localeCompare(second.id));
  const frozenTiles = Object.freeze(tiles);
  const edges = buildEdges(frozenTiles);
  const kiteCount = tiles.filter(({ type }) => type === "kite").length;
  const dartCount = tiles.length - kiteCount;
  return Object.freeze({
    presentation: "p2",
    presentationInfo: Object.freeze({
      id: "p2",
      shortLabel: "P2 kite + dart",
      label: "P2 kites + darts",
      tileLabels: Object.freeze(["kite", "dart"]),
      description: "Kites and darts locally derived from a globally addressed P3 pentagrid.",
    }),
    sourcePresentation: rhombWorld?.presentation ?? "p3",
    generation: rhombWorld?.generation ?? 0,
    sourceGeneration: rhombWorld?.sourceGeneration ?? rhombWorld?.generation ?? 0,
    variation: rhombWorld?.variation ?? 0,
    tiles: frozenTiles,
    edges,
    bounds: geometryBounds(frozenTiles),
    boundaryTriangles: 0,
    window: rhombWorld?.window,
    field: rhombWorld?.field,
    edgeScale: rhombWorld?.edgeScale,
    counts: Object.freeze({
      total: tiles.length,
      kite: kiteCount,
      dart: dartCount,
      ratio: dartCount ? kiteCount / dartCount : 0,
      byType: Object.freeze({ kite: kiteCount, dart: dartCount }),
    }),
    rejectedFaces: Object.freeze(rejectedFaces.map(Object.freeze)),
    derivation: Object.freeze({
      sourceRhombs: rhombs.length,
      selectedSegments: segments.size,
      requiredSourceHaloRhombs: 1,
      requiresMarkedP3: true,
    }),
  });
}
