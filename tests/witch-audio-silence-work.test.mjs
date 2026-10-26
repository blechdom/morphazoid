import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightMixDelay, WitchFabricFilter } from '../src/instruments/witch/witch-worklet.js';
import { WitchSceneDSP } from '../src/instruments/witch/witch-scene-audio.js';

test('cleared flight history skips reads while preserving control slews and a later echo', () => {
  const delay = new FlightMixDelay(8000), runningReads = new FlightMixDelay(8000);
  const read = delay.read;
  let reads = 0;
  delay.read = function (...args) { reads++; return read.apply(this, args); };
  for (const dsp of [delay, runningReads]) dsp.controls = { ...dsp.controls, mode: 'flight',
    gate: false, ghostGate: false, trailPull: .12, trailTwist: .91, trailSpace: .86 };
  for (let i = 0; i < 4000; i++) {
    // Exercise the full native read path against the known-empty history.
    runningReads.cleared = false;
    delay.next(0, 0, false); runningReads.next(0, 0, false);
  }
  assert.equal(reads, 0);
  for (const key of ['pull', 'twist', 'space', 'delayL', 'delayR', 'headPhase', 'ridePhase', 'writeIndex']) {
    assert.equal(delay[key], runningReads[key], `${key} keeps its sample clock`);
  }
  for (const dsp of [delay, runningReads]) { dsp.controls = { ...dsp.controls, gate: true }; dsp.resume(); }
  let echoEnergy = 0;
  for (let i = 0; i < 16000; i++) {
    const source = i < 800 ? Math.sin(i * Math.PI * 2 * 191 / 8000) * .2 : 0;
    delay.next(source, source * .6, true); runningReads.next(source, source * .6, true);
    assert.equal(delay.left, runningReads.left); assert.equal(delay.right, runningReads.right);
    echoEnergy += delay.wetLeft ** 2 + delay.wetRight ** 2;
  }
  assert.ok(reads > 0 && echoEnergy > .01, 'a fresh phrase resumes the complete moving echo cloud');
});

test('silent Fabric slews its entire lattice before a later puff and retains its filter tails', () => {
  const fabric = new WitchFabricFilter(8000);
  fabric.setControls(.12, .91, .8, .6);
  const expected = fabric.filters.map(filter => ({ ...filter }));
  let wet = 0;
  for (let i = 0; i < 441; i++) {
    wet += (fabric.targetWet - wet) * fabric.smooth;
    for (const filter of expected) {
      for (const key of ['a1', 'a2', 'a3', 'k']) filter[key] += (filter.target[key] - filter[key]) * fabric.smooth;
      filter.gainL += (filter.targetGainL - filter.gainL) * fabric.smooth;
      filter.gainR += (filter.targetGainR - filter.gainR) * fabric.smooth;
    }
    fabric.next(0, 0);
    assert.equal(fabric.left, 0); assert.equal(fabric.right, 0);
  }
  assert.equal(fabric.wet, wet);
  assert.deepEqual(fabric.filters, expected, 'silent preparation changes coefficients but leaves signal state empty');
  fabric.next(.17, -.08);
  assert.ok(fabric.filters.some(filter => filter.ic1 !== 0 && filter.ic2 !== 0));
  let tail = 0;
  for (let i = 0; i < 800; i++) {
    fabric.next(0, 0);
    assert.ok(Number.isFinite(fabric.left) && Number.isFinite(fabric.right));
    tail += fabric.left ** 2 + fabric.right ** 2;
  }
  assert.ok(tail > .0001, 'zero input does not bypass stored resonator energy');
});

test('a sleeping web preserves strain timing, complete pluck tails and the next gesture', () => {
  const scene = new WitchSceneDSP(8000), runningWeb = new WitchSceneDSP(8000);
  const sample = scene.web.sample;
  let samples = 0;
  scene.web.sample = function (...args) { samples++; return sample.apply(this, args); };
  for (let i = 0; i < 4000; i++) { scene.next(true); runningWeb.next(true); }
  assert.equal(samples, 0, 'an untouched web does not process its 24 empty voices');
  let tail = 0;
  for (let i = 0; i < 40000; i++) {
    if (i === 0 || i === 24007) {
      assert.equal(scene.trigger('web-4'), true); assert.equal(runningWeb.trigger('web-4'), true);
    }
    runningWeb.webDormant = false;
    scene.next(true); runningWeb.next(true);
    assert.equal(scene.left, runningWeb.left); assert.equal(scene.right, runningWeb.right);
    assert.equal(scene.webControl, runningWeb.webControl);
    if (scene.webDormant) tail += scene.webLowL ** 2 + scene.webLowR ** 2;
  }
  assert.ok(samples > 0 && samples < 30000, 'each finished pluck returns to the sleeping path');
  assert.ok(tail > 0, 'the lowpass keeps decaying after the last string ends');
  assert.equal(scene.web.randomState, runningWeb.web.randomState);
});
