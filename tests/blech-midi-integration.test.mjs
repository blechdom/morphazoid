import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readTrackazoidSiteReference as readFile } from './helpers/trackazoid-site-reference.mjs';
import test from 'node:test';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { catalogueItemById, instrumentById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { blechMidiSiteChanges, restoreBlechMidiSite } from './helpers/blech-midi-site-reference.mjs';
import { spartialRecordingRuntimeChanges, restoreSpartialRecordingRuntime } from './helpers/spartial-recording-runtime-reference.mjs';
const digest = source => createHash('sha256').update(source).digest('hex');

test('Blech MIDI is a separate browseable Graphic-UI lab with its own tempo owner', () => {
  const group = TOOL_GROUPS.find(group => group.id === 'graphic-ui');
  const item = group.tools.find(item => item.id === 'blech-midi');
  assert.equal(item.label, 'Blech MIDI');
  assert.equal(item.href, 'blech-midi.html');
  assert.equal(item.catalogue, false);
  assert.equal(item.browse, true);
  assert.equal(item.entryType, 'lab');
  assert.equal(instrumentById(item.id), null);
  assert.deepEqual(catalogueItemById(item.id).tags.map(tag => tag.id), ['graphic-ui', '2d', 'sequencer', 'algorithmic']);
  assert.ok(CANONICAL_PAGE_ROUTES.includes(item.href));
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(({ route }) => route === item.href), [
    { route: item.href, selector: '#creativeTempo', mapping: { unit: 'bpm' } },
  ]);
  assert.ok(!TAP_TEMPO_TARGETS.some(({ route, selector }) => route === 'midiphoria.html' && selector === '#creativeTempo'));
});

test('generated MIDI does not claim live MIDI ports or computer piano keys', () => {
  assert.deepEqual(instrumentMidiCapabilityForId('blech-midi'), {
    id: 'blech-midi', midiInput: false, midiInputMode: 'none', noteMode: 'sequence',
    audioInput: false, midiOutput: false, startsAudio: true, computerKeyboardMode: 'none',
  });
  assert.ok(!catalogueItemById('blech-midi').features.includes('MIDI'));
  assert.equal(instrumentMidiCapabilityForId('midiphoria').midiInputMode, 'native');
});

test('Blech registration restores exact previous hashes and exposes unrelated drift', async () => {
  assert.equal(blechMidiSiteChanges.baseCommit, '25d3ed91');
  for (const change of blechMidiSiteChanges.changes) {
    const source = restoreSpartialRecordingRuntime(
      await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8'),
      change.file, { allowRestored: true },
    );
    const restored = restoreBlechMidiSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreBlechMidiSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreBlechMidiSite(restored, change.file), /exact Blech MIDI site amendment/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreBlechMidiSite(source.replace(after, before), change.file), /exact Blech MIDI site amendment/);
      assert.throws(() => restoreBlechMidiSite(source + after, change.file), /exact Blech MIDI site amendment/);
      const tampered = source.replace(after, after.replace(/blech-midi|Blech MIDI/, 'unreviewed'));
      if (tampered !== source) assert.throws(() => restoreBlechMidiSite(tampered, change.file), /exact Blech MIDI site amendment/);
    }
    const drift = '\n// unrelated drift\n';
    assert.ok(restoreBlechMidiSite(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreBlechMidiSite(source + drift, change.file)), change.sha256);
  }
  assert.equal(restoreBlechMidiSite('untouched', 'unrelated.js'), 'untouched');
  const buffer = Buffer.from('unchanged');
  assert.equal(restoreBlechMidiSite(buffer, 'src/site/tap-tempo-targets.js'), buffer);
});

test('the standalone page and shared monitor are packaged once with a real WebP icon', async () => {
  const rows = (await readFile(new URL('../scripts/site/runtime-files.tsv', import.meta.url), 'utf8')).split('\n');
  for (const path of ['src/instruments/blech-midi/blech-midi-app.js', 'src/instruments/blech-midi/blech-midi.css', 'src/instruments/midi-mixer/midi-mixer-monitor.js', 'assets/instruments/blech-midi.webp', 'docs/blech-midi.md']) {
    assert.equal(rows.filter(row => row === `copy+require\t${path}`).length, 1, path);
  }
  const icon = await readFile(new URL('../assets/instruments/blech-midi.webp', import.meta.url));
  assert.equal(icon.toString('ascii', 0, 4), 'RIFF');
  assert.equal(icon.toString('ascii', 8, 12), 'WEBP');
});

test('independent Blech and SPARTIAL recording additions commute without hiding other runtime rows', async () => {
  const file = 'scripts/site/runtime-files.tsv';
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const blech = blechMidiSiteChanges.changes.find(change => change.file === file);
  const recording = spartialRecordingRuntimeChanges;
  const withoutBlech = restoreBlechMidiSite(source, file);
  const withoutRecording = restoreSpartialRecordingRuntime(source, file);
  assert.ok(withoutBlech.includes(recording.after), 'Blech restoration leaves every recording row intact');
  assert.ok(withoutRecording.includes(blech.replacements[0].after), 'recording restoration leaves every Blech row intact');
  const restored = restoreSpartialRecordingRuntime(withoutBlech, file);
  assert.equal(restored, restoreBlechMidiSite(withoutRecording, file));
  assert.equal(digest(restored), blech.sha256);
  assert.equal(digest(restored), recording.sha256);
  const drift = 'copy+require\tsrc/instruments/unreviewed-module.js\n';
  const changed = restoreSpartialRecordingRuntime(restoreBlechMidiSite(source + drift, file), file);
  assert.ok(changed.endsWith(drift));
  assert.notEqual(digest(changed), blech.sha256);
});
