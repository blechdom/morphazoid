import {
  automatapoeiaNextRow, automatapoeiaTransformRow,
  sanitizeAutomatapoeiaFamily, sanitizeAutomatapoeiaBoundary, sanitizeAutomatapoeiaTransform,
} from '../cellular-automata/automatapoeia.js';
import { generateGridMidi } from './midiphoria-text-midi.js';

export const AUTOMATA_MIDI_DEFAULTS = Object.freeze({
  family: 'elementary', rule: 30, boundary: 'fixed', transform: 'none',
  seed: 1, density: 0, columns: 48, rows: 64, rowBeats: .25, lowestNote: 48,
  articulation: 'retrigger', velocity: 100,
});

function settingsFor(input) {
  const source = input && typeof input === 'object' ? input : {};
  const bounded = (key, low, high) => {
    const value = source[key] == null ? AUTOMATA_MIDI_DEFAULTS[key] : Number(source[key]);
    return Math.max(low, Math.min(high, Number.isFinite(value) ? value : AUTOMATA_MIDI_DEFAULTS[key]));
  };
  const family = sanitizeAutomatapoeiaFamily(source.family);
  const columns = Math.round(bounded('columns', 8, 128));
  return {
    family, rule: Math.round(bounded('rule', 0, family === 'totalistic-r2' ? 63 : 255)),
    boundary: sanitizeAutomatapoeiaBoundary(source.boundary),
    transform: sanitizeAutomatapoeiaTransform(source.transform),
    seed: Math.trunc(bounded('seed', 0, 0xffffffff)), density: bounded('density', 0, 1),
    columns, rows: Math.round(bounded('rows', 8, 128)),
    // The shared encoder uses 480 MIDI ticks per beat. Report its actual timing.
    rowBeats: Math.round(bounded('rowBeats', .125, 1) * 480) / 480,
    lowestNote: Math.round(bounded('lowestNote', 0, 128 - columns)),
    articulation: source.articulation === 'hold' ? 'hold' : 'retrigger',
    velocity: Math.round(bounded('velocity', 1, 127)),
  };
}

/** Exact Automatapoeia rows become chromatic MIDI, with the seed heard first.
 * No resampling, scale snapping, cell thinning, or extra notes are introduced.
 */
export function generateAutomataMidi(options = {}) {
  const settings = settingsFor(options);
  let seed = settings.seed;
  // Match the live instrument's centered cell / seeded Bernoulli initial row.
  let row = Array.from({ length: settings.columns }, (_, column) => {
    if (settings.density <= .001) return Number(column === Math.floor(settings.columns / 2));
    seed = (1664525 * seed + 1013904223) >>> 0;
    return Number(seed / 0x100000000 < settings.density);
  });
  const pixels = [row];
  for (let index = 1; index < settings.rows; index++) {
    row = automatapoeiaTransformRow(
      automatapoeiaNextRow(row, settings.rule, settings.boundary, settings.family),
      settings.transform, settings.boundary,
    );
    pixels.push(row);
  }
  if (!pixels.some(cells => cells.some(Boolean))) {
    const error = new Error('This rule and seed produce no MIDI notes. Change the seed, density, or rule.');
    // The picker can still display the exact empty result without a second CA engine.
    error.code = 'EMPTY_AUTOMATA_MIDI'; error.pixels = pixels; error.settings = settings;
    throw error;
  }
  const name = settings.family === 'totalistic-r2' ? 'Totalistic code' : 'Rule';
  const score = generateGridMidi(pixels.slice().reverse(), {
    title: `Automatapoeia · ${name} ${settings.rule}`,
    secondsPerRow: settings.rowBeats / 2, lowestNote: settings.lowestNote,
    retrigger: settings.articulation === 'retrigger', velocity: settings.velocity,
  });
  return { ...score, pixels, settings, durationBeats: settings.rows * settings.rowBeats };
}
