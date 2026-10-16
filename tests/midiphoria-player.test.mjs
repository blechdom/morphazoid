import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiphoriaPlayer } from '../src/instruments/midiphoria/midiphoria-player.js';
import { encodeSoundFont } from '../src/site/sound-fonts/soundfont.js';

const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const midi = () => new Uint8Array([
  77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
  77, 84, 114, 107, 0, 0, 0, 13, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0,
]).buffer;

class Events {
  constructor() { this.callbacks = new Map(); }
  addEvent(type, id, callback) { this.callbacks.set(`${type}:${id}`, callback); }
  removeEvent(type, id) { this.callbacks.delete(`${type}:${id}`); }
  emit(type, data) { for (const [key, callback] of this.callbacks) if (key.startsWith(`${type}:`)) callback(data); }
}

function harness({ manualSongs = false, bankFailure = false, fetchFailure = false, deferredLibrary = false, clock, getAudioContext, minPlaybackRate, maxPlaybackRate } = {}) {
  const calls = [], messages = [], clears = [], states = [], contexts = [], synths = [], sequencers = [];
  const timers = new Map(), windowEvents = new Map();
  let nextTimer = 0, releaseLibrary;
  class Context {
    constructor() {
      calls.push('context'); contexts.push(this); this.state = 'suspended'; this.currentTime = 0;
      this.listeners = new Map();
      this.audioWorklet = { addModule: async url => { calls.push(['worklet', url]); } };
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
    changeState(state) { this.state = state; this.listeners.get('statechange')?.(); }
    resume() { calls.push('resume'); this.changeState('running'); return Promise.resolve(); }
    createGain() {
      const gain = { value: 0, targets: [], cancelAndHoldAtTime() {},
        linearRampToValueAtTime(value, time) { this.value = value; this.targets.push([value, time]); } };
      const name = this.master ? 'preamp' : 'master';
      const node = { gain, connect(target) { this.target = target; }, disconnect() { calls.push(`${name}-disconnect`); } };
      this[name] = node;
      return node;
    }
    createDynamicsCompressor() {
      this.compressor = Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, { value: 0 }]));
      this.compressor.connect = function (target) { this.target = target; };
      this.compressor.disconnect = () => calls.push('compressor-disconnect');
      return this.compressor;
    }
    createWaveShaper() {
      this.ceiling = { curve: null, oversample: 'none', disconnect: () => calls.push('ceiling-disconnect') };
      return this.ceiling;
    }
    async close() { calls.push('close'); this.changeState('closed'); }
  }
  class Synth {
    constructor(context, config) {
      this.context = context; this.config = config; this.notes = []; this.stops = [];
      this.eventHandler = new Events(); this.isReady = Promise.resolve(); this.index = synths.length; synths.push(this);
      this.worklet = config.audioNodeCreators.worklet(context, 'fake-synth', {});
      this.pendingBanks = []; this.bankIds = [];
      this.soundBankManager = { addSoundBank: async (buffer, id) => {
        this.bankIds.push(id);
        this.bank = structuredClone(buffer, { transfer: [buffer] });
        calls.push('soundbank');
        if (bankFailure === true || bankFailure === this.index || this.failNextBank) {
          this.failNextBank = false;
          this.eventHandler.emit('soundBankError', new Error('bad bank'));
          return new Promise(() => {});
        }
        if (this.deferBanks) return new Promise(resolve => this.pendingBanks.push(resolve));
      } };
    }
    connect(target) { calls.push('synth-connect'); this.target = target; }
    setLogLevel() {}
    setSystemParameter(key, value) { calls.push([key, value]); }
    programChange(channel, program) { this.program = [channel, program]; }
    noteOn(channel, note, velocity, options) { this.notes.push(['on', channel, note, velocity, options]); }
    noteOff(channel, note, options) { this.notes.push(['off', channel, note, options]); }
    stopAll(force) { calls.push(['stopAll', force]); this.stops.push(force); }
    destroy() { calls.push('destroy'); this.destroyed = true; }
  }
  class Sequence {
    constructor(synth, options) {
      this.synth = synth; this.options = options; this.eventHandler = new Events(); this.duration = 0;
      this.currentTime = 0; this.paused = true; this.loads = []; sequencers.push(this);
    }
    pause() { calls.push('pause'); this.paused = true; }
    play() { calls.push('play'); this.paused = false; }
    loadNewSongList(list) {
      this.loads.push(list); calls.push(['load', list[0].fileName, this.paused]);
      if (!manualSongs) queueMicrotask(() => this.loaded());
    }
    loaded(duration = 10) { this.duration = duration; this.currentTime = 0; this.eventHandler.emit('songChange', { duration }); }
  }
  const library = { WorkletSynthesizer: Synth, Sequencer: Sequence };
  const libraryPromise = deferredLibrary ? new Promise(resolve => { releaseLibrary = () => resolve(library); }) : Promise.resolve(library);
  const runtime = {
    AudioContext: Context,
    AudioWorkletNode: class {
      constructor() { this.listeners = new Map(); this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
      addEventListener(type, callback) { this.listeners.set(type, callback); }
      removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
      emit(type) { this.listeners.get(type)?.(); }
    },
    async fetch(url) { calls.push(['fetch', url]); return { ok: !fetchFailure, status: fetchFailure ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(16) }; },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { windowEvents.set(type, callback); },
    removeEventListener(type, callback) { if (windowEvents.get(type) === callback) windowEvents.delete(type); },
  };
  const player = new MidiphoriaPlayer({ runtime, clock, getAudioContext, minPlaybackRate, maxPlaybackRate, loadLibrary: () => { calls.push('import'); return libraryPromise; },
    connectOutput: (context, source) => { context.outputSource = source; calls.push('output-connect'); return () => calls.push('output-release'); },
    onMidi: message => messages.push(message), onClear: (...args) => clears.push(args), onState: state => states.push(state),
  });
  return { player, runtime, calls, messages, clears, states, contexts, synths, sequencers, timers, windowEvents,
    releaseLibrary, expire(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } } };
}

async function ready(h) {
  await h.player.load(midi(), 'first.mid');
  assert.equal(await h.player.enableAudio(), true);
  return h.sequencers[0];
}

const bank = name => encodeSoundFont({ name, samples: [{ data: new Float32Array(64).fill(.1) }] });
const waitFor = async predicate => {
  for (let index = 0; index < 30 && !predicate(); index++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate());
};

test('borrowed audio context survives file-player teardown and processor failure', async () => {
  let shared; const h = harness({ getAudioContext: () => shared }); shared = new h.runtime.AudioContext();
  await ready(h); assert.equal(h.contexts.length, 1); h.player.play();
  h.synths[0].worklet.emit('processorerror'); await flush();
  assert.equal(shared.state, 'running'); assert.equal(h.calls.includes('close'), false);
  assert.equal(h.player.context, null); assert.equal(h.synths[0].destroyed, true);
  assert.equal(await h.player.enableAudio(), true); assert.equal(h.contexts.length, 1);
  assert.equal(h.player.state.ready, true);
  await h.player.dispose(); assert.equal(shared.state, 'running'); assert.equal(shared.listeners.size, 0);
  assert.equal(h.calls.includes('close'), false); assert.equal(h.calls.filter(call => call === 'output-release').length, 2);
});

test('unavailable shared context never creates a private engine and failed startup leaves its owner usable', async () => {
  const absent = harness({ getAudioContext: () => null });
  assert.equal(await absent.player.enableAudio(), false); assert.equal(absent.contexts.length, 0);
  assert.match(absent.player.state.error, /shared audio engine/); await absent.player.dispose();
  let shared; const failed = harness({ getAudioContext: () => shared, bankFailure: true }); shared = new failed.runtime.AudioContext();
  assert.equal(await failed.player.enableAudio(), false); assert.equal(shared.state, 'running');
  assert.equal(shared.listeners.size, 0); assert.equal(failed.timers.size, 0); assert.equal(failed.calls.includes('close'), false);
  assert.ok(shared.createGain(), 'the owning instrument can still create and play its own nodes');
  await failed.player.dispose(); assert.equal(shared.state, 'running');
});

test('borrowed owner can replace a closed context and MIDI recovery uses only the new shared context', async () => {
  let shared; const h = harness({ getAudioContext: () => shared }); shared = new h.runtime.AudioContext();
  await ready(h); const previous = shared;
  previous.changeState('closed'); await flush(); shared = new h.runtime.AudioContext();
  assert.equal(await h.player.enableAudio(), true); assert.equal(h.contexts.length, 2); assert.equal(h.player.context, shared);
  assert.equal(h.player.state.fileName, 'first.mid'); await h.player.dispose(); assert.equal(shared.state, 'running');
});

test('validated bank can be queued before Audio and startup uses its intact bytes for both synths', async () => {
  const h = harness(), bytes = bank('Shared bank'), expected = [...new Uint8Array(bytes)];
  await h.player.loadSoundFont(bytes, 'Shared bank'); assert.equal(h.contexts.length, 0);
  assert.equal(h.player.state.soundfontName, 'Shared bank'); await ready(h);
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'fetch').length, 0);
  for (const synth of h.synths) { assert.deepEqual([...new Uint8Array(synth.bank)], expected); assert.deepEqual(synth.bankIds, ['midiphoria']); }
  assert.deepEqual([...new Uint8Array(bytes)], expected); await h.player.dispose();
});

test('active SoundFont replacement retains time, rate, loop, volume, Audio and transport; invalid bank preserves it', async () => {
  const h = harness(); const sequence = await ready(h); h.player.play(); sequence.currentTime = 4;
  h.player.setPlaybackRate(2); h.player.setLoop(true); h.player.setVolume(.37);
  const bytes = bank('Replacement'); await h.player.loadSoundFont(bytes, 'Replacement');
  assert.equal(h.player.state.time, 4); assert.equal(h.player.state.playing, true); assert.equal(sequence.paused, false);
  assert.equal(h.player.state.rate, 2); assert.equal(h.player.state.loop, true); assert.equal(h.player.state.volume, .37);
  assert.equal(h.player.state.audioEnabled, true); assert.equal(h.player.state.soundfontName, 'Replacement');
  const accepted = h.player._font;
  for (const synth of h.synths) { assert.deepEqual([...new Uint8Array(synth.bank)], [...new Uint8Array(bytes)]); assert.deepEqual(synth.bankIds, ['midiphoria', 'midiphoria']); }
  await assert.rejects(h.player.loadSoundFont(new ArrayBuffer(12), 'Bad'), /not an SF2/);
  const broken = bytes.slice(0); new DataView(broken).setUint32(4, 10, true);
  await assert.rejects(h.player.loadSoundFont(broken, 'Truncated'));
  assert.equal(h.player._font, accepted); assert.equal(h.player.state.time, 4); assert.equal(h.player.state.playing, true);
  await h.player.dispose();
});

test('failed active bank commit restores both accepted banks without stopping playback', async () => {
  const h = harness(); const sequence = await ready(h); const accepted = bank('Accepted');
  await h.player.loadSoundFont(accepted, 'Accepted'); h.player.play(); sequence.currentTime = 6;
  h.synths[1].failNextBank = true;
  await assert.rejects(h.player.loadSoundFont(bank('Rejected'), 'Rejected'), /bad bank/);
  for (const synth of h.synths) assert.deepEqual([...new Uint8Array(synth.bank)], [...new Uint8Array(accepted)]);
  assert.equal(h.player.state.soundfontName, 'Accepted'); assert.equal(h.player.state.time, 6); assert.equal(h.player.state.playing, true);
  await h.player.dispose();
});

test('pending bank acknowledgements serialize across both synths and latest queued bank wins', async () => {
  const h = harness(); await ready(h); h.synths.forEach(synth => { synth.deferBanks = true; });
  const first = h.player.loadSoundFont(bank('First'), 'First');
  await waitFor(() => h.synths.every(synth => synth.pendingBanks.length === 1));
  const second = h.player.loadSoundFont(bank('Second'), 'Second'); await flush();
  assert.ok(h.synths.every(synth => synth.bankIds.length === 2));
  h.synths.forEach(synth => synth.pendingBanks.shift()()); await first;
  await waitFor(() => h.synths.every(synth => synth.pendingBanks.length === 1));
  h.synths.forEach(synth => synth.pendingBanks.shift()()); await second;
  assert.equal(h.player.state.soundfontName, 'Second'); assert.ok(h.synths.every(synth => synth.bankIds.length === 3));
  await h.player.dispose();
});

test('a bank chosen during initial resource loading is active before Audio becomes audible', async () => {
  const h = harness({ deferredLibrary: true }), pending = h.player.enableAudio();
  const bytes = bank('During startup'); await h.player.loadSoundFont(bytes, 'During startup'); h.releaseLibrary();
  assert.equal(await pending, true); assert.equal(h.player.state.soundfontName, 'During startup');
  for (const synth of h.synths) assert.deepEqual([...new Uint8Array(synth.bank)], [...new Uint8Array(bytes)]);
  await h.player.dispose();
});

test('silent decorative timeline supports seek, 8x, pause, looping and end without creating audio', async () => {
  let now = 0; const h = harness({ clock: () => now });
  await h.player.loadVisualTimeline(20, 'Artwork');
  assert.equal(h.player.state.visualOnly, true); assert.equal(h.player.state.ready, true);
  assert.equal(h.player.play(), true); now = 2; assert.equal(h.player.state.time, 2);
  h.player.setPlaybackRate(8); now = 3; assert.equal(h.player.state.time, 10);
  h.player.pause(); now = 5; assert.equal(h.player.state.time, 10);
  h.player.seek(18); h.player.setLoop(true); h.player.play(); now = 6;
  assert.equal(h.player.state.time, 6); assert.equal(h.player.state.playing, true);
  h.player.setLoop(false); now = 10; assert.equal(h.player.state.time, 20); assert.equal(h.player.state.playing, false);
  assert.equal(h.contexts.length, 0); assert.equal(h.calls.includes('import'), false);
  h.player.stop(); assert.equal(h.player.state.time, 0); await h.player.dispose();
});

test('switching a decorative timeline back to MIDI requires explicit Audio and releases the virtual clock', async () => {
  let now = 0; const h = harness({ clock: () => now });
  await h.player.loadVisualTimeline(30, 'Artwork'); h.player.play(); now = 3;
  await h.player.load(midi(), 'Back to sound.mid');
  assert.equal(h.player.state.visualOnly, undefined); assert.equal(h.player.state.playing, false);
  assert.equal(h.player.play(), false); assert.equal(h.contexts.length, 0);
  await h.player.enableAudio(); assert.equal(h.player.play(), true);
  assert.equal(h.player.state.duration, 10); await h.player.dispose();
});

test('late audio clock events do not move a decorative timeline', async () => {
  let now = 0; const h = harness({ clock: () => now }); const seq = await ready(h);
  await h.player.loadVisualTimeline(60, 'Artwork'); h.player.play(); now = 4;
  seq.eventHandler.emit('timeChange', 99); seq.eventHandler.emit('songEnded');
  assert.equal(h.player.state.time, 4); assert.equal(h.player.state.playing, true);
  await h.player.dispose(); assert.equal(h.player.play(), false);
});

test('file selection and Play never create audio; Audio resumes before asynchronous resources', async () => {
  const h = harness();
  const queued = await h.player.load(midi(), 'first.mid');
  assert.equal(queued.hasSong, true); assert.equal(queued.ready, false);
  assert.equal(h.player.play(), false); assert.equal(h.contexts.length, 0);
  const enabling = h.player.enableAudio();
  assert.deepEqual(h.calls.filter(value => typeof value === 'string').slice(0, 3), ['context', 'resume', 'import']);
  assert.equal(await enabling, true);
  assert.equal(h.player.state.ready, true); assert.equal(h.player.state.playing, false);
  assert.equal(h.sequencers[0].paused, true);
  assert.equal(h.sequencers[0].options.skipToFirstNoteOn, false);
  assert.equal(h.contexts[0].master.gain.value, 0.5);
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'fetch' && value[1].endsWith('/assets/midiphoria/soundfont/TimGM6mb.sf2')));
  await h.player.dispose();
});

test('muting and volume changes leave file transport and visual MIDI running', async () => {
  const h = harness(); const seq = await ready(h);
  h.player.play(); seq.currentTime = 3;
  assert.equal(h.player.setAudioEnabled(false), false);
  assert.equal(h.player.state.playing, true); assert.equal(seq.paused, false);
  assert.equal(h.contexts[0].master.gain.value, 0);
  h.player.setVolume(0.8);
  assert.equal(h.contexts[0].master.gain.value, 0);
  h.synths[0].eventHandler.emit('noteOn', { channel: 2, midiNote: 60, velocity: 100 });
  assert.equal(h.messages.length, 1);
  h.player.setAudioEnabled(true);
  assert.equal(h.player.state.time, 3); assert.equal(h.contexts[0].master.gain.value, 0.8);
  await h.player.dispose();
});

test('browser suspension shows Audio off and a single explicit Audio action recovers the playing score', async () => {
  const h = harness(); const seq = await ready(h), context = h.contexts[0];
  h.player.play(); seq.currentTime = 3;
  h.player.padNoteOn('held-pad', 60, 100);
  const resumes = h.calls.filter(call => call === 'resume').length;
  context.state = 'suspended';
  assert.equal(h.player.state.audioEnabled, false, 'the getter is correct before the queued statechange arrives');
  context.changeState('suspended');
  assert.equal(h.player.state.playing, true);
  assert.equal(h.player.state.time, 3);
  assert.equal(h.player._padSources.size, 0);
  assert.equal(h.calls.filter(call => call === 'resume').length, resumes, 'statechange never resumes without a gesture');
  assert.equal(await h.player.enableAudio(), true);
  assert.equal(h.contexts.length, 1);
  assert.equal(h.player.state.playing, true);
  assert.equal(h.player.state.time, 3);
  assert.equal(context.master.gain.value, .5);
  const oldListener = context.listeners.get('statechange');
  await h.player.dispose();
  assert.equal(context.listeners.size, 0);
  const count = h.states.length;
  oldListener();
  assert.equal(h.states.length, count, 'late context callbacks cannot revive disposed UI');
});

test('native interruption recovery restores armed audio but preserves an explicit mute', async () => {
  const h = harness(); await ready(h); const context = h.contexts[0];
  context.changeState('interrupted');
  assert.equal(h.player.state.audioEnabled, false);
  context.changeState('running');
  assert.equal(h.player.state.audioEnabled, true);
  context.changeState('interrupted');
  h.player.setAudioEnabled(false);
  context.changeState('running');
  assert.equal(h.player.state.audioEnabled, false);
  assert.equal(context.master.gain.value, 0);
  await h.player.dispose();
});

test('an externally closed context is discarded and the next Audio action rebuilds the selected song', async () => {
  const h = harness(); await ready(h); const old = h.contexts[0];
  const oldListener = old.listeners.get('statechange');
  old.changeState('closed'); await flush();
  assert.equal(h.player.state.audioEnabled, false);
  assert.equal(h.player.state.ready, false);
  assert.equal(old.listeners.size, 0);
  assert.equal(await h.player.enableAudio(), true);
  assert.equal(h.contexts.length, 2);
  assert.equal(h.player.state.fileName, 'first.mid');
  assert.equal(h.player.state.ready, true);
  oldListener();
  assert.equal(h.player.state.audioEnabled, true);
  await h.player.dispose();
});

test('Audio recovers a closed context even before its queued statechange is delivered', async () => {
  const h = harness(); await ready(h); const old = h.contexts[0];
  old.state = 'closed';
  assert.equal(h.player.state.audioEnabled, false);
  assert.equal(await h.player.enableAudio(), true);
  assert.equal(h.contexts.length, 2);
  assert.equal(old.listeners.size, 0);
  assert.equal(h.player.state.ready, true);
  await h.player.dispose();
});

test('synth callbacks normalize notes, controllers and per-channel all-off', async () => {
  const h = harness(); await ready(h);
  const events = h.synths[0].eventHandler;
  events.emit('noteOn', { channel: 0, midiNote: 60, velocity: 100 });
  assert.equal(h.messages.length, 0, 'initialization and paused callbacks must not light notes');
  h.player.play();
  events.emit('noteOn', { channel: 2, midiNote: 60, velocity: 100 });
  events.emit('noteOff', { channel: 2, midiNote: 60 });
  events.emit('controllerChange', { channel: 2, controller: 64, value: 127 });
  events.emit('stopAll', { channel: 2, force: true });
  assert.deepEqual(h.messages, [
    { type: 'noteOn', channel: 2, sourceId: 'midiphoria:file', note: 60, velocity: 100 },
    { type: 'noteOff', channel: 2, sourceId: 'midiphoria:file', note: 60, velocity: 0 },
    { type: 'controlChange', channel: 2, sourceId: 'midiphoria:file', controller: 64, value: 127 },
    { type: 'controlChange', channel: 2, sourceId: 'midiphoria:file', controller: 120, value: 0 },
  ]);
  await h.player.dispose();
});

test('pause, seek, stop and end release file visuals and preserve independent Audio', async () => {
  const h = harness(); const seq = await ready(h);
  h.player.play(); seq.currentTime = 3; h.player.pause();
  assert.equal(h.player.state.time, 3); assert.equal(h.player.state.audioEnabled, true);
  h.player.seek(6); assert.equal(h.player.state.time, 6); assert.equal(h.player.state.playing, false);
  seq.eventHandler.emit('timeChange', 6); h.player.play();
  seq.eventHandler.emit('songEnded', null);
  assert.equal(h.player.state.time, 10); assert.equal(h.player.state.playing, false);
  h.player.play(); assert.equal(h.player.state.time, 0);
  h.player.stop(); assert.equal(h.player.state.time, 0); assert.equal(h.player.state.playing, false);
  for (const reason of ['pause', 'seek', 'stop', 'ended']) assert.ok(h.clears.some(([source, why]) => source === 'midiphoria:file' && why === reason));
  await h.player.dispose();
});

test('multiport MIDI retains distinct source ownership and clears every port on transport changes', async () => {
  const h = harness(); await ready(h); h.player.play();
  const events = h.synths[0].eventHandler;
  for (const channel of [0, 16, 4095]) events.emit('noteOn', { channel, midiNote: 60, velocity: 100 });
  assert.deepEqual(h.messages.map(({ sourceId, channel }) => ({ sourceId, channel })), [
    { sourceId: 'midiphoria:file', channel: 0 },
    { sourceId: 'midiphoria:file:port:1', channel: 0 },
    { sourceId: 'midiphoria:file:port:255', channel: 15 },
  ]);
  events.emit('stopAll', { channel: 16, force: true });
  assert.deepEqual(h.messages.at(-1), { type: 'controlChange', channel: 0,
    sourceId: 'midiphoria:file:port:1', controller: 120, value: 0 });
  h.player.pause();
  assert.deepEqual(h.clears.filter(([, reason]) => reason === 'pause').slice(-3).map(([source]) => source), [
    'midiphoria:file', 'midiphoria:file:port:1', 'midiphoria:file:port:255',
  ]);
  await h.player.dispose();
});

test('malformed synth callback channels and controllers cannot impersonate channel zero', async () => {
  const h = harness(); await ready(h); h.player.play();
  const events = h.synths[0].eventHandler;
  for (const channel of [undefined, NaN, Infinity, -1, 1.5, 4096, '0']) {
    events.emit('noteOn', { channel, midiNote: 60, velocity: 100 });
    events.emit('controllerChange', { channel, controller: 64, value: 127 });
  }
  events.emit('controllerChange', { channel: 0, controller: NaN, value: 127 });
  events.emit('controllerChange', { channel: 0, controller: 64, value: Infinity });
  assert.equal(h.messages.length, 0);
  await h.player.dispose();
});

test('only the latest pending file is initialized when Audio is enabled', async () => {
  const h = harness();
  await h.player.load(midi(), 'old.mid'); await h.player.load(midi(), 'new.mid');
  await h.player.enableAudio();
  assert.equal(h.sequencers[0].loads.length, 1);
  assert.equal(h.sequencers[0].loads[0][0].fileName, 'new.mid');
  assert.equal(h.player.state.fileName, 'new.mid');
  await h.player.dispose();
});

test('overlapping loads serialize untagged songChange events and discard superseded files', async () => {
  const h = harness({ manualSongs: true }); await h.player.enableAudio();
  const seq = h.sequencers[0];
  const first = h.player.load(midi(), 'a.mid');
  const second = h.player.load(midi(), 'b.mid');
  const third = h.player.load(midi(), 'c.mid');
  assert.equal(await first, false); assert.equal(await second, false);
  assert.equal(seq.loads.length, 1);
  seq.loaded(4);
  assert.equal(seq.loads.length, 2); assert.equal(seq.loads[1][0].fileName, 'c.mid');
  assert.equal(h.player.state.ready, false);
  seq.loaded(9);
  assert.equal((await third).duration, 9);
  assert.equal(h.player.state.ready, true); assert.equal(h.player.state.playing, false);
  assert.ok(h.calls.filter(value => Array.isArray(value) && value[0] === 'load').every(value => value[2] === true));
  await h.player.dispose();
});

test('invalid headers and oversized input preserve the previously loaded file', async () => {
  const h = harness(); await ready(h);
  for (const buffer of [new ArrayBuffer(2), new ArrayBuffer(32), new ArrayBuffer(10 * 1024 * 1024 + 1)]) {
    await assert.rejects(h.player.load(buffer, 'bad.mid'));
    assert.equal(h.player.state.fileName, 'first.mid'); assert.equal(h.player.state.ready, true);
    assert.ok(h.player.state.error);
  }
  await h.player.dispose();
});

test('MIDI parse errors resolve the load without arming playback and allow another file', async () => {
  const h = harness({ manualSongs: true }); await h.player.enableAudio();
  const seq = h.sequencers[0];
  const bad = h.player.load(midi(), 'bad.mid');
  seq.eventHandler.emit('midiError', new Error('bad track'));
  assert.equal(await bad, false); assert.equal(h.player.state.error, 'bad track');
  assert.equal(h.player.state.loading, false); assert.equal(h.player.state.ready, false);
  const good = h.player.load(midi(), 'good.mid'); seq.loaded(); await good;
  assert.equal(h.player.state.ready, true); assert.equal(h.player.state.error, null);
  await h.player.dispose();
});

test('silent zero-duration load times out, closes the engine, and can retry on Audio', async () => {
  const h = harness({ manualSongs: true }); await h.player.enableAudio();
  const pending = h.player.load(midi(), 'empty.mid');
  h.expire(15000); assert.equal(await pending, false); await flush();
  assert.equal(h.player.state.audioEnabled, false); assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.player.state.loading, false);
  const retry = h.player.enableAudio(); await flush();
  assert.equal(h.sequencers.length, 2);
  h.sequencers[1].loaded(); assert.equal(await retry, true);
  assert.equal(h.player.state.ready, true);
  await h.player.dispose();
});

test('SoundFont errors cannot leave Audio or initialization promises hanging', async () => {
  const h = harness({ bankFailure: true });
  assert.equal(await h.player.enableAudio(), false);
  assert.equal(h.player.state.audioEnabled, false); assert.match(h.player.state.error, /bad bank/);
  assert.equal(h.contexts[0].state, 'closed'); assert.equal(h.timers.size, 0);
  assert.equal(h.synths[0].eventHandler.callbacks.size, 0);
  await h.player.dispose();
});

test('missing SoundFont closes the new context and reports a recoverable startup error', async () => {
  const h = harness({ fetchFailure: true });
  assert.equal(await h.player.enableAudio(), false);
  assert.match(h.player.state.error, /404/); assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.timers.size, 0);
  await h.player.dispose();
});

test('turning Audio off during initialization wins over the older enable request', async () => {
  const h = harness({ deferredLibrary: true });
  const enabling = h.player.enableAudio(); h.player.setAudioEnabled(false); h.releaseLibrary();
  assert.equal(await enabling, false); assert.equal(h.player.state.audioEnabled, false);
  assert.equal(h.contexts[0].master.gain.value, 0);
  await h.player.dispose();
});

test('dispose during initialization cancels work and never constructs late nodes', async () => {
  const h = harness({ deferredLibrary: true });
  const enabling = h.player.enableAudio(); await h.player.dispose(); h.releaseLibrary();
  assert.equal(await enabling, false); await flush();
  assert.equal(h.synths.length, 0); assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.timers.size, 0); assert.equal(h.windowEvents.size, 0);
});

test('pagehide releases output, event handlers, pending loads and owned audio context', async () => {
  const h = harness(); await ready(h); h.player.play();
  h.windowEvents.get('pagehide')(); await flush();
  assert.equal(h.contexts[0].state, 'closed'); assert.equal(h.timers.size, 0);
  assert.equal(h.synths[0].eventHandler.callbacks.size, 0);
  assert.equal(h.sequencers[0].eventHandler.callbacks.size, 0);
  assert.ok(h.calls.includes('output-release')); assert.ok(h.calls.includes('master-disconnect'));
  assert.equal(h.player.play(), false); assert.equal(await h.player.enableAudio(), false);
});

test('processor failure stops and clears the failed engine and the next Audio action rebuilds it', async () => {
  const h = harness(); await ready(h); h.player.play();
  const oldWorklet = h.synths[0].worklet;
  oldWorklet.emit('processorerror'); await flush();
  assert.equal(h.player.state.audioEnabled, false); assert.equal(h.player.state.playing, false);
  assert.equal(h.player.state.ready, false); assert.match(h.player.state.error, /processor stopped/);
  assert.equal(h.contexts[0].state, 'closed'); assert.equal(oldWorklet.listeners.size, 0);
  assert.ok(h.clears.some(([source, reason]) => source === 'midiphoria:file' && reason === 'processor-error'));
  assert.equal(await h.player.enableAudio(), true);
  assert.equal(h.contexts.length, 2); assert.equal(h.player.state.ready, true);
  assert.equal(h.player.state.playing, false); assert.equal(h.player.state.error, null);
  await h.player.dispose();
});

test('rate, loop, volume and seeks clamp finite values without creating audio', async () => {
  const h = harness();
  assert.equal(h.player.setVolume(NaN), 0.5); assert.equal(h.player.setVolume(9), 1);
  assert.equal(h.player.setPlaybackRate(99), 8); assert.equal(h.player.setPlaybackRate(-10), 0.5);
  assert.equal(h.player.setLoop(true), true); assert.equal(h.contexts.length, 0);
  const seq = await ready(h);
  assert.equal(seq.loopCount, Infinity); assert.equal(seq.options.initialPlaybackRate, 0.5);
  h.player.seek(999); assert.equal(h.player.state.time, 10);
  h.player.seek(-100); assert.equal(h.player.state.time, 0);
  h.player.setLoop(false); assert.equal(seq.loopCount, 0);
  await h.player.dispose();
});

test('an opt-in lower rate reaches the sequencer without pausing or seeking the file', async () => {
  const h = harness({ minPlaybackRate: .01 });
  assert.equal(h.player.setPlaybackRate(.125), .125);
  const seq = await ready(h);
  assert.equal(seq.options.initialPlaybackRate, .125);
  assert.equal(h.player.play(), true); seq.currentTime = 4;
  const before = h.calls.length;
  assert.equal(h.player.setPlaybackRate(.0625), .0625);
  assert.equal(seq.playbackRate, .0625); assert.equal(h.player.state.time, 4);
  assert.equal(h.player.state.playing, true); assert.equal(seq.paused, false);
  assert.equal(h.calls.slice(before).includes('pause'), false);
  assert.equal(h.player.setPlaybackRate(0), .01); assert.equal(h.player.setPlaybackRate(99), 8);
  await h.player.dispose();
});

test('slow decorative rates keep continuous phase through rate changes and pause', async () => {
  let now = 0; const h = harness({ clock: () => now, minPlaybackRate: .01 });
  await h.player.loadVisualTimeline(60, 'Slow artwork'); h.player.play();
  now = 3; h.player.setPlaybackRate(.125);
  assert.equal(h.player.state.time, 3);
  now = 11; assert.equal(h.player.state.time, 4);
  h.player.setPlaybackRate(.25); now = 15;
  assert.equal(h.player.state.time, 5); assert.equal(h.player.state.playing, true);
  h.player.pause(); now = 25; h.player.setPlaybackRate(.5);
  assert.equal(h.player.state.time, 5); assert.equal(h.player.state.playing, false);
  h.player.play(); now = 27; assert.equal(h.player.state.time, 6);
  assert.equal(h.contexts.length, 0); await h.player.dispose();
});

test('playback-rate floor is validated and legacy consumers retain their half-speed minimum', async () => {
  for (const [minimum, expected] of [[undefined, .5], [NaN, .5], [Infinity, .5], ['.01', .5], [9, .5], [-1, .001], [0, .001], [.01, .01]]) {
    const h = harness({ minPlaybackRate: minimum });
    assert.equal(h.player.setPlaybackRate(-1), expected);
    assert.equal(h.player.setPlaybackRate(NaN), expected);
    assert.equal(h.contexts.length, 0); await h.player.dispose();
  }
});

test('the complete mix is boosted before compression; volume and the final guard remain downstream', async () => {
  const h = harness(); await ready(h);
  const context = h.contexts[0];
  assert.equal(h.synths[0].target, context.preamp);
  assert.equal(h.synths[1].target, context.preamp);
  assert.equal(h.calls.filter(call => call === 'output-connect').length, 1);
  assert.equal(context.preamp.gain.value, 8);
  assert.equal(context.preamp.target, context.compressor);
  assert.equal(context.compressor.target, context.master);
  assert.equal(context.master.target, context.ceiling);
  assert.equal(context.outputSource, context.ceiling);
  assert.equal(context.compressor.threshold.value, -6);
  assert.equal(context.compressor.ratio.value, 20);
  assert.equal(context.compressor.attack.value, 0);
  assert.equal(context.ceiling.oversample, 'none');
  assert.ok(context.ceiling.curve.every(value => Number.isFinite(value) && Math.abs(value) < 0.99));
  assert.ok(Math.abs(context.ceiling.curve[0] + context.ceiling.curve[1]) < 1e-9);
  await h.player.dispose();
  assert.ok(h.calls.includes('preamp-disconnect'));
  assert.ok(h.calls.includes('compressor-disconnect'));
  assert.ok(h.calls.includes('ceiling-disconnect'));
});

test('pads never create audio or queue attacks through initialization, mute, or disposal', async () => {
  const h = harness({ deferredLibrary: true });
  assert.equal(h.player.padNoteOn('pointer:1', 60, 100), false);
  assert.equal(h.contexts.length, 0);
  const enabling = h.player.enableAudio();
  assert.equal(h.player.padNoteOn('pointer:1', 60, 100), false);
  h.releaseLibrary(); assert.equal(await enabling, true);
  assert.equal(h.synths[1].notes.length, 0);
  assert.equal(h.player.state.hasSong, false);
  assert.equal(h.player.padNoteOn('pointer:1', 60, 100), true);
  h.player.setAudioEnabled(false);
  assert.equal(h.player.padNoteOff('pointer:1'), false);
  assert.equal(h.player.padNoteOn('pointer:2', 64, 100), false);
  h.player.setAudioEnabled(true);
  assert.equal(h.synths[1].notes.length, 1, 're-arming does not resurrect held or rejected gestures');
  await h.player.dispose();
  assert.equal(h.player.padNoteOn('pointer:3', 67, 100), false);
});

test('pads use an isolated piano and their own cloned bank, before any file has been loaded', async () => {
  const h = harness(); await h.player.enableAudio();
  const [file, pads] = h.synths;
  assert.equal(h.contexts.length, 1);
  assert.deepEqual(pads.program, [0, 0]);
  assert.equal(file.bank.byteLength, 16); assert.equal(pads.bank.byteLength, 16);
  assert.notEqual(file.bank, pads.bank);
  assert.equal(file.config.eventsEnabled, true); assert.equal(pads.config.eventsEnabled, true);
  h.contexts[0].currentTime = 7.5;
  assert.equal(h.player.padNoteOn('keyboard:c', 60, 78), true);
  assert.equal(h.player.padNoteOff('keyboard:c'), true);
  assert.deepEqual(pads.notes, [
    ['on', 0, 60, 78, { time: 7.5 }], ['off', 0, 60, { time: 7.5 }],
  ]);
  assert.equal(file.notes.length, 0); assert.equal(h.messages.length, 0);
  await h.player.dispose();
});

test('overlapping pad sources keep a pitch held until its last owner releases', async () => {
  const h = harness(); await h.player.enableAudio(); const pads = h.synths[1];
  assert.equal(h.player.padNoteOn('pointer:1', 60, 100), true);
  assert.equal(h.player.padNoteOn('pointer:1', 60, 100), true);
  assert.equal(h.player.padNoteOn('key:c', 60, 110), true);
  assert.equal(pads.notes.length, 1);
  h.player.padNoteOff('pointer:1'); assert.equal(pads.notes.length, 1);
  h.player.padNoteOff('key:c'); assert.equal(pads.notes.length, 2);
  assert.deepEqual(pads.notes[1], ['off', 0, 60, { time: 0 }]);
  assert.equal(h.player.padNoteOff('key:c'), false);
  h.player.padNoteOn('pointer:2', 62, 100);
  h.player.padNoteOn('pointer:2', 65, 90);
  assert.deepEqual(pads.notes.slice(-2), [['off', 0, 62, { time: 0 }], ['on', 0, 65, 90, { time: 0 }]]);
  await h.player.dispose();
});

test('invalid or excessive pad input is bounded without displacing active holds', async () => {
  const h = harness(); await h.player.enableAudio(); const pads = h.synths[1];
  for (const source of [null, 1, '', 'x'.repeat(129)]) assert.equal(h.player.padNoteOn(source, 60, 100), false);
  for (const note of [undefined, NaN, Infinity, -1, 128, 60.5, '60']) assert.equal(h.player.padNoteOn('a', note, 100), false);
  for (const velocity of [undefined, NaN, Infinity, -1, 0, 128, 20.5, '100']) assert.equal(h.player.padNoteOn('a', 60, velocity), false);
  assert.equal(pads.notes.length, 0);
  for (let index = 0; index < 32; index++) assert.equal(h.player.padNoteOn(`pad:${index}`, index + 48, 100), true);
  assert.equal(h.player.padNoteOn('overflow', 90, 100), false);
  assert.equal(pads.notes.length, 32);
  assert.equal(h.player.padNoteOn('pad:0', 80, 100), true, 'existing sources may change pitch at the limit');
  h.player.releasePads(); assert.equal(pads.stops.at(-1), true);
  assert.equal(h.player.padNoteOff('pad:0'), false);
  assert.equal(h.player.padNoteOn('new', 60, 100), true);
  await h.player.dispose();
});

test('file transport, loading and parse errors do not release or block pad holds', async () => {
  const h = harness({ manualSongs: true }); await h.player.enableAudio();
  const pads = h.synths[1], sequence = h.sequencers[0];
  h.player.padNoteOn('held', 60, 100);
  const loading = h.player.load(midi(), 'pending.mid');
  assert.equal(h.player.padNoteOn('while-loading', 64, 100), true);
  sequence.loaded(); await loading;
  h.player.play(); h.player.seek(2); h.player.pause(); h.player.stop();
  assert.equal(pads.stops.length, 0); assert.equal(pads.notes.length, 2);
  const bad = h.player.load(midi(), 'bad.mid');
  sequence.eventHandler.emit('midiError', new Error('bad track')); assert.equal(await bad, false);
  assert.equal(h.player.padNoteOn('after-error', 67, 100), true);
  assert.equal(h.player.padNoteOff('held'), true);
  assert.equal(pads.stops.length, 0);
  await h.player.dispose();
});

test('pad processor failures and pagehide release both engines and stale holds before recovery', async () => {
  const h = harness(); await ready(h); h.player.padNoteOn('held', 60, 100);
  const [file, pads] = h.synths, oldPadWorklet = pads.worklet;
  oldPadWorklet.emit('processorerror'); await flush();
  assert.equal(h.player.state.audioEnabled, false);
  assert.equal(file.destroyed, true); assert.equal(pads.destroyed, true);
  assert.equal(oldPadWorklet.listeners.size, 0); assert.equal(pads.eventHandler.callbacks.size, 0);
  assert.equal(h.player.padNoteOff('held'), false);
  assert.equal(await h.player.enableAudio(), true);
  assert.equal(h.synths.length, 4); assert.equal(h.synths[3].notes.length, 0);
  assert.equal(h.player.padNoteOn('new', 64, 100), true);
  h.windowEvents.get('pagehide')(); await flush();
  assert.equal(h.synths[2].destroyed, true); assert.equal(h.synths[3].destroyed, true);
  assert.equal(h.synths[3].stops.at(-1), true);
  assert.equal(h.contexts[1].state, 'closed');
});

test('a pad SoundFont failure rejects startup and releases the complete graph', async () => {
  const h = harness({ bankFailure: 1 });
  assert.equal(await h.player.enableAudio(), false);
  assert.match(h.player.state.error, /bad bank/);
  assert.equal(h.contexts[0].state, 'closed'); assert.equal(h.timers.size, 0);
  for (const synth of h.synths) {
    assert.equal(synth.destroyed, true); assert.equal(synth.eventHandler.callbacks.size, 0);
  }
  await h.player.dispose();
});


test('file note attacks carry the current SoundFont instrument name for each MIDI port', async () => {
  const h = harness(); await ready(h); h.player.play();
  h.synths[0].midiChannels = [];
  h.synths[0].midiChannels[0] = { patch: { name: 'Electric bass' } };
  h.synths[0].midiChannels[16] = { patch: { name: 'Saw lead' } };
  for (const channel of [0, 16]) h.synths[0].eventHandler.emit('noteOn', { channel, midiNote: 60, velocity: 100 });
  assert.deepEqual(h.messages.map(message => message.voiceName), ['Electric bass', 'Saw lead']);
  h.synths[0].midiChannels[0].patch.name = 'Strings';
  h.synths[0].eventHandler.emit('noteOn', { channel: 0, midiNote: 64, velocity: 100 });
  assert.equal(h.messages.at(-1).voiceName, 'Strings');
  await h.player.dispose();
});

test('original-file playback preserves the lead-in across replay without changing ordinary audition', async () => {
  const h = harness(); const sequence = await ready(h);
  sequence.midiData = { firstNoteOn: 2.5 };
  const skips = [];
  Object.defineProperty(sequence, 'skipToFirstNoteOn', { set(value) { skips.push(value); }, configurable: true });
  await h.player.load(midi(), 'original.mid', { preserveLeadIn: true });
  assert.equal(h.player.play(), true);
  h.player.stop(); h.player.play();
  assert.deepEqual(skips, [], 'the original starts at its real beat zero, including silence');
  await h.player.load(midi(), 'audition.mid');
  h.player.play();
  assert.deepEqual(skips, [true, false], 'normal quick auditions retain their existing lead-in skip');
  await h.player.dispose();
});

test('note effects are retained before Audio and sent to both engines without changing transport', async () => {
  const h = harness();
  const config = h.player.setNoteEffects({ enabled: true, transpose: 12, chord: 'major', echoCount: 2 });
  assert.equal(h.contexts.length, 0);
  assert.equal(config.transpose, 12);
  await ready(h); h.player.play(); h.sequencers[0].currentTime = 4;
  assert.ok(h.calls.find(call => Array.isArray(call) && call[0] === 'worklet')[1].endsWith('/midiphoria-processor.js'));
  for (const synth of h.synths) assert.equal(synth.worklet.messages.at(-1).config.chord, 'major');
  h.player.setNoteEffects({ enabled: false });
  assert.equal(h.player.state.playing, true); assert.equal(h.player.state.time, 4);
  for (const synth of h.synths) {
    const message = synth.worklet.messages.at(-1);
    assert.equal(message.type, 'midiphoriaNoteEffects');
    assert.equal(message.config.enabled, false); assert.equal(message.config.transpose, 12);
  }
  await h.player.dispose();
});

test('effected pad notes reach graphics without a file and clear independently from its transport', async () => {
  const h = harness(); await h.player.enableAudio();
  h.synths[1].eventHandler.emit('noteOn', { channel: 0, midiNote: 72, velocity: 88 });
  h.synths[1].eventHandler.emit('noteOff', { channel: 0, midiNote: 72 });
  assert.deepEqual(h.messages, [
    { type: 'noteOn', channel: 0, sourceId: 'midiphoria:pads', note: 72, velocity: 88, voiceName: 'Piano' },
    { type: 'noteOff', channel: 0, sourceId: 'midiphoria:pads', note: 72, velocity: 0, voiceName: 'Piano' },
  ]);
  const clearCount = h.clears.filter(([source]) => source === 'midiphoria:pads').length;
  h.player.pause();
  assert.equal(h.clears.filter(([source]) => source === 'midiphoria:pads').length, clearCount);
  h.player.releasePads();
  assert.equal(h.clears.at(-1)[0], 'midiphoria:pads');
  h.player.setAudioEnabled(false);
  h.synths[1].eventHandler.emit('noteOn', { channel: 0, midiNote: 74, velocity: 88 });
  assert.equal(h.messages.length, 2, 'late muted attacks cannot revive pad graphics');
  await h.player.dispose();
});


test('BLECH opts into 64× file playback while the default player retains 8× and continuous phase', async () => {
  const ordinary = harness(); assert.equal(ordinary.player.setPlaybackRate(64), 8); await ordinary.player.dispose();
  const h = harness({ minPlaybackRate: .01, maxPlaybackRate: 64 });
  assert.equal(h.player.setPlaybackRate(40), 40);
  const seq = await ready(h); assert.equal(seq.options.initialPlaybackRate, 40);
  h.player.play(); seq.currentTime = 4; const before = h.calls.length;
  assert.equal(h.player.setPlaybackRate(64), 64); assert.equal(seq.playbackRate, 64);
  assert.equal(h.player.state.time, 4); assert.equal(h.player.state.playing, true);
  assert.equal(h.calls.slice(before).includes('pause'), false);
  assert.equal(h.player.setPlaybackRate(640), 64); assert.equal(h.player.setPlaybackRate(NaN), 64);
  await h.player.dispose();
  let now = 0; const visual = harness({ maxPlaybackRate: 64, clock: () => now });
  await visual.player.loadVisualTimeline(600, 'Fast artwork'); visual.player.play(); now = 1;
  visual.player.setPlaybackRate(64); assert.equal(visual.player.state.time, 1);
  now = 2; assert.equal(visual.player.state.time, 65);
  visual.player.pause(); now = 3; assert.equal(visual.player.state.time, 65); await visual.player.dispose();
});

test('file cycle telemetry retains every fast loop and excludes explicit seek acknowledgements', async () => {
  const h = harness({ maxPlaybackRate: 64 }); const seq = await ready(h);
  // The pinned sequencer emits one initial seek for load and one for our reset.
  seq.eventHandler.emit('timeChange', 0); seq.eventHandler.emit('timeChange', 0);
  h.player.setLoop(true); h.player.setPlaybackRate(64); h.player.play();
  for (let cycle = 0; cycle < 100; cycle++) seq.eventHandler.emit('timeChange', 0);
  assert.equal(h.player.state.cycle, 100);
  h.player.seek(3); h.player.seek(4);
  seq.eventHandler.emit('timeChange', 3); seq.eventHandler.emit('timeChange', 4);
  assert.equal(h.player.state.cycle, 0);
  seq.eventHandler.emit('timeChange', 0); assert.equal(h.player.state.cycle, 1);
  h.player.pause(); seq.eventHandler.emit('timeChange', 0); assert.equal(h.player.state.cycle, 1);
  await h.player.dispose();
});

test('visual cycle telemetry counts all unseen cycles at 64x and pauses without counting idle time', async () => {
  let now = 0; const h = harness({ clock: () => now, maxPlaybackRate: 64 });
  await h.player.loadVisualTimeline(4, 'Dense artwork'); h.player.setLoop(true); h.player.setPlaybackRate(64);
  h.player.play(); now = 1000;
  assert.equal(h.player.state.cycle, 16000); assert.equal(h.player.state.time, 0);
  h.player.pause(); now = 2000; assert.equal(h.player.state.cycle, 16000);
  h.player.seek(2); assert.equal(h.player.state.cycle, 0);
  h.player.play(); now = 2001; assert.equal(h.player.state.cycle, 16); assert.equal(h.player.state.time, 2);
  h.player.stop(); assert.equal(h.player.state.cycle, 0); assert.equal(h.contexts.length, 0);
  await h.player.dispose();
});
