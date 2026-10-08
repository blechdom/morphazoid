import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserDelayEngine } from '../src/instruments/micmic/native/browser-engine.js';
import { DEFAULT_MASTERING } from '../src/instruments/micmic/native/mastering.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 30; i++) { if (predicate()) return; await tick(); } throw new Error('Fixture did not reach its expected boundary'); }
function pcm(channels = 1, frames = 128, rate = 48000) {
  const data = Array.from({ length: channels }, () => Float32Array.from({ length: frames }, (_, i) => Math.sin(i) * .1));
  return { numberOfChannels: channels, length: frames, sampleRate: rate, getChannelData: channel => data[channel] };
}
const file = name => ({ name, size: 8, arrayBuffer: async () => new ArrayBuffer(8) });
const POOL_VOICES = 14, POOL_HEADER_BYTES = 32, POOL_RECORD_BYTES = 48;
const POOL_BYTES = POOL_HEADER_BYTES + POOL_VOICES * POOL_RECORD_BYTES;
function compiledPool(parameters, revision, provenance) {
  const pool = new ArrayBuffer(POOL_BYTES), values = new DataView(pool);
  values.setUint32(0, 0x4c534431, true); values.setUint32(4, 2, true);
  values.setUint32(8, POOL_VOICES, true); values.setUint32(12, POOL_VOICES, true);
  values.setUint32(16, revision >>> 0, true); values.setUint32(20, Math.floor(revision / 2 ** 32), true);
  values.setFloat64(24, 1, true);
  for (let index = 0; index < POOL_VOICES; index++) {
    const offset = POOL_HEADER_BYTES + index * POOL_RECORD_BYTES, generation = index % 3 + 1;
    values.setFloat64(offset, parameters.intervalMs / 1000 * (index + 1) / POOL_VOICES, true);
    values.setFloat64(offset + 8, 1 + index / 20, true);
    values.setFloat64(offset + 16, parameters.depth > 0 ? .5 * parameters.depth ** (generation * .72) : 0, true);
    values.setFloat64(offset + 24, (index % 5) / 4 - .5, true);
    values.setUint32(offset + 32, index, true);
    values.setUint32(offset + 36, provenance * POOL_VOICES + index, true);
    values.setUint32(offset + 40, generation, true);
  }
  return pool;
}
function fixture() {
  const originals = new Map(), engines = [], contexts = [], worklets = [], workers = [], sources = [], errors = [], updates = [];
  const f = { contexts, worklets, workers, sources, errors, updates, captureCalls: 0, fetchCalls: 0, statusReplies: [], holdStatus: false,
    compileRequests: [], compileReplies: [], compilePools: [], holdCompile: false, holdInstall: false, installReplies: [],
    holdSuspend: false, suspendReplies: [], holdDrain: false, drainReplies: [],
    workletStatus: { elapsedSeconds: 1, inputPeak: .1, outputPeak: .2, processedBlocks: 4 },
    capture: async () => microphone(), decode: async () => pcm(), fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) };
  function replace(key, value) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  class Node { connect(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  class Context extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; f.flushInstallReplies(); }
    async suspend() {
      if (f.holdSuspend) {
        const pending = deferred(); f.suspendReplies.push(() => { this.state = 'suspended'; pending.resolve(); }); return pending.promise;
      }
      this.state = 'suspended';
    }
    async close() { this.state = 'closed'; }
    createGain() { const node = new Node(); node.gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } }; return node; }
    createBuffer(channels, length, rate) { return pcm(channels, length, rate); }
    decodeAudioData(bytes) { return f.decode(bytes); }
    createMediaStreamSource(stream) { const node = new Node(); node.stream = stream; return node; }
    createBufferSource() { const node = new Node(); node.stop = () => { node.stopped = true; }; node.start = () => { node.started = true; }; sources.push(node); return node; }
  }
  class Worker {
    constructor() { workers.push(this); }
    postMessage(data) {
      f.compileRequests.push(data);
      const retainedPool = compiledPool(data.parameters, data.revision, f.compilePools.length + 1); f.compilePools.push(retainedPool);
      const reply = () => this.onmessage?.({ data: { id: data.id, revision: data.revision, module: {}, pool: retainedPool,
        result: { parameters: data.parameters, nodes: [], requestedVoices: POOL_VOICES, eligibleVoices: data.parameters.depth ? POOL_VOICES : 0,
          structuralEligibleVoices: POOL_VOICES } } });
      if (f.holdCompile) f.compileReplies.push(reply); else queueMicrotask(reply);
    }
    terminate() { this.terminated = true; }
  }
  class Worklet extends Node {
    constructor() { super(); worklets.push(this); this.messages = []; this.transferInputs = []; this.context = contexts.at(-1);
      this.port = { postMessage: (data, transfers = []) => {
        if (data.type === 'install') this.transferInputs.push(data.pool);
        if (transfers.length) data = structuredClone(data, { transfer: transfers });
        this.messages.push(data); if (data.id) {
        const status = { ...f.workletStatus };
        const reply = () => this.port.onmessage?.({ data: { id: data.id, status } });
        if (data.type === 'install' && (f.holdInstall || this.context.state !== 'running')) f.installReplies.push({ context: this.context, reply });
        else if (f.holdDrain && data.type === 'drain') f.drainReplies.push(reply);
        else if (f.holdStatus && data.type === 'status') f.statusReplies.push(reply); else queueMicrotask(reply);
      } }, close: () => { this.port.closed = true; } };
      queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } }));
    }
  }
  f.flushInstallReplies = () => {
    if (f.holdInstall) return;
    const ready = f.installReplies.filter(item => item.context.state === 'running');
    f.installReplies = f.installReplies.filter(item => item.context.state !== 'running');
    for (const item of ready) queueMicrotask(item.reply);
  };
  replace('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  replace('AudioContext', Context); replace('AudioWorkletNode', Worklet); replace('Worker', Worker);
  replace('navigator', { mediaDevices: { getUserMedia: async () => { f.captureCalls++; return f.capture(); } } });
  replace('fetch', async (...args) => { f.fetchCalls++; return f.fetch(...args); });
  f.engine = () => { const engine = createBrowserDelayEngine({ onStatus: reply => updates.push(reply), onError: error => errors.push(error) }); engines.push(engine); return engine; };
  f.cleanup = () => { for (const engine of engines) engine.dispose(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
  return f;
}
function microphone() {
  const track = { stopped: false, label: 'Fixture mic', stop() { this.stopped = true; }, getSettings: () => ({ channelCount: 1 }), addEventListener() {} };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

test('muted control cleanup finishes retired storage before a repeated departure can suspend its callbacks', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    engine.muteForDeparture(); await tick();
    const context = f.contexts[0], initial = engine.getDiagnostics();
    assert.equal(context.state, 'suspended'); f.holdDrain = true;
    const edited = engine.request('/api/parameters', { ...initial.parameters, generations: initial.parameters.generations + 1 });
    await until(() => f.drainReplies.length === 1);
    assert.equal(context.state, 'running', 'the prepared graph stays muted but processes its bounded cleanup');
    assert.equal(engine.getDiagnostics().audio, false);
    engine.muteForDeparture(); await tick();
    assert.equal(context.state, 'running', 'another departure cannot strand the pending drain acknowledgement');
    f.drainReplies.shift()(); const result = await edited;
    assert.equal(result.parameters.generations, initial.parameters.generations + 1);
    assert.equal(context.state, 'suspended');
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
    assert.equal(f.captureCalls, 0); assert.equal(f.sources[0].stopped, true);
  } finally { f.cleanup(); }
});

test('a suspended muted graph completes a staged preset edit without arming Audio or input', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio(); engine.muteForDeparture();
    const context = f.contexts[0], original = engine.getDiagnostics();
    assert.equal(context.state, 'suspended');
    const reply = await engine.request('/api/parameters', { ...original.parameters, angle: 83 });
    assert.equal(reply.parameters.angle, 83); assert.equal(reply.audio, false);
    assert.equal(context.state, 'suspended', 'the temporary muted control render ends after its ACK');
    assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1);
    assert.equal(f.captureCalls, 0); assert.equal(f.sources.length, 0);
    assert.equal(engine.getDiagnostics().connectionCount, 1);
  } finally { f.cleanup(); }
});

test('departure during compilation and staged installation cannot strand the control ACK', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio(); const context = f.contexts[0];
    f.holdCompile = true;
    const compiling = engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 76 });
    await until(() => f.compileReplies.length === 1);
    document.hidden = true; engine.muteForDeparture(); assert.equal(context.state, 'suspended');
    f.compileReplies.shift()(); await compiling;
    assert.equal(context.state, 'suspended'); assert.equal(engine.getDiagnostics().audio, false);

    document.hidden = false; await engine.prepareAudio(); f.holdCompile = false; f.holdInstall = true;
    const installing = engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 91 });
    await until(() => f.installReplies.length === 1);
    document.hidden = true; engine.muteForDeparture();
    assert.equal(context.state, 'running', 'the muted graph remains available until its pending install commits');
    f.holdInstall = false; f.flushInstallReplies(); const reply = await installing;
    assert.equal(reply.parameters.angle, 91); assert.equal(reply.audio, false);
    assert.equal(context.state, 'suspended'); assert.equal(f.captureCalls, 0);
  } finally { f.cleanup(); }
});

test('a compilation finishing while departure suspension settles resumes its muted install safely', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio(); const context = f.contexts[0];
    f.holdCompile = true; f.holdSuspend = true;
    const pending = engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 62 });
    await until(() => f.compileReplies.length === 1);
    const installs = f.worklets[0].messages.filter(message => message.type === 'install').length;
    document.hidden = true; engine.muteForDeparture(); assert.equal(f.suspendReplies.length, 1);
    f.compileReplies.shift()(); await tick();
    assert.equal(f.worklets[0].messages.filter(message => message.type === 'install').length, installs);
    f.holdSuspend = false; f.suspendReplies.shift()(); const reply = await pending;
    assert.equal(reply.parameters.angle, 62); assert.equal(reply.audio, false);
    assert.equal(context.state, 'suspended'); assert.equal(f.captureCalls, 0);
  } finally { f.cleanup(); }
});

test('departure while the initial pool is staging still finishes startup muted and suspended', async () => {
  const f = fixture(); try {
    const engine = f.engine(); f.holdInstall = true; const pending = engine.prepareAudio();
    await until(() => f.installReplies.length === 1);
    document.hidden = true; engine.muteForDeparture();
    assert.equal(f.contexts[0].state, 'running');
    f.holdInstall = false; f.flushInstallReplies(); await pending;
    assert.equal(f.contexts[0].state, 'suspended'); assert.equal(engine.getDiagnostics().audio, false);
    assert.equal(f.captureCalls, 0); assert.equal(f.sources.length, 0);
  } finally { f.cleanup(); }
});

test('a newer explicit microphone action also wins while automatic re-suspension settles', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio(); engine.muteForDeparture();
    const context = f.contexts[0]; f.holdSuspend = true;
    const pending = engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 108 });
    await until(() => f.suspendReplies.length === 1);
    await engine.setMicrophoneEnabled(true); f.holdSuspend = false; f.suspendReplies.shift()(); await pending;
    assert.equal(context.state, 'running'); assert.equal(engine.getDiagnostics().microphoneEnabled, true);
    assert.equal(engine.getDiagnostics().audio, false); assert.equal(f.captureCalls, 1);
  } finally { f.cleanup(); }
});

for (const action of ['Audio', 'Mic']) test(`a newer explicit ${action} action retains its running graph after an older control install`, async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio(); engine.muteForDeparture();
    const context = f.contexts[0]; f.holdInstall = true;
    const pending = engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 67 });
    await until(() => f.installReplies.length === 1);
    assert.equal(context.state, 'running');
    if (action === 'Audio') await engine.request('/api/audio', { enabled: true });
    else await engine.setMicrophoneEnabled(true);
    f.holdInstall = false; f.flushInstallReplies(); await pending;
    const reply = engine.getDiagnostics();
    assert.equal(context.state, 'running'); assert.equal(reply.microphoneEnabled, true);
    assert.equal(reply.audio, action === 'Audio'); assert.equal(f.captureCalls, 1);
    assert.equal(f.worklets.length, 1); assert.equal(f.contexts.length, 1);
  } finally { f.cleanup(); }
});

test('pool transfers detach only the delivery copy and retain cached bytes for graph recovery', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.prepareAudio();
    await engine.request('/api/parameters', { ...engine.getDiagnostics().parameters, angle: 94 });
    const retained = f.compilePools.at(-1), before = [...new Uint8Array(retained)];
    assert.equal(retained.byteLength, POOL_BYTES);
    assert.equal(new DataView(retained).getUint32(4, true), 2);
    assert.equal(new DataView(retained).getUint32(8, true), POOL_VOICES);
    assert.notDeepEqual(before, [...new Uint8Array(f.compilePools.at(-2))], 'compiled scenes retain distinct byte provenance');
    assert.ok(f.worklets[0].transferInputs.every(pool => pool.byteLength === 0), 'each actual delivery buffer is transferred');
    assert.ok(f.worklets[0].messages.filter(message => message.type === 'install').every(message => message.pool.byteLength === POOL_BYTES));
    f.worklets[0].onprocessorerror(); await engine.prepareAudio();
    assert.equal(f.worklets.length, 2); assert.equal(retained.byteLength, POOL_BYTES);
    assert.deepEqual([...new Uint8Array(retained)], before);
    assert.deepEqual([...new Uint8Array(f.worklets[1].messages.find(message => message.type === 'install').pool)], before);
    assert.equal(f.worklets[1].transferInputs[0].byteLength, 0);
  } finally { f.cleanup(); }
});

test('live recursion and mix bypass a pending structural compile and its eventual pool retains the latest recursion', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    const initial = engine.getDiagnostics(), compilationCount = f.compileRequests.length;
    f.holdCompile = true;
    const structural = engine.request('/api/parameters', { ...initial.parameters, angle: 71 });
    await until(() => f.compileReplies.length === 1);
    const muted = await engine.request('/api/depth', { depth: 0 });
    assert.equal(muted.parameters.depth, 0); assert.equal(muted.eligibleVoices, 0);
    const resumed = await engine.request('/api/depth', { depth: .91 });
    assert.equal(resumed.parameters.depth, .91); assert.equal(resumed.eligibleVoices, 14);
    const mixed = await engine.request('/api/performance', { wet: .37, dry: .12 });
    assert.equal(mixed.performance.wet, .37); assert.equal(mixed.performance.dry, .12);
    assert.equal(f.compileRequests.length, compilationCount + 1, 'coefficient changes compile no tree');
    assert.equal(mixed.parameters.angle, initial.parameters.angle, 'published topology stays committed until installed');
    f.compileReplies.shift()(); const committed = await structural;
    assert.equal(committed.parameters.angle, 71); assert.equal(committed.parameters.depth, .91);
    assert.equal(f.worklets[0].messages.filter(m => m.type === 'depth').at(-1).depth, .91,
      'the old compile cannot restore its captured recursion coefficient');
    assert.equal(committed.performance.wet, .37); assert.equal(committed.performance.dry, .12);
    assert.equal(committed.audio, true); assert.equal(f.contexts.length, 1); assert.equal(f.worklets.length, 1); assert.equal(f.sources.length, 1);
  } finally { f.cleanup(); }
});

test('a newer structural request discards an obsolete compiled pool before touching the audio thread', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    const initial = engine.getDiagnostics(), installs = f.worklets[0].messages.filter(m => m.type === 'install').length;
    f.holdCompile = true;
    const older = engine.request('/api/parameters', { ...initial.parameters, angle: 63 });
    await until(() => f.compileReplies.length === 1);
    const newer = engine.request('/api/parameters', { ...initial.parameters, angle: 97, depth: .83 });
    await tick(); f.compileReplies.shift()(); await older;
    await until(() => f.compileReplies.length === 1);
    assert.equal(f.worklets[0].messages.filter(m => m.type === 'install').length, installs);
    f.compileReplies.shift()(); const result = await newer;
    assert.equal(result.parameters.angle, 97); assert.equal(result.parameters.depth, .83);
    assert.equal(f.worklets[0].messages.filter(m => m.type === 'install').length, installs + 1);
  } finally { f.cleanup(); }
});

test('visual sample time follows the audio clock through delayed and duplicate status replies and graph recovery', async () => {
  const f = fixture(); try {
    const engine = f.engine(); assert.equal(engine.getSampleTime(), null);
    await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    assert.equal(engine.getSampleTime(), null, 'unpaired constructor or legacy status cannot calibrate a clock');
    const context = f.contexts[0]; context.currentTime = 11;
    f.workletStatus = { ...f.workletStatus, elapsedSeconds: 2, audioTimeSeconds: 10.75 };
    f.holdStatus = true;
    const pending = engine.request('/api/status'); await until(() => f.statusReplies.length === 1);
    context.currentTime = 11.2; f.statusReplies.shift()(); await pending;
    assert.ok(Math.abs(engine.getSampleTime() - 2.45) < 1e-12, 'message delivery lag does not become wave phase lag');
    const duplicate = engine.request('/api/status'); await until(() => f.statusReplies.length === 1);
    context.currentTime = 11.4; f.statusReplies.shift()(); await duplicate;
    assert.ok(Math.abs(engine.getSampleTime() - 2.65) < 1e-12, 'the same packet cannot move the sample clock backwards');
    await context.suspend(); const frozen = engine.getSampleTime(); await tick(); assert.equal(engine.getSampleTime(), frozen);
    f.worklets[0].onprocessorerror(); assert.equal(engine.getSampleTime(), null, 'failed graph retires its clock anchor');
    f.holdStatus = false; f.workletStatus = { ...f.workletStatus, elapsedSeconds: 0, audioTimeSeconds: null, processedBlocks: 0 };
    await engine.request('/api/audio', { enabled: true }); assert.equal(engine.getSampleTime(), null);
    f.contexts[1].currentTime = .3; f.workletStatus = { ...f.workletStatus, elapsedSeconds: .1, audioTimeSeconds: .2, processedBlocks: 1 };
    await engine.request('/api/status'); assert.ok(Math.abs(engine.getSampleTime() - .2) < 1e-12, 'fresh graph has an independent clock');
    engine.dispose(); assert.equal(engine.getSampleTime(), null);
  } finally { f.cleanup(); }
});

test('mode and sample selection while Audio is off never prepares a graph or requests capture', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.setSample('music-bass');
    await engine.restartInput(); assert.equal(f.contexts.length, 0); assert.equal(f.fetchCalls, 0); assert.equal(f.captureCalls, 0);
    const reply = await engine.request('/api/state'); assert.equal(reply.input.mode, 'samples'); assert.equal(reply.audio, false);
  } finally { f.cleanup(); }
});
test('file upload prepares muted input, Audio plays the same worklet path and gain settings survive selection', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.request('/api/performance', { inputGain: 4, level: 0, mastering: { ...DEFAULT_MASTERING, makeupDb: 24 } });
    const loaded = await engine.loadFile(file('voice.wav')); assert.equal(loaded.audio, false); assert.equal(f.sources.length, 0);
    assert.equal(f.captureCalls, 0); assert.equal(loaded.input.hasFile, true);
    const playing = await engine.request('/api/audio', { enabled: true });
    assert.equal(playing.audio, true); assert.equal(playing.input.playing, true); assert.equal(f.sources[0].target, f.worklets[0]);
    assert.equal(playing.performance.source, 'mic'); assert.equal(playing.performance.inputGain, 4); assert.equal(playing.performance.level, 0); assert.equal(playing.performance.mastering.makeupDb, 24);
    await engine.setInputMode('samples'); assert.equal(f.sources[0].stopped, true); assert.equal(f.captureCalls, 0);
    assert.equal(f.sources.at(-1).target, f.worklets[0]); assert.equal(f.sources.length, 2);
    await engine.request('/api/audio', { enabled: false }); assert.equal(f.sources[1].stopped, true); assert.equal(engine.getDiagnostics().input.playing, false);
  } finally { f.cleanup(); }
});
test('selected file with no upload keeps already armed output and never requests a microphone', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    const reply = await engine.setInputMode('file'); assert.equal(reply.audio, true); assert.equal(reply.input.playing, false);
    assert.equal(reply.input.label, 'Choose an audio file'); assert.equal(f.captureCalls, 0); assert.equal(f.sources[0].stopped, true);
  } finally { f.cleanup(); }
});
test('explicit microphone action still meters while output is muted and mode switching releases it', async () => {
  const f = fixture(), stream = microphone(); f.capture = async () => stream;
  try {
    const engine = f.engine(), reply = await engine.setMicrophoneEnabled(true);
    assert.equal(reply.audio, false); assert.equal(reply.input.mode, 'mic'); assert.equal(reply.input.playing, true);
    assert.equal(reply.status.outputPeak, 0);
    const metered = await engine.request('/api/status'); assert.equal(metered.status.inputPeak, .1); assert.equal(metered.status.outputPeak, 0);
    await engine.setInputMode('file'); assert.equal(stream.track.stopped, true); assert.equal(engine.getDiagnostics().audio, false);
  } finally { f.cleanup(); }
});
test('a delayed worklet status reply always contains the current source selection', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setMicrophoneEnabled(true); f.holdStatus = true;
    const status = engine.request('/api/status'); await until(() => f.statusReplies.length === 1);
    await engine.setInputMode('samples'); f.statusReplies[0](); const reply = await status;
    assert.equal(reply.input.mode, 'samples'); assert.equal(f.updates.at(-1).input.mode, 'samples'); assert.equal(reply.input.playing, false);
  } finally { f.cleanup(); }
});
test('late microphone grant is released when an explicit Audio start switches to samples', async () => {
  const f = fixture(), permission = deferred(), stream = microphone(); f.capture = () => permission.promise;
  try {
    const engine = f.engine(), armed = engine.request('/api/audio', { enabled: true }); await until(() => f.captureCalls === 1);
    await engine.setInputMode('samples'); await armed; permission.resolve(stream); await tick(); const reply = engine.getDiagnostics();
    assert.equal(stream.track.stopped, true); assert.equal(reply.input.mode, 'samples'); assert.equal(reply.input.playing, true);
    assert.equal(reply.audio, true); assert.equal(reply.status.microphoneEnabled, false); assert.equal(f.sources.length, 1);
  } finally { f.cleanup(); }
});
test('late microphone denial cannot mute or fault the replacement sample session', async () => {
  const f = fixture(), permission = deferred(); f.capture = () => permission.promise;
  try {
    const engine = f.engine(), armed = engine.request('/api/audio', { enabled: true }); await until(() => f.captureCalls === 1);
    await engine.setInputMode('samples'); await armed; permission.reject(new Error('Old permission denied')); await tick(); const reply = engine.getDiagnostics();
    assert.equal(reply.audio, true); assert.equal(reply.input.playing, true); assert.equal(reply.error, null); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});
test('changing a pending microphone Audio start completes without waiting for the obsolete grant, and Stop wins', async () => {
  const f = fixture(), permission = deferred(), stream = microphone(); f.capture = () => permission.promise;
  try {
    const engine = f.engine(), armed = engine.request('/api/audio', { enabled: true }); await until(() => f.captureCalls === 1);
    await engine.setInputMode('samples'); const ready = await armed;
    assert.equal(ready.audio, true, 'explicit Audio arm no longer waits for the obsolete device prompt');
    engine.stopInput(); permission.resolve(stream); await tick();
    assert.equal(stream.track.stopped, true); assert.equal(engine.getDiagnostics().input.playing, false);
    assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stopped, true);
  } finally { f.cleanup(); }
});
test('a cancelled explicit microphone action settles promptly and releases its eventual grant', async () => {
  const f = fixture(), permission = deferred(), stream = microphone(); f.capture = () => permission.promise;
  try {
    const engine = f.engine(), capture = engine.setMicrophoneEnabled(true); await until(() => f.captureCalls === 1);
    await engine.setInputMode('file'); const reply = await capture;
    assert.equal(reply.input.mode, 'file'); assert.equal(reply.status.microphonePending, false); assert.equal(reply.audio, false);
    permission.resolve(stream); await tick(); assert.equal(stream.track.stopped, true); assert.equal(engine.getDiagnostics().status.microphoneEnabled, false);
  } finally { f.cleanup(); }
});
test('successful upload independently clears input errors while stale completions cannot clear a newer failure', async () => {
  const f = fixture(), first = deferred(); let decodes = 0;
  f.decode = () => ++decodes === 1 ? first.promise : Promise.reject(new Error('Current file cannot decode'));
  try {
    const engine = f.engine(), old = engine.loadFile(file('old.wav')); await tick(); await tick();
    await assert.rejects(engine.loadFile(file('bad.wav')), /Current file cannot decode/);
    first.resolve(pcm()); await old; assert.match(engine.getDiagnostics().error, /Current file cannot decode/);
    f.decode = async () => pcm(); const repaired = await engine.loadFile(file('fixed.wav'));
    assert.equal(repaired.error, null); assert.equal(f.updates.at(-1).error, null); assert.equal(repaired.input.hasFile, true);
  } finally { f.cleanup(); }
});
test('Audio off and stopInput invalidate pending file decode without late playback', async () => {
  const f = fixture(), decoded = deferred(); f.decode = () => decoded.promise;
  try {
    const engine = f.engine(), loading = engine.loadFile(file('pending.wav')); await until(() => engine.getDiagnostics().input.pending);
    await tick(); await engine.request('/api/audio', { enabled: false }); decoded.resolve(pcm()); const reply = await loading;
    assert.equal(reply.audio, false); assert.equal(reply.input.pending, false); assert.equal(f.sources.length, 0);
    f.decode = async () => pcm(); await engine.request('/api/audio', { enabled: true }); assert.equal(f.sources.length, 1);
    const stopped = engine.stopInput(); assert.equal(stopped.audio, true); assert.equal(stopped.input.playing, false); assert.equal(f.sources[0].stopped, true);
  } finally { f.cleanup(); }
});
test('worklet fault stops a file source and explicit recovery retains file, mode and live controls', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.loadFile(file('keep.wav')); await engine.setInputLoop(false);
    await engine.request('/api/audio', { enabled: true }); f.worklets[0].onprocessorerror();
    const failed = engine.getDiagnostics(); assert.equal(failed.audio, false); assert.equal(failed.input.playing, false);
    assert.equal(failed.input.hasFile, true); assert.equal(f.sources[0].stopped, true); assert.equal(f.contexts[0].state, 'closed');
    const reply = await engine.request('/api/audio', { enabled: true }); assert.equal(reply.input.mode, 'file'); assert.equal(reply.input.loop, false);
    assert.equal(reply.audio, true); assert.equal(f.worklets.length, 2); assert.equal(f.sources[1].target, f.worklets[1]); assert.equal(f.captureCalls, 0);
  } finally { f.cleanup(); }
});
test('departure releases file/sample playback and reselecting or restarting while hidden never arms it', async () => {
  const f = fixture(); try {
    const engine = f.engine(); await engine.setInputMode('samples'); await engine.request('/api/audio', { enabled: true });
    document.hidden = true; engine.muteForDeparture(); assert.equal(f.sources[0].stopped, true);
    await engine.setSample('birdsong'); await engine.restartInput(); assert.equal(f.sources.length, 1); assert.equal(engine.getDiagnostics().audio, false);
    document.hidden = false; await engine.setSample('music-keys'); assert.equal(f.sources.length, 1);
    await engine.request('/api/audio', { enabled: true }); assert.equal(f.sources.length, 2); assert.equal(f.captureCalls, 0);
  } finally { f.cleanup(); }
});
