import { normalizeState } from './time-loom-model.js';

const cord = (start, end, stretch = 1, reverse = false, next = null) => ({ start, end, stretch, reverse, next });
const scene = (id, label, cords) => ({ id, label, snapshot: { cords } });
export const TIME_LOOM_PRESETS = [
  scene('whole-thread', 'Whole thread', [cord(0, 1), cord(.25, .5), cord(.5, .9)]),
  scene('conversation', 'A conversation', [cord(0, .3, 1, false, 1), cord(.3, .6, 1.4, false, 2), cord(.6, 1, .85, false, 0)]),
  scene('palindrome', 'Returning words', [cord(.1, .5, 1, false, 1), cord(.1, .5, 1, true, 0), cord(.6, .9, 2, true)]),
  scene('held-syllable', 'Held syllable', [cord(.23, .31, 4), cord(.51, .61, 3), cord(.77, .88, 2.5)]),
  scene('loose-weave', 'Loose weave', [cord(.05, .4, 1.8, false, 2), cord(.5, .85, 1.2, true, 0), cord(.3, .6, 2.3, false, 1)]),
  scene('quick-stitches', 'Quick stitches', [cord(.12, .22, .5, false, 1), cord(.43, .56, .6, false, 2), cord(.76, .9, .7, false, 0)]),
  scene('long-memory', 'Long memory', [cord(0, 1, 4), cord(.2, .8, 3), cord(.4, .9, 2)]),
  scene('upstream', 'Upstream', [cord(0, 1, 1, true, 2), cord(.1, .5, 1.2, true, 0), cord(.5, 1, .8, true, 1)]),
  scene('hesitation', 'Hesitation', [cord(.05, .16, 3, false, 1), cord(.24, .31, .5, true, 2), cord(.6, .92, 1, false, 0)]),
  scene('three-ages', 'Three ages', [cord(0, .33, .6, false, 1), cord(.33, .66, 1.6, false, 2), cord(.66, 1, 3.2, false, 0)]),
  scene('folded-ending', 'Folded ending', [cord(.65, .98, 1.7, true, 1), cord(.8, .98, 2.5, false, 0), cord(.2, .4, .75)]),
  scene('frayed-edge', 'Frayed edge', [cord(.18, .22, 3.5, false, 1), cord(.46, .51, 2.7, true, 2), cord(.83, .87, 4, false, 0)]),
];

export function validateTimeLoomPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.cords) || snapshot.cords.length !== 3) throw new TypeError('A weave needs three cords.');
  const clean = normalizeState(snapshot).cords;
  for (let i = 0; i < 3; i++) for (const key of ['start', 'end', 'stretch', 'reverse', 'next']) {
    if (clean[i][key] !== snapshot.cords[i][key]) throw new TypeError('Invalid cord in weave.');
  }
  return { cords: clean };
}

export function randomizeTimeLoomPreset(_current, random = Math.random) {
  const unit = () => { const n = Number(random()); return Number.isFinite(n) ? Math.max(0, Math.min(.999999, n)) : .5; };
  const round = value => Math.round(value * 1000) / 1000;
  return { cords: Array.from({ length: 3 }, (_, i) => {
    const start = round(unit() * .82);
    const end = round(start + .04 + unit() * (.96 - start));
    const next = unit() < .3 ? null : (i + 1 + Math.floor(unit() * 2)) % 3;
    return cord(start, end, round(.5 * 8 ** unit()), unit() < .5, next);
  }) };
}
