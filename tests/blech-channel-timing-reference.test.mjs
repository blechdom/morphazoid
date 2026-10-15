import assert from 'node:assert/strict';
import test from 'node:test';
import { readBlechDropRuntimeReference as readFile } from './helpers/blech-drop-runtime-reference.mjs';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechChannelTimingChanges as amendments, restoreBlechChannelTiming, readBlechChannelTimingReference } from './helpers/blech-channel-timing-reference.mjs';
import { restoreSimdResonatorRuntime } from './helpers/simd-resonator-runtime-reference.mjs';
import { restoreBlechTextRuntime } from './helpers/blech-text-runtime-reference.mjs';
import { restoreBlechBlackMidiRuntime } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreBlechBlackMidiTap } from './helpers/blech-black-midi-tap-reference.mjs';
import { restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const previousNormalizers = change => change.path
  ? [restoreSimdResonatorRuntime, restoreBlechTextRuntime, restoreBlechBlackMidiRuntime, restoreFractalImpulseRuntime, restoreTrackazoidSite]
  : [restoreBlechBlackMidiTap, restoreFractalImpulseRuntime, restoreBlechMidiSite];

test('BLECH channel timing restores exact prior runtime and Tap bytes before older guards', async () => {
  assert.equal(amendments.baseCommit, '37872ac6361123d75a08d676a1ad0133db110cb4');
  for (const change of amendments.changes) {
    const url = new URL(`../${change.file}`, import.meta.url), source = await readFile(url, 'utf8');
    const restored = restoreBlechChannelTiming(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(await readBlechChannelTimingReference(url, 'utf8'), restored);
    assert.equal(restoreBlechChannelTiming(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreBlechChannelTiming(restored, change.file), /exact BLECH MIDI channel timing amendment/);
    for (const normalize of previousNormalizers(change)) {
      assert.equal(normalize(source, change.file), normalize(restored, change.file));
    }
    if (change.path) {
      const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
      const added = current.filter(entry => !previous.some(old => old.path === entry.path));
      assert.deepEqual(added.map(entry => entry.path), [change.path]);
      assert.ok(added[0].copy && added[0].required);
    } else {
      assert.equal(source.split('"selector": "#blackFileTempo"').length - 1, 1);
      assert.equal(source.split('"selector": "#blackPlaybackRate"').length - 1, 1);
      assert.ok(restored.includes('"referenceBpm": 120}, "title": "Tap Black MIDI speed'));
    }
  }
});

test('partial, duplicate, moved and incorrectly mapped timing amendments fail before historical normalization', async () => {
  for (const change of amendments.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const fragment = change.addition ?? change.after.split('\n').filter(row => /#blackFileTempo|#blackPlaybackRate/.test(row)).join('\n') + '\n';
    const malformed = [source + fragment, fragment + source.replace(fragment, ''),
      ...change.markers.map(marker => source.replace(marker, 'unreviewed-timing')),
      source.replace(change.after, change.after.replace(change.path ? 'copy+require' : '"unit": "multiplier"', change.path ? 'copy' : '"unit": "bpm"'))];
    for (const mutation of malformed) for (const options of [{}, { allowRestored: true }]) {
      for (const normalize of [restoreBlechChannelTiming, ...previousNormalizers(change)]) {
        assert.throws(() => normalize(mutation, change.file, options), /exact BLECH MIDI channel timing amendment/);
      }
    }
  }
});

test('unknown replacements, unrelated drift, binary data and unrelated files remain visible', async () => {
  for (const change of amendments.changes) {
    const url = new URL(`../${change.file}`, import.meta.url), source = await readFile(url, 'utf8');
    const extra = '\n# unrelated timing drift\n';
    const restored = restoreBlechChannelTiming(source + extra, change.file);
    assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
    const unknown = source.replace(change.after, extra);
    assert.equal(restoreBlechChannelTiming(unknown, change.file, { allowRestored: true }), unknown);
    assert.notEqual(digest(unknown), change.sha256);
    const binary = await readFile(url);
    assert.equal(restoreBlechChannelTiming(binary, change.file), binary);
    assert.deepEqual(await readBlechChannelTimingReference(url), binary);
    assert.equal(restoreBlechChannelTiming(source, 'unrelated.js'), source);
  }
});
