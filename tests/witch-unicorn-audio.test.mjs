import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchUnicornDSP } from '../src/instruments/witch/witch-unicorn-audio.js';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { createQuadrupedState, quadrupedSequenceEvent } from '../src/instruments/quadruped/quadruped.js';
import { createQuadrupedGestureCall } from '../src/instruments/quadruped/quadruped-gesture-voices.js';
import { createWitchCatClock, witchCatUnicornFrame, WITCH_CAT_UNICORN_DELAY,
  WITCH_CAT_UNICORN_LEAP, WITCH_CAT_UNICORN_DURATION } from '../src/instruments/witch/witch-cat-model.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let frame = 0; frame < data.length; frame += block) dsp.process(data.subarray(frame, Math.min(data.length, frame + block)));
  return data;
}
function engine(extra = {}) {
  const dsp = new WitchDSP(8000);
  dsp.setControls({ gate: true, ghostGate: true, catCaptured: true, brewEnabled: false,
    handEnabled: false, backingEnabled: false, ...extra });
  dsp.syncPhase(0, 0, undefined, undefined, undefined, undefined, createWitchCatClock(31));
  dsp.setEnabled(true);
  return dsp;
}

test('unicorn waits for the cat dive, sparkles on emergence and sounds the native gallop contacts on landing', () => {
  const score = createQuadrupedState('unicorn', 'gallop');
  for (const rate of [8000, 48000]) {
    const dsp = new WitchUnicornDSP(rate), voices = dsp.voices, sources = dsp.sources;
    assert.deepEqual(sources.sparkle.call, createQuadrupedGestureCall(score, { row: 0, strength: .8 }));
    assert.equal(sources.sparkle.call.label, 'Sparkle');
    assert.equal(sources.bank.size, 8); assert.equal(sources.hooves.length, 8); assert.equal(voices.length, 12);
    assert.ok(sources.hooves.every(voice => voice.skinId === 'karplus' && voice.phase === 'touchdown'));
    assert.equal(new WitchUnicornDSP(rate).sources, sources, 'every escape shares the fixed native source bank');
    assert.equal(dsp.trigger(31, { startedAt: 31, direction: 1 }), true);
    for (let click = 0; click < 100; click++) assert.equal(dsp.trigger(31), false, 'busy escapes neither stack nor restart');
    let sparkleEnergy = 0, hoofEnergy = 0, peak = 0;
    const onsets = [];
    for (let frame = 0; frame < Math.round((WITCH_CAT_UNICORN_DURATION + .1) * rate); frame++) {
      const age = frame / rate, before = dsp.triggerCount;
      dsp.next(31 + age);
      assert.ok(Number.isFinite(dsp.left) && Number.isFinite(dsp.right));
      if (age < WITCH_CAT_UNICORN_DELAY) assert.equal(Math.abs(dsp.left) + Math.abs(dsp.right), 0);
      if (age < WITCH_CAT_UNICORN_DELAY + WITCH_CAT_UNICORN_LEAP) assert.equal(dsp.hoofLeft + dsp.hoofRight, 0);
      if (dsp.triggerCount !== before) {
        const picture = witchCatUnicornFrame(31 + age - 31, 1);
        assert.ok(Math.abs(dsp.position - picture.position) < 1e-9, 'feet and native pose share one gait position');
        onsets.push({ step: Math.floor(picture.position), count: dsp.triggerCount - before });
      }
      sparkleEnergy += dsp.sparkleLeft ** 2 + dsp.sparkleRight ** 2;
      hoofEnergy += dsp.hoofLeft ** 2 + dsp.hoofRight ** 2;
      peak = Math.max(peak, Math.abs(dsp.left), Math.abs(dsp.right));
    }
    const expected = Array.from({ length: 167 }, (_, step) => ({ step, count: quadrupedSequenceEvent(score, step).contacts.length }))
      .filter(event => event.count);
    assert.deepEqual(onsets, expected, 'only actual touchdown events sound, in native fore/hind order');
    assert.ok(sparkleEnergy / rate > .00005 && hoofEnergy / rate > .00005 && peak < .5);
    assert.equal(dsp.active, false); assert.equal(dsp.activeVoiceCount, 0);
    assert.equal(dsp.left, 0); assert.equal(dsp.right, 0); assert.equal(dsp.age, WITCH_CAT_UNICORN_DURATION);
    assert.equal(dsp.trigger(61, { direction: -1 }), true);
    assert.equal(dsp.voices, voices); assert.equal(dsp.sources, sources); assert.equal(sources.bank.size, 8);
  }
});

test('late Audio joins the current sparkle or stride, while expired cues and cancellation never replay it', () => {
  const rate = 8000, onTime = new WitchUnicornDSP(rate), late = new WitchUnicornDSP(rate);
  onTime.trigger(31);
  for (let frame = 0; frame < Math.round(1.1 * rate); frame++) onTime.next(31 + frame / rate);
  assert.equal(late.trigger(32.1, { startedAt: 31, direction: 1 }), true);
  assert.ok(Math.abs(late.age - 1.1) < 1e-9);
  let energy = 0;
  for (let frame = Math.round(1.1 * rate); frame < Math.round(1.35 * rate); frame++) {
    const time = 31 + frame / rate; onTime.next(time); late.next(time);
    if (frame > Math.round(1.11 * rate)) {
      assert.equal(late.left, onTime.left); assert.equal(late.right, onTime.right);
      energy += late.left ** 2 + late.right ** 2;
    }
  }
  assert.ok(energy > .01, 'the remaining native call is audible at its original position');
  assert.equal(late.triggerCount, 0, 'there are no hooves in the air');
  const running = new WitchUnicornDSP(rate);
  assert.equal(running.trigger(33.2, { startedAt: 31, direction: -1 }), true);
  running.next(33.2 + 1 / rate);
  assert.equal(running.triggerCount, 0, 'opening Audio midway through a stride skips earlier hoof attacks');
  for (let frame = 1; frame < rate * .3; frame++) running.next(33.2 + frame / rate);
  assert.ok(running.triggerCount >= 4); assert.equal(running.direction, -1);
  assert.equal(new WitchUnicornDSP(rate).trigger(35.3, { startedAt: 31 }), false, 'a departed unicorn never returns after slow loading');
  for (const age of [.8, 1.1, 2.1]) {
    const dsp = new WitchUnicornDSP(rate); dsp.trigger(31);
    for (let frame = 0; frame < Math.round(age * rate); frame++) dsp.next(31 + frame / rate);
    const attacks = dsp.triggerCount; dsp.cancel();
    for (let frame = 0; frame < Math.round(.05 * rate); frame++) dsp.next(31 + age);
    assert.equal(dsp.active, false); assert.equal(dsp.activeVoiceCount, 0); assert.equal(dsp.triggerCount, attacks);
    dsp.next(33.4); assert.equal(dsp.left, 0); assert.equal(dsp.right, 0);
  }
});

test('unicorn output follows the sample clock and stays with the ground animals at takeoff', () => {
  const off = new WitchDSP(8000); assert.equal(off.trigger('unicorn-escape'), false);
  const a = engine(), b = engine(), reference = engine();
  assert.equal(a.trigger('unicorn-escape'), true); assert.equal(b.trigger('unicorn-escape'), true);
  assert.equal(a.unicorn.direction, 1, 'fallback direction follows the captured odd cat visit');
  assert.equal(a.visual.unicornActive, true); assert.equal(a.visual.unicornAge, 0);
  assert.deepEqual(render(a, 1.15), render(b, 1.15, 9200), 'display and render block sizes cannot change the escape');
  render(reference, 1.15);
  assert.deepEqual(a.cat.clock, reference.cat.clock, 'the 30-second visitor schedule continues unchanged');
  assert.ok(Math.abs(a.visual.unicornAge - 1.15) < 1 / a.rate && a.visual.unicornLevel > .001);
  assert.equal(a.visual.brewLevel, 0); assert.equal(a.visual.handLevel, 0); assert.equal(a.visual.ghostLevel, 0);
  assert.equal(a.cat.triggerCount, 0, 'the captured cat has no footsteps underneath its replacement');
  const beforeFlight = a.cat.time;
  a.setControls({ mode: 'flight', trailPull: .04, trailSpace: .2 });
  assert.equal(a.trigger('unicorn-escape'), false);
  assert.ok(rms(render(a, .008)) > .0001, 'the visible escape fades on takeoff');
  render(a, .06); assert.equal(rms(render(a, 1)), 0, 'neither hooves nor captured calls linger in flight delay');
  assert.equal(a.visual.unicornActive, false); assert.equal(a.visual.unicornLevel, 0); assert.equal(a.visual.delayLevel, 0);
  assert.ok(a.cat.time > beforeFlight + 1);
});

test('Stop, mute, reset and explicit cancellation release the unicorn and do not resume its pending sequence', () => {
  const actions = [dsp => dsp.setControls({ gate: false }), dsp => dsp.setEnabled(false),
    dsp => dsp.releaseAccents(), dsp => dsp.syncPhase(0, 0, undefined, undefined, undefined, undefined, createWitchCatClock(0))];
  for (const cancel of actions) {
    const dsp = engine(); dsp.trigger('unicorn-escape'); render(dsp, 1.1);
    cancel(dsp);
    assert.ok(rms(render(dsp, .008)) > .0001, 'an audible native call fades instead of cutting at cancellation');
    render(dsp, .06); render(dsp, .03);
    assert.equal(dsp.visual.unicornActive, false); assert.equal(dsp.visual.unicornLevel, 0);
    dsp.setControls({ gate: true }); dsp.setEnabled(true);
    assert.equal(rms(render(dsp, .2)), 0, 'the cancelled sparkle and hooves remain cancelled');
  }
  const late = engine();
  assert.equal(late.trigger('unicorn-escape', undefined, { startedAt: 29.9, direction: -1 }), true);
  assert.ok(Math.abs(late.visual.unicornAge - 1.1) < 1e-9); assert.equal(late.unicorn.direction, -1);
  assert.ok(rms(render(late, .08)) > .001);
});
