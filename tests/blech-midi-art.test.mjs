import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageArtwork, transformArtwork, encodeArtwork, artworkStatistics, ART_SCRIPTS } from '../src/instruments/blech-midi/blech-midi-art.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

const chord = [48, 60, 72].map(note => ({ note, beat: 0, duration: 2, velocity: 90, layer: 0 }));
test('raster geometry maps bottom first and preserves full MIDI endpoints', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  const image = { width: 2, height: 2, data };
  const score = imageArtwork(image, { low: 0, high: 127, beats: 8 });
  assert.deepEqual(score.notes.map(({ note, beat, duration }) => [note, beat, duration]), [[0, 4, 4], [127, 0, 4]]);
  assert.deepEqual(imageArtwork(image, { low: 0, high: 127, beats: 8, invert: true }).notes.map(({ note, beat }) => [note, beat]), [[0, 0], [127, 4]]);
});
test('image articulation and brightness create actual velocities and attacks', () => {
  const solid = { width: 1, height: 4, data: new Uint8ClampedArray(Array.from({ length: 4 }, () => [32, 32, 32, 255]).flat()) };
  assert.equal(imageArtwork(solid).notes.length, 1);
  const result = imageArtwork(solid, { retrigger: true, velocityFromImage: true, velocity: 100 });
  assert.equal(result.notes.length, 4); assert.equal(result.notes[0].velocity, 87);
  assert.equal(imageArtwork({ ...solid, data: new Uint8ClampedArray(16) }).notes.length, 0);
});
test('arpeggiation, chopping and canon are nondestructive musical edits', () => {
  const before = structuredClone(chord);
  assert.deepEqual(transformArtwork(chord, 'arp-up', { step: .25 }).notes.map(n => [n.note, n.beat]), [[48, 0], [60, .25], [72, .5]]);
  assert.deepEqual(transformArtwork(chord, 'arp-down', { step: .25 }).notes.map(n => n.note), [72, 60, 48]);
  assert.deepEqual(transformArtwork(chord, 'arp-pingpong', { step: .25 }).notes.map(n => n.note), [48, 72, 60]);
  assert.equal(transformArtwork(chord, 'ratchet', { repeats: 4 }).notes.length, 12);
  assert.equal(transformArtwork(chord, 'canon', { repeats: 3, interval: -12 }).notes[2].note, 24);
  assert.deepEqual(chord, before);
});
test('seed controls reproducible scatter and note clouds with no scale snapping', () => {
  const options = { seed: 429, amount: .8, beats: 4, step: .125, low: 0, high: 127 };
  for (const script of ['scatter', 'noise']) {
    assert.deepEqual(transformArtwork(chord, script, options), transformArtwork(chord, script, options));
    assert.notDeepEqual(transformArtwork(chord, script, options), transformArtwork(chord, script, { ...options, seed: 430 }));
  }
  assert.equal(transformArtwork([], 'noise', options).notes.length, 32);
});
test('curves change pitch, velocity and release while flat depth preserves source', () => {
  const notes = [{ note: 60, beat: 0, duration: 1, velocity: 60 }, { note: 60, beat: 4, duration: 1, velocity: 60 }];
  const result = transformArtwork(notes, 'none', { beats: 8, pitchCurve: 'rise', pitchDepth: 12, velocityCurve: 'fall', velocityDepth: .5, gateCurve: 'fall', gateDepth: .5 });
  assert.deepEqual(result.notes.map(n => [n.note, n.velocity, n.duration]), [[48, 90, 1.5], [60, 60, 1]]);
  assert.deepEqual(transformArtwork(chord, 'none', { pitchCurve: 'sine', pitchDepth: 0 }).notes, chord);
});
test('SMF tracks preserve overlapping voices, exact endpoints, tempo and attack count', () => {
  const notes = [...chord, { note: 48, beat: 0, duration: 3, velocity: 70, layer: 1 }, { note: 127, beat: 3, duration: .5, velocity: 1, layer: 1 }];
  const score = encodeArtwork(notes, { tempo: 150, durationBeats: 8 });
  const parsed = parseMidi(score.buffer);
  assert.equal(parsed.format, 1); assert.equal(parsed.trackCount, 2); assert.equal(parsed.noteCount, 5); assert.equal(parsed.initialTempo, 150); assert.equal(parsed.durationBeats, 8);
  assert.deepEqual(parsed.notes.filter(n => n.note === 48).map(n => [n.channel, n.duration]), [[0, 2], [1, 3]]);
  assert.deepEqual(artworkStatistics(parsed.notes), { notes: 5, peakPolyphony: 4 });
  assert.equal(parsed.events.filter(n => n.kind === 9 && n.b > 0).length, 5);
});
test('every documented script exports bounded MIDI and preserves distinct layers', () => {
  for (const script of ART_SCRIPTS) {
    const result = transformArtwork(chord, script.id, { seed: 1, beats: 4, step: .125 });
    const score = encodeArtwork(result.notes, result);
    assert.equal(score.analysis.noteCount, result.notes.length, script.id);
    assert.ok(score.analysis.notes.every(note => note.note >= 0 && note.note <= 127 && note.duration > 0 && note.velocity >= 1));
  }
});
test('limits fail explicitly rather than truncating artwork', () => {
  assert.throws(() => transformArtwork(Array.from({ length: 3000 }, () => chord[0]), 'canon', { repeats: 16 }), /32,768/);
  assert.throws(() => encodeArtwork([{ ...chord[0], beat: 511, duration: 2 }]), /512 beats/);
  assert.throws(() => encodeArtwork([]), /Add an image/);
  assert.throws(() => transformArtwork([{ ...chord[0], beat: NaN }]), /512 beats/);
  const full = Array.from({ length: 32768 }, (_, i) => ({ note: i % 128, beat: Math.floor(i / 128) / 8, duration: 1 / 16, velocity: 32, layer: 0 }));
  assert.equal(encodeArtwork(full).analysis.noteCount, 32768);
});
