import assert from "node:assert/strict";
import test from "node:test";

import {
  FRACTAPHONE_PRESETS,
  MAX_RECURSION_FEEDBACK,
  clamp,
  echoTreeLayout,
  estimateGenerations,
  recorderExtension,
  recursionParameters,
} from "../src/fractaphone.js";

test("Fractaphone presets stay inside the bounded feedback design", () => {
  assert.deepEqual(Object.keys(FRACTAPHONE_PRESETS), ["tunnel", "bloom", "choir", "fray"]);
  for (const preset of Object.values(FRACTAPHONE_PRESETS)) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.depth >= 0 && preset.depth <= MAX_RECURSION_FEEDBACK);
    assert.ok(preset.interval >= 70 && preset.interval <= 900);
    assert.ok(preset.branching >= 0 && preset.branching <= 1);
    assert.ok(preset.mutation >= 0 && preset.mutation <= 1);
  }
});

test("generation estimates stop when descendants fall below the audible floor", () => {
  assert.equal(estimateGenerations(0), 0);
  assert.equal(estimateGenerations(0.02), 1);
  assert.equal(estimateGenerations(0.5), 5);
  assert.equal(estimateGenerations(0.72), 10);
  assert.ok(estimateGenerations(10) <= 32);
});

test("feedback matrix conserves bounded outgoing gain while branching", () => {
  const single = recursionParameters({ interval: 240, depth: 0.8, branching: 0, mutation: 0 });
  assert.equal(single.selfFeedback, 0.8);
  assert.equal(single.crossFeedback, 0);
  assert.equal(single.seedB, 0);
  assert.equal(single.intervalA, 0.24);
  assert.equal(single.intervalB, 0.24);

  const forked = recursionParameters({ interval: 240, depth: 0.8, branching: 1, mutation: 1 });
  assert.ok(Math.abs(forked.selfFeedback + forked.crossFeedback - 0.8) < 1e-12);
  assert.equal(forked.selfFeedback, 0.4);
  assert.equal(forked.crossFeedback, 0.4);
  assert.ok(forked.intervalB > forked.intervalA);
  assert.ok(forked.modulationDepth > 0 && forked.modulationDepth <= 0.006);
  assert.ok(forked.lowpass < single.lowpass);
  assert.ok(forked.highpass > single.highpass);

  const clamped = recursionParameters({ interval: 10_000, depth: 4, branching: 4 });
  assert.ok(clamped.selfFeedback + clamped.crossFeedback <= MAX_RECURSION_FEEDBACK);
  assert.ok(clamped.intervalB <= 0.9 * 1.618 + 1e-12);
});

test("echo tree layout has stable parent links and a bounded visual width", () => {
  const line = echoTreeLayout(4, 0);
  assert.equal(line.length, 5);
  assert.ok(line.every((node) => node.y === 0));

  const tree = echoTreeLayout(20, 1, 6);
  assert.equal(Math.max(...tree.map((node) => node.generation)), 8);
  const ids = new Set(tree.map((node) => node.id));
  for (const node of tree.slice(1)) assert.ok(ids.has(node.parentId));
  for (let generation = 1; generation <= 8; generation += 1) {
    assert.ok(tree.filter((node) => node.generation === generation).length <= 6);
  }
});

test("small helpers normalize values and recording extensions", () => {
  assert.equal(clamp(-2), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(4, 2, 3), 3);
  assert.equal(recorderExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(recorderExtension("audio/mp4"), "m4a");
  assert.equal(recorderExtension("audio/webm;codecs=opus"), "webm");
});
