export const INSTRUMENTS = Object.freeze([
  Object.freeze({ id: "kick", label: "Kick", short: "K", color: "#ff654f", key: "1", cooldown: 130 }),
  Object.freeze({ id: "snare", label: "Snare", short: "S", color: "#55d9e8", key: "2", cooldown: 110 }),
  Object.freeze({ id: "hat", label: "Hi-hat", short: "H", color: "#ffd35a", key: "3", cooldown: 65 }),
  Object.freeze({ id: "clap", label: "Clap", short: "C", color: "#a985ff", key: "4", cooldown: 150 }),
  Object.freeze({ id: "sample", label: "Mic sample", short: "M", color: "#ff91cb", key: "5", cooldown: 120 }),
]);

export const INSTRUMENT_BY_ID = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function displayPointToNormalized(clientX, clientY, rect) {
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  };
}

export function mirroredX(x) {
  return 1 - x;
}

export function motionCentroid(mask, width, height, { minPixels = 1 } = {}) {
  if (
    mask == null
    || !Number.isInteger(width)
    || width <= 0
    || !Number.isInteger(height)
    || height <= 0
    || mask.length !== width * height
  ) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    sumX += index % width;
    sumY += Math.floor(index / width);
    count += 1;
  }
  const minimum = Number.isFinite(minPixels) ? Math.max(1, Math.floor(minPixels)) : 1;
  if (count < minimum) return null;
  const x = sumX / count;
  const y = sumY / count;
  return {
    x,
    y,
    normalizedX: (x + 0.5) / width,
    normalizedY: (y + 0.5) / height,
    count,
  };
}

export function crossedHorizontalLines(previous, current, lineCount = 12) {
  if (
    !previous
    || !current
    || !Number.isFinite(previous.y)
    || !Number.isFinite(current.y)
    || !Number.isInteger(lineCount)
    || lineCount < 1
    || previous.y === current.y
  ) return [];
  const start = clamp(previous.y, 0, 1);
  const end = clamp(current.y, 0, 1);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const crossed = [];
  for (let index = 0; index < lineCount; index += 1) {
    const y = (index + 0.5) / lineCount;
    if (y > low && y <= high) crossed.push(index);
  }
  return end > start ? crossed : crossed.reverse();
}

function hasReadableFrame(rgba, width, height) {
  return (
    rgba != null
    && Number.isInteger(width)
    && width > 0
    && Number.isInteger(height)
    && height > 0
    && Number.isInteger(rgba.length)
    && rgba.length >= width * height * 4
  );
}

function normalizedRgb(color) {
  if (!color || ![color.r, color.g, color.b].every(Number.isFinite)) return null;
  return {
    r: clamp(color.r, 0, 255),
    g: clamp(color.g, 0, 255),
    b: clamp(color.b, 0, 255),
  };
}

export function sampleFrameColor(rgba, width, height, x, y, { radius = 0 } = {}) {
  if (!hasReadableFrame(rgba, width, height) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const pixelX = clamp(Math.floor(x), 0, width - 1);
  const pixelY = clamp(Math.floor(y), 0, height - 1);
  const sampleRadius = Number.isFinite(radius) ? clamp(Math.floor(radius), 0, 8) : 0;
  if (!sampleRadius) {
    const index = (pixelY * width + pixelX) * 4;
    return { r: rgba[index], g: rgba[index + 1], b: rgba[index + 2] };
  }

  const channels = [[], [], []];
  const startX = Math.max(0, pixelX - sampleRadius);
  const endX = Math.min(width - 1, pixelX + sampleRadius);
  const startY = Math.max(0, pixelY - sampleRadius);
  const endY = Math.min(height - 1, pixelY + sampleRadius);
  for (let sampleY = startY; sampleY <= endY; sampleY += 1) {
    for (let sampleX = startX; sampleX <= endX; sampleX += 1) {
      const index = (sampleY * width + sampleX) * 4;
      channels[0].push(rgba[index]);
      channels[1].push(rgba[index + 1]);
      channels[2].push(rgba[index + 2]);
    }
  }
  for (const channel of channels) channel.sort((a, b) => a - b);
  const middle = Math.floor(channels[0].length / 2);
  return { r: channels[0][middle], g: channels[1][middle], b: channels[2][middle] };
}

export function findColorCentroid(
  rgba,
  width,
  height,
  target,
  { tolerance = 48, stride = 1, origin = null, minComponentPixels = 1 } = {},
) {
  const color = normalizedRgb(target);
  if (!hasReadableFrame(rgba, width, height) || !color) return null;

  const numericTolerance = Number.isFinite(tolerance) ? tolerance : 48;
  const boundedTolerance = clamp(numericTolerance, 0, Math.sqrt(3 * 255 ** 2));
  const toleranceSquared = boundedTolerance ** 2;
  const sampleStride = Number.isFinite(stride) ? Math.max(1, Math.floor(stride)) : 1;
  const matches = new Uint8Array(width * height);
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < height; y += sampleStride) {
    for (let x = 0; x < width; x += sampleStride) {
      const index = (y * width + x) * 4;
      const redDelta = rgba[index] - color.r;
      const greenDelta = rgba[index + 1] - color.g;
      const blueDelta = rgba[index + 2] - color.b;
      const distanceSquared = redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2;
      if (distanceSquared > toleranceSquared) continue;
      matches[y * width + x] = 1;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }

  if (!count) return null;
  const hasOrigin = origin
    && Number.isFinite(origin.x)
    && Number.isFinite(origin.y);
  if (hasOrigin && sampleStride === 1) {
    const visited = new Uint8Array(matches.length);
    const stack = new Int32Array(matches.length);
    const minimum = Number.isFinite(minComponentPixels)
      ? Math.max(1, Math.floor(minComponentPixels))
      : 1;
    const originX = clamp(origin.x, 0, 1);
    const originY = clamp(origin.y, 0, 1);
    let best = null;

    for (let start = 0; start < matches.length; start += 1) {
      if (!matches[start] || visited[start]) continue;
      let stackLength = 1;
      let componentCount = 0;
      let componentSumX = 0;
      let componentSumY = 0;
      stack[0] = start;
      visited[start] = 1;
      while (stackLength) {
        const index = stack[--stackLength];
        const pixelX = index % width;
        const pixelY = Math.floor(index / width);
        componentCount += 1;
        componentSumX += pixelX;
        componentSumY += pixelY;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            const neighborX = pixelX + offsetX;
            const neighborY = pixelY + offsetY;
            if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
            const neighbor = neighborY * width + neighborX;
            if (!matches[neighbor] || visited[neighbor]) continue;
            visited[neighbor] = 1;
            stack[stackLength++] = neighbor;
          }
        }
      }
      if (componentCount < minimum) continue;
      const componentX = componentSumX / componentCount;
      const componentY = componentSumY / componentCount;
      const normalizedX = (componentX + 0.5) / width;
      const normalizedY = (componentY + 0.5) / height;
      const distance = (normalizedX - originX) ** 2 + (normalizedY - originY) ** 2;
      if (!best || distance < best.distance || (distance === best.distance && componentCount > best.count)) {
        best = {
          x: componentX,
          y: componentY,
          normalizedX,
          normalizedY,
          count: componentCount,
          distance,
        };
      }
    }

    if (!best) return null;
    return {
      x: best.x,
      y: best.y,
      normalizedX: best.normalizedX,
      normalizedY: best.normalizedY,
      count: best.count,
    };
  }

  const x = sumX / count;
  const y = sumY / count;
  return {
    x,
    y,
    normalizedX: (x + 0.5) / width,
    normalizedY: (y + 0.5) / height,
    count,
  };
}

function pointSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2;
  }

  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
}

function isPointInsideZone(zone, px, py, width, height, hitSlop) {
  const scale = Math.min(width, height);
  const points = zone.points ?? [];

  if (zone.type === "rect") {
    const start = points[0];
    const end = points[1] ?? start;
    if (!start) return false;
    const minX = Math.min(start.x, end.x) * width - hitSlop;
    const maxX = Math.max(start.x, end.x) * width + hitSlop;
    const minY = Math.min(start.y, end.y) * height - hitSlop;
    const maxY = Math.max(start.y, end.y) * height + hitSlop;
    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  }

  if (zone.type === "dot") {
    const center = points[0];
    if (!center) return false;
    const radius = Math.max(zone.radius * scale, 2) + hitSlop;
    const dx = px - center.x * width;
    const dy = py - center.y * height;
    return dx * dx + dy * dy <= radius * radius;
  }

  if (!points.length) return false;
  const radius = Math.max((zone.size * scale) / 2, 2) + hitSlop;
  if (points.length === 1) {
    const dx = px - points[0].x * width;
    const dy = py - points[0].y * height;
    return dx * dx + dy * dy <= radius * radius;
  }

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distanceSquared = pointSegmentDistanceSquared(
      px,
      py,
      start.x * width,
      start.y * height,
      end.x * width,
      end.y * height,
    );
    if (distanceSquared <= radius * radius) return true;
  }
  return false;
}

export function rasterizeZones(zones, width, height, { hitSlop = 1 } = {}) {
  const owners = new Uint16Array(width * height);

  for (const zone of zones) {
    if (!zone.id || zone.id > 65_535) continue;
    for (let y = 0; y < height; y += 1) {
      const py = y + 0.5;
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        if (isPointInsideZone(zone, x + 0.5, py, width, height, hitSlop)) {
          owners[rowOffset + x] = zone.id;
        }
      }
    }
  }

  const areas = new Map();
  for (const owner of owners) {
    if (owner) areas.set(owner, (areas.get(owner) ?? 0) + 1);
  }
  return { owners, areas };
}

export function countMotionByZone(motionMask, ownerMap) {
  if (motionMask.length !== ownerMap.length) {
    throw new RangeError("Motion and ownership maps must have the same length");
  }

  const counts = new Map();
  for (let index = 0; index < motionMask.length; index += 1) {
    const owner = ownerMap[index];
    if (motionMask[index] && owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
}

export function rgbaToLuma(rgba, output = new Uint8Array(rgba.length / 4)) {
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    output[target] = (77 * rgba[source] + 150 * rgba[source + 1] + 29 * rgba[source + 2]) >> 8;
  }
  return output;
}

export function diffLuma(previous, current, width, height, threshold, neighborMinimum = 1) {
  if (previous.length !== current.length || previous.length !== width * height) {
    throw new RangeError("Luma buffers do not match the supplied dimensions");
  }

  const candidates = new Uint8Array(previous.length);
  for (let index = 0; index < current.length; index += 1) {
    candidates[index] = Math.abs(current[index] - previous[index]) >= threshold ? 1 : 0;
  }

  if (neighborMinimum <= 0) return candidates;
  const filtered = new Uint8Array(candidates.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!candidates[index]) continue;
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          neighbors += candidates[index + offsetY * width + offsetX];
        }
      }
      if (neighbors >= neighborMinimum) filtered[index] = 1;
    }
  }
  return filtered;
}

export class MotionDifferencer {
  constructor(width, height) {
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.previous = null;
    this.current = new Uint8Array(width * height);
    this.levels = new Uint8Array(width * height);
  }

  reset() {
    this.previous = null;
  }

  process(rgba, threshold, neighborMinimum = 1) {
    rgbaToLuma(rgba, this.current);
    if (!this.previous) {
      this.previous = new Uint8Array(this.current);
      this.levels.fill(0);
      return { mask: new Uint8Array(this.current.length), levels: this.levels, count: 0, primed: false };
    }

    const mask = diffLuma(this.previous, this.current, this.width, this.height, threshold, neighborMinimum);
    for (let index = 0; index < mask.length; index += 1) {
      this.levels[index] = mask[index]
        ? clamp(Math.abs(this.current[index] - this.previous[index]) * 3, 48, 255)
        : 0;
    }
    this.previous.set(this.current);
    let count = 0;
    for (const value of mask) count += value;
    return { mask, levels: this.levels, count, primed: true };
  }
}

export class TriggerGate {
  constructor({ releaseDelay = 60 } = {}) {
    this.releaseDelay = releaseDelay;
    this.states = new Map();
  }

  reset() {
    this.states.clear();
  }

  isActive(zoneId) {
    return Boolean(this.states.get(zoneId)?.active);
  }

  update(zones, scores, areas, now, sensitivity = 60) {
    const hits = [];
    const zoneIds = new Set(zones.map((zone) => zone.id));
    for (const id of this.states.keys()) {
      if (!zoneIds.has(id)) this.states.delete(id);
    }

    const areaFraction = 0.085 - clamp(sensitivity, 0, 100) * 0.00065;
    for (const zone of zones) {
      const instrument = INSTRUMENT_BY_ID.get(zone.instrument);
      if (!instrument) continue;
      const state = this.states.get(zone.id) ?? {
        active: false,
        releaseStartedAt: null,
        nextAllowedAt: 0,
      };
      const area = areas.get(zone.id) ?? 0;
      const onPixels = clamp(Math.ceil(area * areaFraction), 3, 20);
      const offPixels = Math.max(1, Math.floor(onPixels * 0.4));
      const score = scores.get(zone.id) ?? 0;

      if (score >= onPixels) {
        state.releaseStartedAt = null;
        if (!state.active && now >= state.nextAllowedAt) {
          state.active = true;
          state.nextAllowedAt = now + instrument.cooldown;
          const strength = clamp(score / Math.max(onPixels * 3, 1), 0.55, 1);
          hits.push({ zone, strength, score, threshold: onPixels });
        }
      } else if (state.active && score <= offPixels) {
        if (state.releaseStartedAt === null) state.releaseStartedAt = now;
        if (now - state.releaseStartedAt >= this.releaseDelay) {
          state.active = false;
          state.releaseStartedAt = null;
        }
      } else {
        state.releaseStartedAt = null;
      }
      this.states.set(zone.id, state);
    }
    return hits;
  }
}

export function cloneZones(zones) {
  return JSON.parse(JSON.stringify(zones));
}

export function defaultGridZones(startingId = 40_000) {
  const instruments = [
    "kick", "snare", "hat", "clap",
    "hat", "clap", "kick", "snare",
    "clap", "hat", "snare", "kick",
  ];
  return instruments.map((instrument, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return {
      id: startingId + index,
      type: "rect",
      instrument,
      source: "grid",
      points: [
        { x: column / 4, y: row / 3 },
        { x: (column + 1) / 4, y: (row + 1) / 3 },
      ],
      size: 0,
    };
  });
}

export function starterZones(startingId = 1) {
  const positions = [
    [0.08, 0.15, 0.45, 0.45],
    [0.55, 0.15, 0.92, 0.45],
    [0.08, 0.56, 0.45, 0.86],
    [0.55, 0.56, 0.92, 0.86],
  ];
  return INSTRUMENTS.filter((instrument) => instrument.id !== "sample").map((instrument, index) => ({
    id: startingId + index,
    type: "rect",
    instrument: instrument.id,
    points: [
      { x: positions[index][0], y: positions[index][1] },
      { x: positions[index][2], y: positions[index][3] },
    ],
    size: 0.04,
  }));
}
