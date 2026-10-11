// PCM conversion and the capture limit run on the audio thread. A stalled UI or
// slow disk can hold only a fixed number of transferred chunks, then capture
// stops at the last continuous prefix without affecting the instrument graph.
class MorphazoidOutputRecorderProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const config = options.processorOptions ?? {};
    this.channelCount = config.channelCount === undefined ? 2 : config.channelCount;
    if (!Number.isInteger(this.channelCount) || this.channelCount < 1 || this.channelCount > 32) {
      throw new RangeError("Recorder channel count must be an integer from 1 to 32.");
    }
    this.bytesPerFrame = this.channelCount * 3;
    this.chunkFrames = Math.max(128, Math.min(65_536, Math.floor(config.chunkFrames || 16_384)));
    const headerBytes = this.channelCount > 2 ? 68 : 44;
    let maximumFrames = Math.floor((0xffff_ffff - headerBytes + 8) / this.bytesPerFrame);
    const maximumDataBytes = maximumFrames * this.bytesPerFrame;
    if (headerBytes - 8 + maximumDataBytes + maximumDataBytes % 2 > 0xffff_ffff) maximumFrames -= 1;
    this.maxFrames = Number.isFinite(config.maxFrames)
      ? Math.max(0, Math.min(maximumFrames, Math.floor(config.maxFrames))) : 0;
    this.maxCredits = Math.max(1, Math.min(32, Math.floor(config.credits || 8)));
    this.credits = this.maxCredits;
    this.frames = 0;
    this.filled = 0;
    this.bytes = null;
    this.finished = false;
    this.started = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "start" && !this.finished) this.started = true;
      if (data?.type === "credit") this.credits = Math.min(this.maxCredits, this.credits + 1);
      if (data?.type === "stop") this.finish("stopped");
    };
  }

  flush() {
    if (!this.filled) return;
    const buffer = this.filled === this.chunkFrames
      ? this.bytes.buffer
      : this.bytes.buffer.slice(0, this.filled * this.bytesPerFrame);
    this.credits -= 1;
    this.port.postMessage({ type: "chunk", buffer, frames: this.filled }, [buffer]);
    this.bytes = null;
    this.filled = 0;
  }

  finish(reason) {
    if (this.finished) return;
    this.flush();
    this.finished = true;
    this.port.postMessage({ type: "complete", frames: this.frames, reason });
  }

  writeSample(offset, value) {
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    const integer = Math.round(sample * (sample < 0 ? 8_388_608 : 8_388_607));
    this.bytes[offset] = integer & 255;
    this.bytes[offset + 1] = (integer >> 8) & 255;
    this.bytes[offset + 2] = (integer >> 16) & 255;
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (this.finished) return false;
    // The node can be pulled as soon as its silent output is connected. Wait
    // for the main thread to finish attaching the complete output tap first.
    if (!this.started) return true;
    const input = inputs[0] ?? [];
    // An input disappearing is recorded as silence, keeping time sample based.
    const length = outputs[0]?.[0]?.length || input[0]?.length || 128;
    for (let index = 0; index < length; index += 1) {
      if (this.frames >= this.maxFrames) {
        this.finish("limit");
        return false;
      }
      if (!this.bytes) {
        if (this.credits === 0) {
          this.finish("backpressure");
          return false;
        }
        this.bytes = new Uint8Array(this.chunkFrames * this.bytesPerFrame);
      }
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        // Preserve the shared stereo recorder's mono duplication. Discrete
        // multichannel buses keep missing channels silent instead.
        const fallback = this.channelCount === 2 && channel === 1 ? input[0]?.[index] ?? 0 : 0;
        this.writeSample(this.filled * this.bytesPerFrame + channel * 3, input[channel]?.[index] ?? fallback);
      }
      this.frames += 1;
      this.filled += 1;
      if (this.filled === this.chunkFrames) this.flush();
    }
    if (this.frames >= this.maxFrames) {
      this.finish("limit");
      return false;
    }
    return true;
  }
}

registerProcessor("morphazoid-output-recorder", MorphazoidOutputRecorderProcessor);
