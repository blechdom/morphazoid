import assert from "node:assert/strict";
import test from "node:test";

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage(message) { this.messages.push(message); },
    };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  processorName = name;
  ProcessorConstructor = constructor;
};

await import(`../src/mic-branch-processor.js?test=${Date.now()}`);

test("microphone worklet enforces its live ceiling and reports render load", () => {
  assert.equal(processorName, "morphazoid-mic-branches");
  const processor = new ProcessorConstructor({
    processorOptions: { maxVoices: 512, historySeconds: 1 },
  });
  const voices = Array.from({ length: 300 }, (_, index) => ({
    key: `branch:${index}`,
    rate: 1,
    gain: 0.001,
    pan: 0,
    depth: 0,
  }));
  processor.port.onmessage({
    data: {
      type: "voices",
      voices,
      requestedVoiceCount: 300,
      voiceLimit: 160,
    },
  });
  assert.equal(processor.renderer.activeTargetCount, 160);
  assert.equal(processor.renderer.voices.size, 160);

  for (let block = 0; block < 96; block += 1) {
    const input = new Float32Array(128);
    processor.process([[input]], [[new Float32Array(128), new Float32Array(128)]]);
  }
  const report = processor.port.messages.find((message) => message.type === "render-load");
  assert.equal(report.supported, true);
  assert.equal(report.activeVoices, 160);
  assert.equal(report.requestedVoices, 300);
  assert.equal(report.voiceLimit, 160);
  assert.ok(Number.isFinite(report.averageLoad));
  assert.ok(Number.isFinite(report.peakLoad));
});
