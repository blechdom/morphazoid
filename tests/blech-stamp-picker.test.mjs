import assert from 'node:assert/strict';
import test from 'node:test';
import { stampThumbnailRects } from '../src/instruments/blech-midi/blech-midi-stamp-picker.js';

test('stamp preview matches falling score coordinates, including both MIDI pitch edges', () => {
  assert.deepEqual(stampThumbnailRects({ durationBeats: 4, notes: [
    { note: 0, beat: 0, duration: 1 }, { note: 127, beat: 3, duration: 1 },
  ] }), [
    { x: 0, y: 48, width: 1, height: 16 }, { x: 127, y: 0, width: 1, height: 16 },
  ]);
});

test('malformed notes cannot produce invalid thumbnail geometry or escape the preview', () => {
  const rects = stampThumbnailRects({ durationBeats: 4, notes: [
    { note: 60, beat: 3, duration: 10 }, { note: 64, beat: 3.999, duration: .00001 },
    { note: 128, beat: 0, duration: 1 }, { note: -1, beat: 0, duration: 1 },
    { note: 1, beat: -1, duration: 1 }, { note: 1, beat: 0, duration: 0 },
    { note: NaN, beat: 0, duration: 1 }, { note: 1, beat: Infinity, duration: 1 },
    { note: 1, beat: 4, duration: 1 }, null,
  ] });
  assert.equal(rects.length, 2);
  for (const rect of rects) {
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 128);
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 64 && rect.height >= 1);
  }
});

test('large existing MIDI scores have bounded preview work and no MIDI parsing', () => {
  let accesses = 0;
  const notes = new Proxy({ length: 1_000_000 }, { get(target, key) {
    if (key === 'length') return target.length;
    accesses++;
    return { note: Number(key) % 128, beat: Number(key) / 1_000_000 * 16, duration: .1 };
  } });
  assert.equal(stampThumbnailRects({ notes, durationBeats: 16 }).length, 4096);
  assert.equal(accesses, 4096);
});

test('score analysis is accepted while unloaded file choices stay placeholders', () => {
  assert.deepEqual(stampThumbnailRects({ file: 'unloaded.mid' }), []);
  assert.deepEqual(stampThumbnailRects({ analysis: { notes: [{ note: 64, beat: 1, duration: 1 }], durationBeats: 2 } }),
    [{ x: 64, y: 0, width: 1, height: 32 }]);
});
