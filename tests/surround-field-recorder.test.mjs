import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  SurroundFieldRecorder,
  buildStemArchive,
  createStoredZip,
  crc32,
  encodeMonoPcm16Wave,
} from "../src/surround-field-recorder.js";

const decoder = new TextDecoder();
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const processorSource = await readFile(
  path.join(repositoryRoot, "src/surround-field-recorder-processor.js"),
  "utf8",
);

function ascii(bytes, offset, length) {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

function parseWave(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataLength = view.getUint32(40, true);
  const samples = [];
  for (let offset = 44; offset < 44 + dataLength; offset += 2) {
    samples.push(view.getInt16(offset, true));
  }
  return {
    riff: ascii(bytes, 0, 4),
    riffLength: view.getUint32(4, true),
    wave: ascii(bytes, 8, 4),
    format: ascii(bytes, 12, 4),
    formatLength: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(bytes, 36, 4),
    dataLength,
    samples,
  };
}

function parseStoredZip(bytes) {
  const files = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const expectedCrc = view.getUint32(offset + 14, true);
    const compressedLength = view.getUint32(offset + 18, true);
    const uncompressedLength = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataOffset = offset + 30 + nameLength + extraLength;
    const data = bytes.slice(dataOffset, dataOffset + compressedLength);
    assert.equal(compressedLength, uncompressedLength, `${name} should be stored without compression`);
    assert.equal(crc32(data), expectedCrc, `${name} should carry a valid CRC-32`);
    files.set(name, data);
    offset = dataOffset + compressedLength;
  }

  assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory follows local records");
  const endOffset = bytes.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50, "archive ends with EOCD");
  assert.equal(view.getUint16(endOffset + 8, true), files.size);
  assert.equal(view.getUint16(endOffset + 10, true), files.size);
  return files;
}

test("mono PCM encoder writes a valid 16-bit little-endian WAVE stream", () => {
  const bytes = encodeMonoPcm16Wave([
    new Int16Array([-32768, -1, 0]),
    [1, 32767],
  ], 48_000);

  assert.equal(bytes.length, 54);
  assert.deepEqual(parseWave(bytes), {
    riff: "RIFF",
    riffLength: 46,
    wave: "WAVE",
    format: "fmt ",
    formatLength: 16,
    audioFormat: 1,
    channels: 1,
    sampleRate: 48_000,
    byteRate: 96_000,
    blockAlign: 2,
    bitsPerSample: 16,
    data: "data",
    dataLength: 10,
    samples: [-32768, -1, 0, 1, 32767],
  });
});

test("stored ZIP archives preserve filenames, bytes, and CRC values", () => {
  const archive = createStoredZip([
    { name: "plain.txt", data: "surround" },
    { name: "raw.bin", data: new Uint8Array([0, 1, 2, 255]) },
  ], new Date("2026-01-02T03:04:05.000Z"));
  const files = parseStoredZip(archive);

  assert.deepEqual([...files.keys()], ["plain.txt", "raw.bin"]);
  assert.equal(decoder.decode(files.get("plain.txt")), "surround");
  assert.deepEqual([...files.get("raw.bin")], [0, 1, 2, 255]);
});

test("stem archive sorts physical channels and keeps each channel's samples isolated", () => {
  const capture = {
    channelChunks: [
      [new Int16Array([101, -101])],
      [new Int16Array([202, -202])],
      [new Int16Array([303, -303])],
    ],
    sampleRate: 48_000,
    frames: 2,
    peaks: [0.1, 0.2, 0.3],
    clippedSamples: 4,
  };
  const speakers = [
    { channel: 3, label: "C" },
    { channel: 1, label: "L" },
    { channel: 2, label: "R side" },
  ];
  const createdAt = new Date("2026-01-02T03:04:05.000Z");
  const result = buildStemArchive(capture, speakers, "7:4:1", createdAt);
  const files = parseStoredZip(result.bytes);

  assert.equal(result.filename, "surround-field-7-4-1-20260102T030405Z.zip");
  assert.equal(result.channelCount, 3);
  assert.equal(result.duration, 2 / 48_000);
  assert.equal(result.clippedSamples, 4);
  assert.deepEqual([...files.keys()], [
    "01-L.wav",
    "02-R-side.wav",
    "03-C.wav",
    "channel-map.txt",
  ]);
  assert.deepEqual(parseWave(files.get("01-L.wav")).samples, [101, -101]);
  assert.deepEqual(parseWave(files.get("02-R-side.wav")).samples, [202, -202]);
  assert.deepEqual(parseWave(files.get("03-C.wav")).samples, [303, -303]);

  const map = decoder.decode(files.get("channel-map.txt"));
  assert.equal(map, result.channelMap);
  assert.match(map, /Tap point: virtual post-spatial channel buses, before browser\/OS\/device processing/);
  assert.match(map, /01  L  -20\.00 dBFS peak/);
  assert.match(map, /02  R side  -13\.98 dBFS peak/);
  assert.match(map, /03  C  -10\.46 dBFS peak/);
  assert.match(map, /Clipped samples before PCM limiting: 4/);
});

test("recorder rejects concurrent starts and resolves a manual stop after final chunks", async () => {
  const previousAudioWorkletNode = globalThis.AudioWorkletNode;
  const worklets = [];

  class FakeAudioNode {
    constructor() {
      this.connections = [];
      this.disconnectCalls = [];
    }

    connect(destination) {
      this.connections.push(destination);
      return destination;
    }

    disconnect(destination) {
      this.disconnectCalls.push(destination);
    }
  }

  class FakeAudioWorkletNode extends FakeAudioNode {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = {
        closed: false,
        onmessage: null,
        postMessage: (message) => this.messages.push(message),
        close: () => { this.port.closed = true; },
      };
      this.onprocessorerror = null;
      worklets.push(this);
    }
  }

  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  const loadedModules = [];
  const destination = new FakeAudioNode();
  const createdGains = [];
  const context = {
    sampleRate: 48_000,
    destination,
    audioWorklet: {
      addModule: async (url) => { loadedModules.push(url); },
    },
    createGain() {
      const node = new FakeAudioNode();
      node.gain = { value: 1 };
      createdGains.push(node);
      return node;
    },
  };
  const input = new FakeAudioNode();
  const recorder = new SurroundFieldRecorder(context);

  try {
    await recorder.start(input, 2);
    assert.equal(recorder.active, true);
    assert.equal(loadedModules.length, 1);
    assert.match(loadedModules[0], /surround-field-recorder-processor\.js$/);
    assert.equal(worklets.length, 1);
    assert.equal(worklets[0].name, "surround-field-recorder");
    assert.equal(worklets[0].options.channelCount, 2);
    assert.equal(worklets[0].options.channelCountMode, "explicit");
    assert.equal(worklets[0].options.channelInterpretation, "discrete");
    assert.deepEqual(worklets[0].messages, [{ type: "start" }]);
    assert.equal(createdGains[0].gain.value, 0);
    assert.deepEqual(input.connections, [worklets[0]]);
    assert.deepEqual(worklets[0].connections, [createdGains[0]]);
    assert.deepEqual(createdGains[0].connections, [destination]);

    await assert.rejects(recorder.start(input, 2), /already (?:starting or )?running/i);

    const stopPromise = recorder.stop();
    assert.equal(recorder.stop(), stopPromise);
    assert.deepEqual(worklets[0].messages, [{ type: "start" }, { type: "stop" }]);
    worklets[0].port.onmessage({
      data: {
        type: "chunk",
        buffers: [new Int16Array([11, -11]).buffer, new Int16Array([22, -22]).buffer],
      },
    });
    worklets[0].port.onmessage({
      data: {
        type: "stopped",
        reason: "stopped",
        frames: 2,
        peaks: [0.1, 0.2],
        clippedSamples: 0,
      },
    });

    const capture = await stopPromise;
    assert.equal(capture.frames, 2);
    assert.equal(capture.reason, "stopped");
    assert.deepEqual(capture.peaks, [0.1, 0.2]);
    assert.deepEqual([...capture.channelChunks[0][0]], [11, -11]);
    assert.deepEqual([...capture.channelChunks[1][0]], [22, -22]);
    assert.equal(recorder.active, false);
    assert.deepEqual(input.disconnectCalls, [worklets[0]]);
    assert.equal(worklets[0].port.closed, true);
  } finally {
    recorder.cancel();
    if (previousAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousAudioWorkletNode;
  }
});

test("recorder serializes starts while its worklet module is still loading", async () => {
  let releaseModule;
  const context = {
    sampleRate: 48_000,
    audioWorklet: {
      addModule: () => new Promise((resolve) => { releaseModule = resolve; }),
    },
  };
  const recorder = new SurroundFieldRecorder(context);
  const pendingStart = recorder.start({}, 8);

  await assert.rejects(recorder.start({}, 8), /already starting or running/i);
  recorder.cancel();
  releaseModule();
  await assert.rejects(pendingStart, { name: "AbortError" });
  assert.equal(recorder.active, false);
});

test("recorder processor isolates channels, limits clipping, and flushes a partial chunk", () => {
  let Processor = null;
  let processorName = null;

  class FakeAudioWorkletProcessor {
    constructor() {
      this.posted = [];
      this.port = {
        onmessage: null,
        postMessage: (message, transfer) => this.posted.push({ message, transfer }),
      };
    }
  }

  const context = vm.createContext({
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    Float32Array,
    Int16Array,
    Array,
    Math,
    Number,
    sampleRate: 48_000,
    registerProcessor(name, constructor) {
      processorName = name;
      Processor = constructor;
    },
  });
  vm.runInContext(processorSource, context, {
    filename: "surround-field-recorder-processor.js",
  });

  assert.equal(processorName, "surround-field-recorder");
  const processor = new Processor({
    processorOptions: { channelCount: 2, chunkFrames: 1024, maxFrames: 64 },
  });
  processor.port.onmessage({ data: { type: "start" } });

  const output = new Float32Array([1, 1, 1, 1]);
  const keepAlive = processor.process(
    [[
      new Float32Array([-1.5, -0.5, 0.5, 1.5]),
      new Float32Array([0.25, -0.25, 0, 0.75]),
    ]],
    [[output]],
  );
  assert.equal(keepAlive, true);
  assert.deepEqual([...output], [0, 0, 0, 0]);
  assert.equal(processor.posted.length, 0, "a short render quantum remains buffered");

  processor.port.onmessage({ data: { type: "stop" } });
  assert.equal(processor.posted.length, 2);
  const [{ message: chunk, transfer }, { message: stopped }] = processor.posted;
  assert.equal(chunk.type, "chunk");
  assert.equal(chunk.frames, 4);
  assert.equal(chunk.buffers.length, 2);
  assert.deepEqual(transfer, chunk.buffers);
  assert.deepEqual([...new Int16Array(chunk.buffers[0])], [-32768, -16384, 16384, 32767]);
  assert.deepEqual([...new Int16Array(chunk.buffers[1])], [8192, -8192, 0, 24575]);
  assert.deepEqual(
    {
      type: stopped.type,
      reason: stopped.reason,
      frames: stopped.frames,
      peaks: [...stopped.peaks],
      clippedSamples: stopped.clippedSamples,
    },
    {
      type: "stopped",
      reason: "stopped",
      frames: 4,
      peaks: [1.5, 0.75],
      clippedSamples: 2,
    },
  );
});
