import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test, { after } from "node:test";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const MODULE_URL = new URL("../src/slippery-resynthesis.js", import.meta.url);

const savedWorkletGlobals = new Map(
  ["sampleRate", "AudioWorkletProcessor", "registerProcessor"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

let registeredName = null;
let ProcessorConstructor = null;

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage(message) {
        this.messages.push(message);
      },
    };
  }
}

Object.defineProperties(globalThis, {
  sampleRate: {
    configurable: true,
    writable: true,
    value: SAMPLE_RATE,
  },
  AudioWorkletProcessor: {
    configurable: true,
    writable: true,
    value: MockAudioWorkletProcessor,
  },
  registerProcessor: {
    configurable: true,
    writable: true,
    value(name, constructor) {
      registeredName = name;
      ProcessorConstructor = constructor;
    },
  },
});

const slipperyResynthesis = await import(
  `${MODULE_URL.href}?slippery-resynthesis-test=${Date.now()}`
);

const {
  SLIPPERYNTHESIS_DEFAULTS,
  SLIPPERYNTHESIS_FFT_SIZE,
  SLIPPERYNTHESIS_HOP_SIZE,
  SLIPPERYNTHESIS_LIMITS,
  SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD,
  SLIPPERY_RESYNTHESIS_PRESETS,
  SLIPPERY_RESYNTHESIS_PROCESSOR_NAME: SLIPPERYNTHESIS_PROCESSOR_NAME,
  SlipperyResynthesisAudio,
  adaptiveShepardTierForVoiceCount,
  calculateSlipperPartials,
  createLogBandPlan,
  createPeriodicHannWindow,
  fftInPlace,
  logBandCenters,
  sanitizeSlipperyResynthesisParams,
  slipperAntiAliasWeight,
  slipperyGlidePhase,
  slipperyHann,
  spectralTiltGain,
} = slipperyResynthesis;

after(() => {
  for (const [key, descriptor] of savedWorkletGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function rms(samples, start = 0) {
  let squareSum = 0;
  let count = 0;
  for (let index = Math.max(0, start); index < samples.length; index += 1) {
    squareSum += samples[index] * samples[index];
    count += 1;
  }
  return Math.sqrt(squareSum / Math.max(1, count));
}

function renderProcessor(processor, frameCount, sampleAtFrame = () => 0) {
  const length = Math.ceil(frameCount / BLOCK_SIZE) * BLOCK_SIZE;
  const leftResult = new Float32Array(length);
  const rightResult = new Float32Array(length);
  for (let offset = 0; offset < length; offset += BLOCK_SIZE) {
    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      input[frame] = sampleAtFrame(offset + frame);
    }
    assert.equal(processor.process([[input]], [[left, right]]), true);
    leftResult.set(left, offset);
    rightResult.set(right, offset);
  }
  return { left: leftResult, right: rightResult };
}

function assertFiniteAudio(channels) {
  for (const channel of channels) {
    for (const sample of channel) {
      assert.ok(Number.isFinite(sample), "rendered audio must remain finite");
      assert.ok(Math.abs(sample) <= 8, "the worklet safety clamp must hold");
    }
  }
}

test("Slippery Resynthesis parameters are finite, bounded, and stay inside the oscillator budget", () => {
  const sanitized = sanitizeSlipperyResynthesisParams({
    direction: -12,
    slipRate: 99,
    bankWidth: 99,
    coherence: -4,
    bandCount: 999,
    response: 99,
    consonantDetail: 99,
    transpose: 99,
    glideShape: -99,
    spectralTilt: 99,
    carrierColor: 99,
    stereoWidth: -99,
    gateDb: -999,
    highFrequency: 999_999,
    inputGain: Number.NaN,
    dryWet: -1,
    outputLevel: 9,
    hold: 1,
  });

  assert.deepEqual(sanitized, {
    direction: -1,
    slipRate: 4,
    bankWidth: 8,
    coherence: 0,
    bandCount: 32,
    response: 1,
    consonantDetail: 1,
    transpose: 2,
    glideShape: -0.9,
    spectralTilt: 9,
    carrierColor: 1,
    stereoWidth: 0,
    gateDb: -100,
    highFrequency: 20_000,
    inputGain: SLIPPERYNTHESIS_DEFAULTS.inputGain,
    dryWet: 0,
    outputLevel: 0.82,
    hold: true,
  });
  assert.ok(Object.isFrozen(sanitized));
  assert.deepEqual(
    sanitizeSlipperyResynthesisParams({
      direction: Number.NaN,
      slipRate: Infinity,
      bankWidth: Number.NaN,
      coherence: Number.NaN,
      bandCount: Number.NaN,
      response: Number.NaN,
      consonantDetail: Number.NaN,
      transpose: Number.NaN,
      glideShape: Number.NaN,
      spectralTilt: Number.NaN,
      carrierColor: Number.NaN,
      stereoWidth: Number.NaN,
      gateDb: Number.NaN,
      highFrequency: Number.NaN,
      inputGain: Number.NaN,
      dryWet: Number.NaN,
      outputLevel: Number.NaN,
    }),
    SLIPPERYNTHESIS_DEFAULTS,
  );

  for (
    let bankWidth = SLIPPERYNTHESIS_LIMITS.minBankWidth;
    bankWidth <= SLIPPERYNTHESIS_LIMITS.maxBankWidth;
    bankWidth += 1
  ) {
    const parameters = sanitizeSlipperyResynthesisParams({
      bankWidth,
      bandCount: 999,
    });
    assert.ok(parameters.bandCount >= SLIPPERYNTHESIS_LIMITS.minBands);
    assert.ok(parameters.bandCount <= SLIPPERYNTHESIS_LIMITS.maxBands);
    assert.ok(
      parameters.bandCount * parameters.bankWidth
        <= SLIPPERYNTHESIS_LIMITS.maxOscillators,
      `${parameters.bandCount} bands x ${parameters.bankWidth} layers exceeds the budget`,
    );
  }
});

test("the expanded preset library is unique, complete, and oscillator-safe", () => {
  assert.ok(
    SLIPPERY_RESYNTHESIS_PRESETS.length >= 14,
    "the instrument should expose a broad preset palette",
  );
  assert.equal(
    new Set(SLIPPERY_RESYNTHESIS_PRESETS.map(({ id }) => id)).size,
    SLIPPERY_RESYNTHESIS_PRESETS.length,
    "preset IDs must be unique",
  );
  assert.equal(
    new Set(SLIPPERY_RESYNTHESIS_PRESETS.map(({ label }) => label)).size,
    SLIPPERY_RESYNTHESIS_PRESETS.length,
    "preset labels must be unique",
  );

  for (const preset of SLIPPERY_RESYNTHESIS_PRESETS) {
    assert.match(preset.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(preset.label.length > 0);
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.settings));
    const settings = sanitizeSlipperyResynthesisParams({
      ...SLIPPERYNTHESIS_DEFAULTS,
      ...preset.settings,
    });
    assert.ok(
      settings.bandCount * settings.bankWidth
        <= SLIPPERYNTHESIS_LIMITS.maxOscillators,
      `${preset.id} exceeds the oscillator budget`,
    );
  }
});

test("dense presets start protected and adapt between safe quality tiers", () => {
  assert.equal(adaptiveShepardTierForVoiceCount(55, 4), 0);
  assert.equal(adaptiveShepardTierForVoiceCount(56, 4), 1);
  assert.ok(Object.isFrozen(SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD));
  assert.ok(Object.isFrozen(SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD.weightFloors));

  for (const id of ["glacier-memory", "radio-swarm"]) {
    const preset = SLIPPERY_RESYNTHESIS_PRESETS.find((candidate) => candidate.id === id);
    const parameters = sanitizeSlipperyResynthesisParams({
      ...SLIPPERYNTHESIS_DEFAULTS,
      ...preset.settings,
    });
    const processor = new ProcessorConstructor({
      processorOptions: { parameters },
    });
    processor.performanceNow = null;
    processor.performanceClockMode = "high-resolution";
    assert.equal(processor.adaptiveMinimumTier, 1, `${id} needs startup protection`);
    assert.equal(processor.adaptiveTier, 1);
    assert.equal(
      processor.adaptiveWeightFloor,
      SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD.weightFloors[1],
    );

    const quantumMs = BLOCK_SIZE / SAMPLE_RATE * 1_000;
    for (let block = 0; block < 12; block += 1) {
      processor.recordRenderPerformance(quantumMs * 1.2, quantumMs, true);
    }
    assert.ok(processor.adaptiveTier > processor.adaptiveMinimumTier);
    assert.equal(
      processor.adaptiveWeightFloorTarget,
      SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD.weightFloors[processor.adaptiveTier],
    );

    for (
      let block = 0;
      block < 5_000 && processor.adaptiveTier > processor.adaptiveMinimumTier;
      block += 1
    ) {
      processor.recordRenderPerformance(quantumMs * 0.2, quantumMs, true);
    }
    assert.equal(
      processor.adaptiveTier,
      processor.adaptiveMinimumTier,
      `${id} must recover gradually to its protected baseline`,
    );
    for (let block = 0; block < 1_000; block += 1) {
      processor.recordRenderPerformance(quantumMs * 0.1, quantumMs, true);
    }
    assert.equal(
      processor.adaptiveTier,
      1,
      `${id} must never recover below its dense-bank safety tier`,
    );
    processor.reset();
    assert.equal(processor.adaptiveTier, 1);
    assert.equal(
      processor.adaptiveWeightFloor,
      SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD.weightFloors[1],
    );
  }

  const radioPreset = SLIPPERY_RESYNTHESIS_PRESETS.find(
    ({ id }) => id === "radio-swarm",
  );
  const radio = new ProcessorConstructor({
    processorOptions: {
      parameters: {
        ...SLIPPERYNTHESIS_DEFAULTS,
        ...radioPreset.settings,
      },
    },
  });
  radio.performanceNow = null;
  radio.setAdaptiveTier(
    SLIPPERY_RESYNTHESIS_PERFORMANCE_GUARD.weightFloors.length - 1,
    { snap: true, report: false },
  );
  radio.port.onmessage({ data: { type: "active", value: true } });
  let noiseState = 0x4f1bbcdc;
  const protectedRender = renderProcessor(radio, SAMPLE_RATE / 2, (frame) => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    const noise = ((noiseState >>> 0) / 0x1_0000_0000 * 2 - 1) * 0.06;
    return noise + Math.sin(2 * Math.PI * 311 * frame / SAMPLE_RATE) * 0.12;
  });
  assertFiniteAudio([protectedRender.left, protectedRender.right]);
  assert.ok(rms(protectedRender.left, SLIPPERYNTHESIS_FFT_SIZE * 2) > 0.001);

  const coarseClock = new ProcessorConstructor({
    processorOptions: {
      parameters: {
        ...SLIPPERYNTHESIS_DEFAULTS,
        ...radioPreset.settings,
      },
    },
  });
  coarseClock.performanceNow = null;
  coarseClock.performanceClockMode = "coarse";
  const quantumMs = BLOCK_SIZE / SAMPLE_RATE * 1_000;
  for (let block = 0; block < 128; block += 1) {
    coarseClock.recordRenderPerformance(quantumMs * 0.75, quantumMs, true);
  }
  assert.ok(
    coarseClock.adaptiveTier > coarseClock.adaptiveMinimumTier,
    "two overloaded coarse-clock windows must shed another quality tier",
  );
  const tierBeforeUnusableClock = coarseClock.adaptiveTier;
  for (let block = 0; block < 256; block += 1) {
    coarseClock.recordRenderPerformance(0, quantumMs, true);
  }
  assert.equal(coarseClock.performanceClockMode, "unavailable");
  assert.equal(
    coarseClock.adaptiveTier,
    tierBeforeUnusableClock,
    "an unusably coarse clock must retain its conservative tier",
  );
});

test("log centers are geometric and FFT-bin triangles form a unit partition", () => {
  const bandCount = 32;
  const lowFrequency = 55;
  const highFrequency = 10_000;
  const centers = logBandCenters(bandCount, lowFrequency, highFrequency);
  assert.equal(centers.length, bandCount);
  assert.ok(Math.abs(centers[0] - lowFrequency) < 1e-12);
  assert.ok(Math.abs(centers.at(-1) - highFrequency) < 1e-9);

  const ratio = centers[1] / centers[0];
  for (let band = 1; band < centers.length; band += 1) {
    assert.ok(centers[band] > centers[band - 1]);
    assert.ok(
      Math.abs(centers[band] / centers[band - 1] - ratio) < 1e-12,
      "adjacent analysis centers must have one constant log-frequency ratio",
    );
  }

  const plan = createLogBandPlan({
    bandCount,
    lowFrequency,
    highFrequency,
    sampleRate: SAMPLE_RATE,
    fftSize: SLIPPERYNTHESIS_FFT_SIZE,
  });
  assert.deepEqual(plan.centers, centers);
  const binCount = SLIPPERYNTHESIS_FFT_SIZE / 2 + 1;
  assert.equal(plan.binOffsets.length, binCount + 1);
  assert.equal(plan.bandIndices.length, plan.bandWeights.length);
  assert.equal(plan.binOffsets[0], 0);
  assert.equal(plan.binOffsets.at(-1), plan.bandIndices.length);

  const bandContributions = new Float64Array(bandCount);
  let coveredBins = 0;
  const binHz = SAMPLE_RATE / SLIPPERYNTHESIS_FFT_SIZE;
  for (let bin = 1; bin < binCount - 1; bin += 1) {
    const contributionStart = plan.binOffsets[bin];
    const contributionEnd = plan.binOffsets[bin + 1];
    assert.ok(contributionStart <= contributionEnd);
    assert.ok(contributionStart >= 0 && contributionEnd <= plan.bandIndices.length);

    let weightSum = 0;
    for (
      let contribution = contributionStart;
      contribution < contributionEnd;
      contribution += 1
    ) {
      const band = plan.bandIndices[contribution];
      const weight = plan.bandWeights[contribution];
      assert.ok(band >= 0 && band < bandCount);
      assert.ok(Number.isFinite(weight) && weight > 0 && weight <= 1);
      weightSum += weight;
      bandContributions[band] += weight;
    }

    const cellStart = Math.max(lowFrequency, (bin - 0.5) * binHz);
    const cellEnd = Math.min(highFrequency, (bin + 0.5) * binHz);
    const expectedCellFraction = Math.max(0, cellEnd - cellStart) / binHz;
    assert.ok(
      Math.abs(weightSum - expectedCellFraction) < 2e-7,
      `bin ${bin} weights must integrate to its in-range cell fraction`,
    );
    if (expectedCellFraction > 0) coveredBins += 1;
  }
  assert.ok(coveredBins > 100);
  assert.ok(
    bandContributions.every((weight) => weight > 0),
    "every requested log band must receive at least one FFT-bin contribution",
  );

  // Independently integrate representative cells to verify that the sparse
  // entries describe triangular interpolation in log-frequency, including the
  // narrow low bands that are finer than one FFT bin.
  for (const bin of [2, 3, 4, 17, 113, 427]) {
    const expected = new Float64Array(bandCount);
    const actual = new Float64Array(bandCount);
    const cellStart = Math.max(lowFrequency, (bin - 0.5) * binHz);
    const cellEnd = Math.min(highFrequency, (bin + 0.5) * binHz);
    const slices = 4_096;
    const sliceWidth = (cellEnd - cellStart) / slices;
    const logSpan = Math.log2(highFrequency / lowFrequency);
    for (let slice = 0; slice < slices && sliceWidth > 0; slice += 1) {
      const frequency = cellStart + (slice + 0.5) * sliceWidth;
      const position = (
        Math.log2(frequency / lowFrequency) / logSpan * (bandCount - 1)
      );
      const left = Math.max(0, Math.min(bandCount - 2, Math.floor(position)));
      const right = left + 1;
      const rightWeight = position - left;
      const scale = sliceWidth / binHz;
      expected[left] += (1 - rightWeight) * scale;
      expected[right] += rightWeight * scale;
    }
    for (
      let contribution = plan.binOffsets[bin];
      contribution < plan.binOffsets[bin + 1];
      contribution += 1
    ) {
      actual[plan.bandIndices[contribution]] += plan.bandWeights[contribution];
    }
    for (let band = 0; band < bandCount; band += 1) {
      assert.ok(
        Math.abs(actual[band] - expected[band]) < 2e-6,
        `bin ${bin}, band ${band} must follow its integrated log triangle`,
      );
    }
  }
});

test("the periodic Hann FFT recovers a bin-centered sine's calibrated amplitude and power", () => {
  const size = SLIPPERYNTHESIS_FFT_SIZE;
  const sineBin = 73;
  const amplitude = 0.625;
  const window = createPeriodicHannWindow(size);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  let windowSum = 0;
  let windowEnergy = 0;
  for (let index = 0; index < size; index += 1) {
    windowSum += window[index];
    windowEnergy += window[index] * window[index];
    real[index] = (
      amplitude
      * Math.sin(2 * Math.PI * sineBin * index / size)
      * window[index]
    );
  }

  assert.ok(Math.abs(windowSum - size / 2) < 1e-10);
  assert.ok(Math.abs(windowEnergy - size * 3 / 8) < 1e-10);
  fftInPlace(real, imaginary);

  const peakMagnitude = Math.hypot(real[sineBin], imaginary[sineBin]);
  const calibratedAmplitude = 2 * peakMagnitude / windowSum;
  assert.ok(Math.abs(calibratedAmplitude - amplitude) < 1e-11);
  assert.ok(
    Math.abs(Math.hypot(real[sineBin - 1], imaginary[sineBin - 1]) * 2 - peakMagnitude)
      < 1e-9,
    "a periodic Hann sine must have the expected half-height neighboring lobe",
  );
  assert.ok(
    Math.hypot(real[sineBin + 4], imaginary[sineBin + 4]) < peakMagnitude * 1e-11,
    "a bin-centered periodic Hann sine must not leak beyond its three-bin lobe",
  );

  const powerScale = 2 / (size * windowEnergy);
  let positiveFrequencyPower = 0;
  for (let bin = 1; bin < size / 2; bin += 1) {
    positiveFrequencyPower += (
      real[bin] * real[bin] + imaginary[bin] * imaginary[bin]
    ) * powerScale;
  }
  assert.ok(
    Math.abs(positiveFrequencyPower - amplitude * amplitude / 2) < 1e-12,
    "the worklet's one-sided FFT scaling must preserve sine RMS power",
  );
  assert.throws(
    () => fftInPlace(new Float64Array(12), new Float64Array(12)),
    RangeError,
  );
});

test("transpose, glide contour, and spectral tilt extend the bank without breaking its bounds", () => {
  assert.equal(slipperyGlidePhase(0, 0.9), 0);
  assert.equal(slipperyGlidePhase(0.5, 0.9), 0.5);
  assert.ok(Math.abs(slipperyGlidePhase(1 - 1e-9, 0.9) - 1) < 2e-9);
  let previous = slipperyGlidePhase(0, -0.9);
  for (let step = 1; step < 1_000; step += 1) {
    const next = slipperyGlidePhase(step / 1_000, -0.9);
    assert.ok(next > previous, "every legal glide contour must remain monotonic");
    previous = next;
  }

  const plain = calculateSlipperPartials({
    centerFrequency: 440,
    bankPhase: 0.37,
    bankWidth: 4,
  });
  const shifted = calculateSlipperPartials({
    centerFrequency: 440,
    bankPhase: 0.37,
    bankWidth: 4,
    transpose: 2,
    glideShape: 0.7,
  });
  assert.ok(
    shifted.partials.some(({ frequency }, index) => (
      Math.abs(frequency / plain.partials[index].frequency - 4) > 0.05
    )),
    "a nonlinear contour must audibly differ from a plain transposition",
  );
  assert.ok(Math.abs(spectralTiltGain(2_000, 6) - 10 ** (6 / 20)) < 1e-12);
  assert.ok(Math.abs(spectralTiltGain(500, 6) - 10 ** (-6 / 20)) < 1e-12);
  assert.equal(spectralTiltGain(20, -9), 8);
  assert.equal(spectralTiltGain(20_000, 9), 8);
});

test("canonical slippery banks are octave-spaced, wrap silently, and taper before aliasing", () => {
  for (const direction of [-1, 1]) {
    const frame = calculateSlipperPartials({
      centerFrequency: 880,
      bankPhase: 0.37,
      bankWidth: 4,
      direction,
      highFrequency: 18_000,
      sampleRate: SAMPLE_RATE,
    });
    const active = frame.partials
      .filter(({ active: isActive }) => isActive)
      .sort((first, second) => first.frequency - second.frequency);
    assert.equal(active.length, 4);
    for (let partial = 1; partial < active.length; partial += 1) {
      assert.ok(
        Math.abs(active[partial].frequency / active[partial - 1].frequency - 2)
          < 1e-12,
        "adjacent canonical layers must stay exactly one octave apart",
      );
    }
    assert.ok(frame.normalization <= 2);
    assert.ok(
      Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12,
      "an unbounded bank must be power normalized",
    );
  }

  const epsilon = 1e-7;
  const beforeWrap = calculateSlipperPartials({
    centerFrequency: 440,
    bankPhase: -epsilon,
    bankWidth: 4,
    highFrequency: 18_000,
  }).partials[0];
  const atWrap = calculateSlipperPartials({
    centerFrequency: 440,
    bankPhase: 0,
    bankWidth: 4,
    highFrequency: 18_000,
  }).partials[0];
  const afterWrap = calculateSlipperPartials({
    centerFrequency: 440,
    bankPhase: epsilon,
    bankWidth: 4,
    highFrequency: 18_000,
  }).partials[0];
  assert.equal(atWrap.envelope, 0);
  assert.equal(atWrap.weight, 0);
  assert.equal(atWrap.active, false);
  assert.ok(beforeWrap.envelope < 1e-12);
  assert.ok(afterWrap.envelope < 1e-12);
  assert.ok(beforeWrap.frequency / afterWrap.frequency > 15.99);
  assert.ok(Math.abs(beforeWrap.envelope - afterWrap.envelope) < 1e-15);
  assert.equal(slipperyHann(0), 0);
  assert.equal(slipperyHann(1), 0);

  assert.equal(slipperAntiAliasWeight(20, 10_000, SAMPLE_RATE), 0);
  assert.ok(Math.abs(slipperAntiAliasWeight(27.5, 10_000, SAMPLE_RATE) - 0.5) < 1e-12);
  assert.equal(slipperAntiAliasWeight(35, 10_000, SAMPLE_RATE), 1);
  assert.equal(slipperAntiAliasWeight(8_800, 10_000, SAMPLE_RATE), 1);
  assert.ok(Math.abs(slipperAntiAliasWeight(9_400, 10_000, SAMPLE_RATE) - 0.5) < 1e-12);
  assert.equal(slipperAntiAliasWeight(10_000, 10_000, SAMPLE_RATE), 0);
  assert.equal(slipperAntiAliasWeight(30_000, 18_000, SAMPLE_RATE), 0);
  assert.ok(Number.isFinite(slipperAntiAliasWeight(9_000, 10_000, Number.NaN)));
  assert.equal(
    slipperAntiAliasWeight(9_000, 10_000, Number.NaN),
    slipperAntiAliasWeight(9_000, 10_000, SAMPLE_RATE),
  );
});

test("the worklet registers and renders finite, nonzero FFT-to-Shepard audio with a true hold", () => {
  assert.equal(registeredName, SLIPPERYNTHESIS_PROCESSOR_NAME);
  assert.equal(typeof ProcessorConstructor, "function");
  assert.equal(SLIPPERYNTHESIS_FFT_SIZE, 2_048);
  assert.equal(SLIPPERYNTHESIS_HOP_SIZE, 256);
  assert.equal(SLIPPERYNTHESIS_FFT_SIZE % SLIPPERYNTHESIS_HOP_SIZE, 0);

  const processor = new ProcessorConstructor({
    processorOptions: {
      parameters: {
        bandCount: 24,
        bankWidth: 4,
        slipRate: 0.18,
        coherence: 1,
        response: 0.01,
        gateDb: -90,
        highFrequency: 8_000,
        inputGain: 1,
        dryWet: 1,
      },
    },
  });
  assert.equal(typeof processor.port.onmessage, "function");
  processor.port.onmessage({
    data: { type: "parameters", parameters: { bandCount: 32 } },
  });
  assert.equal(processor.pendingStructure.bandCount, 32);
  processor.port.onmessage({
    data: { type: "parameters", parameters: { bandCount: 24 } },
  });
  assert.equal(
    processor.pendingStructure,
    null,
    "returning to the live structure before its fade completes must cancel the stale rebuild",
  );
  processor.port.onmessage({ data: { type: "active", value: true } });

  const source = (frame) => {
    const seconds = frame / SAMPLE_RATE;
    return (
      Math.sin(2 * Math.PI * 440 * seconds) * 0.34
      + Math.sin(2 * Math.PI * 1_109.375 * seconds + 0.3) * 0.19
    );
  };
  const tracked = renderProcessor(processor, SAMPLE_RATE / 2, source);
  assertFiniteAudio([tracked.left, tracked.right]);
  const trackedRms = rms(tracked.left, SLIPPERYNTHESIS_FFT_SIZE * 2);
  assert.ok(trackedRms > 0.01, `FFT resynthesis must be audible (RMS ${trackedRms})`);
  assert.ok(processor.bandTargets.some((value) => value > 0.02));
  assert.ok(processor.bandEnvelopes.some((value) => value > 0.01));
  assert.ok(
    tracked.left.some((sample, index) => Math.abs(sample - tracked.right[index]) > 1e-5),
    "octave layers should retain the worklet's subtle stereo spread",
  );

  const heldTargets = processor.bandTargets.slice();
  const phaseBeforeHold = processor.bankPhase;
  processor.port.onmessage({
    data: { type: "parameters", parameters: { hold: true } },
  });
  const held = renderProcessor(processor, SAMPLE_RATE / 4);
  assertFiniteAudio([held.left, held.right]);
  assert.deepEqual(processor.bandTargets, heldTargets);
  assert.notEqual(processor.bankPhase, phaseBeforeHold);
  const heldRms = rms(held.left, held.left.length / 2);
  assert.ok(heldRms > 0.005, `held resynthesis must keep sounding (RMS ${heldRms})`);

  processor.port.onmessage({
    data: { type: "parameters", parameters: { hold: false } },
  });
  const released = renderProcessor(processor, SAMPLE_RATE / 2);
  assertFiniteAudio([released.left, released.right]);
  const releaseTailRms = rms(released.left, released.left.length - 4_096);
  assert.ok(processor.bandTargets.every((value) => value === 0));
  assert.ok(
    releaseTailRms < heldRms * 0.05,
    `live tracking must release after silence (${releaseTailRms} vs held ${heldRms})`,
  );

  processor.port.onmessage({ data: { type: "reset" } });
  assert.equal(processor.analysisFill, 0);
  assert.equal(processor.hopCounter, 0);
  assert.equal(processor.bankPhase, 0.117);
  assert.ok(processor.bandTargets.every((value) => value === 0));
  assert.ok(processor.bandEnvelopes.every((value) => value === 0));
});

test("full-wet structural preset changes preserve spectral state above silence", () => {
  const processor = new ProcessorConstructor({
    processorOptions: {
      parameters: {
        bandCount: 24,
        bankWidth: 4,
        direction: 1,
        response: 0.01,
        consonantDetail: 0.4,
        gateDb: -90,
        highFrequency: 8_000,
        dryWet: 1,
      },
    },
  });
  processor.performanceNow = null;
  processor.port.onmessage({ data: { type: "active", value: true } });

  let frameOffset = 0;
  let noiseState = 0x76b34a21;
  const processBlock = () => {
    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      noiseState ^= noiseState << 13;
      noiseState ^= noiseState >>> 17;
      noiseState ^= noiseState << 5;
      const noise = ((noiseState >>> 0) / 0x1_0000_0000 * 2 - 1) * 0.025;
      const seconds = frameOffset / SAMPLE_RATE;
      input[frame] = (
        noise
        + Math.sin(2 * Math.PI * 173 * seconds) * 0.16
        + Math.sin(2 * Math.PI * 997 * seconds) * 0.1
      );
      frameOffset += 1;
    }
    processor.process([[input]], [[left, right]]);
    assertFiniteAudio([left, right]);
    return rms(left);
  };

  const baselineBlocks = [];
  for (let block = 0; block < 200; block += 1) {
    const blockRms = processBlock();
    if (block >= 168) baselineBlocks.push(blockRms);
  }
  const baselineRms = baselineBlocks.reduce((sum, value) => sum + value, 0)
    / baselineBlocks.length;
  assert.ok(baselineRms > 0.01);

  const radioPreset = SLIPPERY_RESYNTHESIS_PRESETS.find(
    ({ id }) => id === "radio-swarm",
  );
  const radioParameters = sanitizeSlipperyResynthesisParams({
    ...SLIPPERYNTHESIS_DEFAULTS,
    ...radioPreset.settings,
    hold: true,
  });
  processor.port.onmessage({
    data: { type: "parameters", parameters: radioParameters },
  });
  assert.ok(processor.pendingStructure);
  assert.equal(processor.target.hold, true);

  let rebuildObserved = false;
  let minimumStructureGain = 1;
  let minimumBlockRms = Infinity;
  for (let block = 0; block < 64; block += 1) {
    const blockRms = processBlock();
    minimumBlockRms = Math.min(minimumBlockRms, blockRms);
    minimumStructureGain = Math.min(minimumStructureGain, processor.structureGain);
    if (processor.bandCount === radioParameters.bandCount) rebuildObserved = true;
  }

  assert.equal(rebuildObserved, true);
  assert.equal(processor.pendingStructure, null);
  assert.equal(processor.bandCount, 60);
  assert.equal(processor.bankWidth, 4);
  assert.equal(processor.adaptiveMinimumTier, 1);
  assert.ok(
    minimumStructureGain > 0.09,
    `the protected structure fade fell to ${minimumStructureGain}`,
  );
  assert.ok(
    minimumBlockRms > baselineRms * 0.01,
    `the protected switch collapsed (${minimumBlockRms} vs ${baselineRms})`,
  );
  assert.ok(
    [...processor.bandEnvelopes]
      .slice(0, processor.bandCount)
      .some((value) => value > 1e-5),
    "the new log plan must inherit or reacquire live spectral envelopes",
  );
});

test("noise-like upper bands engage a fully wet slipping consonant carrier", () => {
  const parameters = {
    bandCount: 48,
    bankWidth: 3,
    response: 0.012,
    consonantDetail: 1,
    gateDb: -90,
    highFrequency: 15_000,
    carrierColor: 0,
    dryWet: 1,
  };
  const detailed = new ProcessorConstructor({
    processorOptions: { parameters },
  });
  detailed.port.onmessage({ data: { type: "active", value: true } });

  let noiseState = 0x1234abcd;
  const noise = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return ((noiseState >>> 0) / 0x1_0000_0000 * 2 - 1) * 0.18;
  };
  const noisyRender = renderProcessor(detailed, SAMPLE_RATE / 2, noise);
  assertFiniteAudio([noisyRender.left, noisyRender.right]);
  const highBandNoisiness = [...detailed.bandNoisinessTargets]
    .slice(0, detailed.bandCount)
    .filter((_, band) => detailed.bandPlan.centers[band] >= 2_500);
  const meanNoisiness = highBandNoisiness.reduce((sum, value) => sum + value, 0)
    / highBandNoisiness.length;
  assert.ok(meanNoisiness > 0.55, `upper-band noisiness was ${meanNoisiness}`);
  assert.ok(
    detailed.oscillatorNoise.some((value) => Math.abs(value) > 1e-5),
    "the stochastic carriers must evolve while their Shepard frequencies slip",
  );
  assert.ok(rms(noisyRender.left, SLIPPERYNTHESIS_FFT_SIZE * 2) > 0.002);

  const tonalOnly = new ProcessorConstructor({
    processorOptions: {
      parameters: { ...parameters, consonantDetail: 0 },
    },
  });
  tonalOnly.port.onmessage({ data: { type: "active", value: true } });
  noiseState = 0x1234abcd;
  const tonalRender = renderProcessor(tonalOnly, SAMPLE_RATE / 2, noise);
  assertFiniteAudio([tonalRender.left, tonalRender.right]);
  assert.ok(
    tonalOnly.oscillatorNoise.every((value) => value === 0),
    "zero consonant detail must keep the original continuous sine carriers",
  );

  const highTone = new ProcessorConstructor({
    processorOptions: { parameters },
  });
  highTone.port.onmessage({ data: { type: "active", value: true } });
  renderProcessor(highTone, SAMPLE_RATE / 2, (frame) => (
    Math.sin(2 * Math.PI * 5_000 * frame / SAMPLE_RATE) * 0.18
  ));
  const toneNoisiness = [...highTone.bandNoisinessTargets]
    .slice(0, highTone.bandCount)
    .reduce((maximum, value) => Math.max(maximum, value), 0);
  assert.ok(
    toneNoisiness < 0.15,
    `a stable upper-register sine must remain tonal (${toneNoisiness})`,
  );
});

test("the maximum legal worklet bank remains comfortably bounded for real-time use", {
  timeout: 10_000,
}, () => {
  const parameters = sanitizeSlipperyResynthesisParams({
    bandCount: SLIPPERYNTHESIS_LIMITS.maxBands,
    bankWidth: SLIPPERYNTHESIS_LIMITS.maxBankWidth,
    response: 0.005,
    consonantDetail: 1,
    carrierColor: 1,
    stereoWidth: 1,
    gateDb: -90,
    highFrequency: 18_000,
    dryWet: 1,
  });
  assert.ok(
    parameters.bandCount * parameters.bankWidth
      <= SLIPPERYNTHESIS_LIMITS.maxOscillators,
  );
  const processor = new ProcessorConstructor({
    processorOptions: { parameters },
  });
  processor.port.onmessage({ data: { type: "active", value: true } });

  const frameCount = SAMPLE_RATE / 2;
  const startedAt = performance.now();
  const rendered = renderProcessor(processor, frameCount, (frame) => (
    Math.sin(2 * Math.PI * 173 * frame / SAMPLE_RATE) * 0.2
    + Math.sin(2 * Math.PI * 997 * frame / SAMPLE_RATE) * 0.12
  ));
  const elapsedMs = performance.now() - startedAt;
  assertFiniteAudio([rendered.left, rendered.right]);
  assert.ok(rms(rendered.left, SLIPPERYNTHESIS_FFT_SIZE * 2) > 0.001);
  assert.ok(
    elapsedMs < 5_000,
    `half a second at the maximum bank took ${elapsedMs.toFixed(1)} ms`,
  );
});

class MockParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) {
    this.events.push(["cancel", time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["set", value, time]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["linear", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(["target", value, time, constant]);
  }
}

class MockNode {
  constructor(kind = "node") {
    this.kind = kind;
    this.connections = [];
    this.disconnectCount = 0;
  }

  connect(destination, ...ports) {
    this.connections.push({ destination, ports });
    return destination;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

class MockAnalyser extends MockNode {
  constructor() {
    super("analyser");
    this.fftSize = 2_048;
    this.minDecibels = -100;
    this.maxDecibels = -10;
    this.smoothingTimeConstant = 0;
  }

  get frequencyBinCount() {
    return this.fftSize / 2;
  }

  getFloatFrequencyData(target) {
    target.fill(-72);
  }

  getFloatTimeDomainData(target) {
    target.fill(0);
  }
}

class MockAudioWorkletNode extends MockNode {
  constructor(context, name, options) {
    super("worklet");
    this.context = context;
    this.name = name;
    this.options = options;
    this.port = {
      messages: [],
      postMessage: (message) => this.port.messages.push(message),
    };
  }
}

function createAudioRuntime() {
  const records = {
    contexts: [],
    getUserMedia: [],
    tracksStopped: 0,
    mediaStreamSources: [],
    mediaElementSources: [],
    timers: new Map(),
    clearedTimers: [],
  };
  let timerId = 0;
  const track = {
    stop() {
      records.tracksStopped += 1;
    },
  };
  const stream = {
    getTracks() {
      return [track];
    },
  };

  class MockAudioContext {
    constructor(options) {
      this.options = options;
      this.sampleRate = SAMPLE_RATE;
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = new MockNode("destination");
      this.resumeCount = 0;
      this.suspendCount = 0;
      this.closeCount = 0;
      this.modules = [];
      this.audioWorklet = {
        addModule: async (url) => {
          this.modules.push(String(url));
        },
      };
      records.contexts.push(this);
    }

    createAnalyser() {
      return new MockAnalyser();
    }

    createBiquadFilter() {
      const node = new MockNode("biquad");
      node.type = "lowpass";
      node.frequency = new MockParam();
      node.Q = new MockParam();
      return node;
    }

    createWaveShaper() {
      const node = new MockNode("waveshaper");
      node.curve = null;
      node.oversample = "none";
      return node;
    }

    createGain() {
      const node = new MockNode("gain");
      node.gain = new MockParam(1);
      return node;
    }

    createMediaStreamSource(sourceStream) {
      const node = new MockNode("media-stream");
      node.stream = sourceStream;
      records.mediaStreamSources.push(node);
      return node;
    }

    createMediaElementSource(element) {
      const node = new MockNode("media-element");
      node.element = element;
      records.mediaElementSources.push(node);
      return node;
    }

    async resume() {
      this.resumeCount += 1;
      this.state = "running";
    }

    async suspend() {
      this.suspendCount += 1;
      this.state = "suspended";
    }

    async close() {
      this.closeCount += 1;
      this.state = "closed";
    }
  }

  const runtime = {
    AudioContext: MockAudioContext,
    AudioWorkletNode: MockAudioWorkletNode,
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          records.getUserMedia.push(constraints);
          return stream;
        },
      },
    },
    setTimeout(callback, delay) {
      timerId += 1;
      records.timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) {
      records.clearedTimers.push(id);
      records.timers.delete(id);
    },
  };

  return { records, runtime, stream };
}

test("microphone and local-file sources are lazy, reusable, and fully released", async () => {
  const { records, runtime } = createAudioRuntime();
  const audio = new SlipperyResynthesisAudio(runtime);
  assert.deepEqual(audio.state, {
    initialized: false,
    enabled: false,
    sourceKind: null,
    contextState: "closed",
  });
  assert.equal(records.contexts.length, 0, "construction must not create AudioContext");
  assert.equal(records.getUserMedia.length, 0, "construction must not request a microphone");
  audio.setParameters({ outputLevel: 0.4 });
  await audio.stop();
  assert.equal(records.contexts.length, 0, "parameter and stop calls must stay lazy");

  await audio.start({ kind: "microphone" });
  assert.equal(records.contexts.length, 1);
  assert.equal(records.getUserMedia.length, 1);
  assert.deepEqual(records.getUserMedia[0], {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
  });
  assert.equal(records.mediaStreamSources.length, 1);
  assert.equal(audio.state.enabled, true);
  assert.equal(audio.state.sourceKind, "microphone");
  assert.equal(audio.node.name, SLIPPERYNTHESIS_PROCESSOR_NAME);
  assert.deepEqual(audio.node.options.outputChannelCount, [2]);
  assert.ok(
    records.contexts[0].modules[0].endsWith("/src/slippery-resynthesis.js"),
    "the browser graph must load its self-registering worklet module",
  );
  assert.ok(audio.node.port.messages.some(({ type }) => type === "reset"));
  assert.ok(
    audio.node.port.messages.some(({ type, value }) => type === "active" && value),
  );

  await audio.stop();
  assert.equal(records.tracksStopped, 1);
  assert.equal(records.mediaStreamSources[0].disconnectCount, 1);
  assert.equal(audio.state.enabled, false);
  assert.equal(audio.state.sourceKind, null);
  assert.equal(records.timers.size, 1);
  const [[timerKey, timer]] = records.timers;
  assert.equal(timer.delay, 55);
  records.timers.delete(timerKey);
  timer.callback();
  await Promise.resolve();
  assert.equal(records.contexts[0].state, "suspended");

  const fileElement = {
    playCount: 0,
    pauseCount: 0,
    async play() {
      this.playCount += 1;
    },
    pause() {
      this.pauseCount += 1;
    },
  };
  await audio.start({ kind: "file", element: fileElement });
  assert.equal(records.contexts.length, 1, "source changes must reuse AudioContext");
  assert.equal(records.getUserMedia.length, 1, "file playback must not touch microphone permission");
  assert.equal(records.mediaElementSources.length, 1);
  assert.equal(fileElement.playCount, 1);
  assert.equal(audio.state.sourceKind, "file");

  await audio.stop();
  assert.equal(fileElement.pauseCount, 1);
  await audio.start({ kind: "file", element: fileElement });
  assert.equal(
    records.mediaElementSources.length,
    1,
    "one HTMLMediaElement must only receive one MediaElementSourceNode",
  );
  assert.equal(fileElement.playCount, 2);

  await audio.close();
  assert.equal(fileElement.pauseCount, 2);
  assert.equal(records.contexts[0].state, "closed");
  assert.equal(records.contexts[0].closeCount, 1);
  assert.equal(audio.state.initialized, false);
  assert.equal(audio.state.enabled, false);
  assert.equal(audio.state.sourceKind, null);
});

test("the page and app expose accessible controls and explicit lifecycle cleanup", async () => {
  const [html, appSource, runtimeSource] = await Promise.all([
    readFile(new URL("../slippery-resynthesis.html", import.meta.url), "utf8"),
    readFile(new URL("../slippery-resynthesis-app.js", import.meta.url), "utf8"),
    readFile(MODULE_URL, "utf8"),
  ]);

  assert.match(html, /<html\s+lang="en">/);
  assert.match(html, /<title>Slippery Resynthesis — Morphazoid<\/title>/);
  assert.match(html, /<main\b[^>]*id="slippery-resynthesis"/);
  assert.match(
    html,
    /<canvas\b(?=[^>]*id="stage")(?=[^>]*tabindex="0")(?=[^>]*role="img")(?=[^>]*aria-label=)(?=[^>]*aria-describedby="slipperyResynthesisDescription liveStatus")[^>]*>/s,
  );
  assert.match(
    html,
    /<button\b(?=[^>]*id="audioButton")(?=[^>]*type="button")(?=[^>]*aria-pressed="false")[^>]*>/s,
  );
  for (const label of ["Audio source", "Slip direction", "Spectral tracking"]) {
    assert.match(html, new RegExp(`role="group"[^>]*aria-label="${label}"`));
  }
  assert.match(html, /<input\b(?=[^>]*id="filePicker")(?=[^>]*type="file")(?=[^>]*accept="audio\/\*")[^>]*>/s);
  assert.match(html, /id="audioError"\s+role="alert"/);
  assert.match(html, /id="liveStatus"\s+aria-live="polite"/);
  assert.match(html, /id="slipperyResynthesisDescription"/);
  assert.match(html, /<script\s+type="module"\s+src="slippery-resynthesis-app\.js"><\/script>/);
  for (const id of [
    "consonantDetail",
    "transpose",
    "glideShape",
    "spectralTilt",
    "carrierColor",
    "stereoWidth",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const rangeInputs = [...html.matchAll(/<input\b[^>]*\btype="range"[^>]*>/gs)];
  assert.ok(rangeInputs.length >= 16);
  for (const [tag] of rangeInputs) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(id, `range input needs an id: ${tag}`);
    assert.match(
      html,
      new RegExp(`<label\\b[^>]*\\bfor="${id}"`),
      `${id} needs an associated label`,
    );
  }

  assert.match(runtimeSource, /AudioContext and microphone access remain behind the/);
  assert.match(runtimeSource, /bandNoisinessTargets/);
  assert.match(runtimeSource, /CONSONANT_NOISE_NORMALIZATION/);
  assert.match(runtimeSource, /Math\.sqrt\(1 - noiseMix\)/);
  assert.match(runtimeSource, /id: "speech-glass"/);
  assert.match(appSource, /audioButton"\)\.addEventListener\("click",\s*toggleAudio\)/);
  assert.match(appSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(appSource, /globalThis\.addEventListener\("pagehide"/);
  assert.match(appSource, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(appSource, /resizeObserver\?\.disconnect\(\)/);
  assert.match(appSource, /URL\.createObjectURL\(file\)/);
  assert.match(appSource, /URL\.revokeObjectURL\(state\.fileUrl\)/);
  assert.match(appSource, /audio\.close\(\)/);
  assert.match(appSource, /button\.append\(label\)/);
  assert.doesNotMatch(appSource, /detail\.textContent/);
  assert.match(appSource, /event\.key\s*===\s*"ArrowUp"/);
  assert.match(appSource, /event\.key\s*===\s*" "\)/);
});
