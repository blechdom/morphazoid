const EPSILON = 1e-7;
const MAX_GRAPHS = 192;
const MAX_NODES_PER_GRAPH = 256;
const MAX_EDGES_PER_GRAPH = 1_024;
export const MAX_PROJECTION_BEATS = 4_096;
export const MAX_PROJECTED_EVENTS = 4_096;
export const MAX_PROJECTION_QUEUE = 16_384;
const MAX_PROJECTION_ADMISSIONS = 65_536;
const MAX_EVENT_DEPTH = 192;
const MAX_FLATTENED_INSTANCES = 65_536;
const MAX_FLATTENED_NODES = 65_536;
const MAX_FLATTENED_EDGES = 262_144;

export const SIGNAL_TYPES = Object.freeze(["trigger", "audio", "control"]);

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const freeze = (value) => deepFreeze(value);

export function quantizeBeat(value, division = 0.25) {
  const grid = Math.max(1 / 64, finite(division, 0.25));
  return Math.round(Math.max(0, finite(value, 0)) / grid) * grid;
}

export function formatBeat(value) {
  const beat = Math.max(0, finite(value, 0));
  const whole = Math.floor(beat + EPSILON);
  const fraction = beat - whole;
  const common = [[0, ""], [.125, "⅛"], [.25, "¼"], [1 / 3, "⅓"], [.5, "½"], [2 / 3, "⅔"], [.75, "¾"], [.875, "⅞"]];
  const nearest = common.reduce((best, candidate) => (
    Math.abs(candidate[0] - fraction) < Math.abs(best[0] - fraction) ? candidate : best
  ), common[0]);
  if (Math.abs(nearest[0] - fraction) < 0.012) return `${whole || ""}${nearest[1] || (whole ? "" : "0")}`;
  return beat.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

const port = (id, direction, signal, label = id) => freeze({ id, direction, signal, label });

export const PRIMITIVE_LIBRARY = freeze({
  clock: {
    label: "Clock",
    category: "trigger",
    color: "#e8c46b",
    ports: [port("trigger-out", "out", "trigger", "pulse")],
    generator: { signal: "trigger", steps: [1, 0, 1, 0], stepBeats: 0.25, noteOffsets: [0] },
  },
  euclid: {
    label: "Euclidean pulse",
    category: "trigger",
    color: "#ffad69",
    ports: [port("trigger-out", "out", "trigger", "pulse")],
    generator: { signal: "trigger", steps: [1, 0, 0, 1, 0, 1, 0, 0], stepBeats: 0.5, noteOffsets: [0, 0, 7, 0, 0, 5, 0, 0] },
  },
  chance: {
    label: "Chance gate",
    category: "trigger",
    color: "#ff82c8",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
  },
  divider: {
    label: "Clock divider",
    category: "trigger",
    color: "#efcf75",
    ports: [port("trigger-in", "in", "trigger"), port("trigger-out", "out", "trigger")],
  },
  lfo: {
    label: "LFO",
    category: "control",
    color: "#b299ff",
    ports: [port("control-out", "out", "control", "mod")],
    generator: { signal: "control", steps: [.15, .5, .85, .5], stepBeats: 0.5, noteOffsets: [0] },
  },
  envelope: {
    label: "Envelope",
    category: "control",
    color: "#c79cff",
    ports: [port("trigger-in", "in", "trigger"), port("control-out", "out", "control")],
    converts: { trigger: "control" },
  },
  "drum-voice": {
    label: "Drum voice",
    category: "instrument",
    color: "#ff8f70",
    playable: true,
    instrumentType: "drums",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
    ],
  },
  oscillator: {
    label: "Oscillator",
    category: "instrument",
    color: "#70e3e8",
    playable: true,
    instrumentType: "pitched",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
    ],
  },
  voice: {
    label: "Voice source",
    category: "instrument",
    color: "#ff82c8",
    playable: true,
    instrumentType: "pitched",
    ports: [
      port("trigger-in", "in", "trigger"),
      port("control-in", "in", "control"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
    ],
  },
  gain: {
    label: "Gain",
    category: "routing",
    color: "#8de7ff",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
  },
  filter: {
    label: "Filter",
    category: "effect",
    color: "#a7e879",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
  },
  delay: {
    label: "Delay",
    category: "effect",
    color: "#70d8e7",
    ports: [
      port("audio-in", "in", "audio"),
      port("control-in", "in", "control"),
      port("trigger-in", "in", "trigger"),
      port("audio-out", "out", "audio"),
      port("trigger-out", "out", "trigger"),
    ],
  },
  reverb: {
    label: "Reverb",
    category: "effect",
    color: "#8fd59b",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
  },
  compressor: {
    label: "Compressor",
    category: "effect",
    color: "#ffad69",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
  },
  mixer: {
    label: "Mixer",
    category: "routing",
    color: "#8de7ff",
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control"), port("audio-out", "out", "audio")],
  },
  output: {
    label: "Output",
    category: "routing",
    color: "#c7fcfb",
    output: true,
    ports: [port("audio-in", "in", "audio"), port("control-in", "in", "control")],
  },
});

const graphInterfacePort = (id, direction, signal, nodeId = id, label = id) => freeze({ id, direction, signal, nodeId, label });

function graphPortNode(interfacePort, x, y) {
  return {
    id: interfacePort.nodeId,
    type: "port",
    direction: interfacePort.direction,
    signal: interfacePort.signal,
    label: interfacePort.label,
    x,
    y,
  };
}

function primitiveNode(id, primitiveId, x, y, options = {}) {
  const primitive = PRIMITIVE_LIBRARY[primitiveId] ?? PRIMITIVE_LIBRARY.gain;
  return {
    id,
    type: "primitive",
    primitiveId,
    label: options.label ?? primitive.label,
    x,
    y,
    rootNote: clamp(options.rootNote, 0, 127, 48),
    gateBeats: Math.max(1 / 64, finite(options.gateBeats, 0.35)),
    soundId: options.soundId ?? primitiveId,
    params: { ...(options.params ?? {}) },
    generator: options.generator ? clone(options.generator) : primitive.generator ? clone(primitive.generator) : undefined,
  };
}

function internalEdge(id, fromNodeId, toNodeId, signal, options = {}) {
  return {
    id,
    from: { nodeId: fromNodeId, portId: options.fromPortId ?? `${signal}-out` },
    to: { nodeId: toNodeId, portId: options.toPortId ?? `${signal}-in` },
    signal,
    timing: {
      delayBeats: quantizeBeat(options.delayBeats ?? 0, 1 / 64),
      probability: clamp(options.probability, 0, 1, 1),
    },
    gain: clamp(options.gain, 0, 2, 1),
    feedback: Boolean(options.feedback),
  };
}

function soundGraphTemplate({ id, label, primitiveId = "oscillator", soundId = id, rootNote = 48, tone = "filter" }) {
  const interfacePorts = [
    graphInterfacePort("trigger-in", "in", "trigger", "trigger-in", "trigger"),
    graphInterfacePort("control-in", "in", "control", "control-in", "control"),
    graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio"),
    graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "follow"),
  ];
  return {
    id,
    label,
    kind: "sound",
    description: `${label} is itself a trigger, control, and audio subgraph.`,
    interface: interfacePorts,
    nodes: [
      graphPortNode(interfacePorts[0], .05, .3),
      graphPortNode(interfacePorts[1], .05, .72),
      primitiveNode("voice", primitiveId, .34, .3, { label, soundId, rootNote }),
      primitiveNode("envelope", "envelope", .34, .72, { label: "Amplitude envelope" }),
      primitiveNode("tone", tone, .66, .3, { label: tone === "filter" ? "Tone filter" : "Voice gain", params: { cutoff: 2200, gain: .72 } }),
      graphPortNode(interfacePorts[2], .95, .3),
      graphPortNode(interfacePorts[3], .95, .72),
    ],
    edges: [
      internalEdge("trigger-voice", "trigger-in", "voice", "trigger"),
      internalEdge("trigger-envelope", "trigger-in", "envelope", "trigger"),
      internalEdge("voice-follow", "voice", "trigger-out", "trigger"),
      internalEdge("envelope-control", "envelope", "tone", "control"),
      internalEdge("external-control", "control-in", "tone", "control"),
      internalEdge("voice-tone", "voice", "tone", "audio"),
      internalEdge("tone-output", "tone", "audio-out", "audio"),
    ],
  };
}

function clockGraphTemplate({ id, label, primitiveId = "clock", generator }) {
  const outputPort = graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "pulse");
  return {
    id,
    label,
    kind: "trigger",
    description: `${label} generates timestamped control-flow pulses.`,
    interface: [outputPort],
    nodes: [
      primitiveNode("generator", primitiveId, .34, .5, { label, generator }),
      graphPortNode(outputPort, .94, .5),
    ],
    edges: [internalEdge("pulse-output", "generator", "trigger-out", "trigger")],
  };
}

function controlGraphTemplate({ id, label, primitiveId = "lfo", generator }) {
  const outputPort = graphInterfacePort("control-out", "out", "control", "control-out", "control");
  return {
    id,
    label,
    kind: "control",
    description: `${label} is a control-signal subgraph.`,
    interface: [outputPort],
    nodes: [
      primitiveNode("modulator", primitiveId, .36, .5, { label, generator }),
      graphPortNode(outputPort, .94, .5),
    ],
    edges: [internalEdge("control-output", "modulator", "control-out", "control")],
  };
}

function effectGraphTemplate({ id, label, primitiveId, triggerDelayBeats = 0 }) {
  const interfacePorts = [
    graphInterfacePort("audio-in", "in", "audio", "audio-in", "audio in"),
    graphInterfacePort("control-in", "in", "control", "control-in", "control"),
    graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio out"),
  ];
  const supportsTrigger = primitiveId === "delay";
  if (supportsTrigger) {
    interfacePorts.push(
      graphInterfacePort("trigger-in", "in", "trigger", "trigger-in", "trigger"),
      graphInterfacePort("trigger-out", "out", "trigger", "trigger-out", "echo trigger"),
    );
  }
  const nodes = [
    graphPortNode(interfacePorts[0], .05, .32),
    graphPortNode(interfacePorts[1], .05, .72),
    primitiveNode("effect", primitiveId, .5, .42, { label, params: { delaySeconds: .22, feedback: .36, cutoff: 1800, mix: .5 } }),
    graphPortNode(interfacePorts[2], .95, .32),
  ];
  const edges = [
    internalEdge("audio-effect", "audio-in", "effect", "audio"),
    internalEdge("control-effect", "control-in", "effect", "control"),
    internalEdge("effect-output", "effect", "audio-out", "audio"),
  ];
  if (supportsTrigger) {
    nodes.push(graphPortNode(interfacePorts[3], .05, .9), graphPortNode(interfacePorts[4], .95, .9));
    edges.push(
      internalEdge("trigger-effect", "trigger-in", "effect", "trigger"),
      internalEdge("trigger-echo", "effect", "trigger-out", "trigger", { delayBeats: triggerDelayBeats }),
    );
  }
  return {
    id,
    label,
    kind: "effect",
    description: `${label} is a signal-flow graph with exposed audio and control ports.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function routingGraphTemplate({ id, label, primitiveId = "mixer", output = false }) {
  const inputPort = graphInterfacePort("audio-in", "in", "audio", "audio-in", "audio in");
  const controlPort = graphInterfacePort("control-in", "in", "control", "control-in", "level");
  const outputPort = output ? null : graphInterfacePort("audio-out", "out", "audio", "audio-out", "audio out");
  const interfacePorts = [inputPort, controlPort, ...(outputPort ? [outputPort] : [])];
  const nodes = [
    graphPortNode(inputPort, .05, .35),
    graphPortNode(controlPort, .05, .72),
    primitiveNode("route", primitiveId, .55, .42, { label, params: { gain: .8 } }),
    ...(outputPort ? [graphPortNode(outputPort, .95, .35)] : []),
  ];
  const edges = [
    internalEdge("audio-route", "audio-in", "route", "audio"),
    internalEdge("control-route", "control-in", "route", "control"),
    ...(outputPort ? [internalEdge("route-output", "route", "audio-out", "audio") ] : []),
  ];
  return {
    id,
    label,
    kind: "routing",
    description: output ? "The final signal-flow sink." : `${label} combines audio subgraphs.`,
    interface: interfacePorts,
    nodes,
    edges,
  };
}

function blankGraphTemplate({ id, label }) {
  const interfacePorts = SIGNAL_TYPES.flatMap((signal) => [
    graphInterfacePort(`${signal}-in`, "in", signal, `${signal}-in`, `${signal} in`),
    graphInterfacePort(`${signal}-out`, "out", signal, `${signal}-out`, `${signal} out`),
  ]);
  const nodes = interfacePorts.map((item, index) => graphPortNode(item, item.direction === "in" ? .07 : .93, .2 + (index >> 1) * .3));
  const edges = SIGNAL_TYPES.map((signal) => internalEdge(`${signal}-through`, `${signal}-in`, `${signal}-out`, signal));
  return {
    id,
    label,
    kind: "graph",
    description: "An editable graph with trigger, audio, and control boundaries.",
    interface: interfacePorts,
    nodes,
    edges,
  };
}

export const DEVICE_LIBRARY = freeze([
  { id: "pulse-clock", label: "Pulse Clock", category: "trigger", color: "#e8c46b", imageHref: "assets/instruments/graph-drums.webp", description: "A clock graph whose pulse pattern can be edited from the timeline.", build: "clock" },
  { id: "euclidean-clock", label: "Euclidean Clock", category: "trigger", color: "#ffad69", imageHref: "assets/instruments/l-system-drums.webp", description: "A rotating uneven trigger graph.", build: "euclid" },
  { id: "graph-drums", label: "Graph Drums", category: "sound", color: "#ff8f70", imageHref: "assets/instruments/graph-drums.webp", href: "graph-drums.html", description: "A nested percussion signal graph.", build: "drums" },
  { id: "graph-synth", label: "Graph Synth", category: "sound", color: "#b299ff", imageHref: "assets/instruments/graph-synth.webp", href: "graph-synth.html", description: "Oscillator, envelope, filter, and output as one enterable graph.", build: "synth" },
  { id: "lattice", label: "Lattice Voice", category: "sound", color: "#69d9dc", imageHref: "assets/instruments/lattice.webp", href: "lattice.html", description: "A bright metallic sound graph.", build: "lattice" },
  { id: "spiral", label: "Spiral Voice", category: "sound", color: "#e8c46b", imageHref: "assets/instruments/spiral.webp", href: "spiral.html", description: "A rotating harmonic sound graph.", build: "spiral" },
  { id: "sample-voice", label: "Voice Fragment", category: "sound", color: "#ff82c8", imageHref: "assets/instruments/vocalzoid.webp", href: "vocalzoid.html", description: "A vocal-colored source graph.", build: "voice" },
  { id: "graph-delay", label: "Graph Delay", category: "effect", color: "#70d8e7", imageHref: "assets/instruments/graph-delay.webp", href: "graph-delay.html", description: "Audio delay plus an optional delayed trigger output.", build: "delay" },
  { id: "filter", label: "Filter Graph", category: "effect", color: "#a7e879", imageHref: "assets/instruments/enveloper.webp", description: "A modulatable audio filter graph.", build: "filter" },
  { id: "reverb", label: "Reverb Graph", category: "effect", color: "#8fd59b", imageHref: "assets/instruments/shepard-risset.webp", description: "A diffuse audio-space graph.", build: "reverb" },
  { id: "compressor", label: "Compressor", category: "effect", color: "#ffad69", imageHref: "assets/instruments/fm-drums.webp", description: "A dynamics signal graph.", build: "compressor" },
  { id: "lfo", label: "LFO Graph", category: "control", color: "#b299ff", imageHref: "assets/instruments/moire-organ.webp", description: "A repeating control-flow graph.", build: "lfo" },
  { id: "mixer", label: "Mixer Graph", category: "routing", color: "#8de7ff", imageHref: "assets/instruments/blowhole.webp", description: "A nested audio summing graph.", build: "mixer" },
  { id: "output", label: "Output Graph", category: "routing", color: "#c7fcfb", imageHref: "assets/instruments/enveloper.webp", description: "The final signal-flow destination.", build: "output" },
  { id: "blank-graph", label: "Empty Subgraph", category: "graphs", color: "#d5bcff", imageHref: "assets/instruments/recursive-fm.webp", description: "A graph boundary ready to contain other graphs or primitives.", build: "blank" },
].map((device) => ({ ...device })));

export const INSTRUMENT_LIBRARY = DEVICE_LIBRARY;

const DEVICE_BY_ID = new Map(DEVICE_LIBRARY.map((device) => [device.id, device]));

function buildDeviceGraph(device, graphId, label, options = {}) {
  const generator = options.generator;
  switch (device.build) {
    case "clock": return clockGraphTemplate({ id: graphId, label, primitiveId: "clock", generator });
    case "euclid": return clockGraphTemplate({ id: graphId, label, primitiveId: "euclid", generator });
    case "drums": return soundGraphTemplate({ id: graphId, label, primitiveId: "drum-voice", soundId: options.soundId ?? "drums", rootNote: options.rootNote ?? 48, tone: "gain" });
    case "lattice": return soundGraphTemplate({ id: graphId, label, soundId: options.soundId ?? "lattice bell", rootNote: options.rootNote ?? 60 });
    case "spiral": return soundGraphTemplate({ id: graphId, label, soundId: options.soundId ?? "spiral shepard", rootNote: options.rootNote ?? 64 });
    case "voice": return soundGraphTemplate({ id: graphId, label, primitiveId: "voice", soundId: options.soundId ?? "voice", rootNote: options.rootNote ?? 67 });
    case "delay": return effectGraphTemplate({ id: graphId, label, primitiveId: "delay", triggerDelayBeats: options.triggerDelayBeats ?? .5 });
    case "filter": return effectGraphTemplate({ id: graphId, label, primitiveId: "filter" });
    case "reverb": return effectGraphTemplate({ id: graphId, label, primitiveId: "reverb" });
    case "compressor": return effectGraphTemplate({ id: graphId, label, primitiveId: "compressor" });
    case "lfo": return controlGraphTemplate({ id: graphId, label, primitiveId: "lfo", generator });
    case "mixer": return routingGraphTemplate({ id: graphId, label, primitiveId: "mixer" });
    case "output": return routingGraphTemplate({ id: graphId, label, primitiveId: "output", output: true });
    case "blank": return blankGraphTemplate({ id: graphId, label });
    case "synth":
    default: return soundGraphTemplate({ id: graphId, label, soundId: options.soundId ?? "graph synth", rootNote: options.rootNote ?? 48 });
  }
}

function uniqueId(existing, base) {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function getGraph(patch, graphId = patch?.selectedGraphId ?? patch?.rootGraphId) {
  return Array.isArray(patch?.graphs)
    ? patch.graphs.find((graph) => graph?.id === graphId) ?? null
    : null;
}

export function currentGraph(patch) {
  return getGraph(patch, patch?.selectedGraphId) ?? getGraph(patch, patch?.rootGraphId);
}

export function portsForNode(patch, graph, node) {
  if (!node) return [];
  if (node.type === "subgraph") {
    const graphInterface = getGraph(patch, node.graphId)?.interface;
    return Array.isArray(graphInterface) ? graphInterface : [];
  }
  if (node.type === "primitive") return PRIMITIVE_LIBRARY[node.primitiveId]?.ports ?? [];
  if (node.type === "port") {
    return node.direction === "in"
      ? [port(`${node.signal}-out`, "out", node.signal, node.label)]
      : [port(`${node.signal}-in`, "in", node.signal, node.label)];
  }
  return [];
}

export function graphBreadcrumbs(patch, graphId = patch?.selectedGraphId) {
  const target = getGraph(patch, graphId) ?? getGraph(patch, patch?.rootGraphId);
  if (!target) return [];
  const byId = new Map((patch.graphs ?? []).map((graph) => [graph.id, graph]));
  const parent = new Map();
  for (const graph of patch.graphs ?? []) {
    for (const node of graph.nodes ?? []) {
      if (node.type === "subgraph" && byId.has(node.graphId)) parent.set(node.graphId, { graphId: graph.id, node });
    }
  }
  const result = [];
  let graph = target;
  const seen = new Set();
  while (graph && !seen.has(graph.id)) {
    seen.add(graph.id);
    const relation = parent.get(graph.id);
    result.unshift({ graphId: graph.id, label: relation?.node?.label ?? graph.label, instanceNodeId: relation?.node?.id ?? null });
    graph = relation ? byId.get(relation.graphId) : null;
  }
  return result;
}

export function selectGraph(patch, graphId) {
  const next = clone(patch);
  if (getGraph(next, graphId)) next.selectedGraphId = graphId;
  return next;
}

function addDeviceNodeMutable(patch, graphId, deviceId, options = {}) {
  const graph = getGraph(patch, graphId);
  const device = DEVICE_BY_ID.get(deviceId) ?? DEVICE_BY_ID.get("graph-synth");
  if (!graph || !device) return null;
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  const graphIds = new Set(patch.graphs.map(({ id }) => id));
  const nodeId = uniqueId(nodeIds, options.id ?? device.id);
  const childGraphId = uniqueId(graphIds, options.graphId ?? `${graph.id}-${nodeId}`);
  const label = options.label ?? device.label;
  const childGraph = buildDeviceGraph(device, childGraphId, label, options);
  const node = {
    id: nodeId,
    type: "subgraph",
    graphId: childGraphId,
    deviceId: device.id,
    label,
    x: clamp(options.x, 0, 1, .18 + (graph.nodes.length % 4) * .2),
    y: clamp(options.y, 0, 1, .2 + (Math.floor(graph.nodes.length / 4) % 3) * .3),
    params: { ...(options.params ?? {}) },
  };
  patch.graphs.push(childGraph);
  graph.nodes.push(node);
  return node;
}

export function addDeviceNode(patch, graphId, deviceId, options = {}) {
  const next = clone(patch);
  addDeviceNodeMutable(next, graphId, deviceId, options);
  return next;
}

function endpointPort(patch, graph, nodeId, signal, direction, requestedPortId) {
  const node = (Array.isArray(graph?.nodes) ? graph.nodes : []).find(({ id }) => id === nodeId);
  if (!node) return null;
  const ports = portsForNode(patch, graph, node);
  if (requestedPortId !== undefined) {
    return ports.find((item) => (
      item
      && item.id === requestedPortId
      && item.direction === direction
      && item.signal === signal
    )) ?? null;
  }
  return ports.find((item) => item && item.direction === direction && item.signal === signal) ?? null;
}

function addConnectionMutable(patch, graphId, fromNodeId, toNodeId, signal, options = {}) {
  const graph = getGraph(patch, graphId);
  if (!graph || !SIGNAL_TYPES.includes(signal)) return null;
  const fromPort = endpointPort(patch, graph, fromNodeId, signal, "out", options.fromPortId);
  const toPort = endpointPort(patch, graph, toNodeId, signal, "in", options.toPortId);
  if (!fromPort || !toPort) return null;
  const ids = new Set(graph.edges.map(({ id }) => id));
  const id = uniqueId(ids, options.id ?? `${fromNodeId}-${signal}-${toNodeId}`);
  const edge = {
    id,
    from: { nodeId: fromNodeId, portId: fromPort.id },
    to: { nodeId: toNodeId, portId: toPort.id },
    signal,
    timing: {
      delayBeats: quantizeBeat(options.delayBeats ?? 0, 1 / 64),
      probability: clamp(options.probability, 0, 1, 1),
    },
    gain: clamp(options.gain, 0, 2, 1),
    feedback: signal === "audio" && Boolean(options.feedback),
  };
  if (fromNodeId === toNodeId && signal !== "audio" && edge.timing.delayBeats <= 0) {
    edge.timing.delayBeats = .25;
  }
  graph.edges.push(edge);
  if (signal === "audio" && !edge.feedback && unsafeAudioCycle(patch)) edge.feedback = true;
  return edge;
}

export function addConnection(patch, graphId, fromNodeId, toNodeId, signal, options = {}) {
  const next = clone(patch);
  addConnectionMutable(next, graphId, fromNodeId, toNodeId, signal, options);
  return next;
}

export function removeConnection(patch, graphId, edgeId) {
  const next = clone(patch);
  const graph = getGraph(next, graphId);
  if (graph) graph.edges = graph.edges.filter(({ id }) => id !== edgeId);
  return next;
}

export function updateConnection(patch, graphId, edgeId, patchValue = {}) {
  const next = clone(patch);
  const edge = getGraph(next, graphId)?.edges?.find(({ id }) => id === edgeId);
  if (!edge) return next;
  if (patchValue.delayBeats !== undefined) edge.timing.delayBeats = quantizeBeat(patchValue.delayBeats, 1 / 64);
  if (patchValue.probability !== undefined) edge.timing.probability = clamp(patchValue.probability, 0, 1, edge.timing.probability);
  if (patchValue.gain !== undefined) edge.gain = clamp(patchValue.gain, 0, 2, edge.gain);
  if (patchValue.feedback !== undefined) edge.feedback = Boolean(patchValue.feedback);
  return next;
}

export function updateGraphNode(patch, graphId, nodeId, patchValue = {}) {
  const next = clone(patch);
  const node = getGraph(next, graphId)?.nodes?.find(({ id }) => id === nodeId);
  if (!node) return next;
  if (patchValue.label !== undefined) node.label = String(patchValue.label || node.label);
  if (patchValue.rootNote !== undefined) node.rootNote = clamp(patchValue.rootNote, 0, 127, node.rootNote);
  if (patchValue.gateBeats !== undefined) node.gateBeats = Math.max(1 / 64, quantizeBeat(patchValue.gateBeats, 1 / 64));
  if (patchValue.soundId !== undefined) node.soundId = String(patchValue.soundId || node.soundId);
  if (patchValue.generator) node.generator = { ...(node.generator ?? {}), ...clone(patchValue.generator) };
  if (patchValue.params) node.params = { ...(node.params ?? {}), ...clone(patchValue.params) };
  return next;
}

export function moveGraphNode(patch, graphId, nodeId, x, y) {
  const next = clone(patch);
  const node = getGraph(next, graphId)?.nodes?.find(({ id }) => id === nodeId);
  if (node) {
    node.x = clamp(x, 0, 1, node.x);
    node.y = clamp(y, 0, 1, node.y);
  }
  return next;
}

function nodeAddress(prefix, nodeId) {
  return `${prefix}/${nodeId}`;
}

function portNodePorts(node) {
  return node.direction === "in"
    ? [port(`${node.signal}-out`, "out", node.signal)]
    : [port(`${node.signal}-in`, "in", node.signal)];
}

function flatNodePorts(patch, graph, node) {
  return node.type === "port" ? portNodePorts(node) : portsForNode(patch, graph, node);
}

/** Flatten graph instances while retaining the instance stack needed by every view. */
export function flattenPatch(patch, rootGraphId = patch?.rootGraphId) {
  const root = getGraph(patch, rootGraphId);
  if (!root) return {
    nodes: [], edges: [], nodeByAddress: new Map(), rootGraphId, truncated: false,
  };
  const nodes = [];
  const edges = [];
  const nodeByAddress = new Map();
  const graphStack = new Set();
  let instanceCount = 0;
  let truncated = false;

  const visit = (graph, prefix, instances) => {
    if (!graph || graphStack.has(graph.id)) return;
    if (instanceCount >= MAX_FLATTENED_INSTANCES) {
      truncated = true;
      return;
    }
    instanceCount += 1;
    graphStack.add(graph.id);
    const local = new Map();
    const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph.edges) ? graph.edges : [];
    for (const node of graphNodes.slice(0, MAX_NODES_PER_GRAPH)) {
      if (nodes.length >= MAX_FLATTENED_NODES) {
        truncated = true;
        break;
      }
      if (!node || typeof node !== "object" || !node.id) continue;
      if (node.type === "subgraph") {
        const child = getGraph(patch, node.graphId);
        if (!child) continue;
        const childPrefix = nodeAddress(prefix, node.id);
        const nextInstances = [...instances, {
          parentGraphId: graph.id,
          nodeId: node.id,
          graphId: child.id,
          label: node.label,
          deviceId: node.deviceId,
        }];
        visit(child, childPrefix, nextInstances);
        const childInterface = Array.isArray(child.interface) ? child.interface : [];
        const interfaceById = new Map(childInterface
          .filter((item) => item && typeof item === "object" && item.id)
          .map((item) => [item.id, item]));
        local.set(node.id, {
          node,
          ports: portsForNode(patch, graph, node),
          addressForPort: (portId) => {
            const interfacePort = interfaceById.get(portId);
            return interfacePort ? nodeAddress(childPrefix, interfacePort.nodeId) : null;
          },
        });
        continue;
      }
      const address = nodeAddress(prefix, node.id);
      const primitive = node.type === "primitive" ? PRIMITIVE_LIBRARY[node.primitiveId] : null;
      const flat = {
        address,
        graphId: graph.id,
        graphPath: prefix,
        node,
        primitive,
        instances,
      };
      nodes.push(flat);
      nodeByAddress.set(address, flat);
      local.set(node.id, {
        node,
        ports: flatNodePorts(patch, graph, node),
        addressForPort: () => address,
      });
    }
    for (const edge of graphEdges.slice(0, MAX_EDGES_PER_GRAPH)) {
      if (edges.length >= MAX_FLATTENED_EDGES) {
        truncated = true;
        break;
      }
      if (!edge || typeof edge !== "object" || !SIGNAL_TYPES.includes(edge.signal)) continue;
      const from = local.get(edge.from?.nodeId);
      const to = local.get(edge.to?.nodeId);
      const fromPort = from?.ports?.find((item) => (
        item
        && item.id === edge.from?.portId
        && item.direction === "out"
        && item.signal === edge.signal
      ));
      const toPort = to?.ports?.find((item) => (
        item
        && item.id === edge.to?.portId
        && item.direction === "in"
        && item.signal === edge.signal
      ));
      if (!fromPort || !toPort) continue;
      const sourceAddress = from?.addressForPort(edge.from?.portId);
      const targetAddress = to?.addressForPort(edge.to?.portId);
      if (
        !sourceAddress
        || !targetAddress
        || !nodeByAddress.has(sourceAddress)
        || !nodeByAddress.has(targetAddress)
      ) continue;
      edges.push({
        ...clone(edge),
        graphId: graph.id,
        sourceAddress,
        targetAddress,
      });
    }
    graphStack.delete(graph.id);
  };

  visit(root, root.id, []);
  return { nodes, edges, nodeByAddress, rootGraphId, truncated };
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicUnit(value) {
  return hashString(value) / 0xffffffff;
}

function compareQueued(first, second) {
  return first.beat - second.beat
    || first.sequence - second.sequence
    || String(first.address).localeCompare(String(second.address));
}

function pushQueue(queue, event) {
  queue.push(event);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compareQueued(queue[parent], event) <= 0) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = event;
}

function popQueue(queue) {
  if (!queue.length) return null;
  const first = queue[0];
  const last = queue.pop();
  if (!queue.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= queue.length) break;
    const right = index * 2 + 2;
    const child = right < queue.length && compareQueued(queue[right], queue[left]) < 0 ? right : left;
    if (compareQueued(last, queue[child]) <= 0) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

function generatorEvents(
  flat,
  durationBeats,
  sequenceStart = 0,
  maximum = MAX_PROJECTED_EVENTS,
  maximumScans = MAX_PROJECTION_ADMISSIONS,
) {
  const generator = flat.node.generator ?? flat.primitive?.generator;
  if (!generator) return { events: [], scans: 0, truncated: false };
  const steps = Array.isArray(generator.steps) && generator.steps.length ? generator.steps : [1];
  const stepBeats = Math.max(1 / 64, finite(generator.stepBeats, 1));
  const phaseBeats = finite(generator.phaseBeats, 0);
  const noteOffsets = Array.isArray(generator.noteOffsets) && generator.noteOffsets.length ? generator.noteOffsets : [0];
  const events = [];
  const firstStep = Math.max(0, Math.floor((-phaseBeats) / stepBeats));
  if (!Number.isSafeInteger(firstStep)) return { events, scans: 0, truncated: true };
  const maximumSteps = Math.ceil((durationBeats - phaseBeats) / stepBeats) + steps.length;
  const eventLimit = Math.max(0, Math.floor(finite(maximum, 0)));
  const scanLimit = Math.max(0, Math.floor(finite(maximumScans, 0)));
  let scans = 0;
  let step = firstStep;
  for (; step < maximumSteps && scans < scanLimit && events.length < eventLimit; step += 1) {
    scans += 1;
    const beat = phaseBeats + step * stepBeats;
    if (beat < -EPSILON || beat >= durationBeats - EPSILON) continue;
    const patternIndex = ((step % steps.length) + steps.length) % steps.length;
    const value = finite(steps[patternIndex], 0);
    if (value <= 0) continue;
    events.push({
      address: flat.address,
      beat,
      signal: generator.signal === "control" ? "control" : "trigger",
      value: clamp(value, 0, 1, 1),
      noteOffset: finite(noteOffsets[patternIndex % noteOffsets.length], 0),
      depth: 0,
      sequence: sequenceStart + events.length,
      routeKey: `${flat.address}:generator:${step}`,
      originAddress: flat.address,
      occurrence: step,
      edgePath: [],
      rule: { kind: "generator", graphId: flat.graphId, nodeId: flat.node.id, occurrence: step },
    });
  }
  return { events, scans, truncated: step < maximumSteps };
}

/**
 * Simulate trigger/control flow over a bounded beat horizon. Audio edges are
 * intentionally excluded: they describe the separately compiled signal graph.
 */
export function projectGraphEvents(patch, options = {}) {
  const requestedDurationBeats = Math.max(.25, finite(
    options.durationBeats ?? options.toBeat,
    patch?.cycleBeats ?? 16,
  ));
  const durationBeats = Math.min(MAX_PROJECTION_BEATS, requestedDurationBeats);
  const maximum = Math.max(1, Math.min(MAX_PROJECTED_EVENTS, Math.floor(finite(options.maximum, MAX_PROJECTED_EVENTS))));
  const maximumDepth = Math.max(1, Math.min(MAX_EVENT_DEPTH, Math.floor(finite(options.maximumDepth, MAX_EVENT_DEPTH))));
  const flattened = flattenPatch(patch, patch?.rootGraphId);
  const outgoing = new Map(flattened.nodes.map(({ address }) => [address, []]));
  for (const edge of flattened.edges) {
    if (edge.signal === "audio") continue;
    if (!outgoing.has(edge.sourceAddress)) outgoing.set(edge.sourceAddress, []);
    outgoing.get(edge.sourceAddress).push(edge);
  }
  const queue = [];
  const queueLimit = Math.min(MAX_PROJECTION_QUEUE, Math.max(256, maximum * 4));
  const admissionLimit = Math.min(MAX_PROJECTION_ADMISSIONS, Math.max(1_024, maximum * 16));
  const seedLimit = Math.min(maximum, queueLimit);
  let admitted = 0;
  let generationScans = 0;
  let truncated = flattened.truncated || requestedDurationBeats > durationBeats + EPSILON;
  const enqueue = (event) => {
    if (queue.length >= queueLimit || admitted >= admissionLimit) {
      truncated = true;
      return false;
    }
    pushQueue(queue, event);
    admitted += 1;
    return true;
  };
  let sequence = 0;
  for (const flat of flattened.nodes) {
    const remainingSeeds = seedLimit - queue.length;
    const remainingScans = MAX_PROJECTION_ADMISSIONS - generationScans;
    if (remainingSeeds <= 0 || remainingScans <= 0) {
      truncated = true;
      break;
    }
    const generated = generatorEvents(flat, durationBeats, sequence, remainingSeeds, remainingScans);
    generationScans += generated.scans;
    if (generated.truncated) truncated = true;
    for (const event of generated.events) enqueue(event);
    sequence += generated.events.length + 1;
  }
  const projected = [];
  const seen = new Set();
  while (queue.length && projected.length < maximum) {
    const event = popQueue(queue);
    if (!event || event.beat < -EPSILON || event.beat >= durationBeats - EPSILON || event.depth > maximumDepth) continue;
    const flat = flattened.nodeByAddress.get(event.address);
    if (!flat) continue;
    const visitKey = `${event.routeKey}@${event.address}:${event.signal}:${event.beat.toFixed(6)}:${event.noteOffset}`;
    if (seen.has(visitKey)) continue;
    seen.add(visitKey);
    const primitive = flat.primitive;
    const probability = flat.node.primitiveId === "chance" ? clamp(flat.node.params?.probability, 0, 1, .5) : 1;
    if (probability < 1 && deterministicUnit(`${patch.seed}:${event.routeKey}:node`) > probability) continue;
    const rootNote = clamp(flat.node.rootNote, 0, 127, 48);
    projected.push({
      id: `${event.routeKey}@${event.beat.toFixed(6)}`,
      address: flat.address,
      graphId: flat.graphId,
      graphPath: flat.graphPath,
      nodeId: flat.node.id,
      label: flat.node.label,
      primitiveId: flat.node.primitiveId ?? "port",
      category: primitive?.category ?? "interface",
      color: primitive?.color ?? "#82939a",
      signal: event.signal,
      beat: event.beat,
      value: event.value,
      note: rootNote + event.noteOffset,
      velocity: event.value,
      durationBeats: Math.max(1 / 64, finite(flat.node.gateBeats, .25)),
      playable: Boolean(primitive?.playable && event.signal === "trigger"),
      instrumentType: primitive?.instrumentType ?? "control",
      instrumentId: flat.node.soundId ?? flat.node.primitiveId,
      soundId: flat.node.soundId ?? flat.node.primitiveId,
      instances: clone(flat.instances),
      originAddress: event.originAddress,
      sourceEdgeId: event.sourceEdgeId ?? null,
      sourceGraphId: event.sourceGraphId ?? null,
      occurrence: event.occurrence,
      edgePath: clone(event.edgePath ?? []),
      rule: clone(event.rule),
    });
    const convertedSignal = primitive?.converts?.[event.signal] ?? event.signal;
    let branch = 0;
    for (const edge of outgoing.get(event.address) ?? []) {
      if (queue.length >= queueLimit || admitted >= admissionLimit) {
        truncated = true;
        break;
      }
      if (edge.signal !== convertedSignal) continue;
      const edgeProbability = clamp(edge.timing?.probability, 0, 1, 1);
      if (edgeProbability < 1 && deterministicUnit(`${patch.seed}:${event.routeKey}:${edge.graphId}:${edge.id}`) > edgeProbability) continue;
      const nextBeat = event.beat + Math.max(0, finite(edge.timing?.delayBeats, 0));
      if (nextBeat >= durationBeats - EPSILON) continue;
      enqueue({
        ...event,
        address: edge.targetAddress,
        beat: nextBeat,
        signal: convertedSignal,
        value: clamp(event.value * finite(edge.gain, 1), 0, 1, event.value),
        depth: event.depth + 1,
        sequence: event.sequence + branch + 1,
        routeKey: `${event.routeKey}>${edge.graphId}:${edge.id}`,
        sourceEdgeId: edge.id,
        sourceGraphId: edge.graphId,
        edgePath: [
          ...(event.edgePath ?? []),
          {
            graphId: edge.graphId,
            edgeId: edge.id,
            signal: edge.signal,
            fromNodeId: edge.from?.nodeId ?? null,
            fromPortId: edge.from?.portId ?? null,
            toNodeId: edge.to?.nodeId ?? null,
            toPortId: edge.to?.portId ?? null,
          },
        ],
        rule: { kind: "edge", graphId: edge.graphId, edgeId: edge.id },
      });
      branch += 1;
    }
  }
  projected.sort((first, second) => first.beat - second.beat || String(first.id).localeCompare(String(second.id)));
  return {
    events: projected,
    durationBeats,
    truncated: truncated || queue.length > 0 || projected.length >= maximum,
    flattened,
  };
}

export function projectTimeline(patch, graphId = patch?.selectedGraphId, options = {}) {
  const graph = getGraph(patch, graphId) ?? currentGraph(patch);
  if (!graph) return { graph: null, lanes: [], events: [], durationBeats: 0, truncated: false };
  const projection = projectGraphEvents(patch, { ...options, durationBeats: options.durationBeats ?? patch.cycleBeats });
  const directNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const laneById = new Map();
  const events = [];
  for (const displayNode of graph.nodes) {
    if (displayNode.type === "port") continue;
    const laneId = `${graph.id}:${displayNode.id}`;
    const child = displayNode.type === "subgraph" ? getGraph(patch, displayNode.graphId) : null;
    const primitive = displayNode.type === "primitive" ? PRIMITIVE_LIBRARY[displayNode.primitiveId] : null;
    const device = DEVICE_BY_ID.get(displayNode.deviceId);
    laneById.set(laneId, {
      id: laneId,
      graphId: graph.id,
      nodeId: displayNode.id,
      label: displayNode.label,
      category: child?.kind ?? primitive?.category ?? device?.category ?? "graph",
      color: device?.color ?? primitive?.color ?? "#8de7ff",
      deviceId: displayNode.deviceId ?? displayNode.primitiveId,
      subgraphId: displayNode.graphId ?? null,
    });
  }
  for (const event of projection.events) {
    if (event.category === "interface") continue;
    let displayNode = null;
    if (event.graphId === graph.id) displayNode = directNodeById.get(event.nodeId);
    if (!displayNode) {
      const instance = event.instances.find((item) => item.parentGraphId === graph.id);
      if (instance) displayNode = directNodeById.get(instance.nodeId);
    }
    if (!displayNode || displayNode.type === "port") continue;
    const laneId = `${graph.id}:${displayNode.id}`;
    events.push({ ...event, laneId, displayNodeId: displayNode.id, displayGraphId: graph.id });
  }
  const lanes = [...laneById.values()];
  const laneOrder = new Map(lanes.map((lane, index) => [lane.id, index]));
  events.sort((first, second) => first.beat - second.beat
    || (laneOrder.get(first.laneId) ?? 0) - (laneOrder.get(second.laneId) ?? 0)
    || String(first.id).localeCompare(String(second.id)));
  return {
    graph,
    lanes,
    events,
    durationBeats: projection.durationBeats,
    truncated: projection.truncated,
  };
}

export function moveProjectedEvent(patch, event, requestedBeat) {
  const nextBeat = quantizeBeat(requestedBeat, .25);
  const delta = nextBeat - finite(event?.beat, 0);
  if (!event || Math.abs(delta) < EPSILON) return clone(patch);
  const edgePath = Array.isArray(event.edgePath) ? event.edgePath : [];
  const displayedEdge = event.displayGraphId
    ? [...edgePath].reverse().find((item) => item?.graphId === event.displayGraphId)
    : null;
  const causalEdge = displayedEdge
    ? { kind: "edge", graphId: displayedEdge.graphId, edgeId: displayedEdge.edgeId }
    : event.rule?.kind === "edge"
      ? event.rule
      : null;
  if (causalEdge) {
    const edge = getGraph(patch, causalEdge.graphId)?.edges?.find(({ id }) => id === causalEdge.edgeId);
    return updateConnection(patch, causalEdge.graphId, causalEdge.edgeId, {
      delayBeats: Math.max(0, finite(edge?.timing?.delayBeats, 0) + delta),
    });
  }
  if (event.rule?.kind === "generator") {
    const node = getGraph(patch, event.rule.graphId)?.nodes?.find(({ id }) => id === event.rule.nodeId);
    return updateGraphNode(patch, event.rule.graphId, event.rule.nodeId, {
      generator: { phaseBeats: Math.max(0, finite(node?.generator?.phaseBeats, 0) + delta) },
    });
  }
  return clone(patch);
}

function edgeSetHasCycle(edges, sourceFor, targetFor) {
  const adjacency = new Map();
  const indegree = new Map();
  for (const edge of edges) {
    const source = sourceFor(edge);
    const target = targetFor(edge);
    if (source === undefined || source === null || target === undefined || target === null) continue;
    if (!adjacency.has(source)) adjacency.set(source, []);
    if (!adjacency.has(target)) adjacency.set(target, []);
    if (!indegree.has(source)) indegree.set(source, 0);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
    adjacency.get(source).push(target);
  }
  const ready = [...adjacency.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    visited += 1;
    for (const next of adjacency.get(id) ?? []) {
      const nextIndegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) ready.push(next);
    }
  }
  return visited < adjacency.size;
}

function zeroDelayEventCycle(graph) {
  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => (
    edge
    && edge.signal !== "audio"
    && SIGNAL_TYPES.includes(edge.signal)
    && finite(edge.timing?.delayBeats, 0) <= EPSILON
  ));
  return edgeSetHasCycle(edges, (edge) => edge.from?.nodeId, (edge) => edge.to?.nodeId);
}

function flattenedHasUnsafeAudioCycle(flattened) {
  const directAudioEdges = flattened.edges.filter((edge) => (
    edge.signal === "audio" && edge.feedback !== true
  ));
  return edgeSetHasCycle(
    directAudioEdges,
    (edge) => edge.sourceAddress,
    (edge) => edge.targetAddress,
  );
}

function unsafeAudioCycle(patch) {
  const flattened = flattenPatch(patch, patch?.rootGraphId);
  return flattened.truncated || flattenedHasUnsafeAudioCycle(flattened);
}

function recursiveGraphReference(patch) {
  const graphs = Array.isArray(patch?.graphs) ? patch.graphs : [];
  const adjacency = new Map(graphs
    .filter((graph) => graph && typeof graph.id === "string")
    .map(({ id }) => [id, []]));
  for (const graph of graphs) {
    if (!graph || !Array.isArray(graph.nodes)) continue;
    for (const node of graph.nodes) {
      if (node?.type === "subgraph") adjacency.get(graph.id)?.push(node.graphId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

export function validatePatch(patch) {
  const errors = [];
  if (!patch || typeof patch !== "object") return { valid: false, errors: ["Patch must be an object."] };
  const graphs = Array.isArray(patch.graphs) ? patch.graphs : [];
  if (!Array.isArray(patch.graphs)) errors.push("Patch graphs must be an array.");
  if (!graphs.length) errors.push("Patch needs at least one graph.");
  if (graphs.length > MAX_GRAPHS) errors.push(`Patch exceeds ${MAX_GRAPHS} graphs.`);
  const graphIds = new Set();
  for (const graph of graphs) {
    if (!graph || typeof graph !== "object") {
      errors.push("Every graph must be an object.");
      continue;
    }
    if (typeof graph.id !== "string" || !graph.id || graphIds.has(graph.id)) {
      errors.push(`Duplicate or missing graph id: ${graph.id ?? "(missing)"}.`);
    }
    graphIds.add(graph.id);
  }
  if (!graphIds.has(patch.rootGraphId)) errors.push("Root graph is missing.");
  for (const graph of graphs) {
    if (!graph || typeof graph !== "object") continue;
    const graphLabel = typeof graph.id === "string" && graph.id ? graph.id : "(missing graph)";
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const graphInterface = Array.isArray(graph.interface) ? graph.interface : [];
    if (!Array.isArray(graph.nodes)) errors.push(`${graphLabel} nodes must be an array.`);
    if (!Array.isArray(graph.edges)) errors.push(`${graphLabel} edges must be an array.`);
    if (!Array.isArray(graph.interface)) errors.push(`${graphLabel} interface must be an array.`);
    const nodeIds = new Set();
    const nodeById = new Map();
    if (nodes.length > MAX_NODES_PER_GRAPH) errors.push(`${graphLabel} exceeds ${MAX_NODES_PER_GRAPH} nodes.`);
    if (edges.length > MAX_EDGES_PER_GRAPH) errors.push(`${graphLabel} exceeds ${MAX_EDGES_PER_GRAPH} edges.`);
    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        errors.push(`Every node in ${graphLabel} must be an object.`);
        continue;
      }
      if (typeof node.id !== "string" || !node.id || nodeIds.has(node.id)) {
        errors.push(`Duplicate or missing node id in ${graphLabel}.`);
      }
      nodeIds.add(node.id);
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
      if (!["primitive", "subgraph", "port"].includes(node.type)) {
        errors.push(`Unknown node type on ${graphLabel}/${node.id ?? "(missing)"}.`);
      } else if (node.type === "primitive" && !PRIMITIVE_LIBRARY[node.primitiveId]) {
        errors.push(`Unknown primitive ${node.primitiveId ?? "(missing)"} on ${graphLabel}/${node.id}.`);
      } else if (node.type === "subgraph" && !graphIds.has(node.graphId)) {
        errors.push(`Missing subgraph ${node.graphId} from ${graphLabel}/${node.id}.`);
      } else if (node.type === "port" && (
        !["in", "out"].includes(node.direction)
        || !SIGNAL_TYPES.includes(node.signal)
      )) {
        errors.push(`Invalid boundary port ${graphLabel}/${node.id}.`);
      }
    }

    const interfaceIds = new Set();
    const interfaceNodeIds = new Set();
    for (const interfacePort of graphInterface) {
      if (!interfacePort || typeof interfacePort !== "object") {
        errors.push(`Every interface port in ${graphLabel} must be an object.`);
        continue;
      }
      if (typeof interfacePort.id !== "string" || !interfacePort.id || interfaceIds.has(interfacePort.id)) {
        errors.push(`Duplicate or missing interface id in ${graphLabel}.`);
      }
      interfaceIds.add(interfacePort.id);
      if (interfaceNodeIds.has(interfacePort.nodeId)) {
        errors.push(`Interface node ${interfacePort.nodeId} is exposed more than once in ${graphLabel}.`);
      }
      interfaceNodeIds.add(interfacePort.nodeId);
      const boundaryNode = nodeById.get(interfacePort.nodeId);
      if (
        !["in", "out"].includes(interfacePort.direction)
        || !SIGNAL_TYPES.includes(interfacePort.signal)
        || boundaryNode?.type !== "port"
        || boundaryNode.direction !== interfacePort.direction
        || boundaryNode.signal !== interfacePort.signal
      ) {
        errors.push(`Invalid interface target ${graphLabel}/${interfacePort.id ?? "(missing)"}.`);
      }
    }

    const edgeIds = new Set();
    for (const edge of edges) {
      if (!edge || typeof edge !== "object") {
        errors.push(`Every edge in ${graphLabel} must be an object.`);
        continue;
      }
      const edgeLabel = edge.id ?? "(missing)";
      if (typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)) {
        errors.push(`Duplicate or missing edge id in ${graphLabel}.`);
      }
      edgeIds.add(edge.id);
      const knownSignal = SIGNAL_TYPES.includes(edge.signal);
      if (!knownSignal) errors.push(`Unknown signal type on ${graphLabel}/${edgeLabel}.`);
      if (!nodeIds.has(edge.from?.nodeId) || !nodeIds.has(edge.to?.nodeId)) {
        errors.push(`Dangling edge ${graphLabel}/${edgeLabel}.`);
      }
      const explicitPorts = typeof edge.from?.portId === "string" && typeof edge.to?.portId === "string";
      const fromPort = knownSignal && explicitPorts
        ? endpointPort(patch, graph, edge.from?.nodeId, edge.signal, "out", edge.from.portId)
        : null;
      const toPort = knownSignal && explicitPorts
        ? endpointPort(patch, graph, edge.to?.nodeId, edge.signal, "in", edge.to.portId)
        : null;
      if (knownSignal && (!fromPort || !toPort)) {
        errors.push(`Incompatible ${edge.signal} ports on ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.feedback !== undefined && typeof edge.feedback !== "boolean") {
        errors.push(`Feedback must be boolean on ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.feedback === true && edge.signal !== "audio") {
        errors.push(`Feedback is only supported on audio edges: ${graphLabel}/${edgeLabel}.`);
      }
      if (edge.signal !== "audio" && finite(edge.timing?.delayBeats, -1) < 0) {
        errors.push(`Negative event delay on ${graphLabel}/${edgeLabel}.`);
      }
    }
    if (zeroDelayEventCycle(graph)) errors.push(`Zero-delay trigger/control cycle in ${graphLabel}.`);
  }
  const recursive = recursiveGraphReference(patch);
  if (recursive) errors.push("Subgraph references must not recurse into themselves.");
  if (!errors.length && !recursive) {
    const flattened = flattenPatch(patch, patch.rootGraphId);
    if (flattened.truncated) {
      errors.push("Patch expands beyond the flattened graph limit.");
    } else if (flattenedHasUnsafeAudioCycle(flattened)) {
      errors.push("Unsafe audio cycle without an explicit feedback connection.");
    }
  }
  return { valid: errors.length === 0, errors };
}

function createEmptyPatch({ id, label, description, tempo, cycleBeats, seed }) {
  const rootGraphId = `${id}-patch`;
  return {
    schemaVersion: 2,
    id,
    label,
    description,
    tempo,
    meter: [4, 4],
    cycleBeats,
    seed,
    rootGraphId,
    selectedGraphId: rootGraphId,
    graphs: [{
      id: rootGraphId,
      label: "Patch",
      kind: "patch",
      description,
      interface: [],
      nodes: [],
      edges: [],
    }],
  };
}

const SOURCE_PATTERNS = freeze({
  straight: { signal: "trigger", steps: [1, 0, 0, 0, .9, 0, 0, 0, 1, 0, 0, 0, .82, 0, 0, 0], stepBeats: .25, noteOffsets: [0] },
  broken: { signal: "trigger", steps: [1, 0, .35, 0, 0, .8, 0, .25, 1, 0, 0, .58, 0, 0, .72, 0], stepBeats: .25, noteOffsets: [0, 0, 7, 0, 5, 0, 10, 0] },
  tresillo: { signal: "trigger", steps: [1, 0, 0, 1, 0, 0, 1, 0], stepBeats: .5, noteOffsets: [0, 0, 7, 0, 0, 5, 0, 0] },
  five: { signal: "trigger", steps: [1, 0, 1, 0, 0, 1, 0, 1, 0, 0], stepBeats: .5, noteOffsets: [0, 0, 3, 0, 0, 7, 0, 10, 0, 0] },
  sparse: { signal: "trigger", steps: [1, 0, 0, 0, 0, 0, .6, 0], stepBeats: 1, noteOffsets: [0, 0, 0, 0, 0, 0, 7, 0] },
});

const PATCH_RECIPES = [
  { id: "pulse-cascade", label: "Pulse Cascade", description: "A clock fans into percussion and a nested synth, then both signals pass through independent effects.", tempo: 124, cycleBeats: 16, seed: 11, pattern: "straight", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "compressor", fxB: "graph-delay", voiceDelay: 1, probability: 1 },
  { id: "polyrhythm-mesh", label: "Polyrhythm Mesh", description: "Uneven trigger divisions cross between drum, lattice, filter, and control subgraphs.", tempo: 112, cycleBeats: 20, seed: 23, pattern: "five", source: "euclidean-clock", rhythm: "graph-drums", voice: "lattice", fxA: "filter", fxB: "graph-delay", voiceDelay: 1.5, probability: .82 },
  { id: "feedback-garden", label: "Feedback Garden", description: "Delayed triggers return through a bounded cycle while audio follows a separate feedback-safe route.", tempo: 88, cycleBeats: 16, seed: 37, pattern: "sparse", source: "pulse-clock", rhythm: "lattice", voice: "sample-voice", fxA: "reverb", fxB: "graph-delay", voiceDelay: 2, probability: .72, triggerFeedback: true, audioFeedback: true },
  { id: "clock-division-lab", label: "Clock Division Lab", description: "Fast control-flow branches launch different sounds at independent edge delays.", tempo: 148, cycleBeats: 12, seed: 41, pattern: "broken", source: "pulse-clock", rhythm: "graph-drums", voice: "spiral", fxA: "compressor", fxB: "filter", voiceDelay: .75, probability: .66 },
  { id: "modulation-orchard", label: "Modulation Orchard", description: "A slow LFO graph bends two audio branches while triggers remain rhythmically independent.", tempo: 76, cycleBeats: 16, seed: 59, pattern: "tresillo", source: "euclidean-clock", rhythm: "graph-synth", voice: "sample-voice", fxA: "filter", fxB: "reverb", voiceDelay: 2.5, probability: .9 },
  { id: "dub-circuit", label: "Dub Circuit", description: "Percussion and bass share an echo graph whose audio and trigger feedback remain explicitly distinct.", tempo: 104, cycleBeats: 16, seed: 67, pattern: "broken", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "filter", fxB: "graph-delay", voiceDelay: 1.25, probability: .86, triggerFeedback: true, audioFeedback: true },
  { id: "probability-rain", label: "Probability Rain", description: "Deterministic seeded probability makes a repeatable cloud of trigger arrivals.", tempo: 132, cycleBeats: 16, seed: 79, pattern: "straight", source: "euclidean-clock", rhythm: "lattice", voice: "spiral", fxA: "graph-delay", fxB: "reverb", voiceDelay: .5, probability: .48 },
  { id: "nested-machines", label: "Nested Machines", description: "Graphs contain sound graphs, effect graphs, control graphs, routing graphs, and another editable blank graph.", tempo: 118, cycleBeats: 16, seed: 97, pattern: "tresillo", source: "pulse-clock", rhythm: "graph-drums", voice: "graph-synth", fxA: "compressor", fxB: "graph-delay", voiceDelay: 1, probability: .94, blank: true },
];

function makePatchPreset(recipe) {
  const patch = createEmptyPatch(recipe);
  const graphId = patch.rootGraphId;
  const add = (id, deviceId, x, y, options = {}) => addDeviceNodeMutable(patch, graphId, deviceId, { id, x, y, ...options });
  add("clock", recipe.source, .07, .34, {
    label: recipe.source === "euclidean-clock" ? "Uneven clock" : "Patch clock",
    generator: SOURCE_PATTERNS[recipe.pattern],
  });
  add("rhythm", recipe.rhythm, .32, .2, { label: DEVICE_BY_ID.get(recipe.rhythm)?.label, soundId: recipe.rhythm, rootNote: 48 });
  add("voice", recipe.voice, .32, .66, { label: DEVICE_BY_ID.get(recipe.voice)?.label, soundId: recipe.voice, rootNote: 55 });
  add("effect-a", recipe.fxA, .58, .2, { label: DEVICE_BY_ID.get(recipe.fxA)?.label });
  add("effect-b", recipe.fxB, .58, .66, { label: DEVICE_BY_ID.get(recipe.fxB)?.label, triggerDelayBeats: .75 });
  add("modulator", "lfo", .34, .91, {
    label: "Slow control",
    generator: { signal: "control", steps: [.15, .45, .85, .5], stepBeats: 1 },
  });
  add("mixer", "mixer", .79, .43, { label: "Patch mixer" });
  add("output", "output", .94, .43, { label: "Audio output" });
  if (recipe.blank) add("nested", "blank-graph", .77, .82, { label: "Open subgraph" });

  addConnectionMutable(patch, graphId, "clock", "rhythm", "trigger", { id: "clock-rhythm", delayBeats: 0 });
  addConnectionMutable(patch, graphId, "clock", "voice", "trigger", { id: "clock-voice", delayBeats: recipe.voiceDelay, probability: recipe.probability });
  addConnectionMutable(patch, graphId, "rhythm", "effect-a", "audio", { id: "rhythm-effect" });
  addConnectionMutable(patch, graphId, "effect-a", "mixer", "audio", { id: "effect-a-mix", gain: .88 });
  addConnectionMutable(patch, graphId, "voice", "effect-b", "audio", { id: "voice-effect" });
  addConnectionMutable(patch, graphId, "effect-b", "mixer", "audio", { id: "effect-b-mix", gain: .82 });
  addConnectionMutable(patch, graphId, "modulator", "effect-a", "control", { id: "mod-effect-a", gain: .7 });
  addConnectionMutable(patch, graphId, "modulator", "effect-b", "control", { id: "mod-effect-b", gain: .45 });
  addConnectionMutable(patch, graphId, "mixer", "output", "audio", { id: "mix-output" });
  addConnectionMutable(patch, graphId, "rhythm", "effect-b", "trigger", { id: "rhythm-echo-trigger", delayBeats: .25, probability: .7 });
  if (recipe.triggerFeedback) addConnectionMutable(patch, graphId, "effect-b", "voice", "trigger", { id: "echo-voice-cycle", delayBeats: 2, probability: .54 });
  if (recipe.audioFeedback) addConnectionMutable(patch, graphId, "effect-b", "effect-b", "audio", { id: "effect-feedback", gain: .28, feedback: true });
  return patch;
}

export const PATCH_PRESETS = freeze(PATCH_RECIPES.map(makePatchPreset));
export const COMPOSITION_PRESETS = PATCH_PRESETS;

export function clonePatchPreset(id = PATCH_PRESETS[0]?.id) {
  return clone(PATCH_PRESETS.find((preset) => preset.id === id) ?? PATCH_PRESETS[0]);
}

export const cloneCompositionPreset = clonePatchPreset;

export function createPatch(options = {}) {
  if (typeof options === "string") return clonePatchPreset(options);
  return clonePatchPreset(options.presetId ?? options.id);
}

export const createComposition = createPatch;
