import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { INVOLUTION_IDS } from "./crab-loom.js";

export const CRAB_LOOM_PRESET_KEYS = Object.freeze(["involution", "halfTwists", "seam", "headOffset", "hocket", "speed", "retain"]);
const RANGES = Object.freeze({ halfTwists: [0, 5], seam: [0, 0.999], headOffset: [0, 0.99], hocket: [0, 1], speed: [0.25, 2.5], retain: [0, 1] });
const DEFAULTS = Object.freeze({ involution: "retrograde", halfTwists: 1, seam: 0, headOffset: 0.5, hocket: 0, speed: 1, retain: 1 });

const clamp = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

export function captureCrabLoomPreset(raw) {
  return {
    involution: INVOLUTION_IDS.includes(raw?.involution) ? raw.involution : DEFAULTS.involution,
    halfTwists: Math.round(clamp(raw?.halfTwists, ...RANGES.halfTwists, DEFAULTS.halfTwists)),
    seam: clamp(raw?.seam, ...RANGES.seam, DEFAULTS.seam),
    headOffset: clamp(raw?.headOffset, ...RANGES.headOffset, DEFAULTS.headOffset),
    hocket: clamp(raw?.hocket, ...RANGES.hocket, DEFAULTS.hocket),
    speed: clamp(raw?.speed, ...RANGES.speed, DEFAULTS.speed),
    retain: clamp(raw?.retain, ...RANGES.retain, DEFAULTS.retain),
  };
}

export function validateCrabLoomPreset(snapshot) {
  if (!snapshot || presetStateKey(snapshot) !== presetStateKey(captureCrabLoomPreset(snapshot))) {
    throw new TypeError("Invalid complete Crab Loom preset");
  }
  return snapshot;
}

const scene = (id, label, values) => Object.freeze({
  id, label, snapshot: Object.freeze(captureCrabLoomPreset({ ...DEFAULTS, ...values })),
});

export const CRAB_LOOM_FULL_PRESETS = Object.freeze([
  scene("crab-canon", "Crab canon", {}),
  scene("mirror-lap", "Mirror lap", { involution: "inversion", seam: 0.25, headOffset: 0.4 }),
  scene("both-at-once", "Both at once", { involution: "table", halfTwists: 3, seam: 0.5, headOffset: 0.33, speed: 0.85 }),
  scene("lane-swap", "Lane swap", { involution: "lane", seam: 0.12, headOffset: 0.5, speed: 1.2 }),
  scene("phase-cancel", "Phase cancel", { involution: "polarity", halfTwists: 1, headOffset: 0.5, speed: 0.7 }),
  scene("stereo-flip", "Stereo flip", { involution: "stereo", seam: 0.75, headOffset: 0.25 }),
  scene("tritone-return", "Tritone return", { involution: "tritone", halfTwists: 1, seam: 0.4, speed: 1.1 }),
  scene("hocket-split", "Hocket split", { involution: "retrograde", hocket: 1, headOffset: 0.5, speed: 1.4 }),
  scene("plain-loop", "Plain loop", { halfTwists: 0, headOffset: 0.5, hocket: 0 }),
  scene("slow-tape", "Slow tape", { involution: "inversion", speed: 0.5, headOffset: 0.66, seam: 0.1 }),
  scene("close-canon", "Close canon", { involution: "retrograde", headOffset: 0.12, speed: 1, seam: 0.6 }),
  scene("five-twists", "Five twists", { involution: "table", halfTwists: 5, headOffset: 0.2, hocket: 0.4, speed: 1.6 }),
  scene("even-twist-hocket", "Even-twist hocket", { involution: "lane", halfTwists: 2, hocket: 0.65, headOffset: 0.75, speed: 0.9 }),
  scene("fading-band", "Fading band", { involution: "retrograde", halfTwists: 1, retain: 0.82, seam: 0.33, headOffset: 0.5, speed: 0.8 }),
]);

export function randomizeCrabLoomPreset(current, random = Math.random) {
  validateCrabLoomPreset(current);
  const rng = presetRandom(random);
  return validateCrabLoomPreset({
    involution: rng.pick(INVOLUTION_IDS),
    halfTwists: rng.integer(0, 5),
    seam: round(rng.between(0, 0.99), 3),
    headOffset: round(rng.between(0.05, 0.95)),
    hocket: rng.unit() < 0.4 ? 0 : round(rng.between(0.1, 1)),
    speed: round(0.4 * 5.5 ** rng.unit()),
    retain: rng.unit() < 0.5 ? 1 : round(rng.between(0.7, 1)),
  });
}
