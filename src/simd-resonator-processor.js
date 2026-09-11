const BLOCK_SIZE = 128;
const MAX_MODES = 128;
const MAX_GRAINS = 64;
const GRAIN_SOURCE_SIZE = 16_384;
const IR_HISTORY_SIZE = 256;
const WAVEGUIDE_MAX_STRINGS = 16;
const WAVEGUIDE_DELAY_SIZE = 1_024;
const MAX_FFT_SIZE = 4_096;
const MAX_FFT_BANDS = 128;
const OLA_BUFFER_SIZE = MAX_FFT_SIZE * 4;
const OLA_BUFFER_MASK = OLA_BUFFER_SIZE - 1;
const TELEMETRY_INTERVAL_BLOCKS = 48;
const AUDIO_ENGINES = new Set(["resonator", "granular", "swarm", "freeze", "ir", "mesh", "waveguide", "spatial"]);

const ARRAY_POINTERS = Object.freeze({
  input: "input_ptr", outputLeft: "output_left_ptr", outputRight: "output_right_ptr",
  real: "real_ptr", imaginary: "imaginary_ptr", cosine: "cosine_ptr", sine: "sine_ptr",
  decay: "decay_ptr", strike: "strike_ptr", gain: "gain_ptr", panLeft: "pan_left_ptr",
  panRight: "pan_right_ptr", energy: "energy_ptr", grainSource: "grain_source_ptr",
  grainPosition: "grain_position_ptr", grainSpeed: "grain_speed_ptr", grainAge: "grain_age_ptr",
  grainAgeStep: "grain_age_step_ptr", grainGain: "grain_gain_ptr",
  grainPanLeft: "grain_pan_left_ptr", grainPanRight: "grain_pan_right_ptr",
  grainMeta: "grain_meta_ptr", swarmReal: "swarm_real_ptr",
  swarmImaginary: "swarm_imaginary_ptr", swarmCosine: "swarm_cosine_ptr",
  swarmSine: "swarm_sine_ptr", swarmGain: "swarm_gain_ptr",
  swarmPanLeft: "swarm_pan_left_ptr", swarmPanRight: "swarm_pan_right_ptr",
  swarmEnergy: "swarm_energy_ptr",
  freezeReal: "freeze_real_ptr", freezeImaginary: "freeze_imaginary_ptr",
  freezeCosine: "freeze_cosine_ptr", freezeSine: "freeze_sine_ptr",
  freezeMagnitude: "freeze_magnitude_ptr", freezeDecay: "freeze_decay_ptr",
  freezeGain: "freeze_gain_ptr", freezePanLeft: "freeze_pan_left_ptr",
  freezePanRight: "freeze_pan_right_ptr", freezeEnergy: "freeze_energy_ptr",
  irA: "ir_a_ptr", irB: "ir_b_ptr", irHistory: "ir_history_ptr", irMeta: "ir_meta_ptr",
  meshReal: "mesh_real_ptr", meshImaginary: "mesh_imaginary_ptr",
  meshCosine: "mesh_cosine_ptr", meshSine: "mesh_sine_ptr", meshDecay: "mesh_decay_ptr",
  meshStrike: "mesh_strike_ptr", meshGain: "mesh_gain_ptr",
  meshPanLeft: "mesh_pan_left_ptr", meshPanRight: "mesh_pan_right_ptr", meshEnergy: "mesh_energy_ptr",
  waveguideBuffer: "waveguide_buffer_ptr", waveguideFilter: "waveguide_filter_ptr",
  waveguideDelay: "waveguide_delay_ptr", waveguideDamping: "waveguide_damping_ptr",
  waveguideFeedback: "waveguide_feedback_ptr", waveguideGain: "waveguide_gain_ptr",
  waveguidePanLeft: "waveguide_pan_left_ptr", waveguidePanRight: "waveguide_pan_right_ptr",
  waveguideMeta: "waveguide_meta_ptr", spatialReal: "spatial_real_ptr",
  spatialImaginary: "spatial_imaginary_ptr", spatialCosine: "spatial_cosine_ptr",
  spatialSine: "spatial_sine_ptr", spatialGain: "spatial_gain_ptr",
  spatialPanLeft: "spatial_pan_left_ptr", spatialPanRight: "spatial_pan_right_ptr",
  spatialEnergy: "spatial_energy_ptr",
});
const RESONATOR_KEYS = Object.freeze(["cosine", "sine", "decay", "strike", "gain", "panLeft", "panRight"]);
const SWARM_KEYS = Object.freeze(["swarmCosine", "swarmSine", "swarmGain", "swarmPanLeft", "swarmPanRight"]);
const FREEZE_KEYS = Object.freeze(["freezeCosine", "freezeSine", "freezeDecay", "freezeGain", "freezePanLeft", "freezePanRight"]);
const IR_KEYS = Object.freeze(["irA", "irB"]);
const MESH_KEYS = Object.freeze(["meshCosine", "meshSine", "meshDecay", "meshStrike", "meshGain", "meshPanLeft", "meshPanRight"]);
const WAVEGUIDE_KEYS = Object.freeze(["waveguideDelay", "waveguideDamping", "waveguideFeedback", "waveguideGain", "waveguidePanLeft", "waveguidePanRight"]);
const SPATIAL_KEYS = Object.freeze(["spatialCosine", "spatialSine", "spatialGain", "spatialPanLeft", "spatialPanRight"]);
const STATE_KEYS = Object.freeze([
  "real", "imaginary", "energy", "grainSource", "grainPosition", "grainSpeed",
  "grainAge", "grainAgeStep", "grainGain", "grainPanLeft", "grainPanRight",
  "grainMeta", "swarmReal", "swarmImaginary", "swarmEnergy",
  "freezeReal", "freezeImaginary", "freezeMagnitude", "freezeEnergy",
  "irHistory", "irMeta", "meshReal", "meshImaginary", "meshEnergy",
  "waveguideBuffer", "waveguideFilter", "waveguideMeta",
  "spatialReal", "spatialImaginary", "spatialEnergy",
]);

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function aligned(value, fallback, maximum) { return clamp(Math.round(finite(value, fallback) / 4) * 4, 4, maximum); }

function fftInPlace(real, imaginary, size, inverse = false) {
  let reversed = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index]; real[index] = real[reversed]; real[reversed] = realValue;
      const imaginaryValue = imaginary[index]; imaginary[index] = imaginary[reversed]; imaginary[reversed] = imaginaryValue;
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = (inverse ? Math.PI * 2 : -Math.PI * 2) / width;
    const rootReal = Math.cos(angle); const rootImaginary = Math.sin(angle); const halfWidth = width >> 1;
    for (let offset = 0; offset < size; offset += width) {
      let twiddleReal = 1; let twiddleImaginary = 0;
      for (let index = 0; index < halfWidth; index += 1) {
        const even = offset + index; const odd = even + halfWidth;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even]; const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal; imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal; imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * rootReal - twiddleImaginary * rootImaginary;
        twiddleImaginary = twiddleReal * rootImaginary + twiddleImaginary * rootReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    const scale = 1 / size;
    for (let index = 0; index < size; index += 1) { real[index] *= scale; imaginary[index] *= scale; }
  }
}

function writeWindow(destination, size, shape) {
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const phase = Math.PI * 2 * index / size;
    const value = shape === 1
      ? Math.max(0, 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2))
      : shape === 2 ? Math.sin(Math.PI * (index + 0.5) / size)
      : shape === 3 ? 1
      : 0.5 - 0.5 * Math.cos(phase);
    destination[index] = value;
    sum += value;
  }
  return Math.max(1e-9, sum);
}
function arrayLength(key) {
  if (key === "input" || key === "outputLeft" || key === "outputRight") return BLOCK_SIZE;
  if (key === "grainSource") return GRAIN_SOURCE_SIZE;
  if (key === "irHistory") return IR_HISTORY_SIZE;
  if (key === "waveguideBuffer") return WAVEGUIDE_DELAY_SIZE * WAVEGUIDE_MAX_STRINGS;
  if (key === "grainMeta" || key === "irMeta" || key === "waveguideMeta") return 4;
  if (key.startsWith("grain")) return MAX_GRAINS;
  if (key.startsWith("waveguide")) return WAVEGUIDE_MAX_STRINGS;
  return MAX_MODES;
}

function createKernel(binary) {
  if (!binary) return null;
  const module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module);
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new TypeError("Kernel memory export is missing.");
  for (const name of [
    "process_resonator", "process_granular", "process_swarm", "process_freeze", "process_ir",
    "process_mesh", "process_waveguides", "process_spatial", "reset",
  ]) {
    if (typeof exports[name] !== "function") throw new TypeError("Kernel export is missing: " + name);
  }
  const kernel = { instance, exports };
  for (const [key, pointerName] of Object.entries(ARRAY_POINTERS)) {
    if (typeof exports[pointerName] !== "function") throw new TypeError("Kernel pointer is missing: " + pointerName);
    kernel[key] = new Float32Array(exports.memory.buffer, exports[pointerName](), arrayLength(key));
  }
  exports.reset();
  return kernel;
}

function writeConfiguration(kernel, configuration) {
  if (!kernel || !configuration) return;
  if (configuration.engine === "granular" || configuration.engine === "freeze") {
    if (configuration.source?.length) kernel.grainSource.set(configuration.source);
    if (configuration.engine === "granular") return;
  }
  const keys = configuration.engine === "swarm" ? SWARM_KEYS
    : configuration.engine === "freeze" ? FREEZE_KEYS
    : configuration.engine === "ir" ? IR_KEYS
    : configuration.engine === "mesh" ? MESH_KEYS
    : configuration.engine === "waveguide" ? WAVEGUIDE_KEYS
    : configuration.engine === "spatial" ? SPATIAL_KEYS
    : RESONATOR_KEYS;
  for (const key of keys) {
    if (configuration[key]?.length) kernel[key].set(configuration[key]);
  }
}

function copyState(source, destination) {
  if (!source || !destination || source === destination) return;
  for (const key of STATE_KEYS) destination[key].set(source[key]);
}

class SimdAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernels = { scalar: null, simd: null };
    this.backend = "none";
    this.kernel = null;
    this.ready = false;
    this.running = true;
    this.engine = "resonator";
    this.configuration = null;
    this.pendingConfiguration = null;
    this.sampleRate = finite(globalThis.sampleRate, 48_000);
    this.modeCount = MAX_MODES;
    this.grainCount = MAX_GRAINS;
    this.voiceCount = MAX_MODES;
    this.binCount = 64;
    this.tapCount = 128;
    this.meshModeCount = 64;
    this.stringCount = 16;
    this.sourceCount = 64;
    this.outputScale = 0.1;
    this.spawnIncrement = 0;
    this.grainSizeSamples = 4_000;
    this.pitchRatio = 1;
    this.scanPosition = 0.5;
    this.scatter = 0.3;
    this.stereoWidth = 0.8;
    this.sourceOffset = 0;
    this.morph = 0.36;
    this.coupling = 0.34;
    this.micActive = false;
    this.gate = false;
    this.pendingImpulse = 0;
    this.pendingBurst = 0;
    this.pendingCapture = 0;
    this.pendingTrigger = null;
    this.irDemoFrame = 0;
    this.irDemoRemaining = 0;
    this.irDemoNoiseState = 0x51f15e3d;
    this.irDemoBlockActive = false;
    this.swarmEnvelope = 0;
    this.swarmPulse = 0;
    this.spatialEnvelope = 0;
    this.spatialPulse = 0;
    this.transitionGain = 1;
    this.telemetryBlocks = 0;
    this.telemetryMicros = 0;
    this.telemetrySamples = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.telemetryEnergy = new Float32Array(MAX_MODES);
    this.telemetryState = new Float32Array(MAX_MODES);
    this.fftSize = 1_024;
    this.fftWindow = 0;
    this.fftHopSize = 256;
    this.fftBandCount = 96;
    this.fftResponseSeconds = 0.038;
    this.fftLowFrequency = 70;
    this.fftHighFrequency = 12_000;
    this.fftDetail = 0.9;
    this.fftMix = 0.94;
    this.fftInputGain = 1.4;
    this.fftGateDb = -72;
    this.fftWindowSum = 1;
    this.fftAnalysisRing = new Float64Array(MAX_FFT_SIZE);
    this.fftReal = new Float64Array(MAX_FFT_SIZE);
    this.fftImaginary = new Float64Array(MAX_FFT_SIZE);
    this.fftWindowValues = new Float64Array(MAX_FFT_SIZE);
    this.fftOla = new Float64Array(OLA_BUFFER_SIZE);
    this.fftOlaNormalization = new Float64Array(OLA_BUFFER_SIZE);
    this.fftBandPower = new Float64Array(MAX_FFT_BANDS);
    this.fftBandWeight = new Float64Array(MAX_FFT_BANDS);
    this.fftBandMagnitude = new Float64Array(MAX_FFT_BANDS);
    this.fftBandEnvelope = new Float64Array(MAX_FFT_BANDS);
    this.fftInputTelemetry = new Float32Array(MAX_FFT_BANDS);
    this.fftOutputTelemetry = new Float32Array(MAX_FFT_BANDS);
    this.fftResynthBlock = new Float32Array(BLOCK_SIZE);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
    this.fftConfigured = false;
    this.port.onmessage = (event) => this.handleMessage(event.data || {});
    this.post("boot");
  }

  post(type, value = {}) { this.port.postMessage({ type, ...value }); }

  resetResynthesis() {
    this.fftAnalysisRing.fill(0);
    this.fftReal.fill(0);
    this.fftImaginary.fill(0);
    this.fftOla.fill(0);
    this.fftOlaNormalization.fill(0);
    this.fftBandPower.fill(0);
    this.fftBandWeight.fill(0);
    this.fftBandMagnitude.fill(0);
    this.fftBandEnvelope.fill(0);
    this.fftInputTelemetry.fill(0);
    this.fftOutputTelemetry.fill(0);
    this.fftResynthBlock.fill(0);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
  }

  configureResynthesis(configuration) {
    const requestedSize = clamp(Math.round(finite(configuration.fftSize, 1_024)), 256, MAX_FFT_SIZE);
    const nextSize = requestedSize < 384 ? 256 : requestedSize < 768 ? 512
      : requestedSize < 1_536 ? 1_024 : requestedSize < 3_072 ? 2_048 : 4_096;
    const nextWindow = clamp(Math.round(finite(configuration.fftWindow, 0)), 0, 3);
    const nextHop = clamp(Math.round(finite(configuration.fftHopSize, nextSize * 0.25) / 32) * 32, 32, nextSize);
    const nextBandCount = Math.max(16, aligned(configuration.fftBandCount, 96, MAX_FFT_BANDS));
    const nextLow = clamp(finite(configuration.fftLowFrequency, 70), 20, this.sampleRate * 0.22);
    const nextHigh = clamp(finite(configuration.fftHighFrequency, 12_000), nextLow * 2, this.sampleRate * 0.45);
    const rebuild = !this.fftConfigured || nextSize !== this.fftSize || nextWindow !== this.fftWindow
      || nextHop !== this.fftHopSize || nextBandCount !== this.fftBandCount
      || nextLow !== this.fftLowFrequency || nextHigh !== this.fftHighFrequency;
    this.fftSize = nextSize;
    this.fftWindow = nextWindow;
    this.fftHopSize = nextHop;
    this.fftBandCount = nextBandCount;
    this.fftResponseSeconds = clamp(finite(configuration.fftResponseSeconds, 0.038), 0.004, 0.8);
    this.fftLowFrequency = nextLow;
    this.fftHighFrequency = nextHigh;
    this.fftDetail = clamp(finite(configuration.fftDetail, 0.9), 0, 1);
    this.fftMix = clamp(finite(configuration.fftMix, 0.94), 0, 1);
    this.fftInputGain = clamp(finite(configuration.fftInputGain, 1.4), 0.25, 4);
    this.fftGateDb = clamp(finite(configuration.fftGateDb, -72), -96, -30);
    if (rebuild) {
      this.fftWindowSum = writeWindow(this.fftWindowValues, this.fftSize, this.fftWindow);
      this.resetResynthesis();
    }
    this.fftConfigured = true;
  }

  analyzeResynthesisFrame() {
    if (this.fftAnalysisFill < this.fftSize) return;
    const started = globalThis.performance?.now?.() ?? 0;
    const size = this.fftSize;
    const halfSize = size >> 1;
    const bandCount = this.fftBandCount;
    for (let index = 0; index < size; index += 1) {
      const sourceIndex = (this.fftAnalysisWrite + index) % size;
      this.fftReal[index] = this.fftAnalysisRing[sourceIndex] * this.fftWindowValues[index];
      this.fftImaginary[index] = 0;
    }
    fftInPlace(this.fftReal, this.fftImaginary, size);
    this.fftBandPower.fill(0, 0, bandCount);
    this.fftBandWeight.fill(0, 0, bandCount);
    const logLow = Math.log(this.fftLowFrequency);
    const logScale = (bandCount - 1) / Math.log(this.fftHighFrequency / this.fftLowFrequency);
    for (let bin = 1; bin < halfSize; bin += 1) {
      const frequency = bin * this.sampleRate / size;
      if (frequency < this.fftLowFrequency || frequency > this.fftHighFrequency) continue;
      const position = clamp((Math.log(frequency) - logLow) * logScale, 0, bandCount - 1);
      const leftBand = Math.floor(position); const rightBand = Math.min(bandCount - 1, leftBand + 1);
      const rightWeight = position - leftBand; const leftWeight = 1 - rightWeight;
      const power = this.fftReal[bin] * this.fftReal[bin] + this.fftImaginary[bin] * this.fftImaginary[bin];
      this.fftBandPower[leftBand] += power * leftWeight; this.fftBandWeight[leftBand] += leftWeight;
      if (rightBand !== leftBand) {
        this.fftBandPower[rightBand] += power * rightWeight; this.fftBandWeight[rightBand] += rightWeight;
      }
    }
    const attackRetention = Math.exp(-this.fftHopSize / (this.sampleRate * 0.004));
    const releaseRetention = Math.exp(-this.fftHopSize / (this.sampleRate * this.fftResponseSeconds));
    for (let band = 0; band < bandCount; band += 1) {
      const magnitude = this.fftBandWeight[band] > 1e-9
        ? Math.sqrt(this.fftBandPower[band] / this.fftBandWeight[band]) : 0;
      const normalized = magnitude * 2 / this.fftWindowSum;
      const db = 20 * Math.log10(Math.max(1e-12, normalized));
      const gatePosition = clamp((db - (this.fftGateDb - 4)) / 8, 0, 1);
      const gate = gatePosition * gatePosition * (3 - 2 * gatePosition);
      const target = magnitude * gate;
      const previous = this.fftBandEnvelope[band];
      const retention = target > previous ? attackRetention : releaseRetention;
      const envelope = target + (previous - target) * retention;
      this.fftBandMagnitude[band] = magnitude;
      this.fftBandEnvelope[band] = envelope;
      this.fftInputTelemetry[band] = clamp((db + 84) / 72, 0, 1);
      const outputDb = 20 * Math.log10(Math.max(1e-12, envelope * 2 / this.fftWindowSum));
      this.fftOutputTelemetry[band] = clamp((outputDb + 84) / 72, 0, 1);
    }
    this.fftInputTelemetry.fill(0, bandCount);
    this.fftOutputTelemetry.fill(0, bandCount);
    this.fftReal[0] = 0; this.fftImaginary[0] = 0;
    this.fftReal[halfSize] = 0; this.fftImaginary[halfSize] = 0;
    for (let bin = 1; bin < halfSize; bin += 1) {
      const frequency = bin * this.sampleRate / size;
      if (frequency < this.fftLowFrequency || frequency > this.fftHighFrequency) {
        this.fftReal[bin] = 0; this.fftImaginary[bin] = 0;
      } else {
        const position = clamp((Math.log(frequency) - logLow) * logScale, 0, bandCount - 1);
        const leftBand = Math.floor(position); const rightBand = Math.min(bandCount - 1, leftBand + 1);
        const rightWeight = position - leftBand; const leftWeight = 1 - rightWeight;
        const rawBand = this.fftBandMagnitude[leftBand] * leftWeight + this.fftBandMagnitude[rightBand] * rightWeight;
        const envelope = this.fftBandEnvelope[leftBand] * leftWeight + this.fftBandEnvelope[rightBand] * rightWeight;
        const real = this.fftReal[bin]; const imaginary = this.fftImaginary[bin];
        const magnitude = Math.hypot(real, imaginary);
        const detailedMagnitude = magnitude * envelope / Math.max(1e-12, rawBand);
        const targetMagnitude = detailedMagnitude * this.fftDetail + envelope * (1 - this.fftDetail);
        const gain = magnitude > 1e-12 ? targetMagnitude / magnitude : 0;
        this.fftReal[bin] = real * gain; this.fftImaginary[bin] = imaginary * gain;
      }
      this.fftReal[size - bin] = this.fftReal[bin];
      this.fftImaginary[size - bin] = -this.fftImaginary[bin];
    }
    fftInPlace(this.fftReal, this.fftImaginary, size, true);
    const writeStart = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    for (let index = 0; index < size; index += 1) {
      const destination = (writeStart + index) & OLA_BUFFER_MASK;
      const windowValue = this.fftWindowValues[index];
      this.fftOla[destination] += this.fftReal[index] * windowValue;
      this.fftOlaNormalization[destination] += windowValue * windowValue;
    }
    const finished = globalThis.performance?.now?.() ?? started;
    if (finished >= started) { this.fftAnalysisMicros += (finished - started) * 1_000; this.fftAnalysisFrames += 1; }
  }

  processResynthesisSample(input) {
    this.fftAnalysisRing[this.fftAnalysisWrite] = input * this.fftInputGain;
    this.fftAnalysisWrite = (this.fftAnalysisWrite + 1) % this.fftSize;
    if (this.fftAnalysisFill < this.fftSize) this.fftAnalysisFill += 1;
    this.fftHopCounter += 1;
    if (this.fftAnalysisFill === this.fftSize && this.fftHopCounter >= this.fftHopSize) {
      this.fftHopCounter = 0;
      this.analyzeResynthesisFrame();
    }
    const normalization = this.fftOlaNormalization[this.fftOlaRead];
    const output = normalization > 1e-8 ? this.fftOla[this.fftOlaRead] / normalization : 0;
    this.fftOla[this.fftOlaRead] = 0;
    this.fftOlaNormalization[this.fftOlaRead] = 0;
    this.fftOlaRead = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    return clamp(finite(output, 0), -2, 2);
  }

  install(message) {
    try {
      this.kernels.scalar = createKernel(message.scalarBytes);
      if (!this.kernels.scalar) throw new TypeError("Scalar Wasm module is required.");
      try { this.kernels.simd = createKernel(message.simdBytes); } catch { this.kernels.simd = null; }
      this.applyConfiguration(message.configuration);
      this.setBackend(message.requestedBackend === "scalar" ? "scalar" : "simd");
      this.ready = true;
      this.post("ready", {
        engine: this.engine,
        backend: this.backend,
        laneWidth: this.kernel.exports.lane_width(),
        simdAvailable: Boolean(this.kernels.simd),
      });
    } catch (error) {
      this.ready = false;
      this.post("error", { message: error?.message || "Wasm kernel failed to start." });
    }
  }

  applyConfiguration(configuration) {
    if (!configuration) return;
    const previousModeCount = this.modeCount;
    const engine = AUDIO_ENGINES.has(configuration.engine) ? configuration.engine : "resonator";
    this.configuration = configuration;
    this.engine = engine;
    this.modeCount = aligned(configuration.modeCount, this.modeCount, MAX_MODES);
    this.grainCount = aligned(configuration.grainCount, this.grainCount, MAX_GRAINS);
    this.voiceCount = aligned(configuration.voiceCount, this.voiceCount, MAX_MODES);
    this.binCount = aligned(configuration.binCount, this.binCount, 64);
    this.tapCount = aligned(configuration.tapCount, this.tapCount, 128);
    this.meshModeCount = aligned(configuration.modeCount, this.meshModeCount, 64);
    this.stringCount = aligned(configuration.stringCount, this.stringCount, WAVEGUIDE_MAX_STRINGS);
    this.sourceCount = aligned(configuration.sourceCount, this.sourceCount, 64);
    this.outputScale = clamp(finite(configuration.outputScale, 0.1), 0, 1);
    this.spawnIncrement = clamp(finite(configuration.spawnIncrement, this.spawnIncrement), 0, 1);
    this.grainSizeSamples = clamp(finite(configuration.grainSizeSamples, this.grainSizeSamples), 32, 96_000);
    this.pitchRatio = clamp(finite(configuration.pitchRatio, this.pitchRatio), 0.125, 8);
    this.scanPosition = clamp(finite(configuration.scanPosition, this.scanPosition), 0, 1);
    this.scatter = clamp(finite(configuration.scatter, this.scatter), 0, 1);
    this.stereoWidth = clamp(finite(configuration.stereoWidth, this.stereoWidth), 0, 1);
    this.sourceOffset = clamp(Math.round(finite(configuration.sourceOffset, this.sourceOffset)), 0, GRAIN_SOURCE_SIZE - BLOCK_SIZE);
    this.morph = clamp(finite(configuration.morph, this.morph), 0, 1);
    this.coupling = clamp(finite(configuration.coupling, this.coupling), 0, 1);
    if (engine === "resonator") this.configureResynthesis(configuration);
    if (engine === "resonator" && this.modeCount < previousModeCount) {
      for (const kernel of Object.values(this.kernels)) {
        kernel?.real.fill(0, this.modeCount, previousModeCount);
        kernel?.imaginary.fill(0, this.modeCount, previousModeCount);
        kernel?.energy.fill(0, this.modeCount, previousModeCount);
      }
    }
    writeConfiguration(this.kernels.scalar, configuration);
    writeConfiguration(this.kernels.simd, configuration);
  }

  configure(configuration) {
    if (!configuration) return;
    if (this.ready && configuration.engine && configuration.engine !== this.engine) {
      const sourceEngine = configuration.engine === "granular" || configuration.engine === "freeze";
      const retainedSource = sourceEngine
        && !configuration.source
        && this.pendingConfiguration?.engine === configuration.engine
        ? this.pendingConfiguration.source
        : null;
      this.pendingConfiguration = retainedSource
        ? { ...configuration, source: retainedSource }
        : configuration;
      return;
    }
    this.applyConfiguration(configuration);
  }

  setBackend(requested) {
    const nextBackend = requested === "simd" && this.kernels.simd ? "simd" : "scalar";
    const nextKernel = this.kernels[nextBackend];
    if (!nextKernel) return;
    copyState(this.kernel, nextKernel);
    this.backend = nextBackend;
    this.kernel = nextKernel;
    if (this.ready) this.post("backend", { backend: this.backend, laneWidth: this.kernel.exports.lane_width(), simdAvailable: Boolean(this.kernels.simd) });
  }

  trigger(strength, requestedEngine = this.engine) {
    if (requestedEngine !== this.engine) {
      if (this.pendingConfiguration?.engine === requestedEngine) {
        this.pendingTrigger = { engine: requestedEngine, strength: finite(strength, 0.8) };
      }
      return;
    }
    if (this.engine === "granular") {
      this.pendingBurst = clamp(this.pendingBurst + Math.round(4 + finite(strength, 0.8) * 4), 0, 8);
    } else if (this.engine === "swarm") {
      this.swarmPulse = Math.max(this.swarmPulse, clamp(finite(strength, 0.85), 0.1, 1.3));
    } else if (this.engine === "spatial") {
      this.spatialPulse = Math.max(this.spatialPulse, clamp(finite(strength, 0.85), 0.1, 1.3));
    } else if (this.engine === "freeze") {
      this.pendingCapture = Math.max(this.pendingCapture, clamp(finite(strength, 0.85), 0.1, 1.3));
    } else if (this.engine === "ir") {
      this.pendingImpulse = 0;
      this.irDemoFrame = 0;
      this.irDemoRemaining = Math.round(this.sampleRate * 0.66);
      this.irDemoNoiseState = 0x51f15e3d;
    } else {
      this.pendingImpulse = clamp(this.pendingImpulse + finite(strength, 0.75), -2, 2);
    }
  }

  reset() {
    this.gate = false;
    this.pendingImpulse = 0;
    this.pendingBurst = 0;
    this.pendingCapture = 0;
    this.pendingTrigger = null;
    this.irDemoFrame = 0;
    this.irDemoRemaining = 0;
    this.irDemoNoiseState = 0x51f15e3d;
    this.irDemoBlockActive = false;
    this.swarmEnvelope = 0;
    this.swarmPulse = 0;
    this.spatialEnvelope = 0;
    this.spatialPulse = 0;
    this.pendingConfiguration = null;
    this.transitionGain = 1;
    this.resetResynthesis();
    this.kernels.scalar?.exports.reset();
    this.kernels.simd?.exports.reset();
    writeConfiguration(this.kernels.scalar, this.configuration);
    writeConfiguration(this.kernels.simd, this.configuration);
  }

  handleMessage(message) {
    switch (message.type) {
      case "install": this.install(message); break;
      case "configure": this.configure(message.configuration); break;
      case "backend": this.setBackend(message.backend); break;
      case "trigger":
      case "pluck": this.trigger(message.strength, message.engine); break;
      case "gate": this.gate = Boolean(message.active); break;
      case "mic": {
        const active = Boolean(message.active);
        if (active !== this.micActive) this.resetResynthesis();
        this.micActive = active;
        break;
      }
      case "reset": this.reset(); break;
      case "dispose": this.running = false; this.reset(); break;
      default: break;
    }
  }

  clearOutput(output) { for (const channel of output || []) channel.fill(0); }

  nextIrDemoSample() {
    const frame = this.irDemoFrame;
    const time = frame / this.sampleRate;
    this.irDemoFrame += 1;
    this.irDemoRemaining = Math.max(0, this.irDemoRemaining - 1);
    this.irDemoNoiseState = (Math.imul(this.irDemoNoiseState, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = this.irDemoNoiseState / 0xffff_ffff * 2 - 1;
    const starts = [0, 0.16, 0.32, 0.48];
    const frequencies = [110, 165, 220, 147];
    let sample = 0;
    for (let index = 0; index < starts.length; index += 1) {
      const local = time - starts[index];
      if (local < 0 || local > 0.13) continue;
      const envelope = Math.exp(-local * (24 + index * 3));
      const tone = Math.sin(Math.PI * 2 * frequencies[index] * local);
      sample += (tone * 0.72 + noise * 0.28) * envelope * 0.42;
    }
    return clamp(sample, -0.8, 0.8);
  }

  fillTelemetryState() {
    this.telemetryEnergy.fill(0);
    this.telemetryState.fill(0);
    if (this.engine === "granular") {
      for (let index = 0; index < this.grainCount; index += 1) {
        const age = this.kernel.grainAge[index];
        if (!(age >= 0 && age < 1)) continue;
        const base = 4 * age * (1 - age);
        this.telemetryEnergy[index] = base * base * this.kernel.grainGain[index];
        this.telemetryState[index] = this.kernel.grainPosition[index] / GRAIN_SOURCE_SIZE;
      }
      return;
    }
    if (this.engine === "freeze") {
      this.telemetryEnergy.set(this.kernel.freezeEnergy.subarray(0, this.binCount));
      this.telemetryState.set(this.kernel.freezeMagnitude.subarray(0, this.binCount));
      return;
    }
    if (this.engine === "ir") {
      const cursor = Math.round(this.kernel.irMeta[0]) & 127;
      for (let index = 0; index < this.tapCount; index += 1) {
        this.telemetryEnergy[index] = Math.min(1, Math.abs(this.kernel.irHistory[(cursor + index) & 127]) * 3);
        this.telemetryState[index] = this.kernel.irA[index] + (this.kernel.irB[index] - this.kernel.irA[index]) * this.morph;
      }
      return;
    }
    if (this.engine === "mesh") {
      this.telemetryEnergy.set(this.kernel.meshEnergy.subarray(0, this.meshModeCount));
      this.telemetryState.set(this.kernel.meshReal.subarray(0, this.meshModeCount));
      return;
    }
    if (this.engine === "waveguide") {
      for (let index = 0; index < this.stringCount; index += 1) {
        this.telemetryEnergy[index] = Math.min(1, Math.abs(this.kernel.waveguideFilter[index]) * 4);
        this.telemetryState[index] = this.kernel.waveguideDelay[index] / WAVEGUIDE_DELAY_SIZE;
      }
      return;
    }
    if (this.engine === "spatial") {
      this.telemetryEnergy.set(this.kernel.spatialEnergy.subarray(0, this.sourceCount));
      this.telemetryState.set(this.kernel.spatialReal.subarray(0, this.sourceCount));
      return;
    }
    const count = this.engine === "swarm" ? this.voiceCount : this.modeCount;
    const energy = this.engine === "swarm" ? this.kernel.swarmEnergy : this.kernel.energy;
    const signal = this.engine === "swarm" ? this.kernel.swarmReal : this.kernel.real;
    this.telemetryEnergy.set(energy.subarray(0, count));
    this.telemetryState.set(signal.subarray(0, count));
  }

  publishTelemetry(frames, elapsedMicros) {
    this.telemetryBlocks += 1;
    if (Number.isFinite(elapsedMicros) && elapsedMicros >= 0) {
      this.telemetryMicros += elapsedMicros;
      this.telemetrySamples += 1;
    }
    if (this.telemetryBlocks < TELEMETRY_INTERVAL_BLOCKS) return;
    this.fillTelemetryState();
    const workCount = this.engine === "granular" ? this.grainCount
      : this.engine === "swarm" ? this.voiceCount
      : this.engine === "freeze" ? this.binCount
      : this.engine === "ir" ? this.tapCount
      : this.engine === "mesh" ? this.meshModeCount
      : this.engine === "waveguide" ? this.stringCount
      : this.engine === "spatial" ? this.sourceCount
      : this.modeCount;
    this.post("telemetry", {
      engine: this.engine, backend: this.backend, laneWidth: this.kernel.exports.lane_width(), workCount,
      kernelMicros: this.telemetrySamples ? this.telemetryMicros / this.telemetrySamples : null,
      budgetMicros: frames / sampleRate * 1_000_000, peak: this.lastPeak, rms: this.lastRms,
      modalEnergy: this.telemetryEnergy, modalState: this.telemetryState,
      fftSize: this.engine === "resonator" ? this.fftSize : null,
      fftHopSize: this.engine === "resonator" ? this.fftHopSize : null,
      fftBandCount: this.engine === "resonator" ? this.fftBandCount : null,
      fftAnalysisMicros: this.fftAnalysisFrames ? this.fftAnalysisMicros / this.fftAnalysisFrames : null,
      fftInput: this.engine === "resonator" ? this.fftInputTelemetry : null,
      fftOutput: this.engine === "resonator" ? this.fftOutputTelemetry : null,
    });
    this.telemetryBlocks = 0;
    this.telemetryMicros = 0;
    this.telemetrySamples = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
  }

  runKernel(frames) {
    if (this.engine === "granular") {
      this.kernel.exports.process_granular(
        frames, this.grainCount, this.gate ? this.spawnIncrement : 0,
        this.grainSizeSamples, this.pitchRatio, this.scanPosition, this.scatter,
        this.stereoWidth, this.micActive ? 1 : 0, this.pendingBurst, this.outputScale,
      );
      this.pendingBurst = 0;
      return;
    }
    if (this.engine === "swarm") {
      this.kernel.exports.process_swarm(frames, this.voiceCount, this.outputScale);
      return;
    }
    if (this.engine === "freeze") {
      this.kernel.exports.process_freeze(
        frames, this.binCount, this.pendingCapture, this.micActive ? 1 : 0,
        this.sourceOffset, this.outputScale,
      );
      this.pendingCapture = 0;
      return;
    }
    if (this.engine === "ir") {
      this.kernel.exports.process_ir(
        frames, this.tapCount, this.morph, this.pendingImpulse,
        this.micActive || this.irDemoBlockActive ? 1 : 0, this.outputScale,
      );
      this.pendingImpulse = 0;
      return;
    }
    if (this.engine === "mesh") {
      this.kernel.exports.process_mesh(frames, this.meshModeCount, this.pendingImpulse, this.coupling, this.outputScale);
      this.pendingImpulse = 0;
      return;
    }
    if (this.engine === "waveguide") {
      this.kernel.exports.process_waveguides(
        frames, this.stringCount, this.pendingImpulse, this.micActive ? 1 : 0, this.outputScale,
      );
      this.pendingImpulse = 0;
      return;
    }
    if (this.engine === "spatial") {
      this.kernel.exports.process_spatial(frames, this.sourceCount, this.outputScale);
      return;
    }
    this.kernel.exports.process_resonator(frames, this.modeCount, this.pendingImpulse, this.outputScale);
    this.pendingImpulse = 0;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!this.running) { this.clearOutput(output); return false; }
    if (!this.ready || !this.kernel || !output?.[0]) { this.clearOutput(output); return true; }
    const left = output[0];
    const right = output[1] || left;
    const frames = Math.min(BLOCK_SIZE, left.length, right.length);
    const input = inputs[0]?.[0];
    this.irDemoBlockActive = false;
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const rawInput = frame < frames ? finite(input?.[frame], 0) : 0;
      let inputSample = rawInput * 0.34;
      if (frame < frames && this.engine === "ir" && this.irDemoRemaining > 0) {
        inputSample += this.nextIrDemoSample();
        this.irDemoBlockActive = true;
      }
      this.kernel.input[frame] = inputSample;
      this.fftResynthBlock[frame] = this.engine === "resonator" && this.micActive && frame < frames
        ? this.processResynthesisSample(rawInput) : 0;
    }

    const urgentTelemetry = this.pendingImpulse !== 0 || this.pendingBurst !== 0 || this.pendingCapture !== 0
      || this.swarmPulse !== 0 || this.spatialPulse !== 0 || this.irDemoBlockActive;
    const started = globalThis.performance?.now?.() ?? 0;
    try {
      this.runKernel(frames);
    } catch (error) {
      if (this.backend === "simd" && this.kernels.scalar) {
        this.setBackend("scalar");
        this.runKernel(frames);
        this.post("error", { message: "SIMD stopped; scalar Wasm is active." });
      } else {
        this.clearOutput(output);
        this.ready = false;
        this.post("error", { message: error?.message || "Wasm kernel stopped." });
        return true;
      }
    }
    const finished = globalThis.performance?.now?.() ?? started;
    let peak = 0;
    let squareSum = 0;
    const transitionTarget = this.pendingConfiguration ? 0 : 1;
    const transitionStep = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.008));
    const swarmStep = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.006));
    for (let frame = 0; frame < frames; frame += 1) {
      this.transitionGain += (transitionTarget - this.transitionGain) * transitionStep;
      let engineGain = 1;
      if (this.engine === "swarm") {
        const swarmTarget = this.gate ? 1 : this.swarmPulse;
        this.swarmEnvelope += (swarmTarget - this.swarmEnvelope) * swarmStep;
        this.swarmPulse *= 0.9999;
        if (this.swarmPulse < 0.0001) this.swarmPulse = 0;
        engineGain = this.swarmEnvelope;
      } else if (this.engine === "spatial") {
        const spatialTarget = this.gate ? 1 : this.spatialPulse;
        this.spatialEnvelope += (spatialTarget - this.spatialEnvelope) * swarmStep;
        this.spatialPulse *= 0.9999;
        if (this.spatialPulse < 0.0001) this.spatialPulse = 0;
        engineGain = this.spatialEnvelope;
      }
      let kernelLeft = finite(this.kernel.outputLeft[frame], 0);
      let kernelRight = finite(this.kernel.outputRight[frame], 0);
      if (this.engine === "resonator" && this.micActive) {
        const mixAngle = this.fftMix * Math.PI * 0.5;
        const modalGain = Math.cos(mixAngle);
        const resynthGain = Math.sin(mixAngle) * 0.5;
        const spectral = this.fftResynthBlock[frame] * resynthGain;
        kernelLeft = kernelLeft * modalGain + spectral;
        kernelRight = kernelRight * modalGain + spectral;
      }
      const leftSample = clamp(kernelLeft * engineGain * this.transitionGain, -1, 1);
      const rightSample = clamp(kernelRight * engineGain * this.transitionGain, -1, 1);
      left[frame] = leftSample;
      right[frame] = rightSample;
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
      squareSum += leftSample * leftSample + rightSample * rightSample;
    }
    if (this.pendingConfiguration && this.transitionGain < 0.015) {
      const next = this.pendingConfiguration;
      this.pendingConfiguration = null;
      this.applyConfiguration(next);
      this.transitionGain = 0;
      this.swarmEnvelope = 0;
      this.spatialEnvelope = 0;
      if (this.pendingTrigger?.engine === this.engine) {
        const pendingTrigger = this.pendingTrigger;
        this.pendingTrigger = null;
        this.trigger(pendingTrigger.strength, pendingTrigger.engine);
      }
      this.post("engine", { engine: this.engine });
    }
    this.lastPeak = peak;
    this.lastRms = Math.sqrt(squareSum / Math.max(1, frames * 2));
    if (urgentTelemetry) this.telemetryBlocks = Math.max(this.telemetryBlocks, TELEMETRY_INTERVAL_BLOCKS - 1);
    this.publishTelemetry(frames, Math.max(0, (finished - started) * 1_000));
    return true;
  }
}

registerProcessor("morphazoid-simd-resonator", SimdAudioProcessor);
