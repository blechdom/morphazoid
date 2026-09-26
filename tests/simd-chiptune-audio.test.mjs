import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY, TEMPO_CLOCK_FIELDS } from '../src/instruments/simd-chiptune/tempo-clock.js';
import { SimdChiptuneAudio, simdChiptuneSupport } from '../src/instruments/simd-chiptune/audio.js';
import { WEBGPU_CHIPTUNE_DEFAULTS, createWebGpuChiptunePattern } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';

function fakeRuntime({ ready = true, fetchPending = false } = {}) {
  const contexts = [], nodes = [], timers = new Set(), events = [];
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 10; this.sampleRate = 48000; contexts.push(this); }
    get audioWorklet() { return { addModule: async () => { events.push('module'); } }; }
    resume() { events.push('resume'); this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class Node {
    constructor() {
      this.messages = []; this.port = { onmessage: null, postMessage: data => {
        this.messages.push(data);
        if (data.type === 'install' && ready) queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready', backend: data.simdBytes ? 'simd' : 'scalar' } }));
      }, close: () => { this.closed = true; } }; nodes.push(this);
    }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
    addEventListener() {}
  }
  const runtime = { AudioContext: Context, AudioWorkletNode: Node, WebAssembly,
    location: { href: 'http://localhost/simd-chiptune.html' },
    fetch: async () => { events.push('fetch'); if (fetchPending) await new Promise(() => {}); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
  };
  class Engine extends SimdChiptuneAudio {
    createAudioGraph() { this.input = {}; this.master = { gain: { setTargetAtTime() {} } }; }
  }
  return { runtime, engine: new Engine(runtime), contexts, nodes, timers, events };
}

test('SIMD support and explicit arming need no GPU and resume before loading', async () => {
  const { runtime, engine, events, contexts, nodes, timers } = fakeRuntime();
  Object.defineProperty(runtime, 'navigator', { get() { throw Error('GPU must not be consulted'); } });
  assert.equal(simdChiptuneSupport(runtime).supported, true);
  await engine.start(WEBGPU_CHIPTUNE_DEFAULTS, { autoStart: false });
  assert.equal(events[0], 'resume');
  assert.equal(engine.running, false);
  assert.equal(engine.playbackEnabled, false);
  assert.equal(engine.backend, 'simd');
  assert.equal(timers.size, 0);
  const start = await engine.restart({ offset: 5 });
  contexts[0].currentTime = start + 1.25;
  assert.equal(engine.currentPlaybackTime(), 6.25);
  assert.equal(engine.pause(), 6.25);
  assert.equal(engine.currentPlaybackTime(), null);
  await engine.stop();
  assert.equal(contexts[0].state, 'closed');
  assert.equal(nodes[0].closed, true);
  assert.equal(nodes[0].connected, false);
});

test('cancelled loading and installation settle immediately without stale timeouts', async () => {
  for (const options of [{ fetchPending: true }, { ready: false }]) {
    const { engine, timers } = fakeRuntime(options);
    const pending = engine.start(WEBGPU_CHIPTUNE_DEFAULTS, { autoStart: false });
    const rejected = assert.rejects(pending, /cancelled/);
    await new Promise(resolve => setImmediate(resolve));
    await engine.stop();
    await rejected;
    assert.equal(timers.size, 0);
    assert.equal(engine.context, null);
  }
});

test('failed preflight and synchronous resume errors clean up without unhandled cancellation', async () => {
  for (const failure of ['worklet', 'resume']) {
    const { engine, runtime, contexts, timers } = fakeRuntime();
    if (failure === 'worklet') runtime.AudioWorkletNode = null;
    else runtime.AudioContext.prototype.resume = () => { throw new Error('resume rejected'); };
    await assert.rejects(engine.start(), failure === 'worklet' ? /AudioWorklet/ : /resume rejected/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(contexts[0].state, 'closed');
    assert.equal(timers.size, 0);
  }
});

test('scalar selection, external context ownership, and Pattern edit latches survive adapter routing', async () => {
  const { engine, runtime, nodes } = fakeRuntime();
  const context = new runtime.AudioContext();
  const sequence = createWebGpuChiptunePattern();
  await engine.start(WEBGPU_CHIPTUNE_DEFAULTS, { context, autoStart: false, forceScalar: true, sequence });
  assert.equal(engine.backend, 'scalar');
  engine.setPlaybackEnabled(true);
  const start = await engine.restart({ offset: 0.01 });
  context.currentTime = start + 0.01;
  const next = structuredClone(sequence);
  next.lanes.upperOne.cells[0] = { ...next.lanes.upperOne.cells[0], state: 'note', value: 12 };
  engine.updateSequence(next);
  const applyAt = engine.sequenceEditActivationTime('upperOne', 0);
  assert.ok(applyAt > engine.currentPlaybackTime());
  assert.deepEqual(engine.sequenceAtTime(0.02).lanes.upperOne.cells[0], sequence.lanes.upperOne.cells[0]);
  assert.equal(engine.sequenceAtTime(applyAt + 0.001).lanes.upperOne.cells[0].value, 12);
  assert.equal(engine.auditionSequenceCell('bass', -12), true);
  const patch = nodes[0].messages.at(-1).configuration;
  assert.equal(patch.time[1], 2);
  assert.equal(patch.time[2], -12);
  assert.ok(patch.time[3] > 0);
  engine.pause();
  assert.equal(engine.sequenceTransitions.size, 0);
  assert.equal(engine.pendingPreview, null);
  await engine.stop();
  assert.equal(context.state, 'running');
});

const source = await readFile(new URL('../src/instruments/simd-chiptune/processor.js', import.meta.url), 'utf8');
const bytes = Object.fromEntries(await Promise.all(['scalar', 'simd'].map(async name => [name, await readFile(new URL(`../assets/wasm/simd-chiptune-${name}.wasm`, import.meta.url))])));
function worklet({ scalar = false } = {}) {
  let Processor;
  const messages = [];
  const scope = vm.createContext({ WebAssembly, Float32Array, Float64Array, Uint32Array, Uint8Array, Number, Math, Object,
    ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY, TEMPO_CLOCK_FIELDS,
    sampleRate: 48000, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor: (_name, ctor) => { Processor = ctor; },
  });
  vm.runInContext(source.replace(/^import .*?;\n/m, ''), scope);
  const processor = new Processor();
  const engine = new SimdChiptuneAudio();
  engine.updateSequence(createWebGpuChiptunePattern(), { deferDrums: false });
  processor.message({ type: 'install', scalarBytes: bytes.scalar, simdBytes: scalar ? new Uint8Array([0]) : bytes.simd, configuration: engine.configuration() });
  const tick = () => {
    const left = new Float32Array(128), right = new Float32Array(128);
    const alive = processor.process([], [[left, right]]);
    scope.currentTime += 128 / 48000;
    return { left, right, alive };
  };
  return { processor, scope, messages, tick, engine };
}
const peak = samples => Math.max(...samples.map(Math.abs));

test('worklet schedules sound without animation, fades transport, and disposes', () => {
  const { processor, scope, tick, messages } = worklet();
  assert.equal(messages[0].backend, 'simd');
  assert.equal(peak(tick().left), 0);
  processor.message({ type: 'transport', playing: true, offset: 10, startAt: 0.02 });
  while (scope.currentTime + 128 / 48000 < .02) assert.equal(peak(tick().left), 0);
  let nonzero = false;
  for (let i = 0; i < 50; i++) {
    const block = tick();
    assert.ok([...block.left, ...block.right].every(x => Number.isFinite(x) && Math.abs(x) <= .98));
    nonzero ||= peak(block.left) > .001;
  }
  assert.equal(nonzero, true);
  processor.message({ type: 'transport', playing: false });
  tick(); tick();
  assert.equal(peak(tick().left), 0);
  processor.message({ type: 'dispose' });
  assert.equal(tick().alive, false);
});

test('late starts retain their AudioContext anchor and SIMD traps fall back at the same time', () => {
  const { processor, scope, tick, messages, engine } = worklet();
  scope.currentTime = 2;
  processor.message({ type: 'transport', playing: true, offset: 10, startAt: 1.5 });
  tick();
  assert.ok(Math.abs(processor.position - (10.5 + 128 / 48000)) < 1e-9);
  const simd = processor.kernel;
  processor.kernel = { ...simd, exports: { process() { throw Error('SIMD trap'); } } };
  tick();
  assert.equal(processor.backend, 'scalar');
  assert.ok(messages.some(message => message.type === 'backend' && message.backend === 'scalar'));
  assert.ok(processor.position > 10.5);
  engine.updateParams({ ...engine.params, upperOneTone: .9 });
  processor.message({ type: 'configure', configuration: engine.configuration() });
  const before = processor.position;
  tick(); tick(); tick();
  assert.ok(processor.position > before);
  assert.equal(processor.blend, 0);
  processor.message({ type: 'configure', configuration: engine.configuration() });
  assert.equal(processor.hasPending, false);
});

test('malformed SIMD installation falls back; invalid patches and scalar failures report errors', () => {
  const { processor, tick, messages } = worklet({ scalar: true });
  assert.equal(processor.backend, 'scalar');
  processor.port.onmessage({ data: { type: 'configure', configuration: {} } });
  assert.match(messages.at(-1).message, /Invalid chiptune/);
  processor.kernel = { ...processor.scalar, exports: { ...processor.scalar.exports, process() { throw Error('render failed'); } } };
  processor.scalar = processor.kernel;
  processor.message({ type: 'transport', playing: true, offset: 10 });
  assert.equal(peak(tick().left), 0);
  assert.equal(processor.ready, false);
  assert.match(messages.at(-1).message, /render failed/);
});

test('tempo moves preserve the musical beat, oscillator clock, and pause/resume position', async () => {
  const { engine, contexts, nodes } = fakeRuntime();
  await engine.start({ ...WEBGPU_CHIPTUNE_DEFAULTS, tempo: 1.3 }, { autoStart: false });
  const start = await engine.restart({ offset: 600 });
  contexts[0].currentTime = start + 0.125;
  const beat = engine.currentPlaybackBeat();
  const audioSeconds = engine.currentAudioSeconds();
  engine.updateParams({ ...engine.params, tempo: 3.7 });
  assert.ok(Math.abs(engine.currentPlaybackTime() * engine.params.tempo - beat) < 1e-10);
  assert.equal(engine.currentAudioSeconds(), audioSeconds);
  assert.equal(engine.tempoClock.tempoAt(audioSeconds), 1.3);
  contexts[0].currentTime += 0.06;
  assert.ok(Math.abs(engine.tempoClock.tempoAt(engine.currentAudioSeconds()) - 2.5) < 1e-9);
  const paused = engine.pause(), pausedAudio = engine.currentAudioSeconds();
  contexts[0].currentTime += 10;
  assert.equal(engine.currentAudioSeconds(), pausedAudio);
  const resumed = await engine.restart({ offset: paused });
  contexts[0].currentTime = resumed;
  assert.equal(engine.currentAudioSeconds(), pausedAudio);
  assert.ok(Math.abs(engine.currentPlaybackTime() - paused) < 1e-10);
  const message = nodes[0].messages.at(-1);
  assert.equal(message.offset, pausedAudio);
  assert.equal(message.clock.length, 2);
  await engine.stop();
});

test('deferred sequence edits and previews retain musical activation through a tempo ramp', async () => {
  const { engine, contexts } = fakeRuntime();
  const sequence = createWebGpuChiptunePattern();
  await engine.start(WEBGPU_CHIPTUNE_DEFAULTS, { autoStart: false, sequence });
  engine.setPlaybackEnabled(true);
  const start = await engine.restart({ offset: 0.01 });
  contexts[0].currentTime = start + 0.01;
  const next = structuredClone(sequence);
  next.lanes.upperOne.cells[0] = { ...next.lanes.upperOne.cells[0], state: 'note', value: 12 };
  engine.updateSequence(next);
  const priorBeat = engine.sequenceEditActivationTime('upperOne', 0) * engine.params.tempo;
  engine.auditionSequenceCell('bass', -12);
  const previewSeconds = engine.configuration().time[3];
  engine.updateParams({ ...engine.params, tempo: 2.5 });
  const afterBeat = engine.sequenceEditActivationTime('upperOne', 0) * engine.params.tempo;
  assert.ok(Math.abs(afterBeat - priorBeat) < 1e-9);
  assert.ok(engine.sequenceEditActivationTime('upperOne', 0) > engine.currentPlaybackTime());
  assert.equal(engine.configuration().time[3], previewSeconds);
  assert.deepEqual(engine.sequenceAtTime(engine.currentPlaybackTime()).lanes.upperOne.cells[0], sequence.lanes.upperOne.cells[0]);
  await engine.stop();
});

test('rapid live tempo sweeps after ten minutes never rewind beats or interrupt either backend', () => {
  for (const scalar of [false, true]) {
    const { processor, tick, messages, engine } = worklet({ scalar });
    processor.message({ type: 'transport', playing: true, offset: 600, startAt: 0 });
    let previousBeat = processor.tempoClock.beatAt(600), energy = 0;
    for (let block = 0; block < 240; block++) {
      if (block % 6 === 0) {
        // Include several queued controls between render quanta: their clock
        // history must survive even when the musical patch is coalesced.
        for (let change = 0; change < 2; change++) {
          const tempo = .4 + 3.4 * (.5 + .5 * Math.sin(block * .23 + change));
          engine.updateParams({ ...engine.params, tempo });
          const configuration = engine.configuration();
          configuration.tempoEvent = { seconds: processor.position || 600, tempo, serial: block * 2 + change };
          processor.message({ type: 'configure', configuration });
        }
      }
      const output = tick();
      const beat = processor.tempoClock.beatAt(processor.position);
      assert.ok(beat >= previousBeat && beat - previousBeat <= 4 * 128 / 48000 + 1e-9);
      assert.ok(Math.abs(processor.kernel.exports.musicalBeat(processor.position) - beat) < .0002);
      previousBeat = beat;
      for (const value of output.left) { assert.ok(Number.isFinite(value) && Math.abs(value) <= .98); energy += value * value; }
      if (block % 40 === 39) { assert.ok(energy > .001, 'tempo automation must not insert silent windows'); energy = 0; }
    }
    assert.equal(processor.ready, true);
    assert.equal(messages.some(message => message.type === 'error'), false);
  }
});

test('worklet sends bounded rendered stem peaks at the existing telemetry rate and clears mute tails', () => {
  for (const scalar of [false, true]) {
    const { processor, tick, messages, engine } = worklet({ scalar });
    processor.message({ type: 'transport', playing: true, offset: 10, startAt: 0 });
    for (let block = 0; block < 104; block++) tick();
    const telemetry = messages.filter(message => message.type === 'telemetry');
    assert.equal(telemetry.length, 8);
    assert.ok(telemetry.some(message => message.stemPeaks.some(peak => peak > .00001)));
    for (const [index, message] of telemetry.entries()) {
      assert.equal(message.stemPeaks.length, 11);
      assert.ok(message.stemPeaks.every(peak => Number.isFinite(peak) && peak >= 0 && peak <= 1));
      if (index) assert.ok(message.audioTime - telemetry[index - 1].audioTime >= 1 / 30);
    }
    engine.updateParams({ ...engine.params, synthMix: 0, drumMix: 0 });
    processor.message({ type: 'configure', configuration: engine.configuration() });
    for (let block = 0; block < 40; block++) tick();
    assert.ok(messages.filter(message => message.type === 'telemetry').at(-1).stemPeaks.every(peak => peak === 0));
  }
});
