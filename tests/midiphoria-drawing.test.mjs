import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiDrawing, drawingLine } from '../src/instruments/midiphoria/midiphoria-drawing.js';

test('a fast captured drag paints every crossed cell and one undo removes the entire gesture', () => {
  const drawing = new MidiDrawing();
  drawing.begin({ x: 0, y: 31 });
  drawing.move({ x: 47, y: 0 });
  drawing.end();
  assert.equal(drawing.count, 48);
  assert.equal(drawing.history.length, 1);
  assert.equal(drawing.pixels[31][0], 1);
  assert.equal(drawing.pixels[0][47], 1);
  for (let x = 0; x < 48; x++) assert.equal(drawing.pixels.reduce((sum, row) => sum + row[x], 0), 1);
  const score = drawing.score();
  assert.equal(score.duration, 4);
  assert.equal(score.notes.length, 48);
  assert.equal(score.notes[0].note, 48);
  assert.equal(score.notes.at(-1).note, 95);
  drawing.undo();
  assert.equal(drawing.count, 0);
  assert.throws(() => drawing.score(), /Draw some notes/);
});

test('erase drags, clear, and stamps each restore with a single undo', () => {
  const drawing = new MidiDrawing();
  drawing.stamp('⭐');
  const before = structuredClone(drawing.pixels), count = drawing.count;
  drawing.begin({ x: 0, y: 15 }, true); drawing.move({ x: 47, y: 15 }); drawing.end();
  assert.ok(drawing.count < count); drawing.undo(); assert.deepEqual(drawing.pixels, before);
  drawing.clear(); assert.equal(drawing.count, 0); drawing.undo(); assert.deepEqual(drawing.pixels, before);
  drawing.stamp('spiral'); assert.notDeepEqual(drawing.pixels, before); drawing.undo(); assert.deepEqual(drawing.pixels, before);
});

test('ending/cancelling a stroke stops further motion; no-op strokes do not consume undo history', () => {
  const drawing = new MidiDrawing();
  drawing.begin({ x: 1, y: 1 }); drawing.end();
  drawing.move({ x: 30, y: 30 }); assert.equal(drawing.count, 1);
  drawing.begin({ x: 1, y: 1 }); drawing.end(); assert.equal(drawing.history.length, 1);
  drawing.undo(); assert.equal(drawing.count, 0);
});

test('geometric and emoji stamps stay bounded, distinct, and soundable', () => {
  const shapes = new Set(), drawing = new MidiDrawing();
  for (const kind of ['🙂', '⭐', '❤', '◆', 'spiral', 'wave', 'zigzag']) {
    drawing.stamp(kind);
    const score = drawing.score();
    assert.ok(score.notes.length > 0 && score.notes.length <= 768);
    assert.ok(score.notes.every(note => note.note >= 48 && note.note <= 95 && note.start + note.duration <= 4));
    shapes.add(JSON.stringify(drawing.pixels));
  }
  assert.equal(shapes.size, 7);
  for (let index = 0; index < 100; index++) drawing.stamp('wave');
  assert.equal(drawing.history.length, 32);
});

test('interpolation clamps off-stage drags and rejects non-finite coordinates', () => {
  assert.equal(drawingLine({ x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }).length, 48);
  assert.throws(() => drawingLine({ x: NaN, y: 0 }, { x: 1, y: 1 }));
  assert.throws(() => drawingLine({ x: 0, y: 0 }, { x: Infinity, y: 1 }));
});
