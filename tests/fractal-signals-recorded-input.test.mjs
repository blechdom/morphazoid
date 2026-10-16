import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_MODES, liveInputMessage, normalizeInputMode } from '../src/instruments/fractal-signals/recorded-input.js';

test('input modes are mic, file and samples', () => {
  assert.deepEqual(INPUT_MODES, ['mic', 'file', 'samples']);
  assert.equal(normalizeInputMode('samples'), 'samples');
  assert.equal(normalizeInputMode('bogus'), 'mic');
  assert.equal(normalizeInputMode(undefined), 'mic');
});

test('recorded playback toggles the worklet microphone flag only on transitions', () => {
  assert.deepEqual(liveInputMessage({ wasLive: false, playing: true, microphoneActive: false }), { type: 'microphone', value: true });
  assert.deepEqual(liveInputMessage({ wasLive: true, playing: false, microphoneActive: false }), { type: 'microphone', value: false });
  assert.equal(liveInputMessage({ wasLive: true, playing: true, microphoneActive: false }), null);
  assert.equal(liveInputMessage({ wasLive: false, playing: false, microphoneActive: false }), null);
});

test('stopping recorded input never switches off a live microphone', () => {
  assert.equal(liveInputMessage({ wasLive: true, playing: false, microphoneActive: true }), null);
});
