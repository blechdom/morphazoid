import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserDelayEngine } from '../src/instruments/micmic/native/browser-engine.js';
import { DEFAULT_PARAMETERS } from '../src/instruments/micmic/native/model.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) { if (predicate()) return; await tick(); }
  throw new Error('Preparation fixture did not reach its expected boundary');
}
async function sustainedHeadroom(f, seconds = 3) {
  const end = f.now + seconds;
  while (f.now < end) { f.now = Math.min(end, f.now + .25); await f.engine.request('/api/status'); }
}

function pcm() {
  const values = Float32Array.from({ length: 128 }, (_, index) => Math.sin(index) * .1);
  return { numberOfChannels: 1, length: values.length, sampleRate: 48000, getChannelData: () => values };
}

/** Real browser-engine requests and lifecycle, with compiler/worklet protocol
 * fixtures carrying the bounded WASM metadata. DSP capacity-hint acceptance is
 * tested by the Rust/WASM suite; these tests cover its browser-side ownership. */
function fixture({ depth = .72 } = {}) {
  const originals = new Map(), contexts = [], worklets = [], sources = [], compileRequests = [], errors = [];
  const calibration = { voices: 64, sampleRate: 48000, targetLoad: .55, measuredLoad: .3,
    elapsedMs: 40, measurements: [{ voices: 64, load: .3 }] };
  const f = { contexts, worklets, sources, compileRequests, errors, calibration,
    rejectAbove: Infinity, now: 1, load: .2, peak: .3, installed: 0, structuralEligible: 0,
    liveDepth: depth, revision: 0, active: 0, calibrationProof: 0,
    holdCompile: false, compileReplies: [] };
  function replace(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const status = () => ({ sampleRate: 48000, elapsedSeconds: f.now, audioTimeSeconds: f.now,
    processedBlocks: Math.round(f.now * 48000 / 128), requestedTargets: f.installed,
    installedCapacity: f.installed, voiceLimit: f.active, targetVoices: f.active,
    activeVoices: f.active, calibratedVoices: f.calibrationProof,
    cpuLoad: f.load, peakLoad: f.peak, topologyRevision: f.revision,
    inputPeak: .1, outputPeak: f.active ? .2 : 0, wetBusGain: 1 });
  class Node {
    connect(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  class Context extends EventTarget {
    constructor() {
      super(); this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended';
      this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; contexts.push(this);
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    createGain() {
      const node = new Node(); node.gain = { value: 0, cancelScheduledValues() {},
        setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } };
      return node;
    }
    createBuffer() { return pcm(); }
    decodeAudioData() { return Promise.resolve(pcm()); }
    createBufferSource() {
      const node = new Node(); node.start = () => { node.started = true; };
      node.stop = () => { node.stopped = true; }; sources.push(node); return node;
    }
  }
  class Worker {
    postMessage(data) {
      compileRequests.push(structuredClone(data));
      const voiceBudget = data.voiceBudget ?? calibration.voices;
      if (voiceBudget > f.rejectAbove) {
        queueMicrotask(() => this.onmessage?.({ data: { id: data.id, error: 'QA rejected optional prepared pool' } }));
        return;
      }
      const requestedVoices = 2 ** (data.parameters.generations + 1) - 2;
      const preparedVoices = Math.min(voiceBudget, requestedVoices);
      const effectiveGenerations = Math.min(data.parameters.generations, Math.ceil(Math.log2(preparedVoices + 2)) - 1);
      const pool = new ArrayBuffer(32 + preparedVoices * 48), header = new DataView(pool);
      header.setUint32(0, 0x4c534431, true); header.setUint32(4, 2, true);
      header.setUint32(8, preparedVoices, true); header.setUint32(12, preparedVoices, true);
      header.setUint32(16, data.revision, true); header.setFloat64(24, 1, true);
      const nodes = Array.from({ length: preparedVoices + 1 }, (_, index) => ({ id: index,
        key: index ? `generation:trunk/${index}` : 'generation:trunk',
        parentKey: index ? 'generation:trunk' : '', generation: index ? 1 : 0,
        voiceIndex: Math.max(0, index - 1), priority: index ? index - 1 : null,
        startX: 0, startY: 0, x: index, y: 0, delay: .1, rate: 1, gain: data.parameters.depth ? .5 : 0 }));
      const reply = () => this.onmessage?.({ data: { id: data.id, revision: data.revision,
        calibration, voiceBudget, module: {}, pool, result: {
          parameters: structuredClone(data.parameters),
          effectiveParameters: { ...data.parameters, generations: effectiveGenerations },
          requestedVoices, requestedVoicesExact: true, preparedVoices, nodes,
          structuralEligibleVoices: preparedVoices, eligibleVoices: data.parameters.depth ? preparedVoices : 0,
          memoryVoiceCapacity: 1024, previewSampled: false,
        } } });
      if (f.holdCompile) f.compileReplies.push(reply); else queueMicrotask(reply);
    }
    terminate() { this.terminated = true; }
  }
  class Worklet extends Node {
    constructor() {
      super(); this.messages = []; worklets.push(this);
      this.port = { close() {}, postMessage: (message, transfers = []) => {
        const data = transfers.length ? structuredClone(message, { transfer: transfers }) : message;
        this.messages.push(data);
        if (data.type === 'install') {
          const header = new DataView(data.pool); f.installed = header.getUint32(8, true);
          f.structuralEligible = header.getUint32(12, true); f.revision = header.getUint32(16, true);
          f.calibrationProof = Math.max(f.calibrationProof, data.seedCapacity || 0);
          f.active = f.liveDepth > 0 ? f.structuralEligible : 0;
        }
        if (data.type === 'depth') { f.liveDepth = data.depth; f.active = data.depth > 0 ? f.structuralEligible : 0; }
        if (data.id) queueMicrotask(() => this.port.onmessage?.({ data: { id: data.id, status: status() } }));
      } };
      queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } }));
    }
  }
  replace('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  replace('AudioContext', Context); replace('AudioWorkletNode', Worklet); replace('Worker', Worker);
  replace('navigator', { mediaDevices: { getUserMedia() { throw new Error('Sample input must not request a microphone'); } } });
  replace('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  const engine = f.engine = createBrowserDelayEngine({ initialParameters: { ...DEFAULT_PARAMETERS, generations: 8, depth },
    onError: error => errors.push(error) });
  f.start = async () => { await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true }); };
  f.cleanup = () => {
    engine.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  };
  return f;
}

test('a rejected optional growth probe retains the installed budget and a tiny scene can recover in the same session', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.deviceCapacity.preparedCapacity, 64);
    f.rejectAbove = 64;
    await sustainedHeadroom(f);
    await until(() => f.compileRequests.length === 2 && !engine.getDiagnostics().capacityWorking);
    const rejected = engine.getDiagnostics();
    assert.match(rejected.capacityFailure, /QA rejected optional prepared pool/);
    assert.equal(rejected.deviceCapacity.preparedCapacity, 64, 'uninstalled candidate never becomes the next scene budget');
    assert.equal(rejected.buildRevision, before.buildRevision); assert.equal(rejected.audio, true);
    assert.equal(rejected.error, null); assert.equal(rejected.sampleClock, 4); assert.deepEqual(f.errors, []);
    const recovered = await engine.request('/api/parameters', { ...before.parameters, generations: 1 });
    assert.equal(f.compileRequests.at(-1).voiceBudget, 64, 'a tiny scene receives the last successful capacity');
    assert.equal(recovered.parameters.generations, 1); assert.equal(recovered.preparedVoices, 2);
    assert.equal(recovered.requestedVoices, 2); assert.equal(recovered.audio, true);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    assert.equal(engine.getDiagnostics().sampleClock, 4); assert.equal(engine.getDiagnostics().input.playing, true);
  } finally { f.cleanup(); }
});

test('zero-depth startup keeps cold calibration metadata and resumes without rebuilding input or recompiling its prepared tree', async () => {
  const f = fixture({ depth: 0 });
  try {
    await f.start();
    const engine = f.engine, silent = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(silent.parameters.depth, 0); assert.equal(silent.status.voiceLimit, 0);
    assert.equal(silent.preparedVoices, 64); assert.equal(silent.deviceCapacity.preparedCapacity, 64);
    assert.equal(f.worklets[0].messages.find(message => message.type === 'install').seedCapacity, 64,
      'the first installation carries cold proof even when the scene is silent');
    const resumed = await engine.request('/api/depth', { depth: .9 });
    assert.equal(resumed.parameters.depth, .9); assert.equal(resumed.status.voiceLimit, 64);
    assert.equal(resumed.deviceCapacity.voices, 64); assert.equal(resumed.deviceCapacity.preparedCapacity, 64);
    assert.equal(f.compileRequests.length, 1); assert.equal(resumed.topologyRevision, silent.buildRevision);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 1);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    assert.equal(resumed.audio, true); assert.equal(resumed.input.playing, true);
  } finally { f.cleanup(); }
});

test('a fully admitted pool above the cold benchmark target seeks more prepared voices while preserving requested scene and playback', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.preparedVoices, 64); assert.equal(before.requestedVoices, 510);
    assert.equal(before.parameters.generations, 8); assert.equal(before.effectiveParameters.generations, 6);
    f.load = f.peak = .6;
    await sustainedHeadroom(f);
    await until(() => f.compileRequests.length === 2 && !engine.getDiagnostics().capacityWorking);
    const grown = engine.getDiagnostics(), request = f.compileRequests.at(-1);
    assert.ok(request.voiceBudget > 64, '.60 recurring load leaves sustainable capacity to test');
    assert.equal(request.replaceable, true); assert.equal(request.parameters.generations, 8);
    assert.equal(grown.deviceCapacity.preparedCapacity, request.voiceBudget);
    assert.equal(grown.preparedVoices, request.voiceBudget); assert.equal(grown.requestedVoices, 510);
    assert.deepEqual(grown.parameters, before.parameters); assert.ok(grown.buildRevision > before.buildRevision);
    assert.equal(grown.audio, true); assert.equal(grown.input.playing, true); assert.equal(grown.sampleClock, 4);
    assert.equal(grown.capacityFailure, null); assert.deepEqual(f.errors, []);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
  } finally { f.cleanup(); }
});

test('headroom reported during a pending scene compile cannot queue an old-scene capacity probe behind the new scene', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.parameters.generations, 8); assert.equal(before.preparedVoices, 64);
    f.holdCompile = true;
    const nextParameters = { ...before.parameters, generations: 1 };
    const changing = engine.request('/api/parameters', nextParameters);
    await until(() => f.compileReplies.length === 1);
    assert.equal(f.compileRequests.at(-1).parameters.generations, 1);
    assert.equal(engine.getDiagnostics().parameters.generations, 8, 'old scene remains committed while the new scene compiles');
    f.now = 4;
    await engine.request('/api/status');
    // The old installed pool is full and has headroom, but it must not acquire
    // the pending request's token and supersede that request after it commits.
    f.holdCompile = false; f.compileReplies.shift()();
    const recalled = await changing;
    await until(() => !engine.getDiagnostics().capacityWorking);
    await tick(); await tick();
    const settled = engine.getDiagnostics();
    assert.deepEqual(settled.parameters, nextParameters, 'no optional installation restores the preceding dense scene');
    assert.deepEqual(recalled.parameters, nextParameters);
    assert.equal(f.compileRequests.length, 2, 'only initial preparation and the requested scene were compiled');
    assert.equal(settled.preparedVoices, 2); assert.equal(settled.requestedVoices, 2);
    assert.equal(settled.buildRevision, recalled.topologyRevision);
    assert.equal(settled.status.topologyRevision, settled.buildRevision, 'worklet and published scene finish at the same revision');
    assert.equal(settled.audio, true); assert.equal(settled.input.playing, true); assert.equal(settled.sampleClock, 4);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('audio backoff retains its prepared tree until sustained improved capacity proves a larger pool', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0];
    f.load = f.peak = .8;
    await sustainedHeadroom(f);
    await until(() => f.compileRequests.length === 2 && !engine.getDiagnostics().capacityWorking);
    const grown = engine.getDiagnostics(), budget = grown.deviceCapacity.preparedCapacity;
    assert.ok(budget > 64 && budget < 64 * 1.2, 'busy audio gets a proportional probe, not a predictable overload');
    const installedMessages = f.worklets[0].messages.filter(message => message.type === 'install').length;
    // Rust can reduce actual processing without rewriting or freeing the
    // prepared pool. Alternate rejected admission and healthy partial work.
    for (let index = 0; index < 80; index++) {
      f.active = 48; f.calibrationProof = 48;
      f.load = f.peak = index % 8 === 0 ? 1.1 : .6;
      f.now += .25; await engine.request('/api/status');
      assert.equal(engine.getDiagnostics().deviceCapacity.preparedCapacity, budget);
      assert.equal(engine.getDiagnostics().buildRevision, grown.buildRevision);
    }
    assert.equal(f.compileRequests.length, 2);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, installedMessages);
    assert.deepEqual(engine.getDiagnostics().parameters, before.parameters);
    f.active = f.structuralEligible; f.calibrationProof = f.active; f.load = f.peak = .4;
    await engine.request('/api/status');
    await sustainedHeadroom(f);
    await until(() => f.compileRequests.length === 3 && !engine.getDiagnostics().capacityWorking);
    assert.ok(engine.getDiagnostics().deviceCapacity.preparedCapacity > budget, 'retained capacity is not a permanent ceiling');
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.stopped, undefined); assert.equal(engine.getDiagnostics().input.playing, true);
    assert.ok(engine.getDiagnostics().sampleClock > grown.sampleClock); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});
