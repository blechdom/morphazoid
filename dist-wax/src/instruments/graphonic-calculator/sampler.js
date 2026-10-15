const DEFAULT_COUNT = 800;
const DEFAULT_REFINEMENT = 8;
const DEFAULT_COLUMNS = 160;
const DEFAULT_ROWS = 100;
const MAX_COUNT = 1 << 20;
const MAX_REFINEMENT = 32;
const MAX_GRID_CELLS = 1024;
const JUMP_DIVISOR = 60;
const VALUE_LIMIT_FACTOR = 1e6;
const CONTINUOUS_SHRINK = 4;
const SHRINK_BISECTIONS = 3;
const CONFIRMATION_BISECTIONS = 2;
const CONFIRMATION_SPANS = 4;

const emptyResult = () => ({ segments: [], defined: 0 });

function clampInteger(value, fallback, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 0), max);
}

function positiveOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeValue(fn, t) {
  try {
    const value = fn(t);
    return typeof value === "number" ? value : NaN;
  } catch {
    return NaN;
  }
}

function safeField(fn, x, y) {
  try {
    const value = fn(x, y);
    return typeof value === "number" ? value : NaN;
  } catch {
    return NaN;
  }
}

const isFinitePair = (a, b) => Number.isFinite(a) && Number.isFinite(b);
const parameterAt = (from, to, index, count) => (index === count ? to : from + (to - from) * (index / count));

function jumpBetween(planar, xA, yA, xB, yB) {
  const dy = yB - yA;
  if (!planar) return Math.abs(dy);
  const dx = xB - xA;
  return Math.sqrt(dx * dx + dy * dy);
}

class GrowableBuffer {
  constructor(capacity) {
    this.data = new Float64Array(Math.max(16, capacity));
    this.length = 0;
  }

  push(a, b) {
    if (this.length + 2 > this.data.length) {
      const grown = new Float64Array(this.data.length * 2);
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }

  toFloat64Array() {
    return this.data.slice(0, this.length);
  }
}

class PolylineBuilder {
  constructor(capacity) {
    this.buffer = new GrowableBuffer(capacity);
    this.segments = [];
  }

  get isOpen() { return this.buffer.length > 0; }

  push(x, y) { this.buffer.push(x, y); }

  close() {
    if (this.buffer.length >= 4) this.segments.push(this.buffer.toFloat64Array());
    this.buffer.length = 0;
  }
}

class IntervalRefiner {
  constructor(sample, planar, threshold, limit, maxRefinement, extent) {
    this.sample = sample;
    this.planar = planar;
    this.threshold = threshold;
    this.limit = limit;
    this.extent = extent;
    this.maxRefinement = maxRefinement;
    const capacity = maxRefinement + 4 + 2 * CONFIRMATION_BISECTIONS;
    this.ts = new Float64Array(capacity);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.size = 0;
    this.largestJump = 0;
    this.point = new Float64Array(2);
    this.edge = new Float64Array(3);
  }

  insert(index, t, x, y) {
    const { ts, xs, ys } = this;
    for (let s = this.size; s > index; s--) {
      ts[s] = ts[s - 1];
      xs[s] = xs[s - 1];
      ys[s] = ys[s - 1];
    }
    ts[index] = t;
    xs[index] = x;
    ys[index] = y;
    this.size++;
  }

  largestJumpIndex() {
    const { xs, ys, planar } = this;
    let best = 0;
    let largest = -1;
    for (let s = 0; s < this.size - 1; s++) {
      const jump = jumpBetween(planar, xs[s], ys[s], xs[s + 1], ys[s + 1]);
      if (jump > largest) {
        largest = jump;
        best = s;
      }
    }
    this.largestJump = largest;
    return best;
  }

  // Excursion is measured from the finite reference point, so far-off views keep their domain edges.
  approach(tFinite, xFinite, yFinite, tOther) {
    const { point, edge } = this;
    let low = tFinite;
    let high = tOther;
    let moved = false;
    for (let k = 0; k < this.maxRefinement; k++) {
      const mid = (low + high) / 2;
      if (mid === low || mid === high) break;
      this.sample(mid, point);
      if (isFinitePair(point[0], point[1]) && jumpBetween(this.planar, xFinite, yFinite, point[0], point[1]) <= this.limit) {
        low = mid;
        edge[0] = mid;
        edge[1] = point[0];
        edge[2] = point[1];
        moved = true;
      } else {
        high = mid;
      }
    }
    return moved;
  }

  splitAroundHole(index, hole) {
    const { edge } = this;
    let left = index;
    if (this.approach(this.ts[left], this.xs[left], this.ys[left], hole)) {
      this.insert(left + 1, edge[0], edge[1], edge[2]);
      left++;
    }
    if (this.approach(this.ts[left + 1], this.xs[left + 1], this.ys[left + 1], hole)) this.insert(left + 1, edge[0], edge[1], edge[2]);
    return left;
  }

  // One-sided differences over the same width bound the local slope; what is left over is a step.
  residual(s) {
    const { ts, xs, ys, planar, point } = this;
    const width = ts[s + 1] - ts[s];
    const jump = jumpBetween(planar, xs[s], ys[s], xs[s + 1], ys[s + 1]);
    let slope = Infinity;
    this.sample(ts[s] - width, point);
    if (isFinitePair(point[0], point[1])) slope = Math.min(slope, jumpBetween(planar, point[0], point[1], xs[s], ys[s]));
    this.sample(ts[s + 1] + width, point);
    if (isFinitePair(point[0], point[1])) slope = Math.min(slope, jumpBetween(planar, xs[s + 1], ys[s + 1], point[0], point[1]));
    return jump - (Number.isFinite(slope) ? slope : 0);
  }

  // A shrinking jump may only mean a shrinking sub-interval: a step hidden on a steep ramp keeps its
  // height under bisection while curvature's residual falls about fourfold, so confirm before connecting.
  confirmContinuity() {
    const { ts, xs, ys, planar, point } = this;
    let worst = -1;
    let residual = this.threshold;
    for (let s = 0; s < this.size - 1; s++) {
      if (jumpBetween(planar, xs[s], ys[s], xs[s + 1], ys[s + 1]) <= this.threshold) continue;
      const candidate = this.residual(s);
      if (candidate > residual) { residual = candidate; worst = s; }
    }
    if (worst < 0) return -1;
    for (let round = 0; round < CONFIRMATION_BISECTIONS; round++) {
      const mid = (ts[worst] + ts[worst + 1]) / 2;
      if (mid === ts[worst] || mid === ts[worst + 1]) return worst;
      this.sample(mid, point);
      if (!isFinitePair(point[0], point[1])) return this.splitAroundHole(worst, mid);
      this.insert(worst + 1, mid, point[0], point[1]);
      const left = this.residual(worst);
      const right = this.residual(worst + 1);
      if (right > left) worst++;
      const next = Math.max(left, right);
      if (next <= this.threshold || next * (CONTINUOUS_SHRINK - 1) <= residual) return -1;
      residual = next;
    }
    return worst;
  }

  refine(builder, tA, xA, yA, tB, xB, yB) {
    const { ts, xs, ys, point } = this;
    ts[0] = tA; xs[0] = xA; ys[0] = yA;
    ts[1] = tB; xs[1] = xB; ys[1] = yB;
    this.size = 2;
    const originalJump = jumpBetween(this.planar, xA, yA, xB, yB);
    let splitAt = this.maxRefinement === 0 ? 0 : -1;
    let widest = 0;
    for (let k = 1; k <= this.maxRefinement; k++) {
      const left = ts[widest];
      const right = ts[widest + 1];
      const mid = (left + right) / 2;
      if (mid === left || mid === right) { splitAt = widest; break; }
      this.sample(mid, point);
      const x = point[0];
      const y = point[1];
      if (!isFinitePair(x, y)) { splitAt = this.splitAroundHole(widest, mid); break; }
      if (jumpBetween(this.planar, xA, yA, x, y) > this.limit && jumpBetween(this.planar, xB, yB, x, y) > this.limit) { splitAt = widest; break; }
      this.insert(widest + 1, mid, x, y);
      widest = this.largestJumpIndex();
      const largest = this.largestJump;
      if (largest <= this.threshold) { splitAt = -1; break; }
      if (k >= SHRINK_BISECTIONS && largest * CONTINUOUS_SHRINK <= originalJump) {
        // A wall taller than several views is off-screen anyway; hidden steps only matter at view scale.
        splitAt = originalJump <= CONFIRMATION_SPANS * this.extent ? this.confirmContinuity() : -1;
        break;
      }
      splitAt = widest;
    }
    for (let s = 1; s < this.size; s++) {
      if (s === splitAt + 1) builder.close();
      builder.push(xs[s], ys[s]);
    }
  }
}

function resolveSampling(options) {
  const { from, to, count = DEFAULT_COUNT, span = 1, maxRefinement = DEFAULT_REFINEMENT, jumpThreshold } = options ?? {};
  if (!isFinitePair(from, to) || from === to || !Number.isFinite(to - from)) return null;
  const intervals = clampInteger(count, DEFAULT_COUNT, MAX_COUNT);
  if (intervals < 1) return null;
  const extent = positiveOr(span, 1);
  return {
    from,
    to,
    count: intervals,
    threshold: positiveOr(jumpThreshold, extent / JUMP_DIVISOR),
    extent,
    limit: extent * VALUE_LIMIT_FACTOR,
    maxRefinement: clampInteger(maxRefinement, DEFAULT_REFINEMENT, MAX_REFINEMENT),
  };
}

function sampleCurve(sample, planar, options) {
  const resolved = resolveSampling(options);
  if (!resolved) return emptyResult();
  const { from, to, count, threshold, extent, limit, maxRefinement } = resolved;
  const xs = new Float64Array(count + 1);
  const ys = new Float64Array(count + 1);
  const refiner = new IntervalRefiner(sample, planar, threshold, limit, maxRefinement, extent);
  const { point, edge } = refiner;
  let defined = 0;
  for (let i = 0; i <= count; i++) {
    sample(parameterAt(from, to, i, count), point);
    xs[i] = point[0];
    ys[i] = point[1];
    if (isFinitePair(point[0], point[1])) defined++;
  }
  if (defined === 0) return emptyResult();
  const builder = new PolylineBuilder(2 * (count + 1) + 2 * maxRefinement);
  for (let i = 0; i < count; i++) {
    const finiteA = isFinitePair(xs[i], ys[i]);
    const finiteB = isFinitePair(xs[i + 1], ys[i + 1]);
    if (!finiteA && !finiteB) continue;
    const tA = parameterAt(from, to, i, count);
    const tB = parameterAt(from, to, i + 1, count);
    if (finiteA && finiteB) {
      if (!builder.isOpen) builder.push(xs[i], ys[i]);
      if (jumpBetween(planar, xs[i], ys[i], xs[i + 1], ys[i + 1]) > threshold) {
        refiner.refine(builder, tA, xs[i], ys[i], tB, xs[i + 1], ys[i + 1]);
      } else {
        builder.push(xs[i + 1], ys[i + 1]);
      }
    } else if (finiteA) {
      if (!builder.isOpen) builder.push(xs[i], ys[i]);
      if (refiner.approach(tA, xs[i], ys[i], tB)) builder.push(edge[1], edge[2]);
      builder.close();
    } else {
      builder.close();
      if (refiner.approach(tB, xs[i + 1], ys[i + 1], tA)) builder.push(edge[1], edge[2]);
      builder.push(xs[i + 1], ys[i + 1]);
    }
  }
  builder.close();
  return { segments: builder.segments, defined };
}

export function sampleExplicit(fn, options) {
  if (typeof fn !== "function") return emptyResult();
  const sample = (t, out) => {
    out[0] = t;
    out[1] = safeValue(fn, t);
  };
  return sampleCurve(sample, false, options);
}

export function sampleParametric(fx, fy, options) {
  if (typeof fx !== "function" || typeof fy !== "function") return emptyResult();
  const sample = (t, out) => {
    out[0] = safeValue(fx, t);
    out[1] = safeValue(fy, t);
  };
  return sampleCurve(sample, true, options);
}

const BOTTOM_LEFT = 1;
const BOTTOM_RIGHT = 2;
const TOP_RIGHT = 4;
const TOP_LEFT = 8;
const ALL_CORNERS = BOTTOM_LEFT | BOTTOM_RIGHT | TOP_RIGHT | TOP_LEFT;
const SADDLE_RISING = BOTTOM_LEFT | TOP_RIGHT;
const SADDLE_FALLING = BOTTOM_RIGHT | TOP_LEFT;

const EDGE_BOTTOM = 0;
const EDGE_RIGHT = 1;
const EDGE_TOP = 2;
const EDGE_LEFT = 3;

const CASE_EDGES = [];
CASE_EDGES[BOTTOM_LEFT] = [EDGE_LEFT, EDGE_BOTTOM];
CASE_EDGES[BOTTOM_RIGHT] = [EDGE_BOTTOM, EDGE_RIGHT];
CASE_EDGES[BOTTOM_LEFT | BOTTOM_RIGHT] = [EDGE_LEFT, EDGE_RIGHT];
CASE_EDGES[TOP_RIGHT] = [EDGE_RIGHT, EDGE_TOP];
CASE_EDGES[BOTTOM_RIGHT | TOP_RIGHT] = [EDGE_BOTTOM, EDGE_TOP];
CASE_EDGES[BOTTOM_LEFT | BOTTOM_RIGHT | TOP_RIGHT] = [EDGE_LEFT, EDGE_TOP];
CASE_EDGES[TOP_LEFT] = [EDGE_TOP, EDGE_LEFT];
CASE_EDGES[BOTTOM_LEFT | TOP_LEFT] = [EDGE_BOTTOM, EDGE_TOP];
CASE_EDGES[BOTTOM_LEFT | BOTTOM_RIGHT | TOP_LEFT] = [EDGE_RIGHT, EDGE_TOP];
CASE_EDGES[TOP_RIGHT | TOP_LEFT] = [EDGE_RIGHT, EDGE_LEFT];
CASE_EDGES[BOTTOM_LEFT | TOP_RIGHT | TOP_LEFT] = [EDGE_BOTTOM, EDGE_RIGHT];
CASE_EDGES[BOTTOM_RIGHT | TOP_RIGHT | TOP_LEFT] = [EDGE_LEFT, EDGE_BOTTOM];

function pushCrossing(buffer, edge, cell) {
  const x0 = cell[0], x1 = cell[1], y0 = cell[2], y1 = cell[3];
  const v0 = cell[4], v1 = cell[5], v2 = cell[6], v3 = cell[7];
  switch (edge) {
    case EDGE_BOTTOM: buffer.push(x0 + (x1 - x0) * (v0 / (v0 - v1)), y0); return;
    case EDGE_RIGHT: buffer.push(x1, y0 + (y1 - y0) * (v1 / (v1 - v2))); return;
    case EDGE_TOP: buffer.push(x0 + (x1 - x0) * (v3 / (v3 - v2)), y1); return;
    default: buffer.push(x0, y0 + (y1 - y0) * (v0 / (v0 - v3)));
  }
}

function pushSegment(buffer, edgeA, edgeB, cell) {
  pushCrossing(buffer, edgeA, cell);
  pushCrossing(buffer, edgeB, cell);
}

export function marchingSquares(F, options) {
  const { xMin, xMax, yMin, yMax, columns = DEFAULT_COLUMNS, rows = DEFAULT_ROWS } = options ?? {};
  if (typeof F !== "function" || !isFinitePair(xMin, xMax) || !isFinitePair(yMin, yMax)) return new Float64Array(0);
  if (xMin === xMax || yMin === yMax || !isFinitePair(xMax - xMin, yMax - yMin)) return new Float64Array(0);
  const cols = clampInteger(columns, DEFAULT_COLUMNS, MAX_GRID_CELLS);
  const rws = clampInteger(rows, DEFAULT_ROWS, MAX_GRID_CELLS);
  if (cols < 1 || rws < 1) return new Float64Array(0);
  const xs = new Float64Array(cols + 1);
  const ys = new Float64Array(rws + 1);
  for (let i = 0; i <= cols; i++) xs[i] = parameterAt(xMin, xMax, i, cols);
  for (let j = 0; j <= rws; j++) ys[j] = parameterAt(yMin, yMax, j, rws);
  const stride = cols + 1;
  const values = new Float64Array(stride * (rws + 1));
  for (let j = 0; j <= rws; j++) {
    for (let i = 0; i <= cols; i++) values[j * stride + i] = safeField(F, xs[i], ys[j]);
  }
  const buffer = new GrowableBuffer(8 * (cols + rws));
  const cell = new Float64Array(8);
  for (let j = 0; j < rws; j++) {
    for (let i = 0; i < cols; i++) {
      const base = j * stride + i;
      const v0 = values[base];
      const v1 = values[base + 1];
      const v2 = values[base + stride + 1];
      const v3 = values[base + stride];
      if (!isFinitePair(v0, v1) || !isFinitePair(v2, v3)) continue;
      const index = (v0 < 0 ? BOTTOM_LEFT : 0) | (v1 < 0 ? BOTTOM_RIGHT : 0) | (v2 < 0 ? TOP_RIGHT : 0) | (v3 < 0 ? TOP_LEFT : 0);
      if (index === 0 || index === ALL_CORNERS) continue;
      cell[0] = xs[i]; cell[1] = xs[i + 1]; cell[2] = ys[j]; cell[3] = ys[j + 1];
      cell[4] = v0; cell[5] = v1; cell[6] = v2; cell[7] = v3;
      if (index === SADDLE_RISING || index === SADDLE_FALLING) {
        let center = safeField(F, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
        if (!Number.isFinite(center)) center = (v0 + v1 + v2 + v3) / 4;
        if ((index === SADDLE_RISING) === (center < 0)) {
          pushSegment(buffer, EDGE_BOTTOM, EDGE_RIGHT, cell);
          pushSegment(buffer, EDGE_TOP, EDGE_LEFT, cell);
        } else {
          pushSegment(buffer, EDGE_LEFT, EDGE_BOTTOM, cell);
          pushSegment(buffer, EDGE_RIGHT, EDGE_TOP, cell);
        }
        continue;
      }
      const edges = CASE_EDGES[index];
      pushSegment(buffer, edges[0], edges[1], cell);
    }
  }
  return buffer.toFloat64Array();
}

export function polylineLength(segment) {
  if (!segment || typeof segment.length !== "number") return 0;
  let total = 0;
  for (let i = 2; i + 1 < segment.length; i += 2) {
    const dx = segment[i] - segment[i - 2];
    const dy = segment[i + 1] - segment[i - 1];
    const hop = Math.sqrt(dx * dx + dy * dy);
    if (Number.isFinite(hop)) total += hop;
  }
  return total;
}
