import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORDED_INPUT_SOURCES, createActiveEdge, normalizeInputSource, recordedStartBlocker, shouldStopRecorded,
} from '../src/recorded-input-model.js';

test('source list is Mic, File, Samples with stable values', () => {
  assert.deepEqual(RECORDED_INPUT_SOURCES.map(source => [source.value, source.label]),
    [['mic', 'Mic'], ['file', 'File'], ['samples', 'Samples']]);
  assert.ok(Object.isFrozen(RECORDED_INPUT_SOURCES));
});

test('unknown sources fall back to the microphone', () => {
  assert.equal(normalizeInputSource('samples'), 'samples');
  assert.equal(normalizeInputSource('file'), 'file');
  assert.equal(normalizeInputSource('line'), 'mic');
  assert.equal(normalizeInputSource(undefined), 'mic');
});

test('start blockers never allow mic playback and require armed audio', () => {
  assert.match(recordedStartBlocker({ source: 'mic', armed: true, hasFile: true }), /microphone button/);
  assert.match(recordedStartBlocker({ source: 'samples', armed: false, hasFile: false }), /Switch Audio on/);
  assert.match(recordedStartBlocker({ source: 'file', armed: false, hasFile: true }), /Switch Audio on/);
  assert.match(recordedStartBlocker({ source: 'file', armed: true, hasFile: false }), /Choose an audio file/);
  assert.equal(recordedStartBlocker({ source: 'file', armed: true, hasFile: true }), '');
  assert.equal(recordedStartBlocker({ source: 'samples', armed: true, hasFile: false }), '');
});

test('playback stops when unarmed, unavailable or its context closes', () => {
  const live = { active: true, armed: true, available: true, contextClosed: false };
  assert.equal(shouldStopRecorded(live), false);
  assert.equal(shouldStopRecorded({ ...live, armed: false }), true);
  assert.equal(shouldStopRecorded({ ...live, available: false }), true);
  assert.equal(shouldStopRecorded({ ...live, contextClosed: true }), true);
  assert.equal(shouldStopRecorded({ ...live, active: false, armed: false }), false);
});

test('active edge reports transitions once', () => {
  const seen = [];
  const edge = createActiveEdge(value => seen.push(value));
  assert.equal(edge(false), false);
  assert.equal(edge(true), true);
  assert.equal(edge(true), false);
  assert.equal(edge(0), true);
  assert.deepEqual(seen, [true, false]);
});
