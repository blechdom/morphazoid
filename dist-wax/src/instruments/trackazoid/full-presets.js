import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const DECK_KEYS = Object.freeze(["gain", "eqLow", "eqMid", "eqHigh", "filter", "keyLock", "quantize"]);
export const TRACKAZOID_DECK_KEYS = DECK_KEYS;
const RANGES = Object.freeze({
  gain: [0, 1, 0.01, 0.8], eqLow: [-24, 12, 0.5, 0], eqMid: [-24, 12, 0.5, 0], eqHigh: [-24, 12, 0.5, 0], filter: [-1, 1, 0.01, 0],
});
const onGrid = (value, [min, max, step, fallback]) => {
  if (!Number.isFinite(value)) return fallback;
  const snapped = Math.round(Math.min(max, Math.max(min, value)) / step) * step;
  return Number(snapped.toFixed(2));
};

const captureDeck = deck => ({
  gain: onGrid(deck?.gain, RANGES.gain), eqLow: onGrid(deck?.eqLow, RANGES.eqLow), eqMid: onGrid(deck?.eqMid, RANGES.eqMid),
  eqHigh: onGrid(deck?.eqHigh, RANGES.eqHigh), filter: onGrid(deck?.filter, RANGES.filter),
  keyLock: typeof deck?.keyLock === "boolean" ? deck.keyLock : true, quantize: typeof deck?.quantize === "boolean" ? deck.quantize : true,
});

/** Mixer scene only: tracks, tempo, loops, Sync, cue monitoring and output level belong to the session. */
export function captureTrackazoidPreset(source) {
  return { crossfader: onGrid(source?.crossfader, [-1, 1, 0.01, 0]), decks: [captureDeck(source?.decks?.[0]), captureDeck(source?.decks?.[1])] };
}

export function validateTrackazoidPreset(snapshot) {
  if (!Array.isArray(snapshot?.decks) || snapshot.decks.length !== 2
    || presetStateKey(snapshot) !== presetStateKey(captureTrackazoidPreset(snapshot))) {
    throw new TypeError("Invalid complete Trackazoid mixer preset");
  }
  return snapshot;
}

const flat = { gain: 0.8, eqLow: 0, eqMid: 0, eqHigh: 0, filter: 0, keyLock: true, quantize: true };
const scene = (id, label, crossfader, a, b = a) => {
  const snapshot = captureTrackazoidPreset({ crossfader, decks: [{ ...flat, ...a }, { ...flat, ...b }] });
  validateTrackazoidPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const TRACKAZOID_FULL_PRESETS = Object.freeze([
  scene("neutral-mix", "Neutral mix", 0, {}),
  scene("club-bass-swap", "Club bass swap", -0.35, { eqLow: 3, eqHigh: -2 }, { eqLow: -24, eqMid: 1, eqHigh: 2, gain: 0.74 }),
  scene("b-takeover", "B takes over", 0.82, { gain: 0.7, eqLow: -10, eqHigh: -6, filter: -0.35 }, { gain: 0.9, eqLow: 2 }),
  scene("filter-sweep-intro", "Filter sweep intro", -1, { gain: 0.85, filter: -0.75, eqLow: 4 }, { gain: 0.6, filter: 0.5 }),
  scene("telephone-eq", "Telephone EQ", 0, { eqLow: -24, eqMid: 6, eqHigh: -14, gain: 0.9 }),
  scene("kill-the-mids", "Kill the mids", 0.1, { eqMid: -24, eqLow: 5, eqHigh: 4 }, { eqMid: -18, eqLow: 3, eqHigh: 5, gain: 0.7 }),
  scene("warm-vinyl", "Warm vinyl", -0.1, { eqHigh: -9, eqMid: 3, eqLow: 2, gain: 0.78 }),
  scene("turntablist", "Turntablist · Pitch follows tempo", 0, { keyLock: false, quantize: false, gain: 0.86 }, { keyLock: false, quantize: false, gain: 0.86, eqHigh: 2 }),
  scene("hi-hat-focus", "Hi-hat focus", 0.2, { eqLow: -14, eqHigh: 8, filter: 0.3 }, { eqLow: -12, eqHigh: 6, gain: 0.65 }),
  scene("dub-low-pass", "Dub low-pass", -0.2, { filter: -0.7, eqLow: 6, gain: 0.82 }, { filter: -0.5, eqLow: 3, gain: 0.5 }),
  scene("build-high-pass", "Build high-pass", 0, { filter: 0.55, eqLow: -6, gain: 0.9 }, { filter: 0.4, eqHigh: 4, gain: 0.9 }),
  scene("double-drop", "Double drop", 0, { gain: 1, eqLow: 6, eqMid: 2, eqHigh: 3 }, { gain: 1, eqLow: -8, eqMid: 2, eqHigh: 5 }),
]);

export function randomizeTrackazoidPreset(current, random = Math.random) {
  validateTrackazoidPreset(current);
  const rng = presetRandom(random);
  const deck = () => ({
    gain: rng.between(0.45, 1), eqLow: rng.between(-24, 8), eqMid: rng.between(-20, 8), eqHigh: rng.between(-20, 8),
    filter: rng.unit() < 0.45 ? 0 + rng.between(-0.05, 0.05) : rng.between(-0.95, 0.95),
    keyLock: rng.unit() < 0.75, quantize: rng.unit() < 0.75,
  });
  return validateTrackazoidPreset(captureTrackazoidPreset({ crossfader: rng.between(-1, 1), decks: [deck(), deck()] }));
}
