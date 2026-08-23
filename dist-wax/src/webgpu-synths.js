import { connectAudioOutput } from "./audio-output-manager.js";

const NUM_CHANNELS = 2;
const TIME_INFO_BUFFER_SIZE = 16;
const MAX_BUFFERED_CHUNKS = 2.5;
export const WEBGPU_SYNTHS_SEQUENCE_LENGTH = 64;
const PARAM_BUFFER_SIZE = 16 * Float32Array.BYTES_PER_ELEMENT;
const SEQUENCE_BUFFER_SIZE = WEBGPU_SYNTHS_SEQUENCE_LENGTH * 4 * Float32Array.BYTES_PER_ELEMENT;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const fract = (value) => value - Math.floor(value);
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function setParamValue(param, value, time = 0) {
  if (typeof param?.setValueAtTime === "function") param.setValueAtTime(value, time);
  else if (param) param.value = value;
}

function setTarget(param, value, time = 0, constant = 0.015) {
  if (typeof param?.setTargetAtTime === "function") param.setTargetAtTime(value, time, constant);
  else setParamValue(param, value, time);
}

export const WEBGPU_SYNTHS_MODELS = Object.freeze([
  "Spectral Acid",
  "Cascade FM",
  "Wavefold Table",
  "Modal Metal",
  "Particle Cloud",
]);

export const WEBGPU_SYNTHS_SCALES = Object.freeze([
  "Chromatic",
  "Dorian",
  "Phrygian",
  "Harmonic Minor",
  "Whole Tone",
  "Quartertone",
]);

export const WEBGPU_SYNTHS_PARAM_ORDER = Object.freeze([
  "topology",
  "baseNote",
  "clock",
  "steps",
  "glide",
  "complexity",
  "color",
  "motion",
  "decay",
  "fold",
  "space",
  "chaos",
  "swing",
  "gain",
  "seed",
  "scale",
]);

export const WEBGPU_SYNTHS_DEFAULTS = Object.freeze({
  topology: 0,
  baseNote: 34,
  clock: 5.2,
  steps: 16,
  glide: 0.08,
  complexity: 0.58,
  color: 0.48,
  motion: 0.32,
  decay: 0.42,
  fold: 0.24,
  space: 0.44,
  chaos: 0.16,
  swing: 0.08,
  gain: 0.12,
  seed: 17011,
  scale: 1,
});

export const WEBGPU_SYNTHS_LIMITS = Object.freeze({
  topology: Object.freeze([0, WEBGPU_SYNTHS_MODELS.length - 1]),
  baseNote: Object.freeze([18, 78]),
  clock: Object.freeze([0.25, 20]),
  steps: Object.freeze([4, WEBGPU_SYNTHS_SEQUENCE_LENGTH]),
  glide: Object.freeze([0, 1]),
  complexity: Object.freeze([0, 1]),
  color: Object.freeze([0, 1]),
  motion: Object.freeze([0, 1]),
  decay: Object.freeze([0.03, 1.8]),
  fold: Object.freeze([0, 1]),
  space: Object.freeze([0, 1]),
  chaos: Object.freeze([0, 1]),
  swing: Object.freeze([0, 0.42]),
  gain: Object.freeze([0, 0.22]),
  seed: Object.freeze([1, 65535]),
  scale: Object.freeze([0, WEBGPU_SYNTHS_SCALES.length - 1]),
});

export const WEBGPU_SYNTHS_RUNTIME_DEFAULTS = Object.freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  output: 1,
});

export const WEBGPU_SYNTHS_WORKGROUP_SIZES = Object.freeze([32, 64, 128, 256]);

export function sanitizeWebGpuSynthParams(params = {}) {
  const sanitized = {};
  for (const key of WEBGPU_SYNTHS_PARAM_ORDER) {
    const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
    const value = clamp(finiteOr(params[key], WEBGPU_SYNTHS_DEFAULTS[key]), minimum, maximum);
    sanitized[key] = key === "steps" || key === "seed" || key === "scale" ? Math.round(value) : value;
  }
  return sanitized;
}

export function webGpuSynthParamArray(params = {}) {
  const sanitized = sanitizeWebGpuSynthParams(params);
  return new Float32Array(WEBGPU_SYNTHS_PARAM_ORDER.map((key) => sanitized[key]));
}

export const WEBGPU_SYNTHS_DEFAULT_STEP = Object.freeze([0.5, 0, 0.5, 0.5]);

export function sanitizeWebGpuSynthSequence(sequence = []) {
  return Array.from({ length: WEBGPU_SYNTHS_SEQUENCE_LENGTH }, (_, index) => {
    const candidate = sequence?.[index];
    return WEBGPU_SYNTHS_DEFAULT_STEP.map((fallback, lane) => (
      clamp(finiteOr(candidate?.[lane], fallback), 0, 1)
    ));
  });
}

export function webGpuSynthSequenceArray(sequence = []) {
  return new Float32Array(sanitizeWebGpuSynthSequence(sequence).flat());
}

function seededNoise(index, seed) {
  return fract(Math.sin((index + 1) * 91.713 + seed * 0.173) * 43758.5453123);
}

function euclideanPulse(step, pulses, steps, rotation = 0) {
  const wrapped = ((step + rotation) % steps + steps) % steps;
  return ((wrapped * pulses) % steps) < pulses;
}

/**
 * Create one four-lane musical genome on the CPU. The browser only uploads this
 * declarative DNA; lane decoding, timing, quantization, envelopes, synthesis,
 * spatialization, drive, and limiting remain inside WEBGPU_SYNTHS_SHADER.
 */
export function createWebGpuSynthSequence(technique = "euclid", {
  steps = WEBGPU_SYNTHS_DEFAULTS.steps,
  seed = WEBGPU_SYNTHS_DEFAULTS.seed,
  variation = 0,
} = {}) {
  const length = clamp(Math.round(finiteOr(steps, WEBGPU_SYNTHS_DEFAULTS.steps)), 4, WEBGPU_SYNTHS_SEQUENCE_LENGTH);
  const safeSeed = Math.round(finiteOr(seed, WEBGPU_SYNTHS_DEFAULTS.seed));
  const amount = clamp(finiteOr(variation, 0), 0, 1);
  const generated = [];
  let walker = seededNoise(0, safeSeed);
  let cellular = Array.from({ length }, (_, index) => seededNoise(index, safeSeed + 71) > 0.52 ? 1 : 0);

  for (let step = 0; step < length; step += 1) {
    const a = seededNoise(step * 4, safeSeed);
    const b = seededNoise(step * 4 + 1, safeSeed);
    const c = seededNoise(step * 4 + 2, safeSeed);
    const d = seededNoise(step * 4 + 3, safeSeed);
    let pitch;
    let energy;
    let timbre;
    let morph;

    if (technique === "brownian") {
      walker = clamp(walker + (a - 0.5) * (0.22 + amount * 0.42), 0, 1);
      pitch = walker;
      energy = step % 4 === 0 ? 1 : 0.36 + b * 0.5;
      timbre = clamp(0.5 + (c - 0.5) * (0.5 + amount), 0, 1);
      morph = clamp(walker * 0.65 + d * 0.35, 0, 1);
    } else if (technique === "cellular") {
      const left = cellular[(step - 1 + length) % length];
      const center = cellular[step];
      const right = cellular[(step + 1) % length];
      const ruleBit = left * 4 + center * 2 + right;
      const alive = ((110 >> ruleBit) & 1) === 1;
      pitch = fract((step * 5 + ruleBit * 3) / 17 + a * amount * 0.3);
      energy = alive ? 0.72 + b * 0.28 : (c < amount * 0.24 ? 0.3 : 0);
      timbre = ruleBit / 7;
      morph = fract((left + center * 2 + right * 4) / 7 + d * amount);
    } else if (technique === "recurrence") {
      pitch = fract((step * 0.61803398875) + a * amount * 0.25);
      energy = step % 3 === 0 || step % 5 === 0 ? 0.76 + b * 0.24 : (c < 0.2 + amount * 0.2 ? 0.4 : 0);
      timbre = fract(step * step * 0.071 + c * 0.3);
      morph = fract(step * 0.38196601125 + d * amount);
    } else if (technique === "orbit") {
      const angle = (step / length) * Math.PI * 2;
      pitch = clamp(0.5 + Math.sin(angle * 3 + safeSeed) * 0.34 + (a - 0.5) * amount * 0.2, 0, 1);
      energy = Math.cos(angle * 5) > -0.12 ? 0.58 + b * 0.42 : 0;
      timbre = 0.5 + Math.sin(angle * 2 + 1.7) * 0.46;
      morph = 0.5 + Math.cos(angle * 4 + 0.6) * 0.46;
    } else if (technique === "noise") {
      pitch = a;
      energy = b > 0.28 - amount * 0.18 ? 0.35 + b * 0.65 : 0;
      timbre = c;
      morph = d;
    } else {
      const pulses = Math.max(1, Math.round(length * (0.32 + amount * 0.28)));
      pitch = fract(step * 0.217 + a * amount * 0.25);
      energy = euclideanPulse(step, pulses, length, Math.round(safeSeed % length)) ? 0.66 + b * 0.34 : 0;
      timbre = fract(step / Math.max(1, length - 1) + c * 0.2);
      morph = 0.5 + Math.sin((step / length) * Math.PI * 4) * 0.42;
    }
    generated.push([pitch, energy, clamp(timbre, 0, 1), clamp(morph, 0, 1)]);
  }

  const sequence = Array.from({ length: WEBGPU_SYNTHS_SEQUENCE_LENGTH }, (_, index) => (
    index < length ? generated[index] : WEBGPU_SYNTHS_DEFAULT_STEP
  ));
  return sanitizeWebGpuSynthSequence(sequence);
}

export function varyWebGpuSynthSequence(sequence, lane = "all", amount = 0.18, seed = Date.now()) {
  const laneIndex = Object.freeze({ pitch: 0, energy: 1, timbre: 2, morph: 3 });
  const selected = lane === "all" ? null : laneIndex[lane];
  const depth = clamp(finiteOr(amount, 0.18), 0, 1);
  return sanitizeWebGpuSynthSequence(sequence).map((step, stepIndex) => step.map((value, index) => {
    if (selected !== null && selected !== index) return value;
    const signed = seededNoise(stepIndex * 7 + index, finiteOr(seed, 1)) * 2 - 1;
    if (index === 1 && value <= 0.01 && signed < 0.72) return value;
    return clamp(value + signed * depth, 0, 1);
  }));
}

export function webGpuSynthModelLabel(topology) {
  const value = clamp(finiteOr(topology, 0), 0, WEBGPU_SYNTHS_MODELS.length - 1);
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  if (lower === upper) return WEBGPU_SYNTHS_MODELS[lower];
  return `${WEBGPU_SYNTHS_MODELS[lower]} × ${WEBGPU_SYNTHS_MODELS[upper]}`;
}

export function webGpuSynthSupport(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  const audio = Boolean(AudioContextCtor);
  return Object.freeze({ audio, webgpu, supported: audio && webgpu });
}

export const WEBGPU_SYNTHS_SHADER = `// Morphazoid WebGPU Synths.
// Every musical operation below runs in WGSL: sequence clock, swing, lane
// decoding, scale quantization, envelope, topology morph, synthesis, stereo,
// nonlinear drive, and safety limiting. The host only uploads parameters and
// plays completed stereo buffers.
const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;

override WORKGROUP_SIZE: u32 = 256;
override SAMPLE_RATE: f32 = 44100.0;

struct TimeInfo { offset: f32 }
struct SynthParam {
  topology: f32,
  baseNote: f32,
  clock: f32,
  steps: f32,
  glide: f32,
  complexity: f32,
  color: f32,
  motion: f32,
  decay: f32,
  fold: f32,
  space: f32,
  chaos: f32,
  swing: f32,
  gain: f32,
  seed: f32,
  scale: f32,
}

@group(0) @binding(0) var<uniform> time_info: TimeInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> synth_param: SynthParam;
@group(0) @binding(3) var<storage, read> sequence_dna: array<vec4<f32>>;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1 + synth_param.seed * 0.0137) * 43758.5453123);
}

fn softClip(value: vec2<f32>) -> vec2<f32> {
  return value / (vec2(1.0) + abs(value));
}

fn swingTime(straightTime: f32, swing: f32) -> f32 {
  let amount = clamp(swing, 0.0, 0.42);
  let pair = floor(straightTime * 0.5);
  let within = straightTime - pair * 2.0;
  let evenDuration = 1.0 + amount;
  if (within < evenDuration) {
    return pair * 2.0 + within / evenDuration;
  }
  return pair * 2.0 + 1.0 + (within - evenDuration) / (1.0 - amount);
}

fn modeDegree(degree: u32, scale: u32) -> f32 {
  if (scale == 1u) {
    switch degree { case 0u: { return 0.0; } case 1u: { return 2.0; } case 2u: { return 3.0; } case 3u: { return 5.0; } case 4u: { return 7.0; } case 5u: { return 9.0; } default: { return 10.0; } }
  }
  if (scale == 2u) {
    switch degree { case 0u: { return 0.0; } case 1u: { return 1.0; } case 2u: { return 3.0; } case 3u: { return 5.0; } case 4u: { return 7.0; } case 5u: { return 8.0; } default: { return 10.0; } }
  }
  switch degree { case 0u: { return 0.0; } case 1u: { return 2.0; } case 2u: { return 3.0; } case 3u: { return 5.0; } case 4u: { return 7.0; } case 5u: { return 8.0; } default: { return 11.0; } }
}

fn scaleNote(normalized: f32, scaleValue: f32) -> f32 {
  let scale = u32(round(clamp(scaleValue, 0.0, 5.0)));
  if (scale == 0u) { return floor(normalized * 25.0); }
  if (scale == 4u) { return floor(normalized * 13.0) * 2.0; }
  if (scale == 5u) { return floor(normalized * 49.0) * 0.5; }
  let index = u32(floor(normalized * 21.0));
  return f32(index / 7u) * 12.0 + modeDegree(index % 7u, scale);
}

fn midiFrequency(note: f32) -> f32 {
  return 440.0 * pow(2.0, (note - 69.0) / 12.0);
}

fn spectralAcid(t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  var voice = vec2(0.0);
  let requested = 4u + u32(floor(synth_param.complexity * 20.0));
  let cutoff = 1.5 + timbre * 21.0 + exp(-local * 6.0) * (4.0 + motion * 18.0);
  let resonance = 0.8 + synth_param.fold * 8.0;
  for (var partial = 1u; partial <= 24u; partial += 1u) {
    if (partial > requested) { break; }
    let harmonic = f32(partial);
    let distance = abs(harmonic - cutoff);
    let lowpass = exp(-max(harmonic - cutoff, 0.0) * (0.18 + (1.0 - timbre) * 0.35));
    let peak = exp(-distance * distance * 0.32) * resonance;
    let level = (lowpass + peak) / harmonic;
    let phase = t * frequency * harmonic * TAU;
    voice.x += sin(phase + motion * harmonic * 0.012) * level;
    voice.y += sin(phase - motion * harmonic * 0.012) * level;
  }
  return voice * 0.24;
}

fn cascadeFm(t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  let phase = t * frequency * TAU;
  let index = 0.4 + synth_param.complexity * 8.5 + timbre * 4.0;
  let ratio = 1.0 + floor(timbre * 7.0) * 0.5 + motion * 0.13;
  let op4 = sin(phase * ratio * 3.01 + local * motion * 9.0);
  let op3 = sin(phase * ratio * 2.0 + op4 * index * 0.35);
  let op2 = sin(phase * ratio + op3 * index * 0.58);
  let left = sin(phase + op2 * index);
  let right = sin(phase * (1.0 + synth_param.space * 0.0015) + op2 * index + op3 * motion * 0.4);
  return vec2(left, right) * 0.62;
}

fn wavefoldTable(t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  let phase = fract(t * frequency);
  let sine = sin(phase * TAU);
  let triangle = abs(phase * 4.0 - 2.0) - 1.0;
  let saw = phase * 2.0 - 1.0;
  let tableA = mix(sine, triangle, smoothstep(0.0, 0.55, timbre));
  let table = mix(tableA, saw, smoothstep(0.48, 1.0, timbre));
  let folds = 1.0 + synth_param.fold * 10.0 + motion * 3.0;
  let left = sin((table + sin(local * TAU) * motion * 0.08) * folds * PI);
  let right = sin((table - sin(local * TAU) * motion * 0.08) * folds * PI + synth_param.space * 0.12);
  return vec2(left, right) * 0.58;
}

fn modalMetal(t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  var voice = vec2(0.0);
  let requested = 4u + u32(floor(synth_param.complexity * 8.0));
  for (var mode = 0u; mode < 12u; mode += 1u) {
    if (mode >= requested) { break; }
    let order = f32(mode + 1u);
    let stiffness = order + order * order * (0.006 + timbre * 0.038);
    let ratio = stiffness + hash11(f32(mode) + motion * 17.0) * timbre * 0.22;
    let damping = exp(-local * (1.8 + order * (0.35 + (1.0 - synth_param.decay) * 0.6)));
    let level = damping / sqrt(order);
    voice.x += sin(t * frequency * ratio * TAU + order * 0.19) * level;
    voice.y += sin(t * frequency * ratio * TAU - order * (0.19 + synth_param.space * 0.05)) * level;
  }
  return voice * 0.22;
}

fn particleCloud(t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  var voice = vec2(0.0);
  let density = 5.0 + synth_param.complexity * 31.0 + motion * 12.0;
  let requested = 3u + u32(floor(synth_param.complexity * 5.0));
  for (var grain = 0u; grain < 8u; grain += 1u) {
    if (grain >= requested) { break; }
    let offset = hash11(f32(grain) * 19.7);
    let grainPosition = fract(local * density + offset);
    let window = sin(grainPosition * PI);
    let detune = (hash11(f32(grain) * 31.1) - 0.5) * (0.02 + timbre * 0.18);
    let ratio = 0.5 + floor(hash11(f32(grain) * 7.3) * 7.0) * 0.5;
    let phase = t * frequency * ratio * (1.0 + detune) * TAU;
    let grit = hash11(floor(t * SAMPLE_RATE / (3.0 + timbre * 22.0)) + f32(grain)) * 2.0 - 1.0;
    let particle = mix(sin(phase), grit, timbre * 0.42) * window * window;
    let pan = hash11(f32(grain) * 53.0) * 2.0 - 1.0;
    voice += vec2(particle * (1.0 - pan * synth_param.space), particle * (1.0 + pan * synth_param.space));
  }
  return voice * 0.2;
}

fn synthModel(model: u32, t: f32, local: f32, frequency: f32, timbre: f32, motion: f32) -> vec2<f32> {
  switch model {
    case 0u: { return spectralAcid(t, local, frequency, timbre, motion); }
    case 1u: { return cascadeFm(t, local, frequency, timbre, motion); }
    case 2u: { return wavefoldTable(t, local, frequency, timbre, motion); }
    case 3u: { return modalMetal(t, local, frequency, timbre, motion); }
    default: { return particleCloud(t, local, frequency, timbre, motion); }
  }
}

fn mainSound(time: f32) -> vec2<f32> {
  let straight = time * synth_param.clock;
  let clock = swingTime(straight, synth_param.swing);
  let stepCount = u32(clamp(round(synth_param.steps), 4.0, f32(arrayLength(&sequence_dna))));
  let absoluteStep = u32(max(floor(clock), 0.0));
  let stepIndex = absoluteStep % stepCount;
  let nextIndex = (stepIndex + 1u) % stepCount;
  let phase = fract(clock);
  let current = sequence_dna[stepIndex];
  let following = sequence_dna[nextIndex];
  let glideWindow = max(0.001, 1.0 - synth_param.glide);
  let glide = smoothstep(glideWindow, 1.0, phase);
  let pitchLane = mix(current.x, following.x, glide);
  let note = synth_param.baseNote + scaleNote(pitchLane, synth_param.scale);
  let frequency = midiFrequency(note);
  let energy = current.y;
  let attack = smoothstep(0.0, 0.018, phase);
  let envelope = attack * exp(-phase / max(0.03, synth_param.decay)) * energy;
  let timbre = clamp(mix(synth_param.color, current.z, 0.7), 0.0, 1.0);
  let motion = clamp(mix(synth_param.motion, current.w, 0.68), 0.0, 1.0);
  let local = phase / max(synth_param.clock, 0.001);

  let topology = clamp(
    synth_param.topology + (current.w - 0.5) * synth_param.chaos * 1.8,
    0.0,
    4.0
  );
  let lower = u32(floor(topology));
  let upper = min(lower + 1u, 4u);
  let blend = smoothstep(0.0, 1.0, fract(topology));
  let modelA = synthModel(lower, time, local, frequency, timbre, motion);
  let modelB = synthModel(upper, time, local, frequency, timbre, motion);
  var voice = mix(modelA, modelB, blend) * envelope;

  let orbit = sin((time * (0.07 + motion * 0.41) + f32(stepIndex) * 0.173) * TAU);
  let pan = orbit * synth_param.space * 0.48;
  voice = vec2(voice.x * (1.0 - pan), voice.y * (1.0 + pan));
  let drive = 1.0 + synth_param.fold * 7.0 + synth_param.chaos * current.z * 3.0;
  return clamp(softClip(voice * drive) * synth_param.gain * 5.0, vec2(-0.88), vec2(0.88));
}

@compute
@workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sample = global_id.x;
  if (sample >= arrayLength(&sound_chunk)) { return; }
  let time = time_info.offset + f32(sample) / SAMPLE_RATE;
  sound_chunk[sample] = mainSound(time);
}`;

function requireGpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !mapMode) throw new Error("WebGPU constants are not available in this browser context.");
  return { usage, mapMode };
}

export class WebGpuSynthLabAudio {
  constructor(runtime = globalThis, {
    chunkDuration = WEBGPU_SYNTHS_RUNTIME_DEFAULTS.chunkDuration,
    workgroupSize = WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize,
  } = {}) {
    this.runtime = runtime;
    this.chunkDurationInSeconds = clamp(finiteOr(chunkDuration, 0.1), 0.03, 0.5);
    this.workgroupSize = WEBGPU_SYNTHS_WORKGROUP_SIZES.includes(Number(workgroupSize))
      ? Number(workgroupSize)
      : WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize;
    this.context = null;
    this.input = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.timeInfoBuffer = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.paramBuffer = null;
    this.sequenceBuffer = null;
    this.chunkNumSamplesPerChannel = 0;
    this.chunkNumSamples = 0;
    this.chunkBufferSize = 0;
    this.sampleRate = 44100;
    this.renderOffset = 0;
    this.nextStartTime = 0;
    this.timeoutId = null;
    this.renderingPromise = null;
    this.running = false;
    this.playbackEnabled = false;
    this.output = WEBGPU_SYNTHS_RUNTIME_DEFAULTS.output;
    this.params = sanitizeWebGpuSynthParams();
    this.sequence = createWebGpuSynthSequence();
    this.sources = new Set();
    this.scheduledChunks = [];
    this.onError = null;
    this.ownsContext = false;
  }

  setErrorHandler(handler) {
    this.onError = typeof handler === "function" ? handler : null;
  }

  async start(params = this.params) {
    if (this.context) await this.stop();
    const support = webGpuSynthSupport(this.runtime);
    if (!support.audio) throw new Error("Web Audio buffer playback is not available in this browser.");
    if (!support.webgpu) throw new Error("WebGPU is not available in this browser.");
    this.params = sanitizeWebGpuSynthParams(params);
    const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    this.context = new AudioContextCtor();
    this.ownsContext = true;
    if (this.context.state === "suspended" && typeof this.context.resume === "function") {
      await this.context.resume();
    }
    this.sampleRate = this.context.sampleRate;
    this.createAudioGraph();
    await this.initGpu();
    this.updateParams(this.params);
    this.updateSequence(this.sequence);
    this.setOutput(this.output);
    this.renderOffset = 0;
    this.nextStartTime = this.context.currentTime + 0.06;
    this.scheduledChunks = [];
    this.running = true;
    this.queueFill();
    return this.context;
  }

  createAudioGraph() {
    if (!this.context) return;
    this.input = this.context.createGain();
    this.master = this.context.createGain();
    this.input.gain.value = 1;
    this.master.gain.value = this.playbackEnabled ? this.output : 0;
    this.input.connect(this.master);
    this.releaseAudioOutput = connectAudioOutput(this.context, this.master, { runtime: this.runtime });
  }

  async initGpu() {
    if (!this.context) throw new Error("Audio buffer playback must be initialized before WebGPU.");
    const { usage } = requireGpuConstants(this.runtime);
    const adapter = await this.runtime.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was found.");
    this.device = await adapter.requestDevice();
    this.chunkNumSamplesPerChannel = Math.max(128, Math.round(this.sampleRate * this.chunkDurationInSeconds));
    this.chunkNumSamples = NUM_CHANNELS * this.chunkNumSamplesPerChannel;
    this.chunkBufferSize = this.chunkNumSamples * Float32Array.BYTES_PER_ELEMENT;
    this.timeInfoBuffer = this.device.createBuffer({ size: TIME_INFO_BUFFER_SIZE, usage: usage.UNIFORM | usage.COPY_DST });
    this.chunkBuffer = this.device.createBuffer({ size: this.chunkBufferSize, usage: usage.STORAGE | usage.COPY_SRC });
    this.chunkMapBuffer = this.device.createBuffer({ size: this.chunkBufferSize, usage: usage.MAP_READ | usage.COPY_DST });
    this.paramBuffer = this.device.createBuffer({ size: PARAM_BUFFER_SIZE, usage: usage.STORAGE | usage.COPY_DST });
    this.sequenceBuffer = this.device.createBuffer({ size: SEQUENCE_BUFFER_SIZE, usage: usage.STORAGE | usage.COPY_DST });
    const shaderModule = this.device.createShaderModule({ code: WEBGPU_SYNTHS_SHADER });
    this.pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "synthesize",
        constants: { SAMPLE_RATE: this.sampleRate, WORKGROUP_SIZE: this.workgroupSize },
      },
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.timeInfoBuffer } },
        { binding: 1, resource: { buffer: this.chunkBuffer } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
        { binding: 3, resource: { buffer: this.sequenceBuffer } },
      ],
    });
  }

  updateParams(params = this.params) {
    this.params = sanitizeWebGpuSynthParams(params);
    if (this.device && this.paramBuffer) this.device.queue.writeBuffer(this.paramBuffer, 0, webGpuSynthParamArray(this.params));
  }

  updateSequence(sequence = this.sequence) {
    this.sequence = sanitizeWebGpuSynthSequence(sequence);
    if (this.device && this.sequenceBuffer) this.device.queue.writeBuffer(this.sequenceBuffer, 0, webGpuSynthSequenceArray(this.sequence));
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, WEBGPU_SYNTHS_RUNTIME_DEFAULTS.output), 0, 1);
    this.applyOutputGain();
  }

  setPlaybackEnabled(enabled) {
    this.playbackEnabled = Boolean(enabled);
    this.applyOutputGain();
  }

  applyOutputGain() {
    if (this.master && this.context) {
      setTarget(this.master.gain, this.playbackEnabled ? this.output : 0, this.context.currentTime, 0.018);
    }
  }

  queueFill(delay = 0) {
    if (!this.running || this.renderingPromise || this.timeoutId !== null) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    this.timeoutId = setTimer(() => {
      this.timeoutId = null;
      const task = this.fillBuffer().catch((error) => this.handleRenderError(error)).finally(() => {
        if (this.renderingPromise === task) {
          this.renderingPromise = null;
          if (this.running) this.queueFill(this.chunkDurationInSeconds * 220);
        }
      });
      this.renderingPromise = task;
    }, Math.max(0, delay));
  }

  async fillBuffer() {
    if (!this.context || !this.input) return;
    const horizon = this.chunkDurationInSeconds * MAX_BUFFERED_CHUNKS + 0.05;
    while (this.running && this.context && (this.nextStartTime - this.context.currentTime) < horizon) {
      const chunkData = await this.renderChunk(this.renderOffset);
      if (!this.running || !this.context || !this.input) return;
      const audioBuffer = this.context.createBuffer(NUM_CHANNELS, this.chunkNumSamplesPerChannel, this.sampleRate);
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let sample = 0; sample < audioBuffer.length; sample += 1) {
        left[sample] = chunkData[sample * NUM_CHANNELS];
        right[sample] = chunkData[sample * NUM_CHANNELS + 1];
      }
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.input);
      const chunkOffset = this.renderOffset;
      const startAt = Math.max(this.context.currentTime + 0.012, this.nextStartTime);
      const endAt = startAt + audioBuffer.duration;
      source.onended = () => {
        this.sources.delete(source);
        this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.source !== source);
      };
      this.sources.add(source);
      this.scheduledChunks.push({ source, offset: chunkOffset, startAt, endAt, duration: audioBuffer.duration });
      source.start(startAt);
      this.nextStartTime = endAt;
      this.renderOffset = chunkOffset + audioBuffer.duration;
    }
  }

  currentPlaybackTime() {
    if (!this.context || !this.running) return null;
    const now = finiteOr(this.context.currentTime, 0);
    this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.endAt >= now - 0.1);
    const current = this.scheduledChunks.find((chunk) => now >= chunk.startAt && now < chunk.endAt);
    if (current) return Math.max(0, current.offset + now - current.startAt);
    const next = this.scheduledChunks.find((chunk) => now < chunk.startAt);
    if (next) return Math.max(0, next.offset);
    const last = this.scheduledChunks.at(-1);
    if (last) return Math.max(0, last.offset + clamp(now - last.startAt, 0, last.duration));
    return Math.max(0, this.renderOffset - Math.max(0, this.nextStartTime - now));
  }

  async renderChunk(offset) {
    if (!this.device || !this.timeInfoBuffer || !this.chunkBuffer || !this.chunkMapBuffer || !this.paramBuffer || !this.sequenceBuffer || !this.pipeline || !this.bindGroup) {
      throw new Error("WebGPU renderer is not initialized.");
    }
    const { mapMode } = requireGpuConstants(this.runtime);
    this.device.queue.writeBuffer(this.timeInfoBuffer, 0, new Float32Array([offset, 0, 0, 0]));
    this.device.queue.writeBuffer(this.paramBuffer, 0, webGpuSynthParamArray(this.params));
    this.device.queue.writeBuffer(this.sequenceBuffer, 0, webGpuSynthSequenceArray(this.sequence));
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.chunkNumSamplesPerChannel / this.workgroupSize));
    pass.end();
    commandEncoder.copyBufferToBuffer(this.chunkBuffer, 0, this.chunkMapBuffer, 0, this.chunkBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);
    await this.chunkMapBuffer.mapAsync(mapMode.READ, 0, this.chunkBufferSize);
    const chunkData = new Float32Array(this.chunkNumSamples);
    chunkData.set(new Float32Array(this.chunkMapBuffer.getMappedRange(0, this.chunkBufferSize)));
    this.chunkMapBuffer.unmap();
    return chunkData;
  }

  handleRenderError(error) {
    this.running = false;
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
    this.scheduledChunks = [];
    this.onError?.(error);
  }

  async stop() {
    this.running = false;
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
    if (this.renderingPromise) await this.renderingPromise.catch(() => {});
    for (const source of this.sources) {
      try { source.stop?.(this.context?.currentTime); } catch { /* Already ended. */ }
    }
    this.sources.clear();
    this.scheduledChunks = [];
    const context = this.context;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    if (context && context.state !== "closed" && typeof context.close === "function") await context.close();
    this.destroyGpuResources();
  }

  destroyGpuResources() {
    for (const buffer of [this.timeInfoBuffer, this.chunkBuffer, this.chunkMapBuffer, this.paramBuffer, this.sequenceBuffer]) {
      try { buffer?.destroy?.(); } catch { /* Browser may reject destroying a mapped buffer. */ }
    }
    try { this.device?.destroy?.(); } catch { /* Device.destroy is optional. */ }
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.timeInfoBuffer = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.paramBuffer = null;
    this.sequenceBuffer = null;
  }
}
