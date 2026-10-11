import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { restoreTrackazoidSite, trackazoidSiteChanges } from './helpers/trackazoid-site-reference.mjs';

import { restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { restoreSpartialRecordingRuntime } from './helpers/spartial-recording-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const restoreConcurrent = (source, file) => restoreSpartialRecordingRuntime(
  restoreBlechMidiSite(source, file, { allowRestored: true }), file, { allowRestored: true },
);

test('Trackazoid is a visible local-audio app with conservative MIDI and explicit Audio arm', () => {
  const item = instrumentById('trackazoid');
  assert.equal(item.href, 'trackazoid.html');
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === item.id)).map(group => group.id), ['app']);
  assert.equal(item.status, null);
  assert.deepEqual(item.tags.map(tag => tag.id), ['app', 'looper', 'audio-effect']);
  assert.match(item.description, /local tracks.*manual beat grids/i);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.deepEqual(instrumentMidiCapabilityForId('trackazoid'), {
    id: 'trackazoid', midiInput: true, midiInputMode: 'universal-control',
    noteMode: 'processor', audioInput: false, midiOutput: false,
    startsAudio: false, computerKeyboardMode: 'page',
  });
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href).map(({ selector, mapping }) => ({ selector, mapping })), [
    { selector: '#aBpm', mapping: { unit: 'bpm' } },
    { selector: '#bBpm', mapping: { unit: 'bpm' } },
  ], 'Tap measures source BPM, not an invented fixed-reference tempo multiplier');
});

test('Trackazoid amendments preserve prior evidence and reject missing, duplicate or tampered additions', async () => {
  assert.equal(trackazoidSiteChanges.baseCommit, '25d3ed91');
  for (const change of trackazoidSiteChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restoreTrackazoidSite(source, change.file);
    assert.equal(digest(restoreConcurrent(restored, change.file)), change.sha256, change.file);
    assert.equal(restoreTrackazoidSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreTrackazoidSite(restored, change.file), /exact Trackazoid/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreTrackazoidSite(source.replace(after, before), change.file), /exact Trackazoid/);
      assert.throws(() => restoreTrackazoidSite(source + after, change.file), /exact Trackazoid/);
      assert.throws(() => restoreTrackazoidSite(source.replace(after, after.replace('trackazoid', 'unreviewed')), change.file), /exact Trackazoid/);
    }
    const drift = '\n// unrelated drift\n';
    assert.ok(restoreTrackazoidSite(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreConcurrent(restoreTrackazoidSite(source + drift, change.file), change.file)), change.sha256);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreTrackazoidSite(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreTrackazoidSite('untouched', 'unrelated.js'), 'untouched');
});
