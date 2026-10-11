import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, PRESETS, sanitizeState, randomizeState } from '../src/instruments/vector-fractals/model.js';

test('Trace defaults and preset recall keep three separately editable voices', () => {
  const baseline = sanitizeState();
  assert.deepEqual(baseline.layerVoices, ['sine', 'reed', 'glass']);
  assert.deepEqual(baseline.layerEnabled, [true, true, true]);
  baseline.layerEnabled[0] = false;
  baseline.layerVoices[0] = 'glass';
  assert.equal(DEFAULT_STATE.layerEnabled[0], true);
  assert.equal(DEFAULT_STATE.layerVoices[0], 'sine');
  for (const preset of PRESETS) assert.deepEqual(sanitizeState(preset.snapshot), preset.snapshot);
  assert.ok(PRESETS.some(p => p.snapshot.mode === 'explorer' && p.snapshot.contourReader === 'xy'));
});

test('untrusted layer settings recover safely, while all-muted remains intentional', () => {
  const state = sanitizeState({ traceRate: Infinity, featureSize: NaN, layerVoices: [null, 'invalid', 'reed'], layerEnabled: [false, false, false] });
  assert.equal(state.traceRate, .1); assert.equal(state.featureSize, .015);
  assert.deepEqual(state.layerVoices, ['sine', 'reed', 'reed']);
  assert.deepEqual(state.layerEnabled, [false, false, false]);
  assert.equal(sanitizeState({ traceRate: -1 }).traceRate, .01);
  assert.equal(sanitizeState({ featureSize: 10 }).featureSize, .08);
});

test('randomization varies every layer voice and mute without random silent scenes', () => {
  let seed = 8104;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const voices = [new Set(), new Set(), new Set()], enabled = [new Set(), new Set(), new Set()];
  for (let i = 0; i < 200; i++) {
    const state = randomizeState(DEFAULT_STATE, random);
    assert.ok(state.layerEnabled.some(Boolean));
    for (let j = 0; j < 3; j++) { voices[j].add(state.layerVoices[j]); enabled[j].add(state.layerEnabled[j]); }
  }
  for (let i = 0; i < 3; i++) { assert.equal(voices[i].size, 3); assert.equal(enabled[i].size, 2); }
});
