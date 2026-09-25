import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { sharedParameterChanges, nativeParameterPatch, RUBIXOIDS_ROUTES } from '../src/instruments/rubixoids/shared-settings.js';

test('native dimension defaults are preserved and only actual edits travel', () => {
  for (const dimension of Object.keys(RUBIXOIDS_ROUTES)) {
    const settings = { tempo: 126, swing: 0, output: .56, soundBank: 'acid-303', voice: 'techno' };
    assert.deepEqual(sharedParameterChanges(dimension, settings, { ...settings }), {});
    assert.deepEqual(sharedParameterChanges(dimension, settings, { ...settings, tempo: 147 }), { tempo: 147 });
  }
  assert.deepEqual(sharedParameterChanges('3d', { soundBank: 'shared-simd-303' }, { soundBank: 'acid-303' }), {});
  assert.deepEqual(nativeParameterPatch('4d', { voice: 'shared-simd-chiptune' }), { voice: 'shared-simd-chiptune' });
});

test('quarter-note pulse units round-trip between the original sliding and hyper clocks', () => {
  for (const pulseDivision of [4, 8, 16, 32, 64]) {
    const shared = sharedParameterChanges('2d', { pulseDivision: 0 }, { pulseDivision });
    const hyper = nativeParameterPatch('4d', shared);
    assert.equal(hyper.subdivisionsPerBeat, pulseDivision / 4);
    assert.equal(nativeParameterPatch('2d', shared).pulseDivision, pulseDivision);
  }
});

test('normalized brightness and decay use their actual native sound controls', () => {
  const changes = sharedParameterChanges('3d', { cutoff: 160, acidDecay: .1 }, { cutoff: 2180, acidDecay: .48 });
  assert.deepEqual(nativeParameterPatch('2d', changes), { decay: .48, brightness: .5 });
  assert.deepEqual(nativeParameterPatch('4d', changes), { decay: .48, tone: .5 });
  assert.deepEqual(nativeParameterPatch('3d', changes), { acidDecay: .48, cutoff: 2180 });
});

test('order transfer respects native bounds and never turns a rectangular edit into a square', () => {
  assert.deepEqual(sharedParameterChanges('2d', { rows: 3, columns: 3 }, { rows: 5, columns: 3 }), {});
  const shared = sharedParameterChanges('2d', { rows: 3, columns: 3 }, { rows: 5, columns: 5 });
  assert.deepEqual(shared, { order: 5 });
  assert.deepEqual(nativeParameterPatch('3d', shared), { rubixSize: 5 });
  assert.deepEqual(nativeParameterPatch('4d', shared), {});
  assert.deepEqual(nativeParameterPatch('2d', { order: 4 }), { rows: 4, columns: 4 });
});

test('Rubixoids directly mounts its owned instrument controllers without embedded pages', async () => {
  const source = await readFile(new URL('../src/instruments/rubixoids/rubixoids-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createSolved|turnRubix|renderRubixoids|AudioContext|SequencerVoiceBank|full-presets/);
  assert.match(source, /bridge\.deactivate\(/);
  assert.match(source, /bridge\.activate\(/);
  assert.match(source, /bridge\.applySettings\(/);
  assert.doesNotMatch(source, /createElement\(['"]iframe|contentWindow|contentDocument|fetch\(/);
  for (const id of ['rubix', 'sliding-puzzle', 'hyper-rubix']) assert.ok(source.includes(`import('./${id}/${id}-app.js')`));
});
