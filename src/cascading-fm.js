// Cascading FM synthesis core.
//
// N sine oscillators in a linear chain: osc[0] → osc[1] → … → osc[N-1]
// osc[i].output modulates osc[i+1].frequency with scale depthHz[i].
// Only osc[N-1] reaches the audio output.
//
// Frequencies cascade from the first oscillator by cascadeRatio per stage:
//   freq[i] = rootHz × cascadeRatio^i   (clamped to audioCeiling)
// Ratios above 1 rise, 1 holds every stage at the same base frequency, and
// ratios below 1 fall toward progressively slower modulators/carriers.
//
// Modulation depth at stage i → i+1:
//   depthHz[i] = modDepth × depthTaper^i
//
// At depthTaper ≈ cascadeRatio the modulation index Δf/f_mod is constant
// across the chain, which is perceptually natural.  Values below that
// emphasise the low-frequency sweeps; values above push energy into upper stages.

export const CASCADING_FM_LIMITS = Object.freeze({
  minStages: 2,
  maxStages: 12,
  minRootHz: 0.02,
  maxRootHz: 110,
  // 0.25 permits a two-octave descent per stage.
  minCascadeRatio: 0.25,
  maxCascadeRatio: 200,
  minModDepth: 0,
  maxModDepth: 16_000,
  minDepthTaper: 0.05,
  maxDepthTaper: 4.0,
  audioCeiling: 20_000,
});

export const CASCADING_FM_DEFAULTS = Object.freeze({
  stages: 5,
  rootHz: 55,
  cascadeRatio: 2,
  modDepth: 220,
  depthTaper: 0.8,
});

const freezePreset = (p) => Object.freeze({ ...p, settings: Object.freeze({ ...p.settings }) });

export const CASCADING_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "brass-choir",
    label: "Brass Choir",
    description: "Five harmonic stages rooted at 55 Hz with moderate depth and even taper — warm and brassy.",
    settings: { stages: 5, rootHz: 55, cascadeRatio: 2, modDepth: 220, depthTaper: 0.8 },
  }),
  freezePreset({
    id: "bell-tower",
    label: "Bell Tower",
    description: "Four inharmonic stages from 110 Hz with a slight ratio offset and rising taper for metallic shimmer.",
    settings: { stages: 4, rootHz: 110, cascadeRatio: 2.8, modDepth: 440, depthTaper: 1.1 },
  }),
  freezePreset({
    id: "neon-reed",
    label: "Neon Reed",
    description: "Six tight stages at 82 Hz with low-index modulation and gentle taper — buzzy and reedy.",
    settings: { stages: 6, rootHz: 82, cascadeRatio: 1.5, modDepth: 120, depthTaper: 0.75 },
  }),
  freezePreset({
    id: "glass-forest",
    label: "Glass Forest",
    description: "Three widely spread stages from 110 Hz produce glassy, shifting overtones.",
    settings: { stages: 3, rootHz: 110, cascadeRatio: 4.2, modDepth: 900, depthTaper: 0.5 },
  }),
  freezePreset({
    id: "organ-pulse",
    label: "Organ Pulse",
    description: "Eight even octave-ish stages from 65 Hz with falling taper emulate a pipe organ chorus.",
    settings: { stages: 8, rootHz: 65, cascadeRatio: 2, modDepth: 260, depthTaper: 0.65 },
  }),
  freezePreset({
    id: "electric-wind",
    label: "Electric Wind",
    description: "Five wide-ratio stages at 110 Hz with high index and fast taper — electric and chaotic.",
    settings: { stages: 5, rootHz: 110, cascadeRatio: 3.5, modDepth: 1_800, depthTaper: 0.4 },
  }),
]);

export const DEFAULT_CASCADING_FM_PRESET_ID = "brass-choir";

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
 * Re-space a cascade after its stage count changes while preserving the raw
 * first-to-last frequency span. This keeps the Stages control from causing an
 * exponential carrier jump merely because another oscillator was inserted.
 */
export function cascadeRatioForStageCount(ratio, previousStages, nextStages) {
  const limits = CASCADING_FM_LIMITS;
  const safeRatio = clamp(
    finiteOr(ratio, CASCADING_FM_DEFAULTS.cascadeRatio),
    limits.minCascadeRatio,
    limits.maxCascadeRatio,
  );
  const safePreviousStages = clamp(
    Math.round(finiteOr(previousStages, CASCADING_FM_DEFAULTS.stages)),
    limits.minStages,
    limits.maxStages,
  );
  const safeNextStages = clamp(
    Math.round(finiteOr(nextStages, safePreviousStages)),
    limits.minStages,
    limits.maxStages,
  );
  return clamp(
    Math.pow(safeRatio, (safePreviousStages - 1) / (safeNextStages - 1)),
    limits.minCascadeRatio,
    limits.maxCascadeRatio,
  );
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
  if (value >= 0.01) return `${value.toFixed(3).replace(/\.?0+$/, "")} Hz`;
  if (value >= 0.001) {
    return `${(value * 1_000).toFixed(2).replace(/\.?0+$/, "")} mHz`;
  }
  if (value >= 0.000_001) {
    return `${(value * 1_000_000).toFixed(2).replace(/\.?0+$/, "")} µHz`;
  }
  return `${value.toExponential(2)} Hz`;
}

export function formatCascadeRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return "×1";
  const digits = value < 10 ? 2 : (value < 100 ? 1 : 0);
  return `×${value.toFixed(digits).replace(/\.?0+$/, "")}`;
}

export function cascadeFrequencyDirection(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || Math.abs(value - 1) < 1e-12) return "equal";
  return value < 1 ? "falling" : "rising";
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

// Cascade ratio: a three-zone logarithmic control. The common ×1–×5 range
// owns 40% of the track so a deep cascade remains steerable; the descending
// and extended-high ranges remain reachable without consuming most of the
// useful travel. The lower and musical zones share the same logarithmic slope,
// so crossing unity stays smooth.

const RATIO_SLIDER_MIN = CASCADING_FM_LIMITS.minCascadeRatio;
const RATIO_SLIDER_MAX = CASCADING_FM_LIMITS.maxCascadeRatio;
const RATIO_SLIDER_MUSICAL_MAX = 5;
const RATIO_SLIDER_MUSICAL_WIDTH = 0.4;
const RATIO_SLIDER_UNITY_POSITION = RATIO_SLIDER_MUSICAL_WIDTH
  * Math.log(1 / RATIO_SLIDER_MIN)
  / Math.log(RATIO_SLIDER_MUSICAL_MAX);
const RATIO_SLIDER_MUSICAL_END = RATIO_SLIDER_UNITY_POSITION
  + RATIO_SLIDER_MUSICAL_WIDTH;

export function ratioSliderValue(position) {
  const safe = Math.min(1, Math.max(0, Number(position) || 0));
  if (safe <= RATIO_SLIDER_UNITY_POSITION) {
    return RATIO_SLIDER_MIN * Math.pow(
      1 / RATIO_SLIDER_MIN,
      safe / RATIO_SLIDER_UNITY_POSITION,
    );
  }
  if (safe <= RATIO_SLIDER_MUSICAL_END) {
    return Math.pow(
      RATIO_SLIDER_MUSICAL_MAX,
      (safe - RATIO_SLIDER_UNITY_POSITION) / RATIO_SLIDER_MUSICAL_WIDTH,
    );
  }
  return RATIO_SLIDER_MUSICAL_MAX * Math.pow(
    RATIO_SLIDER_MAX / RATIO_SLIDER_MUSICAL_MAX,
    (safe - RATIO_SLIDER_MUSICAL_END) / (1 - RATIO_SLIDER_MUSICAL_END),
  );
}

export function ratioSliderPosition(value) {
  const safeValue = Math.min(RATIO_SLIDER_MAX, Math.max(RATIO_SLIDER_MIN, Number(value) || RATIO_SLIDER_MIN));
  if (safeValue <= 1) {
    return RATIO_SLIDER_UNITY_POSITION
      * Math.log(safeValue / RATIO_SLIDER_MIN)
      / Math.log(1 / RATIO_SLIDER_MIN);
  }
  if (safeValue <= RATIO_SLIDER_MUSICAL_MAX) {
    return RATIO_SLIDER_UNITY_POSITION
      + RATIO_SLIDER_MUSICAL_WIDTH
        * Math.log(safeValue)
        / Math.log(RATIO_SLIDER_MUSICAL_MAX);
  }
  return RATIO_SLIDER_MUSICAL_END
    + (1 - RATIO_SLIDER_MUSICAL_END)
      * Math.log(safeValue / RATIO_SLIDER_MUSICAL_MAX)
      / Math.log(RATIO_SLIDER_MAX / RATIO_SLIDER_MUSICAL_MAX);
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
