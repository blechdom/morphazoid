import test from "node:test";
import assert from "node:assert/strict";
import { SEQUENCER_VOICES } from "../src/sequencer-voices.js";
import { sanitizeSortSequencerParams, generateSortSequence } from "../src/families/algorithmic-sequencers/algorithmic-sequencers.js";
import { ALGORITHMIC_INSTRUMENTS, sanitizeAlgorithmicScoreParams, generateAlgorithmicScore } from "../src/families/algorithmic-scores/algorithmic-scores.js";
import { algorithmicFullPresets, randomizeAlgorithmicPreset } from "../src/families/algorithmic-scores/full-presets.js";

test("every shared engine is accepted without changing sorting events", () => {
  const original = generateSortSequence({ size: 8, dataSeed: 123 });
  for (const { id } of SEQUENCER_VOICES) {
    const settings = sanitizeSortSequencerParams({ size: 8, dataSeed: 123, voice: id });
    assert.equal(settings.voice, id);
    assert.deepEqual(generateSortSequence(settings).steps, original.steps);
  }
  assert.equal(sanitizeSortSequencerParams({ voice: "missing" }).voice, "original");
});

test("all five algorithmic instruments retain score structure across engine changes", () => {
  for (const instrument of ALGORITHMIC_INSTRUMENTS) {
    const native = { ...instrument.defaults, complexity: 2, seed: 123 };
    const original = generateAlgorithmicScore(native);
    for (const { id } of SEQUENCER_VOICES) {
      const settings = sanitizeAlgorithmicScoreParams({ ...native, voice: id });
      assert.equal(settings.voice, id);
      assert.deepEqual(generateAlgorithmicScore(settings).events, original.events);
    }
    for (const preset of algorithmicFullPresets(instrument.id)) {
      assert.equal(preset.snapshot.settings.voice, "original");
    }
  }
  assert.equal(sanitizeAlgorithmicScoreParams({ voice: "missing" }).voice, "original");
});

test("algorithmic full-state randomization includes voice and preserves output", () => {
  const current = { settings: sanitizeAlgorithmicScoreParams({ output: .21, algorithmId: "hanoi" }) };
  const seen = new Set();
  for (let i = 0; i < 120; i += 1) {
    let seed = i + 1;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const result = randomizeAlgorithmicPreset(current, random);
    assert.equal(result.settings.output, .21);
    assert.equal(result.settings.algorithmId, "hanoi");
    seen.add(result.settings.voice);
  }
  assert.equal(seen.size, SEQUENCER_VOICES.length + 1);
});
