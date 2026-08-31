// Persistent visual/state DSP runs as ordered GPU passes between two ordinary
// graph evaluations. The first graph pass exposes every node's current chunk
// in graph_signals. Each active state node consumes its connected upstream
// signal, writes one vec2 per sample to state_output, and the graph is
// reevaluated so later nodes see the result. All intermediate data remains on
// the GPU; the audio runtime still performs one final PCM copy/map per chunk.

const freeze = (value) => Object.freeze(value);

export const SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_KINDS = freeze({
  cellularAutomatonScore: 105,
  reactionDiffusionLattice: 106,
  geometricFeedbackLattice: 107,
  spectralSdf: 108,
  flowFieldAdvection: 109,
  raymarchResonator: 110,
});

const STATE_KIND_SET = new Set(Object.values(SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_KINDS));
const RESET_PARAM_INDICES = freeze({
  105: freeze([3, 4]),
  106: freeze([7]),
  107: freeze([]),
  108: freeze([]),
  109: freeze([6]),
  110: freeze([]),
});

const CA_ROW_CELLS = 128;
const RD_GRID_CELLS = 32 * 32;
const FEEDBACK_GRID_CELLS = 32 * 32;
const SPECTRAL_RING_FRAMES = 2048;
const SPECTRAL_BANDS = 64;
const FLOW_PARTICLES = 256;
const RAY_MODES = 48;
const BYTES_PER_VEC4 = Float32Array.BYTES_PER_ELEMENT * 4;

export const SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_LIMITS = freeze({
  caCells: CA_ROW_CELLS,
  reactionDiffusionWidth: 32,
  reactionDiffusionHeight: 32,
  feedbackGridCells: FEEDBACK_GRID_CELLS,
  spectralFrames: SPECTRAL_RING_FRAMES,
  spectralBands: SPECTRAL_BANDS,
  flowParticles: FLOW_PARTICLES,
  rayModes: RAY_MODES,
});

export function isShaderSynthPlaygroundStateEngineKind(kind) {
  const numericKind = Number(kind);
  // Negative graph kinds are deliberately reserved for bypassed state nodes.
  // They remain in the graph but must own no persistent GPU resources.
  return numericKind > 0 && STATE_KIND_SET.has(numericKind);
}

function feedbackRingFrames(sampleRate) {
  // The public parameter reaches 180 ms. Two guard frames make every
  // interpolated/read position causal at the upper bound.
  return Math.max(4, Math.ceil(Number(sampleRate) * 0.18) + 2);
}

export function shaderSynthPlaygroundStatePersistentByteSize(kind, sampleRate = 44100) {
  let vec4Count = 1;
  switch (Number(kind)) {
    case 105:
      vec4Count += CA_ROW_CELLS * 2;
      break;
    case 106:
      vec4Count += RD_GRID_CELLS * 2;
      break;
    case 107:
      // Two scalar lattice surfaces plus a stereo circular delay. A vec4
      // stores the ring's current stereo sample and its damped predecessor.
      vec4Count += FEEDBACK_GRID_CELLS * 2 + feedbackRingFrames(sampleRate);
      break;
    case 108:
      // Streaming input/OLA ring plus a bounded bank of complex DFT bands.
      vec4Count += SPECTRAL_RING_FRAMES + SPECTRAL_BANDS;
      break;
    case 109:
      vec4Count += FLOW_PARTICLES * 2;
      break;
    case 110:
      vec4Count += RAY_MODES;
      break;
    default:
      return 0;
  }
  return Math.ceil((vec4Count * BYTES_PER_VEC4) / 16) * 16;
}

function spectralFftSizeFromParams(params = []) {
  const selector = Number(params[0] ?? 2);
  if (selector < 0.5) return 256;
  if (selector < 1.5) return 512;
  if (selector < 2.5) return 1024;
  return 2048;
}

function spectralSegmentCount(chunkSamples, fftSize) {
  // The first analysis can require a full window; every later boundary is at
  // most one half-window away. Two guard iterations cover either phase.
  return Math.ceil(Math.max(1, Number(chunkSamples)) / Math.max(128, fftSize / 2)) + 2;
}

function resetSignature(kind, params = []) {
  return (RESET_PARAM_INDICES[Number(kind)] ?? [])
    .map((index) => Number(params[index] ?? 0).toPrecision(9))
    .join(":");
}

/**
 * Resolve active state nodes in graph order without importing the registry.
 * This keeps the runtime helper independent of the page/catalog layer.
 */
export function shaderSynthPlaygroundStateEngineNodes(encoded) {
  if (!encoded?.data || !Array.isArray(encoded.order)) return [];
  const patchNodeById = new Map((encoded.patch?.nodes ?? []).map((node) => [node.id, node]));
  const result = [];
  encoded.order.forEach((id, nodeIndex) => {
    const kind = Math.round(Number(encoded.data[nodeIndex * 20] ?? 0));
    if (!isShaderSynthPlaygroundStateEngineKind(kind)) return;
    result.push({
      id,
      kind,
      nodeIndex,
      params: [...(encoded.paramsByNode?.get(id) ?? [])],
      graphNode: patchNodeById.get(id) ?? null,
    });
  });
  return result;
}

export const SHADER_SYNTH_PLAYGROUND_STATE_SHADER = /* wgsl */ `
override SAMPLE_RATE: f32 = 44100.0;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const MAX_CA_CELLS: u32 = 128u;
const RD_SIDE: u32 = 32u;
const RD_CELLS: u32 = 1024u;
const MAX_FEEDBACK_SIDE: u32 = 32u;
const FEEDBACK_CELLS: u32 = 1024u;
const MAX_SPECTRAL_FRAMES: u32 = 2048u;
const SPECTRAL_BANDS: u32 = 64u;
const MAX_FLOW_PARTICLES: u32 = 256u;
const MAX_RAY_MODES: u32 = 48u;

struct RenderInfo {
  baseSample: u32,
  nodeCount: u32,
  outputIndex: u32,
  sampleCount: u32,
  rampActive: u32,
  performancePitch: f32,
  organRampActive: u32,
  stateActive: u32,
}

struct GraphNode {
  header: vec4<f32>,
  previous0: vec4<f32>,
  previous1: vec4<f32>,
  target0: vec4<f32>,
  target1: vec4<f32>,
}

struct StateStageInfo {
  nodeIndex: u32,
  kind: u32,
  fftSize: u32,
  spectralSegments: u32,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read> graph_nodes: array<GraphNode>;
@group(0) @binding(2) var<storage, read> graph_signals: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> state_output: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> persistent_state: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> state_stage: StateStageInfo;
var<private> state_lane: u32;

fn hashU32(value: u32) -> f32 {
  var word = value;
  word = word ^ (word >> 16u);
  word = word * 0x7feb352du;
  word = word ^ (word >> 15u);
  word = word * 0x846ca68bu;
  word = word ^ (word >> 16u);
  return f32(word) * 2.3283064365386963e-10;
}

fn softClip(value: vec2<f32>) -> vec2<f32> {
  return value / (vec2<f32>(1.0) + abs(value));
}

fn smootherstep01(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn transitionRamp(sample: u32) -> f32 {
  if (render_info.rampActive == 0u && render_info.organRampActive == 0u) { return 1.0; }
  let transitionSamples = min(
    max(render_info.sampleCount, 1u) - 1u,
    max(u32(round(SAMPLE_RATE * 0.035)), 1u)
  );
  return smootherstep01(f32(min(sample, transitionSamples)) / f32(max(transitionSamples, 1u)));
}

fn params0(node: GraphNode, sample: u32) -> vec4<f32> {
  return mix(node.previous0, node.target0, transitionRamp(sample));
}

fn params1(node: GraphNode, sample: u32) -> vec4<f32> {
  return mix(node.previous1, node.target1, transitionRamp(sample));
}

fn stateInput(node: GraphNode, inputIndex: u32, sample: u32) -> vec2<f32> {
  var encoded = node.header.y;
  if (inputIndex == 1u) { encoded = node.header.z; }
  if (inputIndex == 2u) { encoded = node.header.w; }
  let slot = u32(max(round(abs(encoded)), 0.0));
  if (slot == 0u || slot > render_info.nodeCount) { return vec2<f32>(0.0); }
  let value = graph_signals[(slot - 1u) * render_info.sampleCount + sample];
  if (encoded < 0.0) { return vec2<f32>(value.y); }
  return value;
}

fn writeStateSample(sample: u32, value: vec2<f32>) {
  // Packed control modules use x for semitone/coordinate values and y for a
  // gate. Clipping here would turn a 24-semitone CA pitch into ~0.96. Audio
  // state renderers apply their own bounded output stage before this write.
  state_output[state_stage.nodeIndex * render_info.sampleCount + sample] = value;
}

fn resetPersistentState() {
  for (var index = 0u; index < arrayLength(&persistent_state); index += 1u) {
    persistent_state[index] = vec4<f32>(0.0);
  }
}

fn stateIsContinuous() -> bool {
  let header = persistent_state[0];
  return header.z > 0.5 && bitcast<u32>(header.x) == render_info.baseSample;
}

fn markStateContinuous(header: vec4<f32>) {
  var next = header;
  next.x = bitcast<f32>(render_info.baseSample + render_info.sampleCount);
  next.z = 1.0;
  persistent_state[0] = next;
}

fn wrappedIndex(value: i32, size: u32) -> u32 {
  let span = i32(max(size, 1u));
  return u32((value % span + span) % span);
}

fn scalePitch(degree: u32, scale: u32) -> f32 {
  if (scale == 0u) { return f32(degree); }
  if (scale == 1u) {
    let values = array<f32, 7>(0.0, 2.0, 4.0, 5.0, 7.0, 9.0, 11.0);
    return f32(degree / 7u) * 12.0 + values[degree % 7u];
  }
  if (scale == 2u) {
    let values = array<f32, 7>(0.0, 2.0, 3.0, 5.0, 7.0, 8.0, 10.0);
    return f32(degree / 7u) * 12.0 + values[degree % 7u];
  }
  if (scale == 3u) {
    let values = array<f32, 5>(0.0, 3.0, 5.0, 7.0, 10.0);
    return f32(degree / 5u) * 12.0 + values[degree % 5u];
  }
  if (scale == 4u) { return f32(degree) * 2.0; }
  if (scale == 5u) {
    let values = array<f32, 8>(0.0, 2.0, 3.0, 5.0, 6.0, 8.0, 9.0, 11.0);
    return f32(degree / 8u) * 12.0 + values[degree % 8u];
  }
  return f32(degree) * 0.5;
}

fn caCell(bank: u32, index: u32) -> u32 {
  return select(0u, 1u, persistent_state[1u + bank * MAX_CA_CELLS + index].x > 0.5);
}

fn writeCaCell(bank: u32, index: u32, value: u32) {
  persistent_state[1u + bank * MAX_CA_CELLS + index] = vec4<f32>(f32(value), 0.0, 0.0, 0.0);
}

fn renderCellularAutomaton(node: GraphNode) {
  if (!stateIsContinuous()) {
    resetPersistentState();
    let seed = u32(round(abs(node.target0.w)));
    let cells = u32(clamp(round(node.target0.z), 8.0, f32(MAX_CA_CELLS)));
    let density = clamp(node.target1.x, 0.01, 0.99);
    for (var cell = 0u; cell < MAX_CA_CELLS; cell += 1u) {
      let alive = select(0u, 1u, cell < cells && hashU32(seed ^ (cell * 0x9e3779b9u)) < density);
      writeCaCell(0u, cell, alive);
      writeCaCell(1u, cell, alive);
    }
    var initialHeader = persistent_state[0];
    initialHeader.y = bitcast<f32>(0u);
    initialHeader.w = 0.0;
    persistent_state[0] = initialHeader;
  }

  var header = persistent_state[0];
  let packedGeneration = bitcast<u32>(header.y);
  var bank = packedGeneration & 1u;
  var generation = packedGeneration >> 1u;
  var generationPhase = clamp(header.w, 0.0, 0.999999);
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let rate = clamp(p0.x, 0.1, 32.0);
    let cells = u32(clamp(round(p0.z), 8.0, f32(MAX_CA_CELLS)));
    let rule = u32(clamp(round(p0.y), 0.0, 255.0));
    generationPhase += rate / SAMPLE_RATE;
    while (generationPhase >= 1.0) {
      let destination = 1u - bank;
      for (var cell = 0u; cell < MAX_CA_CELLS; cell += 1u) {
        if (cell >= cells) {
          writeCaCell(destination, cell, 0u);
          continue;
        }
        let left = caCell(bank, (cell + cells - 1u) % cells);
        let center = caCell(bank, cell);
        let right = caCell(bank, (cell + 1u) % cells);
        let neighborhood = (left << 2u) | (center << 1u) | right;
        writeCaCell(destination, cell, (rule >> neighborhood) & 1u);
      }
      bank = destination;
      generation += 1u;
      generationPhase -= 1.0;
    }
    let stride = u32(clamp(round(p1.y), 1.0, 31.0));
    let readCell = (generation * stride) % cells;
    let alive = f32(caCell(bank, readCell));
    let phase = generationPhase;
    let gateEdge = min(0.08, max(rate * 8.0 / SAMPLE_RATE, 0.0001));
    let gate = alive * smootherstep01(phase / max(gateEdge, 0.0001))
      * smootherstep01((1.0 - phase) / max(gateEdge, 0.0001));
    let neighborhood = caCell(bank, (readCell + cells - 1u) % cells)
      + caCell(bank, readCell)
      + caCell(bank, (readCell + 1u) % cells);
    let octaves = u32(clamp(round(p1.w), 1.0, 4.0));
    let degree = (readCell + neighborhood * stride) % max(cells, 1u);
    let scale = u32(clamp(round(p1.z), 0.0, 6.0));
    let pitch = scalePitch(degree, scale) % (f32(octaves) * 12.0)
      + stateInput(node, 0u, sample).x;
    writeStateSample(sample, vec2<f32>(pitch, gate));
  }
  header = persistent_state[0];
  header.y = bitcast<f32>((generation << 1u) | bank);
  header.w = generationPhase;
  markStateContinuous(header);
}

fn rdIndex(bank: u32, x: i32, y: i32) -> u32 {
  let wrappedX = wrappedIndex(x, RD_SIDE);
  let wrappedY = wrappedIndex(y, RD_SIDE);
  return 1u + bank * RD_CELLS + wrappedY * RD_SIDE + wrappedX;
}

fn rdValue(bank: u32, x: i32, y: i32) -> vec2<f32> {
  return persistent_state[rdIndex(bank, x, y)].xy;
}

fn renderReactionDiffusion(node: GraphNode) {
  if (!stateIsContinuous()) {
    resetPersistentState();
    let seed = u32(round(abs(node.target1.w)));
    for (var cell = 0u; cell < RD_CELLS; cell += 1u) {
      let x = cell % RD_SIDE;
      let y = cell / RD_SIDE;
      let spot = hashU32(seed ^ (x * 0x9e3779b9u) ^ (y * 0x85ebca6bu));
      let center = abs(i32(x) - 16) < 3 && abs(i32(y) - 16) < 3;
      let b = select(0.0, 0.72 + spot * 0.24, center || spot > 0.965);
      let value = vec4<f32>(1.0 - b * 0.45, b, 0.0, 0.0);
      persistent_state[1u + cell] = value;
      persistent_state[1u + RD_CELLS + cell] = value;
    }
    var initialHeader = persistent_state[0];
    initialHeader.y = bitcast<f32>(0u);
    persistent_state[0] = initialHeader;
  }
  var header = persistent_state[0];
  let sourceBank = bitcast<u32>(header.y) & 1u;
  var evolvedBank = sourceBank;
  var destinationBank = 1u - evolvedBank;
  let p0 = node.target0;
  let p1 = node.target1;
  // Express evolution in elapsed sample time, not "one step per chunk", so
  // changing the runtime chunk duration does not change the chemical tempo.
  let chunkSeconds = f32(render_info.sampleCount) / SAMPLE_RATE;
  let substeps = u32(clamp(ceil(chunkSeconds / 0.1), 1.0, 8.0));
  let dt = clamp(p0.x, 0.0, 4.0) * 1.6 * chunkSeconds / f32(substeps);
  let feed = clamp(p0.y, 0.01, 0.09);
  let kill = clamp(p0.z, 0.03, 0.08);
  let diffusionA = clamp(p0.w, 0.1, 1.2);
  let diffusionB = clamp(p1.x, 0.05, 1.0);
  for (var step = 0u; step < 8u; step += 1u) {
    if (step >= substeps) { break; }
    for (var cell = 0u; cell < RD_CELLS; cell += 1u) {
      let x = i32(cell % RD_SIDE);
      let y = i32(cell / RD_SIDE);
      let current = rdValue(evolvedBank, x, y);
      let axis = rdValue(evolvedBank, x - 1, y) + rdValue(evolvedBank, x + 1, y)
        + rdValue(evolvedBank, x, y - 1) + rdValue(evolvedBank, x, y + 1);
      let diagonal = rdValue(evolvedBank, x - 1, y - 1) + rdValue(evolvedBank, x + 1, y - 1)
        + rdValue(evolvedBank, x - 1, y + 1) + rdValue(evolvedBank, x + 1, y + 1);
      let laplace = axis * 0.2 + diagonal * 0.05 - current;
      let reaction = current.x * current.y * current.y;
      let nextA = current.x + (diffusionA * laplace.x - reaction + feed * (1.0 - current.x)) * dt;
      let nextB = current.y + (diffusionB * laplace.y + reaction - (kill + feed) * current.y) * dt;
      persistent_state[1u + destinationBank * RD_CELLS + cell] = vec4<f32>(
        clamp(nextA, 0.0, 1.0), clamp(nextB, 0.0, 1.0), 0.0, 0.0
      );
    }
    evolvedBank = destinationBank;
    destinationBank = 1u - evolvedBank;
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p = params1(node, sample);
    let zoom = clamp(p.y, 0.25, 16.0);
    let coordinateX = fract(stateInput(node, 0u, sample).x * zoom * 0.5 + 0.5);
    let coordinateY = fract(stateInput(node, 1u, sample).x * zoom * 0.5 + 0.5);
    let x = i32(floor(coordinateX * f32(RD_SIDE)));
    let y = i32(floor(coordinateY * f32(RD_SIDE)));
    let oldValue = rdValue(sourceBank, x, y);
    let newValue = rdValue(evolvedBank, x, y);
    let value = mix(oldValue, newValue, smootherstep01(f32(sample) / f32(max(render_info.sampleCount - 1u, 1u))));
    let field = clamp((value.y - value.x * 0.35) * 2.2, -1.0, 1.0);
    let threshold = clamp(p.z, 0.02, 0.98);
    let gate = smoothstep(threshold - 0.035, threshold + 0.035, value.y);
    writeStateSample(sample, vec2<f32>(field, gate));
  }
  header = persistent_state[0];
  header.y = bitcast<f32>(evolvedBank);
  markStateContinuous(header);
}

fn feedbackCellIndex(bank: u32, cell: u32) -> u32 {
  return 1u + bank * FEEDBACK_CELLS + cell;
}

fn feedbackRingBase() -> u32 {
  return 1u + FEEDBACK_CELLS * 2u;
}

fn foldedCell(seed: u32, side: u32, folds: u32, rotation: f32) -> u32 {
  var x = f32(seed % side) / f32(side);
  var y = f32((seed / side) % side) / f32(side);
  let angle = rotation * TAU;
  let centered = vec2<f32>(x, y) - vec2<f32>(0.5);
  let rotated = vec2<f32>(
    centered.x * cos(angle) - centered.y * sin(angle),
    centered.x * sin(angle) + centered.y * cos(angle)
  );
  x = rotated.x + 0.5;
  y = rotated.y + 0.5;
  for (var fold = 0u; fold < 8u; fold += 1u) {
    if (fold >= folds) { break; }
    x = abs(fract(x * 2.0) * 2.0 - 1.0);
    y = abs(fract(y * 2.0 + x * 0.5) * 2.0 - 1.0);
  }
  let ix = min(u32(floor(fract(x) * f32(side))), side - 1u);
  let iy = min(u32(floor(fract(y) * f32(side))), side - 1u);
  return iy * side + ix;
}

fn renderFeedbackLattice(node: GraphNode) {
  if (!stateIsContinuous()) {
    resetPersistentState();
    var initialHeader = persistent_state[0];
    initialHeader.y = bitcast<f32>(0u);
    initialHeader.w = bitcast<f32>(0u);
    persistent_state[0] = initialHeader;
  }
  var header = persistent_state[0];
  let sourceBank = bitcast<u32>(header.y) & 1u;
  let destinationBank = 1u - sourceBank;
  var ringPosition = bitcast<u32>(header.w);
  let ringBase = feedbackRingBase();
  let ringFrames = max(arrayLength(&persistent_state) - ringBase, 4u);
  var energy = 0.0;
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let side = u32(clamp(round(p0.x), 2.0, f32(MAX_FEEDBACK_SIDE)));
    let cellCount = side * side;
    let delaySamples = u32(clamp(round(p0.y * 0.001 * SAMPLE_RATE), 1.0, f32(ringFrames - 2u)));
    let folds = u32(clamp(round(p1.x), 1.0, 8.0));
    var wet = vec2<f32>(0.0);
    var weight = 0.0;
    for (var tap = 0u; tap < 8u; tap += 1u) {
      let routeSeed = (render_info.baseSample + sample) / max(delaySamples, 1u) + tap * 37u;
      let cell = foldedCell(routeSeed, side, folds, p1.y);
      let cellState = persistent_state[feedbackCellIndex(sourceBank, cell)].x;
      let tapDelay = min(delaySamples * (tap + 1u) + u32(abs(cellState) * f32(delaySamples)), ringFrames - 2u);
      let readPosition = (ringPosition + ringFrames - tapDelay) % ringFrames;
      let history = persistent_state[ringBase + readPosition];
      let pan = f32(i32(cell % side) * 2 - i32(side - 1u)) / f32(max(side - 1u, 1u));
      let gain = (0.65 + 0.35 * cellState) / sqrt(f32(tap + 1u));
      let mono = (history.x + history.y) * 0.5;
      wet += mix(history.xy, vec2<f32>(mono * (1.0 - pan), mono * (1.0 + pan)), 0.55) * gain;
      weight += abs(gain);
    }
    wet /= max(weight, 1.0);
    let delayed = persistent_state[ringBase + (ringPosition + ringFrames - 1u) % ringFrames];
    let softened = mix(wet, (wet + delayed.xy) * 0.5, clamp(p1.z, 0.0, 1.0));
    let feedback = clamp(p0.z, 0.0, 0.985);
    let coupling = clamp(p0.w, 0.0, 1.0);
    let returned = softClip(input + mix(softened, wet.yx, coupling * 0.35) * feedback);
    persistent_state[ringBase + ringPosition] = vec4<f32>(returned, wet);
    ringPosition = (ringPosition + 1u) % ringFrames;
    energy += dot(abs(returned), vec2<f32>(0.5));
    writeStateSample(sample, softClip(mix(input, wet, clamp(p1.w, 0.0, 1.0))));
  }
  let targetParams = node.target0;
  let target1 = node.target1;
  let side = u32(clamp(round(targetParams.x), 2.0, f32(MAX_FEEDBACK_SIDE)));
  let cellCount = side * side;
  let blockEnergy = tanh(energy / f32(max(render_info.sampleCount, 1u)));
  for (var cell = 0u; cell < FEEDBACK_CELLS; cell += 1u) {
    if (cell >= cellCount) {
      persistent_state[feedbackCellIndex(destinationBank, cell)] = vec4<f32>(0.0);
      continue;
    }
    let x = cell % side;
    let y = cell / side;
    let left = y * side + (x + side - 1u) % side;
    let right = y * side + (x + 1u) % side;
    let up = ((y + side - 1u) % side) * side + x;
    let down = ((y + 1u) % side) * side + x;
    let current = persistent_state[feedbackCellIndex(sourceBank, cell)].x;
    let neighbors = (
      persistent_state[feedbackCellIndex(sourceBank, left)].x
      + persistent_state[feedbackCellIndex(sourceBank, right)].x
      + persistent_state[feedbackCellIndex(sourceBank, up)].x
      + persistent_state[feedbackCellIndex(sourceBank, down)].x
    ) * 0.25;
    let routed = mix(current, neighbors, clamp(targetParams.w, 0.0, 1.0));
    let folded = sin((routed + blockEnergy * hashU32(cell + render_info.baseSample)) * PI * max(target1.x, 1.0));
    let next = mix(folded, current, clamp(target1.z, 0.0, 1.0) * 0.82);
    persistent_state[feedbackCellIndex(destinationBank, cell)] = vec4<f32>(next, current, 0.0, 0.0);
  }
  header = persistent_state[0];
  header.y = bitcast<f32>(destinationBank);
  header.w = bitcast<f32>(ringPosition);
  markStateContinuous(header);
}

fn selectedFftSize(value: f32) -> u32 {
  if (value < 0.5) { return 256u; }
  if (value < 1.5) { return 512u; }
  if (value < 2.5) { return 1024u; }
  return 2048u;
}

fn spectralDistance(point: vec2<f32>, shape: u32, extent: f32) -> f32 {
  if (shape == 0u) { return length(point) - extent; }
  if (shape == 1u) { return max(abs(point.x), abs(point.y)) - extent; }
  if (shape == 2u) { return (abs(point.x) + abs(point.y)) * 0.70710678 - extent; }
  if (shape == 3u) { return abs(length(point) - extent) - extent * 0.22; }
  if (shape == 4u) { return min(max(abs(point.x), abs(point.y) * 0.3), max(abs(point.y), abs(point.x) * 0.3)) - extent; }
  let angle = atan2(point.y, point.x) / TAU;
  return abs(length(point) - fract(angle * 3.0 + 1.0) * extent) - extent * 0.14;
}

fn spectralDelayedInput(node: GraphNode, sample: u32, writePosition: u32, delay: u32) -> vec2<f32> {
  // Samples already rendered in this chunk are available directly from the
  // captured graph signal. Older samples remain in the persistent input ring.
  // Keeping the reads in a phase before ring writes avoids storage races when
  // a window-size crossfade uses two different delay lengths.
  if (sample >= delay) { return stateInput(node, 0u, sample - delay); }
  let readPosition = (writePosition + MAX_SPECTRAL_FRAMES - delay) % MAX_SPECTRAL_FRAMES;
  return persistent_state[1u + readPosition].xy;
}

fn renderSpectralSdf(node: GraphNode) {
  let lane = state_lane;
  let needsReset = !stateIsContinuous();
  if (needsReset) {
    for (var index = lane; index < arrayLength(&persistent_state); index += SPECTRAL_BANDS) {
      persistent_state[index] = vec4<f32>(0.0);
    }
  }
  storageBarrier();
  if (needsReset && lane == 0u) {
    persistent_state[0] = vec4<f32>(0.0, bitcast<f32>(0u), 0.0, bitcast<f32>(0u));
  }
  storageBarrier();

  var header = persistent_state[0];
  var writePosition = bitcast<u32>(header.y) % MAX_SPECTRAL_FRAMES;
  var samplesSeen = bitcast<u32>(header.w);
  var chunkCursor = 0u;
  let spectrumBase = 1u + MAX_SPECTRAL_FRAMES;
  let previousFftSize = selectedFftSize(node.previous0.x);
  // This selector is mirrored into the stage uniform by updatePatch. Unlike a
  // storage-buffer value, it is uniform for control-flow/barrier validation.
  let targetFftSize = clamp(state_stage.fftSize, 256u, MAX_SPECTRAL_FRAMES);
  let sizeChanged = previousFftSize != targetFftSize;
  let fftSize = targetFftSize;
  let hop = fftSize / 2u;

  // A fixed, CPU-derived number of segment iterations keeps every barrier in
  // uniform control flow. Inactive tail segments still cross the barriers but
  // perform no storage work.
  for (var segmentIndex = 0u; segmentIndex < state_stage.spectralSegments; segmentIndex += 1u) {
    var segmentCount = 0u;
    var completesAnalysisFrame = false;
    if (chunkCursor < render_info.sampleCount) {
      let remaining = render_info.sampleCount - chunkCursor;
      var untilAnalysis = fftSize - min(samplesSeen, fftSize);
      if (samplesSeen >= fftSize) {
        let remainder = samplesSeen % hop;
        untilAnalysis = select(hop - remainder, hop, remainder == 0u);
      }
      segmentCount = min(remaining, max(untilAnalysis, 1u));
      completesAnalysisFrame = segmentCount == max(untilAnalysis, 1u);
    }

    // First consume the existing dry/OLA ring into unique output slots. This
    // phase is read-only for persistent storage so dual-latency crossfades do
    // not race input writes elsewhere in the same segment.
    for (var localSample = lane; localSample < segmentCount; localSample += SPECTRAL_BANDS) {
      let sample = chunkCursor + localSample;
      let sampleWritePosition = (writePosition + localSample) % MAX_SPECTRAL_FRAMES;
      let p0 = params0(node, sample);
      let p1 = params1(node, sample);
      let ramp = transitionRamp(sample);
      var sizeRamp = ramp;
      let sizeParameterSpan = node.target0.x - node.previous0.x;
      if (abs(sizeParameterSpan) > 0.0001) {
        sizeRamp = clamp((p0.x - node.previous0.x) / sizeParameterSpan, 0.0, 1.0);
      }
      let alignedDry = mix(
        spectralDelayedInput(node, sample, sampleWritePosition, previousFftSize),
        spectralDelayedInput(node, sample, sampleWritePosition, targetFftSize),
        sizeRamp
      );
      let wet = persistent_state[1u + sampleWritePosition].zw;
      let wetTransition = select(1.0, smootherstep01(sizeRamp), sizeChanged);
      writeStateSample(sample, softClip(mix(
        alignedDry,
        wet * clamp(p1.w, 0.0, 1.5),
        clamp(p1.z, 0.0, 1.0) * wetTransition
      )));
    }
    storageBarrier();

    // Then ingest and clear the same unique ring slots in parallel.
    for (var localSample = lane; localSample < segmentCount; localSample += SPECTRAL_BANDS) {
      let sample = chunkCursor + localSample;
      let sampleWritePosition = (writePosition + localSample) % MAX_SPECTRAL_FRAMES;
      persistent_state[1u + sampleWritePosition] = vec4<f32>(stateInput(node, 0u, sample), 0.0, 0.0);
    }
    storageBarrier();

    chunkCursor += segmentCount;
    writePosition = (writePosition + segmentCount) % MAX_SPECTRAL_FRAMES;
    samplesSeen += segmentCount;

    // Exactly one lane owns each of the 64 bounded-DFT bands.
    if (completesAnalysisFrame && lane < SPECTRAL_BANDS) {
      let band = lane;
      let bin = u32(round(f32(band) * f32(fftSize / 2u) / f32(SPECTRAL_BANDS - 1u)));
      var coefficient = vec4<f32>(0.0);
      let phaseStep = -TAU * f32(bin) / f32(fftSize);
      let phaseRotation = vec2<f32>(cos(phaseStep), sin(phaseStep));
      let windowStep = TAU / f32(max(fftSize - 1u, 1u));
      let windowRotation = vec2<f32>(cos(windowStep), sin(windowStep));
      var phaseBasis = vec2<f32>(1.0, 0.0);
      var windowBasis = vec2<f32>(1.0, 0.0);
      for (var n = 0u; n < MAX_SPECTRAL_FRAMES; n += 1u) {
        if (n >= fftSize) { break; }
        let readPosition = (writePosition + MAX_SPECTRAL_FRAMES - 1u - n) % MAX_SPECTRAL_FRAMES;
        let frameSample = persistent_state[1u + readPosition].xy;
        let window = 0.5 - 0.5 * windowBasis.x;
        let basis = phaseBasis * window;
        coefficient += vec4<f32>(frameSample.x * basis, frameSample.y * basis);
        phaseBasis = vec2<f32>(
          phaseBasis.x * phaseRotation.x - phaseBasis.y * phaseRotation.y,
          phaseBasis.x * phaseRotation.y + phaseBasis.y * phaseRotation.x
        );
        windowBasis = vec2<f32>(
          windowBasis.x * windowRotation.x - windowBasis.y * windowRotation.y,
          windowBasis.x * windowRotation.y + windowBasis.y * windowRotation.x
        );
      }
      coefficient /= f32(fftSize);
      let magnitude = tanh((length(coefficient.xy) + length(coefficient.zw)) * 3.0);
      let frameCoordinate = fract(f32(samplesSeen / hop) * 0.037) * 2.0 - 1.0;
      var point = vec2<f32>(f32(bin) / f32(fftSize / 2u) * 2.0 - 1.0, frameCoordinate + magnitude * 0.3);
      let eventSample = max(chunkCursor, 1u) - 1u;
      let p0 = params0(node, eventSample);
      let p1 = params1(node, eventSample);
      let angle = p0.w * TAU;
      point = vec2<f32>(point.x * cos(angle) - point.y * sin(angle), point.x * sin(angle) + point.y * cos(angle));
      let distance = spectralDistance(point, u32(clamp(round(p0.y), 0.0, 5.0)), clamp(p0.z, 0.03, 1.5));
      let edge = clamp(p1.x, 0.001, 0.35);
      let inside = 1.0 - smoothstep(-edge, edge, distance);
      let signedDepth = clamp(p1.y, -1.0, 1.0);
      let mask = clamp(1.0 - abs(signedDepth) + select(1.0 - inside, inside, signedDepth >= 0.0) * abs(signedDepth), 0.0, 1.0);
      persistent_state[spectrumBase + band] = coefficient * mask;
    }
    storageBarrier();

    // Lanes own disjoint future OLA slots. Each sums the full band bank for
    // its n values, avoiding atomics while retaining all 64 bands.
    if (completesAnalysisFrame) {
      for (var n = lane; n < MAX_SPECTRAL_FRAMES; n += SPECTRAL_BANDS) {
        if (n >= fftSize) { break; }
        var resynth = vec2<f32>(0.0);
        for (var band = 0u; band < SPECTRAL_BANDS; band += 1u) {
          let bin = u32(round(f32(band) * f32(fftSize / 2u) / f32(SPECTRAL_BANDS - 1u)));
          let coefficient = persistent_state[spectrumBase + band];
          let angle = TAU * f32(bin * n) / f32(fftSize);
          let basis = vec2<f32>(cos(angle), -sin(angle));
          resynth += vec2<f32>(dot(coefficient.xy, basis), dot(coefficient.zw, basis));
        }
        let window = 0.5 - 0.5 * cos(TAU * f32(n) / f32(max(fftSize - 1u, 1u)));
        let outputPosition = (writePosition + n) % MAX_SPECTRAL_FRAMES;
        let stored = persistent_state[1u + outputPosition];
        persistent_state[1u + outputPosition] = vec4<f32>(stored.xy, stored.zw + resynth * window * 2.0);
      }
    }
    storageBarrier();
  }

  if (lane == 0u) {
    header = persistent_state[0];
    header.y = bitcast<f32>(writePosition);
    header.w = bitcast<f32>(samplesSeen);
    markStateContinuous(header);
  }
}

fn flowIndex(bank: u32, particle: u32) -> u32 {
  return 1u + bank * MAX_FLOW_PARTICLES + particle;
}

fn renderFlowAdvection(node: GraphNode) {
  if (!stateIsContinuous()) {
    resetPersistentState();
    let seed = u32(round(abs(node.target1.z)));
    for (var particle = 0u; particle < MAX_FLOW_PARTICLES; particle += 1u) {
      let position = vec2<f32>(
        hashU32(seed ^ (particle * 0x9e3779b9u)),
        hashU32((seed + 17u) ^ (particle * 0x85ebca6bu))
      ) * 2.0 - vec2<f32>(1.0);
      let value = vec4<f32>(position, 0.0, 0.0);
      persistent_state[flowIndex(0u, particle)] = value;
      persistent_state[flowIndex(1u, particle)] = value;
    }
    var initialHeader = persistent_state[0];
    initialHeader.y = bitcast<f32>(0u);
    persistent_state[0] = initialHeader;
  }
  var header = persistent_state[0];
  let sourceBank = bitcast<u32>(header.y) & 1u;
  let destinationBank = 1u - sourceBank;
  let p0 = node.target0;
  let p1 = node.target1;
  let count = u32(clamp(round(p0.y / 8.0) * 8.0, 8.0, f32(MAX_FLOW_PARTICLES)));
  let attractor = vec2<f32>(stateInput(node, 0u, 0u).x, stateInput(node, 1u, 0u).x);
  let chunkSeconds = f32(render_info.sampleCount) / SAMPLE_RATE;
  let dt = clamp(p0.x, 0.0, 8.0) * 0.04 * chunkSeconds;
  let timeScaledDrag = pow(clamp(p1.x, 0.0, 0.999), max(chunkSeconds / 0.1, 0.0001));
  for (var particle = 0u; particle < MAX_FLOW_PARTICLES; particle += 1u) {
    let old = persistent_state[flowIndex(sourceBank, particle)];
    if (particle >= count) {
      persistent_state[flowIndex(destinationBank, particle)] = old;
      continue;
    }
    let scaled = old.xy * clamp(p0.z, 0.1, 16.0);
    let curl = vec2<f32>(
      sin(scaled.y * 2.31 + cos(scaled.x * 1.73)),
      -sin(scaled.x * 2.07 - cos(scaled.y * 1.51))
    ) * clamp(p0.w, -4.0, 4.0);
    let delta = attractor - old.xy;
    let velocity = old.zw * timeScaledDrag + (curl + delta * clamp(p1.y, -2.0, 2.0)) * dt;
    let position = fract((old.xy + velocity * dt) * 0.5 + vec2<f32>(0.5)) * 2.0 - vec2<f32>(1.0);
    persistent_state[flowIndex(destinationBank, particle)] = vec4<f32>(position, velocity);
  }
  // Reduce each particle bank once, then interpolate those four aggregates at
  // audio rate. This preserves continuous controls without repeating a
  // 256-particle reduction for every one of the ~4,410 samples in a chunk.
  var oldCentroid = vec2<f32>(0.0);
  var newCentroid = vec2<f32>(0.0);
  var oldAnisotropy = vec2<f32>(0.0);
  var newAnisotropy = vec2<f32>(0.0);
  for (var particle = 0u; particle < MAX_FLOW_PARTICLES; particle += 1u) {
    if (particle >= count) { break; }
    let oldPosition = persistent_state[flowIndex(sourceBank, particle)].xy;
    let newPosition = persistent_state[flowIndex(destinationBank, particle)].xy;
    oldCentroid += oldPosition;
    newCentroid += newPosition;
    oldAnisotropy += vec2<f32>(
      oldPosition.x * oldPosition.x - oldPosition.y * oldPosition.y,
      oldPosition.x * oldPosition.y * 2.0
    );
    newAnisotropy += vec2<f32>(
      newPosition.x * newPosition.x - newPosition.y * newPosition.y,
      newPosition.x * newPosition.y * 2.0
    );
  }
  oldCentroid /= f32(count);
  newCentroid /= f32(count);
  oldAnisotropy /= f32(count);
  newAnisotropy /= f32(count);
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let blend = smootherstep01(f32(sample) / f32(max(render_info.sampleCount - 1u, 1u)));
    let centroid = mix(oldCentroid, newCentroid, blend);
    let anisotropy = mix(oldAnisotropy, newAnisotropy, blend);
    writeStateSample(sample, centroid + anisotropy * clamp(params1(node, sample).w, 0.0, 2.0));
  }
  header = persistent_state[0];
  header.y = bitcast<f32>(destinationBank);
  markStateContinuous(header);
}

fn sdRayShape(point: vec3<f32>, shape: u32, size: f32) -> f32 {
  let p = point / max(size, 0.1);
  if (shape == 0u) { return (length(p) - 1.0) * size; }
  if (shape == 1u) {
    let q = abs(p) - vec3<f32>(0.75);
    return (length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0)) * size;
  }
  if (shape == 2u) {
    let q = vec2<f32>(length(p.xz) - 0.68, p.y);
    return (length(q) - 0.24) * size;
  }
  if (shape == 3u) {
    let q = vec3<f32>(p.x, p.y - clamp(p.y, -0.62, 0.62), p.z);
    return (length(q) - 0.38) * size;
  }
  if (shape == 4u) {
    let a = max(abs(p.x), abs(p.y)) - 0.28;
    let b = max(abs(p.z), abs(p.y)) - 0.28;
    return min(a, b) * size;
  }
  let folded = abs(fract(p * 0.75 + vec3<f32>(0.5)) * 2.0 - vec3<f32>(1.0));
  return (max(folded.x, max(folded.y, folded.z)) - 0.52) * size;
}

fn rayPath(mode: u32, shape: u32, size: f32) -> vec2<f32> {
  let angle = TAU * (f32(mode) * 0.61803398875 + 0.137);
  var origin = vec3<f32>(cos(angle) * 2.8, sin(angle * 0.73) * 1.3, sin(angle) * 2.8) * size;
  let direction = normalize(-origin + vec3<f32>(sin(angle * 1.7), cos(angle * 1.3), sin(angle * 0.91)) * 0.16);
  var travel = 0.0;
  var closest = 10.0;
  for (var step = 0u; step < 24u; step += 1u) {
    let distance = abs(sdRayShape(origin + direction * travel, shape, size));
    closest = min(closest, distance);
    travel += clamp(distance, 0.002, size * 0.38);
    if (travel > size * 7.0) { break; }
  }
  return vec2<f32>(max(travel, size * 0.2), closest);
}

fn renderRaymarchResonator(node: GraphNode) {
  if (!stateIsContinuous()) { resetPersistentState(); }
  var previousPaths: array<vec2<f32>, 48>;
  var targetPaths: array<vec2<f32>, 48>;
  let previousShape = u32(clamp(round(node.previous0.y), 0.0, 5.0));
  let targetShape = u32(clamp(round(node.target0.y), 0.0, 5.0));
  let previousSize = clamp(node.previous0.z, 0.1, 4.0);
  let targetSize = clamp(node.target0.z, 0.1, 4.0);
  for (var mode = 0u; mode < MAX_RAY_MODES; mode += 1u) {
    previousPaths[mode] = rayPath(mode, previousShape, previousSize);
    targetPaths[mode] = rayPath(mode, targetShape, targetSize);
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let ramp = transitionRamp(sample);
    let input = stateInput(node, 0u, sample);
    var wet = vec2<f32>(0.0);
    var normalization = 0.0;
    for (var mode = 0u; mode < MAX_RAY_MODES; mode += 1u) {
      let modePosition = f32(mode) + 0.5;
      let previousActive = 1.0 - smoothstep(node.previous0.x - 0.5, node.previous0.x + 0.5, modePosition);
      let targetActive = 1.0 - smoothstep(node.target0.x - 0.5, node.target0.x + 0.5, modePosition);
      let activation = mix(previousActive, targetActive, ramp);
      if (activation <= 0.00001) {
        persistent_state[1u + mode] = vec4<f32>(0.0);
        continue;
      }
      let path = mix(previousPaths[mode], targetPaths[mode], ramp);
      let frequency = clamp(58.0 + 980.0 / max(path.x, 0.05) * (1.0 + f32(mode) * 0.115), 20.0, SAMPLE_RATE * 0.44);
      let dampingTilt = clamp(p1.x, 0.0, 1.0) * f32(mode) / f32(MAX_RAY_MODES - 1u);
      let radius = clamp(p0.w * (0.9994 - dampingTilt * 0.08), 0.0, 0.9995);
      let coefficient = 2.0 * radius * cos(TAU * frequency / SAMPLE_RATE);
      let state = persistent_state[1u + mode];
      let brightness = exp2(clamp(p1.y, -1.0, 1.0) * (f32(mode) / f32(MAX_RAY_MODES) - 0.5) * 3.0);
      let surfaceWeight = activation * brightness / sqrt(f32(mode + 1u)) * (0.4 + 0.6 * exp(-path.y * 8.0));
      let pan = (hashU32(mode * 1664525u + 1013904223u) * 2.0 - 1.0) * clamp(p1.z, 0.0, 1.0);
      let excitation = vec2<f32>(input.x * (1.0 - pan), input.y * (1.0 + pan)) * surfaceWeight * 0.035;
      let next = coefficient * state.xz - radius * radius * state.yw + excitation;
      persistent_state[1u + mode] = vec4<f32>(next.x, state.x, next.y, state.z);
      wet += next * activation;
      normalization += surfaceWeight;
    }
    wet /= max(sqrt(normalization), 1.0);
    writeStateSample(sample, softClip(mix(input, softClip(wet), clamp(p1.w, 0.0, 1.0))));
  }
  markStateContinuous(persistent_state[0]);
}

@compute @workgroup_size(64)
fn renderStateNode(
  @builtin(workgroup_id) workgroup_id: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  if (workgroup_id.x != 0u || state_stage.nodeIndex >= render_info.nodeCount) { return; }
  state_lane = lane;
  let node = graph_nodes[state_stage.nodeIndex];
  switch state_stage.kind {
    case 108u: {
      let params = node.target0;
      renderSpectralSdf(node);
    }
    default: {
      if (lane != 0u) { return; }
      switch state_stage.kind {
        case 105u: { let params = node.target0; renderCellularAutomaton(node); }
        case 106u: { let params = node.target0; renderReactionDiffusion(node); }
        case 107u: { let params = node.target0; renderFeedbackLattice(node); }
        case 109u: { let params = node.target0; renderFlowAdvection(node); }
        case 110u: { let params = node.target0; renderRaymarchResonator(node); }
        default: {}
      }
    }
  }
}
`;

function destroyBuffer(buffer) {
  try { buffer?.destroy?.(); } catch { /* optional cleanup */ }
}

function createStorageBuffer(device, usage, size) {
  const buffer = device.createBuffer({
    size: Math.max(16, Math.ceil(size / 16) * 16),
    usage: usage.STORAGE | usage.COPY_DST,
  });
  // WebGPU buffers are zero initialized. The explicit write also gives test
  // runtimes and older implementations the same deterministic reset contract.
  device.queue.writeBuffer(buffer, 0, new Uint8Array(Math.max(16, Math.ceil(size / 16) * 16)));
  return buffer;
}

/**
 * Owns only resources used by the six persistent visual/state module kinds.
 * Scratch and private state do not exist when the active graph has none.
 */
export class ShaderSynthPlaygroundStateEngine {
  constructor(device, {
    usage,
    sampleRate,
    chunkSamples,
    maxNodes,
    renderInfoBuffer,
    nodeBuffer,
  }) {
    this.device = device;
    this.usage = usage;
    this.sampleRate = sampleRate;
    this.chunkSamples = chunkSamples;
    this.maxNodes = maxNodes;
    this.renderInfoBuffer = renderInfoBuffer;
    this.nodeBuffer = nodeBuffer;
    this.pipeline = null;
    this.graphSignalBuffer = null;
    this.stateOutputBuffer = null;
    this.nodeResources = new Map();
    this.orderedResources = [];
    this.scratchBytes = 0;
    this.persistentBytes = 0;
  }

  async init() {
    const module = this.device.createShaderModule({ code: SHADER_SYNTH_PLAYGROUND_STATE_SHADER });
    const descriptor = {
      layout: "auto",
      compute: {
        module,
        entryPoint: "renderStateNode",
        constants: { SAMPLE_RATE: this.sampleRate },
      },
    };
    this.pipeline = typeof this.device.createComputePipelineAsync === "function"
      ? await this.device.createComputePipelineAsync(descriptor)
      : this.device.createComputePipeline(descriptor);
    return this;
  }

  setPipeline(pipeline) {
    this.pipeline = pipeline;
    return this;
  }

  get active() {
    return this.orderedResources.length > 0;
  }

  get allocationSummary() {
    return freeze({
      active: this.active,
      nodeCount: this.orderedResources.length,
      persistentNodeCount: this.nodeResources.size,
      persistentBytes: this.persistentBytes,
      scratchBytes: this.scratchBytes,
    });
  }

  graphBindings(graphFallbackBuffer, stateFallbackBuffer = graphFallbackBuffer) {
    return {
      graphSignals: this.graphSignalBuffer ?? graphFallbackBuffer,
      stateOutput: this.stateOutputBuffer ?? stateFallbackBuffer,
    };
  }

  ensureStatefulResourceBuffers(activeStatefulCount) {
    if (activeStatefulCount <= 0) return false;
    if (this.graphSignalBuffer && this.stateOutputBuffer) return false;
    const byteSize = this.maxNodes * this.chunkSamples * 2 * Float32Array.BYTES_PER_ELEMENT;
    this.graphSignalBuffer = this.device.createBuffer({
      size: byteSize,
      usage: this.usage.STORAGE | this.usage.COPY_DST,
    });
    this.stateOutputBuffer = this.device.createBuffer({
      size: byteSize,
      usage: this.usage.STORAGE | this.usage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.graphSignalBuffer, 0, new Uint8Array(byteSize));
    this.device.queue.writeBuffer(this.stateOutputBuffer, 0, new Uint8Array(byteSize));
    this.scratchBytes = byteSize * 2;
    return true;
  }

  releaseStatefulResourceBuffers() {
    try { this.graphSignalBuffer?.destroy?.(); } catch { /* optional cleanup */ }
    try { this.stateOutputBuffer?.destroy?.(); } catch { /* optional cleanup */ }
    this.graphSignalBuffer = null;
    this.stateOutputBuffer = null;
    this.scratchBytes = 0;
  }

  createNodeResource(node) {
    const persistentByteSize = shaderSynthPlaygroundStatePersistentByteSize(node.kind, this.sampleRate);
    const persistentBuffer = createStorageBuffer(this.device, this.usage, persistentByteSize);
    const infoBuffer = this.device.createBuffer({
      size: 16,
      usage: this.usage.UNIFORM | this.usage.COPY_DST,
    });
    const resource = {
      id: node.id,
      kind: node.kind,
      nodeIndex: node.nodeIndex,
      params: [...node.params],
      resetSignature: resetSignature(node.kind, node.params),
      persistentByteSize,
      persistentBuffer,
      infoBuffer,
      bindGroup: null,
    };
    this.writeNodeInfo(resource);
    return resource;
  }

  writeNodeInfo(resource) {
    resource.nodeIndex = Number(resource.nodeIndex) >>> 0;
    resource.fftSize = resource.kind === 108
      ? spectralFftSizeFromParams(resource.params)
      : 0;
    resource.spectralSegments = resource.kind === 108
      ? spectralSegmentCount(this.chunkSamples, resource.fftSize)
      : 0;
    this.device.queue.writeBuffer(
      resource.infoBuffer,
      0,
      new Uint32Array([
        resource.nodeIndex,
        resource.kind,
        resource.fftSize,
        resource.spectralSegments,
      ]),
    );
  }

  destroyNodeResource(resource) {
    destroyBuffer(resource?.persistentBuffer);
    destroyBuffer(resource?.infoBuffer);
  }

  rebuildNodeBindGroup(resource) {
    const entries = [
        { binding: 0, resource: { buffer: this.renderInfoBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } },
        { binding: 2, resource: { buffer: this.graphSignalBuffer } },
        { binding: 3, resource: { buffer: this.stateOutputBuffer } },
        { binding: 4, resource: { buffer: resource.persistentBuffer } },
        { binding: 5, resource: { buffer: resource.infoBuffer } },
      ];
    resource.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries,
    });
  }

  /**
   * Synchronize allocations to graph topology. Returns true when the ordinary
   * graph bind group must be rebuilt because conditional scratch changed.
   */
  sync(encoded) {
    const nodes = shaderSynthPlaygroundStateEngineNodes(encoded);
    let graphBindingsChanged = false;
    if (nodes.length === 0) {
      for (const resource of this.nodeResources.values()) this.destroyNodeResource(resource);
      this.nodeResources.clear();
      this.orderedResources = [];
      this.persistentBytes = 0;
      if (this.graphSignalBuffer || this.stateOutputBuffer) {
        this.releaseStatefulResourceBuffers();
        graphBindingsChanged = true;
      }
      return graphBindingsChanged;
    }

    graphBindingsChanged = this.ensureStatefulResourceBuffers(nodes.length) || graphBindingsChanged;
    const activeIds = new Set(nodes.map(({ id }) => id));
    for (const [id, resource] of this.nodeResources) {
      if (!activeIds.has(id)) {
        this.destroyNodeResource(resource);
        this.nodeResources.delete(id);
      }
    }

    for (const node of nodes) {
      const signature = resetSignature(node.kind, node.params);
      let resource = this.nodeResources.get(node.id);
      const needsReplacement = !resource
        || resource.kind !== node.kind
        || resource.resetSignature !== signature;
      if (needsReplacement) {
        if (resource) this.destroyNodeResource(resource);
        resource = this.createNodeResource(node);
        this.nodeResources.set(node.id, resource);
      } else {
        const nextFftSize = node.kind === 108
          ? spectralFftSizeFromParams(node.params)
          : 0;
        const nodeInfoChanged = resource.nodeIndex !== node.nodeIndex
          || resource.fftSize !== nextFftSize;
        resource.nodeIndex = node.nodeIndex;
        resource.params = [...node.params];
        if (nodeInfoChanged) this.writeNodeInfo(resource);
      }
      resource.resetSignature = signature;
      if (needsReplacement || graphBindingsChanged || !resource.bindGroup) {
        this.rebuildNodeBindGroup(resource);
      }
    }
    this.orderedResources = nodes.map(({ id }) => this.nodeResources.get(id));
    this.persistentBytes = [...this.nodeResources.values()]
      .reduce((total, resource) => total + resource.persistentByteSize, 0);
    return graphBindingsChanged;
  }

  encodeNodePass(encoder, resource) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, resource.bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  destroy() {
    for (const resource of this.nodeResources.values()) this.destroyNodeResource(resource);
    this.nodeResources.clear();
    this.orderedResources = [];
    this.releaseStatefulResourceBuffers();
    this.pipeline = null;
    this.persistentBytes = 0;
  }
}
