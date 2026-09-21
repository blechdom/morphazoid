/**
 * Shared deterministic geometry, drawing, and fixed-step helpers for the
 * geometric-physics instruments. Model coordinates are centered, with +Y up.
 */

export const TAU = Math.PI * 2;
export const PHYSICS_STEP = 1 / 120;
export const MAX_PHYSICS_SUBSTEPS = 8;

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function lengthSquared(vector) {
  return dot(vector, vector);
}

export function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector, fallback = { x: 1, y: 0 }) {
  const magnitude = length(vector);
  return magnitude > 1e-9 ? scale(vector, 1 / magnitude) : { ...fallback };
}

export function perpendicular(vector) {
  return { x: -vector.y, y: vector.x };
}

export function rotate(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function wrap(value, period = 1) {
  return ((value % period) + period) % period;
}

export function smoothstep(edge0, edge1, value) {
  if (Math.abs(edge1 - edge0) < 1e-9) return value >= edge1 ? 1 : 0;
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

export function mulberry32(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function regularPolygon(
  sides,
  {
    radius = 0.72,
    rotation = -Math.PI / 2,
    center = { x: 0, y: 0 },
    starDepth = 0,
    aspect = 1,
  } = {},
) {
  const count = Math.max(3, Math.min(32, Math.round(sides)));
  const vertexCount = starDepth > 0 ? count * 2 : count;
  return Array.from({ length: vertexCount }, (_, index) => {
    const alternatingRadius = starDepth > 0 && index % 2 === 1
      ? radius * (1 - clamp(starDepth, 0, 0.82))
      : radius;
    const angle = rotation + index / vertexCount * TAU;
    return {
      x: center.x + Math.cos(angle) * alternatingRadius * aspect,
      y: center.y + Math.sin(angle) * alternatingRadius / aspect,
    };
  });
}

export function polygonEdges(points, closed = true) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const count = closed ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, index) => ({
    a: points[index],
    b: points[(index + 1) % points.length],
    index,
  }));
}

export function polygonSignedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  return polygonEdges(points).reduce(
    (sum, edge) => sum + edge.a.x * edge.b.y - edge.b.x * edge.a.y,
    0,
  ) / 2;
}

export function polygonArea(points) {
  return Math.abs(polygonSignedArea(points));
}

export function polygonCentroid(points) {
  const signedArea = polygonSignedArea(points);
  if (Math.abs(signedArea) < 1e-9) {
    const sum = points.reduce((total, point) => add(total, point), { x: 0, y: 0 });
    return scale(sum, 1 / Math.max(1, points.length));
  }
  let x = 0;
  let y = 0;
  for (const edge of polygonEdges(points)) {
    const weight = edge.a.x * edge.b.y - edge.b.x * edge.a.y;
    x += (edge.a.x + edge.b.x) * weight;
    y += (edge.a.y + edge.b.y) * weight;
  }
  const divisor = 6 * signedArea;
  return { x: x / divisor, y: y / divisor };
}

export function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y || 1e-12) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(point, a, b) {
  const delta = sub(b, a);
  const denominator = lengthSquared(delta);
  const t = denominator > 1e-12 ? clamp(dot(sub(point, a), delta) / denominator) : 0;
  const position = add(a, scale(delta, t));
  return { point: position, t, distance: distance(point, position) };
}

export function measurePolyline(points, closed = true) {
  const edges = polygonEdges(points, closed);
  const cumulative = [0];
  let total = 0;
  for (const edge of edges) {
    total += distance(edge.a, edge.b);
    cumulative.push(total);
  }
  return { points, closed, edges, cumulative, total };
}

export function pointAtDistance(path, requestedDistance) {
  if (!path?.edges?.length || path.total <= 1e-9) {
    return { x: 0, y: 0, tangent: { x: 1, y: 0 }, edgeIndex: 0, edgeT: 0, distance: 0 };
  }
  const location = path.closed
    ? wrap(requestedDistance, path.total)
    : clamp(requestedDistance, 0, path.total);
  let edgeIndex = path.edges.length - 1;
  for (let index = 0; index < path.edges.length; index += 1) {
    if (location <= path.cumulative[index + 1] + 1e-12) {
      edgeIndex = index;
      break;
    }
  }
  const edge = path.edges[edgeIndex];
  const edgeLength = Math.max(1e-9, path.cumulative[edgeIndex + 1] - path.cumulative[edgeIndex]);
  const edgeT = clamp((location - path.cumulative[edgeIndex]) / edgeLength);
  const tangent = normalize(sub(edge.b, edge.a));
  return {
    x: lerp(edge.a.x, edge.b.x, edgeT),
    y: lerp(edge.a.y, edge.b.y, edgeT),
    tangent,
    edgeIndex,
    edgeT,
    distance: location,
  };
}

export function closestPointOnPolyline(point, path) {
  let best = null;
  path.edges.forEach((edge, edgeIndex) => {
    const candidate = closestPointOnSegment(point, edge.a, edge.b);
    if (!best || candidate.distance < best.distance) {
      const edgeLength = path.cumulative[edgeIndex + 1] - path.cumulative[edgeIndex];
      best = {
        ...candidate,
        edgeIndex,
        pathDistance: path.cumulative[edgeIndex] + candidate.t * edgeLength,
        tangent: normalize(sub(edge.b, edge.a)),
      };
    }
  });
  return best;
}

export function convexHull(points) {
  if (!Array.isArray(points) || points.length <= 1) return [...(points ?? [])];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y || (a.id ?? 0) - (b.id ?? 0));
  const orientation = (origin, a, b) => cross(sub(a, origin), sub(b, origin));
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && orientation(lower.at(-2), lower.at(-1), point) <= 1e-10) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && orientation(upper.at(-2), upper.at(-1), point) <= 1e-10) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function circumcircle(a, b, c) {
  const denominator = 2 * (
    a.x * (b.y - c.y)
    + b.x * (c.y - a.y)
    + c.x * (a.y - b.y)
  );
  if (Math.abs(denominator) < 1e-10) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const center = {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / denominator,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / denominator,
  };
  return { center, radiusSquared: lengthSquared(sub(a, center)) };
}

/** Brute-force empty-circumcircle Delaunay edges; intended for <= 32 points. */
export function delaunayEdges(points) {
  const edges = new Map();
  for (let a = 0; a < points.length - 2; a += 1) {
    for (let b = a + 1; b < points.length - 1; b += 1) {
      for (let c = b + 1; c < points.length; c += 1) {
        const circle = circumcircle(points[a], points[b], points[c]);
        if (!circle) continue;
        let empty = true;
        for (let other = 0; other < points.length; other += 1) {
          if (other === a || other === b || other === c) continue;
          if (lengthSquared(sub(points[other], circle.center)) < circle.radiusSquared - 1e-8) {
            empty = false;
            break;
          }
        }
        if (!empty) continue;
        for (const [left, right] of [[a, b], [b, c], [c, a]]) {
          const leftId = points[left].id ?? left;
          const rightId = points[right].id ?? right;
          const key = leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`;
          if (!edges.has(key)) edges.set(key, { a: points[left], b: points[right], key });
        }
      }
    }
  }
  return [...edges.values()];
}

export function createFixedStepper({ step = PHYSICS_STEP, maxSubsteps = MAX_PHYSICS_SUBSTEPS } = {}) {
  let accumulator = 0;
  return {
    advance(deltaSeconds, callback, timeScale = 1) {
      accumulator += clamp(deltaSeconds, 0, 0.05) * clamp(timeScale, 0, 4);
      let iterations = 0;
      while (accumulator >= step && iterations < maxSubsteps) {
        callback(step);
        accumulator -= step;
        iterations += 1;
      }
      if (iterations === maxSubsteps && accumulator >= step) accumulator %= step;
      return { iterations, alpha: accumulator / step };
    },
    reset() {
      accumulator = 0;
    },
  };
}

export const PHYSICS_COLORS = Object.freeze({
  background: "#050608",
  ink: "#dbe4e0",
  muted: "#77837e",
  faint: "#454e4b",
  line: "rgba(214, 232, 226, 0.14)",
  lineSoft: "rgba(214, 232, 226, 0.07)",
  point: "#fff3d6",
  mint: "#5fe8c4",
  blue: "#7db4ff",
  violet: "#c79bff",
  orange: "#ffb86b",
  coral: "#ff826f",
  brass: "#e8c46b",
});

export function createPainter(context, width, height, accent = PHYSICS_COLORS.mint) {
  const scaleFactor = Math.max(1, Math.min(width, height) * 0.43);
  const center = { x: width / 2, y: height / 2 };
  const toScreen = (point) => ({
    x: center.x + point.x * scaleFactor,
    y: center.y - point.y * scaleFactor,
  });
  const fromScreen = (point) => ({
    x: (point.x - center.x) / scaleFactor,
    y: (center.y - point.y) / scaleFactor,
  });
  const line = (a, b, {
    color = PHYSICS_COLORS.line,
    width: lineWidth = 1,
    alpha = 1,
    dash = [],
  } = {}) => {
    const start = toScreen(a);
    const end = toScreen(b);
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  };
  const polyline = (points, {
    color = accent,
    width: lineWidth = 1.5,
    alpha = 1,
    close = false,
    fill = null,
    dash = [],
  } = {}) => {
    if (!points.length) return;
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.beginPath();
    const first = toScreen(points[0]);
    context.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = toScreen(points[index]);
      context.lineTo(point.x, point.y);
    }
    if (close) context.closePath();
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    context.stroke();
    context.restore();
  };
  const circle = (point, radius, {
    color = accent,
    fill = PHYSICS_COLORS.background,
    width: lineWidth = 1.5,
    alpha = 1,
  } = {}) => {
    const screen = toScreen(point);
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(screen.x, screen.y, Math.max(1, radius * scaleFactor), 0, TAU);
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (lineWidth > 0) {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    }
    context.restore();
  };
  const text = (value, point, {
    color = PHYSICS_COLORS.muted,
    size = 10,
    align = "center",
    baseline = "middle",
    alpha = 1,
  } = {}) => {
    const screen = toScreen(point);
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(String(value), screen.x, screen.y);
    context.restore();
  };
  const arrow = (a, b, options = {}) => {
    line(a, b, options);
    const direction = normalize(sub(b, a));
    const normal = perpendicular(direction);
    const headLength = options.headLength ?? 0.045;
    line(b, add(b, add(scale(direction, -headLength), scale(normal, headLength * 0.55))), options);
    line(b, add(b, add(scale(direction, -headLength), scale(normal, -headLength * 0.55))), options);
  };
  return {
    context,
    width,
    height,
    accent,
    scale: scaleFactor,
    center,
    toScreen,
    fromScreen,
    line,
    polyline,
    circle,
    text,
    arrow,
  };
}

export function normalizedVoice({
  key,
  pitch01 = 0.5,
  gain = 0.1,
  pan = 0,
  waveform = "sine",
}) {
  return {
    key: String(key),
    pitch01: clamp(pitch01),
    gain: clamp(gain),
    pan: clamp(pan, -1, 1),
    waveform,
  };
}

export function makeEventQueue(limit = 64) {
  const events = [];
  return {
    push(event) {
      if (events.length >= limit) events.shift();
      events.push(event);
    },
    drain() {
      return events.splice(0, events.length);
    },
    clear() {
      events.length = 0;
    },
  };
}

export function rangeControl(key, label, minimum, maximum, step, value, format = null) {
  return Object.freeze({ type: "range", key, label, min: minimum, max: maximum, step, value, format });
}

export function selectControl(key, label, options, value) {
  return Object.freeze({ type: "select", key, label, options, value });
}

export function toggleControl(key, label, value = false) {
  return Object.freeze({ type: "toggle", key, label, value: Boolean(value) });
}
