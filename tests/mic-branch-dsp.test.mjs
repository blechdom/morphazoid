import assert from "node:assert/strict";
import test from "node:test";
import {
  MicBranchDSP,
  micBranchPlaybackRate,
  sanitizeMicBranchVoice,
} from "../src/mic-branch-dsp.js";

test("microphone branch pitch is expressed as a bounded playback rate", () => {
  assert.equal(micBranchPlaybackRate(0, 2, 1), 1);
  assert.equal(micBranchPlaybackRate(0.5, 2, 1), 2);
  assert.equal(micBranchPlaybackRate(-0.5, 2, 1), 0.5);
  assert.equal(micBranchPlaybackRate(4, 8, 4), 4);
});

test("microphone branch specs cannot overdrive the renderer contract", () => {
  assert.deepEqual(sanitizeMicBranchVoice({
    key: "fork",
    rate: 99,
    gain: 2,
    pan: -9,
    depth: 100,
  }), {
    key: "fork",
    rate: 4,
    gain: 1,
    pan: -1,
    depth: 64,
    sourceKey: "base",
    bounceKey: null,
  });
});

test("sibling combinations bounce into a reusable subtree stem", () => {
  const renderer = new MicBranchDSP({
    sampleRate: 8_000,
    historySeconds: 1,
    maxVoices: 8,
    maxBounces: 8,
  });
  renderer.setFeedback(0);
  renderer.setVoices([
    { key: "left", rate: 0.9, gain: 0.3, bounceKey: "combo:root" },
    { key: "right", rate: 1.1, gain: 0.3, bounceKey: "combo:root" },
  ]);
  for (let block = 0; block < 8; block += 1) {
    const input = Float32Array.from({ length: 1024 }, (_, index) => (
      Math.sin((block * 1024 + index) * Math.PI / 19) * 0.2
    ));
    renderer.process(input, null, new Float32Array(1024), new Float32Array(1024));
  }
  assert.ok(renderer.bounces.get("combo:root").recordedSamples > renderer.grainSamples);

  renderer.setVoices([{
    key: "descendant",
    rate: 1.4,
    gain: 0.4,
    sourceKey: "combo:root",
    bounceKey: "combo:child",
  }]);
  let peak = 0;
  for (let block = 0; block < 4; block += 1) {
    const left = new Float32Array(1024);
    const right = new Float32Array(1024);
    renderer.process(new Float32Array(1024), null, left, right);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.001, "a descendant should resample the bounced sibling combination");
  assert.ok(renderer.bounces.size <= renderer.maxBounces);
});

test("one rolling recorder renders many virtual branches without audio nodes", () => {
  const renderer = new MicBranchDSP({ sampleRate: 8_000, historySeconds: 1, maxVoices: 16 });
  renderer.setFeedback(0.3);
  renderer.setVoices(Array.from({ length: 16 }, (_, index) => ({
    key: `branch:${index}`,
    rate: 0.75 + index / 16,
    gain: 0.05,
    pan: index / 7.5 - 1,
    depth: index % 4,
  })));

  let peak = 0;
  for (let block = 0; block < 24; block += 1) {
    const input = new Float32Array(1024);
    for (let index = 0; index < input.length; index += 1) {
      input[index] = Math.sin((block * input.length + index) * Math.PI / 31) * 0.2;
    }
    const left = new Float32Array(1024);
    const right = new Float32Array(1024);
    assert.equal(renderer.process(input, null, left, right), true);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.001, "recorded mic history should reach branch outputs");
  assert.ok(peak <= 1, "the recursive mix must remain bounded");

  renderer.setVoices([]);
  const silence = new Float32Array(4096);
  renderer.process(silence, null, new Float32Array(4096), new Float32Array(4096));
  assert.equal(renderer.voices.size, 0, "removed branches should release and leave the renderer");
});

test("the microphone renderer obeys a changing runtime ceiling and bounds release tails", () => {
  const renderer = new MicBranchDSP({
    sampleRate: 8_000,
    historySeconds: 1,
    maxVoices: 512,
  });
  const voices = Array.from({ length: 400 }, (_, index) => ({
    key: `old:${index}`,
    gain: 0.01,
  }));
  renderer.setVoices(voices, 160);
  assert.equal(renderer.activeTargetCount, 160);
  assert.equal(renderer.voices.size, 160);

  renderer.setVoices(Array.from({ length: 400 }, (_, index) => ({
    key: `new:${index}`,
    gain: 0.01,
  })), 128);
  assert.equal(renderer.activeTargetCount, 128);
  assert.ok(renderer.voices.size <= 144, "release tails should add at most 12.5% load");
  assert.equal(renderer.runtimeLimit, 128);
});
