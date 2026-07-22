import { TAU, sampleBoundary } from "./julia.js";

const EPSILON = 1e-12;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function complexSquare(point) {
  return {
    x: point.x * point.x - point.y * point.y,
    y: 2 * point.x * point.y,
  };
}

function complexMultiply(a, b) {
  return {
    x: a.x * b.x - a.y * b.y,
    y: a.x * b.y + a.y * b.x,
  };
}

function complexDivide(a, b) {
  const denominator = b.x * b.x + b.y * b.y;
  if (denominator <= EPSILON) return null;
  return {
    x: (a.x * b.x + a.y * b.y) / denominator,
    y: (a.y * b.x - a.x * b.y) / denominator,
  };
}

function principalSquareRoot(point) {
  const magnitude = Math.hypot(point.x, point.y);
  const x = Math.sqrt(Math.max(0, (magnitude + point.x) * 0.5));
  const sign = point.y < 0 ? -1 : 1;
  return {
    x,
    y: sign * Math.sqrt(Math.max(0, (magnitude - point.x) * 0.5)),
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length * 0.5);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(a, b) {
  const count = Math.min(a.length, b.length);
  if (count < 3) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < count; index += 1) {
    sumA += a[index];
    sumB += b[index];
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < count; index += 1) {
    const deltaA = a[index] - meanA;
    const deltaB = b[index] - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  if (denominator <= EPSILON) return varianceA <= EPSILON && varianceB <= EPSILON ? 1 : 0;
  return clamp(covariance / denominator, -1, 1);
}

function resampleNumbers(values, count) {
  const source = Array.from(values ?? [], (value) => finite(value));
  const size = Math.max(2, Math.trunc(finite(count, source.length || 2)));
  if (!source.length) return new Float64Array(size);
  if (source.length === 1) return new Float64Array(size).fill(source[0]);
  const result = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const position = index / (size - 1) * (source.length - 1);
    const before = Math.floor(position);
    const after = Math.min(source.length - 1, before + 1);
    const amount = position - before;
    result[index] = source[before] + (source[after] - source[before]) * amount;
  }
  return result;
}

function differences(values) {
  const result = new Float64Array(Math.max(0, values.length - 1));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = values[index + 1] - values[index];
  }
  return result;
}

function movingAverage(values, radius) {
  const size = values.length;
  const windowRadius = Math.max(0, Math.trunc(finite(radius)));
  if (!windowRadius || size < 3) return Float64Array.from(values);
  const prefix = new Float64Array(size + 1);
  for (let index = 0; index < size; index += 1) prefix[index + 1] = prefix[index] + values[index];
  const result = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const start = Math.max(0, index - windowRadius);
    const end = Math.min(size, index + windowRadius + 1);
    result[index] = (prefix[end] - prefix[start]) / (end - start);
  }
  return result;
}

function pointBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/** Convert the +Y-up grid coordinates used by a stitched contour to z-plane coordinates. */
export function complexPointFromGrid(point, field) {
  const width = Math.max(2, Math.trunc(field?.width ?? 2));
  const height = Math.max(2, Math.trunc(field?.height ?? 2));
  const bounds = field?.bounds ?? { minX: -2, maxX: 2, minY: -2, maxY: 2 };
  return {
    x: bounds.minX + finite(point?.x) / (width - 1) * (bounds.maxX - bounds.minX),
    y: bounds.minY + finite(point?.y) / (height - 1) * (bounds.maxY - bounds.minY),
  };
}

/** Return when z=0 escapes; surviving a finite cap is explicitly inconclusive. */
export function criticalOrbitStatus(cReal, cImag, maxIterations = 4096, escapeRadius = 2) {
  const c = { x: finite(cReal), y: finite(cImag) };
  const cap = clamp(Math.trunc(finite(maxIterations, 4096)), 1, 65_536);
  const radiusSquared = Math.max(1.01, finite(escapeRadius, 2)) ** 2;
  let point = { x: 0, y: 0 };
  for (let iteration = 0; iteration <= cap; iteration += 1) {
    if (point.x * point.x + point.y * point.y > radiusSquared) {
      return { bounded: false, escaped: true, escapeIteration: iteration, point };
    }
    const squared = complexSquare(point);
    point = { x: squared.x + c.x, y: squared.y + c.y };
  }
  return {
    bounded: null,
    escaped: false,
    escapeIteration: null,
    survivedIterations: cap,
    point,
  };
}

/** Sample a short parent motif around a closed-boundary playhead at constant arclength. */
export function sampleBoundaryArc(boundary, field, {
  centerPhase = 0,
  fraction = 0.025,
  samples = 512,
} = {}) {
  const count = clamp(Math.trunc(finite(samples, 512)), 16, 8192);
  const width = clamp(finite(fraction, 0.025), 0.001, 0.5);
  const start = finite(centerPhase) - width * 0.5;
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const phase = start + width * index / (count - 1);
    const sample = sampleBoundary(boundary, phase);
    if (sample) points.push(complexPointFromGrid(sample, field));
  }
  return points;
}

export function openArcLength(points) {
  let length = 0;
  for (let index = 1; index < (points?.length ?? 0); index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

/** Resample an open complex-plane arc at constant normalized arclength. */
export function resampleOpenArc(points, samples = 512) {
  const source = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({ x: point.x, y: point.y }));
  const count = clamp(Math.trunc(finite(samples, 512)), 2, 8192);
  if (!source.length) return [];
  if (source.length === 1) return Array.from({ length: count }, () => ({ ...source[0] }));
  const cumulative = new Float64Array(source.length);
  for (let index = 1; index < source.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + distance(source[index - 1], source[index]);
  }
  const total = cumulative.at(-1);
  if (!(total > EPSILON)) return Array.from({ length: count }, () => ({ ...source[0] }));
  const result = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const target = total * index / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const endDistance = cumulative[segment];
    const amount = (target - startDistance) / Math.max(EPSILON, endDistance - startDistance);
    const start = source[segment - 1];
    const end = source[segment];
    result.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    });
  }
  return result;
}

/** Apply one continuous inverse branch g±(w)=±sqrt(w-c) to an entire arc. */
export function inverseJuliaArc(points, cReal, cImag, branch = 1) {
  const c = { x: finite(cReal), y: finite(cImag) };
  const direction = finite(branch, 1) < 0 ? -1 : 1;
  const result = [];
  let previous = null;
  for (const point of Array.isArray(points) ? points : []) {
    const root = principalSquareRoot({ x: point.x - c.x, y: point.y - c.y });
    const positive = root;
    const negative = { x: -root.x, y: -root.y };
    let selected;
    if (!previous) {
      selected = direction > 0 ? positive : negative;
    } else {
      selected = distance(previous, positive) <= distance(previous, negative) ? positive : negative;
    }
    result.push(selected);
    previous = selected;
  }
  return result;
}

/** Apply f(z)=z²+c to every point of an arc. */
export function forwardJuliaArc(points, cReal, cImag) {
  const c = { x: finite(cReal), y: finite(cImag) };
  return (Array.isArray(points) ? points : []).map((point) => {
    const squared = complexSquare(point);
    return { x: squared.x + c.x, y: squared.y + c.y };
  });
}

function smoothOpenArc(points, radius) {
  const windowRadius = Math.max(0, Math.trunc(finite(radius, 2)));
  if (!windowRadius || points.length < 4) return points.map((point) => ({ ...point }));
  const x = movingAverage(points.map((point) => point.x), windowRadius);
  const y = movingAverage(points.map((point) => point.y), windowRadius);
  const smoothed = points.map((_point, index) => ({ x: x[index], y: y[index] }));
  smoothed[0] = { ...points[0] };
  smoothed[smoothed.length - 1] = { ...points.at(-1) };
  return smoothed;
}

/**
 * Encode planar shape as unwrapped tangent heading versus normalized arclength.
 * Translation, rotation, uniform scale, and playback duration do not change it.
 */
export function pitchSignalForArc(points, {
  samples = 512,
  smoothing = 2,
} = {}) {
  const resampled = smoothOpenArc(resampleOpenArc(points, samples), smoothing);
  if (resampled.length < 2) {
    return { pitches: new Float64Array(), intervals: new Float64Array(), points: resampled };
  }
  const angles = new Float64Array(resampled.length);
  for (let index = 0; index < resampled.length; index += 1) {
    const before = resampled[Math.max(0, index - 1)];
    const after = resampled[Math.min(resampled.length - 1, index + 1)];
    angles[index] = Math.atan2(after.y - before.y, after.x - before.x);
  }
  const pitches = new Float64Array(angles.length);
  let unwrapped = angles[0];
  for (let index = 1; index < angles.length; index += 1) {
    unwrapped += wrapAngle(angles[index] - angles[index - 1]);
    pitches[index] = (unwrapped - angles[0]) / TAU;
  }
  return {
    pitches,
    intervals: differences(pitches),
    points: resampled,
    totalTurnOctaves: pitches.at(-1) ?? 0,
  };
}

/** Sample an open pitch contour. The caller decides whether to clamp or loop phase. */
export function samplePitchSignal(signal, phase) {
  const pitches = signal?.pitches ?? signal;
  if (!pitches?.length) return 0;
  if (pitches.length === 1) return finite(pitches[0]);
  const position = clamp(finite(phase), 0, 1) * (pitches.length - 1);
  const before = Math.floor(position);
  const after = Math.min(pitches.length - 1, before + 1);
  const amount = position - before;
  return pitches[before] + (pitches[after] - pitches[before]) * amount;
}

/** Compare shape-bearing pitch contours after normalizing their time axes. */
export function comparePitchSignals(reference, candidate, samples = 512) {
  const count = clamp(Math.trunc(finite(samples, 512)), 16, 8192);
  const a = resampleNumbers(reference?.pitches ?? reference, count);
  const b = resampleNumbers(candidate?.pitches ?? candidate, count);
  const intervalA = differences(a);
  const intervalB = differences(b);
  let phaseX = 0;
  let phaseY = 0;
  for (let index = 0; index < count; index += 1) {
    const difference = TAU * (a[index] - b[index]);
    phaseX += Math.cos(difference);
    phaseY += Math.sin(difference);
  }
  const phaseOffset = Math.atan2(phaseY, phaseX);
  let squaredCircularError = 0;
  for (let index = 0; index < count; index += 1) {
    const error = wrapAngle(TAU * (a[index] - b[index]) - phaseOffset) / TAU;
    squaredCircularError += error * error;
  }
  const pitchCorrelation = pearson(a, b);
  const intervalCorrelation = pearson(intervalA, intervalB);
  const circularCoherence = Math.hypot(phaseX, phaseY) / count;
  const circularRmse = Math.sqrt(squaredCircularError / count);
  const score = clamp(
    Math.max(0, pitchCorrelation) * 0.55
      + Math.max(0, intervalCorrelation) * 0.25
      + circularCoherence * 0.2,
    0,
    1,
  );
  return {
    pitchCorrelation,
    intervalCorrelation,
    circularCoherence,
    circularRmse,
    pitchOffsetOctaves: phaseOffset / TAU,
    score,
  };
}

/** Three dyadic Laplacian-pyramid bands: coarse shape, middle gesture, and fine detail. */
export function multiscalePitchBands(signal) {
  const source = Float64Array.from(signal?.pitches ?? signal ?? []);
  if (!source.length) return [];
  const fineRadius = Math.max(1, Math.round(source.length / 128));
  const middleRadius = fineRadius * 2;
  const coarseRadius = fineRadius * 4;
  const coarse = movingAverage(source, coarseRadius);
  const middleSmooth = movingAverage(source, middleRadius);
  const fineSmooth = movingAverage(source, fineRadius);
  const middle = Float64Array.from(middleSmooth, (value, index) => value - coarse[index]);
  const fine = Float64Array.from(fineSmooth, (value, index) => value - middleSmooth[index]);
  for (const band of [coarse, middle, fine]) {
    const origin = band[0];
    for (let index = 0; index < band.length; index += 1) band[index] -= origin;
  }
  return [
    { id: "coarse", pitches: coarse, gain: 0.9 },
    { id: "middle", pitches: middle, gain: 1.7 },
    { id: "fine", pitches: fine, gain: 3.2 },
  ];
}

/** Simulate finite auditory feature frames, then compare after restoring normalized time. */
export function temporalPitchFidelity(signal, durationSeconds, featureRate = 50) {
  const duration = clamp(finite(durationSeconds, 2), 0.05, 60);
  const frames = Math.max(4, Math.round(duration * clamp(finite(featureRate, 50), 10, 1000)));
  const observed = new Float64Array(frames);
  for (let index = 0; index < frames; index += 1) {
    observed[index] = samplePitchSignal(signal, index / (frames - 1));
  }
  return {
    duration,
    frames,
    ...comparePitchSignals(signal, observed, signal?.pitches?.length ?? 512),
  };
}

/** Apply the page's finite Shepard slew rate before restoring normalized time. */
export function rateLimitedTemporalPitchFidelity(
  signal,
  durationSeconds,
  featureRate = 50,
  maximumOctavesPerSecond = 7.5,
) {
  const duration = clamp(finite(durationSeconds, 2), 0.05, 60);
  const rate = clamp(finite(featureRate, 50), 10, 1000);
  const maximumRate = clamp(finite(maximumOctavesPerSecond, 7.5), 0.01, 1000);
  const frames = Math.max(4, Math.round(duration * rate));
  const observed = new Float64Array(frames);
  const maximumStep = maximumRate * duration / (frames - 1);
  let clippedFrames = 0;
  observed[0] = samplePitchSignal(signal, 0);
  for (let index = 1; index < frames; index += 1) {
    const target = samplePitchSignal(signal, index / (frames - 1));
    const correction = target - observed[index - 1];
    if (Math.abs(correction) > maximumStep) clippedFrames += 1;
    observed[index] = observed[index - 1] + clamp(correction, -maximumStep, maximumStep);
  }
  return {
    duration,
    frames,
    maximumOctavesPerSecond: maximumRate,
    limitedFraction: clippedFrames / Math.max(1, frames - 1),
    ...comparePitchSignals(signal, observed, signal?.pitches?.length ?? 512),
  };
}

/** Duration needed to keep a chosen percentile of local pitch slopes under a slew limit. */
export function minimumAuditionDuration(
  signal,
  maximumOctavesPerSecond = 7.5,
  slopePercentile = 0.99,
) {
  const pitches = signal?.pitches ?? signal ?? [];
  if (pitches.length < 2) return 0;
  const slopes = [];
  for (let index = 1; index < pitches.length; index += 1) {
    slopes.push(Math.abs(pitches[index] - pitches[index - 1]) * (pitches.length - 1));
  }
  slopes.sort((a, b) => a - b);
  const quantile = clamp(finite(slopePercentile, 0.99), 0, 1);
  const selected = slopes[Math.round((slopes.length - 1) * quantile)] ?? 0;
  return selected / Math.max(0.01, finite(maximumOctavesPerSecond, 7.5));
}

/** Build the exact inverse-image locations used by the five listening experiments. */
export function buildInverseArcFamily(parentPoints, {
  cReal = -0.7,
  cImag = 0.27015,
  depth = 3,
  branch = 1,
  samples = 512,
  smoothing = 2,
} = {}) {
  const parent = resampleOpenArc(parentPoints, samples);
  const parentLength = openArcLength(parent);
  const parentSignal = pitchSignalForArc(parent, { samples, smoothing });
  const levels = [{
    depth: 0,
    points: parent,
    length: parentLength,
    durationRatio: 1,
    magnification: 1,
    bounds: pointBounds(parent),
    center: parent[Math.floor(parent.length * 0.5)] ?? { x: 0, y: 0 },
    minimumCriticalDistance: Math.min(...parent.map((point) => Math.hypot(point.x, point.y))),
    signal: parentSignal,
    comparison: { pitchCorrelation: 1, intervalCorrelation: 1, circularCoherence: 1, circularRmse: 0, score: 1 },
  }];
  let current = parent;
  const levelCount = clamp(Math.trunc(finite(depth, 3)), 1, 6);
  for (let level = 1; level <= levelCount; level += 1) {
    current = resampleOpenArc(inverseJuliaArc(current, cReal, cImag, branch), samples);
    const length = openArcLength(current);
    const signal = pitchSignalForArc(current, { samples, smoothing });
    levels.push({
      depth: level,
      points: current,
      length,
      durationRatio: parentLength > EPSILON ? length / parentLength : 1,
      magnification: length > EPSILON ? parentLength / length : 1,
      bounds: pointBounds(current),
      center: current[Math.floor(current.length * 0.5)] ?? { x: 0, y: 0 },
      minimumCriticalDistance: Math.min(...current.map((point) => Math.hypot(point.x, point.y))),
      signal,
      comparison: comparePitchSignals(parentSignal, signal, samples),
    });
  }
  return {
    cReal: finite(cReal),
    cImag: finite(cImag),
    branch: finite(branch, 1) < 0 ? -1 : 1,
    levels,
  };
}

/** Enumerate all 2^depth inverse-branch locations without choosing an audio chain. */
export function buildInverseArcTree(parentPoints, {
  cReal = -0.7,
  cImag = 0.27015,
  depth = 3,
  samples = 192,
} = {}) {
  const levelCount = clamp(Math.trunc(finite(depth, 3)), 1, 6);
  const levels = [[resampleOpenArc(parentPoints, samples)]];
  for (let level = 1; level <= levelCount; level += 1) {
    const children = [];
    for (const parent of levels[level - 1]) {
      children.push(
        resampleOpenArc(inverseJuliaArc(parent, cReal, cImag, 1), samples),
        resampleOpenArc(inverseJuliaArc(parent, cReal, cImag, -1), samples),
      );
    }
    levels.push(children);
  }
  return { cReal: finite(cReal), cImag: finite(cImag), levels };
}

/** Compute local signal proxies and algebraic sanity checks for the five ideas. */
export function evaluateSimilarityPlans(family) {
  const levels = family?.levels ?? [];
  if (levels.length < 2) return null;
  const reference = levels[0];
  const descendants = levels.slice(1);
  const chorusScore = clamp(
    median(descendants.map((level) => level.comparison.pitchCorrelation)),
    0,
    1,
  );
  const canonScore = median(descendants.map((level) => level.comparison.score));

  const referenceBands = multiscalePitchBands(reference.signal);
  const bandScores = descendants.map((level) => {
    const bands = multiscalePitchBands(level.signal);
    return mean(referenceBands.map((band, index) => (
      Math.max(0, comparePitchSignals(band, bands[index]).pitchCorrelation)
    )));
  });

  const orbitScores = descendants.map((level) => {
    let recovered = level.points;
    for (let iteration = 0; iteration < level.depth; iteration += 1) {
      recovered = forwardJuliaArc(recovered, family.cReal, family.cImag);
    }
    return comparePitchSignals(reference.signal, pitchSignalForArc(recovered)).score;
  });

  const harmonyScores = descendants.map((level) => level.comparison.score);
  return {
    chorus: {
      score: chorusScore,
      shapeBearing: true,
      summary: "The same tangent melody is layered at measured arc-length-derived tempos.",
    },
    canon: {
      score: canonScore,
      shapeBearing: true,
      summary: "Repeated turn motifs enter later as time-scaled inverse-image echoes.",
    },
    wavelet: {
      score: median(bandScores),
      shapeBearing: true,
      summary: "Coarse, middle, and fine curvature remain comparable across scale.",
    },
    orbit: {
      score: median(orbitScores),
      shapeBearing: "arc-only",
      summary: "Exact f∘g round-trip check only; a raw point orbit does not carry an outline.",
    },
    harmony: {
      score: median(harmonyScores),
      shapeBearing: false,
      summary: "Harmony reports similarity confidence rather than carrying the outline.",
    },
  };
}

function iterateWithDerivative(point, c, period) {
  let value = { ...point };
  let derivative = { x: 1, y: 0 };
  for (let iteration = 0; iteration < period; iteration += 1) {
    derivative = complexMultiply({ x: 2 * value.x, y: 2 * value.y }, derivative);
    const squared = complexSquare(value);
    value = { x: squared.x + c.x, y: squared.y + c.y };
  }
  return { value, derivative };
}

function periodicResidual(point, c, period) {
  const result = iterateWithDerivative(point, c, period);
  return {
    residual: { x: result.value.x - point.x, y: result.value.y - point.y },
    jacobian: { x: result.derivative.x - 1, y: result.derivative.y },
    multiplier: result.derivative,
  };
}

/** Locate low-period repelling points whose multipliers predict zoom and rotation. */
export function findRepellingPeriodicPoints(cReal, cImag, {
  maxPeriod = 3,
  seedGrid = 11,
  maxIterations = 48,
} = {}) {
  const c = { x: finite(cReal), y: finite(cImag) };
  const periodCap = clamp(Math.trunc(finite(maxPeriod, 3)), 1, 6);
  const seeds = clamp(Math.trunc(finite(seedGrid, 11)), 5, 31);
  const roots = [];
  for (let period = 1; period <= periodCap; period += 1) {
    for (let row = 0; row < seeds; row += 1) {
      for (let column = 0; column < seeds; column += 1) {
        let point = {
          x: -2 + 4 * column / (seeds - 1),
          y: -2 + 4 * row / (seeds - 1),
        };
        let converged = false;
        for (let iteration = 0; iteration < maxIterations; iteration += 1) {
          const { residual, jacobian } = periodicResidual(point, c, period);
          if (Math.hypot(residual.x, residual.y) < 1e-10) {
            converged = true;
            break;
          }
          const step = complexDivide(residual, jacobian);
          if (!step || !Number.isFinite(step.x) || !Number.isFinite(step.y)) break;
          point = { x: point.x - step.x, y: point.y - step.y };
          if (Math.hypot(point.x, point.y) > 16) break;
        }
        if (!converged) continue;
        let exactPeriod = period;
        for (let divisor = 1; divisor < period; divisor += 1) {
          if (period % divisor) continue;
          const lower = periodicResidual(point, c, divisor).residual;
          if (Math.hypot(lower.x, lower.y) < 1e-7) {
            exactPeriod = divisor;
            break;
          }
        }
        if (exactPeriod !== period) continue;
        if (roots.some((root) => root.period === period && distance(root, point) < 1e-6)) continue;
        const { multiplier } = periodicResidual(point, c, period);
        const magnification = Math.hypot(multiplier.x, multiplier.y);
        if (!(magnification > 1.0001)) continue;
        roots.push({
          x: point.x,
          y: point.y,
          period,
          multiplier,
          magnification,
          rotation: Math.atan2(multiplier.y, multiplier.x),
        });
      }
    }
  }
  return roots.sort((a, b) => {
    const rankA = Math.abs(Math.log(a.magnification / 2.5));
    const rankB = Math.abs(Math.log(b.magnification / 2.5));
    return rankA - rankB || a.period - b.period;
  });
}
