import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundFontPlayer } from '../src/sound-fonts/player.js';
import { SoundFontPreview } from '../src/site/sound-fonts/preview-audio.js';

class Node {
  constructor() { this.connections = new Set(); }
  connect(destination) { this.connections.add(destination); }
  disconnect() { this.connections.clear(); }
}
class Worklet extends Node {
  static made = [];
  constructor() {
    super(); Worklet.made.push(this); this.messages = []; this.portClosed = false;
    this.port = { onmessage: null, close: () => { this.portClosed = true; }, postMessage: message => {
      this.messages.push(message);
      if (message.type === 'load') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } }));
    } };
  }
}
function context() {
  return { state: 'running', currentTime: 0, resumeCalls: 0, audioWorklet: { addModule: async () => {} },
    resume() { this.resumeCalls++; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createGain() { return Object.assign(new Node(), { gain: { value: 0, target: null, setTargetAtTime(value) { this.target = value; } } }); },
  };
}
function install(t) {
  const original = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = Worklet; Worklet.made = [];
  t.after(() => { globalThis.AudioWorkletNode = original; });
}
const bytes = () => new ArrayBuffer(12); // Client tests simulate worklet acceptance; real parsing has separate coverage.

test('queued errors from a retiring bank cannot mute or invalidate the replacement', async t => {
  install(t);
  const errors = [], player = new SoundFontPlayer(context(), new Node(), { onError: error => errors.push(error) });
  t.after(() => player.dispose());
  await player.load(bytes());
  const retired = player.current, queuedMessage = retired.node.port.onmessage, queuedFailure = retired.node.onprocessorerror;
  await player.load(bytes());
  const replacement = player.current;
  queuedMessage({ data: { type: 'error', message: 'Late old-bank error' } }); queuedFailure();
  assert.equal(player.current, replacement);
  assert.equal(replacement.gain.gain.target, 1);
  assert.equal(replacement.node.messages.some(message => message.type === 'stop'), false);
  assert.deepEqual(errors, []);
  assert.equal(retired.node.port.onmessage, null); assert.equal(retired.node.onprocessorerror, null);
});

test('fatal processor and render failures release the source and only explicit load recovers', async t => {
  install(t);
  const runtime = context(), errors = [], player = new SoundFontPlayer(runtime, new Node(), { onError: error => errors.push(error) });
  t.after(() => player.dispose());
  for (const kind of ['processor', 'render']) {
    await player.load(bytes()); const failed = player.current, count = Worklet.made.length;
    if (kind === 'processor') failed.node.onprocessorerror();
    else failed.node.port.onmessage({ data: { type: 'error', message: 'Decoder failed' } });
    assert.equal(player.current, null); assert.equal(player.noteOn(60), null);
    assert.equal(failed.node.portClosed, true); assert.equal(failed.node.connections.size, 0); assert.equal(failed.gain.connections.size, 0);
    await Promise.resolve();
    assert.equal(Worklet.made.length, count, 'failure does not automatically create a replacement');
    assert.equal(runtime.resumeCalls, 0, 'failure never resumes the caller context');
  }
  assert.equal(errors.length, 2);
  await player.load(bytes()); assert.equal(player.noteOn(60), 60);
});

test('preview invalidates failed bank caches and retries only on request without arming Audio', async t => {
  install(t);
  const runtime = context(), errors = [], preview = new SoundFontPreview({ onError: error => errors.push(error) });
  t.after(() => preview.dispose());
  preview.context = runtime; preview.compressor = new Node();
  const font = { bytes: bytes(), presets: [{ bank: 0, program: 0, zones: [] }] };
  await preview.setFont(font);
  const failed = preview.bankPlayer, count = Worklet.made.length;
  failed.current.node.onprocessorerror();
  assert.equal(preview.bankPlayer, null); assert.equal(preview.bankPromise, null); assert.equal(preview.preparedBank, null);
  assert.equal(preview.enabled, false); assert.equal(preview.noteOn(60), null);
  await Promise.resolve(); assert.equal(Worklet.made.length, count); assert.equal(runtime.resumeCalls, 0);
  await preview.prepareBank();
  assert.notEqual(preview.bankPlayer, failed); assert.equal(preview.preparedBank, font);
  assert.equal(preview.enabled, false, 'an explicit bank retry still does not arm Audio');
  assert.equal(errors.length, 1);
  preview._enabled = true; // An already armed caller retains its explicit state.
  const recoveredCount = Worklet.made.length;
  preview.bankPlayer.current.node.onprocessorerror();
  assert.equal(preview.enabled, true);
  assert.equal(preview.noteOn(60), null, 'armed state does not report dead notes as playing');
  assert.equal(Worklet.made.length, recoveredCount); assert.equal(runtime.resumeCalls, 0);
});
