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

export const GRAPH_DELAY_PATCHES = Object.freeze({
  clearSteps: Object.freeze({
    label: "Clear Steps",
    family: "Acyclic",
    description: "Eight clean serial echoes with restrained pitch turns.",
    topology: "chain", nodeCount: 8, density: 0, seed: 11,
    baseDelay: 170, timeScale: 45, timeCurve: 1, nodePass: 0.98,
    pitchScale: 0.2, pitchAsymmetry: 0, pitchCurve: 1, pitchSlew: 90, feedback: 0.5,
    damping: 7_200, wet: 0.76, dry: 0.08, spread: 0.58,
  }),
  lowLadder: Object.freeze({
    label: "Low Ladder",
    family: "Acyclic",
    description: "A slow twelve-stage chain biased toward downward turns.",
    topology: "chain", nodeCount: 12, density: 0, seed: 23,
    baseDelay: 310, timeScale: 80, timeCurve: 0.85, nodePass: 0.99,
    pitchScale: 0.35, pitchAsymmetry: -0.25, pitchCurve: 1.2, pitchSlew: 130, feedback: 0.5,
    damping: 4_200, wet: 0.86, dry: 0.04, spread: 0.74,
  }),
  branchChoir: Object.freeze({
    label: "Branch Choir",
    family: "Acyclic",
    description: "A balanced tree whose sibling turns form widening intervals.",
    topology: "tree", nodeCount: 15, density: 0.3, seed: 17,
    baseDelay: 190, timeScale: 85, timeCurve: 1, nodePass: 0.96,
    pitchScale: 0.55, pitchAsymmetry: 0, pitchCurve: 1.15, pitchSlew: 80, feedback: 0.55,
    damping: 6_400, wet: 0.8, dry: 0.06, spread: 0.9,
  }),
  glassCanopy: Object.freeze({
    label: "Glass Canopy",
    family: "Acyclic",
    description: "A bright compact tree with quick, high relative turns.",
    topology: "tree", nodeCount: 11, density: 0.3, seed: 31,
    baseDelay: 105, timeScale: 40, timeCurve: 1.2, nodePass: 0.94,
    pitchScale: 0.9, pitchAsymmetry: 0.1, pitchCurve: 0.9, pitchSlew: 40, feedback: 0.5,
    damping: 9_200, wet: 0.72, dry: 0.1, spread: 0.82,
  }),
  layeredGlass: Object.freeze({
    label: "Layered Glass",
    family: "Acyclic",
    description: "The balanced default: crossing DAG paths with closely related delays.",
    topology: "dag", nodeCount: 10, density: 0.34, seed: 17,
    baseDelay: 220, timeScale: 60, timeCurve: 1, nodePass: 0.96,
    pitchScale: 0.5, pitchAsymmetry: 0, pitchCurve: 1, pitchSlew: 80, feedback: 0.72,
    damping: 4_800, wet: 0.82, dry: 0.06, spread: 0.8,
  }),
  rainLattice: Object.freeze({
    label: "Rain Lattice",
    family: "Acyclic",
    description: "A denser layered graph of short staggered droplets.",
    topology: "dag", nodeCount: 14, density: 0.52, seed: 47,
    baseDelay: 125, timeScale: 95, timeCurve: 0.75, nodePass: 0.93,
    pitchScale: 0.85, pitchAsymmetry: 0.1, pitchCurve: 1.2, pitchSlew: 55, feedback: 0.6,
    damping: 7_600, wet: 0.78, dry: 0.05, spread: 0.94,
  }),
  twinBanks: Object.freeze({
    label: "Twin Banks",
    family: "Acyclic",
    description: "Two node fields exchange a broad fan of parallel delayed voices.",
    topology: "bipartite", nodeCount: 12, density: 0.42, seed: 29,
    baseDelay: 245, timeScale: 55, timeCurve: 1, nodePass: 0.97,
    pitchScale: 0.65, pitchAsymmetry: 0, pitchCurve: 1.1, pitchSlew: 90, feedback: 0.55,
    damping: 5_600, wet: 0.84, dry: 0.04, spread: 1,
  }),
  haloRing: Object.freeze({
    label: "Halo Ring",
    family: "Cyclic",
    description: "A gentle nine-node orbit with a controlled repeating pitch spiral.",
    topology: "ring", nodeCount: 9, density: 0.2, seed: 13,
    baseDelay: 185, timeScale: 50, timeCurve: 1, nodePass: 0.98,
    pitchScale: 0.4, pitchAsymmetry: -0.1, pitchCurve: 1.2, pitchSlew: 110, feedback: 0.58,
    damping: 5_200, wet: 0.8, dry: 0.05, spread: 0.88,
  }),
  slowOrbit: Object.freeze({
    label: "Slow Orbit",
    family: "Cyclic",
    description: "A dark twelve-stage ring with long decaying revolutions.",
    topology: "ring", nodeCount: 12, density: 0.2, seed: 37,
    baseDelay: 380, timeScale: 70, timeCurve: 0.9, nodePass: 0.99,
    pitchScale: 0.3, pitchAsymmetry: -0.2, pitchCurve: 1.4, pitchSlew: 160, feedback: 0.76,
    damping: 2_900, wet: 0.88, dry: 0.03, spread: 0.72,
  }),
  shortcutChorus: Object.freeze({
    label: "Shortcut Chorus",
    family: "Cyclic",
    description: "A small-world ring with a few shortcuts and chorused return times.",
    topology: "smallworld", nodeCount: 13, density: 0.38, seed: 41,
    baseDelay: 155, timeScale: 110, timeCurve: 0.8, nodePass: 0.94,
    pitchScale: 1.1, pitchAsymmetry: 0.12, pitchCurve: 1.05, pitchSlew: 60, feedback: 0.63,
    damping: 5_900, wet: 0.82, dry: 0.05, spread: 0.96,
  }),
  hubScatter: Object.freeze({
    label: "Hub Scatter",
    family: "Cyclic",
    description: "Ten spokes scatter through one central merge without overwhelming it.",
    topology: "hub", nodeCount: 10, density: 0.38, seed: 19,
    baseDelay: 135, timeScale: 125, timeCurve: 0.9, nodePass: 0.92,
    pitchScale: 0.8, pitchAsymmetry: 0, pitchCurve: 1.15, pitchSlew: 70, feedback: 0.54,
    damping: 6_800, wet: 0.76, dry: 0.07, spread: 1,
  }),
  softMesh: Object.freeze({
    label: "Soft Mesh",
    family: "Cyclic",
    description: "A twelve-node neighbor mesh with muted, well-damped returns.",
    topology: "mesh", nodeCount: 12, density: 0.32, seed: 53,
    baseDelay: 205, timeScale: 65, timeCurve: 1.1, nodePass: 0.94,
    pitchScale: 0.6, pitchAsymmetry: 0, pitchCurve: 1.35, pitchSlew: 110, feedback: 0.48,
    damping: 3_600, wet: 0.8, dry: 0.05, spread: 0.86,
  }),
  islandSignals: Object.freeze({
    label: "Island Signals",
    family: "Cyclic",
    description: "Three cyclic communities pass softened echoes across sparse bridges.",
    topology: "modular", nodeCount: 15, density: 0.3, seed: 61,
    baseDelay: 270, timeScale: 90, timeCurve: 1, nodePass: 0.96,
    pitchScale: 0.5, pitchAsymmetry: -0.15, pitchCurve: 1.3, pitchSlew: 140, feedback: 0.64,
    damping: 4_100, wet: 0.86, dry: 0.03, spread: 0.92,
  }),
  dustPaths: Object.freeze({
    label: "Dust Paths",
    family: "Generative",
    description: "A sparse seeded network with airy, unpredictable path mergers.",
    topology: "random", nodeCount: 11, density: 0.28, seed: 73,
    baseDelay: 175, timeScale: 145, timeCurve: 0.75, nodePass: 0.95,
    pitchScale: 0.7, pitchAsymmetry: -0.1, pitchCurve: 1.1, pitchSlew: 85, feedback: 0.5,
    damping: 7_000, wet: 0.78, dry: 0.07, spread: 0.98,
  }),
});

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function wrapRadians(value) {
  const number = Number(value) || 0;
  const wrapped = Math.atan2(Math.sin(number), Math.cos(number));
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function directedHeading(from, to) {
  const angle = Math.atan2(
    -((to?.y ?? 0) - (from?.y ?? 0)),
    (to?.x ?? 0) - (from?.x ?? 0),
  );
  return Object.is(angle, -0) ? 0 : angle;
}

export function relativeTurnRadians(previousFrom, pivot, nextTo) {
  return wrapRadians(
    directedHeading(pivot, nextTo) - directedHeading(previousFrom, pivot),
  );
}

/**
 * Convert a signed relative turn into a local pitch interval. A straight path
 * is always unshifted. Pitch scale is the number of octaves spanned by a
 * half-turn, so every incoming frequency is multiplied proportionally without
 * pretending the microphone has one fixed reference pitch.
 */
export function turnPitchSemitones(turnRadians, {
  pitchScale = 0.5,
  pitchAsymmetry = 0,
  pitchCurve = 1,
} = {}) {
  const turn = wrapRadians(turnRadians);
  const direction = Math.sign(turn);
  const octaveSpan = clamp(pitchScale, 0, 2);
  const asymmetry = clamp(pitchAsymmetry, -0.8, 0.8);
  const response = clamp(pitchCurve, 0.5, 2);
  const angleAmount = (Math.abs(turn) / Math.PI) ** response;
  // Negative screen-space turns bend right; positive turns bend left.
  const directionScale = direction < 0 ? 1 + asymmetry : 1 - asymmetry;
  const semitones = direction * 12 * octaveSpan * directionScale * angleAmount;
  return clamp(semitones, -48, 48);
}

/**
 * Describe every incoming-source → outgoing-edge turn at one node. Input is a
 * pseudo incoming segment for source nodes (and node zero in an all-cyclic
 * graph). The stable source/output indices are also the AudioWorklet routing
 * contract.
 */
export function nodeTurnRouting(graph, nodeId, {
  inputPosition = { x: 0, y: 0.5 },
  pitchScale = 0.5,
  pitchAsymmetry = 0,
  pitchCurve = 1,
} = {}) {
  const node = graph.nodes[nodeId];
  if (!node) return { nodeId, sources: [], outputs: [], turns: [] };
  const injectedNodes = new Set(graph.entries?.length ? graph.entries : [0]);
  const incoming = graph.edges.filter((edge) => edge.to === nodeId);
  const sources = [
    ...(injectedNodes.has(nodeId)
      ? [{ kind: "input", key: `input:${nodeId}`, edgeId: null, from: inputPosition }]
      : []),
    ...incoming.map((edge) => ({
      kind: "edge",
      key: `edge:${edge.id}`,
      edgeId: edge.id,
      from: graph.nodes[edge.from],
    })),
  ];
  const outputs = graph.edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => ({ key: `edge:${edge.id}`, edgeId: edge.id, to: graph.nodes[edge.to] }));
  const pitchOptions = { pitchScale, pitchAsymmetry, pitchCurve };
  const turns = sources.flatMap((source, sourceIndex) => (
    outputs.map((output, outputIndex) => {
      const radians = relativeTurnRadians(source.from, node, output.to);
      return {
        nodeId,
        sourceIndex,
        outputIndex,
        previousEdgeId: source.edgeId,
        nextEdgeId: output.edgeId,
        radians,
        semitones: turnPitchSemitones(radians, pitchOptions),
      };
    })
  ));
  return { nodeId, sources, outputs, turns };
}

export function graphTurnRoutings(graph, options = {}) {
  return graph.nodes.map((node) => nodeTurnRouting(graph, node.id, options));
}

export function graphOutputNodeIds(graph) {
  if (!Array.isArray(graph.components) || !graph.components.length) {
    return graph.nodes
      .filter((node) => graph.outdegree[node.id] === 0)
      .map((node) => node.id);
  }
  const componentByNode = new Map();
  graph.components.forEach((component, index) => {
    for (const nodeId of component) componentByNode.set(nodeId, index);
  });
  const componentsWithOutputs = new Set();
  for (const edge of graph.edges) {
    const fromComponent = componentByNode.get(edge.from);
    const toComponent = componentByNode.get(edge.to);
    if (fromComponent !== toComponent) componentsWithOutputs.add(fromComponent);
  }
  return graph.components
    .map((component, index) => ({ component, index }))
    .filter(({ index }) => !componentsWithOutputs.has(index))
    .map(({ component }) => Math.max(...component))
    .sort((first, second) => first - second);
}

/**
 * Pan only the audible terminal taps. Horizontal position describes progress
 * toward the fixed speaker, so using it for stereo biases every completed path
 * right. Vertical position carries the branch separation, recentered around
 * the active outputs so one terminal is mono and multiple terminals stay
 * balanced as a group.
 */
export function graphOutputPans(graph, spread = 1) {
  const pans = Array(graph.nodes.length).fill(0);
  const outputs = graphOutputNodeIds(graph);
  if (outputs.length < 2) return pans;
  const center = outputs.reduce(
    (sum, nodeId) => sum + (graph.nodes[nodeId]?.y ?? 0.5),
    0,
  ) / outputs.length;
  const maximumDeviation = Math.max(
    ...outputs.map((nodeId) => Math.abs((graph.nodes[nodeId]?.y ?? center) - center)),
  );
  // Avoid turning tiny vertical differences into hard-left/hard-right jumps.
  const extent = Math.max(0.25, maximumDeviation);
  const amount = clamp(spread, 0, 1);
  for (const nodeId of outputs) {
    pans[nodeId] = clamp(
      ((graph.nodes[nodeId]?.y ?? center) - center) / extent * amount,
      -amount,
      amount,
    );
  }
  return pans;
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
  // Any directed cycle must contain at least one edge that returns in this
  // stable node ordering. Those are the only edges that apply feedback decay;
  // the other edges inside an SCC pass signal onward like ordinary nodes.
  const routedEdges = annotated.edges.map((edge) => ({
    ...edge,
    feedbackEdge: edge.cyclic && edge.to <= edge.from,
  }));
  const indegree = Array(count).fill(0);
  const outdegree = Array(count).fill(0);
  const cyclicIndegree = Array(count).fill(0);
  for (const edge of routedEdges) {
    indegree[edge.to] += 1;
    outdegree[edge.from] += 1;
    if (edge.cyclic) cyclicIndegree[edge.to] += 1;
  }
  return {
    type,
    nodes,
    edges: routedEdges.map((edge, index) => ({ ...edge, id: index })),
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
  timeCurve = 1,
  nodePass = 0.96,
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
      ? clamp(baseDelay, 4, 600)
        + normalizedLength ** clamp(timeCurve, 0.25, 3) * clamp(timeScale, 0, 1600)
      : clamp(baseDelay, 8, 1600) * (1 + variation);
    const delaySeconds = clamp(
      geometricDelay / 1000,
      0.004,
      2,
    );
    const incoming = Math.max(1, graph.indegree[edge.to]);
    const outgoing = Math.max(1, graph.outdegree[edge.from]);
    const normalizedPass = clamp(nodePass, 0, 1) / Math.sqrt(incoming * outgoing);
    return {
      ...edge,
      normalizedLength,
      delaySeconds,
      gain: edge.feedbackEdge
        ? normalizedPass * clamp(feedback, 0, MAX_GRAPH_FEEDBACK)
        : normalizedPass,
    };
  });
}
