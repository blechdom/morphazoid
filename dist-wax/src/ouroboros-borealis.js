import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-ouroboros-borealis";
const TAU = Math.PI * 2;
const PITCH_LAYER_COUNT = 21;
const RHYTHM_LAYER_COUNT = 21;
const PITCH_LAYER_CENTER = Math.floor(PITCH_LAYER_COUNT / 2);
const RHYTHM_LAYER_CENTER = Math.floor(RHYTHM_LAYER_COUNT / 2);
const DEFAULT_SAMPLE_RATE = 48_000;
const MODE_COUNT = 4;
const MIN_FULL_HIT_RATE = 0.125;
const MIN_HIT_RATE = 0.0625;
const MAX_FULL_HIT_RATE = 48;
const MAX_HIT_RATE = 96;
const RATTLE_RANGE_MIN = 20;
const RATTLE_RANGE_MAX = 16_000;
const RATTLE_RANGE_OCTAVES = Math.log2(RATTLE_RANGE_MAX / RATTLE_RANGE_MIN);
const RATTLE_MORPH_WIDTH = 1.05;
const RATTLE_CROSSOVERS = Object.freeze([110, 720, 4_600]);
const RATTLE_RATIOS = Object.freeze([
  Object.freeze([1, 1.56, 2.08, 2.29]),
  Object.freeze([1, 1.59, 2.14, 2.31]),
  Object.freeze([1, 1.48, 2.03, 2.57]),
  Object.freeze([1, 1.87, 2.73, 3.91]),
]);
const RATTLE_GAINS = Object.freeze([
  Object.freeze([1, 0.34, 0.16, 0.1]),
  Object.freeze([1, 0.46, 0.25, 0.16]),
  Object.freeze([1, 0.54, 0.33, 0.21]),
  Object.freeze([1, 0.62, 0.42, 0.28]),
]);
const RATTLE_DECAYS = Object.freeze([0.76, 0.48, 0.235, 0.085]);
const RATTLE_HIGH_DAMPING = Object.freeze([0.56, 0.72, 0.98, 1.32]);
const RATTLE_PITCH_DROPS = Object.freeze([1.82, 0.56, 0.17, 0.025]);
const RATTLE_PITCH_DROP_TIMES = Object.freeze([0.072, 0.048, 0.026, 0.012]);
const RATTLE_NOISE_MIXES = Object.freeze([0.035, 0.09, 0.43, 0.94]);
const RATTLE_NOISE_DECAYS = Object.freeze([0.028, 0.036, 0.052, 0.072]);
const RATTLE_NOISE_COLORS = Object.freeze([0.12, 0.3, 0.64, 0.96]);
const RATTLE_BODY_MIXES = Object.freeze([1, 0.96, 0.82, 0.28]);
const RATTLE_HARDNESSES = Object.freeze([0.25, 0.42, 0.7, 0.96]);

export const OUROBOROS_BOREALIS_PHASE_SEED = 0.1375035237;

export const OUROBOROS_BOREALIS_DEFAULTS = Object.freeze({
  pitchDirection: 1,
  rhythmDirection: -1,
  pitchGlissRate: 0.12,
  rhythmGlissRate: 0.1,
  centerPitch: 110,
  centerRate: 4,
  pitchWidth: 5,
  rhythmWidth: 5,
  pitchInterval: 1,
  rhythmInterval: 1,
  phaseOffset: 0.25,
  coupling: 0,
  couplingFocus: 0.5,
  spread: 0.34,
  decay: 0.18,
  character: 0.5,
  morphDepth: 1,
  noiseMix: 0.3,
  cutoff: 8_000,
  level: 0.52,
});

export const OUROBOROS_BOREALIS_PRESETS = Object.freeze([
  Object.freeze({
    id: "countercurrent",
    label: "Countercurrent",
    description: "pitch rises · rhythm slows",
    ...OUROBOROS_BOREALIS_DEFAULTS,
  }),
  Object.freeze({
    id: "aurora-rise",
    label: "Aurora rise",
    description: "pitch rises · rhythm accelerates",
    ...OUROBOROS_BOREALIS_DEFAULTS,
    rhythmDirection: 1,
    coupling: 0.42,
    couplingFocus: 0.62,
    phaseOffset: 0.08,
  }),
  Object.freeze({
    id: "polar-fall",
    label: "Polar fall",
    description: "pitch falls · rhythm slows",
    ...OUROBOROS_BOREALIS_DEFAULTS,
    pitchDirection: -1,
    rhythmDirection: -1,
    pitchGlissRate: 0.085,
    rhythmGlissRate: 0.075,
    centerPitch: 82,
    centerRate: 2.4,
    pitchWidth: 7,
    rhythmWidth: 7,
    decay: 0.3,
    character: 0.28,
    coupling: 0.2,
  }),
  Object.freeze({
    id: "inverse-ribbon",
    label: "Inverse ribbon",
    description: "pitch falls · rhythm accelerates",
    ...OUROBOROS_BOREALIS_DEFAULTS,
    pitchDirection: -1,
    rhythmDirection: 1,
    pitchGlissRate: 0.2,
    rhythmGlissRate: 0.24,
    centerPitch: 145,
    centerRate: 5.5,
    coupling: -0.72,
    couplingFocus: 0.34,
    phaseOffset: 0.61,
  }),
  Object.freeze({
    id: "split-spectrum",
    label: "Split spectrum",
    description: "wide intervals · tight relationship",
    ...OUROBOROS_BOREALIS_DEFAULTS,
    pitchInterval: 1.5,
    rhythmInterval: 0.75,
    pitchWidth: 7.5,
    rhythmWidth: 6,
    centerPitch: 132,
    centerRate: 3,
    coupling: 0.9,
    couplingFocus: 0.82,
    phaseOffset: 0.42,
    spread: 0.64,
    level: 0.46,
  }),
  Object.freeze({
    id: "solar-rattle",
    label: "Solar rattle",
    description: "bright · quick · uncoupled",
    ...OUROBOROS_BOREALIS_DEFAULTS,
    pitchDirection: 1,
    rhythmDirection: 1,
    pitchGlissRate: 0.42,
    rhythmGlissRate: 0.36,
    centerPitch: 185,
    centerRate: 8,
    pitchWidth: 4,
    rhythmWidth: 4.5,
    decay: 0.07,
    character: 0.82,
    morphDepth: 0.82,
    noiseMix: 0.5,
    cutoff: 14_000,
    phaseOffset: 0.78,
    level: 0.45,
  }),
]);

export function clamp(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

export function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function directionValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric < 0 ? -1 : 1 : fallback;
}

export function sanitizeOuroborosBorealisParams(params = {}) {
  return Object.freeze({
    pitchDirection: directionValue(
      params.pitchDirection,
      OUROBOROS_BOREALIS_DEFAULTS.pitchDirection,
    ),
    rhythmDirection: directionValue(
      params.rhythmDirection,
      OUROBOROS_BOREALIS_DEFAULTS.rhythmDirection,
    ),
    pitchGlissRate: clamp(
      params.pitchGlissRate,
      0.02,
      1.2,
      OUROBOROS_BOREALIS_DEFAULTS.pitchGlissRate,
    ),
    rhythmGlissRate: clamp(
      params.rhythmGlissRate,
      0.02,
      1.2,
      OUROBOROS_BOREALIS_DEFAULTS.rhythmGlissRate,
    ),
    centerPitch: clamp(
      params.centerPitch,
      45,
      880,
      OUROBOROS_BOREALIS_DEFAULTS.centerPitch,
    ),
    centerRate: clamp(
      params.centerRate,
      0.5,
      16,
      OUROBOROS_BOREALIS_DEFAULTS.centerRate,
    ),
    pitchWidth: clamp(
      params.pitchWidth,
      3,
      9,
      OUROBOROS_BOREALIS_DEFAULTS.pitchWidth,
    ),
    rhythmWidth: clamp(
      params.rhythmWidth,
      3,
      9,
      OUROBOROS_BOREALIS_DEFAULTS.rhythmWidth,
    ),
    pitchInterval: clamp(
      params.pitchInterval,
      0.5,
      2,
      OUROBOROS_BOREALIS_DEFAULTS.pitchInterval,
    ),
    rhythmInterval: clamp(
      params.rhythmInterval,
      0.5,
      2,
      OUROBOROS_BOREALIS_DEFAULTS.rhythmInterval,
    ),
    phaseOffset: clamp(
      params.phaseOffset,
      0,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.phaseOffset,
    ),
    coupling: clamp(
      params.coupling,
      -1,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.coupling,
    ),
    couplingFocus: clamp(
      params.couplingFocus,
      0,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.couplingFocus,
    ),
    spread: clamp(params.spread, 0, 1, OUROBOROS_BOREALIS_DEFAULTS.spread),
    decay: clamp(params.decay, 0.02, 1.5, OUROBOROS_BOREALIS_DEFAULTS.decay),
    character: clamp(
      params.character,
      0,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.character,
    ),
    morphDepth: clamp(
      params.morphDepth,
      0,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.morphDepth,
    ),
    noiseMix: clamp(
      params.noiseMix,
      0,
      1,
      OUROBOROS_BOREALIS_DEFAULTS.noiseMix,
    ),
    cutoff: clamp(
      params.cutoff,
      800,
      18_000,
      OUROBOROS_BOREALIS_DEFAULTS.cutoff,
    ),
    level: clamp(params.level, 0, 0.82, OUROBOROS_BOREALIS_DEFAULTS.level),
  });
}

function cosineWindow(offset, width, fallbackWidth) {
  const safeWidth = clamp(width, 3, 9, fallbackWidth);
  const distance = Math.abs(Number(offset)) / (safeWidth * 0.5);
  if (!Number.isFinite(distance) || distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

export function ouroborosBorealisPitchWindow(octaveOffset, width) {
  return cosineWindow(
    octaveOffset,
    width,
    OUROBOROS_BOREALIS_DEFAULTS.pitchWidth,
  );
}

export function ouroborosBorealisRhythmWindow(octaveOffset, width) {
  return cosineWindow(
    octaveOffset,
    width,
    OUROBOROS_BOREALIS_DEFAULTS.rhythmWidth,
  );
}

export function ouroborosBorealisFrequencySafety(
  frequency,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const hz = Number(frequency);
  const rate = clamp(sampleRate, 8_000, 384_000, DEFAULT_SAMPLE_RATE);
  const highFull = rate * 0.36;
  const highCull = rate * 0.44;
  if (!Number.isFinite(hz) || hz <= 12 || hz >= highCull) return 0;
  if (hz < 20) {
    const phase = (hz - 12) / 8;
    return 0.5 - 0.5 * Math.cos(Math.PI * phase);
  }
  if (hz <= highFull) return 1;
  const phase = (hz - highFull) / (highCull - highFull);
  return 0.5 + 0.5 * Math.cos(Math.PI * phase);
}

export function ouroborosBorealisRateSafety(hitRate) {
  const rate = Number(hitRate);
  if (!Number.isFinite(rate) || rate <= MIN_HIT_RATE || rate >= MAX_HIT_RATE) {
    return 0;
  }
  if (rate < MIN_FULL_HIT_RATE) {
    const phase = (rate - MIN_HIT_RATE)
      / (MIN_FULL_HIT_RATE - MIN_HIT_RATE);
    return 0.5 - 0.5 * Math.cos(Math.PI * phase);
  }
  if (rate <= MAX_FULL_HIT_RATE) return 1;
  const phase = (rate - MAX_FULL_HIT_RATE)
    / (MAX_HIT_RATE - MAX_FULL_HIT_RATE);
  return 0.5 + 0.5 * Math.cos(Math.PI * phase);
}

export function advanceOuroborosBorealisPosition(position, delta) {
  const raw = wrapUnit(position) + (Number.isFinite(delta) ? delta : 0);
  return Object.freeze({
    position: wrapUnit(raw),
    wraps: Math.floor(raw),
  });
}

export function advanceOuroborosBorealisCoordinates(
  state = {},
  elapsedSeconds = 0,
  params = {},
) {
  const safe = sanitizeOuroborosBorealisParams(params);
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds)
    ? elapsedSeconds
    : 0);
  const pitchOctaveDelta = safe.pitchDirection * safe.pitchGlissRate * elapsed;
  const rhythmOctaveDelta = safe.rhythmDirection
    * safe.rhythmGlissRate
    * elapsed;
  const pitch = advanceOuroborosBorealisPosition(
    state.pitchPosition,
    pitchOctaveDelta / safe.pitchInterval,
  );
  const rhythm = advanceOuroborosBorealisPosition(
    state.rhythmPosition,
    rhythmOctaveDelta / safe.rhythmInterval,
  );
  return Object.freeze({
    pitchPosition: pitch.position,
    pitchWraps: pitch.wraps,
    rhythmPosition: rhythm.position,
    rhythmWraps: rhythm.wraps,
    pitchOctaveDelta,
    rhythmOctaveDelta,
  });
}

function rattleSigmoid(frequency, crossover) {
  const distance = Math.log2(frequency / crossover) / RATTLE_MORPH_WIDTH;
  return 1 / (1 + Math.exp(-4 * distance));
}

export function ouroborosBorealisMorphPosition(
  octaveOffset,
  width = OUROBOROS_BOREALIS_DEFAULTS.pitchWidth,
  character = OUROBOROS_BOREALIS_DEFAULTS.character,
  morphDepth = OUROBOROS_BOREALIS_DEFAULTS.morphDepth,
) {
  const safeWidth = clamp(width, 3, 9, OUROBOROS_BOREALIS_DEFAULTS.pitchWidth);
  const base = clamp(0.5 + Number(octaveOffset) / safeWidth, 0, 1, 0.5);
  const depth = clamp(morphDepth, 0, 1, OUROBOROS_BOREALIS_DEFAULTS.morphDepth);
  const bias = (
    clamp(character, 0, 1, OUROBOROS_BOREALIS_DEFAULTS.character) - 0.5
  ) * 0.36;
  return clamp(0.5 + (base - 0.5) * depth + bias, 0, 1, 0.5);
}

export function ouroborosBorealisMorphWeights(morphPosition) {
  const position = clamp(morphPosition, 0, 1, 0.5);
  const frequency = RATTLE_RANGE_MIN * 2 ** (
    RATTLE_RANGE_OCTAVES * position
  );
  const kickToTom = rattleSigmoid(frequency, RATTLE_CROSSOVERS[0]);
  const tomToHand = rattleSigmoid(frequency, RATTLE_CROSSOVERS[1]);
  const handToAir = rattleSigmoid(frequency, RATTLE_CROSSOVERS[2]);
  return Object.freeze({
    kick: 1 - kickToTom,
    tom: kickToTom * (1 - tomToHand),
    hand: kickToTom * tomToHand * (1 - handToAir),
    air: kickToTom * tomToHand * handToAir,
  });
}

export function ouroborosBorealisCharacterLabel(weights = {}) {
  let label = "kick";
  let strongest = Number(weights.kick) || 0;
  for (const candidate of ["tom", "hand", "air"]) {
    const amount = Number(weights[candidate]) || 0;
    if (amount > strongest) {
      label = candidate;
      strongest = amount;
    }
  }
  return label;
}

/**
 * Routes one tempo lane into the pitch bank without creating tempo×pitch
 * resonator state. At zero coupling every pitch layer receives the strike;
 * positive coupling pairs fast/high, while negative coupling pairs fast/low.
 */
export function ouroborosBorealisCouplingWeight(
  pitchNormalized,
  rhythmNormalized,
  coupling = OUROBOROS_BOREALIS_DEFAULTS.coupling,
  couplingFocus = OUROBOROS_BOREALIS_DEFAULTS.couplingFocus,
) {
  const pitch = clamp(pitchNormalized, -1, 1, 0);
  const rhythm = clamp(rhythmNormalized, -1, 1, 0);
  const relation = clamp(coupling, -1, 1, 0);
  const strength = Math.abs(relation);
  if (strength <= 1e-9) return 1;
  const target = relation < 0 ? -rhythm : rhythm;
  // The control reads broad → tight: zero spans the whole normalized bank,
  // while one retains a soft minimum neighborhood rather than becoming a
  // brittle single-layer switch.
  const focus = clamp(couplingFocus, 0, 1, 0.5);
  const width = Math.max(0.15, 1 - focus * 0.85) * 2;
  const distance = Math.abs(pitch - target) / width;
  const focused = distance < 1
    ? 0.5 + 0.5 * Math.cos(Math.PI * distance)
    : 0;
  return (1 - strength) + strength * focused;
}

export function ouroborosBorealisStrikeWeight(
  octaveOffset,
  position = null,
  pitchWidth = OUROBOROS_BOREALIS_DEFAULTS.pitchWidth,
  pitchInterval = OUROBOROS_BOREALIS_DEFAULTS.pitchInterval,
) {
  if (position === null || position === undefined) return 1;
  const numericPosition = Number(position);
  if (!Number.isFinite(numericPosition)) return 1;
  const safeWidth = clamp(
    pitchWidth,
    3,
    9,
    OUROBOROS_BOREALIS_DEFAULTS.pitchWidth,
  );
  const safeInterval = clamp(
    pitchInterval,
    0.5,
    2,
    OUROBOROS_BOREALIS_DEFAULTS.pitchInterval,
  );
  const targetOffset = (clamp(numericPosition, 0, 1, 0.5) - 0.5)
    * safeWidth
    * 0.88;
  const distance = Math.abs(Number(octaveOffset) - targetOffset)
    / (safeInterval * 1.15);
  if (!Number.isFinite(distance) || distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

function weightedRattleValue(values, kick, tom, hand, air) {
  return values[0] * kick
    + values[1] * tom
    + values[2] * hand
    + values[3] * air;
}

function buildPitchLayer(index, center, phase, safe, sampleRate) {
  const coordinate = -center + phase + index;
  const octaveOffset = coordinate * safe.pitchInterval;
  const fundamentalHz = safe.centerPitch * 2 ** octaveOffset;
  const window = ouroborosBorealisPitchWindow(octaveOffset, safe.pitchWidth);
  const safety = ouroborosBorealisFrequencySafety(fundamentalHz, sampleRate);
  const weight = window * safety;
  const normalizedPosition = clamp(
    octaveOffset / Math.max(1.5, safe.pitchWidth * 0.5),
    -1,
    1,
    0,
  );
  const morphPosition = ouroborosBorealisMorphPosition(
    octaveOffset,
    safe.pitchWidth,
    safe.character,
    safe.morphDepth,
  );
  const morphWeights = ouroborosBorealisMorphWeights(morphPosition);
  const modalRatios = [];
  const modalGains = [];
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    const ratio = Math.max(1, weightedRattleValue(
      [
        RATTLE_RATIOS[0][mode],
        RATTLE_RATIOS[1][mode],
        RATTLE_RATIOS[2][mode],
        RATTLE_RATIOS[3][mode],
      ],
      morphWeights.kick,
      morphWeights.tom,
      morphWeights.hand,
      morphWeights.air,
    ));
    const rawGain = weightedRattleValue(
      [
        RATTLE_GAINS[0][mode],
        RATTLE_GAINS[1][mode],
        RATTLE_GAINS[2][mode],
        RATTLE_GAINS[3][mode],
      ],
      morphWeights.kick,
      morphWeights.tom,
      morphWeights.hand,
      morphWeights.air,
    );
    modalRatios.push(ratio);
    modalGains.push(
      rawGain * ouroborosBorealisFrequencySafety(
        fundamentalHz * ratio,
        sampleRate,
      ),
    );
  }
  return {
    index,
    coordinate,
    octaveOffset,
    normalizedPosition,
    window,
    safety,
    weight,
    pan: normalizedPosition * safe.spread,
    morphPosition,
    morphWeights,
    characterLabel: ouroborosBorealisCharacterLabel(morphWeights),
    fundamentalHz,
    sourceHz: fundamentalHz,
    modalRatios: Object.freeze(modalRatios),
    modalGains: Object.freeze(modalGains),
    active: weight > 1e-9,
  };
}

function buildRhythmLayer(index, center, phase, safe) {
  const coordinate = -center + phase + index;
  const octaveOffset = coordinate * safe.rhythmInterval;
  const hitRate = safe.centerRate * 2 ** octaveOffset;
  const window = ouroborosBorealisRhythmWindow(octaveOffset, safe.rhythmWidth);
  const safety = ouroborosBorealisRateSafety(hitRate);
  const weight = window * safety;
  const normalizedPosition = clamp(
    octaveOffset / Math.max(1.5, safe.rhythmWidth * 0.5),
    -1,
    1,
    0,
  );
  return {
    index,
    coordinate,
    octaveOffset,
    normalizedPosition,
    hitRate,
    rate: hitRate,
    bpm: hitRate * 60,
    window,
    safety,
    weight,
    gain: 0,
    pan: normalizedPosition * safe.spread,
    pulsePhase: wrapUnit(
      OUROBOROS_BOREALIS_PHASE_SEED
        * (2 ** (coordinate * safe.rhythmInterval))
        + safe.phaseOffset,
    ),
    active: weight > 1e-9,
  };
}

export function calculateOuroborosBorealisFrame({
  pitchPosition = 0,
  rhythmPosition = 0,
  sampleRate = DEFAULT_SAMPLE_RATE,
  pitchLayerCount = PITCH_LAYER_COUNT,
  rhythmLayerCount = RHYTHM_LAYER_COUNT,
  ...params
} = {}) {
  const safe = sanitizeOuroborosBorealisParams(params);
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    384_000,
    DEFAULT_SAMPLE_RATE,
  );
  const pitchCount = Math.max(5, Math.round(clamp(
    pitchLayerCount,
    5,
    41,
    PITCH_LAYER_COUNT,
  )));
  const rhythmCount = Math.max(5, Math.round(clamp(
    rhythmLayerCount,
    5,
    41,
    RHYTHM_LAYER_COUNT,
  )));
  const safePitchPosition = wrapUnit(pitchPosition);
  const safeRhythmPosition = wrapUnit(rhythmPosition);
  const pitchLayers = [];
  const rhythmLayers = [];
  let pitchWeightPower = 0;
  let rhythmWeightPower = 0;
  let pitchActiveLayers = 0;
  let rhythmActiveLayers = 0;
  let totalHitRate = 0;

  for (let index = 0; index < pitchCount; index += 1) {
    const layer = buildPitchLayer(
      index,
      Math.floor(pitchCount / 2),
      safePitchPosition,
      safe,
      safeSampleRate,
    );
    pitchWeightPower += layer.weight * layer.weight;
    if (layer.active) pitchActiveLayers += 1;
    pitchLayers.push(layer);
  }
  for (let index = 0; index < rhythmCount; index += 1) {
    const layer = buildRhythmLayer(
      index,
      Math.floor(rhythmCount / 2),
      safeRhythmPosition,
      safe,
    );
    rhythmWeightPower += layer.weight * layer.weight;
    if (layer.active) {
      rhythmActiveLayers += 1;
      totalHitRate += layer.hitRate;
    }
    rhythmLayers.push(layer);
  }

  const pitchNormalization = pitchWeightPower > 1e-12
    ? 1 / Math.sqrt(pitchWeightPower)
    : 0;
  const rhythmNormalization = rhythmWeightPower > 1e-12
    ? 1 / Math.sqrt(rhythmWeightPower)
    : 0;
  const frozenPitchLayers = pitchLayers.map((layer) => Object.freeze({
    ...layer,
    gain: layer.weight * pitchNormalization / Math.sqrt(
      1 + safe.centerRate * safe.decay * 0.38,
    ),
  }));
  const frozenRhythmLayers = rhythmLayers.map((layer) => Object.freeze({
    ...layer,
    gain: layer.weight * rhythmNormalization / Math.sqrt(
      1 + layer.hitRate * safe.decay * 0.7,
    ),
  }));

  return Object.freeze({
    pitchPosition: safePitchPosition,
    rhythmPosition: safeRhythmPosition,
    pitchDirection: safe.pitchDirection,
    rhythmDirection: safe.rhythmDirection,
    pitchInterval: safe.pitchInterval,
    rhythmInterval: safe.rhythmInterval,
    pitchRatio: 2 ** safe.pitchInterval,
    rhythmRatio: 2 ** safe.rhythmInterval,
    pitchLayers: Object.freeze(frozenPitchLayers),
    rhythmLayers: Object.freeze(frozenRhythmLayers),
    pitchActiveLayers,
    rhythmActiveLayers,
    activePitchCount: pitchActiveLayers,
    activeRhythmCount: rhythmActiveLayers,
    activePitchLayers: pitchActiveLayers,
    activeRhythmLayers: rhythmActiveLayers,
    totalHitRate,
    pitchWeightPower,
    rhythmWeightPower,
    pitchNormalization,
    rhythmNormalization,
    phaseOffset: safe.phaseOffset,
    coupling: safe.coupling,
    couplingFocus: safe.couplingFocus,
  });
}

export function createOuroborosBorealisSoftCeilingCurve(
  length = 2_049,
  drive = 1.45,
  ceiling = 0.92,
) {
  const size = Math.max(33, Math.round(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.5, 4, 1.45);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.92);
  const scale = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * safeDrive) / scale * safeCeiling;
  }
  return curve;
}

function advanceNoiseSeed(value) {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) || 0x9e3779b9;
}

function clearPitchVoice(processor, layer) {
  processor.slowEnvelopes[layer] = 0;
  processor.fastEnvelopes[layer] = 0;
  processor.pitchBends[layer] = 0;
  processor.bodyNoiseLow[layer] = 0;
  processor.bodyNoiseHigh[layer] = 0;
  processor.airNoiseLow[layer] = 0;
  processor.noiseSeedCounter = advanceNoiseSeed(processor.noiseSeedCounter);
  processor.noiseSeeds[layer] = processor.noiseSeedCounter;
  const base = layer * MODE_COUNT;
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    processor.modalRe[base + mode] = 0;
    processor.modalIm[base + mode] = 0;
  }
}

function copyPitchVoice(processor, destination, source) {
  processor.slowEnvelopes[destination] = processor.slowEnvelopes[source];
  processor.fastEnvelopes[destination] = processor.fastEnvelopes[source];
  processor.pitchBends[destination] = processor.pitchBends[source];
  processor.bodyNoiseLow[destination] = processor.bodyNoiseLow[source];
  processor.bodyNoiseHigh[destination] = processor.bodyNoiseHigh[source];
  processor.airNoiseLow[destination] = processor.airNoiseLow[source];
  processor.noiseSeeds[destination] = processor.noiseSeeds[source];
  const destinationBase = destination * MODE_COUNT;
  const sourceBase = source * MODE_COUNT;
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    processor.modalRe[destinationBase + mode] = processor.modalRe[
      sourceBase + mode
    ];
    processor.modalIm[destinationBase + mode] = processor.modalIm[
      sourceBase + mode
    ];
  }
}

function rotatePitchStateUp(processor) {
  for (let index = PITCH_LAYER_COUNT - 1; index > 0; index -= 1) {
    copyPitchVoice(processor, index, index - 1);
  }
  clearPitchVoice(processor, 0);
}

function rotatePitchStateDown(processor) {
  const last = PITCH_LAYER_COUNT - 1;
  for (let index = 0; index < last; index += 1) {
    copyPitchVoice(processor, index, index + 1);
  }
  clearPitchVoice(processor, last);
}

function rotatePitchForWraps(processor, wraps) {
  if (wraps > 0) {
    for (let count = 0; count < wraps; count += 1) {
      rotatePitchStateUp(processor);
    }
  } else if (wraps < 0) {
    for (let count = 0; count > wraps; count -= 1) {
      rotatePitchStateDown(processor);
    }
  }
}

function rotateRhythmStateUp(processor) {
  for (let index = RHYTHM_LAYER_COUNT - 1; index > 0; index -= 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index - 1];
  }
  const ratio = 2 ** processor.current.rhythmInterval;
  processor.pulsePhases[0] = wrapUnit(
    (processor.pulsePhases[1] - processor.appliedPhaseOffset) / ratio
      + processor.appliedPhaseOffset,
  );
}

function rotateRhythmStateDown(processor) {
  const last = RHYTHM_LAYER_COUNT - 1;
  for (let index = 0; index < last; index += 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index + 1];
  }
  const ratio = 2 ** processor.current.rhythmInterval;
  processor.pulsePhases[last] = wrapUnit(
    (processor.pulsePhases[last - 1] - processor.appliedPhaseOffset) * ratio
      + processor.appliedPhaseOffset,
  );
}

function rotateRhythmForWraps(processor, wraps) {
  if (wraps > 0) {
    for (let count = 0; count < wraps; count += 1) {
      rotateRhythmStateUp(processor);
    }
  } else if (wraps < 0) {
    for (let count = 0; count > wraps; count -= 1) {
      rotateRhythmStateDown(processor);
    }
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidOuroborosBorealisProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeOuroborosBorealisParams(
        options.processorOptions ?? {},
      );
      this.target = { ...initial };
      this.current = { ...initial };
      this.pitchPosition = wrapUnit(OUROBOROS_BOREALIS_PHASE_SEED);
      this.rhythmPosition = wrapUnit(OUROBOROS_BOREALIS_PHASE_SEED);
      this.appliedPhaseOffset = initial.phaseOffset;
      this.pendingStrike = 0;
      this.pendingStrikePosition = Number.NaN;
      this.pulsePhases = new Float64Array(RHYTHM_LAYER_COUNT);
      this.pitchExcitations = new Float64Array(PITCH_LAYER_COUNT);
      this.slowEnvelopes = new Float64Array(PITCH_LAYER_COUNT);
      this.fastEnvelopes = new Float64Array(PITCH_LAYER_COUNT);
      this.pitchBends = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyNoiseLow = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyNoiseHigh = new Float64Array(PITCH_LAYER_COUNT);
      this.airNoiseLow = new Float64Array(PITCH_LAYER_COUNT);
      this.noiseSeeds = new Uint32Array(PITCH_LAYER_COUNT);
      this.modalRe = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.modalIm = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.modalCos = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.modalSin = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.modalDecay = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.modalGain = new Float64Array(PITCH_LAYER_COUNT * MODE_COUNT);
      this.morphPositions = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyDecays = new Float64Array(PITCH_LAYER_COUNT);
      this.highDampings = new Float64Array(PITCH_LAYER_COUNT);
      this.pitchDrops = new Float64Array(PITCH_LAYER_COUNT);
      this.pitchBendDecays = new Float64Array(PITCH_LAYER_COUNT);
      this.noiseMixes = new Float64Array(PITCH_LAYER_COUNT);
      this.noiseColors = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyMixes = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyNoiseLowCoefficients = new Float64Array(PITCH_LAYER_COUNT);
      this.bodyNoiseHighCoefficients = new Float64Array(PITCH_LAYER_COUNT);
      this.airNoiseCoefficients = new Float64Array(PITCH_LAYER_COUNT);
      this.impactSlowDecays = new Float64Array(PITCH_LAYER_COUNT);
      this.noiseSeedCounter = 0x6d2b79f5;
      for (let index = 0; index < RHYTHM_LAYER_COUNT; index += 1) {
        const coordinate = -RHYTHM_LAYER_CENTER
          + this.rhythmPosition
          + index;
        this.pulsePhases[index] = wrapUnit(
          OUROBOROS_BOREALIS_PHASE_SEED
            * (2 ** (coordinate * initial.rhythmInterval))
            + initial.phaseOffset,
        );
      }
      for (let index = 0; index < PITCH_LAYER_COUNT; index += 1) {
        this.noiseSeedCounter = advanceNoiseSeed(this.noiseSeedCounter);
        this.noiseSeeds[index] = this.noiseSeedCounter;
      }
      this.audibleTarget = 0;
      this.transportTarget = 0;
      this.activeGain = 0;
      this.updateVoiceCoefficients(DEFAULT_SAMPLE_RATE);
      this.port.onmessage = (event) => {
        if (event.data?.type === "parameters") {
          this.target = {
            ...this.target,
            ...sanitizeOuroborosBorealisParams({
              ...this.target,
              ...event.data.parameters,
            }),
          };
          if (this.audibleTarget < 0.5) this.snapCurrentToTarget();
        } else if (event.data?.type === "active") {
          const active = event.data.value ? 1 : 0;
          this.audibleTarget = active;
          this.transportTarget = active;
          if (this.audibleTarget < 0.5) this.snapCurrentToTarget();
        } else if (event.data?.type === "audible") {
          this.audibleTarget = event.data.value ? 1 : 0;
          if (this.audibleTarget < 0.5) this.snapCurrentToTarget();
        } else if (event.data?.type === "transport") {
          this.transportTarget = event.data.value ? 1 : 0;
        } else if (event.data?.type === "strike") {
          this.pendingStrike = Math.min(
            1,
            this.pendingStrike + clamp(event.data.velocity, 0, 1, 1),
          );
          const position = Number(event.data.position);
          this.pendingStrikePosition = event.data.position !== null
            && event.data.position !== undefined
            && Number.isFinite(position)
            ? clamp(position, 0, 1, 0.5)
            : Number.NaN;
        }
      };
    }

    applyPhaseOffsetDelta(delta) {
      if (!Number.isFinite(delta) || Math.abs(delta) < 1e-15) return;
      for (let index = 0; index < RHYTHM_LAYER_COUNT; index += 1) {
        this.pulsePhases[index] = wrapUnit(this.pulsePhases[index] + delta);
      }
      this.appliedPhaseOffset = wrapUnit(this.appliedPhaseOffset + delta);
    }

    snapCurrentToTarget() {
      this.applyPhaseOffsetDelta(
        this.target.phaseOffset - this.appliedPhaseOffset,
      );
      this.current.pitchDirection = this.target.pitchDirection;
      this.current.rhythmDirection = this.target.rhythmDirection;
      this.current.pitchGlissRate = this.target.pitchGlissRate;
      this.current.rhythmGlissRate = this.target.rhythmGlissRate;
      this.current.centerPitch = this.target.centerPitch;
      this.current.centerRate = this.target.centerRate;
      this.current.pitchWidth = this.target.pitchWidth;
      this.current.rhythmWidth = this.target.rhythmWidth;
      this.current.pitchInterval = this.target.pitchInterval;
      this.current.rhythmInterval = this.target.rhythmInterval;
      this.current.phaseOffset = this.target.phaseOffset;
      this.current.coupling = this.target.coupling;
      this.current.couplingFocus = this.target.couplingFocus;
      this.current.spread = this.target.spread;
      this.current.decay = this.target.decay;
      this.current.character = this.target.character;
      this.current.morphDepth = this.target.morphDepth;
      this.current.noiseMix = this.target.noiseMix;
      this.current.cutoff = this.target.cutoff;
      this.current.level = this.target.level;
      this.appliedPhaseOffset = this.target.phaseOffset;
      this.updateVoiceCoefficients(
        Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
      );
    }

    updateVoiceCoefficients(workletSampleRate) {
      const safeWidth = Math.max(3, this.current.pitchWidth);
      const firstCoordinate = -PITCH_LAYER_CENTER + this.pitchPosition;
      const decayScale = Math.max(0.02, this.current.decay) / 0.76;
      const nyquistTaper = workletSampleRate * 0.36;
      const nyquistCull = workletSampleRate * 0.44;

      for (let layer = 0; layer < PITCH_LAYER_COUNT; layer += 1) {
        const octaveOffset = (firstCoordinate + layer)
          * this.current.pitchInterval;
        const basePosition = Math.max(
          0,
          Math.min(1, 0.5 + octaveOffset / safeWidth),
        );
        const morphPosition = Math.max(0, Math.min(1,
          0.5
          + (basePosition - 0.5) * this.current.morphDepth
          + (this.current.character - 0.5) * 0.36
        ));
        const morphFrequency = RATTLE_RANGE_MIN * 2 ** (
          RATTLE_RANGE_OCTAVES * morphPosition
        );
        const kickToTom = rattleSigmoid(
          morphFrequency,
          RATTLE_CROSSOVERS[0],
        );
        const tomToHand = rattleSigmoid(
          morphFrequency,
          RATTLE_CROSSOVERS[1],
        );
        const handToAir = rattleSigmoid(
          morphFrequency,
          RATTLE_CROSSOVERS[2],
        );
        const kick = 1 - kickToTom;
        const tom = kickToTom * (1 - tomToHand);
        const hand = kickToTom * tomToHand * (1 - handToAir);
        const air = kickToTom * tomToHand * handToAir;
        this.morphPositions[layer] = morphPosition;

        const bodyDecay = Math.max(0.018, weightedRattleValue(
          RATTLE_DECAYS,
          kick,
          tom,
          hand,
          air,
        ) * decayScale);
        const highDamping = weightedRattleValue(
          RATTLE_HIGH_DAMPING,
          kick,
          tom,
          hand,
          air,
        );
        const pitchDrop = weightedRattleValue(
          RATTLE_PITCH_DROPS,
          kick,
          tom,
          hand,
          air,
        ) * 0.55;
        const pitchDropTime = weightedRattleValue(
          RATTLE_PITCH_DROP_TIMES,
          kick,
          tom,
          hand,
          air,
        );
        const noiseMix = weightedRattleValue(
          RATTLE_NOISE_MIXES,
          kick,
          tom,
          hand,
          air,
        ) * this.current.noiseMix;
        const noiseDecay = weightedRattleValue(
          RATTLE_NOISE_DECAYS,
          kick,
          tom,
          hand,
          air,
        );
        const noiseColor = weightedRattleValue(
          RATTLE_NOISE_COLORS,
          kick,
          tom,
          hand,
          air,
        );
        const hardness = weightedRattleValue(
          RATTLE_HARDNESSES,
          kick,
          tom,
          hand,
          air,
        );
        this.bodyDecays[layer] = bodyDecay;
        this.highDampings[layer] = highDamping;
        this.pitchDrops[layer] = pitchDrop;
        this.pitchBendDecays[layer] = Math.exp(
          -1 / (workletSampleRate * Math.max(0.008, pitchDropTime)),
        );
        this.noiseMixes[layer] = noiseMix;
        this.noiseColors[layer] = noiseColor;
        this.bodyMixes[layer] = weightedRattleValue(
          RATTLE_BODY_MIXES,
          kick,
          tom,
          hand,
          air,
        );
        this.impactSlowDecays[layer] = Math.exp(
          -1 / (workletSampleRate * Math.max(0.009, noiseDecay)),
        );

        const fundamental = this.current.centerPitch * 2 ** (
          octaveOffset + this.pitchBends[layer]
        );
        const bodyNoiseCenter = Math.max(
          95,
          Math.min(
            workletSampleRate * 0.34,
            fundamental * (5.5 + (2.1 - 5.5) * noiseColor),
          ),
        );
        const bodyNoiseLow = Math.max(55, bodyNoiseCenter / 1.85);
        const bodyNoiseHigh = Math.min(
          workletSampleRate * 0.42,
          bodyNoiseCenter * 1.85,
        );
        const airCutoff = Math.min(
          workletSampleRate * 0.4,
          650 + (8_500 - 650) * noiseColor ** 1.45,
        );
        this.bodyNoiseLowCoefficients[layer] = 1 - Math.exp(
          -TAU * bodyNoiseLow / workletSampleRate,
        );
        this.bodyNoiseHighCoefficients[layer] = 1 - Math.exp(
          -TAU * bodyNoiseHigh / workletSampleRate,
        );
        this.airNoiseCoefficients[layer] = 1 - Math.exp(
          -TAU * airCutoff / workletSampleRate,
        );

        const modeBase = layer * MODE_COUNT;
        let gainTotal = 0;
        for (let mode = 0; mode < MODE_COUNT; mode += 1) {
          const ratio = Math.max(1,
            RATTLE_RATIOS[0][mode] * kick
            + RATTLE_RATIOS[1][mode] * tom
            + RATTLE_RATIOS[2][mode] * hand
            + RATTLE_RATIOS[3][mode] * air
          );
          const rawGain = RATTLE_GAINS[0][mode] * kick
            + RATTLE_GAINS[1][mode] * tom
            + RATTLE_GAINS[2][mode] * hand
            + RATTLE_GAINS[3][mode] * air;
          const modeFrequency = Math.max(18, fundamental * ratio);
          let aliasFade = 1;
          if (modeFrequency >= nyquistCull) aliasFade = 0;
          else if (modeFrequency > nyquistTaper) {
            const aliasPosition = (modeFrequency - nyquistTaper)
              / (nyquistCull - nyquistTaper);
            aliasFade = 0.5 + 0.5 * Math.cos(Math.PI * aliasPosition);
          }
          const stateIndex = modeBase + mode;
          const radians = TAU
            * Math.min(nyquistCull, modeFrequency)
            / workletSampleRate;
          this.modalCos[stateIndex] = Math.cos(radians);
          this.modalSin[stateIndex] = Math.sin(radians);
          this.modalDecay[stateIndex] = Math.exp(-1 / (
            workletSampleRate
            * Math.max(0.012, bodyDecay / (1 + mode * highDamping * 0.42))
          ));
          const gain = rawGain
            * (1 + mode * hardness * 0.055)
            * aliasFade;
          this.modalGain[stateIndex] = gain;
          gainTotal += gain;
        }
        if (gainTotal > 1e-12) {
          for (let mode = 0; mode < MODE_COUNT; mode += 1) {
            this.modalGain[modeBase + mode] /= gainTotal;
          }
        }
      }
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const left = output[0];
      const right = output[1] ?? left;
      left.fill(0);
      if (right !== left) right.fill(0);

      const workletSampleRate = Number(globalThis.sampleRate)
        || DEFAULT_SAMPLE_RATE;
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.035));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.01));
      const attackDecay = Math.exp(-1 / (workletSampleRate * 0.0011));
      const outputScale = 0.34;
      this.updateVoiceCoefficients(workletSampleRate);

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.current.pitchDirection += (
          this.target.pitchDirection - this.current.pitchDirection
        ) * parameterSlew;
        this.current.rhythmDirection += (
          this.target.rhythmDirection - this.current.rhythmDirection
        ) * parameterSlew;
        this.current.pitchGlissRate += (
          this.target.pitchGlissRate - this.current.pitchGlissRate
        ) * parameterSlew;
        this.current.rhythmGlissRate += (
          this.target.rhythmGlissRate - this.current.rhythmGlissRate
        ) * parameterSlew;
        this.current.centerPitch += (
          this.target.centerPitch - this.current.centerPitch
        ) * parameterSlew;
        this.current.centerRate += (
          this.target.centerRate - this.current.centerRate
        ) * parameterSlew;
        this.current.pitchWidth += (
          this.target.pitchWidth - this.current.pitchWidth
        ) * parameterSlew;
        this.current.rhythmWidth += (
          this.target.rhythmWidth - this.current.rhythmWidth
        ) * parameterSlew;
        this.current.pitchInterval += (
          this.target.pitchInterval - this.current.pitchInterval
        ) * parameterSlew;
        this.current.rhythmInterval += (
          this.target.rhythmInterval - this.current.rhythmInterval
        ) * parameterSlew;
        const previousPhaseOffset = this.current.phaseOffset;
        this.current.phaseOffset += (
          this.target.phaseOffset - this.current.phaseOffset
        ) * parameterSlew;
        this.applyPhaseOffsetDelta(
          this.current.phaseOffset - previousPhaseOffset,
        );
        this.current.coupling += (
          this.target.coupling - this.current.coupling
        ) * parameterSlew;
        this.current.couplingFocus += (
          this.target.couplingFocus - this.current.couplingFocus
        ) * parameterSlew;
        this.current.spread += (
          this.target.spread - this.current.spread
        ) * parameterSlew;
        this.current.decay += (
          this.target.decay - this.current.decay
        ) * parameterSlew;
        this.current.character += (
          this.target.character - this.current.character
        ) * parameterSlew;
        this.current.morphDepth += (
          this.target.morphDepth - this.current.morphDepth
        ) * parameterSlew;
        this.current.noiseMix += (
          this.target.noiseMix - this.current.noiseMix
        ) * parameterSlew;
        this.activeGain += (
          this.audibleTarget - this.activeGain
        ) * activeSlew;

        const transportActive = this.transportTarget > 0.5;
        if (transportActive) {
          const rawPitchPosition = this.pitchPosition + (
            this.current.pitchDirection
            * this.current.pitchGlissRate
            / Math.max(0.5, this.current.pitchInterval)
            / workletSampleRate
          );
          const pitchWraps = Math.floor(rawPitchPosition);
          this.pitchPosition = wrapUnit(rawPitchPosition);
          if (pitchWraps !== 0) {
            rotatePitchForWraps(this, pitchWraps);
            this.updateVoiceCoefficients(workletSampleRate);
          }

          const rawRhythmPosition = this.rhythmPosition + (
            this.current.rhythmDirection
            * this.current.rhythmGlissRate
            / Math.max(0.5, this.current.rhythmInterval)
            / workletSampleRate
          );
          const rhythmWraps = Math.floor(rawRhythmPosition);
          this.rhythmPosition = wrapUnit(rawRhythmPosition);
          if (rhythmWraps !== 0) rotateRhythmForWraps(this, rhythmWraps);
        }

        this.pitchExcitations.fill(0);
        const manualStrike = this.pendingStrike;
        const manualPosition = this.pendingStrikePosition;
        this.pendingStrike = 0;
        this.pendingStrikePosition = Number.NaN;

        const rhythmHalfWidth = Math.max(
          1.5,
          this.current.rhythmWidth * 0.5,
        );
        const rhythmFirstCoordinate = -RHYTHM_LAYER_CENTER
          + this.rhythmPosition;
        let rhythmOffset = rhythmFirstCoordinate
          * this.current.rhythmInterval;
        let hitRate = this.current.centerRate * 2 ** rhythmOffset;
        const rhythmRatio = 2 ** this.current.rhythmInterval;
        let rhythmWeightPower = 0;
        for (let index = 0; index < RHYTHM_LAYER_COUNT; index += 1) {
          const distance = Math.abs(rhythmOffset) / rhythmHalfWidth;
          if (distance < 1) {
            let safety = 0;
            if (hitRate > MIN_HIT_RATE && hitRate < MIN_FULL_HIT_RATE) {
              const safetyPosition = (hitRate - MIN_HIT_RATE)
                / (MIN_FULL_HIT_RATE - MIN_HIT_RATE);
              safety = 0.5 - 0.5 * Math.cos(Math.PI * safetyPosition);
            } else if (
              hitRate >= MIN_FULL_HIT_RATE
              && hitRate <= MAX_FULL_HIT_RATE
            ) {
              safety = 1;
            } else if (
              hitRate > MAX_FULL_HIT_RATE
              && hitRate < MAX_HIT_RATE
            ) {
              const safetyPosition = (hitRate - MAX_FULL_HIT_RATE)
                / (MAX_HIT_RATE - MAX_FULL_HIT_RATE);
              safety = 0.5 + 0.5 * Math.cos(Math.PI * safetyPosition);
            }
            const window = 0.5 + 0.5 * Math.cos(Math.PI * distance);
            const weight = window * safety;
            rhythmWeightPower += weight * weight;
          }
          rhythmOffset += this.current.rhythmInterval;
          hitRate *= rhythmRatio;
        }
        const rhythmNormalization = rhythmWeightPower > 1e-12
          ? 1 / Math.sqrt(rhythmWeightPower)
          : 0;

        rhythmOffset = rhythmFirstCoordinate * this.current.rhythmInterval;
        hitRate = this.current.centerRate * 2 ** rhythmOffset;
        for (let rhythmIndex = 0;
          rhythmIndex < RHYTHM_LAYER_COUNT;
          rhythmIndex += 1
        ) {
          const distance = Math.abs(rhythmOffset) / rhythmHalfWidth;
          let rhythmWeight = 0;
          if (distance < 1) {
            let safety = 0;
            if (hitRate > MIN_HIT_RATE && hitRate < MIN_FULL_HIT_RATE) {
              const safetyPosition = (hitRate - MIN_HIT_RATE)
                / (MIN_FULL_HIT_RATE - MIN_HIT_RATE);
              safety = 0.5 - 0.5 * Math.cos(Math.PI * safetyPosition);
            } else if (
              hitRate >= MIN_FULL_HIT_RATE
              && hitRate <= MAX_FULL_HIT_RATE
            ) {
              safety = 1;
            } else if (
              hitRate > MAX_FULL_HIT_RATE
              && hitRate < MAX_HIT_RATE
            ) {
              const safetyPosition = (hitRate - MAX_FULL_HIT_RATE)
                / (MAX_HIT_RATE - MAX_FULL_HIT_RATE);
              safety = 0.5 + 0.5 * Math.cos(Math.PI * safetyPosition);
            }
            rhythmWeight = (
              0.5 + 0.5 * Math.cos(Math.PI * distance)
            ) * safety;
          }

          let strikes = 0;
          if (transportActive) {
            const nextPhase = this.pulsePhases[rhythmIndex]
              + hitRate / workletSampleRate;
            strikes = Math.floor(nextPhase);
            this.pulsePhases[rhythmIndex] = nextPhase - strikes;
          }
          if (strikes > 0 && rhythmWeight > 1e-7) {
            const rhythmVelocity = Math.min(1, strikes)
              * rhythmWeight
              * rhythmNormalization
              / Math.sqrt(1 + hitRate * this.current.decay * 0.7);
            const rhythmNormalized = Math.max(
              -1,
              Math.min(1, rhythmOffset / rhythmHalfWidth),
            );
            const pitchHalfWidth = Math.max(
              1.5,
              this.current.pitchWidth * 0.5,
            );
            let pitchOffset = (
              -PITCH_LAYER_CENTER + this.pitchPosition
            ) * this.current.pitchInterval;
            for (let pitchIndex = 0;
              pitchIndex < PITCH_LAYER_COUNT;
              pitchIndex += 1
            ) {
              const pitchNormalized = Math.max(
                -1,
                Math.min(1, pitchOffset / pitchHalfWidth),
              );
              const routeWeight = ouroborosBorealisCouplingWeight(
                pitchNormalized,
                rhythmNormalized,
                this.current.coupling,
                this.current.couplingFocus,
              );
              this.pitchExcitations[pitchIndex] = Math.min(
                2.5,
                this.pitchExcitations[pitchIndex]
                  + rhythmVelocity * routeWeight,
              );
              pitchOffset += this.current.pitchInterval;
            }
          }
          rhythmOffset += this.current.rhythmInterval;
          hitRate *= rhythmRatio;
        }

        if (manualStrike > 0) {
          let pitchOffset = (
            -PITCH_LAYER_CENTER + this.pitchPosition
          ) * this.current.pitchInterval;
          for (let pitchIndex = 0;
            pitchIndex < PITCH_LAYER_COUNT;
            pitchIndex += 1
          ) {
            const strikeWeight = ouroborosBorealisStrikeWeight(
              pitchOffset,
              Number.isFinite(manualPosition) ? manualPosition : null,
              this.current.pitchWidth,
              this.current.pitchInterval,
            );
            this.pitchExcitations[pitchIndex] = Math.min(
              2.5,
              this.pitchExcitations[pitchIndex]
                + manualStrike * strikeWeight,
            );
            pitchOffset += this.current.pitchInterval;
          }
        }

        const pitchHalfWidth = Math.max(1.5, this.current.pitchWidth * 0.5);
        const pitchFirstCoordinate = -PITCH_LAYER_CENTER
          + this.pitchPosition;
        let pitchOffset = pitchFirstCoordinate * this.current.pitchInterval;
        let fundamental = this.current.centerPitch * 2 ** pitchOffset;
        const pitchRatio = 2 ** this.current.pitchInterval;
        let leftSample = 0;
        let rightSample = 0;
        let pitchWeightPower = 0;

        for (let index = 0; index < PITCH_LAYER_COUNT; index += 1) {
          const distance = Math.abs(pitchOffset) / pitchHalfWidth;
          let pitchWeight = 0;
          if (distance < 1) {
            let safety = 0;
            if (fundamental > 12 && fundamental < 20) {
              const safetyPosition = (fundamental - 12) / 8;
              safety = 0.5 - 0.5 * Math.cos(Math.PI * safetyPosition);
            } else if (
              fundamental >= 20
              && fundamental <= workletSampleRate * 0.36
            ) {
              safety = 1;
            } else if (
              fundamental > workletSampleRate * 0.36
              && fundamental < workletSampleRate * 0.44
            ) {
              const safetyPosition = (
                fundamental - workletSampleRate * 0.36
              ) / (workletSampleRate * 0.08);
              safety = 0.5 + 0.5 * Math.cos(Math.PI * safetyPosition);
            }
            pitchWeight = (
              0.5 + 0.5 * Math.cos(Math.PI * distance)
            ) * safety;
          }

          const excitation = this.pitchExcitations[index];
          if (excitation > 1e-7 && pitchWeight > 1e-7) {
            const velocity = excitation / Math.sqrt(
              1 + this.current.centerRate * this.bodyDecays[index] * 0.42,
            );
            this.slowEnvelopes[index] = Math.min(
              2.5,
              this.slowEnvelopes[index] + velocity,
            );
            this.fastEnvelopes[index] = Math.min(
              2.5,
              this.fastEnvelopes[index] + velocity,
            );
            this.pitchBends[index] = Math.max(
              this.pitchBends[index],
              this.pitchDrops[index],
            );
            const modeBase = index * MODE_COUNT;
            for (let mode = 0; mode < MODE_COUNT; mode += 1) {
              const stateIndex = modeBase + mode;
              this.modalRe[stateIndex] = Math.min(
                4,
                this.modalRe[stateIndex]
                  + velocity * this.modalGain[stateIndex],
              );
            }
          }
          this.slowEnvelopes[index] *= this.impactSlowDecays[index];
          this.fastEnvelopes[index] *= attackDecay;
          this.pitchBends[index] *= this.pitchBendDecays[index];

          let modalSample = 0;
          const modeBase = index * MODE_COUNT;
          for (let mode = 0; mode < MODE_COUNT; mode += 1) {
            const stateIndex = modeBase + mode;
            const real = this.modalRe[stateIndex];
            const imaginary = this.modalIm[stateIndex];
            const stateDecay = this.modalDecay[stateIndex];
            const nextReal = (
              real * this.modalCos[stateIndex]
              - imaginary * this.modalSin[stateIndex]
            ) * stateDecay;
            const nextImaginary = (
              real * this.modalSin[stateIndex]
              + imaginary * this.modalCos[stateIndex]
            ) * stateDecay;
            this.modalRe[stateIndex] = nextReal;
            this.modalIm[stateIndex] = nextImaginary;
            modalSample += nextImaginary;
          }

          let noiseState = this.noiseSeeds[index];
          noiseState ^= noiseState << 13;
          noiseState ^= noiseState >>> 17;
          noiseState ^= noiseState << 5;
          noiseState >>>= 0;
          if (noiseState === 0) noiseState = 0x9e3779b9;
          this.noiseSeeds[index] = noiseState;
          const white = noiseState / 0x80000000 - 1;
          this.bodyNoiseLow[index] += (
            white - this.bodyNoiseLow[index]
          ) * this.bodyNoiseLowCoefficients[index];
          this.bodyNoiseHigh[index] += (
            white - this.bodyNoiseHigh[index]
          ) * this.bodyNoiseHighCoefficients[index];
          this.airNoiseLow[index] += (
            white - this.airNoiseLow[index]
          ) * this.airNoiseCoefficients[index];
          const bodyNoise = (
            this.bodyNoiseHigh[index] - this.bodyNoiseLow[index]
          ) * 1.55;
          const airNoise = white - this.airNoiseLow[index];
          const impactEnvelope = Math.max(
            0,
            this.slowEnvelopes[index] - this.fastEnvelopes[index],
          );
          const airAmountRaw = Math.max(
            0,
            Math.min(1, (this.noiseColors[index] - 0.2) / 0.7),
          );
          const airAmount = airAmountRaw
            * airAmountRaw
            * (3 - 2 * airAmountRaw);
          const impactSample = impactEnvelope
            * this.noiseMixes[index]
            * (
              bodyNoise * (1 - airAmount * 0.64)
              + airNoise * (0.16 + airAmount * 0.84) * 0.62
            );
          const voiceSample = modalSample * this.bodyMixes[index] * 0.92
            + impactSample;

          if (pitchWeight > 0) {
            const normalizedOffset = pitchOffset / pitchHalfWidth;
            const pan = Math.max(-1, Math.min(1, normalizedOffset))
              * this.current.spread;
            const panAngle = (pan + 1) * Math.PI * 0.25;
            leftSample += voiceSample * pitchWeight * Math.cos(panAngle);
            rightSample += voiceSample * pitchWeight * Math.sin(panAngle);
            pitchWeightPower += pitchWeight * pitchWeight;
          }
          pitchOffset += this.current.pitchInterval;
          fundamental *= pitchRatio;
        }

        const pitchNormalization = pitchWeightPower > 1e-12
          ? 1 / Math.sqrt(pitchWeightPower)
          : 0;
        const protectedGain = outputScale
          * pitchNormalization
          * this.activeGain;
        left[sampleIndex] = Math.tanh(leftSample * protectedGain);
        if (right !== left) {
          right[sampleIndex] = Math.tanh(rightSample * protectedGain);
        }
      }
      return true;
    }
  };
}

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

/**
 * Lazy Web Audio lifecycle for the coupled pitch/rhythm illusion. Audible
 * output and the automatic pitch/rhythm transport are intentionally separate.
 */
export class OuroborosBorealisAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.lowpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.audible = false;
    this.transporting = false;
    this.enabled = false;
    this.params = { ...OUROBOROS_BOREALIS_DEFAULTS };
    this.level = OUROBOROS_BOREALIS_DEFAULTS.level;
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = this.runtime.AudioContext
      ?? this.runtime.webkitAudioContext;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close();
      throw new Error("Ouroboros Borealis requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./ouroboros-borealis.js", import.meta.url),
      );
      const WorkletNode = this.runtime.AudioWorkletNode
        ?? globalThis.AudioWorkletNode;
      if (typeof WorkletNode !== "function") {
        throw new Error("Ouroboros Borealis requires AudioWorkletNode support.");
      }
      const node = new WorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: this.params,
      });
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = 36;
      highpass.Q.value = 0.707;
      lowpass.type = "lowpass";
      lowpass.frequency.value = this.params.cutoff;
      lowpass.Q.value = 0.707;
      compressor.threshold.value = -13;
      compressor.knee.value = 7;
      compressor.ratio.value = 7;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.16;
      ceiling.curve = createOuroborosBorealisSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;

      node
        .connect(highpass)
        .connect(lowpass)
        .connect(compressor)
        .connect(ceiling)
        .connect(master)
        .connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(
        context,
        analyser,
        { runtime: this.runtime },
      );

      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.lowpass = lowpass;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      await context.close().catch(() => {});
      throw error;
    }
  }

  setParameters(params = {}) {
    const safe = sanitizeOuroborosBorealisParams({
      ...this.params,
      ...params,
    });
    this.params = { ...safe };
    this.level = safe.level;
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "parameters",
      parameters: safe,
    });
    this.lowpass.frequency.setTargetAtTime(
      safe.cutoff,
      this.context.currentTime,
      0.025,
    );
    if (this.audible) {
      this.master.gain.setTargetAtTime(
        this.level,
        this.context.currentTime,
        0.015,
      );
    }
  }

  async enable() {
    await this.initialize();
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    await this.context.resume();
    if (this.audible) return true;
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "audible", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.level, now + 0.035);
    this.audible = true;
    this.enabled = true;
    return true;
  }

  async start() {
    await this.enable();
    return this.setTransport(true);
  }

  setTransport(active) {
    const next = Boolean(active);
    if (!this.isInitialized || !this.audible) {
      if (!next) this.transporting = false;
      return false;
    }
    this.node.port.postMessage({ type: "transport", value: next });
    this.transporting = next;
    return true;
  }

  stopTransport() {
    return this.setTransport(false);
  }

  strike(velocity = 1, position = null) {
    if (!this.isInitialized || !this.audible) return false;
    const message = {
      type: "strike",
      velocity: clamp(velocity, 0, 1, 1),
    };
    if (position !== null && position !== undefined) {
      const numericPosition = Number(position);
      if (Number.isFinite(numericPosition)) {
        message.position = clamp(numericPosition, 0, 1, 0.5);
      }
    }
    this.node.port.postMessage(message);
    return true;
  }

  stop() {
    if (!this.isInitialized) {
      this.audible = false;
      this.transporting = false;
      this.enabled = false;
      return;
    }
    if (!this.audible && !this.transporting) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.node.port.postMessage({ type: "transport", value: false });
    this.node.port.postMessage({ type: "audible", value: false });
    this.audible = false;
    this.transporting = false;
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.audible && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  getWaveform(target) {
    if (!this.analyser || !(target instanceof Float32Array)) return false;
    this.analyser.getFloatTimeDomainData(target);
    return true;
  }

  async close() {
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    this.audible = false;
    this.transporting = false;
    this.enabled = false;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.node?.port.postMessage({ type: "transport", value: false });
    this.node?.port.postMessage({ type: "audible", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.lowpass?.disconnect();
    this.compressor?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.lowpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
