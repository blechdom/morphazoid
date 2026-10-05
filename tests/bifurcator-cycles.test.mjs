import assert from 'node:assert/strict';
import test from 'node:test';
import { BifurcatorEngine, createPreset } from '../src/instruments/bifurcator/model.js';
import { CycleMonitor } from '../src/instruments/bifurcator/cycle-monitor.js';

const RATE = 48000;
const logistic = (r, frequency = 220, overrides = {}, sampleRate = RATE) => {
  const engine = new BifurcatorEngine(sampleRate);
  engine.setParams(createPreset('logistic', {
    regime: (r - 2.6) / 1.4, frequency, speed: 1, clarity: 1, depth: 1,
    cutoff: 6000, playing: true, ...overrides,
  }));
  return engine;
};
const run = (engine, monitor, seconds) => {
  for (let frame = 0; frame < Math.round(seconds * engine.sampleRate); frame++) {
    const sample = engine.sample();
    if (engine.params.playing) monitor.push(sample, engine.phase);
  }
  return monitor.snapshot();
};

test('actual filtered audio exposes 1, 2, 4 and 8 distinct repeating cycles', () => {
  for (const frequency of [110, 220]) {
    for (const [r, period] of [[2.8, 1], [3.2, 2], [3.5, 4], [3.55, 8]]) {
      const monitor = new CycleMonitor();
      const snapshot = run(logistic(r, frequency), monitor, 2.5);
      assert.equal(snapshot.period, period, `${frequency} Hz, r = ${r}`);
      assert.equal(snapshot.status, 'periodic');
      assert.ok(snapshot.error < 0.002, `${snapshot.error}`);
      assert.equal(snapshot.count, 24);
      assert.ok(snapshot.cycles.every((cycle) => cycle.length === 64 && cycle.every(Number.isFinite)));
      if (period > 1) {
        const left = snapshot.cycles.at(-1), right = snapshot.cycles.at(-2);
        const difference = Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / left.length);
        assert.ok(difference > 0.01, `${period} cycles retain their amplitude difference`);
      }
    }
  }
});

test('chaotic audio stays bounded and is reported irregular without a chaos claim', () => {
  const monitor = new CycleMonitor();
  const snapshot = run(logistic(3.9), monitor, 2);
  assert.equal(snapshot.status, 'irregular');
  assert.equal(snapshot.period, null);
  assert.equal(snapshot.count, 24);
  assert.ok(snapshot.generation > snapshot.count);
  assert.ok(snapshot.cycles.every((cycle) => cycle.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.800001)));
  snapshot.cycles[0].fill(42);
  assert.ok(monitor.snapshot().cycles[0].every((value) => Math.abs(value) <= 0.800001), 'snapshots do not own the internal ring');
});

test('periodic windows are measured as three or six cycles rather than mislabeled irregular', () => {
  for (const frequency of [110, 220]) {
    for (const [r, period] of [[3.835, 3], [3.847, 6]]) {
      const snapshot = run(logistic(r, frequency), new CycleMonitor(), 3);
      assert.equal(snapshot.period, period, `${frequency} Hz, r = ${r}`);
      assert.equal(snapshot.status, 'periodic');
      assert.ok(snapshot.error < 0.002);
    }
  }
});

test('raw and mixed audio retain the smallest observed repeat at noninteger pitches and rounded regime controls', () => {
  for (const frequency of [110, 220, 173.5]) {
    for (const clarity of [0, 0.6]) {
      for (const [r, period] of [[2.8, 1], [3.2006, 2], [3.5002, 4], [3.8348, 3], [3.8474, 6]]) {
        const engine = logistic(r, frequency, { clarity });
        engine.reset();
        const state = engine.exportState();
        state.phase = 0.371;
        assert.equal(engine.importState(state), true);
        const snapshot = run(engine, new CycleMonitor(), 2.5);
        assert.equal(snapshot.period, period, `${frequency} Hz, Clarity ${clarity}, r = ${r}`);
        assert.equal(snapshot.status, 'periodic');
        assert.ok(snapshot.error < 0.012);
        assert.ok(snapshot.cycles.every((cycle) => cycle.length === 64), 'the graphic still receives the complete actual onset');
      }
    }
  }
});

test('discontinuity tolerance does not turn irregular raw or mixed audio into a periodic label', () => {
  for (const frequency of [110, 220, 173.5]) {
    for (const clarity of [0, 0.6, 1]) {
      for (const cutoff of [80, 6000]) {
        const snapshot = run(logistic(3.9, frequency, { clarity, cutoff }), new CycleMonitor(), 2.5);
        assert.equal(snapshot.period, null, `${frequency} Hz, Clarity ${clarity}, cutoff ${cutoff}`);
        assert.equal(snapshot.status, 'irregular');
      }
    }
  }
});

test('captures the filtered output rather than drawing an ideal carrier', () => {
  const dark = run(logistic(2.8, 220, { cutoff: 80 }), new CycleMonitor(), 2);
  const bright = run(logistic(2.8, 220, { cutoff: 18000 }), new CycleMonitor(), 2);
  const left = dark.cycles.at(-1), right = bright.cycles.at(-1);
  const difference = Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / left.length);
  assert.ok(difference > 0.1, `${difference}`);
  assert.equal(dark.period, 1);
  assert.equal(bright.period, 1);
});

test('pitch changes capture the ongoing signal and settle into the correct pattern', () => {
  const engine = logistic(3.5, 110), monitor = new CycleMonitor();
  assert.equal(run(engine, monitor, 2).period, 4);
  const phase = engine.phase;
  engine.setParams({ frequency: 220, cutoff: 1300 });
  assert.equal(engine.phase, phase, 'a pitch change does not reset reference phase');
  const snapshot = run(engine, monitor, 2);
  assert.equal(snapshot.period, 4);
  assert.equal(snapshot.count, 24);
  assert.ok(snapshot.cycles.every((cycle) => cycle.every(Number.isFinite)));
});

test('pause preserves complete captures and discards only unfinished cycles', () => {
  const engine = logistic(3.2), monitor = new CycleMonitor();
  run(engine, monitor, 1.5);
  engine.setParams({ playing: false });
  monitor.discardPartial();
  const paused = monitor.snapshot();
  assert.deepEqual(run(engine, monitor, 0.6), paused);
  engine.setParams({ playing: true });
  monitor.discardPartial();
  assert.equal(run(engine, monitor, 1).period, 2);
});

test('reset clears old history and seeks wait for a complete new cycle', () => {
  const engine = logistic(3.9), monitor = new CycleMonitor();
  run(engine, monitor, 1);
  monitor.reset();
  assert.deepEqual(monitor.snapshot(), { points: 64, cycles: [], period: null, status: 'collecting', error: null, count: 0, generation: 0 });
  const imported = engine.exportState();
  imported.phase = 0.35;
  engine.importState(imported);
  run(engine, monitor, 0.003);
  assert.equal(monitor.snapshot().count, 0, 'a partial initial cycle is excluded');
  const snapshot = run(engine, monitor, 0.01);
  assert.ok(snapshot.count > 0 && snapshot.count < 4);
});

test('limited sample resolution cannot produce a confident period label', () => {
  const engine = logistic(3.2, 1400, { speed: 3 }, 8000);
  const snapshot = run(engine, new CycleMonitor(), 1);
  assert.equal(snapshot.status, 'under-sampled');
  assert.equal(snapshot.period, null);
  assert.equal(snapshot.count, 24);
  assert.ok(snapshot.cycles.every((cycle) => cycle.every(Number.isFinite)));
});

test('quiet output, malformed input and constant phases do not invent cycles', () => {
  const monitor = new CycleMonitor();
  for (let frame = 0; frame < 2000; frame++) monitor.push(0, (frame % 200) / 200);
  assert.equal(monitor.snapshot().status, 'quiet');
  const count = monitor.snapshot().count;
  for (let frame = 0; frame < 100; frame++) monitor.push(0.1, 0.5);
  assert.equal(monitor.snapshot().count, count);
  for (const [sample, phase] of [[NaN, 0.1], [0, NaN], [0, -1], [0, 1], [Infinity, 0]]) monitor.push(sample, phase);
  assert.equal(monitor.snapshot().count, count);
  assert.ok(monitor.snapshot().cycles.every((cycle) => cycle.every(Number.isFinite)));
});

test('worklet telemetry preserves revisions and clears cycle history on structural actions', async () => {
  const previousRate = globalThis.sampleRate;
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  globalThis.sampleRate = RATE;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { postMessage: (message) => this.messages.push(message) }; this.messages = []; }
  };
  globalThis.registerProcessor = (_name, processor) => { Processor = processor; };
  try {
    await import('../src/instruments/bifurcator/processor.js');
    const worklet = new Processor();
    const send = (data) => worklet.port.onmessage({ data });
    const output = [[new Float32Array(128), new Float32Array(128)]];
    const process = (blocks) => { for (let block = 0; block < blocks; block++) assert.equal(worklet.process([], output), true); };
    send({ type: 'params', params: createPreset('logistic', { regime: (3.2 - 2.6) / 1.4, frequency: 220, clarity: 1, depth: 1 }), revision: 11 });
    process(750);
    assert.equal(worklet.messages.at(-1).revision, 11);
    assert.equal(worklet.messages.at(-1).cycles.period, 2);
    const clock = worklet.messages.at(-1);
    const fallback = new BifurcatorEngine(globalThis.sampleRate);
    assert.equal(fallback.importState(clock.state), true);
    assert.deepEqual(fallback.snapshot(), clock.snapshot);
    const held = worklet.cycles.snapshot();
    send({ type: 'params', params: { playing: false }, revision: 12 });
    process(100);
    assert.deepEqual(worklet.cycles.snapshot(), held);
    assert.equal(worklet.messages.at(-1).revision, 12);
    send({ type: 'reset', revision: 13 });
    assert.equal(worklet.cycles.snapshot().count, 0);
    send({ type: 'params', params: { playing: true }, revision: 14 });
    process(80);
    assert.ok(worklet.cycles.snapshot().count > 0);
    send({ type: 'seek', state: worklet.engine.exportState(), revision: 15 });
    assert.equal(worklet.cycles.snapshot().count, 0);
    process(80);
    send({ type: 'params', params: { model: 'lorenz' }, revision: 16 });
    assert.equal(worklet.cycles.snapshot().count, 0);
    send({ type: 'dispose' });
    assert.equal(worklet.process([], output), false);
  } finally {
    if (previousRate === undefined) delete globalThis.sampleRate; else globalThis.sampleRate = previousRate;
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor; else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor; else globalThis.registerProcessor = previousRegister;
  }
});
