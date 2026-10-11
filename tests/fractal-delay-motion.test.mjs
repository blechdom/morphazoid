import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_DEFAULTS, MOTION_LIMITS, createParameterMotion } from '../src/instruments/fractal-delay/parameter-motion.js';

const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
const motion = extra => createParameterMotion({ cReal: -.2, cImag: .5, ...extra });

test('motion defaults are bounded, independently paused and retain the exact initial coordinates', () => {
  assert.deepEqual(MOTION_DEFAULTS, { realMotionTempo: 6, imagMotionTempo: 4.5, realMotionDepth: .035, imagMotionDepth: .035 });
  assert.deepEqual(MOTION_LIMITS, { tempo: [.25, 60], depth: [0, 1.5] });
  const controller = motion(), state = controller.snapshot();
  assert.equal(state.real.playing, false); assert.equal(state.imag.playing, false);
  assert.equal(state.real.tempo, 6); assert.equal(state.imag.tempo, 4.5);
  assert.equal(state.real.depth, .035); assert.equal(state.imag.depth, .035);
  assert.deepEqual(controller.advance(1000), { cReal: -.2, cImag: .5 });
});

test('one beat is a complete smooth sine cycle rather than one leg of a sweep', () => {
  const controller = motion({ realMotionTempo: 6, realMotionDepth: .4 });
  controller.setPlaying('real', true);
  close(controller.advance(2.5).cReal, .2);
  close(controller.advance(2.5).cReal, -.2);
  close(controller.advance(2.5).cReal, -.6);
  close(controller.advance(2.5).cReal, -.2);
  close(controller.snapshot().real.phase, 0);
});

test('each axis uses its own tempo, phase and play state', () => {
  const controller = motion({ realMotionTempo: 6, imagMotionTempo: 3, realMotionDepth: .2, imagMotionDepth: .4 });
  controller.setPlaying('real', true); controller.setPlaying('imag', true);
  const pose = controller.advance(2.5), state = controller.snapshot();
  close(pose.cReal, 0); close(pose.cImag, .5 + .4 * Math.sin(Math.PI / 4));
  close(state.real.phase, .25); close(state.imag.phase, .125);
  controller.setPlaying('real', false);
  const next = controller.advance(2.5);
  assert.equal(next.cReal, pose.cReal); close(next.cImag, .9);
});

test('pause and resume retain phase and position while the other axis keeps advancing', () => {
  const controller = motion({ realMotionDepth: .5 });
  controller.setPlaying('real', true); controller.setPlaying('imag', true);
  controller.advance(.7); controller.setPlaying('real', false);
  const paused = controller.snapshot().real;
  controller.advance(3);
  assert.deepEqual(controller.snapshot().real, paused);
  controller.setPlaying('real', true);
  const resumed = controller.snapshot().real;
  assert.equal(resumed.phase, paused.phase); assert.equal(resumed.value, paused.value);
  close(controller.advance(.3).cReal, -.2 + .5 * Math.sin(Math.PI / 5));
});

test('clipped asymmetric sweeps begin at the current pose, including exact coordinate boundaries', () => {
  for (const cReal of [-2, -1.99, .99, 1]) {
    const controller = motion({ cReal, realMotionDepth: .4 });
    const state = controller.snapshot().real;
    assert.equal(state.value, cReal); assert.equal(state.center, cReal);
    assert.equal(state.low, Math.max(-2, cReal - .4)); assert.equal(state.high, Math.min(1, cReal + .4));
    assert.deepEqual(controller.advance(0), { cReal, cImag: .5 });
    controller.setPlaying('real', true);
    assert.equal(controller.snapshot().real.value, cReal);
    const next = controller.advance(.000001).cReal;
    assert.ok(Math.abs(next - cReal) < .000001);
    assert.ok(next >= state.low && next <= state.high);
  }
});

test('smooth boundary turns have vanishing slope rather than a clipped plateau or a reset', () => {
  const controller = motion({ cReal: 1, realMotionTempo: 60, realMotionDepth: .4 });
  controller.setPlaying('real', true);
  const early = controller.advance(.0001).cReal;
  assert.ok(early < 1); assert.ok(1 - early < 1e-7);
  close(controller.advance(.4999).cReal, .6);
  close(controller.advance(.5).cReal, 1);
});

test('continuous sweeps stay inside their clipped intervals over many cycles', () => {
  const controller = motion({ cReal: -.99, cImag: 1.4, realMotionTempo: 17.1, imagMotionTempo: 9.3, realMotionDepth: 1.5, imagMotionDepth: 1.5 });
  controller.setPlaying('real', true); controller.setPlaying('imag', true);
  const initial = controller.snapshot();
  for (let index = 0; index < 2000; index++) {
    const pose = controller.advance(.019);
    assert.ok(Number.isFinite(pose.cReal) && pose.cReal >= initial.real.low && pose.cReal <= initial.real.high);
    assert.ok(Number.isFinite(pose.cImag) && pose.cImag >= initial.imag.low && pose.cImag <= initial.imag.high);
  }
});

test('tempo edits preserve phase and pose while changing the following elapsed-time rate', () => {
  const controller = motion({ realMotionTempo: 6, realMotionDepth: .4 });
  controller.setPlaying('real', true); controller.advance(1);
  const before = controller.snapshot().real;
  controller.sync({ realMotionTempo: 12 });
  const after = controller.snapshot().real;
  assert.equal(after.phase, before.phase); assert.equal(after.value, before.value); assert.equal(after.center, before.center);
  const next = controller.advance(1.25);
  close(next.cReal, -.2 + .4 * Math.sin((before.phase + .25) * Math.PI * 2));
});

test('automated coordinate echoes do not become new centers or move paused axes', () => {
  const controller = motion({ realMotionDepth: .4 });
  controller.setPlaying('real', true);
  const pose = controller.advance(1), before = controller.snapshot();
  controller.sync({ ...pose, cImag: -.8 });
  assert.deepEqual(controller.snapshot(), before);
  controller.setPlaying('real', false);
  const paused = controller.snapshot();
  controller.sync({ cReal: 1, cImag: -1.5 });
  assert.deepEqual(controller.snapshot(), paused);
});

test('manual recenter changes only the named axis and starts exactly at the new coordinate', () => {
  const controller = motion();
  controller.setPlaying('real', true); controller.setPlaying('imag', true); controller.advance(.8);
  const imag = controller.snapshot().imag;
  controller.sync({ cReal: .91, cImag: -.6 }, { recenter: ['real'] });
  const state = controller.snapshot();
  assert.equal(state.real.center, .91); assert.equal(state.real.value, .91); assert.equal(state.real.playing, true);
  assert.deepEqual(state.imag, imag);
  assert.equal(controller.advance(0).cReal, .91);
  assert.ok(Math.abs(controller.advance(.000001).cReal - .91) < .000001);
});

test('depth edits explicitly recenter around the current pose without an initial jump', () => {
  const controller = motion({ realMotionDepth: .4 });
  controller.setPlaying('real', true);
  const pose = controller.advance(1.2);
  controller.sync({ ...pose, realMotionDepth: .03 }, { recenter: ['real'] });
  const state = controller.snapshot().real;
  assert.equal(state.center, pose.cReal); assert.equal(state.value, pose.cReal); assert.equal(state.depth, .03);
  close(state.low, pose.cReal - .03); close(state.high, pose.cReal + .03);
  assert.equal(controller.advance(0).cReal, pose.cReal);
});

test('preset recenter keeps both supplied poses and preserves independent play states', () => {
  const controller = motion(); controller.setPlaying('real', true); controller.advance(.4);
  controller.sync({ cReal: -1, cImag: 0, realMotionTempo: 20, imagMotionTempo: 15, realMotionDepth: .1, imagMotionDepth: .2 }, { recenter: ['real', 'imag'] });
  const state = controller.snapshot();
  assert.equal(state.real.value, -1); assert.equal(state.imag.value, 0);
  assert.equal(state.real.playing, true); assert.equal(state.imag.playing, false);
  assert.equal(state.real.tempo, 20); assert.equal(state.imag.tempo, 15);
  assert.equal(state.real.depth, .1); assert.equal(state.imag.depth, .2);
});

test('zero-depth motion stays at the coordinate and can gain depth without jumping', () => {
  const controller = motion({ realMotionDepth: 0 }); controller.setPlaying('real', true);
  for (const gap of [.01, .8, 12]) assert.equal(controller.advance(gap).cReal, -.2);
  controller.sync({ realMotionDepth: .3 }, { recenter: ['real'] });
  assert.equal(controller.advance(0).cReal, -.2);
  close(controller.advance(2.5).cReal, .1);
});

test('bad elapsed times and bad axes leave all motion state unchanged', () => {
  const controller = motion(); controller.setPlaying('real', true); controller.setPlaying('imag', true); controller.advance(.7);
  const before = controller.snapshot();
  for (const delta of [NaN, Infinity, -Infinity, -1, '1', null, undefined]) {
    controller.advance(delta); assert.deepEqual(controller.snapshot(), before);
  }
  for (const axis of ['x', 'cReal', '', null, undefined, 1, ['real'], Symbol('real')]) {
    assert.equal(controller.setPlaying(axis, false), false); assert.deepEqual(controller.snapshot(), before);
  }
});

test('clock advancement uses elapsed time rather than the number of callbacks', () => {
  const one = motion(), partitioned = motion();
  for (const controller of [one, partitioned]) { controller.setPlaying('real', true); controller.setPlaying('imag', true); }
  const expected = one.advance(12.35);
  for (let index = 0; index < 247; index++) partitioned.advance(.05);
  close(partitioned.snapshot().real.value, expected.cReal); close(partitioned.snapshot().imag.value, expected.cImag);
  close(partitioned.snapshot().real.phase, one.snapshot().real.phase); close(partitioned.snapshot().imag.phase, one.snapshot().imag.phase);
});

test('a very large finite clock gap remains finite and bounded', () => {
  const controller = motion({ realMotionTempo: 60, imagMotionTempo: .25 });
  controller.setPlaying('real', true); controller.setPlaying('imag', true);
  controller.advance(Number.MAX_VALUE);
  for (const state of Object.values(controller.snapshot())) {
    assert.ok(Number.isFinite(state.value) && state.value >= state.low && state.value <= state.high);
    assert.ok(Number.isFinite(state.phase) && state.phase >= 0 && state.phase < 1);
  }
});

test('invalid parameters preserve finite state and valid numeric strings are bounded', () => {
  const controller = motion({ cReal: Infinity, cImag: NaN, realMotionTempo: 0, imagMotionTempo: 100, realMotionDepth: -1, imagMotionDepth: 3 });
  let state = controller.snapshot();
  assert.equal(state.real.value, 0); assert.equal(state.imag.value, 0);
  assert.equal(state.real.tempo, .25); assert.equal(state.imag.tempo, 60);
  assert.equal(state.real.depth, 0); assert.equal(state.imag.depth, 1.5);
  controller.sync({ cReal: NaN, cImag: Infinity, realMotionTempo: Infinity, imagMotionDepth: NaN }, { recenter: ['real', 'imag'] });
  assert.deepEqual(controller.snapshot(), state);
  controller.sync({ cReal: '0.25', realMotionTempo: '8', realMotionDepth: '0.3' }, { recenter: ['real'] });
  state = controller.snapshot();
  assert.equal(state.real.value, .25); assert.equal(state.real.tempo, 8); assert.equal(state.real.depth, .3);
});

test('custom coordinate limits are copied, validated and used for all later recenter operations', () => {
  const ranges = { cReal: [-.5, .5], cImag: [.1, .2] };
  const controller = createParameterMotion({ cReal: .48, cImag: 0, realMotionDepth: .4, imagMotionDepth: .4 }, ranges);
  ranges.cReal[1] = 50;
  controller.sync({ cReal: 2, cImag: -2 }, { recenter: ['real', 'imag'] });
  let state = controller.snapshot();
  assert.equal(state.real.center, .5); assert.equal(state.imag.center, .1);
  assert.equal(state.real.high, .5); assert.equal(state.imag.high, .2);
  state = createParameterMotion({ cReal: 0, cImag: 0 }, { cReal: [2, -2], cImag: [NaN, 1] }).snapshot();
  close(state.real.low, -.035); close(state.imag.low, -.035);
});

test('degenerate coordinate ranges stay finite and stationary while phase may advance', () => {
  const controller = createParameterMotion({ cReal: 4, cImag: 4 }, { cReal: [.2, .2], cImag: [-.4, -.4] });
  controller.setPlaying('real', true); controller.setPlaying('imag', true);
  assert.deepEqual(controller.advance(123), { cReal: .2, cImag: -.4 });
});

test('returned snapshots and poses do not expose mutable controller state', () => {
  const controller = motion(), before = controller.snapshot();
  const external = controller.snapshot(); external.real.phase = .5; external.imag.value = 90; external.real.playing = true;
  const pose = controller.advance(0); pose.cReal = 20;
  const synchronized = controller.sync({}); synchronized.imag.center = -90;
  assert.deepEqual(controller.snapshot(), before);
});
