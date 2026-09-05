import { connectAudioOutput } from "./audio-output-manager.js";

const NUM_CHANNELS = 2;
const TIME_INFO_BUFFER_SIZE = 16;
const MAX_BUFFERED_CHUNKS = 2.5;

export const WEBGPU_CHIPTUNE_OUTPUT_CEILING = 0.88;

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

export const WEBGPU_CHIPTUNE_CREDIT = Object.freeze({
  sourceTitle: "Chiptune (sound)",
  creator: "srtuss",
  year: 2015,
  platform: "Shadertoy",
  shaderId: "MljSRt",
  href: "https://www.shadertoy.com/view/MljSRt",
});

// Every field below reaches the active mainSound -> s2 / beat2 signal path.
// Source functions and commented branches that mainSound never calls are not
// included merely to create inert controls.
export const WEBGPU_CHIPTUNE_PARAM_ORDER = Object.freeze([
  "tempo",
  "transpose",
  "patternSeed",
  "pitchRange",
  "gateRate",
  "gateLength",
  "pulseWidth",
  "pwmDepth",
  "pwmRate",
  "upperOneLevel",
  "upperTwoLevel",
  "bassPulseLevel",
  "bassSineLevel",
  "leadLevel",
  "arpLevel",
  "noiseLevel",
  "stereoWidth",
  "kickLevel",
  "snareLevel",
  "hatLevel",
  "shakerLevel",
  "kickTone",
  "snareTone",
  "drumDecay",
  "drumMix",
  "ghostDrums",
  "echoTaps",
  "echoTime",
  "echoDecay",
  "echoStereo",
  "fadeIn",
  "gain",
  "scaleMask",
  "upperOneSpan",
  "upperTwoSpan",
  "bassSpan",
  "upperOneRegister",
  "bassRegister",
  "arpRegister",
  "sectionUnits",
  "pitchClock",
  "bassClock",
  "gateFastRatio",
  "gateSwitchShortUnits",
  "gateSwitchLongUnits",
  "leadTrillRate",
  "leadInterval",
  "leadPhraseUnits",
  "arpRate",
  "arpSpan",
  "arpOctaveRate",
  "arpOctaves",
  "bassPulseWidth",
  "drumRate",
  "echoCrossfeed",
  "gateAttack",
  "gateRelease",
  "texturePeriod",
  "textureDecay",
  "kickCycle",
  "kickSubcycle",
  "snareNoiseMix",
  "hatBalance",
  "ghostDelayDivisor",
  "ghostPan",
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
]);

const PARAM_BUFFER_SIZE = WEBGPU_CHIPTUNE_PARAM_ORDER.length * Float32Array.BYTES_PER_ELEMENT;

export const WEBGPU_CHIPTUNE_DEFAULTS = Object.freeze({
  tempo: 1.3,
  transpose: 0,
  patternSeed: 1.79425579,
  pitchRange: 1,
  gateRate: 1,
  gateLength: 1,
  pulseWidth: 0.4,
  pwmDepth: 0.25,
  pwmRate: 0.3,
  upperOneLevel: 1,
  upperTwoLevel: 1,
  bassPulseLevel: 1,
  bassSineLevel: 1,
  leadLevel: 1,
  arpLevel: 1,
  noiseLevel: 1,
  stereoWidth: 1,
  kickLevel: 1,
  snareLevel: 1,
  hatLevel: 1,
  shakerLevel: 1,
  kickTone: 1,
  snareTone: 1,
  drumDecay: 1,
  drumMix: 1,
  ghostDrums: 1,
  echoTaps: 8,
  echoTime: 0.33,
  echoDecay: 0.3,
  echoStereo: 1,
  fadeIn: 1,
  gain: 0.8,
  scaleMask: 1717,
  upperOneSpan: 20,
  upperTwoSpan: 10,
  bassSpan: 4,
  upperOneRegister: -12,
  bassRegister: -36,
  arpRegister: -12,
  sectionUnits: 32,
  pitchClock: 4,
  bassClock: 1,
  gateFastRatio: 2,
  gateSwitchShortUnits: 4,
  gateSwitchLongUnits: 16,
  leadTrillRate: 16,
  leadInterval: 7,
  leadPhraseUnits: 3,
  arpRate: 32,
  arpSpan: 8,
  arpOctaveRate: 0.5,
  arpOctaves: 3,
  bassPulseWidth: 0.4,
  drumRate: 1,
  echoCrossfeed: 0.4,
  gateAttack: 0.05,
  gateRelease: 0.4,
  texturePeriod: 8,
  textureDecay: 0.4,
  kickCycle: 2,
  kickSubcycle: 1.25,
  snareNoiseMix: 0.55555556,
  hatBalance: 0.44444444,
  ghostDelayDivisor: 6,
  ghostPan: -0.2,
  gateA0: 12547,
  gateA1: 784,
  gateA2: 8323,
  gateA3: 8754,
  gateB0: 12547,
  gateB1: 0,
  gateB2: 8323,
  gateB3: 8242,
});

export const WEBGPU_CHIPTUNE_LIMITS = Object.freeze({
  tempo: Object.freeze([0.4, 2.8]),
  transpose: Object.freeze([-24, 12]),
  patternSeed: Object.freeze([0.1, 8]),
  pitchRange: Object.freeze([0.25, 1.75]),
  gateRate: Object.freeze([0.25, 3]),
  gateLength: Object.freeze([0.2, 2]),
  pulseWidth: Object.freeze([0.05, 0.95]),
  pwmDepth: Object.freeze([0, 0.45]),
  pwmRate: Object.freeze([0.02, 3]),
  upperOneLevel: Object.freeze([0, 2]),
  upperTwoLevel: Object.freeze([0, 2]),
  bassPulseLevel: Object.freeze([0, 2]),
  bassSineLevel: Object.freeze([0, 2]),
  leadLevel: Object.freeze([0, 2]),
  arpLevel: Object.freeze([0, 2]),
  noiseLevel: Object.freeze([0, 2]),
  stereoWidth: Object.freeze([0, 1.5]),
  kickLevel: Object.freeze([0, 2]),
  snareLevel: Object.freeze([0, 2]),
  hatLevel: Object.freeze([0, 2]),
  shakerLevel: Object.freeze([0, 2]),
  kickTone: Object.freeze([0.25, 3]),
  snareTone: Object.freeze([0.25, 3]),
  drumDecay: Object.freeze([0.3, 3]),
  drumMix: Object.freeze([0, 1.5]),
  ghostDrums: Object.freeze([0, 1.5]),
  echoTaps: Object.freeze([1, 8]),
  echoTime: Object.freeze([0.05, 0.75]),
  echoDecay: Object.freeze([0, 0.78]),
  echoStereo: Object.freeze([0, 1.5]),
  fadeIn: Object.freeze([0.05, 4]),
  gain: Object.freeze([0, 1]),
  scaleMask: Object.freeze([1, 4095]),
  upperOneSpan: Object.freeze([1, 36]),
  upperTwoSpan: Object.freeze([1, 24]),
  bassSpan: Object.freeze([1, 12]),
  upperOneRegister: Object.freeze([-36, 12]),
  bassRegister: Object.freeze([-60, -12]),
  arpRegister: Object.freeze([-36, 12]),
  sectionUnits: Object.freeze([8, 64]),
  pitchClock: Object.freeze([0.5, 12]),
  bassClock: Object.freeze([0.25, 4]),
  gateFastRatio: Object.freeze([1, 4]),
  gateSwitchShortUnits: Object.freeze([1, 16]),
  gateSwitchLongUnits: Object.freeze([4, 64]),
  leadTrillRate: Object.freeze([1, 64]),
  leadInterval: Object.freeze([-12, 19]),
  leadPhraseUnits: Object.freeze([1, 8]),
  arpRate: Object.freeze([4, 96]),
  arpSpan: Object.freeze([2, 24]),
  arpOctaveRate: Object.freeze([0.0625, 4]),
  arpOctaves: Object.freeze([0, 5]),
  bassPulseWidth: Object.freeze([0.05, 0.95]),
  drumRate: Object.freeze([0.25, 4]),
  echoCrossfeed: Object.freeze([0, 1]),
  gateAttack: Object.freeze([0.005, 0.25]),
  gateRelease: Object.freeze([0.02, 2]),
  texturePeriod: Object.freeze([0.5, 32]),
  textureDecay: Object.freeze([0.05, 4]),
  kickCycle: Object.freeze([0.5, 8]),
  kickSubcycle: Object.freeze([0.25, 4]),
  snareNoiseMix: Object.freeze([0, 1]),
  hatBalance: Object.freeze([0, 1]),
  ghostDelayDivisor: Object.freeze([1, 24]),
  ghostPan: Object.freeze([-1, 1]),
  gateA0: Object.freeze([0, 65535]),
  gateA1: Object.freeze([0, 65535]),
  gateA2: Object.freeze([0, 65535]),
  gateA3: Object.freeze([0, 65535]),
  gateB0: Object.freeze([0, 65535]),
  gateB1: Object.freeze([0, 65535]),
  gateB2: Object.freeze([0, 65535]),
  gateB3: Object.freeze([0, 65535]),
});

export const WEBGPU_CHIPTUNE_INTEGER_PARAMS = Object.freeze([
  "transpose",
  "echoTaps",
  "scaleMask",
  "upperOneSpan",
  "upperTwoSpan",
  "bassSpan",
  "upperOneRegister",
  "bassRegister",
  "arpRegister",
  "arpOctaves",
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
]);
const integerParams = new Set(WEBGPU_CHIPTUNE_INTEGER_PARAMS);

export const WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS = Object.freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  output: 0.55,
});

export const WEBGPU_CHIPTUNE_WORKGROUP_SIZES = Object.freeze([32, 64, 128, 256]);

export function sanitizeWebGpuChiptuneParams(params = {}) {
  const sanitized = {};
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key];
    const value = clamp(finiteOr(params[key], WEBGPU_CHIPTUNE_DEFAULTS[key]), minimum, maximum);
    sanitized[key] = integerParams.has(key) ? Math.round(value) : value;
  }
  return sanitized;
}

export function webGpuChiptuneParamArray(params = {}) {
  const sanitized = sanitizeWebGpuChiptuneParams(params);
  return new Float32Array(WEBGPU_CHIPTUNE_PARAM_ORDER.map((key) => sanitized[key]));
}

export function webGpuChiptuneScaleLock(
  value,
  scaleMask = WEBGPU_CHIPTUNE_DEFAULTS.scaleMask,
) {
  const source = finiteOr(value, 0);
  const pitchClass = ((source % 12) + 12) % 12;
  const mask = Math.round(clamp(finiteOr(scaleMask, WEBGPU_CHIPTUNE_DEFAULTS.scaleMask), 1, 4095));
  let bestDistance = Number.POSITIVE_INFINITY;
  let signedDistance = 0;
  for (let note = 0; note <= 12; note += 1) {
    if ((mask & (1 << (note % 12))) !== 0) {
      const candidate = pitchClass - note;
      const distance = Math.abs(candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        signedDistance = candidate;
      }
    }
  }
  return source - signedDistance;
}

export function webGpuChiptunePatternValue(step, seed = WEBGPU_CHIPTUNE_DEFAULTS.patternSeed) {
  const source = Math.floor(finiteOr(step, 0));
  return fract(source * source * finiteOr(seed, WEBGPU_CHIPTUNE_DEFAULTS.patternSeed));
}

export function webGpuChiptuneStepSnapshot(
  step,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  substep = 0,
) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const source = Math.floor(finiteOr(step, 0));
  const localSubstep = clamp(finiteOr(substep, 0), 0, 0.999999);
  const beatTime = (source + localSubstep) / 4;
  const pitchSource = Math.floor(beatTime * patch.pitchClock);
  const bassSource = Math.floor(beatTime * patch.bassClock);
  const upperOne = webGpuChiptuneScaleLock(
    Math.floor(
      webGpuChiptunePatternValue(pitchSource, patch.patternSeed)
        * patch.upperOneSpan * patch.pitchRange,
    ),
    patch.scaleMask,
  ) + patch.upperOneRegister + patch.transpose;
  const upperTwo = webGpuChiptuneScaleLock(
    Math.floor(
      webGpuChiptunePatternValue(pitchSource, patch.patternSeed)
        * patch.upperTwoSpan * patch.pitchRange,
    ),
    patch.scaleMask,
  ) + patch.transpose;
  const bassBase = webGpuChiptuneScaleLock(
    Math.floor(
      webGpuChiptunePatternValue(bassSource, patch.patternSeed)
        * patch.bassSpan * patch.pitchRange,
    ),
    patch.scaleMask,
  );
  const bass = bassBase + patch.bassRegister + patch.transpose;
  const lead = upperTwo
    + (fract(beatTime * patch.leadTrillRate) >= 0.5 ? patch.leadInterval : 0);
  const triangle = Math.abs(
    ((beatTime * patch.arpRate) % (patch.arpSpan * 2)) - patch.arpSpan,
  );
  const octaveMotion = Math.floor(
    Math.abs(((beatTime * patch.arpOctaveRate) % 2) - 1) * patch.arpOctaves,
  ) * 12;
  const arp = webGpuChiptuneScaleLock(triangle * patch.pitchRange, patch.scaleMask)
    + bassBase + octaveMotion + patch.arpRegister + patch.transpose;
  return Object.freeze({ upperOne, upperTwo, bass, lead, arp });
}

export function formatWebGpuChiptuneValue(key, value) {
  const number = finiteOr(value, WEBGPU_CHIPTUNE_DEFAULTS[key] ?? 0);
  if (key === "tempo") return Math.round(number * 60) + " BPM";
  if (key === "transpose" || key.endsWith("Register") || key === "leadInterval") {
    return (number >= 0 ? "+" : "") + Math.round(number) + " st";
  }
  if (key === "patternSeed") return number.toFixed(4);
  if (key === "scaleMask") {
    return "0x" + Math.round(number).toString(16).toUpperCase().padStart(3, "0");
  }
  if (key.endsWith("Span")) return Math.round(number) + " notes";
  if (
    [
      "sectionUnits",
      "gateSwitchShortUnits",
      "gateSwitchLongUnits",
      "leadPhraseUnits",
      "texturePeriod",
    ].includes(key)
  ) {
    return number.toFixed(Number.isInteger(number) ? 0 : 2) + " steps";
  }
  if (
    [
      "pitchRange",
      "gateRate",
      "gateLength",
      "kickTone",
      "snareTone",
      "drumDecay",
      "pitchClock",
      "bassClock",
      "gateFastRatio",
      "leadTrillRate",
      "arpRate",
      "arpOctaveRate",
      "drumRate",
      "textureDecay",
    ].includes(key)
  ) {
    return number.toFixed(2) + "x";
  }
  if (
    key === "pulseWidth"
    || key === "bassPulseWidth"
    || key === "pwmDepth"
    || key.endsWith("Level")
    || [
      "drumMix",
      "ghostDrums",
      "echoDecay",
      "stereoWidth",
      "echoStereo",
      "echoCrossfeed",
      "snareNoiseMix",
      "hatBalance",
      "gain",
      "noiseLevel",
    ].includes(key)
  ) {
    return Math.round(number * 100) + "%";
  }
  if (key === "pwmRate") return number.toFixed(2) + " rad/s";
  if (key === "echoTaps") return Math.round(number) + " taps";
  if (key === "echoTime" || key === "fadeIn") return Math.round(number * 1000) + " ms";
  if (key === "gateAttack" || key === "gateRelease") return number.toFixed(3) + " step";
  if (key === "arpOctaves") return Math.round(number) + " oct";
  if (key === "ghostDelayDivisor") return "÷" + number.toFixed(2);
  if (key === "ghostPan") {
    if (Math.abs(number) < 0.005) return "center";
    return (number < 0 ? "L " : "R ") + Math.abs(number).toFixed(2);
  }
  return number.toFixed(2);
}

export function webGpuChiptuneSupport(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  const audio = Boolean(AudioContextCtor);
  return Object.freeze({ audio, webgpu, supported: audio && webgpu });
}

export const WEBGPU_CHIPTUNE_SHADER = `// WGSL port of "Chiptune (sound)" by srtuss (2015).
// Original Shadertoy: https://www.shadertoy.com/view/MljSRt
// Only the functions reachable from the source mainSound are rendered here.
const PI2: f32 = 6.283185307179586476925286766559;
const OUTPUT_CEILING: f32 = 0.88;

override WORKGROUP_SIZE: u32 = 256;
override SAMPLE_RATE: f32 = 44100.0;

struct TimeInfo { offset: f32 }
struct AudioParam {
  tempo: f32,
  transpose: f32,
  patternSeed: f32,
  pitchRange: f32,
  gateRate: f32,
  gateLength: f32,
  pulseWidth: f32,
  pwmDepth: f32,
  pwmRate: f32,
  upperOneLevel: f32,
  upperTwoLevel: f32,
  bassPulseLevel: f32,
  bassSineLevel: f32,
  leadLevel: f32,
  arpLevel: f32,
  noiseLevel: f32,
  stereoWidth: f32,
  kickLevel: f32,
  snareLevel: f32,
  hatLevel: f32,
  shakerLevel: f32,
  kickTone: f32,
  snareTone: f32,
  drumDecay: f32,
  drumMix: f32,
  ghostDrums: f32,
  echoTaps: f32,
  echoTime: f32,
  echoDecay: f32,
  echoStereo: f32,
  fadeIn: f32,
  gain: f32,
  scaleMask: f32,
  upperOneSpan: f32,
  upperTwoSpan: f32,
  bassSpan: f32,
  upperOneRegister: f32,
  bassRegister: f32,
  arpRegister: f32,
  sectionUnits: f32,
  pitchClock: f32,
  bassClock: f32,
  gateFastRatio: f32,
  gateSwitchShortUnits: f32,
  gateSwitchLongUnits: f32,
  leadTrillRate: f32,
  leadInterval: f32,
  leadPhraseUnits: f32,
  arpRate: f32,
  arpSpan: f32,
  arpOctaveRate: f32,
  arpOctaves: f32,
  bassPulseWidth: f32,
  drumRate: f32,
  echoCrossfeed: f32,
  gateAttack: f32,
  gateRelease: f32,
  texturePeriod: f32,
  textureDecay: f32,
  kickCycle: f32,
  kickSubcycle: f32,
  snareNoiseMix: f32,
  hatBalance: f32,
  ghostDelayDivisor: f32,
  ghostPan: f32,
  gateA0: f32,
  gateA1: f32,
  gateA2: f32,
  gateA3: f32,
  gateB0: f32,
  gateB1: f32,
  gateB2: f32,
  gateB3: f32,
}

@group(0) @binding(0) var<uniform> time_info: TimeInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> audio_param: AudioParam;

@compute
@workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sample_count = global_id.x;
  if (sample_count >= arrayLength(&sound_chunk)) { return; }
  let local_time = f32(sample_count) / SAMPLE_RATE;
  sound_chunk[sample_count] = mainSound(time_info.offset + local_time, audio_param);
}

fn modulo(x: f32, y: f32) -> f32 {
  return x - floor(x / y) * y;
}

fn stepValue(edge: f32, x: f32) -> f32 {
  return select(0.0, 1.0, x >= edge);
}

// GLSL permits the descending-edge smoothsteps used by the source gate. This
// explicit form preserves that behavior without depending on WGSL edge order.
fn smoothAny(edge0: f32, edge1: f32, x: f32) -> f32 {
  let width = edge1 - edge0;
  if (abs(width) < 0.000001) { return stepValue(edge0, x); }
  let t = clamp((x - edge0) / width, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sine(phase: f32) -> f32 {
  return sin(phase * PI2);
}

fn shns(x: f32) -> f32 {
  return fract(sin(floor(x * 4000.0)) * 29919.0) - 0.5;
}

fn hpns(x: f32, h: f32) -> f32 {
  return shns(x + h) - shns(x - h);
}

fn noteGate(
  t_source: f32,
  offset: f32,
  duration: f32,
  length: f32,
  attack: f32,
  release: f32,
) -> f32 {
  let t = modulo(t_source, 32.0);
  let scaled_duration = max(0.05, duration * length);
  return smoothAny(-max(attack, 0.001), 0.0, t - offset)
    * smoothAny(0.0, -max(release, 0.001), t - offset - scaled_duration);
}

fn packedGateCode(p: AudioParam, lane_b: bool, segment: u32) -> u32 {
  var code = 0.0;
  switch segment {
    case 0u: { code = select(p.gateA0, p.gateB0, lane_b); }
    case 1u: { code = select(p.gateA1, p.gateB1, lane_b); }
    case 2u: { code = select(p.gateA2, p.gateB2, lane_b); }
    default: { code = select(p.gateA3, p.gateB3, lane_b); }
  }
  return u32(clamp(round(code), 0.0, 65535.0));
}

fn packedGateDuration(p: AudioParam, lane_b: bool, step: u32) -> f32 {
  let code = packedGateCode(p, lane_b, step / 8u);
  let state = (code >> ((step % 8u) * 2u)) & 3u;
  switch state {
    case 1u: { return 0.8; }
    case 2u: { return 1.0; }
    case 3u: { return 2.0; }
    default: { return 0.0; }
  }
}

fn patternGate(t: f32, length: f32, p: AudioParam, lane_b: bool) -> f32 {
  var value = 0.0;
  for (var step = 0u; step < 32u; step += 1u) {
    let duration = packedGateDuration(p, lane_b, step);
    if (duration > 0.0) {
      value += noteGate(
        t,
        f32(step),
        duration,
        length,
        p.gateAttack,
        p.gateRelease,
      );
    }
  }
  return value;
}

fn gate(t: f32, length: f32, p: AudioParam) -> f32 {
  return patternGate(t, length, p, false);
}

fn gateOne(t: f32, length: f32, p: AudioParam) -> f32 {
  return patternGate(t, length, p, true);
}

fn blep(t_source: f32, dt_source: f32) -> f32 {
  let dt = clamp(dt_source, 0.000001, 0.5);
  if (t_source < dt) {
    let t = t_source / dt;
    return t + t - t * t - 1.0;
  }
  if (t_source > 1.0 - dt) {
    let t = (t_source - 1.0) / dt;
    return t * t + t + t + 1.0;
  }
  return 0.0;
}

fn sawWave(time: f32, frequency: f32) -> f32 {
  let phase = fract(time * frequency);
  return phase * 2.0 - 1.0 - blep(phase, frequency / SAMPLE_RATE);
}

fn squareWave(time: f32, frequency: f32, pulse_width: f32) -> f32 {
  let phase = fract(time * frequency);
  var value = select(-1.0, 1.0, phase < pulse_width);
  value += blep(phase, frequency / SAMPLE_RATE);
  value -= blep(fract(phase - pulse_width), frequency / SAMPLE_RATE);
  return value;
}

fn considerNearest(best: vec2<f32>, candidate: f32) -> vec2<f32> {
  let distance = abs(candidate);
  return select(best, vec2(distance, candidate), distance < best.x);
}

fn scaleLock(y: f32, scale_mask_source: f32) -> f32 {
  let x = modulo(y, 12.0);
  let scale_mask = u32(clamp(round(scale_mask_source), 1.0, 4095.0));
  var nearest = vec2(1e10, 0.0);
  for (var note = 0u; note <= 12u; note += 1u) {
    let pitch_class = note % 12u;
    if ((scale_mask & (1u << pitch_class)) != 0u) {
      nearest = considerNearest(nearest, x - f32(note));
    }
  }
  return y - nearest.y;
}

fn noteFrequency(note: f32) -> f32 {
  return 440.0 * pow(2.0, note / 12.0);
}

fn widenStereo(value: vec2<f32>, width: f32) -> vec2<f32> {
  let middle = (value.x + value.y) * 0.5;
  let side = (value.x - value.y) * 0.5 * width;
  return vec2(middle + side, middle - side);
}

fn beatTwo(time: f32, p: AudioParam) -> f32 {
  let tempo = p.tempo * max(p.drumRate, 0.01);
  let decay = max(p.drumDecay, 0.1);
  var value = 0.0;

  var tb = modulo(time * tempo, max(p.kickCycle, 0.05));
  tb = modulo(tb, max(p.kickSubcycle, 0.05)) / tempo;
  var kick = sin(
    exp(tb * -1.0) * 400.0 * p.kickTone
    + exp(tb * -100.0) * 200.0 * p.kickTone
  ) * exp(max(0.1 - tb, 0.0) * (-10.0 / decay)) * exp(tb * (-10.0 / decay));
  kick = smoothAny(-0.2, 0.2, kick) * 2.0 - 1.0;
  value = kick * 0.3 * p.kickLevel;

  tb = modulo(time * tempo - 0.5, 1.0) / tempo;
  let snare_envelope = exp(max(tb - 0.1, 0.0) * (-10.0 / decay));
  let snare_mix = clamp(p.snareNoiseMix, 0.0, 1.0);
  value += (
    hpns(exp(-tb) * 4.0, 0.0002) * snare_envelope * 0.9 * snare_mix
    + sin(sin(tb * 100.0 * p.snareTone) * 5.0 + tb * 2000.0 * p.snareTone)
      * snare_envelope * 0.9 * (1.0 - snare_mix)
  ) * 0.6 * p.snareLevel;

  tb = modulo(time * tempo + 0.25, 2.0);
  tb = modulo(tb, 0.625);
  tb = modulo(tb - 1.0, 0.25) / tempo;
  let hat_mix = clamp(p.hatBalance, 0.0, 1.0);
  value += hpns(tb * 4.0, 0.0002) * exp(tb * (-25.0 / decay))
    * 0.45 * (1.0 - hat_mix) * p.hatLevel;

  tb = modulo(time * tempo, 0.5) / tempo;
  value += (
    hpns(tb * 2.0, 0.00002) + hpns(tb * 100.0, 0.002) * 0.3
  ) * exp(tb * (-4.0 / decay)) * 0.45 * hat_mix * p.hatLevel;

  tb = modulo(time * tempo - 0.25, 0.5) / tempo;
  value += hpns(tb * 9.0, 0.0002) * exp(tb * (-8.0 / decay)) * 0.3 * p.shakerLevel;
  return value;
}

fn synthVoices(time: f32, p: AudioParam) -> vec2<f32> {
  let tempo = p.tempo;
  let pulse_width = clamp(
    sin(time * p.pwmRate) * p.pwmDepth + p.pulseWidth,
    0.02,
    0.98,
  );
  let p0 = stepValue(
    0.5,
    fract(time * tempo / max(p.gateSwitchShortUnits, 0.01)),
  );
  let p1 = max(
    stepValue(0.5, fract(time * tempo / max(p.gateSwitchShortUnits, 0.01))),
    stepValue(fract(time * tempo / max(p.gateSwitchLongUnits, 0.01)), 0.5),
  );
  let section = stepValue(0.5, fract(time * tempo / max(p.sectionUnits, 0.01)));
  let gate_rate = p.gateRate;
  let source = floor(time * tempo * p.pitchClock);

  var note = scaleLock(
    floor(fract(source * source * p.patternSeed) * p.upperOneSpan * p.pitchRange),
    p.scaleMask,
  );
  note = note + p.upperOneRegister + p.transpose;
  let first = squareWave(time, noteFrequency(note), pulse_width)
    * gate(
      time * tempo * 8.0 * mix(1.0, p.gateFastRatio, p0) * gate_rate,
      p.gateLength,
      p,
    )
    * section * p.upperOneLevel;
  var value = first * widenStereo(vec2(1.0, 0.5), p.stereoWidth);

  note = scaleLock(
    floor(fract(source * source * p.patternSeed) * p.upperTwoSpan * p.pitchRange),
    p.scaleMask,
  );
  note += p.transpose;
  let second = squareWave(time, noteFrequency(note), pulse_width)
    * gate(
      time * tempo * 8.0 * mix(1.0, p.gateFastRatio, p1) * gate_rate,
      p.gateLength,
      p,
    )
    * section * p.upperTwoLevel;
  value += second * widenStereo(vec2(0.5, 1.0), p.stereoWidth);

  let bass_source = floor(time * tempo * p.bassClock);
  note = scaleLock(
    floor(fract(bass_source * bass_source * p.patternSeed) * p.bassSpan * p.pitchRange),
    p.scaleMask,
  );
  let bass_basis = note;
  note = note + p.bassRegister + p.transpose;
  let bass_frequency = noteFrequency(note);
  let bass_gate = gate(time * tempo * 8.0 * gate_rate, p.gateLength, p);
  value += vec2(squareWave(time, bass_frequency, p.bassPulseWidth)
    * bass_gate * 1.5 * p.bassPulseLevel);
  value += vec2(sine(time * bass_frequency)
    * bass_gate * 2.0 * p.bassSineLevel);

  note = scaleLock(
    floor(fract(source * source * p.patternSeed) * p.upperTwoSpan * p.pitchRange),
    p.scaleMask,
  );
  note += stepValue(0.5, fract(time * tempo * p.leadTrillRate)) * p.leadInterval
    + p.transpose;
  let lead = sawWave(time, noteFrequency(note))
    * gateOne(
      modulo(time * tempo, max(p.leadPhraseUnits, 0.01)) * 8.0 * gate_rate,
      p.gateLength,
      p,
    )
    * 1.5 * (1.0 - section) * p.leadLevel;
  value += vec2(lead);

  let arp_span = max(p.arpSpan, 0.01);
  note = abs(modulo(time * tempo * p.arpRate, arp_span * 2.0) - arp_span);
  note = scaleLock(note * p.pitchRange, p.scaleMask)
    + bass_basis
    + floor(abs(modulo(time * tempo * p.arpOctaveRate, 2.0) - 1.0) * p.arpOctaves)
      * 12.0
    + p.arpRegister
    + p.transpose;
  let arp = sawWave(time, noteFrequency(note)) * p.arpLevel;
  value += arp * widenStereo(vec2(0.5, 1.0), p.stereoWidth);

  let noise_time = modulo(time * tempo, max(p.texturePeriod, 0.01));
  value += vec2(hpns(exp(noise_time * -1.0), 0.0002)
    * exp(noise_time * -p.textureDecay) * p.noiseLevel);
  return value * 0.2;
}

fn mainSound(time: f32, p: AudioParam) -> vec2<f32> {
  var value = vec2(0.0);
  var amplitude = 1.0;
  var swap_channels = false;
  var delay_time = 0.0;
  let tap_count = u32(clamp(round(p.echoTaps), 1.0, 8.0));
  for (var tap = 0u; tap < 8u; tap += 1u) {
    if (tap < tap_count) {
      let source = synthVoices(time - delay_time, p);
      let swapped = select(source, source.yx, swap_channels);
      let crossfeed = clamp(p.echoCrossfeed, 0.0, 1.0);
      let balance = select(vec2(1.0, crossfeed), vec2(crossfeed, 1.0), swap_channels);
      value += widenStereo(swapped * balance, p.echoStereo) * amplitude;
      swap_channels = !swap_channels;
      amplitude *= p.echoDecay;
      delay_time += p.echoTime;
    }
  }

  let ghost_pan = clamp(p.ghostPan, -1.0, 1.0);
  let ghost_balance = vec2(0.25 * (1.0 - ghost_pan), 0.25 * (1.0 + ghost_pan));
  let drums = beatTwo(time, p) * vec2(0.8)
    + beatTwo(time - p.tempo / max(p.ghostDelayDivisor, 1.0), p)
      * ghost_balance * p.ghostDrums;
  value += drums * p.drumMix;

  let fade = min(pow(max(time, 0.0) / max(p.fadeIn, 0.01), 2.0), 1.0);
  let output = value * fade * p.gain;
  return clamp(output, vec2(-OUTPUT_CEILING), vec2(OUTPUT_CEILING));
}`;

function requireGpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !mapMode) {
    throw new Error("WebGPU constants are not available in this browser context.");
  }
  return { usage, mapMode };
}

export class WebGpuChiptuneAudio {
  constructor(runtime = globalThis, {
    chunkDuration = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.chunkDuration,
    workgroupSize = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize,
  } = {}) {
    this.runtime = runtime;
    this.chunkDurationInSeconds = clamp(finiteOr(chunkDuration, 0.1), 0.03, 0.5);
    this.workgroupSize = WEBGPU_CHIPTUNE_WORKGROUP_SIZES.includes(Number(workgroupSize))
      ? Number(workgroupSize)
      : WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize;
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
    this.audioParamBuffer = null;
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
    this.output = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.output;
    this.params = sanitizeWebGpuChiptuneParams();
    this.sources = new Set();
    this.scheduledChunks = [];
    this.onError = null;
    this.ownsContext = false;
    this.destination = null;
  }

  setErrorHandler(handler) {
    this.onError = typeof handler === "function" ? handler : null;
  }

  async start(params = this.params, options = {}) {
    if (
      params
      && typeof params === "object"
      && (
        params.context
        || params.audioContext
        || params.destination
        || "autoStart" in params
        || "offset" in params
        || "startAt" in params
      )
      && arguments.length < 2
    ) {
      options = params;
      params = this.params;
    }
    if (this.context) await this.stop();

    const support = webGpuChiptuneSupport(this.runtime);
    const externalContext = options.context ?? options.audioContext ?? null;
    if (!externalContext && !support.audio) {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (!support.webgpu) throw new Error("WebGPU is not available in this browser.");

    this.params = sanitizeWebGpuChiptuneParams(params);
    this.ownsContext = !externalContext;
    if (externalContext) {
      this.context = externalContext;
    } else {
      const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      this.context = new AudioContextCtor();
    }
    try {
      if (
        this.ownsContext
        && this.context.state === "suspended"
        && typeof this.context.resume === "function"
      ) {
        await this.context.resume();
      }
      this.sampleRate = this.context.sampleRate;
      this.destination = options.destination ?? null;
      this.createAudioGraph(this.destination);
      await this.initGpu();
      this.updateParams(this.params);
      this.setOutput(this.output);
      this.renderOffset = Math.max(0, finiteOr(options.offset, 0));
      this.nextStartTime = Number.isFinite(Number(options.startAt))
        ? Math.max(this.context.currentTime, Number(options.startAt))
        : this.context.currentTime + 0.06;
      this.scheduledChunks = [];
      this.running = options.autoStart !== false;
      if (this.running) {
        const prime = this.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
        this.renderingPromise = prime;
        try {
          await prime;
        } finally {
          if (this.renderingPromise === prime) this.renderingPromise = null;
        }
        this.queueFill();
      }
      return this.context;
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  createAudioGraph(destination = null) {
    if (!this.context) return;
    const input = this.context.createGain();
    const master = this.context.createGain();
    input.gain.value = 1;
    master.gain.value = this.playbackEnabled ? this.output : 0;
    input.connect(master);
    if (destination) {
      master.connect(destination);
      this.releaseAudioOutput = () => {
        try {
          master.disconnect?.(destination);
        } catch {
          // The shared graph or destination may already have been torn down.
        }
      };
    } else {
      this.releaseAudioOutput = connectAudioOutput(this.context, master, { runtime: this.runtime });
    }
    this.input = input;
    this.master = master;
  }

  async initGpu() {
    if (!this.context) throw new Error("Audio must be initialized before WebGPU.");
    const { usage } = requireGpuConstants(this.runtime);
    const adapter = await this.runtime.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was found.");
    this.device = await adapter.requestDevice();
    this.chunkNumSamplesPerChannel = Math.max(
      128,
      Math.round(this.sampleRate * this.chunkDurationInSeconds),
    );
    this.chunkNumSamples = NUM_CHANNELS * this.chunkNumSamplesPerChannel;
    this.chunkBufferSize = this.chunkNumSamples * Float32Array.BYTES_PER_ELEMENT;
    this.timeInfoBuffer = this.device.createBuffer({
      size: TIME_INFO_BUFFER_SIZE,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.chunkBuffer = this.device.createBuffer({
      size: this.chunkBufferSize,
      usage: usage.STORAGE | usage.COPY_SRC,
    });
    this.chunkMapBuffer = this.device.createBuffer({
      size: this.chunkBufferSize,
      usage: usage.MAP_READ | usage.COPY_DST,
    });
    this.audioParamBuffer = this.device.createBuffer({
      size: PARAM_BUFFER_SIZE,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    const shaderModule = this.device.createShaderModule({ code: WEBGPU_CHIPTUNE_SHADER });
    this.pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "synthesize",
        constants: {
          SAMPLE_RATE: this.sampleRate,
          WORKGROUP_SIZE: this.workgroupSize,
        },
      },
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.timeInfoBuffer } },
        { binding: 1, resource: { buffer: this.chunkBuffer } },
        { binding: 2, resource: { buffer: this.audioParamBuffer } },
      ],
    });
  }

  updateParams(params = this.params) {
    this.params = sanitizeWebGpuChiptuneParams(params);
    if (this.device && this.audioParamBuffer) {
      this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpuChiptuneParamArray(this.params));
    }
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.output), 0, 1);
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
      const task = this.fillBuffer()
        .catch((error) => this.handleRenderError(error))
        .finally(() => {
          if (this.renderingPromise === task) {
            this.renderingPromise = null;
            if (this.running) this.queueFill(this.chunkDurationInSeconds * 220);
          }
        });
      this.renderingPromise = task;
    }, Math.max(0, delay));
  }

  async fillBuffer({ forceFirstChunk = false, maxChunks = Number.POSITIVE_INFINITY } = {}) {
    if (!this.context || !this.input) return;
    const scheduleHorizon = this.chunkDurationInSeconds * MAX_BUFFERED_CHUNKS + 0.05;
    const chunkLimit = Number.isFinite(Number(maxChunks))
      ? Math.max(1, Math.trunc(Number(maxChunks)))
      : Number.POSITIVE_INFINITY;
    let scheduledChunkCount = 0;
    while (
      this.running
      && this.context
      && scheduledChunkCount < chunkLimit
      && (
        (scheduledChunkCount === 0 && forceFirstChunk)
        || (this.nextStartTime - this.context.currentTime) < scheduleHorizon
      )
    ) {
      const chunkData = await this.renderChunk(this.renderOffset);
      if (!this.running || !this.context || !this.input) return;
      const audioBuffer = this.context.createBuffer(
        NUM_CHANNELS,
        this.chunkNumSamplesPerChannel,
        this.sampleRate,
      );
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
      source.onended = () => {
        this.sources.delete(source);
        this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.source !== source);
      };
      this.sources.add(source);
      const startAt = Math.max(this.context.currentTime + 0.012, this.nextStartTime);
      const endAt = startAt + audioBuffer.duration;
      this.scheduledChunks.push({
        source,
        offset: chunkOffset,
        startAt,
        endAt,
        duration: audioBuffer.duration,
      });
      source.start(startAt);
      scheduledChunkCount += 1;
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
    if (last) {
      return Math.max(0, last.offset + clamp(now - last.startAt, 0, last.duration));
    }
    return Math.max(0, this.renderOffset - Math.max(0, this.nextStartTime - now));
  }

  async renderChunk(offset) {
    if (
      !this.device
      || !this.timeInfoBuffer
      || !this.chunkBuffer
      || !this.chunkMapBuffer
      || !this.audioParamBuffer
      || !this.pipeline
      || !this.bindGroup
    ) {
      throw new Error("WebGPU renderer is not initialized.");
    }
    const { mapMode } = requireGpuConstants(this.runtime);
    this.device.queue.writeBuffer(this.timeInfoBuffer, 0, new Float32Array([offset, 0, 0, 0]));
    this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpuChiptuneParamArray(this.params));
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.chunkNumSamplesPerChannel / this.workgroupSize));
    pass.end();
    commandEncoder.copyBufferToBuffer(
      this.chunkBuffer,
      0,
      this.chunkMapBuffer,
      0,
      this.chunkBufferSize,
    );
    this.device.queue.submit([commandEncoder.finish()]);
    await this.chunkMapBuffer.mapAsync(mapMode.READ, 0, this.chunkBufferSize);
    const chunkData = new Float32Array(this.chunkNumSamples);
    chunkData.set(new Float32Array(this.chunkMapBuffer.getMappedRange(0, this.chunkBufferSize)));
    this.chunkMapBuffer.unmap();
    return chunkData;
  }

  handleRenderError(error) {
    this.running = false;
    this.clearQueueTimer();
    this.stopScheduledSources();
    if (this.master && this.context) {
      setTarget(this.master.gain, 0, this.context.currentTime, 0.008);
    }
    this.onError?.(error);
  }

  clearQueueTimer() {
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
  }

  stopScheduledSources(when = this.context?.currentTime) {
    for (const source of this.sources) {
      try {
        source.stop?.(when);
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    this.scheduledChunks = [];
  }

  pauseTimeline() {
    const playbackTime = this.currentPlaybackTime();
    this.running = false;
    this.clearQueueTimer();
    this.stopScheduledSources();
    if (playbackTime !== null) this.renderOffset = playbackTime;
    if (this.context) this.nextStartTime = this.context.currentTime;
    return this.renderOffset;
  }

  pause() {
    return this.pauseTimeline();
  }

  async restartTimeline({ startAt, offset = 0 } = {}) {
    if (!this.context || !this.input || !this.device) {
      throw new Error("WebGPU audio must be initialized before restarting its timeline.");
    }
    this.running = false;
    this.clearQueueTimer();
    const render = this.renderingPromise;
    if (render) await render.catch(() => {});
    this.stopScheduledSources();
    this.renderOffset = Math.max(0, finiteOr(offset, 0));
    this.nextStartTime = Number.isFinite(Number(startAt))
      ? Math.max(this.context.currentTime, Number(startAt))
      : this.context.currentTime + 0.012;
    this.running = true;
    const prime = this.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
    this.renderingPromise = prime;
    try {
      await prime;
    } catch (error) {
      this.running = false;
      throw error;
    } finally {
      if (this.renderingPromise === prime) this.renderingPromise = null;
    }
    const actualStartTime = this.scheduledChunks[0]?.startAt ?? this.nextStartTime;
    this.queueFill();
    return actualStartTime;
  }

  async restart(options = {}) {
    return this.restartTimeline(options);
  }

  async stop() {
    this.running = false;
    this.clearQueueTimer();
    const render = this.renderingPromise;
    if (render) await render.catch(() => {});
    this.stopScheduledSources();
    const context = this.context;
    const ownsContext = this.ownsContext;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.destination = null;
    this.ownsContext = false;
    if (ownsContext && context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
    this.destroyGpuResources();
  }

  destroyGpuResources() {
    for (const buffer of [
      this.timeInfoBuffer,
      this.chunkBuffer,
      this.chunkMapBuffer,
      this.audioParamBuffer,
    ]) {
      try {
        buffer?.destroy?.();
      } catch {
        // Some browsers reject destroying a mapped/readback buffer during teardown.
      }
    }
    try {
      this.device?.destroy?.();
    } catch {
      // Device.destroy is not universally implemented.
    }
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.timeInfoBuffer = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.audioParamBuffer = null;
  }
}
