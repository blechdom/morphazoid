import assert from 'node:assert/strict';
import test from 'node:test';
import { calibratedOutputGain } from '../src/families/tract/throatazoid.js';
import { guardSpellingSample, protectSpellingSample, spellingOutputGain, SPELLING_VOICE_TRIMS, SPELLING_OUTPUT_CEILING } from '../src/instruments/spelling-synthesizer/spelling-output.js';

test('Spelling calibration is bounded, silent at zero and has one master taper for all voices', () => {
  for (const engine of Object.keys(SPELLING_VOICE_TRIMS)) {
    assert.equal(spellingOutputGain(engine, 0, true), 0);
    assert.equal(spellingOutputGain(engine, NaN, true), 0);
    assert.equal(spellingOutputGain(engine, -1, true), 0);
    const full = spellingOutputGain(engine, .82, true);
    assert(full > 0 && full < 5);
    assert.equal(spellingOutputGain(engine, 99, true), full);
    assert(Math.abs(spellingOutputGain(engine, .205, true) / full - .5) < 1e-12);
    for (const level of [0, .1, .46, .82]) {
      assert.equal(spellingOutputGain(engine, level), ['bell', 'lpc'].includes(engine) ? level : calibratedOutputGain(level), 'other consumers retain the legacy gain');
    }
  }
});

test('output protection is linear for normal samples, smooth at the knee and bounded at extremes', () => {
  for (const x of [-.5, -.01, 0, .01, .5]) assert.equal(protectSpellingSample(x), x);
  for (let index = 0; index < 10000; index++) {
    const x = index / 1000;
    assert(Math.abs(protectSpellingSample(x)) <= SPELLING_OUTPUT_CEILING);
    assert.equal(protectSpellingSample(-x), -protectSpellingSample(x));
    assert(protectSpellingSample(x + .001) >= protectSpellingSample(x));
  }
  assert(Math.abs((protectSpellingSample(.58001) - protectSpellingSample(.58)) / .00001 - 1) < .0001);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(protectSpellingSample(value), 0);
});


test('post-oversampling guard catches plosive overshoot without touching ordinary samples', () => {
  for (const x of [-.8, -.5, 0, .5, .8]) assert.equal(guardSpellingSample(x), x);
  for (const x of [-8, -1.0183, -.9, .9, 1.0183, 8]) {
    assert(Math.abs(guardSpellingSample(x)) <= SPELLING_OUTPUT_CEILING);
    assert.equal(Math.sign(guardSpellingSample(x)), Math.sign(x));
  }
});
