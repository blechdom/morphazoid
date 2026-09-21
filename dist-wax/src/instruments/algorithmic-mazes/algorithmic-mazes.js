const TAU = Math.PI * 2;
const DEFAULT_SEED = 7347;
const KEY_SCALE = 1e6;

export const MAZE_LIMITS = Object.freeze({
  size: Object.freeze([6, 28]),
  seed: Object.freeze([1, 99999]),
  braid: Object.freeze([0, 0.82]),
});

export const MAZE_ALGORITHMS = Object.freeze([
  Object.freeze({ id: "backtracker", label: "Backtracker", description: "A depth-first thread that favors long corridors and deep returns." }),
  Object.freeze({ id: "prim", label: "Randomized Prim", description: "A restless frontier grows short branches around a dense center." }),
  Object.freeze({ id: "kruskal", label: "Randomized Kruskal", description: "Separate islands join until one connected passage graph remains." }),
  Object.freeze({ id: "wilson", label: "Wilson walk", description: "Loop-erased random walks arrive from many directions without bias." }),
]);

export const MAZE_TOPOLOGIES = Object.freeze([
  Object.freeze({ id: "orthogonal", label: "Orthogonal" }),
  Object.freeze({ id: "radial", label: "Radial" }),
  Object.freeze({ id: "hexagonal", label: "Hexagonal" }),
]);

export const DEFAULT_MAZE_SETTINGS = Object.freeze({
  algorithm: "wilson",
  topology: "radial",
  size: 17,
  seed: DEFAULT_SEED,
  braid: 0.14,
});

const ALGORITHM_IDS = new Set(MAZE_ALGORITHMS.map(({ id }) => id));
const TOPOLOGY_IDS = new Set(MAZE_TOPOLOGIES.map(({ id }) => id));

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, minimum, maximum, fallback = minimum) {
  return Math.round(clamp(finite(value, fallback), minimum, maximum));
}

function seedValue(value, fallback = DEFAULT_SEED) {
  const number = Math.trunc(finite(value, fallback));
  return number ? clamp(Math.abs(number), ...MAZE_LIMITS.seed) : fallback;
}

function randomSource(seed) {
  let state = seedValue(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(values, random) {
  return values[Math.floor(random() * values.length)];
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

const point = (x, y) => ({ x, y });
const pointKey = ({ x, y }) => `${Math.round(x * KEY_SCALE)},${Math.round(y * KEY_SCALE)}`;
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const segmentKey = (a, b) => {
  const first = pointKey(a);
  const second = pointKey(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};

function polygonCenter(polygon) {
  const sum = polygon.reduce((total, vertex) => ({
    x: total.x + vertex.x,
    y: total.y + vertex.y,
  }), { x: 0, y: 0 });
  return point(sum.x / polygon.length, sum.y / polygon.length);
}

function orthogonalField(size) {
  const columns = size;
  const rows = Math.max(5, Math.round(size * 0.66));
  const dx = 2 / columns;
  const dy = 1.42 / rows;
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const left = -1 + x * dx;
      const top = -0.71 + y * dy;
      const polygon = [
        point(left, top),
        point(left + dx, top),
        point(left + dx, top + dy),
        point(left, top + dy),
      ];
      cells.push({ id: cells.length, x, y, polygon, center: polygonCenter(polygon) });
    }
  }
  return { cells, detail: `${columns} x ${rows}`, dimensions: { columns, rows } };
}

function radialField(size) {
  const rings = Math.max(4, Math.round(size * 0.44));
  const sectors = Math.max(12, Math.round(size * 1.18 / 2) * 2);
  const innerRadius = 0.12;
  const ringWidth = (0.96 - innerRadius) / rings;
  const cells = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const inner = innerRadius + ring * ringWidth;
    const outer = inner + ringWidth;
    for (let sector = 0; sector < sectors; sector += 1) {
      const start = -Math.PI / 2 + sector / sectors * TAU;
      const end = -Math.PI / 2 + (sector + 1) / sectors * TAU;
      const polygon = [
        point(Math.cos(start) * inner, Math.sin(start) * inner),
        point(Math.cos(start) * outer, Math.sin(start) * outer),
        point(Math.cos(end) * outer, Math.sin(end) * outer),
        point(Math.cos(end) * inner, Math.sin(end) * inner),
      ];
      cells.push({ id: cells.length, ring, sector, polygon, center: polygonCenter(polygon) });
    }
  }
  return { cells, detail: `${rings} rings x ${sectors} sectors`, dimensions: { rings, sectors } };
}

function hexagonalField(size) {
  const radius = Math.max(3, Math.round(size * 0.34));
  const raw = [];
  let extent = 1;
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r += 1) {
      const center = point(Math.sqrt(3) * (q + r / 2), 1.5 * r);
      const polygon = Array.from({ length: 6 }, (_value, index) => {
        const angle = Math.PI / 6 + index * Math.PI / 3;
        return point(center.x + Math.cos(angle), center.y + Math.sin(angle));
      });
      polygon.forEach(({ x, y }) => { extent = Math.max(extent, Math.abs(x), Math.abs(y)); });
      raw.push({ q, r, center, polygon });
    }
  }
  const scale = 0.96 / extent;
  const cells = raw.map((cell, id) => {
    const polygon = cell.polygon.map(({ x, y }) => point(x * scale, y * scale));
    return {
      id,
      q: cell.q,
      r: cell.r,
      polygon,
      center: point(cell.center.x * scale, cell.center.y * scale),
    };
  });
  return { cells, detail: `radius ${radius}`, dimensions: { radius } };
}

function createField(topology, size) {
  if (topology === "orthogonal") return orthogonalField(size);
  if (topology === "hexagonal") return hexagonalField(size);
  return radialField(size);
}

function collectWalls(cells) {
  const records = new Map();
  for (const cell of cells) {
    cell.polygon.forEach((a, index) => {
      const b = cell.polygon[(index + 1) % cell.polygon.length];
      const key = segmentKey(a, b);
      if (records.has(key)) records.get(key).cells.push(cell.id);
      else records.set(key, { key, a, b, cells: [cell.id] });
    });
  }
  const walls = [...records.values()].map((wall, id) => ({
    ...wall,
    id,
    boundary: wall.cells.length === 1,
    length: Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
  }));
  const candidates = walls.filter(({ cells: owners }) => owners.length === 2).map((wall, id) => ({
    id,
    a: wall.cells[0],
    b: wall.cells[1],
    wallId: wall.id,
    length: Math.hypot(
      cells[wall.cells[1]].center.x - cells[wall.cells[0]].center.x,
      cells[wall.cells[1]].center.y - cells[wall.cells[0]].center.y,
    ),
  }));
  return { walls, candidates };
}

function edgeAdjacency(count, edges) {
  const adjacency = Array.from({ length: count }, () => []);
  for (const edge of edges) {
    adjacency[edge.a].push({ node: edge.b, edge });
    adjacency[edge.b].push({ node: edge.a, edge });
  }
  return adjacency;
}

function addPassage(context, edge, from, to, kind = "carve", metadata = {}) {
  if (context.accepted.has(edge.id)) return false;
  context.accepted.add(edge.id);
  const passage = {
    id: context.passages.length,
    candidateId: edge.id,
    wallId: edge.wallId,
    a: edge.a,
    b: edge.b,
    length: edge.length,
    kind,
  };
  context.passages.push(passage);
  context.steps.push({
    index: context.steps.length,
    edgeId: passage.id,
    wallId: edge.wallId,
    from,
    to,
    kind,
    ...metadata,
  });
  return true;
}

function carveBacktracker(context, random) {
  const start = Math.floor(random() * context.count);
  const visited = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const current = stack.at(-1);
    const options = context.candidateAdjacency[current].filter(({ node }) => !visited.has(node));
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = choose(options, random);
    addPassage(context, next.edge, current, next.node, "carve", {
      process: "depth",
      algorithmValue: Math.min(1, (stack.length + 1) / Math.max(1, context.count - 1)),
      stackDepth: stack.length + 1,
      branchOptions: options.length,
    });
    visited.add(next.node);
    stack.push(next.node);
  }
}

function carvePrim(context, random) {
  const start = Math.floor(random() * context.count);
  const visited = new Set([start]);
  const frontier = context.candidateAdjacency[start].map(({ edge }) => edge);
  while (frontier.length) {
    const index = Math.floor(random() * frontier.length);
    const edge = frontier[index];
    frontier[index] = frontier.at(-1);
    frontier.pop();
    const aVisited = visited.has(edge.a);
    const bVisited = visited.has(edge.b);
    if (aVisited === bVisited) continue;
    const from = aVisited ? edge.a : edge.b;
    const to = aVisited ? edge.b : edge.a;
    addPassage(context, edge, from, to, "carve", {
      process: "frontier",
      algorithmValue: (visited.size + 1) / context.count,
      visitedSize: visited.size + 1,
      frontierSize: frontier.length,
      frontierRatio: Math.min(1, frontier.length / Math.max(1, context.count)),
    });
    visited.add(to);
    context.candidateAdjacency[to].forEach((candidate) => {
      if (!visited.has(candidate.node)) frontier.push(candidate.edge);
    });
  }
}

function carveKruskal(context, random) {
  const parent = Array.from({ length: context.count }, (_value, index) => index);
  const rank = new Uint8Array(context.count);
  const size = new Uint32Array(context.count);
  size.fill(1);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (a, b) => {
    let left = find(a);
    let right = find(b);
    if (left === right) return null;
    const leftSize = size[left];
    const rightSize = size[right];
    if (rank[left] < rank[right]) [left, right] = [right, left];
    parent[right] = left;
    size[left] += size[right];
    if (rank[left] === rank[right]) rank[left] += 1;
    return {
      leftSize,
      rightSize,
      mergedSize: leftSize + rightSize,
    };
  };
  for (const edge of shuffle(context.candidates, random)) {
    const merge = join(edge.a, edge.b);
    if (merge) {
      addPassage(context, edge, edge.a, edge.b, "carve", {
        process: "merge",
        algorithmValue: merge.mergedSize / context.count,
        mergeSize: merge.mergedSize,
        mergeBalance: Math.min(merge.leftSize, merge.rightSize)
          / Math.max(merge.leftSize, merge.rightSize),
      });
    }
    if (context.passages.length === context.count - 1) break;
  }
}

function carveWilson(context, random) {
  const root = Math.floor(random() * context.count);
  const visited = new Set([root]);
  let walkId = 0;
  while (visited.size < context.count) {
    const remaining = Array.from({ length: context.count }, (_value, index) => index)
      .filter((node) => !visited.has(node));
    const start = choose(remaining, random);
    const nodes = [start];
    const edges = [];
    const indexByNode = new Map([[start, 0]]);
    let current = start;
    while (!visited.has(current)) {
      const next = choose(context.candidateAdjacency[current], random);
      const loopIndex = indexByNode.get(next.node);
      if (loopIndex !== undefined) {
        nodes.splice(loopIndex + 1);
        edges.splice(loopIndex);
        for (const [node, index] of indexByNode) {
          if (index > loopIndex) indexByNode.delete(node);
        }
      } else {
        edges.push(next.edge);
        nodes.push(next.node);
        indexByNode.set(next.node, nodes.length - 1);
      }
      current = next.node;
    }
    edges.forEach((edge, index) => {
      addPassage(context, edge, nodes[index], nodes[index + 1], "carve", {
        process: "loop-erased-walk",
        algorithmValue: (index + 1) / Math.max(1, edges.length),
        walkId,
        walkIndex: index,
        walkLength: edges.length,
      });
      visited.add(nodes[index]);
    });
    walkId += 1;
  }
}

function passageAdjacency(count, passages) {
  const adjacency = Array.from({ length: count }, () => []);
  for (const passage of passages) {
    adjacency[passage.a].push(passage.b);
    adjacency[passage.b].push(passage.a);
  }
  return adjacency;
}

function applyBraid(context, random, amount) {
  if (amount <= 0) return;
  const adjacency = passageAdjacency(context.count, context.passages);
  const deadEnds = shuffle(
    adjacency.flatMap((neighbors, node) => neighbors.length === 1 ? [node] : []),
    random,
  );
  for (const node of deadEnds) {
    if (random() > amount || adjacency[node].length !== 1) continue;
    const available = context.candidateAdjacency[node]
      .filter(({ edge }) => !context.accepted.has(edge.id));
    if (!available.length) continue;
    const preferred = available.filter(({ node: neighbor }) => adjacency[neighbor].length > 1);
    const selected = choose(preferred.length ? preferred : available, random);
    if (!addPassage(context, selected.edge, node, selected.node, "braid", {
      process: "braid",
      algorithmValue: amount,
    })) continue;
    adjacency[node].push(selected.node);
    adjacency[selected.node].push(node);
  }
}

function breadthFirst(adjacency, start) {
  const distances = new Array(adjacency.length).fill(-1);
  const previous = new Array(adjacency.length).fill(-1);
  const queue = [start];
  distances[start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor];
    for (const neighbor of adjacency[node]) {
      if (distances[neighbor] >= 0) continue;
      distances[neighbor] = distances[node] + 1;
      previous[neighbor] = node;
      queue.push(neighbor);
    }
  }
  return { distances, previous };
}

function farthest(adjacency, start) {
  const search = breadthFirst(adjacency, start);
  let node = start;
  search.distances.forEach((distance, index) => {
    if (distance > search.distances[node]) node = index;
  });
  return { node, ...search };
}

function pathFromPrevious(previous, start, goal) {
  const route = [];
  for (let node = goal; node >= 0; node = previous[node]) {
    route.push(node);
    if (node === start) break;
  }
  return route.at(-1) === start ? route.reverse() : [];
}

function depthFirstTour(adjacency, start) {
  const route = [start];
  const seen = new Set([start]);
  const stack = [{ node: start, cursor: 0 }];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.cursor >= adjacency[frame.node].length) {
      stack.pop();
      if (stack.length) route.push(stack.at(-1).node);
      continue;
    }
    const next = adjacency[frame.node][frame.cursor];
    frame.cursor += 1;
    if (seen.has(next)) continue;
    seen.add(next);
    route.push(next);
    stack.push({ node: next, cursor: 0 });
  }
  return route;
}

function wallGraph(walls) {
  const vertices = [];
  const ids = new Map();
  const vertexId = (current) => {
    const key = pointKey(current);
    if (ids.has(key)) return ids.get(key);
    const id = vertices.length;
    ids.set(key, id);
    vertices.push({ id, x: current.x, y: current.y });
    return id;
  };
  const edges = walls.map((wall, id) => ({
    id,
    wallId: wall.id,
    a: vertexId(wall.a),
    b: vertexId(wall.b),
    length: wall.length,
    boundary: wall.boundary,
  }));
  const adjacency = Array.from({ length: vertices.length }, () => []);
  edges.forEach(({ a, b }) => {
    adjacency[a].push(b);
    adjacency[b].push(a);
  });
  const components = [];
  const seen = new Set();
  for (let start = 0; start < vertices.length; start += 1) {
    if (seen.has(start)) continue;
    const nodes = [start];
    seen.add(start);
    for (let cursor = 0; cursor < nodes.length; cursor += 1) {
      adjacency[nodes[cursor]].forEach((next) => {
        if (seen.has(next)) return;
        seen.add(next);
        nodes.push(next);
      });
    }
    components.push(nodes);
  }
  components.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const tour = components[0]?.length ? depthFirstTour(adjacency, components[0][0]) : [];
  return { vertices, edges, adjacency, components, tour };
}

function walk(adjacency, random, start, length) {
  const route = [start];
  let previous = -1;
  let current = start;
  while (route.length < length) {
    const neighbors = adjacency[current] ?? [];
    if (!neighbors.length) break;
    const forward = neighbors.filter((node) => node !== previous);
    const next = choose(forward.length ? forward : neighbors, random);
    route.push(next);
    previous = current;
    current = next;
  }
  return route;
}

export function sanitizeMazeAlgorithm(value) {
  return ALGORITHM_IDS.has(value) ? value : DEFAULT_MAZE_SETTINGS.algorithm;
}

export function sanitizeMazeTopology(value) {
  return TOPOLOGY_IDS.has(value) ? value : DEFAULT_MAZE_SETTINGS.topology;
}

export function mazeAlgorithmLabel(value) {
  return MAZE_ALGORITHMS.find(({ id }) => id === sanitizeMazeAlgorithm(value))?.label
    ?? MAZE_ALGORITHMS[0].label;
}

export function mazeTopologyLabel(value) {
  return MAZE_TOPOLOGIES.find(({ id }) => id === sanitizeMazeTopology(value))?.label
    ?? MAZE_TOPOLOGIES[0].label;
}

export function sanitizeMazeSettings(settings = {}) {
  return {
    algorithm: sanitizeMazeAlgorithm(settings.algorithm),
    topology: sanitizeMazeTopology(settings.topology),
    size: integer(settings.size, ...MAZE_LIMITS.size, DEFAULT_MAZE_SETTINGS.size),
    seed: seedValue(settings.seed, DEFAULT_MAZE_SETTINGS.seed),
    braid: clamp(finite(settings.braid, DEFAULT_MAZE_SETTINGS.braid), ...MAZE_LIMITS.braid),
  };
}

export function shortestMazePath(maze, start = maze?.start, goal = maze?.goal) {
  const adjacency = maze?.adjacency ?? [];
  if (!adjacency.length) return Object.freeze([]);
  const from = integer(start, 0, adjacency.length - 1, 0);
  const to = integer(goal, 0, adjacency.length - 1, from);
  return Object.freeze(pathFromPrevious(breadthFirst(adjacency, from).previous, from, to));
}

export function createMazeWalk(maze, options = {}) {
  const adjacency = maze?.adjacency ?? [];
  if (!adjacency.length) return Object.freeze([]);
  const random = randomSource(seedValue(options.seed, maze?.settings?.seed ?? DEFAULT_SEED));
  const start = integer(options.start, 0, adjacency.length - 1, maze?.start ?? 0);
  const length = integer(options.length, 2, adjacency.length * 24, adjacency.length * 5);
  return Object.freeze(walk(adjacency, random, start, length));
}

export function createWallWalk(maze, options = {}) {
  const graph = maze?.wallGraph;
  if (!graph?.adjacency?.length) return Object.freeze([]);
  const random = randomSource(seedValue(options.seed, maze?.settings?.seed ?? DEFAULT_SEED));
  const requestedValue = Number(options.start);
  const requested = Number.isFinite(requestedValue)
    ? integer(requestedValue, 0, graph.adjacency.length - 1, 0)
    : null;
  const fallbackComponent = graph.components?.[0]
    ?? Array.from({ length: graph.adjacency.length }, (_value, index) => index);
  const component = requested === null
    ? fallbackComponent
    : graph.components?.find((nodes) => nodes.includes(requested)) ?? fallbackComponent;
  const fallback = component[Math.floor(random() * Math.max(1, component.length))] ?? 0;
  const start = requested !== null && component.includes(requested) ? requested : fallback;
  const length = integer(options.length, 2, graph.adjacency.length * 24, graph.adjacency.length * 4);
  return Object.freeze(walk(graph.adjacency, random, start, length));
}

export function generateMaze(settings = {}) {
  const safe = sanitizeMazeSettings(settings);
  const random = randomSource(safe.seed);
  const field = createField(safe.topology, safe.size);
  const { walls: allWalls, candidates } = collectWalls(field.cells);
  const context = {
    count: field.cells.length,
    candidates,
    candidateAdjacency: edgeAdjacency(field.cells.length, candidates),
    accepted: new Set(),
    passages: [],
    steps: [],
  };

  if (safe.algorithm === "backtracker") carveBacktracker(context, random);
  else if (safe.algorithm === "prim") carvePrim(context, random);
  else if (safe.algorithm === "kruskal") carveKruskal(context, random);
  else carveWilson(context, random);
  applyBraid(context, random, safe.braid);

  const adjacency = passageAdjacency(field.cells.length, context.passages);
  const start = farthest(adjacency, 0).node;
  const endSearch = farthest(adjacency, start);
  const goal = endSearch.node;
  const solution = pathFromPrevious(endSearch.previous, start, goal);
  const depths = breadthFirst(adjacency, start).distances;
  const openingWallIds = new Set(context.passages.map(({ wallId }) => wallId));
  const walls = allWalls.filter(({ id }) => !openingWallIds.has(id));
  const outlines = wallGraph(walls);
  const passageByPair = Object.fromEntries(context.passages.map((passage) => [
    pairKey(passage.a, passage.b),
    passage.id,
  ]));
  const wallByPair = Object.fromEntries(outlines.edges.map((edge) => [
    pairKey(edge.a, edge.b),
    edge.id,
  ]));

  return deepFreeze({
    settings: safe,
    topology: {
      id: safe.topology,
      label: mazeTopologyLabel(safe.topology),
      detail: field.detail,
      dimensions: field.dimensions,
    },
    algorithm: { id: safe.algorithm, label: mazeAlgorithmLabel(safe.algorithm) },
    cells: field.cells,
    candidateEdges: candidates,
    allWalls,
    passages: context.passages,
    walls,
    adjacency,
    passageByPair,
    openingWallIds: [...openingWallIds],
    wallGraph: { ...outlines, edgeByPair: wallByPair },
    buildSteps: context.steps,
    depth: depths,
    maxDepth: Math.max(...depths),
    start,
    goal,
    solution,
    tour: depthFirstTour(adjacency, start),
    metrics: {
      cellCount: field.cells.length,
      candidatePassageCount: candidates.length,
      passageCount: context.passages.length,
      wallCount: walls.length,
      outlineComponentCount: outlines.components.length,
      deadEndCount: adjacency.filter((neighbors) => neighbors.length === 1).length,
      branchPointCount: adjacency.filter((neighbors) => neighbors.length >= 3).length,
      cycleRank: context.passages.length - field.cells.length + 1,
      solutionLength: Math.max(0, solution.length - 1),
      maximumDepth: Math.max(...depths),
    },
  });
}

export function mazePassageBetween(maze, a, b) {
  const id = maze?.passageByPair?.[pairKey(a, b)];
  return Number.isInteger(id) ? maze.passages[id] : null;
}

export function mazeWallEdgeBetween(maze, a, b) {
  const id = maze?.wallGraph?.edgeByPair?.[pairKey(a, b)];
  return Number.isInteger(id) ? maze.wallGraph.edges[id] : null;
}
