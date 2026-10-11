import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spartialRecordingRuntimeChanges, restoreSpartialRecordingRuntime } from './helpers/spartial-recording-runtime-reference.mjs';
import { fractalMotionRuntimeChanges, restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { midiMixerRuntimeChanges, restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { vectorFractalsSiteChanges, restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const change = spartialRecordingRuntimeChanges;
const url = new URL(`../${change.file}`, import.meta.url);
const historical = [
  [fractalMotionRuntimeChanges, restoreFractalMotionRuntime],
  [midiMixerRuntimeChanges, restoreMidiMixerRuntime],
  [vectorFractalsSiteChanges, restoreVectorFractalsSite],
];

test('recording runtime rows restore captured main and preserve historical manifest hashes', async () => {
  assert.equal(change.baseCommit, '25d3ed91024a64dc5803337c993d1133a79f890f');
  assert.equal(change.file, 'scripts/site/runtime-files.tsv');
  assert.deepEqual(change.additions, [
    'copy+require\tsrc/instruments/spartial/spartial-recording.js\n',
    'copy+require\tsrc/instruments/spartial/spartial-recording-export.js\n',
  ]);
  const source = await readFile(url, 'utf8');
  const restored = restoreSpartialRecordingRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restoreSpartialRecordingRuntime(restored, change.file, { allowRestored: true }), restored);
  for (const [fixture, normalize] of historical) {
    assert.equal(normalize(source, change.file), normalize(restored, change.file));
    assert.equal(digest(normalize(source, change.file)), fixture.changes.find(item => item.file === change.file).sha256);
  }
});

test('recording runtime guards reject missing, duplicate, partial, altered, and misplaced rows', async () => {
  const source = await readFile(url, 'utf8');
  const error = /exact SPARTIAL recording runtime addition/;
  const restored = restoreSpartialRecordingRuntime(source, change.file);
  assert.throws(() => restoreSpartialRecordingRuntime(restored, change.file), error);
  for (const row of change.additions) {
    for (const options of [{}, { allowRestored: true }]) {
      for (const malformed of [
        source.replace(row, ''), source + row,
        source.replace(row, row.replace('copy+require', 'copy')),
        source.replace(row, '') + row,
      ]) assert.throws(() => restoreSpartialRecordingRuntime(malformed, change.file, options), error);
    }
  }
  const tampered = source.replaceAll('spartial-recording', 'unreviewed-recording');
  assert.throws(() => restoreSpartialRecordingRuntime(tampered, change.file), error);
  assert.equal(restoreSpartialRecordingRuntime(tampered, change.file, { allowRestored: true }), tampered);
  for (const [fixture, normalize] of historical) {
    assert.notEqual(digest(normalize(tampered, change.file)), fixture.changes.find(item => item.file === change.file).sha256);
  }
});

test('recording normalization retains unrelated rows, unknown additions, and binary data', async () => {
  const source = await readFile(url, 'utf8');
  for (const suffix of ['\n# unrelated drift\n', 'copy+require\tsrc/instruments/spartial/unreviewed.js\n']) {
    const restored = restoreSpartialRecordingRuntime(source + suffix, change.file);
    assert.ok(restored.endsWith(suffix));
    assert.notEqual(digest(restored), change.sha256);
    for (const [fixture, normalize] of historical) {
      assert.notEqual(digest(normalize(source + suffix, change.file)), fixture.changes.find(item => item.file === change.file).sha256);
    }
  }
  const binary = await readFile(url);
  assert.equal(restoreSpartialRecordingRuntime(binary, change.file), binary);
  assert.equal(restoreSpartialRecordingRuntime(source, 'unrelated.js'), source);
});
