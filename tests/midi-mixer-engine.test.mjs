import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiMixerClock, MAX_EVENTS_PER_BLOCK } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { defaultDeckConfig, parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { encodeSoundFont } from '../src/site/sound-fonts/soundfont.js';

const data = (beats = 4) => ({ events: [{ beat: 0, kind: 9, channel: 0, a: 60, b: 90 }, { beat: beats / 2, kind: 8, channel: 0, a: 60, b: 0 }], controllers: [], channels: [{ channel: 0, drums: false }], loopBeats: beats });
test('two deck clocks stay aligned over an hour, loop against absolute beats and change tempo without phase reset', () => {
  const attacks = [[], []]; let frames = 0;
  const clock = new MidiMixerClock({ emit: (deck, event, frame) => { if (event.kind === 9) attacks[deck].push(frames + frame); } });
  for (let i = 0; i < 2; i++) clock.load(i, data(4), defaultDeckConfig(), []);
  clock.setTransport(true);
  for (let block = 0; block < 48000 * 60 * 60 / 128; block++) {
    if (block === 10000) { const before = clock.beat; clock.tempo = 173; assert.equal(clock.beat, before); }
    clock.process(128, 48000); frames += 128;
  }
  assert.deepEqual(attacks[0], attacks[1]); assert.ok(attacks[0].length > 2000);
  assert.equal(clock.skippedEvents, 0);
});
test('offset, unequal loop lengths, deck swap, pause and stale-attack exclusion preserve master time', () => {
  const attacks = [], clock = new MidiMixerClock({ emit: (deck, event, frame) => { if (event.kind === 9) attacks.push({ deck, beat: clock.beat + frame / 24000 }); } });
  clock.load(0, data(4), defaultDeckConfig(), []); clock.load(1, data(3), { ...defaultDeckConfig(), offsetBeats: 1 }, []);
  clock.setTransport(true);
  for (let i = 0; i < 1000; i++) clock.process(128, 48000);
  assert.ok(attacks.some(note => note.deck === 1 && Math.abs(note.beat - 2) < 0.0001));
  const beat = clock.beat; clock.load(1, data(), defaultDeckConfig(), []); assert.equal(clock.beat, beat);
  assert.equal(attacks.filter(note => note.deck === 1 && note.beat === beat).length, 0, 'no overdue attack at load');
  clock.setTransport(false); clock.process(48000, 48000); assert.equal(clock.beat, beat);
});
test('overload is bounded per quantum and releases held notes instead of growing a backlog', () => {
  let emitted = 0, released = 0;
  const clock = new MidiMixerClock({ emit: () => emitted++, release: () => released++ });
  clock.load(0, { ...data(), events: Array.from({ length: 20000 }, () => ({ beat: 0, kind: 9 })) }, defaultDeckConfig(), []);
  clock.setTransport(true); clock.process(128, 48000);
  assert.equal(emitted, MAX_EVENTS_PER_BLOCK); assert.equal(clock.skippedEvents, 20000 - MAX_EVENTS_PER_BLOCK); assert.ok(released >= 3);
  clock.process(128, 48000); assert.equal(emitted, MAX_EVENTS_PER_BLOCK);
});
test('loading, channel edits and Play do not construct Audio; silent clock joins live edits without restarting', async () => {
  let now = 0, constructed = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { constructed++; } } } });
  engine.configureChannel(0, 0, { mute: true, program: 80 });
  await engine.loadDeck(0, generateTextMidi('A').buffer, 'A');
  assert.equal(engine.state.decks[0].channels[0].mute, true); assert.equal(engine.state.decks[0].channels[0].program, 80);
  assert.equal(engine.play(), true); now = 1000; assert.equal(engine.state.beat, 2);
  engine.setTempo(180); now = 2000; assert.equal(engine.state.beat, 5);
  await engine.loadDeck(1, generateTextMidi('B').buffer, 'B'); assert.equal(engine.state.beat, 5); assert.equal(engine.state.playing, true);
  engine.configureDeck(0, { transpose: 99, gain: -1, offsetBeats: 4 }); assert.equal(engine.state.decks[0].config.transpose, 24); assert.equal(engine.state.decks[0].config.gain, 0);
  assert.equal(constructed, 0); assert.equal(engine.state.audioEnabled, false);
  engine.pause(); now = 3000; assert.equal(engine.state.beat, 5); engine.stop(); assert.equal(engine.state.beat, 0); await engine.dispose();
});
test('actual SoundFont processor generates finite sound, mute/solo and crossfade silence, and excludes percussion from transpose', async () => {
  let Processor;
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const processor = new Processor();
  const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
  const analysis = parseMidi(generateTextMidi('HI').buffer);
  analysis.channels.push({ channel: 9, drums: true });
  const channels = analysis.channels.map(channel => ({ channel: channel.channel, mute: false, solo: false, program: null }));
  await processor.command({ type: 'load', index: 0, data: compileDeck(analysis), config: defaultDeckConfig(), channels });
  await processor.command({ type: 'transport', playing: true, beat: 0 });
  const render = blocks => {
    let energy = 0, peak = 0;
    for (let block = 0; block < blocks; block++) {
      const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
      for (const sample of output[0]) { assert.ok(Number.isFinite(sample)); energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      globalThis.currentTime += 128 / 48000;
    }
    return { rms: Math.sqrt(energy / (blocks * 128)), peak };
  };
  const sound = render(500); assert.ok(sound.rms > 0.001, `SoundFont produced ${sound.rms}`);
  await processor.command({ type: 'deck', index: 0, config: { ...defaultDeckConfig(), transpose: 12 }, channels });
  assert.equal(processor.synth.midiChannels[0].systemParameters.keyShift, 12);
  assert.equal(processor.synth.midiChannels[1].systemParameters.keyShift, 0, 'percussion does not transpose');
  await processor.command({ type: 'deck', index: 0, config: defaultDeckConfig(), channels: channels.map(channel => ({ ...channel, solo: channel.channel === 9 })) });
  assert.equal(processor.synth.midiChannels[0].systemParameters.isMuted, true, 'solo percussion mutes melody');
  render(1500); assert.ok(render(100).rms < sound.rms / 100, 'muted voice reaches silence');
  await processor.command({ type: 'deck', index: 0, config: defaultDeckConfig(), channels: channels.map(channel => ({ ...channel, program: channel.channel === 0 ? 80 : null })) });
  assert.equal(processor.synth.midiChannels[0].patch.program, 80);
  await processor.command({ type: 'deck', index: 0, config: defaultDeckConfig(), channels });
  assert.equal(processor.synth.midiChannels[0].patch.program, analysis.channels[0].program, 'original program restores immediately');
  const beforeFont = processor.clock.beat;
  await processor.command({ type: 'soundfont', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), token: 1 });
  assert.equal(processor.clock.beat, beforeFont, 'SoundFont swap retains shared phase');
  const acceptedBank = processor.activeSoundBank, replies = [];
  processor.port.postMessage = message => replies.push(message);
  await processor.command({ type: 'soundfont', soundfont: new ArrayBuffer(12), token: 2 });
  assert.equal(processor.activeSoundBank, acceptedBank, 'a malformed replacement retains the accepted bank');
  assert.equal(processor.clock.beat, beforeFont, 'failed bank import does not move transport');
  assert.match(replies.find(message => message.token === 2)?.error || '', /.+/);
  const manager = processor.synth.soundBankManager, add = manager.addSoundBank.bind(manager);
  let rejectReplacement = true;
  manager.addSoundBank = (bank, id) => { add(bank, id); if (rejectReplacement) { rejectReplacement = false; throw new Error('Simulated bank commit failure'); } };
  await processor.command({ type: 'soundfont', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), token: 3 });
  assert.equal(manager.soundBankList.find(bank => bank.id === 'midi-mixer').soundBank, acceptedBank, 'a partial replacement restores the previous bank');
  assert.match(replies.find(message => message.token === 3)?.error || '', /Simulated/);
  manager.addSoundBank = add;
  await processor.command({ type: 'crossfade', value: 1 }); render(1000); const quiet = render(100);
  assert.ok(quiet.rms < sound.rms / 100, `crossfade silence ${quiet.rms}`);
  await processor.command({ type: 'dispose' }); assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});
test('grabbed loop regions repeat only their notes; nonloop playback releases at the selected boundary', () => {
  const emitted = [], releases = [];
  const clock = new MidiMixerClock({ emit: (_deck, event) => emitted.push(event.a), release: (_deck, frame) => releases.push(frame) });
  const regionData = { ...data(16), events: [0, 2, 4, 6, 8, 10].map(beat => ({ beat, channel: 0, kind: 9, a: 60 + beat, b: 90 })) };
  clock.load(0, regionData, { ...defaultDeckConfig(), loopStartBeats: 4, loopEndBeats: 8 }, []); clock.setTransport(true);
  for (let i = 0; i < 3000; i++) clock.process(128, 48000);
  assert.deepEqual([...new Set(emitted)], [64, 66]); assert.ok(emitted.length >= 8);
  clock.setDeck(0, { ...defaultDeckConfig(), loopStartBeats: 4, loopEndBeats: 8, loop: false }, []); clock.setTransport(true, 0);
  const before = releases.length;
  for (let i = 0; i < 2000; i++) clock.process(128, 48000);
  assert.equal(releases.length, before + 1, 'end releases once, not every block');
});
test('scrubbing keeps global tempo phase, effect bounds stay finite, and SoundFont import does not arm Audio', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  await engine.loadDeck(0, generateTextMidi('ABC').buffer, 'ABC');
  engine.play(); now = 7000; const beat = engine.state.beat;
  engine.configureDeck(0, { loopStartBeats: 1, loopEndBeats: 3 }); engine.seekDeck(0, 2.5);
  assert.equal(engine.state.beat, beat); assert.equal(engine.state.decks[0].positionBeats, 2.5); assert.equal(engine.state.decks[0].loopBeats, 2);
  engine.configureEffects({ filterHz: 0, delayMix: 2, delayBeats: 100, feedback: 1 });
  assert.deepEqual(engine.state.effects, { filterHz: 60, delayMix: 0.75, delayBeats: 4, feedback: 0.8, synth: {} });
  const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  await engine.loadSoundFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), 'Imported bank');
  assert.equal(engine.state.soundfontName, 'Imported bank'); assert.equal(engine.context, null); assert.equal(engine.state.audioEnabled, false);
  await assert.rejects(engine.loadSoundFont(new ArrayBuffer(12)), /not an SF2/); await engine.dispose();
});
test('a corrupt sample reference is rejected while Audio is off without replacing the accepted bank', async () => {
  let constructed = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => 0 }, AudioContext: class { constructor() { constructed++; } } } });
  try {
    const original = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    const bytes = original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength);
    await engine.loadSoundFont(bytes, 'Working bank');
    const accepted = engine._font, broken = bytes.slice(0), view = new DataView(broken);
    const igen = original.indexOf(Buffer.from('igen')) + 8;
    let mutated = false;
    for (let at = igen; at < igen + view.getUint32(igen - 4, true); at += 4) {
      if (view.getUint16(at, true) === 53) { view.setUint16(at + 2, 65535, true); mutated = true; break; }
    }
    assert.ok(mutated);
    await assert.rejects(engine.loadSoundFont(broken, 'Corrupt bank'), /sample|undefined|invalid/i);
    assert.equal(engine._font, accepted); assert.equal(engine.state.soundfontName, 'Working bank');
    assert.equal(engine.context, null); assert.equal(constructed, 0); assert.equal(engine.state.audioEnabled, false);
  } finally { await engine.dispose(); }
});
test('half-speed and up to eight-times-speed files share exact master-beat alignment across independent loops', () => {
  for (const rate of [2, 8]) {
    const attacks = [[], []]; let absoluteFrame = 0;
    const clock = new MidiMixerClock({ emit: (deck, event, frame) => { if (event.kind === 9) attacks[deck].push(absoluteFrame + frame); } });
    clock.load(0, data(1), { ...defaultDeckConfig(), rate }, []);
    clock.load(1, data(1), { ...defaultDeckConfig(), rate: 0.5 }, []); clock.setTransport(true);
    for (let index = 0; index < 3000; index++) { clock.process(128, 48000); absoluteFrame += 128; }
    assert.equal(attacks[0].length, attacks[1].length * rate * 2);
    assert.deepEqual(attacks[1], attacks[0].filter((_, index) => index % (rate * 2) === 0));
  }
});
test('changing a deck ratio preserves source position and scrub follows that ratio', async () => {
  let now = 0; const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  await engine.loadDeck(0, generateTextMidi('ABCDEFGHIJK').buffer); engine.play(); now = 1700;
  const before = engine.state.decks[0].positionBeats; engine.configureDeck(0, { rate: 8 });
  assert.ok(Math.abs(engine.state.decks[0].positionBeats - before) < 1e-12);
  now += 100; assert.ok(Math.abs(engine.state.decks[0].positionBeats - before - 1.6) < 1e-7);
  engine.seekDeck(0, 2); assert.equal(engine.state.decks[0].positionBeats, 2); await engine.dispose();
});
test('resume restores currently held notes with a bounded interval query without retriggering finished attacks', async () => {
  const { heldNotesAt } = await import('../src/instruments/midi-mixer/midi-mixer-clock.js');
  const analysis = { events: [], channels: [{ channel: 0 }], meterMap: [{ numerator: 4, denominator: 4 }], durationBeats: 100,
    notes: Array.from({ length: 1000 }, (_, index) => ({ beat: index / 100, duration: index === 0 ? 90 : 0.1, channel: 0, note: index % 127, velocity: 100 })) };
  const compiled = compileDeck(analysis);
  assert.deepEqual(heldNotesAt(compiled.held, 50).map(event => event.a), [0], 'long held note survives thousands of expired short notes');
  assert.equal(heldNotesAt(compiled.held, 95).length, 0);
  const emitted = [], clock = new MidiMixerClock({ emit: (_deck, event) => emitted.push(event) });
  clock.load(0, compiled, defaultDeckConfig(), []); clock.setTransport(true, 50);
  assert.equal(emitted.length, 1); assert.equal(emitted[0].a, 0);
  clock.setTransport(false); assert.equal(emitted.length, 1, 'pause never attacks notes');
});
test('held notes crossing a nonloop region start remain silent until a negative offset reaches it', () => {
  const analysis = { events: [], channels: [{ channel: 0 }], meterMap: [{ numerator: 4, denominator: 4 }], durationBeats: 100,
    notes: [{ beat: 0, duration: 90, channel: 0, note: 60, velocity: 100 }] };
  const emitted = [], clock = new MidiMixerClock({ emit: (_deck, event, frame) => emitted.push({ event, at: clock.beat + frame / 24000 }) });
  clock.load(0, compileDeck(analysis), { ...defaultDeckConfig(), loop: false, loopStartBeats: 8, loopEndBeats: 12, offsetBeats: -2 }, []);
  clock.setTransport(true, 0); assert.equal(emitted.length, 0, 'no early held-note attack on resume');
  for (let i = 0; i < 500; i++) clock.process(128, 48000);
  assert.equal(emitted.length, 1); assert.ok(Math.abs(emitted[0].at - 2) < 0.0001);
  clock.setTransport(true, 20); assert.equal(emitted.length, 1, 'no held note restored after the region ends');
});
test('long imported timelines can seek beyond two thousand beats', async () => {
  const engine = new MidiMixerEngine(); await engine.loadDeck(0, generateTextMidi('A').buffer);
  engine._decks[0].analysis.durationBeats = 1000000;
  engine.seekDeck(0, 750000); assert.equal(engine.state.decks[0].positionBeats, 750000);
  engine.configureDeck(0, { offsetBeats: 3500000 }); assert.equal(engine.state.decks[0].config.offsetBeats, 3500000);
  await engine.dispose();
});
function deferredFontRuntime() {
  const pending = { contexts: [], uploads: [], initialized: null, fetchResolve: null, now: 0, transport: null };
  const parameter = () => ({ value: 0, cancelAndHoldAtTime() {}, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } });
  class Node {
    constructor() { for (const name of ['gain', 'frequency', 'Q', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = parameter(); }
    connect() {} disconnect() {} addEventListener() {} removeEventListener() {}
  }
  class Context {
    constructor() { pending.contexts.push(this); this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; }
    createGain() { return new Node(); } createDynamicsCompressor() { return new Node(); } createWaveShaper() { return new Node(); } createBiquadFilter() { return new Node(); } createDelay() { return new Node(); }
    addEventListener() {} removeEventListener() {} async resume() {} async close() { this.state = 'closed'; }
  }
  class Worklet extends Node {
    constructor() {
      super(); this.port = { onmessage: null, close() {}, postMessage: message => {
        if (message.type === 'transport') pending.transport = message;
        if (message.type === 'initialize') pending.initialized = { message, ready: () => this.port.onmessage({ data: { type: 'ready' } }) };
        if (message.type === 'soundfont') pending.uploads.push({ message, complete: error => this.port.onmessage({ data: { type: 'soundfont', token: message.token, error } }) });
      } };
    }
  }
  return { pending, runtime: { AudioContext: Context, AudioWorkletNode: Worklet, setTimeout, clearTimeout, performance: { now: () => pending.now }, fetch: () => new Promise(resolve => { pending.fetchResolve = buffer => resolve({ ok: true, arrayBuffer: async () => buffer }); }) } };
}
const taggedFont = marker => encodeSoundFont({ name: `Bank ${marker}`, samples: [{ data: new Float32Array(64).fill(.1) }] });
const fontMarker = bytes => { const data = Buffer.from(bytes); return data[data.indexOf(Buffer.from('Bank ')) + 5] - 48; };
async function untilMicrotasks(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve(); assert.ok(predicate()); }
test('the latest SoundFont selection wins changes during fetch, processor initialization and pending bank acknowledgement', async () => {
  const { runtime, pending } = deferredFontRuntime(), engine = new MidiMixerEngine({ runtime, connectOutput: () => () => {} });
  await engine.loadDeck(0, generateTextMidi('A').buffer); engine.play(); pending.now = 6000; engine.pause(); engine.play(); pending.now = 7000;
  const arming = engine.enableAudio();
  await engine.loadSoundFont(taggedFont(2), 'During fetch'); pending.fetchResolve(taggedFont(1));
  await untilMicrotasks(() => pending.initialized);
  assert.equal(fontMarker(pending.initialized.message.soundfont), 2);
  await engine.loadSoundFont(taggedFont(3), 'During processor startup'); pending.initialized.ready();
  await untilMicrotasks(() => pending.uploads.length === 1);
  engine.node.port.onmessage({ data: { type: 'state', beat: 0, at: 0, tempo: 120, skippedEvents: 0, voices: 0, droppedVisualEvents: 0 } });
  assert.equal(engine.state.beat, 14, 'intermediate bank telemetry cannot replace the silent transport phase');
  assert.equal(engine.state.audioEnabled, false, 'arming stays muted until the pending bank is active');
  await engine.loadSoundFont(taggedFont(4), 'Newest bank'); pending.uploads[0].complete();
  await untilMicrotasks(() => pending.uploads.length === 2); pending.uploads[1].complete();
  assert.equal(await arming, true);
  assert.deepEqual(pending.uploads.map(upload => fontMarker(upload.message.soundfont)), [3, 4]);
  assert.equal(engine.state.soundfontName, 'Newest bank'); assert.equal(fontMarker(engine._font.buffer), 4);
  assert.equal(pending.contexts.length, 1); assert.equal(pending.transport.beat, 14); await engine.dispose();
});
test('a malformed pending SoundFont during arming retains the acknowledged working bank', async () => {
  const { runtime, pending } = deferredFontRuntime(), engine = new MidiMixerEngine({ runtime, connectOutput: () => () => {} });
  const arming = engine.enableAudio(); pending.fetchResolve(taggedFont(1)); await untilMicrotasks(() => pending.initialized);
  await engine.loadSoundFont(taggedFont(2), 'Malformed bank'); pending.initialized.ready();
  await untilMicrotasks(() => pending.uploads.length === 1); pending.uploads[0].complete('Invalid SoundFont sample data');
  assert.equal(await arming, true); assert.equal(engine.state.soundfontName, 'TimGM6mb'); assert.equal(engine._font, null);
  assert.match(engine.state.error, /Invalid SoundFont/); assert.equal(pending.contexts.length, 1); await engine.dispose();
});
