import { GRAPH_PRESETS } from '../graph-delay/graph-delay.js';
import { DEFAULT_RUST_GRAPH_TURN_ROUTES, MAX_RUST_GRAPH_NODES, MAX_RUST_GRAPH_TURN_ROUTES,
  generateGraphWithinRustBudget } from './graph-delay-topology.js';

// As in GraphSynth, use a local seeded placement stream so every random source
// produces separated nodes, including deterministic or constant test sources.
function seededUnit(random) {
  const sample = Number(random());
  let state = Math.floor((Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : .5) * 0x1_0000_0000) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** Change geometry alone. Return detached graph data so a rejected or stale
 * asynchronous installation cannot alter the graph the performer is hearing. */
export function randomizeGraphPositions(graph, random = Math.random) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) throw new TypeError('Node positions need a graph with nodes and edges.');
  if (!graph.nodes.length || graph.nodes.length > MAX_RUST_GRAPH_NODES) throw new RangeError('Random positions supports 1–64 graph nodes.');
  const result = structuredClone(graph), unit = seededUnit(random), placed = [];
  const minimumDistance = Math.max(.065, .16 / Math.sqrt(Math.max(1, result.nodes.length / 8)));
  for (const node of result.nodes) {
    let best = null, bestDistance = -1;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = { x: .02 + unit() * .96, y: .02 + unit() * .96 };
      const distance = placed.reduce((nearest, other) => Math.min(nearest, Math.hypot(candidate.x - other.x, candidate.y - other.y)), Infinity);
      if (distance > bestDistance) { best = candidate; bestDistance = distance; }
      if (distance >= minimumDistance) break;
    }
    // At dense layouts retain the most separated sampled candidate, rather
    // than the final failed trial. Work remains bounded at 64 trials per node.
    node.x = best.x; node.y = best.y; placed.push(best);
  }
  return result;
}

/** Randomize graph structure and geometry within the current preparation
 * budget. Only graph parameters are returned; sound and transport stay owned
 * by the instrument controller. No route list is silently truncated. */
export function createRandomGraph(state = {}, turnBudget = DEFAULT_RUST_GRAPH_TURN_ROUTES, random = Math.random) {
  if (!Number.isInteger(turnBudget) || turnBudget < 2 || turnBudget > MAX_RUST_GRAPH_TURN_ROUTES) {
    throw new RangeError('Random graph needs a preparation budget of 2–512 voices to connect at least three nodes.');
  }
  const unit = seededUnit(random), topologies = Object.keys(GRAPH_PRESETS).filter(id => id !== state.topology);
  const rawSeed = Number(state.seed), currentSeed = Number.isFinite(rawSeed) ? Math.round(rawSeed) : 1;
  const seed = ((currentSeed - 1 + 1 + Math.floor(unit() * 98)) % 99 + 99) % 99 + 1;
  const maximumNodes = Math.min(MAX_RUST_GRAPH_NODES, turnBudget + 1);
  const finish = admission => ({
    parameters: { topology: admission.graph.type, nodeCount: admission.graph.nodes.length, density: admission.density, seed, graphPatch: 'custom' },
    admission: { ...admission, graph: randomizeGraphPositions(admission.graph, unit) },
  });
  for (let attempt = 0; attempt < 12; attempt++) {
    const topology = topologies[Math.floor(unit() * topologies.length)];
    const nodeCount = Math.round(3 + unit() ** 1.7 * (maximumNodes - 3));
    const density = Math.round((.18 + unit() * .46) * 100) / 100;
    try { return finish(generateGraphWithinRustBudget({ type: topology, nodeCount, density, seed }, turnBudget)); }
    catch (error) { if (!(error instanceof RangeError)) throw error; }
  }
  // A three-node chain always fits a valid budget, even when every randomly
  // sampled cyclic topology requires more routes than this device allows.
  return finish(generateGraphWithinRustBudget({ type: 'chain', nodeCount: 3, density: 0, seed }, turnBudget));
}
