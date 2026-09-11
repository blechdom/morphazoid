import { RoachSynthDsp } from './roach-synth-dsp.js?v=365ba8cf3adb';

class RoachSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new RoachSynthDsp(sampleRate);
    this.disposed = false;
    this.framesSinceTelemetry = 0; this.telemetryEnergy = 0; this.telemetryPeak = 0;
    this.port.onmessage = ({ data }) => {
      try {
        if (data?.type === 'state') {
          const state = { ...data.state };
          if (state.time != null && state.playing && Number.isFinite(data.audioTime)) {
            state.time += Math.max(0, currentTime - data.audioTime);
          }
          this.dsp.update(state);
        } else if (data?.type === 'interact') this.dsp.interact(data.interaction);
        else if (data?.type === 'sample-bank') this.dsp.setSampleBank(data.samples, { transferred: true });
        else if (data?.type === 'atlas') this.dsp.setAtlas(data.samples, data.sampleRate);
        else if (data?.type === 'speak') this.dsp.speak(data.phones);
        else if (data?.type === 'stop-speech') this.dsp.stopSpeech();
        else if (data?.type === 'dispose') { this.disposed = true; this.dsp.stopSpeech(); }
      } catch (error) { this.port.postMessage({ type: 'error', message: String(error.message || error) }); }
    };
  }
  process(inputs, outputs) {
    const [left, right = left] = outputs[0] ?? [];
    if (this.disposed || !left) return false;
    const telemetry = this.dsp.render(left, right);
    this.framesSinceTelemetry += left.length;
    this.telemetryEnergy += telemetry.rms * telemetry.rms * left.length;
    this.telemetryPeak = Math.max(this.telemetryPeak, telemetry.peak);
    if (this.framesSinceTelemetry >= sampleRate / 10) {
      // Measure the whole reporting window: a 17 ms foot tap must not vanish
      // merely because the one block at the 100 ms boundary happened to be quiet.
      this.port.postMessage({ type: 'telemetry', ...telemetry,
        rms: Math.sqrt(this.telemetryEnergy / this.framesSinceTelemetry),
        peak: this.telemetryPeak, audioTime: currentTime });
      this.framesSinceTelemetry = 0; this.telemetryEnergy = 0; this.telemetryPeak = 0;
    }
    return true;
  }
}
registerProcessor('roach-synth', RoachSynthProcessor);
