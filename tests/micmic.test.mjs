import assert from "node:assert/strict";
import test from "node:test";

import {
  MICMIC_PRESETS,
  GENERATION_RULE_PRESETS,
  MAX_GENERATION_STAGES,
  MAX_GENERATION_VOICES,
  MAX_RECURSION_FEEDBACK,
  clamp,
  echoTreeLayout,
  estimateGenerations,
  generationCountForDepth,
  generationTopology,
  generationVoiceSpecs,
  recorderExtension,
  recursionParameters,
} from "../src/micmic.js";

test("mic(mic) presets stay inside the bounded feedback design", () => {
  assert.deepEqual(Object.keys(MICMIC_PRESETS), ["tunnel", "bloom", "choir", "fray"]);
  for (const preset of Object.values(MICMIC_PRESETS)) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.depth >= 0 && preset.depth <= MAX_RECURSION_FEEDBACK);
    assert.ok(preset.interval >= 0.2 && preset.interval <= 2_400);
    assert.ok(preset.branching >= 0 && preset.branching <= 1);
    assert.ok(preset.mutation >= 0 && preset.mutation <= 1);
  }
});

test("generation estimates stop when descendants fall below the audible floor", () => {
  assert.equal(estimateGenerations(0), 1);
  assert.equal(estimateGenerations(0.02), 1);
  assert.equal(estimateGenerations(0.5), 5);
  assert.equal(estimateGenerations(0.72), 10);
  assert.ok(estimateGenerations(10) <= 32);
  assert.equal(generationCountForDepth(0.86), 12);
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
  assert.ok(clamped.intervalB <= 2.4 * 1.618 + 1e-12);
});

test("generation rewrite recursively tapers the inherited buffer interval", () => {
  const flat = generationVoiceSpecs({
    generations: 3,
    interval: 500,
    depth: 0.7,
    branching: 0,
    timeRatio: 0.5,
  });
  assert.deepEqual(flat.map((voice) => voice.interval), [0.25, 0.125, 0.0625]);
  assert.deepEqual(flat.map((voice) => voice.delay), [0.25, 0.375, 0.4375]);
  assert.ok(flat.every((voice) => voice.rate === 1));
});

test("branch angles accumulate as proportional octave turns", () => {
  const voices = generationVoiceSpecs({
    generations: 2,
    interval: 500,
    depth: 0.7,
    branching: 1,
    timeRatio: 0.5,
    angle: 30,
    asymmetry: 0,
    pitchScale: 1,
  });
  const first = voices.filter((voice) => voice.generation === 1);
  assert.deepEqual(first.map((voice) => [voice.rule, voice.interval, voice.turnDegrees]), [
    ["A", 0.25, -30],
    ["B", 0.25, 30],
  ]);
  assert.ok(Math.abs(first[0].rate - 2 ** (-2 / 12)) < 1e-12);
  assert.ok(Math.abs(first[1].rate - 2 ** (2 / 12)) < 1e-12);
  const second = voices.filter((voice) => voice.generation === 2);
  assert.deepEqual(second.map((voice) => [voice.rule, voice.interval, voice.turnDegrees]), [
    ["A", 0.125, -30], ["B", 0.125, 30], ["A", 0.125, -30], ["B", 0.125, 30],
  ]);
  assert.ok(Math.abs(second[0].rate - 2 ** (-4 / 12)) < 1e-12);
  assert.equal(second[1].rate, 1);
  assert.equal(second[2].rate, 1);
  assert.ok(Math.abs(second[3].rate - 2 ** (4 / 12)) < 1e-12);
});

test("one bounded L-system topology drives a fixed trunk and richer audio branches", () => {
  const shortChildren = generationTopology({
    generations: 8,
    branching: 1,
    timeRatio: 0.2,
    angle: 30,
  });
  const longChildren = generationTopology({
    generations: 8,
    branching: 1,
    timeRatio: 1,
    angle: 30,
  });
  assert.deepEqual(shortChildren[0], longChildren[0], "child timing must never resize the trunk");
  assert.equal(shortChildren[0].length, 1);
  assert.ok(shortChildren.length > 50, "the visual topology should contain a dense bounded tree");

  const voices = generationVoiceSpecs({
    generations: 12,
    interval: 240,
    depth: 0.86,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
  });
  const topologyIds = new Set(generationTopology({
    generations: 12,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
  }).map((node) => node.id));
  assert.ok(voices.length <= MAX_GENERATION_VOICES && voices.length >= 40);
  assert.ok(voices.every((voice) => topologyIds.has(voice.key.replace(/^generation:/, ""))));
  assert.ok(new Set(voices.map((voice) => voice.generation)).size === 12);
});

test("generation and voice limits stay bounded above the UI maximum", () => {
  const topology = generationTopology({
    generations: 99,
    branching: 1,
    timeRatio: 1,
    angle: 45,
  });
  const voices = generationVoiceSpecs({
    generations: 99,
    interval: 2_400,
    depth: 0.86,
    branching: 1,
    timeRatio: 1,
    angle: 45,
  });
  assert.equal(Math.max(...topology.map((node) => node.generation)), MAX_GENERATION_STAGES);
  assert.equal(Math.max(...voices.map((voice) => voice.generation)), MAX_GENERATION_STAGES);
  assert.ok(voices.length <= MAX_GENERATION_VOICES);
  assert.ok(Math.max(...voices.map((voice) => voice.delay)) <= 28.8 + 1e-9);
});

test("rule mutation deterministically changes the shared drawing and audio rewrite", () => {
  const settings = {
    generations: 8,
    branching: 0.84,
    timeRatio: 0.72,
    angle: 30,
    asymmetry: 0.1,
  };
  const stable = generationTopology({ ...settings, mutation: 0 });
  const mutated = generationTopology({ ...settings, mutation: 1 });
  assert.deepEqual(mutated[0], stable[0], "mutation must not change the seed trunk");
  assert.deepEqual(
    generationTopology({ ...settings, mutation: 1 }),
    mutated,
    "the same rewrite controls must produce the same mutation",
  );
  assert.ok(mutated.slice(1).some((node, index) => (
    node.turnDegrees !== stable[index + 1].turnDegrees
    || node.length !== stable[index + 1].length
  )));

  const stableVoices = generationVoiceSpecs({ ...settings, interval: 500, depth: 0.72, mutation: 0 });
  const mutatedVoices = generationVoiceSpecs({ ...settings, interval: 500, depth: 0.72, mutation: 1 });
  assert.deepEqual(
    mutatedVoices.map((voice) => voice.key),
    stableVoices.map((voice) => voice.key),
  );
  assert.ok(mutatedVoices.some((voice, index) => (
    voice.turnDegrees !== stableVoices[index].turnDegrees
    || voice.interval !== stableVoices[index].interval
    || voice.rate !== stableVoices[index].rate
  )));
});

test("fork density changes both visual segments and audible branches", () => {
  const line = generationTopology({ generations: 6, branching: 0, angle: 30 });
  const tree = generationTopology({ generations: 6, branching: 1, angle: 30 });
  const lineVoices = generationVoiceSpecs({ generations: 6, branching: 0, angle: 30 });
  const treeVoices = generationVoiceSpecs({ generations: 6, branching: 1, angle: 30 });

  assert.equal(line.length, 7);
  assert.ok(tree.length > line.length);
  assert.equal(lineVoices.length, 6);
  assert.ok(treeVoices.length > lineVoices.length);
});

test("generation relationship presets mirror the L-system families", () => {
  assert.deepEqual(Object.keys(GENERATION_RULE_PRESETS), ["clean", "binary", "pythagorean", "plant", "coral", "dragon", "koch"]);
  assert.equal(GENERATION_RULE_PRESETS.clean.timeRatio, 1);
  assert.equal(GENERATION_RULE_PRESETS.clean.angle, 0);
  assert.equal(GENERATION_RULE_PRESETS.binary.timeRatio, 0.5);
  assert.equal(GENERATION_RULE_PRESETS.binary.angle, 30);
  assert.equal(GENERATION_RULE_PRESETS.pythagorean.angle, 45);
});

test("echo tree layout has stable parent links and a bounded visual width", () => {
  const line = echoTreeLayout(4, 0);
  assert.equal(line.length, 5);
  assert.ok(line.every((node) => node.y === 0));

  const tree = echoTreeLayout(20, 1, 6);
  assert.equal(Math.max(...tree.map((node) => node.generation)), 12);
  const ids = new Set(tree.map((node) => node.id));
  for (const node of tree.slice(1)) assert.ok(ids.has(node.parentId));
  for (let generation = 1; generation <= 12; generation += 1) {
    assert.ok(tree.filter((node) => node.generation === generation).length <= 6);
  }
  const extendedPreview = echoTreeLayout(22, 1, 6, 32);
  assert.equal(Math.max(...extendedPreview.map((node) => node.generation)), 22);
});

test("small helpers normalize values and recording extensions", () => {
  assert.equal(clamp(-2), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(4, 2, 3), 3);
  assert.equal(recorderExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(recorderExtension("audio/mp4"), "m4a");
  assert.equal(recorderExtension("audio/webm;codecs=opus"), "webm");
});
