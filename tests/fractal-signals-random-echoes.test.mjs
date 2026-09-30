import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { createDefaultState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { randomizeState } from '../src/instruments/fractal-signals/presets.js';

function seeded(seed) {
  let value = seed;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('random Echoes keep audible source attacks close enough to audition at any phrase position', () => {
  const baseline = createDefaultState('echoes');
  for (let seed = 1; seed <= 200; seed++) {
    const state = randomizeState(baseline, seeded(seed));
    const events = generateStructure(state).events;
    const anchors = events.filter(event => event.depth === 0);
    const duration = state.phrase / state.rate;
    assert.ok(anchors.length > 0);
    for (let i = 0; i < anchors.length; i++) {
      const next = anchors[(i + 1) % anchors.length].phase + (i + 1 === anchors.length ? 1 : 0);
      assert.ok((next - anchors[i].phase) * duration <= 1.250001, `seed ${seed}: looping attack gap`);
    }
    if (state.pingPong) {
      assert.ok(2 * anchors[0].phase * duration <= 1.250001, `seed ${seed}: first turn`);
      assert.ok(2 * (1 - anchors.at(-1).phase) * duration <= 1.250001, `seed ${seed}: last turn`);
    }
  }
});

test('Echoes Random is audible after recall in mid-phrase, without restarting or arming playback', () => {
  const sr = 24000, baseline = createDefaultState('echoes');
  const engines = new Set();
  // These previously made seconds of exact silence, or envelopes too quiet to
  // audition because the attack never reached its peak before gate release.
  for (const seed of [2, 6, 7, 8, 9, 12, 18, 59]) {
    const state = randomizeState(baseline, seeded(seed));
    engines.add(state.engine);
    const structure = generateStructure(state);
    const dsp = new FractalDSP(sr, baseline, generateStructure(baseline));
    dsp.setPhase(.4); dsp.setPlaying(true);
    dsp.setState(state, structure, { resetMotions: true });
    assert.equal(dsp.phase, .4); assert.equal(dsp.playing, true);
    let powerL = 0, powerR = 0, peak = 0;
    const left = new Float32Array(128), right = new Float32Array(128);
    const blocks = Math.ceil(sr * 3 / 128);
    for (let block = 0; block < blocks; block++) {
      dsp.process(left, right);
      for (let i = 0; i < left.length; i++) {
        assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
        powerL += left[i] ** 2; powerR += right[i] ** 2;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
    }
    assert.ok(Math.sqrt(powerL / (blocks * 128)) > .0003, `seed ${seed}: left audition`);
    assert.ok(Math.sqrt(powerR / (blocks * 128)) > .0003, `seed ${seed}: right audition`);
    assert.ok(peak <= .881, `seed ${seed}: bounded output`);
    const paused = new FractalDSP(sr, baseline, generateStructure(baseline));
    paused.setPhase(.4); paused.setState(state, structure, { resetMotions: true });
    paused.process(left, right);
    assert.equal(paused.playing, false); assert.equal(paused.phase, .4);
    assert.ok(left.every(value => value === 0) && right.every(value => value === 0));
  }
  assert.deepEqual([...engines].sort(), ['resonant', 'shepard', 'strikes']);
});
