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
function fixture() {
  const originals = new Map(), engines = [], contexts = [], worklets = [], workers = [], sources = [], errors = [], updates = [];
  const f = { contexts, worklets, workers, sources, errors, updates, captureCalls: 0, fetchCalls: 0, statusReplies: [], holdStatus: false,
    capture: async () => microphone(), decode: async () => pcm(), fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) };
  function replace(key, value) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  class Node { connect(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  class Context extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
    createGain() { const node = new Node(); node.gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } }; return node; }
    createBuffer(channels, length, rate) { return pcm(channels, length, rate); }
    decodeAudioData(bytes) { return f.decode(bytes); }
    createMediaStreamSource(stream) { const node = new Node(); node.stream = stream; return node; }
    createBufferSource() { const node = new Node(); node.stop = () => { node.stopped = true; }; node.start = () => { node.started = true; }; sources.push(node); return node; }
  }
  class Worker {
    constructor() { workers.push(this); }
    postMessage(data) { queueMicrotask(() => this.onmessage?.({ data: { id: data.id, revision: data.revision, module: {}, pool: new ArrayBuffer(32),
      result: { parameters: data.parameters, nodes: [], requestedVoices: 14, eligibleVoices: 14 } } })); }
    terminate() { this.terminated = true; }
  }
  class Worklet extends Node {
    constructor() { super(); worklets.push(this); this.messages = [];
      this.port = { postMessage: data => { this.messages.push(data); if (data.id) {
        const reply = () => this.port.onmessage?.({ data: { id: data.id, status: { elapsedSeconds: 1, inputPeak: .1, outputPeak: .2, processedBlocks: 4 } } });
        if (f.holdStatus && data.type === 'status') f.statusReplies.push(reply); else queueMicrotask(reply);
      } }, close: () => { this.port.closed = true; } };
      queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } }));
    }
  }
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
