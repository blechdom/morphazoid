import { VectorDSP } from './dsp.js';
class VectorFractalProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dsp = new VectorDSP(sampleRate); this.count = 0; this.alive = true;
    const initial = options.processorOptions ?? {};
    this.dsp.setState(initial.state ?? {}); this.dsp.setBank(initial.bank);
    this.dsp.level = initial.level ?? .35; this.dsp.playing = Boolean(initial.playing);
    this.dsp.voyage = initial.voyage ?? 0; this.dsp.scanPhase = initial.scanPhase ?? 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'state') this.dsp.setState(data.state);
      if (data.type === 'bank') this.dsp.setBank(data.bank);
      if (data.type === 'playing') this.dsp.playing = Boolean(data.value);
      if (data.type === 'level') this.dsp.level = data.value;
      if (data.type === 'reset') this.dsp.resetMotion();
      if (data.type === 'dispose') this.alive = false;
    };
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const [left, right] = outputs[0];
    this.dsp.process(left, right);
    this.count += left.length;
    if (this.count >= 2048) {
      this.count = 0;
      this.port.postMessage({ time: currentTime + left.length / sampleRate, voyage: this.dsp.voyage,
        scanPhase: this.dsp.scanPhase, frequency: this.dsp.frequency, rotation: this.dsp.rotation });
    }
    return true;
  }
}
registerProcessor('vector-fractals', VectorFractalProcessor);
