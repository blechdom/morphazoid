import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { catalogueItemById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { midiMixerRuntimeChanges, restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');

test('MIDI Mixer is an embedded Midiophilia view, preserving one route and MIDI owner', () => {
  assert.equal(catalogueItemById('midiphoria').label, 'Midiophilia');
  assert.equal(catalogueItemById('midi-mixer'), null);
  assert.equal(TOOL_GROUPS.flatMap(({ tools }) => tools).some(({ id }) => id === 'midi-mixer'), false);
  assert.ok(CANONICAL_PAGE_ROUTES.includes('midiphoria.html'));
  assert.ok(!CANONICAL_PAGE_ROUTES.includes('midi-mixer.html'));
  assert.equal(instrumentMidiCapabilityForId('midi-mixer'), null);
  assert.equal(instrumentMidiCapabilityForId('midiphoria').midiInputMode, 'native');
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(({ route }) => route === 'midiphoria.html'), [
    { route: 'midiphoria.html', selector: '#playbackRate', mapping: { unit: 'multiplier', referenceBpm: 120 }, title: 'Tap speed (120 BPM = normal 1×)' },
    { route: 'midiphoria.html', selector: '#masterTempo', mapping: { unit: 'bpm' } },
  ]);
});

test('embedded mixer packaging additions restore exact previous bytes without hiding other changes', async () => {
  // The reviewed contour feature is the baseline before the exact Mixer rows.
  assert.equal(midiMixerRuntimeChanges.baseCommit, 'e502256c');
  assert.deepEqual(midiMixerRuntimeChanges.changes.map(({ file }) => file), [
    'scripts/site/runtime-files.tsv', 'src/site/tap-tempo-targets.js',
  ]);
  for (const change of midiMixerRuntimeChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restoreMidiMixerRuntime(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreMidiMixerRuntime(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreMidiMixerRuntime(restored, change.file), /exact MIDI Mixer runtime addition/);
    assert.throws(() => restoreMidiMixerRuntime(source + change.addition, change.file), /exact MIDI Mixer runtime addition/);
    const drift = '\n// unrelated drift\n';
    assert.ok(restoreMidiMixerRuntime(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreMidiMixerRuntime(source + drift, change.file)), change.sha256);
  }
  assert.equal(restoreMidiMixerRuntime('untouched', 'unrelated.js'), 'untouched');
});

test('embedded mixer manifest declares its modules once and retains existing collection assets', async () => {
  const inventory = await readFile(new URL('../scripts/site/runtime-files.tsv', import.meta.url), 'utf8');
  const rows = inventory.split('\n');
  const required = midiMixerRuntimeChanges.changes.find(({ file }) => file === 'scripts/site/runtime-files.tsv')
    .addition.split('\n').filter(line => line.startsWith('copy+require\t'));
  for (const row of required) assert.equal(rows.filter(line => line === row).length, 1, row);
  assert.ok(!rows.some(line => /midi-mixer\.html|assets\/instruments\/midi-mixer\.webp/.test(line)));
  for (const asset of ['collection.json', 'soundfont/TimGM6mb.sf2', 'SOURCE.md']) {
    assert.ok(rows.includes(`copy+require\tassets/midiphoria/${asset}`), asset);
  }
});
