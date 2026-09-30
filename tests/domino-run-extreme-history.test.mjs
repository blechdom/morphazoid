import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRun,createRunSimulation,RUN_HISTORY_LIMITS} from '../src/instruments/domino-run/domino-run-model.js';

function denseRun() {
  const run=buildRun({count:1024,size:.1,sizeVariation:0,speed:12,autoStand:true,standDelay:.05});
  // All-at-once starters end after one wave. These starters return just after
  // recovery and maintain enough concurrent waves to stress the full horizon.
  return createRunSimulation(run,{startIds:run.dominoes.filter((_,i)=>i%100===0).map(d=>d.id)});
}
function advanceThrough(sim,until) {
  const events=[],falls=[];let batches=0,result;
  do {
    result=sim.advance(until);events.push(...result.events);falls.push(...result.falls);
    assert.ok(++batches<100,'advance stays resumable and bounded');
  } while(!result.complete);
  return {events,falls};
}

test('maximum-density five-second history retains the audible present and every upcoming event',()=>{
  const sim=denseRun(),fresh=advanceThrough(sim,5),now=1;
  assert.ok(fresh.events.length>16384,'the fixture must exceed the old event limit');
  assert.ok(fresh.falls.length>8192,'the fixture must exceed the old pose limit');
  assert.ok(sim.hasPending,'the fixture must remain a circulating run');
  sim.prune(now-1);
  const earliest=fresh.events.find(event=>event.time>=now);
  assert.ok(earliest);
  assert.ok(sim.events.some(event=>event.eventId===earliest.eventId),
    `the earliest future attack at ${earliest.time} must survive the four-second lookahead`);
  assert.deepEqual(sim.events.filter(event=>event.time>=now),fresh.events.filter(event=>event.time>=now));
  const poses=new Map();for(const fall of fresh.falls)if(fall.start<=now)poses.set(fall.id,fall);
  const retained=new Set(sim.falls.map(fall=>fall.occurrenceId));
  assert.equal(poses.size,1024);
  for(const pose of poses.values())assert.ok(retained.has(pose.occurrenceId),`audible pose for tile ${pose.id} must survive`);
  assert.ok(sim.events.length<=RUN_HISTORY_LIMITS.events);
  assert.ok(sim.falls.length<=RUN_HISTORY_LIMITS.falls);
});

test('a dense full-horizon fork remains exact and independently prunable',()=>{
  const sim=denseRun();advanceThrough(sim,5);const fork=sim.fork();
  advanceThrough(sim,5.5);advanceThrough(fork,5.5);
  assert.deepEqual(fork.events,sim.events);assert.deepEqual(fork.falls,sim.falls);
  assert.deepEqual([...fork.lastFalls],[...sim.lastFalls]);
  assert.equal(fork.pendingCount,sim.pendingCount);assert.equal(fork.nextTime,sim.nextTime);
  const parentEvents=structuredClone(sim.events);fork.prune(4.5);assert.deepEqual(sim.events,parentEvents);
  assert.ok(fork.events.length<=RUN_HISTORY_LIMITS.events);
  assert.ok(fork.falls.length<=RUN_HISTORY_LIMITS.falls);
});
