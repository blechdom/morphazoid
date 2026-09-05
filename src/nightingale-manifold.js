import { fft } from "./recursion-spectral-dsp.js";

const TWO_PI = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 576_000;
const DEFAULT_MAX_DURATION_SECONDS = 45;
const DEFAULT_TARGET_ANALYSIS_RATE = 24_000;
const DEFAULT_FFT_SIZE = 512;
const DEFAULT_HOP_SIZE = 256;
const MEL_BAND_COUNT = 24;
const MFCC_COUNT = 12;
const MIN_SPECTRAL_HZ = 250;
const MAX_SPECTRAL_HZ = 11_000;

const FRAME_FEATURE_NAMES = Object.freeze([
  ...Array.from({ length: MFCC_COUNT }, (_, index) => `mfcc-${index + 1}`),
  "log-energy",
  "spectral-centroid",
  "spectral-bandwidth",
  "spectral-rolloff-85",
  "spectral-flatness",
  "spectral-flux",
  "zero-crossing-rate",
]);

const STROPHE_DESCRIPTOR_NAMES = Object.freeze([
  "log-duration",
  "log-onset-rate",
  "rhythm-variation",
  "mean-spectral-centroid",
  "mean-spectral-bandwidth",
  "mean-spectral-flatness",
  "mean-spectral-flux",
  "trajectory-span",
  "fine-envelope-modulation",
  "fine-envelope-variation",
  "mid-envelope-modulation",
  "mid-envelope-variation",
  "broad-envelope-modulation",
  "broad-envelope-variation",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function quantile(values, amount) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(amount) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values) {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += finite(value);
  return total / values.length;
}

function standardDeviation(values, center = mean(values)) {
  if (values.length < 2) return 0;
  let total = 0;
  for (const value of values) total += (finite(value) - center) ** 2;
  return Math.sqrt(total / values.length);
}

function samplePeak(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(finite(samples[index])));
  }
  return peak;
}

function powerOfTwoSize(value, fallback = DEFAULT_FFT_SIZE) {
  const requested = clamp(Math.round(finite(value, fallback)), 64, 4_096);
  return 2 ** Math.round(Math.log2(requested));
}

function downsampleAndCenter(samples, sampleRate, sampleCount, targetAnalysisRate) {
  const targetRate = clamp(
    finite(targetAnalysisRate, DEFAULT_TARGET_ANALYSIS_RATE),
    MIN_SAMPLE_RATE,
    MAX_SAMPLE_RATE,
  );
  const downsampleRatio = Math.max(1, sampleRate / targetRate);
  const analysisRate = sampleRate / downsampleRatio;
  const outputCount = Math.floor(sampleCount / downsampleRatio);
  const output = new Float32Array(outputCount);
  let globalMean = 0;
  for (let index = 0; index < sampleCount; index += 1) globalMean += finite(samples[index]);
  globalMean /= Math.max(1, sampleCount);
  let inputPeak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    inputPeak = Math.max(inputPeak, Math.abs(finite(samples[index]) - globalMean));
  }
  if (downsampleRatio === 1) {
    for (let index = 0; index < outputCount; index += 1) {
      output[index] = finite(samples[index]) - globalMean;
    }
  } else {
    // Polyphase windowed-sinc low-pass resampling keeps the requested frame
    // geometry for non-integer source/analysis-rate ratios without aliasing.
    const halfWidth = Math.min(64, Math.max(12, Math.ceil(downsampleRatio * 8)));
    const cutoff = 0.46 / downsampleRatio;
    const phaseCount = 256;
    const kernelLength = halfWidth * 2 + 1;
    const kernels = Array.from({ length: phaseCount }, (_, phaseIndex) => {
      const fractional = phaseIndex / phaseCount;
      const kernel = new Float64Array(kernelLength);
      let kernelSum = 0;
      for (let tap = -halfWidth; tap <= halfWidth; tap += 1) {
        const distance = tap - fractional;
        const position = tap + halfWidth;
        const sinc = Math.abs(distance) < 1e-12
          ? 2 * cutoff
          : Math.sin(TWO_PI * cutoff * distance) / (Math.PI * distance);
        const windowPhase = position / Math.max(1, kernelLength - 1);
        const blackman = 0.42
          - 0.5 * Math.cos(TWO_PI * windowPhase)
          + 0.08 * Math.cos(2 * TWO_PI * windowPhase);
        kernel[position] = sinc * blackman;
        kernelSum += kernel[position];
      }
      for (let index = 0; index < kernel.length; index += 1) kernel[index] /= kernelSum;
      return kernel;
    });
    for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
      const sourcePosition = outputIndex * downsampleRatio;
      const center = Math.floor(sourcePosition);
      const phaseIndex = Math.min(
        phaseCount - 1,
        Math.round((sourcePosition - center) * (phaseCount - 1)),
      );
      const kernel = kernels[phaseIndex];
      let sum = 0;
      let weightSum = 0;
      for (let tap = -halfWidth; tap <= halfWidth; tap += 1) {
        const sourceIndex = center + tap;
        if (sourceIndex < 0 || sourceIndex >= sampleCount) continue;
        const weight = kernel[tap + halfWidth];
        sum += (finite(samples[sourceIndex]) - globalMean) * weight;
        weightSum += weight;
      }
      output[outputIndex] = sum / Math.max(1e-12, weightSum);
    }
  }
  if (inputPeak > 1e-9) {
    for (let index = 0; index < output.length; index += 1) output[index] /= inputPeak;
  }
  const peak = samplePeak(output);
  return {
    samples: output,
    sampleRate: analysisRate,
    stride: downsampleRatio,
    downsampleRatio,
    sourcePeak: peak,
    resampling: downsampleRatio === 1 ? "none" : "polyphase-windowed-sinc",
  };
}

function melFrequency(hertz) {
  return 2_595 * Math.log10(1 + Math.max(0, hertz) / 700);
}

function melFilterMap(sampleRate, minimumSpectralHz, maximumSpectralHz, fftSize) {
  const maximumHz = Math.min(maximumSpectralHz, sampleRate * 0.48);
  const minimumHz = Math.min(
    minimumSpectralHz,
    Math.max(1, maximumHz - sampleRate / fftSize),
  );
  const minimumMel = melFrequency(minimumHz);
  const maximumMel = melFrequency(maximumHz);
  const binHz = sampleRate / fftSize;
  const bins = [];
  for (let bin = 1; bin <= fftSize / 2; bin += 1) {
    const frequencyHz = bin * binHz;
    if (frequencyHz < minimumHz || frequencyHz > maximumHz) continue;
    const position = (melFrequency(frequencyHz) - minimumMel)
      / Math.max(1e-9, maximumMel - minimumMel)
      * (MEL_BAND_COUNT - 1);
    const left = clamp(Math.floor(position), 0, MEL_BAND_COUNT - 1);
    const right = Math.min(MEL_BAND_COUNT - 1, left + 1);
    bins.push(Object.freeze({
      bin,
      frequencyHz,
      left,
      right,
      rightWeight: position - left,
    }));
  }
  return Object.freeze(bins);
}

function frameSpectrum(samples, start, sampleRate, filterMap, previousDistribution, fftSize) {
  const windowed = new Float64Array(fftSize);
  let square = 0;
  let crossings = 0;
  let previousSample = 0;
  for (let index = 0; index < fftSize; index += 1) {
    const sample = finite(samples[start + index]);
    const window = 0.5 - 0.5 * Math.cos(TWO_PI * index / Math.max(1, fftSize - 1));
    windowed[index] = sample * window;
    square += sample * sample;
    if (index && (sample >= 0) !== (previousSample >= 0)) crossings += 1;
    previousSample = sample;
  }
  const transformed = fft(windowed);
  const powers = new Float64Array(fftSize / 2 + 1);
  let totalPower = 0;
  let weightedFrequency = 0;
  let peakPower = 0;
  let peakHz = 0;
  for (const mapped of filterMap) {
    const power = transformed.real[mapped.bin] ** 2 + transformed.imaginary[mapped.bin] ** 2;
    powers[mapped.bin] = power;
    totalPower += power;
    weightedFrequency += power * mapped.frequencyHz;
    if (power > peakPower) {
      peakPower = power;
      peakHz = mapped.frequencyHz;
    }
  }
  const centroidHz = weightedFrequency / Math.max(1e-20, totalPower);
  let spread = 0;
  let cumulative = 0;
  let rolloffHz = 0;
  let logPowerSum = 0;
  let powerCount = 0;
  for (const mapped of filterMap) {
    const power = powers[mapped.bin];
    spread += power * (mapped.frequencyHz - centroidHz) ** 2;
    cumulative += power;
    if (!rolloffHz && cumulative >= totalPower * 0.85) rolloffHz = mapped.frequencyHz;
    logPowerSum += Math.log(Math.max(1e-20, power));
    powerCount += 1;
  }
  const bandwidthHz = Math.sqrt(spread / Math.max(1e-20, totalPower));
  const flatness = Math.exp(logPowerSum / Math.max(1, powerCount))
    / Math.max(1e-20, totalPower / Math.max(1, powerCount));

  const melBands = new Float64Array(MEL_BAND_COUNT);
  for (const mapped of filterMap) {
    const power = powers[mapped.bin];
    melBands[mapped.left] += power * (1 - mapped.rightWeight);
    melBands[mapped.right] += power * mapped.rightWeight;
  }
  const distribution = new Float64Array(MEL_BAND_COUNT);
  let melTotal = 0;
  for (const value of melBands) melTotal += value;
  for (let index = 0; index < melBands.length; index += 1) {
    distribution[index] = Math.sqrt(melBands[index] / Math.max(1e-20, melTotal));
  }
  let fluxSquare = 0;
  if (previousDistribution) {
    for (let index = 0; index < distribution.length; index += 1) {
      fluxSquare += (distribution[index] - previousDistribution[index]) ** 2;
    }
  }
  const spectralFlux = Math.sqrt(fluxSquare / MEL_BAND_COUNT);

  const logMel = Array.from(melBands, (value) => Math.log(Math.max(1e-18, value)));
  const mfcc = new Array(MFCC_COUNT).fill(0);
  for (let coefficient = 0; coefficient < MFCC_COUNT; coefficient += 1) {
    for (let band = 0; band < MEL_BAND_COUNT; band += 1) {
      mfcc[coefficient] += logMel[band]
        * Math.cos(Math.PI * coefficient * (band + 0.5) / MEL_BAND_COUNT);
    }
    mfcc[coefficient] /= MEL_BAND_COUNT;
  }

  const rms = Math.sqrt(square / fftSize);
  const nyquist = sampleRate * 0.5;
  const vector = [
    ...mfcc,
    Math.log10(rms + 1e-7),
    centroidHz / nyquist,
    bandwidthHz / nyquist,
    rolloffHz / nyquist,
    clamp(flatness),
    spectralFlux,
    crossings / Math.max(1, fftSize - 1),
  ];
  return {
    rms,
    centroidHz,
    bandwidthHz,
    rolloffHz,
    flatness: clamp(flatness),
    spectralFlux,
    zeroCrossingRate: crossings / Math.max(1, fftSize - 1),
    peakHz,
    vector,
    distribution,
  };
}

function activityMask(frames) {
  const levels = frames.map((frame) => frame.rms);
  const noiseFloor = quantile(levels, 0.18);
  const peakLevel = levels.reduce((maximum, level) => Math.max(maximum, level), 0);
  // A high quantile alone misses sparse clicks and short ultrasonic syllables
  // when they occupy less than eight percent of the recording.
  const strongLevel = Math.max(quantile(levels, 0.92), peakLevel * 0.75);
  if (peakLevel < 1e-6) {
    return { noiseFloor, strongLevel, onThreshold: Infinity, offThreshold: Infinity };
  }
  const span = Math.max(1e-8, strongLevel - noiseFloor);
  const nearlyStationary = strongLevel - noiseFloor < peakLevel * 0.015;
  const onThreshold = nearlyStationary
    ? peakLevel * 0.2
    : Math.max(strongLevel * 0.055, noiseFloor + span * 0.16);
  const offThreshold = nearlyStationary
    ? peakLevel * 0.1
    : Math.max(strongLevel * 0.035, noiseFloor + span * 0.085);
  let active = false;
  for (const frame of frames) {
    if (!active && frame.rms >= onThreshold) active = true;
    else if (active && frame.rms <= offThreshold) active = false;
    frame.active = active;
  }
  return { noiseFloor, strongLevel, onThreshold, offThreshold };
}

function activeFrameRuns(frames) {
  const runs = [];
  let startFrame = -1;
  let lastActive = -1;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].active) {
      if (startFrame < 0) startFrame = index;
      lastActive = index;
      continue;
    }
    if (startFrame >= 0) {
      runs.push(Object.freeze({ startFrame, endFrame: lastActive }));
      startFrame = -1;
      lastActive = -1;
    }
  }
  if (startFrame >= 0) runs.push(Object.freeze({ startFrame, endFrame: lastActive }));
  return Object.freeze(runs);
}

function segmentStrophes(frames, hopSeconds, durationSeconds, options, fftSize, hopSize) {
  const minimumGapLimitSeconds = clamp(
    finite(options.minimumGapLimitSeconds, 0.08),
    0.0001,
    5,
  );
  const maximumGapLimitSeconds = clamp(
    finite(options.maximumGapLimitSeconds, 1.5),
    minimumGapLimitSeconds,
    8,
  );
  const minimumDurationLimitSeconds = clamp(
    finite(options.minimumDurationLimitSeconds, 0.06),
    0.0001,
    20,
  );
  const maximumDurationLimitSeconds = clamp(
    finite(options.maximumDurationLimitSeconds, 2),
    minimumDurationLimitSeconds,
    30,
  );
  const mergeGapSeconds = clamp(
    finite(options.stropheGapSeconds, 0.8),
    minimumGapLimitSeconds,
    maximumGapLimitSeconds,
  );
  const minimumDurationSeconds = clamp(
    finite(options.minimumStropheSeconds, 0.5),
    minimumDurationLimitSeconds,
    maximumDurationLimitSeconds,
  );
  const fixedWindowSeconds = clamp(
    finite(options.fixedWindowSeconds, 0),
    0,
    120,
  );
  const activeRuns = activeFrameRuns(frames);
  if (fixedWindowSeconds > 0) {
    const overlap = clamp(finite(options.fixedWindowOverlap, 0.5), 0, 0.95);
    const partialWindowMinimumSeconds = Math.min(
      minimumDurationSeconds,
      fixedWindowSeconds * 0.5,
    );
    const windowFrames = Math.max(1, Math.round(fixedWindowSeconds / hopSeconds));
    const stepFrames = Math.max(1, Math.round(windowFrames * (1 - overlap)));
    const strophes = [];
    for (let startFrame = 0; startFrame < frames.length; startFrame += stepFrames) {
      const endFrame = Math.min(frames.length - 1, startFrame + windowFrames - 1);
      const local = frames.slice(startFrame, endFrame + 1);
      const activeRatio = local.filter((frame) => frame.active).length / Math.max(1, local.length);
      const startSeconds = Math.max(0, startFrame * hopSeconds);
      const endSeconds = Math.min(durationSeconds, (endFrame + 1) * hopSeconds);
      const windowDuration = endSeconds - startSeconds;
      if (
        windowDuration >= partialWindowMinimumSeconds
        && activeRatio >= clamp(finite(options.minimumWindowActiveRatio, 0.01), 0, 1)
      ) {
        strophes.push({
          startFrame,
          endFrame,
          startSeconds,
          endSeconds,
          durationSeconds: windowDuration,
          activeRatio,
        });
      }
      if (endFrame >= frames.length - 1) break;
    }
    const retainedStrophes = strophes.slice(0, 128);
    return {
      strophes: retainedStrophes,
      mode: "fixed-window",
      fixedWindowSeconds,
      fixedWindowOverlap: overlap,
      mergeGapSeconds: null,
      minimumDurationSeconds,
      partialWindowMinimumSeconds,
      activeRuns,
      candidateCount: strophes.length,
      truncatedAtEventLimit: strophes.length > retainedStrophes.length,
    };
  }
  const grouped = [];
  for (const run of activeRuns) {
    const previous = grouped[grouped.length - 1];
    const gap = previous
      ? (run.startFrame - previous.endFrame - 1) * hopSeconds
      : Infinity;
    if (previous && gap <= mergeGapSeconds) previous.endFrame = run.endFrame;
    else grouped.push({ ...run });
  }

  const candidates = grouped
    .map((range) => {
      const halfWindowSeconds = fftSize * 0.5 * hopSeconds / hopSize;
      const startSeconds = Math.max(0, range.startFrame * hopSeconds - halfWindowSeconds);
      const endSeconds = Math.min(
        durationSeconds,
        range.endFrame * hopSeconds + halfWindowSeconds,
      );
      return { ...range, startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
    })
    .filter((range) => range.durationSeconds >= minimumDurationSeconds);
  const strophes = candidates.slice(0, 128);

  return {
    strophes,
    mode: "pause-bounded",
    mergeGapSeconds,
    minimumDurationSeconds,
    activeRuns,
    candidateCount: candidates.length,
    truncatedAtEventLimit: candidates.length > strophes.length,
  };
}

function normalizeRows(rows) {
  const dimensions = rows[0]?.length ?? 0;
  const centers = new Float64Array(dimensions);
  const scales = new Float64Array(dimensions);
  for (const row of rows) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      centers[dimension] += finite(row[dimension]);
    }
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    centers[dimension] /= Math.max(1, rows.length);
  }
  for (const row of rows) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      scales[dimension] += (finite(row[dimension]) - centers[dimension]) ** 2;
    }
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    scales[dimension] = Math.max(1e-7, Math.sqrt(scales[dimension] / Math.max(1, rows.length)));
  }
  return {
    rows: rows.map((row) => row.map((value, dimension) => (
      (finite(value) - centers[dimension]) / scales[dimension]
    ))),
    centers,
    scales,
  };
}

function covarianceMatrix(rows) {
  const dimensions = rows[0]?.length ?? FRAME_FEATURE_NAMES.length;
  const matrix = Array.from({ length: dimensions }, () => new Float64Array(dimensions));
  for (const row of rows) {
    for (let left = 0; left < dimensions; left += 1) {
      for (let right = left; right < dimensions; right += 1) {
        matrix[left][right] += row[left] * row[right];
      }
    }
  }
  const denominator = Math.max(1, rows.length - 1);
  for (let left = 0; left < dimensions; left += 1) {
    for (let right = left; right < dimensions; right += 1) {
      matrix[left][right] /= denominator;
      matrix[right][left] = matrix[left][right];
    }
  }
  return matrix;
}

function matrixVector(matrix, vector) {
  const output = new Float64Array(vector.length);
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < vector.length; column += 1) {
      output[row] += matrix[row][column] * vector[column];
    }
  }
  return output;
}

function dot(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

function orthogonalize(vector, basis) {
  for (const axis of basis) {
    const projection = dot(vector, axis);
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] -= projection * axis[index];
    }
  }
  let norm = Math.sqrt(dot(vector, vector));
  if (norm < 1e-12) {
    vector.fill(0);
    vector[basis.length % vector.length] = 1;
    norm = 1;
  }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

function principalAxes(rows) {
  const matrix = covarianceMatrix(rows);
  const dimensions = matrix.length;
  const axes = [];
  const eigenvalues = [];
  for (let component = 0; component < 3; component += 1) {
    let vector = new Float64Array(dimensions);
    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = Math.sin((index + 1) * (component + 1) * 1.731) + 0.37;
    }
    orthogonalize(vector, axes);
    for (let iteration = 0; iteration < 72; iteration += 1) {
      vector = matrixVector(matrix, vector);
      orthogonalize(vector, axes);
    }
    const product = matrixVector(matrix, vector);
    const eigenvalue = Math.max(0, dot(vector, product));
    axes.push(vector);
    eigenvalues.push(eigenvalue);
  }
  let trace = 0;
  for (let index = 0; index < matrix.length; index += 1) trace += matrix[index][index];
  return {
    axes,
    eigenvalues,
    explainedVariance: eigenvalues.map((value) => value / Math.max(1e-12, trace)),
  };
}

function projectRows(rows, axes) {
  const raw = rows.map((row) => axes.map((axis) => dot(row, axis)));
  const axisScales = [0, 1, 2].map((axis) => (
    Math.max(1e-8, quantile(raw.map((position) => Math.abs(position[axis])), 0.95))
  ));
  return {
    positions: raw.map((position) => Object.freeze({
      x: clamp(position[0] / axisScales[0], -1.35, 1.35),
      y: clamp(position[1] / axisScales[1], -1.35, 1.35),
      z: clamp(position[2] / axisScales[2], -1.35, 1.35),
    })),
    axisScales,
  };
}

function squaredDistance(left, right) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;
}

function vectorSquaredDistance(left, right) {
  let total = 0;
  const length = Math.min(left?.length ?? 0, right?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    total += (finite(left[index]) - finite(right[index])) ** 2;
  }
  return total;
}

function clusterPositions(positions) {
  if (!positions.length) return [];
  const clusterCount = Math.min(6, Math.max(1, Math.round(Math.sqrt(positions.length / 1.8))));
  const centers = [positions.reduce((best, point) => point.x < best.x ? point : best, positions[0])];
  while (centers.length < clusterCount) {
    let best = positions[0];
    let bestDistance = -1;
    for (const point of positions) {
      const nearest = Math.min(...centers.map((center) => squaredDistance(point, center)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = point;
      }
    }
    centers.push(best);
  }
  const assignments = new Array(positions.length).fill(0);
  for (let iteration = 0; iteration < 18; iteration += 1) {
    for (let index = 0; index < positions.length; index += 1) {
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let cluster = 0; cluster < centers.length; cluster += 1) {
        const distance = squaredDistance(positions[index], centers[cluster]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = cluster;
        }
      }
      assignments[index] = nearest;
    }
    for (let cluster = 0; cluster < centers.length; cluster += 1) {
      const members = positions.filter((_, index) => assignments[index] === cluster);
      if (!members.length) continue;
      centers[cluster] = {
        x: mean(members.map((point) => point.x)),
        y: mean(members.map((point) => point.y)),
        z: mean(members.map((point) => point.z)),
      };
    }
  }
  return assignments.map((cluster) => cluster + 1);
}

function buildSimilarityEdges(strophes, neighborCount) {
  if (strophes.length < 2 || neighborCount < 1) return Object.freeze([]);
  const edges = new Map();
  for (let source = 0; source < strophes.length; source += 1) {
    const neighbors = strophes
      .map((strophe, target) => ({
        target,
        distance: target === source
          ? Infinity
          : Math.sqrt(vectorSquaredDistance(
            strophes[source].similarityVector,
            strophe.similarityVector,
          )),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, neighborCount);
    for (const neighbor of neighbors) {
      const left = Math.min(source, neighbor.target);
      const right = Math.max(source, neighbor.target);
      const key = `${left}:${right}`;
      const current = edges.get(key);
      if (!current || neighbor.distance < current.distance) {
        edges.set(key, { source: left, target: right, distance: neighbor.distance });
      }
    }
  }
  const distances = [...edges.values()].map((edge) => edge.distance);
  const scale = Math.max(1e-6, median(distances));
  return Object.freeze([...edges.values()].map((edge) => Object.freeze({
    ...edge,
    weight: Math.exp(-edge.distance / scale),
  })));
}

function blockEnvelopeSummary(values, blockSize) {
  const blocks = [];
  for (let start = 0; start < values.length; start += blockSize) {
    blocks.push(mean(values.slice(start, start + blockSize)));
  }
  const center = mean(blocks);
  let movement = 0;
  for (let index = 1; index < blocks.length; index += 1) {
    movement += Math.abs(blocks[index] - blocks[index - 1]);
  }
  return {
    modulation: blocks.length > 1
      ? movement / (blocks.length - 1) / Math.max(1e-7, center)
      : 0,
    variation: standardDeviation(blocks, center) / Math.max(1e-7, center),
  };
}

function rhythmicSummary(frames, range, hopSeconds) {
  const local = frames.slice(range.startFrame, range.endFrame + 1);
  const onsets = [];
  for (let index = 1; index < local.length; index += 1) {
    if (local[index].active && !local[index - 1].active) onsets.push(local[index].timeSeconds);
  }
  if (local[0]?.active) onsets.unshift(local[0].timeSeconds);
  const intervals = [];
  for (let index = 1; index < onsets.length; index += 1) intervals.push(onsets[index] - onsets[index - 1]);
  const intervalMean = mean(intervals);
  const envelopeValues = local.map((frame) => frame.rms);
  const envelopeScales = Object.freeze([1, 4, 16].map((blockSize) => Object.freeze({
    windowSeconds: blockSize * hopSeconds,
    ...blockEnvelopeSummary(envelopeValues, blockSize),
  })));
  return {
    onsetCount: onsets.length,
    onsetRateHz: onsets.length / Math.max(0.001, range.durationSeconds),
    rhythmVariation: intervalMean > 0 ? standardDeviation(intervals, intervalMean) / intervalMean : 0,
    envelopeScales,
  };
}

function stropheDescriptor(strophe, nyquist) {
  return [
    Math.log1p(strophe.durationSeconds),
    Math.log1p(strophe.onsetRateHz),
    strophe.rhythmVariation,
    strophe.meanCentroidHz / nyquist,
    strophe.meanBandwidthHz / nyquist,
    strophe.meanFlatness,
    strophe.meanFlux,
    strophe.trajectorySpan,
    ...strophe.envelopeScales.flatMap((scale) => [scale.modulation, scale.variation]),
  ];
}

function freezeFrame(frame) {
  return Object.freeze({
    timeSeconds: frame.timeSeconds,
    sourceTimeSeconds: frame.sourceTimeSeconds,
    rms: frame.rms,
    active: Boolean(frame.active),
    centroidHz: frame.centroidHz,
    bandwidthHz: frame.bandwidthHz,
    rolloffHz: frame.rolloffHz,
    flatness: frame.flatness,
    spectralFlux: frame.spectralFlux,
    zeroCrossingRate: frame.zeroCrossingRate,
    peakHz: frame.peakHz,
    position: frame.position,
  });
}

export function analyzeNightingaleSequence(samples, sampleRate = DEFAULT_SAMPLE_RATE, options = {}) {
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length < 256) {
    throw new TypeError("Choose a non-empty nightingale sequence");
  }
  const rate = finite(sampleRate);
  if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
    throw new RangeError(`Sample rate must be ${MIN_SAMPLE_RATE}–${MAX_SAMPLE_RATE} Hz`);
  }
  const maximumDuration = clamp(
    finite(options.maxDurationSeconds, DEFAULT_MAX_DURATION_SECONDS),
    1,
    180,
  );
  const sampleCount = Math.min(samples.length, Math.floor(rate * maximumDuration));
  const durationSeconds = sampleCount / rate;
  const fftSize = powerOfTwoSize(options.frameSize, DEFAULT_FFT_SIZE);
  const hopSize = Math.round(clamp(
    finite(options.hopSize, DEFAULT_HOP_SIZE),
    1,
    fftSize,
  ));
  const prepared = downsampleAndCenter(
    samples,
    rate,
    sampleCount,
    options.analysisTargetRate,
  );
  const spectralCeilingHz = prepared.sampleRate * 0.48;
  const requestedMinimumSpectralHz = Math.max(
    1,
    finite(options.minimumSpectralHz, MIN_SPECTRAL_HZ),
  );
  const requestedMaximumSpectralHz = Math.max(
    requestedMinimumSpectralHz,
    finite(options.maximumSpectralHz, MAX_SPECTRAL_HZ),
  );
  const maximumSpectralHz = clamp(
    requestedMaximumSpectralHz,
    Math.min(spectralCeilingHz, Math.max(2, prepared.sampleRate / fftSize)),
    spectralCeilingHz,
  );
  const minimumSpectralHz = clamp(
    requestedMinimumSpectralHz,
    1,
    Math.max(1, maximumSpectralHz - prepared.sampleRate / fftSize),
  );
  const spectralCoverage = Object.freeze({
    requestedMinimumHz: requestedMinimumSpectralHz,
    requestedMaximumHz: requestedMaximumSpectralHz,
    availableMaximumHz: spectralCeilingHz,
    complete: maximumSpectralHz >= requestedMaximumSpectralHz * 0.995,
  });
  if (prepared.sourcePeak < 1e-7 || prepared.samples.length < fftSize) {
    return Object.freeze({
      version: 1,
      sampleRate: rate,
      sampleCount,
      durationSeconds,
      analysisSampleRate: prepared.sampleRate,
      downsampleStride: prepared.stride,
      resampling: prepared.resampling,
      frameSize: fftSize,
      hopSize,
      spectralRange: Object.freeze({ minimumHz: minimumSpectralHz, maximumHz: maximumSpectralHz }),
      spectralCoverage,
      featureNames: FRAME_FEATURE_NAMES,
      frames: Object.freeze([]),
      strophes: Object.freeze([]),
      tones: Object.freeze([]),
      similarityEdges: Object.freeze([]),
      sequenceEdges: Object.freeze([]),
      embedding: Object.freeze({
        method: "standardized-pca-3",
        explainedVariance: Object.freeze([0, 0, 0]),
        explainedVarianceTotal: 0,
      }),
      segmentation: Object.freeze({ confidence: 0 }),
      warning: "No signal above the silence floor was found.",
    });
  }

  const filterMap = melFilterMap(
    prepared.sampleRate,
    minimumSpectralHz,
    maximumSpectralHz,
    fftSize,
  );
  const frameCount = Math.max(1, Math.floor((prepared.samples.length - fftSize) / hopSize) + 1);
  const mutableFrames = [];
  let previousDistribution = null;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * hopSize;
    const measured = frameSpectrum(
      prepared.samples,
      start,
      prepared.sampleRate,
      filterMap,
      previousDistribution,
      fftSize,
    );
    previousDistribution = measured.distribution;
    const timeSeconds = (start + fftSize * 0.5) / prepared.sampleRate;
    mutableFrames.push({
      ...measured,
      timeSeconds,
      sourceTimeSeconds: timeSeconds,
      active: false,
      position: Object.freeze({ x: 0, y: 0, z: 0 }),
    });
  }
  const thresholds = activityMask(mutableFrames);
  const hopSeconds = hopSize / prepared.sampleRate;
  const segmentation = segmentStrophes(
    mutableFrames,
    hopSeconds,
    durationSeconds,
    options,
    fftSize,
    hopSize,
  );
  const activeIndices = [];
  for (const range of segmentation.strophes) {
    for (let index = range.startFrame; index <= range.endFrame; index += 1) activeIndices.push(index);
  }
  const uniqueActiveIndices = [...new Set(activeIndices)];
  if (!uniqueActiveIndices.length) {
    return Object.freeze({
      version: 1,
      sampleRate: rate,
      sampleCount,
      durationSeconds,
      analysisSampleRate: prepared.sampleRate,
      downsampleStride: prepared.stride,
      resampling: prepared.resampling,
      frameSize: fftSize,
      hopSize,
      spectralRange: Object.freeze({ minimumHz: minimumSpectralHz, maximumHz: maximumSpectralHz }),
      spectralCoverage,
      featureNames: FRAME_FEATURE_NAMES,
      frames: Object.freeze(mutableFrames.map(freezeFrame)),
      strophes: Object.freeze([]),
      tones: Object.freeze([]),
      similarityEdges: Object.freeze([]),
      sequenceEdges: Object.freeze([]),
      embedding: Object.freeze({
        method: "standardized-pca-3",
        explainedVariance: Object.freeze([0, 0, 0]),
        explainedVarianceTotal: 0,
      }),
      segmentation: Object.freeze({ ...segmentation, ...thresholds, confidence: 0 }),
      warning: "No silence-bounded strophes met the duration threshold.",
    });
  }

  const featureRows = uniqueActiveIndices.map((index) => mutableFrames[index].vector);
  const normalized = normalizeRows(featureRows);
  const pca = principalAxes(normalized.rows);
  const projected = projectRows(normalized.rows, pca.axes);
  for (let index = 0; index < uniqueActiveIndices.length; index += 1) {
    mutableFrames[uniqueActiveIndices[index]].position = projected.positions[index];
  }

  const mutableStrophes = segmentation.strophes.map((range, index) => {
    const local = mutableFrames.slice(range.startFrame, range.endFrame + 1);
    const position = Object.freeze({
      x: mean(local.map((frame) => frame.position.x)),
      y: mean(local.map((frame) => frame.position.y)),
      z: mean(local.map((frame) => frame.position.z)),
    });
    const rhythmic = rhythmicSummary(mutableFrames, range, hopSeconds);
    const energy = mean(local.map((frame) => frame.rms));
    const spread = Math.sqrt(mean(local.map((frame) => squaredDistance(frame.position, position))));
    return {
      id: `S${String(index + 1).padStart(3, "0")}`,
      index,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      durationSeconds: range.durationSeconds,
      startSample: Math.max(0, Math.floor(range.startSeconds * rate)),
      endSample: Math.min(sampleCount, Math.ceil(range.endSeconds * rate)),
      frameStart: range.startFrame,
      frameEnd: range.endFrame,
      frameCount: local.length,
      position,
      energy,
      family: 1,
      medianPeakHz: median(local.filter((frame) => frame.active).map((frame) => frame.peakHz)),
      meanCentroidHz: mean(local.map((frame) => frame.centroidHz)),
      meanBandwidthHz: mean(local.map((frame) => frame.bandwidthHz)),
      meanFlatness: mean(local.map((frame) => frame.flatness)),
      meanFlux: mean(local.map((frame) => frame.spectralFlux)),
      trajectorySpan: spread,
      ...rhythmic,
    };
  });
  const tones = [];
  const tonesByStrophe = mutableStrophes.map(() => []);
  const halfWindowSeconds = fftSize * 0.5 / prepared.sampleRate;
  for (let parentStropheIndex = 0; parentStropheIndex < mutableStrophes.length; parentStropheIndex += 1) {
    const parent = mutableStrophes[parentStropheIndex];
    const overlappingRuns = (segmentation.activeRuns ?? []).filter((run) => (
      run.endFrame >= parent.frameStart && run.startFrame <= parent.frameEnd
    ));
    for (const run of overlappingRuns) {
      const startFrame = Math.max(parent.frameStart, run.startFrame);
      const endFrame = Math.min(parent.frameEnd, run.endFrame);
      const local = mutableFrames.slice(startFrame, endFrame + 1);
      if (!local.length) continue;
      const position = Object.freeze({
        x: mean(local.map((frame) => frame.position.x)),
        y: mean(local.map((frame) => frame.position.y)),
        z: mean(local.map((frame) => frame.position.z)),
      });
      const indexWithinStrophe = tonesByStrophe[parentStropheIndex].length;
      const startSeconds = Math.max(
        parent.startSeconds,
        startFrame * hopSeconds - halfWindowSeconds,
      );
      const endSeconds = Math.min(
        parent.endSeconds,
        endFrame * hopSeconds + halfWindowSeconds,
      );
      const tone = Object.freeze({
        id: `T${String(tones.length + 1).padStart(3, "0")}`,
        parentStropheId: parent.id,
        parentStropheIndex,
        indexWithinStrophe,
        startFrame,
        endFrame,
        frameCount: local.length,
        startSeconds,
        endSeconds,
        durationSeconds: Math.max(0, endSeconds - startSeconds),
        position,
        energy: mean(local.map((frame) => frame.rms)),
        peakEnergy: Math.max(...local.map((frame) => frame.rms)),
        medianPeakHz: median(local.map((frame) => frame.peakHz)),
        meanCentroidHz: mean(local.map((frame) => frame.centroidHz)),
        meanBandwidthHz: mean(local.map((frame) => frame.bandwidthHz)),
      });
      tones.push(tone);
      tonesByStrophe[parentStropheIndex].push(tone);
    }
  }
  const descriptorRows = mutableStrophes.map((strophe) => (
    stropheDescriptor(strophe, prepared.sampleRate * 0.5)
  ));
  const normalizedDescriptors = normalizeRows(descriptorRows);
  const families = clusterPositions(mutableStrophes.map((strophe) => strophe.position));
  const strophes = Object.freeze(mutableStrophes.map((strophe, index) => Object.freeze({
    ...strophe,
    family: families[index],
    tones: Object.freeze(tonesByStrophe[index]),
    similarityDescriptor: Object.freeze(descriptorRows[index]),
    similarityVector: Object.freeze(normalizedDescriptors.rows[index]),
  })));
  const neighborCount = strophes.length < 2
    ? 0
    : Math.round(clamp(finite(options.neighborCount, 3), 1, strophes.length - 1));
  const similarityEdges = buildSimilarityEdges(strophes, neighborCount);
  const sequenceEdges = Object.freeze(strophes.slice(0, -1).map((_, index) => Object.freeze({
    source: index,
    target: index + 1,
    weight: 1,
    observed: true,
  })));
  const separation = Math.max(1e-8, thresholds.strongLevel - thresholds.noiseFloor);
  const segmentationConfidence = clamp(
    mean(strophes.map((strophe) => clamp((strophe.energy - thresholds.noiseFloor) / separation))),
  );

  return Object.freeze({
    version: 1,
    sampleRate: rate,
    sampleCount,
    durationSeconds,
    analysisSampleRate: prepared.sampleRate,
    downsampleStride: prepared.stride,
    resampling: prepared.resampling,
    frameSize: fftSize,
    hopSize,
    spectralRange: Object.freeze({ minimumHz: minimumSpectralHz, maximumHz: maximumSpectralHz }),
    spectralCoverage,
    featureNames: FRAME_FEATURE_NAMES,
    frames: Object.freeze(mutableFrames.map(freezeFrame)),
    strophes,
    tones: Object.freeze(tones),
    similarityEdges,
    sequenceEdges,
    embedding: Object.freeze({
      method: "standardized-pca-3",
      input: "12 MFCCs plus seven spectral, energy, and temporal descriptors",
      components: Object.freeze(pca.axes.map((axis) => Object.freeze(Array.from(axis)))),
      explainedVariance: Object.freeze(pca.explainedVariance),
      explainedVarianceTotal: pca.explainedVariance.reduce((sum, value) => sum + value, 0),
      axisScales: Object.freeze(projected.axisScales),
      featureCenters: Object.freeze(Array.from(normalized.centers)),
      featureScales: Object.freeze(Array.from(normalized.scales)),
    }),
    similarity: Object.freeze({
      method: "standardized-strophe-descriptor-knn",
      descriptorNames: STROPHE_DESCRIPTOR_NAMES,
      neighborCount,
      note: "Similarity uses duration, rhythm, spectral summaries, PCA trajectory span, and envelope variation at three time scales.",
    }),
    segmentation: Object.freeze({
      ...segmentation,
      ...thresholds,
      stropheGapSeconds: segmentation.mergeGapSeconds,
      minimumStropheSeconds: segmentation.minimumDurationSeconds,
      confidence: segmentationConfidence,
      operationalDefinition: "one active song bout bounded by a pause longer than the selected gap",
    }),
    warning: `${segmentation.truncatedAtEventLimit ? `Only the first ${strophes.length} of ${segmentation.candidateCount} qualifying strophes are mapped. ` : ""}PCA coordinates are a projection: proximity suggests acoustic similarity, while only amber sequence edges represent observed order.`,
  });
}

function seededRandom(seed) {
  let state = (Math.round(finite(seed, 0x4e494748)) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function adjacencyFor(analysis, index) {
  const neighbors = [];
  for (const edge of analysis.similarityEdges ?? []) {
    if (edge.source === index) neighbors.push({ index: edge.target, weight: edge.weight, kind: "similarity" });
    else if (edge.target === index) neighbors.push({ index: edge.source, weight: edge.weight, kind: "similarity" });
  }
  const next = analysis.sequenceEdges?.find((edge) => (
    edge.source === index && edge.withinConfiguredSequence !== false
  ));
  if (next) neighbors.push({ index: next.target, weight: 1, kind: "observed" });
  return neighbors;
}

const TRAVERSAL_RULES = Object.freeze([
  "chronology",
  "reverse-chronology",
  "similarity",
  "hybrid",
  "spatial-nearest",
  "spatial-farthest",
  "axis-x",
  "axis-y",
  "axis-z",
  "shuffled",
  "manual",
]);

function spatialCoordinate(analysis, index, axis) {
  return Number(analysis?.strophes?.[index]?.position?.[axis]);
}

function hasValidSpatialPosition(analysis, index) {
  const position = analysis?.strophes?.[index]?.position;
  return ["x", "y", "z"].every((axis) => Number.isFinite(position?.[axis]));
}

function spatialDistanceSquared(analysis, leftIndex, rightIndex) {
  if (
    !hasValidSpatialPosition(analysis, leftIndex)
    || !hasValidSpatialPosition(analysis, rightIndex)
  ) return null;
  const left = analysis?.strophes?.[leftIndex]?.position;
  const right = analysis?.strophes?.[rightIndex]?.position;
  return ["x", "y", "z"].reduce((total, axis) => {
    const difference = finite(left?.[axis]) - finite(right?.[axis]);
    return total + difference * difference;
  }, 0);
}

function repeatOrderFromStart(order, startIndex, length) {
  const start = Math.max(0, order.indexOf(startIndex));
  const rotated = [...order.slice(start), ...order.slice(0, start)];
  return Object.freeze(Array.from({ length }, (_, index) => rotated[index % rotated.length]));
}

function shuffledTraversal(count, startIndex, length, random) {
  const path = [];
  let previous = null;
  while (path.length < length) {
    const pool = Array.from({ length: count }, (_, index) => index);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [pool[index], pool[target]] = [pool[target], pool[index]];
    }
    if (!path.length) {
      const selected = pool.indexOf(startIndex);
      [pool[0], pool[selected]] = [pool[selected], pool[0]];
    } else if (pool.length > 1 && pool[0] === previous) {
      [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    for (const index of pool) {
      if (path.length >= length) break;
      path.push(index);
      previous = index;
    }
  }
  return Object.freeze(path);
}

function spatialTraversal(analysis, startIndex, length, farthest = false) {
  const count = analysis.strophes.length;
  const path = [startIndex];
  let available = new Set(Array.from({ length: count }, (_, index) => index));
  available.delete(startIndex);
  while (path.length < length) {
    const current = path.at(-1);
    if (!available.size) {
      available = new Set(Array.from({ length: count }, (_, index) => index));
      available.delete(current);
    }
    const measurable = hasValidSpatialPosition(analysis, current)
      ? [...available].filter((index) => hasValidSpatialPosition(analysis, index))
      : [];
    const candidates = (measurable.length ? measurable : [...available]).sort((left, right) => {
      const leftDistance = spatialDistanceSquared(analysis, left, current);
      const rightDistance = spatialDistanceSquared(analysis, right, current);
      const delta = leftDistance === null || rightDistance === null
        ? 0
        : leftDistance - rightDistance;
      return (farthest ? -delta : delta) || left - right;
    });
    const next = candidates[0] ?? current;
    path.push(next);
    available.delete(next);
  }
  return Object.freeze(path);
}

export function buildStropheTraversal(analysis, options = {}) {
  const count = analysis?.strophes?.length ?? 0;
  if (!count) return Object.freeze([]);
  const rule = TRAVERSAL_RULES.includes(options.rule)
    ? options.rule
    : "chronology";
  const length = Math.round(clamp(finite(options.length, Math.min(8, count)), 1, 32));
  const startIndex = Math.round(clamp(finite(options.startIndex, 0), 0, count - 1));
  if (rule === "manual") return Object.freeze([startIndex]);
  const surprise = clamp(finite(options.surprise, 0.25));
  const random = seededRandom(options.seed);
  if (rule === "reverse-chronology") {
    return Object.freeze(Array.from(
      { length },
      (_, index) => (startIndex - index + count * Math.ceil(length / count)) % count,
    ));
  }
  if (rule === "shuffled") return shuffledTraversal(count, startIndex, length, random);
  if (rule === "spatial-nearest" || rule === "spatial-farthest") {
    return spatialTraversal(analysis, startIndex, length, rule === "spatial-farthest");
  }
  if (rule.startsWith("axis-")) {
    const axis = rule.slice(-1);
    const order = Array.from({ length: count }, (_, index) => index).sort((left, right) => (
      Number(hasValidSpatialPosition(analysis, right))
      - Number(hasValidSpatialPosition(analysis, left))
      || (hasValidSpatialPosition(analysis, left)
        ? spatialCoordinate(analysis, left, axis) - spatialCoordinate(analysis, right, axis)
        : 0)
      || left - right
    ));
    return repeatOrderFromStart(order, startIndex, length);
  }
  const path = [startIndex];
  while (path.length < length) {
    const current = path[path.length - 1];
    if (rule === "chronology") {
      path.push((current + 1) % count);
      continue;
    }
    let candidates = adjacencyFor(analysis, current)
      .filter((candidate) => candidate.index !== path[path.length - 2]);
    if (rule === "similarity") candidates = candidates.filter((candidate) => candidate.kind === "similarity");
    if (!candidates.length) candidates = adjacencyFor(analysis, current);
    if (!candidates.length) {
      path.push((current + 1) % count);
      continue;
    }
    candidates.sort((left, right) => {
      const leftScore = left.weight + (rule === "hybrid" && left.kind === "observed" ? 0.72 : 0);
      const rightScore = right.weight + (rule === "hybrid" && right.kind === "observed" ? 0.72 : 0);
      return rightScore - leftScore || left.index - right.index;
    });
    const rank = Math.min(
      candidates.length - 1,
      Math.floor((random() ** Math.max(0.16, 1.35 - surprise)) * candidates.length * surprise),
    );
    path.push(candidates[rank].index);
  }
  return Object.freeze(path);
}

function fadeSegment(samples, sampleRate) {
  const output = Float32Array.from(samples, (value) => finite(value));
  const fadeLength = Math.min(
    Math.floor(output.length / 2),
    Math.max(1, Math.round(sampleRate * 0.006)),
  );
  for (let index = 0; index < fadeLength; index += 1) {
    const gain = Math.sin((index + 0.5) / fadeLength * Math.PI * 0.5) ** 2;
    output[index] *= gain;
    output[output.length - 1 - index] *= gain;
  }
  return output;
}

export function assembleAudioSegments(segments, sampleRate, options = {}) {
  if (!Array.isArray(segments) || !segments.length) {
    return Object.freeze({ samples: new Float32Array(), sampleRate, timeline: Object.freeze([]) });
  }
  const rate = clamp(Math.round(finite(sampleRate, DEFAULT_SAMPLE_RATE)), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
  const gapSamples = Math.round(rate * clamp(finite(options.gapSeconds, 0.07), 0, 1));
  const safeSegments = segments.map((segment) => fadeSegment(segment.samples ?? segment, rate));
  const totalSamples = safeSegments.reduce((sum, segment) => sum + segment.length, 0)
    + gapSamples * Math.max(0, safeSegments.length - 1);
  const output = new Float32Array(totalSamples);
  const timeline = [];
  let cursor = 0;
  for (let index = 0; index < safeSegments.length; index += 1) {
    const segment = safeSegments[index];
    output.set(segment, cursor);
    timeline.push(Object.freeze({
      index,
      stropheIndex: segments[index].stropheIndex ?? index,
      startSeconds: cursor / rate,
      endSeconds: (cursor + segment.length) / rate,
    }));
    cursor += segment.length + (index < safeSegments.length - 1 ? gapSamples : 0);
  }
  return Object.freeze({ samples: output, sampleRate: rate, timeline: Object.freeze(timeline) });
}

export function assembleStropheRoute(samples, analysis, indices, options = {}) {
  if (!analysis?.strophes || !Array.isArray(indices)) {
    throw new TypeError("assembleStropheRoute requires manifold analysis and a strophe route");
  }
  const segments = indices.map((stropheIndex) => {
    const strophe = analysis.strophes[stropheIndex];
    if (!strophe) throw new RangeError(`Unknown strophe index ${stropheIndex}`);
    return {
      stropheIndex,
      samples: samples.slice(strophe.startSample, strophe.endSample),
    };
  });
  return assembleAudioSegments(segments, analysis.sampleRate, options);
}

function smoothPulse(position, attack = 0.12, release = 0.24) {
  if (position <= 0 || position >= 1) return 0;
  const rise = clamp(position / attack);
  const fall = clamp((1 - position) / release);
  return Math.sin(rise * Math.PI * 0.5) ** 2 * Math.sin(fall * Math.PI * 0.5) ** 2;
}

function addNote(samples, sampleRate, startSeconds, durationSeconds, fromHz, toHz, amplitude, color = 0) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.round((startSeconds + durationSeconds) * sampleRate));
  let phase = color * 0.47;
  for (let index = start; index < end; index += 1) {
    const position = (index - start) / Math.max(1, end - start);
    const shaped = position * position * (3 - 2 * position);
    const vibrato = 1 + 0.012 * Math.sin(TWO_PI * (7.1 + color * 0.37) * position * durationSeconds);
    const frequency = (fromHz + (toHz - fromHz) * shaped) * vibrato;
    phase += TWO_PI * frequency / sampleRate;
    const envelope = smoothPulse(position, 0.09 + color * 0.008, 0.19);
    const harmonic = Math.sin(phase)
      + (0.22 + color * 0.025) * Math.sin(phase * 2 + 0.31)
      + 0.07 * Math.sin(phase * 3 + 0.77);
    samples[index] += amplitude * envelope * harmonic / 1.29;
  }
}

function synthesizeDemoStrophe(samples, sampleRate, startSeconds, family, variant) {
  let duration = 0.7;
  if (family === 0) {
    const count = 3 + variant % 2;
    for (let note = 0; note < count; note += 1) {
      const start = startSeconds + note * 0.18;
      const frequency = 2_350 + variant * 95 + note * 420;
      addNote(samples, sampleRate, start, 0.14, frequency, frequency * 1.025, 0.62, note);
    }
    duration = count * 0.18;
  } else if (family === 1) {
    const count = 8 + variant % 3;
    for (let note = 0; note < count; note += 1) {
      const start = startSeconds + note * 0.071;
      addNote(samples, sampleRate, start, 0.058, 4_600 + variant * 80, 5_350 + note * 34, 0.48, note);
    }
    duration = count * 0.071;
  } else if (family === 2) {
    const frequencies = [3_100, 5_800, 4_350, 7_000, 3_700];
    for (let note = 0; note < frequencies.length; note += 1) {
      const start = startSeconds + note * 0.155;
      const direction = note % 2 ? -1 : 1;
      addNote(
        samples,
        sampleRate,
        start,
        0.125,
        frequencies[note] + variant * 55,
        frequencies[note] + direction * 720,
        0.5,
        note,
      );
    }
    duration = 0.76;
  } else if (family === 3) {
    const count = 12 + variant % 4;
    for (let note = 0; note < count; note += 1) {
      const start = startSeconds + note * 0.043;
      addNote(samples, sampleRate, start, 0.038, 5_900, 4_850 + (note % 3) * 280, 0.34, note + 2);
    }
    duration = count * 0.043;
  } else {
    const count = 4;
    for (let note = 0; note < count; note += 1) {
      const start = startSeconds + note * 0.22;
      const base = 2_050 + variant * 75 + (note % 2) * 1_150;
      addNote(samples, sampleRate, start, 0.18, base, base + 180, 0.57, note + 1);
    }
    duration = 0.85;
  }
  return duration;
}

export function createDemoNightingaleSequence(sampleRate = DEFAULT_SAMPLE_RATE) {
  const rate = clamp(Math.round(finite(sampleRate, DEFAULT_SAMPLE_RATE)), 16_000, MAX_SAMPLE_RATE);
  const families = [0, 1, 3, 0, 2, 1, 4, 0, 3, 2, 1, 4, 3, 0, 2, 4, 1, 3];
  const starts = [];
  let cursor = 0.28;
  for (let index = 0; index < families.length; index += 1) {
    starts.push(cursor);
    const nominalDuration = [0.72, 0.72, 0.78, 0.65, 0.88][families[index]];
    cursor += nominalDuration + 0.9 + (index % 3) * 0.055;
  }
  const durationSeconds = cursor + 0.3;
  const samples = new Float32Array(Math.ceil(durationSeconds * rate));
  for (let index = 0; index < families.length; index += 1) {
    synthesizeDemoStrophe(samples, rate, starts[index], families[index], index % 5);
  }
  const peak = samplePeak(samples);
  if (peak > 0) {
    for (let index = 0; index < samples.length; index += 1) samples[index] *= 0.78 / peak;
  }
  return Object.freeze({
    samples,
    sampleRate: rate,
    label: "Synthetic compressed 18-strophe thrush-nightingale sketch",
    expectedStrophes: families.length,
    families: Object.freeze(families),
  });
}

export function nightingaleManifoldExport(analysis, route = [], metadata = {}) {
  return Object.freeze({
    format: "morphazoid-nightingale-strophe-manifold",
    version: 1,
    source: metadata.source ?? "local audio",
    disclaimer: "Strophes are pause-bounded occurrences; cluster colors and PCA proximity are exploratory, and only sequence edges encode observed order.",
    sampleRate: analysis.sampleRate,
    sampleCount: analysis.sampleCount,
    durationSeconds: analysis.durationSeconds,
    featureRecipe: Object.freeze({
      frameSize: analysis.frameSize,
      hopSize: analysis.hopSize,
      analysisSampleRate: analysis.analysisSampleRate,
      spectralRange: analysis.spectralRange,
      features: analysis.featureNames,
      stropheFeatures: analysis.similarity?.descriptorNames ?? STROPHE_DESCRIPTOR_NAMES,
      embedding: analysis.embedding.method,
    }),
    segmentation: analysis.segmentation,
    strophes: analysis.strophes,
    tones: analysis.tones ?? Object.freeze([]),
    edges: Object.freeze({
      acousticSimilarity: analysis.similarityEdges,
      observedSuccession: analysis.sequenceEdges,
    }),
    route: Object.freeze({
      rule: metadata.rule ?? "manual",
      seed: finite(metadata.seed, 0),
      indices: Object.freeze([...route]),
      ids: Object.freeze(route.map((index) => analysis.strophes[index]?.id).filter(Boolean)),
      listenMode: metadata.listenMode ?? "recording",
    }),
  });
}

export const NIGHTINGALE_MANIFOLD_LIMITS = Object.freeze({
  minimumSampleRate: MIN_SAMPLE_RATE,
  maximumSampleRate: MAX_SAMPLE_RATE,
  maximumDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  frameSize: DEFAULT_FFT_SIZE,
  hopSize: DEFAULT_HOP_SIZE,
  mfccCount: MFCC_COUNT,
});
