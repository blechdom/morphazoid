import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechBlackMidiRuntimeChange as change, restoreBlechBlackMidiRuntime, readBlechBlackMidiRuntimeReference } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreBlackMidiArtRuntime } from './helpers/black-midi-art-runtime-reference.mjs';
import { restoreFractalImpulseRuntime, readFractalImpulseRuntimeReference } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite, readTrackazoidSiteReference } from './helpers/trackazoid-site-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');

test('Blech owns all five score modules and its file player with an exact reversible inventory move', async () => {
  assert.equal(change.baseCommit, '5c5805024a5fdec75724fdbee76548527a21087a');
  const source = await readFile(url, 'utf8'), restored = restoreBlechBlackMidiRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, await readBlechBlackMidiRuntimeReference(url, 'utf8'));
  const current = parseRuntimeManifest(source).entries, baseline = parseRuntimeManifest(restored).entries;
  assert.equal(current.length, baseline.length + 1);
  for (const { before, after } of change.replacements) {
    assert.equal(current.filter(row => row.path === before).length, 0);
    assert.equal(current.filter(row => row.path === after && row.copy && row.required).length, 1);
    assert.equal(baseline.filter(row => row.path === before).length, 1);
  }
  assert.equal(current.filter(row => row.path === 'src/instruments/blech-midi/blech-midi-file-player.js' && row.copy && row.required).length, 1);
  assert.equal(restoreBlechBlackMidiRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.equal(restoreBlackMidiArtRuntime(source, change.file), restoreBlackMidiArtRuntime(restored, change.file));
  assert.equal(await readFractalImpulseRuntimeReference(url, 'utf8'), restoreFractalImpulseRuntime(restored, change.file));
  assert.equal(await readTrackazoidSiteReference(url, 'utf8'), restoreTrackazoidSite(restoreFractalImpulseRuntime(restored, change.file), change.file));
});

test('partial, duplicated, misplaced, mixed-owner and policy-altered moves fail before historical normalization', async () => {
  const source = await readFile(url, 'utf8'), error = /exact Blech Black MIDI ownership move/;
  const normalize = [restoreBlechBlackMidiRuntime, restoreBlackMidiArtRuntime, restoreFractalImpulseRuntime, restoreTrackazoidSite];
  for (const marker of change.markers) {
    const mutations = [source.replace(marker, ''), source + marker, marker + source.replace(marker, ''),
      source.replace(marker, marker.replace('copy+require', 'copy')), source.replace(marker, marker.replace('.js', '-unknown.js'))];
    for (const corrupted of mutations) for (const options of [{}, { allowRestored: true }]) {
      for (const restore of normalize) assert.throws(() => restore(corrupted, change.file, options), error);
    }
  }
  for (const { before, after } of change.replacements) {
    assert.throws(() => restoreBlechBlackMidiRuntime(source.replace(after, before), change.file, { allowRestored: true }), error);
    assert.throws(() => restoreBlechBlackMidiRuntime(source + `copy+require\t${before}\n`, change.file), error);
  }
  const policies = change.markers.reduce((text, marker) => text.replace(marker, marker.replace('copy+require', 'copy')), source);
  assert.throws(() => restoreBlechBlackMidiRuntime(policies, change.file, { allowRestored: true }), error);
  assert.throws(() => restoreBlechBlackMidiRuntime(source.replace('# Black MIDI complete', '# Unreviewed MIDI complete'), change.file), error);
});

test('unrelated runtime edits, unknown replacement blocks, binary data and unrelated files remain visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-new-module.js\n';
  const restored = restoreBlechBlackMidiRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.after, '\ncopy+require\tsrc/unreviewed-move.js\n');
  assert.equal(restoreBlechBlackMidiRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechBlackMidiRuntime(binary, change.file), binary);
  assert.deepEqual(await readBlechBlackMidiRuntimeReference(url), binary);
  assert.equal(restoreBlechBlackMidiRuntime(source, 'unrelated.js'), source);
});
