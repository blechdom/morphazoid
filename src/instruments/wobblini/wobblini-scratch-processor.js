import { WobbliniScratchSampler } from "./wobblini-scratch-model.js";

class WobbliniScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.sampler = new WobbliniScratchSampler(sampleRate); this.alive = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === "begin") this.sampler.begin(data);
      if (data.type === "move") this.sampler.move(data);
      if (data.type === "end") this.sampler.end(data);
      if (data.type === "release") this.sampler.release();
      if (data.type === "clear") this.sampler.clear();
      if (data.type === "dispose") { this.sampler.clear(); this.alive = false; }
    };
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    this.sampler.process(outputs); return true;
  }
}
registerProcessor("morphazoid-wobblini-scratch", WobbliniScratchProcessor);
