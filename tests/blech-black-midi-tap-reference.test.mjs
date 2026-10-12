import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { blechBlackMidiTapChange as change, restoreBlechBlackMidiTap } from './helpers/blech-black-midi-tap-reference.mjs';
import { restoreFractalImpulseRuntime, readFractalImpulseRuntimeReference } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { restoreMidiophiliaCreativeTempo } from './helpers/midiophilia-creative-tempo-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');

test('Black MIDI Tap adds exactly one speed owner and restores unchanged target bytes', async () => {
  assert.equal(change.baseCommit, '1f86e7c1483836cf2bd4c326965bad304697b2ff');
  const source = await readFile(url, 'utf8'), restored = restoreBlechBlackMidiTap(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(source.replace(change.addition, ''), restored);
  assert.equal(restoreBlechBlackMidiTap(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreBlechBlackMidiTap(restored, change.file), /exact Blech Black MIDI Tap/);
  for (const restore of [restoreFractalImpulseRuntime, restoreBlechMidiSite, restoreMidiophiliaCreativeTempo]) {
    assert.equal(restore(source, change.file), restore(restored, change.file));
  }
  assert.equal(await readFractalImpulseRuntimeReference(url, 'utf8'), restoreFractalImpulseRuntime(restored, change.file));
});

test('missing fragments, duplicate owners, wrong mapping and relocated targets cannot bypass historical guards', async () => {
  const source = await readFile(url, 'utf8'), error = /exact Blech Black MIDI Tap/;
  const mutations = [source + change.addition, change.addition + source.replace(change.addition, ''),
    source.replace(change.addition, change.addition.replace('120', '90')),
    source.replace(change.addition, change.addition.replace('blech-midi.html', 'midiphoria.html')),
    ...change.markers.map(marker => source.replace(marker, 'unknown'))];
  for (const malformed of mutations) for (const options of [{}, { allowRestored: true }]) {
    for (const restore of [restoreBlechBlackMidiTap, restoreFractalImpulseRuntime, restoreBlechMidiSite, restoreMidiophiliaCreativeTempo]) {
      assert.throws(() => restore(malformed, change.file, options), error);
    }
  }
});

test('unreviewed targets, unrelated bytes and binary reads retain their identity', async () => {
  const source = await readFile(url, 'utf8'), drift = '\n// unreviewed tempo change\n';
  assert.equal(restoreBlechBlackMidiTap(source + drift, change.file), restoreBlechBlackMidiTap(source, change.file) + drift);
  assert.notEqual(digest(restoreBlechBlackMidiTap(source + drift, change.file)), change.sha256);
  const unknown = source.replace(change.addition, '  {"route":"blech-midi.html","selector":"#unknownSpeed"},\n');
  assert.equal(restoreBlechBlackMidiTap(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechBlackMidiTap(binary, change.file), binary);
  assert.deepEqual(await readFractalImpulseRuntimeReference(url), binary);
  assert.equal(restoreBlechBlackMidiTap(source, 'unrelated.js'), source);
});
