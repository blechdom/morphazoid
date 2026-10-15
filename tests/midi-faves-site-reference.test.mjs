import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readStaircaseSiteReference as readFile } from './helpers/staircase-site-reference.mjs';
import test from 'node:test';
import { FAVE_TOOL_IDS } from '../src/site/instrument-registry.js';
import { catalogueItemById } from '../src/site/instrument-catalog.js';
import { midiFavesSiteChange as change, restoreMidiFavesSite } from './helpers/midi-faves-site-reference.mjs';
import { restoreBlechBrandSite } from './helpers/blech-brand-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');

test('BLECH MIDI and Midiophilia append to Faves and retain their Graphic-UI lab identity', () => {
  assert.deepEqual(FAVE_TOOL_IDS.slice(-2), ['blech-midi', 'midiphoria']);
  for (const id of FAVE_TOOL_IDS.slice(-2)) {
    assert.equal(FAVE_TOOL_IDS.filter(value => value === id).length, 1);
    const entry = catalogueItemById(id);
    assert.equal(entry.entryType, 'lab');
    assert.equal(entry.tags[0].id, 'graphic-ui');
    assert.equal(entry.tags.filter(tag => tag.id === 'faves').length, 1);
  }
});

test('the Faves amendment restores exact prior registry bytes and composes with earlier brand guards', () => {
  const restored = restoreMidiFavesSite(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored.replace(change.before, change.after), source);
  assert.equal(restoreMidiFavesSite(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreMidiFavesSite(restored, change.file), /exact MIDI Faves amendment/);
  assert.equal(restoreBlechBrandSite(source, change.file), restoreBlechBrandSite(restored, change.file));
});

test('partial, duplicate and reordered new Faves cannot bypass the amendment guard', () => {
  const corruptions = [
    source + change.after,
    source.replace('  "blech-midi",\n', ''),
    source.replace('  "midiphoria"\n]);', '  "midiphoria",\n  "midiphoria"\n]);'),
    source.replace(change.after, '  "simd-chiptune",\n  "midiphoria",\n  "blech-midi"\n]);'),
    source.replace(change.after, change.after.replace('"blech-midi"', '"unreviewed"')),
  ];
  for (const corrupted of corruptions) for (const options of [{}, { allowRestored: true }]) {
    assert.throws(() => restoreMidiFavesSite(corrupted, change.file, options), /exact MIDI Faves amendment/);
    assert.throws(() => restoreBlechBrandSite(corrupted, change.file, options), /exact MIDI Faves amendment/);
  }
});

test('unrelated edits and binary reads remain visible to historical evidence', () => {
  const drift = '\n// unrelated registry drift\n';
  const changed = restoreMidiFavesSite(source + drift, change.file);
  assert.ok(changed.endsWith(drift));
  assert.notEqual(digest(changed), change.sha256);
  assert.equal(restoreMidiFavesSite(source, 'unrelated.js'), source);
  const binary = Buffer.from(source);
  assert.equal(restoreMidiFavesSite(binary, change.file), binary);
});
