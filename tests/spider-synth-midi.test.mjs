import test from 'node:test';
import assert from 'node:assert/strict';
import { SpiderMidiPerformance, SPIDER_MIDI_GESTURES, normalizeSpiderMidiMessage } from '../src/spider-synth-midi.js';
import { SPIDER_JOINTS, normalizeSpiderMotion, writeSpiderPose, createSpiderFrame, writeSpiderFrame, createSpiderWeb } from '../src/spider-synth-model.js';
const event = (type, values = {}) => ({ type, sourceId: 'keys', channel: 0, ...values });
const on = (m, note, time = 0, values = {}) => m.handle(event('noteOn', { note, velocity: 100, ...values }), time);
const off = (m, note, time = .1, values = {}) => m.handle(event('noteOff', { note, ...values }), time);
const cc = (m, controller, value, time = .1, values = {}) => m.handle(event('controlChange', { controller, value, ...values }), time);
const motion = normalizeSpiderMotion({ preset: 'none' });
function pose(m, time) { return m.applyPose(writeSpiderPose(0, motion, new Float32Array(114)), SPIDER_JOINTS, time); }

test('twelve pitch classes independently own eight legs and four face/body groups', () => {
  assert.deepEqual(SPIDER_MIDI_GESTURES.map(g => g.id), [ ...['left', 'right'].flatMap(side => [1,2,3,4].map(n => `leg_${side}_${n}`)), 'cephalothorax','abdomen','pedipalps','chelicerae' ]);
  for (let i = 0; i < 12; i++) {
    const m = new SpiderMidiPerformance(); on(m, 60 + i); const p = pose(m, .1);
    const changed = SPIDER_JOINTS.filter((joint, j) => p.slice(j * 3, j * 3 + 3).some(v => v !== 0));
    assert.ok(changed.length > 0, `note ${i} changes a pose`);
    for (const joint of changed) assert.ok(i < 8 ? joint.id.startsWith(SPIDER_MIDI_GESTURES[i].id) : joint.groupId === SPIDER_MIDI_GESTURES[i].groupId, `${i} must not move ${joint.id}`);
    assert.deepEqual(pose(m, 3), p, 'held key settles to a static posture');
    off(m, 60 + i, 4); assert.deepEqual(pose(m, 4.3), new Float32Array(114), 'release restores exact saved neutral');
  }
});

test('eight held leg notes remain individually posed with valid supported web contacts', () => {
  const m = new SpiderMidiPerformance(); for (let i = 0; i < 8; i++) on(m, 60 + i);
  const p = pose(m, .1), web = createSpiderWeb(); const frame = writeSpiderFrame(0, motion, web, createSpiderFrame(), p);
  assert.equal(m.getState(.1).heldCount, 8); assert.equal(frame.supportCount, 8);
  for (const foot of frame.feet) {
    const segment = web.segments[foot.segmentId], a = web.nodes[segment.a], b = web.nodes[segment.b];
    assert.ok(Math.abs(foot.x - a.x - (b.x - a.x) * foot.u) < 1e-8);
    assert.ok(Math.abs(foot.z - a.z - (b.z - a.z) * foot.u) < 1e-8); assert.equal(foot.y, 0);
  }
});

test('same notes from two devices/channels retain independent sustain and release ownership', () => {
  const m = new SpiderMidiPerformance(); on(m, 60); on(m, 60, 0, { sourceId: 'other', channel: 1 });
  cc(m, 64, 127); off(m, 60); off(m, 60, .1, { sourceId: 'other', channel: 1 });
  assert.equal(m.getState(.4).heldCount, 1); assert.equal(m.getState(.4).notes[0].sourceId, 'keys');
  cc(m, 64, 0, .5); assert.equal(m.getState(.8).activeCount, 0);
});

test('duplicate note counts, zero velocity and synthetic keyboard release do not strand poses', () => {
  const m = new SpiderMidiPerformance(); on(m, 69); on(m, 69, .01); off(m, 69, .1);
  assert.equal(m.getState(.2).heldCount, 1); cc(m, 64, 127, .2);
  off(m, 69, .3, { synthetic: true, reason: 'keyboard-hidden' }); assert.equal(m.getState(.6).activeCount, 0);
  on(m, 60, .7); on(m, 60, .8, { velocity: 0 }); cc(m, 64, 0, .9); assert.equal(m.getState(1.2).activeCount, 0);
  assert.equal(normalizeSpiderMidiMessage({ type: 'start' }), null);
});

test('CC body axes ramp smoothly and scoped reset clears only its owner', () => {
  const m = new SpiderMidiPerformance(); m.setControl('abdomen', 'x', 1, 0, { sourceId: 'a', channel: 0 });
  m.setControl('pedipalps', 'y', -.5, 0, { sourceId: 'b', channel: 1 });
  const start = pose(m, 0), held = pose(m, .1); assert.equal(start[3], 0); assert.ok(held[3] > 0); assert.ok(held[7] < 0);
  m.reset(.2, { sourceId: 'a' }); const after = pose(m, .4); assert.equal(after[3], 0); assert.equal(after[7], held[7]);
  m.reset(.5); assert.deepEqual(pose(m, .8), new Float32Array(114));
});

test('pitch bend and expression preserve source/channel isolation', () => {
  const m = new SpiderMidiPerformance(); on(m, 68); on(m, 69, 0, { channel: 1 });
  m.handle(event('pitchBend', { normalized: 1 }), .1); cc(m, 11, 32);
  const sample = m.sample(.2);
  assert.ok(Math.abs(sample.frequencies[1] - 440 * 2 ** ((68 - 69 + 2) / 12)) < 1e-8);
  assert.equal(sample.frequencies[2], 440); assert.equal(sample.expressions[1], 32 / 127); assert.equal(sample.expressions[2], 1);
});

test('serialization across context adoption retains held poses without replaying note ownership', () => {
  const m = new SpiderMidiPerformance(); on(m, 60, 5); on(m, 70, 5.01);
  m.setControl('abdomen', 'z', .7, 5.02); const before = pose(m, 5.2); const copy = new SpiderMidiPerformance();
  assert.equal(copy.restore(m.serialize()), true); copy.rebaseTime(-5);
  assert.deepEqual(pose(copy, .2), before); assert.equal(copy.getState(.2).heldCount, 2);
});

test('hostile MIDI streams stay bounded and finite; panic empties all ownership', () => {
  const m = new SpiderMidiPerformance();
  for (let i = 0; i < 300; i++) on(m, i % 128, i / 1000, { sourceId: `device-${i}`, channel: i % 16, velocity: 999 });
  assert.ok(m.getState(.5).activeCount <= 24); assert.ok(pose(m, .5).every(Number.isFinite));
  m.reset(.6); assert.equal(m.getState(.9).activeCount, 0); assert.deepEqual(pose(m, .9), new Float32Array(114));
});
