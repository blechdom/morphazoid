import assert from "node:assert/strict";
import test from "node:test";
import { AutomatapoeiaClock, AUTOMATA_START_LEAD } from "../src/instruments/cellular-automata/automatapoeia-clock.js";
import { automatapoeiaSwingInterval, buildAutomatapoeiaEvents } from "../src/instruments/cellular-automata/automatapoeia.js";

function harness({ rate = 12, swing = 0 } = {}) {
  let time = 0, generation = 0;
  const events = [], views = [], timers = new Map();
  const clock = new AutomatapoeiaClock({
    now: () => time,
    advance(when, audible) {
      const interval = automatapoeiaSwingInterval(generation, rate, swing);
      events.push({ when, audible, generation });
      return { interval, view: generation++ };
    },
    present: (view, elapsed) => views.push({ view, elapsed }),
    setTimer(callback) { timers.set(1, callback); return 1; },
    clearTimer: id => timers.delete(id),
  });
  function tick(next) {
    time = next;
    const callback = timers.get(1);
    timers.delete(1);
    callback?.();
  }
  return { clock, events, views, timers, tick };
}

test("Time spread zero means every note in a row starts on the same sample", () => {
  for (const phraseShape of ["bands", "centers"]) {
    const plan = buildAutomatapoeiaEvents([1, 0, 1, 0, 1, 0, 1, 0, 1], { timeSpread: 0, swing: 0, phraseShape, detail: 16 });
    assert.ok(plan.events.length > 1);
    // The existing instrument centers a zero-spread chord within its row.
    // Preserve that offset; simultaneity means equal sample indices, not zero.
    assert.ok(plan.events.every(event => event.startFrame === Math.round(plan.frameCount / 2)));
  }
});

test("audio-clock lookahead stays on its grid through 240ms timer/render stalls without RAF", () => {
  const { clock, events, tick } = harness();
  clock.start();
  for (let time = 0.24; time < 8; time += 0.24) tick(time);
  assert.ok(events.length > 90);
  events.forEach((event, index) => {
    assert.equal(event.audible, true);
    assert.ok(Math.abs(event.when - (AUTOMATA_START_LEAD + index / 12)) < 1e-10);
  });
});

test("swing remains deliberate, bounded and phase-accurate", () => {
  const { clock, events, tick } = harness({ rate: 16, swing: 0.42 });
  clock.start();
  for (let time = 0.012; time < 10; time += 0.012) tick(time);
  for (let i = 1; i < events.length; i++) {
    assert.ok(Math.abs(events[i].when - events[i - 1].when - automatapoeiaSwingInterval(i - 1, 16, 0.42)) < 1e-10);
  }
});

test("presentations never run ahead of their scheduled audio", () => {
  const { clock, views, tick } = harness();
  clock.start();
  assert.equal(views.length, 0);
  tick(0.08);
  assert.equal(views.at(-1).view, 0);
  tick(0.3);
  assert.equal(views.at(-1).view, 2);
});

test("overloads beyond the buffer skip stale attacks without tempo rebasing or catch-up bursts", () => {
  const { clock, events, tick } = harness();
  clock.start();
  tick(2);
  assert.ok(events.some(event => !event.audible));
  events.forEach((event, index) => assert.ok(Math.abs(event.when - (AUTOMATA_START_LEAD + index / 12)) < 1e-10));
  const added = events.slice(4).filter(event => event.audible);
  assert.ok(added.every(event => event.when >= 2.004));
  assert.ok(clock.queue.length <= 5);
});

test("stop/restart owns one timer, clears queued visual state, and leaves no callbacks", () => {
  const { clock, timers, events, tick } = harness();
  clock.start();
  clock.start();
  assert.equal(timers.size, 1);
  clock.stop();
  const count = events.length;
  tick(1);
  assert.equal(events.length, count);
  assert.equal(timers.size, 0);
  assert.equal(clock.queue.length, 0);
  assert.equal(clock.current, null);
});
