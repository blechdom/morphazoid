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

await import(`../src/micmic-generation-processor.js?test=${Date.now()}`);

test("fallback generation processor reports measured load and its adaptive ceiling", () => {
  assert.equal(processorName, "morphazoid-micmic-generations");
  const processor = new ProcessorConstructor({
    processorOptions: { maxVoices: 64, historySeconds: 4 },
  });
  const voices = Array.from({ length: 64 }, (_, index) => ({
    key: `voice:${index}`,
    delay: 0.02,
    rate: 1,
    gain: 0.001,
    pan: 0,
  }));
  processor.port.onmessage({
    data: {
      type: "voices",
      voices,
      requestedVoiceCount: 894,
      voiceLimit: 32,
    },
  });
  assert.equal(processor.renderer.activeTargetCount, 32);

  for (let block = 0; block < 96; block += 1) {
    const input = new Float32Array(128);
    processor.process(
      [[input]],
      [[new Float32Array(128), new Float32Array(128)]],
    );
  }
  const report = processor.port.messages.find((message) => message.type === "render-load");
  assert.equal(report.supported, true);
  assert.equal(report.renderer, "granular-fallback");
  assert.equal(report.activeVoices, 32);
  assert.equal(report.requestedVoices, 894);
  assert.equal(report.voiceLimit, 32);
  assert.ok(Number.isFinite(report.averageLoad));
  assert.ok(Number.isFinite(report.peakLoad));
});
