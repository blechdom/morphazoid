import { SpartialEngine } from "./spartial.js";

class SpartialProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.engine = new SpartialEngine({
      sampleRate,
      settings: options.processorOptions?.settings,
      phase: options.processorOptions?.phase,
    });
    this.reportFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return;
      if (data.type === "settings") this.engine.setSettings(data.settings);
      else if (data.type === "phase") this.engine.setPhase(data.phase);
      else if (data.type === "noteOn") this.engine.noteOn(data.id, data.note, data.velocity ?? 1);
      else if (data.type === "retrigger") this.engine.retrigger(data.id, data.note, data.velocity ?? 1);
      else if (data.type === "noteOff") this.engine.noteOff(data.id);
      else if (data.type === "panic") this.engine.panic();
    };
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    this.engine.render(channels);
    this.reportFrames += channels[0].length;
    if (this.reportFrames >= sampleRate / 15) {
      this.reportFrames %= sampleRate / 15;
      this.port.postMessage({ type: "snapshot", ...this.engine.snapshot() });
    }
    return true;
  }
}

registerProcessor("spartial-synth", SpartialProcessor);
