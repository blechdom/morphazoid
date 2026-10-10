import { generateGraphWithinTurnBudget } from '../graph-delay/graph-delay.js';
import { MAX_RUST_GRAPH_NODES, MAX_RUST_GRAPH_EDGES, MAX_RUST_GRAPH_TURN_ROUTES } from './graph-delay-plan.js';

export { MAX_RUST_GRAPH_NODES, MAX_RUST_GRAPH_EDGES, MAX_RUST_GRAPH_TURN_ROUTES };
// Leave headroom for old and new networks to overlap during scene transitions.
// The DSP ABI admits 512 routes; browser-generated scenes use this lower bound.
export const DEFAULT_RUST_GRAPH_TURN_ROUTES = 384;

/** Admit a complete graph, never a silently truncated routing matrix. Dense
 * bipartite graphs need a separate history-memory limit as well as turn cost. */
export function generateGraphWithinRustBudget(options = {}) {
  const requestedDensity = Math.max(0, Math.min(1, Number(options.density ?? .34) || 0));
  let result = generateGraphWithinTurnBudget({ ...options, maxNodes: MAX_RUST_GRAPH_NODES, density: requestedDensity }, DEFAULT_RUST_GRAPH_TURN_ROUTES);
  if (result.graph.edges.length > MAX_RUST_GRAPH_EDGES) {
    // Every edge has at least one turn feeding it. The tighter turn budget is
    // a conservative admission bound when histories, rather than voices, fill.
    result = generateGraphWithinTurnBudget({ ...options, maxNodes: MAX_RUST_GRAPH_NODES, density: requestedDensity }, MAX_RUST_GRAPH_EDGES);
  }
  if (result.graph.edges.length > MAX_RUST_GRAPH_EDGES || result.turnRouteCount > DEFAULT_RUST_GRAPH_TURN_ROUTES) {
    throw new RangeError('This graph cannot fit the Rust feedback budget.');
  }
  return result;
}
