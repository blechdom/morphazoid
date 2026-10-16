import assert from "node:assert/strict";
import test from "node:test";

let Processor;
globalThis.sampleRate = 8000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } }; } };
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


test("Wobblini actual worklet requests bounded PCM and accepts refill messages without restarting the lane", async () => {
  const { createScratchWindow } = await import("../src/instruments/wobblini/wobblini-scratch-model.js");
  const data = new Float32Array(8000 * 20).fill(0.5);
  const source = { sampleRate: 8000, length: data.length, numberOfChannels: 1, getChannelData: () => data };
  const bounds = { duration: 20, loopEnabled: false, loopStart: 0, loopEnd: 20 };
  const processor = new Processor(), send = data => processor.port.onmessage({ data });
  const outputs = Array.from({ length: 8 }, () => [new Float32Array(128), new Float32Array(128)]);
  send({ type: "begin", index: 7, generation: 1, sampleRate: 8000, position: 10, ...bounds,
    window: createScratchWindow(source, bounds, 10) });
  send({ type: "move", index: 7, generation: 1, position: 11 }); processor.process([], outputs);
  const request = processor.port.messages.at(-1); assert.equal(request.type, "window-request"); assert.equal(request.index, 7);
  const lane = processor.sampler.lanes[7], position = lane.position;
  send({ ...request, type: "window", window: createScratchWindow(source, bounds, request.position) });
  assert.equal(processor.sampler.lanes[7], lane); assert.equal(lane.position, position); assert.equal(lane.windows.length, 2);
  processor.process([], outputs); assert.ok(outputs[7][0].every(value => value > 0.4));
});
