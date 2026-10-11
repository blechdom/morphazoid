import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiMixerClock, MidiSampleClock, MAX_SAMPLE_EVENTS_PER_BLOCK } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { generateTextMidi, generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

function midi(events, endBeat = 8) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  let tick = 0; const track = [];
  for (const [beat, ...message] of [...events, [endBeat, 255, 47, 0]]) { const next = Math.round(beat * 96); track.push(...vlq(next - tick), ...message); tick = next; }
  const result = new Uint8Array(22 + track.length), view = new DataView(result.buffer);
  result.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, 96);
  result.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); result.set(track, 22); return result.buffer;
}
const organ = (note = 60, length = 2) => midi([[0, 0xc0, 16], [0, 0x90, note, 100], [length, 0x80, note, 0]], length);
const channelConfig = analysis => analysis.channels.map(({ channel }) => ({ channel, mute: false, solo: false, program: null }));

test('sample previews never arm Audio or change deck transport, stay tempo locked and cancel without replay', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  const clip = organ(72, 8);
  const first = engine.triggerSample(clip, { name: 'Heart', program: 80, gain: 0.7 });
  assert.equal(first.positionBeats, 0); assert.equal(engine.state.playing, false); assert.equal(engine.state.audioEnabled, false);
  now = 500; assert.equal(engine.state.samples[0].positionBeats, 1); assert.equal(engine.state.beat, 0);
  engine.setTempo(240); now = 1000; assert.equal(engine.state.samples[0].positionBeats, 3);
  for (let index = 0; index < 4; index++) engine.triggerSample(clip, { name: `Repeat ${index}` });
  assert.equal(engine.state.samples.length, 4); assert.equal(engine.state.samples.some(sample => sample.id === first.id), false);
  assert.equal(new Set(engine.state.samples.map(sample => sample.slot)).size, 4);
  engine.pause(); assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(clip); engine.setAudioEnabled(false); assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(clip); engine.stop(); assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(clip); now += 3000; assert.equal(engine.state.samples.length, 0, 'completed one-shots do not remain active');
  assert.equal(contexts, 0); await engine.dispose(); assert.equal(engine.triggerSample(clip), false);
});

test('four one-shots use exact deck sample frames, survive tempo changes, and leave no attack backlog on cancellation', () => {
  let frameBase = 0; const attacks = [], releases = [];
  const emit = (source, event, frame) => { if (event.kind === 9) attacks.push({ source, frame: frameBase + frame }); };
  const deckClock = new MidiMixerClock({ emit }), samples = new MidiSampleClock({ emit, release: source => releases.push(source) });
  const analysis = parseMidi(organ(60, 1)), data = compileDeck(analysis), config = defaultDeckConfig(), channels = channelConfig(analysis);
  deckClock.load(0, data, config, channels); deckClock.setTransport(true);
  for (let slot = 0; slot < 4; slot++) samples.load(slot, { data, startBeat: 0.25, config, channels });
  for (let block = 0; block < 500; block++) {
    const tempo = block < 100 ? 120 : 240; deckClock.tempo = tempo;
    deckClock.process(128, 48000); samples.process(128, 48000, tempo); frameBase += 128;
  }
  assert.deepEqual(attacks.filter(event => event.source >= 2).map(event => event.frame), [6000, 6000, 6000, 6000]);
  assert.ok(Math.abs(samples.beat - deckClock.beat) < 1e-12); assert.equal(samples.samples.filter(Boolean).length, 0);
  assert.equal(releases.length, 4);
  samples.load(0, { data, startBeat: samples.beat, config, channels }); samples.stopAll();
  const before = attacks.length; samples.process(48000, 48000, 240); assert.equal(attacks.length, before);
  deckClock.setTransport(false); const beat = deckClock.beat;
  samples.load(0, { data, startBeat: samples.beat, config, channels }); samples.process(128, 48000, 240); deckClock.process(128, 48000);
  assert.equal(deckClock.beat, beat); assert.equal(attacks.at(-1).source, 2, 'manual one-shot sounds with deck transport paused');
});

test('sample overload shares one bounded event budget after decks and skips stale attacks', () => {
  const emitted = [], samples = new MidiSampleClock({ emit: source => emitted.push(source) });
  const analysis = parseMidi(organ()), data = { ...compileDeck(analysis), events: Array.from({ length: 10000 }, () => ({ beat: 0, kind: 9, channel: 0, a: 60, b: 100 })) };
  for (let slot = 0; slot < 4; slot++) samples.load(slot, { data, startBeat: 0, config: defaultDeckConfig(), channels: [] });
  samples.process(128, 48000, 120);
  assert.equal(emitted.length, MAX_SAMPLE_EVENTS_PER_BLOCK); assert.equal(samples.skippedEvents, 40000 - MAX_SAMPLE_EVENTS_PER_BLOCK);
  samples.process(128, 48000, 120); assert.equal(emitted.length, MAX_SAMPLE_EVENTS_PER_BLOCK);
});

test('parser pairs same-pitch overlapping note gates with stable identities and exact source durations', () => {
  const analysis = parseMidi(midi([[0, 0x90, 60, 100], [0.25, 0x90, 60, 80], [1, 0x80, 60, 0], [2, 0x80, 60, 0]], 2));
  const on = analysis.events.filter(event => event.kind === 9), off = analysis.events.filter(event => event.kind === 8);
  assert.deepEqual(on.map(event => event.noteId), off.map(event => event.noteId));
  assert.deepEqual(on.map(event => event.durationBeats), [1, 1.75]);
  assert.deepEqual(analysis.notes.map(note => note.id), on.map(event => event.noteId));
  assert.doesNotThrow(() => structuredClone(analysis));
});

test('real SoundFont samples overlay running decks, remain audible past crossfader endpoints and clean up without held notes', async () => {
  let Processor; const telemetry = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => telemetry.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    const analysis = parseMidi(organ(60, 8)), data = compileDeck(analysis), channels = channelConfig(analysis);
    for (let index = 0; index < 2; index++) await processor.command({ type: 'load', index, data, config: defaultDeckConfig(), channels });
    await processor.command({ type: 'transport', playing: true, beat: 0 });
    const render = blocks => {
      let energy = 0;
      for (let block = 0; block < blocks; block++) {
        const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
        for (const channel of output) for (const sample of channel) { assert.ok(Number.isFinite(sample)); energy += sample * sample; }
        globalThis.currentTime += 128 / 48000;
      }
      processor.publish(); return Math.sqrt(energy / (blocks * 256));
    };
    assert.ok(render(100) > 0.001);
    const deckBeat = processor.clock.beat;
    const sampleAnalysis = parseMidi(organ(67, 2)), sampleData = compileDeck(sampleAnalysis);
    const trigger = async (slot, id) => processor.command({ type: 'sample', slot, id, data: sampleData, startBeat: processor.sampleClock.beat, gain: 0.7, program: 16 });
    for (let slot = 0; slot < 4; slot++) await trigger(slot, slot + 1);
    assert.equal(processor.clock.beat, deckBeat); assert.ok(render(100) > 0.001);
    assert.equal(processor.synth.midiChannels.length, 193, 'six file sources plus one independent live-automata channel'); assert.ok(processor.synth.voiceCount <= 192);
    for (let index = 0; index < 2; index++) await processor.command({ type: 'deck', index, config: { ...defaultDeckConfig(), mute: true }, channels });
    await processor.command({ type: 'crossfade', value: 1 });
    render(80); const sampleRms = render(80); assert.ok(sampleRms > 0.001, `${sampleRms}: samples are audible with both decks muted and crossfader fully right`);
    const events = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []);
    for (let id = 1; id <= 4; id++) assert.ok(events.some(event => event.type === 'noteOn' && event.sourceId === `sample:${id}`));
    const attack = events.find(event => event.type === 'noteOn' && event.sourceId === 'sample:1');
    assert.equal(attack.note, 67); assert.equal(attack.channel, 0); assert.equal(attack.durationBeats, 2); assert.equal(attack.duration, 1);
    await processor.command({ type: 'stopSamples' }); render(1200);
    assert.ok(render(100) < 0.00001, 'sample cancellation reaches silence without held organ leaks');
    assert.equal(processor.sampleClock.samples.filter(Boolean).length, 0);
    assert.equal(processor.visualCount, 0);
    const releases = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).filter(event => event.type === 'noteOff');
    assert.ok(releases.some(event => event.id === attack.id));
    await processor.command({ type: 'transport', playing: false, beat: processor.clock.beat });
    const pausedBeat = processor.clock.beat; await trigger(0, 5); assert.ok(render(100) > 0.001); assert.equal(processor.clock.beat, pausedBeat);
    await trigger(0, 6); assert.equal(processor.sampleClock.samples.filter(Boolean).length, 1, 'same slot releases and replaces the earlier clip');
    await processor.command({ type: 'transport', playing: false, beat: pausedBeat }); render(1200); assert.ok(render(100) < 0.00001);
    await trigger(0, 7); render(100); await processor.command({ type: 'release' }); await processor.command({ type: 'audibility', enabled: false, volume: 1 });
    assert.equal(processor.sampleClock.samples.filter(Boolean).length, 0); assert.equal(processor.visualCount, 0);
    await processor.command({ type: 'audibility', enabled: true, volume: 1 }); render(1200); assert.ok(render(100) < 0.00001, 'rearming never replays canceled samples');
    const delayedAttack = compileDeck(parseMidi(midi([[0, 0xc0, 16], [1 / 96, 0x90, 67, 100], [4, 0x80, 67, 0]], 4)));
    await processor.command({ type: 'sample', slot: 0, id: 8, data: delayedAttack, startBeat: processor.sampleClock.beat, gain: 1, program: 16 });
    render(2); // The attack is reserved inside the next render quantum.
    await processor.command({ type: 'stopSamples' }); render(1200);
    assert.ok(render(100) < 0.00001, 'canceled sub-quantum attacks cannot arrive after Stop and become held');
    assert.equal(processor.clock.skippedEvents + processor.sampleClock.skippedEvents, 0);
    telemetry.length = 0;
    const twoNotes = parseMidi(midi([[0, 0xc0, 16], [0, 0x90, 60, 100], [1, 0x80, 60, 0], [1.5, 0x90, 62, 100], [2.5, 0x80, 62, 0]], 4));
    await processor.command({ type: 'load', index: 0, data: compileDeck(twoNotes), config: { ...defaultDeckConfig(), transpose: 12, rate: 2 }, channels });
    await processor.command({ type: 'crossfade', value: -1 }); await processor.command({ type: 'transport', playing: true, beat: 0 });
    render(60);
    let notes = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []);
    const pitched = notes.find(event => event.sourceId === 'deck:0' && event.type === 'noteOn');
    assert.equal(pitched.note, 72); assert.equal(pitched.duration, 0.25); assert.ok(pitched.gain > 0);
    await processor.command({ type: 'deck', index: 0, config: { ...defaultDeckConfig(), transpose: 12, rate: 2, mute: true }, channels }); render(240);
    notes = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []);
    assert.ok(notes.some(event => event.type === 'noteOff' && event.id === pitched.id), 'muting releases the exact visible note identity');
    assert.equal(notes.some(event => event.type === 'noteOn' && event.note === 74), false, 'muted scheduled attacks do not fabricate visible notes');
    await processor.command({ type: 'deck', index: 0, config: { ...defaultDeckConfig(), gain: 0, rate: 2 }, channels });
    telemetry.length = 0; await processor.command({ type: 'transport', playing: true, beat: 0 }); render(300);
    assert.equal(telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).some(event => event.type === 'noteOn'), false, 'gain-zero sources do not publish attacks');
    await processor.command({ type: 'deck', index: 0, config: defaultDeckConfig(), channels });
    await processor.command({ type: 'audibility', enabled: false, volume: 0.6 });
    await processor.command({ type: 'transport', playing: true, beat: 0.5 }); telemetry.length = 0;
    // Bridge the public rearm method to the actual processor: setting the
    // audibility gate after rejoin would lose every restored held-note attack.
    const gate = new MidiMixerEngine(); gate._ready = true;
    gate.context = { state: 'running', currentTime: globalThis.currentTime, close: async () => {} };
    gate.node = { port: { postMessage: message => { void processor.command(message); }, close() {} }, disconnect() {} };
    gate.setAudioEnabled(true);
    const restored = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).find(event => event.type === 'noteOn' && event.sourceId === 'deck:0');
    assert.ok(restored, 'Audio rearm publishes the genuinely restored held note'); assert.equal(restored.durationBeats, 0.5);
    gate.node = null; await gate.dispose();
    // Actual dense collection files cannot consume the slots needed to draw
    // four literal 48-column shapes. Checker rows change every cell at once.
    for (const [index, file, start] of [[0, 'black-bleed-lightstorm.mid', 312], [1, 'black-bleed-seven-red-suns.mid', 120]]) {
      const bytes = await readFile(new URL(`../assets/midiphoria/midi/${file}`, import.meta.url)), score = parseMidi(bytes);
      await processor.command({ type: 'load', index, data: compileDeck(score), config: { ...defaultDeckConfig(), rate: 8, loopStartBeats: start, loopEndBeats: start + 16 }, channels: channelConfig(score) });
    }
    await processor.command({ type: 'crossfade', value: 0 }); await processor.command({ type: 'tempo', tempo: 120 });
    await processor.command({ type: 'transport', playing: true, beat: 0 }); telemetry.length = 0;
    const checks = generateGridMidi(Array.from({ length: 32 }, (_, row) => Array.from({ length: 48 }, (_, column) => Number((row + column) % 2 === 0))), { secondsPerRow: 0.125 });
    const checkerAnalysis = parseMidi(checks.buffer), checkerData = compileDeck(checkerAnalysis);
    for (let slot = 0; slot < 4; slot++) await processor.command({ type: 'sample', slot, id: 9 + slot, data: checkerData, startBeat: processor.sampleClock.beat, gain: 0.7, program: 0 });
    render(1600);
    const batches = telemetry.filter(message => message.type === 'notes');
    assert.ok(batches.every(message => message.notes.length <= 256), 'combined telemetry never exceeds its batch cap');
    const sampleEvents = batches.flatMap(message => message.notes).filter(event => event.sampleId >= 9 && event.sampleId <= 12);
    for (let id = 9; id <= 12; id++) {
      const attacks = sampleEvents.filter(event => event.sampleId === id && event.type === 'noteOn'), offs = sampleEvents.filter(event => event.sampleId === id && event.type === 'noteOff');
      assert.equal(attacks.length, checkerAnalysis.noteCount, `all checker attacks from sample ${id} survive both dense decks`);
      assert.deepEqual(new Set(offs.map(event => event.id)), new Set(attacks.map(event => event.id)), 'every sample gate receives its authoritative release');
    }
    assert.equal(processor.clock.skippedEvents + processor.sampleClock.skippedEvents, 0);
    telemetry.length = 0;
    const solidData = compileDeck(parseMidi(generateGridMidi(Array.from({ length: 4 }, () => Array(48).fill(1)), { secondsPerRow: 0.125 }).buffer));
    for (let slot = 0; slot < 4; slot++) await processor.command({ type: 'sample', slot, id: 13 + slot, data: solidData, startBeat: processor.sampleClock.beat, gain: 0.7, program: 0 });
    render(1); assert.equal(processor.sampleVisualCount, 192); assert.ok(processor.visualCount <= 512);
    await processor.command({ type: 'stopSamples' });
    const solidEvents = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).filter(event => event.sampleId >= 13);
    assert.equal(solidEvents.filter(event => event.type === 'noteOn').length, 192);
    assert.equal(solidEvents.filter(event => event.type === 'noteOff').length, 192, 'all four full-width held rows release under dense traffic');
  } finally {
    await processor.command({ type: 'dispose' }); delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
  }
});

test('oversized one-shot input is rejected without disturbing loaded decks or existing samples', async () => {
  const engine = new MidiMixerEngine();
  await engine.loadDeck(0, generateTextMidi('A').buffer); engine.play(); engine.triggerSample(organ());
  assert.throws(() => engine.triggerSample(new ArrayBuffer(2 * 1024 * 1024 + 1)), /2 MB/);
  assert.throws(() => engine.triggerSample(organ(60, 513)), /512 beats/);
  assert.equal(engine.state.samples.length, 1); assert.equal(engine.state.decks[0].analysis.noteCount > 0, true); assert.equal(engine.state.playing, true);
  await engine.dispose();
});
