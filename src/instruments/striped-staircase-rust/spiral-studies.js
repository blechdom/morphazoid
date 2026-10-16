// These focused choices alter only the contour mappings. Camera, transport,
// register, base pitch mapping and output level remain the performer's state.
export const SPIRAL_DEFAULTS = Object.freeze({
  turnAmount: 0, turnSpan: 1, accentAmount: 0, accentRate: 4,
  forkAmount: 0, forkSpan: 2, curvatureAmount: 0, curvatureDrive: 1,
  endlessAmount: 0, endlessDirection: -1,
});
export const SPIRAL_AMOUNTS = Object.freeze(['turnAmount', 'accentAmount', 'forkAmount', 'curvatureAmount', 'endlessAmount']);
export const SPIRAL_RANGES = Object.freeze({
  turnAmount: [0, 1], turnSpan: [0, 3], accentAmount: [0, 1], accentRate: [1, 32],
  forkAmount: [0, 1], forkSpan: [0, 4], curvatureAmount: [0, 1], curvatureDrive: [0, 4],
  endlessAmount: [0, 1],
});
export const SPIRAL_STUDIES = Object.freeze([
  { id: 'original', label: 'Original edges', amounts: [0, 0, 0, 0, 0], description: 'The existing boundary pitches, without added spiral mappings. Use this as your reference.' },
  { id: 'turning', label: '1 · Turning pitch', amounts: [1, 0, 0, 0, 0], description: 'Measured boundary turning sets the pitch. Faster turning makes a faster glide. Lower the amount to blend in the original pitch reference.' },
  { id: 'accents', label: '2 · Turn accents', amounts: [0, 1, 0, 0, 0], description: 'Accents and marker pulses follow the turns along each path. The voice stays sustained between accents; optional stripe gating adds rests.' },
  { id: 'forks', label: '3 · Branching pitch', amounts: [0, 0, 1, 0, 0], description: 'Tracked offshoots inherit their parent’s pitch, then separate as their contours diverge. Lower the amount to blend in the original pitch reference.' },
  { id: 'curvature', label: '4 · Curvature color', amounts: [0, 0, 0, 1, 0], description: 'Tighter measured bends bring out brighter harmonics. Broad curves keep a rounder sound.' },
  { id: 'endless', label: '5 · Endless descent', amounts: [0, 0, 0, 0, 1], description: 'Octave layers fade through one another as the path turns. An illusion of endless motion, following stripe rests when the gate is enabled.' },
  { id: 'braid', label: 'Turning + forks + accents', amounts: [.7, .5, .7, 0, 0], description: 'Turning pitch and branching voices, with softer accents following the same contour motion.' },
]);

export function normalizeSpiralStudies(source = {}) {
  const result = {};
  for (const [key, [minimum, maximum]] of Object.entries(SPIRAL_RANGES)) {
    const value = Number(source[key]);
    result[key] = Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : SPIRAL_DEFAULTS[key];
  }
  result.endlessDirection = Number(source.endlessDirection) === 1 ? 1 : -1;
  return result;
}

export function spiralStudyPatch(id) {
  const study = SPIRAL_STUDIES.find(study => study.id === id);
  return study ? Object.fromEntries(SPIRAL_AMOUNTS.map((key, index) => [key, study.amounts[index]])) : null;
}

export function selectedSpiralStudy(state) {
  return SPIRAL_STUDIES.find(study => SPIRAL_AMOUNTS.every((key, index) => Math.abs(state[key] - study.amounts[index]) < .00001))?.id ?? 'custom';
}

export function formatSpiralControl(key, value) {
  if (SPIRAL_AMOUNTS.includes(key)) return value ? `${Math.round(value * 100)}%` : 'Off';
  if (key === 'turnSpan') return `${value.toFixed(1)} oct / turn`;
  if (key === 'accentRate') return `${value.toFixed(1)} / turn`;
  if (key === 'forkSpan') return `${value.toFixed(1)} oct`;
  return `${value.toFixed(1)}×`;
}
