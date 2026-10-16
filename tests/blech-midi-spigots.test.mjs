import test from 'node:test';
import assert from 'node:assert/strict';
import { spigotGeometry, spigotPoint, spigotPlacement, spigotDimensions } from '../src/instruments/blech-midi/blech-midi-spigots.js';
import { dropScoreDimensions, resizeDropScore } from '../src/instruments/blech-midi/blech-midi-drop-stage.js';
import { encodeArtwork } from '../src/instruments/blech-midi/blech-midi-art.js';

test('spigot placement shares keyboard pitch and future audio-time coordinates', () => {
  for (const alignment of ['piano','equal']) {
    const g = spigotGeometry(1024, 600, 120, { alignment, lookAhead: 6 });
    for (const pitch of [0,1,60,61,127]) {
      const key = g.layout[pitch], point = spigotPoint((key.x + key.width / 2) * g.width, g.present - 2 * g.pixelsPerBeat, g);
      assert.deepEqual(point, { pitch, delayBeats: 2 });
    }
    assert.equal(spigotPoint(512, g.present + 100, g).delayBeats, 0);
  }
});

test('source placement keeps complete pitch span in bounds and retains playback choices', () => {
  const score = encodeArtwork([{ note: 40, beat: 0, duration: 1, velocity: 100 }, { note: 80, beat: 1, duration: 1, velocity: 100 }]);
  assert.deepEqual(spigotPlacement(score, { channel: 4, gain: .5, loop: true }, { pitch: 0, delayBeats: 4 }), { channel: 4, gain: .5, loop: true, transpose: -40, delayBeats: 4 });
  assert.equal(spigotPlacement(score, {}, { pitch: 127, delayBeats: 0 }).transpose, 47);
});

test('rotation changes prepared MIDI and dimensions follow its requested envelope', () => {
  const chord = encodeArtwork([60,64,68].map(note => ({ note, beat: 0, duration: 1, velocity: 100 })), { durationBeats: 4 });
  const rotated = resizeDropScore(chord, { rotationDegrees: 90 });
  assert.deepEqual(rotated.analysis.notes.map(note => note.note), [64,64,64]);
  assert.ok(rotated.analysis.notes.at(-1).beat > rotated.analysis.notes[0].beat);
  assert.equal(dropScoreDimensions(chord, { rotationDegrees: 90 }).width, 9);
  assert.deepEqual([rotated.pitchLow, rotated.pitchHigh], [60,68]);
  assert.equal(resizeDropScore(chord, { rotationDegrees: 360 }), chord);
});

test('rotating a temporal line opens width without making resize metadata disagree with its notes', () => {
  const line = encodeArtwork([0,1,2].map(beat => ({ note: 60, beat, duration: .25, velocity: 100 })), { durationBeats: 4 });
  for (const widthNotes of [null, 25, 100]) {
    const settings = { rotationDegrees: 90, widthNotes }, dimensions = dropScoreDimensions(line, settings), rotated = resizeDropScore(line, settings);
    assert.equal(dimensions.width, rotated.pitchWidth);
    assert.equal(dimensions.low, rotated.pitchLow);
    assert.equal(dimensions.high, rotated.pitchHigh);
    assert.equal(rotated.analysis.noteCount, line.analysis.noteCount);
  }
  assert.equal(dropScoreDimensions(line, { rotationDegrees: 180 }).width, 1);
});

test('persistent rotated source handles keep the transposed envelope around a collapsed chord', () => {
  const chord = encodeArtwork([60,64,68].map(note => ({ note, beat: 0, duration: 1, velocity: 100 })), { durationBeats: 4 });
  const rotated = resizeDropScore(chord, { rotationDegrees: 90 });
  const source = { score: { ...rotated, pitchLow: 72, pitchHigh: 80 }, settings: { transpose: 12, delayBeats: 3 } };
  const dimensions = spigotDimensions(source);
  assert.deepEqual([dimensions.low, dimensions.high, dimensions.width], [72,80,9], 'settings transpose is not added to already transformed envelope');
  assert.equal(dimensions.delayBeats, 3);
  assert.equal(dimensions.heightBeats, 4);
  const plain = spigotDimensions({ score: chord });
  assert.deepEqual([plain.low, plain.high, plain.width], [60,68,9]);
});
