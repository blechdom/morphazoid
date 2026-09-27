/** Discrete finger/toe phrases, driven by the same beat as choreography.
 * Phase is relative to the current note cell; -1 is a written rest. */
export const HAND_RHYTHMS = Object.freeze([
  { id: 'continuous', label: 'Continuous' },
  { id: 'walk', label: 'Walking notes' },
  { id: 'offbeat', label: 'Offbeat taps' },
  { id: 'three-four', label: 'Three against four' },
  { id: 'broken', label: 'Broken phrases' },
].map(Object.freeze));
const WALK = [1, 2, 4, 8, 16, 8, 4, 2, 1, 0];
const OFFBEAT = [1, 0, 2, 0, 4, 8, 0, 2, 16, 0, 4, 0, 1, 8, 0, 16];
const BROKEN = [1, 0, 4, 2, 0, 8, 0, 16, 1, 0, 6, 0, 16, 0, 8, 0];
const POLYRHYTHM = [1, 3, 4, 2, 1], OFFSETS = [0, 0, 0, .5, .5];
export function handRhythmPhase(id, beat, finger) {
  if (!Number.isFinite(beat) || !Number.isInteger(finger) || finger < 0 || finger > 4) return -1;
  beat = Math.max(0, beat);
  if (id === 'three-four') {
    const position = beat * POLYRHYTHM[finger] / 4 + OFFSETS[finger];
    return position - Math.floor(position);
  }
  const phrase = id === 'walk' ? WALK : id === 'offbeat' ? OFFBEAT : id === 'broken' ? BROKEN : null;
  if (!phrase) return -1;
  const position = beat * (id === 'walk' ? 2 : 4), cell = Math.floor(position);
  return phrase[cell % phrase.length] & (1 << finger) ? position - cell : -1;
}
