import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
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
  const scope = vm.createContext({ WebAssembly, Float32Array, Uint32Array, Uint8Array, Number, Math, Object,
    sampleRate: 48000, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor: (_name, ctor) => { Processor = ctor; },
  });
  vm.runInContext(source, scope);
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
  processor.kernel = { ...processor.scalar, exports: { process() { throw Error('render failed'); } } };
  processor.scalar = processor.kernel;
  processor.message({ type: 'transport', playing: true, offset: 10 });
  assert.equal(peak(tick().left), 0);
  assert.equal(processor.ready, false);
  assert.match(messages.at(-1).message, /render failed/);
});
