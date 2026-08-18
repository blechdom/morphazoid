import {
  GRAPH_DELAY_PATCHES,
  GRAPH_PRESETS,
  MAX_GRAPH_TURN_ROUTES,
  edgeAudioParameters,
  generateGraph,
  generateGraphWithinTurnBudget,
  graphEdgeSwitchMultipliers,
  graphNodePans,
  graphSinkNodeIds,
  graphTurnRoutings,
  nodeTurnRouting,
} from "./src/graph-delay.js?v=20260726-edge-switches";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";

const $ = (id) => document.getElementById(id);
const EDGE_COLORS = [
  "#fff3d6",
  "#55d9ff",
  "#5fe8c4",
  "#7db4ff",
  "#c79bff",
  "#ff826f",
  "#e8c46b",
];
const MAX_LIVE_TURN_ROUTES = MAX_GRAPH_TURN_ROUTES;
const GRAPH_CROSSFADE_SECONDS = 0.3;
const GRAPH_PITCH_PREROLL_SECONDS = 0.12;
const EDGE_SWITCH_RAMP_SECONDS = 0.025;
const EDGE_SWITCH_HIT_RADIUS = 13;
const NODE_RADIUS = 9;
const NODE_HIT_RADIUS = 23;
const SPEAKER_POSITION = Object.freeze({ x: 0.965, y: 0.5 });
const INITIAL_STATE = Object.freeze({
  graphPatch: "layeredGlass",
  topology: "dag",
  nodeCount: 10,
  density: 0.34,
  seed: 17,
  baseDelay: 62,
  timeScale: 58,
  timeCurve: 0.9,
  nodePass: 1,
  pitchScale: 0.26,
  pitchAsymmetry: 0,
  pitchCurve: 1.35,
  pitchSlew: 165,
  nodeMotionMode: "wiggle",
  nodeMotionSpeed: 0.12,
  nodeMotionAmount: 0.07,
  nodeMotionPhase: 0,
  nodeMoving: false,
  micMotionMode: "circle",
  micMotionSpeed: 0.08,
  micMotionSize: 0.42,
  micMotionPhase: 0.5,
  micMoving: false,
  inputX: 0.08,
  inputY: 0.5,
  feedback: 0.72,
  damping: 4800,
  wet: 1.16,
  dry: 0.2,
  spread: 0.82,
  inputTrim: 0.8,
  level: 0.58,
  mic: false,
  starting: false,
});
const state = { ...INITIAL_STATE };
const GRAPH_CONFIGURATION_KEYS = Object.freeze([
  "graphPatch",
  "topology",
  "nodeCount",
  "density",
  "seed",
  "baseDelay",
  "timeScale",
  "timeCurve",
  "nodePass",
  "pitchScale",
  "pitchAsymmetry",
  "pitchCurve",
  "pitchSlew",
  "feedback",
  "damping",
  "wet",
  "dry",
  "spread",
]);

function graphConfigurationSnapshot() {
  return Object.fromEntries(
    GRAPH_CONFIGURATION_KEYS.map((key) => [key, state[key]]),
  );
}

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let model = generateGraph({ ...state, type: state.topology });
let edgeSwitchStates = new Map(
  model.edges.map((edge) => [`${edge.from}>${edge.to}`, true]),
);
let resetEdgeSwitchesOnNextCommit = false;
let audioContext = null;
let audioGraph = null;
let mediaStream = null;
let microphoneSource = null;
let inputAnalyser = null;
let microphoneStartToken = 0;
let inputWave = new Float32Array(512);
let inputPeak = 0;
let currentLevel = 0;
let lastFrame = performance.now();
let selectedNodeId = 0;
let draggingNodeId = null;
let draggingTerminal = null;
let hoveredEdgeId = null;
let focusedEdgeId = null;
let pitchProcessorReady = false;
let pitchProcessorAttempted = false;
let pitchProcessorContext = null;
let lastMotionFrame = performance.now();
let lastMotionAudioUpdate = -Infinity;
let graphRebuildTimer = null;
let graphTransitionTimer = null;
let graphRebuildQueued = false;
let audioParameterUpdateQueued = false;
let activeDensityLimit = null;
let lastAppliedStructure = {
  topology: state.topology,
  nodeCount: state.nodeCount,
  density: state.density,
  seed: state.seed,
};
let lastAppliedConfiguration = graphConfigurationSnapshot();
const retiringAudioGraphs = new Set();
let micRandomVelocityX = 0.07;
let micRandomVelocityY = -0.04;
let nodeWalkOffsets = [];
let nodeWalkVelocities = [];
const ENVELOPE_HISTORY_CAPACITY = 4_096;
const envelopeTimes = new Float64Array(ENVELOPE_HISTORY_CAPACITY);
const envelopeValues = new Float32Array(ENVELOPE_HISTORY_CAPACITY);
let envelopeHead = 0;
let envelopeLength = 0;
const TAU = Math.PI * 2;

function polygonPosition(sides, phase, radius) {
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + index / sides * TAU;
    return {
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    };
  });
  const progress = ((phase % 1) + 1) % 1 * sides;
  const before = Math.floor(progress) % sides;
  const after = (before + 1) % sides;
  const mix = progress - Math.floor(progress);
  return {
    x: vertices[before].x + (vertices[after].x - vertices[before].x) * mix,
    y: vertices[before].y + (vertices[after].y - vertices[before].y) * mix,
  };
}

function microphonePathPosition(
  mode = state.micMotionMode,
  phase = state.micMotionPhase,
) {
  const angle = phase * TAU;
  const radius = state.micMotionSize;
  if (mode === "ellipse") {
    return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius * 0.52 };
  }
  if (mode === "triangle") return polygonPosition(3, phase, radius);
  if (mode === "square") return polygonPosition(4, phase, radius);
  if (mode === "figure8") {
    return {
      x: 0.5 + Math.sin(angle) * radius,
      y: 0.5 + Math.sin(angle * 2) * radius * 0.52,
    };
  }
  return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
}

function advanceMicrophoneMotion(delta) {
  if (!state.micMoving) return false;
  if (state.micMotionMode === "random") {
    const acceleration = state.micMotionSpeed * 0.9;
    micRandomVelocityX += (Math.random() * 2 - 1) * acceleration * delta;
    micRandomVelocityY += (Math.random() * 2 - 1) * acceleration * delta;
    const damping = Math.exp(-delta * 1.4);
    micRandomVelocityX *= damping;
    micRandomVelocityY *= damping;
    const maximum = 0.08 + state.micMotionSpeed * 0.65;
    const velocity = Math.hypot(micRandomVelocityX, micRandomVelocityY);
    if (velocity > maximum) {
      micRandomVelocityX *= maximum / velocity;
      micRandomVelocityY *= maximum / velocity;
    }
    state.inputX += micRandomVelocityX * delta;
    state.inputY += micRandomVelocityY * delta;
    const minimum = 0.5 - state.micMotionSize;
    const maximumPosition = 0.5 + state.micMotionSize;
    if (state.inputX < minimum || state.inputX > maximumPosition) {
      state.inputX = Math.max(minimum, Math.min(maximumPosition, state.inputX));
      micRandomVelocityX *= -0.92;
    }
    if (state.inputY < minimum || state.inputY > maximumPosition) {
      state.inputY = Math.max(minimum, Math.min(maximumPosition, state.inputY));
      micRandomVelocityY *= -0.92;
    }
    return true;
  }
  state.micMotionPhase = (state.micMotionPhase + state.micMotionSpeed * delta) % 1;
  const position = microphonePathPosition();
  state.inputX = position.x;
  state.inputY = position.y;
  return true;
}

function resetNodeWalkState() {
  nodeWalkOffsets = model.nodes.map(() => ({ x: 0, y: 0 }));
  nodeWalkVelocities = model.nodes.map((node) => {
    const angle = ((node.id * 0.61803398875 + state.seed * 0.071) % 1) * TAU;
    return { x: Math.cos(angle) * 0.025, y: Math.sin(angle) * 0.025 };
  });
}

function geometryModel() {
  if (!state.nodeMoving) return model;
  const amount = state.nodeMotionAmount;
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      let offsetX = 0;
      let offsetY = 0;
      if (state.nodeMotionMode === "random") {
        offsetX = nodeWalkOffsets[node.id]?.x ?? 0;
        offsetY = nodeWalkOffsets[node.id]?.y ?? 0;
      } else {
        const phase = state.nodeMotionPhase * TAU;
        const nodePhase = node.id * 1.713;
        if (state.nodeMotionMode === "orbit") {
          offsetX = Math.cos(phase + nodePhase) * amount;
          offsetY = Math.sin(phase + nodePhase) * amount;
        } else {
          offsetX = Math.sin(phase + nodePhase) * amount;
          offsetY = Math.cos(phase * 0.83 + node.id * 2.137) * amount * 0.68;
        }
      }
      return {
        ...node,
        x: Math.max(0.02, Math.min(0.98, node.x + offsetX)),
        y: Math.max(0.02, Math.min(0.98, node.y + offsetY)),
      };
    }),
  };
}

function advanceNodeMotion(delta) {
  if (!state.nodeMoving) return false;
  if (state.nodeMotionMode !== "random") {
    state.nodeMotionPhase = (state.nodeMotionPhase + state.nodeMotionSpeed * delta) % 1;
    return true;
  }
  if (nodeWalkOffsets.length !== model.nodes.length) resetNodeWalkState();
  const acceleration = 0.12 + state.nodeMotionSpeed * 0.7;
  const maximumVelocity = 0.025 + state.nodeMotionSpeed * 0.24;
  for (const node of model.nodes) {
    const offset = nodeWalkOffsets[node.id];
    const velocity = nodeWalkVelocities[node.id];
    velocity.x += (Math.random() * 2 - 1) * acceleration * delta;
    velocity.y += (Math.random() * 2 - 1) * acceleration * delta;
    const damping = Math.exp(-delta * 1.1);
    velocity.x *= damping;
    velocity.y *= damping;
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed > maximumVelocity) {
      velocity.x *= maximumVelocity / speed;
      velocity.y *= maximumVelocity / speed;
    }
    offset.x += velocity.x * delta;
    offset.y += velocity.y * delta;
    const distance = Math.hypot(offset.x, offset.y);
    if (distance > state.nodeMotionAmount) {
      const normalX = offset.x / distance;
      const normalY = offset.y / distance;
      offset.x = normalX * state.nodeMotionAmount;
      offset.y = normalY * state.nodeMotionAmount;
      const outwardSpeed = velocity.x * normalX + velocity.y * normalY;
      if (outwardSpeed > 0) {
        velocity.x -= normalX * outwardSpeed * 1.8;
        velocity.y -= normalY * outwardSpeed * 1.8;
      }
    }
  }
  return true;
}

function bakeNodeMotion() {
  if (!state.nodeMoving) return;
  const visibleNodes = geometryModel().nodes;
  for (const node of model.nodes) {
    node.x = visibleNodes[node.id].x;
    node.y = visibleNodes[node.id].y;
  }
  state.nodeMoving = false;
  state.nodeMotionPhase = 0;
  resetNodeWalkState();
}

function endpointPosition(kind) {
  return kind === "input"
    ? { x: state.inputX, y: state.inputY }
    : SPEAKER_POSITION;
}

function terminalDelaySeconds(from, to) {
  const normalizedLength = Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / Math.SQRT2);
  const terminalBase = Math.max(4, Math.min(24, state.baseDelay * 0.08));
  const terminalVariation = normalizedLength * Math.min(120, state.timeScale * 0.2);
  return (terminalBase + terminalVariation) / 1_000;
}

function firstAudibleTapSeconds(geometry) {
  const parameters = edgeAudioParameters(geometry, state);
  const arrivals = Array(geometry.nodes.length).fill(Infinity);
  const entries = geometry.entries.length ? geometry.entries : [0];
  for (const nodeId of entries) {
    arrivals[nodeId] = terminalDelaySeconds(
      endpointPosition("input"),
      geometry.nodes[nodeId],
    );
  }
  const visited = new Set();
  while (visited.size < geometry.nodes.length) {
    let current = -1;
    for (const node of geometry.nodes) {
      if (
        !visited.has(node.id)
        && Number.isFinite(arrivals[node.id])
        && (current < 0 || arrivals[node.id] < arrivals[current])
      ) current = node.id;
    }
    if (current < 0) break;
    visited.add(current);
    for (const edge of parameters) {
      if (edge.from !== current || !edgeSwitchEnabled(edge)) continue;
      arrivals[edge.to] = Math.min(
        arrivals[edge.to],
        arrivals[current] + edge.delaySeconds,
      );
    }
  }
  const firstTap = Math.min(
    ...graphSinkNodeIds(geometry)
      .map((nodeId) => arrivals[nodeId])
      .filter(Number.isFinite),
  );
  if (!Number.isFinite(firstTap)) return 0;
  return firstTap + (pitchProcessorReady && state.pitchScale > 0
    ? GRAPH_PITCH_PREROLL_SECONDS
    : 0);
}

function turnRoutingOptions() {
  return {
    inputPosition: endpointPosition("input"),
    pitchScale: state.pitchScale,
    pitchAsymmetry: state.pitchAsymmetry,
    pitchCurve: state.pitchCurve,
  };
}

function turnSemitoneMatrix(routing) {
  const matrix = Array.from(
    { length: routing.sources.length },
    () => Array(routing.outputs.length).fill(0),
  );
  for (const turn of routing.turns) {
    matrix[turn.sourceIndex][turn.outputIndex] = turn.semitones;
  }
  return matrix;
}

function nodeTurnReadout(nodeId, geometry = geometryModel()) {
  const routing = nodeTurnRouting(geometry, nodeId, turnRoutingOptions());
  if (!routing.turns.length) return `node ${nodeId + 1} · no outgoing turn`;
  const ratios = routing.turns.map((turn) => 2 ** (turn.semitones / 12));
  const semitones = routing.turns.map((turn) => turn.semitones);
  const ratioRange = ratios.length === 1
    ? `${ratios[0].toFixed(2)}× Hz`
    : `${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}× Hz`;
  const intervalRange = semitones.length === 1
    ? `${semitones[0] >= 0 ? "+" : ""}${semitones[0].toFixed(1)} st`
    : `${Math.min(...semitones).toFixed(1)}–${Math.max(...semitones).toFixed(1)} st`;
  return `node ${nodeId + 1} · ${routing.turns.length} turns · ${intervalRange} · ${ratioRange}`;
}

async function preparePitchProcessor(audio) {
  if (pitchProcessorContext !== audio) {
    pitchProcessorContext = audio;
    pitchProcessorAttempted = false;
    pitchProcessorReady = false;
  }
  if (pitchProcessorAttempted) return pitchProcessorReady;
  pitchProcessorAttempted = true;
  if (!audio.audioWorklet?.addModule || !globalThis.AudioWorkletNode) return false;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/graph-turn-processor.js?v=20260726-edge-switches", import.meta.url),
    );
    pitchProcessorReady = true;
  } catch {
    pitchProcessorReady = false;
  }
  return pitchProcessorReady;
}

function makeSoftClipCurve(size = 2048) {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    curve[index] = Math.tanh(input * 1.65) / Math.tanh(1.65);
  }
  return curve;
}

function audibleTapGain(count) {
  // Sink taps occur at different times, so a gentle fourth-root normalization
  // keeps branched outputs present without forcing them into the limiter.
  return 0.9 / Math.max(1, count) ** 0.25;
}

function edgeSwitchKey(edge) {
  return `${edge.from}>${edge.to}`;
}

function edgeSwitchEnabled(edge) {
  return edgeSwitchStates.get(edgeSwitchKey(edge)) ?? true;
}

function edgeSwitchEnabledFlags(graph, { forceOpen = false } = {}) {
  return graph.edges.map((edge) => forceOpen || edgeSwitchEnabled(edge));
}

function rampEdgeSwitch(parameter, value, now) {
  if (parameter.cancelAndHoldAtTime) {
    parameter.cancelAndHoldAtTime(now);
  } else {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
  }
  parameter.linearRampToValueAtTime(value, now + EDGE_SWITCH_RAMP_SECONDS);
}

function disposeAudioGraph(target) {
  if (!target) return;
  target.releaseAudioOutput?.();
  if (target.inputTrimNode) {
    try { inputAnalyser?.disconnect(target.inputTrimNode); } catch { /* already disconnected */ }
    try { microphoneSource?.disconnect(target.inputTrimNode); } catch { /* fallback source */ }
  }
  for (const node of target.disconnectables) {
    try { node.disconnect(); } catch { /* already disconnected */ }
    try { node.port?.close?.(); } catch { /* not an AudioWorkletNode */ }
  }
  retiringAudioGraphs.delete(target);
}

function disconnectGraph() {
  disposeAudioGraph(audioGraph);
  audioGraph = null;
  for (const target of [...retiringAudioGraphs]) disposeAudioGraph(target);
}

function buildAudioGraph(audio, options = {}) {
  const ownedNodes = [];
  const own = (node) => {
    ownedNodes.push(node);
    return node;
  };
  try {
    return buildAudioGraphNodes(audio, options, own, ownedNodes);
  } catch (error) {
    for (const node of ownedNodes) {
      try { node.disconnect(); } catch { /* partially connected */ }
      try { node.port?.close?.(); } catch { /* not an AudioWorkletNode */ }
    }
    throw error;
  }
}

function buildAudioGraphNodes(
  audio,
  {
    crossfadeGain = 1,
    geometry = geometryModel(),
  } = {},
  own,
  ownedNodes,
) {
  const turnRouteCount = graphTurnRoutings(geometry, turnRoutingOptions())
    .reduce((count, routing) => count + routing.turns.length, 0);
  if (turnRouteCount > MAX_LIVE_TURN_ROUTES) {
    throw new RangeError(
      `${turnRouteCount} relative-turn routes exceed the live safety limit of ${MAX_LIVE_TURN_ROUTES}`,
    );
  }
  const input = own(audio.createGain());
  const dry = own(audio.createGain());
  const wet = own(audio.createGain());
  const output = own(audio.createGain());
  const crossfade = own(audio.createGain());
  const compressor = own(audio.createDynamicsCompressor());
  const clipper = own(audio.createWaveShaper());
  const parameters = edgeAudioParameters(geometry, state);
  const audibleTaps = graphSinkNodeIds(geometry);
  const audibleTapSet = new Set(audibleTaps);
  const tapGain = audibleTapGain(audibleTaps.length);
  const outputPans = graphNodePans(geometry, audibleTaps, state.spread);
  const switchEnabledFlags = edgeSwitchEnabledFlags(geometry, {
    forceOpen: resetEdgeSwitchesOnNextCommit,
  });
  const switchGains = graphEdgeSwitchMultipliers(geometry, switchEnabledFlags);
  compressor.threshold.value = -10;
  compressor.knee.value = 6;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.18;
  clipper.curve = makeSoftClipCurve();
  clipper.oversample = "2x";
  dry.gain.value = state.dry;
  wet.gain.value = state.wet;
  output.gain.value = state.level;
  crossfade.gain.value = crossfadeGain;

  const nodes = geometry.nodes.map((spec) => {
    const sum = own(audio.createGain());
    const tap = own(audio.createGain());
    const pan = own(audio.createStereoPanner());
    tap.gain.value = audibleTapSet.has(spec.id) ? tapGain : 0;
    pan.pan.value = outputPans[spec.id];
    sum.connect(tap).connect(pan);
    return { sum, tap, pan };
  });

  const edgeNodes = parameters.map((edge, index) => {
    const inputBus = own(audio.createGain());
    const switchGain = own(audio.createGain());
    const delay = own(audio.createDelay(2.2));
    const gain = own(audio.createGain());
    switchGain.gain.value = switchGains[index];
    delay.delayTime.value = edge.delaySeconds;
    gain.gain.value = edge.gain;
    const filter = edge.feedbackEdge ? own(audio.createBiquadFilter()) : null;
    if (filter) {
      filter.type = "lowpass";
      filter.frequency.value = state.damping;
      filter.Q.value = 0.45;
      inputBus.connect(switchGain).connect(delay).connect(gain).connect(filter).connect(nodes[edge.to].sum);
    } else {
      inputBus.connect(switchGain).connect(delay).connect(gain).connect(nodes[edge.to].sum);
    }
    return {
      ...edge,
      switchEnabled: switchEnabledFlags[index],
      inputBus,
      switchGain,
      delay,
      gain,
      filter,
      outputNode: filter ?? gain,
    };
  });

  const entries = geometry.entries.length ? geometry.entries : [0];
  const inputRoutes = entries.map((nodeId) => {
    const delay = own(audio.createDelay(2.2));
    const gain = own(audio.createGain());
    delay.delayTime.value = terminalDelaySeconds(endpointPosition("input"), geometry.nodes[nodeId]);
    gain.gain.value = 1 / Math.sqrt(entries.length);
    input.connect(delay).connect(gain).connect(nodes[nodeId].sum);
    return { nodeId, delay, gain };
  });
  const inputRouteByNode = new Map(inputRoutes.map((route) => [route.nodeId, route]));
  const turnRouters = geometry.nodes.map((spec) => {
    const routing = nodeTurnRouting(geometry, spec.id, turnRoutingOptions());
    if (!routing.outputs.length || !routing.sources.length) {
      return { nodeId: spec.id, routing, node: null, fallbackGains: [] };
    }
    const sourceNode = (source) => (
      source.kind === "input"
        ? inputRouteByNode.get(spec.id)?.gain
        : edgeNodes[source.edgeId]?.outputNode
    );
    if (!pitchProcessorReady) {
      const fallbackGains = routing.turns.map((turn) => {
        const gain = own(audio.createGain());
        gain.gain.value = 1;
        sourceNode(routing.sources[turn.sourceIndex])
          ?.connect(gain)
          .connect(edgeNodes[turn.nextEdgeId].inputBus);
        return gain;
      });
      return { nodeId: spec.id, routing, node: null, fallbackGains };
    }
    const node = own(new AudioWorkletNode(audio, "morphazoid-graph-turns", {
      numberOfInputs: routing.sources.length,
      numberOfOutputs: routing.outputs.length,
      outputChannelCount: Array(routing.outputs.length).fill(1),
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: {
        sourceCount: routing.sources.length,
        outputCount: routing.outputs.length,
        phaseSeed: spec.id,
      },
    }));
    routing.sources.forEach((source, sourceIndex) => {
      sourceNode(source)?.connect(node, 0, sourceIndex);
    });
    routing.outputs.forEach((route, outputIndex) => {
      node.connect(edgeNodes[route.edgeId].inputBus, outputIndex, 0);
    });
    node.port.postMessage({
      type: "turns",
      semitones: turnSemitoneMatrix(routing),
      smoothingMs: state.pitchSlew,
    });
    return { nodeId: spec.id, routing, node, fallbackGains: [] };
  });
  const tapRoutes = audibleTaps.map((nodeId) => {
    nodes[nodeId].pan.connect(wet);
    return { nodeId };
  });
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  output.connect(crossfade).connect(compressor).connect(clipper);
  const releaseAudioOutput = connectAudioOutput(audio, clipper, { runtime: globalThis });

  return {
    input,
    dry,
    wet,
    output,
    crossfade,
    nodes,
    edges: edgeNodes,
    turnRouters,
    inputRoutes,
    tapRoutes,
    turnRouteCount,
    geometry,
    disconnectables: ownedNodes,
    releaseAudioOutput,
  };
}

function applyAudioParameters() {
  // Preset changes are transactional: do not retune the previous live graph
  // while its replacement is still waiting to be built.
  if (
    graphRebuildTimer !== null
    || graphRebuildQueued
    || graphTransitionTimer !== null
  ) {
    audioParameterUpdateQueued = true;
    return;
  }
  audioParameterUpdateQueued = false;
  if (!audioGraph || !audioContext) {
    lastAppliedConfiguration = graphConfigurationSnapshot();
    return;
  }
  const now = audioContext.currentTime;
  const geometry = geometryModel();
  const parameters = edgeAudioParameters(geometry, state);
  const audibleTaps = graphSinkNodeIds(geometry);
  const audibleTapSet = new Set(audibleTaps);
  const tapGain = audibleTapGain(audibleTaps.length);
  const outputPans = graphNodePans(geometry, audibleTaps, state.spread);
  const switchEnabledFlags = edgeSwitchEnabledFlags(geometry);
  const switchGains = graphEdgeSwitchMultipliers(geometry, switchEnabledFlags);
  if (
    parameters.length !== audioGraph.edges.length
    || geometry.nodes.length !== audioGraph.nodes.length
  ) {
    scheduleGraphRebuild();
    return;
  }
  audioGraph.dry.gain.setTargetAtTime(state.dry, now, 0.02);
  audioGraph.wet.gain.setTargetAtTime(state.wet, now, 0.02);
  audioGraph.output.gain.setTargetAtTime(state.level, now, 0.02);
  audioGraph.inputTrimNode?.gain.setTargetAtTime(state.inputTrim, now, 0.02);
  for (let index = 0; index < audioGraph.edges.length; index += 1) {
    audioGraph.edges[index].delay.delayTime.setTargetAtTime(parameters[index].delaySeconds, now, 0.03);
    audioGraph.edges[index].gain.gain.setTargetAtTime(parameters[index].gain, now, 0.03);
    audioGraph.edges[index].switchEnabled = switchEnabledFlags[index];
    rampEdgeSwitch(audioGraph.edges[index].switchGain.gain, switchGains[index], now);
    audioGraph.edges[index].filter?.frequency.setTargetAtTime(state.damping, now, 0.03);
  }
  audioGraph.geometry = geometry;
  for (let index = 0; index < audioGraph.nodes.length; index += 1) {
    audioGraph.nodes[index].tap.gain.setTargetAtTime(
      audibleTapSet.has(index) ? tapGain : 0,
      now,
      0.03,
    );
    audioGraph.nodes[index].pan.pan.setTargetAtTime(outputPans[index], now, 0.03);
  }
  for (const router of audioGraph.turnRouters) {
    if (!router.node) continue;
    const routing = nodeTurnRouting(geometry, router.nodeId, turnRoutingOptions());
    router.node.port.postMessage({
      type: "turns",
      semitones: turnSemitoneMatrix(routing),
      smoothingMs: state.pitchSlew,
    });
  }
  for (const route of audioGraph.inputRoutes) {
    route.delay.delayTime.setTargetAtTime(
      terminalDelaySeconds(endpointPosition("input"), geometry.nodes[route.nodeId]),
      now,
      0.035,
    );
  }
  lastAppliedConfiguration = graphConfigurationSnapshot();
}

function rampAudioGraphSwitches(target, now) {
  const multipliers = graphEdgeSwitchMultipliers(
    target.geometry,
    target.edges.map((edge) => edge.switchEnabled),
  );
  target.edges.forEach((edge, index) => {
    rampEdgeSwitch(edge.switchGain.gain, multipliers[index], now);
  });
}

function applyEdgeSwitchByKey(key, enabled) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (const target of [audioGraph, ...retiringAudioGraphs]) {
    if (!target) continue;
    const matchingEdge = target.edges.find((edge) => edgeSwitchKey(edge) === key);
    if (matchingEdge) {
      matchingEdge.switchEnabled = Boolean(enabled);
      rampAudioGraphSwitches(target, now);
    }
  }
}

function setEdgeSwitch(edgeId, enabled) {
  const edge = model.edges[edgeId];
  if (!edge) return;
  const key = edgeSwitchKey(edge);
  edgeSwitchStates.set(key, Boolean(enabled));
  applyEdgeSwitchByKey(key, enabled);
  updateUi();
  $("liveStatus").textContent = enabled
    ? `Connection ${edge.from + 1} → ${edge.to + 1} opened.`
    : `Connection ${edge.from + 1} → ${edge.to + 1} closed; its delay tail is draining.`;
}

function openAllEdgeSwitches() {
  edgeSwitchStates = new Map(
    model.edges.map((edge) => [edgeSwitchKey(edge), true]),
  );
  if (audioContext) {
    const now = audioContext.currentTime;
    const activeKeys = new Set(model.edges.map(edgeSwitchKey));
    for (const target of [audioGraph, ...retiringAudioGraphs]) {
      if (!target) continue;
      let changed = false;
      for (const edge of target.edges) {
        if (!activeKeys.has(edgeSwitchKey(edge))) continue;
        edge.switchEnabled = true;
        changed = true;
      }
      if (changed) rampAudioGraphSwitches(target, now);
    }
  }
  updateUi();
  $("liveStatus").textContent = "Every graph connection opened.";
}

function resetEdgeSwitchesForNextGraph() {
  resetEdgeSwitchesOnNextCommit = true;
}

function connectMicrophoneToGraph(target = audioGraph) {
  if (!microphoneSource || !target || !audioContext) return;
  const trim = audioContext.createGain();
  trim.gain.value = state.inputTrim;
  target.disconnectables.push(trim);
  (inputAnalyser ?? microphoneSource).connect(trim).connect(target.input);
  target.inputTrimNode = trim;
}

function requestedStructure() {
  return {
    topology: state.topology,
    nodeCount: state.nodeCount,
    density: state.density,
    seed: state.seed,
  };
}

function commitModel(candidate, structure, densityLimit = null) {
  edgeSwitchStates = new Map(
    candidate.edges.map((edge) => [
      edgeSwitchKey(edge),
      resetEdgeSwitchesOnNextCommit
        ? true
        : edgeSwitchStates.get(edgeSwitchKey(edge)) ?? true,
    ]),
  );
  resetEdgeSwitchesOnNextCommit = false;
  model = candidate;
  activeDensityLimit = densityLimit;
  lastAppliedStructure = { ...structure };
  state.nodeMotionPhase = 0;
  resetNodeWalkState();
  selectedNodeId = Math.min(selectedNodeId, model.nodes.length - 1);
  focusedEdgeId = null;
  hoveredEdgeId = null;
  canvas.classList.remove("is-switch-hover");
}

function announceGraphUpdate(densityLimit) {
  if (densityLimit) {
    $("liveStatus").textContent = `Connection density automatically limited from ${percent(densityLimit.requested)} to ${percent(densityLimit.applied)} so the graph stays live.`;
    return;
  }
  if (GRAPH_DELAY_PATCHES[state.graphPatch]) {
    $("liveStatus").textContent = `${GRAPH_DELAY_PATCHES[state.graphPatch].label} graph-delay preset loaded.`;
  }
}

function graphRoutingSignature(graph) {
  return [
    graph.type,
    graph.nodes.length,
    graph.edges.map((edge) => `${edge.from}>${edge.to}:${edge.cyclic ? 1 : 0}`).join(","),
  ].join("|");
}

function rebuildModel({ rebuildAudio = true } = {}) {
  const safeResult = generateGraphWithinTurnBudget(
    { ...state, type: state.topology },
    MAX_LIVE_TURN_ROUTES,
  );
  const candidate = safeResult.graph;
  const densityLimit = safeResult.limited
    ? { requested: safeResult.requestedDensity, applied: safeResult.density }
    : null;
  if (densityLimit) {
    state.density = safeResult.density;
    state.graphPatch = "custom";
  }
  const structure = requestedStructure();
  if (graphRoutingSignature(candidate) === graphRoutingSignature(model)) {
    commitModel(candidate, structure, densityLimit);
    applyAudioParameters();
    updateUi();
    announceGraphUpdate(densityLimit);
    return true;
  }
  if (!rebuildAudio || !audioContext || !audioGraph) {
    commitModel(candidate, structure, densityLimit);
    lastAppliedConfiguration = graphConfigurationSnapshot();
    updateUi();
    announceGraphUpdate(densityLimit);
    return true;
  }

  // Transitions are serialized, so every retiring graph is silent by the time
  // a queued structural update reaches this point.
  for (const retiring of [...retiringAudioGraphs]) disposeAudioGraph(retiring);

  const previousGraph = audioGraph;
  let nextGraph = null;
  try {
    nextGraph = buildAudioGraph(audioContext, {
      crossfadeGain: 0,
      geometry: candidate,
    });
    if (microphoneSource) connectMicrophoneToGraph(nextGraph);
  } catch (error) {
    disposeAudioGraph(nextGraph);
    resetEdgeSwitchesOnNextCommit = false;
    Object.assign(state, lastAppliedConfiguration);
    audioParameterUpdateQueued = false;
    const message = error instanceof Error
      ? `Graph update failed: ${error.message}. The previous graph is still playing.`
      : "Graph update failed; the previous graph is still playing.";
    $("audioError").textContent = message;
    $("audioError").hidden = false;
    updateUi();
    $("topologySummary").textContent = "Update failed · previous graph still live";
    $("liveStatus").textContent = message;
    return false;
  }

  commitModel(candidate, structure, densityLimit);
  audioGraph = nextGraph;
  lastAppliedConfiguration = graphConfigurationSnapshot();
  $("audioError").hidden = true;
  const transitionContext = audioContext;
  const now = audioContext.currentTime;
  const preRoll = firstAudibleTapSeconds(candidate);
  const fadeStart = now + preRoll;
  const fadeEnd = fadeStart + GRAPH_CROSSFADE_SECONDS;
  if (previousGraph.crossfade.gain.cancelAndHoldAtTime) {
    previousGraph.crossfade.gain.cancelAndHoldAtTime(now);
  } else {
    previousGraph.crossfade.gain.cancelScheduledValues(now);
    previousGraph.crossfade.gain.setValueAtTime(previousGraph.crossfade.gain.value, now);
  }
  previousGraph.crossfade.gain.setValueAtTime(previousGraph.crossfade.gain.value, fadeStart);
  previousGraph.crossfade.gain.linearRampToValueAtTime(0, fadeEnd);
  nextGraph.crossfade.gain.cancelScheduledValues(now);
  nextGraph.crossfade.gain.setValueAtTime(0, now);
  nextGraph.crossfade.gain.setValueAtTime(0, fadeStart);
  nextGraph.crossfade.gain.linearRampToValueAtTime(1, fadeEnd);
  retiringAudioGraphs.add(previousGraph);
  if (graphTransitionTimer !== null) clearTimeout(graphTransitionTimer);
  const finishTransition = () => {
    if (
      audioContext === transitionContext
      && audioContext.state !== "closed"
      && audioGraph === nextGraph
    ) {
      const remaining = fadeEnd - audioContext.currentTime;
      if (remaining > 0.005) {
        graphTransitionTimer = setTimeout(
          finishTransition,
          Math.max(16, Math.ceil(remaining * 1_000) + 8),
        );
        return;
      }
      const settledAt = audioContext.currentTime;
      previousGraph.crossfade.gain.cancelScheduledValues(settledAt);
      previousGraph.crossfade.gain.setValueAtTime(0, settledAt);
      nextGraph.crossfade.gain.cancelScheduledValues(settledAt);
      nextGraph.crossfade.gain.setValueAtTime(1, settledAt);
    }
    disposeAudioGraph(previousGraph);
    graphTransitionTimer = null;
    if (graphRebuildQueued) {
      graphRebuildQueued = false;
      audioParameterUpdateQueued = false;
      rebuildModel();
    } else {
      if (audioParameterUpdateQueued) {
        audioParameterUpdateQueued = false;
        applyAudioParameters();
      }
      updateUi();
    }
  };
  graphTransitionTimer = setTimeout(
    finishTransition,
    Math.ceil((preRoll + GRAPH_CROSSFADE_SECONDS) * 1_000) + 16,
  );
  updateUi();
  announceGraphUpdate(densityLimit);
  return true;
}

function scheduleGraphRebuild(delay = 140) {
  if (graphRebuildTimer !== null) clearTimeout(graphRebuildTimer);
  if (graphTransitionTimer !== null) {
    graphRebuildTimer = null;
    graphRebuildQueued = true;
    return;
  }
  graphRebuildTimer = setTimeout(() => {
    graphRebuildTimer = null;
    if (graphTransitionTimer !== null) {
      graphRebuildQueued = true;
      updateUi();
      return;
    }
    rebuildModel();
  }, delay);
}

function flushGraphRebuild() {
  const hadPendingRebuild = graphRebuildTimer !== null || graphRebuildQueued;
  if (graphRebuildTimer !== null) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
  if (graphTransitionTimer !== null) {
    graphRebuildQueued = hadPendingRebuild;
    updateUi();
    return;
  }
  if (!hadPendingRebuild) return;
  graphRebuildQueued = false;
  rebuildModel();
}

function cancelScheduledGraphRebuild() {
  if (graphRebuildTimer !== null) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
  graphRebuildQueued = false;
  audioParameterUpdateQueued = false;
}

async function startMicrophone() {
  if (state.starting || state.mic) return;
  const startToken = ++microphoneStartToken;
  state.starting = true;
  updateUi();
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone input requires a secure browser context.");
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass({ latencyHint: "interactive" });
    unlockAudioContext(audioContext);
    await audioContext.resume();
    await preparePitchProcessor(audioContext);
    if (!audioGraph) audioGraph = buildAudioGraph(audioContext);
    const requestedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    });
    if (
      startToken !== microphoneStartToken
      || !audioContext
      || audioContext.state === "closed"
    ) {
      for (const track of requestedStream.getTracks?.() ?? []) track.stop();
      return;
    }
    mediaStream = requestedStream;
    microphoneSource = audioContext.createMediaStreamSource(mediaStream);
    inputAnalyser = audioContext.createAnalyser();
    inputAnalyser.fftSize = 1024;
    microphoneSource.connect(inputAnalyser);
    connectMicrophoneToGraph();
    state.mic = true;
    $("audioError").hidden = true;
    $("liveStatus").textContent = `${GRAPH_PRESETS[state.topology].label} microphone delay started. ${pitchProcessorReady ? "Pitch processing active." : "Pitch processing unavailable; time processing remains active."}`;
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "Microphone could not be started.";
    $("audioError").hidden = false;
  } finally {
    if (startToken === microphoneStartToken) {
      state.starting = false;
      updateUi();
    }
  }
}

function panic(message = "Panic stop. Microphone and every graph feedback tail are off.") {
  microphoneStartToken += 1;
  cancelScheduledGraphRebuild();
  if (graphTransitionTimer !== null) clearTimeout(graphTransitionTimer);
  graphTransitionTimer = null;
  audioParameterUpdateQueued = false;
  try { microphoneSource?.disconnect(); } catch { /* already disconnected */ }
  try { inputAnalyser?.disconnect(); } catch { /* already disconnected */ }
  for (const track of mediaStream?.getTracks?.() ?? []) track.stop();
  mediaStream = null;
  microphoneSource = null;
  inputAnalyser = null;
  disconnectGraph();
  if (audioContext && audioContext.state !== "closed") void audioContext.close();
  audioContext = null;
  pitchProcessorContext = null;
  pitchProcessorAttempted = false;
  pitchProcessorReady = false;
  state.mic = false;
  state.starting = false;
  currentLevel = 0;
  $("liveStatus").textContent = message;
  updateUi();
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function point(node) {
  return {
    x: 56 + node.x * Math.max(1, cssWidth - 102),
    y: 34 + node.y * Math.max(1, cssHeight - 68),
  };
}

function recordEnvelope(time, value) {
  if (envelopeLength === ENVELOPE_HISTORY_CAPACITY) {
    envelopeHead = (envelopeHead + 1) % ENVELOPE_HISTORY_CAPACITY;
    envelopeLength -= 1;
  }
  const index = (envelopeHead + envelopeLength) % ENVELOPE_HISTORY_CAPACITY;
  envelopeTimes[index] = time;
  envelopeValues[index] = value;
  envelopeLength += 1;
}

function envelopeAt(time) {
  if (!envelopeLength) return 0;
  const indexAt = (index) => (envelopeHead + index) % ENVELOPE_HISTORY_CAPACITY;
  if (time <= envelopeTimes[indexAt(0)]) return 0;
  if (time >= envelopeTimes[indexAt(envelopeLength - 1)]) {
    return envelopeValues[indexAt(envelopeLength - 1)];
  }
  let low = 0;
  let high = envelopeLength - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (envelopeTimes[indexAt(middle)] <= time) low = middle;
    else high = middle;
  }
  const before = indexAt(low);
  const after = indexAt(high);
  const mix = (time - envelopeTimes[before])
    / Math.max(1e-6, envelopeTimes[after] - envelopeTimes[before]);
  return envelopeValues[before] + (envelopeValues[after] - envelopeValues[before]) * mix;
}

function visualArrivalTimes(geometry, edgeParameters) {
  const arrivals = Array(geometry.nodes.length).fill(Infinity);
  const entries = geometry.entries.length ? geometry.entries : [0];
  for (const nodeId of entries) arrivals[nodeId] = 0;
  const visited = new Set();
  while (visited.size < geometry.nodes.length) {
    let current = -1;
    let earliest = Infinity;
    for (const node of geometry.nodes) {
      if (!visited.has(node.id) && arrivals[node.id] < earliest) {
        current = node.id;
        earliest = arrivals[node.id];
      }
    }
    if (current < 0) break;
    visited.add(current);
    for (const edge of edgeParameters) {
      if (edge.from !== current || !edgeSwitchEnabled(edge)) continue;
      arrivals[edge.to] = Math.min(arrivals[edge.to], earliest + edge.delaySeconds);
    }
  }
  return arrivals;
}

function drawVibratingEdge(
  from,
  to,
  edge,
  timestamp,
  startDelay = 0,
  enabled = true,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const start = { x: from.x + ux * 12, y: from.y + uy * 12 };
  const end = { x: to.x - ux * 15, y: to.y - uy * 15 };
  const normalX = -uy;
  const normalY = ux;
  const startColor = EDGE_COLORS[edge.from % EDGE_COLORS.length];
  const endColor = EDGE_COLORS[edge.to % EDGE_COLORS.length];
  const edgeGradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  edgeGradient.addColorStop(0, startColor);
  edgeGradient.addColorStop(1, endColor);
  const steps = Math.max(6, Math.min(20, Math.ceil(distance / 18)));
  const maximumOffset = Math.max(1.5, Math.min(8, distance * 0.055));
  const now = timestamp / 1_000;
  const points = [];
  let peakEnergy = 0;

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const travelDelay = startDelay + edge.delaySeconds * progress;
    const energy = state.mic && enabled
      ? Math.min(1, envelopeAt(now - travelDelay) * 9)
      : 0;
    const carrier = Math.sin(
      timestamp * 0.011
      + progress * Math.PI * (4 + edge.id % 5)
      + edge.id * 0.73,
    );
    const offset = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      ? 0
      : Math.sin(Math.PI * progress) * energy * maximumOffset * carrier;
    peakEnergy = Math.max(peakEnergy, energy);
    points.push({
      x: start.x + (end.x - start.x) * progress + normalX * offset,
      y: start.y + (end.y - start.y) * progress + normalY * offset,
      energy,
    });
  }

  const tracePath = () => {
    context.beginPath();
    points.forEach((position, index) => {
      if (!index) context.moveTo(position.x, position.y);
      else context.lineTo(position.x, position.y);
    });
  };

  if (edge.feedbackEdge) {
    tracePath();
    context.strokeStyle = "#ff826f";
    context.globalAlpha = enabled ? 0.2 + peakEnergy * 0.28 : 0.08;
    context.lineWidth = 2.2 + peakEnergy * 1.5;
    context.setLineDash([3, 5]);
    context.stroke();
    context.setLineDash([]);
  }

  tracePath();
  context.strokeStyle = edgeGradient;
  context.globalAlpha = enabled ? 0.4 + peakEnergy * 0.52 : 0.12;
  context.lineWidth = 1.15 + peakEnergy * 2.6;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (!enabled) context.setLineDash([2, 6]);
  context.shadowColor = endColor;
  context.shadowBlur = peakEnergy * 15;
  context.stroke();
  context.shadowBlur = 0;
  context.setLineDash([]);

  if (peakEnergy > 0.018) {
    let connected = false;
    context.beginPath();
    for (let index = 1; index < points.length; index += 1) {
      const energy = Math.max(points[index - 1].energy, points[index].energy);
      if (energy < 0.025) {
        connected = false;
        continue;
      }
      if (!connected) context.moveTo(points[index - 1].x, points[index - 1].y);
      context.lineTo(points[index].x, points[index].y);
      connected = true;
    }
    context.strokeStyle = "#fff3d6";
    context.globalAlpha = 0.28 + peakEnergy * 0.7;
    context.lineWidth = 0.7 + peakEnergy * 1.5;
    context.shadowColor = "#fff3d6";
    context.shadowBlur = 5 + peakEnergy * 13;
    context.stroke();
    context.shadowBlur = 0;
  }

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - ux * 7 + uy * 4, end.y - uy * 7 - ux * 4);
  context.lineTo(end.x - ux * 7 - uy * 4, end.y - uy * 7 + ux * 4);
  context.closePath();
  context.fillStyle = edge.feedbackEdge ? "#ff826f" : endColor;
  context.globalAlpha = enabled ? 1 : 0.2;
  context.fill();
  context.globalAlpha = 1;
}

function edgeSwitchPosition(from, to, edge, edges) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const shortEdge = distance < 64;
  const progress = shortEdge ? 0.5 : 0.28;
  const reciprocal = shortEdge && edges.some(
    (candidate) => candidate.from === edge.to && candidate.to === edge.from,
  );
  const offset = reciprocal ? 7 : 0;
  return {
    x: from.x + dx * progress + (-dy / distance) * offset,
    y: from.y + dy * progress + (dx / distance) * offset,
  };
}

function drawEdgeSwitch(position, from, to, enabled, edge, hovered = false) {
  const color = edge.feedbackEdge
    ? "#ff826f"
    : EDGE_COLORS[edge.to % EDGE_COLORS.length];
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.save();
  context.translate(position.x, position.y);
  context.rotate(angle);
  if (hovered) {
    context.beginPath();
    context.rect(-8, -6.5, 16, 13);
    context.strokeStyle = color;
    context.globalAlpha = 0.24;
    context.lineWidth = 2.5;
    context.stroke();
  }
  context.beginPath();
  context.rect(-5, -3.75, 10, 7.5);
  context.fillStyle = "#071011";
  context.globalAlpha = 0.96;
  context.fill();
  context.strokeStyle = color;
  context.globalAlpha = enabled ? 0.95 : 0.48;
  context.lineWidth = enabled ? 2 : 1.25;
  context.stroke();

  context.fillStyle = enabled ? color : "#8ca1a5";
  context.globalAlpha = enabled ? 1 : 0.58;
  context.fillRect(-3.8, -1.15, 2.1, 2.3);
  context.fillRect(1.7, -1.15, 2.1, 2.3);
  context.beginPath();
  if (enabled) {
    context.moveTo(-2.2, 0);
    context.lineTo(2.2, 0);
  } else {
    context.moveTo(-2.2, 0);
    context.lineTo(1.15, -2.35);
  }
  context.strokeStyle = enabled ? color : "#8ca1a5";
  context.globalAlpha = enabled ? 1 : 0.72;
  context.lineWidth = 1.5;
  context.lineCap = "square";
  context.stroke();
  context.restore();
}

function drawTerminalRoute(from, to, color, timestamp, delaySeconds, startDelay = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const points = [];
  const now = timestamp / 1_000;
  let peak = 0;
  for (let index = 0; index <= 12; index += 1) {
    const progress = index / 12;
    const travelDelay = startDelay + delaySeconds * progress;
    const energy = state.mic
      ? Math.min(1, envelopeAt(now - travelDelay) * 9)
      : 0;
    peak = Math.max(peak, energy);
    const offset = Math.sin(Math.PI * progress)
      * Math.sin(timestamp * 0.012 + progress * Math.PI * 5)
      * energy * Math.min(8, distance * 0.055);
    points.push({
      x: from.x + dx * progress + normalX * offset,
      y: from.y + dy * progress + normalY * offset,
    });
  }
  context.beginPath();
  points.forEach((position, index) => {
    if (!index) context.moveTo(position.x, position.y);
    else context.lineTo(position.x, position.y);
  });
  context.strokeStyle = color;
  context.globalAlpha = 0.52 + peak * 0.42;
  context.lineWidth = 1.4 + peak * 2.8;
  context.lineCap = "round";
  context.shadowColor = color;
  context.shadowBlur = peak * 15;
  context.stroke();
  context.shadowBlur = 0;
  const ux = dx / distance;
  const uy = dy / distance;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - ux * 9 + uy * 5, to.y - uy * 9 - ux * 5);
  context.lineTo(to.x - ux * 9 - uy * 5, to.y - uy * 9 + ux * 5);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.globalAlpha = 1;
}

function drawSpeakerConnection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  context.save();
  context.beginPath();
  context.moveTo(from.x + ux * 10, from.y + uy * 10);
  context.lineTo(to.x - ux * 18, to.y - uy * 18);
  context.strokeStyle = "#e8c46b";
  context.globalAlpha = 0.62;
  context.lineWidth = 1.2;
  context.lineCap = "round";
  context.setLineDash([1, 6]);
  context.stroke();
  context.restore();
}

function drawTerminal(position, kind) {
  const input = kind === "input";
  const color = input ? "#55d9ff" : "#e8c46b";
  context.save();
  context.beginPath();
  context.arc(position.x, position.y, 16, 0, Math.PI * 2);
  context.fillStyle = "#070b0d";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = draggingTerminal === kind ? 3 : 2;
  context.shadowColor = color;
  context.shadowBlur = state.mic ? 12 : 5;
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (input) {
    context.beginPath();
    context.rect(position.x - 4, position.y - 8, 8, 12);
    context.stroke();
    context.beginPath();
    context.arc(position.x, position.y, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(position.x, position.y + 8);
    context.lineTo(position.x, position.y + 12);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(position.x - 9, position.y - 4);
    context.lineTo(position.x - 4, position.y - 4);
    context.lineTo(position.x + 2, position.y - 9);
    context.lineTo(position.x + 2, position.y + 9);
    context.lineTo(position.x - 4, position.y + 4);
    context.lineTo(position.x - 9, position.y + 4);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.arc(position.x + 2, position.y, 8, -0.32 * Math.PI, 0.32 * Math.PI);
    context.stroke();
  }
  context.fillStyle = color;
  context.font = "600 8px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(input ? "MIC IN" : "SPEAKERS OUT", position.x, position.y + 22);
  context.restore();
}

function drawMicrophonePathGuide() {
  context.save();
  context.beginPath();
  if (state.micMotionMode === "random") {
    const minimum = 0.5 - state.micMotionSize;
    const maximum = 0.5 + state.micMotionSize;
    const topLeft = point({ x: minimum, y: minimum });
    const bottomRight = point({ x: maximum, y: maximum });
    context.rect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
  } else {
    for (let index = 0; index <= 96; index += 1) {
      const position = point(microphonePathPosition(state.micMotionMode, index / 96));
      if (!index) context.moveTo(position.x, position.y);
      else context.lineTo(position.x, position.y);
    }
  }
  context.strokeStyle = "#55d9ff";
  context.globalAlpha = state.micMoving ? 0.22 : 0.1;
  context.lineWidth = 1;
  context.setLineDash([3, 7]);
  context.stroke();
  context.restore();
}

function draw(now) {
  context.clearRect(0, 0, cssWidth, cssHeight);
  const geometry = geometryModel();
  const points = geometry.nodes.map(point);
  const inputTerminal = point(endpointPosition("input"));
  const outputTerminal = point(endpointPosition("output"));
  const edgeParameters = edgeAudioParameters(geometry, state);
  const arrivalTimes = visualArrivalTimes(geometry, edgeParameters);
  const entries = model.entries.length ? model.entries : [0];
  drawMicrophonePathGuide();
  for (const nodeId of entries) {
    drawTerminalRoute(
      inputTerminal,
      points[nodeId],
      "#55d9ff",
      now,
      terminalDelaySeconds(endpointPosition("input"), geometry.nodes[nodeId]),
    );
  }
  for (const edge of edgeParameters) {
    const enabled = edgeSwitchEnabled(edge);
    drawVibratingEdge(
      points[edge.from],
      points[edge.to],
      edge,
      now,
      arrivalTimes[edge.from],
      enabled,
    );
  }
  for (const nodeId of graphSinkNodeIds(geometry)) {
    drawSpeakerConnection(points[nodeId], outputTerminal);
  }
  for (const edge of edgeParameters) {
    drawEdgeSwitch(
      edgeSwitchPosition(
        points[edge.from],
        points[edge.to],
        edge,
        edgeParameters,
      ),
      points[edge.from],
      points[edge.to],
      edgeSwitchEnabled(edge),
      edge,
      edge.id === hoveredEdgeId || edge.id === focusedEdgeId,
    );
  }
  points.forEach((position, index) => {
    const energy = Math.min(1, currentLevel * 12);
    const pulse = energy * (0.3 + 0.7 * Math.max(0, Math.sin(now * 0.004 - index * 0.7)));
    context.beginPath();
    context.arc(position.x, position.y, NODE_RADIUS + pulse * 8, 0, Math.PI * 2);
    context.fillStyle = index === selectedNodeId ? "#fff3d6" : "#0a1113";
    context.fill();
    context.strokeStyle = index === selectedNodeId
      ? "#fff3d6"
      : EDGE_COLORS[index % EDGE_COLORS.length];
    context.globalAlpha = 0.62 + pulse * 0.38;
    context.lineWidth = 1.7 + pulse * 2;
    context.shadowColor = EDGE_COLORS[index % EDGE_COLORS.length];
    context.shadowBlur = pulse * 15;
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
    context.fillStyle = index === selectedNodeId ? "#071011" : "#8ca1a5";
    context.font = "8px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), position.x, position.y + 0.5);
  });
  drawTerminal(inputTerminal, "input");
  drawTerminal(outputTerminal, "output");
}

function updateMeter(now) {
  const delta = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (inputAnalyser && state.mic) {
    inputAnalyser.getFloatTimeDomainData(inputWave);
    let sum = 0;
    for (const sample of inputWave) sum += sample * sample;
    const rms = Math.sqrt(sum / inputWave.length);
    currentLevel += (rms - currentLevel) * (rms > currentLevel ? 0.45 : 1 - Math.exp(-delta / 0.18));
    inputPeak = Math.max(currentLevel, inputPeak * Math.exp(-delta / 0.8));
  } else {
    currentLevel *= Math.exp(-delta / 0.12);
    inputPeak *= Math.exp(-delta / 0.3);
  }
  $("inputMeterBar").style.width = `${Math.min(100, currentLevel * 550)}%`;
  $("inputPeakMarker").style.left = `${Math.min(100, inputPeak * 550)}%`;
  $("inputMeterOut").textContent = currentLevel > 0.12 ? "hot" : currentLevel > 0.012 ? "live" : "silent";
}

function frame(now) {
  const motionDelta = Math.min(0.1, Math.max(0, (now - lastMotionFrame) / 1_000));
  lastMotionFrame = now;
  let geometryChanged = advanceMicrophoneMotion(motionDelta);
  geometryChanged = advanceNodeMotion(motionDelta) || geometryChanged;
  if (geometryChanged && now - lastMotionAudioUpdate > 50) {
    applyAudioParameters();
    lastMotionAudioUpdate = now;
  }
  if (geometryChanged) {
    $("motionSummary").textContent = `nodes ${state.nodeMoving ? `${state.nodeMotionMode} playing` : "paused"} · mic ${state.micMoving ? `${state.micMotionMode} playing` : "paused"}`;
  }
  updateMeter(now);
  recordEnvelope(now / 1_000, currentLevel);
  draw(now);
  requestAnimationFrame(frame);
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

const STATE_CONTROL_IDS = [
  "level",
  "inputTrim",
  "nodeCount",
  "density",
  "seed",
  "nodeMotionSpeed",
  "nodeMotionAmount",
  "micMotionSpeed",
  "micMotionSize",
  "baseDelay",
  "timeScale",
  "timeCurve",
  "nodePass",
  "pitchScale",
  "pitchAsymmetry",
  "pitchCurve",
  "pitchSlew",
  "feedback",
  "damping",
  "wet",
  "dry",
  "spread",
];

function syncControlsFromState() {
  $("graphPatch").value = Object.hasOwn(GRAPH_DELAY_PATCHES, state.graphPatch)
    ? state.graphPatch
    : "custom";
  for (const name of Object.keys(GRAPH_DELAY_PATCHES)) {
    $(`graphPatch-${name}`)?.setAttribute(
      "aria-pressed",
      String(state.graphPatch === name),
    );
  }
  $("topology").value = state.topology;
  $("nodeMotionMode").value = state.nodeMotionMode;
  $("micMotionMode").value = state.micMotionMode;
  for (const id of STATE_CONTROL_IDS) {
    if ($(id)) $(id).value = String(state[id]);
  }
}

function loadGraphPatch(name) {
  const patch = GRAPH_DELAY_PATCHES[name];
  if (!patch) return;
  cancelScheduledGraphRebuild();
  resetEdgeSwitchesForNextGraph();
  Object.assign(state, patch, { graphPatch: name });
  syncControlsFromState();
  scheduleGraphRebuild(120);
  updateUi();
  $("liveStatus").textContent = `${patch.label} graph-delay preset queued.`;
}

function updateUi() {
  const preset = GRAPH_PRESETS[state.topology];
  const activePreset = GRAPH_PRESETS[model.type];
  const patch = GRAPH_DELAY_PATCHES[state.graphPatch];
  const graphPending = graphRebuildTimer !== null || graphRebuildQueued;
  const geometry = geometryModel();
  const cycleEdges = model.edges.filter((edge) => edge.feedbackEdge).length;
  const edgeParameters = edgeAudioParameters(geometry, state);
  const audibleTaps = graphSinkNodeIds(geometry);
  const openSwitchCount = model.edges.filter(edgeSwitchEnabled).length;
  const closedSwitchCount = model.edges.length - openSwitchCount;
  const arrivals = visualArrivalTimes(geometry, edgeParameters);
  const tapArrivals = audibleTaps
    .map((nodeId) => arrivals[nodeId])
    .filter(Number.isFinite)
    .map((seconds) => Math.round(seconds * 1_000));
  const turnRoutings = graphTurnRoutings(geometry, turnRoutingOptions());
  const turnRouteCount = turnRoutings.reduce(
    (count, routing) => count + routing.turns.length,
    0,
  );
  const selectedEdges = edgeParameters
    .filter((edge) => edge.from === selectedNodeId || edge.to === selectedNodeId);
  const selectedTimes = selectedEdges.map((edge) => Math.round(edge.delaySeconds * 1_000));
  const audioLabel = state.starting ? "starting" : state.mic ? "live" : "off";
  $("audioState").textContent = audioLabel;
  $("audioButton").setAttribute("aria-pressed", String(state.mic));
  $("micButton").setAttribute("aria-pressed", String(state.mic));
  $("seedMicButton").setAttribute("aria-pressed", String(state.mic));
  $("audioButton").disabled = state.starting;
  $("micButton").disabled = state.starting;
  $("seedMicButton").disabled = state.starting;
  $("stopButton").disabled = !state.mic && !state.starting;
  $("panicButton").disabled = !state.mic && !state.starting;
  $("micButtonLabel").textContent = state.mic ? "Input live" : state.starting ? "Starting…" : "Start input";
  $("micButtonHint").textContent = state.mic ? "microphone → graph → output" : "allow microphone access";
  $("listenSummary").textContent = `microphone ${audioLabel}`;
  $("graphPatchDescription").textContent = patch?.description
    ?? "Custom graph, timing, pitch, feedback, and mix settings.";
  $("topologyDescription").textContent = preset.description;
  $("topologySummary").textContent = graphPending
    ? `${patch?.label ?? "Custom"} · updating…`
    : `${patch?.label ?? "Custom"} · ${activePreset.label} · ${model.cyclic ? "cyclic" : "acyclic"}${activeDensityLimit ? ` · auto-safe ${percent(activeDensityLimit.applied)}` : ""}`;
  $("motionSummary").textContent = `nodes ${state.nodeMoving ? `${state.nodeMotionMode} playing` : "paused"} · mic ${state.micMoving ? `${state.micMotionMode} playing` : "paused"}`;
  $("delaySummary").textContent = `${state.baseDelay}–${state.baseDelay + state.timeScale} ms · angle → ${Math.round(state.pitchScale * 100)}% octave`;
  $("mixSummary").textContent = `${percent(state.wet)} graph · ${percent(state.dry)} direct`;
  const routeLoad = turnRouteCount > MAX_LIVE_TURN_ROUTES
    ? " · over live limit"
    : turnRouteCount > 128 ? " · high DSP" : "";
  const densitySafety = activeDensityLimit
    ? ` · density auto-limited from ${percent(activeDensityLimit.requested)}`
    : "";
  const speakerRouteCount = audibleTaps.length;
  const tapLabel = `${audibleTaps.length} ${audibleTaps.length === 1 ? "tap" : "taps"}`;
  const sinkTapLabel = `${audibleTaps.length} sink ${audibleTaps.length === 1 ? "tap" : "taps"}`;
  const speakerRouteLabel = `${speakerRouteCount} speaker ${speakerRouteCount === 1 ? "route" : "routes"}`;
  $("graphInfoSummary").textContent = `${model.nodes.length} nodes · ${openSwitchCount}/${model.edges.length} routes open · ${tapLabel}`;
  $("structureReadout").textContent = `${model.nodes.length} nodes · ${model.edges.length} edges · ${openSwitchCount}/${model.edges.length} routes open · ${sinkTapLabel} · ${speakerRouteLabel} · ${turnRouteCount} turns${routeLoad}${densitySafety}`;
  const firstTap = tapArrivals.length ? Math.min(...tapArrivals) : null;
  const lastTap = tapArrivals.length ? Math.max(...tapArrivals) : null;
  $("pathReadout").textContent = firstTap === null
    ? "no reachable sink tap"
    : firstTap === lastTap
      ? `${firstTap} ms first-pass`
      : `${firstTap}–${lastTap} ms first-pass`;
  $("cycleReadout").textContent = model.cyclic ? `${cycleEdges} cycle-closing edges · bounded` : "none · finite tail";
  $("stageReadout").textContent = `MIC IN → ${activePreset.label.toUpperCase()} → SPEAKERS OUT · ${openSwitchCount}/${model.edges.length} ROUTES OPEN · ${sinkTapLabel.toUpperCase()}`;
  $("feedback").disabled = !model.cyclic;
  $("damping").disabled = !model.cyclic;
  $("openAllSwitchesButton").disabled = closedSwitchCount === 0;
  $("feedbackSafetyNote").textContent = model.cyclic
    ? `cyclic · returns bounded to ${percent(state.feedback)} + damped`
    : "acyclic · feedback dormant";
  canvas.setAttribute("aria-label", `${activePreset.label}, ${model.nodes.length} nodes, ${openSwitchCount} of ${model.edges.length} directed routes open, ${closedSwitchCount} closed, and ${sinkTapLabel}. ${model.cyclic ? "Bounded cyclic feedback." : "Acyclic."} Microphone ${audioLabel}.`);
  $("levelOut").textContent = percent(state.level);
  $("inputTrimOut").textContent = percent(state.inputTrim);
  $("nodeCountOut").textContent = String(state.nodeCount);
  $("densityOut").textContent = percent(state.density);
  $("seedOut").textContent = String(state.seed);
  $("baseDelayOut").textContent = `${state.baseDelay} ms`;
  $("nodeMotionMode").value = state.nodeMotionMode;
  $("nodeMotionSpeedOut").textContent = `${state.nodeMotionSpeed.toFixed(2)} cyc/s`;
  $("nodeMotionAmountOut").textContent = percent(state.nodeMotionAmount);
  $("nodeMotionPlayButton").setAttribute("aria-pressed", String(state.nodeMoving));
  $("nodeMotionPlayButton").setAttribute("aria-label", state.nodeMoving ? "Pause node motion" : "Play node motion");
  $("micMotionMode").value = state.micMotionMode;
  $("micMotionSpeedOut").textContent = `${state.micMotionSpeed.toFixed(2)} cyc/s`;
  $("micMotionSizeOut").textContent = percent(state.micMotionSize);
  $("micMotionPlayButton").setAttribute("aria-pressed", String(state.micMoving));
  $("micMotionPlayButton").setAttribute("aria-label", state.micMoving ? "Pause microphone motion" : "Play microphone motion");
  $("timeScaleOut").textContent = `+${state.timeScale} ms longest edge`;
  $("timeCurveOut").textContent = Math.abs(state.timeCurve - 1) < 0.005
    ? "linear"
    : state.timeCurve < 1
      ? `${state.timeCurve.toFixed(2)} · broad`
      : `${state.timeCurve.toFixed(2)} · long-edge bias`;
  $("nodePassOut").textContent = `${percent(state.nodePass)} per node`;
  $("pitchScaleOut").textContent = `${Math.round(state.pitchScale * 100)}% octave / 180°`;
  $("pitchAsymmetryOut").textContent = Math.abs(state.pitchAsymmetry) < 0.005
    ? "even"
    : `${state.pitchAsymmetry < 0 ? "left" : "right"} ${Math.round(Math.abs(state.pitchAsymmetry) * 100)}% wider`;
  $("pitchCurveOut").textContent = Math.abs(state.pitchCurve - 1) < 0.005
    ? "linear"
    : state.pitchCurve < 1
      ? `${state.pitchCurve.toFixed(2)} · quicker small turns`
      : `${state.pitchCurve.toFixed(2)} · gentler small turns`;
  $("pitchSlewOut").textContent = `${Math.round(state.pitchSlew)} ms`;
  $("selectedNodeOut").textContent = nodeTurnReadout(selectedNodeId, geometry);
  $("selectedTimeOut").textContent = selectedTimes.length
    ? `${Math.min(...selectedTimes)}–${Math.max(...selectedTimes)} ms · ${selectedTimes.length} edges`
    : "no connected edges";
  $("feedbackOut").textContent = percent(state.feedback);
  $("dampingOut").textContent = state.damping >= 1000 ? `${(state.damping / 1000).toFixed(1)} kHz` : `${state.damping} Hz`;
  $("wetOut").textContent = percent(state.wet);
  $("dryOut").textContent = percent(state.dry);
  $("spreadOut").textContent = percent(state.spread);
  syncControlsFromState();
}

function bindRange(id, property, {
  graph = false,
  audio = true,
  marksPatchCustom = false,
} = {}) {
  const control = $(id);
  control.addEventListener("input", (event) => {
    state[property] = Number(event.currentTarget.value);
    if (marksPatchCustom) state.graphPatch = "custom";
    if (id === "inputTrim" && audioGraph?.inputTrimNode && audioContext) {
      audioGraph.inputTrimNode.gain.setTargetAtTime(state.inputTrim, audioContext.currentTime, 0.02);
    } else if (graph) {
      resetEdgeSwitchesForNextGraph();
      scheduleGraphRebuild();
      updateUi();
      return;
    } else if (audio) {
      applyAudioParameters();
    }
    updateUi();
  });
  if (graph) control.addEventListener("change", flushGraphRebuild);
}

function canvasPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (cssWidth / Math.max(1, bounds.width)),
    y: (event.clientY - bounds.top) * (cssHeight / Math.max(1, bounds.height)),
  };
}

function edgeSwitchAt(position) {
  const geometry = geometryModel();
  const points = geometry.nodes.map(point);
  let closest = null;
  for (const edge of geometry.edges) {
    const switchPosition = edgeSwitchPosition(
      points[edge.from],
      points[edge.to],
      edge,
      geometry.edges,
    );
    const distance = Math.hypot(
      switchPosition.x - position.x,
      switchPosition.y - position.y,
    );
    if (
      distance <= EDGE_SWITCH_HIT_RADIUS
      && (!closest || distance < closest.distance)
    ) {
      closest = { edge, distance };
    }
  }
  return closest?.edge ?? null;
}

function moveSelectedNode(position) {
  const node = model.nodes[selectedNodeId];
  if (!node) return;
  const displayed = {
    x: Math.max(0.02, Math.min(0.98, (position.x - 56) / Math.max(1, cssWidth - 102))),
    y: Math.max(0.02, Math.min(0.98, (position.y - 34) / Math.max(1, cssHeight - 68))),
  };
  node.x = displayed.x;
  node.y = displayed.y;
  applyAudioParameters();
  updateUi();
}

function moveTerminal(position) {
  if (draggingTerminal !== "input") return;
  const x = Math.max(0.01, Math.min(0.99, (position.x - 56) / Math.max(1, cssWidth - 102)));
  const y = Math.max(0.02, Math.min(0.98, (position.y - 34) / Math.max(1, cssHeight - 68)));
  state.inputX = x;
  state.inputY = y;
  applyAudioParameters();
  updateUi();
}

canvas.addEventListener("pointerdown", (event) => {
  const position = canvasPointer(event);
  const inputTerminal = point(endpointPosition("input"));
  if (Math.hypot(inputTerminal.x - position.x, inputTerminal.y - position.y) <= 28) {
    event.preventDefault();
    draggingTerminal = "input";
    state.micMoving = false;
    draggingNodeId = null;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({ preventScroll: true });
    updateUi();
    return;
  }
  const switchedEdge = edgeSwitchAt(position);
  if (switchedEdge) {
    event.preventDefault();
    hoveredEdgeId = switchedEdge.id;
    focusedEdgeId = switchedEdge.id;
    setEdgeSwitch(switchedEdge.id, !edgeSwitchEnabled(switchedEdge));
    canvas.focus({ preventScroll: true });
    return;
  }
  let closest = null;
  for (const node of geometryModel().nodes) {
    const projected = point(node);
    const distance = Math.hypot(projected.x - position.x, projected.y - position.y);
    if (distance <= NODE_HIT_RADIUS && (!closest || distance < closest.distance)) {
      closest = { id: node.id, distance };
    }
  }
  if (!closest) return;
  event.preventDefault();
  if (state.nodeMoving) bakeNodeMotion();
  selectedNodeId = closest.id;
  draggingNodeId = closest.id;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  updateUi();
});

canvas.addEventListener("pointermove", (event) => {
  if (draggingTerminal) {
    event.preventDefault();
    moveTerminal(canvasPointer(event));
    return;
  }
  if (draggingNodeId !== null && draggingNodeId === selectedNodeId) {
    event.preventDefault();
    moveSelectedNode(canvasPointer(event));
    return;
  }
  const nextHoveredEdgeId = edgeSwitchAt(canvasPointer(event))?.id ?? null;
  if (nextHoveredEdgeId === hoveredEdgeId) return;
  hoveredEdgeId = nextHoveredEdgeId;
  if (hoveredEdgeId === null) canvas.classList.remove("is-switch-hover");
  else canvas.classList.add("is-switch-hover");
});

canvas.addEventListener("pointerleave", () => {
  if (draggingNodeId !== null || draggingTerminal) return;
  hoveredEdgeId = null;
  canvas.classList.remove("is-switch-hover");
});

function finishNodeDrag(event) {
  if (draggingNodeId === null && !draggingTerminal) return;
  canvas.releasePointerCapture?.(event.pointerId);
  const terminalMoved = draggingTerminal === "input";
  draggingNodeId = null;
  draggingTerminal = null;
  canvas.classList.remove("is-dragging");
  $("liveStatus").textContent = terminalMoved
    ? "Microphone input moved; entry route time and first turn updated."
    : `Node ${selectedNodeId + 1} moved; relative turn pitches and connected edge times updated.`;
}

canvas.addEventListener("pointerup", finishNodeDrag);
canvas.addEventListener("pointercancel", finishNodeDrag);
canvas.addEventListener("keydown", (event) => {
  if (["[", "]"].includes(event.key) && model.edges.length) {
    event.preventDefault();
    const direction = event.key === "]" ? 1 : -1;
    const currentIndex = model.edges.findIndex((edge) => edge.id === focusedEdgeId);
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : model.edges.length - 1
      : (currentIndex + direction + model.edges.length) % model.edges.length;
    focusedEdgeId = model.edges[nextIndex].id;
    const edge = model.edges[nextIndex];
    $("liveStatus").textContent = `Connection ${edge.from + 1} → ${edge.to + 1} selected; press Enter or Space to switch it.`;
    return;
  }
  if (["Enter", " "].includes(event.key) && focusedEdgeId !== null) {
    event.preventDefault();
    const edge = model.edges.find((candidate) => candidate.id === focusedEdgeId);
    if (edge) setEdgeSwitch(edge.id, !edgeSwitchEnabled(edge));
    return;
  }
  const movement = event.shiftKey ? 0.05 : 0.01;
  const node = model.nodes[selectedNodeId];
  if (!node || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (state.nodeMoving) bakeNodeMotion();
  if (event.key === "ArrowLeft") node.x = Math.max(0.02, node.x - movement);
  if (event.key === "ArrowRight") node.x = Math.min(0.98, node.x + movement);
  if (event.key === "ArrowUp") node.y = Math.max(0.02, node.y - movement);
  if (event.key === "ArrowDown") node.y = Math.min(0.98, node.y + movement);
  applyAudioParameters();
  updateUi();
});

$("graphPatch").addEventListener("change", (event) => {
  if (event.currentTarget.value === "custom") {
    state.graphPatch = "custom";
    updateUi();
    return;
  }
  loadGraphPatch(event.currentTarget.value);
});
for (const name of Object.keys(GRAPH_DELAY_PATCHES)) {
  $(`graphPatch-${name}`)?.addEventListener("click", () => loadGraphPatch(name));
}
$("topology").addEventListener("change", (event) => {
  state.topology = event.currentTarget.value;
  state.graphPatch = "custom";
  resetEdgeSwitchesForNextGraph();
  scheduleGraphRebuild(120);
  updateUi();
});
$("newGraphButton").addEventListener("click", () => {
  state.seed = state.seed >= 99 ? 1 : state.seed + 1;
  state.graphPatch = "custom";
  resetEdgeSwitchesForNextGraph();
  $("seed").value = String(state.seed);
  scheduleGraphRebuild(120);
  updateUi();
});
$("openAllSwitchesButton").addEventListener("click", openAllEdgeSwitches);
$("nodeMotionPlayButton").addEventListener("click", () => {
  if (state.nodeMoving) {
    bakeNodeMotion();
    applyAudioParameters();
  } else {
    state.nodeMoving = true;
  }
  lastMotionFrame = performance.now();
  updateUi();
});
$("nodeMotionMode").addEventListener("change", (event) => {
  const wasMoving = state.nodeMoving;
  bakeNodeMotion();
  state.nodeMotionMode = event.currentTarget.value;
  state.nodeMotionPhase = 0;
  resetNodeWalkState();
  state.nodeMoving = wasMoving;
  applyAudioParameters();
  updateUi();
});
$("micMotionPlayButton").addEventListener("click", () => {
  state.micMoving = !state.micMoving;
  lastMotionFrame = performance.now();
  updateUi();
});
$("micMotionMode").addEventListener("change", (event) => {
  state.micMotionMode = event.currentTarget.value;
  state.micMotionPhase = 0.5;
  if (state.micMotionMode !== "random") {
    const position = microphonePathPosition();
    state.inputX = position.x;
    state.inputY = position.y;
  }
  applyAudioParameters();
  updateUi();
});
$("micMotionSize").addEventListener("input", (event) => {
  state.micMotionSize = Number(event.currentTarget.value);
  if (state.micMotionMode !== "random") {
    const position = microphonePathPosition();
    state.inputX = position.x;
    state.inputY = position.y;
  }
  applyAudioParameters();
  updateUi();
});
$("resetViewButton").addEventListener("click", () => {
  bakeNodeMotion();
  state.nodeMoving = false;
  state.micMoving = false;
  state.micMotionPhase = 0.5;
  state.inputX = 0.08;
  state.inputY = 0.5;
  applyAudioParameters();
  updateUi();
  $("liveStatus").textContent = "Node motion stopped and microphone input position reset.";
});
$("graphResetButton").addEventListener("click", () => {
  const liveState = { mic: state.mic, starting: state.starting };
  Object.assign(state, INITIAL_STATE, liveState);
  resetEdgeSwitchesForNextGraph();
  selectedNodeId = 0;
  syncControlsFromState();
  scheduleGraphRebuild(0);
  updateUi();
  $("liveStatus").textContent = "Graph-delay parameters reset in place; microphone remains connected.";
});
bindRange("level", "level");
bindRange("inputTrim", "inputTrim");
bindRange("nodeCount", "nodeCount", { graph: true, marksPatchCustom: true });
bindRange("density", "density", { graph: true, marksPatchCustom: true });
bindRange("seed", "seed", { graph: true, marksPatchCustom: true });
bindRange("nodeMotionSpeed", "nodeMotionSpeed", { audio: false });
bindRange("nodeMotionAmount", "nodeMotionAmount");
bindRange("micMotionSpeed", "micMotionSpeed", { audio: false });
bindRange("baseDelay", "baseDelay", { marksPatchCustom: true });
bindRange("timeScale", "timeScale", { marksPatchCustom: true });
bindRange("timeCurve", "timeCurve", { marksPatchCustom: true });
bindRange("nodePass", "nodePass", { marksPatchCustom: true });
bindRange("pitchScale", "pitchScale", { marksPatchCustom: true });
bindRange("pitchAsymmetry", "pitchAsymmetry", { marksPatchCustom: true });
bindRange("pitchCurve", "pitchCurve", { marksPatchCustom: true });
bindRange("pitchSlew", "pitchSlew", { marksPatchCustom: true });
bindRange("feedback", "feedback", { marksPatchCustom: true });
bindRange("damping", "damping", { marksPatchCustom: true });
bindRange("wet", "wet", { marksPatchCustom: true });
bindRange("dry", "dry", { marksPatchCustom: true });
bindRange("spread", "spread", { marksPatchCustom: true });
for (const id of ["audioButton", "micButton", "seedMicButton"]) $(id).addEventListener("click", () => {
  if (state.mic) panic("Microphone and graph delay stopped.");
  else void startMicrophone();
});
$("stopButton").addEventListener("click", () => panic());
$("panicButton").addEventListener("click", () => panic());
globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (state.mic || state.starting)) panic();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (state.mic || state.starting)) panic("Microphone stopped because graph delay moved to the background.");
});
globalThis.addEventListener("beforeunload", () => {
  for (const track of mediaStream?.getTracks?.() ?? []) track.stop();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();
updateUi();
requestAnimationFrame(frame);
