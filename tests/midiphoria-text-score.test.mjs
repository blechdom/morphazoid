import assert from 'node:assert/strict';
import test from 'node:test';
import { textMidiScoreLayout, drawTextMidiScore } from '../src/instruments/midiphoria/midiphoria-text-score.js';
import { DEFAULT_RENDER_OPTIONS } from '../src/instruments/midiphoria/midiphoria-presets.js';
import { DEFAULT_VISUALS } from '../src/instruments/midiphoria/midiphoria-model.js';

const score = { text: 'H', columns: 6, secondsPerColumn: .0625, highestNote: 66,
  notes: [{ note: 66, start: 0, duration: .0625, velocity: 80 },
    { note: 60, start: .25, duration: .0625, velocity: 80 }] };

test('score cells retain equal pitch/time scale in all supported viewports', () => {
  for (const [width, height] of [[960, 600], [358, 320], [480, 230]]) {
    const layout = textMidiScoreLayout(score, width, height, .125);
    assert.ok(layout.left >= 0 && layout.top >= 0);
    assert.ok(layout.left + layout.columns * layout.cell <= width);
    assert.ok(layout.top + 7 * layout.cell <= height);
    assert.equal(layout.playColumn, 2);
    assert.equal(layout.startColumn, 0);
  }
});

test('long scores follow transport time, include the final column, and return on seek', () => {
  const long = { ...score, columns: 192 };
  for (const width of [358, 960]) {
    const start = textMidiScoreLayout(long, width, 320, 0);
    const middle = textMidiScoreLayout(long, width, 320, 6);
    const end = textMidiScoreLayout(long, width, 320, 12);
    assert.equal(start.startColumn, 0);
    assert.ok(middle.startColumn > 0 && middle.startColumn < end.startColumn);
    assert.ok(middle.playColumn >= middle.startColumn);
    assert.ok(middle.playColumn <= middle.startColumn + middle.columns);
    assert.equal(end.startColumn + end.columns, long.columns);
    assert.deepEqual(textMidiScoreLayout(long, width, 320, 0), start);
  }
});

test('visible rectangles come from MIDI pitch and exact note length; only sounding notes brighten', () => {
  const fills = [];
  const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'fillText', 'moveTo', 'lineTo', 'stroke'].map(key => [key, () => {}]));
  const captions = [];
  ctx.textAlign = 'center'; // The normal note-trail renderer centers its pitch labels.
  ctx.fillText = (text, x) => captions.push({ text, x, align: ctx.textAlign });
  ctx.fillRect = (...rect) => fills.push({ rect, alpha: ctx.globalAlpha });
  drawTextMidiScore(ctx, 600, 300, score, { time: .02, playing: true }, DEFAULT_RENDER_OPTIONS, DEFAULT_VISUALS);
  const layout = textMidiScoreLayout(score, 600, 300, .02);
  assert.deepEqual(captions, [{ text: 'H', x: layout.left, align: 'left' }]);
  const notes = fills.filter(({ rect }) => rect[3] > 10 && rect[3] < 100);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].alpha, 1);
  assert.equal(notes[1].alpha, .64);
  assert.ok(Math.abs(notes[1].rect[0] - notes[0].rect[0] - 4 * layout.cell) < 1e-8);
  assert.ok(Math.abs(notes[1].rect[1] - notes[0].rect[1] - 6 * layout.cell) < 1e-8);
  fills.length = 0;
  drawTextMidiScore(ctx, 600, 300, score, { time: .02, playing: false }, DEFAULT_RENDER_OPTIONS, DEFAULT_VISUALS);
  assert.equal(fills.filter(({ alpha }) => alpha === 1).length, 1, 'paused notes are not shown as sounding');
});
