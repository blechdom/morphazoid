import { INSTRUMENT_BY_ID } from "./gesturama-core.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const GESTURAMA_MODES = Object.freeze(["drums", "pads", "harp"]);
export const GESTURAMA_DRUMS = Object.freeze(["kick", "snare", "hat", "clap"]);
export const GESTURAMA_CELLS = 12;
export const GESTURAMA_STRINGS = 12;
export const GESTURAMA_MAX_ZONES = 24;
const ZONE_TYPES = Object.freeze(["rect", "dot", "brush", "line"]);
const NOTE_NAMES = Object.freeze(["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]);

export const GESTURAMA_DEFAULT_GRID = Object.freeze([
  "kick", "snare", "hat", "clap", "hat", "clap", "kick", "snare", "clap", "hat", "snare", "kick",
]);
export const GESTURAMA_DEFAULT_HARP = Object.freeze(Array.from({ length: GESTURAMA_STRINGS }, (_, i) => 60 + i));
export const GESTURAMA_DEFAULT_PAD_SEMITONES = Object.freeze(Array.from({ length: GESTURAMA_CELLS }, (_, i) => i));

export const gesturamaNoteName = midi => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));
const point = p => ({ x: num(p?.x, 0, 1, .5), y: num(p?.y, 0, 1, .5) });

function captureZone(zone) {
  const type = ZONE_TYPES.includes(zone?.type) ? zone.type : "rect";
  const points = (Array.isArray(zone?.points) ? zone.points : []).slice(0, 400).map(point);
  const clean = {
    type, instrument: INSTRUMENT_BY_ID.has(zone?.instrument) ? zone.instrument : "kick",
    points: points.length ? points : [{ x: .5, y: .5 }], size: num(zone?.size, 0, 1, .04),
  };
  if (type === "rect" || type === "line") clean.points = [clean.points[0], clean.points[1] ?? clean.points[0]];
  if (type === "dot") { clean.points = [clean.points[0]]; clean.radius = num(zone?.radius, .015, .32, .03); }
  return clean;
}

export function captureGesturamaPreset(source) {
  return {
    mode: GESTURAMA_MODES.includes(source.mode) ? source.mode : "drums",
    sensitivity: Math.round(num(source.sensitivity, 0, 100, 64)),
    grid: Array.from({ length: GESTURAMA_CELLS }, (_, i) => (GESTURAMA_DRUMS.includes(source.grid?.[i]) ? source.grid[i] : GESTURAMA_DEFAULT_GRID[i])),
    harp: Array.from({ length: GESTURAMA_STRINGS }, (_, i) => Math.round(num(source.harp?.[i], 24, 108, GESTURAMA_DEFAULT_HARP[i]))),
    padSemitones: Array.from({ length: GESTURAMA_CELLS }, (_, i) => Math.round(num(source.padSemitones?.[i], 0, 48, i))),
    zones: (Array.isArray(source.zones) ? source.zones : []).slice(0, GESTURAMA_MAX_ZONES).map(captureZone),
  };
}

export function validateGesturamaPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureGesturamaPreset(snapshot))) {
    throw new TypeError("Invalid complete Gesturama preset");
  }
  return snapshot;
}

const rect = (instrument, x0, y0, x1, y1) => ({ type: "rect", instrument, points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], size: .04 });
const dot = (instrument, x, y, radius = .08) => ({ type: "dot", instrument, points: [{ x, y }], size: .04, radius });
const scaleNotes = (root, intervals, count = GESTURAMA_STRINGS) => Array.from({ length: count }, (_, i) => root + 12 * Math.floor(i / intervals.length) + intervals[i % intervals.length]);
const padScale = intervals => scaleNotes(0, intervals, GESTURAMA_CELLS);

const SCALES = Object.freeze({
  pentatonic: [0, 2, 4, 7, 9], minorPentatonic: [0, 3, 5, 7, 10], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], wholeTone: [0, 2, 4, 6, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], blues: [0, 3, 5, 6, 7, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
});

const scene = (id, label, parts) => Object.freeze({ id, label, snapshot: Object.freeze(captureGesturamaPreset({
  mode: "drums", sensitivity: 64, grid: GESTURAMA_DEFAULT_GRID, harp: GESTURAMA_DEFAULT_HARP, padSemitones: GESTURAMA_DEFAULT_PAD_SEMITONES, zones: [], ...parts,
})) });

const STARTER = [rect("kick", .08, .15, .45, .45), rect("snare", .55, .15, .92, .45), rect("hat", .08, .56, .45, .86), rect("clap", .55, .56, .92, .86)];

export const GESTURAMA_FULL_PRESETS = Object.freeze([
  scene("drum-grid", "Drum grid", {}),
  scene("four-on-floor", "Four on the floor", { grid: ["kick", "hat", "kick", "hat", "snare", "hat", "snare", "clap", "kick", "hat", "kick", "clap"], sensitivity: 58 }),
  scene("hat-storm", "Hat storm", { grid: ["hat", "hat", "snare", "hat", "hat", "clap", "hat", "hat", "kick", "hat", "hat", "snare"], sensitivity: 82 }),
  scene("low-thunder", "Low thunder", { grid: ["kick", "kick", "snare", "kick", "kick", "snare", "clap", "kick", "kick", "clap", "kick", "snare"], sensitivity: 40 }),
  scene("starter-kit", "Starter kit zones", { zones: STARTER }),
  scene("corner-dots", "Corner drums", { grid: ["hat", "hat", "hat", "hat", "hat", "clap", "clap", "hat", "hat", "hat", "hat", "hat"], zones: [dot("kick", .15, .2), dot("snare", .85, .2), dot("clap", .15, .8), dot("kick", .85, .8, .1)], sensitivity: 70 }),
  scene("resonant-pads", "Resonant pads", { mode: "pads" }),
  scene("pentatonic-pads", "Pentatonic pads", { mode: "pads", padSemitones: padScale(SCALES.pentatonic), sensitivity: 50 }),
  scene("minor-low-pads", "Low minor pads", { mode: "pads", padSemitones: padScale(SCALES.minor), sensitivity: 45 }),
  scene("whole-tone-pads", "Whole-tone pads", { mode: "pads", padSemitones: padScale(SCALES.wholeTone), sensitivity: 60 }),
  scene("video-harp", "Video harp", { mode: "harp" }),
  scene("harp-pentatonic", "Pentatonic harp", { mode: "harp", harp: scaleNotes(60, SCALES.pentatonic) }),
  scene("harp-minor", "Minor harp", { mode: "harp", harp: scaleNotes(57, SCALES.minor), sensitivity: 55 }),
  scene("harp-dorian-high", "Bright dorian harp", { mode: "harp", harp: scaleNotes(69, SCALES.dorian), sensitivity: 75 }),
  scene("harp-phrygian-deep", "Deep phrygian harp", { mode: "harp", harp: scaleNotes(40, SCALES.phrygian), sensitivity: 50 }),
]);

export function randomizeGesturamaPreset(current, random = Math.random) {
  validateGesturamaPreset(current);
  const rng = presetRandom(random);
  const scale = () => rng.pick(Object.values(SCALES));
  const harpRoot = rng.integer(36, 72), harpScale = scale(), padScaleIntervals = scale();
  const palette = GESTURAMA_DRUMS;
  const grid = Array.from({ length: GESTURAMA_CELLS }, () => rng.pick(palette));
  if (new Set(grid).size < 2) grid[rng.integer(0, GESTURAMA_CELLS - 1)] = rng.pick(palette.filter(id => id !== grid[0]));
  const zones = Array.from({ length: rng.integer(0, 6) }, () => {
    const instrument = rng.pick(palette);
    if (rng.unit() < .5) return dot(instrument, rng.between(.1, .9), rng.between(.1, .9), rng.between(.04, .14));
    const x = rng.between(.04, .6), y = rng.between(.04, .6);
    return rect(instrument, x, y, x + rng.between(.12, .36), y + rng.between(.12, .34));
  });
  return validateGesturamaPreset(captureGesturamaPreset({
    mode: rng.pick(GESTURAMA_MODES), sensitivity: rng.integer(25, 95), grid,
    harp: scaleNotes(harpRoot, harpScale), padSemitones: scaleNotes(rng.integer(0, 5), padScaleIntervals, GESTURAMA_CELLS), zones,
  }));
}
