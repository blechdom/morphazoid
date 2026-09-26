import assert from 'node:assert/strict';
import test from 'node:test';
import { ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY } from '../src/instruments/simd-chiptune/tempo-clock.js';

test('tempo ramps integrate beat continuously and invert to original audio seconds', () => {
  const clock = new ChiptuneTempoClock(1.3);
  const times = [1000, 1000.017, 1000.051, 1000.096, 1000.5];
  for (const [index, time] of times.entries()) {
    const beat = clock.beatAt(time), tempo = clock.tempoAt(time);
    clock.setTempo(index % 2 ? .25 : 4, time);
    assert.equal(clock.beatAt(time), beat);
    assert.equal(clock.tempoAt(time), tempo);
  }
  let previousBeat = clock.beatAt(999.9);
  for (let i = 0; i < 2000; i++) {
    const time = 999.9 + i / 2000, beat = clock.beatAt(time);
    assert.ok(beat >= previousBeat);
    assert.ok(Math.abs(clock.timeAtBeat(beat) - time) < 1e-9);
    previousBeat = beat;
  }
  assert.equal(clock.tempoAt(1001), 4);
});

test('clock memory stays bounded while retaining the full analytic echo and ghost history', () => {
  const clock = new ChiptuneTempoClock();
  for (let i = 1; i <= 2600; i++) clock.setTempo(i % 2 ? .25 : 4, i / 120);
  assert.equal(clock.segments.length, TEMPO_CLOCK_CAPACITY);
  const last = 2600 / 120;
  assert.ok(clock.segments[0][0] < last - 16);
  for (let i = 0; i <= 16; i++) assert.ok(Math.abs(clock.timeAtBeat(clock.beatAt(last - i)) - (last - i)) < 1e-9);
  const restored = new ChiptuneTempoClock();
  restored.restore(structuredClone(clock.segments));
  assert.equal(restored.beatAt(last + 10), clock.beatAt(last + 10));
});
