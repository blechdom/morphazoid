import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECORDED_INPUT_SOURCES, checkInputFile, createActiveEdge, createRecordedInputCore, normalizeInputSource, orderedSampleChoices,
  recordedFileStatus, recordedModeOf, recordedStartBlocker, shouldStopRecorded, stripSourceOf,
} from '../src/families/recorded-input/recorded-input-core.js';
import { withRecordedInput } from '../src/families/recorded-input/recorded-input-sources.js';
import { MAX_INPUT_FILE_BYTES, SAMPLE_INPUT_OPTIONS } from '../src/instruments/micmic/native/input-source.js';
import * as player from '../src/instruments/micmic/native/recorded-input-player.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const pcm = (channels = 1, frames = 100, sampleRate = 100) => ({ numberOfChannels: channels, length: frames, sampleRate, getChannelData: () => Float32Array.from({ length: frames }, (_, i) => Math.sin(i) * .25) });
function fixture(options = {}) {
  const sources = [], bridges = [], targetA = { name: 'a' }, targetB = { name: 'b' }, hooks = { changes: 0, errors: [], active: [], sourceChanges: [], destroyed: 0 };
  const context = {
    state: 'running', sampleRate: 100, currentTime: 3, createBuffer: pcm, decodeAudioData: async () => pcm(),
    createGain() {
      const node = { context, channelCount: 2, gain: { value: 1, ramps: [], setTargetAtTime(...args) { this.ramps.push(args); } },
        connections: [], disconnected: 0, connect(to) { this.connections.push(to); }, disconnect() { this.disconnected++; this.connections = []; } };
      bridges.push(node); return node;
    },
    createBufferSource() {
      const node = { connect(to) { this.target = to; }, disconnect() {}, start() {}, stop() { this.stopped = true; } };
      sources.push(node); return node;
    },
  };
  const state = { armed: true, available: true, engaged: true, context, targets: [targetA], prepared: 0 };
  const core = createRecordedInputCore({
    withPanel: false, watchMs: 0,
    getContext: () => state.context, prepare: async () => { state.prepared++; }, targets: () => state.targets,
    isArmed: () => state.armed, isAvailable: () => state.available, isEngaged: () => state.engaged,
    loadDemo: async () => ({ buffer: pcm(), credit: 'credit', creditUrl: 'https://example.test' }),
    onChange: () => { hooks.changes++; }, onError: error => hooks.errors.push(error.message),
    onActiveChange: active => hooks.active.push(active), onSourceChange: (next, previous) => hooks.sourceChanges.push([previous, next]),
    onDestroy: () => { hooks.destroyed++; }, ...options,
  });
  return { core, state, sources, bridges, hooks, targetA, targetB, context };
}
const file = (name = 'voice.wav', size = 100, type = 'audio/wav') => ({ name, size, type, arrayBuffer: async () => new ArrayBuffer(size) });

test('source menu is Mic, File, Samples; unknown values and aliases map onto them', () => {
  assert.deepEqual(RECORDED_INPUT_SOURCES.map(source => [source.value, source.label]), [['mic', 'Mic'], ['file', 'File'], ['samples', 'Samples']]);
  assert.ok(Object.isFrozen(RECORDED_INPUT_SOURCES));
  assert.equal(normalizeInputSource('samples'), 'samples');
  assert.equal(normalizeInputSource('file'), 'file');
  assert.equal(normalizeInputSource('line'), 'mic');
  assert.equal(normalizeInputSource(undefined), 'mic');
  for (const value of ['mic', 'input', 'microphone', 'line']) assert.equal(recordedModeOf(value), 'mic');
  for (const value of ['samples', 'sample-file', 'sample']) assert.equal(recordedModeOf(value), 'samples');
  for (const value of ['file', 'upload']) assert.equal(recordedModeOf(value), 'file');
  assert.equal(recordedModeOf('noise'), null);
  assert.equal(recordedModeOf(undefined), null);
  assert.deepEqual(['mic', 'file', 'samples', 'other'].map(stripSourceOf), ['mic', 'file', 'samples', 'mic']);
});

test('sample choices keep every bundled recording once, featured first and grouped', () => {
  const choices = orderedSampleChoices();
  assert.equal(choices.length, SAMPLE_INPUT_OPTIONS.length);
  assert.deepEqual(new Set(choices.map(choice => choice.id)), new Set(SAMPLE_INPUT_OPTIONS.map(option => option.id)));
  assert.equal(choices[0].id, 'music-vocal-scat');
  assert.ok(choices.slice(0, 5).every(choice => choice.group === 'Voices, sax & tabla'));
  assert.ok(choices.slice(5).every(choice => choice.group !== 'Voices, sax & tabla'));
});

test('the Acoustic Manifold and Recursion import path keeps its symbols', () => {
  assert.equal(player.orderedSampleChoices, orderedSampleChoices);
  assert.equal(player.RECORDED_INPUT_SOURCES, RECORDED_INPUT_SOURCES);
});

test('file check applies the shared byte bound and rejects non-audio', () => {
  assert.equal(checkInputFile(file('a.wav', 1024)), '');
  assert.equal(checkInputFile(file('a', 1024, '')), '');
  assert.equal(checkInputFile(file('a.ogg', 1024, 'application/ogg')), '');
  assert.match(checkInputFile(file('a', 0)), /nonempty/);
  assert.match(checkInputFile(file('a', MAX_INPUT_FILE_BYTES + 1)), /smaller than 64 MiB/);
  assert.match(checkInputFile(file('a', 1024, 'text/plain')), /audio file/);
  assert.match(checkInputFile(null), /audio file/);
  assert.match(checkInputFile({ size: 10, type: 'audio/wav' }), /audio file/);
});

test('file status distinguishes pending, waiting for Audio, ready, playing and finished', () => {
  const idle = { pending: false, playing: false, hasFile: false, fileName: '', loop: true, ended: false };
  assert.match(recordedFileStatus({ armed: true, state: idle }), /Choose an audio file/);
  assert.equal(recordedFileStatus({ armed: false, state: idle, pendingName: 'a.wav' }), 'a.wav · switch Audio on, then play.');
  assert.equal(recordedFileStatus({ armed: true, state: idle, pendingName: 'a.wav' }), 'Ready to play.');
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, pending: true } }), 'Loading file…');
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, playing: true, hasFile: true, fileName: 'a.wav · 1.0 s' } }), 'a.wav · 1.0 s · looping');
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, playing: true, loop: false, fileName: 'a.wav' } }), 'a.wav · once');
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, hasFile: true, fileName: 'a.wav', ended: true } }), 'File finished.');
});

test('start blockers never allow mic playback and require armed audio', () => {
  assert.match(recordedStartBlocker({ source: 'mic', armed: true, hasFile: true }), /microphone button/);
  assert.match(recordedStartBlocker({ source: 'samples', armed: false, hasFile: false }), /Switch Audio on/);
  assert.match(recordedStartBlocker({ source: 'file', armed: false, hasFile: true }), /Switch Audio on/);
  assert.match(recordedStartBlocker({ source: 'file', armed: true, hasFile: false }), /Choose an audio file/);
  assert.equal(recordedStartBlocker({ source: 'file', armed: true, hasFile: true }), '');
  assert.equal(recordedStartBlocker({ source: 'samples', armed: true, hasFile: false }), '');
});

test('playback stops when unarmed, unavailable, disengaged or its context closes', () => {
  const live = { active: true, armed: true, available: true, contextClosed: false };
  assert.equal(shouldStopRecorded(live), false);
  assert.equal(shouldStopRecorded({ ...live, armed: false }), true);
  assert.equal(shouldStopRecorded({ ...live, available: false }), true);
  assert.equal(shouldStopRecorded({ ...live, engaged: false }), true);
  assert.equal(shouldStopRecorded({ ...live, contextClosed: true }), true);
  assert.equal(shouldStopRecorded({ ...live, active: false, armed: false }), false);
  assert.equal(shouldStopRecorded({ active: false, pending: true, armed: false }), false);
  assert.equal(shouldStopRecorded({ active: false, pending: true, armed: false, pendingNeedsArmed: true }), true);
  assert.equal(shouldStopRecorded({ active: false, pending: true, armed: true, pendingNeedsArmed: true }), false);
});

test('active edge reports transitions once', () => {
  const seen = [];
  const edge = createActiveEdge(value => seen.push(value));
  assert.equal(edge(false), false);
  assert.equal(edge(true), true);
  assert.equal(edge(true), false);
  assert.equal(edge(0), true);
  assert.deepEqual(seen, [true, false]);
});

test('Mic is the default; selecting a source prepares nothing and playing needs Audio armed', async () => {
  const f = fixture({});
  assert.equal(f.core.source, 'mic');
  await assert.rejects(f.core.start(), /microphone button/);
  f.core.setSource('samples'); f.core.setSource('file'); f.core.setSource('bogus');
  assert.equal(f.core.source, 'mic');
  f.core.setSource('samples');
  f.state.armed = false;
  await assert.rejects(f.core.start(), /Switch Audio on before playing a sample/);
  assert.equal(f.state.prepared, 0); assert.equal(f.bridges.length, 0); assert.equal(f.sources.length, 0);
  assert.deepEqual(f.hooks.sourceChanges, [['mic', 'samples'], ['samples', 'file'], ['file', 'mic'], ['mic', 'samples']]);
  f.core.destroy();
});

test('armed samples enter the bridge, switching releases the previous source and loops by default', async () => {
  const f = fixture({});
  f.core.setSource('samples');
  await f.core.start();
  assert.equal(f.sources.length, 1); assert.equal(f.core.isPlaying(), true);
  assert.equal(f.core.snapshot().loop, true); assert.equal(f.sources[0].loop, true);
  assert.equal(f.core.signal(), f.core.bridge);
  assert.deepEqual(f.hooks.active, [true]);
  f.core.setSource('file');
  assert.equal(f.sources[0].stopped, true); assert.equal(f.core.isPlaying(), false);
  assert.equal(f.core.signal(), null);
  assert.deepEqual(f.hooks.active, [true, false]);
  f.core.setSource('mic');
  await assert.rejects(f.core.start(), /microphone button/);
  f.core.destroy();
});

test('the bridge follows the target set and the context, and carries the requested gain', async () => {
  const f = fixture({ gain: () => 0.4, stereoBridge: true });
  f.core.setSource('samples'); await f.core.start();
  const [first] = f.bridges;
  assert.equal(first.gain.value, 0.4); assert.equal(first.channelCountMode, 'explicit');
  assert.deepEqual(first.connections, [f.targetA]);
  f.core.stop();
  f.state.targets = [f.targetA, f.targetB]; await f.core.start();
  assert.equal(f.bridges.length, 1); assert.deepEqual(first.connections, [f.targetA, f.targetB]);
  f.core.stop();
  f.state.targets = [f.targetB]; await f.core.start();
  assert.deepEqual(first.connections, [f.targetB]);
  f.core.setGain(0.9);
  assert.equal(first.gain.ramps.at(-1)[0], 0.9);
  const next = { ...f.context, createGain: f.context.createGain, state: 'running' };
  f.core.stop(); f.state.context = next; f.state.targets = [f.targetA];
  next.createBufferSource = f.context.createBufferSource; next.createBuffer = pcm; next.sampleRate = 100; next.currentTime = 0;
  await f.core.start();
  assert.equal(first.disconnected > 0, true); assert.equal(f.bridges.length, 2);
  f.core.destroy();
});

test('a chosen file is validated and loaded now, when Audio is armed, or when played', async () => {
  const now = fixture({});
  await now.core.chooseFile(file('too-big.wav', MAX_INPUT_FILE_BYTES + 1));
  assert.match(now.hooks.errors.at(-1), /smaller than 64 MiB/); assert.equal(now.core.source, 'mic');
  await now.core.chooseFile(file());
  await tick();
  assert.equal(now.core.source, 'file'); assert.equal(now.core.snapshot().hasFile, true);
  now.core.destroy();

  const gated = fixture({ fileLoad: 'when-armed' });
  gated.state.armed = false;
  await gated.core.chooseFile(file('wait.wav'));
  assert.equal(gated.core.snapshot().hasFile, false); assert.equal(gated.core.snapshot().pendingFileName, 'wait.wav');
  gated.state.armed = true;
  await gated.core.start();
  assert.equal(gated.core.snapshot().hasFile, true); assert.equal(gated.core.snapshot().pendingFileName, ''); assert.equal(gated.core.isPlaying(), true);
  gated.core.destroy();

  const onPlay = fixture({ fileLoad: 'on-play' });
  await onPlay.core.chooseFile(file('later.wav'));
  assert.equal(onPlay.state.prepared, 0); assert.equal(onPlay.core.snapshot().pendingFileName, 'later.wav');
  await assert.rejects(fixture({ fileLoad: 'on-play' }).core.start(), /microphone button/);
  await onPlay.core.start();
  assert.equal(onPlay.core.isPlaying(), true);
  onPlay.core.destroy();
});

test('file mode without a file waits and reports why', async () => {
  const f = fixture({});
  f.core.setSource('file');
  await assert.rejects(f.core.start(), /Choose an audio file first/);
  assert.equal(f.sources.length, 0);
  f.core.destroy();
});

test('reconcile ends playback when Audio goes off, the host is unavailable or disengaged, or the context closes', async () => {
  for (const [key, value] of [['armed', false], ['available', false], ['engaged', false]]) {
    const f = fixture({});
    f.core.setSource('samples'); await f.core.start();
    f.core.reconcile(); assert.equal(f.core.isPlaying(), true);
    f.state[key] = value; f.core.reconcile();
    assert.equal(f.core.isPlaying(), false, key);
    f.core.destroy();
  }
  const closing = fixture({});
  closing.core.setSource('samples'); await closing.core.start();
  closing.context.state = 'closed'; closing.core.reconcile();
  assert.equal(closing.core.isPlaying(), false);
  closing.core.destroy();
});

test('record paths start the source for a take and release only what they started', async () => {
  const f = fixture({});
  f.core.setSource('samples');
  assert.equal(await f.core.acquire(), true); assert.equal(f.core.isPlaying(), true);
  f.core.release(); assert.equal(f.core.isPlaying(), false);
  await f.core.start();
  assert.equal(await f.core.acquire(), true);
  f.core.release(); assert.equal(f.core.isPlaying(), true);
  f.core.destroy();
});

test('destroy releases the bridge once and is idempotent', async () => {
  const f = fixture({});
  f.core.setSource('samples'); await f.core.start();
  const [bridge] = f.bridges;
  f.core.destroy(); f.core.destroy();
  assert.equal(bridge.disconnected, 1); assert.equal(f.sources[0].stopped, true); assert.equal(f.hooks.destroyed, 1);
  assert.deepEqual(f.hooks.active, [true, false]);
  assert.equal(f.core.bridge, null);
});

test('strip options report recorded state, keep the mic path intact and release by source', async () => {
  const log = [];
  const input = { source: 'mic', fileInput: { id: 'f' }, error: '', snapshot: () => ({ playing: true, pending: false }), signal: () => 'bridge',
    reconcile: () => log.push('reconcile'), start: async () => log.push('start'), stop: () => log.push('stop'),
    setSource(value) { log.push(`set:${value}`); this.source = value; } };
  const options = withRecordedInput({
    onStart: async () => log.push('mic-start'), onStop: async () => log.push('mic-stop'),
    getState: () => ({ active: false, pending: true, supported: true }), getSignal: () => ({ node: 'mic-node', stream: 'stream', multiplier: 2 }),
  }, input, { onLeave: previous => log.push(`leave:${previous}`) });
  assert.deepEqual(options.sources, RECORDED_INPUT_SOURCES); assert.equal(options.fileInput, input.fileInput);
  assert.deepEqual(options.getState(), { active: false, pending: true, supported: true, source: 'mic' });
  assert.equal(options.getSignal().node, 'mic-node');
  await options.onStart(); await options.onStop();
  options.onSourceChange('samples'); await tick();
  assert.deepEqual(log.slice(0, 7), ['reconcile', 'mic-start', 'stop', 'mic-stop', 'leave:mic', 'mic-stop', 'set:samples']);
  assert.deepEqual(options.getState(), { active: true, pending: false, supported: true, source: 'samples', error: '' });
  assert.deepEqual(options.getSignal(), { node: 'bridge', stream: null, channels: 2, multiplier: 2 });
  log.length = 0;
  await options.onStart(); await options.onStop(); options.onSourceChange('samples');
  assert.deepEqual(log, ['start', 'stop']);
});
