import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { GraphDelayRustEngine } from '../src/instruments/graph-delay-rust/graph-delay-engine.js';
import { compileGraphDelayPlan } from '../src/instruments/graph-delay-rust/graph-delay-plan.js';
import { generateGraph } from '../src/instruments/graph-delay/graph-delay.js';
import { getSharedAudioOutputManager } from '../src/audio-output-manager.js';

const graph = nodes => generateGraph({ type: 'chain', nodeCount: nodes, maxNodes: 64 });
const tick = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

function browser(t, { constructionFailure = false, intervalFailure = false } = {}) {
  const timers = new Map(), nodes = [], errors = [], metrics = [];
  let nextTimer = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++nextTimer; timers.set(id, { callback, delay }); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    if (intervalFailure) throw new Error('Timer setup failed');
    const id = ++nextTimer; timers.set(id, { callback, delay, interval: true }); return id;
  });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  globalThis.AudioWorkletNode = class {
    connections = new Set(); failSend = false;
    port = { messages: [], closed: false,
      postMessage: message => {
        if (this.failSend) throw new Error('Message port failed');
        this.port.messages.push(message);
      },
      close: () => { this.port.closed = true; },
    };
    constructor() { if (constructionFailure) throw new Error('Worklet construction failed'); nodes.push(this); }
    connect(target) { this.connections.add(target); return target; }
    disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); }
    emit(data) { this.port.onmessage?.({ data }); }
  };
  t.after(() => previous ? Object.defineProperty(globalThis, 'AudioWorkletNode', previous) : delete globalThis.AudioWorkletNode);
  const context = { destination: {}, state: 'running' };
  const create = () => {
    const engine = new GraphDelayRustEngine(context, null, { onError: error => errors.push(error), onMetrics: value => metrics.push(value) });
    t.after(() => engine.dispose()); return engine;
  };
  const fire = delay => {
    const [id, timer] = [...timers].find(([, entry]) => entry.delay === delay) ?? [];
    assert.ok(timer, `a ${delay} ms timer exists`);
    if (!timer.interval) timers.delete(id);
    timer.callback();
  };
  return { create, nodes, timers, errors, metrics, fire };
}

for (const failure of ['constructionFailure', 'intervalFailure']) test(`${failure} cleans up partial engine setup`, async t => {
  const f = browser(t, { [failure]: true });
  assert.throws(f.create, /construction failed|Timer setup failed/);
  assert.equal(f.timers.size, 0);
  if (failure === 'intervalFailure') {
    assert.equal(f.nodes[0].connections.size, 0);
    assert.equal(f.nodes[0].port.closed, true);
    assert.equal(f.nodes[0].port.onmessage, null);
  }
  assert.equal(getSharedAudioOutputManager().connectionCount(), 0);
  await tick();
});

test('dispose before readiness rejects waiting edits and ignores queued ready/error/metric callbacks', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  const oldMessage = node.port.onmessage, oldError = node.onprocessorerror;
  const ready = assert.rejects(engine.ready, /session is closed/);
  const update = assert.rejects(engine.update(graph(3)), /session is closed/);
  await engine.dispose(); await Promise.all([ready, update]);
  oldMessage({ data: { type: 'ready' } }); oldError();
  oldMessage({ data: { type: 'metrics', metrics: { outputPeak: 1 } } });
  oldMessage({ data: { type: 'failure', error: 'Late error' } });
  await engine.dispose();
  assert.equal(engine.closed, true); assert.equal(engine.requests.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(node.connections.size, 0);
  assert.equal(node.port.closed, true); assert.equal(f.errors.length, 0); assert.equal(f.metrics.length, 0);
  assert.equal(node.port.messages.filter(message => message.type === 'dispose').length, 1);
});

for (const cause of ['processorerror', 'failure', 'port']) test(`${cause} retires the engine and rejects all pending commands immediately`, async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  node.emit({ type: 'ready' }); await engine.ready;
  const rejected = [1, 2].map(() => assert.rejects(engine.request('configure', {}), /stopped|fatal|port failed/));
  const oldMessage = node.port.onmessage, oldError = node.onprocessorerror;
  if (cause === 'processorerror') oldError();
  else if (cause === 'failure') node.emit({ type: 'failure', error: 'fatal DSP error' });
  else { node.failSend = true; engine.clear(); }
  await Promise.all(rejected);
  assert.equal(engine.closed, true); assert.equal(engine.requests.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(node.port.closed, true); assert.equal(node.connections.size, 0);
  assert.equal(getSharedAudioOutputManager().connectionCount(), 0);
  const messages = node.port.messages.length;
  await assert.rejects(engine.update(graph(4)), /stopped|fatal|port failed/);
  engine.setOutputEnabled(true); engine.clear();
  oldMessage({ data: { id: 1 } }); oldMessage({ data: { type: 'ready' } }); oldError();
  assert.equal(node.port.messages.length, messages); assert.equal(f.errors.length, 1);
});

test('startup and command timeouts retire the session before a late command can complete', async t => {
  const f = browser(t), first = f.create();
  const rejectedReady = assert.rejects(first.ready, /did not start/);
  f.fire(15000); await rejectedReady;
  assert.equal(first.closed, true); assert.equal(f.timers.size, 0);
  const second = f.create(), node = f.nodes.at(-1);
  node.emit({ type: 'ready' }); await second.ready;
  const oldMessage = node.port.onmessage;
  const rejectedCommand = assert.rejects(second.request('configure', {}), /did not respond/);
  f.fire(30000); await rejectedCommand;
  oldMessage({ data: { id: second.sequence } });
  assert.equal(second.closed, true); assert.equal(second.requests.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 2);
});

test('updates coalesce before readiness and resolve worklet supersession without consuming newer acknowledgements', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  const before = engine.update(graph(3)), latest = engine.update(graph(4));
  node.emit({ type: 'ready' }); await tick();
  assert.deepEqual(await before, { superseded: true });
  let messages = node.port.messages.filter(message => message.type === 'configure');
  assert.equal(messages.length, 1);
  assert.equal(new Float64Array(messages[0].plan)[1], 4);
  node.emit({ id: messages[0].id }); await latest;
  const a = engine.update(graph(5)); await tick();
  const b = engine.update(graph(6)); await tick();
  messages = node.port.messages.filter(message => message.type === 'configure');
  const previousId = messages.at(-2).id, latestId = messages.at(-1).id;
  node.emit({ id: previousId, superseded: true });
  assert.equal((await a).superseded, true);
  node.emit({ id: previousId });
  assert.equal(engine.requests.size, 1); assert.ok(engine.requests.has(latestId));
  const rejected = assert.rejects(b, /invalid plan/);
  node.emit({ id: latestId, error: 'invalid plan' }); await rejected;
  assert.equal(engine.closed, false, 'a rejected plan preserves the current sound');
  assert.equal(f.errors.length, 0);
});

const workletSource = await readFile(new URL('../src/instruments/graph-delay-rust/graph-delay-worklet.js', import.meta.url), 'utf8');
const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/graph-delay.wasm', import.meta.url)));
function worklet({ failAllocation = 0 } = {}) {
  const actual = new WebAssembly.Instance(module).exports;
  const calls = { allocated: [], freed: [], dropped: [], processFailure: false, configureFailure: false }, messages = [];
  let allocations = 0, Processor;
  const api = { ...actual,
    gdr_alloc(bytes) {
      if (++allocations === failAllocation) return 0;
      const pointer = actual.gdr_alloc(bytes); calls.allocated.push(pointer); return pointer;
    },
    gdr_free(pointer, bytes) { calls.freed.push(pointer); actual.gdr_free(pointer, bytes); },
    gdr_drop(engine) { calls.dropped.push(engine); actual.gdr_drop(engine); },
    gdr_plan(...args) {
      if (calls.configureFailure) throw new WebAssembly.RuntimeError('injected control trap');
      return actual.gdr_plan(...args);
    },
    gdr_process(...args) {
      if (calls.processFailure) throw new WebAssembly.RuntimeError('injected trap');
      return actual.gdr_process(...args);
    },
  };
  vm.runInNewContext(workletSource, {
    WebAssembly: { Instance: class { constructor() { this.exports = api; } }, RuntimeError: WebAssembly.RuntimeError },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor(_name, value) { Processor = value; },
    sampleRate: 48000, currentTime: 0, performance,
  });
  return { calls, messages, create: () => new Processor({ processorOptions: { module } }) };
}

test('worklet frees the engine and every successful buffer when construction runs out of memory', () => {
  const f = worklet({ failAllocation: 3 });
  assert.throws(f.create, /buffers could not be allocated/);
  assert.equal(f.calls.dropped.length, 1);
  assert.deepEqual(f.calls.freed, f.calls.allocated);
  assert.equal(f.calls.allocated.length, 2); assert.equal(f.messages.length, 0);
});

test('real WASM worklet supersedes pending plans, rejects invalid plans, and disposes exactly once', () => {
  const f = worklet(), processor = f.create(), deliver = processor.port.onmessage;
  const configure = (id, nodes) => deliver({ data: { id, type: 'configure', plan: compileGraphDelayPlan(graph(nodes)).data.buffer } });
  configure(1, 3); configure(2, 4);
  assert.equal(f.messages.find(message => message.id === 1)?.superseded, true);
  const output = [[new Float32Array(128), new Float32Array(128)]];
  for (let index = 0; index < 200 && !f.messages.some(message => message.id === 2); index++) assert.equal(processor.process([], output), true);
  assert.ok(f.messages.some(message => message.id === 2 && !message.error));
  deliver({ data: { type: 'configure', id: 3, plan: new Float64Array().buffer } });
  assert.match(f.messages.find(message => message.id === 3).error, /limits/);
  assert.equal(processor.closed, false);
  deliver({ data: { type: 'dispose', id: 4 } });
  const frees = f.calls.freed.length;
  deliver({ data: { type: 'dispose', id: 5 } });
  assert.equal(processor.process([], output), false); assert.equal(processor.port.onmessage, null);
  assert.equal(f.calls.freed.length, frees); assert.equal(f.calls.dropped.length, 1);
  assert.deepEqual([...f.calls.freed].sort(), [...f.calls.allocated].sort());
});

test('fatal process traps zero the current block, release WASM ownership and cannot revive from queued commands', () => {
  const f = worklet(), processor = f.create(), deliver = processor.port.onmessage;
  f.calls.processFailure = true;
  const output = [[new Float32Array(128).fill(1), new Float32Array(128).fill(1)]];
  assert.equal(processor.process([], output), false);
  assert.ok(output[0].every(channel => channel.every(value => value === 0)));
  assert.equal(f.calls.dropped.length, 1); assert.deepEqual(f.calls.freed, f.calls.allocated);
  assert.equal(f.messages.filter(message => message.type === 'failure').length, 1);
  deliver({ data: { type: 'enabled', enabled: true } });
  deliver({ data: { type: 'dispose' } });
  assert.equal(processor.process([], output), false); assert.equal(f.calls.dropped.length, 1);
});

test('fatal control traps release both the temporary plan and the pending Rust scene', () => {
  const f = worklet(), processor = f.create(), deliver = processor.port.onmessage;
  const plan = compileGraphDelayPlan(graph(4)).data.buffer;
  deliver({ data: { type: 'configure', id: 1, plan } });
  f.calls.configureFailure = true;
  deliver({ data: { type: 'configure', id: 2, plan } });
  assert.match(f.messages.find(message => message.id === 2).error, /control trap/);
  assert.equal(f.messages.filter(message => message.type === 'failure').length, 1);
  assert.equal(processor.closed, true); assert.equal(processor.pendingId, null);
  assert.equal(f.calls.dropped.length, 1);
  assert.deepEqual([...f.calls.freed].sort(), [...f.calls.allocated].sort());
});
