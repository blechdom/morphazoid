const TAU = Math.PI * 2;
const UINT32_RANGE = 4_294_967_296;
const MAX_SAFE_SAMPLE = 1_000_000;
const SILENCE_EPSILON = 1e-12;
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_DURATION = 2.4;
const DEFAULT_TARGET_RMS = 0.18;
const DEFAULT_PEAK_LIMIT = 0.88;
const MAX_CONVOLUTION_TAPS = 192;

export const MAX_BUFFER_RECURSION_DEPTH = 8;
export const MAX_BUFFER_SAMPLES = 1 << 20;
export const MAX_CONVOLUTION_SAMPLES = 1 << 18;

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

function seedToUint32(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.trunc(seed) >>> 0;
  }

  const text = String(seed ?? "morphazoid-recursion");
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed, stream = 0) {
  let state = (
    seedToUint32(seed)
    ^ Math.imul((stream + 1) >>> 0, 0x9e3779b1)
  ) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

function sourceLength({ sampleRate, duration }) {
  const rate = clamp(sampleRate, 1, 384_000, DEFAULT_SAMPLE_RATE);
  const seconds = clamp(duration, 0, 30, DEFAULT_DURATION);
  return Math.min(MAX_BUFFER_SAMPLES, Math.round(rate * seconds));
}

function channelList(channels) {
  if (ArrayBuffer.isView(channels) && !(channels instanceof DataView)) {
    return [channels];
  }
  if (!Array.isArray(channels)) {
    throw new TypeError("Audio channels must be an array of array-like channels.");
  }
  for (const channel of channels) {
    if (channel == null || !Number.isInteger(channel.length)) {
      throw new TypeError("Each audio channel must be an array or typed array.");
    }
  }
  return channels;
}

function copyFiniteChannel(source, length) {
  const output = new Float32Array(length);
  const available = Math.min(length, source?.length ?? 0);
  for (let index = 0; index < available; index += 1) {
    output[index] = finiteSample(source[index]);
  }
  return output;
}

function stereoCopy(channels, maxSamples = MAX_BUFFER_SAMPLES) {
  const sources = channelList(channels);
  if (sources.length === 0) {
    return [new Float32Array(0), new Float32Array(0)];
  }

  let length = 0;
  for (const source of sources.slice(0, 2)) {
    length = Math.max(length, source.length);
  }
  length = Math.min(maxSamples, length);

  const left = copyFiniteChannel(sources[0], length);
  const right = sources[1]
    ? copyFiniteChannel(sources[1], length)
    : left.slice();
  return [left, right];
}

function removeMean(channels) {
  for (const channel of channels) {
    if (channel.length === 0) continue;
    let sum = 0;
    for (const sample of channel) sum += finiteSample(sample);
    const mean = sum / channel.length;
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = finiteSample(channel[index]) - mean;
    }
  }
  return channels;
}

/**
 * Copy, sanitize, and power-normalize a group of audio channels.
 *
 * One gain is used for the entire group, preserving stereo balance. The
 * requested RMS is a ceiling when reaching it would exceed the peak limit.
 */
export function normalizeChannels(channels, options = {}) {
  const sources = channelList(channels);
  const targetRms = clamp(
    options?.targetRms,
    0,
    0.5,
    DEFAULT_TARGET_RMS,
  );
  const peakLimit = clamp(
    options?.peakLimit,
    0,
    1,
    DEFAULT_PEAK_LIMIT,
  );
  const output = sources.map(
    (source) => copyFiniteChannel(source, source.length),
  );

  let peak = 0;
  let sampleCount = 0;
  let maximumChannelRms = 0;
  for (const channel of output) {
    sampleCount += channel.length;
    let channelEnergy = 0;
    for (const sample of channel) {
      const finite = finiteSample(sample);
      channelEnergy += finite * finite;
      peak = Math.max(peak, Math.abs(finite));
    }
    if (channel.length > 0) {
      maximumChannelRms = Math.max(
        maximumChannelRms,
        Math.sqrt(channelEnergy / channel.length),
      );
    }
  }

  if (
    sampleCount === 0
    || targetRms === 0
    || peakLimit === 0
    || peak < SILENCE_EPSILON
    || !Number.isFinite(maximumChannelRms)
  ) {
    for (const channel of output) channel.fill(0);
    return output;
  }

  if (maximumChannelRms < SILENCE_EPSILON) {
    for (const channel of output) channel.fill(0);
    return output;
  }

  const gain = Math.max(
    0,
    Math.min(targetRms / maximumChannelRms, peakLimit / peak),
  );
  for (const channel of output) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = finiteSample(channel[index]) * gain;
      channel[index] = Number.isFinite(sample)
        ? Math.min(peakLimit, Math.max(-peakLimit, sample))
        : 0;
    }
  }
  return output;
}

function pinkNoiseChannel(length, random) {
  const output = new Float64Array(length);
  // Paul Kellet's economical pinking filter, with a little direct white noise
  // retained so that very short seeds still expose the full bandwidth.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (
      b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
    ) * 0.105;
    b6 = white * 0.115926;
    output[index] = pink + white * 0.035;
  }
  return output;
}

/** Generate repeatable, stereo, pink-ish broadband material. */
export function generateNoiseSeed(options = {}) {
  const configuration = options ?? {};
  const length = sourceLength(configuration);
  const seed = configuration.seed ?? 0x51f15e;
  const channels = [
    pinkNoiseChannel(length, seededRandom(seed, 0)),
    pinkNoiseChannel(length, seededRandom(seed, 1)),
  ];
  removeMean(channels);
  return normalizeChannels(channels, {
    targetRms: clamp(
      configuration.targetRms,
      0,
      0.5,
      DEFAULT_TARGET_RMS,
    ),
    peakLimit: clamp(
      configuration.peakLimit,
      0,
      1,
      DEFAULT_PEAK_LIMIT,
    ),
  });
}

function addClick(channel, position, length, amplitude, random) {
  const end = Math.min(channel.length, position + length);
  for (let index = position; index < end; index += 1) {
    const offset = index - position;
    const progress = offset / Math.max(1, length);
    const envelope = (1 - progress) ** 2.5;
    const transient = offset === 0
      ? (random() < 0.5 ? -1 : 1)
      : random() * 2 - 1;
    channel[index] += transient * envelope * amplitude;
  }
}

/** Generate a repeatable sparse field of broadband clicks and micro-bursts. */
export function generateImpulseSeed(options = {}) {
  const configuration = options ?? {};
  const sampleRate = clamp(
    configuration.sampleRate,
    1,
    384_000,
    DEFAULT_SAMPLE_RATE,
  );
  const duration = clamp(
    configuration.duration,
    0,
    30,
    DEFAULT_DURATION,
  );
  const length = Math.min(
    MAX_BUFFER_SAMPLES,
    Math.round(sampleRate * duration),
  );
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  if (length === 0) return [new Float32Array(0), new Float32Array(0)];

  const random = seededRandom(configuration.seed ?? 0x1a2b3c4d, 7);
  const clickCount = Math.min(
    32,
    Math.max(2, Math.round(duration * 5) + 1),
  );
  const spacing = (length - 1) / Math.max(1, clickCount - 1);
  const jitter = Math.max(0, Math.floor(spacing * 0.16));

  for (let click = 0; click < clickCount; click += 1) {
    const centered = click * spacing;
    const offset = click === 0
      ? 0
      : Math.round((random() * 2 - 1) * jitter);
    const position = Math.min(
      length - 1,
      Math.max(0, Math.round(centered) + offset),
    );
    const burstLength = Math.min(
      length - position,
      Math.max(1, Math.round(sampleRate * (0.00045 + random() * 0.0018))),
    );
    const amplitude = 0.42 + random() * 0.58;
    addClick(left, position, burstLength, amplitude, random);

    const stereoOffset = click === 0
      ? 0
      : Math.round((random() * 2 - 1) * sampleRate * 0.0015);
    const rightPosition = Math.min(
      length - 1,
      Math.max(0, position + stereoOffset),
    );
    const rightLength = Math.min(
      length - rightPosition,
      Math.max(1, Math.round(burstLength * (0.72 + random() * 0.56))),
    );
    addClick(
      right,
      rightPosition,
      rightLength,
      amplitude * (0.76 + random() * 0.36),
      random,
    );
  }

  return normalizeChannels([left, right], {
    targetRms: clamp(
      configuration.targetRms,
      0,
      0.5,
      DEFAULT_TARGET_RMS,
    ),
    peakLimit: clamp(
      configuration.peakLimit,
      0,
      1,
      DEFAULT_PEAK_LIMIT,
    ),
  });
}

function sineFold(sample, drive) {
  const folded = Math.sin(finiteSample(sample) * drive * Math.PI * 0.5);
  return Number.isFinite(folded) ? folded : 0;
}

function renderOuroborosChild(parent, configuration) {
  const [sourceLeft, sourceRight] = parent;
  const length = sourceLeft.length;
  const stagedLeft = new Float64Array(length);
  const stagedRight = new Float64Array(length);
  if (length === 0) return [new Float32Array(0), new Float32Array(0)];

  const { transform, intensity } = configuration;
  const foldLength = Math.min(
    length,
    Math.max(1, Math.round(length * (0.04 + transform * 0.58))),
  );
  const foldMix = 0.1 + transform * 0.72;
  const pressure = Math.max(0, (intensity - 0.18) / 0.82);
  const waveMix = pressure * (0.18 + transform * 0.52);
  const drive = 1 + intensity * (2.2 + transform * 2.4);
  const ringPressure = Math.max(0, (intensity - 0.4) / 0.6);
  const ringMix = ringPressure * 0.68;
  const ringCycles = 2 + Math.round(transform * 17);

  for (let index = 0; index < length; index += 1) {
    // Reverse and swap left/right before the new pass consumes anything else.
    let left = finiteSample(sourceRight[length - 1 - index]);
    let right = finiteSample(sourceLeft[length - 1 - index]);

    // Overlay the transformed buffer's own tail onto its head. This reads only
    // the parent arrays; no sample from this child feeds another child sample.
    if (index < foldLength) {
      const tailSource = foldLength - 1 - index;
      const tailLeft = finiteSample(sourceRight[tailSource]);
      const tailRight = finiteSample(sourceLeft[tailSource]);
      left = left * (1 - foldMix * 0.28) + tailLeft * foldMix * 0.64;
      right = right * (1 - foldMix * 0.28) + tailRight * foldMix * 0.64;
    }

    if (waveMix > 0) {
      left += (sineFold(left, drive) - left) * waveMix;
      right += (sineFold(right, drive) - right) * waveMix;
    }

    if (ringMix > 0) {
      const progress = index / Math.max(1, length - 1);
      const phase = TAU * (
        ringCycles * progress
        + intensity * (1.5 + transform * 3) * progress * progress
      );
      const leftCarrier = Math.cos(phase);
      const rightCarrier = Math.sin(phase + Math.PI * 0.25);
      left *= 1 - ringMix + ringMix * leftCarrier;
      right *= 1 - ringMix + ringMix * rightCarrier;
    }

    stagedLeft[index] = Number.isFinite(left) ? left : 0;
    stagedRight[index] = Number.isFinite(right) ? right : 0;
  }

  // A bounded low-pass followed by a very slow DC tracker makes each pass
  // darker and removes offsets introduced by asymmetrical folding.
  const lowPassAlpha = clamp(
    0.48 - transform * 0.28 - intensity * 0.14,
    0.045,
    0.65,
    0.24,
  );
  const dcAlpha = 0.0015 + intensity * 0.0045;
  let lowLeft = 0;
  let lowRight = 0;
  let dcLeft = 0;
  let dcRight = 0;
  for (let index = 0; index < length; index += 1) {
    lowLeft += lowPassAlpha * (stagedLeft[index] - lowLeft);
    lowRight += lowPassAlpha * (stagedRight[index] - lowRight);
    dcLeft += dcAlpha * (lowLeft - dcLeft);
    dcRight += dcAlpha * (lowRight - dcRight);
    stagedLeft[index] = lowLeft - dcLeft;
    stagedRight[index] = lowRight - dcRight;
  }

  return normalizeChannels([stagedLeft, stagedRight], configuration);
}

/**
 * Build a finite output-as-next-input lineage.
 *
 * Generation zero is a normalized stereo copy. Every later generation is
 * produced by applying the same transform to only the immediately prior one.
 */
export function ouroborosGenerations(channels, options = {}) {
  const requested = options ?? {};
  const configuration = {
    depth: clampInteger(
      requested.depth,
      0,
      MAX_BUFFER_RECURSION_DEPTH,
      5,
    ),
    transform: clamp(requested.transform, 0, 1, 0.58),
    intensity: clamp(requested.intensity, 0, 1, 0.42),
    targetRms: clamp(
      requested.targetRms,
      0,
      0.5,
      DEFAULT_TARGET_RMS,
    ),
    peakLimit: clamp(
      requested.peakLimit,
      0,
      1,
      DEFAULT_PEAK_LIMIT,
    ),
  };
  const seed = normalizeChannels(
    stereoCopy(channels, MAX_BUFFER_SAMPLES),
    configuration,
  );
  const generations = [seed];
  for (
    let generation = 0;
    generation < configuration.depth;
    generation += 1
  ) {
    generations.push(
      renderOuroborosChild(generations[generation], configuration),
    );
  }
  return generations;
}

function strongestSparseTaps(channel, maximum = MAX_CONVOLUTION_TAPS) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  if (peak < SILENCE_EPSILON) return [];

  const threshold = peak * 1e-5;
  const candidates = [];
  for (let index = 0; index < channel.length; index += 1) {
    const value = finiteSample(channel[index]);
    if (Math.abs(value) >= threshold) candidates.push({ index, value });
  }
  if (candidates.length <= maximum) return candidates;

  // One strongest tap per temporal partition preserves the whole IR envelope
  // instead of retaining only an early cluster of high-amplitude samples.
  const selected = [];
  for (let partition = 0; partition < maximum; partition += 1) {
    const start = Math.floor(partition * channel.length / maximum);
    const end = Math.floor((partition + 1) * channel.length / maximum);
    let strongestIndex = -1;
    let strongestValue = 0;
    for (let index = start; index < end; index += 1) {
      const value = finiteSample(channel[index]);
      if (
        Math.abs(value) >= threshold
        && Math.abs(value) > Math.abs(strongestValue)
      ) {
        strongestIndex = index;
        strongestValue = value;
      }
    }
    if (strongestIndex >= 0) {
      selected.push({ index: strongestIndex, value: strongestValue });
    }
  }
  return selected;
}

function accumulateSelfConvolution(taps, output, wrapGain) {
  if (taps.length === 0 || output.length === 0) return;
  const scale = 1 / Math.max(1, taps.length);
  for (let left = 0; left < taps.length; left += 1) {
    for (let right = left; right < taps.length; right += 1) {
      let index = taps[left].index + taps[right].index;
      let gain = left === right ? 1 : 2;
      if (index >= output.length) {
        if (wrapGain <= 0) continue;
        index -= output.length;
        gain *= wrapGain;
      }
      const value = taps[left].value * taps[right].value * gain * scale;
      output[index] += Number.isFinite(value) ? value : 0;
    }
  }
}

function accumulateCrossConvolution(leftTaps, rightTaps, output, wrapGain) {
  if (
    leftTaps.length === 0
    || rightTaps.length === 0
    || output.length === 0
  ) {
    return;
  }
  const scale = 1 / Math.sqrt(leftTaps.length * rightTaps.length);
  for (const left of leftTaps) {
    for (const right of rightTaps) {
      let index = left.index + right.index;
      let gain = 1;
      if (index >= output.length) {
        if (wrapGain <= 0) continue;
        index -= output.length;
        gain = wrapGain;
      }
      const value = left.value * right.value * gain * scale;
      output[index] += Number.isFinite(value) ? value : 0;
    }
  }
}

function renderConvolutionChild(parent, configuration) {
  const [left, right] = parent;
  const length = left.length;
  if (length === 0) return [new Float32Array(0), new Float32Array(0)];

  const leftTaps = strongestSparseTaps(left);
  const rightTaps = strongestSparseTaps(right);
  const leftSelf = new Float64Array(length);
  const rightSelf = new Float64Array(length);
  const cross = new Float64Array(length);
  const wrapGain = configuration.intensity * (0.12 + configuration.transform * 0.34);
  accumulateSelfConvolution(leftTaps, leftSelf, wrapGain);
  accumulateSelfConvolution(rightTaps, rightSelf, wrapGain);
  accumulateCrossConvolution(leftTaps, rightTaps, cross, wrapGain);

  const crossMix = configuration.transform * (0.18 + configuration.intensity * 0.38);
  const outputLeft = new Float64Array(length);
  const outputRight = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    outputLeft[index] = (
      leftSelf[index] * (1 - crossMix)
      + cross[index] * crossMix
    );
    outputRight[index] = (
      rightSelf[index] * (1 - crossMix)
      + cross[index] * crossMix
    );
  }
  return normalizeChannels([outputLeft, outputRight], configuration);
}

/**
 * Build fixed-length recursive impulse responses by repeatedly
 * self-convolving the immediately prior IR.
 *
 * Dense inputs are reduced to a bounded, temporally partitioned tap set before
 * each convolution, capping work without changing the output buffer length.
 */
export function convolutionImpulseGenerations(channels, options = {}) {
  const requested = options ?? {};
  const configuration = {
    depth: clampInteger(
      requested.depth,
      0,
      MAX_BUFFER_RECURSION_DEPTH,
      4,
    ),
    transform: clamp(requested.transform, 0, 1, 0.64),
    intensity: clamp(requested.intensity, 0, 1, 0.5),
    maxSamples: clampInteger(
      requested.maxSamples,
      0,
      MAX_CONVOLUTION_SAMPLES,
      MAX_CONVOLUTION_SAMPLES,
    ),
    targetRms: clamp(
      requested.targetRms,
      0,
      0.5,
      DEFAULT_TARGET_RMS,
    ),
    peakLimit: clamp(
      requested.peakLimit,
      0,
      1,
      DEFAULT_PEAK_LIMIT,
    ),
  };
  const seed = normalizeChannels(
    stereoCopy(channels, configuration.maxSamples),
    configuration,
  );
  const generations = [seed];
  for (
    let generation = 0;
    generation < configuration.depth;
    generation += 1
  ) {
    generations.push(
      renderConvolutionChild(generations[generation], configuration),
    );
  }
  return generations;
}
