import test from 'node:test';
import assert from 'node:assert/strict';
import { BlackMidiPlayedCounter } from '../src/instruments/blech-midi/blech-midi-black-score.js';

const score = { starts: new Float64Array([0, 0, .5, 1, 2, 3]), tracks: [{ start: 0, end: 6 }], duration: 4, total: 6 };
const state = (time = 0, playing = true, cycle = 0) => ({ time, playing, cycle, duration: 4, loopStart: 0, loopEnd: 4 });

test('file attacks wait for Play, accumulate through pause and stop, and reset without moving playback', () => {
  const counter = new BlackMidiPlayedCounter(); counter.setScore(score, state(0, false));
  assert.equal(counter.update(state(0, false)), 0);
  assert.equal(counter.update(state()), 2);
  assert.equal(counter.update(state(.5)), 3);
  assert.equal(counter.update(state(.75, false)), 3);
  assert.equal(counter.update(state(.75, false)), 3);
  assert.equal(counter.update(state(.75)), 3);
  assert.equal(counter.update(state(1)), 4);
  counter.reset(state(1)); assert.equal(counter.count, 0);
  assert.equal(counter.update(state(1)), 0);
  assert.equal(counter.update(state(2)), 1);
  counter.rebase(state(0, false), { includeStart: true });
  assert.equal(counter.update(state(0, false)), 1);
  assert.equal(counter.update(state()), 3);
});

test('seek and song changes skip unplayed attacks while repeated and missed loop cycles count completely', () => {
  const counter = new BlackMidiPlayedCounter(); counter.setScore(score, state(0, false));
  assert.equal(counter.update(state(.5)), 3);
  counter.rebase(state(2.5)); assert.equal(counter.update(state(2.5)), 3);
  assert.equal(counter.update(state(3)), 4);
  counter.rebase(state(.5)); assert.equal(counter.update(state(.5)), 4);
  assert.equal(counter.update(state(1)), 5);
  assert.equal(counter.update(state(.5, true, 1000)), 6004);
  const saved = counter.count;
  counter.setScore(null); assert.equal(counter.update(state()), saved);
  counter.setScore(score, state(0, false)); assert.equal(counter.update(state(0, false)), saved);
  assert.equal(counter.update(state()), saved + 2);
});

test('embedded loop boundaries include their start notes and exclude notes outside the played loop', () => {
  const counter = new BlackMidiPlayedCounter(); counter.setScore(score, state(0, false));
  assert.equal(counter.update(state(1)), 4);
  const loop = { ...state(1, true, 100), loopStart: 1, loopEnd: 2 };
  assert.equal(counter.update(loop), 204);
  assert.equal(counter.update({ ...loop, playing: false }), 204);
  counter.reset({ ...loop, playing: false }); assert.equal(counter.count, 0);
});

test('lagging time reports never double-count a prefix and score lookup remains logarithmic', () => {
  const counter = new BlackMidiPlayedCounter(); counter.setScore(score, state(0, false));
  assert.equal(counter.update(state(2)), 5);
  assert.equal(counter.update(state(.5)), 5);
  assert.equal(counter.update(state(2)), 5);
  assert.equal(counter.update(state(3)), 6);
  const starts = Float64Array.from({ length: 32768 }, (_, index) => index / 8192); let reads = 0;
  const dense = { ...score, starts: new Proxy(starts, { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, target); } }), tracks: [{ start: 0, end: starts.length }], total: starts.length };
  counter.setScore(dense, state(0, false)); reads = 0;
  assert.equal(counter.update(state(2, true, 1000000)), 32768 * 1000000 + 16385 + 6);
  assert.ok(reads < 100, `${reads} probes should remain bounded independently of loop count`);
});
