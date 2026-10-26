import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchShapeCharmDSP, WITCH_SHAPE_CHARM_DURATION } from '../src/instruments/witch/witch-shape-audio.js';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_SHAPE_FORMS, WITCH_SHAPE_MORPH_SECONDS, createWitchShapeState } from '../src/instruments/witch/witch-shape-model.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { buildShapesScene } from '../src/instruments/shapes/shapes-scene.js';
import { originalSynthSpecs } from '../src/instruments/shapes/original-audio.js';
import { normalizeVoiceGains, limitVoicePeakSum } from '../src/audio.js';

const rms = data => Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let frame = 0; frame < data.length; frame += block) dsp.process(data.subarray(frame, Math.min(data.length, frame + block)));
  return data;
}
function excerpt(dsp, start, seconds) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let frame = 0; frame < data.length; frame++) {
    dsp.next(start + frame / dsp.rate);
    data[frame] = (dsp.left + dsp.right) * .5;
  }
  return data;
}
function engine(extra = {}) {
  const dsp = new WitchDSP(8000);
  dsp.setControls({ gate: true, ghostGate: true, brewEnabled: false, handEnabled: false, backingEnabled: false, ...extra });
  dsp.syncPhase(0, 0, undefined, undefined, undefined, undefined, createWitchCatClock(31));
  dsp.setEnabled(true); return dsp;
}

test('prepared charm plans retain SHAPES native geometry voices without requiring structuredClone in the worklet', () => {
  const clone = globalThis.structuredClone;
  let dsp;
  try { globalThis.structuredClone = undefined; dsp = new WitchShapeCharmDSP(8000); }
  finally { globalThis.structuredClone = clone; }
  assert.equal(dsp.plans.length, WITCH_SHAPE_FORMS.length);
  assert.equal(new WitchShapeCharmDSP(48000).plans, dsp.plans, 'native geometry preparation is shared across engines');
  for (const plan of dsp.plans) {
    const state = createWitchShapeState(plan.form), p = plan.parameters;
    Object.assign(state.voice, { engine: p.soundMode, baseHz: p.baseFrequency, rangeOctaves: p.pitchRange, spread: .85, voiceLimit: 8 });
    Object.assign(state.play, { running: true, rateCyclesPerSecond: p.speed });
    Object.assign(state.synthesis.tone, { fmIndex: p.fmIndex, fmRatio: p.fmRatio });
    Object.assign(state.synthesis.envelope, { enabled: false, level: 1 });
    assert.equal(plan.frames.length, 49);
    for (const index of [0, 12, 24, 36, 48]) {
      const frame = plan.frames[index]; state.play.continuousPhase = frame.phase;
      const native = limitVoicePeakSum(normalizeVoiceGains(originalSynthSpecs(buildShapesScene(state), state)), .78);
      assert.deepEqual(frame.specs, native, `${plan.form}: native pitch, depth modulation, corner strength and stereo are retained`);
      assert.ok(frame.specs.length <= 8 && frame.targets.length <= 16);
      assert.ok(frame.specs.reduce((sum, voice) => sum + voice.gain, 0) <= .780001);
    }
  }
});

test('every native form gives a distinct finite scan with a bounded reusable voice pool', () => {
  const dsp = new WitchShapeCharmDSP(8000), pool = dsp.voices, plans = dsp.plans, signals = [];
  for (const form of WITCH_SHAPE_FORMS) {
    assert.equal(dsp.trigger(10, { form: form.id }), true);
    const signal = excerpt(dsp, 10, WITCH_SHAPE_CHARM_DURATION + .02);
    assert.ok(signal.every(value => Number.isFinite(value) && Math.abs(value) < .4), form.id);
    assert.ok(rms(signal) > .001, `${form.id} has an audible native contour`);
    assert.equal(dsp.active, false); assert.equal(dsp.activeVoiceCount, 0);
    assert.equal(dsp.form, form.id); assert.equal(dsp.age, WITCH_SHAPE_CHARM_DURATION);
    assert.equal(dsp.left, 0); assert.equal(dsp.right, 0);
    assert.equal(dsp.voices, pool); assert.equal(pool.length, 24); assert.equal(dsp.plans, plans);
    signals.push(signal);
  }
  for (let i = 0; i < signals.length; i++) for (let j = 0; j < i; j++) {
    assert.ok(rms(signals[i].map((value, index) => value - signals[j][index])) > .001,
      `${WITCH_SHAPE_FORMS[i].id} differs from ${WITCH_SHAPE_FORMS[j].id}`);
  }
});

test('rapid clicks coalesce through a short fade and late startup joins the selected geometry without restarting its scan', () => {
  const a = new WitchShapeCharmDSP(8000), b = new WitchShapeCharmDSP(8000), pool = a.voices;
  for (const dsp of [a, b]) { dsp.trigger(10, { form: 'cube' }); excerpt(dsp, 10, .2); }
  for (let click = 0; click < 100; click++) assert.equal(a.trigger(10.2, { form: click % 2 ? 'torus' : 'tesseract', startedAt: 10.2 }), true);
  a.next(10.2); b.next(10.2);
  assert.ok(Math.abs(a.left - b.left) < .001 && Math.abs(a.right - b.right) < .001, 'retrigger starts its release without resetting a nonzero wave');
  assert.equal(a.pending, true);
  excerpt(a, 10.2 + 1 / a.rate, .02);
  assert.equal(a.form, 'torus'); assert.equal(a.pending, false); assert.ok(a.age >= .019);
  assert.equal(a.voices, pool); assert.ok(a.activeVoiceCount <= pool.length);
  const late = new WitchShapeCharmDSP(8000);
  assert.equal(late.trigger(10.55, { form: 'hyperstar', startedAt: 10 }), true);
  assert.ok(Math.abs(late.age - .55) < 1e-9);
  assert.ok(rms(excerpt(late, 10.55, .08)) > .001);
  assert.ok(late.frame >= Math.floor(.55 / WITCH_SHAPE_MORPH_SECONDS * 48), 'the geometry reader has already crossed the earlier part of the form');
  assert.equal(new WitchShapeCharmDSP(8000).trigger(11.5, { form: 'cube', startedAt: 10 }), false, 'expired loading queues stay silent');
  const cancelled = new WitchShapeCharmDSP(8000);
  cancelled.trigger(10, { form: 'cube' }); cancelled.cancel();
  assert.equal(rms(excerpt(cancelled, 10, .1)), 0, 'cancellation before the first sample cannot open a new edge voice');
  a.trigger(10.23, { form: 'cube' }); a.cancel(); excerpt(a, 10.23, .06);
  assert.equal(a.active, false); assert.equal(a.pending, false); assert.equal(a.activeVoiceCount, 0);
  assert.equal(rms(excerpt(a, 10.3, .2)), 0, 'cancellation discards the coalesced request');
});

test('shape charm follows the sample clock and stays in the ensemble flight delay, bypassing Fabric', () => {
  const off = new WitchDSP(8000); assert.equal(off.trigger('shape-charm', undefined, { form: 'cube' }), false);
  const a = engine(), b = engine();
  for (const dsp of [a, b]) assert.equal(dsp.trigger('shape-charm', undefined, { form: 'cube', startedAt: 31 }), true);
  assert.deepEqual(render(a, .6), render(b, .6, 4800), 'render/display blocks do not schedule the shape');
  assert.ok(a.visual.shapeCharmLevel > .001); assert.equal(a.visual.shapeCharmForm, 'cube');
  assert.ok(Math.abs(a.visual.shapeCharmAge - .6) < 1 / a.rate);
  assert.equal(a.visual.brewLevel, 0); assert.equal(a.visual.handLevel, 0); assert.equal(a.visual.ghostLevel, 0);
  const plain = engine({ mode: 'flight', trailPull: .04, trailSpace: .2 });
  const cloth = engine({ mode: 'flight', trailPull: .04, trailSpace: .2, fabricX: .04, fabricY: .97, fabricPull: 1 });
  for (const dsp of [plain, cloth]) dsp.trigger('shape-charm', undefined, { form: 'hyperstar' });
  const signal = render(plain, .9);
  assert.deepEqual(signal, render(cloth, .9)); assert.ok(plain.visual.delayLevel > .0001);
  assert.equal(plain.visual.fabricWindEnvelope, 0);
  assert.ok(signal.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
});

test('Stop, mute, reset and explicit accent release fade the charm and discard pending retriggers', () => {
  const actions = [dsp => dsp.setControls({ gate: false }), dsp => dsp.setEnabled(false), dsp => dsp.releaseAccents(),
    dsp => dsp.syncPhase(0, 0, undefined, undefined, undefined, undefined, createWitchCatClock(0))];
  for (const cancel of actions) {
    const dsp = engine(); dsp.trigger('shape-charm', undefined, { form: 'cube' }); render(dsp, .3);
    dsp.trigger('shape-charm', undefined, { form: 'torus' }); cancel(dsp);
    assert.ok(rms(render(dsp, .008)) > .0001, 'an audible contour releases instead of cutting');
    render(dsp, .06); render(dsp, .03);
    assert.equal(dsp.visual.shapeCharmActive, false); assert.equal(dsp.visual.shapeCharmLevel, 0);
    assert.equal(dsp.shapeCharm.pending, false); assert.equal(dsp.shapeCharm.activeVoiceCount, 0);
    dsp.setEnabled(true); dsp.setControls({ gate: true });
    assert.equal(rms(render(dsp, .2)), 0, 'resume never plays a cancelled form');
  }
});
