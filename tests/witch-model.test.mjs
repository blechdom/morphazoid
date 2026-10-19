import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWitchControls, createStirState, updateStir, releaseStir, advanceStir, sampleChant, WITCH_TAU } from '../src/instruments/witch/witch-model.js';

test('witch controls reject malformed values without changing the safe startup', () => {
  const defaults = normalizeWitchControls();
  assert.equal(defaults.gate, false); assert.equal(defaults.speed, 0);
  assert.equal(defaults.fingerMask, 0); assert.equal(defaults.tone, .5); assert.equal(defaults.flightX, .5);
  const value = normalizeWitchControls({ speed: Infinity, radius: 90, direction: -22, gate: 'true',
    fingers: [NaN, -2, 5], voice: 'invalid', mode: 'invalid', volume: -9 });
  assert.equal(value.speed, 0); assert.equal(value.radius, 1); assert.equal(value.direction, -1);
  assert.equal(value.gate, false); assert.equal(value.voice, 'mutter'); assert.equal(value.mode, 'brew');
  assert.deepEqual(value.fingers, [.5, 0, 1, .5, .5]); assert.equal(value.volume, 0);
  value.fingers[0] = 0;
  assert.equal(normalizeWitchControls().fingers[0], .5);
});

test('instrumental control fields and five-finger masks stay bounded', () => {
  const a = normalizeWitchControls({ fingerMask: 7.7, flightX: -3, tone: 3 });
  assert.equal(a.fingerMask, 8); assert.equal(a.flightX, 0); assert.equal(a.tone, 1);
  const b = normalizeWitchControls({ fingerMask: 1000, flightX: NaN, tone: Infinity });
  assert.equal(b.fingerMask, 31); assert.equal(b.flightX, .5); assert.equal(b.tone, .5);
});

test('stir angle wraps, speed responds, and a reversal is immediate', () => {
  const first = updateStir(createStirState(), { angle: 3.1, radius: .2, time: 1 });
  const moving = updateStir(first, { angle: -3.1, radius: .8, time: 1.02 });
  assert.equal(moving.direction, 1); assert.ok(moving.speed > 0); assert.equal(moving.radius, .8);
  assert.ok(moving.velocity < 5, 'crossing π is a short movement');
  const reversed = updateStir(moving, { angle: 3, radius: .8, time: 1.04 });
  assert.equal(reversed.direction, -1); assert.ok(reversed.speed > moving.speed);
  assert.equal(first.velocity, 0, 'updates do not mutate the previous state');
});

test('released vortex coasts identically at different display rates', () => {
  const initial = releaseStir({ ...createStirState(), velocity: 8, speed: 8 / 12, direction: -1, phase: 2 });
  const once = advanceStir(initial, 1);
  let many = initial;
  for (let i = 0; i < 120; i++) many = advanceStir(many, 1 / 120);
  assert.ok(Math.abs(once.velocity - many.velocity) < 1e-12);
  assert.ok(Math.abs(once.phase - many.phase) < 1e-11);
  assert.ok(once.speed > 0 && once.speed < initial.speed);
  assert.ok(once.phase >= 0 && once.phase < WITCH_TAU);
  assert.equal(initial.gate, false); assert.equal(initial.time, null);
});

test('chant traverses the same asymmetric vowel path in reverse and opens with radius', () => {
  for (const phase of [.1, 1.75, 3.4, 9.1]) {
    assert.deepEqual(sampleChant(phase, -1, .6), sampleChant(-phase, 1, .6));
  }
  assert.notEqual(sampleChant(1.2, 1).f1, sampleChant(1.2, -1).f1);
  const pinched = sampleChant(2.4, 1, 0), open = sampleChant(2.4, 1, 1);
  assert.ok(open.mouth > pinched.mouth * 2); assert.ok(open.f1 > pinched.f1 * 2);
  const target = {}; assert.equal(sampleChant(3, 1, .5, target), target);
});
