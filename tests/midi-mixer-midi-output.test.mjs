import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function midi(events, endBeat = 4) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  let tick = 0; const track = [];
  for (const [beat, ...message] of [...events, [endBeat, 255, 47, 0]]) { const next = Math.round(beat * 96); track.push(...vlq(next - tick), ...message); tick = next; }
  const result = new Uint8Array(22 + track.length), view = new DataView(result.buffer);
  result.set([77,84,104,100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, 96);
  result.set([77,84,114,107], 14); view.setUint32(18, track.length); result.set(track, 22); return result.buffer;
}
const clip = (pitch = 60) => midi([[0,0x90,pitch,100],[3,0x80,pitch,0]]);
let Processor;
async function processor() {
  const messages = [];
  globalThis.__mixerMidiOutputMessages = messages;
  globalThis.sampleRate = 48000; globalThis.currentTime = 10;
  globalThis.AudioWorkletProcessor = class { constructor() { const target = globalThis.__mixerMidiOutputMessages; this.port = { postMessage: message => target.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const engine = new Processor(), font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  await engine.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
  const render = blocks => {
    for (let block = 0; block < blocks; block++) {
      engine.process([], [[new Float32Array(128), new Float32Array(128)]]);
      globalThis.currentTime += 128 / 48000;
    }
  };
  const output = () => messages.filter(message => message.type === 'midiOutput');
  const events = () => output().flatMap(message => message.events);
  const load = (slot, id, buffer = clip(), options = {}) => engine.command({ type: 'sample', slot, id, data: compileDeck(parseMidi(buffer)),
    startBeat: engine.sampleClock.beat, sync: true, gain: .7, ...options });
  return { engine, messages, render, output, events, load };
}

test('post-FX MIDI uses exact rendered sample times, original channels and held overrides with Audio muted', async () => {
  const { engine, messages, render, output, events, load } = await processor();
  try {
    await engine.command({ type: 'audibility', enabled: false, volume: 0 });
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 7 });
    await engine.command({ type: 'noteEffects', config: { enabled: true, transpose: 12, chord: 'fifth', delayBeats: .25, gateBeats: .0625, echoCount: 1, echoBeats: .125 } });
    await load(0, 11, midi([[0,0xc5,5],[1/96,0x95,60,100],[25/96,0x85,60,0]], 2),
      { midi: { transpose: 2, velocityScale: .5, program: 24, bankMSB: 1, bankLSB: 2, bend: 10000, pressure: 33, controllers: { 7: 77 } } });
    render(48); assert.equal(events().filter(event => event.type === 'noteOn').length, 0);
    render(1);
    let attacks = events().filter(event => event.type === 'noteOn');
    assert.equal(attacks.length, 2, 'MIDI arrives in its render quantum without waiting for visual telemetry');
    for (const attack of attacks) assert.ok(Math.abs(attack.time - (10 + 6250 / 48000)) < 1e-10);
    assert.deepEqual(attacks.map(event => event.note), [74,81]);
    assert.ok(attacks.every(event => event.channel === 5 && event.velocity === 50 && event.source === 'sample:11'));
    render(50); attacks = events().filter(event => event.type === 'noteOn');
    const releases = events().filter(event => event.type === 'noteOff');
    assert.equal(attacks.length, 4); assert.equal(releases.length, 4);
    for (const attack of attacks) {
      const release = releases.find(event => event.id === attack.id);
      assert.ok(release); assert.equal(release.note, attack.note); assert.equal(release.channel, attack.channel);
      assert.ok(Math.abs(release.time - attack.time - 1500 / 48000) < 1e-10);
    }
    assert.ok(Math.abs(attacks[2].time - attacks[0].time - 3000 / 48000) < 1e-10);
    const bytes = events().filter(event => event.type === 'message').map(event => event.data);
    for (const message of [[0xc5,24],[0xb5,0,1],[0xb5,32,2],[0xb5,7,77],[0xe5,16,78],[0xd5,33]]) assert.ok(bytes.some(data => JSON.stringify(data) === JSON.stringify(message)), JSON.stringify(message));
    assert.ok(output().every(batch => batch.epoch === 7 && batch.events.length <= 4096));
    assert.equal(messages.filter(message => message.type === 'notes').flatMap(message => message.notes).length, 0, 'MIDI never depends on muted visual telemetry');
  } finally { await engine.command({ type: 'dispose' }); }
});

test('source stop, output epochs and layer mute release owned gates without channel-wide panic or clock reset', async () => {
  const { engine, messages, render, events, load } = await processor();
  try {
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 1 });
    await load(0, 21, clip(60), { loop: true }); await load(1, 22, clip(67), { loop: true }); render(4);
    const attacks = events().filter(event => event.type === 'noteOn'); assert.equal(attacks.length, 2);
    messages.length = 0;
    await engine.command({ type: 'stopSample', slot: 0, id: 21 });
    assert.ok(events().some(event => event.type === 'release' && event.source === 'sample:21'));
    assert.ok(!events().some(event => event.type === 'release' && event.source === 'sample:22'));
    assert.ok(!events().some(event => event.type === 'message' && event.data[0] >> 4 === 11 && [120,123].includes(event.data[1])));
    const phase = engine.sampleClock.samples[1].timing.positionBeats;
    await engine.command({ type: 'midiOutput', enabled: false, epoch: 2 }); messages.length = 0; render(8);
    assert.equal(events().length, 0); assert.ok(engine.sampleClock.samples[1].timing.positionBeats > phase);
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 3 });
    assert.equal(events().filter(event => event.type === 'noteOn' && event.source === 'sample:22').length, 1);
    assert.ok(events().every(event => event.source !== 'sample:21'), 'removed sources never rejoin');
    messages.length = 0;
    await engine.command({ type: 'sampleParameters', slot: 1, id: 22, gain: 0, midi: {}, revision: 1 });
    assert.ok(events().some(event => event.type === 'release' && event.source === 'sample:22' && event.channel === 0));
    assert.equal(events().some(event => event.type === 'noteOn'), false);
    render(4); messages.length = 0;
    await engine.command({ type: 'sampleParameters', slot: 1, id: 22, gain: .7, midi: {}, revision: 2 });
    assert.ok(events().some(event => event.type === 'noteOn' && event.source === 'sample:22'));
  } finally { await engine.command({ type: 'dispose' }); }
});

test('MIDI output overflow is explicit and bounded rather than silently losing note releases', async () => {
  const { engine, render, output, load } = await processor();
  try {
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 4 });
    await engine.command({ type: 'noteEffects', config: { enabled: true, chord: 'major' } });
    const attacks = Array.from({ length: 2048 }, (_, index) => [0, 0x90, 40 + index % 40, 100]);
    const offs = attacks.map(([, , note]) => [1,0x80,note,0]);
    await load(0, 31, midi([...attacks, ...offs], 2)); render(1);
    assert.ok(output().some(batch => batch.overflow === true && batch.events.length === 0));
    assert.ok(output().every(batch => batch.events.length <= 4096));
  } finally { await engine.command({ type: 'dispose' }); }
});

test('multiport scores cannot alias physical channels, and their warning leaves other MIDI sources active', async () => {
  const { engine, render, output, events, load } = await processor();
  try {
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 5 });
    await load(0, 32, midi([[0,255,33,1,1],[0,0x90,60,100],[1,0x80,60,0]], 2));
    await load(1, 33, clip(67)); render(2);
    assert.ok(output().some(batch => batch.warnings?.some(warning => warning.includes('multiple MIDI ports'))));
    assert.equal(events().some(event => event.source === 'sample:32' && event.type === 'noteOn'), false);
    assert.ok(events().some(event => event.source === 'sample:33' && event.type === 'noteOn' && event.note === 67));
    assert.equal(output().some(batch => batch.error || batch.overflow), false);
  } finally { await engine.command({ type: 'dispose' }); }
});

test('loop MIDI keeps phase through a tempo change and live Automata uses the same quantum clock', async () => {
  const { engine, messages, render, events, load } = await processor();
  try {
    await engine.command({ type: 'audibility', enabled: false, volume: 0 });
    await engine.command({ type: 'midiOutput', enabled: true, epoch: 8 });
    await load(0, 41, midi([[0,0x90,60,100],[.5,0x80,60,0]], 1), { loop: true });
    render(60); await engine.command({ type: 'tempo', tempo: 240 }); render(160);
    const attacks = events().filter(event => event.type === 'noteOn' && event.source === 'sample:41');
    assert.equal(attacks.length, 3);
    for (const [index, time] of [10,10.33,10.58].entries()) assert.ok(Math.abs(attacks[index].time - time) <= 1 / 48000);
    assert.equal(new Set(attacks.map(event => event.id)).size, 3, 'looped gates have distinct ownership');
    await engine.command({ type: 'automataConfigure', settings: { rule: 204, width: 8, seed: 'center', rowBeats: .5, lowestNote: 60, velocity: 96, program: 0, gain: .7 }, revision: 1 });
    await engine.command({ type: 'automataPlaying', playing: true, revision: 2 }); render(150);
    const automata = events().filter(event => event.type === 'noteOn' && event.source === 'automata');
    assert.ok(automata.length >= 3);
    assert.ok(Math.abs(automata.at(-1).time - automata.at(-2).time - .125) <= 1 / 48000);
    messages.length = 0;
    await engine.command({ type: 'automataPlaying', playing: false, revision: 3 }); render(60);
    assert.ok(events().some(event => event.type === 'release' && event.source === 'automata'));
    assert.equal(events().some(event => event.type === 'noteOn' && event.source === 'automata'), false);
    assert.ok(engine.sampleClock.samples[0], 'pausing Automata preserves other MIDI sources');
  } finally { await engine.command({ type: 'dispose' }); }
});

function fakeRuntime() {
  const commands = [], contexts = [];
  const parameter = () => ({ value: 0, cancelAndHoldAtTime() {}, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } });
  class Node {
    constructor() { for (const name of ['gain','frequency','Q','delayTime','threshold','knee','ratio','attack','release']) this[name] = parameter(); }
    connect() {} disconnect() {} addEventListener() {} removeEventListener() {}
  }
  class Context {
    constructor() { contexts.push(this); this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.listeners = new Map(); this.audioWorklet = { addModule: async () => {} }; }
    createGain() { return new Node(); } createDynamicsCompressor() { return new Node(); } createWaveShaper() { return new Node(); } createBiquadFilter() { return new Node(); } createDelay() { return new Node(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); } removeEventListener(name) { this.listeners.delete(name); }
    async resume() { this.state = 'running'; } async close() { this.state = 'closed'; }
  }
  class Worklet extends Node {
    constructor() { super(); this.port = { close() {}, onmessage: null, postMessage: message => {
      commands.push(message); if (message.type === 'initialize') queueMicrotask(() => this.port.onmessage({ data: { type: 'ready' } }));
    } }; }
  }
  return { commands, contexts, runtime: { AudioContext: Context, AudioWorkletNode: Worklet, setTimeout, clearTimeout, performance: { now: () => 0 }, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }) } };
}

test('MIDI-only arming initializes the clock with silent audio and preserves layer playback across Audio changes', async () => {
  const { runtime, commands, contexts } = fakeRuntime(), engine = new MidiMixerEngine({ runtime, connectOutput: () => () => {} });
  const output = []; engine.subscribeMidiOutput((batch, context) => output.push({ batch, context }));
  try {
    const source = engine.triggerSample(clip(), { loop: true });
    assert.equal(contexts.length, 0); assert.equal(await engine.setMidiOutput(true, 10), true);
    assert.equal(contexts.length, 1); assert.equal(engine.state.audioEnabled, false); assert.equal(engine.state.midiOutputEnabled, true); assert.equal(engine._gain.gain.value, 0);
    assert.ok(commands.some(command => command.type === 'sample' && command.id === source.id));
    assert.ok(commands.some(command => command.type === 'midiOutput' && command.enabled && command.epoch === 10));
    const event = { type: 'noteOn', source: 'sample:1', id: 1, channel: 0, note: 60, velocity: 100, time: 0 };
    engine.node.port.onmessage({ data: { type: 'midiOutput', epoch: 9, events: [event] } }); assert.equal(output.length, 0);
    engine.node.port.onmessage({ data: { type: 'midiOutput', epoch: 10, events: [event] } }); assert.equal(output.length, 1); assert.equal(output[0].context, contexts[0]);
    commands.length = 0; await engine.enableAudio(); engine.setAudioEnabled(false);
    assert.equal(engine.state.samples.length, 1); assert.equal(engine.state.midiOutputEnabled, true);
    assert.ok(!commands.some(command => ['stopSamples','release','rejoin'].includes(command.type)));
    contexts[0].state = 'suspended'; contexts[0].listeners.get('statechange')();
    assert.equal(engine.state.midiOutputEnabled, false); assert.equal(output.at(-1).batch.events[0].type, 'release');
    await engine.setMidiOutput(true, 11); assert.equal(engine.state.midiOutputEnabled, true);
    await engine.setMidiOutput(false, 12); assert.equal(engine.state.midiOutputEnabled, false);
    engine.node.port.onmessage({ data: { type: 'midiOutput', epoch: 11, events: [event] } }); assert.equal(output.at(-1).batch.events[0].type, 'release');
  } finally { await engine.dispose(); }
});

test('host seek rebases running and paused drops, preserves loop/delay and skips crossed attacks in its counter', async () => {
  const { runtime, commands } = fakeRuntime(), engine = new MidiMixerEngine({ runtime, connectOutput: () => () => {} });
  try {
    await engine.setMidiOutput(true, 1);
    const first = engine.triggerSample(clip(), { loop: true, delayBeats: 2, quantize: false });
    const second = engine.triggerSample(clip(67), { loop: true, quantize: false }); engine.setSamplePaused(second.id, true);
    const before = engine.state.generatedNoteCount; commands.length = 0;
    engine.seekSamples(3);
    let [waiting, paused] = engine.state.samples;
    assert.equal(waiting.id, first.id); assert.equal(waiting.positionBeats, 1); assert.equal(waiting.pendingBeats, 0); assert.equal(waiting.loop, true);
    assert.equal(paused.paused, true); assert.equal(paused.positionBeats, 3);
    assert.equal(engine.state.generatedNoteCount, before, 'seeking must not manufacture performed attacks');
    assert.equal(commands.filter(command => command.type === 'stopSample').length, 2);
    engine.seekSamples(-4); [waiting, paused] = engine.state.samples;
    assert.equal(waiting.pendingBeats, 3); assert.equal(waiting.positionBeats, 0);
    assert.equal(paused.pendingBeats, 1); assert.equal(paused.paused, true);
  } finally { await engine.dispose(); }
});

test('enabling or resetting MIDI while Audio is on never retriggers native playback', async () => {
  const { runtime, commands } = fakeRuntime(), engine = new MidiMixerEngine({ runtime, connectOutput: () => () => {} });
  try {
    await engine.enableAudio();
    const source = engine.triggerSample(clip(), { loop: true }); engine.setAutomataPlaying(true);
    commands.length = 0;
    await engine.setMidiOutput(true, 20); await engine.setMidiOutput(true, 21);
    await engine.setMidiOutput(false, 22); await engine.setMidiOutput(true, 23);
    assert.equal(engine.state.audioEnabled, true); assert.equal(engine.state.midiOutputEnabled, true);
    assert.equal(engine.state.samples[0].id, source.id); assert.equal(engine.state.automata.playing, true);
    assert.ok(!commands.some(command => ['rejoin', 'release', 'stopSamples', 'automataRestart'].includes(command.type)));
    assert.equal(commands.filter(command => command.type === 'sample').length, 0, 'a route change does not reload active layers');
  } finally { await engine.dispose(); }
});
