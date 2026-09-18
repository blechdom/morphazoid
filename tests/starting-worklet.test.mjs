import assert from "node:assert/strict";
import test from "node:test";
let Processor;
globalThis.sampleRate = 24000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { onmessage: null, postMessage: (m) => this.messages.push(m) }; }
};
globalThis.registerProcessor = (name, ctor) => { assert.equal(name, "morphazoid-starting-instrument"); Processor = ctor; };
await import("../src/starting-instruments/processor.js");
const send = (p, m) => p.port.onmessage({ data: m });
function render(p, blocks, input = 0) {
  const output = [[new Float32Array(128), new Float32Array(128)]];
  let peak = 0;
  for (let i = 0; i < blocks; i++) {
    globalThis.currentTime += 128 / sampleRate;
    p.process([[new Float32Array(128).fill(input)]], output);
    for (const channel of output[0]) for (const v of channel) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  }
  return peak;
}
for (const id of ["tempo-tantrum", "tape-worm", "loop-soup", "habit-habitat", "hollowphonic"]) {
  test(`${id}: actual worklet stays silent until armed and keeps running during UI silence`, () => {
    const p = new Processor({ processorOptions: { id } });
    send(p, { type: "play", value: true });
    assert.equal(render(p, 100), 0);
    const before = p.core.time;
    send(p, { type: "gain", value: 0.5 });
    assert.ok(render(p, 400) > 0.001);
    assert.ok(p.core.time > before);
    assert.ok(p.messages.some((m) => m.type === "state"));
    send(p, { type: "gain", value: 0 }); render(p, 150);
    assert.ok(render(p, 100) < 1e-7);
    assert.equal(p.core.playing, true);
    send(p, { type: "dispose" });
    assert.equal(p.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  });
}
