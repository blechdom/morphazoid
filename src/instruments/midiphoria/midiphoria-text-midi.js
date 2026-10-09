// Original 5 × 7 block lettering, authored here rather than rasterized from a
// font. A lit pixel is a MIDI note: columns are chromatic pitch, rows are time.
// Each phrase plays from its bottom row upward; vertical runs sustain notes.
const GLYPHS = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  ';': ['00000', '00100', '00100', '00000', '00100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
  '\\': ['10000', '10000', '01000', '00100', '00010', '00001', '00001'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '[': ['01110', '01000', '01000', '01000', '01000', '01000', '01110'],
  ']': ['01110', '00010', '00010', '00010', '00010', '00010', '01110'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
});

export const MAX_TEXT_MIDI_GLYPHS = 32;
const INPUT_SCAN_LIMIT = 4096;
const ROWS = 7;
const GLYPH_COLUMNS = 5;
const GLYPH_STRIDE = GLYPH_COLUMNS + 1;
const GLYPHS_PER_PHRASE = 8;
const ROWS_PER_PHRASE = ROWS + 1;
const LOWEST_NOTE = 48;
const TICKS_PER_BEAT = 480;
const TICKS_PER_ROW = TICKS_PER_BEAT / 2;
const SECONDS_PER_ROW = 0.5 / 2; // 120 BPM, one half of a beat.
const VELOCITY = 88;

/** Bounded ASCII lettering; unsupported characters become word separators. */
export function normalizeTextMidi(input) {
  if (typeof input !== 'string') return '';
  const normalized = input.slice(0, INPUT_SCAN_LIMIT).normalize('NFKD')
    .replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  let text = '';
  for (const character of normalized) {
    if (Object.hasOwn(GLYPHS, character)) text += character;
    else if (text && !text.endsWith(' ')) text += ' ';
    if (text.length === MAX_TEXT_MIDI_GLYPHS) break;
  }
  return text.trimEnd();
}

const uint32 = value => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
function variableLength(value) {
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}

/**
 * Generate a format-0 Standard MIDI File and its matching piano-roll score.
 * start, duration and total duration are in seconds at the file's 120 BPM.
 * Up to eight upright glyphs read left to right in each phrase. Pitch increases
 * from left to right; time climbs from the bottom row to the top, followed by a
 * blank row before the next phrase. No scale snapping is applied.
 * A 32-glyph score lasts at most 8 s, holds at most 40 notes, and contains
 * at most 640 note runs / 1,280 note events. This owns no audio or UI lifecycle.
 */
export function generateTextMidi(input) {
  const text = normalizeTextMidi(input);
  if (!text) throw new Error('Type letters, numbers or punctuation to make a MIDI.');
  const phrases = [];
  for (let index = 0; index < text.length; index += GLYPHS_PER_PHRASE) {
    phrases.push(text.slice(index, index + GLYPHS_PER_PHRASE));
  }
  const columns = Math.min(GLYPHS_PER_PHRASE, text.length) * GLYPH_STRIDE - 1;
  const rows = phrases.length * ROWS_PER_PHRASE;
  const notes = [];
  for (let glyphIndex = 0; glyphIndex < text.length; glyphIndex++) {
    const glyph = GLYPHS[text[glyphIndex]];
    if (!glyph) continue; // Spaces retain their silent pitch columns.
    const phrase = Math.floor(glyphIndex / GLYPHS_PER_PHRASE);
    const pitchOffset = glyphIndex % GLYPHS_PER_PHRASE * GLYPH_STRIDE;
    for (let column = 0; column < GLYPH_COLUMNS; column++) {
      for (let row = 0; row < ROWS;) {
        if (glyph[ROWS - 1 - row][column] !== '1') { row++; continue; }
        const from = row;
        while (row < ROWS && glyph[ROWS - 1 - row][column] === '1') row++;
        notes.push({ note: LOWEST_NOTE + pitchOffset + column,
          start: (phrase * ROWS_PER_PHRASE + from) * SECONDS_PER_ROW,
          duration: (row - from) * SECONDS_PER_ROW, velocity: VELOCITY });
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  const title = [...`Text: ${text}`].map(character => character.charCodeAt(0));
  const events = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, title.length, ...title] },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] },
    { tick: 0, order: 0, bytes: [0xc0, 81] }, // GM Lead 2 (sawtooth), channel 1.
  ];
  for (const { note, start, duration, velocity } of notes) {
    const from = Math.round(start / SECONDS_PER_ROW) * TICKS_PER_ROW;
    const length = Math.round(duration / SECONDS_PER_ROW) * TICKS_PER_ROW;
    events.push({ tick: from, order: 2, bytes: [0x90, note, velocity] });
    events.push({ tick: from + length, order: 1, bytes: [0x80, note, 0] });
  }
  // SpessaSynth measures duration through the last channel event, not EOT.
  // Preserve the final blank row when looping, without adding a sounding note.
  const endTick = rows * TICKS_PER_ROW;
  events.push({ tick: endTick, order: 3, bytes: [0xb0, 123, 0] });
  events.push({ tick: endTick, order: 4, bytes: [0xff, 0x2f, 0] });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  let previousTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  const buffer = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    TICKS_PER_BEAT >>> 8, TICKS_PER_BEAT & 255,
    0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track,
  ]).buffer;
  return { buffer, text, notes, duration: rows * SECONDS_PER_ROW,
    columns, rows, phrases, rowsPerPhrase: ROWS_PER_PHRASE, secondsPerRow: SECONDS_PER_ROW,
    lowestNote: LOWEST_NOTE, highestNote: LOWEST_NOTE + columns - 1 };
}
