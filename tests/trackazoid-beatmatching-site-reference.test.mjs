import { restoreBlechLiveRuntime } from './helpers/blech-live-runtime-reference.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { restoreTrackazoidBeatmatchingSite, trackazoidBeatmatchingChanges } from './helpers/trackazoid-beatmatching-site-reference.mjs';
import { restoreMidiNoteEffectsRuntime } from './helpers/midi-note-effects-runtime-reference.mjs';
import { restoreSoundFontsSite } from './helpers/sound-fonts-site-reference.mjs';
import { restoreSpartialOrganRuntime } from './helpers/spartial-organ-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const read = async file => {
  let source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const normalize of [restoreBlechLiveRuntime, restoreMidiNoteEffectsRuntime, restoreSoundFontsSite, restoreSpartialOrganRuntime]) {
    source = normalize(source, file, { allowRestored: true });
  }
  return source;
};

test('beatmatching restores the published Trackazoid MVP without removing its registration', async () => {
  assert.equal(trackazoidBeatmatchingChanges.baseCommit, 'cedaf28dca962b0af0a885b7d301dc7211517ecd');
  assert.deepEqual(trackazoidBeatmatchingChanges.changes.map(change => change.file), [
    'scripts/site/runtime-files.tsv', 'README.md', 'src/site/instrument-catalog.js',
  ]);
  for (const change of trackazoidBeatmatchingChanges.changes) {
    const source = await read(change.file);
    const restored = restoreTrackazoidBeatmatchingSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.ok(restored.includes(change.before), 'the original Trackazoid remains');
    assert.equal(restoreTrackazoidBeatmatchingSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreTrackazoidBeatmatchingSite(restored, change.file), /exact Trackazoid beatmatching/);
  }
});

test('beatmatching guards reject missing, duplicate, partial, altered and misplaced amendments', async () => {
  for (const change of trackazoidBeatmatchingChanges.changes) {
    const source = await read(change.file), error = /exact Trackazoid beatmatching/;
    for (const marker of change.markers) for (const options of [{}, { allowRestored: true }]) {
      for (const malformed of [source.replace(marker, ''), source + marker,
        source.replace(marker, marker.replace(/\S/, '?')),
        marker + source.replace(marker, '')]) {
        assert.notEqual(malformed, source);
        assert.throws(() => restoreTrackazoidBeatmatchingSite(malformed, change.file, options), error);
      }
    }
    const tampered = change.markers.reduce((text, marker) => text.replace(marker, marker.replace(/\S/, '?')), source);
    assert.throws(() => restoreTrackazoidBeatmatchingSite(tampered, change.file), error);
    // Whole-block tampering stays visible to the original hash even if every
    // recognition marker is absent; partial recognized amendments are rejected.
    assert.equal(restoreTrackazoidBeatmatchingSite(tampered, change.file, { allowRestored: true }), tampered);
    assert.notEqual(digest(tampered), change.sha256);
  }
});

test('beatmatching restoration preserves unrelated drift, unknown rows and binary identity', async () => {
  for (const change of trackazoidBeatmatchingChanges.changes) {
    const source = await read(change.file), suffix = '\n// unrelated drift\n';
    const restored = restoreTrackazoidBeatmatchingSite(source + suffix, change.file);
    assert.ok(restored.endsWith(suffix)); assert.notEqual(digest(restored), change.sha256);
    const bytes = Buffer.from(source);
    assert.equal(restoreTrackazoidBeatmatchingSite(bytes, change.file), bytes);
    assert.equal(restoreTrackazoidBeatmatchingSite(source, 'unrelated.js'), source);
  }
  const file = 'scripts/site/runtime-files.tsv', suffix = 'copy+require\tsrc/instruments/trackazoid/unreviewed.js\n';
  assert.ok(restoreTrackazoidBeatmatchingSite(await read(file) + suffix, file).endsWith(suffix));
});
