import assert from 'node:assert/strict';
import test from 'node:test';
import { textMidiScoreLayout, drawTextMidiScore } from '../src/instruments/midiphoria/midiphoria-text-score.js';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { DEFAULT_RENDER_OPTIONS } from '../src/instruments/midiphoria/midiphoria-presets.js';
import { DEFAULT_VISUALS } from '../src/instruments/midiphoria/midiphoria-model.js';

const score = { text: 'F', columns: 5, rows: 8, secondsPerRow: .25, lowestNote: 48, highestNote: 52,
  notes: [{ note: 48, start: 0, duration: .25, velocity: 80 },
    { note: 52, start: 1, duration: .5, velocity: 80 }] };
const viewports = [[960, 600], [358, 320], [480, 230]];

function context() {
  const fills = [], captions = [], paths = [];
  const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'stroke'].map(key => [key, () => {}]));
  ctx.textAlign = 'center'; // Normal trails center their pitch labels.
  ctx.fillText = (text, x) => captions.push({ text, x, align: ctx.textAlign });
  ctx.fillRect = (...rect) => fills.push({ rect, alpha: ctx.globalAlpha });
  ctx.moveTo = (...point) => paths.push(['moveTo', ...point]);
  ctx.lineTo = (...point) => paths.push(['lineTo', ...point]);
  return { ctx, fills, captions, paths };
}

test('score cells retain equal pitch/time scale in all supported viewports', () => {
  for (const [width, height] of viewports) {
    const layout = textMidiScoreLayout(score, width, height, .5);
    assert.ok(layout.left >= 0 && layout.top >= 0);
    assert.ok(layout.left + layout.columns * layout.cell <= width);
    assert.ok(layout.top + layout.rows * layout.cell <= height);
    assert.equal(layout.bottom, layout.top + layout.rows * layout.cell);
    assert.equal(layout.playRow, 2);
    assert.equal(layout.startRow, 0);
  }
});

test('long scores follow vertical transport time, include the final rest, and return on seek', () => {
  const long = generateTextMidi('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  for (const [width, height] of viewports) {
    const start = textMidiScoreLayout(long, width, height, 0);
    const middle = textMidiScoreLayout(long, width, height, 3);
    const end = textMidiScoreLayout(long, width, height, 8);
    assert.equal(start.startRow, 0);
    assert.ok(middle.startRow > 0 && middle.startRow < end.startRow);
    assert.ok(middle.playRow >= middle.startRow);
    assert.ok(middle.playRow <= middle.startRow + middle.rows);
    assert.equal(end.startRow + end.rows, long.rows);
    assert.equal(end.playRow, long.rows);
    assert.ok(start.cell >= 6, 'the widest score keeps readable glyph pixels on supported screens');
    assert.deepEqual(textMidiScoreLayout(long, width, height, 0), start);
    assert.equal(textMidiScoreLayout(long, width, height, Infinity).playRow, 0);
    assert.equal(textMidiScoreLayout(long, width, height, -1).playRow, 0);
  }
});

test('the playhead is horizontal and rises as the matching audio time advances', () => {
  for (const [width, height] of viewports) {
    const positions = [];
    for (const time of [0, .5, 1.5]) {
      const { ctx, paths } = context();
      drawTextMidiScore(ctx, width, height, score, { time, playing: true }, DEFAULT_RENDER_OPTIONS, DEFAULT_VISUALS);
      const [from, to] = paths;
      assert.equal(from[0], 'moveTo'); assert.equal(to[0], 'lineTo');
      assert.equal(from[2], to[2], 'equal y coordinates make a horizontal playhead');
      assert.ok(to[1] > from[1], 'the playhead spans the pitch axis');
      positions.push(from[2]);
    }
    assert.ok(positions[0] > positions[1] && positions[1] > positions[2]);
  }
});

test('rectangles use actual MIDI pitches horizontally and note durations vertically, with sounding notes highlighted', () => {
  const { ctx, fills, captions } = context();
  drawTextMidiScore(ctx, 600, 300, score, { time: .02, playing: true }, DEFAULT_RENDER_OPTIONS, DEFAULT_VISUALS);
  const layout = textMidiScoreLayout(score, 600, 300, .02);
  assert.deepEqual(captions, [{ text: 'F', x: layout.left, align: 'left' }]);
  const notes = fills.filter(({ rect }) => rect[2] < 600 && rect[3] > layout.cell * .4);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].alpha, 1);
  assert.equal(notes[1].alpha, .64);
  assert.ok(Math.abs(notes[1].rect[0] - notes[0].rect[0] - 4 * layout.cell) < 1e-8);
  assert.ok(Math.abs(notes[1].rect[1] - notes[0].rect[1] + 5 * layout.cell) < 1e-8);
  assert.ok(Math.abs(notes[1].rect[3] - notes[0].rect[3] - layout.cell) < 1e-8);
  fills.length = 0;
  drawTextMidiScore(ctx, 600, 300, score, { time: .02, playing: false }, DEFAULT_RENDER_OPTIONS, DEFAULT_VISUALS);
  assert.equal(fills.filter(({ alpha }) => alpha === 1).length, 1, 'paused notes are not shown as sounding');
});
