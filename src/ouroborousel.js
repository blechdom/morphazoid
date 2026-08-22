import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-ouroborousel";
const TAU = Math.PI * 2;
const LAYER_COUNT = 21;
const LAYER_CENTER = Math.floor(LAYER_COUNT / 2);
const DEFAULT_SAMPLE_RATE = 48_000;
const MODE_COUNT = 4;
const NOTE_FULL_BAND_MIN = 20;
const DRUM_CENTER_PITCH = 110;
const DRUM_DECAY = 0.18;
const DRUM_CHARACTER = 0.5;
const DRUM_MORPH_DEPTH = 1;
const DRUM_NOISE_MIX = 0.3;
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

export const OUROBOROUSEL_PHASE_SEED = 0.1375035237;
export const OUROBOROUSEL_MATERIAL_MODES = Object.freeze([
  "notes",
  "drums",
  "combo",
]);

export const OUROBOROUSEL_DEFAULTS = Object.freeze({
  materialMode: "notes",
  direction: 1,
  glissRate: 0.12,
  centerRate: 8,
  bankWidth: 6,
  noteLift: 6,
  chunkDuty: 0.72,
  fusionPoint: 18,
  fusionWidth: 1,
  spread: 0.48,
  brightness: 0.68,
  cutoff: 12_000,
  level: 0.52,
});

export const OUROBOROUSEL_PRESETS = Object.freeze([
  Object.freeze({
    id: "round-and-round-and-pow",
    label: "Round and Round and Pow",
    description: "balanced bites · endless ascent",
    ...OUROBOROUSEL_DEFAULTS,
  }),
  Object.freeze({
    id: "tail-chaser",
    label: "Tail Chaser",
    description: "backward drum coil · soft rolls",
    ...OUROBOROUSEL_DEFAULTS,
    materialMode: "drums",
    direction: -1,
    glissRate: 0.085,
    centerRate: 3,
    bankWidth: 8,
    chunkDuty: 0.55,
    fusionPoint: 20,
    fusionWidth: 1.35,
    brightness: 0.44,
  }),
  Object.freeze({
    id: "infinididdle",
    label: "Infinididdle",
    description: "tight notes + drums · quick bright climb",
    ...OUROBOROUSEL_DEFAULTS,
    materialMode: "combo",
    glissRate: 0.34,
    centerRate: 7,
    bankWidth: 5,
    noteLift: 4,
    chunkDuty: 0.28,
    fusionPoint: 30,
    fusionWidth: 0.65,
    spread: 0.64,
    brightness: 0.82,
    cutoff: 16_000,
    level: 0.46,
  }),
  Object.freeze({
    id: "againaconda",
    label: "Againaconda",
    description: "long drum tails · low revolving coil",
    ...OUROBOROUSEL_DEFAULTS,
    materialMode: "drums",
    glissRate: 0.045,
    centerRate: 1.5,
    bankWidth: 9,
    noteLift: 6,
    chunkDuty: 0.72,
    fusionPoint: 14,
    fusionWidth: 1.6,
    spread: 0.25,
    brightness: 0.34,
    cutoff: 7_200,
    level: 0.58,
  }),
  Object.freeze({
    id: "oops-all-feedback",
    label: "Oops! All Feedback",
    description: "early fusion · notes riding drum sparks",
    ...OUROBOROUSEL_DEFAULTS,
    materialMode: "combo",
    glissRate: 0.2,
    centerRate: 5.5,
    bankWidth: 7.5,
    noteLift: 5,
    chunkDuty: 0.88,
    fusionPoint: 12,
    fusionWidth: 1.8,
    spread: 0.72,
    brightness: 0.9,
    cutoff: 17_000,
    level: 0.44,
  }),
  Object.freeze({
    id: "no-exit-only-snare",
    label: "No Exit, Only Snare",
    description: "hard drum bites · late fusion",
    ...OUROBOROUSEL_DEFAULTS,
    materialMode: "drums",
    direction: -1,
    glissRate: 0.48,
    centerRate: 10,
    bankWidth: 4,
    noteLift: 3,
    chunkDuty: 0.2,
    fusionPoint: 42,
    fusionWidth: 0.4,
    spread: 0.82,
    brightness: 0.74,
    cutoff: 14_000,
    level: 0.43,
  }),
]);

function clamp(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function directionValue(value, fallback = OUROBOROUSEL_DEFAULTS.direction) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric < 0 ? -1 : 1 : fallback;
}

function materialModeValue(value) {
  return OUROBOROUSEL_MATERIAL_MODES.includes(value)
    ? value
    : OUROBOROUSEL_DEFAULTS.materialMode;
}

function materialMixValue(value) {
  if (value === "drums") return 1;
  if (value === "combo") return 0.5;
  return 0;
}

export function sanitizeOuroborouselParams(params = {}) {
  const materialMode = materialModeValue(params.materialMode);
  const centerRate = clamp(
    params.centerRate,
    0.5,
    24,
    OUROBOROUSEL_DEFAULTS.centerRate,
  );
  const bankWidth = clamp(
    params.bankWidth,
    3,
    9,
    OUROBOROUSEL_DEFAULTS.bankWidth,
  );
  let noteLift = Math.round(clamp(
    params.noteLift,
    3,
    7,
    OUROBOROUSEL_DEFAULTS.noteLift,
  ));
  if (materialMode !== "drums") {
    // The highest in-window lane can sit one octave below the upper window
    // edge at the cyclic lattice's worst alignment. Keep that lane in the
    // frequency guard's fully audible band, so normalization never magnifies
    // a lone 12 Hz edge fade into an abrupt onset. Raising the integer source
    // lift preserves the requested pulse rate and every exact 2:1 relation.
    const minimumLift = Math.ceil(
      Math.log2(NOTE_FULL_BAND_MIN / centerRate) - bankWidth * 0.5 + 1,
    );
    noteLift = Math.max(noteLift, Math.min(7, minimumLift));
  }
  return Object.freeze({
    materialMode,
    direction: directionValue(params.direction),
    glissRate: clamp(
      params.glissRate,
      0.02,
      1.2,
      OUROBOROUSEL_DEFAULTS.glissRate,
    ),
    centerRate,
    bankWidth,
    noteLift,
    chunkDuty: clamp(
      params.chunkDuty,
      0.15,
      1,
      OUROBOROUSEL_DEFAULTS.chunkDuty,
    ),
    fusionPoint: clamp(
      params.fusionPoint,
      8,
      48,
      OUROBOROUSEL_DEFAULTS.fusionPoint,
    ),
    fusionWidth: clamp(
      params.fusionWidth,
      0.25,
      2,
      OUROBOROUSEL_DEFAULTS.fusionWidth,
    ),
    spread: clamp(params.spread, 0, 1, OUROBOROUSEL_DEFAULTS.spread),
    brightness: clamp(
      params.brightness,
      0,
      1,
      OUROBOROUSEL_DEFAULTS.brightness,
    ),
    cutoff: clamp(params.cutoff, 800, 18_000, OUROBOROUSEL_DEFAULTS.cutoff),
    level: clamp(params.level, 0, 0.82, OUROBOROUSEL_DEFAULTS.level),
  });
}

/** Raised-cosine bank window on a logarithmic tempo axis. */
export function ouroborouselWindow(
  octaveOffset,
  width = OUROBOROUSEL_DEFAULTS.bankWidth,
) {
  const safeWidth = clamp(width, 3, 9, OUROBOROUSEL_DEFAULTS.bankWidth);
  const distance = Math.abs(Number(octaveOffset)) / (safeWidth * 0.5);
  if (!Number.isFinite(distance) || distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

/**
 * Fade a carrier into and out of the useful audio band. Unlike Drum Roll
 * Please's rate guard, this protects source pitch rather than silencing fast
 * rhythms, so fused lanes can continue far beyond 96 pulses per second.
 */
export function ouroborouselFrequencySafety(
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

/**
 * Continuous-tone share of the chunk-to-tone crossfade. The transition is
 * centered on fusionPoint and fusionWidth is its total width in tempo octaves.
 */
export function ouroborouselFusionBlend(
  hitRate,
  fusionPoint = OUROBOROUSEL_DEFAULTS.fusionPoint,
  fusionWidth = OUROBOROUSEL_DEFAULTS.fusionWidth,
) {
  const rate = Number(hitRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const point = clamp(
    fusionPoint,
    8,
    48,
    OUROBOROUSEL_DEFAULTS.fusionPoint,
  );
  const width = clamp(
    fusionWidth,
    0.25,
    2,
    OUROBOROUSEL_DEFAULTS.fusionWidth,
  );
  const normalized = Math.log2(rate / point) / width + 0.5;
  if (normalized <= 0) return 0;
  if (normalized >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * normalized);
}

/** One Hann-windowed note bite within a normalized pulse cycle. */
export function ouroborouselChunkEnvelope(
  pulsePhase,
  duty = OUROBOROUSEL_DEFAULTS.chunkDuty,
) {
  const phase = wrapUnit(pulsePhase);
  const safeDuty = clamp(duty, 0.15, 1, OUROBOROUSEL_DEFAULTS.chunkDuty);
  if (phase >= safeDuty) return 0;
  return 0.5 - 0.5 * Math.cos(TAU * phase / safeDuty);
}

function rattleSigmoid(frequency, crossover) {
  const distance = Math.log2(frequency / crossover) / RATTLE_MORPH_WIDTH;
  return 1 / (1 + Math.exp(-4 * distance));
}

function weightedRattleValue(values, kick, tom, hand, air) {
  return values[0] * kick
    + values[1] * tom
    + values[2] * hand
    + values[3] * air;
}

function drumMorphWeights(octaveOffset, bankWidth) {
  const safeWidth = Math.max(3, bankWidth);
  const basePosition = Math.max(
    0,
    Math.min(1, 0.5 + octaveOffset / safeWidth),
  );
  const morphPosition = Math.max(0, Math.min(1,
    0.5
    + (basePosition - 0.5) * DRUM_MORPH_DEPTH
    + (DRUM_CHARACTER - 0.5) * 0.36
  ));
  const morphFrequency = RATTLE_RANGE_MIN * 2 ** (
    RATTLE_RANGE_OCTAVES * morphPosition
  );
  const kickToTom = rattleSigmoid(morphFrequency, RATTLE_CROSSOVERS[0]);
  const tomToHand = rattleSigmoid(morphFrequency, RATTLE_CROSSOVERS[1]);
  const handToAir = rattleSigmoid(morphFrequency, RATTLE_CROSSOVERS[2]);
  return Object.freeze({
    kick: 1 - kickToTom,
    tom: kickToTom * (1 - tomToHand),
    hand: kickToTom * tomToHand * (1 - handToAir),
    air: kickToTom * tomToHand * handToAir,
  });
}

export function advanceOuroborouselPosition(position, delta) {
  const raw = wrapUnit(position) + (Number.isFinite(delta) ? delta : 0);
  return Object.freeze({
    position: wrapUnit(raw),
    wraps: Math.floor(raw),
  });
}

/**
 * Describe the unified rhythm/pitch bank. Every lane's carrier is an integer
 * number of octaves above its pulse rate. Its carrier phase is consequently
 * derivable from pulse phase and remains coherent at every chunk boundary.
 */
export function calculateOuroborouselLayers({
  position = 0,
  sampleRate = DEFAULT_SAMPLE_RATE,
  layerCount = LAYER_COUNT,
  ...params
} = {}) {
  const safe = sanitizeOuroborouselParams(params);
  const count = Math.max(5, Math.round(clamp(layerCount, 5, 41, LAYER_COUNT)));
  const center = Math.floor(count / 2);
  const phase = wrapUnit(position);
  const materialMix = materialMixValue(safe.materialMode);
  const noteMaterialGain = Math.cos(materialMix * Math.PI * 0.5);
  const drumMaterialGain = Math.sin(materialMix * Math.PI * 0.5);
  const cyclesPerChunk = 2 ** safe.noteLift;
  const layers = [];
  let activeLayers = 0;
  let totalHitRate = 0;
  let noteActiveLayers = 0;
  let drumActiveLayers = 0;
  let noteTotalHitRate = 0;
  let drumTotalHitRate = 0;
  let weightPower = 0;
  let drumWeightPower = 0;

  for (let index = 0; index < count; index += 1) {
    const octaveOffset = -center + phase + index;
    const hitRate = safe.centerRate * 2 ** octaveOffset;
    const sourceHz = hitRate * cyclesPerChunk;
    const drumFundamentalHz = DRUM_CENTER_PITCH * 2 ** octaveOffset;
    const window = ouroborouselWindow(octaveOffset, safe.bankWidth);
    const safety = ouroborouselFrequencySafety(sourceHz, sampleRate);
    const weight = window * safety;
    const drumSafety = ouroborouselFrequencySafety(
      drumFundamentalHz,
      sampleRate,
    );
    const drumWeight = window * drumSafety;
    const morphWeights = drumMorphWeights(octaveOffset, safe.bankWidth);
    const fusionBlend = ouroborouselFusionBlend(
      hitRate,
      safe.fusionPoint,
      safe.fusionWidth,
    );
    const chunkGain = 1 - fusionBlend;
    const toneGain = fusionBlend;
    const normalizedOffset = octaveOffset / Math.max(1.5, safe.bankWidth * 0.5);
    const pan = clamp(normalizedOffset, -1, 1, 0) * safe.spread;
    const pulsePhase = wrapUnit(
      OUROBOROUSEL_PHASE_SEED * 2 ** octaveOffset,
    );
    const carrierPhase = wrapUnit(pulsePhase * cyclesPerChunk);
    const noteActive = weight > 1e-9;
    const drumActive = drumWeight > 1e-9;
    const active = safe.materialMode === "drums"
      ? drumActive
      : safe.materialMode === "combo"
        ? noteActive || drumActive
        : noteActive;
    if (noteActive) {
      noteActiveLayers += 1;
      noteTotalHitRate += hitRate;
    }
    if (drumActive) {
      drumActiveLayers += 1;
      drumTotalHitRate += hitRate;
    }
    if (active) {
      activeLayers += 1;
      totalHitRate += hitRate;
    }
    weightPower += weight * weight;
    drumWeightPower += drumWeight * drumWeight;
    layers.push({
      index,
      octaveOffset,
      hitRate,
      rate: hitRate,
      bpm: hitRate * 60,
      sourceHz,
      fundamentalHz: sourceHz,
      drumFundamentalHz,
      drumSafety,
      drumWeight,
      drumMorphWeights: morphWeights,
      noteActive,
      drumActive,
      cyclesPerChunk,
      pulsePhase,
      carrierPhase,
      window,
      safety,
      weight,
      fusionBlend,
      chunkGain,
      toneGain,
      chunkEnvelope: ouroborouselChunkEnvelope(pulsePhase, safe.chunkDuty),
      pan,
      active,
    });
  }

  const normalization = weightPower > 1e-12
    ? 1 / Math.sqrt(weightPower)
    : 0;
  const drumNormalization = drumWeightPower > 1e-12
    ? 1 / Math.sqrt(drumWeightPower)
    : 0;
  const frozenLayers = layers.map((layer) => {
    const noteGain = layer.weight * normalization;
    const drumGain = layer.drumWeight * drumNormalization;
    const gain = safe.materialMode === "drums"
      ? drumGain
      : safe.materialMode === "combo"
        ? Math.hypot(
          noteGain * noteMaterialGain,
          drumGain * drumMaterialGain,
        )
        : noteGain;
    return Object.freeze({
      ...layer,
      noteGain,
      drumGain,
      gain,
    });
  });

  return Object.freeze({
    position: phase,
    direction: safe.direction,
    materialMode: safe.materialMode,
    materialMix,
    noteMaterialGain,
    drumMaterialGain,
    cyclesPerChunk,
    layers: Object.freeze(frozenLayers),
    activeLayers,
    audibleLayers: activeLayers,
    totalHitRate,
    noteActiveLayers,
    drumActiveLayers,
    noteTotalHitRate,
    drumTotalHitRate,
    weightPower,
    normalization,
    drumWeightPower,
    drumNormalization,
  });
}

function createSoftCeilingCurve(
  length = 2_049,
  drive = 1.4,
  ceiling = 0.92,
) {
  const size = Math.max(33, Math.round(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.5, 4, 1.4);
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

function clearDrumLayerVoice(processor, layer) {
  processor.drumSlowEnvelopes[layer] = 0;
  processor.drumFastEnvelopes[layer] = 0;
  processor.drumPitchBends[layer] = 0;
  processor.drumBodyNoiseLow[layer] = 0;
  processor.drumBodyNoiseHigh[layer] = 0;
  processor.drumAirNoiseLow[layer] = 0;
  processor.drumNoiseSeedCounter = advanceNoiseSeed(
    processor.drumNoiseSeedCounter,
  );
  processor.drumNoiseSeeds[layer] = processor.drumNoiseSeedCounter;
  const modeBase = layer * MODE_COUNT;
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    processor.drumModalRe[modeBase + mode] = 0;
    processor.drumModalIm[modeBase + mode] = 0;
  }
}

function copyDrumLayerVoice(processor, destination, source) {
  processor.drumSlowEnvelopes[destination] = processor.drumSlowEnvelopes[source];
  processor.drumFastEnvelopes[destination] = processor.drumFastEnvelopes[source];
  processor.drumPitchBends[destination] = processor.drumPitchBends[source];
  processor.drumBodyNoiseLow[destination] = processor.drumBodyNoiseLow[source];
  processor.drumBodyNoiseHigh[destination] = processor.drumBodyNoiseHigh[source];
  processor.drumAirNoiseLow[destination] = processor.drumAirNoiseLow[source];
  processor.drumNoiseSeeds[destination] = processor.drumNoiseSeeds[source];
  const destinationBase = destination * MODE_COUNT;
  const sourceBase = source * MODE_COUNT;
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    processor.drumModalRe[destinationBase + mode] = processor.drumModalRe[
      sourceBase + mode
    ];
    processor.drumModalIm[destinationBase + mode] = processor.drumModalIm[
      sourceBase + mode
    ];
  }
}

function rotateLayerStateUp(processor) {
  for (let index = LAYER_COUNT - 1; index > 0; index -= 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index - 1];
    processor.noteLifts[index] = processor.noteLifts[index - 1];
    copyDrumLayerVoice(processor, index, index - 1);
  }
  processor.pulsePhases[0] = wrapUnit(processor.pulsePhases[1] * 0.5);
  processor.noteLifts[0] = processor.target.noteLift;
  clearDrumLayerVoice(processor, 0);
}

function rotateLayerStateDown(processor) {
  const last = LAYER_COUNT - 1;
  for (let index = 0; index < last; index += 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index + 1];
    processor.noteLifts[index] = processor.noteLifts[index + 1];
    copyDrumLayerVoice(processor, index, index + 1);
  }
  processor.pulsePhases[last] = wrapUnit(processor.pulsePhases[last - 1] * 2);
  processor.noteLifts[last] = processor.target.noteLift;
  clearDrumLayerVoice(processor, last);
}

function rotateForWraps(processor, wraps) {
  if (wraps > 0) {
    for (let turn = 0; turn < wraps; turn += 1) {
      rotateLayerStateUp(processor);
    }
  } else if (wraps < 0) {
    for (let turn = 0; turn > wraps; turn -= 1) {
      rotateLayerStateDown(processor);
    }
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidOuroborouselProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeOuroborouselParams(options.processorOptions ?? {});
      this.target = { ...initial };
      this.current = { ...initial };
      this.position = 0;
      this.pulsePhases = new Float64Array(LAYER_COUNT);
      this.noteLifts = new Uint8Array(LAYER_COUNT);
      this.drumSlowEnvelopes = new Float64Array(LAYER_COUNT);
      this.drumFastEnvelopes = new Float64Array(LAYER_COUNT);
      this.drumPitchBends = new Float64Array(LAYER_COUNT);
      this.drumBodyNoiseLow = new Float64Array(LAYER_COUNT);
      this.drumBodyNoiseHigh = new Float64Array(LAYER_COUNT);
      this.drumAirNoiseLow = new Float64Array(LAYER_COUNT);
      this.drumNoiseSeeds = new Uint32Array(LAYER_COUNT);
      this.drumModalRe = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumModalIm = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumModalCos = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumModalSin = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumModalDecay = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumModalGain = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.drumBodyDecays = new Float64Array(LAYER_COUNT);
      this.drumPitchDrops = new Float64Array(LAYER_COUNT);
      this.drumPitchBendDecays = new Float64Array(LAYER_COUNT);
      this.drumNoiseMixes = new Float64Array(LAYER_COUNT);
      this.drumBodyMixes = new Float64Array(LAYER_COUNT);
      this.drumBodyNoiseLowCoefficients = new Float64Array(LAYER_COUNT);
      this.drumBodyNoiseHighCoefficients = new Float64Array(LAYER_COUNT);
      this.drumAirNoiseCoefficients = new Float64Array(LAYER_COUNT);
      this.drumImpactSlowDecays = new Float64Array(LAYER_COUNT);
      this.drumAirAmounts = new Float64Array(LAYER_COUNT);
      this.drumNoiseSeedCounter = 0x6d2b79f5;
      for (let index = 0; index < LAYER_COUNT; index += 1) {
        const octaveOffset = -LAYER_CENTER + index;
        this.pulsePhases[index] = wrapUnit(
          OUROBOROUSEL_PHASE_SEED * 2 ** octaveOffset,
        );
        this.noteLifts[index] = initial.noteLift;
        this.drumNoiseSeedCounter = advanceNoiseSeed(
          this.drumNoiseSeedCounter,
        );
        this.drumNoiseSeeds[index] = this.drumNoiseSeedCounter;
      }
      this.targetMaterialMix = materialMixValue(initial.materialMode);
      this.currentMaterialMix = this.targetMaterialMix;
      this.activeTarget = 0;
      this.transportTarget = 0;
      this.activeGain = 0;
      this.transportGain = 0;
      this.pendingStrike = 0;
      this.pendingStrikePosition = Number.NaN;
      this.manualSlowEnvelope = 0;
      this.manualFastEnvelope = 0;
      this.manualPosition = Number.NaN;
      this.updateDrumCoefficients(DEFAULT_SAMPLE_RATE);
      this.port.onmessage = (event) => {
        if (event.data?.type === "parameters") {
          this.target = {
            ...this.target,
            ...sanitizeOuroborouselParams({
              ...this.target,
              ...event.data.parameters,
            }),
          };
          this.targetMaterialMix = materialMixValue(this.target.materialMode);
          this.current.materialMode = this.target.materialMode;
          if (this.activeTarget < 0.5) this.snapCurrentToTarget();
        } else if (event.data?.type === "active") {
          const active = event.data.value ? 1 : 0;
          this.activeTarget = active;
          this.transportTarget = active;
          if (active < 0.5) this.snapCurrentToTarget();
        } else if (event.data?.type === "audible") {
          this.activeTarget = event.data.value ? 1 : 0;
          if (this.activeTarget < 0.5) {
            this.transportTarget = 0;
            this.snapCurrentToTarget();
          }
        } else if (event.data?.type === "transport") {
          this.transportTarget = event.data.value ? 1 : 0;
        } else if (event.data?.type === "position") {
          const requested = Number(event.data.value);
          if (Number.isFinite(requested)) {
            const next = wrapUnit(requested);
            const delta = next - this.position;
            if (delta < -0.5) rotateForWraps(this, 1);
            else if (delta > 0.5) rotateForWraps(this, -1);
            this.position = next;
            this.updateDrumCoefficients(
              Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
            );
          }
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

    snapCurrentToTarget() {
      this.current.materialMode = this.target.materialMode;
      this.currentMaterialMix = this.targetMaterialMix;
      this.current.direction = this.target.direction;
      this.current.glissRate = this.target.glissRate;
      this.current.centerRate = this.target.centerRate;
      this.current.bankWidth = this.target.bankWidth;
      this.current.noteLift = this.target.noteLift;
      this.current.chunkDuty = this.target.chunkDuty;
      this.current.fusionPoint = this.target.fusionPoint;
      this.current.fusionWidth = this.target.fusionWidth;
      this.current.spread = this.target.spread;
      this.current.brightness = this.target.brightness;
      this.current.cutoff = this.target.cutoff;
      this.current.level = this.target.level;
      this.noteLifts?.fill(this.target.noteLift);
      this.updateDrumCoefficients?.(
        Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
      );
    }

    updateDrumCoefficients(workletSampleRate) {
      const safeWidth = Math.max(3, this.current.bankWidth);
      const firstOffset = -LAYER_CENTER + this.position;
      const decayScale = DRUM_DECAY / 0.76;
      const nyquistTaper = workletSampleRate * 0.36;
      const nyquistCull = workletSampleRate * 0.44;

      for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
        const octaveOffset = firstOffset + layer;
        const basePosition = Math.max(
          0,
          Math.min(1, 0.5 + octaveOffset / safeWidth),
        );
        const morphPosition = Math.max(0, Math.min(1,
          0.5
          + (basePosition - 0.5) * DRUM_MORPH_DEPTH
          + (DRUM_CHARACTER - 0.5) * 0.36
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
        ) * DRUM_NOISE_MIX;
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
        this.drumBodyDecays[layer] = bodyDecay;
        this.drumPitchDrops[layer] = pitchDrop;
        this.drumPitchBendDecays[layer] = Math.exp(
          -1 / (workletSampleRate * Math.max(0.008, pitchDropTime)),
        );
        this.drumNoiseMixes[layer] = noiseMix;
        this.drumBodyMixes[layer] = weightedRattleValue(
          RATTLE_BODY_MIXES,
          kick,
          tom,
          hand,
          air,
        );
        this.drumImpactSlowDecays[layer] = Math.exp(
          -1 / (workletSampleRate * Math.max(0.009, noiseDecay)),
        );
        const airAmountRaw = Math.max(
          0,
          Math.min(1, (noiseColor - 0.2) / 0.7),
        );
        this.drumAirAmounts[layer] = airAmountRaw
          * airAmountRaw
          * (3 - 2 * airAmountRaw);

        const fundamental = DRUM_CENTER_PITCH * 2 ** (
          octaveOffset + this.drumPitchBends[layer]
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
        this.drumBodyNoiseLowCoefficients[layer] = 1 - Math.exp(
          -TAU * bodyNoiseLow / workletSampleRate,
        );
        this.drumBodyNoiseHighCoefficients[layer] = 1 - Math.exp(
          -TAU * bodyNoiseHigh / workletSampleRate,
        );
        this.drumAirNoiseCoefficients[layer] = 1 - Math.exp(
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
          const boundedFrequency = Math.min(nyquistCull, modeFrequency);
          const radians = TAU * boundedFrequency / workletSampleRate;
          this.drumModalCos[stateIndex] = Math.cos(radians);
          this.drumModalSin[stateIndex] = Math.sin(radians);
          this.drumModalDecay[stateIndex] = Math.exp(-1 / (
            workletSampleRate
            * Math.max(0.012, bodyDecay / (1 + mode * highDamping * 0.42))
          ));
          const gain = rawGain
            * (1 + mode * hardness * 0.055)
            * aliasFade;
          this.drumModalGain[stateIndex] = gain;
          gainTotal += gain;
        }
        if (gainTotal > 1e-12) {
          for (let mode = 0; mode < MODE_COUNT; mode += 1) {
            this.drumModalGain[modeBase + mode] /= gainTotal;
          }
        }
      }
    }

    hasSafeNoteLane(centerRate, bankWidth, workletSampleRate) {
      const halfWidth = Math.max(1.5, bankWidth * 0.5);
      const firstOffset = -LAYER_CENTER + this.position;
      let hitRate = centerRate * 2 ** firstOffset;
      for (let index = 0; index < LAYER_COUNT; index += 1) {
        const octaveOffset = firstOffset + index;
        const distance = Math.abs(octaveOffset) / halfWidth;
        if (distance < 1) {
          const window = 0.5 + 0.5 * Math.cos(Math.PI * distance);
          const sourceHz = hitRate * 2 ** this.noteLifts[index];
          if (
            window > 1e-7
            && ouroborouselFrequencySafety(sourceHz, workletSampleRate) === 1
          ) {
            return true;
          }
        }
        hitRate *= 2;
      }
      return false;
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
      const manualSlowDecay = Math.exp(-1 / (workletSampleRate * 0.18));
      const manualFastDecay = Math.exp(-1 / (workletSampleRate * 0.004));
      const drumAttackDecay = Math.exp(-1 / (workletSampleRate * 0.0011));
      const noteOutputScale = 0.31;
      const drumOutputScale = 0.38;
      this.updateDrumCoefficients(workletSampleRate);
      const targetNoteReady = this.hasSafeNoteLane(
        this.target.centerRate,
        this.target.bankWidth,
        workletSampleRate,
      );
      const holdSafeNoteFallback = this.currentMaterialMix < 0.999999
        && !targetNoteReady;

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.current.direction += (
          this.target.direction - this.current.direction
        ) * parameterSlew;
        this.current.glissRate += (
          this.target.glissRate - this.current.glissRate
        ) * parameterSlew;
        if (!holdSafeNoteFallback) {
          this.current.centerRate += (
            this.target.centerRate - this.current.centerRate
          ) * parameterSlew;
          this.current.bankWidth += (
            this.target.bankWidth - this.current.bankWidth
          ) * parameterSlew;
        }
        this.current.chunkDuty += (
          this.target.chunkDuty - this.current.chunkDuty
        ) * parameterSlew;
        this.current.fusionPoint += (
          this.target.fusionPoint - this.current.fusionPoint
        ) * parameterSlew;
        this.current.fusionWidth += (
          this.target.fusionWidth - this.current.fusionWidth
        ) * parameterSlew;
        this.current.spread += (
          this.target.spread - this.current.spread
        ) * parameterSlew;
        this.current.brightness += (
          this.target.brightness - this.current.brightness
        ) * parameterSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;
        this.transportGain += (
          this.transportTarget - this.transportGain
        ) * activeSlew;

        let manualStrikeVelocity = 0;
        let manualStrikePosition = Number.NaN;
        if (this.pendingStrike > 0) {
          manualStrikeVelocity = this.pendingStrike;
          manualStrikePosition = this.pendingStrikePosition;
          // Add identical, shared headroom to both envelope poles. Their
          // difference—and therefore the audible note amplitude—cannot jump
          // downward when rapid retriggers push the slow pole toward its cap.
          const manualIncrement = Math.min(
            this.pendingStrike,
            Math.max(0, 2 - this.manualSlowEnvelope),
          );
          this.manualSlowEnvelope += manualIncrement;
          this.manualFastEnvelope += manualIncrement;
          this.manualPosition = this.pendingStrikePosition;
          this.pendingStrike = 0;
          this.pendingStrikePosition = Number.NaN;
        }
        this.manualSlowEnvelope *= manualSlowDecay;
        this.manualFastEnvelope *= manualFastDecay;
        const manualEnvelope = Math.max(
          0,
          this.manualSlowEnvelope - this.manualFastEnvelope,
        );

        const transportActive = this.transportTarget > 0.5;
        if (transportActive) {
          const rawPosition = this.position + (
            this.current.direction
            * this.current.glissRate
            / workletSampleRate
          );
          const wraps = Math.floor(rawPosition);
          this.position = wrapUnit(rawPosition);
          if (wraps !== 0) {
            rotateForWraps(this, wraps);
            this.updateDrumCoefficients(workletSampleRate);
          }
        }

        const halfWidth = Math.max(1.5, this.current.bankWidth * 0.5);
        const firstOffset = -LAYER_CENTER + this.position;
        let hitRate = this.current.centerRate * 2 ** firstOffset;
        let noteLeftSample = 0;
        let noteRightSample = 0;
        let drumLeftSample = 0;
        let drumRightSample = 0;
        let noteMaterialReady = false;
        let noteWeightPower = 0;
        let drumWeightPower = 0;

        for (let index = 0; index < LAYER_COUNT; index += 1) {
          const pulsePhase = this.pulsePhases[index];
          const noteLift = this.noteLifts[index];
          const cyclesPerChunk = 2 ** noteLift;
          let pulseWraps = 0;
          if (this.activeTarget > 0.5 || manualEnvelope > 1e-7) {
            const nextPhase = pulsePhase + hitRate / workletSampleRate;
            pulseWraps = Math.floor(nextPhase);
            this.pulsePhases[index] = nextPhase - pulseWraps;
            // Integer-octave carriers all cross zero at the pulse boundary.
            // Change a lane's source lift there, rather than at an arbitrary
            // render-quantum boundary, to keep the waveform continuous.
            if (pulseWraps > 0 && noteLift !== this.target.noteLift) {
              this.noteLifts[index] = this.target.noteLift;
            }
          }

          const octaveOffset = firstOffset + index;
          const distance = Math.abs(octaveOffset) / halfWidth;
          const sourceHz = hitRate * cyclesPerChunk;
          const drumFundamental = DRUM_CENTER_PITCH * 2 ** octaveOffset;
          let window = 0;
          let noteSafety = 0;
          let noteWeight = 0;
          let drumWeight = 0;
          if (distance < 1) {
            window = 0.5 + 0.5 * Math.cos(Math.PI * distance);
            noteSafety = ouroborouselFrequencySafety(
              sourceHz,
              workletSampleRate,
            );
            noteWeight = window * noteSafety;
            drumWeight = window * ouroborouselFrequencySafety(
              drumFundamental,
              workletSampleRate,
            );
            if (window > 1e-7 && noteSafety === 1) {
              noteMaterialReady = true;
            }
          }

          let manualWeight = 1;
          if (Number.isFinite(this.manualPosition)) {
            const targetOffset = (this.manualPosition - 0.5)
              * this.current.bankWidth * 0.88;
            const manualDistance = Math.abs(octaveOffset - targetOffset) / 1.15;
            manualWeight = manualDistance < 1
              ? 0.5 + 0.5 * Math.cos(Math.PI * manualDistance)
              : 0;
          }

          if (drumWeight > 1e-9) {
            let strikeVelocity = transportActive && pulseWraps > 0 ? 1 : 0;
            if (manualStrikeVelocity > 0) {
              let manualStrikeWeight = 1;
              if (Number.isFinite(manualStrikePosition)) {
                const targetOffset = (manualStrikePosition - 0.5)
                  * this.current.bankWidth * 0.88;
                const manualDistance = Math.abs(octaveOffset - targetOffset) / 1.15;
                manualStrikeWeight = manualDistance < 1
                  ? 0.5 + 0.5 * Math.cos(Math.PI * manualDistance)
                  : 0;
              }
              strikeVelocity = Math.max(
                strikeVelocity,
                manualStrikeVelocity * manualStrikeWeight,
              );
            }
            if (strikeVelocity > 1e-7) {
              const velocity = strikeVelocity / Math.sqrt(
                1 + hitRate * this.drumBodyDecays[index] * 0.45,
              );
              this.drumSlowEnvelopes[index] = Math.min(
                2.5,
                this.drumSlowEnvelopes[index] + velocity,
              );
              this.drumFastEnvelopes[index] = Math.min(
                2.5,
                this.drumFastEnvelopes[index] + velocity,
              );
              this.drumPitchBends[index] = Math.max(
                this.drumPitchBends[index],
                this.drumPitchDrops[index],
              );
              const modeBase = index * MODE_COUNT;
              for (let mode = 0; mode < MODE_COUNT; mode += 1) {
                const stateIndex = modeBase + mode;
                this.drumModalRe[stateIndex] = Math.min(
                  4,
                  this.drumModalRe[stateIndex]
                    + velocity * this.drumModalGain[stateIndex],
                );
              }
            }
          }

          this.drumSlowEnvelopes[index] *= this.drumImpactSlowDecays[index];
          this.drumFastEnvelopes[index] *= drumAttackDecay;
          this.drumPitchBends[index] *= this.drumPitchBendDecays[index];

          let drumModalSample = 0;
          const drumModeBase = index * MODE_COUNT;
          for (let mode = 0; mode < MODE_COUNT; mode += 1) {
            const stateIndex = drumModeBase + mode;
            const real = this.drumModalRe[stateIndex];
            const imaginary = this.drumModalIm[stateIndex];
            const stateDecay = this.drumModalDecay[stateIndex];
            const nextReal = (
              real * this.drumModalCos[stateIndex]
              - imaginary * this.drumModalSin[stateIndex]
            ) * stateDecay;
            const nextImaginary = (
              real * this.drumModalSin[stateIndex]
              + imaginary * this.drumModalCos[stateIndex]
            ) * stateDecay;
            this.drumModalRe[stateIndex] = nextReal;
            this.drumModalIm[stateIndex] = nextImaginary;
            drumModalSample += nextImaginary;
          }

          let noiseState = this.drumNoiseSeeds[index];
          noiseState ^= noiseState << 13;
          noiseState ^= noiseState >>> 17;
          noiseState ^= noiseState << 5;
          noiseState >>>= 0;
          if (noiseState === 0) noiseState = 0x9e3779b9;
          this.drumNoiseSeeds[index] = noiseState;
          const white = noiseState / 0x80000000 - 1;
          this.drumBodyNoiseLow[index] += (
            white - this.drumBodyNoiseLow[index]
          ) * this.drumBodyNoiseLowCoefficients[index];
          this.drumBodyNoiseHigh[index] += (
            white - this.drumBodyNoiseHigh[index]
          ) * this.drumBodyNoiseHighCoefficients[index];
          this.drumAirNoiseLow[index] += (
            white - this.drumAirNoiseLow[index]
          ) * this.drumAirNoiseCoefficients[index];
          const bodyNoise = (
            this.drumBodyNoiseHigh[index] - this.drumBodyNoiseLow[index]
          ) * 1.55;
          const airNoise = white - this.drumAirNoiseLow[index];
          const drumImpactEnvelope = Math.max(
            0,
            this.drumSlowEnvelopes[index] - this.drumFastEnvelopes[index],
          );
          const airAmount = this.drumAirAmounts[index];
          const drumImpactSample = drumImpactEnvelope
            * this.drumNoiseMixes[index]
            * (
              bodyNoise * (1 - airAmount * 0.64)
              + airNoise * (0.16 + airAmount * 0.84) * 0.62
            );
          const drumVoiceSample = drumModalSample
              * this.drumBodyMixes[index] * 0.92
            + drumImpactSample;

          const normalizedOffset = octaveOffset / halfWidth;
          const pan = Math.max(-1, Math.min(1, normalizedOffset))
            * this.current.spread;
          const panAngle = (pan + 1) * Math.PI * 0.25;

          if (noteWeight > 1e-9) {
            const blend = ouroborouselFusionBlend(
              hitRate,
              this.current.fusionPoint,
              this.current.fusionWidth,
            );
            // These are correlated versions of one carrier, so complementary
            // gains fill the Hann gaps without an equal-power gain hump.
            const chunkGain = 1 - blend;
            const toneGain = blend;
            const envelope = ouroborouselChunkEnvelope(
              pulsePhase,
              this.current.chunkDuty,
            );
            const carrierAngle = TAU * pulsePhase * cyclesPerChunk;
            const brightness = this.current.brightness;
            const secondSafety = ouroborouselFrequencySafety(
              sourceHz * 2,
              workletSampleRate,
            );
            const thirdSafety = ouroborouselFrequencySafety(
              sourceHz * 3,
              workletSampleRate,
            );
            const carrier = (
              Math.sin(carrierAngle)
              + Math.sin(carrierAngle * 2) * brightness * 0.28 * secondSafety
              + Math.sin(carrierAngle * 3)
                * brightness * brightness * 0.12 * thirdSafety
            ) / (1 + brightness * 0.28 + brightness * brightness * 0.12);
            const automaticGate = this.transportGain * (
              chunkGain * envelope + toneGain
            );
            const voiceSample = carrier * (
              automaticGate + manualEnvelope * manualWeight
            );
            noteLeftSample += voiceSample * noteWeight * Math.cos(panAngle);
            noteRightSample += voiceSample * noteWeight * Math.sin(panAngle);
            noteWeightPower += noteWeight * noteWeight;
          }
          if (drumWeight > 1e-9) {
            drumLeftSample += drumVoiceSample * drumWeight * Math.cos(panAngle);
            drumRightSample += drumVoiceSample * drumWeight * Math.sin(panAngle);
            drumWeightPower += drumWeight * drumWeight;
          }
          hitRate *= 2;
        }

        // When returning from Drums, note lifts still adopt their coupled-safe
        // values only at their own zero-phase pulse boundaries. Hold the drum
        // side of the material crossfade until one fully-safe note lane is
        // actually ready; then the ordinary slew introduces it from zero.
        if (
          this.targetMaterialMix >= this.currentMaterialMix
          || noteMaterialReady
        ) {
          this.currentMaterialMix += (
            this.targetMaterialMix - this.currentMaterialMix
          ) * parameterSlew;
        }

        const noteNormalization = noteWeightPower > 1e-12
          ? 1 / Math.sqrt(noteWeightPower)
          : 0;
        const drumNormalization = drumWeightPower > 1e-12
          ? 1 / Math.sqrt(drumWeightPower)
          : 0;
        const noteMaterialGain = Math.cos(
          this.currentMaterialMix * Math.PI * 0.5,
        );
        const drumMaterialGain = Math.sin(
          this.currentMaterialMix * Math.PI * 0.5,
        );
        left[sampleIndex] = (
          noteLeftSample * noteNormalization * noteOutputScale * noteMaterialGain
          + drumLeftSample * drumNormalization * drumOutputScale * drumMaterialGain
        ) * this.activeGain;
        if (right !== left) {
          right[sampleIndex] = (
            noteRightSample * noteNormalization * noteOutputScale * noteMaterialGain
            + drumRightSample
              * drumNormalization * drumOutputScale * drumMaterialGain
          ) * this.activeGain;
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

/** Lazy, autoplay-safe Web Audio wrapper for the Ouroborousel worklet. */
export class OuroborouselAudio {
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
    this.enabled = false;
    this.transportRunning = false;
    this.params = { ...OUROBOROUSEL_DEFAULTS };
    this.level = OUROBOROUSEL_DEFAULTS.level;
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
      throw new Error("Ouroborousel requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./ouroborousel.js", import.meta.url),
      );
      const WorkletNode = this.runtime.AudioWorkletNode
        ?? globalThis.AudioWorkletNode;
      if (typeof WorkletNode !== "function") {
        throw new Error("Ouroborousel requires AudioWorkletNode support.");
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
      highpass.frequency.value = 24;
      highpass.Q.value = 0.707;
      lowpass.type = "lowpass";
      lowpass.frequency.value = this.params.cutoff;
      lowpass.Q.value = 0.707;
      compressor.threshold.value = -14;
      compressor.knee.value = 7;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.15;
      ceiling.curve = createSoftCeilingCurve();
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
      this.releaseAudioOutput = connectAudioOutput(context, analyser, {
        runtime: this.runtime,
      });

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
    const safe = sanitizeOuroborouselParams({ ...this.params, ...params });
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
    if (this.enabled) {
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
    if (this.enabled) return;
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "audible", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.level, now + 0.035);
    this.enabled = true;
  }

  async start() {
    await this.enable();
    this.setTransport(true);
  }

  setTransport(running) {
    const next = Boolean(running);
    if (!this.isInitialized || !this.enabled) {
      if (!next) this.transportRunning = false;
      return false;
    }
    this.node.port.postMessage({ type: "transport", value: next });
    this.transportRunning = next;
    return true;
  }

  stopTransport() {
    return this.setTransport(false);
  }

  setPosition(position) {
    if (!this.isInitialized || !this.enabled) return false;
    const numeric = Number(position);
    if (!Number.isFinite(numeric)) return false;
    this.node.port.postMessage({
      type: "position",
      value: wrapUnit(numeric),
    });
    return true;
  }

  strike(velocity = 1, position = null) {
    if (!this.isInitialized || !this.enabled) return false;
    const message = {
      type: "strike",
      velocity: clamp(velocity, 0, 1, 1),
    };
    if (position !== null && position !== undefined) {
      const numeric = Number(position);
      if (Number.isFinite(numeric)) {
        message.position = clamp(numeric, 0, 1, 0.5);
      }
    }
    this.node.port.postMessage(message);
    return true;
  }

  accent(velocity = 1, position = null) {
    return this.strike(velocity, position);
  }

  stop() {
    if (!this.isInitialized || !this.enabled) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.node.port.postMessage({ type: "transport", value: false });
    this.node.port.postMessage({ type: "audible", value: false });
    this.transportRunning = false;
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
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
    this.enabled = false;
    this.transportRunning = false;
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
