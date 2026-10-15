import { MAX_MODES, BLOCK_SIZE, COEFFICIENT_KEYS, kernelViews } from './model.js';
import { FftResynth } from './fft-resynth.js';

const finite = value => Number.isFinite(value) ? value : 0;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const now = () => globalThis.performance?.now?.() ?? Date.now();
const STATE_KEYS = ['real', 'imaginary', 'energy'];

class RustResonatorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = true; this.ready = false; this.kernel = null;
    this.kernels = {}; this.backend = 'none'; this.modeCount = 512;
    this.impulse = 0; this.inputActive = false; this.outputScale = .1;
    this.spectrum = new FftResynth(sampleRate);
    this.spectralBlock = new Float32Array(BLOCK_SIZE);
    this.visualEnergy = new Float32Array(128); this.visualState = new Float32Array(128);
    this.blocks = 0; this.callbackMicros = 0; this.kernelMicros = 0; this.callbackMaxMicros = 0;
    this.callbackOverruns = 0; this.totalFrames = 0;
    this.pendingConfiguration = null; this.transition = 'steady';
    this.port.onmessage = event => this.message(event.data || {});
    this.post('boot');
  }
  post(type, value = {}) { this.port.postMessage({ type, ...value }); }
  install(message) {
    const load = bytes => {
      if (!bytes) return null;
      const module = bytes instanceof WebAssembly.Module ? bytes : new WebAssembly.Module(bytes);
      if (WebAssembly.Module.imports(module).length) throw new Error('Rust kernel unexpectedly requires imports.');
      const kernel = kernelViews(new WebAssembly.Instance(module).exports);
      kernel.exports.reset(); return kernel;
    };
    this.kernels.scalar = load(message.scalarBytes);
    if (!this.kernels.scalar) throw new Error('Rust scalar kernel is required.');
    try { this.kernels.simd = load(message.simdBytes); } catch { this.kernels.simd = null; }
    this.configure(message.configuration);
    this.selectBackend(message.requestedBackend);
    this.ready = true;
    this.post('ready', { backend: this.backend, laneWidth: this.kernel.exports.lane_width(), simdAvailable: Boolean(this.kernels.simd) });
  }
  configure(configuration) {
    if (!configuration || !Number.isInteger(configuration.modeCount) || configuration.modeCount < 32
      || configuration.modeCount > MAX_MODES || configuration.modeCount % 4
      || !Number.isFinite(configuration.outputScale) || configuration.outputScale < 0 || configuration.outputScale > 1) {
      throw new Error('Invalid Rust resonator configuration.');
    }
    for (const key of COEFFICIENT_KEYS) {
      const array = configuration[key];
      if (!(array instanceof Float32Array) || array.length !== MAX_MODES || !array.every(Number.isFinite)) {
        throw new Error('Invalid modal coefficients: ' + key);
      }
    }
    // The modal bank fades over one quantum on either side of an edit. The
    // external source and FFT stream keep advancing through this short ramp.
    if (this.ready) {
      this.pendingConfiguration = configuration;
      if (this.transition === 'steady') this.transition = 'fall';
      return;
    }
    this.applyConfiguration(configuration);
  }
  applyConfiguration(configuration) {
    for (const kernel of Object.values(this.kernels)) {
      if (!kernel) continue;
      if (configuration.modeCount < this.modeCount) for (const key of STATE_KEYS) kernel[key].fill(0, configuration.modeCount);
      for (const key of COEFFICIENT_KEYS) kernel[key].set(configuration[key]);
    }
    this.modeCount = configuration.modeCount; this.outputScale = configuration.outputScale;
    this.audibleModes = configuration.audibleModes;
    this.spectrum.configureResynthesis(configuration);
  }
  selectBackend(requested) {
    const backend = requested !== 'scalar' && this.kernels.simd ? 'simd' : 'scalar';
    const next = this.kernels[backend];
    if (!next) return;
    if (this.kernel && this.kernel !== next) for (const key of STATE_KEYS) next[key].set(this.kernel[key]);
    this.kernel = next; this.backend = backend;
    this.post('backend', { backend, laneWidth: next.exports.lane_width(), simdAvailable: Boolean(this.kernels.simd) });
  }
  message(message) {
    if (!this.running) return;
    try {
      if (message.type === 'install') this.install(message);
      else if (message.type === 'configure') this.configure(message.configuration);
      else if (message.type === 'backend') this.selectBackend(message.backend);
      else if (message.type === 'trigger' && this.ready) this.impulse = clamp(this.impulse + finite(message.strength), 0, 1.5);
      else if (message.type === 'mic') {
        this.inputActive = Boolean(message.active);
        if (!this.inputActive) this.spectrum.resetResynthesis();
      } else if (message.type === 'reset') {
        if (this.pendingConfiguration) this.applyConfiguration(this.pendingConfiguration);
        this.pendingConfiguration = null; this.transition = 'steady';
        for (const kernel of Object.values(this.kernels)) kernel?.exports.reset_resonator();
        this.spectrum.resetResynthesis(); this.impulse = 0;
      } else if (message.type === 'dispose') {
        this.running = false; this.ready = false; this.impulse = 0;
        this.kernels = {}; this.kernel = null; this.port.onmessage = null;
      }
    } catch (error) { this.post('error', { message: error?.message || 'Rust resonator failed.' }); }
  }
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return this.running;
    for (const channel of output) channel.fill(0);
    if (!this.running || !this.ready || !this.kernel) return this.running;
    const started = now();
    if (this.transition === 'apply') {
      this.applyConfiguration(this.pendingConfiguration);
      this.pendingConfiguration = null; this.transition = 'rise';
    } else if (this.transition === 'steady' && this.pendingConfiguration) this.transition = 'fall';
    const left = output[0], right = output[1] || left;
    const frames = Math.min(BLOCK_SIZE, left.length, right.length);
    const input = inputs[0]?.[0];
    for (let frame = 0; frame < BLOCK_SIZE; frame++) {
      const raw = frame < frames && this.inputActive ? finite(input?.[frame]) : 0;
      this.kernel.input[frame] = raw * .34;
      this.spectralBlock[frame] = this.inputActive && frame < frames ? this.spectrum.processResynthesisSample(raw) : 0;
    }
    const kernelStart = now();
    const soundingImpulse = this.transition === 'fall' ? 0 : this.impulse;
    try { this.kernel.exports.process_resonator(frames, this.modeCount, soundingImpulse, this.outputScale); }
    catch (error) {
      this.ready = false; this.post('error', { message: error?.message || 'Rust audio processor stopped.' }); return true;
    }
    const kernelElapsed = (now() - kernelStart) * 1000;
    const urgent = soundingImpulse > 0;
    if (this.transition !== 'fall') this.impulse = 0;
    const modalGain = this.inputActive ? Math.cos(this.spectrum.fftMix * Math.PI * .5) : 1;
    const spectralGain = this.inputActive ? Math.sin(this.spectrum.fftMix * Math.PI * .5) * .5 : 0;
    let peak = 0, square = 0;
    for (let frame = 0; frame < frames; frame++) {
      const spectral = this.spectralBlock[frame] * spectralGain;
      const transitionGain = this.transition === 'fall' ? 1 - (frame + 1) / frames : this.transition === 'rise' ? (frame + 1) / frames : 1;
      left[frame] = clamp(finite(this.kernel.outputLeft[frame]) * modalGain * transitionGain + spectral, -1, 1);
      right[frame] = clamp(finite(this.kernel.outputRight[frame]) * modalGain * transitionGain + spectral, -1, 1);
      peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
      square += left[frame] ** 2 + right[frame] ** 2;
    }
    this.totalFrames += frames;
    if (this.transition === 'fall') this.transition = 'apply';
    else if (this.transition === 'rise') this.transition = 'steady';
    const callbackElapsed = (now() - started) * 1000;
    this.blocks++; this.callbackMicros += callbackElapsed; this.kernelMicros += kernelElapsed;
    this.callbackMaxMicros = Math.max(this.callbackMaxMicros, callbackElapsed);
    if (callbackElapsed > frames / sampleRate * 1e6) this.callbackOverruns++;
    if (urgent || this.blocks >= 48) {
      for (let i = 0; i < 128; i++) {
        const index = Math.round(i * (this.modeCount - 1) / 127);
        this.visualEnergy[i] = this.kernel.energy[index]; this.visualState[i] = this.kernel.real[index];
      }
      this.post('telemetry', { backend: this.backend, peak, rms: Math.sqrt(square / Math.max(1, frames * 2)),
        modeCount: this.modeCount, audibleModes: this.audibleModes, renderedFrames: this.totalFrames,
        modalEnergy: this.visualEnergy, modalState: this.visualState,
        fftInput: this.spectrum.fftInputTelemetry, fftOutput: this.spectrum.fftOutputTelemetry,
        callbackMicros: this.callbackMicros / this.blocks, callbackMaxMicros: this.callbackMaxMicros,
        callbackOverruns: this.callbackOverruns, kernelMicros: this.kernelMicros / this.blocks,
        budgetMicros: frames / sampleRate * 1e6, timingResolution: globalThis.performance?.now ? 'high' : 'milliseconds' });
      this.blocks = 0; this.callbackMicros = 0; this.kernelMicros = 0; this.callbackMaxMicros = 0;
    }
    return true;
  }
}
registerProcessor('morphazoid-rust-resonator', RustResonatorProcessor);
