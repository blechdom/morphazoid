import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechNoteHistoryRuntimeChange as change, restoreBlechNoteHistoryRuntime, readBlechNoteHistoryRuntimeReference } from './helpers/blech-note-history-runtime-reference.mjs';
import { restoreBlechWorkspaceRuntime, readBlechWorkspaceRuntimeReference } from './helpers/blech-workspace-runtime-reference.mjs';
import { restoreBlechBlackMidiRuntime } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';
import { restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreSoundFontsShared } from './helpers/sound-fonts-shared-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const normalizers = [restoreBlechNoteHistoryRuntime, restoreBlechWorkspaceRuntime, restoreBlechBlackMidiRuntime,
  restoreBlackMidiArtRuntime, restoreFractalImpulseRuntime, restoreTrackazoidSite, restoreSoundFontsShared];

test('BLECH note history is required once and restores the exact prior runtime inventory', async () => {
  assert.equal(change.baseCommit, 'd6c8a5a04f93acbd785737a073d64ee17ca28b80');
  const source = await readFile(url, 'utf8');
  const restored = restoreBlechNoteHistoryRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, await readBlechNoteHistoryRuntimeReference(url, 'utf8'));
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), [change.path]);
  assert.ok(added.every(entry => entry.copy && entry.required));
  assert.equal(current.filter(entry => entry.path === change.path).length, 1);
  assert.equal(restoreBlechNoteHistoryRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreBlechNoteHistoryRuntime(restored, change.file), /exact BLECH MIDI note-history runtime addition/);
  for (const normalize of normalizers.slice(1)) assert.equal(normalize(source, change.file), normalize(restored, change.file));
  assert.equal(await readBlechWorkspaceRuntimeReference(url, 'utf8'), restoreBlechWorkspaceRuntime(restored, change.file));
});

test('partial, duplicated, moved and policy-altered history additions fail before historical normalization', async () => {
  const source = await readFile(url, 'utf8'), error = /exact BLECH MIDI note-history runtime addition/;
  const corrupted = [source.replace(change.row, ''), source + change.row,
    change.row + source.replace(change.row, ''),
    source.replace(change.row, change.row.replace('copy+require', 'copy')),
    source.replace(change.row, change.row.replace('blech-midi-note-history.js', 'unknown-history.js')),
    change.addition + source.replace(change.addition, ''),
    source.replace(change.markers[0], '# Unreviewed playback history')];
  for (const mutation of corrupted) for (const options of [{}, { allowRestored: true }]) {
    for (const normalize of normalizers) assert.throws(() => normalize(mutation, change.file, options), error);
  }
});

test('unreviewed inventory drift, unknown replacements and binary reads remain visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-history.js\n';
  const restored = restoreBlechNoteHistoryRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.addition, extra);
  assert.equal(restoreBlechNoteHistoryRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechNoteHistoryRuntime(binary, change.file), binary);
  assert.deepEqual(await readBlechNoteHistoryRuntimeReference(url), binary);
  assert.equal(restoreBlechNoteHistoryRuntime(source, 'unrelated.js'), source);
});
