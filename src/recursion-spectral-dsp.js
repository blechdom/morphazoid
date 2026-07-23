const TWO_PI = Math.PI * 2;
const MIN_FFT_SIZE = 64;
const MAX_FFT_SIZE = 4_096;
const DEFAULT_FFT_SIZE = 1_024;
const MAX_SAFE_SAMPLE = 8;
const MAX_SAFE_FFT_VALUE = 1e100;
const SILENCE_EPSILON = 1e-12;

export const MAX_RECURSION_DEPTH = 6;
export const MAX_SPECTRAL_INPUT_SAMPLES = 1 << 19;

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function clampInteger(value, minimum, maximum, fallback) {
  return Math.round(clamp(value, minimum, maximum, fallback));
}

function finiteSample(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_SAFE_SAMPLE, Math.max(-MAX_SAFE_SAMPLE, number));
}

function finiteFftValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_SAFE_FFT_VALUE, Math.max(-MAX_SAFE_FFT_VALUE, number));
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function normalizeFftSize(value) {
  const requested = clamp(value, MIN_FFT_SIZE, MAX_FFT_SIZE, DEFAULT_FFT_SIZE);
  const exponent = Math.round(Math.log2(requested));
  return 2 ** exponent;
}

function assertComplexInput(realInput, imaginaryInput) {
  if (realInput == null || !Number.isInteger(realInput.length)) {
    throw new TypeError("FFT input must be an array or typed array.");
  }
  const length = realInput.length;
  if (!isPowerOfTwo(length) || length > MAX_FFT_SIZE) {
    throw new RangeError(
      `FFT length must be a power of two between 1 and ${MAX_FFT_SIZE}.`,
    );
  }
  if (imaginaryInput != null && imaginaryInput.length !== length) {
    throw new RangeError("Real and imaginary FFT inputs must have equal lengths.");
  }
}

function fftInPlace(real, imaginary, inverse) {
  const length = real.length;

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
    const angle = (inverse ? TWO_PI : -TWO_PI) / width;
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

        const nextTwiddleReal = (
          twiddleReal * rootReal - twiddleImaginary * rootImaginary
        );
        twiddleImaginary = (
          twiddleReal * rootImaginary + twiddleImaginary * rootReal
        );
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

function complexTransform(realInput, imaginaryInput, inverse) {
  assertComplexInput(realInput, imaginaryInput);
  const length = realInput.length;
  const real = new Float64Array(length);
  const imaginary = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    real[index] = finiteFftValue(realInput[index]);
    imaginary[index] = finiteFftValue(imaginaryInput?.[index] ?? 0);
  }
  fftInPlace(real, imaginary, inverse);
  return {
    real,
    imag: imaginary,
    imaginary,
  };
}

/** Return a new complex spectrum without mutating either input array. */
export function fft(realInput, imaginaryInput) {
  return complexTransform(realInput, imaginaryInput, false);
}

/** Return a new inverse-transformed complex signal without mutating either input. */
export function ifft(realInput, imaginaryInput) {
  return complexTransform(realInput, imaginaryInput, true);
}

/** One fold of the normalized frequency axis: 0 → 0, .5 → 1, 1 → 0. */
export function tentFold(normalizedFrequency) {
  const frequency = clamp(normalizedFrequency, 0, 1, 0);
  return 1 - Math.abs(2 * frequency - 1);
}

/**
 * Interpolate between an unchanged frequency axis and a fully folded one.
 * This helper is exported so a visualization can use exactly the DSP mapping.
 */
export function mobiusFrequencyMap(normalizedFrequency, transform = 1) {
  const frequency = clamp(normalizedFrequency, 0, 1, 0);
  const amount = clamp(transform, 0, 1, 1);
  return frequency + (tentFold(frequency) - frequency) * amount;
}

function hannWindow(length) {
  const window = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    // The periodic form aligns adjacent frames at the common power-of-two hops.
    window[index] = 0.5 - 0.5 * Math.cos(TWO_PI * index / length);
  }
  return window;
}

function interpolateSpectrum(real, imaginary, sourceBin, halfSize) {
  const boundedBin = Math.min(halfSize, Math.max(0, sourceBin));
  const left = Math.floor(boundedBin);
  const right = Math.min(halfSize, left + 1);
  const fraction = boundedBin - left;
  return {
    real: real[left] + (real[right] - real[left]) * fraction,
    imaginary: imaginary[left] + (imaginary[right] - imaginary[left]) * fraction,
  };
}

function foldSpectrum(
  sourceReal,
  sourceImaginary,
  targetReal,
  targetImaginary,
  generation,
  transform,
  intensity,
) {
  const length = sourceReal.length;
  const halfSize = length / 2;
  targetReal.fill(0);
  targetImaginary.fill(0);

  for (let bin = 1; bin <= halfSize; bin += 1) {
    const normalizedFrequency = bin / halfSize;
    const mappedFrequency = mobiusFrequencyMap(normalizedFrequency, transform);
    const source = interpolateSpectrum(
      sourceReal,
      sourceImaginary,
      mappedFrequency * halfSize,
      halfSize,
    );

    // The descending side of the fold turns through a bounded half-rotation.
    // A smaller continuous twist stops the fold from sounding like a static EQ.
    const descendingBranch = normalizedFrequency > 0.5 ? 1 : 0;
    const phaseStrength = transform * intensity;
    const inversion = descendingBranch * Math.PI * phaseStrength;
    const twist = (
      (normalizedFrequency * 2 - 1)
      * Math.PI
      * 0.35
      * phaseStrength
    );
    const recursiveTurn = (
      Math.sin((normalizedFrequency + generation * 0.173) * TWO_PI)
      * Math.PI
      * 0.12
      * phaseStrength
    );
    const rotation = inversion + twist + recursiveTurn;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const rotatedReal = source.real * cosine - source.imaginary * sine;
    const rotatedImaginary = source.real * sine + source.imaginary * cosine;

    targetReal[bin] = Number.isFinite(rotatedReal) ? rotatedReal : 0;
    targetImaginary[bin] = (
      bin === halfSize || !Number.isFinite(rotatedImaginary)
        ? 0
        : rotatedImaginary
    );
  }

  // Recreate the negative-frequency half so the inverse transform stays real.
  for (let bin = 1; bin < halfSize; bin += 1) {
    targetReal[length - bin] = targetReal[bin];
    targetImaginary[length - bin] = -targetImaginary[bin];
  }
}

function removeDcAndNormalize(input, targetRms, peakLimit) {
  const output = new Float32Array(input.length);
  if (input.length === 0) return output;

  let mean = 0;
  for (let index = 0; index < input.length; index += 1) {
    mean += finiteSample(input[index]);
  }
  mean /= input.length;

  let energy = 0;
  let peak = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = finiteSample(input[index]) - mean;
    output[index] = sample;
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const rms = Math.sqrt(energy / input.length);
  if (
    !Number.isFinite(rms)
    || !Number.isFinite(peak)
    || rms < SILENCE_EPSILON
    || peak < SILENCE_EPSILON
  ) {
    output.fill(0);
    return output;
  }

  const rmsGain = targetRms > 0 ? targetRms / rms : 0;
  const peakGain = peakLimit / peak;
  const gain = Math.max(0, Math.min(rmsGain, peakGain, 32));
  for (let index = 0; index < output.length; index += 1) {
    const sample = output[index] * gain;
    output[index] = Number.isFinite(sample)
      ? Math.min(peakLimit, Math.max(-peakLimit, sample))
      : 0;
  }
  return output;
}

function renderFoldedGeneration(source, configuration, generation) {
  const {
    fftSize,
    hopSize,
    transform,
    intensity,
    targetRms,
    peakLimit,
  } = configuration;
  const outputAccumulator = new Float64Array(source.length);
  const overlapWeight = new Float64Array(source.length);
  const window = hannWindow(fftSize);
  const frameReal = new Float64Array(fftSize);
  const frameImaginary = new Float64Array(fftSize);
  const foldedReal = new Float64Array(fftSize);
  const foldedImaginary = new Float64Array(fftSize);

  // Begin in the zero-padding before the signal so its first and final samples
  // receive the same overlap treatment as samples in the middle.
  for (
    let frameStart = -fftSize + hopSize;
    frameStart < source.length;
    frameStart += hopSize
  ) {
    frameReal.fill(0);
    frameImaginary.fill(0);
    for (let index = 0; index < fftSize; index += 1) {
      const sourceIndex = frameStart + index;
      if (sourceIndex >= 0 && sourceIndex < source.length) {
        frameReal[index] = finiteSample(source[sourceIndex]) * window[index];
      }
    }

    fftInPlace(frameReal, frameImaginary, false);
    foldSpectrum(
      frameReal,
      frameImaginary,
      foldedReal,
      foldedImaginary,
      generation,
      transform,
      intensity,
    );
    fftInPlace(foldedReal, foldedImaginary, true);

    for (let index = 0; index < fftSize; index += 1) {
      const outputIndex = frameStart + index;
      if (outputIndex < 0 || outputIndex >= source.length) continue;
      const windowValue = window[index];
      const sample = foldedReal[index] * windowValue;
      outputAccumulator[outputIndex] += Number.isFinite(sample) ? sample : 0;
      overlapWeight[outputIndex] += windowValue * windowValue;
    }
  }

  const reconstructed = new Float64Array(source.length);
  for (let index = 0; index < reconstructed.length; index += 1) {
    const weight = overlapWeight[index];
    const sample = weight > SILENCE_EPSILON
      ? outputAccumulator[index] / weight
      : 0;
    reconstructed[index] = Number.isFinite(sample) ? sample : 0;
  }
  return removeDcAndNormalize(reconstructed, targetRms, peakLimit);
}

function normalizedConfiguration(options) {
  const fftSize = normalizeFftSize(options.fftSize);
  return {
    depth: clampInteger(options.depth, 0, MAX_RECURSION_DEPTH, 4),
    fftSize,
    hopSize: clampInteger(options.hopSize, 1, fftSize / 2, fftSize / 4),
    transform: clamp(options.transform, 0, 1, 0.78),
    intensity: clamp(options.intensity, 0, 1, 0.68),
    targetRms: clamp(options.targetRms, 0, 0.5, 0.18),
    peakLimit: clamp(options.peakLimit, 0.05, 1, 0.92),
    maxInputSamples: clampInteger(
      options.maxInputSamples,
      0,
      MAX_SPECTRAL_INPUT_SAMPLES,
      MAX_SPECTRAL_INPUT_SAMPLES,
    ),
  };
}

/**
 * Render a bounded recursive chain of spectral folds.
 *
 * Generation zero is a DC-free, normalized copy of the seed. Every later
 * Float32Array is rendered only from the preceding generation.
 */
export function spectralMobiusGenerations(input, options = {}) {
  if (!(input instanceof Float32Array)) {
    throw new TypeError("spectralMobiusGenerations expects mono Float32Array input.");
  }
  const configuration = normalizedConfiguration(options ?? {});
  const length = Math.min(input.length, configuration.maxInputSamples);
  const seed = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    seed[index] = finiteSample(input[index]);
  }

  const generations = [
    removeDcAndNormalize(seed, configuration.targetRms, configuration.peakLimit),
  ];
  for (let generation = 1; generation <= configuration.depth; generation += 1) {
    generations.push(
      renderFoldedGeneration(
        generations[generation - 1],
        configuration,
        generation,
      ),
    );
  }
  return generations;
}
