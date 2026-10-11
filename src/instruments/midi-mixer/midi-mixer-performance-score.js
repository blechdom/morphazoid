import { MidiDrawing } from '../midiphoria/midiphoria-drawing.js';
import { generateGridMidi, generateTextMidi } from '../midiphoria/midiphoria-text-midi.js';

export const MIXER_SAMPLE_STAMPS = Object.freeze([
  { id: 'heart', label: 'Heart', glyph: '❤' }, { id: 'square', label: 'Square' },
  { id: 'star', label: 'Star', glyph: '⭐' }, { id: 'smile', label: 'Smile', glyph: '🙂' },
  { id: 'diamond', label: 'Diamond', glyph: '◆' }, { id: 'wave', label: 'Wave', glyph: 'wave' },
].map(Object.freeze));

/** Raw trails carry earlier notes upward, so emit each picture's top row first.
 * The Draw editor's stationary score/playhead still uses its original direction.
 * Text phrases stay in reading order and retain their final silent row.
 */
export function mixerPerformanceScore(score, { trimLeading = false } = {}) {
  if (!score?.buffer || !Array.isArray(score.notes) || !score.notes.length
    || !Number.isInteger(score.rows) || score.rows < 1 || score.rows > 256
    || !Number.isInteger(score.columns) || score.columns < 1 || score.columns > 48
    || !Number.isFinite(score.secondsPerRow) || score.secondsPerRow <= 0) {
    throw new Error('Draw a score first in Draw a MIDI.');
  }
  const { rows, columns, secondsPerRow, lowestNote } = score;
  const phraseRows = score.rowsPerPhrase;
  if (phraseRows !== undefined && (!Number.isInteger(phraseRows) || phraseRows < 2 || rows % phraseRows)) {
    throw new Error('Invalid message score.');
  }
  const notes = score.notes.map(note => {
    const from = Math.round(note.start / secondsPerRow), length = Math.round(note.duration / secondsPerRow);
    const column = note.note - lowestNote;
    if (!Number.isInteger(column) || column < 0 || column >= columns || !Number.isFinite(from)
      || !Number.isFinite(length) || from < 0 || length < 1 || from + length > rows) {
      throw new Error('Invalid drawing score.');
    }
    const phraseStart = phraseRows ? Math.floor(from / phraseRows) * phraseRows : 0;
    const pictureRows = phraseRows ? phraseRows - 1 : rows;
    const start = phraseStart + pictureRows - (from - phraseStart) - length;
    if (start < phraseStart) throw new Error('Invalid message score.');
    return { column, start, length };
  });
  const shift = trimLeading ? Math.min(...notes.map(note => note.start)) : 0;
  const pixels = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (const { column, start, length } of notes) {
    for (let row = start - shift; row < start - shift + length; row++) pixels[rows - 1 - row][column] = 1;
  }
  return { ...score, ...generateGridMidi(pixels, { title: score.text, secondsPerRow, lowestNote }) };
}

export function mixerStampScore(id) {
  const stamp = MIXER_SAMPLE_STAMPS.find(item => item.id === id);
  if (!stamp) throw new Error('Choose a sample from the bank.');
  if (id === 'square') {
    const pixels = Array.from({ length: 32 }, (_, y) => Array.from({ length: 48 }, (_, x) =>
      Number(x >= 13 && x <= 34 && y >= 5 && y <= 26 && (x < 15 || x > 32 || y < 7 || y > 24))));
    return mixerPerformanceScore(generateGridMidi(pixels, { title: stamp.label, secondsPerRow: .125 }), { trimLeading: true });
  }
  const drawing = new MidiDrawing(); drawing.stamp(stamp.glyph);
  return mixerPerformanceScore(generateGridMidi(drawing.pixels, { title: stamp.label, secondsPerRow: .125 }), { trimLeading: true });
}

export function mixerMessageScore(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Type a message or a symbol first.');
  const score = generateTextMidi(input);
  return { ...mixerPerformanceScore(score), name: score.text };
}

/** Distinct stable renderer hues for each deck/channel and each sample instance. */
export function mixerPerformanceChannel(sourceId, channel = 0) {
  const boundedChannel = Math.max(0, Math.min(4095, Math.floor(Number(channel) || 0)));
  if (sourceId === 'deck:0') return boundedChannel;
  if (sourceId === 'deck:1') return 4096 + boundedChannel;
  let hash = 0;
  for (const character of String(sourceId).slice(0, 128)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return 8192 + (hash % 128) * 4096 + boundedChannel;
}

/** Prefix maxima skip old finished notes without scanning entire dense files. */
export function indexPerformanceNotes(notes) {
  const maxEnd = new Float64Array(notes.length);
  let maximum = -Infinity;
  for (let index = 0; index < notes.length; index++) {
    maximum = Math.max(maximum, notes[index].beat + notes[index].duration); maxEnd[index] = maximum;
  }
  return { notes, maxEnd };
}

/** A bounded display-only interval query; this function never schedules sound. */
export function queryPerformanceNotes(index, from, to, limit = 1024) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const { notes, maxEnd } = index;
  let low = 0, high = notes.length;
  while (low < high) { const middle = (low + high) >>> 1; if (notes[middle].beat <= to) low = middle + 1; else high = middle; }
  const result = [], budget = Math.max(1, Math.min(4096, Math.floor(limit) || 1024));
  for (let cursor = low - 1, visited = 0; cursor >= 0 && visited < budget * 4 && maxEnd[cursor] > from; cursor--, visited++) {
    const note = notes[cursor];
    if (note.beat + note.duration > from) result.push({ index: cursor, note });
    if (result.length >= budget) break;
  }
  return result.reverse();
}
