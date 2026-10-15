import { canonicalHeadOffsets, sanitizeHeadOffsets } from "../../playheads.js";
import { pingPong01, wrap01 } from "../../geometry.js";
import { horizontalProbe, probeHits, rayProbe, verticalProbe } from "./geometry.js";

const TAU = Math.PI * 2;

export const PLAYBACK_MODES = Object.freeze(["points", "line", "radar"]);
export const MOTION_MODES = Object.freeze(["loop", "pingpong"]);
export const LINE_AXES = Object.freeze(["vertical", "horizontal"]);
export const PITCH_SOURCES = Object.freeze(["height", "width", "radius"]);
export const MAX_HEADS = 12;

/** Join two-point marching-squares pieces that share endpoints into ordered polylines. */
export function stitchSegments(segments) {
  const pieces = segments.filter((segment) => segment.length >= 4);
  if (!pieces.length) return [];
  let extent = 0;
  for (const piece of pieces) for (const value of piece) if (Number.isFinite(value)) extent = Math.max(extent, Math.abs(value));
  const quantum = Math.max(extent, 1) * 1e-9;
  const key = (x, y) => `${Math.round(x / quantum)},${Math.round(y / quantum)}`;
  const ends = new Map();
  const register = (index, end) => {
    const piece = pieces[index];
    const k = end === 0 ? key(piece[0], piece[1]) : key(piece[piece.length - 2], piece[piece.length - 1]);
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push([index, end]);
  };
  pieces.forEach((_, index) => { register(index, 0); register(index, 1); });
  const used = new Uint8Array(pieces.length);
  const polylines = [];
  // Points of the next unused piece touching (x, y), ordered away from that shared vertex.
  const takeNeighbour = (x, y) => {
    for (const [index, end] of ends.get(key(x, y)) ?? []) {
      if (used[index]) continue;
      used[index] = 1;
      const piece = pieces[index];
      const points = [];
      if (end === 0) for (let i = 2; i < piece.length; i += 2) points.push(piece[i], piece[i + 1]);
      else for (let i = piece.length - 4; i >= 0; i -= 2) points.push(piece[i], piece[i + 1]);
      return points;
    }
    return null;
  };
  for (let start = 0; start < pieces.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const chain = Array.from(pieces[start]);
    const origin = key(chain[0], chain[1]);
    for (;;) {
      const tail = takeNeighbour(chain[chain.length - 2], chain[chain.length - 1]);
      if (!tail) break;
      chain.push(...tail);
      if (key(chain[chain.length - 2], chain[chain.length - 1]) === origin) break;
    }
    if (key(chain[chain.length - 2], chain[chain.length - 1]) !== origin) {
      for (;;) {
        const head = takeNeighbour(chain[0], chain[1]);
        if (!head) break;
        const reversed = [];
        for (let i = head.length - 2; i >= 0; i -= 2) reversed.push(head[i], head[i + 1]);
        chain.unshift(...reversed);
      }
    }
    polylines.push(Float64Array.from(chain));
  }
  return polylines;
}

/** Cumulative arclength over every polyline of a drawable, cached on the item. */
export function arclength(item) {
  if (item.arclength) return item.arclength;
  const runs = [];
  let total = 0;
  for (const segment of item.segments) {
    const count = segment.length / 2;
    if (count < 2) continue;
    const lengths = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      const dx = segment[2 * i] - segment[2 * i - 2], dy = segment[2 * i + 1] - segment[2 * i - 1];
      const step = Math.hypot(dx, dy);
      lengths[i] = lengths[i - 1] + (Number.isFinite(step) ? step : 0);
    }
    const length = lengths[count - 1];
    if (length > 0) { runs.push({ segment, lengths, start: total, end: total + length }); total += length; }
  }
  item.arclength = { total, runs };
  return item.arclength;
}

/** World point a fraction `phase` of the way along a drawable's total arclength, or null. */
export function pointAlong(item, phase) {
  const { total, runs } = arclength(item);
  if (!runs.length || !(total > 0)) return null;
  const distance = Math.min(total, Math.max(0, phase * total));
  let run = runs[runs.length - 1];
  for (const candidate of runs) if (distance <= candidate.end) { run = candidate; break; }
  const local = distance - run.start;
  const { segment, lengths } = run;
  let low = 0, high = lengths.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (lengths[mid] <= local) low = mid; else high = mid;
  }
  const span = lengths[high] - lengths[low];
  const t = span > 0 ? (local - lengths[low]) / span : 0;
  return {
    x: segment[2 * low] + t * (segment[2 * high] - segment[2 * low]),
    y: segment[2 * low + 1] + t * (segment[2 * high + 1] - segment[2 * low + 1]),
    run: runs.indexOf(run),
  };
}

export function headOffsets(settings) {
  return Array.isArray(settings.headOffsets) ? sanitizeHeadOffsets(settings.headOffsets, settings.heads, "parallel") : canonicalHeadOffsets(settings.heads, "parallel");
}

export const crossedAxes = (count) => Array.from({ length: count }, (_, head) => (head % 2 ? "horizontal" : "vertical"));

export const headPhase = (travel, offset, motion) => (motion === "pingpong" ? pingPong01(travel + offset) : wrap01(travel + offset));

export function lineAxisForHead(settings, head) {
  return settings.headAxes?.[head] === "horizontal" ? "horizontal" : "vertical";
}

/** Per-head reversal applies to Points and Radar, as in Shape; scan lines share the global direction. */
export function headDirection(settings, head) {
  if (settings.playback === "line") return 1;
  return settings.headDirections?.[head] < 0 ? -1 : 1;
}

/** World point a fraction `phase` along one connected branch (run) of a drawable, or null. */
export function pointAlongRun(item, runIndex, phase) {
  const { runs } = arclength(item);
  const run = runs[runIndex];
  if (!run) return null;
  const { segment, lengths } = run;
  const local = Math.min(1, Math.max(0, phase)) * lengths[lengths.length - 1];
  let low = 0, high = lengths.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (lengths[mid] <= local) low = mid; else high = mid;
  }
  const span = lengths[high] - lengths[low];
  const t = span > 0 ? (local - lengths[low]) / span : 0;
  return { x: segment[2 * low] + t * (segment[2 * high] - segment[2 * low]), y: segment[2 * low + 1] + t * (segment[2 * high + 1] - segment[2 * low + 1]) };
}

/** Radar rays turn about the origin when it is on screen, otherwise about the view centre. */
export function radarCenter(view) {
  const inside = view.xMin <= 0 && view.xMax >= 0 && view.yMin <= 0 && view.yMax >= 0;
  return inside ? { x: 0, y: 0 } : { x: (view.xMin + view.xMax) / 2, y: (view.yMin + view.yMax) / 2 };
}

export function radarReach(view, center) {
  return Math.max(...[[view.xMin, view.yMin], [view.xMax, view.yMin], [view.xMin, view.yMax], [view.xMax, view.yMax]].map(([x, y]) => Math.hypot(x - center.x, y - center.y)));
}

/** The moving reader for one head: a scan line, a radar ray, or the shared point phase. */
export function headGuide(settings, view, head, phase) {
  if (settings.playback === "line") {
    const axis = lineAxisForHead(settings, head);
    if (axis === "horizontal") {
      const y = view.yMax - phase * (view.yMax - view.yMin);
      return { kind: "line", axis, coordinate: y, probe: horizontalProbe(y, view) };
    }
    const x = view.xMin + phase * (view.xMax - view.xMin);
    return { kind: "line", axis: "vertical", coordinate: x, probe: verticalProbe(x, view) };
  }
  if (settings.playback === "radar") {
    const center = radarCenter(view);
    const angle = Math.PI / 2 - phase * TAU;
    return { kind: "ray", center, angle, probe: rayProbe(center.x, center.y, angle, radarReach(view, center)) };
  }
  return { kind: "points" };
}

/**
 * Everything the renderer and the sonifier read for one instant: each head's guide and the
 * contacts where that guide meets the visible drawables, in drawing order.
 */
export function collectContacts(geometry, settings, view, travel) {
  const offsets = headOffsets(settings);
  const heads = offsets.map((offset, index) => {
    const phase = headPhase(headDirection(settings, index) * travel, offset, settings.motion);
    return { index, phase, guide: headGuide(settings, view, index, phase) };
  });
  const contacts = [];
  for (const head of heads) {
    if (head.guide.kind === "points") {
      for (const item of geometry) {
        if (item.kind === "point" || !item.segments.length) continue;
        const { runs } = arclength(item);
        runs.forEach((run, runIndex) => {
          const point = pointAlongRun(item, runIndex, head.phase);
          if (point) contacts.push({ id: item.id, color: item.color, label: item.label, head: head.index, branch: runIndex, x: point.x, y: point.y, s: head.phase });
        });
      }
      continue;
    }
    for (const entry of probeHits(geometry, head.guide.probe)) {
      if (entry.kind === "point") continue;
      for (const hit of entry.hits) contacts.push({ id: entry.id, color: entry.color, label: entry.label, head: head.index, x: hit.x, y: hit.y, s: hit.s });
    }
  }
  return { heads, contacts };
}

/** 0..1 value a contact feeds into pitch, from the selected source, measured over the view. */
export function pitchValue(contact, source, view) {
  if (source === "width") return (contact.x - view.xMin) / (view.xMax - view.xMin);
  if (source === "radius") {
    const reach = Math.max(...[[view.xMin, view.yMin], [view.xMax, view.yMin], [view.xMin, view.yMax], [view.xMax, view.yMax]].map(([x, y]) => Math.hypot(x, y)));
    return reach > 0 ? Math.hypot(contact.x, contact.y) / reach : 0;
  }
  return (contact.y - view.yMin) / (view.yMax - view.yMin);
}
