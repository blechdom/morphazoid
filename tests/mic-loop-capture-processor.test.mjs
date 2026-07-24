import assert from "node:assert/strict";
import test from "node:test";

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      posts: [],
      postMessage(message, transfer = []) {
        this.posts.push({ message, transfer });
      },
    };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  processorName = name;
  ProcessorConstructor = constructor;
};

await import(`../src/mic-loop-capture-processor.js?test=${Date.now()}`);

test("microphone worklet captures an exact mono duration and transfers its PCM buffer", () => {
  assert.equal(processorName, "morphazoid-mic-loop-capture");
  const processor = new ProcessorConstructor({
    processorOptions: { sampleCount: 130 },
  });

  const first = Float32Array.from({ length: 128 }, (_, index) => index / 128);
  const ignoredRight = new Float32Array(128).fill(-0.75);
  const firstOutput = new Float32Array(128).fill(0.5);
  assert.equal(
    processor.process([[first, ignoredRight]], [[firstOutput]]),
    true,
  );
  assert.ok(firstOutput.every((sample) => sample === 0), "capture must never monitor the mic");

  const second = Float32Array.from({ length: 128 }, (_, index) => 1 + index / 128);
  const secondOutput = new Float32Array(128).fill(0.5);
  assert.equal(
    processor.process([[second, ignoredRight]], [[secondOutput]]),
    false,
  );
  assert.ok(secondOutput.every((sample) => sample === 0));

  const complete = processor.port.posts.find(({ message }) => message.type === "complete");
  assert.ok(complete);
  assert.equal(complete.message.sampleRate, 48_000);
  assert.equal(complete.message.sampleCount, 130);
  assert.ok(complete.message.buffer instanceof ArrayBuffer);
  assert.deepEqual(complete.transfer, [complete.message.buffer]);

  const captured = new Float32Array(complete.message.buffer);
  assert.equal(captured.length, 130);
  assert.deepEqual(captured.slice(0, 128), first);
  assert.deepEqual(captured.slice(128), second.slice(0, 2));
  assert.notEqual(captured[0], ignoredRight[0], "the first mic channel is the mono source");

  const progressIndex = processor.port.posts.findIndex(
    ({ message }) => message.type === "progress",
  );
  const completeIndex = processor.port.posts.findIndex(
    ({ message }) => message.type === "complete",
  );
  assert.ok(progressIndex >= 0);
  assert.ok(progressIndex < completeIndex);
  assert.equal(
    processor.port.posts.filter(({ message }) => message.type === "complete").length,
    1,
  );
});
