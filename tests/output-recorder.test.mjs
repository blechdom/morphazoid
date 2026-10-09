import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  OutputRecorder, wavHeader, MAX_MEMORY_BYTES, MAX_FILE_BYTES,
  WAV_HEADER_BYTES, BYTES_PER_FRAME,
} from "../src/output-recorder.js";

let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      posts: [],
      postMessage(message, transfer = []) {
        this.posts.push({ message: structuredClone(message, { transfer }), transferCount: transfer.length });
      },
    };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  assert.equal(name, "morphazoid-output-recorder");
  Processor = constructor;
};
await import("../src/output-recorder-processor.js");

const tick = () => setImmediate();
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pcm24(buffer) {
  const bytes = new Uint8Array(buffer);
  const values = [];
  for (let index = 0; index < bytes.length; index += 3) {
    const unsigned = bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16);
    values.push(unsigned & 0x80_0000 ? unsigned - 0x100_0000 : unsigned);
  }
  return values;
}
function processBlock(processor, { left = 0.25, right = -0.5, frames = 128, channels = 2 } = {}) {
  const input = channels ? [new Float32Array(frames).fill(left)] : [];
  if (channels > 1) input.push(new Float32Array(frames).fill(right));
  const output = [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)];
  const active = processor.process([input], [output]);
  assert.ok(output.every((channel) => channel.every((sample) => sample === 0)), "recorder output must remain silent");
  return active;
}
function processor(options = {}) {
  const capture = new Processor({ processorOptions: { chunkFrames: 128, maxFrames: 10_000, credits: 8, ...options } });
  capture.port.onmessage({ data: { type: "start" } });
  return capture;
}
function chunkPosts(capture) {
  return capture.port.posts.filter(({ message }) => message.type === "chunk");
}

class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, new Set());
    this.events.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.events.get(type)?.delete(listener); }
  emit(type) { for (const listener of [...(this.events.get(type) ?? [])]) listener(); }
}
class Node {
  constructor() { this.connected = []; this.disconnected = false; this.gain = { value: 1 }; }
  connect(destination) { this.connected.push(destination); }
  disconnect() { this.disconnected = true; this.connected = []; }
}
function fixture(options = {}) {
  const contexts = [];
  const nodes = [];
  const timers = new Map();
  const runtime = new Events();
  runtime.Blob = Blob;
  runtime.setTimeout = (callback) => { const id = Symbol(); timers.set(id, callback); return id; };
  runtime.clearTimeout = (id) => timers.delete(id);
  runtime.AudioContext = class extends Events {
    constructor(config) {
      super();
      this.options = config;
      this.sampleRate = options.sampleRate || config.sampleRate;
      this.state = "suspended";
      this.resumeCalls = 0;
      this.closeCalls = 0;
      this.destination = new Node();
      this.audioWorklet = {
        addModule: (url) => {
          assert.ok(url.href.endsWith("/src/output-recorder-processor.js"));
          return options.module?.promise ?? Promise.resolve();
        },
      };
      contexts.push(this);
    }
    resume() { this.resumeCalls += 1; this.state = "running"; return Promise.resolve(); }
    createGain() { return new Node(); }
    async close() { this.closeCalls += 1; this.state = "closed"; this.emit("statechange"); }
  };
  runtime.AudioWorkletNode = class extends Node {
    constructor(context, name, config) {
      super();
      assert.equal(name, "morphazoid-output-recorder");
      this.options = config;
      this.processor = new Processor(config);
      this.messages = [];
      this.port = {
        closed: false,
        postMessage: (data) => {
          this.messages.push(data);
          queueMicrotask(() => this.processor.port.onmessage?.({ data }));
        },
        close() { this.closed = true; },
      };
      this.processor.port.postMessage = (data, transfer = []) => {
        const cloned = structuredClone(data, { transfer });
        queueMicrotask(() => this.port.onmessage?.({ data: cloned }));
      };
      nodes.push(this);
    }
  };
  const manager = {
    tapCount: 0, releases: 0, instrumentResumeCalls: 0,
    canRecord: () => options.canRecord !== false,
    recordingSampleRate: () => 48_000,
    recordingContext: () => {
      if (contexts.length) return contexts[0];
      const context = new runtime.AudioContext({ sampleRate: 48_000 });
      context.state = "running";
      return context;
    },
    tapInto(context, node, config) {
      assert.ok(contexts.includes(context));
      assert.ok(nodes.includes(node));
      this.tapCount += 1;
      this.tapOptions = config;
      if (options.tapError) throw options.tapError;
      return () => { this.releases += 1; };
    },
  };
  const recorder = new OutputRecorder({ manager, runtime, ...options.recorder });
  return {
    recorder, manager, runtime, contexts, nodes, timers,
    render(config) { return processBlock(nodes.at(-1).processor, config); },
    expireTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
function fileWriter({ stall, failChunk, failFinalize = false } = {}) {
  return {
    calls: [], bytes: new Uint8Array(0), position: 0, chunks: 0,
    concurrent: 0, maxConcurrent: 0, closed: false, aborted: false,
    async write(value) {
      this.concurrent += 1;
      this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
      try {
        this.calls.push(value);
        let bytes;
        if (value.type === "write") {
          if (failFinalize) throw new Error("disk unavailable");
          this.position = value.position;
          bytes = value.data;
        } else {
          bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
          if (value instanceof ArrayBuffer) {
            this.chunks += 1;
            if (this.chunks === 1 && stall) await stall.promise;
            if (this.chunks === failChunk) throw new Error("disk full");
          }
        }
        const next = new Uint8Array(Math.max(this.bytes.length, this.position + bytes.byteLength));
        next.set(this.bytes);
        next.set(bytes, this.position);
        this.position += bytes.byteLength;
        this.bytes = next;
      } finally { this.concurrent -= 1; }
    },
    async truncate(length) { this.calls.push({ truncate: length }); this.bytes = this.bytes.slice(0, length); },
    async close() { this.closed = true; this.calls.push("close"); },
    async abort() { this.aborted = true; },
  };
}

test("WAV header describes actual-rate stereo PCM24 and enforces RIFF's size ceiling", () => {
  const header = wavHeader({ sampleRate: 44_100, frames: 33 });
  const view = new DataView(header.buffer);
  const text = (offset, length) => new TextDecoder().decode(header.slice(offset, offset + length));
  assert.equal(header.length, 44);
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 8), "WAVEfmt ");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint32(4, true), 36 + 33 * 6);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44_100);
  assert.equal(view.getUint32(28, true), 264_600);
  assert.equal(view.getUint16(32, true), 6);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 198);
  assert.equal(MAX_MEMORY_BYTES, 128 * 1024 * 1024);
  const maximumFrames = (MAX_FILE_BYTES - WAV_HEADER_BYTES) / BYTES_PER_FRAME;
  const largest = new DataView(wavHeader({ sampleRate: 48_000, frames: maximumFrames }).buffer);
  assert.ok(largest.getUint32(4, true) <= 0xffff_ffff);
  assert.throws(() => wavHeader({ sampleRate: 48_000, frames: maximumFrames + 1 }), /limit/);
  assert.throws(() => wavHeader({ sampleRate: 0, frames: 1 }), /sample rate/);
  assert.throws(() => wavHeader({ sampleRate: 48_000, frames: 0.5 }), /limit/);
});

test("processor interleaves independent channels, clips PCM24, sanitizes non-finite input, and transfers the final chunk", () => {
  const capture = processor({ maxFrames: 6 });
  const left = Float32Array.from([-2, -1, -0.5, 0, 1, Number.NaN]);
  const right = Float32Array.from([2, 0.5, 0, -1, Number.POSITIVE_INFINITY, 0.25]);
  const output = [new Float32Array(6).fill(1), new Float32Array(6).fill(1)];
  assert.equal(capture.process([[left, right]], [output]), false);
  assert.ok(output.every((channel) => channel.every((sample) => sample === 0)));
  const [{ message, transferCount }] = chunkPosts(capture);
  assert.equal(transferCount, 1);
  assert.equal(message.frames, 6);
  assert.deepEqual(pcm24(message.buffer), [
    -8_388_608, 8_388_607, -8_388_608, 4_194_304, -4_194_304, 0,
    0, -8_388_608, 8_388_607, 0, 0, 2_097_152,
  ]);
  assert.deepEqual(capture.port.posts.at(-1).message, { type: "complete", frames: 6, reason: "limit" });
  capture.port.onmessage({ data: { type: "stop" } });
  assert.equal(capture.port.posts.length, 2, "completion is idempotent");
});

test("processor duplicates mono, records disconnected silence, and preserves an exact partial stop", () => {
  const capture = processor();
  processBlock(capture, { channels: 1, frames: 128, left: 0.25 });
  capture.port.onmessage({ data: { type: "credit" } });
  processBlock(capture, { channels: 0, frames: 17 });
  capture.port.onmessage({ data: { type: "stop" } });
  const chunks = chunkPosts(capture);
  assert.equal(chunks.length, 2);
  assert.ok(pcm24(chunks[0].message.buffer).every((value) => value === 2_097_152));
  assert.equal(chunks[1].message.frames, 17);
  assert.ok(pcm24(chunks[1].message.buffer).every((value) => value === 0));
  assert.equal(capture.port.posts.at(-1).message.frames, 145);
});

test("processor enforces the frame cap inside a render quantum", () => {
  const capture = processor({ maxFrames: 130 });
  assert.equal(processBlock(capture), true);
  assert.equal(processBlock(capture), false);
  assert.deepEqual(chunkPosts(capture).map(({ message }) => message.frames), [128, 2]);
  assert.equal(capture.frames, 130);
});

test("processor waits for the explicit start handshake before counting or capturing frames", () => {
  const capture = new Processor({ processorOptions: { maxFrames: 10_000 } });
  processBlock(capture, { channels: 0 });
  processBlock(capture);
  assert.equal(capture.frames, 0);
  assert.equal(capture.port.posts.length, 0);
  capture.port.onmessage({ data: { type: "start" } });
  processBlock(capture, { frames: 3 });
  capture.port.onmessage({ data: { type: "stop" } });
  const [{ message }] = chunkPosts(capture);
  assert.equal(message.frames, 3);
  assert.deepEqual(pcm24(message.buffer), [2_097_152, -4_194_304, 2_097_152, -4_194_304, 2_097_152, -4_194_304]);
});

test("exhausted worklet credits bound a stalled UI to a continuous captured prefix", () => {
  const capture = processor({ credits: 2 });
  processBlock(capture);
  processBlock(capture);
  assert.equal(processBlock(capture), false);
  assert.equal(chunkPosts(capture).length, 2);
  assert.deepEqual(capture.port.posts.at(-1).message, { type: "complete", frames: 256, reason: "backpressure" });
  capture.port.onmessage({ data: { type: "credit" } });
  assert.equal(processBlock(capture), false, "late credits cannot restart a take");
});

test("buffered take uses actual sample rate, releases only recording nodes, and stays ready until discarded", async () => {
  const graph = fixture({ sampleRate: 44_100 });
  const states = [];
  const unsubscribe = graph.recorder.subscribe((status) => states.push(status.state));
  await graph.recorder.start({ filename: "test.wav" });
  assert.equal(graph.recorder.getStatus().state, "recording");
  assert.equal(graph.contexts[0].options.sampleRate, 48_000);
  assert.equal(graph.contexts[0].resumeCalls, 0);
  assert.equal(graph.manager.instrumentResumeCalls, 0);
  assert.equal(graph.nodes[0].connected[0].gain.value, 0);
  graph.render({ frames: 133 });
  const stopping = graph.recorder.stop();
  assert.equal(graph.recorder.stop(), stopping);
  const ready = await stopping;
  assert.equal(ready.state, "ready");
  assert.equal(ready.frames, 133);
  assert.equal(ready.seconds, 133 / 44_100);
  assert.equal(ready.filename, "test.wav");
  const data = await ready.blob.arrayBuffer();
  assert.equal(data.byteLength, 44 + 133 * 6);
  assert.equal(new DataView(data).getUint32(24, true), 44_100);
  assert.deepEqual(pcm24(data.slice(44, 56)), [2_097_152, -4_194_304, 2_097_152, -4_194_304]);
  assert.equal(graph.manager.releases, 1);
  assert.equal(graph.contexts[0].closeCalls, 0);
  assert.equal(graph.contexts[0].state, "running", "stopping must preserve instrument Audio");
  assert.equal(graph.nodes[0].port.closed, true);
  assert.equal(graph.nodes[0].disconnected, true);
  assert.equal(graph.timers.size, 0);
  await assert.rejects(graph.recorder.start(), /Save or discard/);
  assert.equal(graph.recorder.getStatus().blob, ready.blob);
  graph.recorder.discard();
  assert.equal(graph.recorder.getStatus().state, "idle");
  assert.equal(graph.recorder.getStatus().blob, null);
  assert.ok(states.includes("starting") && states.includes("recording") && states.includes("stopping") && states.includes("ready"));
  unsubscribe();
  await graph.recorder.destroy();
});

test("memory cap automatically finalizes an exact bounded take", async () => {
  const graph = fixture({ recorder: { maxMemoryBytes: 44 + 130 * 6 } });
  await graph.recorder.start();
  graph.render();
  graph.render();
  await tick();
  const status = graph.recorder.getStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.reason, "buffer-limit");
  assert.equal(status.frames, 130);
  assert.equal(status.blob.size, 44 + 130 * 6);
  assert.equal(status.maxSeconds, 130 / 48_000);
  await graph.recorder.destroy();
});

test("direct file writes a placeholder then sequential PCM, patches the header and closes at its cap", async () => {
  const writable = fileWriter();
  const graph = fixture({ recorder: { maxFileBytes: 44 + 130 * 6 } });
  await graph.recorder.start({ filename: "long.wav", writable });
  assert.equal(writable.calls.length, 1);
  assert.equal(new DataView(writable.bytes.buffer).getUint32(40, true), 0);
  graph.render();
  graph.render();
  await tick();
  const status = graph.recorder.getStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.mode, "file");
  assert.equal(status.reason, "file-limit");
  assert.equal(status.saved, true);
  assert.equal(status.blob, null);
  assert.equal(status.frames, 130);
  assert.equal(writable.maxConcurrent, 1);
  assert.equal(writable.closed, true);
  assert.equal(writable.bytes.length, 44 + 130 * 6);
  assert.equal(new DataView(writable.bytes.buffer).getUint32(40, true), 130 * 6);
  assert.deepEqual(pcm24(writable.bytes.buffer.slice(44, 50)), [2_097_152, -4_194_304]);
  await graph.recorder.destroy();
});

test("slow disk cannot grow the write queue beyond worklet credits", async () => {
  const stall = deferred();
  const writable = fileWriter({ stall });
  const graph = fixture();
  await graph.recorder.start({ writable });
  const chunkFrames = graph.nodes[0].options.processorOptions.chunkFrames;
  for (let index = 0; index < 10; index += 1) graph.render({ frames: chunkFrames });
  await tick();
  assert.equal(graph.recorder.getStatus().reason, "backpressure");
  assert.equal(graph.recorder.getStatus().frames, chunkFrames * 8);
  assert.equal(writable.chunks, 1, "only the first stalled write has started");
  const stopped = graph.recorder.stop();
  stall.resolve();
  const status = await stopped;
  assert.equal(status.state, "ready");
  assert.equal(status.saved, true);
  assert.equal(status.frames, chunkFrames * 8);
  assert.equal(writable.chunks, 8);
  assert.equal(writable.maxConcurrent, 1);
  await graph.recorder.destroy();
});

test("stopping during module load cancels startup and prevents a late capture graph", async () => {
  const module = deferred();
  const graph = fixture({ module });
  const starting = graph.recorder.start();
  assert.equal(graph.recorder.getStatus().state, "starting");
  await assert.rejects(graph.recorder.start(), /current take/);
  const stopped = await graph.recorder.stop();
  assert.equal(stopped.state, "ready");
  assert.equal(stopped.frames, 0);
  assert.equal(graph.contexts[0].closeCalls, 0);
  module.resolve();
  await starting;
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.manager.tapCount, 0);
  graph.recorder.discard();
  await graph.recorder.start();
  graph.render({ frames: 2 });
  assert.equal((await graph.recorder.stop()).frames, 2);
  await graph.recorder.destroy();
});

test("unsupported or disabled output never resumes instrument Audio and aborts an unused file", async () => {
  const writable = fileWriter();
  const graph = fixture({ canRecord: false });
  await assert.rejects(graph.recorder.start({ writable }), /Turn Audio on/);
  assert.equal(graph.contexts.length, 0);
  assert.equal(graph.manager.tapCount, 0);
  assert.equal(writable.aborted, true);
  assert.equal(writable.closed, false);
  assert.equal(graph.recorder.getStatus().state, "error");
  await graph.recorder.destroy();
});

test("module failure leaves the borrowed instrument context running and reports the startup failure", async () => {
  const module = deferred();
  const graph = fixture({ module });
  const starting = graph.recorder.start();
  module.reject(new Error("worklet could not load"));
  await assert.rejects(starting, /worklet could not load/);
  assert.equal(graph.recorder.getStatus().reason, "start-error");
  assert.equal(graph.recorder.getStatus().state, "error");
  assert.equal(graph.contexts[0].closeCalls, 0);
  assert.equal(graph.contexts[0].state, "running");
  assert.equal(graph.manager.tapCount, 0);
  await graph.recorder.destroy();
});

test("a stop requested by a starting observer cannot create a late audio context", async () => {
  const graph = fixture();
  const release = graph.recorder.subscribe(({ state }) => {
    if (state === "starting") void graph.recorder.stop();
  });
  const status = await graph.recorder.start();
  assert.equal(status.state, "ready");
  assert.equal(graph.contexts.length, 0);
  assert.equal(graph.nodes.length, 0);
  release();
  await graph.recorder.destroy();
});

test("suspended recording context finalizes received audio when a worklet cannot acknowledge stop", async () => {
  const graph = fixture();
  await graph.recorder.start();
  const chunkFrames = graph.nodes[0].options.processorOptions.chunkFrames;
  graph.render({ frames: chunkFrames });
  await tick();
  graph.nodes[0].processor.port.onmessage = null;
  graph.contexts[0].state = "suspended";
  graph.contexts[0].emit("statechange");
  assert.equal(graph.recorder.getStatus().state, "stopping");
  const stopped = graph.recorder.stop();
  graph.expireTimers();
  const status = await stopped;
  assert.equal(status.state, "ready");
  assert.equal(status.reason, "interrupted");
  assert.equal(status.frames, chunkFrames);
  assert.ok(status.error.includes("interrupted"));
  assert.equal(graph.manager.releases, 1);
  await graph.recorder.destroy();
});

test("processor failure preserves delivered PCM and cleans up the graph", async () => {
  const graph = fixture();
  await graph.recorder.start();
  const chunkFrames = graph.nodes[0].options.processorOptions.chunkFrames;
  graph.render({ frames: chunkFrames });
  await tick();
  graph.nodes[0].onprocessorerror();
  const status = await graph.recorder.stop();
  assert.equal(status.state, "ready");
  assert.equal(status.reason, "processor-error");
  assert.equal(status.frames, chunkFrames);
  assert.equal(status.blob.size, 44 + chunkFrames * 6);
  await graph.recorder.destroy();
});

test("a newly registered independent output stops capture and preserves the take", async () => {
  const graph = fixture();
  await graph.recorder.start();
  graph.render({ frames: 100 });
  graph.manager.tapOptions.onerror(new Error("Multiple audio outputs cannot be combined for recording."));
  const status = await graph.recorder.stop();
  assert.equal(status.state, "ready");
  assert.equal(status.frames, 100);
  assert.equal(status.reason, "interrupted");
  assert.match(status.error, /Multiple audio outputs/);
  assert.equal(graph.manager.releases, 1);
  await graph.recorder.destroy();
});

test("the borrowed context is never constructed, resumed, suspended or closed by recording lifecycle", async () => {
  const graph = fixture();
  const context = graph.manager.recordingContext();
  const calls = [];
  graph.runtime.AudioContext = class {
    constructor() { calls.push("construct"); throw new Error("Recorder must borrow the running context"); }
  };
  for (const method of ["resume", "suspend", "close"]) {
    context[method] = () => { calls.push(method); throw new Error(`Recorder must not ${method} instrument Audio`); };
  }
  await graph.recorder.start();
  graph.render({ frames: 25 });
  const first = await graph.recorder.stop();
  assert.equal(first.frames, 25);
  graph.recorder.discard();
  await graph.recorder.start();
  graph.render({ frames: 13 });
  await graph.recorder.destroy();
  assert.equal(graph.recorder.getStatus().frames, 13);
  assert.equal(graph.contexts.length, 1);
  assert.equal(graph.manager.releases, 2);
  assert.equal(context.state, "running");
  assert.equal(context.events.get("statechange").size, 0);
  assert.deepEqual(calls, []);
});

test("a context suspended during startup is rejected without arming Audio", async () => {
  const graph = fixture();
  const context = graph.manager.recordingContext();
  context.state = "suspended";
  await assert.rejects(graph.recorder.start(), /Turn Audio on/);
  assert.equal(context.resumeCalls, 0);
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, "suspended");
  assert.equal(graph.nodes.length, 0);
  await graph.recorder.destroy();
});

test("a closed instrument context preserves delivered PCM without another context close", async () => {
  const graph = fixture();
  await graph.recorder.start();
  const frames = graph.nodes[0].options.processorOptions.chunkFrames;
  graph.render({ frames });
  await tick();
  graph.nodes[0].processor.port.onmessage = null;
  const context = graph.contexts[0];
  await context.close();
  const stopped = graph.recorder.stop();
  graph.expireTimers();
  const status = await stopped;
  assert.equal(status.state, "ready");
  assert.equal(status.frames, frames);
  assert.equal(status.reason, "interrupted");
  assert.equal(context.closeCalls, 1, "only the instrument owner's explicit close was called");
  assert.equal(context.resumeCalls, 0);
  await graph.recorder.destroy();
});

test("a failed disk write finalizes only fully written chunks if the stream is still usable", async () => {
  const writable = fileWriter({ failChunk: 2 });
  const graph = fixture();
  await graph.recorder.start({ writable });
  const chunkFrames = graph.nodes[0].options.processorOptions.chunkFrames;
  graph.render({ frames: chunkFrames });
  graph.render({ frames: chunkFrames });
  const status = await graph.recorder.stop();
  assert.equal(status.state, "ready");
  assert.equal(status.reason, "write-error");
  assert.equal(status.saved, true);
  assert.equal(status.frames, chunkFrames);
  assert.equal(writable.bytes.length, 44 + chunkFrames * 6);
  assert.equal(new DataView(writable.bytes.buffer).getUint32(40, true), chunkFrames * 6);
  assert.match(status.error, /disk full/);
  await graph.recorder.destroy();
});

test("unrecoverable file failure is explicit, aborts the stream, and releases the output tap", async () => {
  const writable = fileWriter({ failFinalize: true });
  const graph = fixture();
  await graph.recorder.start({ writable });
  graph.render({ frames: 100 });
  const status = await graph.recorder.stop();
  assert.equal(status.state, "error");
  assert.equal(status.saved, false);
  assert.equal(status.blob, null);
  assert.equal(status.reason, "write-error");
  assert.match(status.error, /could not be finalized/);
  assert.equal(writable.aborted, true);
  assert.equal(graph.manager.releases, 1);
  await graph.recorder.destroy();
});

test("explicit destruction stops capture and removes observers without touching the audible graph", async () => {
  const graph = fixture();
  await graph.recorder.start();
  graph.render({ frames: 10 });
  const destroyed = graph.recorder.destroy();
  const status = await graph.recorder.stop();
  await destroyed;
  assert.equal(status.state, "ready");
  assert.equal(status.frames, 10);
  assert.equal(graph.manager.releases, 1);
  assert.equal(graph.runtime.events.size, 0, "the UI owns pagehide and BFCache handling");
  assert.equal(graph.recorder.listeners.size, 0);
  await assert.rejects(graph.recorder.start(), /closed/);
});

test("a disk write that never settles times out, aborts, and cannot leave the recorder stopping forever", async () => {
  const stall = deferred();
  const writable = fileWriter({ stall });
  const graph = fixture();
  await graph.recorder.start({ writable });
  graph.render({ frames: 100 });
  const stopped = graph.recorder.stop();
  await tick();
  assert.equal(graph.recorder.getStatus().state, "stopping");
  assert.equal(writable.chunks, 1);
  graph.expireTimers();
  const status = await stopped;
  assert.equal(status.state, "error");
  assert.equal(status.saved, false);
  assert.equal(status.reason, "write-error");
  assert.match(status.error, /timed out/);
  assert.equal(writable.aborted, true);
  assert.equal(graph.manager.releases, 1);
  assert.equal(graph.timers.size, 0);
  stall.resolve();
  await tick();
  assert.equal(graph.recorder.getStatus().state, "error", "late disk completion cannot report a saved take");
  await graph.recorder.destroy();
});
