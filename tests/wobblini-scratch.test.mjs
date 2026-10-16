import assert from "node:assert/strict";
import test from "node:test";
import { WobbliniScratchSampler, scratchPosition, createScratchWindow, SCRATCH_WINDOW_SECONDS } from "../src/instruments/wobblini/wobblini-scratch-model.js";

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


test("Wobblini rolling scratch windows match full stereo PCM across delayed refills, reversals and exact loop edges", () => {
  const length = rate * 12;
  const channels = [Float32Array.from({ length }, (_, frame) => Math.sin(frame * 0.013) * 0.7),
    Float32Array.from({ length }, (_, frame) => Math.cos(frame * 0.021) * 0.4)];
  const source = { sampleRate: rate, length, numberOfChannels: 2, getChannelData: channel => channels[channel] };
  for (const bounds of [
    { duration: 12, loopEnabled: false, loopStart: 0, loopEnd: 12 },
    { duration: 12, loopEnabled: true, loopStart: 1.23456, loopEnd: 10.54321 },
    { duration: 12, loopEnabled: true, loopStart: 4.12345, loopEnd: 4.32109 },
  ]) {
    const pending = []; let requests = 0;
    const windowed = new WobbliniScratchSampler(rate, request => {
      requests++; pending.push({ request, at: windowed.time + 0.064 });
    });
    const reference = new WobbliniScratchSampler(rate);
    const initial = { index: 0, generation: 1, sampleRate: rate, position: 5, ...bounds };
    reference.begin({ ...initial, channels });
    windowed.begin({ ...initial, window: createScratchWindow(source, bounds, initial.position) });
    const output = () => Array.from({ length: 8 }, () => [new Float32Array(128), new Float32Array(128)]);
    const actual = output(), expected = output(); let hand = 5;
    for (let block = 0; block < 320; block++) {
      while (pending.length && pending[0].at <= windowed.time + 1e-8) {
        const { request } = pending.shift();
        const window = createScratchWindow(source, bounds, request.position);
        const frames = window.chunks.reduce((sum, chunk) => sum + chunk.channels[0].length, 0);
        assert.ok(frames <= rate * SCRATCH_WINDOW_SECONDS + 8, "refill is bounded independently of track length");
        windowed.window({ ...request, window });
      }
      // Fast signed movement including repeated reversals while a refill is
      // in flight. Both samplers receive the same audio-clock gesture cadence.
      const direction = block < 65 || block >= 125 && block < 190 || block >= 260 ? 1 : -1;
      hand += direction * 0.128;
      for (const sampler of [reference, windowed]) sampler.move({ index: 0, generation: 1, position: hand });
      reference.process(expected); windowed.process(actual);
      for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 128; frame++) {
        near(actual[0][channel][frame], expected[0][channel][frame], 1e-7);
      }
      assert.ok(windowed.lanes[0].windows.length <= 2);
    }
    if (bounds.loopEnd - bounds.loopStart > 2) assert.ok(requests > 10, "crossed many real window boundaries");
    else assert.equal(requests, 0, "a short loop is copied once without repeated data");
  }
});

test("Wobblini scratch refills ignore ended generations and idle processing does not request PCM repeatedly", () => {
  const data = new Float32Array(rate * 8).fill(0.5), requests = [];
  const source = { sampleRate: rate, length: data.length, numberOfChannels: 1, getChannelData: () => data };
  const bounds = { duration: 8, loopEnabled: false, loopStart: 0, loopEnd: 8 };
  const window = createScratchWindow(source, bounds, 4);
  const sampler = new WobbliniScratchSampler(rate, request => requests.push(request));
  sampler.begin({ index: 0, generation: 2, sampleRate: rate, position: 4, ...bounds, window });
  render(sampler, 0.1); assert.equal(requests.length, 0, "holding a platter needs no refills");
  sampler.move({ index: 0, generation: 2, position: 4.9 });
  render(sampler, 0.016); render(sampler, 0.1); assert.equal(requests.length, 1, "one outstanding request maximum");
  sampler.window({ index: 0, generation: 1, window }); assert.equal(sampler.lanes[0].pendingWindow, true);
  sampler.end({ index: 0, generation: 2 }); sampler.window({ index: 0, generation: 2, window });
  render(sampler, 0.1); assert.equal(sampler.lanes[0], null); assert.equal(requests.length, 1);
});


test("Wobblini PCM windows use bounded copyFromChannel reads and held file edges cannot spin refills", () => {
  const data = new Float32Array(rate * 20).fill(0.2), copies = [];
  const source = { sampleRate: rate, length: data.length, numberOfChannels: 2,
    getChannelData() { throw new Error("Do not materialize a whole AudioBuffer channel"); },
    copyFromChannel(destination, channel, start) { copies.push({ size: destination.length, channel, start }); destination.set(data.subarray(start, start + destination.length)); } };
  const bounds = { duration: 20, loopEnabled: false, loopStart: 0, loopEnd: 20 }, requests = [];
  const sampler = new WobbliniScratchSampler(rate, request => requests.push(request));
  for (const position of [0, 20]) {
    const window = createScratchWindow(source, bounds, position);
    assert.ok(copies.every(copy => copy.size <= rate * 2 + 4));
    sampler.begin({ index: 0, generation: 1, sampleRate: rate, position, ...bounds, window });
    sampler.move({ index: 0, generation: 1, position: position === 0 ? -100 : 100 });
    render(sampler, 0.5);
  }
  assert.equal(requests.length, 0);
});
