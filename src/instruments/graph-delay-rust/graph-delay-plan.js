import { edgeAudioParameters, graphEdgeSwitchMultipliers, graphNodePans, graphSinkNodeIds, graphTurnRoutings } from '../graph-delay/graph-delay.js';

export const MAX_RUST_GRAPH_NODES = 64;
export const MAX_RUST_GRAPH_TURN_ROUTES = 512;
export const MAX_RUST_GRAPH_EDGES = 256;
const clamp = (value, low, high, fallback) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

/** Numeric graph control plan. Every turn retains its own pitch and phase; a
 * source history is shared only by turns that read the same incoming edge. */
export function compileGraphDelayPlan(graph, source = {}, switches = null) {
  if (!graph?.nodes?.length || graph.nodes.length > MAX_RUST_GRAPH_NODES || graph.edges.length > MAX_RUST_GRAPH_EDGES) {
    throw new RangeError('The Rust graph supports 1–64 nodes and at most 256 edges.');
  }
  if (graph.nodes.some((node, index) => node.id !== index || !Number.isFinite(node.x) || !Number.isFinite(node.y))
    || graph.edges.some((edge, index) => edge.id !== index || !graph.nodes[edge.from] || !graph.nodes[edge.to])) {
    throw new TypeError('The graph must use contiguous node and edge identifiers.');
  }
  const settings = {
    baseDelay: clamp(source.baseDelay, 20, 600, 62),
    timeScale: clamp(source.timeScale, 0, 1600, 180),
    timeCurve: clamp(source.timeCurve, .25, 3, .9),
    nodePass: clamp(source.nodePass, 0, 1, 1), feedback: clamp(source.feedback, 0, .92, .72),
    damping: clamp(source.damping, 250, 14000, 4800),
    wet: clamp(source.wet, 0, 1.5, 1.08), dry: clamp(source.dry, 0, 1, .18),
    spread: clamp(source.spread, 0, 1, .82), inputTrim: clamp(source.inputTrim, 0, 1.5, .8),
    output: clamp(source.output ?? source.level, 0, .9, .58),
    pitchScale: clamp(source.pitchScale, 0, 2, .26), pitchAsymmetry: clamp(source.pitchAsymmetry, -.8, .8, 0),
    pitchCurve: clamp(source.pitchCurve, .5, 2, 1.35), pitchSlew: clamp(source.pitchSlew, 10, 600, 165),
    inputX: clamp(source.inputX, .02, .98, .08), inputY: clamp(source.inputY, .02, .98, .5),
  };
  const entries = graph.entries?.length ? graph.entries : [0];
  if (new Set(entries).size !== entries.length || entries.some(id => !Number.isInteger(id) || !graph.nodes[id])) throw new TypeError('The graph entry identifiers are invalid.');
  const entryIndex = new Map(entries.map((id, index) => [id, index]));
  const routings = graphTurnRoutings(graph, { ...settings, inputPosition: { x: settings.inputX, y: settings.inputY } });
  const routes = routings.flatMap(routing => routing.turns.map(turn => ({
    source: turn.previousEdgeId ?? graph.edges.length + entryIndex.get(routing.nodeId),
    edge: turn.nextEdgeId, semitones: turn.semitones,
    seed: (Math.imul(routing.nodeId + 1, 0x9e3779b1) ^ Math.imul(turn.sourceIndex * routing.outputs.length + turn.outputIndex + 1, 0x85ebca77)) >>> 0,
  })));
  if (routes.length > MAX_RUST_GRAPH_TURN_ROUTES) throw new RangeError('The Rust graph supports at most 512 independent turn voices.');
  const flags = Array.isArray(switches) ? switches : graph.edges.map(edge => switches instanceof Map ? switches.get(`${edge.from}>${edge.to}`) ?? true : true);
  const gates = graphEdgeSwitchMultipliers(graph, flags);
  const edges = edgeAudioParameters(graph, settings);
  const sinks = graphSinkNodeIds(graph), pans = graphNodePans(graph, sinks, settings.spread), sinkSet = new Set(sinks);
  const tapGain = .9 / Math.max(1, sinks.length) ** .25;
  // Header 16; node [pan,tap]; edge [from,to,delay,gain,gate,feedback];
  // entry [node,delay,gain]; route [source,edge,semitones,seed].
  const data = new Float64Array(16 + graph.nodes.length * 2 + edges.length * 6 + entries.length * 3 + routes.length * 4);
  data.set([1, graph.nodes.length, edges.length, entries.length, routes.length, settings.inputTrim,
    settings.wet, settings.dry, settings.output, settings.damping, settings.pitchSlew / 1000]);
  let at = 16;
  for (const node of graph.nodes) { data.set([pans[node.id], sinkSet.has(node.id) ? tapGain : 0], at); at += 2; }
  for (const edge of edges) { data.set([edge.from, edge.to, edge.delaySeconds, edge.gain, gates[edge.id], Number(Boolean(edge.feedbackEdge))], at); at += 6; }
  const arrivals = Array(graph.nodes.length).fill(Infinity);
  for (const id of entries) {
    const length = Math.hypot(graph.nodes[id].x - settings.inputX, graph.nodes[id].y - settings.inputY) / Math.SQRT2;
    const delay = (Math.max(4, Math.min(24, settings.baseDelay * .08)) + length * Math.min(120, settings.timeScale * .2)) / 1000;
    arrivals[id] = delay;
    data.set([id, delay, 1 / Math.sqrt(entries.length)], at); at += 3;
  }
  // Shortest causal wet arrival bounds structural warmup. Cycles cannot
  // decrease these strictly positive path delays.
  const pitchedEdges = new Set(routes.filter(route => Math.abs(route.semitones) > .08).map(route => route.edge));
  const visited = new Set();
  for (let count = 0; count < graph.nodes.length; count++) {
    let nearest = -1;
    for (let id = 0; id < arrivals.length; id++) if (!visited.has(id) && (nearest < 0 || arrivals[id] < arrivals[nearest])) nearest = id;
    if (nearest < 0 || !Number.isFinite(arrivals[nearest])) break;
    visited.add(nearest);
    for (const edge of edges) if (edge.from === nearest && gates[edge.id] > 0) arrivals[edge.to] = Math.min(arrivals[edge.to], arrivals[nearest] + edge.delaySeconds + (pitchedEdges.has(edge.id) ? .12 : 0));
  }
  const firstArrival = Math.min(...sinks.map(id => arrivals[id]));
  data[11] = Number.isFinite(firstArrival) ? Math.min(40, firstArrival + .02) : .15;
  for (const route of routes) { data.set([route.source, route.edge, route.semitones, route.seed], at); at += 4; }
  const signature = [graph.nodes.length, ...edges.flatMap(edge => [edge.from, edge.to, Number(Boolean(edge.feedbackEdge))]), 'entries', ...entries].join(':');
  return { data, signature, nodes: graph.nodes.length, edges: edges.length, routes: routes.length, settings };
}
