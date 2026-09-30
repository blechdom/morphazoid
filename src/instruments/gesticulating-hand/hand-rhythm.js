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
const clock = (rate, offset = 0) => Object.freeze({ rate, offset });
const EMPTY_CLOCKS = Object.freeze([]), WALK_CLOCKS = Object.freeze([clock(2)]), FAST_CLOCKS = Object.freeze([clock(4)]);
const POLY_CLOCKS = Object.freeze(POLYRHYTHM.map((rate, finger) => clock(rate / 4, OFFSETS[finger])));
/** Distinct note-cell clocks for display sampling, including cells written as rests. */
export function handRhythmClocks(id) {
  return id === 'three-four' ? POLY_CLOCKS : id === 'walk' ? WALK_CLOCKS
    : id === 'offbeat' || id === 'broken' ? FAST_CLOCKS : EMPTY_CLOCKS;
}
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

/** Timing of the audible voices over one complete phrase, in beats. Used only
 * when rolling a scene, never on the audio thread. Include the wraparound rest. */
export function handRhythmTiming(id, noteLength, mask = 31) {
  if (id === 'continuous') return { shortestNote: Infinity, longestRest: 0 };
  const phrase = id === 'walk' ? WALK : id === 'offbeat' ? OFFBEAT : id === 'broken' ? BROKEN : null;
  const period = id === 'walk' ? 5 : 4, windows = [];
  let shortestNote = Infinity;
  if (phrase) {
    const rate = id === 'walk' ? 2 : 4;
    for (let cell = 0; cell < phrase.length; cell++) if (phrase[cell] & mask) {
      windows.push([cell / rate, (cell + noteLength) / rate]);
      shortestNote = noteLength / rate;
    }
  } else if (id === 'three-four') {
    for (let finger = 0; finger < 5; finger++) if (mask & (1 << finger)) {
      const rate = POLYRHYTHM[finger] / 4, duration = noteLength / rate;
      shortestNote = Math.min(shortestNote, duration);
      for (let note = 0; note <= POLYRHYTHM[finger]; note++) {
        const start = (note - OFFSETS[finger]) / rate, end = start + duration;
        if (end > 0 && start < period) windows.push([Math.max(0, start), Math.min(period, end)]);
      }
    }
  }
  if (!windows.length) return { shortestNote: 0, longestRest: Infinity };
  windows.sort((a, b) => a[0] - b[0]);
  let end = windows[0][1], longestRest = 0;
  for (const [start, stop] of windows) {
    longestRest = Math.max(longestRest, start - end);
    end = Math.max(end, stop);
  }
  return { shortestNote, longestRest: Math.max(longestRest, period - end + windows[0][0]) };
}
