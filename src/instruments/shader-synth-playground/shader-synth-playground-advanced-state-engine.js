import { SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS } from "./shader-synth-playground-advanced-state.js?v=20260831-modules125";

const freeze = (value) => Object.freeze(value);
const BYTES_PER_VEC4 = Float32Array.BYTES_PER_ELEMENT * 4;

export const SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_LIMITS = freeze({
  sequenceSteps: 128,
  wavetableSamples: 2048,
  sampleSeconds: 8,
  spatialDelayFrames: 2048,
  feedbackSeconds: 2,
  wavefieldSide: 16,
  spectralBands: 32,
  dynamicsLookaheadSeconds: 0.05,
  convolutionSeconds: 12,
  convolutionGuardSeconds: 1,
  convolutionUploadSamples: 65536,
  massiveModes: 128,
  analysisFrames: 4096,
  vocoderBands: 32,
  neuralHistoryFrames: 512,
  neuralHiddenUnits: 16,
});

const ADVANCED_KIND_VALUES = Object.values(SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS);
const ADVANCED_KIND_SET = new Set(ADVANCED_KIND_VALUES);

export function isShaderSynthPlaygroundAdvancedStateKind(kind) {
  return ADVANCED_KIND_SET.has(Number(kind));
}

function alignedBytes(vec4Count) {
  return Math.ceil((Math.max(1, vec4Count) * BYTES_PER_VEC4) / 16) * 16;
}

function sampleFrames(sampleRate, seconds) {
  return Math.max(1, Math.ceil(Math.max(8000, Number(sampleRate) || 44100) * seconds) + 2);
}

export function shaderSynthPlaygroundAdvancedPersistentByteSize(kind, sampleRate = 44100) {
  const limits = SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_LIMITS;
  let vec4Count = 1;
  switch (Number(kind)) {
    case 111:
      vec4Count += limits.sequenceSteps;
      break;
    case 112:
      // One extra cell carries the independently integrated right-channel
      // phase without stealing space from a full-size uploaded table.
      vec4Count += limits.wavetableSamples + 1;
      break;
    case 113:
      // The resident sample occupies the advertised asset capacity. One cell
      // after it carries the integrated grain clock and scan phase.
      vec4Count += sampleFrames(sampleRate, limits.sampleSeconds) + 1;
      break;
    case 114:
      vec4Count += limits.spatialDelayFrames + 2;
      break;
    case 115:
      vec4Count += 8;
      break;
    case 116:
      vec4Count += sampleFrames(sampleRate, limits.feedbackSeconds) + 1;
      break;
    case 117:
      vec4Count += limits.wavefieldSide * limits.wavefieldSide * 2 + 1;
      break;
    case 118:
      vec4Count += limits.spectralBands * 2;
      break;
    case 119:
      vec4Count += sampleFrames(sampleRate, limits.dynamicsLookaheadSeconds) + 4;
      break;
    case 120:
      vec4Count += sampleFrames(sampleRate, limits.convolutionSeconds + limits.convolutionGuardSeconds)
        + limits.convolutionUploadSamples;
      break;
    case 121:
      // Modal modes use the full bank; one extra cell carries analytic
      // dispersion phase without stealing a resonator state.
      vec4Count += limits.massiveModes + 1;
      break;
    case 122:
      vec4Count += limits.analysisFrames + 4;
      break;
    case 123:
      // Sixteen vec4s carry 64 independent partial phases. Four more retain
      // the stereo filtered-noise bands; spare cells allow future decoders.
      vec4Count += 24;
      break;
    case 124:
      vec4Count += limits.vocoderBands * 2 + 4;
      break;
    case 125:
      vec4Count += limits.neuralHistoryFrames + limits.neuralHiddenUnits + 4;
      break;
    default:
      return 0;
  }
  return alignedBytes(vec4Count);
}

export function shaderSynthPlaygroundAdvancedAssetLayout(kind, sampleRate = 44100) {
  const limits = SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_LIMITS;
  switch (Number(kind)) {
    case 112:
      return freeze({ offsetVec4: 1, capacityFrames: limits.wavetableSamples, channels: 1 });
    case 113:
      return freeze({
        offsetVec4: 1,
        capacityFrames: sampleFrames(sampleRate, limits.sampleSeconds),
        channels: 2,
      });
    case 120:
      return freeze({
        offsetVec4: 1 + sampleFrames(sampleRate, limits.convolutionSeconds + limits.convolutionGuardSeconds),
        capacityFrames: limits.convolutionUploadSamples,
        channels: 2,
      });
    default:
      return null;
  }
}

export const SHADER_SYNTH_PLAYGROUND_ADVANCED_RESET_PARAM_INDICES = freeze({
  // Every advanced family owns a fixed maximum private allocation. Selector
  // and range changes therefore morph the resident state instead of forcing
  // a buffer replacement at an audio-chunk boundary.
  111: freeze([]),
  112: freeze([]),
  113: freeze([]),
  114: freeze([]),
  115: freeze([]),
  116: freeze([]),
  117: freeze([]),
  118: freeze([]),
  119: freeze([]),
  120: freeze([]),
  121: freeze([]),
  122: freeze([]),
  123: freeze([]),
  124: freeze([]),
  125: freeze([]),
});

export const SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CONSTANTS = /* wgsl */ `
const ADVANCED_SEQUENCE_STEPS: u32 = 128u;
const ADVANCED_WAVETABLE_SAMPLES: u32 = 2048u;
const ADVANCED_SAMPLE_SECONDS: f32 = 8.0;
const ADVANCED_SPATIAL_DELAY_FRAMES: u32 = 2048u;
const ADVANCED_FEEDBACK_SECONDS: f32 = 2.0;
const ADVANCED_WAVEFIELD_SIDE: u32 = 16u;
const ADVANCED_WAVEFIELD_CELLS: u32 = 256u;
const ADVANCED_SPECTRAL_BANDS: u32 = 32u;
const ADVANCED_DYNAMICS_LOOKAHEAD_SECONDS: f32 = 0.05;
const ADVANCED_CONVOLUTION_SECONDS: f32 = 12.0;
const ADVANCED_CONVOLUTION_GUARD_SECONDS: f32 = 1.0;
const ADVANCED_CONVOLUTION_UPLOAD_SAMPLES: u32 = 65536u;
const ADVANCED_MASSIVE_MODES: u32 = 128u;
const ADVANCED_ANALYSIS_FRAMES: u32 = 4096u;
const ADVANCED_VOCODER_BANDS: u32 = 32u;
const ADVANCED_NEURAL_HISTORY: u32 = 512u;
const ADVANCED_NEURAL_HIDDEN: u32 = 16u;
`;

export const SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_HELPERS = /* wgsl */ `
fn advancedClampIndex(index: u32) -> u32 {
  return min(index, max(arrayLength(&persistent_state), 1u) - 1u);
}

fn advancedRead(index: u32) -> vec4<f32> {
  return persistent_state[advancedClampIndex(index)];
}

fn advancedWrite(index: u32, value: vec4<f32>) {
  persistent_state[advancedClampIndex(index)] = value;
}

fn advancedMono(value: vec2<f32>) -> f32 {
  return (value.x + value.y) * 0.5;
}

fn advancedInputConnected(node: GraphNode, inputIndex: u32) -> bool {
  var encoded = node.header.y;
  if (inputIndex == 1u) { encoded = node.header.z; }
  if (inputIndex == 2u) { encoded = node.header.w; }
  return abs(encoded) >= 0.5;
}

fn advancedEqualPower(dry: vec2<f32>, wet: vec2<f32>, amount: f32) -> vec2<f32> {
  let mixAmount = clamp(amount, 0.0, 1.0);
  return dry * cos(mixAmount * PI * 0.5) + wet * sin(mixAmount * PI * 0.5);
}

fn advancedBlendPhase(analyzed: f32, carried: f32, amount: f32) -> f32 {
  let shortestArc = atan2(sin(carried - analyzed), cos(carried - analyzed));
  return analyzed + shortestArc * clamp(amount, 0.0, 1.0);
}

fn advancedQuadraticSample(previous2: vec2<f32>, previous1: vec2<f32>, current: vec2<f32>, t: f32) -> vec2<f32> {
  return previous2 * (t * (t - 1.0) * 0.5)
    + previous1 * (1.0 - t * t)
    + current * (t * (t + 1.0) * 0.5);
}

fn advancedWrapped(value: i32, size: u32) -> u32 {
  let span = i32(max(size, 1u));
  return u32((value % span + span) % span);
}

fn advancedHash(seed: u32, index: u32) -> f32 {
  return hashU32(seed ^ (index * 0x9e3779b9u + 0x85ebca6bu));
}

fn advancedFractionalRead(base: u32, frames: u32, position: f32) -> vec2<f32> {
  let span = max(frames, 1u);
  let wrapped = position - floor(position / f32(span)) * f32(span);
  let first = u32(floor(max(wrapped, 0.0))) % span;
  let second = (first + 1u) % span;
  let amount = fract(max(wrapped, 0.0));
  return mix(advancedRead(base + first).xy, advancedRead(base + second).xy, amount);
}

fn advancedTransitionedMode(value: f32, maximum: u32) -> u32 {
  return min(u32(max(round(value), 0.0)), maximum);
}

fn advancedClearFrom(start: u32) {
  for (var index = start; index < arrayLength(&persistent_state); index += 1u) {
    persistent_state[index] = vec4<f32>(0.0);
  }
}

fn advancedSequenceValue(mode: u32, step: u32, length: u32, seed: u32) -> f32 {
  let safeLength = max(length, 1u);
  let unit = f32(step % safeLength) / f32(max(safeLength - 1u, 1u));
  switch mode {
    case 0u: { return advancedRead(1u + step % ADVANCED_SEQUENCE_STEPS).x; }
    case 1u: { return unit; }
    case 2u: { return 1.0 - abs(unit * 2.0 - 1.0); }
    case 3u: { return advancedHash(seed, step); }
    case 4u: {
      let mask = 0x9d2c5680u ^ (seed * 0x45d9f3bu);
      return select(0.0, 1.0, ((mask >> (step % 32u)) & 1u) != 0u);
    }
    default: {
      let pulses = max(1u, min(safeLength, 3u + seed % max(safeLength / 2u, 1u)));
      return select(0.0, 1.0, ((step * pulses) % safeLength) < pulses);
    }
  }
}

fn renderSequenceLane(node: GraphNode) {
  var header = persistent_state[0];
  let targetSeed = u32(max(round(node.target1.y), 1.0));
  if (header.w < 0.5 || u32(max(round(header.y), 0.0)) != targetSeed) {
    for (var cell = 0u; cell < ADVANCED_SEQUENCE_STEPS; cell += 1u) {
      // Stored Steps are deliberately quantized; Random mode evaluates the
      // same seeded field continuously, so the two modes remain audibly and
      // visually distinct while staying repeatable.
      let value = floor(advancedHash(targetSeed, cell) * 8.0) / 7.0;
      advancedWrite(1u + cell, vec4<f32>(value, 0.0, 0.0, 0.0));
    }
    header = vec4<f32>(header.x, f32(targetSeed), header.z, 1.0);
    persistent_state[0] = header;
  }
  var phaseCell = advancedRead(1u);
  var pairPhase = select(0.0, clamp(phaseCell.y, 0.0, 1.999999), stateIsContinuous());
  var pairCounter = select(0u, bitcast<u32>(phaseCell.z), stateIsContinuous());
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let mode = advancedTransitionedMode(p0.x, 5u);
    let rate = max(p0.y, 0.001);
    let length = u32(clamp(round(p0.z), 1.0, f32(ADVANCED_SEQUENCE_STEPS)));
    let swing = clamp(p0.w, 0.0, 0.48);
    let smoothing = clamp(p1.x, 0.0, 1.0);
    let seed = u32(max(round(p1.y), 1.0));
    let depth = p1.z;
    let offset = p1.w;
    let patchedPhase = stateInput(node, 0u, sample).x;
    let patchedValue = stateInput(node, 1u, sample).x;
    var activePair = pairCounter;
    var withinPair = pairPhase;
    if (advancedInputConnected(node, 0u)) {
      let patchedPosition = max(patchedPhase, 0.0) * f32(length);
      activePair = u32(floor(patchedPosition * 0.5));
      withinPair = fract(patchedPosition * 0.5) * 2.0;
    }
    // Resolve two steps as one fixed-duration pair. Swing moves the boundary
    // inside that pair, so it changes event timing without drifting the loop.
    let boundary = 1.0 + swing;
    let odd = withinPair >= boundary;
    let local = select(
      withinPair / max(boundary, 0.001),
      (withinPair - boundary) / max(2.0 - boundary, 0.001),
      odd
    );
    let straightStep = activePair * 2u + select(0u, 1u, odd);
    let step = straightStep % length;
    let nextStep = (step + 1u) % length;
    let current = advancedSequenceValue(mode, step, length, seed);
    let next = advancedSequenceValue(mode, nextStep, length, seed);
    let blendStart = 1.0 - smoothing;
    let blend = smootherstep01((local - blendStart) / max(smoothing, 0.0001));
    var lane = mix(current, next, blend);
    lane = mix(lane, clamp(patchedValue * 0.5 + 0.5, 0.0, 1.0), select(0.0, 0.5, advancedInputConnected(node, 1u)));
    let edge = max(0.01, min(0.18, 2.0 / max(SAMPLE_RATE / rate, 2.0)));
    let gate = smootherstep01(local / edge) * smootherstep01((1.0 - local) / edge);
    writeStateSample(sample, vec2<f32>(lane * depth + offset, gate));
    pairPhase += rate / SAMPLE_RATE;
    let elapsedPairs = u32(floor(pairPhase * 0.5));
    pairPhase -= f32(elapsedPairs) * 2.0;
    pairCounter = (pairCounter + elapsedPairs) % max(length, 1u);
  }
  phaseCell = advancedRead(1u);
  phaseCell.y = pairPhase;
  phaseCell.z = bitcast<f32>(pairCounter);
  advancedWrite(1u, phaseCell);
  markStateContinuous(persistent_state[0]);
}

fn advancedProceduralTable(phase: f32, table: u32, scan: f32) -> f32 {
  let p = fract(phase);
  let scanUnit = clamp(scan, 0.0, 1.0);
  let warpedPhase = fract(p + sin(TAU * p) * scanUnit * 0.075);
  let sine = sin(TAU * warpedPhase);
  if (table == 0u) {
    let bright = tanh(sine * mix(1.0, 5.0, scanUnit));
    return mix(sine, bright, scanUnit * 0.72);
  }
  if (table == 1u) {
    let second = mix(0.18, 0.62, scanUnit);
    let fourth = mix(0.08, 0.38, scanUnit);
    return (sine + sin(TAU * warpedPhase * 2.0) * second + sin(TAU * warpedPhase * 4.0) * fourth) / (1.0 + second + fourth);
  }
  if (table == 2u) {
    let vowel = mix(2.0, 7.0, scanUnit);
    return softClip(vec2<f32>(sine + sin(TAU * p * vowel) * 0.7)).x * 1.5;
  }
  if (table == 3u) {
    let ratioA = mix(1.71, 3.37, scanUnit);
    let ratioB = mix(4.13, 7.91, scanUnit);
    return (sine + sin(TAU * warpedPhase * ratioA) * 0.55 + sin(TAU * warpedPhase * ratioB) * 0.28) / 1.6;
  }
  let corner = mix(0.12, 0.88, scanUnit);
  return mix(p * 2.0 - 1.0, select(-1.0, 1.0, p < corner), 0.62);
}

fn advancedUploadedTable(phase: f32, interpolation: u32, assetLength: u32) -> f32 {
  let length = min(max(assetLength, 1u), ADVANCED_WAVETABLE_SAMPLES);
  let position = fract(phase) * f32(length);
  let index = u32(floor(position)) % length;
  if (interpolation == 0u) { return advancedRead(1u + index).x; }
  let previous = advancedRead(1u + (index + length - 1u) % length).x;
  let current = advancedRead(1u + index).x;
  let next = advancedRead(1u + (index + 1u) % length).x;
  let after = advancedRead(1u + (index + 2u) % length).x;
  let amount = fract(position);
  if (interpolation == 1u) { return mix(current, next, amount); }
  let a = -0.5 * previous + 1.5 * current - 1.5 * next + 0.5 * after;
  let b = previous - 2.5 * current + 2.0 * next - 0.5 * after;
  let c = -0.5 * previous + 0.5 * next;
  return ((a * amount + b) * amount + c) * amount + current;
}

fn renderUploadedWavetable(node: GraphNode) {
  var header = persistent_state[0];
  var phase = select(fract(f32(render_info.baseSample) * node.target0.x / SAMPLE_RATE), fract(header.y), stateIsContinuous());
  var rightPhase = select(phase, fract(advancedRead(1u + ADVANCED_WAVETABLE_SAMPLES).x), stateIsContinuous());
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let scanInput = stateInput(node, 0u, sample).x;
    let pitchInput = stateInput(node, 1u, sample).x;
    let frequency = clamp(p0.x * pow(2.0, (pitchInput + render_info.performancePitch) / 12.0), 0.01, SAMPLE_RATE * 0.45);
    let table = advancedTransitionedMode(p0.y, 7u);
    let scan = clamp(p0.z + scanInput * p0.w, 0.0, 1.0);
    let interpolation = advancedTransitionedMode(p1.x, 2u);
    let detuneRatio = pow(2.0, max(p1.y, 0.0) / 1200.0);
    let stereo = clamp(p1.z, 0.0, 1.0);
    let assetLength = u32(clamp(round(header.w), 0.0, f32(ADVANCED_WAVETABLE_SAMPLES)));
    let leftPhase = phase;
    let rightReadPhase = rightPhase;
    var left = advancedProceduralTable(leftPhase, min(table, 4u), scan);
    var right = advancedProceduralTable(rightReadPhase, min(table, 4u), 1.0 - scan);
    if (table >= 5u && assetLength > 1u) {
      let slotOffset = f32(table - 5u) * 0.137;
      let leftWarp = sin(TAU * leftPhase) * scan * 0.12;
      let rightWarp = sin(TAU * rightReadPhase + PI * 0.5) * scan * 0.12;
      left = advancedUploadedTable(leftPhase + slotOffset + leftWarp, interpolation, assetLength);
      right = advancedUploadedTable(rightReadPhase + slotOffset + rightWarp, interpolation, assetLength);
    }
    right = mix(left, right, stereo);
    writeStateSample(sample, softClip(vec2<f32>(left, right) * max(p1.w, 0.0) * 1.25));
    phase = fract(phase + frequency * mix(1.0, 1.0 / detuneRatio, stereo) / SAMPLE_RATE);
    rightPhase = fract(rightPhase + frequency * mix(1.0, detuneRatio, stereo) / SAMPLE_RATE);
  }
  header = persistent_state[0];
  header.y = phase;
  persistent_state[0] = header;
  advancedWrite(1u + ADVANCED_WAVETABLE_SAMPLES, vec4<f32>(rightPhase, 0.0, 0.0, 0.0));
  markStateContinuous(persistent_state[0]);
}

fn advancedDefaultSample(position: f32, channel: f32) -> f32 {
  let p = fract(position);
  let body = sin(TAU * (42.0 * p - 17.0 * p * p)) * exp(-p * 6.0);
  let texture = (advancedHash(3907u + u32(channel * 17.0), u32(p * 65535.0)) * 2.0 - 1.0) * exp(-p * 3.2);
  let chirp = sin(TAU * (3.0 + channel * 0.31) * p * p * 28.0) * exp(-p * 2.0);
  return softClip(vec2<f32>(body * 0.72 + texture * 0.24 + chirp * 0.22)).x * 1.5;
}

fn advancedSampleAt(position: f32, channel: u32, assetLength: u32) -> f32 {
  if (assetLength < 2u) { return advancedDefaultSample(position, f32(channel)); }
  let length = min(assetLength, u32(max(arrayLength(&persistent_state) - 1u, 1u)));
  let wrapped = fract(position) * f32(length);
  let first = u32(floor(wrapped)) % length;
  let second = (first + 1u) % length;
  let amount = fract(wrapped);
  let a = advancedRead(1u + first);
  let b = advancedRead(1u + second);
  return mix(select(a.x, a.y, channel == 1u), select(b.x, b.y, channel == 1u), amount);
}

fn advancedSampleAtClamped(position: f32, channel: u32, assetLength: u32) -> f32 {
  if (assetLength < 2u) { return advancedDefaultSample(min(clamp(position, 0.0, 1.0), 0.999999), f32(channel)); }
  let length = min(assetLength, u32(max(arrayLength(&persistent_state) - 1u, 1u)));
  let scaled = clamp(position, 0.0, 1.0) * f32(length - 1u);
  let first = min(u32(floor(scaled)), length - 1u);
  let second = min(first + 1u, length - 1u);
  let amount = fract(scaled);
  let a = advancedRead(1u + first);
  let b = advancedRead(1u + second);
  return mix(select(a.x, a.y, channel == 1u), select(b.x, b.y, channel == 1u), amount);
}

fn renderGpuSamplerGranulator(node: GraphNode) {
  var header = persistent_state[0];
  let assetLength = u32(max(round(header.w), 0.0));
  var playhead = select(0.0, header.y, stateIsContinuous());
  let grainStateIndex = 1u + u32(max(SAMPLE_RATE * ADVANCED_SAMPLE_SECONDS, 1.0)) + 2u;
  var grainState = advancedRead(grainStateIndex);
  var grainPhase = select(0.0, fract(grainState.x), stateIsContinuous());
  var grainEpoch = select(0u, bitcast<u32>(grainState.y), stateIsContinuous());
  var scanPhase = select(0.0, fract(grainState.z), stateIsContinuous());
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let mode = advancedTransitionedMode(p0.x, 4u);
    let positionCv = stateInput(node, 0u, sample).x;
    let densityCv = stateInput(node, 1u, sample).x;
    let pitchCv = stateInput(node, 2u, sample).x;
    let playbackRate = p0.y * pow(2.0, (pitchCv + render_info.performancePitch) / 12.0);
    let basePosition = clamp(p0.z + positionCv * 0.5, 0.0, 1.0);
    let grainSeconds = clamp(p0.w, 2.0, 2000.0) * 0.001;
    let density = clamp(p1.x * pow(2.0, densityCv), 0.1, 2048.0);
    let spread = clamp(p1.y, 0.0, 1.0);
    let jitter = clamp(p1.z, 0.0, 1.0);
    let sampleDuration = select(1.0, f32(assetLength) / SAMPLE_RATE, assetLength > 1u);
    var wet = vec2<f32>(0.0);
    let triggerSignal = select(0.0, densityCv, advancedInputConnected(node, 1u));
    if (mode == 0u && triggerSignal > 0.5 && grainState.w <= 0.5) { playhead = 0.0; }
    grainState.w = triggerSignal;
    if (mode <= 1u) {
      // A loop needs only its unit phase; retaining an ever-growing counter in
      // f32 eventually loses sub-sample increments. One-shots keep a small
      // out-of-range sentinel so a completed voice stays silent without an
      // unbounded playhead.
      playhead = select(clamp(playhead, -2.0, 2.0), fract(playhead), mode == 1u);
      let unwrapped = playhead + basePosition;
      let playPosition = select(fract(unwrapped), clamp(unwrapped, 0.0, 1.0), mode == 0u);
      let playbackGain = select(1.0, select(0.0, 1.0, unwrapped >= 0.0 && unwrapped <= 1.0), mode == 0u);
      let wrappedRead = vec2<f32>(advancedSampleAt(playPosition, 0u, assetLength), advancedSampleAt(playPosition, 1u, assetLength));
      let clampedRead = vec2<f32>(advancedSampleAtClamped(playPosition, 0u, assetLength), advancedSampleAtClamped(playPosition, 1u, assetLength));
      wet = select(wrappedRead, clampedRead, mode == 0u) * playbackGain;
      playhead += playbackRate / max(sampleDuration * SAMPLE_RATE, 1.0);
      playhead = select(clamp(playhead, -2.0, 2.0), fract(playhead), mode == 1u);
    } else {
      let grainCount = u32(clamp(ceil(density * grainSeconds) + 2.0, 2.0, 24.0));
      var weight = 0.0;
      for (var grain = 0u; grain < 24u; grain += 1u) {
        if (grain >= grainCount) { break; }
        let laneClock = grainPhase + f32(grain) / f32(grainCount);
        let epoch = grainEpoch + u32(floor(laneClock));
        let phase = fract(laneClock);
        let randomEpoch = select(epoch, grain * 131u + 17u, mode == 4u);
        let randomPosition = (advancedHash(17011u, randomEpoch + grain * 131u) * 2.0 - 1.0) * jitter;
        let scan = select(basePosition, fract(basePosition + scanPhase), mode == 3u);
        let frozen = select(scan, basePosition, mode == 4u);
        let lanePosition = (f32(grain) / max(f32(grainCount - 1u), 1.0) - 0.5) * spread;
        let grainPosition = frozen + lanePosition + randomPosition * 0.5 + (phase - 0.5) * grainSeconds * playbackRate / max(sampleDuration, 0.001);
        let window = 0.5 - 0.5 * cos(TAU * phase);
        let pan = (advancedHash(29009u, randomEpoch + grain * 53u) * 2.0 - 1.0) * spread;
        let mono = (advancedSampleAt(grainPosition, 0u, assetLength) + advancedSampleAt(grainPosition, 1u, assetLength)) * 0.5;
        wet += mono * window * vec2<f32>(sqrt(max(0.0, (1.0 - pan) * 0.5)), sqrt(max(0.0, (1.0 + pan) * 0.5)));
        weight += window * window;
      }
      wet /= max(sqrt(weight), 1.0);
      let nextClock = grainPhase + density / SAMPLE_RATE;
      let elapsedEpochs = u32(floor(nextClock));
      grainPhase = fract(nextClock);
      grainEpoch += elapsedEpochs;
      scanPhase = fract(scanPhase + 0.03 / SAMPLE_RATE);
    }
    writeStateSample(sample, softClip(wet * max(p1.w, 0.0) * 1.4));
  }
  header = persistent_state[0];
  header.y = playhead;
  persistent_state[0] = header;
  advancedWrite(grainStateIndex, vec4<f32>(grainPhase, bitcast<f32>(grainEpoch), scanPhase, grainState.w));
  markStateContinuous(persistent_state[0]);
}

fn renderSpatializer(node: GraphNode) {
  var header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ADVANCED_SPATIAL_DELAY_FRAMES;
  if (!stateIsContinuous()) {
    advancedClearFrom(1u);
    writePosition = 0u;
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let azimuthCv = stateInput(node, 1u, sample).x;
    let elevationCv = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 3u);
    let azimuth = (p0.y + azimuthCv * 180.0) * PI / 180.0;
    let elevation = clamp((p0.z + elevationCv * 90.0) / 90.0, -1.0, 1.0);
    let distance = max(p0.w, 0.1);
    let width = clamp(p1.x, 0.0, 1.0);
    let order = u32(clamp(round(p1.y), 1.0, 3.0));
    let dataset = advancedTransitionedMode(p1.z, 3u);
    let wetMix = clamp(p1.w, 0.0, 1.0);
    let mono = advancedMono(input);
    advancedWrite(1u + writePosition, vec4<f32>(input, mono, 0.0));

    let side = sin(azimuth) * cos(elevation * PI * 0.5);
    let front = cos(azimuth) * cos(elevation * PI * 0.5);
    // One metre remains unity while the complete near-field range stays live.
    let distanceGain = min(3.0, inverseSqrt(max(distance, 0.1)));
    var wet = vec2<f32>(
      mono * sqrt(max(0.0, (1.0 - side) * 0.5)),
      mono * sqrt(max(0.0, (1.0 + side) * 0.5))
    );
    if (mode >= 2u) {
      var headScale = 0.82;
      switch dataset {
        case 1u: { headScale = 1.0; }
        case 2u: { headScale = 1.18; }
        case 3u: { headScale = 0.94; }
        default: {}
      }
      let itd = abs(side) * SAMPLE_RATE * 0.00063 * headScale;
      let leftDelay = select(itd, 0.0, side < 0.0);
      let rightDelay = select(0.0, itd, side < 0.0);
      let leftPosition = f32(writePosition) - leftDelay;
      let rightPosition = f32(writePosition) - rightDelay;
      let leftTap = advancedFractionalRead(1u, ADVANCED_SPATIAL_DELAY_FRAMES, leftPosition).x;
      let rightTap = advancedFractionalRead(1u, ADVANCED_SPATIAL_DELAY_FRAMES, rightPosition).y;
      let shadow = 1.0 - abs(side) * mix(0.18, 0.52, f32(dataset) / 3.0);
      wet = vec2<f32>(leftTap * select(shadow, 1.0, side <= 0.0), rightTap * select(1.0, shadow, side <= 0.0));
      let pinna = sin(elevation * PI + azimuth * 0.37) * 0.12;
      wet += vec2<f32>(mono * pinna, -mono * pinna);
    }
    if (mode == 3u) {
      let earlyA = advancedFractionalRead(1u, ADVANCED_SPATIAL_DELAY_FRAMES, f32(writePosition) - 149.0 - abs(side) * 41.0);
      let earlyB = advancedFractionalRead(1u, ADVANCED_SPATIAL_DELAY_FRAMES, f32(writePosition) - 337.0 - abs(front) * 73.0);
      wet += vec2<f32>(earlyA.y, earlyA.x) * 0.22 + vec2<f32>(earlyB.x, -earlyB.y) * 0.12;
    }
    // Directional detail and width are applied after mode-specific decoding so
    // the binaural and room paths cannot overwrite either control.
    if (mode >= 1u) {
      let directional = mix(1.0, 0.68 + front * 0.32, f32(order) / 3.0);
      wet *= directional;
    }
    let spreadDelay = mix(1.0, 31.0, width);
    let spreadTap = advancedFractionalRead(
      1u,
      ADVANCED_SPATIAL_DELAY_FRAMES,
      f32(writePosition) - spreadDelay
    );
    let decorrelatedSide = advancedMono(spreadTap) * 0.24;
    wet += vec2<f32>(decorrelatedSide, -decorrelatedSide) * width;
    writeStateSample(sample, softClip(advancedEqualPower(input, wet * distanceGain, wetMix) * 1.25));
    writePosition = (writePosition + 1u) % ADVANCED_SPATIAL_DELAY_FRAMES;
  }
  header = persistent_state[0];
  header.y = f32(writePosition);
  persistent_state[0] = header;
  markStateContinuous(persistent_state[0]);
}

fn renderRecursiveFilter(node: GraphNode) {
  if (!stateIsContinuous()) { advancedClearFrom(1u); }
  var filterState = advancedRead(1u);
  var previous = advancedRead(2u);
  var biquadState = advancedRead(3u);
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let cutoffCv = stateInput(node, 1u, sample).x;
    let resonanceCv = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 8u);
    let cutoff = clamp(p0.y * pow(2.0, cutoffCv * p1.y), 8.0, SAMPLE_RATE * 0.42);
    let resonance = clamp(p0.z + resonanceCv * p1.z, 0.1, 30.0);
    let gain = pow(10.0, clamp(p0.w, -24.0, 24.0) / 20.0);
    let drive = max(p1.x, 0.05);
    let wetMix = clamp(p1.w, 0.0, 1.0);
    let driven = softClip(input * drive) * 1.5;
    var wet = driven;
    if (mode == 0u) {
      let coefficient = exp(-TAU * cutoff / SAMPLE_RATE);
      wet = driven - previous.xy + previous.zw * coefficient;
      previous = vec4<f32>(driven, wet);
    } else if (mode == 8u) {
      let frequency = clamp(2.0 * sin(PI * cutoff / SAMPLE_RATE) * 0.5, 0.0001, 0.88);
      let damping = clamp(1.0 / resonance, 0.025, 1.8);
      var low = filterState.xy;
      var band = filterState.zw;
      var high = vec2<f32>(0.0);
      for (var substep = 0u; substep < 2u; substep += 1u) {
        low += frequency * band;
        high = driven - low - damping * band;
        band += frequency * high;
      }
      wet = mix(low, mix(band, high, clamp(resonance / 12.0, 0.0, 1.0)), 0.5);
      filterState = vec4<f32>(low, band);
    } else {
      // RBJ-style normalized biquads share one stereo transposed-direct-form
      // recurrence. Modes 1–7 differ in coefficients, not merely output taps.
      let omega = TAU * cutoff / SAMPLE_RATE;
      let cosine = cos(omega);
      let sine = sin(omega);
      let alpha = sine / (2.0 * max(resonance, 0.05));
      let amplitude = sqrt(max(gain, 0.0001));
      var b0 = 1.0;
      var b1 = 0.0;
      var b2 = 0.0;
      var a0 = 1.0;
      var a1 = 0.0;
      var a2 = 0.0;
      switch mode {
        case 1u: {
          b0 = (1.0 - cosine) * 0.5;
          b1 = 1.0 - cosine;
          b2 = b0;
          a0 = 1.0 + alpha;
          a1 = -2.0 * cosine;
          a2 = 1.0 - alpha;
        }
        case 2u: {
          b0 = (1.0 + cosine) * 0.5;
          b1 = -(1.0 + cosine);
          b2 = b0;
          a0 = 1.0 + alpha;
          a1 = -2.0 * cosine;
          a2 = 1.0 - alpha;
        }
        case 3u: {
          b0 = alpha;
          b1 = 0.0;
          b2 = -alpha;
          a0 = 1.0 + alpha;
          a1 = -2.0 * cosine;
          a2 = 1.0 - alpha;
        }
        case 4u: {
          b0 = 1.0;
          b1 = -2.0 * cosine;
          b2 = 1.0;
          a0 = 1.0 + alpha;
          a1 = -2.0 * cosine;
          a2 = 1.0 - alpha;
        }
        case 5u: {
          b0 = 1.0 + alpha * amplitude;
          b1 = -2.0 * cosine;
          b2 = 1.0 - alpha * amplitude;
          a0 = 1.0 + alpha / amplitude;
          a1 = -2.0 * cosine;
          a2 = 1.0 - alpha / amplitude;
        }
        case 6u: {
          let beta = 2.0 * sqrt(amplitude) * sine * 0.70710678;
          b0 = amplitude * ((amplitude + 1.0) - (amplitude - 1.0) * cosine + beta);
          b1 = 2.0 * amplitude * ((amplitude - 1.0) - (amplitude + 1.0) * cosine);
          b2 = amplitude * ((amplitude + 1.0) - (amplitude - 1.0) * cosine - beta);
          a0 = (amplitude + 1.0) + (amplitude - 1.0) * cosine + beta;
          a1 = -2.0 * ((amplitude - 1.0) + (amplitude + 1.0) * cosine);
          a2 = (amplitude + 1.0) + (amplitude - 1.0) * cosine - beta;
        }
        default: {
          let beta = 2.0 * sqrt(amplitude) * sine * 0.70710678;
          b0 = amplitude * ((amplitude + 1.0) + (amplitude - 1.0) * cosine + beta);
          b1 = -2.0 * amplitude * ((amplitude - 1.0) + (amplitude + 1.0) * cosine);
          b2 = amplitude * ((amplitude + 1.0) + (amplitude - 1.0) * cosine - beta);
          a0 = (amplitude + 1.0) - (amplitude - 1.0) * cosine + beta;
          a1 = 2.0 * ((amplitude - 1.0) - (amplitude + 1.0) * cosine);
          a2 = (amplitude + 1.0) - (amplitude - 1.0) * cosine - beta;
        }
      }
      let inverseA0 = 1.0 / max(abs(a0), 0.000001);
      b0 *= inverseA0;
      b1 *= inverseA0;
      b2 *= inverseA0;
      a1 *= inverseA0;
      a2 *= inverseA0;
      wet = driven * b0 + biquadState.xy;
      let nextZ1 = driven * b1 - wet * a1 + biquadState.zw;
      let nextZ2 = driven * b2 - wet * a2;
      biquadState = vec4<f32>(clamp(nextZ1, vec2<f32>(-8.0), vec2<f32>(8.0)), clamp(nextZ2, vec2<f32>(-8.0), vec2<f32>(8.0)));
    }
    writeStateSample(sample, softClip(advancedEqualPower(input, wet, wetMix) * 1.35));
  }
  advancedWrite(1u, filterState);
  advancedWrite(2u, previous);
  advancedWrite(3u, biquadState);
  markStateContinuous(persistent_state[0]);
}

fn renderFeedbackNetwork(node: GraphNode) {
  let ringFrames = min(u32(max(SAMPLE_RATE * ADVANCED_FEEDBACK_SECONDS, 4.0)) + 2u, max(arrayLength(&persistent_state) - 2u, 1u));
  let dampingStateIndex = 1u + ringFrames;
  let maximumCausalDelay = max(f32(ringFrames) - 2.0, 1.0);
  var header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ringFrames;
  var modulationPhase = select(0.0, fract(header.w), stateIsContinuous());
  var dampingState = advancedRead(dampingStateIndex).xy;
  if (!stateIsContinuous()) {
    advancedClearFrom(1u);
    writePosition = 0u;
    modulationPhase = 0.0;
    dampingState = vec2<f32>(0.0);
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let timeCv = stateInput(node, 1u, sample).x;
    let toneCv = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 5u);
    let delayMs = clamp(p0.y * pow(2.0, timeCv), 0.25, ADVANCED_FEEDBACK_SECONDS * 1000.0 - 2.0);
    let feedback = clamp(p0.z, -0.995, 0.995);
    let diffusion = clamp(p0.w, 0.0, 1.0);
    let damping = clamp(p1.x + toneCv * 0.25, 0.0, 0.995);
    let modRate = clamp(p1.y, 0.001, 20.0);
    let modDepth = clamp(p1.z, 0.0, 20.0) * SAMPLE_RATE * 0.001;
    let wetMix = clamp(p1.w, 0.0, 1.0);
    let baseDelay = delayMs * SAMPLE_RATE * 0.001;
    let movingDelay = clamp(baseDelay + sin(TAU * modulationPhase) * modDepth, 1.0, maximumCausalDelay);
    var wet = advancedFractionalRead(1u, ringFrames, f32(writePosition) - movingDelay);
    var feedbackValue = wet;
    var returnGain = feedback;
    if (mode == 1u) {
      wet = input + wet;
    } else if (mode == 2u) {
      let allpassGain = clamp(feedback * mix(0.25, 1.0, diffusion), -0.995, 0.995);
      wet = wet - input * allpassGain;
      feedbackValue = wet;
      returnGain = allpassGain;
    } else if (mode >= 3u) {
      let lineCount = select(4u, 8u, mode >= 4u);
      var field = vec2<f32>(0.0);
      for (var line = 0u; line < 8u; line += 1u) {
        if (line >= lineCount) { break; }
        let ratio = 0.63 + f32(line) * 0.091 + advancedHash(7307u, line) * 0.047;
        let lineDelay = clamp(movingDelay * ratio, 1.0, maximumCausalDelay);
        var tap = advancedFractionalRead(1u, ringFrames, f32(writePosition) - lineDelay);
        if ((line & 1u) != 0u) { tap = vec2<f32>(tap.y, -tap.x); }
        field += tap;
      }
      field /= sqrt(f32(lineCount));
      wet = mix(wet, field, diffusion);
      feedbackValue = mix(vec2<f32>(field.y, -field.x), wet, 0.5);
      if (mode == 5u) {
        feedbackValue = mix(
          feedbackValue,
          sin(feedbackValue * PI * 1.5) / (PI * 1.5),
          0.32 + diffusion * 0.28
        );
      }
    }
    let dampingCutoff = mix(SAMPLE_RATE * 0.42, 240.0, damping);
    let dampingCoefficient = 1.0 - exp(-TAU * dampingCutoff / SAMPLE_RATE);
    dampingState = mix(dampingState, feedbackValue, dampingCoefficient);
    let damped = mix(feedbackValue, dampingState, damping);
    var next = softClip(input + damped * returnGain);
    if (mode == 2u) { next = clamp(input + damped * returnGain, vec2<f32>(-4.0), vec2<f32>(4.0)); }
    advancedWrite(1u + writePosition, vec4<f32>(next, 0.0, 0.0));
    writeStateSample(sample, softClip(advancedEqualPower(input, wet, wetMix) * 1.3));
    writePosition = (writePosition + 1u) % ringFrames;
    modulationPhase = fract(modulationPhase + modRate / SAMPLE_RATE);
  }
  header = persistent_state[0];
  header.y = f32(writePosition);
  header.w = modulationPhase;
  persistent_state[0] = header;
  advancedWrite(dampingStateIndex, vec4<f32>(dampingState, 0.0, 0.0));
  markStateContinuous(persistent_state[0]);
}

fn advancedWavefieldIndex(bank: u32, cell: u32) -> u32 {
  return 1u + bank * ADVANCED_WAVEFIELD_CELLS + min(cell, ADVANCED_WAVEFIELD_CELLS - 1u);
}

fn advancedWavefieldValue(bank: u32, x: i32, y: i32, side: u32, reflective: bool) -> f32 {
  var sampleX = x;
  var sampleY = y;
  if (reflective) {
    sampleX = clamp(sampleX, 0, i32(side) - 1);
    sampleY = clamp(sampleY, 0, i32(side) - 1);
  } else if (sampleX < 0 || sampleY < 0 || sampleX >= i32(side) || sampleY >= i32(side)) {
    return 0.0;
  }
  let cell = u32(sampleY) * side + u32(sampleX);
  return advancedRead(advancedWavefieldIndex(bank, cell)).x;
}

fn renderWavefieldSolver(node: GraphNode) {
  let targetModel = advancedTransitionedMode(node.target0.x, 5u);
  let targetSide = u32(clamp(round(node.target0.w), 4.0, f32(ADVANCED_WAVEFIELD_SIDE)));
  let targetShape = targetModel * 32u + targetSide;
  let needsReset = !stateIsContinuous()
    || u32(max(round(persistent_state[0].w), 0.0)) != targetShape;
  if (needsReset) {
    for (var clearIndex = state_lane + 1u; clearIndex < arrayLength(&persistent_state); clearIndex += 64u) {
      persistent_state[clearIndex] = vec4<f32>(0.0);
    }
  }
  storageBarrier();
  if (state_lane == 0u && needsReset) { persistent_state[0].w = f32(targetShape); }
  let solverStride = 8u;
  let motionIndex = 1u + ADVANCED_WAVEFIELD_CELLS * 2u;
  var bank = u32(max(round(persistent_state[0].y), 0.0)) & 1u;
  var motion = advancedRead(motionIndex);
  // If a chunk begins between solver ticks, lane zero first completes the
  // interpolation interval retained from the previous chunk.
  let firstUpdateSample = min(
    (solverStride - (render_info.baseSample % solverStride)) % solverStride,
    render_info.sampleCount
  );
  if (state_lane == 0u) {
    for (var sample = 0u; sample < firstUpdateSample; sample += 1u) {
      let solverPhase = (render_info.baseSample + sample) % solverStride;
      let wet = mix(motion.xy, motion.zw, f32(solverPhase) / f32(solverStride));
      let wetMix = clamp(params1(node, sample).w, 0.0, 1.0);
      writeStateSample(sample, softClip(advancedEqualPower(stateInput(node, 0u, sample), wet, wetMix) * 1.45));
    }
  }
  // All lanes update one simulation tick together. Lane zero then expands that
  // tick into full-rate output, avoiding 63 idle lane walks per audio sample.
  for (var updateSample = firstUpdateSample; updateSample < render_info.sampleCount; updateSample += solverStride) {
    let p0 = params0(node, updateSample);
    let p1 = params1(node, updateSample);
    let model = targetModel;
    let propagationControl = clamp(p0.y * exp2(render_info.performancePitch / 48.0), 0.0, 1.0);
    let size = clamp(p0.z, 0.1, 20.0);
    // The UI exposes the square side directly so every integer setting maps
    // to a distinct 4×4 through 16×16 active surface.
    let side = targetSide;
    let activeCells = side * side;
    let materialCv = stateInput(node, 2u, updateSample).x;
    let material = clamp(p1.x + materialCv * 0.5, 0.0, 1.0);
    let damping = clamp(p1.y, 0.0, 0.9995);
    let pickup = clamp(p1.z, 0.02, 0.98);
    let excitation = advancedMono(stateInput(node, 0u, updateSample));
    let positionCv = stateInput(node, 1u, updateSample).x;
    let strikeX = u32(clamp(round((0.5 + positionCv * 0.45) * f32(side - 1u)), 0.0, f32(side - 1u)));
    let strikeY = u32(clamp(round((0.31 + material * 0.37) * f32(side - 1u)), 0.0, f32(side - 1u)));
    let writeBank = 1u - bank;
    // An eight-sample simulation step removes most audio-rate barriers; the
    // pickup is still interpolated into every output sample below. Log
    // mapping keeps the complete 20 Hz–4 kHz control range active while the
    // stable coefficient stays bounded.
    let normalizedSize = clamp(log2(size / 0.1) / log2(200.0), 0.0, 1.0);
    let propagation = pow(propagationControl, 1.35) * 0.78 + (1.0 - normalizedSize) * 0.22;
    let waveSpeed = mix(0.035, 0.34, clamp(propagation, 0.0, 1.0));
    // Four uniform blocks cover the 256-cell maximum. Keeping the loop count
    // identical in all lanes is required before a workgroup barrier.
    for (var cellBlock = 0u; cellBlock < 4u; cellBlock += 1u) {
      let cell = state_lane + cellBlock * 64u;
      if (cell < activeCells) {
        let x = i32(cell % side);
        let y = i32(cell / side);
        let center = advancedWavefieldValue(bank, x, y, side, model == 4u);
        let previous = advancedRead(advancedWavefieldIndex(writeBank, cell)).x;
        let left = advancedWavefieldValue(bank, x - 1, y, side, model == 4u);
        let right = advancedWavefieldValue(bank, x + 1, y, side, model == 4u);
        var laplace = left + right - 2.0 * center;
        if (model >= 2u) {
          let up = advancedWavefieldValue(bank, x, y - 1, side, model == 4u);
          let down = advancedWavefieldValue(bank, x, y + 1, side, model == 4u);
          laplace = left + right + up + down - 4.0 * center;
          if (model == 3u || model == 5u) {
            let diagonal = advancedWavefieldValue(bank, x - 1, y - 1, side, false)
              + advancedWavefieldValue(bank, x + 1, y - 1, side, false)
              + advancedWavefieldValue(bank, x - 1, y + 1, side, false)
              + advancedWavefieldValue(bank, x + 1, y + 1, side, false)
              - 4.0 * center;
            laplace = mix(laplace, diagonal, select(0.18, 0.42, model == 5u));
          }
        }
        var restoring = laplace * waveSpeed;
        if (model == 1u) {
          restoring -= center * center * center * material * 0.18;
        } else if (model == 3u) {
          restoring -= laplace * laplace * sign(laplace) * material * 0.025;
        }
        let boundary = x == 0 || y == 0 || x == i32(side) - 1 || y == i32(side) - 1;
        let boundaryLoss = select(1.0, mix(0.25, 0.94, material), boundary && model != 4u);
        var next = ((2.0 - damping * 0.12) * center - (1.0 - damping * 0.08) * previous + restoring) * boundaryLoss;
        if (u32(x) == strikeX && u32(y) == strikeY) {
          next += excitation * mix(0.18, 0.75, material) * f32(solverStride);
        }
        advancedWrite(advancedWavefieldIndex(writeBank, cell), vec4<f32>(clamp(next, -4.0, 4.0), 0.0, 0.0, 0.0));
      }
    }
    storageBarrier();
    if (state_lane == 0u) {
      let pickupPosition = clamp(pickup + positionCv * 0.25, 0.02, 0.98);
      let pickupX = u32(clamp(round(pickupPosition * f32(side - 1u)), 0.0, f32(side - 1u)));
      let surfacePickupY = u32(clamp(round((0.27 + material * 0.19) * f32(side - 1u)), 0.0, f32(side - 1u)));
      // String modes couple cells along X only, so their pickups must remain
      // on the excited row. Surface/room modes retain a mirrored stereo pair.
      let pickupY = select(surfacePickupY, strikeY, model <= 1u);
      let leftCell = pickupX + pickupY * side;
      let rightCell = select(
        (side - 1u - pickupX) + (side - 1u - pickupY) * side,
        (side - 1u - pickupX) + pickupY * side,
        model <= 1u
      );
      let nextWet = vec2<f32>(
        advancedRead(advancedWavefieldIndex(writeBank, leftCell)).x,
        advancedRead(advancedWavefieldIndex(writeBank, rightCell)).x
      );
      motion = vec4<f32>(motion.zw, nextWet);
      advancedWrite(motionIndex, motion);
      var nextHeader = persistent_state[0];
      nextHeader.y = f32(writeBank);
      persistent_state[0] = nextHeader;
      let blockEnd = min(updateSample + solverStride, render_info.sampleCount);
      for (var sample = updateSample; sample < blockEnd; sample += 1u) {
        let solverPhase = sample - updateSample;
        let wet = mix(motion.xy, motion.zw, f32(solverPhase) / f32(solverStride));
        let wetMix = clamp(params1(node, sample).w, 0.0, 1.0);
        writeStateSample(sample, softClip(advancedEqualPower(stateInput(node, 0u, sample), wet, wetMix) * 1.45));
      }
    }
    bank = writeBank;
  }
  if (state_lane == 0u) { markStateContinuous(persistent_state[0]); }
}

fn advancedSpectralBandBase() -> u32 {
  return 1u;
}

fn renderSpectralTransport(node: GraphNode) {
  if (!stateIsContinuous()) { advancedClearFrom(1u); }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let shiftCv = stateInput(node, 1u, sample).x;
    let timeCv = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 5u);
    let windowSelector = advancedTransitionedMode(p0.y, 4u);
    let windowSize = 256u << windowSelector;
    let hopSelector = advancedTransitionedMode(p0.z, 3u);
    let hopScale = array<f32, 4>(0.125, 0.25, 0.5, 0.75)[hopSelector];
    let pitchRatio = clamp(p0.w * pow(2.0, shiftCv), 0.125, 8.0);
    let timeRatio = clamp(p1.x * pow(2.0, timeCv), 0.125, 8.0);
    let phaseLock = clamp(p1.y, 0.0, 1.0);
    let transients = clamp(p1.z, 0.0, 1.0);
    let wetMix = clamp(p1.w, 0.0, 1.0);
    var resynthesized = vec2<f32>(0.0);
    var energy = 0.0;
    for (var band = 0u; band < ADVANCED_SPECTRAL_BANDS; band += 1u) {
      let bandPosition = (f32(band) + 0.5) / f32(ADVANCED_SPECTRAL_BANDS);
      let sourceHz = 35.0 * pow((SAMPLE_RATE * 0.44) / 35.0, bandPosition);
      var targetHz = clamp(sourceHz * pitchRatio, 20.0, SAMPLE_RATE * 0.44);
      if (mode == 0u) {
        let remappedBand = abs(fract(bandPosition * pitchRatio * 2.0) - 0.5) * 2.0;
        targetHz = 35.0 * pow((SAMPLE_RATE * 0.44) / 35.0, remappedBand);
      }
      // Time transport stretches or compresses spectral-envelope motion while
      // oscillator pitch remains controlled independently below.
      let decay = pow(
        exp(-TAU * max(sourceHz / f32(windowSize), 0.0005) * mix(0.8, 0.2, hopScale)),
        timeRatio
      );
      let rotation = TAU * sourceHz / SAMPLE_RATE;
      let prior = advancedRead(advancedSpectralBandBase() + band * 2u);
      let priorRight = advancedRead(advancedSpectralBandBase() + band * 2u + 1u);
      let cosine = cos(rotation);
      let sine = sin(rotation);
      let leftComplex = vec2<f32>(prior.x * cosine - prior.y * sine, prior.x * sine + prior.y * cosine) * decay + vec2<f32>(input.x, 0.0) * (1.0 - decay);
      let rightComplex = vec2<f32>(priorRight.x * cosine - priorRight.y * sine, priorRight.x * sine + priorRight.y * cosine) * decay + vec2<f32>(input.y, 0.0) * (1.0 - decay);
      // A freshly created Freeze node records its first complete chunk. Once
      // state is continuous—or after arriving from another spectral mode—it
      // holds the resident bands instead of freezing an empty allocation.
      let freeze = mode == 3u && stateIsContinuous();
      let storedLeft = select(leftComplex, prior.xy, freeze);
      let storedRight = select(rightComplex, priorRight.xy, freeze);
      // Carry oscillator phase explicitly instead of multiplying absolute time
      // by a changing ratio; live pitch motion therefore remains continuous.
      let carriedLeftPhase = fract(prior.z + targetHz / SAMPLE_RATE);
      let carriedRightPhase = fract(priorRight.z + targetHz / SAMPLE_RATE);
      let slidingLeftPhase = fract(prior.w + targetHz / SAMPLE_RATE + (bandPosition - 0.5) * 0.0002);
      let slidingRightPhase = fract(priorRight.w + targetHz / SAMPLE_RATE - (bandPosition - 0.5) * 0.0002);
      advancedWrite(advancedSpectralBandBase() + band * 2u, vec4<f32>(storedLeft, carriedLeftPhase, slidingLeftPhase));
      advancedWrite(advancedSpectralBandBase() + band * 2u + 1u, vec4<f32>(storedRight, carriedRightPhase, slidingRightPhase));
      var magnitude = vec2<f32>(length(storedLeft), length(storedRight));
      if (mode == 5u) {
        let threshold = mix(0.003, 0.12, 1.0 - transients);
        magnitude *= smoothstep(vec2<f32>(threshold), vec2<f32>(threshold * 1.8), magnitude);
      }
      let analyzedLeftPhase = atan2(storedLeft.y, storedLeft.x);
      let analyzedRightPhase = atan2(storedRight.y, storedRight.x);
      var carriedLeftAngle = TAU * carriedLeftPhase;
      var carriedRightAngle = TAU * carriedRightPhase;
      if (mode == 2u) {
        carriedLeftAngle = TAU * slidingLeftPhase;
        carriedRightAngle = TAU * slidingRightPhase;
      }
      var leftPhase = advancedBlendPhase(analyzedLeftPhase, carriedLeftAngle, phaseLock);
      var rightPhase = advancedBlendPhase(analyzedRightPhase, carriedRightAngle, phaseLock)
        + bandPosition * PI * (1.0 - phaseLock);
      if (mode == 4u) {
        leftPhase = floor(leftPhase / (PI * 0.5)) * (PI * 0.5);
        rightPhase = floor(rightPhase / (PI * 0.5)) * (PI * 0.5);
      }
      let weight = pow(max(1.0 - bandPosition, 0.01), 0.25 + transients * 1.5);
      resynthesized += vec2<f32>(sin(leftPhase) * magnitude.x, sin(rightPhase) * magnitude.y) * weight;
      energy += weight * weight;
    }
    let wet = resynthesized / max(sqrt(energy), 1.0) * 3.2;
    writeStateSample(sample, softClip(advancedEqualPower(input, wet, wetMix) * 1.3));
  }
  markStateContinuous(persistent_state[0]);
}

fn renderAdvancedDynamics(node: GraphNode) {
  let ringFrames = min(
    u32(max(SAMPLE_RATE * ADVANCED_DYNAMICS_LOOKAHEAD_SECONDS, 2.0)) + 2u,
    max(arrayLength(&persistent_state) - 5u, 1u)
  );
  let stateBase = 1u + ringFrames;
  var header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ringFrames;
  var dynamicsState = advancedRead(stateBase);
  if (!stateIsContinuous()) {
    advancedClearFrom(1u);
    writePosition = 0u;
    dynamicsState = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  }
  var envelope = max(dynamicsState.x, 0.0);
  var gainState = clamp(dynamicsState.y, 0.0, 4.0);
  var detectorHistory = advancedRead(stateBase + 1u);
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let sidechainPatched = stateInput(node, 1u, sample);
    let thresholdCv = stateInput(node, 2u, sample).x;
    let sidechain = select(input, sidechainPatched, advancedInputConnected(node, 1u));
    let mode = advancedTransitionedMode(p0.x, 5u);
    let thresholdDb = clamp(p0.y + thresholdCv * 24.0, -72.0, 6.0);
    let ratio = clamp(p0.z, 1.0, 100.0);
    let attackSeconds = max(p0.w, 0.01) * 0.001;
    let releaseSeconds = max(p1.x, 1.0) * 0.001;
    let kneeDb = clamp(p1.y, 0.0, 24.0);
    let lookaheadSamples = clamp(p1.z, 0.0, ADVANCED_DYNAMICS_LOOKAHEAD_SECONDS * 1000.0) * SAMPLE_RATE * 0.001;
    let makeup = pow(10.0, clamp(p1.w, -24.0, 24.0) / 20.0);
    advancedWrite(1u + writePosition, vec4<f32>(input, 0.0, 0.0));
    let delayed = advancedFractionalRead(1u, ringFrames, f32(writePosition) - lookaheadSamples);
    let rawPeak = max(abs(sidechain.x), abs(sidechain.y));
    let quarter = advancedQuadraticSample(detectorHistory.xy, detectorHistory.zw, sidechain, 0.25);
    let half = advancedQuadraticSample(detectorHistory.xy, detectorHistory.zw, sidechain, 0.5);
    let threeQuarter = advancedQuadraticSample(detectorHistory.xy, detectorHistory.zw, sidechain, 0.75);
    let truePeak = max(rawPeak, max(
      max(abs(quarter.x), abs(quarter.y)),
      max(max(abs(half.x), abs(half.y)), max(abs(threeQuarter.x), abs(threeQuarter.y)))
    ));
    detectorHistory = vec4<f32>(detectorHistory.zw, sidechain);
    let detector = select(rawPeak, truePeak, mode == 2u);
    let attackCoefficient = exp(-1.0 / max(attackSeconds * SAMPLE_RATE, 1.0));
    let releaseCoefficient = exp(-1.0 / max(releaseSeconds * SAMPLE_RATE, 1.0));
    let envelopeCoefficient = select(releaseCoefficient, attackCoefficient, detector > envelope);
    envelope = mix(detector, envelope, envelopeCoefficient);
    let levelDb = 20.0 * log2(max(envelope, 0.0000001)) / log2(10.0);
    let overDb = levelDb - thresholdDb;
    let kneeAmount = smootherstep01((overDb + kneeDb * 0.5) / max(kneeDb, 0.0001));
    var gainDb = 0.0;
    if (mode <= 2u) {
      let activeRatio = select(ratio, 40.0, mode >= 1u);
      gainDb = -max(overDb, 0.0) * (1.0 - 1.0 / activeRatio) * kneeAmount;
    } else if (mode == 3u) {
      gainDb = min(overDb, 0.0) * (ratio - 1.0) * (1.0 - kneeAmount);
    } else if (mode == 4u) {
      gainDb = select(-80.0, 0.0, levelDb >= thresholdDb);
    } else {
      gainDb = clamp(thresholdDb - levelDb, -18.0, 18.0) * 0.35;
    }
    let targetGain = pow(10.0, gainDb / 20.0);
    let gainCoefficient = select(releaseCoefficient, attackCoefficient, targetGain < gainState);
    gainState = mix(targetGain, gainState, gainCoefficient);
    writeStateSample(sample, softClip(delayed * gainState * makeup * 1.4));
    writePosition = (writePosition + 1u) % ringFrames;
  }
  advancedWrite(stateBase, vec4<f32>(envelope, gainState, 0.0, 0.0));
  advancedWrite(stateBase + 1u, detectorHistory);
  header = persistent_state[0];
  header.y = f32(writePosition);
  persistent_state[0] = header;
  markStateContinuous(persistent_state[0]);
}

fn advancedConvolutionTap(
  mode: u32,
  ir: u32,
  tap: u32,
  tapCount: u32,
  sizeSeconds: f32,
  predelaySeconds: f32,
  decaySeconds: f32,
  tone: f32,
  ringFrames: u32,
) -> vec2<f32> {
  let unit = (f32(tap) + 0.5) / f32(max(tapCount, 1u));
  var shaped = unit;
  if (mode == 1u) {
    let partitionIndex = tap / 8u;
    let inside = tap % 8u;
    shaped = (f32(partitionIndex * partitionIndex + inside) + 0.5) / f32(max((tapCount / 8u) * (tapCount / 8u) + 8u, 1u));
  } else if (mode == 2u) {
    shaped = select(unit * 0.08, 0.08 + pow(unit, 1.7) * 0.92, tap >= 12u);
  } else if (mode == 3u) {
    shaped = pow(unit, 0.62) * 0.025;
  } else if (mode == 5u) {
    let harmonic = f32(tap + 1u);
    shaped = mix(0.035, 0.96, (harmonic - 1.0) / f32(max(tapCount - 1u, 1u)));
  }
  let random = advancedHash(9709u + ir * 811u, tap * 17u + mode * 101u);
  let maximumDelaySeconds = f32(max(ringFrames, 3u) - 2u) / SAMPLE_RATE;
  let internalDelaySeconds = shaped * sizeSeconds * mix(0.82, 1.0, random);
  let delaySeconds = clamp(
    predelaySeconds + internalDelaySeconds,
    0.0,
    maximumDelaySeconds
  );
  // Pre-delay moves the whole response; decay is measured from the response's
  // own beginning so changing pre-delay cannot darken or shorten the IR.
  let decay = exp(-6.907755 * internalDelaySeconds / max(decaySeconds, 0.01));
  let color = pow(max(1.0 - unit, 0.001), (1.0 - tone) * 3.0);
  let signValue = select(-1.0, 1.0, ((tap + ir) & 1u) == 0u);
  let pan = random * 2.0 - 1.0;
  return vec2<f32>(delaySeconds * SAMPLE_RATE, signValue * decay * color * (0.45 + abs(pan) * 0.55));
}

fn renderConvolutionSpace(node: GraphNode) {
  let uploadCapacity = min(ADVANCED_CONVOLUTION_UPLOAD_SAMPLES, max(arrayLength(&persistent_state) - 1u, 1u));
  let ringFrames = min(
    u32(max(SAMPLE_RATE * (ADVANCED_CONVOLUTION_SECONDS + ADVANCED_CONVOLUTION_GUARD_SECONDS), 4.0)) + 2u,
    max(arrayLength(&persistent_state) - 1u - uploadCapacity, 1u)
  );
  let uploadBase = 1u + ringFrames;
  let header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ringFrames;
  let clearBlocks = (ringFrames + 63u) / 64u;
  if (!stateIsContinuous()) {
    for (var block = 0u; block < clearBlocks; block += 1u) {
      let index = 1u + state_lane + block * 64u;
      if (index < uploadBase) { persistent_state[index] = vec4<f32>(0.0); }
    }
    writePosition = 0u;
  }
  storageBarrier();
  let sampleBlocks = (render_info.sampleCount + 63u) / 64u;
  // Capture the complete input chunk first. Sparse convolution then has only
  // causal history reads and each lane can own independent output samples.
  for (var block = 0u; block < sampleBlocks; block += 1u) {
    let sample = state_lane + block * 64u;
    if (sample < render_info.sampleCount) {
      let input = stateInput(node, 0u, sample);
      advancedWrite(1u + (writePosition + sample) % ringFrames, vec4<f32>(input, 0.0, 0.0));
    }
  }
  storageBarrier();
  let assetLength = min(u32(max(round(header.w), 0.0)), uploadCapacity);
  // Prewriting the chunk reserves its ring segment. Keep the oldest tap just
  // outside that segment so a long delay never reads a future overwritten slot.
  let maximumTapDelay = f32(max(
    ringFrames - min(render_info.sampleCount + 2u, ringFrames - 1u),
    1u
  ));
  for (var block = 0u; block < sampleBlocks; block += 1u) {
    let sample = state_lane + block * 64u;
    if (sample < render_info.sampleCount) {
      let p0 = params0(node, sample);
      let p1 = params1(node, sample);
      let input = stateInput(node, 0u, sample);
      let morphCv = stateInput(node, 1u, sample).x;
      let sizeCv = stateInput(node, 2u, sample).x;
      let mode = advancedTransitionedMode(p0.x, 5u);
      let ir = advancedTransitionedMode(p0.y + morphCv * 2.0, 7u);
      let sizeSeconds = clamp(p0.z * pow(2.0, sizeCv), 0.01, ADVANCED_CONVOLUTION_SECONDS);
      let predelaySeconds = clamp(p0.w, 0.0, 500.0) * 0.001;
      let decaySeconds = clamp(p1.x, 0.05, 30.0);
      let tone = clamp(p1.y, 0.0, 1.0);
      let width = clamp(p1.z, 0.0, 1.0);
      let wetMix = clamp(p1.w, 0.0, 1.0);
      var tapCount = 24u;
      if (mode == 1u) {
        tapCount = 40u;
      } else if (mode == 2u || mode == 4u) {
        tapCount = 56u;
      }
      var wet = vec2<f32>(0.0);
      var energy = 0.0;
      let sampleWritePosition = (writePosition + sample) % ringFrames;
      for (var tap = 0u; tap < 56u; tap += 1u) {
        if (tap >= tapCount) { break; }
        var tapInfo = advancedConvolutionTap(mode, ir, tap, tapCount, sizeSeconds, predelaySeconds, decaySeconds, tone, ringFrames);
        tapInfo.x = min(tapInfo.x, maximumTapDelay);
        var gainPair = vec2<f32>(tapInfo.y);
        if (ir >= 6u && assetLength > 1u) {
          let assetIndex = min(u32(f32(tap) / f32(max(tapCount - 1u, 1u)) * f32(assetLength - 1u)), assetLength - 1u);
          let impulse = advancedRead(uploadBase + assetIndex);
          let internalDelaySeconds = f32(assetIndex) * sizeSeconds / f32(assetLength);
          tapInfo.x = clamp(
            (predelaySeconds + internalDelaySeconds) * SAMPLE_RATE,
            0.0,
            maximumTapDelay
          );
          let unit = (f32(tap) + 0.5) / f32(max(tapCount, 1u));
          let uploadedDecay = exp(-6.907755 * internalDelaySeconds / max(decaySeconds, 0.01));
          let uploadedTone = pow(max(1.0 - unit, 0.001), (1.0 - tone) * 3.0);
          var uploadedGain = impulse.xy;
          if (ir == 7u) {
            uploadedGain = vec2<f32>(
              impulse.x - impulse.y * 0.35,
              impulse.y - impulse.x * 0.35
            );
          }
          gainPair = uploadedGain * uploadedDecay * uploadedTone;
        } else {
          let pan = advancedHash(19391u + ir * 43u, tap) * 2.0 - 1.0;
          gainPair *= vec2<f32>(
            sqrt(max(0.0, (1.0 - pan) * 0.5)),
            sqrt(max(0.0, (1.0 + pan) * 0.5))
          );
        }
        let tapSignal = advancedFractionalRead(1u, ringFrames, f32(sampleWritePosition) - tapInfo.x);
        let decorrelation = (1.0 + advancedHash(27191u + ir * 59u, tap) * 41.0)
          * width * select(0.45, 1.0, ir == 7u);
        let rightSignal = advancedFractionalRead(
          1u,
          ringFrames,
          f32(sampleWritePosition) - min(tapInfo.x + decorrelation, maximumTapDelay)
        ).y;
        let monoGain = advancedMono(gainPair);
        let monoContribution = vec2<f32>(advancedMono(tapSignal) * monoGain);
        let stereoContribution = vec2<f32>(tapSignal.x, rightSignal) * gainPair;
        wet += mix(monoContribution, stereoContribution, width);
        energy += mix(monoGain * monoGain, dot(gainPair, gainPair) * 0.5, width);
      }
      wet /= max(sqrt(energy), 1.0);
      writeStateSample(sample, softClip(advancedEqualPower(input, wet, wetMix) * 1.35));
    }
  }
  if (state_lane == 0u) {
    var nextHeader = persistent_state[0];
    nextHeader.y = f32((writePosition + render_info.sampleCount) % ringFrames);
    persistent_state[0] = nextHeader;
    markStateContinuous(persistent_state[0]);
  }
}

fn advancedSinc(value: f32) -> f32 {
  if (abs(value) < 0.0001) {
    let squared = value * value;
    return 1.0 - squared / 6.0 + squared * squared / 120.0;
  }
  return sin(value) / value;
}

fn advancedDirichlet(phase: f32, phaseStep: f32, count: f32) -> f32 {
  let safeCount = max(count, 1.0);
  let wrappedStep = phaseStep - floor((phaseStep + PI) / TAU) * TAU;
  let halfStep = wrappedStep * 0.5;
  // sinc(Nh) / sinc(h) is the normalized finite-bank limit. Unlike a raw
  // sin(Nh)/(N sin(h)) division, it remains accurate when h is tiny but N*h
  // spans an audible phase field (the normal million-lane Swarm case).
  let amplitude = advancedSinc(safeCount * halfStep) / advancedSinc(halfStep);
  return sin(phase + (safeCount - 1.0) * halfStep) * amplitude;
}

fn renderMassiveBank(node: GraphNode) {
  let continuous = stateIsContinuous();
  if (!continuous) { advancedClearFrom(1u); }
  var massiveHeader = persistent_state[0];
  var rootPhase = select(0.0, fract(massiveHeader.y), continuous);
  var upperSpreadPhase = select(0.0, fract(massiveHeader.w), continuous);
  let dispersionStateIndex = 1u + ADVANCED_MASSIVE_MODES;
  let initialDispersionState = advancedRead(dispersionStateIndex);
  var dispersionPhase = select(0.0, fract(initialDispersionState.x), continuous);
  var lowerSpreadPhase = select(0.0, fract(initialDispersionState.y), continuous);
  var laneStepPhase = select(0.0, fract(initialDispersionState.z), continuous);
  var oppositeStepPhase = select(0.0, fract(initialDispersionState.w), continuous);
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let excitation = advancedMono(stateInput(node, 0u, sample));
    let pitch = stateInput(node, 1u, sample).x;
    let spectrum = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 4u);
    let frequency = clamp(p0.y * pow(2.0, (pitch + render_info.performancePitch) / 12.0), 10.0, SAMPLE_RATE * 0.42);
    let voices = clamp(round(p0.z), 1.0, 1000000.0);
    let spreadOctaves = clamp(p0.w + spectrum, 0.0, 4.0);
    let spreadUnit = spreadOctaves * 0.25;
    let inharmonicity = clamp(p1.x, 0.0, 2.0);
    let decay = clamp(p1.y, 0.02, 30.0);
    let brightness = clamp(p1.z, -2.0, 2.0);
    let level = max(p1.w, 0.0);
    var activeLaneIntervals = max(voices - 1.0, 1.0);
    var wet = vec2<f32>(0.0);
    if (mode == 0u || mode == 2u || mode == 3u) {
      let count = max(voices, 1.0);
      let basePhase = TAU * rootPhase;
      let bankUpperSpreadPhase = TAU * upperSpreadPhase;
      let bankLowerSpreadPhase = TAU * lowerSpreadPhase;
      let bankDispersionPhase = TAU * dispersionPhase;
      let brightnessUnit = brightness * 0.25 + 0.5;
      var selected = 0.0;
      var opposite = 0.0;
      if (mode == 0u) {
        let antiAliasedCount = min(count, max(1.0, floor(SAMPLE_RATE * 0.45 / frequency)));
        activeLaneIntervals = max(antiAliasedCount - 1.0, 1.0);
        let harmonicStep = basePhase + TAU * laneStepPhase;
        let bank = advancedDirichlet(basePhase - bankLowerSpreadPhase, harmonicStep, antiAliasedCount);
        let bankRight = advancedDirichlet(
          basePhase + bankUpperSpreadPhase * 0.15,
          basePhase + TAU * oppositeStepPhase,
          antiAliasedCount
        );
        selected = mix(sin(basePhase), bank, brightnessUnit);
        opposite = mix(sin(basePhase + bankUpperSpreadPhase * 0.15), bankRight, brightnessUnit);
      } else if (mode == 2u) {
        let laneDensity = clamp(log2(count) / log2(1000000.0), 0.0, 1.0);
        let edge = mix(0.92, 0.045, laneDensity * mix(0.35, 1.0, brightnessUnit));
        let lowEdgePhase = basePhase - bankLowerSpreadPhase - bankDispersionPhase;
        let highEdgePhase = basePhase + bankUpperSpreadPhase + bankDispersionPhase;
        selected = atan(sin(lowEdgePhase) / max(edge, edge + cos(lowEdgePhase))) * (2.0 / PI);
        opposite = atan(sin(highEdgePhase) / max(edge, edge + cos(highEdgePhase))) * (2.0 / PI);
      } else {
        let phaseStep = TAU * laneStepPhase;
        selected = advancedDirichlet(basePhase - bankLowerSpreadPhase, phaseStep, count);
        opposite = advancedDirichlet(basePhase + bankUpperSpreadPhase, -TAU * oppositeStepPhase, count);
        let focused = sin(basePhase + sin(basePhase * 2.0) * spreadUnit);
        selected = mix(focused, selected, brightnessUnit);
      }
      wet = vec2<f32>(selected, mix(selected, opposite, spreadUnit));
    } else {
      let modeCount = min(u32(max(voices, 1.0)), ADVANCED_MASSIVE_MODES);
      var normalization = 0.0;
      for (var partial = 0u; partial < ADVANCED_MASSIVE_MODES; partial += 1u) {
        if (partial >= modeCount) { break; }
        let frequencyScatter = (advancedHash(3109u, partial) * 2.0 - 1.0) * spreadOctaves * 0.5;
        let ratio = pow(f32(partial + 1u), 1.0 + inharmonicity * 0.12) * pow(2.0, frequencyScatter);
        let modalHz = frequency * ratio;
        if (modalHz >= SAMPLE_RATE * 0.46) { break; }
        let prior = advancedRead(1u + partial);
        let radius = exp(-1.0 / max(decay * SAMPLE_RATE / (1.0 + f32(partial) * 0.025), 1.0));
        let coefficient = 2.0 * radius * cos(TAU * modalHz / SAMPLE_RATE);
        let injected = excitation * select(0.08, 0.16, mode == 4u);
        let linearNext = injected + coefficient * prior.x - radius * radius * prior.y;
        let nextValue = select(
          linearNext,
          tanh(linearNext * (1.15 + inharmonicity * 1.8)) * 0.88,
          mode == 4u
        );
        let next = vec2<f32>(nextValue, prior.x);
        advancedWrite(1u + partial, vec4<f32>(next, 0.0, 0.0));
        let weight = pow(f32(partial + 1u), mix(-1.8, -0.35, brightness * 0.25 + 0.5));
        let pan = advancedHash(5101u, partial) * 2.0 - 1.0;
        wet += next.x * weight * vec2<f32>(sqrt((1.0 - pan * spreadUnit) * 0.5), sqrt((1.0 + pan * spreadUnit) * 0.5));
        normalization += weight * weight;
      }
      wet /= max(sqrt(normalization), 1.0);
    }
    writeStateSample(sample, softClip(wet * level * 1.6));
    rootPhase = fract(rootPhase + frequency / SAMPLE_RATE);
    let upperEdgeRatio = pow(2.0, spreadOctaves * 0.5);
    let lowerEdgeRatio = 1.0 / upperEdgeRatio;
    upperSpreadPhase = fract(upperSpreadPhase + frequency * (upperEdgeRatio - 1.0) / SAMPLE_RATE);
    lowerSpreadPhase = fract(lowerSpreadPhase + frequency * (1.0 - lowerEdgeRatio) / SAMPLE_RATE);
    dispersionPhase = fract(dispersionPhase + frequency * inharmonicity * 0.18 / SAMPLE_RATE);
    let laneSpanHz = frequency * (
      upperEdgeRatio - lowerEdgeRatio + inharmonicity * 0.18
    );
    laneStepPhase = fract(laneStepPhase + laneSpanHz / activeLaneIntervals / SAMPLE_RATE);
    oppositeStepPhase = fract(oppositeStepPhase + laneSpanHz * 0.91 / activeLaneIntervals / SAMPLE_RATE);
  }
  massiveHeader = persistent_state[0];
  massiveHeader.y = rootPhase;
  massiveHeader.w = upperSpreadPhase;
  advancedWrite(
    dispersionStateIndex,
    vec4<f32>(dispersionPhase, lowerSpreadPhase, laneStepPhase, oppositeStepPhase)
  );
  markStateContinuous(massiveHeader);
}

fn advancedAnalysisWindow(selector: u32) -> u32 {
  return min(128u << min(selector, 5u), ADVANCED_ANALYSIS_FRAMES);
}

fn renderAudioAnalysisField(node: GraphNode) {
  let ringFrames = min(ADVANCED_ANALYSIS_FRAMES, max(arrayLength(&persistent_state) - 5u, 1u));
  let stateBase = 1u + ringFrames;
  var header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ringFrames;
  var analysis = advancedRead(stateBase);
  if (!stateIsContinuous()) {
    advancedClearFrom(1u);
    writePosition = 0u;
    analysis = vec4<f32>(0.0);
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let mono = advancedMono(input);
    advancedWrite(1u + writePosition, vec4<f32>(input, mono, 0.0));
    let feature = advancedTransitionedMode(p0.x, 7u);
    let windowSize = min(advancedAnalysisWindow(advancedTransitionedMode(p0.y, 5u)), ringFrames);
    let bandLow = clamp(min(p0.z, p0.w), 10.0, SAMPLE_RATE * 0.45);
    let bandHigh = clamp(max(p0.z, p0.w), bandLow + 1.0, SAMPLE_RATE * 0.48);
    let smoothing = clamp(p1.x, 0.0, 0.9999);
    let threshold = clamp(p1.y, 0.0, 1.0);
    let gain = p1.z;
    let offset = p1.w;
    let absoluteSample = render_info.baseSample + sample;
    if (feature == 0u) {
      let featureTarget = mono * 0.5 + 0.5;
      let smoothed = mix(featureTarget, analysis.x, smoothing);
      analysis = vec4<f32>(smoothed, select(0.0, 1.0, smoothed >= threshold), abs(mono), 1.0);
    } else if ((absoluteSample & 63u) == 0u || analysis.w < 0.5) {
      var sumSquares = 0.0;
      var peak = 0.0;
      var derivative = 0.0;
      var crossings = 0.0;
      var bandLowReal = 0.0;
      var bandLowImag = 0.0;
      var bandCenterReal = 0.0;
      var bandCenterImag = 0.0;
      var bandHighReal = 0.0;
      var bandHighImag = 0.0;
      // Lag zero is the current sample, so begin there; lag one then counts the
      // newest edge exactly once instead of once in each direction.
      var prior = advancedRead(1u + writePosition).z;
      let centerHz = sqrt(bandLow * bandHigh);
      for (var lag = 0u; lag < ADVANCED_ANALYSIS_FRAMES; lag += 1u) {
        if (lag >= windowSize) { break; }
        let position = (writePosition + ringFrames - lag) % ringFrames;
        let value = advancedRead(1u + position).z;
        sumSquares += value * value;
        peak = max(peak, abs(value));
        derivative += abs(value - prior);
        crossings += select(0.0, 1.0, (value >= 0.0) != (prior >= 0.0));
        let window = 0.5 - 0.5 * cos(TAU * f32(lag) / max(f32(windowSize - 1u), 1.0));
        let lowAngle = TAU * bandLow * f32(lag) / SAMPLE_RATE;
        let centerAngle = TAU * centerHz * f32(lag) / SAMPLE_RATE;
        let highAngle = TAU * bandHigh * f32(lag) / SAMPLE_RATE;
        bandLowReal += value * cos(lowAngle) * window;
        bandLowImag += value * sin(lowAngle) * window;
        bandCenterReal += value * cos(centerAngle) * window;
        bandCenterImag += value * sin(centerAngle) * window;
        bandHighReal += value * cos(highAngle) * window;
        bandHighImag += value * sin(highAngle) * window;
        prior = value;
      }
      let rms = sqrt(sumSquares / max(f32(windowSize), 1.0));
      let normalizedDerivative = derivative / max(f32(windowSize), 1.0);
      let pitchHz = crossings * SAMPLE_RATE / max(2.0 * f32(windowSize), 1.0);
      let pitchField = clamp(log2(max(pitchHz, 20.0) / 20.0) / log2(20000.0 / 20.0), 0.0, 1.0);
      let lowEnergy = length(vec2<f32>(bandLowReal, bandLowImag));
      let centerEnergy = length(vec2<f32>(bandCenterReal, bandCenterImag));
      let highEnergy = length(vec2<f32>(bandHighReal, bandHighImag));
      let bandEnergy = (lowEnergy + centerEnergy * 2.0 + highEnergy) * 0.5 / max(f32(windowSize), 1.0);
      let probeEnergy = max(lowEnergy + centerEnergy + highEnergy, 0.000001);
      let centroidHz = (lowEnergy * bandLow + centerEnergy * centerHz + highEnergy * bandHigh) / probeEnergy;
      let centroidField = clamp(log2(max(centroidHz, 20.0) / 20.0) / log2(20000.0 / 20.0), 0.0, 1.0);
      let flux = max(rms - analysis.z, 0.0);
      let onsetScore = flux * 12.0 + normalizedDerivative * 0.5;
      var featureTarget = rms;
      switch feature {
        case 1u: { featureTarget = rms; }
        case 2u: { featureTarget = peak; }
        case 3u: { featureTarget = centroidField; }
        case 4u: { featureTarget = flux * 8.0; }
        case 5u: { featureTarget = pitchField; }
        case 6u: { featureTarget = onsetScore; }
        case 7u: { featureTarget = bandEnergy; }
        default: { featureTarget = rms; }
      }
      let smoothed = mix(featureTarget, analysis.x, smoothing);
      analysis = vec4<f32>(smoothed, select(0.0, 1.0, smoothed >= threshold), rms, 1.0);
    }
    let field = analysis.x * gain + offset;
    let gate = analysis.y;
    writeStateSample(sample, vec2<f32>(field, gate));
    writePosition = (writePosition + 1u) % ringFrames;
  }
  advancedWrite(stateBase, analysis);
  header = persistent_state[0];
  header.y = f32(writePosition);
  persistent_state[0] = header;
  markStateContinuous(persistent_state[0]);
}

fn renderDdspResynth(node: GraphNode) {
  let continuous = stateIsContinuous();
  if (!continuous) { advancedClearFrom(1u); }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let pitch = stateInput(node, 0u, sample).x;
    let loudnessInput = stateInput(node, 1u, sample).x;
    let timbreInput = stateInput(node, 2u, sample).x;
    let mode = advancedTransitionedMode(p0.x, 5u);
    let frequency = clamp(p0.y * pow(2.0, (pitch + render_info.performancePitch) / 12.0), 10.0, SAMPLE_RATE * 0.44);
    let harmonics = u32(clamp(round(p0.z), 1.0, 64.0));
    let noiseAmount = clamp(p0.w, 0.0, 1.0);
    let brightness = clamp(p1.x + timbreInput * 0.25, -2.0, 2.0);
    let inharmonicity = clamp(p1.y, 0.0, 1.0);
    let formant = clamp(p1.z + timbreInput * 0.25, 0.0, 1.0);
    let loudnessGain = select(
      1.0,
      clamp(loudnessInput, 0.0, 1.5),
      advancedInputConnected(node, 1u)
    );
    let level = max(p1.w, 0.0) * loudnessGain;
    var harmonic = vec2<f32>(0.0);
    var normalization = 0.0;
    var fundamentalPhase = advancedRead(1u).x;
    // Every oscillator owns a bounded phase accumulator. Advancing even muted
    // partials makes Harmonics, pitch, and inharmonicity edits phase-continuous.
    for (var partial = 1u; partial <= 64u; partial += 1u) {
      let partialPosition = f32(partial - 1u) / f32(max(harmonics - 1u, 1u));
      let ratio = f32(partial) * (1.0 + inharmonicity * partialPosition * partialPosition * select(0.03, 0.18, mode == 3u));
      let phaseCellIndex = 1u + (partial - 1u) / 4u;
      let phaseComponent = (partial - 1u) % 4u;
      var phaseState = advancedRead(phaseCellIndex);
      let partialPhase = fract(phaseState[phaseComponent]);
      if (partial == 1u) { fundamentalPhase = partialPhase; }
      phaseState[phaseComponent] = fract(partialPhase + frequency * ratio / SAMPLE_RATE);
      advancedWrite(phaseCellIndex, phaseState);
      let audiblePartial = partial <= harmonics && frequency * ratio < SAMPLE_RATE * 0.46;
      if (audiblePartial && mode != 1u && mode != 4u) {
        let envelope = pow(f32(partial), mix(-2.2, -0.45, brightness * 0.25 + 0.5));
        let formantCenter = mix(2.0, 18.0, formant);
        let formantWeight = 0.3 + 0.7 * exp(-pow((f32(partial) - formantCenter) / max(1.0 + formant * 6.0, 1.0), 2.0));
        let weight = envelope * mix(1.0, formantWeight, select(0.35, 0.82, mode == 5u));
        let pan = (advancedHash(1103u, partial) * 2.0 - 1.0) * inharmonicity;
        harmonic += sin(TAU * partialPhase) * weight * vec2<f32>(sqrt((1.0 - pan) * 0.5), sqrt((1.0 + pan) * 0.5));
        normalization += weight * weight;
      }
    }
    if (mode != 1u && mode != 4u) {
      harmonic /= max(sqrt(normalization), 1.0);
    }
    // Four independently excited bands form an editable filtered-noise
    // spectrum without claiming an FFT or overlap-add stage.
    var noise = vec2<f32>(0.0);
    var noiseNormalization = 0.0;
    for (var noiseBand = 0u; noiseBand < 4u; noiseBand += 1u) {
      let bandUnit = (f32(noiseBand) + 0.5) * 0.25;
      let shiftedUnit = clamp(bandUnit + brightness * 0.08, 0.01, 0.99);
      let centerHz = 120.0 * pow(16000.0 / 120.0, shiftedUnit);
      let halfWidth = mix(0.22, 0.72, 1.0 - abs(formant - bandUnit));
      let lowerHz = centerHz * pow(2.0, -halfWidth);
      let upperHz = centerHz * pow(2.0, halfWidth);
      let lowerAlpha = 1.0 - exp(-TAU * lowerHz / SAMPLE_RATE);
      let upperAlpha = 1.0 - exp(-TAU * upperHz / SAMPLE_RATE);
      let random = vec2<f32>(
        advancedHash(2903u + noiseBand * 101u, render_info.baseSample + sample) * 2.0 - 1.0,
        advancedHash(7919u + noiseBand * 211u, render_info.baseSample + sample) * 2.0 - 1.0
      );
      var noiseFilter = advancedRead(17u + noiseBand);
      noiseFilter.xy = mix(noiseFilter.xy, random, lowerAlpha);
      noiseFilter.zw = mix(noiseFilter.zw, random, upperAlpha);
      advancedWrite(17u + noiseBand, noiseFilter);
      let formantWeight = 0.2 + 0.8 * exp(-pow((bandUnit - formant) / 0.24, 2.0));
      let tiltWeight = pow(2.0, brightness * (bandUnit - 0.5));
      let bandWeight = formantWeight * tiltWeight;
      noise += (noiseFilter.zw - noiseFilter.xy) * bandWeight;
      noiseNormalization += bandWeight * bandWeight;
    }
    noise /= max(sqrt(noiseNormalization), 1.0);
    if (mode == 4u) {
      noise *= 0.55 + 0.45 * sin(TAU * fundamentalPhase * mix(2.0, 9.0, formant));
    } else if (mode == 5u) {
      noise *= 0.25 + abs(sin(TAU * fundamentalPhase)) * 0.75;
    }
    var selectedNoise = noiseAmount;
    if (mode == 1u || mode == 4u) {
      selectedNoise = 1.0;
    } else if (mode == 2u) {
      selectedNoise = 0.0;
    } else if (mode == 3u) {
      selectedNoise *= 0.12;
    } else if (mode == 5u) {
      selectedNoise *= 0.28;
    }
    let wet = harmonic * sqrt(max(1.0 - selectedNoise, 0.0)) + noise * sqrt(selectedNoise);
    writeStateSample(sample, softClip(wet * level * 1.5));
  }
  markStateContinuous(persistent_state[0]);
}

fn renderSpectralVocoder(node: GraphNode) {
  if (!stateIsContinuous()) { advancedClearFrom(1u); }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let modulatorStereo = stateInput(node, 0u, sample);
    let carrierStereo = stateInput(node, 1u, sample);
    let morph = stateInput(node, 2u, sample).x;
    let modulator = advancedMono(modulatorStereo);
    let externalCarrier = advancedMono(carrierStereo);
    let mode = advancedTransitionedMode(p0.x, 4u);
    let bandCount = u32(clamp(round(p0.y), 4.0, f32(ADVANCED_VOCODER_BANDS)));
    let windowSelector = advancedTransitionedMode(p0.z, 3u);
    let attackSeconds = max(p0.w, 0.05) * 0.001;
    let releaseSeconds = max(p1.x, 1.0) * 0.001;
    let shift = clamp(p1.y * pow(2.0, morph), 0.25, 4.0);
    let contrast = clamp(p1.z, 0.1, 4.0);
    let wetMix = clamp(p1.w, 0.0, 1.0);
    var wet = vec2<f32>(0.0);
    var normalization = 0.0;
    // Analysis first, resynthesis second: shifted envelopes always read the
    // same sample's complete band bank instead of depending on loop direction.
    for (var band = 0u; band < ADVANCED_VOCODER_BANDS; band += 1u) {
      if (band >= bandCount) { break; }
      let unit = (f32(band) + 0.5) / f32(bandCount);
      let center = 70.0 * pow(12000.0 / 70.0, unit);
      let bandwidth = mix(0.18, 0.06, f32(windowSelector) / 3.0);
      let lower = center * pow(2.0, -bandwidth);
      let upper = center * pow(2.0, bandwidth);
      let lowAlpha = 1.0 - exp(-TAU * lower / SAMPLE_RATE);
      let highAlpha = 1.0 - exp(-TAU * upper / SAMPLE_RATE);
      var filters = advancedRead(1u + band * 2u);
      var bandState = advancedRead(1u + band * 2u + 1u);
      filters.x = mix(filters.x, modulator, lowAlpha);
      filters.y = mix(filters.y, modulator, highAlpha);
      var carrier = externalCarrier;
      if (!advancedInputConnected(node, 1u) || mode == 2u) {
        carrier = advancedHash(6301u + band, render_info.baseSample + sample) * 2.0 - 1.0;
      }
      let robotPhase = fract(bandState.y);
      if (mode == 3u) { carrier = sin(TAU * robotPhase); }
      bandState.y = fract(robotPhase + center / SAMPLE_RATE);
      filters.z = mix(filters.z, carrier, lowAlpha);
      filters.w = mix(filters.w, carrier, highAlpha);
      let modBand = filters.y - filters.x;
      let carrierBand = filters.w - filters.z;
      let detector = abs(modBand);
      let attackCoefficient = exp(-1.0 / max(attackSeconds * SAMPLE_RATE, 1.0));
      let releaseCoefficient = exp(-1.0 / max(releaseSeconds * SAMPLE_RATE, 1.0));
      let envelopeCoefficient = select(releaseCoefficient, attackCoefficient, detector > bandState.x);
      let nextEnvelope = mix(detector, bandState.x, envelopeCoefficient);
      // A new Freeze node learns its first chunk; later chunks hold the bank.
      let envelope = select(nextEnvelope, bandState.x, mode == 4u && stateIsContinuous());
      bandState.x = envelope;
      advancedWrite(1u + band * 2u, filters);
      advancedWrite(1u + band * 2u + 1u, bandState);
    }
    for (var band = 0u; band < ADVANCED_VOCODER_BANDS; band += 1u) {
      if (band >= bandCount) { break; }
      let unit = (f32(band) + 0.5) / f32(bandCount);
      let filters = advancedRead(1u + band * 2u);
      let bandState = advancedRead(1u + band * 2u + 1u);
      let modBand = filters.y - filters.x;
      let carrierBand = filters.w - filters.z;
      let shiftedPosition = clamp((f32(band) + 0.5) / shift - 0.5, 0.0, f32(bandCount - 1u));
      let shiftedBand = u32(round(shiftedPosition));
      let shiftedEnvelope = advancedRead(1u + shiftedBand * 2u + 1u).x;
      let shapedEnvelope = pow(max(shiftedEnvelope, 0.000001), contrast);
      var voice = carrierBand * shapedEnvelope;
      if (mode == 1u) { voice = sign(modBand) * abs(carrierBand) * shapedEnvelope; }
      let pan = (unit * 2.0 - 1.0) * 0.72;
      wet += voice * vec2<f32>(sqrt((1.0 - pan) * 0.5), sqrt((1.0 + pan) * 0.5));
      normalization += shapedEnvelope * shapedEnvelope;
    }
    wet /= max(sqrt(normalization), 0.35);
    writeStateSample(sample, softClip(advancedEqualPower(modulatorStereo, wet * 8.0, wetMix) * 1.45));
  }
  markStateContinuous(persistent_state[0]);
}

fn advancedNeuralWeight(layer: u32, index: u32) -> f32 {
  let values = array<f32, 16>(
    0.421, -0.283, 0.167, 0.519,
    -0.337, 0.118, 0.296, -0.451,
    0.214, 0.363, -0.172, 0.087,
    -0.126, 0.478, 0.239, -0.305
  );
  return values[(index + layer * 5u) % 16u];
}

fn renderNeuralProcessor(node: GraphNode) {
  let hiddenBase = 1u + ADVANCED_NEURAL_HISTORY;
  var header = persistent_state[0];
  var writePosition = u32(max(round(header.y), 0.0)) % ADVANCED_NEURAL_HISTORY;
  if (!stateIsContinuous()) {
    advancedClearFrom(1u);
    writePosition = 0u;
  }
  for (var sample = 0u; sample < render_info.sampleCount; sample += 1u) {
    let p0 = params0(node, sample);
    let p1 = params1(node, sample);
    let input = stateInput(node, 0u, sample);
    let conditionInput = stateInput(node, 1u, sample).x;
    let morphInput = stateInput(node, 2u, sample).x;
    let model = advancedTransitionedMode(p0.x, 5u);
    let size = advancedTransitionedMode(p0.y, 3u);
    let drive = clamp(p0.z, 0.0, 2.0);
    let memory = clamp(p0.w, 0.0, 1.0);
    let condition = clamp(p1.x + conditionInput * p1.y + morphInput * 0.5, -2.0, 2.0);
    let wetMix = clamp(p1.z, 0.0, 1.0);
    let level = max(p1.w, 0.0);
    advancedWrite(1u + writePosition, vec4<f32>(input, condition, 0.0));
    let mono = advancedMono(input) * mix(0.5, 4.0, drive * 0.5);
    var network = 0.0;
    if (model == 0u || model == 2u || model == 3u || model == 4u) {
      let tapCount = 4u + size * 3u;
      var norm = 0.0;
      for (var tap = 0u; tap < 16u; tap += 1u) {
        if (tap >= tapCount) { break; }
        let baseDilation = f32(1u << min(tap / 2u, 8u));
        let stretchedDilation = clamp(baseDilation * mix(0.5, 4.0, memory), 0.0, f32(ADVANCED_NEURAL_HISTORY - 2u));
        let lowerDelay = u32(floor(stretchedDilation));
        let upperDelay = min(lowerDelay + 1u, ADVANCED_NEURAL_HISTORY - 1u);
        let lowerPosition = (writePosition + ADVANCED_NEURAL_HISTORY - lowerDelay) % ADVANCED_NEURAL_HISTORY;
        let upperPosition = (writePosition + ADVANCED_NEURAL_HISTORY - upperDelay) % ADVANCED_NEURAL_HISTORY;
        let value = mix(
          advancedRead(1u + lowerPosition).x,
          advancedRead(1u + upperPosition).x,
          fract(stretchedDilation)
        );
        let weight = advancedNeuralWeight(model + size, tap);
        network += tanh(value * (1.0 + drive) + condition * advancedNeuralWeight(7u, tap)) * weight;
        norm += abs(weight);
      }
      network /= max(norm * 0.62, 0.5);
      if (model == 2u) { network = tanh(network * 2.4 + mono * 0.7); }
      if (model == 3u) { network = mix(network, mono - network * 0.35, 0.42); }
      if (model == 4u) {
        let confidence = smootherstep01((abs(mono) - mix(0.18, 0.015, memory)) * 8.0);
        network *= confidence;
      }
    } else {
      let hiddenCount = 4u + size * 4u;
      var hiddenMix = 0.0;
      for (var hidden = 0u; hidden < ADVANCED_NEURAL_HIDDEN; hidden += 1u) {
        if (hidden >= hiddenCount) { break; }
        let prior = advancedRead(hiddenBase + hidden).x;
        let neighbor = advancedRead(hiddenBase + (hidden + hiddenCount - 1u) % hiddenCount).x;
        let inputWeight = advancedNeuralWeight(2u + model, hidden);
        let recurrentWeight = advancedNeuralWeight(9u, hidden) * mix(0.2, 0.92, memory);
        let gate = smootherstep01(0.5 + condition * advancedNeuralWeight(12u, hidden) * 0.25);
        let candidate = tanh(mono * inputWeight + neighbor * recurrentWeight + condition * 0.18);
        let next = mix(prior, candidate, mix(0.05, 0.8, gate));
        advancedWrite(hiddenBase + hidden, vec4<f32>(next, 0.0, 0.0, 0.0));
        hiddenMix += next * advancedNeuralWeight(5u, hidden);
      }
      network = hiddenMix / sqrt(f32(hiddenCount));
      if (model == 5u) { network = mix(network, sin(network * PI * (1.0 + drive * 2.0)), clamp(morphInput * 0.5 + 0.5, 0.0, 1.0)); }
    }
    let wet = vec2<f32>(network, mix(network, -network, 0.08 + memory * 0.12)) + input * 0.12;
    writeStateSample(sample, softClip(advancedEqualPower(input, wet, wetMix) * level * 1.55));
    writePosition = (writePosition + 1u) % ADVANCED_NEURAL_HISTORY;
  }
  header = persistent_state[0];
  header.y = f32(writePosition);
  persistent_state[0] = header;
  markStateContinuous(persistent_state[0]);
}
`;
