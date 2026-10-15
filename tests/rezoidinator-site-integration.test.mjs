import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { restoreRustResonatorSite, rustResonatorSiteChanges } from './helpers/simd-resonator-rust-site-reference.mjs';
import { restoreBlechChannelTiming } from './helpers/blech-channel-timing-reference.mjs';
import { rezoidinatorSiteChanges, restoreRezoidinatorSite, readRezoidinatorSiteReference } from './helpers/rezoidinator-site-reference.mjs';

const urlFor = file => new URL(`../${file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const spatialRuntimePaths = [
  ...['spatial-model', 'surround-output', 'recording'].map(module => `src/instruments/simd-resonator-rust/${module}.js`),
  'docs/rezoidinator-surround-measurements.json',
];

test('Rezoidinator retains its catalogue identity and advertises the spatial/recording surface', async () => {
  const item = instrumentById('simd-resonator-rust');
  assert.equal(item.label, 'Rezoidinator');
  assert.equal(item.href, 'simd-resonator-rust.html');
  assert.match(item.description, /up to 4,096 parallel modes/);
  assert.match(item.description, /sixteen output channels/);
  assert.match(item.description, /multichannel 24-bit WAV or separate channel stems/);
  assert.ok(item.features.includes('Surround output'));
  assert.ok(item.features.includes('Multichannel recording'));
  const inventory = JSON.parse(await readFile(urlFor('docs/audio-input-controls.json'), 'utf8'));
  const control = inventory.controls.find(control => control.route === item.href);
  assert.equal(control.label, 'Rezoidinator');
  assert.equal(control.mode, 'live', 'the menubar strip owns microphone input only');
});

test('the rename and spatial registration reverse exactly to merged fresh main', async () => {
  assert.equal(rezoidinatorSiteChanges.baseCommit, '0de68cbb6315b67918a8d713fc8acf75865a3cf3');
  for (const change of rezoidinatorSiteChanges.changes) {
    const source = await readFile(urlFor(change.file), 'utf8');
    const restored = restoreRezoidinatorSite(source, change.file);
    assert.equal(digest(source), change.approvedSha256, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(await readRezoidinatorSiteReference(urlFor(change.file), 'utf8'), restored);
    assert.equal(restoreRezoidinatorSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreRezoidinatorSite(restored, change.file), /exact Rezoidinator/);
    let reapplied = restored;
    for (const { before, after } of change.replacements) reapplied = reapplied.replace(before, after);
    assert.equal(reapplied, source);
  }
});

test('spatial runtime paths are required once while independent BLECH additions remain intact', async () => {
  const file = 'scripts/site/runtime-files.tsv', source = await readFile(urlFor(file), 'utf8');
  const entries = parseRuntimeManifest(source).entries;
  for (const path of spatialRuntimePaths) {
    const rows = entries.filter(entry => entry.path === path);
    assert.equal(rows.length, 1, path);
    assert.equal(rows[0].policy, 'copy+require', path);
  }
  const prior = restoreRezoidinatorSite(source, file);
  for (const module of ['blech-midi-timing', 'blech-midi-drop-stage', 'blech-midi-stamp-picker']) {
    assert.ok(prior.includes(`copy+require\tsrc/instruments/blech-midi/${module}.js\n`));
  }
  const rustFirst = restoreBlechChannelTiming(restoreRustResonatorSite(source, file), file);
  const blechFirst = restoreRustResonatorSite(restoreBlechChannelTiming(source, file), file);
  assert.equal(rustFirst, blechFirst);
  assert.equal(digest(rustFirst), rustResonatorSiteChanges.changes.find(change => change.file === file).sha256);
  const suffix = '\ncopy+require\tsrc/unknown-spatial-engine.js\n';
  assert.equal(restoreBlechChannelTiming(restoreRustResonatorSite(source + suffix, file), file), rustFirst + suffix);
});

test('partial, relocated, duplicate and policy-altered amendments cannot hide behind the rename', async () => {
  for (const change of rezoidinatorSiteChanges.changes) {
    const source = await readFile(urlFor(change.file), 'utf8');
    for (const { before, after } of change.replacements) {
      for (const mutation of [source + after, after + source.replace(after, before)]) {
        for (const options of [{}, { allowRestored: true }]) {
          assert.throws(() => restoreRezoidinatorSite(mutation, change.file, options), /exact Rezoidinator/);
          assert.throws(() => restoreRustResonatorSite(mutation, change.file, options), /exact Rezoidinator/);
        }
      }
    }
    for (const { text } of change.markers) {
      const partial = source.replace(text, 'unreviewed-spatial-change');
      assert.throws(() => restoreRezoidinatorSite(partial, change.file), /exact Rezoidinator/);
      if (change.markers.some(marker => partial.includes(marker.text))) {
        assert.throws(() => restoreRezoidinatorSite(partial, change.file, { allowRestored: true }), /exact Rezoidinator/);
      }
    }
  }
  const file = 'scripts/site/runtime-files.tsv', source = await readFile(urlFor(file), 'utf8');
  for (const path of spatialRuntimePaths) {
    const row = `copy+require\t${path}`;
    for (const policy of ['copy', 'require']) {
      assert.throws(() => restoreRezoidinatorSite(source.replace(row, row.replace('copy+require', policy)), file), /exact Rezoidinator/);
    }
  }
});

test('unrelated source drift and raw binary reads remain visible', async () => {
  for (const change of rezoidinatorSiteChanges.changes) {
    const source = await readFile(urlFor(change.file), 'utf8'), suffix = '\n// unrelated change\n';
    const restored = restoreRezoidinatorSite(source, change.file);
    assert.equal(restoreRezoidinatorSite(source + suffix, change.file), restored + suffix);
    assert.notEqual(digest(restored + suffix), change.sha256);
    const bytes = await readFile(urlFor(change.file));
    assert.equal(restoreRezoidinatorSite(bytes, change.file), bytes);
    assert.deepEqual(await readRezoidinatorSiteReference(urlFor(change.file)), bytes);
    assert.equal(restoreRezoidinatorSite(source, 'unrelated.js'), source);
  }
});
