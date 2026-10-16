import {
  ACOUSTIC_PROFILES,
  getAcousticProfile,
  normalizeAcousticAnalysisParameters,
} from "./acoustic-manifold.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const ACOUSTIC_PRESET_FRAME_SIZES = Object.freeze([128, 256, 512, 1024, 2048, 4096]);
export const ACOUSTIC_PRESET_HOP_RATIOS = Object.freeze([0.0625, 0.125, 0.25, 0.5, 1]);
export const ACOUSTIC_PRESET_RULES = Object.freeze([
  "chronology", "reverse-chronology", "similarity", "hybrid", "spatial-nearest",
  "spatial-farthest", "axis-x", "axis-y", "axis-z", "shuffled", "manual",
]);
const COMPOSED_RULES = ACOUSTIC_PRESET_RULES.filter((rule) => rule !== "manual");
const LISTEN_MODES = Object.freeze(["recording", "physical"]);
const MAX_FRAMES = 120_000;
const MAX_FFT_UNITS = 120_000;
const BAND_RATE_FACTOR = 0.46;
const DEFAULT_SOURCE_RATE = 48_000;
const MAX_RATE = 576_000;
const MIN_RATE = 8_000;

export const ACOUSTIC_PRESET_RESYNTHESIS_KEYS = Object.freeze([
  "gestureSpeed", "pitchShift", "bodyScale", "textureAmount", "manifoldExaggeration", "gapMs",
]);
export const ACOUSTIC_PRESET_ANALYSIS_KEYS = Object.freeze([
  "minimumSpectralHz", "maximumSpectralHz", "minimumEventSeconds", "gapSeconds", "fixedWindowSeconds",
  "fixedWindowOverlapPercent", "minimumActiveRatioPercent", "frameSize", "hopRatio",
  "analysisTargetRate", "sequenceGapSeconds", "neighborCount",
]);

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const num = (value, fallback) => (isNumber(value) ? value : fallback);
const roundTo = (value, decimals) => Number(value.toFixed(decimals));
const nearest = (value, list) => list.reduce(
  (best, item) => (Math.abs(Math.log2(item / value)) < Math.abs(Math.log2(best / value)) ? item : best),
);

function gridValue(value, step, minimum, maximum, fallback) {
  const clamped = Math.min(maximum, Math.max(minimum, num(value, fallback)));
  return roundTo(Math.round((clamped - minimum) / step) * step + minimum, 6);
}

export function canonicalAcousticAnalysis(profileId, raw = {}) {
  const profile = getAcousticProfile(profileId);
  const defaults = normalizeAcousticAnalysisParameters(profile, {});
  const fixed = profile.segmentationMode === "fixed-window";
  const frameSize = nearest(num(raw.frameSize, defaults.frameSize), ACOUSTIC_PRESET_FRAME_SIZES);
  const hopRatio = nearest(
    num(raw.hopRatio, defaults.hopSize / defaults.frameSize),
    ACOUSTIC_PRESET_HOP_RATIOS,
  );
  const sequence = raw.sequenceGapSeconds === null
    ? null
    : isNumber(raw.sequenceGapSeconds) ? roundTo(raw.sequenceGapSeconds, 3) : defaults.sequenceGapSeconds;
  const normalized = normalizeAcousticAnalysisParameters(profile, {
    minimumSpectralHz: Math.round(num(raw.minimumSpectralHz, defaults.minimumSpectralHz)),
    maximumSpectralHz: Math.round(num(raw.maximumSpectralHz, defaults.maximumSpectralHz)),
    minimumStropheSeconds: roundTo(num(raw.minimumEventSeconds, defaults.minimumStropheSeconds), 4),
    stropheGapSeconds: fixed
      ? defaults.stropheGapSeconds
      : roundTo(num(raw.gapSeconds, defaults.stropheGapSeconds), 4),
    fixedWindowSeconds: fixed
      ? Math.max(0.001, roundTo(num(raw.fixedWindowSeconds, defaults.fixedWindowSeconds), 3))
      : 0,
    fixedWindowOverlap: fixed
      ? Math.round(num(raw.fixedWindowOverlapPercent, defaults.fixedWindowOverlap * 100)) / 100
      : defaults.fixedWindowOverlap,
    minimumWindowActiveRatio: fixed
      ? Math.round(num(raw.minimumActiveRatioPercent, defaults.minimumWindowActiveRatio * 100)) / 100
      : defaults.minimumWindowActiveRatio,
    analysisTargetRate: Math.round(num(raw.analysisTargetRate, defaults.analysisTargetRate)),
    frameSize,
    hopSize: Math.round(frameSize * hopRatio),
    sequenceGapSeconds: sequence,
    neighborCount: Math.round(num(raw.neighborCount, defaults.neighborCount)),
  });
  return {
    minimumSpectralHz: normalized.minimumSpectralHz,
    maximumSpectralHz: normalized.maximumSpectralHz,
    minimumEventSeconds: normalized.minimumStropheSeconds,
    gapSeconds: normalized.stropheGapSeconds,
    fixedWindowSeconds: normalized.fixedWindowSeconds,
    fixedWindowOverlapPercent: Math.round(normalized.fixedWindowOverlap * 100),
    minimumActiveRatioPercent: Math.round(normalized.minimumWindowActiveRatio * 100),
    frameSize: normalized.frameSize,
    hopRatio: nearest(normalized.hopSize / normalized.frameSize, ACOUSTIC_PRESET_HOP_RATIOS),
    analysisTargetRate: normalized.analysisTargetRate,
    sequenceGapSeconds: normalized.sequenceGapSeconds,
    neighborCount: normalized.neighborCount,
  };
}

export function canonicalAcousticResynthesis(raw = {}) {
  return {
    gestureSpeed: gridValue(raw.gestureSpeed, 0.001, -3, 3, 0),
    pitchShift: gridValue(raw.pitchShift, 1, -48, 48, 0),
    bodyScale: gridValue(raw.bodyScale, 0.001, -2, 2, 0),
    textureAmount: gridValue(raw.textureAmount, 0.05, 0, 4, 1),
    manifoldExaggeration: gridValue(raw.manifoldExaggeration, 0.05, 1, 4, 1),
    gapMs: gridValue(raw.gapMs, 5, 0, 750, 90),
  };
}

/** Normalizes raw control readings into the one stable, JSON-safe preset shape. */
export function canonicalAcousticPreset(raw = {}) {
  const profile = typeof raw.profile === "string" && ACOUSTIC_PROFILES[raw.profile] ? raw.profile : "songbird";
  const route = raw.route ?? {};
  return {
    profile,
    analysis: canonicalAcousticAnalysis(profile, raw.analysis ?? {}),
    route: {
      rule: ACOUSTIC_PRESET_RULES.includes(route.rule) ? route.rule : "chronology",
      length: gridValue(route.length, 1, 2, 16, 8),
      surprise: gridValue(route.surprise, 0.01, 0, 1, 0.35),
    },
    listenMode: LISTEN_MODES.includes(raw.listenMode) ? raw.listenMode : "physical",
    resynthesis: canonicalAcousticResynthesis(raw.resynthesis ?? {}),
  };
}

export function captureAcousticPreset(raw) {
  return canonicalAcousticPreset(raw);
}

export function validateAcousticPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || presetStateKey(snapshot) !== presetStateKey(canonicalAcousticPreset(snapshot))) {
    throw new TypeError("Invalid complete Acoustic Manifold preset");
  }
  return snapshot;
}

/** Mirrors the page's frame and FFT-work guard so a recalled preset never trips it. */
export function acousticAnalysisBudgetIssue(profileId, analysis, { sampleRate = null, sampleCount = null } = {}) {
  const defaults = normalizeAcousticAnalysisParameters(profileId, {});
  const maxDuration = Math.min(defaults.maxDurationSeconds, 120);
  const hopSize = Math.round(analysis.frameSize * analysis.hopRatio);
  const hasSource = isNumber(sampleRate) && isNumber(sampleCount) && sampleCount > 0;
  const analyzedSamples = hasSource
    ? Math.min(sampleCount, sampleRate * maxDuration)
    : analysis.analysisTargetRate * maxDuration;
  const sourceRate = hasSource ? sampleRate : analysis.analysisTargetRate;
  const analysisRate = Math.min(sourceRate, analysis.analysisTargetRate);
  const frames = Math.max(1, Math.floor((analyzedSamples * analysisRate / sourceRate - analysis.frameSize) / hopSize) + 1);
  if (frames > MAX_FRAMES) return `About ${frames} frames exceeds the browser budget`;
  const work = Math.ceil(frames * Math.max(1, analysis.frameSize * Math.log2(analysis.frameSize) / (512 * 9)));
  return work > MAX_FFT_UNITS ? "The frame count and FFT size exceed the browser work budget" : null;
}

const resynth = (speed, pitch, body, texture, spread, gapMs) => ({
  gestureSpeed: speed, pitchShift: pitch, bodyScale: body, textureAmount: texture,
  manifoldExaggeration: spread, gapMs,
});
const ANCHOR = resynth(0, 0, 0, 1, 1, 90);

const scene = (id, label, profile, analysis, route, listenMode, resynthesis, description) => {
  const snapshot = canonicalAcousticPreset({
    profile, analysis, route: { surprise: 0.35, length: 8, ...route }, listenMode, resynthesis,
  });
  return Object.freeze({ id, label, description, snapshot: Object.freeze(snapshot) });
};

export const ACOUSTIC_FULL_PRESETS = Object.freeze([
  scene("songbird-strophes", "Songbird strophes", "songbird", {},
    { rule: "chronology" }, "physical", ANCHOR, "Research-default strophes walked in recorded order"),
  scene("dawn-chorus-windows", "Dawn chorus windows", "passerine-window",
    { fixedWindowSeconds: 3, fixedWindowOverlapPercent: 75, minimumActiveRatioPercent: 5, frameSize: 1024, hopRatio: 0.25, neighborCount: 5 },
    { rule: "similarity", length: 12, surprise: 0.5 }, "physical", resynth(0.4, 3, 0, 1.3, 1.5, 60),
    "Dense overlapping survey windows and a neighbor walk"),
  scene("syllable-microscope", "Syllable microscope", "bird-syllable",
    { minimumSpectralHz: 800, maximumSpectralHz: 14000, sequenceGapSeconds: 0.4, neighborCount: 6, hopRatio: 0.125 },
    { rule: "hybrid", length: 14, surprise: 0.6 }, "physical", resynth(-0.5, -5, 0.3, 1.2, 2, 40),
    "Fine syllable segmentation stretched slower and lower"),
  scene("slow-giant-howl", "Slow giant howl", "wolf-howl",
    { minimumSpectralHz: 100, maximumSpectralHz: 2500, frameSize: 2048, hopRatio: 0.125 },
    { rule: "reverse-chronology", length: 6 }, "physical", resynth(-1.515, -18, 1.263, 0.65, 1.8, 180),
    "Low howls reversed into a huge, slow body"),
  scene("frog-pulse-trains", "Frog pulse trains", "frog",
    { minimumEventSeconds: 0.03, gapSeconds: 0.15, neighborCount: 5 },
    { rule: "spatial-nearest", length: 10 }, "physical", resynth(0.3, 7, -0.4, 1.6, 1.4, 50),
    "Pulsed calls stepping to their nearest points in the map"),
  scene("cricket-lattice", "Cricket lattice", "insect",
    { minimumSpectralHz: 2500, maximumSpectralHz: 9000, minimumEventSeconds: 0.05, gapSeconds: 0.12, sequenceGapSeconds: 2, neighborCount: 6 },
    { rule: "axis-x", length: 16 }, "physical", resynth(1.459, 20, -1.152, 1.4, 2.2, 35),
    "Chirps swept along PC1 as a fast miniature"),
  scene("humpback-drift", "Humpback drift", "humpback-social",
    { frameSize: 2048, hopRatio: 0.25, maximumSpectralHz: 8000 },
    { rule: "axis-y", length: 8 }, "physical", resynth(-0.8, -12, 1, 0.9, 1.6, 250),
    "Broad marine calls drifting down the second axis"),
  scene("source-slice-collage", "Source slice collage", "general",
    { minimumEventSeconds: 0.12, gapSeconds: 0.25 },
    { rule: "shuffled", length: 16 }, "recording", resynth(0.585, 0, 0, 1, 1, 30),
    "Seeded shuffle of the decoded source slices"),
  scene("hyper-articulation", "Hyper articulation", "general",
    { frameSize: 256, hopRatio: 0.25, minimumEventSeconds: 0.06, gapSeconds: 0.12, neighborCount: 8 },
    { rule: "similarity", length: 16, surprise: 0.8 }, "physical", resynth(2.322, 7, -0.322, 2.6, 3, 15),
    "Fast, textured, maximally spread articulation"),
  scene("alien-fold", "Alien manifold fold", "marine",
    { minimumSpectralHz: 40, maximumSpectralHz: 6000, analysisTargetRate: 16000 },
    { rule: "spatial-farthest", length: 7 }, "physical", resynth(-0.737, -31, -1.515, 4, 4, 250),
    "Farthest leaps through an exaggerated map"),
  scene("pollination-buzz", "Pollination buzz", "pollination-buzz",
    { frameSize: 256, hopRatio: 0.125, neighborCount: 4 },
    { rule: "hybrid", length: 12, surprise: 0.75 }, "physical", resynth(0.2, 12, -0.5, 2, 1.5, 20),
    "Short buzzes explored with high neighbor variation"),
  scene("elephant-sub", "Elephant sub rumble", "elephant-rumble",
    { frameSize: 4096, hopRatio: 0.125 },
    { rule: "axis-z", length: 5 }, "physical", resynth(-1, -24, 1.5, 0.5, 1.2, 400),
    "Infrasonic rumbles lifted into slow, wide sweeps"),
  scene("woodpecker-machine", "Woodpecker drum machine", "woodpecker-drum",
    { frameSize: 512, hopRatio: 0.125, gapSeconds: 0.15, minimumEventSeconds: 0.08 },
    { rule: "hybrid", length: 16, surprise: 0.4 }, "physical", resynth(1, 0, 0, 1.1, 1.3, 10),
    "Drum rolls at double speed with tight silences"),
  scene("cicada-shimmer", "Cicada shimmer", "cicada-echeme",
    { minimumSpectralHz: 5000, maximumSpectralHz: 13000, sequenceGapSeconds: 0.5 },
    { rule: "spatial-nearest", length: 9 }, "physical", resynth(0.5, -7, 0.4, 2.2, 2.5, 100),
    "Echemes chained by proximity with extra texture"),
  scene("owl-cathedral", "Owl hoot cathedral", "owl-hoot",
    { minimumEventSeconds: 0.4 },
    { rule: "reverse-chronology", length: 6 }, "physical", resynth(-1.2, -14, 1.2, 0.8, 1.1, 350),
    "Hoots backwards in a large, slow room of a body"),
]);

const defaultsFor = (profileId) => normalizeAcousticAnalysisParameters(profileId, {});
const stableProfile = (profileId) => {
  const first = canonicalAcousticAnalysis(profileId, {});
  return presetStateKey(first) === presetStateKey(canonicalAcousticAnalysis(profileId, first));
};
const DICE_PROFILE_IDS = Object.freeze(Object.keys(ACOUSTIC_PROFILES).filter(stableProfile));

function diceAnalysis(profileId, rng, bandCap) {
  const defaults = defaultsFor(profileId);
  const fixed = getAcousticProfile(profileId).segmentationMode === "fixed-window";
  const high = Math.max(2, Math.floor(Math.min(bandCap, defaults.maximumSpectralHz * rng.between(0.7, 1.4))));
  const low = Math.max(1, Math.floor(Math.min(defaults.minimumSpectralHz * rng.between(0.6, 1.6), high / 1.5)));
  const rate = Math.min(MAX_RATE, Math.max(
    MIN_RATE, Math.ceil(high / BAND_RATE_FACTOR), Math.round(defaults.analysisTargetRate * rng.between(0.6, 1.6)),
  ));
  return {
    minimumSpectralHz: low,
    maximumSpectralHz: high,
    minimumEventSeconds: defaults.minimumStropheSeconds * rng.between(0.5, 2),
    gapSeconds: defaults.stropheGapSeconds * rng.between(0.5, 2),
    fixedWindowSeconds: fixed ? Math.max(0.1, defaults.fixedWindowSeconds * rng.between(0.5, 2)) : 0,
    fixedWindowOverlapPercent: rng.integer(0, 85),
    minimumActiveRatioPercent: rng.integer(1, 25),
    frameSize: rng.pick(ACOUSTIC_PRESET_FRAME_SIZES),
    hopRatio: rng.pick(ACOUSTIC_PRESET_HOP_RATIOS),
    analysisTargetRate: rate,
    sequenceGapSeconds: rng.unit() < 0.35 ? null : rng.between(0.3, 12),
    neighborCount: rng.integer(1, 12),
  };
}

function fitBudget(profileId, analysis, context) {
  let next = canonicalAcousticAnalysis(profileId, analysis);
  for (let attempt = 0; attempt < 24 && acousticAnalysisBudgetIssue(profileId, next, context); attempt++) {
    const hop = ACOUSTIC_PRESET_HOP_RATIOS.findIndex((ratio) => ratio === next.hopRatio);
    if (hop < ACOUSTIC_PRESET_HOP_RATIOS.length - 1) next = { ...next, hopRatio: ACOUSTIC_PRESET_HOP_RATIOS[hop + 1] };
    else if (next.frameSize > ACOUSTIC_PRESET_FRAME_SIZES[0]) next = { ...next, frameSize: next.frameSize / 2 };
    else {
      const rate = Math.max(MIN_RATE, Math.floor(next.analysisTargetRate * 0.7));
      next = { ...next, analysisTargetRate: rate, maximumSpectralHz: Math.min(next.maximumSpectralHz, Math.floor(rate * BAND_RATE_FACTOR)) };
    }
    next = canonicalAcousticAnalysis(profileId, next);
  }
  return next;
}

/**
 * Pure full-state dice. The source sample rate bounds the feature band and the
 * analysis-rate ceiling so the page's coverage and work-budget checks stay valid.
 */
export function randomizeAcousticPreset(current, random = Math.random, context = {}) {
  validateAcousticPreset(current);
  const rng = presetRandom(random);
  const sampleRate = isNumber(context.sampleRate) && context.sampleRate > 0 ? context.sampleRate : DEFAULT_SOURCE_RATE;
  const budgetContext = { sampleRate, sampleCount: isNumber(context.sampleCount) ? context.sampleCount : null };
  const bandCap = Math.min(Math.floor(sampleRate * BAND_RATE_FACTOR), Math.floor(MAX_RATE * BAND_RATE_FACTOR));
  const pool = DICE_PROFILE_IDS.filter((id) => defaultsFor(id).minimumSpectralHz <= bandCap * 0.4);
  const profile = rng.pick(pool);
  const analysis = fitBudget(profile, diceAnalysis(profile, rng, bandCap), budgetContext);
  const result = canonicalAcousticPreset({
    profile,
    analysis,
    route: {
      rule: rng.pick(COMPOSED_RULES),
      length: rng.integer(2, 16),
      surprise: rng.unit(),
    },
    listenMode: rng.unit() < 0.75 ? "physical" : "recording",
    resynthesis: {
      gestureSpeed: rng.between(-2.5, 2.5),
      pitchShift: rng.integer(-36, 36),
      bodyScale: rng.between(-1.5, 1.5),
      textureAmount: rng.between(0, 3.5),
      manifoldExaggeration: rng.between(1, 3.5),
      gapMs: rng.integer(0, 80) * 5,
    },
  });
  return validateAcousticPreset(result);
}
