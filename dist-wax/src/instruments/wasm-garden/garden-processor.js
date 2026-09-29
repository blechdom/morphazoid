import { createGardenDSP, TINE_COUNT } from './dsp.js';
import { unitParameter, fillPitchProbabilities, choosePitch, bankSpectralEmphasis } from './garden-model.js';

class GardenProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const setup = options.processorOptions || {};
    this.engine = createGardenDSP({ module: setup.module, sampleRate, settings: setup.settings, prepared: setup.prepared });
    this.backend = this.engine.hasWasm ? 'wasm' : 'js';
    this.playing = false; this.nextContact = currentFrame; this.sequence = 0;
    this.rate = 8; this.exciter = 'mallet'; this.pattern = 'sweep'; this.x = 0.42; this.y = 0.7;
    this.pitchFocus = 0.5; this.chanceWidth = 0.5; this.seed = 827391;
    this.probabilities = new Float64Array(TINE_COUNT);
    this.setExcitation(setup);
    this.blocks = 0; this.renderedFrames = 0; this.ticks = 0; this.lastTine = 13;
    this.peak = 0; this.sum = 0; this.samples = 0;
    this.energies = new Float32Array(TINE_COUNT);
    this.dead = false; this.pending = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'configure') this.pending = data;
      if (data.type === 'strike') {
        this.applyPending();
        this.engine.strike(data.x, data.y, data.velocity, data.exciter);
        this.lastTine = Math.min(TINE_COUNT - 1, Math.floor(data.x * TINE_COUNT));
      }
      if (data.type === 'excitation') this.setExcitation(data);
      if (data.type === 'dispose') this.dead = true;
    };
    this.port.postMessage({ type: 'ready', backend: this.backend, hasWasm: this.engine.hasWasm });
  }
  setExcitation(data) {
    if (data.playing && !this.playing) this.nextContact = currentFrame;
    this.playing = Boolean(data.playing);
    const rate = Number(data.rate);
    this.rate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2048, rate)) : 8;
    this.nextContact = Math.min(this.nextContact, currentFrame + sampleRate / this.rate);
    this.exciter = ['impulse', 'mallet', 'pick', 'scraper'].includes(data.exciter) ? data.exciter : 'mallet';
    this.pattern = ['selected', 'weighted', 'random'].includes(data.pattern) ? data.pattern : 'sweep';
    this.pitchFocus = unitParameter(data.pitchFocus, 0.5);
    this.chanceWidth = unitParameter(data.chanceWidth, 0.5);
    fillPitchProbabilities(this.probabilities, this.pitchFocus, this.chanceWidth);
    if (Number.isFinite(data.x)) this.x = Math.max(0, Math.min(0.9999, data.x));
    if (Number.isFinite(data.y)) this.y = Math.max(this.engine.settings.model === 'bank' ? 0 : 0.08, Math.min(this.engine.settings.model === 'bank' ? 1 : 0.98, data.y));
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  contact() {
    const step = this.sequence++ % (2 * (TINE_COUNT - 1));
    const bank = this.engine.settings.model === 'bank';
    let x, y, velocity;
    if (this.pattern === 'random') {
      // Original random excitation: preserve draw order, ranges and strength.
      x = 0.05 + this.random() * 0.9;
      y = 0.2 + this.random() * 0.7;
      velocity = 0.55;
    } else if (bank && this.pattern === 'weighted') {
      x = 0.05 + this.random() * 0.9;
      y = bankSpectralEmphasis(choosePitch(this.probabilities, this.random()) / (TINE_COUNT - 1));
      velocity = 0.55;
    } else {
      const tine = this.pattern === 'weighted' ? choosePitch(this.probabilities, this.random()) : this.pattern === 'selected' ? Math.floor(this.x * TINE_COUNT) : step < TINE_COUNT ? step : 2 * (TINE_COUNT - 1) - step;
      x = this.pattern === 'selected' && bank ? this.x : (tine + 0.5) / TINE_COUNT;
      y = this.y;
      velocity = bank ? 0.55 : this.exciter === 'scraper' ? 0.35 + 0.2 * Math.sin(this.sequence * 2.399963) ** 2 : 0.6;
    }
    this.engine.strike(x, y, velocity, this.exciter);
    this.lastX = x; this.lastY = y;
    this.lastTine = Math.min(TINE_COUNT - 1, Math.floor(x * TINE_COUNT)); this.ticks++;
  }
  applyPending() {
    if (this.pending) { this.engine.configure(this.pending.settings, this.pending.prepared); this.pending = null; }
  }
  process(_inputs, outputs) {
    if (this.dead) return false;
    const channels = outputs[0];
    if (!channels?.length) return true;
    this.applyPending();
    const frames = channels[0].length;
    let offset = 0;
    const originalCadence = this.engine.settings.model === 'bank' && this.pattern === 'random' && this.rate <= 12;
    const interval = originalCadence ? Math.ceil(Math.round(sampleRate / this.rate) / frames) * frames : sampleRate / this.rate;
    // Original low-rate random excitation retains its block-aligned cadence.
    if (originalCadence) this.nextContact = Math.ceil(this.nextContact / frames) * frames;
    // Split at sample offsets so high contact rates do not drift with block size.
    // Old deadlines are skipped instead of accumulating a burst of stale hits.
    if (this.playing && Math.ceil(this.nextContact) < currentFrame) this.nextContact = currentFrame;
    while (offset < frames) {
      const now = currentFrame + offset;
      if (this.playing && this.nextContact <= now) {
        this.contact(); this.nextContact += interval;
      }
      const count = this.playing ? Math.min(frames - offset, Math.max(1, Math.ceil(this.nextContact - now))) : frames - offset;
      const signal = this.engine.process(count, this.backend);
      for (let i = 0; i < count; i++) {
        const left = signal.left[i], right = signal.right[i];
        channels[0][offset + i] = left;
        if (channels[1]) channels[1][offset + i] = right;
        this.peak = Math.max(this.peak, Math.abs(left), Math.abs(right));
        this.sum += left * left + right * right;
      }
      offset += count;
    }
    this.samples += frames * 2; this.renderedFrames += frames;
    if (++this.blocks % 24 === 0) {
      this.engine.getEnergies(this.energies);
      this.port.postMessage({ type: 'meter', backend: this.backend, peak: this.peak,
        rms: Math.sqrt(this.sum / this.samples), time: currentFrame / sampleRate, rate: this.rate,
        ticks: this.ticks, renderedFrames: this.renderedFrames, lastTine: this.lastTine, lastX: this.lastX, lastY: this.lastY, model: this.engine.settings.model, pitchSpread: this.engine.settings.pitchSpread, energies: this.energies });
      this.peak = this.sum = this.samples = 0;
    }
    return true;
  }
}
registerProcessor('morphazoid-wasm-garden', GardenProcessor);
