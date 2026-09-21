import { KineticStringDSP } from "./yoyodyne-dsp.js";
class YoyodyneProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.dsp = new KineticStringDSP(sampleRate); this.queue = [];
    this.lastTime = -10; this.latest = { energy: 0, held: 1 }; this.alive = true;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "dispose") { this.alive = false; this.queue.length = 0; }
      if (data?.type === "mute") {
        this.queue.length = 0; this.latest = { ...this.latest, energy: 0, pluck: 0, held: 1 };
        this.dsp.setState(this.latest);
      }
      if (data?.type === "frames" && Array.isArray(data.frames)) {
        for (const frame of data.frames.slice(0, 64)) {
          if (Number.isFinite(frame.time) && frame.time >= currentTime - 0.03 && frame.time <= currentTime + 0.25) this.queue.push(frame);
        }
        this.queue.sort((a, b) => a.time - b.time);
        if (this.queue.length > 128) this.queue.splice(0, this.queue.length - 128);
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out?.[0]) return this.alive;
    // Sample-addressed control frames, independent of display callbacks.
    const left = out[0], right = out[1] ?? out[0];
    for (let offset = 0; offset < left.length; offset += 16) {
      const now = currentTime + offset / sampleRate;
      while (this.queue.length && this.queue[0].time <= now) {
        const frame = this.queue.shift(); this.latest = frame.state; this.lastTime = frame.time;
        this.dsp.setState(this.latest);
      }
      if (now - this.lastTime > 0.2) this.dsp.setState({ ...this.latest, energy: 0, pluck: 0, held: 1 });
      this.dsp.process(left, right, offset, Math.min(left.length, offset + 16));
    }
    return this.alive;
  }
}
registerProcessor("yoyodyne-string", YoyodyneProcessor);
