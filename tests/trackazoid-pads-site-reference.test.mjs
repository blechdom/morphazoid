import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { restoreTrackazoidPadsSite, trackazoidPadsChanges } from './helpers/trackazoid-pads-site-reference.mjs';
import { readFractalImpulseRuntimeReference, restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidBeatmatchingSite, trackazoidBeatmatchingChanges } from './helpers/trackazoid-beatmatching-site-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('pad and demo amendments restore exact captured main bytes without rewriting historical fixtures', async () => {
  assert.equal(trackazoidPadsChanges.baseCommit, '98bdd239757195367921d30c57e7457238ec8f87');
  assert.deepEqual(trackazoidPadsChanges.changes.map(change => change.file), ['scripts/site/runtime-files.tsv', 'README.md']);
  for (const change of trackazoidPadsChanges.changes) {
    const source = restoreBlackMidiArtRuntime(await read(change.file), change.file);
    const restored = restoreTrackazoidPadsSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.ok(restored.includes(change.before));
    assert.equal(restoreTrackazoidPadsSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreTrackazoidPadsSite(restored, change.file), /exact Trackazoid pads/);
  }
});

test('pad amendment guards reject missing, altered, duplicate, partial and misplaced reviewed bytes', async () => {
  for (const change of trackazoidPadsChanges.changes) {
    const source = await read(change.file), error = /exact Trackazoid pads/;
    for (const marker of change.markers) {
      for (const malformed of [source.replace(marker, ''), source.replace(marker, marker.replace(/\S/, '?'))]) {
        assert.throws(() => restoreTrackazoidPadsSite(malformed, change.file), error);
      }
      for (const options of [{}, { allowRestored: true }]) {
        for (const malformed of [source + marker, marker + source.replace(marker, '')]) {
          assert.notEqual(malformed, source);
          assert.throws(() => restoreTrackazoidPadsSite(malformed, change.file, options), error);
        }
        if (change.markers.length > 1) {
          assert.throws(() => restoreTrackazoidPadsSite(source.replace(marker, ''), change.file, options), error);
          assert.throws(() => restoreTrackazoidPadsSite(source.replace(marker, marker.replace(/\S/, '?')), change.file, options), error);
        }
      }
    }
    const tampered = change.markers.reduce((text, marker) => text.replace(marker, marker.replace(/\S/, '?')), source);
    assert.throws(() => restoreTrackazoidPadsSite(tampered, change.file), error);
    assert.equal(restoreTrackazoidPadsSite(tampered, change.file, { allowRestored: true }), tampered);
    assert.notEqual(digest(tampered), change.sha256, 'unrecognized alteration stays visible to the older hash guard');
    const contextChange = source.replace(change.after, change.after.replace(/\S/, '?'));
    assert.throws(() => restoreTrackazoidPadsSite(contextChange, change.file, { allowRestored: true }), error);
  }
});

test('pad normalization leaves unrelated edits, unknown runtime additions and non-text data visible', async () => {
  for (const change of trackazoidPadsChanges.changes) {
    const source = await read(change.file), drift = '\n// unrelated drift\n';
    const restored = restoreTrackazoidPadsSite(source + drift, change.file);
    assert.ok(restored.endsWith(drift)); assert.notEqual(digest(restored), change.sha256);
    const binary = Buffer.from(source);
    assert.equal(restoreTrackazoidPadsSite(binary, change.file), binary);
    assert.equal(restoreTrackazoidPadsSite(source, 'unrelated.js'), source);
  }
  const file = 'scripts/site/runtime-files.tsv';
  const unknown = 'copy+require\tsrc/instruments/trackazoid/unreviewed-demo.js\n';
  const restored = restoreTrackazoidPadsSite(await read(file) + unknown, file);
  assert.ok(restored.endsWith(unknown));
  assert.notEqual(digest(restored), trackazoidPadsChanges.changes[0].sha256);
});

test('shared historical reading peels this addition without weakening the old beatmatching guards', async () => {
  for (const change of trackazoidPadsChanges.changes) {
    const source = await read(change.file);
    const historical = await readFractalImpulseRuntimeReference(new URL(`../${change.file}`, import.meta.url), 'utf8');
    assert.equal(historical, restoreFractalImpulseRuntime(restoreTrackazoidPadsSite(source, change.file), change.file));
    assert.equal(restoreTrackazoidSite(source, change.file), restoreTrackazoidSite(restoreTrackazoidPadsSite(source, change.file), change.file),
      'direct historical normalization peels pads before removing their older registration context');
    const previous = trackazoidBeatmatchingChanges.changes.find(candidate => candidate.file === change.file);
    assert.ok(historical.includes(previous.after));
    for (const marker of previous.markers) for (const options of [{}, { allowRestored: true }]) {
      assert.throws(() => restoreTrackazoidBeatmatchingSite(historical.replace(marker, ''), change.file, options), /exact Trackazoid beatmatching/);
      assert.throws(() => restoreTrackazoidBeatmatchingSite(historical + marker, change.file, options), /exact Trackazoid beatmatching/);
    }
  }
});
