import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SEARCH_ALGORITHM_PRESETS,
  SEARCH_DATA_CURVES,
  SONIFIABLE_ALGORITHM_CANDIDATES,
  createSearchArray,
  deriveSearchStepTone,
  generateSearchSequence,
  sanitizeSearchSequencerParams,
} from "../src/algorithmic-sequencers.js";

test("search algorithm sequencer exposes the first demo set and future candidates", () => {
  assert.deepEqual(
    SEARCH_ALGORITHM_PRESETS.map(({ id }) => id),
    ["linear", "binary", "jump", "interpolation", "exponential"],
  );
  assert.deepEqual(
    SEARCH_DATA_CURVES.map(({ id }) => id),
    ["linear", "clustered", "sine-bend", "random"],
  );
  assert.deepEqual(
    SONIFIABLE_ALGORITHM_CANDIDATES.map(({ family }) => family),
    ["Search", "Sorting", "Graphs", "Recursive / Constraint"],
  );
  assert.ok(
    SONIFIABLE_ALGORITHM_CANDIDATES
      .flatMap(({ algorithms }) => algorithms)
      .includes("Boyer-Moore / KMP string search"),
  );
});

test("random value fields are reproducible by seed and change with a new seed", () => {
  const first = createSearchArray(64, "random", 1234);
  const repeated = createSearchArray(64, "random", 1234);
  const changed = createSearchArray(64, "random", 5678);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, changed);
  assert.equal(first[0], 0);
  assert.equal(first.at(-1), 1);
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(first[index] > first[index - 1]);
  }
});

test("generated value fields stay sorted for every curve", () => {
  for (const curve of SEARCH_DATA_CURVES) {
    const values = createSearchArray(64, curve.id);
    assert.equal(values.length, 64);
    assert.equal(values[0], 0);
    assert.equal(values.at(-1), 1);
    for (let index = 1; index < values.length; index += 1) {
      assert.ok(values[index] > values[index - 1], `${curve.id} must stay strictly increasing`);
    }
    assert.ok(Object.isFrozen(values));
  }
});

test("each search algorithm finds first, middle, and final targets on each data curve", () => {
  for (const algorithm of SEARCH_ALGORITHM_PRESETS) {
    for (const curve of SEARCH_DATA_CURVES) {
      for (const targetIndex of [0, 31, 63]) {
        const sequence = generateSearchSequence({
          algorithmId: algorithm.id,
          curveId: curve.id,
          size: 64,
          targetIndex,
        });
        assert.equal(sequence.algorithm.id, algorithm.id);
        assert.equal(sequence.curve.id, curve.id);
        assert.ok(sequence.steps.length > 0, `${algorithm.id} should emit probes`);
        const found = sequence.steps[sequence.foundStepIndex];
        assert.ok(found, `${algorithm.id} should find ${targetIndex} on ${curve.id}`);
        assert.equal(found.found, true);
        assert.equal(found.index, targetIndex);
        assert.equal(found.compare, "eq");
        assert.equal(found.value, sequence.targetValue);
        assert.ok(Object.isFrozen(sequence.steps));
      }
    }
  }
});

test("binary and linear traces reveal different sonification rhythms", () => {
  const linear = generateSearchSequence({
    algorithmId: "linear",
    size: 32,
    targetIndex: 24,
  });
  const binary = generateSearchSequence({
    algorithmId: "binary",
    size: 32,
    targetIndex: 24,
  });

  assert.equal(linear.steps.at(-1).index, 24);
  assert.deepEqual(
    linear.steps.slice(0, 5).map(({ index }) => index),
    [0, 1, 2, 3, 4],
  );
  assert.ok(binary.steps.length < linear.steps.length);
  assert.ok(
    binary.steps.every((step, index, steps) => (
      index === 0 || step.rangeWidth <= steps[index - 1].rangeWidth
    )),
  );
});

test("tone derivation maps value, target, and index into bounded audio parameters", () => {
  const sequence = generateSearchSequence({
    algorithmId: "interpolation",
    curveId: "clustered",
    size: 48,
    targetIndex: 37,
    baseFrequencyHz: 220,
    pitchSpanOctaves: 4,
    noteSeconds: 0.1,
  });
  const tone = deriveSearchStepTone(sequence.steps[0], sequence.settings);
  const hitTone = deriveSearchStepTone(sequence.steps[sequence.foundStepIndex], sequence.settings);

  assert.ok(tone.frequencyHz >= 80);
  assert.ok(tone.frequencyHz <= 18_000);
  assert.ok(tone.targetFrequencyHz >= 80);
  assert.ok(tone.targetFrequencyHz <= 18_000);
  assert.ok(tone.pan >= -1 && tone.pan <= 1);
  assert.ok(hitTone.gain > tone.gain);
  assert.ok(hitTone.durationSeconds > tone.durationSeconds);
});

test("sanitizer bounds hostile sequencer parameters", () => {
  const safe = sanitizeSearchSequencerParams({
    algorithmId: "bogus",
    curveId: "nope",
    size: 999,
    targetIndex: 999,
    tempo: -4,
    baseFrequencyHz: 99_999,
    pitchSpanOctaves: -1,
    noteSeconds: 9,
    output: 9,
  });
  assert.equal(safe.algorithmId, "binary");
  assert.equal(safe.curveId, "linear");
  assert.equal(safe.dataSeed, 0x5eed1234);
  assert.equal(safe.size, 128);
  assert.equal(safe.targetIndex, 127);
  assert.equal(safe.tempo, 0.5);
  assert.equal(safe.baseFrequencyHz, 880);
  assert.equal(safe.pitchSpanOctaves, 0.5);
  assert.equal(safe.noteSeconds, 0.42);
  assert.equal(safe.output, 0.82);
  assert.ok(Object.isFrozen(safe));
});

test("Algorithmic Sequencers page is native and references the local app", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../algorithmic-sequencers.html", import.meta.url), "utf8"),
    readFile(new URL("../algorithmic-sequencers-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<h1[^>]*>Algorithmic Sequencers<\/h1>/);
  assert.match(html, /Search Algorithms/);
  assert.match(html, /Linear Sweep[\s\S]*Binary Partition[\s\S]*Exponential Gate/);
  assert.match(html, /id="randomInput"[\s\S]*Randomize input/);
  assert.match(html, /data-curve="random"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="algorithmic-sequencers-app\.js"><\/script>/);
  assert.match(app, /\.\/src\/algorithmic-sequencers\.js/);
  assert.match(app, /audioState/);
  assert.doesNotMatch(html, /https?:\/\//i);
});
