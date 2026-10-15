import { BARBER_DELAY_DEFAULTS, BARBER_DELAY_PRESETS, sanitizeBarberDelayParams } from './barber-delay.js';
import { presetStateKey } from '../../site/header-presets.js';
import { presetRandom, randomParameterValues } from '../../site/preset-random.js';

// Source, loop transport, device trim, output and delay memory belong to the session.
export const BARBER_PRESET_KEYS = Object.freeze(Object.fromEntries(['candy', 'sandy'].map(mode => [
  mode, Object.freeze(Object.keys(BARBER_DELAY_DEFAULTS[mode]).filter(key => !['inputGain', 'outputLevel'].includes(key))),
])));

export function captureBarberPreset(parameters, mode = 'candy', ratioLock = false) {
  const settings = sanitizeBarberDelayParams(parameters, mode);
  return {
    settings: Object.fromEntries(BARBER_PRESET_KEYS[mode].map(key => [key, settings[key]])),
    ...(mode === 'candy' ? { ratioLock: Boolean(ratioLock) } : {}),
  };
}

export function validateBarberPreset(snapshot, mode = 'candy') {
  if (!snapshot?.settings || presetStateKey(snapshot) !== presetStateKey(captureBarberPreset(snapshot.settings, mode, snapshot.ratioLock))) {
    throw new TypeError('Invalid complete barber delay preset');
  }
  return snapshot;
}

export const BARBER_FULL_PRESETS = Object.freeze(Object.fromEntries(['candy', 'sandy'].map(mode => [
  mode, Object.freeze(BARBER_DELAY_PRESETS[mode].map(preset => {
    const snapshot = captureBarberPreset(preset.settings, mode);
    Object.freeze(snapshot.settings);
    return Object.freeze({ id: preset.id, label: preset.label, snapshot: Object.freeze(snapshot) });
  })),
])));

export function randomizeBarberPreset(current, mode = 'candy', random = Math.random) {
  validateBarberPreset(current, mode);
  const rng = presetRandom(random);
  const settings = randomParameterValues({
    speed: [0.025, 2.5], tilt: [-0.85, 0.85], feedback: [0, 0.65],
    globalFeedback: [0, 0.18], dryWet: [0.35, 0.95],
    fbDelay: mode === 'sandy' ? [0.2, 12] : [0.02, 6],
    ...(mode === 'sandy' ? { pitchOctaves: [0.5, 8], grainSize: [0.008, 0.4], blend: [0, 1] } : { range: [0.15, 7] }),
  }, rng);
  settings.numVoices = rng.integer(1, 12);
  settings.directionUp = rng.unit() < 0.5;
  const ratioLock = mode === 'candy' && rng.unit() < 0.5;
  if (ratioLock) {
    settings.speed = rng.between(0.15, 2.5);
    settings.range = 1 / settings.speed;
  }
  return validateBarberPreset(captureBarberPreset(settings, mode, ratioLock), mode);
}
