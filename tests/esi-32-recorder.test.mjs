import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Esi32SampleRecorder, ESI32_SAMPLE_RECORD_SECONDS } from '../src/instruments/esi-32/esi-32-recorder.js';

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = (name, value) => { assert.equal(name, 'morphazoid-output-recorder'); Processor = value; };
await import('../src/output-recorder-processor.js');
const tick = () => setImmediate();
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, listener) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(listener); }
  removeEventListener(type, listener) { this.events.get(type)?.delete(listener); }
  emit(type) { for (const callback of this.events.get(type) ?? []) callback(); }
}
class Node {
  constructor(context) { this.context = context; this.targets = new Set(); this.disconnections = []; this.gain = { value: 1 }; }
  connect(target) { this.targets.add(target); }
  disconnect(target) { this.disconnections.push(target); if (target) this.targets.delete(target); else this.targets.clear(); }
}
function fixture({ module, sampleRate = 8000, connectError = false } = {}) {
  const nodes = []; const timers = new Map(); const changes = []; const errors = [];
  const context = new Events();
  Object.assign(context, {
    state: 'running', sampleRate, resumes: 0, suspends: 0, closes: 0,
    resume() { this.resumes++; }, suspend() { this.suspends++; }, close() { this.closes++; },
    createGain() { return new Node(context); },
    audioWorklet: { addModule: () => module?.promise ?? Promise.resolve() },
  });
  context.destination = new Node(context);
  const source = new Node(context); const meter = new Node(context); source.connect(meter);
  if (connectError) source.connect = () => { throw new Error('input disconnected'); };
  const runtime = {
    Blob,
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    AudioWorkletNode: class extends Node {
      constructor(ctx, name, options) {
        super(ctx); assert.equal(name, 'morphazoid-output-recorder'); this.options = options;
        this.processor = new Processor(options);
        this.port = {
          closed: false,
          postMessage: data => queueMicrotask(() => this.processor.port.onmessage?.({ data })),
          close() { this.closed = true; },
        };
        this.processor.port.postMessage = (data, transfer = []) => {
          const message = structuredClone(data, { transfer });
          queueMicrotask(() => this.port.onmessage?.({ data: message }));
        };
        nodes.push(this);
      }
    },
  };
  const recorder = new Esi32SampleRecorder({ runtime, onChange: status => changes.push(status), onError: error => errors.push(error) });
  return {
    recorder, runtime, context, source, meter, nodes, timers, changes, errors,
    render(frames = 128, samples = [.25]) {
      const outputs = [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)];
      const result = nodes.at(-1).processor.process([samples.map(value => new Float32Array(frames).fill(value))], [outputs]);
      assert.ok(outputs.every(channel => channel.every(sample => sample === 0)), 'input recording must not monitor the microphone');
      return result;
    },
  };
}

async function finishSmallTake(fixture, channels = 1) {
  assert.equal(await fixture.recorder.start(fixture.context, fixture.source, channels), true);
  await tick(); fixture.render(128, channels === 2 ? [.25, -.5] : [.25]);
  return fixture.recorder.stop();
}

test('sample recording requires an already-running caller context and mono/stereo input', async () => {
  const f = fixture();
  f.context.state = 'suspended';
  assert.equal(await f.recorder.start(f.context, f.source), false);
  assert.equal(f.nodes.length, 0); assert.equal(f.context.resumes, 0);
  f.context.state = 'running';
  assert.equal(await f.recorder.start(f.context, f.source, 3), false);
  assert.equal(await f.recorder.start(f.context, new Node({}), 1), false);
  assert.equal(f.source.targets.size, 1);
  assert.equal(f.errors.length, 3);
  await f.recorder.dispose();
});

test('sample recording uses shared PCM worklet, flushes the final chunk and preserves input routes', async () => {
  const f = fixture();
  assert.equal(await f.recorder.start(f.context, f.source), true); await tick();
  const node = f.nodes[0];
  assert.equal(f.recorder.state, 'recording');
  assert.equal(node.options.processorOptions.maxFrames, 8000 * 60);
  assert.equal(node.options.channelCount, 1);
  assert.equal(f.source.targets.has(node), true); assert.equal(f.source.targets.has(f.meter), true);
  assert.equal(f.source.targets.has(f.context.destination), false);
  f.render(128, [.5]);
  const first = f.recorder.stop(); const second = f.recorder.stop(); assert.equal(first, second);
  assert.equal(await f.recorder.start(f.context, f.source), false, 'stop/start races cannot replace a finishing take');
  const blob = await first;
  assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 44 + 128 * 3);
  const bytes = await blob.arrayBuffer(); const view = new DataView(bytes);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(24, true), 8000); assert.equal(view.getUint32(40, true), 128 * 3);
  assert.equal(new Uint8Array(bytes)[46], 64, 'a half-scale input is preserved in 24-bit PCM');
  assert.equal(f.recorder.blob, blob); assert.equal(f.recorder.snapshot().duration, 128 / 8000);
  assert.equal(f.source.targets.size, 1); assert.equal(f.source.targets.has(f.meter), true);
  assert.equal(f.source.disconnections.length, 1); assert.equal(f.source.disconnections[0], node);
  assert.equal(f.context.resumes + f.context.suspends + f.context.closes, 0);
  assert.equal(f.timers.size, 0); assert.equal(node.port.closed, true);
  await f.recorder.dispose();
});

test('mono and stereo captures enforce the same exact 60-second sample-clock limit', async () => {
  for (const channels of [1, 2]) {
    const f = fixture(); assert.equal(await f.recorder.start(f.context, f.source, channels), true); await tick();
    const expectedFrames = 8000 * ESI32_SAMPLE_RECORD_SECONDS;
    assert.equal(f.nodes[0].options.processorOptions.maxFrames, expectedFrames);
    for (let frame = 0; frame < expectedFrames; frame += 128) {
      f.render(Math.min(128, expectedFrames - frame), channels === 2 ? [.25, -.25] : [.25]);
      // Let the existing credit protocol run; no UI clock controls the sample limit.
      if (frame % 16384 === 0) await tick();
    }
    await tick(); await tick();
    assert.equal(f.recorder.state, 'ready'); assert.equal(f.recorder.elapsed, 60);
    assert.equal(f.recorder.blob.size, 44 + expectedFrames * channels * 3);
    assert.equal(f.recorder.snapshot().channelCount, channels);
    assert.equal(f.recorder.snapshot().reason, 'buffer-limit');
    assert.equal(f.source.targets.size, 1);
    await f.recorder.dispose();
  }
});

test('stop during pending worklet loading cancels without attaching input or resuming audio', async () => {
  const module = deferred(); const f = fixture({ module });
  const starting = f.recorder.start(f.context, f.source);
  assert.equal(f.recorder.state, 'starting');
  const result = await f.recorder.stop(); assert.equal(result, null);
  module.resolve(); assert.equal(await starting, false);
  assert.equal(f.nodes.length, 0); assert.equal(f.source.targets.size, 1);
  assert.equal(f.context.resumes, 0);
  await f.recorder.dispose();
});

test('failed new capture preserves the previous successful sample', async () => {
  const f = fixture(); const previous = await finishSmallTake(f);
  f.context.audioWorklet.addModule = async () => { throw new Error('worklet unavailable'); };
  assert.equal(await f.recorder.start(f.context, f.source), false);
  assert.equal(f.recorder.blob, previous);
  assert.equal(f.recorder.snapshot().duration, 128 / 8000);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /worklet unavailable/);
  assert.equal(f.source.targets.size, 1);
  await f.recorder.dispose();
});

test('input tap failures clean only the recorder graph and keep prior routes', async () => {
  const f = fixture({ connectError: true });
  assert.equal(await f.recorder.start(f.context, f.source), false);
  assert.equal(f.recorder.blob, null); assert.equal(f.source.targets.has(f.meter), true);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /input disconnected/);
  assert.equal(f.nodes[0].port.closed, true);
  assert.equal(f.source.disconnections.every(target => target === f.nodes[0]), true);
  await f.recorder.dispose();
});

test('context interruption finalizes captured PCM without owning the context or stream', async () => {
  const f = fixture(); await f.recorder.start(f.context, f.source, 2); await tick(); f.render(128, [.2, -.2]);
  f.context.state = 'suspended'; f.context.emit('statechange');
  const blob = await f.recorder.stop('interrupted');
  assert.ok(blob.size > 44); assert.equal(f.recorder.state, 'ready');
  assert.equal(f.recorder.snapshot().reason, 'interrupted');
  assert.equal(f.context.resumes + f.context.closes, 0); assert.equal(f.source.targets.size, 1);
  await f.recorder.dispose();
});

test('dispose cancels pending start and pending stop callbacks without dropping unrelated input paths', async () => {
  const module = deferred(); const pending = fixture({ module });
  const starting = pending.recorder.start(pending.context, pending.source);
  await pending.recorder.dispose(); module.resolve();
  assert.equal(await starting, false); assert.equal(pending.recorder.state, 'disposed');
  assert.equal(pending.nodes.length, 0); assert.equal(pending.recorder.blob, null);
  const f = fixture(); await f.recorder.start(f.context, f.source); await tick(); f.render();
  const stopping = f.recorder.stop(); const disposed = f.recorder.dispose();
  assert.equal(await stopping, null); await disposed;
  assert.equal(f.recorder.state, 'disposed'); assert.equal(f.recorder.blob, null);
  assert.equal(f.source.targets.size, 1); assert.equal(f.source.targets.has(f.meter), true);
  assert.equal(f.timers.size, 0);
  assert.equal(await f.recorder.start(f.context, f.source), false);
});
