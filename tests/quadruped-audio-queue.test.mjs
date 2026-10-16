import test from 'node:test';
import assert from 'node:assert/strict';
import { readMicInputBatchSiteReference as readFile } from './helpers/mic-input-batch-site-reference.mjs';
import { quadrupedAudioQueueRuntimeRow, restoreQuadrupedAudioQueueRuntime } from './helpers/quadruped-audio-queue-runtime-reference.mjs';
import { QUADRUPED_AUDIO_COHORT_SECONDS, quadrupedAudioBucket, quadrupedAudioCutover, quadrupedAudioHorizon, groupQuadrupedContactOnsets } from '../src/instruments/quadruped/quadruped-audio-queue.js';

test('edit boundaries partition onsets without cutting any retained cohort', () => {
  for (let i = 0; i < 1200; i++) {
    const now = i * .00137;
    const cutoff = quadrupedAudioCutover(now);
    assert.ok(cutoff - now >= .008 - 1e-9 && cutoff - now <= .048 + 1e-9);
    const events = Array.from({length: 80}, (_, j) => ({when: now + j * .0031}));
    const cohorts = groupQuadrupedContactOnsets(events.reverse());
    assert.equal(cohorts.flat().length, events.length);
    for (const cohort of cohorts) {
      assert.ok(cohort.every(event => event.when < cutoff + 1e-9) || cohort.every(event => event.when >= cutoff - 1e-9));
      assert.ok(Math.max(...cohort.map(e => e.when)) - Math.min(...cohort.map(e => e.when)) < QUADRUPED_AUDIO_COHORT_SECONDS);
    }
    const horizon = quadrupedAudioHorizon(now, .24);
    assert.ok(horizon - now > .20 - 1e-9 && horizon - now <= .24 + 1e-9);
    assert.equal(quadrupedAudioBucket(cutoff), cutoff);
  }
});

test('exact boundaries and floating point equivalents belong to the next cohort', () => {
  for (let index = 1; index < 2000; index++) {
    const edge = index * .04;
    const cohorts = groupQuadrupedContactOnsets([{when: edge - .00001}, {when: edge}, {when: index / 25}]);
    assert.deepEqual(cohorts.map(c => c.length), [1,2]);
  }
});

test('queue packaging preserves unknown bytes and rejects missing or duplicate additions', async () => {
  const file = 'scripts/site/runtime-files.tsv';
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const row = quadrupedAudioQueueRuntimeRow;
  const restored = restoreQuadrupedAudioQueueRuntime(source, file);
  assert.equal(source.split(row).length - 1, 1);
  assert.equal(restored, source.replace(row, ''));
  assert.equal(restoreQuadrupedAudioQueueRuntime(restored, file, { allowRestored: true }), restored);
  assert.throws(() => restoreQuadrupedAudioQueueRuntime(restored, file), /exact Quadruped/);
  for (const allowRestored of [false, true]) {
    assert.throws(() => restoreQuadrupedAudioQueueRuntime(source + row, file, { allowRestored }), /exact Quadruped/);
  }
  const drift = 'copy+require\tsrc/instruments/quadruped/unreviewed.js\n';
  assert.equal(restoreQuadrupedAudioQueueRuntime(source + drift, file), restored + drift);
  const tampered = source.replace(row, drift);
  assert.throws(() => restoreQuadrupedAudioQueueRuntime(tampered, file), /exact Quadruped/);
  assert.equal(restoreQuadrupedAudioQueueRuntime(tampered, file, { allowRestored: true }), tampered);
  assert.equal(restoreQuadrupedAudioQueueRuntime(source, 'unrelated.js'), source);
  const binary = Buffer.from(source);
  assert.equal(restoreQuadrupedAudioQueueRuntime(binary, file), binary);
});
