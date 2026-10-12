import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { catalogueItemById } from '../src/site/instrument-catalog.js';
import { blechBrandSiteChanges, restoreBlechBrandSite, readBlechBrandSiteReference } from './helpers/blech-brand-site-reference.mjs';
import { restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { restoreFractalImpulseRuntime, readFractalImpulseRuntimeReference } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import { restoreTrackazoidSite, readTrackazoidSiteReference } from './helpers/trackazoid-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const urlFor = change => new URL(`../${change.file}`, import.meta.url);
const changes = blechBrandSiteChanges.changes;
const error = /exact BLECH MIDI brand amendment/;

test('BLECH MIDI label and performance copy reach navigation and browse metadata without changing identity', () => {
  const entry = TOOL_GROUPS.flatMap(group => group.tools).filter(tool => tool.id === 'blech-midi');
  assert.equal(entry.length, 1);
  assert.equal(entry[0].label, 'BLECH MIDI');
  assert.equal(entry[0].href, 'blech-midi.html');
  const item = catalogueItemById('blech-midi');
  assert.equal(item.label, 'BLECH MIDI');
  assert.match(item.description, /one falling-note keyboard/);
  assert.ok(item.features.includes('Equation patterns'));
  assert.ok(item.features.includes('Frame loops'));
});

test('reviewed label and catalogue copy restore original metadata hashes and historical guards', async () => {
  for (const change of changes) {
    const url = urlFor(change), source = await readFile(url, 'utf8');
    const restored = restoreBlechBrandSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restored, await readBlechBrandSiteReference(url, 'utf8'));
    assert.equal(restoreBlechBrandSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreBlechBrandSite(restored, change.file), error);
    for (const restore of [restoreBlechMidiSite, restoreFractalImpulseRuntime, restoreTrackazoidSite]) {
      assert.equal(restore(source, change.file), restore(restored, change.file));
    }
    assert.equal(await readFractalImpulseRuntimeReference(url, 'utf8'), restoreFractalImpulseRuntime(restored, change.file));
    assert.equal(await readTrackazoidSiteReference(url, 'utf8'), restoreTrackazoidSite(restoreFractalImpulseRuntime(restored, change.file), change.file));
  }
});

test('duplicated, partial, mixed and altered brand amendments cannot bypass historical guards', async () => {
  for (const change of changes) {
    const source = await readFile(urlFor(change), 'utf8');
    const invalid = [source + change.after, source + change.before,
      source.replace(change.after, change.after.replace(/BLECH MIDI|Layered MIDI performance/, 'Unknown MIDI')),
      source.replace(change.after, change.after.replace(/browse: true|"pluginHref": null/, 'unreviewed: true'))];
    for (const corrupted of invalid) for (const options of [{}, { allowRestored: true }]) {
      for (const restore of [restoreBlechBrandSite, restoreBlechMidiSite, restoreFractalImpulseRuntime, restoreTrackazoidSite]) {
        assert.throws(() => restore(corrupted, change.file, options), error);
      }
    }
    const unknown = source.replace(change.after, change.after.replace('blech-midi', 'unreviewed-midi'));
    assert.equal(restoreBlechBrandSite(unknown, change.file, { allowRestored: true }), unknown);
    assert.notEqual(digest(unknown), change.sha256);
  }
});

test('unrelated edits, moved records and binary data stay visible to original evidence', async () => {
  for (const change of changes) {
    const url = urlFor(change), source = await readFile(url, 'utf8'), suffix = '\n// unreviewed registry edit\n';
    assert.equal(restoreBlechBrandSite(source + suffix, change.file), restoreBlechBrandSite(source, change.file) + suffix);
    assert.notEqual(digest(restoreBlechBrandSite(source + suffix, change.file)), change.sha256);
    const moved = change.after + source.replace(change.after, '');
    assert.notEqual(digest(restoreBlechBrandSite(moved, change.file)), change.sha256);
    const binary = await readFile(url);
    assert.equal(restoreBlechBrandSite(binary, change.file), binary);
    assert.deepEqual(await readBlechBrandSiteReference(url), binary);
    assert.equal(restoreBlechBrandSite(source, 'unrelated.js'), source);
  }
});
