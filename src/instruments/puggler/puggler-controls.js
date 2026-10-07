// The stage is an ensemble gesture. Names only change membership, never identity.
export const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyG']);
export function drivingControls(keys, targets, activeIds) {
  const steer = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * .7;
  return [0, 1, 2].map(owner => activeIds.includes(owner)
    ? { steer, height: 0, target: steer ? null : targets[owner] ?? null }
    : { steer: 0, height: 0, target: null });
}
