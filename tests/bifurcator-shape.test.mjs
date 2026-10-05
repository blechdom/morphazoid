import assert from 'node:assert/strict';
import test from 'node:test';
import { BifurcatorEngine, DEFAULT_PARAMS, MODELS, ENUM_PARAMS, createPreset, normalizeParams, randomizeParams } from '../src/instruments/bifurcator/model.js';
import { PRESETS, captureScene } from '../src/instruments/bifurcator/presets.js';

const make = (model = 'lorenz', patch = {}, rate = 12000) => {
  const engine = new BifurcatorEngine(rate);
  engine.setParams(createPreset(model, { sonification: 'shape', ...patch }));
  engine.reset();
  return engine;
};
const run = (engine, seconds) => {
  let energy = 0;
  const frames = Math.round(engine.sampleRate * seconds);
  for (let frame = 0; frame < frames; frame++) {
    const value = engine.sample();
    assert.ok(Number.isFinite(value) && Math.abs(value) <= .8);
    energy += value * value;
  }
  return Math.sqrt(energy / Math.max(1, frames));
};

test('shape heads sonify every real model while pitch is independent of shape growth', () => {
  for (const model of MODELS) {
    const low = make(model.id, { frequency: 80, headCount: 4 });
    const high = make(model.id, { frequency: 320, headCount: 4 });
    const initial = [...low.snapshot().point];
    assert.ok(run(low, 2) > .01, model.id);
    assert.ok(run(high, 2) > .01, model.id);
    const a = low.snapshot(), b = high.snapshot();
    assert.deepEqual(a.point, b.point, `${model.id}: low pitch does not clock the model`);
    assert.deepEqual(a.shape.points, b.shape.points);
    assert.notDeepEqual(a.point, initial, `${model.id}: model evolves`);
    assert.ok(a.shape.count > 10 && a.shape.count <= 1024);
    assert.equal(a.shape.heads.length, 4);
    assert.deepEqual(a.shape.heads.map(head => [head.x, head.y]), b.shape.heads.map(head => [head.x, head.y]));
    assert.ok(b.shape.heads.some((head, index) => head.frequency > a.shape.heads[index].frequency * 3.9));
  }
});

test('holding the contour freezes real growth while readers and sound continue', () => {
  const engine = make(); run(engine, 2);
  engine.setParams({ growShape: false });
  const held = engine.snapshot();
  assert.ok(run(engine, .6) > .01);
  const after = engine.snapshot();
  assert.deepEqual(after.point, held.point);
  assert.deepEqual(after.shape.points, held.shape.points);
  assert.notDeepEqual(after.shape.heads.map(head => head.position), held.shape.heads.map(head => head.position));
  engine.setParams({ growShape: true }); run(engine, .2);
  assert.notDeepEqual(engine.snapshot().point, held.point);
});

test('pause releases then freezes contour and reader clocks; resume retains travel', () => {
  const engine = make(); run(engine, 1.5);
  engine.setParams({ playing: false }); run(engine, .3);
  const held = engine.snapshot();
  assert.equal(held.diagnostics.paused, true);
  assert.ok(run(engine, .2) < 1e-8);
  assert.deepEqual(engine.snapshot().shape, held.shape);
  assert.deepEqual(engine.snapshot().point, held.point);
  engine.setParams({ playing: true }); run(engine, .1);
  assert.notDeepEqual(engine.snapshot().shape.heads.map(head => head.position), held.shape.heads.map(head => head.position));
  assert.ok(engine.snapshot().shape.count >= held.shape.count);
});

test('the full rolling contour and all voices transfer sample-exactly and across sample rates', () => {
  const engine = make('lorenz', { headCount: 4, headRate: .43 }, 8000);
  run(engine, 9.2);
  assert.equal(engine.snapshot().shape.count, 1024);
  const state = engine.exportState();
  const joined = new BifurcatorEngine(engine.sampleRate);
  assert.equal(joined.importState(state), true);
  for (let frame = 0; frame < 3000; frame++) assert.equal(joined.sample(), engine.sample());
  assert.deepEqual(joined.exportState(), engine.exportState());
  const differentRate = new BifurcatorEngine(96000);
  assert.equal(differentRate.importState(engine.exportState()), true);
  assert.deepEqual(differentRate.snapshot().shape, engine.snapshot().shape);
  assert.ok(run(differentRate, .1) > .01);
});

test('voice changes preserve model and reader state; model and Reset replace old geometry', () => {
  const engine = make(); run(engine, 1);
  const before = engine.exportState();
  engine.setParams({ sonification: 'orbit' });
  assert.deepEqual(engine.snapshot().point, before.point);
  assert.deepEqual(engine.exportState().shape, before.shape);
  assert.equal(engine.params.playing, true);
  engine.setParams({ sonification: 'shape' });
  assert.deepEqual(engine.exportState().shape, before.shape);
  engine.setParams({ sonification: 'orbit' }); run(engine, .2);
  const advanced = engine.exportState();
  engine.setParams({ sonification: 'shape' });
  assert.deepEqual(engine.snapshot().point, advanced.point);
  assert.equal(engine.snapshot().shape.count, 1, 'missing contour time is not joined by a synthetic chord');
  assert.deepEqual(engine.exportState().shape.heads.map(head => head.phase), advanced.shape.heads.map(head => head.phase));
  engine.setParams({ model: 'rossler' });
  assert.equal(engine.snapshot().shape.count, 1);
  assert.notDeepEqual(engine.snapshot().shape.points, before.shape.points);
  run(engine, .2); engine.reset();
  assert.equal(engine.snapshot().shape.count, 1);
  assert.equal(engine.params.playing, true);
  assert.ok(engine.exportState().shape.heads.every(head => head.phase === 0));
});

test('shape playback remains finite at extreme musical settings', () => {
  for (const model of MODELS) {
    const engine = make(model.id, { regime: 1, frequency: 1e20, pitchSpan: 1e20, headCount: 1e20, headRate: 1e20, speed: 1e20, sigma: 1e20, beta: 1e20, a: 1e20, b: 1e20 }, 8000);
    run(engine, .7);
    const state = engine.snapshot();
    assert.ok(state.diagnostics.integrationSteps <= 8);
    assert.ok(state.shape.count <= 1024 && state.shape.heads.length <= 16);
    assert.ok(state.shape.heads.every(head => Number.isFinite(head.frequency) && head.frequency <= 2000));
  }
});

test('resuming growth after elapsed time in the other voice crossfades a fresh contour', () => {
  const engine = make(); run(engine, .5);
  engine.setParams({ sonification: 'orbit' }); run(engine, .1);
  engine.setParams({ sonification: 'shape', growShape: false }); run(engine, .1);
  const held = engine.exportState();
  engine.setParams({ growShape: true });
  assert.equal(engine.snapshot().shape.count, 1);
  engine.sample();
  assert.equal(engine.exportState().voice, held.voice, 'first sample starts at the preceding voice');
  assert.ok(engine.exportState().transition.seconds > .024);
  assert.ok(run(engine, .05) > .01);
});

test('new full presets and randomization own all reader controls while preserving transport', () => {
  const musicalKeys = Object.keys(DEFAULT_PARAMS).filter(key => key !== 'playing').sort();
  assert.equal(PRESETS.length, 50);
  for (const preset of PRESETS) assert.deepEqual(Object.keys(preset.snapshot).sort(), musicalKeys);
  assert.ok(PRESETS.slice(0, 17).every(preset => preset.snapshot.sonification === 'orbit'));
  assert.ok(PRESETS.slice(17, 28).every(preset => preset.snapshot.sonification === 'shape'));
  assert.ok(PRESETS.slice(28).every(preset => preset.snapshot.sonification === 'rhythm'));
  const seen = { ...Object.fromEntries(Object.keys(ENUM_PARAMS).map(key => [key, new Set()])), headCount: new Set(), growShape: new Set() };
  let seed = 98127;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 80; index++) {
    const patch = randomizeParams({ ...DEFAULT_PARAMS, playing: false }, random);
    assert.equal(patch.playing, false);
    assert.equal(patch.headCount, Math.round(patch.headCount));
    for (const key of Object.keys(seen)) seen[key].add(patch[key]);
    assert.deepEqual(Object.keys(captureScene(patch)).sort(), musicalKeys);
  }
  for (const [key, choices] of Object.entries(ENUM_PARAMS)) assert.equal(seen[key].size, choices.length, key);
  assert.equal(seen.headCount.size, 16); assert.equal(seen.growShape.size, 2);
  const hostile = normalizeParams({ sonification: '__proto__', pitchAxis: 'bogus', headCount: 2.8, growShape: 'false' });
  assert.equal(hostile.sonification, 'orbit'); assert.equal(hostile.pitchAxis, 'height');
  assert.equal(hostile.headCount, 3); assert.equal(hostile.growShape, true);
});

test('malformed reader imports are transactional and legacy state remains importable', () => {
  const engine = make(); run(engine, .5);
  const before = engine.exportState();
  const invalid = structuredClone(before); invalid.shape.points[0] = NaN;
  assert.equal(engine.importState(invalid), false);
  assert.deepEqual(engine.exportState(), before);
  const legacy = structuredClone(before); delete legacy.shape;
  assert.equal(engine.importState(legacy), true);
  assert.equal(engine.snapshot().shape.count, 1);
  assert.deepEqual(engine.snapshot().point, before.point);
});
