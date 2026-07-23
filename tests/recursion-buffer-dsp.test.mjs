import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BUFFER_RECURSION_DEPTH,
  convolutionImpulseGenerations,
  generateImpulseSeed,
  generateNoiseSeed,
  normalizeChannels,
  ouroborosGenerations,
} from "../src/recursion-buffer-dsp.js";

function peakOf(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

function rmsOf(channels) {
  let energy = 0;
  let count = 0;
  for (const channel of channels) {
    count += channel.length;
    for (const sample of channel) energy += sample * sample;
  }
  return count ? Math.sqrt(energy / count) : 0;
}

function differenceOf(first, second) {
  let difference = 0;
  let count = 0;
  for (let channel = 0; channel < first.length; channel += 1) {
    const length = Math.min(first[channel].length, second[channel].length);
    count += length;
    for (let index = 0; index < length; index += 1) {
      difference += Math.abs(first[channel][index] - second[channel][index]);
    }
  }
  return count ? difference / count : 0;
}

function assertFiniteAndBounded(channels, {
  peakLimit = 0.88,
  targetRms = 0.18,
} = {}) {
  assert.equal(channels.length, 2);
  for (const channel of channels) {
    assert.ok(channel instanceof Float32Array);
    assert.ok(channel.every(Number.isFinite));
  }
  assert.ok(peakOf(channels) <= peakLimit + 1e-6);
  assert.ok(rmsOf(channels) <= targetRms + 1e-6);
  for (const channel of channels) {
    assert.ok(rmsOf([channel]) <= targetRms + 1e-6);
  }
}

test("pink-ish noise seeds are deterministic, stereo, broadband, and bounded", () => {
  const options = { sampleRate: 8_000, duration: 0.5, seed: "recursive fog" };
  const first = generateNoiseSeed(options);
  const second = generateNoiseSeed(options);
  const different = generateNoiseSeed({ ...options, seed: "other fog" });

  assert.deepEqual(first, second);
  assert.equal(first[0].length, 4_000);
  assert.equal(first[1].length, 4_000);
  assertFiniteAndBounded(first);
  assert.ok(differenceOf(first, different) > 0.05);
  assert.ok(differenceOf([first[0]], [first[1]]) > 0.05);

  let lagEnergy = 0;
  let directEnergy = 0;
  let zeroCrossings = 0;
  for (let index = 1; index < first[0].length; index += 1) {
    lagEnergy += first[0][index] * first[0][index - 1];
    directEnergy += first[0][index] * first[0][index];
    if (Math.sign(first[0][index]) !== Math.sign(first[0][index - 1])) {
      zeroCrossings += 1;
    }
  }
  assert.ok(lagEnergy / directEnergy > 0.05, "pink tilt should correlate neighbors");
  assert.ok(zeroCrossings > 250, "the seed should retain broadband detail");
});

test("impulse seeds retain literal sparse structure and repeat exactly", () => {
  const options = { sampleRate: 12_000, duration: 1, seed: 919 };
  const first = generateImpulseSeed(options);
  const second = generateImpulseSeed(options);
  assert.deepEqual(first, second);
  assertFiniteAndBounded(first);

  for (const channel of first) {
    const active = channel.reduce(
      (count, sample) => count + (Math.abs(sample) > 1e-8 ? 1 : 0),
      0,
    );
    assert.ok(active > 12, "a seed should contain several broadband micro-bursts");
    assert.ok(active / channel.length < 0.04, "most of an impulse IR stays silent");
  }
  assert.ok(Math.abs(first[0][0]) > 0);
  assert.ok(Math.abs(first[1][0]) > 0);
});

test("channel normalization sanitizes bad input without changing stereo balance", () => {
  const left = Float64Array.from([0.5, -0.5, Number.NaN, 0.25, 200]);
  const right = Float64Array.from([0.25, -0.25, Number.POSITIVE_INFINITY, 0.125, 100]);
  const originalLeft = left.slice();
  const normalized = normalizeChannels([left, right], {
    targetRms: 0.2,
    peakLimit: 0.7,
  });

  assert.deepEqual(left, originalLeft, "normalization must not mutate its input");
  assertFiniteAndBounded(normalized, { targetRms: 0.2, peakLimit: 0.7 });
  assert.equal(normalized[0][2], 0);
  assert.equal(normalized[1][2], 0);
  assert.ok(Math.abs(normalized[0][0] / normalized[1][0] - 2) < 1e-6);
});

test("normalization is idempotent even for extremely quiet finite buffers", () => {
  const left = Float32Array.from([1e-12, 0, -3e-12, 0, 2e-12]);
  const right = Float32Array.from([0, -1e-13, 0, 4e-13, 0]);
  const first = normalizeChannels([left, right], {
    targetRms: 0.17,
    peakLimit: 0.71,
  });
  const second = normalizeChannels(first, {
    targetRms: 0.17,
    peakLimit: 0.71,
  });

  assert.ok(differenceOf(first, second) < 2e-8);
  assertFiniteAndBounded(first, { targetRms: 0.17, peakLimit: 0.71 });
});

test("ouroboros generations are finite, capped, changing, and parent-only", () => {
  const seed = generateNoiseSeed({
    sampleRate: 4_096,
    duration: 1,
    seed: 0x0b0a05,
  });
  seed[0][3] = Number.NaN;
  seed[1][17] = Number.POSITIVE_INFINITY;
  const options = {
    depth: 99,
    transform: 0.72,
    intensity: 0.86,
    targetRms: 0.16,
    peakLimit: 0.74,
  };
  const generations = ouroborosGenerations(seed, options);

  assert.equal(generations.length, MAX_BUFFER_RECURSION_DEPTH + 1);
  for (let generation = 0; generation < generations.length; generation += 1) {
    assertFiniteAndBounded(generations[generation], {
      targetRms: 0.16,
      peakLimit: 0.74,
    });
    assert.equal(generations[generation][0].length, seed[0].length);
    if (generation > 0) {
      assert.ok(
        differenceOf(generations[generation - 1], generations[generation]) > 0.01,
        `generation ${generation} should audibly change its parent`,
      );
    }
  }

  const restarted = ouroborosGenerations(generations[2], {
    ...options,
    depth: 1,
  });
  assert.ok(
    differenceOf(restarted[1], generations[3]) < 2e-7,
    "a child must be reproducible from its immediate parent alone",
  );
});

test("quiet nonlinear ouroboros descendants restart from their returned parent", () => {
  const left = new Float32Array(257);
  const right = new Float32Array(257);
  left[3] = 2e-10;
  left[101] = -7e-11;
  right[17] = -1e-10;
  right[199] = 5e-11;
  const options = {
    depth: 2,
    transform: 0.81,
    intensity: 0.94,
    targetRms: 0.16,
    peakLimit: 0.72,
  };
  const generations = ouroborosGenerations([left, right], options);
  const restarted = ouroborosGenerations(generations[1], {
    ...options,
    depth: 1,
  });
  assert.ok(differenceOf(restarted[1], generations[2]) < 2e-7);
});

test("ouroboros reversal swaps stereo before folding and filtering", () => {
  const left = Float32Array.from([0.8, 0, 0, 0, 0, 0, 0, 0]);
  const right = Float32Array.from([0, 0, 0, 0, 0, 0, 0, -0.4]);
  const [seed, child] = ouroborosGenerations([left, right], {
    depth: 1,
    transform: 0,
    intensity: 0,
    targetRms: 0.2,
    peakLimit: 0.8,
  });

  assert.ok(Math.abs(child[0][0]) > Math.abs(child[0][7]));
  assert.ok(Math.abs(child[1][7]) > Math.abs(child[1][0]));
  assert.ok(differenceOf(seed, child) > 0.02);
});

test("recursive self-convolution remains fixed-length, bounded, and deterministic", () => {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  left[0] = 1;
  left[11] = -0.55;
  left[29] = 0.31;
  right[0] = 0.8;
  right[7] = 0.4;
  right[31] = -0.28;
  const options = {
    depth: 4,
    transform: 0.6,
    intensity: 0.72,
    maxSamples: 96,
    targetRms: 0.14,
    peakLimit: 0.68,
  };
  const first = convolutionImpulseGenerations([left, right], options);
  const second = convolutionImpulseGenerations([left, right], options);

  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  for (let generation = 0; generation < first.length; generation += 1) {
    assert.equal(first[generation][0].length, 96);
    assert.equal(first[generation][1].length, 96);
    assertFiniteAndBounded(first[generation], {
      targetRms: 0.14,
      peakLimit: 0.68,
    });
    assert.ok(
      first[generation].some((channel) => channel.some((sample) => sample !== 0)),
    );
  }
  assert.notEqual(first[1][0][22], 0, "11 + 11 should appear in self-convolution");
  assert.ok(differenceOf(first[0], first[1]) > 0.005);
});

test("convolution descendants use only their parent and cap recursion depth", () => {
  const seed = generateImpulseSeed({
    sampleRate: 4_000,
    duration: 0.25,
    seed: "small room",
  });
  const options = {
    depth: 50,
    transform: 0.44,
    intensity: 0.3,
    maxSamples: 1_000,
  };
  const generations = convolutionImpulseGenerations(seed, options);
  assert.equal(generations.length, MAX_BUFFER_RECURSION_DEPTH + 1);

  const restarted = convolutionImpulseGenerations(generations[1], {
    ...options,
    depth: 1,
  });
  assert.ok(differenceOf(restarted[1], generations[2]) < 2e-7);
  for (const generation of generations) assertFiniteAndBounded(generation);
});
