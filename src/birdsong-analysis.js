import {
  SYRINX_SOURCE_DEFAULTS,
  SyrinxSourceEngine,
} from "./syrinx-source-models.js";

const TWO_PI = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 576_000;
const DEFAULT_MIN_F0_HZ = 180;
const DEFAULT_MAX_F0_HZ = 5_500;
const DEFAULT_MAX_DURATION_SECONDS = 12;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

function sampleRms(samples) {
  if (!samples.length) return 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = finite(samples[index]);
    energy += value * value;
  }
  return Math.sqrt(energy / samples.length);
}

function samplePeak(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(finite(samples[index])));
  }
  return peak;
}

function parabolicMinimum(values, index) {
  if (index <= 0 || index >= values.length - 1) return index;
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return index;
  return index + clamp(0.5 * (left - right) / denominator, -0.5, 0.5);
}

function estimateFramePitch(frame, sampleRate, minimumHz, maximumHz, threshold) {
  const minimumLag = Math.max(2, Math.floor(sampleRate / maximumHz));
  const maximumLag = Math.min(
    frame.length - 3,
    Math.ceil(sampleRate / minimumHz),
  );
  if (maximumLag <= minimumLag) return { f0Hz: 0, confidence: 0 };

  let mean = 0;
  for (let index = 0; index < frame.length; index += 1) mean += frame[index];
  mean /= frame.length;

  // A short fixed comparison window retains several periods at the supported
  // lower bound while keeping a browser upload from becoming an O(frames ×
  // frameSize × lags) UI stall. YIN's difference function does not require a
  // separate analysis window here because each lag compares the same span.
  const workingLength = Math.min(
    frame.length - maximumLag,
    Math.max(256, Math.round(sampleRate * 0.012)),
  );
  const difference = new Float64Array(maximumLag + 1);
  for (let lag = 1; lag <= maximumLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < workingLength; index += 1) {
      const delta = (frame[index] - mean) - (frame[index + lag] - mean);
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  const normalized = new Float64Array(maximumLag + 1);
  normalized[0] = 1;
  let cumulative = 0;
  for (let lag = 1; lag <= maximumLag; lag += 1) {
    cumulative += difference[lag];
    normalized[lag] = cumulative > 0
      ? difference[lag] * lag / cumulative
      : 1;
  }

  let candidate = -1;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    if (normalized[lag] >= threshold) continue;
    candidate = lag;
    while (
      candidate + 1 <= maximumLag
      && normalized[candidate + 1] < normalized[candidate]
    ) candidate += 1;
    break;
  }

  if (candidate < 0) {
    let bestValue = Infinity;
    for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
      if (normalized[lag] < bestValue) {
        bestValue = normalized[lag];
        candidate = lag;
      }
    }
    if (bestValue > Math.max(0.28, threshold * 1.8)) {
      return { f0Hz: 0, confidence: clamp(1 - bestValue) };
    }
  }

  const refinedLag = parabolicMinimum(normalized, candidate);
  const f0Hz = sampleRate / refinedLag;
  return {
    f0Hz: f0Hz >= minimumHz && f0Hz <= maximumHz ? f0Hz : 0,
    confidence: clamp(1 - normalized[candidate]),
  };
}

function smoothVoicedPitch(frames, radius = 2) {
  const original = frames.map((frame) => frame.f0Hz);
  for (let index = 0; index < frames.length; index += 1) {
    if (!frames[index].voiced) continue;
    const neighborhood = [];
    const start = Math.max(0, index - radius);
    const end = Math.min(frames.length - 1, index + radius);
    for (let cursor = start; cursor <= end; cursor += 1) {
      if (frames[cursor].voiced && original[cursor] > 0) {
        neighborhood.push(Math.log(original[cursor]));
      }
    }
    if (neighborhood.length) frames[index].f0Hz = Math.exp(median(neighborhood));
  }
}

function detectSyllables(frames, hopSeconds, mergeGapFrames = 2) {
  const ranges = [];
  let start = -1;
  let lastVoiced = -1;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].voiced) {
      if (start < 0) start = index;
      lastVoiced = index;
      continue;
    }
    if (start >= 0 && index - lastVoiced > mergeGapFrames) {
      ranges.push({
        startSeconds: Math.max(0, (start - 0.5) * hopSeconds),
        endSeconds: (lastVoiced + 0.5) * hopSeconds,
      });
      start = -1;
      lastVoiced = -1;
    }
  }
  if (start >= 0) {
    ranges.push({
      startSeconds: Math.max(0, (start - 0.5) * hopSeconds),
      endSeconds: (lastVoiced + 0.5) * hopSeconds,
    });
  }
  return ranges.map((range, index) => Object.freeze({
    id: `syllable-${index + 1}`,
    ...range,
    durationSeconds: Math.max(0, range.endSeconds - range.startSeconds),
  }));
}

export function monoSamples(channels) {
  if (!Array.isArray(channels) || !channels.length) {
    throw new TypeError("monoSamples requires at least one channel");
  }
  const length = Math.min(...channels.map((channel) => channel?.length ?? 0));
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new TypeError("monoSamples requires non-empty numeric channels");
  }
  const output = new Float32Array(length);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    for (let index = 0; index < length; index += 1) {
      output[index] += finite(channel[index]) / channels.length;
    }
  }
  return output;
}

export function analyzeBirdsong(samples, sampleRate = DEFAULT_SAMPLE_RATE, options = {}) {
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length < 32) {
    throw new TypeError("Choose a non-empty audio clip");
  }
  const rate = finite(sampleRate);
  if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
    throw new RangeError(`Sample rate must be ${MIN_SAMPLE_RATE}–${MAX_SAMPLE_RATE} Hz`);
  }

  const minimumF0Hz = clamp(
    finite(options.minimumF0Hz, DEFAULT_MIN_F0_HZ),
    40,
    rate * 0.2,
  );
  const maximumF0Hz = clamp(
    finite(options.maximumF0Hz, DEFAULT_MAX_F0_HZ),
    minimumF0Hz * 1.5,
    rate * 0.42,
  );
  const maxSamples = Math.max(32, Math.floor(
    rate * clamp(
      finite(options.maxDurationSeconds, DEFAULT_MAX_DURATION_SECONDS),
      0.1,
      60,
    ),
  ));
  const sampleCount = Math.min(samples.length, maxSamples);
  const frameSize = Math.min(
    4_096,
    Math.max(
      512,
      Math.floor(finite(
        options.frameSize,
        nextPowerOfTwo(rate * 3 / minimumF0Hz),
      )),
    ),
  );
  const hopSize = Math.min(
    frameSize,
    Math.max(32, Math.floor(finite(options.hopSize, frameSize / 2))),
  );
  const yinThreshold = clamp(finite(options.yinThreshold, 0.16), 0.04, 0.5);

  let mean = 0;
  for (let index = 0; index < sampleCount; index += 1) mean += finite(samples[index]);
  mean /= sampleCount;
  const centered = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    centered[index] = finite(samples[index]) - mean;
  }
  const peak = samplePeak(centered);
  if (peak < 1e-7) {
    return Object.freeze({
      version: 1,
      sampleRate: rate,
      sampleCount,
      durationSeconds: sampleCount / rate,
      frameSize,
      hopSize,
      minimumF0Hz,
      maximumF0Hz,
      globalPeak: peak,
      globalRms: 0,
      voicedFraction: 0,
      medianF0Hz: 0,
      frames: Object.freeze([]),
      syllables: Object.freeze([]),
      warning: "No signal above the silence floor was found.",
    });
  }
  const normalized = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) normalized[index] = centered[index] / peak;

  const frameCount = Math.max(1, Math.ceil((sampleCount - 1) / hopSize) + 1);
  const frames = [];
  let maximumFrameRms = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const center = frameIndex * hopSize;
    const start = center - Math.floor(frameSize / 2);
    const frame = new Float32Array(frameSize);
    let energy = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const sourceIndex = start + index;
      const value = sourceIndex >= 0 && sourceIndex < normalized.length
        ? normalized[sourceIndex]
        : 0;
      frame[index] = value;
      energy += value * value;
    }
    const rms = Math.sqrt(energy / frameSize);
    maximumFrameRms = Math.max(maximumFrameRms, rms);
    frames.push({
      timeSeconds: Math.min(sampleCount / rate, center / rate),
      rms,
      envelope: 0,
      f0Hz: 0,
      confidence: 0,
      voiced: false,
      pressureProxy: 0,
      tensionProxy: 0,
      _frame: frame,
    });
  }

  const gateRms = Math.max(0.004, maximumFrameRms * 0.045);
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    frame.envelope = maximumFrameRms > 0
      ? clamp(frame.rms / maximumFrameRms)
      : 0;
    if (frame.rms >= gateRms) {
      const pitch = estimateFramePitch(
        frame._frame,
        rate,
        minimumF0Hz,
        maximumF0Hz,
        yinThreshold,
      );
      frame.f0Hz = pitch.f0Hz;
      frame.confidence = pitch.confidence;
      frame.voiced = pitch.f0Hz > 0 && pitch.confidence >= 0.62;
    }
    delete frame._frame;
  }
  smoothVoicedPitch(frames);

  const logMinimum = Math.log(minimumF0Hz);
  const logRange = Math.log(maximumF0Hz) - logMinimum;
  for (const frame of frames) {
    frame.pressureProxy = frame.voiced
      ? clamp(frame.envelope ** 0.68)
      : 0;
    frame.tensionProxy = frame.voiced
      ? clamp((Math.log(frame.f0Hz) - logMinimum) / logRange)
      : 0;
    Object.freeze(frame);
  }

  const voicedFrames = frames.filter((frame) => frame.voiced);
  const hopSeconds = hopSize / rate;
  const syllables = detectSyllables(frames, hopSeconds);
  const warning = voicedFrames.length
    ? "Effective gesture proxies only; audio does not uniquely identify bird physiology."
    : "No stable monophonic pitch was found. Try a cleaner tonal syllable.";

  return Object.freeze({
    version: 1,
    sampleRate: rate,
    sampleCount,
    durationSeconds: sampleCount / rate,
    frameSize,
    hopSize,
    minimumF0Hz,
    maximumF0Hz,
    globalPeak: peak,
    globalRms: sampleRms(normalized),
    voicedFraction: voicedFrames.length / Math.max(1, frames.length),
    medianF0Hz: median(voicedFrames.map((frame) => frame.f0Hz)),
    frames: Object.freeze(frames),
    syllables: Object.freeze(syllables),
    warning,
  });
}

function interpolateFrame(frames, sampleIndex, hopSize) {
  if (!frames.length) return null;
  const position = sampleIndex / hopSize;
  const leftIndex = clamp(Math.floor(position), 0, frames.length - 1);
  const rightIndex = Math.min(frames.length - 1, leftIndex + 1);
  const mix = clamp(position - leftIndex);
  const left = frames[leftIndex];
  const right = frames[rightIndex];
  const interpolate = (key) => left[key] + (right[key] - left[key]) * mix;
  const voiced = left.voiced || right.voiced;
  const f0Left = left.voiced ? left.f0Hz : right.f0Hz;
  const f0Right = right.voiced ? right.f0Hz : left.f0Hz;
  return {
    voiced,
    f0Hz: voiced ? f0Left + (f0Right - f0Left) * mix : 0,
    envelope: interpolate("envelope"),
    confidence: interpolate("confidence"),
    pressureProxy: interpolate("pressureProxy"),
    tensionProxy: interpolate("tensionProxy"),
  };
}

function createBandpass(sampleRate, frequencyHz, q) {
  const frequency = clamp(frequencyHz, 40, sampleRate * 0.44);
  const quality = clamp(q, 0.25, 40);
  const omega = TWO_PI * frequency / sampleRate;
  const alpha = Math.sin(omega) / (2 * quality);
  const scale = 1 / (1 + alpha);
  return {
    b0: alpha * scale,
    b1: 0,
    b2: -alpha * scale,
    a1: -2 * Math.cos(omega) * scale,
    a2: (1 - alpha) * scale,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function filterSample(filter, input) {
  const output = filter.b0 * input
    + filter.b1 * filter.x1
    + filter.b2 * filter.x2
    - filter.a1 * filter.y1
    - filter.a2 * filter.y2;
  filter.x2 = filter.x1;
  filter.x1 = input;
  filter.y2 = filter.y1;
  filter.y1 = Number.isFinite(output) ? output : 0;
  return filter.y1;
}

function fadeAndNormalize(samples, sampleRate, targetPeak = 0.88) {
  const fadeSamples = Math.min(
    Math.floor(samples.length / 2),
    Math.max(1, Math.round(sampleRate * 0.008)),
  );
  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = Math.sin((index + 0.5) / fadeSamples * Math.PI * 0.5) ** 2;
    samples[index] *= gain;
    samples[samples.length - 1 - index] *= gain;
  }
  const peak = samplePeak(samples);
  const gain = peak > 1e-8 ? Math.min(8, targetPeak / peak) : 0;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.tanh(samples[index] * gain * 1.05) / Math.tanh(1.05);
  }
  return samples;
}

export function renderBirdsongModel(analysis, options = {}) {
  if (!analysis?.frames || !Number.isSafeInteger(analysis.sampleCount)) {
    throw new TypeError("renderBirdsongModel requires analyzeBirdsong output");
  }
  const sampleRate = analysis.sampleRate;
  const requestedSpeedRatio = clamp(finite(options.speedRatio, 1), 0.125, 8);
  const maximumOutputSeconds = clamp(finite(options.maximumOutputSeconds, 30), 1, 120);
  const requestedOutputSampleCount = Math.max(
    32,
    Math.round(analysis.sampleCount / requestedSpeedRatio),
  );
  const maximumOutputSampleCount = Math.max(
    analysis.sampleCount,
    Math.round(sampleRate * maximumOutputSeconds),
  );
  const outputSampleCount = Math.min(requestedOutputSampleCount, maximumOutputSampleCount);
  const speedRatio = analysis.sampleCount / outputSampleCount;
  const timeWarpLimited = outputSampleCount < requestedOutputSampleCount;
  const output = new Float32Array(outputSampleCount);
  if (!analysis.frames.length || analysis.voicedFraction <= 0) {
    return Object.freeze({
      samples: output,
      sampleRate,
      model: Object.freeze({ requestedSpeedRatio, speedRatio, timeWarpLimited }),
    });
  }

  const pitchShiftSemitones = clamp(finite(options.pitchShiftSemitones), -48, 48);
  const pitchRatio = 2 ** (pitchShiftSemitones / 12);
  const bodyScale = clamp(finite(options.bodyScale, 1), 0.25, 4);
  const textureAmount = clamp(finite(options.textureAmount, 1), 0, 4);
  const drive = clamp(finite(options.drive, 1), 0.25, 1.8);
  const roughness = clamp(finite(options.roughness, 0.035) * textureAmount, 0, 0.8);
  const resonanceHz = clamp(
    finite(options.resonanceHz, clamp(analysis.medianF0Hz * 2.45, 1_100, 5_200)) / bodyScale,
    300,
    sampleRate * 0.42,
  );
  const resonanceQ = clamp(finite(options.resonanceQ, 4.5), 0.35, 18);
  const resonanceMix = clamp(finite(options.resonanceMix, 0.42), 0, 0.9);
  const controlInterval = Math.max(16, Math.min(128, Math.round(sampleRate / 600)));
  const sourceOversample = 2;
  const sourceSampleRate = sampleRate * sourceOversample;
  const defaults = SYRINX_SOURCE_DEFAULTS.syrinx;
  const source = new SyrinxSourceEngine({
    sampleRate: sourceSampleRate,
    model: "syrinx",
    seed: Math.floor(finite(options.seed, 0x57a0f3)),
    parameters: {
      ...defaults,
      pressure: 0,
      frequencyHz: clamp(analysis.medianF0Hz || 1_200, 80, sampleRate * 0.18),
      tension: 0.62,
      adduction: 0.64,
      roughness,
      asymmetry: clamp(finite(options.asymmetry, 0.035), -0.5, 0.5),
      sourceBalance: clamp(finite(options.sourceBalance, 0), -0.9, 0.9),
      coupling: 0.16,
      feedback: 0,
      breath: 0.015 + roughness * 0.16,
      outputGain: 0.84,
    },
  });
  const firstResonator = createBandpass(sampleRate, resonanceHz, resonanceQ);
  const secondResonator = createBandpass(
    sampleRate,
    Math.min(sampleRate * 0.42, resonanceHz * 1.72),
    Math.max(0.5, resonanceQ * 0.68),
  );
  let gate = 0;
  const gateAttack = 1 - Math.exp(-1 / (sampleRate * 0.004));
  const gateRelease = 1 - Math.exp(-1 / (sampleRate * 0.012));
  const sourceCutoffHz = Math.min(18_000, sampleRate * 0.38);
  const sourceLowpassAlpha = 1 - Math.exp(-TWO_PI * sourceCutoffHz / sourceSampleRate);
  let sourceLowpassOne = 0;
  let sourceLowpassTwo = 0;
  let currentFrame = interpolateFrame(analysis.frames, 0, analysis.hopSize);

  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * speedRatio;
    if (index % controlInterval === 0) {
      currentFrame = interpolateFrame(analysis.frames, sourceIndex, analysis.hopSize);
      const targetFrequency = currentFrame?.voiced
        ? clamp(currentFrame.f0Hz * pitchRatio, 80, sampleRate * 0.18)
        : clamp(analysis.medianF0Hz * pitchRatio, 80, sampleRate * 0.18);
      const pressureProxy = currentFrame?.voiced ? currentFrame.pressureProxy : 0;
      source.setParameters({
        frequencyHz: targetFrequency,
        pressure: clamp(pressureProxy * drive, 0, 1),
        tension: clamp(0.16 + (currentFrame?.tensionProxy ?? 0.5) * 0.78),
        adduction: clamp(0.48 + pressureProxy * 0.38),
        roughness: clamp(
          roughness + (1 - (currentFrame?.confidence ?? 1)) * roughness * 0.55,
          0,
          0.8,
        ),
      });
    }
    const targetGate = currentFrame?.voiced
      ? clamp(currentFrame.envelope * 1.18) ** 0.72
      : 0;
    gate += (targetGate - gate) * (targetGate > gate ? gateAttack : gateRelease);
    let sourceSum = 0;
    for (let sourceStep = 0; sourceStep < sourceOversample; sourceStep += 1) {
      const sourceSample = source.renderSample(0);
      sourceLowpassOne += (sourceSample - sourceLowpassOne) * sourceLowpassAlpha;
      sourceLowpassTwo += (sourceLowpassOne - sourceLowpassTwo) * sourceLowpassAlpha;
      sourceSum += sourceLowpassTwo;
    }
    const dry = sourceSum / sourceOversample * gate;
    const resonant = filterSample(firstResonator, dry) * 2.1
      + filterSample(secondResonator, dry) * 1.15;
    output[index] = dry * (1 - resonanceMix) + resonant * resonanceMix;
  }

  fadeAndNormalize(output, sampleRate);
  return Object.freeze({
    samples: output,
    sampleRate,
    model: Object.freeze({
      id: "effective-bilateral-syrinx-v0",
      requestedSpeedRatio,
      speedRatio,
      timeWarpLimited,
      maximumOutputSeconds,
      pitchShiftSemitones,
      pitchRatio,
      bodyScale,
      textureAmount,
      drive,
      roughness,
      resonanceHz,
      resonanceQ,
      resonanceMix,
      controlIntervalSamples: controlInterval,
      sourceOversample,
      seed: Math.floor(finite(options.seed, 0x57a0f3)),
    }),
  });
}

function smoothPulse(position) {
  if (position <= 0 || position >= 1) return 0;
  return Math.sin(Math.PI * position) ** 1.7;
}

const BIRDSONG_DEMO_DEFINITIONS = Object.freeze({
  "mixed-songbird": Object.freeze({
    label: "Synthetic six-syllable strophe",
    description: "Six rising, falling, and repeated tonal syllables",
    analysisRange: "songbird",
    durationSeconds: 3.35,
    harmonics: Object.freeze([0.72, 0.2, 0.08]),
    syllables: Object.freeze([
      Object.freeze({ start: 0.16, duration: 0.38, from: 920, to: 1_560, vibrato: 19 }),
      Object.freeze({ start: 0.70, duration: 0.28, from: 2_180, to: 1_720, vibrato: 28 }),
      Object.freeze({ start: 1.12, duration: 0.46, from: 1_340, to: 1_960, vibrato: 34 }),
      Object.freeze({ start: 1.76, duration: 0.22, from: 2_420, to: 2_260, vibrato: 42 }),
      Object.freeze({ start: 2.08, duration: 0.22, from: 2_380, to: 2_190, vibrato: 42 }),
      Object.freeze({ start: 2.42, duration: 0.62, from: 1_820, to: 760, vibrato: 16 }),
    ]),
  }),
  "high-whistles": Object.freeze({
    label: "Synthetic · high whistle arcs",
    description: "Five bright frequency-modulated whistles",
    analysisRange: "ultrahigh",
    durationSeconds: 3.9,
    harmonics: Object.freeze([0.91, 0.07, 0.02]),
    syllables: Object.freeze([
      Object.freeze({ start: 0.18, duration: 0.42, from: 3_050, to: 4_850, vibrato: 54 }),
      Object.freeze({ start: 0.82, duration: 0.34, from: 5_250, to: 3_780, vibrato: 72 }),
      Object.freeze({ start: 1.38, duration: 0.56, from: 3_420, to: 6_180, vibrato: 88 }),
      Object.freeze({ start: 2.20, duration: 0.38, from: 5_600, to: 4_420, vibrato: 66 }),
      Object.freeze({ start: 2.86, duration: 0.68, from: 3_900, to: 5_180, vibrato: 46 }),
    ]),
  }),
  "low-coos": Object.freeze({
    label: "Synthetic · low four-note coo",
    description: "Four slow, low-frequency tonal phrases",
    analysisRange: "lowbird",
    durationSeconds: 4.75,
    harmonics: Object.freeze([0.82, 0.14, 0.04]),
    syllables: Object.freeze([
      Object.freeze({ start: 0.18, duration: 0.72, from: 285, to: 410, vibrato: 4 }),
      Object.freeze({ start: 1.18, duration: 0.68, from: 455, to: 325, vibrato: 5 }),
      Object.freeze({ start: 2.14, duration: 0.94, from: 275, to: 510, vibrato: 6 }),
      Object.freeze({ start: 3.44, duration: 0.78, from: 405, to: 245, vibrato: 4 }),
    ]),
  }),
});

export const BIRDSONG_DEMO_PRESETS = Object.freeze(
  Object.entries(BIRDSONG_DEMO_DEFINITIONS).map(([id, preset]) => Object.freeze({
    id,
    label: preset.label,
    description: preset.description,
    analysisRange: preset.analysisRange,
  })),
);

export function createDemoStrophe(sampleRate = DEFAULT_SAMPLE_RATE, presetId = "mixed-songbird") {
  const rate = clamp(Math.round(finite(sampleRate, DEFAULT_SAMPLE_RATE)), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
  const resolvedId = Object.hasOwn(BIRDSONG_DEMO_DEFINITIONS, presetId)
    ? presetId
    : "mixed-songbird";
  const preset = BIRDSONG_DEMO_DEFINITIONS[resolvedId];
  const { durationSeconds, syllables } = preset;
  const samples = new Float32Array(Math.round(rate * durationSeconds));
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / rate;
    let amplitude = 0;
    let frequency = 1_200;
    for (const syllable of syllables) {
      const position = (time - syllable.start) / syllable.duration;
      if (position <= 0 || position >= 1) continue;
      amplitude = smoothPulse(position) * (0.72 + 0.2 * Math.sin(Math.PI * position));
      frequency = syllable.from
        + (syllable.to - syllable.from) * (position * position * (3 - 2 * position))
        + syllable.vibrato * Math.sin(TWO_PI * (6.2 + position * 1.3) * time);
      break;
    }
    phase += TWO_PI * frequency / rate;
    const [fundamental, second, third] = preset.harmonics;
    samples[index] = amplitude * (
      fundamental * Math.sin(phase)
      + second * Math.sin(phase * 2 + 0.17)
      + third * Math.sin(phase * 3 + 0.41)
    );
  }
  fadeAndNormalize(samples, rate, 0.78);
  return Object.freeze({
    samples,
    sampleRate: rate,
    presetId: resolvedId,
    label: preset.label,
    description: preset.description,
    analysisRange: preset.analysisRange,
    expectedSyllables: syllables.length,
  });
}

export function encodeMonoWav(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
  if (!samples || !Number.isSafeInteger(samples.length)) {
    throw new TypeError("encodeMonoWav requires an array-like sample buffer");
  }
  const rate = clamp(Math.round(finite(sampleRate, DEFAULT_SAMPLE_RATE)), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = clamp(finite(samples[index]), -1, 1);
    const integer = value < 0 ? Math.round(value * 32_768) : Math.round(value * 32_767);
    view.setInt16(44 + index * bytesPerSample, integer, true);
  }
  return buffer;
}

export function analysisExport(analysis, render = null, sourceLabel = "local audio") {
  return Object.freeze({
    format: "morphazoid-effective-birdsong-gesture",
    version: 1,
    source: sourceLabel,
    disclaimer: "Controls are acoustic gesture proxies, not recovered physiology.",
    sampleRate: analysis.sampleRate,
    sampleCount: analysis.sampleCount,
    durationSeconds: analysis.durationSeconds,
    analysis: Object.freeze({
      frameSize: analysis.frameSize,
      hopSize: analysis.hopSize,
      minimumF0Hz: analysis.minimumF0Hz,
      maximumF0Hz: analysis.maximumF0Hz,
      voicedFraction: analysis.voicedFraction,
      medianF0Hz: analysis.medianF0Hz,
      syllables: analysis.syllables,
      frames: analysis.frames.map((frame) => ({
        timeSeconds: frame.timeSeconds,
        voiced: frame.voiced,
        f0Hz: frame.f0Hz,
        confidence: frame.confidence,
        amplitudeEnvelope: frame.envelope,
        pressureProxy: frame.pressureProxy,
        tensionProxy: frame.tensionProxy,
      })),
    }),
    synthesis: render?.model ?? null,
  });
}

export const BIRDSONG_ANALYSIS_LIMITS = Object.freeze({
  minimumSampleRate: MIN_SAMPLE_RATE,
  maximumSampleRate: MAX_SAMPLE_RATE,
  defaultMinimumF0Hz: DEFAULT_MIN_F0_HZ,
  defaultMaximumF0Hz: DEFAULT_MAX_F0_HZ,
  defaultMaximumDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
});
