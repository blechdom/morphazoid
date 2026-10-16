import { restoreWobbliniDjaySite, wobbliniDjaySiteChanges } from "./helpers/wobblini-djay-site-reference.mjs";
import assert from 'node:assert/strict';
import { restoreStaircaseSpiralRuntime } from './helpers/staircase-spiral-runtime-reference.mjs';
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
import { restoreWipRolloutSite } from './helpers/wip-rollout-site-reference.mjs';
import { restoreEsi32Site } from './helpers/esi-32-site-reference.mjs';

const root = new URL('../', import.meta.url);
const digest = (source, file) => createHash('sha256').update(restoreStaircaseSpiralRuntime(source, file)).digest('hex');

test('Wobblini registers an eight-deck local-audio MVP with explicit Audio and conservative MIDI', () => {
  const item = instrumentById('wobblini');
  assert.equal(item.href, 'wobblini.html');
  assert.equal(item.label, 'Wobblini');
  assert.equal(item.status, 'Work in Progress');
  assert.equal(item.imageHref, 'assets/instruments/wobblini.webp');
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === item.id)).map(group => group.id), ['wip']);
  assert.deepEqual(item.tags.map(tag => tag.id), ['wip', 'app', 'audio-effect']);
  assert.equal(FAVE_TOOL_IDS.includes(item.id), false);
  assert.match(item.description, /eight local stereo sources.*scratchable records or waveforms.*preserve pitch/i);
  assert.ok(item.features.includes('Scratching'));
  assert.ok(item.features.includes('Selectable master'));
  assert.ok(item.features.includes('Key Lock'));
  assert.ok(item.features.includes('BPM analysis'));
  assert.equal(item.features.includes('Beat loops'), false);
  assert.ok(item.features.includes('Crossfader'));
  assert.doesNotMatch(item.description, /streaming accounts|stem separation/i);
  assert.match(item.start, /enable Audio/);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.deepEqual(instrumentMidiCapabilityForId(item.id), {
    id: 'wobblini', midiInput: true, midiInputMode: 'universal-control',
    noteMode: 'processor', audioInput: false, midiOutput: false,
    startsAudio: false, computerKeyboardMode: 'page',
  });
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href), [
    { route: 'wobblini.html', selector: '#master-bpm', mapping: { unit: 'bpm' }, title: 'Tap master BPM' },
  ], 'Tap controls the selected master in native BPM units');
});

test('Wobblini registers its native master BPM in the reviewed Tap inventory', async () => {
  const inventory = JSON.parse(await readFile(new URL('docs/tap-tempo-controls.json', root), 'utf8'));
  const reviewed = inventory.confirmed.filter(({ route }) => route === 'wobblini');
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0].selector, '#master-bpm');
  assert.deepEqual(reviewed[0].mapping, { unit: 'bpm' });
  assert.deepEqual(inventory.excluded.filter(({ route }) => route === 'wobblini'), []);
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
    'src/instruments/wobblini/wobblini-pitch.js', 'src/instruments/wobblini/wobblini-level-analysis.js',
    'src/output-recording-storage.js',
    'src/instruments/wobblini/wobblini-scratch-model.js', 'src/instruments/wobblini/wobblini-scratch-processor.js',
  ]) assert.deepEqual(entries.filter(entry => entry.path === file).map(entry => entry.policy), ['copy+require'], file);
  assert.equal(entries.some(entry => entry.path === 'src/pages/wobblini.html'), false, 'canonical pages use the page manifest');
});

test('Wobblini additions preserve preceding source bytes and reject missing, repeated or altered amendments', async () => {
  assert.match(wobbliniSiteChanges.baseCommit, /^876f074b[0-9a-f]{32}$/);
  for (const change of wobbliniSiteChanges.changes) {
    const source = restoreEsi32Site(restoreWipRolloutSite(await readFile(new URL(change.file, root), 'utf8'), change.file), change.file, { allowRestored: true });
    const restored = restoreWobbliniSite(source, change.file);
    assert.equal(digest(restored, change.file), change.sha256, change.file);
    assert.equal(restoreWobbliniSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWobbliniSite(restored, change.file), /exact Wobblini site amendment/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreWobbliniSite(source.replace(after, () => before), change.file), /exact Wobblini site amendment/);
      assert.throws(() => restoreWobbliniSite(source + after, change.file), /exact Wobblini site amendment/);
      assert.throws(() => restoreWobbliniSite(source.replace(after, () => after.replace('wobblini', 'unreviewed')), change.file), /exact Wobblini site amendment/);
    }
    const drift = '\n// unrelated drift\n';
    assert.ok(restoreWobbliniSite(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreWobbliniSite(source + drift, change.file), change.file), change.sha256);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreWobbliniSite(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreWobbliniSite('untouched', 'unrelated.js'), 'untouched');
});

test('Wobblini controls copy peels to the exact previous publication without hiding drift', async () => {
  const { wobbliniControlsSiteChanges, restoreWobbliniControlsSite, readWobbliniControlsSiteReference } = await import('./helpers/wobblini-controls-site-reference.mjs');
  assert.match(wobbliniControlsSiteChanges.baseCommit, /^9e60847c[0-9a-f]{32}$/);
  for (const change of wobbliniControlsSiteChanges.changes) {
    const url = new URL(change.file, root);
    const raw = await readFile(url, 'utf8');
    const source = restoreWobbliniDjaySite(raw, change.file);
    const restored = restoreWobbliniControlsSite(source, change.file);
    assert.equal(createHash('sha256').update(restored).digest('hex'), change.sha256, change.file);
    assert.equal(await readWobbliniControlsSiteReference(url, 'utf8'), restored);
    assert.deepEqual(await readWobbliniControlsSiteReference(url), await readFile(url));
    assert.equal(restoreWobbliniControlsSite(restored, change.file, { allowRestored: true }), restored);
    for (const { before, after } of change.replacements) {
      for (const changed of [source.replace(after, () => before), source + after, source.replace(after, () => after.replace('wobblini', 'unreviewed'))]) {
        assert.throws(() => restoreWobbliniControlsSite(changed, change.file), /exact Wobblini controls site amendment/);
      }
    }
    const drift = '\n// unrelated source drift\n';
    assert.equal(restoreWobbliniControlsSite(source + drift, change.file), restored + drift);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreWobbliniControlsSite(binary, 'README.md'), binary);
  assert.equal(restoreWobbliniControlsSite('untouched', 'unrelated.js'), 'untouched');
});


test('Wobblini performance amendments preserve preceding bytes and expose unrelated drift', async () => {
  assert.equal(wobbliniDjaySiteChanges.baseCommit, '263f00b37166552d3714989ebdb8adf54d9ed4f7');
  for (const change of wobbliniDjaySiteChanges.changes) {
    const source = await readFile(new URL(change.file, root), 'utf8');
    const restored = restoreWobbliniDjaySite(source, change.file);
    assert.equal(createHash('sha256').update(restored).digest('hex'), change.sha256);
    assert.equal(restoreWobbliniDjaySite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWobbliniDjaySite(restored, change.file), /exact Wobblini djay site amendment/);
    for (const { before, after } of change.replacements) {
      for (const edited of [source.replace(after, () => before), source + after, source.replace(after, () => after + 'unreviewed')]) {
        if (edited.endsWith('unreviewed') || edited.includes(after + 'unreviewed')) {
          assert.notEqual(createHash('sha256').update(restoreWobbliniDjaySite(edited, change.file)).digest('hex'), change.sha256);
        } else assert.throws(() => restoreWobbliniDjaySite(edited, change.file), /exact Wobblini djay site amendment/);
      }
    }
    const drift = '\n// unrelated source drift\n';
    assert.equal(restoreWobbliniDjaySite(source + drift, change.file), restored + drift);
  }
});
