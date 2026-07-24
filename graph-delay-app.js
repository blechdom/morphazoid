import {
  GRAPH_PRESETS,
  edgeAudioParameters,
  generateGraph,
} from "./src/graph-delay.js?v=20260724-coherent-edge-time";

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
const state = {
  topology: "dag",
  nodeCount: 10,
  density: 0.34,
  seed: 17,
  baseDelay: 220,
  timeScale: 60,
  inputPitchReference: 110,
  pitchFloor: 40,
  pitchCeiling: 1_280,
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
  outputX: 0.965,
  outputY: 0.5,
  feedback: 0.72,
  damping: 4800,
  wet: 0.82,
  dry: 0.06,
  spread: 0.8,
  inputTrim: 0.8,
  level: 0.52,
  mic: false,
  starting: false,
};

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let model = generateGraph({ ...state, type: state.topology });
let audioContext = null;
let audioGraph = null;
let mediaStream = null;
let microphoneSource = null;
let inputWave = new Float32Array(512);
let inputPeak = 0;
let currentLevel = 0;
let lastFrame = performance.now();
let selectedNodeId = 0;
let draggingNodeId = null;
let draggingTerminal = null;
let pitchProcessorReady = false;
let pitchProcessorAttempted = false;
let lastMotionFrame = performance.now();
let lastMotionAudioUpdate = -Infinity;
let graphRebuildTimer = null;
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
    : { x: state.outputX, y: state.outputY };
}

function exitNodeIds() {
  const sinks = model.nodes
    .filter((node) => model.outdegree[node.id] === 0)
    .map((node) => node.id);
  return sinks.length ? sinks : [Math.floor(model.nodes.length / 2)];
}

function audibleOutputNodeIds() {
  return model.nodes.map((node) => node.id);
}

function terminalDelaySeconds(from, to) {
  const normalizedLength = Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / Math.SQRT2);
  const terminalBase = Math.max(4, Math.min(24, state.baseDelay * 0.08));
  const terminalVariation = normalizedLength * Math.min(120, state.timeScale * 0.2);
  return (terminalBase + terminalVariation) / 1_000;
}

function nodePitchSemitones(nodeId) {
  const geometry = geometryModel();
  const node = geometry.nodes[nodeId];
  if (!node) return 0;
  const incoming = geometry.edges.filter((edge) => edge.to === nodeId);
  const sourceHz = incoming.length
    ? Math.exp(incoming.reduce(
      (sum, edge) => sum + Math.log(nodePitchTargetHz(edge.from, geometry)),
      0,
    ) / incoming.length)
    : state.inputPitchReference;
  const targetHz = nodePitchTargetHz(nodeId, geometry);
  return Math.max(
    -36,
    Math.min(36, 12 * Math.log2(targetHz / Math.max(20, sourceHz))),
  );
}

function nodeRelationAngle(nodeId, geometry = geometryModel()) {
  const node = geometry.nodes[nodeId];
  if (!node) return 0;
  const incoming = geometry.edges.filter((edge) => edge.to === nodeId);
  const sources = incoming.length
    ? incoming.map((edge) => geometry.nodes[edge.from]).filter(Boolean)
    : [endpointPosition("input")];
  let sine = 0;
  let cosine = 0;
  for (const source of sources) {
    const angle = Math.atan2(source.y - node.y, node.x - source.x);
    sine += Math.sin(angle);
    cosine += Math.cos(angle);
  }
  return Math.atan2(sine, cosine);
}

function nodePitchTargetHz(nodeId, geometry = geometryModel()) {
  const node = geometry.nodes[nodeId];
  if (!node) return state.inputPitchReference;
  const floor = Math.max(20, Math.min(state.pitchFloor, state.pitchCeiling));
  const ceiling = Math.max(floor, state.pitchCeiling);
  const angle = nodeRelationAngle(nodeId, geometry);
  const anglePosition = (angle + Math.PI) / TAU;
  return floor * (ceiling / floor) ** anglePosition;
}

async function preparePitchProcessor(audio) {
  if (pitchProcessorAttempted) return pitchProcessorReady;
  pitchProcessorAttempted = true;
  if (!audio.audioWorklet?.addModule || !globalThis.AudioWorkletNode) return false;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/graph-pitch-processor.js?v=20260724-hz-pitch-map", import.meta.url),
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

function disposeAudioGraph(target) {
  if (!target) return;
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

function buildAudioGraph(audio, { outputGain = state.level } = {}) {
  const input = audio.createGain();
  const dry = audio.createGain();
  const wet = audio.createGain();
  const output = audio.createGain();
  const analyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const clipper = audio.createWaveShaper();
  const geometry = geometryModel();
  const parameters = edgeAudioParameters(geometry, state);
  const exits = audibleOutputNodeIds();
  analyser.fftSize = 1024;
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.22;
  clipper.curve = makeSoftClipCurve();
  clipper.oversample = "2x";
  dry.gain.value = state.dry;
  wet.gain.value = state.wet;
  output.gain.value = outputGain;

  const nodes = geometry.nodes.map((spec) => {
    const sum = audio.createGain();
    const delay = audio.createDelay(2.2);
    const pitch = pitchProcessorReady
      ? new AudioWorkletNode(audio, "morphazoid-graph-pitch", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      : audio.createGain();
    const filter = audio.createBiquadFilter();
    const tap = audio.createGain();
    const pan = audio.createStereoPanner();
    delay.delayTime.value = 0.004;
    pitch.parameters?.get("semitones")?.setValueAtTime(nodePitchSemitones(spec.id), audio.currentTime);
    filter.type = "lowpass";
    filter.frequency.value = state.damping;
    filter.Q.value = 0.45;
    tap.gain.value = 0.9 / Math.sqrt(exits.length);
    pan.pan.value = (spec.x * 2 - 1) * state.spread;
    sum.connect(delay).connect(pitch).connect(filter).connect(tap).connect(pan);
    return { sum, delay, pitch, filter, tap, pan };
  });

  const edgeNodes = parameters.map((edge) => {
    const delay = audio.createDelay(2.2);
    const gain = audio.createGain();
    delay.delayTime.value = edge.delaySeconds;
    gain.gain.value = edge.gain;
    nodes[edge.from].filter.connect(delay).connect(gain).connect(nodes[edge.to].sum);
    return { ...edge, delay, gain };
  });

  const entries = model.entries.length ? model.entries : [0];
  const inputRoutes = entries.map((nodeId) => {
    const delay = audio.createDelay(2.2);
    const gain = audio.createGain();
    delay.delayTime.value = terminalDelaySeconds(endpointPosition("input"), geometry.nodes[nodeId]);
    gain.gain.value = 1 / Math.sqrt(entries.length);
    input.connect(delay).connect(gain).connect(nodes[nodeId].sum);
    return { nodeId, delay, gain };
  });
  const outputRoutes = exits.map((nodeId) => {
    const delay = audio.createDelay(2.2);
    delay.delayTime.value = terminalDelaySeconds(geometry.nodes[nodeId], endpointPosition("output"));
    nodes[nodeId].pan.connect(delay).connect(wet);
    return { nodeId, delay };
  });
  const outputPan = audio.createStereoPanner();
  outputPan.pan.value = (state.outputX * 2 - 1) * state.spread;
  input.connect(dry);
  dry.connect(output);
  wet.connect(outputPan).connect(output);
  output.connect(analyser).connect(compressor).connect(clipper).connect(audio.destination);

  const disconnectables = [
    input, dry, wet, output, outputPan, analyser, compressor, clipper,
    ...nodes.flatMap((node) => Object.values(node)),
    ...edgeNodes.flatMap((edge) => [edge.delay, edge.gain]),
    ...inputRoutes.flatMap((route) => [route.delay, route.gain]),
    ...outputRoutes.map((route) => route.delay),
  ];
  return {
    input,
    dry,
    wet,
    output,
    outputPan,
    analyser,
    nodes,
    edges: edgeNodes,
    inputRoutes,
    outputRoutes,
    disconnectables,
  };
}

function applyAudioParameters() {
  if (!audioGraph || !audioContext) return;
  const now = audioContext.currentTime;
  audioGraph.dry.gain.setTargetAtTime(state.dry, now, 0.02);
  audioGraph.wet.gain.setTargetAtTime(state.wet, now, 0.02);
  audioGraph.output.gain.setTargetAtTime(state.level, now, 0.02);
  const geometry = geometryModel();
  const parameters = edgeAudioParameters(geometry, state);
  for (let index = 0; index < audioGraph.edges.length; index += 1) {
    audioGraph.edges[index].delay.delayTime.setTargetAtTime(parameters[index].delaySeconds, now, 0.03);
    audioGraph.edges[index].gain.gain.setTargetAtTime(parameters[index].gain, now, 0.03);
  }
  for (let index = 0; index < audioGraph.nodes.length; index += 1) {
    const spec = geometry.nodes[index];
    audioGraph.nodes[index].delay.delayTime.setTargetAtTime(0.004, now, 0.03);
    audioGraph.nodes[index].pitch.parameters?.get("semitones")
      ?.setTargetAtTime(nodePitchSemitones(spec.id), now, 0.035);
    audioGraph.nodes[index].filter.frequency.setTargetAtTime(state.damping, now, 0.03);
    audioGraph.nodes[index].pan.pan.setTargetAtTime((spec.x * 2 - 1) * state.spread, now, 0.03);
  }
  for (const route of audioGraph.inputRoutes) {
    route.delay.delayTime.setTargetAtTime(
      terminalDelaySeconds(endpointPosition("input"), geometry.nodes[route.nodeId]),
      now,
      0.035,
    );
  }
  for (const route of audioGraph.outputRoutes) {
    route.delay.delayTime.setTargetAtTime(
      terminalDelaySeconds(geometry.nodes[route.nodeId], endpointPosition("output")),
      now,
      0.035,
    );
  }
  audioGraph.outputPan.pan.setTargetAtTime(
    (state.outputX * 2 - 1) * state.spread,
    now,
    0.035,
  );
}

function connectMicrophoneToGraph(target = audioGraph) {
  if (!microphoneSource || !target || !audioContext) return;
  const trim = audioContext.createGain();
  trim.gain.value = state.inputTrim;
  microphoneSource.connect(trim).connect(target.input);
  target.inputTrimNode = trim;
  target.disconnectables.push(trim);
}

function rebuildModel({ rebuildAudio = true } = {}) {
  model = generateGraph({ ...state, type: state.topology });
  state.nodeMotionPhase = 0;
  resetNodeWalkState();
  selectedNodeId = Math.min(selectedNodeId, model.nodes.length - 1);
  if (rebuildAudio && audioContext && audioGraph) {
    const previousGraph = audioGraph;
    let nextGraph;
    try {
      nextGraph = buildAudioGraph(audioContext, { outputGain: 0 });
    } catch (error) {
      $("audioError").textContent = error instanceof Error
        ? `Graph update failed: ${error.message}`
        : "Graph update failed; the previous audio graph is still active.";
      $("audioError").hidden = false;
      updateUi();
      return;
    }
    audioGraph = nextGraph;
    if (microphoneSource) connectMicrophoneToGraph(nextGraph);
    const now = audioContext.currentTime;
    previousGraph.output.gain.cancelScheduledValues(now);
    previousGraph.output.gain.setValueAtTime(previousGraph.output.gain.value, now);
    previousGraph.output.gain.linearRampToValueAtTime(0, now + 0.065);
    nextGraph.output.gain.cancelScheduledValues(now);
    nextGraph.output.gain.setValueAtTime(0, now);
    nextGraph.output.gain.linearRampToValueAtTime(state.level, now + 0.065);
    retiringAudioGraphs.add(previousGraph);
    setTimeout(() => {
      try {
        if (microphoneSource && previousGraph.inputTrimNode) {
          microphoneSource.disconnect(previousGraph.inputTrimNode);
        }
      } catch {
        // The microphone may have stopped during the crossfade.
      }
      disposeAudioGraph(previousGraph);
    }, 110);
  }
  updateUi();
}

function scheduleGraphRebuild() {
  if (graphRebuildTimer !== null) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = setTimeout(() => {
    graphRebuildTimer = null;
    rebuildModel();
  }, 140);
}

function flushGraphRebuild() {
  if (graphRebuildTimer === null) return;
  clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
  rebuildModel();
}

function cancelScheduledGraphRebuild() {
  if (graphRebuildTimer !== null) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = null;
}

async function startMicrophone() {
  if (state.starting || state.mic) return;
  state.starting = true;
  updateUi();
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone input requires a secure browser context.");
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass({ latencyHint: "interactive" });
    await audioContext.resume();
    await preparePitchProcessor(audioContext);
    if (!audioGraph) audioGraph = buildAudioGraph(audioContext);
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    });
    microphoneSource = audioContext.createMediaStreamSource(mediaStream);
    connectMicrophoneToGraph();
    state.mic = true;
    $("audioError").hidden = true;
    $("liveStatus").textContent = `${GRAPH_PRESETS[state.topology].label} microphone delay started. ${pitchProcessorReady ? "Pitch processing active." : "Pitch processing unavailable; time processing remains active."}`;
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "Microphone could not be started.";
    $("audioError").hidden = false;
  } finally {
    state.starting = false;
    updateUi();
  }
}

function panic(message = "Panic stop. Microphone and every graph feedback tail are off.") {
  try { microphoneSource?.disconnect(); } catch { /* already disconnected */ }
  for (const track of mediaStream?.getTracks?.() ?? []) track.stop();
  mediaStream = null;
  microphoneSource = null;
  disconnectGraph();
  if (audioContext && audioContext.state !== "closed") void audioContext.close();
  audioContext = null;
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
  const entries = model.entries.length ? model.entries : [0];
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
      if (edge.from !== current) continue;
      arrivals[edge.to] = Math.min(arrivals[edge.to], earliest + edge.delaySeconds);
    }
  }
  return arrivals.map((arrival) => Number.isFinite(arrival) ? arrival : 0);
}

function drawVibratingEdge(from, to, edge, timestamp, startDelay = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const start = { x: from.x + ux * 9, y: from.y + uy * 9 };
  const end = { x: to.x - ux * 12, y: to.y - uy * 12 };
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
    const energy = state.mic
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

  if (edge.cyclic) {
    tracePath();
    context.strokeStyle = "#ff826f";
    context.globalAlpha = 0.2 + peakEnergy * 0.28;
    context.lineWidth = 2.2 + peakEnergy * 1.5;
    context.setLineDash([3, 5]);
    context.stroke();
    context.setLineDash([]);
  }

  tracePath();
  context.strokeStyle = edgeGradient;
  context.globalAlpha = 0.4 + peakEnergy * 0.52;
  context.lineWidth = 1.15 + peakEnergy * 2.6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = endColor;
  context.shadowBlur = peakEnergy * 15;
  context.stroke();
  context.shadowBlur = 0;

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
  context.fillStyle = edge.cyclic ? "#ff826f" : endColor;
  context.fill();
  context.globalAlpha = 1;
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
    drawVibratingEdge(
      points[edge.from],
      points[edge.to],
      edge,
      now,
      arrivalTimes[edge.from],
    );
  }
  for (const nodeId of exitNodeIds()) {
    drawTerminalRoute(
      points[nodeId],
      outputTerminal,
      "#e8c46b",
      now,
      terminalDelaySeconds(geometry.nodes[nodeId], endpointPosition("output")),
      arrivalTimes[nodeId],
    );
  }
  points.forEach((position, index) => {
    const energy = Math.min(1, currentLevel * 12);
    const pulse = energy * (0.3 + 0.7 * Math.max(0, Math.sin(now * 0.004 - index * 0.7)));
    context.beginPath();
    context.arc(position.x, position.y, 6 + pulse * 7, 0, Math.PI * 2);
    context.fillStyle = index === selectedNodeId ? "#fff3d6" : "#0a1113";
    context.fill();
    context.strokeStyle = index === selectedNodeId
      ? "#fff3d6"
      : EDGE_COLORS[index % EDGE_COLORS.length];
    context.globalAlpha = 0.62 + pulse * 0.38;
    context.lineWidth = 1.4 + pulse * 1.8;
    context.shadowColor = EDGE_COLORS[index % EDGE_COLORS.length];
    context.shadowBlur = pulse * 15;
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
    context.fillStyle = index === selectedNodeId ? "#071011" : "#8ca1a5";
    context.font = "7px ui-monospace, monospace";
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
  if (audioGraph?.analyser && state.mic) {
    audioGraph.analyser.getFloatTimeDomainData(inputWave);
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

function updateUi() {
  const preset = GRAPH_PRESETS[state.topology];
  const geometry = geometryModel();
  const cycleEdges = model.edges.filter((edge) => edge.cyclic).length;
  const selectedPitchHz = nodePitchTargetHz(selectedNodeId, geometry);
  const selectedAngle = nodeRelationAngle(selectedNodeId, geometry) * 180 / Math.PI;
  const selectedEdges = edgeAudioParameters(geometry, state)
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
  $("topologyDescription").textContent = preset.description;
  $("topologySummary").textContent = `${preset.label} · ${model.cyclic ? "cyclic" : "acyclic"}`;
  $("motionSummary").textContent = `nodes ${state.nodeMoving ? `${state.nodeMotionMode} playing` : "paused"} · mic ${state.micMoving ? `${state.micMotionMode} playing` : "paused"}`;
  $("delaySummary").textContent = `length → ${state.baseDelay}–${state.baseDelay + state.timeScale} ms · angle → ${state.pitchFloor}–${state.pitchCeiling} Hz`;
  $("mixSummary").textContent = `${percent(state.wet)} graph · ${percent(state.dry)} direct`;
  $("structureReadout").textContent = `${model.nodes.length} nodes · ${model.edges.length} edges`;
  $("cycleReadout").textContent = model.cyclic ? `${cycleEdges} feedback edges · bounded` : "none · finite tail";
  $("stageReadout").textContent = `MIC IN → ${preset.label.toUpperCase()} → SPEAKERS OUT · ${model.nodes.length} NODES · ${model.cyclic ? "FEEDBACK BOUNDED" : "ACYCLIC"}`;
  $("feedback").disabled = !model.cyclic;
  $("feedbackSafetyNote").textContent = model.cyclic
    ? `Feedback is divided across each cycle's incoming edges; every return sum is capped at ${percent(state.feedback)} (< 100%), then damped, compressed, and soft-clipped.`
    : "This graph is acyclic, so the feedback control is dormant. Cyclic presets normalize all returning gains below unity.";
  canvas.setAttribute("aria-label", `${preset.label}, ${model.nodes.length} nodes and ${model.edges.length} directed edges. ${model.cyclic ? "Bounded cyclic feedback." : "Acyclic."} Microphone ${audioLabel}.`);
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
  $("inputPitchReferenceOut").textContent = `${state.inputPitchReference} Hz`;
  $("pitchFloorOut").textContent = `${state.pitchFloor} Hz`;
  $("pitchCeilingOut").textContent = `${state.pitchCeiling} Hz`;
  $("selectedNodeOut").textContent = `node ${selectedNodeId + 1} · ${Math.round(selectedPitchHz)} Hz · ${Math.round(selectedAngle)}° incoming`;
  $("selectedTimeOut").textContent = selectedTimes.length
    ? `${Math.min(...selectedTimes)}–${Math.max(...selectedTimes)} ms · ${selectedTimes.length} edges`
    : "no connected edges";
  $("feedbackOut").textContent = percent(state.feedback);
  $("dampingOut").textContent = state.damping >= 1000 ? `${(state.damping / 1000).toFixed(1)} kHz` : `${state.damping} Hz`;
  $("wetOut").textContent = percent(state.wet);
  $("dryOut").textContent = percent(state.dry);
  $("spreadOut").textContent = percent(state.spread);
}

function bindRange(id, property, { graph = false, audio = true } = {}) {
  const control = $(id);
  control.addEventListener("input", (event) => {
    state[property] = Number(event.currentTarget.value);
    if (id === "inputTrim" && audioGraph?.inputTrimNode && audioContext) {
      audioGraph.inputTrimNode.gain.setTargetAtTime(state.inputTrim, audioContext.currentTime, 0.02);
    } else if (graph) {
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
  if (!draggingTerminal) return;
  const x = Math.max(0.01, Math.min(0.99, (position.x - 56) / Math.max(1, cssWidth - 102)));
  const y = Math.max(0.02, Math.min(0.98, (position.y - 34) / Math.max(1, cssHeight - 68)));
  if (draggingTerminal === "input") {
    state.inputX = x;
    state.inputY = y;
  } else {
    state.outputX = x;
    state.outputY = y;
  }
  applyAudioParameters();
  updateUi();
}

canvas.addEventListener("pointerdown", (event) => {
  const position = canvasPointer(event);
  for (const kind of ["input", "output"]) {
    const terminal = point(endpointPosition(kind));
    if (Math.hypot(terminal.x - position.x, terminal.y - position.y) <= 28) {
      event.preventDefault();
      draggingTerminal = kind;
      if (kind === "input") state.micMoving = false;
      draggingNodeId = null;
      canvas.classList.add("is-dragging");
      canvas.setPointerCapture?.(event.pointerId);
      canvas.focus({ preventScroll: true });
      updateUi();
      return;
    }
  }
  let closest = null;
  for (const node of geometryModel().nodes) {
    const projected = point(node);
    const distance = Math.hypot(projected.x - position.x, projected.y - position.y);
    if (distance <= 19 && (!closest || distance < closest.distance)) {
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
  if (draggingNodeId === null || draggingNodeId !== selectedNodeId) return;
  event.preventDefault();
  moveSelectedNode(canvasPointer(event));
});

function finishNodeDrag(event) {
  if (draggingNodeId === null && !draggingTerminal) return;
  canvas.releasePointerCapture?.(event.pointerId);
  const terminal = draggingTerminal;
  draggingNodeId = null;
  draggingTerminal = null;
  canvas.classList.remove("is-dragging");
  $("liveStatus").textContent = terminal
    ? `${terminal === "input" ? "Microphone input" : "Speaker output"} terminal moved; route time${terminal === "output" ? " and output pan" : ""} updated.`
    : `Node ${selectedNodeId + 1} moved to ${Math.round(nodePitchTargetHz(selectedNodeId))} hertz; connected edge times updated.`;
}

canvas.addEventListener("pointerup", finishNodeDrag);
canvas.addEventListener("pointercancel", finishNodeDrag);
canvas.addEventListener("keydown", (event) => {
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

$("topology").addEventListener("change", (event) => {
  cancelScheduledGraphRebuild();
  state.topology = event.currentTarget.value;
  rebuildModel();
});
$("newGraphButton").addEventListener("click", () => {
  cancelScheduledGraphRebuild();
  state.seed = state.seed >= 99 ? 1 : state.seed + 1;
  $("seed").value = String(state.seed);
  rebuildModel();
});
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
  state.outputX = 0.965;
  state.outputY = 0.5;
  applyAudioParameters();
  updateUi();
  $("liveStatus").textContent = "Node motion stopped; microphone input and speaker output positions reset.";
});
bindRange("level", "level");
bindRange("inputTrim", "inputTrim");
bindRange("nodeCount", "nodeCount", { graph: true });
bindRange("density", "density", { graph: true });
bindRange("seed", "seed", { graph: true });
bindRange("nodeMotionSpeed", "nodeMotionSpeed", { audio: false });
bindRange("nodeMotionAmount", "nodeMotionAmount");
bindRange("micMotionSpeed", "micMotionSpeed", { audio: false });
bindRange("baseDelay", "baseDelay");
bindRange("timeScale", "timeScale");
bindRange("inputPitchReference", "inputPitchReference");
bindRange("pitchFloor", "pitchFloor");
bindRange("pitchCeiling", "pitchCeiling");
bindRange("feedback", "feedback");
bindRange("damping", "damping");
bindRange("wet", "wet");
bindRange("dry", "dry");
bindRange("spread", "spread");
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
