import { connectAudioOutput } from "./audio-output-manager.js";
import {
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_DEFAULT_STEP_MODULATION,
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_SOURCE_SEQUENCE,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303Sequence,
  sanitizeWebGpu303StepModulation,
  webGpu303Noise,
  webGpu303StepModulationArray,
} from "./webgpu-303.js";

export const SIMD_303_BLOCK_SIZE = 128;
export const SIMD_303_MAX_PARTIALS = 512;
export const SIMD_303_RUNTIME_DEFAULTS = Object.freeze({ output: 1 });
export const SIMD_303_STEP_EXPRESSION_DEFAULT = Object.freeze([0, 1, 0, 1]);
export const SIMD_303_STEP_EXPRESSION_LIMITS = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([0.05, 1]),
  Object.freeze([0, 1]),
  Object.freeze([0, 1]),
]);
export const SIMD_303_XL_DEFAULTS = Object.freeze({
  spectrumMorph: 0,
  chorusMix: 0.18,
  chorusDepth: 5,
  chorusRate: 0.28,
  delayMix: 0.2,
  delaySteps: 3,
  delayFeedback: 0.32,
});
export const SIMD_303_XL_LIMITS = Object.freeze({
  spectrumMorph: Object.freeze([0, 3]),
  chorusMix: Object.freeze([0, 1]),
  chorusDepth: Object.freeze([0, 12]),
  chorusRate: Object.freeze([0.05, 5]),
  delayMix: Object.freeze([0, 1]),
  delaySteps: Object.freeze([0.25, 8]),
  delayFeedback: Object.freeze([0, 0.85]),
});
export const SIMD_303_XL_PARAM_ORDER = Object.freeze([
  "chorusMix",
  "chorusDepth",
  "chorusRate",
  "delayMix",
  "delaySteps",
  "delayFeedback",
]);

const ARRAY_EXPORTS = Object.freeze({
  outputLeft: "output_left_ptr",
  outputRight: "output_right_ptr",
  params: "params_ptr",
  stepFrequency: "step_frequency_ptr",
  stepModulation: "step_modulation_ptr",
  stepExpression: "step_expression_ptr",
  partialBase: "partial_base_ptr",
  partialFold: "partial_fold_ptr",
  xlParams: "xl_params_ptr",
});

const ARRAY_LENGTHS = Object.freeze({
  outputLeft: SIMD_303_BLOCK_SIZE,
  outputRight: SIMD_303_BLOCK_SIZE,
  params: 17,
  stepFrequency: WEBGPU_303_SEQUENCE_LENGTH,
  stepModulation: WEBGPU_303_SEQUENCE_LENGTH * 4,
  stepExpression: WEBGPU_303_SEQUENCE_LENGTH * 4,
  partialBase: SIMD_303_MAX_PARTIALS,
  partialFold: SIMD_303_MAX_PARTIALS,
  xlParams: SIMD_303_XL_PARAM_ORDER.length,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rem = (value, divisor) => value - Math.floor(value / divisor) * divisor;

function setTarget(param, value, time = 0, constant = 0.015) {
  if (typeof param?.setTargetAtTime === "function") param.setTargetAtTime(value, time, constant);
  else if (param) param.value = value;
}

export function simd303Support(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const audio = Boolean(AudioContextCtor);
  const worklet = Boolean(
    runtime.AudioWorkletNode
    && AudioContextCtor?.prototype
    && "audioWorklet" in AudioContextCtor.prototype
  );
  const wasm = Boolean(runtime.WebAssembly ?? globalThis.WebAssembly);
  return Object.freeze({ audio, worklet, wasm, supported: audio && worklet && wasm });
}

export function resolveSimd303Sequence(
  sequence = WEBGPU_303_SOURCE_SEQUENCE,
  params = WEBGPU_303_DEFAULTS,
) {
  const sanitizedParams = sanitizeWebGpu303Params(params);
  const sanitizedSequence = sanitizeWebGpu303Sequence(sequence);
  return new Float32Array(sanitizedSequence.map((value, index) => (
    value >= 0 ? value : webGpu303Noise(index, sanitizedParams.nse)
  )));
}

export function sanitizeSimd303Params(params = {}) {
  const sanitized = sanitizeWebGpu303Params(params);
  sanitized.partials = Math.round(clamp(
    finite(params?.partials, WEBGPU_303_DEFAULTS.partials),
    1,
    SIMD_303_MAX_PARTIALS,
  ));
  return sanitized;
}

export function sanitizeSimd303XlParams(params = {}) {
  return Object.fromEntries(Object.entries(SIMD_303_XL_DEFAULTS).map(([key, fallback]) => {
    const [minimum, maximum] = SIMD_303_XL_LIMITS[key];
    return [key, clamp(finite(params?.[key], fallback), minimum, maximum)];
  }));
}

export function simd303XlParamArray(params = SIMD_303_XL_DEFAULTS) {
  const sanitized = sanitizeSimd303XlParams(params);
  return new Float32Array(SIMD_303_XL_PARAM_ORDER.map((key) => sanitized[key]));
}

export function sanitizeSimd303StepExpression(stepExpression = []) {
  return Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, (_, stepIndex) => {
    const candidate = stepExpression?.[stepIndex];
    return SIMD_303_STEP_EXPRESSION_DEFAULT.map((fallback, componentIndex) => {
      const [minimum, maximum] = SIMD_303_STEP_EXPRESSION_LIMITS[componentIndex];
      return clamp(finite(candidate?.[componentIndex], fallback), minimum, maximum);
    });
  });
}

export function simd303StepExpressionArray(stepExpression = []) {
  return new Float32Array(sanitizeSimd303StepExpression(stepExpression).flat());
}

export function simd303StepFrequencyArray(
  params = WEBGPU_303_DEFAULTS,
  sequence = WEBGPU_303_SOURCE_SEQUENCE,
) {
  const sanitized = sanitizeSimd303Params(params);
  const resolved = resolveSimd303Sequence(sequence, sanitized);
  return new Float32Array(Array.from(resolved, (value) => {
    const note = 20 + Math.floor(value * sanitized.frequency);
    return sanitized.fundamental * (2 ** ((note - 69) / 12));
  }));
}

export function simd303PartialArrays(
  params = WEBGPU_303_DEFAULTS,
  xlParams = SIMD_303_XL_DEFAULTS,
) {
  const sanitized = sanitizeSimd303Params(params);
  const xl = sanitizeSimd303XlParams(xlParams);
  const base = new Float32Array(SIMD_303_MAX_PARTIALS);
  const fold = new Float32Array(SIMD_303_MAX_PARTIALS);
  for (let partial = 0; partial < SIMD_303_MAX_PARTIALS; partial += 1) {
    const harmonic = Math.max(partial + sanitized.sampOffset, 1);
    const spectrumPosition = Math.min(2, Math.floor(xl.spectrumMorph));
    const spectrumAmount = xl.spectrumMorph - spectrumPosition;
    const odd = Math.round(harmonic) % 2 === 1;
    const alternating = Math.round((harmonic - 1) * 0.5) % 2 === 0 ? 1 : -1;
    const spectra = [
      1,
      odd ? 1 : 0,
      Math.sin(Math.PI * harmonic * 0.25),
      odd ? alternating / harmonic : 0,
    ];
    const spectrumWeight = spectra[spectrumPosition]
      + (spectra[spectrumPosition + 1] - spectra[spectrumPosition]) * spectrumAmount;
    const weight = spectrumWeight
      * (1 / harmonic)
      * Math.exp(-Math.max(sanitized.ratio - harmonic, 0));
    base[partial] = weight;
    fold[partial] = weight * rem(harmonic, Math.max(sanitized.ratio, 0.001));
  }
  return Object.freeze({ base, fold });
}

export function createSimd303Configuration(
  params = WEBGPU_303_DEFAULTS,
  sequence = WEBGPU_303_SOURCE_SEQUENCE,
  stepModulation = [],
  xlParams = SIMD_303_XL_DEFAULTS,
  stepExpression = [],
) {
  const sanitizedParams = sanitizeSimd303Params(params);
  const sanitizedSequence = sanitizeWebGpu303Sequence(sequence);
  const sanitizedModulation = sanitizeWebGpu303StepModulation(stepModulation);
  const sanitizedXlParams = sanitizeSimd303XlParams(xlParams);
  const sanitizedStepExpression = sanitizeSimd303StepExpression(stepExpression);
  const partials = simd303PartialArrays(sanitizedParams, sanitizedXlParams);
  const paramArray = new Float32Array(
    WEBGPU_303_BUFFER_PARAM_ORDER.map((key) => sanitizedParams[key]),
  );
  return Object.freeze({
    params: sanitizedParams,
    sequence: sanitizedSequence,
    stepModulation: sanitizedModulation,
    xlParams: sanitizedXlParams,
    stepExpression: sanitizedStepExpression,
    paramArray,
    stepFrequency: simd303StepFrequencyArray(sanitizedParams, sanitizedSequence),
    modulationArray: webGpu303StepModulationArray(sanitizedModulation),
    expressionArray: simd303StepExpressionArray(sanitizedStepExpression),
    xlParamArray: simd303XlParamArray(sanitizedXlParams),
    partialBase: partials.base,
    partialFold: partials.fold,
  });
}

export function createSimd303KernelViews(instance) {
  const exports = instance?.exports;
  if (!(exports?.memory instanceof WebAssembly.Memory)) {
    throw new TypeError("SIMD 303 kernel is missing exported memory.");
  }
  for (const name of ["process", "reset", "lane_width", "block_size", "max_partials", "sequence_length"]) {
    if (typeof exports[name] !== "function") throw new TypeError(`SIMD 303 kernel is missing export: ${name}`);
  }
  const views = {};
  for (const [key, pointerExport] of Object.entries(ARRAY_EXPORTS)) {
    if (typeof exports[pointerExport] !== "function") {
      throw new TypeError(`SIMD 303 kernel is missing export: ${pointerExport}`);
    }
    views[key] = new Float32Array(exports.memory.buffer, exports[pointerExport](), ARRAY_LENGTHS[key]);
  }
  return Object.freeze({ instance, exports, ...views });
}

export function writeSimd303Configuration(kernel, configuration) {
  kernel.params.set(configuration.paramArray);
  kernel.stepFrequency.set(configuration.stepFrequency);
  kernel.stepModulation.set(configuration.modulationArray);
  kernel.stepExpression.set(configuration.expressionArray);
  kernel.partialBase.set(configuration.partialBase);
  kernel.partialFold.set(configuration.partialFold);
  kernel.xlParams.set(configuration.xlParamArray);
  return kernel;
}

async function loadWasm(runtime, relativeUrl, { required = true } = {}) {
  try {
    const response = await runtime.fetch(new URL(relativeUrl, import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const wasm = runtime.WebAssembly ?? globalThis.WebAssembly;
    if (!wasm.validate(bytes)) throw new Error("binary is not supported");
    return bytes;
  } catch (error) {
    if (required) throw new Error(`Could not load ${relativeUrl}: ${error?.message || error}`);
    return null;
  }
}

export class Simd303Audio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.master = null;
    this.analyser = null;
    this.scopeData = null;
    this.releaseAudioOutput = null;
    this.params = sanitizeSimd303Params();
    this.sequence = sanitizeWebGpu303Sequence();
    this.stepModulation = sanitizeWebGpu303StepModulation();
    this.stepExpression = sanitizeSimd303StepExpression();
    this.xlParams = sanitizeSimd303XlParams();
    this.output = SIMD_303_RUNTIME_DEFAULTS.output;
    this.playbackEnabled = false;
    this.sampleRate = 48_000;
    this.backend = "none";
    this.laneWidth = 0;
    this.simdAvailable = null;
    this.kernelMicros = null;
    this.budgetMicros = null;
    this.onError = null;
    this.onTelemetry = null;
    this.onMorph = null;
    this.morphId = 0;
    this.timelineStart = 0;
    this.ownsContext = false;
    this.destination = null;
  }

  setErrorHandler(handler) {
    this.onError = typeof handler === "function" ? handler : null;
  }

  setTelemetryHandler(handler) {
    this.onTelemetry = typeof handler === "function" ? handler : null;
  }

  setMorphHandler(handler) {
    this.onMorph = typeof handler === "function" ? handler : null;
  }

  setOutput(value) {
    this.output = clamp(finite(value, SIMD_303_RUNTIME_DEFAULTS.output), 0, 1);
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

  currentPlaybackTime() {
    if (!this.context) return null;
    return Math.max(0, finite(this.context.currentTime, 0) - this.timelineStart);
  }

  timeDomainData() {
    if (!this.analyser || !this.scopeData) return null;
    this.analyser.getFloatTimeDomainData(this.scopeData);
    return this.scopeData;
  }

  configuration() {
    return createSimd303Configuration(
      this.params,
      this.sequence,
      this.stepModulation,
      this.xlParams,
      this.stepExpression,
    );
  }

  postConfiguration() {
    this.node?.port.postMessage({ type: "configure", configuration: this.configuration() });
  }

  updateParams(params = this.params) {
    this.params = sanitizeSimd303Params(params);
    this.postConfiguration();
  }

  updateSequence(sequence = this.sequence) {
    this.sequence = sanitizeWebGpu303Sequence(sequence);
    this.postConfiguration();
  }

  updateStepModulation(stepModulation = this.stepModulation) {
    this.stepModulation = sanitizeWebGpu303StepModulation(stepModulation);
    this.postConfiguration();
  }

  updateStepExpression(stepExpression = this.stepExpression) {
    this.stepExpression = sanitizeSimd303StepExpression(stepExpression);
    this.postConfiguration();
  }

  updateXlParams(params = this.xlParams) {
    this.xlParams = sanitizeSimd303XlParams(params);
    this.postConfiguration();
  }

  configurationFromSnapshot(snapshot = {}) {
    return createSimd303Configuration(
      snapshot.params ?? this.params,
      snapshot.sequence ?? this.sequence,
      this.stepModulation,
      snapshot.xlParams ?? this.xlParams,
      snapshot.stepExpression ?? this.stepExpression,
    );
  }

  setSnapshot(snapshot = {}) {
    this.params = sanitizeSimd303Params(snapshot.params ?? this.params);
    this.sequence = sanitizeWebGpu303Sequence(snapshot.sequence ?? this.sequence);
    this.xlParams = sanitizeSimd303XlParams(snapshot.xlParams ?? this.xlParams);
    this.stepExpression = sanitizeSimd303StepExpression(
      snapshot.stepExpression ?? this.stepExpression,
    );
  }

  morphTo(source, destination, durationSeconds = 1) {
    const from = this.configurationFromSnapshot(source);
    const to = this.configurationFromSnapshot(destination);
    this.setSnapshot(destination);
    this.morphId += 1;
    this.node?.port.postMessage({
      type: "morph",
      id: this.morphId,
      durationSeconds: Math.max(0.001, finite(durationSeconds, 1)),
      from,
      to,
    });
    return this.morphId;
  }

  cancelMorph(snapshot = {}) {
    this.morphId += 1;
    this.setSnapshot(snapshot);
    this.postConfiguration();
    return this.morphId;
  }

  async start(params = this.params, options = {}) {
    if (this.context) await this.stop();
    const support = simd303Support(this.runtime);
    if (!support.audio) throw new Error("Web Audio is not available in this browser.");
    if (!support.worklet) throw new Error("AudioWorklet is not available in this browser.");
    if (!support.wasm) throw new Error("WebAssembly is not available in this browser.");

    this.params = sanitizeSimd303Params(params);
    const externalContext = options.context ?? options.audioContext ?? null;
    const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    this.ownsContext = !externalContext;
    this.context = externalContext ?? new AudioContextCtor({ latencyHint: "interactive" });
    if (this.context.state === "suspended" && typeof this.context.resume === "function") {
      await this.context.resume();
    }
    this.sampleRate = this.context.sampleRate;
    this.destination = options.destination ?? null;

    const forceScalar = options.forceScalar ?? new URL(this.runtime.location?.href ?? "https://localhost/").searchParams.has("scalar");
    const workletPromise = this.context.audioWorklet.addModule(new URL("./simd-303-processor.js", import.meta.url));
    const scalarPromise = loadWasm(this.runtime, "../assets/wasm/simd-303-scalar.wasm");
    const simdPromise = forceScalar
      ? Promise.resolve(null)
      : loadWasm(this.runtime, "../assets/wasm/simd-303-simd.wasm", { required: false });
    const [scalarBytes, simdBytes] = await Promise.all([scalarPromise, simdPromise, workletPromise]);

    const AudioWorkletNodeCtor = this.runtime.AudioWorkletNode;
    const node = new AudioWorkletNodeCtor(this.context, "morphazoid-simd-303", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const master = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    master.gain.value = 0;
    node.connect(master);
    master.connect(analyser);
    if (this.destination) {
      analyser.connect(this.destination);
      this.releaseAudioOutput = () => {
        try { analyser.disconnect?.(this.destination); } catch {}
      };
    } else {
      this.releaseAudioOutput = connectAudioOutput(this.context, analyser, { runtime: this.runtime });
    }
    this.node = node;
    this.master = master;
    this.analyser = analyser;
    this.scopeData = new Float32Array(analyser.fftSize);

    const ready = new Promise((resolve, reject) => {
      const timeout = this.runtime.setTimeout(() => reject(new Error("SIMD 303 worklet did not become ready.")), 6_000);
      node.port.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "ready" || message.type === "backend") {
          this.backend = message.backend;
          this.laneWidth = message.laneWidth;
          this.simdAvailable = message.simdAvailable;
        }
        if (message.type === "ready") {
          this.runtime.clearTimeout(timeout);
          resolve(message);
        } else if (message.type === "telemetry") {
          this.kernelMicros = message.kernelMicros;
          this.budgetMicros = message.budgetMicros;
          this.onTelemetry?.(message);
        } else if (message.type === "morph-start" || message.type === "morph-progress" || message.type === "morph-complete") {
          this.onMorph?.(message);
        } else if (message.type === "error") {
          this.onError?.(new Error(message.message || "SIMD 303 worklet reported an error."));
        }
      };
      node.addEventListener?.("processorerror", () => reject(new Error("SIMD 303 AudioWorklet stopped.")), { once: true });
    });
    const configuration = this.configuration();
    node.port.postMessage({
      type: "install",
      scalarBytes,
      simdBytes,
      requestedBackend: forceScalar ? "scalar" : "simd",
      configuration,
    }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
    await ready;
    this.timelineStart = this.context.currentTime;
    this.applyOutputGain();
    return this.context;
  }

  async stop() {
    const context = this.context;
    const ownsContext = this.ownsContext;
    this.node?.port.postMessage({ type: "dispose" });
    try { this.node?.disconnect?.(); } catch {}
    this.releaseAudioOutput?.();
    try { this.master?.disconnect?.(); } catch {}
    try { this.analyser?.disconnect?.(); } catch {}
    this.releaseAudioOutput = null;
    this.context = null;
    this.node = null;
    this.master = null;
    this.analyser = null;
    this.scopeData = null;
    this.destination = null;
    this.backend = "none";
    this.laneWidth = 0;
    this.ownsContext = false;
    this.morphId += 1;
    if (ownsContext && context?.state !== "closed" && typeof context?.close === "function") {
      await context.close();
    }
  }
}

export { WEBGPU_303_DEFAULT_STEP_MODULATION };
