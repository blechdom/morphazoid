import { DEFAULT_VISUALS } from './midiphoria-model.js';

export const MIDIPHORIA_VIEWS = Object.freeze(['trails', 'mirror', 'radial', 'ribbons', 'orbit']);
export const MIDIPHORIA_PALETTES = Object.freeze(['pitch', 'candy', 'ember', 'ice', 'acid']);
export const MIDIPHORIA_COLOR_SOURCES = Object.freeze(['pitch', 'channel', 'velocity']);
export const MIDIPHORIA_REFLECTIONS = Object.freeze([
  'none', 'vertical', 'horizontal', 'both', 'diagonal', 'anti-diagonal', 'diagonals', 'all',
]);
export const MIDIPHORIA_FLOWS = Object.freeze(['classic', 'outward', 'inward']);
export const MIDIPHORIA_MODEL_KEYS = Object.freeze([
  'attack', 'decay', 'sustain', 'release', 'velocity', 'color', 'invert', 'hueMode', 'hueSpeed',
]);
export const DEFAULT_RENDER_OPTIONS = Object.freeze({
  view: 'trails', trailSeconds: 7, palette: 'pitch', hueOffset: 0,
  saturation: 1, glow: 0.2, width: 1, motion: 1,
  colorSource: 'pitch', fadeCurve: 1, spin: 0, symmetry: 1,
  reflection: 'none', flow: 'classic',
});
export const MIDIPHORIA_RENDER_KEYS = Object.freeze(Object.keys(DEFAULT_RENDER_OPTIONS));
const MODEL_BOUNDS = Object.freeze({ attack: [0, 3], decay: [0, 3], sustain: [0, 1],
  release: [0, 5], hueSpeed: [0, 1] });
const RENDER_BOUNDS = Object.freeze({ trailSeconds: [0.3, 12], hueOffset: [0, 360],
  saturation: [0, 1], glow: [0, 1], width: [0.3, 3], motion: [0, 2],
  fadeCurve: [0.25, 4], spin: [-2, 2], symmetry: [1, 8] });
const HUE_MODES = ['static', 'rotate', 'activity'];
const finite = value => (typeof value === 'number' || typeof value === 'string')
  && value !== '' && Number.isFinite(Number(value));
const bounded = (value, [min, max], fallback) => finite(value)
  ? Math.max(min, Math.min(max, Number(value))) : fallback;

/** Only visual fields enter a snapshot. MIDI routing, audio and transport are external. */
export function normalizeMidiphoriaRenderOptions(partial, previous = DEFAULT_RENDER_OPTIONS) {
  const source = partial && typeof partial === 'object' ? partial : {};
  const result = {};
  for (const [key, bounds] of Object.entries(RENDER_BOUNDS)) {
    const fallback = bounded(previous?.[key], bounds, DEFAULT_RENDER_OPTIONS[key]);
    result[key] = bounded(source[key], bounds, fallback);
  }
  result.symmetry = Math.round(result.symmetry);
  for (const [key, choices] of [['view', MIDIPHORIA_VIEWS], ['palette', MIDIPHORIA_PALETTES],
    ['colorSource', MIDIPHORIA_COLOR_SOURCES], ['reflection', MIDIPHORIA_REFLECTIONS],
    ['flow', MIDIPHORIA_FLOWS]]) {
    result[key] = choices.includes(source[key]) ? source[key]
      : choices.includes(previous?.[key]) ? previous[key] : DEFAULT_RENDER_OPTIONS[key];
  }
  // Stable key ordering keeps captured factory presets byte-for-byte comparable.
  return Object.fromEntries(MIDIPHORIA_RENDER_KEYS.map(key => [key, result[key]]));
}

export function captureMidiphoriaPreset(modelOptions = DEFAULT_VISUALS, renderOptions = DEFAULT_RENDER_OPTIONS) {
  const source = modelOptions && typeof modelOptions === 'object' ? modelOptions : {};
  const model = {};
  for (const key of MIDIPHORIA_MODEL_KEYS) {
    if (MODEL_BOUNDS[key]) model[key] = bounded(source[key], MODEL_BOUNDS[key], DEFAULT_VISUALS[key]);
    else if (key === 'hueMode') model[key] = HUE_MODES.includes(source[key]) ? source[key] : DEFAULT_VISUALS[key];
    else model[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_VISUALS[key];
  }
  return { version: 1, model, render: normalizeMidiphoriaRenderOptions(renderOptions) };
}

export function sanitizeMidiphoriaPreset(snapshot) {
  return captureMidiphoriaPreset(snapshot?.model, snapshot?.render);
}

export function isValidMidiphoriaPreset(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.model || !snapshot.render) return false;
  const sanitized = sanitizeMidiphoriaPreset(snapshot);
  return MIDIPHORIA_MODEL_KEYS.every(key => snapshot.model[key] === sanitized.model[key])
    && MIDIPHORIA_RENDER_KEYS.every(key => snapshot.render[key] === sanitized.render[key]
      // Version 1 snapshots made before travel/reflection keep their original picture.
      || ((key === 'reflection' || key === 'flow') && !Object.hasOwn(snapshot.render, key)));
}

export function applyMidiphoriaPreset(model, renderer, snapshot, now) {
  if (!isValidMidiphoriaPreset(snapshot)) throw new TypeError('Invalid Midiphoria visual preset.');
  const next = sanitizeMidiphoriaPreset(snapshot);
  const previous = captureMidiphoriaPreset(model.options, renderer.options);
  try {
    model.configure(next.model, now);
    renderer.configure(next.render);
  } catch (error) {
    model.configure(previous.model, now);
    renderer.configure(previous.render);
    throw error;
  }
  return captureMidiphoriaPreset(model.options, renderer.options);
}

/** Bounded full-state variation; does not depend on or mutate the current scene. */
export function randomizeMidiphoriaPreset(_current, random = Math.random) {
  const unit = () => {
    const value = random();
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  };
  const choice = values => values[Math.min(values.length - 1, Math.floor(unit() * values.length))];
  const range = (min, max, exponent = 1) => Number((min + (max - min) * unit() ** exponent).toFixed(4));
  return captureMidiphoriaPreset({
    attack: range(0, 3, 2), decay: range(0, 3, 2), sustain: range(0, 1), release: range(0, 5, 1.5),
    velocity: unit() >= 0.3, color: unit() >= 0.15, invert: unit() >= 0.8,
    hueMode: choice(HUE_MODES), hueSpeed: range(0, 1, 2),
  }, {
    view: choice(MIDIPHORIA_VIEWS), trailSeconds: range(0.3, 12), palette: choice(MIDIPHORIA_PALETTES),
    hueOffset: range(0, 360), saturation: range(0, 1), glow: range(0, 1),
    width: range(0.3, 3), motion: range(0, 2),
    colorSource: choice(MIDIPHORIA_COLOR_SOURCES), fadeCurve: range(0.25, 4),
    spin: range(-2, 2), symmetry: choice([1, 2, 3, 4, 5, 6, 7, 8]),
    reflection: choice(MIDIPHORIA_REFLECTIONS), flow: choice(MIDIPHORIA_FLOWS),
  });
}

function preset(id, label, description, model, render) {
  const snapshot = captureMidiphoriaPreset({ ...DEFAULT_VISUALS, ...model }, { ...DEFAULT_RENDER_OPTIONS, ...render });
  Object.freeze(snapshot.model); Object.freeze(snapshot.render); Object.freeze(snapshot);
  return Object.freeze({ id, label, description, snapshot });
}

export const MIDIPHORIA_PRESETS = Object.freeze([
  preset('pitch-rain', 'Pitch rain', 'The whole keyboard in luminous falling note trails.', {}, {}),
  preset('candy-mirror', 'Candy mirror', 'Pink and cyan notes unfold from the center across both axes.',
    { hueMode: 'rotate', hueSpeed: 0.045, release: 0.8 },
    { view: 'mirror', palette: 'candy', trailSeconds: 5.5, glow: 0.15, width: 0.5, motion: 0.7, colorSource: 'channel', fadeCurve: 0.7, reflection: 'both', flow: 'outward' }),
  preset('solar-wheel', 'Solar wheel', 'Fine warm spokes radiate outward in one spinning wheel.',
    { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.6, hueMode: 'activity', hueSpeed: 0.18 },
    { view: 'radial', palette: 'ember', trailSeconds: 3.8, width: 0.7, glow: 0.2, motion: 0.65, spin: 0.5, fadeCurve: 1.4, flow: 'outward' }),
  preset('aurora-ribbons', 'Aurora ribbons', 'Slow icy ribbons draw inward from the edge.',
    { attack: 0.3, decay: 0.6, sustain: 0.9, release: 2.2, hueMode: 'rotate', hueSpeed: 0.025 },
    { view: 'ribbons', palette: 'ice', trailSeconds: 10, width: 2, glow: 0.45, motion: 0.7, saturation: 0.75, colorSource: 'channel', fadeCurve: 0.5, flow: 'inward' }),
  preset('acid-orbits', 'Acid orbits', 'Green comets trace single spirals toward the center.',
    { attack: 0.01, decay: 0.25, sustain: 0.8, release: 0.5, hueMode: 'activity', hueSpeed: 0.4 },
    { view: 'orbit', palette: 'acid', trailSeconds: 4.8, width: 1.2, glow: 0.7, motion: 1.5, colorSource: 'velocity', spin: -1.2, fadeCurve: 1.6, flow: 'inward' }),
  preset('chromatic-field', 'Chromatic threads', 'Fine pitch-colored threads hold the full chord across the score.',
    { velocity: false, attack: 0.01, decay: 0.1, sustain: 1, release: 0.4 },
    { view: 'trails', trailSeconds: 3.2, width: 0.6, glow: 0.05, motion: 0, fadeCurve: 1.8 }),
  preset('ember-falls', 'Ember falls', 'Long orange trails fan out from the center.',
    { attack: 0.04, decay: 0.4, sustain: 0.75, release: 1.3 },
    { view: 'trails', palette: 'ember', trailSeconds: 9, width: 2.4, glow: 0.7, motion: 0.3, colorSource: 'velocity', fadeCurve: 0.6, flow: 'outward' }),
  preset('ice-blueprint', 'Ice blueprint', 'Fine blue geometry converges through both diagonal mirrors.',
    { attack: 0, decay: 0.05, sustain: 0.9, release: 0.15 },
    { view: 'mirror', palette: 'ice', trailSeconds: 4, width: 0.5, glow: 0.05, motion: 0, saturation: 0.8, colorSource: 'channel', fadeCurve: 2, reflection: 'diagonals', flow: 'inward' }),
  preset('disco-prism', 'Disco prism', 'Fine spinning spokes expand through every mirror axis.',
    { attack: 0, decay: 0.1, sustain: 0.65, release: 0.2, velocity: false, hueMode: 'rotate', hueSpeed: 0.22 },
    { view: 'radial', trailSeconds: 2.4, width: 0.65, glow: 0.15, motion: 1.8, hueOffset: 35, symmetry: 6, spin: 1.5, fadeCurve: 1.8, reflection: 'all', flow: 'outward' }),
  preset('pink-tape', 'Pink tape', 'Wide candy ribbons fan outward across the score.',
    { attack: 0.12, decay: 0.35, sustain: 0.85, release: 1.2, hueMode: 'activity', hueSpeed: 0.12 },
    { view: 'ribbons', palette: 'candy', trailSeconds: 7.5, width: 2.6, glow: 0.25, motion: 1.2, hueOffset: 20, colorSource: 'channel', fadeCurve: 0.8, flow: 'outward' }),
  preset('deep-space', 'Deep space', 'Cool thin spirals leave a slowly expanding constellation.',
    { attack: 0.4, decay: 0.6, sustain: 0.75, release: 3.2, hueMode: 'rotate', hueSpeed: 0.015 },
    { view: 'orbit', palette: 'ice', trailSeconds: 12, width: 0.7, glow: 0.3, motion: 0.35, saturation: 0.65, spin: -0.35, fadeCurve: 0.45, flow: 'outward' }),
  preset('paper-ink', 'Paper ink', 'Monochrome traces approach the center from the edge.',
    { color: false, invert: true, velocity: true, attack: 0, decay: 0.1, sustain: 1, release: 0.3 },
    { view: 'trails', trailSeconds: 5, width: 1.5, glow: 0, motion: 0, saturation: 0, fadeCurve: 2.5, flow: 'inward' }),
  preset('silver-kaleidoscope', 'Silver kaleidoscope', 'Fine silver geometry opens from the center through all mirror axes.',
    { color: false, velocity: false, attack: 0.08, decay: 0.3, sustain: 0.8, release: 1.4 },
    { view: 'mirror', trailSeconds: 8, width: 0.4, glow: 0.08, motion: 1.4, saturation: 0, fadeCurve: 0.65, reflection: 'all', flow: 'outward' }),
  preset('liquid-candy', 'Liquid candy', 'Pastel ribbons drift inward with a slowly breathing envelope.',
    { attack: 0.6, decay: 0.8, sustain: 0.85, release: 2.5, hueMode: 'rotate', hueSpeed: 0.055 },
    { view: 'ribbons', palette: 'candy', trailSeconds: 11, width: 1.1, saturation: 0.55, hueOffset: 15, motion: 0.25, glow: 0.15, colorSource: 'velocity', fadeCurve: 0.6, flow: 'inward' }),
  preset('black-midi-scope', 'Black MIDI scope', 'Short sharp lines keep dense experimental MIDI legible.',
    { attack: 0, decay: 0.04, sustain: 0.8, release: 0.1, velocity: false },
    { view: 'trails', palette: 'acid', trailSeconds: 1.2, width: 0.45, glow: 0, motion: 0, colorSource: 'channel', fadeCurve: 3.2, flow: 'classic' }),
  preset('negative-sun', 'Negative sun', 'Warm spokes collapse toward the center on a pale field.',
    { invert: true, attack: 0.03, decay: 0.25, sustain: 0.9, release: 0.65, hueMode: 'activity', hueSpeed: 0.2 },
    { view: 'radial', palette: 'ember', trailSeconds: 5.2, width: 1.1, glow: 0.15, motion: 0.9, hueOffset: 10, spin: -0.8, fadeCurve: 1.2, flow: 'inward' }),
]);
