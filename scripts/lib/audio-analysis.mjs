import { access, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const AUDIO_ANALYSIS_SCHEMA_VERSION = 1;

export const DEFAULT_AUDIO_ANALYSIS_CONFIG = Object.freeze({
  analysisSampleRate: 16_000,
  activityFrameMs: 10,
  activityHopMs: 10,
  activityRelativeFloorDb: -32,
  activityNoiseMarginDb: 12,
  activityGapMs: 35,
  activityMinimumMs: 20,
  eventNoiseMarginDb: 3,
  eventRelativeFloorDb: -44,
  eventGapMs: 15,
  eventMinimumMs: 10,
  onsetMinimumRiseDb: 4,
  onsetRefractoryMs: 30,
  spectrumWindowMs: 64,
  maxSpectrumFrames: 768,
  spectrumLowHz: 20,
  spectrumHighHz: 8_000,
  rolloffFraction: 0.85,
  audiblePeriodicityMinHz: 35,
  audiblePeriodicityMaxHz: 500,
  envelopePulseMinHz: 0.5,
  envelopePulseMaxHz: 25,
  maxPeriodicityFrames: 48,
  bands: Object.freeze([
    Object.freeze([20, 80]),
    Object.freeze([80, 150]),
    Object.freeze([150, 500]),
    Object.freeze([500, 1_500]),
    Object.freeze([1_500, 3_000]),
    Object.freeze([3_000, 8_000]),
  ]),
});

const EPSILON = 1e-15;
const execFileAsync = promisify(execFile);

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function powerToDb(value) {
  return value > 0 ? 10 * Math.log10(value) : -240;
}

function amplitudeToDb(value) {
  return value > 0 ? 20 * Math.log10(value) : -240;
}

function quantile(values, fraction) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const position = clamp(fraction, 0, 1) * (clean.length - 1);
  const lower = Math.floor(position);
  const blend = position - lower;
  return clean[lower] + (clean[Math.min(clean.length - 1, lower + 1)] - clean[lower]) * blend;
}

function distribution(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of clean) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return {
    count: clean.length,
    minimum,
    p10: quantile(clean, 0.1),
    q1: quantile(clean, 0.25),
    median: quantile(clean, 0.5),
    q3: quantile(clean, 0.75),
    p90: quantile(clean, 0.9),
    maximum,
    mean,
    standardDeviation: Math.sqrt(variance),
  };
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

/**
 * Decode a RIFF/WAVE PCM or IEEE-float buffer and downmix it to mono.
 * The decoder deliberately does not depend on browser codecs, ffmpeg, or npm packages.
 */
export function decodeWav(input, options = {}) {
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input.buffer ?? input, input.byteOffset ?? 0, input.byteLength);
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Expected a little-endian RIFF/WAVE file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = null;
  let dataOffset = -1;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const chunkId = ascii(bytes, offset, 4);
    const declaredLength = view.getUint32(offset + 4, true);
    const chunkOffset = offset + 8;
    const availableLength = Math.max(0, Math.min(declaredLength, bytes.byteLength - chunkOffset));
    if (chunkId === "fmt " && availableLength >= 16) {
      let formatTag = view.getUint16(chunkOffset, true);
      const channels = view.getUint16(chunkOffset + 2, true);
      const sampleRate = view.getUint32(chunkOffset + 4, true);
      const byteRate = view.getUint32(chunkOffset + 8, true);
      const blockAlign = view.getUint16(chunkOffset + 12, true);
      const bitsPerSample = view.getUint16(chunkOffset + 14, true);
      let validBitsPerSample = bitsPerSample;
      if (formatTag === 0xfffe && availableLength >= 40) {
        validBitsPerSample = view.getUint16(chunkOffset + 18, true) || bitsPerSample;
        formatTag = view.getUint16(chunkOffset + 24, true);
      }
      format = {
        formatTag,
        channels,
        sampleRate,
        byteRate,
        blockAlign,
        bitsPerSample,
        validBitsPerSample,
      };
    } else if (chunkId === "data" && dataOffset < 0) {
      dataOffset = chunkOffset;
      dataBytes = availableLength;
    }
    const step = 8 + declaredLength + (declaredLength & 1);
    if (step <= 8 || offset + step <= offset) break;
    offset += step;
  }
  if (!format || dataOffset < 0) throw new Error("WAVE file is missing a fmt or data chunk.");
  const {
    formatTag,
    channels,
    sampleRate,
    blockAlign,
    bitsPerSample,
  } = format;
  if (!channels || !sampleRate || !blockAlign) throw new Error("WAVE fmt chunk has invalid dimensions.");
  const bytesPerSample = Math.ceil(bitsPerSample / 8);
  if (blockAlign < channels * bytesPerSample) throw new Error("WAVE block alignment is smaller than one frame.");
  if (formatTag !== 1 && formatTag !== 3) {
    throw new Error(`Unsupported WAVE format ${formatTag}; use PCM or IEEE float.`);
  }
  if (formatTag === 1 && ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error(`Unsupported PCM word length: ${bitsPerSample} bits.`);
  }
  if (formatTag === 3 && ![32, 64].includes(bitsPerSample)) {
    throw new Error(`Unsupported IEEE-float word length: ${bitsPerSample} bits.`);
  }

  const availableFrames = Math.floor(dataBytes / blockAlign);
  const requestedStart = clamp(finite(options.startSeconds, 0), 0, availableFrames / sampleRate);
  const requestedEnd = clamp(
    finite(options.endSeconds, availableFrames / sampleRate),
    requestedStart,
    availableFrames / sampleRate,
  );
  const startFrame = Math.floor(requestedStart * sampleRate);
  const endFrame = Math.min(availableFrames, Math.ceil(requestedEnd * sampleRate));
  const samples = new Float32Array(Math.max(0, endFrame - startFrame));

  function readSample(offset) {
    if (formatTag === 3) {
      return bitsPerSample === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
    }
    if (bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
    if (bitsPerSample === 16) return view.getInt16(offset, true) / 32_768;
    if (bitsPerSample === 24) {
      let value = view.getUint8(offset)
        | (view.getUint8(offset + 1) << 8)
        | (view.getUint8(offset + 2) << 16);
      if (value & 0x800000) value |= 0xff000000;
      return value / 8_388_608;
    }
    return view.getInt32(offset, true) / 2_147_483_648;
  }

  for (let outputFrame = 0; outputFrame < samples.length; outputFrame += 1) {
    const frameOffset = dataOffset + (startFrame + outputFrame) * blockAlign;
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = readSample(frameOffset + channel * bytesPerSample);
      sum += Number.isFinite(value) ? value : 0;
    }
    samples[outputFrame] = sum / channels;
  }

  return {
    samples,
    sampleRate,
    sourceChannels: channels,
    sourceFrames: availableFrames,
    sourceDurationSeconds: availableFrames / sampleRate,
    selectedStartSeconds: startFrame / sampleRate,
    selectedEndSeconds: endFrame / sampleRate,
    format: formatTag === 1 ? "pcm" : "float",
    bitsPerSample,
  };
}

function lowpassBiquadInPlace(samples, sampleRate, cutoffHz, q) {
  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * q);
  const a0 = 1 + alpha;
  const b0 = ((1 - cosine) * 0.5) / a0;
  const b1 = (1 - cosine) / a0;
  const b2 = b0;
  const a1 = (-2 * cosine) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    samples[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

/** Downsample with a fourth-order Butterworth anti-alias filter, then interpolate. */
export function resampleMono(input, sourceRate, targetRate) {
  const samples = input instanceof Float32Array ? input : Float32Array.from(input);
  if (!samples.length || sourceRate === targetRate) return samples.slice();
  if (!(sourceRate > 0) || !(targetRate > 0)) throw new Error("Sample rates must be positive.");
  let source = samples;
  if (targetRate < sourceRate) {
    source = samples.slice();
    const cutoff = Math.min(targetRate * 0.45, sourceRate * 0.45);
    lowpassBiquadInPlace(source, sourceRate, cutoff, 0.5411961);
    lowpassBiquadInPlace(source, sourceRate, cutoff, 1.306563);
  }
  const outputLength = Math.max(1, Math.round(source.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = clamp((index + 0.5) * ratio - 0.5, 0, source.length - 1);
    const first = Math.floor(position);
    const second = Math.min(source.length - 1, first + 1);
    const mix = position - first;
    output[index] = source[first] + (source[second] - source[first]) * mix;
  }
  return output;
}

function signalLevel(samples, regions = null) {
  let count = 0;
  let sum = 0;
  let squareSum = 0;
  let peak = 0;
  const spans = regions?.length ? regions : [{ startSample: 0, endSample: samples.length }];
  for (const span of spans) {
    const start = clamp(Math.floor(span.startSample), 0, samples.length);
    const end = clamp(Math.ceil(span.endSample), start, samples.length);
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      sum += value;
      squareSum += value * value;
      peak = Math.max(peak, Math.abs(value));
      count += 1;
    }
  }
  const rms = count ? Math.sqrt(squareSum / count) : 0;
  return {
    sampleCount: count,
    dcOffset: count ? sum / count : 0,
    rmsLinear: rms,
    rmsDbfs: amplitudeToDb(rms),
    peakLinear: peak,
    peakDbfs: amplitudeToDb(peak),
    crestFactorDb: rms > 0 ? amplitudeToDb(peak / rms) : null,
  };
}

function frameEnvelope(samples, sampleRate, config) {
  const frameSize = Math.max(8, Math.round(config.activityFrameMs * 0.001 * sampleRate));
  const hopSize = Math.max(1, Math.round(config.activityHopMs * 0.001 * sampleRate));
  const rms = [];
  const peak = [];
  const starts = [];
  if (!samples.length) return { frameSize, hopSize, rms, peak, starts };
  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + frameSize);
    let squareSum = 0;
    let framePeak = 0;
    for (let index = start; index < end; index += 1) {
      squareSum += samples[index] * samples[index];
      framePeak = Math.max(framePeak, Math.abs(samples[index]));
    }
    starts.push(start);
    rms.push(Math.sqrt(squareSum / Math.max(1, end - start)));
    peak.push(framePeak);
  }
  return { frameSize, hopSize, rms, peak, starts };
}

function closeSmallGaps(mask, maximumGapFrames) {
  const output = [...mask];
  for (let index = 0; index < output.length;) {
    if (output[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < output.length && !output[index]) index += 1;
    if (start > 0 && index < output.length && index - start <= maximumGapFrames) {
      output.fill(true, start, index);
    }
  }
  return output;
}

function removeShortRuns(mask, minimumFrames) {
  const output = [...mask];
  for (let index = 0; index < output.length;) {
    if (!output[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < output.length && output[index]) index += 1;
    if (index - start < minimumFrames) output.fill(false, start, index);
  }
  return output;
}

function activityFromEnvelope(envelope, samples, sampleRate, config) {
  let maximumRms = 0;
  for (const value of envelope.rms) maximumRms = Math.max(maximumRms, value);
  const noiseFloor = quantile(envelope.rms, 0.2) ?? 0;
  const relativeFloor = maximumRms * 10 ** (config.activityRelativeFloorDb / 20);
  const noiseThreshold = noiseFloor * 10 ** (config.activityNoiseMarginDb / 20);
  const dynamicRatio = maximumRms / Math.max(EPSILON, noiseFloor);
  let threshold = dynamicRatio < 2.5
    ? noiseFloor * 0.8
    : Math.max(1e-8, relativeFloor, noiseThreshold);
  const upperActivityQuantile = quantile(envelope.rms, 0.9) ?? maximumRms;
  threshold = Math.min(maximumRms * (1 - 1e-9), upperActivityQuantile, threshold);
  if (maximumRms < 1e-10) threshold = Infinity;
  let mask = envelope.rms.map((value) => value >= threshold);
  mask = closeSmallGaps(mask, Math.round(config.activityGapMs / config.activityHopMs));
  mask = removeShortRuns(mask, Math.max(1, Math.round(config.activityMinimumMs / config.activityHopMs)));
  const regionsFromMask = (sourceMask) => {
    const result = [];
    for (let index = 0; index < sourceMask.length;) {
      if (!sourceMask[index]) {
        index += 1;
        continue;
      }
      const first = index;
      while (index < sourceMask.length && sourceMask[index]) index += 1;
      const last = index - 1;
      const startSample = envelope.starts[first];
      const endSample = Math.min(samples.length, envelope.starts[last] + envelope.frameSize);
      result.push({
        startSample,
        endSample,
        startSeconds: startSample / sampleRate,
        endSeconds: endSample / sampleRate,
        durationSeconds: (endSample - startSample) / sampleRate,
      });
    }
    return result;
  };
  const regions = regionsFromMask(mask);
  const eventThreshold = maximumRms < 1e-10
    ? Infinity
    : dynamicRatio < 2.5
      ? noiseFloor * 0.8
      : Math.min(maximumRms * (1 - 1e-9), Math.max(
        1e-8,
        maximumRms * 10 ** (config.eventRelativeFloorDb / 20),
        noiseFloor * 10 ** (config.eventNoiseMarginDb / 20),
      ));
  let eventMask = envelope.rms.map((value) => value >= eventThreshold);
  eventMask = closeSmallGaps(eventMask, Math.round(config.eventGapMs / config.activityHopMs));
  eventMask = removeShortRuns(eventMask, Math.max(1, Math.round(config.eventMinimumMs / config.activityHopMs)));
  const eventRegions = regionsFromMask(eventMask);
  const activeSamples = regions.reduce((sum, region) => sum + region.endSample - region.startSample, 0);
  const first = regions[0];
  const last = regions.at(-1);
  return {
    thresholdLinear: Number.isFinite(threshold) ? threshold : null,
    thresholdDbfs: Number.isFinite(threshold) ? amplitudeToDb(threshold) : null,
    eventThresholdLinear: Number.isFinite(eventThreshold) ? eventThreshold : null,
    eventThresholdDbfs: Number.isFinite(eventThreshold) ? amplitudeToDb(eventThreshold) : null,
    noiseFloorLinear: noiseFloor,
    noiseFloorDbfs: amplitudeToDb(noiseFloor),
    activeSeconds: activeSamples / sampleRate,
    activeRatio: samples.length ? activeSamples / samples.length : 0,
    effectiveSpanSeconds: first && last ? last.endSeconds - first.startSeconds : 0,
    regions,
    eventRegions,
    mask,
    eventMask,
  };
}

function detectOnsets(envelope, activity, sampleRate, config) {
  if (!envelope.rms.length || !activity.eventRegions.length) return [];
  const levels = envelope.rms.map((value) => amplitudeToDb(Math.max(value, 1e-12)));
  const novelty = levels.map((level, index) => {
    if (!index) return 0;
    const from = Math.max(0, index - 4);
    let baseline = 0;
    for (let cursor = from; cursor < index; cursor += 1) baseline += levels[cursor];
    baseline /= Math.max(1, index - from);
    return Math.max(0, level - baseline);
  });
  const noveltyMedian = quantile(novelty, 0.5) ?? 0;
  const deviations = novelty.map((value) => Math.abs(value - noveltyMedian));
  const mad = quantile(deviations, 0.5) ?? 0;
  const noveltyThreshold = Math.max(config.onsetMinimumRiseDb, noveltyMedian + 3 * 1.4826 * mad);
  const candidates = activity.eventRegions.map((region) => ({
    sample: region.startSample,
    strengthDb: novelty[Math.round(region.startSample / envelope.hopSize)] ?? noveltyThreshold,
  }));
  for (let index = 1; index + 1 < novelty.length; index += 1) {
    if (!activity.eventMask[index]) continue;
    if (novelty[index] < noveltyThreshold) continue;
    if (novelty[index] < novelty[index - 1] || novelty[index] < novelty[index + 1]) continue;
    candidates.push({ sample: envelope.starts[index], strengthDb: novelty[index] });
  }
  candidates.sort((a, b) => a.sample - b.sample || b.strengthDb - a.strengthDb);
  const refractorySamples = Math.round(config.onsetRefractoryMs * 0.001 * sampleRate);
  const selected = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (!previous || candidate.sample - previous.sample >= refractorySamples) {
      selected.push(candidate);
    } else if (candidate.strengthDb > previous.strengthDb) {
      selected[selected.length - 1] = candidate;
    }
  }
  return selected.map((onset) => ({
    seconds: onset.sample / sampleRate,
    strengthDb: onset.strengthDb,
  }));
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function fftInPlace(real, imaginary) {
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size *= 2) {
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      const half = size >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function evenlySelected(values, maximum) {
  if (values.length <= maximum) return values;
  if (maximum <= 0) return [];
  if (maximum === 1) return [values[Math.floor((values.length - 1) * 0.5)]];
  const selected = [];
  for (let index = 0; index < maximum; index += 1) {
    selected.push(values[Math.round(index * (values.length - 1) / (maximum - 1))]);
  }
  return [...new Set(selected)];
}

function frameStartsForRegions(regions, frameSize, hopSize, sampleCount) {
  const starts = [];
  for (const region of regions) {
    const start = clamp(Math.floor(region.startSample), 0, sampleCount);
    const end = clamp(Math.ceil(region.endSample), start, sampleCount);
    if (end <= start) continue;
    if (end - start <= frameSize) {
      starts.push(Math.max(0, Math.min(sampleCount - 1, start)));
      continue;
    }
    for (let cursor = start; cursor + frameSize <= end; cursor += hopSize) starts.push(cursor);
    const finalStart = Math.max(start, end - frameSize);
    if (starts.at(-1) !== finalStart) starts.push(finalStart);
  }
  return starts;
}

function parabolicPeak(power, index, binWidth) {
  if (index <= 0 || index + 1 >= power.length) return index * binWidth;
  const left = Math.log(Math.max(EPSILON, power[index - 1]));
  const center = Math.log(Math.max(EPSILON, power[index]));
  const right = Math.log(Math.max(EPSILON, power[index + 1]));
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 1e-12
    ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5)
    : 0;
  return (index + offset) * binWidth;
}

function spectralSummary(samples, sampleRate, activity, config) {
  const desiredSize = config.spectrumWindowMs * 0.001 * sampleRate;
  const fftSize = clamp(nextPowerOfTwo(desiredSize), 256, 16_384);
  const hopSize = Math.max(1, fftSize >> 1);
  const regions = activity.regions.length
    ? activity.regions
    : samples.length ? [{ startSample: 0, endSample: samples.length }] : [];
  const allStarts = frameStartsForRegions(regions, fftSize, hopSize, samples.length);
  const starts = evenlySelected(allStarts, config.maxSpectrumFrames);
  const power = new Float64Array(fftSize / 2 + 1);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const framePeaks = [];
  const binWidth = sampleRate / fftSize;
  const lowBin = clamp(Math.ceil(config.spectrumLowHz / binWidth), 1, power.length - 1);
  const highHz = Math.min(
    config.spectrumHighHz,
    finite(config.sourceNyquistHz, sampleRate * 0.5),
    sampleRate * 0.5,
  );
  const highBin = clamp(Math.floor(highHz / binWidth), lowBin, power.length - 1);
  let windowEnergy = 0;
  for (let index = 0; index < fftSize; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, fftSize - 1));
    windowEnergy += window * window;
  }
  for (const start of starts) {
    let mean = 0;
    const available = Math.max(1, Math.min(fftSize, samples.length - start));
    for (let index = 0; index < available; index += 1) mean += samples[start + index];
    mean /= available;
    real.fill(0);
    imaginary.fill(0);
    for (let index = 0; index < available; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, fftSize - 1));
      real[index] = (samples[start + index] - mean) * window;
    }
    fftInPlace(real, imaginary);
    let strongestBin = lowBin;
    let strongestPower = 0;
    for (let bin = 0; bin < power.length; bin += 1) {
      const value = (real[bin] ** 2 + imaginary[bin] ** 2) / Math.max(EPSILON, windowEnergy);
      power[bin] += value;
      if (bin >= lowBin && bin <= highBin && value > strongestPower) {
        strongestPower = value;
        strongestBin = bin;
      }
    }
    if (strongestPower > EPSILON) framePeaks.push(strongestBin * binWidth);
  }
  if (!starts.length) {
    return {
      fftSize,
      frameCount: 0,
      frequencyResolutionHz: binWidth,
      peakHz: null,
      centroidHz: null,
      rolloff85Hz: null,
      flatness: null,
      dominantPeaks: [],
      framePeakHz: null,
      bands: config.bands.map(([lowHz, bandHighHz]) => ({
        lowHz,
        highHz: bandHighHz,
        effectiveHighHz: lowHz < highHz ? Math.min(bandHighHz, highHz) : null,
        complete: bandHighHz <= highHz,
        fraction: null,
        relativeDb: null,
      })),
    };
  }
  for (let bin = 0; bin < power.length; bin += 1) power[bin] /= starts.length;
  let totalPower = 0;
  let weightedFrequency = 0;
  for (let bin = lowBin; bin <= highBin; bin += 1) {
    totalPower += power[bin];
    weightedFrequency += power[bin] * bin * binWidth;
  }
  const binCount = Math.max(1, highBin - lowBin + 1);
  if (!(totalPower > 1e-30)) {
    return {
      fftSize,
      frameCount: starts.length,
      frequencyResolutionHz: binWidth,
      analyzedLowHz: lowBin * binWidth,
      analyzedHighHz: highBin * binWidth,
      peakHz: null,
      centroidHz: null,
      rolloff85Hz: null,
      flatness: null,
      dominantPeaks: [],
      framePeakHz: null,
      bands: config.bands.map(([bandLowHz, bandHighHz]) => ({
        lowHz: bandLowHz,
        highHz: bandHighHz,
        effectiveHighHz: Math.min(bandHighHz, highHz),
        complete: bandHighHz <= highHz,
        fraction: null,
        relativeDb: null,
      })),
    };
  }
  const rolloffTarget = totalPower * config.rolloffFraction;
  let accumulated = 0;
  let rolloffBin = lowBin;
  for (let bin = lowBin; bin <= highBin; bin += 1) {
    accumulated += power[bin];
    if (accumulated >= rolloffTarget) {
      rolloffBin = bin;
      break;
    }
  }
  const candidates = [];
  for (let bin = lowBin + 1; bin < highBin; bin += 1) {
    if (power[bin] >= power[bin - 1] && power[bin] > power[bin + 1]) candidates.push(bin);
  }
  if (!candidates.length) {
    let strongest = lowBin;
    for (let bin = lowBin + 1; bin <= highBin; bin += 1) {
      if (power[bin] > power[strongest]) strongest = bin;
    }
    candidates.push(strongest);
  }
  candidates.sort((a, b) => power[b] - power[a]);
  const minimumPeakBins = Math.max(2, Math.ceil(20 / binWidth));
  const peakBins = [];
  for (const candidate of candidates) {
    if (peakBins.every((selected) => Math.abs(candidate - selected) >= minimumPeakBins)) {
      peakBins.push(candidate);
      if (peakBins.length >= 6) break;
    }
  }
  const peakPower = power[peakBins[0]] ?? 0;
  const dominantPeaks = peakBins.map((bin) => {
    const halfPower = power[bin] * 0.5;
    let left = bin;
    let right = bin;
    while (left > lowBin && power[left] > halfPower) left -= 1;
    while (right < highBin && power[right] > halfPower) right += 1;
    const bandwidthHz = Math.max(binWidth, (right - left) * binWidth);
    const frequencyHz = parabolicPeak(power, bin, binWidth);
    return {
      frequencyHz,
      relativeDb: peakPower > 0 ? powerToDb(power[bin] / peakPower) : null,
      powerFraction: totalPower > 0 ? power[bin] / totalPower : 0,
      bandwidth3DbHz: bandwidthHz,
      // This is finite-window spectral sharpness, not a physical resonator Q.
      spectralSharpnessQ: frequencyHz / bandwidthHz,
    };
  });
  const bands = config.bands.map(([bandLowHz, bandHighHz]) => {
    if (bandLowHz >= highHz) {
      return {
        lowHz: bandLowHz,
        highHz: bandHighHz,
        effectiveHighHz: null,
        complete: false,
        fraction: null,
        relativeDb: null,
      };
    }
    const firstBin = clamp(Math.ceil(bandLowHz / binWidth), 0, power.length - 1);
    const cappedHighHz = Math.min(bandHighHz, highHz);
    const lastBin = bandHighHz >= highHz
      ? clamp(Math.floor(cappedHighHz / binWidth), firstBin - 1, power.length - 1)
      : clamp(Math.ceil(cappedHighHz / binWidth) - 1, firstBin - 1, power.length - 1);
    let bandPower = 0;
    for (let bin = firstBin; bin <= lastBin; bin += 1) bandPower += power[bin];
    return {
      lowHz: bandLowHz,
      highHz: bandHighHz,
      effectiveHighHz: cappedHighHz,
      complete: bandHighHz <= highHz,
      fraction: totalPower > 0 ? bandPower / totalPower : 0,
      relativeDb: totalPower > 0 && bandPower > 0 ? powerToDb(bandPower / totalPower) : null,
    };
  });
  const powerFloor = Math.max(Number.MIN_VALUE, totalPower / binCount * 1e-12);
  let flooredPower = 0;
  let logPower = 0;
  for (let bin = lowBin; bin <= highBin; bin += 1) {
    const value = Math.max(powerFloor, power[bin]);
    flooredPower += value;
    logPower += Math.log(value);
  }
  const arithmeticMean = flooredPower / binCount;
  return {
    fftSize,
    frameCount: starts.length,
    frequencyResolutionHz: binWidth,
    analyzedLowHz: lowBin * binWidth,
    analyzedHighHz: highBin * binWidth,
    peakHz: dominantPeaks[0]?.frequencyHz ?? null,
    centroidHz: totalPower > 0 ? weightedFrequency / totalPower : null,
    rolloff85Hz: rolloffBin * binWidth,
    flatness: arithmeticMean > 0
      ? clamp(Math.exp(logPower / binCount) / arithmeticMean, 0, 1)
      : null,
    dominantPeaks,
    framePeakHz: distribution(framePeaks),
    bands,
  };
}

function normalizedCorrelation(values, lag) {
  let dot = 0;
  let firstEnergy = 0;
  let secondEnergy = 0;
  for (let index = lag; index < values.length; index += 1) {
    dot += values[index] * values[index - lag];
    firstEnergy += values[index] * values[index];
    secondEnergy += values[index - lag] * values[index - lag];
  }
  return dot / Math.sqrt(Math.max(EPSILON, firstEnergy * secondEnergy));
}

function bestAutocorrelationPeak(values, minimumLag, maximumLag, preferShortest = false) {
  const correlations = [];
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    correlations.push(normalizedCorrelation(values, lag));
  }
  const candidates = [];
  for (let index = 1; index + 1 < correlations.length; index += 1) {
    if (correlations[index] >= correlations[index - 1] && correlations[index] > correlations[index + 1]) {
      candidates.push(index);
    }
  }
  if (!candidates.length && correlations.length) {
    let strongest = 0;
    for (let index = 1; index < correlations.length; index += 1) {
      if (correlations[index] > correlations[strongest]) strongest = index;
    }
    candidates.push(strongest);
  }
  candidates.sort((a, b) => correlations[b] - correlations[a]);
  let selected = candidates[0];
  if (preferShortest && selected !== undefined) {
    const acceptable = Math.max(0.1, correlations[selected] * 0.92);
    selected = candidates
      .filter((candidate) => correlations[candidate] >= acceptable)
      .sort((a, b) => a - b)[0];
  }
  return selected === undefined
    ? null
    : { lag: minimumLag + selected, strength: correlations[selected] };
}

function waveformPeriodicity(samples, sampleRate, activity, config) {
  const frameSize = Math.max(64, Math.round(0.08 * sampleRate));
  const minimumLag = Math.max(2, Math.floor(sampleRate / config.audiblePeriodicityMaxHz));
  const maximumLag = Math.min(frameSize - 2, Math.ceil(sampleRate / config.audiblePeriodicityMinHz));
  const regions = activity.regions.length
    ? activity.regions
    : samples.length ? [{ startSample: 0, endSample: samples.length }] : [];
  const starts = evenlySelected(
    frameStartsForRegions(regions, frameSize, Math.max(1, frameSize >> 1), samples.length),
    config.maxPeriodicityFrames,
  );
  const frequencies = [];
  const strengths = [];
  for (const start of starts) {
    const available = Math.min(frameSize, samples.length - start);
    if (available <= maximumLag + 2) continue;
    let mean = 0;
    for (let index = 0; index < available; index += 1) mean += samples[start + index];
    mean /= available;
    const centered = new Float64Array(available);
    let energy = 0;
    for (let index = 0; index < available; index += 1) {
      centered[index] = samples[start + index] - mean;
      energy += centered[index] ** 2;
    }
    if (energy < 1e-12) continue;
    const peak = bestAutocorrelationPeak(centered, minimumLag, maximumLag, true);
    if (!peak || peak.strength < 0.1) continue;
    frequencies.push(sampleRate / peak.lag);
    strengths.push(peak.strength);
  }
  const frequencyDistribution = distribution(frequencies);
  return {
    frameCount: frequencies.length,
    frequencyHz: frequencyDistribution,
    medianStrength: quantile(strengths, 0.5),
    coefficientOfVariation: frequencyDistribution?.mean
      ? frequencyDistribution.standardDeviation / frequencyDistribution.mean
      : null,
  };
}

function envelopePulseRate(envelope, config) {
  if (envelope.rms.length < 8) return { frequencyHz: null, strength: null };
  const smoothed = new Float64Array(envelope.rms.length);
  for (let index = 0; index < envelope.rms.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let neighbor = Math.max(0, index - 1); neighbor <= Math.min(envelope.rms.length - 1, index + 1); neighbor += 1) {
      sum += envelope.rms[neighbor];
      count += 1;
    }
    smoothed[index] = sum / count;
  }
  const mean = smoothed.reduce((sum, value) => sum + value, 0) / smoothed.length;
  for (let index = 0; index < smoothed.length; index += 1) smoothed[index] -= mean;
  const frameRate = 1_000 / config.activityHopMs;
  const minimumLag = Math.max(2, Math.floor(frameRate / config.envelopePulseMaxHz));
  const maximumLag = Math.min(smoothed.length - 2, Math.ceil(frameRate / config.envelopePulseMinHz));
  if (maximumLag <= minimumLag) return { frequencyHz: null, strength: null };
  const peak = bestAutocorrelationPeak(smoothed, minimumLag, maximumLag);
  if (!peak || peak.strength < 0.05) return { frequencyHz: null, strength: peak?.strength ?? null };
  return { frequencyHz: frameRate / peak.lag, strength: peak.strength };
}

function linearRegression(points) {
  if (points.length < 3) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (!(denominator > 0)) return null;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (const point of points) {
    residualSumSquares += (point.y - (intercept + slope * point.x)) ** 2;
    totalSumSquares += (point.y - meanY) ** 2;
  }
  return {
    slope,
    intercept,
    rSquared: totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : 1,
  };
}

function decaySummary(envelope, onsets, spectrum, activity, config) {
  const frameSeconds = config.activityHopMs * 0.001;
  const onsetFrames = onsets.map((onset) => Math.round(onset.seconds / frameSeconds));
  const t20Values = [];
  const rt60Values = [];
  const fitDynamicRanges = [];
  const fitRSquared = [];
  const fitMonotonicFractions = [];
  let attemptedDecayCount = 0;
  for (let onsetIndex = 0; onsetIndex < onsetFrames.length; onsetIndex += 1) {
    const onsetFrame = onsetFrames[onsetIndex];
    const searchEnd = Math.min(envelope.rms.length, onsetFrame + Math.max(2, Math.round(0.06 / frameSeconds)));
    let peakFrame = onsetFrame;
    for (let index = onsetFrame + 1; index < searchEnd; index += 1) {
      if (envelope.rms[index] > envelope.rms[peakFrame]) peakFrame = index;
    }
    const peak = envelope.rms[peakFrame] ?? 0;
    if (peak <= 0) continue;
    attemptedDecayCount += 1;
    const nextOnset = onsetFrames[onsetIndex + 1] ?? Infinity;
    const maximumEnd = Math.min(envelope.rms.length, peakFrame + Math.round(1.5 / frameSeconds), nextOnset);
    const points = [];
    const noiseClearance = activity.noiseFloorLinear * 10 ** (6 / 20);
    let started = false;
    let downwardSteps = 0;
    let comparedSteps = 0;
    let previousDb = null;
    for (let index = peakFrame + 1; index < maximumEnd; index += 1) {
      const relativeDb = amplitudeToDb(Math.max(EPSILON, envelope.rms[index] / peak));
      if (!started) {
        if (relativeDb > -3) continue;
        started = true;
      }
      if (envelope.rms[index] <= noiseClearance || relativeDb < -35) break;
      if (relativeDb > -1 || (previousDb !== null && relativeDb - previousDb > 6)) break;
      if (relativeDb <= -3 && relativeDb >= -35) {
        if (previousDb !== null) {
          comparedSteps += 1;
          if (relativeDb <= previousDb + 0.5) downwardSteps += 1;
        }
        points.push({ x: (index - peakFrame) * frameSeconds, y: relativeDb });
        previousDb = relativeDb;
      }
    }
    const fit = linearRegression(points);
    const dynamicRangeDb = points.length
      ? Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
      : 0;
    const monotonicFraction = comparedSteps ? downwardSteps / comparedSteps : 0;
    if (points.length >= 6
      && dynamicRangeDb >= 15
      && fit?.slope < -5
      && fit.rSquared >= 0.8
      && monotonicFraction >= 0.65) {
      t20Values.push(-20 / fit.slope);
      rt60Values.push(-60 / fit.slope);
      fitDynamicRanges.push(dynamicRangeDb);
      fitRSquared.push(fit.rSquared);
      fitMonotonicFractions.push(monotonicFraction);
    }
  }
  const rt60 = quantile(rt60Values, 0.5);
  const peakHz = spectrum.peakHz;
  return {
    attemptedDecayCount,
    fittedDecayCount: rt60Values.length,
    qualification: {
      minimumPointCount: 6,
      minimumDynamicRangeDb: 15,
      minimumRSquared: 0.8,
      minimumMonotonicFraction: 0.65,
      minimumNoiseFloorClearanceDb: 6,
      fitDynamicRangeDb: distribution(fitDynamicRanges),
      fitRSquared: distribution(fitRSquared),
      fitMonotonicFraction: distribution(fitMonotonicFractions),
    },
    t20Seconds: distribution(t20Values),
    rt60Seconds: distribution(rt60Values),
    decayDerivedQAtDominantPeak: rt60 && peakHz
      ? Math.PI * peakHz * rt60 / Math.log(1_000)
      : null,
  };
}

function timingSummary(onsets, envelope, activity, spectrum, samples, sampleRate, config) {
  const spacings = [];
  for (let index = 1; index < onsets.length; index += 1) {
    spacings.push(onsets[index].seconds - onsets[index - 1].seconds);
  }
  const eventRegionStartTimes = activity.eventRegions.map((region) => region.startSeconds);
  const eventRegionSpacings = [];
  for (let index = 1; index < eventRegionStartTimes.length; index += 1) {
    eventRegionSpacings.push(eventRegionStartTimes[index] - eventRegionStartTimes[index - 1]);
  }
  const attacks = [];
  const releases = [];
  for (const region of activity.regions) {
    const firstFrame = clamp(Math.round(region.startSample / envelope.hopSize), 0, envelope.rms.length - 1);
    const lastFrame = clamp(Math.round(region.endSample / envelope.hopSize), firstFrame, envelope.rms.length - 1);
    let peakFrame = firstFrame;
    for (let index = firstFrame + 1; index <= lastFrame; index += 1) {
      if (envelope.rms[index] > envelope.rms[peakFrame]) peakFrame = index;
    }
    attacks.push(Math.max(0, envelope.starts[peakFrame] / sampleRate - region.startSeconds));
    releases.push(Math.max(0, region.endSeconds - envelope.starts[peakFrame] / sampleRate));
  }
  const span = onsets.length > 1 ? onsets.at(-1).seconds - onsets[0].seconds : 0;
  const eventSpan = eventRegionStartTimes.length > 1
    ? eventRegionStartTimes.at(-1) - eventRegionStartTimes[0]
    : 0;
  return {
    eventRegionCount: eventRegionStartTimes.length,
    eventRegionStartTimesSeconds: eventRegionStartTimes,
    eventRegionSpacingSeconds: distribution(eventRegionSpacings),
    eventRegionRateHz: eventSpan > 0 ? (eventRegionStartTimes.length - 1) / eventSpan : null,
    // These novelty onsets describe internal amplitude articulation. They are
    // deliberately separate from the macro event-region scheduler above.
    internalModulationOnsetCount: onsets.length,
    internalModulationOnsetTimesSeconds: onsets.map((onset) => onset.seconds),
    internalModulationSpacingSeconds: distribution(spacings),
    internalModulationRateHz: span > 0 ? (onsets.length - 1) / span : null,
    // Backward-compatible aliases; calibration targets never use these names.
    onsetCount: onsets.length,
    onsetTimesSeconds: onsets.map((onset) => onset.seconds),
    onsetSpacingSeconds: distribution(spacings),
    onsetRateHz: span > 0 ? (onsets.length - 1) / span : null,
    attackSeconds: distribution(attacks),
    releaseSeconds: distribution(releases),
    envelopePulse: envelopePulseRate(envelope, config),
    waveformPeriodicity: waveformPeriodicity(samples, sampleRate, activity, config),
    decay: decaySummary(envelope, onsets, spectrum, activity, config),
  };
}

export function mergeAudioAnalysisConfig(overrides = {}) {
  const config = { ...DEFAULT_AUDIO_ANALYSIS_CONFIG, ...overrides };
  config.bands = Array.isArray(overrides.bands)
    ? overrides.bands.map((band) => [finite(band[0]), finite(band[1])])
    : DEFAULT_AUDIO_ANALYSIS_CONFIG.bands.map((band) => [...band]);
  return config;
}

/** Analyze one mono signal. Times in this return value are relative to the signal. */
export function analyzeAudioSamples(samplesInput, sampleRate, overrides = {}) {
  const samples = samplesInput instanceof Float32Array
    ? samplesInput
    : Float32Array.from(samplesInput);
  const config = mergeAudioAnalysisConfig(overrides);
  const level = signalLevel(samples);
  const envelope = frameEnvelope(samples, sampleRate, config);
  const rawActivity = activityFromEnvelope(envelope, samples, sampleRate, config);
  const onsets = detectOnsets(envelope, rawActivity, sampleRate, config);
  const spectrum = spectralSummary(samples, sampleRate, rawActivity, config);
  const timing = timingSummary(onsets, envelope, rawActivity, spectrum, samples, sampleRate, config);
  const activeLevel = rawActivity.regions.length ? signalLevel(samples, rawActivity.regions) : signalLevel(new Float32Array());
  const { mask: _mask, eventMask: _eventMask, ...activity } = rawActivity;
  return {
    durationSeconds: samples.length / sampleRate,
    sampleRate,
    sampleCount: samples.length,
    level,
    activeLevel,
    activity,
    spectrum,
    timing,
  };
}

function normalizeAnnotation(annotation, fallbackLabel = "event") {
  if (!annotation || typeof annotation !== "object") return null;
  const startSeconds = finite(
    annotation.startSeconds ?? annotation.start ?? annotation.beginSeconds ?? annotation.begin
      ?? annotation.start_seconds,
    NaN,
  );
  let endSeconds = finite(
    annotation.endSeconds ?? annotation.end ?? annotation.stopSeconds ?? annotation.stop
      ?? annotation.end_seconds,
    NaN,
  );
  const duration = finite(annotation.durationSeconds ?? annotation.duration, NaN);
  if (!Number.isFinite(endSeconds) && Number.isFinite(duration)) endSeconds = startSeconds + duration;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return null;
  return {
    ...annotation,
    label: String(annotation.label ?? annotation.type ?? annotation.class ?? fallbackLabel),
    startSeconds,
    endSeconds,
  };
}

function parseDelimitedAnnotations(source, delimiter, fallbackLabel) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const values = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === delimiter && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    values.push(value.trim());
    return values;
  };
  const firstRow = parseLine(lines[0]);
  const headerless = Number.isFinite(Number(firstRow[0])) && Number.isFinite(Number(firstRow[1]));
  const headers = headerless
    ? ["startSeconds", "endSeconds", "label"]
    : firstRow.map((header) => header.trim());
  const rows = headerless ? lines : lines.slice(1);
  return rows.map((line) => {
    const values = parseLine(line);
    return normalizeAnnotation(
      Object.fromEntries(headers.map((header, index) => [header, values[index]])),
      fallbackLabel,
    );
  }).filter(Boolean);
}

async function loadAnnotations(specification, baseDirectory, fallbackLabel) {
  if (!specification) return [];
  if (Array.isArray(specification)) {
    return specification.map((annotation) => normalizeAnnotation(annotation, fallbackLabel)).filter(Boolean);
  }
  if (typeof specification === "object" && !specification.path) {
    const list = specification.annotations ?? specification.events ?? [];
    return loadAnnotations(list, baseDirectory, fallbackLabel);
  }
  const relativePath = typeof specification === "string" ? specification : specification.path;
  if (!/\.(?:json|csv|tsv|txt)$/i.test(relativePath)) return [];
  const annotationPath = path.resolve(baseDirectory, relativePath);
  const source = await readFile(annotationPath, "utf8");
  if (annotationPath.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(source);
    return loadAnnotations(parsed.annotations ?? parsed.events ?? parsed, path.dirname(annotationPath), fallbackLabel);
  }
  const delimiter = /\.(?:tsv|txt)$/i.test(annotationPath) ? "\t" : ",";
  return parseDelimitedAnnotations(source, delimiter, fallbackLabel);
}

function retainedMetadata(source = {}) {
  const keys = [
    "sourceFileId",
    "sourceName",
    "sourceUrl",
    "metadataUrl",
    "licenseUrl",
    "doi",
    "title",
    "authors",
    "license",
    "citation",
    "acquisitionNotes",
    "bytes",
    "checksum",
    "checksumAlgorithm",
    "mediaType",
    "sampleRateHz",
    "channels",
    "sampleFormat",
    "durationSeconds",
    "split",
    "sha256",
    "sha1",
    "derivation",
  ];
  const embedded = source.provenance && typeof source.provenance === "object" && !Array.isArray(source.provenance)
    ? source.provenance
    : source.provenance !== undefined ? { provenance: source.provenance } : {};
  return {
    ...embedded,
    ...Object.fromEntries(keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]])),
  };
}

async function resolvedManifestFile(baseDirectory, relativePath) {
  if (path.isAbsolute(relativePath)) return relativePath;
  const candidates = [
    path.resolve(baseDirectory, relativePath),
    path.resolve(process.cwd(), relativePath),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next documented path convention.
    }
  }
  return candidates[0];
}

function manifestFileIsWav(file) {
  const descriptor = typeof file === "string" ? { path: file } : file;
  const mediaType = String(descriptor.mediaType ?? descriptor.type ?? "").toLowerCase();
  return /\.wav$/i.test(descriptor.path ?? "") || /(?:audio\/(?:wav|wave|x-wav)|waveform-audio)/.test(mediaType);
}

function pairedAnnotationDescriptor(files, audioDescriptor) {
  const audioStem = path.basename(audioDescriptor.path, path.extname(audioDescriptor.path)).toLowerCase();
  return files.find((candidate) => {
    if (typeof candidate === "string" || manifestFileIsWav(candidate) || !candidate.path) return false;
    const extension = path.extname(candidate.path).toLowerCase();
    if (![".txt", ".tsv", ".csv", ".json"].includes(extension)) return false;
    return path.basename(candidate.path, extension).toLowerCase() === audioStem;
  });
}

async function entriesFromManifest(manifestPath) {
  const manifestDirectory = path.dirname(manifestPath);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = Array.isArray(parsed) ? { files: parsed } : parsed;
  const topRoot = path.resolve(manifestDirectory, manifest.root ?? ".");
  const datasets = Array.isArray(manifest.datasets)
    ? manifest.datasets
    : [{
      id: manifest.dataset ?? manifest.id ?? path.basename(manifestPath, path.extname(manifestPath)),
      root: ".",
      files: manifest.files ?? [],
      ...retainedMetadata(manifest),
    }];
  const entries = [];
  for (const dataset of datasets) {
    const datasetId = String(dataset.dataset ?? dataset.id ?? "dataset");
    const datasetRoot = path.resolve(topRoot, dataset.root ?? ".");
    const datasetFiles = dataset.files ?? [];
    const audioFiles = datasetFiles.filter(manifestFileIsWav);
    for (let index = 0; index < audioFiles.length; index += 1) {
      const file = audioFiles[index];
      const relativePath = typeof file === "string" ? file : file.path;
      if (!relativePath) continue;
      const descriptor = typeof file === "string" ? { path: file } : file;
      const semanticType = descriptor.type && !String(descriptor.type).includes("/")
        ? descriptor.type
        : null;
      const genericSplits = new Set(["calibration", "training", "validation", "test"]);
      const semanticSplit = descriptor.split && !genericSplits.has(String(descriptor.split).toLowerCase())
        ? descriptor.split
        : null;
      const label = String(
        descriptor.label
          ?? descriptor.soundFamily
          ?? semanticType
          ?? semanticSplit
          ?? dataset.label
          ?? dataset.dataset
          ?? "unlabeled",
      );
      const absolutePath = await resolvedManifestFile(datasetRoot, relativePath);
      let annotationSpecification = descriptor.annotations;
      if (typeof annotationSpecification === "string"
        && !/\.(?:json|csv|tsv|txt)$/i.test(annotationSpecification)) {
        annotationSpecification = null;
      }
      if (typeof annotationSpecification === "string") {
        annotationSpecification = await resolvedManifestFile(datasetRoot, annotationSpecification);
      } else if (annotationSpecification?.path) {
        annotationSpecification = {
          ...annotationSpecification,
          path: await resolvedManifestFile(datasetRoot, annotationSpecification.path),
        };
      }
      const companion = annotationSpecification ? null : pairedAnnotationDescriptor(datasetFiles, descriptor);
      if (companion?.path) annotationSpecification = await resolvedManifestFile(datasetRoot, companion.path);
      const annotations = await loadAnnotations(annotationSpecification, datasetRoot, label);
      entries.push({
        absolutePath,
        path: String(relativePath),
        id: String(descriptor.id ?? descriptor.sourceFileId ?? `${datasetId}-${index + 1}`),
        datasetId,
        label,
        startSeconds: Math.max(0, finite(descriptor.startSeconds, 0)),
        endSeconds: descriptor.endSeconds !== null
          && descriptor.endSeconds !== undefined
          && Number.isFinite(Number(descriptor.endSeconds))
          ? Number(descriptor.endSeconds)
          : null,
        annotations,
        provenance: {
          ...retainedMetadata(manifest),
          ...retainedMetadata(dataset),
          ...retainedMetadata(descriptor),
          mediaType: descriptor.mediaType ?? descriptor.type,
          annotationDescription: typeof descriptor.annotations === "string"
            && !/\.(?:json|csv|tsv|txt)$/i.test(descriptor.annotations)
            ? descriptor.annotations
            : undefined,
          annotationSource: companion?.path,
        },
      });
    }
  }
  return {
    entries,
    manifest: {
      path: path.relative(process.cwd(), manifestPath) || path.basename(manifestPath),
      generatedAt: manifest.generatedAt,
      sizeCapBytes: manifest.sizeCapBytes,
    },
  };
}

async function wavFilesInDirectory(directory) {
  const results = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((a, b) => compareText(a.name, b.name));
  for (const child of children) {
    const childPath = path.join(directory, child.name);
    if (child.isDirectory()) results.push(...await wavFilesInDirectory(childPath));
    else if (child.isFile() && /\.wav$/i.test(child.name)) results.push(childPath);
  }
  return results;
}

/** Expand WAV paths, directories, and JSON manifests into normalized file entries. */
export async function collectAudioEntries(inputs) {
  const entries = [];
  const manifests = [];
  for (const input of inputs) {
    const absolute = path.resolve(input);
    if (/\.json$/i.test(absolute)) {
      const expanded = await entriesFromManifest(absolute);
      entries.push(...expanded.entries);
      manifests.push(expanded.manifest);
      continue;
    }
    if (/\.wav$/i.test(absolute)) {
      entries.push({
        absolutePath: absolute,
        path: path.relative(process.cwd(), absolute) || path.basename(absolute),
        id: path.basename(absolute, path.extname(absolute)),
        datasetId: path.basename(path.dirname(absolute)),
        label: "unlabeled",
        startSeconds: 0,
        endSeconds: null,
        annotations: [],
        provenance: {},
      });
      continue;
    }
    const files = await wavFilesInDirectory(absolute);
    for (const filePath of files) {
      entries.push({
        absolutePath: filePath,
        path: path.relative(process.cwd(), filePath),
        id: path.basename(filePath, path.extname(filePath)),
        datasetId: path.basename(absolute),
        label: "unlabeled",
        startSeconds: 0,
        endSeconds: null,
        annotations: [],
        provenance: {},
      });
    }
  }
  entries.sort((a, b) => compareText(
    `${a.datasetId}/${a.path}/${a.startSeconds}`,
    `${b.datasetId}/${b.path}/${b.startSeconds}`,
  ));
  return { entries, manifests };
}

function shiftRegionTimes(features, offsetSeconds) {
  return {
    ...features,
    activity: {
      ...features.activity,
      regions: features.activity.regions.map((region) => ({
        ...region,
        startSeconds: region.startSeconds + offsetSeconds,
        endSeconds: region.endSeconds + offsetSeconds,
      })),
      eventRegions: features.activity.eventRegions.map((region) => ({
        ...region,
        startSeconds: region.startSeconds + offsetSeconds,
        endSeconds: region.endSeconds + offsetSeconds,
      })),
    },
    timing: {
      ...features.timing,
      eventRegionStartTimesSeconds: features.timing.eventRegionStartTimesSeconds
        .map((time) => time + offsetSeconds),
      internalModulationOnsetTimesSeconds: features.timing.internalModulationOnsetTimesSeconds
        .map((time) => time + offsetSeconds),
      onsetTimesSeconds: features.timing.onsetTimesSeconds.map((time) => time + offsetSeconds),
    },
  };
}

export async function analyzeWavEntry(entry, overrides = {}) {
  const config = mergeAudioAnalysisConfig(overrides);
  const bytes = await readFile(entry.absolutePath);
  let decoded;
  let decoder = "native";
  try {
    decoded = decodeWav(bytes, {
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds ?? undefined,
    });
  } catch (nativeError) {
    if (!/Unsupported WAVE format/.test(nativeError.message)) throw nativeError;
    decoder = "ffmpeg";
    let stdout;
    try {
      ({ stdout } = await execFileAsync("ffmpeg", [
        "-v", "error",
        "-i", entry.absolutePath,
        "-map", "0:a:0",
        "-ac", "1",
        "-c:a", "pcm_f32le",
        "-f", "wav",
        "pipe:1",
      ], {
        encoding: null,
        maxBuffer: 512 * 1024 * 1024,
      }));
    } catch (ffmpegError) {
      throw new Error(
        `${nativeError.message} Install ffmpeg to analyze compressed WAVE files. ${ffmpegError.message}`,
      );
    }
    decoded = decodeWav(stdout, {
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds ?? undefined,
    });
  }
  const analysisSampleRate = Math.max(4_000, config.analysisSampleRate);
  const samples = decoded.sampleRate === analysisSampleRate
    ? decoded.samples
    : resampleMono(decoded.samples, decoded.sampleRate, analysisSampleRate);
  const absoluteOffset = decoded.selectedStartSeconds;
  const featureConfig = { ...config, sourceNyquistHz: decoded.sampleRate * 0.5 };
  const features = shiftRegionTimes(analyzeAudioSamples(samples, analysisSampleRate, featureConfig), absoluteOffset);
  const applicableAnnotations = (entry.annotations ?? []).filter((annotation) => (
    annotation.endSeconds > decoded.selectedStartSeconds
    && annotation.startSeconds < decoded.selectedEndSeconds
  ));
  const events = [];
  if (applicableAnnotations.length) {
    for (let index = 0; index < applicableAnnotations.length; index += 1) {
      const annotation = applicableAnnotations[index];
      const startSeconds = Math.max(decoded.selectedStartSeconds, annotation.startSeconds);
      const endSeconds = Math.min(decoded.selectedEndSeconds, annotation.endSeconds);
      const startSample = Math.floor((startSeconds - absoluteOffset) * analysisSampleRate);
      const endSample = Math.ceil((endSeconds - absoluteOffset) * analysisSampleRate);
      const eventSamples = samples.subarray(clamp(startSample, 0, samples.length), clamp(endSample, 0, samples.length));
      events.push({
        index,
        source: "annotation",
        label: annotation.label,
        startSeconds,
        endSeconds,
        annotation: Object.fromEntries(Object.entries(annotation).filter(([key]) => ![
          "start", "end", "begin", "stop", "startSeconds", "endSeconds", "duration", "durationSeconds", "label",
        ].includes(key))),
        features: shiftRegionTimes(analyzeAudioSamples(eventSamples, analysisSampleRate, featureConfig), startSeconds),
      });
    }
  } else {
    for (let index = 0; index < features.activity.eventRegions.length; index += 1) {
      const region = features.activity.eventRegions[index];
      const startSample = Math.floor((region.startSeconds - absoluteOffset) * analysisSampleRate);
      const endSample = Math.ceil((region.endSeconds - absoluteOffset) * analysisSampleRate);
      const eventSamples = samples.subarray(clamp(startSample, 0, samples.length), clamp(endSample, 0, samples.length));
      events.push({
        index,
        source: "detected",
        label: entry.label,
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
        features: shiftRegionTimes(analyzeAudioSamples(eventSamples, analysisSampleRate, featureConfig), region.startSeconds),
      });
    }
  }
  return {
    id: entry.id,
    datasetId: entry.datasetId,
    label: entry.label,
    path: entry.path,
    provenance: entry.provenance,
    selection: {
      startSeconds: decoded.selectedStartSeconds,
      endSeconds: decoded.selectedEndSeconds,
    },
    sourceAudio: {
      sampleRate: finite(entry.provenance.sampleRateHz, decoded.sampleRate),
      channels: finite(entry.provenance.channels, decoded.sourceChannels),
      bitsPerSample: decoder === "native" ? decoded.bitsPerSample : null,
      encoding: entry.provenance.sampleFormat ?? decoded.format,
      durationSeconds: finite(entry.provenance.durationSeconds, decoded.sourceDurationSeconds),
    },
    analysisDecode: {
      decoder,
      sampleRate: decoded.sampleRate,
      channels: decoded.sourceChannels,
      bitsPerSample: decoded.bitsPerSample,
      encoding: decoded.format,
    },
    features,
    events,
  };
}

function metricValues(records, accessor) {
  return records.map(accessor).filter(Number.isFinite);
}

function groupedStatistics(files) {
  const buckets = new Map();
  const add = (unit, datasetId, label, record) => {
    const key = `${unit}\u0000${datasetId}\u0000${label}`;
    if (!buckets.has(key)) buckets.set(key, { unit, datasetId, label, records: [] });
    buckets.get(key).records.push(record);
  };
  for (const file of files) {
    add("file", file.datasetId, file.label, file.features);
    for (const event of file.events) add("event", file.datasetId, event.label, event.features);
  }
  return [...buckets.values()]
    .sort((a, b) => compareText(
      `${a.unit}/${a.datasetId}/${a.label}`,
      `${b.unit}/${b.datasetId}/${b.label}`,
    ))
    .map((bucket) => ({
      unit: bucket.unit,
      datasetId: bucket.datasetId,
      label: bucket.label,
      count: bucket.records.length,
      durationSeconds: distribution(metricValues(bucket.records, (record) => record.durationSeconds)),
      activeSeconds: distribution(metricValues(bucket.records, (record) => record.activity.activeSeconds)),
      rmsDbfs: distribution(metricValues(bucket.records, (record) => record.level.rmsDbfs)),
      activeRmsDbfs: distribution(metricValues(bucket.records, (record) => record.activeLevel.rmsDbfs)),
      peakHz: distribution(metricValues(bucket.records, (record) => record.spectrum.peakHz)),
      centroidHz: distribution(metricValues(bucket.records, (record) => record.spectrum.centroidHz)),
      rolloff85Hz: distribution(metricValues(bucket.records, (record) => record.spectrum.rolloff85Hz)),
      spectralSharpnessQ: distribution(metricValues(
        bucket.records,
        (record) => record.spectrum.dominantPeaks[0]?.spectralSharpnessQ,
      )),
      eventRegionCount: distribution(metricValues(bucket.records, (record) => record.timing.eventRegionCount)),
      eventRegionRateHz: distribution(metricValues(bucket.records, (record) => record.timing.eventRegionRateHz)),
      eventRegionSpacingSeconds: distribution(metricValues(
        bucket.records,
        (record) => record.timing.eventRegionSpacingSeconds?.median,
      )),
      internalModulationRateHz: distribution(metricValues(
        bucket.records,
        (record) => record.timing.internalModulationRateHz,
      )),
      internalModulationSpacingSeconds: distribution(metricValues(
        bucket.records,
        (record) => record.timing.internalModulationSpacingSeconds?.median,
      )),
      // Legacy grouped aliases retained for existing report readers.
      onsetRateHz: distribution(metricValues(bucket.records, (record) => record.timing.onsetRateHz)),
      onsetSpacingSeconds: distribution(metricValues(bucket.records, (record) => record.timing.onsetSpacingSeconds?.median)),
      attackSeconds: distribution(metricValues(bucket.records, (record) => record.timing.attackSeconds?.median)),
      releaseSeconds: distribution(metricValues(bucket.records, (record) => record.timing.releaseSeconds?.median)),
      pulseRateHz: distribution(metricValues(bucket.records, (record) => record.timing.envelopePulse.frequencyHz)),
      periodicityHz: distribution(metricValues(bucket.records, (record) => record.timing.waveformPeriodicity.frequencyHz?.median)),
      decayRt60Seconds: distribution(metricValues(bucket.records, (record) => record.timing.decay.rt60Seconds?.median)),
      bandEnergyFractions: Object.fromEntries(configuredBandKeys(bucket.records).map(({ key, lowHz, highHz }) => [
        key,
        distribution(metricValues(bucket.records, (record) => (
          record.spectrum.bands.find((band) => (
            band.lowHz === lowHz && band.highHz === highHz && band.complete
          ))?.fraction
        ))),
      ])),
    }));
}

function configuredBandKeys(records) {
  const bands = records.find((record) => record.spectrum.bands.length)?.spectrum.bands ?? [];
  return bands.map((band) => ({
    key: `${band.lowHz}-${band.highHz}Hz`,
    lowHz: band.lowHz,
    highHz: band.highHz,
  }));
}

function rounded(value) {
  if (!Number.isFinite(value)) return value === null ? null : value;
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const digits = clamp(6 - magnitude - 1, 0, 9);
  return Number(value.toFixed(digits));
}

function roundDeep(value) {
  if (typeof value === "number") return rounded(value);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, roundDeep(child)]));
  }
  return value;
}

/** Analyze normalized entries sequentially so large datasets do not remain in memory. */
export async function analyzeAudioEntries(entries, overrides = {}, metadata = {}) {
  const config = mergeAudioAnalysisConfig(overrides);
  const files = [];
  for (const entry of entries) files.push(await analyzeWavEntry(entry, config));
  return roundDeep({
    schemaVersion: AUDIO_ANALYSIS_SCHEMA_VERSION,
    tool: "morphazoid-audio-analysis",
    config,
    inputs: metadata,
    files,
    groups: groupedStatistics(files),
  });
}

function compactTargetRange(summary) {
  if (!summary || !Number.isFinite(summary.median)) return null;
  if (summary.count === 1) {
    return {
      kind: "single-reference-anchor",
      count: 1,
      // Keep the common low/center/high shape for runtime consumers. Equal
      // bounds are an explicit anchor, not an inferred population range.
      low: summary.median,
      center: summary.median,
      high: summary.median,
    };
  }
  return {
    kind: "empirical-distribution",
    count: summary.count,
    outerLow: summary.p10,
    low: summary.q1,
    center: summary.median,
    high: summary.q3,
    outerHigh: summary.p90,
  };
}

function markDetectorBoundary(range, minimum, maximum) {
  if (!range || !Number.isFinite(range.center)) return range;
  if (Number.isFinite(minimum) && range.center <= minimum * 1.001) {
    return { ...range, detectorBoundary: "lower" };
  }
  if (Number.isFinite(maximum) && range.center >= maximum * 0.999) {
    return { ...range, detectorBoundary: "upper" };
  }
  return range;
}

/**
 * Convert selected grouped distributions into compact, UI-safe target ranges.
 * Absolute level fields are intentionally unavailable here because independently
 * mastered/captured datasets cannot be compared in dBFS without calibration.
 */
export function buildAudioCalibrationTargets(report, mapping) {
  if (!report || !Array.isArray(report.groups)) throw new Error("Analysis report has no groups array.");
  if (!mapping || !Array.isArray(mapping.profiles)) throw new Error("Calibration mapping has no profiles array.");
  const profiles = {};
  for (const definition of mapping.profiles) {
    if (!definition.id || !definition.selector) throw new Error("Every calibration profile needs an id and selector.");
    const selector = definition.selector;
    const group = report.groups.find((candidate) => (
      candidate.unit === selector.unit
      && candidate.datasetId === selector.datasetId
      && candidate.label === selector.label
    ));
    if (!group) {
      if (definition.optional) continue;
      throw new Error(
        `No analysis group matches ${selector.unit}/${selector.datasetId}/${selector.label}.`,
      );
    }
    const include = new Set(definition.include ?? ["timing", "spectrum", "bands"]);
    const profile = {
      id: definition.id,
      title: definition.title ?? definition.id,
      suggestedVoices: definition.suggestedVoices ?? [],
      transfer: definition.transfer ?? "direct-descriptor",
      notes: definition.notes,
      source: {
        unit: group.unit,
        datasetId: group.datasetId,
        label: group.label,
        count: group.count,
        confidence: group.count === 1
          ? "single-reference-anchor"
          : group.count < 10 ? "small-sample" : "empirical-distribution",
      },
    };
    if (include.has("timing")) {
      const internalModulationSpacing = compactTargetRange(group.internalModulationSpacingSeconds);
      profile.timing = {
        durationSeconds: compactTargetRange(group.durationSeconds),
        activeSeconds: compactTargetRange(group.activeSeconds),
        macroEventCount: compactTargetRange(group.eventRegionCount),
        macroEventRateHz: compactTargetRange(group.eventRegionRateHz),
        macroEventSpacingSeconds: compactTargetRange(group.eventRegionSpacingSeconds),
        internalModulationRateHz: compactTargetRange(group.internalModulationRateHz),
        internalModulationSpacingSeconds: internalModulationSpacing,
        // Stable report alias used by the existing reference panel. Macro
        // scheduling must use macroEventSpacingSeconds instead.
        onsetSpacingSeconds: internalModulationSpacing,
        envelopePulseRateHz: markDetectorBoundary(
          compactTargetRange(group.pulseRateHz),
          report.config?.envelopePulseMinHz,
          report.config?.envelopePulseMaxHz,
        ),
        attackSeconds: compactTargetRange(group.attackSeconds),
        releaseSeconds: compactTargetRange(group.releaseSeconds),
        decayRt60Seconds: compactTargetRange(group.decayRt60Seconds),
      };
    }
    if (include.has("spectrum")) {
      profile.spectrum = {
        dominantHz: compactTargetRange(group.peakHz),
        centroidHz: compactTargetRange(group.centroidHz),
        rolloff85Hz: compactTargetRange(group.rolloff85Hz),
        periodicityHz: markDetectorBoundary(
          compactTargetRange(group.periodicityHz),
          report.config?.audiblePeriodicityMinHz,
          report.config?.audiblePeriodicityMaxHz,
        ),
        spectralSharpnessQ: compactTargetRange(group.spectralSharpnessQ),
      };
    }
    if (include.has("bands")) {
      const marginalRanges = Object.fromEntries(Object.entries(group.bandEnergyFractions ?? {})
        .map(([band, summary]) => [band, compactTargetRange(summary)])
        .filter(([, range]) => range));
      const centerTotal = Object.values(marginalRanges)
        .reduce((sum, range) => sum + range.center, 0);
      profile.bandEnergyShares = {
        representativeNormalized: Object.fromEntries(Object.entries(marginalRanges)
          .map(([band, range]) => [band, centerTotal > 0 ? range.center / centerTotal : null])),
        empiricalMarginalRanges: marginalRanges,
      };
    }
    profiles[definition.id] = profile;
  }
  return roundDeep({
    schemaVersion: 1,
    tool: "morphazoid-audio-calibration-targets",
    sourceAnalysis: mapping.sourceAnalysis ?? "audio-analysis.json",
    excludes: ["rmsDbfs", "activeRmsDbfs", "peakDbfs"],
    caveat: "Timing and normalized spectral shape are descriptive targets. Single references are anchors, detector-boundary values are censored, and absolute loudness is excluded because capture chains and mastering differ across datasets.",
    profiles,
    coverage: mapping.coverage ?? {},
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function bandFraction(features, lowHz, highHz) {
  const band = features.spectrum.bands.find((candidate) => (
    candidate.lowHz === lowHz && candidate.highHz === highHz
  ));
  return band?.complete ? band.fraction : null;
}

const CSV_METRICS = Object.freeze([
  ["duration_seconds", (features) => features.durationSeconds],
  ["active_seconds", (features) => features.activity.activeSeconds],
  ["active_ratio", (features) => features.activity.activeRatio],
  ["rms_dbfs", (features) => features.level.rmsDbfs],
  ["active_rms_dbfs", (features) => features.activeLevel.rmsDbfs],
  ["peak_dbfs", (features) => features.level.peakDbfs],
  ["crest_factor_db", (features) => features.level.crestFactorDb],
  ["activity_threshold_dbfs", (features) => features.activity.thresholdDbfs],
  ["macro_event_count", (features) => features.timing.eventRegionCount],
  ["macro_event_rate_hz", (features) => features.timing.eventRegionRateHz],
  ["median_macro_event_spacing_seconds", (features) => features.timing.eventRegionSpacingSeconds?.median],
  ["internal_modulation_onset_count", (features) => features.timing.internalModulationOnsetCount],
  ["internal_modulation_rate_hz", (features) => features.timing.internalModulationRateHz],
  ["median_internal_modulation_spacing_seconds", (features) => (
    features.timing.internalModulationSpacingSeconds?.median
  )],
  ["pulse_rate_hz", (features) => features.timing.envelopePulse.frequencyHz],
  ["pulse_strength", (features) => features.timing.envelopePulse.strength],
  ["periodicity_hz", (features) => features.timing.waveformPeriodicity.frequencyHz?.median],
  ["periodicity_strength", (features) => features.timing.waveformPeriodicity.medianStrength],
  ["periodicity_cv", (features) => features.timing.waveformPeriodicity.coefficientOfVariation],
  ["spectral_peak_hz", (features) => features.spectrum.peakHz],
  ["spectral_centroid_hz", (features) => features.spectrum.centroidHz],
  ["rolloff_85_hz", (features) => features.spectrum.rolloff85Hz],
  ["spectral_flatness", (features) => features.spectrum.flatness],
  ["spectral_sharpness_q", (features) => features.spectrum.dominantPeaks[0]?.spectralSharpnessQ],
  ["decay_t20_seconds", (features) => features.timing.decay.t20Seconds?.median],
  ["decay_rt60_seconds", (features) => features.timing.decay.rt60Seconds?.median],
  ["decay_derived_q", (features) => features.timing.decay.decayDerivedQAtDominantPeak],
  ["energy_20_80", (features) => bandFraction(features, 20, 80)],
  ["energy_80_150", (features) => bandFraction(features, 80, 150)],
  ["energy_150_500", (features) => bandFraction(features, 150, 500)],
  ["energy_500_1500", (features) => bandFraction(features, 500, 1_500)],
  ["energy_1500_3000", (features) => bandFraction(features, 1_500, 3_000)],
  ["energy_3000_8000", (features) => bandFraction(features, 3_000, 8_000)],
]);

function csvTable(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function filesToCsv(report) {
  const headers = [
    "dataset_id", "file_id", "label", "path", "source_url", "doi", "license", "license_url",
    "selection_start_seconds", "selection_end_seconds", "source_sample_rate", "source_channels",
    ...CSV_METRICS.map(([name]) => name),
  ];
  const rows = report.files.map((file) => [
    file.datasetId,
    file.id,
    file.label,
    file.path,
    file.provenance.sourceUrl,
    file.provenance.doi,
    typeof file.provenance.license === "object"
      ? file.provenance.license.name
      : file.provenance.license,
    typeof file.provenance.license === "object"
      ? file.provenance.license.url
      : file.provenance.licenseUrl,
    file.selection.startSeconds,
    file.selection.endSeconds,
    file.sourceAudio.sampleRate,
    file.sourceAudio.channels,
    ...CSV_METRICS.map(([, accessor]) => accessor(file.features)),
  ]);
  return csvTable(headers, rows);
}

export function eventsToCsv(report) {
  const headers = [
    "dataset_id", "file_id", "file_label", "event_index", "event_source", "event_label",
    "start_seconds", "end_seconds", ...CSV_METRICS.map(([name]) => name),
  ];
  const rows = [];
  for (const file of report.files) {
    for (const event of file.events) {
      rows.push([
        file.datasetId,
        file.id,
        file.label,
        event.index,
        event.source,
        event.label,
        event.startSeconds,
        event.endSeconds,
        ...CSV_METRICS.map(([, accessor]) => accessor(event.features)),
      ]);
    }
  }
  return csvTable(headers, rows);
}
