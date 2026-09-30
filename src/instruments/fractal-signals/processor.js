import { FractalDSP } from './dsp.js';

class FractalSignalsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = options.processorOptions ?? {};
    this.engine = new FractalDSP(sampleRate, settings.state, settings.structure);
    this.engine.setPhase(settings.phase ?? 0, settings.transport);
    if (settings.motionBank) this.engine.setMotionBank(settings.motionBank);
    this.engine.setLevel(settings.level ?? .55);
    this.engine.setPlaying(settings.playing ?? false);
    this.transportRevision = settings.transportRevision ?? 0;
    this.telemetrySamples = 0;
    this.disposed = false;
    this.port.onmessage = ({ data }) => {
      if (this.disposed || !data) return;
      if (['playing', 'phase', 'state', 'motionBank'].includes(data.type) && Number.isFinite(data.transportRevision)) this.transportRevision = data.transportRevision;
      if (data.type === 'state') this.engine.setState(data.state, data.structure, data.options);
      else if (data.type === 'motionBank') this.engine.setMotionBank(data.bank);
      else if (data.type === 'playing') this.engine.setPlaying(data.value);
      else if (data.type === 'microphone') this.engine.setMicrophone(data.value);
      else if (data.type === 'level') this.engine.setLevel(data.value);
      else if (data.type === 'phase') this.engine.setPhase(data.value, data.transport);
      else if (data.type === 'source') this.engine.setSource(data.samples, data.sampleRate, data.profile);
      else if (data.type === 'dispose') this.disposed = true;
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (this.disposed || !output || output.length < 2) return !this.disposed;
    const telemetry = this.engine.process(output[0], output[1], inputs[0]?.[0]);
    this.telemetrySamples += output[0].length;
    if (this.telemetrySamples >= sampleRate / 25) {
      this.telemetrySamples %= Math.round(sampleRate / 25);
      this.port.postMessage({ type: 'telemetry', ...telemetry, transportRevision: this.transportRevision });
    }
    return true;
  }
}

registerProcessor('fractal-signals', FractalSignalsProcessor);
