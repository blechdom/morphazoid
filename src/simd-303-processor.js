const BLOCK_SIZE = 128;
const TELEMETRY_INTERVAL_BLOCKS = 48;
const MORPH_PROGRESS_INTERVAL_BLOCKS = 12;

const ARRAY_POINTERS = Object.freeze({
  outputLeft: ["output_left_ptr", BLOCK_SIZE],
  outputRight: ["output_right_ptr", BLOCK_SIZE],
  params: ["params_ptr", 17],
  stepFrequency: ["step_frequency_ptr", 512],
  stepModulation: ["step_modulation_ptr", 512 * 4],
  stepExpression: ["step_expression_ptr", 512 * 4],
  partialBase: ["partial_base_ptr", 512],
  partialFold: ["partial_fold_ptr", 512],
  xlParams: ["xl_params_ptr", 6],
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function positiveMix(from, to, amount) {
  return from > 0 && to > 0
    ? Math.exp(mix(Math.log(from), Math.log(to), amount))
    : mix(from, to, amount);
}

function morphCurve(progress) {
  const amount = Math.min(1, Math.max(0, finite(progress)));
  return amount * amount * (3 - 2 * amount);
}

const LOG_PARAM_INDICES = new Set([1, 3, 5, 6, 7, 9, 13]);
const INTEGER_PARAM_INDICES = new Set([0, 2]);
const LOG_XL_PARAM_INDICES = new Set([2, 4]);

function interpolateArray(target, from, to, amount, {
  logarithmicIndices = null,
  integerIndices = null,
  positive = false,
} = {}) {
  if (!target || !from || !to) return;
  const length = Math.min(target.length, from.length, to.length);
  for (let index = 0; index < length; index += 1) {
    const fromValue = finite(from[index]);
    const toValue = finite(to[index], fromValue);
    const value = positive || logarithmicIndices?.has(index)
      ? positiveMix(fromValue, toValue, amount)
      : mix(fromValue, toValue, amount);
    target[index] = integerIndices?.has(index) ? Math.round(value) : value;
  }
}

function writeInterpolatedConfiguration(kernel, from, to, progress) {
  if (!kernel || !from || !to) return;
  const amount = morphCurve(progress);
  interpolateArray(kernel.params, from.paramArray, to.paramArray, amount, {
    logarithmicIndices: LOG_PARAM_INDICES,
    integerIndices: INTEGER_PARAM_INDICES,
  });
  interpolateArray(kernel.stepFrequency, from.stepFrequency, to.stepFrequency, amount, {
    positive: true,
  });
  interpolateArray(kernel.stepModulation, from.modulationArray, to.modulationArray, amount);
  interpolateArray(kernel.stepExpression, from.expressionArray, to.expressionArray, amount);
  interpolateArray(kernel.partialBase, from.partialBase, to.partialBase, amount);
  interpolateArray(kernel.partialFold, from.partialFold, to.partialFold, amount);
  interpolateArray(kernel.xlParams, from.xlParamArray, to.xlParamArray, amount, {
    logarithmicIndices: LOG_XL_PARAM_INDICES,
  });
}

function createKernel(binary) {
  if (!binary) return null;
  const module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module);
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new TypeError("SIMD 303 memory export is missing.");
  for (const name of ["process", "reset", "lane_width", "block_size", "max_partials", "sequence_length"]) {
    if (typeof exports[name] !== "function") throw new TypeError(`SIMD 303 kernel export is missing: ${name}`);
  }
  const kernel = { instance, exports };
  for (const [key, [pointerName, length]] of Object.entries(ARRAY_POINTERS)) {
    if (typeof exports[pointerName] !== "function") throw new TypeError(`SIMD 303 pointer is missing: ${pointerName}`);
    kernel[key] = new Float32Array(exports.memory.buffer, exports[pointerName](), length);
  }
  exports.reset();
  return kernel;
}

function writeConfiguration(kernel, configuration) {
  if (!kernel || !configuration) return;
  kernel.params.set(configuration.paramArray);
  kernel.stepFrequency.set(configuration.stepFrequency);
  kernel.stepModulation.set(configuration.modulationArray);
  kernel.stepExpression.set(configuration.expressionArray);
  kernel.partialBase.set(configuration.partialBase);
  kernel.partialFold.set(configuration.partialFold);
  kernel.xlParams.set(configuration.xlParamArray);
}

class Simd303Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernels = { scalar: null, simd: null };
    this.kernel = null;
    this.backend = "none";
    this.ready = false;
    this.running = true;
    this.sampleCursor = 0;
    this.telemetryBlocks = 0;
    this.telemetryMicros = 0;
    this.morph = null;
    this.morphProgressBlocks = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data || {});
  }

  post(type, value = {}) {
    this.port.postMessage({ type, ...value });
  }

  install(message) {
    try {
      this.kernels.scalar = createKernel(message.scalarBytes);
      if (!this.kernels.scalar) throw new TypeError("Scalar 303 Wasm module is required.");
      try { this.kernels.simd = createKernel(message.simdBytes); } catch { this.kernels.simd = null; }
      writeConfiguration(this.kernels.scalar, message.configuration);
      writeConfiguration(this.kernels.simd, message.configuration);
      this.setBackend(message.requestedBackend === "scalar" ? "scalar" : "simd");
      this.ready = true;
      this.post("ready", {
        backend: this.backend,
        laneWidth: this.kernel.exports.lane_width(),
        simdAvailable: Boolean(this.kernels.simd),
      });
    } catch (error) {
      this.post("error", { message: error?.message || "SIMD 303 Wasm failed to start." });
    }
  }

  setBackend(requested) {
    const backend = requested === "simd" && this.kernels.simd ? "simd" : "scalar";
    const kernel = this.kernels[backend];
    if (!kernel) return;
    this.backend = backend;
    this.kernel = kernel;
    if (this.morph) {
      writeInterpolatedConfiguration(
        kernel,
        this.morph.from,
        this.morph.to,
        this.morph.elapsedSamples / this.morph.durationSamples,
      );
    }
    if (this.ready) this.post("backend", {
      backend,
      laneWidth: kernel.exports.lane_width(),
      simdAvailable: Boolean(this.kernels.simd),
    });
  }

  configure(configuration) {
    this.morph = null;
    this.morphProgressBlocks = 0;
    writeConfiguration(this.kernels.scalar, configuration);
    writeConfiguration(this.kernels.simd, configuration);
  }

  startMorph(message) {
    if (!message.from || !message.to) return;
    const durationSamples = Math.max(
      BLOCK_SIZE,
      Math.round(Math.max(0.001, finite(message.durationSeconds, 1)) * sampleRate),
    );
    this.morph = {
      id: Math.max(0, Math.trunc(finite(message.id))),
      from: message.from,
      to: message.to,
      durationSamples,
      elapsedSamples: 0,
    };
    this.morphProgressBlocks = 0;
    writeConfiguration(this.kernels.scalar, message.from);
    writeConfiguration(this.kernels.simd, message.from);
    this.post("morph-start", { id: this.morph.id, durationSamples });
  }

  prepareMorph(frames) {
    if (!this.morph || !this.kernel) return;
    const midpoint = this.morph.elapsedSamples + frames * 0.5;
    writeInterpolatedConfiguration(
      this.kernel,
      this.morph.from,
      this.morph.to,
      midpoint / this.morph.durationSamples,
    );
  }

  advanceMorph(frames) {
    if (!this.morph) return;
    this.morph.elapsedSamples += frames;
    this.morphProgressBlocks += 1;
    const progress = Math.min(1, this.morph.elapsedSamples / this.morph.durationSamples);
    if (progress >= 1) {
      const completed = this.morph;
      writeConfiguration(this.kernels.scalar, completed.to);
      writeConfiguration(this.kernels.simd, completed.to);
      this.morph = null;
      this.morphProgressBlocks = 0;
      this.post("morph-complete", { id: completed.id, progress: 1 });
      return;
    }
    if (this.morphProgressBlocks >= MORPH_PROGRESS_INTERVAL_BLOCKS) {
      this.post("morph-progress", { id: this.morph.id, progress });
      this.morphProgressBlocks = 0;
    }
  }

  handleMessage(message) {
    if (message.type === "install") this.install(message);
    else if (message.type === "configure") this.configure(message.configuration);
    else if (message.type === "morph") this.startMorph(message);
    else if (message.type === "backend") this.setBackend(message.backend);
    else if (message.type === "reset") this.sampleCursor = 0;
    else if (message.type === "dispose") this.running = false;
  }

  clear(output) {
    for (const channel of output || []) channel.fill(0);
  }

  run(frames) {
    this.kernel.exports.process(frames, sampleRate, this.sampleCursor / sampleRate);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!this.running) { this.clear(output); return false; }
    if (!this.ready || !this.kernel || !output?.[0]) { this.clear(output); return true; }
    const left = output[0];
    const right = output[1] || left;
    const frames = Math.min(BLOCK_SIZE, left.length, right.length);
    const started = globalThis.performance?.now?.() ?? 0;
    try {
      this.prepareMorph(frames);
      this.run(frames);
    } catch (error) {
      if (this.backend === "simd" && this.kernels.scalar) {
        this.setBackend("scalar");
        this.run(frames);
      } else {
        this.clear(output);
        this.ready = false;
        this.post("error", { message: error?.message || "SIMD 303 Wasm stopped." });
        return true;
      }
    }
    this.advanceMorph(frames);
    const finished = globalThis.performance?.now?.() ?? started;
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] = finite(this.kernel.outputLeft[frame], 0);
      right[frame] = finite(this.kernel.outputRight[frame], 0);
    }
    this.sampleCursor += frames;
    this.telemetryBlocks += 1;
    this.telemetryMicros += Math.max(0, (finished - started) * 1_000);
    if (this.telemetryBlocks >= TELEMETRY_INTERVAL_BLOCKS) {
      this.post("telemetry", {
        backend: this.backend,
        laneWidth: this.kernel.exports.lane_width(),
        kernelMicros: this.telemetryMicros / this.telemetryBlocks,
        budgetMicros: frames / sampleRate * 1_000_000,
      });
      this.telemetryBlocks = 0;
      this.telemetryMicros = 0;
    }
    return true;
  }
}

registerProcessor("morphazoid-simd-303", Simd303Processor);
