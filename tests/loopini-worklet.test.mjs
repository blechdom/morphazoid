import assert from "node:assert/strict";
import test from "node:test";
let Processor;
globalThis.sampleRate = 8000;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { onmessage: null, postMessage: (m) => this.messages.push(m) }; }
};
globalThis.registerProcessor = (name, cls) => { assert.equal(name, "morphazoid-loopini"); Processor = cls; };
await import("../src/instruments/loopini/loopini-processor.js");
const send = (p, message) => p.port.onmessage({ data: message });
function render(p, blocks, blockSize = 128) {
  const output = [[new Float32Array(blockSize), new Float32Array(blockSize)]];
  let peak = 0;
  for (let block = 0; block < blocks; block++) {
    p.process([[Float32Array.from({ length: blockSize }, (_, i) => Math.sin((block * blockSize + i) / 7) * 0.2)]], output);
    for (const channel of output[0]) for (const value of channel) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
  }
  return peak;
}
test("real worklet records without monitoring; audio arm stays separate from sample-clock playback", () => {
  const p = new Processor(); send(p, { type: "record", id: 0 });
  assert.equal(render(p, 40), 0); send(p, { type: "finish" });
  assert.equal(p.core.filled(), 1); assert.equal(render(p, 40), 0);
  send(p, { type: "gain", value: 0.48 }); assert.ok(render(p, 30) > 0.01);
  const phase = p.core.phase; render(p, 13, 256); assert.notEqual(p.core.phase, phase);
  send(p, { type: "gain", value: 0 }); render(p, 40); assert.ok(render(p, 10) < 1e-8);
  assert.equal(p.core.playing, true);
  send(p, { type: "dispose" }); assert.equal(p.process([], [[new Float32Array(128)]]), false);
});

test("real worklet routes speed and overdub commands, auto-finishes and no longer exports or arranges", () => {
  const p = new Processor();
  send(p, { type: "record", id: 0 }); render(p, 40); send(p, { type: "finish" });
  const original = p.core.slots[0].samples;
  send(p, { type: "speed", value: 0.5 });
  send(p, { type: "record", id: 0, mode: "add" });
  assert.equal(p.core.snapshot().recording.mode, "add");
  send(p, { type: "speed", value: 2 }); assert.equal(p.core.speed, 0.5);
  render(p, 180);
  assert.equal(p.core.recording, null); assert.equal(p.core.filled(), 1);
  assert.notDeepEqual(p.core.slots[0].samples, original);
  assert.equal(p.core.slots[0].samples.length, original.length);
  send(p, { type: "speed", value: 1 }); render(p, 40);
  assert.equal(p.core.currentSpeed, 1);
  send(p, { type: "undo" }); assert.equal(p.core.slots[0].samples, original);
  send(p, { type: "export", id: 5 }); send(p, { type: "song" });
  assert.equal(p.messages.some((m) => m.type === "export"), false);
  assert.equal("song" in p.core.snapshot(), false);
});
