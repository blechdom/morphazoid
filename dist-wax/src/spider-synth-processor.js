import { SpiderSynthDsp } from './spider-synth-dsp.js?v=74d232932f0e';

class SpiderSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new SpiderSynthDsp(sampleRate);
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
        else if (data?.type === 'midi') this.dsp.midi(data.message, data.audioTime);
        else if (data?.type === 'midi-control') this.dsp.midiControl(data.groupId, data.axis, data.value, data.audioTime, data.scope);
        else if (data?.type === 'midi-reset') this.dsp.resetMidi(data.scope, data.audioTime);
        else if (data?.type === 'midi-state') this.dsp.restoreMidi(data.snapshot);
        else if (data?.type === 'world-command') this.dsp.worldCommand(data.command,data.audioTime);
        else if (data?.type === 'world-state') this.dsp.restoreWorld(data.snapshot,data.timeOffset);
        else if (data?.type === 'pluck' && (!Number.isFinite(data.audioTime) || currentTime - data.audioTime < .1)) this.dsp.pluck(data.pluck);
        else if (data?.type === 'atlas') this.dsp.setAtlas(data.samples, data.sampleRate);
        else if (data?.type === 'speak') this.dsp.speak(data.phones);
        else if (data?.type === 'stop-speech') this.dsp.stopSpeech();
        else if (data?.type === 'dispose') { this.disposed = true; this.dsp.stopSpeech(); this.dsp.resetMidi(); }
      } catch (error) { this.port.postMessage({ type: 'error', message: String(error.message || error) }); }
    };
  }
  process(inputs, outputs) {
    const [left, right = left] = outputs[0] ?? [];
    if (this.disposed || !left) return false;
    const telemetry = this.dsp.render(left, right, currentTime);
    this.framesSinceTelemetry += left.length;
    this.telemetryEnergy += telemetry.rms * telemetry.rms * left.length;
    this.telemetryPeak = Math.max(this.telemetryPeak, telemetry.peak);
    if (this.framesSinceTelemetry >= sampleRate / 10) {
      // Measure the whole reporting window: a 17 ms foot tap must not vanish
      // merely because the one block at the 100 ms boundary happened to be quiet.
      this.port.postMessage({ type: 'telemetry', ...telemetry, world:this.dsp.getWorldSnapshot(),
        rms: Math.sqrt(this.telemetryEnergy / this.framesSinceTelemetry),
        peak: this.telemetryPeak, audioTime: currentTime });
      this.framesSinceTelemetry = 0; this.telemetryEnergy = 0; this.telemetryPeak = 0;
    }
    return true;
  }
}
registerProcessor('spider-synth', SpiderSynthProcessor);
