class MorphazoidMicLoopCaptureProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const requested = Number(options.processorOptions?.sampleCount);
    this.sampleCount = Math.max(128, Math.min(
      Math.round(sampleRate * 10),
      Number.isFinite(requested) ? Math.round(requested) : Math.round(sampleRate * 3),
    ));
    this.samples = new Float32Array(this.sampleCount);
    this.writeIndex = 0;
    this.lastProgressBlock = -1;
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }

    const input = inputs[0]?.[0];
    if (input?.length) {
      const writable = Math.min(input.length, this.sampleCount - this.writeIndex);
      this.samples.set(input.subarray(0, writable), this.writeIndex);
      this.writeIndex += writable;
    }

    const progressBlock = Math.floor((this.writeIndex / this.sampleCount) * 20);
    if (progressBlock !== this.lastProgressBlock) {
      this.lastProgressBlock = progressBlock;
      this.port.postMessage({
        type: "progress",
        captured: this.writeIndex,
        total: this.sampleCount,
      });
    }

    if (this.writeIndex < this.sampleCount) return true;
    const buffer = this.samples.buffer;
    this.port.postMessage({
      type: "complete",
      sampleRate,
      sampleCount: this.sampleCount,
      buffer,
    }, [buffer]);
    return false;
  }
}

registerProcessor("morphazoid-mic-loop-capture", MorphazoidMicLoopCaptureProcessor);
