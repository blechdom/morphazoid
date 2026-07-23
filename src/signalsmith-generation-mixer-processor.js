import { SignalsmithGenerationMixerDSP } from "./signalsmith-generation-mixer-dsp.js";

class SignalsmithGenerationMixerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.renderer = new SignalsmithGenerationMixerDSP({
      sampleRate,
      historySeconds: options.processorOptions?.historySeconds,
      maxInputs: options.processorOptions?.maxInputs,
      maxVoices: options.processorOptions?.maxVoices,
    });
    this.port.onmessage = ({ data }) => {
      if (data?.type === "voices") this.renderer.setVoices(data.voices);
    };
  }

  process(inputs, outputs) {
    const output = outputs[0] ?? [];
    if (!output[0]) return true;
    const monoInputs = inputs.map((input) => input[0]);
    return this.renderer.process(monoInputs, output[0], output[1] ?? output[0]);
  }
}

registerProcessor(
  "morphazoid-signalsmith-generation-mixer",
  SignalsmithGenerationMixerProcessor,
);
