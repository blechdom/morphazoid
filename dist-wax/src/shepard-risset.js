import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-shepard-risset";
const TAU = Math.PI * 2;
const PARTIAL_COUNT = 17;
const PARTIAL_CENTER = Math.floor(PARTIAL_COUNT / 2);
const MAX_MORPHISMA_VOICES = 64;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const DEFAULT_SAMPLE_RATE = 48_000;
const ANTI_ALIAS_TAPER_RATIO = 0.4;
const ANTI_ALIAS_CULL_RATIO = 0.45;

export const SHEPARD_MODES = Object.freeze({
  OCTAVE: "octave",
  MORPHISMA: "morphisma",
});

export const SHEPARD_DEFAULTS = Object.freeze({
  centerFrequency: 220,
  rate: 0.12,
  width: 5,
  spread: 0.26,
  cutoff: 12_000,
  level: 0.58,
});

export const SHEPARD_PRESETS = Object.freeze([
  Object.freeze({
    id: "classic-rise",
    label: "Classic rise",
    centerFrequency: 220,
    rate: 0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  }),
  Object.freeze({
    id: "classic-fall",
    label: "Classic fall",
    centerFrequency: 220,
    rate: -0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  }),
  Object.freeze({
    id: "tight-spiral",
    label: "Tight spiral",
    centerFrequency: 330,
    rate: 0.42,
    width: 3.5,
    spread: 0.52,
    cutoff: 14_000,
  }),
  Object.freeze({
    id: "deep-descent",
    label: "Deep descent",
    centerFrequency: 82,
    rate: -0.07,
    width: 7,
    spread: 0.18,
    cutoff: 8_500,
  }),
]);

export const MORPHISMA_SWEEP_DEFAULTS = Object.freeze({
  voices: 8,
  sweepRate: 0.05,
  startFrequency: 100,
  sweepRange: 2,
  direction: 1,
  cutoff: 18_000,
});

export const MORPHISMA_SWEEP_PRESETS = Object.freeze([
  Object.freeze({
    id: "classic-rise",
    label: "Classic Rise",
    voices: 8,
    sweepRate: 0.05,
    startFrequency: 100,
    sweepRange: 2,
    direction: 1,
  }),
  Object.freeze({
    id: "classic-fall",
    label: "Classic Fall",
    voices: 8,
    sweepRate: 0.05,
    startFrequency: 200,
    sweepRange: 1.5,
    direction: -1,
  }),
  Object.freeze({
    id: "tight-spiral",
    label: "Tight Spiral",
    voices: 2,
    sweepRate: 5,
    startFrequency: 135,
    sweepRange: 3.7,
    direction: 1,
  }),
  Object.freeze({
    id: "micro-cluster",
    label: "Micro Cluster",
    voices: 8,
    sweepRate: 0.06,
    startFrequency: 660,
    sweepRange: 0.12,
    direction: -1,
  }),
  Object.freeze({
    id: "wide-staircase",
    label: "Wide Staircase",
    voices: 6,
    sweepRate: 0.75,
    startFrequency: 212,
    sweepRange: 4,
    direction: 1,
  }),
  Object.freeze({
    id: "swarm",
    label: "Swarm",
    voices: 64,
    sweepRate: 0.15,
    startFrequency: 80,
    sweepRange: 2,
    direction: 1,
  }),
  Object.freeze({
    id: "screaming-descent",
    label: "Screaming Descent",
    voices: 12,
    sweepRate: 3.5,
    startFrequency: 2_400,
    sweepRange: 5,
    direction: -1,
  }),
  Object.freeze({
    id: "sub-rumble",
    label: "Sub Rumble",
    voices: 32,
    sweepRate: 0.02,
    startFrequency: 25,
    sweepRange: 2,
    direction: 1,
  }),
  Object.freeze({
    id: "glass-shatter",
    label: "Glass Shatter",
    voices: 16,
    sweepRate: 8,
    startFrequency: 1_200,
    sweepRange: 1.05,
    direction: 1,
  }),
  Object.freeze({
    id: "alien-siren",
    label: "Alien Siren",
    voices: 4,
    sweepRate: 2,
    startFrequency: 300,
    sweepRange: 7,
    direction: -1,
  }),
  Object.freeze({
    id: "dense-cloud",
    label: "Dense Cloud",
    voices: 48,
    sweepRate: 0.08,
    startFrequency: 55,
    sweepRange: 3,
    direction: 1,
  }),
  Object.freeze({
    id: "wobble-saw",
    label: "Wobble Saw",
    voices: 3,
    sweepRate: 6.5,
    startFrequency: 440,
    sweepRange: 0.5,
    direction: -1,
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

export function sanitizeShepardMode(mode) {
  return mode === SHEPARD_MODES.MORPHISMA
    ? SHEPARD_MODES.MORPHISMA
    : SHEPARD_MODES.OCTAVE;
}

export function sanitizeMorphismaSweepParams(params = {}) {
  const numericDirection = Number(params.direction);
  const fallbackDirection = MORPHISMA_SWEEP_DEFAULTS.direction;
  const direction = Number.isFinite(numericDirection)
    ? numericDirection < 0 ? -1 : 1
    : fallbackDirection;
  return Object.freeze({
    voices: Math.round(clamp(
      params.voices,
      1,
      MAX_MORPHISMA_VOICES,
      MORPHISMA_SWEEP_DEFAULTS.voices,
    )),
    sweepRate: clamp(
      params.sweepRate,
      0.01,
      10,
      MORPHISMA_SWEEP_DEFAULTS.sweepRate,
    ),
    startFrequency: clamp(
      params.startFrequency,
      10,
      3_000,
      MORPHISMA_SWEEP_DEFAULTS.startFrequency,
    ),
    sweepRange: clamp(
      params.sweepRange,
      0.01,
      8,
      MORPHISMA_SWEEP_DEFAULTS.sweepRange,
    ),
    direction,
  });
}

export function morphismaSweepEnvelope(phase) {
  const p = wrapUnit(Number(phase));
  return (Math.sin(TAU * p - 1.5) + 1) * 0.5;
}

export function morphismaSweepFrequency(phase, params = {}) {
  const safe = sanitizeMorphismaSweepParams(params);
  const p = wrapUnit(Number(phase));
  const directedPhase = safe.direction < 0 ? 1 - p : p;
  return safe.startFrequency + directedPhase * directedPhase
    * (safe.startFrequency * safe.sweepRange * safe.voices);
}

export function morphismaAntiAliasWeight(
  frequency,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const safeFrequency = Math.abs(Number(frequency));
  if (!Number.isFinite(safeFrequency)) return 0;
  if (safeFrequency < MIN_FREQUENCY) return 0;
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    384_000,
    DEFAULT_SAMPLE_RATE,
  );
  const frequencyCeiling = Math.min(
    MAX_FREQUENCY,
    safeSampleRate * ANTI_ALIAS_CULL_RATIO,
  );
  const taperStart = Math.min(
    safeSampleRate * ANTI_ALIAS_TAPER_RATIO,
    frequencyCeiling * 0.96,
  );
  if (safeFrequency <= taperStart) return 1;
  if (safeFrequency >= frequencyCeiling || frequencyCeiling <= taperStart) {
    return 0;
  }
  const position = (safeFrequency - taperStart)
    / (frequencyCeiling - taperStart);
  return 0.5 + 0.5 * Math.cos(Math.PI * position);
}

export function calculateMorphismaSweepVoices({
  position = 0,
  voices = MORPHISMA_SWEEP_DEFAULTS.voices,
  sweepRate = MORPHISMA_SWEEP_DEFAULTS.sweepRate,
  startFrequency = MORPHISMA_SWEEP_DEFAULTS.startFrequency,
  sweepRange = MORPHISMA_SWEEP_DEFAULTS.sweepRange,
  direction = MORPHISMA_SWEEP_DEFAULTS.direction,
  sampleRate = DEFAULT_SAMPLE_RATE,
} = {}) {
  const safe = sanitizeMorphismaSweepParams({
    voices,
    sweepRate,
    startFrequency,
    sweepRange,
    direction,
  });
  const basePhase = wrapUnit(Number(position));
  const descriptors = [];
  let audibleVoices = 0;
  let weightPower = 0;

  for (let index = 0; index < safe.voices; index += 1) {
    const phase = wrapUnit(basePhase + index / safe.voices);
    const directedPhase = safe.direction < 0 ? 1 - phase : phase;
    const frequency = safe.startFrequency + directedPhase * directedPhase
      * (safe.startFrequency * safe.sweepRange * safe.voices);
    const envelope = morphismaSweepEnvelope(phase);
    const antiAlias = morphismaAntiAliasWeight(frequency, sampleRate);
    const weight = envelope * antiAlias;
    const gain = weight / safe.voices;
    const active = weight > 0;
    if (active) audibleVoices += 1;
    weightPower += weight * weight;
    descriptors.push(Object.freeze({
      index,
      phase,
      directedPhase,
      frequency,
      envelope,
      antiAlias,
      weight,
      gain,
      active,
    }));
  }

  return Object.freeze({
    requestedVoices: safe.voices,
    audibleVoices,
    weightPower,
    normalization: weightPower > 1e-12 ? 1 / Math.sqrt(weightPower) : 0,
    voices: Object.freeze(descriptors),
  });
}

/**
 * Advance a unit phasor while retaining the number and direction of wraps.
 * Keeping this information lets the worklet rotate oscillator phases onto
 * their octave neighbours at the otherwise discontinuous seam.
 */
export function advanceUnitPosition(position, delta) {
  const raw = wrapUnit(position) + (Number.isFinite(delta) ? delta : 0);
  const wraps = Math.floor(raw);
  return Object.freeze({
    position: wrapUnit(raw),
    wraps,
  });
}

export function shepardWindow(octaveOffset, width) {
  const safeWidth = clamp(width, 3, 9, SHEPARD_DEFAULTS.width);
  const distance = Math.abs(octaveOffset) / (safeWidth * 0.5);
  if (distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

export function sanitizeShepardParams(params = {}) {
  return Object.freeze({
    centerFrequency: clamp(
      params.centerFrequency,
      40,
      2_000,
      SHEPARD_DEFAULTS.centerFrequency,
    ),
    rate: clamp(params.rate, -2, 2, SHEPARD_DEFAULTS.rate),
    width: clamp(params.width, 3, 9, SHEPARD_DEFAULTS.width),
    spread: clamp(params.spread, 0, 1, SHEPARD_DEFAULTS.spread),
    cutoff: clamp(params.cutoff, 800, 18_000, SHEPARD_DEFAULTS.cutoff),
    level: clamp(params.level, 0, 0.82, SHEPARD_DEFAULTS.level),
  });
}

/**
 * Describe the current octave bank without allocating or generating audio.
 * This is shared by tests and explanatory UI; the worklet uses the same
 * frequency/window rules in its sample loop.
 */
export function calculateShepardPartials({
  position = 0,
  centerFrequency = SHEPARD_DEFAULTS.centerFrequency,
  width = SHEPARD_DEFAULTS.width,
  spread = SHEPARD_DEFAULTS.spread,
  sampleRate = DEFAULT_SAMPLE_RATE,
  partialCount = PARTIAL_COUNT,
} = {}) {
  const safe = sanitizeShepardParams({ centerFrequency, width, spread });
  const count = Math.max(3, Math.floor(clamp(partialCount, 3, 33, PARTIAL_COUNT)));
  const center = Math.floor(count / 2);
  const phase = wrapUnit(position);
  const frequencyCeiling = Math.min(MAX_FREQUENCY, sampleRate * 0.45);
  const partials = [];
  let weightPower = 0;

  for (let index = 0; index < count; index += 1) {
    const octaveOffset = -center + phase + index;
    const frequency = safe.centerFrequency * 2 ** octaveOffset;
    const inBand = frequency >= MIN_FREQUENCY && frequency <= frequencyCeiling;
    const weight = inBand ? shepardWindow(octaveOffset, safe.width) : 0;
    const pan = clamp(
      octaveOffset / Math.max(1, safe.width * 0.5),
      -1,
      1,
      0,
    ) * safe.spread;
    weightPower += weight * weight;
    partials.push(Object.freeze({
      index,
      octaveOffset,
      frequency,
      weight,
      pan,
      active: weight > 0,
    }));
  }

  return Object.freeze({
    partials: Object.freeze(partials),
    weightPower,
    normalization: weightPower > 1e-12 ? 1 / Math.sqrt(weightPower) : 0,
  });
}

export function createSoftCeilingCurve(length = 2_049, drive = 1.3, ceiling = 0.92) {
  const size = Math.max(33, Math.floor(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.5, 4, 1.3);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.92);
  const scale = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * safeDrive) / scale * safeCeiling;
  }
  return curve;
}

function rotatePhasesUp(phases) {
  for (let index = phases.length - 1; index > 0; index -= 1) {
    phases[index] = phases[index - 1];
  }
  phases[0] = phases[1] * 0.754877666;
}

function rotatePhasesDown(phases) {
  for (let index = 0; index < phases.length - 1; index += 1) {
    phases[index] = phases[index + 1];
  }
  phases[phases.length - 1] = phases[phases.length - 2] * 1.324717957;
}

function rotateForWraps(phases, wraps) {
  if (wraps > 0) {
    for (let index = 0; index < wraps; index += 1) rotatePhasesUp(phases);
  } else if (wraps < 0) {
    for (let index = 0; index > wraps; index -= 1) rotatePhasesDown(phases);
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidShepardRissetProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const processorOptions = options.processorOptions ?? {};
      const initial = sanitizeShepardParams(
        processorOptions.octave ?? processorOptions,
      );
      const initialMorphisma = sanitizeMorphismaSweepParams(
        processorOptions.morphisma ?? processorOptions,
      );
      const initialMode = sanitizeShepardMode(processorOptions.mode);
      this.target = { ...initial };
      this.current = { ...initial };
      this.morphismaTarget = { ...initialMorphisma };
      this.morphismaCurrent = { ...initialMorphisma };
      this.position = 0;
      this.phases = new Float64Array(PARTIAL_COUNT);
      for (let index = 0; index < PARTIAL_COUNT; index += 1) {
        this.phases[index] = wrapUnit(index * 0.61803398875) * TAU;
      }
      this.morphismaPosition = 0;
      this.morphismaOscillatorPhases = new Float64Array(
        MAX_MORPHISMA_VOICES,
      );
      this.morphismaPhaseOffsets = new Float64Array(MAX_MORPHISMA_VOICES);
      this.morphismaTargetPhaseOffsets = new Float64Array(
        MAX_MORPHISMA_VOICES,
      );
      this.morphismaVoiceGains = new Float64Array(MAX_MORPHISMA_VOICES);
      this.morphismaTargetVoiceGains = new Float64Array(
        MAX_MORPHISMA_VOICES,
      );
      for (let index = 0; index < MAX_MORPHISMA_VOICES; index += 1) {
        const offset = index / initialMorphisma.voices;
        const gain = index < initialMorphisma.voices ? 1 : 0;
        this.morphismaOscillatorPhases[index] = 0;
        this.morphismaPhaseOffsets[index] = offset;
        this.morphismaTargetPhaseOffsets[index] = offset;
        this.morphismaVoiceGains[index] = gain;
        this.morphismaTargetVoiceGains[index] = gain;
      }
      this.modeBlendTarget = initialMode === SHEPARD_MODES.MORPHISMA ? 1 : 0;
      this.modeBlend = this.modeBlendTarget;
      this.activeTarget = 0;
      this.activeGain = 0;
      this.port.onmessage = (event) => {
        if (event.data?.type === "parameters") {
          const parameters = event.data.parameters ?? {};
          const octaveParameters = parameters.octave ?? parameters;
          const morphismaParameters = parameters.morphisma ?? parameters;
          this.target = {
            ...this.target,
            ...sanitizeShepardParams({
              ...this.target,
              ...octaveParameters,
            }),
          };
          this.morphismaTarget = {
            ...this.morphismaTarget,
            ...sanitizeMorphismaSweepParams({
              ...this.morphismaTarget,
              ...morphismaParameters,
            }),
          };
          this.setMorphismaVoiceTargets(this.morphismaTarget.voices);
          if (parameters.mode !== undefined) {
            this.modeBlendTarget = sanitizeShepardMode(parameters.mode)
              === SHEPARD_MODES.MORPHISMA ? 1 : 0;
          }
        } else if (event.data?.type === "active") {
          this.activeTarget = event.data.value ? 1 : 0;
        }
      };
    }

    setMorphismaVoiceTargets(voices) {
      const count = Math.max(
        1,
        Math.min(MAX_MORPHISMA_VOICES, Math.round(voices)),
      );
      for (let index = 0; index < MAX_MORPHISMA_VOICES; index += 1) {
        this.morphismaTargetPhaseOffsets[index] = index / count;
        this.morphismaTargetVoiceGains[index] = index < count ? 1 : 0;
      }
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const left = output[0];
      const right = output[1] ?? left;
      left.fill(0);
      if (right !== left) right.fill(0);

      const workletSampleRate = Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE;
      const frequencyCeiling = Math.min(MAX_FREQUENCY, workletSampleRate * 0.45);
      const morphismaFrequencyCeiling = Math.min(
        MAX_FREQUENCY,
        workletSampleRate * ANTI_ALIAS_CULL_RATIO,
      );
      const morphismaTaperStart = Math.min(
        workletSampleRate * ANTI_ALIAS_TAPER_RATIO,
        morphismaFrequencyCeiling * 0.96,
      );
      const morphismaTaperSpan = Math.max(
        1,
        morphismaFrequencyCeiling - morphismaTaperStart,
      );
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.035));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.008));
      const modeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.02));
      const outputScale = 0.42;

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.current.centerFrequency += (
          this.target.centerFrequency - this.current.centerFrequency
        ) * parameterSlew;
        this.current.rate += (this.target.rate - this.current.rate) * parameterSlew;
        this.current.width += (this.target.width - this.current.width) * parameterSlew;
        this.current.spread += (this.target.spread - this.current.spread) * parameterSlew;
        this.morphismaCurrent.voices += (
          this.morphismaTarget.voices - this.morphismaCurrent.voices
        ) * parameterSlew;
        this.morphismaCurrent.sweepRate += (
          this.morphismaTarget.sweepRate - this.morphismaCurrent.sweepRate
        ) * parameterSlew;
        this.morphismaCurrent.startFrequency += (
          this.morphismaTarget.startFrequency
          - this.morphismaCurrent.startFrequency
        ) * parameterSlew;
        this.morphismaCurrent.sweepRange += (
          this.morphismaTarget.sweepRange - this.morphismaCurrent.sweepRange
        ) * parameterSlew;
        this.morphismaCurrent.direction += (
          this.morphismaTarget.direction - this.morphismaCurrent.direction
        ) * parameterSlew;
        this.modeBlend += (this.modeBlendTarget - this.modeBlend) * modeSlew;
        this.activeGain += (this.activeTarget - this.activeGain) * activeSlew;

        // This is deliberately inlined instead of calling the exported helper:
        // the render thread must not allocate one result object per sample.
        const rawPosition = this.position + this.current.rate / workletSampleRate;
        const wraps = Math.floor(rawPosition);
        this.position = ((rawPosition % 1) + 1) % 1;
        if (wraps !== 0) rotateForWraps(this.phases, wraps);

        const halfWidth = Math.max(1.5, this.current.width * 0.5);
        const firstOffset = -PARTIAL_CENTER + this.position;
        let nextFrequency = this.current.centerFrequency * 2 ** firstOffset;
        let leftSum = 0;
        let rightSum = 0;
        let weightPower = 0;

        for (let index = 0; index < PARTIAL_COUNT; index += 1) {
          const octaveOffset = firstOffset + index;
          const frequency = nextFrequency;
          nextFrequency *= 2;

          this.phases[index] = (
            this.phases[index] + TAU * frequency / workletSampleRate
          ) % TAU;

          const distance = Math.abs(octaveOffset) / halfWidth;
          if (
            distance >= 1
            || frequency < MIN_FREQUENCY
            || frequency > frequencyCeiling
          ) continue;

          const weight = 0.5 + 0.5 * Math.cos(Math.PI * distance);
          const normalizedOffset = octaveOffset / halfWidth;
          const pan = Math.max(-1, Math.min(1, normalizedOffset))
            * this.current.spread;
          const panAngle = (pan + 1) * Math.PI * 0.25;
          const sample = Math.sin(this.phases[index]) * weight;
          leftSum += sample * Math.cos(panAngle);
          rightSum += sample * Math.sin(panAngle);
          weightPower += weight * weight;
        }

        const normalization = weightPower > 1e-12
          ? 1 / Math.sqrt(weightPower)
          : 0;

        const morphismaRawPosition = (
          this.morphismaPosition
          + this.morphismaCurrent.sweepRate / workletSampleRate
        );
        this.morphismaPosition = (
          (morphismaRawPosition % 1) + 1
        ) % 1;
        const directionMix = Math.max(
          0,
          Math.min(1, (this.morphismaCurrent.direction + 1) * 0.5),
        );
        const inverseDirectionMix = 1 - directionMix;
        const requestedVoices = Math.max(1, this.morphismaCurrent.voices);
        const frequencySpan = (
          this.morphismaCurrent.startFrequency
          * this.morphismaCurrent.sweepRange
          * requestedVoices
        );
        let morphismaSum = 0;

        for (
          let index = 0;
          index < MAX_MORPHISMA_VOICES;
          index += 1
        ) {
          this.morphismaPhaseOffsets[index] += (
            this.morphismaTargetPhaseOffsets[index]
            - this.morphismaPhaseOffsets[index]
          ) * parameterSlew;
          this.morphismaVoiceGains[index] += (
            this.morphismaTargetVoiceGains[index]
            - this.morphismaVoiceGains[index]
          ) * parameterSlew;

          const rawPhase = (
            this.morphismaPosition + this.morphismaPhaseOffsets[index]
          );
          const phase = rawPhase - Math.floor(rawPhase);
          const directedPhase = (
            phase * directionMix
            + (1 - phase) * inverseDirectionMix
          );
          const frequency = (
            this.morphismaCurrent.startFrequency
            + directedPhase * directedPhase * frequencySpan
          );
          this.morphismaOscillatorPhases[index] = (
            this.morphismaOscillatorPhases[index]
            + TAU * frequency / workletSampleRate
          ) % TAU;

          let antiAlias = 1;
          if (
            frequency < MIN_FREQUENCY
            || frequency >= morphismaFrequencyCeiling
          ) {
            antiAlias = 0;
          } else if (frequency > morphismaTaperStart) {
            const taperPosition = (
              (frequency - morphismaTaperStart) / morphismaTaperSpan
            );
            antiAlias = 0.5 + 0.5 * Math.cos(Math.PI * taperPosition);
          }
          const envelope = (
            Math.sin(TAU * phase - 1.5) + 1
          ) * 0.5;
          const voiceGain = (
            envelope
            * antiAlias
            * this.morphismaVoiceGains[index]
            / requestedVoices
          );
          morphismaSum += (
            Math.sin(this.morphismaOscillatorPhases[index]) * voiceGain
          );
        }

        const octaveMix = Math.cos(this.modeBlend * Math.PI * 0.5);
        const morphismaMix = Math.sin(this.modeBlend * Math.PI * 0.5);
        const protectedScale = outputScale * this.activeGain;
        left[sampleIndex] = protectedScale * (
          leftSum * normalization * octaveMix
          + morphismaSum * morphismaMix
        );
        if (right !== left) {
          right[sampleIndex] = protectedScale * (
            rightSum * normalization * octaveMix
            + morphismaSum * morphismaMix
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
 * A self-contained Web Audio graph. Construction is inert: the AudioContext
 * is deliberately created only by start(), which the page calls from the
 * user's Audio button gesture.
 */
export class ShepardRissetAudio {
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
    this.mode = SHEPARD_MODES.OCTAVE;
    this.level = SHEPARD_DEFAULTS.level;
    this.octaveParams = { ...SHEPARD_DEFAULTS };
    this.morphismaParams = { ...MORPHISMA_SWEEP_DEFAULTS };
    this.params = {
      mode: this.mode,
      ...this.octaveParams,
    };
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close();
      throw new Error("This instrument requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./shepard-risset.js", import.meta.url),
      );

      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          mode: this.mode,
          octave: this.octaveParams,
          morphisma: this.morphismaParams,
        },
      });
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = 28;
      highpass.Q.value = 0.707;
      lowpass.type = "lowpass";
      lowpass.frequency.value = this.mode === SHEPARD_MODES.MORPHISMA
        ? this.morphismaParams.cutoff
        : this.octaveParams.cutoff;
      lowpass.Q.value = 0.707;
      compressor.threshold.value = -12;
      compressor.knee.value = 7;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      ceiling.curve = createSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;

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
      this.setParameters({ mode: this.mode });
    } catch (error) {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      await context.close().catch(() => {});
      throw error;
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

  setParameters(params = {}) {
    const nextMode = params.mode === undefined
      ? this.mode
      : sanitizeShepardMode(params.mode);
    if (params.level !== undefined) {
      this.level = sanitizeShepardParams({
        ...this.octaveParams,
        level: params.level,
      }).level;
    }
    if (nextMode === SHEPARD_MODES.MORPHISMA) {
      const safeMorphisma = sanitizeMorphismaSweepParams({
        ...this.morphismaParams,
        ...params,
      });
      this.morphismaParams = {
        ...this.morphismaParams,
        ...safeMorphisma,
        cutoff: clamp(
          params.cutoff ?? this.morphismaParams.cutoff,
          800,
          18_000,
          MORPHISMA_SWEEP_DEFAULTS.cutoff,
        ),
      };
    } else {
      this.octaveParams = {
        ...this.octaveParams,
        ...sanitizeShepardParams({
          ...this.octaveParams,
          ...params,
          level: this.level,
        }),
      };
    }
    this.mode = nextMode;
    this.params = this.mode === SHEPARD_MODES.MORPHISMA
      ? {
        mode: this.mode,
        ...this.morphismaParams,
        level: this.level,
      }
      : {
        mode: this.mode,
        ...this.octaveParams,
        level: this.level,
      };
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "parameters",
      parameters: {
        mode: this.mode,
        octave: {
          centerFrequency: this.octaveParams.centerFrequency,
          rate: this.octaveParams.rate,
          width: this.octaveParams.width,
          spread: this.octaveParams.spread,
        },
        morphisma: {
          voices: this.morphismaParams.voices,
          sweepRate: this.morphismaParams.sweepRate,
          startFrequency: this.morphismaParams.startFrequency,
          sweepRange: this.morphismaParams.sweepRange,
          direction: this.morphismaParams.direction,
        },
      },
    });
    this.lowpass.frequency.setTargetAtTime(
      this.mode === SHEPARD_MODES.MORPHISMA
        ? this.morphismaParams.cutoff
        : this.octaveParams.cutoff,
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
