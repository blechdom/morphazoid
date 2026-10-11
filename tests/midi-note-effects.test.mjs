import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MIDI_NOTE_EFFECTS, MIDI_NOTE_CHORDS, MidiNoteEffects,
  midiNoteEffectChildren, sanitizeMidiNoteEffects } from '../src/midi-note-effects.js';

function fixture(options) { const events = []; return { events, fx: new MidiNoteEffects({ emit: event => events.push(event), ...options }) }; }
const compact = events => events.map(({ type, note, velocity, time }) => [type, note, velocity, Number(time.toFixed(8))]);
const ons = events => events.filter(event => event.type === 'noteOn');
const offs = events => events.filter(event => event.type === 'noteOff');
function balanced(events) {
  const attacks = new Map();
  for (const event of events) {
    assert.ok(Number.isFinite(event.time)); assert.ok(event.note >= 0 && event.note <= 127);
    if (event.type === 'noteOn') { assert.ok(!attacks.has(event.id)); attacks.set(event.id, event); }
    else { const start = attacks.get(event.id); assert.ok(start, `release ${event.id} has a unique attack`);
      assert.equal(event.note, start.note); assert.equal(event.channel, start.channel); assert.ok(event.time >= start.time);
      assert.equal(event.release, true); assert.equal(event.releaseCount, 1); attacks.delete(event.id); }
  }
  assert.equal(attacks.size, 0);
}

test('config sanitization is bounded, complete, immutable by callers and merges tempo without resetting effects', () => {
  assert.deepEqual(sanitizeMidiNoteEffects(), DEFAULT_MIDI_NOTE_EFFECTS);
  assert.deepEqual(Object.keys(MIDI_NOTE_CHORDS), ['single', 'octave', 'fifth', 'major', 'minor']);
  const { fx } = fixture(); fx.configure({ enabled: true, transpose: 12, chord: 'major', echoCount: 2 });
  fx.configure({ tempo: 4800 }); assert.equal(fx.config.transpose, 12); assert.equal(fx.config.echoCount, 2); assert.equal(fx.config.tempo, 4800);
  const config = fx.config; config.transpose = -99; assert.equal(fx.config.transpose, 12);
  assert.deepEqual(sanitizeMidiNoteEffects({ enabled: 'true', transpose: 1e8, velocity: -5, chord: '__proto__', delayBeats: 10,
    gateBeats: -.5, echoCount: 100, echoBeats: 0, echoDecay: 10, drums: true, tempo: .01 }),
  { enabled: false, transpose: 24, velocity: .25, chord: 'single', delayBeats: 1, gateBeats: .0625, echoCount: 4, echoBeats: .0625, echoDecay: .9, drums: true, tempo: 1 });
  assert.equal(sanitizeMidiNoteEffects({ tempo: Infinity }).tempo, 120);
  assert.equal(sanitizeMidiNoteEffects({ gateBeats: 0 }).gateBeats, 0);
});

test('disabled effects preserve MIDI identity and FIFO note ownership, including zero-velocity noteOn', () => {
  const { fx, events } = fixture();
  fx.configure({ transpose: 24, chord: 'major', velocity: 2, delayBeats: 1, gateBeats: .5, echoCount: 4 });
  fx.noteOn(0, 60, 90, 1); fx.noteOn(0, 60, 100, 1.1);
  fx.noteOff(0, 60, 1.2); fx.noteOn(0, 60, 0, 1.3);
  assert.deepEqual(compact(events), [['noteOn', 60, 90, 1], ['noteOn', 60, 100, 1.1], ['noteOff', 60, 0, 1.2], ['noteOff', 60, 0, 1.3]]);
  assert.equal(events[0].id, events[2].id); assert.equal(events[1].id, events[3].id); balanced(events);
  assert.equal(fx.stats.groups, 0); assert.equal(fx.nextTime, Infinity);
});

test('pure expansion and scheduled attacks agree exactly, excluding out-of-range pitches with bounded echo velocity', () => {
  const config = { enabled: true, transpose: 12, chord: 'major', delayBeats: .5, echoCount: 4, echoBeats: .25, echoDecay: .5, velocity: 2, tempo: 120 };
  const children = midiNoteEffectChildren(config, 60, 90); assert.equal(children.length, 15);
  assert.deepEqual(children.slice(0, 3).map(({ note, velocity, delaySeconds, gateSeconds }) => [note, velocity, delaySeconds, gateSeconds]), [[72, 127, .25, Infinity], [76, 127, .25, Infinity], [79, 127, .25, Infinity]]);
  const { fx, events } = fixture(); fx.configure(config); fx.noteOn(1, 60, 90, 10); fx.advance(12);
  assert.deepEqual(ons(events).map(event => [event.note, event.velocity, event.time - 10]), children.map(child => [child.note, child.velocity, child.delaySeconds]));
  fx.noteOff(1, 60, 12); fx.advance(15); balanced(events);
  assert.deepEqual(midiNoteEffectChildren(config, 127, 127), []);
  assert.deepEqual(midiNoteEffectChildren({ enabled: true, chord: 'major' }, 123, 127).map(child => child.note), [123, 127]);
  assert.deepEqual(midiNoteEffectChildren({ enabled: true, transpose: -7, chord: 'fifth' }, 0, 127).map(child => child.note), [0]);
  assert.deepEqual(midiNoteEffectChildren(config, NaN, 90), []);
});

test('out-of-range attacks retain bounded source ownership without replacing audible originals', () => {
  const { fx, events } = fixture({ maxGroups: 3, maxEvents: 2 });
  fx.noteOn(0, 60, 100, 0); fx.configure({ enabled: true, transpose: 24 });
  fx.noteOn(0, 127, 100, .1); assert.equal(fx.stats.groups, 2); assert.equal(fx.stats.active, 1);
  assert.equal(fx.noteOff(0, 127, .2), true); assert.equal(fx.stats.groups, 1); assert.equal(events.length, 1);
  fx.noteOff(0, 60, .3); balanced(events);
  for (let index = 0; index < 100; index++) fx.noteOn(0, 127, 100, 1 + index);
  assert.equal(fx.stats.groups, 3); assert.equal(fx.stats.reservedEvents, 0);
  fx.clear(200); assert.equal(fx.nextTime, Infinity); assert.equal(fx.stats.groups, 0);
});

test('activePitches retargets source pressure to sounding captured children only, deduplicating echoes', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, transpose: 12, chord: 'major', delayBeats: .5, echoCount: 1 });
  fx.noteOn(0, 60, 100, 0); fx.noteOn(1, 60, 100, 0);
  assert.deepEqual(fx.activePitches(0, 60), []); fx.advance(.25);
  assert.deepEqual(fx.activePitches(0, 60), [72, 76, 79]); assert.deepEqual(fx.activePitches(0, 72), []);
  fx.configure({ transpose: -12, chord: 'single', delayBeats: 0, echoCount: 0 }); fx.noteOn(0, 60, 100, .3);
  fx.advance(.5); assert.deepEqual(fx.activePitches(0, 60), [72, 76, 79, 48]);
  fx.noteOff(0, 60, .6); fx.advance(1.1); assert.deepEqual(fx.activePitches(0, 60), [48]);
  assert.deepEqual(fx.activePitches(1, 60), [72, 76, 79]);
  fx.clear(2); assert.deepEqual(fx.activePitches(0, 60), []); balanced(events);
});

test('held and delayed children retain their original pitch, echo offsets and tempo after live edits and bypass', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, transpose: 12, chord: 'major', delayBeats: .5, echoCount: 1, echoBeats: .25, tempo: 120 });
  fx.noteOn(0, 60, 100, 1, { key: 'a', source: 'deck:A' });
  assert.equal(fx.nextTime, 1.25);
  fx.configure({ enabled: false, transpose: -24, chord: 'minor', tempo: 4800 });
  fx.noteOff(0, 60, 1.1, { key: 'a' }); fx.advance(2);
  assert.deepEqual(ons(events).map(event => [event.note, event.time]), [[72, 1.25], [76, 1.25], [79, 1.25], [72, 1.375], [76, 1.375], [79, 1.375]]);
  assert.deepEqual(offs(events).map(event => [event.note, Number(event.time.toFixed(3))]), [[72, 1.35], [76, 1.35], [79, 1.35], [72, 1.475], [76, 1.475], [79, 1.475]]);
  assert.ok(events.every(event => event.meta.source === 'deck:A')); balanced(events);
  fx.noteOn(0, 61, 99, 3, { key: 'b' }); fx.noteOff(0, 61, 3.2, { key: 'b' });
  assert.equal(ons(events).at(-1).note, 61); balanced(events);
});

test('gate is an upper bound on natural duration and echo releases follow each delayed attack', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, delayBeats: 1, gateBeats: 1, echoCount: 1, echoBeats: .5 });
  fx.noteOn(0, 60, 100, 0); fx.noteOff(0, 60, .1); fx.advance(2);
  assert.deepEqual(compact(events), [['noteOn', 60, 100, .5], ['noteOff', 60, 0, .6], ['noteOn', 60, 50, .75], ['noteOff', 60, 0, .85]]);
  fx.noteOn(0, 62, 100, 3); fx.advance(5); fx.noteOff(0, 62, 8);
  assert.deepEqual(offs(events).filter(event => event.note === 62).map(event => event.time), [4, 4.25]);
  balanced(events); assert.equal(fx.nextTime, Infinity); assert.equal(fx.stats.groups, 0);
});

test('same pitch overlaps get distinct IDs and exactly one native FIFO release per sounded attack', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, chord: 'fifth', echoCount: 1, echoBeats: .5 });
  fx.noteOn(0, 60, 100, 0, { key: 'long' }); fx.noteOn(0, 67, 100, .1, { key: 'short' });
  fx.noteOff(0, 67, .2, { key: 'short' }); fx.noteOff(0, 60, 1, { key: 'long' }); fx.advance(2);
  assert.equal(ons(events).length, 8); assert.equal(offs(events).length, 8); balanced(events);
  assert.equal(offs(events).find(event => event.meta.key === 'short').time, .2);
});

test('drums keep their pitch and single voice by default, while timing and velocity still apply', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, transpose: 12, chord: 'major', velocity: .5, delayBeats: .5, echoCount: 1 });
  fx.noteOn(25, 38, 100, 0); fx.noteOff(25, 38, .1); fx.advance(1);
  assert.deepEqual(ons(events).map(event => [event.channel, event.note, event.velocity]), [[25, 38, 50], [25, 38, 25]]);
  fx.configure({ drums: true }); fx.noteOn(9, 38, 100, 2); fx.noteOff(9, 38, 2.1); fx.advance(3);
  assert.deepEqual(ons(events).slice(2).map(event => event.note), [50, 54, 57, 50, 54, 57]); balanced(events);
  fx.configure({ drums: false, echoCount: 0, delayBeats: 0 });
  fx.noteOn(9, 60, 100, 4, { drums: false }); fx.noteOff(9, 60, 4.1);
  assert.deepEqual(ons(events).slice(-3).map(event => event.note), [72, 76, 79]);
  fx.noteOn(0, 38, 100, 5, { drums: true }); fx.noteOff(0, 38, 5.1);
  assert.equal(ons(events).at(-1).note, 38); balanced(events);
});

test('clear cancels all future attacks without sounding overdue pending notes and releases existing children once', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, echoCount: 4, echoBeats: 1 });
  fx.noteOn(0, 60, 100, 0); assert.equal(ons(events).length, 1);
  fx.clear(2); assert.equal(ons(events).length, 1); assert.equal(offs(events).length, 1);
  fx.advance(100); fx.noteOff(0, 60, 101); fx.clear(102); balanced(events);
  assert.deepEqual(fx.stats, { groups: 0, active: 0, queued: 0, reservedEvents: 0, droppedAdditions: 0, steals: 0 }); assert.equal(fx.nextTime, Infinity);
});

test('scoped clear preserves other sources, their future echoes and their original key matching', () => {
  const { fx, events } = fixture(); fx.configure({ enabled: true, echoCount: 1, echoBeats: 1 });
  fx.noteOn(0, 60, 100, 0, { key: 'A:1', source: 'A' }); fx.noteOn(1, 60, 100, 0, { key: 'B:1', source: 'B' });
  fx.clear(.1, meta => meta.source === 'A'); fx.advance(.5);
  assert.equal(ons(events).filter(event => event.meta.source === 'A').length, 1);
  assert.equal(ons(events).filter(event => event.meta.source === 'B').length, 2);
  assert.equal(fx.noteOff(0, 60, .6, { key: 'A:1' }), false);
  assert.equal(fx.noteOff(1, 60, .6, { key: 'B:1' }), true); fx.advance(2); balanced(events);
});

test('dense input drops additions before originals and deterministically steals the oldest family within strict bounds', () => {
  const { fx, events } = fixture({ maxGroups: 4, maxEvents: 12 }); fx.configure({ enabled: true, chord: 'major', echoCount: 4, gateBeats: 1 });
  for (let index = 0; index < 2000; index++) {
    fx.noteOn(0, 48 + index % 40, 100, index / 1000, { key: index });
    assert.ok(fx.stats.groups <= 4); assert.ok(fx.stats.reservedEvents <= 12); assert.ok(fx.stats.queued <= 12); assert.ok(fx.stats.active <= 6);
    assert.ok(ons(events).some(event => event.meta.key === index), 'each original attack survives overload');
  }
  assert.ok(fx.stats.droppedAdditions > 0); assert.ok(fx.stats.steals > 0); fx.clear(3); balanced(events);
  const tiny = fixture({ maxGroups: 1, maxEvents: 2 }); tiny.fx.noteOn(0, 60, 100, 0); tiny.fx.noteOn(0, 62, 100, 1); tiny.fx.clear(2);
  assert.deepEqual(compact(tiny.events), [['noteOn', 60, 100, 0], ['noteOff', 60, 0, 1], ['noteOn', 62, 100, 1], ['noteOff', 62, 0, 2]]);
});

test('invalid events are ignored and rewound timestamps cannot reverse the emitted audio clock', () => {
  const { fx, events } = fixture();
  for (const args of [[NaN, 60, 100, 0], [0, Infinity, 100, 0], [0, 60, NaN, 0], [0, 60, 100, Infinity], [-1, 60, 100, 0], [4096, 60, 100, 0]]) assert.equal(fx.noteOn(...args), null);
  fx.advance(NaN); fx.clear(Infinity); assert.equal(events.length, 0);
  fx.noteOn(4095, 127, 127, 10); fx.noteOff(4095, 127, 1);
  assert.deepEqual(events.map(event => event.time), [10, 10]); balanced(events);
});
