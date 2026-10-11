import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiMixerEngine } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MIDI_MIXER_PRESETS, captureMixerPreset, applyMixerPreset, randomizeMixerPreset } from '../src/instruments/midi-mixer/midi-mixer-presets.js';
import { buildVoiceMap } from '../src/instruments/midi-mixer/midi-mixer-renderer.js';
import { MIDI_PARAMETER_FIELDS, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS } from '../src/instruments/midi-mixer/midi-mixer-parameters.js';

test('all mix scenes recall independently and preserve files, clock, output and audio intent', () => {
  const engine = new MidiMixerEngine(); engine.setVolume(.37); engine.configureChannel(0, 34, { mute: true, solo: true, program: 97 });
  for (const preset of MIDI_MIXER_PRESETS) {
    applyMixerPreset(engine, preset.snapshot);
    const first = captureMixerPreset(engine.state);
    applyMixerPreset(engine, randomizeMixerPreset(engine.state, () => .37));
    applyMixerPreset(engine, preset.snapshot);
    assert.deepEqual(captureMixerPreset(engine.state), first, preset.id);
    assert.equal(engine.state.volume, .37); assert.equal(engine.context, null); assert.equal(engine.state.playing, false);
    assert.equal(engine.state.decks[0].channels.find(channel => channel.channel === 34).solo, false);
  }
  const serialized = JSON.stringify(captureMixerPreset(engine.state));
  for (const property of ['audioEnabled', 'playing', 'volume', 'analysis', 'soundfontName']) assert.ok(!serialized.includes(`"${property}"`));
  void engine.dispose();
});
test('randomizer varies all musical fields, retains source settings and produces finite bounded scenes', () => {
  let seed = 12469; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const engine = new MidiMixerEngine(), seen = new Map();
  const remember = (key, value) => { if (!seen.has(key)) seen.set(key, new Set()); seen.get(key).add(JSON.stringify(value)); };
  for (let i = 0; i < 250; i++) {
    const scene = randomizeMixerPreset(engine.state, random); applyMixerPreset(engine, scene);
    for (const [key, value] of Object.entries(scene.effects)) { if (key === 'synth') { for (const number of Object.values(value)) assert.ok(Number.isFinite(number)); } else assert.ok(Number.isFinite(value)); remember(key, value); }
    for (const [key, value] of Object.entries(scene.weave)) remember(`weave.${key}`, value);
    assert.match(scene.weave.pattern, /^[AB]{1,16}$/);
    for (const [index, deck] of scene.decks.entries()) {
      for (const [key, value] of Object.entries(deck.config)) remember(`${index}.${key}`, value);
      remember(`${index}.program`, deck.channels[0].program); remember(`${index}.channelMute`, deck.channels[0].mute); remember(`${index}.channelSolo`, deck.channels[0].solo);
      assert.ok(deck.config.loopEndBeats === null || deck.config.loopEndBeats > deck.config.loopStartBeats);
      assert.ok(deck.channels.some(channel => !channel.mute));
      assert.equal(deck.channels[9].program, null);
    }
    assert.ok(!scene.decks.every(deck => deck.config.mute));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `frozen ${key}`);
  assert.equal(engine.context, null); void engine.dispose();
});
test('version three scenes deeply capture and replace MIDI overrides, including additional ports', () => {
  const engine = new MidiMixerEngine();
  engine.configureDeck(0, { gain: 1.6, rate: 8, midi: { pan: -.6, controllers: { 7: 93, 64: 127 }, generators: { 8: 7500 } } });
  engine.configureChannel(0, 34, { midi: { fineTune: 31, controllers: { 10: 20 } } });
  engine.configureEffects({ synth: { 'reverb.time': 80, 'chorus.depth': 30 } });
  const snapshot = captureMixerPreset(engine.state);
  assert.equal(snapshot.version, 3); assert.equal(snapshot.decks[0].config.gain, 1.6); assert.equal(snapshot.decks[0].config.rate, 8);
  assert.equal(snapshot.decks[0].channels.find(item => item.channel === 34).midi.fineTune, 31);
  engine.configureDeck(0, { midi: { controllers: { 7: 20, 91: 100 }, generators: { 9: 120 } } });
  engine.configureEffects({ synth: { 'delay.level': 100 } });
  assert.equal(snapshot.decks[0].config.midi.controllers[7], 93);
  applyMixerPreset(engine, snapshot);
  assert.deepEqual(captureMixerPreset(engine.state), snapshot);
  const original = structuredClone(MIDI_MIXER_PRESETS[0].snapshot); original.version = 1;
  delete original.decks[0].config.midi; delete original.effects.synth;
  applyMixerPreset(engine, original);
  assert.deepEqual(engine.state.decks[0].config.midi, {});
  assert.deepEqual(engine.state.decks[0].channels.find(item => item.channel === 34).midi, {});
  assert.deepEqual(engine.state.effects.synth, {});
  assert.equal(engine.state.playing, false); assert.equal(engine.context, null); void engine.dispose();
});
test('random scenes reach every described musical override without mutating the current scene', () => {
  let seed = 51424; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const engine = new MidiMixerEngine(), current = engine.state, before = captureMixerPreset(current), seen = new Set();
  for (let n = 0; n < 120; n++) {
    const scene = randomizeMixerPreset(current, random);
    for (const key of Object.keys(scene.effects.synth)) seen.add(`effect:${key}`);
    for (const deck of scene.decks) for (const midi of [deck.config.midi, ...deck.channels.map(channel => channel.midi)]) {
      for (const key of Object.keys(midi)) seen.add(`field:${key}`);
      for (const key of Object.keys(midi.generators || {})) seen.add(`generator:${key}`);
    }
  }
  for (const descriptor of MIDI_PARAMETER_FIELDS) assert.ok(seen.has(`field:${descriptor.id}`), descriptor.id);
  for (const descriptor of MIDI_GENERATOR_PARAMETERS) assert.ok(seen.has(`generator:${descriptor.id}`), descriptor.label);
  for (const descriptor of MIDI_SYNTH_EFFECT_PARAMETERS) assert.ok(seen.has(`effect:${descriptor.id}`), descriptor.label);
  assert.deepEqual(captureMixerPreset(current), before); void engine.dispose();
});
test('full-song voice maps account for every note, isolate silent metadata channels, and preserve long silent sections', () => {
  const analysis = { durationBeats: 100, channels: [{ channel: 0, noteCount: 3 }, { channel: 9, noteCount: 2 }, { channel: 15, noteCount: 0 }], notes: [
    { channel: 0, beat: 0 }, { channel: 0, beat: 1 }, { channel: 0, beat: 99 }, { channel: 9, beat: 45 }, { channel: 9, beat: 45 },
  ] };
  const map = buildVoiceMap(analysis, 100); assert.equal(map.rows.length, 2);
  for (const row of map.rows) assert.equal(row.bins.reduce((a, b) => a + b, 0), row.noteCount);
  assert.equal(map.rows[0].bins[50], 0); assert.equal(map.rows[1].bins[45], 2); assert.equal(map.rows[1].peak, 2);
});

test('reverse and Weave scenes migrate, replace every timing field and preserve the running transport', async () => {
  const { generateTextMidi } = await import('../src/instruments/midiphoria/midiphoria-text-midi.js');
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const bytes = generateTextMidi('AB').buffer;
  await engine.loadDeck(0, bytes, 'AB'); engine.play(); now = 1200;
  engine.configureDeck(0, { reverse: 'controllers', offsetBeats: 1, loopStartBeats: 1, loopEndBeats: 3 });
  engine.configureWeave({ enabled: true, pattern: 'ABBA', length: 3, unit: 'beats', barBeats: 3.5, advance: 'running' });
  const saved = captureMixerPreset(engine.state), beat = engine.state.beat;
  for (const version of [1, 2]) {
    const legacy = { ...structuredClone(saved), version };
    applyMixerPreset(engine, legacy);
    assert.equal(engine.state.weave.enabled, false);
    assert.equal(engine.state.decks[0].config.reverse, 'off');
    applyMixerPreset(engine, saved);
    assert.deepEqual(captureMixerPreset(engine.state), saved);
    assert.equal(engine.state.playing, true); assert.equal(engine.state.beat, beat);
    assert.equal(engine.state.audioEnabled, false); assert.equal(engine.context, null);
  }
  engine.configureDeck(0, { reverse: 'off' });
  assert.deepEqual(new Uint8Array(engine.getDeckMidi(0)), new Uint8Array(bytes));
  await engine.dispose();
});

test('a failed reverse rewrite rolls back scene changes and retains the active Weave turn', async () => {
  const { generateTextMidi } = await import('../src/instruments/midiphoria/midiphoria-text-midi.js');
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  await engine.loadDeck(0, generateTextMidi('AB').buffer, 'AB');
  engine.configureWeave({ enabled: true, pattern: 'AB', length: 1, unit: 'beats' });
  engine.play(); now = 750;
  const transport = engine.state; assert.equal(transport.currentWeaveDeck, 1);
  const before = captureMixerPreset(engine.state), configure = engine.configureDeck.bind(engine);
  let fail = true;
  engine.configureDeck = (index, patch) => {
    if (index === 1 && fail) { fail = false; throw new Error('Rewritten MIDI exceeds file limit.'); }
    return configure(index, patch);
  };
  assert.throws(() => applyMixerPreset(engine, MIDI_MIXER_PRESETS.find(item => item.id === 'reverse-pair').snapshot), /exceeds file limit/);
  assert.deepEqual(captureMixerPreset(engine.state), before);
  assert.equal(engine.state.currentWeaveDeck, transport.currentWeaveDeck); assert.equal(engine.state.weaveStep, transport.weaveStep);
  assert.equal(engine.state.beat, transport.beat);
  assert.deepEqual(engine.state.decks.map(deck => deck.positionBeats), transport.decks.map(deck => deck.positionBeats));
  assert.equal(engine.state.playing, true); assert.equal(engine.context, null);
  await engine.dispose();
});
