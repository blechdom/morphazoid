import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const HEAD_SHED_MAX_HEADS = 8;
export const HEAD_SHED_HEAD_KINDS = Object.freeze(["play", "record", "erase"]);
const RANGES = Object.freeze({ speed: [0.25, 2.5], retain: [0, 1], genLoss: [0, 1], pos01: [0, 0.999], level: [0, 1], pan: [-1, 1] });
const DEFAULTS = Object.freeze({ speed: 1, retain: 1, genLoss: 0.12, rotorOnly: false });

const clamp = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

export function captureHeadShedPreset(raw) {
  const list = Array.isArray(raw?.heads) ? raw.heads.slice(0, HEAD_SHED_MAX_HEADS) : [];
  return {
    speed: clamp(raw?.speed, ...RANGES.speed, DEFAULTS.speed),
    retain: clamp(raw?.retain, ...RANGES.retain, DEFAULTS.retain),
    genLoss: clamp(raw?.genLoss, ...RANGES.genLoss, DEFAULTS.genLoss),
    rotorOnly: raw?.rotorOnly === true,
    heads: list.map(head => ({
      kind: HEAD_SHED_HEAD_KINDS.includes(head?.kind) ? head.kind : "play",
      pos01: clamp(head?.pos01, ...RANGES.pos01, 0),
      level: clamp(head?.level, ...RANGES.level, 0.8),
      pan: clamp(head?.pan, ...RANGES.pan, 0),
    })),
  };
}

export function validateHeadShedPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.heads) || !snapshot.heads.length || snapshot.heads.length > HEAD_SHED_MAX_HEADS
    || presetStateKey(snapshot) !== presetStateKey(captureHeadShedPreset(snapshot))) {
    throw new TypeError("Invalid complete Head Shed preset");
  }
  return snapshot;
}

const play = (pos01, level = 0.8, pan = 0) => ({ kind: "play", pos01, level, pan });
const record = (pos01, level = 1, pan = 0) => ({ kind: "record", pos01, level, pan });
const spread = (count, level = 0.8, offset = 0) => Array.from({ length: count }, (_, i) => play(round((offset + i / count) % 1, 3), level, round(Math.sin(2 * Math.PI * (offset + i / count)), 2)));

const scene = (id, label, { heads, ...values }) => Object.freeze({
  id, label, snapshot: Object.freeze(captureHeadShedPreset({ ...DEFAULTS, ...values, heads })),
});

export const HEAD_SHED_FULL_PRESETS = Object.freeze([
  scene("three-heads", "Three heads", { heads: [play(0, 0.9, -0.3), play(0.37, 0.7, 0.3), record(0.72, 1, 0)] }),
  scene("tape-echo", "Tape echo", {
    heads: [play(0, 0.9), play(0.25, 0.6, -0.4), play(0.5, 0.4, 0.4), play(0.75, 0.25), record(0.9, 0.8)], retain: 0.8, genLoss: 0.2,
  }),
  scene("slapback", "Slapback", { heads: [play(0, 0.9, -0.2), play(0.06, 0.7, 0.2), record(0.5, 0.8)], speed: 1.25, genLoss: 0.05 }),
  scene("rotor-walk", "Rotor walk", { heads: spread(4, 0.85), rotorOnly: true, speed: 1 }),
  scene("octave-drone", "Octave drone", { heads: [play(0, 0.9, -0.5), play(0.5, 0.8, 0.5)], speed: 0.5, genLoss: 0.08 }),
  scene("wide-quartet", "Wide quartet", { heads: [play(0, 0.8, -0.9), play(0.23, 0.8, -0.3), play(0.51, 0.8, 0.3), play(0.77, 0.8, 0.9)] }),
  scene("dirty-cassette", "Dirty cassette", { heads: [play(0, 0.9), play(0.4, 0.6, 0.4), record(0.7, 1)], retain: 0.9, genLoss: 0.85, speed: 0.9 }),
  scene("sound-on-sound", "Sound on sound", { heads: [play(0.1, 1, 0), record(0.6, 1, 0)], retain: 1, genLoss: 0.05 }),
  scene("short-memory", "Short memory", { heads: [play(0.05, 1), play(0.3, 0.7, -0.5), record(0.55, 0.9)], retain: 0.6, genLoss: 0.3 }),
  scene("stutter-cluster", "Stutter cluster", {
    heads: [0, 0.03, 0.06, 0.09, 0.12].map((pos, i) => play(pos, 0.9 - i * 0.12, i % 2 ? 0.5 : -0.5)), speed: 1.5,
  }),
  scene("slow-spread", "Slow spread", { heads: spread(3, 0.85, 0.05), speed: 0.4, genLoss: 0.18 }),
  scene("sparse-rotor", "Sparse rotor", { heads: [play(0.1, 0.9, -0.6), play(0.45, 0.9, 0), play(0.8, 0.9, 0.6)], rotorOnly: true, speed: 0.8 }),
  scene("hall-of-heads", "Hall of heads", {
    heads: [...Array.from({ length: 7 }, (_, i) => play(round(i / 7, 3), round(0.95 - i * 0.1), round(((i % 2) * 2 - 1) * 0.15 * i))), record(0.93, 0.7)],
    retain: 0.9, genLoss: 0.25,
  }),
  scene("quick-pair", "Quick pair", { heads: [play(0, 0.9, -0.7), play(0.5, 0.9, 0.7)], speed: 2, genLoss: 0.02 }),
]);

export function randomizeHeadShedPreset(current, random = Math.random) {
  validateHeadShedPreset(current);
  const rng = presetRandom(random);
  const count = rng.integer(2, 6);
  let records = 0;
  const heads = Array.from({ length: count }, (_, index) => {
    const wantsRecord = index > 0 && records < 2 && rng.unit() < 0.2;
    if (wantsRecord) records++;
    return {
      kind: wantsRecord ? "record" : "play", pos01: round(rng.between(0, 0.98), 3),
      level: round(rng.between(0.35, 1)), pan: round(rng.between(-0.85, 0.85)),
    };
  });
  const players = heads.filter(head => head.kind === "play").length;
  return validateHeadShedPreset({
    speed: round(0.4 * 5.5 ** rng.unit()),
    retain: rng.unit() < 0.5 ? 1 : round(rng.between(0.7, 0.98)),
    genLoss: round(rng.between(0, 0.6)),
    rotorOnly: players >= 3 && rng.unit() < 0.3,
    heads,
  });
}
