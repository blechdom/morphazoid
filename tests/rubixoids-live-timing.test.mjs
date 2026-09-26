import assert from 'node:assert/strict';
import test from 'node:test';
import { RubixoidsClock } from '../src/instruments/rubixoids/clock.js';
import { rubixLiveGridDeadline, rubixRetimedOrdinal } from '../src/instruments/rubixoids/rubix/rubix-clock.js';

test('live tempo deadlines retain committed notes and converge to the shared grid', () => {
  for (const subdivisions of [1, 3]) for (const [from, to] of [[120, 240], [240, 90]]) {
    let now = 0;
    const clock = new RubixoidsClock({ now: () => now, tempo: from, swing: .3 });
    clock.play({ leadSeconds: 0 });
    const options = { division: 4, subdivisions };
    const committed = clock.grid(9 * subdivisions, options);
    let previous = { when: committed.time, duration: committed.duration };
    now = committed.time - .055;
    clock.configure({ tempo: to, swing: .08 });
    let delay = 0;
    for (let ordinal = 9 * subdivisions + 1; ordinal <= 20 * subdivisions; ordinal += 1) {
      const point = clock.grid(ordinal, options);
      const interval = clock.grid(ordinal - 1, options).duration;
      const when = rubixLiveGridDeadline(point.time, now, previous, interval);
      assert.ok(when > previous.when, 'no attack can replay or overtake a committed note');
      assert.ok(when - previous.when >= Math.min(previous.duration, interval) * .875 - 1e-9,
        'catch-up cannot become a burst');
      delay = when - point.time;
      previous = { when, duration: point.duration };
      now = when - .055;
    }
    assert.ok(Math.abs(delay) < 1e-8, `tempo ${from}→${to}, subdivisions ${subdivisions}: no lasting clock offset`);
    assert.equal(committed.time, 9 / 4 * 60 / from + .3 / 4 * 60 / from);
  }
});

test('read-path preset changes remap ordinal units without moving the next pulse far away', () => {
  const clock = new RubixoidsClock({ now: () => 0, tempo: 120, swing: .3 });
  clock.play({ leadSeconds: 0 });
  assert.equal(rubixRetimedOrdinal(null, 3, 1), null);
  for (const from of [1, 3]) for (const to of [1, 3]) for (let ordinal = 24; ordinal < 42; ordinal += 1) {
    const remapped = rubixRetimedOrdinal(ordinal, from, to);
    const before = clock.grid(ordinal, { division: 4, subdivisions: from });
    const after = clock.grid(remapped, { division: 4, subdivisions: to });
    assert.ok(after.time >= before.time - 1e-9);
    assert.ok(after.time - before.time <= Math.max(before.pulseDuration, after.pulseDuration) / to + 1e-9);
    if (ordinal % from === 0) assert.ok(Math.abs(after.time - before.time) < 1e-9);
  }
});
