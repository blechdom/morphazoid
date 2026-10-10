import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createGraphCapacityController } from '../src/instruments/graph-delay-rust/graph-delay-capacity-policy.js';
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
  f.fire(160000); await rejectedCommand;
  oldMessage({ data: { id: second.sequence } });
  assert.equal(second.closed, true); assert.equal(second.requests.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 2);
});

test('a queued scene watchdog allows the longest healthy graph warmup to finish', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  node.emit({ type: 'ready' }); await engine.ready;
  const longPath = compileGraphDelayPlan(graph(64), { baseDelay: 600, timeScale: 800, pitchScale: 2 });
  const pending = engine.update(graph(3));
  await tick();
  const commandTimers = [...f.timers.values()].filter(timer => !timer.interval);
  assert.equal(commandTimers.length, 1);
  assert.ok(commandTimers[0].delay > longPath.data[11] * 1000 + 5000,
    'reserve the wet arrival, 300 ms fade and incremental allocation time');
  node.emit({ id: engine.sequence });
  await pending;
  assert.equal(engine.closed, false); assert.equal(f.errors.length, 0);
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

test('live controls retain audible and pending scene topology, geometry and unrelated gates', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  node.emit({ type: 'ready' }); await engine.ready;
  const a = graph(3), b = graph(5), c = graph(7);
  const gatesA = [true, false];
  for (const [g, gates] of [[a, gatesA], [b, null]]) {
    const edit = engine.update(g, { pitchScale: 0 }, gates); await tick();
    node.emit({ id: engine.sequence }); await edit;
  }
  const pending = engine.update(c, { pitchScale: 0 }); await tick();
  const pendingId = engine.sequence;
  const moved = structuredClone(b); moved.nodes[1].x += .06;
  const settings = { pitchScale: 1.4, wet: .6, dry: .1, inputTrim: .4, inputX: .24 };
  const update = engine.updateParameters(moved, settings, [false, true, true, true]); await tick();
  const controls = node.port.messages.at(-1);
  assert.equal(controls.type, 'controls'); assert.equal(controls.plans.length, 3);
  const actual = controls.plans.map(buffer => [...new Float64Array(buffer)]);
  assert.deepEqual(actual, [
    [...compileGraphDelayPlan(a, settings, gatesA).data],
    [...compileGraphDelayPlan(moved, settings, [false, true, true, true]).data],
    [...compileGraphDelayPlan(c, settings).data],
  ]);
  assert.ok(engine.requests.has(pendingId), 'live edit leaves pending configure ownership intact');
  node.emit({ id: controls.id }); await update;
  assert.ok(engine.requests.has(pendingId));
  node.emit({ id: pendingId }); await pending;
  assert.equal(engine.currentScene.graph.nodes.length, 7);
  assert.deepEqual(engine.retiringScene.graph, moved);
  assert.equal(engine.pendingScene, null);
});

test('superseded and rejected configure replies cannot replace scene ownership used by live controls', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  node.emit({ type: 'ready' }); await engine.ready;
  const initial = engine.update(graph(3)); await tick(); node.emit({ id: engine.sequence }); await initial;
  const a = engine.update(graph(4)); await tick(); const previous = engine.sequence;
  const b = engine.update(graph(5)); await tick(); const latest = engine.sequence;
  node.emit({ id: previous, superseded: true }); await a;
  node.emit({ id: previous });
  assert.equal(engine.currentScene.graph.nodes.length, 3);
  assert.equal(engine.pendingScene.graph.nodes.length, 5);
  const rejected = assert.rejects(b, /invalid/);
  node.emit({ id: latest, error: 'invalid scene' }); await rejected;
  const controls = engine.updateParameters(graph(3), { pitchScale: 1 }); await tick();
  const message = node.port.messages.at(-1);
  assert.equal(message.plans.length, 1);
  assert.equal(new Float64Array(message.plans[0])[1], 3);
  node.emit({ id: message.id }); await controls;
  await engine.dispose();
  assert.equal(engine.currentScene, null); assert.equal(engine.retiringScene, null); assert.equal(engine.pendingScene, null);
});

test('controls coalesce independently without superseding a configure waiting for readiness', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  const topology = graph(3);
  const configure = engine.update(topology);
  const earlier = engine.updateParameters(topology, { wet: .1 });
  const latest = engine.updateParameters(topology, { wet: .7 });
  node.emit({ type: 'ready' }); await tick();
  assert.deepEqual(await earlier, { superseded: true });
  const messages = node.port.messages;
  assert.deepEqual(messages.map(message => message.type), ['configure', 'controls']);
  assert.equal(new Float64Array(messages[1].plans[0])[6], .7);
  node.emit({ id: messages[1].id }); await latest;
  node.emit({ id: messages[0].id }); await configure;
  assert.equal(engine.currentScene.graph.nodes.length, 3);
});

const workletSource = await readFile(new URL('../src/instruments/graph-delay-rust/graph-delay-worklet.js', import.meta.url), 'utf8');
const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/graph-delay.wasm', import.meta.url)));
function worklet({ failAllocation = 0, clock = performance } = {}) {
  const actual = new WebAssembly.Instance(module).exports;
  const calls = { allocated: [], freed: [], dropped: [], processFailure: false, configureFailure: false, controls: [] }, messages = [];
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
    gdr_controls(...args) { calls.controls.push(args); return actual.gdr_controls?.(...args) ?? 0; },
    gdr_process(...args) {
      if (calls.processFailure) throw new WebAssembly.RuntimeError('injected trap');
      return actual.gdr_process(...args);
    },
  };
  vm.runInNewContext(workletSource.replace(/^import .+;\n/m, ''), {
    createGraphCapacityController,
    WebAssembly: { Instance: class { constructor() { this.exports = api; } }, RuntimeError: WebAssembly.RuntimeError },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor(_name, value) { Processor = value; },
    sampleRate: 48000, currentTime: 0, performance: clock,
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

test('performance updates coalesce before readiness and retain explicit manual maximum', async t => {
  const f = browser(t), engine = f.create(), node = f.nodes[0];
  const old = engine.setPerformance({ voiceCeiling: 24, automatic: true });
  const latest = engine.setPerformance({ voiceCeiling: 512, automatic: false });
  node.emit({ type: 'ready' }); await tick();
  assert.deepEqual(await old, { superseded: true });
  const message = node.port.messages.find(item => item.type === 'performance');
  assert.deepEqual(message.performance, { voiceCeiling: 512, automatic: false });
  node.emit({ id: message.id }); await latest;
  assert.equal(engine.requests.size, 0);
});

function workers(t, { failConstruction = false } = {}) {
  const all = [], previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = class {
    terminated = false;
    constructor(url, options) {
      if (failConstruction) throw new Error('Worker disabled');
      assert.ok(url.pathname.endsWith('graph-delay-capacity-worker.js')); assert.equal(options.type, 'module'); all.push(this);
    }
    postMessage(data) { this.request = data; }
    terminate() { this.terminated = true; }
  };
  t.after(() => previous ? Object.defineProperty(globalThis, 'Worker', previous) : delete globalThis.Worker);
  return all;
}

test('capacity supersession and abort terminate isolated workers and ignore late results', async t => {
  const f = browser(t), engine = f.create(), all = workers(t);
  const first = engine.measureCapacity(graph(3));
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const staleReply = all[0].onmessage;
  const signal = new AbortController();
  const second = engine.measureCapacity(graph(4), {}, null, { signal: signal.signal });
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  await firstRejected;
  assert.equal(all[0].terminated, true);
  assert.equal(new Float64Array(all[1].request.plan)[1], 4);
  staleReply({ data: { result: { proved: true, voices: 999 } } });
  assert.equal(all[1].terminated, false);
  signal.abort(); await secondRejected;
  assert.equal(all[1].terminated, true); assert.equal(engine.capacityTask, null);
  assert.equal(f.nodes[0].port.messages.length, 0, 'measurement never configures or arms the playing audio');
});

test('capacity success and worker errors clean up without retiring the playing graph', async t => {
  const f = browser(t), engine = f.create(), all = workers(t);
  const pending = engine.measureCapacity(graph(3));
  const result = { proved: true, voices: 2, targetLoad: .45 };
  all[0].onmessage({ data: { result } });
  assert.deepEqual(await pending, result); assert.equal(all[0].terminated, true);
  for (const cause of ['error', 'message', 'timeout']) {
    const failed = assert.rejects(engine.measureCapacity(graph(3)), /probe failed|unreadable|did not finish/);
    const worker = all.at(-1);
    if (cause === 'error') worker.onerror({ message: 'probe failed' });
    else if (cause === 'message') worker.onmessageerror();
    else f.fire(60000);
    await failed; assert.equal(worker.terminated, true); assert.equal(engine.closed, false);
  }
  assert.equal(engine.capacityTask, null);
});

test('disposing cancels capacity work and constructor failure leaves no dangling test', async t => {
  const f = browser(t), engine = f.create(), all = workers(t);
  const failed = assert.rejects(engine.measureCapacity(graph(3)), { name: 'AbortError' });
  await engine.dispose(); await failed;
  assert.equal(all[0].terminated, true); assert.equal(f.timers.size, 0);
  const next = f.create();
  workers(t, { failConstruction: true });
  await assert.rejects(next.measureCapacity(graph(3)), /Worker disabled/);
  assert.equal(next.capacityTask, null);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(next.measureCapacity(graph(3), {}, null, { signal: controller.signal }), { name: 'AbortError' });
});

test('real WASM worklet reports cap targets and releasing processing voices honestly', () => {
  const f = worklet(), processor = f.create(), deliver = processor.port.onmessage;
  const output = [[new Float32Array(128), new Float32Array(128)]];
  deliver({ data: { type: 'performance', id: 1, performance: { voiceCeiling: 0, automatic: false } } });
  deliver({ data: { type: 'configure', id: 2, plan: compileGraphDelayPlan(graph(6)).data.buffer } });
  for (let i = 0; i < 200 && !f.messages.some(message => message.id === 2); i++) processor.process([], output);
  deliver({ data: { type: 'performance', id: 3, performance: { voiceCeiling: 2, automatic: false } } });
  deliver({ data: { type: 'status' } });
  let metrics = f.messages.at(-1).metrics;
  assert.equal(metrics.activeRoutes, 5); assert.equal(metrics.targetRoutes, 2);
  assert.equal(metrics.liveLimit, 2); assert.equal(metrics.voiceCeiling, 2); assert.equal(metrics.automatic, false);
  assert.equal(metrics.currentEligibleRoutes, 5); assert.equal(metrics.retiringActiveRoutes, 0);
  for (let i = 0; i < 100; i++) processor.process([], output);
  deliver({ data: { type: 'status' } }); metrics = f.messages.at(-1).metrics;
  assert.equal(metrics.activeRoutes, 2); assert.equal(metrics.processingRoutes, 2);
  deliver({ data: { type: 'dispose' } });
});

test('only a committed structural scene resets protection, not coefficient or controls messages', () => {
  const f = worklet({ clock: { now: () => 0 } }), processor = f.create(), deliver = processor.port.onmessage;
  const output = [[new Float32Array(128), new Float32Array(128)]];
  const configure = (id, nodes, settings = {}) => deliver({ data: { type: 'configure', id, plan: compileGraphDelayPlan(graph(nodes), settings).data.buffer } });
  const finish = id => { for (let i = 0; i < 1000 && !f.messages.some(message => message.id === id); i++) processor.process([], output); assert.ok(f.messages.some(message => message.id === id)); };
  configure(1, 5); finish(1);
  const reduced = processor.capacity.observe({ load: 1.3, seconds: .01, eligible: 4, processing: 4, target: 4 });
  processor.api.gdr_limit(processor.engine, reduced); assert.equal(reduced, 2);
  configure(2, 5, { pitchScale: 1 }); finish(2);
  assert.equal(processor.capacity.limit, reduced);
  configure(3, 6);
  const pending = processor.pendingId;
  deliver({ data: { type: 'controls', id: 4, plans: [compileGraphDelayPlan(graph(5), { wet: .3 }).data.buffer] } });
  assert.equal(processor.pendingId, pending); assert.equal(processor.capacity.limit, reduced);
  assert.ok(f.messages.some(message => message.id === 4)); assert.equal(f.calls.controls.length, 1);
  finish(3); assert.equal(processor.capacity.limit, 512);
  deliver({ data: { type: 'dispose' } });
});

test('worklet distinguishes callback maintenance from recurring DSP load', () => {
  const f = worklet({ clock: { now: () => 0 } }), processor = f.create();
  const observations = [];
  processor.capacity.observe = values => { observations.push(values); return processor.capacity.limit; };
  processor.controlMs = 8;
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(observations.length, 1); assert.equal(observations[0].load, 3); assert.equal(observations[0].maintenanceLoad, 3);
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(observations[1].maintenanceLoad, 0, 'previous maintenance is charged once');
  processor.port.onmessage({ data: { type: 'dispose' } });
});
