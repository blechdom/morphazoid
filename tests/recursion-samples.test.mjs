import assert from 'node:assert/strict';
import test from 'node:test';
import { recursionSampleStatus } from '../src/instruments/recursion/recursion-samples.js';
import { RecursiveAudioEngine } from '../src/instruments/recursion/recursion-audio-engine.js';

test('sample seed status covers loading, unloaded, audio off, ready and playing', () => {
  const base = { pending: false, loaded: true, audioOn: true, playing: false, label: 'Tabla' };
  assert.match(recursionSampleStatus({ ...base, pending: true }), /Loading/);
  assert.match(recursionSampleStatus({ ...base, loaded: false }), /Choose a sample/);
  assert.match(recursionSampleStatus({ ...base, audioOn: false }), /Switch Audio on/);
  assert.equal(recursionSampleStatus(base), 'Tabla · ready to play');
  assert.match(recursionSampleStatus({ ...base, playing: true }), /recurses while playing/);
});

test('a sample seed is an external seed bounded to the shared seed length', () => {
  const engine = new RecursiveAudioEngine();
  assert.equal(engine.hasSeed('samples'), false);
  const rate = 8000, frames = rate * 10, data = new Float32Array(frames).map((_, i) => Math.sin(i / 9));
  const buffer = { sampleRate: rate, numberOfChannels: 1, length: frames, getChannelData: () => data };
  engine.setSampleSeed(buffer, 'Tabla');
  assert.equal(engine.hasSeed('samples'), true);
  assert.equal(engine.seedLabel('samples'), 'Tabla');
  const seed = engine.externalSeeds.get('samples');
  assert.equal(seed.channels.length, 2);
  assert.ok(seed.channels[0].length <= rate * 4);
  assert.ok(seed.channels[0].every(Number.isFinite));
  assert.equal(engine.hasSeed('mic'), false);
  assert.throws(() => engine.setExternalSeed('other', [data], rate), /Unknown external seed kind/);
});
