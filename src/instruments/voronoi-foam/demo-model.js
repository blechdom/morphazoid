// Convex 3D Voronoi cells, clipped to a finite cube. Geometry and volume share
// this one calculation; the volume-to-frequency mapping is an artistic choice.
const SIZE = 1;
const EPSILON = 1e-7;
const clamp = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.sqrt(dot(a, a));
const normalized = (a) => a.map((value) => value / Math.max(length(a), EPSILON));

function insideSolid(point, shape) {
  if (shape === 'cube') return point;
  let candidate = [...point];
  // Project user/slider edits inside the actual convex clipping boundary.
  // An external seed would otherwise produce an empty, unplayable cell.
  for (let pass = 0; pass < 3; pass += 1) for (const face of foamBounds(shape)) {
    const normal = normalized(cross(subtract(face[1], face[0]), subtract(face[2], face[0])));
    const overflow = dot(normal, subtract(candidate, face[0])) + 0.045;
    if (overflow > 0) candidate = candidate.map((value, axis) =>
      clamp(value - normal[axis] * overflow, -0.88, 0.88, value));
  }
  return candidate;
}

export const FOAM_MIN_CELLS = 2;
export const FOAM_MAX_CELLS = 12;
export const FOAM_SHAPES = Object.freeze(['cube', 'octahedron', 'icosahedron']);
const REST_SEEDS = Object.freeze([
  [-0.62, -0.52, -0.44], [0.64, -0.36, -0.38],
  [-0.55, 0.6, 0.42], [0.55, 0.52, 0.48], [0.02, 0.1, -0.05],
  [-0.68, 0.48, -0.33], [0.61, -0.54, 0.43],
  [-0.62, -0.29, 0.53], [0.58, 0.48, -0.59],
  [0.04, -0.69, 0.19], [-0.12, 0.68, -0.13], [0.1, -0.16, 0.75],
].map((seed) => Object.freeze(seed)));
export const FOAM_DEFAULTS = Object.freeze({
  seeds: Object.freeze(REST_SEEDS.slice(0, 5)),
  count: 5, shape: 'cube', selected: 4, sweepRate: 0.42,
});

/** A finite seed edit cannot collapse two cells onto the same point. */
export function foamSettings(values = {}) {
  const count = Math.round(clamp(values.count ?? values.seeds?.length,
    FOAM_MIN_CELLS, FOAM_MAX_CELLS, FOAM_DEFAULTS.count));
  const shape = FOAM_SHAPES.includes(values.shape) ? values.shape : FOAM_DEFAULTS.shape;
  const seeds = REST_SEEDS.slice(0, count).map((fallback, i) =>
    insideSolid(fallback.map((value, axis) =>
      clamp(values.seeds?.[i]?.[axis], -0.88, 0.88, value)), shape));
  const selected = Math.round(clamp(values.selected, 0, seeds.length - 1, FOAM_DEFAULTS.selected));
  // Process the played seed last: existing cells remain put when it is dragged
  // into a neighbor. Extra seeds have deterministic homes after count changes.
  const placed = [];
  for (const id of [...seeds.keys()].filter((i) => i !== selected).concat(selected)) {
    if (placed.some((point) => length(subtract(point, seeds[id])) < 0.202)) {
      const origin = seeds[id];
      for (let attempt = 1; attempt <= 128; attempt += 1) {
        const angle = attempt * 2.3999632 + id;
        const height = 1 - 2 * ((attempt * 0.61803398875) % 1);
        const radius = 0.21 + Math.floor((attempt - 1) / 16) * 0.12;
        const lateral = Math.sqrt(1 - height * height);
        const candidate = insideSolid([
          origin[0] + Math.cos(angle) * lateral * radius,
          origin[1] + height * radius,
          origin[2] + Math.sin(angle) * lateral * radius,
        ].map((value) => clamp(value, -0.88, 0.88, 0)), shape);
        if (placed.every((point) => length(subtract(point, candidate)) >= 0.202)) {
          seeds[id] = candidate;
          break;
        }
      }
    }
    placed.push(seeds[id]);
  }
  return { seeds, count, selected,
    shape,
    sweepRate: clamp(values.sweepRate, 0.08, 1.8, FOAM_DEFAULTS.sweepRate) };
}

function boxFaces() {
  const a = SIZE;
  return [
    [[-a, -a, -a], [-a, -a, a], [-a, a, a], [-a, a, -a]],
    [[a, -a, a], [a, -a, -a], [a, a, -a], [a, a, a]],
    [[-a, -a, a], [-a, -a, -a], [a, -a, -a], [a, -a, a]],
    [[-a, a, -a], [-a, a, a], [a, a, a], [a, a, -a]],
    [[a, -a, -a], [-a, -a, -a], [-a, a, -a], [a, a, -a]],
    [[-a, -a, a], [a, -a, a], [a, a, a], [-a, a, a]],
  ];
}

function orientedTriangle(a, b, c) {
  const face = [a, b, c];
  return dot(cross(subtract(b, a), subtract(c, a)), a) > 0
    ? face : [a, c, b];
}

function octahedronFaces() {
  const radius = 1.9;
  const faces = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    faces.push(orientedTriangle([x * radius, 0, 0], [0, y * radius, 0], [0, 0, z * radius]));
  }
  return faces;
}

function icosahedronFaces() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const radius = 1.45 / Math.hypot(1, phi);
  const vertices = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    vertices.push([0, a * radius, b * phi * radius],
      [a * radius, b * phi * radius, 0], [a * phi * radius, 0, b * radius]);
  }
  const faces = [];
  for (let a = 0; a < vertices.length; a += 1) {
    for (let b = a + 1; b < vertices.length; b += 1) {
      for (let c = b + 1; c < vertices.length; c += 1) {
        const normal = cross(subtract(vertices[b], vertices[a]), subtract(vertices[c], vertices[a]));
        if (length(normal) < EPSILON) continue;
        const sides = vertices.map((point) => dot(normal, subtract(point, vertices[a])));
        if (sides.some((side) => side > EPSILON) && sides.some((side) => side < -EPSILON)) continue;
        faces.push(orientedTriangle(vertices[a], vertices[b], vertices[c]));
      }
    }
  }
  return faces;
}

const BOUNDS = Object.freeze({
  cube: boxFaces(),
  octahedron: octahedronFaces(),
  icosahedron: icosahedronFaces(),
});
export function foamBounds(shape = 'cube') {
  return BOUNDS[shape] ?? BOUNDS.cube;
}

function clipFaces(faces, normal, middle) {
  const clipped = [], intersections = [];
  const distance = (point) => dot(normal, subtract(point, middle));
  for (const polygon of faces) {
    const next = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = distance(a), db = distance(b);
      if (da <= EPSILON) next.push(a);
      if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
        const t = da / (da - db);
        const point = a.map((value, axis) => value + (b[axis] - value) * t);
        next.push(point);
        if (!intersections.some((other) => length(subtract(other, point)) < 1e-5)) {
          intersections.push(point);
        }
      }
    }
    if (next.length >= 3) clipped.push(next);
  }
  if (intersections.length >= 3) {
    const center = [0, 1, 2].map((axis) =>
      intersections.reduce((sum, point) => sum + point[axis], 0) / intersections.length);
    const outward = normalized(normal);
    const tangent = normalized(cross(Math.abs(outward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], outward));
    const bitangent = cross(outward, tangent);
    intersections.sort((a, b) => {
      const offsetA = subtract(a, center), offsetB = subtract(b, center);
      return Math.atan2(dot(offsetA, bitangent), dot(offsetA, tangent))
        - Math.atan2(dot(offsetB, bitangent), dot(offsetB, tangent));
    });
    clipped.push(intersections);
  }
  return clipped;
}

function cellMetrics(faces) {
  let volume = 0;
  const centroid = [0, 0, 0];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i += 1) {
      const [a, b, c] = [face[0], face[i], face[i + 1]];
      const part = dot(a, cross(b, c)) / 6;
      volume += part;
      for (let axis = 0; axis < 3; axis += 1) {
        centroid[axis] += part * (a[axis] + b[axis] + c[axis]) / 4;
      }
    }
  }
  return {
    volume: Math.max(0, volume),
    center: centroid.map((value) => volume > EPSILON ? value / volume : 0),
  };
}

export function voronoiCells(values) {
  const { seeds, shape } = foamSettings(values);
  const bounds = foamBounds(shape);
  const totalVolume = cellMetrics(bounds).volume;
  return seeds.map((seed, i) => {
    let faces = bounds;
    for (let j = 0; j < seeds.length; j += 1) {
      if (j === i) continue;
      const normal = subtract(seeds[j], seed);
      const middle = seed.map((value, axis) => (value + seeds[j][axis]) / 2);
      faces = clipFaces(faces, normal, middle);
    }
    const metrics = cellMetrics(faces);
    return {
      id: i, seed, faces, ...metrics,
      frequency: clamp(202 * Math.cbrt((totalVolume / seeds.length) / Math.max(metrics.volume, 0.01)),
        90, 1100, 202),
    };
  });
}

export function foamPose(values, cells, cycles = 0, playing = false) {
  const state = foamSettings(values);
  const phase = ((Number(cycles) || 0) % 1 + 1) % 1;
  const extent = state.shape === 'octahedron' ? 1.9 : state.shape === 'icosahedron' ? 1.45 : 1;
  return { cells, seeds: state.seeds, selected: state.selected,
    shape: state.shape, sliceX: -extent + phase * extent * 2,
    showSlice: playing, frequencies: cells.map((cell) => cell.frequency) };
}
