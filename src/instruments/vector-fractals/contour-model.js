// Mandelbrot equipotentials, sampled in parameter space. Geometry is returned
// relative to the view center in view-width units, so Float32 GPU buffers retain
// detail even when the absolute complex coordinates are very close together.
const LN2 = Math.LN2;
const ESCAPE_RADIUS = 64;
const ESCAPE_SQUARED = ESCAPE_RADIUS * ESCAPE_RADIUS;
const MAX_CELLS = 240_000;
const DEFAULT_VIEW = { x: -0.5, y: 0, width: 3.4, aspect: 1.4 };
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function sanitizeContourView(view = {}) {
  view = view && typeof view === "object" ? view : {};
  return {
    x: clamp(finite(view.x, DEFAULT_VIEW.x), -4, 4),
    y: clamp(finite(view.y, DEFAULT_VIEW.y), -4, 4),
    width: clamp(finite(view.width, DEFAULT_VIEW.width), 1e-10, 8),
    aspect: clamp(finite(view.aspect, DEFAULT_VIEW.aspect), 0.2, 5),
  };
}

export function contourDepthForView(view, bias = 0) {
  const { width } = sanitizeContourView(view);
  return clamp(12 + 12 * Math.log2(3.4 / width) + finite(bias, 0), 4, 320);
}

export function sanitizeContourRequest(request = {}) {
  request = request && typeof request === "object" ? request : {};
  const view = sanitizeContourView(request.view);
  return {
    id: request.id,
    view,
    depth: clamp(finite(request.depth, contourDepthForView(view)), 0.5, 320),
    resolution: Math.round(clamp(finite(request.resolution, 360), 24, 900)),
  };
}

function evaluatePotential(cr, ci, maxIterations, counters) {
  if (counters) counters.evaluations += 1;
  // These two analytically known interiors avoid spending the iteration budget
  // in the main cardioid and period-two bulb. Other nonescaping samples are only
  // classified below the requested positive equipotential, not proved interior.
  const ci2 = ci * ci;
  const shifted = cr - 0.25;
  const q = shifted * shifted + ci2;
  if (Math.abs(cr) <= 2 && Math.abs(ci) <= 2
      && (q * (q + shifted) <= 0.25 * ci2
      || (cr + 1) * (cr + 1) + ci2 <= 0.0625)) return -Infinity;
  let zr = cr;
  let zi = ci;
  let n = 0;
  let norm = zr * zr + zi * zi;
  while (norm < ESCAPE_SQUARED && n < maxIterations) {
    const nextR = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci;
    zr = nextR;
    n += 1;
    norm = zr * zr + zi * zi;
  }
  if (norm < ESCAPE_SQUARED) {
    if (counters) counters.iterations += n;
    return -Infinity;
  }
  // Two more squarings make the escape-radius approximation negligible. The
  // guard also allows the exported helper to accept very large finite c.
  for (let extra = 0; extra < 2 && norm < 1e150; extra += 1) {
    const nextR = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci;
    zr = nextR;
    n += 1;
    norm = zr * zr + zi * zi;
  }
  if (counters) counters.iterations += n;
  // z_0 = c; G_M(c) = lim 2^-n log|z_n|. Do not shift n by one.
  const magnitude = Math.hypot(zr, zi);
  const scale = Math.max(Math.abs(zr), Math.abs(zi));
  const logMagnitude = Number.isFinite(magnitude) ? Math.log(magnitude)
    : Math.log(scale) + Math.log(Math.hypot(zr / scale, zi / scale));
  return Math.log(logMagnitude) - n * LN2;
}

/** log(G_M(c)); -Infinity means analytic interior or not escaped within cap. */
export function logGreenPotential(cr, ci = 0, maxIterations = 512) {
  if (!Number.isFinite(cr) || !Number.isFinite(ci)) return NaN;
  return evaluatePotential(cr, ci, Math.round(clamp(finite(maxIterations, 512), 1, 4096)));
}

function gridFor({ view, resolution }) {
  let columns = resolution;
  let rows = Math.max(16, Math.round(columns / view.aspect));
  // Keep the real-axis antenna on a sample row for centered views. Otherwise
  // an odd/even row change can remove its extremely thin connecting corridor.
  if (view.y === 0 && rows % 2) rows -= 1;
  const requestedRows = rows;
  if (rows > 700) {
    columns = Math.max(24, Math.round(columns * 700 / rows));
    rows = 700;
  }
  if (columns * rows > MAX_CELLS) {
    const scale = Math.sqrt(MAX_CELLS / (columns * rows));
    columns = Math.max(24, Math.floor(columns * scale));
    rows = Math.max(16, Math.floor(rows * scale));
  }
  if (view.y === 0 && rows % 2) rows -= 1;
  return { columns, rows, limited: columns !== resolution || rows !== requestedRows };
}

// One resumable job serves both the pure synchronous API and the Worker. Yield
// within every expensive phase, including graph tracing and final packing.
function* contourJob(input) {
  const startTime = clock();
  const { view, depth, resolution } = sanitizeContourRequest(input);
  const { columns, rows, limited } = gridFor({ view, resolution });
  const stride = columns + 1;
  const target = -depth;
  const counters = { evaluations: 0, iterations: 0 };
  const boundC = Math.hypot(Math.abs(view.x) + view.width / 2,
    Math.abs(view.y) + view.width / (2 * view.aspect));
  // If |z_N| <= R, G(c) <= 2^-N log(R + |c|/R). Thus a sample
  // unescaped at this cap is below exp(-depth), even near a parabolic cusp.
  const maxIterations = Math.ceil((depth
    + Math.log(Math.log(ESCAPE_RADIUS + boundC / ESCAPE_RADIUS))) / LN2) + 1;
  const sample = (x, y) => evaluatePotential(view.x + x * view.width,
    view.y + y * view.width, maxIterations, counters);
  const localX = (column) => column / columns - 0.5;
  const localY = (row) => (row / rows - 0.5) / view.aspect;
  const field = new Float64Array(stride * (rows + 1));
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const index = row * stride + column;
      field[index] = sample(localX(column), localY(row));
      if ((index & 127) === 127) yield;
    }
  }

  // Shared grid-edge IDs join neighboring cells exactly, without coordinate
  // rounding that can merge unrelated strands at high magnification.
  const horizontalCount = columns * (rows + 1);
  const edgeCount = horizontalCount + stride * rows;
  const degree = new Uint8Array(edgeCount);
  const first = new Int32Array(edgeCount).fill(-1);
  const second = new Int32Array(edgeCount).fill(-1);
  const nodeX = new Float64Array(edgeCount);
  const nodeY = new Float64Array(edgeCount);
  const edgeNode = (id, col0, row0, col1, row1) => {
    if (degree[id]) return id;
    const x0 = localX(col0);
    const y0 = localY(row0);
    const dx = localX(col1) - x0;
    const dy = localY(row1) - y0;
    const sign0 = field[row0 * stride + col0] > target;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 10; step += 1) {
      const middle = (low + high) / 2;
      if ((sample(x0 + dx * middle, y0 + dy * middle) > target) === sign0) low = middle;
      else high = middle;
    }
    const t = (low + high) / 2;
    nodeX[id] = x0 + dx * t;
    nodeY[id] = y0 + dy * t;
    return id;
  };
  let segments = 0;
  let ambiguousCells = 0;
  const connect = (a, b) => {
    if (degree[a] === 0) first[a] = b;
    else second[a] = b;
    if (degree[b] === 0) first[b] = a;
    else second[b] = a;
    degree[a] += 1;
    degree[b] += 1;
    segments += 1;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * stride + column;
      const a = field[index] > target;
      const b = field[index + 1] > target;
      const c = field[index + stride + 1] > target;
      const d = field[index + stride] > target;
      let bottom = -1;
      let right = -1;
      let top = -1;
      let left = -1;
      if (a !== b) bottom = edgeNode(row * columns + column, column, row, column + 1, row);
      if (b !== c) right = edgeNode(horizontalCount + row * stride + column + 1,
        column + 1, row, column + 1, row + 1);
      if (d !== c) top = edgeNode((row + 1) * columns + column,
        column, row + 1, column + 1, row + 1);
      if (a !== d) left = edgeNode(horizontalCount + row * stride + column,
        column, row, column, row + 1);
      if (bottom >= 0 && right >= 0 && top >= 0 && left >= 0) {
        ambiguousCells += 1;
        // Alternating corners: sample the actual field in the cell center.
        // Equal center/corner a joins the regions of that sign through center.
        const center = sample(localX(column + 0.5), localY(row + 0.5)) > target;
        if (center === a) {
          connect(bottom, right);
          connect(top, left);
        } else {
          connect(bottom, left);
          connect(right, top);
        }
      } else {
        let previous = -1;
        for (const node of [bottom, right, top, left]) {
          if (node < 0) continue;
          if (previous < 0) previous = node;
          else connect(previous, node);
        }
      }
      if (((row * columns + column) & 127) === 127) yield;
    }
  }

  const visited = new Uint8Array(edgeCount);
  const ordered = new Uint32Array(edgeCount);
  const pathOffsets = [0];
  const pathClosed = [];
  let vertices = 0;
  let uncertainClosedPaths = 0;
  // Every exact positive Green level is one Jordan curve surrounding all M.
  // Finite sampling can lose thin connections and create extra closed loops.
  // Preserve those useful sampled outlines, but detect obvious topological
  // uncertainty via known points in M. This is not a topology certification:
  // underresolved=false cannot prove that every subcell feature was captured.
  const anchors = [[-2, 0], [0.25, 0], [0, 1], [0, -1]].map(([x, y]) => [
    (x - view.x) / view.width, (y - view.y) / view.width,
  ]);
  function* trace(start) {
    let previous = -1;
    let current = start;
    let isClosed = false;
    let anchorMask = 0;
    while (current >= 0 && !visited[current]) {
      visited[current] = 1;
      ordered[vertices++] = current;
      const next = first[current] === previous ? second[current] : first[current];
      if (degree[start] === 2 && next >= 0) {
        const ax = nodeX[current];
        const ay = nodeY[current];
        const bx = nodeX[next];
        const by = nodeY[next];
        for (let index = 0; index < anchors.length; index += 1) {
          const [x, y] = anchors[index];
          if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) {
            anchorMask ^= 1 << index;
          }
        }
      }
      previous = current;
      current = next;
      if (current === start) isClosed = true;
      if ((vertices & 1023) === 0) yield;
    }
    pathOffsets.push(vertices);
    if (isClosed && anchorMask !== 15) uncertainClosedPaths += 1;
    // This flag describes closure of the sampled polyline, not a guarantee
    // that it is an independent exact Mandelbrot equipotential.
    pathClosed.push(isClosed ? 1 : 0);
  }
  // Open crop fragments first, then cycles. Each cycle omits its repeated start.
  for (let id = 0; id < edgeCount; id += 1) {
    if (degree[id] === 1 && !visited[id]) yield* trace(id);
    if ((id & 2047) === 2047) yield;
  }
  for (let id = 0; id < edgeCount; id += 1) {
    if (degree[id] && !visited[id]) yield* trace(id);
    if ((id & 2047) === 2047) yield;
  }
  const points = new Float32Array(vertices * 2);
  for (let i = 0; i < vertices; i += 1) {
    points[2 * i] = nodeX[ordered[i]];
    points[2 * i + 1] = nodeY[ordered[i]];
    if ((i & 2047) === 2047) yield;
  }
  const offsets = new Uint32Array(pathOffsets.length);
  const closed = new Uint8Array(pathClosed.length);
  for (let i = 0; i < pathOffsets.length; i += 1) {
    offsets[i] = pathOffsets[i];
    if (i < closed.length) closed[i] = pathClosed[i];
    if ((i & 2047) === 2047) yield;
  }
  return {
    view, depth, points, offsets, closed,
    stats: {
      computationMs: clock() - startTime,
      grid: { columns, rows },
      vertices,
      segments,
      pathCount: closed.length,
      closedCount: closed.reduce((sum, value) => sum + value, 0),
      openCount: closed.reduce((sum, value) => sum + (value ? 0 : 1), 0),
      limited,
      underresolved: ambiguousCells > 0 || uncertainClosedPaths > 0,
      ambiguousCells,
      uncertainClosedPaths,
      maxIterations,
      evaluations: counters.evaluations,
      orbitIterations: counters.iterations,
    },
  };
}

export function computeContours(request) {
  const job = contourJob(request);
  let step = job.next();
  while (!step.done) step = job.next();
  return step.value;
}

/** Resolves to null when cancelled; cancellation is checked in every phase. */
export async function computeContoursAsync(request, {
  isCancelled = () => false,
  yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
  sliceMs = 8,
} = {}) {
  const job = contourJob(request);
  const budget = clamp(finite(sliceMs, 8), 1, 32);
  let deadline = clock() + budget;
  while (!isCancelled()) {
    const step = job.next();
    if (isCancelled()) return null;
    if (step.done) return step.value;
    if (clock() >= deadline) {
      await yieldTask();
      deadline = clock() + budget;
    }
  }
  return null;
}
