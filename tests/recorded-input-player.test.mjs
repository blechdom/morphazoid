import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedSampleChoices, recordedInputStatus, RECORDED_INPUT_SOURCES } from '../src/instruments/micmic/native/recorded-input-player.js';
import { SAMPLE_INPUT_OPTIONS } from '../src/instruments/micmic/native/input-source.js';

test('source menu offers Mic, File and Samples in that order', () => {
  assert.deepEqual(RECORDED_INPUT_SOURCES.map(source => source.value), ['mic', 'file', 'samples']);
  assert.deepEqual(RECORDED_INPUT_SOURCES.map(source => source.label), ['Mic', 'File', 'Samples']);
});

test('sample choices keep every bundled sample once and lead with the featured recordings', () => {
  const choices = orderedSampleChoices();
  assert.equal(choices.length, SAMPLE_INPUT_OPTIONS.length);
  assert.deepEqual(new Set(choices.map(choice => choice.id)), new Set(SAMPLE_INPUT_OPTIONS.map(option => option.id)));
  assert.equal(choices[0].id, 'music-vocal-scat');
  assert.ok(choices.slice(0, 5).every(choice => choice.group === 'Voices, sax & tabla'));
});

test('status reflects pending, missing file, unarmed, playing and finished states', () => {
  const base = { mode: 'samples', pending: false, hasFile: false, playing: false, loop: true, ended: false, label: 'Tabla' };
  assert.equal(recordedInputStatus(base, { armed: true, mode: 'mic' }), '');
  assert.match(recordedInputStatus({ ...base, pending: true }, { armed: true }), /Loading sample/);
  assert.match(recordedInputStatus({ ...base, mode: 'file', pending: true }, { armed: true, mode: 'file' }), /Decoding file/);
  assert.match(recordedInputStatus(base, { armed: false }), /Switch Audio on/);
  assert.match(recordedInputStatus({ ...base, mode: 'file' }, { armed: true, mode: 'file' }), /upload button/);
  assert.equal(recordedInputStatus({ ...base, playing: true }, { armed: true }), 'Tabla · looping');
  assert.equal(recordedInputStatus({ ...base, playing: true, loop: false }, { armed: true }), 'Tabla · once');
  assert.equal(recordedInputStatus({ ...base, ended: true }, { armed: true }), 'Finished.');
  assert.equal(recordedInputStatus(base, { armed: true }), 'Ready to play.');
});
