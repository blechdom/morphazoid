import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const viewer = await readFile(new URL("../src/instruments/spider-synth/spider-synth-viewer.js", import.meta.url), "utf8");
// Execute the actual loader's body-consumption code without WebGL, a server,
// fake model geometry, or copying the algorithm into the test.
const start = viewer.indexOf("      const length = Number(response.headers.get('Content-Length'))");
const end = viewer.indexOf("      if (this.disposed || serial !== this.loadSerial) return false;", start);
assert.ok(start > 0 && end > start);
const readBody = vm.runInNewContext(
  `(async function(response, MAX_BYTES, serial) {\n${viewer.slice(start, end)}\nreturn buffer;\n})`,
);
const owner = () => ({
  loadSerial: 1, disposed: false, statuses: [],
  onStatus(value) { this.statuses.push(value); },
});

function nativeResponse(header, buffer, failure) {
  let calls = 0;
  return {
    headers: { get: () => header },
    get body() { throw new Error("Known-size download must use the native response reader"); },
    async arrayBuffer() {
      calls++;
      if (failure) throw failure;
      return buffer;
    },
    get reads() { return calls; },
  };
}

test("known-size model uses native arrayBuffer exactly once and preserves bytes", async () => {
  const source = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]).buffer;
  const response = nativeResponse("8", source);
  const viewer = owner();
  assert.equal(await readBody.call(viewer, response, 16, 1), source);
  assert.equal(response.reads, 1);
  assert.equal(viewer.statuses.at(-1).progress, 0.85);
});

test("a real in-memory Response is fully consumed without changing the model bytes", async () => {
  const source = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
  const response = new Response(source, { headers: { "Content-Length": "8" } });
  const buffer = await readBody.call(owner(), response, 16, 1);
  assert.equal(response.bodyUsed, true);
  assert.deepEqual(new Uint8Array(buffer), source);
});

test("oversized Content-Length is rejected without reading or allocating the model", async () => {
  const response = nativeResponse("17", new ArrayBuffer(17));
  await assert.rejects(readBody.call(owner(), response, 16, 1), /download budget/);
  assert.equal(response.reads, 0);
});

test("known-length native body still checks the actual size, not just the header", async () => {
  const response = nativeResponse("8", new ArrayBuffer(17));
  await assert.rejects(readBody.call(owner(), response, 16, 1), /download budget/);
  assert.equal(response.reads, 1);
});

test("real body failure or cancellation propagates instead of being treated as a successful load", async () => {
  for (const error of [new Error("connection interrupted"), Object.assign(new Error("cancelled"), { name: "AbortError" })]) {
    const response = nativeResponse("8", null, error);
    await assert.rejects(readBody.call(owner(), response, 16, 1), failure => failure === error);
  }
});

function streamingResponse(chunks, { header = null, failure = null } = {}) {
  let offset = 0;
  const calls = { reads: 0, cancelled: 0, unlocked: 0 };
  const reader = {
    async read() {
      calls.reads++;
      if (failure) throw failure;
      return offset < chunks.length ? { done: false, value: chunks[offset++] } : { done: true };
    },
    async cancel() { calls.cancelled++; },
    releaseLock() { calls.unlocked++; },
  };
  return {
    calls, headers: { get: () => header },
    body: { getReader: () => reader },
    arrayBuffer() { throw new Error("Unknown-size stream must enforce the incremental limit"); },
  };
}

test("unknown-size responses keep the incremental byte cap and release the reader on success", async () => {
  for (const header of [null, "0", "invalid", "-1", "4.5"]) {
    const response = streamingResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4])], { header });
    const buffer = await readBody.call(owner(), response, 16, 1);
    assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3, 4]);
    assert.deepEqual(response.calls, { reads: 3, cancelled: 0, unlocked: 1 });
  }
});

test("unknown-size responses cancel as soon as the byte budget is exceeded and unlock once", async () => {
  const response = streamingResponse([new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)]);
  await assert.rejects(readBody.call(owner(), response, 16, 1), /download budget/);
  assert.deepEqual(response.calls, { reads: 2, cancelled: 1, unlocked: 1 });
});

test("stream errors release the reader and propagate the original error", async () => {
  const failure = new Error("read failed");
  const response = streamingResponse([], { failure });
  await assert.rejects(readBody.call(owner(), response, 16, 1), error => error === failure);
  assert.equal(response.calls.unlocked, 1);
});

test("a superseded or disposed load cannot publish progress for the new specimen", async () => {
  for (const state of [{ loadSerial: 2 }, { disposed: true }]) {
    const viewer = owner();
    let finish;
    const response = nativeResponse("8", new Promise(resolve => { finish = resolve; }));
    const reading = readBody.call(viewer, response, 16, 1);
    Object.assign(viewer, state);
    finish(new ArrayBuffer(8));
    await reading;
    assert.equal(viewer.statuses.length, 0);
  }
});

test("viewer retains GLB header/size checks, abort ownership and full 38-joint validation", () => {
  assert.match(viewer, /buffer\.byteLength < 20 \|\| buffer\.byteLength > MAX_BYTES/);
  assert.match(viewer, /header\.getUint32\(8, true\) !== buffer\.byteLength/);
  assert.match(viewer, /skeleton\.bones\.length !== 38/);
  assert.match(viewer, /if \(serial === this\.loadSerial\) this\.abort\?\.abort\(\)/);
  assert.match(viewer, /this\.disposed \|\| serial !== this\.loadSerial/);
});
