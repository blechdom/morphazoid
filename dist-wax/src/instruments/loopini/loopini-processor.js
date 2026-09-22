import { Loopini, clamp } from "./loopini.js";

class LoopiniProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.core = new Loopini(sampleRate); this.gain = this.target = 0; this.frames = 0; this.alive = true;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.01));
    this.port.onmessage = ({ data: m }) => {
      if (m.type === "gain") this.target = clamp(m.value, 0, 0.8, 0.48);
      if (m.type === "play") this.core.setPlaying(m.value);
      if (m.type === "record") this.core.record(m.id, m.mode);
      if (m.type === "speed") this.core.setSpeed(m.value);
      if (m.type === "finish") this.core.finish();
      if (m.type === "cancel") this.core.cancel();
      if (m.type === "toggle") this.core.toggle(m.id);
      if (m.type === "remove") this.core.remove(m.id);
      if (m.type === "undo") this.core.undo();
      if (m.type === "reset") this.core.reset();
      if (m.type === "demo") this.core.loadDemo();
      if (m.type === "dispose") { this.core.cancel(); this.alive = false; }
      this.publish();
    };
    this.publish();
  }
  publish() { this.port.postMessage({ type: "state", state: this.core.snapshot() }); }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output?.[0]) return true;
    const input = inputs[0]?.[0];
    for (let i = 0; i < output[0].length; i++) {
      this.gain += (this.target - this.gain) * this.smoothing;
      const value = this.core.tick(input?.[i] ?? 0) * this.gain;
      for (const channel of output) channel[i] = value;
    }
    this.frames += output[0].length;
    if (this.frames >= sampleRate / 25) { this.frames = 0; this.publish(); }
    return true;
  }
}
registerProcessor("morphazoid-loopini", LoopiniProcessor);
