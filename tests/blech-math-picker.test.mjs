import assert from 'node:assert/strict';
import test from 'node:test';
import { MATH_PRESETS } from '../src/instruments/blech-midi/blech-midi-math.js';
import { mathPresetThumbnailArtwork } from '../src/instruments/blech-midi/blech-midi-math-controls.js';
import { stampThumbnailRects } from '../src/instruments/blech-midi/blech-midi-stamp-picker.js';

test('every formula has a finite, bounded thumbnail without producing a playable score', () => {
  const shapes = new Set();
  for (const preset of MATH_PRESETS) {
    const before = structuredClone(preset), artwork = mathPresetThumbnailArtwork(preset);
    assert.ok(artwork.notes.length > 0 && artwork.notes.length <= 96, preset.id);
    assert.equal(artwork.samples, 96);
    assert.equal(artwork.events, undefined);
    assert.equal(artwork.bytes, undefined);
    assert.deepEqual(preset, before);
    const rectangles = stampThumbnailRects(artwork);
    for (const rect of rectangles) {
      assert.ok(Object.values(rect).every(Number.isFinite), preset.id);
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 128, preset.id);
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 64, preset.id);
    }
    shapes.add(JSON.stringify(rectangles));
  }
  assert.equal(shapes.size, MATH_PRESETS.length, 'each formula should have a distinct catalogue graphic');
});

test('time-evolving thumbnail widens upward like its future falling-note preview', () => {
  const preset = MATH_PRESETS.find(item => item.id === 'opening-fan');
  const artwork = mathPresetThumbnailArtwork(preset);
  const span = notes => Math.max(...notes.map(note => note.note)) - Math.min(...notes.map(note => note.note));
  const beginning = artwork.notes.filter(note => note.beat < artwork.durationBeats / 4);
  const ending = artwork.notes.filter(note => note.beat > artwork.durationBeats * .75);
  assert.ok(span(ending) > span(beginning) * 2);
  const beginningRects = stampThumbnailRects({ ...artwork, notes: beginning });
  const endingRects = stampThumbnailRects({ ...artwork, notes: ending });
  assert.ok(Math.min(...beginningRects.map(rect => rect.y)) > Math.max(...endingRects.map(rect => rect.y)));
});
