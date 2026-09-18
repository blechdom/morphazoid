import { CORES } from "./cores.js";
import { clamp } from "./common.js";

class StartingInstrumentProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const id = options.processorOptions?.id;
    if (!CORES[id]) throw new Error("Unknown starting instrument");
    this.core = new CORES[id](sampleRate);
    this.gain = 0; this.target = 0; this.monitor = 0; this.frames = 0; this.alive = true;
    this.gainSmoothing = 1 - Math.exp(-1 / (sampleRate * 0.009));
    this.port.onmessage = ({ data: m }) => {
      if (m.type === "dispose") { this.alive = false; this.core.command({ type: "cancel-record" }); return; }
      if (m.type === "gain") this.target = clamp(m.value, 0, 0.72);
      else if (m.type === "monitor") this.monitor = clamp(m.value, 0, 0.5);
      else if (m.type === "restore") { this.core.set(m.snapshot.params ?? {}); this.core.restore(m.snapshot); }
      else this.core.command(m);
      this.publish();
    };
    this.port.postMessage({ type: "ready" });
  }
  publish() { this.port.postMessage({ type: "state", state: this.core.snapshot(), at: currentTime }); }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output?.[0]) return true;
    const input = inputs[0]?.[0];
    for (let i = 0; i < output[0].length; i++) {
      const incoming = clamp(input?.[i] ?? 0, -1, 1, 0);
      const stereo = this.core.tick(incoming);
      this.gain += (this.target - this.gain) * this.gainSmoothing;
      output[0][i] = Math.tanh(stereo[0] + incoming * this.monitor) * this.gain;
      if (output[1]) output[1][i] = Math.tanh(stereo[1] + incoming * this.monitor) * this.gain;
    }
    this.frames += output[0].length;
    if (this.frames >= sampleRate / 20) {
      this.frames = 0;
      if (this.core.recording?.count >= this.core.recording?.samples.length) this.core.command({ type: "finish-record" });
      this.publish();
    }
    return true;
  }
}
registerProcessor("morphazoid-starting-instrument", StartingInstrumentProcessor);
