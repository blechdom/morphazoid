import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiMixerEngine } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MIDI_MIXER_PRESETS, captureMixerPreset, applyMixerPreset, randomizeMixerPreset } from '../src/instruments/midi-mixer/midi-mixer-presets.js';
import { buildVoiceMap } from '../src/instruments/midi-mixer/midi-mixer-renderer.js';

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
    for (const [key, value] of Object.entries(scene.effects)) { assert.ok(Number.isFinite(value)); remember(key, value); }
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
test('full-song voice maps account for every note, isolate silent metadata channels, and preserve long silent sections', () => {
  const analysis = { durationBeats: 100, channels: [{ channel: 0, noteCount: 3 }, { channel: 9, noteCount: 2 }, { channel: 15, noteCount: 0 }], notes: [
    { channel: 0, beat: 0 }, { channel: 0, beat: 1 }, { channel: 0, beat: 99 }, { channel: 9, beat: 45 }, { channel: 9, beat: 45 },
  ] };
  const map = buildVoiceMap(analysis, 100); assert.equal(map.rows.length, 2);
  for (const row of map.rows) assert.equal(row.bins.reduce((a, b) => a + b, 0), row.noteCount);
  assert.equal(map.rows[0].bins[50], 0); assert.equal(map.rows[1].bins[45], 2); assert.equal(map.rows[1].peak, 2);
});
