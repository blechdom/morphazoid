import { HandDSP } from "./hand-dsp.js";
import { clampHand } from "./hand-model.js";

class GesticulatingHandProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.dsp = new HandDSP(sampleRate); this.alive = true; this.telemetryAt = 0;
    this.port.onmessage = ({ data }) => {
      if (!data || !this.alive) return;
      if (data.type === "config") this.dsp.setConfig(data.config);
      if (data.type === "transport") this.dsp.setTransport(data.transport, clampHand(data.audioTime, 0, currentTime, currentTime));
      if (data.type === "enabled") this.dsp.setEnabled(data.enabled);
      if (data.type === "sound") this.dsp.setSoundPlaying(data.playing);
      if (data.type === "held") this.dsp.setHeldFingers(data.mask);
      if (data.type === "audition") {
        // Expired gestures are not replayed when the main thread catches up.
        const at = clampHand(data.audioTime, 0, currentTime, currentTime);
        const duration = clampHand(data.seconds, .015, 2, .18);
        if (at + duration > currentTime) this.dsp.auditionFinger(data.index, duration, at);
      }
      if (data.type === "panic") { this.dsp.setSoundPlaying(false); this.dsp.setHeldFingers(0); this.dsp.reset(); }
      if (data.type === "dispose") { this.alive = false; this.dsp.reset(); }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return this.alive;
    if (!this.alive) { for (const channel of output) channel.fill(0); return false; }
    this.dsp.process(output[0], output[1] ?? output[0], currentTime);
    if (currentTime >= this.telemetryAt) {
      this.telemetryAt = currentTime + .08;
      this.port.postMessage({ type: "telemetry", audioTime: currentTime,
        motionTime: this.dsp.getMotionTime(currentTime), rms: this.dsp.rms, peak: this.dsp.peak,
        levels: Array.from(this.dsp.voiceLevels) });
    }
    return true;
  }
}
registerProcessor("gesticulating-hand", GesticulatingHandProcessor);
