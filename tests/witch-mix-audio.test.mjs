import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP, FlightMixDelay } from '../src/instruments/witch/witch-worklet.js';
import { WitchAudio } from '../src/instruments/witch/witch-audio.js';
import { WITCH_DROP_EFFECTS, WITCH_HAND_SOUNDS, WITCH_VOICES } from '../src/instruments/witch/witch-model.js';
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

function performerLevels(dsp, seconds = 2) {
  const data = new Float32Array(128);
  let voice = 0, hand = 0, blocks = 0;
  for (let i = 0; i < Math.ceil(dsp.rate * seconds / data.length); i++) {
    dsp.process(data); voice += dsp.visual.brewLevel ** 2; hand += dsp.visual.handLevel ** 2; blocks++;
  }
  return { voice: Math.sqrt(voice / blocks), hand: Math.sqrt(hand / blocks) };
}

test('preset balance can feature either rendered performer while the hand stays closed', () => {
  for (const voice of WITCH_VOICES) {
    const voiceLed = playing({ voice, spellBalance: .1, handFocus: 0 });
    const fingersLed = playing({ voice, spellBalance: .9, handFocus: 0 });
    render(voiceLed, .6); render(fingersLed, .6);
    const low = performerLevels(voiceLed), high = performerLevels(fingersLed);
    assert.ok(low.voice > low.hand * 2, `${voice}: voice-led preset has a measurable vocal foreground`);
    assert.ok(high.hand > high.voice * 2, `${voice}: finger-led preset works without opening the hand`);
    assert.ok(low.hand > .001 && high.voice > .001, `${voice}: both performers remain audible contributors`);
    assert.equal(voiceLed.chantPhase, fingersLed.chantPhase);
    assert.equal(voiceLed.visual.handTime, fingersLed.visual.handTime);
  }
});

test('live preset-balance fades preserve running sounds and interrupted focus transitions', () => {
  const changed = playing({ voice: 'wail' }), held = playing({ voice: 'wail' });
  render(changed, .4); render(held, .4);
  for (const spellBalance of [.95, .08, .84, .5]) {
    const weight = changed.weights[0], phrase = changed.chantPhase, handTime = changed.visual.handTime;
    changed.setControls({ spellBalance });
    assert.equal(changed.weights[0], weight); assert.equal(changed.chantPhase, phrase); assert.equal(changed.visual.handTime, handTime);
    render(changed, .012); render(held, .012);
    assert.deepEqual(changed.buffers[0], held.buffers[0], 'crossfade leaves the singer itself untouched');
    assert.deepEqual(changed.buffers[2], held.buffers[2], 'crossfade leaves the fingers themselves untouched');
    assert.ok(Math.abs(changed.weights[0] + changed.weights[1] - 1) < 1e-12);
  }
  render(changed, .08); render(held, .08);
  assert.equal(changed.weights[0], .72, 'the midpoint restores the established scene balance');
  assert.ok(difference(render(changed, .1), render(held, .1)) < 1e-7, 'the held sounds return without a restart');
  const open = playing({ spellBalance: .85 }); render(open, .2);
  const closedWeight = open.weights[0]; open.setControls({ handFocus: 1 }); render(open, .06);
  assert.ok(open.weights[0] < closedWeight, 'opening the hand still brings it forward within the preset');
  const focusWeight = open.weights[0]; open.setControls({ mode: 'flight', handFocus: 1 }); render(open, .06);
  assert.equal(open.weights[0], focusWeight, 'flight keeps both the preset balance and hand focus');
});

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

test('flight Fabric filters ongoing performers and featured objects, then decays cleanly after Audio off', () => {
  for (const kind of [null, 'drop-roach', 'drop-glass']) {
    const dry = playing({ mode: 'flight' }), wind = playing({ mode: 'flight', fabricX: .03, fabricY: .94 });
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
  assert.equal(b.delay.feedback, a.delay.feedback, 'echo regeneration is independent of time and twist');
  assert.ok(b.visual.delayTime > a.visual.delayTime + .35);
  assert.equal(a.chantPhase, b.chantPhase); assert.equal(a.visual.handTime, b.visual.handTime);
  b.setControls({ gate: false, ghostGate: false }); render(b, 8);
  assert.ok(rms(render(b, .1)) < 1e-6);
});

function echoRender(controls, seconds = 8) {
  const delay = new FlightMixDelay(8000);
  delay.controls = { ...delay.controls, mode: 'flight', gate: true, ghostGate: false,
    trailPull: .08, trailTwist: .5, trailSpace: .25, ...controls };
  const data = new Float32Array(seconds * 8000);
  for (let i = 0; i < data.length; i++) {
    const source = i < 1600 ? Math.sin(i * Math.PI * 2 * 233 / 8000) * .16 : 0;
    delay.next(source, source * .8, true); data[i] = (delay.left + delay.right) * .5;
  }
  return { delay, data };
}

test('independent Candy feedback keeps older echoes and space widens their history without changing flight time', () => {
  const low = echoRender({ trailFeedback: .05 }), high = echoRender({ trailFeedback: 1 });
  assert.ok(rms(high.data.subarray(8000 * 3)) > rms(low.data.subarray(8000 * 3)) * 2 + .0001,
    'strong feedback audibly retains an earlier phrase');
  const wide = echoRender({ trailFeedback: 1, trailSpace: 1 });
  assert.ok(difference(high.data.subarray(8000), wide.data.subarray(8000)) > .002,
    'space changes the actual echo cloud, beyond its dry-mix balance');
  assert.equal(high.delay.ridePhase, low.delay.ridePhase); assert.equal(wide.delay.ridePhase, high.delay.ridePhase);
  assert.equal(wide.delay.delayL, high.delay.delayL, 'space does not substitute for the time pull');
});

test('long-history maximum-feedback flight remains bounded and releases Stop and Audio off without stale replay', () => {
  for (const mute of [false, true]) {
    const { delay, data } = echoRender({ trailFeedback: 1, trailSpace: 1, trailPull: 1, trailTwist: .94 }, 10);
    const buffers = delay.buffers.slice();
    assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) < .85));
    delay.controls = { ...delay.controls, gate: false, ghostGate: false };
    let ending = 0;
    for (let i = 0; i < 8000 * 9; i++) {
      delay.next(0, 0, !mute);
      assert.ok(Number.isFinite(delay.left) && Number.isFinite(delay.right));
      if (i > 8000 * 8.9) ending += delay.left ** 2 + delay.right ** 2;
    }
    assert.ok(ending < 1e-10, 'Stop and Audio off finitely release the longer history');
    assert.ok(delay.buffers.every((buffer, i) => buffer === buffers[i]), 'gesture and release retain bounded storage');
    delay.controls = { ...delay.controls, gate: true };
    for (let i = 0; i < 8000; i++) { delay.next(0, 0, true); assert.equal(delay.left, 0); assert.equal(delay.right, 0); }
  }
});

test('fixed makeup retains voice dynamics and remains finite through maximum overlapping solos and wind', () => {
  const whisper = playing({ voice: 'whisper' }), singing = playing({ voice: 'sing' });
  assert.ok(rms(render(whisper, 1)) < rms(render(singing, 1)) * .92);
  const dsp = playing({ mode: 'flight', speed: 1, trailPull: 1, trailTwist: 0, trailFeedback: 1, trailSpace: 1, fabricX: 1, fabricY: 0, fabricPull: 1, fabricVelocity: 1 });
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
  const dsp = playing({ gate: false, ghostGate: true, mode: 'flight', trailPull: .08, trailSpace: .15 });
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

test('meow accepts only Audio-on primary Play visits and releases on Stop, Audio off, and reset', () => {
  const dsp = new WitchDSP(12000), clock = createWitchCatClock(31);
  dsp.syncPhase(0, 0, 0, .5, 0, 0, clock);
  dsp.setControls({ gate: true, ghostGate: true });
  assert.equal(dsp.trigger('meow'), false, 'no automatic Audio arm');
  dsp.setEnabled(true); dsp.setControls({ ghostGate: false });
  assert.equal(dsp.trigger('meow'), false, 'held gestures cannot replace primary Play');
  dsp.setControls({ ghostGate: true }); assert.equal(dsp.trigger('meow'), true);
  render(dsp, .1); assert.ok(dsp.visual.catMeow > .9); assert.ok(dsp.visual.catMeowLevel > .01);
  dsp.setControls({ ghostGate: false }); assert.equal(dsp.trigger('meow'), false);
  render(dsp, .04); assert.equal(dsp.visual.catMeow, 0); assert.equal(dsp.cat.meow.active, false);
  dsp.setControls({ ghostGate: true }); assert.equal(dsp.trigger('meow'), true); render(dsp, .1);
  dsp.setEnabled(false); assert.equal(dsp.trigger('meow'), false); render(dsp, .04);
  assert.equal(dsp.visual.catMeow, 0); assert.equal(dsp.cat.meow.active, false);
  dsp.setEnabled(true); assert.equal(dsp.trigger('meow'), true); render(dsp, .1);
  dsp.syncPhase(0, 0, 0, .5, 0, 0, createWitchCatClock(0));
  assert.equal(dsp.visual.catMeow, 0); assert.equal(dsp.trigger('meow'), false);
  render(dsp, .04); assert.equal(dsp.visual.catMeow, 0); assert.equal(dsp.cat.meow.active, false);
  dsp.syncPhase(0, 0, 0, .5, 0, 0, createWitchCatClock(38));
  assert.equal(dsp.trigger('meow'), false, 'no voice from an absent cat');
});

test('meow enters the shared flight delay and Fabric filter without disturbing performer clocks', () => {
  const make = controls => {
    const dsp = playing({ gate: false, ghostGate: true, ...controls });
    dsp.syncPhase(0, 0, 0, .5, 0, 0, createWitchCatClock(31)); return dsp;
  };
  const feet = make(), dry = make(), flight = make({ mode: 'flight', trailPull: .12, trailTwist: .6, trailSpace: .2 });
  const windy = make({ mode: 'flight', trailPull: .12, trailTwist: .6, trailSpace: .2, fabricX: .02, fabricY: .94 });
  dry.trigger('meow'); flight.trigger('meow'); windy.trigger('meow');
  const quiet = render(feet, .9), plain = render(dry, .9), delayed = render(flight, .9), filtered = render(windy, .9);
  assert.ok(difference(plain, quiet) > .04, 'clicked head is audible above its feet');
  assert.ok(difference(plain, delayed) > .01, 'flight processes the meow');
  assert.ok(difference(delayed, filtered) > .01, 'Fabric processes the meow during flight');
  assert.deepEqual(dry.cat.clock, feet.cat.clock); assert.deepEqual(flight.cat.clock, feet.cat.clock);
  assert.equal(dry.visual.handTime, feet.visual.handTime); assert.equal(dry.chantPhase, feet.chantPhase);
  for(const dsp of [dry, flight, windy]) {
    assert.equal(dsp.visual.catMeow, 0); assert.equal(dsp.cat.meow.active, false);
    dsp.setControls({ ghostGate: false }); render(dsp, .08);
  }
  const tail = render(flight, .5), direct = render(dry, .5);
  assert.ok(rms(tail) > .002, 'shared flight echoes outlast the head envelope');
  assert.ok(rms(direct) < 1e-7, 'direct voice has released');
  assert.ok(tail.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  flight.setEnabled(false); render(flight, 2); assert.ok(rms(render(flight, .1)) < 1e-7);
});
