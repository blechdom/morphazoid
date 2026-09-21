const TAU = Math.PI * 2;
const DEFAULT_SEED = 27183;

export const PATH_LIMITS = Object.freeze({
  detailMin: 1,
  detailMax: 7,
  aspectMin: 0.55,
  aspectMax: 2.4,
  maxPoints: 6000,
});

export const PATH_FAMILIES = Object.freeze([
  Object.freeze({ id: "gilbert", label: "Gilbert", kind: "rectangular fill", minDetail: 2, maxDetail: 6, defaultDetail: 4 }),
  Object.freeze({ id: "hilbert", label: "Hilbert", kind: "square fill", minDetail: 1, maxDetail: 6, defaultDetail: 5 }),
  Object.freeze({ id: "gosper", label: "Gosper", kind: "hexagonal flow", minDetail: 1, maxDetail: 4, defaultDetail: 4 }),
  Object.freeze({ id: "dragon", label: "Dragon", kind: "folding path", minDetail: 2, maxDetail: 7, defaultDetail: 6 }),
  Object.freeze({ id: "walk", label: "Walk", kind: "seeded growth", minDetail: 1, maxDetail: 6, defaultDetail: 4 }),
]);

export const DEFAULT_PATH_SETTINGS = Object.freeze({
  family: "gilbert",
  detail: 4,
  aspect: 1,
  seed: DEFAULT_SEED,
});

const FAMILY_IDS = new Set(PATH_FAMILIES.map(({ id }) => id));

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function integer(value, minimum, maximum, fallback = minimum) {
  return clamp(Math.round(finite(Number(value), fallback)), minimum, maximum);
}

function seedValue(value) {
  return integer(value, 1, 99999, DEFAULT_SEED);
}

export function pathFamilyFor(id) {
  return PATH_FAMILIES.find((family) => family.id === id) ?? PATH_FAMILIES[0];
}

export function sanitizePathSettings(settings = {}) {
  const family = FAMILY_IDS.has(settings.family) ? settings.family : DEFAULT_PATH_SETTINGS.family;
  const definition = pathFamilyFor(family);
  return {
    family,
    detail: integer(
      settings.detail,
      definition.minDetail,
      definition.maxDetail,
      definition.defaultDetail,
    ),
    aspect: clamp(
      finite(Number(settings.aspect), DEFAULT_PATH_SETTINGS.aspect),
      PATH_LIMITS.aspectMin,
      PATH_LIMITS.aspectMax,
    ),
    seed: seedValue(settings.seed),
  };
}

function randomSource(seed) {
  let state = seedValue(seed) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function hierarchyAt(index, order, radix = 2) {
  if (index <= 0 || order <= 1) return 0;
  let cursor = index;
  let level = 0;
  while (level < order && cursor % radix === 0) {
    cursor /= radix;
    level += 1;
  }
  return clamp(level / order, 0, 1);
}

function hilbertPoint(index, side) {
  let x = 0;
  let y = 0;
  let cursor = index;
  for (let scale = 1; scale < side; scale *= 2) {
    const rx = 1 & Math.floor(cursor / 2);
    const ry = 1 & (cursor ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = scale - 1 - x;
        y = scale - 1 - y;
      }
      [x, y] = [y, x];
    }
    x += scale * rx;
    y += scale * ry;
    cursor = Math.floor(cursor / 4);
  }
  return { x, y };
}

function generateHilbert(detail) {
  const side = 2 ** detail;
  return Array.from({ length: side * side }, (_value, index) => ({
    ...hilbertPoint(index, side),
    hierarchy: hierarchyAt(index, detail, 4),
  }));
}

function sign(value) {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

// Adapted from Jakub Cerveny's BSD-2-Clause Gilbert reference implementation.
function appendGilbert(points, x, y, ax, ay, bx, by, depth = 0) {
  if (points.length >= PATH_LIMITS.maxPoints) return;
  const width = Math.abs(ax + ay);
  const height = Math.abs(bx + by);
  const dax = sign(ax);
  const day = sign(ay);
  const dbx = sign(bx);
  const dby = sign(by);

  if (height === 1) {
    for (let index = 0; index < width && points.length < PATH_LIMITS.maxPoints; index += 1) {
      points.push({ x, y, hierarchy: clamp(depth / 12, 0, 1) });
      x += dax;
      y += day;
    }
    return;
  }
  if (width === 1) {
    for (let index = 0; index < height && points.length < PATH_LIMITS.maxPoints; index += 1) {
      points.push({ x, y, hierarchy: clamp(depth / 12, 0, 1) });
      x += dbx;
      y += dby;
    }
    return;
  }

  let ax2 = Math.floor(ax / 2);
  let ay2 = Math.floor(ay / 2);
  let bx2 = Math.floor(bx / 2);
  let by2 = Math.floor(by / 2);
  const width2 = Math.abs(ax2 + ay2);
  const height2 = Math.abs(bx2 + by2);

  if (2 * width > 3 * height) {
    if (width2 % 2 && width > 2) {
      ax2 += dax;
      ay2 += day;
    }
    appendGilbert(points, x, y, ax2, ay2, bx, by, depth + 1);
    appendGilbert(points, x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, depth + 1);
    return;
  }

  if (height2 % 2 && height > 2) {
    bx2 += dbx;
    by2 += dby;
  }
  appendGilbert(points, x, y, bx2, by2, ax2, ay2, depth + 1);
  appendGilbert(points, x + bx2, y + by2, ax, ay, bx - bx2, by - by2, depth + 1);
  appendGilbert(
    points,
    x + (ax - dax) + (bx2 - dbx),
    y + (ay - day) + (by2 - dby),
    -bx2,
    -by2,
    -(ax - ax2),
    -(ay - ay2),
    depth + 1,
  );
}

function gilbertDimensions(detail, aspect) {
  const minor = 10 + detail * 6;
  if (aspect >= 1) return { width: Math.round(minor * aspect), height: minor };
  return { width: minor, height: Math.round(minor / aspect) };
}

function generateGilbert(detail, aspect) {
  const { width, height } = gilbertDimensions(detail, aspect);
  const points = [];
  if (width >= height) appendGilbert(points, 0, 0, width, 0, 0, height);
  else appendGilbert(points, 0, 0, 0, height, width, 0);
  return { points, dimensions: { width, height } };
}

function expandCommands(axiom, rules, iterations) {
  let commands = axiom;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let next = "";
    for (const command of commands) next += rules[command] ?? command;
    commands = next;
  }
  return commands;
}

function turtlePath(commands, angleStep, order) {
  let x = 0;
  let y = 0;
  let angle = 0;
  const points = [{ x, y, hierarchy: 0 }];
  let segment = 0;
  for (const command of commands) {
    if (command === "+") angle += angleStep;
    else if (command === "-") angle -= angleStep;
    else if (command === "A" || command === "B" || command === "F") {
      x += Math.cos(angle);
      y += Math.sin(angle);
      segment += 1;
      points.push({ x, y, hierarchy: hierarchyAt(segment, order, 2) });
      if (points.length >= PATH_LIMITS.maxPoints) break;
    }
  }
  return points;
}

function generateGosper(detail) {
  const commands = expandCommands("A", {
    A: "A-B--B+A++AA+B-",
    B: "+A-BB--B-A++A+B",
  }, detail);
  return turtlePath(commands, Math.PI / 3, detail);
}

function generateDragon(detail) {
  const order = detail + 4;
  const commands = expandCommands("FX", {
    X: "X+YF+",
    Y: "-FX-Y",
  }, order);
  return turtlePath(commands, Math.PI / 2, order);
}

function generateWalk(detail, seed) {
  const target = 180 + detail * 140;
  const side = Math.max(17, Math.ceil(Math.sqrt(target * 1.35)));
  const random = randomSource(seed);
  const starts = [
    [0, 0],
    [side - 1, 0],
    [side - 1, side - 1],
    [0, side - 1],
  ];
  const start = starts[Math.floor(random() * starts.length)];
  const key = (x, y) => y * side + x;
  const neighbors = (point) => [
    [point.x + 1, point.y],
    [point.x, point.y + 1],
    [point.x - 1, point.y],
    [point.x, point.y - 1],
  ].filter(([x, y]) => x >= 0 && y >= 0 && x < side && y < side);
  const visited = new Set([key(start[0], start[1])]);
  const path = [{ x: start[0], y: start[1], hierarchy: 0 }];
  let best = path.map((point) => ({ ...point }));
  const frames = [{ options: null }];
  let attempts = 0;

  while (frames.length && path.length < target && attempts < 160000) {
    attempts += 1;
    const frame = frames.at(-1);
    const current = path.at(-1);
    if (!frame.options) {
      frame.options = neighbors(current)
        .filter(([x, y]) => !visited.has(key(x, y)))
        .map(([x, y]) => {
          const onward = neighbors({ x, y })
            .filter(([nextX, nextY]) => !visited.has(key(nextX, nextY))).length;
          return { x, y, score: onward + random() * 0.7 };
        })
        .sort((left, right) => left.score - right.score);
    }

    const next = frame.options.shift();
    if (next && !visited.has(key(next.x, next.y))) {
      visited.add(key(next.x, next.y));
      path.push({
        x: next.x,
        y: next.y,
        hierarchy: clamp(path.length / target, 0, 1),
      });
      frames.push({ options: null });
      if (path.length > best.length) best = path.map((point) => ({ ...point }));
      continue;
    }

    if (frame.options.length) continue;
    frames.pop();
    if (path.length > 1) {
      const removed = path.pop();
      visited.delete(key(removed.x, removed.y));
    }
  }
  return best;
}

function normalizePoints(points, aspect) {
  if (!points.length) return [{ x: 0, y: 0, hierarchy: 0 }];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(1e-9, maxX - minX);
  const height = Math.max(1e-9, maxY - minY);
  const halfX = aspect >= 1 ? 0.94 : 0.94 * aspect;
  const halfY = aspect >= 1 ? 0.94 / aspect : 0.94;
  return points.map((point) => ({
    x: ((point.x - minX) / width * 2 - 1) * halfX,
    y: ((point.y - minY) / height * 2 - 1) * halfY,
    hierarchy: clamp(finite(point.hierarchy, 0), 0, 1),
  }));
}

function signedAngleDifference(from, to) {
  let difference = (to - from) % TAU;
  if (difference > Math.PI) difference -= TAU;
  if (difference < -Math.PI) difference += TAU;
  return difference;
}

function measuredPath(points, metadata = {}, freeze = false) {
  const clean = [];
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    const next = {
      x: point.x,
      y: point.y,
      hierarchy: clamp(finite(point.hierarchy, 0), 0, 1),
    };
    const previous = clean.at(-1);
    if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < 1e-10) continue;
    clean.push(next);
  }
  if (!clean.length) clean.push({ x: 0, y: 0, hierarchy: 0 });

  const cumulative = [0];
  let length = 0;
  let turns = 0;
  let previousAngle = null;
  for (let index = 1; index < clean.length; index += 1) {
    const dx = clean[index].x - clean[index - 1].x;
    const dy = clean[index].y - clean[index - 1].y;
    length += Math.hypot(dx, dy);
    cumulative.push(length);
    const angle = Math.atan2(dy, dx);
    if (previousAngle !== null && Math.abs(signedAngleDifference(previousAngle, angle)) > 0.12) turns += 1;
    previousAngle = angle;
  }

  const result = {
    ...metadata,
    points: clean,
    cumulative,
    metrics: Object.freeze({
      pointCount: clean.length,
      segmentCount: Math.max(0, clean.length - 1),
      length,
      turns,
    }),
  };
  if (!freeze) return result;
  result.points = Object.freeze(result.points.map((point) => Object.freeze(point)));
  result.cumulative = Object.freeze([...result.cumulative]);
  return Object.freeze(result);
}

export function generatePath(settings = {}) {
  const safe = sanitizePathSettings(settings);
  let raw;
  let dimensions = null;
  if (safe.family === "hilbert") raw = generateHilbert(safe.detail);
  else if (safe.family === "gosper") raw = generateGosper(safe.detail);
  else if (safe.family === "dragon") raw = generateDragon(safe.detail);
  else if (safe.family === "walk") raw = generateWalk(safe.detail, safe.seed);
  else {
    const gilbert = generateGilbert(safe.detail, safe.aspect);
    raw = gilbert.points;
    dimensions = gilbert.dimensions;
  }
  const family = pathFamilyFor(safe.family);
  return measuredPath(normalizePoints(raw, safe.aspect), {
    settings: Object.freeze({ ...safe }),
    family,
    dimensions: dimensions ? Object.freeze(dimensions) : null,
  }, true);
}

export function samplePath(path, phase = 0) {
  const points = Array.isArray(path?.points) ? path.points : [];
  const cumulative = Array.isArray(path?.cumulative) ? path.cumulative : [];
  const total = Number(path?.metrics?.length) || 0;
  if (!points.length) {
    return { x: 0, y: 0, angle: 0, curvature: 0, hierarchy: 0, segmentIndex: 0, progress: 0 };
  }
  if (points.length === 1 || total <= 1e-10) {
    return { ...points[0], angle: 0, curvature: 0, segmentIndex: 0, progress: 0 };
  }
  const progress = clamp(finite(Number(phase), 0), 0, 1);
  const target = total * progress;
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle] < target) low = middle + 1;
    else high = middle;
  }
  const pointIndex = clamp(low, 1, points.length - 1);
  const segmentIndex = pointIndex - 1;
  const startDistance = cumulative[segmentIndex];
  const endDistance = cumulative[pointIndex];
  const amount = endDistance > startDistance ? (target - startDistance) / (endDistance - startDistance) : 0;
  const start = points[segmentIndex];
  const end = points[pointIndex];
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  let nextAngle = angle;
  if (pointIndex < points.length - 1) {
    nextAngle = Math.atan2(
      points[pointIndex + 1].y - end.y,
      points[pointIndex + 1].x - end.x,
    );
  }
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    angle,
    curvature: clamp(signedAngleDifference(angle, nextAngle) / Math.PI, -1, 1),
    hierarchy: start.hierarchy + (end.hierarchy - start.hierarchy) * amount,
    segmentIndex,
    progress,
  };
}

export function partialPath(path, phase = 0) {
  const points = Array.isArray(path?.points) ? path.points : [];
  if (!points.length) return [];
  const sample = samplePath(path, phase);
  const result = points.slice(0, sample.segmentIndex + 1).map((point) => ({ ...point }));
  const end = result.at(-1);
  if (!end || Math.hypot(sample.x - end.x, sample.y - end.y) > 1e-10) {
    result.push({ x: sample.x, y: sample.y, hierarchy: sample.hierarchy });
  }
  return result;
}

function svgNumber(value) {
  return finite(Number(value), 0).toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

export function pathSvgData(path, phase = 1) {
  const points = partialPath(path, phase);
  if (!points.length) return "";
  return points.map((point, index) => `${index ? "L" : "M"} ${svgNumber(point.x)} ${svgNumber(-point.y)}`).join(" ");
}

export function pathDetailLabel(settings = {}) {
  const safe = sanitizePathSettings(settings);
  if (safe.family === "gilbert") {
    const { width, height } = gilbertDimensions(safe.detail, safe.aspect);
    return `${width} x ${height}`;
  }
  if (safe.family === "dragon") return `I${safe.detail + 4}`;
  if (safe.family === "walk") return `${180 + safe.detail * 140} steps`;
  return `I${safe.detail}`;
}
