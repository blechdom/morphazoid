import { MidiDrawing } from '../midiphoria/midiphoria-drawing.js';
import { generateGridMidi, generateTextMidi } from '../midiphoria/midiphoria-text-midi.js';

export const MIXER_SAMPLE_STAMPS = Object.freeze([
  { id: 'heart', label: 'Heart', group: 'Shapes', glyph: '❤' }, { id: 'square', label: 'Square', group: 'Shapes' },
  { id: 'star', label: 'Star', group: 'Shapes', glyph: '⭐' }, { id: 'smile', label: 'Smile', group: 'Shapes', glyph: '🙂' },
  { id: 'diamond', label: 'Diamond', group: 'Shapes', glyph: '◆' }, { id: 'wave', label: 'Wave', group: 'Shapes', glyph: 'wave' },
  { id: 'zigzag', label: 'Zigzag', group: 'Geometry' }, { id: 'polka-dots', label: 'Polka dots', group: 'Geometry' },
  { id: 'plaid', label: 'Plaid', group: 'Geometry' }, { id: 'stripes', label: 'Stripes', group: 'Geometry' },
  { id: 'chevrons', label: 'Chevrons', group: 'Geometry' }, { id: 'checker', label: 'Checker', group: 'Geometry' },
  { id: 'ladder', label: 'Ladder', group: 'Geometry' }, { id: 'staircase', label: 'Staircase', group: 'Geometry' },
  { id: 'rings', label: 'Rings', group: 'Geometry' }, { id: 'spiral', label: 'Spiral', group: 'Geometry' },
  { id: 'braid', label: 'Braid', group: 'Geometry' }, { id: 'lattice', label: 'Lattice', group: 'Geometry' },
  { id: 'mesh', label: 'Mesh', group: 'Geometry' }, { id: 'pulse', label: 'Pulse', group: 'Geometry' },
  { id: 'drips', label: 'Drips', group: 'Organic' }, { id: 'glob', label: 'Glob', group: 'Organic' },
  { id: 'glooob', label: 'Glooob', group: 'Organic' }, { id: 'cloud', label: 'Cloud', group: 'Organic' },
  { id: 'rain', label: 'Rain', group: 'Particles' }, { id: 'comet', label: 'Comet', group: 'Particles' },
  { id: 'noise', label: 'Noise', group: 'Particles' }, { id: 'scatter', label: 'Scatter', group: 'Particles' },
  { id: 'explode', label: 'Explode', group: 'Particles' }, { id: 'sparks', label: 'Sparks', group: 'Particles' },
].map(Object.freeze));

export const MIXER_PATTERN_DEFAULTS = Object.freeze({ seed: 1, density: .5, span: 48, beats: 8, transpose: 0 });
const FIXED_SEED_PATTERNS = new Set(['polka-dots', 'plaid', 'checker', 'ladder', 'staircase', 'rings']);
const bounded = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
function patternOptions(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const span = Math.round(bounded(source.span, 12, 48, 48)), center = Math.round(72 - span / 2);
  const transpose = Math.round(bounded(source.transpose, -36, 36, 0));
  return { seed: Math.trunc(bounded(source.seed, 0, 0xffffffff, 1)), density: bounded(source.density, 0, 1, .5), span,
    beats: Math.round(bounded(source.beats, 4, 32, 8)),
    transpose: Math.max(0, Math.min(128 - span, center + transpose)) - center };
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

/** A bounded, upright pitch/time raster. Every filled cell becomes sounding MIDI. */
function patternPixels(id, density, seed) {
  const pixels = Array.from({ length: 32 }, () => Array(48).fill(0));
  const random = seededRandom(seed), thickness = .45 + density * 1.5;
  const spacing = Math.round(11 - density * 5), phase = seed === 1 ? 0 : random() * Math.PI * 2;
  const mask = predicate => { for (let y = 1; y < 31; y++) for (let x = 1; x < 47; x++) if (predicate(x, y)) pixels[y][x] = 1; };
  const dot = (x, y, radius = .6) => {
    for (let row = Math.max(0, Math.floor(y - radius)); row <= Math.min(31, Math.ceil(y + radius)); row++) {
      for (let col = Math.max(0, Math.floor(x - radius)); col <= Math.min(47, Math.ceil(x + radius)); col++) {
        if ((row - y) ** 2 + (col - x) ** 2 <= radius * radius) pixels[row][col] = 1;
      }
    }
  };
  const line = (x1, y1, x2, y2, radius = thickness * .6) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let step = 0; step <= steps; step++) dot(x1 + (x2 - x1) * step / steps, y1 + (y2 - y1) * step / steps, Math.max(.75, radius));
  };
  const repeatDistance = (value, period) => Math.abs(((value % period) + period) % period - period / 2);
  const triangle = value => 1 - 4 * Math.abs(Math.round(value) - value);
  switch (id) {
    case 'zigzag': {
      for (let y = 1; y < 30; y++) line(23.5 + 19 * triangle(y / 13 + phase), y, 23.5 + 19 * triangle((y + 1) / 13 + phase), y + 1);
      break;
    }
    case 'polka-dots': mask((x, y) => Math.hypot(repeatDistance(x + (Math.floor(y / spacing) % 2) * spacing / 2, spacing), repeatDistance(y, spacing)) < .8 + density * 2); break;
    case 'plaid': mask((x, y) => repeatDistance(x, 13) < thickness || repeatDistance(y, 9) < thickness || (x % 13 < 2 && y % 9 < 2)); break;
    case 'stripes': mask((x, y) => repeatDistance(x + y * .7 + phase, spacing) < thickness); break;
    case 'chevrons': mask((x, y) => repeatDistance(y - Math.abs(x - 23.5) * .6 + phase, spacing) < thickness); break;
    case 'checker': mask((x, y) => (Math.floor(x / 6) + Math.floor(y / 5)) % 2 === 0 && x % 6 < 2 + 3 * density && y % 5 < 2 + 2 * density); break;
    case 'ladder': mask((x, y) => Math.abs(x - 12) < thickness || Math.abs(x - 35) < thickness || (x > 12 && x < 35 && repeatDistance(y, spacing) < thickness)); break;
    case 'staircase': mask((x, y) => Math.abs(y - (27 - Math.floor(x / 6) * 3)) < thickness || (x % 6 < thickness && Math.abs(y - (28 - Math.floor(x / 6) * 3)) < 3)); break;
    case 'rings': mask((x, y) => repeatDistance(Math.hypot(x - 23.5, (y - 15.5) * 1.2), 7) < thickness && Math.hypot(x - 23.5, y - 15.5) < 15); break;
    case 'spiral': {
      let previous = [23.5, 15.5];
      for (let step = 1; step <= 220; step++) { const angle = step / 220 * Math.PI * 5 + phase, radius = step / 220 * 14;
        const next = [23.5 + Math.cos(angle) * radius, 15.5 + Math.sin(angle) * radius]; line(...previous, ...next); previous = next; }
      break;
    }
    case 'braid': {
      for (const offset of [0, 2.1, 4.2]) for (let y = 1; y < 30; y++) {
        line(23.5 + Math.sin(y / 5 + phase + offset) * 17, y, 23.5 + Math.sin((y + 1) / 5 + phase + offset) * 17, y + 1);
      }
      break;
    }
    case 'lattice': mask((x, y) => repeatDistance(x + y + phase, 13) < thickness || repeatDistance(x - y + phase, 13) < thickness); break;
    case 'mesh': mask((x, y) => repeatDistance(x + Math.sin(y / 4 + phase) * 3, 8) < thickness * .6 || repeatDistance(y + Math.sin(x / 6) * 3, 8) < thickness * .6); break;
    case 'pulse': mask((x, y) => Math.abs(y - 16 - Math.sin(x / 6 + phase) * Math.exp(-(((x - 23.5) / 15) ** 2)) * 12) < thickness); break;
    case 'drips': {
      for (let n = 0; n < 4 + Math.round(density * 7); n++) { const x = 3 + random() * 41, end = 10 + random() * 18;
        line(x, 2, x, end, thickness * .45); dot(x, end, 1 + density * 2); }
      break;
    }
    case 'glob': case 'glooob': {
      const stretched = id === 'glooob', size = 6 + density * 8;
      mask((x, y) => { const dx = (x - 23.5) / (stretched ? 1.8 : 1), dy = (y - 15.5) / (stretched ? .62 : 1);
        const angle = Math.atan2(dy, dx), radius = size * (1 + .17 * Math.sin(angle * 5 + phase) + .1 * Math.cos(angle * 3 - phase));
        return Math.hypot(dx, dy) < radius; });
      break;
    }
    case 'cloud': {
      for (let n = 0; n < 4 + Math.round(density * 6); n++) dot(13 + random() * 23, 10 + random() * 12, 2 + density * 3 + random() * 2);
      break;
    }
    case 'rain': {
      for (let n = 0; n < 10 + Math.round(density * 38); n++) { const x = 3 + random() * 40, y = 1 + random() * 24; line(x, y, x - 2, y + 2 + random() * 4, .75); }
      break;
    }
    case 'comet': {
      dot(36, 9, 2 + density * 3);
      for (let n = 0; n < 6 + Math.round(density * 17); n++) { const tail = random(); dot(35 - tail * 31, 10 + tail * 17 + (random() - .5) * tail * 9, .75 + density); }
      break;
    }
    case 'noise': mask(() => random() < .015 + density * .45); break;
    case 'scatter': {
      for (let n = 0; n < 8 + Math.round(density * 36); n++) dot(2 + random() * 43, 2 + random() * 27, .8 + random() * density * 1.8);
      break;
    }
    case 'explode': {
      for (let n = 0, count = 7 + Math.round(density * 17); n < count; n++) { const angle = n / count * Math.PI * 2 + phase, radius = 9 + random() * 7;
        line(23.5 + Math.cos(angle) * 3, 15.5 + Math.sin(angle) * 3, 23.5 + Math.cos(angle) * radius * 1.4, 15.5 + Math.sin(angle) * radius, .75 + density * .4); }
      break;
    }
    case 'sparks': {
      for (let n = 0; n < 3 + Math.round(density * 7); n++) { const x = 4 + random() * 39, y = 4 + random() * 23, size = 1 + random() * 3;
        line(x - size, y, x + size, y, .75); line(x, y - size, x, y + size, .75); }
      break;
    }
  }
  return pixels;
}

/** Raw trails carry earlier notes upward, so emit each picture's top row first.
 * The Draw editor's stationary score/playhead still uses its original direction.
 * Text phrases stay in reading order and retain their final silent row.
 */
export function mixerPerformanceScore(score, { trimLeading = false, secondsPerRow: rowTime, lowestNote: baseNote } = {}) {
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
  return { ...score, ...generateGridMidi(pixels, { title: score.text, secondsPerRow: rowTime ?? secondsPerRow, lowestNote: baseNote ?? lowestNote }),
    pixels: pixels.map(row => row.slice()).reverse() };
}

export function mixerStampScore(id, options) {
  const stamp = MIXER_SAMPLE_STAMPS.find(item => item.id === id);
  if (!stamp) throw new Error('Choose a sample from the bank.');
  const normalized = patternOptions(options);
  let pixels;
  if (id === 'square') {
    pixels = Array.from({ length: 32 }, (_, y) => Array.from({ length: 48 }, (_, x) =>
      Number(x >= 13 && x <= 34 && y >= 5 && y <= 26 && (x < 15 || x > 32 || y < 7 || y > 24))));
  } else if (stamp.glyph) {
    const drawing = new MidiDrawing(); drawing.stamp(stamp.glyph); pixels = drawing.pixels.map(row => Array.from(row));
  } else pixels = patternPixels(id, normalized.density, normalized.seed);
  // Preserve the original six shapes exactly at the default density. At the
  // extremes, sparse pixels or thicker strokes audibly change their score too.
  if (stamp.glyph || id === 'square') {
    if (normalized.density < .5) {
      const random = seededRandom(normalized.seed);
      pixels = pixels.map(row => row.map(value => Number(value && random() < .25 + normalized.density * 1.5)));
    } else if (normalized.density > .5) {
      const before = pixels, radius = Math.ceil((normalized.density - .5) * 4);
      pixels = before.map((row, y) => row.map((_value, x) => {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius && before[y + dy]?.[x + dx]) return 1;
        }
        return 0;
      }));
    }
  }
  pixels = pixels.map(row => Array.from({ length: normalized.span }, (_, column) => row[Math.min(47, Math.floor((column + .5) * 48 / normalized.span))]));
  // Even sparse/low-resolution combinations remain playable and recoverable.
  if (!pixels.some(row => row.some(Boolean))) pixels[15][Math.floor(normalized.span / 2)] = 1;
  const lowestNote = Math.round(72 - normalized.span / 2) + normalized.transpose;
  const score = generateGridMidi(pixels, { title: stamp.label, secondsPerRow: normalized.beats / 64, lowestNote });
  return { ...mixerPerformanceScore(score, { trimLeading: true }), patternOptions: normalized, group: stamp.group };
}

/** Skip visually identical adjacent seeds without trapping a usable Variation
 * control. Fixed grids and literal icons avoid generating unnecessary scores.
 */
export function nextMixerStampVariation(id, options) {
  const stamp = MIXER_SAMPLE_STAMPS.find(item => item.id === id);
  if (!stamp) throw new Error('Choose a sample from the bank.');
  const normalized = patternOptions(options);
  if (FIXED_SEED_PATTERNS.has(id) || ((stamp.glyph || id === 'square') && normalized.density >= .5)) return null;
  const previous = mixerStampScore(id, normalized);
  for (let offset = 1; offset <= 16; offset++) {
    const next = mixerStampScore(id, { ...normalized, seed: (normalized.seed + offset) >>> 0 });
    if (next.pixels.some((row, y) => row.some((value, x) => value !== previous.pixels[y][x]))) return next;
  }
  return null;
}

export function mixerMessageScore(input, { mode = 'word' } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Type a message or a symbol first.');
  const score = generateTextMidi(input, { mode });
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
