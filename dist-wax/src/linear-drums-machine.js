import {
  linearDrumFrequencyAtPosition,
  linearDrumParameterPosition,
  linearDrumParameterValue,
} from "./linear-drums.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const PAINT_MACHINE_TOOLS = Object.freeze(["hit", "stroke", "ring", "erase"]);
export const PAINT_MACHINE_TARGETS = Object.freeze([
  "attack",
  "decay",
  "pitchFall",
  "strikeNoise",
  "brightness",
  "inharmonicity",
  "hardness",
]);

export const PAINT_MACHINE_LAYER_DEFAULTS = Object.freeze([
  Object.freeze({
    id: 0, name: "Body", color: "#ff765f", role: "voice", presetId: "natural-line",
    target: "hardness", amount: .7,
  }),
  Object.freeze({
    id: 1, name: "Bars", color: "#5ee0c0", role: "voice", presetId: "wood-bars",
    target: "brightness", amount: .7,
  }),
  Object.freeze({
    id: 2, name: "Tines", color: "#5dcddc", role: "voice", presetId: "tine-reverse",
    target: "strikeNoise", amount: .7,
  }),
  Object.freeze({
    id: 3, name: "Bend", color: "#c28cff", role: "mod", presetId: "string-keys",
    target: "hardness", amount: .72,
  }),
]);

function sanitizePoint(source = {}) {
  return {
    x: clamp(finiteOr(source.x, 0), 0, 1),
    y: clamp(finiteOr(source.y, .5), 0, 1),
  };
}

export function simplifyPaintPoints(points, minimumDistance = .006) {
  const source = Array.isArray(points) ? points.map(sanitizePoint) : [];
  if (source.length <= 2) return source;
  const distance = clamp(finiteOr(minimumDistance, .006), .0001, .2);
  const simplified = [source[0]];
  for (let index = 1; index < source.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = source[index];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) >= distance) {
      simplified.push(current);
    }
  }
  simplified.push(source[source.length - 1]);
  return simplified;
}

export function sanitizePaintItem(source = {}, fallbackId = "item") {
  const type = ["hit", "stroke", "ring"].includes(source.type) ? source.type : "hit";
  const base = {
    id: String(source.id ?? fallbackId).slice(0, 80),
    type,
    layer: clamp(Math.round(finiteOr(source.layer, 0)), 0, PAINT_MACHINE_LAYER_DEFAULTS.length - 1),
  };
  if (type === "stroke") {
    const points = simplifyPaintPoints(source.points);
    return { ...base, points: points.length >= 2 ? points : [sanitizePoint(source), sanitizePoint(source)] };
  }
  if (type === "ring") {
    const center = sanitizePoint(source);
    return {
      ...base,
      x: center.x,
      y: center.y,
      radiusX: clamp(finiteOr(source.radiusX, .08), .006, .5),
      radiusY: clamp(finiteOr(source.radiusY, .12), .006, .5),
    };
  }
  const point = sanitizePoint(source);
  return {
    ...base,
    x: point.x,
    y: point.y,
    radius: clamp(finiteOr(source.radius, .014), .004, .08),
  };
}

export function paintMachineLoopDurationMs(bpm = 112, beats = 8) {
  const safeBpm = clamp(finiteOr(bpm, 112), 30, 300);
  const safeBeats = clamp(Math.round(finiteOr(beats, 8)), 1, 64);
  return safeBeats * 60_000 / safeBpm;
}

export function paintMachineLoopPhase(now, startedAt, bpm = 112, beats = 8) {
  const duration = paintMachineLoopDurationMs(bpm, beats);
  const elapsed = finiteOr(now, 0) - finiteOr(startedAt, 0);
  return ((elapsed % duration) + duration) % duration / duration;
}

export function paintMachinePhaseCrossed(previousPhase, currentPhase, targetPhase) {
  const previous = clamp(finiteOr(previousPhase, 0), 0, 1);
  const current = clamp(finiteOr(currentPhase, 0), 0, 1);
  const target = clamp(finiteOr(targetPhase, 0), 0, 1);
  if (current >= previous) return target > previous && target <= current;
  return target > previous || target <= current;
}

export function paintMachineIntersections(sourceItem, phase) {
  const item = sanitizePaintItem(sourceItem);
  const x = clamp(finiteOr(phase, 0), 0, 1);
  if (item.type === "hit") {
    return Math.abs(x - item.x) <= item.radius ? [item.y] : [];
  }
  if (item.type === "ring") {
    const offset = (x - item.x) / item.radiusX;
    if (Math.abs(offset) > 1) return [];
    const height = item.radiusY * Math.sqrt(Math.max(0, 1 - offset * offset));
    const values = [clamp(item.y - height, 0, 1), clamp(item.y + height, 0, 1)];
    return Math.abs(values[1] - values[0]) < 1e-6 ? [values[0]] : values;
  }

  const intersections = [];
  for (let index = 1; index < item.points.length; index += 1) {
    const start = item.points[index - 1];
    const end = item.points[index];
    const minimum = Math.min(start.x, end.x);
    const maximum = Math.max(start.x, end.x);
    if (x < minimum || x > maximum) continue;
    const width = end.x - start.x;
    const amount = Math.abs(width) < 1e-8 ? .5 : (x - start.x) / width;
    intersections.push(clamp(start.y + (end.y - start.y) * amount, 0, 1));
  }
  return [...new Set(intersections.map((value) => Number(value.toFixed(6))))];
}

export function paintMachineFrequency(verticalPosition, minimum = 20, maximum = 16_000) {
  return linearDrumFrequencyAtPosition(verticalPosition, minimum, maximum);
}

export function paintMachineApplyModulators(settings, modulators = []) {
  const result = {
    ...settings,
    parameterMaps: Object.fromEntries(Object.entries(settings.parameterMaps ?? {}).map(
      ([key, mapping]) => [key, { ...mapping }],
    )),
  };
  const grouped = new Map();
  for (const modulator of modulators) {
    if (!PAINT_MACHINE_TARGETS.includes(modulator.target)) continue;
    const values = grouped.get(modulator.target) ?? [];
    values.push({
      value: clamp(finiteOr(modulator.value, .5), 0, 1),
      amount: clamp(finiteOr(modulator.amount, 0), -1, 1),
    });
    grouped.set(modulator.target, values);
  }

  for (const [target, values] of grouped) {
    let position = linearDrumParameterPosition(target, result[target]);
    for (const { value, amount } of values) {
      const destination = amount < 0 ? 1 - value : value;
      position += (destination - position) * Math.abs(amount) / values.length;
    }
    result[target] = linearDrumParameterValue(target, clamp(position, 0, 1));
    if (result.parameterMaps[target]) result.parameterMaps[target].enabled = false;
  }
  return result;
}

export function paintMachineDistanceToItem(sourceItem, point, aspect = 1) {
  const item = sanitizePaintItem(sourceItem);
  const target = sanitizePoint(point);
  const xScale = clamp(finiteOr(aspect, 1), .1, 10);
  const distance = (left, right) => Math.hypot((left.x - right.x) * xScale, left.y - right.y);
  if (item.type === "hit") return Math.max(0, distance(item, target) - item.radius);
  if (item.type === "ring") {
    const normalized = Math.hypot(
      (target.x - item.x) / item.radiusX,
      (target.y - item.y) / item.radiusY,
    );
    return Math.abs(normalized - 1) * Math.min(item.radiusX * xScale, item.radiusY);
  }

  let nearest = Infinity;
  for (let index = 1; index < item.points.length; index += 1) {
    const start = item.points[index - 1];
    const end = item.points[index];
    const ax = start.x * xScale;
    const ay = start.y;
    const bx = end.x * xScale;
    const by = end.y;
    const px = target.x * xScale;
    const py = target.y;
    const dx = bx - ax;
    const dy = by - ay;
    const amount = clamp(((px - ax) * dx + (py - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
    nearest = Math.min(nearest, Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount)));
  }
  return nearest;
}

export function createPaintMachineDemo() {
  return [
    { id: "hit-1", type: "hit", layer: 0, x: .08, y: .12, radius: .016 },
    { id: "hit-2", type: "hit", layer: 0, x: .2, y: .2, radius: .013 },
    { id: "hit-3", type: "hit", layer: 1, x: .34, y: .37, radius: .016 },
    { id: "hit-4", type: "hit", layer: 2, x: .55, y: .62, radius: .014 },
    { id: "hit-5", type: "hit", layer: 1, x: .72, y: .46, radius: .018 },
    { id: "hit-6", type: "hit", layer: 2, x: .9, y: .82, radius: .012 },
    {
      id: "stroke-1", type: "stroke", layer: 0,
      points: [{ x: .02, y: .08 }, { x: .24, y: .28 }, { x: .48, y: .52 }],
    },
    { id: "ring-1", type: "ring", layer: 1, x: .7, y: .58, radiusX: .16, radiusY: .22 },
    {
      id: "mod-1", type: "stroke", layer: 3,
      points: [{ x: .04, y: .25 }, { x: .45, y: .8 }, { x: .96, y: .38 }],
    },
  ].map((item, index) => sanitizePaintItem(item, `demo-${index}`));
}
