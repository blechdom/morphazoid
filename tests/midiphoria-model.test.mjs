import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VISUALS, MidiphoriaModel } from '../src/instruments/midiphoria/midiphoria-model.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const instant = options => new MidiphoriaModel({ attack: 0, decay: 0, sustain: 1, release: 0, ...options });
const note = (model, type, number, time, extra = {}) => model.handleMessage({
  type, channel: 0, sourceId: 'keyboard-a', note: number, velocity: 127, ...extra,
}, time);
const on = (model, number, time, extra) => note(model, 'noteOn', number, time, extra);
const off = (model, number, time, extra) => note(model, 'noteOff', number, time, extra);
const cc = (model, controller, value, time, extra = {}) => model.handleMessage({
  type: 'controlChange', controller, value, channel: 0, sourceId: 'keyboard-a', ...extra,
}, time);

test('defaults are immutable and models keep independent state', () => {
  assert.ok(Object.isFrozen(DEFAULT_VISUALS));
  const first = new MidiphoriaModel();
  const second = new MidiphoriaModel();
  on(first, 60, 0);
  assert.equal(first.sample(1).activeNotes.length, 1);
  assert.deepEqual(second.sample(1), { level: 0, rgb: [0, 0, 0], activeNotes: [], phase: 'idle', hueOffset: 0 });
  assert.equal(DEFAULT_VISUALS.release, 0.45);
});

test('ADSR phases use elapsed seconds even when no animation samples occur', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 2, sustain: 0.25, release: 4 });
  on(model, 60, 10);
  close(model.sample(10.5).level, 0.5);
  assert.equal(model.sample(11).phase, 'decay');
  close(model.sample(12).level, 0.625);
  close(model.sample(100).level, 0.25);
  assert.equal(model.sample(100).phase, 'sustain');
  off(model, 60, 100);
  close(model.sample(102).level, 0.125);
  assert.equal(model.sample(104).phase, 'idle');
  close(model.sample(10000).level, 0);
});

test('envelope phase lengths stay exact at low velocity', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 2, sustain: 0.5, release: 3 });
  on(model, 60, 0, { velocity: 64 });
  close(model.sample(0.5).level, 32 / 127);
  close(model.sample(1).level, 64 / 127);
  close(model.sample(3).level, 32 / 127);
  off(model, 60, 3);
  close(model.sample(4.5).level, 16 / 127);
  assert.equal(model.sample(6).phase, 'idle');
});

test('releasing during attack and retriggering during release are continuous', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 0, sustain: 1, release: 1 });
  on(model, 60, 0);
  off(model, 60, 0.4);
  close(model.sample(0.4).level, 0.4);
  close(model.sample(0.6).level, 0.32);
  on(model, 62, 0.6);
  close(model.sample(0.6).level, 0.32);
  close(model.sample(1.1).level, 0.66);
  close(model.sample(1.6).level, 1);
});

test('overlapping notes keep one gate and do not restart attack', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 0, sustain: 1, release: 1 });
  on(model, 60, 0);
  on(model, 64, 0.4);
  close(model.sample(0.4).level, 0.4);
  off(model, 60, 0.6);
  close(model.sample(1).level, 1);
  assert.equal(model.sample(1).activeNotes.length, 1);
  off(model, 64, 1);
  assert.equal(model.sample(1).phase, 'release');
});

test('same pitch on distinct channels and inputs retains separate ownership', () => {
  const model = instant();
  on(model, 60, 0);
  on(model, 60, 0, { channel: 1 });
  on(model, 60, 0, { sourceId: 'keyboard-b' });
  off(model, 60, 1);
  assert.equal(model.sample(1).activeNotes.length, 2);
  off(model, 60, 2, { channel: 1 });
  assert.equal(model.sample(2).activeNotes.length, 1);
  close(model.sample(2).level, 1);
  off(model, 60, 3, { sourceId: 'keyboard-b' });
  assert.equal(model.sample(3).phase, 'idle');
});

test('repeated note-ons balance releases and velocity-zero means note-off', () => {
  const model = instant();
  on(model, 60, 0);
  on(model, 60, 0.1);
  on(model, 60, 0.2, { velocity: 0 });
  assert.equal(model.sample(0.2).activeNotes.length, 1);
  off(model, 60, 0.3);
  assert.equal(model.sample(0.3).activeNotes.length, 0);
});

test('sustain is scoped to input and channel and preserves released notes', () => {
  const model = instant({ release: 1 });
  cc(model, 64, 127, 0);
  on(model, 60, 0);
  on(model, 60, 0, { channel: 1 });
  on(model, 60, 0, { sourceId: 'keyboard-b' });
  off(model, 60, 0.1);
  off(model, 60, 0.1, { channel: 1 });
  off(model, 60, 0.1, { sourceId: 'keyboard-b' });
  assert.deepEqual(model.sample(0.1).activeNotes, [{ note: 60, velocity: 127, channel: 0, sourceId: 'keyboard-a' }]);
  cc(model, 64, 0, 1, { channel: 1 });
  close(model.sample(1).level, 1);
  cc(model, 64, 0, 2);
  assert.equal(model.sample(2).activeNotes.length, 0);
  close(model.sample(2.5).level, 0.5);
});

test('synthetic keyboard releases bypass sustain and repeated-note counts', () => {
  const model = instant();
  cc(model, 64, 127, 0);
  on(model, 60, 0);
  on(model, 60, 0);
  off(model, 60, 1, { synthetic: true, reason: 'window-blur' });
  assert.equal(model.sample(1).phase, 'idle');
});

test('CC120 immediately clears its channel while leaving other channels alive', () => {
  const model = instant({ release: 10 });
  on(model, 60, 0);
  on(model, 62, 0, { channel: 1 });
  cc(model, 120, 0, 1);
  assert.equal(model.sample(1).activeNotes[0].channel, 1);
  close(model.sample(1).level, 1);
  cc(model, 120, 0, 2, { channel: 1 });
  assert.equal(model.sample(2).phase, 'idle');
  close(model.sample(2).level, 0);
});

test('scoped panic also silences a source that is already in its release tail', () => {
  const model = instant({ release: 10 });
  on(model, 60, 0);
  off(model, 60, 1);
  cc(model, 120, 0, 2, { sourceId: 'unrelated' });
  assert.equal(model.sample(2).phase, 'release');
  cc(model, 120, 0, 3);
  assert.equal(model.sample(3).phase, 'idle');
});

test('synthetic manager panic removes every channel of its source', () => {
  const model = instant({ release: 10 });
  on(model, 60, 0);
  on(model, 62, 0, { channel: 3 });
  on(model, 64, 0, { sourceId: 'keyboard-b' });
  cc(model, 120, 0, 1, { synthetic: true, reason: 'disconnected' });
  assert.deepEqual(model.sample(1).activeNotes.map(entry => entry.sourceId), ['keyboard-b']);
  cc(model, 120, 0, 2, { synthetic: true, sourceId: 'web-midi:manager', reason: 'disabled' });
  assert.equal(model.sample(2).phase, 'idle');
  assert.equal(model.sample(2).activeNotes.length, 0);
});

test('CC123 and releaseSource use release envelopes and clear pedal ownership', () => {
  const model = instant({ release: 2 });
  cc(model, 64, 127, 0);
  on(model, 60, 0);
  cc(model, 123, 0, 1);
  assert.equal(model.sample(1).activeNotes.length, 0);
  close(model.sample(2).level, 0.5);
  on(model, 60, 3);
  on(model, 64, 3, { channel: 2 });
  model.releaseSource('keyboard-a', 4);
  assert.equal(model.sample(4).activeNotes.length, 0);
  assert.equal(model.sample(4).phase, 'release');
  model.panic(4.5);
  assert.equal(model.sample(4.5).phase, 'idle');
});

test('mapped note and channel filters ignore unrelated attacks', () => {
  const model = instant({ trigger: 'mapped', mappedNumber: 64, mappedChannel: 2 });
  assert.equal(on(model, 60, 0, { channel: 2 }), false);
  assert.equal(on(model, 64, 0), false);
  assert.equal(on(model, 64, 0, { channel: 2 }), true);
  model.configure({ channel: 3 }, 1);
  assert.equal(model.sample(1).activeNotes.length, 0);
  assert.equal(on(model, 64, 1, { channel: 2 }), false);
  model.configure({ trigger: 'all' }, 1);
  assert.equal(on(model, 70, 1, { channel: 3 }), true);
});

test('mapped CC responds to value or a binary 64 threshold and respects source scope', () => {
  const model = instant({ trigger: 'mapped', mappedType: 'cc', mappedNumber: 1, mappedChannel: 2 });
  assert.equal(cc(model, 1, 127, 0), false);
  assert.equal(cc(model, 7, 127, 0, { channel: 2 }), false);
  cc(model, 1, 32, 0, { channel: 2 });
  close(model.sample(0).level, 32 / 127);
  assert.deepEqual(model.sample(0).rgb, [32 / 127, 32 / 127, 32 / 127]);
  model.configure({ velocity: false }, 1);
  close(model.sample(1).level, 0);
  cc(model, 1, 64, 2, { channel: 2 });
  cc(model, 1, 127, 2, { channel: 2, sourceId: 'keyboard-b' });
  cc(model, 1, 0, 3, { channel: 2 });
  close(model.sample(3).level, 1);
  model.releaseSource('keyboard-b', 4);
  close(model.sample(4).level, 0);
});

test('pitch colors mix and remain colored throughout release', () => {
  const model = instant({ release: 2, velocity: false });
  on(model, 0, 0);
  assert.deepEqual(model.sample(0).rgb, [1, 0, 0]);
  on(model, 64, 0);
  assert.deepEqual(model.sample(0).rgb, [0.5, 0.5, 0.5]);
  off(model, 64, 1);
  off(model, 0, 2);
  assert.deepEqual(model.sample(3).rgb, [0.5, 0, 0]);
  model.configure({ invert: true }, 3);
  assert.deepEqual(model.sample(3).rgb, [0.5, 1, 1]);
});

test('velocity weights mixed colors and the strongest note sets global brightness', () => {
  const model = instant();
  on(model, 0, 0, { velocity: 127 });
  on(model, 64, 0, { velocity: 64 });
  const state = model.sample(0);
  close(state.level, 1);
  close(state.rgb[0], 127 / 191);
  close(state.rgb[1], 64 / 191);
  off(model, 0, 1);
  close(model.sample(1.02).level, 64 / 127);
});

test('hue rotation follows seconds and activity changes on note attacks only', () => {
  const rotating = instant({ hueMode: 'rotate', hueSpeed: 0.5 });
  on(rotating, 0, 0);
  assert.deepEqual(rotating.sample(0).rgb, [1, 0, 0]);
  assert.deepEqual(rotating.sample(1).rgb, [0, 1, 1]);
  close(rotating.sample(1).hueOffset, 0.5);
  close(rotating.sample(2.5).hueOffset, 0.25);
  rotating.configure({ hueMode: 'static' }, 2.5);
  assert.deepEqual(rotating.sample(2.5).rgb, [1, 0, 0]);
  close(rotating.sample(2.5).hueOffset, 0);
  const activity = instant({ hueMode: 'activity', hueSpeed: 1 });
  on(activity, 0, 0);
  const first = activity.sample(0).rgb;
  close(activity.sample(0).hueOffset, 0.1);
  assert.deepEqual(activity.sample(10).rgb, first);
  on(activity, 0, 11);
  assert.notDeepEqual(activity.sample(11).rgb, first);
  close(activity.sample(11).hueOffset, 0.2);
  activity.panic(12);
  close(activity.sample(12).hueOffset, 0);
});

test('visual edits preserve held notes and do not restart the envelope', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 0, sustain: 1, release: 2 });
  on(model, 60, 0);
  model.configure({ color: false, invert: true }, 0.5);
  close(model.sample(0.5).level, 0.5);
  close(model.sample(1).level, 1);
  assert.equal(model.sample(1).activeNotes.length, 1);
  model.configure({ sustain: 0.25 }, 1);
  close(model.sample(1).level, 1);
  close(model.sample(1.02).level, 0.25);
  model.configure({ mappedNumber: 62 }, 2);
  assert.equal(model.sample(2).phase, 'idle');
});

test('editing active attack and release times preserves the current level', () => {
  const model = new MidiphoriaModel({ attack: 1, decay: 0, sustain: 1, release: 2 });
  on(model, 60, 0);
  model.configure({ attack: 2 }, 0.5);
  close(model.sample(0.5).level, 0.5);
  close(model.sample(1.5).level, 1);
  off(model, 60, 2);
  model.configure({ release: 4 }, 3);
  close(model.sample(3).level, 0.5);
  close(model.sample(4).level, 0.25);
  assert.equal(model.sample(5).phase, 'idle');
});

test('invalid events, hostile numeric values and stale clocks cannot poison output', () => {
  const model = new MidiphoriaModel({ attack: NaN, decay: -4, release: Infinity, sustain: 500, hueSpeed: Symbol('bad') });
  for (const message of [null, {}, { type: 'noteOn', note: NaN, channel: 0, velocity: 127 },
    { type: 'noteOn', note: 60, channel: 99, velocity: 127 },
    { type: 'noteOn', note: 60, channel: 0, velocity: Infinity },
    { type: 'controlChange', controller: NaN, channel: 0, value: 127 },
    { type: 'clock', channel: 0 }]) assert.equal(model.handleMessage(message, 0), false);
  on(model, 60, 1, { velocity: 500 });
  const current = model.sample(2);
  close(current.level, 1);
  assert.deepEqual(model.sample(-100), current);
  assert.deepEqual(model.sample(NaN), current);
  assert.deepEqual(model.sample(Symbol('bad')), current);
  model.configure({ release: -5, sustain: NaN, invert: 'false' }, 2);
  off(model, 60, 2);
  assert.equal(model.sample(2).phase, 'idle');
  assert.ok(model.sample(1e15).rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});

test('active notes and pedal scopes are bounded under many inputs', () => {
  const model = instant();
  for (let index = 0; index < 1000; index += 1) {
    const sourceId = `input-${index}`;
    cc(model, 64, 127, index / 1000, { sourceId });
    on(model, index % 128, index / 1000, { sourceId });
  }
  assert.equal(model.sample(1).activeNotes.length, 256);
  assert.ok(model._pedals.size <= 256);
  const snapshot = model.sample(1);
  snapshot.activeNotes[0].velocity = 0;
  assert.equal(model.sample(1).activeNotes[0].velocity, 127);
  model.panic(1);
  assert.equal(model.sample(1).activeNotes.length, 0);
  assert.equal(model._pedals.size, 0);
});
