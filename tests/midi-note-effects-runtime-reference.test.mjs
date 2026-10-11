import { restoreTrackazoidBeatmatchingSite } from './helpers/trackazoid-beatmatching-site-reference.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile as readRawFile } from 'node:fs/promises';
import test from 'node:test';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { midiNoteEffectsRuntimeChange as change, restoreMidiNoteEffectsRuntime, readMidiNoteEffectsRuntimeReference } from './helpers/midi-note-effects-runtime-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';
import { restoreBlechLiveRuntime } from './helpers/blech-live-runtime-reference.mjs';
import { restoreSpartialOrganRuntime } from './helpers/spartial-organ-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const url = new URL(`../${change.file}`, import.meta.url);
// Keep the captured Trackazoid MVP, peeling only later beatmatching,
// live-automata and independent organ changes before the note-effects guards.
const concurrent = source => restoreTrackazoidBeatmatchingSite(
  restoreSpartialOrganRuntime(restoreBlechLiveRuntime(source, change.file, { allowRestored: true }),
    change.file, { allowRestored: true }), change.file, { allowRestored: true },
);
const readFile = async (file, encoding) => concurrent(await readRawFile(file, encoding));
const historical = [restoreTrackazoidSite, restoreFractalMotionRuntime, restoreMidiMixerRuntime, restoreVectorFractalsSite];

test('note effects register exactly three copy-and-require runtime paths and restore captured main', async () => {
  assert.equal(change.baseCommit, '30ab06fd8d11aec396e17afdb84139d092e24b08');
  assert.equal(change.file, 'scripts/site/runtime-files.tsv');
  const paths = ['src/midi-note-effects.js', 'src/midi-note-effects-controls.js', 'src/instruments/midiphoria/midiphoria-processor.js'];
  assert.deepEqual(change.rows, paths.map(path => `copy+require\t${path}\n`));
  const source = await readFile(url, 'utf8'), restored = restoreMidiNoteEffectsRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  const inventory = parseRuntimeManifest(source), baseline = parseRuntimeManifest(restored);
  assert.deepEqual(inventory.entries.filter(entry => !baseline.entries.some(old => old.path === entry.path)),
    paths.map(path => ({ path, policy: 'copy+require', copy: true, required: true })));
  assert.equal(concurrent(await readMidiNoteEffectsRuntimeReference(url, 'utf8')), restored);
  assert.equal(restoreMidiNoteEffectsRuntime(restored, change.file, { allowRestored: true }), restored);
  for (const normalize of historical) assert.equal(normalize(source, change.file), normalize(restored, change.file));
});

test('note effects guards reject missing, duplicate, partial, altered and misplaced rows', async () => {
  const source = await readFile(url, 'utf8'), error = /exact MIDI note effects runtime addition/;
  const restored = restoreMidiNoteEffectsRuntime(source, change.file);
  assert.throws(() => restoreMidiNoteEffectsRuntime(restored, change.file), error);
  for (const row of change.rows) for (const options of [{}, { allowRestored: true }]) {
    for (const malformed of [source.replace(row, ''), source + row,
      source.replace(row, row.replace('copy+require', 'copy')), row + source.replace(row, '')]) {
      assert.throws(() => restoreMidiNoteEffectsRuntime(malformed, change.file, options), error);
      for (const normalize of historical) assert.throws(() => normalize(malformed, change.file), error);
    }
  }
  const tampered = source.replace(change.addition, change.addition.replaceAll('src/', 'unreviewed/'));
  assert.throws(() => restoreMidiNoteEffectsRuntime(tampered, change.file), error);
  assert.equal(restoreMidiNoteEffectsRuntime(tampered, change.file, { allowRestored: true }), tampered);
  assert.notEqual(digest(tampered), change.sha256);
});

test('note effects restoration preserves unknown changes and binary identity', async () => {
  const source = await readFile(url, 'utf8');
  for (const suffix of ['\n# unrelated drift\n', 'copy+require\tsrc/unreviewed-midi-effects.js\n']) {
    const restored = restoreMidiNoteEffectsRuntime(source + suffix, change.file);
    assert.ok(restored.endsWith(suffix)); assert.notEqual(digest(restored), change.sha256);
    for (const normalize of historical) assert.ok(normalize(source + suffix, change.file).endsWith(suffix));
  }
  const binary = await readFile(url);
  assert.equal(restoreMidiNoteEffectsRuntime(binary, change.file), binary);
  assert.deepEqual(await readMidiNoteEffectsRuntimeReference(url), binary);
  assert.equal(restoreMidiNoteEffectsRuntime(source, 'unrelated.js'), source);
});
