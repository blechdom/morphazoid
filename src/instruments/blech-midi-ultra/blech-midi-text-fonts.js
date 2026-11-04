import { generateGridMidi, generateLaidOutTextMidi, textMidiGlyphRows } from '../midiphoria/midiphoria-text-midi.js';

// One lit cell is one pitch for one time row. These seven-by-seven segment
// letters are drawn for the MIDI grid, not downsampled from the title font.
const DIGITAL_GLYPHS = Object.freeze({
  A: ['0111110', '1000001', '1000001', '1111111', '1000001', '1000001', '1000001'],
  B: ['1111100', '1000010', '1000010', '1111100', '1000010', '1000010', '1111100'],
  C: ['0111110', '1000001', '1000000', '1000000', '1000000', '1000001', '0111110'],
  D: ['1111100', '1000010', '1000001', '1000001', '1000001', '1000010', '1111100'],
  E: ['1111111', '1000000', '1000000', '1111110', '1000000', '1000000', '1111111'],
  F: ['1111111', '1000000', '1000000', '1111110', '1000000', '1000000', '1000000'],
  G: ['0111110', '1000001', '1000000', '1001111', '1000001', '1000001', '0111110'],
  H: ['1000001', '1000001', '1000001', '1111111', '1000001', '1000001', '1000001'],
  I: ['1111111', '0001000', '0001000', '0001000', '0001000', '0001000', '1111111'],
  J: ['0001111', '0000010', '0000010', '0000010', '1000010', '1000010', '0111100'],
  K: ['1000001', '1000010', '1000100', '1111000', '1000100', '1000010', '1000001'],
  L: ['1000000', '1000000', '1000000', '1000000', '1000000', '1000000', '1111111'],
  M: ['1000001', '1100011', '1010101', '1001001', '1000001', '1000001', '1000001'],
  N: ['1000001', '1100001', '1010001', '1001001', '1000101', '1000011', '1000001'],
  O: ['0111110', '1000001', '1000001', '1000001', '1000001', '1000001', '0111110'],
  P: ['1111110', '1000001', '1000001', '1111110', '1000000', '1000000', '1000000'],
  Q: ['0111110', '1000001', '1000001', '1000001', '1001001', '1000101', '0111111'],
  R: ['1111110', '1000001', '1000001', '1111110', '1000100', '1000010', '1000001'],
  S: ['0111111', '1000000', '1000000', '0111110', '0000001', '0000001', '1111110'],
  T: ['1111111', '0001000', '0001000', '0001000', '0001000', '0001000', '0001000'],
  U: ['1000001', '1000001', '1000001', '1000001', '1000001', '1000001', '0111110'],
  V: ['1000001', '1000001', '1000001', '1000001', '1000001', '0100010', '0011100'],
  W: ['1000001', '1000001', '1000001', '1001001', '1010101', '1100011', '1000001'],
  X: ['1000001', '0100010', '0010100', '0001000', '0010100', '0100010', '1000001'],
  Y: ['1000001', '0100010', '0010100', '0001000', '0001000', '0001000', '0001000'],
  Z: ['1111111', '0000001', '0000010', '0001100', '0010000', '0100000', '1111111'],
  0: ['0111110', '1000011', '1000101', '1001001', '1010001', '1100001', '0111110'],
  1: ['0001000', '0011000', '0101000', '0001000', '0001000', '0001000', '0111110'],
  2: ['0111110', '1000001', '0000001', '0001110', '0110000', '1000000', '1111111'],
  3: ['1111110', '0000001', '0000001', '0011110', '0000001', '0000001', '1111110'],
  4: ['1000010', '1000010', '1000010', '1111111', '0000010', '0000010', '0000010'],
  5: ['1111111', '1000000', '1000000', '1111110', '0000001', '0000001', '1111110'],
  6: ['0111110', '1000000', '1000000', '1111110', '1000001', '1000001', '0111110'],
  7: ['1111111', '0000001', '0000010', '0000100', '0001000', '0010000', '0010000'],
  8: ['0111110', '1000001', '1000001', '0111110', '1000001', '1000001', '0111110'],
  9: ['0111110', '1000001', '1000001', '0111111', '0000001', '0000010', '0111100'],
  '.': ['0000000', '0000000', '0000000', '0000000', '0000000', '0011000', '0011000'],
  ',': ['0000000', '0000000', '0000000', '0000000', '0011000', '0011000', '0110000'],
  '!': ['0011000', '0011000', '0011000', '0011000', '0011000', '0000000', '0011000'],
  '?': ['0111110', '1000001', '0000001', '0001110', '0001000', '0000000', '0001000'],
  ':': ['0000000', '0011000', '0011000', '0000000', '0011000', '0011000', '0000000'],
  '-': ['0000000', '0000000', '0000000', '1111111', '0000000', '0000000', '0000000'],
});

export const digitalNoteGlyph = character => DIGITAL_GLYPHS[character?.toUpperCase()] ?? null;

export const ULTRA_TEXT_FONTS = Object.freeze([
  Object.freeze({ id: 'digital', label: 'Digital · 7×7' }),
  Object.freeze({ id: 'pixel', label: 'Arcade · 5×7' }),
  Object.freeze({ id: 'square', label: 'Square · 7×7' }),
  Object.freeze({ id: 'chunky', label: 'Chunky · 7×7' }),
]);
const LEGACY_FONTS = Object.freeze({ block: 'pixel', slant: 'chunky', wide: 'square' });
export const ultraTextFontId = font => ULTRA_TEXT_FONTS.some(choice => choice.id === font)
  ? font : LEGACY_FONTS[font] ?? 'digital';
export const ultraTextGlyphColumns = font => ultraTextFontId(font) === 'pixel' ? 5 : 7;

/** Simple square-stroke variations of the original 5×7 bitmap. Nothing is
 * resampled from a browser font, so a one-note-wide stem never vanishes. */
export function ultraNoteGlyph(character, face = 'digital') {
  const font = ultraTextFontId(face);
  if (font === 'digital' && digitalNoteGlyph(character)) return digitalNoteGlyph(character);
  const rows = textMidiGlyphRows(character?.toUpperCase());
  if (!rows) return null;
  if (font === 'pixel') return rows;
  if (font === 'chunky') return rows.map(row => [
    row[0], Number(row[0] === '1' || row[1] === '1'), row[1], row[2], row[3],
    Number(row[3] === '1' || row[4] === '1'), row[4],
  ].join(''));
  // Square repeats the interior columns; both outside edges stay crisp.
  return rows.map(row => `${row[0]}${row[1]}${row[1]}${row[2]}${row[3]}${row[3]}${row[4]}`);
}

/** Keep one full note per glyph cell. "Fit" chooses an integer enlargement,
 * never the fractional sampling that can erase a letter's thin strokes. The
 * shared generator still owns normalization, wrapping, bounds and timing. */
export function generateUltraTextMidi(input, options = {}) {
  const font = ultraTextFontId(options.font);
  const fit = options.fit !== false;
  const glyphWidth = ultraTextGlyphColumns(font), stride = glyphWidth + 1;
  const source = generateLaidOutTextMidi(input, { ...options, font: glyphWidth === 5 ? 'block' : 'wide',
    fit: false, scale: fit ? 1 : options.scale });
  const { span, align, lowestNote } = source.layout;
  const width = text => [...text].length * stride - 1;
  const longest = Math.max(1, ...source.lines.map(line => width(line.text)));
  const scale = fit ? Math.max(1, Math.min(4, Math.floor(span / longest))) : source.layout.scale;
  const layout = { ...source.layout, font, fit, scale, glyphWidth: glyphWidth * scale,
    capacity: Math.min(source.layout.capacity, Math.max(1, Math.floor((span + scale) / (stride * scale)))) };

  const pixels = Array.from({ length: source.pixels.length }, () => Array(span).fill(0));
  source.lines.forEach((line, lineIndex) => {
    const characters = [...line.text], nativeWidth = width(line.text);
    if (nativeWidth <= 0) return;
    const outputWidth = nativeWidth * scale;
    const outputX = align === 'left' ? 0 : align === 'right' ? span - outputWidth : Math.floor((span - outputWidth) / 2);
    const glyphs = characters.map(character => ultraNoteGlyph(character, font));
    for (let row = 0; row < 7; row++) {
      const y = pixels.length - (lineIndex + 1) * 8 + 1 + row;
      for (let column = 0; column < nativeWidth; column++) {
        if (glyphs[Math.floor(column / stride)]?.[row][column % stride] === '1')
          for (let offset = 0; offset < scale; offset++)
          pixels[y][outputX + column * scale + offset] = 1;
      }
    }
  });
  const score = generateGridMidi(pixels, { title: `Text: ${source.text}`, lowestNote,
    secondsPerRow: source.secondsPerRow, ticksPerBeat: source.ticksPerBeat });
  return { ...source, ...score, text: source.text, pixels, layout };
}
