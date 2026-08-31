import {
  GRAPH_DELAY_PATCHES,
  edgeAudioParameters,
  graphEdgeSwitchMultipliers,
  relativeTurnRadians,
  turnPitchSemitones,
} from "./graph-delay.js?v=graph-instruments-20260830-2";

// Dense and cyclic graphs can revisit nodes many times. Keep their event queue
// explicitly bounded even though the editable instruments stop at 128 nodes.
export const MAX_GRAPH_EVENT_SCHEDULE = 8_192;
export const MIN_GRAPH_EVENT_AMPLITUDE = 0.001;
export const MAX_GRAPH_INSTRUMENT_NODES = 128;
export const MAX_GRAPH_INSTRUMENT_TURN_ROUTES = 4_096;
export const MAX_GRAPH_EQUAL_DIVISIONS = 360;

const DEFAULT_GRAPH_EVENT_HORIZON_SECONDS = 16;
const DEFAULT_GRAPH_EVENT_DEPTH = 128;
const DEFAULT_GRAPH_FEEDBACK_PASSES = 24;
const MAX_GRAPH_EVENT_HORIZON_SECONDS = 1_024;
const MAX_GRAPH_EVENT_DEPTH = MAX_GRAPH_EVENT_SCHEDULE;
const MAX_GRAPH_FEEDBACK_PASSES = 64;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

const positiveInteger = (value, fallback, maximum = Infinity) => Math.min(
  maximum,
  Math.max(0, Math.floor(finite(value, fallback))),
);

const patch = (id, overrides) => {
  const inherited = { ...GRAPH_DELAY_PATCHES[id] };
  delete inherited.timeScale;
  return Object.freeze({ ...inherited, ...overrides });
};

/**
 * A compact shared bank for the drum and synth graph pages. Each patch keeps a
 * proven Graph Delay topology and safety profile, then gives it an instrument-
 * specific edge clock, length response, tempo, and launch cadence.
 */
export const GRAPH_INSTRUMENT_PATCHES = Object.freeze({
  clearSteps: patch("clearSteps", {
    baseDelay: 55,
    distanceRatio: 1,
    timeCurve: 1,
    tempo: 144,
    pulseBeats: 0.5,
    triggerScope: "all",
    feedbackTone: 0.92,
    description: "Even 55 ms edges launch a crisp four-step phrase twice per beat.",
    drums: Object.freeze({
      mappingMode: "path-phase", percussionStyle: "circuit",
      pitchDepth: 5, turnPitchDepth: 3, characterDepth: 0.38,
    }),
  }),
  branchChoir: patch("branchChoir", {
    baseDelay: 190,
    distanceRatio: 50 / 19,
    timeCurve: 1.35,
    tempo: 72,
    pulseBeats: 4,
    triggerScope: "leaves",
    feedbackTone: 0.86,
    description: "A slow four-beat seed blooms through long, unhurried branches.",
    drums: Object.freeze({
      mappingMode: "degree-turn", percussionStyle: "karplus-strong",
      pitchDepth: 18, turnPitchDepth: 14, characterDepth: 0.82,
    }),
  }),
  layeredGlass: patch("layeredGlass", {
    baseDelay: 62,
    distanceRatio: 60 / 31,
    timeCurve: 0.9,
    tempo: 126,
    pulseBeats: 1,
    triggerScope: "all",
    feedbackTone: 0.78,
    description: "Close crossing times make a tight cascade on every beat.",
    drums: Object.freeze({
      mappingMode: "position-grid", percussionStyle: "circuit",
      pitchDepth: 12, turnPitchDepth: 9, characterDepth: 0.72,
    }),
  }),
  haloRing: patch("haloRing", {
    baseDelay: 105,
    distanceRatio: 8 / 7,
    timeCurve: 1,
    tempo: 100,
    pulseBeats: 2,
    triggerScope: "all",
    feedbackTone: 0.72,
    description: "Near-even edge times make a measured two-beat orbit and falling halo.",
    drums: Object.freeze({
      mappingMode: "path-phase", percussionStyle: "resonant-metal",
      pitchDepth: 16, turnPitchDepth: 20, characterDepth: 0.9,
    }),
  }),
  shortcutChorus: patch("shortcutChorus", {
    baseDelay: 36,
    distanceRatio: 28 / 3,
    timeCurve: 1.8,
    tempo: 108,
    pulseBeats: 2,
    triggerScope: "all",
    feedbackTone: 0.8,
    description: "Short hops and much longer shortcuts scatter each two-beat pulse into crooked answers.",
    drums: Object.freeze({
      mappingMode: "degree-turn", percussionStyle: "rattlesnake",
      pitchDepth: 9, turnPitchDepth: 18, characterDepth: 1,
    }),
  }),
  hubScatter: patch("hubScatter", {
    baseDelay: 24,
    distanceRatio: 37 / 12,
    timeCurve: 0.45,
    tempo: 156,
    pulseBeats: 0.5,
    triggerScope: "all",
    feedbackTone: 0.88,
    description: "Rapid spokes ricochet from the hub twice per beat.",
    drums: Object.freeze({
      mappingMode: "position-grid", percussionStyle: "drum-bank",
      pitchDepth: 24, turnPitchDepth: 7, characterDepth: 0.96,
    }),
  }),
  softMesh: patch("softMesh", {
    baseDelay: 120,
    distanceRatio: 17 / 6,
    timeCurve: 0.7,
    tempo: 76,
    pulseBeats: 2,
    triggerScope: "leaves",
    feedbackTone: 0.56,
    description: "Wide neighbor times smear slow clustered calls into softened returns.",
    drums: Object.freeze({
      mappingMode: "degree-turn", percussionStyle: "karplus-tines",
      pitchDepth: 4, turnPitchDepth: 5, characterDepth: 0.28,
    }),
  }),
  islandSignals: patch("islandSignals", {
    baseDelay: 260,
    distanceRatio: 3,
    timeCurve: 1.45,
    tempo: 60,
    pulseBeats: 4,
    triggerScope: "leaves",
    feedbackTone: 0.48,
    description: "Very long routes let three islands trade calls every four beats.",
    drums: Object.freeze({
      mappingMode: "path-phase", percussionStyle: "karplus-objects",
      pitchDepth: 20, turnPitchDepth: 24, characterDepth: 0.76,
    }),
  }),
});

function normalizedGraph(graph = {}) {
  const sourceNodes = Array.isArray(graph.nodes)
    ? graph.nodes.slice(0, MAX_GRAPH_INSTRUMENT_NODES)
    : [];
  const nodes = sourceNodes.map((node, id) => ({
    ...node,
    id,
    x: finite(node?.x, 0.5),
    y: finite(node?.y, 0.5),
  }));
  const edges = (Array.isArray(graph.edges) ? graph.edges : [])
    .map((edge, index) => ({
      ...edge,
      id: edge?.id ?? index,
      from: Math.floor(finite(edge?.from, -1)),
      to: Math.floor(finite(edge?.to, -1)),
    }))
    .filter((edge) => (
      edge.from >= 0
      && edge.from < nodes.length
      && edge.to >= 0
      && edge.to < nodes.length
    ));
  const indegree = Array(nodes.length).fill(0);
  const outdegree = Array(nodes.length).fill(0);
  for (const edge of edges) {
    indegree[edge.to] += 1;
    outdegree[edge.from] += 1;
  }
  const requestedEntries = Array.isArray(graph.entries)
    ? [...new Set(graph.entries
      .map((nodeId) => Math.floor(finite(nodeId, -1)))
      .filter((nodeId) => nodeId >= 0 && nodeId < nodes.length))]
    : [];
  const entries = requestedEntries.length
    ? requestedEntries
    : nodes.filter((node) => indegree[node.id] === 0).map((node) => node.id);
  if (!entries.length && nodes.length) entries.push(0);
  return {
    ...graph,
    nodes,
    edges,
    indegree,
    outdegree,
    entries,
  };
}

function enabledEdgeFlags(graph, enabledEdges) {
  if (Array.isArray(enabledEdges)) {
    return graph.edges.map((_edge, index) => enabledEdges[index] ?? true);
  }
  if (enabledEdges instanceof Set) {
    return graph.edges.map((edge) => (
      enabledEdges.has(edge.id)
      || enabledEdges.has(`${edge.from}>${edge.to}`)
    ));
  }
  if (enabledEdges instanceof Map) {
    return graph.edges.map((edge) => (
      enabledEdges.get(edge.id)
      ?? enabledEdges.get(`${edge.from}>${edge.to}`)
      ?? true
    ));
  }
  if (typeof enabledEdges === "function") {
    return graph.edges.map((edge, index) => Boolean(enabledEdges(edge, index)));
  }
  if (enabledEdges && typeof enabledEdges === "object") {
    return graph.edges.map((edge, index) => (
      enabledEdges[edge.id]
      ?? enabledEdges[`${edge.from}>${edge.to}`]
      ?? enabledEdges[index]
      ?? true
    ));
  }
  return graph.edges.map(() => true);
}

function eventComparison(first, second) {
  const firstPath = String(first.pathKey);
  const secondPath = String(second.pathKey);
  return first.time - second.time
    || first.feedbackCount - second.feedbackCount
    || first.depth - second.depth
    || (firstPath < secondPath ? -1 : firstPath > secondPath ? 1 : 0)
    || first.nodeId - second.nodeId;
}

// Dense graphs used to maintain a sorted Array with splice() + shift(), making
// an already bounded 8,192-event traversal quadratic. A binary min-heap keeps
// the same deterministic ordering without making graph thickness a UI hazard.
function insertEvent(queue, event) {
  queue.push(event);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (eventComparison(queue[parent], event) <= 0) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = event;
}

function takeNextEvent(queue) {
  if (!queue.length) return null;
  const first = queue[0];
  const last = queue.pop();
  if (!queue.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= queue.length) break;
    const right = left + 1;
    const child = right < queue.length
      && eventComparison(queue[right], queue[left]) < 0
      ? right
      : left;
    if (eventComparison(last, queue[child]) <= 0) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

function mixPathHash(hash, value) {
  let result = hash >>> 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16_777_619) >>> 0;
  }
  return result;
}

function entryPathIdentity(nodeId) {
  const hashA = mixPathHash(2_166_136_261, `entry:${nodeId}`);
  const hashB = mixPathHash(2_654_435_761, `node:${nodeId}`);
  return {
    pathHashA: hashA,
    pathHashB: hashB,
    pathKey: `p:${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}:0`,
  };
}

function descendantPathIdentity(event, edge, edgeIndex) {
  const token = `${edge.id}:${edgeIndex}:${edge.from}>${edge.to}`;
  const hashA = mixPathHash(event.pathHashA, token);
  const hashB = mixPathHash(event.pathHashB ^ 0x9e3779b9, token);
  const depth = event.depth + 1;
  return {
    pathHashA: hashA,
    pathHashB: hashB,
    // Keep public path identities fixed-size. The previous full ancestry
    // string reached thousands of characters per event in cyclic graphs.
    pathKey: `p:${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}:${depth}`,
  };
}

function graphEventLimits(options) {
  return {
    maxEvents: positiveInteger(
      options.maxEvents ?? options.eventCap,
      MAX_GRAPH_EVENT_SCHEDULE,
      MAX_GRAPH_EVENT_SCHEDULE,
    ),
    minAmplitude: clamp(
      options.minAmplitude ?? options.amplitudeFloor,
      Number.EPSILON,
      1,
      MIN_GRAPH_EVENT_AMPLITUDE,
    ),
    horizonSeconds: clamp(
      options.horizonSeconds ?? options.horizon,
      0,
      MAX_GRAPH_EVENT_HORIZON_SECONDS,
      DEFAULT_GRAPH_EVENT_HORIZON_SECONDS,
    ),
    maxDepth: positiveInteger(
      options.maxDepth ?? options.depthCap,
      DEFAULT_GRAPH_EVENT_DEPTH,
      MAX_GRAPH_EVENT_DEPTH,
    ),
    maxFeedbackPasses: positiveInteger(
      options.maxFeedbackPasses ?? options.feedbackPasses ?? options.passCap,
      DEFAULT_GRAPH_FEEDBACK_PASSES,
      MAX_GRAPH_FEEDBACK_PASSES,
    ),
  };
}

/**
 * Expand one graph pulse into deterministic, relative-time node arrivals.
 *
 * The event path retains its incoming edge and previous node, so a merge never
 * loses the turn provenance needed by the next branch. Cycles are ordinary
 * paths in the queue: their time comes from edgeAudioParameters(), and their
 * amplitude only receives the user feedback coefficient on `feedbackEdge`.
 */
export function scheduleGraphPulse(graph, options = {}) {
  const model = normalizedGraph(graph);
  if (!model.nodes.length) return [];
  const settings = { ...(options.patch ?? {}), ...options };
  const limits = graphEventLimits(settings);
  if (limits.maxEvents === 0) return [];
  const inputAmplitude = clamp(settings.amplitude, 0, 1, 1);
  if (inputAmplitude < limits.minAmplitude) return [];

  const edgeParameters = edgeAudioParameters(model, settings);
  const enabledFlags = enabledEdgeFlags(model, settings.enabledEdges);
  const switchMultipliers = graphEdgeSwitchMultipliers(model, enabledFlags);
  const outgoing = Array.from({ length: model.nodes.length }, () => []);
  edgeParameters.forEach((edge, index) => {
    outgoing[edge.from].push({ edge, index });
  });
  const reachableNodeIds = new Set();
  const reachableStack = [...model.entries];
  while (reachableStack.length) {
    const nodeId = reachableStack.pop();
    if (reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);
    for (const { edge, index } of outgoing[nodeId] ?? []) {
      if (
        enabledFlags[index]
        && switchMultipliers[index] > 0
        && edge.gain > 0
        && !reachableNodeIds.has(edge.to)
      ) reachableStack.push(edge.to);
    }
  }
  const inputPosition = {
    x: finite(settings.inputPosition?.x, 0),
    y: finite(settings.inputPosition?.y, 0.5),
  };
  const entryScale = settings.normalizeEntries === false
    ? 1
    : 1 / Math.sqrt(Math.max(1, model.entries.length));
  const queue = [];
  let admittedEventCount = 0;
  let duplicateAdmissionCount = 0;
  const discoveredNodeIds = new Set();
  // Reserve one event slot for each structurally reachable node before letting
  // duplicate paths consume the rest. Thick graphs therefore shed repeated
  // arrivals before a late node's first arrival, while total pending work can
  // never exceed maxEvents.
  const duplicateAdmissionLimit = Math.max(
    0,
    limits.maxEvents - reachableNodeIds.size,
  );
  const admitEvent = (event) => {
    // Bound pending work as well as returned work. Previously a highly
    // branching graph could stop at 8,192 rendered events after allocating a
    // far larger heap of descendants.
    if (admittedEventCount >= limits.maxEvents) return false;
    const firstNodeVisit = !discoveredNodeIds.has(event.nodeId);
    if (!firstNodeVisit && duplicateAdmissionCount >= duplicateAdmissionLimit) return false;
    insertEvent(queue, event);
    admittedEventCount += 1;
    if (firstNodeVisit) discoveredNodeIds.add(event.nodeId);
    else duplicateAdmissionCount += 1;
    return true;
  };
  for (const nodeId of model.entries) {
    const pathIdentity = entryPathIdentity(nodeId);
    if (!admitEvent({
      nodeId,
      time: 0,
      departTime: 0,
      arrivalEdgeId: null,
      previousNodeId: null,
      amplitude: inputAmplitude * entryScale,
      localTurn: 0,
      cumulativeTurn: 0,
      cumulativeSemitones: 0,
      depth: 0,
      feedbackCount: 0,
      kind: "node",
      ...pathIdentity,
    })) break;
  }

  const scheduledNodes = [];
  while (queue.length && scheduledNodes.length < limits.maxEvents) {
    const event = takeNextEvent(queue);
    if (event.time > limits.horizonSeconds + 1e-12) continue;
    scheduledNodes.push(event);
    if (event.depth >= limits.maxDepth) continue;

    const pivot = model.nodes[event.nodeId];
    const previous = event.previousNodeId === null
      ? inputPosition
      : model.nodes[event.previousNodeId] ?? inputPosition;
    for (const { edge, index } of outgoing[event.nodeId]) {
      if (!enabledFlags[index] || switchMultipliers[index] <= 0) continue;
      const feedbackCount = event.feedbackCount + (edge.feedbackEdge ? 1 : 0);
      if (feedbackCount > limits.maxFeedbackPasses) continue;
      const amplitude = event.amplitude * edge.gain * switchMultipliers[index];
      if (!Number.isFinite(amplitude) || amplitude < limits.minAmplitude) continue;
      const time = event.time + edge.delaySeconds;
      if (time > limits.horizonSeconds + 1e-12) continue;
      const localTurn = relativeTurnRadians(previous, pivot, model.nodes[edge.to]);
      const localSemitones = turnPitchSemitones(localTurn, settings);
      const pathIdentity = descendantPathIdentity(event, edge, index);
      const nextEvent = {
        nodeId: edge.to,
        time,
        departTime: event.time,
        arrivalEdgeId: edge.id,
        previousNodeId: event.nodeId,
        amplitude,
        localTurn,
        cumulativeTurn: event.cumulativeTurn + localTurn,
        cumulativeSemitones: event.cumulativeSemitones + localSemitones,
        depth: event.depth + 1,
        feedbackCount,
        kind: "node",
        ...pathIdentity,
      };
      admitEvent(nextEvent);
    }
  }
  return scheduledNodes;
}

/**
 * Collapse sample-near duplicate arrivals without destroying distinct pitches.
 * Amplitudes combine as signal energy (root-sum-square) and are ceiling-bound.
 */
export function coalesceGraphEvents(events, options = {}) {
  if (!Array.isArray(events) || !events.length) return [];
  const timeResolution = clamp(
    options.timeResolutionSeconds ?? options.timeWindowSeconds ?? options.timeWindow,
    1e-7,
    1,
    1 / 48_000,
  );
  const semitoneResolution = clamp(
    options.semitoneResolution,
    1e-4,
    12,
    0.01,
  );
  const amplitudeCeiling = clamp(options.amplitudeCeiling, 0, 4, 1);
  const maximum = positiveInteger(
    options.maxEvents,
    MAX_GRAPH_EVENT_SCHEDULE,
    MAX_GRAPH_EVENT_SCHEDULE,
  );
  if (maximum === 0) return [];
  const keyForEvent = typeof options.key === "function"
    ? options.key
    : typeof options.keyForEvent === "function"
      ? options.keyForEvent
      : (event) => [
        Math.floor(finite(event?.nodeId, 0)),
        Math.round(finite(event?.cumulativeSemitones, 0) / semitoneResolution),
      ].join(":");
  const ordered = events
    .filter((event) => event && Number.isFinite(Number(event.time)))
    .map((event, index) => ({ event, index }))
    .sort((first, second) => (
      finite(first.event.time) - finite(second.event.time)
      || String(keyForEvent(first.event)).localeCompare(String(keyForEvent(second.event)))
      || first.index - second.index
    ));
  const groups = new Map();
  for (const { event, index } of ordered) {
    const sample = Math.round(finite(event.time) / timeResolution);
    const key = `${sample}|${String(keyForEvent(event, index))}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        representative: event,
        strongestAmplitude: -Infinity,
        energy: 0,
        pathKeys: [],
        arrivalEdgeIds: [],
        previousNodeIds: [],
      };
      groups.set(key, group);
    }
    const amplitude = Math.max(0, finite(event.amplitude, 0));
    group.energy += amplitude * amplitude;
    if (amplitude > group.strongestAmplitude) {
      group.representative = event;
      group.strongestAmplitude = amplitude;
    }
    group.pathKeys.push(event.pathKey ?? `event:${index}`);
    group.arrivalEdgeIds.push(event.arrivalEdgeId ?? null);
    group.previousNodeIds.push(event.previousNodeId ?? null);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group.representative,
      amplitude: Math.min(amplitudeCeiling, Math.sqrt(group.energy)),
      coalescedCount: group.pathKeys.length,
      pathCount: group.pathKeys.length,
      pathKeys: group.pathKeys,
      arrivalEdgeIds: group.arrivalEdgeIds,
      previousNodeIds: group.previousNodeIds,
    }))
    .sort(eventComparison)
    .slice(0, maximum);
}

const quadrant = (value) => Math.min(3, Math.floor(clamp(value) * 4));

function wrappedTurn01(radians) {
  return ((finite(radians) / (Math.PI * 2)) % 1 + 1) % 1;
}

function graphNodeDegree(graph, nodeId) {
  const incoming = Number(graph?.indegree?.[nodeId]);
  const outgoing = Number(graph?.outdegree?.[nodeId]);
  if (Number.isFinite(incoming) && Number.isFinite(outgoing)) {
    return Math.max(0, incoming) + Math.max(0, outgoing);
  }
  return (Array.isArray(graph?.edges) ? graph.edges : []).reduce((degree, edge) => (
    degree + (edge?.from === nodeId ? 1 : 0) + (edge?.to === nodeId ? 1 : 0)
  ), 0);
}

function graphMaximumDegree(graph) {
  const nodeCount = Math.max(0, graph?.nodes?.length ?? 0);
  let maximum = 0;
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    maximum = Math.max(maximum, graphNodeDegree(graph, nodeId));
  }
  return maximum;
}

function routePhase(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(Math.floor(numeric)) % 4;
  const source = String(value ?? "entry");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 4;
  }
  return hash;
}

/** Map graph position, route, depth, or turn data onto the shared 4 x 4 bank. */
export function graphDrumVoiceIndex(event = {}, graph = {}, {
  mode = "node-turn",
  voiceOffset = 0,
} = {}) {
  const nodeCount = Math.max(1, graph?.nodes?.length ?? 1);
  const nodeId = Math.abs(Math.floor(finite(event.nodeId, 0)));
  const node = graph?.nodes?.[nodeId] ?? {};
  let row;
  let column;
  if (mode === "position-grid") {
    row = 3 - quadrant(node.y);
    column = quadrant(node.x);
  } else if (mode === "degree-turn") {
    row = Math.min(3, Math.max(0, Math.floor(graphNodeDegree(graph, nodeId))));
    column = quadrant(
      (clamp(event.localTurn, -Math.PI, Math.PI, 0) + Math.PI) / (Math.PI * 2),
    );
  } else if (mode === "path-phase") {
    row = Math.abs(Math.floor(finite(event.depth, 0))) % 4;
    const identity = event.arrivalEdgeId ?? event.pathKey ?? nodeId;
    column = (routePhase(identity) + positiveInteger(event.feedbackCount, 0)) % 4;
  } else if (mode === "depth-route" || mode === "route-depth") {
    row = quadrant(finite(event.depth) / Math.max(1, nodeCount - 1));
    column = Math.abs(Math.floor(finite(event.arrivalEdgeId, nodeId))) % 4;
  } else if (mode === "feedback-turn") {
    row = Math.min(3, Math.max(0, Math.floor(finite(event.feedbackCount))));
    column = quadrant(wrappedTurn01(event.cumulativeTurn));
  } else {
    row = nodeId % 4;
    column = quadrant(wrappedTurn01(event.cumulativeTurn));
  }
  const offset = Math.floor(finite(voiceOffset, 0));
  return ((row * 4 + column + offset) % 16 + 16) % 16;
}

/** Shape one member of the shared FM drum bank from a graph arrival. */
export function mappedGraphDrumVoice(baseVoice = {}, event = {}, graph = {}, options = {}) {
  const pitchDepth = options.pitchDepth ?? 9;
  const turnPitchAmount = options.turnPitchAmount ?? 0.35;
  const characterDepth = options.characterDepth ?? 0.72;
  const eventCount = options.eventCount ?? 1;
  const node = graph?.nodes?.[event.nodeId] ?? { x: 0.5, y: 0.5 };
  const depth = clamp(
    finite(event.depth) / Math.max(1, (graph?.nodes?.length ?? 2) - 1),
  );
  const turnForce = clamp(Math.abs(finite(event.localTurn)) / Math.PI);
  const character = clamp(characterDepth);
  const feedbackRetention = clamp(
    options.feedbackTone ?? options.feedbackDamping,
    0.1,
    1,
    0.84,
  )
    ** positiveInteger(event.feedbackCount, 0, MAX_GRAPH_FEEDBACK_PASSES);
  const verticalSemitones = (0.5 - clamp(node.y, 0, 1, 0.5))
    * 2
    * clamp(pitchDepth, 0, 24, 9);
  const requestedTurnDepth = Number(options.turnPitchDepth);
  const turnSemitones = Number.isFinite(requestedTurnDepth)
    ? clamp(
      clamp(finite(event.localTurn) / Math.PI, -1, 1, 0) * 0.7
        + clamp(finite(event.cumulativeTurn) / (Math.PI * 2), -1, 1, 0) * 0.3,
      -1,
      1,
      0,
    ) * clamp(requestedTurnDepth, 0, 48, 9)
    : finite(event.cumulativeSemitones) * clamp(turnPitchAmount, 0, 2, 0.35);
  const semitones = verticalSemitones + turnSemitones;
  const baseFrequency = clamp(baseVoice?.frequency, 20, 12_000, 60);
  const baseTone = clamp(baseVoice?.tone, 0, 1, 0.5);
  const baseModIndex = clamp(baseVoice?.modIndex, 0, 20, 3);
  const baseLevel = clamp(baseVoice?.level ?? baseVoice?.gain, 0, 1, 0.7);
  const amplitude = clamp(event.amplitude, 0, 1, 1);
  const headroom = 1 / Math.sqrt(Math.max(1, finite(eventCount, 1)));
  const force = clamp(0.5 + depth * 0.2 + turnForce * 0.3);
  const level = clamp(baseLevel * amplitude * force * headroom);
  const toneCharacter = Math.max(depth, turnForce, 1 - clamp(node.x, 0, 1, 0.5));
  const tone = clamp(
    (baseTone * (1 - character) + toneCharacter * character) * feedbackRetention,
  );
  const modIndex = clamp(
    baseModIndex * (1 - character * 0.35)
      + baseModIndex * (0.55 + turnForce * 0.9 + depth * 0.35) * character,
    0,
    20,
    baseModIndex,
  );
  return {
    ...baseVoice,
    voiceIndex: graphDrumVoiceIndex(event, graph, {
      mode: options.mappingMode ?? options.mode ?? "node-turn",
      voiceOffset: options.voiceOffset,
    }),
    frequency: clamp(baseFrequency * 2 ** (semitones / 12), 20, 12_000, baseFrequency),
    tone,
    modIndex,
    level,
    gain: level,
    attack: clamp(baseVoice?.attack, 0.0005, 2, 0.001),
    decay: clamp(baseVoice?.decay, 0.02, 4, 0.14),
  };
}

const scale = (...degrees) => Object.freeze(degrees);
const MINOR_PENTATONIC_SCALE = scale(0, 3, 5, 7, 10);
const WHOLE_TONE_SCALE = scale(0, 2, 4, 6, 8, 10);
const OCTAVE_SCALE = scale(0);
const JUST_RATIOS = Object.freeze([
  1,
  16 / 15,
  9 / 8,
  6 / 5,
  5 / 4,
  4 / 3,
  45 / 32,
  3 / 2,
  8 / 5,
  5 / 3,
  9 / 5,
  15 / 8,
]);

export const GRAPH_JUST_SEMITONES = Object.freeze(
  JUST_RATIOS.map((ratio) => 12 * Math.log2(ratio)),
);

export const GRAPH_SYNTH_SCALES = Object.freeze({
  chromatic: scale(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
  major: scale(0, 2, 4, 5, 7, 9, 11),
  minor: scale(0, 2, 3, 5, 7, 8, 10),
  dorian: scale(0, 2, 3, 5, 7, 9, 10),
  mixolydian: scale(0, 2, 4, 5, 7, 9, 10),
  pentatonic: scale(0, 2, 4, 7, 9),
  minorPentatonic: MINOR_PENTATONIC_SCALE,
  "minor-pentatonic": MINOR_PENTATONIC_SCALE,
  wholeTone: WHOLE_TONE_SCALE,
  "whole-tone": WHOLE_TONE_SCALE,
  octaves: OCTAVE_SCALE,
});

function graphScaleDegrees(requestedScale) {
  const source = typeof requestedScale === "string"
    ? GRAPH_SYNTH_SCALES[requestedScale]
    : Array.isArray(requestedScale)
      ? requestedScale
      : requestedScale?.degrees;
  const degrees = [...new Set((source ?? GRAPH_SYNTH_SCALES.major)
    .map((degree) => finite(degree, NaN))
    .filter(Number.isFinite)
    .map((degree) => ((degree % 12) + 12) % 12))]
    .sort((first, second) => first - second);
  return degrees.length ? degrees : GRAPH_SYNTH_SCALES.major;
}

/** Quantize a signed interval across octave boundaries to the nearest degree. */
export function quantizeGraphSemitones(semitones, requestedScale = "major", root = 0) {
  const value = finite(semitones, 0);
  const rootSemitones = finite(root, 0);
  const relative = value - rootSemitones;
  const octave = Math.floor(relative / 12);
  const degrees = graphScaleDegrees(requestedScale);
  let closest = octave * 12 + degrees[0];
  let closestDistance = Math.abs(relative - closest);
  for (let candidateOctave = octave - 1; candidateOctave <= octave + 1; candidateOctave += 1) {
    for (const degree of degrees) {
      const candidate = candidateOctave * 12 + degree;
      const distance = Math.abs(relative - candidate);
      if (
        distance < closestDistance - 1e-12
        || (Math.abs(distance - closestDistance) <= 1e-12 && candidate < closest)
      ) {
        closest = candidate;
        closestDistance = distance;
      }
    }
  }
  return closest + rootSemitones;
}

/** Snap an interval to any equal division of the octave (N-EDO). */
export function quantizeGraphEqualDivision(semitones, divisions = 12, root = 0) {
  const value = finite(semitones, 0);
  const rootSemitones = finite(root, 0);
  const divisionCount = Math.max(1, Math.round(clamp(
    divisions,
    1,
    MAX_GRAPH_EQUAL_DIVISIONS,
    12,
  )));
  const step = 12 / divisionCount;
  return rootSemitones + Math.round((value - rootSemitones) / step) * step;
}

/** Snap an interval to a rational just-intonation ratio in any octave. */
export function quantizeGraphJustSemitones(semitones, root = 0) {
  return quantizeGraphSemitones(semitones, GRAPH_JUST_SEMITONES, root);
}

/** Apply the user-facing Pure / N-EDO / Just tuning contract. */
export function tuneGraphSemitones(semitones, {
  mode = "equal",
  divisions = 12,
  root = 0,
} = {}) {
  if (mode === "pure" || mode === "continuous" || mode === "free") {
    return finite(semitones, 0);
  }
  if (mode === "just") return quantizeGraphJustSemitones(semitones, root);
  return quantizeGraphEqualDivision(semitones, divisions, root);
}

const GRAPH_SYNTH_MAPPING_MODES = new Set(["turn", "height", "degree", "progress"]);
const GRAPH_SYNTH_AUDIO_MODES = new Set(["sine", "fm", "pm", "shepard"]);
const GRAPH_SYNTH_WAVEFORMS = new Set(["sine", "triangle", "sawtooth", "square"]);

/** Convert a graph arrival into a bounded, scheduler-ready synth voice. */
export function graphSynthVoice(event = {}, graph = {}, options = {}) {
  const nodeId = Math.max(0, Math.floor(finite(event.nodeId)));
  const node = graph?.nodes?.[nodeId] ?? { x: 0.5, y: 0.5 };
  const mappingMode = GRAPH_SYNTH_MAPPING_MODES.has(options.mappingMode)
    ? options.mappingMode
    : GRAPH_SYNTH_MAPPING_MODES.has(options.mode)
      ? options.mode
      : "turn";
  const rootFrequency = Number.isFinite(Number(options.rootMidiNote))
    ? 440 * 2 ** ((clamp(options.rootMidiNote, 0, 127, 45) - 69) / 12)
    : clamp(options.rootFrequency ?? options.baseFrequency, 20, 20_000, 110);
  const pitchRange = clamp(options.pitchRange, 0, 8, 2);
  const pitchSpanSemitones = pitchRange * 12;
  const halfPitchSpan = pitchSpanSemitones * 0.5;
  const maximumDegree = graphMaximumDegree(graph);
  const nodeDegree = graphNodeDegree(graph, nodeId);
  let mappedSemitones;
  if (mappingMode === "height") {
    mappedSemitones = (0.5 - clamp(node.y, 0, 1, 0.5)) * pitchSpanSemitones;
  } else if (mappingMode === "degree") {
    const degreePosition = maximumDegree > 0 ? nodeDegree / maximumDegree : 0.5;
    mappedSemitones = (degreePosition - 0.5) * pitchSpanSemitones;
  } else if (mappingMode === "progress") {
    mappedSemitones = (clamp(node.x, 0, 1, 0.5) - 0.5) * pitchSpanSemitones;
  } else {
    mappedSemitones = finite(event.cumulativeSemitones);
  }
  const positionPitchDepth = clamp(options.positionPitchDepth, 0, 24, 0);
  const depthPitch = finite(options.depthSemitones, 0) * Math.max(0, finite(event.depth));
  const rawSemitones = finite(options.transpose) + clamp(
    mappedSemitones
      + (0.5 - clamp(node.y, 0, 1, 0.5)) * 2 * positionPitchDepth
      + depthPitch,
    -halfPitchSpan,
    halfPitchSpan,
    0,
  );
  const requestedTuningMode = options.tuningMode ?? options.tuning;
  const tuningMode = ["pure", "continuous", "free", "equal", "just"].includes(
    requestedTuningMode,
  )
    ? requestedTuningMode
    : null;
  const edoDivisions = Math.max(1, Math.round(clamp(
    options.edoDivisions ?? options.divisions,
    1,
    MAX_GRAPH_EQUAL_DIVISIONS,
    12,
  )));
  const semitones = options.quantize === false
    ? rawSemitones
    : tuningMode
      ? tuneGraphSemitones(rawSemitones, {
        mode: tuningMode,
        divisions: edoDivisions,
        root: options.scaleRoot,
      })
      : quantizeGraphSemitones(rawSemitones, options.scale ?? "major", options.scaleRoot);
  const minimumFrequency = clamp(options.minFrequency, 20, 20_000, 20);
  const maximumFrequency = clamp(
    options.maxFrequency,
    minimumFrequency,
    20_000,
    Math.max(minimumFrequency, 16_000),
  );
  const amplitude = clamp(event.amplitude, 0, 1, 1);
  const voiceCount = Math.max(1, finite(options.eventCount ?? options.voiceCount, 1));
  const gain = clamp(
    amplitude * clamp(options.level ?? options.gain, 0, 1, 0.42) / Math.sqrt(voiceCount),
  );
  const spread = clamp(options.stereoSpread ?? options.spread, 0, 1, 0.82);
  const pan = clamp((clamp(node.y, 0, 1, 0.5) - 0.5) * 2 * spread, -1, 1, 0);
  const feedbackCount = positiveInteger(
    event.feedbackCount,
    0,
    MAX_GRAPH_FEEDBACK_PASSES,
  );
  const feedbackDamping = clamp(
    options.feedbackTone ?? options.feedbackDamping,
    0.1,
    1,
    0.86,
  ) ** feedbackCount;
  const geometryBrightness = 0.35 + (1 - clamp(node.x, 0, 1, 0.5)) * 0.65;
  const brightness = clamp(geometryBrightness * feedbackDamping);
  const cutoff = clamp(
    clamp(options.filterFrequency ?? options.cutoff, 80, 20_000, 9_000)
      * (0.3 + brightness * 0.7),
    80,
    20_000,
    6_000,
  );
  const requestedSoundMode = typeof options.soundMode === "string"
    ? options.soundMode
    : typeof options.mode === "string" && !GRAPH_SYNTH_MAPPING_MODES.has(options.mode)
      ? options.mode
      : "sine";
  const mode = GRAPH_SYNTH_AUDIO_MODES.has(requestedSoundMode)
    ? requestedSoundMode
    : "sine";
  const requestedWaveform = typeof options.waveform === "string"
    ? options.waveform
    : requestedSoundMode;
  const waveform = GRAPH_SYNTH_WAVEFORMS.has(requestedWaveform)
    ? requestedWaveform
    : "sine";
  const modulationIndex = clamp(
    options.modulationIndex ?? options.modIndex,
    0,
    20,
    0,
  );
  const modulationRatio = clamp(
    options.modulationRatio ?? options.modRatio,
    0.125,
    16,
    1.5,
  );
  return {
    nodeId,
    time: Math.max(0, finite(event.time)),
    feedbackCount,
    mappingMode,
    pitchRange,
    rawSemitones,
    semitones,
    tuningMode: tuningMode ?? "legacy-scale",
    edoDivisions,
    frequency: clamp(rootFrequency * 2 ** (semitones / 12), minimumFrequency, maximumFrequency),
    gain,
    level: gain,
    pan,
    stereoSpread: spread,
    brightness,
    tone: brightness,
    cutoff,
    mode,
    soundMode: requestedSoundMode,
    waveform,
    modulationIndex,
    modIndex: modulationIndex,
    modulationRatio,
    modRatio: modulationRatio,
    attack: clamp(options.attack, 0.001, 2, 0.008),
    release: clamp(options.release, 0.01, 8, 0.38),
    duration: clamp(options.duration, 0.01, 16, 0.45),
    velocity: Math.round(clamp(gain * 127, 1, 127, 1)),
  };
}

/** Return the interval between root graph pulses; positional arguments are BPM first. */
export function graphPulseIntervalSeconds(tempo = 120, pulseBeats = 1) {
  let bpm = tempo;
  let beats = pulseBeats;
  if (tempo && typeof tempo === "object") {
    bpm = tempo.tempo ?? tempo.tempoBpm ?? 120;
    beats = tempo.pulseBeats ?? tempo.beats ?? 1;
  }
  return clamp(beats, 1 / 16, 16, 1) * 60 / clamp(bpm, 20, 400, 120);
}
