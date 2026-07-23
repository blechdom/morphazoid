import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECURSION_DEPTH,
  MAX_SPECTRAL_INPUT_SAMPLES,
  fft,
  ifft,
  mobiusFrequencyMap,
  spectralMobiusGenerations,
  tentFold,
} from "../src/recursion-spectral-dsp.js";

const TWO_PI = Math.PI * 2;

function peakOf(signal) {
  let peak = 0;
  for (const sample of signal) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function meanOf(signal) {
  let sum = 0;
  for (const sample of signal) sum += sample;
  return signal.length ? sum / signal.length : 0;
}

function toneMagnitude(signal, cyclesPerSample, trim = 0) {
  let real = 0;
  let imaginary = 0;
  const end = signal.length - trim;
  for (let index = trim; index < end; index += 1) {
    const angle = 2 * Math.PI * cyclesPerSample * index;
    real += signal[index] * Math.cos(angle);
    imaginary -= signal[index] * Math.sin(angle);
  }
  const count = Math.max(1, end - trim);
  return 2 * Math.hypot(real, imaginary) / count;
}

test("radix-2 FFT and IFFT round-trip real and imaginary samples", () => {
  const real = Float64Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.37) * 0.4 + Math.cos(index * 0.11) * 0.2,
  );
  const imaginary = Float64Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * 0.071) * 0.13,
  );
  const originalReal = real.slice();
  const originalImaginary = imaginary.slice();
  const spectrum = fft(real, imaginary);
  assert.equal(spectrum.imag, spectrum.imaginary);
  const reconstructed = ifft(spectrum.real, spectrum.imaginary);

  assert.deepEqual(real, originalReal, "FFT must not mutate its real input");
  assert.deepEqual(imaginary, originalImaginary, "FFT must not mutate its imaginary input");
  for (let index = 0; index < real.length; index += 1) {
    assert.ok(Math.abs(reconstructed.real[index] - real[index]) < 1e-10);
    assert.ok(Math.abs(reconstructed.imaginary[index] - imaginary[index]) < 1e-10);
  }
  assert.throws(() => fft(new Float64Array(12)), RangeError);
  assert.throws(
    () => fft(new Float64Array(64), new Float64Array(32)),
    RangeError,
  );
});

test("spectral recursion sanitizes input and keeps every generation finite and bounded", () => {
  const input = Float32Array.from(
    { length: 5_123 },
    (_, index) => (
      Math.sin(index * 0.09) * 0.7
      + Math.sin(index * 0.017) * 0.31
      + ((index % 29) / 29 - 0.5) * 0.15
    ),
  );
  input[7] = Number.NaN;
  input[53] = Number.POSITIVE_INFINITY;
  input[107] = Number.NEGATIVE_INFINITY;

  const generations = spectralMobiusGenerations(input, {
    depth: 99,
    fftSize: 512,
    hopSize: 128,
    targetRms: 0.2,
    peakLimit: 0.7,
  });

  assert.equal(generations.length, MAX_RECURSION_DEPTH + 1);
  for (const generation of generations) {
    assert.ok(generation instanceof Float32Array);
    assert.equal(generation.length, input.length);
    assert.ok(generation.every(Number.isFinite));
    assert.ok(peakOf(generation) <= 0.700001);
    assert.ok(Math.abs(meanOf(generation)) < 1e-6);
  }
});

test("spectral recursion caps input length and is deterministic", () => {
  const oversized = new Float32Array(MAX_SPECTRAL_INPUT_SAMPLES + 17);
  const capped = spectralMobiusGenerations(oversized, { depth: 0 });
  assert.equal(capped[0].length, MAX_SPECTRAL_INPUT_SAMPLES);

  const input = Float32Array.from(
    { length: 4_096 },
    (_, index) => (
      Math.sin(index * 0.031)
      + Math.cos(index * index * 0.000013) * 0.3
    ),
  );
  const options = {
    depth: 3,
    fftSize: 512,
    hopSize: 128,
    transform: 0.83,
    intensity: 0.74,
  };
  const first = spectralMobiusGenerations(input, options);
  const second = spectralMobiusGenerations(input, options);
  assert.deepEqual(first, second);
});

test("every recursive spectral generation is rendered from and differs from its parent", () => {
  const input = Float32Array.from(
    { length: 8_192 },
    (_, index) => (
      Math.sin(TWO_PI * index / 43) * 0.55
      + Math.sin(TWO_PI * index / 137) * 0.28
      + (((index * 73) % 257) / 128.5 - 1) * 0.12
    ),
  );
  const generations = spectralMobiusGenerations(input, {
    depth: 4,
    fftSize: 512,
    transform: 0.8,
    intensity: 0.7,
  });

  for (let generation = 1; generation < generations.length; generation += 1) {
    let absoluteDifference = 0;
    const current = generations[generation];
    const parent = generations[generation - 1];
    for (let index = 0; index < current.length; index += 1) {
      absoluteDifference += Math.abs(current[index] - parent[index]);
    }
    assert.ok(
      absoluteDifference / current.length > 0.01,
      `generation ${generation} should audibly differ from its parent`,
    );
  }
});

test("the full tent fold splits one spectral line toward both frequency-axis edges", () => {
  assert.equal(tentFold(0), 0);
  assert.equal(tentFold(0.25), 0.5);
  assert.equal(tentFold(0.5), 1);
  assert.equal(tentFold(0.75), 0.5);
  assert.equal(tentFold(1), 0);
  assert.equal(mobiusFrequencyMap(0.25, 0), 0.25);
  assert.equal(mobiusFrequencyMap(0.25, 1), 0.5);

  const fftSize = 512;
  const inputBin = 64;
  const inputFrequency = inputBin / fftSize;
  const input = Float32Array.from(
    { length: 8_192 },
    (_, index) => Math.sin(TWO_PI * inputFrequency * index) * 0.5,
  );
  const [, folded] = spectralMobiusGenerations(input, {
    depth: 1,
    fftSize,
    hopSize: fftSize / 4,
    transform: 1,
    intensity: 0,
    targetRms: 0.2,
  });

  const lowBranch = toneMagnitude(folded, 32 / fftSize, fftSize);
  const highBranch = toneMagnitude(folded, 224 / fftSize, fftSize);
  const oldLocation = toneMagnitude(folded, inputFrequency, fftSize);
  assert.ok(lowBranch > 0.03, "the lower preimage of the fold should be audible");
  assert.ok(highBranch > 0.03, "the upper preimage of the fold should be audible");
  assert.ok(lowBranch > oldLocation * 8);
  assert.ok(highBranch > oldLocation * 8);
});
