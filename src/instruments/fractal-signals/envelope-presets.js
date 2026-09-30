import { percussionEnvelopePreset, percussionEnvelopeTimeMs } from '../../audio.js';

const ADSR_KEYS = ['attack', 'decay', 'sustain', 'release'];

/** Adapt Shapes' five-point timed curves to this instrument's gate-based ADSR.
 * Shapes allows its decay and sustain nodes to have different levels and times;
 * this adapter takes the sustain node's level and keeps the model's event gate.
 */
export const ENVELOPE_PRESETS = Object.freeze(['pluck', 'note', 'sustain', 'pad'].map(id => {
  const points = percussionEnvelopePreset(id);
  const seconds = points.map(point => percussionEnvelopeTimeMs(point.x) / 1000);
  return Object.freeze({
    id,
    label: id,
    snapshot: Object.freeze({
      attack: seconds[1],
      decay: seconds[2] - seconds[1],
      sustain: points[3].y,
      release: seconds[4] - seconds[3],
    }),
  });
}));

/** Identify the active envelope alone, independently of the full instrument scene. */
export function envelopePresetId(state) {
  if (!state || typeof state !== 'object') return null;
  return ENVELOPE_PRESETS.find(({ snapshot }) => ADSR_KEYS.every(key =>
    Number.isFinite(state[key]) && Math.abs(state[key] - snapshot[key]) <= 1e-9,
  ))?.id ?? null;
}
