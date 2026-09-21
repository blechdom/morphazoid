const TWO_PI = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;
const DEFAULT_MAX_DURATION_SECONDS = 12;
const DEFAULT_MIN_CARRIER_HZ = 1_000;
const DEFAULT_MAX_CARRIER_HZ = 12_000;
const REFERENCE_CARRIER_HZ = 4_820;
const REFERENCE_WING_Q = 23.4;
const LIVE_WING_Q_2025 = 7.9;

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(fraction) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const mix = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * mix;
}

function samplePeak(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(finite(samples[index])));
  }
  return peak;
}

function sampleRms(samples) {
  if (!samples.length) return 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = finite(samples[index]);
    energy += sample * sample;
  }
  return Math.sqrt(energy / samples.length);
}

function largestPowerOfTwoAtMost(value) {
  return 2 ** Math.max(1, Math.floor(Math.log2(Math.max(2, value))));
}

function strongestWindowStart(samples, windowSize) {
  if (samples.length <= windowSize) return 0;
  let energy = 0;
  for (let index = 0; index < windowSize; index += 1) energy += samples[index] ** 2;
  let bestEnergy = energy;
  let bestStart = 0;
  const step = Math.max(1, Math.floor(windowSize / 32));
  for (let start = step; start + windowSize <= samples.length; start += step) {
    for (let index = start - step; index < start; index += 1) energy -= samples[index] ** 2;
    for (let index = start + windowSize - step; index < start + windowSize; index += 1) {
      energy += samples[index] ** 2;
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = start;
    }
  }
  return bestStart;
}

function fftInPlace(real, imaginary) {
  const size = real.length;
  let target = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while (target & bit) {
      target ^= bit;
      bit >>= 1;
    }
    target ^= bit;
    if (index < target) {
      [real[index], real[target]] = [real[target], real[index]];
      [imaginary[index], imaginary[target]] = [imaginary[target], imaginary[index]];
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = -TWO_PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function estimateCarrier(samples, sampleRate, minimumHz, maximumHz) {
  const available = Math.max(512, Math.min(8_192, largestPowerOfTwoAtMost(samples.length)));
  const fftSize = Math.min(8_192, Math.max(512, available));
  const windowLength = Math.min(samples.length, fftSize);
  const start = strongestWindowStart(samples, windowLength);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  let mean = 0;
  for (let index = 0; index < windowLength; index += 1) mean += samples[start + index];
  mean /= Math.max(1, windowLength);
  for (let index = 0; index < windowLength; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(TWO_PI * index / Math.max(1, windowLength - 1));
    real[index] = (samples[start + index] - mean) * window;
  }
  fftInPlace(real, imaginary);

  const binHz = sampleRate / fftSize;
  const firstBin = Math.max(1, Math.ceil(minimumHz / binHz));
  const lastBin = Math.min(Math.floor(fftSize / 2) - 1, Math.floor(maximumHz / binHz));
  let peakBin = firstBin;
  let peakPower = 0;
  let bandPower = 0;
  for (let bin = firstBin; bin <= lastBin; bin += 1) {
    const power = real[bin] ** 2 + imaginary[bin] ** 2;
    bandPower += power;
    if (power > peakPower) {
      peakPower = power;
      peakBin = bin;
    }
  }

  const logPower = (bin) => Math.log(Math.max(1e-30, real[bin] ** 2 + imaginary[bin] ** 2));
  const leftLog = logPower(Math.max(firstBin, peakBin - 1));
  const centerLog = logPower(peakBin);
  const rightLog = logPower(Math.min(lastBin, peakBin + 1));
  const denominator = leftLog - 2 * centerLog + rightLog;
  const binOffset = Math.abs(denominator) > 1e-12
    ? clamp(0.5 * (leftLog - rightLog) / denominator, -0.5, 0.5)
    : 0;
  const carrierHz = (peakBin + binOffset) * binHz;

  const halfPower = peakPower * 0.5;
  let leftHalf = peakBin;
  let rightHalf = peakBin;
  while (leftHalf > firstBin) {
    const power = real[leftHalf] ** 2 + imaginary[leftHalf] ** 2;
    if (power <= halfPower) break;
    leftHalf -= 1;
  }
  while (rightHalf < lastBin) {
    const power = real[rightHalf] ** 2 + imaginary[rightHalf] ** 2;
    if (power <= halfPower) break;
    rightHalf += 1;
  }
  const bandwidthHz = Math.max(binHz, (rightHalf - leftHalf) * binHz);
  const effectiveQ = clamp(carrierHz / bandwidthHz, 2, 60);
  const meanBandPower = bandPower / Math.max(1, lastBin - firstBin + 1);
  const tonalityDb = 10 * Math.log10(Math.max(1, peakPower / Math.max(1e-30, meanBandPower)));

  const spectrum = [];
  const bucketCount = 180;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const startBin = Math.floor(firstBin + bucket / bucketCount * (lastBin - firstBin + 1));
    const endBin = Math.max(
      startBin + 1,
      Math.floor(firstBin + (bucket + 1) / bucketCount * (lastBin - firstBin + 1)),
    );
    let bucketPower = 0;
    for (let bin = startBin; bin < endBin && bin <= lastBin; bin += 1) {
      bucketPower = Math.max(bucketPower, real[bin] ** 2 + imaginary[bin] ** 2);
    }
    spectrum.push(Object.freeze({
      frequencyHz: (startBin + endBin - 1) * 0.5 * binHz,
      level: clamp((10 * Math.log10(Math.max(1e-30, bucketPower / peakPower)) + 60) / 60),
    }));
  }

  return Object.freeze({
    carrierHz,
    effectiveQ,
    tonalityDb,
    fftSize,
    spectrum: Object.freeze(spectrum),
  });
}

function buildEnvelope(samples, sampleRate) {
  const frameSize = Math.max(64, Math.round(sampleRate * 0.004));
  const hopSize = Math.max(32, Math.round(sampleRate * 0.002));
  const prefixEnergy = new Float64Array(samples.length + 1);
  for (let index = 0; index < samples.length; index += 1) {
    prefixEnergy[index + 1] = prefixEnergy[index] + samples[index] ** 2;
  }
  const frameCount = Math.max(1, Math.ceil(samples.length / hopSize));
  const raw = new Float64Array(frameCount);
  let maximum = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const center = frame * hopSize;
    const start = Math.max(0, center - Math.floor(frameSize / 2));
    const end = Math.min(samples.length, start + frameSize);
    raw[frame] = Math.sqrt(
      (prefixEnergy[end] - prefixEnergy[start]) / Math.max(1, end - start),
    );
    maximum = Math.max(maximum, raw[frame]);
  }
  const normalized = Array.from(raw, (value) => maximum > 0 ? value / maximum : 0);
  const smoothed = normalized.map((value, index) => (
    normalized[Math.max(0, index - 1)] * 0.22
      + value * 0.56
      + normalized[Math.min(normalized.length - 1, index + 1)] * 0.22
  ));
  const noiseFloor = quantile(smoothed, 0.2);
  const onThreshold = clamp(noiseFloor + (1 - noiseFloor) * 0.18, 0.08, 0.45);
  const offThreshold = clamp(noiseFloor + (1 - noiseFloor) * 0.09, 0.04, onThreshold * 0.78);
  let active = false;
  const frames = smoothed.map((envelope, index) => {
    if (!active && envelope >= onThreshold) active = true;
    else if (active && envelope <= offThreshold) active = false;
    return {
      timeSeconds: index * hopSize / sampleRate,
      envelope,
      active,
    };
  });
  return { frames, frameSize, hopSize, onThreshold, offThreshold };
}

function detectPulses(frames, hopSeconds) {
  const raw = [];
  let start = -1;
  let peak = 0;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].active) {
      if (start < 0) {
        start = index;
        peak = frames[index].envelope;
      }
      peak = Math.max(peak, frames[index].envelope);
      continue;
    }
    if (start < 0) continue;
    const duration = (index - start) * hopSeconds;
    if (duration >= 0.004) {
      raw.push({
        startSeconds: Math.max(0, (start - 0.5) * hopSeconds),
        endSeconds: (index - 0.5) * hopSeconds,
        strength: peak,
      });
    }
    start = -1;
    peak = 0;
  }
  if (start >= 0) {
    const end = frames.length;
    if ((end - start) * hopSeconds >= 0.004) {
      raw.push({
        startSeconds: Math.max(0, (start - 0.5) * hopSeconds),
        endSeconds: end * hopSeconds,
        strength: peak,
      });
    }
  }

  const merged = [];
  for (const pulse of raw) {
    const previous = merged[merged.length - 1];
    if (previous && pulse.startSeconds - previous.endSeconds < 0.0035) {
      previous.endSeconds = pulse.endSeconds;
      previous.strength = Math.max(previous.strength, pulse.strength);
    } else {
      merged.push({ ...pulse });
    }
  }
  return merged.map((pulse, index) => Object.freeze({
    id: `pulse-${index + 1}`,
    ...pulse,
    centerSeconds: (pulse.startSeconds + pulse.endSeconds) * 0.5,
    durationSeconds: pulse.endSeconds - pulse.startSeconds,
  }));
}

function groupChirps(pulses) {
  if (!pulses.length) return [];
  const groups = [];
  let startIndex = 0;
  for (let index = 1; index <= pulses.length; index += 1) {
    const shouldClose = index === pulses.length
      || pulses[index].startSeconds - pulses[index - 1].endSeconds >= 0.12;
    if (!shouldClose) continue;
    const members = pulses.slice(startIndex, index);
    groups.push(Object.freeze({
      id: `chirp-${groups.length + 1}`,
      startSeconds: members[0].startSeconds,
      endSeconds: members[members.length - 1].endSeconds,
      pulseCount: members.length,
    }));
    startIndex = index;
  }
  return groups;
}

function wingStrokeRate(pulses, chirps) {
  const intervals = [];
  for (const chirp of chirps) {
    const members = pulses.filter((pulse) => (
      pulse.centerSeconds >= chirp.startSeconds && pulse.centerSeconds <= chirp.endSeconds
    ));
    for (let index = 1; index < members.length; index += 1) {
      const interval = members[index].centerSeconds - members[index - 1].centerSeconds;
      if (interval >= 0.006 && interval <= 0.1) intervals.push(interval);
    }
  }
  return intervals.length ? 1 / median(intervals) : 0;
}

function freezeAnalysisFrames(frames) {
  return Object.freeze(frames.map((frame) => Object.freeze({ ...frame })));
}

export function analyzeCricketSong(samples, sampleRate = DEFAULT_SAMPLE_RATE, options = {}) {
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length < 64) {
    throw new TypeError("Choose a non-empty cricket recording");
  }
  const rate = finite(sampleRate);
  if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
    throw new RangeError(`Sample rate must be ${MIN_SAMPLE_RATE}–${MAX_SAMPLE_RATE} Hz`);
  }
  const maximumDuration = clamp(
    finite(options.maxDurationSeconds, DEFAULT_MAX_DURATION_SECONDS),
    0.1,
    60,
  );
  const sampleCount = Math.min(samples.length, Math.floor(rate * maximumDuration));
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
      globalPeak: peak,
      globalRms: 0,
      carrierHz: 0,
      toothStrikeRateHz: 0,
      impliedToothStrikeRateHz: 0,
      effectiveQ: 0,
      spectralQ: 0,
      tonalityDb: 0,
      wingStrokeRateHz: 0,
      medianPulseMs: 0,
      dutyCycle: 0,
      frameSize: 0,
      hopSize: 0,
      frames: Object.freeze([]),
      pulses: Object.freeze([]),
      chirps: Object.freeze([]),
      spectrum: Object.freeze([]),
      warning: "No signal above the silence floor was found.",
    });
  }
  const normalized = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) normalized[index] = centered[index] / peak;

  const minimumCarrierHz = clamp(
    finite(options.minimumCarrierHz, DEFAULT_MIN_CARRIER_HZ),
    100,
    rate * 0.25,
  );
  const maximumCarrierHz = clamp(
    finite(options.maximumCarrierHz, DEFAULT_MAX_CARRIER_HZ),
    minimumCarrierHz * 1.5,
    rate * 0.46,
  );
  const carrier = estimateCarrier(normalized, rate, minimumCarrierHz, maximumCarrierHz);
  const envelope = buildEnvelope(normalized, rate);
  const hopSeconds = envelope.hopSize / rate;
  const pulses = detectPulses(envelope.frames, hopSeconds);
  const chirps = groupChirps(pulses);
  const activeFrames = envelope.frames.filter((frame) => frame.active);
  const medianPulseMs = median(pulses.map((pulse) => pulse.durationSeconds * 1_000));
  const narrowband = carrier.tonalityDb >= 7;
  const warning = !narrowband
    ? "The strongest band is weak or noisy; treat the reconstructed carrier and spectral focus cautiously."
    : "Spectral Q is focus in this recording, not measured wing damping; mono sound cannot recover unique anatomy or coupling.";

  return Object.freeze({
    version: 1,
    sampleRate: rate,
    sampleCount,
    durationSeconds: sampleCount / rate,
    globalPeak: peak,
    globalRms: sampleRms(normalized),
    carrierHz: carrier.carrierHz,
    // Mono sound does not expose individual tooth contacts. This is the
    // escapement assumption of roughly one contact per carrier cycle.
    toothStrikeRateHz: carrier.carrierHz,
    impliedToothStrikeRateHz: carrier.carrierHz,
    effectiveQ: carrier.effectiveQ,
    spectralQ: carrier.effectiveQ,
    tonalityDb: carrier.tonalityDb,
    wingStrokeRateHz: wingStrokeRate(pulses, chirps),
    medianPulseMs,
    dutyCycle: activeFrames.length / Math.max(1, envelope.frames.length),
    frameSize: envelope.frameSize,
    hopSize: envelope.hopSize,
    minimumCarrierHz,
    maximumCarrierHz,
    frames: freezeAnalysisFrames(envelope.frames),
    pulses: Object.freeze(pulses),
    chirps: Object.freeze(chirps),
    spectrum: carrier.spectrum,
    warning,
  });
}

function interpolateEnvelope(frames, sampleIndex, hopSize) {
  if (!frames.length) return { envelope: 0, active: false };
  const position = sampleIndex / hopSize;
  const leftIndex = clamp(Math.floor(position), 0, frames.length - 1);
  const rightIndex = Math.min(frames.length - 1, leftIndex + 1);
  const mix = clamp(position - leftIndex);
  const left = frames[leftIndex];
  const right = frames[rightIndex];
  return {
    envelope: left.envelope + (right.envelope - left.envelope) * mix,
    active: left.active || right.active,
  };
}

function createMode(frequencyHz, q, sampleRate) {
  const frequency = clamp(frequencyHz, 40, sampleRate * 0.46);
  const quality = clamp(q, 2, 80);
  const angle = TWO_PI * frequency / sampleRate;
  return {
    real: 0,
    imaginary: 0,
    cosine: Math.cos(angle),
    sine: Math.sin(angle),
    radius: Math.exp(-Math.PI * frequency / (quality * sampleRate)),
  };
}

function stepMode(mode, impulse = 0) {
  const oldReal = mode.real;
  const oldImaginary = mode.imaginary;
  mode.real = mode.radius * (
    oldReal * mode.cosine - oldImaginary * mode.sine
  ) + impulse;
  mode.imaginary = mode.radius * (
    oldReal * mode.sine + oldImaginary * mode.cosine
  );
  return mode.real;
}

function coupledWingModes(baseFrequencyHz, wingQ, mismatchCents, coupling, sampleRate) {
  // Diagonalize the symmetric 2-DOF stiffness matrix once, then run its two
  // normal coordinates as exact damped digital poles. This is equivalent to
  // integrating two mass-normalized wings with an off-diagonal spring, while
  // avoiding the instability of an audio-rate Euler solver.
  const mismatchRatio = 2 ** (mismatchCents / 1_200);
  const firstRatio = 1 / Math.sqrt(mismatchRatio);
  const secondRatio = Math.sqrt(mismatchRatio);
  const couplingCoefficient = clamp(coupling) * 0.18;

  const eigenvalues = (firstFrequency, secondFrequency) => {
    const firstSquared = firstFrequency ** 2;
    const secondSquared = secondFrequency ** 2;
    const cross = couplingCoefficient * firstFrequency * secondFrequency;
    const center = (firstSquared + secondSquared) * 0.5;
    const spread = Math.sqrt(
      ((firstSquared - secondSquared) * 0.5) ** 2 + cross ** 2,
    );
    return {
      low: Math.max(1e-9, center - spread),
      high: Math.max(1e-9, center + spread),
      cross,
      firstSquared,
      secondSquared,
    };
  };

  // Keep the fitted/selected pitch attached to the dominant low mode. The
  // physical uncoupled-wing frequencies consequently move as coupling changes.
  const unit = eigenvalues(firstRatio, secondRatio);
  const scale = baseFrequencyHz / Math.sqrt(unit.low);
  const firstFrequencyHz = firstRatio * scale;
  const secondFrequencyHz = secondRatio * scale;
  const matrix = eigenvalues(firstFrequencyHz, secondFrequencyHz);
  const lowFrequencyHz = Math.sqrt(matrix.low);
  const highFrequencyHz = Math.sqrt(matrix.high);

  let lowVector;
  if (Math.abs(matrix.cross) < 1e-12) {
    lowVector = matrix.firstSquared <= matrix.secondSquared ? [1, 0] : [0, 1];
  } else {
    lowVector = [matrix.cross, matrix.low - matrix.firstSquared];
    const norm = Math.hypot(lowVector[0], lowVector[1]);
    lowVector = [lowVector[0] / norm, lowVector[1] / norm];
  }
  const highVector = [-lowVector[1], lowVector[0]];

  return {
    lowMode: createMode(lowFrequencyHz, wingQ, sampleRate),
    highMode: createMode(highFrequencyHz, wingQ, sampleRate),
    lowVector,
    highVector,
    firstFrequencyHz,
    secondFrequencyHz,
    lowFrequencyHz,
    highFrequencyHz,
    couplingCoefficient,
  };
}

function seededRandom(seed) {
  let state = (Math.floor(finite(seed, 0x43524943)) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function eventAtTime(events, timeSeconds, startIndex = 0) {
  let index = Math.max(0, startIndex);
  while (index < events.length && timeSeconds > events[index].endSeconds) index += 1;
  const event = events[index];
  if (!event || timeSeconds < event.startSeconds || timeSeconds > event.endSeconds) {
    return { event: null, index };
  }
  return { event, index };
}

export function renderCricketModel(analysis, options = {}) {
  if (!analysis?.frames || !Number.isSafeInteger(analysis.sampleCount)) {
    throw new TypeError("renderCricketModel requires analyzeCricketSong output");
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
  if (!analysis.frames.length || !analysis.carrierHz) {
    return Object.freeze({
      samples: output,
      sampleRate,
      model: Object.freeze({ requestedSpeedRatio, speedRatio, timeWarpLimited }),
      stats: Object.freeze({ rawPeak: 0, rawRms: 0 }),
    });
  }

  const resonanceScale = clamp(finite(options.resonanceScale, 1), 0.55, 1.8);
  const pitchShiftSemitones = clamp(finite(options.pitchShiftSemitones), -48, 48);
  const pitchRatio = 2 ** (pitchShiftSemitones / 12);
  const bodyScale = clamp(finite(options.bodyScale, 1), 0.25, 4);
  const textureAmount = clamp(finite(options.textureAmount, 1), 0, 4);
  const baseFrequencyHz = clamp(
    analysis.carrierHz * resonanceScale * pitchRatio / bodyScale,
    120,
    sampleRate * 0.42,
  );
  const toothRateRatio = clamp(finite(options.toothRateRatio, 1), 0.72, 1.28);
  const wingQ = clamp(finite(options.wingQ, LIVE_WING_Q_2025), 3, 55);
  const coupling = clamp(finite(options.coupling, 0.48));
  const wingSplitCents = clamp(finite(options.wingSplitCents, 34), -360, 360);
  const plectrumForce = clamp(finite(options.plectrumForce, 0.82), 0.1, 1.8);
  const toothIrregularity = clamp(
    finite(options.toothIrregularity, 0.035) * textureAmount,
    0,
    0.85,
  );
  const closingSweep = clamp(finite(options.closingSweep, -0.075), -0.24, 0.24);
  const mirrorMix = clamp(finite(options.mirrorMix, 0.32), 0, 0.8);
  const random = seededRandom(options.seed);

  const wings = coupledWingModes(
    baseFrequencyHz,
    wingQ,
    wingSplitCents,
    coupling,
    sampleRate,
  );

  let toothPhase = 0.17;
  let deferredImpulse = 0;
  let eventIndex = 0;
  let previousEventId = "";
  let irregularityState = 0;
  let radiationLowpass = 0;
  let rawSquare = 0;
  let rawPeak = 0;
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * speedRatio;
    const sourceTimeSeconds = sourceIndex / sampleRate;
    const envelope = interpolateEnvelope(analysis.frames, sourceIndex, analysis.hopSize);
    const located = eventAtTime(analysis.pulses, sourceTimeSeconds, eventIndex);
    eventIndex = located.index;
    const pulse = located.event;
    if (pulse?.id !== previousEventId) {
      if (pulse) toothPhase = 0.12;
      previousEventId = pulse?.id ?? "";
    }
    const pulsePosition = pulse
      ? clamp((sourceTimeSeconds - pulse.startSeconds) / Math.max(1e-5, pulse.durationSeconds))
      : 0;
    irregularityState += ((random() * 2 - 1) - irregularityState) * 0.018;
    const instantaneousToothRate = baseFrequencyHz
      * toothRateRatio
      * (1 + closingSweep * pulsePosition)
      * (1 + toothIrregularity * irregularityState * 0.055);
    toothPhase += instantaneousToothRate / sampleRate;
    let impulse = deferredImpulse;
    deferredImpulse = 0;
    if (toothPhase >= 1) {
      toothPhase %= 1;
      if (pulse && envelope.active) {
        const toothStrength = 1 + toothIrregularity * (random() * 2 - 1);
        const toothImpulse = 0.0036
          * plectrumForce
          * envelope.envelope ** 0.62
          * pulse.strength
          * toothStrength;
        // Split a sub-sample tooth contact across adjacent samples. A phase
        // accumulator preserves the average cadence; interpolation prevents
        // its 9/10-sample pattern from becoming a strong artificial sideband.
        const increment = Math.max(1e-9, instantaneousToothRate / sampleRate);
        const crossing = clamp((increment - toothPhase) / increment);
        impulse += toothImpulse * (1 - crossing);
        deferredImpulse += toothImpulse * crossing;
      }
    }

    // The plectrum contacts wing 1. Projection into normal coordinates and
    // reconstruction below makes energy reach wing 2 only through coupling.
    const lowCoordinate = stepMode(wings.lowMode, impulse * wings.lowVector[0]);
    const highCoordinate = stepMode(wings.highMode, impulse * wings.highVector[0]);
    const wingOne = wings.lowVector[0] * lowCoordinate
      + wings.highVector[0] * highCoordinate;
    const wingTwo = wings.lowVector[1] * lowCoordinate
      + wings.highVector[1] * highCoordinate;
    const wingDisplacement = wingOne + wingTwo * mirrorMix;
    radiationLowpass += (wingDisplacement - radiationLowpass) * 0.17;
    const radiated = (wingDisplacement - radiationLowpass) * 2.25
      + wingDisplacement * 0.34
      + impulse * (0.7 + toothIrregularity * 1.4);
    rawPeak = Math.max(rawPeak, Math.abs(radiated));
    rawSquare += radiated * radiated;
    output[index] = Math.tanh(radiated * 1.75) * 0.88;
  }

  const fadeSamples = Math.min(
    Math.floor(output.length / 2),
    Math.max(1, Math.round(sampleRate * 0.006)),
  );
  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = Math.sin((index + 0.5) / fadeSamples * Math.PI * 0.5) ** 2;
    output[index] *= gain;
    output[output.length - 1 - index] *= gain;
  }

  return Object.freeze({
    samples: output,
    sampleRate,
    model: Object.freeze({
      id: "two-dof-cricket-wings-v1",
      requestedSpeedRatio,
      speedRatio,
      timeWarpLimited,
      maximumOutputSeconds,
      pitchShiftSemitones,
      pitchRatio,
      bodyScale,
      textureAmount,
      resonanceScale,
      baseFrequencyHz,
      toothRateRatio,
      toothStrikeRateHz: baseFrequencyHz * toothRateRatio,
      wingQ,
      coupling,
      couplingCoefficient: wings.couplingCoefficient,
      wingSplitCents,
      wingOneFrequencyHz: wings.firstFrequencyHz,
      wingTwoFrequencyHz: wings.secondFrequencyHz,
      lowModeFrequencyHz: wings.lowFrequencyHz,
      highModeFrequencyHz: wings.highFrequencyHz,
      plectrumForce,
      toothIrregularity,
      closingSweep,
      mirrorMix,
      seed: Math.floor(finite(options.seed, 0x43524943)),
    }),
    stats: Object.freeze({
      rawPeak,
      rawRms: Math.sqrt(rawSquare / Math.max(1, output.length)),
      outputPeak: samplePeak(output),
      outputRms: sampleRms(output),
    }),
  });
}

function pulseShape(position) {
  if (position <= 0 || position >= 1) return 0;
  const attack = clamp(position / 0.16);
  const release = clamp((1 - position) / 0.34);
  return (attack * attack * (3 - 2 * attack)) * (release * release * (3 - 2 * release));
}

const CRICKET_DEMO_DEFINITIONS = Object.freeze({
  "field-chirps": Object.freeze({
    label: "Synthetic six-chirp cricket gesture",
    description: "Six measured-tempo chirps with three or four closing strokes",
    durationSeconds: 4.2,
    carrierHz: REFERENCE_CARRIER_HZ,
    chirpStarts: Object.freeze([0.22, 0.83, 1.44, 2.12, 2.74, 3.37]),
    pulseCounts: Object.freeze([3, 3, 4, 3, 4, 3]),
    pulseDuration: 0.026,
    pulseGap: 0.012,
    wingQ: REFERENCE_WING_Q,
    coupling: 0.46,
    wingSplitCents: 28,
    plectrumForce: 1.05,
    closingSweep: -0.065,
    seed: 0x544f4345,
  }),
  "slow-low-chirps": Object.freeze({
    label: "Synthetic · slow low chirps · 3.25 kHz",
    description: "Four widely spaced calls with long closing strokes",
    durationSeconds: 5.2,
    carrierHz: 3_250,
    chirpStarts: Object.freeze([0.30, 1.46, 2.64, 3.92]),
    pulseCounts: Object.freeze([2, 3, 2, 3]),
    pulseDuration: 0.044,
    pulseGap: 0.025,
    wingQ: 13.5,
    coupling: 0.32,
    wingSplitCents: -64,
    plectrumForce: 0.94,
    closingSweep: 0.035,
    seed: 0x534c4f57,
  }),
  "fast-high-trill": Object.freeze({
    label: "Synthetic · fast high trill · 7.10 kHz",
    description: "Four dense trills with short, rapid closing strokes",
    durationSeconds: 4.15,
    carrierHz: 7_100,
    chirpStarts: Object.freeze([0.22, 1.14, 2.06, 2.98]),
    pulseCounts: Object.freeze([8, 9, 8, 9]),
    pulseDuration: 0.014,
    pulseGap: 0.009,
    wingQ: 8.4,
    coupling: 0.58,
    wingSplitCents: 92,
    plectrumForce: 0.86,
    closingSweep: -0.11,
    seed: 0x5452494c,
  }),
});

export const CRICKET_DEMO_PRESETS = Object.freeze(
  Object.entries(CRICKET_DEMO_DEFINITIONS).map(([id, preset]) => Object.freeze({
    id,
    label: preset.label,
    description: preset.description,
  })),
);

function demoGesture(sampleRate, preset) {
  const { durationSeconds } = preset;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const { pulseDuration, pulseGap, chirpStarts, pulseCounts } = preset;
  const pulses = [];
  const chirps = [];
  for (let chirpIndex = 0; chirpIndex < chirpStarts.length; chirpIndex += 1) {
    const chirpStart = chirpStarts[chirpIndex];
    const firstPulse = pulses.length;
    for (let pulseIndex = 0; pulseIndex < pulseCounts[chirpIndex]; pulseIndex += 1) {
      const startSeconds = chirpStart + pulseIndex * (pulseDuration + pulseGap);
      pulses.push(Object.freeze({
        id: `pulse-${pulses.length + 1}`,
        startSeconds,
        endSeconds: startSeconds + pulseDuration,
        centerSeconds: startSeconds + pulseDuration * 0.5,
        durationSeconds: pulseDuration,
        strength: 0.86 + (pulseIndex % 3) * 0.06,
      }));
    }
    const members = pulses.slice(firstPulse);
    chirps.push(Object.freeze({
      id: `chirp-${chirpIndex + 1}`,
      startSeconds: members[0].startSeconds,
      endSeconds: members[members.length - 1].endSeconds,
      pulseCount: members.length,
    }));
  }

  const hopSize = Math.round(sampleRate * 0.002);
  const frameCount = Math.ceil(sampleCount / hopSize);
  const frames = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const timeSeconds = frame * hopSize / sampleRate;
    let envelope = 0;
    for (const pulse of pulses) {
      const position = (timeSeconds - pulse.startSeconds) / pulse.durationSeconds;
      envelope = Math.max(envelope, pulseShape(position) * pulse.strength);
    }
    frames.push(Object.freeze({ timeSeconds, envelope, active: envelope > 0.03 }));
  }
  return Object.freeze({
    version: 1,
    sampleRate,
    sampleCount,
    durationSeconds,
    globalPeak: 1,
    globalRms: 0.1,
    carrierHz: preset.carrierHz,
    toothStrikeRateHz: preset.carrierHz,
    impliedToothStrikeRateHz: preset.carrierHz,
    effectiveQ: preset.wingQ,
    spectralQ: preset.wingQ,
    tonalityDb: 30,
    wingStrokeRateHz: 1 / (pulseDuration + pulseGap),
    medianPulseMs: pulseDuration * 1_000,
    dutyCycle: pulses.length * pulseDuration / durationSeconds,
    frameSize: Math.round(sampleRate * 0.004),
    hopSize,
    minimumCarrierHz: DEFAULT_MIN_CARRIER_HZ,
    maximumCarrierHz: DEFAULT_MAX_CARRIER_HZ,
    frames: Object.freeze(frames),
    pulses: Object.freeze(pulses),
    chirps: Object.freeze(chirps),
    spectrum: Object.freeze([]),
    warning: "Synthetic reference gesture.",
  });
}

export function createDemoCricketSong(sampleRate = DEFAULT_SAMPLE_RATE, presetId = "field-chirps") {
  const rate = clamp(Math.round(finite(sampleRate, DEFAULT_SAMPLE_RATE)), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
  const resolvedId = Object.hasOwn(CRICKET_DEMO_DEFINITIONS, presetId)
    ? presetId
    : "field-chirps";
  const preset = CRICKET_DEMO_DEFINITIONS[resolvedId];
  const gesture = demoGesture(rate, preset);
  const rendered = renderCricketModel(gesture, {
    resonanceScale: 1,
    toothRateRatio: 1.012,
    wingQ: preset.wingQ,
    coupling: preset.coupling,
    wingSplitCents: preset.wingSplitCents,
    plectrumForce: preset.plectrumForce,
    toothIrregularity: 0.025,
    closingSweep: preset.closingSweep,
    mirrorMix: 0.31,
    seed: preset.seed,
  });
  return Object.freeze({
    samples: rendered.samples,
    sampleRate: rate,
    presetId: resolvedId,
    label: preset.label,
    description: preset.description,
    expectedPulses: gesture.pulses.length,
    expectedChirps: gesture.chirps.length,
    referenceCarrierHz: preset.carrierHz,
  });
}

export function cricketGestureExport(analysis, render = null, sourceLabel = "local audio") {
  return Object.freeze({
    format: "morphazoid-cricket-wing-gesture",
    version: 1,
    source: sourceLabel,
    mechanism: "fractional tooth-file impulses driving a reduced two-wing oscillator",
    disclaimer: "Carrier timing is fitted; Q and coupling are hypotheses, not recovered wing anatomy from mono sound.",
    sampleRate: analysis.sampleRate,
    sampleCount: analysis.sampleCount,
    durationSeconds: analysis.durationSeconds,
    analysis: Object.freeze({
      frameSize: analysis.frameSize,
      hopSize: analysis.hopSize,
      carrierHz: analysis.carrierHz,
      toothStrikeRateHz: analysis.toothStrikeRateHz,
      impliedToothStrikeRateHz: analysis.impliedToothStrikeRateHz ?? analysis.toothStrikeRateHz,
      effectiveQ: analysis.effectiveQ,
      spectralQ: analysis.spectralQ ?? analysis.effectiveQ,
      tonalityDb: analysis.tonalityDb,
      wingStrokeRateHz: analysis.wingStrokeRateHz,
      medianPulseMs: analysis.medianPulseMs,
      dutyCycle: analysis.dutyCycle,
      chirps: analysis.chirps,
      pulses: analysis.pulses,
      envelope: analysis.frames.map((frame) => ({
        timeSeconds: frame.timeSeconds,
        amplitude: frame.envelope,
        active: frame.active,
      })),
    }),
    synthesis: render?.model ?? null,
  });
}

export const CRICKET_REFERENCE = Object.freeze({
  species: "Teleogryllus oceanicus",
  carrierHz: REFERENCE_CARRIER_HZ,
  wingQ: REFERENCE_WING_Q,
  context: "2003 mechanically pushed plectrum/file pulse train",
  liveWingQ2025: LIVE_WING_Q_2025,
  liveWingQRange2025: Object.freeze([5.5, 13.1]),
  citationDoi: "10.1242/jeb.00281",
  reconstructionDataDoi: "10.5061/dryad.v15dv4266",
});

export const CRICKET_ANALYSIS_LIMITS = Object.freeze({
  minimumSampleRate: MIN_SAMPLE_RATE,
  maximumSampleRate: MAX_SAMPLE_RATE,
  maximumDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  minimumCarrierHz: DEFAULT_MIN_CARRIER_HZ,
  maximumCarrierHz: DEFAULT_MAX_CARRIER_HZ,
});
