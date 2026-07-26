import assert from "node:assert/strict";
import test from "node:test";

import { L_SYSTEM_PRESETS, traceLSystem } from "../src/l-system.js";
import {
  FIXED_FORK_DENSITY,
  MICMIC_PRESETS,
  GENERATION_RULE_PRESETS,
  MAX_ADAPTIVE_GENERATION_VOICES,
  MAX_CHILD_TIME_RATIO,
  MAX_GENERATION_DELAY_SECONDS,
  MAX_GENERATION_STAGES,
  MAX_GENERATION_VOICES,
  MAX_RECURSION_FEEDBACK,
  MAX_TIME_FOLD_MS,
  MIN_TIME_FOLD_MS,
  TIME_FOLD_HIGH_MS,
  TIME_FOLD_HIGH_SLIDER,
  TIME_FOLD_LOW_MS,
  TIME_FOLD_LOW_SLIDER,
  TIME_FOLD_SLIDER_STEPS,
  clamp,
  echoTreeLayout,
  estimateGenerations,
  generationCountForDepth,
  generationTailSeconds,
  generationTopology,
  generationVoiceSpecs,
  recursionParameters,
  sliderFromTimeFold,
  timeFoldFromSlider,
} from "../src/micmic.js";

test("L-mic presets stay inside the bounded feedback design", () => {
  assert.deepEqual(Object.keys(MICMIC_PRESETS), ["tunnel", "bloom", "choir", "fray"]);
  for (const preset of Object.values(MICMIC_PRESETS)) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.depth >= 0 && preset.depth <= MAX_RECURSION_FEEDBACK);
    assert.ok(preset.interval >= MIN_TIME_FOLD_MS && preset.interval <= MAX_TIME_FOLD_MS);
    assert.equal(preset.branching, FIXED_FORK_DENSITY);
    assert.ok(preset.mutation >= 0 && preset.mutation <= 1);
  }
});

test("generation estimates stop when descendants fall below the audible floor", () => {
  assert.equal(estimateGenerations(0), 1);
  assert.equal(estimateGenerations(0.02), 1);
  assert.equal(estimateGenerations(0.5), 5);
  assert.equal(estimateGenerations(0.72), 10);
  assert.ok(estimateGenerations(10) <= 32);
  assert.equal(generationCountForDepth(0.86), 13);
  assert.equal(generationCountForDepth(MAX_RECURSION_FEEDBACK), 13);
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
  assert.ok(clamped.intervalB <= 3 * 1.618 + 1e-12);
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

test("generation rewrite can expand exact audio timing while visually compressing long limbs", () => {
  const topology = generationTopology({
    generations: 3,
    branching: 0,
    timeRatio: 2,
  });
  assert.deepEqual(topology.slice(1).map(({ timeScale }) => timeScale), [2, 4, 8]);
  assert.ok(topology[1].length > 1);
  assert.ok(topology.at(-1).length < 1.3, "visual growth should keep the trunk legible");

  const voices = generationVoiceSpecs({
    generations: 3,
    interval: 500,
    depth: 0.7,
    branching: 0,
    timeRatio: 2,
  });
  assert.deepEqual(voices.map(({ interval }) => interval), [1, 2, 4]);
  assert.deepEqual(voices.map(({ delay }) => delay), [1, 3, 7]);
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
    generations: MAX_GENERATION_STAGES,
    interval: 240,
    depth: 0.86,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
    pruningBias: 1,
  });
  const topologyIds = new Set(generationTopology({
    generations: MAX_GENERATION_STAGES,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
  }).map((node) => node.id));
  assert.ok(voices.length <= MAX_GENERATION_VOICES && voices.length >= 40);
  assert.ok(voices.every((voice) => topologyIds.has(voice.key.replace(/^generation:/, ""))));
  assert.ok(new Set(voices.map((voice) => voice.generation)).size === MAX_GENERATION_STAGES);
  const audibleIds = new Set(voices.map((voice) => voice.key.replace(/^generation:/, "")));
  assert.ok(voices.every((voice) => (
    voice.parentId === "trunk" || audibleIds.has(voice.parentId)
  )), "bounded audio branches must preserve their audible ancestry");
});

test("default L-mic Pythagorean geometry matches the L-system page", () => {
  const preset = L_SYSTEM_PRESETS.find((candidate) => candidate.id === "pythagorean");
  const canonical = traceLSystem(preset);
  const topology = generationTopology({
    generations: 7,
    branching: 1,
    mutation: 0,
    timeRatio: 0.72,
    angle: 45,
    asymmetry: 0,
  });
  const topologyBounds = {
    minX: Math.min(...topology.flatMap((node) => [node.startX, node.x])),
    maxX: Math.max(...topology.flatMap((node) => [node.startX, node.x])),
    minY: Math.min(...topology.flatMap((node) => [node.startY, node.y])),
    maxY: Math.max(...topology.flatMap((node) => [node.startY, node.y])),
  };

  assert.equal(topology.length, 255);
  assert.equal(topology.length, canonical.segments.length);
  for (const key of ["minX", "maxX", "minY", "maxY"]) {
    assert.ok(Math.abs(topologyBounds[key] - canonical.bounds[key]) < 1e-12);
  }
  assert.deepEqual(
    Array.from({ length: 8 }, (_, generation) => (
      topology.filter((node) => node.generation === generation).length
    )),
    [1, 2, 4, 8, 16, 32, 64, 128],
  );
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
    interval: MAX_TIME_FOLD_MS,
    depth: MAX_RECURSION_FEEDBACK,
    branching: 1,
    timeRatio: 1,
    angle: 45,
    maximumVoices: MAX_ADAPTIVE_GENERATION_VOICES,
  });
  assert.equal(Math.max(...topology.map((node) => node.generation)), MAX_GENERATION_STAGES);
  assert.equal(Math.max(...voices.map((voice) => voice.generation)), MAX_GENERATION_STAGES);
  assert.equal(voices.length, 1_022);
  assert.ok(voices.length <= MAX_ADAPTIVE_GENERATION_VOICES);
  assert.ok(Math.max(...voices.map((voice) => voice.delay)) <= 39 + 1e-9);
});

test("adaptive voice limits can admit the complete bounded topology without replacing keys", () => {
  const settings = {
    generations: MAX_GENERATION_STAGES,
    interval: 240,
    depth: 0.8,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
  };
  const plans = [32, MAX_GENERATION_VOICES, 256, MAX_ADAPTIVE_GENERATION_VOICES]
    .map((maximumVoices) => generationVoiceSpecs({ ...settings, maximumVoices }));
  assert.deepEqual(plans.map((voices) => voices.length), [32, 48, 256, 1_022]);
  assert.deepEqual(
    plans.map((voices) => Math.max(...voices.map((voice) => voice.generation))),
    [5, 5, 8, MAX_GENERATION_STAGES],
  );
  for (const voices of plans) {
    const ids = new Set(voices.map((voice) => voice.key.replace(/^generation:/, "")));
    assert.ok(voices.every((voice) => (
      voice.parentId === "trunk" || ids.has(voice.parentId)
    )));
  }
  for (let index = 1; index < plans.length; index += 1) {
    const largerKeys = new Set(plans[index].map(({ key }) => key));
    assert.ok(plans[index - 1].every(({ key }) => largerKeys.has(key)));
  }

  const guarded = generationVoiceSpecs({ ...settings, maximumVoices: 4_096 });
  assert.equal(guarded.length, 1_022);
  assert.ok(guarded.length <= MAX_ADAPTIVE_GENERATION_VOICES);
});

test("pruning strategy continuously blends breadth-first canopy and deep lineages", () => {
  const settings = {
    generations: 7,
    interval: 240,
    depth: 0.72,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
  };
  const plansFor = (pruningBias) => [32, 48, 64].map((maximumVoices) => (
    generationVoiceSpecs({ ...settings, pruningBias, maximumVoices })
  ));
  for (const pruningBias of [0, 0.5, 1]) {
    const plans = plansFor(pruningBias);
    for (const voices of plans) {
      const ids = new Set(voices.map((voice) => voice.key.replace(/^generation:/, "")));
      assert.ok(voices.every((voice) => (
        voice.parentId === "trunk" || ids.has(voice.parentId)
      )));
    }
    for (let index = 1; index < plans.length; index += 1) {
      const largerKeys = new Set(plans[index].map(({ key }) => key));
      assert.ok(plans[index - 1].every(({ key }) => largerKeys.has(key)));
    }
  }

  const breadth = generationVoiceSpecs({
    ...settings,
    pruningBias: 0,
    maximumVoices: 48,
  });
  const depth = generationVoiceSpecs({
    ...settings,
    pruningBias: 1,
    maximumVoices: 48,
  });
  const currentDefault = generationVoiceSpecs({ ...settings, maximumVoices: 48 });
  assert.equal(Math.max(...breadth.map((voice) => voice.generation)), 5);
  assert.equal(Math.max(...depth.map((voice) => voice.generation)), 7);
  assert.deepEqual(currentDefault.map(({ key }) => key), breadth.map(({ key }) => key));
  assert.notDeepEqual(breadth.map(({ key }) => key), depth.map(({ key }) => key));
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

test("plant-named growth presets span the full bounded recursion system", () => {
  const presetNames = Object.keys(GENERATION_RULE_PRESETS);
  const presets = Object.values(GENERATION_RULE_PRESETS);
  assert.ok(presetNames.length >= 16);
  for (const name of [
    "clean", "binary", "pythagorean", "plant", "willow", "ivy", "mangrove",
    "sequoia", "coral", "dragon", "koch", "orchid", "kelp", "moss", "bramble", "venus",
  ]) {
    assert.ok(presetNames.includes(name), `missing ${name} growth preset`);
  }
  for (const preset of presets) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.label.length > 3);
    assert.ok(preset.description.length > 20);
    assert.ok(preset.generations >= 1 && preset.generations <= MAX_GENERATION_STAGES);
    assert.equal(preset.branching, FIXED_FORK_DENSITY);
    assert.ok(preset.depth >= 0 && preset.depth <= MAX_RECURSION_FEEDBACK);
    assert.ok(preset.interval >= MIN_TIME_FOLD_MS && preset.interval <= MAX_TIME_FOLD_MS);
    assert.ok(preset.mutation >= 0 && preset.mutation <= 1);
    assert.ok(preset.timeRatio >= 0.2 && preset.timeRatio <= MAX_CHILD_TIME_RATIO);
    assert.ok(preset.angle >= 0 && preset.angle <= 180);
    assert.ok(preset.asymmetry >= -0.8 && preset.asymmetry <= 0.8);
    assert.ok(preset.pitchScale >= 0 && preset.pitchScale <= 4);
    const voices = generationVoiceSpecs(preset);
    assert.ok(Math.max(0, ...voices.map((voice) => voice.delay)) < 32);
  }
  assert.equal(new Set(presets.map(({ label }) => label)).size, presetNames.length);
  assert.equal(GENERATION_RULE_PRESETS.clean.timeRatio, 1);
  assert.equal(GENERATION_RULE_PRESETS.clean.angle, 0);
  assert.equal(GENERATION_RULE_PRESETS.binary.timeRatio, 0.5);
  assert.equal(GENERATION_RULE_PRESETS.binary.angle, 30);
  assert.equal(GENERATION_RULE_PRESETS.pythagorean.angle, 45);
  assert.equal(GENERATION_RULE_PRESETS.pythagorean.generations, MAX_GENERATION_STAGES);
  assert.equal(GENERATION_RULE_PRESETS.pythagorean.branching, 1);
  assert.equal(GENERATION_RULE_PRESETS.pythagorean.mutation, 0);
  assert.ok(Math.min(...presets.map(({ interval }) => interval)) <= 1);
  assert.equal(
    Math.max(...presets.map(({ interval }) => interval)),
    MAX_TIME_FOLD_MS,
  );
  assert.ok(Math.max(...presets.map(({ angle }) => angle)) >= 110);
  assert.ok(Math.max(...presets.map(({ mutation }) => mutation)) >= 0.74);
});

test("growth presets preserve distinct robotic, rhythmic, spacious, and smooth timing bands", () => {
  const presets = Object.values(GENERATION_RULE_PRESETS);
  const intervals = presets.map(({ interval }) => interval);
  const recursiveTailMs = presets.map((preset) => (
    preset.interval * Array.from(
      { length: preset.generations },
      (_, generation) => preset.timeRatio ** (generation + 1),
    ).reduce((sum, intervalRatio) => sum + intervalRatio, 0)
  ));
  const finalLeafMs = presets.map((preset) => (
    preset.interval * preset.timeRatio ** preset.generations
  ));
  const octaveTurnSpan = presets.map((preset) => (
    (2 * preset.angle / 180) * preset.pitchScale
  ));

  assert.ok(new Set(intervals).size >= 14, "root folds should not cluster on repeated values");
  for (const [label, count] of [
    ["micro", intervals.filter((interval) => interval <= 25).length],
    ["tight", intervals.filter((interval) => interval > 25 && interval <= 125).length],
    ["rhythmic", intervals.filter((interval) => interval > 125 && interval <= 750).length],
    ["long", intervals.filter((interval) => interval > 750).length],
  ]) {
    assert.ok(count >= 2, `${label} timing needs at least two presets`);
  }
  assert.ok(intervals.filter((interval) => interval <= 25).length >= 3);
  assert.ok(recursiveTailMs.filter((tail) => tail >= 2_000).length >= 3);
  assert.ok(Math.max(...recursiveTailMs) < 40_000, "every full tree must fit raw history");
  assert.ok(presets.filter(({ timeRatio }) => timeRatio > 1).length >= 4);
  assert.ok(presets.filter(({ timeRatio }) => timeRatio === 2).length >= 2);
  assert.ok(finalLeafMs.filter((leaf) => leaf >= 75).length >= 2);
  assert.ok(presets.filter(({ mutation }) => mutation >= 0.5).length >= 3);
  assert.ok(presets.filter(({ mutation }) => mutation <= 0.05).length >= 3);
  assert.ok(presets.filter(({ asymmetry }) => Math.abs(asymmetry) >= 0.35).length >= 3);
  assert.ok(octaveTurnSpan.filter((span) => span >= 0.5).length >= 3);
});

test("echo tree layout has stable parent links and a bounded visual width", () => {
  const line = echoTreeLayout(4, 0);
  assert.equal(line.length, 5);
  assert.ok(line.every((node) => node.y === 0));

  const tree = echoTreeLayout(20, 1, 6);
  assert.equal(Math.max(...tree.map((node) => node.generation)), MAX_GENERATION_STAGES);
  const ids = new Set(tree.map((node) => node.id));
  for (const node of tree.slice(1)) assert.ok(ids.has(node.parentId));
  for (let generation = 1; generation <= MAX_GENERATION_STAGES; generation += 1) {
    assert.ok(tree.filter((node) => node.generation === generation).length <= 6);
  }
  const extendedPreview = echoTreeLayout(22, 1, 6, 32);
  assert.equal(Math.max(...extendedPreview.map((node) => node.generation)), 22);
});

test("small helpers normalize values", () => {
  assert.equal(clamp(-2), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(4, 2, 3), 3);
});

test("Time Fold uses integer milliseconds and reserves most travel for 50–1000 ms", () => {
  assert.equal(timeFoldFromSlider(0), MIN_TIME_FOLD_MS);
  assert.equal(timeFoldFromSlider(TIME_FOLD_LOW_SLIDER), TIME_FOLD_LOW_MS);
  assert.equal(timeFoldFromSlider(TIME_FOLD_HIGH_SLIDER), TIME_FOLD_HIGH_MS);
  assert.equal(timeFoldFromSlider(TIME_FOLD_SLIDER_STEPS), MAX_TIME_FOLD_MS);
  for (const milliseconds of [1, 4, 16, 50, 240, 500, 1_000, 1_400, 3_000]) {
    const roundTrip = timeFoldFromSlider(sliderFromTimeFold(milliseconds));
    assert.equal(roundTrip, milliseconds);
  }
  for (let position = 0; position <= TIME_FOLD_SLIDER_STEPS; position += 1) {
    assert.ok(Number.isInteger(timeFoldFromSlider(position)));
  }
  assert.ok(
    TIME_FOLD_HIGH_SLIDER - TIME_FOLD_LOW_SLIDER
      >= TIME_FOLD_SLIDER_STEPS * 0.7,
  );
  const mainDeltas = Array.from(
    { length: TIME_FOLD_HIGH_SLIDER - TIME_FOLD_LOW_SLIDER },
    (_, index) => (
      timeFoldFromSlider(TIME_FOLD_LOW_SLIDER + index + 1)
      - timeFoldFromSlider(TIME_FOLD_LOW_SLIDER + index)
    ),
  );
  assert.ok(Math.min(...mainDeltas) >= 1);
  assert.ok(Math.max(...mainDeltas) <= 2);
  assert.equal(
    timeFoldFromSlider(TIME_FOLD_SLIDER_STEPS)
      - timeFoldFromSlider(TIME_FOLD_SLIDER_STEPS - 1),
    20,
  );
  assert.equal(sliderFromTimeFold(240), 300);
});

test("Time Fold and Child Time Ratio stay independent at the history boundary", () => {
  assert.equal(
    generationTailSeconds({ interval: 1, generations: 13, timeRatio: 2 }),
    16.382,
  );
  assert.ok(generationTailSeconds({
    interval: MAX_TIME_FOLD_MS,
    generations: MAX_GENERATION_STAGES,
    timeRatio: MAX_CHILD_TIME_RATIO,
  }) > MAX_GENERATION_DELAY_SECONDS);
  const literalButHistoryBounded = generationVoiceSpecs({
    generations: MAX_GENERATION_STAGES,
    interval: MAX_TIME_FOLD_MS,
    branching: 1,
    timeRatio: MAX_CHILD_TIME_RATIO,
    maximumVoices: MAX_ADAPTIVE_GENERATION_VOICES,
  });
  assert.equal(literalButHistoryBounded.length, 6);
  assert.equal(
    Math.max(...literalButHistoryBounded.map(({ generation }) => generation)),
    2,
  );
  assert.deepEqual(
    [...new Set(literalButHistoryBounded.map(({ interval }) => interval))],
    [6, 12],
  );
  assert.equal(
    Math.max(...literalButHistoryBounded.map(({ delay }) => delay)),
    18,
  );
});
