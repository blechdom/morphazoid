class SurroundFieldRecorderProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions ?? {};
    this.channelCount = Math.max(1, Math.min(32, Math.floor(Number(processorOptions.channelCount) || 1)));
    this.chunkFrames = Math.max(1024, Math.floor(Number(processorOptions.chunkFrames) || 4096));
    this.maxFrames = Math.max(1, Math.floor(Number(processorOptions.maxFrames) || sampleRate * 15));
    this.recording = false;
    this.totalFrames = 0;
    this.writeOffset = 0;
    this.clippedSamples = 0;
    this.peaks = new Float32Array(this.channelCount);
    this.buffers = [];
    this.resetBuffers();

    this.port.onmessage = ({ data }) => {
      if (data?.type === "start") this.startCapture();
      if (data?.type === "stop") this.finishCapture("stopped");
    };
  }

  resetBuffers() {
    this.buffers = Array.from(
      { length: this.channelCount },
      () => new Int16Array(this.chunkFrames),
    );
    this.writeOffset = 0;
  }

  startCapture() {
    this.totalFrames = 0;
    this.clippedSamples = 0;
    this.peaks.fill(0);
    this.resetBuffers();
    this.recording = true;
  }

  flushChunk() {
    if (this.writeOffset === 0) return;
    const chunks = this.buffers.map((buffer) => (
      this.writeOffset === buffer.length ? buffer : buffer.slice(0, this.writeOffset)
    ));
    const buffers = chunks.map((chunk) => chunk.buffer);
    this.port.postMessage({ type: "chunk", frames: this.writeOffset, buffers }, buffers);
    this.resetBuffers();
  }

  finishCapture(reason) {
    if (!this.recording) return;
    this.recording = false;
    this.flushChunk();
    this.port.postMessage({
      type: "stopped",
      reason,
      frames: this.totalFrames,
      peaks: Array.from(this.peaks),
      clippedSamples: this.clippedSamples,
    });
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (!this.recording) return true;

    const input = inputs[0] ?? [];
    const frameCount = input[0]?.length ?? 128;
    const framesToWrite = Math.min(frameCount, this.maxFrames - this.totalFrames);

    for (let frame = 0; frame < framesToWrite; frame += 1) {
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        const sample = Number(input[channel]?.[frame]) || 0;
        const absolute = Math.abs(sample);
        if (absolute > this.peaks[channel]) this.peaks[channel] = absolute;
        if (absolute > 1) this.clippedSamples += 1;
        const limited = Math.max(-1, Math.min(1, sample));
        this.buffers[channel][this.writeOffset] = Math.round(
          limited < 0 ? limited * 0x8000 : limited * 0x7fff,
        );
      }
      this.writeOffset += 1;
      this.totalFrames += 1;
      if (this.writeOffset === this.chunkFrames) this.flushChunk();
    }

    if (this.totalFrames >= this.maxFrames) this.finishCapture("limit");
    return true;
  }
}

registerProcessor("surround-field-recorder", SurroundFieldRecorderProcessor);
