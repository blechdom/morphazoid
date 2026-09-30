import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP, cleanEvents } from '../src/instruments/fractal-signals/dsp.js';
import { FractalAudio } from '../src/instruments/fractal-signals/audio.js';
import { createDefaultState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { MOTION_TARGETS, sanitizeMotionState, createMotions, rebaseMotions, advanceMotions, motionValues, motionSnapshot } from '../src/instruments/fractal-signals/motions.js';
import { buildMotionBank, motionBankKey, selectMotionFrame } from '../src/instruments/fractal-signals/motion-bank.js';
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ~= ${expected}`);
const stateFor = (extra = {}) => ({ ...createDefaultState('grammar'), branch: 0, branchAngle: 0, base: 20, index: 0, ...extra });
const allOn = Object.fromEntries(Object.values(MOTION_TARGETS).flatMap(spec => [[spec.onKey, true], [spec.tempoKey, 60]]));
function render(dsp, seconds, block = 128) {
  const length = Math.round(seconds * dsp.sampleRate), left = new Float32Array(length), right = new Float32Array(length);
  for (let offset = 0; offset < length; offset += block) dsp.process(left.subarray(offset, offset + block), right.subarray(offset, offset + block));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { left, right };
}
const note = (phase, point) => ({ phase, point, freq: 220 + point, amp: .6, duration: .1, pan: 0, depth: 0 });
const simpleStructure = ({ branch }) => ({ events: [note(0, branch * 3), note(.5, branch * 3 + 1), note(1, branch * 3 + 2)] });
const bankFor = (state, version = 1) => buildMotionBank(state, { version, generateStructure: simpleStructure });

test('direct motions preserve exact manual values, including logarithmic Root and nonzero angle', () => {
  const state = stateFor({ branch: 3.14159, branchAngle: 23, base: 517.337, index: 9.17 });
  const motions = createMotions(state), initial = motionValues(state, motions);
  advanceMotions(motions, state, 100000);
  assert.deepEqual(motionValues(state, motions), initial);
  for (const key of Object.keys(MOTION_TARGETS)) assert.equal(initial[key], state[key]);
  assert.deepEqual(motionValues(state, createMotions(state, motionSnapshot(motions))), initial);
  const sanitized = sanitizeMotionState({ motionBranchOn: true, motionBranchTempo: -999, motionAngleTempo: NaN, motionRootTempo: 0 });
  assert.equal(sanitized.motionBranchTempo, -120); assert.equal(sanitized.motionAngleTempo, 6); assert.equal(sanitized.motionRootTempo, 0);
});

test('one beat makes a full reflected or circular cycle, with logarithmic pitch and signed reversal', () => {
  const state = stateFor(allOn), motions = createMotions(state);
  advanceMotions(motions, state, .25);
  let values = motionValues(state, motions);
  near(values.branch, 32); near(values.branchAngle, 90); near(values.base, 400); near(values.index, 16);
  advanceMotions(motions, state, .25);
  values = motionValues(state, motions);
  near(values.branch, 64); near(values.branchAngle, 180); near(values.base, 8000); near(values.index, 32);
  advanceMotions(motions, state, .5);
  for (const key of Object.keys(MOTION_TARGETS)) near(motionValues(state, motions)[key], state[key]);
  advanceMotions(motions, state, .17);
  const reversed = { ...state, ...Object.fromEntries(Object.values(MOTION_TARGETS).map(spec => [spec.tempoKey, -60])) };
  advanceMotions(motions, reversed, .17);
  for (const key of Object.keys(MOTION_TARGETS)) near(motionValues(state, motions)[key], state[key]);
});

test('own pause holds, manual rebasing affects one target, and snapshots retain return direction', () => {
  const state = stateFor(allOn), motions = createMotions(state);
  advanceMotions(motions, state, .61);
  const paused = { ...state, motionBranchOn: false }, held = motions.actual.branch;
  advanceMotions(motions, paused, .1); assert.equal(motions.actual.branch, held);
  const before = motionSnapshot(motions), edited = { ...paused, base: 517.337 };
  rebaseMotions(motions, paused, edited);
  assert.equal(motions.actual.base, 517.337);
  for (const key of ['branch', 'branchAngle', 'index']) assert.equal(motions.values[key], before.values[key]);
  const restored = createMotions(edited, motionSnapshot(motions));
  advanceMotions(motions, state, .03); advanceMotions(restored, state, .03);
  assert.deepEqual(motionSnapshot(restored), motionSnapshot(motions));
  rebaseMotions(motions, edited, edited, { resetMotions: true });
  for (const key of Object.keys(MOTION_TARGETS)) assert.equal(motions.actual[key], edited[key]);
});

test('bank preparation includes exact manual Branching, bounded sorted scores, and a shared selector', () => {
  const state = stateFor({ branch: 3.14, depth: 2 });
  const bank = buildMotionBank(state, { version: 7, generateStructure });
  assert.equal(bank.frames.length, 66); assert.equal(bank.frames[selectMotionFrame(bank, state.branch)].branch, state.branch);
  assert.equal(bank.frames[selectMotionFrame(bank, 3.57)].branch, 3.14, 'equal-distance ties select the lower frame');
  assert.equal(bank.frames[0].branch, 0); assert.equal(bank.frames.at(-1).branch, 64);
  assert.ok(bank.frames.every(frame => frame.events.length <= 384 && (frame.branchGeometry?.length ?? 0) <= 768));
  assert.notDeepEqual(bank.frames[0].events, bank.frames.at(-1).events, 'Branching changes generated geometry and score');
  assert.equal(motionBankKey(state), motionBankKey({ ...state, motionBranchOn: true, motionBranchTempo: -120, lfo1On: true, branchAngle: 90 }));
  assert.notEqual(motionBankKey(state), motionBankKey({ ...state, seed: state.seed + 1 }));
});

test('direct motions run during primary pause and completion without advancing notes or legacy LFOs', () => {
  const state = stateFor({ ...allOn, lfo1On: true }), dsp = new FractalDSP(8000, state, simpleStructure(state));
  assert.equal(dsp.setMotionBank(bankFor(state)), true);
  const { left } = render(dsp, .25);
  assert.ok(left.every(value => value === 0)); assert.equal(dsp.playing, false); assert.equal(dsp.phase, 0); assert.equal(dsp.time, 0);
  assert.deepEqual(Array.from(dsp.lfoPhases), [0, 0]); near(dsp.motions.actual.branch, 32);
  near(dsp.motions.actual.base, 400); assert.equal(dsp.events, dsp.motionBank.frames[dsp.motionFrameIndex].events);
  assert.equal(dsp.telemetry.motionValues.branch, dsp.motionBank.frames[dsp.motionFrameIndex].branch);
  dsp.completed = true; const snapshot = motionSnapshot(dsp.motions); dsp.setPlaying(true);
  assert.deepEqual(motionSnapshot(dsp.motions), snapshot, 'replaying the phrase keeps independent motion positions');
});

test('manual edits and preset rebases keep phrase position while own pause preserves the audio-owned value', () => {
  const state = stateFor({ ...allOn, base: 420 }), structure = generateStructure(state), dsp = new FractalDSP(8000, state, structure);
  dsp.setPhase(.31); render(dsp, .19);
  const paused = { ...state, motionRootOn: false }, held = dsp.motions.actual.base;
  dsp.setState(paused, structure); render(dsp, .11); assert.equal(dsp.motions.actual.base, held); assert.equal(dsp.phase, .31);
  const before = motionSnapshot(dsp.motions), edited = { ...paused, base: 700 };
  dsp.setState(edited, generateStructure(edited)); assert.equal(dsp.motions.actual.base, 700);
  for (const key of ['branch', 'branchAngle', 'index']) assert.equal(dsp.motions.values[key], before.values[key]);
  dsp.setState(edited, generateStructure(edited), { resetMotions: true });
  assert.equal(dsp.phase, .31);
  for (const key of Object.keys(MOTION_TARGETS)) assert.equal(dsp.motions.actual[key], edited[key]);
});

test('complete bank replacement swaps references and preserves voices, debt, clocks, and future cursor', () => {
  const state = stateFor({ base: 440, pingPong: true }), dsp = new FractalDSP(8000, state, simpleStructure(state)), bank = bankFor(state);
  dsp.setMotionBank(bank); dsp.setPhase(.6, { travelDirection: -1 });
  dsp.voices[0].active = true; dsp.voices[0].age = .025; dsp.delayL[7] = .3; dsp.attackTokens = -.5;
  const clock = [dsp.phase, dsp.time, dsp.motionTime, dsp.travelDirection], voice = dsp.voices[0];
  dsp.motions.actual.branch = 17; dsp.selectBranchFrame();
  assert.equal(dsp.events, bank.frames[17].events); assert.equal(dsp.branchGeometry, bank.frames[17].branchGeometry);
  assert.equal(dsp.voices[0], voice); assert.equal(voice.age, .025); assert.equal(dsp.attackTokens, -.5); near(dsp.delayL[7], .3, 1e-7);
  assert.deepEqual([dsp.phase, dsp.time, dsp.motionTime, dsp.travelDirection], clock); assert.equal(dsp.nextEvent, 1);
  assert.equal(dsp.setMotionBank({ ...bank, version: 2, frames: bank.frames.slice(1) }), false, 'partial banks never replace playback');
  dsp.setState(state, simpleStructure(state), { motionBankVersion: 3 });
  assert.equal(dsp.setMotionBank({ ...bank, version: 2 }), false); assert.equal(dsp.motionBank, bank);
  const replacement = bankFor(state, 3); assert.equal(dsp.setMotionBank(replacement), true); assert.equal(dsp.events, replacement.frames[17].events);
  assert.equal(dsp.setMotionBank(bank), false, 'late generations cannot restore an obsolete score');
});

test('new Branching frames retain endpoint borrowing and never replay an already consumed turn', () => {
  const state = stateFor({ base: 440, pingPong: true }), dsp = new FractalDSP(8000, state, simpleStructure(state));
  const bank = bankFor(state); dsp.setMotionBank(bank); dsp.phase = 1 - .00001; dsp.attackTokens = .25;
  dsp.motions.actual.branch = 9; dsp.selectBranchFrame();
  assert.equal(dsp.events.at(-1).endpoint, true);
  dsp.scheduleEvents(1); assert.equal(dsp.attackTokens, -.75, 'the arriving outer note may borrow one token');
  dsp.phase = 1; dsp.travelDirection = -1; dsp.seekEvents(false);
  dsp.motions.actual.branch = 10; dsp.selectBranchFrame();
  assert.equal(dsp.nextEvent, 1, 'frame replacement at a turn does not replay its outer attack');
  dsp.travelDirection = 1; dsp.phase = 0; dsp.nextEvent = 0;
  dsp.motions.actual.branch = 11; dsp.selectBranchFrame();
  assert.equal(dsp.nextEvent, 0, 'an unconsumed loop-start attack remains due');
});

test('motion restoration keeps normalized positions and return directions across audio-engine lifetimes', () => {
  const state = stateFor(allOn), first = new FractalDSP(8000, state, simpleStructure(state));
  first.setMotionBank(bankFor(state)); render(first, .63);
  const transport = { travelDirection: first.travelDirection, time: first.time, motionTime: first.motionTime, modPhases: Array.from(first.lfoPhases), motions: motionSnapshot(first.motions) };
  const second = new FractalDSP(8000, state, simpleStructure(state)); second.setPhase(first.phase, transport); second.setMotionBank(bankFor(state));
  render(first, .11); render(second, .11);
  assert.deepEqual(motionSnapshot(second.motions), motionSnapshot(first.motions));
  assert.equal(second.motionFrameIndex, first.motionFrameIndex); assert.equal(second.phase, first.phase);
});

test('motion message plumbing does not arm Audio or Play and omits drawing structures from worklet banks', () => {
  const state = stateFor(allOn), audio = new FractalAudio(), bank = bankFor(state);
  audio.setState(state, simpleStructure(state), { resetMotions: true, motionBankVersion: 3 });
  audio.setMotionBank(bank); assert.equal(audio.context, null); assert.equal(audio.playing, false);
  assert.ok(bank.frames[0].structure); assert.equal(audio.motionBank.frames[0].structure, undefined);
  const messages = []; audio.node = { port: { postMessage: message => messages.push(message) } };
  audio.setState(state, simpleStructure(state), { resetMotions: true }); audio.setMotionBank(bank);
  assert.equal(messages[0].options.resetMotions, true); assert.equal(messages[1].type, 'motionBank');
  const motions = motionSnapshot(createMotions(state)); audio.setPhase(.25, { motions });
  assert.deepEqual(messages.at(-1).transport.motions, motions);
});

test('moving Branching schedules the currently selected score on both legs without duplicate endpoints', () => {
  const state = stateFor({ base: 440, motionBranchOn: true, motionBranchTempo: 60, rate: 1, phrase: 1, pingPong: true, loop: false });
  const expected = [0, 193, 2, 193, 0];
  for (const block of [1, 128, 511]) {
    const dsp = new FractalDSP(8000, state, simpleStructure(state)), attacks = [], bank = bankFor(state);
    dsp.setMotionBank(bank); dsp.setPlaying(true);
    const trigger = dsp.trigger;
    dsp.trigger = function(event, offset = 0) {
      if (!offset) attacks.push(event.point);
      return trigger.call(this, event, offset);
    };
    render(dsp, 2.01, block);
    assert.deepEqual(attacks, expected, `real score selection is sample-clock-owned at block ${block}`);
    assert.equal(dsp.completed, true);
  }
});

test('each direct parameter motion reaches synthesis while keeping bounded stereo', () => {
  const state = stateFor({ base: 390, branch: .86, engine: 'bell', rate: 16, phrase: 8, depth: 3 });
  const structure = generateStructure(state, { turnsGeometry: true }), baselineDSP = new FractalDSP(8000, state, structure);
  baselineDSP.setPlaying(true); const baseline = render(baselineDSP, .5).left;
  for (const [key, spec] of Object.entries(MOTION_TARGETS)) {
    if (spec.modes && !spec.modes.includes(state.mode)) continue;
    const moving = { ...state, [spec.onKey]: true, [spec.tempoKey]: 6 }, dsp = new FractalDSP(8000, moving, structure);
    if (key === 'branch') dsp.setMotionBank(buildMotionBank(moving, { version: 1, generateStructure }));
    dsp.setPlaying(true); const { left, right } = render(dsp, .5);
    assert.ok(left.some((value, index) => Math.abs(value - baseline[index]) > .001), key);
    assert.ok(left.every(value => Math.abs(value) < .881) && right.every(value => Math.abs(value) < .881), key);
  }
});
