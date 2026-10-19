const clamp = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

export const LATTICE_SHAPES = Object.freeze(['icosahedron', 'octahedron', 'tetrahedron']);
export const LATTICE_MAX_UNITS = 4;
export const LATTICE_MAX_DETAIL = 2;
export const LATTICE_DEFAULTS = Object.freeze({
  shape: 'icosahedron', unitCount: 1, detail: 0,
  selected: 7, pullX: 0, pullY: 0, pullZ: 0,
  softness: 0.38, pulseRate: 0.46,
});

function baseVertices(shape) {
  if (shape === 'tetrahedron') {
    return [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]]
      .map((point) => point.map((axis) => axis / Math.sqrt(3)));
  }
  if (shape === 'octahedron') {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0],
      [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  }
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    vertices.push([0, a, b * phi], [a, b * phi, 0], [a * phi, 0, b]);
  }
  return vertices.map((point) => point.map((axis) => axis / Math.hypot(1, phi)));
}

function convexTriangles(vertices) {
  const faces = [];
  for (let a = 0; a < vertices.length; a += 1) {
    for (let b = a + 1; b < vertices.length; b += 1) {
      for (let c = b + 1; c < vertices.length; c += 1) {
        const normal = cross(subtract(vertices[b], vertices[a]), subtract(vertices[c], vertices[a]));
        if (Math.hypot(...normal) < 1e-8) continue;
        const sides = vertices.map((point) => dot(normal, subtract(point, vertices[a])));
        if (sides.some((side) => side > 1e-7) && sides.some((side) => side < -1e-7)) continue;
        faces.push(dot(normal, vertices[a]) > 0 ? [a, b, c] : [a, c, b]);
      }
    }
  }
  return faces;
}

/** Add real, shared edge-midpoint joints. Project them onto the unit sphere
 * so each step is a connected geodesic refinement, not duplicate face vertices. */
function subdividedSolid(shape, detail) {
  const vertices = baseVertices(shape);
  let faces = convexTriangles(vertices);
  for (let step = 0; step < detail; step += 1) {
    const midpointCache = new Map();
    function midpoint(a, b) {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (midpointCache.has(key)) return midpointCache.get(key);
      const point = vertices[a].map((value, axis) => (value + vertices[b][axis]) / 2);
      const radius = Math.hypot(...point);
      const id = vertices.push(point.map((axis) => axis / radius)) - 1;
      midpointCache.set(key, id);
      return id;
    }
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  return { vertices, faces };
}

const layouts = [
  [[0, 0, 0]],
  [[-0.82, 0, 0], [0.82, 0, 0]],
  [[-0.82, -0.48, 0], [0.82, -0.48, 0], [0, 0.82, 0.14]],
  [[-0.8, -0.7, -0.15], [0.8, -0.7, 0.15],
    [-0.8, 0.7, 0.15], [0.8, 0.7, -0.15]],
];
const structures = new Map();

/** Real face/edge topology for every playable solid, detail and unit count. */
export function latticeStructure(values = {}) {
  const shape = LATTICE_SHAPES.includes(values.shape) ? values.shape : LATTICE_DEFAULTS.shape;
  const unitCount = Math.round(clamp(values.unitCount, 1, LATTICE_MAX_UNITS, LATTICE_DEFAULTS.unitCount));
  const detail = Math.round(clamp(values.detail, 0, LATTICE_MAX_DETAIL, LATTICE_DEFAULTS.detail));
  const key = `${shape}:${unitCount}:${detail}`;
  if (structures.has(key)) return structures.get(key);
  const { vertices, faces } = subdividedSolid(shape, detail);
  const centers = layouts[unitCount - 1];
  const radius = unitCount === 1 ? 1 : 0.64;
  const restNodes = centers.flatMap((center) => vertices.map((point) =>
    Object.freeze(point.map((axis, i) => center[i] + axis * radius))));
  const triangles = [];
  const rawEdges = new Set();
  const edge = (a, b) => rawEdges.add([Math.min(a, b), Math.max(a, b)].join(':'));
  for (let unit = 0; unit < unitCount; unit += 1) {
    const offset = unit * vertices.length;
    for (const face of faces) {
      const triangle = face.map((index) => index + offset);
      triangles.push(Object.freeze(triangle));
      edge(triangle[0], triangle[1]);
      edge(triangle[1], triangle[2]);
      edge(triangle[2], triangle[0]);
    }
  }
  // Three independent bridge struts join each new solid to the nearest
  // existing one. Faces stay local; the whole structure remains connected.
  for (let unit = 1; unit < unitCount; unit += 1) {
    const neighbor = centers.slice(0, unit).map((center, index) =>
      [distance(center, centers[unit]), index]).sort((a, b) => a[0] - b[0])[0][1];
    const candidates = [];
    for (let a = 0; a < vertices.length; a += 1) {
      for (let b = 0; b < vertices.length; b += 1) {
        const source = neighbor * vertices.length + a;
        const target = unit * vertices.length + b;
        candidates.push([distance(restNodes[source], restNodes[target]), source, target]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, a, b] of candidates) {
      if (used.has(a) || used.has(b)) continue;
      edge(a, b);
      used.add(a); used.add(b);
      if (used.size === 6) break;
    }
  }
  const structure = Object.freeze({
    shape, unitCount, detail, verticesPerUnit: vertices.length,
    restNodes: Object.freeze(restNodes),
    edges: Object.freeze([...rawEdges].map((item) =>
      Object.freeze(item.split(':').map(Number)))),
    triangles: Object.freeze(triangles),
  });
  structures.set(key, structure);
  return structure;
}

export const REST_NODES = latticeStructure(LATTICE_DEFAULTS).restNodes;
export const LATTICE_EDGES = latticeStructure(LATTICE_DEFAULTS).edges;

export function latticeSettings(values = {}) {
  const structure = latticeStructure(values);
  return {
    shape: structure.shape, unitCount: structure.unitCount, detail: structure.detail,
    selected: Math.round(clamp(values.selected, 0, structure.restNodes.length - 1, LATTICE_DEFAULTS.selected)),
    pullX: clamp(values.pullX, -0.75, 0.75, 0),
    pullY: clamp(values.pullY, -0.75, 0.75, 0),
    pullZ: clamp(values.pullZ, -0.75, 0.75, 0),
    softness: clamp(values.softness, 0, 0.85, LATTICE_DEFAULTS.softness),
    pulseRate: clamp(values.pulseRate, 0.08, 1.6, LATTICE_DEFAULTS.pulseRate),
  };
}

export function latticePose(values, cycles = 0, playing = false) {
  const state = latticeSettings(values);
  const { restNodes, edges, triangles, verticesPerUnit } = latticeStructure(state);
  const pull = [state.pullX, state.pullY, state.pullZ];
  const neighbors = new Set(edges.filter(([a, b]) =>
    a === state.selected || b === state.selected).flat());
  const nodes = restNodes.map((node, id) => {
    const weight = id === state.selected ? 1
      : neighbors.has(id) ? state.softness * 0.62 : state.softness * 0.08;
    return node.map((value, axis) => value + weight * pull[axis]);
  });
  // This single edge pass keeps audio-clock sampling linear even with the
  // maximum 648 live joints; filtering every edge for every vertex is O(VE).
  const totals = nodes.map(() => ({ actual: 0, rest: 0, count: 0 }));
  let totalStrain = 0;
  for (const [a, b] of edges) {
    const actual = distance(nodes[a], nodes[b]);
    const rest = distance(restNodes[a], restNodes[b]);
    totalStrain += Math.abs(actual / rest - 1);
    for (const id of [a, b]) {
      totals[id].actual += actual;
      totals[id].rest += rest;
      totals[id].count += 1;
    }
  }
  const strain = totalStrain / edges.length;
  const frequencies = totals.map(({ actual, rest, count }, id) => {
    return clamp(155 * Math.sqrt(rest / Math.max(actual, 0.1 * count)) *
      (1 + (id % verticesPerUnit) / Math.max(1, verticesPerUnit - 1) * 0.385),
      80, 620, 155);
  });
  const tick = Math.floor((Number(cycles) || 0) * 12 + 1e-8);
  return {
    nodes, restNodes, edges, triangles, shape: state.shape,
    unitCount: state.unitCount, detail: state.detail, verticesPerUnit,
    selected: state.selected, strain, frequencies,
    pulseNode: playing ? (tick % nodes.length + nodes.length) % nodes.length : -1,
  };
}
