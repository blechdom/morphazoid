export const MAX_RECORDING_SECONDS = 15;
export const RECORDER_CHUNK_FRAMES = 4096;

const PROCESSOR_URL = new URL("./surround-field-recorder-processor.js", import.meta.url);
const textEncoder = new TextEncoder();

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeMonoPcm16Wave(chunks, sampleRate) {
  const safeChunks = Array.from(chunks ?? [], (chunk) => (
    chunk instanceof Int16Array ? chunk : Int16Array.from(chunk ?? [])
  ));
  const frames = safeChunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of safeChunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return bytes;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date) {
  const value = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

export function createStoredZip(files, modifiedAt = new Date()) {
  const { time, date } = zipDateTime(modifiedAt);
  const records = Array.from(files ?? [], ({ name, data }) => {
    const nameBytes = textEncoder.encode(String(name));
    const bytes = typeof data === "string"
      ? textEncoder.encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
    return { nameBytes, bytes, crc: crc32(bytes), offset: 0 };
  });
  const localSize = records.reduce((total, record) => total + 30 + record.nameBytes.length + record.bytes.length, 0);
  const centralSize = records.reduce((total, record) => total + 46 + record.nameBytes.length, 0);
  const archive = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(archive.buffer);
  let offset = 0;

  for (const record of records) {
    record.offset = offset;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, record.crc, true);
    view.setUint32(offset + 18, record.bytes.length, true);
    view.setUint32(offset + 22, record.bytes.length, true);
    view.setUint16(offset + 26, record.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    archive.set(record.nameBytes, offset + 30);
    archive.set(record.bytes, offset + 30 + record.nameBytes.length);
    offset += 30 + record.nameBytes.length + record.bytes.length;
  }

  const centralOffset = offset;
  for (const record of records) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, record.crc, true);
    view.setUint32(offset + 20, record.bytes.length, true);
    view.setUint32(offset + 24, record.bytes.length, true);
    view.setUint16(offset + 28, record.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, record.offset, true);
    archive.set(record.nameBytes, offset + 46);
    offset += 46 + record.nameBytes.length;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, records.length, true);
  view.setUint16(offset + 10, records.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return archive;
}

function safeStemLabel(value) {
  return String(value || "channel")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "channel";
}

function gainToDbfs(value) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

export function buildStemArchive(capture, speakers, layoutName, createdAt = new Date()) {
  const orderedSpeakers = [...speakers].sort((left, right) => left.channel - right.channel);
  const duration = capture.frames / capture.sampleRate;
  const lines = [
    "Morphazoid Surround Field channel capture",
    `Layout: ${layoutName}`,
    `Sample rate: ${capture.sampleRate} Hz`,
    `Duration: ${duration.toFixed(3)} s`,
    "Tap point: virtual post-spatial channel buses, before browser/OS/device processing",
    "",
    "Channel map:",
  ];
  const files = orderedSpeakers.map((speaker) => {
    const channelIndex = speaker.channel - 1;
    const peak = capture.peaks[channelIndex] ?? 0;
    const peakLabel = peak > 0 ? `${gainToDbfs(peak).toFixed(2)} dBFS peak` : "silence";
    lines.push(`${String(speaker.channel).padStart(2, "0")}  ${speaker.label}  ${peakLabel}`);
    return {
      name: `${String(speaker.channel).padStart(2, "0")}-${safeStemLabel(speaker.label)}.wav`,
      data: encodeMonoPcm16Wave(capture.channelChunks[channelIndex] ?? [], capture.sampleRate),
    };
  });
  lines.push("", `Clipped samples before PCM limiting: ${capture.clippedSamples}`);
  files.push({ name: "channel-map.txt", data: `${lines.join("\n")}\n` });

  const stamp = createdAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const layoutSlug = safeStemLabel(layoutName).toLowerCase();
  return Object.freeze({
    bytes: createStoredZip(files, createdAt),
    filename: `surround-field-${layoutSlug}-${stamp}.zip`,
    channelCount: orderedSpeakers.length,
    duration,
    clippedSamples: capture.clippedSamples,
    channelMap: `${lines.join("\n")}\n`,
  });
}

export class SurroundFieldRecorder {
  constructor(context) {
    this.context = context;
    this.modulePromise = null;
    this.startPromise = null;
    this.startToken = 0;
    this.node = null;
    this.silentSink = null;
    this.inputNode = null;
    this.channelChunks = [];
    this.channelCount = 0;
    this.stopPromise = null;
    this.stopResolve = null;
    this.stopReject = null;
    this.stopTimeout = 0;
    this.completedCapture = null;
    this.onfinish = null;
    this.onerror = null;
  }

  get active() {
    return Boolean(this.node);
  }

  async loadModule() {
    if (!this.context.audioWorklet) throw new Error("AudioWorklet recording is unavailable in this browser.");
    if (!this.modulePromise) {
      this.modulePromise = this.context.audioWorklet.addModule(PROCESSOR_URL.href).catch((error) => {
        this.modulePromise = null;
        throw error;
      });
    }
    return this.modulePromise;
  }

  start(inputNode, channelCount) {
    if (this.active || this.startPromise) {
      return Promise.reject(new Error("A channel recording is already starting or running."));
    }
    const token = ++this.startToken;
    const startPromise = this.startCapture(inputNode, channelCount, token);
    this.startPromise = startPromise;
    return startPromise.finally(() => {
      if (this.startPromise === startPromise) this.startPromise = null;
    });
  }

  async startCapture(inputNode, channelCount, token) {
    await this.loadModule();
    if (token !== this.startToken) throw new DOMException("Channel recording start canceled.", "AbortError");
    this.channelCount = Math.max(1, Math.min(32, Math.floor(Number(channelCount) || 1)));
    this.channelChunks = Array.from({ length: this.channelCount }, () => []);
    this.completedCapture = null;
    this.inputNode = inputNode;
    try {
      const WorkletNode = globalThis.AudioWorkletNode;
      if (!WorkletNode) throw new Error("AudioWorklet recording is unavailable in this browser.");
      this.node = new WorkletNode(this.context, "surround-field-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: this.channelCount,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
        processorOptions: {
          channelCount: this.channelCount,
          chunkFrames: RECORDER_CHUNK_FRAMES,
          maxFrames: Math.floor(this.context.sampleRate * MAX_RECORDING_SECONDS),
        },
      });
      this.silentSink = this.context.createGain();
      this.silentSink.gain.value = 0;
      this.node.port.onmessage = ({ data }) => this.handleMessage(data);
      this.node.onprocessorerror = () => this.fail(new Error("The channel recorder stopped unexpectedly."));
      inputNode.connect(this.node);
      this.node.connect(this.silentSink).connect(this.context.destination);
      this.node.port.postMessage({ type: "start" });
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  handleMessage(message) {
    if (message?.type === "chunk") {
      message.buffers.forEach((buffer, channel) => {
        this.channelChunks[channel]?.push(new Int16Array(buffer));
      });
      return;
    }
    if (message?.type !== "stopped") return;

    const capture = Object.freeze({
      channelChunks: this.channelChunks.map((chunks) => Object.freeze([...chunks])),
      sampleRate: this.context.sampleRate,
      frames: Number(message.frames) || 0,
      peaks: Object.freeze(Array.from(message.peaks ?? [], Number)),
      clippedSamples: Number(message.clippedSamples) || 0,
      reason: message.reason ?? "stopped",
    });
    const resolve = this.stopResolve;
    this.channelChunks = [];
    this.completedCapture = resolve || this.onfinish ? null : capture;
    this.cleanup();
    if (resolve) resolve(capture);
    else this.onfinish?.(capture);
  }

  stop() {
    if (this.completedCapture) {
      const capture = this.completedCapture;
      this.completedCapture = null;
      return Promise.resolve(capture);
    }
    if (!this.node) return Promise.resolve(null);
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
      this.stopTimeout = globalThis.setTimeout(() => {
        this.fail(new Error("Timed out while finalizing the channel recording."));
      }, 3000);
      this.node.port.postMessage({ type: "stop" });
    });
    return this.stopPromise;
  }

  fail(error) {
    const reject = this.stopReject;
    this.cleanup();
    if (reject) reject(error);
    else this.onerror?.(error);
  }

  cancel() {
    const reject = this.stopReject;
    this.startToken += 1;
    this.completedCapture = null;
    this.cleanup();
    if (reject) reject(new DOMException("Channel recording canceled.", "AbortError"));
  }

  cleanup() {
    if (this.stopTimeout) globalThis.clearTimeout(this.stopTimeout);
    try { this.inputNode?.disconnect(this.node); } catch { /* The tap may already be detached. */ }
    try { this.node?.disconnect(); } catch { /* The worklet may already be detached. */ }
    try { this.silentSink?.disconnect(); } catch { /* The silent sink may already be detached. */ }
    try { this.node?.port.close(); } catch { /* The message port may already be closed. */ }
    this.node = null;
    this.silentSink = null;
    this.inputNode = null;
    this.channelChunks = [];
    this.channelCount = 0;
    this.stopPromise = null;
    this.stopResolve = null;
    this.stopReject = null;
    this.stopTimeout = 0;
  }
}
