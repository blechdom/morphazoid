import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuadrupedClock, readQuadrupedClock } from '../src/instruments/quadruped/quadruped-clock.js';

test('older display timestamps cannot count silent transport time twice', () => {
  let clock = createQuadrupedClock(1000);
  let elapsed = 0;
  for (const timestamp of [1020, 1016.6667, 1040]) {
    clock = readQuadrupedClock(clock, timestamp);
    elapsed += clock.deltaSeconds;
  }
  assert.equal(elapsed, 0.04);
  assert.equal(clock.performanceMs, 1040);
});

test('audio time owns progression regardless of rendering delay or suspension', () => {
  const initial = createQuadrupedClock(1000, 4);
  const next = readQuadrupedClock(initial, 1250, 4.128);
  assert.ok(Math.abs(next.deltaSeconds - 0.128) < 1e-10);
  assert.equal(readQuadrupedClock(next, 3000, 4.128).deltaSeconds, 0);
  assert.deepEqual(initial, createQuadrupedClock(1000, 4), 'reading a display projection never commits the clock');
});

test('explicit clock changes preserve elapsed position without mixing epochs', () => {
  const silent = readQuadrupedClock(createQuadrupedClock(1000), 1500);
  const audible = readQuadrupedClock(createQuadrupedClock(1500, 0.032), 1750, 0.282);
  const closed = readQuadrupedClock(createQuadrupedClock(1750), 2000);
  assert.equal(silent.deltaSeconds + audible.deltaSeconds + closed.deltaSeconds, 1);
});
