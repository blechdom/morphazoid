export const MAX_GRAPH_NODES = 24;
export const MAX_GRAPH_FEEDBACK = 0.92;

export const GRAPH_PRESETS = Object.freeze({
  chain: Object.freeze({
    label: "Delay Chain",
    family: "Acyclic exemplar",
    description: "One directed path. Every node hears only the node before it.",
    cyclic: false,
  }),
  tree: Object.freeze({
    label: "Branching Tree",
    family: "Directed acyclic graph",
    description: "A rooted binary tree: one input fans outward without returning.",
    cyclic: false,
  }),
  dag: Object.freeze({
    label: "Layered DAG",
    family: "Directed acyclic graph",
    description: "Several forward-only paths cross between ordered layers.",
    cyclic: false,
  }),
  bipartite: Object.freeze({
    label: "Bipartite Field",
    family: "Directed acyclic graph",
    description: "Two disjoint node sets with all routes flowing left to right.",
    cyclic: false,
  }),
  ring: Object.freeze({
    label: "Directed Ring",
    family: "Cyclic directed graph",
    description: "A single cycle: the last delay returns to the first.",
    cyclic: true,
  }),
  smallworld: Object.freeze({
    label: "Small World",
    family: "Cyclic network",
    description: "A ring gains a few long shortcuts: clustered locally, close globally.",
    cyclic: true,
  }),
  hub: Object.freeze({
    label: "Hub + Spokes",
    family: "Cyclic network",
    description: "Peripheral delays exchange sound through one highly connected center.",
    cyclic: true,
  }),
  mesh: Object.freeze({
    label: "Feedback Mesh",
    family: "Cyclic network",
    description: "A grid of neighboring delays with selected return routes.",
    cyclic: true,
  }),
  modular: Object.freeze({
    label: "Modular Islands",
    family: "Community graph",
    description: "Tight cyclic communities connected by sparse one-way bridges.",
    cyclic: true,
  }),
  random: Object.freeze({
    label: "Seeded Random",
    family: "General directed graph",
    description: "A repeatable directed network whose cycles emerge from density.",
    cyclic: null,
  }),
});

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function seededRandom(seed = 1) {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function addEdge(edges, seen, from, to) {
  if (from === to) return;
  const key = `${from}:${to}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from, to });
}

function circleLayout(count, radius = 0.38) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    return { id: index, x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
  });
}

function layeredLayout(count, columns) {
  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    const column = Math.min(columns - 1, Math.floor(index * columns / count));
    const members = Array.from({ length: count }, (_, candidate) => candidate)
      .filter((candidate) => Math.min(columns - 1, Math.floor(candidate * columns / count)) === column);
    const row = members.indexOf(index);
    nodes.push({
      id: index,
      x: columns === 1 ? 0.5 : 0.12 + (column / (columns - 1)) * 0.76,
      y: 0.15 + ((row + 1) / (members.length + 1)) * 0.7,
    });
  }
  return nodes;
}

function tarjan(nodeCount, edges) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) adjacency[edge.from].push(edge.to);
  const indices = Array(nodeCount).fill(-1);
  const low = Array(nodeCount).fill(0);
  const stack = [];
  const onStack = new Set();
  const components = [];
  let cursor = 0;

  function visit(node) {
    indices[node] = cursor;
    low[node] = cursor;
    cursor += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency[node]) {
      if (indices[next] < 0) {
        visit(next);
        low[node] = Math.min(low[node], low[next]);
      } else if (onStack.has(next)) {
        low[node] = Math.min(low[node], indices[next]);
      }
    }
    if (low[node] !== indices[node]) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component);
  }

  for (let node = 0; node < nodeCount; node += 1) if (indices[node] < 0) visit(node);
  return components;
}

export function annotateCycles(nodeCount, edges) {
  const components = tarjan(nodeCount, edges);
  const componentByNode = new Map();
  components.forEach((component, index) => {
    for (const node of component) componentByNode.set(node, { index, size: component.length });
  });
  const annotated = edges.map((edge) => ({
    ...edge,
    cyclic: componentByNode.get(edge.from)?.index === componentByNode.get(edge.to)?.index
      && componentByNode.get(edge.from)?.size > 1,
  }));
  return {
    edges: annotated,
    components,
    cyclic: annotated.some((edge) => edge.cyclic),
  };
}

export function generateGraph(options = {}) {
  const {
    type = options.topology ?? "dag",
    nodeCount = 10,
    density = 0.34,
    seed = 1,
  } = options;
  const count = Math.round(clamp(nodeCount, 3, MAX_GRAPH_NODES));
  const amount = clamp(density, 0, 1);
  const random = seededRandom(seed);
  const edges = [];
  const seen = new Set();
  let nodes;

  if (type === "chain") {
    nodes = layeredLayout(count, count);
    for (let node = 0; node < count - 1; node += 1) addEdge(edges, seen, node, node + 1);
  } else if (type === "tree") {
    const levels = Math.ceil(Math.log2(count + 1));
    nodes = Array.from({ length: count }, (_, node) => {
      const level = Math.floor(Math.log2(node + 1));
      const first = (2 ** level) - 1;
      const position = node - first;
      const members = Math.min(2 ** level, count - first);
      return {
        id: node,
        x: 0.12 + (level / Math.max(1, levels - 1)) * 0.76,
        y: 0.12 + ((position + 1) / (members + 1)) * 0.76,
      };
    });
    for (let node = 1; node < count; node += 1) addEdge(edges, seen, Math.floor((node - 1) / 2), node);
  } else if (type === "dag") {
    nodes = layeredLayout(count, Math.min(5, Math.ceil(Math.sqrt(count))));
    for (let node = 0; node < count - 1; node += 1) addEdge(edges, seen, node, node + 1);
    for (let from = 0; from < count; from += 1) {
      for (let to = from + 2; to < count; to += 1) {
        if (random() < amount * 0.35) addEdge(edges, seen, from, to);
      }
    }
  } else if (type === "bipartite") {
    nodes = layeredLayout(count, 2);
    const split = Math.ceil(count / 2);
    for (let from = 0; from < split; from += 1) {
      for (let to = split; to < count; to += 1) {
        if (random() < 0.22 + amount * 0.72) addEdge(edges, seen, from, to);
      }
    }
    if (!edges.length) addEdge(edges, seen, 0, split);
  } else if (type === "ring" || type === "smallworld") {
    nodes = circleLayout(count);
    for (let node = 0; node < count; node += 1) addEdge(edges, seen, node, (node + 1) % count);
    if (type === "smallworld") {
      for (let node = 0; node < count; node += 1) {
        if (random() < 0.15 + amount * 0.7) {
          const jump = 2 + Math.floor(random() * Math.max(1, count - 3));
          addEdge(edges, seen, node, (node + jump) % count);
        }
      }
    }
  } else if (type === "hub") {
    nodes = [{ id: 0, x: 0.5, y: 0.5 }, ...circleLayout(count - 1, 0.38)
      .map((node, index) => ({ ...node, id: index + 1 }))];
    for (let node = 1; node < count; node += 1) {
      addEdge(edges, seen, 0, node);
      if (random() < 0.35 + amount * 0.65) addEdge(edges, seen, node, 0);
    }
  } else if (type === "mesh") {
    const columns = Math.ceil(Math.sqrt(count));
    nodes = Array.from({ length: count }, (_, node) => ({
      id: node,
      x: 0.14 + ((node % columns) / Math.max(1, columns - 1)) * 0.72,
      y: 0.14 + (Math.floor(node / columns) / Math.max(1, Math.ceil(count / columns) - 1)) * 0.72,
    }));
    for (let node = 0; node < count; node += 1) {
      const right = node + 1;
      const down = node + columns;
      if (right < count && right % columns) {
        addEdge(edges, seen, node, right);
        if (random() < amount) addEdge(edges, seen, right, node);
      }
      if (down < count) {
        addEdge(edges, seen, node, down);
        if (random() < amount) addEdge(edges, seen, down, node);
      }
    }
  } else if (type === "modular") {
    nodes = circleLayout(count);
    const groups = Math.min(3, Math.floor(count / 3));
    const size = Math.ceil(count / groups);
    for (let group = 0; group < groups; group += 1) {
      const start = group * size;
      const end = Math.min(count, start + size);
      for (let node = start; node < end; node += 1) addEdge(edges, seen, node, node + 1 < end ? node + 1 : start);
      if (group + 1 < groups) addEdge(edges, seen, end - 1, end);
    }
  } else {
    nodes = circleLayout(count);
    for (let node = 0; node < count - 1; node += 1) addEdge(edges, seen, node, node + 1);
    for (let from = 0; from < count; from += 1) {
      for (let to = 0; to < count; to += 1) {
        if (from !== to && random() < amount * 0.16) addEdge(edges, seen, from, to);
      }
    }
  }

  const annotated = annotateCycles(count, edges);
  const indegree = Array(count).fill(0);
  const outdegree = Array(count).fill(0);
  const cyclicIndegree = Array(count).fill(0);
  for (const edge of annotated.edges) {
    indegree[edge.to] += 1;
    outdegree[edge.from] += 1;
    if (edge.cyclic) cyclicIndegree[edge.to] += 1;
  }
  return {
    type,
    nodes,
    edges: annotated.edges.map((edge, index) => ({ ...edge, id: index })),
    components: annotated.components,
    cyclic: annotated.cyclic,
    indegree,
    outdegree,
    cyclicIndegree,
    entries: nodes.filter((node) => indegree[node.id] === 0).map((node) => node.id),
  };
}

export function edgeAudioParameters(graph, {
  baseDelay = 180,
  dispersion = 0.45,
  timeScale = null,
  feedback = 0.72,
} = {}) {
  return graph.edges.map((edge, index) => {
    const hash = ((edge.from + 1) * 31 + (edge.to + 1) * 17 + index * 13) % 101;
    const variation = ((hash / 100) * 2 - 1) * clamp(dispersion, 0, 1);
    const from = graph.nodes[edge.from];
    const to = graph.nodes[edge.to];
    const normalizedLength = clamp(
      Math.hypot((to?.x ?? 0) - (from?.x ?? 0), (to?.y ?? 0) - (from?.y ?? 0))
        / Math.SQRT2,
      0,
      1,
    );
    const geometricDelay = Number.isFinite(Number(timeScale))
      ? clamp(baseDelay, 4, 400) + normalizedLength * clamp(timeScale, 0, 1600)
      : clamp(baseDelay, 8, 1600) * (1 + variation);
    const delaySeconds = clamp(
      geometricDelay / 1000,
      0.004,
      2,
    );
    const incoming = edge.cyclic
      ? Math.max(1, graph.cyclicIndegree[edge.to])
      : Math.max(1, graph.indegree[edge.to]);
    return {
      ...edge,
      normalizedLength,
      delaySeconds,
      gain: edge.cyclic
        ? clamp(feedback, 0, MAX_GRAPH_FEEDBACK) / incoming
        : 0.78 / Math.sqrt(incoming * Math.max(1, graph.outdegree[edge.from])),
    };
  });
}
