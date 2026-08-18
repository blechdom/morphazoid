import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-drum-roll-please";
const TAU = Math.PI * 2;
const LAYER_COUNT = 17;
const LAYER_CENTER = Math.floor(LAYER_COUNT / 2);
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_FULL_HIT_RATE = 0.125;
const MIN_HIT_RATE = 0.0625;
const MAX_FULL_HIT_RATE = 48;
const MAX_HIT_RATE = 96;
const MODE_COUNT = 4;
export const DRUM_ROLL_PHASE_SEED = 0.1375035237;
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

export const DRUM_ROLL_DEFAULTS = Object.freeze({
  direction: 1,
  driftRate: 0.12,
  centerRate: 4,
  width: 5,
  decay: 0.12,
  character: 0.52,
  spread: 0.34,
  level: 0.58,
  pitchFollow: false,
  centerPitch: 110,
  cutoff: 8_000,
  stripeAngle: 38,
  morphDepth: 1,
});

export const DRUM_ROLL_PRESETS = Object.freeze([
  Object.freeze({
    id: "classic-acceleration",
    label: "Classic acceleration",
    description: "balanced · rising",
    ...DRUM_ROLL_DEFAULTS,
  }),
  Object.freeze({
    id: "reverse-forever",
    label: "Reverse forever",
    description: "balanced · falling",
    ...DRUM_ROLL_DEFAULTS,
    direction: -1,
  }),
  Object.freeze({
    id: "slow-avalanche",
    label: "Slow avalanche",
    description: "wide · deep skin",
    ...DRUM_ROLL_DEFAULTS,
    direction: 1,
    driftRate: 0.045,
    centerRate: 1.6,
    width: 7,
    decay: 0.32,
    character: 0.33,
    spread: 0.2,
    level: 0.6,
  }),
  Object.freeze({
    id: "terminal-tremolo",
    label: "Terminal tremolo",
    description: "narrow · pitched ascent",
    ...DRUM_ROLL_DEFAULTS,
    direction: 1,
    driftRate: 0.55,
    centerRate: 8,
    width: 4,
    decay: 0.055,
    character: 0.7,
    spread: 0.58,
    level: 0.54,
    pitchFollow: true,
    centerPitch: 165,
    stripeAngle: 58,
  }),
  Object.freeze({
    id: "chrome-rattle",
    label: "Chrome rattle",
    description: "bright · pitched revolving",
    ...DRUM_ROLL_DEFAULTS,
    direction: 1,
    driftRate: 0.28,
    centerRate: 5.5,
    width: 5.5,
    decay: 0.075,
    character: 0.84,
    spread: 0.7,
    level: 0.52,
    pitchFollow: true,
    centerPitch: 190,
    cutoff: 15_000,
    stripeAngle: 52,
  }),
  Object.freeze({
    id: "deep-rotor",
    label: "Deep rotor",
    description: "descending · resonant",
    ...DRUM_ROLL_DEFAULTS,
    direction: -1,
    driftRate: 0.18,
    centerRate: 2.5,
    width: 6,
    decay: 0.26,
    character: 0.18,
    spread: 0.46,
    level: 0.62,
    centerPitch: 92,
    cutoff: 8_500,
    stripeAngle: 34,
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

function booleanValue(value, fallback = false) {
  if (value === true || value === 1 || value === "true" || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === "false" || value === "0") {
    return false;
  }
  return fallback;
}

export function sanitizeDrumRollParams(params = {}) {
  const directionValue = Number(params.direction);
  const direction = Number.isFinite(directionValue)
    ? directionValue < 0 ? -1 : 1
    : DRUM_ROLL_DEFAULTS.direction;
  return Object.freeze({
    direction,
    driftRate: clamp(
      params.driftRate,
      0.02,
      1.2,
      DRUM_ROLL_DEFAULTS.driftRate,
    ),
    centerRate: clamp(
      params.centerRate,
      0.5,
      16,
      DRUM_ROLL_DEFAULTS.centerRate,
    ),
    width: clamp(params.width, 3, 9, DRUM_ROLL_DEFAULTS.width),
    decay: clamp(params.decay, 0.02, 1.5, DRUM_ROLL_DEFAULTS.decay),
    character: clamp(
      params.character,
      0,
      1,
      DRUM_ROLL_DEFAULTS.character,
    ),
    spread: clamp(params.spread, 0, 1, DRUM_ROLL_DEFAULTS.spread),
    level: clamp(params.level, 0, 0.82, DRUM_ROLL_DEFAULTS.level),
    pitchFollow: booleanValue(
      params.pitchFollow,
      DRUM_ROLL_DEFAULTS.pitchFollow,
    ),
    centerPitch: clamp(
      params.centerPitch,
      45,
      880,
      DRUM_ROLL_DEFAULTS.centerPitch,
    ),
    cutoff: clamp(params.cutoff, 800, 18_000, DRUM_ROLL_DEFAULTS.cutoff),
    stripeAngle: clamp(
      params.stripeAngle,
      12,
      78,
      DRUM_ROLL_DEFAULTS.stripeAngle,
    ),
    morphDepth: clamp(
      params.morphDepth,
      0,
      1,
      DRUM_ROLL_DEFAULTS.morphDepth,
    ),
  });
}

function rattleSigmoid(frequency, crossover) {
  const distance = Math.log2(frequency / crossover) / RATTLE_MORPH_WIDTH;
  return 1 / (1 + Math.exp(-4 * distance));
}

/** Position in the Rattlesnake's kick-to-air palette for one visible layer. */
export function drumRollMorphPosition(
  octaveOffset,
  width = DRUM_ROLL_DEFAULTS.width,
  character = DRUM_ROLL_DEFAULTS.character,
  morphDepth = DRUM_ROLL_DEFAULTS.morphDepth,
) {
  const safeWidth = clamp(width, 3, 9, DRUM_ROLL_DEFAULTS.width);
  const base = clamp(0.5 + Number(octaveOffset) / safeWidth, 0, 1, 0.5);
  const depth = clamp(morphDepth, 0, 1, DRUM_ROLL_DEFAULTS.morphDepth);
  const bias = (clamp(character, 0, 1, DRUM_ROLL_DEFAULTS.character) - 0.5)
    * 0.36;
  return clamp(0.5 + (base - 0.5) * depth + bias, 0, 1, 0.5);
}

/** The same smooth kick/tom/hand/air crossovers used by Rattlesnake. */
export function drumRollMorphWeights(morphPosition) {
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

export function drumRollCharacterLabel(weights = {}) {
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
 * Cosine window on a logarithmic tempo axis. At either edge the layer is
 * exactly silent, which is what lets it reappear at the opposite rate.
 */
export function drumRollWindow(octaveOffset, width) {
  const safeWidth = clamp(width, 3, 9, DRUM_ROLL_DEFAULTS.width);
  const distance = Math.abs(Number(octaveOffset)) / (safeWidth * 0.5);
  if (!Number.isFinite(distance) || distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

/**
 * Keep the upper bank perceptually rhythmic. Above 48 strikes per second the
 * pulse weight fades with a raised cosine, reaching silence at 96 /s before
 * the transient train can turn into a strongly aliased pitched oscillator.
 */
export function drumRollRateSafety(hitRate) {
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

export function advanceDrumRollPosition(position, delta) {
  const raw = wrapUnit(position) + (Number.isFinite(delta) ? delta : 0);
  return Object.freeze({
    position: wrapUnit(raw),
    wraps: Math.floor(raw),
  });
}

/**
 * Describe the instantaneous Risset rhythm bank. Frequencies in the pitch
 * version become strike rates here; neighboring layers therefore remain
 * exactly one tempo octave (2:1) apart.
 */
export function calculateDrumRollLayers({
  position = 0,
  sampleRate = DEFAULT_SAMPLE_RATE,
  layerCount = LAYER_COUNT,
  ...params
} = {}) {
  const safe = sanitizeDrumRollParams(params);
  const count = Math.max(5, Math.round(clamp(layerCount, 5, 33, LAYER_COUNT)));
  const center = Math.floor(count / 2);
  const phase = wrapUnit(position);
  const layers = [];
  let activeLayers = 0;
  let totalHitRate = 0;
  let weightPower = 0;

  for (let index = 0; index < count; index += 1) {
    const octaveOffset = -center + phase + index;
    const hitRate = safe.centerRate * 2 ** octaveOffset;
    const window = drumRollWindow(octaveOffset, safe.width);
    const safety = drumRollRateSafety(hitRate, sampleRate);
    const weight = window * safety;
    const normalizedOffset = octaveOffset / Math.max(1.5, safe.width * 0.5);
    const pan = clamp(normalizedOffset, -1, 1, 0) * safe.spread;
    const morphPosition = drumRollMorphPosition(
      octaveOffset,
      safe.width,
      safe.character,
      safe.morphDepth,
    );
    const morphWeights = drumRollMorphWeights(morphPosition);
    const fundamentalHz = safe.centerPitch * 2 ** (
      safe.pitchFollow ? octaveOffset : 0
    );
    const active = weight > 1e-9;
    if (active) {
      activeLayers += 1;
      totalHitRate += hitRate;
    }
    weightPower += weight * weight;
    layers.push({
      index,
      octaveOffset,
      hitRate,
      rate: hitRate,
      bpm: hitRate * 60,
      window,
      safety,
      weight,
      pan,
      morphPosition,
      morphWeights,
      characterLabel: drumRollCharacterLabel(morphWeights),
      fundamentalHz,
      sourceHz: fundamentalHz,
      active,
    });
  }

  const normalization = weightPower > 1e-12
    ? 1 / Math.sqrt(weightPower)
    : 0;
  const frozenLayers = layers.map((layer) => {
    const repetitionCompensation = 1;
    const overlapCompensation = 1 / Math.sqrt(
      1 + layer.hitRate * safe.decay * 0.7,
    );
    return Object.freeze({
      ...layer,
      repetitionCompensation,
      overlapCompensation,
      gain: layer.weight
        * normalization
        * repetitionCompensation
        * overlapCompensation,
    });
  });

  return Object.freeze({
    position: phase,
    direction: safe.direction,
    pitchFollow: safe.pitchFollow,
    layers: Object.freeze(frozenLayers),
    activeLayers,
    audibleLayers: activeLayers,
    totalHitRate,
    weightPower,
    normalization,
  });
}

export function createSoftCeilingCurve(
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

function weightedRattleValue(values, kick, tom, hand, air) {
  return values[0] * kick
    + values[1] * tom
    + values[2] * hand
    + values[3] * air;
}

function advanceNoiseSeed(value) {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) || 0x9e3779b9;
}

function clearLayerVoice(processor, layer) {
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

function copyLayerVoice(processor, destination, source) {
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

function rotateLayerStateUp(processor) {
  for (let index = LAYER_COUNT - 1; index > 0; index -= 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index - 1];
    copyLayerVoice(processor, index, index - 1);
  }
  processor.pulsePhases[0] = wrapUnit(processor.pulsePhases[1] * 0.5);
  clearLayerVoice(processor, 0);
}

function rotateLayerStateDown(processor) {
  const last = LAYER_COUNT - 1;
  for (let index = 0; index < last; index += 1) {
    processor.pulsePhases[index] = processor.pulsePhases[index + 1];
    copyLayerVoice(processor, index, index + 1);
  }
  processor.pulsePhases[last] = wrapUnit(processor.pulsePhases[last - 1] * 2);
  clearLayerVoice(processor, last);
}

function rotateForWraps(processor, wraps) {
  if (wraps > 0) {
    for (let index = 0; index < wraps; index += 1) {
      rotateLayerStateUp(processor);
    }
  } else if (wraps < 0) {
    for (let index = 0; index > wraps; index -= 1) {
      rotateLayerStateDown(processor);
    }
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidDrumRollPleaseProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeDrumRollParams(options.processorOptions ?? {});
      this.target = { ...initial };
      this.current = { ...initial };
      this.current.pitchFollow = initial.pitchFollow ? 1 : 0;
      this.position = 0;
      this.pulsePhases = new Float64Array(LAYER_COUNT);
      this.slowEnvelopes = new Float64Array(LAYER_COUNT);
      this.fastEnvelopes = new Float64Array(LAYER_COUNT);
      this.pitchBends = new Float64Array(LAYER_COUNT);
      this.bodyNoiseLow = new Float64Array(LAYER_COUNT);
      this.bodyNoiseHigh = new Float64Array(LAYER_COUNT);
      this.airNoiseLow = new Float64Array(LAYER_COUNT);
      this.noiseSeeds = new Uint32Array(LAYER_COUNT);
      this.modalRe = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.modalIm = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.modalCos = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.modalSin = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.modalDecay = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.modalGain = new Float64Array(LAYER_COUNT * MODE_COUNT);
      this.morphPositions = new Float64Array(LAYER_COUNT);
      this.kickWeights = new Float64Array(LAYER_COUNT);
      this.tomWeights = new Float64Array(LAYER_COUNT);
      this.handWeights = new Float64Array(LAYER_COUNT);
      this.airWeights = new Float64Array(LAYER_COUNT);
      this.bodyDecays = new Float64Array(LAYER_COUNT);
      this.highDampings = new Float64Array(LAYER_COUNT);
      this.pitchDrops = new Float64Array(LAYER_COUNT);
      this.pitchDropTimes = new Float64Array(LAYER_COUNT);
      this.pitchBendDecays = new Float64Array(LAYER_COUNT);
      this.noiseMixes = new Float64Array(LAYER_COUNT);
      this.noiseDecays = new Float64Array(LAYER_COUNT);
      this.noiseColors = new Float64Array(LAYER_COUNT);
      this.bodyMixes = new Float64Array(LAYER_COUNT);
      this.bodyNoiseLowCoefficients = new Float64Array(LAYER_COUNT);
      this.bodyNoiseHighCoefficients = new Float64Array(LAYER_COUNT);
      this.airNoiseCoefficients = new Float64Array(LAYER_COUNT);
      this.impactSlowDecays = new Float64Array(LAYER_COUNT);
      this.noiseSeedCounter = 0x6d2b79f5;
      let multiplier = 1;
      for (let index = 0; index < LAYER_COUNT; index += 1) {
        this.pulsePhases[index] = wrapUnit(
          DRUM_ROLL_PHASE_SEED * multiplier,
        );
        this.noiseSeedCounter = advanceNoiseSeed(this.noiseSeedCounter);
        this.noiseSeeds[index] = this.noiseSeedCounter;
        multiplier *= 2;
      }
      this.activeTarget = 0;
      this.activeGain = 0;
      this.updateVoiceCoefficients(DEFAULT_SAMPLE_RATE);
      this.port.onmessage = (event) => {
        if (event.data?.type === "parameters") {
          this.target = {
            ...this.target,
            ...sanitizeDrumRollParams({
              ...this.target,
              ...event.data.parameters,
            }),
          };
        } else if (event.data?.type === "active") {
          this.activeTarget = event.data.value ? 1 : 0;
        }
      };
    }

    updateVoiceCoefficients(workletSampleRate) {
      const safeWidth = Math.max(3, this.current.width);
      const firstOffset = -LAYER_CENTER + this.position;
      const pitchTrack = Math.max(0, Math.min(1, this.current.pitchFollow));
      const decayScale = Math.max(0.02, this.current.decay) / 0.76;
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
        this.kickWeights[layer] = kick;
        this.tomWeights[layer] = tom;
        this.handWeights[layer] = hand;
        this.airWeights[layer] = air;

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
        ) * 0.58;
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
        this.pitchDropTimes[layer] = pitchDropTime;
        this.pitchBendDecays[layer] = Math.exp(
          -1 / (workletSampleRate * Math.max(0.008, pitchDropTime)),
        );
        this.noiseMixes[layer] = noiseMix;
        this.noiseDecays[layer] = noiseDecay;
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
          pitchTrack * octaveOffset + this.pitchBends[layer]
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
          const ratio = RATTLE_RATIOS[0][mode] * kick
            + RATTLE_RATIOS[1][mode] * tom
            + RATTLE_RATIOS[2][mode] * hand
            + RATTLE_RATIOS[3][mode] * air;
          const rawGain = RATTLE_GAINS[0][mode] * kick
            + RATTLE_GAINS[1][mode] * tom
            + RATTLE_GAINS[2][mode] * hand
            + RATTLE_GAINS[3][mode] * air;
          const modeFrequency = Math.max(18, fundamental * ratio);
          let aliasFade = 1;
          if (modeFrequency >= nyquistCull) aliasFade = 0;
          else if (modeFrequency > nyquistTaper) {
            aliasFade = (nyquistCull - modeFrequency)
              / (nyquistCull - nyquistTaper);
          }
          const stateIndex = modeBase + mode;
          const boundedFrequency = Math.min(nyquistCull, modeFrequency);
          const radians = TAU * boundedFrequency / workletSampleRate;
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
      const outputScale = 0.38;
      this.updateVoiceCoefficients(workletSampleRate);

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.current.direction += (
          this.target.direction - this.current.direction
        ) * parameterSlew;
        this.current.driftRate += (
          this.target.driftRate - this.current.driftRate
        ) * parameterSlew;
        this.current.centerRate += (
          this.target.centerRate - this.current.centerRate
        ) * parameterSlew;
        this.current.width += (
          this.target.width - this.current.width
        ) * parameterSlew;
        this.current.decay += (
          this.target.decay - this.current.decay
        ) * parameterSlew;
        this.current.character += (
          this.target.character - this.current.character
        ) * parameterSlew;
        this.current.spread += (
          this.target.spread - this.current.spread
        ) * parameterSlew;
        this.current.centerPitch += (
          this.target.centerPitch - this.current.centerPitch
        ) * parameterSlew;
        this.current.morphDepth += (
          this.target.morphDepth - this.current.morphDepth
        ) * parameterSlew;
        this.current.pitchFollow += (
          (this.target.pitchFollow ? 1 : 0) - this.current.pitchFollow
        ) * parameterSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;

        const transportActive = this.activeTarget > 0.5;
        if (transportActive) {
          const rawPosition = this.position + (
            this.current.direction
            * this.current.driftRate
            / workletSampleRate
          );
          const wraps = Math.floor(rawPosition);
          this.position = ((rawPosition % 1) + 1) % 1;
          if (wraps !== 0) {
            rotateForWraps(this, wraps);
            this.updateVoiceCoefficients(workletSampleRate);
          }
        }

        const halfWidth = Math.max(1.5, this.current.width * 0.5);
        const firstOffset = -LAYER_CENTER + this.position;
        let hitRate = this.current.centerRate * 2 ** firstOffset;
        let leftSample = 0;
        let rightSample = 0;
        let weightPower = 0;

        for (let index = 0; index < LAYER_COUNT; index += 1) {
          const octaveOffset = firstOffset + index;
          const distance = Math.abs(octaveOffset) / halfWidth;
          let weight = 0;
          if (distance < 1) {
            const window = 0.5 + 0.5 * Math.cos(Math.PI * distance);
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
            weight = window * safety;
          }

          let strikes = 0;
          if (transportActive) {
            const nextPhase = this.pulsePhases[index]
              + hitRate / workletSampleRate;
            strikes = Math.floor(nextPhase);
            this.pulsePhases[index] = nextPhase - strikes;
          }
          if (strikes > 0 && weight > 1e-7) {
            const velocity = Math.min(1, strikes) / Math.sqrt(
              1 + hitRate * this.bodyDecays[index] * 0.7,
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

          if (weight > 0) {
            const normalizedOffset = octaveOffset / halfWidth;
            const pan = Math.max(-1, Math.min(1, normalizedOffset))
              * this.current.spread;
            const panAngle = (pan + 1) * Math.PI * 0.25;
            leftSample += voiceSample * weight * Math.cos(panAngle);
            rightSample += voiceSample * weight * Math.sin(panAngle);
            weightPower += weight * weight;
          }
          hitRate *= 2;
        }

        const normalization = weightPower > 1e-12
          ? 1 / Math.sqrt(weightPower)
          : 0;
        const protectedGain = outputScale * normalization * this.activeGain;
        left[sampleIndex] = Math.tanh(
          leftSample * protectedGain,
        );
        if (right !== left) {
          right[sampleIndex] = Math.tanh(
            rightSample * protectedGain,
          );
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
 * Lazy Web Audio wrapper. The continuously running render node is created
 * only from start(), keeping page load silent and browser-autoplay safe.
 */
export class DrumRollPleaseAudio {
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
    this.params = { ...DRUM_ROLL_DEFAULTS };
    this.level = DRUM_ROLL_DEFAULTS.level;
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
      throw new Error("Drum Roll Please! requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./drum-roll-please.js", import.meta.url),
      );
      const WorkletNode = this.runtime.AudioWorkletNode
        ?? globalThis.AudioWorkletNode;
      if (typeof WorkletNode !== "function") {
        throw new Error("Drum Roll Please! requires AudioWorkletNode support.");
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
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

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
    const safe = sanitizeDrumRollParams({ ...this.params, ...params });
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

  async start() {
    await this.initialize();
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    await this.context.resume();
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.level, now + 0.035);
    this.enabled = true;
  }

  stop() {
    if (!this.isInitialized || !this.enabled) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.node.port.postMessage({ type: "active", value: false });
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
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.node?.port.postMessage({ type: "active", value: false });
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
