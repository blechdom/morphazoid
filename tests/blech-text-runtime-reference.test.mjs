import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSimdResonatorRuntime, readSimdResonatorRuntimeReference as readFile } from './helpers/simd-resonator-runtime-reference.mjs';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechTextRuntimeChange as change, restoreBlechTextRuntime, readBlechTextRuntimeReference } from './helpers/blech-text-runtime-reference.mjs';
import { restoreVectorMotifRuntime, readVectorMotifRuntimeReference } from './helpers/vector-motif-runtime-reference.mjs';
import { restoreBlechNoteHistoryRuntime } from './helpers/blech-note-history-runtime-reference.mjs';
import { restoreBlechWorkspaceRuntime } from './helpers/blech-workspace-runtime-reference.mjs';
import { restoreBlechBlackMidiRuntime } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';
import { restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreSoundFontsShared } from './helpers/sound-fonts-shared-reference.mjs';
import { restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const normalizers = [restoreBlechTextRuntime, restoreVectorMotifRuntime, restoreBlechNoteHistoryRuntime,
  restoreBlechWorkspaceRuntime, restoreBlechBlackMidiRuntime, restoreBlackMidiArtRuntime,
  restoreFractalImpulseRuntime, restoreTrackazoidSite, restoreSoundFontsShared, restoreVectorFractalsSite];

test('BLECH text preparation is required once and restores the exact prior runtime inventory', async () => {
  assert.equal(change.baseCommit, '477cdaea040308077fac1c9c3ef209b719bddb85');
  const source = await readFile(url, 'utf8'), restored = restoreBlechTextRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, restoreSimdResonatorRuntime(await readBlechTextRuntimeReference(url, 'utf8'), change.file));
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), [change.path]);
  assert.ok(added.every(entry => entry.copy && entry.required));
  assert.equal(current.filter(entry => entry.path === change.path).length, 1);
  assert.equal(restoreBlechTextRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreBlechTextRuntime(restored, change.file), /exact BLECH MIDI text preparation runtime addition/);
  for (const normalize of normalizers.slice(1)) assert.equal(normalize(source, change.file), normalize(restored, change.file));
  assert.equal(await readVectorMotifRuntimeReference(url, 'utf8'), restoreVectorMotifRuntime(restored, change.file));
});

test('partial, duplicated, moved and policy-altered text modules fail before historical normalization', async () => {
  const source = await readFile(url, 'utf8'), error = /exact BLECH MIDI text preparation runtime addition/;
  const corrupted = [source.replace(change.row, ''), source + change.row,
    change.row + source.replace(change.row, ''),
    source.replace(change.row, change.row.replace('copy+require', 'copy')),
    source.replace(change.row, change.row.replace('copy+require', 'require')),
    source.replace(change.row, change.row.replace('blech-midi-text-controls.js', 'unreviewed-text.js')),
    change.addition + source.replace(change.addition, ''),
    source.replace(change.markers[0], '# Unreviewed text preparation')];
  for (const mutation of corrupted) for (const options of [{}, { allowRestored: true }]) {
    for (const normalize of normalizers) assert.throws(() => normalize(mutation, change.file, options), error);
  }
});

test('text restoration leaves unrelated inventory drift, unknown replacements and binary reads visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-text.js\n';
  const restored = restoreBlechTextRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.addition, extra);
  assert.equal(restoreBlechTextRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechTextRuntime(binary, change.file), binary);
  assert.deepEqual(await readBlechTextRuntimeReference(url), binary);
  assert.equal(restoreBlechTextRuntime(source, 'unrelated.js'), source);
});
