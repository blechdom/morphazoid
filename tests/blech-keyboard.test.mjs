import test from 'node:test';
import assert from 'node:assert/strict';
import { blackMidiKeyLayout, blackMidiKeyboardPitch, createBlackMidiKeyboardState } from '../src/instruments/blech-midi/blech-midi-black-renderer.js';

test('every visible piano key is playable, including black overlays and the extreme pitches', () => {
  const layout = blackMidiKeyLayout();
  for (let pitch = 0; pitch < 128; pitch++) {
    const key = layout[pitch], x = key.x + key.width / 2;
    assert.equal(blackMidiKeyboardPitch(x, key.black ? .2 : .9), pitch, `pitch ${pitch}`);
  }
  const sharp = layout[61];
  assert.equal(blackMidiKeyboardPitch(sharp.x + sharp.width * .25, .2), 61);
  assert.equal(blackMidiKeyboardPitch(sharp.x + sharp.width * .25, .9), 60);
  assert.equal(blackMidiKeyboardPitch(sharp.x + sharp.width * .75, .9), 62);
  assert.equal(blackMidiKeyboardPitch(0, 1), 0);
  assert.equal(blackMidiKeyboardPitch(1, 1), 127);
});

test('equal lanes keep all 128 pitches across the entire band and reject outside/nonfinite points', () => {
  for (let pitch = 0; pitch < 128; pitch++) {
    for (const y of [0, .2, .9, 1]) assert.equal(blackMidiKeyboardPitch((pitch + .5) / 128, y, 'equal'), pitch);
  }
  for (const [x, y] of [[-.001, .5], [1.001, .5], [.5, -.001], [.5, 1.001], [NaN, .5], [.5, Infinity]]) {
    assert.equal(blackMidiKeyboardPitch(x, y), null);
    assert.equal(blackMidiKeyboardPitch(x, y, 'equal'), null);
  }
});

function fixture(extra = {}) {
  const events = [];
  const state = createBlackMidiKeyboardState({
    onNoteOn: event => events.push({ type: 'on', ...event }),
    onNoteOff: event => events.push({ type: 'off', ...event }), ...extra,
  });
  return { state, events };
}

test('hover holds a key without retrigger, glissando releases before attack, exit releases once', () => {
  const { state, events } = fixture();
  state.play('mouse', 60); state.play('mouse', 60); state.play('mouse', 61);
  assert.deepEqual(events.map(({ type, note }) => [type, note]), [['on', 60], ['off', 60], ['on', 61]]);
  assert.deepEqual(state.notes, [61]);
  state.play('mouse', null); state.release('mouse');
  assert.deepEqual(events.at(-1), { type: 'off', sourceId: 'mouse', note: 61 });
  assert.equal(events.length, 4); assert.deepEqual(state.notes, []);
});

test('two touches own independent releases, including when they hold the same pitch', () => {
  const { state, events } = fixture();
  state.play('touch:1', 60); state.play('touch:2', 60); state.release('touch:1');
  assert.deepEqual(state.notes, [60]);
  assert.equal(events.at(-1).sourceId, 'touch:1');
  state.releaseAll(); state.releaseAll();
  assert.deepEqual(state.notes, []);
  assert.deepEqual(events.map(event => event.sourceId), ['touch:1', 'touch:2', 'touch:1', 'touch:2']);
});

test('release on mute/blur/disposal never queues stale input and source count is bounded', () => {
  const { state, events } = fixture();
  for (let pointer = 0; pointer < 20; pointer++) state.play(`touch:${pointer}`, pointer);
  assert.equal(state.notes.length, 16); assert.equal(events.length, 16);
  state.play('touch:0', 127); // An existing pointer can still move at the cap.
  assert.equal(state.notes.length, 16); assert.ok(state.notes.includes(127));
  state.releaseAll(); assert.equal(events.filter(event => event.type === 'on').length, events.filter(event => event.type === 'off').length);
  state.play('touch:0', 60); assert.deepEqual(state.notes, [60]);
});

test('audio callback failure cannot retain stuck renderer ownership or interrupt cleanup', () => {
  const state = createBlackMidiKeyboardState({ onNoteOn() { throw new Error('Audio unavailable'); }, onNoteOff() { throw new Error('Processor disposed'); } });
  assert.doesNotThrow(() => { state.play('pointer', 60); state.play('pointer', 127); state.releaseAll(); });
  assert.deepEqual(state.notes, []);
});
