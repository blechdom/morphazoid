import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthesisAudio } from '../src/instruments/synthesis/audio.js';

class Node {
  connections = [];
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; }
}
class Context {
  state = 'running'; currentTime = 7; destination = new Node();
  audioWorklet = { addModule: async () => {} };
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createGain() { const node = new Node(); node.gain = { value: 1, setTargetAtTime(value) { this.value = value; } }; return node; }
  createAnalyser() { return new Node(); }
}
class Worklet extends Node {
  static instances = [];
  static failConnection = false;
  port = { messages: [], postMessage(message) { this.messages.push(message); }, close() { this.closed = true; } };
  constructor() { super(); Worklet.instances.push(this); }
  connect(target) { if (Worklet.failConnection) { Worklet.failConnection = false; throw Error('Graph connection failed.'); } return super.connect(target); }
  emit(data) { this.port.onmessage?.({ data }); }
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const failure of ['initialization', 'message', 'processorerror', 'graph']) test(`Audio recovers from ${failure} failure without replacing the host graph or losing transport`, async () => {
  const keys = ['AudioContext', 'AudioWorkletNode', 'fetch'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  globalThis.AudioContext = Context;
  globalThis.AudioWorkletNode = Worklet;
  Worklet.failConnection = failure === 'graph';
  // Valid empty WASM is sufficient: this test exercises graph ownership, not DSP.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0,97,115,109,1,0,0,0]).buffer });
  const errors = [], audio = new SynthesisAudio(error => errors.push(error));
  let now = 100;
  audio.sequenceNow = () => now;
  audio.configure({ methodId: 'fm', outputLevel: .6 });
  audio.setPlaying(true);
  audio.setSequence({ studyId: 'recovery', tempo: 120, lengthBeats: 4, steps: [] });
  audio.sequencePlaying = true; audio.sequencePhase = 2; audio.sequenceEpoch = now;
  try {
    const count = Worklet.instances.length, startup = audio.start();
    const rejected = ['initialization', 'graph'].includes(failure) ? assert.rejects(startup, /Enable Audio to restart/) : null;
    // WASM compilation also passes through the event loop on its first load.
    for (let i = 0; Worklet.instances.length === count && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
    const old = Worklet.instances.at(-1);
    assert.ok(old);
    const oldMessage = old.port.onmessage, oldError = old.onprocessorerror;
    const context = audio.context, master = audio.master, input = audio.input.analyser, output = audio.analyser;
    const outputConnections = [...master.connections];
    if (!rejected) { old.emit({ type: 'ready' }); await startup; }
    if (failure === 'processorerror') old.onprocessorerror();
    else if (failure !== 'graph') old.emit({ type: 'error', message: 'Test engine failure.' });
    if (rejected) await rejected;
    assert.equal(audio.armed, false); assert.equal(audio.node, null);
    assert.equal(audio.nodeReady, null); assert.equal(old.port.closed, true);
    assert.deepEqual(old.connections, []); assert.deepEqual(input.connections, []);
    assert.equal(audio.playing, true); assert.equal(audio.sequencePlaying, true);
    assert.equal(errors.length, 1); assert.match(errors[0].message, /no page refresh/);
    now = 103;
    const retry = audio.start(); await tick();
    const replacement = audio.node; assert.ok(replacement); assert.notEqual(replacement, old);
    assert.equal(audio.context, context); assert.equal(audio.master, master);
    assert.equal(audio.input.analyser, input); assert.equal(audio.analyser, output);
    assert.deepEqual(master.connections, outputConnections, 'retry does not double-connect output');
    assert.deepEqual(input.connections, [replacement]);
    oldMessage?.({ data: { type: 'ready' } }); oldError?.();
    oldMessage?.({ data: { type: 'error', message: 'Late stale error' } });
    oldMessage?.({ data: { type: 'sequence-status', intent: audio.sequenceIntent, playing: false, beat: 999 } });
    assert.equal(audio.armed, false, 'a stale ready cannot arm the replacement');
    assert.equal(audio.node, replacement); assert.equal(errors.length, 1);
    replacement.emit({ type: 'ready' }); await retry;
    assert.equal(audio.armed, true); assert.equal(master.gain.value, .6);
    const messages = replacement.port.messages;
    assert.ok(messages.some(message => message.type === 'state' && message.state.methodId === 'fm'));
    assert.ok(messages.some(message => message.type === 'play' && message.playing));
    const sequence = messages.find(message => message.type === 'sequence-load');
    assert.equal(sequence.sequence.studyId, 'recovery');
    assert.ok(Math.abs(sequence.phase - 8.01) < 1e-9, 'restored transport follows the continuing musical clock');
  } finally {
    await audio.dispose();
    keys.forEach((key, i) => originals[i] ? Object.defineProperty(globalThis, key, originals[i]) : delete globalThis[key]);
  }
});
