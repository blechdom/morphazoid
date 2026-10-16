import assert from 'node:assert/strict';
import test from 'node:test';
import { SAMPLE_INPUT_OPTIONS } from '../src/instruments/micmic/native/input-source.js';
import { orderedSampleChoices, recordedModeOf, recordedStatusText, stripSourceOf } from '../src/recorded-input-panel.js';

test('source values map onto mic, file and samples', () => {
  for (const value of ['mic', 'input', 'microphone', 'line']) assert.equal(recordedModeOf(value), 'mic');
  for (const value of ['samples', 'sample-file', 'sample']) assert.equal(recordedModeOf(value), 'samples');
  for (const value of ['file', 'upload']) assert.equal(recordedModeOf(value), 'file');
  assert.equal(recordedModeOf('noise'), null);
  assert.equal(recordedModeOf(undefined), null);
  assert.equal(stripSourceOf('samples'), 'samples');
  assert.equal(stripSourceOf('file'), 'file');
  assert.equal(stripSourceOf('mic'), 'mic');
});

test('sample choices keep every bundled recording once, featured first', () => {
  const choices = orderedSampleChoices();
  assert.equal(choices.length, SAMPLE_INPUT_OPTIONS.length);
  assert.equal(new Set(choices.map(option => option.id)).size, choices.length);
  assert.equal(choices[0].id, 'music-vocal-scat');
});

test('status text follows pending, file, arming and playback state', () => {
  const idle = { pending: false, hasFile: false, playing: false, ended: false, loop: true, label: 'Drums' };
  assert.equal(recordedStatusText({ mode: 'mic', armed: true, snapshot: idle }), '');
  assert.match(recordedStatusText({ mode: 'samples', armed: true, snapshot: { ...idle, pending: true } }), /Loading sample/);
  assert.match(recordedStatusText({ mode: 'file', armed: true, snapshot: idle }), /Choose an audio file/);
  assert.match(recordedStatusText({ mode: 'samples', armed: false, snapshot: idle }), /Switch Audio on/);
  assert.equal(recordedStatusText({ mode: 'samples', armed: true, snapshot: { ...idle, playing: true } }), 'Drums · looping');
  assert.equal(recordedStatusText({ mode: 'file', armed: true, snapshot: { ...idle, hasFile: true, playing: true, loop: false, label: 'a.wav' } }), 'a.wav · once');
  assert.equal(recordedStatusText({ mode: 'file', armed: true, snapshot: { ...idle, hasFile: true, ended: true } }), 'File finished.');
});
