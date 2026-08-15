import { unlockAudioContext } from "./audio.js";

const TAU = Math.PI * 2;
const TIMER_INTERVAL_MS = 25;
const SCHEDULE_HORIZON_SECONDS = 0.1;
const SCHEDULE_LEAD_SECONDS = 0.02;
// Each boundary can use a quiet overtone as well as its primary oscillator.
// Keeping the event cap at 16 bounds the graph to at most 32 live oscillators,
// which leaves useful headroom on iPhone Safari while still allowing all 12
// contour playheads to articulate together.
const MAX_ACTIVE_VOICES = 16;
const MAX_PLAYHEADS = 12;
const MAX_OSCILLATORS_PER_VOICE = 2;
const MAX_EVENTS_PER_TICK = 512;
const POSITION_EPSILON = 1e-8;
const PLAYBACK_MODES = new Set(["shape", "neighbors", "pattern"]);

const EMPTY_CONTOURS = Object.freeze([]);
const EMPTY_IDS = Object.freeze([]);

const DEFAULT_CONFIG = Object.freeze({
  presetId: "counterform-current",
  contours: EMPTY_CONTOURS,
  selectedContourIds: EMPTY_IDS,
  mode: "shape",
  travelSpeed: 0.32,
  direction: 1,
  baseFrequency: 82.5,
  pitchSpan: 14,
  tone: 0.58,
  timbreMotion: 0.72,
  stereoWidth: 0.82,
  orientationDepth: 0.68,
  colorAspectDepth: 0.76,
  positionDepth: 0.64,
  edgeArticulation: 0.72,
  visualRotation: 0,
  contrast: 0.78,
  fieldBounds: null,
  level: 0.42,
});

const VOICE_FAMILIES = Object.freeze([
  Object.freeze({
    name: "wood", waveform: "triangle", overtone: "sine", ratio: 2,
    filterType: "lowpass", brightness: 0.72, decay: 0.72, attack: 0.72,
  }),
  Object.freeze({
    name: "glass", waveform: "sine", overtone: "sine", ratio: 2.76,
    filterType: "bandpass", brightness: 1.42, decay: 1.24, attack: 0.46,
  }),
  Object.freeze({
    name: "reed", waveform: "sawtooth", overtone: "triangle", ratio: 1.5,
    filterType: "lowpass", brightness: 0.92, decay: 0.88, attack: 1.16,
  }),
  Object.freeze({
    name: "membrane", waveform: "sine", overtone: "triangle", ratio: 1.01,
    filterType: "lowpass", brightness: 0.52, decay: 0.54, attack: 0.32,
  }),
  Object.freeze({
    name: "wing", waveform: "triangle", overtone: "square", ratio: 2.01,
    filterType: "bandpass", brightness: 1.08, decay: 0.98, attack: 0.82,
  }),
  Object.freeze({
    name: "ink", waveform: "square", overtone: "sine", ratio: 3,
    filterType: "highpass", brightness: 1.7, decay: 0.62, attack: 0.58,
  }),
]);

const MODE_SCALES = Object.freeze({
  shape: Object.freeze([0, 2, 4, 7, 9, 12]),
  neighbors: Object.freeze([0, 3, 5, 7, 10, 12]),
  pattern: Object.freeze([0, 2, 5, 7, 9, 14]),
});

const clamp = (value, minimum = 0, maximum = 1) => {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : 0));
};

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const modulo = (value, modulus) => {
  if (!(modulus > 0)) return 0;
  return ((finiteOr(value) % modulus) + modulus) % modulus;
};

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function immutableBounds(value) {
  if (!value || typeof value !== "object") return null;
  const minimumX = Number(value.minimumX ?? value.minX ?? value.left);
  const maximumX = Number(value.maximumX ?? value.maxX ?? value.right);
  const minimumY = Number(value.minimumY ?? value.minY ?? value.top);
  const maximumY = Number(value.maximumY ?? value.maxY ?? value.bottom);
  if (![minimumX, maximumX, minimumY, maximumY].every(Number.isFinite)) return null;
  if (!(maximumX > minimumX) || !(maximumY > minimumY)) return null;
  return Object.freeze({ minimumX, maximumX, minimumY, maximumY });
}

function immutableIds(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
  return Object.freeze([...new Set(source.filter((id) => (
    typeof id === "string" && id
  )))].slice(0, MAX_PLAYHEADS));
}

function immutableContours(value) {
  if (!Array.isArray(value)) return EMPTY_CONTOURS;
  return Object.freeze(value.filter((contour) => (
    contour
    && typeof contour === "object"
    && typeof contour.id === "string"
    && Array.isArray(contour.edges)
    && Array.isArray(contour.points)
  )).slice(0, 256));
}

function sanitizeConfig(input = {}, previous = DEFAULT_CONFIG) {
  const sourceContours = own(input, "contours")
    ? input.contours
    : own(input, "activeContours")
      ? input.activeContours
      : previous.contours;
  const sourceIds = own(input, "selectedContourIds")
    ? input.selectedContourIds
    : own(input, "contourIds")
      ? input.contourIds
      : own(input, "selectedContourId")
        ? input.selectedContourId
        : previous.selectedContourIds;
  const mode = own(input, "mode") ? input.mode : previous.mode;
  return Object.freeze({
    presetId: typeof input.presetId === "string" && input.presetId
      ? input.presetId
      : previous.presetId,
    contours: immutableContours(sourceContours),
    selectedContourIds: immutableIds(sourceIds),
    mode: PLAYBACK_MODES.has(mode) ? mode : previous.mode,
    travelSpeed: clamp(
      own(input, "travelSpeed") ? input.travelSpeed : previous.travelSpeed,
      0.01,
      4,
    ),
    direction: Number(own(input, "direction") ? input.direction : previous.direction) < 0
      ? -1
      : 1,
    baseFrequency: clamp(
      own(input, "baseFrequency") ? input.baseFrequency : previous.baseFrequency,
      24,
      880,
    ),
    pitchSpan: clamp(
      own(input, "pitchSpan") ? input.pitchSpan : previous.pitchSpan,
      0,
      48,
    ),
    tone: clamp(own(input, "tone") ? input.tone : previous.tone),
    timbreMotion: clamp(
      own(input, "timbreMotion") ? input.timbreMotion : previous.timbreMotion,
    ),
    stereoWidth: clamp(
      own(input, "stereoWidth") ? input.stereoWidth : previous.stereoWidth,
    ),
    orientationDepth: clamp(
      own(input, "orientationDepth") ? input.orientationDepth : previous.orientationDepth,
    ),
    colorAspectDepth: clamp(
      own(input, "colorAspectDepth") ? input.colorAspectDepth : previous.colorAspectDepth,
    ),
    positionDepth: clamp(
      own(input, "positionDepth") ? input.positionDepth : previous.positionDepth,
    ),
    edgeArticulation: clamp(
      own(input, "edgeArticulation") ? input.edgeArticulation : previous.edgeArticulation,
    ),
    visualRotation: clamp(
      own(input, "visualRotation") ? input.visualRotation : previous.visualRotation,
      -360,
      360,
    ),
    contrast: clamp(own(input, "contrast") ? input.contrast : previous.contrast),
    fieldBounds: own(input, "fieldBounds") || own(input, "geometryBounds")
      ? immutableBounds(input.fieldBounds ?? input.geometryBounds)
      : previous.fieldBounds,
    level: clamp(own(input, "level") ? input.level : previous.level),
  });
}

function point(value, fallback = null) {
  if (!value || typeof value !== "object") return fallback;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return { x, y };
}

function indexedPoint(edge, names, points, fallbackIndex) {
  for (const name of names) {
    const direct = point(edge?.[name]);
    if (direct) return direct;
  }
  const indexNames = names.flatMap((name) => [
    `${name}Index`,
    name === "start" ? "fromIndex" : "toIndex",
  ]);
  for (const name of indexNames) {
    const index = Number(edge?.[name]);
    if (Number.isInteger(index) && point(points[index])) return point(points[index]);
  }
  return point(points[fallbackIndex]);
}

function signedTurn(previous, current) {
  const firstLength = Math.hypot(previous.x, previous.y);
  const secondLength = Math.hypot(current.x, current.y);
  if (!(firstLength > 0) || !(secondLength > 0)) return 0;
  return Math.atan2(
    previous.x * current.y - previous.y * current.x,
    previous.x * current.x + previous.y * current.y,
  );
}

function edgeMetric(edge, names, fallback) {
  for (const name of names) {
    const numeric = Number(edge?.[name]);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function colorUnit(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return modulo(Math.abs(value) * 0.61803398875, 1);
  }
  if (typeof value !== "string") return 0.5;
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(normalized)) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta < 1e-9) return (red + green + blue) / 3;
  let hue;
  if (maximum === red) hue = ((green - blue) / delta) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return modulo(hue / 6, 1);
}

function hashUnit(value) {
  const string = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function aspectUnit(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return modulo(value * 0.38196601125, 1);
  }
  return hashUnit(value);
}

function colorFeatures(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const hue = colorUnit(value);
    return { hue, saturation: 0.58 + modulo(Math.abs(value) * 0.17, 0.34), lightness: 0.38 + hue * 0.28 };
  }
  if (typeof value !== "string") {
    return { hue: 0.5, saturation: 0.5, lightness: 0.5 };
  }
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(normalized)) {
    const hue = hashUnit(value);
    return { hue, saturation: 0.55 + hue * 0.32, lightness: 0.38 + (1 - hue) * 0.24 };
  }
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const saturation = maximum > 1e-9 ? (maximum - minimum) / maximum : 0;
  return {
    hue: colorUnit(value),
    saturation,
    lightness: red * 0.2126 + green * 0.7152 + blue * 0.0722,
  };
}

function signedPolygonArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index].x * next.y - next.x * points[index].y;
  }
  return twiceArea * 0.5;
}

function polygonCenter(points, signedArea = signedPolygonArea(points)) {
  if (Math.abs(signedArea) > POSITION_EPSILON) {
    let x = 0;
    let y = 0;
    for (let index = 0; index < points.length; index += 1) {
      const next = points[(index + 1) % points.length];
      const cross = points[index].x * next.y - next.x * points[index].y;
      x += (points[index].x + next.x) * cross;
      y += (points[index].y + next.y) * cross;
    }
    return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
  }
  const sum = points.reduce((result, vertex) => ({
    x: result.x + vertex.x,
    y: result.y + vertex.y,
  }), { x: 0, y: 0 });
  return {
    x: sum.x / Math.max(1, points.length),
    y: sum.y / Math.max(1, points.length),
  };
}

function contourOrientation(points, edges, center) {
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const vertex of points) {
    const x = vertex.x - center.x;
    const y = vertex.y - center.y;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  const covariance = Math.max(POSITION_EPSILON, xx + yy);
  const anisotropy = clamp(Math.hypot(xx - yy, 2 * xy) / covariance);
  const principalAngle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const anchor = [...edges].sort((first, second) => (
    second.length - first.length || first.edgeIndex - second.edgeIndex
  ))[0];
  const anchorAngle = anchor
    ? Math.atan2(anchor.vector.y, anchor.vector.x)
    : principalAngle;
  // Near-regular tiles do not have a stable covariance axis. Their first
  // actual boundary tangent is the meaningful visible orientation instead.
  const angle = anisotropy > 0.08 ? principalAngle : anchorAngle;
  return { angle, anchorAngle, principalAngle, anisotropy };
}

function rotatePoint(source, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: source.x * cosine - source.y * sine,
    y: source.x * sine + source.y * cosine,
  };
}

function absolutePositionUnit(value, model) {
  const scale = model === "euclidean" ? 0.28 : 1.15;
  return clamp(0.5 + Math.tanh(finiteOr(value) * scale) * 0.5);
}

function absoluteSizeUnit(perimeter, model) {
  const reference = model === "euclidean" ? 4 : model === "similarity" ? 2 : 1.4;
  return clamp(0.5 + Math.tanh(Math.log2(Math.max(POSITION_EPSILON, perimeter) / reference)) * 0.24);
}

function measureContour(contour, contourIndex) {
  const points = contour.points.map((vertex) => point(vertex)).filter(Boolean);
  const sourceEdges = contour.edges;
  const preliminary = [];
  for (let edgeIndex = 0; edgeIndex < sourceEdges.length; edgeIndex += 1) {
    const source = sourceEdges[edgeIndex];
    const sampledPoints = Array.isArray(source?.points) ? source.points : [];
    const start = point(sampledPoints[0]) ?? indexedPoint(
      source,
      ["start", "from", "a"],
      points,
      edgeIndex % Math.max(1, points.length),
    );
    const end = point(sampledPoints.at(-1)) ?? indexedPoint(
      source,
      ["end", "to", "b"],
      points,
      (edgeIndex + 1) % Math.max(1, points.length),
    );
    if (!start || !end) continue;
    const euclideanLength = Math.hypot(end.x - start.x, end.y - start.y);
    const length = edgeMetric(source, ["length", "arcLength", "distance"], euclideanLength);
    if (!(length > POSITION_EPSILON)) continue;
    preliminary.push({
      source,
      edgeIndex,
      edgeId: typeof source.id === "string" && source.id
        ? source.id
        : `${contour.id}:edge:${edgeIndex}`,
      start,
      end,
      length,
      vector: { x: end.x - start.x, y: end.y - start.y },
      providedStartDistance: Number(source?.startDistance),
      providedEndDistance: Number(source?.endDistance),
    });
  }
  if (!preliminary.length) return null;

  const hasCumulativeDistances = preliminary.every((edge) => (
    Number.isFinite(edge.providedStartDistance)
    && Number.isFinite(edge.providedEndDistance)
    && edge.providedEndDistance > edge.providedStartDistance
  ));
  const ordered = hasCumulativeDistances
    ? [...preliminary].sort((first, second) => (
      first.providedStartDistance - second.providedStartDistance
    ))
    : preliminary;
  const measuredSum = ordered.reduce((sum, edge) => sum + edge.length, 0);
  const declaredPerimeter = Number(contour.perimeter);
  const perimeter = Number.isFinite(declaredPerimeter) && declaredPerimeter > POSITION_EPSILON
    ? declaredPerimeter
    : measuredSum;
  const distanceScale = perimeter / measuredSum;
  let cumulative = 0;
  const edges = ordered.map((edge, index) => {
    const previous = ordered[(index - 1 + ordered.length) % ordered.length];
    const computedTurn = signedTurn(previous.vector, edge.vector);
    const turn = edgeMetric(edge.source, ["turn", "turnAngle", "signedTurn"], computedTurn);
    const adjacentLength = Math.max(
      POSITION_EPSILON,
      (previous.length + edge.length) * 0.5,
    );
    const computedCurvature = Math.abs(turn) / adjacentLength;
    const curvature = Math.abs(edgeMetric(
      edge.source,
      ["curvature", "cornerCurvature"],
      computedCurvature,
    ));
    const travelLength = hasCumulativeDistances
      ? edge.providedEndDistance - edge.providedStartDistance
      : edge.length * distanceScale;
    const startDistance = hasCumulativeDistances
      ? edge.providedStartDistance
      : cumulative;
    cumulative = startDistance + travelLength;
    return Object.freeze({
      ...edge,
      turn,
      curvature,
      angle: Math.atan2(edge.vector.y, edge.vector.x),
      travelLength,
      startDistance,
      color: edge.source.color ?? contour.color ?? contour.depth ?? contourIndex,
    });
  });

  const signedArea = signedPolygonArea(points);
  const declaredCenter = point(contour.center);
  const center = declaredCenter ?? polygonCenter(points, signedArea);
  const orientation = contourOrientation(points, edges, center);
  const declaredArea = Number(contour.area);
  const area = Number.isFinite(declaredArea) && declaredArea > POSITION_EPSILON
    ? declaredArea
    : Math.abs(signedArea);

  return {
    source: contour,
    id: contour.id,
    model: typeof contour.model === "string" ? contour.model : "euclidean",
    role: typeof contour.role === "string" ? contour.role : "tile",
    color: contour.color ?? contour.depth ?? contourIndex,
    aspect: contour.aspect ?? 0,
    depth: finiteOr(contour.depth ?? contour.level),
    sector: finiteOr(contour.sector ?? contour.reflectionEdge),
    center: Object.freeze(center),
    signedArea,
    area,
    chirality: signedArea < 0 ? -1 : 1,
    orientation: orientation.angle,
    anchorOrientation: orientation.anchorAngle,
    principalOrientation: orientation.principalAngle,
    anisotropy: orientation.anisotropy,
    perimeter,
    edges: Object.freeze(edges),
    contourIndex,
    perimeterUnit: 0.5,
    absoluteSizeUnit: absoluteSizeUnit(perimeter, contour.model),
  };
}

function prepareContours(config) {
  const selected = new Set(config.selectedContourIds);
  const source = selected.size
    ? config.contours.filter(({ id }) => selected.has(id))
    : config.contours;
  const measured = source
    .slice(0, MAX_PLAYHEADS)
    .map(measureContour)
    .filter(Boolean);
  if (!measured.length) return { contours: EMPTY_CONTOURS, bounds: null };

  const logarithms = measured.map(({ perimeter }) => Math.log(perimeter));
  const minimumPerimeter = Math.min(...logarithms);
  const maximumPerimeter = Math.max(...logarithms);
  const perimeterRange = maximumPerimeter - minimumPerimeter;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const contour of measured) {
    for (const edge of contour.edges) {
      minimumX = Math.min(minimumX, edge.start.x, edge.end.x);
      maximumX = Math.max(maximumX, edge.start.x, edge.end.x);
      minimumY = Math.min(minimumY, edge.start.y, edge.end.y);
      maximumY = Math.max(maximumY, edge.start.y, edge.end.y);
    }
  }
  const contours = Object.freeze(measured.map((contour, index) => Object.freeze({
    ...contour,
    contourIndex: index,
    perimeterUnit: perimeterRange > 1e-9
      ? (Math.log(contour.perimeter) - minimumPerimeter) / perimeterRange
      : 0.5,
  })));
  return {
    contours,
    bounds: config.fieldBounds ?? Object.freeze({ minimumX, maximumX, minimumY, maximumY }),
  };
}

function setParam(parameter, method, ...values) {
  if (!parameter) return;
  if (typeof parameter[method] === "function") parameter[method](...values);
  else parameter.value = values[0];
}

function cancelParam(parameter, time) {
  parameter?.cancelScheduledValues?.(time);
}

function disconnect(node) {
  try {
    node?.disconnect?.();
  } catch {
    // An oscillator may already have disconnected after its natural end.
  }
}

function connect(source, destination) {
  if (source?.connect && destination) source.connect(destination);
  return destination;
}

function contextConstructor(runtime) {
  return runtime?.AudioContext
    ?? runtime?.webkitAudioContext
    ?? globalThis.AudioContext
    ?? globalThis.webkitAudioContext;
}

function rotatedBounds(bounds, radians) {
  if (!bounds || Math.abs(radians) < POSITION_EPSILON) return bounds;
  const corners = [
    { x: bounds.minimumX, y: bounds.minimumY },
    { x: bounds.maximumX, y: bounds.minimumY },
    { x: bounds.maximumX, y: bounds.maximumY },
    { x: bounds.minimumX, y: bounds.maximumY },
  ].map((corner) => rotatePoint(corner, radians));
  return {
    minimumX: Math.min(...corners.map(({ x }) => x)),
    maximumX: Math.max(...corners.map(({ x }) => x)),
    minimumY: Math.min(...corners.map(({ y }) => y)),
    maximumY: Math.max(...corners.map(({ y }) => y)),
  };
}

function roleOffset(role) {
  if (role === "similarity-cell") return 1;
  if (role === "hyperbolic-tile") return 3;
  return 0;
}

function deriveBoundaryVoice(contour, edge, config, sourceBounds, cycle, headroom) {
  const rotation = config.visualRotation * Math.PI / 180;
  const bounds = rotatedBounds(sourceBounds, rotation);
  const eventPosition = rotatePoint(edge.start, rotation);
  const contourCenter = rotatePoint(contour.center, rotation);
  const xRange = Math.max(POSITION_EPSILON, bounds.maximumX - bounds.minimumX);
  const yRange = Math.max(POSITION_EPSILON, bounds.maximumY - bounds.minimumY);
  const fieldX = clamp((eventPosition.x - bounds.minimumX) / xRange);
  const fieldY = clamp((eventPosition.y - bounds.minimumY) / yRange);
  const absoluteX = absolutePositionUnit(contourCenter.x, contour.model);
  const absoluteY = absolutePositionUnit(contourCenter.y, contour.model);
  const xUnit = clamp(fieldX * 0.72 + absoluteX * 0.28);
  const yUnit = clamp(fieldY * 0.62 + absoluteY * 0.38);

  const contourAngle = contour.orientation + rotation;
  const edgeAngle = edge.angle + rotation;
  const orientationPitch = Math.sin(contourAngle) * 0.65 + Math.cos(contourAngle) * 0.35;
  const tangentPitch = Math.sin(edgeAngle) * 0.64 + Math.cos(edgeAngle * 2) * 0.36;
  const turnUnit = clamp(0.5 + edge.turn / TAU);
  const sharpness = clamp(Math.abs(edge.turn) / Math.PI);
  const curvatureUnit = clamp(edge.curvature / (edge.curvature + 1.6));
  const edgeLengthUnit = clamp(edge.travelLength / Math.max(POSITION_EPSILON, contour.perimeter) * 4);
  const color = colorFeatures(edge.color ?? contour.color);
  const aspect = aspectUnit(contour.aspect);
  const role = roleOffset(contour.role);
  const colorBand = Math.min(VOICE_FAMILIES.length - 1, Math.floor(color.hue * VOICE_FAMILIES.length));
  const familyIndex = modulo(colorBand + Math.floor(aspect * 3) + role, VOICE_FAMILIES.length);
  const family = VOICE_FAMILIES[familyIndex];
  const scale = MODE_SCALES[config.mode] ?? MODE_SCALES.shape;
  const scaleIndex = modulo(colorBand + Math.floor(aspect * scale.length) + role, scale.length);
  const colorDegree = scale[scaleIndex];
  const colorPitch = colorDegree / Math.max(1, scale.at(-1)) - 0.5;
  const sizeUnit = contour.perimeterUnit * 0.4 + contour.absoluteSizeUnit * 0.6;
  const modeContourOffset = config.mode === "neighbors"
    ? ((contour.contourIndex % 3) - 1) * 1.35
    : config.mode === "pattern"
      ? ((contour.contourIndex % 4) - 1.5) * 0.72
      : 0;
  const cycleMotion = Math.sin(
    (cycle + 1) * 2.3999632297
      + color.hue * TAU
      + contour.orientation * 0.71,
  );
  const semitones = (0.5 - sizeUnit) * config.pitchSpan * 0.52
    + (0.5 - yUnit) * config.pitchSpan * config.positionDepth * 0.82
    + orientationPitch * config.pitchSpan * config.orientationDepth * 0.34
    + colorPitch * config.pitchSpan * config.colorAspectDepth * 0.9
    + (tangentPitch * 0.55 + (turnUnit - 0.5) * 0.9)
      * config.pitchSpan * config.edgeArticulation * 0.22
    + contour.chirality * config.orientationDepth * 0.72
    + modeContourOffset
    + cycleMotion * config.pitchSpan * config.timbreMotion * 0.055;
  const frequency = clamp(
    config.baseFrequency * 2 ** (semitones / 12),
    20,
    16_000,
  );

  // Reflections move in opposite pitch/filter directions. The gesture is
  // short and finite: there is no continuously running modulation source.
  const glideSemitones = contour.chirality
      * (0.7 + sharpness * 2.3 + curvatureUnit * 1.4)
      * config.edgeArticulation
    + Math.sin(edgeAngle) * config.orientationDepth * 0.9
    + (config.mode === "pattern" ? cycleMotion * 0.65 : 0);
  const frequencyEnd = clamp(frequency * 2 ** (glideSemitones / 12), 20, 16_000);
  const contrastBrightness = 0.58 + config.contrast * 0.72;
  const timbre = clamp(
    0.08
      + color.saturation * config.colorAspectDepth * 0.26
      + curvatureUnit * config.edgeArticulation * 0.32
      + (0.5 + orientationPitch * 0.5) * config.orientationDepth * 0.16
      + yUnit * config.positionDepth * 0.1
      + cycleMotion * config.timbreMotion * 0.06,
  );
  const edgeSeconds = edge.travelLength / config.travelSpeed;
  const modeDecay = config.mode === "shape" ? 1.08 : config.mode === "neighbors" ? 0.84 : 0.68;
  const duration = clamp(
    edgeSeconds
      * (0.16
        + (1 - sharpness * config.edgeArticulation) * 0.38
        + edgeLengthUnit * 0.16)
      * family.decay
      * modeDecay,
    0.025,
    1.35,
  );
  const handedAttack = contour.chirality > 0 ? 0.68 : 1.38;
  const attack = clamp(
    (0.0022 + (1 - sharpness) * 0.014)
      * family.attack
      * handedAttack
      * (1.18 - config.edgeArticulation * 0.36),
    0.0015,
    Math.max(0.0015, duration * 0.38),
  );
  const peak = clamp(
    (0.046
      + sharpness * config.edgeArticulation * 0.05
      + edgeLengthUnit * 0.024
      + color.lightness * config.colorAspectDepth * 0.012)
      * headroom,
    0,
    0.14,
  );
  const filterFrequency = clamp(
    frequency
      * (1.25 + config.tone * 5.2 + timbre * 4.4)
      * family.brightness
      * contrastBrightness,
    70,
    18_000,
  );
  const filterSweepOctaves = contour.chirality
      * (0.25 + curvatureUnit * 0.78)
      * config.timbreMotion
    + cycleMotion * config.timbreMotion * 0.16;
  const filterFrequencyEnd = clamp(
    filterFrequency * 2 ** filterSweepOctaves,
    70,
    18_000,
  );
  const pan = clamp(
    ((xUnit * 2 - 1)
      + Math.sin(contourAngle) * config.orientationDepth * 0.16
      + contour.chirality * 0.035)
      * config.stereoWidth,
    -1,
    1,
  );
  const panEnd = clamp(
    pan + Math.cos(edgeAngle) * config.positionDepth * config.stereoWidth * 0.11,
    -1,
    1,
  );
  const overtoneLevel = clamp(
    0.045
      + config.tone * 0.09
      + color.saturation * config.colorAspectDepth * 0.075
      + (config.mode === "pattern" ? 0.025 : 0),
    0.035,
    0.24,
  );
  const overtoneFrequency = clamp(
    frequency * family.ratio * (1 + contour.chirality * 0.0018),
    20,
    19_000,
  );
  const overtoneFrequencyEnd = clamp(
    frequencyEnd * family.ratio * (1 + contour.chirality * 0.0018),
    20,
    19_000,
  );

  return Object.freeze({
    family: family.name,
    waveform: family.waveform,
    overtoneWaveform: family.overtone,
    filterType: family.filterType,
    frequency,
    frequencyEnd,
    overtoneFrequency,
    overtoneFrequencyEnd,
    overtoneLevel,
    filterFrequency,
    filterFrequencyEnd,
    filterQ: 0.55 + curvatureUnit * 5.2 + color.saturation * 0.8,
    duration,
    attack,
    peak,
    pan,
    panEnd,
    orientation: modulo(contourAngle, TAU),
    edgeAngle: modulo(edgeAngle, TAU),
    xUnit,
    yUnit,
    colorHue: color.hue,
    colorSaturation: color.saturation,
    aspect,
    chirality: contour.chirality,
    sharpness,
    curvatureUnit,
  });
}

/**
 * Web Audio renderer driven only by measured contour boundaries.
 *
 * Every playhead advances at travelSpeed geometric units per second. Its loop
 * period is therefore contour.perimeter / travelSpeed, independently of the
 * number of edges or the browser's animation-frame cadence.
 */
export class EscherPerformanceAudio {
  constructor(runtime = globalThis, { onEvent, onStep } = {}) {
    this.runtime = runtime;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.onStep = typeof onStep === "function" ? onStep : null;
    this.config = DEFAULT_CONFIG;
    this.measuredContours = EMPTY_CONTOURS;
    this.bounds = null;
    this.context = null;
    this.master = null;
    this.eventBus = null;
    this.compressor = null;
    this.playheads = [];
    this.activeVoices = [];
    this.uiQueue = [];
    this.timer = null;
    this.enabled = false;
    this.playing = false;
    this.disposed = false;
    this.position = 0;
    this.anchorPosition = 0;
    this.anchorTime = 0;
    this._tick = this._tick.bind(this);
  }

  async enable(config = {}) {
    if (this.disposed) throw new Error("Escher performance audio has been disposed.");
    this.configure(config);
    if (!this.context) {
      const AudioContextCtor = contextConstructor(this.runtime);
      if (typeof AudioContextCtor !== "function") {
        throw new Error("Web Audio is not available in this browser.");
      }
      this.context = new AudioContextCtor();
      this._createGraph();
    }
    unlockAudioContext(this.context);
    if (this.context.state === "suspended" && typeof this.context.resume === "function") {
      await this.context.resume();
    }
    this.enabled = true;
    this._updateOutput();
    if (this.playing) {
      this._resync();
      this._startTimer();
    }
    return this;
  }

  async disable() {
    this.enabled = false;
    this.playing = false;
    this._clearTimer();
    this.playheads.length = 0;
    this.uiQueue.length = 0;
    if (!this.context) return;
    const now = this.context.currentTime;
    this._cancelTransientVoices(now);
    setParam(this.master?.gain, "setValueAtTime", 0, now);
    if (this.context.state === "running" && typeof this.context.suspend === "function") {
      await this.context.suspend();
    }
  }

  configure(config = {}) {
    if (this.context && this.playing) this.position = this._positionAt(this.context.currentTime);
    this.config = sanitizeConfig(config, this.config);
    const prepared = prepareContours(this.config);
    this.measuredContours = prepared.contours;
    this.bounds = prepared.bounds;
    if (this.context) {
      this._updateOutput();
      if (this.playing && this.enabled) this._resync();
    }
    return this.config;
  }

  setPlaying(playing, position) {
    if (position === undefined && this.context && this.playing) {
      this.position = this._positionAt(this.context.currentTime);
    } else {
      this.position = finiteOr(position, this.position);
    }
    this.playing = Boolean(playing);
    if (!this.enabled || !this.context) return;
    if (this.playing) {
      this._resync();
      this._startTimer();
    } else {
      this._clearTimer();
      this.playheads.length = 0;
      this.uiQueue.length = 0;
      this._cancelTransientVoices(this.context.currentTime);
    }
  }

  setPosition(position) {
    const next = finiteOr(position, this.position);
    if (Math.abs(next - this.position) < POSITION_EPSILON) return;
    this.position = next;
    if (this.playing && this.enabled && this.context) this._resync();
  }

  // Compatibility alias for callers migrating from the former phrase control.
  setPhase(position) {
    this.setPosition(position);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.playing = false;
    this._clearTimer();
    this.playheads.length = 0;
    this.uiQueue.length = 0;
    if (this.context) {
      const now = this.context.currentTime;
      this._cancelTransientVoices(now);
      disconnect(this.eventBus);
      disconnect(this.master);
      disconnect(this.compressor);
      try { this.context.close?.(); } catch { /* already closed */ }
    }
    this.context = null;
  }

  _createGraph() {
    const context = this.context;
    this.master = context.createGain();
    this.eventBus = context.createGain();
    this.compressor = context.createDynamicsCompressor?.() ?? context.createGain();
    setParam(this.master.gain, "setValueAtTime", 0, context.currentTime);
    setParam(this.eventBus.gain, "setValueAtTime", 1, context.currentTime);
    if (this.compressor.threshold) {
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.16;
    }
    connect(this.eventBus, this.master);
    connect(this.master, this.compressor);
    connect(this.compressor, context.destination);
  }

  _updateOutput() {
    if (!this.context) return;
    const now = this.context.currentTime;
    setParam(
      this.master?.gain,
      "setTargetAtTime",
      this.enabled ? this.config.level : 0,
      now,
      0.025,
    );
  }

  _positionAt(time) {
    if (!this.playing) return this.position;
    return this.anchorPosition
      + Math.max(0, time - this.anchorTime) * this.config.travelSpeed * this.config.direction;
  }

  _startTimer() {
    if (this.timer !== null || !this.playing || !this.enabled) return;
    const setIntervalFn = this.runtime?.setInterval ?? globalThis.setInterval;
    this._tick();
    this.timer = setIntervalFn.call(this.runtime, this._tick, TIMER_INTERVAL_MS);
  }

  _clearTimer() {
    if (this.timer === null) return;
    const clearIntervalFn = this.runtime?.clearInterval ?? globalThis.clearInterval;
    clearIntervalFn.call(this.runtime, this.timer);
    this.timer = null;
  }

  _resync() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.anchorPosition = this.position;
    this.anchorTime = now;
    this.playheads = this.measuredContours.map((contour) => (
      this._playheadAt(contour, this.position, now + SCHEDULE_LEAD_SECONDS)
    ));
    this.uiQueue.length = 0;
    this._cancelTransientVoices(now);
    this._tick();
  }

  _playheadAt(contour, position, startTime) {
    const distance = modulo(position, contour.perimeter);
    const edges = contour.edges;
    let slot = 0;
    let travelDistance = 0;
    if (this.config.direction > 0) {
      slot = edges.findIndex(({ startDistance }) => (
        startDistance >= distance - POSITION_EPSILON
      ));
      if (slot < 0) {
        slot = 0;
        travelDistance = contour.perimeter - distance;
      } else {
        travelDistance = Math.max(0, edges[slot].startDistance - distance);
      }
    } else {
      slot = edges.length - 1;
      for (let index = edges.length - 1; index >= 0; index -= 1) {
        if (edges[index].startDistance <= distance + POSITION_EPSILON) {
          slot = index;
          break;
        }
      }
      travelDistance = Math.max(0, distance - edges[slot].startDistance);
    }
    return {
      contour,
      slot,
      nextWhen: startTime + travelDistance / this.config.travelSpeed,
      cycle: 0,
    };
  }

  _advancePlayhead(playhead) {
    const edges = playhead.contour.edges;
    if (this.config.direction > 0) {
      const edge = edges[playhead.slot];
      playhead.nextWhen += edge.travelLength / this.config.travelSpeed;
      playhead.slot = (playhead.slot + 1) % edges.length;
      if (playhead.slot === 0) playhead.cycle += 1;
    } else {
      const nextSlot = (playhead.slot - 1 + edges.length) % edges.length;
      playhead.nextWhen += edges[nextSlot].travelLength / this.config.travelSpeed;
      playhead.slot = nextSlot;
      if (playhead.slot === edges.length - 1) playhead.cycle += 1;
    }
  }

  _tick() {
    if (!this.context || !this.enabled || !this.playing) return;
    const now = this.context.currentTime;
    this._pruneVoices(now);
    this._flushUi(now);
    const horizon = now + SCHEDULE_HORIZON_SECONDS;
    let scheduled = 0;
    while (scheduled < MAX_EVENTS_PER_TICK) {
      let earliest = Infinity;
      for (const playhead of this.playheads) earliest = Math.min(earliest, playhead.nextWhen);
      if (!(earliest < horizon)) break;

      const simultaneous = [];
      for (const playhead of this.playheads) {
        if (Math.abs(playhead.nextWhen - earliest) < 1e-7) simultaneous.push(playhead);
      }
      const available = Math.max(0, MAX_ACTIVE_VOICES - this.activeVoices.length);
      const audibleCount = Math.min(available, simultaneous.length);
      const overlapping = this._activeAt(earliest);
      const headroom = 1 / Math.sqrt(Math.max(1, audibleCount + overlapping));
      for (let index = 0; index < simultaneous.length; index += 1) {
        const playhead = simultaneous[index];
        if (index < audibleCount) this._scheduleBoundary(playhead, earliest, headroom);
        this._advancePlayhead(playhead);
        scheduled += 1;
      }
    }
  }

  _scheduleBoundary(playhead, when, headroom) {
    const { contour, slot, cycle } = playhead;
    const edge = contour.edges[slot];
    const voice = deriveBoundaryVoice(
      contour,
      edge,
      this.config,
      this.bounds,
      cycle,
      headroom,
    );
    const descriptor = Object.freeze({
      contourId: contour.id,
      model: contour.model,
      role: contour.role,
      edgeId: edge.edgeId,
      edgeIndex: edge.edgeIndex,
      when,
      position: Object.freeze({ ...edge.start }),
      distance: edge.startDistance,
      perimeter: contour.perimeter,
      period: contour.perimeter / this.config.travelSpeed,
      edgeLength: edge.travelLength,
      turn: edge.turn,
      curvature: edge.curvature,
      color: edge.color,
      aspect: contour.aspect,
      center: contour.center,
      orientation: voice.orientation,
      chirality: contour.chirality,
      mode: this.config.mode,
      cycle,
      voice,
    });
    this._scheduleVoice(descriptor, voice);
    this.uiQueue.push(descriptor);
  }

  _scheduleVoice(event, voice) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : null;
    oscillator.type = voice.waveform;
    overtone.type = voice.overtoneWaveform;
    filter.type = voice.filterType;
    filter.Q.value = voice.filterQ;
    setParam(oscillator.frequency, "setValueAtTime", voice.frequency, event.when);
    setParam(
      oscillator.frequency,
      "exponentialRampToValueAtTime",
      voice.frequencyEnd,
      event.when + voice.duration * 0.72,
    );
    setParam(overtone.frequency, "setValueAtTime", voice.overtoneFrequency, event.when);
    setParam(
      overtone.frequency,
      "exponentialRampToValueAtTime",
      voice.overtoneFrequencyEnd,
      event.when + voice.duration * 0.72,
    );
    setParam(overtoneGain.gain, "setValueAtTime", voice.overtoneLevel, event.when);
    setParam(
      overtoneGain.gain,
      "linearRampToValueAtTime",
      voice.overtoneLevel * 0.42,
      event.when + voice.duration,
    );
    setParam(filter.frequency, "setValueAtTime", voice.filterFrequency, event.when);
    setParam(
      filter.frequency,
      "exponentialRampToValueAtTime",
      voice.filterFrequencyEnd,
      event.when + voice.duration * 0.84,
    );
    setParam(gain.gain, "setValueAtTime", 0.0001, event.when);
    setParam(gain.gain, "linearRampToValueAtTime", voice.peak, event.when + voice.attack);
    setParam(
      gain.gain,
      "exponentialRampToValueAtTime",
      0.0001,
      event.when + voice.duration,
    );
    setParam(panner?.pan, "setValueAtTime", voice.pan, event.when);
    setParam(
      panner?.pan,
      "linearRampToValueAtTime",
      voice.panEnd,
      event.when + voice.duration,
    );
    connect(oscillator, filter);
    connect(overtone, overtoneGain);
    connect(overtoneGain, filter);
    connect(filter, gain);
    if (panner) {
      connect(gain, panner);
      connect(panner, this.eventBus);
    } else {
      connect(gain, this.eventBus);
    }

    const record = {
      event,
      oscillator,
      oscillators: [oscillator, overtone],
      overtone,
      overtoneGain,
      filter,
      gain,
      panner,
      startTime: event.when,
      stopTime: event.when + voice.duration + 0.015,
      frequency: voice.frequency,
      pan: voice.pan,
      duration: voice.duration,
    };
    oscillator.onended = () => this._releaseVoice(record);
    this.activeVoices.push(record);
    oscillator.start(event.when);
    overtone.start(event.when);
    oscillator.stop(record.stopTime);
    overtone.stop(record.stopTime);
  }

  _activeAt(time) {
    let count = 0;
    for (const voice of this.activeVoices) {
      if (voice.startTime <= time && voice.stopTime > time) count += 1;
    }
    return count;
  }

  _pruneVoices(time) {
    for (let index = this.activeVoices.length - 1; index >= 0; index -= 1) {
      if (this.activeVoices[index].stopTime <= time) {
        this._releaseVoice(this.activeVoices[index]);
      }
    }
  }

  _releaseVoice(record) {
    const index = this.activeVoices.indexOf(record);
    if (index >= 0) this.activeVoices.splice(index, 1);
    record.oscillator.onended = null;
    for (const oscillator of record.oscillators) disconnect(oscillator);
    disconnect(record.overtoneGain);
    disconnect(record.filter);
    disconnect(record.gain);
    disconnect(record.panner);
  }

  _cancelTransientVoices(time) {
    for (const record of [...this.activeVoices]) {
      cancelParam(record.gain.gain, time);
      for (const oscillator of record.oscillators) {
        try { oscillator.stop(time); } catch { /* already stopped */ }
      }
      this._releaseVoice(record);
    }
  }

  _flushUi(time) {
    while (this.uiQueue.length && this.uiQueue[0].when <= time + 0.012) {
      const event = this.uiQueue.shift();
      this.onEvent?.(event);
      this.onStep?.(
        event.edgeIndex,
        event.perimeter > 0 ? event.distance / event.perimeter : 0,
        event,
      );
    }
  }
}

export const ESCHER_PERFORMANCE_AUDIO_DEFAULTS = DEFAULT_CONFIG;
export const ESCHER_PERFORMANCE_AUDIO_LIMITS = Object.freeze({
  timerIntervalMs: TIMER_INTERVAL_MS,
  scheduleHorizonSeconds: SCHEDULE_HORIZON_SECONDS,
  maximumActiveVoices: MAX_ACTIVE_VOICES,
  maximumPlayheads: MAX_PLAYHEADS,
  maximumOscillatorsPerVoice: MAX_OSCILLATORS_PER_VOICE,
  maximumLiveOscillators: MAX_ACTIVE_VOICES * MAX_OSCILLATORS_PER_VOICE,
  bedLevelCeiling: 0,
});
