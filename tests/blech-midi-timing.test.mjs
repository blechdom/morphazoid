import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBlechFileTiming } from '../src/instruments/blech-midi/blech-midi-timing.js';

test('unlinked file timing retains source tempo or uses its independent BPM', () => {
  assert.deepEqual(resolveBlechFileTiming({ sourceTempo: 120, masterTempo: 240 }),
    { requestedRate: 1, rate: 1, effectiveBpm: 120, limited: false });
  assert.equal(resolveBlechFileTiming({ sourceTempo: 120, masterTempo: 240, freeTempo: 90 }).effectiveBpm, 90);
  assert.equal(resolveBlechFileTiming({ sourceTempo: 120, freeTempo: 90, ratio: 2 }).effectiveBpm, 180);
});

test('linked file timing follows master BPM with fractional and multiple ratios', () => {
  for (const ratio of [.125, .25, .5, 2 / 3, 1, 1.5, 2, 4, 8]) {
    const timing = resolveBlechFileTiming({ sourceTempo: 120, masterTempo: 60, freeTempo: 200, linked: true, ratio });
    assert.equal(timing.requestedRate, ratio / 2); assert.equal(timing.rate, ratio / 2);
    assert.equal(timing.effectiveBpm, 60 * ratio); assert.equal(timing.limited, false);
  }
  assert.equal(resolveBlechFileTiming({ sourceTempo: 300, masterTempo: 30, linked: true, ratio: .125 }).rate, .0125);
});

test('limits report the resulting BPM rather than the unattainable requested BPM', () => {
  const fast = resolveBlechFileTiming({ sourceTempo: 120, masterTempo: 300, linked: true, ratio: 8 });
  assert.deepEqual(fast, { requestedRate: 20, rate: 8, effectiveBpm: 960, limited: true });
  const slow = resolveBlechFileTiming({ sourceTempo: 300, masterTempo: 30, linked: true, ratio: .01 });
  assert.deepEqual(slow, { requestedRate: .001, rate: .01, effectiveBpm: 3, limited: true });
});

test('SMPTE and missing source tempo use only rate with no invented BPM', () => {
  for (const sourceTempo of [null, undefined, 0, -120, NaN, Infinity]) {
    assert.deepEqual(resolveBlechFileTiming({ sourceTempo, masterTempo: 90, freeTempo: 240, linked: true, ratio: .25 }),
      { requestedRate: .25, rate: .25, effectiveBpm: null, limited: false });
  }
});

test('invalid timing inputs fall back without mutating options or emitting invalid rates', () => {
  const options = Object.freeze({ sourceTempo: 120, masterTempo: NaN, freeTempo: -60, ratio: Infinity, linked: true });
  assert.deepEqual(resolveBlechFileTiming(options), { requestedRate: 1, rate: 1, effectiveBpm: 120, limited: false });
  assert.deepEqual(resolveBlechFileTiming(), { requestedRate: 1, rate: 1, effectiveBpm: null, limited: false });
  assert.equal(resolveBlechFileTiming({ ratio: .125, minRate: NaN, maxRate: -1 }).rate, .125);
  assert.equal(resolveBlechFileTiming({ ratio: 99, maxRate: 999 }).rate, 8);
});
