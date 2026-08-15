import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NEXT_ALGORITHM_TRIALS,
  SORT_ALGORITHM_PRESETS,
  SONIFIABLE_ALGORITHM_CANDIDATES,
  createOrderedSortValues,
  deriveSortStepTone,
  generateSortSequence,
  sanitizeSortSequencerParams,
  shuffleSortValues,
} from "../src/algorithmic-sequencers.js";

test("sorting sequencer exposes the first demo set and future candidates", () => {
  assert.deepEqual(
    SORT_ALGORITHM_PRESETS.map(({ id }) => id),
    ["bubble", "insertion", "selection", "merge", "quick"],
  );
  assert.deepEqual(
    SONIFIABLE_ALGORITHM_CANDIDATES.map(({ family }) => family),
    ["Sorting", "Search", "Graphs", "Recursive / Constraint"],
  );
  assert.ok(
    SONIFIABLE_ALGORITHM_CANDIDATES
      .flatMap(({ algorithms }) => algorithms)
      .includes("Boyer-Moore / KMP string search"),
  );
  assert.deepEqual(
    NEXT_ALGORITHM_TRIALS.map(({ id }) => id),
    ["dijkstra", "hanoi", "minimax", "nqueens", "euclid"],
  );
  assert.deepEqual(
    NEXT_ALGORITHM_TRIALS.map(({ href }) => href),
    ["dijkstra.html", "hanoi.html", "minimax.html", "nqueens.html", "euclid.html"],
  );
  assert.equal(new Set(NEXT_ALGORITHM_TRIALS.map(({ family }) => family)).size, 5);
  assert.ok(NEXT_ALGORITHM_TRIALS.every(({ label }) => !/sort/i.test(label)));
});

test("randomization shuffles one fixed ordered value set reproducibly", () => {
  const ordered = createOrderedSortValues(64);
  const first = shuffleSortValues(64, 1234);
  const repeated = shuffleSortValues(64, 1234);
  const changed = shuffleSortValues(64, 5678);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, changed);
  assert.notDeepEqual(first, ordered);
  assert.deepEqual([...first].sort((left, right) => left - right), ordered);
  assert.ok(Object.isFrozen(first));
});

test("every sorting algorithm restores the same ordered values", () => {
  for (const algorithm of SORT_ALGORITHM_PRESETS) {
    for (const dataSeed of [1, 1234, 0xffff_fffe]) {
      const sequence = generateSortSequence({
        algorithmId: algorithm.id,
        dataSeed,
        size: 32,
      });
      assert.equal(sequence.algorithm.id, algorithm.id);
      assert.notDeepEqual(sequence.initialValues, createOrderedSortValues(32));
      assert.deepEqual(sequence.finalValues, createOrderedSortValues(32));
      assert.equal(sequence.steps.at(-1).operation, "complete");
      assert.ok(sequence.steps.length > 1, `${algorithm.id} should emit sorting events`);
      assert.ok(sequence.comparisons > 0, `${algorithm.id} should compare values`);
      assert.ok(Object.isFrozen(sequence.steps));
    }
  }
});

test("sorting traces expose algorithm-specific operations", () => {
  const bubble = generateSortSequence({ algorithmId: "bubble", size: 24, dataSeed: 42 });
  const merge = generateSortSequence({ algorithmId: "merge", size: 24, dataSeed: 42 });
  const quick = generateSortSequence({ algorithmId: "quick", size: 24, dataSeed: 42 });

  assert.ok(
    bubble.steps
      .filter(({ comparison }) => comparison)
      .every((step) => Math.abs(step.leftIndex - step.rightIndex) === 1),
  );
  assert.ok(merge.steps.some(({ operation }) => operation === "write"));
  assert.ok(quick.steps.some(({ operation }) => operation === "pivot"));
  assert.notEqual(bubble.comparisons, quick.comparisons);
});

test("tone derivation maps both active values and indices into bounded audio parameters", () => {
  const sequence = generateSortSequence({
    algorithmId: "quick",
    dataSeed: 88,
    size: 48,
    baseFrequencyHz: 220,
    pitchSpanOctaves: 4,
    noteSeconds: 0.06,
  });
  const comparison = sequence.steps.find((step) => step.comparison);
  const complete = sequence.steps.at(-1);
  const tone = deriveSortStepTone(comparison, sequence.settings);
  const completeTone = deriveSortStepTone(complete, sequence.settings);

  assert.ok(tone.frequencyHz >= 80 && tone.frequencyHz <= 18_000);
  assert.ok(tone.partnerFrequencyHz >= 80 && tone.partnerFrequencyHz <= 18_000);
  assert.ok(tone.leftPan >= -1 && tone.leftPan <= 1);
  assert.ok(tone.rightPan >= -1 && tone.rightPan <= 1);
  assert.ok(completeTone.gain > tone.gain);
  assert.ok(completeTone.durationSeconds > tone.durationSeconds);
});

test("sanitizer bounds hostile sorting parameters", () => {
  const safe = sanitizeSortSequencerParams({
    algorithmId: "bogus",
    dataSeed: 0,
    size: 999,
    tempo: -4,
    baseFrequencyHz: 99_999,
    pitchSpanOctaves: -1,
    noteSeconds: 9,
    output: 9,
  });
  assert.equal(safe.algorithmId, "quick");
  assert.equal(safe.dataSeed, 0x5eed1234);
  assert.equal(safe.size, 128);
  assert.equal(safe.tempo, 0.5);
  assert.equal(safe.baseFrequencyHz, 880);
  assert.equal(safe.pitchSpanOctaves, 0.5);
  assert.equal(safe.noteSeconds, 0.32);
  assert.equal(safe.output, 0.82);
  assert.ok(Object.isFrozen(safe));
});

test("Algorithmic Sequencers presents randomize first and runs local sorting demos", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../algorithmic-sequencers.html", import.meta.url), "utf8"),
    readFile(new URL("../algorithmic-sequencers-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<h1[^>]*>Algorithmic Sequencers<\/h1>/);
  assert.match(html, /Sorting Algorithms/);
  assert.match(html, /Bubble Sort[\s\S]*Insertion Sort[\s\S]*Quick Sort/);
  assert.match(html, /Five built scores[\s\S]*DJ Dijkstra[\s\S]*Euclidean Pulse/);
  assert.match(html, /href="dijkstra\.html"/);
  assert.match(html, /id="randomInput"[^>]*>Randomize order<\/button>/);
  assert.ok(html.indexOf('id="randomInput"') < html.indexOf('id="presetButtons"'));
  assert.doesNotMatch(html, /targetIndex|data-curve="random"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="algorithmic-sequencers-app\.js"><\/script>/);
  assert.match(app, /generateSortSequence/);
  assert.match(app, /dataSeed: createRandomDataSeed\(\)/);
  assert.doesNotMatch(html, /https?:\/\//i);
});
