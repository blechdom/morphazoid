import assert from 'node:assert/strict';
import test from 'node:test';
import { readStaircaseSiteReference as readFile } from './helpers/staircase-site-reference.mjs';
import { createHash } from 'node:crypto';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechDropRuntimeChange as change, restoreBlechDropRuntime, readBlechDropRuntimeReference } from './helpers/blech-drop-runtime-reference.mjs';
import { restoreBlechChannelTiming } from './helpers/blech-channel-timing-reference.mjs';
import { restoreBlechTextRuntime } from './helpers/blech-text-runtime-reference.mjs';
import { restoreSimdResonatorRuntime } from './helpers/simd-resonator-runtime-reference.mjs';
import { restoreBlechBlackMidiRuntime } from './helpers/blech-black-midi-runtime-reference.mjs';
import { restoreFractalImpulseRuntime } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const priorNormalizers = [restoreBlechChannelTiming, restoreBlechTextRuntime, restoreSimdResonatorRuntime,
  restoreBlechBlackMidiRuntime, restoreFractalImpulseRuntime, restoreTrackazoidSite];

test('drop modules restore exact preceding runtime bytes before frozen historical guards', async () => {
  assert.equal(change.baseCommit, '37872ac6361123d75a08d676a1ad0133db110cb4');
  const source = await readFile(url, 'utf8'), restored = restoreBlechDropRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(await readBlechDropRuntimeReference(url, 'utf8'), restored);
  assert.equal(restoreBlechDropRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreBlechDropRuntime(restored, change.file), /exact BLECH MIDI prepared-drop runtime addition/);
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), change.paths);
  assert.ok(added.every(entry => entry.copy && entry.required));
  for (const normalize of priorNormalizers) assert.equal(normalize(source, change.file), normalize(restored, change.file));
});

test('partial, duplicate, relocated and weakened drop blocks cannot bypass historical guards', async () => {
  const source = await readFile(url, 'utf8');
  const mutations = [source + change.addition, change.addition + source.replace(change.addition, ''),
    ...change.markers.map(marker => source.replace(marker, 'unreviewed-drop-module')),
    ...change.paths.map(path => source.replace(`copy+require\t${path}`, `copy\t${path}`)),
    source.replace(change.addition, change.addition.split('\n').reverse().join('\n'))];
  for (const mutation of mutations) for (const options of [{}, { allowRestored: true }]) {
    for (const normalize of [restoreBlechDropRuntime, ...priorNormalizers]) {
      assert.throws(() => normalize(mutation, change.file, options), /exact BLECH MIDI prepared-drop runtime addition/);
    }
  }
});

test('unrelated manifest drift, unknown blocks and binary reads remain observable', async () => {
  const source = await readFile(url, 'utf8'), extra = '\n# unrelated drop drift\n';
  const restored = restoreBlechDropRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.after, extra);
  assert.equal(restoreBlechDropRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreBlechDropRuntime(binary, change.file), binary);
  assert.deepEqual(await readBlechDropRuntimeReference(url), binary);
  assert.equal(restoreBlechDropRuntime(source, 'unrelated.js'), source);
});
