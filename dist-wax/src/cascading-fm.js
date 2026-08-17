// Cascading FM synthesis core.
//
// N sine oscillators in a linear chain: osc[0] → osc[1] → … → osc[N-1]
// osc[i].output modulates osc[i+1].frequency with scale depthHz[i].
// Only osc[N-1] reaches the audio output.
//
// Frequencies cascade from a slow LFO root upward by cascadeRatio per stage:
//   freq[i] = rootHz × cascadeRatio^i   (clamped to audioCeiling)
//
// Modulation depth at stage i → i+1:
//   depthHz[i] = modDepth × depthTaper^i
//
// At depthTaper ≈ 1 / cascadeRatio the modulation index Δf/f_mod is constant
// across the chain, which is perceptually natural.  Values below that
// emphasise the low-frequency sweeps; values above push energy into upper stages.

export const CASCADING_FM_LIMITS = Object.freeze({
  minStages: 2,
  maxStages: 8,
  minRootHz: 0.02,
  maxRootHz: 110,
  minCascadeRatio: 1.5,
  maxCascadeRatio: 200,
  minModDepth: 0,
  maxModDepth: 16_000,
  minDepthTaper: 0.05,
  maxDepthTaper: 4.0,
  audioCeiling: 20_000,
});

export const CASCADING_FM_DEFAULTS = Object.freeze({
  stages: 5,
  rootHz: 0.3,
  cascadeRatio: 10,
  modDepth: 3_000,
  depthTaper: 0.55,
});

const freezePreset = (p) => Object.freeze({ ...p, settings: Object.freeze({ ...p.settings }) });

export const CASCADING_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "slow-cascade",
    label: "Slow Cascade",
    description: "Sub-audio root at 0.3 Hz cascades up through audio with gently decreasing modulation depth.",
    settings: { stages: 5, rootHz: 0.3, cascadeRatio: 10, modDepth: 3_000, depthTaper: 0.55 },
  }),
  freezePreset({
    id: "dense-wave",
    label: "Dense Wave",
    description: "Seven tight stages with a fast LFO root create a rich, wavering tone.",
    settings: { stages: 7, rootHz: 1.2, cascadeRatio: 5, modDepth: 2_000, depthTaper: 0.7 },
  }),
  freezePreset({
    id: "wide-steps",
    label: "Wide Steps",
    description: "Three stages far apart in frequency for broad, sweeping timbral layers.",
    settings: { stages: 3, rootHz: 0.1, cascadeRatio: 60, modDepth: 8_000, depthTaper: 0.4 },
  }),
  freezePreset({
    id: "bright-shimmer",
    label: "Bright Shimmer",
    description: "A moderate root with high cascade ratio and rising taper pushes energy into upper partials.",
    settings: { stages: 4, rootHz: 2, cascadeRatio: 25, modDepth: 1_500, depthTaper: 1.2 },
  }),
  freezePreset({
    id: "deep-strata",
    label: "Deep Strata",
    description: "Two wide-spaced oscillators with heavy modulation — raw and unstable.",
    settings: { stages: 2, rootHz: 0.05, cascadeRatio: 200, modDepth: 12_000, depthTaper: 1 },
  }),
  freezePreset({
    id: "harmonic-rain",
    label: "Harmonic Rain",
    description: "Six even stages at 3 Hz root with gentle taper create a glittering harmonic rain.",
    settings: { stages: 6, rootHz: 3, cascadeRatio: 8, modDepth: 1_200, depthTaper: 0.6 },
  }),
]);

export const DEFAULT_CASCADING_FM_PRESET_ID = "slow-cascade";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeCascadingFmSettings(raw = {}) {
  const L = CASCADING_FM_LIMITS;
  const D = CASCADING_FM_DEFAULTS;
  return Object.freeze({
    stages: clamp(Math.round(finiteOr(raw.stages, D.stages)), L.minStages, L.maxStages),
    rootHz: clamp(finiteOr(raw.rootHz, D.rootHz), L.minRootHz, L.maxRootHz),
    cascadeRatio: clamp(
      finiteOr(raw.cascadeRatio, D.cascadeRatio),
      L.minCascadeRatio,
      L.maxCascadeRatio,
    ),
    modDepth: clamp(finiteOr(raw.modDepth, D.modDepth), L.minModDepth, L.maxModDepth),
    depthTaper: clamp(
      finiteOr(raw.depthTaper, D.depthTaper),
      L.minDepthTaper,
      L.maxDepthTaper,
    ),
  });
}

/**
 * Compute the full oscillator array and modulation connections for the
 * given settings.  All oscillators up to maxStages are returned so the
 * audio engine can pre-allocate the maximum node count and simply gate
 * the unused ones to silence.
 */
export function deriveCascadeStack(rawSettings) {
  const settings = sanitizeCascadingFmSettings(rawSettings);
  const { stages, rootHz, cascadeRatio, modDepth, depthTaper } = settings;

  const oscillators = [];
  for (let i = 0; i < stages; i++) {
    const freq = Math.min(rootHz * Math.pow(cascadeRatio, i), CASCADING_FM_LIMITS.audioCeiling);
    oscillators.push(Object.freeze({
      freq,
      stageIndex: i,
      isLfo: i === 0,
      isCarrier: i === stages - 1,
    }));
  }

  const connections = [];
  for (let i = 0; i < stages - 1; i++) {
    const depthHz = modDepth * Math.pow(depthTaper, i);
    connections.push(Object.freeze({ from: i, to: i + 1, depthHz }));
  }

  // Normalise output level: more stages → more FM energy → quieter.
  const normalizedGain = clamp(1 / Math.sqrt(stages), 0.25, 1);

  return Object.freeze({
    settings,
    oscillators: Object.freeze(oscillators),
    connections: Object.freeze(connections),
    outputIndex: stages - 1,
    normalizedGain,
  });
}

export function formatCascadeFrequency(hz) {
  const value = Number(hz);
  if (!Number.isFinite(value) || value <= 0) return "0 Hz";
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")} kHz`;
  }
  if (value >= 10) return `${Math.round(value)} Hz`;
  if (value >= 1) return `${value.toFixed(2).replace(/\.?0+$/, "")} Hz`;
  return `${value.toFixed(3).replace(/\.?0+$/, "")} Hz`;
}

// ---------------------------------------------------------------------------
// Slider helpers (root frequency: logarithmic over 0.02–110 Hz)
// ---------------------------------------------------------------------------

const ROOT_SLIDER_MIN = 0.02;
const ROOT_SLIDER_MAX = 110;

export function rootHzSliderValue(position) {
  const safe = Math.min(1, Math.max(0, Number(position) || 0));
  return ROOT_SLIDER_MIN * Math.pow(ROOT_SLIDER_MAX / ROOT_SLIDER_MIN, safe);
}

export function rootHzSliderPosition(value) {
  const safeValue = Math.min(ROOT_SLIDER_MAX, Math.max(ROOT_SLIDER_MIN, Number(value) || ROOT_SLIDER_MIN));
  return Math.log(safeValue / ROOT_SLIDER_MIN) / Math.log(ROOT_SLIDER_MAX / ROOT_SLIDER_MIN);
}

// Cascade ratio: logarithmic over 1.5–200

const RATIO_SLIDER_MIN = 1.5;
const RATIO_SLIDER_MAX = 200;

export function ratioSliderValue(position) {
  const safe = Math.min(1, Math.max(0, Number(position) || 0));
  return RATIO_SLIDER_MIN * Math.pow(RATIO_SLIDER_MAX / RATIO_SLIDER_MIN, safe);
}

export function ratioSliderPosition(value) {
  const safeValue = Math.min(RATIO_SLIDER_MAX, Math.max(RATIO_SLIDER_MIN, Number(value) || RATIO_SLIDER_MIN));
  return Math.log(safeValue / RATIO_SLIDER_MIN) / Math.log(RATIO_SLIDER_MAX / RATIO_SLIDER_MIN);
}

// Modulation depth: quadratic over 0–16 000 Hz (gives fine control near zero)

export function modDepthSliderValue(position) {
  const safe = Math.min(1, Math.max(0, Number(position) || 0));
  return CASCADING_FM_LIMITS.maxModDepth * safe * safe;
}

export function modDepthSliderPosition(value) {
  const safeValue = Math.min(
    CASCADING_FM_LIMITS.maxModDepth,
    Math.max(0, Number(value) || 0),
  );
  return Math.sqrt(safeValue / CASCADING_FM_LIMITS.maxModDepth);
}
