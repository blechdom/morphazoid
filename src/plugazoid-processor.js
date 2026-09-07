const PROCESSOR_NAME = "morphazoid-plugazoid-port";
const PARAMETER_SMOOTHING = 0.0045;

function parameterValue(parameter, index) {
  if (!parameter?.length) return 0;
  return parameter.length === 1 ? parameter[0] : parameter[index];
}

function finiteSample(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-0.98, Math.min(0.98, value));
}

class PlugazoidPortProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "driveDb",
        defaultValue: 8,
        minValue: 0,
        maxValue: 24,
        automationRate: "k-rate",
      },
      {
        name: "toneHz",
        defaultValue: 4_200,
        minValue: 180,
        maxValue: 14_000,
        automationRate: "k-rate",
      },
      {
        name: "mix",
        defaultValue: 0.72,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "bypass",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this.channels = [];
    this.activeMix = 1;
    this.port.onmessage = ({ data }) => {
      if (data?.type !== "reset") return;
      this.channels.length = 0;
      this.activeMix = data.bypassed ? 0 : 1;
    };
    this.port.postMessage({
      type: "ready",
      processor: PROCESSOR_NAME,
      backend: "AudioWorklet JS",
      wasmSlot: true,
    });
  }

  channelState(index) {
    if (!this.channels[index]) {
      this.channels[index] = { lowpass: 0, previousInput: 0, dc: 0 };
    }
    return this.channels[index];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    const driveDb = parameterValue(parameters.driveDb, 0);
    const drive = 10 ** (driveDb / 20);
    const makeup = 1 / Math.sqrt(Math.max(1, drive));
    const toneHz = Math.max(
      180,
      Math.min(sampleRate * 0.45, parameterValue(parameters.toneHz, 0)),
    );
    const lowpassPole = Math.exp(-2 * Math.PI * toneHz / sampleRate);
    const wet = Math.max(0, Math.min(1, parameterValue(parameters.mix, 0)));
    const activeTarget = parameterValue(parameters.bypass, 0) >= 0.5 ? 0 : 1;

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      const destination = output[channelIndex];
      const source = input[channelIndex] ?? input[0];
      const channel = this.channelState(channelIndex);
      for (let index = 0; index < destination.length; index += 1) {
        this.activeMix += (activeTarget - this.activeMix) * PARAMETER_SMOOTHING;
        const dry = Number.isFinite(source?.[index]) ? source[index] : 0;
        const dcBlocked = dry - channel.previousInput + 0.995 * channel.dc;
        channel.previousInput = dry;
        channel.dc = Number.isFinite(dcBlocked) ? dcBlocked : 0;

        const saturated = Math.tanh(channel.dc * drive) * makeup;
        channel.lowpass = (1 - lowpassPole) * saturated + lowpassPole * channel.lowpass;
        if (!Number.isFinite(channel.lowpass)) channel.lowpass = 0;
        const processed = dry + (channel.lowpass - dry) * wet;
        destination[index] = finiteSample(dry + (processed - dry) * this.activeMix);
      }
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PlugazoidPortProcessor);
