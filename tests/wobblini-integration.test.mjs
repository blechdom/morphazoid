import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { restoreWobbliniSite, wobbliniSiteChanges } from './helpers/wobblini-site-reference.mjs';

const root = new URL('../', import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');

test('Wobblini registers an eight-deck local-audio MVP with explicit Audio and conservative MIDI', () => {
  const item = instrumentById('wobblini');
  assert.equal(item.href, 'wobblini.html');
  assert.equal(item.label, 'Wobblini');
  assert.equal(item.status, 'Work in Progress');
  assert.equal(item.imageHref, 'assets/instruments/wobblini.webp');
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === item.id)).map(group => group.id), ['wip']);
  assert.deepEqual(item.tags.map(tag => tag.id), ['wip', 'app', 'looper', 'audio-effect']);
  assert.equal(FAVE_TOOL_IDS.includes(item.id), false);
  assert.match(item.description, /eight local audio decks.*records forward and backward to scratch.*shared filter wobble/i);
  assert.ok(item.features.includes('Scratching'));
  assert.doesNotMatch(item.description, /streaming|stem separation|time.stretch|automatic BPM/i);
  assert.match(item.start, /enable Audio/);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.deepEqual(instrumentMidiCapabilityForId(item.id), {
    id: 'wobblini', midiInput: true, midiInputMode: 'universal-control',
    noteMode: 'processor', audioInput: false, midiOutput: false,
    startsAudio: false, computerKeyboardMode: 'page',
  });
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href).map(({ selector, mapping }) => ({ selector, mapping })), [
    { selector: '#master-bpm', mapping: { unit: 'bpm' } },
    { selector: '.deck-bpm', mapping: { unit: 'bpm' } },
    ...Array.from({ length: 8 }, (_, index) => ({ selector: `#d${index}Rate`, mapping: { unit: 'multiplier', referenceSelector: `#d${index}Bpm` } })),
  ]);
});

test('Wobblini has real original artwork, an incoming fallback route, and required runtime assets', async () => {
  const icon = await readFile(new URL('assets/instruments/wobblini.webp', root));
  assert.equal(icon.toString('ascii', 0, 4), 'RIFF');
  assert.equal(icon.toString('ascii', 8, 12), 'WEBP');
  assert.ok(icon.length > 8000);
  const vector = await readFile(new URL('artwork/wobblini.svg', root), 'utf8');
  assert.match(vector, /width="512" height="512"/);
  assert.equal((vector.match(/r="49"/g) ?? []).length, 8, 'eight representative decks');
  const fallback = await readFile(new URL('src/pages/graphonic-calculator.html', root), 'utf8');
  assert.match(fallback, /<a class="tab" href="wobblini.html">Wobblini<\/a>/);
  assert.match(fallback, /<option value="wobblini.html">Wobblini<\/option>/);
  const { entries } = await readRuntimeManifest();
  for (const file of [
    'assets/instruments/wobblini.webp', 'docs/wobblini.md',
    'src/instruments/wobblini/wobblini-app.js', 'src/instruments/wobblini/wobblini.css',
    'src/instruments/wobblini/wobblini-audio.js', 'src/instruments/wobblini/wobblini-model.js',
    'src/instruments/wobblini/wobblini-scratch-model.js', 'src/instruments/wobblini/wobblini-scratch-processor.js',
  ]) assert.deepEqual(entries.filter(entry => entry.path === file).map(entry => entry.policy), ['copy+require'], file);
  assert.equal(entries.some(entry => entry.path === 'src/pages/wobblini.html'), false, 'canonical pages use the page manifest');
});

test('Wobblini additions preserve preceding source bytes and reject missing, repeated or altered amendments', async () => {
  assert.match(wobbliniSiteChanges.baseCommit, /^876f074b[0-9a-f]{32}$/);
  for (const change of wobbliniSiteChanges.changes) {
    const source = await readFile(new URL(change.file, root), 'utf8');
    const restored = restoreWobbliniSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreWobbliniSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWobbliniSite(restored, change.file), /exact Wobblini site amendment/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreWobbliniSite(source.replace(after, () => before), change.file), /exact Wobblini site amendment/);
      assert.throws(() => restoreWobbliniSite(source + after, change.file), /exact Wobblini site amendment/);
      assert.throws(() => restoreWobbliniSite(source.replace(after, () => after.replace('wobblini', 'unreviewed')), change.file), /exact Wobblini site amendment/);
    }
    const drift = '\n// unrelated drift\n';
    assert.ok(restoreWobbliniSite(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreWobbliniSite(source + drift, change.file)), change.sha256);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreWobbliniSite(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreWobbliniSite('untouched', 'unrelated.js'), 'untouched');
});
