class MorphazoidGraphPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: "semitones",
      defaultValue: 0,
      minValue: -24,
      maxValue: 24,
      automationRate: "k-rate",
    }];
  }

  constructor() {
    super();
    this.buffer = new Float32Array(16_384);
    this.writeIndex = 0;
    this.phase = 0;
    this.windowSamples = 1_024;
  }

  read(delaySamples) {
    const size = this.buffer.length;
    let position = this.writeIndex - delaySamples;
    while (position < 0) position += size;
    position %= size;
    const before = Math.floor(position);
    const after = (before + 1) % size;
    const mix = position - before;
    return this.buffer[before] + (this.buffer[after] - this.buffer[before]) * mix;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    const semitones = parameters.semitones[0] ?? 0;
    const ratio = Math.min(4, Math.max(0.25, 2 ** (semitones / 12)));
    const phaseStep = Math.abs(1 - ratio) / this.windowSamples;
    const size = this.buffer.length;

    for (let index = 0; index < output.length; index += 1) {
      const sample = input?.[index] ?? 0;
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % size;

      if (Math.abs(semitones) < 0.01) {
        output[index] = sample;
        continue;
      }

      const firstPhase = this.phase;
      const secondPhase = (this.phase + 0.5) % 1;
      const firstDelay = (ratio > 1 ? 1 - firstPhase : firstPhase) * this.windowSamples + 2;
      const secondDelay = (ratio > 1 ? 1 - secondPhase : secondPhase) * this.windowSamples + 2;
      const firstWindow = Math.sin(Math.PI * firstPhase) ** 2;
      const secondWindow = Math.sin(Math.PI * secondPhase) ** 2;
      output[index] = this.read(firstDelay) * firstWindow
        + this.read(secondDelay) * secondWindow;
      this.phase = (this.phase + phaseStep) % 1;
    }
    return true;
  }
}

registerProcessor("morphazoid-graph-pitch", MorphazoidGraphPitchProcessor);
