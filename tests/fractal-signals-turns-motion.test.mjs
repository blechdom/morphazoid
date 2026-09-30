import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultState, generateStructure, sanitizeState, PARAMS } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { createMotions, advanceMotions, rebaseMotions, motionSnapshot, motionValues } from '../src/instruments/fractal-signals/motions.js';
import { branchFrame, branchPitch, branchTurnsGeometry, createBranchTurnsTarget, validBranchTurns } from '../src/instruments/fractal-signals/branch-geometry.js';
import { buildMotionBank, motionBankKey } from '../src/instruments/fractal-signals/motion-bank.js';
import { FractalAudio } from '../src/instruments/fractal-signals/audio.js';
const near = (actual, expected, error = 1e-10) => assert.ok(Math.abs(actual - expected) < error, `${actual} ~= ${expected}`);
const scene = extra => ({ ...createDefaultState('grammar'), ...extra });
function render(dsp, seconds, block = 128) {
  const samples = Math.round(seconds * dsp.sampleRate), left = new Float32Array(samples), right = new Float32Array(samples);
  for (let offset = 0; offset < samples; offset += block) dsp.process(left.subarray(offset, offset + block), right.subarray(offset, offset + block));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { left, right };
}

test('Turns keeps the manual endpoint32 while held and wraps on its next moving tick', () => {
  assert.equal(PARAMS.turns.min, 0); assert.equal(sanitizeState(scene({ turns: 0 })).turns, 0);
  const state = scene({ turns: 32, motionTurnsOn: false, motionTurnsTempo: 60 }), motions = createMotions(state);
  assert.equal(motionValues(state, motions).turns, 32); assert.equal(motionSnapshot(motions).values.turns, 1);
  advanceMotions(motions, state, 1); assert.equal(motions.actual.turns, 32);
  const restored = createMotions(state, motionSnapshot(motions)); assert.equal(restored.actual.turns, 32);
  advanceMotions(restored, { ...state, motionTurnsOn: true, motionTurnsTempo: 0 }, .1); assert.equal(restored.actual.turns, 32);
  advanceMotions(motions, { ...state, motionTurnsOn: true }, 1 / 32); near(motions.actual.turns, 1);
  advanceMotions(restored, { ...state, motionTurnsOn: true, motionTurnsTempo: -60 }, 1 / 32); near(restored.actual.turns, 31);
});

test('Turns full cycles, signed travel, pause, manual rebase, and snapshot restoration are deterministic', () => {
  const state = scene({ turns: 7.125, motionTurnsOn: true, motionTurnsTempo: 60 }), motions = createMotions(state);
  advanceMotions(motions, state, .75); near(motions.actual.turns, 31.125);
  const held = motions.actual.turns; advanceMotions(motions, { ...state, motionTurnsOn: false }, 20); assert.equal(motions.actual.turns, held);
  const restored = createMotions(state, motionSnapshot(motions)); advanceMotions(motions, state, .25); advanceMotions(restored, state, .25);
  near(motions.actual.turns, state.turns); assert.deepEqual(motionSnapshot(restored), motionSnapshot(motions));
  const before = motionSnapshot(motions), edit = { ...state, turns: 32 };
  rebaseMotions(motions, state, edit); assert.equal(motions.actual.turns, 32);
  for (const key of ['branch', 'branchAngle', 'base', 'index']) assert.equal(motions.values[key], before.values[key]);
  const foreign = { ...edit, mode: 'grains' }; advanceMotions(motions, foreign, .5); assert.equal(motions.actual.turns, 32, 'Turns only runs in Branches');
});

test('optional Turns metadata leaves every original geometry and score value intact', () => {
  for (const branch of [0, .86, 8.3, 64]) {
    const state = scene({ branch, depth: 8 }), ordinary = generateStructure(state), prepared = generateStructure(state, { turnsGeometry: true });
    assert.equal(ordinary.branchTurns, undefined);
    const { branchTurns, ...unchanged } = prepared; assert.deepEqual(unchanged, ordinary);
    assert.equal(validBranchTurns(branchTurns, ordinary.points.length), true);
    assert.ok(branchTurns.points.length <= 768);
  }
});

test('prepared Turns geometry agrees with regeneration while topology, timing, and point identity stay fixed', () => {
  const target = createBranchTurnsTarget(), identities = Array.from({ length: 768 }, (_, i) => target[i]);
  for (const branch of [.86, 5.7, 64]) {
    const state = scene({ branch, depth: 9, seed: 377 }), source = generateStructure(state, { turnsGeometry: true });
    for (const turns of [0, .25, 1.25, 9.125, 31.999, 32]) for (const angle of [0, 37, 180, 359]) {
      const regenerated = generateStructure({ ...state, turns, branchAngle: angle });
      const projected = branchTurnsGeometry(source.branchTurns, turns, target), frame = branchFrame(projected, angle), expectedFrame = branchFrame(regenerated.branchGeometry, angle);
      assert.equal(projected, target); assert.equal(projected.length, source.points.length);
      assert.deepEqual(regenerated.edges, source.edges);
      assert.deepEqual(regenerated.events.map(event => [event.point, event.phase, event.amp, event.duration]), source.events.map(event => [event.point, event.phase, event.amp, event.duration]));
      for (let point = 0; point < projected.length; point++) {
        assert.equal(projected[point], identities[point]);
        near(branchPitch(projected, point, frame), branchPitch(regenerated.branchGeometry, point, expectedFrame), 1e-11);
      }
    }
  }
});

test('optional prepared metadata has no audible effect before Turns motion moves', () => {
  for (const turns of [.25, 1.25, 9.137, 32]) {
    const state = scene({ turns, base: 517.337, branchAngle: 23 }), a = new FractalDSP(8000, state, generateStructure(state)), b = new FractalDSP(8000, state, generateStructure(state, { turnsGeometry: true }));
    a.setPlaying(true); b.setPlaying(true);
    const first = render(a, .3), second = render(b, .3);
    assert.deepEqual(second.left, first.left); assert.deepEqual(second.right, first.right);
    assert.equal(b.branchGeometry, b.branchBaseGeometry);
  }
});

test('Turns motion updates actual branch pitches while preserving event order and phrase timing', () => {
  const state = scene({ turns: 1.25, rate: 16, phrase: 8, pingPong: true, loop: false, engine: 'bell', depth: 5 });
  const structure = generateStructure(state, { turnsGeometry: true }), histories = [];
  for (const motionTurnsOn of [false, true]) {
    const dsp = new FractalDSP(8000, { ...state, motionTurnsOn, motionTurnsTempo: 12 }, structure), attacks = [], trigger = dsp.trigger;
    dsp.trigger = function(event, offset = 0) {
      const result = trigger.call(this, event, offset);
      if (!offset) attacks.push({ point: event.point, time: this.time, pitch: this.eventPitchTarget });
      return result;
    };
    dsp.setPlaying(true); const sound = render(dsp, 1.1);
    histories.push({ attacks, sound, dsp });
  }
  const [held, moving] = histories;
  assert.deepEqual(moving.attacks.map(({ point, time }) => [point, time]), held.attacks.map(({ point, time }) => [point, time]));
  assert.ok(moving.attacks.some((event, i) => Math.abs(event.pitch - held.attacks[i].pitch) > .001));
  assert.ok(moving.sound.left.some((value, i) => Math.abs(value - held.sound.left[i]) > .001));
  assert.equal(moving.dsp.branchGeometry, moving.dsp.branchTurnsTarget);
  assert.equal(moving.dsp.completed, true); assert.equal(moving.dsp.phase, held.dsp.phase);
});

test('primary pause keeps Turns moving; its own pause holds geometry and resumes from the held value', () => {
  const state = scene({ motionTurnsOn: true, motionTurnsTempo: 60 }), structure = generateStructure(state, { turnsGeometry: true }), dsp = new FractalDSP(8000, state, structure);
  render(dsp, .3); const held = dsp.motions.actual.turns; assert.notEqual(held, state.turns); assert.equal(dsp.phase, 0);
  const paused = { ...state, motionTurnsOn: false };
  dsp.setState(paused, generateStructure(paused, { turnsGeometry: true })); render(dsp, .1);
  assert.equal(dsp.motions.actual.turns, held); assert.equal(dsp.telemetry.turns, held);
  const geometry = Array.from({ length: dsp.branchGeometry.length }, (_, i) => ({ ...dsp.branchGeometry[i] }));
  render(dsp, .1); assert.deepEqual(Array.from({ length: dsp.branchGeometry.length }, (_, i) => dsp.branchGeometry[i]), geometry);
  dsp.setState(state, structure); render(dsp, .125); near(dsp.motions.actual.turns, (held + 4) % 32, 1e-9); assert.equal(dsp.phase, 0);
  dsp.setState({ ...state, turns: 32 }, generateStructure({ ...state, turns: 32 }, { turnsGeometry: true })); assert.equal(dsp.motions.actual.turns, 32);
});

test('one Branching bank supports simultaneous Turns and angle without a second score family', () => {
  const state = scene({ motionBranchOn: true, motionBranchTempo: 6, motionTurnsOn: true, motionTurnsTempo: -6, motionAngleOn: true, motionAngleTempo: 9, depth: 5 });
  const bank = buildMotionBank(state, { version: 1, generateStructure }); assert.equal(bank.frames.length, 66);
  assert.ok(bank.frames.every(frame => validBranchTurns(frame.branchTurns, frame.branchGeometry.length)));
  const dsp = new FractalDSP(8000, state, generateStructure(state, { turnsGeometry: true })); dsp.setMotionBank(bank); render(dsp, .3);
  const frame = bank.frames[dsp.motionFrameIndex]; assert.equal(dsp.events, frame.events); assert.equal(dsp.branchTurns, frame.branchTurns);
  assert.equal(dsp.branchGeometry, dsp.branchTurnsTarget); assert.equal(dsp.branchGeometry.length, frame.branchGeometry.length);
  assert.equal(dsp.telemetry.turns, dsp.branchProjectionTurns);
  assert.equal(motionBankKey(state), motionBankKey({ ...state, turns: 31, motionTurnsTempo: 90 }));
  const audio = new FractalAudio(); audio.setMotionBank(bank); assert.equal(audio.motionBank.frames[0].branchTurns, bank.frames[0].branchTurns);
  assert.equal(audio.motionBank.frames[0].structure, undefined);
});

test('Turns snapshots restore32 exactly and retain moving geometry across engine lifetimes', () => {
  for (const turns of [32, 7]) {
    const state = scene({ turns, motionTurnsOn: turns !== 32, motionTurnsTempo: -60 }), structure = generateStructure(state, { turnsGeometry: true }), a = new FractalDSP(8000, state, structure);
    render(a, .17); const transport = { motions: motionSnapshot(a.motions) };
    const b = new FractalDSP(8000, state, structure); b.setPhase(a.phase, transport);
    render(a, .1); render(b, .1);
    assert.deepEqual(motionSnapshot(a.motions), motionSnapshot(b.motions)); assert.equal(a.telemetry.turns, b.telemetry.turns);
    if (turns === 32) assert.equal(b.telemetry.turns, 32);
  }
});
