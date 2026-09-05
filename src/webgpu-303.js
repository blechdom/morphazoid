import { connectAudioOutput } from "./audio-output-manager.js";

const NUM_CHANNELS = 2;
const TIME_INFO_BUFFER_SIZE = 16;
// The standalone instrument still exposes its authored 128-step range, while
// shared consumers can address larger geometric scores (up to Hyper Rubix's
// order-4 total of 512 events) without truncating their sequence buffers.
export const WEBGPU_303_SEQUENCE_LENGTH = 512;
const SEQUENCE_BUFFER_SIZE = WEBGPU_303_SEQUENCE_LENGTH * Float32Array.BYTES_PER_ELEMENT;
const STEP_MODULATION_COMPONENTS = 4;
const STEP_MODULATION_BUFFER_SIZE = WEBGPU_303_SEQUENCE_LENGTH
  * STEP_MODULATION_COMPONENTS
  * Float32Array.BYTES_PER_ELEMENT;
const MAX_BUFFERED_CHUNKS = 2.5;

export const WEBGPU_303_OUTPUT_MAKEUP = 5;
export const WEBGPU_303_OUTPUT_CEILING = 0.88;

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

export const WEBGPU_303_CREDIT = Object.freeze({
  sourceTitle: "sound - acid jam",
  creator: "srtuss",
  platform: "Shadertoy",
  href: "https://www.shadertoy.com/view/ldfSW2",
  localSource: "webgpuaudio/src/shaders/acidSynth.wgsl",
});

export const WEBGPU_303_PARAM_ORDER = Object.freeze([
  "partials",
  "frequency",
  "timeMod",
  "timeScale",
  "gain",
  "dist",
  "dur",
  "ratio",
  "sampOffset",
  "fundamental",
  "stereo",
  "nse",
  "res",
  "lfo",
  "flt",
]);

// The standalone UI intentionally keeps its original 15 controls. Runtime
// consumers can opt into global swing and transport phase through appended
// GPU-only buffer fields.
export const WEBGPU_303_BUFFER_PARAM_ORDER = Object.freeze([
  ...WEBGPU_303_PARAM_ORDER,
  "swing",
  "sequencePhase",
]);
const PARAM_BUFFER_SIZE = WEBGPU_303_BUFFER_PARAM_ORDER.length * Float32Array.BYTES_PER_ELEMENT;

export const WEBGPU_303_SOURCE_FUNDAMENTAL_CONTROL = 80;
export const WEBGPU_303_SOURCE_FUNDAMENTAL_LIMITS = Object.freeze([0, 100]);

export function webGpu303FundamentalFromSourceControl(value) {
  const [minimum, maximum] = WEBGPU_303_SOURCE_FUNDAMENTAL_LIMITS;
  const position = clamp(finiteOr(value, WEBGPU_303_SOURCE_FUNDAMENTAL_CONTROL), minimum, maximum);
  const scale = Math.log(1000) / (maximum - minimum);
  return Math.exp(scale * (position - minimum));
}

export function webGpu303SourceControlFromFundamental(value) {
  const frequency = clamp(finiteOr(value, 1), 1, 1000);
  return Math.log(frequency) / Math.log(1000) * 100;
}

export const WEBGPU_303_DEFAULTS = Object.freeze({
  partials: 256,
  frequency: 38,
  timeMod: 16,
  timeScale: 9,
  gain: 0.15,
  dist: 0.5,
  dur: 0.26,
  ratio: 2,
  sampOffset: 1,
  fundamental: webGpu303FundamentalFromSourceControl(WEBGPU_303_SOURCE_FUNDAMENTAL_CONTROL),
  stereo: 0.01,
  nse: 19871.8972,
  res: 2.2,
  lfo: 1,
  flt: -1.5,
  swing: 0,
  sequencePhase: 0,
});

export const WEBGPU_303_SOURCE_SEQUENCE = Object.freeze(
  Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, () => -1),
);

// Per-step vec4 layout: gain/gate, filter delta, resonance delta, stereo delta.
// The neutral lane preserves the original standalone Acid Synth patch exactly.
export const WEBGPU_303_DEFAULT_STEP_MODULATION = Object.freeze([1, 0, 0, 0]);

export const WEBGPU_303_STEP_MODULATION_LIMITS = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([-64, 64]),
  Object.freeze([-15, 15]),
  Object.freeze([-8, 8]),
]);

export const WEBGPU_303_LIMITS = Object.freeze({
  partials: Object.freeze([1, 256]),
  frequency: Object.freeze([0.2, 100]),
  timeMod: Object.freeze([1, WEBGPU_303_SEQUENCE_LENGTH]),
  timeScale: Object.freeze([0.01, 80]),
  gain: Object.freeze([0, 0.75]),
  dist: Object.freeze([0.01, 5]),
  dur: Object.freeze([0.001, 2]),
  ratio: Object.freeze([1, 32]),
  sampOffset: Object.freeze([1, 32]),
  fundamental: Object.freeze([1, 1000]),
  stereo: Object.freeze([-8, 8]),
  nse: Object.freeze([0, 40000]),
  res: Object.freeze([0, 15]),
  lfo: Object.freeze([0, 64]),
  flt: Object.freeze([-64, 64]),
  swing: Object.freeze([0, 0.42]),
  sequencePhase: Object.freeze([0, WEBGPU_303_SEQUENCE_LENGTH]),
});

export const WEBGPU_303_RUNTIME_DEFAULTS = Object.freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  output: 1,
});

export const WEBGPU_303_WORKGROUP_SIZES = Object.freeze([32, 64, 128, 256]);

export const WEBGPU_303_SHADER = `// WebGPU acid voice adapted from WebGPU Audio's Acid Synth.
// The local demo credits "sound - acid jam" by srtuss on Shadertoy:
// https://www.shadertoy.com/view/ldfSW2
const PARTIALS: u32 = 256u;
const PI2: f32 = 6.283185307179586476925286766559;
const OUTPUT_MAKEUP: f32 = ${WEBGPU_303_OUTPUT_MAKEUP.toFixed(1)};
const OUTPUT_CEILING: f32 = ${WEBGPU_303_OUTPUT_CEILING.toFixed(2)};

override WORKGROUP_SIZE: u32 = 256;
override SAMPLE_RATE: f32 = 44100.0;

struct TimeInfo { offset: f32 }
struct AudioParam {
  partials: f32,
  frequency: f32,
  timeMod: f32,
  timeScale: f32,
  gain: f32,
  dist: f32,
  dur: f32,
  ratio: f32,
  sampOffset: f32,
  fundamental: f32,
  stereo: f32,
  nse: f32,
  res: f32,
  lfo: f32,
  flt: f32,
  swing: f32,
  sequencePhase: f32,
}

@group(0) @binding(0) var<uniform> time_info: TimeInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> audio_param: AudioParam;
@group(0) @binding(3) var<storage, read> sequence_step: array<f32>;
@group(0) @binding(4) var<storage, read> step_modulation: array<vec4<f32>>;

@compute
@workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sampleCount: u32 = global_id.x;

  if (sampleCount >= arrayLength(&sound_chunk)) {
    return;
  }

  let t = f32(sampleCount) / SAMPLE_RATE;
  sound_chunk[sampleCount] = mainSound(time_info.offset + t, audio_param);
}

fn rem(x: f32, y: f32) -> f32 {
  return x - floor(x / y) * y;
}

fn dist(s: vec2<f32>, d: f32) -> vec2<f32> {
  let distClamp: vec2<f32> = vec2(s * d);
  let distSig: vec2<f32> = clamp(distClamp, vec2<f32>(-1.0), vec2<f32>(1.0));
  return distSig;
}

fn _filter(h: f32, cut: f32, res: f32) -> f32 {
  let cutted: f32 = cut - 20.0;
  let df: f32 = max(h - cutted, 0.0);
  let df2: f32 = abs(h - cutted);
  return exp(-0.005 * df * df) * 0.5 + exp(df2 * df2 * -0.1) * res;
}

fn nse(x: f32) -> f32 {
  return fract(sin(x * 110.082) * audio_param.nse);
}

fn ntof(n: f32, fundamental: f32) -> f32 {
  return fundamental * pow(2.0, (n - 69.0) / 12.0);
}

fn sequenceValue(step: f32) -> f32 {
  let index: u32 = u32(step) % arrayLength(&sequence_step);
  let drawn: f32 = sequence_step[index];
  if (drawn >= 0.0) {
    return clamp(drawn, 0.0, 0.9999);
  }
  return nse(step);
}

fn stepModulation(step: f32) -> vec4<f32> {
  let index: u32 = u32(step) % arrayLength(&step_modulation);
  return step_modulation[index];
}

fn swingTime(straightTime: f32, swing: f32) -> f32 {
  let amount: f32 = clamp(swing, 0.0, 0.42);
  if (amount <= 0.0) {
    return straightTime;
  }
  let pair: f32 = floor(straightTime * 0.5);
  let pairTime: f32 = straightTime - pair * 2.0;
  let evenDuration: f32 = 1.0 + amount;
  let oddDuration: f32 = 1.0 - amount;
  if (pairTime < evenDuration) {
    return pair * 2.0 + pairTime / evenDuration;
  }
  return pair * 2.0 + 1.0 + (pairTime - evenDuration) / oddDuration;
}

fn synth(tseq: f32, t: f32, audio_param: AudioParam) -> vec2<f32> {
  var v: vec2<f32> = vec2(0.0);
  let tnote: f32 = fract(tseq);
  let modulation: vec4<f32> = stepModulation(floor(tseq));
  let dr: f32 = audio_param.dur;
  let amp: f32 = smoothstep(0.05, 0.0, abs(tnote - dr - 0.05) - dr)
    * exp(tnote * -1.0)
    * clamp(modulation.x, 0.0, 1.0);
  let seqn: f32 = sequenceValue(floor(tseq));
  let n: f32 = 20.0 + floor(seqn * audio_param.frequency);
  let f: f32 = ntof(n, audio_param.fundamental);
  let timeMod: f32 = max(audio_param.timeMod, 0.001);
  let straightTime: f32 = t * audio_param.timeScale + audio_param.sequencePhase;
  let sqr: f32 = smoothstep(0.0, 0.01, abs(rem(straightTime, timeMod) - 20.0) - 20.0);
  let base: f32 = f;
  let flt: f32 = exp(tnote * audio_param.flt) * 50.0
    + pow(cos(t * audio_param.lfo) * 0.5 + 0.5, 4.0) * 80.0
    + modulation.y;
  let resonance: f32 = clamp(audio_param.res + modulation.z, 0.0, 15.0);
  let stereo: f32 = clamp(audio_param.stereo + modulation.w, -8.0, 8.0);
  let ratio: f32 = max(audio_param.ratio, 0.001);
  let requestedPartials: u32 = min(u32(audio_param.partials), PARTIALS);

  for (var i = 0u; i < requestedPartials; i += 1u) {
    let h: f32 = max(f32(i) + audio_param.sampOffset, 1.0);
    var inten: f32 = 1.0 / h;

    inten = mix(inten, inten * rem(h, ratio), sqr);
    inten *= exp(-1.0 * max(ratio - h, 0.0));
    inten *= _filter(h, flt, resonance);

    let vx: f32 = v.x + (inten * sin((PI2 + (stereo * 0.5)) * (t * base * h)));
    let vy: f32 = v.y + (inten * sin((PI2 - (stereo * 0.5)) * (t * base * h)));
    v = vec2(vx, vy);
  }

  return vec2(dist(v * amp, audio_param.dist));
}

fn mainSound(time: f32, audio_param: AudioParam) -> vec2<f32> {
  let straightTime: f32 = time * audio_param.timeScale + audio_param.sequencePhase;
  let swungTime: f32 = swingTime(straightTime, audio_param.swing);
  let tb: f32 = rem(swungTime, max(audio_param.timeMod, 0.001));
  let mx: vec2<f32> = synth(tb, time, audio_param) * audio_param.gain;
  return clamp(
    mx * OUTPUT_MAKEUP,
    vec2<f32>(-OUTPUT_CEILING),
    vec2<f32>(OUTPUT_CEILING),
  );
}`;

export function sanitizeWebGpu303Params(params = {}) {
  const sanitized = {};
  for (const key of WEBGPU_303_BUFFER_PARAM_ORDER) {
    const [minimum, maximum] = WEBGPU_303_LIMITS[key];
    const fallback = WEBGPU_303_DEFAULTS[key];
    const value = clamp(finiteOr(params[key], fallback), minimum, maximum);
    sanitized[key] = key === "partials" || key === "sampOffset" || key === "timeMod"
      ? Math.round(value)
      : value;
  }
  return sanitized;
}

export function webGpu303ParamArray(params = {}) {
  const sanitized = sanitizeWebGpu303Params(params);
  return new Float32Array(WEBGPU_303_BUFFER_PARAM_ORDER.map((key) => sanitized[key]));
}

/** Warp straight sequencer time into long-even / short-odd swing pairs. */
export function webGpu303SwingTime(straightTime, swing = WEBGPU_303_DEFAULTS.swing) {
  const source = Math.max(0, finiteOr(straightTime, 0));
  const amount = clamp(
    finiteOr(swing, WEBGPU_303_DEFAULTS.swing),
    ...WEBGPU_303_LIMITS.swing,
  );
  if (amount <= 0) return source;
  const pair = Math.floor(source / 2);
  const pairTime = source - pair * 2;
  const evenDuration = 1 + amount;
  if (pairTime < evenDuration) return pair * 2 + pairTime / evenDuration;
  return pair * 2 + 1 + (pairTime - evenDuration) / (1 - amount);
}

export function webGpu303Noise(step, seed) {
  return fract(Math.sin(Number(step) * 110.082) * finiteOr(seed, WEBGPU_303_DEFAULTS.nse));
}

export function sanitizeWebGpu303Sequence(sequence = WEBGPU_303_SOURCE_SEQUENCE) {
  return Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, index) => {
    const number = Number(sequence?.[index]);
    if (!Number.isFinite(number) || number < 0) return -1;
    return clamp(number, 0, 0.9999);
  });
}

export function webGpu303SequenceArray(sequence = WEBGPU_303_SOURCE_SEQUENCE) {
  return new Float32Array(sanitizeWebGpu303Sequence(sequence));
}

export function sanitizeWebGpu303StepModulation(stepModulation = []) {
  return Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, stepIndex) => {
    const candidate = stepModulation?.[stepIndex];
    return WEBGPU_303_DEFAULT_STEP_MODULATION.map((fallback, componentIndex) => {
      const [minimum, maximum] = WEBGPU_303_STEP_MODULATION_LIMITS[componentIndex];
      return clamp(finiteOr(candidate?.[componentIndex], fallback), minimum, maximum);
    });
  });
}

export function webGpu303StepModulationArray(stepModulation = []) {
  return new Float32Array(sanitizeWebGpu303StepModulation(stepModulation).flat());
}

export function webGpu303SequenceValue(step, params = WEBGPU_303_DEFAULTS, sequence = WEBGPU_303_SOURCE_SEQUENCE) {
  const sanitized = sanitizeWebGpu303Sequence(sequence);
  const index = Math.abs(Math.trunc(Number(step) || 0)) % WEBGPU_303_SEQUENCE_LENGTH;
  const drawn = sanitized[index];
  return drawn >= 0 ? drawn : webGpu303Noise(index, params.nse);
}

export function webGpu303Support(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  const audio = Boolean(AudioContextCtor);
  return Object.freeze({
    audio,
    webgpu,
    supported: audio && webgpu,
  });
}

export function formatWebGpu303Value(key, value) {
  const number = finiteOr(value, WEBGPU_303_DEFAULTS[key] ?? 0);
  if (key === "partials") return `${Math.round(number)} partials`;
  if (key === "frequency") return `${number.toFixed(1)} note span`;
  if (key === "timeMod") return `${Math.round(number)} steps`;
  if (key === "timeScale") return `${number.toFixed(2)}x`;
  if (key === "gain") return `${Math.round(number * 100)}%`;
  if (key === "dist") return `${number.toFixed(2)} drive`;
  if (key === "dur") return `${Math.round(number * 1000)} ms`;
  if (key === "ratio") return `${number.toFixed(2)} ratio`;
  if (key === "sampOffset") return `${Math.round(number)} offset`;
  if (key === "fundamental") return `${number.toFixed(3)} Hz`;
  if (key === "stereo") return number === 0 ? "mono" : `${number.toFixed(2)} rad`;
  if (key === "nse") return `${Math.round(number)} seed`;
  if (key === "res") return `${number.toFixed(2)} res`;
  if (key === "lfo") return `${number.toFixed(2)} Hz`;
  if (key === "flt") return `${number.toFixed(2)} sweep`;
  if (key === "swing") return `${Math.round(number * 100)}% swing`;
  return number.toFixed(2);
}

function requireGpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !mapMode) {
    throw new Error("WebGPU constants are not available in this browser context.");
  }
  return { usage, mapMode };
}

export class WebGpu303Audio {
  constructor(runtime = globalThis, {
    chunkDuration = WEBGPU_303_RUNTIME_DEFAULTS.chunkDuration,
    workgroupSize = WEBGPU_303_RUNTIME_DEFAULTS.workgroupSize,
  } = {}) {
    this.runtime = runtime;
    this.chunkDurationInSeconds = clamp(finiteOr(chunkDuration, 0.1), 0.03, 0.5);
    this.workgroupSize = WEBGPU_303_WORKGROUP_SIZES.includes(Number(workgroupSize))
      ? Number(workgroupSize)
      : WEBGPU_303_RUNTIME_DEFAULTS.workgroupSize;
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
    this.sequenceBuffer = null;
    this.stepModulationBuffer = null;
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
    this.output = WEBGPU_303_RUNTIME_DEFAULTS.output;
    this.params = sanitizeWebGpu303Params();
    this.sequence = sanitizeWebGpu303Sequence();
    this.stepModulation = sanitizeWebGpu303StepModulation();
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
      && (params.context || params.audioContext || params.destination || "autoStart" in params)
      && arguments.length < 2
    ) {
      options = params;
      params = this.params;
    }
    if (this.context) await this.stop();

    const support = webGpu303Support(this.runtime);
    const externalContext = options.context ?? options.audioContext ?? null;
    if (!externalContext && !support.audio) {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (!support.webgpu) throw new Error("WebGPU is not available in this browser.");

    this.params = sanitizeWebGpu303Params(params);
    this.ownsContext = !externalContext;
    if (externalContext) {
      this.context = externalContext;
    } else {
      const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      this.context = new AudioContextCtor();
    }
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
    this.updateSequence(this.sequence);
    this.updateStepModulation(this.stepModulation);
    this.setOutput(this.output);
    this.renderOffset = Math.max(0, finiteOr(options.offset, 0));
    this.nextStartTime = Number.isFinite(Number(options.startAt))
      ? Math.max(this.context.currentTime, Number(options.startAt))
      : this.context.currentTime + 0.06;
    this.scheduledChunks = [];
    this.running = options.autoStart !== false;
    if (this.running) this.queueFill();
    return this.context;
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
    this.sequenceBuffer = this.device.createBuffer({
      size: SEQUENCE_BUFFER_SIZE,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    this.stepModulationBuffer = this.device.createBuffer({
      size: STEP_MODULATION_BUFFER_SIZE,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    const shaderModule = this.device.createShaderModule({ code: WEBGPU_303_SHADER });
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
        { binding: 3, resource: { buffer: this.sequenceBuffer } },
        { binding: 4, resource: { buffer: this.stepModulationBuffer } },
      ],
    });
  }

  updateParams(params = this.params) {
    this.params = sanitizeWebGpu303Params(params);
    if (this.device && this.audioParamBuffer) {
      this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpu303ParamArray(this.params));
    }
  }

  updateSequence(sequence = this.sequence) {
    this.sequence = sanitizeWebGpu303Sequence(sequence);
    if (this.device && this.sequenceBuffer) {
      this.device.queue.writeBuffer(this.sequenceBuffer, 0, webGpu303SequenceArray(this.sequence));
    }
  }

  updateStepModulation(stepModulation = this.stepModulation) {
    this.stepModulation = sanitizeWebGpu303StepModulation(stepModulation);
    if (this.device && this.stepModulationBuffer) {
      this.device.queue.writeBuffer(
        this.stepModulationBuffer,
        0,
        webGpu303StepModulationArray(this.stepModulation),
      );
    }
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, WEBGPU_303_RUNTIME_DEFAULTS.output), 0, 1);
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
      const elapsed = clamp(now - last.startAt, 0, last.duration);
      return Math.max(0, last.offset + elapsed);
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
      || !this.sequenceBuffer
      || !this.stepModulationBuffer
      || !this.pipeline
      || !this.bindGroup
    ) {
      throw new Error("WebGPU renderer is not initialized.");
    }
    const { mapMode } = requireGpuConstants(this.runtime);
    this.device.queue.writeBuffer(
      this.timeInfoBuffer,
      0,
      new Float32Array([offset, 0, 0, 0]),
    );
    this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpu303ParamArray(this.params));
    this.device.queue.writeBuffer(this.sequenceBuffer, 0, webGpu303SequenceArray(this.sequence));
    this.device.queue.writeBuffer(
      this.stepModulationBuffer,
      0,
      webGpu303StepModulationArray(this.stepModulation),
    );
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
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
    this.scheduledChunks = [];
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
    // Let the caller align its shared transport before the next macrotask, then
    // refill the remaining look-ahead window immediately to avoid an underrun.
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
      this.sequenceBuffer,
      this.stepModulationBuffer,
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
    this.sequenceBuffer = null;
    this.stepModulationBuffer = null;
  }
}
