import { MAX_MODES, BLOCK_SIZE, COEFFICIENT_KEYS, kernelViews } from './model.js';
import { FftResynth } from './fft-resynth.js';
import { MAX_SPATIAL_CHANNELS, SPATIAL_DEFAULTS, SpatialRouter } from './spatial-model.js';
import { SignalPath } from './signal-path.js';

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
    this.signal = new SignalPath(sampleRate); this.signalEnabled = false;
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
    if (this.kernel && this.kernel !== next) for (const key of STATE_KEYS) next[key].set(this.kernel[key]);
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
    for (let frame = 0; frame < BLOCK_SIZE; frame++) {
      const external = frame < frames && this.inputActive ? finite(input?.[frame]) : 0;
      const excitation = this.signalEnabled && frame < frames && this.transition !== 'fall' ? this.signal.excitation.nextSample() : 0;
      const raw = this.signalEnabled ? clamp(external + excitation, -2, 2) : external;
      const processed = this.signalEnabled && frame < frames ? this.signal.processSource(raw) : raw;
      this.sourceBlock[frame] = raw; this.processedBlock[frame] = processed;
      this.kernel.input[frame] = processed * .34;
      this.spectralBlock[frame] = renderFft && frame < frames ? this.spectrum.processResynthesisSample(processed) : 0;
      if (spatialEnabled && renderFft && frame < frames) for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
        this.spectralSpatialBlock[channel * BLOCK_SIZE + frame] = this.spectrum.spatialSample[channel];
      }
    }
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
    let peak = 0, square = 0;
    for (let frame = 0; frame < frames; frame++) {
      this.fftCurrentMix += (targetMix - this.fftCurrentMix) * this.fftMixStep;
      const modalGain = Math.cos(this.fftCurrentMix * Math.PI * .5);
      const spectralGain = Math.sin(this.fftCurrentMix * Math.PI * .5) * .5;
      const spectral = this.spectralBlock[frame] * spectralGain;
      const transitionGain = this.transition === 'fall' ? 1 - (frame + 1) / frames : this.transition === 'rise' ? (frame + 1) / frames : 1;
      if (this.signalEnabled) {
        this.signal.advanceMix();
        const raw = this.sourceBlock[frame], processed = this.processedBlock[frame], fft = this.spectralBlock[frame] * .5;
        const a = this.signal.mix(0, raw, processed, finite(this.kernel.outputLeft[frame]) * transitionGain, fft);
        const b = this.signal.mix(1, raw, processed, finite(this.kernel.outputRight[frame]) * transitionGain, fft);
        const scale = 1 / Math.max(1, Math.abs(a) / .95, Math.abs(b) / .95);
        left[frame] = a * scale; right[frame] = b * scale;
      } else {
        left[frame] = clamp(finite(this.kernel.outputLeft[frame]) * modalGain * transitionGain + spectral, -1, 1);
        right[frame] = clamp(finite(this.kernel.outputRight[frame]) * modalGain * transitionGain + spectral, -1, 1);
      }
      if (this.signalEnabled && !spatialEnabled) {
        // Hidden buses keep aging instead of replaying stale room tails when
        // surround is enabled again. No input is injected into inactive buses.
        for (let channel = 2; channel < MAX_SPATIAL_CHANNELS + 2; channel++) this.signal.room.process(channel, 0);
      }
      peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
      square += left[frame] ** 2 + right[frame] ** 2;
      if (spatialEnabled) {
        let spatialPeak = 0, total = 0;
        for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
          const index = channel * BLOCK_SIZE + frame;
          let value = finite(this.kernel.spatialOutput[index]) * modalGain * transitionGain
            + this.spectralSpatialBlock[index] * spectralGain;
          if (this.signalEnabled) {
            // A mono dry source is localized at the stationary origin; modal
            // modes and FFT bins retain their independently authored positions.
            const direct = channel === 0 ? 1 : 0;
            const active = channel < this.spatial.settings.speakerCount;
            value = this.signal.mix(channel + 2,
              this.sourceBlock[frame] * direct, this.processedBlock[frame] * direct,
              active ? finite(this.kernel.spatialOutput[index]) * transitionGain : 0, active ? this.spectralSpatialBlock[index] * .5 : 0,
              // A small diffuse send uses the actual pre-room composite, not
              // unprocessed input. Independent lengths decorrelate its returns.
              active ? (this.signal.composite[0] + this.signal.composite[1]) * .2 / Math.sqrt(this.spatial.settings.speakerCount) : 0);
            if (!active) value = 0;
          }
          this.spatialFrame[channel] = value;
          spatialPeak = Math.max(spatialPeak, Math.abs(value)); total += Math.abs(value);
        }
        // Shared gain preserves relative speaker levels; the same absolute-sum
        // bound as SPARTIAL keeps its0.7 stereo preview below full scale.
        const scale = 1 / Math.max(1, spatialPeak / .95, total / (.95 * Math.SQRT2));
        for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
          const value = this.spatialFrame[channel] * scale;
          if (spatialOutput?.[channel]) spatialOutput[channel][frame] = value;
          this.spatialPeaks[channel] = Math.max(this.spatialPeaks[channel], Math.abs(value));
          this.spatialRms[channel] += value * value / frames;
        }
      }
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
