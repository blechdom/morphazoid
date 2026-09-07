const MAX_CAPTURE_SECONDS = 2;
const MIN_CAPTURE_FRAMES = 128;

export class MorphazoidFfmpegCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.disposed = false;
    this.sequence = 0;
    this.chunkFrames = Math.round(sampleRate);
    this.overlapFrames = Math.round(sampleRate * 0.02);
    this.buffer = new Float32Array(this.chunkFrames);
    this.writeIndex = 0;

    this.port.onmessage = ({ data = {} }) => {
      if (data.type === "start") {
        this.active = true;
        this.configure(data);
      } else if (data.type === "configure") {
        this.configure(data);
      } else if (data.type === "stop") {
        this.active = false;
        this.resetBuffer();
      } else if (data.type === "dispose") {
        this.active = false;
        this.disposed = true;
        this.resetBuffer();
        this.port.close?.();
      }
    };
  }

  configure({ chunkFrames, overlapFrames }) {
    const maximumFrames = Math.round(sampleRate * MAX_CAPTURE_SECONDS);
    const nextChunkFrames = Math.min(
      maximumFrames,
      Math.max(MIN_CAPTURE_FRAMES, Math.trunc(Number(chunkFrames) || this.chunkFrames)),
    );
    const nextOverlapFrames = Math.min(
      Math.floor(nextChunkFrames / 4),
      Math.max(0, Math.trunc(Number(overlapFrames) || 0)),
    );
    if (nextChunkFrames !== this.chunkFrames) {
      this.chunkFrames = nextChunkFrames;
      this.buffer = new Float32Array(this.chunkFrames);
      this.writeIndex = 0;
    }
    this.overlapFrames = nextOverlapFrames;
  }

  resetBuffer() {
    this.buffer = new Float32Array(this.chunkFrames);
    this.writeIndex = 0;
  }

  emitChunk() {
    const completed = this.buffer;

    const next = new Float32Array(this.chunkFrames);
    const overlap = Math.min(this.overlapFrames, completed.length);
    if (overlap > 0) next.set(completed.subarray(completed.length - overlap), 0);
    this.buffer = next;
    this.writeIndex = overlap;

    this.port.postMessage({
      type: "chunk",
      sequence: this.sequence,
      sampleRate,
      frames: completed.length,
      samples: completed,
    }, [completed.buffer]);
    this.sequence += 1;
  }

  process(inputs, outputs) {
    for (const output of outputs ?? []) {
      for (const channel of output ?? []) channel.fill(0);
    }
    if (this.disposed) return false;
    if (!this.active) return true;

    const channels = inputs?.[0] ?? [];
    const frames = channels[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      let contributors = 0;
      for (const channel of channels) {
        const sample = Number(channel?.[frame]);
        if (!Number.isFinite(sample)) continue;
        sum += sample;
        contributors += 1;
      }
      this.buffer[this.writeIndex] = contributors ? sum / contributors : 0;
      this.writeIndex += 1;
      if (this.writeIndex >= this.chunkFrames) this.emitChunk();
    }
    return true;
  }
}

registerProcessor("morphazoid-ffmpeg-wasm-capture", MorphazoidFfmpegCaptureProcessor);
