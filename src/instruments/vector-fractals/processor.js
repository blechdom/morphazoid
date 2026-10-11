import { VectorDSP } from './dsp.js';
import { clamp } from './model.js';
class VectorFractalProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dsp = new VectorDSP(sampleRate); this.count = 0; this.alive = true;
    const initial = options.processorOptions ?? {};
    this.dsp.setState(initial.state ?? {}); this.dsp.setBank(initial.bank);
    this.dsp.trace.rate = this.dsp.trace.targetRate;
    this.dsp.trace.travelerMix = this.dsp.trace.reader === 'traveler' ? 1 : 0;
    if (this.dsp.trace.travelerMix) {
      // Arm the requested reader at its reference pitch and selected voices;
      // startup must not glide through an unrelated XY/height/default voice.
      this.dsp.frequency = clamp(initial.state?.pitch, 25, 1200, 110);
      this.dsp.traceMix = 1; this.dsp.trace.voiceWeights.fill(0);
      for (let layer = 0; layer < 3; layer++) this.dsp.trace.voiceWeights[layer * 4 + this.dsp.trace.voiceTargets[layer]] = 1;
    }
    Object.assign(this.dsp.trace.params, this.dsp.trace.targets);
    this.dsp.setTraceBank(initial.traceBank); this.dsp.tracePhase = initial.traceTravel ?? initial.tracePhase ?? 0;
    this.dsp.trace.restoreTraveler(initial.travelerState);
    this.dsp.trace.shepardTravel = Number.isFinite(initial.shepardTravel) ? initial.shepardTravel
      : this.dsp.trace.travel * this.dsp.trace.targets.shepardCycles * this.dsp.trace.targets.shepardDirection;
    this.dsp.trace.shepardPosition = ((this.dsp.trace.shepardTravel % 1) + 1) % 1;
    this.dsp.level = initial.level ?? .35; this.dsp.playing = Boolean(initial.playing);
    this.dsp.voyage = initial.voyage ?? 0; this.dsp.scanPhase = initial.scanPhase ?? 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'state') this.dsp.setState(data.state);
      if (data.type === 'bank') this.dsp.setBank(data.bank);
      if (data.type === 'trace-bank') this.dsp.setTraceBank(data.bank);
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
        scanPhase: this.dsp.scanPhase, tracePhase: this.dsp.tracePhase, traceRate: this.dsp.traceRate,
        traceTravel: this.dsp.trace.travel, shepardTravel: this.dsp.trace.shepardTravel,
        travelerState: this.dsp.trace.snapshotTraveler(),
        drumTriggerCounts: Array.from(this.dsp.trace.drumTriggerCounts), recentDrumHits: this.dsp.trace.drainHits(),
        frequency: this.dsp.frequency, rotation: this.dsp.rotation });
    }
    return true;
  }
}
registerProcessor('vector-fractals', VectorFractalProcessor);
