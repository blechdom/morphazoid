import { marchingSquares, sampleExplicit, sampleParametric } from "./sampler.js";
import { stitchSegments } from "./readers.js";

export const DEFAULT_RANGE = Object.freeze([0, Math.PI * 2]);

export const IMPLICIT_CELL_PIXELS = 4;
export const MAX_IMPLICIT_CELLS = Object.freeze({ columns: 400, rows: 260 });
export const MAX_SAMPLES = 4000;
export const MIN_SAMPLES = 200;
export const POLAR_SAMPLES_PER_TURN = 480;
export const EXPLICIT_REFINEMENT = 12;

const clampCount = (value) => Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.ceil(value)));

function scopedFunction(fn, scope, variable) {
  const local = { ...scope };
  return (value) => { local[variable] = value; return fn(local); };
}

function swapPairs(segments) {
  return segments.map((segment) => {
    const swapped = new Float64Array(segment.length);
    for (let i = 0; i < segment.length; i += 2) { swapped[i] = segment[i + 1]; swapped[i + 1] = segment[i]; }
    return swapped;
  });
}

function splitFlatSegments(flat) {
  const segments = [];
  for (let i = 0; i + 3 < flat.length; i += 4) segments.push(Float64Array.of(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]));
  return stitchSegments(segments);
}

/**
 * Turn analyzed rows into world-space drawables for the current view. Everything here is
 * browser-free so the same geometry feeds the Canvas renderer, hover hit-testing, the trace
 * playhead and, later, sonification.
 */
export function buildGeometry(analysis, state, view, width, height) {
  const xSpan = view.xMax - view.xMin, ySpan = view.yMax - view.yMin;
  const items = [];
  state.rows.forEach((row, index) => {
    const info = analysis.rows[index];
    if (!info?.plot || !row.visible) return;
    const base = { id: row.id, index, color: row.color, kind: info.plot.type, label: info.label, voice: row.voice ?? null, segments: [], points: [], fills: [], strict: false, draggable: null };
    const { plot } = info;
    const scope = analysis.scope;
    try {
      if (plot.type === "explicit-y") {
        const fn = scopedFunction(plot.fn, scope, "x");
        const { segments } = sampleExplicit(fn, { from: view.xMin, to: view.xMax, count: clampCount(width), span: ySpan, maxRefinement: EXPLICIT_REFINEMENT });
        base.segments = segments;
        base.evaluate = fn;
      } else if (plot.type === "explicit-x") {
        const fn = scopedFunction(plot.fn, scope, "y");
        const { segments } = sampleExplicit(fn, { from: view.yMin, to: view.yMax, count: clampCount(height), span: xSpan, maxRefinement: EXPLICIT_REFINEMENT });
        base.segments = swapPairs(segments);
        base.evaluateX = fn;
      } else if (plot.type === "polar") {
        const [from, to] = row.range ?? DEFAULT_RANGE;
        const radius = scopedFunction(plot.fn, scope, "θ");
        const turns = Math.abs(to - from) / (Math.PI * 2);
        const count = clampCount(POLAR_SAMPLES_PER_TURN * Math.max(1, turns));
        const { segments } = sampleParametric(
          (theta) => radius(theta) * Math.cos(theta),
          (theta) => radius(theta) * Math.sin(theta),
          { from, to, count, span: Math.max(xSpan, ySpan) },
        );
        base.segments = segments;
      } else if (plot.type === "parametric") {
        const [from, to] = row.range ?? DEFAULT_RANGE;
        const fx = scopedFunction(plot.fx, scope, "t"), fy = scopedFunction(plot.fy, scope, "t");
        const { segments } = sampleParametric(fx, fy, { from, to, count: clampCount(width * 1.5), span: Math.max(xSpan, ySpan) });
        base.segments = segments;
      } else if (plot.type === "implicit") {
        const local = { ...scope };
        const F = (x, y) => { local.x = x; local.y = y; return plot.fn(local); };
        const flat = marchingSquares(F, {
          xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax,
          columns: Math.min(MAX_IMPLICIT_CELLS.columns, Math.max(8, Math.ceil(width / IMPLICIT_CELL_PIXELS))),
          rows: Math.min(MAX_IMPLICIT_CELLS.rows, Math.max(8, Math.ceil(height / IMPLICIT_CELL_PIXELS))),
        });
        base.segments = splitFlatSegments(flat);
      } else if (plot.type === "inequality") {
        const axis = plot.axis;
        const variable = axis === "y" ? "x" : "y";
        const fn = scopedFunction(plot.fn, scope, variable);
        const [from, to, count, span] = axis === "y" ? [view.xMin, view.xMax, clampCount(width), ySpan] : [view.yMin, view.yMax, clampCount(height), xSpan];
        const { segments } = sampleExplicit(fn, { from, to, count, span, maxRefinement: EXPLICIT_REFINEMENT });
        base.segments = axis === "y" ? segments : swapPairs(segments);
        base.strict = plot.strict;
        base.fills = inequalityFills(base.segments, axis, plot.direction, view);
        if (axis === "y") base.evaluate = fn;
      } else if (plot.type === "point") {
        const x = plot.fx(scope), y = plot.fy(scope);
        if (Number.isFinite(x) && Number.isFinite(y)) base.points = [[x, y]];
        base.draggable = plot.draggable;
      }
    } catch {
      base.segments = []; base.points = []; base.fills = [];
    }
    items.push(base);
  });
  return items;
}

function inequalityFills(segments, axis, direction, view) {
  const fills = [];
  const limitY = direction === "less" ? view.yMin - (view.yMax - view.yMin) : view.yMax + (view.yMax - view.yMin);
  const limitX = direction === "less" ? view.xMin - (view.xMax - view.xMin) : view.xMax + (view.xMax - view.xMin);
  for (const segment of segments) {
    if (segment.length < 4) continue;
    const polygon = new Float64Array(segment.length + 4);
    polygon.set(segment, 0);
    const lastX = segment[segment.length - 2], lastY = segment[segment.length - 1];
    if (axis === "y") {
      polygon[segment.length] = lastX; polygon[segment.length + 1] = limitY;
      polygon[segment.length + 2] = segment[0]; polygon[segment.length + 3] = limitY;
    } else {
      polygon[segment.length] = limitX; polygon[segment.length + 1] = lastY;
      polygon[segment.length + 2] = limitX; polygon[segment.length + 3] = segment[1];
    }
    fills.push(polygon);
  }
  return fills;
}

/** Every y where the vertical line at `x` meets each drawable, in drawing order. */
export function traceAt(geometry, x) {
  const hits = [];
  for (const item of geometry) {
    if (item.kind === "point") {
      for (const [px, py] of item.points) if (Math.abs(px - x) < 1e-9) hits.push({ id: item.id, color: item.color, label: item.label, ys: [py] });
      continue;
    }
    const ys = [];
    if (item.evaluate) {
      const y = item.evaluate(x);
      if (Number.isFinite(y)) ys.push(y);
    } else {
      for (const segment of item.segments) {
        for (let i = 0; i + 3 < segment.length; i += 2) {
          const x0 = segment[i], x1 = segment[i + 2];
          if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
            if (x1 === x0) { ys.push(segment[i + 1]); continue; }
            const t = (x - x0) / (x1 - x0);
            ys.push(segment[i + 1] + t * (segment[i + 3] - segment[i + 1]));
          }
        }
      }
    }
    const unique = dedupe(ys);
    if (unique.length) hits.push({ id: item.id, color: item.color, label: item.label, ys: unique });
  }
  return hits;
}

function dedupe(values, tolerance = 1e-6) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > tolerance);
}

export const verticalProbe = (x, view) => ({ x0: x, y0: view.yMin, dx: 0, dy: 1, length: view.yMax - view.yMin });
export const horizontalProbe = (y, view) => ({ x0: view.xMin, y0: y, dx: 1, dy: 0, length: view.xMax - view.xMin });
export const rayProbe = (cx, cy, angle, length) => ({ x0: cx, y0: cy, dx: Math.cos(angle), dy: Math.sin(angle), length });

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

/**
 * Where a probe line segment (origin, unit direction, length) meets each drawable. Hits carry the
 * distance `s` along the probe and the world point; explicit curves use their closures exactly.
 */
export function probeHits(geometry, probe) {
  const { x0, y0, dx, dy, length } = probe;
  if (![x0, y0, dx, dy, length].every(Number.isFinite) || length <= 0) return [];
  const results = [];
  for (const item of geometry) {
    const hits = [];
    const push = (s, x, y) => { if (Number.isFinite(s) && s >= -1e-9 && s <= length + 1e-9) hits.push({ s: Math.min(length, Math.max(0, s)), x, y }); };
    if (item.kind === "point") {
      for (const [px, py] of item.points) {
        const s = (px - x0) * dx + (py - y0) * dy;
        const offset = Math.abs(cross(dx, dy, px - x0, py - y0));
        if (offset <= 1e-9 * Math.max(1, length)) push(s, px, py);
      }
    } else if (dx === 0 && item.evaluate) {
      const y = item.evaluate(x0);
      if (Number.isFinite(y)) push((y - y0) / dy, x0, y);
    } else if (dy === 0 && item.evaluateX) {
      const x = item.evaluateX(y0);
      if (Number.isFinite(x)) push((x - x0) / dx, x, y0);
    } else {
      for (const segment of item.segments) {
        for (let i = 0; i + 3 < segment.length; i += 2) {
          const ax = segment[i], ay = segment[i + 1], ex = segment[i + 2] - ax, ey = segment[i + 3] - ay;
          const denominator = cross(dx, dy, ex, ey);
          if (Math.abs(denominator) < 1e-12) continue;
          const wx = ax - x0, wy = ay - y0;
          const u = cross(wx, wy, dx, dy) / denominator;
          if (u < -1e-9 || u > 1 + 1e-9) continue;
          const s = cross(wx, wy, ex, ey) / denominator;
          push(s, ax + u * ex, ay + u * ey);
        }
      }
    }
    hits.sort((a, b) => a.s - b.s);
    const unique = hits.filter((hit, index) => index === 0 || hit.s - hits[index - 1].s > 1e-3 * length);
    if (unique.length) results.push({ id: item.id, color: item.color, label: item.label, kind: item.kind, voice: item.voice ?? null, hits: unique });
  }
  return results;
}

/** Uniform resampling of one drawable across [xMin, xMax]: the array a future sonifier reads. */
export function resampleColumns(item, xMin, xMax, count) {
  const values = new Float64Array(Math.max(1, count)).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const x = xMin + ((xMax - xMin) * i) / Math.max(1, values.length - 1);
    const hit = traceAt([item], x)[0];
    if (hit) values[i] = hit.ys[0];
  }
  return values;
}

/** Nearest drawn point to a pixel position, searching curve vertices and points within `radius` pixels. */
export function nearestPoint(geometry, camera, px, py, radius = 14) {
  let best = null;
  const consider = (item, x, y) => {
    const [sx, sy] = camera.toPixel(x, y);
    const distance = Math.hypot(sx - px, sy - py);
    if (distance <= radius && (!best || distance < best.distance)) best = { id: item.id, color: item.color, label: item.label, x, y, distance, draggable: item.draggable };
  };
  for (const item of geometry) {
    for (const [x, y] of item.points) consider(item, x, y);
    for (const segment of item.segments) {
      for (let i = 0; i + 1 < segment.length; i += 2) consider(item, segment[i], segment[i + 1]);
    }
  }
  return best;
}
