import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { restoreSpartialGranularSite, spartialGranularSiteChanges } from './helpers/spartial-granular-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');

test('SPARTIAL granular catalogue and packaging reverse exactly and preserve independently captured main sources', async () => {
  assert.equal(spartialGranularSiteChanges.baseCommit, '0a06d58e3b5d844e429343109f2c2c1489100e7f');
  assert.deepEqual(spartialGranularSiteChanges.changes.map(change => change.file), [
    'src/site/instrument-catalog.js', 'scripts/site/runtime-files.tsv',
  ]);
  for (const change of spartialGranularSiteChanges.changes) {
    assert.equal(change.replacements.length, 1);
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restoreSpartialGranularSite(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-granular source preserved`);
    assert.equal(restoreSpartialGranularSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreSpartialGranularSite(restored, change.file), /exact SPARTIAL granular amendment/);
    const { before, after } = change.replacements[0];
    assert.match(before, /spartial/);
    assert.match(after, /spartial/);
    assert.equal(restored.replace(before, after), source);
    for (const options of [{}, { allowRestored: true }]) {
      assert.throws(() => restoreSpartialGranularSite(source.replace(after, ''), change.file, options), /exact SPARTIAL granular amendment/);
      assert.throws(() => restoreSpartialGranularSite(source + after, change.file, options), /exact SPARTIAL granular amendment/);
      assert.throws(() => restoreSpartialGranularSite(source.replace(after, after.replace('spartial', 'unreviewed-spartial')), change.file, options), /exact SPARTIAL granular amendment/);
    }
    const drift = '\n// unrelated catalogue drift\n';
    const withDrift = restoreSpartialGranularSite(source + drift, change.file);
    assert.ok(withDrift.endsWith(drift));
    assert.notEqual(digest(withDrift), change.sha256);
  }
  assert.equal(restoreSpartialGranularSite('untouched', 'unrelated.js'), 'untouched');
});

test('SPARTIAL grain engine has exactly one explicit required runtime declaration', async () => {
  const file = 'scripts/site/runtime-files.tsv';
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const row = 'copy+require\tsrc/instruments/spartial/spartial-granular.js';
  assert.equal(source.split('\n').filter(line => line === row).length, 1);
  assert.ok(!restoreSpartialGranularSite(source, file).split('\n').includes(row));
});

test('SPARTIAL catalogue describes both layers and local files without claiming microphone input', () => {
  const item = instrumentById('spartial');
  assert.equal(item.kind, 'Surround additive and granular synthesizer');
  assert.match(item.description, /independent surround grains from live synth capture or local audio files/);
  assert.match(item.start, /Enable Audio.*Hold.*Blend Additive and Granular.*Freeze.*Rotation starts off/);
  assert.ok(item.features.includes('Audio file'));
  assert.equal(instrumentMidiCapabilityForId('spartial').audioInput, false);
  assert.equal(item.href, 'spartial.html');
  assert.deepEqual(item.tags.map(tag => tag.id), ['dispersion', 'surround', 'spatial', 'synthesizer']);
});
