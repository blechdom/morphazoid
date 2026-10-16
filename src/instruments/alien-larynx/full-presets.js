import { MAX_THROATS } from "../../families/tract/throatazoid.js";
import {
  THROATAZOID_FULL_PRESETS, captureThroatazoidPreset, randomizeThroatazoidPreset, validateThroatazoidPreset,
} from "../throatazoid/full-presets.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const GENES = Object.freeze(["follow", "a", "e", "i", "o", "u", "m", "n", "s", "k"]);
const MEDIA = Object.freeze({ air: 343, helium: 1007, heavy: 134, alien: 220 });
const WAVEFORMS = Object.freeze(["lf", "pulse", "impulse", "noise"]);
const TOPOLOGIES = Object.freeze(["ring", "star", "mobius", "random"]);
const DIVISIONS = Object.freeze([1, 2, 3, 4, 6, 8]);
const GLAND_COUNT = 4;

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));
const oneOf = (value, values, fallback) => (values.includes(value) ? value : fallback);

export const ALIEN_DEFAULT = Object.freeze({
  larynx: { enabled: false, falseFoldMix: .24, asymmetry: .08, feedback: .16 },
  scale: { enabled: false, lengthCm: 17.5, medium: "air", soundSpeed: 343, radiation: .78 },
  genomes: {
    enabled: false, rateHz: 0,
    mouths: Array.from({ length: MAX_THROATS }, (_, i) => ({ from: "follow", to: "follow", morph: 0, phase: i / MAX_THROATS })),
  },
  glands: {
    enabled: false,
    programs: Array.from({ length: GLAND_COUNT }, (_, i) => ({
      waveform: "lf", pitchRatio: [1, .5, 1.5, 2][i], division: [1, 2, 3, 4][i], phase: i * .25, duty: .5, jitter: 0,
    })),
  },
  wormhole: { enabled: false, topology: "ring", delayMs: 8, feedback: .24, seed: 73 },
});

export function captureAlienState(source = {}) {
  const d = ALIEN_DEFAULT;
  const { larynx = {}, scale = {}, genomes = {}, glands = {}, wormhole = {} } = source;
  return {
    larynx: {
      enabled: Boolean(larynx.enabled), falseFoldMix: num(larynx.falseFoldMix, 0, 1, d.larynx.falseFoldMix),
      asymmetry: num(larynx.asymmetry, -1, 1, d.larynx.asymmetry), feedback: num(larynx.feedback, 0, .7, d.larynx.feedback),
    },
    scale: {
      enabled: Boolean(scale.enabled), lengthCm: num(scale.lengthCm, 7, 70, d.scale.lengthCm),
      medium: oneOf(scale.medium, [...Object.keys(MEDIA), "custom"], "air"),
      soundSpeed: num(scale.soundSpeed, 100, 1100, d.scale.soundSpeed), radiation: num(scale.radiation, 0, 1, d.scale.radiation),
    },
    genomes: {
      enabled: Boolean(genomes.enabled), rateHz: num(genomes.rateHz, 0, 4, 0),
      mouths: Array.from({ length: MAX_THROATS }, (_, i) => ({
        from: oneOf(genomes.mouths?.[i]?.from, GENES, "follow"), to: oneOf(genomes.mouths?.[i]?.to, GENES, "follow"),
        morph: num(genomes.mouths?.[i]?.morph, 0, 1, 0), phase: num(genomes.mouths?.[i]?.phase, 0, 1, i / MAX_THROATS),
      })),
    },
    glands: {
      enabled: Boolean(glands.enabled),
      programs: Array.from({ length: GLAND_COUNT }, (_, i) => {
        const p = glands.programs?.[i] ?? {}, base = d.glands.programs[i];
        return {
          waveform: oneOf(p.waveform, WAVEFORMS, "lf"), pitchRatio: num(p.pitchRatio, .25, 4, base.pitchRatio),
          division: oneOf(p.division, DIVISIONS, base.division), phase: num(p.phase, 0, 1, base.phase),
          duty: num(p.duty, .05, .95, .5), jitter: num(p.jitter, 0, 1, 0),
        };
      }),
    },
    wormhole: {
      enabled: Boolean(wormhole.enabled), topology: oneOf(wormhole.topology, TOPOLOGIES, "ring"),
      delayMs: num(wormhole.delayMs, .5, 40, 8), feedback: num(wormhole.feedback, 0, .78, .24), seed: Math.round(num(wormhole.seed, 1, 999, 73)),
    },
  };
}

export function captureAlienLarynxPreset(source) {
  return { ...captureThroatazoidPreset(source), alien: captureAlienState(source.alien) };
}

export function validateAlienLarynxPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.alien) throw new TypeError("Invalid complete Alien Larynx preset");
  const { alien, ...base } = snapshot;
  validateThroatazoidPreset(base);
  if (presetStateKey(alien) !== presetStateKey(captureAlienState(alien))) throw new TypeError("Invalid complete Alien Larynx preset");
  return snapshot;
}

const baseOf = id => THROATAZOID_FULL_PRESETS.find(preset => preset.id === id).snapshot;
const mouths = (pairs, spread = 1) => pairs.map(([from, to], i) => ({ from, to, morph: i === 0 ? 0 : spread * i / (MAX_THROATS - 1), phase: i / MAX_THROATS }));
const scene = (id, label, baseId, alien) => Object.freeze({
  id, label, base: baseId,
  snapshot: Object.freeze(captureAlienLarynxPreset({ ...baseOf(baseId), alien })),
});
const FOLLOW = Array(MAX_THROATS).fill(["follow", "follow"]);
const COLONY = [["follow", "follow"], ["e", "i"], ["o", "u"], ["a", "i"], ["u", "e"], ["i", "o"], ["a", "u"]];

export const ALIEN_LARYNX_FULL_PRESETS = Object.freeze([
  scene("anchor-clear", "Playable default", "voice-clear", {}),
  scene("double-fold", "Double fold", "voice-warm", { larynx: { enabled: true, falseFoldMix: .55, asymmetry: .3, feedback: .3 } }),
  scene("giant-tract", "Giant tract", "voice-deep", { scale: { enabled: true, lengthCm: 58, medium: "air", soundSpeed: 343, radiation: .6 } }),
  scene("helium-sprite", "Helium sprite", "voice-soprano", { scale: { enabled: true, lengthCm: 11, medium: "helium", soundSpeed: 1007, radiation: .9 } }),
  scene("heavy-gas-oracle", "Heavy gas oracle", "anatomy-oracle", { scale: { enabled: true, lengthCm: 30, medium: "heavy", soundSpeed: 134, radiation: .5 }, larynx: { enabled: true, falseFoldMix: .3, asymmetry: -.2, feedback: .2 } }),
  scene("vowel-colony", "Vowel colony", "anatomy-singing", { genomes: { enabled: true, rateHz: .6, mouths: mouths(COLONY) } }),
  scene("drifting-hive", "Drifting hive", "anatomy-hive", { genomes: { enabled: true, rateHz: 1.8, mouths: mouths(COLONY.slice().reverse(), .8) } }),
  scene("clocked-glands", "Clocked glands", "anatomy-hydra", { glands: { enabled: true, programs: [
    { waveform: "pulse", pitchRatio: 1, division: 1, phase: 0, duty: .3, jitter: .05 },
    { waveform: "lf", pitchRatio: .5, division: 2, phase: .25, duty: .5, jitter: .1 },
    { waveform: "impulse", pitchRatio: 2, division: 3, phase: .5, duty: .2, jitter: .2 },
    { waveform: "noise", pitchRatio: 4, division: 8, phase: .75, duty: .6, jitter: .4 },
  ] } }),
  scene("robot-choir", "Robot choir", "voice-choir", {
    glands: { enabled: true, programs: ALIEN_DEFAULT.glands.programs.map((p, i) => ({ ...p, waveform: "pulse", duty: .2 + i * .15, jitter: .12 })) },
    larynx: { enabled: true, falseFoldMix: .4, asymmetry: .1, feedback: .22 },
  }),
  scene("ring-wormhole", "Ring wormhole", "voice-bell", { wormhole: { enabled: true, topology: "ring", delayMs: 12, feedback: .45, seed: 73 } }),
  scene("mobius-maw", "Mobius maw", "anatomy-maw", { wormhole: { enabled: true, topology: "mobius", delayMs: 4.5, feedback: .6, seed: 211 }, larynx: { enabled: true, falseFoldMix: .6, asymmetry: -.4, feedback: .4 } }),
  scene("seeded-void", "Seeded void", "anatomy-void", { wormhole: { enabled: true, topology: "random", delayMs: 27, feedback: .5, seed: 604 }, scale: { enabled: true, lengthCm: 44, medium: "alien", soundSpeed: 220, radiation: .4 } }),
  scene("full-alien", "Full alien", "voice-alien", {
    larynx: { enabled: true, falseFoldMix: .5, asymmetry: .25, feedback: .35 },
    scale: { enabled: true, lengthCm: 24, medium: "alien", soundSpeed: 220, radiation: .7 },
    genomes: { enabled: true, rateHz: .9, mouths: mouths(COLONY, .7) },
    glands: { enabled: true, programs: ALIEN_DEFAULT.glands.programs.map(p => ({ ...p, waveform: "lf", jitter: .15 })) },
    wormhole: { enabled: true, topology: "star", delayMs: 9, feedback: .38, seed: 340 },
  }),
]);

export function alienLarynxEntryForSnapshot(snapshot) {
  const key = presetStateKey(snapshot);
  return ALIEN_LARYNX_FULL_PRESETS.find(preset => presetStateKey(preset.snapshot) === key) ?? null;
}

export function randomizeAlienLarynxPreset(current, random = Math.random) {
  validateAlienLarynxPreset(current);
  const { alien: _ignored, ...base } = current;
  const rng = presetRandom(random);
  const next = randomizeThroatazoidPreset(base, random);
  const medium = rng.pick([...Object.keys(MEDIA), "custom"]);
  const gene = () => rng.pick(GENES);
  const alien = {
    larynx: { enabled: rng.unit() < .5, falseFoldMix: rng.between(0, 1), asymmetry: rng.between(-1, 1), feedback: rng.between(0, .6) },
    scale: {
      enabled: rng.unit() < .5, lengthCm: rng.between(8, 65), medium,
      soundSpeed: medium === "custom" ? rng.between(120, 1050) : MEDIA[medium], radiation: rng.between(.2, 1),
    },
    genomes: {
      enabled: rng.unit() < .5, rateHz: rng.between(0, 3),
      mouths: Array.from({ length: MAX_THROATS }, () => ({ from: gene(), to: gene(), morph: rng.unit(), phase: rng.unit() })),
    },
    glands: {
      enabled: rng.unit() < .5,
      programs: Array.from({ length: GLAND_COUNT }, () => ({
        waveform: rng.pick(WAVEFORMS), pitchRatio: rng.pick([.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4]), division: rng.pick(DIVISIONS),
        phase: rng.unit(), duty: rng.between(.1, .9), jitter: rng.between(0, .6),
      })),
    },
    wormhole: {
      enabled: rng.unit() < .5, topology: rng.pick(TOPOLOGIES), delayMs: rng.between(1, 35),
      feedback: rng.between(0, .7), seed: rng.integer(1, 999),
    },
  };
  return validateAlienLarynxPreset({ ...next, alien: captureAlienState(alien) });
}
