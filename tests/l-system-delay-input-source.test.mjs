import assert from 'node:assert/strict';
import test from 'node:test';
import { createInputSource, SAMPLE_INPUT_OPTIONS, DEFAULT_SAMPLE_ID, MAX_INPUT_FILE_BYTES } from '../src/instruments/micmic/native/input-source.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function buffer(channels = 1, frames = 100, sampleRate = 100) {
  const data = Array.from({ length: channels }, () => Float32Array.from({ length: frames }, (_, i) => Math.sin(i) * .25));
  return { numberOfChannels: channels, length: frames, sampleRate, getChannelData: channel => data[channel] };
}
function fixture() {
  const sources = [], errors = [], changes = [], target = {}, demos = [];
  let armed = false, preparations = 0;
  const context = { state: 'running', sampleRate: 100, currentTime: 12,
    createBuffer: buffer, decodeAudioData: async () => buffer(),
    createBufferSource() {
      const source = { connect(to) { this.target = to; }, disconnect() { this.disconnected = true; },
        start(time) { this.started = time; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    } };
  const input = createInputSource({ prepare: async () => { preparations++; }, getContext: () => context, getTarget: () => target,
    canPlay: () => armed, onChange: value => changes.push(value), onError: error => errors.push(error),
    loadDemo: async (_context, id, { signal }) => { demos.push({ id, signal }); return { buffer: buffer(), credit: 'Recorded input credit', creditUrl: 'https://example.test/credits' }; } });
  return { input, sources, errors, changes, target, demos, context,
    arm(value = true) { armed = value; }, get preparations() { return preparations; } };
}
const file = (name = 'voice.wav', size = 100) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });

test('sample options contain only the nine shared recorded demos', () => {
  assert.equal(DEFAULT_SAMPLE_ID, 'sample-drums'); assert.equal(SAMPLE_INPUT_OPTIONS.length, 9);
  assert.ok(SAMPLE_INPUT_OPTIONS.every(option => option.kind === 'demo'));
  assert.ok(!SAMPLE_INPUT_OPTIONS.some(option => ['sine', 'noise', 'drum-pattern'].includes(option.id)));
});
test('selecting modes and samples while muted does not prepare or play audio', async () => {
  const f = fixture(); f.input.selectMode('samples'); f.input.selectSample('birdsong');
  await f.input.start(); assert.equal(f.preparations, 0); assert.equal(f.sources.length, 0);
  f.arm(); await f.input.start(); assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].target, f.target); assert.equal(f.sources[0].started, 12);
  assert.equal(f.input.snapshot().credit, 'Recorded input credit');
  f.input.stop(); assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true);
  f.arm(false); await f.input.restart(); assert.equal(f.sources.length, 1);
});
test('upload decodes with output muted and retains exact PCM for subsequent explicit playback', async () => {
  const f = fixture(); const expected = buffer(); f.context.decodeAudioData = async () => expected;
  await f.input.loadFile(file()); assert.equal(f.preparations, 1); assert.equal(f.sources.length, 0);
  assert.equal(f.input.snapshot().mode, 'file'); assert.equal(f.input.snapshot().hasFile, true);
  f.arm(); await f.input.start();
  assert.deepEqual(f.sources[0].buffer.getChannelData(0), expected.getChannelData(0));
  assert.equal(f.sources[0].loop, true); f.input.setLoop(false); assert.equal(f.sources[0].loop, false);
  const ended = f.sources[0].onended; ended(); assert.equal(f.input.snapshot().ended, true);
  assert.equal(f.input.snapshot().playing, false); assert.equal(f.input.snapshot().hasFile, true);
  await f.input.restart(); assert.equal(f.sources.length, 2); assert.equal(f.input.snapshot().ended, false);
  f.input.dispose(); assert.equal(f.sources[1].stopped, true);
});
test('uploads bound retained PCM to two channels and 120 seconds and disclose the excerpt', async () => {
  const f = fixture(); f.context.decodeAudioData = async () => buffer(4, 1500, 10);
  await f.input.loadFile(file('long.wav')); f.arm(); await f.input.start();
  assert.equal(f.sources[0].buffer.numberOfChannels, 2); assert.equal(f.sources[0].buffer.length, 1200);
  assert.match(f.input.snapshot().fileName, /120\.0 s excerpt/);
  await assert.rejects(f.input.loadFile(file('large.wav', MAX_INPUT_FILE_BYTES + 1)), /64 MiB/);
  assert.equal(f.sources.length, 1); f.input.dispose();
});
test('cancelled decode cannot start, overwrite a replacement input, or clear its pending state', async () => {
  const f = fixture(), decoded = deferred(); f.context.decodeAudioData = () => decoded.promise; f.arm();
  const loading = f.input.loadFile(file('old.wav')); await tick();
  f.input.selectMode('samples'); f.input.selectSample('music-keys'); await f.input.start();
  assert.equal(f.sources.length, 1); decoded.resolve(buffer()); await loading;
  assert.equal(f.sources.length, 1); assert.equal(f.input.snapshot().sampleId, 'music-keys');
  assert.equal(f.input.snapshot().playing, true); assert.equal(f.input.snapshot().pending, false); f.input.dispose();
});
test('stop aborts demo fetch/decode and suppresses stale failures without restarting', async () => {
  const wait = deferred(), f = fixture(); let signal;
  const input = createInputSource({ prepare: async () => {}, getContext: () => f.context, getTarget: () => f.target,
    canPlay: () => true, onError: error => f.errors.push(error), loadDemo: async (_context, _id, options) => { signal = options.signal; return wait.promise; } });
  input.selectMode('samples'); const start = input.start(); await tick(); input.stop();
  assert.equal(signal.aborted, true); wait.reject(new Error('late decoding failed')); await start;
  assert.equal(f.errors.length, 0); assert.equal(f.sources.length, 0); assert.equal(input.snapshot().pending, false); input.dispose();
});
test('current decode errors clear pending and permit a corrected upload', async () => {
  const f = fixture(); f.context.decodeAudioData = async () => { throw new Error('Cannot decode'); };
  await assert.rejects(f.input.loadFile(file('bad.wav')), /Cannot decode/);
  assert.equal(f.input.snapshot().pending, false); assert.equal(f.input.snapshot().hasFile, false);
  f.context.decodeAudioData = async () => buffer(); await f.input.loadFile(file('good.wav'));
  assert.equal(f.input.snapshot().hasFile, true); assert.equal(f.errors.length, 1); f.input.dispose();
});
test('file mode with no file waits quietly and rapid sample changes retain one active source', async () => {
  const f = fixture(); f.arm(); f.input.selectMode('file'); await f.input.start(); assert.equal(f.sources.length, 0);
  f.input.selectMode('samples'); await f.input.start(); f.input.selectSample('music-bass'); await f.input.start();
  assert.equal(f.sources.length, 2); assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.input.snapshot().sampleId, 'music-bass'); f.input.dispose();
});
