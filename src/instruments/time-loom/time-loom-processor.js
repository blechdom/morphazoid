import { TimeLoomDSP } from "./time-loom-dsp.js";

class TimeLoomProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new TimeLoomDSP(sampleRate); this.frames = 0; this.alive = true;
    this.port.onmessage = ({ data: message }) => {
      if (!message || !this.alive) return;
      if (message.type === "state") this.core.setState(message.state);
      if (message.type === "source") this.core.setSource(message.index, message.samples, message.sampleRate);
      if (message.type === "play") this.core.setPlaying(message.value);
      if (message.type === "arm") this.core.setArmed(message.value);
      if (message.type === "volume") this.core.setVolume(message.value);
      if (message.type === "seek") this.core.seek(message.index, message.position);
      if (message.type === "dispose") { this.core.setArmed(false); this.alive = false; }
      this.publish();
    };
  }
  publish() { this.port.postMessage({ type: "state", state: this.core.snapshot() }); }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output?.[0]) return true;
    this.core.process(output[0], output[1]);
    for (let channel = 2; channel < output.length; channel++) output[channel].set(output[0]);
    this.frames += output[0].length;
    if (this.frames >= sampleRate / 30) { this.frames = 0; this.publish(); }
    return true;
  }
}

registerProcessor("morphazoid-time-loom", TimeLoomProcessor);
