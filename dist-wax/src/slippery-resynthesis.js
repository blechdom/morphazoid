import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

export const SLIPPERY_RESYNTHESIS_PROCESSOR_NAME = "morphazoid-slippery-resynthesis";
export const SLIPPERYNTHESIS_FFT_SIZE = 2_048;
export const SLIPPERYNTHESIS_HOP_SIZE = 256;

const TAU = Math.PI * 2;
const SQRT_TWO = Math.SQRT2;
const MIN_FREQUENCY = 20;
const ANALYSIS_LOW_FREQUENCY = 55;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_BANDS = 8;
const MAX_BANDS = 64;
const MIN_BANK_WIDTH = 2;
const MAX_BANK_WIDTH = 8;
const MAX_OSCILLATORS = 256;
const GATE_KNEE_DB = 6;
const DRY_DELAY_SAMPLES = SLIPPERYNTHESIS_FFT_SIZE / 2;
const CONSONANT_START_FREQUENCY = 1_200;
const CONSONANT_FULL_FREQUENCY = 4_500;
const CONSONANT_NOISE_POLE = 0.72;
const CONSONANT_NOISE_NORMALIZATION = Math.sqrt(
  3 * (1 + CONSONANT_NOISE_POLE) / (1 - CONSONANT_NOISE_POLE),
);
const STRUCTURE_REBUILD_GAIN = 0.16;
const ADAPTIVE_DENSE_VOICE_THRESHOLD = 224;
const ADAPTIVE_WEIGHT_TRANSITION = 0.12;
const ADAPTIVE_LOAD_ALPHA = 0.08;
const ADAPTIVE_OVERLOAD_AVERAGE = 0.7;
const ADAPTIVE_OVERLOAD_INSTANT = 0.86;
const ADAPTIVE_RECOVERY_AVERAGE = 0.42;
const ADAPTIVE_OVERLOAD_BLOCKS = 6;
const ADAPTIVE_RECOVERY_BLOCKS = 600;
const ADAPTIVE_COARSE_WINDOW_BLOCKS = 64;
const ADAPTIVE_COARSE_RECOVERY_WINDOWS = 24;
const ADAPTIVE_WEIGHT_FLOORS = Object.freeze([0, 0.18, 0.28, 0.36, 0.44]);

export const SLIPPERYNTHESIS_LIMITS = Object.freeze({
  minBands: MIN_BANDS,
  maxBands: MAX_BANDS,
  minBankWidth: MIN_BANK_WIDTH,
  maxBankWidth: MAX_BANK_WIDTH,
  maxOscillators: MAX_OSCILLATORS,
  minFrequency: MIN_FREQUENCY,
  analysisLowFrequency: ANALYSIS_LOW_FREQUENCY,
  maxSlipRate: 4,
  minResponse: 0.002,
  maxResponse: 1,
});

export const SLIPPERYNTHESIS_PERFORMANCE_GUARD = Object.freeze({
  denseVoiceThreshold: ADAPTIVE_DENSE_VOICE_THRESHOLD,
  weightFloors: ADAPTIVE_WEIGHT_FLOORS,
  overloadAverage: ADAPTIVE_OVERLOAD_AVERAGE,
  overloadInstant: ADAPTIVE_OVERLOAD_INSTANT,
  recoveryAverage: ADAPTIVE_RECOVERY_AVERAGE,
});

export const SLIPPERYNTHESIS_DEFAULTS = Object.freeze({
  direction: 1,
  slipRate: 0.12,
  bankWidth: 4,
  coherence: 1,
  bandCount: 32,
  response: 0.06,
  consonantDetail: 0.72,
  transpose: 0,
  glideShape: 0,
  spectralTilt: 0,
  carrierColor: 0.12,
  stereoWidth: 0.35,
  gateDb: -66,
  highFrequency: 10_000,
  inputGain: 1,
  dryWet: 0.9,
  outputLevel: 0.65,
  hold: false,
});

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    settings: Object.freeze({ ...preset.settings }),
  });
}

export const SLIPPERYNTHESIS_PRESETS = Object.freeze([
  freezePreset({
    id: "gentle-lift",
    label: "Gentle lift",
    settings: {
      direction: 1,
      slipRate: 0.12,
      bankWidth: 4,
      coherence: 1,
      bandCount: 32,
      response: 0.06,
      consonantDetail: 0.72,
      transpose: 0,
      glideShape: 0,
      spectralTilt: 0,
      carrierColor: 0.12,
      stereoWidth: 0.35,
      gateDb: -66,
      highFrequency: 10_000,
      dryWet: 0.9,
    },
  }),
  freezePreset({
    id: "spectral-escalator",
    label: "Spectral escalator",
    settings: {
      direction: 1,
      slipRate: 0.18,
      bankWidth: 4,
      coherence: 0.96,
      bandCount: 40,
      response: 0.055,
      consonantDetail: 0.8,
      transpose: 0,
      glideShape: 0.32,
      spectralTilt: 1.5,
      carrierColor: 0.26,
      stereoWidth: 0.52,
      gateDb: -64,
      highFrequency: 12_000,
      dryWet: 0.9,
    },
  }),
  freezePreset({
    id: "melting-choir",
    label: "Melting choir",
    settings: {
      direction: 1,
      slipRate: 0.035,
      bankWidth: 5,
      coherence: 0.68,
      bandCount: 36,
      response: 0.22,
      consonantDetail: 0.45,
      transpose: -0.5,
      glideShape: -0.46,
      spectralTilt: -2.5,
      carrierColor: 0.48,
      stereoWidth: 0.78,
      gateDb: -58,
      highFrequency: 7_500,
      dryWet: 0.96,
    },
  }),
  freezePreset({
    id: "shimmer-fall",
    label: "Shimmer fall",
    settings: {
      direction: -1,
      slipRate: 0.32,
      bankWidth: 3,
      coherence: 0.82,
      bandCount: 48,
      response: 0.045,
      consonantDetail: 0.92,
      transpose: 1,
      glideShape: 0.58,
      spectralTilt: 4,
      carrierColor: 0.62,
      stereoWidth: 0.9,
      gateDb: -70,
      highFrequency: 15_000,
      dryWet: 0.9,
    },
  }),
  freezePreset({
    id: "speech-glass",
    label: "Speech glass",
    settings: {
      direction: 1,
      slipRate: 0.09,
      bankWidth: 3,
      coherence: 0.94,
      bandCount: 48,
      response: 0.018,
      consonantDetail: 0.94,
      transpose: 0,
      glideShape: 0.16,
      spectralTilt: 3,
      carrierColor: 0.08,
      stereoWidth: 0.3,
      gateDb: -76,
      highFrequency: 15_000,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "vowel-vortex",
    label: "Vowel vortex",
    settings: {
      direction: -1,
      slipRate: 0.055,
      bankWidth: 6,
      coherence: 0.42,
      bandCount: 40,
      response: 0.38,
      consonantDetail: 0.16,
      transpose: -1,
      glideShape: -0.68,
      spectralTilt: -4,
      carrierColor: 0.72,
      stereoWidth: 1,
      gateDb: -52,
      highFrequency: 6_800,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "close-captions",
    label: "Close captions",
    settings: {
      direction: 1,
      slipRate: 0.045,
      bankWidth: 4,
      coherence: 1,
      bandCount: 64,
      response: 0.008,
      consonantDetail: 1,
      transpose: 0,
      glideShape: 0.05,
      spectralTilt: 3.5,
      carrierColor: 0,
      stereoWidth: 0.08,
      gateDb: -82,
      highFrequency: 18_000,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "rocket-stairs",
    label: "Rocket stairs",
    settings: {
      direction: 1,
      slipRate: 4,
      bankWidth: 2,
      coherence: 0.95,
      bandCount: 64,
      response: 0.02,
      consonantDetail: 0.75,
      transpose: 1.5,
      glideShape: 0.88,
      spectralTilt: 2.5,
      carrierColor: 0.4,
      stereoWidth: 0.8,
      gateDb: -68,
      highFrequency: 16_000,
      dryWet: 0.96,
    },
  }),
  freezePreset({
    id: "ink-undertow",
    label: "Ink undertow",
    settings: {
      direction: -1,
      slipRate: 0.16,
      bankWidth: 8,
      coherence: 0.58,
      bandCount: 32,
      response: 0.3,
      consonantDetail: 0.08,
      transpose: -2,
      glideShape: -0.55,
      spectralTilt: -9,
      carrierColor: 0.6,
      stereoWidth: 0.75,
      gateDb: -50,
      highFrequency: 3_800,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "diamond-rain",
    label: "Diamond rain",
    settings: {
      direction: -1,
      slipRate: 0.72,
      bankWidth: 3,
      coherence: 0.86,
      bandCount: 64,
      response: 0.012,
      consonantDetail: 1,
      transpose: 1.5,
      glideShape: 0.68,
      spectralTilt: 9,
      carrierColor: 0.22,
      stereoWidth: 0.9,
      gateDb: -84,
      highFrequency: 20_000,
      dryWet: 0.98,
    },
  }),
  freezePreset({
    id: "glacier-memory",
    label: "Glacier memory",
    settings: {
      direction: 1,
      slipRate: 0.004,
      bankWidth: 8,
      coherence: 0.15,
      bandCount: 32,
      response: 1,
      consonantDetail: 0.1,
      transpose: -0.25,
      glideShape: -0.9,
      spectralTilt: -2,
      carrierColor: 0.2,
      stereoWidth: 1,
      gateDb: -60,
      highFrequency: 8_000,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "pinpoint-choir",
    label: "Pinpoint choir",
    settings: {
      direction: 1,
      slipRate: 0.065,
      bankWidth: 8,
      coherence: 1,
      bandCount: 32,
      response: 0.16,
      consonantDetail: 0.3,
      transpose: 0,
      glideShape: 0.25,
      spectralTilt: -1,
      carrierColor: 0.32,
      stereoWidth: 0,
      gateDb: -62,
      highFrequency: 9_000,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "radio-swarm",
    label: "Radio swarm",
    settings: {
      direction: -1,
      slipRate: 0.55,
      bankWidth: 4,
      coherence: 0,
      bandCount: 60,
      response: 0.01,
      consonantDetail: 1,
      transpose: 0,
      glideShape: -0.2,
      spectralTilt: 4,
      carrierColor: 1,
      stereoWidth: 1,
      gateDb: -88,
      highFrequency: 18_000,
      dryWet: 1,
    },
  }),
  freezePreset({
    id: "odd-cathedral",
    label: "Odd cathedral",
    settings: {
      direction: 1,
      slipRate: 0.02,
      bankWidth: 8,
      coherence: 0.7,
      bandCount: 32,
      response: 0.55,
      consonantDetail: 0,
      transpose: -0.5,
      glideShape: -0.75,
      spectralTilt: -1,
      carrierColor: 1,
      stereoWidth: 0.92,
      gateDb: -54,
      highFrequency: 11_000,
      dryWet: 1,
    },
  }),
]);

export const SLIPPERY_RESYNTHESIS_DEFAULTS = SLIPPERYNTHESIS_DEFAULTS;
export const SLIPPERY_RESYNTHESIS_FFT_SIZE = SLIPPERYNTHESIS_FFT_SIZE;
export const SLIPPERY_RESYNTHESIS_HOP_SIZE = SLIPPERYNTHESIS_HOP_SIZE;
export const SLIPPERY_RESYNTHESIS_LIMITS = SLIPPERYNTHESIS_LIMITS;
export const SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD = (
  SLIPPERYNTHESIS_PERFORMANCE_GUARD
);
export const SLIPPERY_RESYNTHESIS_PRESETS = SLIPPERYNTHESIS_PRESETS;

export function adaptiveShepardTierForVoiceCount(bandCount, bankWidth) {
  const bands = Math.max(0, Math.round(Number(bandCount) || 0));
  const layers = Math.max(0, Math.round(Number(bankWidth) || 0));
  return bands * layers >= ADAPTIVE_DENSE_VOICE_THRESHOLD ? 1 : 0;
}

export function clamp(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

export function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

export function sanitizeSlipperyResynthesisParams(params = {}) {
  const bankWidth = Math.round(clamp(
    params.bankWidth,
    MIN_BANK_WIDTH,
    MAX_BANK_WIDTH,
    SLIPPERYNTHESIS_DEFAULTS.bankWidth,
  ));
  const bandBudget = Math.min(
    MAX_BANDS,
    Math.floor(MAX_OSCILLATORS / bankWidth),
  );
  const bandCount = Math.round(clamp(
    params.bandCount,
    MIN_BANDS,
    bandBudget,
    Math.min(SLIPPERYNTHESIS_DEFAULTS.bandCount, bandBudget),
  ));
  const numericDirection = Number(params.direction);
  const direction = Number.isFinite(numericDirection)
    ? numericDirection < 0 ? -1 : 1
    : SLIPPERYNTHESIS_DEFAULTS.direction;

  return Object.freeze({
    direction,
    slipRate: clamp(
      params.slipRate,
      0,
      4,
      SLIPPERYNTHESIS_DEFAULTS.slipRate,
    ),
    bankWidth,
    coherence: clamp(
      params.coherence,
      0,
      1,
      SLIPPERYNTHESIS_DEFAULTS.coherence,
    ),
    bandCount,
    response: clamp(
      params.response,
      0.002,
      1,
      SLIPPERYNTHESIS_DEFAULTS.response,
    ),
    consonantDetail: clamp(
      params.consonantDetail,
      0,
      1,
      SLIPPERYNTHESIS_DEFAULTS.consonantDetail,
    ),
    transpose: clamp(
      params.transpose,
      -2,
      2,
      SLIPPERYNTHESIS_DEFAULTS.transpose,
    ),
    glideShape: clamp(
      params.glideShape,
      -0.9,
      0.9,
      SLIPPERYNTHESIS_DEFAULTS.glideShape,
    ),
    spectralTilt: clamp(
      params.spectralTilt,
      -9,
      9,
      SLIPPERYNTHESIS_DEFAULTS.spectralTilt,
    ),
    carrierColor: clamp(
      params.carrierColor,
      0,
      1,
      SLIPPERYNTHESIS_DEFAULTS.carrierColor,
    ),
    stereoWidth: clamp(
      params.stereoWidth,
      0,
      1,
      SLIPPERYNTHESIS_DEFAULTS.stereoWidth,
    ),
    gateDb: clamp(
      params.gateDb,
      -100,
      -18,
      SLIPPERYNTHESIS_DEFAULTS.gateDb,
    ),
    highFrequency: clamp(
      params.highFrequency,
      1_000,
      20_000,
      SLIPPERYNTHESIS_DEFAULTS.highFrequency,
    ),
    inputGain: clamp(
      params.inputGain,
      0,
      4,
      SLIPPERYNTHESIS_DEFAULTS.inputGain,
    ),
    dryWet: clamp(
      params.dryWet,
      0,
      1,
      SLIPPERYNTHESIS_DEFAULTS.dryWet,
    ),
    outputLevel: clamp(
      params.outputLevel,
      0,
      0.82,
      SLIPPERYNTHESIS_DEFAULTS.outputLevel,
    ),
    hold: Boolean(params.hold),
  });
}

export function createPeriodicHannWindow(size = SLIPPERYNTHESIS_FFT_SIZE) {
  const length = Math.max(2, Math.round(Number(size) || SLIPPERYNTHESIS_FFT_SIZE));
  const window = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos(TAU * index / length);
  }
  return window;
}

/**
 * Iterative radix-2 complex FFT. The arrays are transformed in place and no
 * render-thread allocations are made.
 */
export function fftInPlace(real, imaginary) {
  const length = real?.length ?? 0;
  if (
    length < 2
    || imaginary?.length !== length
    || (length & (length - 1)) !== 0
  ) {
    throw new RangeError("FFT arrays must have the same power-of-two length.");
  }

  let reversed = 0;
  for (let index = 1; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
  }

  for (let width = 2; width <= length; width *= 2) {
    const angle = -TAU / width;
    const rootReal = Math.cos(angle);
    const rootImaginary = Math.sin(angle);
    const halfWidth = width / 2;
    for (let offset = 0; offset < length; offset += width) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < halfWidth; index += 1) {
        const even = offset + index;
        const odd = even + halfWidth;
        const oddReal = (
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary
        );
        const oddImaginary = (
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal
        );
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = (
          twiddleReal * rootReal - twiddleImaginary * rootImaginary
        );
        twiddleImaginary = (
          twiddleReal * rootImaginary + twiddleImaginary * rootReal
        );
        twiddleReal = nextReal;
      }
    }
  }
}

export function logBandCenters(
  bandCount,
  lowFrequency = ANALYSIS_LOW_FREQUENCY,
  highFrequency = SLIPPERYNTHESIS_DEFAULTS.highFrequency,
) {
  const count = Math.max(2, Math.round(Number(bandCount) || 2));
  const low = Math.max(MIN_FREQUENCY, Number(lowFrequency) || ANALYSIS_LOW_FREQUENCY);
  const high = Math.max(low * 1.01, Number(highFrequency) || low * 2);
  const centers = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    centers[index] = low * (high / low) ** (index / (count - 1));
  }
  return centers;
}

/**
 * Precompute a sparse log-frequency triangular partition for the positive FFT
 * bins. Treating each FFT bin as a frequency cell (rather than sampling only
 * at its center) keeps the narrow low bands reachable when their spacing is
 * finer than one FFT bin. Interior bin weights sum to one; edge bins retain
 * only the fraction of their cell that falls inside the analysis range.
 */
export function createLogBandPlan({
  bandCount = SLIPPERYNTHESIS_DEFAULTS.bandCount,
  lowFrequency = ANALYSIS_LOW_FREQUENCY,
  highFrequency = SLIPPERYNTHESIS_DEFAULTS.highFrequency,
  sampleRate = DEFAULT_SAMPLE_RATE,
  fftSize = SLIPPERYNTHESIS_FFT_SIZE,
} = {}) {
  const count = Math.max(2, Math.round(Number(bandCount) || 2));
  const rate = Math.max(8_000, Number(sampleRate) || DEFAULT_SAMPLE_RATE);
  const size = Math.max(2, Math.round(Number(fftSize) || SLIPPERYNTHESIS_FFT_SIZE));
  const low = Math.max(MIN_FREQUENCY, Number(lowFrequency) || ANALYSIS_LOW_FREQUENCY);
  const high = Math.min(
    Math.max(low * 1.01, Number(highFrequency) || low * 2),
    rate * 0.45,
  );
  const centers = logBandCenters(count, low, high);
  const binCount = size / 2 + 1;
  const binOffsets = new Int32Array(binCount + 1);
  const pendingBandIndices = [];
  const pendingBandWeights = [];
  const logSpan = Math.log2(high / low);
  const logScale = (count - 1) / Math.log(high / low);
  const binHz = rate / size;

  for (let bin = 1; bin < binCount - 1; bin += 1) {
    binOffsets[bin] = pendingBandIndices.length;
    let intervalStart = Math.max(low, (bin - 0.5) * binHz);
    const intervalEnd = Math.min(high, (bin + 0.5) * binHz);
    if (intervalEnd <= intervalStart) continue;

    while (intervalStart < intervalEnd) {
      const position = (
        Math.log2(intervalStart / low) / logSpan * (count - 1)
      );
      const left = Math.max(
        0,
        Math.min(count - 2, Math.floor(position + 1e-12)),
      );
      const right = left + 1;
      const segmentEnd = Math.min(intervalEnd, centers[right]);
      const width = segmentEnd - intervalStart;
      if (!(width > 0)) break;

      // Integral of x(f) = logScale * ln(f / low), with respect to f.
      const integralPosition = logScale * (
        segmentEnd * Math.log(segmentEnd / low) - segmentEnd
        - intervalStart * Math.log(intervalStart / low) + intervalStart
      );
      const leftWeight = ((right * width) - integralPosition) / binHz;
      const rightWeight = (integralPosition - (left * width)) / binHz;
      if (leftWeight > 1e-12) {
        const previous = pendingBandIndices.length - 1;
        if (
          previous >= binOffsets[bin]
          && pendingBandIndices[previous] === left
        ) {
          pendingBandWeights[previous] += leftWeight;
        } else {
          pendingBandIndices.push(left);
          pendingBandWeights.push(leftWeight);
        }
      }
      if (rightWeight > 1e-12) {
        const previous = pendingBandIndices.length - 1;
        if (
          previous >= binOffsets[bin]
          && pendingBandIndices[previous] === right
        ) {
          pendingBandWeights[previous] += rightWeight;
        } else {
          pendingBandIndices.push(right);
          pendingBandWeights.push(rightWeight);
        }
      }
      intervalStart = segmentEnd;
    }
  }
  binOffsets[binCount - 1] = pendingBandIndices.length;
  binOffsets[binCount] = pendingBandIndices.length;

  return Object.freeze({
    bandCount: count,
    lowFrequency: low,
    highFrequency: high,
    sampleRate: rate,
    fftSize: size,
    centers,
    binOffsets,
    bandIndices: Int16Array.from(pendingBandIndices),
    bandWeights: Float32Array.from(pendingBandWeights),
  });
}

export function slipperyHann(phase) {
  const position = wrapUnit(Number(phase));
  return 0.5 - 0.5 * Math.cos(TAU * position);
}

export function slipperyGlidePhase(
  phase,
  shape = SLIPPERYNTHESIS_DEFAULTS.glideShape,
) {
  const position = wrapUnit(Number(phase));
  const amount = clamp(shape, -0.9, 0.9, 0);
  return position + (
    amount * position * (1 - position) * (1 - 2 * position)
  );
}

export function spectralTiltGain(
  frequency,
  tiltDbPerOctave = SLIPPERYNTHESIS_DEFAULTS.spectralTilt,
) {
  const hz = Math.max(MIN_FREQUENCY, Number(frequency) || 1_000);
  const tilt = clamp(tiltDbPerOctave, -9, 9, 0);
  return Math.max(0.125, Math.min(
    8,
    10 ** (tilt * Math.log2(hz / 1_000) / 20),
  ));
}

export function slipperAntiAliasWeight(
  frequency,
  highFrequency = SLIPPERYNTHESIS_DEFAULTS.highFrequency,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const hz = Number(frequency);
  if (!Number.isFinite(hz) || hz <= MIN_FREQUENCY) return 0;
  if (hz < 35) {
    const position = (hz - MIN_FREQUENCY) / 15;
    return 0.5 - 0.5 * Math.cos(Math.PI * position);
  }
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    384_000,
    DEFAULT_SAMPLE_RATE,
  );
  const ceiling = Math.min(
    clamp(highFrequency, 1_000, 20_000, SLIPPERYNTHESIS_DEFAULTS.highFrequency),
    safeSampleRate * 0.45,
  );
  const taperStart = Math.min(ceiling * 0.88, safeSampleRate * 0.4);
  if (hz <= taperStart) return 1;
  if (hz >= ceiling || ceiling <= taperStart) return 0;
  const position = (hz - taperStart) / (ceiling - taperStart);
  return 0.5 + 0.5 * Math.cos(Math.PI * position);
}

/**
 * Reference description for one analyzed band's canonical Shepard bank.
 * With bankWidth === layer count, adjacent active voices are octave-spaced;
 * every voice wraps only where its Hann gain and slope are zero.
 */
export function calculateSlipperPartials({
  centerFrequency = 220,
  bankPhase = 0,
  bankWidth = SLIPPERYNTHESIS_DEFAULTS.bankWidth,
  direction = 1,
  transpose = SLIPPERYNTHESIS_DEFAULTS.transpose,
  glideShape = SLIPPERYNTHESIS_DEFAULTS.glideShape,
  highFrequency = SLIPPERYNTHESIS_DEFAULTS.highFrequency,
  sampleRate = DEFAULT_SAMPLE_RATE,
} = {}) {
  const width = Math.round(clamp(
    bankWidth,
    MIN_BANK_WIDTH,
    MAX_BANK_WIDTH,
    SLIPPERYNTHESIS_DEFAULTS.bankWidth,
  ));
  const center = Math.max(MIN_FREQUENCY, Number(centerFrequency) || 220);
  const transposeRatio = 2 ** clamp(transpose, -2, 2, 0);
  const polarity = Number(direction) < 0 ? -1 : 1;
  const partials = [];
  let weightPower = 0;
  for (let layer = 0; layer < width; layer += 1) {
    const phase = wrapUnit(bankPhase + layer / width);
    const warpedPhase = slipperyGlidePhase(phase, glideShape);
    const octaveOffset = polarity * width * (warpedPhase - 0.5);
    const frequency = center * transposeRatio * 2 ** octaveOffset;
    const envelope = slipperyHann(phase);
    const antiAlias = slipperAntiAliasWeight(
      frequency,
      highFrequency,
      sampleRate,
    );
    const weight = envelope * antiAlias;
    weightPower += weight * weight;
    partials.push(Object.freeze({
      layer,
      phase,
      warpedPhase,
      octaveOffset,
      frequency,
      envelope,
      antiAlias,
      weight,
      active: weight > 0,
    }));
  }
  return Object.freeze({
    partials: Object.freeze(partials),
    weightPower,
    normalization: weightPower > 1e-12
      ? Math.min(2, 1 / Math.sqrt(weightPower))
      : 0,
  });
}

export function createSlipperCeilingCurve(length = 2_001) {
  const size = Math.max(33, Math.round(Number(length) || 2_001));
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    const magnitude = Math.abs(input);
    if (magnitude <= 0.88) {
      curve[index] = input;
      continue;
    }
    const shoulder = 0.88 + 0.1 * (
      1 - Math.exp(-(magnitude - 0.88) / 0.1)
    );
    curve[index] = Math.sign(input) * Math.min(0.98, shoulder);
  }
  return curve;
}

function smoothStep01(value) {
  const position = Math.min(1, Math.max(0, value));
  return position * position * (3 - 2 * position);
}

function seedOscillatorPhases(target) {
  let state = 0x6d2b79f5;
  for (let index = 0; index < target.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    target[index] = ((state >>> 0) / 0x1_0000_0000) * TAU;
  }
}

function interpolateLogBandState(source, count, plan, frequency) {
  if (!plan || count < 1 || frequency < plan.lowFrequency) return 0;
  if (frequency > plan.highFrequency) return 0;
  if (count === 1 || plan.highFrequency <= plan.lowFrequency) return source[0] ?? 0;
  const position = (
    Math.log2(frequency / plan.lowFrequency)
    / Math.log2(plan.highFrequency / plan.lowFrequency)
    * (count - 1)
  );
  const left = Math.max(0, Math.min(count - 1, Math.floor(position)));
  const right = Math.min(count - 1, left + 1);
  const blend = Math.max(0, Math.min(1, position - left));
  return (source[left] ?? 0) * (1 - blend) + (source[right] ?? 0) * blend;
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidSlipperyResynthesisProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeSlipperyResynthesisParams(
        options.processorOptions?.parameters ?? options.processorOptions,
      );
      this.target = { ...initial };
      this.current = { ...initial };
      this.activeTarget = 0;
      this.activeGain = 0;
      this.structureGain = 1;
      this.pendingStructure = null;
      this.bankPhase = 0.117;

      this.window = createPeriodicHannWindow(SLIPPERYNTHESIS_FFT_SIZE);
      this.windowEnergy = 0;
      for (const value of this.window) this.windowEnergy += value * value;
      this.analysisRing = new Float64Array(SLIPPERYNTHESIS_FFT_SIZE);
      this.fftReal = new Float64Array(SLIPPERYNTHESIS_FFT_SIZE);
      this.fftImaginary = new Float64Array(SLIPPERYNTHESIS_FFT_SIZE);
      this.fftBinPowers = new Float64Array(
        SLIPPERYNTHESIS_FFT_SIZE / 2 + 1,
      );
      this.analysisWriteIndex = 0;
      this.analysisFill = 0;
      this.hopCounter = 0;

      this.bandPowers = new Float64Array(MAX_BANDS);
      this.bandLogPowers = new Float64Array(MAX_BANDS);
      this.bandWeightTotals = new Float64Array(MAX_BANDS);
      this.bandWeightSquares = new Float64Array(MAX_BANDS);
      this.bandTargets = new Float64Array(MAX_BANDS);
      this.bandEnvelopes = new Float64Array(MAX_BANDS);
      this.bandNoisinessTargets = new Float64Array(MAX_BANDS);
      this.bandNoisiness = new Float64Array(MAX_BANDS);
      this.bandToneGains = new Float64Array(MAX_BANDS);
      this.transitionBandTargets = new Float64Array(MAX_BANDS);
      this.transitionBandEnvelopes = new Float64Array(MAX_BANDS);
      this.transitionBandNoisinessTargets = new Float64Array(MAX_BANDS);
      this.transitionBandNoisiness = new Float64Array(MAX_BANDS);
      this.bandToneGains.fill(1);
      this.bandOffsets = new Float64Array(MAX_BANDS);
      for (let band = 0; band < MAX_BANDS; band += 1) {
        this.bandOffsets[band] = (
          wrapUnit((band + 1) * 0.6180339887498949) - 0.5
        ) * 0.9;
      }
      this.oscillatorPhases = new Float64Array(
        MAX_BANDS * MAX_BANK_WIDTH,
      );
      this.oscillatorNoise = new Float64Array(
        MAX_BANDS * MAX_BANK_WIDTH,
      );
      this.noiseState = 0x9e3779b9;
      seedOscillatorPhases(this.oscillatorPhases);
      this.layerFrequencies = new Float64Array(MAX_BANK_WIDTH);
      this.layerWeights = new Float64Array(MAX_BANK_WIDTH);
      this.layerOffsets = new Float64Array(MAX_BANK_WIDTH);

      this.adaptiveMinimumTier = 0;
      this.adaptiveTier = 0;
      this.adaptiveWeightFloor = 0;
      this.adaptiveWeightFloorTarget = 0;
      this.adaptiveLoadAverage = 0;
      this.adaptiveLoadSamples = 0;
      this.adaptiveOverloadBlocks = 0;
      this.adaptiveRecoveryBlocks = 0;
      this.performanceWindowElapsed = 0;
      this.performanceWindowDeadline = 0;
      this.performanceWindowBlocks = 0;
      this.performanceWindowActive = false;
      this.performanceZeroWindows = 0;
      if (typeof globalThis.performance?.now === "function") {
        this.performanceNow = globalThis.performance.now.bind(globalThis.performance);
        this.performanceClockMode = "high-resolution";
      } else if (typeof Date.now === "function") {
        this.performanceNow = Date.now.bind(Date);
        this.performanceClockMode = "coarse";
      } else {
        this.performanceNow = null;
        this.performanceClockMode = "unavailable";
      }

      this.dryLeft = new Float32Array(SLIPPERYNTHESIS_FFT_SIZE);
      this.dryRight = new Float32Array(SLIPPERYNTHESIS_FFT_SIZE);
      this.dryWriteIndex = 0;

      this.configureStructure(initial);
      this.port.onmessage = (event) => {
        const message = event.data ?? {};
        if (message.type === "parameters") {
          const safe = sanitizeSlipperyResynthesisParams({
            ...this.target,
            ...message.parameters,
          });
          this.target = { ...safe };
          const structureChanged = (
            safe.bandCount !== this.bandCount
            || safe.bankWidth !== this.bankWidth
            || safe.direction !== this.direction
            || safe.highFrequency !== this.highFrequency
          );
          this.pendingStructure = structureChanged ? safe : null;
        } else if (message.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        } else if (message.type === "reset") {
          this.reset();
        }
      };
    }

    setAdaptiveTier(tier, {
      snap = false,
      report = true,
      reason = "load",
    } = {}) {
      const maximumTier = ADAPTIVE_WEIGHT_FLOORS.length - 1;
      const nextTier = Math.max(
        this.adaptiveMinimumTier,
        Math.min(maximumTier, Math.round(Number(tier) || 0)),
      );
      const changed = nextTier !== this.adaptiveTier;
      this.adaptiveTier = nextTier;
      this.adaptiveWeightFloorTarget = ADAPTIVE_WEIGHT_FLOORS[nextTier];
      if (snap) this.adaptiveWeightFloor = this.adaptiveWeightFloorTarget;
      if (changed && report) {
        this.port.postMessage({
          type: "adaptive-quality",
          tier: nextTier,
          minimumTier: this.adaptiveMinimumTier,
          load: this.adaptiveLoadAverage,
          reason,
        });
      }
      return nextTier;
    }

    updateAdaptiveMinimum(params, { initial = false } = {}) {
      const previousMinimum = this.adaptiveMinimumTier;
      const nextMinimum = adaptiveShepardTierForVoiceCount(
        params.bandCount,
        params.bankWidth,
      );
      this.adaptiveMinimumTier = nextMinimum;
      if (nextMinimum > this.adaptiveTier) {
        this.setAdaptiveTier(nextMinimum, {
          snap: true,
          report: !initial,
          reason: "dense-bank",
        });
      } else if (nextMinimum < previousMinimum && nextMinimum === 0) {
        this.setAdaptiveTier(0, {
          report: !initial,
          reason: "lighter-bank",
        });
      } else {
        this.adaptiveWeightFloorTarget = ADAPTIVE_WEIGHT_FLOORS[this.adaptiveTier];
      }
    }

    updateAdaptivePerformance(loadRatio, { spectrumActive = true } = {}) {
      const numericLoad = Number(loadRatio);
      if (!Number.isFinite(numericLoad) || numericLoad < 0) {
        return this.adaptiveTier;
      }
      const load = Math.min(4, numericLoad);
      this.adaptiveLoadAverage = this.adaptiveLoadSamples === 0
        ? load
        : this.adaptiveLoadAverage + (
          load - this.adaptiveLoadAverage
        ) * ADAPTIVE_LOAD_ALPHA;
      this.adaptiveLoadSamples += 1;

      const overloaded = (
        load >= ADAPTIVE_OVERLOAD_INSTANT
        || this.adaptiveLoadAverage >= ADAPTIVE_OVERLOAD_AVERAGE
      );
      if (overloaded) {
        this.adaptiveOverloadBlocks += load >= 1 ? 3 : 1;
        this.adaptiveRecoveryBlocks = 0;
      } else {
        this.adaptiveOverloadBlocks = Math.max(
          0,
          this.adaptiveOverloadBlocks - 1,
        );
        const hasHeadroom = (
          spectrumActive
          && this.adaptiveLoadAverage < ADAPTIVE_RECOVERY_AVERAGE
          && load < ADAPTIVE_OVERLOAD_AVERAGE
        );
        this.adaptiveRecoveryBlocks = hasHeadroom
          ? this.adaptiveRecoveryBlocks + 1
          : 0;
      }

      if (
        this.adaptiveOverloadBlocks >= ADAPTIVE_OVERLOAD_BLOCKS
        && this.adaptiveTier < ADAPTIVE_WEIGHT_FLOORS.length - 1
      ) {
        this.adaptiveOverloadBlocks = 0;
        this.setAdaptiveTier(this.adaptiveTier + 1, { reason: "overload" });
      } else if (
        this.adaptiveRecoveryBlocks >= ADAPTIVE_RECOVERY_BLOCKS
        && this.adaptiveTier > this.adaptiveMinimumTier
      ) {
        this.adaptiveRecoveryBlocks = 0;
        this.setAdaptiveTier(this.adaptiveTier - 1, { reason: "headroom" });
      }
      return this.adaptiveTier;
    }

    recordRenderPerformance(elapsedMs, quantumMs, spectrumActive) {
      if (
        !Number.isFinite(elapsedMs)
        || !Number.isFinite(quantumMs)
        || elapsedMs < 0
        || quantumMs <= 0
      ) {
        return this.adaptiveTier;
      }
      if (this.performanceClockMode === "high-resolution") {
        return this.updateAdaptivePerformance(elapsedMs / quantumMs, {
          spectrumActive,
        });
      }
      if (this.performanceClockMode !== "coarse" || elapsedMs >= 50) {
        return this.adaptiveTier;
      }

      this.performanceWindowElapsed += elapsedMs;
      this.performanceWindowDeadline += quantumMs;
      this.performanceWindowBlocks += 1;
      this.performanceWindowActive ||= spectrumActive;
      if (this.performanceWindowBlocks < ADAPTIVE_COARSE_WINDOW_BLOCKS) {
        return this.adaptiveTier;
      }

      const windowLoad = this.performanceWindowElapsed
        / Math.max(1e-9, this.performanceWindowDeadline);
      const windowActive = this.performanceWindowActive;
      this.performanceZeroWindows = this.performanceWindowElapsed === 0
        ? this.performanceZeroWindows + 1
        : 0;
      this.performanceWindowElapsed = 0;
      this.performanceWindowDeadline = 0;
      this.performanceWindowBlocks = 0;
      this.performanceWindowActive = false;
      if (this.performanceZeroWindows >= 4) {
        this.performanceClockMode = "unavailable";
        return this.adaptiveTier;
      }

      this.adaptiveLoadAverage = this.adaptiveLoadSamples === 0
        ? windowLoad
        : this.adaptiveLoadAverage + (
          windowLoad - this.adaptiveLoadAverage
        ) * 0.25;
      this.adaptiveLoadSamples += ADAPTIVE_COARSE_WINDOW_BLOCKS;
      if (windowLoad >= 0.82) {
        this.adaptiveOverloadBlocks = 0;
        this.adaptiveRecoveryBlocks = 0;
        this.setAdaptiveTier(this.adaptiveTier + 1, {
          reason: "coarse-overload",
        });
      } else if (
        windowLoad >= 0.68
        || this.adaptiveLoadAverage >= ADAPTIVE_OVERLOAD_AVERAGE
      ) {
        this.adaptiveOverloadBlocks += 1;
        this.adaptiveRecoveryBlocks = 0;
        if (this.adaptiveOverloadBlocks >= 2) {
          this.adaptiveOverloadBlocks = 0;
          this.setAdaptiveTier(this.adaptiveTier + 1, {
            reason: "coarse-overload",
          });
        }
      } else {
        this.adaptiveOverloadBlocks = 0;
        const hasHeadroom = (
          windowActive
          && windowLoad <= ADAPTIVE_RECOVERY_AVERAGE
          && this.adaptiveLoadAverage <= ADAPTIVE_RECOVERY_AVERAGE
        );
        this.adaptiveRecoveryBlocks = hasHeadroom
          ? this.adaptiveRecoveryBlocks + 1
          : 0;
        if (
          this.adaptiveRecoveryBlocks >= ADAPTIVE_COARSE_RECOVERY_WINDOWS
          && this.adaptiveTier > this.adaptiveMinimumTier
        ) {
          this.adaptiveRecoveryBlocks = 0;
          this.setAdaptiveTier(this.adaptiveTier - 1, {
            reason: "coarse-headroom",
          });
        }
      }
      return this.adaptiveTier;
    }

    configureStructure(params, { preserveState = false } = {}) {
      const canPreserve = Boolean(
        preserveState && this.bandPlan && this.bandCount > 0,
      );
      const previousPlan = canPreserve ? this.bandPlan : null;
      const previousBandCount = canPreserve ? this.bandCount : 0;
      if (canPreserve) {
        this.transitionBandTargets.set(this.bandTargets);
        this.transitionBandEnvelopes.set(this.bandEnvelopes);
        this.transitionBandNoisinessTargets.set(this.bandNoisinessTargets);
        this.transitionBandNoisiness.set(this.bandNoisiness);
      }

      this.bandCount = params.bandCount;
      this.bankWidth = params.bankWidth;
      this.direction = params.direction;
      this.highFrequency = params.highFrequency;
      this.bandPlan = createLogBandPlan({
        bandCount: this.bandCount,
        lowFrequency: ANALYSIS_LOW_FREQUENCY,
        highFrequency: this.highFrequency,
        sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
        fftSize: SLIPPERYNTHESIS_FFT_SIZE,
      });
      this.bandTargets.fill(0);
      this.bandEnvelopes.fill(0);
      this.bandNoisinessTargets.fill(0);
      this.bandNoisiness.fill(0);
      if (canPreserve) {
        for (let band = 0; band < this.bandCount; band += 1) {
          const frequency = this.bandPlan.centers[band];
          this.bandTargets[band] = interpolateLogBandState(
            this.transitionBandTargets,
            previousBandCount,
            previousPlan,
            frequency,
          );
          this.bandEnvelopes[band] = interpolateLogBandState(
            this.transitionBandEnvelopes,
            previousBandCount,
            previousPlan,
            frequency,
          );
          this.bandNoisinessTargets[band] = interpolateLogBandState(
            this.transitionBandNoisinessTargets,
            previousBandCount,
            previousPlan,
            frequency,
          );
          this.bandNoisiness[band] = interpolateLogBandState(
            this.transitionBandNoisiness,
            previousBandCount,
            previousPlan,
            frequency,
          );
        }
      } else {
        this.oscillatorNoise.fill(0);
        this.noiseState = 0x9e3779b9;
        seedOscillatorPhases(this.oscillatorPhases);
      }
      this.updateAdaptiveMinimum(params, { initial: !previousPlan });
    }

    reset() {
      this.analysisRing.fill(0);
      this.fftReal.fill(0);
      this.fftImaginary.fill(0);
      this.fftBinPowers.fill(0);
      this.bandPowers.fill(0);
      this.bandLogPowers.fill(0);
      this.bandWeightTotals.fill(0);
      this.bandWeightSquares.fill(0);
      this.bandTargets.fill(0);
      this.bandEnvelopes.fill(0);
      this.bandNoisinessTargets.fill(0);
      this.bandNoisiness.fill(0);
      this.oscillatorNoise.fill(0);
      this.dryLeft.fill(0);
      this.dryRight.fill(0);
      this.analysisWriteIndex = 0;
      this.analysisFill = 0;
      this.hopCounter = 0;
      this.dryWriteIndex = 0;
      this.bankPhase = 0.117;
      this.noiseState = 0x9e3779b9;
      this.adaptiveLoadAverage = 0;
      this.adaptiveLoadSamples = 0;
      this.adaptiveOverloadBlocks = 0;
      this.adaptiveRecoveryBlocks = 0;
      this.performanceWindowElapsed = 0;
      this.performanceWindowDeadline = 0;
      this.performanceWindowBlocks = 0;
      this.performanceWindowActive = false;
      this.performanceZeroWindows = 0;
      this.adaptiveMinimumTier = adaptiveShepardTierForVoiceCount(
        this.bandCount,
        this.bankWidth,
      );
      this.adaptiveTier = this.adaptiveMinimumTier;
      this.adaptiveWeightFloor = ADAPTIVE_WEIGHT_FLOORS[this.adaptiveTier];
      this.adaptiveWeightFloorTarget = this.adaptiveWeightFloor;
      seedOscillatorPhases(this.oscillatorPhases);
    }

    analyzeFrame() {
      if (this.target.hold || this.analysisFill < SLIPPERYNTHESIS_FFT_SIZE) {
        return;
      }
      const mask = SLIPPERYNTHESIS_FFT_SIZE - 1;
      for (let index = 0; index < SLIPPERYNTHESIS_FFT_SIZE; index += 1) {
        const sourceIndex = (this.analysisWriteIndex + index) & mask;
        this.fftReal[index] = this.analysisRing[sourceIndex] * this.window[index];
        this.fftImaginary[index] = 0;
      }
      fftInPlace(this.fftReal, this.fftImaginary);
      this.fftBinPowers.fill(0);
      this.bandPowers.fill(0);
      this.bandLogPowers.fill(0);
      this.bandWeightTotals.fill(0);
      this.bandWeightSquares.fill(0);
      const powerScale = 2 / (
        SLIPPERYNTHESIS_FFT_SIZE * this.windowEnergy
      );
      const { binOffsets, bandIndices, bandWeights } = this.bandPlan;
      for (let bin = 1; bin < SLIPPERYNTHESIS_FFT_SIZE / 2; bin += 1) {
        const contributionEnd = binOffsets[bin + 1];
        if (binOffsets[bin] === contributionEnd) continue;
        const real = this.fftReal[bin];
        const imaginary = this.fftImaginary[bin];
        const power = (real * real + imaginary * imaginary) * powerScale;
        this.fftBinPowers[bin] = power;
        for (
          let contribution = binOffsets[bin];
          contribution < contributionEnd;
          contribution += 1
        ) {
          const band = bandIndices[contribution];
          const weight = bandWeights[contribution];
          this.bandPowers[band] += power * weight;
          this.bandWeightTotals[band] += weight;
          this.bandWeightSquares[band] += weight * weight;
        }
      }
      for (let bin = 1; bin < SLIPPERYNTHESIS_FFT_SIZE / 2; bin += 1) {
        const contributionEnd = binOffsets[bin + 1];
        for (
          let contribution = binOffsets[bin];
          contribution < contributionEnd;
          contribution += 1
        ) {
          const band = bandIndices[contribution];
          const weight = bandWeights[contribution];
          const weightTotal = this.bandWeightTotals[band];
          const meanPower = weightTotal > 1e-12
            ? this.bandPowers[band] / weightTotal
            : 0;
          this.bandLogPowers[band] += Math.log(Math.max(
            1e-30,
            this.fftBinPowers[bin],
            meanPower * 1e-6,
          )) * weight;
        }
      }

      const gateLow = this.current.gateDb - GATE_KNEE_DB * 0.5;
      for (let band = 0; band < this.bandCount; band += 1) {
        const amplitude = Math.sqrt(Math.max(0, this.bandPowers[band]));
        const db = 20 * Math.log10(Math.max(1e-12, amplitude));
        const gate = smoothStep01((db - gateLow) / GATE_KNEE_DB);
        this.bandTargets[band] = amplitude * gate;

        const weightTotal = this.bandWeightTotals[band];
        const meanPower = weightTotal > 1e-12
          ? this.bandPowers[band] / weightTotal
          : 0;
        const geometricPower = meanPower > 1e-18
          ? Math.exp(this.bandLogPowers[band] / weightTotal)
          : 0;
        const effectiveBins = this.bandWeightSquares[band] > 1e-12
          ? weightTotal * weightTotal / this.bandWeightSquares[band]
          : 0;
        const rawFlatness = meanPower > 1e-18 && effectiveBins >= 4
          ? Math.min(1, geometricPower / meanPower)
          : 0;
        const noisiness = smoothStep01((rawFlatness - 0.18) / 0.37);
        const highBandPosition = (
          Math.log2(
            this.bandPlan.centers[band] / CONSONANT_START_FREQUENCY,
          )
          / Math.log2(
            CONSONANT_FULL_FREQUENCY / CONSONANT_START_FREQUENCY,
          )
        );
        this.bandNoisinessTargets[band] = (
          noisiness * smoothStep01(highBandPosition) * gate
        );
      }
    }

    process(inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const renderStartedAt = this.performanceNow?.() ?? null;
      const leftOutput = output[0];
      const rightOutput = output[1] ?? leftOutput;
      leftOutput.fill(0);
      if (rightOutput !== leftOutput) rightOutput.fill(0);

      const input = inputs[0] ?? [];
      const inputLeft = input[0];
      const inputRight = input[1] ?? inputLeft;
      const workletSampleRate = Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE;
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.03));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.008));
      const structureSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.006));
      const response = Math.max(0.002, this.current.response);
      const attackSlew = 1 - Math.exp(
        -1 / (workletSampleRate * Math.max(0.001, response * 0.2)),
      );
      const releaseSlew = 1 - Math.exp(-1 / (workletSampleRate * response));
      const consonantTrackingAttack = 1 - Math.exp(
        -1 / (workletSampleRate * 0.005),
      );
      const consonantTrackingRelease = 1 - Math.exp(
        -1 / (workletSampleRate * 0.035),
      );
      const consonantAttackSlew = 1 - Math.exp(
        -1 / (workletSampleRate * 0.0015),
      );
      const consonantReleaseSlew = 1 - Math.exp(
        -1 / (workletSampleRate * 0.022),
      );
      const detailedAttackSlew = Math.max(attackSlew, consonantAttackSlew);
      const detailedReleaseSlew = Math.max(releaseSlew, consonantReleaseSlew);
      const dryMask = SLIPPERYNTHESIS_FFT_SIZE - 1;
      const adaptiveSlewSeconds = (
        this.adaptiveWeightFloorTarget > this.adaptiveWeightFloor ? 0.012 : 0.4
      );
      const adaptiveSlew = 1 - Math.exp(
        -leftOutput.length / (workletSampleRate * adaptiveSlewSeconds),
      );
      this.adaptiveWeightFloor += (
        this.adaptiveWeightFloorTarget - this.adaptiveWeightFloor
      ) * adaptiveSlew;

      if (
        this.pendingStructure
        && this.structureGain <= STRUCTURE_REBUILD_GAIN
      ) {
        this.configureStructure(this.pendingStructure, { preserveState: true });
        this.pendingStructure = null;
        this.structureGain = Math.max(
          STRUCTURE_REBUILD_GAIN,
          this.structureGain,
        );
      }
      const transposeRatio = 2 ** this.current.transpose;
      const octaveStep = Math.log2(
        this.bandPlan.highFrequency / this.bandPlan.lowFrequency,
      ) / Math.max(1, this.bandCount - 1);
      const relativeNoiseHalfWidth = 2 ** (octaveStep * 0.5) - 1;
      const noiseCeiling = Math.min(
        this.highFrequency,
        workletSampleRate * 0.45,
      );
      for (let band = 0; band < this.bandCount; band += 1) {
        this.bandToneGains[band] = spectralTiltGain(
          this.bandPlan.centers[band],
          this.current.spectralTilt,
        );
      }

      let spectrumActive = false;
      for (let sampleIndex = 0; sampleIndex < leftOutput.length; sampleIndex += 1) {
        this.current.slipRate += (
          this.target.slipRate - this.current.slipRate
        ) * parameterSlew;
        this.current.coherence += (
          this.target.coherence - this.current.coherence
        ) * parameterSlew;
        this.current.response += (
          this.target.response - this.current.response
        ) * parameterSlew;
        this.current.consonantDetail += (
          this.target.consonantDetail - this.current.consonantDetail
        ) * parameterSlew;
        this.current.transpose += (
          this.target.transpose - this.current.transpose
        ) * parameterSlew;
        this.current.glideShape += (
          this.target.glideShape - this.current.glideShape
        ) * parameterSlew;
        this.current.spectralTilt += (
          this.target.spectralTilt - this.current.spectralTilt
        ) * parameterSlew;
        this.current.carrierColor += (
          this.target.carrierColor - this.current.carrierColor
        ) * parameterSlew;
        this.current.stereoWidth += (
          this.target.stereoWidth - this.current.stereoWidth
        ) * parameterSlew;
        this.current.gateDb += (
          this.target.gateDb - this.current.gateDb
        ) * parameterSlew;
        this.current.inputGain += (
          this.target.inputGain - this.current.inputGain
        ) * parameterSlew;
        this.current.dryWet += (
          this.target.dryWet - this.current.dryWet
        ) * parameterSlew;
        this.activeGain += (this.activeTarget - this.activeGain) * activeSlew;
        const structureTarget = this.pendingStructure ? 0 : 1;
        this.structureGain += (
          structureTarget - this.structureGain
        ) * structureSlew;

        const sourceLeft = Number.isFinite(inputLeft?.[sampleIndex])
          ? inputLeft[sampleIndex]
          : 0;
        const sourceRight = Number.isFinite(inputRight?.[sampleIndex])
          ? inputRight[sampleIndex]
          : sourceLeft;
        const gainedLeft = sourceLeft * this.current.inputGain;
        const gainedRight = sourceRight * this.current.inputGain;
        const mono = (gainedLeft + gainedRight) * 0.5;

        this.analysisRing[this.analysisWriteIndex] = mono;
        this.analysisWriteIndex = (this.analysisWriteIndex + 1) & dryMask;
        if (this.analysisFill < SLIPPERYNTHESIS_FFT_SIZE) this.analysisFill += 1;
        this.hopCounter += 1;
        if (
          this.analysisFill === SLIPPERYNTHESIS_FFT_SIZE
          && this.hopCounter >= SLIPPERYNTHESIS_HOP_SIZE
        ) {
          this.hopCounter = 0;
          this.analyzeFrame();
        }

        const dryReadIndex = (
          this.dryWriteIndex - DRY_DELAY_SAMPLES
        ) & dryMask;
        const delayedLeft = this.dryLeft[dryReadIndex];
        const delayedRight = this.dryRight[dryReadIndex];
        this.dryLeft[this.dryWriteIndex] = gainedLeft;
        this.dryRight[this.dryWriteIndex] = gainedRight;
        this.dryWriteIndex = (this.dryWriteIndex + 1) & dryMask;

        this.bankPhase = wrapUnit(
          this.bankPhase
          + this.current.slipRate / (this.bankWidth * workletSampleRate),
        );
        let wetLeft = 0;
        let wetRight = 0;

        for (let band = 0; band < this.bandCount; band += 1) {
          const bandNoisiness = this.bandNoisiness[band];
          const noisinessTarget = this.bandNoisinessTargets[band];
          const nextBandNoisiness = bandNoisiness + (
            noisinessTarget - bandNoisiness
          ) * (
            noisinessTarget > bandNoisiness
              ? consonantTrackingAttack
              : consonantTrackingRelease
          );
          this.bandNoisiness[band] = nextBandNoisiness;
          const consonantMix = (
            this.current.consonantDetail * nextBandNoisiness
          );
          const target = this.bandTargets[band];
          const envelope = this.bandEnvelopes[band];
          const envelopeSlew = target > envelope
            ? attackSlew + (detailedAttackSlew - attackSlew) * consonantMix
            : releaseSlew + (detailedReleaseSlew - releaseSlew) * consonantMix;
          const nextEnvelope = envelope + (target - envelope) * envelopeSlew;
          this.bandEnvelopes[band] = nextEnvelope;
          if (nextEnvelope < 1e-7) continue;
          spectrumActive = true;

          const phaseOffset = (
            this.bandOffsets[band] * (1 - this.current.coherence)
            / this.bankWidth
          );
          let weightPower = 0;
          for (let layer = 0; layer < this.bankWidth; layer += 1) {
            const phase = wrapUnit(
              this.bankPhase + phaseOffset + layer / this.bankWidth,
            );
            const envelopeWeight = 0.5 - 0.5 * Math.cos(TAU * phase);
            if (envelopeWeight <= this.adaptiveWeightFloor) {
              this.layerFrequencies[layer] = 0;
              this.layerWeights[layer] = 0;
              this.layerOffsets[layer] = 0;
              continue;
            }
            const adaptiveWeight = this.adaptiveWeightFloor > 1e-6
              ? smoothStep01(
                (envelopeWeight - this.adaptiveWeightFloor)
                / ADAPTIVE_WEIGHT_TRANSITION,
              )
              : 1;
            const warpedPhase = phase + (
              this.current.glideShape
              * phase
              * (1 - phase)
              * (1 - 2 * phase)
            );
            const octaveOffset = (
              this.direction * this.bankWidth * (warpedPhase - 0.5)
            );
            const frequency = (
              this.bandPlan.centers[band]
              * transposeRatio
              * 2 ** octaveOffset
            );
            const antiAlias = slipperAntiAliasWeight(
              frequency,
              this.highFrequency,
              workletSampleRate,
            );
            const weight = envelopeWeight * adaptiveWeight * antiAlias;
            this.layerFrequencies[layer] = frequency;
            this.layerWeights[layer] = weight;
            this.layerOffsets[layer] = octaveOffset;
            weightPower += weight * weight;
          }
          if (weightPower < 1e-12) continue;
          const normalization = Math.min(2, 1 / Math.sqrt(weightPower));

          for (let layer = 0; layer < this.bankWidth; layer += 1) {
            const weight = this.layerWeights[layer];
            if (weight < 1e-7) continue;
            const oscillatorIndex = band * MAX_BANK_WIDTH + layer;
            let oscillatorPhase = (
              this.oscillatorPhases[oscillatorIndex]
              + TAU * this.layerFrequencies[layer] / workletSampleRate
            );
            if (oscillatorPhase >= TAU) oscillatorPhase -= TAU;
            this.oscillatorPhases[oscillatorIndex] = oscillatorPhase;
            const gain = (
              SQRT_TWO
              * nextEnvelope
              * this.bandToneGains[band]
              * weight
              * normalization
            );
            const fundamental = Math.sin(oscillatorPhase);
            let carrier = fundamental;
            if (this.current.carrierColor > 1e-4) {
              const squared = fundamental * fundamental;
              const third = fundamental * (3 - 4 * squared);
              const fifth = fundamental * (
                5 - 20 * squared + 16 * squared * squared
              );
              const thirdWeight = (
                this.current.carrierColor
                * 0.36
                * slipperAntiAliasWeight(
                  this.layerFrequencies[layer] * 3,
                  this.highFrequency,
                  workletSampleRate,
                )
              );
              const fifthWeight = (
                this.current.carrierColor
                * this.current.carrierColor
                * 0.15
                * slipperAntiAliasWeight(
                  this.layerFrequencies[layer] * 5,
                  this.highFrequency,
                  workletSampleRate,
                )
              );
              carrier = (
                fundamental + third * thirdWeight + fifth * fifthWeight
              ) / Math.sqrt(
                1 + thirdWeight * thirdWeight + fifthWeight * fifthWeight,
              );
            }
            if (consonantMix > 1e-4) {
              const guardedUpperFrequency = this.layerFrequencies[layer] * (
                1 + 4 * relativeNoiseHalfWidth
              );
              const noiseAvailability = smoothStep01(
                (noiseCeiling - guardedUpperFrequency)
                / (workletSampleRate * 0.06),
              );
              const noiseMix = consonantMix * noiseAvailability;
              let noiseState = this.noiseState | 0;
              noiseState ^= noiseState << 13;
              noiseState ^= noiseState >>> 17;
              noiseState ^= noiseState << 5;
              this.noiseState = noiseState | 0;
              const whiteNoise = (
                (noiseState >>> 0) / 0x1_0000_0000 * 2 - 1
              );
              const previousNoise = this.oscillatorNoise[oscillatorIndex];
              const filteredNoise = (
                previousNoise * CONSONANT_NOISE_POLE
                + whiteNoise * (1 - CONSONANT_NOISE_POLE)
              );
              this.oscillatorNoise[oscillatorIndex] = filteredNoise;
              carrier *= (
                Math.sqrt(1 - noiseMix)
                + Math.sqrt(noiseMix)
                * filteredNoise
                * CONSONANT_NOISE_NORMALIZATION
              );
            }
            const sample = carrier * gain;
            const normalizedOffset = Math.max(-1, Math.min(
              1,
              this.layerOffsets[layer] / (this.bankWidth * 0.5),
            ));
            const pan = (
              normalizedOffset * this.current.stereoWidth * 0.9
            );
            const panAngle = (pan + 1) * Math.PI * 0.25;
            wetLeft += sample * Math.cos(panAngle);
            wetRight += sample * Math.sin(panAngle);
          }
        }

        const mixAngle = this.current.dryWet * Math.PI * 0.5;
        const dryGain = Math.cos(mixAngle);
        const wetGain = Math.sin(mixAngle) * 0.72 * this.structureGain;
        const left = this.activeGain * (
          delayedLeft * dryGain + wetLeft * wetGain
        );
        const right = this.activeGain * (
          delayedRight * dryGain + wetRight * wetGain
        );
        leftOutput[sampleIndex] = Number.isFinite(left)
          ? Math.max(-8, Math.min(8, left))
          : 0;
        if (rightOutput !== leftOutput) {
          rightOutput[sampleIndex] = Number.isFinite(right)
            ? Math.max(-8, Math.min(8, right))
            : 0;
        }
      }
      if (renderStartedAt !== null && this.performanceNow) {
        const renderedAt = this.performanceNow();
        const elapsedMs = renderedAt - renderStartedAt;
        const quantumMs = leftOutput.length / workletSampleRate * 1_000;
        if (elapsedMs >= 0 && quantumMs > 0) {
          this.recordRenderPerformance(elapsedMs, quantumMs, spectrumActive);
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
    SLIPPERY_RESYNTHESIS_PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

/**
 * Browser graph for microphone or local-file analysis/resynthesis. Importing
 * this module is inert; AudioContext and microphone access remain behind the
 * explicit Audio button gesture.
 */
export class SlipperyResynthesisAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.params = { ...SLIPPERYNTHESIS_DEFAULTS };
    this.context = null;
    this.node = null;
    this.inputAnalyser = null;
    this.highpass = null;
    this.lowpass = null;
    this.ceiling = null;
    this.master = null;
    this.outputAnalyser = null;
    this.outputRelease = null;
    this.sourceNode = null;
    this.sourceKind = null;
    this.mediaStream = null;
    this.mediaElement = null;
    this.mediaElementNodes = new WeakMap();
    this.enabled = false;
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  get state() {
    return Object.freeze({
      initialized: this.isInitialized,
      enabled: this.enabled,
      sourceKind: this.sourceKind,
      contextState: this.context?.state ?? "closed",
    });
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    const AudioWorkletNodeConstructor = (
      this.runtime.AudioWorkletNode ?? globalThis.AudioWorkletNode
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("Slippery Resynthesis requires AudioWorklet support.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close().catch(() => {});
      throw new Error("Slippery Resynthesis requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./slippery-resynthesis.js", import.meta.url),
      );
      const node = new AudioWorkletNodeConstructor(
        context,
        SLIPPERY_RESYNTHESIS_PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { parameters: this.params },
        },
      );
      const inputAnalyser = context.createAnalyser();
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const outputAnalyser = context.createAnalyser();

      for (const analyser of [inputAnalyser, outputAnalyser]) {
        analyser.fftSize = SLIPPERYNTHESIS_FFT_SIZE;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.58;
      }
      highpass.type = "highpass";
      highpass.frequency.value = 20;
      highpass.Q.value = 0.707;
      lowpass.type = "lowpass";
      lowpass.frequency.value = this.params.highFrequency;
      lowpass.Q.value = 0.707;
      ceiling.curve = createSlipperCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;

      inputAnalyser.connect(node);
      node
        .connect(highpass)
        .connect(lowpass)
        .connect(ceiling)
        .connect(master)
        .connect(outputAnalyser);
      this.outputRelease = connectAudioOutput(context, outputAnalyser, {
        runtime: this.runtime,
      });

      this.context = context;
      this.node = node;
      this.inputAnalyser = inputAnalyser;
      this.highpass = highpass;
      this.lowpass = lowpass;
      this.ceiling = ceiling;
      this.master = master;
      this.outputAnalyser = outputAnalyser;
      this.setParameters(this.params);
    } catch (error) {
      this.outputRelease?.();
      this.outputRelease = null;
      await context.close().catch(() => {});
      throw error;
    }
  }

  clearSuspendTimer() {
    if (this.suspendTimer === null) return;
    this.runtime.clearTimeout?.(this.suspendTimer);
    this.suspendTimer = null;
  }

  releaseSource({ pauseElement = true } = {}) {
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    for (const track of this.mediaStream?.getTracks?.() ?? []) track.stop();
    this.mediaStream = null;
    if (pauseElement) this.mediaElement?.pause?.();
    this.mediaElement = null;
    this.sourceKind = null;
  }

  async connectSource(source) {
    if (source?.kind === "microphone") {
      const getUserMedia = (
        this.runtime.navigator?.mediaDevices?.getUserMedia
      )?.bind(this.runtime.navigator.mediaDevices);
      if (typeof getUserMedia !== "function") {
        throw new Error("Microphone input is not available in this browser.");
      }
      const stream = await getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      this.mediaStream = stream;
      const sourceNode = this.context.createMediaStreamSource(stream);
      sourceNode.connect(this.inputAnalyser);
      this.sourceNode = sourceNode;
      this.sourceKind = "microphone";
      return;
    }

    if (source?.kind === "file" && source.element) {
      const element = source.element;
      let sourceNode = this.mediaElementNodes.get(element);
      if (!sourceNode) {
        sourceNode = this.context.createMediaElementSource(element);
        this.mediaElementNodes.set(element, sourceNode);
      }
      sourceNode.connect(this.inputAnalyser);
      this.sourceNode = sourceNode;
      this.mediaElement = element;
      this.sourceKind = "file";
      await element.play?.();
      return;
    }

    throw new Error("Choose a microphone or local audio file first.");
  }

  async start(source) {
    await this.initialize();
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    await this.context.resume();
    try {
      await this.connectSource(source);
      const now = this.context.currentTime;
      this.node.port.postMessage({ type: "reset" });
      this.node.port.postMessage({ type: "active", value: true });
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(
        this.params.outputLevel,
        now + 0.035,
      );
      this.enabled = true;
    } catch (error) {
      this.releaseSource();
      this.node.port.postMessage({ type: "active", value: false });
      this.master.gain.value = 0;
      await this.context.suspend().catch(() => {});
      throw error;
    }
  }

  setParameters(params = {}) {
    this.params = {
      ...sanitizeSlipperyResynthesisParams({
        ...this.params,
        ...params,
      }),
    };
    this.node?.port.postMessage({
      type: "parameters",
      parameters: this.params,
    });
    if (this.isInitialized) {
      this.lowpass.frequency.setTargetAtTime(
        this.params.highFrequency,
        this.context.currentTime,
        0.025,
      );
      if (this.enabled) {
        this.master.gain.setTargetAtTime(
          this.params.outputLevel,
          this.context.currentTime,
          0.015,
        );
      }
    }
    return Object.freeze({ ...this.params });
  }

  get spectrumBinCount() {
    return this.inputAnalyser?.frequencyBinCount
      ?? SLIPPERYNTHESIS_FFT_SIZE / 2;
  }

  getSpectra(inputTarget, outputTarget) {
    if (
      !this.inputAnalyser
      || !this.outputAnalyser
      || !(inputTarget instanceof Float32Array)
      || !(outputTarget instanceof Float32Array)
      || inputTarget.length !== this.inputAnalyser.frequencyBinCount
      || outputTarget.length !== this.outputAnalyser.frequencyBinCount
    ) return false;
    this.inputAnalyser.getFloatFrequencyData(inputTarget);
    this.outputAnalyser.getFloatFrequencyData(outputTarget);
    return true;
  }

  async stop() {
    this.clearSuspendTimer();
    this.releaseSource();
    if (!this.isInitialized) {
      this.enabled = false;
      return;
    }
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: false });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  async close() {
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.inputAnalyser?.disconnect();
    this.highpass?.disconnect();
    this.lowpass?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.outputRelease?.();
    this.outputRelease = null;
    this.outputAnalyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.inputAnalyser = null;
    this.highpass = null;
    this.lowpass = null;
    this.ceiling = null;
    this.master = null;
    this.outputAnalyser = null;
    this.sourceKind = null;
    this.mediaElementNodes = new WeakMap();
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
