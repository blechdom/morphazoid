import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, PRESETS, sanitizeParams, buildRun, compileRun, createRunSimulation, angleAt,
  contactGeometry, STAND_RISE_SECONDS, RUN_HISTORY_LIMITS } from '../src/instruments/domino-run/domino-run-model.js';
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const isolated = () => {
  const run = buildRun(); run.dominoes = [run.dominoes[0]]; run.links = []; return run;
};
const stripEvent = ({ eventId, occurrenceId, ...event }) => event;
const stripFall = ({ occurrenceId, standStart, standEnd, ...fall }) => fall;
const eventSort = (a, b) => a.time - b.time || a.id - b.id || (a.type === 'contact' ? -1 : 1);

test('standing controls have complete safe defaults, bounds and preset state', () => {
  assert.equal(DEFAULT_PARAMS.autoStand, false); assert.equal(DEFAULT_PARAMS.standDelay, 1.5);
  assert.equal(sanitizeParams({ autoStand: 'yes', standDelay: Infinity }).autoStand, false);
  assert.equal(sanitizeParams({ standDelay: -.2 }).standDelay, .1);
  assert.equal(sanitizeParams({ standDelay: 100 }).standDelay, 12);
  assert.equal(STAND_RISE_SECONDS, .4);
  for (const preset of PRESETS) {
    assert.equal(typeof preset.params.autoStand, 'boolean');
    assert.ok(preset.params.standDelay >= .1 && preset.params.standDelay <= 12);
  }
});

test('Henge has an actual closing contact while one-shot compilation stays finite', () => {
  const run = buildRun({ autoStand: true });
  const closing = run.links.find(link => link.from === run.dominoes.length - 1 && link.to === 0);
  assert.ok(closing);
  assert.equal(contactGeometry(run.dominoes.at(-1), run.dominoes[0]).reachable, true);
  const once = compileRun(run);
  assert.equal(once.falls.length, run.dominoes.length);
  assert.equal(new Set(once.falls.map(f => f.id)).size, once.falls.length);
});

test('streaming with re-standing off matches the established one-shot impact model', () => {
  for (const layout of ['henge', 'fork', 'tapestry', 'stairs-up']) {
    const run = buildRun({ layout, count: 64, speed: 1 }), once = compileRun(run);
    const stream = createRunSimulation(run, { autoStand: false, speed: 1 });
    const result = stream.advance(once.duration + 1);
    assert.equal(result.complete, true); assert.equal(stream.hasPending, false);
    assert.deepEqual(stream.events.map(stripEvent).sort(eventSort), once.events);
    assert.deepEqual(stream.falls.map(stripFall), once.falls);
    close(stream.endTime, once.duration);
  }
});

test('a contact wave circulates at least three laps without a global reset or timer push', () => {
  const run = buildRun(), stream = createRunSimulation(run, { autoStand: true });
  const result = stream.advance(30);
  assert.equal(result.complete, true); assert.equal(stream.hasPending, true);
  assert.equal(stream.reachableCount, run.dominoes.length);
  const roots = stream.falls.filter(f => f.id === 0);
  assert.ok(roots.length >= 4);
  assert.equal(roots[0].start, 0);
  for (const fall of stream.falls.slice(1)) {
    assert.ok(stream.events.some(e => e.type === 'contact' && e.targetId === fall.id && Math.abs(e.time - fall.start) < 1e-8));
  }
  for (let i = 1; i < roots.length; i++) {
    assert.ok(roots[i].start >= roots[i - 1].standEnd);
    const contact = stream.events.find(e => e.targetId === 0 && Math.abs(e.time - roots[i].start) < 1e-8);
    assert.equal(contact.id, run.dominoes.length - 1);
  }
  assert.equal(new Set(stream.falls.map(f => f.occurrenceId)).size, stream.falls.length);
});

test('chunk size does not change recurrence, contact eligibility, timing or event identity', () => {
  const run = buildRun({ count: 24 }), options = { autoStand: true, standDelay: .6, speed: 1.6 };
  const whole = createRunSimulation(run, options), chunks = createRunSimulation(run, options);
  const expected = whole.advance(32), events = [], falls = [];
  for (let step = 0; step <= 320; step++) {
    const until = step / 10, delta = chunks.advance(until);
    assert.equal(delta.complete, true);
    assert.ok(delta.events.every(e => e.time <= until));
    events.push(...delta.events); falls.push(...delta.falls);
  }
  assert.deepEqual(events, expected.events); assert.deepEqual(falls, expected.falls);
  assert.deepEqual(chunks.blockedLinks, whole.blockedLinks);
  assert.deepEqual(chunks.advance(32).events, []);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].time >= events[i - 1].time);
    assert.equal(events[i].eventId, events[i - 1].eventId + 1);
  }
});

test('future floor sounds stay pending and survive pruning until their scheduled time', () => {
  const stream = createRunSimulation(isolated(), { autoStand: true });
  const first = stream.advance(0), fall = first.falls[0], landing = fall.start + fall.duration;
  assert.equal(first.events.length, 0);
  assert.equal(stream.pendingCount, 2);
  stream.prune(20);
  assert.equal(stream.advance(landing - 1e-7).events.length, 0);
  const due = stream.advance(landing).events;
  assert.equal(due.length, 1); assert.equal(due[0].type, 'floor');
  assert.equal(due[0].occurrenceId, fall.occurrenceId);
  assert.equal(stream.events[0], due[0]);
  assert.equal(stream.advance(landing + .1).events.length, 0);
});

test('each tile stays down for the real-time delay then rises for exactly .4 seconds', () => {
  for (const speed of [.35, 1, 2.4]) {
    const stream = createRunSimulation(isolated(), { autoStand: true, standDelay: 1.5, speed });
    const fall = stream.advance(0).falls[0], landing = fall.start + fall.duration;
    close(fall.standStart - landing, 1.5); close(fall.standEnd - fall.standStart, .4);
    close(angleAt(fall, landing), Math.PI / 2);
    close(angleAt(fall, fall.standStart), Math.PI / 2);
    close(angleAt(fall, fall.standStart + .2), Math.PI / 4);
    close(angleAt(fall, fall.standEnd), 0);
    assert.equal(stream.trigger([fall.id], fall.standEnd - 1e-6), 0);
    assert.equal(stream.trigger([fall.id], fall.standEnd), 1);
    const second = stream.advance(fall.standEnd).falls[0];
    close(second.start, fall.standEnd);
    assert.notEqual(second.occurrenceId, fall.occurrenceId);
  }
  const a = createRunSimulation(isolated(), { speed: 1 }).advance(0).falls[0];
  const b = createRunSimulation(isolated(), { speed: 2 }).advance(0).falls[0];
  close(a.duration / b.duration, 2);
});

test('a wave that meets an unready tile dies; re-standing never restarts it by itself', () => {
  const run = buildRun({ count: 16 }), stream = createRunSimulation(run, { autoStand: true, standDelay: 12, speed: 2.4 });
  stream.advance(50);
  assert.equal(stream.falls.length, 16);
  assert.equal(stream.hasPending, false); assert.equal(stream.nextTime, Infinity);
  assert.ok(stream.blockedLinks.some(link => link.from === 15 && link.to === 0 && link.reason === 'not standing'));
  assert.equal(stream.endTime, Math.max(...stream.falls.map(f => f.standEnd)));
  assert.equal(stream.duration, stream.endTime);
  assert.ok(stream.falls.every(f => angleAt(f, 50) === 0));
  assert.deepEqual(stream.advance(500).events, []);
  assert.equal(stream.falls.length, 16);
});

test('pruning preserves the audible pose plus future falls and does not change pending recurrence', () => {
  const run = buildRun({ count: 16 }), options = { autoStand: true, standDelay: .1 };
  const stream = createRunSimulation(run, options), reference = createRunSimulation(run, options);
  stream.advance(20); reference.advance(20);
  const previous = new Map();
  for (const fall of stream.falls) if (fall.start < 9) previous.set(fall.id, fall);
  const future = stream.falls.filter(f => f.start >= 9);
  stream.prune(9);
  for (const fall of [...previous.values(), ...future]) assert.ok(stream.falls.includes(fall));
  assert.equal(stream.falls.length, previous.size + future.length);
  assert.ok(stream.events.every(e => e.time >= 9));
  assert.deepEqual(stream.advance(30), reference.advance(30));
  assert.deepEqual([...stream.lastFalls], [...reference.lastFalls]);
});

test('huge advances yield explicitly, resume losslessly and bound retained state', () => {
  const stream = createRunSimulation(buildRun({ count: 16 }), { autoStand: true, standDelay: .1, speed: 2.4 });
  const first = stream.advance(1e7);
  assert.equal(first.complete, false); assert.ok(first.time > 0 && first.time < 1e7);
  assert.equal(stream.hasPending, true);
  const lastEventId = first.events.at(-1).eventId;
  const second = stream.advance(1e7);
  assert.equal(second.complete, false); assert.ok(second.time > first.time);
  assert.equal(second.events[0].eventId, lastEventId + 1);
  assert.ok(stream.events.length <= RUN_HISTORY_LIMITS.events);
  assert.ok(stream.falls.length <= RUN_HISTORY_LIMITS.falls);
  assert.equal(stream.lastFalls.size, 16);
  assert.ok(stream.pendingCount <= 16 * 5);
  assert.throws(() => stream.advance(Infinity), /finite deadline/);
});

test('512-tile multiple-wave scheduling remains bounded at the shortest delay', () => {
  const run = buildRun({ count: 512, sizeVariation: 0 });
  const startIds = run.dominoes.filter((_, i) => i % 12 === 0).map(d => d.id);
  const stream = createRunSimulation(run, { autoStand: true, standDelay: .1, speed: 2.4, startIds });
  const ids = new Set();
  for (let step = 0; step <= 40; step++) {
    const delta = stream.advance(step / 10);
    assert.equal(delta.complete, true);
    assert.ok(stream.pendingCount <= 512 * 5);
    for (const event of delta.events) { assert.ok(!ids.has(event.eventId)); ids.add(event.eventId); }
    stream.prune(step / 10 - 1);
  }
  assert.equal(stream.reachableCount, 512);
  assert.ok(ids.size > 1024);
});

test('simulation snapshots geometry and rejects unsupported branching or past triggers', () => {
  const run = isolated(), control = createRunSimulation(run, { autoStand: true });
  const stream = createRunSimulation(run, { autoStand: true });
  run.dominoes[0].height *= 2; run.dominoes[0].x += 20;
  assert.deepEqual(stream.advance(2), control.advance(2));
  assert.equal(stream.trigger([0], 1), 0);
  const fork = buildRun({ count: 16 });
  fork.links = [{from:0,to:1},{from:0,to:2},{from:0,to:3}];
  assert.throws(() => createRunSimulation(fork), /at most two outgoing/);
  const empty = createRunSimulation({ params: {}, dominoes: [], links: [], roots: [] });
  assert.equal(empty.advance(10).complete, true); assert.equal(empty.hasPending, false);
  assert.equal(empty.duration, 0); assert.equal(empty.reachableCount, 0);
});
