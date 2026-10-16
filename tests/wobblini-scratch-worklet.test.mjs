import assert from "node:assert/strict";
import test from "node:test";

let Processor;
globalThis.sampleRate = 8000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null }; } };
globalThis.registerProcessor = (name, constructor) => { assert.equal(name, "morphazoid-wobblini-scratch"); Processor = constructor; };
await import("../src/instruments/wobblini/wobblini-scratch-processor.js");
test("Wobblini actual worklet routes eight independent outputs and releases on teardown", () => {
  const processor = new Processor(), outputs = Array.from({ length: 8 }, () => [new Float32Array(128), new Float32Array(128)]);
  const send = data => processor.port.onmessage({ data });
  send({ type: "begin", index: 6, generation: 1, channels: [new Float32Array(8000).fill(0.5)],
    sampleRate: 8000, duration: 1, position: 0.5, loopEnabled: false, loopStart: 0, loopEnd: 1 });
  send({ type: "move", index: 6, generation: 1, position: 0.2 });
  assert.equal(processor.process([], outputs), true);
  assert.ok(outputs[6][0].some(value => value > 0.1));
  assert.ok(outputs.filter((_, index) => index !== 6).every(output => output[0].every(value => value === 0)));
  send({ type: "clear" }); processor.process([], outputs); assert.ok(outputs[6][0].every(value => value === 0));
  send({ type: "dispose" }); assert.equal(processor.process([], outputs), false);
});
