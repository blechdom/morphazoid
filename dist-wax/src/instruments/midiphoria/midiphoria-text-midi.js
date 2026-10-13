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

// Curated pixel icons, independent of installed fonts or platform emoji artwork.
const ICONS = Object.freeze({
  '🙂': ['00000', '01010', '01010', '00000', '10001', '01110', '00000'],
  '😀': ['00000', '01010', '01010', '00000', '11111', '10101', '01110'],
  '⭐': ['00100', '00100', '11111', '01110', '01110', '01010', '10001'],
  '❤': ['00000', '01010', '11111', '11111', '01110', '00100', '00000'],
  '◆': ['00100', '01110', '11011', '10001', '11011', '01110', '00100'],
});
const glyphFor = character => GLYPHS[character] ?? ICONS[character];
export const MAX_TEXT_MIDI_GLYPHS = 32;
const INPUT_SCAN_LIMIT = 4096;
const ROWS = 7, GLYPH_COLUMNS = 5, GLYPH_STRIDE = 6;
const ROWS_PER_PHRASE = 8, LOWEST_NOTE = 48, TICKS_PER_BEAT = 480;
const SECONDS_PER_ROW = .25, VELOCITY = 88;

function normalizedInput(input) {
  return typeof input === 'string' ? input.slice(0, INPUT_SCAN_LIMIT).normalize('NFKD')
    .replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-') : '';
}

/** Unsupported characters become silent word separators, never hidden notes. */
export function normalizeTextMidi(input) {
  const characters = [];
  for (const character of normalizedInput(input)) {
    if (glyphFor(character)) characters.push(character);
    else if (characters.length && characters.at(-1) !== ' ') characters.push(' ');
    if (characters.length === MAX_TEXT_MIDI_GLYPHS) break;
  }
  return characters.join('').trimEnd();
}

const uint32 = value => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
function variableLength(value) {
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}

/** One bounded pixel score owns both the visual notes and the exported MIDI.
 * Input pixels are upright, top row first; time always travels bottom to top.
 * Adjacent vertical pixels sustain a chromatic note unless retrigger is enabled;
 * there is no scale snapping.
 */
export function generateGridMidi(pixels, { title = 'Drawing', secondsPerRow = .25, lowestNote = 48, retrigger = false, velocity = VELOCITY, ticksPerBeat = TICKS_PER_BEAT } = {}) {
  if (!Array.isArray(pixels) || !pixels.length || pixels.length > 256) throw new Error('Use 1–256 rows.');
  const columns = pixels[0]?.length, rows = pixels.length;
  if (!Number.isInteger(columns) || columns < 1 || columns > 128
    || pixels.some(row => row?.length !== columns)) throw new Error('Use a rectangular grid with 1–128 columns.');
  if (!Number.isInteger(ticksPerBeat) || ticksPerBeat < 1 || ticksPerBeat > 0x7fff) throw new Error('Use 1–32767 MIDI ticks per beat.');
  const ticksPerSecond = ticksPerBeat * 2; // The generated score uses 120 BPM.
  if (!Number.isFinite(secondsPerRow) || secondsPerRow < 1 / ticksPerSecond || secondsPerRow > 32 || rows * secondsPerRow > 128
    || !Number.isInteger(lowestNote) || lowestNote < 0 || lowestNote + columns > 128) throw new Error('Invalid score timing or pitch range.');
  if (typeof retrigger !== 'boolean' || !Number.isInteger(velocity) || velocity < 1 || velocity > 127) throw new Error('Invalid note articulation or velocity.');
  secondsPerRow = Math.round(secondsPerRow * ticksPerSecond) / ticksPerSecond;
  const filled = value => value === 1 || value === true || value === '1';
  const notes = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows;) {
      if (!filled(pixels[rows - 1 - row][column])) { row++; continue; }
      const from = row;
      do { row++; } while (!retrigger && row < rows && filled(pixels[rows - 1 - row][column]));
      notes.push({ note: lowestNote + column, start: from * secondsPerRow,
        duration: (row - from) * secondsPerRow, velocity });
    }
  }
  if (!notes.length) throw new Error('Draw some notes or choose a stamp first.');
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  const text = String(title).slice(0, 256);
  const titleBytes = [...new TextEncoder().encode(text)];
  const ticksPerRow = secondsPerRow * ticksPerSecond;
  const events = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(titleBytes.length), ...titleBytes] },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] },
    { tick: 0, order: 0, bytes: [0xc0, 0] },
  ];
  for (const { note, start, duration, velocity } of notes) {
    events.push({ tick: Math.round(start * ticksPerSecond), order: 2, bytes: [0x90, note, velocity] });
    events.push({ tick: Math.round((start + duration) * ticksPerSecond), order: 1, bytes: [0x80, note, 0] });
  }
  const endTick = Math.round(rows * ticksPerRow);
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
    ticksPerBeat >>> 8, ticksPerBeat & 255,
    0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track,
  ]).buffer;
  return { buffer, text, notes, duration: rows * secondsPerRow, columns, rows,
    secondsPerRow, lowestNote, highestNote: lowestNote + columns - 1, ticksPerBeat };
}

/** Whole words rise together, or individual letters use successive time windows. */
export function generateTextMidi(input, { mode = 'word' } = {}) {
  const text = normalizeTextMidi(input), characters = [...text];
  if (!text) throw new Error('Type letters, numbers or punctuation, or try 🙂 😀 ⭐ ❤ ◆.');
  const perPhrase = mode === 'letter' ? 1 : 8;
  const phrases = [];
  for (let index = 0; index < characters.length; index += perPhrase) phrases.push(characters.slice(index, index + perPhrase).join(''));
  const columns = Math.min(perPhrase, characters.length) * GLYPH_STRIDE - 1;
  const rows = phrases.length * ROWS_PER_PHRASE;
  const pixels = Array.from({ length: rows }, () => Array(columns).fill(0));
  characters.forEach((character, glyphIndex) => {
    const glyph = glyphFor(character);
    if (!glyph) return;
    const phrase = Math.floor(glyphIndex / perPhrase), offset = glyphIndex % perPhrase * GLYPH_STRIDE;
    for (let row = 0; row < ROWS; row++) for (let column = 0; column < GLYPH_COLUMNS; column++) {
      pixels[rows - 1 - (phrase * ROWS_PER_PHRASE + ROWS - 1 - row)][offset + column] = Number(glyph[row][column]);
    }
  });
  const score = generateGridMidi(pixels, { title: `Text: ${text}`, secondsPerRow: SECONDS_PER_ROW, lowestNote: LOWEST_NOTE });
  const unsupported = [...new Set([...normalizedInput(input)].filter(character => !glyphFor(character) && !/\s/.test(character)))].slice(0, 8);
  return { ...score, text, phrases, rowsPerPhrase: ROWS_PER_PHRASE, unsupported, mode: mode === 'letter' ? 'letter' : 'word' };
}

/** BLECH's editable text document. Keep the legacy eight-character generator
 * above byte-compatible; this layout preserves deliberate lines and wraps words.
 * All geometry is a single bounded raster shared by the preview and MIDI file.
 */
export function generateLaidOutTextMidi(input, { mode = 'word', span = 48, lowestNote = 40,
  beats = 8, fit = true, scale = 1, align = 'center' } = {}) {
  const bounded = (value, low, high, fallback) => Number.isFinite(Number(value))
    ? Math.max(low, Math.min(high, Number(value))) : fallback;
  span = Math.round(bounded(span, GLYPH_COLUMNS, 128, 48));
  lowestNote = Math.round(bounded(lowestNote, 0, 128 - span, Math.min(40, 128 - span)));
  beats = Math.round(bounded(beats, .25, 64, 8) * 4) / 4;
  mode = mode === 'letter' ? 'letter' : 'word'; fit = Boolean(fit);
  scale = Math.min(Math.round(bounded(scale, 1, 4, 1)), Math.floor(span / GLYPH_COLUMNS));
  align = ['left', 'center', 'right'].includes(align) ? align : 'center';
  const source = normalizedInput(input).replace(/\r\n?/g, '\n');
  const unsupported = [...new Set([...source].filter(character => !glyphFor(character) && !/\s/.test(character)))].slice(0, 8);
  // Unsupported symbols separate words. Explicit line endings retain blank
  // lines, while horizontal whitespace does not consume an invisible margin.
  const cleanLines = text => text.split('\n').map(line => line.replace(/ +/g, ' ').trim()).join('\n');
  const normalized = cleanLines([...source].map(character => glyphFor(character) ? character : character === '\n' ? '\n' : ' ').join(''));
  const characters = [...normalized], text = cleanLines(characters.slice(0, MAX_TEXT_MIDI_GLYPHS).join(''));
  let truncated = characters.length > MAX_TEXT_MIDI_GLYPHS || typeof input === 'string' && input.length > INPUT_SCAN_LIMIT;
  if (![...text].some(glyphFor)) throw new Error('Type letters, numbers or punctuation, or try 🙂 😀 ⭐ ❤ ◆.');
  const capacity = Math.max(1, Math.floor((span + (fit ? 1 : scale)) / (GLYPH_STRIDE * (fit ? 1 : scale))));
  const lines = [], paragraphs = text.split('\n');
  const append = (content, breakReason, sourceLine) => {
    if (lines.length >= 32) { truncated = true; return; }
    lines.push({ text: content, breakReason, sourceLine });
  };
  paragraphs.forEach((paragraph, sourceLine) => {
    const ending = sourceLine < paragraphs.length - 1 ? 'explicit' : 'end';
    if (!paragraph) { append('', ending, sourceLine); return; }
    if (mode === 'letter') {
      const glyphs = [...paragraph];
      glyphs.forEach((character, index) => append(character === ' ' ? '' : character,
        index === glyphs.length - 1 ? ending : 'letter', sourceLine));
      return;
    }
    let current = '';
    for (const token of paragraph.split(' ')) {
      let word = [...token];
      if (current && [...current].length + 1 + word.length <= capacity) { current += ` ${token}`; continue; }
      if (current) { append(current, 'wrap', sourceLine); current = ''; }
      while (word.length > capacity) {
        append(word.slice(0, capacity).join(''), 'hard-wrap', sourceLine); word = word.slice(capacity);
      }
      current = word.join('');
    }
    if (current) append(current, ending, sourceLine);
  });
  const nativeWidth = line => Math.max(0, [...line.text].length * GLYPH_STRIDE - 1);
  const longestWidth = Math.max(...lines.map(nativeWidth));
  const pitchScale = fit ? span / longestWidth : scale;
  const pixels = Array.from({ length: lines.length * ROWS_PER_PHRASE }, () => Array(span).fill(0));
  lines.forEach((line, index) => {
    const width = nativeWidth(line); if (!width) return;
    // Every line uses the longest line's fit ratio, so a short word retains the
    // same letter size. Scale mode expands each pitch pixel by an integer.
    const outputWidth = Math.max(1, Math.round(width * pitchScale));
    const offset = align === 'left' ? 0 : align === 'right' ? span - outputWidth : Math.floor((span - outputWidth) / 2);
    const glyphs = [...line.text];
    for (let row = 0; row < ROWS; row++) for (let column = 0; column < outputWidth; column++) {
      const original = Math.floor((column + .5) / pitchScale);
      const glyph = glyphFor(glyphs[Math.floor(original / GLYPH_STRIDE)]);
      if (glyph?.[row][original % GLYPH_STRIDE] === '1') {
        // Input lines are in reading/playback order; each upright line enters
        // from the bottom and completes before the line above it starts.
        pixels[pixels.length - (index + 1) * ROWS_PER_PHRASE + 1 + row][offset + column] = 1;
      }
    }
  });
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const rowTicks = beats * TICKS_PER_BEAT / pixels.length;
  // A fixed high PPQ still drifts on, for example, seven lines. This bounded
  // LCM exactly represents quarter-beat totals for every 1–32-line document.
  const denominator = pixels.length * 4;
  const ticksPerBeat = Number.isInteger(rowTicks) ? TICKS_PER_BEAT : TICKS_PER_BEAT / gcd(TICKS_PER_BEAT, denominator) * denominator;
  const score = generateGridMidi(pixels, { title: `Text: ${text}`, lowestNote,
    secondsPerRow: beats / (pixels.length * 2), ticksPerBeat });
  return { ...score, text, lines, phrases: lines.map(line => line.text), rowsPerPhrase: ROWS_PER_PHRASE,
    pixels, unsupported, truncated, mode, layout: { mode, span, lowestNote, beats, fit, scale, align,
      capacity, lineCount: lines.length, glyphWidth: GLYPH_COLUMNS * pitchScale } };
}

export function midiIconPixels(icon) { return ICONS[icon]?.map(row => [...row].map(Number)) ?? null; }
