import assert from 'node:assert/strict';
import test from 'node:test';

import { blechCombBlockNotes, blechCrossingNotes } from '../src/instruments/blech-midi-ultra/blech-midi-spigots.js';
import { createBlechLiveProjector } from '../src/instruments/blech-midi-ultra/blech-midi-live-score.js';
import {
  BlechRailClock, BLECH_RAIL_MAX_VOICES, normalizeBlechRailSource,
} from '../src/instruments/blech-midi-ultra/blech-midi-rail-clock.js';

const note = pitch => ({ note: pitch, beat: 0, duration: .25, velocity: 88 });
const source = (id, options, at = 0) => normalizeBlechRailSource({ id, ...options }, at);
const process = (clock, beats, tempo = 120) => clock.process(
  Math.round(beats * 60 / tempo * 48000), 48000, tempo);

test('128 simultaneous held pitches and a dense looping corner use separate clock lanes, not four sample slots', () => {
  const events = [], clock = new BlechRailClock({ emit: (event, frame) => events.push({ ...event, frame }) });
  for (let pitch = 0; pitch < 128; pitch++) {
    assert.ok(clock.add(source(`held:${pitch}`, {
      source: 'rail', held: true, notes: [note(pitch)], periodBeats: .25,
    })));
  }
  process(clock, .01);
  assert.equal(events.filter(event => event.kind === 9).length, 128);
  assert.equal(clock.active.size, 128);
  assert.ok(BLECH_RAIL_MAX_VOICES >= 128);
  clock.add(source('corner', {
    source: 'crossing', notes: blechCrossingNotes(1, .125), periodBeats: .125,
  }, clock.beat));
  events.length = 0;
  process(clock, .25);
  assert.equal(events.filter(event => event.kind === 9 && event.sourceId === 'corner').length, 256,
    'two 128-key subdivisions each trigger on the audio clock');
  assert.equal(events.filter(event => event.kind === 8 && event.sourceId === 'corner').length, 256,
    'fast gates release in the same quantum even when shorter than the quantum');
  assert.equal(new Set(events.filter(event => event.kind === 9).map(event => event.channel)).size, 1);
  assert.equal(clock.active.size, 128, 'the 128 held pitches survive the corner note-offs');
  assert.equal(clock.skippedEvents, 0);
  clock.stopAll();
  assert.equal(clock.active.size, 0);
  assert.equal(clock.sources.size, 0);
  assert.equal(events.filter(event => event.kind === 8 && event.sourceId.startsWith('held:')).length, 128);
});

test('a positionable left-rail block plays once through time, then frees the bus', () => {
  const events = [], clock = new BlechRailClock({ emit: (event, frame) => events.push({ ...event, frame }) });
  const block = blechCombBlockNotes(5, 1.25, 2);
  assert.equal(block.rows, 4);
  clock.add(source('block', { source: 'comb', notes: block.notes, delayBeats: block.delayBeats }));
  process(clock, 1);
  assert.equal(events.length, 0);
  process(clock, 1.5);
  const ons = events.filter(event => event.kind === 9);
  assert.equal(ons.length, block.notes.length);
  assert.deepEqual([...new Set(ons.map(event => event.beat))], [1.25, 1.5, 1.75, 2]);
  assert.equal(ons[0].channel, 16, 'comb and top rail occupy different synth lanes');
  assert.equal(clock.active.size, 0);
  assert.equal(clock.sources.size, 0);
  process(clock, 2);
  assert.equal(events.filter(event => event.kind === 9).length, block.notes.length, 'no implicit looping');
});

test('arming Audio late skips stale one-shot attacks instead of replaying a backlog', () => {
  const events = [], clock = new BlechRailClock({ emit: event => events.push(event) });
  process(clock, 4);
  const early = blechCombBlockNotes(1, 0, 2);
  clock.add(source('expired', { source: 'comb', notes: early.notes, delayBeats: early.delayBeats }));
  clock.add(source('held', { source: 'rail', held: true, notes: [note(60)] }));
  process(clock, .25);
  assert.equal(events.filter(event => event.sourceId === 'expired').length, 0);
  assert.equal(events.filter(event => event.sourceId === 'held' && event.kind === 9).length, 1,
    'a persistent sustain joins at the current clock beat');
  assert.equal(clock.sources.has('expired'), false);
});

test('removal and pause release only the affected voices; a held rail rejoins after resume or bank load', () => {
  const events = [], clock = new BlechRailClock({ emit: event => events.push(event) });
  clock.add(source('one', { source: 'rail', notes: [note(60)], held: true }));
  clock.add(source('two', { source: 'rail', notes: [note(61)], held: true }));
  process(clock, .01);
  assert.equal(clock.active.size, 2);
  clock.pause('one', true);
  assert.deepEqual(events.filter(event => event.kind === 8).map(event => event.sourceId), ['one']);
  assert.equal(clock.active.size, 1);
  clock.pause('one', false);
  process(clock, .01);
  assert.equal(events.filter(event => event.kind === 9 && event.sourceId === 'one').length, 2);
  assert.equal(events.filter(event => event.kind === 9 && event.sourceId === 'two').length, 1);
  clock.rejoin();
  process(clock, .01);
  assert.equal(clock.active.size, 2);
  assert.equal(events.filter(event => event.kind === 9).length, 5);
  clock.remove('one');
  assert.equal(clock.active.size, 1);
  assert.deepEqual([...clock.active.values()].map(value => value.pitch), [61]);
});

test('invalid or oversized rail patterns fail before scheduling', () => {
  assert.throws(() => source('corner', { source: 'crossing', notes: Array(129).fill(note(1)) }), /valid rail/);
  assert.throws(() => source('block', { source: 'comb', notes: Array(4097).fill(note(1)) }), /too large/);
  assert.throws(() => source('bad', { source: 'rail', notes: [{ ...note(60), beat: 1 }] }), /starts at the rail/);
});

test('held squares draw immediately toward the keyboard; only the corner loops its visible chord', () => {
  const project = createBlechLiveProjector();
  const rails = [
    ...Array.from({ length: 128 }, (_, pitch) => source(`rail:${pitch}`, {
      source: 'rail', held: true, notes: [note(pitch)],
    })),
    source('corner', { source: 'crossing', notes: blechCrossingNotes(5, .25), periodBeats: .25 }),
    source('row', { source: 'comb', ...blechCombBlockNotes(5, 1.25, 1.75) }),
  ];
  const state = { rails, sampleBeat: 0, sampleTime: 0, tempo: 120, samples: [] };
  const visible = project(state, { lookAhead: 2, pastSeconds: 0, limit: 512 });
  assert.equal(visible.heldOutlines.length, 128, 'all pitches have an immediate rail-to-keyboard outline');
  assert.ok(visible.heldOutlines.every(outline => outline.fromRail && outline.start === 0));
  assert.equal(new Set(visible.heldOutlines.map(outline => outline.pitch)).size, 128);
  const corner = visible.notes.filter(value => value.source === 'corner');
  assert.deepEqual([...new Set(corner.map(value => value.start))].slice(0, 2), [0, .125]);
  const rows = visible.notes.filter(value => value.source === 'row');
  assert.deepEqual([...new Set(rows.map(value => value.start))], [.625, .75, .875]);
  assert.ok(rows.length > 0 && rows.length <= rails.at(-1).notes.length);
  assert.equal(project({ ...state, rails: rails.filter(rail => rail.id !== 'rail:60') },
    { lookAhead: 2, pastSeconds: 0, limit: 512 }).heldOutlines.length, 127);
  assert.equal(project({ ...state, rails: rails.map(rail => rail.id === 'rail:61' ? { ...rail, paused: true } : rail) },
    { lookAhead: 2, pastSeconds: 0, limit: 512 }).heldOutlines.length, 127);
});
