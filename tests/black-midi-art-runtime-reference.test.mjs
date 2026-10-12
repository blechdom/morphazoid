import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readBlechBlackMidiRuntimeReference as readFile } from './helpers/blech-black-midi-runtime-reference.mjs';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blackMidiArtRuntimeChange as change, restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';
import { restoreFractalImpulseRuntime, readFractalImpulseRuntimeReference } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite, readTrackazoidSiteReference } from './helpers/trackazoid-site-reference.mjs';
import { readMidiNoteEffectsRuntimeReference } from './helpers/midi-note-effects-runtime-reference.mjs';
import { restoreTrackazoidPadsSite } from './helpers/trackazoid-pads-site-reference.mjs';
import { restoreSoundFontsShared } from './helpers/sound-fonts-shared-reference.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const url = new URL(`../${change.file}`, import.meta.url);
const normalizers = [restoreFractalImpulseRuntime, restoreTrackazoidSite];

test('complete scores, creator and falling renderer have exact required paths and reverse to unchanged main inventory', async () => {
  assert.equal(change.baseCommit, 'dd5c052ae7270b2e121f5c77a00288b4d4a93396');
  assert.equal(change.file, 'scripts/site/runtime-files.tsv');
  const source = restoreSoundFontsShared(restoreTrackazoidPadsSite(await readFile(url, 'utf8'), change.file), change.file);
  const restored = restoreBlackMidiArtRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  const current = parseRuntimeManifest(source), baseline = parseRuntimeManifest(restored);
  const added = current.entries.filter(entry => !baseline.entries.some(old => old.path === entry.path));
  assert.equal(added.length, 31); assert.equal(added.filter(entry => entry.path.endsWith('.mid.gz')).length, 22);
  assert.equal(added.filter(entry => entry.path.endsWith('.js')).length, 7);
  assert.ok(added.every(entry => entry.policy === 'copy+require' && entry.copy && entry.required));
  assert.deepEqual(added.map(entry => `copy+require\t${entry.path}\n`), change.rows);
  assert.equal(restoreBlackMidiArtRuntime(restored, change.file, { allowRestored: true }), restored);
  for (const normalize of normalizers) assert.equal(normalize(source, change.file), normalize(restored, change.file));
  assert.equal(await readFractalImpulseRuntimeReference(url, 'utf8'), restoreFractalImpulseRuntime(restored, change.file));
  assert.equal(await readTrackazoidSiteReference(url, 'utf8'), restoreTrackazoidSite(restoreFractalImpulseRuntime(restored, change.file), change.file));
  const notes = await readMidiNoteEffectsRuntimeReference(url, 'utf8');
  for (const row of change.rows) assert.ok(!notes.includes(row));
});

test('historical wrappers reject partial, moved, duplicated, policy-altered and unknown renamed artwork additions', async () => {
  const source = await readFile(url, 'utf8'), row = change.rows[0], error = /exact Black MIDI artwork runtime addition/;
  const restored = restoreBlackMidiArtRuntime(source, change.file);
  assert.throws(() => restoreBlackMidiArtRuntime(restored, change.file), error);
  const mutations = [source + row, row + source.replace(row, ''), source.replace(row, ''),
    source.replace(row, row.replace('copy+require', 'copy')), source.replace(row, row.replace('black-score', 'unreviewed-score')),
    source.replace('complete decorative scores, GPU', 'unreviewed scores, GPU')];
  for (const mutated of mutations) for (const options of [{}, { allowRestored: true }]) {
    assert.throws(() => restoreBlackMidiArtRuntime(mutated, change.file, options), error);
    for (const normalize of normalizers) assert.throws(() => normalize(mutated, change.file), error);
  }
  const unknown = source.replace(change.addition, '\ncopy+require\tsrc/unreviewed-art.js\n');
  assert.equal(restoreBlackMidiArtRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
});

test('unrelated inventory bytes remain visible and binary/unrelated-file reads retain identity', async () => {
  const source = await readFile(url, 'utf8');
  for (const suffix of ['\n# independent change\n', 'copy+require\tsrc/unreviewed-midi.js\n']) {
    const restored = restoreBlackMidiArtRuntime(source + suffix, change.file);
    assert.ok(restored.endsWith(suffix)); assert.notEqual(digest(restored), change.sha256);
    for (const normalize of normalizers) assert.ok(normalize(source + suffix, change.file).endsWith(suffix));
  }
  const binary = await readFile(url);
  assert.equal(restoreBlackMidiArtRuntime(binary, change.file), binary);
  assert.deepEqual(await readFractalImpulseRuntimeReference(url), binary);
  assert.deepEqual(await readTrackazoidSiteReference(url), binary);
  assert.deepEqual(await readMidiNoteEffectsRuntimeReference(url), binary);
  assert.equal(restoreBlackMidiArtRuntime(source, 'unrelated.js'), source);
});
