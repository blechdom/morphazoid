import { MAX_MODES, BLOCK_SIZE, COEFFICIENT_KEYS, kernelViews } from './model.js';
import { RustFftResynth } from './fft-rust.js';
import { MAX_SPATIAL_CHANNELS, SPATIAL_DEFAULTS, SpatialRouter } from './spatial-model.js';
import { RustSignalPath } from './signal-rust.js';

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
    this.spectrum = new RustFftResynth(sampleRate);
    this.signal = new RustSignalPath(sampleRate); this.signalEnabled = false;
    this.sourceBlock = new Float32Array(BLOCK_SIZE); this.processedBlock = new Float32Array(BLOCK_SIZE);
    this.spectralBlock = new Float32Array(BLOCK_SIZE);
    this.spectralSpatialBlock = new Float32Array(BLOCK_SIZE * MAX_SPATIAL_CHANNELS);
    this.spatial = new SpatialRouter(sampleRate, MAX_MODES);
    this.spatialFrame = new Float32Array(MAX_SPATIAL_CHANNELS);
    this.spatialPeaks = new Float32Array(MAX_SPATIAL_CHANNELS); this.spatialRms = new Float32Array(MAX_SPATIAL_CHANNELS);
    this.resonatorInputMode = false; this.fftCurrentMix = 0;
    this.fftMixStep = 1 - Math.exp(-1 / (sampleRate * .012));
    this.visualEnergy = new Float32Array(128); this.visualState = new Float32Array(128);
    this.blocks = 0; this.callbackMicros = 0; this.kernelMicros = 0; this.callbackMaxMicros = 0;
    this.callbackOverruns = 0; this.totalFrames = 0;
    this.pendingConfiguration = null; this.transition = 'steady';
    this.performanceConfiguration = null; this.performanceFrames = 0;
    this.performanceRampFrames = Math.max(BLOCK_SIZE, Math.round(sampleRate * .02));
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
      kernel.exports.reset(); kernel.exports.signal_init(sampleRate); kernel.exports.fft_init(sampleRate); return kernel;
    };
    this.kernels.scalar = load(message.scalarBytes);
    if (!this.kernels.scalar) throw new Error('Rust scalar kernel is required.');
    try { this.kernels.simd = load(message.simdBytes); } catch { this.kernels.simd = null; }
    this.selectBackend(message.requestedBackend);
    this.configure(message.configuration);
    this.ready = true;
    this.post('ready', { backend: this.backend, laneWidth: this.kernel.exports.lane_width(), simdAvailable: Boolean(this.kernels.simd) });
  }
  validateConfiguration(configuration) {
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
  }
  configure(configuration) {
    this.validateConfiguration(configuration);
    this.performanceConfiguration = null; this.performanceFrames = 0;
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
    this.performanceConfiguration = null; this.performanceFrames = 0;
    for (const kernel of Object.values(this.kernels)) {
      if (!kernel) continue;
      if (configuration.modeCount < this.modeCount) for (const key of STATE_KEYS) kernel[key].fill(0, configuration.modeCount);
      for (const key of COEFFICIENT_KEYS) kernel[key].set(configuration[key]);
    }
    this.modeCount = configuration.modeCount; this.outputScale = configuration.outputScale;
    this.audibleModes = configuration.audibleModes;
    this.spectrum.configureResynthesis(configuration);
    if (this.signalEnabled) this.spectrum.primeSilence();
  }
  performance(configuration) {
    this.validateConfiguration(configuration);
    if (!this.ready) throw new Error('The resonator must be ready before a performance update.');
    const destinationCount = this.pendingConfiguration?.modeCount ?? this.modeCount;
    if (configuration.modeCount !== destinationCount) throw new Error('Performance updates must retain the target body size.');
    for (let index = 0; index < configuration.modeCount; index++) {
      const cosine = configuration.cosine[index], sine = configuration.sine[index];
      if (Math.abs(cosine * cosine + sine * sine - 1) > .001
        || configuration.decay[index] < 0 || configuration.decay[index] > 1) {
        throw new Error('Performance updates require stable modal rotations and decay.');
      }
    }
    // A preset/body rebuild is already fading. The latest complete controls
    // replace its queued target without adding another fade or stale replay.
    if (this.pendingConfiguration) { this.pendingConfiguration = configuration; return; }
    this.performanceConfiguration = configuration;
    this.performanceFrames = this.performanceRampFrames;
    this.audibleModes = configuration.audibleModes;
  }
  advancePerformance(frames) {
    const target = this.performanceConfiguration;
    if (!target) return;
    const amount = Math.min(1, frames / this.performanceFrames);
    const current = this.kernel, other = current === this.kernels.scalar ? this.kernels.simd : this.kernels.scalar;
    if (amount === 1) {
      // Finish on the exact authored Float32 coefficients; no asymptotic drift.
      for (let key = 0; key < COEFFICIENT_KEYS.length; key++) {
        current[COEFFICIENT_KEYS[key]].set(target[COEFFICIENT_KEYS[key]]);
        other?.[COEFFICIENT_KEYS[key]].set(target[COEFFICIENT_KEYS[key]]);
      }
      this.outputScale = target.outputScale;
      this.performanceConfiguration = null; this.performanceFrames = 0; return;
    }
    const cosine = current.cosine, sine = current.sine, decay = current.decay, strike = current.strike,
      gain = current.gain, left = current.panLeft, right = current.panRight;
    const nextCosine = target.cosine, nextSine = target.sine, nextDecay = target.decay, nextStrike = target.strike,
      nextGain = target.gain, nextLeft = target.panLeft, nextRight = target.panRight;
    for (let index = 0; index < this.modeCount; index++) {
      const c = cosine[index] + (nextCosine[index] - cosine[index]) * amount;
      const s = sine[index] + (nextSine[index] - sine[index]) * amount;
      // Interpolating a chord alone shrinks the rotation and damps every mode.
      // Normalize the pair so pitch movement preserves the authored lifetime.
      const reciprocal = 1 / Math.max(1e-12, Math.sqrt(c * c + s * s));
      cosine[index] = c * reciprocal; sine[index] = s * reciprocal;
      decay[index] += (nextDecay[index] - decay[index]) * amount;
      strike[index] += (nextStrike[index] - strike[index]) * amount;
      gain[index] += (nextGain[index] - gain[index]) * amount;
      left[index] += (nextLeft[index] - left[index]) * amount;
      right[index] += (nextRight[index] - right[index]) * amount;
    }
    // Native typed-array copies keep both backends ready without property
    // lookup or a second smoothing pass for every lane in the hot loop.
    if (other) for (let key = 0; key < COEFFICIENT_KEYS.length; key++) other[COEFFICIENT_KEYS[key]].set(current[COEFFICIENT_KEYS[key]]);
    this.outputScale += (target.outputScale - this.outputScale) * amount;
    this.performanceFrames = Math.max(0, this.performanceFrames - frames);
  }
  selectBackend(requested) {
    const backend = requested !== 'scalar' && this.kernels.simd ? 'simd' : 'scalar';
    const next = this.kernels[backend];
    if (!next) return;
    if (this.kernel && this.kernel !== next) {
      for (const key of STATE_KEYS) next[key].set(this.kernel[key]);
      // Switching SIMD/scalar preserves every excitation, filter, overlap-add
      // and room state. This bounded copy happens only on a backend message.
      for (const prefix of ['signal', 'fft']) {
        const from = this.kernel.exports, to = next.exports;
        new Uint8Array(to.memory.buffer, to[prefix + '_state_ptr'](), to[prefix + '_state_bytes']()).set(
          new Uint8Array(from.memory.buffer, from[prefix + '_state_ptr'](), from[prefix + '_state_bytes']()));
      }
    }
    this.signal.bind(next.exports); this.spectrum.bind(next.exports);
    this.sourceBlock = this.signal.source; this.processedBlock = this.signal.processed;
    this.spectralBlock = this.signal.spectral; this.spectralSpatialBlock = this.signal.spectralSpatial;
    this.kernel = next; this.backend = backend;
    this.post('backend', { backend, laneWidth: next.exports.lane_width(), simdAvailable: Boolean(this.kernels.simd) });
  }
  message(message) {
    if (!this.running) return;
    try {
      if (message.type === 'install') this.install(message);
      else if (message.type === 'configure') this.configure(message.configuration);
      else if (message.type === 'performance') this.performance(message.configuration);
      else if (message.type === 'spatial') this.spatial.configure(message.configuration);
      else if (message.type === 'signal') {
        this.signal.configure(message.configuration, !this.signalEnabled);
        this.signalEnabled = true; this.spectrum.primeSilence();
      } else if (message.type === 'excite' && this.ready) {
        this.signal.excitation.trigger(message);
      }
      else if (message.type === 'backend') this.selectBackend(message.backend);
      else if (message.type === 'trigger' && this.ready) {
        this.impulse = clamp(this.impulse + finite(message.strength), 0, 1.5);
        if (!this.inputActive) this.resonatorInputMode = false;
      }
      else if (message.type === 'mic') {
        this.inputActive = Boolean(message.active);
        if (this.inputActive) this.resonatorInputMode = true;
      } else if (message.type === 'reset') {
        if (this.pendingConfiguration) this.applyConfiguration(this.pendingConfiguration);
        else if (this.performanceConfiguration) this.applyConfiguration(this.performanceConfiguration);
        this.pendingConfiguration = null; this.transition = 'steady';
        for (const kernel of Object.values(this.kernels)) kernel?.exports.reset_resonator();
        this.spectrum.resetResynthesis(); this.impulse = 0; this.signal.reset();
        if (this.signalEnabled) this.spectrum.primeSilence();
        this.resonatorInputMode = this.inputActive; this.fftCurrentMix = this.inputActive ? this.spectrum.fftMix : 0;
        this.kernel?.exports.signal_legacy_mix(this.fftCurrentMix);
      } else if (message.type === 'dispose') {
        this.running = false; this.ready = false; this.impulse = 0; this.signal.reset();
        this.performanceConfiguration = null; this.performanceFrames = 0;
        this.kernels = {}; this.kernel = null; this.port.onmessage = null;
      }
    } catch (error) { this.post('error', { message: error?.message || 'Rust resonator failed.' }); }
  }
  process(inputs, outputs) {
    const output = outputs[0];
    const spatialOutput = outputs[1];
    for (const channel of spatialOutput || []) channel.fill(0);
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
    this.advancePerformance(frames);
    const input = inputs[0]?.[0];
    const spatialEnabled = this.spatial.settings.enabled;
    this.spatial.advance(frames);
    // Keep a mono analysis history warm for click-free stage changes, but do
    // not run sixteen inverse transforms while the FFT branch is disabled.
    const fftSpatial = this.signalEnabled && !this.signal.settings.resynthesisEnabled && this.signal.fftMix < 1e-6
      ? SPATIAL_DEFAULTS : this.spatial.settings;
    this.spectrum.configureSpatial(fftSpatial, this.spatial.phase);
    this.spectrum.beginResynthesisTransition();
    if (spatialEnabled) this.spatial.prepare(this.kernel, this.modeCount, frames);
    this.spectralSpatialBlock.fill(0); this.spatialPeaks.fill(0); this.spatialRms.fill(0);
    const renderFft = this.inputActive || this.spectrum.fftHistoryFill > 0;
    this.signal.prepare(input, frames, this.signalEnabled, this.inputActive, this.transition !== 'fall');
    this.spectralBlock.fill(0);
    if (renderFft) this.spectrum.processBlock(this.signal.fftInput, this.spectralBlock, this.spectralSpatialBlock, frames);
    const kernelStart = now();
    const soundingImpulse = this.transition === 'fall' ? 0 : this.impulse;
    try {
      const render = spatialEnabled ? this.kernel.exports.process_resonator_spatial : this.kernel.exports.process_resonator;
      render(frames, this.modeCount, soundingImpulse, this.outputScale);
    }
    catch (error) {
      this.ready = false; this.post('error', { message: error?.message || 'Rust audio processor stopped.' }); return true;
    }
    const kernelElapsed = (now() - kernelStart) * 1000;
    const urgent = soundingImpulse > 0;
    if (this.transition !== 'fall') this.impulse = 0;
    const targetMix = this.resonatorInputMode ? this.spectrum.fftMix : 0;
    this.signal.mixBlock(frames, this.signalEnabled, spatialEnabled, this.spatial.settings.speakerCount,
      this.transition === 'fall' ? -1 : this.transition === 'rise' ? 1 : 0, targetMix);
    // Native typed-array block copies are the only JavaScript audio routing.
    left.set(frames === BLOCK_SIZE ? this.signal.outputLeft : this.signal.outputLeft.subarray(0, frames));
    right.set(frames === BLOCK_SIZE ? this.signal.outputRight : this.signal.outputRight.subarray(0, frames));
    if (spatialEnabled) for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
      if (spatialOutput?.[channel]) spatialOutput[channel].set(frames === BLOCK_SIZE ? this.signal.outputChannels[channel] : this.signal.outputChannels[channel].subarray(0, frames));
    }
    this.spatialPeaks.set(this.signal.spatialPeaks); this.spatialRms.set(this.signal.spatialRms);
    this.fftCurrentMix = this.signal.stats[34];
    const peak = this.signal.stats[0], square = this.signal.stats[1];
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
      for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) this.spatialRms[channel] = Math.sqrt(this.spatialRms[channel]);
      this.post('telemetry', { performanceRemainingFrames: this.performanceFrames, signalEnabled: this.signalEnabled, signal: this.signalEnabled ? this.signal.settings : null, spatialEnabled, spatialPhase: this.spatial.phase, spatialSpeakerCount: this.spatial.settings.speakerCount,
        spatialPeaks: this.spatialPeaks, spatialRms: this.spatialRms, backend: this.backend, peak, rms: Math.sqrt(square / Math.max(1, frames * 2)),
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
