export const MIN_VERTEX_COUNT = 3;
export const MAX_VERTEX_COUNT = 64;
export const MAX_VERTEX_COORDINATE = 1.8;

function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

export function wrap01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const wrapped = number % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

export function loopPhaseAtTime(startPhase, elapsedSeconds, durationSeconds, direction = 1) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return wrap01(startPhase);
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  return wrap01(startPhase + (direction < 0 ? -1 : 1) * elapsed / duration);
}

export function scrubPhaseFromAngle(startPhase, accumulatedAngleRadians) {
  return wrap01(startPhase - (Number(accumulatedAngleRadians) || 0) / (Math.PI * 2));
}

export function scrubRateFromMotion(phaseDelta, durationSeconds, elapsedMilliseconds) {
  const elapsed = Math.max(1, Number(elapsedMilliseconds) || 0) / 1000;
  const rate = Math.abs(Number(phaseDelta) || 0) * Math.max(0, Number(durationSeconds) || 0)
    / elapsed;
  return clamp(rate, 0.2, 4);
}

export function mixDelayParametersFromOffsets(
  offsets,
  minimumOffset = -0.34,
  maximumOffset = 0.34,
) {
  const values = Array.from(offsets ?? []);
  if (!values.length) return { inward: 0, outward: 0, time: 0.28, feedback: 0, wet: 0 };
  let inwardEnergy = 0;
  let outwardEnergy = 0;
  for (const offset of values) {
    const value = Number(offset) || 0;
    const inward = clamp(-value / Math.abs(minimumOffset || -1), 0, 1);
    const outward = clamp(value / Math.abs(maximumOffset || 1), 0, 1);
    inwardEnergy += inward * inward;
    outwardEnergy += outward * outward;
  }
  const inward = Math.sqrt(inwardEnergy / values.length);
  const outward = Math.sqrt(outwardEnergy / values.length);
  return {
    inward,
    outward,
    time: 0.28 - inward * 0.23,
    feedback: outward * 0.8,
    wet: clamp(inward * 0.55 + outward * 0.75, 0, 0.9),
  };
}

/**
 * Return a loudness-compensated dry/fuzz mix for a spatial depth amount.
 * The wet trim accounts for the high small-signal gain of Lumber's fixed
 * drive waveshaper; the user level therefore behaves like output level rather
 * than changing the distortion character.
 */
export function fuzzMixGains(intensity, level = 0.2) {
  const amount = clamp(intensity, 0, 1) * clamp(level, 0, 1);
  return {
    dry: 1 - amount * 0.42,
    wet: amount * 0.08,
  };
}

export function presetVertices(preset = "circle", requestedCount = 8) {
  const count = preset === "triangle"
    ? 3
    : preset === "square"
      ? 4
      : Math.round(clamp(requestedCount, MIN_VERTEX_COUNT, MAX_VERTEX_COUNT));
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

export function radialContourVertices(
  offsets,
  minimumOffset = -0.42,
  maximumOffset = 0.62,
) {
  const values = Array.from(offsets ?? []);
  if (values.length < MIN_VERTEX_COUNT) {
    return presetVertices("circle", MIN_VERTEX_COUNT);
  }
  return values.map((offset, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const radius = 1 + clamp(offset, minimumOffset, maximumOffset);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

export function pointOnContour(vertices, phase) {
  if (!vertices?.length) {
    return { x: 0, y: 0, tangent: { x: 1, y: 0 }, segmentIndex: 0, segmentPhase: 0 };
  }
  const count = vertices.length;
  const position = wrap01(phase) * count;
  const segmentIndex = Math.floor(position) % count;
  const nextIndex = (segmentIndex + 1) % count;
  const segmentPhase = position - Math.floor(position);
  const start = vertices[segmentIndex];
  const end = vertices[nextIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1e-9, Math.hypot(dx, dy));
  return {
    x: start.x + dx * segmentPhase,
    y: start.y + dy * segmentPhase,
    tangent: { x: dx / length, y: dy / length },
    segmentIndex,
    segmentPhase,
  };
}

export function nearestContourPhase(vertices, target) {
  if (!vertices?.length) return { phase: 0, distance: Infinity };
  let nearestPhase = 0;
  let nearestDistance = Infinity;
  const count = vertices.length;
  for (let index = 0; index < count; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % count];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared <= 1e-12
      ? 0
      : clamp(
        ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared,
        0,
        1,
      );
    const x = start.x + dx * amount;
    const y = start.y + dy * amount;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPhase = wrap01((index + amount) / count);
    }
  }
  return { phase: nearestPhase, distance: nearestDistance };
}

export function moveVertex(vertices, index, target) {
  const next = (vertices ?? []).map((vertex) => ({ ...vertex }));
  const vertexIndex = Math.round(Number(index));
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= next.length) {
    return next;
  }
  next[vertexIndex] = {
    x: clamp(target?.x, -MAX_VERTEX_COORDINATE, MAX_VERTEX_COORDINATE),
    y: clamp(target?.y, -MAX_VERTEX_COORDINATE, MAX_VERTEX_COORDINATE),
  };
  return next;
}

export function addContourVertex(vertices) {
  const next = (vertices ?? []).map((vertex) => ({ ...vertex }));
  if (!next.length) return presetVertices("circle");
  if (next.length >= MAX_VERTEX_COUNT) return next;
  let longestIndex = 0;
  let longestLength = -1;
  for (let index = 0; index < next.length; index += 1) {
    const start = next[index];
    const end = next[(index + 1) % next.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = index;
    }
  }
  const start = next[longestIndex];
  const end = next[(longestIndex + 1) % next.length];
  next.splice(longestIndex + 1, 0, {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  });
  return next;
}

export function removeContourVertex(vertices, index = -1) {
  const next = (vertices ?? []).map((vertex) => ({ ...vertex }));
  if (next.length <= MIN_VERTEX_COUNT) return next;
  const requested = Math.round(Number(index));
  const vertexIndex = Number.isInteger(requested) && requested >= 0 && requested < next.length
    ? requested
    : next.length - 1;
  next.splice(vertexIndex, 1);
  return next;
}

export function createContourTimeWarp(vertices, amount = 0) {
  const count = vertices?.length ?? 0;
  const cumulative = new Float64Array(Math.max(1, count) + 1);
  if (!count) {
    cumulative[1] = 1;
    return cumulative;
  }
  const strength = clamp(amount, 0, 1);
  const lengths = vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % count];
    return Math.max(1e-6, Math.hypot(next.x - vertex.x, next.y - vertex.y));
  });
  const mean = lengths.reduce((sum, value) => sum + value, 0) / count;
  const weights = lengths.map((length) => 1 + (length / mean - 1) * strength);
  const total = weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < count; index += 1) {
    cumulative[index + 1] = cumulative[index] + weights[index] / total;
  }
  cumulative[count] = 1;
  return cumulative;
}

export function phaseThroughContourTimeWarp(outputPhase, cumulative) {
  if (!cumulative || cumulative.length < 2) return wrap01(outputPhase);
  const phase = wrap01(outputPhase);
  let low = 0;
  let high = cumulative.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle] <= phase) low = middle;
    else high = middle;
  }
  const start = cumulative[low];
  const end = cumulative[low + 1];
  const amount = end - start <= 1e-12 ? 0 : (phase - start) / (end - start);
  return wrap01((low + amount) / (cumulative.length - 1));
}

export function timeStretchLoopSamples(samples, vertices, amount = 0) {
  const length = samples?.length ?? 0;
  const stretched = new Float32Array(length);
  if (!length) return stretched;
  const cumulative = createContourTimeWarp(vertices, amount);
  for (let index = 0; index < length; index += 1) {
    const inputPhase = phaseThroughContourTimeWarp(index / length, cumulative);
    const position = inputPhase * length;
    const first = Math.floor(position) % length;
    const second = (first + 1) % length;
    const mix = position - Math.floor(position);
    stretched[index] = samples[first] + (samples[second] - samples[first]) * mix;
  }
  return stretched;
}

export function contourPitchRatioAt(
  vertices,
  phase,
  depth = 1,
  maximumSemitones = 12,
) {
  const count = vertices?.length ?? 0;
  if (!count) return 1;
  const point = pointOnContour(vertices, phase);
  const radius = Math.hypot(point.x, point.y);
  const radialOffset = radius - 1;
  const normalizedOffset = radialOffset >= 0
    ? radialOffset / 0.62
    : radialOffset / 0.42;
  const semitones = clamp(depth, 0, 1)
    * clamp(maximumSemitones, 0, 24)
    * clamp(normalizedOffset, -1, 1);
  return 2 ** (semitones / 12);
}

function wrappedSample(samples, position) {
  const length = samples.length;
  const wrapped = ((position % length) + length) % length;
  const first = Math.floor(wrapped);
  const second = (first + 1) % length;
  const amount = wrapped - first;
  return samples[first] + (samples[second] - samples[first]) * amount;
}

/**
 * Pitch-shift short contour regions with center-anchored grains. Grain centers
 * stay on the original timeline, so the complete loop duration never changes.
 */
export function pitchShiftLoopSamplesByContour(samples, vertices, depth = 0.65) {
  const length = samples?.length ?? 0;
  if (!length) return new Float32Array(0);
  const strength = clamp(depth, 0, 1);
  if (strength <= 1e-6 || length < 32) return Float32Array.from(samples);

  const grainSize = Math.min(
    4096,
    2 ** Math.max(5, Math.floor(Math.log2(Math.max(32, length / 2)))),
  );
  const halfGrain = Math.floor(grainSize / 2);
  const hop = Math.max(8, Math.floor(grainSize / 4));
  const output = new Float64Array(length);
  const weights = new Float64Array(length);

  for (let center = 0; center < length; center += hop) {
    const ratio = contourPitchRatioAt(vertices, center / length, strength);
    for (let index = 0; index < grainSize; index += 1) {
      const local = index - halfGrain;
      const outputIndex = ((center + local) % length + length) % length;
      const window = Math.sin(Math.PI * (index + 0.5) / grainSize) ** 2;
      output[outputIndex] += wrappedSample(samples, center + local * ratio) * window;
      weights[outputIndex] += window;
    }
  }

  const shifted = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    shifted[index] = weights[index] > 1e-9
      ? output[index] / weights[index]
      : samples[index];
  }
  return shifted;
}

export function waveformEnvelope(samples, requestedBins = 256) {
  const length = samples?.length ?? 0;
  const binCount = Math.max(1, Math.min(length || 1, Math.round(requestedBins) || 1));
  const minimums = new Float32Array(binCount);
  const maximums = new Float32Array(binCount);
  if (!length) return { minimums, maximums };
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor(bin * length / binCount);
    const end = Math.max(start + 1, Math.floor((bin + 1) * length / binCount));
    let minimum = 1;
    let maximum = -1;
    for (let index = start; index < Math.min(end, length); index += 1) {
      const sample = clamp(samples[index], -1, 1);
      minimum = Math.min(minimum, sample);
      maximum = Math.max(maximum, sample);
    }
    minimums[bin] = minimum;
    maximums[bin] = maximum;
  }
  return { minimums, maximums };
}

export function reverseSamples(samples) {
  const reversed = new Float32Array(samples?.length ?? 0);
  for (let index = 0; index < reversed.length; index += 1) {
    reversed[index] = samples[reversed.length - index - 1];
  }
  return reversed;
}

export function fadeLoopEdges(samples, sampleRate, durationSeconds = 0.008) {
  const faded = Float32Array.from(samples ?? []);
  const fadeLength = Math.min(
    Math.floor(faded.length / 2),
    Math.max(0, Math.round((Number(sampleRate) || 0) * durationSeconds)),
  );
  for (let index = 0; index < fadeLength; index += 1) {
    const gain = index / Math.max(1, fadeLength);
    faded[index] *= gain;
    faded[faded.length - index - 1] *= gain;
  }
  return faded;
}
