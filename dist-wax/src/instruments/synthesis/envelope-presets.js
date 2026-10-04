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
];

export const ENVELOPE_PRESETS = deepFreeze(definitions.map(([
  id, label, description, attack, decay, sustain, release,
]) => ({ id, label, description, envelope: { attack, decay, sustain, release } })));

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
    Object.keys(ENVELOPE_LIMITS).every(stage => preset.envelope[stage] === envelope[stage])) || null;
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
  return sanitizeEnvelope({
    attack: .002 * 900 ** unit(rng),
    decay: .04 * 100 ** unit(rng),
    sustain: unit(rng),
    release: .04 * 100 ** unit(rng),
  });
}
