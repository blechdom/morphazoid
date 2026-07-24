import {
  GRAPH_PRESETS,
  edgeAudioParameters,
  generateGraph,
} from "./src/graph-delay.js?v=20260724-motion-endpoints";

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
  baseDelay: 24,
  timeScale: 900,
  pitchRange: 12,
  rotation: 0,
  rotationSpeed: 0.05,
  rotating: false,
  inputX: 0.035,
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
const ENVELOPE_HISTORY_CAPACITY = 4_096;
const envelopeTimes = new Float64Array(ENVELOPE_HISTORY_CAPACITY);
const envelopeValues = new Float32Array(ENVELOPE_HISTORY_CAPACITY);
let envelopeHead = 0;
let envelopeLength = 0;

function rotatePosition(position, degrees = state.rotation) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = position.x - 0.5;
  const y = position.y - 0.5;
  return {
    ...position,
    x: 0.5 + x * cosine - y * sine,
    y: 0.5 + x * sine + y * cosine,
  };
}

function geometryModel() {
  return {
    ...model,
    nodes: model.nodes.map((node) => rotatePosition(node)),
  };
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

function geometricDelaySeconds(from, to) {
  const normalizedLength = Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / Math.SQRT2);
  return Math.min(2, (state.baseDelay + normalizedLength * state.timeScale) / 1_000);
}

function nodePitchSemitones(nodeId) {
  const geometry = geometryModel();
  const node = geometry.nodes[nodeId];
  if (!node) return 0;
  const incoming = geometry.edges.filter((edge) => edge.to === nodeId);
  const sourceHeight = incoming.length
    ? incoming.reduce((sum, edge) => sum + geometry.nodes[edge.from].y, 0) / incoming.length
    : state.inputY;
  return Math.max(
    -24,
    Math.min(24, (sourceHeight - node.y) * 2 * state.pitchRange),
  );
}

async function preparePitchProcessor(audio) {
  if (pitchProcessorAttempted) return pitchProcessorReady;
  pitchProcessorAttempted = true;
  if (!audio.audioWorklet?.addModule || !globalThis.AudioWorkletNode) return false;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/graph-pitch-processor.js?v=20260724-motion-endpoints", import.meta.url),
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

function disconnectGraph() {
  if (!audioGraph) return;
  for (const node of audioGraph.disconnectables) {
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
  audioGraph = null;
}

function buildAudioGraph(audio) {
  const input = audio.createGain();
  const dry = audio.createGain();
  const wet = audio.createGain();
  const output = audio.createGain();
  const analyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const clipper = audio.createWaveShaper();
  const geometry = geometryModel();
  const parameters = edgeAudioParameters(geometry, state);
  const exits = exitNodeIds();
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
  output.gain.value = state.level;

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
    tap.gain.value = 0.78 / Math.sqrt(exits.length);
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
    delay.delayTime.value = geometricDelaySeconds(endpointPosition("input"), geometry.nodes[nodeId]);
    gain.gain.value = 1 / Math.sqrt(entries.length);
    input.connect(delay).connect(gain).connect(nodes[nodeId].sum);
    return { nodeId, delay, gain };
  });
  const outputRoutes = exits.map((nodeId) => {
    const delay = audio.createDelay(2.2);
    delay.delayTime.value = geometricDelaySeconds(geometry.nodes[nodeId], endpointPosition("output"));
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
      geometricDelaySeconds(endpointPosition("input"), geometry.nodes[route.nodeId]),
      now,
      0.035,
    );
  }
  for (const route of audioGraph.outputRoutes) {
    route.delay.delayTime.setTargetAtTime(
      geometricDelaySeconds(geometry.nodes[route.nodeId], endpointPosition("output")),
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

function connectMicrophoneToGraph() {
  if (!microphoneSource || !audioGraph || !audioContext) return;
  const trim = audioContext.createGain();
  trim.gain.value = state.inputTrim;
  microphoneSource.connect(trim).connect(audioGraph.input);
  audioGraph.inputTrimNode = trim;
  audioGraph.disconnectables.push(trim);
}

function rebuildModel({ rebuildAudio = true } = {}) {
  model = generateGraph({ ...state, type: state.topology });
  selectedNodeId = Math.min(selectedNodeId, model.nodes.length - 1);
  if (rebuildAudio && audioContext && audioGraph) {
    const wasConnected = Boolean(microphoneSource);
    try { microphoneSource?.disconnect(); } catch { /* already disconnected */ }
    disconnectGraph();
    audioGraph = buildAudioGraph(audioContext);
    if (wasConnected) connectMicrophoneToGraph();
  }
  updateUi();
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

function drawVibratingEdge(from, to, edge, timestamp) {
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
  const maximumOffset = Math.max(1.5, Math.min(9, distance * 0.055));
  const now = timestamp / 1_000;
  const points = [];
  let peakEnergy = 0;

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const energy = state.mic
      ? Math.min(1, envelopeAt(now - edge.delaySeconds * progress) * 8)
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
    context.lineWidth = 6 + peakEnergy * 3;
    context.setLineDash([3, 5]);
    context.stroke();
    context.setLineDash([]);
  }

  tracePath();
  context.strokeStyle = edgeGradient;
  context.globalAlpha = 0.48 + peakEnergy * 0.46;
  context.lineWidth = 3.4 + peakEnergy * 4.6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();

  if (peakEnergy > 0.018) {
    tracePath();
    context.strokeStyle = "#fff3d6";
    context.globalAlpha = peakEnergy * 0.62;
    context.lineWidth = 1.15 + peakEnergy * 1.8;
    context.stroke();
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

function drawTerminalRoute(from, to, color, timestamp, delaySeconds) {
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
    const energy = state.mic
      ? Math.min(1, envelopeAt(now - delaySeconds * progress) * 8)
      : 0;
    peak = Math.max(peak, energy);
    const offset = Math.sin(Math.PI * progress)
      * Math.sin(timestamp * 0.012 + progress * Math.PI * 5)
      * energy * Math.min(8, distance * 0.05);
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
  context.lineWidth = 4 + peak * 4;
  context.lineCap = "round";
  context.stroke();
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

function draw(now) {
  context.clearRect(0, 0, cssWidth, cssHeight);
  const geometry = geometryModel();
  const points = geometry.nodes.map(point);
  const inputTerminal = point(endpointPosition("input"));
  const outputTerminal = point(endpointPosition("output"));
  const edgeParameters = edgeAudioParameters(geometry, state);
  const entries = model.entries.length ? model.entries : [0];
  for (const nodeId of entries) {
    drawTerminalRoute(
      inputTerminal,
      points[nodeId],
      "#55d9ff",
      now,
      geometricDelaySeconds(endpointPosition("input"), geometry.nodes[nodeId]),
    );
  }
  for (const edge of edgeParameters) {
    drawVibratingEdge(points[edge.from], points[edge.to], edge, now);
  }
  for (const nodeId of exitNodeIds()) {
    drawTerminalRoute(
      points[nodeId],
      outputTerminal,
      "#e8c46b",
      now,
      geometricDelaySeconds(geometry.nodes[nodeId], endpointPosition("output")),
    );
  }
  points.forEach((position, index) => {
    const energy = Math.min(1, currentLevel * 7);
    const pulse = energy * (0.3 + 0.7 * Math.max(0, Math.sin(now * 0.004 - index * 0.7)));
    context.beginPath();
    context.arc(position.x, position.y, 5.5 + pulse * 4, 0, Math.PI * 2);
    context.fillStyle = index === selectedNodeId ? "#fff3d6" : "#0a1113";
    context.fill();
    context.strokeStyle = index === selectedNodeId
      ? "#fff3d6"
      : EDGE_COLORS[index % EDGE_COLORS.length];
    context.globalAlpha = 0.62 + pulse * 0.38;
    context.lineWidth = 1.2;
    context.stroke();
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
  if (state.rotating && Math.abs(state.rotationSpeed) > 0.0001) {
    state.rotation += state.rotationSpeed * 360 * motionDelta;
    if (state.rotation > 180) state.rotation -= 360;
    if (state.rotation < -180) state.rotation += 360;
    $("rotation").value = String(state.rotation);
    $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
    $("motionSummary").textContent = `rotation playing · ${Math.round(state.rotation)}°`;
    if (now - lastMotionAudioUpdate > 50) {
      applyAudioParameters();
      lastMotionAudioUpdate = now;
    }
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
  const selectedPitch = nodePitchSemitones(selectedNodeId);
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
  $("motionSummary").textContent = `rotation ${state.rotating ? "playing" : "paused"} · ${Math.round(state.rotation)}°`;
  $("delaySummary").textContent = `length → ${state.baseDelay}–${state.baseDelay + state.timeScale} ms · height → ±${state.pitchRange} st`;
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
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
  $("rotationSpeedOut").textContent = `${state.rotationSpeed >= 0 ? "+" : ""}${state.rotationSpeed.toFixed(2)} rev/s`;
  $("rotationPlayButton").setAttribute("aria-pressed", String(state.rotating));
  $("rotationPlayButton").setAttribute("aria-label", state.rotating ? "Pause graph rotation" : "Play graph rotation");
  $("timeScaleOut").textContent = `+${state.timeScale} ms across stage`;
  $("pitchRangeOut").textContent = `±${state.pitchRange} semitones`;
  $("selectedNodeOut").textContent = `node ${selectedNodeId + 1} · ${selectedPitch >= 0 ? "+" : ""}${selectedPitch.toFixed(1)} st`;
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
  $(id).addEventListener("input", (event) => {
    state[property] = Number(event.currentTarget.value);
    if (id === "inputTrim" && audioGraph?.inputTrimNode && audioContext) {
      audioGraph.inputTrimNode.gain.setTargetAtTime(state.inputTrim, audioContext.currentTime, 0.02);
    } else if (graph) {
      rebuildModel();
      return;
    } else if (audio) {
      applyAudioParameters();
    }
    updateUi();
  });
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
  const unrotated = rotatePosition(displayed, -state.rotation);
  node.x = Math.max(0.02, Math.min(0.98, unrotated.x));
  node.y = Math.max(0.02, Math.min(0.98, unrotated.y));
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
      draggingNodeId = null;
      canvas.classList.add("is-dragging");
      canvas.setPointerCapture?.(event.pointerId);
      canvas.focus({ preventScroll: true });
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
    : `Node ${selectedNodeId + 1} moved to ${nodePitchSemitones(selectedNodeId).toFixed(1)} semitones; connected edge times updated.`;
}

canvas.addEventListener("pointerup", finishNodeDrag);
canvas.addEventListener("pointercancel", finishNodeDrag);
canvas.addEventListener("keydown", (event) => {
  const movement = event.shiftKey ? 0.05 : 0.01;
  const node = model.nodes[selectedNodeId];
  if (!node || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowLeft") node.x = Math.max(0.02, node.x - movement);
  if (event.key === "ArrowRight") node.x = Math.min(0.98, node.x + movement);
  if (event.key === "ArrowUp") node.y = Math.max(0.02, node.y - movement);
  if (event.key === "ArrowDown") node.y = Math.min(0.98, node.y + movement);
  applyAudioParameters();
  updateUi();
});

$("topology").addEventListener("change", (event) => {
  state.topology = event.currentTarget.value;
  rebuildModel();
});
$("newGraphButton").addEventListener("click", () => {
  state.seed = state.seed >= 99 ? 1 : state.seed + 1;
  $("seed").value = String(state.seed);
  rebuildModel();
});
$("rotationPlayButton").addEventListener("click", () => {
  state.rotating = !state.rotating;
  lastMotionFrame = performance.now();
  updateUi();
});
$("resetViewButton").addEventListener("click", () => {
  state.rotation = 0;
  state.rotating = false;
  state.inputX = 0.035;
  state.inputY = 0.5;
  state.outputX = 0.965;
  state.outputY = 0.5;
  applyAudioParameters();
  updateUi();
  $("liveStatus").textContent = "Graph rotation, microphone input, and speaker output positions reset.";
});
bindRange("level", "level");
bindRange("inputTrim", "inputTrim");
bindRange("nodeCount", "nodeCount", { graph: true });
bindRange("density", "density", { graph: true });
bindRange("seed", "seed", { graph: true });
bindRange("rotation", "rotation");
bindRange("rotationSpeed", "rotationSpeed", { audio: false });
bindRange("baseDelay", "baseDelay");
bindRange("timeScale", "timeScale");
bindRange("pitchRange", "pitchRange");
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
