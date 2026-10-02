import { MIN_TEMPO, MAX_TEMPO } from './puggler.js';

// Momentary actions on the current BPM, not a second clock or a latched ratio.
// Disable an action if it cannot make the requested reduction within the range.
export function reducedTempo(tempo, divisor) {
  if (!Number.isFinite(tempo) || tempo < MIN_TEMPO || tempo > MAX_TEMPO
    || ![2, 4].includes(divisor) || tempo / divisor < MIN_TEMPO) return null;
  return Math.round(tempo / divisor * 100) / 100;
}

// The stage is an ensemble gesture. Names only change membership, never identity.
export const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyG']);
export function drivingControls(keys, targets, activeIds) {
  const steer = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * .7;
  return [0, 1, 2].map(owner => activeIds.includes(owner)
    ? { steer, height: 0, target: steer ? null : targets[owner] ?? null }
    : { steer: 0, height: 0, target: null });
}
