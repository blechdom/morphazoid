export const WAV_HEADER_BYTES = 44;
export const BYTES_PER_FRAME = 6;
export const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
// RIFF's length excludes its first eight bytes; stereo 24-bit frames are six
// bytes. Keep both RIFF and the data chunk representable by unsigned 32 bits.
export const MAX_FILE_BYTES = WAV_HEADER_BYTES + Math.floor((0xffff_ffff - 36) / BYTES_PER_FRAME) * BYTES_PER_FRAME;

export function wavHeader({ sampleRate, frames }) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 768_000) {
    throw new RangeError("Invalid WAV sample rate.");
  }
  const dataBytes = frames * BYTES_PER_FRAME;
  if (!Number.isSafeInteger(frames) || frames < 0 || dataBytes > MAX_FILE_BYTES - WAV_HEADER_BYTES) {
    throw new RangeError("This take exceeds the WAV size limit.");
  }
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const tag = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_FRAME, true);
  view.setUint16(32, BYTES_PER_FRAME, true);
  view.setUint16(34, 24, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function limitBytes(value, maximum) {
  const requested = Number(value);
  return Number.isFinite(requested)
    ? Math.max(WAV_HEADER_BYTES + BYTES_PER_FRAME, Math.min(maximum, Math.floor(requested)))
    : maximum;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function disconnect(node) {
  try { node?.disconnect?.(); } catch { /* The private context may have closed. */ }
}

function message(error, fallback) {
  return error?.message || String(error || fallback);
}

/** Captures the final stereo mix on the instrument's own audio clock. */
export class OutputRecorder {
  constructor({ manager, runtime = globalThis, onchange, maxMemoryBytes, maxFileBytes, stopTimeoutMs = 1_000, writeTimeoutMs = 15_000 } = {}) {
    this.manager = manager;
    this.runtime = runtime;
    this.maxMemoryBytes = limitBytes(maxMemoryBytes, MAX_MEMORY_BYTES);
    this.maxFileBytes = limitBytes(maxFileBytes, MAX_FILE_BYTES);
    this.stopTimeoutMs = stopTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.state = "idle";
    this.take = null;
    this.destroyed = false;
    this.listeners = new Set();
    if (typeof onchange === "function") this.listeners.add(onchange);
  }

  getStatus() {
    const take = this.take;
    const sampleRate = take?.sampleRate || this.manager?.recordingSampleRate?.() || 48_000;
    const maxBytes = take?.maxBytes || this.maxMemoryBytes;
    const frames = take?.frames || 0;
    return Object.freeze({
      state: this.state,
      mode: take?.writable ? "file" : "memory",
      frames,
      sampleRate,
      seconds: frames / sampleRate,
      bytes: take ? WAV_HEADER_BYTES + frames * BYTES_PER_FRAME : 0,
      maxBytes,
      maxSeconds: Math.floor((maxBytes - WAV_HEADER_BYTES) / BYTES_PER_FRAME) / sampleRate,
      filename: take?.filename || "",
      reason: take?.reason || "",
      error: take?.error || "",
      blob: take?.blob || null,
      saved: take?.saved || false,
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => { this.listeners.delete(listener); };
  }

  publish() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try { listener(status); } catch { /* Observers cannot interrupt capture. */ }
    }
  }

  async start({ filename = "morphazoid-recording.wav", writable = null } = {}) {
    if (this.destroyed) throw new Error("This recorder has been closed.");
    if (this.state !== "idle" && !(this.state === "error" && !this.take?.blob && !this.take?.saved)) {
      throw new Error("Save or discard the current take before recording again.");
    }
    const take = {
      filename, writable, sampleRate: 48_000, frames: 0, persistedFrames: 0,
      maxBytes: writable ? this.maxFileBytes : this.maxMemoryBytes,
      chunks: [], writeChain: Promise.resolve(), writeError: null,
      reason: "", error: "", blob: null, saved: false,
      done: deferred(), cancelled: deferred(), finishing: false,
      context: null, node: null, silent: null, release: null, timer: null,
    };
    this.take = take;
    this.state = "starting";
    this.publish();
    if (take.finishing) return take.done.promise;
    try {
      if (this.manager?.canRecord?.() === false) throw new Error("Turn Audio on before recording.");
      if (!this.runtime.AudioWorkletNode || !this.manager?.tapInto) {
        throw new Error("This browser does not support output recording.");
      }
      // Cross-context MediaStream bridges can insert silent blocks and phase
      // discontinuities even at matching sample rates. Borrow the instrument's
      // running context and tap its mix directly, without resuming or owning it.
      const context = this.manager.recordingContext?.();
      if (!context || context.state !== "running") throw new Error("Turn Audio on before recording.");
      take.context = context;
      take.sampleRate = context.sampleRate;
      if (!context.audioWorklet?.addModule) throw new Error("Audio recording needs a secure browser with AudioWorklet support.");
      take.handleStateChange = () => {
        if (this.state === "recording" && context.state !== "running") {
          take.error = "Recording was interrupted. The captured part of the take is available.";
          void this.stop("interrupted");
        }
      };
      context.addEventListener?.("statechange", take.handleStateChange);
      const loaded = context.audioWorklet.addModule(new URL("./output-recorder-processor.js", import.meta.url));
      if (writable) {
        take.writeChain = this.fileOperation(take, () => writable.write(wavHeader({ sampleRate: take.sampleRate, frames: 0 }))).catch((error) => {
          take.writeError = error;
        });
      }
      const started = await Promise.race([
        Promise.all([loaded, take.writeChain]).then(() => true),
        take.cancelled.promise.then(() => false),
      ]);
      if (!started || take.finishing) return take.done.promise;
      if (take.writeError) throw take.writeError;
      if (context.state !== "running") throw new Error("Audio stopped before recording could start.");
      const maxFrames = Math.floor((take.maxBytes - WAV_HEADER_BYTES) / BYTES_PER_FRAME);
      const node = new this.runtime.AudioWorkletNode(context, "morphazoid-output-recorder", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: {
          maxFrames,
          chunkFrames: Math.max(16_384, Math.ceil(take.sampleRate / 4 / 128) * 128),
          credits: 8,
        },
      });
      take.node = node;
      node.port.onmessage = ({ data }) => {
        if (take.finishing || this.take !== take) return;
        if (data?.type === "chunk") this.acceptChunk(take, data);
        if (data?.type === "complete") {
          if (!take.reason || take.reason === "stopped") {
            take.reason = data.reason === "limit"
              ? (writable ? "file-limit" : "buffer-limit")
              : data.reason || "stopped";
          }
          if (data.reason === "backpressure") {
            take.error = "Recording stopped because the browser or disk could not keep up. The captured part of the take is available.";
          }
          void this.finishTake(take);
        }
      };
      node.onprocessorerror = () => {
        take.error = "The audio recorder stopped unexpectedly. The captured part of the take is available.";
        void this.stop("processor-error");
      };
      node.port.start?.();
      const silent = context.createGain();
      take.silent = silent;
      silent.gain.value = 0;
      take.release = this.manager.tapInto(context, node, {
        onerror: (error) => {
          take.error = message(error, "An output could not be recorded.");
          void this.stop("interrupted");
        },
      });
      if (take.finishing || this.state === "stopping") return take.done.promise;
      node.connect(silent);
      silent.connect(context.destination);
      node.port.postMessage({ type: "start" });
      this.state = "recording";
      this.publish();
      return this.getStatus();
    } catch (error) {
      if (take.finishing) return take.done.promise;
      take.error = message(error, "Recording could not start.");
      take.reason = "start-error";
      await this.finishTake(take);
      throw error;
    }
  }

  acceptChunk(take, { buffer, frames }) {
    if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(frames) || frames <= 0
      || buffer.byteLength !== frames * BYTES_PER_FRAME
      || WAV_HEADER_BYTES + (take.frames + frames) * BYTES_PER_FRAME > take.maxBytes) {
      take.error = "The recorder returned an invalid audio chunk.";
      void this.stop("processor-error");
      return;
    }
    const credit = () => {
      if (!take.finishing) take.node?.port.postMessage({ type: "credit" });
    };
    take.frames += frames;
    if (!take.writable) {
      take.chunks.push(buffer);
      take.persistedFrames += frames;
      credit();
    } else {
      // Credits return only after disk writes settle. The worklet bounds this
      // promise queue even if a write stalls while the UI is still responsive.
      take.writeChain = take.writeChain.then(async () => {
        if (take.writeError) return;
        await this.fileOperation(take, () => take.writable.write(buffer));
        take.persistedFrames += frames;
        credit();
      }).catch((error) => {
        take.writeError = error;
        take.error = message(error, "The recording file could not be written.");
        void this.stop("write-error");
      });
    }
    this.publish();
  }

  async fileOperation(take, operation) {
    if (take.writeTimedOut) throw new Error("Writing the recording file timed out.");
    const schedule = (this.runtime.setTimeout ?? globalThis.setTimeout).bind(this.runtime);
    const cancel = (this.runtime.clearTimeout ?? globalThis.clearTimeout).bind(this.runtime);
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = schedule(() => {
        take.writeTimedOut = true;
        // Some streams never settle a pending write. Abort without waiting for
        // that same stream so the controls can recover and report the failure.
        try { Promise.resolve(take.writable.abort?.()).catch(() => {}); } catch { /* Already errored. */ }
        reject(new Error("Writing the recording file timed out."));
      }, this.writeTimeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(operation), timeout]); }
    finally { cancel(timer); }
  }

  stop(reason = "stopped") {
    const take = this.take;
    if (!take || this.state === "ready" || this.state === "error" || this.state === "idle") {
      return Promise.resolve(this.getStatus());
    }
    if (take.finishing || this.state === "stopping") {
      if (reason !== "stopped") {
        take.reason = reason;
        this.publish();
      }
      return take.done.promise;
    }
    take.reason = reason;
    this.state = "stopping";
    this.publish();
    take.cancelled.resolve();
    if (!take.node) {
      void this.finishTake(take);
      return take.done.promise;
    }
    const schedule = (this.runtime.setTimeout ?? globalThis.setTimeout).bind(this.runtime);
    take.timer = schedule(() => {
      take.timer = null;
      if (!take.error) {
        take.error = "Recording was interrupted. The captured part of the take is available.";
        take.reason = "interrupted";
      }
      void this.finishTake(take);
    }, this.stopTimeoutMs);
    try { take.node.port.postMessage({ type: "stop" }); } catch { void this.finishTake(take); }
    return take.done.promise;
  }

  async finishTake(take) {
    if (take.finishing) return take.done.promise;
    take.finishing = true;
    take.cancelled.resolve();
    this.state = "stopping";
    this.publish();
    if (take.timer !== null) (this.runtime.clearTimeout ?? globalThis.clearTimeout).call(this.runtime, take.timer);
    take.timer = null;
    if (take.node) {
      take.node.port.onmessage = null;
      take.node.onprocessorerror = null;
      take.node.port.close?.();
    }
    try { take.release?.(); } catch { /* Never disturb the audible connections. */ }
    take.release = null;
    disconnect(take.node);
    disconnect(take.silent);
    const context = take.context;
    context?.removeEventListener?.("statechange", take.handleStateChange);
    // This is the instrument's context. Release only our tap, worklet and silent
    // output; recording must never close, suspend or resume audible playback.
    await take.writeChain;
    take.frames = take.persistedFrames;
    try {
      const header = wavHeader({ sampleRate: take.sampleRate, frames: take.frames });
      if (take.writable && !take.frames && take.reason === "start-error") {
        if (take.writeTimedOut) throw take.writeError;
        await this.fileOperation(take, () => take.writable.abort?.());
      } else if (take.writable) {
        // A failed write may have appended only part of a chunk. Finalize just
        // the fully written prefix, if the browser still allows the stream to
        // be committed. An errored disk stream cannot promise recoverability.
        await this.fileOperation(take, () => take.writable.write({ type: "write", position: 0, data: header }));
        await this.fileOperation(take, () => take.writable.truncate?.(WAV_HEADER_BYTES + take.frames * BYTES_PER_FRAME));
        await this.fileOperation(take, () => take.writable.close());
        take.saved = true;
      } else if (take.frames > 0 || !take.error) {
        const BlobConstructor = this.runtime.Blob ?? globalThis.Blob;
        take.blob = new BlobConstructor([header, ...take.chunks], { type: "audio/wav" });
      }
      this.state = take.blob || take.saved ? "ready" : "error";
    } catch (error) {
      take.error = `The take could not be finalized: ${message(error, "unknown error")}`;
      take.reason = take.writable ? "write-error" : "processor-error";
      this.state = "error";
      try { Promise.resolve(take.writable?.abort?.()).catch(() => {}); } catch { /* Release the file lock where possible. */ }
    }
    take.chunks = [];
    take.node = null;
    take.silent = null;
    take.context = null;
    const status = this.getStatus();
    this.publish();
    take.done.resolve(status);
    return status;
  }

  discard() {
    if (["starting", "recording", "stopping"].includes(this.state)) {
      throw new Error("Stop recording before discarding a take.");
    }
    this.take = null;
    this.state = "idle";
    this.publish();
    return this.getStatus();
  }

  async destroy() {
    this.destroyed = true;
    await this.stop("interrupted");
    this.listeners.clear();
  }
}
