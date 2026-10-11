import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileDeck, MidiMixerEngine } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { defaultDeckConfig, parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

test('native mixer sound and graphics share transformed notes, clock timing and panic cleanup', async () => {
  let Processor;
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    const analysis = parseMidi(generateTextMidi('A').buffer);
    analysis.channels.push({ channel: 9, drums: true });
    await processor.command({ type: 'load', index: 0, data: compileDeck(analysis), config: defaultDeckConfig(),
      channels: analysis.channels.map(({ channel }) => ({ channel, mute: false, solo: false, program: null })) });
    const native = [], visuals = [], channel = processor.synth.midiChannels[0];
    const noteOn = channel.noteOn.bind(channel), noteOff = channel.noteOff.bind(channel);
    channel.noteOn = (note, velocity) => { native.push({ type: 'on', note, velocity, at: processor.synth.currentTime }); noteOn(note, velocity); };
    channel.noteOff = note => { native.push({ type: 'off', note, at: processor.synth.currentTime }); noteOff(note); };
    const queue = processor.queueVisual.bind(processor);
    processor.queueVisual = note => { visuals.push({ ...note }); return queue(note); };
    const render = seconds => {
      let energy = 0;
      for (let i = 0; i < Math.ceil(seconds * 48000 / 128); i++) {
        const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
        for (const sample of output[0]) { assert.ok(Number.isFinite(sample)); energy += sample * sample; }
        globalThis.currentTime += 128 / 48000;
      }
      assert.equal(processor.ready, true); return energy;
    };
    const attack = (id, note = 60, sourceChannel = 0) => processor.emit(0, { channel: sourceChannel, kind: 9, a: note, b: 100, noteId: id, beat: 0, durationBeats: 2 });
    const release = (id, note = 60) => processor.emit(0, { channel: 0, kind: 8, a: note, b: 0, noteId: id, beat: .1 });
    await processor.command({ type: 'noteEffects', config: { enabled: true, transpose: 12, chord: 'major', echoCount: 1, echoBeats: .5, gateBeats: .125 } });
    attack(1); assert.deepEqual(native.filter(event => event.type === 'on').map(event => event.note), [72, 76, 79]);
    const pressures = [], pressure = channel.polyPressure.bind(channel);
    channel.polyPressure = (note, value) => { pressures.push([note, value]); pressure(note, value); };
    processor.emit(0, { channel: 0, kind: 10, a: 60, b: 83, beat: 0 });
    assert.deepEqual(pressures, [[72, 83], [76, 83], [79, 83]], 'aftertouch reaches the sounding chord');
    assert.ok(render(.05) > .0001, 'native SoundFont is audible'); release(1); render(.4);
    assert.deepEqual(native.filter(event => event.type === 'on').map(event => event.note), [72, 76, 79, 72, 76, 79]);
    assert.equal(native.filter(event => event.type === 'off').length, 6);
    assert.deepEqual(visuals.filter(event => event.type === 'noteOn').map(event => event.note), native.filter(event => event.type === 'on').map(event => event.note));
    assert.ok(Math.abs(native.filter(event => event.type === 'on')[3].at - .25) <= 1 / 48000);

    await processor.command({ type: 'noteEffects', config: { enabled: true, transpose: 7, chord: 'single' } });
    attack(2); await processor.command({ type: 'noteEffects', config: { enabled: false, transpose: -12 } }); release(2);
    assert.equal(native.at(-1).note, 67, 'effect edits release the attack-time pitch');
    attack(3); release(3); assert.equal(native.at(-1).note, 60, 'bypass restores source pitches');
    processor.emit(0, { channel: 0, kind: 11, a: 10, b: 17, beat: 0 });
    assert.equal(channel.midiControllers[10] >> 7, 17, 'controller path remains intact');

    await processor.command({ type: 'noteEffects', config: { enabled: true, transpose: 12, chord: 'major', delayBeats: 1, echoCount: 4 } });
    const before = native.filter(event => event.type === 'on').length;
    attack(4); await processor.command({ type: 'release' }); render(3);
    assert.equal(native.filter(event => event.type === 'on').length, before, 'panic cancels all future attacks');
    assert.equal(processor.noteFx.stats.groups, 0);
    assert.equal(processor.noteFx.nextTime, Infinity);
    for (const cc of [120, 123, 124, 125, 126, 127]) {
      attack(10 + cc);
      processor.emit(0, { channel: 0, kind: 11, a: cc, b: 0, beat: 0 });
      assert.equal(processor.noteFx.nextTime, Infinity, `CC${cc} cancels delayed MIDI`);
      assert.equal(processor.noteFx.stats.active, 0);
    }
  } finally {
    await processor.command({ type: 'dispose' });
    for (const key of ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime']) delete globalThis[key];
  }
});

test('note effect edits preserve mixer clock, audio intent and the original score', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  await engine.loadDeck(0, generateTextMidi('FX').buffer, 'FX'); engine.play(); now = 2500;
  const before = engine.state;
  engine.setNoteEffects({ enabled: true, transpose: 7, chord: 'fifth', echoCount: 2 });
  assert.equal(engine.state.beat, before.beat); assert.equal(engine.state.playing, true);
  assert.equal(engine.state.audioEnabled, false); assert.equal(engine.context, null);
  assert.equal(engine.state.decks[0].analysis, before.decks[0].analysis);
  await engine.dispose();
});
