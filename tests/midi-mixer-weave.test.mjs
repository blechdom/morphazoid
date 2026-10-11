import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiMixerClock, heldNotesAt } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { defaultDeckConfig, defaultWeaveConfig, sanitizeWeaveConfig, weavePosition, parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
function midi(tracks, end = 8) {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const chunks = tracks.map(messages => {
    let previous = 0; const data = [];
    for (const [beat, ...message] of [...messages].sort((a, b) => a[0] - b[0]).concat([[end, 255, 47, 0]])) {
      const tick = Math.round(beat * 960); data.push(...vlq(tick - previous), ...message); previous = tick;
    }
    const output = new Uint8Array(data.length + 8); output.set([77, 84, 114, 107]); new DataView(output.buffer).setUint32(4, data.length); output.set(data, 8); return output;
  });
  const output = new Uint8Array(14 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)), view = new DataView(output.buffer);
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0]); view.setUint16(10, tracks.length); view.setUint16(12, 960);
  let offset = 14; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output.buffer;
}
const weave = partial => sanitizeWeaveConfig({ enabled: true, unit: 'beats', ...partial });
const phase = { startBeat: 0, deckBeats: [0, 0] };
const setup = buffer => compileDeck(parseMidi(buffer));
const held = pitch => midi([[[0, 192, 16], [0, 144, pitch, 100], [8, 128, pitch, 0]]]);

test('custom Weave patterns preserve source counts, running positions and bounded configuration', () => {
  assert.deepEqual(weavePosition(7.5, weave({ pattern: 'ABBA' }), phase).deckBeats, [3.5, 4]);
  assert.deepEqual(weavePosition(7.5, weave({ pattern: 'ABBA', advance: 'running' }), phase).deckBeats, [7.5, 7.5]);
  assert.deepEqual(weavePosition(3.25, weave({ pattern: 'A' }), phase).deckBeats, [3.25, 0]);
  assert.equal(sanitizeWeaveConfig({ pattern: ' a b / b a ', length: 100, barBeats: 0 }).pattern, 'ABBA');
  assert.equal(sanitizeWeaveConfig({ length: 100 }).length, 16);
  assert.deepEqual(defaultWeaveConfig(), { enabled: false, pattern: 'AB', length: 1, unit: 'bars', barBeats: 4, advance: 'turns' });
});

test('audio-frame Weave rehydrates held notes and hard releases the outgoing deck exactly on each handoff', () => {
  const events = []; let frameBase = 0;
  const clock = new MidiMixerClock({ emit: (deck, event, frame = 0) => { if (event.kind === 9) events.push(['on', deck, frameBase + frame, event.a]); }, release: (deck, frame = 0, hard) => { if (hard) events.push(['off', deck, frameBase + frame]); } });
  [60, 72].forEach((pitch, index) => clock.load(index, setup(held(pitch)), defaultDeckConfig(), []));
  clock.setWeave(weave({}), phase); events.length = 0; clock.setTransport(true);
  for (let block = 0; block < 1501; block++) { clock.process(128, 48000); frameBase += 128; }
  const attacks = events.filter(event => event[0] === 'on');
  assert.deepEqual(attacks.slice(0, 8).map(event => event[1]), [0, 1, 0, 1, 0, 1, 0, 1]);
  attacks.slice(0, 8).forEach((event, index) => assert.ok(Math.abs(event[2] - index * 24000) <= 1));
  for (const attack of attacks.slice(1)) assert.ok(events.some(event => event[0] === 'off' && event[1] !== attack[1] && event[2] === attack[2]));
  assert.equal(clock.skippedEvents, 0);
});

test('turns consume unequal ratios only during ownership and consecutive identical steps do not retrigger', () => {
  const attacks = [], clock = new MidiMixerClock({ emit: (deck, event) => { if (event.kind === 9) attacks.push([deck, event.a]); } });
  for (let index = 0; index < 2; index++) clock.load(index, setup(held(60 + index)), { ...defaultDeckConfig(), rate: index ? .5 : 8 }, []);
  clock.setWeave(weave({ pattern: 'AABB' }), phase); clock.setTransport(true);
  clock.process(48000, 48000);
  assert.deepEqual(attacks, [[0, 60], [0, 60]], 'only source loop retriggers within two uninterrupted A beats');
  clock.process(24000, 48000);
  assert.equal(attacks.at(-1)[0], 1);
  assert.equal(clock.decks[0].cursor, 2);
});

test('engine reverse is source-preserving, maps a playing cursor, honors explicit recall and Weave changes retain position', async () => {
  let now = 0; const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const bytes = midi([[[0, 144, 60, 100], [1, 128, 60, 0], [5, 144, 67, 100], [7, 128, 67, 0]]]);
  await engine.loadDeck(0, bytes); await engine.loadDeck(1, bytes);
  engine.configureDeck(0, { reverse: 'notes' }); assert.equal(engine.state.decks[0].positionBeats, 0);
  assert.equal(engine.state.decks[0].analysis.notes[0].note, 67); assert.equal(engine.state.decks[0].sourceAnalysis.notes[0].note, 60);
  engine.configureDeck(0, { reverse: 'off' }); assert.deepEqual(new Uint8Array(engine.getDeckMidi(0)), new Uint8Array(bytes));
  engine.play(); now = 750; engine.configureDeck(0, { reverse: 'controllers' }); assert.equal(engine.state.decks[0].positionBeats, 6.5);
  engine.configureDeck(0, { reverse: 'notes' }); assert.equal(engine.state.decks[0].positionBeats, 6.5);
  engine.configureDeck(0, { reverse: 'off', offsetBeats: 2, loopStartBeats: 1, loopEndBeats: 4 }); assert.equal(engine.state.decks[0].config.offsetBeats, 2);
  const before = engine.state.decks.map(deck => deck.positionBeats); engine.configureWeave({ enabled: true, unit: 'beats' });
  assert.deepEqual(engine.state.decks.map(deck => deck.positionBeats), before); now += 500;
  assert.equal(engine.state.currentWeaveDeck, 1); assert.equal(engine.state.decks[1].positionBeats, before[1]);
  const position = engine.state.decks[1].positionBeats; engine.configureDeck(1, { rate: 8 }); assert.equal(engine.state.decks[1].positionBeats, position);
  engine.seekDeck(1, 3); assert.equal(engine.state.decks[1].positionBeats, 3);
  engine.configureWeave({ enabled: false }); assert.equal(engine.state.decks[1].positionBeats, 3);
  engine.stop(); assert.equal(engine.state.weaveStep, 0); assert.equal(engine.state.audioEnabled, false); await engine.dispose();
});

test('explicit forward loading bypasses inherited reverse without changing other deck settings or original bytes', async () => {
  const engine = new MidiMixerEngine(); await engine.loadDeck(0, held(60));
  engine.configureDeck(0, { reverse: 'controllers', rate: 2, gain: .7 }); engine.play();
  const original = midi([[[0, 144, 60, 100], [1, 128, 60, 0], [5, 144, 67, 100], [7, 128, 67, 0]]]);
  const deck = await engine.loadDeck(0, original, 'Edit source', { reverse: 'off' });
  assert.equal(deck.config.reverse, 'off'); assert.equal(deck.analysis, deck.sourceAnalysis);
  assert.deepEqual(deck.analysis.notes.map(note => note.note), [60, 67]);
  assert.equal(deck.config.rate, 2); assert.equal(deck.config.gain, .7); assert.equal(engine.state.playing, true);
  assert.deepEqual(new Uint8Array(engine.getDeckMidi(0)), new Uint8Array(original));
  await assert.rejects(engine.loadDeck(0, new Uint8Array([0]), 'invalid', { reverse: 'notes' }));
  assert.equal(engine.state.decks[0].config.reverse, 'off'); assert.equal(engine.state.decks[0].analysis, deck.analysis);
  engine.configureDeck(0, { reverse: 'notes' });
  assert.equal((await engine.loadDeck(0, original)).config.reverse, 'notes', 'ordinary song changes retain direction');
  await engine.dispose();
});

test('excessive controller history rejects atomically without replacing the playing source or export', async () => {
  const engine = new MidiMixerEngine(); const original = held(60);
  await engine.loadDeck(0, original, 'original'); engine.configureDeck(0, { reverse: 'controllers' }); engine.play();
  const before = engine.getDeckMidi(0), analysis = engine.state.decks[0].analysis;
  const messages = [[0, 144, 60, 100]];
  for (let parameter = 0; parameter < 700; parameter++) messages.push([0, 176, 99, parameter >> 7], [0, 176, 98, parameter & 127], [0, 176, 6, 64], [0, 176, 38, 0]);
  messages.push([7, 128, 60, 0]);
  await assert.rejects(engine.loadDeck(0, midi([messages]), 'oversized controls'), /4,096/);
  assert.equal(engine.state.decks[0].name, 'original'); assert.equal(engine.state.decks[0].analysis, analysis);
  assert.deepEqual(new Uint8Array(engine.getDeckMidi(0)), new Uint8Array(before)); assert.equal(engine.state.playing, true);
  await engine.dispose();
});

test('chased sustain and sostenuto gates include released keys and exclude uncaptured notes', () => {
  const compiled = setup(midi([[[0, 144, 60, 100], [1, 176, 66, 127], [1.5, 144, 64, 100], [2, 128, 60, 0], [2, 128, 64, 0], [4, 176, 66, 0], [5, 144, 67, 100], [5, 176, 64, 127], [6, 128, 67, 0], [7, 176, 64, 0]]]));
  const notes = heldNotesAt(compiled.held, 3);
  assert.deepEqual(notes.map(note => [note.a, note.keyReleased, note.sostenutoHeld]), [[60, true, true]]);
  assert.deepEqual(heldNotesAt(compiled.held, 6.5).map(note => [note.a, note.keyReleased]), [[67, true]]);
  assert.equal(heldNotesAt(compiled.held, 7.5).length, 0);
});

test('native synth renders before boundary restoration and stamp clock advances once through Weave', async () => {
  let Processor; globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const processor = new Processor(), font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
  for (let index = 0; index < 2; index++) await processor.command({ type: 'load', index, data: setup(held(60 + index * 12)), config: defaultDeckConfig(), channels: [{ channel: 0 }] });
  await processor.command({ type: 'weave', config: weave({}), phase });
  await processor.command({ type: 'transport', playing: true, beat: 0 });
  const render = frames => { const channels = [new Float32Array(frames), new Float32Array(frames)]; processor.process([], [channels]); globalThis.currentTime += frames / 48000; return channels; };
  for (let i = 0; i < 187; i++) render(128); // 23,936 frames; switch is 64 samples into next block.
  const trace = [], process = processor.synth.process.bind(processor.synth), restore = processor.restore.bind(processor);
  processor.synth.process = (left, right, offset, count) => { trace.push(['render', offset, count]); return process(left, right, offset, count); };
  processor.restore = (...args) => { trace.push(['restore', args[0], processor.renderOffset]); return restore(...args); };
  const sampleBeat = processor.sampleClock.beat, output = render(128);
  assert.deepEqual(trace.filter(item => item[0] === 'render'), [['render', 0, 64], ['render', 64, 64]]);
  assert.ok(trace.findIndex(item => item[0] === 'restore' && item[1] === 1 && item[2] === 64) > trace.findIndex(item => item[0] === 'render'));
  assert.ok(Math.abs(processor.sampleClock.beat - sampleBeat - 128 / 24000) < 1e-10);
  assert.ok(output.flatMap(channel => [...channel]).every(Number.isFinite));
  assert.ok(output[0].some(value => Math.abs(value) > .0001));
  assert.equal(processor.ready, true);
  const controlBytes = midi([[[0, 176, 101, 0], [0, 176, 100, 0], [0, 176, 6, 12], [0, 176, 38, 0],
    [0, 176, 100, 1], [0, 176, 6, 70], [0, 176, 38, 40], [0, 176, 0, 2], [0, 192, 16],
    [1, 176, 0, 3], [0, 144, 60, 100], [4, 176, 74, 10], [7, 128, 60, 0]]]);
  const compiled = setup(controlBytes), emitted = [], emit = processor.emit.bind(processor);
  processor.emit = (deck, event, ...args) => { emitted.push(event); return emit(deck, event, ...args); };
  await processor.command({ type: 'load', index: 0, data: compiled, config: { ...defaultDeckConfig(), offsetBeats: 2 }, channels: [{ channel: 0 }] });
  const channel = processor.synth.midiChannels[0];
  assert.equal(channel.midiParameters.pitchWheelRange, 12, 'multiple selected RPN values survive chase');
  const patchIndex = emitted.findIndex(event => event.kind === 12 && event.a === 16);
  assert.ok(patchIndex >= 0);
  assert.equal(emitted.slice(0, patchIndex).filter(event => event.kind === 11 && event.a === 0).at(-1).b, 2, 'patch is restored with its original latched bank');
  assert.equal(emitted.slice(patchIndex).filter(event => event.kind === 11 && event.a === 0).at(-1).b, 3, 'pending bank is restored afterward');
  assert.ok(!emitted.some(event => event.kind === 11 && event.a === 74), 'a future device-specific value is not anticipated');
  await processor.command({ type: 'transport', playing: false, beat: 0 });
  await processor.command({ type: 'weave', config: defaultWeaveConfig(), phase });
  const sostenuto = setup(midi([[[0, 192, 16], [0, 176, 91, 0], [0, 176, 93, 0], [0, 144, 60, 100], [1, 176, 66, 127], [2, 128, 60, 0], [4, 176, 66, 0]]]));
  await processor.command({ type: 'load', index: 0, data: sostenuto, config: { ...defaultDeckConfig(), loop: false, offsetBeats: 3 }, channels: [{ channel: 0 }] });
  assert.equal(processor.synth.midiChannels[0].midiParameters.pitchWheelRange, 2, 'new plain sources cannot inherit old RPN bend ranges');
  assert.equal(processor.synth.midiChannels[0].midiParameters.fineTune, 0, 'new plain sources cannot inherit old RPN tuning');
  await processor.command({ type: 'deck', index: 1, config: { ...defaultDeckConfig(), mute: true }, channels: [{ channel: 0 }] });
  await processor.command({ type: 'transport', playing: true, beat: 0 });
  let energy = 0;
  for (let i = 0; i < 100; i++) for (const value of render(128)[0]) energy += value * value;
  assert.ok(Math.sqrt(energy / 12800) > .01, 'a rejoined released sostenuto key must actually sound');
  emitted.length = 0;
  for (let i = 0; i < 120; i++) render(128);
  assert.ok(emitted.some(event => event.kind === 8 && event.a === 60 && event.beat === 4), 'the reconstructed key releases at its recorded gate end');
  await processor.command({ type: 'dispose' });
});
