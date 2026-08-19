import { clamp } from "./striped-staircase.js";

const NEIGHBORS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
const TAU = Math.PI * 2;
const DEPTH_EVENT_SLICES = 96;

function smoothEscapeIteration(real, imaginary, maxIterations) {
  let x = 0;
  let y = 0;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const xSquared = x * x;
    const ySquared = y * y;
    y = 2 * x * y + imaginary;
    x = xSquared - ySquared + real;
    const magnitudeSquared = x * x + y * y;
    if (magnitudeSquared > 256) {
      const logMagnitude = 0.5 * Math.log(magnitudeSquared);
      return iteration + 1 - Math.log(Math.max(0.000001, logMagnitude)) / Math.log(2);
    }
  }
  return null;
}

/** Build a low-resolution playable field for one escape-depth band. */
export function createStaircaseShapeField(
  camera,
  bandLow,
  bandHigh,
  maxIterations,
  { width = 88, height = 56, polarity = "white" } = {},
) {
  const columns = Math.max(12, Math.round(width));
  const rows = Math.max(8, Math.round(height));
  const aspect = columns / rows;
  const active = new Uint8Array(columns * rows);
  const depth = new Float32Array(columns * rows);
  const labels = new Int16Array(columns * rows);
  labels.fill(-1);

  for (let row = 0; row < rows; row += 1) {
    const imaginary = camera.centerY + (1 - ((row + 0.5) / rows) * 2) * camera.scale;
    for (let column = 0; column < columns; column += 1) {
      const real = camera.centerX
        + (((column + 0.5) / columns) * 2 - 1) * aspect * camera.scale;
      const iteration = smoothEscapeIteration(real, imaginary, maxIterations);
      const inBand = iteration !== null && iteration >= bandLow && iteration < bandHigh;
      const index = row * columns + column;
      active[index] = polarity === "black" ? Number(!inBand) : Number(inBand);
      depth[index] = iteration ?? maxIterations;
    }
  }

  const visited = new Uint8Array(active.length);
  const components = [];
  for (let start = 0; start < active.length; start += 1) {
    if (!active[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let cells = 0;
    let sumX = 0;
    let sumY = 0;
    let sumDepth = 0;
    let perimeter = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const row = Math.floor(index / columns);
      const column = index - row * columns;
      cells += 1;
      sumX += (column + 0.5) / columns;
      sumY += (row + 0.5) / rows;
      sumDepth += depth[index];
      for (const [dx, dy] of NEIGHBORS) {
        const nextX = column + dx;
        const nextY = row + dy;
        if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) {
          perimeter += 1;
          continue;
        }
        const next = nextY * columns + nextX;
        if (!active[next]) {
          perimeter += 1;
        } else if (!visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    const componentIndex = components.length;
    for (const index of queue) labels[index] = componentIndex;
    components.push(Object.freeze({
      index: componentIndex,
      cells,
      area: cells / active.length,
      x: sumX / cells,
      y: sumY / cells,
      depth: sumDepth / cells,
      edgeRatio: clamp(perimeter / Math.max(4, cells * 4), 0, 1),
    }));
  }

  return Object.freeze({
    columns,
    rows,
    active,
    depth,
    labels,
    components: Object.freeze(components),
    polarity: polarity === "black" ? "black" : "white",
  });
}

/**
 * Low-resolution connected-component analysis for the currently audible
 * escape-depth band. It runs only when the staircase enters a new step.
 */
export function analyzeStaircaseBlobs(
  camera,
  bandLow,
  bandHigh,
  maxIterations,
  { width = 56, height = 36, polarity = "white", limit = 12 } = {},
) {
  const field = createStaircaseShapeField(camera, bandLow, bandHigh, maxIterations, {
    width,
    height,
    polarity,
  });
  return Object.freeze([...field.components]
    .sort((left, right) => right.cells - left.cells)
    .slice(0, Math.max(1, Math.round(limit))));
}

function interpolateDepthPoint(a, b, valueA, valueB, threshold) {
  const denominator = valueB - valueA;
  const amount = Math.abs(denominator) < 1e-12
    ? 0.5
    : clamp((threshold - valueA) / denominator, 0, 1);
  return Object.freeze({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  });
}

function contourPointKey(point, columns, rows) {
  return `${Math.round(point.x * columns * 4096)}:${Math.round(point.y * rows * 4096)}`;
}

function depthContourSegments(field, threshold) {
  const segments = [];
  const crosses = (left, right) => (left < threshold) !== (right < threshold);
  for (let row = 0; row < field.rows - 1; row += 1) {
    for (let column = 0; column < field.columns - 1; column += 1) {
      const topLeftIndex = row * field.columns + column;
      const topRightIndex = topLeftIndex + 1;
      const bottomLeftIndex = topLeftIndex + field.columns;
      const bottomRightIndex = bottomLeftIndex + 1;
      const values = [
        field.depth[topLeftIndex],
        field.depth[topRightIndex],
        field.depth[bottomRightIndex],
        field.depth[bottomLeftIndex],
      ];
      const points = [
        { x: column / (field.columns - 1), y: row / (field.rows - 1) },
        { x: (column + 1) / (field.columns - 1), y: row / (field.rows - 1) },
        { x: (column + 1) / (field.columns - 1), y: (row + 1) / (field.rows - 1) },
        { x: column / (field.columns - 1), y: (row + 1) / (field.rows - 1) },
      ];
      const hits = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const next = (edge + 1) % 4;
        if (crosses(values[edge], values[next])) {
          hits.push(interpolateDepthPoint(
            points[edge], points[next], values[edge], values[next], threshold,
          ));
        }
      }
      if (hits.length === 2) {
        segments.push({ a: hits[0], b: hits[1] });
      } else if (hits.length === 4) {
        segments.push({ a: hits[0], b: hits[1] }, { a: hits[2], b: hits[3] });
      }
    }
  }
  return segments;
}

function contourPaths(field, threshold) {
  const segments = depthContourSegments(field, threshold);
  const byEndpoint = new Map();
  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const key = contourPointKey(point, field.columns, field.rows);
      const neighbors = byEndpoint.get(key) ?? [];
      neighbors.push(index);
      byEndpoint.set(key, neighbors);
    }
  });
  const paths = [];
  const used = new Uint8Array(segments.length);
  const extend = (points, atFront) => {
    while (true) {
      const endpoint = atFront ? points[0] : points.at(-1);
      const key = contourPointKey(endpoint, field.columns, field.rows);
      const nextIndex = byEndpoint.get(key)?.find((index) => !used[index]);
      if (nextIndex === undefined) return;
      used[nextIndex] = 1;
      const segment = segments[nextIndex];
      const other = contourPointKey(segment.a, field.columns, field.rows) === key
        ? segment.b
        : segment.a;
      if (atFront) points.unshift(other);
      else points.push(other);
    }
  };
  segments.forEach((segment, index) => {
    if (used[index]) return;
    used[index] = 1;
    const points = [segment.a, segment.b];
    extend(points, false);
    extend(points, true);
    if (points.length >= 3) paths.push(points);
  });
  return paths;
}

function contourContact(points, index, threshold) {
  let length = 0;
  let bend = 0;
  let signedArea = 0;
  let sumX = 0;
  let sumY = 0;
  let minimumX = 1;
  let maximumX = 0;
  let minimumY = 1;
  let maximumY = 0;
  points.forEach((point, pointIndex) => {
    sumX += point.x;
    sumY += point.y;
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
    if (pointIndex > 0) {
      const previous = points[pointIndex - 1];
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      signedArea += previous.x * point.y - point.x * previous.y;
    }
    if (pointIndex > 0 && pointIndex < points.length - 1) {
      const previous = points[pointIndex - 1];
      const next = points[pointIndex + 1];
      const incoming = Math.atan2(point.y - previous.y, point.x - previous.x);
      const outgoing = Math.atan2(next.y - point.y, next.x - point.x);
      bend += Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
    }
  });
  const closed = Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 0.03;
  if (closed) signedArea += points.at(-1).x * points[0].y - points[0].x * points.at(-1).y;
  const boxArea = (maximumX - minimumX) * (maximumY - minimumY);
  const enclosedArea = closed ? Math.abs(signedArea) * 0.5 : 0;
  const centerX = sumX / points.length;
  const centerY = sumY / points.length;
  const topologyKey = [
    closed ? "loop" : "open",
    Math.round(centerX * 12),
    Math.round(centerY * 9),
    Math.round((maximumX - minimumX) * 8),
    Math.round((maximumY - minimumY) * 8),
  ].join(":");
  return Object.freeze({
    key: `depth-branch:${topologyKey}`,
    componentIndex: index,
    x: centerX,
    y: centerY,
    size: clamp(length / 2.5, 0.005, 1),
    depth: threshold,
    edgeRatio: clamp((bend / Math.max(1, points.length - 2)) / Math.PI * 2.4, 0, 1),
    area: clamp(Math.max(enclosedArea, boxArea * 0.24, length * length / (8 * Math.PI)), 0.00001, 1),
    length,
    closed,
  });
}

/**
 * Read the animated iso-depth contour already drawn by the staircase shader.
 * Every simultaneous branch becomes one contact; time remains escape depth.
 */
export function staircaseDepthContourContacts(field, threshold, depthPhase = 0) {
  const collisions = new Map();
  const runs = contourPaths(field, threshold)
    .map((points, index) => contourContact(points, index, threshold))
    .sort((left, right) => right.length - left.length)
    .slice(0, 24)
    .map((contact, index) => {
      const occurrence = collisions.get(contact.key) ?? 0;
      collisions.set(contact.key, occurrence + 1);
      return Object.freeze({
        ...contact,
        componentIndex: index,
        key: `${contact.key}:${occurrence}`,
      });
    });
  const edges = runs.map((contact, index) => Object.freeze({
    ...contact,
    key: `depth-contour:${index}`,
    side: index % 2 === 0 ? -1 : 1,
  }));
  const phase = clamp(depthPhase, 0, 1);
  return Object.freeze({
    timeSlice: Math.min(DEPTH_EVENT_SLICES - 1, Math.floor(phase * DEPTH_EVENT_SLICES)),
    phase,
    threshold,
    runs: Object.freeze(runs),
    edges: Object.freeze(edges),
  });
}

export function voicesForStaircaseContacts(contacts, frame, mapping = {}, mode = "fill") {
  const source = mode === "edge" ? contacts.edges : contacts.runs;
  const baseFrequency = clamp(mapping.baseFrequency ?? 73, 24, 880);
  const pitchRange = clamp(mapping.pitchRange ?? 3, 0, 8);
  const stereoSpread = clamp(mapping.stereoSpread ?? 0.85, 0, 1);
  const microLevel = clamp(mapping.microLevel ?? 0.45, 0, 1);
  const colorSoundMode = ["shepard", "rattlesnake", "ouroboros", "decomposition", "ink"]
    .includes(mapping.colorSoundMode)
    ? mapping.colorSoundMode
    : "manual";
  const depthAmount = frame.stepCount <= 1 ? 0 : frame.stepIndex / (frame.stepCount - 1);
  const normalizer = 1 / Math.sqrt(Math.max(1, source.length));
  return Object.freeze(source.slice(0, 24).map((contact, index) => {
    // Absolute screen area keeps register meaningful across depth: a region
    // that shrinks on the next stair really does move out of the tuba range.
    const mass = clamp(Math.sqrt(contact.area / 0.3), 0, 1);
    const thickness = Math.sqrt(clamp(contact.size, 0, 1));
    const verticalInflection = (1 - contact.y) * 0.18;
    const pitch = clamp((1 - mass) * 0.7 + verticalInflection + depthAmount * 0.12, 0, 1);
    const contour = clamp(contact.edgeRatio, 0, 1);
    const sizeGain = mode === "edge" ? 0.11 : 0.055 + thickness * 0.18;
    const voice = {
      key: `${mode}:step-${frame.stepIndex}:${contact.key ?? index}`,
      frequency: baseFrequency * 2 ** (pitch * pitchRange),
      gain: clamp(sizeGain * normalizer, 0, 0.2),
      pan: (contact.x * 2 - 1) * stereoSpread,
      waveform: mass > 0.72 ? "sawtooth" : mass > 0.38 ? "triangle" : "sine",
      mode: mode === "edge" ? "pm" : "fm",
      synthDrive: clamp(
        microLevel * 1.6 * (contour * 0.72 + (1 - thickness) * 0.28),
        0,
        1,
      ),
      modulationIndex: mode === "edge"
        ? 0.35 + microLevel * (0.6 + contour * 8)
        : 0.2 + microLevel * (0.5 + contour * 6 + (1 - thickness) * 2.5),
      modulationRatio: mode === "edge"
        ? 1 + (contact.side > 0 ? 0.5 : 1)
        : 0.5 + Math.round((1 + contour * 3) * 2) / 2,
      gainSmoothingSeconds: 0.012 + mass * 0.11,
    };
    if (colorSoundMode === "shepard") {
      const travel = (Number(mapping.transportProgress) || 0) * Math.max(1, pitchRange);
      Object.assign(voice, {
        frequency: baseFrequency,
        waveform: "sine",
        mode: "shepard",
        synthDrive: clamp(contour + (1 - thickness) * 0.3, 0, 1),
        shepardPosition: ((travel + contact.y * 0.18) % 1 + 1) % 1,
        shepardTravel: travel + contact.y * 0.18,
        shepardRate: (Number(mapping.transportRate) || 0) * Math.max(1, pitchRange),
        shepardWidth: clamp(3 + mass * 5, 2, 8),
      });
    } else if (colorSoundMode === "ouroboros") {
      const loopPhase = ((Number(mapping.transportProgress) || 0) + contact.y) * TAU;
      Object.assign(voice, {
        frequency: voice.frequency * 2 ** (Math.sin(loopPhase) * 0.16),
        mode: "pm",
        waveform: "triangle",
        modulationIndex: 0.25 + microLevel * (1 + contour * 7),
        modulationRatio: 0.5 + ((componentCycle(contact.componentIndex) + frame.stepIndex) % 4) * 0.5,
      });
    } else if (colorSoundMode === "rattlesnake") {
      const detail = clamp((1 - mass) * 0.62 + contour * 0.38, 0, 1);
      Object.assign(voice, {
        mode: "fm",
        waveform: detail < 0.28 ? "sawtooth" : detail < 0.68 ? "triangle" : "alternating",
        synthDrive: detail,
        modulationIndex: 0.35 + detail * 5.8,
        modulationRatio: 0.5 + detail * 3.5,
        gainSmoothingSeconds: 0.01 + mass * 0.14,
      });
    } else if (colorSoundMode === "decomposition") {
      const upperHalf = contact.y < 0.5;
      const rightHalf = contact.x >= 0.5;
      Object.assign(voice, {
        frequency: voice.frequency * (upperHalf ? 1.5 : 1),
        pan: (rightHalf ? 0.72 : -0.72) * stereoSpread,
        mode: upperHalf === rightHalf ? "fm" : "pm",
        waveform: upperHalf ? "triangle" : "sawtooth",
        synthDrive: clamp(0.2 + contour * 0.8, 0, 1),
        modulationIndex: 0.3 + microLevel * (1.2 + contour * 5),
        modulationRatio: rightHalf ? 1.5 : 0.75,
      });
    } else if (colorSoundMode === "ink") {
      Object.assign(voice, {
        mode: "sine",
        waveform: "sine",
        synthDrive: 0,
        modulationIndex: 0,
        modulationRatio: 1,
      });
    }
    return Object.freeze(voice);
  }));
}

/**
 * Align the short look-ahead trajectory to voices that are audible now.
 * A branch absent at the next intrinsic depth fades out; future-only branches
 * begin on the next control frame instead of inheriting an unrelated drone.
 */
export function contourVoiceTrajectory(currentVoices, futureVoices) {
  const futureByKey = new Map(futureVoices.map((voice) => [voice.key, voice]));
  return Object.freeze({
    current: Object.freeze([...currentVoices]),
    future: Object.freeze(currentVoices.map((voice) => Object.freeze(
      futureByKey.get(voice.key) ?? { ...voice, gain: 0 },
    ))),
  });
}

function componentCycle(value) {
  const numeric = Math.abs(Math.trunc(Number(value) || 0));
  return numeric % 4;
}

export function staircaseStepWeights(settings) {
  const steps = Math.max(1, Math.round(settings.steps));
  const boundaries = Array.from({ length: steps + 1 }, (_, index) => {
    const amount = Math.pow(index / steps, settings.spacingCurve);
    return settings.startIteration + (settings.maxIterations - settings.startIteration) * amount;
  });
  const inverseWidths = Array.from({ length: steps }, (_, index) =>
    1 / Math.max(0.000001, boundaries[index + 1] - boundaries[index]));
  const total = inverseWidths.reduce((sum, value) => sum + value, 0);
  return Object.freeze(inverseWidths.map((value) => value / total));
}

/** Local progress rate which gives each step a duration proportional to its
 * inverse escape-depth width. Later, broader iteration bands therefore pass
 * faster, while the full 0..1 traversal keeps the equal-time duration. */
export function staircaseGeometryRate(progress, settings) {
  const weights = staircaseStepWeights(settings);
  const step = Math.min(weights.length - 1, Math.floor(clamp(progress, 0, 0.999999) * weights.length));
  return 1 / Math.max(0.000001, weights[step] * weights.length);
}

export function voicesForStaircaseBlobs(blobs, frame, mapping = {}) {
  const baseFrequency = clamp(mapping.baseFrequency ?? 73, 24, 880);
  const pitchRange = clamp(mapping.pitchRange ?? 3, 0, 8);
  const stereoSpread = clamp(mapping.stereoSpread ?? 0.85, 0, 1);
  const noiseAmount = clamp(mapping.noiseAmount ?? 0.55, 0, 1);
  const durationScale = clamp(mapping.durationScale ?? 0.55, 0.05, 2);
  const maximumArea = Math.max(0.000001, ...blobs.map((blob) => blob.area));
  const depthAmount = frame.stepCount <= 1 ? 0 : frame.stepIndex / (frame.stepCount - 1);

  return Object.freeze(blobs.map((blob, index) => {
    const relativeSize = Math.sqrt(blob.area / maximumArea);
    const verticalPitch = (1 - blob.y) * 0.7;
    const depthPitch = depthAmount * 0.3;
    const pitch = clamp(verticalPitch + depthPitch, 0, 1);
    return Object.freeze({
      voice: Object.freeze({
        key: `staircase:${frame.stepIndex}:${index}`,
        frequency: baseFrequency * 2 ** (pitch * pitchRange),
        gain: clamp(0.045 + relativeSize * 0.18, 0, 0.24),
        pan: (blob.x * 2 - 1) * stereoSpread,
        waveform: depthAmount > 0.72 ? 2 : index % 2,
      }),
      envelope: Object.freeze({
        attackSeconds: 0.002 + (1 - relativeSize) * 0.012,
        decaySeconds: clamp(durationScale * (0.12 + relativeSize * 0.88), 0.04, 2),
        attackNoise: clamp(noiseAmount * (blob.edgeRatio * 0.75 + depthAmount * 0.55), 0, 1),
      }),
      blob,
    });
  }));
}
