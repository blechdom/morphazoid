import { mountAudioInputControl } from "../../audio-input-control.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { GRAPH_DELAY_INITIAL_STATE as INITIAL_STATE } from "../../families/graph-presets/initial-state.js";
import { GRAPH_DELAY_RUST_PRESETS as GRAPH_DELAY_FULL_PRESETS, captureGraphDelayRustPreset as captureGraphDelayPreset, validateGraphDelayRustPreset as validateGraphDelayPreset, randomizeGraphDelayRustPreset as randomizeGraphDelayPreset } from "./graph-delay-presets.js";
import { GraphDelayRustEngine } from "./graph-delay-engine.js";
import { MAX_RUST_GRAPH_NODES, DEFAULT_RUST_GRAPH_TURN_ROUTES, generateGraphWithinRustBudget } from "./graph-delay-topology.js";
import { randomizeGraphPositions, createRandomGraph, graphOutputPaths } from "./graph-delay-interactions.js";
import { createGraphDelayRenderer } from "./graph-delay-renderer.js";
import { createInputSource, SAMPLE_INPUT_OPTIONS } from "../micmic/native/input-source.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import {
  GRAPH_DELAY_PATCHES,
  GRAPH_PRESETS,
  edgeAudioParameters,
  generateGraph,
  graphSinkNodeIds,
  graphTurnRouteCount,
  graphTurnRoutings,
  nodeTurnRouting,
} from "../graph-delay/graph-delay.js";
import { unlockAudioContext } from "../../audio.js";
import { audioInputConstraints, configureAudioInputNode, audioInputDescription } from "../../audio-input-settings.js";
import { canvasSizing } from "../../graphics/canvas-sizing.js";

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
const EDGE_SWITCH_HIT_RADIUS = 13;
const NODE_RADIUS = 9;
const NODE_HIT_RADIUS = 23;
const SPEAKER_POSITION = Object.freeze({ x: 0.965, y: 0.5 });

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
const gpuCanvas = $("graphGpuStage");
const rendererMode = new URLSearchParams(location.search).get("renderer");
const renderer = rendererMode === "canvas" ? null : createGraphDelayRenderer(gpuCanvas, { force: rendererMode === "webgl2" });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
const stageWrap = $("stageWrap");
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let model = generateGraph({ ...state, type: state.topology, maxNodes: MAX_RUST_GRAPH_NODES });
let edgeSwitchStates = new Map(
  model.edges.map((edge) => [`${edge.from}>${edge.to}`, true]),
);
let resetEdgeSwitchesOnNextCommit = false;
let audioOutputEnabled = false;
let audioContext = null;
let audioGraph = null;
let mediaStream = null;
let microphoneSource = null;
let inputAnalyser = null;
let recordedInput = null;
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
let enginePromise = null;
let lifecycle = 0;
let graphRevision = 0;
let audioStarting = false;
let disposed = false;
let animationFrame = 0;
let lastDraw = -Infinity;
let lastMotionClock = null;
let switchRevision = 0;
const switchEdits = new Map();
let pendingPresetEdits = null;
const performanceState = { voiceCeiling: 0, automatic: true, preparationBudget: DEFAULT_RUST_GRAPH_TURN_ROUTES };
let requestedTurnCount = graphTurnRouteCount(model);
let capacityTesting = false;
let capacityMessage = "Choose a budget, then test this graph. Audio keeps playing during the test.";
let capacityMeasurement = null;
let visualCostMs = 0, visualFps = 0, lastVisualPaint = 0, lastMonitorPaint = -Infinity;
const rangeKnobs = new Map();
let pendingRandomGraph = false;
let pendingLayoutAction = null;
let graphRebuildTimer = null;
let graphRebuildQueued = false;
let activeDensityLimit = null;
let lastAppliedStructure = {
  topology: state.topology,
  nodeCount: state.nodeCount,
  density: state.density,
  seed: state.seed,
};
let lastAppliedConfiguration = graphConfigurationSnapshot();
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



function turnRoutingOptions() {
  return {
    inputPosition: endpointPosition("input"),
    pitchScale: state.pitchScale,
    pitchAsymmetry: state.pitchAsymmetry,
    pitchCurve: state.pitchCurve,
  };
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

function reportAudioError(error) {
  if (disposed || error?.name === "AbortError") return;
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

async function ensureEngine() {
  if (disposed) throw new DOMException("Page closed", "AbortError");
  if (audioGraph && audioContext?.state !== "closed") {
    const engine = audioGraph;
    await audioContext.resume();
    if (disposed || audioGraph !== engine) throw new DOMException("Audio start cancelled", "AbortError");
    return engine;
  }
  if (enginePromise) return enginePromise;
  const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Constructor) throw new Error("Web Audio is not available in this browser.");
  const session = lifecycle;
  const audio = new Constructor({ latencyHint: "interactive" });
  audioContext = audio;
  unlockAudioContext(audio);
  // Resume synchronously from the explicit Audio or microphone gesture.
  const resumed = audio.resume();
  const pending = (async () => {
    let engine;
    try {
      await resumed;
      engine = await GraphDelayRustEngine.create(audio, { onError: error => { if (session === lifecycle) { panic("Audio engine stopped."); reportAudioError(error); } } });
      if (session !== lifecycle || disposed || audio !== audioContext) throw new DOMException("Audio start cancelled", "AbortError");
      await engine.update(geometryModel(), state, edgeSwitchEnabledFlags(model));
      if (session !== lifecycle || disposed || audio !== audioContext) throw new DOMException("Audio start cancelled", "AbortError");
      await engine.setPerformance(performanceState);
      // Controls may have moved while the first installation was prepared.
      await engine.update(geometryModel(), state, edgeSwitchEnabledFlags(model));
      if (session !== lifecycle || disposed || audio !== audioContext) throw new DOMException("Audio start cancelled", "AbortError");
      await engine.setPerformance(performanceState);
      if (session !== lifecycle || disposed || audio !== audioContext) throw new DOMException("Audio start cancelled", "AbortError");
      audioGraph = engine;
      engine.setOutputEnabled(audioOutputEnabled);
      inputAnalyser = audio.createAnalyser();
      inputAnalyser.fftSize = 512;
      inputAnalyser.connect(engine.input);
      return engine;
    } catch (error) {
      await engine?.dispose();
      if (audio.state !== "closed") await audio.close();
      if (audioGraph === engine) audioGraph = null;
      if (audioContext === audio) audioContext = null;
      throw error;
    }
  })();
  enginePromise = pending;
  try { return await pending; }
  finally { if (enginePromise === pending) enginePromise = null; }
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

function applyAudioParameters() {
  if (!audioGraph) {
    if (graphRebuildTimer === null && !graphRebuildQueued) lastAppliedConfiguration = graphConfigurationSnapshot();
    return;
  }
  audioGraph.setOutputEnabled(audioOutputEnabled);
  const engine = audioGraph, configuration = graphConfigurationSnapshot(), revision = graphRevision;
  engine.updateParameters(geometryModel(), state, edgeSwitchEnabledFlags(model)).then(() => {
    if (audioGraph === engine && revision === graphRevision && graphRebuildTimer === null && !graphRebuildQueued) lastAppliedConfiguration = configuration;
  }).catch(error => { if (audioGraph === engine && revision === graphRevision) reportAudioError(error); });
}

function applyEdgeSwitchByKey() { applyAudioParameters(); }

function setEdgeSwitch(edgeId, enabled) {
  const edge = model.edges[edgeId];
  if (!edge) return;
  const key = edgeSwitchKey(edge);
  switchEdits.set(key, ++switchRevision);
  edgeSwitchStates.set(key, Boolean(enabled));
  applyEdgeSwitchByKey(key, enabled);
  updateUi();
  $("liveStatus").textContent = enabled
    ? `Connection ${edge.from + 1} → ${edge.to + 1} opened.`
    : `Connection ${edge.from + 1} → ${edge.to + 1} closed; its delay tail is draining.`;
}

function openAllEdgeSwitches() {
  for (const edge of model.edges) switchEdits.set(edgeSwitchKey(edge), ++switchRevision);
  edgeSwitchStates = new Map(model.edges.map(edge => [edgeSwitchKey(edge), true]));
  applyAudioParameters();
  updateUi();
  $("liveStatus").textContent = "Every graph connection opened.";
}

function resetEdgeSwitchesForNextGraph() {
  resetEdgeSwitchesOnNextCommit = true;
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

async function rebuildModel({ modelOverride = null, switchesOverride = null, admission = null } = {}) {
  const revision = ++graphRevision;
  const session = lifecycle;
  const gateRevision = switchRevision;
  graphRebuildQueued = true;
  try {
    const safe = admission ?? (modelOverride ? { graph: modelOverride, limited: false } : generateGraphWithinRustBudget({ ...state, type: state.topology }, performanceState.preparationBudget));
    const requested = graphTurnRouteCount(modelOverride ?? generateGraph({ ...state, density: safe.requestedDensity ?? state.density, type: state.topology, maxNodes: MAX_RUST_GRAPH_NODES }));
    const candidate = safe.graph;
    const densityLimit = safe.limited ? { requested: safe.requestedDensity, applied: safe.density } : null;
    const flags = candidate.edges.map(edge => switchesOverride?.[edgeSwitchKey(edge)] ?? (resetEdgeSwitchesOnNextCommit ? true : edgeSwitchStates.get(edgeSwitchKey(edge)) ?? true));
    const structure = requestedStructure();
    if (audioGraph) await audioGraph.update(candidate, state, flags);
    if (revision !== graphRevision || session !== lifecycle || disposed) return false;
    if (densityLimit) { state.density = structure.density = safe.density; state.graphPatch = "custom"; }
    candidate.edges.forEach((edge, index) => {
      const key = edgeSwitchKey(edge);
      if ((switchEdits.get(key) ?? 0) > gateRevision) flags[index] = edgeSwitchStates.get(key) ?? flags[index];
    });
    commitModel(candidate, structure, densityLimit);
    requestedTurnCount = requested;
    edgeSwitchStates = new Map(candidate.edges.map((edge, index) => [edgeSwitchKey(edge), flags[index]]));
    lastAppliedConfiguration = graphConfigurationSnapshot();
    $("audioError").hidden = true;
    announceGraphUpdate(densityLimit);
    return true;
  } catch (error) {
    if (revision !== graphRevision || session !== lifecycle || disposed) return false;
    Object.assign(state, lastAppliedConfiguration);
    resetEdgeSwitchesOnNextCommit = false;
    reportAudioError(error);
    return false;
  } finally {
    if (revision === graphRevision) { graphRebuildQueued = false; applyAudioParameters(); updateUi(); }
  }
}

function scheduleGraphRebuild(delay = 100) {
  graphRevision += 1;
  clearTimeout(graphRebuildTimer);
  graphRebuildTimer = setTimeout(() => { graphRebuildTimer = null; void rebuildModel(); }, delay);
}
function flushGraphRebuild() {
  if (graphRebuildTimer === null) return;
  clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
  void rebuildModel();
}
function cancelScheduledGraphRebuild() {
  clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
  graphRevision += 1;
  graphRebuildQueued = false;
}

async function startMicrophone() {
  if (state.starting || state.mic || disposed) return;
  recordedInput?.selectMode("mic");
  const token = ++microphoneStartToken;
  state.starting = true;
  updateUi();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone input requires a secure browser context.");
    await ensureEngine();
    if (token !== microphoneStartToken || disposed) return;
    const requestedStream = await navigator.mediaDevices.getUserMedia(audioInputConstraints());
    if (token !== microphoneStartToken || disposed || !audioContext || audioContext.state === "closed") {
      for (const track of requestedStream.getTracks()) track.stop();
      return;
    }
    mediaStream = requestedStream;
    microphoneSource = audioContext.createMediaStreamSource(mediaStream);
    configureAudioInputNode(microphoneSource);
    microphoneSource.connect(inputAnalyser);
    state.mic = true;
    for (const track of mediaStream.getTracks()) {
      const stream = mediaStream;
      track.addEventListener("ended", () => { if (mediaStream === stream) stopMicrophone(); }, { once: true });
    }
    $("audioError").hidden = true;
    $("liveStatus").textContent = `${GRAPH_PRESETS[state.topology].label} input started.`;
  } catch (error) {
    if (token === microphoneStartToken) { stopMicrophone(); reportAudioError(error); }
  } finally {
    if (token === microphoneStartToken) { state.starting = false; updateUi(); }
  }
}

function stopMicrophone() {
  microphoneStartToken += 1;
  try { microphoneSource?.disconnect(); } catch { /* already detached */ }
  for (const track of mediaStream?.getTracks?.() ?? []) track.stop();
  mediaStream = microphoneSource = null;
  state.mic = state.starting = false;
  currentLevel = 0;
  updateUi();
}

function inputIsLive() { return state.mic || Boolean(recordedInput?.snapshot().playing); }

function paintInput() {
  if (!recordedInput) return;
  const input = recordedInput.snapshot(), mic = input.mode === "mic", file = input.mode === "file";
  const playing = mic ? state.mic : input.playing, pending = mic ? state.starting : input.pending;
  $("source").value = input.mode;
  $("inputSample").value = input.sampleId;
  $("inputSampleControl").hidden = input.mode !== "samples";
  $("inputFileControl").hidden = !file;
  $("inputPlaybackControls").hidden = mic;
  $("inputMicHelp").hidden = !mic;
  $("inputLoop").checked = input.loop;
  $("nextInputSample").disabled = input.mode !== "samples";
  $("restartInput").disabled = !audioOutputEnabled || pending || file && !input.hasFile;
  $("restartInput").textContent = file ? "Restart file" : "Restart sample";
  $("stopInput").disabled = !pending && !playing;
  const label = mic ? "Mic / line" : file ? input.fileName || "Audio file" : input.label;
  $("inputSummary").textContent = `${mic ? label : file ? "Audio file" : "Built-in samples"} · ${pending ? "loading" : playing ? "live" : input.ended ? "finished" : "ready"}`;
  $("inputSourceStatus").textContent = pending ? `Loading ${label}…`
    : mic ? `${label} ${state.mic ? "live" : "ready · use Mic to start input"}`
      : file && !input.hasFile ? "Choose a local audio file"
        : playing ? `${label} · ${input.loop ? "looping" : "playing"}`
          : input.ended ? `${label} · finished · Restart to play again`
            : `${label} · ${audioOutputEnabled ? "stopped · Restart to play" : "ready · enable Audio to play"}`;
  const credit = $("inputSourceCredit");
  const key = `${input.credit}\n${input.creditUrl}`;
  if (credit.dataset.credit !== key) {
    credit.dataset.credit = key; credit.replaceChildren();
    if (input.credit && /^https?:\/\//.test(input.creditUrl)) {
      const link = document.createElement("a"); link.href = input.creditUrl; link.textContent = input.credit; credit.append(link);
    } else credit.textContent = input.credit;
  }
  credit.hidden = !input.credit;
}

async function changeInput(action, { start = false } = {}) {
  const session = lifecycle;
  $("audioError").hidden = true;
  try {
    await action();
    if (session !== lifecycle || disposed) return;
    if (start && audioOutputEnabled) await recordedInput.start();
  } catch (error) { if (session === lifecycle) reportAudioError(error); }
  finally { if (!disposed) updateUi(); }
}

async function applyPerformance() {
  const engine = audioGraph;
  try { await engine?.setPerformance(performanceState); }
  catch (error) { if (audioGraph === engine) reportAudioError(error); }
  paintPerformance();
}

function paintPerformance() {
  const metrics = audioGraph?.metrics, graphics = renderer?.getStats(), now = performance.now();
  const write = (id, value) => { const node = $(id), text = String(value); if (node.textContent !== text) node.textContent = text; };
  const load = metrics?.cpuLoad ?? 0, peak = metrics?.peakLoad ?? 0;
  write("performanceRenderer", renderer?.available ? "WebGL2" : "Canvas");
  write("performanceAudioLoad", metrics ? `${percent(load)} · ${percent(peak)} peak` : "Audio off");
  $("performanceAudioMeter").value = Math.min(1, Math.max(0, load));
  write("performanceGpuTime", !graphics?.gpuTimingSupported ? "Unavailable"
    : Number.isFinite(graphics.gpuTimeMs) && now - graphics.gpuTimeSampledAt < 2000 ? `${graphics.gpuTimeMs.toFixed(2)} ms` : "Measuring…");
  write("performanceFrameTime", `${visualCostMs.toFixed(1)} ms · ${Math.round(visualFps)} fps`);
  write("performanceRequested", requestedTurnCount);
  write("performancePrepared", metrics?.preparedRoutes ?? graphTurnRouteCount(model));
  write("performanceEligible", metrics?.currentEligibleRoutes ?? "—");
  write("performanceProcessing", metrics?.activeRoutes ?? 0);
  write("performanceLimit", metrics?.liveLimit ?? (performanceState.voiceCeiling || "All"));
  const prepared = metrics?.preparedRoutes ?? graphTurnRouteCount(model);
  const protectedLimit = Boolean(metrics?.automatic && metrics.automaticLimit < Math.min(
    metrics.currentEligibleRoutes, performanceState.voiceCeiling || 512));
  write("liveVoiceStatus", metrics
    ? `${metrics.currentActiveRoutes ?? 0}/${prepared} turns processing${protectedLimit ? " · Protect" : performanceState.voiceCeiling ? " · capped" : ""}`
    : `Audio off · ${prepared} turns prepared`);
  const geometry = geometryModel();
  const { minimumTurns } = graphOutputPaths(geometry, { switches: edgeSwitchStates, ...state });
  const taps = graphSinkNodeIds(geometry).length;
  const turns = graphTurnRoutings(geometry, turnRoutingOptions()).flatMap(routing => routing.turns);
  const shifted = turns.filter(turn => Math.abs(turn.semitones) >= 1.2).length;
  write("performancePitchRoutes", `${shifted}/${turns.length} fully shifted`);
  write("performanceOutputs", `${taps} · ${minimumTurns === null ? "no open path" : `minimum ${minimumTurns} turns`}`);
  let graphStatus = "";
  if (minimumTurns === null) graphStatus = "No open path to an output";
  else if (metrics?.preparedRoutes > 0 && metrics.currentTargetRoutes < minimumTurns) graphStatus = `Needs ${minimumTurns} turns to reach output; ${protectedLimit ? "Protect" : "cap"} allows ${metrics.currentTargetRoutes}`;
  else if (metrics?.warmRemainingSeconds > 0) graphStatus = `Previous graph audible · new graph in ${metrics.warmRemainingSeconds.toFixed(1)} s`;
  else if (metrics?.retiringActiveRoutes) graphStatus = "Crossfading graphs";
  else if (metrics?.preparing || graphRebuildQueued) graphStatus = "Preparing next graph · current audio continues";
  write("liveGraphStatus", graphStatus);
  $("liveGraphStatus").hidden = !graphStatus;
  write("performanceMeasured", capacityMeasurement ? `${capacityMeasurement.voices} · ${percent(capacityMeasurement.load)}` : "Untested");
  write("performanceTransition", metrics?.retiringActiveRoutes ? `${metrics.retiringActiveRoutes} previous-graph voices retained · cap applies per graph`
    : metrics?.preparing ? "Preparing next graph · current audio continues" : "No graph transition");
  write("performanceMisses", `${metrics?.deadlineMisses ?? 0} deadlines missed`);
  write("performanceCapacityStatus", capacityMessage);
  write("voiceCeilingOut", performanceState.voiceCeiling || "All prepared");
  write("capacityBudgetOut", $("capacityBudget").value);
  $("voiceCeiling").setAttribute("aria-valuetext", performanceState.voiceCeiling ? `${performanceState.voiceCeiling} voices per graph` : "No manual voice cap");
  $("testCapacity").disabled = !audioGraph || capacityTesting || graphRebuildQueued || graphRebuildTimer !== null;
  $("testCapacity").textContent = capacityTesting ? "Testing…" : "Test capacity";
  $("capacityBudget").disabled = $("capacityBudgetExact").disabled = capacityTesting;
  $("automatic").checked = performanceState.automatic;
}

function capacitySceneKey() {
  return JSON.stringify([graphRevision, graphConfigurationSnapshot(), state.inputX, state.inputY,
    geometryModel().nodes, [...edgeSwitchStates]]);
}

async function testCapacity() {
  const engine = audioGraph;
  if (!engine || capacityTesting || graphRebuildQueued || graphRebuildTimer !== null) return;
  const session = lifecycle, sceneKey = capacitySceneKey();
  const budget = Number($("capacityBudget").value);
  capacityTesting = true;
  capacityMessage = "Testing a warmed graph in a separate worker… Motion pauses during measurement.";
  paintPerformance();
  try {
    const safe = generateGraphWithinRustBudget({ ...state, density: activeDensityLimit?.requested ?? state.density, type: state.topology }, budget);
    // Keep the geometry the performer shaped while allowing additional edges.
    const positions = new Map(model.nodes.map(node => [node.id, node]));
    for (const node of safe.graph.nodes) {
      const current = positions.get(node.id);
      if (current) { node.x = current.x; node.y = current.y; }
    }
    const result = await engine.measureCapacity(safe.graph, { ...state }, edgeSwitchEnabledFlags(safe.graph));
    if (session !== lifecycle || engine !== audioGraph || disposed) return;
    if (sceneKey !== capacitySceneKey()) { capacityMessage = "Graph changed during the test. Test the new graph to apply its budget."; return; }
    capacityMeasurement = result;
    if (result.proved || !performanceState.automatic) {
      const previousBudget = performanceState.preparationBudget;
      performanceState.preparationBudget = budget;
      const applied = await rebuildModel({ admission: safe });
      if (session !== lifecycle || engine !== audioGraph || disposed) return;
      if (!applied) { performanceState.preparationBudget = previousBudget; capacityMessage = "Graph could not be installed; previous budget retained."; return; }
      capacityMessage = `${result.voices} voices tested at ${percent(result.load)} audio load. ${result.proved ? "Within the 45% test target" : "Manual trial · 45% test target not proved"}. ${budget}-voice preparation budget applied.`;
    } else capacityMessage = `${result.voices} voices tested at ${percent(result.load)} audio load; the 45% target was not proved. Previous graph retained. Lower the budget and test again.`;
  } catch (error) {
    if (session === lifecycle && !disposed) capacityMessage = error.name === "AbortError" ? "Capacity test cancelled." : `Capacity test: ${error.message}`;
  } finally {
    if (session === lifecycle) { capacityTesting = false; lastMotionClock = null; paintPerformance(); }
  }
}

function panic(message = "Panic stop. Input and every feedback tail are off.") {
  lifecycle += 1;
  pendingPresetEdits = null;
  pendingRandomGraph = false;
  pendingLayoutAction = null;
  recordedInput?.stop();
  audioGraph?.cancelCapacityMeasurement();
  if (capacityTesting) capacityMessage = "Capacity test cancelled.";
  capacityTesting = false;
  audioStarting = false;
  audioOutputEnabled = false;
  cancelScheduledGraphRebuild();
  stopMicrophone();
  const engine = audioGraph;
  const audio = audioContext;
  audioGraph = audioContext = enginePromise = null;
  try { inputAnalyser?.disconnect(); } catch { /* already detached */ }
  inputAnalyser = null;
  engine?.setOutputEnabled(false);
  engine?.clear();
  void engine?.dispose();
  if (audio && audio.state !== "closed") void audio.close();
  currentLevel = 0;
  $("liveStatus").textContent = message;
  updateUi();
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const sizing = canvasSizing(bounds, globalThis.devicePixelRatio, { pixelBudget: 4_000_000, maxPixelRatio: 2 });
  cssWidth = sizing.cssWidth;
  cssHeight = sizing.cssHeight;
  pixelRatio = sizing.pixelRatio;
  canvas.width = sizing.width;
  canvas.height = sizing.height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  renderer?.resize(cssWidth, cssHeight, pixelRatio);
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
    const energy = Math.min(1, (audioGraph?.metrics?.edgeLevels?.[edge.id] ?? 0) * 5);
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
    const energy = inputIsLive()
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
  context.shadowBlur = inputIsLive() ? 12 : 5;
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
  const inputLabel = recordedInput?.snapshot().mode === "file" ? "FILE IN" : recordedInput?.snapshot().mode === "samples" ? "SAMPLE IN" : "MIC IN";
  context.fillText(input ? inputLabel : "SPEAKERS OUT", position.x, position.y + 22);
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
  const metrics = audioGraph?.metrics;
  const gpuDrawn = renderer?.draw({ points, edges: edgeParameters, inputPoint: inputTerminal,
    outputPoint: outputTerminal, entries, sinks: graphSinkNodeIds(geometry), switches: edgeSwitchStates,
    edgeLevels: metrics?.edgeLevels, nodeLevels: metrics?.nodeLevels, inputLevel: metrics?.inputPeak ?? 0,
    seconds: audioContext?.currentTime ?? now / 1000, reducedMotion: reducedMotion?.matches,
    detailSteps: (metrics?.cpuLoad ?? 0) > .65 ? 8 : 16,
  });
  if (!gpuDrawn) {
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
    const energy = Math.min(1, (metrics?.nodeLevels?.[index] ?? 0) * 4);
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
  if (inputAnalyser && inputIsLive()) {
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

// Motion updates use a separate control cadence. Rendering never schedules audio.
function motionTick() {
  flushGraphInteractions();
  if (disposed || document.hidden || graphRebuildQueued || capacityTesting) { lastMotionClock = null; return; }
  const clock = audioContext?.state === "running" ? audioContext.currentTime : performance.now() / 1000;
  const delta = lastMotionClock === null ? 0 : Math.max(0, Math.min(.1, clock - lastMotionClock));
  lastMotionClock = clock;
  const micChanged = advanceMicrophoneMotion(delta);
  const nodeChanged = advanceNodeMotion(delta);
  if (micChanged || nodeChanged) applyAudioParameters();
}
function frame(now) {
  if (disposed) return;
  const interval = (audioGraph?.metrics?.cpuLoad ?? 0) > .65 ? 66 : 33;
  if (!document.hidden && now - lastDraw >= interval) {
    const drawingStarted = performance.now();
    lastDraw = now;
    updateMeter(now);
    recordEnvelope(now / 1000, currentLevel);
    draw(now);
    visualCostMs += (performance.now() - drawingStarted - visualCostMs) * .2;
    if (lastVisualPaint) visualFps += (1000 / Math.max(1, now - lastVisualPaint) - visualFps) * .15;
    lastVisualPaint = now;
    const metrics = audioGraph?.metrics;
    $("engineReadout").textContent = metrics ? `${metrics.currentActiveRoutes}/${metrics.preparedRoutes} turns processing · ${Math.round((metrics.cpuLoad ?? 0) * 100)}% audio load · ${metrics.deadlineMisses ?? 0} late blocks` : "Audio off";
    $("rendererReadout").textContent = renderer?.available ? "WebGL2" : "Canvas fallback";
    if (now - lastMonitorPaint >= 100) { paintPerformance(); lastMonitorPaint = now; }
  }
  animationFrame = requestAnimationFrame(frame);
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
    rangeKnobs.get(id)?.update();
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
  const patch = GRAPH_DELAY_PATCHES[state.graphPatch] ?? GRAPH_DELAY_FULL_PRESETS.find(item => item.id === state.graphPatch);
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
  $("audioButton").setAttribute("aria-pressed", String(audioOutputEnabled));
  $("audioState").textContent = audioOutputEnabled ? "on" : "off";
  $("micButton").setAttribute("aria-pressed", String(inputIsLive()));
  $("seedMicButton").setAttribute("aria-pressed", String(state.mic));
  $("audioButton").disabled = audioStarting;
  $("micButton").disabled = false;
  $("seedMicButton").disabled = state.starting;
  $("stopButton").disabled = !audioGraph && !audioStarting && !state.mic && !state.starting && !recordedInput?.snapshot().pending;
  $("panicButton").disabled = !audioGraph && !audioStarting && !state.mic && !state.starting && !recordedInput?.snapshot().pending;
  $("micButtonLabel").textContent = state.mic ? "Input live" : state.starting ? "Starting…" : "Start input";
  $("micButtonHint").textContent = state.mic ? audioInputDescription(mediaStream) : "mic / line input · choose in I/O setup";
  $("listenSummary").textContent = `audio input ${audioLabel}`;
  $("graphPatchDescription").textContent = patch?.description
    ?? "Custom graph, timing, pitch, feedback, and mix settings.";
  $("topologyDescription").textContent = preset.description;
  $("topologySummary").textContent = graphPending
    ? `${patch?.label ?? "Custom"} · updating…`
    : `${patch?.label ?? "Custom"} · ${activePreset.label} · ${model.cyclic ? "cyclic" : "acyclic"}${activeDensityLimit ? ` · auto-safe ${percent(activeDensityLimit.applied)}` : ""}`;
  $("motionSummary").textContent = `nodes ${state.nodeMoving ? `${state.nodeMotionMode} playing` : "paused"} · input ${state.micMoving ? `${state.micMotionMode} playing` : "paused"}`;
  $("delaySummary").textContent = `${state.baseDelay}–${state.baseDelay + state.timeScale} ms · angle → ${Math.round(state.pitchScale * 100)}% octave`;
  $("mixSummary").textContent = `${percent(state.wet)} graph · ${percent(state.dry)} direct`;
  const routeLoad = turnRouteCount > performanceState.preparationBudget
    ? " · over live limit"
    : turnRouteCount > performanceState.preparationBudget * .8 ? " · dense" : "";
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
  $("stageReadout").textContent = `INPUT → ${activePreset.label.toUpperCase()} → SPEAKERS OUT · ${openSwitchCount}/${model.edges.length} ROUTES OPEN · ${sinkTapLabel.toUpperCase()}`;
  $("feedback").disabled = !model.cyclic;
  $("damping").disabled = !model.cyclic;
  $("openAllSwitchesButton").disabled = closedSwitchCount === 0;
  $("feedbackSafetyNote").textContent = model.cyclic
    ? `cyclic · returns bounded to ${percent(state.feedback)} + damped`
    : "acyclic · feedback dormant";
  canvas.setAttribute("aria-label", `${activePreset.label}, ${model.nodes.length} nodes, ${openSwitchCount} of ${model.edges.length} directed routes open, ${closedSwitchCount} closed, and ${sinkTapLabel}. ${model.cyclic ? "Bounded cyclic feedback." : "Acyclic."} ${recordedInput?.snapshot().label ?? "Microphone"} ${inputIsLive() ? "live" : "off"}.`);
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
  $("micMotionPlayButton").setAttribute("aria-label", state.micMoving ? "Pause input motion" : "Play input motion");
  $("timeScaleOut").textContent = `+${state.timeScale} ms`;
  $("timeCurveOut").textContent = Math.abs(state.timeCurve - 1) < 0.005
    ? "linear"
    : state.timeCurve < 1
      ? `${state.timeCurve.toFixed(2)} · broad`
      : `${state.timeCurve.toFixed(2)} · biased`;
  $("nodePassOut").textContent = `${percent(state.nodePass)} per node`;
  $("pitchScaleOut").textContent = `${(state.pitchScale * 12).toFixed(1)} st / 180°`;
  $("pitchAsymmetryOut").textContent = Math.abs(state.pitchAsymmetry) < 0.005
    ? "even"
    : `${state.pitchAsymmetry < 0 ? "left" : "right"} ${Math.round(Math.abs(state.pitchAsymmetry) * 100)}% wider`;
  $("pitchCurveOut").textContent = Math.abs(state.pitchCurve - 1) < 0.005
    ? "linear"
    : state.pitchCurve < 1
      ? `${state.pitchCurve.toFixed(2)} · quick`
      : `${state.pitchCurve.toFixed(2)} · gentle`;
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
  for (const id of STATE_CONTROL_IDS) {
    const readout = $(`${id}Out`);
    if (readout) $(id)?.setAttribute("aria-valuetext", readout.textContent);
  }
  paintInput();
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
    if (graph) {
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

function graphInteractionBusy() {
  return graphRebuildQueued || graphRebuildTimer !== null || capacityTesting
    || document.querySelector(".header-preset-controls")?.getAttribute("aria-busy") === "true";
}

function applyGraphLayout(action) {
  if (disposed) return;
  if (graphInteractionBusy()) {
    pendingLayoutAction = action;
    $("liveStatus").textContent = `${action === "random" ? "Random positions" : "Arrange"} queued for the graph being prepared.`;
    return;
  }
  const layout = action === "random" ? randomizeGraphPositions(model)
    : generateGraph({ ...committedCaptureState(), type: model.type, maxNodes: MAX_RUST_GRAPH_NODES });
  for (const node of model.nodes) {
    node.x = layout.nodes[node.id].x;
    node.y = layout.nodes[node.id].y;
  }
  if (action === "arrange") state.nodeMoving = false;
  resetNodeWalkState();
  state.graphPatch = "custom";
  applyAudioParameters();
  updateUi();
  presetController.refresh();
  $("liveStatus").textContent = action === "random"
    ? "Node positions randomized; connections, switches and delay histories retained."
    : "Graph arranged; node motion paused, connections and delay histories retained.";
}

async function randomGraph() {
  if (disposed) return;
  if (graphInteractionBusy()) {
    pendingRandomGraph = true;
    $("liveStatus").textContent = "Random graph queued after the current graph is ready.";
    return;
  }
  try {
    const { parameters, admission } = createRandomGraph(state, performanceState.preparationBudget);
    const session = lifecycle;
    Object.assign(state, parameters);
    resetEdgeSwitchesForNextGraph();
    updateUi();
    if (await rebuildModel({ admission }) && session === lifecycle) {
      presetController.refresh();
      $("liveStatus").textContent = `Random ${GRAPH_PRESETS[model.type].label} · ${model.nodes.length} nodes. Pitch, timing, mix and input retained.`;
    }
  } catch (error) { reportAudioError(error); }
}

function flushGraphInteractions() {
  if (disposed || document.hidden || (!pendingRandomGraph && !pendingLayoutAction) || graphInteractionBusy()) return;
  if (pendingRandomGraph) {
    pendingRandomGraph = false;
    void randomGraph();
    return;
  }
  const action = pendingLayoutAction;
  pendingLayoutAction = null;
  applyGraphLayout(action);
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
    ? "Input moved; entry route time and first turn updated."
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
$("randomGraphButton").addEventListener("click", () => void randomGraph());
$("randomizeNodePositionsButton").addEventListener("click", () => applyGraphLayout("random"));
$("restoreNodePositionsButton").addEventListener("click", () => applyGraphLayout("arrange"));
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
  lastMotionClock = null;
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
  lastMotionClock = null;
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
  $("liveStatus").textContent = "Node motion stopped and input position reset.";
});
$("graphResetButton").addEventListener("click", () => {
  pendingRandomGraph = false;
  pendingLayoutAction = null;
  const liveState = { mic: state.mic, starting: state.starting, level: state.level, inputTrim: state.inputTrim };
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
$("audioButton").addEventListener("click", async () => {
  if (audioStarting) return;
  if (audioOutputEnabled) {
    audioOutputEnabled = false;
    recordedInput.stop();
    stopMicrophone();
    audioGraph?.setOutputEnabled(false);
    audioGraph?.clear();
    updateUi();
    return;
  }
  const session = lifecycle;
  audioStarting = true;
  $("audioError").hidden = true;
  updateUi();
  try {
    const engine = await ensureEngine();
    if (session !== lifecycle || disposed) return;
    audioOutputEnabled = true;
    engine.setOutputEnabled(true);
    await recordedInput.start();
  } catch (error) { if (session === lifecycle) reportAudioError(error); }
  finally { if (session === lifecycle) { audioStarting = false; updateUi(); } }
});

recordedInput = createInputSource({
  prepare: ensureEngine, getContext: () => audioContext, getTarget: () => inputAnalyser,
  canPlay: () => audioOutputEnabled && !disposed,
  onChange: () => { if (!disposed) updateUi(); }, onError: reportAudioError,
});
$("inputSample").replaceChildren(...SAMPLE_INPUT_OPTIONS.map(option => new Option(option.label.replace(/^Sample · /, ""), option.id)));
$("source").addEventListener("change", event => {
  const mode = event.currentTarget.value;
  stopMicrophone();
  void changeInput(() => recordedInput.selectMode(mode), { start: true });
});
$("inputSample").addEventListener("change", event => {
  const id = event.currentTarget.value;
  void changeInput(() => recordedInput.selectSample(id), { start: true });
});
$("nextInputSample").addEventListener("click", () => {
  const index = SAMPLE_INPUT_OPTIONS.findIndex(option => option.id === recordedInput.snapshot().sampleId);
  void changeInput(() => recordedInput.selectSample(SAMPLE_INPUT_OPTIONS[(index + 1) % SAMPLE_INPUT_OPTIONS.length].id), { start: true });
});
$("inputFile").addEventListener("change", event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  stopMicrophone();
  void changeInput(() => recordedInput.loadFile(file));
  event.currentTarget.value = "";
});
$("inputLoop").addEventListener("change", event => recordedInput.setLoop(event.currentTarget.checked));
$("restartInput").addEventListener("click", () => void changeInput(() => recordedInput.restart()));
$("stopInput").addEventListener("click", () => recordedInput.stop());

for (const id of ["voiceCeiling", "capacityBudget"]) {
  const control = $(id), exact = $(`${id}Exact`);
  rangeKnobs.set(id, enhanceRangeKnob(control, { scale: "log" }));
  control.addEventListener("input", () => {
    exact.value = control.value;
    if (id === "voiceCeiling") {
      performanceState.voiceCeiling = Number(control.value);
      void applyPerformance();
    }
    paintPerformance();
  });
  const commit = () => {
    const value = exact.valueAsNumber;
    if (!Number.isFinite(value)) { exact.value = control.value; return; }
    control.value = String(Math.round(Math.max(Number(control.min), Math.min(Number(control.max), value))));
    control.dispatchEvent(new Event("input", { bubbles: true }));
    rangeKnobs.get(id).update();
  };
  exact.addEventListener("change", commit);
  exact.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commit(); exact.blur(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); exact.value = control.value; exact.blur(); }
  });
}
for (const id of STATE_CONTROL_IDS.filter(id => id !== "level" && id !== "inputTrim")) {
  rangeKnobs.set(id, enhanceRangeKnob($(id)));
}
$("automatic").addEventListener("change", event => {
  performanceState.automatic = event.currentTarget.checked;
  void applyPerformance();
});
$("testCapacity").addEventListener("click", () => void testCapacity());

const audioInputControl = mountAudioInputControl({
  container: $("listenSection").parentElement, before: $("listenSection"),
  button: $("micButton"), gainInput: $("inputTrim"), gainOutput: $("inputTrimOut"),
  onGainInput: (value) => { state.inputTrim = value; applyAudioParameters(); },
  onStart: () => recordedInput.snapshot().mode === "mic" ? startMicrophone() : changeInput(() => recordedInput.start()),
  onStop: () => recordedInput.snapshot().mode === "mic" ? stopMicrophone() : recordedInput.stop(),
  getState: () => ({ active: inputIsLive(), pending: state.starting || recordedInput.snapshot().pending,
    source: recordedInput.snapshot().mode === "mic" ? "mic" : "file",
    error: $("audioError").hidden ? "" : $("audioError").textContent }),
  getSignal: () => ({ node: inputAnalyser, stream: mediaStream, channels: state.mic ? undefined : 2, multiplier: state.inputTrim }),
  hide: [$("listenSection"), $("seedMicButton")],
});
$("stopButton").addEventListener("click", () => panic());
$("panicButton").addEventListener("click", () => panic());
globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (audioGraph || audioStarting || state.mic || state.starting || recordedInput?.snapshot().pending)) panic();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { lastMotionClock = null; panic("Audio stopped because Graph Delay Rust moved to the background."); }
});
function teardown() {
  if (disposed) return;
  panic("Graph Delay Rust closed.");
  disposed = true;
  clearInterval(motionTimer);
  cancelAnimationFrame(animationFrame);
  resizeObserver.disconnect();
  renderer?.dispose();
  recordedInput.dispose();
  for (const knob of rangeKnobs.values()) knob.destroy();
  audioInputControl?.destroy?.();
  presetController?.destroy();
}
globalThis.addEventListener("pagehide", event => {
  if (event.persisted) { lastMotionClock = null; panic("Audio stopped when leaving Graph Delay Rust."); }
  else teardown();
});
const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(stageWrap);
resetNodeWalkState();
const motionTimer = setInterval(motionTick, 50);
resizeCanvas();
updateUi();
animationFrame = requestAnimationFrame(frame);

function committedCaptureState() {
  // Structural sliders may be ahead of the admitted model during debounce.
  return { ...state, ...lastAppliedStructure, nodeCount: model.nodes.length, topology: model.type };
}
// Read-only diagnostics support repeatable browser/audio verification.
globalThis.__graphDelayRust = Object.freeze({
  snapshot: () => ({ ...captureGraphDelayPreset(committedCaptureState(), geometryModel(), edgeSwitchStates),
    audio: audioOutputEnabled, microphone: state.mic, starting: audioStarting,
    renderer: renderer?.available ? "webgl2" : "canvas", metrics: audioGraph?.metrics ?? null,
    inputSource: recordedInput.snapshot(), performance: { ...performanceState },
    capacity: { testing: capacityTesting, measurement: capacityMeasurement, message: capacityMessage },
    graphics: renderer?.getStats() ?? null }),
});


$("graphPatchGrid")?.setAttribute("hidden", "");
const presetController = registerHeaderPresets({
  id: "graph-delay-rust", presets: GRAPH_DELAY_FULL_PRESETS, randomize: randomizeGraphDelayPreset,
  capture: () => captureGraphDelayPreset(committedCaptureState(), model, edgeSwitchStates),
  async apply(snapshot) {
    validateGraphDelayPreset(snapshot);
    pendingPresetEdits = null;
    pendingRandomGraph = false;
    pendingLayoutAction = null;
    const gateRevision = switchRevision;
    const phase = state.nodeMotionPhase;
    cancelScheduledGraphRebuild();
    Object.assign(state, snapshot.parameters);
    if (!await rebuildModel({ modelOverride: structuredClone(snapshot.graph), switchesOverride: snapshot.edgeSwitches })) throw new Error("Graph replacement failed; previous audio retained");
    // The shared picker verifies a complete recall before accepting later
    // gestures. Keep edits made during preparation and replay them after that
    // transaction succeeds, so they neither disappear nor trigger rollback.
    pendingPresetEdits = {
      graph: model, session: lifecycle,
      parameters: Object.fromEntries(Object.keys(snapshot.parameters)
        .filter(key => state[key] !== snapshot.parameters[key]).map(key => [key, state[key]])),
      switches: [...edgeSwitchStates].filter(([key]) => (switchEdits.get(key) ?? 0) > gateRevision),
    };
    Object.assign(state, snapshot.parameters);
    state.nodeMotionPhase = phase;
    edgeSwitchStates = new Map(Object.entries(snapshot.edgeSwitches));
    applyAudioParameters();
    syncControlsFromState();
    updateUi();
  },
  onApplied() {
    const edits = pendingPresetEdits;
    pendingPresetEdits = null;
    if (!edits || edits.graph !== model || edits.session !== lifecycle) return;
    Object.assign(state, edits.parameters);
    for (const [key, enabled] of edits.switches) edgeSwitchStates.set(key, enabled);
    applyAudioParameters();
    updateUi();
    presetController.refresh();
  },
});
