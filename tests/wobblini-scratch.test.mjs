import assert from "node:assert/strict";
import test from "node:test";
import { WobbliniScratchSampler, scratchPosition } from "../src/instruments/wobblini/wobblini-scratch-model.js";

const rate = 8000;
const near = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const ramp = Float32Array.from({ length: rate }, (_, index) => index / rate * 0.8 + 0.1);
const begin = (sampler, extra = {}) => sampler.begin({ index: 0, generation: 1, channels: [ramp], sampleRate: rate,
  duration: 1, position: 0.5, loopEnabled: false, loopStart: 0, loopEnd: 1, ...extra });
function render(sampler, seconds) {
  const length = Math.ceil(rate * seconds), outputs = Array.from({ length: 8 }, () => [new Float32Array(length), new Float32Array(length)]);
  sampler.process(outputs, length); return outputs;
}
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test("Wobblini sampler traverses actual PCM forward and backward with signed bounded velocity", () => {
  for (const direction of [-1, 1]) {
    const sampler = new WobbliniScratchSampler(rate); begin(sampler);
    sampler.move({ index: 0, generation: 1, position: 0.5 + direction * 0.4 });
    const output = render(sampler, 0.04)[0][0], lane = sampler.lanes[0];
    assert.equal(Math.sign(lane.velocity), direction); assert.ok(Math.abs(lane.velocity) <= 8);
    assert.ok(rms(output) > 0.05);
    // Once the envelope has settled, a ramp source must follow the direction
    // of actual sample traversal, rather than forward seek grains.
    assert.equal(Math.sign(output.at(-1) - output[Math.floor(rate * 0.025)]), direction);
    near(output.at(-1) / lane.gain, lane.position * 0.8 + 0.1);
  }
});

test("Wobblini held hand is silent and lost motion messages cannot leave a stuck sound", () => {
  const sampler = new WobbliniScratchSampler(rate); begin(sampler);
  assert.equal(rms(render(sampler, 0.05)[0][0]), 0, "touch without movement has no sound");
  sampler.move({ index: 0, generation: 1, position: 0.7 });
  assert.ok(rms(render(sampler, 0.025)[0][0]) > 0.01);
  render(sampler, 0.2); assert.equal(rms(render(sampler, 0.02)[0][0]), 0);
  near(sampler.lanes[0].position, 0.7);
  sampler.move({ index: 0, generation: 1, position: 0.1 }); render(sampler, 0.015);
  sampler.end({ index: 0, generation: 1 }); render(sampler, 0.08);
  assert.equal(sampler.lanes[0], null); assert.equal(rms(render(sampler, 0.02)[0][0]), 0);
});

test("Wobblini scratch loops wrap reverse PCM and finite files stop at their edges", () => {
  const bounds = { duration: 1, loopEnabled: true, loopStart: 0.25, loopEnd: 0.75 };
  near(scratchPosition(-0.1, bounds), 0.4); near(scratchPosition(4.1, bounds), 0.6);
  const sampler = new WobbliniScratchSampler(rate);
  begin(sampler, { ...bounds, position: 0.3 }); sampler.move({ index: 0, generation: 1, position: 0.1 });
  render(sampler, 0.04); const lane = sampler.lanes[0];
  near(scratchPosition(lane.position, lane), 0.6);
  begin(sampler, { generation: 2, position: 0.02 }); sampler.move({ index: 0, generation: 2, position: -10 });
  render(sampler, 0.1); near(sampler.lanes[0].position, 0); near(sampler.lanes[0].target, 0);
});

test("Wobblini scratch lanes keep stereo separation, bounded output and stale generations isolated", () => {
  const sampler = new WobbliniScratchSampler(rate);
  begin(sampler, { index: 7, channels: [new Float32Array(rate).fill(0.2), new Float32Array(rate).fill(-0.4)] });
  sampler.move({ index: 7, generation: 0, position: 0.9 }); assert.equal(rms(render(sampler, 0.02)[7][0]), 0);
  sampler.move({ index: 7, generation: 1, position: 0.9 });
  const outputs = render(sampler, 0.03);
  near(outputs[7][1].at(-1), outputs[7][0].at(-1) * -2);
  assert.ok(outputs[7][0].at(-1) > 0.1);
  for (const output of outputs.slice(0, 7)) assert.equal(rms(output[0]), 0);
  sampler.end({ index: 7, generation: 0 }); assert.equal(sampler.lanes[7].releasing, false);
  assert.equal(begin(sampler, { channels: [], position: Infinity }), false);
  sampler.clear(); assert.ok(sampler.lanes.every(lane => lane === null));
});

test("Wobblini reversal decelerates continuously instead of restarting a sample", () => {
  const sampler = new WobbliniScratchSampler(rate); begin(sampler);
  sampler.move({ index: 0, generation: 1, position: 0.9 }); render(sampler, 0.025);
  const before = sampler.lanes[0].position;
  sampler.move({ index: 0, generation: 1, position: 0.2 });
  near(sampler.lanes[0].position, before, 1e-12);
  const output = render(sampler, 0.025)[0][0];
  assert.ok(sampler.lanes[0].velocity < 0); assert.ok(sampler.lanes[0].position < before);
  assert.ok(output.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
});
