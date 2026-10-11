import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Peel later Trackazoid/Sound Fonts registrations before checking the original
// organ baseline, while retaining the organ rows for their own strict guards.
import { readTrackazoidSiteReference as readFile } from './helpers/trackazoid-site-reference.mjs';
import test from 'node:test';
import { spartialOrganRuntimeChanges, restoreSpartialOrganRuntime } from './helpers/spartial-organ-runtime-reference.mjs';
import { blechMidiSiteChanges, restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { spartialRecordingRuntimeChanges, restoreSpartialRecordingRuntime } from './helpers/spartial-recording-runtime-reference.mjs';
import { fractalMotionRuntimeChanges, restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { midiMixerRuntimeChanges, restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { vectorFractalsSiteChanges, restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const change = spartialOrganRuntimeChanges;
const file = change.file;
const url = new URL(`../${file}`, import.meta.url);
const historical = [
  [blechMidiSiteChanges.changes.find(item => item.file === file).sha256,
    source => restoreSpartialRecordingRuntime(restoreBlechMidiSite(source, file), file)],
  [spartialRecordingRuntimeChanges.sha256,
    source => restoreBlechMidiSite(restoreSpartialRecordingRuntime(source, file), file)],
  ...[
    [fractalMotionRuntimeChanges, restoreFractalMotionRuntime],
    [midiMixerRuntimeChanges, restoreMidiMixerRuntime],
    [vectorFractalsSiteChanges, restoreVectorFractalsSite],
  ].map(([fixture, normalize]) => [fixture.changes.find(item => item.file === file).sha256, source => normalize(source, file)]),
];

test('organ packaging restores captured main and preserves Blech, recording, and older manifest hashes', async () => {
  assert.equal(change.baseCommit, 'a7c885bfb45f24014523220c546fe76c03c39ca5');
  assert.equal(file, 'scripts/site/runtime-files.tsv');
  assert.deepEqual(change.replacements.map(item => item.addition), [
    'copy+require\tsrc/instruments/spartial/spartial-organ.js\n',
    'copy+require\tdocs/spartial-organ-research.md\n',
  ]);
  const source = await readFile(url, 'utf8');
  const restored = restoreSpartialOrganRuntime(source, file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restoreSpartialOrganRuntime(restored, file, { allowRestored: true }), restored);
  for (const [hash, normalize] of historical) {
    assert.equal(normalize(source), normalize(restored));
    assert.equal(digest(normalize(source)), hash);
  }
});

test('organ packaging rejects missing, duplicate, partial, altered, and misplaced additions', async () => {
  const source = await readFile(url, 'utf8');
  const error = /exact SPARTIAL organ runtime addition/;
  const restored = restoreSpartialOrganRuntime(source, file);
  assert.throws(() => restoreSpartialOrganRuntime(restored, file), error);
  for (const { addition, before } of change.replacements) {
    for (const options of [{}, { allowRestored: true }]) {
      for (const malformed of [
        source.replace(addition, ''), source + addition,
        source.replace(addition, addition.replace('copy+require', 'copy')),
        source.replace(addition, '') + addition, source.replace(before, ''),
      ]) assert.throws(() => restoreSpartialOrganRuntime(malformed, file, options), error);
    }
  }
  const tampered = source.replaceAll('spartial-organ', 'unreviewed-organ');
  assert.throws(() => restoreSpartialOrganRuntime(tampered, file), error);
  assert.equal(restoreSpartialOrganRuntime(tampered, file, { allowRestored: true }), tampered);
  for (const [hash, normalize] of historical) assert.notEqual(digest(normalize(tampered)), hash);
});

test('organ normalization retains unknown runtime rows, unrelated drift, and binary data', async () => {
  const source = await readFile(url, 'utf8');
  for (const suffix of ['\n# unrelated drift\n', 'copy+require\tsrc/instruments/spartial/unreviewed.js\n']) {
    const restored = restoreSpartialOrganRuntime(source + suffix, file);
    assert.ok(restored.endsWith(suffix));
    assert.notEqual(digest(restored), change.sha256);
    for (const [hash, normalize] of historical) assert.notEqual(digest(normalize(source + suffix)), hash);
  }
  const binary = await readFile(url);
  assert.equal(restoreSpartialOrganRuntime(binary, file), binary);
  assert.equal(restoreBlechMidiSite(binary, file), binary);
  assert.equal(restoreSpartialOrganRuntime(source, 'unrelated.js'), source);
});
