import {
  evaluateMappingCurve,
  mappingCurvePreset,
  sanitizeMappingCurve,
} from "./mapping.js";

/**
 * Pure data, geometry, timing, symmetry, transform, and mapping helpers for
 * Playhead Paint. The module deliberately has no DOM or Web Audio dependency.
 */

export const PLAYHEAD_PAINT_SCHEMA_VERSION = 1;
export const PLAYHEAD_PAINT_SAMPLE_VERSION = 1;

export const REFLECTION_AXES = Object.freeze([
  "horizontal",
  "vertical",
  "diagonal",
  "antiDiagonal",
]);

export const PAINT_MAPPING_TARGETS = Object.freeze([
  "none",
  "pitch",
  "pan",
  "gain",
  "timbre",
]);

export const PLAYHEAD_PAINT_POLAR_CENTER_BLEND_RADIUS = 0.08;

const MAX_TIME_MS = 86_400_000;
const MAX_ENVELOPE_MS = 60_000;
const MAX_COORDINATE = 1_000_000;
const MIN_SCALE = 0.001;
const MAX_SCALE = 16;
const EPSILON = 1e-12;
const DEFAULT_COLOR = "#5fe8c4";
const DEFAULT_BRUSH_SIZE = 0.014;
const DEFAULT_SAMPLE = Object.freeze({
  version: PLAYHEAD_PAINT_SAMPLE_VERSION,
  x: 0.5,
  y: 0.5,
  tMs: 0,
  pressure: 0.5,
});
const DEFAULT_ENVELOPE = Object.freeze({
  attackMs: 12,
  decayMs: 120,
  sustain: 0.72,
  releaseMs: 240,
});
const WAVEFORMS = new Set(["sine", "triangle", "sawtooth", "square", "fm"]);
const TARGETS = new Set(PAINT_MAPPING_TARGETS);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteCoordinate(value, fallback = 0.5) {
  return clamp(finiteNumber(value, fallback), -MAX_COORDINATE, MAX_COORDINATE);
}

function numberFromKeys(source, keys, fallback) {
  if (!source || typeof source !== "object") return fallback;
  for (const key of keys) {
    if (source[key] === null || source[key] === undefined || source[key] === "") continue;
    const number = Number(source[key]);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

function normalizeDegrees(value) {
  const degrees = finiteNumber(value, 0);
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function safeId(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const normalized = candidate
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function cloneSample(sample) {
  return {
    version: PLAYHEAD_PAINT_SAMPLE_VERSION,
    x: sample.x,
    y: sample.y,
    tMs: sample.tMs,
    pressure: sample.pressure,
  };
}

/** Sanitize one normalized recording sample without mutating the source. */
export function sanitizeSample(sample, {
  fallback = DEFAULT_SAMPLE,
  tMs = undefined,
  clampCoordinates = true,
} = {}) {
  const source = sample && typeof sample === "object" ? sample : {};
  const fallbackPoint = fallback && typeof fallback === "object" ? fallback : DEFAULT_SAMPLE;
  const rawX = numberFromKeys(source, ["x", "clientX", "u"], fallbackPoint.x ?? 0.5);
  const rawY = numberFromKeys(source, ["y", "clientY", "v"], fallbackPoint.y ?? 0.5);
  const sampleTime = tMs === undefined
    ? numberFromKeys(source, ["tMs", "timeMs", "time", "timestamp"], fallbackPoint.tMs ?? 0)
    : finiteNumber(tMs, fallbackPoint.tMs ?? 0);
  const pressure = numberFromKeys(
    source,
    ["pressure", "force"],
    fallbackPoint.pressure ?? 0.5,
  );
  return {
    version: PLAYHEAD_PAINT_SAMPLE_VERSION,
    x: clampCoordinates ? clamp(rawX, 0, 1) : finiteCoordinate(rawX, fallbackPoint.x ?? 0.5),
    y: clampCoordinates ? clamp(rawY, 0, 1) : finiteCoordinate(rawY, fallbackPoint.y ?? 0.5),
    tMs: clamp(sampleTime, 0, MAX_TIME_MS),
    pressure: clamp(pressure, 0, 1),
  };
}

/**
 * Sanitize samples as mark-relative time. The first finite source time becomes
 * zero and later times are repaired to be monotonically non-decreasing.
 * Empty input becomes one safe center sample so taps and malformed persistence
 * remain drawable and playable.
 */
export function sanitizeTimedPoints(points, { clampCoordinates = true } = {}) {
  const source = Array.isArray(points) && points.length ? points : [DEFAULT_SAMPLE];
  let origin = null;
  for (const point of source) {
    const raw = numberFromKeys(point, ["tMs", "timeMs", "time", "timestamp"], Number.NaN);
    if (Number.isFinite(raw)) {
      origin = raw;
      break;
    }
  }
  if (!Number.isFinite(origin)) origin = 0;

  let previousTime = 0;
  let previousPoint = DEFAULT_SAMPLE;
  return source.map((point, index) => {
    const rawTime = numberFromKeys(
      point,
      ["tMs", "timeMs", "time", "timestamp"],
      origin + previousTime,
    );
    const relative = index === 0 ? 0 : clamp(rawTime - origin, 0, MAX_TIME_MS);
    const monotonicTime = Math.max(previousTime, relative);
    const sanitized = sanitizeSample(point, {
      fallback: previousPoint,
      tMs: monotonicTime,
      clampCoordinates,
    });
    previousTime = sanitized.tMs;
    previousPoint = sanitized;
    return sanitized;
  });
}

/** Return a bounded four-stage ADSR description in milliseconds. */
export function sanitizeMarkEnvelope(envelope, releaseOverride = undefined) {
  const source = envelope && typeof envelope === "object" ? envelope : {};
  const attackMs = clamp(
    numberFromKeys(source, ["attackMs", "attack"], DEFAULT_ENVELOPE.attackMs),
    0,
    MAX_ENVELOPE_MS,
  );
  const decayMs = clamp(
    numberFromKeys(source, ["decayMs", "decay"], DEFAULT_ENVELOPE.decayMs),
    0,
    MAX_ENVELOPE_MS,
  );
  const sustain = clamp(
    numberFromKeys(source, ["sustain", "sustainLevel"], DEFAULT_ENVELOPE.sustain),
    0,
    1,
  );
  const releaseCandidate = releaseOverride === undefined
    ? numberFromKeys(source, ["releaseMs", "release"], DEFAULT_ENVELOPE.releaseMs)
    : finiteNumber(releaseOverride, DEFAULT_ENVELOPE.releaseMs);
  const releaseMs = clamp(releaseCandidate, 0, MAX_ENVELOPE_MS);
  return { attackMs, decayMs, sustain, releaseMs };
}

/** Sanitize a user transform. Scale is positive; reflection is a separate D4 step. */
export function sanitizeMarkTransform(transform) {
  const source = transform && typeof transform === "object" ? transform : {};
  const uniformScale = numberFromKeys(source, ["scale"], 1);
  const originX = numberFromKeys(source, ["originX", "pivotX"], Number.NaN);
  const originY = numberFromKeys(source, ["originY", "pivotY"], Number.NaN);
  return {
    translateX: clamp(numberFromKeys(source, ["translateX", "x"], 0), -4, 4),
    translateY: clamp(numberFromKeys(source, ["translateY", "y"], 0), -4, 4),
    rotationDeg: normalizeDegrees(numberFromKeys(source, ["rotationDeg", "rotation"], 0)),
    scaleX: clamp(numberFromKeys(source, ["scaleX"], uniformScale), MIN_SCALE, MAX_SCALE),
    scaleY: clamp(numberFromKeys(source, ["scaleY"], uniformScale), MIN_SCALE, MAX_SCALE),
    originX: Number.isFinite(originX) ? finiteCoordinate(originX) : null,
    originY: Number.isFinite(originY) ? finiteCoordinate(originY) : null,
  };
}

/**
 * Sanitize one persisted or newly recorded mark into schema version 1.
 * `durationMs` is never shorter than the final sample. It may be longer for a
 * stationary held tap whose pointer did not produce move samples.
 */
export function sanitizeMark(mark, { fallbackId = "mark-1" } = {}) {
  const source = mark && typeof mark === "object" ? mark : {};
  const points = source.samples ?? source.points ?? source.path;
  const samples = sanitizeTimedPoints(points);
  const sampledDuration = samples.at(-1)?.tMs ?? 0;
  const requestedDuration = numberFromKeys(
    source,
    ["durationMs", "activeDurationMs", "duration"],
    sampledDuration,
  );
  const durationMs = clamp(Math.max(sampledDuration, requestedDuration), 0, MAX_TIME_MS);
  const requestedRelease = numberFromKeys(
    source,
    ["releaseMs"],
    numberFromKeys(source.envelope, ["releaseMs", "release"], DEFAULT_ENVELOPE.releaseMs),
  );
  const envelope = sanitizeMarkEnvelope(source.envelope, requestedRelease);
  const waveformCandidate = typeof source.waveform === "string"
    ? source.waveform.toLowerCase()
    : "sine";
  const color = typeof source.color === "string" && source.color.trim()
    ? source.color.trim().slice(0, 64)
    : DEFAULT_COLOR;
  const startOffsetMs = clamp(
    numberFromKeys(source, ["startOffsetMs", "offsetMs", "startMs"], 0),
    0,
    MAX_TIME_MS,
  );

  return {
    version: PLAYHEAD_PAINT_SCHEMA_VERSION,
    id: safeId(source.id, safeId(fallbackId, "mark-1")),
    startOffsetMs,
    durationMs,
    releaseMs: envelope.releaseMs,
    endOffsetMs: startOffsetMs + durationMs,
    releaseEndOffsetMs: startOffsetMs + durationMs + envelope.releaseMs,
    samples,
    brushSize: clamp(
      numberFromKeys(source, ["brushSize", "penSize", "size"], DEFAULT_BRUSH_SIZE),
      0.0001,
      1,
    ),
    color,
    layerId: safeId(source.layerId ?? source.colorId, "aqua"),
    axes: sanitizeReflectionAxes(source.axes ?? source.reflectionAxes),
    waveform: WAVEFORMS.has(waveformCandidate) ? waveformCandidate : "sine",
    envelope,
    transform: sanitizeMarkTransform(source.transform),
  };
}

function synchronizedError(point, start, end, indexAmount) {
  const duration = end.tMs - start.tMs;
  const amount = duration > EPSILON
    ? clamp((point.tMs - start.tMs) / duration, 0, 1)
    : indexAmount;
  const expectedX = start.x + (end.x - start.x) * amount;
  const expectedY = start.y + (end.y - start.y) * amount;
  const expectedPressure = start.pressure + (end.pressure - start.pressure) * amount;
  return {
    spatial: Math.hypot(point.x - expectedX, point.y - expectedY),
    pressure: Math.abs(point.pressure - expectedPressure),
  };
}

/**
 * Time-aware Ramer-Douglas-Peucker simplification. Error is measured against
 * the position expected at each sample's original timestamp, so velocity
 * changes and pauses survive even when the geometry is collinear. Retained
 * samples keep their exact relative `tMs` values.
 */
export function simplifyTimedPoints(points, tolerance = 0.0015, {
  pressureTolerance = 0.04,
  maxTimeGapMs = Infinity,
} = {}) {
  const samples = sanitizeTimedPoints(points);
  if (samples.length <= 2) return samples.map(cloneSample);
  const spatialTolerance = Math.max(0, finiteNumber(tolerance, 0.0015));
  const safePressureTolerance = Math.max(EPSILON, finiteNumber(pressureTolerance, 0.04));
  const safeMaxTimeGap = Number.isFinite(maxTimeGapMs)
    ? Math.max(0, maxTimeGapMs)
    : Infinity;
  const keep = new Uint8Array(samples.length);
  keep[0] = 1;
  keep[samples.length - 1] = 1;
  const stack = [[0, samples.length - 1]];

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    if (endIndex - startIndex <= 1) continue;
    const start = samples[startIndex];
    const end = samples[endIndex];
    let selectedIndex = -1;
    let selectedScore = 1;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const error = synchronizedError(
        samples[index],
        start,
        end,
        (index - startIndex) / (endIndex - startIndex),
      );
      const spatialScore = spatialTolerance <= EPSILON
        ? (error.spatial > EPSILON ? Infinity : 0)
        : error.spatial / spatialTolerance;
      const pressureScore = error.pressure / safePressureTolerance;
      const gapScore = safeMaxTimeGap === Infinity
        ? 0
        : (end.tMs - start.tMs) / Math.max(EPSILON, safeMaxTimeGap);
      const score = Math.max(spatialScore, pressureScore, gapScore);
      if (score > selectedScore) {
        selectedScore = score;
        selectedIndex = index;
      }
    }

    if (selectedIndex >= 0) {
      keep[selectedIndex] = 1;
      stack.push([startIndex, selectedIndex], [selectedIndex, endIndex]);
    }
  }

  return samples.filter((_, index) => keep[index]).map(cloneSample);
}

/** Return cumulative Euclidean distance for finite path points. */
export function cumulativeArcLengths(points) {
  if (!Array.isArray(points) || !points.length) return [];
  const lengths = new Array(points.length).fill(0);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] ?? {};
    const point = points[index] ?? {};
    const previousX = finiteCoordinate(previous.x);
    const previousY = finiteCoordinate(previous.y);
    const x = finiteCoordinate(point.x, previousX);
    const y = finiteCoordinate(point.y, previousY);
    lengths[index] = lengths[index - 1] + Math.hypot(x - previousX, y - previousY);
  }
  return lengths;
}

/** Finite bounds with explicit non-zero safe spans for division by callers. */
export function pathBounds(points, { fallbackX = 0.5, fallbackY = 0.5 } = {}) {
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of Array.isArray(points) ? points : []) {
    if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) continue;
    const x = finiteCoordinate(Number(point.x), fallbackX);
    const y = finiteCoordinate(Number(point.y), fallbackY);
    count += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!count) {
    const x = finiteCoordinate(fallbackX);
    const y = finiteCoordinate(fallbackY);
    return {
      minX: x,
      maxX: x,
      minY: y,
      maxY: y,
      width: 0,
      height: 0,
      safeWidth: EPSILON,
      safeHeight: EPSILON,
      centerX: x,
      centerY: y,
    };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    safeWidth: Math.max(EPSILON, width),
    safeHeight: Math.max(EPSILON, height),
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

/** Measure a mark without mutating it. */
export function measureMarkPath(mark) {
  const sanitized = sanitizeMark(mark, { fallbackId: mark?.id ?? "mark-1" });
  const cumulativeLengths = cumulativeArcLengths(sanitized.samples);
  return {
    cumulativeLengths,
    totalLength: cumulativeLengths.at(-1) ?? 0,
    durationMs: sanitized.durationMs,
    bounds: pathBounds(sanitized.samples),
  };
}

export function markPathLength(mark) {
  return measureMarkPath(mark).totalLength;
}

function smoothstep(amount) {
  const normalized = clamp(amount, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Convert a normalized square point into safe polar mapping sources.
 *
 * `phase` is circular in [0, 1), optionally quantized to spoke centers. It is
 * suitable for genuinely cyclic destinations. `bearing` folds that phase with
 * cosine, so the two sides of the phase seam agree, and eases toward neutral
 * 0.5 where angle is undefined near the center. Linear destinations should use
 * bearing rather than phase.
 */
export function polarCoordinateSources(point, {
  spokes = 0,
  centerBlendRadius = PLAYHEAD_PAINT_POLAR_CENTER_BLEND_RADIUS,
} = {}) {
  const x = finiteCoordinate(point?.x, 0.5);
  const y = finiteCoordinate(point?.y, 0.5);
  const dx = x - 0.5;
  const dy = y - 0.5;
  const distance = Math.hypot(dx, dy);
  const radius = clamp(distance / Math.SQRT1_2, 0, 1);
  const requestedSpokes = Math.trunc(finiteNumber(spokes, 0));
  const spokeCount = requestedSpokes >= 2 ? clamp(requestedSpokes, 2, 64) : 0;
  const rawPhase = distance <= EPSILON
    ? 0.5
    : ((Math.atan2(dy, dx) / (Math.PI * 2)) % 1 + 1) % 1;
  const phase = spokeCount
    ? (Math.floor(rawPhase * spokeCount) + 0.5) / spokeCount
    : rawPhase;
  const blendRadius = clamp(
    finiteNumber(centerBlendRadius, PLAYHEAD_PAINT_POLAR_CENTER_BLEND_RADIUS),
    EPSILON,
    1,
  );
  const centerBlend = smoothstep(radius / blendRadius);
  const directionalBearing = 0.5 + Math.cos(phase * Math.PI * 2) * 0.5;
  const bearing = clamp(0.5 + (directionalBearing - 0.5) * centerBlend, 0, 1);
  return {
    radius,
    phase,
    bearing,
    rawPhase,
    centerBlend,
    spokeCount,
  };
}

function matrixKey(matrix) {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
    .map((value) => {
      const normalized = Math.abs(value) < 1e-10 ? 0 : value;
      return Number(normalized.toFixed(10));
    })
    .join(",");
}

function freezeMatrix(id, a, b, c, d, e, f) {
  return Object.freeze({ id, a, b, c, d, e, f });
}

/** Canvas-style affine matrix: x'=a*x+c*y+e; y'=b*x+d*y+f. */
export const IDENTITY_TRANSFORM = freezeMatrix("identity", 1, 0, 0, 1, 0, 0);

const D4_TRANSFORM_LIST = Object.freeze([
  IDENTITY_TRANSFORM,
  freezeMatrix("reflect-horizontal", 1, 0, 0, -1, 0, 1),
  freezeMatrix("reflect-vertical", -1, 0, 0, 1, 1, 0),
  freezeMatrix("rotate-180", -1, 0, 0, -1, 1, 1),
  // In canvas coordinates this is the visually rising, bottom-left/top-right axis.
  freezeMatrix("reflect-diagonal", 0, -1, -1, 0, 1, 1),
  // In canvas coordinates this is the visually falling, top-left/bottom-right axis.
  freezeMatrix("reflect-anti-diagonal", 0, 1, 1, 0, 0, 0),
  freezeMatrix("rotate-90", 0, 1, -1, 0, 1, 0),
  freezeMatrix("rotate-270", 0, -1, 1, 0, 0, 1),
]);

export const D4_TRANSFORMS = Object.freeze(Object.fromEntries(
  D4_TRANSFORM_LIST.map((transform) => [transform.id, transform]),
));

/** Constant-power headroom for one to eight simultaneous reflection voices. */
export function polyphonyGainScale(voiceCount) {
  const count = clamp(
    Math.trunc(finiteNumber(voiceCount, 1)),
    1,
    D4_TRANSFORM_LIST.length,
  );
  return 1 / Math.sqrt(count);
}

const D4_BY_KEY = new Map(D4_TRANSFORM_LIST.map((matrix) => [matrixKey(matrix), matrix]));
const AXIS_TRANSFORMS = Object.freeze({
  horizontal: D4_TRANSFORMS["reflect-horizontal"],
  vertical: D4_TRANSFORMS["reflect-vertical"],
  diagonal: D4_TRANSFORMS["reflect-diagonal"],
  antiDiagonal: D4_TRANSFORMS["reflect-anti-diagonal"],
});

function normalizedMatrixValue(value, fallback) {
  const number = finiteNumber(value, fallback);
  if (Math.abs(number) < 1e-10) return 0;
  const integer = Math.round(number);
  return Math.abs(number - integer) < 1e-10 ? integer : clamp(number, -MAX_COORDINATE, MAX_COORDINATE);
}

export function sanitizeAffineTransform(transform, fallback = IDENTITY_TRANSFORM) {
  const source = transform && typeof transform === "object" ? transform : {};
  return {
    id: safeId(source.id, fallback.id ?? "affine"),
    a: normalizedMatrixValue(source.a, fallback.a ?? 1),
    b: normalizedMatrixValue(source.b, fallback.b ?? 0),
    c: normalizedMatrixValue(source.c, fallback.c ?? 0),
    d: normalizedMatrixValue(source.d, fallback.d ?? 1),
    e: normalizedMatrixValue(source.e, fallback.e ?? 0),
    f: normalizedMatrixValue(source.f, fallback.f ?? 0),
  };
}

/** Return `left(right(point))`, matching conventional matrix multiplication. */
export function multiplyAffineTransforms(left, right) {
  const l = sanitizeAffineTransform(left);
  const r = sanitizeAffineTransform(right);
  const matrix = {
    a: l.a * r.a + l.c * r.b,
    b: l.b * r.a + l.d * r.b,
    c: l.a * r.c + l.c * r.d,
    d: l.b * r.c + l.d * r.d,
    e: l.a * r.e + l.c * r.f + l.e,
    f: l.b * r.e + l.d * r.f + l.f,
  };
  const canonical = D4_BY_KEY.get(matrixKey(matrix));
  if (canonical) return canonical;
  return {
    id: `${l.id}-after-${r.id}`,
    ...Object.fromEntries(Object.entries(matrix).map(([key, value]) => [
      key,
      normalizedMatrixValue(value, key === "a" || key === "d" ? 1 : 0),
    ])),
  };
}

/** Build scale-then-rotate-then-translate around a supplied/default pivot. */
export function affineTransformForMarkTransform(transform, {
  originX = 0.5,
  originY = 0.5,
  id = "user-transform",
} = {}) {
  if (
    transform
    && typeof transform === "object"
    && ["a", "b", "c", "d", "e", "f"].every((key) => Number.isFinite(Number(transform[key])))
  ) return sanitizeAffineTransform(transform);

  const sanitized = sanitizeMarkTransform(transform);
  const pivotX = sanitized.originX ?? finiteCoordinate(originX);
  const pivotY = sanitized.originY ?? finiteCoordinate(originY);
  const radians = sanitized.rotationDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = cosine * sanitized.scaleX;
  const b = sine * sanitized.scaleX;
  const c = -sine * sanitized.scaleY;
  const d = cosine * sanitized.scaleY;
  const e = pivotX + sanitized.translateX - a * pivotX - c * pivotY;
  const f = pivotY + sanitized.translateY - b * pivotX - d * pivotY;
  return sanitizeAffineTransform({ id, a, b, c, d, e, f });
}

export function applyAffineTransform(point, transform = IDENTITY_TRANSFORM) {
  const source = point && typeof point === "object" ? point : {};
  const matrix = sanitizeAffineTransform(transform);
  const x = finiteCoordinate(source.x);
  const y = finiteCoordinate(source.y);
  const transformedX = matrix.a * x + matrix.c * y + matrix.e;
  const transformedY = matrix.b * x + matrix.d * y + matrix.f;
  return {
    ...source,
    x: finiteCoordinate(transformedX, x),
    y: finiteCoordinate(transformedY, y),
  };
}

function normalizeAxis(axis) {
  if (typeof axis !== "string") return null;
  const compact = axis.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "horizontal" || compact === "h") return "horizontal";
  if (compact === "vertical" || compact === "v") return "vertical";
  if (["diagonal", "rising", "diag", "d"].includes(compact)) return "diagonal";
  if (["antidiagonal", "falling", "antidiag", "a"].includes(compact)) return "antiDiagonal";
  return null;
}

export function sanitizeReflectionAxes(axes) {
  const selected = Array.isArray(axes)
    ? axes
    : axes instanceof Set ? [...axes] : axes ? [axes] : [];
  const normalized = new Set(selected.map(normalizeAxis).filter(Boolean));
  return REFLECTION_AXES.filter((axis) => normalized.has(axis));
}

/**
 * Close selected center-line reflections under composition. Results are
 * deduplicated matrices in stable D4 order and can never exceed eight.
 */
export function reflectionTransforms(axes = []) {
  const generators = sanitizeReflectionAxes(axes).map((axis) => AXIS_TRANSFORMS[axis]);
  const discovered = new Map([[matrixKey(IDENTITY_TRANSFORM), IDENTITY_TRANSFORM]]);
  let changed = true;
  while (changed && discovered.size < 8) {
    changed = false;
    const current = [...discovered.values()];
    for (const transform of current) {
      for (const generator of generators) {
        for (const composed of [
          multiplyAffineTransforms(generator, transform),
          multiplyAffineTransforms(transform, generator),
        ]) {
          const key = matrixKey(composed);
          if (discovered.has(key)) continue;
          discovered.set(key, D4_BY_KEY.get(key) ?? composed);
          changed = true;
        }
      }
    }
  }
  return D4_TRANSFORM_LIST.filter((transform) => discovered.has(matrixKey(transform)));
}

/** Local user transform, then reflection, then scene transform. */
export function markPointTransformMatrix(
  localTransform = null,
  reflectionTransform = IDENTITY_TRANSFORM,
  sceneTransform = null,
  {
    localOrigin = { x: 0.5, y: 0.5 },
    sceneOrigin = { x: 0.5, y: 0.5 },
  } = {},
) {
  const local = affineTransformForMarkTransform(localTransform, {
    originX: localOrigin?.x,
    originY: localOrigin?.y,
    id: "local",
  });
  const reflection = sanitizeAffineTransform(reflectionTransform);
  const scene = affineTransformForMarkTransform(sceneTransform, {
    originX: sceneOrigin?.x,
    originY: sceneOrigin?.y,
    id: "scene",
  });
  return multiplyAffineTransforms(scene, multiplyAffineTransforms(reflection, local));
}

export function applyMarkPointTransforms(
  point,
  localTransform = null,
  reflectionTransform = IDENTITY_TRANSFORM,
  sceneTransform = null,
  options = {},
) {
  return applyAffineTransform(
    point,
    markPointTransformMatrix(localTransform, reflectionTransform, sceneTransform, options),
  );
}

function interpolateSamplesAtTime(samples, durationMs, timeMs) {
  const target = clamp(finiteNumber(timeMs, 0), 0, Math.max(0, durationMs));
  if (samples.length === 1) return { ...cloneSample(samples[0]), tMs: target, segmentIndex: 0, segmentT: 0 };
  if (target <= samples[0].tMs) return { ...cloneSample(samples[0]), tMs: target, segmentIndex: 0, segmentT: 0 };

  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].tMs <= target) low = middle + 1;
    else high = middle;
  }
  const leftIndex = Math.max(0, low - 1);
  if (leftIndex >= samples.length - 1 || target >= samples.at(-1).tMs) {
    return {
      ...cloneSample(samples.at(-1)),
      tMs: target,
      segmentIndex: Math.max(0, samples.length - 2),
      segmentT: 1,
    };
  }
  const rightIndex = leftIndex + 1;
  const left = samples[leftIndex];
  const right = samples[rightIndex];
  const span = right.tMs - left.tMs;
  const amount = span > EPSILON ? clamp((target - left.tMs) / span, 0, 1) : 1;
  return {
    version: PLAYHEAD_PAINT_SAMPLE_VERSION,
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    pressure: left.pressure + (right.pressure - left.pressure) * amount,
    tMs: target,
    segmentIndex: leftIndex,
    segmentT: amount,
  };
}

/** Interpolate at mark-relative recorded milliseconds, including a held tail. */
export function interpolateRecordedPoint(mark, tMs) {
  const sanitized = sanitizeMark(mark, { fallbackId: mark?.id ?? "mark-1" });
  return interpolateSamplesAtTime(sanitized.samples, sanitized.durationMs, tMs);
}

function interpolateSamplesByDistance(
  samples,
  durationMs,
  distanceOrProgress,
  { units = "progress" } = {},
) {
  const lengths = cumulativeArcLengths(samples);
  const totalLength = lengths.at(-1) ?? 0;
  const raw = finiteNumber(distanceOrProgress, 0);
  const progress = units === "distance"
    ? (totalLength > EPSILON ? clamp(raw / totalLength, 0, 1) : clamp(raw, 0, 1))
    : clamp(raw, 0, 1);
  if (totalLength <= EPSILON) {
    return {
      ...interpolateSamplesAtTime(samples, durationMs, progress * durationMs),
      pathDistance: 0,
      pathProgress: progress,
    };
  }
  const targetDistance = units === "distance"
    ? clamp(raw, 0, totalLength)
    : progress * totalLength;
  if (targetDistance <= 0) {
    return {
      ...cloneSample(samples[0]),
      segmentIndex: 0,
      segmentT: 0,
      pathDistance: 0,
      pathProgress: 0,
    };
  }

  let rightIndex = lengths.findIndex((distance, index) => index > 0 && distance >= targetDistance);
  if (rightIndex < 0) rightIndex = lengths.length - 1;
  let leftIndex = rightIndex - 1;
  while (leftIndex > 0 && lengths[rightIndex] - lengths[leftIndex] <= EPSILON) leftIndex -= 1;
  const left = samples[leftIndex];
  const right = samples[rightIndex];
  const span = lengths[rightIndex] - lengths[leftIndex];
  const amount = span > EPSILON
    ? clamp((targetDistance - lengths[leftIndex]) / span, 0, 1)
    : 1;
  return {
    version: PLAYHEAD_PAINT_SAMPLE_VERSION,
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    pressure: left.pressure + (right.pressure - left.pressure) * amount,
    tMs: left.tMs + (right.tMs - left.tMs) * amount,
    segmentIndex: leftIndex,
    segmentT: amount,
    pathDistance: targetDistance,
    pathProgress: targetDistance / totalLength,
  };
}

/**
 * Interpolate by cumulative path distance. `units` defaults to normalized
 * progress; pass `{units:"distance"}` for canvas-space distance. Zero-length
 * paths fall back to recorded interpolation so held dots remain meaningful.
 */
export function interpolateSteadyPoint(mark, distanceOrProgress, { units = "progress" } = {}) {
  const sanitized = sanitizeMark(mark, { fallbackId: mark?.id ?? "mark-1" });
  return interpolateSamplesByDistance(
    sanitized.samples,
    sanitized.durationMs,
    distanceOrProgress,
    { units },
  );
}

export function interpolateMarkPoint(mark, value, {
  mode = "recorded",
  units = mode === "steady" ? "progress" : "milliseconds",
} = {}) {
  if (mode === "steady") return interpolateSteadyPoint(mark, value, { units });
  const sanitized = sanitizeMark(mark, { fallbackId: mark?.id ?? "mark-1" });
  const timeMs = units === "progress"
    ? clamp(finiteNumber(value, 0), 0, 1) * sanitized.durationMs
    : value;
  return interpolateSamplesAtTime(sanitized.samples, sanitized.durationMs, timeMs);
}

function orderedPair(first, second, minimum, maximum) {
  const low = clamp(finiteNumber(first, minimum), minimum, maximum);
  const high = clamp(finiteNumber(second, maximum), minimum, maximum);
  return low <= high ? [low, high] : [high, low];
}

function normalizeTarget(value, fallback) {
  const candidate = typeof value === "string" ? value.toLowerCase() : fallback;
  if (candidate === "level" || candidate === "amplitude") return "gain";
  if (candidate === "frequency") return "pitch";
  return TARGETS.has(candidate) ? candidate : fallback;
}

/** Sanitize X/Y/size-to-audio routes and their editable response curves. */
export function sanitizeAudioMapping(mapping) {
  const source = mapping && typeof mapping === "object" ? mapping : {};
  const [pitchMinHz, pitchMaxHz] = orderedPair(
    numberFromKeys(source, ["pitchMinHz", "pitchMin"], 55),
    numberFromKeys(source, ["pitchMaxHz", "pitchMax"], 1760),
    1,
    20_000,
  );
  const [panMin, panMax] = orderedPair(source.panMin, source.panMax, -1, 1);
  const [gainMin, gainMax] = orderedPair(source.gainMin, source.gainMax, 0, 1);
  const [timbreMin, timbreMax] = orderedPair(source.timbreMin, source.timbreMax, 0, 1);
  const [sizeMin, sizeMax] = orderedPair(
    numberFromKeys(source, ["sizeMin", "brushSizeMin"], 0.005),
    numberFromKeys(source, ["sizeMax", "brushSizeMax"], 0.06),
    0.0001,
    1,
  );
  return {
    xTarget: normalizeTarget(source.xTarget, "pan"),
    yTarget: normalizeTarget(source.yTarget, "pitch"),
    sizeTarget: normalizeTarget(source.sizeTarget, "timbre"),
    invertX: Boolean(source.invertX),
    invertY: source.invertY === undefined ? true : Boolean(source.invertY),
    invertSize: Boolean(source.invertSize),
    xCurve: sanitizeMappingCurve(source.xCurve ?? mappingCurvePreset("linear")),
    yCurve: sanitizeMappingCurve(source.yCurve ?? mappingCurvePreset("linear")),
    sizeCurve: sanitizeMappingCurve(source.sizeCurve ?? mappingCurvePreset("linear")),
    pitchMinHz,
    pitchMaxHz,
    panMin,
    panMax,
    gainMin,
    gainMax,
    timbreMin,
    timbreMax,
    sizeMin,
    sizeMax,
  };
}

function lerp(minimum, maximum, amount) {
  return minimum + (maximum - minimum) * amount;
}

/**
 * Evaluate a transformed point and mark size. Duplicate target assignments are
 * deterministic: X applies first, then Y, then size.
 */
export function evaluateAudioMapping(point, markOrSize, mapping = {}) {
  const sanitized = sanitizeAudioMapping(mapping);
  const size = typeof markOrSize === "number"
    ? markOrSize
    : numberFromKeys(markOrSize, ["brushSize", "penSize", "size"], DEFAULT_BRUSH_SIZE);
  const sizeSpan = sanitized.sizeMax - sanitized.sizeMin;
  const rawSources = {
    x: clamp(finiteNumber(point?.x, 0.5), 0, 1),
    y: clamp(finiteNumber(point?.y, 0.5), 0, 1),
    size: sizeSpan > EPSILON
      ? clamp((finiteNumber(size, DEFAULT_BRUSH_SIZE) - sanitized.sizeMin) / sizeSpan, 0, 1)
      : 0.5,
  };
  const sources = {
    x: evaluateMappingCurve(sanitized.invertX ? 1 - rawSources.x : rawSources.x, sanitized.xCurve),
    y: evaluateMappingCurve(sanitized.invertY ? 1 - rawSources.y : rawSources.y, sanitized.yCurve),
    size: evaluateMappingCurve(
      sanitized.invertSize ? 1 - rawSources.size : rawSources.size,
      sanitized.sizeCurve,
    ),
  };
  const normalized = { pitch: 0.5, pan: 0.5, gain: 1, timbre: 0.5 };
  for (const sourceName of ["x", "y", "size"]) {
    const target = sanitized[`${sourceName}Target`];
    if (target !== "none") normalized[target] = sources[sourceName];
  }
  const frequencyHz = sanitized.pitchMinHz
    * (sanitized.pitchMaxHz / sanitized.pitchMinHz) ** normalized.pitch;
  return {
    frequencyHz: clamp(frequencyHz, 1, 20_000),
    frequency: clamp(frequencyHz, 1, 20_000),
    pan: lerp(sanitized.panMin, sanitized.panMax, normalized.pan),
    gain: lerp(sanitized.gainMin, sanitized.gainMax, normalized.gain),
    timbre: lerp(sanitized.timbreMin, sanitized.timbreMax, normalized.timbre),
    normalized,
    sources,
    rawSources,
    mapping: sanitized,
  };
}

/** Alias emphasizing that coordinate mapping is also the audio mapping. */
export const sanitizeCoordinateMapping = sanitizeAudioMapping;
export const evaluateCoordinateMapping = evaluateAudioMapping;

/**
 * Generate one transformed path per unique D4 transform. Local mark transform
 * is applied about the mark bounds, reflection about the square center, and the
 * scene transform last. Path IDs stay stable while user transform values move.
 */
export function generateTransformedPaths(mark, {
  axes = undefined,
  localTransform = undefined,
  sceneTransform = null,
  dedupeCoincident = false,
} = {}) {
  const sanitized = sanitizeMark(mark, { fallbackId: mark?.id ?? "mark-1" });
  const local = localTransform === undefined ? sanitized.transform : localTransform;
  const originalBounds = pathBounds(sanitized.samples);
  const reflections = reflectionTransforms(axes === undefined ? sanitized.axes : axes);
  const signatures = new Set();
  const paths = [];
  for (const reflection of reflections) {
    const matrix = markPointTransformMatrix(local, reflection, sceneTransform, {
      localOrigin: { x: originalBounds.centerX, y: originalBounds.centerY },
      sceneOrigin: { x: 0.5, y: 0.5 },
    });
    const samples = sanitized.samples.map((sample) => ({
      ...cloneSample(sample),
      ...applyAffineTransform(sample, matrix),
      version: PLAYHEAD_PAINT_SAMPLE_VERSION,
      tMs: sample.tMs,
      pressure: sample.pressure,
    }));
    const signature = samples
      .map(({ x, y }) => `${x.toFixed(9)},${y.toFixed(9)}`)
      .join(";");
    if (dedupeCoincident && signatures.has(signature)) continue;
    signatures.add(signature);
    const cumulativeLengths = cumulativeArcLengths(samples);
    paths.push({
      id: `${sanitized.id}@${reflection.id}`,
      markId: sanitized.id,
      transformId: reflection.id,
      reflection,
      matrix,
      samples,
      cumulativeLengths,
      totalLength: cumulativeLengths.at(-1) ?? 0,
      durationMs: sanitized.durationMs,
      releaseMs: sanitized.releaseMs,
      bounds: pathBounds(samples),
      brushSize: sanitized.brushSize,
      color: sanitized.color,
      layerId: sanitized.layerId,
      waveform: sanitized.waveform,
      envelope: { ...sanitized.envelope },
    });
  }
  return paths;
}

/** Generate app/audio-ready voice descriptions at one playback position. */
export function generateTransformedVoices(mark, value, {
  mode = "recorded",
  units = mode === "steady" ? "progress" : "milliseconds",
  axes = undefined,
  localTransform = undefined,
  sceneTransform = null,
  mapping = {},
  normalizePolyphony = true,
  dedupeCoincident = false,
} = {}) {
  const paths = generateTransformedPaths(mark, {
    axes,
    localTransform,
    sceneTransform,
    dedupeCoincident,
  });
  const gainScale = normalizePolyphony && paths.length > 0
    ? polyphonyGainScale(paths.length)
    : 1;
  return paths.map((path) => {
    const point = mode === "steady"
      ? interpolateSamplesByDistance(path.samples, path.durationMs, value, { units })
      : interpolateSamplesAtTime(
        path.samples,
        path.durationMs,
        units === "progress"
          ? clamp(finiteNumber(value, 0), 0, 1) * path.durationMs
          : value,
      );
    const mapped = evaluateAudioMapping(point, path.brushSize, mapping);
    return {
      key: `playhead-paint:${path.id}`,
      pathId: path.id,
      markId: path.markId,
      transformId: path.transformId,
      x: point.x,
      y: point.y,
      point,
      frequency: mapped.frequencyHz,
      frequencyHz: mapped.frequencyHz,
      gain: mapped.gain * gainScale,
      pan: mapped.pan,
      timbre: mapped.timbre,
      waveform: path.waveform === "fm" ? "sine" : path.waveform,
      mode: path.waveform === "fm" ? "fm" : "sine",
      synthDrive: mapped.timbre,
      color: path.color,
      layerId: path.layerId,
      envelope: { ...path.envelope },
      mapping: mapped,
    };
  });
}

/**
 * Lay marks onto a loop clock. Recorded mode preserves every `startOffsetMs`
 * and therefore real overlap/gaps. Steady mode keeps mark order but places each
 * path sequentially at constant canvas-units/second; stationary dots receive a
 * small finite duration. Release tails can overlap following marks.
 */
export function layoutPaintLoop(marks, {
  mode = "recorded",
  steadySpeed = 0.35,
  loopGapMs = 300,
  interMarkGapMs = 0,
  dotDurationMs = 120,
} = {}) {
  const playbackMode = mode === "steady" ? "steady" : "recorded";
  const speed = clamp(finiteNumber(steadySpeed, 0.35), 0.0001, 1000);
  const gap = clamp(finiteNumber(loopGapMs, 300), 0, MAX_TIME_MS);
  const between = clamp(finiteNumber(interMarkGapMs, 0), 0, MAX_TIME_MS);
  const dotDuration = clamp(finiteNumber(dotDurationMs, 120), 0, MAX_TIME_MS);
  const sanitizedMarks = (Array.isArray(marks) ? marks : []).map((mark, index) => ({
    mark: sanitizeMark(mark, { fallbackId: `mark-${index + 1}` }),
    sourceIndex: index,
  })).sort((left, right) => (
    left.mark.startOffsetMs - right.mark.startOffsetMs || left.sourceIndex - right.sourceIndex
  ));
  const entries = [];
  let steadyCursor = 0;
  for (const { mark, sourceIndex } of sanitizedMarks) {
    const pathLength = markPathLength(mark);
    const durationMs = playbackMode === "recorded"
      ? mark.durationMs
      : pathLength > EPSILON ? pathLength / speed * 1000 : dotDuration;
    const startMs = playbackMode === "recorded" ? mark.startOffsetMs : steadyCursor;
    const noteOffMs = startMs + durationMs;
    const releaseEndMs = noteOffMs + mark.releaseMs;
    entries.push({
      id: mark.id,
      markId: mark.id,
      sourceIndex,
      sourceStartOffsetMs: mark.startOffsetMs,
      startMs,
      durationMs,
      noteOffMs,
      releaseEndMs,
      pathLength,
      mark,
    });
    if (playbackMode === "steady") steadyCursor = noteOffMs + between;
  }
  const contentDurationMs = entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.releaseEndMs),
    0,
  );
  return {
    mode: playbackMode,
    entries,
    contentDurationMs,
    loopGapMs: gap,
    durationMs: entries.length ? contentDurationMs + gap : 0,
    steadySpeed: speed,
  };
}

/** Wrap an arbitrary clock into a previously built loop layout. */
export function loopTimeAt(layout, elapsedMs) {
  const durationMs = Math.max(0, finiteNumber(layout?.durationMs, 0));
  if (durationMs <= EPSILON) return 0;
  const elapsed = finiteNumber(elapsedMs, 0);
  return ((elapsed % durationMs) + durationMs) % durationMs;
}

/** Return scheduled entries whose attack/sustain/release windows contain time. */
export function loopEntriesAtTime(layout, elapsedMs, { includeRelease = true } = {}) {
  const timeMs = loopTimeAt(layout, elapsedMs);
  return (Array.isArray(layout?.entries) ? layout.entries : []).filter((entry) => (
    timeMs >= entry.startMs
    && timeMs <= (includeRelease ? entry.releaseEndMs : entry.noteOffMs)
  ));
}
