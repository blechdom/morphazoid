import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Import the actual authored processor and its pinned vendor in a worklet host.
const registrations = [];
globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
};
globalThis.registerProcessor = (name, implementation) => registrations.push({ name, implementation });
const { installMidiphoriaNoteEffects, MidiphoriaProcessor } = await import('../src/instruments/midiphoria/midiphoria-processor.js');

function harness() {
  const events = [], renders = [];
  const core = { currentTime: 0, eventQueue: [], midiChannels: [], customChannelNumbers: false,
    portSelectChannelOffset: 0, createMIDIChannel() {
      const channel = this.midiChannels.length;
      this.midiChannels.push({ channel, drumChannel: channel % 16 === 9, midiParameters: { rxChannel: channel },
        noteOn: (note, velocity) => events.push({ type: 'on', channel, note, velocity, time: core.currentTime }),
        noteOff: note => events.push({ type: 'off', channel, note, time: core.currentTime }),
        stopAllNotes: force => events.push({ type: 'stop', channel, force }),
      });
    },
    reset() { events.push({ type: 'reset' }); }, destroySynthProcessor() { events.push({ type: 'destroy' }); },
    stopAllChannels(force) { for (const channel of this.midiChannels) channel.stopAllNotes(force); },
    processMessageInternal(message, offset = 0) {
      const channel = (message[0] & 15) + offset;
      if ((message[0] & 0xf0) === 0x90) this.noteOn(channel, message[1], message[2]);
      else if ((message[0] & 0xf0) === 0x80) this.noteOff(channel, message[1]);
      else events.push({ type: 'midi', message, offset });
    },
  };
  for (let index = 0; index < 16; index++) core.createMIDIChannel();
  const synth = { synthCore: core, createMIDIChannel() { core.createMIDIChannel(); }, processSplit(_outputs, _left, _right, offset, count) {
    renders.push([offset, count]); core.currentTime += count / 48000;
  } };
  const host = { synthesizer: synth, sequencers: [], handleMessage: message => events.push({ type: 'message', message }) };
  const adapter = installMidiphoriaNoteEffects(host, 48000);
  const render = frames => synth.processSplit([[new Float32Array(frames), new Float32Array(frames)]], null, null);
  const configure = config => host.handleMessage({ type: 'midiphoriaNoteEffects', config });
  return { core, synth, host, adapter, events, renders, render, configure };
}

test('the vendored change is exactly one reproducible registration-to-export statement', async () => {
  const source = await readFile(new URL('../src/instruments/midiphoria/vendor/spessasynth_processor.min.js', import.meta.url), 'utf8');
  const exported = 'export{Xt as SpessaSynthWorkletProcessor};';
  assert.equal(source.split(exported).length, 2);
  const original = source.replace(exported, 'registerProcessor(ma,Xt);');
  assert.equal(createHash('sha256').update(original).digest('hex'), '109ad445931e5c6e17739a994b2694d325577a6cb6fd2b56b39385edfc9e1fb5');
  assert.deepEqual(registrations.map(({ name }) => name), ['spessasynth-worklet-processor']);
  assert.equal(registrations[0].implementation, MidiphoriaProcessor);
});

test('both sequencer facade and raw MIDI note paths apply chords, velocity and matched native releases', () => {
  const h = harness(); h.configure({ enabled: true, transpose: 12, chord: 'major', velocity: 0.5 });
  h.synth.noteOn(0, 60, 100);
  h.core.processMessageInternal([0x91, 65, 80]);
  assert.deepEqual(h.events.filter(event => event.type === 'on').map(({ channel, note, velocity }) => [channel, note, velocity]),
    [[0, 72, 50], [0, 76, 50], [0, 79, 50], [1, 77, 40], [1, 81, 40], [1, 84, 40]]);
  h.configure({ enabled: false, transpose: -12 });
  h.synth.noteOff(0, 60); h.core.processMessageInternal([0x81, 65, 0]);
  assert.deepEqual(h.events.filter(event => event.type === 'off').map(({ note }) => note), [72, 76, 79, 77, 81, 84]);
  h.synth.noteOn(0, 60, 100);
  assert.equal(h.events.at(-1).note, 60, 'bypass affects new attacks without rewriting held releases');
});

test('delay and echoes split audio rendering at sample boundaries and do not wait for a UI frame', () => {
  const h = harness();
  h.configure({ enabled: true, tempo: 600, delayBeats: 0.01, echoCount: 1, echoBeats: 0.0625, gateBeats: 0.0625 });
  h.synth.noteOn(0, 60, 100);
  assert.equal(h.events.length, 0);
  h.render(128); h.render(128); h.render(128); h.render(128); h.render(128); h.render(128);
  const notes = h.events.filter(event => event.type === 'on');
  assert.equal(notes.length, 2);
  assert.ok(Math.abs(notes[0].time - 0.001) < 1 / 48000);
  assert.ok(Math.abs(notes[1].time - 0.00725) < 1 / 48000);
  assert.ok(h.renders.some(([, frames]) => frames < 128));
  assert.equal(h.events.filter(event => event.type === 'off').length, 2);
});

test('tempo follows the current sequence and rate; drums, CC/programs and physical port routing stay intact', () => {
  const h = harness();
  h.host.sequencers.push({ paused: false, midiData: { timeDivision: 96 }, oneTickToSeconds: 0.5 / 96, playbackRate: 2 });
  h.configure({ enabled: true, transpose: 12, chord: 'fifth', delayBeats: 1 });
  h.synth.noteOn(9, 36, 100);
  h.core.processMessageInternal([0xb9, 64, 127]);
  h.core.processMessageInternal([0xc9, 1]);
  assert.deepEqual(h.events.slice(0, 2).map(event => event.message), [[0xb9, 64, 127], [0xc9, 1]]);
  for (let index = 0; index < 16; index++) h.synth.createMIDIChannel();
  h.core.portSelectChannelOffset = 16; h.synth.noteOn(0, 60, 100);
  h.core.portSelectChannelOffset = 0;
  for (let block = 0; block < 96; block++) h.render(128);
  assert.deepEqual(h.events.filter(event => event.type === 'on').map(({ channel, note }) => [channel, note]), [[9, 36], [16, 72], [16, 79]]);
  assert.ok(Math.abs(h.events.find(event => event.type === 'on').time - 0.25) < 1 / 48000);
});

test('all-notes-off, reset, soundfont replacement and disposal cancel pending effect children', () => {
  for (const action of [h => h.core.stopAllChannels(true), h => h.core.reset(), h => h.core.destroySynthProcessor(),
    h => h.host.handleMessage({ type: 'soundBankManager', data: { type: 'addSoundBank' } })]) {
    const h = harness(); h.configure({ enabled: true, echoCount: 4, delayBeats: 1 });
    h.synth.noteOn(0, 60, 100);
    h.core.eventQueue.push({ message: [0x90, 65, 100], channelOffset: 0, time: 1 });
    action(h); h.render(48000);
    assert.equal(h.events.filter(event => event.type === 'on').length, 0);
    assert.equal(h.adapter.effects.nextTime, Infinity);
    assert.equal(h.core.eventQueue.length, 0);
  }
  const h = harness(); h.configure({ enabled: true, delayBeats: 0.1 });
  h.synth.noteOn(0, 60, 100); h.synth.noteOn(1, 64, 100);
  h.core.midiChannels[0].stopAllNotes(); h.render(4800);
  assert.deepEqual(h.events.filter(event => event.type === 'on').map(event => event.channel), [1]);
});

test('the real pinned SoundFont processor sounds and reports the same effected pitches from MIDI and its sequencer', async () => {
  const processor = new MidiphoriaProcessor({ processorOptions: { eventsEnabled: true, oneOutput: false } });
  const host = processor.core, synth = host.synthesizer;
  await synth.processorInitialized;
  host.handleMessage({ type: 'setLogLevel', data: { enableInfo: false, enableWarning: false, enableGroup: false } });
  const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  host.handleMessage({ type: 'soundBankManager', data: { type: 'addSoundBank', data: {
    soundBankBuffer: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), id: 'test', bankOffset: 0,
  } } });
  synth.setSystemParameter('voiceCap', 128);
  host.handleMessage({ type: 'midiphoriaNoteEffects', config: { enabled: true, transpose: 12, chord: 'major' } });
  host.handleMessage({ type: 'midiMessage', data: { messageData: [0x90, 60, 100], channelOffset: 0, options: { time: 0 } } });
  const render = blocks => {
    let energy = 0;
    for (let block = 0; block < blocks; block++) {
      const output = Array.from({ length: 17 }, () => [new Float32Array(128), new Float32Array(128)]);
      assert.equal(processor.process([], output), true);
      for (const channels of output) for (const samples of channels) for (const sample of samples) {
        assert.ok(Number.isFinite(sample)); energy += sample * sample;
      }
    }
    return energy;
  };
  assert.ok(render(30) > 0.01, 'native SoundFont audio is non-silent');
  assert.deepEqual(processor.messages.filter(message => message.type === 'eventCall' && message.data.type === 'noteOn')
    .map(message => message.data.data.midiNote), [72, 76, 79]);
  synth.noteOn(0, 64, 100); synth.noteOff(0, 60);
  assert.equal(synth.midiChannels[0].noteOnID[76], 2, 'two chord children share a native pitch');
  assert.equal(synth.midiChannels[0].noteOffID[76], 1, 'each child closes exactly one native attack');
  synth.noteOff(0, 64);
  assert.equal(synth.midiChannels[0].noteOffID[76], 2);
  synth.stopAllChannels(true);
  host.handleMessage({ type: 'midiphoriaNoteEffects', config: { echoCount: 2, echoBeats: 1 } });
  host.createNewSequencer();
  const midi = new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,13,0,144,60,100,96,128,60,0,0,255,47,0]);
  host.handleMessage({ type: 'sequencerSpecific', data: { id: 0, type: 'loadNewSongList', data: [{ binary: midi.buffer, fileName: 'test.mid' }] } });
  host.handleMessage({ type: 'sequencerSpecific', data: { id: 0, type: 'play' } });
  const before = processor.messages.length;
  assert.ok(render(30) > 0.01, 'sequencer still produces native SoundFont audio');
  assert.deepEqual(processor.messages.slice(before).filter(message => message.type === 'eventCall' && message.data.type === 'noteOn')
    .map(message => message.data.data.midiNote), [72, 76, 79]);
  assert.ok(Number.isFinite(processor.noteEffects.effects.nextTime), 'echoes remain scheduled on the audio clock');
  host.handleMessage({ type: 'sequencerSpecific', data: { id: 0, type: 'pause' } });
  assert.equal(processor.noteEffects.effects.nextTime, Infinity, 'native pause cancels pending echoes');
  host.handleMessage({ type: 'sequencerSpecific', data: { id: 0, type: 'play' } });
  assert.ok(Number.isFinite(processor.noteEffects.effects.nextTime), 'resume retriggers held source notes through effects');
  host.handleMessage({ type: 'sequencerSpecific', data: { id: 0, type: 'setTime', data: 0.2 } });
  assert.equal(processor.noteEffects.effects.nextTime, Infinity);
  host.handleMessage({ type: 'destroyWorklet' });
  assert.equal(processor.process([], []), false);
});
