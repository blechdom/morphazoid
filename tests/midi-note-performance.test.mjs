import test from 'node:test';
import assert from 'node:assert/strict';
import { createMidiNotePerformance } from '../src/midi-manager.js';

function harness() {
  const events = [], active = new Map();
  const input = createMidiNotePerformance({
    onNoteOn: (id, note) => { events.push(['on', id, note]); active.set(id, note); },
    onNoteOff: id => { events.push(['off', id]); active.delete(id); },
    onNoteChange: (id, note) => { events.push(['change', id, note]); active.set(id, { ...active.get(id), ...note }); },
    onPanic: () => { events.push(['panic']); active.clear(); },
  });
  return { input, events, active, send: message => input.handle({ sourceId: 'a', channel: 0, ...message }) };
}
const on = (note = 60, velocity = 80) => ({ type: 'noteOn', note, velocity });
const cc = (controller, value) => ({ type: 'controlChange', controller, value });

test('velocity, expression and pressure belong to source/channel/note, not master controls', () => {
  const h = harness();
  h.send(on()); h.send({ ...on(), channel: 1 }); h.send({ ...on(), sourceId: 'b' });
  const [a, otherChannel, otherInput] = [...h.active.keys()];
  assert.equal(h.active.get(a).velocity, 80 / 127);
  h.send(cc(11, 40));
  assert.equal(h.active.get(a).velocity, (80 / 127) * (40 / 127));
  assert.equal(h.active.get(otherChannel).velocity, 80 / 127);
  assert.equal(h.active.get(otherInput).velocity, 80 / 127);
  h.send({ type: 'channelPressure', pressure: 127 });
  assert.equal(h.active.get(a).velocity, (80 / 127) * (40 / 127) * 1.5);
  h.send({ type: 'polyPressure', note: 60, pressure: 0 });
  assert.equal(h.active.get(a).velocity, (80 / 127) * (40 / 127));
  assert.equal(h.send(cc(7, 90)), false, 'explicit master CC7 remains available');
  assert.equal(h.send({ ...cc(11, 90), logical: { type: 'macro', index: 2 } }), false);
  assert.equal(h.send({ type: 'programChange', program: 1 }), false);
});

test('bend, sustain and controller reset preserve independent note ownership', () => {
  const h = harness();
  h.send(on()); h.send({ ...on(), channel: 1 });
  const [a, b] = [...h.active.keys()];
  h.send({ type: 'pitchBend', normalized: 1 });
  assert.equal(h.active.get(a).pitchRatio, 2 ** (2 / 12));
  assert.equal(h.active.get(b).pitchRatio, 1);
  h.send(cc(64, 127)); h.send(on(60, 0));
  assert.equal(h.active.size, 2);
  h.send(cc(121, 0));
  assert.equal(h.active.has(a), false);
  assert.equal(h.active.has(b), true);
  h.send(on());
  assert.equal(h.active.get(a).pitchRatio, 1);
  h.send(cc(123, 0));
  assert.equal(h.active.size, 1);
  h.send(cc(120, 0)); assert.equal(h.active.size, 0);
});

test('retrigger, velocity-zero, lifecycle reset and floods cannot leave stale ownership', () => {
  const h = harness();
  h.send(on()); h.send(on());
  assert.deepEqual(h.events.map(e => e[0]), ['on', 'off', 'on']);
  h.send(on(60, 0)); assert.equal(h.active.size, 0);
  for (let channel = 0; channel < 4; channel++) for (let note = 0; note < 128; note++) h.send({ ...on(note), channel });
  assert.equal(h.active.size, 128);
  h.send(cc(120, 0));
  for (let n = 0; n < 1000; n++) h.send({ ...cc(11, 2), sourceId: String(n) });
  h.input.reset(); h.send(on());
  assert.equal([...h.active.values()][0].velocity, 80 / 127);
});
