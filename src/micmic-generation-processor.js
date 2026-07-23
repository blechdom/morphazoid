import { MicmicGenerationDSP } from "./micmic-generation-dsp.js";

class MicmicGenerationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.renderer = new MicmicGenerationDSP({
      sampleRate,
      historySeconds: options.processorOptions?.historySeconds,
      maxVoices: options.processorOptions?.maxVoices,
    });
    this.port.onmessage = ({ data }) => {
      if (data?.type === "voices") this.renderer.setVoices(data.voices);
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output[0]) return true;
    return this.renderer.process(input[0], input[1], output[0], output[1] ?? output[0]);
  }
}

registerProcessor("morphazoid-micmic-generations", MicmicGenerationProcessor);
