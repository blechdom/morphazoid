import assert from 'node:assert/strict';
import test from 'node:test';
import { BifurcatorEngine, DEFAULT_PARAMS, MODELS, PARAM_RANGES, createPreset, normalizeParams, randomizeParams } from '../src/instruments/bifurcator/model.js';

const RATE = 12000;
const run = (engine, seconds) => {
  let sum = 0;
  for (let frame = 0; frame < Math.round(engine.sampleRate * seconds); frame += 1) {
    const value = engine.sample();
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.800000001, `bounded sample: ${value}`);
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, Math.round(engine.sampleRate * seconds)));
};
const engineFor = (model, overrides = {}) => {
  const engine = new BifurcatorEngine(RATE);
  engine.setParams(createPreset(model, { playing: true, ...overrides }));
  return engine;
};
const regimeFor = (model, value) => {
  const [low, high] = MODELS.find((entry) => entry.id === model).nativeRange;
  return (value - low) / (high - low);
};
const difference = (left, right) => Math.hypot(...left.map((value, index) => value - right[index]));
const deviation = (values) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

test('complete presets and randomization normalize hostile inputs', () => {
  const normalized = normalizeParams({ model: '__proto__', regime: 1e30, frequency: -5, cutoff: Infinity, sigma: NaN, beta: -Infinity, clarity: '0.7', playing: false });
  assert.equal(normalized.model, DEFAULT_PARAMS.model);
  assert.equal(normalized.regime, 1);
  assert.equal(normalized.frequency, 35);
  assert.equal(normalized.cutoff, DEFAULT_PARAMS.cutoff);
  assert.equal(normalized.clarity, 0.7);
  assert.equal(normalized.playing, false);
  for (const model of MODELS) {
    const preset = createPreset(model.id);
    assert.deepEqual(Object.keys(preset).sort(), Object.keys(DEFAULT_PARAMS).sort());
    assert.equal(preset.regime, model.defaultRegime);
  }
  const random = randomizeParams({ ...DEFAULT_PARAMS, playing: false }, () => 0.8);
  assert.equal(random.playing, false);
  for (const [key, [low, high]] of Object.entries(PARAM_RANGES)) assert.ok(random[key] >= low && random[key] <= high);
});

test('all systems stay finite at extreme controls with bounded integration cost', () => {
  for (const model of MODELS) {
    for (const endpoint of [0, 1]) {
      const engine = new BifurcatorEngine(8000);
      engine.setParams(createPreset(model.id, { regime: endpoint, frequency: 1e20, speed: 1e20, cutoff: 1e20, sigma: 1e20, beta: 1e20, a: 1e20, b: 1e20, clarity: endpoint, depth: 1, playing: true }));
      engine.perturb(endpoint ? 1 : -1);
      run(engine, 0.6);
      const snapshot = engine.snapshot();
      assert.ok(snapshot.point.every(Number.isFinite), model.id);
      assert.ok(snapshot.diagnostics.integrationSteps <= 8, model.id);
    }
  }
});

test('equal initial conditions and automation produce deterministic audio', () => {
  for (const model of MODELS) {
    const left = engineFor(model.id);
    const right = engineFor(model.id);
    for (let frame = 0; frame < 4000; frame += 1) {
      if (frame === 1500) {
        left.setParams({ regime: 0.61, frequency: 170, clarity: 0.8, cutoff: 1200 });
        right.setParams({ regime: 0.61, frequency: 170, clarity: 0.8, cutoff: 1200 });
      }
      assert.equal(left.sample(), right.sample(), model.id);
    }
    assert.deepEqual(left.snapshot(), right.snapshot());
  }
});

test('Hopf onset has radius sqrt(mu), negative growth settles to silence, and onset can restart', () => {
  const engine = engineFor('hopf', { regime: regimeFor('hopf', 0.75), frequency: 80, clarity: 1 });
  run(engine, 0.6);
  assert.ok(Math.abs(engine.snapshot().radius - Math.sqrt(0.75)) < 0.005);
  engine.setParams({ regime: regimeFor('hopf', -0.6) });
  run(engine, 0.8);
  assert.ok(engine.snapshot().radius < 1e-10);
  assert.ok(run(engine, 0.1) < 1e-8);
  engine.setParams({ regime: regimeFor('hopf', 0.75) });
  run(engine, 0.6);
  assert.ok(engine.snapshot().radius > 0.8);
});

test('logistic fixed point, period two and period four survive audio-clock synchronization', () => {
  const cycleStates = (r) => {
    const engine = engineFor('logistic', { regime: regimeFor('logistic', r), frequency: 100, speed: 1, clarity: 1 });
    run(engine, 1.5);
    const states = [];
    let phase = engine.snapshot().phase;
    while (states.length < 12) {
      engine.sample();
      const snapshot = engine.snapshot();
      if (snapshot.phase < phase) states.push(snapshot.point[0]);
      phase = snapshot.phase;
    }
    return states;
  };
  const fixed = cycleStates(2.8);
  assert.ok(Math.max(...fixed) - Math.min(...fixed) < 1e-8);
  assert.ok(Math.abs(fixed[0] - (1 - 1 / 2.8)) < 1e-8);
  const period2 = cycleStates(3.2);
  assert.ok(Math.abs(period2[0] - period2[1]) > 0.2);
  assert.ok(Math.abs(period2[0] - period2[2]) < 1e-8);
  const period4 = cycleStates(3.5);
  assert.ok(Math.abs(period4[0] - period4[2]) > 0.03);
  assert.ok(Math.abs(period4[0] - period4[4]) < 1e-8);
});

test('logistic period doubling adds an actual half-frequency audio component', () => {
  const component = (r, hz) => {
    const engine = engineFor('logistic', { regime: regimeFor('logistic', r), frequency: 100, clarity: 1, depth: 1, cutoff: 6000 });
    run(engine, 2);
    let sine = 0, cosine = 0;
    const frames = RATE;
    for (let frame = 0; frame < frames; frame += 1) {
      const value = engine.sample();
      const angle = 2 * Math.PI * hz * frame / RATE;
      sine += value * Math.sin(angle);
      cosine += value * Math.cos(angle);
    }
    return 2 * Math.hypot(sine, cosine) / frames;
  };
  const fixedSubharmonic = component(2.8, 50);
  const doubledSubharmonic = component(3.2, 50);
  assert.ok(fixedSubharmonic < 0.001);
  assert.ok(doubledSubharmonic > 0.02 && doubledSubharmonic > 20 * fixedSubharmonic);
});

test('fold retains both branches at the same bias and exhibits hysteresis', () => {
  const engine = engineFor('fold', { regime: regimeFor('fold', -0.6), speed: 3, clarity: 1 });
  run(engine, 0.6);
  assert.ok(engine.snapshot().point[0] < -1);
  engine.setParams({ regime: 0.5 });
  run(engine, 0.4);
  assert.ok(Math.abs(engine.snapshot().point[0] + 1) < 0.001);
  engine.setParams({ regime: regimeFor('fold', 0.3) });
  run(engine, 0.4);
  assert.ok(engine.snapshot().point[0] < -0.7);
  engine.setParams({ regime: regimeFor('fold', 0.5) });
  run(engine, 0.6);
  assert.ok(engine.snapshot().point[0] > 1);
  engine.setParams({ regime: 0.5 });
  run(engine, 0.4);
  assert.ok(Math.abs(engine.snapshot().point[0] - 1) < 0.001);
  engine.setParams({ regime: regimeFor('fold', -0.3) });
  run(engine, 0.4);
  assert.ok(engine.snapshot().point[0] > 0.7);
  engine.setParams({ regime: regimeFor('fold', -0.5) });
  run(engine, 0.6);
  assert.ok(engine.snapshot().point[0] < -1);
});

test('fold opposite stable branches produce distinct steady pitches', () => {
  const engine = engineFor('fold', { regime: 0.5, frequency: 110, speed: 3, clarity: 1 });
  const countCrossings = () => {
    let crossings = 0, previous = engine.sample();
    for (let frame = 0; frame < RATE; frame += 1) {
      const value = engine.sample();
      if (previous <= 0 && value > 0) crossings += 1;
      previous = value;
    }
    return crossings;
  };
  run(engine, 0.5);
  const positive = countCrossings();
  engine.perturb(-0.8);
  run(engine, 0.5);
  const negative = countCrossings();
  assert.ok(engine.snapshot().point[0] < -0.99);
  assert.ok(positive / negative > 1.8 && positive / negative < 2.1, `${positive} / ${negative}`);
});

test('Lorenz stable equilibria and chaotic variation follow the actual equations', () => {
  const stable = engineFor('lorenz', { regime: regimeFor('lorenz', 10), frequency: 220, beta: 2 });
  run(stable, 1.2);
  const point = stable.snapshot().point;
  assert.ok(Math.abs(Math.abs(point[0]) - Math.sqrt(2 * 9)) < 0.01);
  assert.ok(Math.abs(point[1] - point[0]) < 0.01);
  assert.ok(Math.abs(point[2] - 9) < 0.01);
  stable.setParams({ beta: 3 });
  run(stable, 1.2);
  assert.ok(Math.abs(Math.abs(stable.snapshot().point[0]) - Math.sqrt(3 * 9)) < 0.01);
  const chaotic = engineFor('lorenz', { frequency: 220 });
  run(chaotic, 0.8);
  const xs = [];
  for (let index = 0; index < 150; index += 1) { run(chaotic, 0.01); xs.push(chaotic.snapshot().point[0]); }
  assert.ok(deviation(xs) > 4);
  assert.equal(chaotic.snapshot().diagnostics.recoveries, 0);
});

test('Lorenz and Rössler secondary parameters change trajectories without resetting', () => {
  for (const [model, patch] of [['lorenz', { sigma: 18, beta: 1.1 }], ['rossler', { a: 0.35, b: 0.3 }]]) {
    const reference = engineFor(model);
    const changed = engineFor(model);
    run(reference, 0.2);
    run(changed, 0.2);
    const before = changed.snapshot().point;
    changed.setParams(patch);
    assert.deepEqual(changed.snapshot().point, before);
    run(reference, 0.2);
    run(changed, 0.2);
    assert.ok(difference(reference.snapshot().point, changed.snapshot().point) > 0.1, model);
  }
});

test('clarity changes sound while preserving the mathematical orbit', () => {
  for (const model of MODELS) {
    const rough = engineFor(model.id, { clarity: 0, depth: 1 });
    const clear = engineFor(model.id, { clarity: 1, depth: 1 });
    run(rough, 0.7);
    run(clear, 0.7);
    let squaredDifference = 0;
    for (let frame = 0; frame < 3000; frame += 1) squaredDifference += (rough.sample() - clear.sample()) ** 2;
    assert.ok(Math.sqrt(squaredDifference / 3000) > 0.04, model.id);
    assert.deepEqual(rough.snapshot().point, clear.snapshot().point, model.id);
  }
});

test('state import continues exactly at the same rate and joins a different sample rate', () => {
  for (const model of MODELS) {
    const source = engineFor(model.id);
    run(source, 0.3);
    const state = source.exportState();
    assert.equal('sampleRate' in state, false);
    const target = new BifurcatorEngine(RATE);
    assert.equal(target.importState(JSON.parse(JSON.stringify(state))), true);
    for (let frame = 0; frame < 300; frame += 1) assert.equal(source.sample(), target.sample(), model.id);
    const audio = new BifurcatorEngine(48000);
    assert.equal(audio.importState(state), true);
    assert.deepEqual(audio.snapshot().point, state.point);
    assert.equal(audio.snapshot().phase, state.phase);
    run(audio, 0.1);
  }
  assert.equal(new BifurcatorEngine().importState({ version: 1, model: '__proto__', point: [0, 0, 0] }), false);
});

test('pause releases audio then freezes orbit and phase; resumed orbit remains continuous', () => {
  const engine = engineFor('lorenz');
  run(engine, 0.2);
  engine.setParams({ playing: false });
  run(engine, 0.3);
  const paused = engine.snapshot();
  assert.equal(paused.diagnostics.paused, true);
  assert.equal(run(engine, 0.2), 0);
  assert.deepEqual(engine.snapshot().point, paused.point);
  assert.equal(engine.snapshot().phase, paused.phase);
  engine.setParams({ playing: true });
  assert.deepEqual(engine.snapshot().point, paused.point);
  run(engine, 0.1);
  assert.ok(difference(engine.snapshot().point, paused.point) > 0.01);
});
