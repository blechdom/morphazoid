import { BifurcatorEngine } from './model.js';
import { CycleMonitor } from './cycle-monitor.js';

const TRACE_POINTS = 768;
class BifurcatorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new BifurcatorEngine(sampleRate);
    this.cycles = new CycleMonitor();
    this.frames = 0; this.revision = 0; this.alive = true;
    this.trace = new Float64Array(TRACE_POINTS * 4);
    this.traceCount = 0; this.traceCursor = 0; this.traceSkipped = false;
    this.wave = new Float32Array(256); this.waveCursor = 0;
    this.waveStride = Math.max(1, Math.round(sampleRate * .04 / this.wave.length));
    this.totalSamples = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'params') {
        const previousModel = this.engine.params.model;
        const previousPlaying = this.engine.params.playing;
        const previousSonification = this.engine.params.sonification;
        this.engine.setParams(data.params);
        if (this.engine.params.model !== previousModel) { this.clearTrace(); this.cycles.reset(); }
        if (this.engine.params.sonification !== previousSonification) this.cycles.reset();
        if (this.engine.params.playing !== previousPlaying) this.cycles.discardPartial();
      }
      if (data.type === 'seek') { this.engine.importState(data.state); this.clearTrace(); this.cycles.reset(); }
      if (data.type === 'reset') { this.engine.reset(); this.clearTrace(); this.cycles.reset(); }
      if (data.type === 'nudge') this.engine.perturb(data.amount ?? .4);
      if (data.type === 'sweep') { if (data.start) this.engine.startSweep(); else this.engine.stopSweep(); }
      if (data.type === 'dispose') this.alive = false;
      if (Number.isFinite(data.revision)) this.revision = data.revision;
    };
  }
  clearTrace() { this.traceCount = this.traceCursor = 0; this.traceSkipped = false; }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const channels = outputs[0];
    if (!channels?.length) return true;
    const left = channels[0], right = channels[1] ?? left;
    const stride = Math.max(1, Math.min(32, Math.floor(sampleRate / (this.engine.params.frequency * this.engine.params.speed * 16))));
    for (let i = 0; i < left.length; i++) {
      const value = this.engine.sample();
      left[i] = channels.length > 1 ? this.engine.left : value;
      if (channels.length > 1) right[i] = this.engine.right;
      if (this.engine.params.playing) this.cycles.push(left[i], this.engine.phase);
      this.totalSamples++;
      if (this.totalSamples % this.waveStride === 0) {
        this.wave[this.waveCursor] = left[i]; this.waveCursor = (this.waveCursor + 1) % this.wave.length;
      }
      if (this.engine.params.playing && this.totalSamples % stride === 0) {
        this.engine.writeTrace(this.trace, this.traceCursor * 4);
        this.traceCursor = (this.traceCursor + 1) % TRACE_POINTS;
        if (this.traceCount < TRACE_POINTS) this.traceCount++; else this.traceSkipped = true;
      }
    }
    this.frames += left.length;
    if (this.frames >= sampleRate / 30) {
      this.frames = 0;
      const trail = [];
      const start = (this.traceCursor - this.traceCount + TRACE_POINTS) % TRACE_POINTS;
      for (let i = 0; i < this.traceCount; i++) {
        const at = ((start + i) % TRACE_POINTS) * 4;
        trail.push({ p: [this.trace[at], this.trace[at + 1], this.trace[at + 2]], n: this.trace[at + 3], break: i === 0 && this.traceSkipped });
      }
      const wave = Array.from({ length: this.wave.length }, (_, i) => this.wave[(this.waveCursor + i) % this.wave.length]);
      this.port.postMessage({ type: 'clock', revision: this.revision, snapshot: this.engine.snapshot(), state: this.engine.exportState(), trail, wave, cycles: this.cycles.snapshot() });
      this.clearTrace();
    }
    return true;
  }
}
registerProcessor('bifurcator', BifurcatorProcessor);
