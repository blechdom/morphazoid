import { envelopeFromBreakpoints, sanitizeEnvelopePoints } from './envelope-shape.js';

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const ENVELOPE_LIMITS = deepFreeze({
  attack: { min: .001, max: 12 },
  decay: { min: .002, max: 12 },
  sustain: { min: 0, max: 1 },
  release: { min: .003, max: 16 },
});

// This is the existing editor fallback, retained so adding a preset selector
// does not silently change the initial Synthesaurus envelope.
export const DEFAULT_ENVELOPE = deepFreeze({ attack: .018, decay: .22, sustain: .8, release: .35 });
export const DEFAULT_ENVELOPE_PRESET_ID = 'organ';

const definitions = [
  ['pluck', 'Pluck', 'Immediate attack, short decay and no held level.', .003, .46, 0, .24],
  ['percussion', 'Percussion', 'A compact impact with a dry, fast tail.', .002, .14, 0, .09],
  ['organ', 'Organ', 'Direct sustained tone with a gentle key release.', .018, .22, .8, .35],
  ['brass', 'Brass', 'A breath-sized onset settling into a strong held tone.', .045, .32, .78, .28],
  ['strings', 'Strings', 'A bowed onset with a smooth body and lingering release.', .12, .48, .74, .75],
  ['pad', 'Pad', 'Slow opening and a broad release for layered harmony.', 1.4, 1.1, .82, 2.7],
  ['swell', 'Swell', 'A pronounced rise that eases into a softer sustain.', .75, .9, .64, 1.6],
  ['drone', 'Drone', 'Very slow edges and a nearly continuous held level.', 2.4, 3.2, .92, 5.5],
  ['pinprick', 'Pinprick', 'A very short, dry transient.', .001, .024, 0, .015],
  ['muted-pluck', 'Muted pluck', 'A quick onset and tightly damped tail.', .002, .09, .02, .055],
  ['woodblock', 'Woodblock', 'A hard onset with a short body.', .001, .065, 0, .04],
  ['bell', 'Bell tail', 'Immediate onset followed by a long decay.', .003, 2.1, 0, 1.4],
  ['glass', 'Glass ping', 'A light strike with a trailing release.', .004, .7, .04, 1.1],
  ['piano', 'Piano-like fall', 'Fast onset, falling body, low held level.', .006, 1.2, .18, .28],
  ['clavinet', 'Clavinet bite', 'A short bright body and dry key-off.', .002, .2, .15, .05],
  ['bass', 'Bass contour', 'A fast rise, brief fall and solid held body.', .007, .16, .55, .14],
  ['reed', 'Reed breath', 'A gradual onset with firm sustain.', .08, .18, .88, .2],
  ['soft-key', 'Soft key', 'A softened onset and short release.', .055, .25, .68, .22],
  ['reverse', 'Reverse rise', 'A rising envelope with an abrupt ending.', .65, .035, 0, .02],
  ['bloom', 'Long bloom', 'A slow opening and spacious release.', 3.6, 1.8, .76, 6.2],
  ['held-gate', 'Held gate', 'A nearly rectangular held articulation with safe edges.', .003, .002, 1, .025],
  ['staccato', 'Staccato', 'A crisp body and very short release.', .004, .075, .3, .035],
  ['breathy-pad', 'Breathy pad', 'A soft entrance with a low held level.', .55, .65, .38, 1.8],
  ['slow-fade', 'Slow fade', 'Immediate tone fading toward silence.', .012, 6.5, 0, 3.5],
];

const shapedDefinitions = [
  ['double-bloom', 'Double bloom', [[0,0],[.015,1],[.12,.2],[.42,.85],[.85,0]]],
  ['dip-and-hold', 'Dip and hold', [[0,0],[.025,.9],[.14,.15],[.28,.6],[.5,0]]],
  ['falling-shelf', 'Falling shelf', [[0,0],[.008,1],[.08,.7],[.65,.25],[1.1,0]]],
  ['delayed-breath', 'Delayed breath', [[.06,0],[.28,.65],[.48,.85],[.8,.5],[1.6,0]]],
  ['two-step-rise', 'Two-step rise', [[0,0],[.08,.35],[.22,.45],[.7,1],[1.7,0]]],
  ['release-bloom', 'Release bloom', [[0,0],[.03,.8],[.15,.4],[.32,.3],[.62,.8]]],
  ['soft-peak', 'Soft peak', [[0,0],[.12,.45],[.32,.25],[.65,.35],[1.25,0]]],
  ['breath-pulse', 'Breath pulse', [[.025,.18],[.08,.85],[.18,.4],[.36,.65],[.65,0]]],
];
export const ENVELOPE_PRESETS = deepFreeze([...definitions.map(([
  id, label, description, attack, decay, sustain, release,
]) => ({ id, label, description, envelope: { attack, decay, sustain, release } })),
...shapedDefinitions.map(([id, label, values]) => ({ id, label,
  description: 'Independent amplitude points; S holds until note-off, then R releases to silence.',
  envelope: envelopeFromBreakpoints(values.map(([time, level]) => ({ time, level }))),
}))]);

const PRESET_BY_ID = new Map(ENVELOPE_PRESETS.map(preset => [preset.id, preset]));
const DEFAULT_PRESET = PRESET_BY_ID.get(DEFAULT_ENVELOPE_PRESET_ID) || ENVELOPE_PRESETS[0];

const finite = (value, fallback) => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() && value.length < 80
      ? Number(value)
      : NaN;
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, { min, max }, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));

export function sanitizeEnvelope(value = {}, fallback = DEFAULT_ENVELOPE) {
  const input = value && typeof value === 'object' ? value : {};
  const fallbackInput = fallback?.envelope && typeof fallback.envelope === 'object'
    ? fallback.envelope
    : fallback && typeof fallback === 'object'
      ? fallback
      : DEFAULT_ENVELOPE;
  const envelope = {};
  for (const [stage, limits] of Object.entries(ENVELOPE_LIMITS)) {
    const safeFallback = clamp(fallbackInput[stage], limits, DEFAULT_ENVELOPE[stage]);
    envelope[stage] = clamp(input[stage], limits, safeFallback);
  }
  const points = sanitizeEnvelopePoints(input.points);
  if (points) return deepFreeze(envelopeFromBreakpoints(points));
  return deepFreeze(envelope);
}

export function getEnvelopePreset(id) {
  return PRESET_BY_ID.get(typeof id === 'string' ? id : id?.id) || DEFAULT_PRESET;
}

export function envelopeFromPreset(id) {
  return getEnvelopePreset(id).envelope;
}

export function matchEnvelopePreset(value) {
  const envelope = sanitizeEnvelope(value);
  return ENVELOPE_PRESETS.find(preset =>
    Object.keys(ENVELOPE_LIMITS).every(stage => preset.envelope[stage] === envelope[stage])
      && JSON.stringify(preset.envelope.points ?? null) === JSON.stringify(envelope.points ?? null)) || null;
}

export function nextEnvelopePreset(current, direction = 1) {
  const id = typeof current === 'string' ? current : current?.id;
  const index = ENVELOPE_PRESETS.findIndex(preset => preset.id === id);
  const step = direction < 0 ? -1 : 1;
  const start = index < 0 ? (step > 0 ? -1 : 0) : index;
  return ENVELOPE_PRESETS[(start + step + ENVELOPE_PRESETS.length) % ENVELOPE_PRESETS.length];
}

const unit = rng => {
  const value = Number(rng());
  return Number.isFinite(value) ? Math.max(0, Math.min(.999999999, value)) : 0;
};

export function randomEnvelopePreset(rng = Math.random, { excludeId = null } = {}) {
  const choices = ENVELOPE_PRESETS.filter(preset => preset.id !== excludeId);
  return choices[Math.floor(unit(rng) * choices.length)] || DEFAULT_PRESET;
}

// Match the catalogue's useful random ADSR ranges rather than spanning the
// editor's extreme twelve- and sixteen-second limits on every roll.
export function randomizeEnvelope(rng = Math.random) {
  const start = .04 * unit(rng) ** 3, attack = start + .004 * 45 ** unit(rng);
  const decay = attack + .025 * 24 ** unit(rng), sustain = decay + .03 * 16 ** unit(rng);
  return sanitizeEnvelope({ points: [
    { time: start, level: .12 * unit(rng) },
    { time: attack, level: .65 + .35 * unit(rng) },
    { time: decay, level: .1 + .8 * unit(rng) },
    { time: sustain, level: .15 + .75 * unit(rng) },
    { time: sustain + .025 * 80 ** unit(rng), level: .15 * unit(rng) ** 3 },
  ] });
}
