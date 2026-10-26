import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WitchAudio } from '../src/instruments/witch/witch-audio.js';
import { WITCH_DROP_EFFECTS, WITCH_HAND_SOUNDS } from '../src/instruments/witch/witch-model.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { handEffectiveTempo } from '../src/instruments/gesticulating-hand/hand-model.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const difference = (a, b) => rms(a.map((value, index) => value - b[index]));
function playing(controls = {}, rate = 12000) {
  const dsp = new WitchDSP(rate); dsp.setControls({ gate: true, speed: .4, radius: .55, ...controls }); dsp.setEnabled(true); return dsp;
}
function render(dsp, seconds) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let i = 0; i < data.length; i += 128) dsp.process(data.subarray(i, Math.min(data.length, i + 128)));
  return data;
}

test('pulling the nose changes voiced pitch and tract while the independent hand keeps its clock', () => {
  const low = playing({ nose: 0 }), high = playing({ nose: 1 });
  const a = render(low, .75), b = render(high, .75);
  assert.ok(high.brew.frequency > low.brew.frequency * 2.5);
  assert.notEqual(high.brew.formants[0].a1, low.brew.formants[0].a1);
  assert.notEqual(high.brew.nasal.a1, low.brew.nasal.a1);
  assert.ok(difference(a, b) > .08);
  assert.equal(low.visual.handTime, high.visual.handTime);
});

test('live authored hand motion and sound changes reach the actual Gesticules engine without resetting time', () => {
  const dsp = playing({ handFocus: 1 }); render(dsp, .4);
  const time = dsp.visual.handTime;
  dsp.setControls({ handMotion: 'spider-walk', handRate: 6, handDepth: .9, handSound: 'rusted-strings' });
  const bank = WITCH_HAND_SOUNDS.find(bank => bank.id === 'rusted-strings');
  assert.deepEqual(dsp.hand.config.voices.map(voice => voice.source), bank.sources);
  assert.equal(dsp.hand.config.motion.id, 'spider-walk');
  assert.equal(handEffectiveTempo(dsp.hand.config.motion), 62*6);
  assert.equal(dsp.hand.getMotionTime(dsp.time), time);
  const changed = render(dsp, .4);
  const reference = playing({ handFocus: 1 }); render(reference, .4);
  assert.ok(difference(changed, render(reference, .4)) > .04);
});

test('wind filters both ongoing performers and featured objects, then decays cleanly after Audio off', () => {
  for (const kind of [null, 'drop-roach', 'drop-glass']) {
    const dry = playing(), wind = playing({ fabricX: .03, fabricY: .94 });
    if (kind) { dry.trigger(kind); wind.trigger(kind); }
    const a = render(dry, .8), b = render(wind, .8);
    assert.ok(difference(a, b) > .015, kind ?? 'ongoing ensemble');
    assert.ok(b.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    wind.setEnabled(false); render(wind, 2);
    assert.ok(rms(render(wind, .1)) < 1e-7);
  }
});

test('pulling and twisting the flight string alters shared echoes without restarting the performers', () => {
  const a = playing({ mode: 'flight', trailPull: .05, trailTwist: .05 });
  const b = playing({ mode: 'flight', trailPull: .95, trailTwist: .95 });
  assert.ok(difference(render(a, 2), render(b, 2)) > .035);
  assert.ok(b.delay.feedback > a.delay.feedback + .2);
  assert.ok(b.visual.delayTime > a.visual.delayTime + .35);
  assert.equal(a.chantPhase, b.chantPhase); assert.equal(a.visual.handTime, b.visual.handTime);
  b.setControls({ gate: false, ghostGate: false }); render(b, 8);
  assert.ok(rms(render(b, .1)) < 1e-6);
});

test('fixed makeup retains voice dynamics and remains finite through maximum overlapping solos and wind', () => {
  const whisper = playing({ voice: 'whisper' }), singing = playing({ voice: 'sing' });
  assert.ok(rms(render(whisper, 1)) < rms(render(singing, 1)) * .92);
  const dsp = playing({ mode: 'flight', speed: 1, trailPull: 1, trailTwist: 0, fabricX: 1, fabricY: 0 });
  for (const kind of WITCH_DROP_EFFECTS) dsp.trigger(kind);
  const signal = render(dsp, 3);
  assert.ok(signal.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  dsp.setControls({ gate: false }); render(dsp, 9);
  assert.ok(rms(render(dsp, .1)) < 1e-6);
});

test('cat owns primary Play transport and joins the same delayed mix; phase snapshots publish synchronously', () => {
  const clock = createWitchCatClock(30.2, { catSpeed: 1, catGait: 'cat-prowl' });
  const audio = new WitchAudio({}); audio.syncPhase(0, 0, 0, .5, 0, 0, clock);
  assert.deepEqual(audio.visual.catClock, clock); assert.notEqual(audio.visual.catClock, clock);
  assert.deepEqual(audio.pendingPhase.catClock, clock);
  const dsp = playing({ gate: false, ghostGate: true, mode: 'flight' });
  dsp.syncPhase(0, 0, 0, .5, 0, 0, clock);
  assert.deepEqual(dsp.visual.catClock, clock);
  const signal = render(dsp, 1);
  assert.ok(rms(signal) > .0001); assert.ok(dsp.cat.triggerCount > 0);
  assert.ok(dsp.visual.delayLevel > 0); assert.ok(dsp.visual.catLevel > 0);
  dsp.setControls({ ghostGate: false }); const paused = dsp.cat.time; render(dsp, .2);
  assert.equal(dsp.cat.time, paused); assert.equal(dsp.cat.activeVoiceCount, 0);
  dsp.setEnabled(false); dsp.setControls({ ghostGate: true }); render(dsp, .2);
  assert.ok(dsp.cat.time > paused); assert.equal(dsp.cat.activeVoiceCount, 0);
});
