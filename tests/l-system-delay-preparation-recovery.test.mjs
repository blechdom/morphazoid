import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserDelayEngine } from '../src/instruments/micmic/native/browser-engine.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';

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
    liveDepth: depth, revision: 0, active: 0, autoDemand: 0, calibrationProof: 0, deadlineMisses: 0,
    performance: structuredClone(DEFAULT_PERFORMANCE),
    holdCompile: false, compileReplies: [], heldControlType: null, controlReplies: [],
    fold: DEFAULT_PARAMETERS.intervalMs, rejectFold: false, lightFoldAck: false };
  f.delayCoefficient = () => .1 / DEFAULT_PARAMETERS.intervalMs;
  const updateDemand = (newScene = false, automaticChanged = false) => {
    const eligible = f.liveDepth > 0 ? f.structuralEligible : 0;
    const demand = f.performance.voiceCeiling > 0 ? Math.min(eligible, f.performance.voiceCeiling) : eligible;
    // DSP backoff can be injected independently through f.active. Mix-only
    // controls retain it; a changed demand or a complete scene re-admits the
    // bounded membership, including restoration after a manual ceiling.
    if (newScene || automaticChanged || demand !== f.autoDemand) f.active = demand;
    f.autoDemand = demand;
  };
  function replace(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const status = () => ({ sampleRate: 48000, elapsedSeconds: f.now, audioTimeSeconds: f.now,
    processedBlocks: Math.round(f.now * 48000 / 128), requestedTargets: f.installed,
    installedCapacity: f.installed, voiceLimit: f.performance.automatic ? Math.min(f.active, f.autoDemand) : f.autoDemand,
    targetVoices: f.performance.automatic ? Math.min(f.active, f.autoDemand) : f.autoDemand,
    activeVoices: f.performance.automatic ? Math.min(f.active, f.autoDemand) : f.autoDemand,
    automatic: f.performance.automatic, calibratedVoices: f.calibrationProof,
    deadlineMisses: f.deadlineMisses,
    cpuLoad: f.load, peakLoad: f.peak, topologyRevision: f.revision,
    inputPeak: .1, outputPeak: f.active ? .2 : 0, wetBusGain: 1,
    timeFoldMs: f.nominalFold ?? f.fold, timeFoldTargetMs: f.fold });
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
      let voiceBudget = data.voiceBudget ?? calibration.voices, capacityFailure = null;
      if (voiceBudget > f.rejectAbove) {
        if (data.validateCapacity && Number.isFinite(data.fallbackVoiceBudget)
          && data.fallbackVoiceBudget <= f.rejectAbove) {
          // The worker owns optional preflight. A declined larger proposal
          // still returns the requested scene at its last successful budget.
          voiceBudget = data.fallbackVoiceBudget;
          capacityFailure = 'QA rejected optional prepared pool';
        } else {
          const reply = () => this.onmessage?.({ data: { id: data.id, error: 'QA rejected optional prepared pool' } });
          if (f.holdCompile) f.compileReplies.push(reply); else queueMicrotask(reply);
          return;
        }
      }
      const requestedVoices = 2 ** (data.parameters.generations + 1) - 2;
      const preparedVoices = Math.min(voiceBudget, requestedVoices);
      const effectiveGenerations = Math.min(data.parameters.generations, Math.ceil(Math.log2(preparedVoices + 2)) - 1);
      const pool = new ArrayBuffer(32 + preparedVoices * 48), header = new DataView(pool);
      header.setUint32(0, 0x4c534431, true); header.setUint32(4, 2, true);
      header.setUint32(8, preparedVoices, true); header.setUint32(12, preparedVoices, true);
      header.setUint32(16, data.revision, true); header.setFloat64(24, 1, true);
      let structuralEligible = 0;
      for (let index = 0; index < preparedVoices; index++) {
        const delay = data.parameters.intervalMs * f.delayCoefficient(index);
        const base = 32 + index * 48, eligible = delay <= 39 + 1e-9;
        header.setFloat64(base, delay, true); header.setFloat64(base + 8, 1, true);
        header.setFloat64(base + 16, eligible && data.parameters.depth > 0 ? .5 : 0, true);
        header.setUint32(base + 32, eligible ? structuralEligible++ : 0xffffffff, true);
        header.setUint32(base + 40, 1, true);
      }
      header.setUint32(12, structuralEligible, true);
      const nodes = Array.from({ length: preparedVoices + 1 }, (_, index) => ({ id: index,
        key: index ? `generation:trunk/${index}` : 'generation:trunk',
        parentKey: index ? 'generation:trunk' : '', generation: index ? 1 : 0,
        voiceIndex: Math.max(0, index - 1), priority: index ? index - 1 : null,
        startX: 0, startY: 0, x: index, y: 0, delay: index ? data.parameters.intervalMs * f.delayCoefficient(index - 1) : 0,
        rate: 1, gain: data.parameters.depth ? .5 : 0 }));
      const reply = () => this.onmessage?.({ data: { id: data.id, revision: data.revision,
        calibration, voiceBudget, capacityFailure,
        sceneMeasurement: data.validateCapacity ? { voices: preparedVoices,
          load: capacityFailure ? 1 : .3, targetLoad: .55, proved: !capacityFailure } : undefined,
        module: {}, pool, result: {
          parameters: structuredClone(data.parameters),
          effectiveParameters: { ...data.parameters, generations: effectiveGenerations },
          requestedVoices, requestedVoicesExact: true, preparedVoices, nodes,
          structuralEligibleVoices: structuralEligible, eligibleVoices: data.parameters.depth ? structuralEligible : 0,
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
          if (data.wholeSceneAdmission) f.calibrationProof = Math.max(f.calibrationProof, f.structuralEligible);
          updateDemand(true);
          f.fold = data.intervalMs;
        }
        if (data.type === 'depth') { f.liveDepth = data.depth; updateDemand(); }
        if (data.type === 'performance') {
          const automaticChanged = data.performance.automatic !== f.performance.automatic;
          f.performance = structuredClone(data.performance); updateDemand(false, automaticChanged);
        }
        if (data.type === 'time-fold') {
          if (f.rejectFold) {
            queueMicrotask(() => this.port.onmessage?.({ data: { id: data.id, error: 'QA rejected live fold' } }));
            return;
          }
          f.fold = data.intervalMs;
        }
        if (data.id) {
          const timing = data.type === 'time-fold' && f.lightFoldAck ? status() : null;
          const reply = () => this.port.onmessage?.({ data: timing
            ? { id: data.id, timeFoldMs: timing.timeFoldMs, timeFoldTargetMs: timing.timeFoldTargetMs,
              topologyRevision: timing.topologyRevision, processedBlocks: timing.processedBlocks }
            : { id: data.id, status: status() } });
          if (data.type === f.heldControlType) f.controlReplies.push(reply); else queueMicrotask(reply);
        }
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

test('releasing acknowledged controls skips redundant compilation and worklet updates without restarting playback', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, source = f.sources[0], buffer = source.buffer;
    const scene = await engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, intervalMs: 73 });
    const performance = await engine.request('/api/performance', { wet: .63 });
    const final = await engine.request('/api/depth', { depth: .9 });
    const count = type => f.worklets[0].messages.filter(message => message.type === type).length;
    const before = { compiles: f.compileRequests.length, installs: count('install'), performance: count('performance'), depth: count('depth') };
    await engine.request('/api/parameters', structuredClone(final.parameters));
    await engine.request('/api/performance', structuredClone(performance.performance));
    await engine.request('/api/depth', { depth: final.parameters.depth });
    assert.deepEqual({ compiles: f.compileRequests.length, installs: count('install'), performance: count('performance'), depth: count('depth') }, before);
    assert.equal(engine.getDiagnostics().buildRevision, scene.topologyRevision);
    assert.deepEqual(engine.getDiagnostics().parameters, final.parameters);
    assert.deepEqual(engine.getDiagnostics().performance, performance.performance);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    assert.equal(engine.getDiagnostics().audio, true); assert.equal(engine.getDiagnostics().input.playing, true);
  } finally { f.cleanup(); }
});

test('returning to the installed scene while a different scene compiles supersedes the pending edit', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0];
    f.holdCompile = true;
    const changing = engine.request('/api/parameters', { ...before.parameters, intervalMs: 73 });
    await until(() => f.compileReplies.length === 1);
    const returning = engine.request('/api/parameters', structuredClone(before.parameters));
    await tick();
    f.holdCompile = false; f.compileReplies.shift()();
    await Promise.all([changing, returning]);
    assert.deepEqual(engine.getDiagnostics().parameters, before.parameters);
    assert.deepEqual(f.compileRequests.at(-1).parameters, before.parameters);
    assert.equal(f.compileRequests.length, 3);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 2,
      'the superseded scene never installs');
    assert.equal(engine.getDiagnostics().status.topologyRevision, engine.getDiagnostics().buildRevision);
    assert.equal(f.sources.length, 1); assert.equal(source.stopped, undefined); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('live Time fold sweeps retain immutable topology and pool without compile, install or source churn', async () => {
  const f = fixture();
  try {
    await f.start();
    const before = await f.engine.request('/api/preview'), source = f.sources[0];
    const installs = f.worklets[0].messages.filter(message => message.type === 'install').length;
    for (const intervalMs of [73, .05, .075, 120, 240]) {
      const reply = await f.engine.request('/api/time-fold', { intervalMs });
      assert.equal(reply.parameters.intervalMs, intervalMs);
      assert.equal(reply.effectiveParameters.intervalMs, intervalMs);
      assert.equal(reply.topologyRevision, before.topologyRevision);
      assert.equal(reply.timeFoldBaseIntervalMs, before.parameters.intervalMs);
      assert.equal(reply.timeFoldScale, intervalMs / before.parameters.intervalMs);
      assert.equal(reply.audio, true);
    }
    const after = await f.engine.request('/api/preview');
    assert.equal(after.nodes, before.nodes);
    assert.equal(after.nodes[1].delay, before.nodes[1].delay);
    assert.equal(f.compileRequests.length, 1);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, installs);
    const folds = f.worklets[0].messages.filter(message => message.type === 'time-fold').length;
    await f.engine.request('/api/time-fold', { intervalMs: 240 });
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'time-fold').length, folds);
    assert.equal(f.contexts.length, 1); assert.equal(f.sources.length, 1); assert.equal(source.stopped, undefined);
  } finally { f.cleanup(); }
});

test('live fold and Depth remain responsive while a structural scene compiles, and its install retains both', async () => {
  const f = fixture();
  try {
    await f.start();
    const before = f.engine.getDiagnostics();
    f.holdCompile = true;
    const changing = f.engine.request('/api/parameters', { ...before.parameters, angle: 79 });
    await until(() => f.compileReplies.length === 1);
    const folded = await f.engine.request('/api/time-fold', { intervalMs: .075 });
    await f.engine.request('/api/depth', { depth: .9 });
    assert.equal(folded.parameters.angle, before.parameters.angle);
    assert.equal(folded.parameters.intervalMs, .075);
    assert.equal(f.compileRequests.length, 2, 'fold does not replace or duplicate the structural compile');
    f.holdCompile = false; f.compileReplies.shift()();
    const final = await changing;
    assert.equal(final.parameters.angle, 79);
    assert.equal(final.parameters.intervalMs, .075); assert.equal(final.parameters.depth, .9);
    assert.equal(final.effectiveParameters.intervalMs, .075);
    const install = f.worklets[0].messages.filter(message => message.type === 'install').at(-1);
    assert.equal(install.baseIntervalMs, before.parameters.intervalMs);
    assert.equal(install.intervalMs, .075); assert.equal(install.liveFold, true);
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
  } finally { f.cleanup(); }
});

for (const depth of [0, .72]) {
  test(`Time fold history boundary falls back using all raw prepared delays at Depth${depth}`, async () => {
    const f = fixture({ depth });
    try {
      f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
      await f.start();
      await f.engine.request('/api/time-fold', { intervalMs: 200 });
      assert.equal(f.compileRequests.length, 1, 'unchanged eligible and excluded sets use scalar timing');
      const beyond = await f.engine.request('/api/time-fold', { intervalMs: 300 });
      assert.equal(f.compileRequests.length, 2);
      assert.equal(beyond.parameters.intervalMs, 300);
      assert.equal(beyond.eligibleVoices, 0);
      const restored = await f.engine.request('/api/time-fold', { intervalMs: 50 });
      assert.equal(f.compileRequests.length, 3);
      assert.equal(restored.parameters.intervalMs, 50);
      assert.equal(restored.eligibleVoices, depth ? 64 : 0);
      const install = f.worklets[0].messages.filter(message => message.type === 'install').at(-1);
      assert.equal(install.intervalMs, install.baseIntervalMs);
      assert.equal(install.liveFold, true, 'a live history-boundary fallback stays a live gesture at scale1');
      assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
      assert.equal(restored.audio, true);
    } finally { f.cleanup(); }
  });
}

test('history fallback during a pending structural compile retains that desired scene and supersedes its old pool', async () => {
  const f = fixture();
  try {
    f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
    await f.start();
    const before = f.engine.getDiagnostics();
    f.holdCompile = true;
    const changing = f.engine.request('/api/parameters', { ...before.parameters, angle: 79 });
    await until(() => f.compileReplies.length === 1);
    const folding = f.engine.request('/api/time-fold', { intervalMs: 300 });
    await tick(); f.holdCompile = false; f.compileReplies.shift()();
    await Promise.all([changing, folding]);
    const final = f.engine.getDiagnostics();
    assert.equal(final.parameters.angle, 79); assert.equal(final.parameters.intervalMs, 300);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 2);
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
  } finally { f.cleanup(); }
});

test('pending fold reversal is delivered and full preset recall owns its complete timing', async () => {
  const f = fixture();
  try {
    await f.start();
    const before = f.engine.getDiagnostics();
    f.heldControlType = 'time-fold';
    const changing = f.engine.request('/api/time-fold', { intervalMs: 73 });
    await until(() => f.controlReplies.length === 1);
    const returning = f.engine.request('/api/time-fold', { intervalMs: before.parameters.intervalMs });
    await until(() => f.controlReplies.length === 2);
    f.heldControlType = null;
    f.controlReplies.shift()(); f.controlReplies.shift()();
    await Promise.all([changing, returning]);
    const preset = await f.engine.request('/api/parameters', { ...before.parameters, intervalMs: 120 });
    assert.equal(preset.parameters.intervalMs, 120);
    const install = f.worklets[0].messages.filter(message => message.type === 'install').at(-1);
    assert.equal(install.liveFold, false, 'complete presets retain the discrete scene transition');
    assert.equal(f.compileRequests.length, 2);
  } finally { f.cleanup(); }
});

test('recalling the acknowledged full preset supersedes a pending live fold even when scene values compare equal', async () => {
  const f = fixture();
  try {
    await f.start();
    const before = f.engine.getDiagnostics();
    f.heldControlType = 'time-fold';
    const changing = f.engine.request('/api/time-fold', { intervalMs: 73 });
    await until(() => f.controlReplies.length === 1);
    const recalled = await f.engine.request('/api/parameters', structuredClone(before.parameters));
    assert.equal(f.compileRequests.length, 2, 'the pending gesture prevents an incorrect settled no-op');
    assert.equal(recalled.parameters.intervalMs, before.parameters.intervalMs);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').at(-1).liveFold, false);
    f.heldControlType = null; f.controlReplies.shift()(); await changing;
    assert.equal(f.engine.getDiagnostics().parameters.intervalMs, before.parameters.intervalMs);
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
  } finally { f.cleanup(); }
});

test('muted fold edits retain the compiled base and restore their target on startup and processor recovery', async () => {
  const f = fixture();
  try {
    await f.engine.request('/api/state');
    const muted = await f.engine.request('/api/time-fold', { intervalMs: .075 });
    assert.equal(muted.audio, false); assert.equal(f.contexts.length, 0);
    await f.start();
    assert.equal(f.worklets[0].messages.find(message => message.type === 'install').intervalMs, .075);
    await f.engine.request('/api/time-fold', { intervalMs: 73 });
    f.worklets[0].onprocessorerror();
    await f.engine.request('/api/audio', { enabled: true });
    const restored = f.engine.getDiagnostics(), install = f.worklets[1].messages.find(message => message.type === 'install');
    assert.equal(install.baseIntervalMs, 240); assert.equal(install.intervalMs, 73);
    assert.equal(restored.parameters.intervalMs, 73); assert.equal(restored.audio, true);
    assert.equal(f.compileRequests.length, 1, 'restart installs retained immutable pool plus latest fold');
  } finally { f.cleanup(); }
});

test('rejected scalar fold leaves acknowledged timing intact and can be retried in the same session', async () => {
  const f = fixture();
  try {
    await f.start(); f.rejectFold = true;
    await assert.rejects(f.engine.request('/api/time-fold', { intervalMs: 73 }), /QA rejected live fold/);
    assert.equal(f.engine.getDiagnostics().parameters.intervalMs, 240);
    f.rejectFold = false;
    const recovered = await f.engine.request('/api/time-fold', { intervalMs: 73 });
    assert.equal(recovered.parameters.intervalMs, 73);
    assert.equal(f.compileRequests.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(f.sources[0].stopped, undefined); assert.equal(recovered.audio, true);
  } finally { f.cleanup(); }
});

test('rejected live history fallback restores acknowledged timing and permits immediate scalar recovery', async () => {
  const f = fixture();
  try {
    f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
    await f.start(); f.rejectAbove = 0;
    await assert.rejects(f.engine.request('/api/time-fold', { intervalMs: 300 }), /QA rejected optional prepared pool/);
    const rejected = f.engine.getDiagnostics();
    assert.equal(rejected.parameters.intervalMs, 240); assert.equal(rejected.timeFoldBaseIntervalMs, 240);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 1);
    f.rejectAbove = Infinity;
    const recovered = await f.engine.request('/api/time-fold', { intervalMs: 200 });
    assert.equal(recovered.parameters.intervalMs, 200);
    assert.equal(f.compileRequests.length, 2, 'recovery uses the retained eligible pool without another compile');
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
    assert.equal(recovered.audio, true);
  } finally { f.cleanup(); }
});

test('a rejected complete scene cannot become the structure or controls of a later live fold fallback', async () => {
  const f = fixture();
  try {
    f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
    await f.start(); const before = f.engine.getDiagnostics();
    f.rejectAbove = 0;
    await assert.rejects(f.engine.request('/api/parameters', { ...before.parameters,
      lSystemType: 'fern', angle: 79, generations: 7, intervalMs: 120, depth: .37 }), /QA rejected optional prepared pool/);
    assert.deepEqual(f.engine.getDiagnostics().parameters, before.parameters);
    f.rejectAbove = Infinity;
    const recovered = await f.engine.request('/api/time-fold', { intervalMs: 300 });
    assert.deepEqual(f.compileRequests.at(-1).parameters, { ...before.parameters, intervalMs: 300 },
      'history fallback uses the acknowledged structure and controls after rejected preset recall');
    assert.deepEqual(recovered.parameters, { ...before.parameters, intervalMs: 300 });
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined); assert.equal(recovered.audio, true);
  } finally { f.cleanup(); }
});

for (const held of ['time-fold', 'depth']) {
  test(`rejected structural preparation restores its structure while preserving a newer pending ${held}`, async () => {
    const f = fixture();
    try {
      f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
      await f.start(); const before = f.engine.getDiagnostics();
      f.rejectAbove = 0; f.holdCompile = true;
      const preparing = f.engine.request('/api/parameters', { ...before.parameters, angle: 79, intervalMs: 120, depth: .37 });
      const rejected = assert.rejects(preparing, /QA rejected optional prepared pool/);
      await until(() => f.compileReplies.length === 1);
      f.heldControlType = held;
      const folding = f.engine.request('/api/time-fold', { intervalMs: 200 });
      if (held === 'time-fold') await until(() => f.controlReplies.length === 1); else await folding;
      const deepening = f.engine.request('/api/depth', { depth: .9 });
      if (held === 'depth') await until(() => f.controlReplies.length === 1); else await deepening;
      f.holdCompile = false; f.compileReplies.shift()(); await rejected;
      f.heldControlType = null; f.controlReplies.shift()(); await Promise.all([folding, deepening]);
      f.rejectAbove = Infinity;
      const recovered = await f.engine.request('/api/time-fold', { intervalMs: 300 });
      assert.deepEqual(f.compileRequests.at(-1).parameters, { ...before.parameters, intervalMs: 300, depth: .9 });
      assert.equal(recovered.parameters.angle, before.parameters.angle);
      assert.equal(recovered.parameters.depth, .9); assert.equal(recovered.parameters.intervalMs, 300);
      assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
    } finally { f.cleanup(); }
  });
}

test('a superseded rejected scene cannot erase the newer complete scene desired by a live fold fallback', async () => {
  const f = fixture();
  try {
    f.delayCoefficient = index => (index === 0 ? 38 : 80) / 240;
    await f.start(); const before = f.engine.getDiagnostics();
    f.rejectAbove = 0; f.holdCompile = true;
    const older = f.engine.request('/api/parameters', { ...before.parameters, angle: 79 });
    const rejected = assert.rejects(older, /QA rejected optional prepared pool/);
    await until(() => f.compileReplies.length === 1);
    const desired = { ...before.parameters, angle: 23, depth: .83 };
    const newer = f.engine.request('/api/parameters', desired);
    f.rejectAbove = Infinity; f.compileReplies.shift()(); await rejected;
    await until(() => f.compileReplies.length === 1);
    const folding = f.engine.request('/api/time-fold', { intervalMs: 300 });
    await tick(); f.holdCompile = false; f.compileReplies.shift()();
    await Promise.all([newer, folding]);
    assert.deepEqual(f.compileRequests.at(-1).parameters, { ...desired, intervalMs: 300 });
    assert.deepEqual(f.engine.getDiagnostics().parameters, { ...desired, intervalMs: 300 });
  } finally { f.cleanup(); }
});

test('disposing during a pending live fold settles the request and cannot revive audio after a delayed ACK', async () => {
  const f = fixture();
  try {
    await f.start(); f.heldControlType = 'time-fold';
    const changing = f.engine.request('/api/time-fold', { intervalMs: 73 });
    const rejected = assert.rejects(changing, /This audio session has closed/);
    await until(() => f.controlReplies.length === 1);
    f.engine.dispose(); await rejected;
    f.heldControlType = null; f.controlReplies.shift()(); await tick();
    const after = f.engine.getDiagnostics();
    assert.equal(after.disposed, true); assert.equal(after.audio, false); assert.equal(after.audioDesired, false);
    assert.equal(after.parameters.intervalMs, 240);
    assert.equal(f.sources[0].stopped, true); assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.worklets[0].disconnected, true);
  } finally { f.cleanup(); }
});

test('scalar fold ACKs update nominal timing without allowing older frames or superseded gestures to rewind it', async () => {
  const f = fixture();
  try {
    await f.start(); f.lightFoldAck = true; f.heldControlType = 'time-fold';
    f.nominalFold = 240;
    const changing = f.engine.request('/api/time-fold', { intervalMs: 73 });
    await until(() => f.controlReplies.length === 1);
    f.now = 2; f.nominalFold = 100;
    await f.engine.request('/api/status');
    f.heldControlType = null; f.controlReplies.shift()(); await changing;
    assert.equal(f.engine.getDiagnostics().status.timeFoldMs, 100, 'newer rendered status wins over a late scalar ACK');

    f.heldControlType = 'time-fold'; f.nominalFold = 100;
    const older = f.engine.request('/api/time-fold', { intervalMs: 200 });
    await until(() => f.controlReplies.length === 1);
    f.nominalFold = 150;
    const latest = f.engine.request('/api/time-fold', { intervalMs: 240 });
    await until(() => f.controlReplies.length === 2);
    f.heldControlType = null; f.controlReplies.pop()(); await latest;
    assert.equal(f.engine.getDiagnostics().status.timeFoldMs, 150, 'latest lightweight ACK carries its current nominal timing');
    f.controlReplies.shift()(); await older;
    const final = f.engine.getDiagnostics();
    assert.equal(final.parameters.intervalMs, 240);
    assert.equal(final.status.timeFoldMs, 150, 'an old gesture cannot rewind the latest timing');
    assert.equal(final.status.timeFoldTargetMs, 240);
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined);
  } finally { f.cleanup(); }
});

for (const type of ['performance', 'depth']) {
  test(`returning to the acknowledged ${type} value during a pending edit still sends the reversal`, async () => {
    const f = fixture();
    try {
      await f.start();
      const engine = f.engine, before = engine.getDiagnostics();
      const previous = type === 'depth' ? { depth: before.parameters.depth } : before.performance;
      const next = type === 'depth' ? { depth: .9 } : { ...previous, wet: .63 };
      const count = () => f.worklets[0].messages.filter(message => message.type === type).length;
      const initial = count();
      f.heldControlType = type;
      const changing = engine.request(`/api/${type}`, next);
      await until(() => f.controlReplies.length === 1);
      const returning = engine.request(`/api/${type}`, structuredClone(previous));
      await until(() => f.controlReplies.length === 2);
      assert.equal(count(), initial + 2, 'pending state prevents an incorrect no-op shortcut');
      f.heldControlType = null;
      f.controlReplies.shift()(); f.controlReplies.shift()();
      await Promise.all([changing, returning]);
      const final = engine.getDiagnostics();
      assert.deepEqual(type === 'depth' ? { depth: final.parameters.depth } : final.performance, previous);
      await engine.request(`/api/${type}`, structuredClone(previous));
      assert.equal(count(), initial + 2, 'an acknowledged release becomes a no-op');
      assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, undefined); assert.equal(final.audio, true);
    } finally { f.cleanup(); }
  });
}

test('sustained headroom stages a future budget without expanding an unchanged playing scene', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = await engine.request('/api/preview'), source = f.sources[0], buffer = source.buffer;
    await sustainedHeadroom(f, 12);
    const staged = await engine.request('/api/preview');
    assert.ok(engine.getDiagnostics().nextSceneCapacity > 64, 'headroom remains available for a future explicit scene');
    assert.equal(staged.deviceCapacity.preparedCapacity, 64); assert.equal(staged.preparedVoices, 64);
    assert.deepEqual(staged.nodes, before.nodes); assert.equal(staged.topologyRevision, before.topologyRevision);
    assert.deepEqual(staged.parameters, before.parameters);
    await engine.request('/api/parameters', structuredClone(before.parameters));
    assert.equal(f.compileRequests.length, 1, 'an identical acknowledged scene does not consume a capacity proposal');
    const installs = f.worklets[0].messages.filter(message => message.type === 'install');
    assert.equal(installs.length, 1); assert.equal(installs[0].wholeSceneAdmission, true);
    assert.equal(staged.audio, true); assert.equal(staged.input.playing, true); assert.equal(staged.status.elapsedSeconds, 13);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('a rejected future capacity proposal commits the requested scene at the proven fallback budget', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.deviceCapacity.preparedCapacity, 64);
    f.rejectAbove = 64;
    await sustainedHeadroom(f);
    assert.equal(f.compileRequests.length, 1, 'status never sends the optional proposal to the compiler');
    const proposal = engine.getDiagnostics().nextSceneCapacity;
    assert.ok(proposal > 64);
    const nextParameters = { ...before.parameters, angle: before.parameters.angle + 7 };
    const rejected = await engine.request('/api/parameters', nextParameters);
    const request = f.compileRequests.at(-1);
    assert.equal(request.voiceBudget, proposal); assert.equal(request.validateCapacity, true);
    assert.equal(request.fallbackVoiceBudget, 64); assert.deepEqual(request.performance, before.performance);
    assert.match(engine.getDiagnostics().capacityFailure, /QA rejected optional prepared pool/);
    assert.equal(rejected.deviceCapacity.preparedCapacity, 64, 'uninstalled candidate never becomes the next scene budget');
    assert.deepEqual(rejected.parameters, nextParameters, 'declining capacity does not discard the requested preset');
    assert.equal(rejected.preparedVoices, 64); assert.ok(rejected.topologyRevision > before.buildRevision);
    assert.equal(engine.getDiagnostics().nextSceneCapacity, 64); assert.equal(rejected.audio, true);
    assert.equal(rejected.error, null); assert.equal(rejected.status.elapsedSeconds, 4); assert.deepEqual(f.errors, []);
    const recovered = await engine.request('/api/parameters', { ...nextParameters, generations: 1 });
    assert.equal(f.compileRequests.at(-1).voiceBudget, 64, 'a tiny scene receives the last successful capacity');
    assert.equal(recovered.parameters.generations, 1); assert.equal(recovered.preparedVoices, 2);
    assert.equal(recovered.requestedVoices, 2); assert.equal(recovered.audio, true);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    assert.equal(engine.getDiagnostics().sampleClock, 4); assert.equal(engine.getDiagnostics().input.playing, true);
    const installs = f.worklets[0].messages.filter(message => message.type === 'install');
    assert.equal(installs.length, 3); assert.ok(installs.every(message => message.wholeSceneAdmission === true));
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

test('the next explicit scene validates staged capacity before atomically installing its full playable pool', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.preparedVoices, 64); assert.equal(before.requestedVoices, 510);
    assert.equal(before.parameters.generations, 8); assert.equal(before.effectiveParameters.generations, 6);
    f.load = f.peak = .6;
    await sustainedHeadroom(f);
    const proposal = engine.getDiagnostics().nextSceneCapacity;
    assert.ok(proposal > 64, '.60 recurring load leaves headroom to propose for the next scene');
    assert.equal(f.compileRequests.length, 1); assert.equal(engine.getDiagnostics().buildRevision, before.buildRevision);
    f.holdCompile = true;
    const nextParameters = { ...before.parameters, angle: before.parameters.angle + 7 };
    const changing = engine.request('/api/parameters', nextParameters);
    await until(() => f.compileReplies.length === 1);
    assert.equal(engine.getDiagnostics().deviceCapacity.preparedCapacity, 64, 'preflight cannot publish unaccepted capacity');
    assert.deepEqual(engine.getDiagnostics().parameters, before.parameters);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 1);
    f.holdCompile = false; f.compileReplies.shift()(); await changing;
    const grown = engine.getDiagnostics(), request = f.compileRequests.at(-1);
    assert.equal(request.voiceBudget, proposal); assert.equal(request.validateCapacity, true);
    assert.equal(request.fallbackVoiceBudget, 64); assert.deepEqual(request.performance, before.performance);
    assert.equal(request.replaceable, true); assert.equal(request.parameters.generations, 8);
    assert.equal(grown.deviceCapacity.preparedCapacity, request.voiceBudget);
    assert.equal(grown.preparedVoices, request.voiceBudget); assert.equal(grown.requestedVoices, 510);
    assert.deepEqual(grown.parameters, nextParameters); assert.ok(grown.buildRevision > before.buildRevision);
    assert.equal(grown.status.targetVoices, grown.eligibleVoices); assert.equal(grown.status.voiceLimit, grown.eligibleVoices);
    assert.equal(grown.nextSceneCapacity, request.voiceBudget);
    assert.equal(grown.audio, true); assert.equal(grown.input.playing, true); assert.equal(grown.sampleClock, 4);
    assert.equal(grown.capacityFailure, null); assert.deepEqual(f.errors, []);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    const installs = f.worklets[0].messages.filter(message => message.type === 'install');
    assert.equal(installs.length, 2); assert.ok(installs.every(message => message.wholeSceneAdmission === true));
    await sustainedHeadroom(f, 12);
    assert.equal(f.compileRequests.length, 2, 'proved additional headroom still waits for another explicit scene');
    assert.equal(engine.getDiagnostics().buildRevision, grown.buildRevision);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 2);
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

test('real audio backoff changes the next scene budget without rebuilding or expanding the current tree', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0];
    f.load = f.peak = .8;
    await sustainedHeadroom(f);
    const proposal = engine.getDiagnostics().nextSceneCapacity, budget = before.deviceCapacity.preparedCapacity;
    assert.ok(proposal > 64 && proposal < 64 * 1.2, 'busy audio proposes only part of its remaining headroom');
    assert.equal(f.compileRequests.length, 1, 'the proposal cannot expand the current tree');
    const installedMessages = f.worklets[0].messages.filter(message => message.type === 'install').length;
    // Rust can reduce actual processing without rewriting or freeing the
    // prepared pool. Alternate rejected admission and healthy partial work.
    for (let index = 0; index < 80; index++) {
      f.active = 48; f.calibrationProof = 48;
      f.load = f.peak = index % 8 === 0 ? 1.1 : .6;
      if (index % 8 === 0) f.deadlineMisses++;
      f.now += .25; await engine.request('/api/status');
      assert.equal(engine.getDiagnostics().deviceCapacity.preparedCapacity, budget);
      assert.equal(engine.getDiagnostics().buildRevision, before.buildRevision);
      assert.equal(engine.getDiagnostics().nextSceneCapacity, 48, 'a deadline-rejected plan is not reused on the next preset');
      assert.equal(engine.getDiagnostics().status.activeVoices, 48, 'actual processing remains separate from prepared capacity');
    }
    assert.equal(f.compileRequests.length, 1);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, installedMessages);
    assert.deepEqual(engine.getDiagnostics().parameters, before.parameters);
    // Bounded playback never restores rejected voices in this same scene.
    // A new explicit scene first adopts the reduced proven budget; only that
    // complete newly admitted pool can prove headroom for a subsequent scene.
    const safe = await engine.request('/api/parameters', { ...before.parameters, angle: before.parameters.angle + 7 });
    assert.equal(f.compileRequests.at(-1).voiceBudget, 48);
    assert.equal(safe.preparedVoices, 48); assert.equal(safe.status.targetVoices, 48);
    const safeRevision = safe.topologyRevision, safeInstalls = f.worklets[0].messages.filter(message => message.type === 'install').length;
    f.load = f.peak = .4;
    await engine.request('/api/status');
    await sustainedHeadroom(f);
    assert.ok(engine.getDiagnostics().nextSceneCapacity > 48, 'fresh full-pool proof proposes more for a subsequent explicit scene');
    assert.equal(engine.getDiagnostics().deviceCapacity.preparedCapacity, 48);
    assert.equal(engine.getDiagnostics().buildRevision, safeRevision);
    assert.equal(engine.getDiagnostics().status.targetVoices, 48);
    assert.equal(f.compileRequests.length, 2);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, safeInstalls);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.stopped, undefined); assert.equal(engine.getDiagnostics().input.playing, true);
    assert.ok(engine.getDiagnostics().sampleClock > before.sampleClock); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('a manual voice ceiling after a scene deadline miss cannot become the next device budget', async () => {
  const f = fixture();
  try {
    await f.start();
    const engine = f.engine, before = engine.getDiagnostics(), source = f.sources[0], buffer = source.buffer;
    assert.equal(before.nextSceneCapacity, 64); assert.equal(before.status.voiceLimit, 64);
    // A real past deadline warning can remain in cumulative telemetry after
    // the complete scene is processing normally. It must not make a subsequent
    // deliberate two-voice ceiling look like new evidence of device backoff.
    f.deadlineMisses++; f.now += .25;
    await engine.request('/api/status');
    assert.equal(engine.getDiagnostics().nextSceneCapacity, 64);
    await engine.request('/api/performance', { voiceCeiling: 2, automatic: true });
    assert.equal(f.autoDemand, 2);
    for (let index = 0; index < 4; index++) {
      f.now += .25; await engine.request('/api/status');
      const capped = engine.getDiagnostics();
      assert.equal(capped.status.deadlineMisses, 1);
      assert.equal(capped.status.voiceLimit, 2); assert.equal(capped.status.targetVoices, 2);
      assert.equal(capped.nextSceneCapacity, 64, 'meeting the manual capped demand is not a failed device plan');
      assert.equal(capped.deviceCapacity.preparedCapacity, 64); assert.equal(capped.preparedVoices, 64);
      assert.equal(capped.buildRevision, before.buildRevision);
    }
    await engine.request('/api/performance', { voiceCeiling: 0 });
    const restored = await engine.request('/api/status');
    assert.equal(f.autoDemand, 64); assert.equal(restored.status.voiceLimit, 64);
    assert.equal(restored.status.targetVoices, 64); assert.equal(restored.preparedVoices, 64);
    assert.equal(engine.getDiagnostics().nextSceneCapacity, 64);
    assert.equal(f.compileRequests.length, 1);
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, 1);
    const recalled = await engine.request('/api/parameters', { ...before.parameters, angle: before.parameters.angle + 7 });
    assert.equal(f.compileRequests.at(-1).voiceBudget, 64, 'the next explicit preset inherits device proof, not the temporary ceiling');
    assert.equal(f.compileRequests.at(-1).validateCapacity, false);
    assert.equal(recalled.preparedVoices, 64); assert.equal(recalled.status.targetVoices, 64);
    assert.equal(recalled.performance.voiceCeiling, 0);
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(source.buffer, buffer); assert.equal(source.stopped, undefined);
    assert.equal(recalled.audio, true); assert.equal(recalled.input.playing, true); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});
