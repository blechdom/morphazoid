import assert from 'node:assert/strict';
import test from 'node:test';
import { stampThumbnailRects } from '../src/instruments/blech-midi-ultra/blech-midi-stamp-picker.js';

test('a narrow stamp and a wide score both fill legible, bounded picture-menu previews', () => {
  const heart = stampThumbnailRects({ durationBeats: 4, notes: [
    { note: 60, beat: 0, duration: 1 }, { note: 64, beat: 1, duration: 1 },
    { note: 68, beat: 2, duration: 1 }, { note: 64, beat: 3, duration: 1 },
  ] });
  assert.ok(heart[0].x >= 4 && heart.at(-1).x > heart[0].x);
  assert.ok(heart[2].x - heart[0].x > 50, 'an eight-pitch picture must not collapse into eight canvas pixels');
  assert.ok(heart[0].width > 1 && heart[0].width < 20);
  assert.ok(heart[0].y > heart[2].y, 'upward means future, as on the playable stage');
  const full = stampThumbnailRects({ durationBeats: 4, notes: [
    { note: 0, beat: 0, duration: 1 }, { note: 127, beat: 3, duration: 1 },
  ] });
  assert.ok(full[0].x < 8 && full[1].x > 115);
  for (const rect of [...heart, ...full]) {
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 128);
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 64);
  }
});

test('single-pitch artwork stays centered; invalid notes and unloaded files stay placeholders', () => {
  assert.deepEqual(stampThumbnailRects({ file: 'not-loaded.mid' }), []);
  const middle = stampThumbnailRects({ analysis: { durationBeats: 2, notes: [
    { note: 64, beat: 1, duration: 1 }, { note: 128, beat: 0, duration: 1 },
    { note: 60, beat: -1, duration: 1 }, { note: 0, beat: 2, duration: 1 },
  ] } });
  assert.equal(middle.length, 1);
  assert.ok(middle[0].x >= 50 && middle[0].x <= 64);
  assert.ok(middle[0].width > 1);
});

test('even a giant file thumbnail samples at most 4096 notes without parsing MIDI', () => {
  let accesses = 0;
  const notes = new Proxy({ length: 1_000_000 }, { get(target, key) {
    if (key === 'length') return target.length;
    accesses++;
    return { note: Number(key) % 128, beat: Number(key) / 1_000_000 * 16, duration: .1 };
  } });
  assert.equal(stampThumbnailRects({ notes, durationBeats: 16 }).length, 4096);
  assert.equal(accesses, 4096);
});
