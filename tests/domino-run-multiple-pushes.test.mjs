import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRun, compileRun, createRunSimulation, MAX_COMPILED_PUSHES,
  RUN_HISTORY_LIMITS } from '../src/instruments/domino-run/domino-run-model.js';

const block = (id, x, z = 0) => ({ id, x, z, elevation: 0, height: 1.2,
  width: .6, depth: .192, angle: 0, material: 'stone', color: '#aaa' });
const independent = () => ({ params: {}, roots: [0],
  dominoes: [block(0, 0), block(1, .64), block(2, 1.28), block(3, 1.92),
    block(4, 0, 3), block(5, .64, 3), block(6, 1.28, 3), block(7, 1.92, 3)],
  links: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 },
    { from: 4, to: 5 }, { from: 5, to: 6 }, { from: 6, to: 7 }] });
const isolated = () => ({ params: {}, roots: [0], dominoes: [block(0, 0), block(1, 3)], links: [] });
const advanceTo = (simulation, time) => {
  let chunks = 0;
  while (!simulation.advance(time).complete) {
    if (++chunks > 100) throw new Error('Unexpected unbounded advance');
  }
};
const state = simulation => ({ events: simulation.events, falls: simulation.falls,
  time: simulation.time, endTime: simulation.endTime, hasPending: simulation.hasPending,
  nextTime: simulation.nextTime, pendingCount: simulation.pendingCount,
  reachableCount: simulation.reachableCount, blockedLinks: simulation.blockedLinks,
  lastFalls: [...simulation.lastFalls] });

test('a finite manual push adds an independent wave without replacing earlier falls', () => {
  const run = independent(), baseline = compileRun(run);
  const pushes = Object.freeze([Object.freeze({ id: 4, time: .18, force: 1 })]);
  const combined = compileRun(run, { pushes });
  assert.deepEqual(combined.falls.filter(fall => fall.id < 4), baseline.falls);
  assert.equal(combined.falls.find(fall => fall.id === 4).start, .18);
  assert.equal(combined.reachableCount, 8);
  assert.deepEqual(combined.stalledIds, []);
  assert.ok(combined.events.some(event => event.id === 0 && event.time > .18), 'the original wave continues');
  assert.ok(combined.events.some(event => event.id === 4 && event.time > .18), 'the added wave sounds too');
  assert.deepEqual(Object.keys(combined).sort(), Object.keys(baseline).sort());
  assert.ok(combined.events.every(event => !('eventId' in event) && !('occurrenceId' in event)));
  assert.ok(combined.falls.every(fall => !('standEnd' in fall) && !('occurrenceId' in fall)));
});

test('simultaneous independent pushes merge into a shared target only once', () => {
  const run = { params: {}, roots: [], dominoes: [block(0, 0, -.1), block(1, 0, .1), block(2, .64), block(3, 1.28)],
    links: [{ from: 0, to: 2 }, { from: 1, to: 2 }, { from: 2, to: 3 }] };
  const score = compileRun(run, { pushes: [{ id: 0, time: .2 }, { id: 1, time: .2 }] });
  assert.equal(score.falls.length, 4);
  assert.deepEqual(score.falls.slice(0, 2).map(fall => [fall.id, fall.start]), [[0, .2], [1, .2]]);
  assert.equal(score.falls.filter(fall => fall.id === 2).length, 1);
  assert.equal(score.events.filter(event => event.type === 'contact' && event.targetId === 2).length, 1);
  assert.equal(score.falls.filter(fall => fall.id === 3).length, 1);
});

test('finite compilation rejects pushes to falling or fallen tiles and honors model-time offsets', () => {
  const run = isolated(), baseline = compileRun(run);
  const repeated = compileRun(run, { pushes: [{ id: 0, time: .01 }, { id: 0, time: 20 }] });
  assert.deepEqual(repeated, baseline);
  const later = compileRun({ ...run, params: { autoStand: true, speed: 2.4 } }, {
    pushes: [{ id: 1, time: 3, force: .8 }],
  });
  assert.equal(later.falls.find(fall => fall.id === 1).start, 3);
  assert.equal(later.falls.find(fall => fall.id === 0).duration, baseline.falls[0].duration);
  assert.ok(later.duration > 3);
});

test('manual records sort chronologically without mutation and retain first-push ordering at a tie', () => {
  const run = independent();
  const ordered = [{ id: 4, time: .1, force: .7 }, { id: 2, time: .2, force: 1.3 }];
  assert.deepEqual(compileRun(run, { pushes: [...ordered].reverse() }), compileRun(run, { pushes: ordered }));
  const tie = compileRun(isolated(), { startIds: [], pushes: [
    { id: 0, time: .2, force: .7 }, { id: 0, time: .2, force: 1.3 },
  ] });
  assert.deepEqual(tie, compileRun(isolated(), { startIds: [], pushes: [{ id: 0, time: .2, force: .7 }] }));
});

test('manual record inspection is bounded and empty or malformed offsets preserve the baseline path', () => {
  const run = independent(), baseline = compileRun(run);
  for (const pushes of [undefined, null, [], [null, { id: 4, time: NaN }, { id: 4, time: Infinity }, { id: 4, time: -.1 }]]) {
    assert.deepEqual(compileRun(run, { pushes }), baseline);
  }
  const pushes = Array.from({ length: MAX_COMPILED_PUSHES }, () => ({ id: -1, time: 0 }));
  pushes.push({ id: 4, time: .2 });
  assert.equal(compileRun(run, { pushes }).falls.some(fall => fall.id === 4), false);
  assert.equal(compileRun(run, { pushes: [{ id: 4, time: .2, force: 0 }] }).falls.some(fall => fall.id === 4), false);
});

test('fork preserves pending floor impacts, recovery, history aliases and all assigned IDs', () => {
  const simulation = createRunSimulation(isolated(), { autoStand: true, standDelay: .1, speed: 2.4 });
  advanceTo(simulation, .01);
  assert.equal(simulation.events.length, 0, 'the first floor sound is still pending');
  const child = simulation.fork();
  assert.deepEqual(state(child), state(simulation));
  assert.notEqual(child.falls, simulation.falls);
  assert.notEqual(child.falls[0], simulation.falls[0]);
  assert.notEqual(child.falls[0].times, simulation.falls[0].times);
  assert.equal(child.lastFalls.get(0), child.falls[0]);
  const ready = simulation.falls[0].standEnd;
  for (let time = .02; time < ready + .1; time += .023) advanceTo(simulation, time);
  advanceTo(simulation, ready + .1);
  advanceTo(child, ready + .1);
  assert.deepEqual(state(child), state(simulation));
  assert.equal(child.events[0].eventId, 1);
  assert.equal(child.events[0].occurrenceId, 1);
  assert.equal(child.trigger([0], ready + .1), 1);
  advanceTo(child, ready + 1);
  advanceTo(simulation, ready + 1);
  assert.equal(child.falls.length, 2);
  assert.equal(simulation.falls.length, 1, 'a branch trigger cannot change its parent');
  assert.equal(child.falls[1].occurrenceId, 2);
  assert.equal(child.events[1].eventId, 2);
});

test('fork retains manualQueued identity so future triggers deduplicate and clear after processing', () => {
  const simulation = createRunSimulation(isolated(), { startIds: [], autoStand: true, standDelay: .1, speed: 2.4 });
  assert.equal(simulation.trigger([0], .5), 1);
  assert.equal(simulation.trigger([1], .8), 1);
  advanceTo(simulation, .2);
  const child = simulation.fork();
  assert.equal(child.trigger([0], .6), 0);
  assert.equal(simulation.trigger([0], .6), 0);
  advanceTo(simulation, 2); advanceTo(child, 2);
  assert.deepEqual(state(child), state(simulation));
  assert.equal(child.trigger([0], 2), 1, 'processing the cloned heap entry removes its matching pending-map entry');
  assert.equal(simulation.trigger([0], 2), 1);
  advanceTo(child, 3); advanceTo(simulation, 3);
  assert.deepEqual(state(child), state(simulation));
});

test('a committed simulation can accept a present push and fork a different future without rewinding', () => {
  const run = independent();
  const committed = createRunSimulation(run, { autoStand: false, speed: 1 });
  const oldFuture = committed.fork(); advanceTo(oldFuture, 4);
  advanceTo(committed, .18);
  const past = structuredClone(committed.events);
  const falls = structuredClone(committed.falls);
  assert.equal(oldFuture.trigger([4], .18), 0, 'the existing prediction has already advanced past the gesture');
  assert.equal(committed.trigger([4], .18), 1);
  const newFuture = committed.fork(); advanceTo(newFuture, 4);
  assert.deepEqual(committed.events, past);
  assert.deepEqual(committed.falls, falls);
  assert.equal(oldFuture.falls.some(fall => fall.id === 4), false);
  assert.equal(newFuture.falls.find(fall => fall.id === 4).start, .18);
  advanceTo(committed, 4);
  assert.deepEqual(state(newFuture), state(committed));
});

test('forks stay independent after pruning, external run mutation and chunked circulating schedules', () => {
  const run = buildRun({ count: 16, sizeVariation: 0, speed: 2.4, autoStand: true, standDelay: .1 });
  const simulation = createRunSimulation(run);
  advanceTo(simulation, 12); simulation.prune(11);
  const child = simulation.fork();
  run.dominoes[0].height = 4; run.dominoes[0].x += 100; run.links.length = 0;
  for (let time = 12.01; time < 22; time += .047) advanceTo(simulation, time);
  advanceTo(simulation, 22); advanceTo(child, 22);
  assert.deepEqual(state(child), state(simulation));
  const parentEvents = structuredClone(simulation.events);
  child.prune(21);
  assert.deepEqual(simulation.events, parentEvents);
  const first = child.falls[0], original = simulation.falls.find(fall => fall.occurrenceId === first.occurrenceId);
  first.times[1] += .1;
  assert.notEqual(first.times[1], original.times[1]);
});

test('fork copies bounded retained history rather than reviving discarded recurring events', () => {
  const simulation = createRunSimulation(buildRun({ count: 16, sizeVariation: 0, speed: 2.4, autoStand: true, standDelay: .1 }));
  advanceTo(simulation, 1800);
  assert.ok(simulation.events[0].eventId > 1, 'the run exceeded its retained event history');
  const child = simulation.fork();
  assert.equal(child.events.length, simulation.events.length);
  assert.equal(child.falls.length, simulation.falls.length);
  assert.ok(child.events.length <= RUN_HISTORY_LIMITS.events);
  assert.ok(child.falls.length <= RUN_HISTORY_LIMITS.falls);
  assert.ok(child.pendingCount <= 16 * 5);
  advanceTo(simulation, 1802); advanceTo(child, 1802);
  assert.deepEqual(state(child), state(simulation));
});
