import assert from 'node:assert/strict';
import test from 'node:test';
import { BifurcatorEngine, createPreset } from '../src/instruments/bifurcator/model.js';

const make = (seconds = 4) => {
  const engine = new BifurcatorEngine(12000);
  engine.setParams(createPreset('logistic', { frequency: 220, sweepSeconds: seconds, clarity: .6, depth: 1 }));
  engine.reset();
  return engine;
};
const run = (engine, seconds) => {
  for (let sample = 0; sample < Math.round(engine.sampleRate * seconds); sample++) {
    const value = engine.sample();
    assert.ok(Number.isFinite(value) && Math.abs(value) <= .8);
  }
};

test('sweep advances on sample time through doubling and ends at a bounded chaotic parameter', () => {
  const engine = make();
  assert.equal(engine.startSweep(), true);
  run(engine, .5);
  assert.ok(Math.abs(engine.snapshot().sweep.progress - .125) < 1e-10);
  assert.ok(Math.abs(engine.snapshot().nativeParameter - 2.8) < .001);
  run(engine, 1.3);
  assert.ok(engine.snapshot().nativeParameter > 3.3 && engine.snapshot().nativeParameter < 3.5);
  run(engine, 2.4);
  assert.equal(engine.snapshot().sweep.running, false);
  assert.equal(engine.snapshot().sweep.progress, 1);
  assert.ok(Math.abs(engine.snapshot().nativeParameter - 3.99) < .001);
  assert.equal(engine.params.frequency, 220);
});

test('pause holds sweep; sound controls retain it and sweep time changes its pace', () => {
  const engine = make(8); engine.startSweep(); run(engine, 1);
  engine.setParams({ playing: false });
  const held = engine.snapshot(); run(engine, .3);
  assert.deepEqual(engine.snapshot().sweep, held.sweep);
  assert.equal(engine.params.regime, held.params.regime);
  engine.setParams({ playing: true, clarity: .3, frequency: 330, sweepSeconds: 4 });
  assert.equal(engine.snapshot().sweep.running, true);
  run(engine, .5);
  assert.ok(engine.snapshot().sweep.progress > held.sweep.progress + .11);
  assert.equal(engine.params.frequency, 330);
});

test('active sweep transfers with the orbit and continues sample-exactly without a renderer', () => {
  const engine = make(); engine.startSweep(); run(engine, 1.2);
  const joined = new BifurcatorEngine(engine.sampleRate);
  assert.equal(joined.importState(engine.exportState()), true);
  for (let sample = 0; sample < 6000; sample++) assert.equal(joined.sample(), engine.sample());
  assert.deepEqual(joined.exportState(), engine.exportState());
});

test('manual regime, model, reset and preset recall end the gesture while keeping transport', () => {
  const engine = make(); engine.startSweep(); run(engine, .8);
  const phase = engine.phase;
  engine.setParams({ regime: .5 });
  assert.equal(engine.snapshot().sweep.running, false);
  assert.equal(engine.phase, phase);
  assert.equal(engine.params.playing, true);
  engine.startSweep(); engine.setParams(createPreset('logistic', { frequency: 165 }));
  assert.equal(engine.snapshot().sweep.running, false);
  engine.startSweep(); engine.reset();
  assert.deepEqual(engine.snapshot().sweep, { running: false, progress: 0 });
  engine.startSweep(); engine.setParams({ model: 'lorenz' });
  assert.equal(engine.snapshot().sweep.running, false);
  assert.equal(engine.startSweep(), false);
});
