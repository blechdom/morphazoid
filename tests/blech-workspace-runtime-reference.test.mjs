import test from 'node:test';
import assert from 'node:assert/strict';
import { readBlechNoteHistoryRuntimeReference as readFile } from './helpers/blech-note-history-runtime-reference.mjs';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechWorkspaceRuntimeChange as change, restoreBlechWorkspaceRuntime, readBlechWorkspaceRuntimeReference } from './helpers/blech-workspace-runtime-reference.mjs';
import { restoreBlechBlackMidiRuntime } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';
import { restoreFractalImpulseRuntime, readFractalImpulseRuntimeReference } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite, readTrackazoidSiteReference } from './helpers/trackazoid-site-reference.mjs';
import { restoreSoundFontsShared } from './helpers/sound-fonts-shared-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const normalizers = [restoreBlechWorkspaceRuntime, restoreBlechBlackMidiRuntime, restoreBlackMidiArtRuntime, restoreFractalImpulseRuntime, restoreTrackazoidSite, restoreSoundFontsShared];

test('BLECH performance workspace paths are required once and restore the exact prior runtime inventory', async () => {
  const source = await readFile(url, 'utf8');
  const restored = restoreBlechWorkspaceRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, await readBlechWorkspaceRuntimeReference(url, 'utf8'));
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), change.paths);
  assert.ok(added.every(entry => entry.copy && entry.required));
  for (const path of change.paths) assert.equal(current.filter(entry => entry.path === path).length, 1);
  assert.equal(restoreBlechWorkspaceRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreBlechWorkspaceRuntime(restored, change.file), /exact BLECH MIDI workspace runtime addition/);
  for (const normalize of normalizers.slice(1)) assert.equal(normalize(source, change.file), normalize(restored, change.file));
  assert.equal(await readFractalImpulseRuntimeReference(url, 'utf8'), restoreFractalImpulseRuntime(restored, change.file));
  assert.equal(await readTrackazoidSiteReference(url, 'utf8'), restoreTrackazoidSite(restoreFractalImpulseRuntime(restored, change.file), change.file));
});

test('partial, duplicate, moved and policy-altered runtime additions fail before historical normalization', async () => {
  const source = await readFile(url, 'utf8'), error = /exact BLECH MIDI workspace runtime addition/;
  for (const row of change.rows) {
    const corrupted = [source.replace(row, ''), source + row, row + source.replace(row, ''),
      source.replace(row, row.replace('copy+require', 'copy')), source.replace(row, row.replace('blech-midi/', 'unknown-midi/'))];
    for (const mutation of corrupted) for (const options of [{}, { allowRestored: true }]) {
      for (const normalize of normalizers) assert.throws(() => normalize(mutation, change.file, options), error);
    }
  }
  const changedPolicies = change.rows.reduce((text, row) => text.replace(row, row.replace('copy+require', 'copy')), source);
  const movedBlock = change.addition + source.replace(change.addition, '');
  const changedHeading = source.replace('# BLECH MIDI shared falling stage', '# Unreviewed shared falling stage');
  for (const mutation of [changedPolicies, movedBlock, changedHeading]) for (const normalize of normalizers) {
    assert.throws(() => normalize(mutation, change.file, { allowRestored: true }), error);
  }
});

test('unreviewed inventory drift and binary reads remain visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-live-engine.js\n';
  const restored = restoreBlechWorkspaceRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.addition, extra);
  assert.equal(restoreBlechWorkspaceRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechWorkspaceRuntime(binary, change.file), binary);
  assert.deepEqual(await readBlechWorkspaceRuntimeReference(url), binary);
  assert.equal(restoreBlechWorkspaceRuntime(source, 'unrelated.js'), source);
});
